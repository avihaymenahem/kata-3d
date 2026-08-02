# ARCHITECTURE — Compiled Kata, Sampled Runtime (CKSR)

**Status: FINAL. This document and `docs/OWNERSHIP.md` are the only authoritative plan.**
Where this document disagrees with `docs/proposals/*.md`, this document wins. Where it disagrees with
`docs/research/**`, the research docs win on *facts* and this document wins on *decisions* — see §2.6
for the exact precedence rule.

Stack, frozen: `three@0.185.1` (WebGLRenderer path) · `vite@8` · `typescript@5.9` strict ·
`lil-gui@0.21` · `vitest@3` · `playwright@1.62` + headless Chromium/SwiftShader. No downloaded
character assets, no network at runtime.

---

## 1. Verdict, base, and what changed

The judge panel returned **A = 2, B = 1, C = 0**. The base of this architecture is therefore
**Proposal A — authored data first**: the kata is a compiled artifact; a three.js-free, deterministic
compiler expands a typed declarative DSL into one immutable `PoseTrack`; the runtime is a *sampler*,
not a simulator, so `pose(tick)` is a pure function of an integer.

Fifteen grafts and twenty-one named defects were folded in. The eight that change structure:

| # | change | why (judge finding it answers) |
|---|---|---|
| 1 | **Adaptive piecewise-uniform bake** on a dyadic ladder 120 / 240 / 480 / 960 Hz, gated on *two* criteria (≤ 0.25° midpoint geodesic error **and** ≤ 12° angular step per interval) | A's flat 120 Hz bake was sized against the 900 °/s pelvis; doc 03 §4.3's forearm roll peaks at **6 285 °/s** = 52°/key = ~1.0° error. Named as fatal by all three judges. |
| 2 | **Five baked delta layers with runtime weights** (koshi, kime, breath, gaze, patch), composed in a frozen order, deltas constructed by inversion so `w = 1` reproduces the compiled pose exactly | A had no runtime look-dev knob (judge 1 fatal A3); B's additive-layer stack had unenforceable caps (judge 1 fatal B1). This has B's instrument and A's determinism. |
| 3 | **Sparse `ImpulseEvent[]`** replaces threshold-on-differentiated-acceleration as the cloth snap trigger; `accel*` channels are computed **analytically** from `kimeEaseAcc`, never finite-differenced from the baked track | A's gi was driven by an acceleration field that does not exist between keys — the snap fired ~11× across one 92 ms brake (judge 1 fatal A2). |
| 4 | **`StillAccumulator` replaces `TAARenderPass` entirely**: we own the camera view-offset jitter, so `GTAOPass`'s own internal `renderer.render(this.scene, this.camera)` is jittered in lockstep | `SSAARenderPass.js:262-264` and `TAARenderPass.js:166` clear the view offset before returning, so `GTAOPass.js:642` computes AO unjittered and bit-identical on every accumulation frame. Verified in the installed tree. Judge 1's SHARED DEFECT. |
| 5 | **Reference-precedence rule, typed and tested** (`MetricSpec.refSource`) with 8 concrete overrides of doc 07's seeded values | A's own correct numbers would have been punished and its `suggestedDelta` would have degraded authenticity while the score rose (judge 2 fatal A5). |
| 6 | **Per-move patch files** — one file per move, 41 files, pre-created empty in Phase 1 | `moves[i].overrides` in one kata file was a single-writer resource; two agents fixing two moves collided (judge 3 fatal A11). |
| 7 | **Full Node path from constants to gate result** via Vite `ssrLoadModule`; 480 Hz whole-kata canonical-joint stream replaces 8 sub-ticks/move | A had no GL-free scorecard path (judge 3 fatal A14) and could not resolve `kime_decel_time_s` = 0.07 s ± 0.04 at 260 ms sampling (judge 2 fatal A8). |
| 8 | **A 52nd bone, `ribcage`**, a childless leaf of `chest`, is the only bone permitted a non-unit scale | breath-as-`chest.scale` propagates down the whole arm chain and brushes metric 59's 2 % hard fail (judge 1 fatal B2). |

**The ONE thing this design optimizes for is unchanged from A: the shortest edit distance from a
critic complaint to a corrected frame.** Target: **median 1 file, 1 field, ≤ 250 ms recompile**, with
the file and field name printed by the scorecard, and a test asserting the printed fix site resolves
to a real exported binding.

---

## 2. Normative conventions — decided once, never re-litigated

### 2.1 World frame and handedness

| item | value |
|---|---|
| up | `+Y` |
| character facing at *yoi* | `−Z` |
| **world `+X`** | the character's **RIGHT** |
| **world `−X`** | the character's **LEFT** |
| embusen plane | `XZ`, floor at `y = 0` exactly |
| heading `H` | degrees; `H = 0` at yoi; `H` increases when the character turns to their own **LEFT** |
| authored facing vector | `f_auth(H) = (sin H°, 0, −cos H°)` — doc 02 §1 convention, **authoring space only** |
| world facing vector | `f(H) = (−sin H°, 0, −cos H°)` |
| three.js root yaw | `root.rotation.y = +H° · DEG` (rad) |
| `SIDE_SIGN` | `−1` |

Docs 01/02/03/04/06 label `+X` as the character's LEFT. Doc 07 §0.1 proves that frame is
**left-handed** (`left × up = forward = −Z` ⇒ `X × Y = −Z`), and three.js is right-handed by
construction (doc 05 §1). **Resolution: authored data keeps every doc number verbatim; exactly one
conversion exists, in `src/solve/frame.ts`.** It negates every authored `x` and every authored yaw
*magnitude*. Nothing else in the codebase may negate an X or a yaw.

Handedness is expressed by relabelling the side sign, never by mirroring geometry:
`s(L) = SIDE_SIGN·(+1) = −1`, `s(R) = SIDE_SIGN·(−1) = +1`. Doc 03's `dx = −s·0.130` therefore
resolves without any quaternion-chirality step.

Three assertions, all in `tests/contracts/handedness.test.ts`, all Phase 0, all red-first:
1. at *yoi*, `landmarks.eye_L.x < 0` and `landmarks.eye_R.x > 0`;
2. Taikyoku move 1 (`hidari gedan-barai`, `H = 90`): facing is world `−X`, and the **left** ankle is
   `0.540 H` ahead of the right along that facing, and `landmarks.LeftFistCenter.x < 0`;
3. Heian **moves 3 ↔ 12**: pelvis XZ of move 12 is the `σ`-image of move 3's (both zenkutsu, headings
   270°/90°, exactly 180° apart, so `PELVIS_AHEAD_OF_C_H[zenkutsu] = +0.049` maps correctly under the
   point reflection); **and**, as an independent expectation, Heian move 21 has `c = (−0.544, −0.354) L`.

   > **CORRECTED 2026-07-31 (Phase-0 audit).** This assertion previously read "Heian move 21: pelvis XZ
   > = `σ`-image of move 12's". That pairing is *arithmetically impossible* and no data set can satisfy
   > it: doc 02 §6.2 gives `c12 = (−0.690, −4.000)`, and doc 02 §3.2's own `σ(x,z) = (−0.38 − x, −4.00 − z)`
   > maps it to `(+0.310, 0.000)` — which is `c1`/`c3`/`c18`/`c20`, **0.854 L away from `c21`**. Moves
   > 18–21 lie outside the `σ` orbit entirely. The `c21` literal was and remains correct; only the
   > pairing was wrong. The symmetry that *does* hold at move 21 is the x-mirror of move 19 about the
   > move-20 stance centre `x = +0.31`. `tests/contracts/handedness.test.ts` asserts the corrected
   > forms (`σ(c1)==c10`, `σ(c2)==c11`, `σ(c3)==c12`) and is the authority; do not "restore" the old text.

### 2.2 Units — every field, no exceptions

| symbol | meaning | unit |
|---|---|---|
`H` | reference body height | `1.75` m exactly (`H_CM = 175`)
`FracH` | any length carried as a fraction of `H` | dimensionless; multiply by `H` for metres
`m` | world length | metres
`Deg` / `Rad` | angle | degrees / radians; **all authored angles are degrees**
`tick` | transport time | integer, `1 / TICK_HZ` s, `TICK_HZ = 3840`
`L` | embusen step unit | see §2.3
`pct` | percentage | `0…100`
`Hps` | speed normalised by height | `H` per second

**Rule:** every numeric field name in a frozen interface either (a) ends in `H`, `M`, `Deg`, `Rad`,
`S`, `Ms`, `Pct`, `Hps`, `Ticks`, or `Frac`, or (b) is a `Num` carrying its own `unit`. There is no
third case. A reviewer may reject any PR that introduces a bare `number` field without a unit suffix.

### 2.3 `L`, the embusen datum, and the ankle-datum decision

Doc 02 §1.1 sets `L = 0.520 H`; doc 01 §3.1 sets `ZENKUTSU.S = 0.540 H`. Doc 02 §1.1 explicitly
mandates rescaling every coordinate if the stance spec fixes a different `L`. Therefore:

```
L      = ZENKUTSU.S.v = 0.540 H = 0.945 m        DERIVED, never authored
EMB_H  = HACHIJI.W.v / 2 = 0.1295 H = 0.2398 L   DERIVED, never authored
         ^ this is the YOI/HACHIJI STANCE WIDTH ONLY. It is *not* doc 02's embusen "h":
           doc 02's coordinate tables and the σ axis keep the AUTHORED h = 0.19 L, and
           §2.1's own c21 literal proves it. Conflict C18. §2.5 row 3's justification
           ("closure and σ are relative") holds only under this scoping.
scale  = 0.540 / 0.520 = 1.038462                applied to every doc-02 coordinate
bbox   = 4.00 L × 4.00 L = 3.78 m × 3.78 m
```

**Ankle-datum decision (NORMATIVE).** `ZENKUTSU.S` is ankle-to-ankle (AJC) along the facing axis.
Doc 02's `FF` / `RF` are described as *foot-centre*. Foot centre sits `0.024 H` ahead of AJC along
the foot axis, and the two feet carry different yaws (`+3°` front, `+30°` rear), so foot-centre
separation would be `0.543 H` — a second, silently different `L`. That class of bug (a 3.85 %
disagreement between the embusen step and the stance length, invisible to a relative closure test)
is what the panel called fatal in Proposal B.

**Decision:** every embusen coordinate in doc 02 §4.2 / §6.2 is reinterpreted as the **AJC projected
to the floor**. `L` and `ZENKUTSU.S` are then the same number by definition. This is legal because
doc 02 §3.1's generator is `moving_foot = pivot_foot + Lk · f(H)` — a pure translation of one
consistent datum — so `σ`-symmetry (`σ(x,z) = (−0.38 − x, −4.00 − z)`) and the closure residual are
preserved exactly; both are relative quantities.

**Derived datum table** (`src/data/embusen.ts`, all `DERIVED`, all unit-tested):

| name | value | derivation |
|---|---|---|
`ZENKUTSU_HEEL_TO_HEEL_H` | **0.533** | `S − HEEL_BEHIND·cos(yawFront) + HEEL_BEHIND·cos(yawRear)` = `0.540 − 0.052·cos3° + 0.052·cos30°`. **This, not 0.540, is the reference for metric 1.**
`PELVIS_AHEAD_OF_C_H[zenkutsu]` | **+0.049** | `S/2 − hipZbehindFrontAnkle` = `0.270 − 0.221`, positive = toward the facing direction
`PELVIS_AHEAD_OF_C_H[kokutsu]` | **−0.089** | `hipZaheadOfRearAnkle − S/2` = `0.134 − 0.223`
`PELVIS_AHEAD_OF_C_H[kiba·hachiji·heiko·musubi·heisoku]` | `0.000` | symmetric stances
`FOOT_CENTRE_AHEAD_OF_AJC_H` | `+0.024` | `FOOT_LEN/2 − HEEL_BEHIND` = `0.076 − 0.052`; used for foot *geometry* only, never for embusen

Metric 42 `embusen_pos_err_H` compares `p[0]_xz` (Hips) against `c + PELVIS_AHEAD_OF_C_H · f(H)`,
not against `c`.

### 2.4 Time

```
TICK_HZ        = 3840        transport clock. Divisible by every bake rate.
POSE_LADDER    = [120, 240, 480, 960]     ticks/frame = [32, 16, 8, 4]
CHAN_RATE_HZ   = 480        channel array + diagnostics, uniform for the whole kata
JOINT_RATE_HZ  = 480        canonical-joint stream dumped by the harness
DISPLAY_TICKS  = 64         one 60 fps frame
```

`3840 = 2^8 · 15`, so every ladder rung divides it exactly and every interpolation `alpha` is an
exact dyadic rational in float64 (`k/4`, `k/8`, `k/16`, `k/32`). Heian Shodan at T1 = 54.65 s =
**209 856 ticks**.

**Why the ladder needs the 960 rung** (this is the arithmetic Proposal A got wrong): doc 03 §4.3
authors the forearm roll as `roll(τ) = 180·clamp((τ−0.65)/0.35, 0, 1)^2.2` over a 0.18 s stroke.
`dθ/dτ` peaks at **6 285 °/s** with `d²θ/dτ² ≈ 1.20 × 10⁵ °/s²`. Criterion (2), ≤ 12° per baked
interval, needs `Δt ≤ 12 / 6285 = 1.91 ms` ⇒ **524 Hz** ⇒ the 960 rung. Criterion (1),
`θ''·Δt²/8 ≤ 0.25°`, needs `Δt ≤ 4.08 ms` ⇒ 245 Hz. Criterion (2) binds; it is the anti-staircase
criterion and it is why A's per-display-frame argument was the wrong argument. Both are build gates
(**G-9**).

**Why criterion (1) is rate-independent.** A 0.25° absolute geodesic bound does not degrade at
0.1× playback: it is an angular error on the curve, not per display frame. A's claim that the
artefact is "under 2° per display frame at 0.25× slow-mo" was both wrong (52°, not 7.5°) and the
wrong quantity. State the bound absolutely, gate it absolutely.

**Third bake criterion (G-9c): every declared timing quantity below 20 ms lands on an exact tick.**
The 17 ms hikite lead (04 §2.3 `[MEAS]`), the 10–20 ms limb-stop → gi-crack delay (04 §9.1), and the
25–35 ms pelvis-sink time constant (04 §7.4) are carried as **integer tick counts** on
`ImpulseEvent` / `TrackMark` records (resolution `0.26 ms`), never as a value interpolated off a
frame grid. The `chan` array's 480 Hz grid (2.083 ms) is fine for envelopes; events are not envelopes.

### 2.5 Cross-doc conflicts — resolved here, once

| conflict | decision | why |
|---|---|---|
| `+X` = LEFT (01/02/03/04/06) vs RIGHT (07 §0.1) | **`+X` = RIGHT, `SIDE_SIGN = −1`** | §2.1 |
| `L = 0.520 H` (02) vs `S = 0.540 H` (01) | **`L = ZENKUTSU.S.v = 0.540 H`**, derived | §2.3; 02 §1.1 mandates the rescale |
| `h = 0.19 L` from `w = 0.385 L` (02) vs `HACHIJI.W = 0.259 H` (01) | **`EMB_H = HACHIJI.W.v/2 = 0.1295 H`**, derived | closure and σ are relative |
| embusen datum: foot centre vs ankle | **AJC** | §2.3 |
| gi `sheen 1.0 / 0xffffff` (05 §11.1) vs `0.35 / 0xE8E4DA` (06 §7.9) | **`sheen 0`** (was 0.45), dispute `D09`, SETTLED | 06 argued from Filament cloth data; 05's 1.0 was undefended. It shipped as a live knob because only Channel D could settle it — and Channel D did: the retroreflective rim read as a glowing uniform on every frame, reported three times, so the knob is at zero. |
| gi `anisotropy 0.25` (06 §7.9) vs NO (05 §11) | **`anisotropy 0.18` with an `itemSize = 4` analytic tangent** | 05's objection is "needs a tangent attribute"; we generate the geometry, so we generate the tangent — including the handedness `w`. See §2.7. |
| zenkutsu weight 55 / 59 / 62 / 70 % front | **59 %**, dispute `D01`; metric tol from 07 (`±8`) | 01 §3.6 resolves it geometrically at `S = 0.540 H` |
| age-uke forearm 25° vs 45° | **25°**, dispute `D03` | 03 §14.1: 45° puts the wrist at 1.036 H, above the vertex |
| chudan-uke elbow 90° vs 62/63/59° included | **03 §13's included angles**, dispute `D04` | 90° is geometrically impossible with de Leva segments plus the same sources' other constraints |
| hanmi 45° vs 90° | **45°**, dispute `D06` | 01 §11.6, 04 §12.1: JKA manual reading |
| rear-foot yaw 30° vs 45° | **30°**, tol 20–45, dispute `D05` | 01 §11.5 |
| head bob: 01 §8.1 band `±0.008 H` vs 04 §7.3 `≤ 0.008 H` peak-to-peak | **`≤ 0.008 H` peak-to-peak** is the authored clamp; `0.012 H` is the max; metric 17 ref `≤ 0.010` with tol `+0.010` | 04 §7.3 is the tighter and later statement. Proposal C shipped a `±0.008` *band* (0.016 p-p) and parked permanently in warn; we do not. |
| stage AABB 5.5 × 4.0 m (05 §16 unc. 3) | **4.68 × 4.68 m** ⇒ Mode A `S_fixed = 3.51 m`; Mode B `S_fit = 0.75 H = 1.31 m` | 3.78 m embusen + 0.45 m limb envelope per side |
| bone count 44 (06 §4.2 headline) | **52** fully expanded (44 headline → 45 with `ribcage` → 52 once every L/R twin and toe/clavicle leaf is enumerated). §2.8 and §3.4 are authoritative; `BONE_COUNT === 52` is asserted in `tests/contracts/bones.test.ts`. | §2.8 |

All fourteen live disputes are enumerated in `src/data/constants/DISPUTED.md`, each shipped as an
`AltNum` with a `disputeId`, each exposed as a live A/B toggle in the lil-gui **DISPUTES** folder.

### 2.6 Reference precedence — the rule that makes the scorecard honest

> **For a reference *value*, docs 01 / 03 / 02 win, in that order. For a *tolerance* and a
> *hard-fail*, doc 07 wins.**

Typed as `MetricSpec.refSource` and enforced by `tests/eval/precedence.test.ts`, which fails if any
metric whose reference appears in 01 §10, 03 §13/§14 or 02 §1.2 uses doc 07's seeded value. The
**nine** mandatory overrides (the table below lists 9 — metrics 1, 2, 3, 4, 6, 7, 9, 35, 37; earlier
drafts of this sentence said "eight", which contradicted the table. `MANDATORY_REF_OVERRIDES` ships all 9):

| # | metric | 07 seed | **ships** | source | why 07 is wrong |
|---|---|---|---|---|---|
1 | `stance_len_H` | 0.45 | **0.533** | `ZENKUTSU_HEEL_TO_HEEL_H`, 01 §3.1 + §10 | 07 midpoints two worded sources; 01 derives it. Metric 1's datum is heel-to-heel, so 0.540 (ankle) is also wrong — see §2.3.
2 | `stance_width_H` | 0.14 | **0.170** | 01 §10 `ZENKUTSU.W` | 07 §7.1 admits its own 0.14 conflicts with every worded source
3 | `front_knee_flex_deg` | 45 | **57** | 01 §3.2 / §10 `kneeFront` | 01 derives it by 2-link sagittal IK at `PELVIS_Y = 0.410 H`
4 | `rear_knee_flex_deg` | 8 | **10** | 01 §10 `kneeRear` | same derivation
6 | `hip_height_H` | 0.470 | **0.410** | 01 §2 / §10 `FIGHT_PELVIS_Y` | 07 derives from a 0.060 H drop; 01's drop is 0.120 H. 01's own lookup labels 0.470 *moto-dachi (kumite)* and 0.440 "too high — FAIL for kihon".
7 | `weight_front_pct` | 62 | **59** | 01 §3.6 / §10 `loadFront` | 01 resolves it geometrically
9 | `rear_foot_yaw_deg` | 25 | **30** | 01 §10 `yawRear` | 01 §3.5 ankle-ROM argument
35 | `age_uke_forearm_angle_deg` | 45 | **25** | 03 §14.1 | 45° puts the wrist above the vertex
37 | `shuto_uke_elbow_flex_deg` | 90 (flex) | **121** (flex) | 03 §13 (59° **included**) + §9.1 correction | 03 §13's column is the *included* angle; `flex = 180 − included`

Tolerances stay exactly as doc 07 §6.2 gives them. Every override is logged in
`data/reference/overrides.md` with both values and the argument.

Five metrics (18, 30, 33, 36, 39) are world heights whose authoritative source is a **GH-relative**
offset in doc 03 §13. Their references are computed once, offline, in Phase 1, by evaluating 03's
offset against the 01 §10 zenkutsu GH world position; the result is written into the ref bank as a
literal with `refSource: 'DERIVED_01_03'` and a mandatory `derivation` string, and
`tests/eval/derivedRefs.test.ts` recomputes it. This is **not** the self-marking exam the panel
rejected in Proposal B: the derivation chain is 01 + 03 arithmetic, and the *rig* is an independent
implementation that must land on the same number by a different route.

`tools/gen-reference.mjs` **does not exist and must never be created.** The scorecard retains the
ability to disagree with the rig. What replaces it is `tools/verify-reference.mjs`, which greps each
ref entry's cited doc section for the literal value and fails CI on drift.

### 2.7 Tangents

`buildGiGeometry` emits `tangent` as a `BufferAttribute` with **`itemSize = 4`**:
`xyz` = the unit warp direction (the parametric `u` isoline of the panel), `w = sign(dot(cross(N, T), B)) ∈ {−1, +1}`.
`three`'s `USE_TANGENT` GLSL path consumes `vec4` and reads the handedness from `w`; a `vec3`
attribute binds without error and mis-shades the entire gi. Asserted by
`tests/rig/tangents.test.ts`: `itemSize === 4`, `|w| === 1` for every vertex, `|T| = 1 ± 1e-5`,
`|dot(T, N)| < 1e-4`, and `anisotropy > 0 ⇒ attributes.tangent !== undefined`.

### 2.8 Bone count 52, and the only bone that may scale

Doc 06 §4.2 titles its tree "44 core bones"; that count excludes the seven leaf terminators
(`head_end`, `fingers_end_L/R`, `thumb_end_L/R`, `toe_end_L/R`), which the tree nevertheless lists and
which we need for landmarks and cloth pins. Fully expanded, doc 06's tree is **51** entries. We add
one:

```
chest
└─ ribcage                              (0, +0.0350, −0.0040)   LEAF — no children, ever
```

`BONE_COUNT = 52`. `BONE_ORDER.length` is the single authority; `tests/contracts/bones.test.ts`
asserts the count, that parents precede children, that every `_L` name has an `_R` twin, and the six
chain-closure lengths of doc 06 §4.2 to 1e-6 H.

`ribcage` carries the ribcage / upper-abdomen skin weights and is the **only** bone in the rig
permitted a non-unit `scale`. Breath drives `ribcage.scale = (1 + 0.022·b, 1, 1 + 0.022·b)` with
`b = chan.breath`, plus `0.994` compression at kiai (04 §8.2). Because `ribcage` is childless, no
descendant transform inherits the scale, so no bone length drifts.

`tests/rig/scale.test.ts`: `BONE_PARENT` contains no entry whose parent is `ribcage`; and for every
tick of both kata, every bone except `ribcage` has `scale === (1,1,1)` bit-exactly. Metric 59
`bone_length_drift_pct` is computed over the 51 non-scaling bones.

---

## 3. FROZEN SHARED INTERFACES

Ten files under `src/contracts/`. Authored by one agent in Phase 0, then **read-only forever**;
`tools/verify-contracts.mjs` hashes them and fails CI on any change without an entry in
`docs/CONTRACT-CHANGELOG.md` and an integrator commit. Independent agents code against this section
without talking to each other.

Import discipline, grep-enforced by `tests/contracts/imports.test.ts`:

* `import … from 'three'` is legal **only** under `src/rig/**`, `src/render/**`, `src/player/**`,
  `src/ui/**`.
* `src/solve/**` and `src/eval/**` may import **only** the named bindings
  `Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3` from `'three'` (pure math, Node-safe, doc 07
  §6.5 rule 3). Any other named import from `'three'` in those trees fails the build.
* `src/contracts/**`, `src/data/**`, `src/cloth/**` may not import `'three'` at all.
* `Math.random`, `Date.now`, `performance.now`, `new Date` are banned under `src/solve/**`,
  `src/cloth/**`, `src/eval/**`, `src/data/**`.
* Cross-block imports go **only** through a block's `index.ts` barrel. Deep imports across blocks
  fail the build.

### 3.1 `src/contracts/units.ts`

```ts
/** Reference body height. Every FracH value multiplies by this to become metres. */
export const H = 1.75 as const;            // m
export const H_CM = 175 as const;          // cm
export const DEG = Math.PI / 180;          // deg -> rad
export const RAD = 180 / Math.PI;          // rad -> deg
export const GRAVITY = -9.81 as const;     // m/s^2, world Y

/**
 * +1 would mean authored +X === world +X. Doc 07 SS0.1 proves the authored frame is left-handed,
 * so authored LEFT (+X) must become world -X. This is the ONLY place the flip lives.
 */
export const SIDE_SIGN = -1 as const;

/** Branded scalars. A bare number is never accepted where one of these is declared. */
export type FracH = number & { readonly __fracH: unique symbol };
export type Metres = number & { readonly __m: unique symbol };
export type Deg = number & { readonly __deg: unique symbol };
export type Rad = number & { readonly __rad: unique symbol };
export type Sec = number & { readonly __s: unique symbol };
export type Tick = number & { readonly __tick: unique symbol };

export const fracH = (n: number) => n as FracH;
export const metres = (n: number) => n as Metres;
export const deg = (n: number) => n as Deg;
export const sec = (n: number) => n as Sec;
export const tick = (n: number) => n as Tick;

/** FracH <-> metres. The only legal conversion. */
export const hToM = (v: FracH): Metres => (v * H) as Metres;
export const mToH = (v: Metres): FracH => (v / H) as FracH;

export type Handedness = 'L' | 'R';
/** Multiplies every lateral (X) offset for a given limb side, in WORLD space. */
export const sideSign = (h: Handedness): -1 | 1 => (h === 'L' ? SIDE_SIGN : (-SIDE_SIGN as 1));
```

### 3.2 `src/contracts/time.ts`

```ts
export const TICK_HZ = 3840 as const;          // transport clock, integer ticks
export const CHAN_RATE_HZ = 480 as const;      // channel array + diagnostics, uniform
export const JOINT_RATE_HZ = 480 as const;     // harness canonical-joint stream
export const DISPLAY_TICKS = 64 as const;      // one 60 fps frame

/** The dyadic bake ladder. Index 0 is the base rung. */
export const POSE_LADDER = [120, 240, 480, 960] as const;
export type PoseRateHz = typeof POSE_LADDER[number];
/** TICK_HZ / rateHz. Always a power of two here: 32, 16, 8, 4. */
export type TicksPerFrame = 32 | 16 | 8 | 4;
export const ticksPerFrame = (hz: PoseRateHz): TicksPerFrame =>
  (TICK_HZ / hz) as TicksPerFrame;

/** Build gates G-9a / G-9b / G-9c. */
export const BAKE_MAX_ERR_DEG = 0.25 as const;   // midpoint geodesic slerp error
export const BAKE_MAX_STEP_DEG = 12.0 as const;  // angular step per baked interval
export const EVENT_EXACT_BELOW_MS = 20 as const; // events under this must be exact integer ticks

export const secToTick = (s: number): number => Math.round(s * TICK_HZ);
export const tickToSec = (t: number): number => t / TICK_HZ;
export const msToTick = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);

/** Snap a tick down to the frame grid of a given rung. */
export const floorToFrame = (t: number, tpf: TicksPerFrame): number => t - (t % tpf);
```

### 3.3 `src/contracts/ease.ts`

Pure math, zero imports. The compiler, the metrics module and the reference-figure builder all use
this file, so the easing the critic measures is bit-identical to the easing the compiler baked.

```ts
/** doc 04 SS4.2 verbatim. a = tauP / (1 - tauP). */
export const aFromPeak = (tauPeak: number): number => tauPeak / (1 - tauPeak);

/** Normalised progress 0..1 along a technique channel. S(0)=0, S(1)=1, S'(0)=S'(1)=0. */
export function kimeEase(tau: number, tauPeak = 0.73): number;
/** Exact normalised speed (mean = 1). Used for analytic cloth/impulse drivers. */
export function kimeEaseVel(tau: number, tauPeak = 0.73): number;
/**
 * Exact normalised acceleration, d2S/dtau2. THIS is the only legal source of the accel channels.
 * Finite-differencing a baked track is forbidden (see SS6.4).
 */
export function kimeEaseAcc(tau: number, tauPeak = 0.73): number;

/** doc 01 SS8.3 koshi no kaiten: hold to tau=0.55, then 1-(1-u)^3. Linear yaw is unrepresentable. */
export function holdThenSnap(tau: number, holdUntil = 0.55): number;

/** Closed-form critically damped step response. No integrator, no state. */
export function criticalDampClosed(t: number, omega: number): number;
/** Closed-form second-order settle, doc 04 SS5.1. Returns a signed offset multiplier. */
export function settle2(t: number, omegaN: number, zeta: number): number;
export const easeOutCubic = (u: number): number => 1 - Math.pow(1 - u, 3);
export const easeInOutCubic = (u: number): number => 0;   // impl: standard

/** Geodesic angle between two unit quaternions, degrees. Used by the baker and its gate. */
export function quatAngleDeg(ax: number, ay: number, az: number, aw: number,
                             bx: number, by: number, bz: number, bw: number): number;
```

### 3.4 `src/contracts/bones.ts`

```ts
export type BoneName =
  | 'root' | 'pelvis'
  | 'spine_01' | 'spine_02' | 'spine_03' | 'chest' | 'ribcage'
  | 'neck_01' | 'head' | 'head_end' | 'eye_L' | 'eye_R'
  | 'clavicle_L' | 'upperarm_L' | 'upperarm_twist_L' | 'deltoid_L'
  | 'lowerarm_L' | 'lowerarm_twist_01_L' | 'lowerarm_twist_02_L'
  | 'hand_L' | 'fingers_prox_L' | 'fingers_dist_L' | 'fingers_end_L'
  | 'thumb_L' | 'thumb_end_L'
  | 'thigh_L' | 'thigh_twist_L' | 'calf_L' | 'calf_twist_L'
  | 'foot_L' | 'ball_L' | 'toe_end_L'
  | 'clavicle_R' | 'upperarm_R' | 'upperarm_twist_R' | 'deltoid_R'
  | 'lowerarm_R' | 'lowerarm_twist_01_R' | 'lowerarm_twist_02_R'
  | 'hand_R' | 'fingers_prox_R' | 'fingers_dist_R' | 'fingers_end_R'
  | 'thumb_R' | 'thumb_end_R'
  | 'thigh_R' | 'thigh_twist_R' | 'calf_R' | 'calf_twist_R'
  | 'foot_R' | 'ball_R' | 'toe_end_R';

/**
 * FROZEN. This array order IS the skinIndex order, the PoseTrack quaternion order, the
 * checkpoint order and the diagnostics order. Changing it invalidates every artefact on disk.
 * Parents always precede children (so FK is a single forward pass).
 */
export const BONE_ORDER: readonly BoneName[];
export const BONE_COUNT = 52 as const;        // === BONE_ORDER.length
export type BoneIndex = number & { readonly __bone: unique symbol };
export function boneIndex(name: BoneName): BoneIndex;   // O(1), from a frozen lookup

/** BONE_PARENT[i] is the index of bone i's parent; -1 for 'root'. */
export const BONE_PARENT: Readonly<Int8Array>;
/** Parent-local rest translation, FracH, in T-POSE GENERATION SPACE (doc 06 SS4.2). */
export const REST_OFFSET_H: Readonly<Float64Array>;      // BONE_COUNT * 3
/** Bone primary axis (unit, bone-local) used by the swing-twist split. */
export const PRIMARY_AXIS: Readonly<Float64Array>;       // BONE_COUNT * 3
/** All rest LOCAL quaternions are identity by construction (doc 06 SS0). Asserted, not stored. */

/** Bones that may be written by a runtime delta layer. Everything else is base-only. */
export const LAYER_WRITABLE: Readonly<Record<LayerId, readonly BoneIndex[]>>;
```

> **Note on `BONE_COUNT`.** See §2.8. Doc 06 §4.2's headline "44 core bones" excludes the seven leaf
> terminators its own tree lists; fully expanded that tree is 51 entries, and `ribcage` makes **52**.
> `BONE_ORDER.length` is the single authority; `tests/contracts/bones.test.ts` asserts
> `BONE_COUNT === BONE_ORDER.length === 52`, asserts parents precede children, asserts every `_L`
> name has an `_R` twin, and asserts the six chain-closure lengths of doc 06 §4.2 to `1e-6 H`.

### 3.4.1 Auxiliary shared types referenced by §3.13

These are declared in the barrel of the block that owns them, but they appear in cross-block
signatures, so their shape is frozen here.

```ts
// B1 — src/data/index.ts
export interface FootPlan {
  readonly moveN: number;
  readonly headingDeg: number;                 // AUTHORED frame
  readonly ffXZ: readonly [number, number];    // AJC projected to floor, units of L, AUTHORED frame
  readonly rfXZ: readonly [number, number];
  readonly cXZ:  readonly [number, number];
  readonly frontFoot: Handedness;
  readonly pivotFoot: Handedness | null;
  readonly pivotKind: PivotKind;
  readonly excursion: MoveOverride['footExcursion'] | null;
}
export interface CameraPresetParams {
  readonly id: CameraPresetId;
  readonly kind: 'persp' | 'ortho';
  readonly fovDeg?: number;                    // persp only
  readonly orthoHeightH?: number;              // ortho only, fraction of H
  readonly posH: readonly [number, number, number];   // fraction of H, world frame
  readonly targetH: readonly [number, number, number];
  readonly upIsMinusZ: boolean;                // true only for M_TOP / EMBUSEN
  readonly nearH: number; readonly farH: number;
  readonly anchorBone: BoneName | null;        // DETAIL_* / FOLLOW; null = static
  readonly followTauS: number;                 // 0 = rigid
  readonly frozen: boolean;                    // true for M_FRONT/M_LEFT/M_RIGHT/M_TOP
}

// B3 — src/solve/index.ts
export interface TwoBoneArgs {
  readonly aWorld: Float64Array;  // 3, root joint,   metres
  readonly lenAB: number;         // metres
  readonly lenBC: number;         // metres
  readonly targetWorld: Float64Array;  // 3, metres
  readonly poleWorld: Float64Array;    // 3, unit direction the mid joint bends toward
  readonly soften: number;        // 0.97 (doc 06 §6.1)
  readonly midMinDeg: number;     // joint limit, folded into step 2 — never post-clamped
  readonly midMaxDeg: number;
}
export interface TwoBoneOut {
  readonly qA: Float64Array;      // 4, local, xyzw
  readonly qB: Float64Array;      // 4, local, xyzw
  readonly reachedWorld: Float64Array;  // 3, metres — what the chain actually hit
}

// B4 — src/rig/index.ts
export interface CapsuleSet {
  readonly count: number;
  readonly a: Float32Array;       // count*3, world metres
  readonly b: Float32Array;       // count*3
  readonly r: Float32Array;       // count, world metres
  readonly ids: readonly string[];
}

// B5 — src/render/index.ts
export type MaterialSet = Readonly<Record<
  'M_GI'|'M_SKIN'|'M_OBI'|'M_FLOOR'|'M_BACKDROP'|'M_HAIR'|'M_EYE'|'M_EMBUSEN'|'M_MASK'|'M_DEBUG',
  import('three').Material>>;
export interface IblHandle { readonly texture: import('three').Texture; dispose(): void }
export interface LightRig {
  readonly key: import('three').DirectionalLight;
  readonly rim: import('three').DirectionalLight;
  readonly fill: import('three').DirectionalLight;
  readonly cross: import('three').DirectionalLight;
}
export interface StageHandle { readonly floor: import('three').Mesh;
                               readonly backdrop: import('three').Mesh;
                               readonly embusen: import('three').Mesh; }
export interface OverlayHandle { setVisible(k: 'skeleton'|'com'|'support'|'embusen', v: boolean): void }

// B6 — src/player/index.ts
export interface BootOpts {
  readonly canvas: HTMLCanvasElement;
  readonly kataId: KataId; readonly tempoTier: TempoTier;
  readonly quality: 'low' | 'high' | 'max';
  readonly harness: boolean;      // ?harness=1 : pins 1024x1024 DPR 1, disables OrbitControls + poke
  readonly startTick: number;
  readonly stageMask?: number;
}
export interface AppHandle {
  readonly transport: Transport; readonly source: PoseSource; readonly rig: RigHandles;
  readonly cloth: ClothSystem; readonly cameraRig: CameraRig; readonly post: PostStack;
  readonly weights: Record<LayerId, number>;
  reload(kataId: KataId, tempoTier: TempoTier): Promise<void>;
  dispose(): void;
}

// B7 — src/cloth/index.ts
export interface GarmentLayout {
  readonly part: GarmentPartId;
  readonly cols: number; readonly rows: number;
  readonly first: number;         // index of this part's first particle in the global arrays
  readonly count: number;
  readonly cDrag: number; readonly layerOffsetH: number;
}

// B9 — src/eval/index.ts
export interface JointStream {
  readonly rateHz: 480;
  readonly frameCount: number;
  readonly pos: Float32Array;     // frameCount * CANONICAL_COUNT * 3, world metres
  readonly chan: Float32Array;    // frameCount * CHANNEL_COUNT
  frameOfTick(tick: number): number;
  tickOfFrame(f: number): number;
}
export interface ScoreMeta {
  readonly kataId: KataId; readonly tempoTier: TempoTier;
  readonly gitSha: string; readonly trackHash: string; readonly contractHash: string;
  readonly captureProfile: 'none' | 'fast' | 'hero';
  readonly layerWeights: Readonly<Record<LayerId, number>>;
  readonly bake: BakeStats;
  readonly baselineSha: string | null;
}
```

### 3.5 `src/contracts/num.ts`

```ts
export type Unit = 'H' | 'm' | 'cm' | 'deg' | 'deg/s' | 's' | 'ms' | 'pct'
                 | 'ratio' | 'Hps' | 'count' | 'bool' | 'N/m' | 'rad/(N.m)';
export type Confidence = 'MEASURED' | 'TRAD' | 'DERIVED' | 'ART';

/**
 * A number and its citation are the SAME OBJECT. This is what lets the scorecard print provenance
 * next to a failure and lets tools/verify-constants.mjs prove the citation is still true.
 */
export interface Num {
  readonly v: number;        // the value, expressed in `unit`
  readonly unit: Unit;
  /** How well we KNOW the number. Never used for scoring - scoring tolerances come from doc 07. */
  readonly tol: number;
  /** Exact doc anchor, e.g. 'docs/research/01-stances.md SS3.1'. Greppable. */
  readonly src: string;
  readonly conf: Confidence;
}

/** A disputed value: ships `v`, but every `alt` is one GUI toggle away. See DISPUTED.md. */
export interface AltNum extends Num {
  readonly disputeId: `D${number}`;                  // 'D01' .. 'D14'
  readonly alt: readonly { readonly v: number; readonly src: string; readonly label: string }[];
}

export const N = (v: number, unit: Unit, tol: number, src: string, conf: Confidence): Num =>
  ({ v, unit, tol, src, conf });

/** Hot-loop mirror: recursively strips provenance. flat(ZENKUTSU).S === 0.540 */
export type Flat<T> = { readonly [K in keyof T]: T[K] extends Num ? number : Flat<T[K]> };
export function flat<T extends object>(t: T): Flat<T>;
export function fmtNum(n: Num): string;   // 'ZENKUTSU.S = 0.540 H +-0.040 [DERIVED] 01 SS3.1'
```

### 3.6 `src/contracts/kata.ts` — the authoring DSL

```ts
import type { Handedness } from './units';

export type StanceId =
  | 'heisoku' | 'musubi' | 'heiko' | 'hachiji'
  | 'zenkutsu' | 'zenkutsu-ashi' | 'han-zenkutsu' | 'kokutsu' | 'kiba' | 'moto';

export type TechniqueId =
  | 'none' | 'gedan-barai' | 'age-uke' | 'soto-uke' | 'uchi-uke' | 'shuto-uke'
  | 'choku-zuki' | 'oi-zuki' | 'gyaku-zuki' | 'tettsui-tate-mawashi';

export type Level = 'jodan' | 'chudan' | 'gedan';
export type HipFacing = 'shomen' | 'hanmi' | 'gyaku-hanmi';
export type HikiteForm = 'HIP-A' | 'TATE-B' | 'NONE';
export type HandShape = 'seiken' | 'shuto' | 'open' | 'nukite';
/** doc 02 SS3.1 footfall rules. R0 is Heian move 4's retract-return. */
export type PivotRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type PivotKind = 'BALL' | 'HEEL' | 'WHOLE_FOOT' | 'NONE';
/** doc 02 SS8 simultaneity rules. */
export type SimRule = 'S1' | 'S2' | 'S3';
/** doc 02 SS1.4 tempo classes. */
export type TempoClass = 'M1' | 'N' | 'F' | 'T90' | 'T135' | 'T180' | 'T270' | 'D45';
/** doc 04 SS6.3 pause classes. */
export type PauseClass = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
/** doc 04 SS6.2. tempoScale multiplies T_prep and T_hold ONLY - never T_tech/T_thrust/T_kime. */
export type TempoTier = 'T0' | 'T1' | 'T2' | 'T3';
export const TEMPO_SCALE: Readonly<Record<TempoTier, number>>;   // T0 1.35, T1 1.00, T2 0.78, T3 0.62

/** Embusen coordinate. Units of L. AJC projected to the floor (SS2.3). AUTHORED (doc-02) frame. */
export type EmbXZ = readonly [x: number, z: number];

export interface TechniqueRef {
  readonly id: TechniqueId;
  readonly arm: Handedness;
  readonly level: Level;
  /** Target height, FracH (doc 02 SS1.2). Redundant with `level`; asserted at validate. */
  readonly targetH: number;
  readonly hand: HandShape;
  /** Named variant key into TECHNIQUES, e.g. 'tate'. */
  readonly variant?: string;
}

export interface KataMove {
  readonly n: number;                  // 1-based count
  readonly label: string;              // 'hidari gedan-barai'
  readonly labelJp: string;            // '左下段払い'
  readonly labelEn: string;            // 'left downward block'
  /** Signed deg. + = to the character's LEFT. AUTHORED frame (doc 02 SS1). */
  readonly dHeadingDeg: number;
  /** Resulting absolute heading, 0..360, AUTHORED frame. ASSERTED against the dH chain. */
  readonly headingDeg: number;
  readonly rule: PivotRule;
  readonly pivot: Handedness | null;   // planted foot; zero translation for the whole move
  readonly pivotKind: PivotKind;
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
  /** t_slot at T1: previous kime -> this kime, seconds. doc 02 SS1.4 / SS4.1 / SS6.1. */
  readonly tSlotS: number;
  /** Authored embusen, units of L, AJC datum. RECOMPUTED from pivot + Lk*f(H) and ASSERTED. */
  readonly embusen: { readonly ff: EmbXZ; readonly rf: EmbXZ; readonly c: EmbXZ };
  readonly notes?: string;
  /** Exact doc anchor for this row, e.g. '02-kata-sequences.md SS4.1 row 4'. */
  readonly src: string;
}

export interface CeremonyPhase {
  readonly id: 'REI_IN' | 'ANNOUNCE' | 'YOI' | 'SET'
             | 'FINAL_HOLD' | 'YAME' | 'SETTLE' | 'ATTENTION' | 'REI_OUT';
  readonly stance: StanceId;
  readonly durationS: number;          // at T1
  readonly trunkPitchDeg?: number;
  readonly params?: Readonly<Record<string, number>>;
}

export type KataId = 'taikyoku-shodan' | 'heian-shodan';

export interface KataScore {
  readonly schema: 'kata-score/1';
  readonly id: KataId;
  readonly displayName: string;
  readonly displayNameJp: string;
  readonly moveCount: number;                  // asserted === moves.length
  readonly kiaiAt: readonly number[];          // asserted === moves.filter(kiai).map(n)
  readonly fastPairs: readonly (readonly [number, number])[];
  readonly openingCeremony: readonly CeremonyPhase[];
  readonly moves: readonly KataMove[];
  readonly closingCeremony: readonly CeremonyPhase[];
  /** Moves-only nominal seconds at T1: 35.25 / 39.75. Asserted within 20 %. */
  readonly totalMoveSecondsT1: number;
  readonly provenance: readonly string[];
}
```

### 3.7 `src/contracts/kata.ts` (cont.) — the per-move patch, THE escape hatch

One file per move: `src/data/patches/<kataId>/move-NN.ts`. All 41 files exist from Phase 1, each
exporting an empty patch. Two agents fixing two different moves never touch the same file.

```ts
/** A scalar override on a global constant, scoped to ONE move. */
export interface MoveOverride {
  readonly stance?: Partial<Record<
    'S' | 'W' | 'pelvisY' | 'kneeFront' | 'kneeRear' | 'yawFront' | 'yawRear'
    | 'loadFront' | 'pelvisTiltPost' | 'pelvisYawHanmi' | 'torsoPitch', number>>;
  readonly tech?: Partial<Record<
    'dx' | 'dy' | 'dz' | 'elbowDeg' | 'rollDeg' | 'rollStartPct' | 'rollEndPct'
    | 'poleYawDeg' | 'maxLateralDevH', number>>;
  readonly hikite?: Partial<Record<'dx' | 'dy' | 'dz' | 'leadMs', number>>;
  readonly timing?: Partial<Record<
    'tSlotS' | 'tTechS' | 'tThrustS' | 'tKimeS' | 'tHoldS' | 'tPrepS', number>>;
  readonly dynamics?: Partial<Record<
    'dPsiDeg' | 'omegaPsiDegS' | 'tauP' | 'recoilFracL', number>>;
  /** Per-channel lead override, ms before arrival. doc 04 SS11. */
  readonly channelLeadMs?: Partial<Record<ChannelId, number>>;
  /** doc 02 SS6.2 Heian move 4: front foot slides back deltaL at atTau, returns by kime. */
  readonly footExcursion?: {
    readonly foot: Handedness;
    readonly atTau: number;        // 0..1 within the move, peak of the excursion
    readonly deltaL: number;       // signed, units of L, along -f(H)
    readonly torsoRiseH: number;   // FracH, transient pelvis rise during the retraction
  };
}

/**
 * A per-bone, per-tick corrective quaternion delta. This is the landing site for
 * "the left clavicle is shrugged at step 18 only" - a scoped fix, not a global solver edit.
 * Baked into LayerTrack 'patch', which ships at weight 1.0 but is EMPTY by default.
 */
export interface PatchKey {
  readonly bone: BoneName;
  /** Fraction of the move's [start, holdEnd] window, 0..1. Resolved to an exact tick at compile. */
  readonly atTau: number;
  /** Local-space delta, degrees, applied about the named axis in the bone's own frame. */
  readonly axis: 'x' | 'y' | 'z';
  readonly deltaDeg: number;
  /** Half-width of the raised-cosine window over which the delta ramps in and out, seconds. */
  readonly widthS: number;
}

export interface MovePatch {
  readonly kataId: KataId;
  readonly n: number;
  /** REQUIRED whenever anything below is non-empty. Printed in the scorecard. */
  readonly reason: string;
  /** The critic finding id this patch answers, e.g. 'B3' | 'shoulder_elevation_H'. */
  readonly finding: string | null;
  readonly override: MoveOverride;
  readonly patch: readonly PatchKey[];
}

/** Every move-NN.ts default-exports exactly this shape. Empty patch: reason '', finding null. */
export type MovePatchModule = { readonly default: MovePatch };
```

### 3.8 `src/contracts/kata.ts` (cont.) — stance / technique / dynamics specs

```ts
/** doc 01 SS3-SS7 + SS10. Every field a Num. `pelvisY` is an INPUT to the leg solve, never an output. */
export interface StanceSpec {
  readonly id: StanceId;
  readonly S: Num;               // H, AJC<->AJC along the facing axis
  readonly W: Num;               // H, AJC<->AJC lateral
  readonly yawFront: Num;        // deg, AUTHORED frame, + = toed out toward char-left
  readonly yawRear: Num;         // deg, AUTHORED frame
  readonly pelvisY: Num;         // H, MIDHIP height. HARD CONSTRAINT of the leg solve.
  readonly kneeFront: Num;       // deg flexion (0 = straight)
  readonly kneeRear: Num;        // deg flexion
  readonly loadFront: Num;       // pct of body weight on the front foot
  readonly pelvisTiltPost: Num;  // deg, posterior tilt, + = pubis up
  readonly pelvisYawHanmi: Num;  // deg, AUTHORED frame
  readonly torsoPitch: Num;      // deg from vertical, + = forward
  readonly heelDownFront: boolean;
  readonly heelDownRear: boolean;
}

/** doc 03 SS13 END table + SS4-SS10 keyframes. ALL offsets are GH-relative, FracH, TORSO-LOCAL. */
export interface TechniqueSpec {
  readonly id: TechniqueId;
  readonly level: Level;
  readonly refPoint: 'MCP2' | 'FIST_CENTRE' | 'WRIST' | 'FINGERTIP' | 'HAND_CENTRE';
  /** GH-relative offsets, FracH. dx is written WITHOUT the side factor; solver applies -s*dx. */
  readonly start: { readonly dx: Num; readonly dy: Num; readonly dz: Num };
  readonly mid:   { readonly dx: Num; readonly dy: Num; readonly dz: Num };
  readonly end:   { readonly dx: Num; readonly dy: Num; readonly dz: Num };
  readonly palmNormalStart: readonly [number, number, number];  // unit, torso-local
  readonly palmNormalEnd:   readonly [number, number, number];
  /** Total forearm roll across the stroke, deg, + = pronation. doc 03 SS4.3. */
  readonly rollDeg: Num;
  /** Fraction of the stroke over which the roll happens, e.g. [0.65, 1.00]. */
  readonly rollWindow: readonly [number, number];
  /** doc 03 SS13 "Elbow" column: the INCLUDED angle in deg. flex = 180 - included. Advisory. */
  readonly elbowIncludedDeg: Num;
  readonly leader: 'fist' | 'elbow';
  /** doc 06 SS6.2 pole direction, chest-local unit vector. */
  readonly poleDirChest: readonly [number, number, number];
  readonly hand: HandShape;
  /** Path straightness budget, FracH. Metric 19 / 44 enforce it. */
  readonly maxLateralDevH: Num;
}

export type ChannelId =
  | 'rearFootDrive' | 'comTranslate' | 'pelvisYaw' | 'hikite'
  | 'thoraxYaw' | 'shoulderGirdle' | 'elbowExtend' | 'wristLock' | 'forearmRoll';

/** doc 04 SS11. lead is ms BEFORE arrival, at Ttech = 0.340 s; scaled by Ttech/0.340. */
export interface ChannelDyn { readonly tauP: Num; readonly leadMs: Num; }

/** doc 04 SS10, one row per technique class. */
export interface TechniqueDynamics {
  readonly key: string;                 // 'oi-zuki-chudan-step'
  readonly TtechS: Num;
  readonly TthrustS: Num;
  readonly TkimeS: Num;
  readonly dPsiDeg: Num;                // magnitude; sign resolved from stance side
  readonly omegaPsiDegS: Num;
  readonly tauP: Num;                   // end-effector
  readonly vPkMs: Num;                  // m/s
  readonly recoilFracL: Num;
  readonly channels: Readonly<Record<ChannelId, ChannelDyn>>;
}

/** doc 06 SS3.1 swing-twist clamp. Angles deg, bone-local. */
export interface RomLimit {
  readonly swingConeXDeg: number;   // elliptic cone semi-axis about the local X plane
  readonly swingConeZDeg: number;
  readonly twistMinDeg: number;
  readonly twistMaxDeg: number;
}
```

### 3.9 `src/contracts/pose.ts` — the runtime contract

```ts
import type { BoneIndex } from './bones';
import type { PoseRateHz, TicksPerFrame } from './time';

/** 14 scalar channels, baked uniformly at CHAN_RATE_HZ. Order is FROZEN. */
export const CHANNELS = [
  'breath',        // 0..1, 1 = full inhale                                    doc 04 SS8.1
  'tension',       // 0..1 kime envelope, JKA 0->10->0                         doc 04 SS5
  'kiai',          // 0..1 vocal envelope                                      doc 04 SS8.3
  'pelvisYawRate', // deg/s, ANALYTIC (holdThenSnap derivative)                doc 01 SS8.3
  'accelL',        // m/s^2, left  wrist, ANALYTIC (kimeEaseAcc * pathLen)     doc 04 SS4.5
  'accelR',        // m/s^2, right wrist, ANALYTIC
  'loadL',         // 0..1 vertical load share, left  foot                     doc 04 SS7.1
  'loadR',
  'plantL',        // 0 | 1 plant state                                        doc 06 SS6.3
  'plantR',
  'gazeYaw',       // deg, absolute world yaw of the gaze target
  'gazePitch',     // deg
  'blink',         // 0..1, 1 = fully closed; schedule seeded from track hash  doc 06 SS6.5
  'tauMove',       // 0..1 progress within the current move window
] as const;
export type ChannelName = typeof CHANNELS[number];
export const CHANNEL_COUNT = 14 as const;

/** Sparse, semantic. Authored/solved. NEVER shipped to the runtime. */
export interface PoseKey {
  readonly tick: number;
  readonly phase: 'start' | 'prep' | 'mid' | 'kime' | 'hold';
  readonly moveN: number;                    // 0 = ceremony
  readonly q: Float32Array;                  // BONE_COUNT*4, bone-local, xyzw
  readonly rootPos: Float32Array;            // 3, world metres
  readonly rootQuat: Float32Array;           // 4
  readonly chan: Float32Array;               // CHANNEL_COUNT
}

/**
 * One contiguous run of frames at a single ladder rung. Indexing inside a segment is O(1)
 * arithmetic; there is no per-bone binary search anywhere in the sampler.
 */
export interface PoseSegment {
  readonly startTick: number;      // inclusive, an exact multiple of ticksPerFrame
  readonly frameCount: number;     // >= 2
  readonly rateHz: PoseRateHz;
  readonly ticksPerFrame: TicksPerFrame;
  /** Index of this segment's frame 0 within PoseTrack.q, in FLOATS (frameIndex*BONE_COUNT*4). */
  readonly qOffset: number;
  /** Index of this segment's frame 0 within PoseTrack.rootPos / rootQuat, in FRAMES. */
  readonly frameOffset: number;
  /** Why this rung was chosen. 'base' | 'roll' | 'kime' | 'hipSnap' | 'contact'. */
  readonly reason: string;
}

export type LayerId = 'koshi' | 'kime' | 'breath' | 'gaze' | 'patch';
/** FROZEN composition order. Post-multiplication in the bone's own frame. */
export const LAYER_ORDER: readonly LayerId[];   // ['koshi','kime','breath','gaze','patch']

/**
 * A baked delta layer. Shares PoseTrack.segments exactly, so alpha is computed once per frame.
 * dq[f][k] is the LOCAL delta applied to bone `bones[k]` at base frame f.
 * Deltas are built by INVERSION (dq_i = inv(q_{i-1}) * q_i), so composing every layer at
 * weight 1.0 reproduces the compiled pose to < 1e-4 deg. Asserted at bake time.
 */
export interface LayerTrack {
  readonly id: LayerId;
  readonly bones: readonly BoneIndex[];               // sorted ascending
  readonly dq: Float32Array;                          // baseFrameCount * bones.length * 4, xyzw
  /** breath only: ribcage non-uniform scale. null on every other layer. */
  readonly dScaleRibcage: Float32Array | null;        // baseFrameCount * 3
  readonly defaultWeight: 1.0;                        // RELEASE value. Always exactly 1.
  readonly minWeight: number;                         // look-dev floor
  readonly maxWeight: number;                         // look-dev ceiling
}

/**
 * A discrete, exactly-timed mechanical event. This REPLACES thresholding a differentiated
 * acceleration signal, which produced an impulse train instead of one crack (judge 1 fatal A2).
 */
export interface ImpulseEvent {
  readonly tick: number;                  // exact, TICK_HZ
  readonly kind: 'limb-stop' | 'foot-contact' | 'hip-snap' | 'kiai';
  readonly moveN: number;
  readonly bone: BoneIndex;               // the decelerating bone
  readonly deltaVMs: number;              // m/s, magnitude of the velocity step removed
  readonly dirWorld: readonly [number, number, number];   // unit, pre-stop velocity direction
  /** doc 04 SS9.1: 10-20 ms limb-stop -> visible crack. 38..77 ticks. EXACT, never interpolated. */
  readonly crackDelayTicks: number;
  readonly targets: readonly GarmentPartId[];
}

export interface TrackMark {
  readonly kind: 'move-start' | 'prep' | 'foot-contact' | 'kime' | 'kiai' | 'hold-end' | 'ceremony';
  readonly tick: number;
  readonly moveN: number;
  readonly label: string;
}

/** Pure data the compiled foot solve produced. No runtime state. */
export interface PlantSpan {
  readonly foot: 'L' | 'R';
  readonly tickIn: number;
  readonly tickOut: number;
  readonly worldPosXZ: readonly [number, number];   // metres
  readonly worldYawDeg: number;
  readonly pivot: {
    readonly kind: 'BALL' | 'HEEL' | 'WHOLE_FOOT';
    readonly pointXZ: readonly [number, number];    // metres, the point that does NOT move
    readonly fromDeg: number; readonly toDeg: number;
    readonly tick0: number; readonly tick1: number;
  } | null;
}

/** Per-move worst-case residuals. Written by the compiler, read by the fix router. */
export interface SolveDiagnostics {
  readonly rateHz: 480;
  readonly frameCount: number;
  readonly ikResidualM: Float32Array;        // frameCount*4 : [armL, armR, legL, legR], metres
  readonly plantSlipM: Float32Array;         // frameCount*2 : [L, R], metres
  readonly comErrH: Float32Array;            // frameCount, FracH
  readonly headYH: Float32Array;             // frameCount, FracH, head_end world Y
  readonly pelvisYawDeg: Float32Array;       // frameCount, world
  /** Per-move max clamp saturation per bone, 0..1. moveCount*BONE_COUNT. Not per-frame. */
  readonly clampSatByMove: Float32Array;
  readonly worst: {
    readonly ikResidualM: number; readonly ikResidualAtTick: number; readonly ikResidualMoveN: number;
    readonly plantSlipM: number;  readonly plantSlipAtTick: number;
    readonly headBobH: number;    readonly headBobMoveN: number;
    readonly clampSat: number;    readonly clampSatBone: BoneIndex;
  };
}

export interface BakeStats {
  readonly segments: number;
  readonly framesByRate: Readonly<Record<'120' | '240' | '480' | '960', number>>;
  readonly baseFrames: number;
  readonly bytes: number;
  readonly compileMs: number;
  readonly maxSlerpErrDeg: number;     // GATE G-9a: < 0.25
  readonly maxStepDeg: number;         // GATE G-9b: <= 12.0
  readonly maxStepBone: BoneIndex;
  readonly maxStepAtTick: number;
  readonly eventsBelow20msExact: boolean;   // GATE G-9c
  readonly layerRecomposeErrDeg: number;    // GATE: < 1e-4
  readonly worstCaseChestYawDeg: number;    // GATE: <= 15 + 2 (doc 04 SS2.1 X-factor cap)
  readonly stageAssertsPassed: readonly string[];
}

/** Dense, dumb, immutable, seekable. THE runtime contract. */
export interface PoseTrack {
  readonly schema: 'pose-track/2';
  readonly kataId: string;
  readonly tempoTier: TempoTier;
  readonly durationTicks: number;
  readonly durationS: number;
  readonly segments: readonly PoseSegment[];
  /** Concatenated per segment. Bone-local quaternions, xyzw. */
  readonly q: Float32Array;
  readonly rootPos: Float32Array;            // baseFrames*3, world metres
  readonly rootQuat: Float32Array;           // baseFrames*4, xyzw
  readonly layers: readonly LayerTrack[];    // exactly LAYER_ORDER.length entries, in that order
  readonly chanRateHz: 480;
  readonly chanFrameCount: number;
  readonly chan: Float32Array;               // chanFrameCount*CHANNEL_COUNT
  readonly impulses: readonly ImpulseEvent[];
  readonly marks: readonly TrackMark[];
  readonly plants: readonly PlantSpan[];
  readonly diagnostics: SolveDiagnostics;
  readonly bakeStats: BakeStats;
  /** fnv1a-64 over every Num.v, every patch, the tempo tier, and the solver code version. */
  readonly hash: string;
}

/** Caller-owned scratch. The sampler never allocates. */
export interface PoseFrame {
  readonly q: Float32Array;          // BONE_COUNT*4
  readonly rootPos: Float32Array;    // 3
  readonly rootQuat: Float32Array;   // 4
  readonly chan: Float32Array;       // CHANNEL_COUNT
  readonly scaleRibcage: Float32Array; // 3
}

/** The WHOLE runtime read path. Pure function of an integer plus a weight vector. */
export interface PoseSource {
  readonly track: PoseTrack;
  /**
   * Writes into `out`. Slerps between the two bracketing frames of the segment containing `tick`,
   * then post-multiplies each layer delta scaled by `weights[layerId]`.
   * MUST be free of allocation, wall-clock reads and hidden state other than a segment cursor
   * cache whose only effect is speed.
   */
  sample(tick: number, weights: Readonly<Record<LayerId, number>>, out: PoseFrame): void;
  /** Nearest baked key at or below tick, for frame-stepping the UI. */
  keyTickAtOrBefore(tick: number): number;
}
```

### 3.10 `src/contracts/rig.ts`

```ts
import type { Bone, Group, SkinnedMesh, Mesh, Skeleton } from 'three';
import type { BoneName } from './bones';

/** doc 07 SS0.3, 25 joints, Mixamo-named, THIS ORDER. Every metric is computed on this set. */
export const CANONICAL_JOINTS = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftFistCenter',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightFistCenter',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;
export type CanonicalJoint = typeof CANONICAL_JOINTS[number];
export const CANONICAL_COUNT = 25 as const;
/** *FistCenter is virtual: 0.030 H beyond the wrist along the hand axis. doc 07 SS0.3. */
export const CANONICAL_FROM_BONE: Readonly<Record<CanonicalJoint, BoneName>>;

/** World-space snapshot at one tick. Metres. */
export interface Landmarks {
  readonly tick: number;
  readonly pos: Float32Array;      // CANONICAL_COUNT*3, world metres
  readonly quat: Float32Array;     // CANONICAL_COUNT*4, world, xyzw
  /** Extra non-canonical landmarks the solver and cloth need. */
  readonly heelL: Float32Array; readonly heelR: Float32Array;      // 3 each
  readonly toeTipL: Float32Array; readonly toeTipR: Float32Array;
  readonly ghL: Float32Array; readonly ghR: Float32Array;          // glenohumeral centres
  readonly comXZ: Float32Array;    // 2, whole-body COM projected to the floor
}

/** doc 06 SS7.6. **16** capsules (4 unmirrored + 6 mirrored pairs). Radii FracH.
 *  Doc 06 §7.6's summary row says 15, but its own table expands to 16 and §7.5's cost
 *  calculation uses 16 (988 x 16 x 8 = 126k tests/frame). Per §2.6 the table wins. */
export interface Capsule {
  readonly id: string;
  readonly a: BoneName; readonly b: BoneName | null;   // null => sphere at `a`
  readonly offsetA: readonly [number, number, number]; // FracH, bone-local
  readonly radiusH: number;
}
export const CAPSULES: readonly Capsule[];

export type GarmentPartId =
  | 'sleeve_L' | 'sleeve_R'
  | 'skirt_front_L' | 'skirt_front_R' | 'skirt_back'
  | 'trouser_L' | 'trouser_R'
  | 'obi_tail_L' | 'obi_tail_R';

/** A ring of vertices pinned to a bone. doc 06 SS7.3. */
export interface GiPinRing {
  readonly part: GarmentPartId;
  readonly bone: BoneName;
  /** Indices into the garment's own particle array. */
  readonly particles: readonly number[];
  /** Bone-local rest positions of those particles, FracH. */
  readonly restLocalH: Float32Array;    // particles.length*3
}

export interface RigHandles {
  readonly root: Group;                       // world/embusen anchor, on the floor
  readonly bones: readonly Bone[];            // BONE_ORDER order
  readonly byName: Readonly<Record<BoneName, Bone>>;
  readonly skeleton: Skeleton;
  readonly body: SkinnedMesh;
  readonly gi: Readonly<Record<'uwagi' | 'zubon' | 'collar' | 'obi', SkinnedMesh>>;
  readonly eyes: readonly [Mesh, Mesh];
  readonly hair: Mesh;
  readonly pinRings: readonly GiPinRing[];
}
```

### 3.11 `src/contracts/scorecard.ts`

```ts
import type { Unit } from './num';
import type { KataId, KataMove, Level, StanceId, TechniqueId } from './kata';

export type MetricGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type Verdict = 'pass' | 'warn' | 'fail' | 'fatal';
export type BlockId = 'B0'|'B1'|'B2'|'B3'|'B4'|'B5'|'B6'|'B7'|'B8'|'B9';
export type GateId = 'G-1'|'G-2'|'G-3'|'G-4'|'G-5'|'G-6'|'G-7'|'G-8'|'G-9'|'G-10'|'G-11';

/** 63 metrics: the 61 of doc 07 SS6.2 verbatim + 2 additions (SS7.3). VERBATIM string union. */
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
  | 'bone_length_drift_pct' | 'silhouette_IoU' | 'contact_shadow_present'
  // ADDED (SS7.3)
  | 'forearm_radius_retention' | 'hem_overshoot_H';

/** Where the reference VALUE came from. Enforced by tests/eval/precedence.test.ts (SS2.6). */
export type RefSource =
  | 'doc01' | 'doc02' | 'doc03' | 'doc04' | 'doc06' | 'doc07' | 'DERIVED_01_03' | 'PROJECT';

/** The critic -> fix mapping. This is the whole point of the architecture. */
export interface FixSite {
  readonly file: string;      // 'src/data/constants/stances.ts'
  readonly symbol: string;    // 'ZENKUTSU.S'
  /** A dotted path an agent can edit without reading the file first. */
  readonly knob: string;      // 'ZENKUTSU.S.v'
  readonly kind: 'constant' | 'move-override' | 'move-patch' | 'technique-keyframe'
               | 'channel-dynamics' | 'solver' | 'rig' | 'cloth' | 'render' | 'eval' | 'frozen';
  readonly block: BlockId;
  readonly hint: string;      // '+0.001 H in S ~ +0.19 % stance_len_H'
}

export interface MetricSpec {
  readonly id: MetricId;
  readonly group: MetricGroup;
  readonly unit: Unit;
  readonly ref: number;
  readonly refSource: RefSource;
  /** REQUIRED when refSource === 'DERIVED_01_03'. The arithmetic, as text. */
  readonly derivation?: string;
  readonly tol: number;               // from doc 07. |d| <= tol -> 100
  readonly hardFail: number;          // from doc 07. |d| >= hardFail -> 0
  readonly bound: 'both' | 'upperOnly' | 'lowerOnly';
  /** Per-stance / per-level / per-kata reference overrides. doc 07 SS6.2 alternate table. */
  readonly refByStance?: Readonly<Partial<Record<StanceId, { ref: number; tol: number; hardFail: number }>>>;
  readonly refByLevel?: Readonly<Partial<Record<Level, { ref: number; tol: number; hardFail: number }>>>;
  readonly refByKata?: Readonly<Partial<Record<KataId, { ref: number; tol: number; hardFail: number }>>>;
  readonly fatal: boolean;
  /**
   * FALSE means: score and report, but NEVER fail a gate. Used for metrics whose threshold is
   * admittedly invented until calibrated (metric 60 - doc 07 uncertainty 12). Flipping this to
   * true is an integrator commit that must cite the calibration report.
   */
  readonly armed: boolean;
  readonly weight: number;            // within-group, default 1
  readonly appliesTo: (m: KataMove) => boolean;
  readonly source: string;            // 'docs/research/07-reference-and-datasets.md SS6.2 G1#1'
  readonly fixSite: FixSite;
  /** doc 07 SS6.8 rubric ids this metric backs, e.g. ['A6']. */
  readonly rubric: readonly string[];
}

export interface MetricResult {
  readonly id: MetricId;
  readonly moveN: number;
  readonly tick: number;
  readonly camera: CameraPresetId | null;
  readonly value: number;
  readonly ref: number;
  readonly delta: number;             // signed, value - ref
  readonly deltaPct: number;          // signed % of ref
  readonly score: number;             // 0..100, doc 07 SS6.3 verbatim
  readonly verdict: Verdict;
  readonly armed: boolean;
  readonly fixSite: FixSite;
  readonly source: string;
  /** 'ZENKUTSU.S = 0.540 H +-0.040 [DERIVED] docs/research/01-stances.md SS3.1' */
  readonly provenance: string;
}

/** doc 01 SS9 (Z/K/B/Y/X families) and doc 03 SS11 (F family) as executable predicates. */
export interface CriticFinding {
  readonly tier: 'A' | 'B' | 'C';
  /** 'Z3' | 'X3' | 'F8' | 'A9' | a MetricId */
  readonly id: string;
  readonly moveN: number;
  readonly tick: number;
  readonly tSec: number;
  readonly camera: CameraPresetId | null;
  readonly observation: string;
  readonly suggestedFix: string;
  readonly fixSites: readonly FixSite[];    // most likely first
  readonly evidence: readonly string[];     // capture paths, relative to captures/<sha>/
  readonly source: 'metric' | 'fault' | 'vlm' | 'human';
}

export interface StepScore {
  readonly moveN: number;
  readonly label: string;
  readonly stance: StanceId;
  readonly tech: TechniqueId;
  readonly tick: number;
  readonly tSec: number;
  readonly groups: Readonly<Record<MetricGroup, number>>;
  /** 0.34*G1 + 0.30*G2 + 0.12*G3 + 0.14*G4 + 0.10*G5   (doc 07 SS6.3) */
  readonly score: number;
  readonly metrics: readonly MetricResult[];
  readonly faults: readonly CriticFinding[];
}

export interface FixQueueEntry {
  readonly fixSite: FixSite;
  readonly worst: MetricResult | null;
  readonly finding: CriticFinding | null;
  readonly affectedMoves: readonly number[];
  /**
   * Signed nudge in the CONSTANT'S OWN unit, or null when the sign is not determinable.
   * MUST be null whenever the metric's refSource is 'doc07' and an override exists (SS2.6) -
   * a delta that walks the rig away from docs 01/03 raises the score and lowers the quality.
   */
  readonly suggestedDelta: number | null;
  readonly rank: number;
}

export interface Scorecard {
  readonly schema: 'kata-scorecard/3';
  readonly kataId: KataId;
  readonly tempoTier: TempoTier;
  readonly gitSha: string;
  readonly trackHash: string;
  readonly contractHash: string;
  readonly threeRevision: string;      // '185'
  readonly generatedAt: string;
  readonly captureProfile: 'none' | 'fast' | 'hero';
  /** Recorded so a scorecard taken with non-default layer weights is never mistaken for release. */
  readonly layerWeights: Readonly<Record<LayerId, number>>;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly score: number;              // mean(StepScore.score)
  readonly steps: readonly StepScore[];
  readonly findings: readonly CriticFinding[];
  readonly channelC: {
    readonly mpjpe2dH: number; readonly pckH: number;
    readonly limbAngleMaeDeg: number; readonly matched: number;
  } | null;
  readonly gates: Readonly<Record<GateId, { readonly pass: boolean; readonly detail: string }>>;
  readonly bake: BakeStats;
  readonly determinism: { readonly seeksChecked: number; readonly mismatches: number };
  readonly perf: {
    readonly sampleUs: number; readonly frameMsP50: number;
    readonly frameMsP95: number; readonly frameMsP99: number;
    readonly drawCalls: number; readonly tris: number;
  } | null;
  readonly fixQueue: readonly FixQueueEntry[];      // worst-first, deduped by fixSite.file, <= 20
  readonly regression: {
    readonly baseSha: string;
    readonly deltas: readonly { id: MetricId; moveN: number; scoreDelta: number }[];
  } | null;
  readonly pass: boolean;
}
```

### 3.12 `src/contracts/services.ts` — the runtime seams

```ts
import type { LayerId, PoseFrame, PoseTrack, TrackMark } from './pose';
import type { Landmarks } from './rig';
import type { MetricResult, Scorecard } from './scorecard';

export interface Transport {
  readonly tick: number;                 // integer, TICK_HZ
  readonly rate: number;                 // -2 .. +2; 0 = paused
  readonly playing: boolean;
  readonly loop: { readonly t0: number; readonly t1: number } | null;
  advance(dtSeconds: number): number;    // returns the new integer tick
  seekTick(tick: number): void;
  seekMove(n: number, phase: TrackMark['kind']): void;
  stepDisplayFrames(n: number): void;    // +-DISPLAY_TICKS
  stepKeys(n: number): void;             // +-1 baked key in the current segment
  loopMove(n: number): void;
  clearLoop(): void;
  setRate(r: number): void;
  readonly marks: readonly TrackMark[];
}

/** A layer that CANNOT be baked. There is exactly one: the debug pose-poke. Never active in a run. */
export interface RuntimeLayer {
  readonly id: 'poke';
  readonly enabled: boolean;
  apply(frame: PoseFrame, tick: number): void;
}

export interface ClothSystem {
  /** Advance to `tick` from the current state. Consumes ImpulseEvents whose fire tick is crossed. */
  step(tick: number): void;
  /** Snapshot-restore + fixed-substep fast-forward. Deterministic given `track.hash`. */
  seek(tick: number, mode: 'exact' | 'preview'): void;
  /** Writes into the garment BufferAttributes via render/clothBridge. */
  upload(): void;
  reinit(tick: number): void;
  readonly stateHash: string;
  readonly particleCount: number;
}

export type CameraPresetId =
  | 'ORBIT' | 'HERO' | 'JUDGE' | 'LOW34' | 'FOLLOW' | 'EMBUSEN'
  | 'DETAIL_HANDS' | 'DETAIL_FEET'
  | 'M_FRONT' | 'M_LEFT' | 'M_RIGHT' | 'M_TOP';

export interface CameraRig {
  readonly active: CameraPresetId;
  /** Eased blend over 0.6 s. Interactive use only. */
  setPreset(id: CameraPresetId): void;
  /** Exact, no blend, resets the still accumulator. THE harness path. */
  snapTo(id: CameraPresetId): void;
  update(dtSeconds: number, landmarks: Landmarks): void;
  readonly camera: import('three').Camera;
}

export interface PostStack {
  setMode(mode: 'play' | 'still' | 'capture'): void;
  /** Progressive still accumulation: sample index k, pure function of k. Resets on any change. */
  resetStill(): void;
  readonly stillSample: number;     // 0..STILL_SAMPLES
  readonly stillConverged: boolean;
  render(dtSeconds: number): void;
  setSize(w: number, h: number, dpr: number): void;
  dispose(): void;
}

export interface ShotSpec {
  readonly tick: number;
  readonly moveN: number;
  readonly mark: TrackMark['kind'];
  readonly camera: CameraPresetId;
  readonly png: boolean;
  readonly silhouette: boolean;
  readonly strip: boolean;
  /** 'step-04_t07.750_kime_M_LEFT_hidari-chudan-oi-zuki_zenkutsu' */
  readonly name: string;
}

export interface RunInfo {
  readonly gitSha: string; readonly trackHash: string; readonly contractHash: string;
  readonly threeRevision: string; readonly tempoTier: TempoTier;
  readonly layerWeights: Readonly<Record<LayerId, number>>;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly bake: BakeStats;
  readonly diagnosticsWorst: PoseTrack['diagnostics']['worst'];
  readonly clothStateHash: string;
  readonly perf: Scorecard['perf'];
}

/** window.__KATA_HARNESS__ . The frozen boundary between the player (B6) and the critic (B9). */
export interface KataHarness {
  readonly ready: Promise<void>;
  readonly trackHash: string;
  listKata(): readonly string[];
  load(kataId: string, o?: { tempoTier?: TempoTier; quality?: 'low'|'high'|'max' }): Promise<void>;
  plan(): readonly ShotSpec[];
  marks(): readonly TrackMark[];
  /**
   * Seek then settle. `mode: 'exact'` replays cloth from the last snapshot at a fixed substep.
   * The capture driver calls this in MONOTONICALLY INCREASING tick order, so cloth advances
   * through the whole kata exactly ONCE per run, not once per shot.
   */
  seek(tick: number, o?: { mode?: 'exact' | 'preview' }): Promise<void>;
  setCamera(id: CameraPresetId): void;               // snapTo, never blends
  setLayerWeight(id: LayerId, w: number): void;      // look-dev only; see refuseNonDefault
  /** Renders until the still accumulator converges (STILL_SAMPLES frames). */
  settle(): Promise<void>;
  joints(): Landmarks;
  /** The 480 Hz canonical-joint stream for [fromTick, toTick]. CANONICAL_COUNT*3 f32 per frame. */
  streamJoints(fromTick: number, toTick: number): ArrayBuffer;
  streamChannels(fromTick: number, toTick: number): ArrayBuffer;
  /** In-page metric pass. Identical code to the Node path (src/eval is GL-free). */
  metrics(moveN: number): readonly MetricResult[];
  scorecard(): Scorecard;
  shot(): string;                                    // dataURL, PNG of the live canvas
  silhouette(): string;                              // dataURL, white-on-black mask
  strip(moveN: number, cam: CameraPresetId): string; // [ours | ref stick | overlay | absdiff]
  runInfo(): RunInfo;
  /** TRUE unless every layer weight is exactly its defaultWeight. Capture ABORTS when true. */
  readonly layerWeightsDirty: boolean;
}
```

### 3.13 Module boundary signatures — the only cross-block calls

Every entry below is exported from the owning block's `index.ts` barrel. Nothing else crosses a
block boundary.

```ts
// ---- B1 NUMBERS -> everyone -------------------------------------------------
export const ANTHRO: Readonly<Record<string, Num>>;
export const JOINT_Y: Readonly<Record<string, Num>>;      // bind-pose heights, FracH
export const LIMB_R: Readonly<Record<BoneName, Num>>;     // capsule/mesh radii, FracH
export const SEG_MASS: Readonly<Record<string, Num>>;     // fraction of body mass
export const STANCES: Readonly<Record<StanceId, StanceSpec>>;
export const FIGHT_PELVIS_Y: Num;                         // 0.410 H
export function mirrorStance(s: StanceSpec, side: Handedness): StanceSpec;
export const TECHNIQUES: Readonly<Record<string, TechniqueSpec>>;   // key: `${id}-${level}`
export const HIKITE_HIP_A: TechniqueSpec;
export const HIKITE_TATE_B: TechniqueSpec;
export const TARGET_H: Readonly<Record<Level, Num>>;
export const HAND_SHAPE_ANGLES: Readonly<Record<HandShape, Readonly<Record<BoneName, readonly [number,number,number]>>>>;
export const DYN: Readonly<Record<string, TechniqueDynamics>>;
export const CHANNEL_DYN: Readonly<Record<ChannelId, ChannelDyn>>;
export const SETTLE: Readonly<Record<'fist'|'elbow'|'pelvis'|'thorax'|'head'|'comY'|'kneeF'|'obi',
                                     { omegaN: Num; zeta: Num; ampFracL: Num }>>;
export const TEMPO_CLASSES: Readonly<Record<TempoClass, { tHold: Num; tPrep: Num; tTransit: Num; tKime: Num }>>;
export const PAUSE_CLASSES: Readonly<Record<PauseClass, Num>>;
export const ROM: Readonly<Record<BoneName, RomLimit>>;
export const CLOTH: Readonly<Record<string, Num>>;
export const GARMENTS: readonly { part: GarmentPartId; cols: number; rows: number;
                                  particles: number; approach: 'skin'|'xpbd' }[];
export const LIGHTS: Readonly<Record<'key'|'rim'|'fill'|'cross', {
  posM: readonly [number,number,number]; intensity: Num; colorHex: number; castShadow: boolean }>>;
export const SHADOW: Readonly<Record<string, Num>>;
export const POST: Readonly<Record<string, Num>>;
export const MATERIAL_PARAMS: Readonly<Record<string, Readonly<Record<string, Num>>>>;
export const ENV: Readonly<Record<string, Num>>;
export const CAMERA_PRESET_PARAMS: Readonly<Record<CameraPresetId, CameraPresetParams>>;
/** L and EMB_H are DERIVED here, never authored. */
export const L_H: number; export const L_M: number; export const EMB_H_H: number;
export const ZENKUTSU_HEEL_TO_HEEL_H: number;
export const PELVIS_AHEAD_OF_C_H: Readonly<Record<StanceId, number>>;
export function footPlanFor(prev: FootPlan | null, m: KataMove, patch: MovePatch): FootPlan;
export function embusenPolyline(k: KataScore): readonly EmbXZ[];
export function assertEmbusenInvariants(k: KataScore): void;

// ---- B2 KATA -> B3, B9 ------------------------------------------------------
export const KATA: Readonly<Record<KataId, KataScore>>;
export function getKata(id: KataId): KataScore;
export function getPatch(id: KataId, n: number): MovePatch;
export function validateKata(k: KataScore): void;        // throws with the failing invariant name

// ---- B3 SOLVER -> B6, B9 (the ONE entry point) ------------------------------
export interface CompileOpts {
  readonly tempoTier: TempoTier;
  /** Bitmask over STAGES. Debug bisection only; a non-full mask sets flags.stageMask in run.json. */
  readonly stageMask?: number;
  readonly codeVersion: string;
}
export function compileKata(k: KataScore, o: CompileOpts): PoseTrack;
export const STAGES: readonly { readonly id: string; readonly bit: number; readonly desc: string }[];
export function trackHash(k: KataScore, patches: readonly MovePatch[], o: CompileOpts): string;
/** Compile-time only. Exposed so B9 can build the Channel-B reference figure with the same IK. */
export function solveTwoBone(a: TwoBoneArgs, out: TwoBoneOut): number;   // returns residual, metres
export function toWorld(v: readonly [number,number,number]): [number,number,number];
export function toWorldYawDeg(authoredDeg: number): number;

// ---- B4 RIG -> B5, B6, B7, B9 ----------------------------------------------
export function buildKarateka(mats: MaterialSet): RigHandles;
export function sampleLandmarks(rig: RigHandles, tick: number, out: Landmarks): void;
export function buildCapsules(rig: RigHandles): CapsuleSet;
export function updateCapsules(rig: RigHandles, set: CapsuleSet): void;
export function boneAABB(rig: RigHandles, out: Box3): Box3;

// ---- B5 RENDER -> B6 -------------------------------------------------------
export function createRenderer(canvas: HTMLCanvasElement, o: { harness: boolean }): WebGLRenderer;
export function buildEnvironment(r: WebGLRenderer, s: Scene): IblHandle;
export function buildLights(s: Scene): LightRig;
export function refitShadow(rig: RigHandles, light: DirectionalLight, cam: Camera): void;
export function createMaterials(): MaterialSet;
export function buildStage(s: Scene, m: MaterialSet): StageHandle;
export function buildPost(r: WebGLRenderer, s: Scene, c: Camera): PostStack;
export function renderSilhouette(r: WebGLRenderer, s: Scene, c: Camera): ImageData;
export function uploadCloth(rig: RigHandles, cloth: ClothSystem): void;
export function buildOverlay(s: Scene): OverlayHandle;

// ---- B6 PLAYER -------------------------------------------------------------
export function createTransport(track: PoseTrack): Transport;
export function createSampler(track: PoseTrack): PoseSource;
export function applyPose(rig: RigHandles, f: PoseFrame): void;
export function createCameraRig(): CameraRig;
export function bootApp(o: BootOpts): Promise<AppHandle>;
export function installHarness(app: AppHandle): KataHarness;

// ---- B7 CLOTH -> B5, B6 ----------------------------------------------------
export function createClothSystem(o: {
  layouts: readonly GarmentLayout[]; pinRings: readonly GiPinRing[];
  capsules: CapsuleSet; impulses: readonly ImpulseEvent[]; seed: string;
}): ClothSystem;
export function buildGarments(rig: RigHandles): readonly GarmentLayout[];
/** doc 06 SS7.5 calibration gate. Returns the free-edge droop in metres. */
export function swatchDroopM(alphaBend: number): number;

// ---- B9 CRITIC -> B6 -------------------------------------------------------
export const METRICS: readonly MetricSpec[];               // 63
export function computeMetrics(stream: JointStream, track: PoseTrack, moveN: number): readonly MetricResult[];
export function detectFaults(stream: JointStream, track: PoseTrack): readonly CriticFinding[];
export function scoreRun(results: readonly MetricResult[], f: readonly CriticFinding[], meta: ScoreMeta): Scorecard;
export const GATES: readonly { id: GateId; test: (s: Scorecard) => { pass: boolean; detail: string } }[];
export function buildCapturePlan(track: PoseTrack, k: KataScore): readonly ShotSpec[];
export function buildReferencePose(k: KataScore, n: number): Landmarks;
export function renderOverlaySvg(ours: Landmarks, ref: Landmarks, cam: CameraPresetId): string;
export function silhouetteIou(a: ImageData, b: ImageData): number;
export function blame(id: MetricId | string): readonly FixSite[];
```

---

## 4. Module map — exact file paths

Ownership, definitions of done and verification live in `docs/OWNERSHIP.md`. This section is the
complete file inventory. Nothing may be created that is not listed here; a new file requires an
integrator commit that adds a row to both documents.

### 4.0 `B0 CONTRACTS` — Phase 0, then frozen

```
src/contracts/units.ts
src/contracts/time.ts
src/contracts/ease.ts
src/contracts/bones.ts
src/contracts/num.ts
src/contracts/kata.ts
src/contracts/pose.ts
src/contracts/rig.ts
src/contracts/scorecard.ts
src/contracts/services.ts
src/contracts/index.ts
tests/contracts/imports.test.ts          no deep cross-block imports; three-import allowlist;
                                         Math.random/Date.now/performance.now ban
tests/contracts/freeze.test.ts           content hash of all 11 contract files
tests/contracts/bones.test.ts            BONE_COUNT===52, parents precede children, L/R twins,
                                         6 chain-closure lengths of doc 06 §4.2 to 1e-6 H
tests/contracts/handedness.test.ts       the 3 assertions of §2.1 — RED FIRST
tests/contracts/bake-error.test.ts       reconstruct doc 03 §4.3's roll from a baked track;
                                         assert maxSlerpErrDeg<0.25 AND maxStepDeg<=12 — RED FIRST
tests/contracts/tickrate.test.ts         17 ms hikite lead, 10–20 ms crack delay, 25–35 ms pelvis
                                         sink and T_thrust=0.13 s all survive quantisation — RED FIRST
tests/contracts/seek-purity.test.ts      sample(t) is bitwise identical from cold seek, forward
                                         play and reverse seek, at 512 sampled ticks — RED FIRST
tests/contracts/ease.test.ts             S(0)=0, S(1)=1, S'(0)=S'(1)=0, S(0.5)<0.30 at tauP=0.73,
                                         kimeEaseAcc === numeric d²S/dτ² to 1e-6
```

### 4.1 `B1 NUMBERS`

```
src/data/num.ts                          Num, AltNum, N(), flat(), fmtNum()
src/data/constants/anthro.ts             ANTHRO, JOINT_Y, LIMB_R, SEG_MASS  (01 §1, 06 §1–§2, 07 §0.2)
src/data/constants/stances.ts            STANCES, FIGHT_PELVIS_Y, mirrorStance  (01 §10)
src/data/constants/techniques.ts         TECHNIQUES, HIKITE_HIP_A, HIKITE_TATE_B, TARGET_H,
                                         HAND_SHAPE_ANGLES  (03 §4–§13, 02 §1.2–§1.3)
src/data/constants/dynamics.ts           DYN, CHANNEL_DYN, SETTLE, TEMPO_CLASSES, PAUSE_CLASSES,
                                         TEMPO_SCALE  (04 §5, §6, §10, §11, 02 §1.4)
src/data/constants/rom.ts                ROM  (06 §3.1)
src/data/constants/cloth.ts              CLOTH, GARMENTS  (06 §7.1, §7.3, §7.5)
src/data/constants/render.ts             LIGHTS, SHADOW, POST, MATERIAL_PARAMS, ENV  (05 §5–§8, §11)
src/data/constants/camera.ts             CAMERA_PRESET_PARAMS  (07 §6.6 + §5.7 here)
src/data/constants/DISPUTED.md           the 14 live disputes; human-owned prose
src/data/embusen.ts                      L_H, L_M, EMB_H_H, ZENKUTSU_HEEL_TO_HEEL_H,
                                         PELVIS_AHEAD_OF_C_H, R0–R5, footPlanFor,
                                         embusenPolyline, assertEmbusenInvariants  (02 §3)
src/data/index.ts                        barrel
tests/data/constants.test.ts             every Num has a resolvable src; units match field suffixes
tests/data/derived.test.ts               L===ZENKUTSU.S.v; EMB_H===HACHIJI.W.v/2;
                                         ZENKUTSU_HEEL_TO_HEEL_H===0.533±5e-4 by the §2.3 formula;
                                         PELVIS_AHEAD_OF_C_H per stance
tests/data/embusen.test.ts               the 7 invariants of 02 §11 + σ-symmetry + closure<0.01 L
tests/data/proportions.test.ts           head 0.130 H ⇒ 7.7 heads (doc 07 §4 anti-heroic gate)
```

### 4.2 `B2 KATA`

```
src/data/kata/taikyoku-shodan.kata.ts    20 moves + ceremony  (02 §4.1, §4.2, §2)
src/data/kata/heian-shodan.kata.ts       21 moves + ceremony  (02 §6.1, §6.2, §2)
src/data/kata/ceremony.ts                CEREMONY_OPEN / CEREMONY_CLOSE builders  (02 §2)
src/data/kata/validate.ts                validateKata  (02 §11)
src/data/kata/index.ts                   KATA, getKata, getPatch, KataId re-export
src/data/patches/index.ts                PATCHES registry: 41 explicit imports, written ONCE in P1
src/data/patches/taikyoku-shodan/move-01.ts … move-20.ts     20 files
src/data/patches/heian-shodan/move-01.ts … move-21.ts        21 files
tests/kata/taikyoku.test.ts              heading chain, ff recomputation, kiai at [8,16],
                                         fast pairs [[7,8],[15,16]], Σ tSlot 35.25 ±20 %
tests/kata/heian.test.ts                 heading chain incl. 45/315 diagonals, kiai at [9,17],
                                         move 4 is the only R0, kokutsu on 18–21,
                                         Σ tSlot 39.75 ±20 %
tests/kata/patches.test.ts               all 41 modules exist, default-export MovePatch,
                                         non-empty patch implies non-empty reason
```

### 4.3 `B3 SOLVER`

```
src/solve/frame.ts                       THE handedness boundary: toWorld, toWorldYawDeg,
                                         worldFacing, sideSign re-export
src/solve/skeleton.ts                    BIND: BoneDef[], boneOffset, restWorld  (06 §4.1–§4.2)
src/solve/twoBoneIK.ts                   solveTwoBone: soften s=0.97, limit folded into step 2,
                                         pole plane, two swings  (06 §6.1)
src/solve/swingTwist.ts                  splitSwingTwist, clampSwingTwist elliptic cone  (06 §3.2)
src/solve/stance.ts                      solveStance(spec, footPlan) → {pelvis, legQuats}  (01 §3–§7)
src/solve/arm.ts                         solveArm, solveHikite, clavicleRhythm, poleFor  (03, 06 §6.2)
src/solve/hand.ts                        HAND_POSES, solveHand  (03 §12)
src/solve/com.ts                         bodyCOM, solveCOM: 3 iterations, gain 0.90  (06 §2.2)
src/solve/spine.ts                       solveSpineWhip, solvePelvisTilt  (06 §6.4 L2)
src/solve/gaze.ts                        solveGaze + blink schedule, baked  (06 §6.5)
src/solve/footPlant.ts                   buildPlantPlan, applyPlantLock (pivot-about-point)  (06 §6.3)
src/solve/timeline.ts                    buildTimeline → Slot[] with integer tick windows
src/solve/keyposes.ts                    buildKeyPoses → PoseKey[] at start/prep/mid/kime/hold
src/solve/channels.ts                    channelAlpha, channelVel, channelAcc  (04 §11)
src/solve/bake.ts                        adaptive piecewise-uniform bake; PoseSegment planner;
                                         maxSlerpErrDeg / maxStepDeg measurement
src/solve/layers.ts                      delta-layer construction by inversion; worst-case
                                         chest-yaw envelope check
src/solve/impulses.ts                    ImpulseEvent extraction from the ANALYTIC channels
src/solve/diagnostics.ts                 SolveDiagnostics accumulation
src/solve/stageAssert.ts                 per-stage admissibility invariants (§4.11)
src/solve/compile.ts                     compileKata, STAGES — the ONE entry point
src/solve/hash.ts                        trackHash (fnv1a-64)
src/solve/index.ts                       barrel
tests/solve/stances.test.ts              reproduce every 01 §10 constant from the solve;
                                         COM_y/H − 0.568 < 0.008; front knee 57 ±1 at S=0.540
tests/solve/kokutsu.test.ts              01 §4.3: kokutsu cannot be as long as zenkutsu at equal height
tests/solve/ik.test.ts                   |C′−T| < 1e-9 in range; every 03 §13.1 law-of-cosines row
tests/solve/plant.test.ts                plant residual < 0.002 L across every pivot in both kata
tests/solve/bake.test.ts                 G-9a/b/c on both kata; segment planner monotone; recompose
                                         error < 1e-4 deg
tests/solve/stages.test.ts               every stage's output is admissible input to the next
tests/solve/repeat.test.ts               compileKata twice → byte-identical q, rootPos, chan, hash
```

### 4.4 `B4 RIG`

```
src/rig/bones.ts                         buildSkeleton: 52 Bones, T-pose build → A-pose rebake (06 §4.1)
src/rig/bodyMesh.ts                      buildBodyGeometry: swept-ring limbs, cube-sphere head,
                                         junction patches, ~3.9 k verts  (06 §5.1–§5.2)
src/rig/skinWeights.ts                   computeSkinWeights: the 7 steps of 06 §5.3; rigidify
src/rig/giMesh.ts                        buildGiGeometry: uwagi/zubon/collar/obi + the inner shell
                                         of §5.5; analytic UV; GiPinRing[]
src/rig/tangents.ts                      analytic itemSize-4 tangents with handedness w  (§2.7)
src/rig/textures.ts                      makeWeaveNormal, makeCreaseMap, makeFloorMaps,
                                         makeHeadAlbedo, makeEyeTexture — CanvasTexture/DataTexture only
src/rig/karateka.ts                      buildKarateka: the SkinnedMesh assembly  (05 §9.4)
src/rig/landmarks.ts                     sampleLandmarks: the 25 canonical joints + virtuals
src/rig/capsules.ts                      buildCapsules, updateCapsules, boneAABB  (06 §7.6)
src/rig/index.ts                         barrel
tests/rig/closure.test.ts                bind-pose chain closure; bone_length_drift 0 at bind
tests/rig/weights.test.ts                sum=1±1e-4; no vertex with 5 influences; no ribcage weight
                                         outside the torso band
tests/rig/scale.test.ts                  ribcage is childless; no other bone ever scales  (§2.8)
tests/rig/tangents.test.ts               itemSize 4, |w|=1, |T|=1, T·N ≈ 0  (§2.7)
tests/rig/candywrapper.test.ts           CPU-skin a mid-forearm ring at 180° roll;
                                         radius retention ≥ 0.97  (metric 62)
```

### 4.5 `B5 RENDER`

```
src/render/renderer.ts                   createRenderer: the exact ctor + settings of 05 §3/§15
src/render/dojoEnv.ts                    buildDojoEnvScene: the procedural PMREM source scene
src/render/ibl.ts                        buildEnvironment: PMREMGenerator.fromScene, keeps the RT
src/render/lights.ts                     buildLights: KEY/RIM/FILL/CROSS + scene.add(target)
src/render/shadow.ts                     configureShadow, refitShadow: Mode B + light-space texel snap
src/render/materials.ts                  createMaterials: the 10 materials. NO onBeforeCompile.
                                         NO ShaderMaterial in the scene graph.
src/render/stage.ts                      buildStage: floor, backdrop shell, embusen decal plane
src/render/post.ts                       buildPost: the exact chain of §5.2
src/render/still.ts                      StillAccumulator: OUR Halton jitter + additive resolve (§5.3)
src/render/silhouette.ts                 renderSilhouette: scene.overrideMaterial white-on-black
src/render/clothBridge.ts                uploadCloth: cloth typed arrays → BufferAttributes
src/render/overlay.ts                    buildOverlay: skeleton, COM, support polygon, embusen trace
src/render/index.ts                      barrel
tests/render/config.test.ts              GL-free: the pass-order array; every MATERIAL_PARAMS field
                                         lands on the right material property; no material.envMap set
tests/render/bans.test.ts                greps src/ for onBeforeCompile, material.envMap,
                                         PCFSoftShadowMap, new Clock(, FXAAPass, TAARenderPass,
                                         DoubleSide
tests/render/still.test.ts               Halton(2,3) sample k is a pure function of k; the 32-sample
                                         offset set sums to (0,0) within 1e-9
```

### 4.6 `B6 PLAYER`

```
index.html                               canvas + overlay roots + ?harness=1 detection
src/main.ts                              entry; URL params
src/player/transport.ts                  createTransport: integer-tick clock, rate, seek, marks, loop
src/player/sampler.ts                    createSampler: segment locate + 2-frame slerp + layer compose
src/player/poseApply.ts                  applyPose: 52 local quats + root + ribcage scale
src/player/layerWeights.ts               the weight vector, its bounds, and layerWeightsDirty
src/player/pokeLayer.ts                  the ONLY RuntimeLayer; debug; disabled in harness mode
src/player/cameraRig.ts                  createCameraRig, the 12 presets, damped blends, snapTo
src/player/loop.ts                       startLoop: the frame function, setAnimationLoop, bench hooks
src/player/app.ts                        bootApp: composition root; the only file importing every barrel
src/player/harness.ts                    installHarness: window.__KATA_HARNESS__
tests/player/transport.test.ts           integer arithmetic, mark snapping, loop wrap, reverse
tests/player/sampler.test.ts             sample() allocates nothing across 10 000 calls;
                                         w=1 composition === compiled pose to 1e-4 deg
tests/player/seek.test.ts                cold seek === play-through === reverse seek, bitwise,
                                         at 512 ticks per kata, for all 52 bones + root
```

### 4.7 `B7 CLOTH`

```
src/cloth/xpbd.ts                        XpbdSolver: typed arrays, 8 substeps, 1 iter/substep,
                                         λ reset per substep  (06 §7.4)
src/cloth/constraints.ts                 distance / shear / dihedral bend / attach / LRA / unilateral
src/cloth/garments.ts                    buildGarments: 988 particles  (06 §7.3)
src/cloth/giShell.ts                     the 0.63 mm inner shell generator  (§5.5)
src/cloth/collide.ts                     per-particle whitelist + per-frame AABB broad-phase escape
src/cloth/impulseQueue.ts                ImpulseEvent consumption: fires exactly once per event
src/cloth/snapshots.ts                   SnapshotStore: 23.7 kB rings, snapshotAt, nearestBefore
src/cloth/wrinkle.ts                     per-vertex compression + asymmetric hysteresis
src/cloth/system.ts                      createClothSystem: step/seek/upload/reinit, stateHash
src/cloth/index.ts                       barrel
tests/cloth/swatch.test.ts               THE CALIBRATION GATE: 0.20 m swatch, 3 cm grid, clamped
                                         edge, settle 2 s, free edge droops 7.5 ±1.5 cm  (06 §7.5)
tests/cloth/alloc.test.ts                stable heap across 600 steps
tests/cloth/tunnel.test.ts               11 m/s sweep vs a 4.9 cm capsule; no penetration
tests/cloth/impulse.test.ts              each ImpulseEvent fires exactly once, at exactly
                                         e.tick + e.crackDelayTicks, forward AND after a seek
tests/cloth/determinism.test.ts          seek(t,'exact') twice → identical stateHash
```

### 4.8 `B8 UI`

```
src/ui/timeline.ts                       scrub bar, per-move ticks, T_prep/T_tech/T_kime/T_hold
                                         bands, kiai flags, drag → seek, loop-a-move
src/ui/labels.ts                         move card: count / romaji / kanji / EN / stance / level
src/ui/gui.ts                            lil-gui: kata, tempo tier, rate, camera, quality, stage mask
src/ui/look.ts                           the LOOK + LAYERS + DISPUTES folders: live material/light
                                         knobs, live layer gains, one A/B toggle per disputeId
                                         (answers judge 1 fatal A3)
src/ui/hud.ts                            transport buttons, rate readout, frame-time/bench readout,
                                         a persistent red badge whenever layerWeightsDirty
src/ui/theme.css                         styles
src/ui/index.ts                          barrel
tests/ui/timeline.test.ts                tick ↔ pixel mapping is exact and invertible
tests/ui/dirty.test.ts                   moving any layer weight off default raises the badge
```

### 4.9 `B9 CRITIC`

```
src/eval/joints.ts                       toCanonical, JointStream reader/writer
src/eval/metricSpecs.ts                  METRICS: the 63 MetricSpecs, each with refSource + fixSite
src/eval/referenceBank.ts                loads + validates data/reference/*.ref.json
src/eval/metrics.ts                      computeMetrics — pure, three math classes only
src/eval/faults.ts                       01 §9 (Z/K/B/Y/X) + 03 §11 (F) as executable predicates
src/eval/score.ts                        scoreMetric/Group/Step/Kata verbatim + GATES G-1…G-11
src/eval/plan.ts                         buildCapturePlan → ShotSpec[], sorted by tick
src/eval/refStick.ts                     Channel B: buildReferencePose by analytic IK
src/eval/overlaySvg.ts                   Channel B draw: stick + envelope + agreement zones
src/eval/silhouette.ts                   silhouetteIou on two ImageDatas
src/eval/panel.ts                        composePanel: the 4-panel strip + abs-diff heatmap, in-page
src/eval/pd1925.ts                       Channel C: posture-matched PD plates → MPJPE / PCK / MAE
src/eval/fileMap.ts                      BLAME_MAP: MetricId | FaultId → FixSite[]
src/eval/report.ts                       renderScorecardMd, renderFixQueue, diffRuns
src/eval/index.ts                        barrel
data/reference/taikyoku-shodan.ref.json  hand-authored from 01/03/02 + doc 07 tolerances
data/reference/heian-shodan.ref.json
data/reference/overrides.md              every doc-07 override, both values, the argument
assets/reference/pd-1925/PROVENANCE.md   file name, Commons URL, licence tag, original source
assets/reference/pd-1925/*.png           the 16 PD Funakoshi plates
assets/reference/pd-1925/*.joints.json   17 hand-annotated 2-D joints per plate
assets/reference/pd-1925/posture-match.json  plate → (technique, stance, side) → our nearest step
tools/ssr.mjs                            boots Vite in middleware mode; ssrLoadModule for TS entries
tools/browser.mjs                        Playwright launch + ?harness=1 + waitForHarness
tools/build-track.mjs                    headless compile of both tracks; writes reports/track-*.json
tools/score.mjs                          NODE-ONLY numeric pass: compile → joints → metrics → gates
tools/capture.mjs                        the pixel pass; --profile fast|hero; monotonic single cloth pass
tools/contactsheet.mjs                   strips + contact sheet + floor trace, composed in-browser
tools/criticPrompt.mjs                   reports/<sha>/critic-<kata>-<tier>.md, VLM prompt pre-filled
tools/critic.mjs                         the orchestrator; exit code = gates
tools/fix-route.mjs                      fixqueue.json → routed.json, grouped by fixSite.file
tools/verify-constants.mjs               greps each Num.src doc section for the literal value
tools/verify-reference.mjs               same, for every ref-bank entry; enforces the §2.6 overrides
tools/verify-contracts.mjs               contract hashes + the banned-construct greps
tools/verifyDeterminism.mjs              200 random seek sequences per kata; hashState equality
tools/verifyOwnership.mjs                changed paths → block; fails any commit spanning blocks
tools/calibrate-envelope.mjs             fits the Channel-B capsule radii, then arms metric 60
tools/verify-all.mjs                     runs the five verifiers above; one exit code
tools/bench.mjs                          600-frame frame-time histogram, p50/p95/p99
tools/probe-webgl.mjs                    EXISTS — the SwiftShader flag set, proven
tests/eval/metrics.test.ts               every metric against a hand-built pose with a known answer
tests/eval/perfect.test.ts               a hand-written perfect pose scores exactly 100
tests/eval/precedence.test.ts            the 8 mandatory overrides of §2.6
tests/eval/derivedRefs.test.ts           recompute every DERIVED_01_03 reference
tests/eval/fixsites.test.ts              every fixSite.file exists and exports fixSite.symbol
tests/eval/faults.test.ts                every 01 §9 / 03 §11 predicate fires on a synthetic fault
tests/integration/pipeline.test.ts       compile → solve → joints → metrics → gates, Node, NO GL
tests/integration/repeatability.test.ts  two full Node runs at one sha are byte-identical
tests/e2e/boot.spec.ts                   boots, renders, zero console errors, real WebGL2
tests/e2e/scrub.spec.ts                  app-level scrub determinism; the 8 ms preview budget
```

### 4.10 Orchestrator-only

```
package.json  tsconfig.json  vite.config.ts  vitest.config.ts  .gitignore
docs/ARCHITECTURE.md  docs/OWNERSHIP.md  docs/CONTRACT-CHANGELOG.md
docs/critic/rubric.md  docs/critic/routing.md
docs/research/**    (read-only reference; never edited)
docs/proposals/**   (historical; never edited)
```

### 4.11 The 16 compile stages and their exit invariants (`src/solve/stageAssert.ts`)

Each stage is a pure `(input, Ctx) => output` and each can be individually disabled by a bit in
`CompileOpts.stageMask` — that is how an agent bisects "the pose is wrong but I do not know which
stage". **After every stage, `assertStageInvariant(id, track)` runs.** A stage mask that is not full
sets `flags.stageMask` in `run.json` and makes every gate advisory.

| # | stage | source | invariant asserted on exit |
|---|---|---|---|
| S0 | `validateKata` | 02 §11 | 7 invariants, σ-symmetry, closure < 0.01 L, Σ tSlot ±20 %, kiai indices, every `c` inside the bbox |
| S1 | `buildTimeline` | 02 §1.4, 04 §6.2–6.3 | every window is a non-empty integer tick range; windows contiguous and non-overlapping; `tempoScale` touched only `T_prep`/`T_hold` |
| S2 | `footPlanFor` | 02 §3.1 | pivot-foot XZ drift ≤ 0.02 L; recomputed `ff` matches the authored `ff` to 1e-9 L |
| S3 | `solveStance` | 01 §3–§7 | `pelvisY` equals its input to 1e-9 (bobbing is structurally impossible); both ankles on plan to 1e-6 m; front-knee flex within `ROM` |
| S4 | `solveArm`+`solveHikite`+`solveHand` | 03 §4–§13 | endpoint residual < 0.005 m at every kime; `|F| ≤ 0.381 H` (MCP2) / `≤ 0.362 H` (fist centre); elbow included angle within ±5° of `elbowIncludedDeg` |
| S5 | `buildKeyPoses` | — | exactly one key per phase per slot; ticks strictly increasing |
| S6 | `channelAlpha` wiring | 04 §11 | `lead(rearFootDrive) > lead(pelvisYaw) > lead(thoraxYaw) ≥ lead(shoulderGirdle) > lead(elbowExtend) > lead(wristLock) > 0`; **plus** `TAUP_MONOTONE_CHAIN` and the min/span form documented on `CHANNEL_ORDER`. **NOT pointwise `tauP` monotonicity** — doc 04 §11's own table violates that at 4 of its 8 steps, so asserting it would fail against the source data. Corrected in the Phase-0 audit. |
| S7 | `layerHipDrive` | 01 §8.3, 04 §2 | `|ψ(0.5) − ψ_start| ≤ 8°` for every move — the X3 predicate made structural; 90 % of Δψ done by τ = 0.92 |
| S8 | `layerSpineWhip` | 06 §6.4 L2 | X-factor `|yaw(shoulder) − yaw(pelvis)| ≤ 15°` at every tick (04 §2.1) |
| S9 | `solveCOM` | 06 §2.2 | converges in ≤ 3 iterations; `|comXZ − target| ≤ 0.002 H` |
| S10 | `layerHelpers` | 06 §5.4 | twist sums to the source roll to 1e-6; deltoid/clavicle within `ROM` |
| S11 | `solveGaze` | 06 §6.5 | chain weights sum to 1.0; eye residual within `ROM.eye`; blink never overlaps a kime ±0.15 s |
| S12 | `clampSwingTwist` | 06 §3.1–3.2 | every bone inside `ROM`; `clampSat` recorded per move |
| **S12.5** | `applyPlantLock` + **one** corrective leg-IK pass | 06 §6.4 L9-vs-IK | **runs AFTER the clamp**, because a clamp that moves an ankle silently breaks a plant lock an earlier stage already committed (judge 3 fatal A12). Asserts planted-foot XZ drift ≤ 1e-4 m; re-records the leg residual. Never loops to convergence. |
| S13 | `bakeSegments` | §2.4 | G-9a `maxSlerpErrDeg < 0.25`; G-9b `maxStepDeg ≤ 12`; segments contiguous, ascending, each `startTick % ticksPerFrame === 0` |
| S14 | `buildLayers` | §3.9 | recompose error at `w = 1` < 1e-4°; worst-case chest yaw over the **whole legal weight box** ≤ 17° |
| S15 | `buildImpulses` | 04 §9.1 | exactly one `limb-stop` event per acting limb per move; every `crackDelayTicks ∈ [38, 77]`; G-9c |
| S16 | `emitTrack` + `trackHash` | — | buffers frozen; `marks` ascending; `hash` reproducible |

Measured target: **≤ 220 ms** per kata (the extra ladder rungs cost ~70 ms over Proposal A's 150 ms
estimate). Under Vite HMR, editing `ZENKUTSU.S` recompiles and re-applies at the current tick in
**≤ 320 ms**, without losing the scrub position.

---

## 5. Render pipeline

### 5.1 Boot order (05 §15, with our numbers)

```
WebGLRenderer({ canvas, antialias:false, alpha:false, stencil:false, depth:true,
                powerPreference:'high-performance',
                reversedDepthBuffer:false,                 // 05 §14.1 #7: PCF has no reversed-depth guard
                preserveDrawingBuffer: HARNESS })          // harness only, 05 §3
setPixelRatio(min(devicePixelRatio, 2))  ·  setSize(w, h)
toneMapping = AgXToneMapping ; toneMappingExposure = 1.0   // NEVER touch outputColorSpace
shadowMap.enabled = true ; shadowMap.type = PCFShadowMap   // NEVER PCFSoftShadowMap (05 §14.1 #1)
scene.environment = PMREM.fromScene(dojoEnv, 0.04, 0.1, 40, {size:512, position:(0,0.9625,0)})
scene.environmentIntensity = 0.85 ; scene.environmentRotation = Euler(0, -0.35, 0)
scene.background = Color(0x0e0f12)                          // never the raw PMREM
lights ; scene.add(key.target) ; configureShadow(key)
karateka: frustumCulled = false ; castShadow = true
floor: receiveShadow = true ; castShadow = false            // prevents floor-vs-floor acne
composer = new EffectComposer(renderer)                     // HalfFloatType default
await renderer.compileAsync(scene, camera)
renderer.setAnimationLoop(frame)
```

`pmrem.dispose()` frees the generator, **not** the render target — keep the RT and dispose it on
teardown (05 §14.1 #29). Exactly one `PMREMGenerator` instance ever exists (#30). `Timer`, never
`Clock` (deprecated r183).

### 5.2 Exact pass order — hard constraints, not opinion (05 §8.4)

```
[1] RenderPass(scene, camera)                                        ALWAYS. Never TAARenderPass.
[2] GTAOPass(scene, camera, w, h, params, aoParams, pdParams)         linear HDR
[3] BokehPass(scene, camera, {focus, aperture:0.0018, maxblur:0.006}) cinematic mode only
[4] UnrealBloomPass(new Vector2(w,h), 0.22, 0.55, 0.92)               must see pre-tonemap HDR
[5] SMAAPass()                                                        linear-srgb, BEFORE OutputPass
[6] OutputPass()                                                      MANDATORY: tonemap + sRGB
[7] LUTPass({lut, intensity})                                         optional grade, off by default
```

`SMAAPass` and `FXAAPass` sit on opposite sides of `OutputPass` and are mutually exclusive; we ship
SMAA and **never** add FXAA. `renderer.antialias` MSAA is bypassed by the composer (05 §14.1 #23) —
expected. `BokehPass.maxblur` is always passed explicitly (ctor default 1.0 vs shader default 0.01, a
100× discrepancy, 05 §14.1 #21). On resize call **both** `composer.setSize` and
`composer.setPixelRatio` (05 §14.1 #22).

| pass | settings | source |
|---|---|---|
| `GTAOPass` | `radius 0.30 m`, `distanceExponent 1.0`, `thickness 1.0`, `scale 1.15`, `samples 24` (⇒ DIRECTIONS 3, STEPS 8), `screenSpaceRadius false`, `blendIntensity 0.85`, `pd {lumaPhi 10, depthPhi 2, normalPhi 3, radius 6}`, `pdSamples 16`, `setSceneClipBox(stageAABB)` | 05 §8.5 |
| `UnrealBloomPass` | `resolution = canvas px` (never the 256² default), `strength 0.22`, `radius 0.55`, `threshold 0.92` | 05 §8.5 |
| `TAARenderPass` / `SSAARenderPass` | **not used.** Superseded by `StillAccumulator`. | §5.3 |

`GTAOPass` renders its own normal G-buffer with `MeshNormalMaterial`, which respects `USE_SKINNING` —
this is why **no object in the scene graph may be a `ShaderMaterial`** (05 §14.1 #24).
Post-processing passes are not in the scene graph; the ban does not apply to them.

### 5.3 `StillAccumulator` — and the shared GTAO defect it fixes

**The defect, verified in the installed tree.** `SSAARenderPass.js:250–264` and
`TAARenderPass.js:166` call `camera.clearViewOffset()` before returning, and `GTAOPass.js:642` then
runs its *own* `renderer.render(this.scene, this.camera)` to build the depth/normal G-buffer. So on a
paused frame the colour term converges over 32 jittered samples while the AO term is computed
**unjittered and bit-identical on every accumulation frame**. The contact crease — which all three
proposals call "the single biggest AAA-vs-hobby delta" — stays hard-aliased forever. No proposal
noticed.

**The fix.** We own the jitter, at the composer level, so it applies to every pass that reads
`camera` — including GTAO's internal render.

```
STILL_SAMPLES = 32
halton(i,b) = standard radical inverse;  jitter_k = (halton(k+1,2) − 0.5, halton(k+1,3) − 0.5)

renderStill(k):                              // k = 0 … STILL_SAMPLES−1
  camera.setViewOffset(w, h, jitter_k.x, jitter_k.y, w, h)
  composer.render(dt)                        // pass 1 = RenderPass; GTAO sees the SAME offset
  additiveBlit(composer.readBuffer -> accumRT, weight = 1 / STILL_SAMPLES)
  camera.clearViewOffset()

present() = blit accumRT to the canvas
```

* Interactive paused view: one sample per display frame, so a still resolves in ~0.53 s and is
  visibly progressive. `PostStack.stillSample` / `.stillConverged` drive the HUD.
* Harness capture: all 32 samples inside one `settle()`. Sample `k` is a pure function of `k`, so the
  captured PNG is a pure function of `(tick, camera, trackHash, layerWeights)`. **TAA convergence
  leaves the determinism ledger entirely.**
* Any change to tick, camera, layer weight, quality tier or canvas size calls `resetStill()`.
* `accumRT` is `HalfFloatType`; `additiveBlit` is a `ShaderPass` with an inline shader object — a
  fullscreen pass, not a scene object, so GTAO's `MeshNormalMaterial` G-buffer is unaffected.
* This also resolves the per-pixel IGN-rotated Vogel dither that r185 PCF applies to a static frame
  (05 §6.2, §14.1 #3), which was TAA's other job.

Cost: 32 chain renders per still. `fast` profile (512², GTAO `resolutionScale 0.5`) ≈ 0.35 s/frame on
SwiftShader; `hero` (1024², full GTAO) 1.5–4 s/frame. Same order as Proposal A's budget, now correct.

### 5.4 Dojo lighting rig

Four world-fixed directionals. **None of them ever moves.**

| light | type | position (m) | intensity | colour | shadow |
|---|---|---|---|---|---|
| KEY | `DirectionalLight` | `(2.60, 4.20, 3.15)` — elev 45.8°, azim 39.5° | `3.0 ±0.6` | `0xfff4e8` (~5200 K) | **yes** |
| RIM | `DirectionalLight` | `(−2.10, 2.80, −3.85)` | `1.4` (0.47× key) | `0xdfe9ff` (~7000 K) | no |
| FILL | `DirectionalLight` | `(−2.98, 1.58, 2.28)` | `0.55` (0.18× key) | white | no |
| **CROSS** `[ART]` | `DirectionalLight` | `(+1.95, 1.40, −2.60)` | **`0.40`** (0.13× key) | `0xf6f2ee` | no |
| ambient wrap | `scene.environment` PMREM | — | `environmentIntensity 0.85` | — | — |
| `AmbientLight` | **omit entirely** | — | 0 | — | — |

`key.target.position = (0, 0.875, 0)` — aimed at hip height, not the floor. `scene.add(key.target)`
is mandatory (05 §14.1 #25). No pre-r155 tutorial intensities may be reused; they are π× too small
(05 §14.1 #26).

**Why CROSS exists, and why it is not camera-following.** The karateka reaches six distinct headings
across the embusen (H = 0, 45, 90, 180, 270, 315). With only KEY/RIM/FILL, the headings whose chest
normal points away from all three lose *form* on the front plane and read as a flat silhouette. B's
answer was a camera-following practical; the panel correctly objected that a moving directional makes
the shading terminator and the gi's sheen lobe **swim during orbit** — visible during exactly the
360° interaction this product sells. CROSS is world-fixed, low, on the opposite azimuth from KEY, and
capped at 0.40 so it can never fight the key or read as a second source. It casts no shadow.

Procedural env scene (`buildDojoEnvScene`; all `MeshBasicMaterial`/emissive, nothing fetched):
14 × 7 × 14 `BackSide` shell `0x2a2723`; a 6.0 × 1.6 m warm window band at `y 3.6, x +6.9`, emissive
`0xfff2e0` × 6.0, aligned with KEY; a 3.0 × 1.2 m cool band at `y 3.4, x −6.9`, `0xdfe9ff` × 2.2; a
10 × 10 ceiling bounce at `y 6.9`, `0xf2ece2` × 1.1; a 12 × 12 wood floor bounce at `y 0.02`,
`0x8a5f38` — that last one is what puts warm light under the jaw and inside the gi skirt.

### 5.5 Shadow, and the DoubleSide deletion

`PCFShadowMap` only, one caster, Mode B per-frame fitted ortho frustum:

| param | value | derivation |
|---|---|---|
| `mapSize` | `2048 × 2048` | 16 MB depth, one caster |
| stage AABB | `4.68 × 4.68 m` | 3.78 m embusen + 0.45 m limb envelope per side. Mode A would be `S_fixed = 0.5·hypot(4.68,4.68) + 0.2 = 3.51 m`. Corrects 05 §16 uncertainty 3. |
| `S_fit` (Mode B) | `0.75·H = 1.31 m` | fits a one-figure AABB including extended limbs |
| world texel `t` | `2·1.31/2048 = 1.28 mm` | |
| `radius` | `4.0` texels | penumbra ≈ `2·4·1.28 = 10.2 mm` → a true contact shadow |
| `near / far` | `0.10 / 12.0 m` | |
| `bias` | `0.0` | with `normalBias` set, constant bias peter-pans |
| `normalBias` | `0.015 m` | ≈ 12× texel; tune 0.007–0.023 by eye if gi folds show acne |
| `intensity` | `0.92` | leaves IBL fill readable in the core |
| `blurSamples` | **not set** — VSM-only under PCF (05 §14.1 #2) | |
| AABB source | 24 bone world positions inflated by per-bone radius, **not** `computeBoundingBox()` | ~50× cheaper than CPU-skinning every vertex |
| texel snap | `pos = round(pos/t)·t` in light space | three.js does not do this; without it the shadow swims during orbit |

`CSM` and `VSMShadowMap` are both rejected (05 §6.1, §6.5). `shadowSide` stays `null` (closed shells).
Second occlusion layer: `GTAOPass` at `radius 0.30 m` produces the dark crease where the gi meets the
floor and where the rear heel meets the boards. It is not optional.

**The "backface albedo ×0.72" deletion.** All three proposals specified `DoubleSide` plus
"backface albedo ×0.72" on the gi skirt, sleeves and obi tails. **No such property exists** anywhere
in `three/src/materials/`, and all three ban `onBeforeCompile`, so the claim is unimplementable.
Deleted, and replaced with real geometry:

* `src/cloth/giShell.ts` generates an **inner shell** for every simulated panel: the same quad grid
  offset along `−N` by **0.63 mm** (the measured 12 oz duck thickness of doc 06 §7.1), with inverted
  winding, welded to the outer surface along the free edges.
* Every gi material is therefore `side: FrontSide`. **There is no `DoubleSide` in this project**, and
  `tests/render/bans.test.ts` greps for it.
* The interior darkens for real: GTAO, the shadow term and the inverted normals do the work the
  fictional property was supposed to do.
* Cost: +1.9 k triangles across 7 panels; **no extra draw call** (same geometry buffer); +0.05 ms in
  the upload loop, since the inner ring is derived from the outer positions and normals in the same
  pass. Budgeted in §6.6.

### 5.6 Materials — 10, one factory, zero `onBeforeCompile`

| id | class | key params |
|---|---|---|
| `M_GI` | `MeshPhysicalMaterial` | `0xF2F0EA`, `roughness 0.78`, `metalness 0`, **`sheen 0`** (dispute `D09`, settled by Channel D), `specularIntensity 0.12`, `ior 1.45`, `anisotropy 0.18` + `anisotropyRotation` along warp with an itemSize-4 analytic tangent (§2.7), weave `normalMap` (`NoColorSpace`, `normalScale (0.60,0.60)`), crease `normalMap` blended by the wrinkle attribute, **`side FrontSide`** |
| `M_SKIN` | `MeshPhysicalMaterial` | `roughness 0.48`, `metalness 0`, `sheen 0.15`, `sheenRoughness 0.85`, `ior 1.40`, `specularIntensity 0.6`, `normalScale (0.7,0.7)`. **No `SubsurfaceScatteringShader`** — Phong-based and a `ShaderMaterial` (05 §11.1) |
| `M_OBI` | `MeshPhysicalMaterial` | `0x14110f`, `roughness 0.62`, `sheen 0.25`, own crease map, `FrontSide`. The black belt is a **silhouette device**: it separates jacket from trousers so stance depth reads in pure outline at low and overhead orbit angles, where value separation is all the viewer has. |
| `M_FLOOR` | `MeshStandardMaterial` | `0x7d5636`, `roughness 0.42`, 2048² plank albedo (`SRGBColorSpace`) + `roughnessMap` + `normalMap` (`NoColorSpace`), `RepeatWrapping`, `map.anisotropy = min(8, getMaxAnisotropy())` — mandatory at grazing angles; `receiveShadow true`, `castShadow false` |
| `M_BACKDROP` | `MeshBasicMaterial` | vertical-gradient `CanvasTexture`, `toneMapped true` |
| `M_HAIR` | `MeshStandardMaterial` | `0x1a1512`, `roughness 0.55`, shaped cap, no strands |
| `M_EYE` | `MeshStandardMaterial` | sclera/iris/pupil `CanvasTexture`, `roughness 0.18` |
| `M_EMBUSEN` | `MeshBasicMaterial` | transparent, `toneMapped false`, `depthWrite false`, `polygonOffset`, decal plane at `y = 0.002` |
| `M_MASK` | `MeshBasicMaterial` | pure white, `toneMapped false` — `scene.overrideMaterial` for metric 60 |
| `M_DEBUG` | `LineBasicMaterial` | `toneMapped false` — skeleton, reference stick, embusen trace |

Hard rules: `scene.environment` is set and **every** `material.envMap` stays `null` (05 §14.1 #11);
`transmission = 0` and `clearcoat = 0` everywhere (05 §14.1 #13); albedo/emissive maps
`SRGBColorSpace`, normal/roughness/AO maps `NoColorSpace` (the #1 silent PBR bug); all materials
`toneMapped = true` except `M_EMBUSEN`, `M_MASK`, `M_DEBUG`. `sheen` is nearly invisible without
`scene.environment` (05 §14.1 #14) — tune it after IBL, never before.

Draw-call budget: body 1 + gi 4 (uwagi, zubon, collar, obi) + eyes 2 + hair 1 + floor 1 + backdrop 1
+ embusen decal 1 = **12 opaque draws**, ~27 k triangles.

### 5.7 Camera presets

`OrbitControls` with `enableDamping = true`, `dampingFactor = 0.05`,
`target = (0, 0.55·H, 0) = (0, 0.9625, 0)`, `minDistance 1.6`, `maxDistance 9.0`,
`minPolarAngle 0.15`, `maxPolarAngle 1.52` (05 §13).

| preset | type | transform | use |
|---|---|---|---|
| `ORBIT` | persp 39.6° | user-controlled; target = critically damped follow of pelvis XZ, τ = 0.35 s, y locked | default 360° play |
| `HERO` | persp 39.6° (35 mm) | `(1.6H, 0.95H, 2.2H)` → `(0, 0.55H, 0)` | the default look |
| `JUDGE` | persp 27.0° (50 mm) | static `(0, 1.55, +6.0)` on the opening facing axis | the "does it read as karate" camera |
| **`LOW34`** | persp 35° | `(1.3H, 0.35H, 1.7H)` → `(0, 0.45H, 0)` | **the weight camera.** A low three-quarter is the one framing that exposes stance depth and head bob in the same frame. It is in the **default shot list**, not just the preset bar. |
| `FOLLOW` | persp 39.6° | orbit target tracks pelvis XZ with a 0.25 s critically damped lag; radius held | keeps the figure framed across the 3.78 m embusen |
| `EMBUSEN` | ortho | `(0, 4H, 0)` looking down, up `−Z`, `orthoHeight = 4.4 m` | floor-pattern teaching view |
| `DETAIL_HANDS` / `DETAIL_FEET` | persp 16.1° (85 mm) | anchored to the acting fist / front ankle, radius 1.4 m / 1.1 m | twist, candy-wrapper, plant lock |
| `M_FRONT` / `M_LEFT` / `M_RIGHT` / `M_TOP` | **ortho, FROZEN FOREVER** | **WORLD frame** (§3.4.1): `M_FRONT = (0,0.5H,+3H)`, `M_LEFT = (−3H,0.5H,0)`, `M_RIGHT = (+3H,0.5H,0)`, `M_TOP = (0,4H,0)` up `−Z`; **the L/R pair is swapped relative to doc 07 §6.6's authored pair** — doc 07 writes them in the authored (left-handed) frame where `+X` is the character's left, but this field is declared WORLD, where §2.1 fixes `+X` = the character's **right**. `src/contracts/units.ts` ships the resolved world constants `M_*_POS_H`; author cameras from those, never from doc 07's literals. (Conflict C16.); `orthoHeight = 2.2H`, aspect 1:1, near `0.1H`, far `10H` | measurement. Ortho is mandatory — perspective foreshortening corrupts every length metric read off an image. |

Interactive preset changes blend over 0.6 s (`easeOutCubic` on position/target, linear on fov).
`snapTo` is exact, resets the still accumulator, and is the **only** path the harness uses — a
blending camera makes captures non-deterministic.

---

## 6. The deterministic seek model

### 6.1 The claim, stated precisely

> **For every integer `tick` and every layer-weight vector `w`, `sample(tick, w, out)` writes exactly
> the same bytes into `out`, regardless of how the transport arrived at `tick` — cold seek, forward
> playback, reverse playback, or a scrub drag.**

This is not an aspiration; it is a property of the data structure. `sample` reads two frames from a
frozen `Float32Array`, slerps them with an alpha that is an exact dyadic rational, and post-multiplies
five delta quaternions in a frozen order. There is no accumulator, no spring, no IK solve, no clock
read, and no branch on playback direction anywhere in the read path. The only mutable state the
sampler owns is a *segment cursor cache*, whose sole effect is to skip a binary search; a test
(`tests/player/sampler.test.ts`) asserts that clearing the cursor changes no output byte.

### 6.2 The proof, term by term

`sample(tick, w)` is built from exactly these terms:

```
1  seg      = segments[ binarySearch(segments, tick) ]              pure fn of (segments, tick)
2  f0       = (tick - seg.startTick) / seg.ticksPerFrame | 0        integer division
3  alpha    = (tick - seg.startTick - f0*seg.ticksPerFrame) / seg.ticksPerFrame
             -> exactly k/4, k/8, k/16 or k/32 : EXACT in float64, no rounding, ever
4  q_base   = slerp(q[seg.qOffset + f0*B*4 ..], q[.. + (f0+1)*B*4 ..], alpha)
5  for id of LAYER_ORDER:                                           frozen order, 5 iterations
       dq   = slerp(q[layer.dq f0], q[layer.dq f0+1], alpha)
       q    = q * slerp(IDENTITY, dq, w[id])                        post-multiply, bone-local
6  root     = lerp(rootPos[f0], rootPos[f0+1], alpha)
             slerp(rootQuat[f0], rootQuat[f0+1], alpha)
7  cf       = tick / (TICK_HZ / CHAN_RATE_HZ) = tick / 8            integer division
   chan     = lerp(chan[cf], chan[cf+1], (tick % 8) / 8)            alpha in {0, 1/8 .. 7/8}
8  ribcage  = lerp(dScaleRibcage[f0], [f0+1], alpha) scaled by w.breath
```

Term 3 is where every competing design leaks. A non-dyadic tick rate makes `alpha` a rounded float
whose value depends on the arithmetic path; a stateful mixer makes term 5 depend on an accumulation
index; a runtime integrator makes terms 4–8 depend on history. None of those exist here.

### 6.3 The complete determinism ledger

| state source | how it is made seekable | residual risk |
|---|---|---|
| base pose, easing, hip drive, spine whip, COM solve, foot IK + plant lock, gaze spring, blink schedule, twist/helpers, ROM clamp | **baked** into `PoseTrack` at compile time by 16 pure stages | none |
| the five expressive layers | **baked** as delta tracks; runtime weights are bounded and default to exactly 1.0 | none. Non-default weights are recorded in `run.json` and **abort a capture** (§6.5) |
| breath, tension, kiai, load, plant, gaze, blink, `tauMove` | **baked** into `chan` at a uniform 480 Hz | none |
| `accelL/R`, `pelvisYawRate` | **analytic**: `kimeEaseVel`/`kimeEaseAcc` × path length, evaluated at each 480 Hz frame. Never finite-differenced from a baked pose. | none |
| gi crack / foot contact / hip snap | sparse `ImpulseEvent[]` with exact integer ticks | none |
| cloth particle state | snapshot every kime + every 1.0 s (23.7 kB each; Heian ≈ 76 snapshots = 1.8 MB) + fixed-substep fast-forward | **snapshot-deterministic, not path-deterministic.** See §6.4. |
| wrinkle hysteresis | carried inside the cloth snapshot | same as cloth |
| still accumulation | `StillAccumulator` sample `k` is a pure function of `k`; resets on any change | none |
| shadow texel snap | pure function of `(camera, boneAABB)` | none |
| `OrbitControls` damping | camera state only, never pose. Measurement presets bypass damping and set the matrix exactly. | none |
| canvas size / DPR | pinned to 1024 × 1024 @ DPR 1 in harness mode | none |
| debug pose-poke (`RuntimeLayer 'poke'`) | user-driven; **hard-disabled** in harness mode; `flags.poke` recorded | none |

### 6.4 Cloth — the one honest exception, and how it is fenced

Cloth is the only integrator in the system. It gets four fences:

1. **Fixed substep, driven by ticks.** `dt_s = 1/480 s`, `n_sub = 8` per 1/60 s frame (06 §7.5),
   advanced from the *transport tick sequence*, never from wall clock. On a long frame: run up to 3
   extra frame-steps, then drop. **Never scale `dt`.**
2. **Snapshot + replay.** `seek(tick, 'exact')` loads the nearest snapshot ≤ `tick` and
   fast-forwards. Worst case 1.0 s = 480 substeps ≈ 8 ms.
3. **Preview during a drag.** While the scrub handle is held, `seek(tick, 'preview')` pins particles
   to their skinned rest and settles 12 substeps (06 §7.7 teleport rule). On release, the full
   snapshot→forward pass runs. This is a *deliberate, labelled* approximation of one subsystem, not
   a different animation: **the pose, the layers, the impulses and every joint the scorecard reads are
   identical in preview and release.** (Proposal C's scrub preview disabled recoil, overshoot,
   settle, breath and gi — four of the five cues it existed to deliver. Ours disables none of them.)
4. **Structural insulation.** **No metric in G1–G4 reads cloth state.** All 55 of them are computed
   from the 25 canonical joints. Only metrics 60 (`silhouette_IoU`), 61 (`contact_shadow_present`)
   and 63 (`hem_overshoot_H`) touch pixels or garment vertices, and all three are captured **only**
   through `seek(tick, 'exact')`.

`ClothSystem.stateHash` is written into `run.json`, so two runs that disagree are detectable rather
than mysterious.

### 6.5 Layer weights and the capture interlock

`w = 1.0` for all five layers **is** the compiled pose, exactly (S14 asserts recompose error
< 1e-4°). Weights exist so a human can answer "the hips read dead" with a slider instead of a
recompile — the look-dev knob Proposal A did not have.

Three interlocks make the knob safe:

1. **Bounded.** `LayerTrack.minWeight / maxWeight` are compile-time constants
   (`koshi 0…1.5`, `kime 0…1.5`, `breath 0…1.5`, `gaze 0…1.5`, `patch 0…1`).
2. **Envelope-checked at compile time.** S14 evaluates the composed chest yaw at the corners of the
   full legal weight box and asserts `≤ 17°` (the 15° X-factor cap of 04 §2.1 plus 2° margin). The
   cap is therefore enforceable across every configuration a user can reach — not, as in Proposal B,
   baked into one layer and then violated by another at runtime.
3. **Capture aborts.** `KataHarness.layerWeightsDirty` is true unless every weight is exactly its
   default. `tools/capture.mjs` and `tools/score.mjs` **exit non-zero** when it is true. The HUD shows
   a persistent red badge. No scorecard can ever be produced from an out-of-spec composition.

### 6.6 Frame budget (60 fps = 16.667 ms)

```
timer.getDelta()                              three Timer; Clock deprecated r183 (05 §13)
transport.advance(dt)      -> integer tick    residual accumulator, pose never sees a float time
poseSource.sample(tick, w, frame)             segment locate + 52 base slerps + 22 layer
                                              slerp+multiply                          ~3.6 us
applyPose(rig, frame)                         52 local quats + root + ribcage scale    0.09 ms
pokeLayer.apply()                             disabled in every non-debug run          0.00 ms
rig.root.updateMatrixWorld(true)                                                       0.06 ms
skeleton.update()                             boneTexture upload                       0.10 ms
cloth.step(tick)                              8 fixed substeps + impulse queue         1.10 ms
uploadCloth()                                 988x6 floats + the 0.63 mm inner shell   0.20 ms
refitShadow(key, boneAABB(rig), camera)        Mode B + light-space texel snap          0.02 ms
cameraRig.update(dt, landmarks)                                                        0.02 ms
post.render(dt)                               play: RenderPass chain                   8.00 ms
--------------------------------------------------------------------------------------------
CPU subtotal                                                                           1.59 ms
render                                                                                 8.00 ms
headroom                                                                               7.08 ms
```

Hard gate: `bench` p95 ≤ 16.0 ms at 1600 × 900 DPR 1.5. Quality tiers (`?quality=`):

| tier | cloth | GTAO | still samples | shadow | layers |
|---|---|---|---|---|---|
| `high` (default) | 988 particles | full res | 32 | 2048² | all 5 |
| `low` (mobile) | 520 (sleeves + skirt) | `resolutionScale 0.5` | 12 | 1024² | koshi + kime only; the 960 rung is dropped from the track |
| `max` (capture) | 988 | full res | 32 | 2048² | all 5 |

Track memory, Heian at T1, `high`: base `q` 6.1 MB + root 0.24 MB + layers 3.1 MB + `chan` 1.5 MB +
diagnostics 0.4 MB ≈ **11.3 MB**; both kata resident ≈ 22.6 MB. `low` tier ≈ 7 MB per kata.

### 6.7 Transport surface

* Rate presets `0.1 / 0.25 / 0.5 / 1 / 1.5 / 2` plus continuous drag; **negative rate = reverse**,
  free, because sampling is stateless (cloth reseeds from the nearest snapshot ≤ tick).
* `seekMove(n, 'kime')` is the UI snap target; marks also give `move-start`, `prep`, `foot-contact`,
  `kiai`, `hold-end`, so the timeline renders the fast pairs (7-8 / 15-16 Taikyoku, 8-9 / 16-17
  Heian) as visibly tighter clusters.
* `loopMove(n)` sets `loop = { t0: markTick(n,'move-start') − 0.15 s, t1: markTick(n,'hold-end') }`.
* `stepKeys(±1)` steps one *baked key* in the current segment — inside a 960 Hz snap window that is
  1.04 ms, which is how an agent inspects the brake.
* `tempoTier` T0–T3 multiplies `T_prep` and `T_hold` **only**, never `T_tech`/`T_thrust`/`T_kime`
  (04 §11 invariant 7). That makes the JKA "contrast in speed" criterion structural: a tempo change
  cannot flatten a technique.
* Keyboard: space, `←/→` = 0.1 s, `,`/`.` = one key, `[`/`]` = one move, `1`–`9` = camera preset.
* Per-move labels come straight from `KataMove.label / labelJp / labelEn / stance / tech.level`.
  There is no separate label file to drift.

---

## 7. The critic-loop contract

### 7.1 The split that makes the loop fast

Rendering under SwiftShader is expensive; measuring is not. They are decoupled completely:

* **Numeric channel — Node, no GL, no browser.** `tools/score.mjs` boots Vite in middleware mode
  (`tools/ssr.mjs` → `server.ssrLoadModule`), compiles both tracks, walks the 480 Hz canonical-joint
  stream, runs all 63 metrics and every fault predicate, and writes the scorecard. **~9 s per kata.**
  This gates every commit.
* **Pixel channel — browser, one monotonic pass.** `tools/capture.mjs` sorts the shot list by tick
  and seeks **strictly forward**, so cloth advances through the kata exactly **once per run** rather
  than once per shot. (Proposal B's loop called an exact replay-from-zero inside a nested
  `for mark × for cam`, which is ~92 replays and ~5.5 minutes of pure cloth per kata.)

### 7.2 Exact CLI

Scripts to add to `package.json` (orchestrator-owned; existing `dev`, `build`, `preview`,
`typecheck`, `test`, `test:watch`, `shots` are kept):

```jsonc
"scripts": {
  "dev":         "vite --port 5178 --strictPort",
  "build":       "vite build",
  "preview":     "vite preview --port 5178 --strictPort",
  "typecheck":   "tsc --noEmit",
  "test":        "vitest run",
  "test:watch":  "vitest",

  "build:track": "node tools/build-track.mjs",
  "score":       "node tools/score.mjs",
  "shots":       "node tools/capture.mjs",
  "sheets":      "node tools/contactsheet.mjs",
  "brief":       "node tools/criticPrompt.mjs",
  "critic":      "node tools/critic.mjs",
  "route":       "node tools/fix-route.mjs",
  "verify":      "node tools/verify-all.mjs",
  "own":         "node tools/verifyOwnership.mjs",
  "bench":       "node tools/bench.mjs",
  "calibrate":   "node tools/calibrate-envelope.mjs"
}
```

Concrete invocations. **The inner fix loop is the first two lines and takes under 20 seconds.**

```bash
# --- INNER LOOP: numbers only, no browser, gates every commit -------------------
npm run typecheck && npm run test
npm run score                                     # both kata, T1, all 63 metrics -> exit = gates
npm run score -- --kata heian-shodan --step 9     # one step, full metric detail on stdout

# --- FULL LOOP: numbers + pixels + brief ---------------------------------------
npm run critic                                    # build:track -> score -> shots(fast) -> sheets -> brief
npm run critic -- --kata heian-shodan --profile fast
npm run critic -- --kata heian-shodan --profile hero --steps 9,17 --cams HERO,LOW34,M_FRONT
npm run critic -- --tempo T2                      # the second required tempo (gate G-11)
npm run critic -- --baseline <sha>                # emit regression.json

# --- pieces, when you only want one ------------------------------------------
npm run build:track -- --kata all --tempo T1      # compile + hash, no browser, no pixels
npm run shots -- --kata taikyoku-shodan --profile fast
npm run shots -- --kata heian-shodan --tick 60096 --cams HERO,LOW34 --profile hero --width 2048
npm run sheets -- --sha <sha>
npm run brief  -- --sha <sha> --tier A,B

# --- verification (all five run in CI; `verify` is the aggregate) --------------
npm run verify                                    # constants + reference + contracts + determinism + ownership
node tools/verify-constants.mjs                   # every Num.src section contains the literal value
node tools/verify-reference.mjs                   # ref bank vs docs; enforces the 8 SS2.6 overrides
node tools/verify-contracts.mjs                   # contract hashes + banned-construct greps
node tools/verifyDeterminism.mjs --kata both --seeks 200
npm run own                                       # fails any commit that spans ownership blocks

# --- routing: turn a scorecard into per-agent work ---------------------------
npm run route -- --sha <sha>                      # fixqueue.json -> routed.json, keyed by FILE

# --- one-time calibration (Phase 3), which ARMS metric 60 --------------------
npm run calibrate -- --kata taikyoku-shodan

# --- perf --------------------------------------------------------------------
npm run bench -- --frames 600 --width 1600 --height 900 --dpr 1.5
```

Flags accepted by `critic`, `score`, `shots`: `--kata <id|all>` · `--tempo T0|T1|T2|T3` ·
`--profile fast|hero` · `--steps 4,9,17` · `--cams <ids>` · `--quality low|high|max` ·
`--baseline <sha>` · `--stage-mask <hex>` · `--out <dir>` · `--sha <sha>`.

### 7.3 Capture plan and output directory layout

`buildCapturePlan(track, kata)` returns a `ShotSpec[]` **sorted ascending by tick**. Per kata:

| what | ticks | cameras | png | silhouette | strip |
|---|---|---|---|---|---|
| every `kime` mark, plus `yoi` and `yame` | 23 (Heian) / 22 (Taikyoku) | `M_FRONT`, `M_LEFT`, `M_TOP`, `HERO`, `LOW34` | yes | `M_FRONT`, `M_LEFT` | `M_FRONT`, `M_LEFT` |
| `kime` of every step whose acting arm is `R` | 12 (Heian) | `+ M_RIGHT` | yes | no | no |
| `kime` of `{1, 9, 17, 18}` | 4 | `+ DETAIL_HANDS`, `DETAIL_FEET` | yes | no | no |
| the two `kiai` ticks and both `hold-end` ticks after them | 4 | `JUDGE` | yes | no | no |
| once per kata | 1 | `EMBUSEN` | yes | no | no |

`M_TOP` fires on **every** kime, not once per kata: overhead is a required orbit position, and a
per-limb left/right asymmetry or an elbow flaring on one side only is invisible without it.
`M_RIGHT` on all 12 right-arm kime is the mirror check.

Heian, `fast` profile: 115 + 12 + 8 + 4 + 1 = **140 PNGs** + 46 silhouette masks + 46 strips.
At ~0.35 s/frame ≈ **1.3 min**. `hero` profile ≈ 4–9 min. `--steps` subsets both.

```
captures/<sha>/<kata>/
  shotlist.json                     the ShotSpec[] actually executed
  meta.json                         sha, trackHash, contractHash, tempo, profile, quality,
                                    layerWeights, tick->step map, camera params, three revision
  joints.f32                        480 Hz canonical-joint stream, CANONICAL_COUNT*3 f32 per frame
  chan.f32                          480 Hz channel stream, CHANNEL_COUNT f32 per frame
  diagnostics.json                  SolveDiagnostics.worst + per-move clampSat maxima
  step-09_t15.650_kime_M_FRONT_migi-jodan-age-uke_zenkutsu.png
  step-09_t15.650_kime_M_LEFT_migi-jodan-age-uke_zenkutsu.png
  step-09_t15.650_kime_LOW34_migi-jodan-age-uke_zenkutsu.png
  yoi_t06.700_ceremony_HERO_hachiji.png
  silhouette/step-09_M_FRONT.png
  strip/step-09_M_FRONT.png         [ ours | reference stick | overlay | abs-diff ]
  contact-sheet.png                 all steps x { M_FRONT, M_LEFT }
  floor-trace.png                   reference embusen polyline + actual pelvis XZ + per-step markers

reports/<sha>/
  run.json                          RunInfo
  bake.json                         BakeStats for both kata
  scorecard.json                    the Scorecard of SS3.11, verbatim
  scorecard.md                      one row per metric per step, worst-first, provenance in each row
  gates.json                        G-1 .. G-11 pass/fail + detail  -> process exit code
  fixqueue.json                     <= 20 FixQueueEntry, deduped by fixSite.file
  routed.json                       fixqueue grouped by FILE, then by block
  regression.json                   per-metric score delta vs --baseline
  perf.json                         p50/p95/p99 frame ms, draw calls, tris, sample us
  determinism.json                  seeks checked, mismatches, failing tick if any
  critic-<kata>-A.md                Tier-A VLM brief, one section per failing step
  critic-<kata>-B.md                Tier-B VLM brief
  handoff-<block>.md                cross-block requests raised by fix agents (never edits)
```

Both `captures/` and `reports/` are already in `.gitignore`.

### 7.4 JSON scorecard shape

`reports/<sha>/scorecard.json` is exactly the `Scorecard` interface of §3.11. The `scorecard.md` row
for the worked example — **now internally consistent**, unlike Proposal A's (judge 2 fatal A6):

```
STEP 04  zenkutsu (migi)  taikyoku-shodan  t = 7.750 s  tick 29760  |  stance_len_H
  value 0.4968 H   ref 0.5330 H   delta -0.0362 H   (-6.8 %)   score 65   FAIL
  metric   docs/research/07-reference-and-datasets.md SS6.2 G1#1   (heel-to-heel along facing)
  ref src  docs/research/01-stances.md SS3.1  via ZENKUTSU_HEEL_TO_HEEL_H   [refSource doc01]
  tol      +-0.0500 (score 100)   hard-fail +-0.1500 (score 0)      [tolerance from doc 07]
  derivation  S - HEEL_BEHIND*cos(yawFront) + HEEL_BEHIND*cos(yawRear)
              = 0.540 - 0.052*cos(3) + 0.052*cos(30) = 0.533
  provenance  ZENKUTSU.S = 0.540 H +-0.040 [DERIVED] docs/research/01-stances.md SS3.1
  fault    01 SS9.1 Z1 (S < 0.500 H)
  FIX  B1  src/data/constants/stances.ts -> ZENKUTSU.S       knob ZENKUTSU.S.v   (kind: constant)
       or  B2  src/data/patches/taikyoku-shodan/move-04.ts -> override.stance.S  (kind: move-override)
       hint +0.001 H in S ~ +0.00099 H in stance_len_H ; suggestedDelta +0.0362
```

Three tolerances for one number is what the panel called fatal. Here there is exactly one scoring
tolerance (doc 07's ±0.05), exactly one reference (doc 01's 0.533 via a printed derivation), and
`ZENKUTSU.S.tol` is labelled for what it is: how well we *know* the constant, never used in scoring.

`suggestedDelta` is `null` whenever the metric's `refSource` is `'doc07'` **and** an override exists,
because a signed nudge computed against doc 07's seeded value would walk the rig away from docs 01/03
while the score rose. That was the mechanism by which Proposal A's fix queue would have degraded
authenticity automatically.

### 7.5 Gates

| gate | condition | source |
|---|---|---|
| **G-1** | `scoreKata ≥ 85` | 07 §6.3 |
| **G-2** | no **armed** metric flagged `fatal` anywhere | 07 §6.3 |
| **G-3** | `min(scoreStep) ≥ 70` | 07 §6.3 |
| **G-4** | `G1 ≥ 80` **and** `G2 ≥ 80` on **every** step | 07 §6.3 |
| **G-5** | Channel C **posture-matched** `PCK@0.030H ≥ 0.85` on ≥ 6 matched plates, topology only | 07 §6.7 + §7.6 here |
| **G-6** | Channel D reports zero Tier-A findings | 07 §6.8 |
| **G-7** | `verifyDeterminism` mismatches = 0 over 200 random seek sequences per kata | new |
| **G-8** | `max(diagnostics.ikResidualM)` at every arrival tick `< 0.005 m` (0.003 H) | new |
| **G-9** | `maxSlerpErrDeg < 0.25` (a) **and** `maxStepDeg ≤ 12` (b) **and** `eventsBelow20msExact` (c) | new |
| **G-10** | `verify-constants` + `verify-reference` + `verify-contracts` all clean | new |
| **G-11** | every gate above passes at **T1 and T2** | new |

Additionally: any metric regressing more than 5 points against `--baseline` fails CI even if every
gate passes (07 §6.3). `layerWeightsDirty` or a non-full `stageMask` makes **all** gates advisory and
sets `pass: false`.

**Why G-11 exists.** A look tuned at a single tempo is exactly where the JKA contrast-in-speed
criterion dies silently. Requiring the gates at two tempi is the cheapest structural guard against
tempo-specific hacks available anywhere in the three proposals.

### 7.6 Channels B, C, D

**Channel B — our own reference overlay, zero licence exposure.** `src/eval/refStick.ts` forward-
kinematics the canonical 25-joint skeleton at `H = 1` with doc 07 §0.2 segment lengths and solves each
step's reference targets by the **same** `solveTwoBone` the compiler uses, so a timing error appears
as a spatial offset rather than as a solver difference. Drawn as a stick figure (bones 3 px rounded,
joints 7 px) plus a capsule envelope (`0.028 H` limbs / `0.075 H` torso / `0.065 H` head), reference
`#FF2D55` @ 0.55 α lines and 0.18 α fill, ours `#0A84FF`, agreement zones purple. Hips-aligned, no
rotation, no scale — we must match orientation and size ourselves — plus a second Procrustes-aligned
"shape only" variant (07 §6.6).

**Channel C — the only real-human ground truth, and the gate that all three proposals got wrong.**
Doc 07 §2.1 identifies the 16 Commons plates as the **Heian Nidan** posture sequence. **We build
Taikyoku Shodan and Heian Shodan. Neither appears in that set.** All three proposals nonetheless made
"PCK on ≥ 6 annotated PD reference postures" a blocking phase-exit gate, and none flagged the
mismatch. Resolution:

1. `assets/reference/pd-1925/posture-match.json` maps each plate to the
   `(technique, stance, side, level)` it *shows*, and thence to the nearest step in our kata that
   shows the same posture. Heian Nidan shares gedan-barai in zenkutsu, jodan age-uke, chudan
   oi-zuki and chudan shuto-uke in kokutsu with our two kata — enough for well over 6 matches.
   **This file is reviewed and signed off by a human before G-5 is armed.**
2. Comparison is **topology only**, exactly as 07 §6.7 step 6 mandates: limb configuration, hikite
   existence, forearm angles, head direction, weight side. `src/eval/pd1925.ts` **refuses** to include
   `stance_len_H`, `stance_width_H` or `hip_height_H`. 1920s Shuri-te postures are shallower and more
   upright than modern JKA; optimising stance depth toward them produces pre-war karate.
3. Metrics: `mpjpe2d_H ≤ 0.025` (gate 0.040), `pck_H ≥ 0.90` (gate **0.85**),
   `limb_angle_mae_deg ≤ 7` (gate 12).
4. Camera match per 07 §6.7 step 4: estimate azimuth `θ` by minimising
   `|shoulder_width_obs/H_px − 0.259·cos θ|`, lock elevation to 0°, render `M_FRONT` rotated by `θ`.

Channel C is also the **only independent detector of a global left/right mirror**: the scorecard and
Channel B are both built from the same `SIDE_SIGN`, so neither can see the flip.

**Channel D — the harsh critic.** `tools/criticPrompt.mjs` emits `critic-<kata>-<tier>.md` with the
07 §6.8 rubric, the frame index, the numeric deltas, the diagnostics line and the blame list
pre-filled. Runs on **our frames only** (`captures/<sha>/**`), never on third-party media. Output
schema is `CriticFinding`.

### 7.7 Complaint → file, mechanically

Every `MetricSpec` carries a `fixSite` with `{file, symbol, knob, kind, block, hint}`, and
`src/eval/fileMap.ts` carries the same for every fault id of 01 §9 and 03 §11.
`tests/eval/fixsites.test.ts` reads every declared `fixSite.file`, greps for `fixSite.symbol`, and
**fails if it does not resolve to an exported binding** — a fix site cannot silently rot.

`tools/fix-route.mjs` groups `fixqueue.json` **by `fixSite.file` first**, then by block, and emits at
most one work item per file. That is what makes N parallel fix agents safe: the unit of contention is
a file, not a block.

Routing table (abridged; the authoritative 63-row version lives in `src/eval/metricSpecs.ts` and the
fault rows in `src/eval/fileMap.ts`):

| complaint | metric / fault | block | file → knob |
|---|---|---|---|
| "front stance too short at step 4" | `stance_len_H`, Z1 | B1 / B2 | `stances.ts → ZENKUTSU.S.v` · or `patches/<kata>/move-04.ts → override.stance.S` |
| "hips too high / not karate" | `hip_height_H`, A6 | B1 | `stances.ts → FIGHT_PELVIS_Y.v` |
| "rear heel lifted" | `rear_heel_gap_H`, A7 | B1 | `stances.ts → ZENKUTSU.yawRear.v` (01 §3.5: above `S > 0.580 H` it is geometrically forced, so the fix is the yaw, not "try harder") |
| "head bobs while stepping" | `head_bob_H`, B10, X-family | B3 | `solve/stance.ts` — `pelvisY` must stay an **input**; S3's invariant is the guard |
| "hips ramp linearly / robotic turn" | `X3` | B3 | `solve/spine.ts`, `contracts/ease.ts → holdThenSnap`; S7's invariant is the guard |
| "no kime, it decelerates smoothly" | `kime_decel_time_s`, `accel_profile_skew`, A4 | B1 | `dynamics.ts → CHANNEL_DYN.wristLock.tauP.v` |
| "hips don't lead the punch" | `hip_lead_lag_s`, A3 | B1 | `dynamics.ts → CHANNEL_DYN.pelvisYaw.leadMs.v` |
| "the hips read dead" (subjective) | — | B8 | `ui/look.ts → LAYERS.koshi` slider first; then `dynamics.ts` once the value is known |
| "hikite missing / lazy" | `hikite_present`, A5 | B1 | `techniques.ts → HIKITE_HIP_A.end` |
| "punch off the centreline" | `active_fist_lateral_H`, B4 | B1 | `techniques.ts → TECHNIQUES['oi-zuki-chudan'].end.dx.v` |
| "shoulders shrugged at step 18 only" | `shoulder_elevation_H`, B3 | B2 | `patches/heian-shodan/move-18.ts → patch[]` — a `PatchKey` on `clavicle_L`, **not** a global `clavicleRhythm()` edit |
| "elbow chicken-wings" | F-family | B3 | `solve/arm.ts → poleFor()` |
| "planted foot slides" | `foot_slide_Hps`, A1 | B3 | `solve/footPlant.ts → applyPlantLock()`; check S12.5's residual first |
| "forearm pinches on the punch roll" | `forearm_radius_retention` | B4 | `rig/skinWeights.ts → rigidify()` |
| "gi is rigid at kime" | `hem_overshoot_H`, B8 | B1 / B7 | `cloth.ts → CLOTH.alphaBend.v`; the swatch test must stay green |
| "sleeve rattles instead of cracking" | C6 | B3 / B7 | `solve/impulses.ts` (event count) then `cloth/impulseQueue.ts` (gain) |
| "figure pasted on the floor" | `contact_shadow_present`, B14 | B5 | `render/shadow.ts → S_FIT`, `radius` |
| "flat lighting, no separation" | C8 | B1 | `render.ts → LIGHTS.rim.intensity.v`, `LIGHTS.cross.intensity.v` |
| "keyframe smell / linear interpolation" | A9 | B3 | `solve/bake.ts` — check `bake.json` `maxStepDeg` before touching anything else |
| "whole kata is mirrored" | A10 | **B0** | `contracts/units.ts → SIDE_SIGN` — **stops all agents; integrator commit only** |
| "embusen drifts / doesn't close" | `embusen_return_err_H`, C3 | B1 | `data/embusen.ts` — `L` and `EMB_H` are derived; check the derivation, never the coordinates |

---

## 8. Build order — 6 phases

Parallelism is by ownership block. A phase ends at a gate; nobody advances until it holds.
`npm run own` runs on every commit from Phase 1 onward.

### Phase 0 — FREEZE (1 agent, serial)

Write the 11 contract files of §4.0, `tools/verify-contracts.mjs`, `tools/ssr.mjs`, the npm scripts of
§7.2, and the **six red-first tests**: `handedness`, `bake-error`, `tickrate`, `seek-purity`, `ease`,
`bones`. Write all eight resolved conflicts of §2.5 into the files as constants and comments. Create
the 41 empty patch files and the two patch indexes.

**Exit gate:** `npm run typecheck` clean · `node tools/verify-contracts.mjs` passes · the six tests
exist and fail *for the right reason* (they reference symbols that do not exist yet).

### Phase 1 — FOUNDATIONS (4 agents: **B1**, **B4**, **B5**, **B9**)

* **B1** — `num`, `anthro`, `stances`, `rom`, `render`, `camera`, `embusen`, `DISPUTED.md`.
* **B4** — `bones`, `bodyMesh`, `skinWeights`, `tangents`, `karateka`, `landmarks`.
* **B5** — `renderer`, `dojoEnv`, `ibl`, `lights`, `materials`, `stage`, `post`, `still`.
* **B9** — harness protocol client, `browser.mjs`, `capture.mjs`, `plan.ts`, `score.mjs` skeleton,
  `verify-constants.mjs`, empty `metricSpecs.ts`.

**Exit gate:** `npm run dev` shows the procedural karateka standing at bind pose in the lit dojo with
a visible contact shadow · `tests/rig/closure`, `weights`, `scale`, `tangents` and
`tests/data/derived` green · `tests/contracts/bones` green **as a file**, and `handedness` green
**per-test for assertion 1 and every precondition test** — assertions 2 and 3 stay RED here by
construction, because they require B2 kata data, B3 `compileKata` and B6 `createSampler`, none of which
exist before Phase 2; full `handedness` greenness is a **Phase-2** gate item, not a Phase-1 one
(adjudicated in the Phase-0 audit; the alternative reading would force a cross-block test to be made
vacuous to pass) · `npm run shots --smoke`
produces 5 PNGs from `M_FRONT / M_LEFT / M_TOP / HERO / LOW34` · `npm run score` writes a
shape-correct all-zero `scorecard.json`.

### Phase 2 — STATIC POSES (4 agents: **B3**, **B2**, **B6**, **B9**)

* **B3** — `frame`, `skeleton`, `twoBoneIK`, `swingTwist`, `stance`, `arm`, `hand`, `com`, `spine`.
* **B2** — `taikyoku-shodan.kata.ts` complete, `ceremony`, `validate`, patch index.
* **B6** — `transport`, `sampler`, `poseApply`, `layerWeights`, `cameraRig`, `loop`, `app`, `harness`.
* **B9** — `joints`, `metricSpecs` for G1/G3/G5, `metrics`, `score`, `referenceBank`, `fileMap`,
  `verify-reference.mjs`, `pipeline.test.ts`.

**Exit gate:** every kime pose of Taikyoku Shodan is solvable and jump-seekable · `G1 ≥ 80` on all 20
kime · `foot_slide` / `ground_penetration` / `float_gap` clean · `tests/solve/stances` reproduces
every 01 §10 constant · `tests/eval/precedence` and `derivedRefs` green ·
`tests/eval/perfect.test.ts` scores a hand-written perfect pose at exactly 100 ·
`tests/integration/pipeline.test.ts` runs **end to end in Node with no GL**.

### Phase 3 — MOTION (4 agents: **B3**, **B1**, **B7**, **B9**)

* **B3** — `timeline`, `keyposes`, `channels`, `gaze`, `footPlant`, `bake`, `layers`, `impulses`,
  `diagnostics`, `stageAssert`, `compile`, `hash`.
* **B1** — `dynamics`, `techniques` completion, `cloth` constants.
* **B7** — the whole cloth block, including `swatch.test.ts` and `giShell.ts`.
* **B9** — G2/G4 metrics, `faults.ts`, `refStick`, `overlaySvg`, `panel`, `silhouette`,
  `verifyDeterminism.mjs`, `calibrate-envelope.mjs`, `contactsheet.mjs`.

**Exit gate:** Taikyoku Shodan plays end to end at T1 (50.15 s incl. ceremony) · **G-9a/b/c green**
(this is the gate that answers the panel's unanimous fatal) · **G-7 green** (200 seeks) ·
`tests/cloth/swatch` green (free edge droops 7.5 ± 1.5 cm — until it is, `alpha_bend` is wrong and the
gi is a bed sheet) · `tests/cloth/impulse` green (one crack per brake, exact tick) ·
`tests/player/seek` byte-identical across cold seek / play / reverse · `npm run calibrate` has run and
**metric 60 is armed** · `scoreKata ≥ 75` on Taikyoku.

### Phase 4 — LOOK + SECOND KATA (4 agents: **B5**, **B2**, **B8**, **B7**)

* **B5** — GTAO/bloom tuning against the contact sheet, `silhouette`, `clothBridge`, `overlay`, LUT
  grade, floor plank variance, CROSS balance.
* **B2** — `heian-shodan.kata.ts` complete (kokutsu, shuto-uke, tettsui, R0 move 4, D45/T135).
* **B8** — `timeline`, `labels`, `gui`, `look`, `hud`, `theme.css`.
* **B7** — baked crease field (7–9 folds/panel at 0.030–0.045 H spacing), wrinkle hysteresis
  (attack 0.05 s / release 0.9 s), obi tails, kime overshoot tuned to hem 0.030–0.045 H settling in
  0.25–0.40 s.

**Exit gate:** both kata play at T1 **and T2** · `scoreKata ≥ 85` Taikyoku, `≥ 80` Heian ·
`hem_overshoot_H` in band · `G-8` green on both kata · `bench` p95 ≤ 16.0 ms at 1600 × 900 DPR 1.5 ·
the LOOK / LAYERS / DISPUTES GUI folders exist and every one of the 14 disputes has a working A/B
toggle.

### Phase 5 — CRITIC-DRIVEN FIX LOOP (up to 10 agents, driven by `routed.json`)

`npm run critic` → `npm run route` → one agent per **file** → re-score. Each agent may edit **only**
files inside its own block; a fix that needs another block's file writes
`reports/<sha>/handoff-<block>.md` and never edits. `tools/verifyOwnership.mjs` enforces it at commit
time. Channel C annotation of the 16 PD plates plus the human-signed `posture-match.json` lands here,
and only then is G-5 armed. Channel D Tier-A passes run every iteration.

**Exit gate:** **G-1 … G-11 all pass on both kata at T1 and T2** · no metric regresses more than 5
points · `npm run verify` clean.

### Phase 6 — HARDENING (**B6**, **B5**, **B9**; others perf-only)

Mobile `low` tier (cloth 520, still 12 samples, shadow 1024², no Bokeh, `pixelRatio 1.5`, the 960
rung dropped), dispose paths, keyboard a11y, `npm run build` bundle size, `About` panel with
`PROVENANCE.md` and licence notes (07 §6.9), README. Then a full `--profile hero` capture of both
kata at both tempi, the complete 63-metric scorecard, and the regression gate against Phase 5.

**Exit gate:** mean frame ≤ 12 ms and p95 ≤ 16 ms on the reference machine · zero console
warnings · no leaks across 20 kata↔camera switches · every gate still green.

Agent count per phase: P0 = 1 · P1 = 4 · P2 = 4 · P3 = 4 · P4 = 4 · P5 = up to 10 · P6 = 3.
No two agents ever hold the same file, because ownership is by exact path (`docs/OWNERSHIP.md`), the
per-move escape hatch is one file per move, and consumer-side fixtures live in the consumer's own
`tests/<block>/fixtures/` — never as a stub inside another block's directory.

---

## 9. Judge flaws and how this design answers them

Every fatal flaw the panel named against the winning proposal is quoted below, followed by the exact
mechanism that answers it. Then the four defects named against all three proposals. Then an audit of
every graft taken from B and C, showing that the idea was imported without the defect it shipped with.

### 9.1 Fatal flaws named against A — the base of this design

**A-1 · "The central proof in §8.1 is arithmetic on the wrong channel. It bounds slerp error with the
900 °/s pelvis (7.5°/key at 120 Hz, 'under 2° per display frame at 0.25× slow-mo') but stage S4 ships
doc 03 §4.3's roll curve … whose peak rate is ~6285 °/s → 52°/key and ~1.0° slerp error … Nothing
catches it."** *(named fatal by all three judges)*

Answered by §2.4 and §4.11 S13. The bake is no longer flat. `POSE_LADDER = [120, 240, 480, 960]`, and
`src/solve/bake.ts` refines by halving until **both** criteria hold: `maxSlerpErrDeg < 0.25`
(criterion 1) **and** `maxStepDeg ≤ 12` (criterion 2). Against 6 285 °/s, criterion 2 binds at
1.91 ms ⇒ the 960 rung, which is precisely why the ladder has four rungs and not three. Both are
**build gates** (G-9a, G-9b) written into `bakeStats` and `bake.json`, and
`tests/contracts/bake-error.test.ts` is a Phase-0 **red-first** test that reconstructs doc 03 §4.3's
roll from a baked track and asserts both bounds. A's per-display-frame argument is also retired: the
bound is stated absolutely, in degrees on the curve, so it does not degrade at 0.1× playback.

**A-2 · "The gi is driven by an acceleration field that does not exist. Both `chan.accelL/accelR` and
the cloth's own reading of bone matrices derive from slerp between 120 Hz keys, so tangential angular
acceleration is identically zero between keys and a Δv step at each key … the snap trigger therefore
fires ~11 times across the 92 ms fist brake instead of once … Result: a rattle, not a crack."**

Answered by §3.9 `ImpulseEvent` and §4.3 `src/solve/impulses.ts` / `src/cloth/impulseQueue.ts`.
Two changes:

1. `chan.accelL/accelR` and `chan.pelvisYawRate` are computed **analytically** from
   `kimeEaseAcc(τ, tauP) × pathLength` and `holdThenSnap′`, at the channel's own 480 Hz grid. They are
   never finite-differenced from the baked pose. `tests/contracts/ease.test.ts` asserts
   `kimeEaseAcc === numeric d²S/dτ²` to 1e-6.
2. The cloth snap no longer thresholds a signal at all. `S15` emits **exactly one** `limb-stop`
   `ImpulseEvent` per acting limb per move — asserted as a stage invariant — carrying `deltaVMs`,
   `dirWorld` and an exact `crackDelayTicks ∈ [38, 77]` (10–20 ms at `TICK_HZ = 3840`, resolution
   0.26 ms). `src/cloth/impulseQueue.ts` fires each event once and only once, forward playback and
   after a seek alike, asserted by `tests/cloth/impulse.test.ts`.

The crack is therefore a single impulse at a single exact time, and the 10–20 ms delay is a real
quantity rather than a value snapped to an 8.33 ms grid.

**A-3 · "No runtime look-dev knob exists anywhere. Every visual judgement is a recompile: there is no
layer gain, so 'the hips read dead' is answered by editing `CHANNEL_DYN.pelvisYaw.lead` and waiting
250 ms per trial. A's own §4.1 settles the gi sheen dispute (0.40) and the anisotropy dispute (0.18,
against doc 05 §11's explicit NO) by argument rather than by eye."**

Answered by §3.9 `LayerTrack`, §6.5, and `src/ui/look.ts`:

* Five baked delta layers with **live runtime weights**: `koshi`, `kime`, `breath`, `gaze`, `patch`.
  "The hips read dead" is now a slider, evaluated at 60 fps with no recompile.
* A `LOOK` GUI folder mutates material and light parameters live — they are runtime objects, so this
  costs nothing.
* A `DISPUTES` folder ships **one A/B toggle per `disputeId`**, generalised to all 14 live disputes,
  not just sheen. The doc 04 §12 and doc 07 §7 disputes (hanmi 45 vs 90, front load 55/59/62/70,
  age-uke forearm 25 vs 45, chudan-uke elbow 62 vs 90) only ever close by a human toggling them side
  by side in one session, and now they can be.
* The sheen dispute ships at `0.45` **as a live slider** with the explicit note that only Channel D
  settles it — decided by eye, not by argument.
* Anisotropy ships at 0.18 with doc 05's actual objection satisfied by construction: an itemSize-4
  analytic tangent with a real handedness `w` (§2.7), tested.

**A-4 · "Capture plan has no `CAM_RIGHT` and no camera below eye height. `CAM_TOP` catches a global
mirror, but a per-limb left/right asymmetry, an elbow flaring on one side only, or a hikite that is
lazy only on migi techniques is invisible to the entire loop."**

Answered by §5.7 and §7.3. `M_RIGHT` fires on **all 12 right-arm kime**. `LOW34` (persp 35°,
`(1.3H, 0.35H, 1.7H)`) is in the **default** shot list on every kime — the one framing that exposes
stance depth and head bob in the same frame. `M_TOP` is promoted from once-per-kata to every kime.
`DETAIL_HANDS` / `DETAIL_FEET` cover steps 1, 9, 17, 18. Total 140 PNGs per kata at the `fast`
profile, ~1.3 min.

**A-5 · "`src/eval/metricSpecs.ts` will punish A's own correct numbers, and the fix queue will act on
it. 07 §6.2 metric 6 `hip_height_H` is seeded ref 0.470 ±0.025 … A ships `FIGHT_PELVIS_Y = 0.410`
(right) … so the delta is +0.060, lands exactly on the hard-fail edge, and an agent raising it improves
the score while standing the karateka up out of kihon depth. Same structure on metric 35 … and metric
37 … which alone breaks gate G-4 on four consecutive steps."**

Answered by §2.6. The reference-precedence rule is stated verbatim, typed as `MetricSpec.refSource`,
and enforced by `tests/eval/precedence.test.ts`. All eight named overrides ship: metric 1 → 0.533,
2 → 0.170, 3 → 57, 4 → 10, **6 → 0.410**, 7 → 59, 9 → 30, **35 → 25**, **37 → 121 flex**. Doc 07's
tolerances are kept exactly. Every override is logged in `data/reference/overrides.md` and checked by
`tools/verify-reference.mjs`. And `FixQueueEntry.suggestedDelta` is **`null`** whenever `refSource` is
`'doc07'` and an override exists, so the automated nudge can never walk the rig away from docs 01/03.

**A-6 · "The headline worked example is internally inconsistent, in the document whose whole thesis is
provenance exactness. §6.4 prints `stance_len_H value 0.4968 ref 0.5400 Δ −0.0432 score 41`. 07 §6.2
defines metric 1 as heel-to-heel … for which 01 §3.1's derived row is 0.533 H, not the 0.540 H
ankle-to-ankle value A substitutes; and score 41 at Δ 0.0432 back-solves to tol ≈ 0.010, versus
`ZENKUTSU.S.tol = 0.040` and 07's ±0.05. Three tolerances and the wrong datum for one number."**

Answered by §2.3 and §7.4. `ZENKUTSU_HEEL_TO_HEEL_H = 0.533` is a **derived** constant with its
arithmetic printed in the scorecard row:
`S − HEEL_BEHIND·cos(yawFront) + HEEL_BEHIND·cos(yawRear) = 0.540 − 0.052·cos3° + 0.052·cos30°`,
checked by `tests/data/derived.test.ts` to ±5e-4. There is now exactly **one** scoring tolerance
(doc 07's ±0.05), one reference (0.533), and `Num.tol` is documented in §3.5 as *how well we know the
constant, never used in scoring*. The rewritten row in §7.4 is arithmetically self-consistent.

**A-7 · "The derivative metrics are unmeasurable at the specified sampling rate. §6.2 plans '8 evenly
spaced sub-ticks × 1 camera pose-only' per move; at T1 that is ~260 ms between samples, against metric
50 `kime_decel_time_s` at ref 0.07 s ±0.04 and metric 54 `kiai_frame_alignment_s` at ±0.06 s. Both sit
inside gates G-1/G-4."**

Answered by §7.1 and §7.3. The 8-sub-tick plan is deleted. The harness dumps the **whole-kata
canonical-joint stream at 480 Hz** (`joints.f32`, `CANONICAL_COUNT × 3` f32 per frame — 7.9 MB per
kata) plus the 480 Hz channel stream. `kime_decel_time_s` at 0.07 s now resolves to 34 samples and
`kiai_frame_alignment_s` at ±0.06 s to 29. And metrics 49–52 read the **joint stream**, never
`chan.accel*` — those channels are cloth/impulse drivers only, so G4 cannot measure the compiler's own
intent.

**A-8 · "`overrides` cannot express the one intra-move exception in either kata. 02 §6.2 Heian move 4
slides the front foot back 0.50 L … A's override keys are stance/tech/timing scalars only — no
`footExcursion`, no time-varying foot target — so this requires a new `R0` branch in
`src/solve/footPlant.ts`, contradicting the 'median 1 file, 1 field' claim for the single most-disputed
move in Heian."**

Answered by §3.7. `MoveOverride.footExcursion = { foot, atTau, deltaL, torsoRiseH }` is a first-class
authored field, `R0` is a first-class `PivotRule` handled by `footPlanFor` in `src/data/embusen.ts`
(B1, data — not the solver), and Heian move 4 is authored as
`{ foot: 'R', atTau: 0.55, deltaL: −0.50, torsoRiseH: 0.03 }` in
`src/data/patches/heian-shodan/move-04.ts`. `MoveOverride` also gained `hikite`, `dynamics` and
`channelLeadMs` groups so the closed key set is no longer the binding constraint.

**A-9 · "B1 is a dispatch bottleneck and a merge hazard. A's own §6.4 routing table sends 9 of 17
complaint classes to B1 … P5's 'up to 8 blocks in parallel' is really ~3 agents … two findings scoped
to two different moves of the same kata both resolve to `moves[i].overrides` in a single file, so the
per-move escape hatch that A calls 'THE per-move escape hatch' is a single-writer resource."**

Answered three ways:

1. **Split.** A's monolithic B1 becomes **B1 NUMBERS** (`src/data/num.ts`, `constants/**`,
   `embusen.ts`) and **B2 KATA** (`kata/**`, `patches/**`). The routing table in §7.7 now spreads
   across `stances.ts`, `techniques.ts`, `dynamics.ts`, `cloth.ts`, `render.ts` and 41 patch files.
2. **One file per move.** The per-move escape hatch is `src/data/patches/<kata>/move-NN.ts` — 41
   pre-created files. Two agents fixing two different moves are structurally unable to collide.
   The two `patches/*/index.ts` registries are written once, in Phase 1, with all 41 imports present,
   so they never need editing again.
3. **Route by file, not by block.** `tools/fix-route.mjs` groups `fixqueue.json` by
   `fixSite.file` first and emits at most one work item per file. The unit of contention is a file.

**A-10 · "B2 is an 18-file monolith with no inter-stage contract … there is no assertion that stage
N's output is admissible input to stage N+1 — e.g. S12 `clampSwingTwist` runs after S9
`applyPlantLock`, so a clamp that moves an ankle silently breaks a plant lock that S9 already
committed, and the bisect only tells you the pose changed."**

Answered by §4.11. Sixteen stages, each with a **named, asserted exit invariant** in
`src/solve/stageAssert.ts`, listed in full. The specific ordering bug is fixed by construction:
**S12.5 `applyPlantLock` + one corrective leg-IK pass now runs AFTER the clamp** (which is what doc 06
§6.4's L9-vs-IK rule actually prescribes), and asserts planted-foot XZ drift ≤ 1e-4 m. The stage
bitmask remains for bisection, but it is no longer the only diagnostic: `tests/solve/stages.test.ts`
proves admissibility stage by stage, and a non-full mask makes every gate advisory.

**A-11 · "Gi tangents are under-specified for the anisotropy path … `BufferGeometry.computeTangents()`
writes an itemSize-4 tangent and the `USE_TANGENT` GLSL path consumes `vec4` with a handedness `w`. A
vec3 analytic tangent binds without error and mis-shades the entire gi."**

Answered by §2.7 and `src/rig/tangents.ts`. The attribute is **itemSize 4**, `xyz` = the unit warp
direction from the parametric `u` isoline, `w = sign(dot(cross(N, T), B))`.
`tests/rig/tangents.test.ts` asserts `itemSize === 4`, `|w| === 1` for every vertex, `|T| = 1 ± 1e-5`,
`|T·N| < 1e-4`, and `anisotropy > 0 ⇒ attributes.tangent !== undefined`. No `mikktspace` WASM, no
`computeTangents()` call, no index/non-indexed ordering trap.

**A-12 · "No Node-only path from constants to a gate result. A routes all metric computation in-page
… which means every scorecard requires launching Chromium under SwiftShader. `build:track` stops at
the `PoseTrack` hash."**

Answered by §7.1. `tools/ssr.mjs` boots Vite in middleware mode and `ssrLoadModule`s the TypeScript
entry points directly — no new dependency (`vite@8` is already a devDependency), no second build
target. `tools/score.mjs` therefore runs **compile → joint stream → 63 metrics → fault predicates →
gates** entirely in Node, in ~9 s per kata, with no GL. `tests/integration/pipeline.test.ts` runs the
same path under vitest. The browser is now needed only for metrics 60 and 61 and for Channel D
frames. `src/eval/**` and `src/solve/**` may import only `Vector3`, `Quaternion`, `Matrix4`, `Euler`,
`Box3` from `three`, grep-enforced, so they are Node-safe by construction.

**A-13 · "There is no linear interpolator in the codebase … Slerp appears in exactly one place …
spanning ≤7.5° at the peak 900 °/s pelvis rate, where it is provably below perceptual threshold even
at 0.25× slow-mo."** *(the claim itself, which A-1 defeats)*

The claim is now true as stated, because it is now defended by measurement rather than by a
sentence: `src/contracts/ease.ts` exports `kimeEase`, `kimeEaseVel`, `kimeEaseAcc`, `holdThenSnap`,
`criticalDampClosed`, `settle2`, `easeOutCubic`, `easeInOutCubic` and `quatAngleDeg` — and nothing
else. There is no `lerp` on a pose channel anywhere. Slerp appears in exactly two places
(`src/player/sampler.ts` base and layer terms), bounded by G-9a/G-9b, on a ladder that reaches 960 Hz
where the motion requires it. And the anti-linear-yaw guarantee is structural, not gated: pelvis yaw
is *generated* by `holdThenSnap`, so a straight ramp is unrepresentable, and S7 asserts the doc 01
§9.5 X3 predicate `|ψ(0.5) − ψ_start| ≤ 8°` on every move at compile time.

**A-14 · "No inter-stage boundary assertions … `?layers=` can switch a stage off but nothing verifies
stage N's output is legal input to stage N+1, which is what A claims the bitmask buys."**

Same mechanism as A-10: §4.11 lists all sixteen invariants, `stageAssert.ts` runs them after every
stage, and `bakeStats.stageAssertsPassed` records which fired.

### 9.2 Defects named against all three proposals

**S-1 · "GTAOPass re-renders its own depth/normal G-buffer via `renderer.render(this.scene,
this.camera)` (GTAOPass.js:642), while SSAARenderPass/TAARenderPass clears the camera view offset
before returning (SSAARenderPass.js:250–264). So on paused frames the AO term is computed unjittered
and bit-identical on all 32 accumulation frames while the colour converges — the contact crease all
three call 'the single biggest AAA-vs-hobby delta' stays hard-aliased forever."**

Verified in the installed tree (`SSAARenderPass.js:262-264`, `TAARenderPass.js:166`,
`GTAOPass.js:642`) and answered by §5.3. `TAARenderPass` and `SSAARenderPass` are **removed from the
project entirely**; `tests/render/bans.test.ts` greps for both. `src/render/still.ts`
(`StillAccumulator`) owns the jitter: it sets `camera.setViewOffset` from a Halton(2,3) sequence,
renders the **whole composer chain**, additively blits into a `HalfFloatType` accumulation target at
weight `1/32`, and clears the offset. Because GTAO's internal render reads the same `camera`, the AO
term is jittered in lockstep with the colour term. Bonus: sample `k` is a pure function of `k`, so TAA
convergence leaves the determinism ledger.

**S-2 · "'Backface albedo ×0.72' on DoubleSide gi skirt/sleeve/obi tails … Verified: no
backface/second-side colour property exists anywhere in `three/src/materials/`, and all three
proposals ban `onBeforeCompile`. The only route is a duplicated inverted BackSide mesh, which no
draw-call budget, cloth-upload path or shadow-cost estimate in any proposal accounts for."**

Answered by §5.5. The claim is deleted. `src/cloth/giShell.ts` generates a real **inner shell** — the
same quad grid offset along `−N` by 0.63 mm (the measured 12 oz duck thickness of doc 06 §7.1) with
inverted winding, welded at the free edges, derived from the outer surface in the same upload pass.
Every gi material is `side: FrontSide`; **there is no `DoubleSide` in this project** and the ban is
grepped. Costs are budgeted: +1.9 k triangles, **zero** extra draw calls (same buffer), +0.05 ms
upload (§6.6). The interior darkens for real via GTAO, shadow and inverted normals.

**S-3 · "Gate G-5 is defined against a kata none of them implements. Every proposal lists G-5 as
'Channel C PCK@0.030H ≥ 0.85 on ≥6 annotated PD reference postures', and 07 §2.1 identifies the 16
plates as the full **Heian Nidan** posture sequence. Neither Taikyoku Shodan nor Heian Shodan appears
in that set … and none of the three flags it."**

Answered by §7.6 Channel C. G-5 is redefined as **posture-matched**, not step-matched:
`assets/reference/pd-1925/posture-match.json` maps each plate to the
`(technique, stance, side, level)` it shows and thence to the nearest step in our kata showing the
same posture — Heian Nidan shares gedan-barai in zenkutsu, jodan age-uke, chudan oi-zuki and chudan
shuto-uke in kokutsu with our two kata, which is well over 6 matches. The mismatch is stated in the
document. The match file is **human-signed before G-5 is armed** (Phase 5), and comparison is
topology-only: `src/eval/pd1925.ts` refuses to include `stance_len_H`, `stance_width_H` or
`hip_height_H`, exactly as 07 §6.7 step 6 mandates.

**S-4 · "Metric 60 `silhouette_IoU` is a fatal gate on an admittedly invented number. All three place
`silhouette_IoU < 0.70` inside gate G-2 (fatal), while 07 uncertainty 12 states plainly that the
thresholds 'are invented, calibrated by intuition about capsule-envelope overlap at radius 0.028H' and
that the envelope radii are the more likely error. None of the three schedules a re-calibration of the
envelope radii before promoting the threshold to a build-blocking fatal."**

Answered by `MetricSpec.armed` (§3.11) and `tools/calibrate-envelope.mjs`. Metric 60 ships with
`armed: false`: it is scored and reported but **cannot fail a gate**. In Phase 3,
`npm run calibrate` fits the Channel-B capsule radii (limb / torso / head) to maximise IoU between our
own render and our own envelope over a hand-verified pose set, freezes them, and writes a calibration
report. Flipping `armed` to `true` is an integrator commit that must cite that report. `G-2` tests
armed metrics only.

### 9.3 Graft audit — imported ideas, rejected defects

Each row is a graft the panel required. The middle column is the fatal flaw that idea shipped with in
its source proposal; the right column is why this design does not inherit it.

| graft (source) | the defect it shipped with | how this design takes the idea without the defect |
|---|---|---|
| Adaptive dyadic bake + `maxSlerpErrDeg` gate **(B)** | B's refinement criterion was purely angular, so `NumberKeyframeTrack`s — `clothDriver.snapImpulse`, `pelvisDropIK`, `headSpring` — plausibly stayed on the 1/64 s (15.6 ms) floor, larger than the whole 10–20 ms crack delay they encode | Two criteria, not one (`0.25°` **and** `12°/interval`), plus a **third** that is explicitly temporal: G-9c requires every declared timing quantity under 20 ms to be an exact integer tick. `chan` is uniform 480 Hz (2.083 ms); events are exact ticks (0.26 ms). |
| Weightable expressive layers **(B)** | `PropertyMixer._slerpAdditive` is non-commutative, order-dependent and non-linear in weight, so doc 04 §2.1's 15° X-factor cap was unenforceable on `chest`; gaze and whip fought on one bone with no arbitration | No `AnimationMixer` at all. Composition order is **frozen** in `LAYER_ORDER`; deltas are built by inversion so `w = 1` reproduces the compiled pose exactly; S14 checks the composed chest yaw at the **corners of the whole legal weight box** against ≤ 17°; and the capture path aborts on any non-default weight. |
| `layer.patch` corrective channel **(B)** | B's patch was a bone-local quaternion delta with no tool to convert a positional complaint into one, living in block C's `clip/layers.ts` — so the scoped fix still collided with the kata author | `PatchKey` is authored as `{bone, atTau, axis, deltaDeg, widthS}` — degrees about a named local axis, human-writable — and lives in `src/data/patches/<kata>/move-NN.ts`, one file per move, owned by B2. |
| `refByStance` / `refByLevel` **(B)** | — (a clean graft; A's single `ref: number` could not express 07 §6.2's alternate-stance table and would have scored Heian's kokutsu steps 18–21 against zenkutsu references) | Taken verbatim, plus `refByKata` for metric 48 `kata_total_s` (35.25 vs 39.75). |
| Two capture profiles `fast` / `hero` **(B)** | B's capture loop called `seek(t, {exact:true})` inside `for mark × for cam`, replaying cloth from `t = 0` 92 times per kata — ~5.5 minutes of pure cloth before a pixel | `buildCapturePlan` returns a tick-sorted list and `tools/capture.mjs` seeks **strictly forward**, so cloth advances through the kata exactly **once per run**. |
| `m.right` on all right-arm kime + Channel C as the only independent mirror detector **(B)** | — | Taken verbatim (§7.3, §7.6). |
| Banned-construct CI greps **(B)** | — | `tools/verify-contracts.mjs` + `tests/render/bans.test.ts`, extended to `TAARenderPass`, `SSAARenderPass`, `DoubleSide` and `FXAAPass`. |
| Per-boundary assertions modelled on B's seam check **(B)** | B's own mitigation was the defect: on a seam failure the compiler inserted a 0.12 s `easeInOut` bridge — a 7-frame non-`kimeEase` region dropped inside a technique, i.e. rubric A9 introduced by the build system | We do not splice segments and there are no seams to bridge. The compiler bakes one continuous track per kata. Inter-stage assertions **throw**; they never repair. There is no code path anywhere that inserts unauthored motion. |
| `gen-reference.mjs` **(B)** | "the scorecard can never disagree with the rig" is a tautology dressed as a check; B's only independent channel was contractually barred from checking the two numbers most likely to be wrong | **Rejected.** The ref bank is hand-authored from docs 01/03/02 with doc 07 tolerances, and `tools/verify-reference.mjs` greps the cited doc section for the literal value. The scorecard retains the ability to disagree with the rig. §4.9 states that `gen-reference.mjs` must never be created. |
| Reference-precedence rule **(C)** | C carried the `L = 0.520` error anyway *and* duplicated it per-kata in `KataDoc.L`, and discarded 8 of 13 rows of 01 §3.2 as "solved" with no test that they were re-derived | The rule is typed (`refSource`), tested (`precedence.test.ts`), and `L` is **derived** from `ZENKUTSU.S.v` in exactly one place with the ankle-datum decision stated (§2.3). `tests/solve/stances.test.ts` asserts the solver reproduces *every* 01 §10 constant including `kneeFront 57`, `kneeRear 10`, the knee-X offset and the hip-Z offsets. |
| Whole-kata canonical-joint stream **(C)** | C's stream came from a runtime simulator whose per-tick budget was 2–4× optimistic and whose scrub preview showed a different figure than release | Our stream is dumped from a **compiled** track, so it costs ~9 s in Node with no GL and no frame budget at all. |
| `src/eval/faults.ts` as executable predicates **(C)** | — | Taken verbatim: 01 §9 (Z/K/B/Y/X) and 03 §11 (F) as `CriticFinding[]` with tier and blame, not folded into widened tolerances. X3 is additionally a **compile-time** stage invariant (S7). |
| `CAM_LOW34` **(C)** | C put it in the prose and left it out of the loop: §6.1 rendered 3 cameras and §6.2 passed `--cams front,left,hero` | `LOW34` is in `buildCapturePlan`'s **default** per-kime camera set (§7.3) alongside `M_FRONT`, `M_LEFT`, `M_TOP`, `HERO`. |
| Cloth swatch calibration gate **(C)** | — | `tests/cloth/swatch.test.ts`, a Phase-3 exit gate: 0.20 m swatch, 3 cm grid, clamped edge, 2 s settle, free edge droops 7.5 ± 1.5 cm. Until it passes, `alpha_bend` is wrong and the gi is a bed sheet (06 §7.10 rule 6). |
| `verifyDeterminism.mjs` fuzzer **(C)** | C's own gate was unsatisfiable against its own 4 MB LRU cap versus a 7.3 MB checkpoint set, and its cold-start path gave cloth 120 ticks against a 61 %-residual obi | Our seek is not re-simulation. `sample(tick, w)` is a pure array read (§6.2), so the fuzzer is trivially satisfiable; cloth is fenced separately (§6.4) and read by no G1–G4 metric. G-7 = 200 random seek sequences per kata, zero mismatches. |
| Gates at **two** tempi **(C)** | — | G-11. Phase-5 exit requires G-1…G-10 at T1 **and** T2. |
| `verifyOwnership.mjs` + `handoff-<block>.md` **(C)** | C's tool guarded only *across* blocks, while its own block B was 17 coupled files behind one normative orchestrator that two agents both had to edit | Ownership is by **exact path** in `docs/OWNERSHIP.md`, routing is **by file**, and the per-move hatch is one file per move. `verifyOwnership.mjs` guards across blocks; routing guards within them. |
| Grep-enforced three.js containment **(C)** | C's containment forced rig geometry through a descriptor layer and a bridge, moving work across a block boundary | Our allowlist is per-tree with a **named-import** exception for `Vector3`/`Quaternion`/`Matrix4`/`Euler`/`Box3` in `src/solve` and `src/eval`. `src/rig/**` may use three freely; `src/cloth/**` may not. This is what makes the Node path work without restructuring the rig. |
| `tests/integration/pipeline.test.ts` **(C)** | — | Taken verbatim, and extended: `tools/score.mjs` uses the same SSR path so CI and the agent loop run identical code. |
| `SolveDiagnostics` as a first-class stream **(C)** | C kept per-frame per-bone clamp saturation, which at 480 Hz × 52 bones is 4.6 MB of mostly zeros | Per-frame for `ikResidualM`, `plantSlipM`, `comErrH`, `headYH`, `pelvisYawDeg`; **per-move maxima** for `clampSatByMove`. Plus a `worst` summary written into `run.json`, which is the discriminator the router needs: high `clampSat` **together with** high `ikResidual` means the authored target is outside human ROM — a data bug, not a solver bug. |
| Gate G-8 `ikResidual < 0.005 m` at arrival ticks **(C)** | C's design made the arrival tick position-authoritative by fiat and then took 76 % of the score there, so the 92 ms brake it existed to get right was scored only at weight 0.14 | We solve IK at **compile time**, so G-8 is a free build-time assertion; and because the joint stream is 480 Hz over the whole kata, the brake is measured with 34 samples rather than inferred. |
| C's per-fact tick-rate justification table **(C)** | — | Reproduced as G-9c and `tests/contracts/tickrate.test.ts`: the 17 ms hikite lead, the 10–20 ms crack delay, the 25–35 ms pelvis sink and `T_thrust = 0.13 s` must all survive quantisation. |
| A's `M_OBI`-as-silhouette-device argument **(A, retained)** | — | Retained verbatim in §5.6, and it is now load-bearing at two capture angles that A did not have: `LOW34` and `M_TOP`. |
| A's metrics 62 / 63 **(A, retained)** | — | `forearm_radius_retention` (ref 0.97, hard-fail 0.10) closes candy-wrapper; `hem_overshoot_H` (ref 0.037 H) closes rubric B8, which has no metric in doc 07 at all. |

### 9.4 Defects deliberately *not* imported

For completeness, the mechanisms in B and C that this design refuses, and why:

* **`AnimationMixer` and `PropertyBinding` custom-node tracks (B).** Verified:
  `_supportedObjectNames = ['material','materials','bones','map']` (`PropertyBinding.js:36`), so
  `clothDriver.limbAccel.x` resolves to a node literally named `clothDriver.limbAccel` and
  `findNode` fails; `bind()` warns and installs `_setValue_unavailable`. B's entire driver bank —
  pelvis drop, snap impulse, limb accel, head spring, blink — fails silently *en bloc*. We use no
  mixer, no `AnimationClip` and no `PropertyBinding`; the equivalent data lives in `chan` and
  `impulses`, which are plain typed arrays and plain records.
* **`chest.scale` for breath (B).** Propagates down the whole arm chain. Replaced by the childless
  `ribcage` bone (§2.8) with a test that no other bone ever scales.
* **`toCreasedNormals` → `computeTangents()` (B).** `BufferGeometryUtils.js:1319` always returns a
  non-indexed geometry and `BufferGeometry.computeTangents()` errors out when `index === null`. We
  emit tangents analytically (§2.7) and never call `computeTangents()`.
* **`L = 0.520 H` alongside `STANCE_TABLE.S = 0.540 H` (B).** A 3.85 % disagreement that its own
  closure assertion could not see. Resolved in §2.3.
* **Runtime forward simulation as the pose source (C).** Makes a solver bug and a seek bug produce the
  same scorecard symptom, makes reverse playback structurally impossible, and makes the scrub preview
  a different animation. Our pose is a compiled array; reverse is free; the preview differs from
  release in cloth only, and no G1–G4 metric reads cloth.
* **`ROM` inside a hard-frozen contract file (C).** C's own canonical fix example
  (`clampSaturation[upperarm_R] = 0.97`) required unfreezing a Phase-0 file mid-loop. Here `ROM` lives
  in `src/data/constants/rom.ts`, owned by **B1**, editable by a fix agent; only the *bone identity
  table* is frozen.
* **`MetricId = string & {__metric}` (C).** Throws away compile-time exhaustiveness. We use the
  63-member verbatim string union (§3.11).
* **Time dilation as a degradation path (C).** Destroys the JKA contrast-in-speed criterion outright.
  Our degradation path is quality tiers (§6.6): fewer cloth particles, half-res GTAO, fewer still
  samples, one fewer ladder rung — never slower time.

---

## 10. What will most likely make this look cheap — and the countermeasure

**Two things, in this order. Neither is shading.**

**First: the head rising and the pelvis bobbing during steps.** Doc 01 §8.1 puts the fail threshold at
0.034 H peak-to-peak head oscillation and says above it the figure "reads as a person walking in
costume"; doc 04 §7.3 tightens a level step to 0.008 H peak-to-peak with 0.012 H as the max; Cazeau
et al. 2021 give the physical reason — zenkutsu stepping deliberately *suppresses* the inverted-pendulum
PE↔KE exchange that makes walking cheap. It is also geometrically forced if you are careless: at
`S = 0.540 H` and `PELVIS_Y = 0.410 H` the mid-step support knee must flex **78.2°** to hold height
(01 §7.A), and any IK pass allowed to relieve that knee silently trades 6 cm of head rise for comfort.

Countermeasure, all structural:
1. `pelvisY` is an **input** to `solveStance`, never an output. S3's exit invariant asserts it equals
   its input to 1e-9, so bobbing is not tuned down — it is unrepresentable.
2. The leg-IK pelvis pass may only *lower*: `dy = clamp(dy, −0.060·H, 0)` (06 §6.3 step 4), in the
   solver, not in a config.
3. Metric 17 `head_bob_H` (ref ≤ 0.010, tol +0.010, hard-fail +0.030) is `fatal: true, armed: true`,
   and `diagnostics.headYH` carries the full 480 Hz trace so the failure appears as a **graph** in
   `contact-sheet.png`, not only as a number.
4. `LOW34` is in the default shot list because a low three-quarter exposes head bob and stance depth
   in the same frame.

**Second: linear interpolation between correct poses.** Doc 04 §4.4 is the number that separates
karate from mime: at `τ_p = 0.73`, **48.6 % of the technique's duration covers the first 20 % of the
path and only 18.0 % covers the last 20 %.** Linear spends 20 % on 20 % — a 2.4× error exactly where a
trained eye reads. And doc 01 §9.5 X3 flags a *linear pelvis yaw ramp* as "high severity — reads
robotic".

Countermeasure, all structural:
1. `src/contracts/ease.ts` exports `kimeEase` and friends and nothing else. There is no `lerp` on a
   pose channel in the codebase.
2. Pelvis yaw is **generated** by `holdThenSnap` (hold to τ = 0.55, then `1 − (1 − u)³`), so a
   straight ramp has no code path. S7 asserts the X3 predicate at compile time on every move.
3. The bake is gated on `maxStepDeg ≤ 12` as well as `maxSlerpErrDeg < 0.25` (G-9), so the velocity
   staircase that defeats "no linear interpolation" in practice is bounded, on the 6 285 °/s channel,
   by a build gate rather than by an argument.
4. Metrics 50 `kime_decel_time_s` (0.07 s ±0.04), 51 `hip_lead_lag_s` (−0.06 s, **sign inversion is
   fatal**) and 52 `accel_profile_skew` (0.30 ±0.12, where 0.5 means linear) sit inside G-1 and G-4 and
   are measured off a **480 Hz** joint stream, not off the compiler's own intent.

Runners-up, each already wired to a gate: rear heel lifted (metric 10 — and 01 §3.5 proves it is
geometrically forced above `S > 0.580 H`, so the fix is `yawRear`, not effort) · rigid gi (metric 63
plus the swatch gate — generic cloth settings give 2 cm folds where 12 oz canvas gives 6–9 cm) ·
sleeve rattle instead of crack (one `ImpulseEvent` per brake, asserted) · no contact shadow (metric 61
plus GTAO at 0.30 m and the `StillAccumulator` that finally lets the crease resolve) · both arms moving
symmetrically (metric 51 plus the 17 ms hikite lead, carried as an exact tick count) · perfect
bilateral symmetry (a seeded ±1.5 % asymmetry in limb radii and a 0.6° resting pelvis roll, both drawn
once from `trackHash`) · and 8-head heroic proportions, which 07 §4 warns make stance depth read
shallower than the numbers say — we ship **7.7 heads** (`head 0.130 H`), enforced by
`tests/data/proportions.test.ts`.
