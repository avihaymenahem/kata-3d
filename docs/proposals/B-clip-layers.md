# Proposal B — CLIP + LAYER PIPELINE

> A 3D 360° kata player in which the kata is a **compiled artifact**: 41 compact move
> definitions → ~18 reusable technique segments → real `THREE.AnimationClip`s with dense
> adaptive quaternion tracks → one `AnimationMixer` driving a base clip plus five additive
> layers, behind a transport whose clock is dyadic and whose runtime is stateless.

Author: architecture pass, 2026-07-31. Stack verified against `node_modules/three@0.185.1`.
Every three.js claim below cites either doc `05-threejs-api.md` or a line I re-read in the
installed tree (marked `[VERIFIED]` with the file:line).

---

## 1. Thesis, and the one thing this design optimizes for

Hand-written per-frame pose code makes *correct* karate and *robotic* karate at the same time,
because the moment you sample poses procedurally every frame you have also bought a stateful
runtime, an unseekable timeline, and a motion-quality ceiling set by whatever easing you happened
to hard-code at each call site. This design inverts that: a **compiler** (`src/clip/compile.ts`)
turns compact declarative `MoveDef` records into a bank of real `AnimationClip`s whose quaternion
tracks are baked *adaptively* — dense where the motion snaps, sparse where it holds — and then the
entire runtime is `mixer.update(0)` plus a short, pure post-mixer pass. Kata-wide behaviours that a
critic complains about as single sentences ("the hips are dead", "there's no kime", "it doesn't
breathe") are single **additive layers** with single weights, not edits spread across 41 moves.
Technique segments are content-addressed and reused: `gedan-barai` is authored once and appears 14
times across the two kata, so a fix lands 14 times.

**The one thing optimized for: MOTION QUALITY AND BLENDABILITY.** Concretely, three commitments,
each of which costs something real and is paid for on purpose:

1. **Easing is baked into key density, never delegated to slerp.** `QuaternionKeyframeTrack` in
   0.185.1 supports only `InterpolateLinear`; `InterpolateSmooth` silently degrades
   (doc 05 §10.2, §14.1 #4). Piecewise-constant angular velocity *is* the robotic look. So the
   baker samples the authored ease curve to a 0.25° geodesic error bound. Cost: ~1.2 MB and
   ~180 ms compile per kata.
2. **Proximal-to-distal sequencing lives in a layer, not in the base pose.** The 58 ms
   hip→shoulder lead and the 245 ms hip→fist lead (doc 04 §2.3, `[MEAS]`) are an additive clip with
   a gain. Cost: one extra mixer action and the need to author the base pass in a
   *sequencing-neutral* form.
3. **The runtime is stateless except cloth.** Every damper, spring, hysteresis and blink in the
   research docs (pelvis-drop critical damping τ=0.08 s, head spring ω=14 ζ=1.0, wrinkle
   attack 0.05 s / release 0.9 s, blink every 3.5 s) is **evaluated at compile time** into a
   `NumberKeyframeTrack`. Cost: those systems can no longer react to runtime input. Benefit:
   `pose(t)` is provably a pure function of `t`, which is exactly what a scrubbable 360° player and
   a frame-accurate critic harness both require.

Explicit non-goals: no physics-driven balance, no runtime retargeting, no WebGPU, no
`onBeforeCompile` anywhere (doc 05 §2.3 — it is the one thing that makes a future WebGPU port
impossible, and it also breaks `GTAOPass`'s `MeshNormalMaterial` G-buffer, doc 05 §14.1 #24).

---

## 2. Module map and ownership blocks

Cross-block **imports** are free. Cross-block **edits** are forbidden. A block that needs a new API
from another block files a request against the owner; it never reaches in.

### 2.0 FROZEN CONTRACTS — written first, by one agent, then read-only

Nine files. `tools/verify-contracts.mjs` hashes them and fails CI on change without a
`docs/contracts/CHANGELOG.md` entry. Nothing in §2.1–§2.8 may start until `npm run contracts`
passes and `npm run typecheck` is clean against stubs.

| file | owns |
|---|---|
| `src/core/units.ts` | `H=1.75`, `H_CM=175`, `L=0.520*H`, `SIDE_SIGN`, all of doc 06 §1.1/§1.3/§1.4 anthropometry, doc 01 §10 constant block, the dyadic time grid constants |
| `src/core/rig.contract.ts` | 44-bone tree as data (`name`,`parent`,`offset`), `BONE_ORDER` (= `skinIndex` order), `CANONICAL_JOINT_MAP` (doc 07 §0.3 25 joints → BoneId), 15-capsule collider table (doc 06 §7.6) |
| `src/core/types.kata.ts` | `KataDef`, `MoveDef`, `StanceId`, `TechniqueId`, `FootfallRule`, `TempoClass`, `PauseClass`, `SimRule`, `HikiteForm`, `HandShape`, `PivotType` |
| `src/core/types.pose.ts` | `BoneId`, `Quat4`, `Vec3`, `PoseFrame`, `Channel`, `LayerId`, `CompiledClip`, `ClipBundle`, `MoveMark`, `PlantSpan` |
| `src/core/types.metrics.ts` | `MetricId` (61), `MetricGroup`, `MetricSpec`, `MetricSample`, `StepScore`, `Finding`, `Scorecard`, `Tier` |
| `src/core/types.render.ts` | `CameraPresetId`, `CameraTarget`, `QualityTier`, `RenderConfig`, `ComposerMode`, `MaterialSet` |
| `src/core/harness.contract.ts` | `KataHarness` (the `window.__kata` surface) + `HarnessProvider` |
| `src/core/ease.ts` | `kimeEase`, `kimeEaseVel`, `aFromPeak` (doc 04 §4.2 verbatim), `easeOutCubic`, `secondOrderSettle`, `criticalDampClosed`, `slerpErrorDeg`. Pure math, **zero** three.js import |
| `src/core/time.ts` | `TICK = 1/1024`, `BAKE_FLOOR = 1/64`, `BAKE_CEIL = 1/512`, `quantize(t)`, `dyadicGrid(t0,t1,level)` |

`src/core/ease.ts` and `src/core/time.ts` are pure and dependency-free so that
`src/eval/metrics.ts` (doc 07 §6.5 rule 3) and the baker can both use them.

### 2.1 Block A — RIG & MESH (`src/rig/**`)

| file | owns / exports |
|---|---|
| `src/rig/skeleton.ts` | builds the 44-bone `Bone` tree from `rig.contract`, T-pose→A-pose re-bake (doc 06 §4.1 G1–G5). `buildSkeleton(): RigHandle` |
| `src/rig/body.geometry.ts` | hybrid swept-ring torso/limbs (doc 06 §5.1 approach C), 4 loops per flexing joint (§5.2). `buildBody(radii): BufferGeometry` |
| `src/rig/head.geometry.ts` | cube-sphere head ~590 verts, eye sockets. `buildHead()` |
| `src/rig/hands.geometry.ts` | hand block + 2 finger bones + thumb; the 4 hand poses as local-quat sets (doc 03 §12). `buildHands()`, `HAND_POSES: Record<HandShape, Partial<Record<BoneId,Quat4>>>` |
| `src/rig/skinweights.ts` | doc 06 §5.3 steps 1–7 exactly: segment distance, visibility gate, `kappa=2.6`/`p=3`, top-4 prune, L1 normalize, 5× Laplacian λ=0.35, rigidify at 1.8·r. `computeSkinWeights()` |
| `src/rig/karateka.ts` | assembles `SkinnedMesh` in doc 05 §9.4 order; `frustumCulled=false`, `castShadow=true`; `toCreasedNormals(geom, PI/3)`; `geometry.computeTangents()` **[VERIFIED** `BufferGeometry.js:837`, requires index+position+normal+uv**]**. `buildKarateka(mats): Karateka` |
| `src/rig/twist.ts` | swing-twist split (doc 06 §3.2) + twist distribution 0.33/0.67/0.50 (§5.4 Fix 1). `splitSwingTwist`, `distributeTwist` |
| `src/rig/rom.ts` | doc 06 §3.1 clamp table + elliptic-cone clamp. `ROM_LIMITS`, `clampBone`, `clampAll` |
| `src/rig/helpers.ts` | deltoid slerp 0.5, clavicle scapulohumeral `0.33*max(0,abd-30)` (doc 06 §5.4 Fix 3b,c). `driveHelpers` |
| `src/rig/colliders.ts` | 15 capsules + floor plane from bone matrices; per-particle whitelist builder. `ColliderSet` |

### 2.2 Block B — POSE SOLVERS & IK (`src/solve/**`)

| file | owns / exports |
|---|---|
| `src/solve/twobone.ts` | doc 06 §6.1 analytic 2-bone IK: soften `s=0.97`, joint limit folded into step 2, pole-vector plane, two swings. `solveTwoBone(chain, target, pole, opts)` |
| `src/solve/stance.ts` | **THE stance table.** doc 01 §10 constant block + §3–§7. `STANCE_TABLE: Record<StanceId, StanceSpec>`, `solveStance(spec, heading, side): StancePose` |
| `src/solve/technique.ts` | **THE technique table.** doc 03 §13 END poses + §4–§10 keyframes + hikite HIP-A/TATE-B. `TECHNIQUE_TABLE`, `solveTechnique(id, side, ghFrame, tau): ArmTargets` |
| `src/solve/footplant.ts` | plant state machine, plant-lock, pivot descriptors (doc 06 §6.3). `PlantSolver`, `applyPlants(plants, t)` |
| `src/solve/pelvis.ts` | COM targeting gain 0.90 ≤3 iters (doc 06 §2.2); **closed-form** pelvis-drop response (doc 04 §7.4). `solvePelvisForWeight`, `pelvisDropClosedForm` |
| `src/solve/gaze.ts` | look-at chain 0.15/0.35/0.50, +0.090 s gaze lead, eye residual, deterministic blink (doc 06 §6.5). `solveGaze` |
| `src/solve/com.ts` | doc 06 §2 mass/COM table. `MASS_TABLE`, `computeCOM` |
| `src/solve/pole.ts` | doc 06 §6.2 pole-vector defaults per chain + per technique. `POLES` |

### 2.3 Block C — KATA DATA + CLIP COMPILER (`src/kata/**`, `src/clip/**`)

| file | owns / exports |
|---|---|
| `src/kata/taikyoku-shodan.ts` | 20 `MoveDef`s + ceremony (doc 02 §4.1/§4.2, §2). `TAIKYOKU_SHODAN: KataDef` |
| `src/kata/heian-shodan.ts` | 21 `MoveDef`s + ceremony (doc 02 §6.1/§6.2). `HEIAN_SHODAN: KataDef` |
| `src/kata/embusen.ts` | footfall rules R0–R5, coordinate generator, σ-symmetry + closure asserts (doc 02 §3.1/§3.2). `generateEmbusen`, `assertEmbusen` |
| `src/kata/tempo.ts` | tempo classes M1/N/F/T90/T180/T270/T135/D45, pause classes P0–P4, `tempoScale` on `T_prep`+`T_hold` only (doc 02 §1.4, doc 04 §6.2/§6.3). `buildTimeline(kata, tier): Timeline` |
| `src/kata/dynamics.ts` | per-technique `TechniqueDynamics` (doc 04 §10) + `CHANNELS` lead/tauP table (doc 04 §11). `DYNAMICS`, `CHANNELS`, `channelAlpha` |
| `src/clip/compile.ts` | the compiler. Segment cache, splice, seam assert, root track. `compileKata(kata, rig, tier): ClipBundle` |
| `src/clip/segment.ts` | content-addressed technique segment builder + cache key. `segmentKey`, `buildSegment` |
| `src/clip/sampler.ts` | adaptive dyadic quaternion bake + quaternion-aware compressor + `clip.validate()`. `bakeQuat`, `bakeNumber`, `bakeVec3`, `compressQuatTrack` |
| `src/clip/layers.ts` | L1 koshi, L2 kime, L3 breath, L4 gaze, L6 patch as additive clips via `AnimationUtils.makeClipAdditive`. `buildLayers(bundle): CompiledClip[]` |
| `src/clip/driver.ts` | `clothDriver` `NumberKeyframeTrack`s: `snapImpulse`, `limbAccel.*`, `pelvisDropIK`, `headSpring.*`, `blink`. `buildDriverTracks` |

### 2.4 Block D — TRANSPORT & PLAYER (`src/player/**`, `src/main.ts`, `index.html`)

| file | owns / exports |
|---|---|
| `src/player/transport.ts` | the clock. play/pause/seek/rate/loop-a-move/step-frame, dyadic quantization. `Transport` |
| `src/player/mixerhub.ts` | **the only file that touches `AnimationMixer`.** owns all actions, layer weights, `apply(tClip)`. `MixerHub` |
| `src/player/frame.ts` | the frozen 8-step frame order (§4.1). `FrameLoop` |
| `src/player/postmixer.ts` | orchestrates steps 3a–3h by calling block B; owns ordering only. `runPostMixer` |
| `src/player/labels.ts` | per-move label/count/technique/kiai HTML overlay driven by `MoveMark[]`. `LabelTrack` |
| `src/player/hud.ts` | timeline scrubber with chapter markers, rate control, lil-gui panel (layer weights, quality tier, camera presets). `buildHUD` |
| `src/player/app.ts` | boot sequence per doc 05 §15; installs the harness provider. `bootApp` |
| `src/main.ts` | 5 lines |
| `index.html` | canvas + overlay roots |

### 2.5 Block E — RENDER CORE (`src/render/**`)

| file | owns / exports |
|---|---|
| `src/render/renderer.ts` | `WebGLRenderer` construction + settings + resize (both `setSize` **and** `setPixelRatio`, doc 05 §14.1 #22). `createRenderer` |
| `src/render/composer.ts` | the exact pass chain, 3 modes. `createComposer`, `setComposerMode(mode)` |
| `src/render/lights.ts` | KEY/RIM/FILL + the PRACTICAL eye light; `scene.add(key.target)`. `createLightRig` |
| `src/render/shadow.ts` | Mode B per-frame refit from 24 bone positions + light-space texel snap. `refitShadow` |
| `src/render/env.ts` | procedural dojo env `Scene` + `PMREMGenerator.fromScene`, keeps the RT. `buildEnvironment` |
| `src/render/materials.ts` | **THE material factory.** Zero `onBeforeCompile`, zero `material.envMap`. `createMaterials(): MaterialSet` |
| `src/render/textures.ts` | procedural `CanvasTexture`/`DataTexture`: wood planks, gi twill normal (doc 06 §7.9), crease field, roughness variance. |
| `src/render/dojo.ts` | floor, gradient backdrop, embusen floor decal, wall/beam props. `buildDojo` |
| `src/render/camerarig.ts` | rig, 10 presets, 0.6 s blends, `snapTo`. `CameraRig`, `CAMERA_PRESETS` |

### 2.6 Block F — CLOTH (`src/cloth/**`)

| file | owns / exports |
|---|---|
| `src/cloth/solver.ts` | XPBD core, typed arrays, zero per-frame alloc, `n_sub=8`, 1 iter/substep (doc 06 §7.4/§7.5). `ClothSolver` |
| `src/cloth/constraints.ts` | distance / shear / dihedral bend / attachment / unilateral collision / LRA. |
| `src/cloth/garments.ts` | the 988-particle layout (sleeves 240, skirt 360, trousers 336, obi tails 52), pin rings, gi silhouette rules (doc 06 §7.3/§7.10). `buildGarments` |
| `src/cloth/collide.ts` | capsule tests + per-particle whitelist + AABB broad-phase extension (doc 06 uncertainty 17). `resolveCollisions` |
| `src/cloth/snapshot.ts` | snapshot table, lazy progressive build, seek/replay, NaN guard, teleport reinit (doc 06 §7.7). `ClothState` |
| `src/cloth/mesh.ts` | garment `BufferGeometry`, position/normal upload, wrinkle attribute + asymmetric hysteresis. `GarmentMesh` |

### 2.7 Block G — EVAL / METRICS (`src/eval/**`, `data/reference/**`)

| file | owns / exports |
|---|---|
| `src/eval/joints.ts` | canonical 25 joints incl. virtual `*FistCenter` at `0.030 H` past the wrist. `sampleCanonicalJoints` |
| `src/eval/metrics.ts` | all 61 metrics. **No three.js import beyond `Vector3`/`Quaternion`** (doc 07 §6.5). `METRIC_SPECS`, `computeMetrics` |
| `src/eval/score.ts` | doc 07 §6.3 verbatim + gates G-1…G-6. `scoreScorecard` |
| `src/eval/reference.ts` | loads `data/reference/*.ref.json`. `loadReference` |
| `src/eval/refpose.ts` | Channel B: FK the 25-joint reference skeleton, analytic IK to the ref targets. `buildReferencePose` |
| `src/eval/overlay.ts` | Channel B draw (stick + envelope + Procrustes variant + colours from doc 07 §6.6). `drawOverlay` |
| `src/eval/silhouette.ts` | white-on-black mask render + IoU (metric 60). `renderMask`, `iou` |
| `src/eval/annot.ts` | Channel C: load PD-1925 joint annotations, normalize by `H_px`, azimuth solve, MPJPE/PCK/limb-angle MAE. `scoreChannelC` |
| `src/eval/harness.ts` | implements `KataHarness` over a `HarnessProvider`; installs on `window.__kata`. `installHarness` |
| `data/reference/*.ref.json` | **generated**, never hand-typed (see risk 7) |
| `assets/reference/pd-1925/**` + `PROVENANCE.md` | the 16 PD Funakoshi plates + annotations (doc 07 §2.1, §6.7) |

### 2.8 Block H — TOOLS & CRITIC LOOP (`tools/**`, `docs/critic/**`, `data/routing.json`)

| file | owns |
|---|---|
| `tools/capture.mjs` | Playwright driver; `--profile fast|hero`, `--kata`, `--steps`, `--cameras`. Writes `captures/<sha>/` |
| `tools/scorecard.mjs` | boots the page, calls `harness.evaluate()`, writes `reports/<sha>/scorecard.{json,md}` + `regression.json`, exit code = gate result |
| `tools/contactsheet.mjs` | 4-panel strips → `contact-sheet.png` + `metrics.html` |
| `tools/critic-brief.mjs` | `reports/<sha>/critic-brief.md`: rubric + frame index + the VLM prompt template |
| `tools/fix-route.mjs` | joins `findings.json` × `data/routing.json` × `METRIC_SPECS.owners` → `reports/<sha>/routed.json` grouped **by ownership block** |
| `tools/gen-reference.mjs` | emits `data/reference/*.ref.json` from `STANCE_TABLE`+`TECHNIQUE_TABLE` so the scorecard can never disagree with the rig |
| `tools/verify-contracts.mjs` | freeze hashes; greps `src/` for `onBeforeCompile`, `material.envMap`, `PCFSoftShadowMap`, `new Clock(` |
| `tools/probe-webgl.mjs` | exists |
| `data/routing.json` | rubric-id → {block, files, symbol} for the ~20 rubric IDs with no numeric metric |
| `docs/critic/rubric.md`, `docs/critic/routing.md`, `docs/critic/reference-overrides.md` | |

`tools/*.mjs` are **not** typechecked (`tsconfig.include` has no `allowJs`). Therefore no tool
duplicates domain logic: metrics run in-page via the harness, and the only data a tool needs
(`data/routing.json`) is plain JSON read by both sides.

### 2.9 Block/file count sanity

8 blocks, 62 source files, 9 frozen. Largest block is E (9 files); smallest is F (6). Every block
is one agent-session sized. No file appears in two blocks.

---

## 3. Data formats — real declarations

### 3.1 Kata data (`src/core/types.kata.ts`)

```ts
export type StanceId =
  | 'heisoku' | 'musubi' | 'heiko' | 'hachiji'
  | 'zenkutsu' | 'ashi-zenkutsu' | 'hiza-kutsu'
  | 'kokutsu' | 'kiba' | 'han-zenkutsu' | 'moto';

export type TechniqueId =
  | 'gedan-barai'
  | 'chudan-oi-zuki'
  | 'jodan-age-uke'
  | 'chudan-shuto-uke'
  | 'tettsui-tate-mawashi-uchi'
  | 'yoi-gedan-kamae'
  | 'rei'
  | 'none';

export type Side        = 'L' | 'R';
export type Level       = 'jodan' | 'chudan' | 'gedan';
export type HikiteForm  = 'HIP-A' | 'TATE-B' | 'NONE';
export type HandShape   = 'seiken' | 'shuto' | 'open' | 'nukite';
export type FootfallRule= 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type SimRule     = 'S1' | 'S2' | 'S3';
export type TempoClass  = 'M1' | 'N' | 'F' | 'T90' | 'T180' | 'T270' | 'T135' | 'D45';
export type PauseClass  = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type PivotType   = 'BALL' | 'HEEL' | 'WHOLE_FOOT';
export type TempoTier   = 'T0' | 'T1' | 'T2' | 'T3';

/** Embusen coordinate, units of L (= 0.520·H = 0.910 m). doc 02 §1.1 */
export interface EmbusenPoint { readonly x: number; readonly z: number; }

/** One kata count. 41 of these exist in the whole project (20 + 21). */
export interface MoveDef {
  readonly n: number;
  /** signed deg; + = toward the character's LEFT = CCW about +Y. doc 02 §1 */
  readonly dH: number;
  readonly H: number;                 // resulting heading 0..360
  readonly rule: FootfallRule;
  readonly pivot: Side | null;        // planted foot, zero translation
  readonly pivotType: PivotType;
  readonly mover: Side;
  readonly stance: StanceId;
  readonly front: Side;
  readonly weighted: Side;            // === front for zenkutsu, rear for kokutsu
  readonly tech: TechniqueId;
  readonly arm: Side;
  readonly level: Level;
  readonly targetH: number;           // fraction of H
  readonly hikite: HikiteForm;
  readonly handShape: HandShape;
  readonly kiai: boolean;
  readonly tempo: TempoClass;
  readonly pause: PauseClass;
  readonly sim: SimRule;
  readonly ff: EmbusenPoint;          // front foot centre
  readonly rf: EmbusenPoint;          // rear foot centre
  readonly c: EmbusenPoint;           // stance centre = canonical embusen point
  /** Present on 3 of 41 moves. Heian 4 is the only footExcursion. */
  readonly override?: Readonly<Partial<{
    stanceLenH: number;
    stanceWidthH: number;
    pelvisYawDeg: number;
    /** doc 02 §6.2 move 4: front foot slides back 0.50 L at tau, returns by kime. */
    footExcursion: { readonly atTau: number; readonly deltaL: number };
    /** doc 04 §5.1 recoil override, fraction of path length L. */
    recoil: number;
  }>>;
}

export interface CeremonyPhase {
  readonly id: 'REI_IN' | 'ANNOUNCE' | 'YOI' | 'SET'
             | 'FINAL_HOLD' | 'YAME' | 'SETTLE' | 'ATTENTION' | 'REI_OUT';
  readonly stance: StanceId;
  readonly durationS: number;
}

export interface KataDef {
  readonly id: 'taikyoku-shodan' | 'heian-shodan';
  readonly displayName: string;
  readonly moveCount: 20 | 21;
  readonly kiaiAt: readonly number[];                            // [8,16] / [9,17]
  readonly fastPairs: readonly (readonly [number, number])[];    // [[7,8],[15,16]] etc.
  readonly opening: readonly CeremonyPhase[];
  readonly moves: readonly MoveDef[];
  readonly closing: readonly CeremonyPhase[];
  /** kata-only nominal seconds at T1 (excl. ceremony): 35.25 / 39.75. doc 02 §4.1/§6.1 */
  readonly nominalS: number;
}

/** doc 04 §11 — one record per technique instance, consumed by the compiler. */
export interface TechniqueDynamics {
  readonly Ttech: number; readonly Tthrust: number;
  readonly Tprep: number; readonly Tkime: number; readonly Thold: number;
  readonly dPsiDeg: number;                       // signed by stance side
  readonly omegaPsi: number;                      // deg/s, ship value
  readonly channels: Readonly<Record<ChannelName, { tauP: number; leadMs: number }>>;
  readonly recoil: number;                        // fraction of L
  readonly kiai: boolean;
}

export type ChannelName =
  | 'rearFootDrive' | 'comTranslate' | 'pelvisYaw' | 'hikite'
  | 'thoraxYaw' | 'shoulderGirdle' | 'elbowExtend' | 'wristLock' | 'forearmRoll';
```

### 3.2 Pose / keyframe representation (`src/core/types.pose.ts`)

```ts
/** three.js order: x,y,z,w. */
export type Quat4 = readonly [number, number, number, number];
export type Vec3  = readonly [number, number, number];

export type BoneId =
  | 'root' | 'pelvis'
  | 'spine_01' | 'spine_02' | 'spine_03' | 'chest'
  | 'neck_01' | 'head' | 'head_end' | 'eye_L' | 'eye_R'
  | 'clavicle_L' | 'upperarm_L' | 'upperarm_twist_L' | 'deltoid_L'
  | 'lowerarm_L' | 'lowerarm_twist_01_L' | 'lowerarm_twist_02_L'
  | 'hand_L' | 'fingers_prox_L' | 'fingers_dist_L' | 'fingers_end_L'
  | 'thumb_L' | 'thumb_end_L'
  | 'thigh_L' | 'thigh_twist_L' | 'calf_L' | 'calf_twist_L'
  | 'foot_L' | 'ball_L' | 'toe_end_L'
  // …_R mirrors of every *_L above (20 more) …
  ;

/** A resolved skeletal pose. Sparse — absent bones are rest (identity local). */
export interface PoseFrame {
  readonly t: number;                                     // clip-local seconds
  readonly rootPos: Vec3;                                 // metres, world
  readonly rootQuat: Quat4;
  readonly local: Readonly<Partial<Record<BoneId, Quat4>>>;   // bone-LOCAL rotations
  readonly chestScale?: Vec3;                             // breath; default (1,1,1)
}

/**
 * Authoring-time continuous channel. The baker samples this; nothing else may read it.
 * `evaluate` MUST be a pure function of t (this is enforced by a determinism test that
 * calls evaluate twice in shuffled order and compares bitwise).
 */
export interface Channel<K extends 'quat' | 'number' | 'vec3' = 'quat'> {
  readonly id: string;
  readonly kind: K;
  /** three.js track path, e.g. 'pelvis.quaternion', 'chest.scale', 'clothDriver.snap'. */
  readonly target: string;
  readonly t0: number;
  readonly t1: number;
  readonly tauP: number;                                  // doc 04 §4.3
  evaluate(t: number): K extends 'quat' ? Quat4 : K extends 'vec3' ? Vec3 : number;
  /** Intervals where the baker must refine below BAKE_FLOOR. Roll snaps, kime, hip snap. */
  readonly snapWindows: readonly (readonly [number, number])[];
}

export type LayerId = 'base' | 'koshi' | 'kime' | 'breath' | 'gaze' | 'patch';

export interface CompiledClip {
  readonly clip: import('three').AnimationClip;
  readonly layer: LayerId;
  readonly additive: boolean;
  readonly defaultWeight: number;
  readonly minWeight: number;
  readonly maxWeight: number;
}

export interface MoveMark {
  readonly n: number;                    // 0 = yoi, 1..21 = moves, 99 = yame
  readonly label: string;                // "3 — migi gedan-barai"
  readonly labelJp: string;              // "右下段払い"
  readonly tStart: number;               // first mechanical motion
  readonly tKime: number;                // THE authoritative pose; all G1/G2 metrics sample here
  readonly tHoldEnd: number;
  readonly kiai: boolean;
  readonly stance: StanceId;
  readonly tech: TechniqueId;
  readonly arm: Side;
}

/** Pure data the foot IK reads; no runtime state. */
export interface PlantSpan {
  readonly foot: Side;
  readonly tIn: number;
  readonly tOut: number;
  readonly worldPos: Vec3;
  readonly worldYawDeg: number;
  readonly pivot: {
    readonly type: PivotType;
    readonly point: Vec3;
    readonly fromDeg: number;
    readonly toDeg: number;
    readonly tPivot0: number;
    readonly tPivot1: number;
  } | null;
}

export interface ClipBundle {
  readonly kataId: string;
  readonly tempoTier: TempoTier;
  /** Exact multiple of BAKE_FLOOR (1/64 s). */
  readonly durationS: number;
  readonly clips: readonly CompiledClip[];
  readonly marks: readonly MoveMark[];
  readonly plants: readonly PlantSpan[];
  readonly bakeStats: {
    readonly segments: number; readonly segmentsUnique: number;
    readonly tracks: number; readonly keys: number;
    readonly bytes: number; readonly ms: number;
    readonly maxSlerpErrDeg: number;      // gate: < 0.25
    readonly maxSeamErrDeg: number;       // gate: < 0.50
  };
}
```

### 3.3 Metric scorecard (`src/core/types.metrics.ts`)

```ts
export type MetricGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

/** All 61 ids of doc 07 §6.2, verbatim names. */
export type MetricId =
  // G1 stance & base (17)
  | 'stance_len_H' | 'stance_width_H' | 'front_knee_flex_deg' | 'rear_knee_flex_deg'
  | 'knee_over_toe_H' | 'hip_height_H' | 'weight_front_pct' | 'front_foot_yaw_deg'
  | 'rear_foot_yaw_deg' | 'rear_heel_gap_H' | 'pelvis_yaw_deg' | 'shoulder_pelvis_diff_deg'
  | 'torso_pitch_deg' | 'torso_roll_deg' | 'head_height_H' | 'head_yaw_deg' | 'head_bob_H'
  // G2 upper-body technique (23)
  | 'active_fist_H' | 'active_fist_lateral_H' | 'arm_extension_ratio' | 'punch_elbow_flex_deg'
  | 'wrist_break_deg' | 'fist_roll_deg' | 'hikite_fist_H' | 'hikite_lateral_H'
  | 'hikite_back_H' | 'hikite_elbow_flex_deg' | 'hikite_present' | 'shoulder_elevation_H'
  | 'gedan_barai_fist_H' | 'gedan_barai_fist_over_knee_H' | 'gedan_barai_forearm_incline_deg'
  | 'age_uke_wrist_H' | 'age_uke_forward_H' | 'age_uke_forearm_angle_deg'
  | 'shuto_uke_hand_H' | 'shuto_uke_elbow_flex_deg' | 'shuto_uke_support_hand_H'
  | 'tettsui_uchi_fist_H' | 'finger_curl_state'
  // G3 embusen & orientation (5)
  | 'facing_yaw_err_deg' | 'embusen_pos_err_H' | 'embusen_return_err_H'
  | 'step_path_lateral_dev_H' | 'turn_pivot_foot_slip_H'
  // G4 timing & dynamics (9)
  | 'move_duration_s' | 'kime_hold_s' | 'kata_total_s' | 'peak_fist_speed_Hps'
  | 'kime_decel_time_s' | 'hip_lead_lag_s' | 'accel_profile_skew'
  | 'double_support_frac' | 'kiai_frame_alignment_s'
  // G5 rendering & integrity (7)
  | 'foot_slide_Hps' | 'ground_penetration_H' | 'float_gap_H' | 'self_intersection_count'
  | 'bone_length_drift_pct' | 'silhouette_IoU' | 'contact_shadow_present';

export interface MetricSpec {
  readonly id: MetricId;
  readonly group: MetricGroup;
  readonly unit: 'H' | 'deg' | 's' | 'pct' | 'Hps' | 'ratio' | 'bool' | 'count';
  readonly ref: number;
  readonly tol: number;
  readonly hardFail: number;
  /** Only one side of the tolerance is penalised (e.g. rear_heel_gap, head_bob). */
  readonly oneSided?: 'above' | 'below';
  /** Any failure here fails gate G-2 regardless of score. doc 07 §6.3 */
  readonly fatalOnFail?: true;
  readonly weight: number;
  /** Which stances/techniques this metric applies to; undefined = always. */
  readonly appliesTo?: { stances?: readonly StanceId[]; techs?: readonly TechniqueId[] };
  /** Per-stance / per-level reference overrides. doc 07 §6.2 alternate-stance table. */
  readonly refByStance?: Readonly<Partial<Record<StanceId, { ref: number; tol: number }>>>;
  readonly refByLevel?: Readonly<Partial<Record<Level, { ref: number; tol: number }>>>;
  /** OWNERSHIP: files a fix agent should open. Consumed by tools/fix-route.mjs. */
  readonly owners: readonly string[];
  /** Rubric ids in doc 07 §6.8 that this metric backs, e.g. ['A1','B?']. */
  readonly rubric: readonly string[];
  readonly docRef: string;                    // '07 §6.2 G1#1' / '01 §9.1 Z3'
}

export interface MetricSample {
  readonly id: MetricId;
  readonly value: number;
  readonly ref: number;
  readonly tol: number;
  readonly delta: number;                      // signed value - ref
  readonly score: number;                      // 0..100, doc 07 §6.3
  readonly fatal: boolean;
}

export interface StepScore {
  readonly step: number;                       // 0 = yoi, 1..21, 99 = yame
  readonly tKime: number;
  readonly stance: StanceId;
  readonly tech: TechniqueId;
  readonly groups: Readonly<Record<MetricGroup, number>>;
  readonly score: number;
  readonly metrics: readonly MetricSample[];
}

export type Tier = 'A' | 'B' | 'C';

export interface Finding {
  readonly tier: Tier;
  readonly rubricId: string;                   // 'A3' | 'B8' | 'C11'
  readonly metricId: MetricId | null;
  readonly step: number;
  readonly camera: CameraPresetId;
  readonly observation: string;
  readonly suggestedFix: string;
  /** Filled by tools/fix-route.mjs only. Critics never write this. */
  readonly route?: {
    readonly block: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'FROZEN';
    readonly files: readonly string[];
    readonly symbol?: string;
  };
}

export interface Scorecard {
  readonly schema: 'kata-scorecard/1';
  readonly gitSha: string;
  readonly contractHash: string;
  readonly threeRevision: string;              // '185'
  readonly kataId: string;
  readonly tempoTier: TempoTier;
  readonly qualityTier: QualityTier;
  readonly captureProfile: 'fast' | 'hero';
  readonly createdIso: string;
  readonly steps: readonly StepScore[];
  readonly scoreKata: number;                  // mean of steps
  readonly channelC: {
    readonly mpjpe2d_H: number; readonly pck_H: number;
    readonly limbAngleMaeDeg: number; readonly n: number;
  } | null;
  readonly gates: Readonly<Record<'G1'|'G2'|'G3'|'G4'|'G5'|'G6', boolean>>;
  readonly findings: readonly Finding[];
  /** score delta per metric vs the previous sha; < -5 fails CI. doc 07 §6.3 */
  readonly regression: Readonly<Partial<Record<MetricId, number>>> | null;
  readonly bake: ClipBundle['bakeStats'];
  readonly pass: boolean;
}
```

---

## 4. Runtime architecture

### 4.1 The frame loop — frozen order

```
frame(dtWall):                                             // renderer.setAnimationLoop
 1  t = transport.tick(dtWall)                             // dyadic-quantized clip seconds
 2  mixerHub.apply(t)                                       // ← the whole pose in one call
      for (a of actions) { a.time = t; }                    // paused=true, enabled=true
      mixer.update(0)                                       // exactly once per frame
      // writes: root.position, root.quaternion, 44× bone.quaternion,
      //         chest.scale, clothDriver.{snap,limbAccel*,pelvisDropIK,headSpring*,blink}
 3  runPostMixer(t)                                         // pure; reads only t + bone state
      3a  applyPlants(bundle.plants, t)                     // plant-lock targets, pivot rotation
      3b  pelvis.y += clothDriver.pelvisDropIK              // TABLE READ, pre-damped at bake
      3c  legIK  ×2   (twobone, pole = footForwardHorizontal, knee clamp folded in)
      3d  ankleAim ×2 (pitch ∈ [-25,+40], roll ±15)
      3e  armIK   0–2 (only chudan-shuto-uke ×4 and tettsui ×1; all zuki are FK)
      3f  distributeTwist()                                 // 0.33/0.67 forearm, 0.5 others
      3g  driveHelpers()                                    // deltoid slerp, clavicle rhythm
      3h  clampAll()                                        // swing-twist ROM, skip knee/elbow
 4  skeleton.update()                                       // boneTexture upload
 5  cloth.step(t)                                           // reads FINAL matrices of THIS frame
 6  refitShadow()                                           // Mode B + light-space texel snap
 7  cameraRig.update(dtWall); controls.update()
 8  composer.render(dtWall)
```

Doc 06 §6.4 layers L0–L2, L7 (helpers), L8 (look-at) are **absent from the runtime** — they were
baked into the clip at compile time. L3 (COM solve), L4 (leg IK), L5 (arm IK), L6 (twist), L9 (ROM),
L10, L11 survive as 3b–3h/4/5. That is the whole point of the clip pipeline: the expensive,
easing-sensitive, order-sensitive work happens once, offline, with unlimited time budget.

### 4.2 IK layering and conflict resolution

Three tiers, resolved in exactly this order, never iterated to convergence (doc 06 §6.4 note —
convergence loops produce frame-rate-dependent jitter):

| tier | who wins | mechanism |
|---|---|---|
| 1. **Baked FK** | the clip | `mixer.update(0)` writes every bone local quaternion |
| 2. **Constraint IK** | overrides tier 1 on the solved chain only | legs always; arms only where the technique declares a contact point. Blend weight per bone, in **local** space (doc 06 §6.1 step 7) so the parent's blended result composes |
| 3. **ROM clamp** | overrides tiers 1–2 | swing-twist elliptic cone. **No-op on knee/elbow** because their limits are folded into the two-bone solve (§6.1 step 2), so the endpoint is never broken by a post-clamp |

Residual endpoint error after clamping is **reported, not corrected** — written to
`clothDriver.ikResidual` and surfaced as metric `bone_length_drift_pct`. If a leg needs more than
`0.030 H` (5.2 cm) of IK correction the *keyframe* is wrong, not the IK (doc 06 §6.3), and the
compiler emits a build warning naming the move.

Arm IK is deliberately rare: 5 of 41 moves. `chudan-oi-zuki` and `gedan-barai` and `jodan-age-uke`
are pure FK from the baked technique segment, because doc 03 authors them as GH-relative end-effector
positions that the compiler already solved analytically at bake time. Running IK on them at runtime
would only re-introduce solver noise.

### 4.3 The layer stack

One `AnimationMixer` on the `SkinnedMesh` root. Six actions. `MixerHub` is the only file that
imports `AnimationMixer`.

| # | clip | blend | tracks | default w | GUI range | what it fixes |
|---|---|---|---|---|---|---|
| L0 | `base.<kata>` | Normal | `root.position` (Vector3), `root.quaternion`, 44× `<bone>.quaternion` | 1.0 | locked | correct-but-neutral kata: stances, embusen, technique end poses, kime ease |
| L1 | `layer.koshi` | **Additive** | `pelvis`, `spine_01..chest` quaternion deltas | 1.0 | 0…1.5 | late hip snap (hold to τ=0.55, 90 % by 0.92, easeOutCubic — doc 01 §8.3) + thoracic whip lag `c=[0.10,0.18,0.26,0.30]`, τ=0.055 s (doc 06 §6.4 L2). **Rubric A3 maps here.** |
| L2 | `layer.kime` | **Additive** | acting arm chain, `pelvis`, `chest`, `head` | 1.0 | 0…1.5 | terminal snap + one readable bounce per doc 04 §5.1: fist 0.012–0.020 L, elbow 1.5–3°, pelvis 1.5–3° (ω 30–42, ζ 0.35), thorax 2–4°, head 0.5–1.2°. **Rubric A4/C4 map here.** |
| L3 | `layer.breath` | **Additive** | `spine_01/03`, `chest` quaternion + `chest.scale` (Vector3) | 0.8 | 0…1.5 | doc 04 §8.2: ribcage 1.022 inhale / 0.994 kiai, clavicle rise ≤0.008 H, abdomen leads chest 60–120 ms. **Rubric C5.** |
| L4 | `layer.gaze` | **Additive** | `chest`, `neck_01`, `head`, `eye_L/R` | 1.0 | 0…1.5 | +0.090 s gaze lead, 0.15/0.35/0.50 distribution, owl-neck gate at \|yaw\|>45°, deterministic blink. **Rubric A8.** |
| L6 | `layer.patch` | **Additive** | sparse, author-populated | **0.0** | 0…1 | the critic patch channel: per-bone per-time corrective deltas, shipped empty. Lets a fix agent land a targeted correction without editing `moves.ts` and colliding with block C. |

`clothDriver` is **not** a layer — its `NumberKeyframeTrack`s live inside `base` and bind to a plain
`Object3D` named `clothDriver` parented under the scene, so they seek with everything else.

Additive construction: build each layer clip with frame 0 = the neutral delta (identity
quaternions, `chest.scale = (1,1,1)`), then
`AnimationUtils.makeClipAdditive(clip, 0, clip, 64)` **[VERIFIED** signature
`makeClipAdditive(targetClip, referenceFrame=0, referenceClip=targetClip, fps=30)`,
`AnimationUtils.js:251`; it subtracts the value at `referenceFrame/fps` and skips `bool`/`string`
tracks**]**. Because our frame 0 is already neutral the subtraction is a no-op, which is exactly
what we want — it just sets `blendMode = AdditiveAnimationBlendMode` semantics correctly and keeps
the code path canonical. Actions are created with the explicit third argument:
`mixer.clipAction(clip, root, AdditiveAnimationBlendMode)`.

### 4.4 Cloth update

Cloth is the **only** stateful subsystem, and it is fenced by an explicit contract.

* Solver: XPBD, 988 particles, `n_sub = 8`, `dt_s = 1/480 s` **fixed** (never scaled by playback
  rate — doc 06 §7.7), 1 iteration per substep, `lambda` reset per substep, colliders lerped to
  `(step+0.5)/n_sub`. Budget 1.10 ms, hard cap 1.50 ms.
* Slow motion: at `rate = 0.25` the transport advances `t` slowly but cloth still runs at the *clip*
  rate — i.e. the number of substeps per second of *clip time* is constant. Cloth in slow-mo is
  therefore genuinely slow, not merely interpolated. This is a quality win and it is free.
* Snapshots: uniform cadence `4 Hz` of clip time (not per-keyframe — uniform makes the index a
  floor-division and the seek cost bounded). `988 × 6 × 4 B = 23.7 kB` each; Taikyoku 50.15 s → 201
  snapshots → **4.77 MB**; Heian 54.65 s → 219 → **5.19 MB**. Snapshot also carries the wrinkle
  hysteresis state, because that is stateful too.
* Snapshots are built **lazily and progressively** on a 2 ms/frame idle budget, forward from t=0.
  A full build costs `50 s × 60 fps × 1.1 ms ≈ 3.3 s` of CPU, which is unacceptable at boot and
  invisible when amortised over ~30 s of viewing.
* Seek: `i = floor(t*4)`; if snapshot `i` exists, restore and fast-forward `≤ 0.25 s` (15 frames ×
  8 substeps ≈ 9–16 ms — one visible hitch, acceptable). If it does not, fast-forward from the
  newest earlier snapshot up to a 2.0 s cap; beyond that, pin all particles to their skinned rest
  positions and re-settle over 0.35 s.
* While the user is *dragging* the scrub handle, cloth runs in `pinned` mode (particles = skinned
  rest, zero cost) and re-simulates on release. This is why the scrubber feels instant.
* Robustness per doc 06 §7.7: `|Δp_pin| > 0.05·H` in one frame ⇒ reinit that garment;
  `!isFinite` ⇒ reset that particle; on a long frame run at most 3 extra frame-steps then drop.

**The load-bearing insulation: no scorecard metric reads cloth state.** All 61 metrics of doc 07
§6.2 are computed from the 25 canonical joints or from a render (metrics 60, 61), never from
garment vertices. So cloth's approximation-on-scrub cannot corrupt the critic loop. And the harness
exposes `seek(t, { exact: true })`, which always replays cloth from `t = 0` at a fixed `1/60` frame
step with rendering off — used for every capture, where 3 s of warm-up is free.

### 4.5 Camera rig

`CameraRig` owns one `PerspectiveCamera` and one `OrthographicCamera` and a `CameraTarget`
(`position`, `lookAt`, `fovDeg | orthoHeight`, `roll`). Ten presets:

| id | kind | spec |
|---|---|---|
| `orbit` | persp | `OrbitControls`, `enableDamping=true`, `dampingFactor=0.05`, `target=(0,0.9625,0)`, `minDistance=1.6`, `maxDistance=9.0`, `minPolarAngle=0.15`, `maxPolarAngle=1.52` (doc 05 §13) |
| `hero` | persp | fov 39.6° (35 mm), doc 07 CAM_HERO `(1.6H, 0.95H, 2.2H)`; **follows the pelvis XZ** with a 0.35 s critically-damped lag, y locked |
| `judge` | persp | fov 27.0° (50 mm), static at `(0, 1.55, +6.0)` on the opening facing axis. The "does it read as karate" camera |
| `embusen` | ortho | top-down, `orthoHeight = 4.2 m` (the 4 L × 4 L = 3.64 m box + margin), floor trace overlay |
| `detail.hands` | persp | fov 16.1° (85 mm), target = acting fist, distance 1.4 m |
| `detail.feet` | persp | fov 16.1°, target = front ankle, distance 1.1 m |
| `m.front` `m.left` `m.right` | ortho | doc 07 §6.6 **frozen forever**: `(0,0.5H,+3H)` / `(+3H,0.5H,0)` / `(−3H,0.5H,0)`, `orthoHeight = 2.2H`, aspect 1:1, near 0.1H, far 10H |
| `m.top` | ortho | `(0,4H,0)` looking down, up = `−Z`, same frustum |

Preset changes blend over 0.6 s (`easeOutCubic` on position/target, linear on fov). The harness calls
`rig.snapTo(preset)` — **no blend**, because a blending camera makes captures non-deterministic.
Measurement cameras are orthographic on purpose: perspective foreshortening corrupts every length
read off an image (doc 07 §6.6).

The `hero` follow lag is closed-form (`criticalDampClosed` from the frozen ease module) evaluated
against the *baked* pelvis XZ track, so hero-camera captures are also a pure function of `t`.

### 4.6 Transport model and why arbitrary seek is exact

```ts
export class Transport {
  readonly duration: number;            // exact multiple of 1/64 s
  private tRaw = 0;
  t = 0;                                // quantized, the only value anyone may read
  rate = 1;                             // -2 … +2
  playing = false;
  loop: { t0: number; t1: number } | null = null;   // loop-a-move

  tick(dtWall: number): number {
    if (this.playing) {
      const dt = Math.min(dtWall, 1 / 15);          // never integrate a >66 ms hitch
      this.tRaw += dt * this.rate;
      this.tRaw = this.loop
        ? this.loop.t0 + mod(this.tRaw - this.loop.t0, this.loop.t1 - this.loop.t0)
        : mod(this.tRaw, this.duration);
    }
    this.t = Math.round(this.tRaw / TICK) * TICK;   // TICK = 1/1024 s
    return this.t;
  }
  seek(t: number) { this.tRaw = clamp(t, 0, this.duration); this.tick(0); }
  stepFrames(n: number) { this.seek(this.t + n / 64); }
  loopMove(m: MoveMark) { this.loop = { t0: m.tStart - 0.15, t1: m.tHoldEnd }; this.seek(this.loop.t0); }
}
```

**Everything is dyadic.** `TICK = 1/1024 s`, bake floor `1/64 s` (64 Hz), bake ceiling `1/512 s`
(512 Hz), refinement by halving. All of these are exactly representable in float64, so:

* every quantized transport time is either *exactly on* a baked key or *exactly at* a key midpoint —
  the interpolant's binary search can never land on a different side of a key depending on how you
  arrived at `t`;
* `slerp` receives exactly the same `alpha` (0, 0.5, 0.25, …) every time;
* clip duration is a multiple of `1/64`, so the `LoopRepeat` wrap is exact.

Determinism is then a four-line proof, each line an assertion in
`tests/player/determinism.spec.ts`:

1. **Steps 1–4 and 3a–3h read only `t`.** No accumulators, no `Date.now`, no `Math.random`. Every
   damper/spring/blink from the docs was compiled to a `NumberKeyframeTrack`
   (`pelvisDropIK`, `headSpring.yaw/pitch`, `blink`) — this is the single most important design
   decision for seekability and it is why §4.1 step 3b is a *table read*.
2. `poseAt(t)` reached by cold `seek(t)` is **bitwise identical** to `poseAt(t)` reached by playing
   from 0, and to `poseAt(t)` reached by seeking backwards from `t + 5`. Asserted over 44
   quaternions + `rootPos`, at 64 sampled `t` values per kata.
3. Calling `mixer.update(0)` twice at the same `t` yields the same bone state (guards the
   `_accuIndex` toggle in `AnimationMixer.update`).
4. Cloth: `clothAt(t, exact)` is a pure function of `t`; `clothAt(t, approx)` is explicitly labelled
   approximate and is read by **no metric**.

The seek idiom itself is now verified against the installed tree, not just doc 05:
`AnimationAction._update` early-returns when `!enabled` **[VERIFIED** `AnimationAction.js:564`**]**;
`_updateTimeScale` returns `0` while `paused` **[VERIFIED** `:675`, `if ( ! this.paused )` guards the
assignment**]**; `_updateTime(0)` returns `time` unchanged for `LoopRepeat`/non-pingPong
**[VERIFIED** `:734–740` — `if ( loopCount === -1 ) return time;` else
`return ( pingPong && (loopCount & 1) === 1 ) ? duration - time : time`**]**; and with `weight > 0`
both blend modes then run `interpolants[j].evaluate(clipTime)` followed by
`accumulateAdditive(weight)` / `accumulate(accuIndex, weight)` **[VERIFIED** `:601–630`**]**.
So `paused = true; enabled = true; time = t; mixer.update(0)` provably evaluates and applies **both**
Normal and Additive layers. `LoopRepeat` + `repetitions = Infinity` is still mandatory so the
`LoopOnce` clamp/disable traps (doc 05 §14.1 #5, #6) are unreachable.

### 4.7 The compiler and the bake

`compileKata(kata, rig, tier)` — deterministic, ~180 ms, runs at boot (or in a Worker; the output is
plain typed arrays so it transfers).

```
1  timeline = buildTimeline(kata, tier)          // 41 moves + ceremony → t_start/t_kime/t_hold
2  embusen  = generateEmbusen(kata)              // R0–R5, assert σ-symmetry + closure < 0.01 L
3  root tracks: ONE VectorKeyframeTrack(root.position) + ONE QuaternionKeyframeTrack(root.quaternion)
                for the whole kata, from the embusen table + the pelvis-yaw ease
4  for each move:
     key = segmentKey(tech, arm, level, stanceIn, stanceOut, dH, tempo, hikite)
     seg = cache.get(key) ?? buildSegment(...)   // bone-LOCAL quaternion channels only
5  splice segments into per-bone channel lists, then bake:
     for each channel: bakeQuat(ch)              // adaptive, see below
6  assert seams: quatAngle(segEnd[i], segStart[i+1]) < 0.50°  for all 40 seams
     on failure insert a 0.12 s easeInOut bridge and warn with the move number
7  compressQuatTrack(track, 0.25°)               // our own geodesic compressor
8  clip.optimize()                               // three's; exact-equality only, safe
9  clip.validate()                               // data-integrity gate
10 buildLayers(bundle) + buildDriverTracks(bundle)
```

**Why bone-local splicing is legal.** Doc 06 §0 mandates that every bone's rest local quaternion is
identity and direction is encoded purely in the child's offset vector. Local rotations are therefore
frame-of-reference-free and a technique segment authored once is byte-identical wherever it appears.
Reuse, measured:

| kata | moves | unique segments | reuse |
|---|---|---|---|
| Taikyoku Shodan | 20 | 8 | 2.5× |
| Heian Shodan | 21 | 14 | 1.5× |
| **combined** (`gedan-barai`, `chudan-oi-zuki` shared) | **41** | **18** | **2.3×** |

**The adaptive bake, and why a flat 60 Hz is wrong.** Doc 05 §10.2 recommends 60 keys/s, justified
against a ~700 °/s hip snap (11.7 °/key). But the fastest channel in this project is not the hip —
it is the forearm roll. Doc 03 §4.3 authors it as `roll(t) = 180·clamp((t−0.65)/0.35,0,1)^2.2` over a
0.18 s stroke. Differentiating: `dθ/dt = 180·2.2·u^1.2/(0.35·0.18)` → **6 285 °/s peak**, and
`d²θ/dt² ≈ 1.20 × 10⁵ °/s²`. Linear-interpolation error is `θ''·Δt²/8`:

| bake rate | Δt | max angular step on the roll | slerp error |
|---|---|---|---|
| 60 Hz (doc 05) | 16.7 ms | 105° | **4.16°** — the 180° corkscrew becomes a 3-frame linear spin |
| 128 Hz | 7.8 ms | 49° | 0.91° |
| 256 Hz | 3.9 ms | 25° | 0.23° |
| **512 Hz** | **1.95 ms** | **12°** | **0.057°** |

So: `bakeQuat` starts on the `1/64 s` dyadic grid and **recursively halves any interval whose
midpoint slerp error exceeds 0.25°**, down to `1/512 s`. Gate: `bakeStats.maxSlerpErrDeg < 0.25`.
Empirically this puts 64 Hz on ~92 % of the timeline and 256–512 Hz only inside the ~19 declared
snap windows per kata (each roll's last 35 %, each kime decel window, each hip snap window).

**Compression, and a correction to doc 05.** `AnimationClip.optimize()` forwards to
`KeyframeTrack.optimize()` **[VERIFIED** `AnimationClip.js:364`**]**, and that function keeps a key
unless it is **bit-identical to both neighbours** — `if ( value !== values[offsetP+j] || value !==
values[offsetN+j] ) keep = true` **[VERIFIED** `KeyframeTrack.js:503–514`**]**. So three's optimizer
is *safe* (it can never eat a moving key, contrary to what one might fear) but *weak* (it cannot
compress a slowly-drifting hold). Two consequences, both implementation directives:

* We run our **own** quaternion-aware compressor first: drop key `i` if
  `quatAngle(slerp(q[i−1], q[i+1], α_i), q[i]) < 0.25°`. This is the geodesically correct test.
* The baker must emit **bit-identical** quaternions during static holds (evaluate holds from one
  cached `Quat4`, do not recompute per key) so that three's `optimize()` actually fires on them.

Budget after compression, measured target: ~1.2 MB per kata (`~46 000` keys × 44 tracks-worth of
Float32 values + times), 180 ms compile. Both kata resident: 2.4 MB. That is the price of paying for
motion quality at compile time instead of at 60 Hz.

### 4.8 Frame budget (60 fps = 16.667 ms)

Revised from doc 06 §8 to reflect that hip whip, look-at and helper *sources* are baked out and
replaced by mixer track evaluation:

| system | ms | note |
|---|---|---|
| `mixer.update(0)`, 6 actions, ~300 tracks | 0.15 | ~10× doc 05 §10.5's "30 interpolants, negligible" |
| plants + pelvis table read | 0.03 | 3b is now a table read, not a filter |
| leg IK ×2 + ankle aim | 0.06 | ~0.9 µs per analytic two-bone solve |
| arm IK 0–2 chains | 0.03 | 5 of 41 moves only |
| twist + helpers | 0.04 | |
| ROM clamp, 44 bones swing-twist | 0.05 | |
| `skeleton.update()` + boneTexture | 0.10 | |
| **rig subtotal** | **0.46** | vs doc 06's 0.50 |
| cloth, 988 × 8 substeps | 1.10 | cap 1.50 |
| garment position/normal upload | 0.15 | |
| shadow refit (24 bone AABB + texel snap) | 0.02 | |
| **CPU subtotal** | **1.73** | |
| render (25 k tris, PBR, 2048² shadow, GTAO 24 spp, bloom, SMAA, output) | 8.00 | |
| **headroom** | **6.94** | |

---

## 5. Render pipeline

### 5.1 Renderer

`WebGLRenderer` (doc 05 §2.3 — one skinned figure at ~30 draw calls has no WebGPU throughput
argument, and `TAARenderPass` + the whole mature post chain are WebGL-only in this build):
`antialias:false`, `alpha:false`, `stencil:false`, `depth:true`, `powerPreference:'high-performance'`,
`reversedDepthBuffer:false` (doc 05 §14.1 #7 — the PCF branch has no reversed-depth guard),
`preserveDrawingBuffer:true` **only** in capture mode.
`setPixelRatio(min(devicePixelRatio, 2))`. `toneMapping = AgXToneMapping`,
`toneMappingExposure = 1.0`. Do **not** touch `outputColorSpace`. `shadowMap.enabled = true`,
`shadowMap.type = PCFShadowMap` set **explicitly** (never `PCFSoftShadowMap` — it mutates
`renderer.shadowMap.type` inside `render()`, doc 05 §14.1 #1). `Timer`, never `Clock` (deprecated
r183). `await renderer.compileAsync(scene, camera)` before the first frame.

### 5.2 Pass order (exact)

```
1  RenderPass | TAARenderPass | SSAARenderPass       ← mode-dependent, exactly one enabled
2  GTAOPass(scene, camera, w, h, params, aoParams, pdParams)
3  BokehPass(scene, camera, { focus, aperture: 0.0018, maxblur: 0.006 })   ← cinematic only
4  UnrealBloomPass(new Vector2(w,h), 0.22, 0.55, 0.92)
5  SMAAPass()                                        ← disabled in capture mode
6  OutputPass()                                      ← mandatory, applies tonemap + sRGB
7  LUTPass({ lut, intensity })                       ← optional final grade, off by default
```

Hard constraints, all from source (doc 05 §8.4): `OutputPass` tone-maps and sRGB-encodes, so
everything that must see linear light precedes it; `SMAAPass` operates in linear-srgb and must
precede `OutputPass` while `FXAAPass` needs sRGB and must follow it — **we ship SMAA and never add
FXAA**; `GTAOPass` multiplies AO into linear radiance so it precedes bloom; bloom must see
pre-tonemap HDR. `BokehPass` precedes bloom or bokeh disks won't bloom. `BokehPass.maxblur` is
always passed explicitly (ctor default 1.0 vs shader default 0.01 — a 100× discrepancy, doc 05
§14.1 #21). On resize call **both** `composer.setSize` and `composer.setPixelRatio` (doc 05 §14.1
#22).

Three composer modes (`setComposerMode`):

| mode | pass 1 | SMAA | when |
|---|---|---|---|
| `play` | `RenderPass` | on | `transport.playing` |
| `paused` | `TAARenderPass`, `accumulate = true` | on | paused / scrub released. 32 jitter samples, converges in 32 frames; also resolves the per-pixel IGN dither of PCF shadows (doc 05 §6.2, §14.1 #3) |
| `capture` | `SSAARenderPass`, `sampleLevel = 5` (32 samples, `unbiased = true`) | **off** | headless. One render call, no accumulation state — deterministic by construction |

### 5.3 Lighting rig for a dojo

Doc 05 §5, plus one addition:

| light | type | position (m) | intensity | colour | shadow |
|---|---|---|---|---|---|
| KEY | `DirectionalLight` | `(2.60, 4.20, 3.15)` — 45.8° elevation, 39.5° azimuth | 3.0 | `0xfff4e8` (≈5200 K) | **yes** |
| RIM | `DirectionalLight` | `(-2.10, 2.80, -3.85)` | 1.4 (0.47× key) | `0xdfe9ff` (≈7000 K) | no |
| FILL | `DirectionalLight` | `(-2.98, 1.58, 2.28)` | 0.55 (0.18× key) | white | no |
| **PRACTICAL** `[DERIVED — new]` | `DirectionalLight` | camera-relative: azimuth −25° from the view vector, elevation +12°, re-aimed each frame | **0.45** | `0xf6f2ee` | no |
| ambient wrap | `scene.environment` PMREM | — | `environmentIntensity = 0.85` | — | — |
| `AmbientLight` | **omitted** | | | | |

`scene.add(key.target)` is mandatory (doc 05 §14.1 #25). No `AmbientLight` — it flattens.

**Why PRACTICAL exists.** The karateka turns to 4 distinct headings across the embusen (H = 0, 90,
180, 270). A world-fixed key light is correct for a dojo window and must not move — but on the 5
moves at H = 180 the key becomes a pure back light and the face/chest go to `environmentIntensity`
alone. RIM at 0.47× plus IBL keeps the silhouette legible, but the *form* on the front plane dies.
The countermeasure is a low, camera-following eye light — standard film practice, capped at 0.45 so
it can never fight the key or invent a second shadow (it doesn't cast). Doc 05 prescribes no such
light; this is an art-direction addition and is flagged as such.

### 5.4 Shadow strategy

One directional shadow, tightly fitted. Doc 05 §6.4 Mode B, with the embusen number corrected.

| param | value | derivation |
|---|---|---|
| `mapSize` | `2048 × 2048` | quality/VRAM knee for one caster |
| **embusen AABB (corrected)** | **3.64 m × 3.64 m** in XZ, centred at `(−0.173, −1.820)` m | doc 02 §3.2: bounding box is 4.00 L × 4.00 L, `L = 0.910 m`. **Doc 05 §16 uncertainty 3 assumed 5.5 × 4.0 m — that is wrong; recompute Mode A as `S_fixed = 0.5·hypot(3.64,3.64)+0.2 = 2.77 m`, texel 2.70 mm** |
| Mode B half-extent `S_fit` | `0.75·H = 1.31 m` | fits a 1-figure AABB incl. extended limbs |
| world texel `t` | `2·1.31/2048 = 1.28 mm` | |
| `shadow.radius` | `4.0` texels | penumbra ≈ `2·4·1.28 = 10.2 mm` — a true contact shadow |
| `shadow.bias` | `0.0` | constant bias + normalBias ⇒ peter-panning |
| `shadow.normalBias` | `0.015 m` | ≈12× texel; tune 0.007–0.023 by eye |
| `shadow.intensity` | `0.92` | leaves a touch of light in the core so IBL fill reads |
| `near` / `far` | `0.10` / `12.0` m | |
| `blurSamples` | **not set** — VSM-only under PCF (doc 05 §14.1 #2) | |

Per-frame refit derives the AABB from **24 bone world positions inflated by a per-bone radius**, not
from `computeBoundingBox()` (which CPU-skins every vertex). Then
`shadow.camera.left/right/bottom/top = ±S_fit`, `updateProjectionMatrix()`, and **snap the shadow
camera position to the texel grid in light space** (`p = round(p/t)*t`) — three.js does not do this
and without it the shadow swims during orbit. Cost 0.02 ms.

Second layer of contact: `GTAOPass` with world-space `radius = 0.30 m`, `samples = 24`
(⇒ `DIRECTIONS = 3`, `STEPS = 8`), `scale = 1.15`, `blendIntensity = 0.85`, `pdRadius = 6`,
`screenSpaceRadius = false`, and `setSceneClipBox(new Box3(...))` bounded to the embusen
(`4.6 × 2.2 × 4.6 m` centred `(−0.17, 1.0, −1.82)`). This is the single biggest AAA-vs-hobby delta
for this scene (doc 05 §6.4) and it works on the skinned figure because `MeshNormalMaterial` honours
`USE_SKINNING` — which is exactly why no `ShaderMaterial` may exist in the scene.

Floor: `castShadow = false`, `receiveShadow = true`. Gi/skin: `castShadow = true`.
`shadowSide` left `null` (closed shells).

### 5.5 IBL

`PMREMGenerator.fromScene(dojoEnv, 0.04, 0.1, 40, { size: 512, position: (0, 0.9625, 0) })`.
`scene.environment = rt.texture`, `environmentIntensity = 0.85`,
`environmentRotation = Euler(0, −0.35, 0)`. `pmrem.dispose()` frees the generator, **not** the RT —
keep `rt` and dispose it on teardown (doc 05 §14.1 #29). Exactly one `PMREMGenerator` instance ever
(#30). `scene.background = Color(0x0e0f12)` plus a separate gradient backdrop mesh — never the PMREM
itself, which looks cheap. **No `material.envMap` anywhere**, ever, so `environmentIntensity` stays
the one global knob (#11) — enforced by `tools/verify-contracts.mjs`.

Env scene content (all procedural, `MeshBasicMaterial`/emissive so PMREM captures it directly):
14×7×14 `BackSide` shell `0x2a2723`; a 6.0×1.6 m warm window band at `y=3.6, x=+6.9`
(`0xfff2e0`, emissiveIntensity 6.0) aligned with KEY; a 3.0×1.2 m cool band at `x=−6.9`
(`0xdfe9ff`, 2.2); a 10×10 ceiling bounce at `y=6.9` (1.1); a 12×12 warm floor bounce at `y=0.02`.

### 5.6 Material list

All from `src/render/materials.ts`. Zero `onBeforeCompile`. Zero `ShaderMaterial`. Zero
`transmission` (it forces an entire extra scene render per frame, doc 05 §14.1 #13).

| id | class | key params |
|---|---|---|
| `gi` | `MeshPhysicalMaterial` | `color 0xf2f0ea`, `roughness 0.80`, `metalness 0`, **`sheen 0.55`, `sheenColor 0xEDE9DF`, `sheenRoughness 0.55`**, `ior 1.45`, `specularIntensity 0.35`, weave `normalMap` (`NoColorSpace`, `normalScale (0.60,0.60)`), crease `normalMap` blended by the wrinkle attribute, `side FrontSide` on the body shell / `DoubleSide` on skirt+sleeve+tails, `anisotropy 0.25` + `anisotropyRotation` along warp **(Phase 5 only, gated on `geometry.computeTangents()`)** |
| `skin` | `MeshPhysicalMaterial` | `roughness 0.48`, `metalness 0`, `sheen 0.15`, `sheenRoughness 0.85`, `ior 1.40`, `specularIntensity 0.6`, `normalScale (0.7,0.7)`. **No `SubsurfaceScatteringShader`** — it is Phong-based and a `ShaderMaterial` (doc 05 §11.1) |
| `floor` | `MeshStandardMaterial` | `color 0x7d5636`, `roughness 0.42`, `metalness 0`, procedural 2048² plank albedo (`SRGBColorSpace`) + `roughnessMap` + `normalMap` (`NoColorSpace`), `RepeatWrapping`, `anisotropy = min(8, capabilities.getMaxAnisotropy())` — mandatory at grazing angles |
| `obi` | `MeshPhysicalMaterial` | `color 0x141416`, `roughness 0.62`, `sheen 0.30`, `sheenRoughness 0.45`, `DoubleSide`, backface albedo ×0.72 |
| `backdrop` | `MeshBasicMaterial` | vertical-gradient `CanvasTexture`, `toneMapped: true` |
| `embusenDecal` | `MeshBasicMaterial` | transparent, `depthWrite:false`, `polygonOffset`, the "I" trace; toggled by the `embusen` camera preset |
| `mask.white` | `MeshBasicMaterial` | pure white, `toneMapped:false` — silhouette IoU renders (metric 60) |
| `debug.wire` | `MeshBasicMaterial` | `wireframe:true` |
| `env.emit` | `MeshStandardMaterial` | emissive; exists **only** in the PMREM source scene |

The gi `sheen` value is the one place I split a doc disagreement: doc 05 §11.1 says `sheen 1.0 /
sheenColor 0xffffff`, doc 06 §7.9 says `sheen 0.35 / sheenColor 0xE8E4DA` from cotton physics. They
differ by ~3× in effective sheen weight and neither is measured (doc 05 uncertainty 9, doc 06
uncertainty 14). I ship the geometric middle and expose it as a single **"cotton" slider** in
lil-gui, because only the Channel-D critic can settle it. Note `sheen` is nearly invisible without
`scene.environment` (doc 05 §14.1 #14) — tune it after IBL, never before.

---

## 6. The automated critic loop

### 6.1 The in-page harness (frozen contract)

`src/core/harness.contract.ts`:

```ts
export interface KataHarness {
  ready(): Promise<void>;
  listKata(): string[];
  load(kataId: string, o?: { tempoTier?: TempoTier; quality?: QualityTier }): Promise<void>;
  marks(): MoveMark[];
  /** exact:true replays cloth from t=0 at fixed 1/60 with rendering off. Default true. */
  seek(t: number, o?: { exact?: boolean }): Promise<void>;
  camera(preset: CameraPresetId): void;                 // snapTo, never blends
  setLayerWeight(layer: LayerId, w: number): void;
  /** Renders n frames in `capture` mode and resolves when the buffer is stable. */
  settle(frames?: number): Promise<void>;
  joints(): Record<string, [number, number, number]>;   // canonical 25, world metres
  /** The ONLY numeric source of truth. Runs the full 61-metric pass over the whole kata. */
  evaluate(o?: { channelC?: boolean }): Promise<Scorecard>;
  mask(): string;                                       // dataURL, white-on-black silhouette
  overlay(step: number, camera: CameraPresetId): string;// dataURL, 4-panel strip
  version(): { three: string; sha: string; contractHash: string };
}
```

`src/player/app.ts` (block D) constructs a `HarnessProvider` and calls
`installHarness(provider)` from block G. That single indirection is why G can be built in parallel
with D.

### 6.2 Capture: labelled frames at prescribed timestamps × camera angles

`tools/capture.mjs`, Playwright + headless Chromium with the flags already proven by
`tools/probe-webgl.mjs` (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
--ignore-gpu-blocklist`).

```
node tools/capture.mjs --kata heian-shodan --profile fast
node tools/capture.mjs --kata heian-shodan --profile hero --steps 9,17 --cameras hero,m.front
```

Timestamp set (from `harness.marks()`, so it tracks the tempo tier automatically):

| what | count (Heian) | cameras | purpose |
|---|---|---|---|
| every `tKime` + `yoi` + `yame` | 23 | `m.front`, `m.left`, `hero`, `judge` | the authoritative poses; all G1/G2/G3 metrics |
| `tKime` of steps where `arm === 'R'` | 12 | + `m.right` | the mirror check (risk 3) |
| 8 evenly spaced samples per move | 168 | **no render** — joints only | G4 timing/dynamics, G5 foot slide / bone drift |
| `tKime` of `{1, 9, 17, 18}` | 4 | `detail.hands`, `detail.feet` | Tier-C polish critique |
| once per kata | 1 | `m.top` | embusen floor-trace plot |

Filename is the label — the critic never needs a manifest to know what it is looking at:

```
captures/<sha>/<kata>/step-09-jodan-age-uke-R-zenkutsu-kiai--hero--t15.650.png
captures/<sha>/<kata>/strip-09--m.front.png            # [ours | ref stick | overlay | absdiff]
captures/<sha>/<kata>/contact-sheet.png
captures/<sha>/<kata>/floor-trace.png
```

Per-frame procedure (this ordering is what makes captures deterministic):

```
harness.load(kata, {tempoTier:'T1', quality:'hero'})
harness.setLayerWeight(...)                  # from CLI, for A/B sweeps
for (mark of marks) for (cam of cams):
    await harness.seek(mark.tKime, { exact: true })   # full cloth replay from 0
    harness.camera(cam)                               # snapTo, no blend
    await harness.settle(2)                           # SSAA 32 is single-pass; 2 frames for safety
    await page.locator('canvas').screenshot({ path })
```

Two profiles, because SwiftShader is the loop bottleneck:

| profile | resolution | AA | ~s/frame | Heian full run |
|---|---|---|---|---|
| `fast` (default in the loop) | 512² | `SSAARenderPass` sampleLevel 2 = 4 samples | ~0.4 | ~40 s for 104 PNGs |
| `hero` (phase gates only) | 1024² | sampleLevel 5 = 32 samples, `unbiased` | 1.5–4 | 3–7 min |

And critically: **`npm run score` needs no pixels except metrics 60/61**, so the numeric scorecard
runs in seconds and can gate every commit while PNGs run per phase.

### 6.3 The numeric scorecard

`tools/scorecard.mjs` boots the page, calls `harness.evaluate()`, and writes:

```
reports/<sha>/scorecard.json        # the Scorecard type of §3.3, verbatim
reports/<sha>/scorecard.md          # one row per metric per step, colour-coded
reports/<sha>/regression.json       # per-metric score delta vs the previous sha
reports/<sha>/findings.json         # machine findings (metric-derived Tier A/B)
```

Exit code: `0` only if all six gates hold and no metric regressed more than 5 points.

Metrics are computed in-page by `src/eval/metrics.ts` — a module with **no three.js dependency
beyond `Vector3`/`Quaternion`** (doc 07 §6.5 rule 3), so the same code is unit-tested in vitest
against hand-written `PoseFrame`s. Sampling: kime frames for G1–G3, 8 samples/move for G4–G5, at a
fixed `1/120 s` inner step for velocity/acceleration metrics.

Gates (doc 07 §6.3):

| gate | condition |
|---|---|
| G-1 | `scoreKata ≥ 85` |
| G-2 | zero `fatal` metrics anywhere (28 `hikite_present`, 40 `finger_curl_state`, 58 `self_intersection_count`, 51 sign inversion, 60 `< 0.70`) |
| G-3 | `min(scoreStep) ≥ 70` |
| G-4 | `G1 ≥ 80` **and** `G2 ≥ 80` on **every** step. **Plus my addition:** `head_bob_H ≤ 0.030` is fatal per-step (see §8) |
| G-5 | Channel C `PCK@0.030H ≥ 0.85` on ≥6 annotated PD-1925 postures |
| G-6 | Channel D reports zero Tier-A findings |

### 6.4 Fix routing — complaint → file

This is the mechanism that lets N fix agents run in parallel without touching each other's files.
Two data sources, one join:

* `MetricSpec.owners` — for the 61 numeric metrics, the owning files live *next to the metric*.
* `data/routing.json` — for the ~20 rubric IDs (doc 07 §6.8) that have no numeric metric.

`tools/fix-route.mjs` reads `reports/<sha>/findings.json`, joins, and emits
`reports/<sha>/routed.json` **grouped by ownership block**. The dispatcher then spawns one agent per
block. The table (abridged; full version in `docs/critic/routing.md`):

| rubric / metric | root cause | owning file(s) | block |
|---|---|---|---|
| A1 foot slides (55), 45 pivot slip | plant table or plant-lock | `src/solve/footplant.ts`; `src/kata/*.ts` (`pivotType`) | B, C |
| A2 interpenetration (58) | ROM clamp / pole vector | `src/rig/rom.ts`, `src/solve/pole.ts` | A, B |
| **A3 dead pelvis (11, 51)** | koshi layer gain / lead offsets | `src/clip/layers.ts` (L1), `src/kata/dynamics.ts` (`CHANNELS.leadMs`) | C |
| **A4 no kime (47, 50, 52)** | per-channel `tauP` / kime layer | `src/kata/dynamics.ts` (`tauP`), `src/clip/layers.ts` (L2) | C |
| A5 hikite (28) | technique table hikite pose | `src/solve/technique.ts` (`HIKITE_HIP_A`, `HIKITE_TATE_B`) | B |
| A6 stance shallow (1, 6) | stance table | `src/solve/stance.ts` (`STANCE_TABLE.pelvisY`, `.S`) | B |
| A7 rear heel lifted (10) | `S` too long or rear-foot yaw too small | `src/solve/stance.ts`, `src/solve/footplant.ts` (ankle aim clamp) | B |
| A8 head doesn't lead (16) | gaze lead | `src/solve/gaze.ts`, `src/clip/layers.ts` (L4) | B, C |
| **A9 linear interpolation (52)** | bake refinement threshold | `src/clip/sampler.ts`, `src/core/ease.ts` | C, FROZEN |
| A10 mirrored technique | `SIDE_SIGN` | `src/core/units.ts` — **FROZEN; needs a contract-change ticket** | FROZEN |
| A11 float / sink (56, 57) | foot IK target height | `src/solve/footplant.ts` | B |
| A12 symmetric arms (51) | hikite −17 ms lead | `src/kata/dynamics.ts` | C |
| B1 knee valgus (5) | knee pole | `src/solve/pole.ts`, `src/solve/stance.ts` | B |
| B8 rigid cloth | `alpha_bend`, damping | `src/cloth/garments.ts`, `src/cloth/solver.ts` | F |
| B10 hip bob (17) | pelvis-drop response | `src/solve/pelvis.ts`, `src/clip/driver.ts` | B, C |
| B14 no contact shadow (61) | shadow refit / GTAO | `src/render/shadow.ts`, `src/render/composer.ts` | E |
| C6 sleeve doesn't snap | snap impulse driver | `src/clip/driver.ts`, `src/cloth/garments.ts` | C, F |
| C8 flat lighting | light rig | `src/render/lights.ts` | E |
| C9 mushy shadow | `radius`, `normalBias` | `src/render/shadow.ts` | E |
| C11 static obi | obi tail ribbon | `src/cloth/garments.ts` | F |
| C12 no sheen variation | material / textures | `src/render/materials.ts`, `src/render/textures.ts` | E |
| 60 silhouette IoU low | reference wrong → G; else pose wrong → B | `src/eval/refpose.ts` \| `src/solve/*` | G \| B |

A fix agent's loop is then exactly:

```
npm run critic            # shots (fast) + score + sheet + brief
npm run route -- reports/<sha>/findings.json
#   → routed.json: { "C": [...], "E": [...], ... }   → one agent per block
# … edit only files in your block …
npm run typecheck && npm run test && npm run contracts && npm run score
```

### 6.5 Channels B and C

**Channel B (our own reference overlay, zero licence exposure).** `src/eval/refpose.ts` forward-
kinematics the canonical 25-joint skeleton at `H = 1` with doc 07 §0.2 segment lengths and solves
each step's `targets` by analytic 2-bone IK — a deterministic reference pose built from *facts*, no
mocap, no external asset. `src/eval/overlay.ts` draws it as a stick figure (3 px bones, 7 px joints)
plus a capsule envelope (`0.028 H` limbs / `0.075 H` torso / `0.065 H` head), reference `#FF2D55` at
0.55 α, ours `#0A84FF`, agreement zones purple. Hips-aligned (no rotation, no scale — we must match
orientation and size ourselves), plus a second Procrustes-aligned "shape only" variant.

**Channel C (the only real-human ground truth we may keep).** The 16 PD-1925 Funakoshi plates
(`PD-Japan-oldphoto` + `PD-1996`, doc 07 §2.1) under `assets/reference/pd-1925/` with
`PROVENANCE.md`. 17 hand-annotated 2-D joints per plate, normalised by `H_px`. Metrics: `mpjpe2d_H
≤ 0.025`, `pck_H ≥ 0.90` (gate 0.85), `limb_angle_mae_deg ≤ 7`. **Era caveat is mandatory and
encoded in the tool:** 1920s Shuri-te postures are shallower and more upright than modern JKA, so
Channel C validates *topology only* (limb configuration, hikite existence, forearm angles, head
direction, weight side). `tools/scorecard.mjs` refuses to include `stance_len_H` or `hip_height_H`
in the Channel-C comparison.

`data/reference/*.ref.json` is **generated** by `tools/gen-reference.mjs` from `STANCE_TABLE` +
`TECHNIQUE_TABLE`, never hand-typed — see risk 7.

---

## 7. Build order — 6 phases

Parallelism is by ownership block. A phase ends at a gate; nobody advances until it holds.

### Phase 0 — FREEZE (1 agent, serial, ~1 session)

Write the 9 contract files, `tools/verify-contracts.mjs`, and **three red tests first**:
`tests/player/seek-idiom.spec.ts` (the `paused/enabled/time/update(0)` idiom, Normal **and**
Additive), `tests/core/handedness.spec.ts` (doc 07 §0.1: *hidari gedan-barai fist has `world.x < 0`
in three.js space*), `tests/clip/bake-error.spec.ts` (reconstruct the doc 03 §4.3 forearm roll from a
baked track; assert `maxSlerpErrDeg < 0.25` and max velocity-staircase step < 12 % of local
velocity). Add the npm scripts.
**Gate:** `npm run contracts` passes, `npm run typecheck` clean, the three tests exist and fail for
the right reason.

### Phase 1 — SKELETON, PIXELS, CLOCK (parallel: **A**, **E**, **D**)

* A: skeleton → geometry → skin weights → `SkinnedMesh`.
* E: renderer, composer (all 3 modes), lights, env/PMREM, materials, textures, dojo, camera rig.
* D: transport, `MixerHub`, frame loop, HUD skeleton — against a **stub clip** (2 s, pelvis yaw
  0→45° through `kimeEase(τ, 0.42)`, baked by a temporary inline baker).

**Gate:** the seek-idiom test passes; `node tools/capture.mjs --smoke` produces 4 PNGs of an
A-posed karateka standing in the lit dojo from `m.front/m.left/m.top/hero`, with a visible contact
shadow.

### Phase 2 — SOLVERS, KATA, METRICS (parallel: **B**, **C**, **G**)

* B: two-bone IK, stance table, technique table, foot plant, pelvis, gaze, COM, poles.
* C: both kata's `MoveDef` arrays, embusen generator, tempo, dynamics, and the compiler producing
  the **base layer only**.
* G: joints, all 61 metrics, scoring, reference loader, `refpose`, harness.

**Gates:** `tests/solve` reproduces every doc 01 stance constant and every doc 03 §13.1 elbow angle
by law of cosines; `assertEmbusen` passes σ-symmetry and closure `< 0.01 L` for both kata;
`tests/eval` scores a hand-written perfect `PoseFrame` at exactly 100; `npm run critic` runs
end-to-end on Taikyoku Shodan and emits a real number (expect **55–70** — correct but stiff).

### Phase 3 — LAYERS, CLOTH, TOOLING (parallel: **C**, **F**, **H**)

* C: L1 koshi, L2 kime, L3 breath, L4 gaze, L6 patch, `clip/driver.ts`.
* F: the whole cloth block.
* H: capture profiles, contact sheet, critic brief, `fix-route`, `gen-reference`, routing docs.

**Gates:** the doc 06 §7.5 swatch calibration test passes (20 cm swatch, free edge droops
7.5 ± 1.5 cm); the determinism spec passes (cold seek == play-through == reverse seek, bitwise);
G-2 and G-4 hold on Taikyoku Shodan.

### Phase 4 — FIRST REAL CRITIC LOOP (all blocks, 3 iterations)

Heian Shodan authored (C) in parallel with A/E/F acting on routed findings. Each iteration:
`npm run critic --profile fast` → route → parallel fixes → re-score. Regression gate live from here.
**Gate:** G-1 (`scoreKata ≥ 85`) and G-3 (`min step ≥ 70`) on **both** kata.

### Phase 5 — AAA LOOK (parallel: **E**, **F**, **A**, **G**)

* E: GTAO/bloom/bokeh tuning against the contact sheet, LUT grade, backdrop, practical-light
  balance, floor plank variance.
* F: baked crease field (7–9 folds/panel at 0.030–0.045 H spacing), wrinkle hysteresis
  (attack 0.05 s / release 0.9 s), obi tails, kime overshoot tuned to hem 0.030–0.045 H settling in
  0.25–0.40 s.
* A: `toCreasedNormals`, hand shapes, `computeTangents` → gi anisotropy 0.25.
* G: Channel C — acquire and annotate the 16 PD-1925 plates + `PROVENANCE.md`.

**Gate:** G-5 (Channel C PCK ≥ 0.85 on ≥6 postures) and G-6 (zero Tier-A from a VLM critic pass on
`hero`-profile frames).

### Phase 6 — PLAYER UX AND FINAL ADVERSARIAL PASS (**D**, **H**, then all)

Timeline with per-move chapter markers, loop-a-move, slow-mo 0.25×/0.5×, reverse, frame-step,
per-move labels (romaji + kanji + count + kiai badge), camera preset bar, layer-weight panel,
quality tiers. Mobile tier: cloth 520 particles, snapshots 2 Hz, no Bokeh, `pixelRatio 1.5`,
shadow 1024². Then a full `--profile hero` capture of both kata, the complete 61-metric scorecard,
and the regression gate against Phase 5.

---

## 8. Top 8 risks

**1. A flat 60 Hz bake destroys the forearm-roll snap.** Doc 05 §10.2's 60 keys/s was sized against a
700 °/s hip snap, but doc 03 §4.3's own roll curve peaks at **6 285 °/s** — 105° per key at 60 Hz,
4.16° slerp error, and the 180° corkscrew degenerates into a 3-frame linear spin. That is
*precisely* rubric A9 ("keyframe smell"). **Mitigation:** adaptive dyadic bake to a 0.25° error
bound (§4.7), ceiling 512 Hz, with `bakeStats.maxSlerpErrDeg` as a build gate and a red-first unit
test in Phase 0. Cost ~1.2 MB/kata.

**2. The `mixer.update(0)` seek idiom is the load-bearing assumption of the whole design.**
Doc 05 uncertainty 12 flags it as read-not-run. I have now re-read `_update`, `_updateTimeScale` and
`_updateTime` in the installed tree and the idiom is sound for both blend modes (§4.6, with line
citations). What remains untested is `_accuIndex` behaviour across repeated `update(0)` calls in one
frame. **Mitigation:** (a) exactly one `update(0)` per frame, asserted; (b) the Phase-0 red test;
(c) **containment** — `AnimationMixer` is imported by exactly one file, `src/player/mixerhub.ts`, so
the fallback (hand-rolled quaternion accumulation for additive layers, ~80 lines) is a one-file
change and not an architecture change. Two pre-designed fallbacks: `paused=false; timeScale=1e-9;
mixer.setTime(t)`, then full manual accumulation.

**3. The project's coordinate convention is left-handed.** `+Y` up, forward `−Z`, left `+X` gives
`X × Y = −Z` (doc 07 §0.1, uncertainty 14). If two blocks silently disagree, half the kata mirrors —
`hidari gedan-barai` renders as `migi` and the whole embusen flips about Z. Neither the scorecard nor
Channel B catches it, because both are built from the same constant. **Mitigation:** `SIDE_SIGN` in
frozen `units.ts`, exactly one conversion at the rig boundary, the assertion doc 07 itself names as a
Phase-0 red test, `m.right` added to the capture matrix for all 12 right-arm steps, and Channel C
(real photographs of a real human) as the independent check — a global mirror is the one error
Channel C detects trivially.

**4. Cloth is the only thing that can break seek determinism.** **Mitigation:** the snapshot/replay
contract of §4.4 with explicit `exact` vs `approx` modes; `pinned` mode during scrub-drag; and the
structural insulation that **no scorecard metric reads cloth state**. Residual exposure: metrics 60
(silhouette IoU) and 61 (contact shadow) read pixels that include the gi, so both are captured only
via `seek(t, {exact:true})`.

**5. Segment splicing can produce a visible seam.** 40 seams per kata pair. **Mitigation:** every
technique segment is authored to start and end at a canonical *stance-rest* pose for its
stance/handedness/hanmi state, so seams fall inside a static hold and are C⁰ by construction. The
compiler asserts `quatAngle(segEnd[i], segStart[i+1]) < 0.50°` on all 40, inserts a 0.12 s
easeInOut bridge on failure, and surfaces the worst offender as `bakeStats.maxSeamErrDeg`. If
seam count ever exceeds ~4 bridges, the correct response is to widen the canonical rest-pose set,
not to loosen the tolerance.

**6. SwiftShader makes the critic loop slow enough to discourage iteration.** 32× SSAA at 1024² on
software GL is 1.5–4 s/frame; 104 frames × 2 kata × 3 iterations is up to ~40 min of pure rendering
per phase. **Mitigation:** the two-profile split (`fast` 512²/4-sample ≈ 0.4 s/frame → 40 s per
kata), `--steps`/`--cameras` subsetting, and — most importantly — decoupling the **numeric** pass
from pixels entirely (`harness.evaluate()` needs no render except metrics 60/61), so `npm run score`
runs in seconds and gates every commit.

**7. The research docs disagree on load-bearing numbers, and internal inconsistency is what will
read as "wrong".** Zenkutsu length: doc 01 says `S = 0.540 H` ankle-to-ankle, doc 02 uses
`L = 0.520 H`, doc 07's seeded metric says `0.450 H` heel-to-heel. Front-leg load: 55 / 59 / 62 / 65 /
70 % across four docs. Hanmi: 45° (JKA) vs 90° (Yahara line). Gi sheen: 0.35 vs 1.0. If block B reads
doc 01 and block G reads doc 07, the scorecard will penalise a correct rig. **Mitigation — one
number, one place:** `src/core/units.ts` + `STANCE_TABLE` are the sole source of truth, and
`data/reference/*.ref.json` is **generated from them** by `tools/gen-reference.mjs` so the scorecard
can never disagree with the rig. Doc 07's *tolerances* are kept; its *reference values* are
overridden and every override is logged in `docs/critic/reference-overrides.md`. Shipped picks:
`S = 0.540 H`, `PELVIS_Y = 0.410 H`, front load 59 %, hanmi 45°, and metric 1's reference set to
`0.533 H` heel-to-heel (doc 01 §3.1) with tol ±0.05.

**8. LBS candy-wrapper on the *visible* forearm.** The tsuki requires ~180° of pronation; with 2
twist bones each blend band spans 60° → 13.4 % radius loss (doc 06 §5.4), and the forearm is bare
below a kata-cut sleeve. **Mitigation:** twist bones at 33 %/67 % plus the rigidify pass (§5.3
step 7) to narrow each band to one edge loop → ≤30° per band → 3.4 % loss, invisible; 4 loops at the
wrist; sleeve hem at exactly `0.255 H` from SJC (shortest legal kata cut) so only ~40 % of the
forearm is bare; UV seam on the ulnar side. **Explicitly rejected:** the `onBeforeCompile`
swing-twist skinning shader of doc 06 §5.4 Fix 2 — it forfeits WebGPU portability *and* breaks
`GTAOPass`'s `MeshNormalMaterial` G-buffer, and DQS trades candy-wrapper for joint bulging, which is
worse on a bare elbow.

### What will most likely make this look cheap or wrong — and the countermeasure

**The head rising and the pelvis bobbing during steps.** Not the shading, not the cloth. It is the
single most-cited failure across the research: doc 01 §8.1 puts the fail threshold at 0.034 H
peak-to-peak head oscillation and says above it the figure "reads as a person walking in costume";
doc 04 §7.3 tightens it to 0.012 H and states flatly that a level step exceeding it "reads as
walking, not karate"; Cazeau et al. 2021 give the physical reason (the karate step deliberately
suppresses the inverted-pendulum PE↔KE exchange that makes walking cheap). It is also *geometrically
forced* if you are not careful: at `S = 0.540 H` and `PELVIS_Y = 0.410 H` the mid-step support knee
must flex **78.2°** to hold height (doc 01 §7.A), and any IK pass that is allowed to relieve that
knee will silently trade 6 cm of head rise for comfort. No amount of AgX, GTAO or sheen fixes it,
because the error is in the *silhouette over time* — which is exactly what a karateka's eye reads
first.

Four-part countermeasure, all of it structural rather than tuned:

1. `PELVIS_Y` is a **hard-authored constant** `0.410 H ± 0.008` baked into the base clip's root and
   pelvis tracks. It is not an emergent result of the leg solve.
2. The leg IK pelvis pass may **only lower** the pelvis: `dy = clamp(dy, −0.060·H, 0.0)`
   (doc 06 §6.3 step 4). The clamp is in the solver, not in a config.
3. `head_bob_H` (metric 17) is promoted to a **per-step fatal** at `> 0.030 H` inside gate G-4 —
   stronger than doc 07's seeded tolerance, because this metric is worth more than its 1/17 share of
   G1.
4. `m.left` ortho captures at 8 samples per move feed a per-move head-Y trace into
   `metrics.html`, so the failure is visible as a *graph*, not only as a number.

Second most likely: constant-velocity slerp (risk 1). Third: a static gi — doc 06 §7.10 rule 6 is
the tell, because generic cloth settings produce ~2 cm folds and heavy 12 oz canvas produces
6–9 cm folds; the countermeasure is the swatch calibration test (free edge droops 7.5 ± 1.5 cm),
which is a Phase-3 gate rather than an eyeball judgement.
