/**
 * B3 SOLVER — `src/solve/gaze.ts`
 *
 * `solveGaze` and the blink schedule — doc 06 §6.5. ARCHITECTURE.md §4.11 S11.
 *
 * ═══ THE EYES ARRIVE BEFORE THE BODY. THAT IS THE DOCTRINE AND THE 90 ms. ═══════════════════
 * doc 06 §6.5: "gaze lead — target sampled **+0.090 s ahead** on the authored path. karate
 * doctrine: the eyes arrive before the body. Without lead, turns look reactive."
 *
 * It is also doc 02 §8's S2 rule from the other side: "Head/eyes reach the new heading BEFORE the
 * hips begin to rotate: `t_head = t_prep_start`, `t_hip_start = t_prep_start + 0.10 s`." A turn
 * where the head and the hips start together is the single clearest "this is an animation, not a
 * karateka" tell in the whole clip, and it costs nothing to get right — the fix is one lead term.
 *
 * ═══ THE BLINK SCHEDULE IS SEEDED FROM THE TRACK HASH, NOT FROM A CLOCK ════════════════════
 * `Math.random` is banned across this tree (§3 determinism ledger, `NONDETERMINISM`), and a blink
 * that lands on a different tick each compile would break `tests/solve/repeat.test.ts`'s
 * byte-identical requirement. So the jitter is a deterministic PRNG seeded from `PoseTrack.hash`:
 * genuinely irregular, and identical on every recompile of the same inputs.
 *
 * Blinks are SUPPRESSED within ±0.15 s of a kime (doc 06 §6.5). A blink on the kime frame is the
 * one place a viewer is guaranteed to be looking, and it reads as a flinch.
 */

import { Quaternion, Vector3 } from 'three';

import { DEG, RAD, TICK_HZ, criticalDampClosed, secToTick } from '../contracts';
import { ROM } from '../data';
import { BI, type Skel, getLocal, getWorldQuat, setLocal } from './skeleton';

/** doc 06 §6.5's chain weights. Σ = 1.0 — S11's exit invariant. */
export const GAZE_CHAIN: readonly { readonly bone: number; readonly w: number }[] = Object.freeze([
  { bone: BI.chest, w: 0.15 },
  { bone: BI.neck, w: 0.35 },
  { bone: BI.head, w: 0.5 },
]);

/** doc 06 §6.5 clamps, degrees. Up is limited by the gi collar and cervical extension. */
export const GAZE_YAW_MAX_DEG = 80;
export const GAZE_PITCH_MIN_DEG = -40;
export const GAZE_PITCH_MAX_DEG = 25;
/** doc 06 §6.5 eye residual clamps. The real limit lives in `ROM.eye_*`; these are the doc's. */
export const EYE_YAW_MAX_DEG = 32;
export const EYE_PITCH_MIN_DEG = -18;
export const EYE_PITCH_MAX_DEG = 20;

/** doc 06 §6.5: head spring, critically damped, ω = 14 rad/s, ζ = 1.0, ~0.30 s settle. */
export const HEAD_SPRING_OMEGA = 14;
/** doc 06 §6.5: the eyes do NOT ease. 0.030 s latency, then instant. */
export const EYE_SACCADE_LATENCY_S = 0.03;
/** doc 06 §6.5: the gaze target is sampled this far ahead on the authored path. */
export const GAZE_LEAD_S = 0.09;
/** doc 02 §8 S2: the head reaches the new heading 0.10 s before the hips start. */
export const HEAD_LEADS_HIPS_S = 0.1;

/** doc 06 §6.5: "if `|yaw| > 45°` shift 0.05 of the weight from `head` to `neck_01`". */
export const OWL_NECK_YAW_DEG = 45;
export const OWL_NECK_SHIFT = 0.05;

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _fwd = new Vector3();

export interface GazeSolve {
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly eyeYawDeg: number;
  readonly eyePitchDeg: number;
  /** Σ of the applied chain weights. S11 gates at exactly 1.0. */
  readonly weightSum: number;
}

/**
 * §4.11 S11. Aim the look-at chain at `targetWorld`, then give the eyes the residual.
 *
 * Mutates `s`; the caller re-runs FK. doc 06 §6.5's own algorithm, with its own clamps.
 */
export function solveGaze(
  s: Skel,
  targetWorld: readonly [number, number, number],
  /**
   * Degrees of chest yaw still available before doc 04 §2.1's X-factor cap.
   *
   * ═══ TWO DOCS WANT THE SAME 15° ════════════════════════════════════════════════════════════
   * doc 06 §6.5 gives the chest 0.15 of the look-at, so an 80° gaze twists the torso by 12°.
   * doc 04 §2.1 caps torso separation at 15° — and the koshi whip already spends up to all of it.
   * Together they reach ~25°, which S14 then scales by the 1.5 weight-box corner to 37°.
   *
   * Neither doc is wrong; they were written about different things (a look-at and a hip drive)
   * and nobody added them up. The resolution keeps BOTH intents: the gaze gets whatever chest
   * budget the whip has not used, and whatever it cannot take there is redistributed DOWN THE
   * CHAIN to neck and head — which is doc 06 §6.5's own remedy, already used for the owl-neck
   * gate. The eyes still finish on target, because they take the residual after the head.
   */
  chestBudgetDeg = GAZE_YAW_MAX_DEG,
): GazeSolve {
  /* `d = normalize(target − head.worldPosition)`, expressed in the CHEST's frame — doc 06 §6.5's
   * `sphericalInFrame(d, chest.worldQuat)`. Measuring in the chest frame is what makes the yaw a
   * TORSO-RELATIVE turn rather than a world bearing, which is what the clamps are about. */
  _v.set(
    targetWorld[0] - s.worldPos[BI.head * 3]!,
    targetWorld[1] - s.worldPos[BI.head * 3 + 1]!,
    targetWorld[2] - s.worldPos[BI.head * 3 + 2]!,
  );
  if (_v.lengthSq() < 1e-12) {
    return { yawDeg: 0, pitchDeg: 0, eyeYawDeg: 0, eyePitchDeg: 0, weightSum: 1 };
  }
  _v.normalize();
  getWorldQuat(s, BI.chest, _q2);
  _q2.invert();
  _v.applyQuaternion(_q2);

  /* Bind forward is −Z, so a target straight ahead gives yaw 0. */
  let yawDeg = Math.atan2(-_v.x, -_v.z) * RAD;
  let pitchDeg = Math.asin(Math.max(-1, Math.min(1, _v.y))) * RAD;
  yawDeg = clamp(yawDeg, -GAZE_YAW_MAX_DEG, GAZE_YAW_MAX_DEG);
  pitchDeg = clamp(pitchDeg, GAZE_PITCH_MIN_DEG, GAZE_PITCH_MAX_DEG);

  /* doc 06 §6.5's owl-neck gate: past 45° the head gives 0.05 of its share to the neck. */
  const shift = Math.abs(yawDeg) > OWL_NECK_YAW_DEG ? OWL_NECK_SHIFT : 0;
  const weights = GAZE_CHAIN.map((c) =>
    c.bone === BI.head ? c.w - shift : c.bone === BI.neck ? c.w + shift : c.w,
  );

  /* The chest budget, redistributed down the chain. See the `chestBudgetDeg` note above. */
  const chestIdx = GAZE_CHAIN.findIndex((c) => c.bone === BI.chest);
  if (chestIdx >= 0 && Math.abs(yawDeg) > 1e-9) {
    const want = weights[chestIdx]!;
    const allowed = Math.max(0, Math.min(want, chestBudgetDeg / Math.abs(yawDeg)));
    const freed = want - allowed;
    weights[chestIdx] = allowed;
    /* Down the chain, not dropped: neck takes 40 % and head 60 %, matching their 0.35/0.50 ratio,
     * so the SUM stays 1.0 and S11's exit invariant holds. */
    const neckIdx = GAZE_CHAIN.findIndex((c) => c.bone === BI.neck);
    const headIdx = GAZE_CHAIN.findIndex((c) => c.bone === BI.head);
    if (neckIdx >= 0) weights[neckIdx] = weights[neckIdx]! + freed * 0.4;
    if (headIdx >= 0) weights[headIdx] = weights[headIdx]! + freed * 0.6;
  }
  const weightSum = weights.reduce((a, w) => a + w, 0);

  let achievedYaw = 0;
  let achievedPitch = 0;
  for (let i = 0; i < GAZE_CHAIN.length; i++) {
    const c = GAZE_CHAIN[i]!;
    const w = weights[i]!;
    getLocal(s, c.bone, _q);
    /* doc 06 §6.5: `eulerZXY(w*pitch about X, w*yaw about Y, 0)`, PRE-multiplied. */
    _q2.setFromAxisAngle(_v.set(0, 1, 0), w * yawDeg * DEG);
    _q.premultiply(_q2);
    _q2.setFromAxisAngle(_v.set(1, 0, 0), w * pitchDeg * DEG);
    _q.premultiply(_q2);
    setLocal(s, c.bone, _q);
    achievedYaw += w * yawDeg;
    achievedPitch += w * pitchDeg;
  }

  const eyeRom = ROM.eye_L;
  const eyeYawDeg = clamp(
    yawDeg - achievedYaw,
    -Math.min(EYE_YAW_MAX_DEG, eyeRom.swingConeXDeg),
    Math.min(EYE_YAW_MAX_DEG, eyeRom.swingConeXDeg),
  );
  const eyePitchDeg = clamp(pitchDeg - achievedPitch, EYE_PITCH_MIN_DEG, EYE_PITCH_MAX_DEG);

  for (const eye of [BI.eyeL, BI.eyeR]) {
    _q.setFromAxisAngle(_v.set(0, 1, 0), eyeYawDeg * DEG);
    _q2.setFromAxisAngle(_fwd.set(1, 0, 0), eyePitchDeg * DEG);
    _q.multiply(_q2);
    setLocal(s, eye, _q);
  }

  return { yawDeg, pitchDeg, eyeYawDeg, eyePitchDeg, weightSum };
}

/**
 * The gaze target for a move: a point on the new heading, at eye height, `GAZE_LEAD_S` ahead.
 *
 * "Ahead on the authored path" means ahead in TIME, not in space: the caller passes the τ it has
 * already advanced by the lead, and this turns the resulting heading into a world point far
 * enough away that the eyes converge to parallel (10 m; a nearer point crosses the eyes).
 */
export const GAZE_DISTANCE_M = 10;

export function gazeTargetFor(
  headWorld: readonly [number, number, number],
  headingWorldDeg: number,
): readonly [number, number, number] {
  const r = headingWorldDeg * DEG;
  return [
    headWorld[0] - GAZE_DISTANCE_M * Math.sin(r),
    headWorld[1],
    headWorld[2] - GAZE_DISTANCE_M * Math.cos(r),
  ];
}

/** doc 06 §6.5's head spring, applied to a heading in degrees. `criticalDampClosed`, ω = 14. */
export function headSpringAlpha(tSinceStepS: number): number {
  return criticalDampClosed(tSinceStepS, HEAD_SPRING_OMEGA);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * BLINK. Deterministic, seeded from the track hash.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 06 §6.5: every 3.5 s ± 1.5 s jitter, 0.11 s duration. */
export const BLINK_PERIOD_S = 3.5;
export const BLINK_JITTER_S = 1.5;
export const BLINK_DURATION_S = 0.11;
/** doc 06 §6.5: suppress during kime ±0.15 s. */
export const BLINK_KIME_GUARD_S = 0.15;

export interface Blink {
  readonly startTick: number;
  readonly endTick: number;
}

/**
 * A small deterministic PRNG. `Math.random` is banned in this tree; the seed is the track hash, so
 * the schedule is irregular AND identical on every recompile of the same inputs.
 *
 * mulberry32 — 4 lines, well-distributed, and its state is one 32-bit word, which is what keeps
 * the whole blink schedule reproducible from a 16-character hash.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fold a hex hash into a 32-bit seed. */
export function seedFromHash(hash: string): number {
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = (Math.imul(h, 31) + hash.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * The whole clip's blink schedule. Deterministic given `hash`.
 *
 * `kimeTicks` are the ticks to keep clear; a blink whose window overlaps one is pushed past the
 * guard rather than dropped, so the eyes still blink at a natural rate through a dense passage
 * instead of going glassy for six seconds.
 */
export function buildBlinkSchedule(
  durationTicks: number,
  kimeTicks: readonly number[],
  hash: string,
): readonly Blink[] {
  const rnd = mulberry32(seedFromHash(hash));
  const out: Blink[] = [];
  const durTicks = secToTick(BLINK_DURATION_S);
  const guard = secToTick(BLINK_KIME_GUARD_S);
  const sorted = [...kimeTicks].sort((a, b) => a - b);

  let t = secToTick(BLINK_PERIOD_S * rnd());
  while (t + durTicks < durationTicks) {
    let start = t;
    /* Push past any kime guard the window would land inside. At most a few iterations: the
     * guards are 0.30 s wide and the period is 3.5 s. */
    for (let guardPass = 0; guardPass < 8; guardPass++) {
      const hit = sorted.find((kt) => start < kt + guard && start + durTicks > kt - guard);
      if (hit === undefined) break;
      start = hit + guard + 1;
    }
    if (start + durTicks >= durationTicks) break;
    out.push({ startTick: start, endTick: start + durTicks });
    const jitter = (rnd() * 2 - 1) * BLINK_JITTER_S;
    t = start + secToTick(BLINK_PERIOD_S + jitter);
  }
  return Object.freeze(out);
}

/** `chan.blink` at a tick: 0 open, 1 fully closed. A raised cosine over the blink window. */
export function blinkAt(schedule: readonly Blink[], tick: number): number {
  for (const b of schedule) {
    if (tick < b.startTick || tick >= b.endTick) continue;
    const u = (tick - b.startTick) / (b.endTick - b.startTick);
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
  }
  return 0;
}

/** Ticks per second, re-exported so the blink maths has one clock source. */
export const TICKS_PER_S = TICK_HZ;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
