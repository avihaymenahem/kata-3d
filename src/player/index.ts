/**
 * B6 PLAYER — `src/player/index.ts`
 *
 * THE BARREL. Cross-block imports go ONLY through a block's `index.ts` (§3 import discipline,
 * OWNERSHIP rule 3, `tests/contracts/imports.test.ts`), and `src/main.ts` reaches this block through
 * here — which is the ONLY way the entry point can boot a three.js scene at all, because
 * `src/main.ts` is not on the three allowlist (see the header of `./app`).
 *
 * ═══ THE SURFACE ═════════════════════════════════════════════════════════════════════════════
 *   createCameraRig(o?)  -> KataCameraRig       §3.13, implementing §5.7's twelve presets
 *   bootStage(o)         -> Promise<StageBoot>  the Phase-1 composition root
 *   createSampler(track) -> PoseSource          §3.13, §6.2 term for term — THE runtime read path
 *   applyPose(rig, f)    -> void                §3.13, §6.6 line 2: 52 local quats + root + ribcage
 *
 * `createSampler` and `applyPose` are what `tests/contracts/seek-purity.test.ts` and
 * `tests/contracts/handedness.test.ts` reach through this barrel for, and both took a `PoseTrack` —
 * so neither could exist before B3's `compileKata` did. They were RED-FIRST until then by design:
 * "missing symbol 'createSampler'" is an honest red naming the block that owes it, where a stub
 * returning zeroed quaternions would have been a silent green (§8's red-first rule).
 *
 * ═══ WHAT §3.13 STILL OWES ═══════════════════════════════════════════════════════════════════
 *   createTransport(track)   bootApp(o)   installHarness(app)
 *
 * Same rule applies: nothing is exported from here until it does the real thing.
 */

export {
  CAMERA_KEY_ORDER,
  CAMERA_MEASUREMENT_ORDER,
  createCameraRig,
  type CameraRigOpts,
  type KataCameraRig,
} from './cameraRig';

export {
  bootStage,
  type StageBoot,
  type StageBootOpts,
  type StageStats,
} from './app';

/* ── §6.1's deterministic seek, and the write into the built rig ──────────────────────────── */
export { createSampler } from './sampler';
export { applyPose } from './poseApply';

/* ── The rigged, clip-driven figure that replaced the procedural one on the render path ────── */
export {
  CONTRACT_TO_MIXAMO,
  CONTRACT_TO_RIGIFY,
  DEFAULT_FADE_S,
  detectFlavour,
  loadCharacter,
  sanitizeBoneName,
  type Character,
  type SkeletonFlavour,
} from './character';
export { DEFAULT_MODEL_URL, MOCAP_CLIPS } from './app';
export {
  BVH_TO_CONTRACT,
  addBvhClip,
  loadBvh,
  retargetBvhClip,
  type BvhSource,
  type RetargetOpts,
} from './retarget';
/* The retarget's geometry, split out so it is testable with no GLB and no capture file — see the
 * header of `./boneBasis` for why one axis was not enough. */
export {
  MIN_AXIS_SEPARATION,
  MIN_BEND_SIN,
  bendPlaneNormal,
  frameAlign,
  orthonormalFrame,
} from './boneBasis';
export {
  STILL_SPEED_MS,
  measureClipGroundSpeed,
  timeScaleForSpeed,
} from './locomotion';
export { sampleCharacterLandmarks } from './characterLandmarks';
export { attachGi, type GiHandle, type GiMaterials, type GiStats } from './gi';
export { createFootIk, type FootIk, type FootIkOpts } from './footIk';
/* The hand shapes no capture supplies. The pure half — the doc 03 §12 angle table, the palm-plane
 * axis derivation and the blend curve — is exported alongside the handle so it can be asserted with
 * no GLB; see the header of `./handShape` for why the axis is measured and never named. */
export {
  HAND_BLEND_S,
  HAND_SHAPES,
  MIN_SWING_SIN,
  createHandShaper,
  handEase,
  hikiteHandShape,
  palmFacing,
  swingAxis,
  type HandShapeId,
  type HandShapeSpec,
  type HandShaper,
  type HandShaperOpts,
  type HandShaperStats,
} from './handShape';
export {
  CLIP_FOR_TECHNIQUE,
  MODEL_FACING_OFFSET_RAD,
  TECHNIQUE_SOURCE,
  type TechniqueSource,
  REST_CLIP,
  STEP_CLIP,
  buildBeats,
  buildChoreography,
  checkYawChain,
  type Beat,
  type Choreography,
} from './choreography';
