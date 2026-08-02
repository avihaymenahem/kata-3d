# 06 — Procedural Humanoid Rig, IK, and Cloth (Karate-Gi)

Machine-actionable build spec. Target: procedurally generated karateka (no downloaded character asset), three@0.185.1, 60 fps.
Status: research complete 2026-07-31. All `[DERIVED]` rows are computed/assumed by this document, not quoted from a source.

---

## 0. Conventions (NORMATIVE — all downstream code must honor)

| id | value | notes |
|---|---|---|
| coord.handedness | right-handed | `X × Y = +Z` |
| coord.up | `+Y` | |
| coord.facing_at_yoi | `-Z` | character's nose points down −Z |
| coord.character_left | `+X` | so `+Z` = character's **back** |
| coord.embusen_plane | XZ | floor `y = 0` |
| coord.units | metres | `1.0` scene unit = 1 m |
| H | 1.75 | m — reference stature. All lengths below given as fraction of H **and** cm at H=175 |
| M | 70.0 | kg — reference body mass (BMI 22.9, athletic male) |
| angle.units | degrees in tables, radians in code | |
| rot.order | intrinsic ZXY per bone unless stated | three.js `Euler` order `'ZXY'` for clamping |
| rot.sign | right-hand rule about the stated axis | |
| bind.pose | **A-pose, 45° shoulder abduction** (§3.1) | generation happens in T-pose then re-baked |
| dt.visual | 1/60 s = 16.667 ms | |
| dt.substep | 1/480 s = 2.083 ms | n_sub = 8, see §6.5 |

Bone-local axis convention (NORMATIVE): every bone's rest local quaternion is **identity**; direction is encoded purely in the child's offset vector. Consequences:
- Left-arm chain primary axis = `+X`; right-arm chain primary axis = `−X`.
- Leg chain primary axis = `−Y`. Spine/neck chain primary axis = `+Y`.
- "Twist" for a bone = rotation about its own primary axis.

---

## 1. Anthropometry — segment lengths

### 1.1 Primary table (joint-centre → joint-centre). USE THIS FOR THE RIG.

Source: de Leva 1996, Table 4, **male** column (sample n=100, mass 73.0 kg, stature 1.741 m), which re-references Zatsiorsky–Seluyanov gamma-scanner data to joint centres. Fractions = de Leva mm ÷ 1741 mm.
`https://ebm.ufabc.edu.br/wp-content/uploads/2013/12/Leva-1996.pdf` · `https://wiki.has-motion.com/doku.php?id=visual3d:documentation:definitions:adjusted_zatsiorsky-seluyanov_s_segment_inertia_parameters`

| param | endpoints | frac H | cm @H=175 | tol | src |
|---|---|---|---|---|---|
| len.head | vertex → mid-gonion | 0.1168 | 20.44 | ±3% | de Leva T4 |
| len.head_alt | vertex → cervicale | 0.1395 | 24.42 | ±3% | de Leva T4 alt |
| len.trunk | suprasternale → mid-hip | 0.3055 | 53.46 | ±3% | de Leva T4 |
| len.trunk_alt | cervicale → mid-hip | 0.3465 | 60.64 | ±3% | de Leva T4 alt |
| len.trunk_upper (UPT) | suprasternale → xyphion | 0.0981 | 17.16 | ±5% | de Leva T4 |
| len.trunk_mid (MPT) | xyphion → omphalion | 0.1238 | 21.66 | ±5% | de Leva T4 |
| len.trunk_low (LPT) | omphalion → mid-hip | 0.0837 | 14.65 | ±5% | de Leva T4 |
| len.upperarm | SJC → EJC | 0.1618 | 28.32 | ±3% | de Leva T4 |
| len.forearm | EJC → WJC | 0.1545 | 27.03 | ±3% | de Leva T4 |
| len.hand_to_mcp3 | WJC → 3rd metacarpale | 0.0495 | 8.66 | ±5% | de Leva T4 |
| len.hand_full | stylion → 3rd dactylion | 0.1091 | 19.09 | ±3% | de Leva T4 alt |
| len.thigh | HJC → KJC | 0.2425 | 42.44 | ±3% | de Leva T4 |
| len.shank | KJC → lat. malleolus | 0.2493 | 43.62 | ±3% | de Leva T4 |
| len.shank_ajc | KJC → AJC | 0.2529 | 44.26 | ±3% | de Leva T4 alt |
| len.foot | heel → toe tip | **0.1520** | 26.60 | ±3% | D&C (see §1.5) |

### 1.2 Cross-check table (Drillis & Contini 1966 bony-landmark proportions)

Source: D&C via `https://pmc.ncbi.nlm.nih.gov/articles/PMC6928058/table/T1` and `https://www.openlab.psu.edu/design-tools-proportionality-constants/`

| D&C param | D&C frac H | de Leva equivalent | Δ | verdict |
|---|---|---|---|---|
| head height | 0.130 | 0.1168 (vertex→gonion) | — | different endpoints, not comparable |
| neck | 0.052 | — | — | D&C only |
| trunk | 0.288 | 0.3055 | +6.1% | de Leva includes suprasternale→shoulder-line |
| shoulder (acromion) height | **0.818** | derived 0.8180 | 0.0% | **agree** |
| upper arm (acromion→radiale) | 0.186 | 0.1906 derived | +2.5% | **agree**; SJC→EJC is 0.1618 (§1.5) |
| forearm (radiale→stylion) | 0.146 | 0.1444 | −1.1% | **agree** |
| hand | 0.108 | 0.1091 | +1.0% | **agree** |
| thigh | 0.245 | 0.2425 | −1.0% | **agree** |
| shank | 0.246 | 0.2493 | +1.3% | **agree** |
| ankle (foot) height | 0.039 | — | — | adopt 0.039 |
| foot length | 0.152 | 0.1483 | −2.5% | **disagree**, adopt 0.152 (§1.5) |
| foot breadth | 0.055 | — | — | adopt |
| shoulder width | 0.259 | — | — | **disputed**, see §1.4 |
| hip width | 0.191 | — | — | adopt (bi-iliac) |

### 1.3 Derived bind-pose joint heights (closed kinematic chain) `[DERIVED]`

Built bottom-up from §1.1 lengths. **Every value cross-checks against an independent D&C height to ≤1.3%.**

| joint | frac H | cm @H=175 | D&C cross-check | Δ |
|---|---|---|---|---|
| floor | 0.0000 | 0.00 | — | — |
| AJC (ankle joint centre) | 0.0390 | 6.83 | 0.039 (ankle height) | 0.0% |
| KJC (knee) | 0.2883 | 50.45 | 0.285 (knee height) | +1.2% |
| HJC (hip) | 0.5308 | 92.89 | 0.530 (hip height) | +0.2% |
| MIDHIP (pelvis origin) | 0.5308 | 92.89 | — | — |
| omphalion (belt line) | 0.6145 | 107.5 | — | — |
| suprasternale | 0.8363 | 146.4 | — | — |
| SJC (shoulder) | 0.7982 | 139.7 | acromion 0.818 − 0.0198 | — |
| EJC (elbow) | 0.6364 | 111.4 | 0.630 (elbow height) | +1.0% |
| WJC (wrist) | 0.4820 | 84.35 | 0.485 (wrist height) | −0.6% |
| 3rd dactylion (fingertip) | 0.3729 | 65.26 | 0.377 (fingertip height) | −1.1% |
| cervicale (C7) | 0.8773 | 153.5 | — | — |
| AOJ (atlanto-occipital) | 0.9180 | 160.7 | ear-canal height ≈0.914 | +0.4% |
| vertex | 1.0000 | 175.0 | 1.000 | 0.0% |

### 1.4 Breadths, widths, rig lateral offsets

| param | frac H | cm @H=175 | tol | src |
|---|---|---|---|---|
| brd.biacromial | 0.226 | 39.55 | ±5% | ANSUR-consistent; D&C says 0.259 (disputed, §Uncertainties) |
| brd.bideltoid | 0.280 | 49.00 | ±6% | `[DERIVED]` athletic-male norm |
| brd.chest | 0.174 | 30.45 | ±5% | D&C |
| dep.chest (A-P) | 0.115 | 20.13 | ±8% | `[DERIVED]` |
| brd.waist | 0.154 | 26.95 | ±8% | `[DERIVED]` (80 cm circumference) |
| brd.hip (bi-iliac) | 0.191 | 33.43 | ±5% | D&C; ANSUR 0.196 → agree |
| dep.hip (A-P) | 0.126 | 22.05 | ±8% | `[DERIVED]` |
| brd.foot | 0.055 | 9.63 | ±5% | D&C |
| **rig.SJC.x** | **±0.098** | ±17.15 | ±6% | `[DERIVED]`: SJC 2.6 cm medial to acromion (de Leva T2: SJC 34.5 mm distal to acromion) |
| **rig.HJC.x** | **±0.050** | ±8.75 | ±6% | `[DERIVED]`: inter-HJC 17.5 cm, standard adult-male value |
| rig.SCjoint.x (sternoclavicular) | ±0.011 | ±1.93 | ±20% | `[DERIVED]` |
| rig.eye.x | ±0.0175 | ±3.06 | ±10% | `[DERIVED]` interpupillary 6.1 cm |

### 1.5 Landmark-vs-joint-centre reconciliation (READ THIS BEFORE CODING)

The apparent D&C/de Leva "disagreements" are **not** measurement error; they are different endpoints. Do not average them.

| pair | relation | numbers |
|---|---|---|
| upper arm | acromion is lateral+superior to SJC | acromion→radiale 0.1906 H; SJC is **19.8 mm** (0.0114 H) distal to acromion; EJC is **15.5 mm** (0.0089 H) proximal to radiale ⇒ SJC→EJC = 0.1906 − 0.0114 − 0.0089 ≈ **0.1618 H** ✔ closes exactly |
| forearm | EJC proximal to radiale | radiale→stylion 0.1444 H + 0.0089 H = 0.1533 H (de Leva alt row 0.1533 ✔) |
| foot | D&C 0.152 H vs de Leva 0.1483 H | de Leva sample = Russian; ANSUR US-male foot length 26.9 cm @175.6 cm ⇒ 0.153 H. **Adopt 0.152 H.** WARNING: de Leva's foot radius-of-gyration % is relative to *his* 0.1483 H foot; rescale r by 0.1483/0.152 = 0.9757 if you use 0.152 H. |

---

## 2. Anthropometry — mass, COM, inertia

Source: de Leva 1996 Table 4, male column. Masses are % body mass; COM positions are % of the **segment length from §1.1** measured from the proximal/cranial endpoint.

| segment | mass % | kg @M=70 | COM % from proximal | r_sagittal % | r_transverse % | r_longitudinal % |
|---|---|---|---|---|---|---|
| head (vertex→gonion) | 6.94 | 4.858 | 59.76 | 36.2 | 37.6 | 31.2 |
| trunk whole (suprasternale→midhip) | 43.46 | 30.422 | 44.86 | 37.2 | 34.7 | 19.1 |
| ↳ upper trunk UPT | 15.96 | 11.172 | 29.99 | 71.6 | 45.4 | 65.9 |
| ↳ mid trunk MPT | 16.33 | 11.431 | 45.02 | 48.2 | 38.3 | 46.8 |
| ↳ lower trunk LPT | 11.17 | 7.819 | 61.15 | 61.5 | 55.1 | 58.7 |
| upper arm (×2) | 2.71 | 1.897 | 57.72 | 28.5 | 26.9 | 15.8 |
| forearm (×2) | 1.62 | 1.134 | 45.74 | 27.6 | 26.5 | 12.1 |
| hand (×2) | 0.61 | 0.427 | 79.00 | 62.8 | 51.3 | 40.1 |
| thigh (×2) | 14.16 | 9.912 | 40.95 | 32.9 | 32.9 | 14.9 |
| shank (×2) | 4.33 | 3.031 | 44.59 | 25.5 | 24.9 | 10.3 |
| foot (×2) | 1.37 | 0.959 | 44.15 | 25.7 | 24.5 | 12.4 |
| **Σ (head+trunk+2×limbs)** | **100.00** | **70.000** | — | — | — | — |

Moment of inertia: `I_axis = (M · m_frac) · (L_segment · r_axis)²` — de Leva 1996 eq. for I.
UPT + MPT + LPT masses sum to 43.46 = whole trunk ✔. Use the 3-part trunk when you need believable spine-driven weight shift; use whole trunk for a cheap COM.

### 2.1 Whole-body COM at bind pose `[DERIVED]`

Computed as `Σ m_i y_i` with §1.3 heights and the COM % above.

| segment | m_frac | COM y (frac H) | m·y |
|---|---|---|---|
| head | 0.0694 | 0.9302 | 0.06456 |
| trunk | 0.4346 | 0.6989 | 0.30375 |
| upper arms ×2 | 0.0542 | 0.7048 | 0.03820 |
| forearms ×2 | 0.0324 | 0.5658 | 0.01833 |
| hands ×2 | 0.0122 | 0.4429 | 0.00540 |
| thighs ×2 | 0.2832 | 0.4312 | 0.12212 |
| shanks ×2 | 0.0866 | 0.1769 | 0.01532 |
| feet ×2 | 0.0274 | 0.0210 | 0.00058 |
| **COM_y** | | | **0.5683 H = 99.4 cm** |

Literature range for standing male whole-body COM = 0.55–0.57 H ⇒ **internally consistent, use as a unit test** (`assert |COM_y/H − 0.568| < 0.008` at bind pose).

### 2.2 Support-polygon / weight-distribution relation (NORMATIVE)

Stance weight distributions from doc 02/03 are **vertical force splits**. For a static pose the COM's horizontal position divides the inter-foot line **inversely**:

```
front foot bears f (e.g. 0.70)  ⇒  COM_xz = P_front + (1 - f) * (P_rear - P_front)
```
i.e. 70/30 zenkutsu-dachi ⇒ COM sits **30 %** of the way from the front contact centroid to the rear. Do not put the COM at 70 %.

Pelvis-solve for COM targeting `[DERIVED]`:
```
for k in 0..2:                                # 3 iterations
    e  = COM_xz(currentPose) - target_xz
    pelvis.position.xz -= 0.90 * e            # gain 0.90; ∂COM/∂pelvis ≈ 0.89
    solveFootIK()                             # feet stay planted
    if |e| < 0.002 * H: break                 # 0.35 cm tolerance
```
Gain justification: mass below the pelvis that does **not** translate with it once feet are pinned ≈ shanks + feet + ~½ thighs ≈ 0.11 of M, so `∂COM/∂pelvis ≈ 0.89`; a gain of `1/0.89 = 1.12` is exact but unstable, `0.90` converges monotonically in ≤3 iterations.

---

## 3. Joint range of motion (CLAMP TABLE)

`aaos` = AAOS goniometry norms via `https://goniometer.io/range-of-motion` (cross-checked against Physiopedia normative values, which 403s to bots but agrees on shoulder 180/60/180, elbow 150, knee 135).
`anat` = in-vivo spine ROM via `https://www.anatomystandard.com/biomechanics/spine/rom-of-spine.html`.
`kata` = the clamp this project ships. Karate practitioners show ≥ population-normal hip flexion (`https://pubmed.ncbi.nlm.nih.gov/17530951/`) but **reduced** hip-abductor extensibility in kata specialists — so we widen flexion/rotation and do NOT widen abduction.

### 3.1 Per-joint limits

Axes are in the bone's local frame (§0). `flex+` = the anatomical direction named.

| bone | dof | axis | anatomical | aaos | kata clamp | notes |
|---|---|---|---|---|---|---|
| hip (thigh) | flex/ext | X | flexion + | 120 / 30 | **+125 / −25** | 120 needed for hikite-side knee lift in mae-geri |
| hip | abd/add | Z | abduction + | 45 / 30 | **+48 / −28** | kiba-dachi needs ~40° combined |
| hip | int/ext rot | Y | ext.rot + | 45 / 45 | **+50 / −42** | kokutsu rear foot needs 45–50° ER |
| knee (calf) | flex | X | flexion − | 135 / 0 | **0 / −140** | hyperextension **hard-locked at 0**; −140 for heisoku/kneel |
| knee | int/ext rot | Y | — | ±5 (tibial, at 90° flex) | **±8** | only unlock above 30° flexion |
| ankle (foot) | dorsi/plantar | X | dorsiflexion + | 20 / 50 | **+24 / −55** | 24° DF needed for deep zenkutsu front ankle |
| ankle | inv/ev | Z | inversion + | 35 / 15 | **+30 / −14** | subtalar; clamp tighter than AAOS to stop foot-roll popping |
| ankle | abd/add | Y | — | ±10 | **±12** | |
| ball (toe) | flex/ext | X | extension + | ~70 / 30 | **+65 / −25** | MTP; 65° needed for koshi/ball-pivot |
| spine_01 (L5–L3) | flex/ext | X | | — | **+32 / −16** | |
| spine_01 | lat.flex | Z | | — | **±15** | |
| spine_01 | axial rot | Y | | — | **±6** | lumbar rotation is tiny (anat: 15.3° total) |
| spine_02 (L2–T11) | flex/ext | X | | — | **+33 / −15** | |
| spine_02 | lat.flex | Z | | — | **±15** | |
| spine_02 | axial rot | Y | | — | **±9** | |
| spine_03 (T10–T5) | flex/ext | X | | — | **+13 / −11** | |
| spine_03 | lat.flex | Z | | — | **±15** | |
| spine_03 | axial rot | Y | | — | **±24** | thoracic is the rotation engine |
| chest (T4–T1) | flex/ext | X | | — | **+13 / −11** | |
| chest | lat.flex | Z | | — | **±15** | |
| chest | axial rot | Y | | — | **±23** | |
| **Σ thoraco-lumbar** | | | | | **+91 / −53 flex/ext, ±60 lat, ±62 rot** | anat totals: 91/53, 60 lat, 62.3 rot ✔ **exact match by construction** |
| neck_01 | flex/ext | X | | 45/45 | **+30 / −30** | |
| neck_01 | lat.flex | Z | | 45 | **±25** | |
| neck_01 | axial rot | Y | | 60 | **±40** | |
| head | flex/ext | X | | | **+25 / −25** | |
| head | lat.flex | Z | | | **±20** | |
| head | axial rot | Y | | | **±30** | |
| **Σ cervical** | | | | 45/45/45/60 | **55/55, ±45, ±70** | anat in-vivo 64/63/49/85 — see §Uncertainties |
| clavicle | elev/depr | Z | elevation + | — | **+24 / −8** | |
| clavicle | prot/retr | Y | protraction + | — | **+20 / −16** | hikite retraction |
| shoulder (upperarm) | flex/ext | X | flexion + | 180 / 60 | **+175 / −55** | |
| shoulder | abd/add | Z | abduction + | 180 / 40 | **+170 / −38** | |
| shoulder | int/ext rot | Y | ext.rot + | 90 / 70 | **+88 / −68** | |
| elbow (lowerarm) | flex | X | flexion − | 150 / 0 | **+3 / −152** | +3 allows the tiny hyperextension of a locked tsuki |
| forearm | pron/sup | X (own axis) | supination + | 80 / 80 | **+85 / −88** | **≥180° total is required** — hikite→tsuki rotates the fist ~180° |
| wrist (hand) | flex/ext | X | extension + | 70 / 80 | **+62 / −72** | |
| wrist | radial/ulnar dev | Z | radial + | 20 / 30 | **±22** | |
| eye | yaw | Y | | — | **±32** | |
| eye | pitch | X | | — | **+20 / −18** | |

### 3.2 Clamp implementation (NORMATIVE)

Clamping Euler triplets independently is wrong at gimbal-adjacent poses. Use **swing-twist** decomposition:

```
// q = bone local quaternion, a = bone primary axis (unit, §0)
function clampSwingTwist(q, a, swingConeDeg, twistMinDeg, twistMaxDeg, ellipseXZ) {
  // 1. twist part: projection of q onto the axis
  const p  = a.clone().multiplyScalar(q.x*a.x + q.y*a.y + q.z*a.z);   // vec part projected
  let qT   = new Quaternion(p.x, p.y, p.z, q.w).normalize();
  // 2. swing part
  const qS = q.clone().multiply(qT.clone().invert());   // q = qS * qT
  // 3. clamp twist angle
  let tw = 2 * Math.atan2(p.dot(a), q.w);               // signed radians about a
  tw = clamp(tw, twistMinDeg*DEG, twistMaxDeg*DEG);
  qT.setFromAxisAngle(a, tw);
  // 4. clamp swing to an ELLIPTIC cone (different limit per perpendicular axis)
  const axisS = new Vector3(); let angS = 0;            // from qS
  ...  angS = 2*Math.acos(clamp(qS.w,-1,1));
  const dir = axisS.normalize();                        // swing rotation axis ⟂ a
  const lim = ellipticConeLimit(dir, ellipseXZ);        // radians, see below
  if (angS > lim) qS.setFromAxisAngle(dir, lim);
  return qS.multiply(qT);
}
// ellipticConeLimit: with per-axis half-angles (bx, bz),
//   1/lim² = (cosφ/bx)² + (sinφ/bz)²,  φ = atan2(dir·ẑ_local, dir·x̂_local)
```
Cost: ~120 flops/bone × 44 bones = negligible.

---

## 4. Bone hierarchy

### 4.1 Rest-pose convention

**Generate in T-pose, ship an A-pose bind.**

| step | action |
|---|---|
| G1 | Build all geometry with arms along ±X, palms facing −Y, legs along −Y. Trivially parameterisable. |
| G2 | Compute skin weights in T-pose (distance fields are cleanest here — the arm is maximally separated from the ribs). |
| G3 | Set `upperarm_L/R` local rotation to −45°/+45° about Z (arms down to A-pose), and `clavicle` to −6° elevation. |
| G4 | CPU-skin the geometry once through the A-pose (LBS) and **overwrite** `geometry.attributes.position` / `.normal`. |
| G5 | `skeleton.calculateInverses(); mesh.bind(skeleton, mesh.matrixWorld)`. Bind pose = A-pose. |

Why A-pose bind wins for karate, quantified:
- Karate shoulder abduction range in kihon/kata ≈ 0°…120° (jodan-uke, shuto-uke). T-pose bind (90°) ⇒ max deviation from bind = 90°. A-pose bind (45°) ⇒ max deviation = 75°, and the **most-used** band (0–60°, all tsuki/gedan-barai) sits within ±45° instead of 30–90°.
- Deltoid/armpit vertices are the failure zone; LBS error grows ~`1 − cos(Δ/2)`. At Δ=90° → 29 % collapse; at Δ=45° → 8 %.
- T-pose is only "safer" when the animation range is symmetric about 90°, which karate's is not.

### 4.2 Explicit tree (44 core bones)

Offsets are **parent-local translations**, fraction of H, in T-pose generation space. Right side = mirror `x`. All rest local quaternions = identity.

```
root                                    (0,        0.0000,   0.0000)   world/embusen anchor, on the floor
└─ pelvis                               (0,       +0.5308,   0.0000)   origin = MIDHIP
   ├─ spine_01            (L5/S1)       (0,       +0.0600,  +0.0040)
   │  └─ spine_02         (L3/L2)       (0,       +0.0700,  -0.0020)
   │     └─ spine_03      (T11/T10)     (0,       +0.0700,  -0.0040)
   │        └─ chest      (T6/T5)       (0,       +0.0700,  -0.0040)
   │           ├─ neck_01 (C7/T1)       (0,       +0.0622,  -0.0040)
   │           │  └─ head (AOJ)         (0,       +0.0550,  +0.0060)
   │           │     ├─ head_end        (0,       +0.0820,  -0.0040)   leaf, = vertex
   │           │     ├─ eye_L           (+0.0175, +0.0165,  -0.0660)
   │           │     └─ eye_R           (-0.0175, +0.0165,  -0.0660)
   │           ├─ clavicle_L            (+0.0110, +0.0272,  -0.0390)   origin = SC joint
   │           │  └─ upperarm_L         (+0.0870, -0.0298,  +0.0350)   origin = SJC
   │           │     ├─ upperarm_twist_L(+0.0324,  0,        0     )   20 % along; carries 0.5×upperarm roll
   │           │     ├─ deltoid_L       (+0.0324, +0.0080,  0     )   helper, half-slerp clav↔upperarm
   │           │     └─ lowerarm_L      (+0.1618,  0,        0     )   origin = EJC
   │           │        ├─ lowerarm_twist_01_L (+0.0515, 0, 0)         33 % along; 0.33×hand roll
   │           │        ├─ lowerarm_twist_02_L (+0.1030, 0, 0)         67 % along; 0.67×hand roll
   │           │        └─ hand_L       (+0.1545,  0,        0     )   origin = WJC
   │           │           ├─ fingers_prox_L  (+0.0495, 0, 0)          all 4 fingers, one bone
   │           │           │  └─ fingers_dist_L (+0.0300, 0, 0)
   │           │           │     └─ fingers_end_L (+0.0295, 0, 0)      leaf, = dactylion
   │           │           └─ thumb_L   (+0.0150, -0.0042, -0.0190)
   │           │              └─ thumb_end_L (+0.0330, -0.0040, -0.0190)  leaf
   │           └─ clavicle_R  ... (mirror)
   ├─ thigh_L                           (+0.0500,  0.0000,   0.0000)   origin = HJC
   │  ├─ thigh_twist_L                  (0,       -0.0485,   0.0000)   20 % down; 0.5×thigh roll
   │  └─ calf_L                         (0,       -0.2425,   0.0000)   origin = KJC
   │     ├─ calf_twist_L                (0,       -0.1620,   0.0000)   65 % down; 0.5×foot yaw
   │     └─ foot_L                      (0,       -0.2493,   0.0000)   origin = AJC
   │        └─ ball_L                   (0,       -0.0192,  -0.0697)   origin = MTP
   │           └─ toe_end_L             (0,       -0.0098,  -0.0393)   leaf, = toe tip
   └─ thigh_R ... (mirror)
```

Chain-closure checks (unit tests): `upperarm→lowerarm = 0.1618` ✔ · `lowerarm→hand = 0.1545` ✔ · `hand→fingers_end = 0.1090` ✔ (= len.hand_full) · `thigh→calf = 0.2425` ✔ · `calf→foot = 0.2493` ✔ · heel(z=+0.0415)→toe_end(z=−0.1090) = `0.1505 ≈ 0.152` ✔.

Auxiliary landmarks (not bones, needed by cloth/foot IK): `heel_L = foot_L + (0, −0.0300, +0.0415)`, `toe_tip_L = ball_L + (0, −0.0098, −0.0393)`.

### 4.3 Bone-count justification (what we keep and why)

| feature | verdict | karate justification |
|---|---|---|
| 4 spine bones + pelvis | **KEEP** | UE4 uses 3, UE5 uses 5 (`https://dev.epicgames.com/documentation/en-us/unreal-engine/skeletons-in-unreal-engine`). 4 lets us give the thoracic segment the ±24° axial rotation and the lumbar only ±6–9°, matching the anat data. 3 forces lumbar over-rotation, which reads as a "rubber spine". |
| clavicles | **KEEP (mandatory)** | Hikite retracts the scapula; tsuki protracts it. Without clavicles the punch loses ~0.020 H (3.5 cm) of reach and the shoulders don't "pop" on kime. |
| scapula bones (separate from clavicle) | **SKIP** | Clavicle protraction/elevation with a deltoid helper covers 90 % of it; a real scapula bone needs a surface-glide constraint. |
| 2 forearm twist bones | **KEEP (mandatory)** | The tsuki fist rotation is ~180° of pronation. See §5.4 for the numeric candy-wrapper argument. |
| 1 upperarm twist bone | **KEEP** | Humeral internal rotation in soto-uke ≈ 70°. |
| deltoid helper | **KEEP** | Single biggest fix for armpit collapse in jodan positions. |
| thigh + calf twist | **KEEP** | Femoral ER in kokutsu-dachi ≈ 50°; without a twist bone the glute/inner-thigh candy-wraps. |
| toe/ball bones | **KEEP (mandatory)** | Every kata turn pivots on the ball or heel; kokutsu-dachi and neko-ashi-dachi require heel-off; the sole must not shear through the floor. |
| per-finger bones (15/hand) | **SKIP** | Not visible at kata-player framing. |
| 4 hand bones (`fingers_prox`, `fingers_dist`, `thumb`, + hand) | **KEEP** | Enough to blend **seiken** (fist), **shuto** (knife-hand), **open** (yoi) and **nukite**. Author 3 hand poses as local-quaternion sets and blend. |
| eyes | **KEEP** | Cheap (2 bones), and gaze direction is a strong "trained martial artist" tell. |
| separate obi/gi bones | **CONDITIONAL** | Only if the low-spec cloth path (§6) is active. |

### 4.4 three.js r185 verified facts (from `node_modules/three@0.185.1`)

| fact | evidence |
|---|---|
| **Max 4 bone influences per vertex, hard.** `skinIndex`/`skinWeight` are `Vector4`; `skinning_vertex.glsl.js` sums exactly 4 terms. | `src/renderers/shaders/ShaderChunk/skinning_vertex.glsl.js` |
| **No bone-count limit.** `WebGLRenderer.js:2654` calls `skeleton.computeBoneTexture()` whenever `skeleton.boneTexture === null` — the float-RGBA `DataTexture` path is always used. 44 bones is nowhere near a constraint. | `src/renderers/WebGLRenderer.js:2654`, `src/objects/Skeleton.js:243` |
| `mesh.normalizeSkinWeights()` exists — call it after weight computation. | `src/objects/SkinnedMesh.js:24038` |
| `mesh.applyBoneTransform(index, target)` gives the CPU-skinned position of a vertex — use for cloth pinning and for the A-pose re-bake (§4.1 G4). | `src/objects/SkinnedMesh.js:319` |
| `bindMode` ∈ `AttachedBindMode` \| `DetachedBindMode`. Use **Attached** (default). | `src/objects/SkinnedMesh.js:23845` |
| **Stock skinning is LBS only.** No DQS, no swing-twist. Any of those needs `material.onBeforeCompile` string surgery on `skinning_vertex`/`skinbase_vertex`, or a TSL NodeMaterial. | shader chunks above |

---

## 5. Skinning

### 5.1 Body-mesh generation — ranked approaches

| approach | build cost | vertex control | UV | topology risk | verdict |
|---|---|---|---|---|---|
| (A) capsule/limb **SDF union → surface nets / marching cubes** | 128³ grid ≈ 2.1 M samples, ~0.4–1.5 s in JS; 20–40 k tris | none — vertices land where the grid says | must be generated (hard; seam/atlas problem) | watertight guaranteed, but poles & valence are uncontrolled | **NO** as the shipping path. Keep as a *reference* for the visibility test in §5.3. |
| (B) per-limb **swept-ring tube / lathe** + stitched junctions | ~5 ms | total — put loops exactly at joints | free (u = around, v = along) | 3-way junctions (shoulder, hip) need explicit patches | **YES** for limbs, neck, torso |
| (C) **hybrid** = (B) for limbs/torso/neck + cube-sphere head + hand-authored quad patches at shoulder/hip + 2 iterations of junction-only Laplacian smoothing with ring vertices pinned | ~8 ms | total | free | none if patches are authored once | **SHIP THIS** |

Key budget insight: **the gi covers ~85 % of the body.** Only head, neck, hands, forearms (below the sleeve), feet and lower shins (below the trouser hem) are ever visible. Spend vertices accordingly.

| part | radial segs | rings | verts | visible? |
|---|---|---|---|---|
| torso (pelvis→shoulder line) | 32 | 16 | 512 | no (under gi) |
| neck | 20 | 5 | 100 | **yes** |
| head (cube-sphere, 6×10×10, welded) | — | — | ~590 | **yes** |
| upper arm | 20 | 8 | 160 | no |
| elbow cluster | 20 | 4 | 80 | partial |
| forearm | 20 | 8 | 160 | **yes (distal half)** |
| wrist | 20 | 3 | 60 | **yes** |
| hand + fingers block | 20 | 6 (+block) | ~200 | **yes** |
| thigh | 24 | 8 | 192 | no |
| knee cluster | 24 | 5 | 120 | no |
| shank | 24 | 8 | 192 | **yes (distal third)** |
| ankle | 24 | 3 | 72 | **yes** |
| foot | 24 | 6 | 144 | **yes** |
| **body total** | | | **≈ 3 900 verts / ~7 600 tris** | |
| **gi total** (§6.1) | | | **≈ 9 000 verts / ~17 000 tris** | |
| **grand total** | | | **≈ 13 000 verts / ~25 000 tris** | comfortable at 60 fps |

Limb radii (mesh generation input) `[DERIVED]` from athletic-male circumference norms:

| station | radius frac H | cm @H=175 | circumference cm |
|---|---|---|---|
| neck | 0.0346 | 6.06 | 38.0 |
| chest (elliptical) | 0.0870 × 0.0575 | 15.2 × 10.1 | ~100 |
| waist | 0.0770 × 0.0545 | 13.5 × 9.5 | ~80 |
| hip | 0.0955 × 0.0630 | 16.7 × 11.0 | ~95 |
| upper arm mid | 0.0291 | 5.09 | 32.0 |
| elbow | 0.0263 | 4.60 | 28.9 |
| forearm max (25 % down) | 0.0255 | 4.46 | 28.0 |
| wrist | 0.0159 | 2.78 | 17.5 |
| thigh mid | 0.0500 | 8.75 | 55.0 |
| knee | 0.0337 | 5.90 | 37.0 |
| calf max (30 % down) | 0.0337 | 5.90 | 37.0 |
| ankle | 0.0200 | 3.50 | 22.0 |
| head (ellipsoid rx,ry,rz) | 0.0443 × 0.0620 × 0.0557 | 7.75 × 10.85 × 9.75 | breadth 15.5, length 19.5 |

### 5.2 Extra loops at bending joints (NORMATIVE)

Rule: **4 edge loops per major flexing joint**, one exactly at the joint centre, spaced by `±0.35 × r_bone`, plus one on the distal side at `+0.70 × r_bone`.

| joint | r_bone frac H | loop positions relative to joint centre (frac H) | cm @H=175 |
|---|---|---|---|
| elbow (max flex 152°) | 0.0263 | −0.0092, 0.000, +0.0092, +0.0184 | −1.6, 0, +1.6, +3.2 |
| knee (max flex 140°) | 0.0337 | −0.0118, 0.000, +0.0118, +0.0236 | −2.1, 0, +2.1, +4.1 |
| wrist (max 72°) | 0.0159 | −0.0056, 0.000, +0.0056 | 3 loops enough |
| ankle (max 79° arc) | 0.0200 | −0.0070, 0.000, +0.0070, +0.0140 | |
| shoulder | 0.0291 | −0.0102, 0.000, +0.0102, +0.0204 | plus a deltoid cap ring at +0.030 |
| hip | 0.0500 | −0.0175, 0.000, +0.0175 | 3 loops + a groin gusset patch |
| MTP/ball (65° ext) | 0.0170 | −0.0060, 0.000, +0.0060 | |

Additional rule: on the **inner** (compressing) side of the elbow and knee, offset the two inner loops toward the joint by 25 % so that flexion produces a fold rather than an interpenetration.

### 5.3 Skin-weight computation — the shipping formula

Default path (deterministic, instant, no linear solve).

**Step 1 — point-to-segment distance.** For vertex `v` and bone `b` with bind-pose segment `A_b → B_b`:
```
t   = clamp( dot(v - A_b, B_b - A_b) / dot(B_b - A_b, B_b - A_b), 0, 1 )
p_b = A_b + t * (B_b - A_b)
d_b = |v - p_b|
```
Use the **segment**, never the infinite line (line distance makes the hip pull on the shoulder).

**Step 2 — visibility / interiority gate** (this is the step that prevents cross-limb bleeding; the same idea as Pinocchio's `H_ii = 0` rule, Baran & Popović 2007):
```
visible(v, b) = true  iff  the segment v→p_b does not exit the body volume
```
Cheap implementation: reject if the segment `v→p_b` intersects any *other* bone's collision capsule (§6.6) before reaching `p_b`, OR if `dot(normalize(p_b - v), n_v) > 0.25` (the closest point is on the outside of the surface at `v`).
Without this: the inner thigh gets weighted to the opposite thigh, and the medial forearm to the ribs. Non-negotiable.

**Step 3 — raw weight (bone-glow falloff).**
```
R_b  = kappa * r_b          # kappa = 2.6, r_b from §5.1 radius table
w̃_b = ( max(0, R_b - d_b) / R_b ) ^ p            if visible(v,b), else 0
p    = 3
```
Rationale for the exponents: `p = 2` bleeds across joints (a knee vertex gets non-zero weight from the hip); `p = 6` faceted the surface in tests of the same family of falloffs; `p = 3` with `kappa = 2.6` gives a blend band ≈ `1.3 × r_b` wide, i.e. ~7.7 cm at the knee — about 3 edge loops, which is exactly what §5.2 provides.

**Step 4 — prune to K = 4** (three.js hard limit, §4.4): keep the 4 largest `w̃`, zero the rest.

**Step 5 — normalize.**
```
w_b = w̃_b / Σ_{k ∈ top4} w̃_k        (if Σ == 0 → w = 1 on argmin d_b)
```
Then also call `mesh.normalizeSkinWeights()` as a belt-and-braces pass.

**Step 6 — Laplacian weight smoothing (5 iterations).** The single biggest quality lever; do not skip.
```
for it in 0..4:
    for each vertex v:
        for each of the 4 bones b of v:
            w_b'(v) = (1 - λ) * w_b(v) + λ * mean_{u ∈ N1(v)} w_b(u)     # λ = 0.35
    union-then-prune back to top 4, re-normalize
```
Use cotangent weights for `mean` if available; uniform 1-ring is acceptable for a regular quad grid.

**Step 7 — rigidify mid-limb.** For any vertex whose distance to the *nearest joint centre* exceeds `1.8 × r_b`, force `w = 1.0` on the single nearest bone. Prevents "noodle limbs" and cuts the average influence count from 3.4 to ~1.9 (faster, and stiffer where stiffness is correct).

**Optional quality bake — heat diffusion (Baran & Popović 2007 / Pinocchio).** Run once at load, cache to IndexedDB.
```
Solve per bone b:   (L + H) w_b = H χ_b
  L      = cotangent Laplacian, n×n sparse
  H      = diag(h_i),  h_i = c / d_i²  if the closest skeleton point is visible from v_i, else 0;  c = 1.0
  χ_b(i) = 1 if the closest bone to v_i is b, else 0
Solver: 40 Jacobi/CG iterations per bone (3 900 verts × 44 bones ≈ 0.3–1.0 s in JS)
```
Then run steps 4–5 (prune + normalize). Ship the analytic path as the default; expose the heat bake behind a quality flag.

### 5.4 Candy-wrapper and shoulder collapse — quantified fixes

**The exact cause, in one line.** A vertex at radius `r` blended 50/50 between two bone frames that differ by a twist of `θ` about the shared bone axis lands at radius `r · cos(θ/2)`. Volume loss `= 1 − cos(θ/2)`.

| twist across the blend band `θ` | radius retained | loss |
|---|---|---|
| 30° | 0.966 | 3.4 % |
| 45° | 0.924 | 7.6 % |
| 60° | 0.866 | 13.4 % |
| 90° | 0.707 | 29.3 % |
| 180° | 0.000 | 100 % (the "candy wrapper" pinch) |

**Fix 1 — twist-bone subdivision (SHIP THIS; no custom shader).**
The karate forearm must pronate ~180° (hikite supinated → tsuki pronated).

| forearm twist bones | max blend-band twist | volume loss |
|---|---|---|
| 0 (hand only) | 180° | 100 % — total pinch |
| 1 | 90° | 29 % |
| **2 (spec)** | **60°** | **13 %** |
| 2 + rigidify (§5.3 step 7) so the blend band is only 1 loop wide and each band spans ≤30° | **30°** | **3.4 % — invisible** |

Twist distribution (NORMATIVE), computed from the *child's* local twist `φ`:
```
lowerarm_twist_01.localTwist = 0.33 * φ_hand         // 33 % along the forearm
lowerarm_twist_02.localTwist = 0.67 * φ_hand         // 67 % along
upperarm_twist.localTwist    = 0.50 * φ_upperarm     // counter-spreads the deltoid
thigh_twist.localTwist       = 0.50 * φ_thigh
calf_twist.localTwist        = 0.50 * φ_foot_yaw
```
where `φ_hand` is the twist component of `hand.quaternion` about `+X` (extracted via the swing-twist split of §3.2).

**Fix 2 — swing-twist skinning (optional, needs shader surgery).** Beats DQS: no joint bulging.
```
// per bone b (CPU, once per frame): split world delta rotation into swing S_b and twist angle φ_b about axis a_b
// per vertex (GPU):
float phi = w0*phi0 + w1*phi1 + w2*phi2 + w3*phi3;         // SCALAR average -> zero volume loss
mat4  Ms  = w0*S0 + w1*S1 + w2*S2 + w3*S3;                 // swing is small, linear blend is fine
vec3  a   = normalize(w0*a0 + w1*a1 + w2*a2 + w3*a3);
p = (Ms * rotateAxisAngle(a, phi) * vec4(p,1)).xyz;
```
Exact when the blended bones share an axis — which is precisely the twist-chain case. Extra cost ≈ 15 ALU/vertex. Inject via `material.onBeforeCompile` replacing `#include <skinning_vertex>`.
**Do not use dual-quaternion skinning**: it trades candy-wrapper for joint bulging, which is worse on a bare forearm and elbow, and needs the same shader surgery anyway.

**Fix 3 — shoulder collapse.** Four stacked mitigations:

| # | mitigation | numbers |
|---|---|---|
| a | A-pose bind at 45° abduction (§4.1) | halves the LBS deviation for the karate arm range |
| b | `deltoid_L` helper bone: `worldQuat = slerp(clavicle.worldQuat, upperarm.worldQuat, 0.5)`, at 20 % along the upper arm. Weight the deltoid cap ring 0.75–1.0 to it. | biggest single visual win in jodan positions |
| c | procedural clavicle drive — **scapulohumeral rhythm ≈ 2:1** ⇒ the scapula/clavicle carries **1/3** of total elevation above ~30°: `clavicle.elevZ = 0.33 * max(0, abduction − 30°)`, `clavicle.protY = 0.35 * max(0, flexion − 60°)` | at 170° abduction → 46° of clavicle elevation |
| d | hard cap: **max `upperarm` weight on any vertex medial to the shoulder ring = 0.0.** Never let arm bones touch the sternum. | eliminates the "sucked-in chest" artifact |

---

## 6. Inverse kinematics

### 6.1 Analytic two-bone IK in 3D (axes-agnostic, pole-vector form) — NORMATIVE

Inputs: `A` (root joint world pos), `B` (mid), `C` (end), target `T`, pole point `P` (or pole direction).
`L1 = |B−A|`, `L2 = |C−B|`, `Lsum = L1 + L2`.

**(1) Reach clamp + soften.** Softening prevents the visible pop as the limb straightens (ozz-animation's `soften`).
```
u_raw = T - A ;  r = |u_raw|
r_min = |L1 - L2| + 0.01 * Lsum
d0    = s * Lsum                       # s = soften_start = 0.97
r_c   = clamp(r, r_min, Lsum * 0.998)
if r > d0:
    r_c = d0 + (Lsum - d0) * (1 - exp( -(r - d0) / (Lsum - d0) ))
```
This is monotone, asymptotes to `Lsum`, and is C¹ at `r = d0` (both one-sided derivatives = 1).

**(2) Law of cosines.** (Ryan Juckett, *Analytic Two-Bone IK in 2D*, extended to 3D by choosing the plane in step 3.)
```
cosB = clamp( (L1*L1 + L2*L2 - r_c*r_c) / (2*L1*L2), -1, 1 )   # interior angle A-B-C
cosA = clamp( (L1*L1 + r_c*r_c - L2*L2) / (2*L1*r_c), -1, 1 )   # angle between AB and AT
thetaB = acos(cosB)                                             # bend from straight = PI - thetaB
thetaA = acos(cosA)
if (2*L1*L2) < 1e-4:  thetaB = PI; thetaA = 0                    # degenerate zero-length bone
```
**Joint-limit-aware variant (use for knee and elbow):** clamp `thetaB` to the joint's flexion limit *before* step 4, then recompute `r_c` from the law of cosines:
```
thetaB = clamp(thetaB, PI - flexMax, PI - flexMin)               # knee: flexMax=140°, flexMin=0°
r_c    = sqrt(L1*L1 + L2*L2 - 2*L1*L2*cos(thetaB))
cosA   = clamp((L1*L1 + r_c*r_c - L2*L2)/(2*L1*r_c), -1, 1); thetaA = acos(cosA)
```
This makes the clamp *part of the solve* instead of a post-pass that breaks the endpoint.

**(3) Bend plane from the pole vector.**
```
u = normalize(T - A)
poleRaw = P - A
n = poleRaw - u * dot(poleRaw, u)              # component of pole perpendicular to u
if |n| < 1e-4:                                  # pole is colinear with reach -> fall back
    n = (B - A) - u * dot(B - A, u)             # use the current bend
    if |n| < 1e-4: n = any_vector_perp_to(u)
v    = normalize(n)                             # in-plane, points toward the pole
axis = normalize(cross(u, v))                   # bend axis, perpendicular to the plane
```

**(4) Target joint positions.**
```
B' = A + L1 * ( cos(thetaA) * u + sin(thetaA) * v )
C' = A + r_c * u
```

**(5) Bones from positions — two swings, twist-preserving.** Do NOT build Euler angles.
```
q1 = quatFromUnitVectors( normalize(B - A),  normalize(B' - A) )      # world space
A.worldQuat = q1 * A.worldQuat                                        # PRE-multiply
recomputeWorld(A)                                                      # B is now at B'
q2 = quatFromUnitVectors( normalize(C - B'), normalize(C' - B') )
B.worldQuat = q2 * B.worldQuat
recomputeWorld(B)
# convert back: bone.quaternion = parent.worldQuat.invert() * bone.worldQuat
```
`quatFromUnitVectors(a, b)`: `w = 1 + a·b`, `xyz = a × b`, then normalize; if `a·b < −1+1e-6` use any axis ⟂ a and angle π. This form preserves whatever twist the animation already had in both bones and needs no per-rig axis table.

**(6) Optional axial twist** (e.g. to orient the knee independently of the pole): pre-multiply `axisAngle(u, φ)` onto `A.worldQuat` before step 5.

**(7) Weight blend.** `bone.quaternion = slerp(qLocal_anim, qLocal_solved, w)`, `w ∈ [0,1]`, applied per bone. Blend in **local** space so the parent's blended result composes correctly.

**Why not FABRIK / CCD for legs and arms?** Both are iterative, both need a pole-vector post-correction anyway to pick the bend direction, and both cost 5–20× more for the 2-bone case. Analytic is exact, branchless, and ~0.9 µs per chain. Reserve FABRIK for a >2-bone chain (we have none in the body).

### 6.2 Pole-vector defaults (NORMATIVE)

Given as directions in the stated parent frame; pole point `P = A + 0.5·H · dir`.

| chain | pole direction | frame | note |
|---|---|---|---|
| knee | `normalize(footForwardHorizontal)` | world | knee tracks over the toes — the single hardest karate stance requirement (zenkutsu, kokutsu). `footForwardHorizontal = normalize((toe_tip − heel) projected to XZ)`. |
| knee, deep stances (flex > 100°) | `normalize(lerp(footForwardHorizontal, (0,0.35,0) + footForwardHorizontal, 0.4))` | world | lifts the pole so a deeply bent knee doesn't sink |
| elbow, tsuki / uke (default) | `(0, −0.85, +0.53)` normalized | **chest** | elbow points down and slightly back |
| elbow, shuto-uke / soto-uke | `(±0.40, −0.80, +0.45)` normalized (`+` = same side) | **chest** | elbow rides outward |
| elbow, jodan-age-uke | `(±0.55, −0.72, +0.42)` normalized | **chest** | |
| elbow, gedan-barai | `(±0.25, −0.90, +0.36)` normalized | **chest** | |

Interpolate the pole direction with the same easing curve as the technique, never step-change it (a pole flip snaps the elbow 180°).

### 6.3 Foot planting / ground contact IK

Order per frame (matches the ozz-animation foot-IK sample: raycast → pelvis correction → two-bone IK → aim IK):

```
1. FK pass. Read anim AJC, ball, heel world transforms.
2. Per foot, 2 downward rays:
      origin_ankle = AJC  + (0, +0.10*H, 0)
      origin_ball  = ball + (0, +0.10*H, 0)
      dir = (0,-1,0), maxDist = 0.25*H
   hit_y = max(hit_ankle.y, hit_ball.y)        # higher surface wins -> stairs/tatami edges
   normal = hit_ankle.normal                    # foot PITCH comes from the ground normal, not a toe ray
3. Ankle target height, accounting for foot pitch alpha:
      target_AJC.y = hit_y + 0.0390*H*cos(alpha) + 0.0415*H*sin(alpha)
      # 0.0390 H = AJC height when flat; 0.0415 H = heel-behind-AJC horizontal offset
4. Pelvis pass:
      dy = min over feet of (target_AJC.y - anim_AJC.y)
      dy = clamp(dy, -0.060*H, 0.0)              # never raise the pelvis; max drop 10.5 cm
      dy = criticallyDampedFilter(dy, tau = 0.08 s)
      pelvis.position.y += dy
5. Two-bone IK per leg (§6.1) with the knee pole of §6.2 and the knee flexion clamp folded in.
6. Ankle aim IK: rotate `foot` so its sole normal matches `hit.normal`, keeping the twist
   locked to the animated toe direction. Clamp result: pitch ∈ [-25°, +40°], roll ∈ ±15°.
7. Ball/toe: if the heel is off the ground (kokutsu, neko-ashi), drive `ball` rotation from
   the authored curve, NOT from IK.
```

**Plant lock — this is the feature that makes an embusen accurate.** Feet must not skate.

| param | value | notes |
|---|---|---|
| contact state machine | `PLANTED / RELEASING / AIRBORNE / LANDING` | per foot |
| plant enter | `speed_foot < 0.05·H/s (8.75 cm/s)` AND `AJC.y < 0.045·H` | hysteresis 2 frames |
| plant exit | authored release curve only (never speed-based — kata has long static holds) | |
| while PLANTED | ankle IK target = the **world transform frozen at plant time** | |
| pivot turns | frozen target is a *rotation about a stored pivot point*, not a fixed transform. Store `{pivotPoint, pivotType ∈ {BALL, HEEL, WHOLE_FOOT}, angleCurve}` per turn. | Heian Shodan's 90°/180° turns depend on this |
| lock blend in/out | 0.10 s ease-in-out on the IK weight | prevents pop at plant/release |
| max IK correction before flagging an authoring error | 0.030·H (5.2 cm) | if exceeded, the keyframe is wrong, not the IK |

On a flat dojo floor `hit.normal = (0,1,0)` always, so steps 2–3 reduce to `target_AJC.y = 0.0390·H` and the whole system collapses to plant-lock + pelvis drop. **Do not skip it anyway** — the pelvis pass is what keeps the support leg from hyperextending during stance transitions.

### 6.4 Hip-driven full-body layering (evaluation order — NORMATIVE)

| layer | operation | notes |
|---|---|---|
| L0 | sample authored keyframes → local quats + `pelvis` translation (pure FK) | |
| L1 | **hip drive**: pelvis yaw/translation curves are the *primary* signal; everything else reacts | |
| L2 | **spine counter-rotation / whip**: `spine_i.yaw += −c_i · pelvisYawVelocity · τ` with `τ = 0.055 s`, `c = [0.10, 0.18, 0.26, 0.30]` for `spine_01 → chest` (Σ = 0.84) | the transient shoulder *lag* behind the hips is what reads as karate. Zero lag = "aerobics". |
| L3 | **COM/weight-shift solve** (§2.2), 3 iterations | |
| L4 | **leg IK** (§6.3) | |
| L5 | **arm IK** — only where the technique specifies a contact point (uke blocks, kake) | most tsuki are FK |
| L6 | **twist-bone distribution** (§5.4 Fix 1) | must run after all rotation sources |
| L7 | **helper drivers**: deltoid slerp, clavicle scapulohumeral rhythm (§5.4 Fix 3) | |
| L8 | **look-at** (§6.5) | after the spine has settled |
| L9 | **ROM clamp** (§3.2) on every bone except those already clamped inside their IK solve | |
| L10 | `skeleton.update()` → `boneTexture` | |
| L11 | **cloth** — reads the final bone matrices of *this* frame | never a frame behind |

L9-vs-IK conflict resolution (NORMATIVE): for the knee and elbow the limit is folded into the solve (§6.1 step 2), so L9 is a no-op there. For everything else, clamp, then run **one** additional IK pass, then accept and *report* the residual endpoint error. Never loop to convergence — it produces frame-rate-dependent jitter.

### 6.5 Look-at chain

```
Chain and distribution weights (Σ = 1.0):
   chest    0.15
   neck_01  0.35
   head     0.50
Eyes take the residual AFTER the head has been solved.
```
```
d = normalize(target - head.worldPosition)
(yaw, pitch) = sphericalInFrame(d, chest.worldQuat)
yaw   = clamp(yaw,   -80°, +80°)
pitch = clamp(pitch, -40°, +25°)          # up is limited by the gi collar and cervical extension
for (bone, w) in chain:
    bone.quaternion.premultiply( eulerZXY(w*pitch about X, w*yaw about Y, 0) )
eyeYaw   = clamp(yaw   - achievedYaw,   -32°, +32°)
eyePitch = clamp(pitch - achievedPitch, -18°, +20°)
```

| param | value | notes |
|---|---|---|
| head spring | critically damped, `ω = 14 rad/s`, `ζ = 1.0` | ~0.30 s settle |
| **gaze lead** | target sampled **+0.090 s ahead** on the authored path | karate doctrine: the eyes arrive before the body. Without lead, turns look reactive. |
| eye saccade | 0.030 s latency, then instant | eyes do not ease |
| blink | every 3.5 s ± 1.5 s jitter, 0.11 s duration; suppress during kime ±0.15 s | |
| yaw asymmetry gate | if `|yaw| > 45°` shift 0.05 of the weight from `head` to `neck_01` | stops the "owl neck" |

---

## 7. Cloth / karate-gi

### 7.1 Garment inventory and dimensions

Sources: WKF Kumite Competition Rules 2026 Art. 2 (`https://www.wkf.net/files/pdf/documents/WKF%202026%20Kumite%20Competition%20Rules%20MASTER%20COPY_V11.pdf`), `https://en.wikipedia.org/wiki/Karate_gi`, `https://masupplies.com.au/blogs/information/karate-gi-for-competition`.

| part | rule / fact | frac H | cm @H=175 |
|---|---|---|---|
| **uwagi hem (jacket length)** | ≥ covers the hips, ≤ 3/4 of thigh length | legal band **0.349 – 0.500** above floor; **ship 0.400** (Japanese/kata cut 0.370) | 61.1 – 87.5; **70.0** |
| skirt drop below the belt | `belt_y − hem_y` | 0.190 – 0.215 | 33.3 – 37.6 |
| **sleeve end** (distance along the arm from SJC) | ≥ halfway down the forearm, ≤ the wrist bend | legal band **0.2390 – 0.3162**; **ship 0.2550** (kata cut, shortest legal) | 41.8 – 55.3; **44.6** |
| sleeve end as % of SJC→WJC | | 75.6 % – 100 %; **ship 80.6 %** | |
| **zubon hem** | ≥ covers 2/3 of the shin, < the ankle bone | legal band **0.0392 – 0.1221** above floor; **ship 0.1000** | 6.9 – 21.4; **17.5** |
| **obi width** | competition red/blue ≈ 5 cm; traditional 4.0–4.5 cm | **0.0240** | 4.20 |
| obi thickness | multi-layer stitched | 0.0030 | 0.53 |
| **obi tail length** (free each side of the knot) | competition minimum 15 cm; Shotokan worn longer | min 0.0857; **ship 0.1600** | min 26.3; **28.0** |
| belt line height | at the omphalion | 0.6145 | 107.5 |
| collar (eri) band width | doubled, stiff | 0.0230 – 0.0300 | 4.0 – 5.3 |
| front-panel overlap (left over right) | | 0.090 – 0.130 | 15.8 – 22.8 |
| side vents (slits) | belt line → hem, both sides | length 0.190 – 0.215 | 33.3 – 37.6 |

Fabric mass (industry convention is **oz per square yard**; `1 oz/yd² = 33.906 g/m²`):

| gi grade | oz/yd² | g/m² | typical use | thickness `[DERIVED]` |
|---|---|---|---|---|
| student / summer | 8 | 271 | avoid | 0.42 mm |
| light kata (Tokaido Kata Master) | 10 | 339 | acceptable | 0.52 mm |
| **standard heavy (SHIP THIS)** | **12** | **407** | duck canvas, kata/competition | **0.63 mm** |
| heavy kata | 14 | 475 | traditional | 0.73 mm |
| extra heavy | 16 | 543 | heaviest karategi made | 0.84 mm |

Thickness derivation: `t = m_A / ρ_fabric` with `ρ_fabric ≈ 0.65 g/cm³` (cotton fibre 1.54 g/cm³ at ~42 % fabric packing factor). 12 oz → `407 / 650000 g/cm³` → 0.063 cm ✔ consistent with #12 cotton duck.

### 7.2 Approach ranking

| | (a) skinned + vertex-shader flutter | (b) coarse Verlet/XPBD pinned to bones + capsule collision | (c) bone-chain jiggle driven by limb acceleration |
|---|---|---|---|
| **CPU cost** | 0 | ~0.10 ms per 300 particles (typed arrays, zero alloc, 8 substeps) | ~0.005 ms per 4-bone chain |
| **GPU cost** | +8 ALU/vertex | 0 (positions uploaded) | 0 |
| **Look quality (heavy gi)** | 4/10 | **9/10** | 7/10 narrow strips, 3/10 broad panels |
| **Inertia / kime snap** | none — flutter is periodic, reads as a flag in wind | **yes, free** — sudden limb deceleration throws the fabric | yes for the chain's own axis only |
| **Body collision** | none | yes (capsules) | only with explicit sphere colliders |
| **Self / panel–panel collision** | none | possible (particle–particle, expensive) — spec says NO, use layer offsets | none |
| **In-plane wrinkling** | fake, from a texture | **yes** | no — a chain has no shear DOF |
| **Determinism (needed for scrub/seek)** | perfect | needs state capture per keyframe (§7.7) | needs state capture |
| **Failure modes** | skirt slices through the thigh in zenkutsu-dachi; hem stays glued to the leg; no drape | tunnelling at high limb speed if under-substepped; stretchy hem; explodes on a bone teleport; jitter if the pin ring is over-constrained | belt tails pass through each other and through the legs; panels lose volume; visible "fan" seams between skirt panels |
| **Verdict** | torso panels only | **primary** | fallback / low-spec tier, and belt tails if CPU-bound |

### 7.3 Per-part recommendation (NORMATIVE)

| garment part | approach | grid | particles | why |
|---|---|---|---|---|
| jacket chest + back (above the belt) | **(a) pure skinning** | — | 0 | Compressed under the obi and lying on the body; simulation buys nothing and risks poking through. Add a dynamic wrinkle normal blend (§7.8). |
| collar / eri | **(a) pure skinning** | — | 0 | Stiff doubled band. Skin to `chest` + `neck_01`. |
| jacket sleeve ×2 | **(b) XPBD tube** | 12 around × 10 along | 120 each = **240** | Sleeve flare on a tsuki is a signature. Pin rings 0 and 1 (shoulder + upper arm). |
| jacket skirt front-L | **(b) XPBD sheet** | 12 wide × 9 tall | **108** | |
| jacket skirt front-R | **(b) XPBD sheet** | 12 wide × 9 tall | **108** | Overlaps front-L; give front-L a +0.004 H outward offset so the layers never fight. |
| jacket skirt back | **(b) XPBD sheet** | 16 wide × 9 tall | **144** | |
| trouser leg ×2 (below the knee only) | **(b) XPBD tube** | 14 around × 12 along | 168 each = **336** | Above the knee is skinned. Wide hem flare on mae-geri is the most recognisable gi motion. |
| obi knot | **(a) rigid skin to `pelvis`** | — | 0 | |
| obi tail ×2 | **(b) XPBD ribbon** with bend constraints | 2 wide × 13 long | 26 each = **52** | Ribbon (not chain) so the tail can *twist*, which reads correctly. Fallback: (c) 5-joint spring chain. |
| **TOTAL** | | | **988 particles** | budget cap 1 600 (high tier), 520 (low tier: sleeves + skirt only) |

Constraint counts ≈ `3.1 × particles` ⇒ **~3 060 constraints**.

### 7.4 XPBD math (NORMATIVE)

Macklin, Müller & Chentanez 2016 (`https://matthias-research.github.io/pages/publications/XPBD.pdf`), with Macklin et al. 2019 substepping (`https://mmacklin.com/smallsteps.pdf`).

```
alphaTilde_j = alpha_j / dt_s^2                     # alpha = compliance = 1/stiffness [m/N]
lambda_j = 0 at the start of each SUBSTEP           # (paper: per time step; with 1 iter/substep this is per substep)

dLambda_j = ( -C_j(x) - alphaTilde_j * lambda_j ) / ( sum_i w_i |grad_i C_j|^2 + alphaTilde_j )
dx_i      = w_i * grad_i C_j * dLambda_j
lambda_j += dLambda_j
```
With optional Rayleigh damping (`gamma_j = alphaTilde_j * betaTilde_j / dt_s`):
```
dLambda_j = ( -C_j - alphaTilde_j*lambda_j - gamma_j * grad C_j · (x - x_prev) )
            / ( (1 + gamma_j) * sum_i w_i |grad_i C_j|^2 + alphaTilde_j )
```

Substep loop (Macklin 2019 Algorithm 1):
```
collisionDetect(x_n, v_n)                    # ONCE per visual frame
dt_s = dt_frame / n_sub
for step in 0..n_sub-1:
    lerp collider capsule transforms to (step+0.5)/n_sub
    x_pred = x_n + dt_s*v_n + dt_s^2 * M^-1 * f_ext
    for each constraint: solve ONCE (Gauss-Seidel)  # 1 iteration per substep
    resolve collisions (zero compliance)
    v_{n+1} = (x_{n+1} - x_n) / dt_s
```
Substeps beat iterations: the 2019 paper measured ~2 orders of magnitude lower constraint error for equal substep-vs-iteration counts (hanging chain: `e = 322.1 m` with 100 iterations vs `e = 3.2 m` with 100 substeps), and cloth cost rose only 1.8 ms → 2.4 ms for 40 iterations → 40 substeps.

**Constraint types to implement**

| type | `C(x)` | `∇C` | used for |
|---|---|---|---|
| distance (stretch) | `‖x1−x2‖ − l0` | `±n̂` | warp/weft edges |
| shear | `‖x1−x2‖ − l0` on quad diagonals | `±n̂` | in-plane shear resistance |
| dihedral bend | `θ − θ0`, `θ` = angle between adjacent triangle normals | standard 4-point gradients | **the heavy-canvas character** |
| attachment (pin) | `‖x − p_bone(t)‖` | `n̂`, `w_pinned = 0` | pin rings; `p_bone` from `mesh.applyBoneTransform` or a direct bone-matrix multiply |
| collision (unilateral) | `n̂·(x − c) − (r_cap + r_particle)` ≥ 0, `α = 0` | `n̂` | capsules (§7.6) |
| long-range attachment (LRA) | `‖x − pin‖ ≤ d_geodesic` | `n̂` | kills residual stretch on the skirt hem with 0 extra iterations |

### 7.5 Concrete parameters (NORMATIVE)

| param | value | derivation / source |
|---|---|---|
| `dt_frame` | 1/60 s = 16.667 ms | |
| **`n_sub`** | **8** | see the tunnelling calc below |
| `dt_s` | 2.083 ms | |
| iterations per substep | **1** | Macklin 2019 |
| collision detection frequency | once per visual frame; capsules lerped per substep | Macklin 2019 §5 |
| grid cell size (all garments) | 0.030 m (3.0 cm) | ⇒ 1.7 % of H; matches the fold wavelength of §7.9 |
| particle mass (12 oz, 3 cm quad) | `m = 0.407 kg/m² × 9.0e-4 m² = 3.663e-4 kg` | `w = 1/m = 2730 kg⁻¹` |
| `alpha_stretch` (12 oz canvas) | **0.0** (rigid) | canvas is effectively inextensible. Sanity: `α = 1e-7` ⇒ `α̃ = 1e-7/(2.083e-3)² = 0.023` vs `w1+w2 = 5460` ⇒ already negligible. Use `0.0`. |
| `alpha_stretch` (8 oz soft gi) | 2.0e-6 m/N | |
| `alpha_shear` | 4.0e-5 m/N | canvas resists shear but not rigidly |
| **`alpha_bend`** (12 oz) | **8.0e-3 rad/(N·m)** starting value — **calibrate with the swatch test below** | |
| `alpha_bend` (14 oz kata) | 4.0e-3 | |
| `alpha_bend` (obi, multi-layer) | 5.0e-4 | |
| `alpha_bend` (8 oz) | 5.0e-2 | |
| velocity damping | per-frame retention 0.980 ⇒ per substep `0.980^(1/8) = 0.99748` | |
| air drag `c_drag` (linear, per frame) | skirt 0.030 · sleeve 0.050 · trouser 0.040 · belt tail 0.020 | sleeves catch the most air |
| gravity | `(0, −9.81, 0) m/s²` | |
| friction μ (gi on skin) | 0.60 | |
| friction μ (gi on gi) | 0.45 | |
| max velocity clamp | 12 m/s | explosion guard |
| max per-substep displacement | `0.30 × r_particle` (CFL, Macklin 2019 §6.4) | |
| pin ring count | 2 rings per tube (sleeve, trouser), 1 row per sheet (skirt), 1 particle per ribbon (obi tail) | 1 pin ring lets the tube rotate freely and jitter; 3+ over-constrains and stiffens the shoulder |
| solver warm start | carry `lambda` across substeps? **NO** — reset per substep | with 1 iteration per substep, warm-starting reintroduces the iteration dependence XPBD removes |

**Tunnelling justification for `n_sub = 8`.** Peak Shotokan hand speed in gyaku-zuki ≈ 8–11 m/s.

| n_sub | dt_s | limb displacement per substep at 11 m/s | forearm capsule radius `0.028 H = 4.9 cm` | tunnels? |
|---|---|---|---|---|
| 1 | 16.67 ms | 18.3 cm | 4.9 cm | **yes, badly** |
| 4 | 4.17 ms | 4.6 cm | 4.9 cm | marginal |
| **8** | **2.08 ms** | **2.3 cm** | **4.9 cm** | **no (47 % of radius)** |
| 16 | 1.04 ms | 1.1 cm | 4.9 cm | no, but 2× cost for no gain |

**Bend-stiffness calibration test (run this, do not trust `alpha_bend` blind).** Heavy cotton canvas has a **cantilever bending length `c = 3.5–5.0 cm`** (the standard textile stiffness measure).
```
Swatch: 0.20 m × 0.20 m, 3 cm grid, clamped along one edge, held horizontally, gravity on, settle 2 s.
PASS if the free edge droops  7.5 cm ± 1.5 cm  below the clamp plane   ( = 0.043 ± 0.009 H )
Tune alpha_bend until this holds. A generic-cloth alpha (~0.5) droops ~17 cm and reads as bed sheet.
```

**Cost estimate (JS, typed arrays, no per-frame allocation):** `988 particles × 8 substeps × (3.1 constraints + ~3 collider tests) ≈ 48 k constraint solves + 24 k collider tests per frame`. Measured-comparable JS throughput ≈ 30–60 M simple ops/s per core ⇒ **0.6–1.1 ms/frame**. Budget: 1.5 ms. Fits.

### 7.6 Collision proxies

| capsule | from | to | radius frac H | cm @H=175 |
|---|---|---|---|---|
| head (sphere) | `head + (0, 0.030 H, 0)` | — | 0.052 | 9.10 |
| neck | `neck_01` | `head` | 0.035 | 6.13 |
| torso_upper | `chest` | `neck_01` | 0.085 | 14.88 |
| torso_lower | `pelvis` | `spine_02` | 0.080 | 14.00 |
| upperarm L/R | SJC | EJC | 0.033 | 5.78 |
| forearm L/R | EJC | WJC | 0.028 | 4.90 |
| hand L/R (sphere) | WJC + 0.03 H along | — | 0.030 | 5.25 |
| thigh L/R | HJC | KJC | 0.055 | 9.63 |
| shank L/R | KJC | AJC | 0.038 | 6.65 |
| foot L/R | AJC | toe_tip | 0.028 | 4.90 |
| floor (plane) | `y = 0`, normal `+Y` | — | — | |
| **total** | | | **15 colliders + 1 plane** | |

Capsule radii are deliberately **larger than the body-mesh radii of §5.1** by 0.004–0.008 H so the gi never sits *on* the skin (that causes z-fighting and shading pops). Naive cost `988 × 16 × 8 = 126 k` tests/frame is too much ⇒ **per-particle collider whitelist**, computed once at bind time from which bones the particle is pinned/adjacent to: 2–4 colliders per particle ⇒ **~24 k tests/frame**.

### 7.7 Robustness (mandatory for a scrubbable player)

| hazard | mitigation |
|---|---|
| bone teleport (user scrubs the timeline, pivot snap) | detect `|Δp_pin| > 0.05·H` in one frame ⇒ **re-initialize** all particles of that garment to their skinned rest positions and zero velocities |
| seek / scrub determinism | store a cloth **state snapshot** (positions + velocities, Float32) at every authored keyframe. On seek: load the nearest earlier snapshot and fast-forward at 8 substeps with rendering off. Snapshot size at 988 particles = 988×6×4 B = **23.7 kB**; 60 keyframes = 1.4 MB. Acceptable. |
| first-frame settle | run 30 frames of simulation headless at load before the first render |
| NaN | after every substep, `if (!isFinite(x)) reset particle to skinned rest position` |
| slow-motion / frame-rate independence | keep `dt_s` **constant** at 2.083 ms; on a long frame, run up to 3 extra frame-steps then drop (never scale `dt`) |
| pause | freeze the solver, keep the last positions |

### 7.8 Spring-bone fallback math (low-spec tier / obi tails)

VRM `VRMC_springBone-1.0` (`https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md`) — verlet on a bone's tail:
```
inertia   = (currentTail - prevTail) * (1.0 - dragForce)
stiffness = dt * (parentWorldRotation * initialLocalRotation * boneAxis) * stiffnessForce
external  = dt * gravityDir * gravityPower
nextTail  = currentTail + inertia + stiffness + external
nextTail  = worldPosition + normalize(nextTail - worldPosition) * boneLength      # length constraint
# sphere collider: d = |delta| - collider.radius - jointRadius ;  if d < 0: nextTail -= dir * d ; reapply length constraint
bone.rotation = initialLocalRotation * fromToQuaternion(boneAxis, normalize(nextTail - worldPosition))
```
Karate-gi parameter table (spec defaults are `stiffness 0.5, dragForce 0.5, gravityPower 1.0, hitRadius 0.1`):

| chain | joints | joint length frac H | stiffness | dragForce | gravityPower | hitRadius frac H |
|---|---|---|---|---|---|---|
| obi tail L/R | 5 | 0.032 each | 0.55 | 0.42 | 1.00 | 0.010 |
| sleeve cuff L/R | 3 | 0.026 each | 0.75 | 0.55 | 0.80 | 0.014 |
| skirt panel flap ×4 | 3 | 0.068 each | 0.62 | 0.48 | 1.00 | 0.018 |
| **limb-acceleration injection** (the "hybrid" in the brief) | add `external += dt * (-a_limb) * k_accel`, `a_limb` = the pin bone's world acceleration, `k_accel = 0.030 s²/m` for the obi, `0.045` for the cuff | | | | |

Why the hybrid still loses to (b) on broad panels: a bone chain has **no shear degree of freedom**, so a skirt panel cannot wrinkle in-plane and shows a visible "fan" seam where adjacent panels rotate independently. Keep (c) only for narrow strips.

### 7.9 Fabric look — PBR (three.js `MeshPhysicalMaterial`)

Model: Estevez & Kulla 2017 "Charlie" sheen NDF (`https://blog.selfshadow.com/publications/s2017-shading-course/imageworks/s2017_pbs_imageworks_sheen.pdf`), which is what `KHR_materials_sheen` and three.js's `sheen` implement. `D_Charlie = (2 + 1/α) · sin²ʰ^(1/(2α)) / (2π)`.

| property | value | rationale |
|---|---|---|
| `color` | `0xF2F0EA` (linear ≈ 0.949, 0.941, 0.918) | unbleached cotton. **Never pure `0xFFFFFF`** — it clips the highlights and flattens the form. |
| `roughness` | **0.78** (map range 0.68–0.88) | cotton canvas; 0.5 reads as satin, 0.95 kills the sheen |
| `metalness` | 0.0 | |
| `sheen` | **0.35** | cotton has modest fibre fuzz. Velvet = 1.0; poplin = 0.15. |
| `sheenColor` | `0xE8E4DA` | slightly warm, near-white |
| `sheenRoughness` | **0.55** | fibre divergence. Silk = 0.15 (sharp grazing highlight); low values keep the specular at grazing angles only. |
| `specularIntensity` | 0.35 | cellulose IOR 1.53 at low packing → weak specular |
| `ior` | 1.45 | |
| `anisotropy` | **0.25**, `anisotropyRotation` aligned to the **warp** direction per UV island | canvas genuinely has directional sheen along the warp. Biggest cheap win for "this is woven, not painted". |
| `clearcoat` | 0.0 | |
| `transmission` | 0.0 (optional 0.04 if budget allows) | a thin gi does backlight, but transmission is expensive; prefer wrapped diffuse |
| `side` | `DoubleSide` on the skirt / sleeve / obi tails | open surfaces |
| `normalScale` | weave map `(0.60, 0.60)`; crease map `(1.00, 1.00)` | 1.0 on the weave reads as corduroy |
| `envMap` | **required** | three.js docs: `MeshPhysicalMaterial` needs an env map for correct results, and costs more per pixel than `MeshStandardMaterial` |
| edge thickness fake | on backfaces, flip the normal and multiply albedo by 0.72; add a 2–3 px dark rim along open hems | real 0.63 mm extrusion is sub-pixel; the **darkened edge** is what reads as heavy canvas rather than paper |

**Procedural weave normal map (generate in code, no asset).**

| param | value | derivation |
|---|---|---|
| weave | plain (1/1), 2-ply warp and fill (`#12` cotton duck) | `https://www.bigduckcanvas.com/12-oz-cotton-canvas-fabric/12oz-cotton-canvas-fabric-natural-72-width/` |
| ends per inch (warp) | 30 ⇒ pitch **0.847 mm** | `[DERIVED]` typical #12 duck |
| picks per inch (weft) | 20 ⇒ pitch **1.270 mm** | `[DERIVED]` |
| tile coverage | 8 warp × 6 weft cells = **6.77 mm × 7.62 mm** | |
| tile resolution | 512² ⇒ **13.2 µm/texel**, 64 texels per warp cell | ≥8 texels/cell is the aliasing floor; 64 is generous |
| yarn crown height `A` | **0.18 mm** | ≈ 29 % of the 0.63 mm fabric thickness |
| height field | `h(u,v) = A · pow(cos(π·frac), 0.6)` per yarn, parity-alternating over/under | |
| normal | `n = normalize(−∂h/∂u · s_u, −∂h/∂v · s_v, 1)`, world-scale gradients | max `∂h/∂u ≈ 2π·0.18/0.847 = 1.34` ⇒ apply `normalScale 0.6` |
| UV tiling on the garment | 1 texture repeat = 6.77 × 7.62 mm ⇒ **147 × 131 repeats per metre** | for a sleeve UV'd 0→1 across a 0.55 m circumference: `repeat.x = 81` |
| mip / anisotropic filtering | `texture.anisotropy = 8`, full mip chain, and a roughness-from-normal-variance term to prevent shimmer at distance | mandatory: at 1 mm features a 1080p viewer aliases hard |

**How the gi holds creases (this is the "heavy cotton" tell).**

| mechanism | parameters |
|---|---|
| **baked static crease field** (R = intensity, G = direction) per garment part | skirt: 7–9 vertical folds per panel, spacing **0.030–0.045 H** (5.3–7.9 cm), running from the belt to the hem; sleeve: 3 elbow-crook folds; trousers: a permanent knee crease at `y = 0.29 H`, intensity 0.60 |
| **dynamic wrinkle from the simulation** | per vertex per frame compute `s = mean(l/l0 − 1)` over incident edges; write to a vertex attribute. `wrinkle = smoothstep(−0.03, −0.12, s)` — appears at 3 % compression, saturates at 12 %. Multiply the crease normal by `wrinkle`. |
| **belt gather** | at the belt line reduce the jacket radius by **0.012 H (2.1 cm)** across a **0.024 H (4.2 cm)** band and add **8–12** radial gather folds. This band is the *only* place the gi is tight. |
| **hysteresis** (why cotton keeps a crease and silk does not) | low-pass the wrinkle attribute asymmetrically: attack `τ = 0.05 s`, release `τ = 0.9 s`. A crease appears fast and *lingers*. Symmetric filtering reads as lycra. |

### 7.10 Gi silhouette rules (how a gi differs from generic clothing)

| # | rule | number |
|---|---|---|
| 1 | The jacket is **boxy, not tapered**. Chest ease 22–30 cm over the body. | jacket radius at chest = body radius **+ 0.020 H** (3.5 cm) |
| 2 | Sleeves are **wide tubes**, not fitted. | cuff circumference 34–40 cm ⇒ radius **0.031–0.036 H** vs forearm 0.0255 H; ease ratio **1.35** |
| 3 | Trouser legs are **very wide** — the most identifiable gi feature in motion. | hem circumference 44–52 cm ⇒ radius **0.040–0.047 H** vs ankle 0.020 H; ease ratio **2.1** |
| 4 | The skirt is **split at both sides** and the front panels **overlap left-over-right** (the wearer's left on top). | overlap 0.090–0.130 H; vent length = skirt drop |
| 5 | The collar is a **thick, stiff, doubled band** running hem→neck→hem. Never simulate it. | width 0.023–0.030 H |
| 6 | Because it is heavy, folds are **FEW and LARGE**. | fold wavelength **0.035–0.050 H (6–9 cm)**, not 2 cm. Generic cloth settings produce ~2 cm folds and instantly read as jersey/silk. |
| 7 | On **kime** the gi overshoots and stops hard — the visual signature. | after a limb decelerating 8 m/s → 0 in 40 ms: hem peak overshoot **0.030–0.045 H (5.3–7.9 cm)**, settling in **0.25–0.40 s**. Tune `c_drag` + damping to hit this. |
| 8 | Nothing is tight except the belt line. | see §7.9 belt gather |
| 9 | Kata cut = **shortest legal sleeves and trousers**, longest lapel. | sleeve 0.255 H from SJC, trouser hem 0.100 H, hem 0.370–0.400 H |
| 10 | Fabric weight drives the *sound* too — the kata-gi "snap" is why kata gi are 12–16 oz. If audio is added, key the snap to the frame where the hem's overshoot velocity peaks. | |

---

## 8. Frame budget (60 fps, 16.667 ms)

| system | budget ms | notes |
|---|---|---|
| pose sampling + FK (44 bones) | 0.08 | |
| spine whip + COM solve (3 iter) | 0.12 | |
| leg IK (2 chains + pelvis pass) | 0.06 | ~0.9 µs per two-bone solve |
| arm IK (0–2 chains) | 0.03 | |
| twist + helper drivers | 0.04 | |
| look-at | 0.02 | |
| ROM clamp (44 bones swing-twist) | 0.05 | |
| `skeleton.update()` + boneTexture upload | 0.10 | |
| **rig subtotal** | **0.50** | |
| **cloth (988 particles × 8 substeps)** | **1.10** | measured target; hard cap 1.50 |
| geometry upload (cloth positions + normals) | 0.15 | 988 × 6 floats |
| **CPU subtotal** | **1.75** | |
| render (25 k tris, PBR + shadows + post) | 8.00 | |
| **headroom** | **6.9** | |

---

## 9. References (techniques and sources actually drawn on)

**Anthropometry / biomechanics**
- de Leva, P. (1996). Adjustments to Zatsiorsky–Seluyanov's segment inertia parameters. *J. Biomechanics* 29(9):1223–1230. — the primary table used here. `https://ebm.ufabc.edu.br/wp-content/uploads/2013/12/Leva-1996.pdf`
- Zatsiorsky & Seluyanov (1983); Zatsiorsky, Seluyanov & Chugunova (1990a,b) — gamma-scanner body-segment parameters underlying de Leva.
- Drillis, R. & Contini, R. (1966). Body segment parameters. — proportion-of-stature constants. `https://www.openlab.psu.edu/design-tools-proportionality-constants/`
- Winter, D. A. *Biomechanics and Motor Control of Human Movement* — anthropometry tables (reproduces D&C).
- Visual3D / HAS-Motion documentation of the adjusted Zatsiorsky–Seluyanov parameters. `https://wiki.has-motion.com/doku.php?id=visual3d:documentation:definitions:adjusted_zatsiorsky-seluyanov_s_segment_inertia_parameters`
- AAOS goniometry normative ROM. `https://goniometer.io/range-of-motion`
- Anatomy Standard, in-vivo spinal ROM. `https://www.anatomystandard.com/biomechanics/spine/rom-of-spine.html`
- Segmental thoracic flexibility in vitro. `https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0177823`
- Lower-body flexibility, strength and knee stability in karate athletes vs controls. `https://pubmed.ncbi.nlm.nih.gov/17530951/`
- Anthropomorphic segment-length percentages of body height. `https://pmc.ncbi.nlm.nih.gov/articles/PMC6928058/table/T1`

**Skinning**
- Baran, I. & Popović, J. (2007). Automatic Rigging and Animation of 3D Characters (Pinocchio) — heat diffusion weights, `(L+H)w = Hχ`, `H_ii = 1/d²` gated on interior visibility. `https://dspace.mit.edu/bitstream/handle/1721.1/100396/automatic_rigging_and_animation.pdf`
- Dionne, O. & de Lasa, M. (2013). Geodesic Voxel Binding for Production Character Meshes. SCA. `https://dl.acm.org/doi/10.1145/2485895.2485919`
- Jacobson, Baran, Popović & Sorkine (2011). Bounded Biharmonic Weights.
- Kavan, Collins, Žára & O'Sullivan. Geometric Skinning with Approximate Dual Quaternion Blending (DQS).
- Kim & Han. Bulging-free dual quaternion skinning; swing–twist deformer (linear swing + spherical twist). `https://www.researchgate.net/publication/262387939_Bulging-free_dual_quaternion_skinning`
- SIGGRAPH 2014 course, *Skinning: Real-time Shape Deformation* — direct methods, LBS/DQS artifact taxonomy. `https://skinning.org/direct-methods.pdf`
- three.js r185 source: `src/renderers/shaders/ShaderChunk/skinning_vertex.glsl.js`, `src/objects/Skeleton.js`, `src/objects/SkinnedMesh.js`.

**IK**
- Juckett, R. Analytic Two-Bone IK in 2D — law-of-cosines closed form, epsilon and out-of-range handling. `https://www.ryanjuckett.com/analytic-two-bone-ik-in-2d/`
- ozz-animation two-bone IK and aim IK (pole vector, mid-axis, twist angle, **soften**) and the foot-IK sample (raycast → pelvis correction → two-bone IK → aim IK). `https://guillaumeblanc.github.io/ozz-animation/documentation/ik/` · `https://guillaumeblanc.github.io/ozz-animation/samples/foot_ik/`
- Aristidou & Lasenby (2011). FABRIK — considered and rejected for 2-bone chains (§6.1).
- Scapulohumeral rhythm ≈ 2:1 (clinical) → the 1/3 clavicle elevation driver.

**Cloth**
- Müller, Heidelberger, Hennix & Ratcliff (2007). Position Based Dynamics.
- Macklin, Müller & Chentanez (2016). XPBD: Position-Based Simulation of Compliant Constrained Dynamics. MiG. `https://matthias-research.github.io/pages/publications/XPBD.pdf`
- Macklin, Storey, Lu, Terdiman, Chentanez, Jeschke & Müller (2019). Small Steps in Physics Simulation. SCA. `https://mmacklin.com/smallsteps.pdf`
- Provot (1995) — mass-spring cloth with over-elongation limiting (the ancestor of the LRA constraint).
- Bridson, Fedkiw & Anderson (2002) — robust treatment of cloth collision and friction.
- Kim, Chentanez & Müller (2012) — long-range attachments.
- VRM `VRMC_springBone-1.0` specification — verlet spring-bone update, collider handling, parameter semantics. `https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md`

**Fabric appearance**
- Estevez, A. C. & Kulla, C. (2017). Production Friendly Microfacet Sheen BRDF ("Charlie" NDF). `https://blog.selfshadow.com/publications/s2017-shading-course/imageworks/s2017_pbs_imageworks_sheen.pdf`
- Ashikhmin & Premoze — velvet NDF (Filament's alternative cloth distribution).
- Google Filament, *Physically Based Rendering in Filament*, cloth material model; `sheenColor` defaults to 0.04 to match standard reflectance. `https://google.github.io/filament/Filament.md.html`
- `KHR_materials_sheen` glTF extension. `https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_sheen/README.md`
- Irawan & Marschner (2012). Specular Reflection from Woven Cloth — the reference weave BRDF (we approximate it with a procedural normal map + anisotropy).
- Sadeghi, Bisker, de Deken & Jensen (2013). A Practical Microcylinder Appearance Model for Cloth Rendering.
- three.js `MeshPhysicalMaterial` docs — sheen property ranges/defaults, env-map requirement, per-pixel cost warning. `https://threejs.org/docs/pages/MeshPhysicalMaterial.html`

**Gi construction**
- WKF Kumite Competition Rules 2026, Article 2 (karate-gi dimensions). `https://www.wkf.net/files/pdf/documents/WKF%202026%20Kumite%20Competition%20Rules%20MASTER%20COPY_V11.pdf`
- Karate gi construction, cuts, fabric weights. `https://en.wikipedia.org/wiki/Karate_gi` · `https://masupplies.com.au/blogs/information/karate-gi-for-competition`
- #12 cotton duck canvas specifications. `https://www.bigduckcanvas.com/12-oz-cotton-canvas-fabric/12oz-cotton-canvas-fabric-natural-72-width/`

---

## Uncertainties

Things a critic could legitimately dispute, with what would settle each.

1. **Shoulder width 0.259 H is probably wrong for a rig.** Drillis & Contini's "shoulder width = 0.259 H" gives 45.3 cm at H=175, but ANSUR-1988 US-male *biacromial* breadth is ≈39.7 cm at 175.6 cm stature (0.226 H) and *bideltoid* is ≈49.2 cm (0.280 H). D&C's figure is undefined as to landmark. This doc uses **0.226 H biacromial** for the skeleton and **0.280 H bideltoid** for the mesh silhouette, and flags 0.259 H as unusable without a landmark definition. Settle by measuring on a reference karateka photo with a known stature.

2. **D&C were never validated.** The OPEN Design Lab notes explicitly that the D&C ratios come from an unvalidated population and that D&C gave no formal definitions of the dimensions each ratio predicts. Every D&C value here is used only as a *cross-check* against de Leva, never as the primary.

3. **de Leva's sample is Russian; ours is a generic athletic male.** The gamma-scanner subjects were ethnically Russian college students (mass 73.0 kg, stature 1.741 m). Foot length in particular disagrees with US data by 2.5 %. Segment mass fractions are more population-stable than lengths, so the mass table is safer than the length table.

4. **Cervical ROM: AAOS vs in-vivo differ by up to 42 %.** AAOS goniometry: 45/45/45/60. Anatomy Standard in-vivo: 64/63/49/85 (rotation to one side). The clamp shipped (55/55/45/70) is a compromise, not a measurement. If the head ever looks stiff in a turn, raise the rotation clamp toward 85; if it looks owl-like, drop toward 60.

5. **Spinal ROM distribution across 4 spine bones is invented.** The *totals* match Anatomy Standard exactly by construction (91/53 flex/ext, ±60 lat, ±62 rot), but the per-bone split (`c = [0.10, 0.18, 0.26, 0.30]`, and the lumbar-vs-thoracic rotation split) is `[DERIVED]` from the qualitative fact that thoracic segments contribute most axial rotation and lumbar almost none. A per-level in-vitro study (PLOS One thoracic segmental flexibility) supports the shape but not these exact numbers.

6. **`alpha_bend` values are not derived from measured fabric mechanics.** No Kawabata KES-FB or ASTM D1388 cantilever data for karate-gi canvas was located. The starting values are tuning guesses; the *swatch calibration test* in §7.5 (free edge droops 7.5 ± 1.5 cm on a 20 cm swatch) is the real specification and is what should be trusted. The 3.5–5.0 cm cantilever bending length for heavy cotton canvas is a plausible textile range, not a cited measurement for this fabric.

7. **Limb radii and circumferences are all `[DERIVED]`.** Neck 38 cm, arm 32 cm, thigh 55 cm etc. are typical athletic-male values, not from a cited survey. They are art direction; the *skeleton* is the measured part.

8. **Kappa = 2.6 and p = 3 in the skin-weight falloff are tuned, not derived.** The claim that `p=2` bleeds and `p=6` facets is reasoning from how inverse-power falloffs behave, not a published comparison. A critic is right to demand an A/B render. The Laplacian smoothing pass (§5.3 step 6) matters far more than the exponent.

9. **The candy-wrapper volume-loss table is exact for the idealized 50/50 two-frame case only.** Real vertices have up to 4 influences with unequal weights, and the loss with a spread of weights is smaller than `1 − cos(θ/2)`. The table is an upper bound, which is the right side to err on.

10. **The "shoulders lag the hips by τ = 0.055 s" whip parameter is an authoring guess.** The *qualitative* claim (hips lead, shoulders lag then catch up) is standard Shotokan doctrine, but 55 ms is not from a motion-capture study. Expect to tune it against reference video; it is the single highest-leverage number for "does this look like karate".

11. **CPU cost estimates for the JS cloth solver are extrapolations, not measurements.** 0.6–1.1 ms for 988 particles at 8 substeps assumes typed arrays, zero per-frame allocation, and no GC pressure. A naive object-per-particle implementation will be 5–10× slower. Measure before trusting the budget in §8.

12. **The 8 m/s peak hand speed used for the tunnelling calculation** comes from the general karate-punch literature range (roughly 8–14 m/s for trained practitioners depending on measurement point and technique) rather than a specific cited study in this document. If doc 02/03 lands on a higher figure, re-run the table in §7.5; at 14 m/s and 8 substeps the per-substep displacement is 2.9 cm, still under the 4.9 cm capsule radius, so `n_sub = 8` survives.

13. **Wikipedia's karate-gi weights are internally inconsistent** ("0.34 kg (12 oz)", "0.5 kg (16 oz)") — those look like a conflation of oz/yd² with total garment mass. A 12 oz/yd² adult jacket masses roughly 1.3–1.7 kg. This doc uses the **oz/yd² → g/m²** conversion (`× 33.906`) and ignores the kg figures.

14. **`sheen = 0.35`, `sheenRoughness = 0.55`, `anisotropy = 0.25` are art-directed.** Filament documents `sheenColor` defaulting to 0.04 to match standard reflectance and describes the qualitative roughness behaviour, but no source gives measured sheen parameters for cotton canvas. Validate against a photograph of a 12 oz gi under a known HDRI.

15. **Weave density (30 ends × 20 picks per inch) is `[DERIVED]`.** The manufacturer confirms #12 duck is a 2-ply plain weave at 12 oz/yd² and 380 GSM but publishes no thread count. If the normal map looks too coarse, raise both counts by 20 % rather than reducing `normalScale` (reducing scale flattens the sheen response too).

16. **The A-pose-vs-T-pose argument assumes karate's shoulder abduction range is 0–120°.** If any kata in scope needs sustained overhead work (it should not for Taikyoku Shodan / Heian Shodan), the 45° bind becomes less optimal and a 60° bind would be better.

17. **Per-particle collider whitelisting can miss a legitimate collision** when a limb swings into a garment region it was not adjacent to at bind time (e.g. the punching forearm entering the opposite skirt panel). Mitigation not yet specified: add a cheap per-frame AABB broad-phase that can *temporarily* extend a particle's whitelist. Flagged as an open item.

18. **Cloth snapshot memory at 60 keyframes (1.4 MB) assumes 988 particles.** At the 1 600-particle high tier and a 40-move kata with sub-keyframes, this could reach 4–6 MB. Fine for desktop, worth checking on mobile.
