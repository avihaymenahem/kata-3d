# 02 — KATA STEP LISTS: Taikyoku Shodan (20) & Heian Shodan (21)

Machine-actionable choreography spec. Consumers: pose/keyframe generators, embusen validators, timeline builders.
Every geometric fact is `param | value | unit | tolerance | source`. `[DERIVED]` = converted from a verbal source statement using the stated assumption.
Status: cross-checked against 5 independent step lists + 1 official JKA-affiliate sheet (JKA England, incl. its embusen diagram, text-extracted from PDF).

---

## 1. Conventions (NORMATIVE — do not re-derive)

| id | value | notes |
|---|---|---|
| Up axis | `+Y` | |
| Facing at yoi | `-Z` | character looks down −Z |
| Character's LEFT at yoi | `+X` | **mandated by project spec** — see §12.1 for the handedness caveat |
| Character's RIGHT at yoi | `-X` | |
| Embusen plane | `XZ` (`y=0`) | floor |
| World | right-handed (`X×Y=Z`) | |
| Heading `H` | degrees, `H=0` at yoi | `H` **increases when the character turns to their own LEFT** |
| Facing unit vector | `f(H) = (sin H, 0, −cos H)` | check: `H=90 → (+1,0,0) = +X = char-left` ✓ |
| Three.js root yaw | `root.rotation.y = −H · π/180` | rad. Verified: local `−Z` → `(−sin α,0,−cos α)`, so `α = −H` |
| Turn sign | `ΔH > 0` = turn to char's LEFT = CCW seen from `+Y` | `ΔH < 0` = to char's RIGHT = CW |
| Direction labels | `F = −Z (H 0)`, `L = +X (H 90)`, `B = +Z (H 180)`, `R = −X (H 270)` | `F/B/L/R` are fixed **world** labels frozen at yoi, never re-based |
| Diagonals used | `H 45` = front-left, `H 315` = front-right | both have a `−Z` (forward) component |

### 1.1 Length units

| param | value | unit | tol | source |
|---|---|---|---|---|
| `H` (body height) | 175 | cm | reference figure | project |
| `L` = zenkutsu-dachi foot separation (front-to-back, along facing) = **1 embusen step unit** | 0.520 H = 91.0 | cm | ±0.05 H | "two shoulder-widths" [themartialway kokutsu page]; biacromial = 0.259 H [Drillis & Contini 1966] → 2×0.259 = 0.518 H [DERIVED] |
| `Lk` = kokutsu-dachi foot separation | 1.00 L | — | ±0.10 L | same source states two shoulder-widths for kokutsu → `Lk == L` |
| `w` = hachiji-dachi foot-centre separation | 0.385 L = 35.0 cm | — | ±0.05 L | shoulder-width heels [wikipedia hachiji-dachi]; 0.20 H [DERIVED] |
| `h` = `w/2` | **0.19 L** = 17.3 cm | — | ±0.025 L | derived from `w` |
| Embusen scale | `cm = L_units × 91.0` | | | |

> **All embusen coordinates below scale linearly with `L`.** If the stance spec (doc 01/03) fixes a different `L`, multiply every `(x,z)` by `L_new/L_old`. `h` must be re-derived from the same `L`.

### 1.2 Target heights (fraction of H; cm for H=175)

| level / technique endpoint | height (H) | cm | tol | source |
|---|---|---|---|---|
| jodan zone (neck + head) | 0.84 → 1.00 | 147→175 | — | themartialway attack-levels |
| jodan strike/defence target (philtrum) | 0.90 | 157 | ±0.02 H | [DERIVED] Drillis & Contini head-height 0.130 H → chin 0.870 H; philtrum ≈ 0.895 H |
| chudan zone (neck → belt) | 0.60 → 0.82 | 105→144 | — | themartialway attack-levels |
| chudan target (solar plexus / suigetsu) | **0.72** | 126 | ±0.02 H | [DERIVED] nipple/xiphoid height 0.72 H [Drillis & Contini]; "solar plexus" named by themartialway + karate-notes |
| gedan zone (belt → knee) | 0.28 → 0.60 | 49→105 | — | themartialway attack-levels |
| gedan-barai blocking-fist end height | 0.36 | 63 | ±0.04 H | [DERIVED] front-knee height in zenkutsu ≈ 0.28 H + one fist (0.07 H) |
| age-uke blocking-wrist end height | 0.97 | 170 | ±0.03 H | [DERIVED] forehead 0.94 H + one fist clearance |
| age-uke blocking-elbow height | 0.80 | 140 | ±0.03 H | [DERIVED] shoulder height 0.818 H, elbow just below |
| shuto-uke blocking-hand centre height | 0.75 | 131 | ±0.05 H | [DERIVED] chudan zone, hand near shoulder line |
| tettsui (kentsui) end height | 0.78 | 137 | **±0.06 H — disputed** | Bertel: "shoulder height" → 0.82 H; most sources: chudan → 0.72 H. Midpoint taken; see §12 |

### 1.3 Hikite (pulling-hand) end positions — 3 canonical forms

| form | used by | fist/hand centre height | lateral offset from mid-sagittal (toward hikite side) | A-P offset from hip coronal plane | wrist rotation | tol |
|---|---|---|---|---|---|---|
| **HIP-A** | oi-zuki, gedan-barai, age-uke, tettsui | 0.60 H = 105 cm | 0.10 H = 17.5 cm | 0.00 H (fist on the side of the abdomen); elbow **behind** plane by 0.10 H | supinated, palm **up** | ±0.03 H |
| **TATE-B** | chudan shuto-uke (18–21) | 0.70 H = 122 cm | 0.00 H (on centre line) | +0.14 H = 24.5 cm **forward** of sternum plane | open hand, palm **up**, fingertips forward-up | ±0.03 H |
| **NONE** | — | (no move in either kata uses a third form) | | | | |

Source: hikite mechanics per JKA England sheet ("pull right hand back to hip", move 1); TATE-B per themartialway ("right hand protection") + techniquesdekarate.
Disagreement: karate-notes gives an **open** hand at the hip for moves 7–9 (age-uke); JKA closes the fist. Use HIP-A closed fist. See §12.

### 1.4 Tempo classes (JKA demonstration tempo)

`t_slot` = time from previous move's kime to this move's kime. Decomposition: `t_slot = t_hold + t_prep + t_transit + t_kime`.
`t_hold` = previous kime sustained (still). `t_prep` = head/eyes lead + weight onto pivot foot + hikite wind-up. `t_transit` = translation + yaw + limb travel. `t_kime` = terminal snap.

| class | applies to | t_hold | t_prep | t_transit | t_kime | **t_slot (Heian)** | **t_slot (Taikyoku)** | label |
|---|---|---|---|---|---|---|---|---|
| `M1` | move 1 (from yoi) | 1.37 / 1.17 | 0.35 | 0.40 | 0.08 | 2.20 | 2.00 | normal |
| `N` | straight step + technique | 1.50 / 1.25 | 0.18 | 0.34 | 0.08 | 2.10 | 1.85 | normal |
| `F` | 2nd/3rd of a fast pair | 0.45 / 0.40 | 0.06 | 0.26 | 0.08 | 0.85 | 0.80 | **fast** |
| `T90` | 90° turn | 1.54 / 1.29 | 0.24 | 0.44 | 0.08 | 2.30 | 2.05 | normal |
| `T180` | 180° turn | 1.46 / 1.21 | 0.26 | 0.50 | 0.08 | 2.30 | 2.05 | normal |
| `T270` | 270° turn | 1.76 / 1.46 | 0.30 | 0.66 | 0.08 | 2.80 | 2.50 | slow |
| `T135` | 135° turn | 1.56 / — | 0.26 | 0.50 | 0.08 | 2.40 | — | normal |
| `D45` | 45° diagonal step-through | 1.13 / — | 0.16 | 0.38 | 0.08 | 1.75 | — | normal |

Tolerance on any `t_slot`: **±20 %** (uniform scrub-rate multiplier is acceptable; relative ratios are the load-bearing part).
Totals calibrated to: Heian Shodan **≈40 s** [JKA England sheet, "approx. 40 seconds"; Nakayama ~40 s], Taikyoku Shodan **≈35 s** [shotokankarateonline].

---

## 2. Ceremony: rei / yoi / yame

| phase | stance | body params | duration s | source |
|---|---|---|---|---|
| `REI_IN` (opening bow) | musubi-dachi: heels touching, each foot **22.5°** out of the mid-sagittal plane (included angle 45°, tol ±7.5° per foot) | trunk pitch **30°** forward from vertical (tol ±15°; range in sources 15–45°); cervical angle **0°** rel. to trunk (±5°) so the gaze descends; hands open, thumbs tucked, palms flat on outer thighs, sliding down 0.06 H during the bow; heels stay together | 1.0 down / 1.0 hold / 1.0 up = **3.0** | mma-dojo + wikipedia musubi-dachi (45° toes); the-digi-dojo + shotokankarateonline (30–45° trunk, hold 1–3 s, eyes follow head) |
| `ANNOUNCE` | musubi-dachi, erect | kata name called; no limb motion | 1.5 | Hickey sheet ("Attention Stance → Bow → Ready Stance"); karateyon ("announce in a decisive tone") |
| `YOI` | → hachiji-dachi | **left** foot steps to `+X` by `w` = 0.385 L; right foot fixed; both fists close and travel down+forward to gedan: fist centres at 0.55 H, 0.13 H lateral, 0.10 H forward of the hip coronal plane; elbows 165–170°; feet toes-out **30°** each (tol ±15°) | 1.20 | wikipedia yoi/hachiji-dachi ("arms slightly forward, fists closed, ~half a shoulder-width apart, elbows very slightly bent") |
| `SET` | hachiji-dachi | still, exhale | 1.00 | [DERIVED] |
| … kata … | | | 35.25 (Taikyoku) / 39.75 (Heian) | §4, §6 |
| `FINAL_HOLD` | last stance | kime sustained; JKA England prints "Hold position" at move 21 | 2.00 | JKA England sheet |
| `YAME` / `NAORE` | → hachiji-dachi at the **exact yoi position** | see §4.3 / §6.3 (exact closure proof) | 1.20 | JKA England ("On instruction NAORE, return to YOI position, bring left foot back"); Hickey ("Bring the left foot back into the ready stance — Yame") |
| `SETTLE` | hachiji-dachi | still | 1.00 | [DERIVED] |
| `ATTENTION` | → musubi-dachi | left foot draws in to heels-together | 1.00 | Hickey sheet |
| `REI_OUT` | musubi-dachi | identical to `REI_IN` | 3.00 | Hickey sheet |

**Total clip length:** Taikyoku Shodan `6.70 + 35.25 + 8.20 = 50.15 s`; Heian Shodan `6.70 + 39.75 + 8.20 = 54.65 s`. Tolerance ±20 %.

---

## 3. Embusen — shared by BOTH kata

The JKA England Heian Shodan sheet states explicitly that Heian Shodan follows the **same embusen as Kihon (Taikyoku Shodan)**. The derivation below reproduces that: identical bounding box, identical stem, identical bars.

### 3.1 Footfall-kinematics rules used to generate all coordinates [DERIVED, validated]

| rule | trigger | pivot foot | moving foot | Δ(stance centre `c`) |
|---|---|---|---|---|
| `R0` in place | no turn, no net travel (Heian 4 only) | rear foot | front foot retracts 0.5 L along `−f`, then returns | `0.00` (net); transient `−0.25 L · f` at wind-up peak |
| `R1` step-through | no turn | rear foot lifts | rear → new front, travels 2 L | `+1.0 L · f` |
| `R2` turn 180°, same foot stays front | `ΔH = −180` | **REAR foot** (stays planted, rotates on heel) | old front foot sweeps 2 L to the new front | `−1.0 L · f_old` (= `+1.0 L · f_new`) |
| `R3` turn 90/270°, front foot becomes rear | `ΔH = +90` or `+270` where front leg changes | **FRONT foot** (stays planted, becomes rear) | old rear foot swings to the new front | `0.5 L · (f_old + f_new)` |
| `R4` turn 90°, same foot stays front | `ΔH = +90` with front leg unchanged | **REAR foot** (stays planted, stays rear) | front foot sweeps 90° | `0.5 L · (f_new − f_old)` |
| `R5` diagonal step-through | `ΔH = ±45` | front foot (becomes rear) | rear → new front along `f_new` | `0.5 Lk · (f_old + f_new)` … see note |

Note on `R5`: implemented directly as `front_foot_new = pivot_foot + Lk · f_new`, `c = midpoint`. Same for `R2`/`R3`/`R4` — **always place the moving foot from the pivot foot, then take the midpoint.** That formulation is the single source of truth; the `Δc` column is a convenience/cross-check.

Rule assignment is verified per-move against the JKA England sheet's own verbal cues ("slide right leg backward", "slide left leg forward", "slide right leg back ½ step"), which match `R1–R5` on all 21 Heian moves.

### 3.2 Embusen polyline (front-foot trace), units of L, `y=0`

```
BOTTOM BAR   z = 0.00     x from −1.19 (R/east end)  to +1.81 (L/west end)   span 3.00 L
STEM         x = −0.19    z from  0.00               to −4.00                length 4.00 L
TOP BAR      z = −4.00    x from −2.19 (R end)       to +0.81 (L end)        span 3.00 L
HEIAN ONLY — two diagonal spurs off the bottom bar:
  spur NW    tip (+1.517, −0.707)   (move 19 front foot)
  spur NE    tip (−0.897, −0.707)   (move 21 front foot)
BOUNDING BOX x ∈ [−2.19, +1.81]   z ∈ [−4.00, 0.00]   = 4.00 L × 4.00 L = 364 × 364 cm
```

**Key structural fact (non-obvious, assert it in code):** the "I" is **NOT mirror-symmetric**. The bottom bar is centred at `x = +0.31`, the top bar at `x = −0.69` — offset by exactly `1.00 L`. The figure has **180°-rotational symmetry about `P₀ = (−0.19, −2.00)`**:
`σ(x,z) = (−0.38 − x, −4.00 − z)`

Validation assertions (both must hold exactly):
```
Taikyoku:  σ(c_i) == c_(i+8)  for i = 1..8      and  c_17..c_20 == c_1..c_4
Heian:     σ(c_i) == c_(i+9)  for i ∈ {1,2,3}   ,  σ(c_5..c_9) == c_13..c_17
           (move 4 has no positional counterpart — it is the only zero-displacement move)
Closure:   right foot never leaves (−h, 0) = (−0.19, 0) after move 17 (Heian) / 16 (Taikyoku);
           yame returns left foot to (+h, 0) → c = (0,0) EXACTLY.
```

Yoi feet: `L=(+0.19, 0)`, `R=(−0.19, 0)`, `c=(0,0)`.
Source for topology: JKA England Heian Shodan sheet embusen diagram — label positions extracted from the PDF give 6 discrete `z` rows exactly matching front-foot `z ∈ {0, −0.35/−0.5, −1, −2, −3, −4}` and confirm travel order (bottom bar: 2 → 1 → yoi → 3 → 4 → 5 going `+X`→`−X`; top bar: 11 → 10 → 9 → 12 → 13 going `−X`→`+X`; final bar: 21 → 20 → 17 → 18 → 19). The diagram's **x** slots are schematic (uniform 1-slot spacing, coincident positions pulled apart for legibility) — use the analytic coordinates in §4.2 / §6.2, not the diagram slots.

---

## 4. (A) TAIKYOKU SHODAN — 20 movements

Techniques used: **only** `gedan-barai` (8×) and `chudan oi-zuki` (12×). Stance: **zenkutsu-dachi throughout** (moves 1–20).
Kiai: **movements 8 and 16** — the last chudan oi-zuki at the top of the "I" and the last at the bottom.

### 4.1 Movement table

Col key: `ΔH` = signed yaw change (+ = to char's left / CCW). `H` = resulting heading. `Fwd` = front leg. `Piv` = pivot foot (planted, rotates in place). `Mov` = moving foot. `Tgt` = target height as fraction of H. `Sim` = simultaneity. `Δ` = source disagreements.

| # | ΔH (deg, dir, rule) | Piv / Mov | H | dir | stance | Fwd | technique | arm | level + Tgt(H) | hikite | kiai | tempo / t_slot s | t_cum s | Sim | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | +90 CCW (left), `R3`-from-hachiji | R / L | 90 | L (+X) | zenkutsu | L | gedan-barai (downward sweep block) | L | gedan, 0.36 | HIP-A right | no | normal `M1` 2.00 | 2.00 | S1 | — |
| 2 | 0, `R1` | — / R | 90 | L | zenkutsu | R | chudan oi-zuki (lunge punch) | R | chudan, 0.72 | HIP-A left | no | normal `N` 1.85 | 3.85 | S1 | — |
| 3 | −180 CW (right), `R2` | **L** / R | 270 | R (−X) | zenkutsu | R | gedan-barai | R | gedan, 0.36 | HIP-A left | no | normal `T180` 2.05 | 5.90 | S2 | d1 |
| 4 | 0, `R1` | — / L | 270 | R | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | normal `N` 1.85 | 7.75 | S1 | — |
| 5 | +90 CCW, `R4` | **R** / L | 0 | F (−Z) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | normal `T90` 2.05 | 9.80 | S2 | — |
| 6 | 0, `R1` | — / R | 0 | F | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | no | normal `N` 1.85 | 11.65 | S1 | — |
| 7 | 0, `R1` | — / L | 0 | F | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | **fast** `F` 0.80 | 12.45 | S1 | — |
| 8 | 0, `R1` | — / R | 0 | F | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | **YES** | **fast** `F` 0.80 | 13.25 | S1 | — |
| 9 | **+270 CCW (backward to the left)**, `R3` | **R** / L | 270 | R (−X) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | slow `T270` 2.50 | 15.75 | S2 | d2 |
| 10 | 0, `R1` | — / R | 270 | R | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | no | normal `N` 1.85 | 17.60 | S1 | — |
| 11 | −180 CW, `R2` | **L** / R | 90 | L (+X) | zenkutsu | R | gedan-barai | R | gedan, 0.36 | HIP-A left | no | normal `T180` 2.05 | 19.65 | S2 | d1 |
| 12 | 0, `R1` | — / L | 90 | L | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | normal `N` 1.85 | 21.50 | S1 | — |
| 13 | +90 CCW, `R4` | **R** / L | 180 | B (+Z) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | normal `T90` 2.05 | 23.55 | S2 | — |
| 14 | 0, `R1` | — / R | 180 | B | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | no | normal `N` 1.85 | 25.40 | S1 | — |
| 15 | 0, `R1` | — / L | 180 | B | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | **fast** `F` 0.80 | 26.20 | S1 | — |
| 16 | 0, `R1` | — / R | 180 | B | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | **YES** | **fast** `F` 0.80 | 27.00 | S1 | — |
| 17 | **+270 CCW**, `R3` | **R** / L | 90 | L (+X) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | slow `T270` 2.50 | 29.50 | S2 | d2 |
| 18 | 0, `R1` | — / R | 90 | L | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | no | normal `N` 1.85 | 31.35 | S1 | — |
| 19 | −180 CW, `R2` | **L** / R | 270 | R (−X) | zenkutsu | R | gedan-barai | R | gedan, 0.36 | HIP-A left | no | normal `T180` 2.05 | 33.40 | S2 | d1 |
| 20 | 0, `R1` | — / L | 270 | R | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | normal `N` 1.85 | 35.25 | S1 | — |
| yame | +90 CCW | **R** / L | 0 | F | hachiji | — | — | — | — | fists to yoi gedan | no | 1.20 | 36.45 | — | — |

Sources for the whole sequence: karateyon (full 20-count with degrees + pivot legs), shotokankarateonline (Taikyoku step-by-step; "moving your back leg (left leg) pivot 270° on your right leg"), Hickey Karate Center sheet (PDF text: "Turn 270° **backward to the left**", "Turn 180° **to the right**", "Turn 90° to the left", "Bring the left foot back into the ready stance — Yame"), northstowekarate ("20 moves with a kiai on move 8 and 16; moves 9 and 17 … 270-degree turn"), tenchikenpo (variant, offset numbering).

### 4.2 Exact embusen coordinates (units of L; `h = 0.19`)

`FF` = front-foot centre, `RF` = rear-foot centre, `c` = stance centre (midpoint) = **the canonical embusen point**.

| # | H | FF (x,z) | RF (x,z) | c (x,z) | c cm (H=175) |
|---|---|---|---|---|---|
| yoi | 0 | L(+0.19,0) | R(−0.19,0) | (0.00, 0.00) | (0.0, 0.0) |
| 1 | 90 | L(+0.81, 0.00) | R(−0.19, 0.00) | (+0.31, 0.00) | (+28.2, 0.0) |
| 2 | 90 | R(+1.81, 0.00) | L(+0.81, 0.00) | (+1.31, 0.00) | (+119.2, 0.0) |
| 3 | 270 | R(−0.19, 0.00) | L(+0.81, 0.00) | (+0.31, 0.00) | (+28.2, 0.0) |
| 4 | 270 | L(−1.19, 0.00) | R(−0.19, 0.00) | (−0.69, 0.00) | (−62.8, 0.0) |
| 5 | 0 | L(−0.19, −1.00) | R(−0.19, 0.00) | (−0.19, −0.50) | (−17.3, −45.5) |
| 6 | 0 | R(−0.19, −2.00) | L(−0.19, −1.00) | (−0.19, −1.50) | (−17.3, −136.5) |
| 7 | 0 | L(−0.19, −3.00) | R(−0.19, −2.00) | (−0.19, −2.50) | (−17.3, −227.5) |
| 8 | 0 | R(−0.19, −4.00) | L(−0.19, −3.00) | (−0.19, −3.50) | (−17.3, −318.5) |
| 9 | 270 | L(−1.19, −4.00) | R(−0.19, −4.00) | (−0.69, −4.00) | (−62.8, −364.0) |
| 10 | 270 | R(−2.19, −4.00) | L(−1.19, −4.00) | (−1.69, −4.00) | (−153.8, −364.0) |
| 11 | 90 | R(−0.19, −4.00) | L(−1.19, −4.00) | (−0.69, −4.00) | (−62.8, −364.0) |
| 12 | 90 | L(+0.81, −4.00) | R(−0.19, −4.00) | (+0.31, −4.00) | (+28.2, −364.0) |
| 13 | 180 | L(−0.19, −3.00) | R(−0.19, −4.00) | (−0.19, −3.50) | (−17.3, −318.5) |
| 14 | 180 | R(−0.19, −2.00) | L(−0.19, −3.00) | (−0.19, −2.50) | (−17.3, −227.5) |
| 15 | 180 | L(−0.19, −1.00) | R(−0.19, −2.00) | (−0.19, −1.50) | (−17.3, −136.5) |
| 16 | 180 | R(−0.19, 0.00) | L(−0.19, −1.00) | (−0.19, −0.50) | (−17.3, −45.5) |
| 17 | 90 | L(+0.81, 0.00) | R(−0.19, 0.00) | (+0.31, 0.00) | (+28.2, 0.0) |
| 18 | 90 | R(+1.81, 0.00) | L(+0.81, 0.00) | (+1.31, 0.00) | (+119.2, 0.0) |
| 19 | 270 | R(−0.19, 0.00) | L(+0.81, 0.00) | (+0.31, 0.00) | (+28.2, 0.0) |
| 20 | 270 | L(−1.19, 0.00) | R(−0.19, 0.00) | (−0.69, 0.00) | (−62.8, 0.0) |
| yame | 0 | L(+0.19, 0.00) | R(−0.19, 0.00) | (0.00, 0.00) | (0.0, 0.0) |

Lateral stance offset: in zenkutsu-dachi the two feet are treated as **collinear along the facing axis** for embusen purposes (lateral offset folded into the stance spec; if doc 01/03 specifies a hip-width lateral offset `d`, apply it perpendicular to `f(H)` symmetrically about `c`, which leaves every `c` unchanged).

### 4.3 Yame closure proof (Taikyoku)

After move 20: `H=270`, `L`-foot at `(−1.19,0)`, `R`-foot at `(−0.19,0)` = its **yoi position, unchanged since move 19**.
Yame = `ΔH = +90` (CCW) pivoting on **R**, drawing the **L** foot back to `(+0.19,0)` (travel 1.38 L). Result: hachiji-dachi, `c=(0,0)`, `H=0`. **Residual = 0.00 cm.** Matches the ≤6-inch closure rule quoted by staffordshotokankarate.

---

## 5. (A) Fast pairs, kiai and rhythm — Taikyoku Shodan

| item | value | source |
|---|---|---|
| Kiai | movements **8** and **16** | northstowekarate, shotokankarateonline, karateyon, shorinjiryublog |
| Fast pairs (no pause between them) | **(7, 8)** and **(15, 16)** — the 2nd and 3rd punch of each triple follow the 1st as a quick "one-two" | dokarate / shotokanfitness rhythm rule for the analogous Heian triples, applied to the identical Taikyoku triples [DERIVED] |
| Slowest moves | 9 and 17 (the 270° turns) | northstowekarate calls them the complex moves |
| All other moves | discrete kime + pause | — |

---

## 6. (B) HEIAN SHODAN — 21 movements

Techniques (6 + 7 + 1 + 3 + 4 = 21 ✓): `gedan-barai` **×6** (1, 3, 6, 10, 12, 14) · `chudan oi-zuki` **×7** (2, 5, 11, 13, 15, 16, 17) · `kentsui/tettsui tate-mawashi-uchi` **×1** (4) · `jodan age-uke` **×3** (7, 8, 9) · `chudan shuto-uke` **×4** (18–21).
Stances: zenkutsu-dachi 1–17, kokutsu-dachi 18–21.
Kiai: **movements 9 and 17**.

### 6.1 Movement table

| # | ΔH (deg, dir, rule) | Piv / Mov | H | dir | stance | Fwd (weighted) | technique (JP / EN) | arm | level + Tgt(H) | hikite | kiai | tempo / t_slot s | t_cum s | Sim | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | +90 CCW (left), `R3`-from-hachiji | R / L | 90 | L (+X) | zenkutsu | L (front) | gedan-barai / downward block | L | gedan, 0.36 | HIP-A right | no | normal `M1` 2.20 | 2.20 | S1 | — |
| 2 | 0, `R1` | — / R | 90 | L | zenkutsu | R | chudan oi-zuki / lunge punch | R | chudan, 0.72 | HIP-A left | no | normal `N` 2.10 | 4.30 | S1 | — |
| 3 | −180 CW (right), `R2` | **L** / R | 270 | R (−X) | zenkutsu | R | gedan-barai / downward block | R | gedan, 0.36 | HIP-A left | no | normal `T180` 2.30 | 6.60 | S2 | — |
| 4 | 0 (in place), `R0` | — / R (retract-return) | 270 | R | zenkutsu (net) | R | migi kentsui tate-mawashi-uchi / vertical circular hammer-fist | R | chudan-high, **0.78** | HIP-A left | no | normal `N` 2.10 | 8.70 | **S3** | d3, d4 |
| 5 | 0, `R1` | — / L | 270 | R | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | **fast** `F` 0.85 | 9.55 | S1 | d5 |
| 6 | +90 CCW ("¼ turn to front"), `R4` | **R** / L | 0 | F (−Z) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | normal `T90` 2.30 | 11.85 | S2 | — |
| 7 | 0, `R1` | — / R | 0 | F | zenkutsu | R | jodan age-uke / rising block | R | jodan, defends 0.90; wrist ends 0.97 | HIP-A left | no | normal `N` 2.10 | 13.95 | S1 | d6 |
| 8 | 0, `R1` | — / L | 0 | F | zenkutsu | L | jodan age-uke | L | jodan, 0.90 / 0.97 | HIP-A right | no | **fast** `F` 0.85 | 14.80 | S1 | d6 |
| 9 | 0, `R1` | — / R | 0 | F | zenkutsu | R | jodan age-uke | R | jodan, 0.90 / 0.97 | HIP-A left | **YES (1st)** | **fast** `F` 0.85 | 15.65 | S1 | d6 |
| 10 | **+270 CCW ("¾ turn to left")**, `R3` | **R** / L | 270 | R (−X) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | slow `T270` 2.80 | 18.45 | S2 | d7 |
| 11 | 0, `R1` | — / R | 270 | R | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | no | normal `N` 2.10 | 20.55 | S1 | — |
| 12 | −180 CW ("½ turn to right"), `R2` | **L** / R | 90 | L (+X) | zenkutsu | R | gedan-barai | R | gedan, 0.36 | HIP-A left | no | normal `T180` 2.30 | 22.85 | S2 | — |
| 13 | 0, `R1` | — / L | 90 | L | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | normal `N` 2.10 | 24.95 | S1 | — |
| 14 | +90 CCW ("¼ turn to back"), `R4` | **R** / L | 180 | B (+Z) | zenkutsu | L | gedan-barai | L | gedan, 0.36 | HIP-A right | no | normal `T90` 2.30 | 27.25 | S2 | — |
| 15 | 0, `R1` | — / R | 180 | B | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | no | normal `N` 2.10 | 29.35 | S1 | — |
| 16 | 0, `R1` | — / L | 180 | B | zenkutsu | L | chudan oi-zuki | L | chudan, 0.72 | HIP-A right | no | **fast** `F` 0.85 | 30.20 | S1 | — |
| 17 | 0, `R1` | — / R | 180 | B | zenkutsu | R | chudan oi-zuki | R | chudan, 0.72 | HIP-A left | **YES (2nd)** | **fast** `F` 0.85 | 31.05 | S1 | — |
| 18 | **+270 CCW ("¾ turn to left")**, `R3` | **R** / L | 90 | L (+X) | **kokutsu** | L front (**R weighted**) | chudan shuto-uke / knife-hand block | L | chudan, 0.75 | TATE-B (right open, centre) | no | slow `T270` 2.80 | 33.85 | S2 | d8 |
| 19 | −45 CW (45° to the right, diagonal step-through), `R5` | **L** / R | 45 | front-left diagonal | kokutsu | R front (**L weighted**) | chudan shuto-uke | R | chudan, 0.75 | TATE-B (left open) | no | normal `D45` 1.75 | 35.60 | S2 | — |
| 20 | **−135 CW ("⅜ turn to right")**, `R2`-like (pivot on rear) | **L** / R | 270 | R (−X) | kokutsu | R front (**L weighted**) | chudan shuto-uke | R | chudan, 0.75 | TATE-B (left open) | no | normal `T135` 2.40 | 38.00 | S2 | d9 |
| 21 | +45 CCW (45° to the left, diagonal step-through), `R5` | **R** / L | 315 | front-right diagonal | kokutsu | L front (**R weighted**) | chudan shuto-uke | L | chudan, 0.75 | TATE-B (right open) | no | normal `D45` 1.75 | 39.75 | S2 | — |
| naore | +45 CCW | **R** / L | 0 | F | hachiji | — | — | — | — | fists to yoi gedan | no | 1.20 | 40.95 | — | — |

Sources for the whole sequence, all cross-checked: **JKA England / Copley sheet** (per-move verbal cues + degrees as fractions of a turn: "½ turn to right", "¼ turn to front", "¾ turn to left", "¼ turn to back", "⅜ turn to right", 40 s, "same embusen as Kihon"); **techniquesdekarate (JKA France)** (21-count Japanese names, kiai 9 & 17, ~40 s); **themartialway** (pivot feet, hikite, 45° steps); **shotokankarateonline** (move 3 "180° clockwise pivoting on your left foot", move 6 "90° CCW pivoting on your right foot", moves 10 & 18 "270° CCW pivoting on your right foot", yame "bring left foot back … Shizentai (Yoi)"); **shotokanfitness** (move 4 "retract front foot halfway", elbow 90°; move 10 "270° counter-clockwise"; move 20 "135° right"); **André Bertel** (270° at 18, 135° at 20, kiai 9 & 17, tettsui trajectory); **karate-notes** (21 moves, ~42 s).

### 6.2 Exact embusen coordinates (units of L; `h = 0.19`, `Lk = 1.00 L`)

| # | H | FF (x,z) | RF (x,z) | c (x,z) | c cm (H=175) |
|---|---|---|---|---|---|
| yoi | 0 | L(+0.19, 0.00) | R(−0.19, 0.00) | (0.000, 0.000) | (0.0, 0.0) |
| 1 | 90 | L(+0.81, 0.00) | R(−0.19, 0.00) | (+0.310, 0.000) | (+28.2, 0.0) |
| 2 | 90 | R(+1.81, 0.00) | L(+0.81, 0.00) | (+1.310, 0.000) | (+119.2, 0.0) |
| 3 | 270 | R(−0.19, 0.00) | L(+0.81, 0.00) | (+0.310, 0.000) | (+28.2, 0.0) |
| 4 | 270 | R(−0.19, 0.00) | L(+0.81, 0.00) | (+0.310, 0.000) | (+28.2, 0.0) |
| 5 | 270 | L(−1.19, 0.00) | R(−0.19, 0.00) | (−0.690, 0.000) | (−62.8, 0.0) |
| 6 | 0 | L(−0.19, −1.00) | R(−0.19, 0.00) | (−0.190, −0.500) | (−17.3, −45.5) |
| 7 | 0 | R(−0.19, −2.00) | L(−0.19, −1.00) | (−0.190, −1.500) | (−17.3, −136.5) |
| 8 | 0 | L(−0.19, −3.00) | R(−0.19, −2.00) | (−0.190, −2.500) | (−17.3, −227.5) |
| 9 | 0 | R(−0.19, −4.00) | L(−0.19, −3.00) | (−0.190, −3.500) | (−17.3, −318.5) |
| 10 | 270 | L(−1.19, −4.00) | R(−0.19, −4.00) | (−0.690, −4.000) | (−62.8, −364.0) |
| 11 | 270 | R(−2.19, −4.00) | L(−1.19, −4.00) | (−1.690, −4.000) | (−153.8, −364.0) |
| 12 | 90 | R(−0.19, −4.00) | L(−1.19, −4.00) | (−0.690, −4.000) | (−62.8, −364.0) |
| 13 | 90 | L(+0.81, −4.00) | R(−0.19, −4.00) | (+0.310, −4.000) | (+28.2, −364.0) |
| 14 | 180 | L(−0.19, −3.00) | R(−0.19, −4.00) | (−0.190, −3.500) | (−17.3, −318.5) |
| 15 | 180 | R(−0.19, −2.00) | L(−0.19, −3.00) | (−0.190, −2.500) | (−17.3, −227.5) |
| 16 | 180 | L(−0.19, −1.00) | R(−0.19, −2.00) | (−0.190, −1.500) | (−17.3, −136.5) |
| 17 | 180 | R(−0.19, 0.00) | L(−0.19, −1.00) | (−0.190, −0.500) | (−17.3, −45.5) |
| 18 | 90 | L(+0.81, 0.00) | R(−0.19, 0.00) | (+0.310, 0.000) | (+28.2, 0.0) |
| 19 | 45 | R(+1.517, −0.707) | L(+0.81, 0.00) | (+1.164, −0.354) | (+105.9, −32.2) |
| 20 | 270 | R(−0.19, 0.00) | L(+0.81, 0.00) | (+0.310, 0.000) | (+28.2, 0.0) |
| 21 | 315 | L(−0.897, −0.707) | R(−0.19, 0.00) | (−0.544, −0.354) | (−49.5, −32.2) |
| naore | 0 | L(+0.19, 0.00) | R(−0.19, 0.00) | (0.000, 0.000) | (0.0, 0.0) |

Move 4 detail (the only intra-move foot excursion): right (front) foot slides **back 0.50 L** along `−f` to `(+0.31, 0)` at the arm's wind-up peak (`t_prep` end), then returns **forward 0.50 L** to `(−0.19, 0)` arriving at kime. Net displacement `0.00 L`. Torso rises ~0.03 H during the retraction and re-settles at kime.

### 6.3 Naore/yame closure proof (Heian)

After move 21: `H=315`, `R`-foot at `(−0.19, 0)` — its yoi position, **unchanged since move 20** (and identical to the position it held at moves 3, 4, 17). Naore = `ΔH = +45` (CCW, to the char's left, 315→360≡0) pivoting on **R**, drawing the **L** foot from `(−0.897,−0.707)` to `(+0.19, 0)` (travel 1.30 L). Result: hachiji-dachi at `c=(0,0)`, `H=0`. **Residual = 0.00 cm.**

---

## 7. (B) Fast pairs, kiai and rhythm — Heian Shodan

| item | value | source |
|---|---|---|
| Kiai | movements **9** (3rd age-uke, right) and **17** (3rd oi-zuki, right) | JKA England sheet (KIAI printed at 9 and 17), techniquesdekarate, Bertel, shotokankarateonline, shotokanfitness |
| Fast pair A | **(8, 9)** — 2nd and 3rd age-uke performed as a quick "one-two" after 7 | dokarate, shotokanfitness |
| Fast pair B | **(16, 17)** — 2nd and 3rd oi-zuki as a quick "one-two" after 15 | dokarate, shotokanfitness |
| Fast pair C | **(4, 5)** — the hammer-fist and the punch immediately after it share the same quick cadence | dokarate |
| Documented alternative rhythm | the triples may be phrased `1--2--3` (even) **or** `1---2-3` (fast pair). This spec implements `1---2-3`. Expose as a switch. | shotokanfitness, dokarate |
| Slowest moves | 10 and 18 (270° turns), then 20 (135°) | Bertel, northstowekarate |
| Kiai acoustics | short, sharp, from the lower abdomen; onset coincident with `t_kime`, length 0.25–0.40 s | Bertel |

---

## 8. Simultaneity rules (`Sim` column)

| code | rule | numbers | tol |
|---|---|---|---|
| `S1` | Straight step + technique. **Front-foot ground contact precedes arm kime by 0.04 s.** Hips reach final rotation at the same frame as arm kime. Rear-foot heel presses down (grounds) 0.02 s before contact of the front foot. | `t_footdown = t_kime − 0.04 s` | ±0.04 s (0.00 s — exactly simultaneous — is an accepted variant) |
| `S2` | Turning move. Head/eyes reach the new heading **before** the hips begin to rotate: `t_head = t_prep_start`, `t_hip_start = t_prep_start + 0.10 s`. Foot contact and kime as `S1`. Pivot foot must show zero translation (≤0.02 L) — only in-place yaw (heel as the axis; JKA teaching keeps the pivot heel down and flat). | `t_head_lead = 0.10 s`; pivot-foot drift ≤ 0.02 L | ±0.03 s / ±0.01 L |
| `S3` | Move 4 only. Arm travels a large vertical circle (from the gedan-barai end position, up past the **opposite** ear, over the head, down) while the front foot retracts; the foot's return forward and the hammer-fist's arrival are simultaneous. Elbow 90° at impact. | arm path length ≈ 1.9 H; peak hand height ≈ 1.10 H | ±0.05 H |

Universal: the technique never "arrives" before the stance is complete. Trailing-limb overshoot is 0; hikite arm reaches HIP-A/TATE-B at the same frame as the working arm's kime (±0.02 s).

---

## 9. Per-move source-agreement matrix (disagreement codes used in §4.1 / §6.1)

| code | disagreement | sources FOR the spec value | sources AGAINST | resolution |
|---|---|---|---|---|
| d1 | 180° turn pivot foot | shotokankarateonline (Heian 3: "pivoting on your left foot"), themartialway ("pivot 180° on left leg"), JKA England ("slide right leg backward"), shotokankarateonline Taikyoku ("pick up the front foot … turn 180°") | karateyon: Taikyoku 3 "pivot on front foot" | Pivot = **REAR** foot. karateyon rejected: pivoting on the front foot advances `c` by `+1 L·f_old` and breaks exact yame closure. |
| d2 | Taikyoku 9/17 magnitude & sense | Hickey sheet: "270° **backward to the left**"; karateyon "270° (pivot on right leg)"; shotokankarateonline "270° on your right leg" | some clubs teach it as a short 90° turn to the right (same end pose) | Net heading is identical either way (`H+270 ≡ H−90`). Spec: **body yaw traverses +270 CCW** (long way) because 3 sources say 270 and 2 name the direction as "to the left"/CCW. |
| d3 | Heian 4 stance | JKA England ("Slide right leg back ½ step / Push forward / **Front stance**"), Bertel ("migi **zenkutsu-dachi**, half-step back, return as strike completes"), shotokanfitness ("retract front foot halfway"), karate-notes ("Right Zenkutsu Dachi") | themartialway + a Nakayama-derived summary: **renoji-dachi**; shotokankarateclass: **cat stance (neko-ashi)** | Spec: zenkutsu with **net 0** displacement. A retained ½-step (renoji) shifts every downstream coordinate by 0.50 L and breaks the 6-inch closure rule unless compensated. |
| d4 | Heian 4 end height | midpoint 0.78 H | Bertel "shoulder height" → 0.82 H; most "chudan" → 0.72 H | Use 0.78 H ±0.06. |
| d5 | Heian 4→5 cadence | dokarate (quick one-two) | JKA England prints no cadence | Fast; exposed as a switch. |
| d6 | Heian 7–9 non-blocking hand | JKA England ("pull right hand back to hip" pattern), techniquesdekarate | karate-notes: "left hand open protection" | Closed fist, HIP-A. |
| d7 | Heian 10 turn | JKA England "¾ turn to left"; shotokankarateonline "270° CCW pivoting on your right foot"; shotokanfitness "270° counter-clockwise" | themartialway: "90° left" | 270° CCW → `H=270`. themartialway's 90° left would give `H=90`, which forces move 14 to be a **right** turn and destroys the shared "I" embusen. Rejected. |
| d8 | Heian 18 turn/direction | JKA England "¾ turn to left" + its diagram places 18/19 on the `+X` side; shotokankarateonline "270° CCW pivoting on right foot"; Bertel "270-degree turn at movement 18" | themartialway: "90° left" (→ `H=270`, `−X` side) | 270° CCW → `H=90` (`+X`). Also required for mirror symmetry with move 20's 135° right turn and for the 45° naore. |
| d9 | Heian 19 vs 20 | Bertel "135-degree turn at movement 20"; shotokanfitness "135° right"; JKA England "⅜ turn to right" (⅜ × 360 = 135) | themartialway lists **both** 19 and 20 as "45° right" (clearly a transcription error) | 19 = −45, 20 = −135. |
| d10 | Total runtime (Heian) | 40 s: JKA England sheet, Nakayama | 42 s: karate-notes; measured senior-instructor performances 23.16 / 23.96 / 31.43 / 33.72 s (shotokankarate.ca) | Demonstration tempo = 40 s (this spec). Provide a global rate multiplier 0.58×–1.05× to reach the observed competition range. |
| d11 | Move numbering | 21 counts (JKA England, techniquesdekarate, themartialway, karate-notes, shotokanfitness) | shotokankarateclass uses 24 slots incl. yoi/rei (its kiai land at 11 & 19 = 9 & 17 here); tenchikenpo variant counts yoi as move 1 | Use 21. Ship an offset map for interop. |
| d12 | zenkutsu weight split | see §10 | | flagged |

---

## 10. Stance parameters actually needed by this doc (defer to doc 01/03 if it conflicts)

| stance | used at | length | weight split | foot angles | hips | source |
|---|---|---|---|---|---|---|
| hachiji-dachi | yoi, yame | width `w` = 0.385 L | 50 / 50 | toes out 30° each (±15°) | square (0°) | wikipedia hachiji-dachi |
| musubi-dachi | rei | heels touching | 50 / 50 | 22.5° each out (included 45°, ±7.5°) | square | wikipedia musubi-dachi, mma-dojo |
| zenkutsu-dachi | Taikyoku 1–20, Heian 1–17 | `L` = 0.520 H | **60 front / 40 rear** (JKA classical) — **disputed: 70/30** per themartialway + shorinjiryublog | front foot 0°, rear foot 20–30° out | square (shomen) for oi-zuki; 45° hanmi permitted for gedan-barai | themartialway, shorinjiryublog |
| kokutsu-dachi | Heian 18–21 | `Lk` = 1.00 L (two shoulder-widths) | **30 front / 70 rear** (themartialway also states ~66 % rear) | front foot 0°, rear foot 90° out | 45° hanmi | themartialway kokutsu page |
| renoji-dachi | (only in the rejected move-4 variant) | ~0.30 L | ~40 front / 60 rear | front 0°, rear 90° | 45° hanmi | wikipedia karate-stances |

---

## 11. Interop / codegen contract

```
Move = {
  n:        int,                 // 1..20 / 1..21
  dH:       number,              // signed degrees, + = char-left/CCW
  H:        number,              // resulting heading, 0..360
  rule:     'R0'|'R1'|'R2'|'R3'|'R4'|'R5',
  pivot:    'L'|'R'|null,        // planted foot, zero translation
  mover:    'L'|'R',
  stance:   'zenkutsu'|'kokutsu'|'hachiji',
  front:    'L'|'R',
  weighted: 'L'|'R',             // == front for zenkutsu, == rear for kokutsu
  tech:     string,              // romaji
  arm:      'L'|'R',
  level:    'jodan'|'chudan'|'gedan',
  targetH:  number,              // fraction of body height
  hikite:   'HIP-A'|'TATE-B',
  kiai:     boolean,
  tempo:    'slow'|'normal'|'fast',
  tSlot:    number,              // seconds
  tCum:     number,              // seconds at kime
  sim:      'S1'|'S2'|'S3',
  ff:[x,z], rf:[x,z], c:[x,z]    // units of L
}
```
Generator invariants to assert at build time: (1) `H` chain from `dH` matches the table; (2) `ff` recomputed from `pivot + Lk·f(H)` matches; (3) `σ`-symmetry assertions of §3.2; (4) closure residual `< 0.01 L`; (5) `Σ tSlot` within 20 % of 35.25 s / 39.75 s; (6) exactly 2 kiai per kata at the listed indices; (7) every `c` inside the bounding box.

---

## 12. Uncertainties

1. **Handedness of the mandated frame.** The brief mandates `+X = character's left` with `forward = −Z`, `up = +Y` in a right-handed world. Geometrically, `forward × up = (0,0,−1)×(0,1,0) = (+1,0,0)`, i.e. `+X` is the character's **anatomical right**. The mandated labelling is therefore mirrored relative to the geometric derivation (equivalent to a `scale.x = −1` character, or to reading `+X` as stage-left of an audience at `+Z`). **This document is internally consistent with the mandate.** If the implementation instead adopts `+X = character's right`, negate every `x` coordinate and every `H` (and use `rotation.y = +H`); nothing else changes. Left/right limb assignments in the tables are anatomical and must NOT be swapped either way.
2. **`L = 0.520 H` is a synthesis, not a measured JKA figure.** It comes from "two shoulder-widths" plus Drillis & Contini biacromial 0.259 H. Real JKA zenkutsu is often taught longer (up to 0.60 H). Every embusen number scales with `L`; the 4 L × 4 L bounding box could legitimately be 3.4–4.6 m per side.
3. **`h = 0.19 L` sets the stem offset.** The stem of the "I" sits at `x = −h`, not at `x = 0`, purely because the right foot never moves at yoi/move 1. A club that steps the left foot out symmetrically at yoi (both feet moving) would put the stem at `x = 0`. No source states which is canonical.
4. **The 1.00 L bar offset (non-mirror "I").** This is a *derived consequence* of `R2` retreating one stance length; no source draws it explicitly, and the JKA England diagram is schematic on the `x` axis so it cannot confirm the metric offset. A critic could argue the bars should be flush; that would require the 180° turns to be positionally neutral, which contradicts "slide right leg backward".
5. **270° turns: path vs. net.** Every source that gives a number says 270°/¾, and two say "to the left"/"counter-clockwise", so the spec spins the long way. But a 270° single-foot spin is unusual in a beginner kata, and the end pose is identical to a 90° right turn. If reference video shows a short right turn, flip `dH` for Taikyoku 9/17 and Heian 10/18 from `+270` to `−90` — coordinates are unaffected.
6. **Heian move 4** is the single largest open item: stance (zenkutsu / renoji / neko-ashi), whether the ½-step back is retained, and end height (0.72–0.82 H). The chosen net-zero zenkutsu is the only variant that closes the embusen exactly.
7. **Kokutsu `Lk = L`** is asserted from one source's "two shoulder-widths". Many schools make kokutsu shorter than zenkutsu; if `Lk < L`, moves 18–21 and the naore travel shrink and the closure residual becomes non-zero (`(L−Lk)` in `x` at move 20).
8. **Per-move durations are a synthesis.** Only the totals (35 s / 40 s) and the *ordinal* rhythm facts (fast pairs, kiai) are sourced. The `t_hold / t_prep / t_transit / t_kime` split is entirely `[DERIVED]` and is the most likely thing a kata expert would re-tune.
9. **Rhythm variant.** Sources explicitly permit `1--2--3` (even) instead of `1---2-3` (fast pair) for both triples. Shipping only one is a defensible choice, not a fact.
10. **Rei angle 30°** has a stated source range of 15–45°; the "eyes follow the head" instruction conflicts with dojos that teach keeping the eyes on the front. Both are documented practices.
11. **Target heights** are anthropometric conversions of verbal targets ("solar plexus", "philtrum", "one fist above the knee"). Drillis & Contini proportions are known to be unvalidated against any measured population; treat ±0.03 H as optimistic.
12. **`gedan-barai` fist end height 0.36 H** assumes a front-knee height of 0.28 H in zenkutsu; if the stance spec drops the hips further, this must drop with it.
13. **No frame-accurate primary source.** No video was frame-analysed and no JKA book (Nakayama, *Best Karate* 5) was read directly; JKA-derived facts come from JKA-affiliate club sheets (JKA England / JKA France) and a JKA-trained instructor's blog, not from JKA HQ publications. The JKA HQ instructor technical manual was fetched but its text layer was not extractable.
14. **Taikyoku Shodan has no JKA-HQ canonical status** (it is Funakoshi's teaching kata, taught as "Kihon kata" by many JKA clubs). Its 20-count is stable across sources, but "official" tempo/kiai statements are club-level, not federation-level.

---

## Sources

- JKA England (jkakarate.co.uk) Heian Shodan kata sheet, ©J. Copley 2014 — `https://www.jkakarate.co.uk/shared/images/content/bus_57720/pdf/2-Heian-Shodan.pdf` (per-move cues, fractional turns, KIAI at 9 & 17, 40 s, "same Embusen as Kihon", embusen diagram label coordinates)
- Hickey Karate Center, *The First Kata: Taikyoku Shodan* — `http://www.hickeykaratecenter.com/uploads/5/4/2/5/54255695/kata_taikyoku_shodan_small.pdf` ("Turn 270° backward to the left", "Turn 180° to the right", yame)
- KarateYon, Taikyoku Shodan — `http://karateyon.blogspot.com/2010/11/taikyoku-shodan.html` (full 20-count with degrees and pivot legs)
- shotokankarateonline, Heian Shodan tutorial — `https://www.shotokankarateonline.com/blog/heian-shodan-kata-tutorial/` (CW/CCW + pivot foot per turn, yame)
- shotokankarateonline, Taikyoku Shodan step-by-step — `https://www.shotokankarateonline.com/3rd-kyu-brown-belt/taikyoku-shodan-kata-step-by-step/`
- The Martial Way, Heian Shodan — `https://www.themartialway.com.au/heian-shodan/` (21-count, pivot feet, hikite, 45° steps)
- The Martial Way, Attack Levels in Shotokan — `https://www.themartialway.com.au/attack-levels-in-shotokan/` (jodan/chudan/gedan zones)
- The Martial Way, Kokutsu-dachi — `https://www.themartialway.com.au/kokutsu-dachi-back-stance/` (two shoulder-widths, 66–70 % rear, 45° hips)
- techniquesdekarate (JKA France / B. Jaillet), Heian Shodan — `https://www.techniquesdekarate.com/les-katas/heian-shodan` (21 Japanese names, kiai 9 & 17, ~40 s)
- André Bertel's Karate-Do, notes on Heian Shodan — `http://andrebertel.blogspot.com/2017/01/first-article-for-2017-few-notes-on.html` (270° at 18, 135° at 20, kiai 9 & 17, tettsui trajectory, zenkutsu at move 4)
- Shotokan Fitness, Heian Shodan — `https://shotokanfitness.blogspot.com/2017/08/heian-shodan-kata.html` (270° CCW at 10, 135° right at 20, retract front foot halfway at 4, 1--2--3 vs 1---2-3)
- My Karate Blog / dokarate, Heian Shodan — `https://dokarate.wordpress.com/2010/08/26/heian-shodan/` (fast pairs 8-9, 16-17, 4-5; level head)
- Karate Notes, Heian Shodan — `https://karate-notes.com/en/katas/heian-en/heian-shodan-en/` (21 moves, ~42 s, technique/stance list)
- Northstowe Karate, basic Shotokan kata — `https://www.northstowekarate.com/kata/heian/` (Kihon 20 moves kiai 8 & 16; Heian 21 moves kiai 9 & 17)
- Stafford Shotokan Karate, Embusen — `https://www.staffordshotokankarate.co.uk/embusen` ("I" pattern, ≤6-inch start/finish tolerance)
- Victoria Shotokan (shotokankarate.ca), kata timing article (via search snapshot; TLS cert mismatch blocked direct fetch) — measured Heian Shodan durations 23.16 / 23.96 / 31.43 / 33.72 s, Nakayama ~40 s
- Shorinjiryu Genbukan blog, Taikyoku Shodan — `https://shorinjiryublog.wordpress.com/2020/12/15/taikyoku-shodan-kata/` (20 moves, 70/30 zenkutsu, kiai at top and bottom of the "I")
- Ten Chi Kenpo, Taikyoku Shodan (non-Shotokan variant, used only as a turn-sequence cross-check) — `https://tenchikenpo.org/taiksho.html`
- Shotokan Karate Class, Heian Shodan (24-slot numbering, kiai at 11 & 19) — `https://shotokankarateclass.wixsite.com/shotokankarateclass/heian-shodan`
- Wikipedia: Hachiji dachi / Yoi, Musubi dachi, Karate stances, Embusen — `https://en.wikipedia.org/wiki/Hachiji_dachi`, `https://en.wikipedia.org/wiki/Musubi_dachi`, `https://en.wikipedia.org/wiki/Karate_stances`, `https://en.wikipedia.org/wiki/Embusen`
- shotokankarateonline, Rei — `https://www.shotokankarateonline.com/blog/rei-bow-understanding-the-karate-bow/` (musubi-dachi, hands on thighs, hold 1–3 s, eyes follow head)
- MMA-Dojo, Musubi dachi — `https://mma-dojo.co.uk/musubi-dachi.php`; The Digi Dojo, bowing — `https://the-digi-dojo.com/reishiki/when-and-how-to-bow-in-karate/` (30–45° trunk)
- Drillis & Contini (1966) body-segment proportions of stature, via ResearchGate figure reproductions — `https://www.researchgate.net/figure/Body-segment-lengths-expressed-as-proportion-of-body-height-H-by-Drillis-and-Contini_fig12_325960988`
- JKA HQ instructor technical manual (fetched, text layer not extractable) — `https://www.jka.or.jp/wp/wp-content/uploads/2017/04/tech_manual_instructor.pdf`
