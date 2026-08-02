/**
 * B3 SOLVER — `src/solve/keyposes.ts`
 *
 * `solvePoseAtTick` — the whole-body solve at an arbitrary integer tick — and `buildKeyPoses`,
 * the sparse semantic keys of §3.9. ARCHITECTURE.md §4.11 S5.
 *
 * ═══ THE POSE IS A PURE FUNCTION OF A TICK. THAT IS WHAT MAKES SEEKING FREE. ════════════════
 * §6.1: "For every integer `tick` and every layer-weight vector `w`, `sample(tick, w, out)` writes
 * exactly the same bytes into `out`, regardless of how the transport arrived at `tick`."
 *
 * The RUNTIME half of that is B6's sampler reading a dense array. The COMPILE-TIME half is here:
 * `solvePoseAtTick` carries no state between calls, integrates nothing, and reads no clock. It
 * takes a tick, works out which slot it is in, and solves. If it accumulated anything — a spring,
 * a velocity, a previous-frame pose — the baked track would depend on the order the baker
 * happened to visit ticks in, and `tests/solve/repeat.test.ts`'s byte-identical requirement would
 * fail intermittently, which is the worst way for it to fail.
 *
 * ═══ THE PER-CHANNEL LEAD IS WHAT MAKES IT LOOK LIKE KARATE ════════════════════════════════
 * doc 04 §11: the proximal chain leads the distal one — `rearFootDrive` 280 ms before arrival,
 * `wristLock` 80 ms. Every channel therefore evaluates its easing at its OWN τ, shifted earlier
 * by its lead. A solve that used one τ for the whole body produces a figure that moves as a rigid
 * unit: technically correct positions, and unmistakably not a martial artist.
 */

import type {
  KataMove,
  KataScore,
  HandShape,
  MovePatch,
  Num,
  PoseKey,
  StanceId,
  StanceSpec,
  TechniqueSpec,
} from '../contracts';
import {
  BONE_COUNT,
  CHANNEL_COUNT,
  CHANNEL_INDEX,
  H,
  TICK_HZ,
  holdThenSnap,
  kimeEase,
} from '../contracts';
import type { FootPlan } from '../data';
import { DYN, ROM, STANCES, YAME } from '../data';
import { channelLeadS, endEffectorAccelMs2, pelvisYawRateDegS } from './channels';
import { bodyCOM, comTargetXZ, loadShare, measureCOM } from './com';
import { toWorldYawDeg } from './frame';
import { GAZE_YAW_MAX_DEG, blinkAt, gazeTargetFor, solveGaze, type Blink } from './gaze';
import { solveHand, hikiteShape } from './hand';
import { Quaternion } from 'three';
import { clampSwingTwist } from './swingTwist';
import {
  ARM_LEN_M,
  BI,
  BONE_DEFS,
  type Skel,
  forwardKinematics,
  getLocal,
  setLocal,
  newSkel,
  resetToBind,
} from './skeleton';
import {
  deltoidHelper,
  forearmRollDeg,
  solveArmToLocal,
  specFor,
  techniquePathLenM,
  techniquePathLocal,
} from './arm';
import { HIKITE_HIP_A, HIKITE_TATE_B } from '../data';
import {
  ankleTargetsM,
  hipYawAuthoredDeg,
  pelvisTargetM,
  psiWorldDeg,
  solveStance,
} from './stance';
import {
  WHIP_CAP_DEG,
  pelvisYawWorldDeg,
  solvePelvisTilt,
  solveSpineWhip,
  xFactorDeg,
} from './spine';
import { type Slot, type Timeline, tauOfSlot, techDurationS, slotAt } from './timeline';

/** Everything the per-tick solve needs, resolved once per compile. */
export interface SolveCtx {
  readonly kata: KataScore;
  readonly timeline: Timeline;
  readonly footPlans: readonly FootPlan[];
  readonly patchOf: (n: number) => MovePatch;
  /** Per-move resolved technique spec, path length, and its doc 04 §10 dynamics row. */
  readonly techOf: readonly MoveTech[];
  readonly blinks: readonly Blink[];
}

export interface MoveTech {
  readonly spec: TechniqueSpec;
  /** doc 04 §0's `L` — the END-EFFECTOR path length, metres. NOT `L_M` (conflict C17). */
  readonly pathLenM: number;
  /** doc 04 §10 `T_thrust`, seconds. The roll's time base. */
  readonly thrustS: number;
  /** doc 04 §10 `v_pk`, m/s. What a limb-stop removes. */
  readonly vPkMs: number;
  /** doc 04 §10 `recoil`, a fraction of `pathLenM`. */
  readonly recoilFracL: number;
  readonly dynKey: string;
}

/**
 * `TechniqueId` -> doc 04 §10's own row key.
 *
 * The `-step` suffix is not decoration: doc 04 §10 measures the STEPPING form of each technique
 * (`T_tech` 0.52 s for `oi-zuki-chudan-step` against 0.28 s for a stationary `choku-zuki`), and
 * every technique in both kata is performed stepping. Picking the stationary row would make each
 * technique 46 % too fast and the accel channels 3.4x too large.
 */
const DYN_KEY: Readonly<Record<string, string>> = Object.freeze({
  'oi-zuki': 'oi-zuki-chudan-step',
  'choku-zuki': 'choku-zuki',
  'gyaku-zuki': 'gyaku-zuki-chudan',
  'gedan-barai': 'gedan-barai-step',
  'age-uke': 'age-uke-step',
  'soto-uke': 'soto-uke-step',
  'uchi-uke': 'uchi-uke-step',
  'shuto-uke': 'shuto-uke-kokutsu-step',
  'tettsui-tate-mawashi': 'tettsui-otoshi',
  none: 'choku-zuki',
});

export function buildCtx(
  kata: KataScore,
  timeline: Timeline,
  footPlans: readonly FootPlan[],
  patchOf: (n: number) => MovePatch,
  blinks: readonly Blink[],
): SolveCtx {
  const techOf: MoveTech[] = kata.moves.map((m) => {
    const spec = specFor(m.tech.id, m.tech.level);
    const dynKey = DYN_KEY[m.tech.id] ?? 'choku-zuki';
    const row = DYN[dynKey];
    if (row === undefined) throw new Error(`buildCtx: no DYN row '${dynKey}' for ${m.tech.id}`);
    return {
      spec,
      pathLenM: techniquePathLenM(spec),
      thrustS: row.TthrustS.v,
      vPkMs: row.vPkMs.v,
      recoilFracL: row.recoilFracL.v,
      dynKey,
    };
  });
  return { kata, timeline, footPlans, patchOf, techOf, blinks };
}

/** doc 04 §4.3 [MEAS]: the wrist peaks at 73 % of the move time. One value, named once. */
export const TAU_PEAK = 0.73;

const _com = new Float64Array(3);

/** The interpolated state a tick sits at, before any bone is touched. */
interface Interp {
  readonly move: KataMove | null;
  readonly slot: Slot;
  readonly tau: number;
  /** AUTHORED heading, interpolated through the move with `holdThenSnap`. */
  readonly headingDeg: number;
  /** The foot plan to stand on: the previous move's until the transit, then this move's. */
  readonly plan: FootPlan;
  /** Previous plan, for the moving foot's travel. */
  readonly prevPlan: FootPlan | null;
  readonly moveIndex: number;
  /** The stance `prevPlan` was standing in. `undefined` when `prevPlan` is null. */
  readonly prevStance?: StanceId;
  /** Only set on a ceremony slot: `FINAL_HOLD` keeps the last move's stance (doc 02 §2). */
  readonly ceremonyStance?: StanceId;
  readonly ceremonyPhase?: 'open' | 'close';
}

/**
 * Where the character is at `tick`, before the body solve.
 *
 * The heading uses `holdThenSnap`, not a linear ramp: doc 01 §8.3's koshi no kaiten holds the
 * hips until τ = 0.55 and then snaps. Interpolating the heading linearly is doc 01 §9.5's fault
 * X3, and S7 asserts against it directly (`|ψ(0.5) − ψ_start| ≤ 8°`).
 *
 * The delta is the AUTHORED `dHeadingDeg`, NOT the short way round: doc 02 §9 d2's 270° turns
 * traverse the long way, and shortest-path interpolation would spin them backwards through
 * every intermediate frame while landing the same final stance.
 */
function interpAt(ctx: SolveCtx, tick: number): Interp {
  const slot = slotAt(ctx.timeline, tick) ?? ctx.timeline.slots[ctx.timeline.slots.length - 1]!;

  if (slot.kind !== 'move') {
    /* Ceremony.
     *
     * `FINAL_HOLD` is the one phase that is NOT hachiji: doc 02 §2 holds it in the LAST MOVE'S
     * stance (JKA England prints "Hold position" at move 21), which is zenkutsu for Taikyoku and
     * kokutsu for Heian. Treating every ceremony phase as hachiji snaps both feet ~1 m and the
     * whole arm chain at the last kime — measured as a 61° roll step and a 38° foot step at the
     * 960 rung, i.e. a discontinuity. `validateKata`'s K7-final-hold-stance asserts the ceremony
     * table agrees with the last move; this is the solve honouring it.
     *
     * Everything after `YAME` is hachiji at the yoi datum, which is doc 02 §4.3 / §6.3's whole
     * closure proof: the right foot has not moved since move 19/20, so `c` returns to (0,0).
     *
     * `return` shape note: `headingDeg` is computed above so the yame turn is interpolated. */
    const isOpen = slot.kind === 'ceremony-open';
    const last = ctx.footPlans[ctx.footPlans.length - 1]!;
    const lastStance = ctx.kata.moves[ctx.kata.moves.length - 1]!.stance;
    const holdsLastStance = !isOpen && slot.label === 'FINAL_HOLD';
    /* `YAME` is the one ceremony phase that MOVES: doc 02 §4.3 / §6.3 pivot on the right foot and
     * draw the left back to `(+h, 0)`. Treating it as a static hachiji makes the feet jump
     * straight from the final zenkutsu/kokutsu to yoi in one tick — a 38° foot step measured at
     * the FINAL_HOLD boundary. Interpolating it is also the only way the closure the two proofs
     * describe is actually visible. */
    const isYame = !isOpen && slot.label === 'YAME';
    const plan = holdsLastStance ? last : YOI_PLAN;
    const stance: StanceId = holdsLastStance ? lastStance : 'hachiji';
    const tau = isYame ? (slot.t1 <= slot.t0 ? 1 : (tick - slot.t0) / (slot.t1 - slot.t0)) : 1;
    /* The yame turn is authored (+90 Taikyoku, +45 Heian) and must be driven the same way a move's
     * turn is, or the whole body snaps to heading 0 on the first tick of the phase. */
    const headingDeg = isYame
      ? last.headingDeg + holdThenSnap(tau) * YAME[ctx.kata.id].dHeadingDeg
      : plan.headingDeg;
    return {
      move: null,
      slot,
      tau,
      headingDeg,
      plan,
      prevPlan: isYame ? last : null,
      prevStance: isYame ? lastStance : undefined,
      moveIndex: -1,
      ceremonyStance: stance,
      ceremonyPhase: isOpen ? 'open' : 'close',
    };
  }

  const i = slot.moveN - 1;
  const m = ctx.kata.moves[i]!;
  const plan = ctx.footPlans[i]!;
  /* Move 1's predecessor is YOI, not "nothing". Leaving it null makes the feet appear in
   * zenkutsu at τ = 0 rather than stepping out of hachiji — a 38° foot rotation and a 0.6 m
   * translation on the tick the ceremony ends, which is the first thing a viewer sees. */
  const prevPlan = i > 0 ? ctx.footPlans[i - 1]! : YOI_PLAN;
  const tau = tauOfSlot(slot, tick);

  const prevHeading = prevPlan?.headingDeg ?? 0;
  const headingDeg = prevHeading + holdThenSnap(tau) * m.dHeadingDeg;

  return { move: m, slot, tau, headingDeg, plan, prevPlan, moveIndex: i };
}

/**
 * The yoi stance, as a `FootPlan`: hachiji at the origin, heading 0.
 *
 * doc 02 §3.2's yoi datum: `L = (+h, 0)`, `R = (−h, 0)`, `c = (0, 0)` with `h = 0.19 L`. Built as
 * a literal rather than read from B1 because the ceremony has no move to hang a plan on, and the
 * three numbers ARE the datum every embusen coordinate is measured from.
 */
const YOI_PLAN: FootPlan = Object.freeze({
  moveN: 0,
  headingDeg: 0,
  ffXZ: [0.19, 0] as const,
  rfXZ: [-0.19, 0] as const,
  cXZ: [0, 0] as const,
  frontFoot: 'L' as const,
  pivotFoot: null,
  pivotKind: 'NONE' as const,
  excursion: null,
});

/**
 * The foot plan actually standing at `tick` — the previous stance's centre eased toward this
 * move's, with this move's heading.
 *
 * Easing the CENTRE rather than each foot is what keeps a planted foot planted: it does not move
 * because the plan says it does not, so S12.5's lock only has to correct for what the ROM clamp
 * did rather than for an interpolation artefact it introduced itself.
 */
function planAt(ip: Interp): FootPlan {
  const { move, plan, prevPlan, tau } = ip;
  /* The heading ALWAYS comes from `ip`, never from the plan.
   *
   * `FootPlan.headingDeg` is the move's authored DESTINATION; `ip.headingDeg` is where the body
   * actually is at this tick. `solveStance` builds the root yaw from whatever it is handed, so
   * returning the raw plan through a ceremony slot rotates the root from the last move's 270°
   * straight to yoi's 0° on the first tick of YAME — a 90° step on both feet, which is the single
   * largest discontinuity that survived every other fix here. */
  if (move === null || prevPlan === null || tau >= 1) {
    return plan.headingDeg === ip.headingDeg ? plan : { ...plan, headingDeg: ip.headingDeg };
  }
  const a = kimeEase(tau, TAU_PEAK);
  return {
    ...plan,
    headingDeg: ip.headingDeg,
    cXZ: [
      prevPlan.cXZ[0] + a * (plan.cXZ[0] - prevPlan.cXZ[0]),
      prevPlan.cXZ[1] + a * (plan.cXZ[1] - prevPlan.cXZ[1]),
    ],
  };
}

export interface PoseSolveResult {
  /** Worst arm/leg IK residual at this tick, metres. `[armL, armR, legL, legR]`. */
  readonly ikResidualM: readonly [number, number, number, number];
  readonly comErrH: number;
  readonly headYH: number;
  readonly pelvisYawDeg: number;
  readonly xFactorDeg: number;
  /** The 14 channel values at this tick. */
  readonly chan: Float32Array;
}

const _chan = new Float32Array(CHANNEL_COUNT);

/**
 * THE per-tick solve. Writes the pose into `s` and returns the diagnostics for this tick.
 *
 * Order follows doc 06 §6.4's NORMATIVE layering: L1 hip drive, L2 spine whip, L3 COM, L4 leg IK,
 * L5 arm IK, L7 helpers, L8 look-at. The ROM clamp (L9) and the plant re-lock (S12.5) run in
 * `compile.ts`, after this, because §4.11 makes them their own stages with their own invariants.
 */
export function solvePoseAtTick(ctx: SolveCtx, tick: number, s: Skel): PoseSolveResult {
  const ip = interpAt(ctx, tick);
  const m = ip.move;
  const stanceId: StanceId = m?.stance ?? ip.ceremonyStance ?? 'hachiji';
  const spec = blendedStance(ctx, ip, stanceId);
  const plan = planAt(ip);

  resetToBind(s);

  /* ── L4 (feet) + the pelvis height constraint. `solveStance` holds `pelvisY` exactly. ────── */
  const ankles = ankleTargetsAt(ctx, ip, stanceId);
  const pelvisXZ = pelvisXZAt(ctx, ip, spec, stanceId);
  const footYaw = footYawAt(ctx, ip, stanceId);
  const st = solveStance(spec, plan, s, ankles, pelvisXZ, footYaw);

  /* ── L1 hip drive. ψ is a doc-04 authored yaw, so it goes through the ψ converter.
   *
   * ψ STARTS FROM THE PREVIOUS MOVE'S ψ, not from 0. The hips do not return to square between
   * counts — a gedan-barai ends in hanmi and the oi-zuki that follows rotates OUT of it into
   * shomen, which is the whole of `koshi no kaiten`. Restarting from 0 each move snaps the pelvis
   * 45° on every hanmi↔shomen boundary (measured on `pelvis` at the move 3→4 seam) and, worse,
   * makes the hip drive describe a motion the character never performs. */
  const psiEndAuthored = m === null ? 0 : hipYawAuthoredDeg(spec, m.hips);
  const psiStartWorld = psiWorldDeg(previousPsiAuthored(ctx, ip));
  const psiEndWorld = m === null ? psiStartWorld : psiWorldDeg(psiEndAuthored);
  const tauMove = ip.tau;
  const psiWorld = pelvisYawWorldDeg(tauMove, psiStartWorld, psiEndWorld);
  const windowS = m === null ? 1 : techDurationS(ip.slot);
  const psiRate = pelvisYawRateDegS(tauMove, psiEndWorld - psiStartWorld, windowS);
  solvePelvisTilt(s, spec.pelvisTiltPost.v, psiWorld);
  forwardKinematics(s);

  /* ── L2 spine whip. Velocity-proportional, so the lag resolves when the hips stop. ───────── */
  const whip = solveSpineWhip(s, psiRate);
  forwardKinematics(s);

  /* ── L5 arm IK. Each arm at its OWN led τ (doc 04 §11), on a CONTINUOUS path. ──────────────
   *
   * THIS RUNS ON EVERY TICK, INCLUDING THE CEREMONY. Guarding it with `if (m !== null)` leaves
   * both arms and both hands at the BIND T-pose through the ceremony, so they snap ~110° into
   * move 1 and ~105° (fingers) out of it. Those are discontinuities, not fast motion, and no bake
   * rung fixes a discontinuity — G-9a measured them as a 55° midpoint slerp error. The ceremony
   * is 6.7 s of the 50 s clip; it is not a special case, it is a third of the standing time. */
  let armLres = 0;
  let armRres = 0;
  {
    const t = m === null ? null : ctx.techOf[ip.moveIndex]!;
    const leadElbow = channelLeadS('elbowExtend', windowS);
    const leadHikite = channelLeadS('hikite', windowS);
    const workArm = m?.tech.arm ?? 'L';
    const other = workArm === 'L' ? 'R' : 'L';
    /* The roll runs on `T_thrust` — see `solveArm`'s `rollTau` note. */
    const thrustFrac = t === null ? 0 : Math.min(1, t.thrustS / Math.max(windowS, 1e-6));

    for (const side of [workArm, other] as const) {
      const isWork = m !== null && side === m.tech.arm;
      const leadS = isWork ? leadElbow : leadHikite;
      const tick2 = tick + Math.round(leadS * TICK_HZ);

      /* During the ceremony both arms hang in the yoi gedan form, so HIP-A is the pole/roll
       * source for both; `armLocalAt` supplies the yoi offset itself. */
      const spec =
        m === null
          ? HIKITE_HIP_A
          : isWork
            ? t!.spec
            : (hikiteSpecFor(m.hikite) ?? HIKITE_HIP_A);

      armLocalAt(ctx, ip, side, tick2, _armLocal);
      /* The hikite pronates half as far: doc 03 §3's pull ends palm-up at the hip, which is a
       * smaller rotation than the strike's full pronation. */
      const rollDeg = armRollAt(ctx, ip, side, tick2, spec, thrustFrac, isWork);
      const poleDir = armPoleAt(ctx, ip, side, tick2, spec);

      const r = solveArmToLocal(s, side, spec, _armLocal, rollDeg, poleDir);
      if (side === 'L') armLres = r.residualM;
      else armRres = r.residualM;

      /**
       * The hand shape is constant WITHIN a move (doc 03 §12's shapes are poses, not paths) but
       * it must BLEND between moves, and it must be set on every tick.
       *
       * Two separate faults were found here. Leaving it unset during the ceremony put the fingers
       * at bind and snapped 105° at tick 25728. Setting it with `from = null` — an instant switch
       * — then snapped 99° on `fingers_dist_L` at Heian's move 17→18, where the hand changes from
       * `seiken` to `shuto` for the first shuto-uke. Both are discontinuities the bake cannot
       * absorb at any rung.
       *
       * The shape now eases over the PREP window on `kimeEase`, alongside the chamber and the
       * roll — which is also when a karateka's hand actually forms: you open the hand as you pull
       * back, not at the instant of the block.
       */
      /* The CLOSING ceremony holds the last move's shape — Heian ends on four shuto-uke, and
       * forcing `seiken` at FINAL_HOLD snapped `fingers_dist_L` by 99° on the boundary tick. The
       * opening ceremony is `seiken`: doc 02 §2's yoi has both fists closed. */
      const shape =
        m === null
          ? ip.ceremonyPhase === 'open'
            ? 'seiken'
            : prevHandShape(ctx, ip, side)
          : isWork
            ? t!.spec.hand
            : hikiteShape(m.hikite);
      const fromShape = prevHandShape(ctx, ip, side);
      solveHand(s, side, shape, handBlendTau(ip, tick2), fromShape, TAU_PEAK);
    }
  }

  /* ── L7 helper drivers: the deltoid slerp only (doc 06 §5.4 Fix 2). ─────────────────────────
   *
   * `clavicleRhythm` is NOT called here, and that is a correction rather than an omission.
   * doc 06 §6.4 puts helpers at L7, after the arm IK at L5 — which is right for a helper that
   * only affects SKINNING, like the deltoid. But the clavicle is a PARENT of the whole arm chain:
   * rotating it after the IK moves the GH out from under a solved arm and re-opens the residual
   * the solve just closed. Measured, it lifted the wrist from its target `dy = −0.190` to
   * `−0.037` — the arms riding at shoulder height in the render.
   *
   * The scapular contribution is real and is still made — by `protractClavicle`, INSIDE the arm
   * solve and before the IK, where doc 06 §5.4 Fix 3's purpose (letting the shoulder travel so
   * doc 03 §13's END is reachable at all) is actually served. Calling both double-counts it. */
  for (const side of ['L', 'R'] as const) deltoidHelper(s, side);
  forwardKinematics(s);

  /* ── L3 COM. Runs after the arms because a fully extended arm moves the COM by 1.5 cm.
   *    Uses the SAME interpolated ankles the legs were planted to, so the support polygon the COM
   *    is measured against is the one the feet are actually standing on. */
  const support = supportXZ(ankles, plan.frontFoot);
  const target = comTargetXZ(support.front, support.rear, spec.loadFront.v);
  /**
   * MEASURED, NOT ITERATED. doc 06 §2.2's iterative pelvis nudge exists for poses where the hip
   * has not already been placed; ours has. §2.3 DERIVES `PELVIS_AHEAD_OF_C_H` from the very same
   * load split (`(loadFront − 0.5)·S`, the inverse relation of §2.2), and
   * `tests/data/derived.test.ts` asserts the two forms agree to 4e-4 — so `pelvisTargetM` already
   * IS the converged answer and running the loop on top of it double-counts the correction.
   *
   * Worse, the loop translates the ROOT with no `solveFootIK()` behind it, which doc 06 §2.2's
   * own pseudocode calls for ("# feet stay planted"). Without that callback every iteration drags
   * both planted ankles off the embusen, and because the loop breaks early on tolerance it does
   * so a DIFFERENT number of times on adjacent ticks — a per-tick jitter in root position that
   * the baker reads as curvature no rung can absorb.
   *
   * `measureCOM` reports the residual S9 gates without touching the pose.
   */
  const com = measureCOM(s, target);

  /* ── L8 look-at. After the spine has settled (doc 06 §6.4 L8). ───────────────────────────── */
  const headWorld: readonly [number, number, number] = [
    s.worldPos[BI.head * 3]!, s.worldPos[BI.head * 3 + 1]!, s.worldPos[BI.head * 3 + 2]!,
  ];
  /* The gaze leads: the head is already on the NEW heading while the hips are still turning.
   *
   * The desired heading is then CLAMPED INTO THE HEAD'S RANGE RELATIVE TO THE CHEST, in signed
   * continuous degrees, before it becomes a world point. Skipping that step is a real bug and it
   * bit hard: on a 270° turn the required yaw in the chest frame exceeds 180°, `atan2` folds it to
   * −90°, and doc 06 §6.5's ±80° clamp flips from +80 to −80 in a single frame — a 160° swing
   * that lands 72° on `head` and 64° on `neck_01`. It reads as the head snapping round the wrong
   * way, and because both the folded and unfolded values name the same DIRECTION, nothing
   * downstream can tell which one was meant. Working in signed deltas off the chest's own
   * continuously-moving yaw keeps it single-valued. */
  const desiredHeading = toWorldYawDeg(
    m === null ? ip.headingDeg : (ip.prevPlan?.headingDeg ?? 0) + headLeadAlpha(tauMove) * m.dHeadingDeg,
  );
  /* The body yaw is taken from the AUTHORED, UNFOLDED heading plus ψ — not read back off the pose
   * with `atan2`. Both are continuous functions of τ, so their difference is continuous, and the
   * ±80° clamp can never flip sign. Reading the chest's world yaw back instead reintroduces
   * exactly the wrap this clamp exists to remove: `atan2` returns (−180, 180], so on a 270° turn
   * a lead of +200° comes back as −160° and the clamp swings from +80 to −80 in one frame. */
  const bodyYaw = toWorldYawDeg(ip.headingDeg) + psiWorld;
  const relDeg = Math.max(-GAZE_YAW_MAX_DEG, Math.min(GAZE_YAW_MAX_DEG, desiredHeading - bodyYaw));
  const gazeHeading = bodyYaw + relDeg;
  /* doc 04 §2.1's X-factor budget, minus whatever the koshi whip already spent. The whip is the
   * hip drive and has priority: it is the thing that reads as karate (doc 06 §6.4 L2), whereas a
   * degree of chest yaw the gaze cannot take is simply taken by the neck instead. */
  const whipUsedDeg = Math.abs(whip.xFactorDeg);
  solveGaze(s, gazeTargetFor(headWorld, gazeHeading), Math.max(0, WHIP_CAP_DEG - whipUsedDeg));
  forwardKinematics(s);

  /* ── S12 · doc 06 §3.2's ROM clamp, over every bone. ──────────────────────────────────────
   *
   * §4.11 S12's exit invariant is "every bone inside `ROM`", and it is also what BOUNDS the free
   * twist `quatFromUnitVectors` leaves on the arm chain: `ROM.upperarm`'s signed twist range is a
   * hard limit on exactly the quantity that was varying non-smoothly. Without this pass the
   * solve can hand the baker a bone rotation no anatomy allows, and the bake then faithfully
   * reproduces it. */
  const clampSat = clampAllBones(s);
  void clampSat;

  /* ── Channels. Every one analytic; none differenced off the pose. ────────────────────────── */
  bodyCOM(s, _com);
  const loads = loadShare(s, support.front, support.rear, plan.frontFoot);
  _chan.fill(0);
  _chan[CHANNEL_INDEX.tauMove] = tauMove;
  _chan[CHANNEL_INDEX.tension] = m === null ? 0 : kimeEase(tauMove, 0.73);
  _chan[CHANNEL_INDEX.breath] = 0.5 + 0.5 * Math.sin((tick / TICK_HZ) * 2 * Math.PI * 0.53);
  _chan[CHANNEL_INDEX.kiai] = m !== null && m.kiai ? kiaiEnvelope(tauMove) : 0;
  _chan[CHANNEL_INDEX.pelvisYawRate] = psiRate;
  _chan[CHANNEL_INDEX.loadL] = loads.L;
  _chan[CHANNEL_INDEX.loadR] = loads.R;
  _chan[CHANNEL_INDEX.plantL] = 1;
  _chan[CHANNEL_INDEX.plantR] = 1;
  _chan[CHANNEL_INDEX.gazeYaw] = gazeHeading;
  _chan[CHANNEL_INDEX.gazePitch] = 0;
  _chan[CHANNEL_INDEX.blink] = blinkAt(ctx.blinks, tick);
  if (m !== null) {
    const t = ctx.techOf[ip.moveIndex]!;
    const acc = endEffectorAccelMs2(tauMove, t.pathLenM, windowS, 0.73);
    _chan[CHANNEL_INDEX.accelL] = m.tech.arm === 'L' ? acc : 0;
    _chan[CHANNEL_INDEX.accelR] = m.tech.arm === 'R' ? acc : 0;
  }

  return {
    ikResidualM: [armLres, armRres, st.legs.L.ankleResidualM, st.legs.R.ankleResidualM],
    comErrH: com.errH,
    headYH: s.worldPos[BI.headEnd * 3 + 1]! / H,
    pelvisYawDeg: psiWorld,
    xFactorDeg: xFactorDeg(s),
    chan: _chan,
  };
}

const _armLocal = new Float64Array(3);

/**
 * Both ankles in WORLD metres at this tick, interpolated PER FOOT.
 *
 * The planted foot holds; the moving foot travels from where it was to where it lands, over the
 * transit window, on `kimeEase` and with a small lift arc. That is doc 02 §3.1's own model —
 * "always place the moving foot from the pivot foot" — carried from a per-move statement to a
 * per-tick one.
 *
 * Deriving both ankles from the current plan instead makes them swap front/rear roles in a single
 * tick at every step, because `FootPlan.frontFoot` flips between consecutive moves. Measured, it
 * is a 58° foot rotation and a ~1 m ankle translation in 1 ms, and because it happens at the slot
 * boundary — where the pose is otherwise at rest — it is invisible in a still and unmistakable in
 * motion.
 */
function ankleTargetsAt(
  ctx: SolveCtx,
  ip: Interp,
  stanceId: StanceId,
): Readonly<Record<'L' | 'R', readonly [number, number, number]>> {
  const cur = ankleTargetsM(ip.plan, stanceId);
  if (ip.prevPlan === null || ip.tau >= 1) return cur;

  /* Move 1's predecessor is the yoi hachiji, not another move — hence the `?? 'hachiji'`. On a
   * `YAME` slot the caller supplies `prevStance` directly, because there is no move index. */
  const prevStance: StanceId =
    ip.prevStance ?? ctx.kata.moves[ip.moveIndex - 1]?.stance ?? 'hachiji';
  const prev = ankleTargetsM(ip.prevPlan, prevStance);

  /* On a move the step happens during the TRANSIT window, not the hold or the prep: doc 02 §1.4
   * puts translation in `t_transit`, so before it the feet are exactly where the last move left
   * them. `YAME` has no transit window — the whole phase is the draw. */
  const slot = ip.slot;
  const u =
    ip.move === null
      ? ip.tau
      : slot.transit.t1 <= slot.transit.t0
        ? 1
        : Math.max(
            0,
            Math.min(1, (tickOfTau(slot, ip.tau) - slot.transit.t0) / (slot.t1 - slot.transit.t0)),
          );
  const a = kimeEase(u, TAU_PEAK);

  const out = {} as Record<'L' | 'R', readonly [number, number, number]>;
  for (const side of ['L', 'R'] as const) {
    const p = prev[side];
    const c = cur[side];
    const travel = Math.hypot(c[0] - p[0], c[2] - p[2]);
    if (travel < 1e-6) {
      /* Planted. Held exactly, so S12.5's lock has nothing to undo. */
      out[side] = p;
      continue;
    }
    /* doc 01 §10 `STEP.swingClearance`: the swinging foot clears the floor by ~0.008 H mid-step.
     * A raised cosine peaks at u = 0.5 and is zero at both ends, so the foot leaves and meets the
     * floor with zero vertical velocity — which is what stops the visible scuff at touchdown. */
    const lift = 0.008 * H * Math.sin(Math.PI * a);
    out[side] = [
      p[0] + a * (c[0] - p[0]),
      p[1] + a * (c[1] - p[1]) + lift,
      p[2] + a * (c[2] - p[2]),
    ];
  }
  return out;
}

/** The MIDHIP XZ at this tick, eased between the two stances' pelvis targets. */
function pelvisXZAt(
  ctx: SolveCtx,
  ip: Interp,
  spec: Parameters<typeof pelvisTargetM>[1],
  stanceId: StanceId,
): readonly [number, number] {
  const cur = pelvisTargetM(ip.plan, spec, stanceId);
  if (ip.prevPlan === null || ip.tau >= 1) return [cur[0], cur[2]];
  const prevStance: StanceId =
    ip.prevStance ?? ctx.kata.moves[ip.moveIndex - 1]?.stance ?? 'hachiji';
  const prev = pelvisTargetM(ip.prevPlan, STANCES[prevStance], prevStance);
  const a = kimeEase(ip.tau, TAU_PEAK);
  return [prev[0] + a * (cur[0] - prev[0]), prev[2] + a * (cur[2] - prev[2])];
}

/** Invert `tauOfSlot`: the absolute tick a fractional τ corresponds to. */
const tickOfTau = (slot: Slot, tau: number): number =>
  slot.transit.t0 + tau * (slot.t1 - slot.transit.t0);

/**
 * The AUTHORED ψ the hips were left in by the previous move — the start of this move's hip drive.
 *
 * At yoi the hips are square (doc 02 §10: hachiji "square (0°)"), so move 1 starts from 0. After
 * the last move the closing ceremony holds whatever the last move ended in until YAME squares up.
 */
function previousPsiAuthored(ctx: SolveCtx, ip: Interp): number {
  /**
   * THE OPENING CEREMONY IS SQUARE. doc 02 §10: hachiji-dachi's hips are "square (0°)".
   *
   * Treating every ceremony slot as "after the last move" gave the OPENING ceremony the CLOSING
   * pose's ψ — for Heian that is move 21's hanmi, so the hips sat at 45° through the bow and the
   * yoi, then snapped to 0 on move 1's first tick. A 45° pelvis step rotates the chest, and the
   * chest carries both arms: measured 47.6° on `upperarm_L` at tick 25728, which is exactly the
   * ceremony→move-1 boundary. The arms were the symptom; the hips were the cause.
   */
  if (ip.ceremonyPhase === 'open') return 0;
  const idx = ip.move === null ? ctx.kata.moves.length - 1 : ip.moveIndex - 1;
  if (idx < 0) return 0;
  const prev = ctx.kata.moves[idx]!;
  return hipYawAuthoredDeg(STANCES[prev.stance], prev.hips);
}

/**
 * The stance spec at this tick, BLENDED between the previous stance and the current one.
 *
 * `pelvisY` is the field that makes this necessary and it is not a subtlety: zenkutsu sits at
 * 0.410 H and hachiji at 0.523 H, so a stance change with no blend stands the character up 20 cm
 * in a single tick. The legs then swing to follow and the feet rotate ~91° — measured at the
 * FINAL_HOLD→YAME boundary, where the last move's zenkutsu becomes yoi's hachiji.
 *
 * S3's exit invariant is that `pelvisY` equals ITS INPUT exactly, and it still does: the input is
 * this blended value, and the leg solve honours it to 1e-9 at every tick. What the blend removes
 * is a step change in the input, not the guarantee about the output — a distinction worth keeping
 * straight, because "the hips never bob" and "the hips may never change height" are different
 * claims and only the first is true.
 */
function blendedStance(ctx: SolveCtx, ip: Interp, stanceId: StanceId): StanceSpec {
  const cur = STANCES[stanceId];
  if (ip.prevPlan === null || ip.tau >= 1) return cur;
  const prevStance: StanceId =
    ip.prevStance ?? ctx.kata.moves[ip.moveIndex - 1]?.stance ?? 'hachiji';
  if (prevStance === stanceId) return cur;
  const prev = STANCES[prevStance];
  const a = kimeEase(ip.tau, TAU_PEAK);
  const mix = (p: Num, c: Num): Num => (a >= 1 ? c : { ...c, v: p.v + a * (c.v - p.v) });
  return {
    ...cur,
    S: mix(prev.S, cur.S),
    W: mix(prev.W, cur.W),
    yawFront: mix(prev.yawFront, cur.yawFront),
    yawRear: mix(prev.yawRear, cur.yawRear),
    pelvisY: mix(prev.pelvisY, cur.pelvisY),
    kneeFront: mix(prev.kneeFront, cur.kneeFront),
    kneeRear: mix(prev.kneeRear, cur.kneeRear),
    loadFront: mix(prev.loadFront, cur.loadFront),
    pelvisTiltPost: mix(prev.pelvisTiltPost, cur.pelvisTiltPost),
    pelvisYawHanmi: mix(prev.pelvisYawHanmi, cur.pelvisYawHanmi),
    torsoPitch: mix(prev.torsoPitch, cur.torsoPitch),
  };
}

/**
 * Each foot's ABSOLUTE authored yaw at this tick — `heading + toe-out`, interpolated.
 *
 * Both terms change at a stance boundary and both change discontinuously if left alone: the
 * heading turns (doc 02 §4.1's `ΔH`) and the toe-out is a per-stance constant (hachiji ±30°,
 * zenkutsu +3°/+30°, kokutsu 0°/+90°). Interpolating the SUM keeps the feet turning with the body
 * instead of sliding flat and then spinning on the spot at the boundary — measured as a 58° foot
 * step at FINAL_HOLD→YAME and 45° at the yoi→move-1 seam.
 *
 * The heading term uses `ip.headingDeg`, which is already `holdThenSnap`-driven and carries the
 * AUTHORED delta (so doc 02 §9 d2's 270° turns go the long way round, as they must).
 */
function footYawAt(
  ctx: SolveCtx,
  ip: Interp,
  stanceId: StanceId,
): Readonly<Record<'L' | 'R', number>> {
  const cur = STANCES[stanceId];
  const toeOut = (spec: StanceSpec, plan: FootPlan, side: 'L' | 'R'): number =>
    side === plan.frontFoot ? spec.yawFront.v : spec.yawRear.v;

  if (ip.prevPlan === null || ip.tau >= 1) {
    return {
      L: ip.headingDeg + toeOut(cur, ip.plan, 'L'),
      R: ip.headingDeg + toeOut(cur, ip.plan, 'R'),
    };
  }
  const prevStance: StanceId =
    ip.prevStance ?? ctx.kata.moves[ip.moveIndex - 1]?.stance ?? 'hachiji';
  const prev = STANCES[prevStance];
  const a = kimeEase(ip.tau, TAU_PEAK);
  const blend = (side: 'L' | 'R'): number => {
    const t0 = toeOut(prev, ip.prevPlan!, side);
    const t1 = toeOut(cur, ip.plan, side);
    return ip.headingDeg + t0 + a * (t1 - t0);
  };
  return { L: blend('L'), R: blend('R') };
}

/**
 * doc 02 §2's yoi arm position, as a torso-local GH-relative offset: fists at 0.55 H world, 0.13 H
 * lateral, 0.10 H forward of the hip coronal plane. Converted to a GH-relative FracH triple —
 * `SJC` sits at 0.7982 H (doc 06 §1.3), so the fist is 0.248 H below it.
 *
 * This is the arm's anchor before move 1 and after the last move; without it the first move's
 * prep would ease from the bind T-pose, which is a 90° shoulder swing nobody performs.
 */
const YOI_ARM_LOCAL: readonly [number, number, number] = Object.freeze([0.0, -0.248, -0.1]);

/** The `TechniqueSpec` a hikite form resolves to, or `null` for `NONE`. */
function hikiteSpecFor(form: 'HIP-A' | 'TATE-B' | 'NONE'): TechniqueSpec | null {
  if (form === 'NONE') return null;
  return form === 'HIP-A' ? HIKITE_HIP_A : HIKITE_TATE_B;
}

/** What one arm was doing at the END of a move — its role's terminal offset. */
function armEndLocal(ctx: SolveCtx, moveIndex: number, side: 'L' | 'R', out: Float64Array): void {
  if (moveIndex < 0) {
    out[0] = YOI_ARM_LOCAL[0]; out[1] = YOI_ARM_LOCAL[1]; out[2] = YOI_ARM_LOCAL[2];
    return;
  }
  const m = ctx.kata.moves[moveIndex]!;
  const spec = side === m.tech.arm ? ctx.techOf[moveIndex]!.spec : hikiteSpecFor(m.hikite);
  if (spec === null) {
    out[0] = YOI_ARM_LOCAL[0]; out[1] = YOI_ARM_LOCAL[1]; out[2] = YOI_ARM_LOCAL[2];
    return;
  }
  out[0] = spec.end.dx.v; out[1] = spec.end.dy.v; out[2] = spec.end.dz.v;
}

/**
 * THE arm path, continuous across the whole clip. doc 02 §1.4's own decomposition:
 *
 *   `t_hold`     the PREVIOUS kime sustained — the arm does not move
 *   `t_prep`     "hikite wind-up" — the arm chambers, easing to this technique's `start`
 *   `t_transit`  }  the technique itself, `start -> mid -> end` on `kimeEase`
 *   `t_kime`     }
 *
 * Getting this wrong is not a subtle error: driving the arm off `techniquePathLocal(τ)` alone
 * parks it at the chamber through the hold, so it snaps back ~80° at every slot boundary. G-9a
 * measured exactly that as an 80° midpoint slerp error before this function existed.
 */
function armLocalAt(
  ctx: SolveCtx,
  ip: Interp,
  side: 'L' | 'R',
  tick: number,
  out: Float64Array,
): void {
  const { slot, moveIndex } = ip;
  if (ip.move === null || moveIndex < 0) {
    armEndLocal(ctx, ctx.kata.moves.length - 1, side, out);
    if (slot.kind === 'ceremony-open') {
      out[0] = YOI_ARM_LOCAL[0]; out[1] = YOI_ARM_LOCAL[1]; out[2] = YOI_ARM_LOCAL[2];
    }
    return;
  }

  const m = ip.move;
  const isWork = side === m.tech.arm;
  const spec = isWork ? ctx.techOf[moveIndex]!.spec : hikiteSpecFor(m.hikite);
  if (spec === null) {
    armEndLocal(ctx, moveIndex - 1, side, out);
    return;
  }

  if (tick < slot.prep.t0) {
    /* HOLD — the previous kime, sustained. */
    armEndLocal(ctx, moveIndex - 1, side, out);
    return;
  }

  if (tick < slot.transit.t0) {
    /* PREP — chamber. Ease from wherever the arm was to this technique's `start`. */
    const u = (tick - slot.prep.t0) / Math.max(1, slot.transit.t0 - slot.prep.t0);
    armEndLocal(ctx, moveIndex - 1, side, _prevEnd);
    const a = kimeEase(Math.max(0, Math.min(1, u)), TAU_PEAK);
    out[0] = _prevEnd[0]! + a * (spec.start.dx.v - _prevEnd[0]!);
    out[1] = _prevEnd[1]! + a * (spec.start.dy.v - _prevEnd[1]!);
    out[2] = _prevEnd[2]! + a * (spec.start.dz.v - _prevEnd[2]!);
    return;
  }

  /* TRANSIT + KIME — the technique. */
  techniquePathLocal(spec, tauOfSlot(slot, tick), TAU_PEAK, out);
}

const _prevEnd = new Float64Array(3);

/**
 * The forearm roll at this tick, on the SAME hold → prep → technique shape as the arm position.
 *
 * A roll driven straight off `rollTau` snaps from the full 180° back to 0 at every slot boundary,
 * because `τ = 0` through the hold means "not yet rolled" while the arm is physically still
 * pronated from the last kime. Measured: a 61° step on `lowerarm_twist_02` **at the 960 rung** —
 * 1 ms — which is the signature of a discontinuity rather than fast motion, and is why the bake
 * gate could not be satisfied by spending more rungs on it.
 *
 * The roll unwinds during `t_prep` along with the chamber, which is also what actually happens:
 * you supinate as you pull back, not at the moment you start the punch.
 */
function armRollAt(
  ctx: SolveCtx,
  ip: Interp,
  side: 'L' | 'R',
  tick: number,
  spec: TechniqueSpec,
  thrustFrac: number,
  isWork: boolean,
): number {
  const share = isWork ? 1 : 0.5;
  /* On a CLOSING ceremony slot `moveIndex` is −1, so the "previous" move is the LAST one — the
   * arms are still holding the final kime's roll through `FINAL_HOLD`. Passing `moveIndex − 1`
   * there returns 0 and unwinds 180° of pronation in one tick.
   *
   * The OPENING ceremony is the opposite case and must return 0: at yoi the forearms are neutral,
   * and inheriting the last move's roll rotates them 180° before the kata has started. Both
   * boundaries measured 61° on `lowerarm_twist_02` before this distinction existed. */
  if (ip.ceremonyPhase === 'open') return 0;
  const prevIndex = ip.move === null ? ctx.kata.moves.length - 1 : ip.moveIndex - 1;
  const prevRoll = prevRollOf(ctx, prevIndex, side);
  if (ip.move === null) return prevRoll;

  const slot = ip.slot;
  if (tick < slot.prep.t0) return prevRoll;
  if (tick < slot.transit.t0) {
    /* PREP — unwind to the chamber's zero roll. */
    const u = (tick - slot.prep.t0) / Math.max(1, slot.transit.t0 - slot.prep.t0);
    return prevRoll * (1 - kimeEase(Math.max(0, Math.min(1, u)), TAU_PEAK));
  }
  const rollTau =
    thrustFrac <= 0
      ? 0
      : Math.max(0, Math.min(1, (tauOfSlot(slot, tick) - (1 - thrustFrac)) / thrustFrac));
  return forearmRollDeg(rollTau, spec.rollDeg.v * share, spec.rollWindow);
}

/**
 * The chest-local pole direction at this tick, on the SAME hold → prep → technique shape as the
 * position and the roll. doc 06 §6.2's own instruction, honoured.
 *
 * The pole belongs to the ROLE the arm is playing, and roles swap between moves: an arm that was
 * the hikite (pole `POLE_ZUKI`, elbow down and back) becomes the working arm of a gedan-barai
 * (pole `POLE_GEDAN_BARAI`, elbow out and low). Same wrist position, different bend plane — so
 * without a blend the elbow swings on the boundary tick while the fist does not move at all.
 */
function armPoleAt(
  ctx: SolveCtx,
  ip: Interp,
  side: 'L' | 'R',
  tick: number,
  spec: TechniqueSpec,
): readonly [number, number, number] {
  const cur = spec.poleDirChest as readonly [number, number, number];
  const prevIdx = ip.move === null ? ctx.kata.moves.length - 1 : ip.moveIndex - 1;
  const prev = prevPoleOf(ctx, prevIdx, side) ?? cur;
  if (ip.move === null) return ip.ceremonyPhase === 'open' ? cur : prev;

  const slot = ip.slot;
  if (tick < slot.prep.t0) return prev;
  if (tick >= slot.transit.t0) return cur;
  const u = (tick - slot.prep.t0) / Math.max(1, slot.transit.t0 - slot.prep.t0);
  const a = kimeEase(Math.max(0, Math.min(1, u)), TAU_PEAK);
  return [
    prev[0] + a * (cur[0] - prev[0]),
    prev[1] + a * (cur[1] - prev[1]),
    prev[2] + a * (cur[2] - prev[2]),
  ];
}

/**
 * The pole one arm was using at the end of the previous move.
 *
 * Before move 1 that is the YOI pole — `HIKITE_HIP_A`'s, the same spec `armLocalAt` uses for the
 * opening ceremony. Returning `null` there (and letting the caller fall back to the CURRENT move's
 * pole) makes the pole step-change on the very first boundary: the ceremony holds the arms with
 * `POLE_ZUKI` and move 1 is a gedan-barai with `POLE_GEDAN_BARAI`, so the elbow swings while the
 * fist is still. Measured 47.6° on `upperarm_L` at tick 25728 — the exact failure doc 06 §6.2
 * describes, arriving at the one boundary that has no previous move to inherit from.
 */
function prevPoleOf(
  ctx: SolveCtx,
  moveIndex: number,
  side: 'L' | 'R',
): readonly [number, number, number] | null {
  if (moveIndex < 0) return HIKITE_HIP_A.poleDirChest as readonly [number, number, number];
  const m = ctx.kata.moves[moveIndex]!;
  const spec = side === m.tech.arm ? ctx.techOf[moveIndex]!.spec : hikiteSpecFor(m.hikite);
  return spec === null
    ? (HIKITE_HIP_A.poleDirChest as readonly [number, number, number])
    : (spec.poleDirChest as readonly [number, number, number]);
}

const _clampQ = new Quaternion();

/**
 * §4.11 S12. Clamp every bone into `ROM`, and report the worst saturation.
 *
 * doc 06 §6.4's L9-vs-IK rule exempts the knee and the elbow — their limits are folded into IK
 * step 2 (`midMinDeg`/`midMaxDeg`), so clamping them again would fight the solve that already
 * honoured them. Everything else goes through doc 06 §3.2's swing-twist clamp about its own
 * CONVERTED primary axis.
 */
function clampAllBones(s: Skel): number {
  let worst = 0;
  for (const d of BONE_DEFS) {
    if (CLAMP_EXEMPT_BONES.has(d.index as number)) continue;
    const lim = ROM[d.name];
    if (lim === undefined) continue;
    getLocal(s, d.index, _clampQ);
    const r = clampSwingTwist(_clampQ, d.axisWorld, lim);
    if (r.twistClamped || r.swingClamped) setLocal(s, d.index, _clampQ);
    if (r.saturation > worst) worst = r.saturation;
  }
  forwardKinematics(s);
  return worst;
}

/**
 * Bones the S12 clamp must NOT touch, and why each is exempt.
 *
 *   MID JOINTS (knee, elbow) — doc 06 §6.4's L9-vs-IK rule: their limits are folded into IK step 2
 *   (`midMinDeg`/`midMaxDeg`), so L9 "is a no-op there". Clamping again fights the solve.
 *
 *   A JOINTS (hip, shoulder) — `RomLimit` CANNOT HOLD THEIR RANGE, and `swingTwist.ts`'s header
 *   says so explicitly: the cone is symmetric, doc 06 §3.1's shoulder is +175/−55, and B1 authors
 *   the semi-axis as the SMALLER of the pair so the envelope errs tight. Applying that tight cone
 *   as a hard clamp caps a legitimate 90° shoulder elevation at 55° — a 35° correction on a
 *   correct pose, every tick, and the reconstructed `qS·qT` then flips. Measured: clamping these
 *   took the worst step from 17° to **156°**.
 *
 *   Their real limits are the SIGNED ones, and the contract's answer is `assertSignGate` — a check
 *   that a violation is a solver bug, not a pose to be silently bent. That is what S12 asserts for
 *   these four; the cone clamp governs everything else.
 */
const CLAMP_EXEMPT_BONES: ReadonlySet<number> = new Set<number>([
  /* mid joints — folded into IK step 2 */
  BI.calfL, BI.calfR, BI.lowerarmL, BI.lowerarmR,
  /* A joints — see `SIGN_GATED_BONES`; the cone cannot express their range */
  BI.thighL, BI.thighR, BI.upperarmL, BI.upperarmR,
]);

/**
 * The hand shape one arm was holding at the end of the previous move — the shape to blend FROM.
 *
 * Before move 1 and through the opening ceremony that is `seiken`: doc 02 §2's yoi has both fists
 * closed.
 */
function prevHandShape(ctx: SolveCtx, ip: Interp, side: 'L' | 'R'): HandShape {
  const idx = ip.move === null ? ctx.kata.moves.length - 1 : ip.moveIndex - 1;
  if (idx < 0 || ip.ceremonyPhase === 'open') return 'seiken';
  const m = ctx.kata.moves[idx]!;
  return side === m.tech.arm ? ctx.techOf[idx]!.spec.hand : hikiteShape(m.hikite);
}

/**
 * How far the hand shape has blended at `tick`: 0 through the hold, easing to 1 across the prep,
 * and 1 for the whole technique. The same three-phase shape as the chamber and the roll.
 */
function handBlendTau(ip: Interp, tick: number): number {
  if (ip.move === null) return 1;
  const slot = ip.slot;
  if (tick < slot.prep.t0) return 0;
  if (tick >= slot.transit.t0) return 1;
  return (tick - slot.prep.t0) / Math.max(1, slot.transit.t0 - slot.prep.t0);
}

/** The roll one arm was left holding at the end of a move. */
function prevRollOf(ctx: SolveCtx, moveIndex: number, side: 'L' | 'R'): number {
  if (moveIndex < 0) return 0;
  const m = ctx.kata.moves[moveIndex]!;
  const isWork = side === m.tech.arm;
  const spec = isWork ? ctx.techOf[moveIndex]!.spec : hikiteSpecFor(m.hikite);
  if (spec === null) return 0;
  return spec.rollDeg.v * (isWork ? 1 : 0.5);
}


/** doc 02 §8 S2 / doc 06 §6.5: the head reaches the new heading before the hips start moving. */
function headLeadAlpha(tau: number): number {
  /* The hips hold to 0.55 and snap; the head starts at 0.15 and is done by 0.75. Both are
   * `holdThenSnap` shapes, so the head is ALWAYS ahead — the invariant doc 02 §8 S2 states. */
  return holdThenSnap(tau, 0.15);
}

/** doc 02 §7: kiai onset coincident with `t_kime`, length 0.25–0.40 s. */
function kiaiEnvelope(tau: number): number {
  if (tau < 0.92) return 0;
  const u = (tau - 0.92) / 0.08;
  return Math.sin(Math.min(1, u) * Math.PI);
}

/**
 * The support polygon as two XZ points, from the ankles the legs were ACTUALLY planted to.
 *
 * Taking them from the interpolated set rather than re-deriving from the plan matters mid-step:
 * doc 06 §2.2's weight split divides the inter-foot line, and during a step that line is between
 * where the feet ARE, not between where they will be.
 */
function supportXZ(
  ankles: Readonly<Record<'L' | 'R', readonly [number, number, number]>>,
  frontFoot: 'L' | 'R',
) {
  const front = ankles[frontFoot];
  const rear = ankles[frontFoot === 'L' ? 'R' : 'L'];
  return {
    front: [front[0], front[2]] as readonly [number, number],
    rear: [rear[0], rear[2]] as readonly [number, number],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * §4.11 S5 — the sparse semantic keys.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 02 §1.4's four phase boundaries plus the move start. S5: one key per phase per slot. */
export const PHASES: readonly PoseKey['phase'][] = Object.freeze([
  'start', 'prep', 'mid', 'kime', 'hold',
]);

/**
 * §4.11 S5. One `PoseKey` per phase per move slot, ticks strictly increasing.
 *
 * These are SPARSE and SEMANTIC — §3.9: "Authored/solved. NEVER shipped to the runtime." They
 * exist so a fix agent can look at the five poses a move is built from, and so `tests/solve/stages`
 * can assert stage N's output is admissible as stage N+1's input without walking 9000 frames.
 */
export function buildKeyPoses(ctx: SolveCtx, s: Skel): readonly PoseKey[] {
  const out: PoseKey[] = [];
  const slots = ctx.timeline.slots;
  /* Strictly increasing across the WHOLE clip (S5), not per slot — the `hold` key of move N and
   * the `start` key of move N+1 are adjacent, and a per-slot cursor cannot see the collision. */
  let prev = -1;

  for (let si = 0; si < ctx.timeline.moveSlots.length; si++) {
    const slot = ctx.timeline.moveSlots[si]!;

    /* `hold` is the PREVIOUS kime sustained (doc 02 §1.4), so it lives in the NEXT slot's hold
     * window — not at this slot's end, which is the kime tick itself. Putting it at `t1 - 1`
     * makes it identical to `kime` (the pose has not moved) AND collides with the next slot's
     * `start`, which is what S5's strictly-increasing rule catches. The next slot may be the
     * closing ceremony's FINAL_HOLD, which is exactly the right pose for the last move. */
    const globalIndex = slots.indexOf(slot);
    const next = slots[globalIndex + 1];
    const holdTick =
      next === undefined
        ? slot.t1 - 1
        : next.hold.t0 + Math.floor((next.hold.t1 - next.hold.t0) / 2);

    const ticks: readonly [PoseKey['phase'], number][] = [
      ['start', slot.t0],
      ['prep', slot.prep.t0],
      ['mid', slot.transit.t0],
      ['kime', slot.kimeTick],
      ['hold', holdTick],
    ];
    for (const [phase, rawTick] of ticks) {
      /* A 0.05 s window at T3 can still collapse two phases onto one tick; nudging forward keeps
       * the ordering S5 asserts, at a cost of at most one tick (0.26 ms). */
      const tick = Math.max(rawTick, prev + 1);
      prev = tick;
      solvePoseAtTick(ctx, tick, s);
      out.push({
        tick,
        phase,
        moveN: slot.moveN,
        q: Float32Array.from(s.localQuat),
        rootPos: Float32Array.from(s.rootPos),
        rootQuat: Float32Array.from(s.rootQuat),
        chan: Float32Array.from(_chan),
      });
    }
  }
  return Object.freeze(out);
}

/** A fresh skeleton for a compile. Re-exported so `compile.ts` has one import for the solve. */
export { newSkel, ARM_LEN_M, BONE_COUNT };
