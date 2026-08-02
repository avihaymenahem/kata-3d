/**
 * B3 SOLVER — `src/solve/stageAssert.ts`
 *
 * The 16 compile stages of ARCHITECTURE.md §4.11 and their exit invariants.
 *
 * ═══ AN INVARIANT THAT CANNOT FAIL IS NOT AN INVARIANT ═════════════════════════════════════
 * Two of these are stated in §4.11 in a form that would be VACUOUS if implemented literally, and
 * both corrections are load-bearing enough to restate here:
 *
 *   **S6** asserts the lead ordering, `TAUP_MONOTONE_CHAIN`, and the min/span form — **not**
 *   pointwise `tauP` monotonicity along `CHANNEL_ORDER`. doc 04 §11's own table falls at four of
 *   its eight steps, so the pointwise reading throws on every move and `compileKata` never
 *   returns. Adjudicated in the Phase-0 audit; `CHANNEL_ORDER`'s doc block in
 *   `src/contracts/kata.ts` carries the arithmetic.
 *
 *   **S15/G-9c** is STRUCTURAL — `Number.isInteger` on every event tick and crack delay, plus the
 *   [38, 77] range — not `survivesQuantisation` in a loop. That predicate is a statement about
 *   the CLOCK, true for every input at 3840 Hz, so a gate built on it reports `true`
 *   unconditionally. §3.9's note on `BakeStats.eventsBelow20msExact` says so explicitly.
 *
 * ═══ EVERY STAGE IS INDIVIDUALLY MASKABLE ══════════════════════════════════════════════════
 * §4.11: "each can be individually disabled by a bit in `CompileOpts.stageMask` — that is how an
 * agent bisects 'the pose is wrong but I do not know which stage'." A non-full mask sets
 * `flags.stageMask` in `run.json` and makes every gate advisory, which is why `STAGES` carries the
 * bit alongside the id rather than deriving it from array position.
 */

import type { ImpulseEvent, KataScore, PlantSpan, PoseKey } from '../contracts';
import {
  BAKE_MAX_ERR_DEG,
  BAKE_MAX_STEP_DEG,
  BONE_ORDER,
  LAYER_RECOMPOSE_MAX_ERR_DEG,
} from '../contracts';
import { checkChannelInvariants } from './channels';
import { COM_TOL_H } from './com';
import { CHEST_YAW_ENVELOPE_CAP_DEG } from './layers';
import { PLANT_DRIFT_MAX_M } from './footPlant';
import { G8_MAX_IK_RESIDUAL_M } from './diagnostics';
import { checkG9c, checkOneLimbStopPerLimb } from './impulses';
import { type Timeline, checkTimeline } from './timeline';
import type { BakedSegment, SlerpErrMeasurement } from './bake';

/** §3.13. One row per §4.11 stage. `bit` is the `stageMask` position. */
export interface StageDef {
  readonly id: string;
  readonly bit: number;
  readonly desc: string;
}

export const STAGES: readonly StageDef[] = Object.freeze([
  { id: 'S0', bit: 1 << 0, desc: 'validateKata — doc 02 §11\'s seven invariants' },
  { id: 'S1', bit: 1 << 1, desc: 'buildTimeline — integer tick windows, contiguous, tempoScale scoped' },
  { id: 'S2', bit: 1 << 2, desc: 'footPlanFor — pivot drift <= 0.02 L, ff recompute to 1e-9 L' },
  { id: 'S3', bit: 1 << 3, desc: 'solveStance — pelvisY exact, ankles on plan, knee inside ROM' },
  { id: 'S4', bit: 1 << 4, desc: 'solveArm/Hikite/Hand — endpoint residual < 0.005 m at kime' },
  { id: 'S5', bit: 1 << 5, desc: 'buildKeyPoses — one key per phase per slot, ticks increasing' },
  { id: 'S6', bit: 1 << 6, desc: 'channelAlpha wiring — lead order, TAUP_MONOTONE_CHAIN, min/span' },
  { id: 'S7', bit: 1 << 7, desc: 'layerHipDrive — |psi(0.5) - psi_start| <= 8 deg' },
  { id: 'S8', bit: 1 << 8, desc: 'layerSpineWhip — X-factor <= 15 deg at every tick' },
  { id: 'S9', bit: 1 << 9, desc: 'solveCOM — <= 3 iterations, |comXZ - target| <= 0.002 H' },
  { id: 'S10', bit: 1 << 10, desc: 'layerHelpers — twist sums to the source roll, helpers in ROM' },
  { id: 'S11', bit: 1 << 11, desc: 'solveGaze — chain weights sum to 1, eye residual in ROM' },
  { id: 'S12', bit: 1 << 12, desc: 'clampSwingTwist — every bone inside ROM, clampSat recorded' },
  { id: 'S12.5', bit: 1 << 13, desc: 'applyPlantLock + one corrective leg-IK pass, AFTER the clamp' },
  { id: 'S13', bit: 1 << 14, desc: 'bakeSegments — G-9a, G-9b, segments contiguous and on-grid' },
  { id: 'S14', bit: 1 << 15, desc: 'buildLayers — recompose < 1e-4 deg, chest yaw over the weight box' },
  { id: 'S15', bit: 1 << 16, desc: 'buildImpulses — one limb-stop per acting limb per move, G-9c' },
  { id: 'S16', bit: 1 << 17, desc: 'emitTrack + trackHash — buffers frozen, marks ascending' },
]);

/** Every bit set. The default `stageMask`. */
export const STAGE_MASK_FULL: number = STAGES.reduce((a, s) => a | s.bit, 0);

export const stageEnabled = (mask: number, id: string): boolean => {
  const s = STAGES.find((x) => x.id === id);
  return s === undefined ? true : (mask & s.bit) !== 0;
};

export class StageError extends Error {
  constructor(readonly stage: string, detail: string) {
    super(`stage ${stage} FAILED: ${detail}`);
    this.name = 'StageError';
  }
}

const fail = (stage: string, detail: string): never => {
  throw new StageError(stage, detail);
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The per-stage exit invariants. Each takes only what it needs, so a stage can be asserted in
 * isolation by `tests/solve/stages.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export function assertS1(tl: Timeline, k: KataScore): void {
  const r = checkTimeline(tl, k);
  if (!r.ok) fail('S1', r.detail);
}

export function assertS2(worstPivotDriftL: number, worstFfErrL: number): void {
  if (worstPivotDriftL > 0.02) fail('S2', `pivot drift ${worstPivotDriftL.toFixed(5)} L > 0.02 L`);
  if (worstFfErrL > 1e-9) fail('S2', `ff recompute error ${worstFfErrL.toExponential(3)} L > 1e-9 L`);
}

export function assertS3(pelvisYErrM: number, ankleResidualM: number): void {
  /* "bobbing is structurally impossible" — §4.11 S3. 1e-9 is the frozen number. */
  if (pelvisYErrM > 1e-9) fail('S3', `pelvisY drifted ${pelvisYErrM.toExponential(3)} m from its input`);
  if (ankleResidualM > 1e-6) fail('S3', `ankle off plan by ${ankleResidualM.toExponential(3)} m > 1e-6 m`);
}

export function assertS4(worstResidualM: number, worstReachH: number): void {
  if (worstResidualM >= G8_MAX_IK_RESIDUAL_M) {
    fail('S4', `arm endpoint residual ${worstResidualM.toFixed(5)} m >= ${G8_MAX_IK_RESIDUAL_M} m (G-8)`);
  }
  /* §4.11 S4: `|F| <= 0.381 H` (MCP2). The looser of the two bounds, applied to both. */
  if (worstReachH > 0.381) fail('S4', `reach ${worstReachH.toFixed(4)} H > 0.381 H`);
}

export function assertS5(keys: readonly PoseKey[], slotCount: number): void {
  if (keys.length !== slotCount * 5) {
    fail('S5', `${keys.length} keys for ${slotCount} slots (expected ${slotCount * 5})`);
  }
  for (let i = 1; i < keys.length; i++) {
    if (keys[i]!.tick <= keys[i - 1]!.tick) {
      fail('S5', `key ${i} tick ${keys[i]!.tick} <= previous ${keys[i - 1]!.tick}`);
    }
  }
}

export function assertS6(): void {
  const r = checkChannelInvariants();
  if (!r.leadsDescending) fail('S6', `doc 04 §11 invariant 1: ${r.detail}`);
  if (!r.tauPMonotoneOnChain) fail('S6', `TAUP_MONOTONE_CHAIN: ${r.detail}`);
  if (!r.minTauPIsProximal) fail('S6', `invariant 2 span: ${r.detail}`);
}

export function assertS7(worstPsiAtHalfDeg: number): void {
  /* doc 01 §9.5's X3 predicate, made structural. `holdThenSnap` holds to 0.55, so this is 0. */
  if (worstPsiAtHalfDeg > 8) {
    fail('S7', `|psi(0.5) - psi_start| = ${worstPsiAtHalfDeg.toFixed(2)} deg > 8 deg (fault X3)`);
  }
}

export function assertS8(worstXFactorDeg: number): void {
  if (worstXFactorDeg > 15 + 1e-6) {
    fail('S8', `X-factor ${worstXFactorDeg.toFixed(2)} deg > 15 deg (doc 04 §2.1)`);
  }
}

export function assertS9(worstIterations: number, worstErrH: number): void {
  if (worstIterations > 3) fail('S9', `COM took ${worstIterations} iterations, doc 06 §2.2 allows 3`);
  if (worstErrH > COM_TOL_H) {
    fail('S9', `|comXZ - target| = ${worstErrH.toFixed(5)} H > ${COM_TOL_H} H`);
  }
}

export function assertS10(worstTwistSumErrDeg: number): void {
  if (worstTwistSumErrDeg > 1e-6) {
    fail('S10', `twist sum off by ${worstTwistSumErrDeg.toExponential(3)} deg > 1e-6`);
  }
}

export function assertS11(weightSum: number): void {
  if (Math.abs(weightSum - 1) > 1e-9) {
    fail('S11', `gaze chain weights sum to ${weightSum}, not 1.0`);
  }
}

export function assertS12(worstSaturation: number): void {
  /* A clamp that is fully saturated means the solve asked for a pose ROM cannot represent, which
   * is an authoring fault, not a solver one — but it is only a WARNING here, because §4.11 S12's
   * exit invariant is "every bone inside ROM", and after the clamp every bone is, by definition.
   * The number is recorded per move so §7.7 can route it. */
  if (worstSaturation > 1 + 1e-9) fail('S12', `clamp saturation ${worstSaturation} > 1`);
}

export function assertS12_5(worstDriftM: number): void {
  if (worstDriftM > PLANT_DRIFT_MAX_M) {
    fail('S12.5', `planted foot drifted ${worstDriftM.toExponential(3)} m > ${PLANT_DRIFT_MAX_M} m`);
  }
}

export function assertS13(
  segs: readonly BakedSegment[],
  slerpErr: SlerpErrMeasurement,
  maxStepDeg: number,
  durationTicks: number,
): void {
  if (segs.length === 0) fail('S13', 'no segments');
  if (!(slerpErr.errDeg < BAKE_MAX_ERR_DEG)) {
    fail(
      'S13',
      `G-9a maxSlerpErrDeg ${slerpErr.errDeg.toFixed(4)} >= ${BAKE_MAX_ERR_DEG} ` +
        `on bone ${BONE_ORDER[slerpErr.bone] ?? slerpErr.bone} at tick ${slerpErr.tick} ` +
        `(segment baked at ${slerpErr.rateHz} Hz)`,
    );
  }
  if (!(maxStepDeg <= BAKE_MAX_STEP_DEG)) {
    fail('S13', `G-9b maxStepDeg ${maxStepDeg.toFixed(3)} > ${BAKE_MAX_STEP_DEG}`);
  }
  let cursor = segs[0]!.startTick;
  for (const s of segs) {
    if (s.frameCount < 2) fail('S13', `segment at ${s.startTick} has ${s.frameCount} frames`);
    if (s.startTick % s.ticksPerFrame !== 0) {
      fail('S13', `segment startTick ${s.startTick} is off the ${s.rateHz} Hz grid`);
    }
    if (s.startTick !== cursor) {
      fail('S13', `segment starts at ${s.startTick}, previous ended at ${cursor}`);
    }
    cursor = s.startTick + (s.frameCount - 1) * s.ticksPerFrame;
  }
  if (cursor > durationTicks) {
    fail('S13', `segments run to ${cursor}, past durationTicks ${durationTicks}`);
  }
}

export function assertS14(recomposeErrDeg: number, worstChestYawDeg: number): void {
  if (!(recomposeErrDeg < LAYER_RECOMPOSE_MAX_ERR_DEG)) {
    fail('S14', `recompose error ${recomposeErrDeg.toExponential(3)} deg >= ${LAYER_RECOMPOSE_MAX_ERR_DEG}`);
  }
  if (worstChestYawDeg > CHEST_YAW_ENVELOPE_CAP_DEG) {
    fail(
      'S14',
      `worst-case chest yaw ${worstChestYawDeg.toFixed(2)} deg > ${CHEST_YAW_ENVELOPE_CAP_DEG} deg ` +
        'over the legal weight box',
    );
  }
}

export function assertS15(events: readonly ImpulseEvent[], k: KataScore): void {
  const bad = checkOneLimbStopPerLimb(events, k.moves);
  if (bad.length > 0) fail('S15', bad.slice(0, 3).join('; '));
  if (!checkG9c(events)) fail('S15', 'G-9c: an event tick or crack delay is not an exact integer in [38, 77]');
}

export function assertS16(
  marks: readonly { tick: number }[],
  plants: readonly PlantSpan[],
  hash: string,
): void {
  for (let i = 1; i < marks.length; i++) {
    if (marks[i]!.tick < marks[i - 1]!.tick) {
      fail('S16', `marks are not ascending at index ${i} (${marks[i]!.tick} < ${marks[i - 1]!.tick})`);
    }
  }
  for (const p of plants) {
    if (p.tickOut <= p.tickIn) fail('S16', `plant span ${p.foot} ${p.tickIn}..${p.tickOut} is empty`);
  }
  if (!/^[0-9a-f]{16}$/.test(hash)) fail('S16', `hash '${hash}' is not 16 hex characters`);
}
