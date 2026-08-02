# 04 — Motion Dynamics, Timing & Kime (machine-actionable spec)

Scope: how Shotokan motion *feels*, reduced to numbers, curves and formulas for an animation
runtime. Consumer: pose/curve engine, not a human reader. Every row ends in a number.

---

## 0. Conventions, symbols, units

| symbol | meaning | unit |
|---|---|---|
| `H` | body height of the karateka | m (reference `H = 1.75 m` / 175 cm) |
| `+Y` | world up | — |
| `-Z` | direction the character faces at `yoi` (ready) | — |
| `+X` | character's **left** at `yoi` | — |
| XZ | embusen (floor pattern) plane | — |
| `ψ` | pelvis **yaw** about `+Y` | deg |
| `θ` | thorax (shoulder-girdle) yaw about `+Y` | deg |
| `τ` | normalized technique time, `τ = t / T_tech`, `τ ∈ [0,1]` | — |
| `T_tech` | technique window: first mechanical motion → kime lock (fist/foot arrival) | s |
| `T_thrust` | terminal thrust sub-window: limb-extension accel onset → limb velocity = 0 | s |
| `T_count` | one kata count period (count *n* onset → count *n+1* onset) | s |
| `L` | path length travelled by the end effector inside `T_tech` | m or `·H` |
| `W_f / W_r` | fraction of body weight on front / rear foot | % |

**Handedness check (do not get this wrong).** Right-handed, `X × Y = Z`.
`facing = (0,0,-1)`, `up = (0,1,0)` ⇒ `up × facing = (-1,0,0)` = character's **right**.
Therefore **a positive yaw about `+Y` rotates the facing vector from `-Z` toward `-X`, i.e. the
character turns toward its own RIGHT.**

**Pelvis yaw sign convention used in all tables below.** `ψ = 0` = *shomen* (pelvis normal parallel
to the technique's target direction). `ψ > 0` = the pelvis has rotated so that the character's
**left** hip is advanced toward the target. Consequence: for a **left-foot-forward** zenkutsu-dachi
facing `-Z`, hanmi is `ψ = +45°`; for right-foot-forward, hanmi is `ψ = -45°`. Mirror all `Δψ`
signs when the stance mirrors. Angles are absolute magnitudes in the "sweep" columns.

`[DERIVED]` = converted from a verbal source or computed from other cited numbers; the derivation
is stated inline. `[MEAS]` = published measurement.

---

## 1. Master timing model

Three nested windows. All animation channels are authored against `τ` inside `T_tech`; the count
period wraps it.

```
|<-------------------------- T_count (kata) ------------------------->|
|<- T_prep ->|<--------- T_tech --------->|<- T_kime ->|<- T_hold ->|
                          |<- T_thrust ->|
             τ=0                        τ=1
```

| param | value | unit | tol | note |
|---|---|---|---|---|
| `T_prep` (hikite chamber, weight unload, step init) | 0.40 | s | ±0.12 | kata demo tempo |
| `T_tech` (gyaku-zuki, kumite max effort) | 0.320–0.386 | s | n=3 | `[MEAS]` 4th kyu 0.386, 2nd dan 0.341, 3rd dan 0.320 |
| `T_tech` (gyaku-zuki, elite, peak-GRF→max elbow ext) | 0.26–0.27 | s | ±0.04 | `[MEAS]` n=8 elite, 39 trials |
| `T_tech` (choku-tsuki) | <0.30 | s | — | `[MEAS]` n=10 national team |
| `T_tech` (gyaku-tsuki, EMG chain span, elite 3rd dan) | 0.308 | s | single subject | `[MEAS]` first muscle → punch end |
| `T_tech` kata scale factor vs kumite | ×1.15–1.35 | — | — | `[DERIVED]` kata must land arm **with** stance (WKF foul otherwise) |
| `T_thrust` (arm extension only, kumite) | 0.072–0.120 | s | n=5, 45 trials | `[MEAS]` accel onset → fist velocity sign flip |
| `T_thrust` (kata demo tempo) | 0.10–0.16 | s | ±0.02 | `[DERIVED]` `T_thrust × 1.3` |
| `T_kime` (terminal lock, see §5) | 0.10–0.25 | s | — | see §5 |
| whole-punch kinematic+EMG envelope | ≤0.400 | s | — | `[MEAS]` two independent groups |

**Ship values for kata (use these unless a shot demands kumite speed):**
`T_tech = 0.34 s` for a stationary hand technique, `0.50 s` for a stepping hand technique,
`0.55 s` for a kick, `0.70 s` for a turn+technique. `T_thrust = 0.13 s`.

Frame budgets at 60 fps: `T_thrust = 8 frames`. At 30 fps: **4 frames**. The thrust must therefore
be authored on a continuous curve, never on keys — a 4-frame pose-to-pose punch reads as mocap
noise. `T_tech = 20 frames @60 fps`.

Sources: <https://ojs.ub.uni-konstanz.de/cpa/article/view/1937/1805> ·
<https://ojs.ub.uni-konstanz.de/cpa/article/download/3410/3208> ·
<https://ojs.ub.uni-konstanz.de/cpa/article/view/1161/1049> ·
<https://revpubli.unileon.es/ojs/index.php/artesmarciales/article/view/42> ·
<https://pmc.ncbi.nlm.nih.gov/articles/PMC12300276/>

---

## 2. KOSHI NO KAITEN — pelvis yaw per technique class

### 2.1 Canonical hip orientations

| param | value | unit | tol | source |
|---|---|---|---|---|
| shomen (square) | 0 | deg | ±3 | JKA technical manual |
| hanmi (half-facing) — **JKA canonical** | 45 | deg | ±5 | JKA technical manual: "Rotate the hips 45 degree angle to form half facing front position (HANMI)" |
| hanmi — Asai/Bertel lineage range | 30 … 90 | deg | — | 7th dan, Asai student — **disagrees with JKA 45** (see §12) |
| gyaku-hanmi overshoot past shomen (advanced gyaku-zuki) | −10 … −20 | deg | ±5 | some JKA groups; optional |
| pelvis roll & pitch during any yaw | 0 | deg | ±2.5 | JKA: "hips are kept parallel to the floor"; hips level is an exam criterion |
| thorax-pelvis separation (X-factor) at peak | 8 … 15 | deg | ±4 | `[DERIVED]` from the 30 ms pelvis→thorax onset lag (§3) × pelvis `ω` 350 deg/s |

JKA also states the hips rotate **with** the upper body "as one unit" in the static hanmi/shomen
drill — Shotokan deliberately uses a *small* torso lag, unlike boxing/pitching. Cap X-factor at
15°; do not author baseball-style 40–50° separation.

Sources: <https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf> ·
<http://andrebertel.blogspot.com/2011/01/correct-shomen-hanmi.html> ·
<https://kjartscentre.com/karate-mechanics-explained-hip-rotation-jun-kaiten-gyaku-kaiten-hanmi-and-shomen/>

### 2.2 Per-technique pelvis yaw (left-foot-forward zenkutsu-dachi, facing `-Z`)

`ψ_chamber` = pelvis yaw at the loaded/chambered pose; `ψ_kime` = at the lock; `|Δψ|` = swept
magnitude; `ω_peak` = peak pelvis yaw rate.

| technique | `ψ_chamber` (deg) | `ψ_kime` (deg) | `absΔψ` (deg) | `ω_peak` kata (deg/s) | `ω_peak` kumite (deg/s) | kaiten |
|---|---|---|---|---|---|---|
| choku-zuki (hachiji-dachi) | 0 | 0 | 0–6 | 60–120 | 150 | none |
| gyaku-zuki chudan | +45 | 0 (adv. −12) | 45 (57) | 320–450 | 450–690 | jun |
| gyaku-zuki jodan | +45 | 0 | 45 | 320–450 | 450–690 | jun |
| oi-zuki chudan (stepping) | +45 | 0 | 45 | 280–400 | 400–600 | jun |
| kizami-zuki (lead fist) | 0 | +45 | 45 | 300–420 | 420–560 | gyaku |
| gedan-barai (stepping, lead arm) | −20 | +45 | 65 | 330–470 | — | gyaku |
| age-uke (stepping, lead arm) | −15 | +45 | 60 | 320–450 | — | gyaku |
| soto-uke (stepping) | −25 | +45 | 70 | 350–480 | — | gyaku |
| uchi-uke (stepping) | −20 | +45 | 65 | 330–470 | — | gyaku |
| shuto-uke (kokutsu-dachi) | −10 | +45 | 55 | 300–420 | — | gyaku |
| mae-geri (chudan, keage) | +45 → 0 at knee lift | 0 … +15 | 45–60 | 250–400 | — | jun (into kick) |
| mawashi-geri chudan | +50 | −25 | 75 | 380–500 | **452 ± 71** `[MEAS]` | jun |
| yoko-geri kekomi | +80 (kiba axis) | +85 | 5–15 | 120–220 | — | minimal |
| 90° / 180° embusen turn | — | — | 90 / 180 | 220–340 | — | body-unit |

`ω_peak` kumite values anchored on two measurements that **do not agree**: pelvis peak angular
velocity in gyaku-tsuki `11.96 rad/s = 685 deg/s`, vs pelvic axial rotation in karate mawashi-geri
`452 ± 71 deg/s`. Use 452 as the reliable floor and 685 as the ceiling; kata values are
`[DERIVED]` = `0.70 × kumite` (kata is 1.15–1.35× longer for the same sweep).

Consistency check `[DERIVED]`: `Δψ = 45°` swept across `τ ∈ [0.12, 0.88]` of `T_tech = 0.34 s`
⇒ window 0.258 s ⇒ mean 174 deg/s; with the pelvis velocity profile of §4 (`v_peak/v_mean = 1.45`)
⇒ `ω_peak = 253 deg/s`. Raise the ship value to 320–450 deg/s by compressing the sweep window to
`τ ∈ [0.15, 0.70]` (0.187 s), which also correctly places the pelvis *ahead* of the fist.

Sources: <https://pmc.ncbi.nlm.nih.gov/articles/PMC5571909/> ·
<https://biomedres.us/fulltexts/BJSTR.MS.ID.002550.php>

### 2.3 Onset offsets — hip vs shoulder vs fist (the core "reads as karate" numbers)

Derived from surface-EMG onsets of an elite 3rd-dan gyaku-tsuki (sEMG 2000 Hz), re-zeroed so that
`t = 0` is **fist arrival / punch termination**; negative = earlier. Mechanical onsets add an
electromechanical delay `EMD = +30 ms` to each EMG onset (justified by tensiomyography on karate
athletes: delay time `Td = 20.7–24.0 ms`, contraction time `Tc = 22.9–32.2 ms`).

| chain link | driving muscle (measured) | EMG onset (ms) | **mechanical onset (ms)** | offset to fist arrival (ms) |
|---|---|---|---|---|
| lead-leg brace / drive | L rectus femoris | −308 | **−278** | 278 |
| pelvis yaw (punch-side rotator) | R external oblique | −275 | **−245** | 245 |
| rear-leg extension drive | R rectus femoris | −250 | **−220** | 220 |
| hikite (pulling arm) start | L anterior deltoid | −233 | **−203** | 203 |
| thorax yaw (contralateral rotator) | L external oblique | −217 | **−187** | 187 |
| punching shoulder girdle | R anterior deltoid | −216 | **−186** | 186 |
| shoulder drive / protraction | R pectoralis major | −193 | **−163** | 163 |
| **elbow extension (thrust)** | R triceps lateral | −118 | **−88** | 88 |
| wrist lock (kime) | R extensor carpi radialis | −110 | **−80** | 80 |
| fist arrival | — | 0 | **0** | 0 |

**Ship offsets (ms before fist arrival), `T_tech = 340 ms` kata:**

| param | value (ms) | tol | note |
|---|---|---|---|
| rear-foot drive onset | −280 | ±30 | |
| pelvis yaw onset | −245 | ±25 | |
| hikite onset | −205 | ±20 | leads punching shoulder by **17 ms** `[MEAS]` |
| thorax yaw onset | −187 | ±20 | pelvis→thorax lag = **58 ms** |
| punching shoulder onset | −186 | ±20 | |
| elbow extension onset | −88 | ±15 | = start of `T_thrust` |
| wrist/fist lock ramp start | −80 | ±10 | |
| **hip onset → shoulder onset** | **58** | ±15 | *the* koshi-no-kaiten signature |
| **hip onset → fist arrival** | **245** | ±25 | |
| **shoulder onset → fist arrival** | **186** | ±20 | |
| whole chain spread (first → last muscle) | 198 | `[MEAS]` | |

**Independent cross-check via peak-velocity timing** (different study, gyaku-tsuki, 3rd dan,
motion capture): hip peak at `τ = 0.42`, shoulder peak at `τ = 0.65`, wrist peak at `τ = 0.73`.
With `T_tech = 340 ms` ⇒ hip peak 143 ms, shoulder peak 221 ms, wrist peak 248 ms ⇒
**hip-peak → shoulder-peak = 78 ms**, **shoulder-peak → wrist-peak = 27 ms**. Two independent
methods bracket the hip→shoulder lead at **58–78 ms**. A third study (n=4, film 100 Hz) reports
shoulder peak between `τ = 0.53` and `τ = 0.84` — a wide inter-subject band; do not tighten below
±0.08 τ.

Sources: <https://pmc.ncbi.nlm.nih.gov/articles/PMC12300276/> ·
<https://pdfs.semanticscholar.org/8a40/14c1cdbb51b3b92fb2e7ba48069e904b0d0d.pdf> ·
<https://ojs.ub.uni-konstanz.de/cpa/article/download/3410/3208>

---

## 3. Kinetic chain: order, peak velocities, phase structure

### 3.1 Order (invariant — never violate)

`rear-foot GRF → lead-leg brace → pelvis yaw → thorax yaw → shoulder girdle → elbow → wrist/fist`

Measured proximal-to-distal ordering confirmed in karate and in boxing straight punches
(ankle → knee → hip → shoulder → elbow → fist). Peak velocity of each segment **precedes** the
next and each proximal segment *decelerates* as the distal one accelerates.

### 3.2 Published peak segment velocities — gyaku-zuki

| segment | Suwarganda (elite, n=8, 150 Hz) | Hofmann (n=3, VICON 200 Hz) | "Linear kinematic" (3rd dan) | ship value kata | ship value kumite |
|---|---|---|---|---|---|
| hip / pelvis marker | 2.42–2.44 (subgroup max 3.20) | 1.5–2.5 | 0.912 | 1.4–1.9 | 2.4 ±0.5 |
| shoulder | 4.04–4.61 (max 5.14) | 2.9–3.4 | 1.700 | 2.4–3.0 | 4.0 ±0.6 |
| elbow | 6.94–7.36 (max 8.11) | — | — | 4.2–5.0 | 7.1 ±1.0 |
| wrist / fist | 6.93–7.65 (max 8.52) | 8.1–8.4 | 5.125 | 4.6–5.6 | 8.0 ±0.9 |

All in `m/s`. **The three studies disagree by up to 2.7×** on the same segment (see §12). The
Suwarganda and Hofmann sets agree at the fist (7–8.5 m/s); the "linear kinematic" set is
systematically ~2× lower and is treated as an outlier for the fist but as the authority on the
*timing fractions* (`τ_p`) which are dimensionless and therefore robust.

Kata ship values = `0.62 × kumite` `[DERIVED]`: kata `T_tech` is 1.15–1.35× longer over a
similar path, and kata is `sundome`/non-impact.

### 3.3 Other technique classes

| technique | end-effector peak velocity (m/s) | duration (s) | source |
|---|---|---|---|
| choku-zuki (straight punch) | 7.1 | <0.30 | Nakayama-derived table; `[MEAS]` duration |
| oi-zuki (lunge punch) | 12.6 | — | Nakayama-derived table (single secondary source, see §12) |
| gyaku-zuki | 8.0–8.4 | 0.26–0.39 | `[MEAS]` ×2 studies |
| gyaku-tsuki impact speed (contact-plate) | 5.33 ± 0.215 | — | `[MEAS]` 72 kg, 7 y exp |
| mae-geri, to target, elite | 9.61 ± 1.05 | 1.076 ± 0.099 | `[MEAS]` systematic review |
| mae-geri, to target, sub-elite | 8.56 ± 1.08 | 1.140 ± 0.221 | `[MEAS]` |
| mae-geri, in air, elite | 12.25 ± 0.18 | — | `[MEAS]` |
| mae-geri joint peaks | hip 1.74 / knee 5.25 / ankle 7.43 | — | `[MEAS]` |
| mawashi-geri, to target, elite | 14.34 ± 1.35 | 0.840 ± 0.012 | `[MEAS]` |
| mawashi-geri (3-style study, karate n=8) | 13.66 ± 1.06 max, 5.57 ± 0.80 at impact | 1.29 ± 0.28 | `[MEAS]` |

Angular velocities (`deg/s`, `[MEAS]`): knee extension mae-geri sub-elite `934 ± 145`;
knee extension mawashi-geri elite `1516 ± 181`; karate mawashi-geri knee extension `-947 ± 94`;
hip extension mae-geri elite `536 ± 72`; hip extension mawashi-geri elite `297 ± 110`;
hip abduction mawashi-geri `-262 ± 79`; hip flexion `250 ± 72`; pelvic axial rotation `452 ± 71`.

Joint angles at mawashi-geri impact `[MEAS]`: knee flexion `15 ± 6°`, hip flexion `39 ± 12°`,
hip abduction `50 ± 7°`. Mae-geri hip sweep: `~30°` extension → `~90°` flexion.

Impact forces (`N`, `[MEAS]`, for reference only — this is a non-contact viewer):
oi-zuki 6884, gyaku-zuki 3502, mae-geri sub-elite `2846 ± 805` / elite `3696 ± 1621`,
mawashi-geri novice `1007 ± 483` / sub-elite `1227 ± 429` / elite `1656 ± 459`.
Fist–board contact time 5 ms.

### 3.4 Stepping-technique phase structure (oi-zuki, gedan-barai-with-step, …)

Mapped from measured 3-stage GRF structure of a straight punch with a step
(stage durations: 33 %, 28 %, 29.5–45 % of total). Karate assignment:

| phase | `τ` window | GRF state | animation content |
|---|---|---|---|
| A — load / unload | 0.00 – 0.30 | rear-foot vertical GRF rising; front foot unweights | hikite chamber, pelvis pre-load, front heel lifts |
| B — transit | 0.30 – 0.62 | front foot ≈ 0 N; rear foot bears ~100 % | leg exchange, COM cruise, pelvis begins yaw |
| C — brake / chain / kime | 0.62 – 1.00 | front-foot GRF rising, rear-foot falling; front foot = pivot/brake | **entire arm chain fires here**; stance settles; kime |

Confirmed independently: in a stepping straight punch the trunk is effectively static until
`τ ≈ 0.70` and the kinetic chain to the fist runs only after `τ ≈ 0.80`.
**Implication for authoring: the arm must look inert for the first 60 % of a stepping count.**
Front-foot contact at `τ = 0.62 ± 0.06`.

Sources: <https://efsupit.ro/images/stories/30dec2017/Art%20287.pdf> ·
<https://pmc.ncbi.nlm.nih.gov/articles/PMC10459763/> ·
<https://pmc.ncbi.nlm.nih.gov/articles/PMC5571909/> ·
<https://biomedres.us/fulltexts/BJSTR.MS.ID.002550.php>

---

## 4. ACCELERATION PROFILE — the fittable easing

### 4.1 Requirements extracted from measurements

1. Velocity is 0 at both ends of the technique window (fist stops *at* the lock — kime, not
   follow-through). `[MEAS]` end-of-thrust defined as fist velocity sign change.
2. Peak velocity occurs late: `τ_p = 0.73` for the wrist, 0.65 shoulder, 0.42 hip. `[MEAS]`
3. Positive-acceleration time exceeds negative-acceleration time in **96.4 %** of trials, i.e.
   `τ_p > 0.50` always. Higher grade ⇒ *lower* positive fraction ⇒ *longer brake*. `[MEAS]`
4. Official JKA power envelope is `0 → 10 → 0`: a burst then total release. `[MEAS]` (doctrine)

### 4.2 The curve (single-parameter, closed-form, exact derivative)

Velocity kernel `v(τ) ∝ τ^a (1-τ)`. Integrating and normalizing gives the **kime ease**:

```
S(τ) = (a+2)·τ^(a+1) − (a+1)·τ^(a+2)          progress along the path, S(0)=0, S(1)=1
V(τ) = (a+1)(a+2)·τ^a·(1−τ)                    normalized speed, V(0)=V(1)=0
a     = τ_p / (1 − τ_p)                        τ_p = time fraction at which speed peaks
```

Properties: `S'(0) = S'(1) = 0` (C¹ dead stop at the lock — this *is* kime),
`v_peak / v_mean = (a+2)·(a/(a+1))^a`.

```js
// karate/src/anim/kimeEase.js
export const aFromPeak = (tauPeak) => tauPeak / (1 - tauPeak);

/** Normalized progress 0..1 along a technique channel. */
export function kimeEase(tau, tauPeak = 0.73) {
  const t = tau < 0 ? 0 : tau > 1 ? 1 : tau;
  const a = tauPeak / (1 - tauPeak);
  return (a + 2) * Math.pow(t, a + 1) - (a + 1) * Math.pow(t, a + 2);
}

/** Exact normalized speed (mean = 1). Use for cloth/impulse drivers and audio triggers. */
export function kimeEaseVel(tau, tauPeak = 0.73) {
  const t = tau < 0 ? 0 : tau > 1 ? 1 : tau;
  const a = tauPeak / (1 - tauPeak);
  return (a + 1) * (a + 2) * Math.pow(t, a) * (1 - t);
}
```

### 4.3 Per-channel `τ_p` / `a` assignment (proximal→distal)

| channel | `τ_p` | `a` | `v_peak/v_mean` | source of `τ_p` |
|---|---|---|---|---|
| rear-foot GRF / drive | 0.30 | 0.429 | 1.450 | `[DERIVED]` from §3.4 phase A/B |
| COM horizontal translation | 0.45 | 0.818 | 1.466 | `[DERIVED]` |
| pelvis yaw `ψ` | 0.42 | 0.724 | 1.453 | `[MEAS]` hip peak at 42 % MT |
| thorax yaw `θ` | 0.55 | 1.222 | 1.552 | `[DERIVED]` interpolated |
| shoulder girdle | 0.65 | 1.857 | 1.733 | `[MEAS]` shoulder peak at 65 % MT |
| elbow / forearm | 0.70 | 2.333 | 1.885 | `[DERIVED]` |
| **fist / foot (end effector)** | **0.73** | **2.704** | **2.009** | `[MEAS]` wrist peak at 73 % MT |
| fist inside `T_thrust` only | 0.60 | 1.500 | 1.627 | `[MEAS]` positive-accel fraction ≈0.55–0.75 |
| stepping technique end effector | 0.78 | 3.545 | 2.298 | `[DERIVED]` chain fires after `τ≈0.70` |

### 4.4 Distance/time statistics of the curve (exact, computed)

| `τ_p` | `a` | time to cover **first 20 % of distance** | time in **last 20 % of distance** | time in last 50 % of distance | distance covered in **last 20 % of time** | distance in last 10 % of time | distance at `τ=0.5` |
|---|---|---|---|---|---|---|---|
| 0.30 | 0.429 | 18.9 % | 36.0 % | 60.1 % | 6.5 % | 1.7 % | 63.7 % |
| 0.42 | 0.724 | 24.2 % | 31.8 % | 54.4 % | 8.5 % | 2.2 % | 56.4 % |
| 0.55 | 1.222 | 32.0 % | 26.6 % | 46.9 % | 12.0 % | 3.3 % | 45.2 % |
| 0.65 | 1.857 | 40.2 % | 22.1 % | 39.9 % | 16.9 % | 4.9 % | 33.5 % |
| **0.73** | **2.704** | **48.6 %** | **18.0 %** | **33.2 %** | **23.8 %** | **7.2 %** | **21.9 %** |
| 0.78 | 3.545 | 54.9 % | 15.2 % | 28.5 % | 30.8 % | 9.9 % | 14.0 % |

**Headline answers to the brief:**
- Fraction of total technique time spent inside the **last 20 % of distance** = **18.0 %**
  (`τ_p = 0.73`); for a stepping technique (`τ_p = 0.78`) = **15.2 %**.
- Fraction of time spent inside the **first 20 % of distance** = **48.6 %** — half the technique
  duration is spent covering one fifth of the path. *This slow-start / explosive-arrival ratio is
  the single strongest "reads as karate" cue.*
- At the halfway point in time the fist has travelled only **21.9 %** of its path.
- Peak fist speed = **2.01 × mean fist speed**.

Self-consistency `[DERIVED]`: `T_thrust = 0.096 s` (mid of measured 0.072–0.120), fist
`v_peak = 8.2 m/s`, `τ_p = 0.60` inside the thrust ⇒ `v_mean = 8.2/1.627 = 5.04 m/s` ⇒ fist
forward travel during the thrust = `0.484 m = 0.277 H`. That matches hikite-at-hip → full
extension. Curve, measured duration and measured peak velocity close on themselves.

Sources: <https://ojs.ub.uni-konstanz.de/cpa/article/view/1161/1049> ·
<https://ojs.ub.uni-konstanz.de/cpa/article/download/3410/3208> ·
<https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf>

### 4.5 Acceleration magnitudes (for cloth/impulse drivers)

| param | value | unit | note |
|---|---|---|---|
| mean fist forward accel over thrust | 68–114 | m/s² | `[DERIVED]` `8.2 / (0.120…0.072)` |
| peak fist forward accel | 110–215 | m/s² | `[DERIVED]` `1.6–1.9 ×` mean |
| peak fist braking accel at lock | 200–260 | m/s² | `[MEAS]` forearm accel at impact `25.43 ± 0.26 g = 249 m/s²` |
| brake/accel magnitude ratio | 1.3–2.0 | — | `[MEAS]` decel window is shorter than accel window (27 % vs 73 %) |

---

## 5. KIME — the terminal lock

| param | value | unit | tol | basis |
|---|---|---|---|---|
| tension envelope shape | `0 → 10 → 0` | — | — | `[MEAS]` JKA doctrine, verbatim principle |
| lock **ramp-in** start | −80 | ms rel. arrival | ±10 | `[MEAS]` wrist stabilizer EMG onset |
| neuromuscular **rise time** (visible hardening) | 43.6–65.4 | ms | `[MEAS]` `Tct` karate athletes | TMG total contraction time |
| — delay component `Td` | 20.7–24.0 | ms | `[MEAS]` | |
| — contraction component `Tc` | 22.9–32.2 | ms | `[MEAS]` | |
| full-lock **plateau** duration (kata) | 100–250 | ms | ±40 | `[DERIVED]` from `0-10-0` + pose-hold doctrine |
| full-lock plateau (kumite / kiai count) | 140–300 | ms | ±50 | `[DERIVED]` |
| **release** ramp (10 → 2) | 90–160 | ms | ±30 | `[DERIVED]` "tension released immediately after impact" |
| residual tone during pose hold | 15–25 | % of peak | ±8 | `[DERIVED]` zanshin, not slack |
| fist deceleration window | 0.27 × `T_tech` = **92 ms** | ms | ±15 | `[MEAS]` `τ_p = 0.73` |
| terminal fist velocity at lock | 0 | m/s | +0.3 | `[MEAS]` definition of end of thrust; kata is `sundome` (stop 2–5 cm short) |

### 5.1 Recoil / settle after the lock

Model each channel as a second-order settle triggered at `τ = 1`:
`x(t) = A·e^(−ζω_n t)·sin(ω_n√(1−ζ²)·t)`, first overshoot `M_p = e^(−πζ/√(1−ζ²))`.

| channel | amplitude `A` | `ω_n` (rad/s) | `ζ` | time to peak overshoot (ms) | settled (<2 %) by (ms) | visible bounces |
|---|---|---|---|---|---|---|
| fist along strike axis (backward) | 0.012–0.020 `L` = 6–10 mm | 45–63 | 0.40 ± 0.06 | 55 ± 20 | 160–220 | 1 |
| forearm/elbow angle | 1.5–3.0 deg | 40–55 | 0.45 ± 0.08 | 60 ± 20 | 150–200 | 1 |
| pelvis yaw `ψ` overshoot | 1.5–3.0 deg | 30–42 | 0.35 ± 0.07 | 80 ± 25 | 230–300 | 1 |
| thorax yaw `θ` overshoot | 2.0–4.0 deg | 26–36 | 0.30 ± 0.07 | 95 ± 30 | 280–380 | 1–2 |
| COM along travel axis | 0.004–0.008 `L` = 2–4 mm | 25–35 | 0.50 ± 0.10 | 100 ± 30 | 250–320 | 1 |
| COM / head vertical | 0.002–0.004 `H` = 3.5–7 mm | 22–32 | 0.45 ± 0.10 | 110 ± 30 | 280–360 | 1 |
| head yaw (gaze already locked) | 0.5–1.2 deg | 35–50 | 0.55 ± 0.10 | 70 ± 25 | 170–230 | 0–1 |

Overshoot ratio reference (computed): `ζ = 0.30 → M_p = 0.372`, `0.35 → 0.309`,
`0.40 → 0.254`, `0.50 → 0.163`. Second overshoot at `ζ = 0.40` is `0.064` — i.e. one clearly
readable bounce, ≈1.6 cycles to visual rest.

**Do not** exceed 0.020 `L` on the fist recoil: a large snap-back reads as a punch being *pulled*
and, in kata judging terms, as an incomplete technique.

Sources: <https://pdfs.semanticscholar.org/8a40/14c1cdbb51b3b92fb2e7ba48069e904b0d0d.pdf> ·
<https://pmc.ncbi.nlm.nih.gov/articles/PMC12300276/> ·
<https://www.karatebyjesse.com/how-to-get-kime-in-karate-techniques/> ·
<https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf>

---

## 6. TEMPO

### 6.1 Official JKA kata durations (26 kata) — the canonical tempo table

| # | kata | movements | kiai on | official duration (s) | **s / count** |
|---|---|---|---|---|---|
| 1 | Heian Shodan | 21 | 9, 17 | 40 | 1.905 |
| 2 | Heian Nidan | 26 | 11, 26 | 45 | 1.731 |
| 3 | Heian Sandan | 20 | 10, 20 | 40 | 2.000 |
| 4 | Heian Yondan | 27 | 13, 25 | 50 | 1.852 |
| 5 | Heian Godan | 23 | 12, 19 | 50 | 2.174 |
| 6 | Tekki Shodan | 29 | 15, 29 | 50 | 1.724 |
| 7 | Tekki Nidan | 24 | 16, 24 | 50 | 2.083 |
| 8 | Tekki Sandan | 36 | 16, 36 | 50 | 1.389 |
| 9 | Bassai Dai | 42 | 19, 42 | 60 | 1.429 |
| 10 | Kanku Dai | 65 | 15, 65 | 90 | 1.385 |
| 11 | Jion | 47 | 17, 47 | 60 | 1.277 |
| 12 | Empi | 37 | 15, 36 | 60 | 1.622 |
| 13 | Hangetsu | 41 | 11, 40 | 60 | 1.463 |
| 14 | Jitte | 24 | 13, 24 | 60 | 2.500 |
| 15 | Gankaku | 42 | 28, 42 | 60 | 1.429 |
| 16 | Bassai Sho | 27 | 17, 22 | 60 | 2.222 |
| 17 | Kanku Sho | 48 | 6, 47 | 60 | 1.250 |
| 18 | Sochin | 41 | 28, 40 | 60 | 1.463 |
| 19 | Chinte | 33 | 28, 32 | 60 | 1.818 |
| 20 | Unsu | 48 | 36, 48 | 60 | 1.250 |
| 21 | Nijushiho | 34 | 18, 32 | 60 | 1.765 |
| 22 | Jiin | 35 | 11, 35 | 60 | 1.714 |
| 23 | Meikyo | 33 | 32 | 60 | 1.818 |
| 24 | Gojushiho Sho | 65 | 57, 64 | 90 | 1.385 |
| 25 | Gojushiho Dai | 67 | 59, 66 | 90 | 1.343 |
| 26 | Wankan | 22 | 22 | 40 | 1.818 |

Aggregate: mean **1.685 s/count**, median 1.719, range **1.250–2.500**.
Heian group mean **1.932**; all non-Heian kata mean **1.626**. Beginner kata are **18.8 %** slower
per count than the rest. `[DERIVED]` computed from the table.

Taikyoku Shodan (not in the JKA 26): **20 movements, kiai on 8 and 16** (some lineages add 20).
`[DERIVED]` official-tempo duration = `20 × 1.905 = 38.1 s`; performance tempo 26–32 s.

Source: <https://www.francejka.com/les-kata.html> · <https://www.risingsun.ie/karate-wiki/kata> ·
<https://www.northstowekarate.com/kata/heian/>

### 6.2 Tempo tiers (pick one per playback mode)

| mode | s/count | counts/min | Heian Shodan (21) | Taikyoku Shodan (20) |
|---|---|---|---|---|
| **T0** slow teaching count | 2.50–3.50 | 17–24 | 53–74 s | 50–70 s |
| **T1** JKA official / exam reference | 1.90 | 31.6 | **40.0 s** | 38.1 s |
| **T2** senior-instructor performance | 1.10–1.62 | 37–55 | 23–34 s | 22–32 s |
| **T3** WKF competition, expressive | 1.30–1.80 | 33–46 | 27–38 s | — |

T1 vs T2 is a genuine disagreement in the sources (§12): the official table says 40 s while
measured performances by named senior instructors have been reported at 23.2–33.7 s. Ship **T1 as
the default** (it matches the published figure and is easier to read on a 360° orbit) and expose
T2 as a "performance tempo" toggle. Global playback rate multiplier: `rate ∈ [0.25, 2.0]`,
default 1.0; scrubbing must not resample the curves, only re-evaluate `τ`.

### 6.3 Count-period decomposition and pause classes

`T_count = T_prep + T_tech + T_kime + T_hold`.

| pause class | applies to | `T_hold` (s) | tol |
|---|---|---|---|
| **P0** in-combination (block+counter in one breath) | JKA: "combination techniques must be done in one breath" | 0.00–0.10 | ±0.05 |
| **P1** normal count boundary | plain consecutive counts | 0.30–0.45 | ±0.10 |
| **P2** direction change / embusen turn boundary | after any 90°/180°/270° turn group | 0.60–0.90 | ±0.15 |
| **P3** kiai count / end of technique group | counts carrying a kiai | 1.00–1.40 | ±0.20 |
| **P4** final movement → yoi (zanshin) | last count | 1.50–2.50 | ±0.40 |

Reported guidance: a couple of seconds on the final posture is right; **3 s after a kiai is too
long** — cap `P3` at 1.4 s and `P4` at 2.5 s.

**Taikyoku Shodan pause map** (documented counting groups
`1-2 | 3-4 | 5-6-7-8ᴷ | 9-10 | 11-12 | 13-14-15-16ᴷ | 17-18 | 19-20ᴷ`):

| after count | class | after count | class |
|---|---|---|---|
| 1,3,5,6,7,9,11,13,14,15,17,19 | P1 | 2,4,10,12,18 | P2 |
| 8, 16 | P3 (kiai) | 20 | P4 (kiai + zanshin) |

Budget check `[DERIVED]` at T1: `20 × (0.40 prep + 0.42 tech + 0.16 kime) = 19.6 s`;
pauses `12×0.38 + 5×0.75 + 2×1.20 + 1×2.00 = 4.56 + 3.75 + 2.40 + 2.00 = 12.71 s`;
total **32.31 s**. To reach the 38.1 s T1 target, scale `T_prep` and all pause classes by
`tempoScale = 1.28` (leaves `T_tech + T_kime = 11.6 s` untouched).
Expose one scalar `tempoScale` that multiplies `T_prep` and `T_hold` only — **never** `T_tech`,
`T_thrust` or `T_kime`: the *technique* stays fast at every tempo. This is exactly the JKA
"contrast in speed" criterion.

Sources: <https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf> ·
<https://www.karatebyjesse.com/pauses-kata-true-meaning/> ·
<https://www.takahashidojo.com/articles/22>

### 6.4 Hard rules from the WKF 2026 kata rules (authoring constraints)

| rule | animation constraint |
|---|---|
| Foul: "asynchronous movements, such as delivering a technique before the body transition is completed" | `t(arm arrival) ≥ t(stance settle)`; ship `t_arm − t_stance = +0.00…+0.04 s`. **Never negative.** |
| "Kiai must be short and concentrated, and simultaneously with the technique" | kiai peak within ±40 ms of the kime lock; see §8 |
| Foul: theatrics, "slapping the … Karategi" | gi snap must be a *passive* consequence; cap sleeve overshoot at 0.045 `H` (§9) |
| Evaluation criteria include: transitional movements, timing & synchronisation, correct breathing, focus (KIME), strength, speed, balance | each has a channel in this spec |
| No mandatory kata duration, no mandatory technique speed | tempo tiers in §6.2 are style choices, not rules |
| ≤35 s from announcement to first move | irrelevant to playback; noted |

Source: <https://www.wkf.net/files/pdf/documents/WKF%20Kata%20Competition%20Rules%202026%20MASTER%20COPY_V2.pdf>

---

## 7. WEIGHT SHIFT, COM, HEAD HEIGHT, STANCE LANDING

### 7.1 Static weight distribution

| stance | `W_f` front (%) | `W_r` rear (%) | tol | source |
|---|---|---|---|---|
| zenkutsu-dachi | 65 | 35 | ±5 | 66/34 and 70/30 both published — take the midpoint |
| kokutsu-dachi | 30 | 70 | ±5 | standard Shotokan |
| kiba-dachi | 50 | 50 | ±3 | standard |
| hachiji-dachi / yoi | 50 | 50 | ±2 | standard |
| heisoku / musubi-dachi | 50 | 50 | ±2 | standard |

Transfer curve during a step: `W_f(τ) = 0.50 + 0.15·kimeEase(τ, 0.45)` after front-foot contact
at `τ = 0.62`; before contact, `W_f` ramps 0.50 → 0.00 over `τ ∈ [0.00, 0.30]` and holds at 0
through phase B. `[DERIVED]` from the measured 3-stage GRF pattern (§3.4).

### 7.2 COM horizontal velocity profile during a step

| param | value | unit | tol | basis |
|---|---|---|---|---|
| COM forward travel per stepping count | 0.40–0.50 `H` = 70–88 cm | m | ±0.04 `H` | `[DERIVED]` one zenkutsu step |
| COM travel window `T_step` | 0.60–0.80 (last 55 % of `T_prep` + `τ ∈ [0, 0.90]` of `T_tech`) | s | ±0.10 | `[DERIVED]` §3.4 phase A/B/C |
| `v_COM` mean over travel window | 0.93–1.47 | m/s | ±0.20 | `[DERIVED]` `0.70…0.88 m / 0.60…0.80 s` |
| `v_COM` peak | 1.40–2.20 | m/s | ±0.30 | `[DERIVED]` `1.466 ×` mean, `τ_p = 0.45` |
| hip-marker peak velocity (upper bound cross-check) | 2.42–3.20 | m/s | `[MEAS]` | includes yaw component |
| `v_COM` at front-foot contact | 0.45–0.70 × `v_peak` | — | ±0.10 | `[DERIVED]` brake phase |
| `v_COM` at kime lock | ≤0.08 | m/s | +0.05 | `[DERIVED]` COM must be dead at lock |
| profile shape | `kimeEase(τ, 0.45)`, `a = 0.818` | — | — | §4.3 |
| optional cruise plateau | `τ ∈ [0.35, 0.70]` at 0.90–1.00 `v_peak` | — | — | `[DERIVED]` from the 3-stage GRF flat |

### 7.3 Head-height / vertical COM constancy

Authoritative basis: JKA lists "hips are parallel to the floor, the upper body kept straight" as an
exam criterion for both kihon and kata, and requires hip rotation and body shifting to be "kept
parallel to the floor". Independently, a 3-D motion-analysis + force-plate study concludes that
zenkutsu-dachi stepping does **not** convert potential to kinetic energy in the inverted-pendulum
manner of ordinary walking — i.e. the karate step deliberately suppresses the vertical COM
oscillation of gait.

| param | value | unit | tol | note |
|---|---|---|---|---|
| head-top vertical excursion, level step (peak-to-peak) | **0.006 `H` = 1.05 cm** | m | max 0.012 `H` = 2.10 cm | `[DERIVED]` "hips level" criterion |
| same, for normal human walking (contrast) | 0.030–0.045 `H` = 5.3–7.9 cm | m | — | reference only — do **not** reproduce |
| pelvis vertical excursion, level step | ≤0.008 `H` = 1.40 cm | m | max 0.012 `H` | `[DERIVED]` |
| pelvis roll (frontal-plane tilt) at any time | 0 | deg | ±2.5 | JKA "hips parallel to the floor" |
| pelvis pitch (sagittal tilt) drift during a step | 0 | deg | ±3 | |
| head vertical excursion during a kick | ≤0.020 `H` = 3.5 cm | m | max 0.030 `H` | `[DERIVED]` |
| deliberate level change (zenkutsu → kiba, or into a lower stance) | 0.020–0.045 `H` = 3.5–7.9 cm | m | ±0.008 `H` | intentional, animate it |

Fail condition for the visual critic: any level step whose head-top Y varies by more than
**0.012 `H`** peak-to-peak reads as walking, not karate.

### 7.4 "Hip drops into the stance" landing behaviour

Sequence at front-foot contact (`τ = 0.62 ± 0.06` for a stepping count):

| param | value | unit | tol |
|---|---|---|---|
| downward sink amplitude `Δy` | 0.006–0.014 `H` = 1.05–2.45 cm | m | ±0.003 `H` |
| sink onset | at front-foot contact, `τ = 0.62` | — | ±0.06 τ |
| sink rise (exponential) time constant `T_s` | 25–35 | ms | ±8 |
| sink 90 % complete | 60–80 | ms after contact | ±15 |
| rebound amplitude | 15–25 % of `Δy` | — | ±8 % |
| rebound peak | 90–130 | ms after contact | ±25 |
| fully settled | 200–280 | ms after contact | ±40 |
| sink completion vs kime lock | sink completes **at or ≤40 ms before** the lock | ms | never after |

`y_hip(t) = y0 − Δy·(1 − e^(−t/T_s)) + Δy·r·e^(−ζω_n t)·sin(ω_n t)` with `r = 0.20`,
`ω_n = 28 rad/s`, `ζ = 0.45`. Front knee flexion increases by 4–8° across the sink `[DERIVED]`.

Sources: <https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf> ·
<https://pubmed.ncbi.nlm.nih.gov/34269821/> · <https://pmc.ncbi.nlm.nih.gov/articles/PMC12821703/>

---

## 8. BREATHING & KIAI

### 8.1 Doctrine → numbers

JKA: "breathing must be synchronized with corresponding movements of the techniques; combination
techniques must be done in one breath." Kihon convention: inhale on the chamber/wind-up, sharp
exhale on execution. WKF: "inappropriate exhalation" is a very serious foul (so: no audible
theatrical hissing), and kiai must be short, concentrated, simultaneous with the technique.

Breath phase mapped onto the count period (`b ∈ [0,1]`, 1 = full inhale):

| segment | window | `b` | duration at T1 (s) |
|---|---|---|---|
| inhale | `T_prep` | 0.15 → 1.00 | 0.40–0.50 |
| sharp exhale | `τ ∈ [0, 1]` of `T_tech` | 1.00 → 0.30 | 0.34–0.50 |
| kime breath-hold (residual exhale pressure) | `T_kime` | 0.30 → 0.22 | 0.10–0.25 |
| passive exhale / settle | `T_hold` | 0.22 → 0.15 | pause length |

| param | value | unit | tol |
|---|---|---|---|
| exhale share of count period | 55–70 | % | ±8 |
| inhale share | 22–32 | % | ±6 |
| breath-hold share | 8–15 | % | ±5 |
| combination (P0) — one breath across N counts | inhale once, exhale across all N | — | N ≤ 3 |
| breaths per minute at T1 | 31.6 (one per count) | 1/min | — |
| breaths per minute during P0 groups | 12–20 | 1/min | — |

### 8.2 Visible chest / shoulder amplitude

Anchor `[MEAS]`: chest-circumference excursion between maximal inhalation and maximal exhalation in
healthy young adults = 5.4 cm (upper chest) and 6.4 cm (lower chest); overall mean 5.53 cm
(men 6.40, women 5.22). On a ~90 cm resting chest circumference that is a **6.1 % linear scale**
at maximum effort.

| param | value | unit | tol | basis |
|---|---|---|---|---|
| ribcage X/Z uniform scale, resting | 1.000 | — | — | |
| ribcage X/Z scale, kata inhale | 1.022 | — | ±0.006 | `[DERIVED]` 35–40 % of maximal 6.1 % |
| ribcage X/Z scale, forced kiai exhale | 0.994 | — | ±0.004 | `[DERIVED]` below resting |
| radial chest displacement, inhale | 0.30–0.42 cm = 0.0017–0.0024 `H` | m | ±0.08 cm | `[DERIVED]` |
| sternum forward/up travel, inhale | 0.5–0.9 cm = 0.003–0.005 `H` | m | ±0.2 cm | `[DERIVED]` |
| clavicle / shoulder-tip rise, inhale | 0.4–0.8 cm = 0.002–0.005 `H` | m | max 0.008 `H` | shoulders must stay down — this is a correctness cue |
| abdominal (hara) forward bulge, inhale | 0.8–1.4 cm = 0.005–0.008 `H` | m | ±0.3 cm | `[DERIVED]` diaphragmatic emphasis |
| abdominal draw-in at kime | 0.6–1.0 cm inward | m | ±0.3 cm | `[DERIVED]` intra-abdominal pressure spike |
| breath cycle phase offset, chest vs abdomen | abdomen leads chest by 60–120 ms | ms | ±40 | `[DERIVED]` diaphragmatic-first |

### 8.3 Kiai

No published measurement of karate kiai duration was found; all values `[DERIVED]` from the WKF
"short and concentrated" rule plus monosyllabic maximal-effort vocalisation timing.

| param | value | unit | tol |
|---|---|---|---|
| kiai vocal duration | 0.30 | s | 0.22–0.45 |
| kiai onset relative to kime lock | −60 | ms | ±40 (must overlap the lock) |
| kiai peak (loudest instant) relative to lock | 0 | ms | ±40 (WKF: simultaneous) |
| jaw opening amplitude at peak | 65–80 | % of max | ±10 |
| jaw open ramp / close ramp | 70 / 180 | ms | ±25 |
| head/neck extension during kiai | 0 | deg | ±3 (do **not** throw the head back) |
| additional ribcage compression during kiai | 0.006–0.010 scale | — | ±0.003 |
| kiai count positions | see §6.1 kata table | — | exact |

Sources: <https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf> ·
<https://www.wkf.net/files/pdf/documents/WKF%20Kata%20Competition%20Rules%202026%20MASTER%20COPY_V2.pdf> ·
<https://www.sciencedirect.com/science/article/abs/pii/S0161475416300860> ·
<https://ski-usf.com/karate-ibuki-breathing/>

---

## 9. SECONDARY MOTION — the gi

Two separable phenomena. (1) The **snap**: a transverse wave crossing a momentarily taut panel —
fast, small, crisp. (2) The **settle**: the fundamental pendulum mode of each free hem — slow,
large, damped. Cloth springs behave as damped harmonic oscillators; the standard practical range
for the damping constant is 1–10 % of stiffness.

### 9.1 Snap (limb stop → visible crack)

| param | value | unit | tol | basis |
|---|---|---|---|---|
| gi areal density (mid-weight, 8–12 oz/yd²) | 0.27–0.41 | kg/m² | ±0.05 | fabric spec |
| linear density of a 15 cm-wide strip | 0.041–0.062 | kg/m | ±0.008 | `[DERIVED]` areal × width |
| transverse wave speed on a taut panel | 11–20 | m/s | ±4 | `[DERIVED]` `c = √(T/µ)`, `T ≈ 8–16 N` |
| wave travel length, sleeve | 0.10–0.14 `H` = 17.5–24.5 cm | m | ±0.02 `H` | sleeve free length |
| **limb-stop → snap-crack delay, sleeve** | **10–20** | **ms** | ±5 | `[DERIVED]` `L/c` |
| snap-crack delay, trouser hem (L = 28–37 cm) | 16–31 | ms | ±8 | `[DERIVED]` `L/c` |
| snap amplitude (lateral ripple) | 0.004–0.010 `H` = 0.7–1.8 cm | m | ±0.003 `H` | `[DERIVED]` |
| snap trigger threshold | limb `abs(a) > 90 m/s²` **and** `abs(v)` falling | — | — | ties to §4.5 |

### 9.2 Settle (fundamental sway mode)

Uniform-rod pendulum, `T = 2π√(2L/3g)`, `f = 1/T`, `ω_n = 2π/T`. Computed:

| free length `L` (m) | `T` (s) | `f` (Hz) | `ω_n` (rad/s) | quarter-period (ms) |
|---|---|---|---|---|
| 0.12 | 0.567 | 1.76 | 11.07 | 142 |
| 0.20 | 0.733 | 1.37 | 8.58 | 183 |
| 0.28 | 0.867 | 1.15 | 7.25 | 217 |
| 0.36 | 0.983 | 1.02 | 6.39 | 246 |
| 0.45 | 1.099 | 0.91 | 5.72 | 275 |

Per-element ship parameters:

| element | free `L` | `ω_n` (rad/s) | `f` (Hz) | `ζ` | **limb-stop → peak overshoot (ms)** | overshoot amplitude | settled (<10 %) by (s) | visible bounces |
|---|---|---|---|---|---|---|---|---|
| sleeve hem (below elbow) | 0.10–0.14 `H` (17.5–24.5 cm) | 8.5–11.0 | 1.35–1.75 | 0.30 ± 0.08 | **55 ± 20** | 0.020–0.045 `H` = 3.5–7.9 cm | 0.30–0.45 | 1 |
| trouser hem (below knee) | 0.16–0.21 `H` (28–37 cm) | 6.3–7.3 | 1.00–1.16 | 0.26 ± 0.08 | **75 ± 25** | 0.025–0.055 `H` = 4.4–9.6 cm | 0.40–0.60 | 1–2 |
| jacket skirt / lapel (below obi) | 0.14–0.20 `H` (24–35 cm) | 6.4–7.8 | 1.02–1.25 | 0.24 ± 0.08 | **90 ± 30** | 0.030–0.060 `H` = 5.3–10.5 cm | 0.50–0.80 | 2 |
| obi (belt) free ends | 0.20–0.28 `H` (35–49 cm) | 5.4–7.3 | 0.86–1.16 | 0.18 ± 0.06 | **110 ± 40** | 0.050–0.100 `H` = 8.8–17.5 cm | 1.00–1.80 | 3–4 |

Headline answer to the brief: **the delay between limb stop and cloth stop is 15–30 ms to the
audible/visible crack, 55–110 ms to peak overshoot, and 0.30–1.80 s to full rest depending on the
element.** The obi ends are still visibly moving during the pose hold — that is correct and is one
of the cheapest, strongest realism cues available. The jacket skirt must be still by the time the
next count starts at T1 (0.80 s < 1.90 s ✓); the obi ends need not be.

### 9.3 Drive and constraints

| param | value | unit | tol |
|---|---|---|---|
| cloth damping constant as fraction of stiffness | 0.01–0.10 | — | `[MEAS]` practice range |
| cloth solver substeps at 60 fps | 4 | — | ≥2 |
| cloth stretch limit | 1.02 | — | ±0.01 |
| max cloth vertex speed clamp | 12 | m/s | — |
| wind / ambient air motion | 0 | m/s | dojo interior; add ≤0.3 m/s only for outdoor variants |
| self-collision thickness | 0.004 `H` = 0.7 cm | m | ±0.002 `H` |
| deliberate gi slap / stamp | **forbidden** | — | WKF very serious foul |

Sources: <https://andrewdcampbell.github.io/clothsim/> ·
<https://www.wkf.net/files/pdf/documents/WKF%20Kata%20Competition%20Rules%202026%20MASTER%20COPY_V2.pdf>

---

## 10. Consolidated per-technique dynamics table (kata, T1 tempo, `H = 1.75 m`)

`T_tech` s · `T_thrust` s · `|Δψ|` deg · `ω_ψ` deg/s · `τ_p` end-effector ·
`v_pk` m/s end-effector · hip→arrival ms · sh→arrival ms · elbow→arrival ms ·
`T_kime` ms · recoil (fraction of `L`)

| technique | `T_tech` | `T_thrust` | `absΔψ` | `ω_ψ` | `τ_p` | `v_pk` | hip→arr | sh→arr | elb→arr | `T_kime` | recoil |
|---|---|---|---|---|---|---|---|---|---|---|---|
| choku-zuki | 0.28 | 0.10 | 0–6 | 90 | 0.70 | 4.4 | 150 | 130 | 75 | 140 | 0.014 |
| gyaku-zuki chudan | 0.34 | 0.13 | 45 | 380 | 0.73 | 5.1 | 245 | 186 | 88 | 160 | 0.016 |
| gyaku-zuki jodan | 0.34 | 0.13 | 45 | 380 | 0.73 | 5.1 | 245 | 186 | 88 | 160 | 0.016 |
| kizami-zuki | 0.24 | 0.09 | 45 | 350 | 0.70 | 4.2 | 170 | 130 | 70 | 130 | 0.014 |
| oi-zuki chudan (step) | 0.52 | 0.14 | 45 | 330 | 0.78 | 6.5 | 380 | 250 | 100 | 170 | 0.014 |
| gedan-barai (step) | 0.50 | 0.14 | 65 | 400 | 0.74 | 4.4 | 360 | 240 | 105 | 170 | 0.018 |
| age-uke (step) | 0.46 | 0.13 | 60 | 380 | 0.72 | 4.2 | 330 | 225 | 100 | 160 | 0.018 |
| soto-uke (step) | 0.46 | 0.13 | 70 | 415 | 0.72 | 4.2 | 330 | 225 | 100 | 160 | 0.018 |
| uchi-uke (step) | 0.46 | 0.13 | 65 | 400 | 0.72 | 4.2 | 330 | 225 | 100 | 160 | 0.018 |
| shuto-uke (kokutsu, step) | 0.52 | 0.14 | 55 | 360 | 0.74 | 4.0 | 375 | 250 | 105 | 175 | 0.018 |
| tettsui / uraken otoshi | 0.32 | 0.11 | 30 | 300 | 0.72 | 4.6 | 220 | 170 | 85 | 150 | 0.020 |
| empi-uchi (elbow) | 0.28 | 0.09 | 50 | 400 | 0.68 | 3.6 | 200 | 150 | 70 | 150 | 0.016 |
| mae-geri keage chudan | 0.55 | 0.16 | 50 | 320 | 0.72 | 6.0 | 390 | — | 130 (knee) | 165 | 0.015 |
| mawashi-geri chudan | 0.62 | 0.18 | 75 | 440 | 0.74 | 7.4 | 440 | — | 150 (knee) | 175 | 0.015 |
| yoko-geri keage | 0.58 | 0.17 | 12 | 180 | 0.73 | 6.2 | 400 | — | 140 (knee) | 170 | 0.015 |
| yoko-geri kekomi | 0.62 | 0.19 | 12 | 180 | 0.76 | 6.4 | 430 | — | 150 (knee) | 185 | 0.014 |
| 90° turn + technique | 0.66 | 0.14 | 90 | 300 | 0.78 | 4.4 | 480 | 300 | 105 | 175 | 0.016 |
| 180° turn + technique | 0.78 | 0.14 | 180 | 330 | 0.80 | 4.4 | 580 | 330 | 105 | 180 | 0.016 |
| yoi / kamae transition | 0.90 | — | 0–45 | 90 | 0.50 | 0.8 | — | — | — | 0 | 0.004 |

Kick `τ_p` and `v_pk` are for the striking foot; the "elbow→arrival" column carries the knee
extension onset for kicks. All kick durations are the *kata* window (chamber → lock), not the
published to-target execution times of §3.3, which include an approach step.

Tolerances: `T_*` ±12 %, `|Δψ|` ±6°, `ω_ψ` ±20 %, `τ_p` ±0.05, `v_pk` ±20 %,
offsets ±15 %, `T_kime` ±25 %, recoil ±30 %.

---

## 11. Implementation contract

```js
// Per technique instance the engine needs exactly this record.
/** @typedef {{
 *   Ttech:number, Tthrust:number, Tprep:number, Tkime:number, Thold:number,
 *   dPsi:number,            // deg, signed by stance side
 *   channels: Record<string, { tauP:number, lead:number }>,  // lead = ms before arrival
 *   recoil: number,         // fraction of L
 *   kiai: boolean
 * }} TechniqueDynamics */

const CHANNELS = {                       // tauP, lead(ms) at Ttech=340
  rearFootDrive:   { tauP: 0.30, lead: 280 },
  comTranslate:    { tauP: 0.45, lead: 260 },
  pelvisYaw:       { tauP: 0.42, lead: 245 },
  hikite:          { tauP: 0.70, lead: 205 },
  thoraxYaw:       { tauP: 0.55, lead: 187 },
  shoulderGirdle:  { tauP: 0.65, lead: 186 },
  elbowExtend:     { tauP: 0.60, lead:  88 },   // tauP measured inside Tthrust
  wristLock:       { tauP: 0.50, lead:  80 },
};

// Evaluate one channel. tArr = arrival time (s) in the clip; lead scales with Ttech.
function channelAlpha(t, tArr, Ttech, ch) {
  const lead = ch.lead * 1e-3 * (Ttech / 0.340);
  const tau  = (t - (tArr - lead)) / lead;
  return kimeEase(tau, ch.tauP);
}
```

Invariants a critic must be able to assert:
1. `lead(rearFootDrive) > lead(pelvisYaw) > lead(thoraxYaw) ≥ lead(shoulderGirdle) > lead(elbowExtend) > lead(wristLock) > 0`.
2. `tauP` is monotonically non-decreasing from proximal to distal (0.30 → 0.73).
3. `|v_endEffector(tArr)| < 0.30 m/s` (kime, not follow-through).
4. head-top `Y` peak-to-peak over any level step `< 0.012·H`.
5. `t(armArrival) − t(stanceSettle) ∈ [0, 0.04] s`.
6. pelvis roll and pitch `|·| < 2.5°` at all times except deliberate level changes.
7. `tempoScale` multiplies `Tprep` and `Thold` only.
8. cloth peak-overshoot time lags its driving limb's `v = 0` by 55–110 ms per element.

---

## 12. Uncertainties

1. **Hanmi is 45° or 90°.** The JKA instructor technical manual explicitly prescribes a 45° hip
   rotation for hanmi. André Bertel (7th dan, direct student of Asai) defines *pure* hanmi as 90°
   with a working range from ~30° to 90°. A third coaching source treats hanmi as "+45°". These are
   not reconcilable by averaging — they are probably measuring different things (pelvis-normal vs
   shoulder-line vs foot-line). The spec ships 45° (JKA) and this choice is disputable.
2. **Peak segment velocities disagree by up to 2.7×.** Fist/wrist peaks: 8.1–8.4 m/s (VICON,
   200 Hz, n=3), 6.93–8.52 m/s (Eagle, 150 Hz, n=8), 5.125 m/s ("linear kinematic analysis",
   n=1), 5.33 m/s (contact-plate impact speed, n=1), and a secondary claim of 14 m/s. Shoulder
   peaks span 1.70–5.14 m/s. Causes are almost certainly different movement-start definitions
   (10 % of max hip velocity vs peak GRF vs accelerometer onset), different marker sets, and
   resultant-vs-axial velocity. Only the *dimensionless* `τ_p` fractions are used as load-bearing
   inputs; the absolute m/s figures are used only as sanity bounds.
3. **Kata duration: 40 s vs 23–34 s for Heian Shodan.** The official JKA-France table says 40 s;
   reported timings of four named senior instructors fall between 23.16 s and 33.72 s. It is likely
   the 40 s figure is a *counted/teaching* tempo, not a performance tempo, but I could not fetch
   the primary page carrying the 23–34 s measurements (TLS certificate mismatch) and it is
   reproduced here from a search snippet only. Low confidence on the 23.16/33.72 endpoints.
4. **Taikyoku Shodan kiai on 8 and 16, or 8, 16 and 20.** Sources conflict. Movement count (20) is
   agreed.
5. **Kiai duration is entirely derived.** No acoustic study of karate kiai was found. The 0.30 s
   value and the −60 ms onset are inferences from the WKF "short and concentrated, simultaneous
   with the technique" rule. A critic could reasonably argue for anything in 0.15–0.6 s.
6. **The 0.78 m karate COM figure in the three-style kick comparison is ambiguous.** Two extractions
   of the same paper rendered it as `0.78 ± 0.24 m/s` (vertical COM velocity) and as
   `0.78 ± 0.24 m` (vertical COM displacement). 0.78 m of vertical COM displacement in a
   roundhouse kick is physically implausible, so the velocity reading is assumed; that assumption
   is not verified. It is used only as directional support for "karate keeps vertical COM motion
   low", not as a numeric input.
7. **Emmermacher's acceleration axis units could not be read.** The figures give `a+max ≈ 3–6` and
   `a-max ≈ −10…−20` in unlabelled (OCR-lost) units. The acceleration magnitudes in §4.5 were
   therefore re-derived from the measured velocity and duration, cross-checked against an
   independent `25.43 g` forearm impact acceleration. The brake/accel ratio of 1.3–2.0 is the least
   certain figure in that block.
8. **The 3-stage GRF phase structure is from boxing, not karate.** The 33 % / 28 % / 29.5–45 %
   split and the "chain fires after 70–80 % of total time" finding come from a study of boxers'
   straight punches. Karate oi-zuki has a longer, more committed step and the transit phase is
   probably a larger share. The mapping in §3.4 is an assumption.
9. **EMD = 30 ms is a flat assumption.** Real electromechanical delay differs per muscle (larger
   for long, compliant tendons). Applying a uniform +30 ms preserves ordering but distorts the
   true inter-segment lags by perhaps ±15 ms.
10. **All cloth numbers are derived from first principles, not measured on a gi.** The pendulum
    frequencies assume a uniform rod, which underestimates stiffness for a starched double-weave gi
    (real `f` is probably 10–30 % higher, settle times correspondingly shorter). Damping ratios
    (0.18–0.30) are chosen to give 1–4 visible bounces and are aesthetic, not measured.
11. **Which techniques finish in hanmi vs shomen** (§2.2) is standard Shotokan pedagogy but not
    stated as a table in any primary source I could fetch; age-uke in particular is taught both
    ways in different JKA-lineage dojos. The manual only gives the 45° hanmi drill and the
    gyaku-zuki "rotate the hips fully" instruction.
12. **Kime plateau and release durations are derived from doctrine**, not measurement. The JKA
    `0-10-0` envelope is explicit and quotable; the 100–250 ms plateau and 90–160 ms release ramp
    are animation choices consistent with it and with the 43.6–65.4 ms neuromuscular rise time.
13. **`T_tech` kata-vs-kumite scale factor (1.15–1.35×) is unmeasured.** Every published karate
    technique duration is from a kumite/max-effort or to-target protocol. No study times an
    individual technique *inside a kata*. This factor is the load-bearing bridge between the
    biomechanics literature and the actual product, and it is a guess constrained only by the
    per-count budget arithmetic in §6.3.
14. **`v_pk` values in §10 are back-computed** from kumite measurements × 0.62, not measured in
    kata. The 0.62 factor follows from `1/1.35` plus a small non-impact reduction.
15. Kizami-zuki impact force reported as 166.3 N alongside oi-zuki 6884 N and gyaku-zuki 3502 N in
    one secondary source is almost certainly a transcription error (two orders of magnitude off);
    it is quoted in §3.3 only for completeness and must not be used.
