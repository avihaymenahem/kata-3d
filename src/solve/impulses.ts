/**
 * B3 SOLVER — `src/solve/impulses.ts`
 *
 * `ImpulseEvent` extraction from the ANALYTIC channels. doc 04 §9.1; ARCHITECTURE.md §3.9,
 * §4.11 S15; gate **G-9c**.
 *
 * ═══ ONE CRACK PER TECHNIQUE, NOT AN IMPULSE TRAIN ═════════════════════════════════════════
 * §3.9 on `ImpulseEvent`: "This REPLACES thresholding a differentiated acceleration signal, which
 * produced an impulse train instead of one crack (judge 1 fatal A2)."
 *
 * The mechanism is worth stating plainly, because the broken approach is the obvious one:
 * tangential angular acceleration between two slerped keys is IDENTICALLY ZERO — slerp is a
 * constant-rate great-circle arc — so all of a limb's acceleration lives in the discontinuities at
 * the keys. Differentiate a baked track twice and you get a spike per key, i.e. one "crack" per
 * baked frame. At the 960 rung that is 240 cracks a second, which as a cloth driver sounds like
 * gravel and looks like static.
 *
 * So the events are EMITTED, not detected. The compiler knows exactly when each limb locks —
 * it is `τ = 1` of the technique window — and how fast it was going, from doc 04 §10's `v_pk`.
 * No threshold, no search, no tuning constant.
 *
 * ═══ `crackDelayTicks` IS AN EXACT INTEGER, AND THAT IS THE WHOLE OF G-9c ══════════════════
 * doc 04 §9.1: a 10–20 ms limb stop produces a visible crack. At `TICK_HZ = 3840` that is
 * `msToTick(10) = 38` to `msToTick(20) = 77` ticks — `CRACK_DELAY_TICKS_MIN/MAX`.
 *
 * §3.9's note on `BakeStats.eventsBelow20msExact` is emphatic that G-9c is STRUCTURAL, not
 * numeric: "Do NOT implement it by calling `survivesQuantisation` in a loop — that predicate is a
 * statement about the CLOCK and is true for every input at this tick rate, so a gate built on it
 * would report `true` unconditionally." The real check is `Number.isInteger` on every event tick
 * and every crack delay, plus the [38, 77] range — which is what `checkG9c` below does and what
 * `tests/contracts/tickrate.test.ts` re-checks independently.
 */

import type { BoneIndex, GarmentPartId, ImpulseEvent, KataMove } from '../contracts';
import {
  CRACK_DELAY_TICKS_MAX,
  CRACK_DELAY_TICKS_MIN,
  boneIndex,
  msToTick,
} from '../contracts';
import type { MoveTech } from './keyposes';
import type { Slot } from './timeline';
import { worldFacing, toWorldYawDeg } from './frame';

/** doc 04 §9.1's window, milliseconds. A faster stop cracks sooner. */
export const CRACK_MS_MIN = 10;
export const CRACK_MS_MAX = 20;
/** doc 04 §10's `v_pk` range across the shipped rows, m/s. Used to map speed onto the window. */
export const VPK_MIN_MS = 3.6;
export const VPK_MAX_MS = 6.5;

/**
 * The crack delay for a stop at `vPkMs`, as an EXACT integer tick count.
 *
 * Faster stop, shorter delay: a harder deceleration propagates through the sleeve quicker. The
 * mapping is linear across doc 04 §10's own `v_pk` range and then clamped into [38, 77], so the
 * result is inside `CRACK_DELAY_TICKS_MIN/MAX` by construction rather than by assertion.
 *
 * `msToTick` rounds, so the return is always an integer — G-9c's structural requirement. The
 * clamp is applied AFTER the conversion, on ticks, because clamping milliseconds first and then
 * rounding could still land outside the range at the boundary.
 */
export function crackDelayTicks(vPkMs: number): number {
  const t = Math.max(0, Math.min(1, (vPkMs - VPK_MIN_MS) / (VPK_MAX_MS - VPK_MIN_MS)));
  const ms = CRACK_MS_MAX + t * (CRACK_MS_MIN - CRACK_MS_MAX);
  const ticks = msToTick(ms);
  return Math.max(CRACK_DELAY_TICKS_MIN, Math.min(CRACK_DELAY_TICKS_MAX, ticks));
}

/** Which garment parts a limb stop drives. doc 06 §7.1's inventory, by acting limb. */
export function targetsForArm(arm: 'L' | 'R'): readonly GarmentPartId[] {
  return arm === 'L'
    ? (['sleeve_L', 'skirt_front_L', 'obi_tail_L'] as const)
    : (['sleeve_R', 'skirt_front_R', 'obi_tail_R'] as const);
}

export function targetsForFoot(foot: 'L' | 'R'): readonly GarmentPartId[] {
  return foot === 'L' ? (['trouser_L', 'skirt_back'] as const) : (['trouser_R', 'skirt_back'] as const);
}

const HIP_TARGETS: readonly GarmentPartId[] = Object.freeze([
  'obi_tail_L', 'obi_tail_R', 'skirt_back', 'skirt_front_L', 'skirt_front_R',
]);

/**
 * §4.11 S15. Emit every impulse for one move.
 *
 * Exactly one `limb-stop` per ACTING LIMB — the technique arm and the hikite arm, which are the
 * two limbs that decelerate at kime. The hikite is an acting limb, not a passenger: doc 03 §3
 * calls it "the DRIVER, not an afterthought", and its peak angular velocity leads the striking
 * fist's by 20–35 ms, so its stop is a real mechanical event with its own crack.
 */
export function impulsesForMove(
  m: KataMove,
  slot: Slot,
  tech: MoveTech,
  durationTicks: number,
): readonly ImpulseEvent[] {
  const out: ImpulseEvent[] = [];
  const arm = m.tech.arm;
  const other = arm === 'L' ? 'R' : 'L';
  const facing = worldFacing(toWorldYawDeg(m.headingDeg));

  /* ── limb-stop, the working arm. At the kime tick, travelling along the facing. ─────────── */
  push(out, {
    tick: slot.kimeTick,
    kind: 'limb-stop',
    moveN: m.n,
    bone: handBone(arm),
    deltaVMs: tech.vPkMs,
    dirWorld: [facing[0], facing[1], facing[2]],
    crackDelayTicks: crackDelayTicks(tech.vPkMs),
    targets: targetsForArm(arm),
  }, durationTicks);

  /* ── limb-stop, the hikite. Opposite direction, and slower: doc 03 §3's pull is a shorter
   *    path over the same window, so its peak speed is a fraction of the strike's. ─────────── */
  if (m.hikite !== 'NONE') {
    const hikiteV = tech.vPkMs * HIKITE_SPEED_FRAC;
    push(out, {
      tick: slot.kimeTick,
      kind: 'limb-stop',
      moveN: m.n,
      bone: handBone(other),
      deltaVMs: hikiteV,
      dirWorld: [-facing[0], -facing[1], -facing[2]],
      crackDelayTicks: crackDelayTicks(hikiteV),
      targets: targetsForArm(other),
    }, durationTicks);
  }

  /* ── foot-contact. doc 02 §8 S1: "Front-foot ground contact precedes arm kime by 0.04 s." ── */
  const contactTick = slot.kimeTick - msToTick(S1_FOOT_LEAD_MS);
  if (contactTick > slot.transit.t0) {
    push(out, {
      tick: contactTick,
      kind: 'foot-contact',
      moveN: m.n,
      bone: footBone(m.front),
      /* A step lands the body mass, not a limb: the vertical closing speed is small compared to
       * a fist, and doc 04 §10 publishes no `v_pk` for it. Half the technique's is the
       * documented-range midpoint and is flagged DERIVED here rather than silently authored. */
      deltaVMs: tech.vPkMs * FOOT_CONTACT_SPEED_FRAC,
      dirWorld: [0, -1, 0],
      crackDelayTicks: crackDelayTicks(tech.vPkMs * FOOT_CONTACT_SPEED_FRAC),
      targets: targetsForFoot(m.front),
    }, durationTicks);
  }

  /* ── hip-snap. doc 01 §8.3: koshi no kaiten completes at τ = 1, coincident with heel contact.
   *    90 % of the rotation is done by τ = 0.92, so the SNAP — the part the obi sees — is the
   *    last 8 % of the window. ─────────────────────────────────────────────────────────────── */
  if (m.dHeadingDeg !== 0 || m.hips !== 'shomen') {
    const snapTick = slot.transit.t0 + Math.round(0.92 * (slot.t1 - slot.transit.t0));
    push(out, {
      tick: snapTick,
      kind: 'hip-snap',
      moveN: m.n,
      bone: boneIndex('pelvis'),
      deltaVMs: tech.vPkMs * HIP_SNAP_SPEED_FRAC,
      dirWorld: [facing[0], facing[1], facing[2]],
      crackDelayTicks: crackDelayTicks(tech.vPkMs * HIP_SNAP_SPEED_FRAC),
      targets: HIP_TARGETS,
    }, durationTicks);
  }

  /* ── kiai. doc 02 §7: "onset coincident with `t_kime`". ─────────────────────────────────── */
  if (m.kiai) {
    push(out, {
      tick: slot.kimeTick,
      kind: 'kiai',
      moveN: m.n,
      bone: boneIndex('chest'),
      deltaVMs: 0,
      dirWorld: [0, 0, -1],
      crackDelayTicks: CRACK_DELAY_TICKS_MIN,
      targets: [],
    }, durationTicks);
  }

  return out;
}

/**
 * **§4.11 S15's entry point.** Every impulse for the whole kata, in tick order.
 *
 * Named for the stage because §7.7's fix router routes a crack/impulse finding to
 * `src/solve/impulses.ts -> buildImpulses()`, and `tests/eval/fixsites.test.ts` asserts the symbol
 * exists. Sorted so `PoseTrack.impulses` is ascending, which the cloth queue relies on.
 */
export function buildImpulses(
  moves: readonly KataMove[],
  slots: readonly Slot[],
  techOf: readonly MoveTech[],
  durationTicks: number,
): readonly ImpulseEvent[] {
  const out: ImpulseEvent[] = [];
  for (let i = 0; i < moves.length; i++) {
    const slot = slots[i];
    const tech = techOf[i];
    if (slot === undefined || tech === undefined) continue;
    out.push(...impulsesForMove(moves[i]!, slot, tech, durationTicks));
  }
  return Object.freeze(out.sort((a, b) => a.tick - b.tick));
}

/** doc 03 §3: the hikite travels a shorter path over the same window. */
export const HIKITE_SPEED_FRAC = 0.72;
/** doc 02 §8 S1: front-foot contact precedes arm kime by 0.04 s. */
export const S1_FOOT_LEAD_MS = 40;
/** [DERIVED] A step lands body mass, not a limb. See the call site. */
export const FOOT_CONTACT_SPEED_FRAC = 0.5;
/** [DERIVED] The pelvis is the heaviest thing that snaps; its rim speed is a fraction of the fist's. */
export const HIP_SNAP_SPEED_FRAC = 0.45;

/**
 * Append an event, but only if its crack still lands inside the clip.
 *
 * `tests/contracts/tickrate.test.ts` asserts `e.tick + e.crackDelayTicks <= track.durationTicks`
 * for every event. An event whose crack falls past the end would drive cloth on a frame the
 * sampler cannot produce — which shows up not as a crash but as the final pose twitching, and
 * only in the last 20 ms of the clip where nobody looks.
 */
function push(out: ImpulseEvent[], e: ImpulseEvent, durationTicks: number): void {
  if (!Number.isInteger(e.tick) || e.tick < 0) return;
  if (e.tick + e.crackDelayTicks > durationTicks) return;
  out.push(e);
}

const handBone = (side: 'L' | 'R'): BoneIndex => boneIndex(side === 'L' ? 'hand_L' : 'hand_R');
const footBone = (side: 'L' | 'R'): BoneIndex => boneIndex(side === 'L' ? 'foot_L' : 'foot_R');

/**
 * **G-9c, as the structural predicate §3.9 specifies** — NOT `survivesQuantisation` in a loop.
 *
 * Every event tick and every crack delay is an integer produced by `msToTick`, and every delay is
 * inside [38, 77]. That is falsifiable: a delay carried as a fractional millisecond, or an event
 * placed at a frame-grid position rather than a tick, fails it.
 */
export function checkG9c(events: readonly ImpulseEvent[]): boolean {
  for (const e of events) {
    if (!Number.isInteger(e.tick)) return false;
    if (!Number.isInteger(e.crackDelayTicks)) return false;
    if (e.crackDelayTicks < CRACK_DELAY_TICKS_MIN) return false;
    if (e.crackDelayTicks > CRACK_DELAY_TICKS_MAX) return false;
  }
  return true;
}

/**
 * S15's other half: exactly one `limb-stop` per acting limb per move.
 *
 * Returns the move numbers that violate it. An empty array is a pass.
 */
export function checkOneLimbStopPerLimb(
  events: readonly ImpulseEvent[],
  moves: readonly KataMove[],
): readonly string[] {
  const bad: string[] = [];
  for (const m of moves) {
    const stops = events.filter((e) => e.kind === 'limb-stop' && e.moveN === m.n);
    const expected = m.hikite === 'NONE' ? 1 : 2;
    if (stops.length !== expected) {
      bad.push(`move ${m.n}: ${stops.length} limb-stop events, expected ${expected}`);
      continue;
    }
    const bones = new Set(stops.map((e) => e.bone as number));
    if (bones.size !== stops.length) bad.push(`move ${m.n}: two limb-stops on the same bone`);
  }
  return bad;
}
