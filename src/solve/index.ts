/**
 * B3 SOLVER — `src/solve/index.ts`
 *
 * THE BARREL. ARCHITECTURE.md §3.13's "B3 SOLVER -> B6, B9 (the ONE entry point)" block, plus the
 * handful of symbols B9 needs to build the Channel-B reference figure with the SAME code.
 *
 * Cross-block imports go ONLY through here (OWNERSHIP rule 3, `tests/contracts/imports.test.ts`).
 *
 * ═══ WHY `solveTwoBone`, `toWorld` AND THE EASING WRAPPERS ARE PUBLIC ══════════════════════
 * §3.13 marks `solveTwoBone` "Compile-time only. Exposed so B9 can build the Channel-B reference
 * figure with the same IK." That is not convenience — a reference figure built by a second IK
 * implementation measures the difference between two solvers, and every metric derived from it
 * inherits that difference as a constant bias nobody can see.
 *
 * `toWorld` / `toWorldYawDeg` are public for the same reason at the frame level: §2.1 allows
 * exactly one handedness conversion in the project, and every consumer that needs one must reach
 * this one. `channelAlpha` / `channelVel` / `channelAcc` are public so the critic evaluates the
 * identical easing the compiler baked (`tests/contracts/ease.test.ts` asserts BIT identity).
 */

/* ── §3.13's entry point ─────────────────────────────────────────────────────────────────── */
export { compileKata, STAGES, type CompileOpts } from './compile';
export { trackHash } from './hash';

/* ── §2.1's handedness boundary. The ONLY conversion in the project. ─────────────────────── */
export {
  toWorld,
  toWorldInto,
  toWorldPsiDeg,
  toWorldYawDeg,
  embusenToWorldM,
  rootYawRad,
  sideSign,
  worldCharLeft,
  worldFacing,
  type Vec3,
} from './frame';

/* ── §3.13: exposed so B9's Channel-B figure uses the SAME IK. ───────────────────────────── */
export {
  includedAngleDeg,
  lawOfCosines,
  newTwoBoneOut,
  quatFromUnitVectors,
  softenReach,
  solveTwoBone,
  solveTwoBonePositions,
  SOFTEN_DEFAULT,
  type TwoBoneArgs,
  type TwoBoneOut,
} from './twoBoneIK';

/* ── §3.3: the compiler and the critic share ONE easing implementation. ──────────────────── */
export {
  channelAcc,
  channelAlpha,
  channelLeadS,
  channelTauP,
  channelVel,
  checkChannelInvariants,
  endEffectorAccelMs2,
  endEffectorSpeedMs,
  pelvisYawAlpha,
  pelvisYawRateDegS,
} from './channels';

/* ── doc 06 §3.2's clamp, and the named A-joint sign gate `RomLimit` cannot express. ─────── */
export {
  assertSignGate,
  checkSignGate,
  clampSwingTwist,
  ellipticConeLimitDeg,
  normaliseDeg,
  primaryAxisWorld,
  splitSwingTwist,
  SIGN_GATED_BONES,
  type ClampResult,
  type SignGateViolation,
  type SwingTwist,
} from './swingTwist';

/* ── The solver's own skeleton: Node-safe, GL-free, shared with B9's measurement path. ───── */
export {
  BI,
  BONE_DEFS,
  BONE_OFFSET_M,
  REST_WORLD_M,
  boneLengthM,
  boneOffset,
  forwardKinematics,
  getLocal,
  getWorldQuat,
  heelWorld,
  newSkel,
  resetToBind,
  restHeightH,
  restWorld,
  setLocal,
  toeTipWorld,
  type BoneDef,
  type Skel,
} from './skeleton';

/* ── Stance / COM / gaze internals B9's metrics reproduce independently. ─────────────────── */
export {
  AJC_HEIGHT_H,
  AJC_HEIGHT_M,
  LEG_LENGTH_H,
  ankleTargetsM,
  hipYawAuthoredDeg,
  kneeFlexClosedFormDeg,
  kokutsuRequiredLegH,
  pelvisTargetM,
  psiWorldDeg,
  solveStance,
  type LegSolve,
  type StanceSolve,
} from './stance';
export {
  COM_GAIN,
  COM_MAX_ITERS,
  COM_TOL_H,
  SEGMENT_MASS_TOTAL,
  bodyCOM,
  comHeightH,
  comTargetXZ,
  loadShare,
  solveCOM,
  type ComSolve,
} from './com';
export {
  WHIP_COEFF,
  WHIP_TAU_S,
  solveSpineWhip,
  solvePelvisTilt,
  pelvisYawWorldDeg,
  worldYawOf,
  xFactorDeg,
  type WhipResult,
} from './spine';
export { ARM_LEN_M, LEG_LEN_M } from './skeleton';
export {
  forearmRollDeg,
  forearmRollPeakRateDegS,
  forearmRollRateDegS,
  poleFor,
  solveArm,
  solveHikite,
  specFor,
  techniquePathLenM,
  techniquePathLocal,
  type ArmSolve,
} from './arm';
export { HAND_POSES, handBones, hikiteShape, shapeAngles, solveHand } from './hand';
export {
  GAZE_CHAIN,
  GAZE_LEAD_S,
  blinkAt,
  buildBlinkSchedule,
  gazeTargetFor,
  mulberry32,
  seedFromHash,
  solveGaze,
  type Blink,
  type GazeSolve,
} from './gaze';

/* ── Plant lock, timeline, bake, layers, impulses — what B9 and `tests/solve/**` measure. ── */
export {
  LOCK_BLEND_S,
  MAX_IK_CORRECTION_H,
  PIVOT_DRIFT_MAX_L,
  PLANT_DRIFT_MAX_M,
  applyPlantLock,
  buildPlantPlan,
  levelFoot,
  plantAt,
  plantTargetXZ,
  shortestDeltaDeg,
  type PlantLockResult,
} from './footPlant';
export {
  buildTimeline,
  checkTimeline,
  movePartsS,
  slotAt,
  tauOfSlot,
  techDurationS,
  type Slot,
  type Timeline,
  type Window,
} from './timeline';
export {
  BASE_RATE_HZ,
  MAX_SLERP_ERR_DEG,
  MAX_STEP_DEG,
  PROBE_TICKS,
  bakeSegments,
  framesByRate,
  layOutSegments,
  measureMaxStep,
  measureSlerpError,
  planSegments,
  rungFor,
  slerpInto,
  totalFrames,
  type BakePlanEntry,
  type BakedSegment,
} from './bake';
export {
  BONE_OWNER,
  LAYER_BONES,
  buildLayers,
  composeInto,
  measureRecomposeErrDeg,
  measureWorstChestYawDeg,
  weightBoxCorners,
} from './layers';
export {
  CRACK_MS_MAX,
  CRACK_MS_MIN,
  checkG9c,
  checkOneLimbStopPerLimb,
  buildImpulses,
  crackDelayTicks,
  impulsesForMove,
  targetsForArm,
  targetsForFoot,
} from './impulses';
export {
  G8_MAX_IK_RESIDUAL_M,
  newAccumulator,
  record,
  recordClamp,
  type DiagAccumulator,
} from './diagnostics';

/* ── The stage table and its assertions, so `tests/solve/stages.test.ts` drives them directly. ── */
export {
  STAGE_MASK_FULL,
  StageError,
  assertS1,
  assertS2,
  assertS3,
  assertS4,
  assertS5,
  assertS6,
  assertS7,
  assertS8,
  assertS9,
  assertS10,
  assertS11,
  assertS12,
  assertS12_5,
  assertS13,
  assertS14,
  assertS15,
  assertS16,
  stageEnabled,
  type StageDef,
} from './stageAssert';

/* ── The per-tick solve, for B9's Channel-B figure and the stage tests. ─────────────────── */
export {
  TAU_PEAK,
  buildCtx,
  buildKeyPoses,
  solvePoseAtTick,
  type MoveTech,
  type PoseSolveResult,
  type SolveCtx,
} from './keyposes';
