/**
 * B4 RIG — `src/rig/index.ts`
 *
 * THE BARREL. Cross-block reads come through here and nowhere else (OWNERSHIP rule 3,
 * `tests/contracts/imports.test.ts`): `import { buildKarateka } from '../rig'` is legal,
 * `import { buildKarateka } from '../rig/karateka'` is not.
 *
 * ═══ §3.13's B4 SURFACE ══════════════════════════════════════════════════════════════════════
 *   buildKarateka(mats)        -> RigHandles          B5, B6, B7, B9
 *   sampleLandmarks(rig, t, o) -> void                B6, B9   (MUST stamp `o.tick`)
 *   buildCapsules(rig)         -> CapsuleSet          B7
 *   updateCapsules(rig, set)   -> void                B7
 *   boneAABB(rig, out)         -> Box3                B5 (`refitShadow`, §5.5 Mode B)
 *
 * ═══ WHAT ELSE IS EXPORTED, AND WHO NEEDS IT ═════════════════════════════════════════════════
 *   * `giParts()` / `GiPartRange` — the particle <-> vertex mapping for every simulated garment part.
 *     `RigHandles` only carries `pinRings`, so without this B7's `buildGarments` and B5's
 *     `clothBridge` would each have to GUESS which vertices a `GarmentLayout` refers to. The
 *     contract: a part's `cols * rows` vertices are contiguous, row-major, from `first`, with tube
 *     parts wrapping in `col`. `cols`/`rows` come from B1's `GARMENTS`.
 *   * `GI_WEAVE_REPEAT_PER_M` / `GI_UV_UNITS` — every gi and body UV is METRES of arc length, so B5
 *     sets `map.repeat` from this rather than from a magic number. doc 06 §7.9: one weave tile is
 *     6.77 x 7.62 mm => 147 x 131 repeats per metre.
 *   * the `textures.ts` factories — B5's `createMaterials` consumes them. All `DataTexture`, all
 *     procedural, nothing fetched, Node-safe.
 *   * `TWIST_BANDS` — doc 06 §5.4 Fix 1's normative twist distribution, as data, so B3's S10 drives
 *     the same fractions the skin was banded for. Driving different ones re-opens the candy wrapper.
 *   * `BUILT_PRIMARY_AXIS` — `toWorld(PRIMARY_AXIS[b])`, which `src/contracts/bones.ts` warns must
 *     happen before any swing-twist use. B3 gets the same vector from `src/solve/frame.ts`.
 */

/* ── §3.13: the five cross-block entry points ─────────────────────────────────────────────── */
export {
  buildKarateka,
  giParts,
  karatekaStats,
  type KaratekaStats,
  type RigMaterialSet,
} from './karateka';
export { sampleLandmarks, createLandmarks, bodyCentreOfMass } from './landmarks';
export {
  boneAABB,
  buildCapsules,
  CAPSULE_BONES,
  CAPSULE_INDEX,
  updateCapsules,
  type CapsuleSet,
} from './capsules';

/* ── the skeleton, for B3's bind data and for the tests ───────────────────────────────────── */
export {
  applyBindAPose,
  authoredOffsetToBuiltM,
  BIND_A_POSE,
  buildSkeleton,
  BUILT_PRIMARY_AXIS,
  BUILT_REST_OFFSET_M,
  BONES_OF_GROUP,
  GROUP_ALLOW,
  LIMB_GROUP,
  readVec3,
  SEGMENT_TOWARD,
  TWIST_CHAINS,
  TWIST_STATION_BONES,
  type LimbGroup,
  type SkeletonBuild,
  type TwistChain,
} from './bones';

/* ── geometry + weights, for the tests and for B7's grid alignment ────────────────────────── */
export { buildBodyGeometry, LIMB_GROUP_ORDER, type BodyGeometry } from './bodyMesh';
export {
  bindSegments,
  computeSkinWeights,
  garmentWeights,
  groupOfBone,
  TWIST_BANDS,
  WEIGHT_PARAMS,
  type BindSegments,
  type SkinWeights,
  type TwistBand,
  type TwistChainBands,
} from './skinWeights';
export {
  buildGiGeometry,
  finalizePinRings,
  GI_UV_UNITS,
  GI_WEAVE_REPEAT_PER_M,
  type GiBuild,
  type GiMeshId,
  type GiPartRange,
} from './giMesh';

/* ── §2.7 tangents ────────────────────────────────────────────────────────────────────────── */
export { assertTangentContract, computeAnalyticTangents } from './tangents';

/* ── procedural maps for B5's materials ───────────────────────────────────────────────────── */
export {
  makeCreaseMap,
  makeEyeTexture,
  makeFloorMaps,
  makeHeadAlbedo,
  makeSkinMaps,
  makeWeaveNormal,
  type FloorMaps,
  type SkinMaps,
  type WeaveMaps,
} from './textures';
