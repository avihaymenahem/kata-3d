/**
 * B3 SOLVER — `src/solve/diagnostics.ts`
 *
 * `SolveDiagnostics` accumulation. ARCHITECTURE.md §3.9, §4.3; consumed by §7.7's fix router.
 *
 * ═══ DIAGNOSTICS ARE A MEASUREMENT, NOT AN ERROR CHANNEL ═══════════════════════════════════
 * Every field here records what the solve ACHIEVED, including where it fell short. A residual is
 * not a failure to be suppressed — doc 06 §6.4's L9-vs-IK rule is explicit that the correct
 * response to a clamp that breaks an endpoint is to "accept and *report* the residual endpoint
 * error", never to loop until it goes away. Looping produces frame-rate-dependent jitter; a
 * reported residual produces a routed finding.
 *
 * That is why `worst` carries the TICK and the MOVE alongside each maximum. §7.7 routes a finding
 * to a file, and "the IK residual peaks at 6 mm" is not routable — "the left arm residual peaks
 * at 6 mm at tick 41 216, move 9" points at `move-09.ts`.
 *
 * ═══ 480 Hz, UNIFORM, ALWAYS ══════════════════════════════════════════════════════════════
 * `SolveDiagnostics.rateHz` is the literal `480` in the frozen type. Not the bake ladder: the bake
 * is adaptive, so a per-baked-frame diagnostic would be denser exactly where the motion is fast
 * and sparser everywhere else, and every per-move statistic would be silently weighted by rung
 * choice. A uniform grid makes "worst over the move" mean the same thing on every move.
 */

import type { BoneIndex, KataScore, SolveDiagnostics } from '../contracts';
import { BONE_COUNT, CHAN_TICKS_PER_FRAME } from '../contracts';

/** `TICK_HZ / CHAN_RATE_HZ === 8`. The diagnostics grid is the channel grid. */
export const DIAG_TICKS_PER_FRAME = CHAN_TICKS_PER_FRAME;

export interface DiagAccumulator {
  readonly frameCount: number;
  readonly ikResidualM: Float32Array;
  readonly plantSlipM: Float32Array;
  readonly comErrH: Float32Array;
  readonly headYH: Float32Array;
  readonly pelvisYawDeg: Float32Array;
  readonly clampSatByMove: Float32Array;
  /** Mutable running worst-case, folded into the frozen `worst` at `finish`. */
  worst: {
    ikResidualM: number; ikResidualAtTick: number; ikResidualMoveN: number;
    plantSlipM: number; plantSlipAtTick: number;
    headBobH: number; headBobMoveN: number;
    clampSat: number; clampSatBone: number;
  };
  /** Per-move head-height min/max, for the bob measurement. */
  headMin: Float64Array;
  headMax: Float64Array;
}

export function newAccumulator(frameCount: number, moveCount: number): DiagAccumulator {
  return {
    frameCount,
    ikResidualM: new Float32Array(frameCount * 4),
    plantSlipM: new Float32Array(frameCount * 2),
    comErrH: new Float32Array(frameCount),
    headYH: new Float32Array(frameCount),
    pelvisYawDeg: new Float32Array(frameCount),
    clampSatByMove: new Float32Array(moveCount * BONE_COUNT),
    worst: {
      ikResidualM: 0, ikResidualAtTick: 0, ikResidualMoveN: 0,
      plantSlipM: 0, plantSlipAtTick: 0,
      headBobH: 0, headBobMoveN: 0,
      clampSat: 0, clampSatBone: 0,
    },
    headMin: new Float64Array(moveCount + 1).fill(Number.POSITIVE_INFINITY),
    headMax: new Float64Array(moveCount + 1).fill(Number.NEGATIVE_INFINITY),
  };
}

export interface FrameSample {
  readonly tick: number;
  readonly moveN: number;
  readonly ikResidualM: readonly [number, number, number, number];
  readonly plantSlipM: readonly [number, number];
  readonly comErrH: number;
  readonly headYH: number;
  readonly pelvisYawDeg: number;
}

/** Record one 480 Hz frame. */
export function record(acc: DiagAccumulator, frame: number, s: FrameSample): void {
  if (frame < 0 || frame >= acc.frameCount) return;
  for (let i = 0; i < 4; i++) {
    const v = s.ikResidualM[i]!;
    acc.ikResidualM[frame * 4 + i] = v;
    if (v > acc.worst.ikResidualM) {
      acc.worst.ikResidualM = v;
      acc.worst.ikResidualAtTick = s.tick;
      acc.worst.ikResidualMoveN = s.moveN;
    }
  }
  for (let i = 0; i < 2; i++) {
    const v = s.plantSlipM[i]!;
    acc.plantSlipM[frame * 2 + i] = v;
    if (v > acc.worst.plantSlipM) {
      acc.worst.plantSlipM = v;
      acc.worst.plantSlipAtTick = s.tick;
    }
  }
  acc.comErrH[frame] = s.comErrH;
  acc.headYH[frame] = s.headYH;
  acc.pelvisYawDeg[frame] = s.pelvisYawDeg;

  /* Head bob is a PER-MOVE range, not a per-frame value: the head legitimately changes height
   * between a zenkutsu and a kokutsu, and only the oscillation WITHIN one move is a fault. */
  const mi = Math.max(0, Math.min(acc.headMin.length - 1, s.moveN));
  if (s.headYH < acc.headMin[mi]!) acc.headMin[mi] = s.headYH;
  if (s.headYH > acc.headMax[mi]!) acc.headMax[mi] = s.headYH;
}

/** Record a per-move, per-bone clamp saturation (S12). Keeps the max, never the last write. */
export function recordClamp(
  acc: DiagAccumulator,
  moveIndex: number,
  bone: number,
  saturation: number,
): void {
  const i = moveIndex * BONE_COUNT + bone;
  if (i < 0 || i >= acc.clampSatByMove.length) return;
  if (saturation > acc.clampSatByMove[i]!) acc.clampSatByMove[i] = saturation;
  if (saturation > acc.worst.clampSat) {
    acc.worst.clampSat = saturation;
    acc.worst.clampSatBone = bone;
  }
}

/** Freeze the accumulator into the §3.9 shape. */
export function finish(acc: DiagAccumulator, kata: KataScore): SolveDiagnostics {
  for (let mi = 0; mi < acc.headMin.length; mi++) {
    const lo = acc.headMin[mi]!;
    const hi = acc.headMax[mi]!;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const bob = hi - lo;
    if (bob > acc.worst.headBobH) {
      acc.worst.headBobH = bob;
      acc.worst.headBobMoveN = mi;
    }
  }
  void kata;
  return {
    rateHz: 480,
    frameCount: acc.frameCount,
    ikResidualM: acc.ikResidualM,
    plantSlipM: acc.plantSlipM,
    comErrH: acc.comErrH,
    headYH: acc.headYH,
    pelvisYawDeg: acc.pelvisYawDeg,
    clampSatByMove: acc.clampSatByMove,
    worst: {
      ikResidualM: acc.worst.ikResidualM,
      ikResidualAtTick: acc.worst.ikResidualAtTick,
      ikResidualMoveN: acc.worst.ikResidualMoveN,
      plantSlipM: acc.worst.plantSlipM,
      plantSlipAtTick: acc.worst.plantSlipAtTick,
      headBobH: acc.worst.headBobH,
      headBobMoveN: acc.worst.headBobMoveN,
      clampSat: acc.worst.clampSat,
      clampSatBone: acc.worst.clampSatBone as BoneIndex,
    },
  };
}

/** **G-8**: `max ikResidualM < 0.005 m` at every arrival tick. OWNERSHIP B3's verification list. */
export const G8_MAX_IK_RESIDUAL_M = 0.005;
/** doc 01 §9.5's pelvis-bob fault threshold, FracH. `STEP.pelvisYFail` is the hard one. */
export const HEAD_BOB_WARN_H = 0.015;
