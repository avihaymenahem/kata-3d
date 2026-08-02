# Proposal A — AUTHORED DATA FIRST

**A compiled-kata architecture for a seekable 360° Shotokan player.**
Target stack, verified: `three@0.185.1` (WebGLRenderer path), `vite@8`, `typescript@5.9` strict, `lil-gui@0.21`, `playwright@1.62` + headless Chromium/SwiftShader. No downloaded character assets.

---

## 1. Thesis, and the one thing this optimizes for

**Thesis.** The kata is not animation code — it is a **compiled artifact**. The source of truth is a typed, declarative kata DSL whose every number is a copy of a cited row from `docs/research/`, carried at runtime together with its unit, tolerance, confidence class and doc citation. A deterministic, three.js-free compiler (`compileKata`) expands that DSL through a fixed 13-stage solve pipeline — embusen footplan → stance IK → technique IK → per-channel `kimeEase` → hip drive → spine whip → foot plant → helpers → ROM clamp — and emits one immutable `PoseTrack`: a dense 120 Hz array of 44 bone-local quaternions plus a root transform plus 12 driver channels. The runtime is then a *sampler*, not a simulator: `sample(tick)` is a pure function of an integer, so scrubbing to an arbitrary time is bit-identical whether you played there or jumped there. Procedural work that must stay live (breath, blink, gi cloth) is strictly additive on top and is either closed-form-in-`t` or snapshot-replayable. Total per-kata compile cost is ~80–150 ms, so editing a single constant re-derives all 6,558 frames of Heian Shodan under Vite HMR **without losing your scrub position**.

**The ONE thing this design optimizes for: the shortest possible edit distance from a critic complaint to a corrected frame.** Target: **median 1 file, 1 field, ≤250 ms recompile**, with the file and field name *printed by the scorecard itself*. Every metric in the automated critic declares a `fixSite: {file, symbol}`, and a unit test asserts that every declared fix site resolves to a real exported symbol. "Front stance 8 % too short at step 4" must resolve mechanically to `src/data/constants/stances.ts → ZENKUTSU.S` (global) or `src/data/kata/taikyoku-shodan.kata.ts → moves[3].overrides.S` (local) — never to "somewhere in the animation code".

Everything else is subordinate. Where authoring control and raw performance conflict, authoring control wins (that is why the whole solve pipeline runs at compile time and the runtime does 44 slerps). Where authoring control and code elegance conflict, authoring control wins (that is why constants are `{v, unit, tol, src, conf}` objects and not bare numbers).

---

## 2. Module map and ownership blocks

**Hard rule (parallel agents):** a block may only write files under its own globs. Cross-block imports go **only** through a block's `index.ts` barrel, enforced by `tests/contracts/imports.test.ts`. A block that needs another block's output before it exists writes a fixture **inside its own** `tests/<block>/fixtures/` — never a stub inside another block's directory.

### 2.0 FROZEN CONTRACTS — Phase 0, written once, then read-only forever

These 8 files + 1 test are authored by a single agent in Phase 0 and then **frozen**. No block may edit them; a change requires stopping all agents.

| file | owns |
|---|---|
| `src/contracts/units.ts` | `H`, `H_CM`, `DEG`, `RAD`, `SIDE_SIGN`, `Deg`/`Rad`/`FracH` brand types, `POSE_RATE_HZ`, `TICK_HZ` |
| `src/contracts/bones.ts` | `BoneName` (44-member union), `BONE_ORDER`, `BONE_COUNT`, `BoneIndex`, `boneIndex(name)`, `BONE_PARENT` |
| `src/contracts/pose.ts` | `PoseFrame`, `PoseTrack`, `TrackMark`, `CHANNELS`, `ChannelName`, `CHANNEL_COUNT` |
| `src/contracts/kata.ts` | the whole kata DSL: `KataScore`, `KataMove`, `TechniqueRef`, `CeremonyPhase`, `StanceId`, `TechniqueId`, `PivotRule`, `SimRule`, `TempoClass`, `HipFacing`, `Handedness` |
| `src/contracts/scorecard.ts` | `MetricId`, `MetricSpec`, `MetricResult`, `FixSite`, `StepScore`, `Scorecard`, `GateId` |
| `src/contracts/rig.ts` | `RigHandles`, `Landmarks`, `CanonicalJoint` (25-joint set), `Capsule`, `GiPinRing` |
| `src/contracts/services.ts` | runtime seams: `Transport`, `PoseSource`, `RuntimeLayer`, `ClothSystem`, `CameraRig`, `CameraPresetId`, `PostStack`, `KataHarness` |
| `src/contracts/index.ts` | barrel |
| `tests/contracts/imports.test.ts` | asserts no cross-block deep imports; asserts contract files unchanged (content hash) |

### 2.1 `B1 — NUMBERS` — the numeric truth, and the file a fix agent edits first
Globs: `src/data/**`, `tests/data/**`

| file | owns / public exports |
|---|---|
| `src/data/num.ts` | provenance-carrying scalar. `Num`, `N()`, `flat()`, `fmtNum()`, `AltNum` (disputed values with an A/B switch) |
| `src/data/constants/anthro.ts` | de Leva §1.1 segment lengths, D&C cross-checks, bind-pose joint heights §1.3, breadths §1.4, limb radii §5.1, mass/COM §2. `ANTHRO`, `JOINT_Y`, `LIMB_R`, `SEG_MASS` |
| `src/data/constants/stances.ts` | `STANCES` (`HEISOKU`,`MUSUBI`,`HEIKO`,`HACHIJI`,`ZENKUTSU`,`ZENKUTSU_ASHI`,`KOKUTSU`,`KIBA`,`HAN_ZEN`,`MOTO`), `FIGHT_PELVIS_Y`, `StanceParams`, `mirrorStance()` |
| `src/data/constants/techniques.ts` | per-technique GH-local keyframe tables from 03 §4–§10 + §13 end-pose table. `TECHNIQUES`, `HIKITE_HIP_A`, `HIKITE_TATE_B`, `TARGET_DY`, `HAND_SHAPE_ANGLES` |
| `src/data/constants/dynamics.ts` | `DYN` (per-class `T_tech/T_thrust/T_kime/recoil`), `CHANNEL_DYN` (`tauP` + `lead` per channel, 04 §11), `SETTLE` (2nd-order recoil per channel), `TEMPO` (T0–T3 tiers, pause classes P0–P4) |
| `src/data/constants/rom.ts` | swing-twist clamp table 06 §3.1. `ROM`, `RomLimit` |
| `src/data/constants/cloth.ts` | `CLOTH` (α_stretch/shear/bend, n_sub, damping, drag, μ, clamps), `GARMENTS` (dims from 06 §7.1 + grids from §7.3) |
| `src/data/constants/render.ts` | `LIGHTS`, `SHADOW`, `POST`, `MATERIAL_PARAMS`, `ENV`, `CAMERA_PRESET_PARAMS` |
| `src/data/constants/DISPUTED.md` | the 14 live numeric disputes, each with both readings, the shipped pick, and the `AltNum` switch id. Human-owned prose. |
| `src/data/embusen.ts` | `L` and `EMB_H` **derived** (never authored), rules `R0`–`R5`, `footPlanFor(move)`, `embusenPolyline(kata)`, `assertEmbusenInvariants()` |
| `src/data/kata/taikyoku-shodan.kata.ts` | `TAIKYOKU_SHODAN: KataScore` — 20 moves + ceremony, transcribed from 02 §4 |
| `src/data/kata/heian-shodan.kata.ts` | `HEIAN_SHODAN: KataScore` — 21 moves + ceremony, transcribed from 02 §6 |
| `src/data/kata/index.ts` | `KATA`, `getKata(id)`, `KataId` |
| `src/data/validate.ts` | the 7 build-time invariants of 02 §11 + tempo sum + kiai count + σ-symmetry + closure. `validateKata()` |
| `src/data/index.ts` | barrel |

### 2.2 `B2 — SOLVER` — the deterministic compiler
Globs: `src/solve/**`, `tests/solve/**`

| file | owns / public exports |
|---|---|
| `src/solve/frame.ts` | the **single** handedness boundary. `toWorld(v)`, `toWorldYawDeg(d)`, `sideSign(hand)`, `worldFacing(headingDeg)` |
| `src/solve/ease.ts` | `kimeEase(τ,τp)`, `kimeEaseVel`, `aFromPeak`, `holdThenSnap(τ)` (01 §8.3), `settle2(t,ch)`, `channelAlpha()` (04 §11) |
| `src/solve/skeleton.ts` | bind-pose bone tree from `ANTHRO`, pure, no three.js. `BIND: BoneDef[]`, `boneOffset()`, `restWorld()` |
| `src/solve/twoBoneIK.ts` | `solveTwoBone(A,B,C,T,pole,opts)` — analytic, soften, joint-limit-aware (06 §6.1) |
| `src/solve/swingTwist.ts` | `splitSwingTwist(q,axis)`, `clampSwingTwist(q,limit)` elliptic cone (06 §3.2) |
| `src/solve/stance.ts` | `solveStance(stanceParams, footPlan) → {pelvis, legQuats}` |
| `src/solve/arm.ts` | `solveArm(techKey, gh) `, `solveHikite()`, `clavicleRhythm()`, `poleFor(techId, side)` |
| `src/solve/hand.ts` | `HAND_POSES` (seiken/shuto/open/nukite as local quats), `solveHand(shape, blend)` |
| `src/solve/com.ts` | `bodyCOM(pose)`, `solveCOM(pose, targetXZ)` — 3-iteration, gain 0.90 (06 §2.2) |
| `src/solve/spine.ts` | `solveSpineWhip(pelvisYawRate)`, `solvePelvisTilt(stance)` |
| `src/solve/gaze.ts` | `solveGaze(track)` — chain 0.15/0.35/0.50, +0.090 s lead, ω=14 ζ=1, baked |
| `src/solve/footPlant.ts` | `buildPlantPlan(moves)`, `applyPlantLock(track)` — pivot-about-point, not fixed-transform |
| `src/solve/timeline.ts` | `buildTimeline(score, tempo) → Slot[]` with integer tick windows; `Slot`, `SlotPhase` |
| `src/solve/keyposes.ts` | `buildKeyPoses(slot) → PoseKey[]` at `start/prep/mid/kime/hold` |
| `src/solve/bake.ts` | `bakeTrack(keys, ctx, layerMask) → PoseTrack`; `STAGES` (the 13 named stages, individually toggleable) |
| `src/solve/compile.ts` | **the one entry point.** `compileKata(score, opts) → PoseTrack`, `CompileOpts` |
| `src/solve/hash.ts` | `trackHash(score, constants, codeVersion)` — fnv1a-64 over every `Num.v` |
| `src/solve/toAnimationClip.ts` | `toAnimationClip(track)` — interop/debug only (gives `clip.validate()` + `SkeletonUtils.retargetClip`) |
| `src/solve/index.ts` | barrel |

### 2.3 `B3 — RIG` — procedural karateka
Globs: `src/rig/**`, `tests/rig/**`

| file | owns / public exports |
|---|---|
| `src/rig/bones.ts` | `buildSkeleton()` — 44 `Bone`s, T-pose build → A-pose rebake (06 §4.1 G1–G5) |
| `src/rig/bodyMesh.ts` | `buildBodyGeometry()` — swept-ring limbs + cube-sphere head + junction patches, ~3.9 k verts |
| `src/rig/skinWeights.ts` | `computeSkinWeights()` — segment distance, visibility gate, κ=2.6/p=3 falloff, top-4 prune, 5× Laplacian λ=0.35, rigidify |
| `src/rig/giMesh.ts` | `buildGiGeometry()` — uwagi/zubon/collar/obi, analytic UV **and tangents**, `GiPinRing[]` |
| `src/rig/textures.ts` | `makeWeaveNormal()`, `makeCreaseMap()`, `makeFloorMaps()`, `makeHeadAlbedo()` — `CanvasTexture`/`DataTexture` only |
| `src/rig/karateka.ts` | `buildKarateka(materials) → RigHandles` — the `SkinnedMesh` assembly per 05 §9.4 |
| `src/rig/landmarks.ts` | `sampleLandmarks(rig) → Landmarks` — the 25 canonical joints incl. `*FistCenter` virtuals |
| `src/rig/capsules.ts` | `buildCapsules(rig)`, `boneAABB(rig)` (feeds cloth + shadow refit) |
| `src/rig/index.ts` | barrel |

### 2.4 `B4 — RENDER` — dojo look
Globs: `src/render/**`, `tests/render/**`

| file | owns / public exports |
|---|---|
| `src/render/renderer.ts` | `createRenderer(canvas, {harness}) ` — exact ctor + boot order of 05 §3/§15 |
| `src/render/dojoEnv.ts` | `buildDojoEnvScene()`, `makeEnvironment(renderer)` — PMREM `fromScene(env, 0.04, 0.1, 40, {size:512, position:(0,0.9625,0)})` |
| `src/render/lights.ts` | `buildLights(scene) → LightRig` — KEY/RIM/FILL + `scene.add(key.target)` |
| `src/render/shadow.ts` | `configureShadow(key)`, `refitShadow(key, aabb, camera)` — Mode B + light-space texel snap |
| `src/render/materials.ts` | `createMaterials(env) → MaterialSet` — the 9 materials, **no `onBeforeCompile` anywhere** |
| `src/render/stage.ts` | `buildStage(materials)` — floor, backdrop shell, embusen decal plane |
| `src/render/post.ts` | `buildPost(renderer, scene, camera) → PostStack` — the exact chain of 05 §8.4, resize (`setSize` **and** `setPixelRatio`), TAA toggle |
| `src/render/overlay.ts` | `buildOverlay()` — skeleton, reference stick, embusen trace, silhouette-mask pass |
| `src/render/index.ts` | barrel |

### 2.5 `B5 — PLAYER` — transport, sampler, camera, composition root
Globs: `src/player/**`, `src/main.ts`, `index.html`, `tests/player/**`

| file | owns / public exports |
|---|---|
| `src/player/transport.ts` | `createTransport(track) → Transport` — integer-tick clock, rate, seek, mark snapping |
| `src/player/sampler.ts` | `createSampler(track, rig)`, `applyPose(rig, tick)` — 2-frame slerp into 44 bone quats |
| `src/player/layers.ts` | `createLayerStack() → RuntimeLayer[]`, `LAYERS` (breath, blink, poke) |
| `src/player/breath.ts` | `applyBreath(rig, chan)` — closed-form ribcage scale + clavicle rise (04 §8.2) |
| `src/player/cameraRig.ts` | `createCameraRig() → CameraRig`, `CAMERA_PRESETS` — OrbitControls binding, damped preset blends, measurement-exact mode |
| `src/player/loop.ts` | `startLoop(deps)` — the frame function, `setAnimationLoop`, bench hooks |
| `src/player/app.ts` | `bootApp(opts)` — composition root; the only file that imports every barrel |
| `src/player/harness.ts` | `installHarness(app)` — `window.__KATA_HARNESS__` implementing `KataHarness` |
| `src/main.ts` | entry; URL params (`?kata=&t=&cam=&harness=&bench=&layers=&quality=`) |
| `index.html` | canvas + module script |

### 2.6 `B6 — CLOTH` — gi secondary motion
Globs: `src/cloth/**`, `tests/cloth/**`

| file | owns / public exports |
|---|---|
| `src/cloth/xpbd.ts` | `XpbdSolver` — typed-array state, 8 substeps, 1 iteration/substep, λ reset per substep |
| `src/cloth/constraints.ts` | `buildConstraints(layout)` — distance / shear / dihedral bend / attach / LRA / unilateral collision |
| `src/cloth/garments.ts` | `buildGarments(pinRings) → GarmentLayout[]` — 988 particles per 06 §7.3 |
| `src/cloth/collide.ts` | `buildColliderSets()`, `resolveCollisions()` — per-particle whitelist + per-frame AABB broad-phase escape |
| `src/cloth/snapshots.ts` | `SnapshotStore` — state ring, `snapshotAt(tick)`, `nearestBefore(tick)` |
| `src/cloth/system.ts` | `createClothSystem() → ClothSystem` — `step(tick)`, `seek(tick)`, `upload()`, `reinit()` |
| `src/cloth/wrinkle.ts` | `updateWrinkle()` — per-vertex compression attribute, asymmetric hysteresis (attack 0.05 s / release 0.9 s) |
| `src/cloth/index.ts` | barrel |

### 2.7 `B7 — UI` — the player chrome
Globs: `src/ui/**`, `tests/ui/**`

| file | owns / public exports |
|---|---|
| `src/ui/timeline.ts` | `createTimeline(transport, track)` — scrub bar, per-move ticks, kime markers, kiai flags, drag→seek |
| `src/ui/labels.ts` | `createLabels(transport, track)` — move card (count / romaji / EN / stance / level) + optional 3D floor label |
| `src/ui/gui.ts` | `createGui(app)` — lil-gui: tempo tier, rate, layer mask, quality tier, **disputed-number A/B switches**, camera preset |
| `src/ui/hud.ts` | `createHud()` — transport buttons, rate readout, frame-time/bench readout |
| `src/ui/theme.css` | styles |
| `src/ui/index.ts` | barrel |

### 2.8 `B8 — CRITIC` — the automated loop
Globs: `src/eval/**`, `tools/**`, `tests/eval/**`

| file | owns / public exports |
|---|---|
| `src/eval/metricSpecs.ts` | `METRICS: MetricSpec[]` — the 61 metrics of 07 §6.2 plus the 2 new ones of §6.3 below (**63 total**), each with `source` and `fixSite` |
| `src/eval/metrics.ts` | `computeMetrics(samples, move) → MetricResult[]` — pure, only `Vector3`/`Quaternion` from three |
| `src/eval/score.ts` | `scoreRun(results) → Scorecard`, `GATES` (G-1…G-6), `scoreMetric()` verbatim from 07 §6.3 |
| `src/eval/plan.ts` | `buildCapturePlan(track) → ShotSpec[]` — ticks × cameras |
| `src/eval/refStick.ts` | `buildReferencePose(move)`, `drawStick(ctx, pose)` — Channel B, 100 % our own IP |
| `src/eval/panel.ts` | `composePanel(canvases) → HTMLCanvasElement` — the 4-panel strip + diff heatmap, in-page (no node image lib) |
| `src/eval/report.ts` | `renderScorecardMd()`, `renderFixQueue()`, `diffRuns()` |
| `src/eval/index.ts` | barrel |
| `tools/critic.mjs` | orchestrator: build track → serve → capture → score → report → **exit code = gates** |
| `tools/capture.mjs` | Playwright shot loop (SwiftShader flags proven by `probe-webgl.mjs`); importable + standalone |
| `tools/build-track.mjs` | headless compile of both tracks; writes `reports/track-<id>-<hash>.json` for diffing |
| `tools/verify-constants.mjs` | greps each `Num.src` doc section for the literal value; fails CI on drift |
| `tools/bench.mjs` | 600-frame frame-time histogram, p50/p95/p99 |
| `tools/probe-webgl.mjs` | *exists* — WebGL2/SwiftShader capability probe |

---

## 3. Data formats — real declarations

### 3.1 Provenance-carrying scalars (`src/data/num.ts`)

This is the mechanical expression of the bias: a number and its citation are the *same object*, so the scorecard can print the citation next to the failure and `verify-constants.mjs` can check the citation is still true.

```ts
export type Unit = 'H' | 'm' | 'cm' | 'deg' | 's' | 'ms' | 'pct' | 'ratio' | 'Hps' | 'deg/s' | 'count';
export type Confidence = 'MEASURED' | 'TRAD' | 'DERIVED' | 'ART';

export interface Num {
  readonly v: number;          // the value, in `unit`
  readonly unit: Unit;
  readonly tol: number;        // symmetric tolerance in `unit`; 0 = exact
  readonly src: string;        // 'docs/research/01-stances.md §3.1'
  readonly conf: Confidence;
}

/** Disputed value: ships `v`, but `alt` is one GUI toggle away. See DISPUTED.md. */
export interface AltNum extends Num {
  readonly disputeId: string;  // 'D01-zenkutsu-weight'
  readonly alt: readonly { readonly v: number; readonly src: string }[];
}

export const N = (v: number, unit: Unit, tol: number, src: string, conf: Confidence): Num =>
  ({ v, unit, tol, src, conf });

/** Hot-loop mirror: strips provenance from a nested record of Num. */
export type Flat<T> = { readonly [K in keyof T]: T[K] extends Num ? number : Flat<T[K]> };
export function flat<T extends object>(t: T): Flat<T>;
```

Example of the file a fix agent edits (`src/data/constants/stances.ts`):

```ts
export interface StanceParams {
  readonly S: Num;            // ankle↔ankle along facing, frac H
  readonly W: Num;            // ankle↔ankle lateral, frac H
  readonly yawFront: Num;     // deg, authored frame
  readonly yawRear: Num;
  readonly pelvisY: Num;      // frac H — HARD CONSTRAINT of the leg solve
  readonly kneeFront: Num;    // deg flexion
  readonly kneeRear: Num;
  readonly loadFront: Num;    // pct
  readonly pelvisTiltPost: Num;
  readonly pelvisYawHanmi: Num;
  readonly torsoPitch: Num;
}

export const FIGHT_PELVIS_Y = N(0.410, 'H', 0.010, 'docs/research/01-stances.md §2', 'DERIVED');

export const ZENKUTSU: StanceParams = {
  S:               N(0.540, 'H',   0.040, 'docs/research/01-stances.md §3.1', 'DERIVED'), // ← the "8% too short" edit
  W:               N(0.170, 'H',   0.040, 'docs/research/01-stances.md §3.1', 'TRAD'),
  yawFront:        N(+3,    'deg', 5,     'docs/research/01-stances.md §3.1', 'TRAD'),
  yawRear:         N(+30,   'deg', 12,    'docs/research/01-stances.md §3.1', 'TRAD'),
  pelvisY:         FIGHT_PELVIS_Y,
  kneeFront:       N(57,    'deg', 7,     'docs/research/01-stances.md §3.2', 'DERIVED'),
  kneeRear:        N(10,    'deg', 8,     'docs/research/01-stances.md §3.2', 'TRAD'),
  loadFront:       N(59,    'pct', 3,     'docs/research/01-stances.md §3.6', 'DERIVED'),
  pelvisTiltPost:  N(+7,    'deg', 4,     'docs/research/01-stances.md §3.3', 'DERIVED'),
  pelvisYawHanmi:  N(+45,   'deg', 6,     'docs/research/01-stances.md §3.3', 'TRAD'),
  torsoPitch:      N(0,     'deg', 3,     'docs/research/01-stances.md §3.3', 'TRAD'),
} as const;
```

### 3.2 Kata DSL (`src/contracts/kata.ts`)

```ts
export type Handedness = 'L' | 'R';
export type StanceId =
  | 'heisoku' | 'musubi' | 'heiko' | 'hachiji'
  | 'zenkutsu' | 'zenkutsu-ashi' | 'kokutsu' | 'kiba' | 'han-zenkutsu' | 'moto';
export type TechniqueId =
  | 'gedan-barai' | 'age-uke' | 'soto-uke' | 'uchi-uke' | 'shuto-uke'
  | 'choku-zuki' | 'oi-zuki' | 'gyaku-zuki'
  | 'tettsui-tate-mawashi' | 'none';
export type Level = 'jodan' | 'chudan' | 'gedan';
export type HipFacing = 'shomen' | 'hanmi' | 'gyaku-hanmi';
export type HikiteForm = 'HIP-A' | 'TATE-B' | 'NONE';
export type HandShape = 'seiken' | 'shuto' | 'open' | 'nukite';
/** Footfall rules of 02 §3.1. */
export type PivotRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
/** Simultaneity rules of 02 §8. */
export type SimRule = 'S1' | 'S2' | 'S3';
/** Tempo classes of 02 §1.4. */
export type TempoClass = 'M1' | 'N' | 'F' | 'T90' | 'T135' | 'T180' | 'T270' | 'D45';
/** Pause classes of 04 §6.3. */
export type PauseClass = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

/** Embusen coordinate, units of L, in the AUTHORED (doc-02) frame. */
export type EmbXZ = readonly [x: number, z: number];

export interface TechniqueRef {
  readonly id: TechniqueId;
  readonly arm: Handedness;
  readonly level: Level;
  /** Target height as frac H (02 §1.2). Redundant with `level`; asserted at validate. */
  readonly targetH: number;
  readonly hand: HandShape;
  /** Named variant into TECHNIQUES, e.g. 'tate' for tettsui. */
  readonly variant?: string;
}

export interface KataMove {
  readonly n: number;                  // 1-based count
  readonly label: string;              // 'hidari gedan-barai'
  readonly labelEn: string;            // 'left downward block'
  readonly dHeadingDeg: number;        // signed, + = to the character's LEFT (authored frame)
  readonly headingDeg: number;         // resulting absolute heading; ASSERTED against the dH chain
  readonly rule: PivotRule;
  readonly pivot: Handedness | null;   // planted foot, zero translation
  readonly mover: Handedness;
  readonly stance: StanceId;
  readonly front: Handedness;
  readonly weighted: Handedness;       // === front for zenkutsu, rear for kokutsu
  readonly hips: HipFacing;
  readonly tech: TechniqueRef;
  readonly hikite: HikiteForm;
  readonly kiai: boolean;
  readonly tempo: TempoClass;
  readonly pause: PauseClass;
  readonly sim: SimRule;
  /** Authored embusen, units of L. Recomputed from `pivot + Lk·f(H)` and ASSERTED. */
  readonly embusen: { readonly ff: EmbXZ; readonly rf: EmbXZ; readonly c: EmbXZ };
  /** THE per-move escape hatch. A critic complaint scoped to one step lands here. */
  readonly overrides?: {
    readonly stance?: Partial<Record<'S'|'W'|'pelvisY'|'kneeFront'|'kneeRear'|'yawRear'|'pelvisYawHanmi', number>>;
    readonly tech?: Partial<Record<'dx'|'dy'|'dz'|'elbowDeg'|'rollDeg'|'rollStartPct', number>>;
    readonly timing?: Partial<Record<'tSlot'|'tTech'|'tKime'|'tHold', number>>;
    readonly reason: string;           // required: why this move deviates from the global constant
  };
  readonly notes?: string;
  readonly src: string;                // '02-kata-sequences.md §4.1 row 4'
}

export interface CeremonyPhase {
  readonly id: 'REI_IN'|'ANNOUNCE'|'YOI'|'SET'|'FINAL_HOLD'|'YAME'|'SETTLE'|'ATTENTION'|'REI_OUT';
  readonly stance: StanceId;
  readonly durationS: number;
  readonly params?: Readonly<Record<string, number>>;
}

export interface KataScore {
  readonly schema: 'kata-score/1';
  readonly id: 'taikyoku-shodan' | 'heian-shodan';
  readonly displayName: string;
  readonly displayNameJp: string;
  readonly moveCount: number;                     // asserted === moves.length
  readonly kiaiAt: readonly number[];             // asserted === moves.filter(kiai)
  readonly fastPairs: readonly (readonly [number, number])[];
  readonly openingCeremony: readonly CeremonyPhase[];
  readonly moves: readonly KataMove[];
  readonly closingCeremony: readonly CeremonyPhase[];
  readonly totalMoveSecondsT1: number;            // 35.25 / 39.75, asserted within 20 %
  readonly provenance: readonly string[];
}
```

### 3.3 Pose / keyframe representation (`src/contracts/pose.ts`)

Two representations. `PoseKey` is what the *author* and the solver think in (sparse, semantic). `PoseTrack` is what the *runtime* consumes (dense, dumb, seekable). Nothing else exists.

```ts
export const POSE_RATE_HZ = 120 as const;   // bake rate
export const TICK_HZ      = 1200 as const;  // transport clock: 10 sub-ticks per pose frame

export const CHANNELS = [
  'breath',        // 0..1, 1 = full inhale                     (04 §8.1)
  'tension',       // 0..1 kime envelope, JKA 0→10→0            (04 §5)
  'kiai',          // 0..1 vocal envelope                       (04 §8.3)
  'pelvisYawRate', // deg/s — drives spine whip + cloth         (01 §8.3)
  'accelL',        // m/s² magnitude, left  wrist               (04 §4.5)
  'accelR',        // m/s² magnitude, right wrist
  'loadL',         // 0..1 vertical load share, left  foot      (04 §7.1)
  'loadR',
  'plantL',        // 0 | 1 plant state                         (06 §6.3)
  'plantR',
  'gazeYaw',       // deg, absolute
  'gazePitch',
] as const;
export type ChannelName = typeof CHANNELS[number];
export const CHANNEL_COUNT = CHANNELS.length;   // 12

/** Sparse, semantic. Authored/solved; never shipped to the runtime. */
export interface PoseKey {
  readonly tick: number;                       // TICK_HZ units
  readonly phase: 'start' | 'prep' | 'mid' | 'kime' | 'hold';
  readonly moveN: number;                      // 0 = ceremony
  /** Bone-local quaternions, xyzw, length BONE_COUNT*4. */
  readonly q: Float32Array;
  readonly rootPos: Float32Array;              // 3, world metres
  readonly rootQuat: Float32Array;             // 4
  readonly chan: Float32Array;                 // CHANNEL_COUNT
  /** Per-channel easing assignment for the segment ENDING at this key. */
  readonly ease: Readonly<Record<ChannelName | 'pose', { tauP: number; leadMs: number }>>;
}

/** Dense, dumb, immutable, seekable. THE runtime contract. */
export interface PoseTrack {
  readonly kataId: string;
  readonly rateHz: 120;
  readonly frameCount: number;                 // Heian: 6558 (54.65 s)
  readonly durationS: number;
  /** frameCount × BONE_COUNT × 4, bone-local, xyzw. Heian: 4.62 MB. */
  readonly q: Float32Array;
  readonly rootPos: Float32Array;              // frameCount × 3
  readonly rootQuat: Float32Array;             // frameCount × 4
  readonly chan: Float32Array;                 // frameCount × CHANNEL_COUNT
  readonly marks: readonly TrackMark[];
  /** fnv1a-64 of every Num.v + solver code version. Cache key AND capture provenance. */
  readonly hash: string;
}

export interface TrackMark {
  readonly kind: 'move-start' | 'prep' | 'foot-contact' | 'kime' | 'kiai' | 'hold-end' | 'ceremony';
  readonly tick: number;
  readonly moveN: number;
  readonly label: string;
}

/** The whole runtime read path. Pure function of an integer. */
export interface PoseSource {
  readonly track: PoseTrack;
  /** Writes into caller-owned buffers; slerps between the two bracketing frames. */
  sample(tick: number, out: PoseFrame): void;
}
export interface PoseFrame {
  readonly q: Float32Array; readonly rootPos: Float32Array;
  readonly rootQuat: Float32Array; readonly chan: Float32Array;
}
```

**Why not `AnimationMixer` + `QuaternionKeyframeTrack`** (against 05 §10.5's recommendation): doc 05 itself documents three scrub traps (§14.1 #4/#5/#6, §10.4) whose only fix is `LoopRepeat` + `repetitions = Infinity` + `action.time = t; mixer.update(0)`, i.e. re-implementing a sampler through a stateful object. At 120 Hz × 44 bones the mixer buys us 44 `PropertyBinding` lookups and 44 interpolant objects per frame for features we do not need (we never crossfade two kata, and additive layers here are closed-form, not clips). Our sampler is 2 typed-array reads + 44 slerps ≈ **1.4 µs**, `O(1)` seek, zero state. We still ship `toAnimationClip()` so `clip.validate()`, `clip.optimize()` and `SkeletonUtils.retargetClip` remain available for debugging and any future rig-proportion change.

### 3.4 Metric scorecard (`src/contracts/scorecard.ts`)

```ts
export type MetricGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type Verdict = 'pass' | 'warn' | 'fail' | 'fatal';
export type GateId = 'G-1' | 'G-2' | 'G-3' | 'G-4' | 'G-5' | 'G-6';
export type MetricId = 'stance_len_H' | 'stance_width_H' | /* … 63 total: 07 §6.2 (61) + §6.3 (2) … */ 'hem_overshoot_H';

/** The critic→fix mapping. This is the whole point of the architecture. */
export interface FixSite {
  readonly file: string;    // 'src/data/constants/stances.ts'
  readonly symbol: string;  // 'ZENKUTSU.S'
  readonly kind: 'constant' | 'move-override' | 'technique-keyframe' | 'channel-dynamics'
               | 'solver' | 'rig' | 'cloth' | 'render';
  readonly block: 'B1'|'B2'|'B3'|'B4'|'B5'|'B6'|'B7'|'B8';   // → which agent owns the fix
  readonly hint: string;    // 'increase S; +0.001 H ≈ +0.19 % stance_len_H'
}

export interface MetricSpec {
  readonly id: MetricId;
  readonly group: MetricGroup;
  readonly unit: Unit;
  readonly ref: number;
  readonly tol: number;         // |d| ≤ tol → 100
  readonly hardFail: number;    // |d| ≥ hardFail → 0
  readonly asymmetric?: 'upper-only' | 'lower-only';
  readonly fatal: boolean;      // any violation fails gate G-2
  readonly weight: number;      // within-group weight, default 1
  readonly appliesTo: (m: KataMove) => boolean;
  readonly source: string;      // 'docs/research/01-stances.md §9.1 Z1'
  readonly fixSite: FixSite;
  readonly tierTag?: string;    // 'A6' — links to the 07 §6.8 human/VLM rubric
}

export interface MetricResult {
  readonly id: MetricId;
  readonly moveN: number;
  readonly tick: number;
  readonly camera: CameraPresetId | null;
  readonly value: number;
  readonly ref: number;
  readonly delta: number;       // signed, value − ref
  readonly deltaPct: number;    // signed % of ref → renders as "8 % too short"
  readonly score: number;       // 0..100
  readonly verdict: Verdict;
  readonly fixSite: FixSite;
  readonly source: string;
  readonly provenance: string;  // 'ZENKUTSU.S = 0.540 H ±0.040 [DERIVED] 01-stances.md §3.1'
}

export interface StepScore {
  readonly moveN: number;
  readonly label: string;
  readonly groups: Readonly<Record<MetricGroup, number>>;
  readonly score: number;       // 0.34·G1 + 0.30·G2 + 0.12·G3 + 0.14·G4 + 0.10·G5
  readonly metrics: readonly MetricResult[];
}

export interface Scorecard {
  readonly schema: 'kata-scorecard/2';
  readonly kataId: string;
  readonly gitSha: string;
  readonly trackHash: string;         // ties the score to exact input numbers
  readonly threeRevision: string;     // '185'
  readonly generatedAt: string;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly score: number;             // mean(StepScore.score)
  readonly gates: Readonly<Record<GateId, { pass: boolean; detail: string }>>;
  readonly steps: readonly StepScore[];
  /** The fix queue: worst-first, de-duplicated by fixSite, ≤ 20 entries. */
  readonly fixQueue: readonly {
    readonly fixSite: FixSite;
    readonly worst: MetricResult;
    readonly affectedMoves: readonly number[];
    readonly suggestedDelta: number | null;   // signed nudge in the constant's own unit
  }[];
  readonly regression: {
    readonly baseSha: string;
    readonly deltas: readonly { id: MetricId; moveN: number; scoreDelta: number }[];
  } | null;
}
```

---

## 4. Runtime architecture

### 4.1 Resolved cross-doc conflicts (decided here, once, so no agent re-litigates)

| conflict | decision | why |
|---|---|---|
| Handedness: 01/02/03/04/06 say `+X` = character's LEFT; 07 §0.1 proves `forward × up = +X` = **RIGHT** | **World: `+X` = character's RIGHT.** Authored data keeps doc numbers verbatim. `SIDE_SIGN = -1` lives in `src/contracts/units.ts`; the only conversion is in `src/solve/frame.ts`: negate every authored `x` and every authored yaw magnitude, set `root.rotation.y = +H_deg·DEG` | 07 §0.1 is arithmetically right and three.js is right-handed by construction (05 §1). Relabelling `s` (`s(L) = −1`, `s(R) = +1`) rather than mirroring geometry avoids quaternion-chirality bugs entirely |
| Embusen step unit: 02 uses `L = 0.520 H`; 01 specifies `ZENKUTSU.S = 0.540 H` | **`L = ZENKUTSU.S.v = 0.540 H = 0.945 m`, derived, never authored.** All 02 coordinates scale by ×1.03846 | 02 §1.1 explicitly mandates this rescale. Bounding box becomes 4.00 L = **3.78 × 3.78 m** |
| Embusen stem offset: 02 uses `h = 0.19 L` from `w = 0.385 L`; 01 §6 says `HACHIJI.W = 0.259 H` | **`EMB_H = HACHIJI.W.v / 2 = 0.1295 H = 0.2398 L`**, derived | σ-symmetry and closure assertions are relative and still hold; the stem simply sits at `x = −0.1295 H` |
| Gi sheen: 05 §11.1 says `sheen 1.0`, `sheenColor 0xffffff`; 06 §7.9 says `0.35`, `0xE8E4DA` | **`sheen 0.40`, `sheenColor 0xE8E4DA`, `sheenRoughness 0.55`** (effective ≈ 0.364) | 06's value is argued from Filament cloth data; 05's 1.0 is undefended. Both agree on `sheenRoughness`. Exposed as dispute `D09` |
| Gi anisotropy: 06 §7.9 wants `0.25`; 05 §11 says NO (needs a `tangent` attribute) | **`anisotropy 0.18` with analytic tangents.** `buildGiGeometry` emits `tangent` from the parametric `u` isoline = the warp direction | 05's objection is satisfied by construction because we generate the geometry; no `mikktspace` WASM needed |
| Zenkutsu weight 55 / 59 / 60 / 70 % front | **59 %** with `tol ±3` and metric tolerance `62 ±8` spanning 60 and 70 | 01 §3.6 resolves it geometrically at `S = 0.540 H`; 07 §6.2 metric #7 deliberately spans both. Dispute `D01` |
| Age-uke forearm 25° vs 45° | **25° ±8** | 03 §14.1: 45° puts the wrist at 1.036 H, above the vertex. Dispute `D03` |
| Chudan-uke elbow 90° vs 62° | **62° / 63° / 59°** per 03 §9.1 | 90° is geometrically impossible with de Leva segments plus the same sources' other two constraints. Dispute `D04` |
| Stage AABB for shadow/GTAO: 05 §6.4 assumed 5.5 × 4.0 m | **4.68 × 4.68 m** = 3.78 m embusen + 0.45 m limb envelope each side ⇒ `S_fixed = 0.5·hypot(4.68,4.68) + 0.2 = 3.51 m`; Mode B stays `S_fit = 0.75 H = 1.31 m` | Corrects 05 §16 uncertainty #3 with the real 02 §3.2 figure |

### 4.2 Compile-time solve order — the authoritative pipeline

`compileKata(score, opts)` runs 13 named stages. Each is a pure `(PoseTrack | PoseKey[], Ctx) => same` and each can be individually disabled via `?layers=` (a bitmask) — that is how a fix agent bisects "the pose is wrong but I do not know which stage".

| # | stage | source | notes |
|---|---|---|---|
| S0 | `validateKata` | 02 §11 | 7 invariants + σ-symmetry + closure < 0.01 L + Σ tSlot ±20 % + kiai indices |
| S1 | `buildTimeline` | 02 §1.4, 04 §6.2–6.3 | tempo class → `t_hold/t_prep/t_transit/t_kime`; `tempoScale` multiplies **only** `T_prep` and `T_hold` (04 §6.3). Emits integer tick windows |
| S2 | `footPlanFor` (R0–R5) | 02 §3.1 | moving foot placed from the pivot foot, then midpoint. Pivot drift asserted ≤ 0.02 L |
| S3 | `solveStance` | 01 §3–§7 | inputs are `(footPlan, pelvisY, kneeFlex, pelvisYaw/tilt)`; **`pelvisY` is an input, not an output** — bobbing is structurally impossible |
| S4 | `solveArm` + `solveHikite` + `solveHand` | 03 §4–§13 | GH-local end-effector target → analytic 2-bone IK + roll curve `180·clamp((t−0.65)/0.35,0,1)^2.2`; solver priority = position → roll → elbow swivel → elbow angle (03 §13) |
| S5 | `buildKeyPoses` | — | `PoseKey[]` at `start/prep/mid/kime/hold` per slot |
| S6 | `easeAndBake` | 04 §4.2–4.3, §11 | **the only interpolator is `kimeEase`.** Per-channel `tauP` (0.30 rear-foot → 0.73 end effector) and `lead` (280 ms → 80 ms). Dense 120 Hz emit |
| S7 | `layerHipDrive` | 01 §8.3, 04 §2 | pelvis yaw holds to τ=0.55 then ease-out snap `1−(1−u)³`; `solveCOM` 3 iterations, gain 0.90 |
| S8 | `layerSpineWhip` | 06 §L2 | `spine_i.yaw += −c_i · pelvisYawRate · 0.055 s`, `c = [0.10, 0.18, 0.26, 0.30]`; X-factor capped at 15° (04 §2.1) |
| S9 | `applyPlantLock` + pelvis pass | 06 §6.3 | plant lock stores `{pivotPoint, pivotType, angleCurve}`; pelvis drop clamped `[−0.060 H, 0]`, critically damped τ=0.08 s |
| S10 | `layerHelpers` | 06 §5.4 | twist distribution (0.33/0.67 forearm, 0.50 upperarm/thigh/calf), deltoid slerp 0.5, clavicle `0.33·max(0, abd−30°)` |
| S11 | `solveGaze` | 06 §6.5 | chain 0.15/0.35/0.50, gaze target sampled **+0.090 s ahead**, ω=14 ζ=1 spring integrated *here*, blink schedule seeded from `hash` |
| S12 | `clampSwingTwist` | 06 §3.1–3.2 | elliptic-cone swing + twist clamp on all 44 bones; no-op on knee/elbow (folded into S4/S3) |
| S13 | `emitTrack` + `trackHash` | — | freeze buffers, build marks, hash |

Measured target: **≤150 ms** per kata (6,558 frames × ~12 µs: 4 two-bone IK ≈ 3.6 µs, 44 clamps ≈ 0.5 µs, whip+COM ≈ 5 µs, helpers+gaze ≈ 2 µs). Under Vite HMR, editing `ZENKUTSU.S` recompiles and re-applies at the current tick in **≤250 ms**.

### 4.3 Frame loop (runtime)

```ts
// src/player/loop.ts  — the entire per-frame budget
function frame() {
  const dt   = timer.getDelta();                  // three Timer; Clock is deprecated r183 (05 §13)
  const tick = transport.advance(dt);             // integer 1/1200 s; residual accumulator, no float drift
  poseSource.sample(tick, poseFrame);             // 2 frames + 44 slerps       ~1.4 µs
  applyPose(rig, poseFrame);                      // 44 local quats + root      ~0.08 ms
  for (const l of layers) l.apply(rig, poseFrame, tick);   // breath, blink, poke — closed-form
  rig.root.updateMatrixWorld(true);               //                            ~0.06 ms
  cloth.step(tick);                               // 8 fixed substeps           ~1.10 ms
  cloth.upload();                                 // 988×6 floats               ~0.15 ms
  refitShadow(lights.key, boneAABB(rig), camera); // Mode B + texel snap
  cameraRig.update(dt);                           // OrbitControls damping or exact preset
  post.taa.accumulate = !transport.playing;
  post.render(dt);
}
```

**Runtime layer stack — 4 layers, no IK.**

| # | layer | state? | why it is safe to be live |
|---|---|---|---|
| LR0 | track sample | none | pure function of `tick` |
| LR1 | breath (ribcage X/Z scale 1.000→1.022, sternum +0.5–0.9 cm, clavicle +0.4–0.8 cm) | none | closed-form from `chan.breath[tick]` |
| LR2 | blink + micro-saccade | none | `prng(hash ^ (tick / TICK_HZ | 0))` — deterministic per second |
| LR3 | GUI pose-poke (debug only) | user | never active in a critic run; `flags.poke` recorded in `run.json` |
| LR4 | cloth | **yes** | snapshot-replayable, §4.5 |

**There is no runtime IK.** Justification: the floor is a plane at `y = 0`, so `hit.normal` is always `(0,1,0)` and foot-IK has no runtime-varying input (06 §6.3 says the whole system "collapses to plant-lock + pelvis drop" on a flat floor). Solving it at compile time is *exactly equivalent* and removes the single largest source of scrub non-determinism. It also removes the L9-vs-IK conflict-resolution ambiguity of 06 §6.4 — the residual endpoint error is computed once and **reported in `reports/<sha>/run.json`** rather than jittering at runtime.

### 4.4 Transport / timeline

```ts
export interface Transport {
  readonly tick: number;            // integer, TICK_HZ = 1200 Hz
  readonly rate: number;            // -2 … +2 ; 0 = paused
  readonly playing: boolean;
  advance(dtSeconds: number): number;
  seekTick(tick: number): void;
  seekMove(n: number, phase: TrackMark['kind']): void;
  stepFrames(n: number): void;      // ±1 pose frame = ±10 ticks
  setRate(r: number): void;
  readonly marks: readonly TrackMark[];
}
```

- **Time is an integer.** `tick ∈ [0, durationS·1200]`; Heian = 65,580 ticks. `advance` keeps a fractional residual and only ever adds whole ticks, so 55 s of playback accumulates **zero** float drift. Two sessions that reach tick 41,230 by any path see the same integer.
- Rate presets: `0.1 / 0.25 / 0.5 / 1 / 1.5 / 2` plus continuous drag; negative rate = reverse (free, because sampling is stateless — cloth re-seeds, §4.5).
- `seekMove(n, 'kime')` is the UI's snap target; marks also give `prep`, `foot-contact`, `kiai`, `hold-end`, so the timeline can render the fast pairs (7-8 / 15-16 Taikyoku, 8-9 / 16-17 Heian) as visibly tighter clusters.
- Per-move labels come straight from `KataMove.label / labelEn / stance / tech.level` — no separate label file to drift.

### 4.5 Cloth, and the determinism ledger

Cloth is the only integrator in the system, so it gets an explicit contract.

- Fixed substep `dt_s = 1/480 s` (06 §7.5, `n_sub = 8` at 60 fps), advanced **from the transport tick sequence**, never from wall clock. On a long frame: run up to 3 extra frame-steps, then drop — never scale `dt`.
- `SnapshotStore` writes `{positions, velocities}` (Float32, 988×6×4 B = **23.7 kB**) at every `kime` mark and every 1.0 s. Heian: 21 kime + 55 periodic ≈ 76 snapshots = **1.8 MB**.
- `seek(tick)`: load nearest snapshot ≤ tick, fast-forward with rendering off. Worst case 1.0 s = 480 substeps ≈ **8 ms**. Perceptually instant.
- While a scrub handle is *dragging*: skip fast-forward, re-init to skinned rest + 12 settle substeps (06 §7.7 teleport rule). On release, do the full snapshot→forward pass. Honest statement of the limit: **cloth is snapshot-deterministic, not path-deterministic** — and the capture harness *always* uses the snapshot path, so critic frames are reproducible.

| state source | how it is made seekable |
|---|---|
| base pose, easing, hip drive, spine whip, foot IK, gaze spring, twist/helpers, ROM clamp | **baked** into `PoseTrack` at compile time |
| breath | closed-form in `chan.breath[tick]` |
| blink / saccade | `prng(hash ^ second)` |
| cloth | snapshot ≤1.0 s + fixed-substep fast-forward |
| TAA accumulation | reset on any tick or camera change (`accumulate = false` for one frame); 32 frames to converge when paused |
| shadow texel snap | function of `(camera, boneAABB)` only |
| OrbitControls damping | camera state only, never pose; measurement presets bypass damping and set the matrix exactly |
| canvas size / DPR | pinned to 1024×1024 @ DPR 1 in harness mode |

**Repeatability test (CI):** `tests/eval/repeatability.test.ts` runs the critic twice at the same sha and asserts `scorecard.json` is byte-identical modulo the `timings` field.

### 4.6 Camera rig

`OrbitControls` (05 §13) with `enableDamping = true`, `dampingFactor = 0.05`, `target = (0, 0.55·H, 0) = (0, 0.9625, 0)`, `minDistance 1.6`, `maxDistance 9.0`, `minPolarAngle 0.15`, `maxPolarAngle 1.52`.

| preset | type | transform | use |
|---|---|---|---|
| `ORBIT` | persp 39.6° | user-controlled | default 360° play |
| `HERO` | persp 39.6° | `(1.6H, 0.95H, 2.2H)` → `(0, 0.55H, 0)` | opening / hero shot |
| `FOLLOW` | persp 39.6° | orbit target tracks pelvis XZ with a 0.25 s critically damped lag; radius held | keeps the karateka framed across the 3.78 m embusen |
| `EMBUSEN` | ortho | `(0, 4H, 0)` looking down, up = `−Z`, height `2.2H·2` | floor-pattern view |
| `CAM_FRONT` / `CAM_LEFT` / `CAM_RIGHT` / `CAM_TOP` | **ortho, frozen forever** | 07 §6.6 exactly: `(0,0.5H,+3H)`, `(+3H,0.5H,0)`, `(−3H,0.5H,0)`, `(0,4H,0)`; frustum `height = 2.2H`, aspect 1:1, near `0.1H`, far `10H` | measurement — ortho is mandatory, perspective foreshortening corrupts every length metric |
| `DETAIL_HANDS` / `DETAIL_FEET` | persp 50 mm-equiv | anchored to `chest` / `pelvis` bone, radius 0.9 m | inspect twist/candy-wrapper and plant lock |

Preset changes blend with a critically damped spring (ω=8, ζ=1, ≈0.5 s) **except** measurement presets, which snap exactly and reset TAA.

---

## 5. Render pipeline

### 5.1 Boot order (05 §15, verbatim, with our numbers)

```
WebGLRenderer({ canvas, antialias:false, alpha:false, stencil:false, depth:true,
                powerPreference:'high-performance',
                preserveDrawingBuffer: HARNESS })          // harness only (05 §3)
setPixelRatio(min(devicePixelRatio, 2))  ·  setSize(w,h)
toneMapping = AgXToneMapping ; toneMappingExposure = 1.0   // never touch outputColorSpace
shadowMap.enabled = true ; shadowMap.type = PCFShadowMap   // NEVER PCFSoftShadowMap (05 §14.1 #1)
scene.environment = PMREM.fromScene(dojoEnv, 0.04, 0.1, 40, {size:512, position:(0,0.9625,0)})
scene.environmentIntensity = 0.85 ; scene.environmentRotation = Euler(0, -0.35, 0)
scene.background = Color(0x0e0f12)                          // never the raw PMREM — looks cheap
lights ; scene.add(key.target) ; configureShadow(key)
karateka: frustumCulled = false ; castShadow = true
floor: receiveShadow = true ; castShadow = false            // prevents floor-vs-floor acne
composer = new EffectComposer(renderer)                     // HalfFloatType default
await renderer.compileAsync(scene, camera)
renderer.setAnimationLoop(frame)
```

### 5.2 Exact pass order (05 §8.4 — hard constraints, not opinion)

```
[1] TAARenderPass(scene,camera)  when paused/scrubbing   |  RenderPass(scene,camera)  when playing
[2] GTAOPass(scene,camera,w,h, params, aoParams, pdParams)          linear HDR
[3] BokehPass(scene,camera,{focus,aperture:0.0018,maxblur:0.006})   optional, cinematic mode only
[4] UnrealBloomPass(new Vector2(w,h), 0.22, 0.55, 0.92)             must see pre-tonemap HDR
[5] SMAAPass()                                                     linear-srgb, BEFORE OutputPass
[6] OutputPass()                                                   MANDATORY, applies tonemap + sRGB
[7] LUTPass({lut, intensity})                                      optional final grade
```
`SMAAPass` and `FXAAPass` are mutually exclusive and sit on opposite sides of `OutputPass`; we ship SMAA and never add FXAA. `renderer.antialias` MSAA is bypassed by the composer (05 §14.1 #23) — that is expected.

| pass | settings | source |
|---|---|---|
| `GTAOPass` | `radius 0.30 m`, `distanceExponent 1.0`, `thickness 1.0`, `scale 1.15`, `samples 24`, `screenSpaceRadius false`, `blendIntensity 0.85`, `pd {lumaPhi 10, depthPhi 2, normalPhi 3, radius 6}`, `pdSamples 16`; `setSceneClipBox(stageAABB)` | 05 §8.5 |
| `UnrealBloomPass` | `resolution = canvas px` (not the 256² default), `strength 0.22`, `radius 0.55`, `threshold 0.92` | 05 §8.5 |
| `TAARenderPass` | `sampleLevel 0`, `accumulate = !playing`, 32 jitter samples → converged still | 05 §8.5 |
| `SSAARenderPass` | `sampleLevel 5`, `unbiased true` — **capture harness only**, `--quality=max` | 05 §8.5 |
| resize | call **both** `setSize` and `setPixelRatio` on the composer | 05 §14.1 #22 |

`GTAOPass` renders its own normal G-buffer with `MeshNormalMaterial`, which respects `USE_SKINNING` — one more reason no material in this project may be a `ShaderMaterial` (05 §14.1 #24).

### 5.3 Dojo lighting rig

| light | type | position (m) | intensity | color | shadow |
|---|---|---|---|---|---|
| KEY | `DirectionalLight` | `(2.60, 4.20, 3.15)` — elev 45.8°, azim 39.5° | `3.0 ±0.6` | `0xfff4e8` (~5200 K) | **yes** |
| RIM | `DirectionalLight` | `(-2.10, 2.80, -3.85)` | `1.4` (0.47× key) | `0xdfe9ff` (~7000 K) | no |
| FILL | `DirectionalLight` | `(-2.98, 1.58, 2.28)` | `0.55` (0.18× key) | white | no |
| ambient wrap | `scene.environment` PMREM | — | `environmentIntensity 0.85` | — | — |
| `AmbientLight` | **omit entirely** | — | 0 | — | — |

`key.target.position = (0, 0.875, 0)` — aimed at hip height, not the floor. Note: because we resolved `+X` = the character's **right**, the key now comes from the karateka's right-front. That is the intended look: Taikyoku/Heian both open with a *hidari* (left) technique turning to world `−X`, so the opening move is lit on its leading side. No pre-r155 tutorial intensities may be reused (they are π× too small, 05 §14.1 #26).

Procedural env scene (`buildDojoEnvScene`, all `MeshBasicMaterial`/emissive, nothing fetched): 14×7×14 `BackSide` shell `0x2a2723`; 6.0×1.6 warm window band at `y 3.6, x +6.9`, emissive `0xfff2e0` × 6.0; 3.0×1.2 cool band at `y 3.4, x −6.9`, `0xdfe9ff` × 2.2; 10×10 ceiling bounce `y 6.9`, `0xf2ece2` × 1.1; 12×12 floor bounce `y 0.02`, wood `0x8a5f38`.

### 5.4 Shadow strategy

`PCFShadowMap` only. Mode B per-frame fitted ortho frustum:

| param | value | derivation |
|---|---|---|
| `mapSize` | `2048 × 2048` | 16 MB depth, one caster |
| `S_fit` | `0.75·H = 1.31 m` | fits a one-figure AABB incl. extended limbs |
| world texel `t` | `2·1.31/2048 = 1.28 mm` | |
| `radius` | `4.0` texels | penumbra ≈ `2·4·1.28 = 10.2 mm` → true contact shadow |
| `near / far` | `0.10 / 12.0 m` | |
| `bias` | `0.0` | with `normalBias` set, constant bias peter-pans |
| `normalBias` | `0.015 m` | ≈12× texel; tune first if gi folds show acne |
| `intensity` | `0.92` | leaves IBL fill readable in the core |
| AABB source | 24 bone world positions inflated by per-bone radius — **not** `computeBoundingBox()` | ~50× cheaper than CPU-skinning every vertex |
| texel snap | `pos = round(pos/t)·t` in light space | three.js does not do this; without it the shadow swims during orbit |

PCF dithers per pixel (IGN-rotated Vogel disk) so a static frame shimmers — resolved by `TAARenderPass.accumulate` when paused. `shadow.blurSamples` is VSM-only and must not be set. `CSM` and `VSM` are both rejected (05 §6.1, §6.5).

**Second occlusion layer:** `GTAOPass` at `radius 0.30 m` is what produces the dark crease where the gi meets the floor and where the rear heel meets the boards. 05 §6.4 calls it "the single biggest AAA-vs-hobby delta for this scene" — it is not optional.

### 5.5 Material list (9, one factory, zero `onBeforeCompile`)

| id | class | key params |
|---|---|---|
| `M_GI` | `MeshPhysicalMaterial` | `0xF2F0EA`, rough `0.78`, metal `0`, `sheen 0.40`, `sheenColor 0xE8E4DA`, `sheenRoughness 0.55`, `specularIntensity 0.35`, `ior 1.45`, `anisotropy 0.18` + analytic tangents, weave `normalMap` (`NoColorSpace`, `normalScale 0.60`), crease `normalMap` blended by the wrinkle attribute, `DoubleSide` on skirt/sleeve/obi-tails, backface albedo ×0.72 |
| `M_SKIN` | `MeshPhysicalMaterial` | rough `0.48`, metal `0`, `sheen 0.15`, `sheenRoughness 0.85`, `ior 1.40`, `specularIntensity 0.6`, `normalScale (0.7,0.7)`. **No `SubsurfaceScatteringShader`** — it is Phong-based and a `ShaderMaterial` (05 §11.1) |
| `M_OBI` | `MeshPhysicalMaterial` | `0x14110f`, rough `0.62`, `sheen 0.25`. Black belt is a *rendering* decision: it separates jacket from trousers so stance depth reads in silhouette |
| `M_FLOOR` | `MeshStandardMaterial` | `0x7d5636`, rough `0.42`, `roughnessMap` + `normalMap` procedural (`NoColorSpace`), `RepeatWrapping`, `map.anisotropy = min(8, getMaxAnisotropy())`, `receiveShadow true`, `castShadow false` |
| `M_BACKDROP` | `MeshStandardMaterial` | `0x0e0f12`, rough `0.95` — the visible shell, distinct from the PMREM env scene |
| `M_HAIR` | `MeshStandardMaterial` | `0x1a1512`, rough `0.55`, simple shell |
| `M_EYE` | `MeshStandardMaterial` | rough `0.18`; 2 small spheres on the eye bones (2 of ~30 draw calls) |
| `M_EMBUSEN` | `MeshBasicMaterial` | transparent, `toneMapped false`, `depthWrite false`, decal plane at `y = 0.002` |
| `M_DEBUG` | `LineBasicMaterial` | `toneMapped false` — skeleton, reference stick, silhouette pass |

Hard rules: `scene.environment` is set and **every** `material.envMap` stays `null` (05 §14.1 #11); `transmission = 0` everywhere (05 §14.1 #13); albedo/emissive maps `SRGBColorSpace`, normal/roughness/AO maps `NoColorSpace` (the #1 silent PBR bug); all materials `toneMapped = true` except `M_EMBUSEN`/`M_DEBUG`.

Draw-call budget: karateka body 1 + gi 4 (uwagi, zubon, collar, obi) + eyes 2 + hair 1 + floor 1 + backdrop 1 + embusen decal 1 = **12 opaque draws**, ~25 k triangles.

---

## 6. The automated critic loop

### 6.1 CLI

```bash
npm run critic                            # both kata, full plan, gates → exit code
npm run critic -- --kata heian-shodan     # one kata
npm run critic -- --step 4 --cam all      # one move, all cameras, 8 sub-ticks  (the fix-loop inner cycle)
npm run critic -- --fast                  # TAA 8 frames, RenderPass+OutputPass only, ~20 s smoke
npm run critic -- --quality max           # SSAARenderPass level 5, for the final contact sheet
npm run critic -- --baseline <sha>        # emit regression.json against a previous run
npm run shots                             # capture only, no scoring
npm run build:track                       # compile + hash tracks, no browser
npm run verify:constants                  # doc-vs-code numeric drift check
npm run bench                             # 600-frame frame-time histogram
```

New `package.json` scripts: `critic`, `score`, `build:track`, `verify:constants`, `bench` (keep existing `dev`, `build`, `typecheck`, `test`, `shots`).

### 6.2 How a headless run captures labeled frames

`tools/critic.mjs` orchestrates; `tools/capture.mjs` drives the browser.

1. `build:track` compiles both `PoseTrack`s in node and prints `trackHash`. Fails fast on any `validateKata` invariant — **no browser is launched if the data is wrong.**
2. Start `vite preview --port 5178 --strictPort` (already in `package.json`).
3. Launch Playwright Chromium with the flags proven by `tools/probe-webgl.mjs`: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Viewport fixed **1024 × 1024, DPR 1**.
4. Navigate to `http://127.0.0.1:5178/?harness=1&kata=<id>&quality=<q>`. In harness mode: `preserveDrawingBuffer: true`, `OrbitControls` disabled, `LR3` poke disabled, blink PRNG seeded from `trackHash` only.
5. `await page.evaluate(() => window.__KATA_HARNESS__.ready)`.
6. For each `ShotSpec` from `buildCapturePlan`:

```ts
// src/contracts/services.ts — frozen, so B5 and B8 build in parallel
export interface KataHarness {
  readonly ready: Promise<void>;
  readonly trackHash: string;
  readonly plan: readonly ShotSpec[];
  /** Seeks via the cloth snapshot path, then converges TAA. Resolves when the frame is stable. */
  seek(tick: number, opts?: { taaFrames?: number }): Promise<void>;
  setCamera(preset: CameraPresetId): void;
  setLayers(mask: number): void;
  /** 25 canonical joints, world space + quats, at the current tick. */
  readPose(): CanonicalSample;
  /** Metrics computed IN-PAGE by src/eval/metrics.ts — node never re-implements them. */
  readMetrics(moveN: number): MetricResult[];
  /** PNG data URL of the live canvas. */
  readShot(): string;
  /** 4096×1024 strip: [ours | reference stick | overlay | abs-diff], composed in-page. */
  readPanel(moveN: number, preset: CameraPresetId): string;
  readSilhouetteIoU(moveN: number, preset: CameraPresetId): number;
  readRunInfo(): RunInfo;   // three revision, flags, residual IK error, frame timings
}

export interface ShotSpec {
  readonly tick: number;
  readonly moveN: number;
  readonly mark: TrackMark['kind'];
  readonly camera: CameraPresetId;
  readonly png: boolean;        // false → pose-only sample (cheap, for G4/G5)
  readonly name: string;        // 'step-04-kime-CAM_LEFT'
}
```

7. Node writes bytes; it computes nothing. **Metrics run in-page** because `src/eval/metrics.ts` is already bundled TS and depends only on `Vector3`/`Quaternion` (07 §6.5) — this avoids a second node build target entirely and guarantees the CI numbers and the in-app debug panel use the same code path.

**Plan size.** Per move: 1 kime tick × 4 cameras with PNG (`CAM_FRONT`, `CAM_LEFT`, `CAM_TOP`, `CAM_HERO`) + 8 evenly spaced sub-ticks × 1 camera pose-only. Heian: `21×4 = 84` PNGs + `21×8 = 168` pose samples + 4 ceremony PNGs = **88 stills**. At ~1.5 s/still on SwiftShader with 32 TAA frames ≈ **2.2 min**; `--fast` ≈ 20 s. Outputs go to `reports/` and `captures/`, both already in `.gitignore`.

### 6.3 Numeric scorecard

`computeMetrics` evaluates the 63 `MetricSpec`s (the 61 of 07 §6.2, groups G1–G5, plus the two additions below) on the 25 canonical joints, scores them with 07 §6.3 verbatim, and aggregates:

```
scoreStep = 0.34·G1 + 0.30·G2 + 0.12·G3 + 0.14·G4 + 0.10·G5
scoreKata = mean(scoreStep)
```

Gates (a build wins only if all pass): **G-1** `scoreKata ≥ 85` · **G-2** no `fatal` anywhere · **G-3** `min(scoreStep) ≥ 70` · **G-4** `G1 ≥ 80 && G2 ≥ 80` on every step · **G-5** Channel C `PCK@0.030H ≥ 0.85` on ≥6 annotated PD 1925 Funakoshi postures · **G-6** zero Tier-A findings from the VLM critic. Any metric regressing > 5 points vs `--baseline` fails CI even if gates pass.

Two metrics added beyond 07 §6.2, because two of the most likely "cheap" tells have no numeric gate:

| # | id | formula | ref | tol | hard-fail | fixSite |
|---|---|---|---|---|---|---|
| 62 | `forearm_radius_retention` | min over the mid-forearm ring of `\|v − axis\| / r_bind`, during the 180° zuki roll | `0.97` | `0.03` | `0.10` | `src/rig/skinWeights.ts → rigidify()` / `src/solve/arm.ts → twistDistribution` |
| 63 | `hem_overshoot_H` | peak trouser-hem displacement past its settled position after a kime | `0.037 H` | `0.010` | `0.025` | `src/data/constants/cloth.ts → CLOTH.alphaBend / CLOTH.cDrag` |

Metric 62 catches candy-wrapper (06 §5.4 predicts 100 % radius loss with zero twist bones); metric 63 catches "rigid gi" (07 §6.8 B8, which currently has no metric at all).

Artefacts:

```
reports/<sha>/
  run.json          RunInfo: gitSha, trackHash, three=185, flags, residual IK error, p50/p95 frame ms
  scorecard.json    the Scorecard above
  scorecard.md      one row per metric per step, worst-first, provenance string in each row
  fixqueue.json     ≤20 entries, de-duplicated by fixSite, with suggestedDelta
  regression.json   vs --baseline
  shots/step-04-kime-CAM_LEFT.png
  panels/step-04-kime-CAM_LEFT.png     [ours | ref stick | overlay | abs-diff]
  contact-sheet.png                    all steps × {CAM_FRONT, CAM_LEFT}
  embusen.png                          top-down: reference polyline + actual pelvis track + per-step markers
```

### 6.4 How a fix agent maps a complaint back to one file

The mechanism is not convention — it is a typed field plus a test. Every `MetricSpec` declares `fixSite`, and `tests/eval/fixsites.test.ts` reads every `fixSite.file`, greps for `fixSite.symbol`, and fails if it does not resolve to an exported binding. A fix site cannot silently rot.

`scorecard.md` row for the worked example:

```
STEP 04  zenkutsu (migi)  |  stance_len_H
  value 0.4968 H   ref 0.5400 H   Δ −0.0432 H   (−8.0 %)   score 41   FAIL
  source    docs/research/01-stances.md §3.1  (fault Z1: S < 0.500 H)
  provenance ZENKUTSU.S = 0.540 H ±0.040 [DERIVED] docs/research/01-stances.md §3.1
  FIX  B1  src/data/constants/stances.ts → ZENKUTSU.S            (kind: constant)
       or  src/data/kata/taikyoku-shodan.kata.ts → moves[3].overrides.stance.S
       hint +0.001 H in S ≈ +0.19 % stance_len_H ; suggestedDelta +0.0432
```

Routing table (abridged; the full 63-row version lives in `src/eval/metricSpecs.ts`):

| complaint | metric | block | file → symbol |
|---|---|---|---|
| "front stance 8 % too short at step 4" | `stance_len_H` | B1 | `src/data/constants/stances.ts → ZENKUTSU.S` (or `moves[3].overrides.stance.S`) |
| "hips too high / not karate" | `hip_height_H` | B1 | `src/data/constants/stances.ts → FIGHT_PELVIS_Y` |
| "rear heel lifted" | `rear_heel_gap_H` | B1 | `stances.ts → ZENKUTSU.yawRear` (01 §3.5: ≥30° is a geometric necessity) |
| "head bobs while stepping" | `head_bob_H` | B2 | `src/solve/stance.ts` — `pelvisY` must stay an input |
| "no kime, it decelerates smoothly" | `kime_decel_time_s`, `accel_profile_skew` | B1 | `src/data/constants/dynamics.ts → CHANNEL_DYN.endEffector.tauP` |
| "hips don't lead the punch" | `hip_lead_lag_s` | B1 | `dynamics.ts → CHANNEL_DYN.pelvisYaw.lead` |
| "hikite missing / lazy" | `hikite_present`, `hikite_back_H` | B1 | `src/data/constants/techniques.ts → HIKITE_HIP_A` |
| "punch off the centreline" | `active_fist_lateral_H` | B1 | `techniques.ts → TECHNIQUES['oi-zuki'].end.dx` |
| "shoulders shrugged" | `shoulder_elevation_H` | B2 | `src/solve/arm.ts → clavicleRhythm()` |
| "elbow chicken-wings" | `F1`-family (elbow perp distance) | B2 | `src/solve/arm.ts → poleFor()` |
| "planted foot slides" | `foot_slide_Hps` | B2 | `src/solve/footPlant.ts → applyPlantLock()` |
| "forearm pinches on the punch roll" | `forearm_radius_retention` | B3 | `src/rig/skinWeights.ts → rigidify()` |
| "gi is rigid at kime" | `hem_overshoot_H` | B1/B6 | `src/data/constants/cloth.ts → CLOTH.alphaBend` |
| "figure pasted on the floor" | `contact_shadow_present` | B4 | `src/render/shadow.ts → S_FIT`, `radius` |
| "flat lighting, no separation" | Tier C8 (no metric) | B1 | `src/data/constants/render.ts → LIGHTS.rim.intensity` |
| "whole kata is mirrored" | handedness assertion | contracts | `src/contracts/units.ts → SIDE_SIGN` — **stops all agents** |
| "embusen drifts / doesn't close" | `embusen_return_err_H` | B1 | `src/data/embusen.ts` (L and EMB_H are derived — check the derivation, not the coordinates) |

Because `fixSite.block` is part of the spec, `fixqueue.json` partitions cleanly by owning agent: **N agents can fix N complaints in parallel with zero file contention**, which is the same property that makes the build order below work.

---

## 7. Build order — 6 phases

| phase | blocks in parallel | deliverable | exit gate |
|---|---|---|---|
| **P0 — Freeze** (serial, 1 agent) | contracts only | 8 `src/contracts/*.ts` + `tests/contracts/imports.test.ts` + freeze note. All 8 conflicts of §4.1 written into the files as constants/comments. | `npm run typecheck` clean; contract hash recorded |
| **P1 — Foundations** | **B1** (num, anthro, stances, rom, render consts) · **B3** (bones, bodyMesh, skinWeights, karateka) · **B4** (renderer, dojoEnv, lights, materials, stage) · **B8** (harness protocol, capture.mjs, plan, empty metricSpecs) | `npm run dev` shows the procedural karateka standing in the lit dojo at bind pose. `npm run critic --fast` produces a shape-correct all-zero scorecard. | figure renders; `bone_length_drift_pct` and `COM_y ≈ 0.568 H` unit tests pass; critic writes `scorecard.json` |
| **P2 — Static poses** | **B2** (frame, ease, skeleton, twoBoneIK, swingTwist, stance, arm, hand, com) · **B5** (transport, sampler, cameraRig, loop, app, harness) · **B7** (timeline, hud, gui) · **B8** (metrics G1, G3, G5 + metricSpecs for them) | Every kime pose of Taikyoku Shodan is solvable and jump-seekable; camera presets work; measurement cameras are exact. | `G1 ≥ 80` on all 20 Taikyoku kime poses; `foot_slide`/`penetration`/`float` all clean; handedness tests pass |
| **P3 — Motion** | **B1** (`taikyoku-shodan.kata.ts` complete, dynamics consts, embusen) · **B2** (timeline, keyposes, bake, compile, spine, gaze, footPlant, hash) · **B8** (metrics G2, G4 + Channel B refStick + panel) | Taikyoku Shodan plays end to end at T1 (38.1 s incl. ceremony ≈ 50.15 s); scrub is deterministic; 4-panel overlays render. | `scoreKata ≥ 75`; `repeatability.test.ts` byte-identical; `kimeEase` S(0.5) < 0.30 test passes |
| **P4 — Look + second kata** | **B6** (whole cloth block) · **B4** (post chain, shadow Mode B, textures wiring, overlay) · **B1** (`heian-shodan.kata.ts`, cloth consts) · **B7** (labels, slow-mo, presets, disputed A/B switches) | Both kata, gi cloth with kime snap, full post chain, per-move labels, 0.1×–2× rate. | `scoreKata ≥ 85` Taikyoku, `≥ 80` Heian; `hem_overshoot_H` in band; `bench` p95 ≤ 16.0 ms @1600×900 DPR 1.5 |
| **P5 — Fix loop** | **all 8 blocks, driven by `fixqueue.json` partitioned on `fixSite.block`** | Iterate: `npm run critic` → each agent takes only its own block's entries → re-run. Channel C PD-photo annotation (B8) and VLM Tier-A pass (B8) land here. | **G-1…G-6 all pass on both kata**; no metric regresses > 5 pts; `verify:constants` clean |

Parallelism per phase: P1 = 4 agents, P2 = 4, P3 = 3, P4 = 4, P5 = up to 8. No two agents ever hold the same file, because ownership is by glob and stubs live in the consumer's own `tests/*/fixtures/`.

---

## 8. Top 8 risks

| # | risk | why it is real (numbers) | mitigation |
|---|---|---|---|
| 1 | **Linear interpolation between correct poses** — see §8.1, this is the headline risk | 04 §4.4: at `τ_p = 0.73`, 48.6 % of technique time covers the first 20 % of path and only 18.0 % covers the last 20 %; linear puts 20 % in 20 %. Ratio difference = 2.4× | The compiler has **no linear path**. `kimeEase` is the only interpolator; `tauP` is per-channel from 04 §4.3. Unit test: for every technique, `S(0.5) < 0.30` and `S'(0) = S'(1) = 0`. Gates: metrics 50 `kime_decel_time_s` and 52 `accel_profile_skew` are in G-1/G-4 — a regression to linear fails CI, not a human review |
| 2 | **Handedness mirror** flips the entire kata | 07 §7.14; docs 01/02/03/06 label `+X` as LEFT, which is geometrically the RIGHT. A silent flip renders *migi* for every *hidari* | `SIDE_SIGN` in one frozen file; one conversion function in `src/solve/frame.ts`; three assertion tests (left ear `world.x < 0` at yoi; Taikyoku move 1 facing = world `−X` with the left ankle 0.540 H ahead; Heian move 21 pelvis at `x = +0.544 L`). `CAM_TOP` embusen contact sheet in **every** critic run makes a mirror visible in one image |
| 3 | **LBS candy-wrapper on the 180° zuki forearm roll** | 06 §5.4: 180° across one blend band = **100 % radius loss**; 90° = 29 %; 60° = 13 %; 30° = 3.4 % | 2 forearm twist bones at 33 %/67 % + rigidify so each band spans ≤30 °; new metric 62 `forearm_radius_retention ≥ 0.97`; `DETAIL_HANDS` close-up at every zuki kime in the capture plan. Fallback if it still shows: swing-twist skinning is spec'd in 06 §5.4 Fix 2 but requires `onBeforeCompile`, which is otherwise banned — treat as a last resort and record the decision |
| 4 | **Cloth non-determinism makes the critic chase ghosts** | 988 particles × 8 substeps; a scrub that re-inits cloth yields different hems for the same tick, so a fix agent cannot tell whether its edit worked | Snapshot every kime + 1.0 s (23.7 kB each, 1.8 MB total); harness **always** seeks snapshot→fast-forward (≤8 ms); `run.json` records the snapshot index and a cloth-state hash; `repeatability.test.ts` asserts two runs at one sha are byte-identical |
| 5 | **Constants drift from the research docs**, silently voiding the premise | 8 docs, ~600 cited numbers, transcribed by hand | Every constant is a `Num` carrying `src`. `tools/verify-constants.mjs` greps the cited markdown section for the literal value and fails CI on mismatch. `docs/research/_verify_01_stances.py` (61 assertions) is re-run in CI. Provenance is printed in every scorecard row, so drift is visible at the point of failure |
| 6 | **Frame budget blown by cloth + GTAO + TAA** | 06 §8 budget: CPU 1.75 ms, render 8.00 ms, headroom 6.9 ms — but the 0.6–1.1 ms cloth figure is an extrapolation (06 §11), and a naive object-per-particle implementation is 5–10× slower | Typed arrays and zero per-frame allocation are a review requirement for B6, verified by a `tests/cloth/alloc.test.ts` that asserts stable heap across 600 steps. `npm run bench` p50/p95/p99 histogram; hard gate p95 ≤ 16.0 ms. Quality tiers: cloth 988 → 520 particles (sleeves + skirt only), GTAO `resolutionScale 0.5`, TAA off while playing |
| 7 | **Embusen scale/derivation error** | `L = 0.520` vs `0.540 H` is a 3.85 % error on every coordinate = up to 14.6 cm at the far end of a 3.78 m pattern; `h` derived from two different hachiji widths compounds it | `L = ZENKUTSU.S.v` and `EMB_H = HACHIJI.W.v/2` are **derived, never authored**. The 7 build-time invariants of 02 §11 are unit tests: heading chain, `ff = pivot + Lk·f(H)`, σ-symmetry `σ(x,z) = (−0.38−x, −4.00−z)`, closure residual < 0.01 L, Σ tSlot ±20 %, exactly 2 kiai at the listed indices, every `c` inside the bbox. `embusen.png` in every run |
| 8 | **Documented disputes make us fail either way** | 14 live disputes: hanmi 45° vs 90°; zenkutsu weight 55/59/60/70; age-uke forearm 25° vs 45°; chudan-uke elbow 62° vs 90°; kokutsu `Lk`; Taikyoku 270° vs 90°; kata total 40 s vs 23–34 s; gi sheen; rear-foot yaw 30° vs 45°; hachiji foot yaw; musubi 30° vs 45°; Heian move-4 stance; rhythm `1--2--3` vs `1---2-3`; zenkutsu width | Each is an `AltNum` with a `disputeId`; `src/data/constants/DISPUTED.md` states both readings and the shipped pick; `lil-gui` exposes a live A/B toggle per dispute so a human settles them all in one session. Where the docs say sources disagree, the *metric tolerance* is widened to span both readings (as 07 §6.2 already does: `weight_front_pct 62 ±8` spans 60 and 70) so we are not punished for a defensible choice |

### 8.1 What will most likely make this look cheap or wrong — and the countermeasure

**It will not be the geometry. It will be the timing.** Every stance number in `docs/research/01` can be exactly right and the result will still read as "a mannequin lerping between correct poses" if the interpolation between authored keys is uniform. The single number that separates karate from mime is in 04 §4.4: with `τ_p = 0.73`, **half the technique's duration is spent covering one fifth of the path, and only 18 % of the duration covers the final fifth.** Linear interpolation spends 20 % of the time on 20 % of the path — a 2.4× error in exactly the place a viewer's eye is trained to read. A secondary, equally cheap failure is a *linear* pelvis yaw ramp: 01 §9.5 X3 explicitly flags `|ψ(0.5) − 0.5·(ψ_start+ψ_end)| < 5°` as "high severity — reads robotic", because real *koshi no kaiten* holds until τ ≈ 0.55 and then snaps with `1−(1−u)³`.

**Countermeasure, in three layers:**
1. **Structural.** There is no linear interpolator in the codebase. `src/solve/ease.ts` exports `kimeEase`, `kimeEaseVel` and `holdThenSnap` — and nothing else. Slerp appears in exactly one place (`sampler.ts`, between two adjacent 120 Hz baked frames, spanning ≤7.5° at the peak 900 °/s pelvis rate), where it is provably below perceptual threshold even at 0.25× slow-mo (one source interval spans 4 display frames at 60 fps, so the piecewise-linear velocity artefact is under 2° per display frame).
2. **Gated.** Metrics 50 (`kime_decel_time_s` = 0.07 s ±0.04), 51 (`hip_lead_lag_s` = −0.06 s, **sign inversion is fatal**) and 52 (`accel_profile_skew` = 0.30 ±0.12, where 0.5 means linear) sit inside gates G-1 and G-4. A regression to linear easing fails `npm run critic` with a non-zero exit code before any human looks at a frame.
3. **Visible.** The capture plan samples 8 sub-ticks per move, not just the kime, precisely so the *approach* is scored and not only the destination. `panels/` shows the reference stick figure at the same sub-tick, so a timing error appears as a spatial offset in the overlay — which is what a VLM critic can actually see.

Runner-up cheap tells, each already wired to a gate: rear heel lifted (metric 10, and 01 §3.5 proves it is geometrically forced above `S > 0.580 H`, so the fix is `yawRear`, not "try harder"); rigid gi at kime (new metric 63); no contact shadow (metric 61 + GTAO at 0.30 m); both arms moving symmetrically (metric 51); and 8-head heroic proportions, which 07 §4 warns make stance depth read shallower than the numbers say — we ship **7.7 heads** (`head 0.130 H`), enforced by a unit test on `JOINT_Y`.
