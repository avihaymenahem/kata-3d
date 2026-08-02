# DISPUTED — the fourteen live disputes

**Owner: B1 (`agent/numbers`).** Human-owned prose companion to the `AltNum`s in
`src/data/constants/**`. ARCHITECTURE.md §2.5: "All fourteen live disputes are enumerated in
`src/data/constants/DISPUTED.md`, each shipped as an `AltNum` with a `disputeId`, each exposed as a
live A/B toggle in the lil-gui **DISPUTES** folder."

Each row below states **both readings**, **the shipped pick**, and **the argument**. Nothing here is
a majority vote: where two sources disagree and one of them is geometrically impossible with the
segment lengths this project uses, the impossible one loses and the note says why. Where neither is
impossible, the pick is an authorial decision and is labelled as one — those are the rows a
knowledgeable critic can legitimately reopen, and they are why the GUI toggle exists.

**Machine-readable index:** `DISPUTES` in `src/data/num.ts` — one row per `disputeId`, carrying the
dotted `knob` path and the owning file. `tests/data/constants.test.ts` asserts that all fourteen ids
are reachable as `AltNum`s through the `src/data` barrel, that every alt differs from the shipped
value, and that every alt's `src` resolves to a real markdown section.

| id | knob | ships | alts |
|---|---|---|---|
| D01 | `STANCES.zenkutsu.loadFront` | **59 pct** | 55.27 · 60.1 · 70.8 |
| D02 | `FIGHT_PELVIS_Y` | **0.410 H** | 0.470 · 0.440 · 0.380 |
| D03 | `AGE_UKE_FOREARM_INCL_DEG` | **25 deg** | 45 |
| D04 | `TECHNIQUES['soto-uke-chudan'].elbowIncludedDeg` (+ uchi, shuto, TATE-B) | **62 / 63 / 59 deg included** | 90 |
| D05 | `STANCES.zenkutsu.yawRear` | **30 deg** | 45 |
| D06 | `STANCES.zenkutsu.pelvisYawHanmi` (+ kokutsu) | **45 deg** | 90 |
| D07 | `STANCES.kokutsu.S` | **0.446 H** | 0.518 |
| D08 | `HEAD_BOB_PP_H` | **0.008 H peak-to-peak** | 0.016 |
| D09 | `MATERIAL_PARAMS.M_GI.sheen` | **0.45** | 1.00 · 0.35 |
| D10 | `MATERIAL_PARAMS.M_GI.anisotropy` | **0.18** | 0.25 · 0 |
| D11 | `STANCES.hachiji.yawRear` | **30 deg** | 45 |
| D12 | `STANCES.musubi.yawRear` | **45 deg** | 30 · 22.5 |
| D13 | `STANCES.zenkutsu.W` | **0.170 H** | 0.191 · 0.259 |
| D14 | `TEMPO_DISPUTE_S` | **40 s (T1)** | 23.16 · 33.72 · 42 |

---

## D01 — zenkutsu front/rear weight split

* **Reading A (shipped): 59 % front.** `docs/research/01-stances.md §10`, derived in §3.6.
* **Reading B: 55.27 % front.** de Souza 2015, force plate, n = 9 veteran black belts. `[MEASURED]`.
* **Reading C: 60/40.** Nakayama, Nishiyama, Kanazawa, Tagnini — the classical postulate.
* **Reading D: 70/30.** A large number of modern dojo sources.

**Argument.** doc 01 §3.6 shows the three published splits are not three opinions but three
different **front-knee positions**, and it tabulates them: at `PELVIS_Y = 0.410 H` with the rear knee
at 10°, `S = 0.450 H` gives 70.8 % front, `S = 0.530 H` gives 60.1 % (shin exactly vertical, =
Nakayama), `S = 0.540 H` gives 59.0 %, `S = 0.580 H` gives 55.0 % (= de Souza). So the split is a
*consequence* of `S`, and since §3.1 fixes `S = 0.540 H` the split is forced to 59 %. §2.6 override
#7 therefore ships 59 over doc 07's seeded 62, with doc 07's own ±8 tolerance.

**What would change the pick.** A decision to shorten `S`. The two travel together: moving
`loadFront` without moving `S` produces the classic uncanny result doc 01 §3.6 names — long stance
plus a knee jammed forward, i.e. knee valgus and heel lift. **The GUI toggle is honest only because
metric 7's tolerance is ±8, wide enough to cover the whole band.** de Souza's cohort was old and
heavy (mean 46.8 y, 85.9 kg), which doc 01 §11.17 flags as a reason its figure may reflect
conservative stances rather than competition kihon.

## D02 — the fighting pelvis height

* **Reading A (shipped): 0.410 H**, a 0.120 H drop. `docs/research/01-stances.md §10`.
* **Reading B: 0.470 H** — but doc 01 §2's own lookup labels that row *moto-dachi (kumite)*.
* **Reading C: 0.440 H** — doc 01 §2 labels it "**too high — FAIL for kihon**".
* **Reading D: 0.380 H** — "competition-deep, acceptable".

**Argument.** doc 01 §11.2 is candid: "`PELVIS_Y = 0.410 H` is **derived, not measured**. No source
found gives a stance height in cm or as a fraction of stature." It is the value that simultaneously
satisfies zenkutsu at ~2 shoulder widths with the front shin near vertical, kiba at 2 sw with
vertical shins, and the doctrinal equal-height constraint — three independent chains landing on one
number, which doc 01 §5.2 calls a "strong cross-check". §2.6 override #6 ships it over doc 07's
0.470 for exactly the reason doc 01's own table gives: 0.470 is a *different stance*.

**What would change the pick.** A measured value; doc 01 §11.2 says it "could plausibly be anywhere
in 0.39–0.44 H". This is the single most load-bearing invented number in the project: every stance
depth, every knee flexion and metric 6's reference all hang off it, and it is the reason fault X1
(unequal stance heights) is a *critical* fault rather than a warning.

## D03 — age-uke forearm inclination

* **Reading A (shipped): 25° above horizontal.** `docs/research/03-techniques-upper.md §7.2`.
* **Reading B: 45°.** Two independent sources (themartialway, onlineshotokanacademy).

**Argument.** doc 03 §14.1 calls this "the highest-risk number in this document" and then rules it
out arithmetically: 45° is **geometrically incompatible with JKA's own two hard constraints** — the
elbow at eye level *and* the wrist one fist from the forehead — because it would put the wrist at
≈1.036 H, above the top of the head. The JKA manual itself says only that the raised forearm is
"parallel to the forehead, slightly on an angle", which does not quantify anything. §2.6 override #35
ships 25 over doc 07's seeded 45.

**What would change the pick.** Evidence that the 45° figure refers to a frontal-plane diagonal, or
to the forearm's angle relative to the incoming strike vector, rather than to elevation above
horizontal. doc 03 §14.1 could not confirm either reading. Metric 35 measures elevation above
horizontal, so under reading B the rig would have to break a JKA hard constraint to score.

## D04 — the "90° elbow" for soto-uke, uchi-uke and shuto-uke

* **Reading A (shipped): doc 03 §13's INCLUDED angles — 62° soto, 63° uchi, 59° shuto, 62° TATE-B.**
* **Reading B: 90°.** Every single consulted source says 90°.

**Argument.** doc 03 §9.1 is a full derivation, and it is worth restating because reading B is
unanimous in the literature: with Drillis & Contini segments an elbow at exactly 90° gives a
GH→fist-centre chord of `sqrt(0.186² + 0.176²) = 0.256 H`. At shoulder height that chord is almost
purely horizontal, so the fist ends **0.256 H (44.8 cm) in front of the GH** — 74 % of full punch
reach — and the elbow is forced ~0.14 H (25 cm) in front of the ribs. That is the textbook *fault*
(F5, "block too far from the body"), and it contradicts the same sources' other two constraints
(fist at shoulder height, elbow only 1–1.5 fists from the flank). "90°" is a coaching approximation
or a frontal-plane impression. §2.6 override #37 also fixes the *kind*: doc 03 §13's column is the
**included** angle, so `flex = 180 − included` and shuto-uke's 59° included is 121° of flexion.

**What would change the pick.** doc 03 §14.3's own caveat: if the intended reading is that the
**upper arm is horizontal** (elbow lifted to shoulder height at kime, as in some non-JKA lineages),
90° is achievable and doc 03's elbow heights are 0.15 H too low. Video validation is the deciding
evidence and has not been done.

## D05 — zenkutsu rear-foot yaw

* **Reading A (shipped): 30°**, tolerance 20–45. `docs/research/01-stances.md §10`.
* **Reading B: "at least 45°"** (The Martial Way).

**Argument.** doc 01 §11.5 notes The Martial Way's phrasing is ambiguous about whether 45° is
measured from the direction of travel or from the perpendicular. §3.5's ankle-range argument
actually **favours the larger angle** for long stances — turning the foot out by φ splits the 45.7°
of rear-shank lean between dorsiflexion and eversion, and weight-bearing dorsiflexion maxes at
25–35°. So this is not a case of one reading being impossible; 30° is the Nakayama-derived and
Wikipedia figure, and the wide 20–45 tolerance is doc 01's own. §2.6 override #9 ships 30 over doc
07's seeded 25.

**What would change the pick.** Lengthening `S` past 0.58 H, above which doc 01 §3.5 shows heel lift
is a *geometric necessity* and the larger yaw becomes mandatory rather than stylistic. Fault Z3
(rear heel lifted) is **critical**, and Z15 (`yawRear < 18°`) exists because forcing the foot square
makes Z3 unavoidable.

## D06 — hanmi: 45° or 90°

* **Reading A (shipped): 45°.** `docs/research/01-stances.md §10`, JKA technical manual explicit:
  "Rotate the hips 45 degree angle to form HANMI".
* **Reading B: 90°.** Bertel reports Yahara Sensei's precise definition as *pure hanmi = 90°*, with
  Asai using anything from ~30° to 90°.

**Argument.** doc 04 §12.1 is blunt that these "are not reconcilable by averaging — they are probably
measuring different things (pelvis-normal vs shoulder-line vs foot-line)". The project ships the JKA
manual reading because the manual is the most specific quotable source and because 45° is what every
stance description in doc 01 and doc 02 assumes. doc 01 §11.6 grants that "a JKA critic from the
Yahara line would object" — which is precisely what the toggle is for.

**Note for the kokutsu case.** There the sign is *forced*, not chosen: doc 01 §4.2 proves that with
the rear foot at +90° yaw a +45° pelvis leaves 45° of rear-hip external rotation (in range) while a
−45° pelvis would demand 135° (impossible). Only the magnitude is disputed.

## D07 — kokutsu stance length

* **Reading A (shipped): 0.446 H** = 1.72 shoulder widths, ankle to ankle.
* **Reading B: "two shoulder widths"** = 0.518 H, stated by multiple traditional sources.

**Argument.** doc 01 §4.3 proves reading B **infeasible**: at `PELVIS_Y = 0.410 H` with 70 % rear
load the front leg must span `0.70 × S` horizontally, and straight-leg reach caps `S` at 0.459 H. At
`S = 0.518 H` the front leg would need 0.517 H against an available 0.491 H. Forcing it costs either
the 70/30 split (`[MEASURED]`, so keep) or the equal-height doctrine (strong JKA doctrine and cheap
to honour, so keep) — therefore the "two shoulder widths" claim is the one that goes. doc 01 §4.3
also offers its likely origin: `front toe → rear ankle` at `S = 0.446 H` is 0.546 H ≈ 2.1 sw, so the
claim may simply be measured from a different datum, in which case both are right.

**Consequence a reader must not "fix".** doc 02 §1.1 sets the EMBUSEN step `Lk = 1.00 L` for kokutsu
as well as zenkutsu, and the frozen `c(21) = (−0.544, −0.354) L` pin only comes out at that step. So
`EMB_STEP_L.kokutsu = 1` while `STANCES.kokutsu.S = 0.446 H`, and B3 plants the ankles from
`AJC_HALF_SEP_L` about `c`, never from the generator's `ff`/`rf`. The header of
`src/data/embusen.ts` documents this at length; doc 02 §12.7 flags the same tension.

## D08 — head bob: a band or a peak-to-peak bound

* **Reading A (shipped): ≤ 0.008 H PEAK-TO-PEAK.** `docs/research/04-dynamics-timing.md §7.3`.
* **Reading B: a ±0.008 H BAND** (i.e. 0.016 H peak-to-peak). `docs/research/01-stances.md §8.1`.

**Argument.** §2.5 resolves in favour of doc 04 §7.3 as "the tighter and later statement", and adds
the operational reason: Proposal C shipped the ±0.008 *band* and its metric 17 parked permanently in
warn. A metric that can never be green is not a metric. `HEAD_BOB_MAX_PP_H = 0.012` is the hard max
(doc 04 §7.3's own "max"), and metric 17's reference is 0.010 with tolerance +0.010.

**Why it matters more than 8 mm sounds.** doc 01 §8.1 cites Cazeau et al.: zenkutsu stepping costs
far more energy than walking precisely because the karateka *refuses* to let the COM rise, which
suppresses the inverted-pendulum energy exchange of gait. Normal walking oscillates 0.026–0.046 H.
An animation that lets the head rise is animating walking, which is why Z19 is **critical**. doc 01
§11.3 admits the 1.75 / 3.5 / 6.0 cm thresholds are that document's invention, anchored only to
walking as the anti-target.

## D09 — gi sheen

* **Reading A (shipped): `sheen 0.45`, `sheenColor 0xE8E4DA`, `sheenRoughness 0.55`.**
* **Reading B: `sheen 1.0`, `sheenColor 0xffffff`.** `docs/research/05-threejs-api.md §11.1`.
* **Reading C: `sheen 0.35`, `sheenColor 0xE8E4DA`.** `docs/research/06-rig-ik-cloth.md §7.9`.

**Argument.** doc 06 §7.9 argues from the Estevez & Kulla "Charlie" sheen NDF that
`KHR_materials_sheen` and three.js implement, and from cloth reference data — velvet 1.0, cotton
canvas modest, poplin 0.15. doc 05's 1.0 is asserted without an argument. §2.5's decision is that
**neither is settleable by argument**: sheen is nearly invisible without `scene.environment` (doc 05
§14.1 #14) and its perceived strength depends on the IBL, the tone mapping and the camera angle. So
it ships at the midpoint **as a live slider**, and Channel D settles it by eye. The `sheenColor` and
`sheenRoughness` follow doc 06, which is the reading with a model behind it.

**How it gets settled.** `src/ui/look.ts`'s LOOK folder, judged on `contact-sheet.png` at
`--profile hero`, against Channel-D rubric item C12 ("no sheen variation"). The value that wins is
then written back to `src/data/constants/render.ts` **by handoff to B1** — B5 never edits a constant
file.

## D10 — gi anisotropy

* **Reading A (shipped): `anisotropy 0.18`** with an `itemSize = 4` analytic tangent.
* **Reading B: `anisotropy 0.25`,** rotation aligned to the warp per UV island (doc 06 §7.9, which
  calls it "the biggest cheap win for *this is woven, not painted*").
* **Reading C: omit it** (doc 05 §11.1).

**Argument.** doc 05's objection is purely practical — anisotropy "needs a tangent attribute" — and
it does not apply to us: we *generate* the geometry, so we generate the tangent, including the
handedness `w`. §2.7 makes that a hard requirement with its own test: `itemSize === 4`, `|w| === 1`
for every vertex, `|T| = 1 ± 1e-5`, `|dot(T, N)| < 1e-4`. A `vec3` tangent attribute binds without
error and mis-shades the entire gi, which is why the test exists rather than a comment. The shipped
0.18 is below doc 06's 0.25 because the effect compounds with the weave normal map, and both are
live.

## D11 — hachiji-dachi (yoi) foot angle

* **Reading A (shipped): 30° per foot**, tolerance 20–45. `docs/research/01-stances.md §10`.
* **Reading B: 45° per foot** (Wikipedia, karatephilosophy, and most textual sources).

**Argument.** doc 01 §11.9 is explicit that this is "a visual-fidelity judgement, not a sourced
number": textual sources overwhelmingly say 45°, but JKA yoi in practice looks closer to 20–30°.
The pick is authorial. It is also the most *visible* disputed number in the project — yoi is the
first and last pose of every clip and the one a viewer studies longest.

**Note.** `EMB_H_H` is derived from `HACHIJI.W`, not from this yaw, so toggling D11 moves the feet's
orientation and not the embusen (conflict C03/C18).

## D12 — musubi-dachi foot angle

* **Reading A (shipped): 45° per foot** (90° included). `docs/research/01-stances.md §10`.
* **Reading B: 30° per foot** (60° included), traditional-karate.com.
* **Reading C: 22.5° per foot** (45° included), `docs/research/02-kata-sequences.md §2`.

**Argument.** doc 01 §11.8 notes its own ±8° tolerance "does not cover the 30° reading", so this is
a genuine three-way split rather than a tolerance question — and doc 02 §2's rei specification adds a
*third* value, 22.5° per foot, for the same stance. All three ship as alts. Musubi appears only in
the opening and closing bow, so the cost of being wrong is one ceremony pose; it is listed because
§2.5 requires every live dispute to be toggleable, not because it is contentious.

## D13 — zenkutsu stance width

* **Reading A (shipped): 0.170 H**, tolerance ±0.040. `docs/research/01-stances.md §10`.
* **Reading B: one hip width = 0.191 H.**
* **Reading C: one shoulder width = 0.259 H.**

**Argument.** doc 01 §11.12 lists the sources as giving "one hip width", "one shoulder width",
"between hip and shoulder width", *and* "narrows with advancement", and concludes "a critic could
argue for anything in 0.10–0.26 H". 0.170 sits just below the hip width, which is the narrowest
sourced value, and doc 01's own ±0.040 tolerance covers 0.130–0.210. §2.6 override #2 ships it over
doc 07's seeded 0.14 — doc 07 §7.1 itself admits its 0.14 "conflicts with every worded source".

**Why the range is so wide and it still matters.** Width is what fault Z7 (knee valgus, **critical**)
is measured against: `front_knee.X` medial of `front_ankle.X` by more than 0.015 H. Narrowing the
stance without narrowing the knee track manufactures valgus.

## D14 — kata tempo: the official 40 s against measured performance

* **Reading A (shipped): 40 s for Heian Shodan (T1).** `docs/research/04-dynamics-timing.md §6.2`,
  the official JKA-affiliate table; also Nakayama ~40 s and the JKA England sheet's "approx. 40
  seconds".
* **Reading B: 23.16–33.72 s.** Reported timings of four named senior instructors.
* **Reading C: 42 s** (karate-notes).

**Argument.** doc 04 §12.3 judges it "likely the 40 s figure is a *counted/teaching* tempo, not a
performance tempo", but could not fetch the primary page carrying the 23–34 s measurements (TLS
certificate mismatch) and reproduces them from a search snippet only — so confidence in the
endpoints is low. §6.2's decision: ship **T1 as the default** because it matches the published
figure and is easier to read on a 360° orbit, and expose T2 as a "performance tempo" toggle.

**This dispute is not resolved by the toggle; it is resolved by shipping both.** `TEMPO_SCALE` gives
four tiers, and because `tempoScale` multiplies `T_prep` and `T_hold` **only** — never `T_tech`,
`T_thrust` or `T_kime` — a tempo change cannot flatten a technique. That is doc 04 §6.3's own
constraint and it is the JKA "contrast in speed" criterion made structural: at every tier the
*technique* stays fast and only the pauses breathe.

---

## Not disputes: the four conflicts resolved by arithmetic

These have `disputeId: null` and **no** toggle, because one reading is demonstrably wrong rather
than merely less favoured. They are recorded here so nobody re-opens them as if they were disputes.
`CONFLICT_RESOLUTIONS` in `src/contracts/units.ts` is the machine-readable registry.

* **C02 · `L = 0.520 H` (doc 02) vs `ZENKUTSU.S = 0.540 H` (doc 01).** doc 02 §1.1 *itself* mandates
  rescaling every coordinate if the stance spec fixes a different `L`. `L_H` is therefore DERIVED
  from `ZENKUTSU.S.v` and never authored. Because doc 02's tables are dimensionless in `L`, only the
  metre conversion moves — which is why σ-symmetry and the closure residual survive it.
* **C15 · heel-behind-AJC: doc 01's 0.052 H vs doc 06's 0.0415 H.** Both ship, for different
  consumers, because the two documents split different feet (doc 01: 0.100 + 0.052 = 0.152 H;
  doc 06: 0.109 + 0.0415 = 0.1505 H). `ZENKUTSU_HEEL_TO_HEEL_H` **must** derive from doc 01's
  0.052 — `0.540 − 0.052·cos3° + 0.052·cos30° = 0.533105`, inside the ±5e-4 gate, where 0.0415 gives
  0.534497, off by 3× the tolerance. The rig landmark keeps doc 06's. Consequence B9 must know:
  metric 1 measures ≈0.5345 against a 0.533 reference, a systematic −0.26 % bias that **must not be
  "corrected" by moving either number**.
* **C16 · the measurement cameras.** doc 07 §6.6's `CAM_LEFT (+3H, 0.5H, 0)` is an AUTHORED-frame
  number, and §3.4.1 declares `posH` WORLD. `M_LEFT` — the camera that *sees* the character's left —
  sits at world `−3H`. `src/data/constants/camera.ts` authors from `units.ts`'s resolved `M_*_POS_H`
  and never from §5.7's or doc 07's literals.
* **C17 · the two meanings of `L`.** `recoilFracL` and `SETTLE[*].ampFracL` are fractions of the
  **technique's own end-effector path length** (doc 04 §0, ≈0.50 m), never of the embusen step
  `L_M = 0.945 m`. Scaling by `L_M` makes the gyaku-zuki recoil 15.1 mm instead of 8.0 mm and turns
  doc 04 §5.1's hard ceiling into 18.9 mm. **There is no recoil metric in the 63**, so nothing
  downstream would catch it.
* **C18 · doc 02's embusen `h`.** The coordinate tables and the σ axis keep doc 02 §1.1's authored
  `h = 0.19 L`; `EMB_H_H = HACHIJI.W/2 = 0.1295 H = 0.23981 L` governs the yoi/hachiji **stance
  width only**. Regenerating the tables from `EMB_H_H` would shift every embusen `x` by 4.7 cm —
  45 % of metric 42's tolerance — and move the σ constant from `−0.38` to `−0.47963`.

## Two findings in the research docs, recorded not corrected

Both are asserted in `tests/data/proportions.test.ts` so they cannot be silently "fixed" by moving a
bone. Neither changes what B1 ships: both numbers in each pair are transcribed verbatim.

1. **doc 06 §1.3 reaches the AJC with `len.shank`, not `len.shank_ajc`.** `0.2883 − 0.0390 = 0.2493`
   is exactly `len.shank` (KJC → lateral malleolus); `len.shank_ajc` is `0.2529`. A 0.0036 H = 6.3 mm
   difference on a joint the table labels "AJC". The chain is internally consistent with the length
   it used, so **B4 must build the shin from `LEN_SHANK`** or its own closure test will fail.
2. **doc 06 §1.5's upper-arm closure does not close.** It states
   `0.1906 − 0.0114 − 0.0089 ≈ 0.1618 ✔ closes exactly`; the arithmetic gives **0.1703**, an 0.0085 H
   = 1.5 cm gap (in mm: `333.6 − 19.8 − 15.5 = 298.3`, against de Leva's own `281.7`). The rig is
   built from `LEN_UPPERARM = 0.1618` (doc 06 §1.1's "USE THIS FOR THE RIG" row) and the landmark
   offsets are only ever used to reconcile a measured height against a joint centre, so the two
   consumers never meet — but B4 must not "close" the chain by moving a bone, and B9 must not read
   the 1.5 cm as rig error.
