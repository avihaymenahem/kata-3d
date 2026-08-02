/**
 * B3 SOLVER — `src/solve/com.ts`
 *
 * `bodyCOM` and `solveCOM` — doc 06 §2.1–§2.2, NORMATIVE. ARCHITECTURE.md §4.11 S9.
 *
 * ═══ THE WEIGHT SPLIT DIVIDES THE INTER-FOOT LINE **INVERSELY**. ════════════════════════════
 * doc 06 §2.2, and it is the single most inverted-by-accident fact in the whole rig:
 *
 *     front foot bears f  ⇒  COM_xz = P_front + (1 − f)·(P_rear − P_front)
 *
 * A 60/40 zenkutsu puts the COM **40 %** of the way from the front foot to the rear — NOT 60 %.
 * The doc spells it out ("Do not put the COM at 70 %") because the intuitive reading is exactly
 * backwards: more load on the front foot means the COM sits CLOSER to it, so the fraction of the
 * span measured FROM the front foot is the REAR share. Getting it backwards moves the COM 0.108 H
 * (10 cm) in zenkutsu — a visibly back-weighted stance that still passes every scalar stance
 * metric, because `S`, `pelvisY` and both knee angles are unchanged.
 *
 * The same relation is already B1's `PELVIS_AHEAD_OF_C_BY_LOAD_H`, and `tests/data/derived`
 * asserts the two forms agree to 4e-4. This file is the DYNAMIC half: it moves the pelvis until
 * the measured COM lands on the target the load split implies.
 *
 * ═══ THREE ITERATIONS, GAIN 0.90, AND NO CONVERGENCE LOOP ═══════════════════════════════════
 * doc 06 §2.2 derives the gain: the mass below the pelvis that does NOT translate with it once
 * the feet are pinned is shanks + feet + ~½ thighs ≈ 0.11 M, so `∂COM/∂pelvis ≈ 0.89` and the
 * exact inverse gain is 1.12 — which oscillates. 0.90 converges monotonically in ≤ 3 iterations.
 *
 * Iterating to convergence instead would make the result depend on how many iterations the
 * tolerance happened to need, which is frame-rate-dependent jitter by another name (doc 06 §6.4's
 * L9-vs-IK rule states the same principle for the clamp pass). Three, then accept and REPORT.
 */

import type { Handedness } from '../contracts';
import { BONE_ORDER, H, boneIndex } from '../contracts';
import { SEG_MASS } from '../data';
import { type Skel, forwardKinematics } from './skeleton';

/**
 * doc 06 §2.1's segment table, mapped onto bone SPANS.
 *
 * Each row is `[proximal bone, distal bone, mass fraction]` and the segment's COM sits at
 * `comFrac` along the span. The de Leva percentages come from B1's `SEG_MASS` verbatim — the
 * fractions here are only the LONGITUDINAL positions, which doc 06 §2 publishes separately.
 */
interface SegmentRow {
  readonly name: string;
  readonly proximal: number;
  readonly distal: number;
  /** Fraction of body mass, 0..1. */
  readonly massFrac: number;
  /** COM position along proximal->distal, 0..1. de Leva 1996 Table 4, male. */
  readonly comFrac: number;
}

const bi = (n: string): number => boneIndex(n as (typeof BONE_ORDER)[number]);
const pct = (k: string): number => SEG_MASS[k]!.v / 100;

const SEGMENTS: readonly SegmentRow[] = Object.freeze([
  /* Trunk is carried as three de Leva sub-segments so a spine whip moves the COM, which a single
   * pelvis->chest rod would not. Their masses sum to `SEG_MASS.trunk` (15.96 + 16.33 + 11.17 =
   * 43.46), which `tests/solve/stances.test.ts` asserts rather than assumes. */
  { name: 'trunkLow', proximal: bi('pelvis'), distal: bi('spine_02'), massFrac: pct('trunkLow'), comFrac: 0.61 },
  { name: 'trunkMid', proximal: bi('spine_02'), distal: bi('chest'), massFrac: pct('trunkMid'), comFrac: 0.45 },
  { name: 'trunkUpper', proximal: bi('chest'), distal: bi('neck_01'), massFrac: pct('trunkUpper'), comFrac: 0.5 },
  { name: 'head', proximal: bi('neck_01'), distal: bi('head_end'), massFrac: pct('head'), comFrac: 0.6 },
  { name: 'upperarm_L', proximal: bi('upperarm_L'), distal: bi('lowerarm_L'), massFrac: pct('upperarm'), comFrac: 0.577 },
  { name: 'upperarm_R', proximal: bi('upperarm_R'), distal: bi('lowerarm_R'), massFrac: pct('upperarm'), comFrac: 0.577 },
  { name: 'forearm_L', proximal: bi('lowerarm_L'), distal: bi('hand_L'), massFrac: pct('forearm'), comFrac: 0.457 },
  { name: 'forearm_R', proximal: bi('lowerarm_R'), distal: bi('hand_R'), massFrac: pct('forearm'), comFrac: 0.457 },
  { name: 'hand_L', proximal: bi('hand_L'), distal: bi('fingers_end_L'), massFrac: pct('hand'), comFrac: 0.79 },
  { name: 'hand_R', proximal: bi('hand_R'), distal: bi('fingers_end_R'), massFrac: pct('hand'), comFrac: 0.79 },
  { name: 'thigh_L', proximal: bi('thigh_L'), distal: bi('calf_L'), massFrac: pct('thigh'), comFrac: 0.41 },
  { name: 'thigh_R', proximal: bi('thigh_R'), distal: bi('calf_R'), massFrac: pct('thigh'), comFrac: 0.41 },
  { name: 'shank_L', proximal: bi('calf_L'), distal: bi('foot_L'), massFrac: pct('shank'), comFrac: 0.44 },
  { name: 'shank_R', proximal: bi('calf_R'), distal: bi('foot_R'), massFrac: pct('shank'), comFrac: 0.44 },
  { name: 'foot_L', proximal: bi('foot_L'), distal: bi('toe_end_L'), massFrac: pct('foot'), comFrac: 0.44 },
  { name: 'foot_R', proximal: bi('foot_R'), distal: bi('toe_end_R'), massFrac: pct('foot'), comFrac: 0.44 },
]);

/** Σ of every row's `massFrac`. Should be ~1; the shortfall is the unmodelled neck/ribcage mass. */
export const SEGMENT_MASS_TOTAL: number = SEGMENTS.reduce((a, r) => a + r.massFrac, 0);

/**
 * Whole-body centre of mass, WORLD metres. `Σ mᵢ·pᵢ / Σ mᵢ`.
 *
 * Normalised by the ACTUAL mass total rather than by 1.0, so a row added or removed changes the
 * weighting rather than silently scaling the whole COM toward the origin.
 */
export function bodyCOM(s: Skel, out: Float64Array): Float64Array {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const r of SEGMENTS) {
    const px = s.worldPos[r.proximal * 3]!;
    const py = s.worldPos[r.proximal * 3 + 1]!;
    const pz = s.worldPos[r.proximal * 3 + 2]!;
    const dx = s.worldPos[r.distal * 3]! - px;
    const dy = s.worldPos[r.distal * 3 + 1]! - py;
    const dz = s.worldPos[r.distal * 3 + 2]! - pz;
    x += r.massFrac * (px + r.comFrac * dx);
    y += r.massFrac * (py + r.comFrac * dy);
    z += r.massFrac * (pz + r.comFrac * dz);
  }
  out[0] = x / SEGMENT_MASS_TOTAL;
  out[1] = y / SEGMENT_MASS_TOTAL;
  out[2] = z / SEGMENT_MASS_TOTAL;
  return out;
}

/** `COM_y / H` at the current pose. doc 06 §2.1's unit test: `|COM_y/H − 0.568| < 0.008` at bind. */
export function comHeightH(s: Skel): number {
  const p = new Float64Array(3);
  bodyCOM(s, p);
  return p[1]! / H;
}

/**
 * doc 06 §2.2's INVERSE relation. `loadFrontPct` is a percentage (doc's own unit).
 *
 * Returns the COM's target XZ, world metres.
 */
export function comTargetXZ(
  frontFootXZ: readonly [number, number],
  rearFootXZ: readonly [number, number],
  loadFrontPct: number,
): readonly [number, number] {
  const f = loadFrontPct / 100;
  /* `P_front + (1 − f)·(P_rear − P_front)`. At f = 1 the COM sits ON the front foot. */
  return [
    frontFootXZ[0] + (1 - f) * (rearFootXZ[0] - frontFootXZ[0]),
    frontFootXZ[1] + (1 - f) * (rearFootXZ[1] - frontFootXZ[1]),
  ];
}

/** doc 06 §2.2's gain. Exact inverse is 1.12 and oscillates; 0.90 converges monotonically. */
export const COM_GAIN = 0.9;
/** doc 06 §2.2: three iterations, never a convergence loop. */
export const COM_MAX_ITERS = 3;
/** doc 06 §2.2's break tolerance: `0.002 H` = 0.35 cm. S9 gates on the same number. */
export const COM_TOL_H = 0.002;

export interface ComSolve {
  readonly iterations: number;
  /** `|COM_xz − target|` after the last iteration, FracH. S9 gates at `<= 0.002`. */
  readonly errH: number;
  /** Total XZ displacement applied to the root, metres. */
  readonly appliedM: readonly [number, number];
}

/**
 * §4.11 S9. Nudge the root's XZ until the measured COM lands on `targetXZ`.
 *
 * `relegLeg` re-runs the leg IK after each nudge — the feet stay planted, which is what makes the
 * gain derivation valid (the un-translating mass is exactly the pinned lower legs). Callers pass
 * `solveStance`'s leg pass; omitting it makes every segment translate with the pelvis, `∂COM/∂p`
 * becomes 1.0, and a gain of 0.90 then UNDERSHOOTS by 10 % per iteration instead of converging.
 */
export function solveCOM(
  s: Skel,
  targetXZ: readonly [number, number],
  relegLeg?: () => void,
): ComSolve {
  const com = new Float64Array(3);
  let appliedX = 0;
  let appliedZ = 0;
  let errH = 0;
  let iterations = 0;

  for (let k = 0; k < COM_MAX_ITERS; k++) {
    iterations = k + 1;
    bodyCOM(s, com);
    const ex = com[0]! - targetXZ[0];
    const ez = com[2]! - targetXZ[1];
    errH = Math.hypot(ex, ez) / H;
    if (errH < COM_TOL_H) break;

    s.rootPos[0] = s.rootPos[0]! - COM_GAIN * ex;
    s.rootPos[2] = s.rootPos[2]! - COM_GAIN * ez;
    appliedX -= COM_GAIN * ex;
    appliedZ -= COM_GAIN * ez;
    forwardKinematics(s);
    if (relegLeg !== undefined) relegLeg();
  }

  /* Report the error AFTER the last nudge, not before it — the value S9 gates is the residual the
   * pose actually carries, and reporting the pre-nudge error would flatter it by one iteration. */
  bodyCOM(s, com);
  errH = Math.hypot(com[0]! - targetXZ[0], com[2]! - targetXZ[1]) / H;

  return { iterations, errH, appliedM: [appliedX, appliedZ] };
}

/**
 * The COM residual against a target, WITHOUT moving anything.
 *
 * This is what a solve whose pelvis is already placed analytically needs: §2.3 derives
 * `PELVIS_AHEAD_OF_C_H` from doc 06 §2.2's own inverse relation, so the hip is at the converged
 * position by construction and the only useful thing left to do is report how well that closes.
 *
 * `iterations` is reported as 0 — no nudge was applied — which is inside S9's "≤ 3" by the widest
 * possible margin and is the honest number rather than a flattering one.
 */
export function measureCOM(s: Skel, targetXZ: readonly [number, number]): ComSolve {
  const com = new Float64Array(3);
  bodyCOM(s, com);
  return {
    iterations: 0,
    errH: Math.hypot(com[0]! - targetXZ[0], com[2]! - targetXZ[1]) / H,
    appliedM: [0, 0],
  };
}

/**
 * The vertical load share each foot carries, from the COM's position along the inter-foot line.
 * The inverse of `comTargetXZ`, and what `chan.loadL` / `chan.loadR` are baked from.
 */
export function loadShare(
  s: Skel,
  frontFootXZ: readonly [number, number],
  rearFootXZ: readonly [number, number],
  frontSide: Handedness,
): Readonly<Record<Handedness, number>> {
  const com = new Float64Array(3);
  bodyCOM(s, com);
  const dx = rearFootXZ[0] - frontFootXZ[0];
  const dz = rearFootXZ[1] - frontFootXZ[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return { L: 0.5, R: 0.5 };
  /* `t` is the fraction of the way from the front foot to the rear; the FRONT load is `1 − t`. */
  const t = ((com[0]! - frontFootXZ[0]) * dx + (com[2]! - frontFootXZ[1]) * dz) / len2;
  const front = Math.max(0, Math.min(1, 1 - t));
  return frontSide === 'L' ? { L: front, R: 1 - front } : { L: 1 - front, R: front };
}
