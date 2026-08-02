# Proposal C — PHYSICS-INFORMED KINETIC CHAIN

A 360° kata player where **no joint angle is ever authored**.

Author: architecture agent C · 2026-07-31 · target stack: vite 8 / ts 5.9 / three 0.185.1 / lil-gui 0.21 / playwright 1.62
Grounded in `docs/research/01..07`. Every three.js claim is traced to doc 05, which was verified against `node_modules/three@0.185.1`.

---

## 1. Thesis, and the one thing this optimizes for

**Thesis.** The authored kata data contains only *intent*: a stance goal (footprint + heading + pivot), an end-effector goal in the torso-local frame, a hikite goal, and a timing envelope. Everything a viewer actually sees — pelvis height, knee flexion, spine twist, shoulder lag, the exact frame the fist stops — is **solved** at runtime by a fixed-step chain: ground-reaction weight split → COM trajectory → pelvis pose → spring-damper spine whip → analytic full-body IK → twist redistribution → ROM clamp → cloth. The solver runs at a **fixed 240 Hz integer tick**, is a pure function of `(SimState, KataTimeline, tick)`, and is therefore exactly re-playable; arbitrary seek is *deterministic re-simulation* from a 0.25 s cloth checkpoint plus a 0.5 s spring warm-up, not interpolation of a bake. Consequence: slow-motion at rate 0.25 shows **real 240 Hz dynamics** — the 92 ms kime brake resolves into 22 distinct simulated frames instead of 5 interpolated ones — and the numeric scorecard measures the same states the pixels came from.

**The ONE thing this design optimizes for: PERCEIVED WEIGHT.**

Operationalized as exactly three numbers that the architecture makes structurally hard to get wrong:

| the number | value | source | where it is enforced |
|---|---|---|---|
| hip onset → fist arrival | **245 ms** (±25) | 04 §2.3 `[MEAS]` sEMG + 30 ms EMD | `src/solve/channels.ts` lead table; asserted per-tick |
| slow-start / explosive-arrival split | **48.6 %** of the time covers the **first 20 %** of the path; **18.0 %** covers the last 20 % | 04 §4.4, `τ_p = 0.73` | `src/solve/kimeEase.ts` closed form; no other easing exists in the codebase |
| head-top vertical excursion on a level step | **≤ 0.012 H = 2.1 cm** peak-to-peak | 04 §7.3, 01 §8.1 | clamped at source in `src/solve/com.ts`; fatal metric #17 |

Everything else — silhouette, material, camera — is subordinate. If the weight reads, a rough gi still looks like karate. If the weight does not read, a perfect gi looks like a costume.

**What is deliberately *not* optimized:** torque-level forward dynamics. A muscle-torque simulation cannot be relied on to land on an authored kime pose, and it makes seek expensive. This design is **kinematically targeted, dynamically shaped**: analytic targets, dynamic residuals, hard endpoint authority in the terminal `T_kime` window. That is the decisive engineering trade and §8 R1 states its failure mode and its guard.

---

## 2. Module map and ownership blocks

**Hard rule (checkable in CI):** `import ... from 'three'` is legal **only** under `src/render/**`, `src/camera/**`, `src/app/**`. Everything else — rig, solver, kata data, cloth, eval — is pure TypeScript over `Float64Array`/`Float32Array` and `src/core/quat.ts`. This is what lets `src/solve` and `src/eval` run under vitest in Node with no GL context (required by 07 §6.5.3) and it is asserted by `tests/integration/layering.test.ts`.

### BLOCK 0 — CONTRACTS (serial, phase 0, then FROZEN)

One agent writes these, alone, first. After Phase 0 they are **read-only**; changes require an explicit integrator commit. `hard freeze` = no edits at all. `additive` = new members may be appended, existing ones never changed.

| file | freeze | owns | public exports |
|---|---|---|---|
| `src/core/const.ts` | hard | `H=1.75`, `SIM_HZ=240`, `DT=1/240`, `CLOTH_SUBSTEPS_PER_TICK=2`, `CHECKPOINT_STRIDE=60`, `WARMUP_TICKS=120`, `MAX_INLINE_CATCHUP=8`, `SEEK_BUDGET_MS=6` | `SIM`, `H`, `DT`, `hToM`, `mToH` |
| `src/core/frame.ts` | hard | the single handedness conversion demanded by 07 §0.1 — nowhere else | `SIDE_SIGN`, `authorToWorld`, `headingToYaw`, `facingFromHeading`, `yawOfQuat`, `lateralAxis` |
| `src/core/anthro.ts` | additive | reconciled segment table (de Leva primary, D&C cross-check, 06 §1.5), masses, COM %, limb radii | `ANTHRO`, `SEGMENT`, `MASS_FRAC`, `COM_FRAC`, `RADIUS`, `type Anthro` |
| `src/core/boneIds.ts` | hard | the 44-bone index order, parents, rest offsets, primary axes, ROM clamp table (06 §3.1, §4.2) | `Bone`, `BONE_COUNT`, `BONE_NAMES`, `BONE_PARENT`, `REST_OFFSET`, `PRIMARY_AXIS`, `ROM` |
| `src/core/types.kata.ts` | additive | kata authoring + compiled-timeline types (§3.1, §3.2) | `Move`, `KataDoc`, `CompiledMove`, `KataTimeline`, `EffectorTarget`, `FootTarget`, `StanceGoal`, all string unions |
| `src/core/types.pose.ts` | hard | the pose/FK buffer layout | `PoseBuffer`, `FkBuffer`, `newPose`, `newFk` |
| `src/core/types.solver.ts` | additive | `SimState`, checkpoints, diagnostics | `SimState`, `Checkpoint`, `SpringChannel`, `FootState`, `SolveDiagnostics`, `ChannelId` |
| `src/core/types.scorecard.ts` | additive | metric/score/finding types (§3.3) | `MetricSpec`, `MetricSample`, `StepScore`, `Scorecard`, `CriticFinding`, `BlockId` |
| `src/core/types.harness.ts` | hard | the `window.__kata` contract between block F (implements) and block H (drives) | `HarnessApi`, `HARNESS_KEY` |
| `src/core/rng.ts` | hard | xorshift128+ with a 4-word serializable state; the ONLY randomness in the sim | `Rng`, `rngFromSeed`, `rngSave`, `rngLoad`, `rngFloat` |
| `src/core/quat.ts` | additive | zero-alloc quat/vec3/mat4 kernel on flat arrays; swing-twist split; `quatFromUnitVectors` | ~40 free functions, all `(out, ...) => void` |
| `src/core/index.ts` | additive | barrel | re-exports of the above |

### BLOCK A — RIG + BODY MESH (`src/rig/**`, `src/body/**`)

Pure math + geometry descriptors. No three.js.

| file | owns | exports |
|---|---|---|
| `src/rig/restPose.ts` | builds the T-pose skeleton world positions and the A-pose bind rebake transform (06 §4.1 G1–G5) | `buildRest()`, `aPoseRebake()`, `type RestSkeleton` |
| `src/rig/fk.ts` | zero-alloc forward kinematics: `PoseBuffer → FkBuffer` in one pass, bone-index order | `fk(pose, out)`, `fkFrom(pose, out, firstBone)`, `worldPos`, `worldQuat` |
| `src/rig/clamp.ts` | swing-twist ROM clamp with elliptic swing cone (06 §3.2) | `clampPose(pose, satOut)`, `clampBone()` |
| `src/rig/twist.ts` | twist-bone distribution 0.33/0.67 forearm, 0.50 upperarm/thigh/calf (06 §5.4 Fix 1) | `distributeTwist(pose)` |
| `src/rig/helpers.ts` | deltoid half-slerp, clavicle scapulohumeral rhythm `0.33·max(0, abd−30°)` (06 §5.4 Fix 3b,c) | `driveHelpers(pose, fk)` |
| `src/rig/handPoses.ts` | seiken / shuto / open / nukite local-quat sets from 03 §12, blendable | `HAND_POSES`, `blendHand(pose, side, shape, w)` |
| `src/rig/mirror.ts` | left↔right pose mirroring for `migi`/`hidari` authoring reuse | `mirrorPose()`, `mirrorBone()` |
| `src/body/limbTube.ts` | swept-ring tube/lathe generator with per-station radii and joint edge loops (06 §5.1 B, §5.2) | `sweptTube(spec) => GeomDesc` |
| `src/body/junctions.ts` | authored quad patches at shoulder/hip/groin + junction-only Laplacian, ring vertices pinned | `stitchShoulder()`, `stitchHip()`, `smoothJunctions()` |
| `src/body/head.ts` | cube-sphere head, neck, ears, eye sockets, brow ridge | `buildHead() => GeomDesc` |
| `src/body/hands.ts` | hand + 2-segment finger block + thumb | `buildHand() => GeomDesc` |
| `src/body/feet.ts` | foot / ball / toe with an exact planar sole at local y = −0.0390 H | `buildFoot() => GeomDesc` |
| `src/body/buildBody.ts` | assembles all parts, welds (`tol 1e-4`), creased-normal split at 60°, emits the final descriptor | `buildBodyGeometry() => BodyDesc` |
| `src/body/weights.ts` | skin weights: segment distance → visibility gate → bone-glow `κ=2.6, p=3` → top-4 prune → Laplacian ×5 `λ=0.35` → rigidify at `1.8·r` (06 §5.3) | `computeSkinWeights(desc, rest) => {skinIndex, skinWeight}` |
| `src/body/capsules.ts` | the 15 collision capsules + floor plane, refreshed from `FkBuffer` (06 §7.6) | `buildCapsules()`, `updateCapsules(fk, set)`, `type CapsuleSet` |
| `src/body/geomDesc.ts` | the plain-array geometry descriptor type shared inside block A | `type GeomDesc`, `mergeDesc()` |
| `src/rig/rig.test.ts` · `src/body/body.test.ts` | chain-closure asserts (06 §4.2), `COM_y/H − 0.568 < 0.008`, weight sum = 1 ± 1e-4, no vertex with 5 influences | — |

### BLOCK B — SOLVER (`src/solve/**`)

The heart of this proposal. No three.js.

| file | owns | exports |
|---|---|---|
| `src/solve/kimeEase.ts` | the single easing family used everywhere: `S(τ)`, `V(τ)`, `A(τ)`, `aFromPeak` (04 §4.2) | `kimeEase`, `kimeEaseVel`, `kimeEaseAcc`, `aFromPeak` |
| `src/solve/channels.ts` | the 8 kinetic-chain channels: `τ_p` + ms lead, scaled by `T_tech/0.340` (04 §2.3, §11) | `CHANNELS`, `channelAlpha(tick, arrivalTick, TtechTicks, ch)`, `channelVel()` |
| `src/solve/intent.ts` | samples `KataTimeline` at a tick → the intent record the rest of the solver consumes | `sampleIntent(timeline, tick, out)`, `type Intent` |
| `src/solve/grf.ts` | weight-transfer curve `W_f(τ)` and the support-polygon target (04 §7.1, §3.4 phases A/B/C) | `solveGrf(intent, out)` |
| `src/solve/com.ts` | COM path along the authored control points with `kimeEase(τ,0.45)`; **vertical hard-clamped to ±0.008 H**; the −0.006 H drive sink at τ∈[0.15,0.30]; the landing sink `y_hip(t)` of 04 §7.4 | `solveCom(state, intent, out)` |
| `src/solve/pelvis.ts` | pelvis yaw: hold to τ=0.55 then `1−(1−u)³`; sagittal tilt per stance; roll ≡ 0 ± 2.5°; fires the `pelvisYaw` overshoot spring at the arrival tick | `solvePelvisRot(state, intent)` |
| `src/solve/comPelvis.ts` | the 3-iteration pelvis translation solve with feet pinned, gain 0.90, tol 0.002 H (06 §2.2) | `solveComPelvis(state, fk, capsuleSet)` |
| `src/solve/spine.ts` | spring-damper spine whip: `spine_i.yaw += −c_i·ψ̇·τ_lag`, `c=[0.10,0.18,0.26,0.30]`, `τ_lag=0.055 s`, X-factor capped at 15° | `solveSpineWhip(state, intent)` |
| `src/solve/twoBoneIk.ts` | analytic 2-bone IK: soften (`s=0.97`), joint-limit-folded law of cosines, pole plane, two swings (06 §6.1) | `solveTwoBone(args, out)`, `type TwoBoneArgs` |
| `src/solve/legIk.ts` | plant FSM `PLANTED/RELEASING/AIRBORNE/LANDING`, pivot-point rotation locks, pelvis drop pass (`τ=0.08 s`), ankle aim, authored ball/toe curve | `solveLegs(state, intent, fk)`, `footSlip(state)` |
| `src/solve/armIk.ts` | GH-relative effector target → world via the *current* chest frame; pole table (06 §6.2); forearm roll windows (03 §4.3); hikite as a first-class effector | `solveArms(state, intent, fk)` |
| `src/solve/lookAt.ts` | chest 0.15 / neck 0.35 / head 0.50, 90 ms gaze lead, eye residual, blink with kime suppression | `solveLookAt(state, intent, fk)` |
| `src/solve/springs.ts` | the fixed-order, serializable second-order settle bank of 04 §5.1 (8 channels) | `SPRING_SPEC`, `newSprings()`, `stepSprings(springs)`, `fireSpring(springs, id, amp)` |
| `src/solve/breath.ts` | ribcage X/Z scale 1.000/1.022/0.994, hara bulge, abdominal draw-in at kime, kiai compression (04 §8) | `solveBreath(state, intent)` |
| `src/solve/solveTick.ts` | **the orchestrator** — the L0…L12 order of §4.2 for exactly one 1/240 s tick | `solveTick(state, timeline, tick)` |
| `src/solve/state.ts` | `SimState` alloc, cold-start from analytic pose, checkpoint pack/unpack, FNV-1a state hash | `newSimState`, `coldStart`, `packCheckpoint`, `unpackCheckpoint`, `hashState` |
| `src/solve/diagnostics.ts` | per-tick residuals: IK endpoint error, clamp saturation, plant slip, COM error, rolling head-Y p-p | `newDiagnostics()`, `resetMoveWindow()` |
| `src/solve/*.test.ts` | IK exactness (`|C'−T| < 1e-9` in range), determinism, COM convergence in ≤3 iters, `ikResidual < 0.005 m` at every arrival tick of both kata | — |

### BLOCK C — KATA DATA + INTENT COMPILER (`src/kata/**`)

Transcription of docs 01–04 into typed data, plus the compiler. No three.js.

| file | owns | exports |
|---|---|---|
| `src/kata/stances.ts` | the STANCE table of 01 §10 as `StanceGoal` records, with `stance(id, side)` mirroring | `STANCES`, `stance()`, `type StanceGoal` |
| `src/kata/techniques.ts` | 03 §13 END table + START/MID keyframe offsets + palm normals + roll windows + pole hints + hand shapes | `TECHNIQUES`, `technique(id, level, side)` |
| `src/kata/dynamics.ts` | 04 §10 per-technique dynamics rows (`T_tech`, `T_thrust`, `Δψ`, `ω_ψ`, `τ_p`, `v_pk`, leads, `T_kime`, recoil) | `DYNAMICS`, `type TechniqueDynamics` |
| `src/kata/tempo.ts` | tempo tiers T0–T3, `t_slot` classes of 02 §1.4, pause classes P0–P4 of 04 §6.3, `tempoScale` rule | `TEMPO_TIERS`, `TEMPO_CLASSES`, `PAUSE_CLASSES`, `resolveTempo()` |
| `src/kata/embusen.ts` | footfall rules R0–R5, coordinate generation from `pivot + Lk·f(H)`, σ-symmetry, closure residual | `generateEmbusen(kata)`, `EMBUSEN_RULES`, `sigma()` |
| `src/kata/taikyokuShodan.ts` | the 20-move table of 02 §4.1 verbatim | `TAIKYOKU_SHODAN: KataDoc` |
| `src/kata/heianShodan.ts` | the 21-move table of 02 §6.1 verbatim | `HEIAN_SHODAN: KataDoc` |
| `src/kata/ceremony.ts` | rei / announce / yoi / set / finalHold / yame / settle / attention / reiOut (02 §2) | `CEREMONY_OPEN`, `CEREMONY_CLOSE` |
| `src/kata/compile.ts` | `KataDoc + tempo → KataTimeline`: absolute tick grid, `MoveWindows`, arrival ticks, foot targets, effector targets, COM control points, `moveOfTick`, `labelOfTick` | `compileKata(doc, tempo) => KataTimeline` |
| `src/kata/validate.ts` | the 7 build-time invariants of 02 §11 + closure < 0.01 L + exactly 2 kiai at the listed indices + Σ t_slot within 20 % | `validateKata(doc)`, `validateTimeline(tl)` |
| `src/kata/labels.ts` | romaji + English + count labels; the capture-filename slug | `moveLabel(m)`, `moveSlug(m)` |
| `src/kata/*.test.ts` | all of §11 as assertions; heading chain; `ff` recomputation; bounding box | — |

### BLOCK D — CLOTH (`src/cloth/**`)

XPBD, 988 particles, 2 substeps per 240 Hz tick = 1/480 s. No three.js.

| file | owns | exports |
|---|---|---|
| `src/cloth/garments.ts` | the garment inventory and grids of 06 §7.3, WKF-legal dimensions of §7.1, kata cut | `GARMENTS`, `type GarmentSpec` |
| `src/cloth/buildGi.ts` | gi geometry generation: skinned parts (chest/back/collar/knot) + simulated parts, UVs at 147×131 repeats/m, pin rings, LRA geodesics, panel layer offsets | `buildGi(rest) => GiDesc` |
| `src/cloth/xpbd.ts` | the kernel: distance / shear / dihedral-bend / attachment / LRA, `α̃ = α/dt_s²`, λ reset per substep, fixed Gauss–Seidel index order | `XpbdSolver`, `stepSubstep()` |
| `src/cloth/collide.ts` | capsule + plane collision, per-particle collider whitelist, and the per-frame AABB broad-phase that can *temporarily* extend a whitelist (06 uncertainty 17) | `collideAll(x, capsules, whitelist)` |
| `src/cloth/params.ts` | `α_stretch=0`, `α_shear=4e-5`, `α_bend=8e-3` (calibrated by the swatch test), damping 0.980/frame, per-part `c_drag`, μ, clamps | `CLOTH_PARAMS` |
| `src/cloth/state.ts` | cloth pack/unpack for checkpoints (x + v, `xPrev = x − v·dt_s` on restore — exact), NaN guard, teleport re-init at `|Δp_pin| > 0.05 H` | `packCloth`, `unpackCloth`, `reinitCloth`, `guardNaN` |
| `src/cloth/wrinkle.ts` | per-vertex compression `s = mean(l/l0 − 1)` → `smoothstep(−0.03,−0.12,s)` with asymmetric hysteresis (attack 0.05 s, release 0.9 s) | `updateWrinkle(state)` |
| `src/cloth/normals.ts` | recomputes cloth vertex normals from the simulated positions, welded across panel seams | `recomputeClothNormals()` |
| `src/cloth/swatch.test.ts` | **the calibration gate**: 0.20 m swatch, 3 cm grid, clamped edge, settle 2 s, free edge must droop 7.5 ± 1.5 cm. Fails until `α_bend` is right. | — |
| `src/cloth/xpbd.test.ts` | determinism, tunnelling (11 m/s sweep vs 4.9 cm capsule), stretch ≤ 1.02 | — |

### BLOCK E — RENDER (`src/render/**`)

The only place (with F) that touches three.js.

| file | owns | exports |
|---|---|---|
| `src/render/renderer.ts` | `WebGLRenderer` per 05 §3, `AgXToneMapping`, exposure 1.0, `PCFShadowMap`, pixelRatio `min(dpr,2)` | `createRenderer(canvas)` |
| `src/render/dojoEnv.ts` | the procedural PMREM source Scene: 14×7×14 back-side shell, 2 window bands, ceiling + floor bounce | `buildDojoEnv() => Scene` |
| `src/render/ibl.ts` | `PMREMGenerator.fromScene(env, 0.04, 0.1, 40, {size:512, position:(0,0.9625,0)})`, keeps the RT, `environmentIntensity 0.85`, `environmentRotation (0,−0.35,0)` | `buildIbl(renderer, scene)`, `disposeIbl(h)` |
| `src/render/lights.ts` | KEY 3.0 / RIM 1.4 / FILL 0.55 directionals, targets added to the scene, key shadow config | `buildLights(scene) => LightRig` |
| `src/render/shadowFit.ts` | Mode B: AABB from 24 bone positions inflated by per-bone radius → ortho `±S_fit` → **light-space texel snap** | `refitShadow(rig, fk)` |
| `src/render/materials.ts` | the single material factory — the WebGPU escape hatch of 05 §2.3. No `onBeforeCompile` anywhere. | `createMaterials(tex) => MaterialSet` |
| `src/render/texWeave.ts` | procedural 12 oz duck weave normal, 512², 8 warp × 6 weft cells, crown 0.18 mm, `NoColorSpace` | `weaveNormal() => DataTexture` |
| `src/render/texFloor.ts` | 2048² wood plank albedo (`SRGBColorSpace`) + roughness + normal `CanvasTexture`, `RepeatWrapping`, anisotropy `min(8, max)` | `floorTextures() => FloorTex` |
| `src/render/texCrease.ts` | baked static crease field per garment part (R = intensity, G = direction): 7–9 vertical skirt folds at 0.030–0.045 H, elbow crooks, permanent knee crease | `creaseField(part) => DataTexture` |
| `src/render/texEye.ts` | sclera/iris/pupil canvas texture | `eyeTexture()` |
| `src/render/dojo.ts` | visible set dressing: floor, back wall, dark backdrop gradient, optional embusen decal plane | `buildDojo(scene, mats)` |
| `src/render/embusenDecal.ts` | our own SVG/canvas embusen trace (07 §2.2 — never a Commons SVG) as a transparent decal | `embusenDecal(kata)` |
| `src/render/boneBridge.ts` | `PoseBuffer → Bone.quaternion/position`, `skeleton.update()`; the ONLY writer of three.js bones | `BoneBridge`, `writePose(pose)` |
| `src/render/clothBridge.ts` | uploads cloth positions/normals/wrinkle into `BufferAttribute`s | `ClothBridge`, `upload(state)` |
| `src/render/characterMeshes.ts` | `GeomDesc/GiDesc → BufferGeometry → SkinnedMesh`; `frustumCulled=false`, `castShadow=true`, `bind()`, `normalizeSkinWeights()` | `buildCharacter(desc, gi, mats) => Character` |
| `src/render/composer.ts` | `EffectComposer` and the exact pass order of §5.1, plus `setStill(bool)` | `buildComposer(renderer, scene, cam) => Composer` |
| `src/render/captureMode.ts` | offline quality override: `SSAARenderPass`, `preserveDrawingBuffer`, pixelRatio 2, silhouette-mask pass | `enableCapture(opts)`, `renderSilhouette()` |
| `src/render/render.test.ts` | GL-free asserts: pass order array, material parameter table, no `material.envMap` set anywhere | — |

### BLOCK F — PLAYER SHELL (`src/app/**`, `src/camera/**`, `src/ui/**`, `index.html`)

| file | owns | exports |
|---|---|---|
| `index.html` | canvas + UI mount points + `?harness=1` detection | — |
| `src/app/style.css` | shell styling, timeline, labels | — |
| `src/app/main.ts` | entry; boot order of 05 §15 | side effects only |
| `src/app/engine.ts` | the tick pump, `reachTick`, the render call, the display-vs-sim clock split | `Engine`, `createEngine(opts)` |
| `src/app/transport.ts` | `playing / rate / tick / mode / loop / tempoTier`, tick↔seconds, move-boundary snapping, keyboard | `Transport` |
| `src/app/checkpoints.ts` | the checkpoint ring: lazy build during playback, `floor(tick)` lookup, LRU eviction to a 4 MB cap with stride widening | `CheckpointStore` |
| `src/app/scrubPreview.ts` | kinematic-only preview during an active drag + the catch-up scheduler (≤ `SEEK_BUDGET_MS` per frame) | `ScrubPreview` |
| `src/app/harness.impl.ts` | implements `HarnessApi` on `window.__kata` when `?harness=1`: `seek`, `seekAndSettle`, `setCamera`, `sampleJoints`, `streamJoints`, `dumpScorecard`, `isSettled` | `installHarness(engine)` |
| `src/camera/orbit.ts` | `OrbitControls` wrapper: damping 0.05, `minDistance 1.6`, `maxDistance 9.0`, polar `[0.15, 1.52]`, target = critically-damped follow of pelvis XZ at `y=0.55 H`, `τ=0.35 s` | `createOrbit(cam, dom)` |
| `src/camera/presets.ts` | the 9 cameras of §4.5 — the 4 ortho measurement cameras are **frozen forever** | `CAMERA_PRESETS`, `applyPreset(cam, id, subject)` |
| `src/camera/director.ts` | optional auto-tour: per-move preset schedule, 0.6 s eased transitions, off by default | `Director` |
| `src/ui/timeline.ts` | scrub bar with per-move ticks, `T_prep/T_tech/T_kime/T_hold` bands, kiai markers, drag/snap | `mountTimeline(engine)` |
| `src/ui/labels.ts` | move label overlay (count · romaji · English · stance), tempo readout, kiai flash | `mountLabels(engine)` |
| `src/ui/gui.ts` | lil-gui: kata, tempo tier, rate, camera preset, layer toggles (cloth / IK / AO / shadow / TAA), debug overlays | `mountGui(engine)` |
| `src/ui/debugOverlay.ts` | skeleton helper, COM marker, support polygon, embusen trace, live `ikResidual` / `headBob` readouts | `mountDebug(engine)` |
| `src/ui/about.ts` | credits, provenance, licence notes (07 §6.9) | `mountAbout()` |
| `src/app/*.test.ts` | transport arithmetic, snapping, checkpoint eviction | — |

### BLOCK G — EVAL (`src/eval/**`)

GL-free; runs in the page (harness) *and* in vitest (Node).

| file | owns | exports |
|---|---|---|
| `src/eval/canonicalJoints.ts` | 44-bone rig → the 25-joint Mixamo-named canonical set of 07 §0.3, incl. virtual `*FistCenter` at `0.030 H` beyond the wrist | `toCanonical(fk, out)`, `CANONICAL_NAMES` |
| `src/eval/metrics.ts` | the 61 metrics of 07 §6.2 as pure functions + the frozen `MetricSpec` table with `blame` lists | `METRICS`, `computeMetrics(sample, ref) => MetricSample[]` |
| `src/eval/faults.ts` | 01 §9 (Z/K/B/Y/X) + 03 §11 (F) fault predicates → `CriticFinding[]` with tier + blame | `detectFaults(stream, timeline)` |
| `src/eval/score.ts` | `scoreMetric/Group/Step/Kata` verbatim from 07 §6.3 + gates G-1…G-6 | `scoreAll(samples) => Scorecard` |
| `src/eval/refBank.ts` | loads and validates `data/reference/*.ref.json` (§3.4) | `loadRefBank(json)` |
| `src/eval/referenceFigure.ts` | Channel B: FK the canonical skeleton from a ref record via analytic 2-bone IK → deterministic reference pose | `buildReferencePose(step)` |
| `src/eval/overlaySvg.ts` | draws reference stick + capsule envelope + agreement zones as SVG — 100 % our own IP | `renderOverlaySvg(ours, ref, cam)` |
| `src/eval/silhouette.ts` | binary-mask IoU on two `ImageData`s | `silhouetteIou(a, b)` |
| `src/eval/pd1925.ts` | Channel C: PD Funakoshi joint annotations → normalize → MPJPE / PCK@0.030H / limb-angle MAE | `scorePd1925(ann, ours)` |
| `src/eval/report.ts` | `scorecard.json`, `scorecard.md`, `regression.json` (>5 pt regression fails) as strings | `writeScorecardMd`, `diffScorecards` |
| `src/eval/fileMap.ts` | **the critic → file router**: `MetricId | FaultId → { files[], ownerBlock, knob }` | `BLAME_MAP`, `blame(id)` |
| `src/eval/*.test.ts` | every metric against a hand-built synthetic pose with a known answer | — |

### BLOCK H — HARNESS + TOOLING (`tools/**`, `tests/**`)

| file | owns |
|---|---|
| `tools/probe-webgl.mjs` | (exists) the SwiftShader flag set, proven. All other tools import its flags. |
| `tools/browser.mjs` | shared Playwright launch + `?harness=1` navigation + `waitForHarness()`; single source of the launch flags |
| `tools/shotlist.mjs` | builds `captures/<sha>/<kata>/shotlist.json` from the compiled timeline: kime ticks × cameras, plus the intra-move tick list for the joint stream |
| `tools/capture.mjs` | the capture driver: joint stream dump + labelled PNG shots (`npm run shots`) |
| `tools/score.mjs` | drives `window.__kata.dumpScorecard()`, writes `reports/<sha>/scorecard.{json,md}` + `regression.json` + `gates.json`, exits non-zero on gate failure |
| `tools/sheet.html` | in-browser compositor page for 4-panel strips and contact sheets (no image-lib dependency) |
| `tools/contactSheet.mjs` | composites `[ours \| reference \| overlay \| diff]` strips and the per-kata contact sheet |
| `tools/criticPrompt.mjs` | emits `reports/<sha>/critic-<kata>-<batch>.md`: the 07 §6.8 VLM prompt pre-filled with step, technique, camera, numeric deltas, and the blame list |
| `tools/verifyDeterminism.mjs` | 200 random seek sequences per kata; asserts `hashState(linear) === hashState(seeked)` |
| `tools/verifyOwnership.mjs` | maps changed paths → block; fails if one commit spans blocks (integrator commits exempt via a marker) |
| `tools/perf.mjs` | headless tick/frame timing: mean + p95 per subsystem, written to `reports/<sha>/perf.json` |
| `tests/integration/layering.test.ts` | greps the tree: no `from 'three'` outside `src/render\|src/camera\|src/app`; no `Math.random\|Date.now\|performance.now` under `src/solve\|src/cloth\|src/eval` |
| `tests/integration/pipeline.test.ts` | compile → solve 55 s → canonical joints → metrics → gates, entirely in Node, no GL |
| `tests/e2e/boot.spec.ts` | boots the app, renders, asserts zero console errors and a real WebGL2 context |
| `tests/e2e/scrub.spec.ts` | app-level scrub determinism and the 6 ms seek budget |

### Frozen-first summary

Freeze, in this order, before any parallel work: `const.ts` → `frame.ts` → `boneIds.ts` → `types.pose.ts` → `types.kata.ts` → `types.solver.ts` → `types.scorecard.ts` → `types.harness.ts` → `quat.ts` → `rng.ts` → `anthro.ts`. Two of these carry project-ending risk if wrong: **`frame.ts`** (the 07 §0.1 handedness trap — get it wrong and every kata mirrors) and **`boneIds.ts`** (bone index order is baked into `skinIndex`, checkpoints, and every metric).

---

## 3. Data formats — real declarations

Cross-file imports are elided for readability but are required: `types.kata.ts` imports `ChannelId` from `types.solver.ts`; `types.scorecard.ts` imports `TechniqueId`, `StanceId`, `KataDoc`, `TempoTier` from `types.kata.ts`. No other direction of dependency is permitted among the frozen files (`boneIds.ts`, `const.ts`, `frame.ts`, `quat.ts`, `rng.ts` depend on nothing).

### 3.1 Authored kata (intent only — note the absence of any joint angle)

```ts
// src/core/types.kata.ts
export type Side = 'L' | 'R';
export type StanceId =
  | 'heisoku' | 'musubi' | 'heiko' | 'hachiji'
  | 'zenkutsu' | 'ashi-zenkutsu' | 'han-zenkutsu' | 'kokutsu' | 'kiba' | 'moto';
export type Level = 'jodan' | 'chudan' | 'gedan';
export type TechniqueId =
  | 'none' | 'gedan-barai' | 'oi-zuki' | 'gyaku-zuki' | 'choku-zuki'
  | 'age-uke' | 'soto-uke' | 'uchi-uke' | 'shuto-uke' | 'tettsui-tate-mawashi';
export type HikiteForm = 'HIP-A' | 'TATE-B' | 'NONE';
export type FootRule  = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type SimRule   = 'S1' | 'S2' | 'S3';
export type TempoClass = 'M1' | 'N' | 'F' | 'T90' | 'T135' | 'T180' | 'T270' | 'D45';
export type PivotKind = 'BALL' | 'HEEL' | 'WHOLE_FOOT' | 'NONE';
export type HandShape = 'seiken' | 'shuto' | 'open' | 'nukite';
export type TempoTier = 'T0' | 'T1' | 'T2' | 'T3';

/** One authored movement. Transcribed 1:1 from docs/research/02 §4.1 / §6.1. */
export interface Move {
  readonly n: number;
  readonly dH: number;                 // deg, + = to the character's LEFT (CCW from +Y)
  readonly H: number;                  // resulting heading, 0..360
  readonly rule: FootRule;
  readonly pivot: Side | null;
  readonly pivotKind: PivotKind;
  readonly mover: Side;
  readonly stance: StanceId;
  readonly front: Side;
  readonly weighted: Side;             // === front for zenkutsu, rear for kokutsu
  readonly tech: TechniqueId;
  readonly arm: Side;
  readonly level: Level;
  readonly targetH: number;            // fraction of H, the technique's target height
  readonly hikite: HikiteForm;
  readonly kiai: boolean;
  readonly tempo: TempoClass;
  readonly tSlot: number;              // s, previous kime -> this kime (T1 reference)
  readonly sim: SimRule;
  readonly ff: readonly [number, number];   // front-foot centre, units of L
  readonly rf: readonly [number, number];
  readonly c:  readonly [number, number];   // stance centre = canonical embusen point
  readonly labelJp: string;
  readonly labelEn: string;
}

export interface CeremonyPhase {
  readonly id: 'REI_IN' | 'ANNOUNCE' | 'YOI' | 'SET'
             | 'FINAL_HOLD' | 'YAME' | 'SETTLE' | 'ATTENTION' | 'REI_OUT';
  readonly stance: StanceId;
  readonly dur: number;                // s at T1
  readonly trunkPitchDeg?: number;
}

export interface KataDoc {
  readonly schema: 'kata/2';
  readonly id: 'taikyoku-shodan' | 'heian-shodan';
  readonly nameJp: string;
  readonly nameEn: string;
  readonly L: number;                  // embusen step unit, fraction of H (0.520)
  readonly moves: readonly Move[];
  readonly open: readonly CeremonyPhase[];
  readonly close: readonly CeremonyPhase[];
  readonly kiaiAt: readonly number[];
  readonly fastPairs: readonly (readonly [number, number])[];
  readonly nominalTotalS: number;      // 35.25 | 39.75 (moves only, T1)
}
```

### 3.2 Compiled timeline, pose, and simulation state

```ts
// src/core/types.kata.ts (cont.)

/** A stance target: a footprint and a pelvis intent. No knee angles — those are solved. */
export interface StanceGoal {
  readonly id: StanceId;
  readonly lengthH: number;            // ankle<->ankle along the facing axis
  readonly widthH: number;             // ankle<->ankle lateral
  readonly pelvisYH: number;           // 0.410 for all three fighting stances
  readonly loadFrontPct: number;
  readonly footYawFrontDeg: number;
  readonly footYawRearDeg: number;
  readonly pelvisYawDeg: number;       // 0 shomen | +-45 hanmi, already side-resolved
  readonly pelvisTiltPostDeg: number;
  readonly heelDownFront: boolean;
  readonly heelDownRear: boolean;
}

export interface TickWindow { readonly startTick: number; readonly endTick: number }

export interface MoveWindows {
  readonly hold: TickWindow;
  readonly prep: TickWindow;
  readonly tech: TickWindow;
  readonly kime: TickWindow;
  readonly arrivalTick: number;        // === tech.endTick; THE kime lock
  readonly footDownTick: number;       // S1: arrival - 0.04 s
  readonly headLeadTick: number;       // S2: prep.start
  readonly hipStartTick: number;       // S2: prep.start + 0.10 s
  readonly thrustStartTick: number;    // arrival - T_thrust
}

export interface FootTarget {
  readonly side: Side;
  readonly posXZ: readonly [number, number];   // world metres
  readonly yawDeg: number;
  readonly heelDownTick: number;
  readonly releaseTick: number | null;         // authored release; never speed-based
  readonly pivot: { readonly kind: PivotKind;
                    readonly pointXZ: readonly [number, number];
                    readonly fromDeg: number; readonly toDeg: number } | null;
  readonly clearanceH: number;                 // peak sole clearance, 0.008 nominal
}

/** An end-effector goal in the TORSO-LOCAL frame of doc 03 §0.3. Stance-invariant. */
export interface EffectorTarget {
  readonly arm: Side;
  readonly refPoint: 'MCP2' | 'FIST_CENTRE' | 'WRIST' | 'FINGERTIP' | 'HAND_CENTRE';
  readonly start: readonly [number, number, number];   // GH-relative, fraction of H
  readonly mid:   readonly [number, number, number];
  readonly end:   readonly [number, number, number];
  readonly palmNormalStart: readonly [number, number, number];
  readonly palmNormalEnd:   readonly [number, number, number];
  readonly rollDeg: number;
  readonly rollWindow: readonly [number, number];      // fraction of path, e.g. [0.65, 1.00]
  readonly poleDirChest: readonly [number, number, number];
  readonly leader: 'fist' | 'elbow';
  readonly elbowAdvisoryDeg: number;                   // checked, never enforced
  readonly handShape: HandShape;
  readonly maxLateralDevH: number;                     // path straightness budget
}

export interface TechniqueDynamics {
  readonly TtechS: number; readonly TthrustS: number; readonly TkimeS: number;
  readonly dPsiDeg: number; readonly omegaPsiDegS: number;
  readonly tauP: number; readonly vPkMs: number;
  readonly leadMs: Readonly<Record<ChannelId, number>>;
  readonly recoilFracL: number;
}

export interface CompiledMove {
  readonly move: Move;
  readonly w: MoveWindows;
  readonly headingDeg: number;
  readonly pelvisYawStartDeg: number;
  readonly pelvisYawEndDeg: number;
  readonly stanceGoal: StanceGoal;
  readonly feet: readonly FootTarget[];
  readonly active: EffectorTarget | null;
  readonly hikiteT: EffectorTarget | null;
  readonly comPathXZ: readonly (readonly [number, number])[];  // world m, >=2 points
  readonly comBackloadFrac: number;                            // 0.35 at t=0.5
  readonly dyn: TechniqueDynamics;
  readonly gaze: { readonly yawDeg: number; readonly pitchDeg: number; readonly leadTicks: number };
  readonly pause: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
}

export interface KataTimeline {
  readonly kata: KataDoc;
  readonly simHz: 240;
  readonly tempoTier: TempoTier;
  readonly tempoScale: number;         // multiplies T_prep and T_hold ONLY
  readonly totalTicks: number;
  readonly moves: readonly CompiledMove[];
  readonly moveOfTick: Int32Array;     // tick -> index into moves, -1 = ceremony
  readonly labelOfTick: Int32Array;    // tick -> label id
  readonly kimeTicks: Int32Array;      // the authoritative capture/measurement ticks
}
```

```ts
// src/core/types.pose.ts
export const BONE_COUNT = 44 as const;

/**
 * THE canonical pose. Layout is frozen; every block indexes it identically.
 *  q -> BONE_COUNT*4 local quaternions (x,y,z,w), bone-index order
 *  t -> 3            pelvis world translation, metres. NO other bone translates.
 *  s -> 3            ribcage breathing scale, applied to `chest` only
 */
export interface PoseBuffer {
  readonly q: Float64Array;   // length 176
  readonly t: Float64Array;   // length 3
  readonly s: Float64Array;   // length 3
}

/** FK output. Column-major mat4 to match three.js `Matrix4.elements`. */
export interface FkBuffer {
  readonly m: Float64Array;   // BONE_COUNT*16 world matrices
  readonly p: Float64Array;   // BONE_COUNT*3  world positions
  readonly q: Float64Array;   // BONE_COUNT*4  world quaternions
}
```

```ts
// src/core/types.solver.ts
export type ChannelId =
  | 'rearFootDrive' | 'comTranslate' | 'pelvisYaw' | 'hikite'
  | 'thoraxYaw' | 'shoulderGirdle' | 'elbowExtend' | 'wristLock';

export type SpringId =
  | 'fistAxial' | 'elbowAngle' | 'pelvisYaw' | 'thoraxYaw'
  | 'comTravel' | 'comVertical' | 'headYaw' | 'hipSink';

/** Second-order settle channel, 04 §5.1. Fixed order, fully serializable. */
export interface SpringChannel { x: number; v: number; wn: number; zeta: number; amp: number }

export type PlantPhase = 'PLANTED' | 'RELEASING' | 'AIRBORNE' | 'LANDING';

export interface FootState {
  phase: PlantPhase;
  sinceTick: number;
  lockPosXZ: [number, number];
  lockYawDeg: number;
  pivotPointXZ: [number, number] | null;
  ikWeight: number;                    // 0.10 s eased in/out
}

export interface SolveDiagnostics {
  ikResidualM: Float32Array;           // 4 chains: legL, legR, armL, armR
  clampSaturation: Float32Array;       // BONE_COUNT, 0..1
  plantSlipM: [number, number];
  comErrorM: number;
  headYMinM: number; headYMaxM: number; // rolling over the current move
  pelvisYawAtHalf: number;             // for the X3 linearity fatal
  clothMaxStretch: number;
}

/** Everything the simulation carries forward. Nothing else may persist between ticks. */
export interface SimState {
  tick: number;
  readonly pose: PoseBuffer;
  readonly springs: SpringChannel[];   // fixed length 8, SpringId order
  readonly feet: { L: FootState; R: FootState };
  breathPhase: number;                 // 0..1
  blinkNextTick: number;
  readonly wrinkle: Uint8Array;        // per gi vertex, hysteretic 0..255
  readonly cloth: { x: Float32Array; v: Float32Array; xPrev: Float32Array };
  readonly rng: Uint32Array;           // 4 words
  readonly diag: SolveDiagnostics;
}

/** Only cloth + scalars need checkpointing; the rig's springs re-converge in 0.5 s (§4.4). */
export interface Checkpoint {
  readonly tick: number;
  readonly blob: ArrayBuffer;          // ~33 kB: cloth x,v + wrinkle + scalars + rng
  readonly hash: number;               // FNV-1a over blob, for the determinism fuzzer
}
```

### 3.3 Metric scorecard

```ts
// src/core/types.scorecard.ts
export type MetricGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type BlockId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type MetricId = string & { readonly __metric: unique symbol };
export type Verdict = 'pass' | 'warn' | 'fail' | 'fatal';

export interface MetricSpec {
  readonly id: MetricId;
  readonly group: MetricGroup;
  readonly label: string;
  readonly unit: 'H' | 'deg' | 's' | 'pct' | 'H/s' | 'ratio' | 'bool' | 'count' | 'm';
  readonly ref: number;
  readonly tol: number;
  readonly hardFail: number;
  readonly bound: 'both' | 'upperOnly' | 'lowerOnly';
  readonly fatalOnFail: boolean;
  readonly weight: number;                       // default 1
  readonly appliesTo: 'all' | readonly TechniqueId[] | readonly StanceId[];
  /** Files a fix agent should open, most likely first. Frozen with the spec. */
  readonly blame: readonly string[];
  readonly ownerBlock: BlockId;
  readonly knob: string;                         // e.g. "AGE_UKE.end.dy"
}

export interface MetricSample {
  readonly id: MetricId;
  readonly value: number;
  readonly delta: number;                        // value - ref
  readonly score: number;                        // 0..100 per 07 §6.3
  readonly verdict: Verdict;
}

export interface CriticFinding {
  readonly tier: 'A' | 'B' | 'C';
  readonly id: string;                           // 'A5' | 'Z3' | 'F9b' | a MetricId
  readonly step: number;
  readonly tick: number;
  readonly tSec: number;
  readonly camera: string | null;
  readonly observation: string;
  readonly suggestedFix: string;
  readonly blame: readonly string[];
  readonly ownerBlock: BlockId;
  readonly evidence: readonly string[];          // capture PNG paths
}

export interface StepScore {
  readonly step: number;
  readonly label: string;
  readonly technique: TechniqueId;
  readonly stance: StanceId;
  readonly tick: number;
  readonly tSec: number;
  readonly groups: Readonly<Record<MetricGroup, number>>;
  readonly score: number;                        // 0.34 G1 + 0.30 G2 + 0.12 G3 + 0.14 G4 + 0.10 G5
  readonly samples: readonly MetricSample[];
  readonly faults: readonly CriticFinding[];
}

export interface Scorecard {
  readonly schema: 'scorecard/1';
  readonly sha: string;
  readonly kata: KataDoc['id'];
  readonly createdAt: string;
  readonly tempoTier: TempoTier;
  readonly tempoScale: number;
  readonly steps: readonly StepScore[];
  readonly kataScore: number;                    // mean of step scores
  readonly gates: Readonly<Record<'G1'|'G2'|'G3'|'G4'|'G5'|'G6',
                    { readonly pass: boolean; readonly detail: string }>>;
  readonly channelC?: { readonly mpjpe2dH: number; readonly pckH: number;
                        readonly limbAngleMaeDeg: number; readonly n: number };
  readonly findings: readonly CriticFinding[];
  readonly perf: { readonly meanTickMs: number; readonly p95TickMs: number;
                   readonly meanFrameMs: number; readonly seekP95Ms: number;
                   readonly drawCalls: number; readonly tris: number };
  readonly determinism: { readonly seeksChecked: number; readonly mismatches: number };
}
```

### 3.4 Reference bank on disk (`data/reference/<kata>.ref.json`)

Schema extends 07 §6.1 with the tick grid so a shot list can be derived without re-compiling:

```ts
export interface RefStep {
  readonly id: number;
  readonly nameJp: string;
  readonly stance: StanceId;
  readonly technique: TechniqueId;
  readonly facingYawDeg: number;
  readonly embusenXZ: readonly [number, number];  // units of L
  readonly targets: Readonly<Partial<Record<MetricId, number>>>;
  readonly tolOverride?: Readonly<Partial<Record<MetricId, number>>>;
  readonly timing: { readonly moveS: number; readonly kimeHoldS: number };
}
export interface RefDoc {
  readonly schema: 'kata-ref/2';
  readonly kata: KataDoc['id'];
  readonly Hcm: 175;
  readonly convention: { up: '+Y'; facingAtYoi: '-Z'; left: '+X'; sideSign: 1 | -1 };
  readonly tempo: { readonly totalS: number; readonly totalSTol: number };
  readonly steps: readonly RefStep[];
}
```

Conflict rule, restated so no agent has to guess: **for a reference *value*, docs 01/03 win; for a *tolerance*, doc 07 wins.**

---

## 4. Runtime architecture

### 4.1 Two clocks

| clock | rate | owns | may be non-deterministic? |
|---|---|---|---|
| **sim** | fixed 240 Hz integer tick, `DT = 1/240 s` exactly | `SimState` — pose, springs, feet, cloth, breath, rng | **NO.** Pure function of `(SimState, KataTimeline, tick)`. |
| **display** | `renderer.setAnimationLoop`, variable dt from `Timer` | camera, TAA accumulation, shadow refit, UI, composer | yes — camera and post are outside the sim |

Why **240 Hz** and not 60:

| the timing fact that forces it | source | resolution at 60 Hz | at 240 Hz |
|---|---|---|---|
| hikite leads the punching shoulder by **17 ms** | 04 §2.3 `[MEAS]` | 1 frame — unrepresentable | 4 ticks |
| limb stop → gi snap-crack delay **10–20 ms** | 04 §9.1 | 0.6–1.2 frames | 2.4–4.8 ticks |
| `T_thrust = 0.13 s` (the whole explosive phase) | 04 §1 | **8 frames** — 04 explicitly warns this reads as mocap noise | 31 ticks |
| kime brake window `0.27·T_tech = 92 ms` | 04 §5 | 5 frames | 22 ticks |
| peak pelvis yaw 900 °/s | 01 §8.3 | 15 °/frame — over the 12 °/key bound of 05 §10.2 | 3.75 °/tick |
| 240 = 4 × 60 | — | — | a 60 Hz display consumes exactly 4 ticks, **no accumulator remainder ever** |

Cloth substeps = 2 per tick → `dt_s = 1/480 s = 2.083 ms`, **exactly** doc 06's mandated `dt.substep`, and the tunnelling table of 06 §7.5 (2.3 cm/substep at 11 m/s vs a 4.9 cm forearm capsule) transfers unchanged.

### 4.2 Pose solve order — one tick (`src/solve/solveTick.ts`)

This is doc 06 §6.4 L0–L11 with the ground-reaction layers made explicit. **Order is normative; a fix agent may not reorder it.**

| L | operation | file | key numbers |
|---|---|---|---|
| L0 | sample intent from the timeline (windows, targets, τ per channel) | `intent.ts` | — |
| L1 | ground-reaction / weight split `W_f(τ)`; phase A/B/C classification | `grf.ts` | contact at τ=0.62±0.06; `W_f` 0.50→0.00 over τ∈[0,0.30] |
| L2 | COM trajectory: horizontal `kimeEase(τ,0.45)` along `comPathXZ`, back-loaded to 35 % at τ=0.5; **vertical clamped to ±0.008 H**; drive sink −0.006 H at τ∈[0.15,0.30]; landing sink `Δy` 0.006–0.014 H with `T_s=30 ms`, rebound 20 %, `ω_n=28`, `ζ=0.45` | `com.ts` | this layer alone decides whether it looks like karate |
| L3 | pelvis rotation: yaw held to τ=0.55 then `1−(1−u)³` to 1.0; sagittal tilt from the stance goal; roll ≡ 0 ± 2.5° | `pelvis.ts` | 90 % of rotation done by τ=0.92 |
| L4 | pelvis translation: 3 Gauss–Seidel iterations `pelvis.xz -= 0.90·(com_xz − target)`, feet pinned, break at 0.002 H | `comPelvis.ts` | ∂COM/∂pelvis ≈ 0.89 |
| L5 | spine whip: `spine_i.yaw += −c_i·ψ̇·τ_lag` | `spine.ts` | `c=[0.10,0.18,0.26,0.30]`, `τ_lag=0.055 s`, X-factor ≤ 15° |
| L6 | leg IK: plant FSM → frozen target or pivot rotation → analytic 2-bone with knee flexion folded into the solve → ankle aim → authored ball/toe | `legIk.ts` | pelvis drop clamp `[−0.060 H, 0]`, `τ=0.08 s`; slip budget 0.02 L |
| L7 | arm chain: clavicle (girdle channel) → effector world target from the **current** chest frame → analytic 2-bone with the pole table → roll inside its window; hikite solved identically and arrives ≤ 0 ms before the strike | `armIk.ts` | reach cap 0.381 H MCP2 / 0.362 H fist centre |
| L8 | twist redistribution + deltoid slerp + clavicle rhythm | `twist.ts`, `helpers.ts` | 0.33/0.67 forearm ⇒ ≤ 3.4 % volume loss |
| L9 | look-at: chest 0.15 / neck 0.35 / head 0.50, gaze sampled **+0.090 s ahead**, eyes take the residual | `lookAt.ts` | yaw asymmetry gate at 45° |
| L10 | swing-twist ROM clamp; then **exactly one** corrective IK pass; then record the residual. **Never loop to convergence** (frame-rate-dependent jitter). | `clamp.ts` + `legIk/armIk` | `diag.clampSaturation` per bone |
| L11 | step the 8 spring channels; breath; wrinkle hysteresis | `springs.ts`, `breath.ts`, `wrinkle.ts` | fired at the arrival tick, not before |
| L12 | cloth: 2 XPBD substeps against capsules lerped from **this** tick's bone matrices | `xpbd.ts`, `collide.ts` | never a tick behind |

**IK layering rule:** the terminal `T_kime` window is *position-authoritative*. From `thrustStartTick` to `arrivalTick` the effector constraint weight ramps 0→1 with `kimeEase(·, 0.60)`; at `arrivalTick` the weight is exactly 1 and the ROM clamp becomes report-only for the acting arm. The recoil spring is applied **after** the exact target is reached, as an offset from it — so kime lands on the authored pose and the dynamics decorate the exit, never the arrival. Assertion: `diag.ikResidualM[arm] < 0.005 m` at every arrival tick of both kata (0.003 H, one eighth of the tightest metric tolerance).

### 4.3 Cloth update

Cloth is a **strict consumer**: it reads the final bone matrices of the current tick and writes only its own particle buffers. It never feeds back into the pose, so a cloth blow-up can never corrupt the scorecard. Per tick: collision detect once → 2 substeps of (predict → 1 Gauss–Seidel pass over all constraints in fixed index order → resolve collisions at zero compliance → `v = (x − x_prev)/dt_s`). λ resets per substep (Macklin 2019, 1 iteration per substep, no warm start). 988 particles, ~3060 constraints, 2–4 colliders per particle via the bind-time whitelist plus a per-frame AABB broad-phase that can temporarily extend it.

### 4.4 Determinism and arbitrary seek — the core mechanism

**Invariants (each has a CI test):**

1. `solveTick` reads no wall clock. `t = tick * DT`, computed fresh; time is **never accumulated in a float**.
2. The only randomness is `state.rng` (xorshift128+, 4 words, checkpointed). `Math.random`, `Date.now`, `performance.now` are grep-banned under `src/solve/**`, `src/cloth/**`, `src/eval/**`.
3. All damping uses a constant `dt`; no `pow(k, dt)` with variable dt exists.
4. Constraint solve order is array index order. No `Map`/`Set` iteration inside the sim.
5. Rig accumulation is `f64`; cloth is `f32` but with a fixed operation order, so it is bit-reproducible on the same binary.

**Seek algorithm (`Engine.reachTick`):**

```
reachTick(N):
  if N === cur: return
  if N > cur and N - cur <= 8            -> step forward inline
  if N > cur and N - cur <= 60           -> step forward, budget-capped at 6 ms/frame, flag stale
  else                                   -> seek(N)

seek(N):
  cp = checkpoints.floor(N)              // stride 60 ticks = 0.25 s
  if cp:  restore(cp); replay(cp.tick -> N)          // <= 59 ticks
  else:   coldStart(N - 120); replay(120 ticks)       // 0.5 s warm-up
```

**Why the rig needs no checkpoints at all** — the numeric argument that makes this design cheap. Every rig spring channel in 04 §5.1 has `ζ ∈ [0.30, 0.55]` and `ω_n ∈ [22, 63] rad/s`; the slowest is COM/head-vertical at `ζω_n = 0.45 × 22 = 9.9 s⁻¹`. Over a 0.5 s warm-up an initial-condition error decays by `e^(−9.9 × 0.5) = 0.71 %`, applied to an amplitude of ≤ 0.004 H = 7 mm → residual error **≤ 50 µm**, i.e. 1/400 of the tightest metric tolerance. Thorax yaw (`ζ=0.30, ω_n=26`) decays to 2.0 % of a 4° amplitude = 0.08°. So `WARMUP_TICKS = 120` is provably sufficient and the rig is effectively memoryless past 0.5 s.

**Why cloth *does* need checkpoints:** the obi tails are `ζ = 0.18, ω_n = 5.4` → `ζω_n = 0.97 s⁻¹`; after 0.5 s an error is still 61 % of its initial value, after 1.8 s still 17 %. Cloth therefore carries real memory and must be restored, not warmed up.

**Checkpoint budget (exact):**

| item | size |
|---|---|
| cloth `x` + `v` (988 × 3 × 2 × f32) | 23.7 kB |
| wrinkle (9 000 × u8) | 9.0 kB |
| springs, feet, breath, rng, tick | 0.4 kB |
| **per checkpoint** | **≈ 33 kB** |
| 55 s kata at 0.25 s stride (220 checkpoints) | **7.3 MB** |
| LRU cap (mobile widens the stride to 0.5 s) | 4 MB |

**Seek cost (exact):** worst case 59 ticks × (rig 0.125 ms + cloth 0.275 ms) = **23.6 ms**. That exceeds one 60 Hz frame, so:

- during an **active scrub drag**, `ScrubPreview` runs L0–L10 only with springs frozen and cloth held at its skinned rest — 0.125 ms/tick, so any seek is < 8 ms and the drag stays at 60 fps;
- on **handle release**, the full re-sim runs, budget-capped at 6 ms per display frame across up to 4 frames (≤ 67 ms latency, imperceptible after a drag), and `composer.setStill(true)` only fires once `isSettled()` returns true;
- `checkpoints` are built lazily during ordinary playback, so a second pass over the same region is free.

**The load-bearing test.** `tools/verifyDeterminism.mjs`: for 200 random seek sequences per kata, assert `hashState(linearRun[N]) === hashState(seekedRun[N])` for every visited `N`. This single test protects the entire architecture; it runs in CI and in `npm run loop`.

### 4.5 Camera rig and transport

**Camera** (display clock, outside the sim):
`OrbitControls`, `enableDamping = true`, `dampingFactor = 0.05`, `minDistance 1.6`, `maxDistance 9.0`, `minPolarAngle 0.15`, `maxPolarAngle 1.52` (keeps the camera above the floor). Orbit target = a critically-damped follow (`τ = 0.35 s`) of pelvis XZ at `y = 0.55 H = 0.9625`. The follow matters: the embusen is 3.64 m × 3.64 m, so a fixed target loses the subject; a rigid follow feels glued. 0.35 s is the compromise.

**9 presets** (`src/camera/presets.ts`). The four ortho measurement cameras are frozen forever (07 §6.6) — every metric read off an image depends on them:

| id | type | position | notes |
|---|---|---|---|
| `CAM_FRONT` | ortho, height 2.2 H | `(0, 0.5H, +3H)` → −Z | measurement |
| `CAM_LEFT` | ortho | `(+3H, 0.5H, 0)` | measurement |
| `CAM_RIGHT` | ortho | `(−3H, 0.5H, 0)` | measurement |
| `CAM_TOP` | ortho, up = −Z | `(0, 4H, 0)` | measurement |
| `CAM_HERO` | persp, fov 39.6° (35 mm) | `(1.6H, 0.95H, 2.2H)` → `(0, 0.55H, 0)` | the default look |
| `CAM_LOW34` | persp, fov 35° | `(1.3H, 0.35H, 1.7H)` | the **weight camera** — a low 3/4 sells stance depth better than any other framing |
| `CAM_KIME` | persp, fov 50° | frames the acting effector at kime | close-up |
| `CAM_EMBUSEN` | ortho | top-down over the whole 4 L × 4 L box | teaching |
| `CAM_ORBIT` | persp | the user's live orbit | default interactive |

**Transport model.** `rate ∈ [0.25, 2.0]` scales how many ticks a display frame consumes: `desiredTick += rate · dtDisplay · 240`, with the fractional part held in an accumulator that is **not part of `SimState`** — it only chooses which integer tick to target. Consequence worth stating plainly: **slow-motion is not interpolation.** At rate 0.25 a 60 Hz display shows one distinct simulated tick per frame, so the 22-tick kime brake becomes 22 real frames of real dynamics. This is the payoff of paying for a 240 Hz solver.

Transport surface: play/pause, rate, `seek(tick|seconds)`, loop, `stepTick(±1)`, `stepMove(±1)`, `snapToPhase` (prep/tech/kime/hold boundaries), `tempoTier` (T0–T3 with `tempoScale` multiplying `T_prep` and `T_hold` **only** — never `T_tech`, `T_thrust`, `T_kime`; that is the JKA "contrast in speed" criterion made structural). Keyboard: space, `←/→` = 0.1 s, `,`/`.` = one tick, `[`/`]` = one move, `1–9` = camera preset.

**Timeline UI** renders the compiled decomposition directly: per-move ticks, shaded `T_prep`/`T_tech`/`T_kime`/`T_hold` bands, kiai markers at moves 8/16 (Taikyoku) and 9/17 (Heian), and the label track. All of it falls out of `KataTimeline` for free.

### 4.6 Frame loop (`src/app/engine.ts`)

```
onFrame(dtDisplay):
  1  transport.advance(dtDisplay)                  -> desiredTick, mode
  2  engine.reachTick(desiredTick)                 -> solveTick xN | seek | preview
  3  boneBridge.writePose(state.pose)              -> Bone.quaternion / pelvis.position
  4  skeleton.update()                             -> boneTexture upload
  5  clothBridge.upload(state.cloth, state.wrinkle)
  6  camera: orbit.update() or director.update(dtDisplay)
  7  shadowFit.refit(lightRig, fk)                 -> ortho box + light-space texel snap
  8  composer.setStill(!transport.playing && engine.isSettled())
  9  composer.render(dtDisplay)
```

Steps 3–9 are forbidden from writing `SimState`. That single rule is what keeps the scorecard honest: the numbers `src/eval` reads are the numbers the pixels came from.

**Frame budget at 60 fps (16.67 ms), from 06 §8 rescaled to 4 ticks/frame:**

| system | ms |
|---|---|
| 4 × rig solve (L0–L11) | 0.50 |
| 4 × 2 cloth substeps | 1.10 |
| bone + cloth upload | 0.25 |
| shadow refit | 0.05 |
| render (25 k tris, PBR + shadow + GTAO + bloom + SMAA + Output) | 8.00 |
| **total** | **9.90** — 6.8 ms headroom |

---

## 5. Render pipeline

### 5.1 Pass order (exact — hard constraints from doc 05 §8.4, not preference)

```
1  RenderPass(scene, camera)                          [playing]
1' TAARenderPass(scene, camera), accumulate = true    [paused / settled scrub]
2  GTAOPass(scene, camera, w, h, params, aoParams, pdParams)
3  BokehPass(scene, camera, {focus, aperture: 0.0018, maxblur: 0.006})   [cinematic only, off by default]
4  UnrealBloomPass(new Vector2(w, h), 0.22, 0.55, 0.92)
5  SMAAPass()
6  OutputPass()                                       [mandatory, last of the core chain]
7  LUTPass({ lut, intensity })                        [optional grade, off by default]
```

Why exactly this: `OutputPass` applies tone mapping + sRGB, so everything that must work on linear radiance precedes it (GTAO multiply, bloom threshold, SMAA which operates in linear-srgb). `FXAAPass` is **not used** — it requires sRGB input and would have to follow `OutputPass`; SMAA + TAA is strictly better and 05 §8.4 forbids shipping both. `maxblur` is always passed explicitly because `BokehPass`'s ctor default (1.0) and `BokehShader`'s default (0.01) differ by 100×.

Capture mode swaps pass 1 for `SSAARenderPass(sampleLevel = 2)` for the critic loop and `sampleLevel = 5` for final hero stills, sets `preserveDrawingBuffer = true`, and forces `pixelRatio = 2`. A silhouette variant renders with `scene.overrideMaterial = MeshBasicMaterial(white)`, no lights, no shadows, for metric 60.

### 5.2 Lighting rig — dojo

| light | type | position | intensity | colour | shadow |
|---|---|---|---|---|---|
| KEY | `DirectionalLight` | `(2.60, 4.20, 3.15)` = `(1.49H, 2.40H, 1.80H)` | **3.0** | `0xfff4e8` (~5200 K) | **yes** |
| RIM | `DirectionalLight` | `(−2.10, 2.80, −3.85)` | **1.4** | `0xdfe9ff` (~7000 K) | no |
| FILL | `DirectionalLight` | `(−2.98, 1.58, 2.28)` | **0.55** | `0xfff4e8` | no |
| IBL | PMREM from a procedural dojo scene | — | `environmentIntensity 0.85`, `environmentRotation (0, −0.35, 0)` | — | — |
| `AmbientLight` | — | — | **omitted** — flat ambient is the single cheapest-looking mistake available | — | — |

KEY elevation 45.8°, azimuth 39.5° off the character's front, `target.position = (0, 0.875, 0)` (hip height, not the floor), `scene.add(key.target)`. RIM/KEY = 0.47, FILL/KEY = 0.18. All values are post-r155 unitless irradiance — every pre-r155 tutorial number is π× too small.

IBL source (`src/render/dojoEnv.ts`, all `MeshBasicMaterial`/emissive so PMREM captures it): 14 × 7 × 14 `BackSide` shell at `0x2a2723`; a 6.0 × 1.6 m warm window band at `x = +6.9, y = 3.6` (`0xfff2e0`, emissive 6.0) matching the KEY direction; a 3.0 × 1.2 m cool band at `x = −6.9` (`0xdfe9ff`, emissive 2.2); a 10 × 10 ceiling bounce at `y = 6.9`; a 12 × 12 wood-albedo floor bounce at `y = 0.02` — that last one is what puts warm light under the jaw and inside the gi skirt. `pmrem.fromScene(env, 0.04, 0.1, 40, { size: 512, position: (0, 0.9625, 0) })`; keep the RT (`pmrem.dispose()` frees the generator, not the target). `scene.background = Color(0x0e0f12)` — **never** the PMREM; showing the crude procedural room is a tell.

### 5.3 Shadow strategy

`renderer.shadowMap.type = PCFShadowMap` set explicitly (`PCFSoftShadowMap` is deprecated and *mutates the field at first render*). One caster only.

| param | value | why |
|---|---|---|
| `mapSize` | 2048 × 2048 | quality/VRAM knee for one caster |
| frustum | **Mode B per-frame refit**, `S_fit = 0.75 H = 1.31 m` from an AABB over 24 bone world positions inflated by per-bone radius (~50× cheaper than `computeBoundingBox()`) | texel `t = 1.28 mm` |
| `radius` | 4.0 texels | PCF Vogel 5-tap × 2×2 hardware ≈ 20 effective taps ⇒ penumbra ≈ 10.2 mm — a true contact shadow |
| `normalBias` | 0.015 m | ≈ 12 × texel |
| `bias` | 0.0 | with normalBias set, constant bias peter-pans |
| `intensity` | 0.92 | leaves a little IBL fill in the core |
| `near`/`far` | 0.10 / 12.0 | tight for depth precision |
| texel snap | `pos = round(pos / t) * t` in light space | three.js does **not** do this; without it the shadow swims during orbit |
| floor | `receiveShadow = true`, `castShadow = false` | prevents floor-vs-floor acne |

Second layer: `GTAOPass` with `radius 0.30 m`, `samples 24`, `scale 1.15`, `blendIntensity 0.85`, `pdParameters.radius 6`, `setSceneClipBox(embusenAABB)`, `screenSpaceRadius = false`. This is the single biggest "AAA vs hobby" delta for this scene — PCF alone cannot make the crease where the gi skirt meets the thigh or the dark line where the trailing foot meets the floor.

Note the interaction that argues for TAA: r185 PCF applies a per-pixel IGN-rotated Vogel disk, so a *static* frame dithers. `TAARenderPass.accumulate` resolves it to a clean penumbra over 32 frames — which is exactly the paused/scrubbed state a 360 player spends most of its time in.

### 5.4 Material list (8 + 1 capture override) — one factory, no `onBeforeCompile` anywhere

| # | material | class | key parameters |
|---|---|---|---|
| 1 | **karate-gi** | `MeshPhysicalMaterial` | `color 0xF2F0EA`, `roughness 0.80`, `metalness 0`, `sheen 0.55`, `sheenRoughness 0.55`, `sheenColor 0xE8E4DA`, `specularIntensity 0.35`, `ior 1.47`, weave `normalMap` `normalScale (0.60,0.60)` + crease map `(1.00,1.00)`, `side DoubleSide` on skirt/sleeve/obi-tail and `FrontSide` on the closed torso shell |
| 2 | **skin** | `MeshPhysicalMaterial` | `roughness 0.48`, `sheen 0.15`, `sheenRoughness 0.85`, `ior 1.40`, `specularIntensity 0.6`, `normalScale (0.70,0.70)`. No SSS — the only shipped option is a Phong-based `ShaderMaterial` and mixing it into a PBR scene looks worse than not having it. |
| 3 | **floor (sealed wood)** | `MeshStandardMaterial` | `0x7d5636`, `roughness 0.42`, albedo `SRGBColorSpace` + roughness/normal `NoColorSpace`, 2048² `CanvasTexture`, `RepeatWrapping`, `anisotropy = min(8, getMaxAnisotropy())`, `receiveShadow`, `castShadow false` |
| 4 | **obi (black belt)** | `MeshPhysicalMaterial` | `0x14141a`, `roughness 0.62`, `sheen 0.25`, `DoubleSide`, its own crease map |
| 5 | **hair** | `MeshStandardMaterial` | `0x1b1714`, `roughness 0.55` — a shaped cap, no strands |
| 6 | **eye** | `MeshStandardMaterial` | sclera/iris `CanvasTexture`, `roughness 0.15`, `SRGBColorSpace` |
| 7 | **backdrop** | `MeshBasicMaterial` | vertical gradient `CanvasTexture`, `toneMapped true` |
| 8 | **embusen decal** | `MeshBasicMaterial` | transparent canvas, `depthWrite false`, `polygonOffset`, our own SVG-derived trace |
| — | silhouette override | `MeshBasicMaterial` | white, `toneMapped false`, capture mode only |

Global material rules: `scene.environment` is set and **every `material.envMap` stays `null`** (setting one silently overrides the scene env and disables `environmentIntensity`); `transmission = 0` everywhere (any nonzero value forces an entire extra scene render per frame); `anisotropy = 0` in v1 (it needs a `tangent` attribute and buys little at full-body framing — the procedural weave normal already carries the warp direction); `clearcoat = 0` everywhere.

Deliberately excluded and why: `SSRPass` (a low-roughness floor + IBL reads better and costs nothing), `CSM` (built for kilometre view distances; it also patches material shaders, killing WebGPU portability), `VSMShadowMap` (all receivers become casters ⇒ the floor self-shadows), `SubsurfaceScatteringShader` (Phong-based), `PCFSoftShadowMap` (deprecated, self-mutating).

---

## 6. The automated critic loop

### 6.1 The key decision: numbers come from a joint stream, pixels come from a small shot list

Rendering is expensive under SwiftShader; measuring is not. So they are decoupled:

- **Numeric channel** — one headless run per kata dumps the **full 240 Hz canonical-joint stream**: 13 200 ticks × 25 joints × 3 × f32 = **3.96 MB**, plus a per-tick diagnostics stream (IK residual, clamp saturation, plant slip, head Y). Every one of the 61 metrics, every fault predicate in 01 §9 / 03 §11, and every timing metric is computed from this. No pixels involved. ~5.3 s of wall clock per kata.
- **Pixel channel** — only the kime frames get rendered: 20 moves × 3 cameras + 21 × 3 = **123 PNGs** at 1024², SSAA level 2. These feed the VLM critic (Channel D), the Channel B overlay strips, and metric 60 (silhouette IoU). ~60 s per full pass.

Total `npm run loop` ≈ **2–3 minutes for both kata**. That is a usable agent iteration cycle; a design that renders 451 frames is not.

### 6.2 Commands (add to `package.json`)

```jsonc
"scripts": {
  "dev":        "vite --port 5178 --strictPort",
  "build":      "vite build",
  "preview":    "vite preview --port 5178 --strictPort",
  "typecheck":  "tsc --noEmit",
  "test":       "vitest run",
  "shots":      "node tools/capture.mjs",
  "score":      "node tools/score.mjs",
  "sheets":     "node tools/contactSheet.mjs",
  "critic":     "node tools/criticPrompt.mjs",
  "verify":     "node tools/verifyDeterminism.mjs",
  "own":        "node tools/verifyOwnership.mjs",
  "perf":       "node tools/perf.mjs",
  "loop":       "npm run typecheck && npm run test && npm run shots && npm run score && npm run sheets && npm run critic"
}
```

Concrete invocations:

```bash
# full loop for one kata at the default tempo
node tools/capture.mjs --kata heian-shodan --tempo T1 --stream 240 --shots kime \
     --cams front,left,hero --width 1024 --ssaa 2 --out captures/$SHA
node tools/score.mjs   --in captures/$SHA --out reports/$SHA
node tools/contactSheet.mjs --in captures/$SHA --score reports/$SHA/scorecard.json --out reports/$SHA
node tools/criticPrompt.mjs --score reports/$SHA/scorecard.json --out reports/$SHA --tier A,B

# tempo robustness (a design that only works at one tempo is fragile)
node tools/capture.mjs --kata heian-shodan --tempo T2 ... && node tools/score.mjs ...

# determinism (the load-bearing test)
node tools/verifyDeterminism.mjs --kata both --seeks 200

# single hero still at full quality
node tools/capture.mjs --kata heian-shodan --tick 3756 --cams hero,low34 --ssaa 5 --width 2048
```

### 6.3 How capture works, exactly

1. `tools/browser.mjs` launches Chromium with the flag set already proven by `tools/probe-webgl.mjs` (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`), then `page.goto('http://127.0.0.1:5178/?harness=1&kata=heian-shodan&tempo=T1&seed=1')` and awaits `window.__kata.ready`.
2. `?harness=1` makes `src/app/harness.impl.ts` install the frozen `HarnessApi`:

```ts
// src/core/types.harness.ts  (frozen in phase 0)
export interface HarnessApi {
  readonly ready: Promise<void>;
  readonly timeline: { totalTicks: number; kimeTicks: number[]; labels: string[] };
  seek(tick: number): Promise<void>;
  /** Seek, then run TAA/SSAA convergence and cloth settle to completion. */
  seekAndSettle(tick: number, camera: string): Promise<void>;
  setCamera(id: string): void;
  isSettled(): boolean;
  sampleJoints(): Float32Array;                 // 25*3, canonical order
  streamJoints(fromTick: number, toTick: number): ArrayBuffer;   // the 240 Hz dump
  streamDiagnostics(fromTick: number, toTick: number): ArrayBuffer;
  dumpScorecard(): Scorecard;                   // runs src/eval in-page
  renderSilhouette(): string;                   // dataURL of the mask
}
export const HARNESS_KEY = '__kata' as const;
```

Running `src/eval` **inside the page** is a deliberate choice: zero extra build steps, zero new dependencies, and a guarantee that the metrics see the exact state the pixels came from. `src/eval` stays GL-free so `tests/integration/pipeline.test.ts` can run the same code in Node under vitest.

3. Filenames carry everything a fix agent needs, so a complaint can be routed from the filename alone:

```
captures/<sha>/heian-shodan/
  joints.f32                 # 240 Hz canonical stream
  diagnostics.f32
  meta.json                  # sha, tempo, seed, tick->step map, camera params
  step-09_t15.650_kime_CAM_FRONT_migi-jodan-age-uke_zenkutsu.png
  step-09_t15.650_kime_CAM_LEFT_migi-jodan-age-uke_zenkutsu.png
  step-18_t33.850_kime_CAM_HERO_hidari-chudan-shuto-uke_kokutsu.png
  silhouette/step-09_CAM_FRONT.png
```

### 6.4 Scorecard output

`tools/score.mjs` writes:

```
reports/<sha>/
  scorecard.json        # the Scorecard type of §3.3, one entry per metric per step
  scorecard.md          # colour-coded table, worst steps first
  gates.json            # G-1..G-6 pass/fail  -> process exit code
  regression.json       # per-metric delta vs reports/latest; >5 pt regression fails CI
  perf.json
  critic-heian-shodan-A.md   # Tier-A findings, one section per step
  critic-heian-shodan-B.md
  contact-heian-shodan.png   # all steps, CAM_FRONT + CAM_LEFT
  strip/step-09_CAM_FRONT.png  # [ours | reference stick | overlay | abs-diff]
```

Gates (07 §6.3): G-1 `kataScore ≥ 85` · G-2 no fatal metric anywhere · G-3 `min(stepScore) ≥ 70` · G-4 `G1 ≥ 80 and G2 ≥ 80` on **every** step · G-5 Channel C `PCK@0.030H ≥ 0.85` on ≥ 6 annotated PD postures · G-6 zero Tier-A critic findings. Plus two additions this architecture needs: **G-7** `verifyDeterminism` mismatches = 0, and **G-8** `max(diag.ikResidualM)` at arrival ticks < 0.005 m.

### 6.5 Critic complaint → file, mechanically

Every `MetricSpec` carries a frozen `blame: string[]`, `ownerBlock`, and `knob`. `src/eval/fileMap.ts` adds the same for the fault IDs of 01 §9 and 03 §11. `tools/criticPrompt.mjs` emits, per failing step:

```md
### step 09 — migi jodan age-uke — zenkutsu-dachi — t = 15.650 s — tick 3756
images: strip/step-09_CAM_FRONT.png, step-09_t15.650_kime_CAM_LEFT_*.png

FATAL  hikite_present                false                      -> Tier A (A5)
FAIL   age_uke_forearm_angle_deg     62.4   ref 45   tol +-12   score 41   -> Tier B (F8)
FAIL   shoulder_elevation_H          0.021  ref 0.000 tol +-0.010 score 55 -> Tier B (B3, F3)
WARN   head_bob_H                    0.014  ref 0.000 tol +0.010 score 82  -> Tier B (B10)
diag   clampSaturation[upperarm_R] = 0.97  ikResidualM[armR] = 0.011 m

blame (open in this order):
  1  src/kata/techniques.ts      knob AGE_UKE.end / AGE_UKE.rollWindow      block C
  2  src/solve/armIk.ts          knob POLE.age-uke selection + hikite solve block B
  3  src/rig/clamp.ts            knob ROM.upperarm.abd (saturating at 0.97) block A
owner: block C first (data), then B, then A
```

**Fix-agent contract (this is what makes parallel agents safe):** an agent assigned a finding may edit **only files inside `ownerBlock`**. If the fix requires a file in another block it writes `reports/<sha>/handoff-<block>.md` instead of editing. `tools/verifyOwnership.mjs` enforces it at commit time.

Three routing shortcuts worth hard-coding into `BLAME_MAP`, because they account for most real failures:

| symptom | almost always | file |
|---|---|---|
| `ikResidualM > 0.005 m` at an arrival tick together with high `clampSaturation` | the authored target is outside human ROM → **data bug, not solver bug** | `src/kata/techniques.ts` |
| `foot_slide_Hps > 0` or `turn_pivot_foot_slip_H > 0.02` | plant FSM or pivot descriptor | `src/solve/legIk.ts`, then `src/kata/compile.ts` |
| `head_bob_H > 0.010` or `X3` yaw-linearity | the COM vertical clamp or the pelvis yaw window | `src/solve/com.ts`, `src/solve/pelvis.ts` |

---

## 7. Build order — 6 phases

| phase | blocks in parallel | deliverable | exit gate |
|---|---|---|---|
| **0 — Contracts** | **Block 0 alone (serial)** | the 12 frozen core files; `tests/integration/layering.test.ts` in place; the handedness unit test (`hidari gedan-barai fist world.x < 0`) written and passing against a stub | `npm run typecheck` green; contracts marked read-only |
| **1 — Skeleton, data, stage, loop** | **A** (rig + body mesh) · **C** (stances, techniques, dynamics, embusen, Taikyoku data, compiler) · **E** (renderer, IBL, lights, materials, dojo, composer — no character yet) · **H** (browser.mjs, shotlist, capture, sheet compositor — driven against a placeholder cube) | a lit dojo with a placeholder; `npm run shots` produces labelled PNGs on day 1 | A's chain-closure + COM tests green; C's 7 kata invariants green; a contact sheet exists |
| **2 — Motion** | **B** (full solver) · **E** (characterMeshes, boneBridge, shadowFit) · **G** (canonicalJoints, metrics, score, fileMap) · **F** (engine, transport, checkpoints — no UI) | **Taikyoku Shodan plays end to end** as a bare skinned figure; `npm run loop` produces a real scorecard | G-8 (`ikResidual < 0.005 m`) at every arrival tick; G1 group metrics real; determinism fuzzer green |
| **3 — Cloth, shell, comparison** | **D** (gi + XPBD + wrinkle) · **F** (camera presets, timeline UI, gui, labels, debug overlay) · **G** (Channel B reference figure + overlay SVG + silhouette IoU) · **H** (contactSheet, criticPrompt, verifyDeterminism, perf) | scrubbable player with a gi, orbit, presets, labels; 4-panel strips | cloth swatch test green (droop 7.5 ± 1.5 cm); `kataScore ≥ 70` on Taikyoku; seek p95 ≤ 6 ms in preview mode |
| **4 — Heian Shodan** | **C** (Heian data, kokutsu, shuto-uke, tettsui, D45/T135 tempo classes) · **B** (kokutsu solve, 270°/135° pivots, R0 retract-return of move 4) · **G** (Channel C: PD-1925 annotations + MPJPE/PCK) · **E** (weave, crease, floor textures; GTAO tuning) | both kata play at T1 and T2 | `kataScore ≥ 85` on Taikyoku; `G1 ≥ 80 & G2 ≥ 80` every step on both; G-5 PCK ≥ 0.85 |
| **5 — Critic-driven polish** | **all blocks, in fix mode**, each taking only findings routed to its `ownerBlock`. Plus **F** camera director + cinematic mode; **E** bokeh/LUT + capture-quality path; **D** obi tails + hysteresis tuning; **A** shoulder/armpit and knee-fold weight passes | zero Tier-A findings on both kata at T1 **and** T2 | **all of G-1…G-8 pass on both kata at two tempi** |
| **6 — Hardening** | **F** + **E** + **H** primarily; A–D only for perf | perf to budget, dispose paths, mobile checkpoint-stride fallback, keyboard a11y, `npm run build` size, README + `PROVENANCE.md` | mean frame ≤ 12 ms and p95 tick ≤ 0.6 ms on the reference machine; no console warnings; no leaks across 20 kata↔camera switches |

Two ordering choices worth defending. **The critic loop is built in phase 1, against a cube** — a loop that works on a placeholder is worth more than a character with no loop, because from phase 2 onward every agent has a numeric target instead of an opinion. And **Taikyoku Shodan is finished before Heian Shodan is started**: Taikyoku uses only two techniques and one stance (02 §4), so it exercises the entire pipeline — compile, solve, IK, plant, turn, capture, score — at a quarter of the authoring cost. It is the smoke-test kata by design.

---

## 8. Top 8 risks

| # | risk | why it is real | mitigation, with numbers |
|---|---|---|---|
| **R1** | **The solver misses the authored kime pose.** Dynamically shaped motion plus a hard target leaves residual endpoint error; a punch that stops 2 cm short of full extension fails metrics 20/21 and looks weak. | This is the intrinsic cost of the "poses emerge" bias. | The `T_kime` window is **position-authoritative**: effector weight ramps 0→1 over `T_thrust` with `kimeEase(·,0.60)`, is exactly 1 at `arrivalTick`, and the ROM clamp becomes report-only for the acting arm. Recoil springs apply *after* the target, as an offset from it. Gate G-8: `ikResidualM < 0.005 m` (0.003 H) at every arrival tick, asserted in `src/solve/*.test.ts` and in CI. |
| **R2** | **Seek cost breaks interactivity.** Worst-case re-sim is 59 ticks × 0.40 ms = **23.6 ms** — more than a 60 Hz frame. | A 360 player is *mostly* scrubbed and paused. | Three-tier seek: ≤8 ticks inline; ≤60 ticks budget-capped at 6 ms/frame; else checkpoint restore. During an active drag, `ScrubPreview` runs L0–L10 only (springs frozen, cloth at skinned rest) at **0.125 ms/tick** → any seek < 8 ms. Full re-sim runs on release across ≤4 frames (≤67 ms). Checkpoints build lazily during playback, so re-scrubbing a region is free. |
| **R3** | **Determinism breaks silently** — one `Math.random` for a blink, one `performance.now` in a damping term, one `Map` iteration in the constraint loop, and scrub ≠ playback. | Nothing about this fails loudly; it shows up as a scorecard that disagrees with the pixels. | `tools/verifyDeterminism.mjs` (200 random seek sequences, `hashState` equality) is gate **G-7**, run in `npm run loop`. `tests/integration/layering.test.ts` greps `Math.random\|Date.now\|performance.now\|new Date` under `src/solve\|src/cloth\|src/eval` and fails the build. All randomness goes through the checkpointed `src/core/rng.ts`. |
| **R4** | **Candy-wrapper collapse on the 180° forearm roll** — the hikite→tsuki pronation is exactly LBS's worst case, and it happens on the *bare* forearm where nothing hides it. | 06 §5.4: 180° across one blend band = **100 % radius loss**. | 2 forearm twist bones at 33 %/67 % (60° per band = 13 % loss) plus the §5.3-step-7 rigidify so each band spans ≤30° → **3.4 % loss, invisible**. New G5 tripwire `forearm_radius_retention`: CPU-skin 8 ring vertices at the roll extreme, assert radius ≥ 0.96 of bind. |
| **R5** | **Cloth tunnelling or explosion at kime.** Peak hand speed 8–11 m/s; the gi is pinned to a limb that decelerates at 200–260 m/s². | The one place a physics-forward design can produce a garbage frame. | `n_sub = 8` (2 substeps × 4 ticks) → 2.3 cm per substep vs a 4.9 cm forearm capsule (47 %); velocity clamp 12 m/s; per-substep displacement cap `0.30·r`; NaN guard resets a particle to its skinned rest; teleport detector re-initializes a garment at `\|Δp_pin\| > 0.05 H`. Structural guard: **cloth never writes back into the pose**, so a blow-up cannot corrupt the scorecard or the rig. |
| **R6** | **Global left/right mirror.** Doc 07 §0.1 proves the mandated frame (`+Y` up, `−Z` forward, `+X` left) is **left-handed**, so a naive right-handed reading makes `+X` the character's *right* and the whole kata mirrors. | Half the techniques and the entire embusen would be wrong, and it would still "look like karate". | Exactly one conversion, in `src/core/frame.ts` (`SIDE_SIGN`), frozen in phase 0. A phase-0 unit test asserts `hidari gedan-barai` puts the acting fist at `world.x < 0`. Metric 41 (`facing_yaw_err_deg`) and 42 (`embusen_pos_err_H`) catch any regression. Nothing else in the codebase may negate an X. |
| **R7** | **Tempo is disputed and the per-move split is invented.** 40 s (JKA official) vs 23–34 s (measured senior instructors); doc 02 uncertainty 8 states the `t_hold/t_prep/t_transit/t_kime` split is entirely `[DERIVED]`. | Tune the look at one tempo and it can fall apart at another — and a kata expert *will* watch it at performance tempo. | Ship **T1 (1.905 s/count)** as default with `tempoScale` multiplying `T_prep` and `T_hold` **only** — never `T_tech`, `T_thrust`, `T_kime`. Expose T0–T3. The gates must pass at **T1 and T2** (phase 5 exit), which structurally prevents tempo-specific hacks. |
| **R8** | **Parallel-agent file collisions and interface drift.** Nine agents, ~110 files, one shared pose layout. | The most likely way this project stalls is a merge conflict in `types.solver.ts`, not a bad shadow. | Phase-0 frozen contracts with explicit `hard`/`additive` labels. `three` importable only under `src/render\|src/camera\|src/app`. Colocated tests so no block needs another block's test file. `tools/verifyOwnership.mjs` fails any commit spanning blocks. Findings carry `ownerBlock`; cross-block fixes become `handoff-<block>.md`, never an edit. |

### What will most likely make this look cheap or wrong

**One thing above all: a bobbing head and a linearly-ramping hip.**

Doc 04 §7.3 and doc 01 §8.1 converge on it, and Cazeau 2021 gives the mechanical reason: normal walking exchanges potential and kinetic energy through a 5.3–7.9 cm vertical COM oscillation, and zenkutsu-dachi stepping deliberately **suppresses** that exchange — which is why it costs more energy than walking. So an animation that lets the head rise is not "slightly off"; it is animating *walking*. Doc 01's table is unambiguous: 2.0 cm peak-to-peak is acceptable, 3.5 cm is "a critic will see it", **6.0 cm reads as a person walking in costume**. Paired with it: doc 01 §9.5 X3 — if pelvis yaw ramps linearly across the step instead of holding to τ = 0.55 and then snapping, the result reads robotic no matter how good the mesh is. Together these two are *the* signature of cheap karate animation, and both are solver bugs, not art bugs.

**Countermeasure — make it structurally impossible rather than a review item:**

1. **Clamp at the source.** `src/solve/com.ts` clamps pelvis vertical to `0.410 H ± 0.008 H` for every fighting stance, with the only permitted excursions being the authored −0.006 H drive sink at τ∈[0.15,0.30] and the 0.006–0.014 H landing sink. The clamp is in the solver, not in the data, so no authoring mistake can defeat it.
2. **Make linear yaw unrepresentable.** Pelvis yaw is not a curve the data supplies; it is generated as `hold(ψ_start) until τ=0.55, then ψ_start + Δψ·(1−(1−u)³)`. There is no code path that produces a straight ramp.
3. **Measure it every tick, not every review.** `diag.headYMin/Max` rolls over the current move; metric 17 (`head_bob_H`, fail at +0.010 H, hard-fail at +0.030 H) and the X3 predicate (`\|ψ(0.5) − ψ_start\| > 8°`) are both **fatal-class**, so gate G-2 fails the build outright. No human has to notice.
4. **Frame it where it shows.** `CAM_LOW34` is in the preset list and in the shot list specifically because a low 3/4 angle exposes both head bob and stance depth better than the hero camera does.

Runners-up, each already wired to a metric so they cannot survive a loop: missing hikite (A5 / metric 28, fatal) · smooth deceleration instead of a kime snap (A4 / metrics 47, 50, 52) · a rigid gi (B8, and doc 06 §7.10 rule 6 — folds must be **6–9 cm**, not the 2 cm that generic cloth settings produce, which instantly reads as jersey) · no contact shadow (B14 / metric 61) · a lifted rear heel in zenkutsu (A7 / metric 10, and 01 §3.5 shows it is *geometrically unavoidable* once `S > 0.58 H`, so the fix is the stance length, not the ankle) · perfect bilateral symmetry (C13 — countered by a seeded ±1.5 % asymmetry in limb radii and a 0.6° resting pelvis roll offset, both drawn once from the checkpointed RNG).
