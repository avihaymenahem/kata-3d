# 07 — Reference Material & Side-by-Side Comparison Methodology (licensing-aware)

Status: research spec, machine-actionable. Consumer: animation + tooling agents.
Scope: (A) what visual/motion reference we may legally use, (B) the numeric + visual comparison protocol that produces a 0–100 score without redistributing anyone's copyrighted frames.
Date of license research: 2026-07-31. Licenses change — re-verify before ship.
**Not legal advice.** Every derivation marked `[LEGAL-DERIVED]` is engineering analysis, not counsel.

---

## 0. Conventions (binding for every number in this file)

### 0.1 Coordinate frame — PROJECT CONVENTION (authoritative for cross-doc consistency)

| item | value |
|---|---|
| up | `+Y` |
| character facing at *yoi* | `−Z` |
| character's LEFT | `+X` |
| character's RIGHT | `−X` |
| embusen (floor pattern) plane | `XZ` |
| yaw `ψ` | rotation about `+Y`; `ψ = 0` at *yoi* (facing `−Z`); `ψ > 0` turns the character's facing toward `+X` (i.e. toward the character's left) |
| units | angles = degrees; lengths = fraction of body height `H`, with cm shown for `H = 175 cm`; time = seconds; weight = % of body weight |
| `SIDE_SIGN` | `+1` — code constant that multiplies all lateral offsets so left-side techniques use `+X`. Flip this one constant if the renderer's handedness is changed. |

> **HANDEDNESS WARNING — read before writing any FK code.**
> `(+Y up, forward = −Z, left = +X)` is **left-handed**, not right-handed. Proof: for a right-handed basis `X × Y = Z`. Physically `left × up = forward = −Z`, so `X × Y = −Z`. In a strictly right-handed frame with `+Y` up and forward `−Z` (three.js default camera frame), **`+X` is the character's RIGHT**.
> Consequence if unresolved: every `hidari`/`migi` (left/right) technique in the kata mirrors. `hidari gedan-barai` renders as `migi gedan-barai` and the whole embusen mirrors about the Z axis.
> Resolution rule: keep the table above as the *authoring* convention (it is what other docs in `docs/research/` assume), and place exactly one conversion at the rig boundary:
> `world = new THREE.Vector3(-a.x, a.y, a.z)` when mapping authored `(x,y,z)` → three.js world, OR equivalently set `SIDE_SIGN = -1`. Do it in one place, assert it with a unit test (`test: hidari gedan-barai fist has world.x < 0 in three.js space`).

### 0.2 Anthropometric constants used for every `[DERIVED]` value

Drillis & Contini (1966) proportionality constants, as fraction of stature `H`. Source: https://www.openlab.psu.edu/design-tools-proportionality-constants/ (cross-checked against https://www.researchgate.net/figure/Body-segment-parameters-from-Drillis-and-Contini-1966-The-parameters-used-in-this_fig1_309408799).

| name | frac H | cm @H=175 | name | frac H | cm @H=175 |
|---|---|---|---|---|---|
| eye height | 0.936 | 163.8 | biacromial (shoulder) breadth | 0.259 | 45.3 |
| chin height | 0.870 | 152.3 | hip breadth | 0.191 | 33.4 |
| acromion (shoulder) height | 0.818 | 143.2 | chest breadth | 0.174 | 30.5 |
| nipple height | 0.720 | 126.0 | upper arm length | 0.186 | 32.6 |
| elbow height | 0.630 | 110.3 | forearm length | 0.146 | 25.6 |
| trochanter (hip) height | 0.530 | 92.8 | hand length | 0.108 | 18.9 |
| wrist height | 0.485 | 84.9 | thigh length | 0.245 | 42.9 |
| fingertip height | 0.377 | 66.0 | shank length | 0.246 | 43.1 |
| knee height | 0.285 | 49.9 | foot length | 0.152 | 26.6 |
| ankle height | 0.039 | 6.8 | foot breadth | 0.055 | 9.6 |
| head height | 0.130 | 22.8 | fist diameter `[DERIVED]` = 0.55 × hand length | 0.059 | 10.4 |

Target-height constants used for strike heights:
`jodan` target (philtrum) `= 0.900H` `[DERIVED]` (between chin 0.870 and eye 0.936);
`chudan` target (solar plexus / xiphoid) `= 0.700H` `[DERIVED]` (just below nipple 0.720);
`gedan` target (lower abdomen) `= 0.520H` `[DERIVED]` (just below trochanter 0.530).

### 0.3 Canonical skeleton (25 joints) — the comparison substrate

All metrics below are computed on this joint set, in this order. Names are Mixamo-compatible so that any CC0/Mixamo/Quaternius rig retargets without a mapping table.

```
0  Hips          7  LeftShoulder   12 RightShoulder   17 LeftUpLeg   21 RightUpLeg
1  Spine         8  LeftArm        13 RightArm        18 LeftLeg     22 RightLeg
2  Spine1        9  LeftForeArm    14 RightForeArm    19 LeftFoot    23 RightFoot
3  Spine2       10  LeftHand       15 RightHand       20 LeftToeBase 24 RightToeBase
4  Neck         11  LeftFistCenter 16 RightFistCenter
5  Head
6  HeadTop_End
```
`*FistCenter` = virtual joint at the geometric centre of the closed fist, `0.5 × fist diameter = 0.030H` beyond the wrist along the hand axis. It is the striking-point proxy; every fist metric uses it, never `*Hand`.

---

## 1. VERDICT TABLE — what may actually ship

| asset / dataset | can we SHIP it inside the web app? | why |
|---|---|---|
| Funakoshi 1922 / 1925 / 1926-and-earlier book **photographs** (incl. Commons `Gichin Funakoshi - Heian Nidan (*).png`) | **YES** | PD in Japan (1899 Act art.23, 10-yr photo term) and PD in US (not URAA-restored) |
| Numbers/angles we measure *from* those photos | **YES** | measurements are facts, uncopyrightable |
| Embusen diagrams **redrawn by us from coordinates** | **YES** | floor geometry is a fact; our SVG is our expression |
| Commons embusen SVG/JPG by third parties (CC BY-SA 3.0/4.0, GFDL) | **NO (avoid)** | copyleft — share-alike would attach to our derivative page/asset |
| US Army FM 21-150 illustrations | YES (17 USC §105) | but content is generic combatives, **not** Shotokan kata — low value |
| CMU Motion Capture Database | **YES, embedded only** | "may include in commercially-sold products; may not resell this data directly, even in converted form" + required acknowledgement |
| AMASS / BMLmovi / HumanML3D / HumanAct12 / SMPL body model | **NO — RESEARCH ONLY** | AMASS: "any use for commercial purposes, is prohibited"; no redistribution at all |
| Human3.6M | **NO — ACADEMIC ONLY, LOUDLY** | free licences "limited to academic use only"; sub-licensing/transfer forbidden |
| KIT Whole-Body Human Motion Database | **NO by default** | registration-gated, per-motion terms, no blanket CC grant published; treat as research-only |
| AIST++ | annotations yes / practically **NO** | annotations CC BY 4.0 (Google) but they are SMPL parameters → SMPL model licence is non-commercial; and it's dance, not karate |
| Bandai-Namco Research Motiondataset | **NO** | CC BY-**NC** 4.0 |
| RMoCap `heian.nidan.bvh` (real Shotokan kata BVH!) | **NO — offline reference only** | bundled in a **GPL-3** R package; redistribution drags GPL obligations onto our bundle |
| Casa Paganini / InfoMus karate mocap (Bassai Dai + Heian Yondan) | **UNVERIFIED — must confirm** | site unreachable 2026-07-31 (`ECONNREFUSED 130.251.14.190:443`); one secondary summary claims CC BY 4.0 — **do not rely on that** |
| Kyokushin optical mocap (Sci Data 2021, figshare) | LIKELY YES, verify per-file | article CC BY 4.0, metadata CC0; figshare item licence blocked (403) at research time |
| MakeHuman exports (unmodified official build) | **YES** | user may apply CC0 to exports |
| Quaternius Universal Base Characters / Universal Animation Library | **YES** | CC0, FBX + glTF |
| Mixamo characters/animations | YES embedded, **no redistribution of raw files** | Adobe: royalty-free commercial use, no attribution, but cannot ship as an asset pack |
| three.js `examples/models/**` (Soldier.glb, Xbot, Michelle) | **NO (avoid)** | code is MIT; individual model licences are *not* documented (mrdoob/three.js issue #23089) |
| Any JKA / SKIF / WKF / KarateByJesse / YouTube video frame | **NEVER** | all rights reserved; YouTube ToS forbids download |

---

## 2. Public-domain & CC imagery / diagrams

### 2.1 The one genuinely clean visual ground truth: Funakoshi's own pre-1930 photographs

Source: https://commons.wikimedia.org/wiki/Category:Gichin_Funakoshi

| file group | count | subject | licence tags | original source | resolution |
|---|---|---|---|---|---|
| `Gichin Funakoshi - Heian Nidan (Yoi).png`, `(2).png` … `(16).png` | 16 | full Heian Nidan posture sequence, Funakoshi himself | **PD-Japan-oldphoto + PD-1996** | 錬胆護身唐手術 *Rentan Goshin Karate Jutsu*, 1925-03-10, p.61 ff. | ~413 × 680 px |
| `Heian Nidan - 1.png` | 1 | opening posture | PD (same family) | 1925 | — |
| `Heian Nidan Funakoshi.gif` | 1 | animated, 81 frames, 5.4 s, 292×480 | **CC BY-SA 4.0** (uploader-applied) | derived from the PD stills | 1.17 MB |

`PD-Japan-oldphoto` rule (verbatim mechanism, from https://commons.wikimedia.org/wiki/Template:PD-Japan-oldphoto): a photograph is PD in Japan if **(a)** published before 1958-01-01, or **(b)** photographed before 1957-01-01 and unpublished within 10 years of the following year, or **(c)** photographed in 1957 and unpublished by 1970-12-31. Legal basis: art. 23 of the 1899 Japanese Copyright Act (10-year term for photographs) + art. 2 of the 1970 Act's supplemental provisions. Because Japanese copyright expired by 1970, **URAA did not restore US copyright** → PD in the US too. Caveat on the template: if the photo was also published in the US within 30 days of Japanese publication it may retain US copyright.

`[LEGAL-DERIVED]` Consequence, stated precisely, because it is the crux of this whole document:
- **Photographs** in Funakoshi's 1922 / 1925 / 1935 books → PD in Japan (10-yr photo term expired 1932/1935/1945) and PD in the US (no URAA restoration). **Usable, including commercially.**
- **Line drawings and text** in those books are *artistic/literary* works, not photographs → old Japanese term = life + 50 → Funakoshi died 1957-04-26 → PD in Japan 2008-01-01. But they *were* in copyright in Japan on the URAA date 1996-01-01 → **US copyright restored** → US term = 95 y from publication:
  | work | pub. | drawings/text PD in US on |
  |---|---|---|
  | Ryukyu Kempo: Karate | 1922 | 2018-01-01 ✅ already PD |
  | Rentan Goshin Karate Jutsu | 1925 | 2021-01-01 ✅ already PD |
  | Motobu, Okinawa Kenpo Karate-jutsu Kumite-hen | 1926 | 2022-01-01 ✅ already PD |
  | any 1930 imprint | 1930 | 2026-01-01 ✅ newly PD (Public Domain Day 2026) |
  | Mabuni/Nakasone 1934 | 1934 | 2030-01-01 ❌ |
  | **Funakoshi, Karate-do Kyohan** | **1935** | **2031-01-01 ❌ (drawings/text)** — photographs from it are PD |
- Japan's 2018 term extension (50→70 y p.m.a.) is **not retroactive** for works already PD there, so Funakoshi's works stay PD in Japan.
- The 2026 US cutoff is 1930-and-earlier (95 y). Sources: https://blog.archive.org/public-domain-day-2026/, https://copyrightlately.com/public-domain-2026/

### 2.2 Commons kata/embusen diagrams — licence audit (all copyleft; do not embed)

`Category:Karate kata` = 82 files + 11 subcategories: https://commons.wikimedia.org/wiki/Category:Karate_kata
Contains embusen diagrams for Taikyoku Shodan, Heian Shodan/Nidan/Sandan/Yondan, Enpi.

| file | licence | author | note |
|---|---|---|---|
| `HeianNidan-ShotokanEmbusen.svg` (600×600) | **CC BY-SA 3.0 + GFDL 1.2+** | Chrkl | dual copyleft — worst case for us |
| `Karate Kata Heian Shodan Pattern.jpg` (665×974) | **CC BY-SA 4.0** | "Haresh karate", 2017-10-06 | copyleft |
| `Embusen de Heian Sandan.png`, `Embusen de Heian Shodan.png` (485×494, 3 KB) | Commons CC family (verify per file) | various | copyleft likely |

**Rule for the implementation:** an embusen is a set of `(x, z)` waypoints and turn angles — a *fact*. Author `data/embusen/*.json` ourselves and render the diagram with our own SVG/canvas code. Zero licence exposure, and it becomes the same data the player uses for the floor-trace overlay. Never `<img src>` a Commons SVG.

### 2.3 Low-value-but-clean fallbacks

| source | licence | value |
|---|---|---|
| US Army FM 21-150 *Combatives* (1954, 1992 eds.), archive.org | PD, 17 USC §105 (US Govt work) | generic strikes/kicks line art; **no Shotokan stance geometry**; use only for silhouette/pose-drawing style inspiration |
| Colombia "Escuela Virtual de Deportes" karate files on Commons (74 files) | Commons CC family — **verify per file** | Spanish-language karate teaching stills; unverified at research time |

---

## 3. Motion-capture dataset matrix

| dataset | martial-arts content | licence (exact) | commercial? | derivative/redistribute? | format | joints / markers | fps | retarget difficulty (1=trivial…5=research project) | ship? |
|---|---|---|---|---|---|---|---|---|---|
| **CMU Graphics Lab Mocap DB** — https://mocap.cs.cmu.edu/ | catalogue lists "martial arts" among sports; **specific Shotokan-kata trials NOT verified** (site TLS chain failed on 2026-07-31) | "free for use in research projects. You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form." + must add "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." | **YES (embedded)** | reselling the data itself: NO | ASF/AMC native; C3D; community BVH (`una-dinosauria/cmu-mocap`) and FBX (1.92 GB, academictorrents `8e21416d…`) conversions | 41 markers / 31-bone skeleton | 120 Hz capture (BVH mirrors often 120 or downsampled 30) | 2 — BVH + `SkeletonUtils.retarget`; skeleton is T-pose-ish, root at hips | **YES** |
| **AMASS** — https://amass.is.tue.mpg.de/license.html | none karate-specific | "To use the Dataset for the sole purpose of performing non-commercial scientific research, non-commercial education, or non-commercial artistic projects… Any other use, in particular any use for commercial purposes, is prohibited." "shall not be copied, shared, distributed, re-sold… in whole or in part." | **NO** | **NO** | SMPL-H / SMPL-X `.npz` (pose params, not positions) | 22 body (52 with hands) | resampled to 60 Hz (source 120) | 4 — needs SMPL fwd-kinematics + shape params before retarget | **NO** |
| **BMLmovi** (sub-dataset of AMASS) | 21 everyday actions, no kata | non-commercial research/education/artistic, cite AMASS | NO | NO | via AMASS npz | as AMASS | 60 Hz | 4 | **NO** |
| **KIT Whole-Body Human Motion DB** — https://motion-database.humanoids.kit.edu/ | one karate-tagged motion observed in search index (#1041) — unverified | re3data lists data licence only as "Copyrights" (KIT legal policy + site FAQ); access "open" **and** "restricted / registration" | unclear → assume NO | assume NO | C3D + MMM (Master Motor Map) reference model XML | MMM 104-DoF ref model | 100 Hz typical | 4 — MMM→FBX/glTF mapping is bespoke | **NO** |
| **AIST++** — https://google.github.io/aistplusplus_dataset/factsfigures.html | dance only | "The annotations are licensed by Google LLC under CC BY 4.0"; underlying AIST Dance Video DB has its own (non-commercial) terms; annotations are SMPL params → SMPL model licence is non-commercial | annotations yes / **effectively NO** | annotations yes | SMPL params + 3D/2D keypoints (`.pkl`) | 17 COCO kpts / 24 SMPL joints | 60 fps video | 4 | **NO** |
| **HumanML3D** | none | derived from **AMASS + HumanAct12** → inherits AMASS non-commercial | **NO** | NO | 263-d motion feature vectors / SMPL | 22 | 20 Hz (re-sampled) | 5 (features, not skeletons) | **NO** |
| **HumanAct12** | none | research use (from PHSPD) | NO | NO | positions/SMPL | 24 | 30 | 4 | **NO** |
| **Human3.6M** — https://vision.imar.ro/human3.6m/eula.php | none | "licenses free of charge are limited to academic use only", academic e-mail required; "may not rent, lease, lend, sub-license or transfer"; commercial needs written permission + fees | **NO — ACADEMIC ONLY** | **NO** | video + 3D positions + `.cdf` | 32 (17 eval) | 50 Hz | 3 | **NO** |
| **Casa Paganini / InfoMus Karate dataset** — http://www.infomus.org/karate/eyesweb_dataset_karate_eng.php | ⭐ **actual Shotokan kata: Bassai Dai + Heian Yondan** | **UNVERIFIED.** Site refused connection 2026-07-31. Secondary summary claims CC BY 4.0 — treat as unconfirmed | unknown | unknown | `.tsv` 3D joint positions + synced audio + video | 25 reflective markers | **250 Hz**, Qualisys, 9 cameras | 2 (positions → IK) | **BLOCKED pending licence confirmation** |
| **Kyokushin optical mocap** — Sci Data 2021, https://pmc.ncbi.nlm.nih.gov/articles/PMC7813879/ , figshare DOI `10.6084/m9.figshare.c.4981073` | gyaku-zuki, mae-geri, mawashi-geri (gedan + jodan), ushiro-mawashi-geri. **No kata.** Kyokushin ≠ Shotokan geometry | article CC BY 4.0; metadata CC0; **per-file figshare licence unverified (403)** | likely yes if CC BY/CC0 | likely yes | **C3D** | 39 markers, Vicon Plug-in-Gait full body | **250 Hz** | 2 | **LIKELY YES — verify** |
| **Hachaj GDL karate repo** — http://gdl.org.pl/ , IEEE SSCI 2017 | 320 recordings / 28 techniques, Oyama + Shorin-ryu (+ Shotokan in a related set) | **no licence published** → assume all rights reserved | NO | NO | proprietary GDL + BVH exports | Shadow 2.0, 17 IMUs | 100 Hz | 3 | **NO** |
| **RMoCap** — https://github.com/browarsoftware/RMoCap | ⭐ bundles `heian.nidan.bvh` — a real **Shotokan Heian Nidan** BVH; also `bassai.dai`-family examples in the paper corpus | package `License: GPL (>= 3)`, authors Hachaj & Ogiela | GPL terms | copyleft — viral | **BVH** | ~17 segments | 100 Hz | 1 (BVH is trivially loadable) | **NO — offline reference only** |
| **Bandai-Namco Research Motiondataset** | "fighting" style category (not kata) | **CC BY-NC 4.0** | **NO** | NC only | BVH | — | — | 1 | **NO** |
| motioncapturedata.com "martial arts" free BVH | assorted | unstated / mostly re-hosted CMU | unknown | unknown | BVH | varies | varies | 1 | **NO (provenance unknown)** |

### 3.1 What that matrix actually means for us

1. There is **no** permissively-licensed, ship-safe mocap of Shotokan Heian Shodan or Taikyoku Shodan anywhere I could find. The two datasets that contain real Shotokan kata (InfoMus: Bassai Dai + Heian Yondan; RMoCap: Heian Nidan) are respectively licence-unverified and GPL-3.
2. Therefore the animation must be **hand-authored from measured parameters** — which is also the licence-cleanest path, since parameters are facts.
3. `heian.nidan.bvh` (GPL-3) may be loaded **on a developer machine** to sanity-check *timing envelopes* (per-move durations, kime dwell, hip-lead lag). Extract only aggregate numbers into the repo; never commit the BVH, never bundle it. Record in `docs/research/PROVENANCE.md` that the number is an aggregate statistic, not a copy.
4. CMU is the only mocap we could legitimately embed. Use it for **generic** ingredients only (weight-shift, stepping cadence, breathing idle), not for kata poses. Ship the required acknowledgement string in the About panel.

---

## 4. Openly licensed rigged humanoids (fallback / proportions reference)

| asset | licence | commercial | format | rig | use for us |
|---|---|---|---|---|---|
| **MakeHuman** exports from an unmodified official build — http://www.makehumancommunity.org/content/license_explanation.html | app AGPL; **core assets CC0**; exports may be relicensed **CC0** by the user | YES, no attribution | OBJ/FBX/DAE/glTF | default MH rig, CMU-compatible and Mixamo-compatible rigs available | ⭐ **best proportions reference** — parametric stature, can be dialled to exactly `H = 175 cm`; gives a CC0 mesh we may ship. Exception: CC0 option does **not** apply if MakeHuman is linked as a library/server or mass-export-scripted. |
| **Quaternius Universal Base Characters** + Universal Animation Library 1 & 2 — https://quaternius.com/ | **CC0** | YES | FBX + glTF | universal humanoid, Mixamo-compatible bone names | ⭐ fallback shippable karateka body; 250+ CC0 clips for idle/transition filler |
| **Mixamo** (Adobe) | free, royalty-free, commercial OK, no credit required; **no redistribution of raw assets** | YES (embedded) | FBX/glTF | 65-bone humanoid = our canonical naming | good for bone-name canon + auto-rigger; its "karate" clips are cinematic, **not authentic kata** — never use them as ground truth |
| SMPL / SMPL-X meshes (MPI) | non-commercial research licence | **NO** | npz + mesh | 24/55 joints | avoid; commercial route is Meshcapade licensing |
| three.js `examples/models/gltf/Soldier.glb`, Xbot, Michelle | code MIT, **model licences undocumented** (issue #23089, #26571) | risky | glb | Mixamo-derived | dev-time prototyping only, strip before ship |

Proportion target for our karateka `[DERIVED]`: `H = 175 cm`, 8.0 heads tall (head 0.130H → 7.7 heads; round to 7.7 for realism, not the 8.0 heroic canon — a stylised 8-head figure makes stance depths read shallower than the numbers say).

---

## 5. Open-source three.js / WebGL work to benchmark our LOOK against

**Honest negative finding:** no open-source three.js/WebGL Shotokan-kata player exists. Searches across GitHub topics (`three-js`, `karate`, `3d-animation`) returned nothing kata-specific. The nearest prior art is academic prototypes with no shippable code:

| prior art | what it does well | code? |
|---|---|---|
| Hachaj/Ogiela, *Human Actions Analysis: Templates Generation, Matching and Visualization … Karate Athletes*, Sensors 17(11):2590, CC BY — https://pmc.ncbi.nlm.nih.gov/articles/PMC5713128/ | ⭐ the methodology we should copy: per-joint **quaternion DTW** with cost `cf(x,y) = 1 − |x · y|`, template averaging via DBA + Markley quaternion mean, 3-D DTW mapping plots. Reports median normalised distance ~1e-4 for correct actions; 100 % same-subject / 94.2 % cross-subject recognition | R (`RMoCap`, GPL-3) |
| *Overview+Detail Visual Comparison of Karate Motion Captures* (Springer, 2020) | overview+detail side-by-side layout of two captures | no |
| *iKarate: Karate Kata Aiding System* | kata scoring UX framing | no |
| three.js official examples (MIT code): `webgl_animation_skinning_blending`, `_additive_blending`, `_morph`, `_ik`, `webgl_animation_retargeting` — https://threejs.org/examples/ | crossfade quality bar, additive layering, `SkeletonUtils.retarget` reference implementation, IK example | ✅ MIT |
| `three-vrm` (pixiv, MIT) | canonical humanoid bone-mapping table; good source for a retarget bone-name dictionary | ✅ MIT |
| `three.js` `BVHLoader` addon | loads the GPL Heian Nidan BVH locally for timing extraction | ✅ MIT |

Look-benchmark bar to beat: three.js `webgl_animation_skinning_blending` is the *floor* (correct skinning, smooth crossfade, flat lighting). Our target is above it on: contact shadows, cloth/gi secondary motion, kime snap, camera language.

---

## 6. THE COMPARISON METHODOLOGY

Design constraint: **produce a defensible side-by-side without ever storing a copyrighted frame.** Three independent channels, each fully licence-clean:

- **Channel A — numeric scorecard** (§6.2–6.5): our render vs a *parameter table*. Parameters are facts.
- **Channel B — synthetic reference overlay** (§6.6): we forward-kinematics the parameter table onto our own stick figure and draw it beside/over our render. 100 % our own expression.
- **Channel C — PD photo reprojection** (§6.7): 2D joint annotations digitised from the **public-domain 1925 Funakoshi photographs**. Fully licensed ground truth from real Shotokan.
- **Channel D — harsh critic rubric** (§6.8): human/VLM judgement on **our frames only**.

### 6.1 Reference pose bank — file format (implement verbatim)

`data/reference/<kata>.ref.json`:

```json
{
  "schema": "kata-ref/1",
  "kata": "heian-shodan",
  "H_cm": 175,
  "convention": { "up": "+Y", "facing_at_yoi": "-Z", "left": "+X", "side_sign": 1 },
  "tempo": { "total_s": 38.0, "total_s_tol": 8.0 },
  "steps": [
    {
      "id": 1,
      "name_jp": "hidari gedan-barai",
      "stance": "zenkutsu-dachi",
      "facing_yaw_deg": 90,
      "embusen_xz": [0.00, 0.00],
      "targets": {
        "stance_len_H": 0.45, "stance_width_H": 0.14,
        "front_knee_flex_deg": 45, "rear_knee_flex_deg": 8,
        "weight_front_pct": 62,
        "pelvis_yaw_deg": 0, "shoulder_yaw_deg": 0, "torso_pitch_deg": 2,
        "active_fist_H": 0.345, "active_fist_lateral_H": 0.10,
        "hikite_fist_H": 0.620, "hikite_fist_lateral_H": 0.11, "hikite_fist_back_H": 0.02,
        "head_yaw_deg": 0
      },
      "timing": { "move_s": 0.55, "kime_hold_s": 0.30 }
    }
  ]
}
```
Rules: every `targets` key must be one of the metric IDs in §6.2. Any key absent → that metric is skipped for that step (weight redistributed). One file per kata; **one source of truth** — if `docs/research/0X-stances*.md` disagrees with a value here, the stance doc wins for the *reference value* and this doc's **tolerance stays**.

### 6.2 SCORECARD — metric list (names, formulas, reference values, tolerances)

Notation: `p[j]` = world position of canonical joint `j`; `H` = character height in the same world units; `f` = unit facing vector of the pelvis projected to XZ; `n` = unit floor normal `(0,1,0)`.
`flex(a,b,c) = 180° − angle(a−b, c−b)` (0° = fully extended limb).
All positional metrics are divided by `H` → dimensionless. Cm equivalents are for `H = 175 cm`.

#### Group G1 — Stance & base (weight 0.34)

| # | metric id | formula | reference (zenkutsu-dachi unless noted) | tol (score 100 inside) | hard-fail beyond | src |
|---|---|---|---|---|---|---|
| 1 | `stance_len_H` | `|((p[19]−p[23]) · f)| / H` (heel-to-heel along facing) | **0.45** (78.8 cm) | ±0.05 (±8.8 cm) | ±0.15 | [DERIVED] from "2 shoulder widths" = 2×0.259H = 0.518H vs "1.5 shoulder widths" = 0.389H → midpoint 0.45H. **SOURCES DISAGREE, see §7** |
| 2 | `stance_width_H` | `|((p[19]−p[23]) · (n × f))| / H` | **0.14** (24.5 cm) ≈ 0.55 × biacromial | ±0.04 | ±0.10 | https://www.shotokankarateonline.com/blog/shotokan-karate-stances/ ("hip width to shoulder width") + [DERIVED] |
| 3 | `front_knee_flex_deg` | `flex(p[17],p[18],p[19])` front leg | **45** | ±10 | ±22 | [DERIVED] from "knee over the instep, toes hidden by the knee" |
| 4 | `rear_knee_flex_deg` | `flex(rear hip,knee,ankle)` | **8** | ±7 | ±20 | tradition: rear leg straight but not locked |
| 5 | `knee_over_toe_H` | `((p[18]−p[20]) · f) / H`, front leg | **0.00** | ±0.03 (±5.3 cm) | ±0.08 | "you should not be able to see the toes of your front foot" — shotokankarateonline |
| 6 | `hip_height_H` | `p[0].y / H` | **0.470** (82.3 cm) | ±0.025 | ±0.06 | [DERIVED]: standing trochanter 0.530H − 0.060H stance drop |
| 7 | `weight_front_pct` | `100 × (CoM_xz projected onto the front-foot half of the base of support)`, or GRF split if physics | **62 %** | ±8 | ±20 | force-plate study vs postulated 60/40; other sources say 70/30 — **DISAGREEMENT, see §7**. https://tohoku.elsevierpure.com/en/publications/weight-distribution-in-karate-stances-a-comparison-between-experi |
| 8 | `front_foot_yaw_deg` | signed yaw of `p[20]−p[19]` vs `f` | **0** (straight ahead) | ±10 | ±25 | "both feet facing forward as much as possible" |
| 9 | `rear_foot_yaw_deg` | same, rear foot, sign = outward | **25** outward | ±12 | ±30 | [DERIVED] from JKA "as forward as possible" against ankle ROM limits |
| 10 | `rear_heel_gap_H` | `p[23].y / H − 0.039` | **0.000** (heel down) | +0.008 (1.4 cm) | +0.02 | tradition: rear heel must stay planted |
| 11 | `pelvis_yaw_deg` | yaw(pelvis) − `facing_yaw_deg` | **0** (shomen) / **45** (hanmi) | ±8 | ±20 | kokutsu: "push the back hip forwards at a 45° angle" |
| 12 | `shoulder_pelvis_diff_deg` | yaw(shoulder line) − yaw(pelvis) | **0** at kime | ±10 | ±25 | [DERIVED] hips and shoulders square at completion |
| 13 | `torso_pitch_deg` | angle of `p[4]−p[0]` from `+Y` in the sagittal plane | **2** (upright, trace forward) | ±5 | ±14 | [DERIVED] |
| 14 | `torso_roll_deg` | lateral lean of `p[4]−p[0]` | **0** | ±4 | ±12 | [DERIVED] |
| 15 | `head_height_H` | `p[6].y / H` | **0.975** in stance | ±0.02 | ±0.05 | [DERIVED]: 1.000 standing − hip drop 0.060 + slight spine ext. |
| 16 | `head_yaw_deg` | yaw(head) − direction of the technique target | **0** | ±6 | ±20 | tradition: eyes lead the technique |
| 17 | `head_bob_H` | `max(p[6].y) − min(p[6].y)` while stepping within one stance | **≤ 0.010** | +0.010 | +0.030 | [DERIVED] JKA "level hips while stepping" |

Alternate-stance overrides for #1/#2/#4/#6/#7 (same formulas):

| stance | `stance_len_H` | `stance_width_H` | `weight_front_pct` | `hip_height_H` | src |
|---|---|---|---|---|---|
| zenkutsu-dachi | 0.45 ±0.05 | 0.14 ±0.04 | 62 ±8 front | 0.470 ±0.025 | above |
| kokutsu-dachi | 0.42 ±0.05 | 0.06 ±0.03 (heels **in line**) | **30 ±8 front** (70 back; some dojo 80/20) | 0.455 ±0.030 | shotokankarateonline; feet at 90° to each other |
| kiba-dachi | 0.00 (feet level) | **0.40 ±0.05** | 50 ±5 | 0.440 ±0.030 | "1.5 shoulder widths", weight central |
| hachiji-dachi (yoi) | 0.00 | **0.26 ±0.04** (= biacromial) | 50 ±3 | 0.525 ±0.015 | "hip width to shoulder width apart" |
| musubi-dachi | 0.00 | heels together, toes out **45 ±8°** | 50 ±3 | 0.530 ±0.010 | shotokankarateonline |
| neko-ashi-dachi | 0.22 ±0.05 | 0.10 ±0.04 | **7 ±5 front** (90–95 % rear) | 0.430 ±0.035 | shotokankarateonline |
| hangetsu-dachi | 0.36 ±0.05 | 0.16 ±0.04 | 50 ±5 | 0.455 ±0.030 | shotokankarateonline |

#### Group G2 — Upper-body technique (weight 0.30)

| # | metric id | formula | reference | tol | hard-fail | src |
|---|---|---|---|---|---|---|
| 18 | `active_fist_H` | `p[11 or 16].y / H` | chudan **0.700**; jodan **0.900**; gedan **0.520** | ±0.025 | ±0.06 | [DERIVED] from §0.2 target heights |
| 19 | `active_fist_lateral_H` | `((p[fist]−p[0]) · (n×f)) / H` | **0.00** (body centreline) for choku/oi/gyaku-zuki | ±0.02 (±3.5 cm) | ±0.06 | tradition: punch travels the centreline |
| 20 | `arm_extension_ratio` | `|p[fist]−p[shoulder]| / (0.186H + 0.146H + 0.030H)` | **0.95** | ±0.03 | ±0.10 | [DERIVED]: extended, elbow unlocked |
| 21 | `punch_elbow_flex_deg` | `flex(shoulder,elbow,wrist)` active arm | **8** | ±7 | ±20 | [DERIVED] consistent with #20 |
| 22 | `wrist_break_deg` | angle between `p[fist]−p[10/15]` and `p[10/15]−p[9/14]` | **0** | ±6 | ±18 | tradition: fist, wrist, forearm in one line |
| 23 | `fist_roll_deg` | roll of the fist about the forearm axis; 0° = palm down (`tate` = 90°) | **0** at kime for oi/gyaku-zuki | ±12 | ±35 | tradition: full pronation at impact |
| 24 | `hikite_fist_H` | `p[opposite fist].y / H` | **0.620** (108.5 cm, iliac crest) | ±0.03 | ±0.07 | [DERIVED] between wrist 0.485 and nipple 0.720 |
| 25 | `hikite_lateral_H` | `|((p[hikite]−p[0]) · (n×f))| / H` | **0.11** (19.3 cm, at the side of the ribs) | ±0.03 | ±0.08 | [DERIVED] ≈ 0.55 × hip breadth + fist radius |
| 26 | `hikite_back_H` | `−((p[hikite]−p[0]) · f) / H` (positive = behind) | **0.02** | ±0.03 | ±0.09 | [DERIVED] fist at the hip, elbow driven back |
| 27 | `hikite_elbow_flex_deg` | `flex(shoulder,elbow,wrist)` hikite arm | **100** | ±15 | ±35 | [DERIVED] law of cosines with 0.186H/0.146H segments and 0.21H shoulder→fist |
| 28 | `hikite_present` | boolean: `hikite_lateral_H` and `hikite_fist_H` both within tol at kime | **true** | — | false = **fatal** | tradition; #1 tell of a fake karate animation |
| 29 | `shoulder_elevation_H` | `p[shoulder].y / H − 0.818` | **0.000** | ±0.010 | ±0.030 | tradition: shoulders stay down |
| 30 | `gedan_barai_fist_H` | `p[fist].y / H` at completion | **0.345** (60.4 cm) | ±0.04 | ±0.09 | [DERIVED]: knee 0.285H + one fist 0.059H |
| 31 | `gedan_barai_fist_over_knee_H` | horizontal distance `p[fist]` → `p[front knee]`, XZ | **0.045** (7.9 cm) | ±0.04 | ±0.10 | [DERIVED] fist just outside the front knee |
| 32 | `gedan_barai_forearm_incline_deg` | angle of `p[fist]−p[elbow]` below horizontal | **40** | ±12 | ±30 | [DERIVED] |
| 33 | `age_uke_wrist_H` | `p[wrist].y / H` | **0.900** | ±0.035 | ±0.08 | [DERIVED] forearm one fist above the eyebrow line |
| 34 | `age_uke_forward_H` | `−((p[wrist]−p[4]) · f) / H` (in front of the neck) | **0.12** (21 cm) | ±0.04 | ±0.10 | [DERIVED] one forearm-ish in front of the forehead |
| 35 | `age_uke_forearm_angle_deg` | angle of `p[fist]−p[elbow]` from horizontal | **45** | ±12 | ±28 | tradition: 45° diagonal forearm |
| 36 | `shuto_uke_hand_H` | `p[hand].y / H` | **0.700** (chudan) | ±0.03 | ±0.07 | [DERIVED] |
| 37 | `shuto_uke_elbow_flex_deg` | `flex(shoulder,elbow,wrist)` | **90** | ±15 | ±35 | [DERIVED] |
| 38 | `shuto_uke_support_hand_H` | rear/other open hand height | **0.700** at the solar plexus, `lateral ≤ 0.03H` | ±0.035 | ±0.08 | [DERIVED] |
| 39 | `tettsui_uchi_fist_H` | `p[fist].y / H` at completion | **0.580** | ±0.04 | ±0.10 | [DERIVED] between belt 0.53 and chudan 0.70 |
| 40 | `finger_curl_state` | enum {`fist`, `shuto` (open, thumb tucked), `open`} matches step's technique | exact match | — | mismatch = **fatal** | tradition |

#### Group G3 — Embusen & orientation (weight 0.12)

| # | metric id | formula | reference | tol | hard-fail | src |
|---|---|---|---|---|---|---|
| 41 | `facing_yaw_err_deg` | `yaw(pelvis) − step.facing_yaw_deg` | **0** | ±5 | ±15 | JKA: 45°/90°/180° turns are exact |
| 42 | `embusen_pos_err_H` | `|p[0]_xz − step.embusen_xz| / H` | **0.00** | ±0.06 (10.5 cm) | ±0.18 | [DERIVED] |
| 43 | `embusen_return_err_H` | `|p[0]_xz(last) − p[0]_xz(yoi)| / H` | **0.00** | **±0.06** | ±0.20 | JKA: finish where you started |
| 44 | `step_path_lateral_dev_H` | max lateral deviation of `p[0]` from the straight line between consecutive stance positions | **≤ 0.03** | +0.03 | +0.10 | [DERIVED]; note: the *feet* arc (`yori-ashi` crescent), the *pelvis* does not |
| 45 | `turn_pivot_foot_slip_H` | XZ drift of the pivot foot during a turn | **≤ 0.02** | +0.02 | +0.06 | [DERIVED] |

#### Group G4 — Timing & dynamics (weight 0.14)

| # | metric id | formula | reference | tol | hard-fail | src |
|---|---|---|---|---|---|---|
| 46 | `move_duration_s` | time from motion onset to kime onset | **0.45** (single technique), **0.60** (step + technique) | ±0.15 | ±0.35 | [DERIVED] from a 38 s / 21-move kata with holds |
| 47 | `kime_hold_s` | dwell with `|v_fist| < 0.05 H/s` | **0.28** | ±0.12 | ±0.30 | [DERIVED] |
| 48 | `kata_total_s` | yoi→last move | **38** | ±8 | ±16 | [DERIVED] from JKA Heian Shodan performance videos (~21 moves) — **weak, see §7** |
| 49 | `peak_fist_speed_Hps` | `max|v_fist| / H` during a punch | **4.5** H/s (≈7.9 m/s @H=175) | ±1.2 | ±2.5 | [DERIVED] from reported elite karate punch hand speeds 7–9 m/s |
| 50 | `kime_decel_time_s` | time from `peak_fist_speed` to `< 0.05 H/s` | **0.07** | ±0.04 | ±0.12 | [DERIVED] — this is what makes a punch look like karate rather than mime |
| 51 | `hip_lead_lag_s` | `t(peak pelvis yaw rate) − t(peak fist speed)` | **−0.06** (hips lead) | ±0.04 | sign inversion = **fatal** | [DERIVED] proximal-to-distal sequencing |
| 52 | `accel_profile_skew` | `t(peak accel) / move_duration` | **0.30** (front-loaded, explosive) | ±0.12 | ±0.30 | [DERIVED]; 0.5 = linear/robotic |
| 53 | `double_support_frac` | fraction of a step with both feet planted | **0.55** | ±0.15 | ±0.35 | [DERIVED] karate steps keep contact |
| 54 | `kiai_frame_alignment_s` | `t(kiai audio/anim cue) − t(kime onset)` | **0.00** | ±0.06 | ±0.20 | Heian Shodan kiai on moves 9 and 17 |

#### Group G5 — Rendering / integrity (weight 0.10) — cheap automated tripwires

| # | metric id | formula | reference | tol | hard-fail | notes |
|---|---|---|---|---|---|---|
| 55 | `foot_slide_Hps` | XZ speed of a *planted* foot | **0.000** | +0.010 H/s | +0.04 | the single most illusion-breaking bug |
| 56 | `ground_penetration_H` | `min(vertex.y)/H` over the foot mesh | **0.000** | −0.002 | −0.008 | |
| 57 | `float_gap_H` | `min(vertex.y)/H` of the lowest planted foot | **0.000** | +0.004 | +0.015 | |
| 58 | `self_intersection_count` | capsule-vs-capsule overlaps, limb pairs | **0** | 0 | ≥1 = **fatal** | |
| 59 | `bone_length_drift_pct` | `max` per-bone length deviation across the clip | **0 %** | ±0.5 % | ±2 % | catches bad IK / scale bugs |
| 60 | `silhouette_IoU` | IoU(our silhouette mask, reference envelope mask) per canonical camera, at kime frames | **≥ 0.86** | ≥0.82 | <0.70 = **fatal** | see §6.6 |
| 61 | `contact_shadow_present` | boolean: shadow-map darkening under the planted foot ≥ 30 % | **true** | — | false = major | AAA-look gate |

### 6.3 Scoring function (implement verbatim)

```
scoreMetric(value, ref, tol, hardFail):
    d = |value − ref|                       # for asymmetric tolerances use the signed branch
    if d <= tol:            s = 100
    elif d >= hardFail:     s = 0
    else:                   s = 100 * (1 − (d − tol) / (hardFail − tol))   # linear
    return s

scoreGroup(g) = Σ(w_i * s_i) / Σ(w_i)        # per-metric w_i = 1 unless the ref file overrides
scoreStep    = 0.34*G1 + 0.30*G2 + 0.12*G3 + 0.14*G4 + 0.10*G5
scoreKata    = mean(scoreStep over all steps)          # NOT min — but see gates
```

**Gates (a build "wins" only if all hold):**

| gate | condition |
|---|---|
| G-1 | `scoreKata ≥ 85` |
| G-2 | no metric flagged `fatal` anywhere in the kata |
| G-3 | `min(scoreStep) ≥ 70` — no single ugly step |
| G-4 | `G1 ≥ 80` and `G2 ≥ 80` on **every** step (stance and technique are non-negotiable) |
| G-5 | `Channel C` `PCK@0.030H ≥ 0.85` on at least 6 annotated PD reference postures |
| G-6 | Channel D critic reports **zero Tier-A** findings |

Report artefact: `artifacts/score/<git-sha>/scorecard.json` + `scorecard.md` (one row per metric per step, colour-coded), + `regression.json` diffing against the previous sha. Any metric that regresses > 5 points fails CI even if the gate still passes.

### 6.4 Per-kata reference values to seed (Heian Shodan, 21 moves)

Structural facts to encode in `heian-shodan.ref.json` (source: https://www.themartialway.com.au/heian-shodan/ , cross-checked https://www.shotokankarateonline.com/blog/heian-shodan-kata-tutorial/ , https://karate-notes.com/en/katas/heian-en/heian-shodan-en/):

| fact | value | tol |
|---|---|---|
| move count | 21 | exact |
| embusen shape | capital "I" in XZ | — |
| stance for moves 1–17 | zenkutsu-dachi | — |
| stance for moves 18–21 | kokutsu-dachi | — |
| 45° diagonal steps | on the two shuto-uke pairs (moves 18–19 and 20–21) | ±5° |
| kiai moves | 9 and 17 | exact |
| move 1 | hidari gedan-barai, yaw −90° (turn to the character's right) | ±5° |
| move 2 | migi chudan oi-zuki | — |
| move 9 | migi age-uke + kiai | — |
| move 21 | hidari chudan shuto-uke, kokutsu-dachi | — |

Also seed Taikyoku Shodan (20 moves, pure gedan-barai + chudan oi-zuki, "I" embusen) as the smoke-test kata: every step uses only metrics 1–32, so it validates the whole pipeline with two techniques.

### 6.5 Channel A run procedure

1. Deterministic playback: fixed timestep `1/120 s`, seed all noise, `renderer.setAnimationLoop` replaced by a manual stepper.
2. Sample joint world matrices at: (a) every `kime` frame (the authoritative pose), (b) 8 evenly spaced frames per move for G4/G5.
3. Compute all metrics in a pure module `src/eval/metrics.js` with **no three.js dependency** beyond `Vector3`/`Quaternion` — so it is unit-testable and reusable by the overlay generator.
4. Emit JSON; render Markdown; exit non-zero if a gate fails.

### 6.6 Channel B — reference silhouette / stick-figure overlay (spec)

Purpose: a *visual* diff that is entirely our own IP, generated from the same reference numbers.

| item | spec |
|---|---|
| reference figure construction | FK the canonical 25-joint skeleton with segment lengths from §0.2 at `H = 1`, then solve the `targets` of each step by analytic IK (2-bone closed form for each limb) → deterministic reference pose. No mocap, no external asset. |
| draw style | stick figure: bones = 3 px rounded lines; joints = 7 px dots; plus a filled "envelope" = capsule sweep per bone at radius `0.028H` (limbs) / `0.075H` (torso) / `0.065H` (head) |
| colours | reference `#FF2D55` @ 0.55 alpha lines, @ 0.18 alpha envelope fill; ours `#0A84FF` for the wireframe pass; agreement zones render purple |
| overlay alignment | translate so `Hips` coincide; **no rotation, no scale** (we must match orientation and size on our own). Also emit a second, Procrustes-aligned variant labelled "shape only". |
| cameras (canonical, fixed forever) | `CAM_FRONT` ortho, at `(0,0.5H,+3H)` looking `−Z`; `CAM_LEFT` ortho at `(+3H,0.5H,0)`; `CAM_RIGHT` ortho at `(−3H,0.5H,0)`; `CAM_TOP` ortho at `(0,4H,0)` looking down, up = `−Z`; `CAM_HERO` perspective 35 mm-equiv (`fov 39.6°`) at `(1.6H,0.95H,2.2H)` targeting `(0,0.55H,0)`. **Ortho for all measurement cameras** — perspective foreshortening corrupts every length metric read off an image. |
| ortho frustum | `height = 2.2H`, aspect 1:1, near `0.1H`, far `10H` — identical for reference and our render |
| output | per kime frame, per camera: a 4-panel PNG strip `1024×1024` each → `[ours | reference stick | overlay | abs-diff heatmap]`, written to `artifacts/compare/<sha>/step-<NN>-<cam>.png`; plus a `contact-sheet.png` (all steps, `CAM_FRONT` + `CAM_LEFT`) and `metrics.html` with the numbers under each thumbnail |
| silhouette masks for metric 60 | render both figures with `MeshBasicMaterial` white on black, no lights, no shadows; `IoU = |A∩B| / |A∪B|` on the binary masks |
| floor trace panel | top-down XZ plot: reference embusen polyline + our actual `Hips` XZ track + per-step markers, same 1024² canvas — this is the embusen scorecard made visible |

### 6.7 Channel C — public-domain photograph reprojection (the only *real-human* ground truth we may keep)

Fully licensed because the inputs are the PD 1925 Funakoshi photographs (§2.1).

1. **Acquire** the 16 `Gichin Funakoshi - Heian Nidan (*).png` files from Wikimedia Commons. Store under `assets/reference/pd-1925/` **with** `PROVENANCE.md` recording file name, Commons URL, licence tag (`PD-Japan-oldphoto`, `PD-1996`), original source (*Rentan Goshin Karate Jutsu*, 1925-03-10) — they are PD, so shipping them in the About/Reference panel is allowed.
2. **Annotate** 17 2-D joints per image (subset of §0.3: Hips, Spine1, Neck, Head, L/R Shoulder, Elbow, FistCenter, Hip, Knee, Ankle) → `assets/reference/pd-1925/<file>.joints.json` as `{ "img_px": [w,h], "H_px": <vertex-to-floor pixels>, "joints": { "Hips": [x,y], ... }, "occluded": ["RightElbow"] }`.
3. **Normalise**: `p̂ = (p − p_Hips) / H_px`, with image `y` flipped so `+y` is up. Now scale- and translation-free, in units of body height — directly comparable to §6.2.
4. **Match the camera**: these are ~waist-height, near-orthographic studio plates. Estimate azimuth `θ` by minimising `|(shoulder_width_obs/H_px) − 0.259·cos θ|` and lock elevation to 0°; render `CAM_FRONT` rotated by `θ`.
5. **Metrics** (Channel C only):
   | id | formula | target | gate |
   |---|---|---|---|
   | `mpjpe2d_H` | `mean‖p̂_ours − p̂_ref‖` over non-occluded joints | ≤ **0.025 H** (4.4 cm) | ≤ 0.040 H |
   | `pck_H` | fraction of joints with `‖Δ‖ ≤ 0.030 H` (5.25 cm) | ≥ **0.90** | ≥ 0.85 |
   | `limb_angle_mae_deg` | MAE of the 12 2-D limb-segment angles | ≤ **7°** | ≤ 12° |
   Thresholds are the H-normalised analogue of the standard 3D-PCK@150 mm convention (150 mm ≈ 0.086 H — we are deliberately ~3× stricter because we control both renders).
6. **Era caveat, mandatory:** 1920s Shuri-te postures are **shallower and more upright** than modern JKA. Use Channel C to validate *topology* (limb configuration, hikite existence, forearm angles, head direction, weight side) and use §6.2 for *stance depth*. Do **not** optimise `stance_len_H` toward the 1925 photographs — you will make the character look like pre-war karate, not JKA.

### 6.8 Channel D — harsh critic rubric (what to look for, ranked by how badly it breaks the illusion)

Critic runs on **our frames only** (`artifacts/compare/**`), never on third-party media. The critic may consult copyrighted video *in their own viewing session*; only numbers and prose notes may return to the repo. Output format: `{tier, metric_id|null, step, camera, observation, suggested_fix}`.

**Tier A — fatal, a karateka spots it in under one second (any single one = build fails)**

| # | tell | linked metric | why it kills |
|---|---|---|---|
A1 | planted foot slides / ice-skates | 55 | destroys ground truth; reads as "video-game placeholder" |
A2 | limbs interpenetrate the torso | 58 | breaks physicality |
A3 | dead pelvis — punches with no hip rotation | 11, 51 | this is the difference between karate and "throwing arms" |
A4 | no kime — technique decelerates smoothly instead of snapping and holding | 47, 50, 52 | reads as tai chi or mime |
A5 | missing/wrong hikite (retracting hand) | 28 | the single most recognisable Shotokan signature |
A6 | stance too shallow / hips too high | 1, 6 | reads as "person cosplaying karate" |
A7 | rear heel lifted in zenkutsu-dachi | 10 | first thing every instructor corrects |
A8 | head does not lead the turn; eyes not on the target | 16 | makes it look like a puppet |
A9 | constant-velocity / linear interpolation between poses | 52 | the classic "keyframe smell" |
A10 | left/right mirrored technique (hidari↔migi) | §0.1 handedness | wrong kata entirely |
A11 | foot floats above / sinks into the floor | 56, 57 | |
A12 | both arms move symmetrically and simultaneously with equal speed | 51 | no proximal-to-distal chain |

**Tier B — major, breaks it on a second look**

B1 knee collapses inward (valgus) / knee not over the instep (5) · B2 wrist bent at impact (22) · B3 shoulders shrugged toward the ears (29) · B4 punch off the centreline (19) · B5 elbow locked/hyperextended (20, 21) · B6 elbow flares outward during oi-zuki · B7 torso leaning into the punch (13) · B8 gi/cloth completely rigid — no secondary motion at kime · B9 no anticipation/settle before an explosive move (52) · B10 hips bob vertically while stepping (17) · B11 turns are exactly linear in yaw with no head-first sequencing · B12 hand shape wrong for the technique (shuto not formed, thumb not tucked) (40) · B13 the two kiai moments (9, 17) are visually indistinguishable from neighbours (54) · B14 no ground-contact shadow / character reads as pasted onto the floor (61) · B15 identical timing on every move — no phrasing.

**Tier C — polish, decides "good demo" vs "AAA"**

C1 fingers not curled / thumb over the index-middle knuckles · C2 toes not gripping the floor · C3 embusen drift ≥ 0.06 H (43) · C4 no micro-settle (2–4 frame overshoot-and-return) at the end of each technique · C5 breathing absent from the torso between moves · C6 gi sleeve does not snap at kime · C7 no dust/contact cue on hard stance transitions · C8 flat, single-source lighting; no rim light separating the gi from the background · C9 shadow contact mushy (needs contact-hardening or SSAO) · C10 camera orbit has no ease or parallax interest · C11 belt (obi) ends static · C12 skin/gi material has no sheen variation · C13 no subtle asymmetry — perfect bilateral symmetry reads synthetic.

**Critic prompt template (for a VLM critic):**
> You are a 5th-dan JKA examiner grading a 3D animation. Look at the 4-panel strip. Panel 1 is the candidate render; panel 2 is the geometric reference; panel 3 is the overlay. For step `<N>` (`<technique name>`, `<stance>`): list every deviation you can see, each tagged Tier A/B/C using the rubric IDs, with the specific joint and the direction of error. Do not praise. Do not describe what is correct. If you find no Tier-A issue, say `TIER-A: NONE` explicitly.

### 6.9 What we must never do

| forbidden | reason |
|---|---|
| download / commit / bundle frames from JKA, SKIF, WKF, KarateByJesse, or any YouTube video | all rights reserved; YouTube ToS prohibits downloading |
| run a pose estimator over a copyrighted kata video and commit the resulting per-frame joint tracks | the tracks are a machine-readable derivative of the performance; legally contested. **If used at all:** transient, local, never committed, and only aggregate scalars (e.g. "mean move duration 0.46 s") written back, with provenance recorded. Treat as `LEGAL-RISK: HIGH` and get a human decision first. |
| embed the CC BY-SA Commons embusen SVG/JPG | share-alike would attach to our asset/page |
| ship `heian.nidan.bvh` from RMoCap | GPL-3 |
| ship AMASS / HumanML3D / Human3.6M / Bandai-Namco in any form | non-commercial / academic-only licences |
| ship raw Mixamo FBX/glTF as downloadable assets | Adobe forbids redistribution of the raw files |
| omit the CMU acknowledgement if any CMU-derived motion ships | licence condition |

---

## 7. Uncertainties

1. **`stance_len_H` for zenkutsu-dachi — sources genuinely disagree, not averaged silently.** themartialway.com.au and Wikipedia's *Front stance* say "two shoulder widths long, one shoulder width wide" → `0.518H` length, `0.259H` width. shotokankarateonline.com says "one shoulder width and a half" → `0.389H`, width "hip to shoulder width" → `0.191–0.259H`. My seeded `0.45H ± 0.05` is a midpoint compromise and is **not** sourced to any single authority. It also conflicts with my own `stance_width_H = 0.14H`, which is narrower than every worded source; I chose it because heel-to-heel width in JKA zenkutsu-dachi is visibly *less* than a shoulder width in photographs, and the worded "one shoulder width wide" most likely describes the *hip/foot placement envelope*, not heel-to-heel separation. **A human instructor must settle both numbers before the scorecard is trusted.**
2. **`weight_front_pct`.** The Tohoku force-plate study compares measured values to "postulated" 60/40 for zenkutsu-dachi and reports no significant difference; shotokankarateonline teaches 70/30. Kokutsu-dachi is taught as 70/30 rear-loaded by some dojo and 80/20 by others. I could not open the full PDF (binary extraction failed), so I have **not** verified the study's means/SDs, subject count (reported as nine male black belts in a secondary summary), or which stances differed significantly. Seeded `62 ± 8` deliberately spans 60 and 70 at the tolerance edge. **Re-read that PDF locally.**
3. **`kata_total_s = 38 ± 8`.** Derived from typical JKA performance-video lengths, not from any published tempo standard. JKA does not publish a metronome tempo. Any timing-based gate (46–48) is the weakest part of the scorecard.
4. **`peak_fist_speed_Hps = 4.5`.** Converted from "elite karate punch hand speed 7–9 m/s" in the general biomechanics literature, which I did not verify against a primary paper in this pass. A kata punch is also not a maximal-effort punch; the real value may be 20–30 % lower.
5. **CMU martial-arts trials unverified.** `mocap.cs.cmu.edu` failed TLS verification from this environment (`unable to verify the first certificate`), so I could not enumerate subject/trial IDs. Secondary sources state martial arts is a category. **Do not plan on specific CMU trials until someone browses the subject list.**
6. **CMU licence text is second-hand.** The wording quoted in §3 comes from mirrors (academictorrents listing, search index) rather than the canonical page. It has been consistent across two independent mirrors, but confirm on the source page before shipping the acknowledgement.
7. **InfoMus karate dataset licence is unknown, not CC BY.** `infomus.org` / `casapaganini.org` refused connections on 2026-07-31. The CC BY 4.0 claim came from a search-result summary. This is the *most valuable* dataset for us (real Shotokan kata at 250 Hz, 25 markers) and the *least* verified. Contact Casa Paganini directly.
8. **Kyokushin figshare per-item licence unverified** (figshare returned 403). Scientific Data's article licence (CC BY 4.0) does **not** automatically govern the deposited files.
9. **GPL-3 applied to a BVH data file is legally murky.** Whether `heian.nidan.bvh` is a "work based on the Program" or mere aggregated data is arguable. I recommend the conservative reading (do not ship) rather than relying on the aggregation exception.
10. **PD-Japan-oldphoto has a trap.** If a Funakoshi photograph was also published in the US within 30 days of Japanese publication, US copyright may survive. Commons itself flags this. Low probability for 1925 Okinawan/Japanese imprints, but not zero.
11. **My photograph-vs-drawing split for *Karate-do Kyohan* (1935) is engineering analysis, not a legal opinion.** The conclusion (photos PD, drawings/text US-restricted until 2031-01-01) depends on URAA restoration mechanics and on each image genuinely being a photograph. Do not use 1935 line art.
12. **Silhouette IoU thresholds (0.86 target / 0.82 gate / 0.70 fatal) are invented**, calibrated by intuition about capsule-envelope overlap at `radius 0.028H`. They must be re-tuned on the first real contact sheet — expect the envelope radii, not the IoU threshold, to be wrong first.
13. **Channel C camera-azimuth estimation is under-determined.** Solving `θ` from observed shoulder width alone has a sign ambiguity and is corrupted by any torso twist. Prefer 2 constraints (shoulder line + hip line) and accept `±10°`; treat Channel C as a topology check, not a precision instrument.
14. **The coordinate convention handed down for this project is left-handed** (§0.1). I preserved it for cross-document consistency and specified a single-point fix, but if another agent silently assumed right-handed `+X = right`, half the kata will mirror. This needs a project-wide decision, one assertion test, and a note in every research doc.
15. **Anthropometric proportions are population averages** from Drillis & Contini (1966), a 1960s US-centric dataset. Every `[DERIVED]` height (chudan `0.700H`, hikite `0.620H`, gedan-barai fist `0.345H`, etc.) inherits that bias, and a karateka's proportions (and the artistic choice of a 7.7-head figure) will shift them by a few cm.
16. **No open-source three.js kata visualiser exists to benchmark against** — so the "closest available visual implementation" is, realistically, copyrighted JKA video that we may not redistribute. Channels A–C are the substitute. If the user insists on a literal picture-beside-picture against JKA footage, that comparison must happen in a human's browser session and only the resulting notes/scores may enter the repo.
17. **Metrics 33–39 (age-uke, shuto-uke, tettsui) reference values are entirely `[DERIVED]`** from anthropometry plus worded tradition ("one fist above the forehead", "forearm at 45°"). They have no numeric authority behind them and are the most likely values a knowledgeable critic will dispute.
18. **The 0.34/0.30/0.12/0.14/0.10 group weights are a judgement call**, chosen so stance + technique dominate. They are not derived from how human judges score kata (WKF scoring is holistic and does not decompose this way).
