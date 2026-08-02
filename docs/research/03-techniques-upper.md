# 03 — Upper-Body Technique Trajectories (Shotokan / JKA)

Machine-actionable pose + trajectory spec. All angles **degrees**, all lengths **fraction of body height H** (cm shown for H=175), all times **seconds**, weight **%**.

---

## 0. Conventions (NORMATIVE — do not deviate)

### 0.1 World frame

| Item | Value |
|---|---|
| Handedness | Right-handed. `X̂ × Ŷ = Ẑ` |
| `+Y` | Up (world) |
| Character facing at *yoi* | `−Z` |
| `+X` | Character's **left** |
| `−X` | Character's **right** |
| `+Z` | Behind character at yoi |
| Embusen (floor pattern) | XZ plane, `Y = 0` |
| Verification | left `(1,0,0)` × up `(0,1,0)` = `(0,0,1)` = behind ✔ right-handed & self-consistent |

### 0.2 Mirror parameter

`s = +1` for the character's **LEFT** limb, `s = −1` for the **RIGHT** limb. Every `s·k` term flips automatically. Never author right-side values separately.

### 0.3 Torso-local frame `T` (all technique targets live here)

Origin = **GH** = glenohumeral joint centre of the **acting** arm. Axes parallel to the torso's own axes (not world), so specs survive stance drop, hanmi rotation and step translation.

| Offset symbol | Meaning | Sign |
|---|---|---|
| `dx` | toward character's left | `+` = left, expressed as `±s·k` |
| `dy` | up along torso | `+` = up |
| `dz` | along torso facing | `−` = forward (away from chest) |

> **Solver rule:** consume `GH` position/orientation from the stance+pelvis solver. **Never hardcode floor-relative Y for a technique except in `hachiji-dachi` (shizentai).**

### 0.4 Reference plane for `Z = 0`

`Z = 0` in torso-local space = the **mid-coronal plane through both GH centres**. Chest skin surface is at `dz = −0.060 H`; back surface `dz = +0.060 H`.

---

## 1. Anthropometric base — segment lengths & landmarks

### 1.1 Segment lengths (Drillis & Contini 1966, via Winter 2009 Fig. 4.1)

Source: <https://courses.grainger.illinois.edu/me481/sp2021/Anthro-Winter.pdf>, values cross-checked in text at <https://swordstem.com/2018/12/05/thibault-vs-modern-anthropometry/>

| Parameter | Value | Unit | Tol | cm @H=175 | Verified |
|---|---|---|---|---|---|
| `H` | 1.000 | H | — | 175.0 | — |
| `UPPER_ARM` (GH → elbow axis) | 0.186 | H | ±0.008 | 32.6 | text ✔✔ |
| `FOREARM` (elbow → ulnar styloid) | 0.146 | H | ±0.007 | 25.6 | text ✔✔ |
| `HAND` (wrist → middle fingertip) | 0.108 | H | ±0.006 | 18.9 | text ✔✔ |
| `WRIST_TO_MCP2` (wrist → index knuckle) | 0.049 | H | ±0.005 | 8.6 | [DERIVED] 0.45·HAND |
| `ELBOW_TO_FIST_CENTRE` | 0.176 | H | ±0.008 | 30.8 | [DERIVED] FOREARM+0.030 |
| `ELBOW_TO_MCP2` | 0.195 | H | ±0.009 | 34.1 | [DERIVED] |
| `HEAD_AND_NECK` | 0.182 | H | ±0.008 | 31.9 | text ✔✔ |
| `FOOT_LENGTH` | 0.152 | H | ±0.007 | 26.6 | text ✔✔ |
| `MAX_REACH_GH→MCP2` (elbow 180°) | 0.381 | H | — | 66.7 | [DERIVED] |
| `MAX_REACH_GH→FIST_CENTRE` | 0.362 | H | — | 63.4 | [DERIVED] |

### 1.2 The FIST UNIT (critical — JKA states distances in "fists")

JKA never dimensions a "fist". Adopt one canonical value or every JKA distance is meaningless:

| Parameter | Value | Unit | Tol | cm @H=175 | Note |
|---|---|---|---|---|---|
| `FIST_UNIT` (1 fist, JKA distance measure) | **0.055** | H | ±0.005 | 9.6 | [DERIVED] fist breadth incl. thumb |
| `FIST_KNUCKLE_BREADTH` (4-knuckle width) | 0.049 | H | ±0.004 | 8.6 | [DERIVED] = hand breadth |
| `FIST_DEPTH` (knuckles → back of hand) | 0.051 | H | ±0.005 | 8.9 | [DERIVED] |

### 1.3 Landmark table — `hachiji-dachi` (shizentai), standing, world Y

Source for heights: Drillis & Contini figure; internal consistency verified (see §1.4).

| Landmark | X | Y (H) | Z (H) | cm Y @H=175 | Conf |
|---|---|---|---|---|---|
| `VERTEX` (top of head) | 0 | 1.000 | −0.010 | 175.0 | high |
| `FOREHEAD_SURFACE` | 0 | 0.960 | −0.060 | 168.0 | [DERIVED] |
| `EYE_LINE` | ±0.032 | 0.936 | −0.062 | 163.8 | med |
| `EARLOBE` | ±0.075 | 0.920 | −0.005 | 161.0 | [DERIVED] |
| `JINCHU` (philtrum — **jodan target**) | 0 | 0.905 | −0.062 | 158.4 | [DERIVED] |
| `CHIN` | 0 | 0.870 | −0.055 | 152.3 | med |
| `GH_L` / `GH_R` (shoulder joint) | `s·0.130` | 0.818 | −0.010 | 143.2 | high ✔✔ |
| `ACROMION` (top of shoulder) | `s·0.135` | 0.845 | −0.010 | 147.9 | [DERIVED] |
| `NIPPLE_LINE` | `s·0.055` | 0.720 | −0.060 | 126.0 | med |
| `SUIGETSU` (solar plexus — **chudan target**) | 0 | 0.700 | −0.060 | 122.5 | [DERIVED] |
| `ELBOW_HANGING` / **hikite height** | `s·0.140` | 0.630 | −0.005 | 110.3 | high ✔✔ |
| `NAVEL` | 0 | 0.600 | −0.055 | 105.0 | [DERIVED] |
| `LOWER_ABDOMEN` (**gedan target**) | 0 | 0.560 | −0.050 | 98.0 | [DERIVED] |
| `TROCHANTER` (hip joint) | `s·0.088` | 0.530 | 0 | 92.8 | high ✔✔ |
| `WRIST_HANGING` | `s·0.145` | 0.485 | −0.005 | 84.9 | med |
| `KNEE` | `s·0.088` | 0.285 | 0 | 49.9 | high ✔✔ |
| `BIACROMIAL_WIDTH` | 0.259 | — | — | 45.3 | med |
| `HIP_WIDTH` | 0.191 | — | — | 33.4 | med |
| torso half-width @ lower ribs | 0.075 | — | — | 13.1 | [DERIVED] |
| torso half-width @ hip crest | 0.098 | — | — | 17.2 | [DERIVED] |

### 1.4 Internal consistency proofs (why the derived heights are trustworthy)

| Check | Arithmetic | Result |
|---|---|---|
| shoulder − elbow height | 0.818 − 0.630 = 0.188 | vs `UPPER_ARM` 0.186 → 1.1% ✔ |
| elbow − wrist height | 0.630 − 0.485 = 0.145 | vs `FOREARM` 0.146 → 0.7% ✔ |
| wrist − fingertip height | 0.485 − 0.377 = 0.108 | vs `HAND` 0.108 → 0.0% ✔ |
| shoulder height + head&neck | 0.818 + 0.182 = 1.000 | = H ✔ |

**Therefore:** Drillis & Contini "shoulder height" is usable directly as the **GH joint height** (arm hanging), and the derived landmark heights above are dimensionally closed. Use them.

### 1.5 Target heights as GH-relative offsets (stance-invariant — USE THESE)

| Target | `dy` from GH | Unit | Tol | cm @H=175 | Source |
|---|---|---|---|---|---|
| `JODAN` (jinchu / philtrum) | **+0.087** | H | ±0.012 | +15.2 | JKA "just above the upper lip (JINCHU)"; Bertel |
| `CHUDAN` (suigetsu / solar plexus) | **−0.118** | H | ±0.015 | −20.7 | JKA "chest"; Bertel "suigetsu" |
| `GEDAN` (lower abdomen) | **−0.258** | H | ±0.020 | −45.2 | JKA "lower part of the abdomen" |

Sources: <https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf> · <http://andrebertel.blogspot.com/2020/12/choku-zuki-part-two-five-years-later.html>

---

## 2. Global rules that apply to EVERY technique

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| `ELBOW_END_ZUKI` (thrusting techniques) | **171** | ° | ±3 (hard max 176) | JKA "extended but not locked"; traditional "ever so slight bend" |
| `ELBOW_END_ZUKI_%` extension | 95.0 | % of 180° | — | [DERIVED] |
| `ELBOW_END_GEDAN_BARAI` | **172** | ° | ±4 (hard max 177) | JKA "arm should be fully extended" (conflict, see §14.9) |
| `ELBOW_ABSOLUTE_MAX` (any frame) | 176 | ° | hard fail >176 | hyperextension prevention |
| `REACH_GH→MCP2 @ 170°` | 0.3796 | H | — | [DERIVED] |
| `REACH_GH→MCP2 @ 171–172°` (kime) | **0.3800** | H | ±0.0006 | [DERIVED] only 0.3% < straight (0.19 cm) |
| `WRIST_FLEX_EXT` at kime | 0 | ° | ±4 | JKA "keep the wrist straight" |
| `WRIST_ULNAR_DEV` seiken at impact | +4 | ° | ±3 | [DERIVED] aligns forearm axis behind MCP2/MCP3 (Bertel) |
| `SHOULDER_Y_RISE` (acromion, vs stance baseline) | ≤ **0.008** | H | 1.4 cm; severe >0.015 | JKA "shoulders should not be raised" [DERIVED number] |
| `SHOULDER_PROTRACTION` (GH translation rel. sternum, forward) | ≤ 0.012 | H | 2.1 cm | JKA "nor pushed forward" [DERIVED number] |
| `SHOULDER_HIP_SEPARATION` at kime | 0 | ° | ±5 | JKA "hips rotate with the upper body as one unit" |
| `HANMI` pelvis yaw | **45** | ° | ±5 | JKA explicit: "Rotate the hips 45 degree angle to form HANMI" |
| `SHOMEN` pelvis yaw | 0 | ° | ±4 | JKA |
| `GH_FORWARD_TRAVEL_FROM_45°_ROTATION` | **0.092** | H | ±0.008 | 16.1 cm — [DERIVED] `0.130·sin45°` |
| `HIKITE_ARRIVAL` vs strike arrival | **0.000** | s | −0.030 … +0.000 (may lead, never lag) | JKA "completed at the same time"; SKO "both fists stop at exactly the same time" |
| `HIKITE_DESYNC_FAIL` | > 0.033 | s | 2 frames @60fps | [DERIVED] |
| Hand/foot timing (`te-ashi onaji`) | 0.000 | s | ±0.030 | Bertel: Shotokan baseline is simultaneous completion |

---

## 3. HIKITE (the reciprocal pull) — one canonical pose

Used by choku/oi/gyaku-zuki, age-uke, gedan-barai, soto-uke, uchi-uke, tettsui. (Shuto-uke uses a **different** hikite — see §9.)

| Parameter | Value | Unit | Tol | cm @H=175 | Source |
|---|---|---|---|---|---|
| `HIKITE_FIST_CENTRE` `dx` (from own GH) | `−s·0.025` | H | ±0.015 | −4.4 | JKA "fist on the hip at the side of the body" |
| `HIKITE_FIST_CENTRE` `dy` | **−0.188** | H | ±0.015 | −32.9 | Bertel: hikite height = **elbow-crease height** ⇒ 0.630 H ✔ cross-checks §1.4 |
| `HIKITE_FIST_CENTRE` `dz` | **+0.020** | H | ±0.020 | +3.5 | Bertel "as far back as possible without going behind the back" |
| Absolute fist X (shizentai) | `s·0.105` | H | ±0.015 | 18.4 | against the hip crest |
| `HIKITE_ELBOW` `dx` | `s·0.005` | H | ±0.020 | +0.9 | tight to the ribs |
| `HIKITE_ELBOW` `dy` | −0.090 | H | ±0.020 | −15.8 | "elbow pulling down slightly" |
| `HIKITE_ELBOW` `dz` | **+0.163** | H | ±0.025 | +28.5 | deep Shotokan hikite: elbow well behind the coronal plane |
| `HIKITE_ELBOW_ANGLE` | **63** | ° | ±8 | — | [DERIVED] from the two positions above |
| `HIKITE_PALM_NORMAL` (end) | `(0, +1, 0)` | unit | ±8° | — | JKA "back of the fist facing downward" ⇒ **palm UP** |
| `HIKITE_FOREARM_ROLL` (from strike-side start) | 180 | ° | ±10 | — | JKA "pull back with a twisting motion" |
| `HIKITE_ROLL_WINDOW` | 60 → 100 | % of pull | — | — | mirrors the striking arm's roll |
| `HIKITE_FIST_X_MIN` (must not pass behind torso) | `s·0.085` | H | hard | 14.9 | Bertel "without going behind the back" |
| `HIKITE_ELBOW_X_MAX` (must not wing out) | `s·0.165` | H | hard | 28.9 | [DERIVED] |
| `HIKITE_ELBOW_Y_MAX` (must not lift) | `GH_y − 0.070` | H | hard | — | [DERIVED] |

**Kinematic role (do not omit):** the hikite is the *driver*, not an afterthought. JKA: pulling the other fist firmly back is what creates maximum speed and power (`tai no shinshuku` — body contraction/expansion). Animate the hikite's peak angular velocity **0.020–0.035 s BEFORE** the striking fist's peak velocity.

---

## 4. CHOKU-ZUKI (straight punch, hachiji-dachi)

Sources: JKA manual §Punches · <http://andrebertel.blogspot.com/2020/12/choku-zuki-part-two-five-years-later.html> · <https://onlineshotokanacademy.com/choku-zuki-straight-punch/>

### 4.1 Keyframes (chudan; GH-relative, reference point = **MCP2 knuckle**)

| KF | % path | `dx` | `dy` | `dz` | Elbow ° | Leader | Palm normal |
|---|---|---|---|---|---|---|---|
| **START** (hikite) | 0 | `−s·0.025` | −0.188 | +0.010 | **60** | — | `(0,+1,0)` palm up |
| **MID** | 50 | `−s·0.0775` | −0.153 | −0.1635 | **77** | **FIST leads** | `(0,+1,0)` (unrolled) |
| 75 | 75 | `−s·0.104` | −0.136 | −0.250 | **105** | fist | ~30° rolled |
| 90 | 90 | `−s·0.120` | −0.125 | −0.302 | **132** | fist | ~90° rolled |
| **END** (kime) | 100 | `−s·0.130` | **−0.118** | **−0.337** | **172** | — | `(0,−1,0)` palm down |

cm @H=175, END: `dx −22.8`, `dy −20.7`, `dz −59.0`.

| Derived END facts | Value | cm @H=175 |
|---|---|---|
| Knuckle absolute X (shizentai) | 0.000 H (**on the centreline**) | 0.0 |
| Knuckle absolute Z | −0.347 H | −60.7 |
| Knuckle forward of chest surface | 0.287 H | 50.2 |
| Path length (start→end, straight) | **0.388 H** | 67.9 |
| Punch line inward yaw from sagittal | **21.1°** ±4 | — |
| Jodan variant `dy / dz` (elbow 171°) | +0.087 / −0.346 | +15.2 / −60.6 |
| Gedan variant `dy / dz` (elbow 172°) | −0.258 / −0.247 | −45.2 / −43.2 |

### 4.2 Path shape

| Parameter | Value | Tol | Source |
|---|---|---|---|
| Shape | **straight line**, start→end chord | max lateral deviation `0.020 H` (3.5 cm) | JKA "shortest course to the target" |
| Elbow track | stays low & inboard; forearm brushes the flank in the first 40% | elbow X within `s·[0.060, 0.160] H` | JKA "the forearm brushes against the side of the body" |
| Elbow Y ceiling during stroke | `GH_y − 0.090 H` | hard | [DERIVED] anti-chicken-wing |
| Elbow tip direction | points **down** (−Y) at all times, ±20° | hard | traditional-karate consensus |

### 4.3 Forearm rotation ("the screw")

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Total roll | **180** | ° | ±8 | JKA / Bertel "corkscrewed" |
| Roll direction | pronation (palm up → palm down) | — | — | — |
| Roll onset | **65** | % of path | ±5 | derived from "rotating as it reaches its target" |
| Roll curve | `roll(t) = 180 · clamp((t−0.65)/0.35, 0, 1)^2.2` | — | — | [DERIVED] |
| ⇒ 50% of roll complete at | **93** | % of path | ±2 | [DERIVED] |
| ⇒ final 90° occupies | last **7** % of path ≈ last 0.027 H ≈ 4.7 cm | — | — | matches classic "last two inches" cue |
| Roll at 50% path | 0 | ° | ±5 | — |

### 4.4 Timing

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Arm stroke duration (kihon, full power) | **0.18** | s | 0.16–0.22 | [DERIVED] 0.68 m ÷ (0.55 × 7 m/s) |
| Whole-body movement window | ≤ 0.40 | s | — | VencesBrito 2011: kinematics+EMG within 400 ms |
| Peak knuckle speed | 5.3–8.0 | m/s | kumite gyaku-tsuki measured 5.33 ±0.215 | BJSTR |
| Peak knuckle speed occurs at | 88–94 | % of path | — | [DERIVED] |
| Kime hold (freeze) | 0.12 | s | 0.08–0.15 | [DERIVED] |
| Natural recoil after kime | 0.022 H (3.9 cm) back along `+Z` over 0.07 s | ±0.010 H / ±0.02 s | The Martial Way "a few inches natural recoil" |
| Ease | `easeOutQuint` on path param; velocity peak late | — | — | matches acceleration profile |

### 4.5 Hip

| Parameter | Value | Tol | Source |
|---|---|---|---|
| Pelvis yaw | 0° (shomen, held) | ±3° | JKA hachiji-dachi |
| `gyaku-kaiten` — punching-side hip counter-inverts | **3°** backward | ±2° | Bertel: "the opposite hip subtly inverts" |
| Pelvis Y bob | 0 | ±0.004 H | JKA "hip level should not change" |

---

## 5. OI-ZUKI (lunge / stepping punch, zenkutsu-dachi)

Sources: JKA manual §Lunge Punch · <http://andrebertel.blogspot.com/2021/03/oi-zuki-model-of-hand-foot-timing.html>

### 5.1 Same torso-relative keyframes as §4.1. Differences:

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Punching arm | **same side as the stepping (front) foot** | — | — | JKA |
| Pelvis yaw start → end | 45 → **0** (hanmi → shomen) | ° | ±5 | JKA "from HANMI is now facing front" |
| Punching-side GH world-forward gain from the rotation | **+0.092** | H | ±0.008 | [DERIVED] |
| ⇒ world-space knuckle travel | step_length + 0.092 H + 0.388 H | H | — | [DERIVED] |
| Arm-stroke start | **60** | % of step duration | 55–68 | [DERIVED] so a 0.18 s stroke lands with the foot |
| Foot-land vs knuckle-arrival Δt | **0.000** | s | ±0.030; knuckle may lead, must NOT lag | Bertel `te-ashi onaji`; instructor consensus |
| Hikite start | same frame as the punching arm | — | ±0.02 s | JKA "simultaneously" |
| Torso lean | 0 | ° | ±3 | JKA "upper body must not lean forward" |
| Guard arm during the step | previous technique held to 55% of step, then converts to hikite | — | — | JKA part 2 |

### 5.2 Timing variants (Bertel — three legitimate forms; tag them, don't average)

| Variant | Definition | Arm start (% of step) |
|---|---|---|
| `TE_ASHI_ONAJI` (Shotokan baseline — **use for kata/kihon**) | hands and feet complete together | 60 |
| `OKINAWAN_DELAYED` | stance settles, then the punch fires | 100 (+0.05 s) |
| `ANTICIPATORY` | punch lands before the stance settles | 40 |

---

## 6. GYAKU-ZUKI (reverse punch, zenkutsu-dachi)

Sources: JKA manual §Reverse Punch · <https://biomedres.us/fulltexts/BJSTR.MS.ID.002550.php>

Torso-relative keyframes = §4.1. Differences:

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Punching arm | **opposite side to the front leg** (= back-leg side) | — | — | JKA |
| Pelvis yaw start → end | 45 → **0** | ° | ±5 | JKA |
| Hip-rotation duration | 0.14 | s | 0.12–0.16 | [DERIVED] |
| Hip rotation LEADS fist onset by | **0.040** | s | 0.030–0.055 | [DERIVED] JKA "as the hips rotate, extend the arm" |
| Punching GH world-forward gain | +0.092 | H | ±0.008 | [DERIVED] |
| Back-leg extension | drives simultaneously | — | — | JKA "push the back leg with firmness and extend it" |
| Fist roll | 180°, same curve as §4.3 | ° | ±8 | BJSTR measured "180 degrees" |
| Roll radius (fist centroid about the forearm axis) | 0.029 H (5.0 cm) | ±0.005 H | — | BJSTR: 0.05 m |
| Force gain vs no-roll | +6.7 … +12.2 | % | — | BJSTR |
| Speed cost of the roll | −3.6 | % | — | BJSTR (5.33 vs 5.52 m/s) — keep the roll for kata |
| Pelvis Y | constant | ±0.004 H | — | JKA "hips parallel to the floor" |
| Start guard arm (kamae) | open hand, palm down angled 15°, MCP2 at `dz −0.325 H`, elbow **165°** | ±0.020 H | JKA "extended but not locked, hand in front of the solar plexus" |

---

## 7. AGE-UKE (jodan rising block)

Sources: JKA manual §Rising Face Block · <https://www.shotokankarateonline.com/blog/age-uke-upper-block-from-shizentai-basic-explanation/> · <https://onlineshotokanacademy.com/age-uke-upper-rising-block/> · <https://www.themartialway.com.au/age-uke-rising-block/>

### 7.1 Keyframes (reference point = **fist centre**, except where noted)

| KF | % path | `dx` | `dy` | `dz` | Elbow ° | Leader |
|---|---|---|---|---|---|---|
| **START** (cross in front of the chin, blocking arm OUTSIDE) | 0 | `−s·0.150` | +0.042 | −0.090 | **60** | — |
| **MID** | 50 | `−s·0.090` | +0.090 | −0.090 | **51** | **ELBOW leads** (rises along the flank) |
| **END** (fist centre) | 100 | `−s·0.136` | **+0.181** | **−0.079** | **83** | — |
| END — **wrist** | 100 | `−s·0.110` | +0.170 | −0.090 | — | — |
| END — **elbow** | 100 | `s·0.015` | +0.115 | −0.145 | — | — |

Absolute (shizentai): wrist `(s·0.020, 0.988, −0.100)` H = `(3.5, 172.9, −17.5)` cm. Fist centre `(−s·0.006, 0.999, −0.089)` H.

### 7.2 END constraints (hard)

| Parameter | Value | Unit | Tol | cm @H=175 | Source |
|---|---|---|---|---|---|
| **Wrist ↔ forehead 3-D distance** | **0.053** = 1 `FIST_UNIT` | H | 0.028–0.083 (0.5–1.5 fists) | 9.3 | JKA "approximately one fist"; SKO "a fist to a fist and a half" ✔✔ |
| Elbow height | **EYE_LINE** = `GH_y + 0.115 H` | H | ±0.020 | 163.3 abs | JKA "until it reaches the level of the eyes" |
| Elbow X (outboard of GH) | `s·0.015` | H | ±0.030 | 2.6 | JKA "courses along the side of the body" |
| Fist position vs forehead | **above and in front** | — | fist_y > FOREHEAD_y+0.025 H; fist_z < FOREHEAD_z−0.020 H | — | JKA |
| **Forearm inclination above horizontal** | **25** | ° | ±8 | — | **[DERIVED + CONFLICT]** see §11.1 |
| Blocking surface | outer/ulnar aspect of the distal forearm & wrist, facing up-forward | — | — | — | JKA |
| Elbow angle | 83 | ° | ±10 | — | [DERIVED from the positions above] |

### 7.3 Forearm rotation & orientation

| Parameter | Value | Tol | Source |
|---|---|---|---|
| Palm normal at START | `(0, 0, +1)` — **palm faces the practitioner** (back of the fist points forward) | ±12° | JKA "back of the left fist facing forward" |
| Palm normal at END | `(−s·0.20, +0.15, −0.97)` — **palm faces forward/outward** | ±15° | JKA "back of the fist facing backwards" **+** SKO "palm faces away from you" **+** Martial Way "inside of wrist faces outward" — all three agree ✔✔✔ |
| Total roll | **170** ° | ±20 | ⇒ back-of-fist forward → back-of-fist rearward |
| Roll window | 70 → 100 % of path | ±5 | SKO "sharp rotation on completion" |
| Forearm long-axis path | rises staying near-horizontal until 70%, then the sharp roll + final lift | — | SKO "forearm stays parallel to the ground as it continues upward" |

### 7.4 Timing

| Parameter | Value | Tol |
|---|---|---|
| Stroke duration | 0.20 s | 0.17–0.24 |
| Hikite arrival | simultaneous | −0.030 … 0 s |
| Kime hold | 0.12 s | 0.08–0.15 |

---

## 8. GEDAN-BARAI (downward sweep)

Sources: JKA manual §Downward Block · <https://www.shotokankarateonline.com/blog/gedan-barai-downward-block-from-shizentai-basic-explanation/> · <http://selfdefensekarate.org/index.php/Downward-fist_block>

### 8.1 Keyframes (reference point = **MCP2 knuckle**)

| KF | % path | `dx` | `dy` | `dz` | Elbow ° | Leader |
|---|---|---|---|---|---|---|
| **START** (chamber at the opposite earlobe) | 0 | `−s·0.180` | **+0.085** | −0.020 | **63** | — |
| START — elbow | 0 | `−s·0.140` | −0.098 (**own nipple level**) | −0.074 | — | JKA |
| **MID** | 50 | `−s·0.110` | −0.118 | −0.150 | **71** | **ELBOW leads** (down + across) |
| **END** | 100 | `−s·0.046` | **−0.190** | **−0.326** | **172** | — |

Absolute END (shizentai): `(s·0.084, 0.628, −0.336)` H. In zenkutsu (GH drops 0.090 H): knuckle Y ≈ **0.538 H** = 94 cm — i.e. **belt level**, not knee level.

### 8.2 END spec — polar form (PREFERRED, stance-invariant)

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Radius GH → MCP2 | **0.3805** | H | ±0.006 | ⇒ elbow 172° |
| **Depression below horizontal** | **30** | ° | ±5 | JKA "downward and on an angle" [DERIVED magnitude] |
| Azimuth inboard of the shoulder's sagittal plane | **8** | ° | ±5 | so the fist lands over the front leg |
| Palm normal | `(0, −1, 0)` palm down | unit | ±10° | JKA "back of the fist facing upward" ✔✔ |
| Forearm roll | 180° (palm-toward-neck → palm-down) | ° | ±15 | JKA "twisting motion" |
| Roll window | 70 → 100 % | — | ±5 | "just before full extension, the forearm rotates strongly" |

### 8.3 Validation against the front knee (run this assertion, do not author it)

| Assertion | Value | Tol | Note |
|---|---|---|---|
| `knuckle_z − knee_z` (forward of knee) | **−0.055** H (= 1 fist) | ±0.030 | JKA "one fist away from the knee", read as **horizontal** clearance |
| `knuckle_y − knee_y` | +0.22 H | ±0.04 | consequence of a near-straight arm; see §11.2 |
| `knuckle_z − hip_z` | −0.24 H (≈ 4.4 fists) | ±0.04 | reconciles SKO "four to five fists in front of the thigh" ✔ |
| `knuckle_x` vs front-foot centreline | within ±0.040 H | hard | "align with the knee" |

### 8.4 Timing

Stroke 0.20 s (0.17–0.24). Hikite simultaneous. Kime 0.12 s. JKA: relax the elbow through the arc, tense only at kime — animate arm stiffness 0.2 → 1.0 over the last 15%.

---

## 9. SOTO-UKE · UCHI-UKE · SHUTO-UKE (chudan blocks)

Sources: JKA manual §Outside Forearm Chest Block, §Knife Hand Chest Block · <https://www.shotokankarateonline.com/blog/soto-ude-uke-outside-forearm-block-from-shizentai-basic-explanation/> · <https://www.shotokankarateonline.com/blog/uchi-ude-uke-inside-forearm-block-from-shizentai-basic-explanation/> · <https://www.shotokankarateonline.com/blog/shuto-uke-knife-hand-block-from-shizentai-basic-explanation/>

### 9.1 ⚠ The "90° elbow" correction (READ BEFORE IMPLEMENTING)

Every consulted source states "a 90-degree bend at the blocking arm's elbow" for soto-uke, uchi-uke and shuto-uke. **With Drillis & Contini segment lengths this is geometrically impossible** alongside the same sources' other two constraints (fist/fingertips at shoulder height **and** elbow only 1–1.5 fists from the flank):

- elbow at exactly 90° ⇒ GH→fist-centre chord = `sqrt(0.186² + 0.176²)` = **0.256 H**
- fist at shoulder height ⇒ that 0.256 H is almost purely horizontal ⇒ fist ends **0.256 H (44.8 cm) forward of the GH** = 74% of full punch reach, and the elbow is forced ~0.14 H (25 cm) in front of the ribs — the textbook *fault*.

**Resolution:** treat "90°" as a coaching approximation / frontal-plane impression. Normative 3-D value: **`ELBOW_END_CHUDAN_UKE = 62° ± 8°`**. Flagged in §11.3.

### 9.2 SOTO-UKE (outside forearm block) — sweeps outside → in

| KF | % path | ref | `dx` | `dy` | `dz` | Elbow ° | Leader |
|---|---|---|---|---|---|---|---|
| **START** (fist up & out, above the shoulder) | 0 | fist centre | `s·0.025` | +0.150 | −0.175 | **79** | — |
| START — elbow | 0 | elbow | `s·0.085` | −0.015 | −0.165 | — | JKA "elbow at right angle, forearm vertical to the floor, elbow ≥ shoulder height" |
| **MID** | 50 | fist centre | `s·0.075` | +0.070 | −0.145 | **59** | **ELBOW leads**, circular sweep |
| **END** | 100 | fist centre | `−s·0.030` | **−0.010** | **−0.185** | **62** | — |
| END — elbow | 100 | elbow | `s·0.035` | −0.150 | −0.095 | — | — |

| END parameter | Value | Unit | Tol | cm | Source |
|---|---|---|---|---|---|
| Fist centre absolute X | `s·0.100` | H | ±0.035 | 17.5 | 0.030 H inboard of the shoulder line |
| Fist centre absolute Z | −0.195 | H | ±0.025 | −34.1 | 0.135 H (23.6 cm) forward of the chest surface |
| Fist height | = GH height (shoulder height) | H | ±0.020 | — | JKA "the fist is at shoulder height" ✔✔ |
| **Elbow clearance outboard of the flank** | **0.090** = 1.6 fists | H | 0.055–0.100 (1–1.8 fists) | 15.8 | JKA "1½ fist away from the side of the body" ✔✔ |
| Elbow height | `GH_y − 0.150` H (solar-plexus level) | H | ±0.025 | — | JKA "at the side of the body" |
| Forearm inclination above horizontal | **52** | ° | ±8 | — | [DERIVED] |
| Palm normal at START | `(0, 0, −1)` palm forward | unit | ±15° | — | JKA "back of the right fist facing backwards" |
| Palm normal at END | `(0, 0, +1)` **palm faces the practitioner** | unit | ±15° | — | JKA "back of the fist facing forward" |
| Forearm roll | **180** ° | ±20 | — | JKA |
| Roll window | 55 → 100 % | ±8 | — | "rotates as the arm gets level with the side of the body" |
| Contact surface | inner/ulnar face of the forearm, 0.03–0.07 H proximal of the wrist | — | — | "feeling of striking the opponent's arm" |
| Sweep plane | approx. frontal, tilted 25° so the fist also travels 0.010 H forward | ±10° | — | JKA "circular motion" |

### 9.3 UCHI-UKE (inside forearm block) — sweeps inside → out

END geometry ≈ soto-uke; the **path and the roll** differ.

| KF | % path | ref | `dx` | `dy` | `dz` | Elbow ° | Leader |
|---|---|---|---|---|---|---|---|
| **START** (own flank, above the hip) | 0 | fist centre | `−s·0.055` | −0.175 | −0.030 | **62** | — |
| **MID** | 50 | fist centre | `−s·0.045` | −0.085 | −0.115 | **49** | **ELBOW leads**; the arm *folds tighter* before the forearm swings out |
| **END** | 100 | fist centre | **0.000** | **−0.005** | **−0.190** | **63** | — |

| END parameter | Value | Tol | Source |
|---|---|---|---|
| Fist centre absolute X | `s·0.130` H (**in line with own shoulder**) | ±0.035 | SKO: too far across the centre = fault |
| Path shape | **near-straight rise**, NOT a wide arc; lateral bulge ≤ 0.030 H | hard | SKO "more of a straight line, from the side of the body above the hip" |
| Palm normal START | `(0, +1, 0)` palm up | ±12° | SKO |
| Palm normal END | `(0, 0, +1)` palm toward the practitioner | ±15° | SKO "palm facing toward practitioner" |
| Forearm roll | **90** ° | ±20 | [DERIVED] palm-up → palm-in |
| Roll window | 60 → 100 % | ±8 | [DERIVED] |
| Contact surface | **outer (radial/extensor) face** of the forearm — *not the edge* | — | SKO explicit |
| Elbow clearance outboard | 0.090 H (1.6 fists) | 0.055–0.100 | SKO "a fist to a fist and a half" |

### 9.4 SHUTO-UKE (knife-hand block, kokutsu-dachi)

| KF | % path | ref | `dx` | `dy` | `dz` | Elbow ° | Leader |
|---|---|---|---|---|---|---|---|
| **START** (knife hand at the top & slightly in front of the OPPOSITE shoulder) | 0 | hand centre | `−s·0.230` | +0.027 | −0.060 | **83** | — |
| START — elbow | 0 | elbow | `−s·0.110` | −0.098 (own nipple level) | −0.100 | — | JKA |
| **MID** | 50 | wrist | `−s·0.060` | +0.030 | −0.130 | **51** | **ELBOW leads**, downward cutting arc |
| **END** — wrist | 100 | wrist | `s·0.003` | **−0.052** | **−0.159** | **59** | — |
| **END** — fingertips | 100 | fingertip | `−s·0.010` | **+0.005** | **−0.250** | — | — |
| END — elbow | 100 | elbow | `s·0.022` | −0.169 | −0.074 | — | — |

| END parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Fingertip height | = GH height (shoulder height) | H | ±0.020 | JKA + SKO ✔✔ |
| Fingertip absolute Z | −0.260 | H | ±0.030 | −45.5 cm; 0.200 H forward of the chest |
| Elbow clearance outboard of the flank | **0.077** = 1.4 fists | H | 0.055–0.100 | JKA/SKO "a fist to a fist and a half" ✔✔ |
| Hand plane tilt (long axis above horizontal) | **32** | ° | ±10 | JKA "the knife hand is slightly angled" |
| Palm normal END | `(−s·0.72, +0.10, +0.69)` — palm faces inboard & rearward; ulnar edge leads forward-outboard | unit | ±15° | JKA "twisting of the forearm"; downward cutting feel |
| Forearm roll | 135 | ° | ±20 | [DERIVED] (back-of-hand-outward → ulnar-edge-forward) |
| Roll window | 60 → 100 % | — | ±8 | JKA "with a twisting motion" |
| Wrist flex/ext | 0 | ° | ±5 | JKA "keep the wrists straight" (explicit caution) |
| Torso | hanmi/sideways, 45° | ° | ±6 | JKA "upper body kept sideways" |
| Torso lean | 0 (must **not** lean back) | ° | ±3 | JKA explicit caution |

**SHUTO-UKE HIKITE — different from all others:**

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Hand shape | **shuto (open knife hand)**, not a fist | — | — | JKA (enables an immediate nukite) |
| Palm orientation | **palm UP**, hand parallel to the floor | ±10° | — | JKA "palm of the hand facing upward" ✔✔ |
| Position (torso frame, GH of the *pulling* arm) | `dx −s·0.135`, `dy −0.118`, `dz −0.055` | H | ±0.030 | JKA "in front of the solar plexus" |
| Absolute (shizentai) | `(0.000, 0.700, −0.065)` H | H | ±0.030 | ⚠ conflict, §11.4 |
| Fingertips point | forward `(0,0,−1)` | ±12° | — | ready position for nukite |
| Arrival | simultaneous with the block | ±0.030 s | — | JKA |
| Chamber (start) | palm **down**, in front of the lower abdomen: `(−s·0.030, 0.585, −0.090)` H | ±0.030 | — | JKA "back of the right hand facing upward … in front of the lower part of the abdomen" |

### 9.5 Shared timing for §9

Stroke 0.19 s (0.16–0.23). Kime 0.12 s. Hikite simultaneous. JKA soto-uke caution: "both fists should be firmly prying themselves apart" — animate a 0.03 s isometric co-contraction spike at kime.

---

## 10. TETTSUI-UCHI (hammer fist)

Sources: JKA manual §hand weapons (KENTSUI/TETSUI) · AJKA-I Report #18 <https://www.warwickshotokan.com/wp-content/uploads/2017/10/Report-18-Striking-Techniques.pdf>

### 10.1 Two canonical variants

| Variant | Arc plane | Appears in |
|---|---|---|
| `TATE_MAWASHI_TETTSUI` (vertical circular) — **primary, Heian Shodan move 4, renoji-dachi** | near-vertical | Heian Shodan, Bassai Dai |
| `YOKO_MAWASHI_TETTSUI` (horizontal circular) | parallel to the floor, from the chest outward | Heian Sandan |

### 10.2 `TATE_MAWASHI_TETTSUI` keyframes (ref = **fist centre**)

| KF | % path | `dx` | `dy` | `dz` | Elbow ° | Leader |
|---|---|---|---|---|---|---|
| **START** (fist raised beside/above the same-side ear) | 0 | `s·0.030` | **+0.135** | −0.010 | **45** | — |
| **MID** | 50 | `−s·0.010` | +0.030 | −0.210 | **72** | **ELBOW leads** — elbow is the pivot |
| **END** | 100 | `−s·0.100` | **−0.118** | **−0.297** | **135** | — |

Absolute START (shizentai) `(s·0.160, 0.953, −0.020)` H. Absolute END `(s·0.030, 0.700, −0.307)` H → fist near the centreline at chudan height.

| Parameter | Value | Unit | Tol | Source |
|---|---|---|---|---|
| Pivot | **elbow** (primary), shoulder secondary | — | — | AJKA "snapping the forearm from the elbow"; JKA (uraken analogue) "elbow as a pivoting point" |
| Arc radius about the elbow | 0.176 | H | ±0.010 | = `ELBOW_TO_FIST_CENTRE` |
| Arc plane | contains `+Y` and the horizontal unit vector **25° inboard** of the character's facing, anchored at GH | ° | ±10 | [DERIVED] "vertical circular", finishing near the centreline |
| Arc swept angle | ~135 | ° | ±20 | [DERIVED] |
| Elbow translation during the strike | ≤ 0.045 H | H | hard | JKA "the elbow position does not change much" |
| Elbow angle at END | **135** | ° | ±12 | [DERIVED] — hammer strikes are **never** fully extended |
| Striking surface | hypothenar pad / 5th-metacarpal edge, facing **down-forward** | — | — | JKA/AJKA |
| Palm normal START | `(−s·1, 0, 0)` palm faces inboard toward the head | ±15° | — | [DERIVED] |
| Palm normal END | `(−s·0.60, +0.80, 0)` palm up & inboard (53° from vertical) | ±18° | — | [DERIVED] so the hammer edge leads downward |
| Forearm roll | 60 | ° | ±20 | [DERIVED] |
| Roll window | 60 → 100 % | — | ±10 | [DERIVED] |
| Stroke duration | 0.15 | s | 0.12–0.19 | whip-like (`uchi-waza` is faster than `zuki`) |
| Kime hold | 0.12 | s | 0.08–0.15 | — |
| Recoil (snap-back, mandatory for `uchi-waza`) | 0.030 H back along the arc over 0.07 s | ±0.012 H | — | AJKA "snapped back to its original bent position" |
| Hip | **two** hip pulses: into the target, then away (`koshi no kaiten` vibration) | — | — | AJKA: "failure to use your hips" is *the* common fault |

### 10.3 `YOKO_MAWASHI_TETTSUI` deltas

Arc plane = horizontal (`Y = GH_y − 0.118 H`, i.e. chudan). START fist centre `(s·0.020, GH_y−0.098, −0.070)` H in front of the same-side nipple, elbow 50°. END `dx s·0.150`, `dz −0.230`, elbow 140°. Palm normal END `(0, +1, 0)` (palm up). Source pattern mirrors JKA's uraken practice ("circular motion done parallel to the floor").

---

## 11. Numeric signatures of the classic mistakes

Thresholds are **auto-graders**. `WARN` = visible to a black-belt critic; `FAIL` = wrong technique.

### 11.1 Per-fault table

| # | Fault | Measured quantity | WARN | FAIL | Applies to |
|---|---|---|---|---|---|
| F1 | **Chicken-winged elbow** (flare) | elbow X outboard of the shoulder line, any frame | > 0.030 H (5.3 cm) | > 0.045 H (7.9 cm) | all zuki |
| F1b | | perpendicular distance of the elbow from the GH→knuckle line | > 0.040 H | > 0.055 H | all zuki |
| F1c | | elbow Y above `GH_y − 0.090 H` during 10–80% of the stroke | > 0.090 H | > 0.070 H | all zuki |
| F1d | | elbow tip direction deviation from `−Y` | > 20° | > 35° | all zuki |
| F2 | **Over-rotated shoulder** | shoulder-line yaw − hip-line yaw at kime | > 5° | > 8° | oi/gyaku-zuki |
| F2b | | shoulder-line yaw past shomen (0°) | > 6° | > 10° | oi/gyaku-zuki |
| F2c | | girdle protraction (GH forward rel. sternum) | > 0.012 H | > 0.020 H | all |
| F3 | **Raised shoulder** | acromion Y rise vs stance baseline | > 0.008 H (1.4 cm) | > 0.015 H (2.6 cm) | all — JKA judging criterion |
| F4 | **Punch crossing the centreline** | knuckle X past the midline (toward the opposite side) | > 0.010 H | > 0.015 H (2.6 cm) | chudan/jodan zuki |
| F4b | | knuckle lateral deviation from the straight start→end chord | > 0.020 H | > 0.032 H | all zuki |
| F4c | | END knuckle X vs 0 (should land on the centreline in shomen) | ±0.025 H | ±0.045 H | chudan zuki |
| F5 | **Block too far from the body** | elbow clearance outboard of the flank | > 0.110 H (2 fists) | > 0.1375 H (2.5 fists) | soto/uchi/shuto-uke |
| F5b | | fist centre `dz` forward of GH | > 0.215 H | > 0.240 H | soto/uchi-uke |
| F5c | | age-uke wrist↔forehead distance | outside 0.028–0.083 H | > 0.110 H or < 0.022 H | age-uke |
| F6 | **Block collapsed onto the body** | fist centre `dz` forward of GH | < 0.155 H | < 0.130 H | soto/uchi-uke |
| F7 | **Elbow hyperextension** | elbow angle any frame | > 174° | > 176° | all |
| F8 | **Age-uke forearm flat / vertical** | forearm inclination above horizontal | outside 25±8° | outside 25±15° | age-uke |
| F9 | **Weak / lazy hikite** | hikite elbow `dz` | < +0.130 H | < +0.100 H | all |
| F9b | | hikite fist `dy` (not pulled to the hip) | > `GH_y − 0.165 H` | > `GH_y − 0.145 H` | all |
| F10 | **Hikite / strike desync** | \|t_hikite_stop − t_strike_stop\| | > 0.020 s | > 0.033 s | all |
| F11 | **Roll too early ("over-rotating prematurely")** | roll completed before 88% of path | > 30° @ 70% | > 90° @ 80% | all zuki |
| F12 | **Wrist break** | wrist flex/ext at impact | > 6° | > 10° | all |
| F12b | | wrist ulnar/radial dev outside spec | > 8° | > 14° | all |
| F13 | **Torso lean** | trunk pitch off vertical | > 3° | > 6° | all — JKA "maintain a straight upper body" |
| F14 | **Hip bob** | pelvis Y change during the technique | > 0.004 H | > 0.010 H | oi/gyaku-zuki — JKA "hip level should not change" |
| F15 | **Foot lands before the punch** | t_foot_land − t_knuckle_arrival | < −0.030 s | < −0.060 s | oi-zuki |
| F16 | **No snap-back on uchi-waza** | recoil distance | < 0.018 H | < 0.008 H | tettsui, uraken |

### 11.2 JKA judging criteria mapped to the above (verbatim intent, own words)

From the JKA instructor manual's examination criteria: on block completion the **elbow must be correctly positioned** (→ F1, F5, F6); the **target level must be unambiguous** — jodan / chudan / gedan (→ §1.5, F4c); **fists and knife-hands must be correctly formed with tight wrists** (→ §12, F12); **shoulders must be neither raised nor pushed forward** (→ F3, F2c); **proper elbow and wrist position during blocking** (→ F5, F12).

---

## 12. Hand-shape table (finger posing)

Sources: JKA manual §hand weapons · AJKA-I Report #18 · <https://medschool.co/exam/hand/mcp-pip-and-dip-flexion> · <https://pmc.ncbi.nlm.nih.gov/articles/PMC2483967/>

### 12.1 SEIKEN (fore-fist) — used by all zuki, gedan-barai, soto/uchi-uke, tettsui, uraken

| Joint | Flexion ° | Tol | Notes |
|---|---|---|---|
| MCP index (2) | **88** | ±6 | at the anatomical limit; the knuckle head is the striking point |
| MCP middle (3) | **88** | ±6 | second striking point |
| MCP ring (4) | 86 | ±6 | — |
| MCP little (5) | 84 | ±6 | JKA: the little finger relaxes first — keep it tight |
| PIP all fingers | **105** | ±10 | ROM 100–120 |
| DIP all fingers | **72** | ±8 | ROM 70–90; fingertips press the upper palm at the finger bases |
| MCP abduction (finger splay) | 0 | ±3 | JKA "squeezing tightly inwards" |
| Thumb CMC flexion | 32 | ±8 | thumb crosses the flexed index+middle |
| Thumb CMC adduction | 28 | ±8 | pressed against the side of the index |
| Thumb MCP flexion | **32** | ±10 | source range 10–45 |
| Thumb IP flexion | **35** | ±10 | source range 20–50 |
| Wrist flex/ext | 0 | ±4 | JKA "keep the wrist straight otherwise the power cannot be focused" |
| Wrist ulnar dev | +4 | ±3 | [DERIVED] puts the forearm axis behind MCP2/MCP3 |
| Contact patch normal (chudan zuki) | `(0,0,−1)` | ±6° | knuckle line horizontal, `(±1,0,0)` |

### 12.2 SHUTO (knife hand) — shuto-uke, shuto-uchi, and the shuto-uke hikite

| Joint | Flexion ° | Tol | Notes |
|---|---|---|---|
| MCP index/middle/ring | **6** | ±5 | near-straight but actively tensed |
| MCP little | 8 | ±5 | slightly more, to keep it pressed in |
| PIP all | **6** | ±5 | JKA "four fingers tightly pressed together" |
| DIP all | 3 | ±4 | — |
| MCP abduction (splay) | **0** | ±2 | hard: any gap between fingers is a scored fault |
| Thumb CMC flexion | 40 | ±10 | AJKA "bent at the joint and pressed against the side of the palm" |
| Thumb CMC adduction | **45** | ±10 | fully tucked |
| Thumb MCP flexion | 35 | ±10 | — |
| Thumb IP flexion | 30 | ±12 | JKA "pressing tightly against the inner aspect of the palm" |
| Wrist flex/ext | 0 | ±5 | JKA explicit caution for shuto-uke |
| Wrist ulnar dev | 0 | ±5 | — |
| Contact edge | hypothenar, base of the little finger → 0.030 H proximal | — | JKA "from the palm to the tip of the little finger" |

### 12.3 Other hand shapes referenced by the sources (for later kata)

| Shape | Rule | Striking surface |
|---|---|---|
| `URAKEN` | = seiken; wrist flexed 10° ±6 | dorsum of MCP2/MCP3 |
| `TETTSUI/KENTSUI` | = seiken; wrist neutral | hypothenar pad / 5th metacarpal edge |
| `NUKITE` | fingers extended & together; middle finger PIP flexed **12° ±5** to level the three fingertips; thumb tucked as shuto | fingertips 2–4 |
| `HAITO` | = shuto but the thumb is folded **into** the palm | radial edge, base of the index → thumb IP |
| `HAISHU` | = shuto | whole dorsum of the hand |
| `TEISHO` | MCP 90° ±8, PIP 20° ±10, DIP 0°, thumb clear of the palm, wrist **extended 55° ±10** | palm heel |
| `IPPON-KEN` | = seiken but index PIP-only flexion, index MCP 30° ±10, index pressed by the thumb | index PIP head |

---

## 13. Consolidated END-pose quick table (GH-relative, `s` = limb side)

| Technique | ref pt | `dx` | `dy` | `dz` | Elbow ° | Roll ° | Roll window % | Leader |
|---|---|---|---|---|---|---|---|---|
| choku-zuki chudan | MCP2 | `−s·0.130` | −0.118 | −0.337 | 172 | 180 | 65–100 | fist |
| choku-zuki jodan | MCP2 | `−s·0.130` | +0.087 | −0.346 | 171 | 180 | 65–100 | fist |
| choku-zuki gedan | MCP2 | `−s·0.130` | −0.258 | −0.247 | 172 | 180 | 65–100 | fist |
| oi-zuki chudan | MCP2 | `−s·0.130` | −0.118 | −0.337 | 172 | 180 | 65–100 | fist |
| gyaku-zuki chudan | MCP2 | `−s·0.130` | −0.118 | −0.337 | 172 | 180 | 65–100 | fist |
| age-uke | fist ctr | `−s·0.136` | +0.181 | −0.079 | 83 | 170 | 70–100 | elbow |
| gedan-barai | MCP2 | `−s·0.046` | −0.190 | −0.326 | 172 | 180 | 70–100 | elbow |
| soto-uke | fist ctr | `−s·0.030` | −0.010 | −0.185 | 62 | 180 | 55–100 | elbow |
| uchi-uke | fist ctr | 0.000 | −0.005 | −0.190 | 63 | 90 | 60–100 | elbow |
| shuto-uke | fingertip | `−s·0.010` | +0.005 | −0.250 | 59 | 135 | 60–100 | elbow |
| tettsui (tate) | fist ctr | `−s·0.100` | −0.118 | −0.297 | 135 | 60 | 60–100 | elbow |
| hikite (all except shuto-uke) | fist ctr | `−s·0.025` | −0.188 | +0.020 | 63 | 180 | 60–100 | elbow |
| hikite (shuto-uke) | hand ctr | `−s·0.135` | −0.118 | −0.055 | 62 | 180 | 60–100 | elbow |

**Solver priority when constraints conflict:** (1) end-effector position → (2) forearm roll / palm normal → (3) elbow swivel position → (4) elbow angle (advisory check only).

### 13.1 Self-consistency guarantee (run as a unit test)

Every elbow angle in this document was **computed**, not quoted, via the law of cosines from the stated positions:

```
c   = |offset_endEffector|                      // GH → end-effector
θ   = acos( (a² + b² − c²) / (2·a·b) )          // elbow angle, degrees
a   = UPPER_ARM        = 0.186 H
b   = ELBOW_TO_FIST_CENTRE 0.176 H  |  ELBOW_TO_MCP2 0.195 H  |  FOREARM 0.146 H (wrist ref)
```

Assertions that must hold for every keyframe in §4–§10 (tolerance ±5% on lengths, ±1.0° on angles):

| Assertion | Expected |
|---|---|
| `\|E − GH\|` | `UPPER_ARM` 0.186 H |
| `\|F − E\|` | the `b` matching that row's reference point |
| `acos((a²+b²−c²)/(2ab))` | the row's tabulated elbow angle |
| `\|F\| ≤ 0.381 H` (MCP2) / `≤ 0.362 H` (fist centre) | reach limit never exceeded |

All elbow-position rows in §7–§10 were solved on the elbow circle (radius `a` about GH, at angle `α = acos((a²+c²−b²)/(2ac))` off the GH→end-effector axis) — they are not eyeballed.

---

## 14. Uncertainties

1. **Age-uke forearm inclination: 25° vs 45°.** Two independent sources (<https://www.themartialway.com.au/age-uke-rising-block/>, <https://onlineshotokanacademy.com/age-uke-upper-rising-block/>) state 45°. The JKA manual instead says the raised forearm is "parallel to the forehead, slightly on an angle". **45° is geometrically incompatible** with JKA's own hard constraints (elbow at eye level + wrist one fist from the forehead): it would place the wrist at ≈1.036 H — above the top of the head. I spec **25° ±8**. A critic may reasonably argue the 45° figure refers to a frontal-plane diagonal or to the forearm's angle relative to the incoming strike vector, neither of which I could confirm. **Highest-risk number in this document.**

2. **Gedan-barai "one fist away from the knee".** The JKA phrase is dimensionally ambiguous. Read as a *vertical* clearance it is geometrically impossible (a near-straight arm from a zenkutsu shoulder cannot put the fist 0.055 H above the knee *and* forward of it). I read it as **horizontal** clearance, which yields a fist at belt height — consistent with the independent claim that gedan-barai "ends at the belt level" and with "four to five fists in front of the thigh". The alternative reading (fist genuinely near knee height, arm not straight, elbow ~150°) is defensible and would change `dy` by ≈0.10 H.

3. **The "90° elbow" for soto/uchi/shuto-uke (§9.1).** Every consulted source says 90°; I spec 62°, 63°, 59°. This is a deliberate, argued override, not an averaging. If the intended reading is that the *upper arm is horizontal* (elbow lifted to shoulder height at kime — some non-JKA lineages), then 90° is achievable and my elbow heights are 0.15 H too low. Validate against video before locking.

4. **JKA soto-uke "bring the fist to the front of the LEFT shoulder"** (i.e. the *opposite* shoulder) contradicts every other source, which requires the fist to stay in line with the practitioner's own shoulder and warns that crossing the centre is a fault. I treated it as a translation artefact and spec `dx = −s·0.030 H` (only 0.030 H inboard). If taken literally, `dx` would be ≈ `−s·0.260 H`.

5. **Shuto-uke hikite: solar plexus (0.700 H) vs navel (0.600 H).** JKA says "in front of the solar plexus"; <https://www.shotokankarateonline.com/blog/shuto-uke-knife-hand-block-from-shizentai-basic-explanation/> says the hand edge sits on the belly button. 0.100 H (17.5 cm) apart. I follow JKA.

6. **`FIST_UNIT = 0.055 H` is invented.** Every JKA distance in this document ("one fist from the forehead", "1½ fists from the body", "one fist from the knee") scales linearly with it. Ranges of 0.048–0.062 H appear defensible; that is ±13% on the most-cited block distances.

7. **Segment-height landmarks not text-verified.** `CHIN 0.870`, `NIPPLE 0.720`, `ELBOW 0.630`, `WRIST 0.485`, `EYE 0.936`, `BIACROMIAL 0.259`, `HIP_WIDTH 0.191` come from Drillis & Contini Fig. 4.1, which is a raster image in the PDF I could extract only partially. `0.818`, `0.530`, `0.285`, `0.152`, `0.186`, `0.146`, `0.108`, `0.182` **are** text-verified. The unverified heights pass four independent dimensional-closure checks (§1.4), which I consider strong but not primary evidence. `BIACROMIAL 0.259 H` is the weakest — other sources give 0.245 H, which would shift every `dx` by 0.007 H and the punch inward yaw by ~1°.

8. **`SUIGETSU 0.700 H`, `JINCHU 0.905 H`, `EARLOBE 0.920 H`, `FOREHEAD 0.960 H`, `LOWER_ABDOMEN 0.560 H` are all [DERIVED]** from face/torso proportions, not from any karate or anthropometric table. ±0.015 H each.

9. **Elbow-extension percentage at kime.** No JKA number exists. JKA says "extended but not locked" for the guard arm and "fully extended" for gedan-barai — two different words for two techniques, and it never quantifies either. My 170° (zuki) / 172° (gedan-barai) is [DERIVED] from the traditional "ever so slight bend" plus hyperextension avoidance. Modern sport karate genuinely does lock out (180°), so a critic could call 170° stylistically loaded. Note also that 170° costs only 0.4% of reach (0.26 cm at H=175), so the visual difference is in the *joint*, not the *distance*.

10. **Forearm roll timing.** "Last two inches" (≈7% of the stroke) is a coaching cue, not a measurement; VencesBrito 2011 reports only that experts have a *shorter* pronation duration than novices, without absolute values behind a paywall. My `^2.2` easing curve is an animation-friendly invention.

11. **Stroke durations (0.15–0.20 s) are [DERIVED]** from published fist velocities (5.33 m/s measured for kumite gyaku-tsuki; 8 m/s and 14 m/s reported elsewhere — a 2.6× spread) and an assumed triangular velocity profile. The <400 ms whole-movement window is measured; the per-segment breakdown is not. Kata tempo will legitimately run 1.3–2.0× slower than these kihon values.

12. **Age-uke palm orientation** is the one rotation I consider settled (three sources converge on palm-facing-forward / back-of-fist-rearward). **Soto-uke vs uchi-uke end roll is NOT settled**: sources describe both as ending with the palm toward the practitioner, which fails to distinguish them. I differentiated them by total roll magnitude (180° vs 90°) and by contact surface (inner vs outer forearm), which is internally consistent but partly inferred.

13. **Uchi-uke chamber side.** I spec the same-side flank above the hip (per <https://www.shotokankarateonline.com/blog/uchi-ude-uke-inside-forearm-block-from-shizentai-basic-explanation/>). A large body of Shotokan instruction chambers uchi-uke at the *opposite* hip. That variant changes `dx` at 0% from `−s·0.055 H` to `−s·0.215 H` and roughly doubles the sweep length.

14. **Tettsui-uchi is the least documented technique here.** The JKA instructor manual has no tettsui section at all; AJKA-I Report #18 gives only "snapping the forearm from the elbow, either up and over or from the chest in an arc parallel to the ground". Every number in §10 is [DERIVED], with the arc-plane 25° inboard tilt and the 135° end elbow angle being the most speculative.

15. **Shoulder-elevation and girdle-protraction limits (0.008 H / 0.012 H)** are entirely invented. Sources are unanimous that the shoulders must not rise or push forward, and JKA lists it as an examination criterion, but nobody quantifies it.

16. **All fault thresholds in §11 are [DERIVED].** No source publishes numeric tolerances for karate faults; these are calibrated to be roughly "visible at 1080p from 3 m" and will need tuning against reference video.

17. **Hip/shoulder separation of 0° at kime** follows JKA ("the hips rotate with the upper body as one unit"). Modern kumite biomechanics deliberately uses hip-shoulder separation for a stretch-shortening gain. For a *kata* player, 0° is correct; do not import kumite values.
