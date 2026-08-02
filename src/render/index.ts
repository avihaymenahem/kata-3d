/**
 * B5 RENDER — `src/render/index.ts`
 *
 * THE BARREL. Cross-block imports go ONLY through a block's `index.ts` (§3 import discipline,
 * OWNERSHIP rule 3, `tests/contracts/imports.test.ts`): `import { createMaterials } from '../render'`
 * is legal, `import { createMaterials } from '../render/materials'` is not.
 *
 * ── §3.13's ELEVEN CROSS-BLOCK ENTRY POINTS ───────────────────────────────────────────────────
 *   createRenderer     buildEnvironment   buildLights     refitShadow    createMaterials
 *   buildStage         buildPost          renderSilhouette (P4)          uploadCloth (P4)
 *   buildOverlay (P4)
 *
 * Everything else below is additive: types the frozen signatures are declared in terms of, the pure
 * functions the B5 tests need (`halton`, `stillJitter`, `snapShadowBox`), and the diagnostics the HUD
 * reads. Nothing here renames, narrows or replaces a §3.13 signature.
 *
 * ── WHAT IS DELIBERATELY *NOT* EXPORTED ───────────────────────────────────────────────────────
 * `configureShadow`, `disposeLights`, `disposeStage`, `disposeMaterials`, `buildDojoEnvScene`, the
 * private floor-texture generators and `dojoWall.ts`'s `makeDojoWallTexture` /
 * `makeRoomShellGeometry` are intra-block. `configureShadow` in particular is called by
 * `buildLights` so a `LightRig` cannot be handed out half-configured — §5.1's boot order
 * ("lights ; scene.add(key.target) ; configureShadow(key)") is satisfied inside `buildLights`.
 *
 * The rule the room follows is `dojoEnv.ts`'s: the BUILDER stays private, because `buildStage` is
 * the only legal way to get a room and a room built without a floor under it is not a thing anyone
 * should be able to construct; the PLAN constants are exported, because a critic finding about the
 * hall's proportions has to have somewhere to land.
 *
 * Exception: the four `dispose*` helpers ARE exported, because §8's Phase-6 exit gate is "no leaks
 * across 20 kata<->camera switches" and B6 owns the teardown path (`AppHandle.dispose`). A teardown it
 * cannot reach is a leak by construction.
 */

/* ── renderer ─────────────────────────────────────────────────────────────────────────────────── */
export {
  createRenderer,
  assertRendererInvariants,
  TONE_MAPPING,
  TONE_MAPPING_OPTIONS,
  MAX_PIXEL_RATIO,
} from './renderer';

/* ── environment / IBL ───────────────────────────────────────────────────────────────────────── */
export {
  buildEnvironment,
  maxPmremSigma,
  PMREM_MAX_SAMPLES,
  PMREM_STANDARD_DEVIATIONS,
  PMREM_SIGMA_CLAMPED,
  type IblHandle,
  type IblOpts,
} from './ibl';
export { ENV_CAPTURE_Y_M, type DojoEnvOpts } from './dojoEnv';

/* ── lights ──────────────────────────────────────────────────────────────────────────────────── */
export {
  buildLights,
  disposeLights,
  assertNoAmbientLight,
  LIGHT_AIM_M,
  type LightRig,
} from './lights';

/* ── shadow ──────────────────────────────────────────────────────────────────────────────────── */
export {
  refitShadow,
  snapShadowBox,
  S_FIT_M,
  SHADOW_MAP_PX,
  SHADOW_TEXEL_M,
  SHADOW_PENUMBRA_M,
  SHADOW_AABB_BONES,
  SHADOW_NEVER_SET,
  SHADOW_FIT_REACH_M,
  LAST_FIT,
  type ShadowFit,
  type ShadowFitSource,
} from './shadow';

/* ── materials ───────────────────────────────────────────────────────────────────────────────── */
export {
  createMaterials,
  disposeMaterials,
  assignMap,
  TEXTURE_COLOR_SPACE,
  MATERIAL_TONE_MAPPED,
  B5_LOCAL_COLOR_HEX,
  type MapSlot,
  type MaterialId,
  type MaterialSet,
} from './materials';

/* ── stage ───────────────────────────────────────────────────────────────────────────────────── */
export {
  buildStage,
  disposeStage,
  stageClipBox,
  FLOOR_RADIUS_M,
  BACKDROP_RADIUS_M,
  BACKDROP_HEIGHT_M,
  PLANK_WIDTH_M,
  FLOOR_TILE_M,
  STAGE_HALF_M,
  STAGE_CENTRE_Z_M,
  STAGE_X_SLACK_M,
  STAGE_MIN_Y_M,
  STAGE_MAX_Y_M,
  type StageHandle,
} from './stage';

/* ── room shell ──────────────────────────────────────────────────────────────────────────────── */
export {
  ROOM_HALF_M,
  WALL_BASE_Y_M,
  WALL_TOP_Y_M,
  WALL_TILE_M,
  KAMIZA_BASE_Y_M,
  KAMIZA_W_M,
  KAMIZA_H_M,
} from './dojoWall';

/* ── post ────────────────────────────────────────────────────────────────────────────────────── */
export {
  buildPost,
  plannedPasses,
  POST_PASS_ORDER,
  POST_PASS_FORBIDDEN,
  type KataPostStack,
  type PostOpts,
  type PostPassName,
  type QualityTier,
} from './post';

/* ── still ───────────────────────────────────────────────────────────────────────────────────── */
export { StillAccumulator, halton, haltonMean, stillJitter, stillJitterSet } from './still';

/* ── Phase 4 ─────────────────────────────────────────────────────────────────────────────────── */
export { renderSilhouette } from './silhouette';
export { uploadCloth } from './clothBridge';
export {
  buildOverlay,
  type KataOverlayHandle,
  type OverlayHandle,
  type OverlayLayer,
} from './overlay';
