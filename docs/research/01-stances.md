# 01 — Shotokan Stance Geometry (dachi) — Machine-Actionable Spec

Scope: heisoku-dachi, musubi-dachi, hachiji-dachi / heiko-dachi (yoi), zenkutsu-dachi, kokutsu-dachi,
kiba-dachi, and the transitional half-step. Target style: **JKA / Nakayama lineage Shotokan**.
Consumer: animation/IK code. All rows are `param | value | unit | tolerance | source`.

**Self-check:** every geometric number below is re-derived and asserted by
`docs/research/_verify_01_stances.py` (61 assertions, `python _verify_01_stances.py`, exit 0 = consistent).
Re-run it after editing any constant in this file.

---

## 0. Conventions (NORMATIVE — all tables below assume this)

| item | value |
|---|---|
| handedness | right-handed |
| up | `+Y` |
| character forward at yoi | `-Z` |
| character's LEFT | `+X` (verify: `left = forward × up = (-Z)×(+Y) = +X`) |
| embusen (floor pattern) plane | `XZ`, `Y=0` = floor |
| yaw | rotation about `+Y`, right-hand rule. **Positive yaw turns the character toward their RIGHT.** (`R_y(+30°)·(0,0,-1) = (-0.5,0,-0.866)`) |
| pitch | rotation about `+X` (local). Positive = lean **backward** for a `-Z`-facing character. Spec below quotes *forward lean* as a signed magnitude; convert per rig. |
| roll | rotation about `-Z`(local forward). Positive = right shoulder down. |
| Euler order | apply `YXZ` (yaw → pitch → roll) on pelvis; state explicitly in the rig |
| "stance LENGTH" `S` | along-embusen (fore/aft) distance between the **two ankle joint centres** |
| "stance WIDTH" `W` | lateral (embusen-normal) distance between the **two ankle joint centres** |
| `H` | total body height (standing, top of head) |
| cm column | evaluated at `H = 175 cm` |
| `[DERIVED]` | number produced by this document from a verbal source + stated assumption |
| `[MEASURED]` | number from an instrumented study |
| `[TRAD]` | number from traditional/instructional authority |

**Stance handedness naming:** `hidari` = left foot forward, `migi` = right foot forward.
All numeric tables are written for **hidari**. For `migi`, negate every `X` and every yaw.

---

## 1. Anthropometric basis (needed to convert "two shoulder widths" → fraction of H)

Standard segment-length-as-fraction-of-stature constants (Drillis & Contini 1966, as reproduced in
Winter, *Biomechanics and Motor Control of Human Movement*, Fig. 4.1). Used as the rig's skeleton.

| param | value | unit | tol | cm @H=175 | source |
|---|---|---|---|---|---|
| `SHOULDER_W` (bideltoid) | 0.259 | H | ±0.020 | 45.3 | [1] |
| `HIP_W` (bi-iliac) | 0.191 | H | ±0.015 | 33.4 | [1] |
| `HIP_JOINT_SEP` (L↔R hip joint centres) | 0.098 | H | ±0.010 | 17.2 | [DERIVED from 1] |
| `THIGH` (hip jc → knee jc) | 0.245 | H | ±0.012 | 42.9 | [1] |
| `SHANK` (knee jc → ankle jc) | 0.246 | H | ±0.012 | 43.0 | [1] |
| `LEG_EXT` = THIGH+SHANK | 0.491 | H | — | 85.9 | derived |
| `ANKLE_Y` (ankle jc height) | 0.039 | H | ±0.004 | 6.8 | [1] |
| `KNEE_Y` (shin vertical) | 0.285 | H | — | 49.9 | [1] |
| `HIP_Y_STAND` (greater troch.) | 0.530 | H | ±0.010 | 92.8 | [1] |
| `EYE_Y_STAND` | 0.936 | H | ±0.008 | 163.8 | [1] |
| `FOOT_LEN` | 0.152 | H | ±0.010 | 26.6 | [1] |
| `FOOT_BREADTH` | 0.055 | H | ±0.006 | 9.6 | [1] |
| `TOE_AHEAD_OF_ANKLE` | 0.100 | H | ±0.008 | 17.5 | [DERIVED: 0.66·FOOT_LEN] |
| `MTP_AHEAD_OF_ANKLE` (ball of foot) | 0.070 | H | ±0.008 | 12.3 | [DERIVED: 0.46·FOOT_LEN] |
| `HEEL_BEHIND_ANKLE` | 0.052 | H | ±0.006 | 9.1 | [DERIVED: 0.34·FOOT_LEN] |

**Unit conversion for karate literature:** `1 shoulder width (sw) = 0.259 H = 45.3 cm @H=175`.
`1 hip width = 0.191 H`. `1 foot length = 0.152 H`.
So `2 sw = 0.518 H`; `1.5 sw = 0.389 H`; `2.5 sw = 0.648 H`.

Sources: [1] https://www.openlab.psu.edu/design-tools-proportionality-constants/ (method + Drillis&Contini
provenance; the page warns `shoulder breadth` correlates only `R²≈0.15` with stature — see §11)

**Non-negotiable nonlinearity warning for animators:** near full knee extension, pelvis height is a
*very* flat function of knee flexion. Do not read verbal "slightly bent" as a small angle.

| knee flexion (both legs, feet under hips) | pelvis Y | drop from 0.530H |
|---|---|---|
| 0° | 0.530 H | 0.000 H |
| 30° | 0.513 H | 0.017 H (3.0 cm) |
| 56° | 0.470 H | 0.060 H (10.5 cm) |
| 65° | 0.450 H | 0.080 H (14.0 cm) |
| 73° | 0.430 H | 0.100 H (17.5 cm) |
| 78° | 0.410 H | 0.120 H (21.0 cm) |
| 84° | 0.400 H | 0.130 H (22.8 cm) |

---

## 2. THE MASTER INVARIANT — one working height for all fighting stances

The single strongest "does this look like karate" cue. JKA doctrine: zenkutsu-dachi, kokutsu-dachi and
kiba-dachi are the **same height**, so transitions cost no vertical work and the head does not bob.
Wikipedia's karate-stances article states the height of these stances is ideally identical; the same
principle appears in JKA-lineage instruction as "keep the same height moving forward and back".

| param | value | unit | tol | cm @H=175 | source |
|---|---|---|---|---|---|
| `PELVIS_Y_FIGHT` (hip jc height, all 3 stances) | **0.410** | H | ±0.010 (JKA) / ±0.020 (pass) | 71.8 | [DERIVED §3–5] |
| `PELVIS_DROP_FIGHT` vs standing | **0.120** | H | ±0.010 | 21.0 | [DERIVED] |
| `PELVIS_DROP` as % of standing hip height | 22.6 | % | ±2 | — | derived |
| `EYE_Y_FIGHT` | 0.816 | H | ±0.010 | 142.8 | derived |
| `TOP_OF_HEAD_Y_FIGHT` | 0.880 | H | ±0.010 | 154.0 | derived |
| `PELVIS_Y_YOI` (hachiji/heiko/musubi/heisoku) | 0.523 | H | ±0.006 | 91.5 | [DERIVED §6] |
| step-down from yoi → fighting stance | 0.113 | H | ±0.010 | 19.8 | derived |

Drop → head-height lookup (for the "is it low enough" critic):

| `PELVIS_DROP` | pelvis Y | top of head | eye Y | reads as |
|---|---|---|---|---|
| 0.00 H | 0.530 H | 175.0 cm | 163.8 cm | standing / not karate |
| 0.06 H | 0.470 H | 164.5 cm | 153.3 cm | moto-dachi (kumite) |
| 0.09 H | 0.440 H | 159.3 cm | 148.1 cm | **too high — FAIL for kihon** |
| 0.12 H | 0.410 H | 154.0 cm | 142.8 cm | **JKA kihon nominal** |
| 0.15 H | 0.380 H | 148.8 cm | 137.6 cm | competition-deep, acceptable |
| 0.18 H | 0.350 H | 143.5 cm | 132.3 cm | over-sunk, hips break |

Sources: https://en.wikipedia.org/wiki/Karate_stances ·
https://www.shotokankarateonline.com/blog/zenkutsu-dachi-stepping-two-ways-of-moving/

---

## 3. ZENKUTSU-DACHI (前屈立ち, front stance) — hidari

### 3.1 Footprint

| param | value | unit | tol | cm @H=175 | source |
|---|---|---|---|---|---|
| `S` stance length (ankle↔ankle, along `-Z`) | **0.540** | H | +0.040 / −0.040 | 94.5 | [DERIVED] / [TRAD] |
| `S` in shoulder widths | 2.08 | sw | 1.93–2.24 | — | derived |
| `S` heel↔heel along embusen | 0.533 | H | ±0.040 | 93.3 | derived |
| `S` hard lower bound (JKA fail below) | 0.500 | H | — | 87.5 | [DERIVED §3.6] |
| `S` hard upper bound (rear heel must lift above) | 0.580 | H | — | 101.5 | [DERIVED §3.5] |
| `W` stance width (ankle↔ankle, along `X`) | **0.170** | H | ±0.040 | 29.8 | [TRAD "one hip width"] |
| front foot `X` | +0.085 | H | ±0.020 | +14.9 | derived |
| rear foot `X` | −0.085 | H | ±0.020 | −14.9 | derived |
| front foot yaw | **+3** | deg | 0 … +8 | — | [TRAD "point front foot slightly inward"] |
| rear foot yaw | **+30** | deg | +20 … +45 | — | [TRAD] (see §11 disagreement) |
| front foot heel Y | 0.000 | H | ≤0.002 | 0.0 | [TRAD] |
| rear foot heel Y | 0.000 | H | ≤0.005 (JKA) / 0.010 (pass) | 0.0 | [TRAD] |
| load-bearing edge, front foot | inside edge + whole sole; pressure vector `-Z` | — | — | — | [TRAD] |
| load-bearing edge, rear foot | inside edge + whole sole; pressure vector `+Z` | — | — | — | [TRAD] |

Foot keypoints, `S=0.540`, `W=0.170` (front ankle at origin; `+Z` = backward):

| point | X (H) | Z (H) |
|---|---|---|
| front heel | +0.088 | +0.052 |
| front ankle | +0.085 | 0.000 |
| front MTP (ball) | +0.081 | −0.070 |
| front toe | +0.080 | −0.100 |
| rear heel | −0.060 | +0.585 |
| rear ankle | −0.085 | +0.540 |
| rear MTP | −0.120 | +0.479 |
| rear toe | −0.135 | +0.453 |

### 3.2 Weight, knees, pelvis — the canonical solution

Derived by 2-link sagittal IK with `PELVIS_Y = 0.410 H`, rear-knee flexion `10°`, and load share taken
as the moment balance about the two ankle joints.

| param | value | unit | tol | source |
|---|---|---|---|---|
| weight, front leg | **59** | % | 55 … 61 | [DERIVED], brackets [MEASURED 55.3] & [TRAD 60] |
| weight, rear leg | 41 | % | 39 … 45 | as above |
| front-knee flexion (0 = straight) | **57** | deg | ±7 | [DERIVED] |
| rear-knee flexion | **10** | deg | 0 … 18 | [TRAD "straight, not locked"] |
| front knee X vs front ankle X | +0.005 | H | −0.005 … +0.015 (never medial) | [TRAD "plumb line just inside the ball of the foot"] |
| `front_knee.Z − front_ankle.Z` (`+` = behind, since forward is `−Z`) | +0.011 | H (1.9 cm behind) | −0.010 … +0.045 | [DERIVED] |
| front shin tilt from vertical (+ = knee ahead) | −2.5 | deg | −7 … +4 | [DERIVED] |
| front knee Y | 0.284 | H | ±0.010 | derived |
| rear knee flexion → rear knee Z vs rear ankle | −0.176 | H (ahead) | ±0.020 | [DERIVED] |
| hip jc Z behind front ankle | 0.221 | H | ±0.020 | [DERIVED] |
| hip jc Z ahead of rear ankle | 0.319 | H | ±0.020 | [DERIVED] |
| rear-leg line lean from vertical | 40.7 | deg | ±3 | [DERIVED] |
| rear-shank lean from vertical (= raw dorsiflexion demand) | 45.7 | deg | ±3 | [DERIVED] |

### 3.3 Pelvis / torso / head

| param | shomen | hanmi | gyaku-hanmi | tol | source |
|---|---|---|---|---|---|
| pelvis yaw (hidari) | **0** deg | **+45** deg | **−45** deg | ±6 | [TRAD] |
| pelvis yaw (migi) | 0 | −45 | +45 | ±6 | mirror |
| torso (shoulder-line) yaw − pelvis yaw | 0 deg | 0 deg | 0 deg | ±8 (kihon), ±12 (kata) | [TRAD] |
| head yaw (absolute, technique direction) | 0 deg | 0 deg | 0 deg | ±5 | [TRAD] |
| head yaw relative to pelvis | 0 | −45 | +45 | ±6 | derived |
| torso pitch (forward lean) | 0 deg | 0 deg | 0 deg | ±3 (JKA) / ±5 (pass) | [TRAD] |
| torso roll | 0 deg | — | — | ±2 | [TRAD] |
| pelvis sagittal tilt (`+` = posterior / tucked) | +7 deg | +7 | +7 | +3 … +12; **never negative** | [DERIVED from "roll the hips up"] |
| pelvis roll (hip line level) | 0 deg | — | — | ±3 | [TRAD] |
| head pitch (gaze) | 0 deg | — | — | 0 … −5 (chin tuck) | [TRAD] |

`hanmi` sign rule (machine form): `pelvis_yaw_hanmi = +45° * (front_foot == LEFT ? +1 : -1)`;
`gyaku_hanmi = -hanmi`. Rationale: hanmi advances the **front-leg-side hip**; a `+Y` yaw advances the
`+X` (left) hip.

### 3.4 The three JKA zenkutsu variants (kata require all three)

| variant | `S` | `W` | pelvis yaw | use | source |
|---|---|---|---|---|---|
| `zenkutsu-dachi` (standard) | 0.540 H | 0.170 H | shomen or hanmi | kihon, most kata | [TRAD] |
| `ashi-zenkutsu` (short/narrow) | 0.40–0.48 H | 0.055–0.09 H (inner foot edges in line) | gyaku-hanmi capable | Heian Nidan mv. 16, 19 | [TRAD] |
| `hiza-kutsu` (technique off-axis) | 0.50–0.54 H | 0.170 H | pelvis ≠ technique direction, up to 45° offset | Heian Yondan mv. 11 (1st half) | [TRAD] |

Source: http://andrebertel.blogspot.com/2014/02/the-three-important-variations-of.html

### 3.5 Why the rear foot MUST be turned out (hard biomechanical constraint)

At `S = 0.540 H`, `PELVIS_Y = 0.410 H`, the rear shank leans `45.7°` from vertical. A flat rear heel
therefore demands that much sagittal dorsiflexion. Turning the foot out by `φ` splits the demand:

| rear-shank lean | φ=0° | φ=20° | φ=30° | φ=45° | φ=60° |
|---|---|---|---|---|---|
| 38° | DF 38.0 / EV 0.0 | DF 36.3 / EV 15.0 | DF 34.1 / EV 21.3 | DF 28.9 / EV 28.9 | DF 21.3 / EV 34.1 |
| 40° | DF 40.0 / EV 0.0 | DF 38.3 / EV 16.0 | DF 36.0 / EV 22.8 | DF 30.7 / EV 30.7 | DF 22.8 / EV 36.0 |

(DF = sagittal dorsiflexion component, EV = eversion/abduction component, degrees.)
Weight-bearing dorsiflexion max is `≈25–35°`. Consequences the rig must respect:

| finding | value | source |
|---|---|---|
| minimum rear-foot yaw for a flat heel at `S=0.54H` | ≥ 30 deg | [DERIVED] |
| heel lift if `φ=30°` and ankle DF capped at 25° | 0.012 H = 2.1 cm | [DERIVED] |
| heel lift if `φ=30°` and ankle DF capped at 30° | 0.007 H = 1.3 cm | [DERIVED] |
| `S` above which heel lift is unavoidable | 0.580 H (101.5 cm) | [DERIVED] |

This is the numeric reason "long stance + lifted rear heel" is the single most common zenkutsu fault:
it is a *geometric necessity*, not laziness, once `S > 0.58 H`.

### 3.6 The 60/40 vs 70/30 vs 55/45 controversy — resolved geometrically

The three published weight distributions correspond to three different **front-knee positions**, not to
three opinions. All rows: `PELVIS_Y = 0.410 H`, rear-knee flexion `10°`.

| `S` (H) | `S` (cm) | `S`/sw | front load % | front-knee flexion | front knee Z vs ankle | matches |
|---|---|---|---|---|---|---|
| 0.450 | 78.8 | 1.74 | 70.8 | 73.5° | +12.7 cm ahead | "70/30, knee over the toes" dojo teaching |
| 0.470 | 82.2 | 1.81 | 67.8 | 70.6° | +9.7 cm ahead | — |
| 0.490 | 85.8 | 1.89 | 65.1 | 67.3° | +6.6 cm ahead | — |
| 0.510 | 89.2 | 1.97 | 62.5 | 63.6° | +3.3 cm ahead | — |
| **0.530** | 92.8 | 2.05 | **60.1** | 59.2° | −0.1 cm (**shin exactly vertical**) | **Nakayama 60/40** [TRAD] |
| **0.540** | 94.5 | 2.08 | **59.0** | 56.8° | −1.9 cm | **RECOMMENDED** |
| 0.560 | 98.0 | 2.16 | 56.9 | 51.3° | −5.6 cm behind | — |
| **0.580** | 101.5 | 2.24 | **55.0** | 44.9° | −9.5 cm behind | **de Souza 2015 measured 55.27%** [MEASURED] |
| 0.600 | 105.0 | 2.32 | 53.1 | 37.1° | −13.8 cm behind | too long; front knee unloaded |

Corollary (important): Nakayama's own two cues are mutually inconsistent. "Plumb line from the front
knee falls just inside the ball of the foot" (knee `0.070 H` ahead of the ankle) forces **≈70 %** front
load at *every* pelvis height:

| pelvis Y | drop | `S` | front load | front-knee flexion |
|---|---|---|---|---|
| 0.380 H | 0.150 H | 0.502 H (87.8 cm) | 69.9 % | 81.1° |
| 0.395 H | 0.135 H | 0.479 H (83.8 cm) | 70.0 % | 77.2° |
| 0.410 H | 0.120 H | 0.453 H (79.3 cm) | 70.4 % | 73.0° |
| 0.440 H | 0.090 H | 0.391 H (68.4 cm) | 71.6 % | 64.1° |

Pick **one** intent per shot and stay on it. For a *long, JKA-kihon-looking* stance use the 0.530–0.550 H
row (shin ≈ vertical, ~59 % front). For a *short, deep, "sitting into it"* stance use 0.450–0.470 H
(knee over the ball, ~70 % front). Mixing them produces the classic uncanny result: long stance + knee
jammed forward = knee valgus + heel lift.

Sources: de Souza AV, Viero TF, Marques AM, Borges NG Jr. *Weight distribution in karate stances: a
comparison between experimental and postulated values.* Arch Budo 2015;11:351–358
(n=9 male black belts, age 46.8±9.7 y, mass 85.9±16.3 kg, **height 1.76±0.03 m**, experience 31.6±8.5 y;
2× AMTI OR6-GT force plates, 2000 Hz, 5 s hold, 10 Hz low-pass) — https://files.4medicine.pl/download.php?cfs_id=1356 ·
https://www.bhskc.com/post/the-front-stance (Nakayama, *Dynamic Karate*: ≈32 in between the feet,
hip-width wide, 60/40, plumb line just inside the ball of the front foot, back leg straight, hips lowered) ·
https://www.themartialway.com.au/zenkutsu-dachi-front-stance/ (1 sw wide × 2 sw long, ≈66 % front,
front shin vertical / knee above the ankle, inside-edge pressure) ·
https://www.shotokankarateonline.com/blog/shotokan-karate-stances/ (70/30, 1.5 sw long, knee above the big toe)

**Nakayama's 32 in ≈ 81.3 cm.** For a 1.68–1.76 m practitioner that is `0.462–0.484 H` — i.e. the
book's stance is at the SHORT end of the range above (≈65 % front). Modern JKA competition kihon runs
longer. Both are "correct JKA"; they are different eras. Flagged in §11.

---

## 4. KOKUTSU-DACHI (後屈立ち, back stance) — hidari

### 4.1 Footprint

| param | value | unit | tol | cm @H=175 | source |
|---|---|---|---|---|---|
| `S` stance length (ankle↔ankle) | **0.446** | H | ±0.025 | 78.1 | [DERIVED] |
| `S` in shoulder widths | 1.72 | sw | 1.63–1.80 | — | derived |
| `S` heel↔heel along embusen | 0.394 | H | ±0.025 | 69.0 | derived |
| `S` geometric MAX at `PELVIS_Y=0.410 H` | 0.459 | H | — | 80.4 | [DERIVED, hard limit] |
| `W` lateral ankle offset | **0.000** | H | ±0.020 | 0.0 | [TRAD "heels on one line"] |
| both heels on a single embusen-normal line | yes | — | lateral heel Δ ≤ 0.030 H | ≤5.3 | [TRAD] |
| line from rear heel touches inside of front foot | yes | — | — | — | [TRAD] |
| front foot yaw | **0** | deg | −5 … +5 | — | [TRAD] |
| rear foot yaw | **+90** | deg | +82 … +98 | — | [TRAD] |
| load-bearing edge, rear foot | whole sole, bias to **outer** edge; hip strongly ext. rotated | — | — | — | [TRAD] |
| load-bearing edge, front foot | whole sole, light; pressure toward the ball | — | — | — | [TRAD] |

Foot keypoints (`front ankle` at origin, `+Z` backward):

| point | X (H) | Z (H) |
|---|---|---|
| front heel | 0.000 | +0.052 |
| front ankle | 0.000 | 0.000 |
| front toe | 0.000 | −0.100 |
| rear ankle | 0.000 | +0.446 |
| rear heel (yaw +90 → heel goes to `+X`) | +0.052 | +0.446 |
| rear toe | −0.100 | +0.446 |

### 4.2 Weight, knees, pelvis

| param | value | unit | tol | source |
|---|---|---|---|---|
| weight, rear leg | **70** | % | 65 … 75 | [MEASURED 69.74] + [TRAD 70] |
| weight, front leg | **30** | % | 25 … 35 | [MEASURED 30.26] |
| rear-knee flexion | **73** | deg | ±6 | [DERIVED] |
| front-knee flexion | **18** | deg | 10 … 25 | [TRAD "slightly bent"] |
| hip jc Z ahead of rear ankle | 0.134 | H | ±0.015 | [DERIVED] |
| hip jc Z behind front ankle | 0.312 | H | ±0.015 | [DERIVED] |
| front knee Z vs front ankle (`+` = behind) | +0.127 | H | +0.10 … +0.15 | [DERIVED] |
| front shin tilt from vertical (backward) | 31.1 | deg | ±4 | [DERIVED] |
| rear knee X tracking | over the rear-foot long axis, i.e. displaced to `−X` | ±0.030 H | — | [TRAD "rear knee above the big toe, 90° to the front"] |
| pelvis Y | 0.410 | H | ±0.010 | §2 |
| pelvis drop | 0.120 | H | ±0.010 | §2 |
| pelvis yaw (hidari) | **+45** (hanmi) | deg | ±7 | [TRAD] |
| torso yaw − pelvis yaw | 0 | deg | −10 … +5 | [TRAD] (see §11) |
| head yaw absolute | 0 | deg | ±5 | [TRAD] |
| torso pitch | 0 | deg | ±3 | [TRAD "back naturally straight"] |
| body line vs rear leg | COM `0.134 H` **ahead** of the rear ankle | — | ±0.02 | [TRAD "body-line slightly forward of the rear leg"] |
| pelvis sagittal tilt (posterior) | +6 | deg | +3 … +10 | [DERIVED] |

`pelvis_yaw_hanmi(kokutsu) = +45° * (front_foot == LEFT ? +1 : -1)`. Geometric proof that the sign is
forced: with the rear foot at `+90°` yaw, a `+45°` pelvis leaves `45°` of rear-hip external rotation
(within human range); a `−45°` pelvis would demand `135°` (impossible).

### 4.3 Hard geometric result — kokutsu CANNOT be as long as zenkutsu

At `PELVIS_Y = 0.410 H` with 70 % rear load, the front leg must span `0.70·S` horizontally. Straight-leg
reach caps `S` at `0.459 H`. The widely-repeated "front foot two shoulder widths (0.518 H) forward of
the rear foot" is therefore **infeasible** at zenkutsu height:

| forced condition | consequence |
|---|---|
| `S = 0.518 H`, 70 % rear, `PELVIS_Y = 0.410 H` | INFEASIBLE (front leg needs 0.517 H > 0.491 H) |
| `S = 0.518 H`, 70 % rear, front leg straight | `PELVIS_Y = 0.370 H` → drop 0.160 H; rear knee 83.7°; breaks the equal-height invariant |
| `S = 0.518 H`, `PELVIS_Y = 0.410 H` | rear load must fall to ≤ 60 % (front-knee flexion 19.4°) |
| `S = 0.446 H`, 70 % rear, `PELVIS_Y = 0.410 H` | **consistent** (recommended) |

Ranking of the three claims by how much this project should trust them:
1. 70/30 load — [MEASURED], keep.
2. Equal stance height — strong JKA doctrine and cheap to honour, keep.
3. "Two shoulder widths long" — drop it; use `1.72 sw`. It is almost certainly a mis-transfer of the
   zenkutsu figure, or is measured toe-to-heel rather than ankle-to-ankle
   (`front toe → rear-foot inner edge = 0.346 H`, and `front toe → rear ankle = 0.546 H ≈ 2.1 sw`,
   which is probably the origin of the "2 sw" claim).

Sources: https://www.themartialway.com.au/kokutsu-dachi-back-stance/ (rear foot at a right angle, heels
in line, hips 45°, ≈66–70 % rear, "front foot two shoulder-widths forward") ·
https://www.shotokankarateonline.com/blog/shotokan-karate-stances/ (70–80 % rear, 90° feet, hips 45°) ·
de Souza 2015 [MEASURED 69.74/30.26] · https://en.wikipedia.org/wiki/K%C5%8Dkutsu_dachi

---

## 5. KIBA-DACHI (騎馬立ち, horse/straddle stance)

### 5.1 Footprint

The character faces `-Z`; the feet lie on the `X` axis. `S` (fore/aft) is zero — this stance's principal
dimension is `W`.

| param | value | unit | tol | cm @H=175 | source |
|---|---|---|---|---|---|
| `W` (ankle↔ankle, lateral) | **0.520** | H | ±0.020 | 91.0 | [DERIVED to match §2 height] |
| `W` in shoulder widths | 2.01 | sw | 1.93–2.08 | — | derived (≈ [TRAD "2 sw"]) |
| `W` outer-edge to outer-edge | 0.575 | H | ±0.020 | 100.6 | derived |
| `S` (fore/aft ankle offset) | 0.000 | H | ±0.015 | 0.0 | [TRAD] |
| left foot X / right foot X | +0.260 / −0.260 | H | ±0.010 | ±45.5 | derived |
| left foot yaw / right foot yaw | +4 / −4 | deg | 0 … ±8 (toes converge) | — | [TRAD "both facing forward as much as possible"] |
| all four foot corners on floor | Y ≤ 0.003 H | H | — | ≤0.5 | [TRAD] |
| load-bearing edge | whole sole; bias ≈60 % to the **outer** edge, inner edge actively gripping | — | — | — | [TRAD, low confidence — §11] |

### 5.2 Weight, knees, pelvis

Frontal-plane IK with **shins vertical** (the classic JKA cue), so each knee sits directly above its
ankle and the whole flexion appears as thigh abduction.

| param | value | unit | tol | source |
|---|---|---|---|---|
| weight, each leg | **50** | % | ±3 | [MEASURED 49.95 / 50.05] + [TRAD] |
| knee flexion, each leg | **59.5** | deg | ±5 | [DERIVED] |
| thigh abduction from vertical | 59.5 | deg | ±5 | [DERIVED] |
| knee X vs ankle X | 0.000 | H | ±0.010 (never medial) | [TRAD "shin vertical"] |
| knee Y | 0.285 | H | ±0.010 | derived |
| knee Z vs ankle Z | 0.000 | H | ±0.015 | [DERIVED] |
| pelvis Y | 0.4095 | H | ±0.010 | derived |
| pelvis drop | 0.1205 | H | ±0.010 | derived |
| pelvis yaw | 0 | deg | ±5 | [TRAD] |
| pelvis sagittal tilt (posterior / "rolled up") | **+12** | deg | +8 … +16; **never negative** | [TRAD "hips rolled upward"] |
| pelvis roll | 0 | deg | ±2 | [TRAD] |
| torso pitch | 0 | deg | ±3 | [TRAD] |
| torso roll | 0 | deg | ±2 | [TRAD] |
| head yaw | per technique | deg | — | [TRAD] |

`W` ↔ depth relation (shins vertical) — the authoring dial:

| `W` (H) | `W` (cm) | `W`/sw | pelvis Y | drop | drop (cm) | knee flexion |
|---|---|---|---|---|---|---|
| 0.480 | 84.0 | 1.85 | 0.438 H | 0.092 H | 16.0 | 51.2° |
| 0.500 | 87.5 | 1.93 | 0.425 H | 0.105 H | 18.4 | 55.1° |
| 0.510 | 89.2 | 1.97 | 0.418 H | 0.112 H | 19.7 | 57.2° |
| **0.520** | **91.0** | **2.01** | **0.410 H** | **0.120 H** | **21.1** | **59.5°** |
| 0.530 | 92.8 | 2.05 | 0.401 H | 0.129 H | 22.6 | 61.8° |
| 0.540 | 94.5 | 2.08 | 0.391 H | 0.139 H | 24.4 | 64.4° |

Note the strong cross-check: `W = 2.0 sw` independently lands on `PELVIS_Y = 0.410 H`, the same height
derived for zenkutsu from a completely different constraint chain. The equal-height doctrine is
self-consistent at `2 sw` kiba and `~2.08 sw` zenkutsu.

Distinguish from **shiko-dachi**: same width band, feet yawed `±45°` out, thighs closer to horizontal,
pelvis better able to tuck. Kiba-dachi is superior for lateral movement/technique, shiko-dachi for
downward technique.

Sources: http://andrebertel.blogspot.com/2020/12/kiba-dachi-and-shiko-dachi.html ·
https://www.shotokankarateonline.com/blog/shotokan-karate-stances/ ·
https://www.themartialway.com.au/kiba-dachi-horse-stance/ · de Souza 2015 [MEASURED]

---

## 6. STANDING / PREPARATORY STANCES

All four are essentially standing height. `knee flexion = 3°` ("straight but unlocked").

| param | heisoku-dachi | musubi-dachi | heiko-dachi | hachiji-dachi (yoi) |
|---|---|---|---|---|
| `W` ankle↔ankle | 0.055 H (inner foot edges touching — see note) | 0.030 H | **0.259 H** | **0.259 H** |
| `W` cm @H=175 | 9.6 | 5.3 | 45.3 | 45.3 |
| foot X (L / R) | +0.028 / −0.028 H | +0.015 / −0.015 H | +0.130 / −0.130 H | +0.130 / −0.130 H |
| `S` fore/aft | 0.000 H | 0.000 H | 0.000 H | 0.000 H |
| left foot yaw | 0 deg | **−45** deg | 0 deg | **−30** deg |
| right foot yaw | 0 deg | **+45** deg | 0 deg | **+30** deg |
| foot yaw tolerance | ±3 | ±8 (see §11: 30 vs 45) | ±4 | +20…+45 |
| heels touching? | no (feet parallel, inner edges together) | **yes** (heel points coincident) | no | no |
| weight L / R | 50 / 50 ±2 | 50 / 50 ±2 | 50 / 50 ±2 | 50 / 50 ±2 |
| weight fore/aft | 50 / 50 | 50 / 50 | slight ball bias (55 fore) | slight ball bias (55 fore) |
| knee flexion | 3 deg (0…8) | 3 deg (0…8) | 3 deg (0…8) | 3 deg (0…8) |
| pelvis Y | 0.529 H | 0.529 H | **0.523 H** | **0.523 H** |
| pelvis drop vs standing | 0.001 H (0.2 cm) | 0.001 H (0.2 cm) | 0.007 H (1.2 cm) | 0.007 H (1.2 cm) |
| pelvis yaw | 0 deg ±3 | 0 deg ±3 | 0 deg ±3 | 0 deg ±3 |
| pelvis sagittal tilt | +2 deg (0…+5) | +2 deg | +3 deg | +3 deg |
| torso pitch | 0 deg ±2 | 0 deg ±2 | 0 deg ±2 | 0 deg ±2 |
| head yaw / pitch | 0 / 0 ±3 | 0 / 0 ±3 | 0 / 0 ±3 | 0 / 0 ±3 |
| load-bearing | whole sole, even | whole sole, even | whole sole, slight big-toe pressure | whole sole, slight big-toe pressure |

Note on heisoku `W`: with the inner foot edges in contact, the ankle joint centres are one foot breadth
apart (`FOOT_BREADTH = 0.055 H`). If your rig models the feet as touching centre lines, use `W = 0.000`
and expect a 1 cm mesh interpenetration.

**Which is "yoi" for Taikyoku / Heian kata (JKA):** open in `musubi-dachi` (rei/bow) → on the command
*yoi*, step out to `hachiji-dachi` (also called `shizentai`). Treat `hachiji-dachi` as the canonical yoi
pose. Note the yoi step-out is a lateral move of one foot by `0.259 H`, both feet ending at `±0.130 H`.

| yoi transition param | value | tol | source |
|---|---|---|---|
| `hachiji` W (ankle↔ankle) | 0.259 H (= 1 sw) | ±0.030 | [TRAD] |
| `hachiji` foot yaw magnitude | 30 deg | 20 … 45 | [TRAD, disputed §11] |
| `heiko` vs `hachiji` — only difference | foot yaw 0 vs ±30 | — | [TRAD] |
| yoi arm/pelvis height change | 0 | ≤0.005 H | [DERIVED] |

Sources: https://en.wikipedia.org/wiki/Karate_stances (hachiji: shoulder-width, toes 45°; musubi: heels
together, toes ≈45°) · https://traditional-karate.com/karate-do/kihon-basics/tachikata-stances/
(musubi described as a 60° *included* angle → 30° per foot; hachiji shoulder-width, 45°) ·
https://www.karatephilosophy.com/karate-terms-part-3-stances/ ·
https://www.shotokankarateonline.com/blog/shotokan-karate-stances/ (heiko: hip-to-shoulder width,
big-toe pressure)

---

## 7. THE TRANSITIONAL HALF-STEP

Two distinct things share the name. Both are specified.

### 7.A Mid-step transit pose of a full `ayumi-ashi` step (`t = 0.50`)

Forward zenkutsu step, hidari → migi. **Key fact: in a straight-line JKA step each foot keeps a
constant `X`.** Left foot stays at `X = +0.085 H` throughout, right foot at `X = −0.085 H`; only `Z`
changes. There is no lateral crossing.

| param | value | unit | tol | source |
|---|---|---|---|---|
| swing foot total travel along `Z` | `2·S` = 1.080 | H | — | derived |
| swing foot travel, cm @H=175 | 189.0 | cm | — | derived |
| pelvis travel along `Z` | `S` = 0.540 | H | — | derived |
| pelvis Z at `t=0.50` | 0.072 H **ahead** of the support ankle | H | ±0.015 | [DERIVED] |
| support (old front) leg knee flexion at `t=0.50` | **78** | deg | 74 … 82 | [DERIVED] |
| support hip flexion at `t=0.50` (thigh fwd of vertical trunk) | 29 | deg | ±5 | [DERIVED] |
| support knee Z at `t=0.50` | 0.190 H ahead of the support ankle | H | ±0.020 | [DERIVED] |
| swing foot sole clearance (max) | 0.008 | H | 0 … 0.015 (1.4–2.6 cm) | [DERIVED from "feet slide/graze"] |
| swing-foot `Z` at `t=0.50` | passes the support ankle within 0.06 H | H | ±0.04 | [DERIVED] |
| swing knee flexion at `t=0.50` | 85 | deg | 75 … 100 | [DERIVED "knees together at the halfway point"] |
| lateral gap between knees at `t=0.50` | 0.03 | H | 0 … 0.06 | [TRAD "knees come inwards very slightly"] |
| pelvis Y at `t=0.50` | 0.410 | H | ±0.010 | §8 |
| pelvis lateral sway (peak, fast step `t<0.7 s`) | 0.015 | H | ≤0.020 | [DERIVED] |
| pelvis lateral sway (peak, slow kata step `t>1.5 s`) | 0.035 | H | ≤0.045 | [DERIVED] |

Support-knee flexion ↔ head-rise trade (this is the whole "dip / no-dip" question in one table):

| head rise at mid-step | pelvis Y | support-knee flexion needed | verdict |
|---|---|---|---|
| 0.0 cm (0.000 H) | 0.410 H | 78.2° | JKA ideal |
| 1.0 cm (0.006 H) | 0.416 H | 76.1° | JKA pass |
| 2.0 cm (0.011 H) | 0.421 H | 74.0° | acceptable |
| 3.5 cm (0.020 H) | 0.430 H | 70.7° | borderline — a critic will see it |
| 6.0 cm (0.034 H) | 0.444 H | 64.8° | **FAIL — reads as walking, not karate** |
| 10.0 cm (0.057 H) | 0.467 H | 54.3° | reads as a person walking in costume |

### 7.B Named half stances

| param | han-zenkutsu-dachi | moto-dachi (kumite base) |
|---|---|---|
| `S` ankle↔ankle | **0.270 H** (47.3 cm) | **0.300 H** (52.5 cm, ≈1 shank length 0.246 H + foot) |
| `S`/sw | 1.04 | 1.16 |
| `W` | 0.170 H | 0.100 H ("≈2 fist widths") |
| front foot yaw | +3 deg | +3 deg (0…+8) |
| rear foot yaw | +30 deg | +25 deg (+20…+30) |
| pelvis Y | 0.410 H (holds fighting height) | **0.470 H** |
| pelvis drop | 0.120 H | **0.060 H** (10.5 cm) |
| front-knee flexion | 74.6 deg ±6 | 46 deg ±6 |
| rear-knee flexion | 71.0 deg ±6 | 40 deg ±6 |
| weight front / rear | 55 / 45 ±5 | 55 / 45 ±5 |
| pelvis yaw | hanmi ±45 or shomen 0 | hanmi ±30 (±10) |
| use | mid-kata compressions, Heian Nidan-type short stances | kumite ready, ido-kihon at speed |

`yori-ashi` / `tsugi-ashi` sliding half-step (stance shape preserved, both feet advance):

| param | value | tol | source |
|---|---|---|---|
| advance per slide | 0.250 H (43.8 cm) | 0.15 … 0.35 H | [DERIVED] |
| stance shape change during slide | none: `ΔS ≤ 0.02 H`, `ΔW ≤ 0.02 H` | — | [TRAD] |
| pelvis Y change | 0 | ≤0.006 H | [TRAD] |
| both soles clearance | 0.003 H (slide, not lift) | ≤0.008 H | [TRAD] |

Sources: https://www.shotokankarateonline.com/blog/zenkutsu-dachi-stepping-two-ways-of-moving/
(same height forward and back; straight line; knees together at the halfway point; drive off the back
leg from the halfway point; width between hip and shoulder width) ·
https://www.shotokankarateonline.com/blog/you-are-stepping-in-zenkutsu-dachi-incorrectly/ (straightest
line A→B; initiate with a small forward knee movement; no knee cave-in) ·
https://www.glossaria.net/en/karate/han-zenkutsu-dachi · https://en.wikipedia.org/wiki/Karate_stances
(moto-dachi: shin length long, ≈2 fist widths wide, rear foot 20–30°)

---

## 8. DURING A STEP — pelvis height and hip yaw trajectories (NORMATIVE)

Normalised step time `t ∈ [0,1]`; `t=0` = departure pose settled, `t=1` = arrival pose settled +
technique complete. Kihon step duration `0.45–0.70 s`; slow kata step `1.2–2.0 s`.

### 8.1 Pelvis vertical `Y(t)` — the no-dip law

| param | value | unit | tol | source |
|---|---|---|---|---|
| `PELVIS_Y(t)` target | constant 0.410 | H | — | [TRAD] |
| allowed vertical band, JKA-correct | ±0.008 | H (±1.4 cm) | — | [DERIVED] |
| allowed vertical band, acceptable | ±0.015 | H (±2.6 cm) | — | [DERIVED] |
| FAIL threshold (peak-to-peak head oscillation) | > 0.034 | H (>6.0 cm) | — | [DERIVED] |
| permitted intentional sink during drive (`t≈0.15–0.30`) | −0.006 | H (−1.0 cm) | 0 … −0.010 | [DERIVED] |
| permitted rise (any `t`) | +0.008 | H | ≤+0.015 | [DERIVED] |
| head `Y` p-p oscillation, JKA-correct | ≤ 0.010 | H (1.75 cm) | — | [DERIVED] |
| head `Y` p-p oscillation, human walking (anti-target) | 0.026–0.046 | H (4.5–8 cm) | — | reference |

**Why this is expensive and therefore a real quality signal:** Cazeau et al. showed zenkutsu-dachi
stepping costs far more than normal bipedalism precisely because the inverted-pendulum
potential↔kinetic energy exchange of walking is suppressed — the karateka refuses to let the COM rise.
An animation that lets the head rise is animating *walking*.
Cazeau C, Courtonne C, Delacroix S, Lescure Y, Piat C, Stiglitz Y. *Biomechanical study comparing the
energy cost of human bipedalism versus zenkutsu-dachi stepping of a karateka.* Int Orthop
2021;45(9):2435–2443. doi:10.1007/s00264-021-05142-x — https://pubmed.ncbi.nlm.nih.gov/34269821/

### 8.2 Pelvis fore/aft `Z(t)` and foot `Z(t)`

| param | value | tol | source |
|---|---|---|---|
| pelvis `Z` easing | back-loaded: 35 % of travel by `t=0.5`, 100 % at `t=1.0` | ±8 % | [TRAD "drive off the back leg from the halfway point"] |
| pelvis peak speed | ≈2.1× mean (mean 1.57 m/s for `S`=0.540 H, 0.60 s) | ±15 % | [DERIVED] |
| swing-foot mean speed | 3.15 m/s (`2S`=189 cm in 0.60 s) | ±15 % | [DERIVED] |
| swing-foot peak speed | ≈5.7 m/s at `t≈0.6` | ±20 % | [DERIVED] |
| swing-foot `X` | constant `±0.085 H` (straight-line school) | ±0.010 H | [TRAD] |
| swing-foot `X` (semicircular school) | pulled to `±0.020 H` at `t=0.5`, back out by `t=0.9` | ±0.015 H | [TRAD, §11] |
| arrival | toe contact then heel contact; technique impact **at toe contact**, technique complete **at heel contact** | Δt 0.03–0.06 s | [TRAD] |

### 8.3 Pelvis yaw `ψ(t)` — koshi no kaiten

Hip rotation is a late snap, not a linear ramp.

| param | value | tol | source |
|---|---|---|---|
| `ψ(t)` for `t ∈ [0, 0.55]` | hold `ψ_start` | ±5 deg | [TRAD] |
| rotation window | `t ∈ [0.55, 1.00]` | ±0.08 | [DERIVED] |
| 90 % of rotation complete by | `t = 0.92` | ±0.05 | [DERIVED] |
| 100 % complete at | `t = 1.00`, coincident with heel contact | ±0.03 | [TRAD] |
| easing inside the window | ease-out (fast start, settle) — `1-(1-u)^3` | — | [TRAD "whip-like snap"] |
| hanmi → shomen excursion | 45 deg | ±6 | [TRAD] |
| hanmi → gyaku-hanmi excursion | 90 deg | ±8 | [TRAD] |
| mean yaw rate, 45 deg over 0.24 s | 188 deg/s | ±25 % | [DERIVED] |
| mean yaw rate, 90 deg over 0.24 s | 375 deg/s | ±25 % | [DERIVED] |
| peak yaw rate (ease-out, ≈2.4× mean) | 450–900 deg/s | ±30 % | [DERIVED] |
| torso yaw lag behind pelvis yaw | 0.02–0.05 s (≤10 deg transient) | — | [TRAD kinetic chain] |
| head yaw during step | **absolute 0 deg throughout** — head counter-rotates against the pelvis | ±6 deg | [TRAD] |

Standard yaw sequences (hidari → migi step; signs for the *arriving* stance):

| technique pair | `ψ_start` | `ψ_end` |
|---|---|---|
| oi-zuki (lunge punch), stepping | +45 (hanmi) | 0 (shomen) |
| gedan-barai, stepping | 0 or −45 | −45 (hanmi of new stance) |
| gyaku-zuki (in place, no step) | −45 (hanmi) | 0 (shomen) |
| shuto-uke into kokutsu | 0 | +45 → mirrored per arriving stance |

Sources: http://andrebertel.blogspot.com/2011/01/correct-shomen-hanmi.html (Yahara: pure shomen = square,
pure hanmi = 90°; Asai used 30°–90° hanmi and ≈10 %-off shomen) ·
https://www.shotokankarateonline.com/blog/shotokan-karate-exercise-on-shomen-and-hanmi/ (hanmi ≈45°,
range 45–90; shomen = square; snap not grind) ·
https://kjartscentre.com/karate-mechanics-explained-hip-rotation-jun-kaiten-gyaku-kaiten-hanmi-and-shomen/
(jun-kaiten = hips rotate with the technique, gyaku-kaiten = against it)

---

## 9. COMMON MISTAKES WITH NUMERIC SIGNATURES (critic/validator rules)

Every rule is a pass/fail predicate on rig state. `Y` values are world-space heights in units of `H`.

### 9.1 Zenkutsu-dachi

| # | fault | numeric signature | severity |
|---|---|---|---|
| Z1 | stance too short | `S < 0.500 H` (87.5 cm) | high |
| Z2 | stance too long (forces heel lift) | `S > 0.580 H` (101.5 cm) | high |
| Z3 | rear heel lifted | `rear_heel.Y > 0.005 H` (0.9 cm); hard fail `> 0.010 H` | **critical** |
| Z4 | rear knee bent | `rear_knee_flexion > 20°` | high |
| Z5 | front knee not bent enough | `front_knee_flexion < 45°` **or** `front_knee.Z − front_ankle.Z > +0.045 H` (knee behind ankle) | high |
| Z6 | front knee jammed past the foot | `front_knee.Z − front_ankle.Z < −0.075 H` (past `MTP_AHEAD`) | medium |
| Z7 | front knee valgus (collapsing in) | `sign(front_knee.X − front_ankle.X)` medial by `> 0.015 H` | **critical** (looks amateur + injury) |
| Z8 | stance too narrow | `W < 0.100 H` (17.5 cm) | medium |
| Z9 | stance too wide | `W > 0.240 H` (42 cm) | medium |
| Z10 | pelvis too high | `PELVIS_Y > 0.440 H` i.e. `drop < 0.090 H` | **critical** |
| Z11 | pelvis too low / hips break | `PELVIS_Y < 0.375 H` i.e. `drop > 0.155 H` | medium |
| Z12 | torso leaning forward | forward lean `> 5°` | high |
| Z13 | buttocks out (anterior pelvic tilt) | pelvis sagittal tilt `< 0°` (any anterior tilt) | high |
| Z14 | rear foot over-rotated outward | `rear_foot_yaw > +50°` | medium |
| Z15 | rear foot forced square | `rear_foot_yaw < +18°` (then Z3 becomes unavoidable) | medium |
| Z16 | front foot turned out | `front_foot_yaw < −12°` | low |
| Z17 | shoulders twisted off the hips | `|torso_yaw − pelvis_yaw| > 10°` | medium |
| Z18 | head not on the technique line | `|head_yaw_absolute| > 8°` | medium |
| Z19 | head bobbing during a step | head `Y` peak-to-peak `> 0.020 H` (3.5 cm); hard fail `> 0.034 H` | **critical** |
| Z20 | hips rotate too early | `|ψ(0.5) − ψ_start| > 8°` | medium |
| Z21 | swing foot lifted like a walk | swing sole clearance `> 0.020 H` (3.5 cm) | high |
| Z22 | front-foot pressure on the outer edge | COP lateral of the foot centre line | low |

### 9.2 Kokutsu-dachi

| # | fault | numeric signature | severity |
|---|---|---|---|
| K1 | weight too far forward | `front_load > 40 %` (equiv. hip `> 0.40·S` ahead of the rear ankle) | **critical** |
| K2 | rear knee not deep enough | `rear_knee_flexion < 62°` **or** `drop < 0.095 H` | **critical** |
| K3 | front knee locked | `front_knee_flexion < 8°` | high |
| K4 | rear knee collapsing inward | rear knee lateral offset from the rear-foot long axis `> 0.030 H` | **critical** |
| K5 | heels not on one line | `|front_heel.X − rear_heel.X| > 0.030 H` (5.3 cm) | high |
| K6 | rear foot not at 90° | `rear_foot_yaw ∉ [82°, 98°]` | medium |
| K7 | hips square instead of hanmi | `|pelvis_yaw| < 30°` | high |
| K8 | hips over-turned to 90° | `|pelvis_yaw| > 60°` | medium (style-dependent, §11) |
| K9 | leaning back over the rear leg | hip `Z` ahead of rear ankle `< 0.095 H`, or torso lean backward `> 3°` | high |
| K10 | stance too long | `S > 0.470 H` → geometrically forces K1 or K2 | high |
| K11 | stance too short | `S < 0.400 H` | medium |
| K12 | front heel lifted | `front_heel.Y > 0.004 H` | high |

### 9.3 Kiba-dachi

| # | fault | numeric signature | severity |
|---|---|---|---|
| B1 | too narrow | `W < 0.470 H` (82 cm) → `drop < 0.088 H` | **critical** |
| B2 | too wide | `W > 0.555 H` (97 cm) → `drop > 0.148 H`, feet roll | high |
| B3 | knees inside the feet | `knee.X` medial of `ankle.X` by `> 0.012 H` | **critical** |
| B4 | knees pushed too far out | `knee.X` lateral of `ankle.X` by `> 0.025 H` (Bertel: distorts the stance, injures) | medium |
| B5 | feet splayed | `|foot_yaw| > 10°` (that is shiko-dachi, not kiba-dachi) | high |
| B6 | fore/aft foot offset | `|ΔZ| > 0.020 H` | medium |
| B7 | buttocks out | pelvis sagittal tilt `< +6°` | high |
| B8 | torso lean | forward lean `> 3°` **or** `|roll| > 2°` | high |
| B9 | any foot corner lifted | any of 4 corners `Y > 0.004 H` | high |
| B10 | knees not deep enough | `knee_flexion < 52°` | high |
| B11 | height mismatch with zenkutsu | `|PELVIS_Y(kiba) − PELVIS_Y(zenkutsu)| > 0.012 H` (2.1 cm) | **critical** |

### 9.4 Standing stances / yoi

| # | fault | numeric signature | severity |
|---|---|---|---|
| Y1 | yoi too wide | `W > 0.310 H` | medium |
| Y2 | yoi too narrow | `W < 0.210 H` | medium |
| Y3 | knees locked | `knee_flexion < 0.5°` (hyperextension) | low |
| Y4 | knees visibly bent at yoi | `knee_flexion > 10°` or `drop > 0.020 H` | medium |
| Y5 | musubi heels apart | `heel_gap > 0.015 H` | medium |
| Y6 | heisoku feet apart | `W > 0.075 H` | low |
| Y7 | pelvis not level | `|pelvis_roll| > 3°` | low |

### 9.5 Cross-stance / transition faults

| # | fault | numeric signature | severity |
|---|---|---|---|
| X1 | stances at different heights | `max(PELVIS_Y) − min(PELVIS_Y)` across zenkutsu/kokutsu/kiba `> 0.012 H` | **critical** |
| X2 | head rises stepping out of yoi into a stance | any `head.Y > head.Y(yoi)` | medium |
| X3 | pelvis yaw ramps linearly across the step | `|ψ(0.5) − 0.5·(ψ_start+ψ_end)| < 5°` (i.e. it *is* linear) | high — reads robotic |
| X4 | feet leave their lanes in a straight step | `|foot.X − ±0.085 H| > 0.030 H` | medium |
| X5 | body arrives before the technique | technique impact `t` earlier than toe contact by `> 0.05 s` | medium |
| X6 | technique arrives before the body | technique impact later than heel contact | high |

---

## 10. Copy-paste constant block (units of H; hidari; `H_CM = 175`)

```
ANTHRO      = { ANKLE_Y:0.039, KNEE_Y:0.285, THIGH:0.245, SHANK:0.246, LEG_EXT:0.491,
                HIP_Y_STAND:0.530, EYE_Y_STAND:0.936, HIP_JOINT_SEP:0.098,
                SHOULDER_W:0.259, HIP_W:0.191,
                FOOT_LEN:0.152, FOOT_BREADTH:0.055,
                TOE_AHEAD:0.100, MTP_AHEAD:0.070, HEEL_BEHIND:0.052 }

FIGHT_PELVIS_Y = 0.410           // drop 0.120 H, all three fighting stances
FIGHT_PELVIS_Y_TOL = 0.010

HEISOKU  = { S:0.000, W:0.055, yawL:  0, yawR:  0, pelvisY:0.529, kneeL: 3, kneeR: 3, wL:50, wR:50 }
MUSUBI   = { S:0.000, W:0.030, yawL:-45, yawR:+45, pelvisY:0.529, kneeL: 3, kneeR: 3, wL:50, wR:50 }
HEIKO    = { S:0.000, W:0.259, yawL:  0, yawR:  0, pelvisY:0.523, kneeL: 3, kneeR: 3, wL:50, wR:50 }
HACHIJI  = { S:0.000, W:0.259, yawL:-30, yawR:+30, pelvisY:0.523, kneeL: 3, kneeR: 3, wL:50, wR:50 }  // YOI

ZENKUTSU = { S:0.540, W:0.170, yawFront:+3,  yawRear:+30,
             pelvisY:0.410, drop:0.120,
             kneeFront:57, kneeRear:10,
             loadFront:59, loadRear:41,
             kneeFrontDZvsAnkle:+0.011, kneeFrontDXvsAnkle:+0.005,  // +Z = behind the ankle
             hipZbehindFrontAnkle:0.221, hipZaheadOfRearAnkle:0.319,
             pelvisTiltPost:7, torsoPitch:0, pelvisYawShomen:0, pelvisYawHanmi:+45 }

KOKUTSU  = { S:0.446, W:0.000, yawFront:0, yawRear:+90,
             pelvisY:0.410, drop:0.120,
             kneeFront:18, kneeRear:73,
             loadFront:30, loadRear:70,
             kneeFrontDZvsAnkle:+0.127, frontShinTiltBack:31.1,
             hipZaheadOfRearAnkle:0.134,
             pelvisTiltPost:6, torsoPitch:0, pelvisYawHanmi:+45 }

KIBA     = { S:0.000, W:0.520, yawL:+4, yawR:-4,
             pelvisY:0.410, drop:0.120,
             kneeL:59.5, kneeR:59.5, loadL:50, loadR:50,
             kneeDXvsAnkle:0.000, pelvisTiltPost:12, pelvisYaw:0 }

HAN_ZEN  = { S:0.270, W:0.170, pelvisY:0.410, kneeFront:74.6, kneeRear:71.0, loadFront:55 }
MOTO     = { S:0.300, W:0.100, pelvisY:0.470, kneeFront:46,   kneeRear:40,   loadFront:55,
             yawFront:+3, yawRear:+25, pelvisYawHanmi:+30 }

STEP     = { durKihon:[0.45,0.70], durKataSlow:[1.2,2.0],
             pelvisYBand:0.008, pelvisYBandPass:0.015, pelvisYFail:0.034,
             swingClearance:0.008, swingClearanceMax:0.015,
             footXConstant:true,
             midStepSupportKnee:78, midStepPelvisZaheadOfSupportAnkle:0.072,
             yawHoldUntil:0.55, yaw90PctAt:0.92, yawEase:"easeOutCubic",
             lateralSwayFast:0.015, lateralSwaySlow:0.035 }
```

Mirror for `migi`: negate every `X`, every `yaw`, and every `pelvisYaw`.

---

## 11. Uncertainties

Ordered by how much a knowledgeable critic could legitimately dispute them.

1. **Zenkutsu front/rear weight split is genuinely unsettled in the literature.** Force-plate
   measurement on 9 veteran black belts gave **55.27 % front** (de Souza 2015); Nakayama, Nishiyama,
   Kanazawa and Tagnini all postulate **60/40**; a large number of modern dojo sources teach **70/30**;
   Liu & Wang (2002) reported a **63–77 %** range; Loczi (2008) reported near-even. This spec resolves
   it geometrically (§3.6) rather than averaging, but the *choice* of 59 % is an authorial decision.
2. **`PELVIS_Y = 0.410 H` is derived, not measured.** No source found gives a stance height in cm or as
   a fraction of stature. It is the value that simultaneously satisfies (a) zenkutsu at ~2 sw with the
   front shin near vertical, (b) kiba at 2 sw with vertical shins, (c) the doctrinal equal-height
   constraint. A measured value could plausibly be anywhere in 0.39–0.44 H.
3. **Allowed head oscillation during stepping has no numeric source at all.** Every source says
   "keep the same height" qualitatively. The 1.75 cm / 3.5 cm / 6.0 cm thresholds are this document's
   invention, anchored to normal-walking COM oscillation (4.5–8 cm) as the anti-target.
4. **Kokutsu length.** This spec says `1.72 sw` ankle-to-ankle; multiple traditional sources say
   "two shoulder widths". §4.3 shows 2 sw is geometrically impossible at 70/30 and equal height, but
   the resolution depends on the measurement datum (ankle vs heel vs toe-to-heel) which no source
   states. Toe-to-rear-ankle at `S=0.446 H` is `0.546 H ≈ 2.1 sw` — the "2 sw" claim may simply be
   measured differently, in which case both are right.
5. **Zenkutsu rear-foot yaw: 30° vs 45°.** Nakayama-derived sources and Wikipedia give **30°**;
   The Martial Way says "at least 45°" (and its phrasing is ambiguous about whether 45° is measured
   from the direction of travel or from the perpendicular); several dojos teach 30–45°. §3.5 shows the
   ankle-range argument favours the larger angle for long stances. Spec uses 30° nominal, 20–45° tol.
6. **Definition of "hanmi": 45° or 90°?** Bertel reports Yahara Sensei's precise definition as
   **pure hanmi = 90°**, with Asai Sensei using anything from ~30° to 90°. Most instructional sources
   and all stance descriptions use **45°**. This spec uses 45° for stance-resting hanmi and treats
   90° as `gyaku-kaiten`-style extremes. A JKA critic from the Yahara line would object.
7. **Kokutsu torso yaw.** Wikipedia states the body is turned "90 degrees or more away" in kokutsu
   with the head to the front; The Martial Way and JKA sources say hips at 45°, "not 90". This is
   probably a Shotokan-vs-Shito-ryu split. Spec follows the 45° JKA reading.
8. **Musubi-dachi foot angle: 45° per foot (90° included) or 30° per foot (60° included)?**
   Wikipedia and karatephilosophy say ~45° each; traditional-karate.com specifies a 60° included angle.
   Spec uses 45° each with ±8° tolerance, which does not cover the 30° reading.
9. **Hachiji-dachi foot angle.** Textual sources overwhelmingly say 45°; JKA yoi in practice looks
   closer to 20–30°. Spec uses 30° nominal — this is a visual-fidelity judgement, not a sourced number.
10. **Anthropometric basis.** Drillis & Contini ratios were not obtained from a primary source in this
    pass; the numeric values are the standard reproduction (Winter Fig. 4.1) and should be verified
    against the original before shipping. Independently, the OPEN Design Lab warns that
    **shoulder breadth correlates only `R² ≈ 0.15` with stature** — so every "in shoulder widths"
    conversion in this document has real per-individual scatter. `HIP_JOINT_SEP = 0.098 H`,
    `MTP_AHEAD = 0.070 H`, `TOE_AHEAD = 0.100 H` and `HEEL_BEHIND = 0.052 H` are assumptions of this
    document, not sourced values.
11. **Kiba-dachi foot pressure distribution (inner vs outer edge)** is contradictory across sources:
    one says the knee tracks over the inside of the big toe, Bertel warns against pushing the knees
    out, classic JKA teaching emphasises gripping with the outer edges. The 60/40 outer-bias figure
    here is low confidence.
12. **Zenkutsu width.** Sources give "one hip width" (0.191 H), "one shoulder width" (0.259 H), and
    "between hip and shoulder width", plus "narrows with advancement". Spec uses 0.170 H with a wide
    ±0.040 H tolerance; a critic could argue for anything in 0.10–0.26 H.
13. **Straight-line vs semicircular stepping path.** shotokankarateonline explicitly argues for the
    straight line and calls the in-and-out path a different dojo's habit; many JKA instructors teach
    bringing the foot in toward the support foot. Both variants are specified in §8.2; the default
    choice (straight, constant foot `X`) is an authorial pick.
14. **Step timing values** (`t=0.55` yaw hold, back-loaded `Z` easing, 0.45–0.70 s durations, peak
    speeds) are derived from qualitative descriptions plus reasonable dynamics. The searched
    biomechanics literature reports punch end-effector velocities (oi-zuki ≈10 m/s, gyaku-zuki ≈13 m/s)
    but no pelvis-yaw-vs-step-phase curve was located.
15. **Pelvis sagittal tilt values** (+7° zenkutsu, +12° kiba) are conversions of verbal cues
    ("roll the hips up", "hips rolled upward / posterior tilt") with no numeric backing.
16. **Pelvis lateral sway during a step** (0.015 H fast / 0.035 H slow) is entirely derived from a
    static-balance argument plus a dynamic-step discount. No source addresses it.
17. **de Souza's cohort was old and heavy** (mean age 46.8 y, mean mass 85.9 kg, two subjects at 96.7
    and 122.0 kg). Its 55.27 % front figure may reflect conservative, shorter stances rather than
    competition-form JKA kihon; the mean height (1.76 m) happens to match this spec's `H`, which makes
    its absolute forces directly usable but does not fix the cohort bias.

---

## 12. Sources (consolidated)

Instrumented / peer-reviewed:
- de Souza AV, Viero TF, Marques AM, Borges NG Jr. *Weight distribution in karate stances: a comparison
  between experimental and postulated values.* Arch Budo 2015;11:351-358. ICID 1187674.
  https://files.4medicine.pl/download.php?cfs_id=1356 —
  **[MEASURED]** kokutsu 69.74/30.26, zenkutsu 55.27 front/44.73 rear, kiba 49.95/50.05;
  n=9 male black belts, 1.76+/-0.03 m, 85.88+/-16.31 kg, 31.6+/-8.5 y experience;
  2x AMTI OR6-GT force plates, 2000 Hz, 5 s holds, 10 Hz low-pass, bootstrap-t CI.
- Cazeau C, et al. *Biomechanical study comparing the energy cost of human bipedalism versus
  zenkutsu-dachi stepping of a karateka.* Int Orthop 2021;45(9):2435-2443.
  https://pubmed.ncbi.nlm.nih.gov/34269821/ — 3D motion capture + force plate; zenkutsu stepping
  suppresses the walking inverted-pendulum PE<->KE exchange (the physical basis of the no-dip rule).
- Anthropometric proportionality-constant method and Drillis & Contini (1966) provenance, incl. the
  `R^2 ~= 0.15` stature/shoulder-breadth warning: https://www.openlab.psu.edu/design-tools-proportionality-constants/

Traditional / instructional authorities:
- Nakayama M., *Dynamic Karate* (via Black Hills Shotokan): ~32 in between the feet, hip-width wide,
  60/40, front-knee plumb line just inside the ball of the foot, back leg straight, hips lowered, six
  named faults. https://www.bhskc.com/post/the-front-stance
- Andre Bertel (JKA lineage) - three zenkutsu variations, hips/lengths, kata references:
  http://andrebertel.blogspot.com/2014/02/the-three-important-variations-of.html
- Andre Bertel - shomen/hanmi precise definitions (Yahara: pure hanmi 90 deg; Asai 30-90 deg):
  http://andrebertel.blogspot.com/2011/01/correct-shomen-hanmi.html
- Andre Bertel - kiba-dachi vs shiko-dachi, foot/knee direction, pelvis posture:
  http://andrebertel.blogspot.com/2020/12/kiba-dachi-and-shiko-dachi.html
- The Martial Way - zenkutsu: 1 sw wide x 2 sw long, ~66% front, front shin vertical / knee above the
  ankle, rear foot >=45 deg, inside-edge pressure, forward/backward pressure vectors:
  https://www.themartialway.com.au/zenkutsu-dachi-front-stance/
- The Martial Way - kokutsu: rear foot at a right angle, heels in line, hips 45 deg (not 90), rear heel
  line touching the inside of the front foot: https://www.themartialway.com.au/kokutsu-dachi-back-stance/
- Shotokan Karate Online - per-stance table (heisoku, musubi, heiko, zenkutsu 70/30 & 1.5 sw, kokutsu
  70-80% rear, kiba, fudo, neko-ashi): https://www.shotokankarateonline.com/blog/shotokan-karate-stances/
- Shotokan Karate Online - stepping: same height forward/back, straight line, knees together at the
  halfway point, drive from the back leg:
  https://www.shotokankarateonline.com/blog/zenkutsu-dachi-stepping-two-ways-of-moving/ and
  https://www.shotokankarateonline.com/blog/you-are-stepping-in-zenkutsu-dachi-incorrectly/
- Shotokan Karate Online - shomen/hanmi (~45 deg, 45-90 range, snap not grind):
  https://www.shotokankarateonline.com/blog/shotokan-karate-exercise-on-shomen-and-hanmi/
- KJ Arts Centre - jun-kaiten / gyaku-kaiten definitions:
  https://kjartscentre.com/karate-mechanics-explained-hip-rotation-jun-kaiten-gyaku-kaiten-hanmi-and-shomen/
- Academy of Traditional Karate (tachikata) - musubi 60 deg included, shizentai one fist + one foot
  length, various 45 deg foot angles:
  https://traditional-karate.com/karate-do/kihon-basics/tachikata-stances/
- Karate Philosophy - stance glossary (musubi 45 deg each, heiko 1 sw parallel, hachiji 1 sw + 45 deg,
  shizentai 30 deg): https://www.karatephilosophy.com/karate-terms-part-3-stances/
- Wikipedia - Karate stances (equal-height doctrine; hachiji 1 sw / 45 deg; uchi-hachiji 30-45 deg in;
  musubi ~45 deg; moto-dachi shin length + 2 fist widths + rear foot 20-30 deg; zenkutsu rear foot
  30 deg; renoji 70% rear): https://en.wikipedia.org/wiki/Karate_stances
- Wikipedia - Kokutsu dachi (rear foot 90 deg; body 90 deg or more away, head to the front - a
  non-Shotokan reading, see Uncertainty 7): https://en.wikipedia.org/wiki/K%C5%8Dkutsu_dachi
- Wikipedia - Front stance (Shotokan deeper than Isshin-ryu): https://en.wikipedia.org/wiki/Front_stance
- Glossaria - han-zenkutsu-dachi = half the full stance length:
  https://www.glossaria.net/en/karate/han-zenkutsu-dachi
