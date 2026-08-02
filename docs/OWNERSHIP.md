# OWNERSHIP — who may write which file

**Status: FINAL.** Companion to `docs/ARCHITECTURE.md`. Section references (§) point there.

## The three rules

1. **A file has exactly one owner.** Nobody else may create, modify, move or delete it. There are no
   shared files below the orchestrator level. `tools/verifyOwnership.mjs` maps every changed path to a
   block and **fails any commit that spans blocks** (an integrator commit is exempt only when it
   carries the literal marker `[integrator]` in its subject line).
2. **A fix that needs another block's file is a handoff, never an edit.** Write
   `reports/<sha>/handoff-<block>.md` naming the file, the symbol, the finding id and the requested
   change. The owning agent applies it.
3. **Cross-block reads go through the barrel.** `import { X } from '../data'` is legal;
   `import { X } from '../data/constants/stances'` is not. Enforced by
   `tests/contracts/imports.test.ts`.

## Summary

| block | owner-agent label | root paths it owns | files | frozen-interface deps | phases active |
|---|---|---|---|---|---|
| **B0 CONTRACTS** | `agent/contracts` | `src/contracts/**`, `tests/contracts/**` | 19 | — (it *is* the contract) | P0 only; then read-only |
| **B1 NUMBERS** | `agent/numbers` | `src/data/num.ts`, `src/data/constants/**`, `src/data/embusen.ts`, `src/data/index.ts`, `tests/data/**` | 16 | `units`, `num`, `kata`, `bones`, `rig`, `services` (types only) | P1, P3, P4, P5 |
| **B2 KATA** | `agent/kata` | `src/data/kata/**`, `src/data/patches/**`, `tests/kata/**` | 50 | `kata`, `units`; barrel `src/data` | P1 (skeleton), P2, P4, P5 |
| **B3 SOLVER** | `agent/solver` | `src/solve/**`, `tests/solve/**` | 28 | `units`, `time`, `ease`, `bones`, `kata`, `pose`, `rig`; barrels `src/data` | P2, P3, P5 |
| **B4 RIG** | `agent/rig` | `src/rig/**`, `tests/rig/**` | 15 | `units`, `bones`, `rig`; barrel `src/data` | P1, P4, P5 |
| **B5 RENDER** | `agent/render` | `src/render/**`, `tests/render/**` | 16 | `units`, `rig`, `services`; barrels `src/data`, `src/rig`, `src/cloth` | P1, P4, P5, P6 |
| **B6 PLAYER** | `agent/player` | `src/player/**`, `src/main.ts`, `index.html`, `tests/player/**` | 14 | all of `src/contracts/**`; every barrel | P2, P4, P5, P6 |
| **B7 CLOTH** | `agent/cloth` | `src/cloth/**`, `tests/cloth/**` | 15 | `units`, `time`, `pose`, `rig`, `services`; barrel `src/data` | P3, P4, P5 |
| **B8 UI** | `agent/ui` | `src/ui/**`, `tests/ui/**` | 9 | `units`, `kata`, `pose`, `services`; barrels `src/player`, `src/data` | P4, P5, P6 |
| **B9 CRITIC** | `agent/critic` | `src/eval/**`, `data/reference/**`, `assets/reference/**`, `tools/**`, `tests/eval/**`, `tests/integration/**`, `tests/e2e/**` | 49 | `units`, `time`, `ease`, `bones`, `kata`, `pose`, `rig`, `scorecard`, `services`; barrels `src/data`, `src/solve` | P1, P2, P3, P5, P6 |
| **ORCHESTRATOR** | `agent/integrator` | `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `docs/**` | 11 | — | every phase |

Total: 231 owned files, zero overlaps. `tools/verifyOwnership.mjs` asserts that the union of the
owned path sets equals the tracked tree and that the pairwise intersections are all empty.

---

## B0 — CONTRACTS · `agent/contracts`

### Files it may create or modify (nobody else may touch them)

```
src/contracts/units.ts        src/contracts/time.ts         src/contracts/ease.ts
src/contracts/bones.ts        src/contracts/num.ts          src/contracts/kata.ts
src/contracts/pose.ts         src/contracts/rig.ts          src/contracts/scorecard.ts
src/contracts/services.ts     src/contracts/index.ts
tests/contracts/imports.test.ts      tests/contracts/freeze.test.ts
tests/contracts/bones.test.ts        tests/contracts/handedness.test.ts
tests/contracts/bake-error.test.ts   tests/contracts/tickrate.test.ts
tests/contracts/seek-purity.test.ts  tests/contracts/ease.test.ts
```

### Dependencies on frozen interfaces
None. This block authors them. It may import nothing outside `src/contracts/**` — asserted by
`tests/contracts/imports.test.ts`, which also proves `ease.ts` and `time.ts` are dependency-free (they
are shared by the compiler *and* the metrics module, so a hidden import would couple the two).

### Definition of done
All 11 files exist and match §3.1–§3.13 field for field, including every unit suffix and every
coordinate comment. All eight resolved conflicts of §2.5 are written into the files as constants and
comments. `BONE_ORDER` is complete and ordered parents-before-children. The six red-first tests exist
and **fail for the right reason** — they reference symbols that do not exist yet, not symbols that are
misspelled. `docs/CONTRACT-CHANGELOG.md` has its first entry (the freeze hash).

### Verification
Numeric: `npm run typecheck` clean · `node tools/verify-contracts.mjs` prints the freeze hash ·
`tests/contracts/bones.test.ts` green (`BONE_COUNT === 52`, parents precede children, every `_L` has an
`_R`, the six doc 06 §4.2 chain-closure lengths to 1e-6 H) · `tests/contracts/ease.test.ts` green
(`S(0)=0`, `S(1)=1`, `S'(0)=S'(1)=0`, `S(0.5) < 0.30` at `tauP = 0.73`,
`kimeEaseAcc === numeric d²S/dτ²` to 1e-6).

> **"GREEN" IS PER-ASSERTION HERE (adjudicated in the Phase-0 audit).** Every assertion named above is
> green at the Phase-0 gate (`bones` 23/24, `ease` 22/23). Each file retains **exactly one** red
> cross-block assertion, which is deliberate and must not be deleted or stubbed to make the file green:
> `bones` checks the **built** rig's bone order equals `BONE_ORDER` (needs B4+B5, so it goes green at the
> Phase-1 gate), and `ease` checks `channelAlpha/Vel/Acc` are bit-identical to `kimeEase/Vel/Acc` (needs
> B3, Phase 3) — which is the entire reason §3.3 puts the easing in a frozen file. §4.0, §8 and the
> Phase-0 task all specify RED-FIRST; that reading governs.
Visual: none. This block ships no pixels.

**After Phase 0 this block is closed.** A change requires an `[integrator]` commit plus a
`docs/CONTRACT-CHANGELOG.md` entry, and every agent stops until it lands.

---

## B1 — NUMBERS · `agent/numbers`

### Files it may create or modify

```
src/data/num.ts
src/data/constants/anthro.ts       src/data/constants/stances.ts
src/data/constants/techniques.ts   src/data/constants/dynamics.ts
src/data/constants/rom.ts          src/data/constants/cloth.ts
src/data/constants/render.ts       src/data/constants/camera.ts
src/data/constants/DISPUTED.md
src/data/embusen.ts                src/data/index.ts
tests/data/constants.test.ts       tests/data/derived.test.ts
tests/data/embusen.test.ts         tests/data/proportions.test.ts
```

> `src/data/kata/**` and `src/data/patches/**` belong to **B2**. `src/data/index.ts` belongs to B1 and
> re-exports B2's barrel; B2 never edits it.

### Dependencies on frozen interfaces
`units` (`H`, **`sideSign(h)`** — *not* `SIDE_SIGN`: `tools/verify-contracts.mjs` bans that symbol
outside three allowlisted files, and B1 no longer needs it since C16 ships the resolved world-frame
camera constants `M_*_POS_H`; corrected in the Phase-0 audit), `FracH`/`Deg`/`Sec` brands, `hToM`),
`num` (`Num`, `AltNum`, `N`, `flat`),
`kata` (`StanceSpec`, `TechniqueSpec`, `TechniqueDynamics`, `ChannelDyn`, `RomLimit`, `StanceId`,
`TechniqueId`, `TempoClass`, `PauseClass`, `PivotRule`, `EmbXZ`), `bones` (`BoneName` for `LIMB_R` and
`HAND_SHAPE_ANGLES`), `rig` (`GarmentPartId`), `services` (`CameraPresetId`).

### Definition of done
Every number in docs 01 §10, 03 §4–§14, 04 §5/§6/§10/§11, 06 §1–§3/§7 and 05 §5–§11 that the project
uses exists as a `Num` with a **greppable** `src` anchor and a `conf` class.

> **ROM EXEMPTION (adjudicated in the Phase-0 audit).** `RomLimit` (§3.8) declares four bare `…Deg`
> fields, so the ~208 range-of-motion values cannot individually be `Num`s without breaking the frozen
> interface. **The frozen shape wins.** `RomLimit` values stay bare `…Deg` numbers — legal under the
> §2.2 unit rule, which the `Deg` suffix already satisfies — and instead: (a) every ROM *group* carries
> one doc-cited `src` comment naming the doc 06 §3.1 row it came from, and (b)
> `tools/verify-constants.mjs` validates the ROM table **as a block** against doc 06 §3.1 rather than
> value-by-value. Author each cone semi-axis as the **smaller** of doc 06 §3.1's two signed limits;
> asymmetric limits that a cone cannot represent are gated separately in `src/solve/swingTwist.ts`
> (B3's named hip/shoulder sign gate), not smuggled into `RomLimit`. `L_H`, `EMB_H_H`,
`ZENKUTSU_HEEL_TO_HEEL_H` and `PELVIS_AHEAD_OF_C_H` are **derived**, never authored (§2.3). All 14
disputes are `AltNum`s with a `disputeId`, and `DISPUTED.md` states both readings, the shipped pick and
the argument for each. `footPlanFor` implements R0–R5 including the `footExcursion` path.

### Verification
Numeric: `node tools/verify-constants.mjs` clean — it greps the cited markdown section for the literal
value and fails on drift · `tests/data/derived.test.ts` (`L_H === ZENKUTSU.S.v`;
`EMB_H_H === HACHIJI.W.v/2`; `ZENKUTSU_HEEL_TO_HEEL_H === 0.533 ± 5e-4` by the §2.3 formula;
`PELVIS_AHEAD_OF_C_H` per stance) · `tests/data/embusen.test.ts` (the 7 invariants of 02 §11,
σ-symmetry `σ(x,z) = (−0.38−x, −4.00−z)`, closure residual < 0.01 L, every `c` inside the 4 L × 4 L
box) · `tests/data/proportions.test.ts` (head 0.130 H ⇒ 7.7 heads, the doc 07 §4 anti-heroic gate) ·
`docs/research/_verify_01_stances.py` re-run in CI.
Visual: `reports/<sha>/floor-trace.png` — the reference embusen polyline. A wrong `L` or `EMB_H` is
visible as a scale or offset mismatch in one image.

---

## B2 — KATA · `agent/kata`

### Files it may create or modify

```
src/data/kata/taikyoku-shodan.kata.ts   src/data/kata/heian-shodan.kata.ts
src/data/kata/ceremony.ts               src/data/kata/validate.ts
src/data/kata/index.ts
src/data/patches/index.ts
src/data/patches/taikyoku-shodan/move-01.ts … move-20.ts        (20 files)
src/data/patches/heian-shodan/move-01.ts … move-21.ts           (21 files)
tests/kata/taikyoku.test.ts   tests/kata/heian.test.ts   tests/kata/patches.test.ts
```

### Dependencies on frozen interfaces
`kata` (`KataScore`, `KataMove`, `CeremonyPhase`, `TechniqueRef`, `MovePatch`, `MoveOverride`,
`PatchKey`, every string union), `units` (`Handedness`). Reads the `src/data` barrel for
`STANCES`/`TECHNIQUES` when asserting `targetH` consistency. Never imports `src/solve/**`.

### Definition of done
All 41 moves transcribed row-for-row from doc 02 §4.1 / §6.1 with `src` naming the exact table row;
both ceremonies from 02 §2; both embusen coordinate sets from 02 §4.2 / §6.2 **as AJC positions**
(§2.3). `validateKata` implements the 7 invariants of 02 §11 and throws with the failing invariant's
name. All 41 patch files exist and default-export a `MovePatch`; `patches/index.ts` contains all 41
imports and is **written once, in Phase 1, and never edited again** — that is what makes two agents
fixing two different moves collision-free.

### Definition of done, per-move-fix mode (Phase 5)
A routed finding scoped to one step results in an edit to exactly one file,
`src/data/patches/<kata>/move-NN.ts`, with a non-empty `reason` and the finding id in `finding`.

### Verification
Numeric: `tests/kata/taikyoku.test.ts` (heading chain from `dHeadingDeg` reproduces every
`headingDeg`; `ff` recomputed as `pivot + Lk·f(H)` matches the authored `ff` to 1e-9 L; kiai at
`[8, 16]`; fast pairs `[[7,8],[15,16]]`; Σ `tSlotS` = 35.25 ± 20 %) ·
`tests/kata/heian.test.ts` (same, plus the 45°/315° diagonals, kiai at `[9, 17]`, kokutsu on 18–21,
move 4 the only `R0`, Σ `tSlotS` = 39.75 ± 20 %) · `tests/kata/patches.test.ts` (41 modules exist,
shape-valid, non-empty patch ⇒ non-empty reason).
Visual: `contact-sheet.png` labels come from `KataMove.label/labelJp/labelEn` — a wrong technique or
side is legible in the label under the thumbnail before any joint is measured.

---

## B3 — SOLVER · `agent/solver`

### Files it may create or modify

```
src/solve/frame.ts        src/solve/skeleton.ts    src/solve/twoBoneIK.ts
src/solve/swingTwist.ts   src/solve/stance.ts      src/solve/arm.ts
src/solve/hand.ts         src/solve/com.ts         src/solve/spine.ts
src/solve/gaze.ts         src/solve/footPlant.ts   src/solve/timeline.ts
src/solve/keyposes.ts     src/solve/channels.ts    src/solve/bake.ts
src/solve/layers.ts       src/solve/impulses.ts    src/solve/diagnostics.ts
src/solve/stageAssert.ts  src/solve/compile.ts     src/solve/hash.ts
src/solve/index.ts
tests/solve/stances.test.ts  tests/solve/kokutsu.test.ts  tests/solve/ik.test.ts
tests/solve/plant.test.ts    tests/solve/bake.test.ts     tests/solve/stages.test.ts
tests/solve/repeat.test.ts
```

### Dependencies on frozen interfaces
`units`, `time` (`TICK_HZ`, `POSE_LADDER`, `ticksPerFrame`, `BAKE_MAX_ERR_DEG`, `BAKE_MAX_STEP_DEG`),
`ease` (**the only easing source — this block may not define an easing function**), `bones`, `kata`,
`pose` (`PoseKey`, `PoseTrack`, `PoseSegment`, `LayerTrack`, `ImpulseEvent`, `TrackMark`, `PlantSpan`,
`SolveDiagnostics`, `BakeStats`, `CHANNELS`), `rig` (`CANONICAL_FROM_BONE` for diagnostics). Barrels:
`src/data` only. **May import only `Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3` from `three`.**

### Definition of done
`compileKata` runs the 16 stages of §4.11, each individually maskable, each followed by its named exit
invariant. `src/solve/frame.ts` is the **only** file in the project that negates an X or a yaw. The
bake produces piecewise-uniform segments on the 120/240/480/960 ladder satisfying G-9a and G-9b. The
five delta layers are constructed by inversion so composition at `w = 1` reproduces the compiled pose
to < 1e-4°, and S14 checks the composed chest yaw at the corners of the whole legal weight box.
`src/solve/impulses.ts` emits exactly one `limb-stop` event per acting limb per move with an exact
`crackDelayTicks`. `chan.accelL/accelR/pelvisYawRate` are computed from `kimeEaseAcc`/`holdThenSnap′`,
**never** by differencing a baked pose. `compileKata` is ≤ 220 ms per kata and imports no browser API.

### Verification
Numeric: `tests/solve/stances.test.ts` reproduces **every** 01 §10 constant from the solve — including
`kneeFront 57 ± 1`, `kneeRear 10`, knee-X `+0.005`, `hipZbehindFrontAnkle 0.221`,
`hipZaheadOfRearAnkle 0.319` — plus `|COM_y/H − 0.568| < 0.008` ·
`tests/solve/kokutsu.test.ts` reproduces 01 §4.3's impossibility result ·
`tests/solve/ik.test.ts` (`|C′ − T| < 1e-9` in range; every 03 §13.1 law-of-cosines row to ±1.0°) ·
`tests/solve/plant.test.ts` (plant residual < 0.002 L across every pivot in both kata) ·
`tests/solve/bake.test.ts` (**G-9a `maxSlerpErrDeg < 0.25`, G-9b `maxStepDeg ≤ 12`, G-9c**; recompose
error < 1e-4°) · `tests/solve/stages.test.ts` (stage N's output admissible as stage N+1's input) ·
`tests/solve/repeat.test.ts` (two compiles → byte-identical `q`, `rootPos`, `chan`, `hash`) ·
`tests/contracts/bake-error.test.ts` and `tickrate.test.ts` flip green here · **G-8**
(`max ikResidualM < 0.005 m` at every arrival tick) · `reports/<sha>/bake.json`.
Visual: `strip/step-NN_M_LEFT.png` — a timing error shows as a spatial offset against the Channel-B
reference at the same tick, which is what a VLM critic can actually see.

---

## B4 — RIG · `agent/rig`

### Files it may create or modify

```
src/rig/bones.ts       src/rig/bodyMesh.ts   src/rig/skinWeights.ts
src/rig/giMesh.ts      src/rig/tangents.ts   src/rig/textures.ts
src/rig/karateka.ts    src/rig/landmarks.ts  src/rig/capsules.ts
src/rig/index.ts
tests/rig/closure.test.ts   tests/rig/weights.test.ts   tests/rig/scale.test.ts
tests/rig/tangents.test.ts  tests/rig/candywrapper.test.ts
```

### Dependencies on frozen interfaces
`units`, `bones` (`BONE_ORDER` **is** the `skinIndex` order — this block may not reorder it),
`rig` (`RigHandles`, `Landmarks`, `CANONICAL_JOINTS`, `CANONICAL_FROM_BONE`, `Capsule`, `CAPSULES`,
`GiPinRing`, `GarmentPartId`). Barrel: `src/data` (`ANTHRO`, `JOINT_Y`, `LIMB_R`, `GARMENTS`).
May import `three` freely. Consumes `MaterialSet` from the `src/render` barrel.

### Definition of done
A 52-entry `Bone` tree built in T-pose and rebaked to an A-pose bind per doc 06 §4.1 G1–G5. Body geometry ≈ 3.9 k verts by swept rings with 4 loops at every flexing joint. Skin weights
follow the seven steps of doc 06 §5.3 exactly, including rigidify at `1.8·r`. `ribcage` carries the
ribcage/upper-abdomen weights and is childless. Gi geometry emits analytic UVs at 147 × 131 repeats/m,
`GiPinRing[]`, and an **itemSize-4** tangent with a real handedness `w`. All textures are
`CanvasTexture`/`DataTexture` — nothing fetched. `sampleLandmarks` fills the 25 canonical joints plus
the virtual `*FistCenter` at `0.030 H` beyond the wrist along the hand axis.

### Verification
Numeric: `tests/rig/closure.test.ts` (bind-pose chain closure; `bone_length_drift_pct === 0` at bind) ·
`tests/rig/weights.test.ts` (Σ = 1 ± 1e-4; no vertex with 5 influences; no `ribcage` weight outside the
torso band) · `tests/rig/scale.test.ts` (`ribcage` has no children; **no other bone ever scales**, bit-
exactly, at every tick of both kata) · `tests/rig/tangents.test.ts` (`itemSize === 4`, `|w| === 1`,
`|T| = 1 ± 1e-5`, `|T·N| < 1e-4`, `anisotropy > 0 ⇒ tangent exists`) ·
`tests/rig/candywrapper.test.ts` (CPU-skin a mid-forearm ring at the 180° roll extreme; metric 62
`forearm_radius_retention ≥ 0.97`).
Visual: `DETAIL_HANDS` at every zuki kime — candy-wrapper and the armpit/deltoid collapse zone are
only judgeable at that framing. `M_TOP` at every kime for left/right mesh asymmetry.

---

## B5 — RENDER · `agent/render`

### Files it may create or modify

```
src/render/renderer.ts   src/render/dojoEnv.ts    src/render/ibl.ts
src/render/lights.ts     src/render/shadow.ts     src/render/materials.ts
src/render/stage.ts      src/render/post.ts       src/render/still.ts
src/render/silhouette.ts src/render/clothBridge.ts src/render/overlay.ts
src/render/index.ts
tests/render/config.test.ts   tests/render/bans.test.ts   tests/render/still.test.ts
```

### Dependencies on frozen interfaces
`units`, `rig` (`RigHandles`, `GarmentPartId`), `services` (`PostStack`, `ClothSystem`,
`CameraPresetId`). Barrels: `src/data` (`LIGHTS`, `SHADOW`, `POST`, `MATERIAL_PARAMS`, `ENV`),
`src/rig`, `src/cloth`. May import `three` freely.

### Definition of done
Boot order exactly §5.1. Pass chain exactly §5.2 — `RenderPass` always, **no `TAARenderPass`, no
`SSAARenderPass`, no `FXAAPass`**. `StillAccumulator` owns the Halton(2,3) view-offset jitter so
GTAO's internal G-buffer render is jittered in lockstep (§5.3). Four world-fixed lights per §5.4;
nothing follows the camera. Shadow Mode B with light-space texel snap per §5.5. Ten materials per
§5.6, `side: FrontSide` everywhere, **zero `onBeforeCompile`**, zero `ShaderMaterial` in the scene
graph, zero `material.envMap`, `transmission = 0`, `clearcoat = 0`. 12 opaque draw calls.

### Verification
Numeric: `tests/render/config.test.ts` (GL-free: the pass-order array literal; every
`MATERIAL_PARAMS` field lands on the correct material property with the correct colour space; no
`envMap` assigned anywhere) · `tests/render/bans.test.ts` (greps `src/` for `onBeforeCompile`,
`material.envMap`, `PCFSoftShadowMap`, `new Clock(`, `FXAAPass`, `TAARenderPass`, `SSAARenderPass`,
`DoubleSide`) · `tests/render/still.test.ts` (sample `k` is a pure function of `k`; the 32 offsets sum
to `(0,0)` within 1e-9) · metric 61 `contact_shadow_present` · `npm run bench` p95 ≤ 16.0 ms at
1600 × 900 DPR 1.5 · `perf.json` draw calls = 12.
Visual: **this block is judged visually and only visually beyond the tripwires.**
`contact-sheet.png` at `--profile hero` for value separation and the floor contact crease; `LOW34` and
`M_TOP` for silhouette readability at low and overhead angles; the Channel-D Tier-C rubric items C8
(flat lighting), C9 (mushy shadow), C12 (no sheen variation). Every judgement is made through
`src/ui/look.ts` sliders first and only then written back to `src/data/constants/render.ts` **by
handoff to B1** — B5 never edits a constant file.

---

## B6 — PLAYER · `agent/player`

### Files it may create or modify

```
index.html                   src/main.ts
src/player/transport.ts      src/player/sampler.ts      src/player/poseApply.ts
src/player/layerWeights.ts   src/player/pokeLayer.ts    src/player/cameraRig.ts
src/player/loop.ts           src/player/app.ts          src/player/harness.ts
src/player/index.ts
tests/player/transport.test.ts  tests/player/sampler.test.ts  tests/player/seek.test.ts
```

### Dependencies on frozen interfaces
All of `src/contracts/**`. Every barrel — `src/player/app.ts` is the composition root and the only
file permitted to import all of them. May import `three` freely.

### Definition of done
`createTransport` is integer-tick only; `advance` keeps a fractional residual and adds whole ticks;
reverse and `0.1×…2×` rates work; `loopMove`, `stepKeys`, `seekMove(n, phase)` and the keyboard map of
§6.7 all work. `createSampler` implements §6.2 term for term, allocates nothing, and its segment
cursor cache provably changes no output byte. `layerWeights` enforces per-layer bounds and exposes
`layerWeightsDirty`. `cameraRig` implements all 12 presets of §5.7, with the four ortho measurement
cameras exact and unblended. `installHarness` implements `KataHarness` verbatim, including the
monotonic-forward contract on `seek` and the **capture abort on `layerWeightsDirty`**.
`?harness=1` pins 1024 × 1024 DPR 1, disables `OrbitControls`, disables `pokeLayer`, and seeds blink
from `trackHash` only.

### Verification
Numeric: `tests/player/transport.test.ts` (integer arithmetic, mark snapping, loop wrap, reverse) ·
`tests/player/sampler.test.ts` (zero allocation across 10 000 calls; `w = 1` composition equals the
compiled pose to 1e-4°) · `tests/player/seek.test.ts` (**cold seek === play-through === reverse seek,
bitwise, at 512 ticks per kata, for all 52 bones + root**) · `tests/contracts/seek-purity.test.ts`
flips green here · **G-7** via `tools/verifyDeterminism.mjs` (200 random seek sequences, zero
mismatches) · `tests/e2e/scrub.spec.ts` (8 ms preview budget).
Visual: scrub the timeline hard in both directions at every rate and confirm the figure never pops,
never jumps and never differs between "scrubbed to t" and "played to t"; the only permitted difference
is gi settle (§6.4), and even that must be identical after release.

---

## B7 — CLOTH · `agent/cloth`

### Files it may create or modify

```
src/cloth/xpbd.ts        src/cloth/constraints.ts   src/cloth/garments.ts
src/cloth/giShell.ts     src/cloth/collide.ts       src/cloth/impulseQueue.ts
src/cloth/snapshots.ts   src/cloth/wrinkle.ts       src/cloth/system.ts
src/cloth/index.ts
tests/cloth/swatch.test.ts   tests/cloth/alloc.test.ts   tests/cloth/tunnel.test.ts
tests/cloth/impulse.test.ts  tests/cloth/determinism.test.ts
```

### Dependencies on frozen interfaces
`units`, `time`, `pose` (`ImpulseEvent`), `rig` (`GiPinRing`, `GarmentPartId`, `Capsule`),
`services` (`ClothSystem`). Barrel: `src/data` (`CLOTH`, `GARMENTS`). **May not import `three` at
all** — the upload lives in `src/render/clothBridge.ts` (B5). Consumes `CapsuleSet` from the
`src/rig` barrel as plain typed arrays.

### Definition of done
XPBD per doc 06 §7.4 with `n_sub = 8`, `dt_s = 1/480 s` fixed, one Gauss–Seidel iteration per substep,
`λ` reset per substep, **colliders lerped to `(step + 0.5)/n_sub`**, constraint order = array index
order, zero per-frame allocation. 988 particles per doc 06 §7.3. Distance / shear / dihedral-bend /
attachment / LRA / unilateral collision all implemented. `giShell.ts` produces the 0.63 mm inner shell
of §5.5. `impulseQueue.ts` fires each `ImpulseEvent` **exactly once**, at exactly
`e.tick + e.crackDelayTicks`, forward and after a seek. Snapshots at every kime and every 1.0 s
(23.7 kB each), carrying wrinkle hysteresis. `seek(tick, 'exact')` and `seek(tick, 'preview')` per
§6.4. NaN guard, teleport reinit at `|Δp_pin| > 0.05 H`, velocity clamp 12 m/s, per-substep
displacement cap `0.30·r`.

### Verification
Numeric: **`tests/cloth/swatch.test.ts` is the gate that decides jersey vs 12 oz canvas** — 0.20 m
swatch, 3 cm grid, clamped edge, 2 s settle, free edge droops **7.5 ± 1.5 cm** (doc 06 §7.5). Until it
is green, `alpha_bend` is wrong and the gi is a bed sheet. Also `tests/cloth/alloc.test.ts` (stable
heap across 600 steps), `tunnel.test.ts` (11 m/s sweep vs a 4.9 cm capsule, no penetration),
`impulse.test.ts`, `determinism.test.ts` (two `seek(t,'exact')` → identical `stateHash`), metric 63
`hem_overshoot_H` in band (ref 0.037 H), and `perf.json` cloth ≤ 1.50 ms.
Visual: `DETAIL_HANDS` and `HERO` at every kime — the sleeve must **crack once** and settle, not
rattle; the skirt must show 7–9 folds per panel at 0.030–0.045 H spacing (doc 06 §7.10 rule 6, which
is what makes generic cloth read as jersey); the obi tails must move independently. Channel-D rubric
B8, C6, C11.

---

## B8 — UI · `agent/ui`

### Files it may create or modify

```
src/ui/timeline.ts   src/ui/labels.ts   src/ui/gui.ts   src/ui/look.ts
src/ui/hud.ts        src/ui/theme.css   src/ui/index.ts
tests/ui/timeline.test.ts   tests/ui/dirty.test.ts
```

### Dependencies on frozen interfaces
`units`, `kata` (`KataMove`, `TempoTier`), `pose` (`TrackMark`, `LayerId`), `services` (`Transport`,
`CameraPresetId`). Barrels: `src/player`, `src/data`. May import `three` (for the optional 3-D floor
label) and `lil-gui`.

### Definition of done
Timeline renders the compiled decomposition directly from `PoseTrack.marks` and the move windows:
per-move ticks, shaded `T_prep`/`T_tech`/`T_kime`/`T_hold` bands, kiai markers, drag → seek,
loop-a-move. Labels come from `KataMove` fields only — no second label source. `gui.ts` exposes kata,
tempo tier, rate, camera preset, quality tier and the stage mask. **`look.ts` is the answer to the
"no runtime look-dev knob" defect**: a `LOOK` folder for live material and light parameters, a `LAYERS`
folder with a live gain per baked delta layer, and a `DISPUTES` folder with **one A/B toggle per
`disputeId`, all 14**. `hud.ts` shows a persistent red badge whenever `layerWeightsDirty` is true.

### Verification
Numeric: `tests/ui/timeline.test.ts` (tick ↔ pixel mapping exact and invertible) ·
`tests/ui/dirty.test.ts` (moving any layer weight off default raises the badge, and `runInfo()` records
it).
Visual: a human can, in one session and without a recompile, settle all 14 disputes by toggling them
side by side; and can answer "the hips read dead" by moving the `koshi` gain and watching at 60 fps.
Channel-D rubric C10 (camera has no ease or parallax interest) is judged here.

---

## B9 — CRITIC · `agent/critic`

### Files it may create or modify

```
src/eval/joints.ts        src/eval/metricSpecs.ts   src/eval/referenceBank.ts
src/eval/metrics.ts       src/eval/faults.ts        src/eval/score.ts
src/eval/plan.ts          src/eval/refStick.ts      src/eval/overlaySvg.ts
src/eval/silhouette.ts    src/eval/panel.ts         src/eval/pd1925.ts
src/eval/fileMap.ts       src/eval/report.ts        src/eval/index.ts
data/reference/taikyoku-shodan.ref.json   data/reference/heian-shodan.ref.json
data/reference/overrides.md
assets/reference/pd-1925/PROVENANCE.md    assets/reference/pd-1925/*.png
assets/reference/pd-1925/*.joints.json    assets/reference/pd-1925/posture-match.json
tools/ssr.mjs             tools/browser.mjs         tools/build-track.mjs
tools/score.mjs           tools/capture.mjs         tools/contactsheet.mjs
tools/criticPrompt.mjs    tools/critic.mjs          tools/fix-route.mjs
tools/verify-constants.mjs   tools/verify-reference.mjs   tools/verify-contracts.mjs
tools/verifyDeterminism.mjs  tools/verifyOwnership.mjs    tools/calibrate-envelope.mjs
tools/verify-all.mjs      tools/bench.mjs           tools/probe-webgl.mjs  (exists)
tests/eval/metrics.test.ts     tests/eval/perfect.test.ts    tests/eval/precedence.test.ts
tests/eval/derivedRefs.test.ts tests/eval/fixsites.test.ts   tests/eval/faults.test.ts
tests/integration/pipeline.test.ts   tests/integration/repeatability.test.ts
tests/e2e/boot.spec.ts   tests/e2e/scrub.spec.ts
```

> `tools/verify-contracts.mjs` is authored by **B0** in Phase 0 and handed to B9 at the Phase-0 gate;
> from Phase 1 it is B9's file. It is the one file that changes owner, and the handoff is recorded in
> `docs/CONTRACT-CHANGELOG.md`.

### Dependencies on frozen interfaces
`units`, `time`, `ease` (metrics must use the **same** easing module the compiler used), `bones`,
`kata`, `pose`, `rig` (`CANONICAL_JOINTS`, `Landmarks`), `scorecard` (all of it),
`services` (`KataHarness`, `ShotSpec`, `RunInfo`, `CameraPresetId`). Barrels: `src/data`,
`src/solve` (for `compileKata` and `solveTwoBone` — Channel B must use the same IK).
**May import only `Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3` from `three`.** `tools/*.mjs` are
not typechecked and therefore may not contain domain logic; they read JSON and call
`ssrLoadModule`-ed TypeScript.

### Definition of done
All 63 `MetricSpec`s exist with `refSource`, `derivation` where required, `refByStance`/`refByLevel`/
`refByKata` where doc 07 §6.2 has alternates, `armed`, `fixSite` and `rubric`. The eight overrides of
§2.6 are in place. `scoreMetric`/`Group`/`Step`/`Kata` are doc 07 §6.3 **verbatim**. `faults.ts`
implements 01 §9 (Z/K/B/Y/X) and 03 §11 (F) as predicates emitting `CriticFinding[]`. `plan.ts`
returns a **tick-sorted** `ShotSpec[]` with the camera matrix of §7.3. `tools/score.mjs` runs the
whole numeric pass **in Node with no GL** in ≤ 9 s per kata. `tools/capture.mjs` seeks strictly
forward. `tools/fix-route.mjs` groups by `fixSite.file` first. `tools/verifyOwnership.mjs` fails any
cross-block commit. `tools/calibrate-envelope.mjs` exists and has been run before metric 60 is armed.
`data/reference/*.ref.json` is **hand-authored** — `tools/gen-reference.mjs` must never exist.

### Verification
Numeric: `tests/eval/metrics.test.ts` (every metric against a hand-built pose with a known answer) ·
`tests/eval/perfect.test.ts` (a hand-written perfect pose scores exactly 100 — the sharpest GL-free
test in the project) · `tests/eval/precedence.test.ts` (the eight overrides) ·
`tests/eval/derivedRefs.test.ts` (recompute every `DERIVED_01_03` reference) ·
`tests/eval/fixsites.test.ts` (**every** `fixSite.file` exists and exports `fixSite.symbol`) ·
`tests/eval/faults.test.ts` (every predicate fires on a synthetic fault) ·
`tests/integration/pipeline.test.ts` (compile → joints → metrics → gates, Node, no GL) ·
`tests/integration/repeatability.test.ts` (two Node runs at one sha byte-identical) ·
`node tools/verify-all.mjs` clean · gates **G-1…G-11**.
Visual: `strip/step-NN_<cam>.png` must place the Channel-B reference over ours with hips coincident,
no rotation and no scale, plus a Procrustes "shape only" variant; `contact-sheet.png` must be legible
at thumbnail size with the numbers under each frame; `floor-trace.png` must show the reference
polyline, the actual pelvis XZ track and per-step markers on one 1024² canvas.

---

## ORCHESTRATOR-ONLY · `agent/integrator`

No other agent may create, modify or delete these.

```
package.json          the scripts of §7.2 and the dependency set. NO agent adds a dependency.
tsconfig.json         compilerOptions and `include`. Any change is an integrator decision.
vite.config.ts        dev server, build target, the middleware-mode entry tools/ssr.mjs relies on
vitest.config.ts      test globs, environment split (node for unit/integration, playwright for e2e)
.gitignore            captures/ and reports/ are already ignored and must stay ignored
docs/ARCHITECTURE.md  this plan
docs/OWNERSHIP.md     this file
docs/CONTRACT-CHANGELOG.md   every change to src/contracts/**, with the reason and the new hash
docs/critic/rubric.md        the doc 07 §6.8 rubric, verbatim, for the VLM prompt
docs/critic/routing.md       prose companion to src/eval/fileMap.ts for the ~20 rubric ids with no metric
docs/research/**             READ-ONLY. Facts. Never edited by anyone, including the integrator.
docs/proposals/**            READ-ONLY. Historical. Superseded by docs/ARCHITECTURE.md.
```

### Integrator responsibilities
* Run Phase 0 alone and freeze `src/contracts/**`.
* Own every `[integrator]` commit: contract changes, `ROM` identity changes, `SIDE_SIGN` changes,
  arming metric 60, arming G-5, and any new file not listed in §4 of `docs/ARCHITECTURE.md`.
* Adjudicate handoffs: read `reports/<sha>/handoff-<block>.md`, assign it to the owning agent.
* Run `npm run own` and `npm run verify` at every phase gate.
* Never edit a source file inside a block.

### The four changes that stop every agent
1. `src/contracts/units.ts → SIDE_SIGN` — a global mirror. Everything downstream is invalidated.
2. `src/contracts/bones.ts → BONE_ORDER` — it is the `skinIndex` order, the `PoseTrack` order, the
   snapshot order and the diagnostics order. Every artefact on disk becomes garbage.
3. `src/contracts/time.ts → TICK_HZ` or `POSE_LADDER` — every baked track and every capture is stale.
4. `src/contracts/pose.ts → CHANNELS` or `LAYER_ORDER` — the runtime contract itself.

Each requires an `[integrator]` commit, a `docs/CONTRACT-CHANGELOG.md` entry, a full
`npm run build:track` + `npm run score` on both kata at both tempi, and a broadcast to every agent
before work resumes.
