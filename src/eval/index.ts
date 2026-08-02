/**
 * B9 CRITIC — `src/eval/index.ts`
 *
 * THE BARREL. ARCHITECTURE.md §3.13 (the only cross-block calls), §3.4.1 (`JointStream` and
 * `ScoreMeta` are "declared in the barrel of the block that owns them"), OWNERSHIP rule 3.
 *
 * Every cross-block read comes through this file: `import { METRICS } from '../eval'` is legal,
 * `import { METRICS } from '../eval/metricSpecs'` is not. `tests/contracts/imports.test.ts`
 * enforces it.
 *
 * ═══ WHAT §3.13 PROMISES AND WHAT IS ACTUALLY HERE AT THE PHASE-1 GATE ════════════════════════
 *
 *   export const METRICS                 ✔ all 63, with refSource + fixSite   (metricSpecs.ts)
 *   export function buildCapturePlan     ✔ tick-sorted ShotSpec[]             (plan.ts)
 *   export function scoreRun             ✔ + the eleven GATES                 (score.ts)
 *   export const GATES                   ✔                                    (score.ts)
 *   export function blame                ✔ metrics + Z/K/B/Y/X + F + rubric   (fileMap.ts)
 *   export function computeMetrics        — `metrics.ts`, PHASE 2 (§8)
 *   export function detectFaults         — `faults.ts`,  PHASE 3 (§8)
 *   export function buildReferencePose   — `refStick.ts`, PHASE 3 (§8)
 *   export function renderOverlaySvg     — `overlaySvg.ts`, PHASE 3 (§8)
 *   export function silhouetteIou        — `silhouette.ts`, PHASE 3 (§8)
 *
 * The five absent names are NOT stubbed. A throwing stub of `computeMetrics` would let a caller
 * compile against a signature that has no implementation, and the first thing it would break is the
 * one property the numeric channel exists to provide: that a green run means something was
 * measured. `tools/score.mjs` therefore reports `metricResults: 0` and `gatesPending`, which is
 * true, instead of returning a zero-filled result set, which would not be.
 *
 * IMPORT DISCIPLINE for this whole tree (§3, grep-enforced):
 *   * only `Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3` may ever be imported from `three`
 *     (nothing here imports it at all yet), so the tree is Node-safe by construction (§9.1 A-12);
 *   * no `Math.random`, `Date.now`, `performance.now` or `new Date` — `src/eval/**` is on the
 *     determinism ledger.
 */

/* ── the 480 Hz canonical-joint stream (§3.4.1, §7.1) ──────────────────────────────────────── */
export type { JointStream, JointStreamInit } from './joints';
export {
  JOINT_TICKS_PER_FRAME,
  JOINT_FLOATS_PER_FRAME,
  FRAME_S,
  JointStreamError,
  argMax,
  chanByteLength,
  chanOffset,
  channelAt,
  createJointStream,
  decodeJointStream,
  emptyJointStream,
  encodeChannels,
  encodeJoints,
  frameCountOfJointsBytes,
  jointComponent,
  jointSpeed,
  jointsByteLength,
  posOffset,
  readJoint,
  toCanonical,
} from './joints';

/* ── the 63 metric specs (§3.11, §2.6) ─────────────────────────────────────────────────────── */
export type { DerivedRefRow, RefPrecedenceRow } from './metricSpecs';
export {
  ACROMION_ABOVE_GH_H,
  ALL_REF_OVERRIDES,
  ASYMMETRIC_STANCES,
  DERIVED_REFS,
  DOC03_CROSSCHECK,
  DOC03_GH_OFFSET_H,
  GH_Y_FIGHT_H,
  GH_Y_STAND_H,
  HEAD_TOP_Y_FIGHT_H,
  METRICS,
  METRIC_BY_ID,
  METRIC_NOTES,
  METRIC_NUMBER,
  METRIC_1_BIAS_NOTE,
  METRIC_1_EXPECTED_BIAS_H,
  METRIC_1_EXPECTED_BIAS_PCT,
  METRIC_1_RIG_HEEL_TO_HEEL_H,
  REF_PRECEDENCE_APPLIED,
  REGISTRY_AUDIT,
  UKE_IDS,
  VERTEX_Y_STAND_H,
  ZUKI_IDS,
  heelToHeelH,
  metricSpec,
  metricsOfGroup,
  refFor,
  symbolOfKnob,
} from './metricSpecs';

/* ── the reference banks, and the DISARMED state of Channel C (§7.6) ───────────────────────── */
export type { ChannelCStatus, RefBank, RefBankHandle, RefBankStatus, RefStep } from './referenceBank';
export {
  AVAILABLE_REF_BANKS,
  CHANNEL_C_STATUS,
  CHANNEL_C_THRESHOLDS,
  ReferenceBankError,
  loadAllReferenceBanks,
  loadReferenceBank,
  parseReferenceBank,
  refBankPath,
  referenceStatusSummary,
  validateRefBank,
} from './referenceBank';

/* ── scoring + the eleven gates (doc 07 §6.3, §7.5) ────────────────────────────────────────── */
export type { GateInput, GateStatus, ScoreMeta, ScoreRunOpts, StepContext } from './score';
export {
  FIX_QUEUE_MAX,
  GATES,
  GATE_ARMED,
  METRIC_GROUPS,
  ZERO_BAKE_STATS,
  ZERO_DETERMINISM,
  buildFixQueue,
  buildSteps,
  deviation,
  emptyScorecard,
  evaluateGates,
  gateStatusOf,
  layerWeightsDirty,
  measuredGroups,
  scoreGroup,
  scoreKata,
  scoreMetric,
  scoreRun,
  scoreStep,
  suggestedDeltaFor,
  unmeasuredMetrics,
  verdictOf,
} from './score';

/* ── the capture plan — TICK-SORTED (§7.3) ─────────────────────────────────────────────────── */
export type { CapturePlanOpts, PlanSummary } from './plan';
export {
  PLAN_BASE_CAMERAS,
  PLAN_DETAIL_CAMERAS,
  PLAN_DETAIL_STEPS,
  PLAN_EMBUSEN_CAMERA,
  PLAN_JUDGE_CAMERA,
  PLAN_MIRROR_CAMERA,
  PLAN_STRIP_CAMERAS,
  assertMonotonic,
  baseMarks,
  buildCapturePlan,
  compareShots,
  findYame,
  findYoi,
  slug,
  summarisePlan,
  tickStamp,
} from './plan';

/* ── complaint -> file (§7.7) ──────────────────────────────────────────────────────────────── */
export {
  ALL_FIX_FILES,
  BLAME_MAP,
  FAULT_IDS,
  RUBRIC_IDS,
  blame,
  resolveMoveSite,
  routeFinding,
} from './fileMap';

/* ── report rendering (§7.3, §7.4) ─────────────────────────────────────────────────────────── */
export type { ReportOpts, RunDiff } from './report';
export {
  REGRESSION_MAX_DROP,
  diffRuns,
  renderConsoleSummary,
  renderDiffMd,
  renderFindings,
  renderFixQueue,
  renderMetricRow,
  renderScorecardMd,
} from './report';
