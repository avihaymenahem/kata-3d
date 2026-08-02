/**
 * B3 SOLVER — `src/solve/spine.ts`
 *
 * `solveSpineWhip` and `solvePelvisTilt` — doc 06 §6.4 layers L1/L2, NORMATIVE.
 * ARCHITECTURE.md §4.11 S7 (hip drive) and S8 (spine whip).
 *
 * ═══ THE LAG IS THE POINT ═══════════════════════════════════════════════════════════════════
 * doc 06 §6.4 L2: `spine_i.yaw += −c_i · pelvisYawVelocity · τ`, `τ = 0.055 s`,
 * `c = [0.10, 0.18, 0.26, 0.30]` for `spine_01 → chest` (Σ = 0.84) — "the transient shoulder
 * *lag* behind the hips is what reads as karate. Zero lag = 'aerobics'."
 *
 * Read the sign carefully. The term is NEGATIVE and proportional to the pelvis yaw VELOCITY, so
 * while the hips are accelerating the chest is left BEHIND them, and when the hips stop
 * (`velocity → 0`) the lag collapses to zero and the chest catches up. That is the whip. Making
 * the term proportional to the pelvis yaw ANGLE instead — the natural mis-implementation — gives
 * a constant offset that never resolves, i.e. a permanently twisted torso.
 *
 * The velocity comes from `holdThenSnapVel`, ANALYTIC (§6.3, §9.1 A-2). It is never differenced
 * off a baked pose; `FINITE_DIFF_NAMED` and `FINITE_DIFF_ACCEL` are grep-banned in this tree.
 *
 * ═══ S8'S CAP IS 15°, AND IT IS A REAL BIOMECHANICAL LIMIT ══════════════════════════════════
 * doc 04 §2.1's X-factor: `|yaw(shoulder) − yaw(pelvis)| ≤ 15°` at every tick. That is the
 * separation a trained torso actually achieves; more reads as a golf swing. S14 then re-checks
 * the COMPOSED value at the corners of the whole legal layer-weight box with 2° of margin
 * (`CHEST_YAW_ENVELOPE_CAP_DEG = 17`), because a look-dev slider at `koshi = 1.5` multiplies the
 * lag by 1.5 and a cap that only held at weight 1.0 would not be a cap.
 */

import { Quaternion, Vector3 } from 'three';

import {
  CHEST_YAW_ENVELOPE_CAP_DEG,
  DEG,
  LAYER_WEIGHT_BOUNDS,
  RAD,
  holdThenSnap,
  holdThenSnapVel,
} from '../contracts';
import { BI, type Skel, getLocal, setLocal } from './skeleton';

/**
 * The whip's cap AT WEIGHT 1.0 — `CHEST_YAW_ENVELOPE_CAP_DEG / LAYER_WEIGHT_BOUNDS.koshi.max`.
 *
 * NOT doc 04 §2.1's 15° directly, and the difference is the whole point of §6.5's interlock 1.
 * §2.1's 15° is the largest separation a torso should ever SHOW; §3.9 gates the composed value at
 * 17° across the **whole legal weight box**, and `koshi` reaches 1.5. A base whip of 15° therefore
 * composes to 22.5° at the box corner and fails S14 — which it did, measured, at exactly 22.5.
 *
 * So the base is `17 / 1.5 = 11.33°`: the release pose sits comfortably inside doc 04's limit, and
 * a look-dev slider pushed to its maximum lands exactly on the envelope rather than through it.
 * That is what makes the weight bounds a real guarantee instead of a default nobody may move.
 */
export const WHIP_CAP_DEG: number =
  CHEST_YAW_ENVELOPE_CAP_DEG / LAYER_WEIGHT_BOUNDS.koshi.max;

/** doc 06 §6.4 L2, verbatim. `spine_01 → spine_02 → spine_03 → chest`. Σ = 0.84. */
export const WHIP_COEFF: readonly number[] = Object.freeze([0.1, 0.18, 0.26, 0.3]);
/** doc 06 §6.4 L2's lag time constant, seconds. */
export const WHIP_TAU_S = 0.055;
/** The four bones `WHIP_COEFF` indexes, in the same order. */
export const WHIP_BONES: readonly number[] = Object.freeze([
  BI.spine01, BI.spine02, BI.spine03, BI.chest,
]);

const _q = new Quaternion();
const _qd = new Quaternion();
const _up = new Vector3(0, 1, 0);

/**
 * doc 06 §6.4 L1. Set the pelvis's world yaw for a move, driven by `holdThenSnap`.
 *
 * `psiStartDeg`/`psiEndDeg` are WORLD degrees — the caller has already taken them through
 * `psiWorldDeg`, because ψ is a doc-04 §0 authored yaw and flips (§2.1).
 *
 * S7's exit invariant is doc 01 §9.5's X3 predicate: `|ψ(0.5) − ψ_start| ≤ 8°` for every move.
 * `holdThenSnap` holds flat until τ = 0.55, so the value at τ = 0.5 is exactly ψ_start and the
 * predicate passes with 8° to spare — by construction, not by tuning.
 */
export function pelvisYawWorldDeg(tau: number, psiStartDeg: number, psiEndDeg: number): number {
  /* `holdThenSnap` is read straight from the frozen contract, not through `channels.ts`'s
   * `pelvisYawAlpha` re-export — same function, one fewer import edge, and §3.3's identity
   * requirement is about which implementation runs, not which module it was reached through. */
  return psiStartDeg + holdThenSnap(tau) * (psiEndDeg - psiStartDeg);
}

/**
 * doc 06 §6.4 L1's angular velocity, deg/s. ANALYTIC — `holdThenSnapVel` over the window.
 * This is also what `chan.pelvisYawRate` carries (§3.9).
 */
export function pelvisYawRateDegS(tau: number, dPsiDeg: number, windowS: number): number {
  if (windowS <= 1e-9) return 0;
  return (holdThenSnapVel(tau) * dPsiDeg) / windowS;
}

export interface WhipResult {
  /** Per-bone applied lag in degrees, in `WHIP_BONES` order. */
  readonly lagDeg: readonly number[];
  /** `|yaw(chest) − yaw(pelvis)|` after the whip, degrees. S8 gates at `<= 15`. */
  readonly xFactorDeg: number;
  /** True if the cap bound. Recorded, not hidden — a capped whip is a tuning signal. */
  readonly capped: boolean;
}

/**
 * §4.11 S8. Apply doc 06 §6.4 L2's counter-rotation to the four spine bones.
 *
 * Mutates `s`; the caller re-runs FK. Returns the X-factor S8 asserts.
 *
 * The cap is applied to the TOTAL lag and then redistributed proportionally, rather than clamping
 * each bone independently: clamping per bone changes the SHAPE of the curve along the spine (the
 * distal bones bind first), which is visible as a kink at `spine_03` even when the total is legal.
 */
export function solveSpineWhip(s: Skel, pelvisYawRateDegS_: number): WhipResult {
  const raw = WHIP_COEFF.map((c) => -c * pelvisYawRateDegS_ * WHIP_TAU_S);
  const total = raw.reduce((a, v) => a + v, 0);

  let scale = 1;
  let capped = false;
  if (Math.abs(total) > WHIP_CAP_DEG) {
    scale = WHIP_CAP_DEG / Math.abs(total);
    capped = true;
  }

  const lagDeg = raw.map((v) => v * scale);
  for (let i = 0; i < WHIP_BONES.length; i++) {
    const b = WHIP_BONES[i]!;
    getLocal(s, b, _q);
    _qd.setFromAxisAngle(_up, lagDeg[i]! * DEG);
    _q.multiply(_qd);
    setLocal(s, b, _q);
  }

  return { lagDeg, xFactorDeg: Math.abs(total * scale), capped };
}

/**
 * The measured X-factor off a resolved pose: the world-yaw difference between chest and pelvis.
 *
 * Measured from the bones' world quaternions rather than accumulated from the lag terms, so S8
 * checks the POSE rather than the intent — a whip that another stage partly undid still reports
 * the truth.
 */
export function xFactorDeg(s: Skel): number {
  const yc = worldYawOf(s, BI.chest);
  const yp = worldYawOf(s, BI.pelvis);
  let d = yc - yp;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return Math.abs(d);
}

/** A bone's world yaw about +Y, degrees. Extracted from its world quaternion, not from Eulers. */
export function worldYawOf(s: Skel, b: number): number {
  _q.set(s.worldQuat[b * 4]!, s.worldQuat[b * 4 + 1]!, s.worldQuat[b * 4 + 2]!, s.worldQuat[b * 4 + 3]!);
  /* Project the bone's forward (−Z) onto XZ and read its bearing. Robust at any pitch, unlike a
   * quaternion-to-Euler conversion, which gimbal-locks exactly where a deep bow puts the chest. */
  const f = new Vector3(0, 0, -1).applyQuaternion(_q);
  return Math.atan2(-f.x, -f.z) * RAD;
}

/**
 * doc 01 §3.3 / §10. Posterior pelvis tilt, `+` = pubis up, applied about the character's
 * left-right axis.
 *
 * A separate entry point from `solveStance`'s initial tilt because S7 re-applies it AFTER the hip
 * drive: the hip yaw is a rotation about Y and the tilt is about X, and applying the tilt first
 * then yawing it carries the tilt out of the sagittal plane by `sin(ψ)` — 0.7° at ψ = 45°, which
 * is small but accumulates over 21 moves into a visibly tipped pelvis.
 */
export function solvePelvisTilt(s: Skel, tiltPostDeg: number, yawWorldDeg: number): void {
  _q.setFromAxisAngle(_up, yawWorldDeg * DEG);
  _qd.setFromAxisAngle(new Vector3(1, 0, 0), -tiltPostDeg * DEG);
  /* Yaw FIRST, then tilt in the yawed frame — post-multiplication is the bone's own frame. */
  _q.multiply(_qd);
  setLocal(s, BI.pelvis, _q);
}
