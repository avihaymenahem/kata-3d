/**
 * B1 NUMBERS — `src/data/constants/rom.ts`
 *
 * `ROM` (ARCHITECTURE.md §3.13, §4.1). Source: doc 06 §3.1's clamp table, with doc 03 §12 for the
 * finger joints doc 06 does not enumerate and doc 01 §3.3 / §5.2 for the pelvis.
 *
 * ═══ THE ROM EXEMPTION, AND EXACTLY WHAT IT DOES AND DOES NOT SAY ═══════════════════════════
 *
 * `RomLimit` (§3.8) declares four BARE `…Deg` numbers, so the ~208 range-of-motion values cannot
 * individually be `Num`s without breaking the frozen interface. The frozen shape wins
 * (OWNERSHIP B1, adjudicated in the Phase-0 audit). Instead:
 *   (a) every ROM GROUP below carries one doc-cited `src` comment naming the doc 06 §3.1 row it
 *       came from — `ROM_GROUP_SRC` makes that machine-readable;
 *   (b) `tools/verify-constants.mjs` validates the table AS A BLOCK against doc 06 §3.1;
 *   (c) `ROM_SIGNED` ships doc 06 §3.1's SIGNED per-DOF table verbatim, because the elliptic cone
 *       provably cannot hold it.
 *
 * ═══ 1. THE TWO CONE SEMI-AXES ARE "PERPENDICULAR TO THE PRIMARY AXIS", IN (X,Y,Z) ORDER ════
 *
 * doc 06 §3.2's `ellipticConeLimit(dir, ellipseXZ)` takes per-axis HALF-ANGLES in the plane
 * PERPENDICULAR to the bone's primary axis. The field names `swingConeXDeg` / `swingConeZDeg` are
 * named for the spine/leg case, where the primary axis is `±Y` and those two perpendicular axes
 * literally ARE X and Z. For the other two axis families the names cannot be read literally:
 *
 *   primary `±Y` (root, pelvis, spine, neck, head, thigh, calf)  -> (about X, about Z)   as named
 *   primary `±X` (the whole arm chain)                            -> (about Y, about Z)
 *   primary `±Z` (foot, ball, toe, eye)                           -> (about X, about Y)
 *
 * RULE, uniform for all 52 bones: `swingConeXDeg` is the semi-axis about the FIRST axis of
 * `(X, Y, Z)` that is perpendicular to `PRIMARY_AXIS`, and `swingConeZDeg` is the semi-axis about
 * the SECOND. `ROM_PERP_AXES` exports that pairing per bone so B3 does not have to re-derive it.
 *
 * Worked example — the shoulder. doc 06 §3.1 labels its DOFs in the ANATOMICAL neutral pose (arm
 * hanging along `−Y`): flex/ext about X, abd/add about Z, int/ext rot about Y. The rig is generated
 * in T-POSE, arm along `±X`, which is that pose rotated 90° about Z. Under `R_z(+90°)`:
 * anatomical X -> bone Y, anatomical Y -> bone X, anatomical Z -> bone Z. So the humerus's AXIAL
 * rotation (int/ext rot) is about bone X = its primary axis = the TWIST ✔, shoulder flexion is
 * about bone Y = `swingConeXDeg`, and abduction is about bone Z = `swingConeZDeg`.
 *
 * ═══ 2. CONE SEMI-AXIS = THE SMALLER MAGNITUDE OF THE TWO SIGNED LIMITS ═════════════════════
 *
 * §3.8: "B1 authors the cone semi-axes as the ANATOMICALLY REACHABLE half-angle (the smaller of
 * the two signed limits), not the larger, so the envelope errs tight." A symmetric cone of
 * half-angle `b` admits `±b`, so the largest cone entirely inside doc 06's asymmetric range is
 * `min(|+lim|, |−lim|)`. That is what `cone()` computes, everywhere, with no exceptions.
 *
 * ═══ 3. CONSEQUENCE: THE FOUR MID JOINTS GET A NEAR-ZERO CONE. THAT IS CORRECT AND IT IS A ═══
 *       LANDMINE UNLESS S12 SKIPS THEM.
 *
 * The knee is `0 / −140` ("hyperextension hard-locked at 0"), so its cone is **0**; the elbow is
 * `+3 / −152`, so its cone is **3**. Read as a clamp those numbers would straighten every leg in
 * the project. They are not a clamp: §3.8 and doc 06 §6.4's L9 rule both state that for the knee
 * and the elbow the limit is FOLDED INTO IK STEP 2 (`TwoBoneArgs.midMinDeg` / `midMaxDeg`) and
 * that the post-clamp is a NO-OP there. `ROM_MID_JOINTS` names the four bones this applies to and
 * `MID_JOINT_SIGNED_DEG` carries their real signed ranges. **B3: stage S12 must skip
 * `ROM_MID_JOINTS`.** `tests/data/constants.test.ts` pins the cone values so the surprise is
 * impossible rather than merely documented.
 *
 * ═══ 4. THE A JOINTS' SIGNED LIMITS ARE NOT SMUGGLED IN HERE ════════════════════════════════
 *
 * Hip `+125/−25`, shoulder `+175/−55`, `+170/−38`, ankle `+24/−55` are asymmetric and a cone
 * cannot express them. Per §3.8, B3 owns an explicitly NAMED per-bone sign gate in
 * `src/solve/swingTwist.ts` with its own test; `ROM_SIGNED` is the data for it. Without that gate
 * `swingConeXDeg = 55` on the shoulder admits 55° of extension where doc 06 allows 55 — fine — but
 * a naive reader who "fixed" the cone to 175 would admit 175° of EXTENSION, which is anatomically
 * impossible and invisible to all 63 metrics.
 */

import type { BoneName, RomLimit } from '../../contracts';
import { BONE_ORDER, PRIMARY_AXIS_BY_NAME } from '../../contracts';

/** doc 06 §3.1's `kata clamp` column for one degree of freedom, signed, degrees. */
export interface SignedRange {
  readonly minDeg: number;
  readonly maxDeg: number;
}

const r = (minDeg: number, maxDeg: number): SignedRange => ({ minDeg, maxDeg });
const sym = (halfDeg: number): SignedRange => ({ minDeg: -halfDeg, maxDeg: halfDeg });

/** §3.8's rule, as one function: the largest symmetric cone inside an asymmetric range. */
const cone = (x: SignedRange): number => Math.min(Math.abs(x.minDeg), Math.abs(x.maxDeg));

/**
 * doc 06 §3.1, verbatim, per bone and per anatomical DOF. `about` names the BONE-LOCAL axis each
 * DOF acts on after the T-pose generation rotation of note 1 above.
 */
export interface RomDofs {
  /** Swing about the first axis perpendicular to `PRIMARY_AXIS`. */
  readonly swing1: SignedRange;
  /** Swing about the second axis perpendicular to `PRIMARY_AXIS`. */
  readonly swing2: SignedRange;
  /** Rotation about `PRIMARY_AXIS` itself. */
  readonly twist: SignedRange;
  /** The doc 06 §3.1 (or doc 03 §12 / doc 01 §3.3) row this came from. */
  readonly src: string;
  /** Human-readable DOF names, in `swing1, swing2, twist` order. */
  readonly dofs: readonly [string, string, string];
}

const D06 = 'docs/research/06-rig-ik-cloth.md §3.1';
const D03_12 = 'docs/research/03-techniques-upper.md §12.1';

/**
 * The signed source table. Bones sharing a row are listed once by STEM (`_L`/`_R` are identical in
 * bone-local space — the mirror lives in the bind pose, never in the limits).
 */
const ROM_ROWS: Readonly<Record<string, RomDofs>> = Object.freeze({
  /* ── root and pelvis. doc 06 §3.1 has no rows: the heading lives on `rootQuat` and the
   *    hanmi yaw on `pelvis`. Clamping either would kill the embusen or hanmi, so `root` is
   *    unclamped by construction and `pelvis` takes doc 01 §3.3 / §5.2's own ranges. ── */
  root: { swing1: sym(180), swing2: sym(180), twist: sym(180), src: D06, dofs: ['unclamped', 'unclamped', 'heading'] },
  pelvis: {
    swing1: r(0, 16), // sagittal tilt: doc 01 §5.2 kiba +8…+16, NEVER negative (fault Z13/B7)
    swing2: sym(3), // pelvis roll, doc 01 §3.3 "hip line level" ±3
    twist: sym(50), // hanmi ±45 (doc 01 §3.3) plus solver margin
    src: 'docs/research/01-stances.md §3.3',
    dofs: ['sagittal tilt', 'roll', 'yaw (hanmi)'],
  },

  /* ── spine. Sigma thoraco-lumbar = +91/−53 flex/ext, ±60 lat, ±62 rot — doc 06 §3.1's own
   *    "exact match by construction" against the in-vivo totals. ── */
  spine_01: { swing1: r(-16, 32), swing2: sym(15), twist: sym(6), src: D06, dofs: ['flex/ext', 'lat.flex', 'axial rot'] },
  spine_02: { swing1: r(-15, 33), swing2: sym(15), twist: sym(9), src: D06, dofs: ['flex/ext', 'lat.flex', 'axial rot'] },
  spine_03: { swing1: r(-11, 13), swing2: sym(15), twist: sym(24), src: D06, dofs: ['flex/ext', 'lat.flex', 'axial rot'] },
  chest: { swing1: r(-11, 13), swing2: sym(15), twist: sym(23), src: D06, dofs: ['flex/ext', 'lat.flex', 'axial rot'] },
  /** §2.8: `ribcage` is a childless leaf that carries breath SCALE only. It never rotates. */
  ribcage: { swing1: sym(0), swing2: sym(0), twist: sym(0), src: 'docs/research/06-rig-ik-cloth.md §4.2', dofs: ['none', 'none', 'none'] },

  /* ── neck and head. Sigma cervical = 55/55, ±45, ±70. ── */
  neck_01: { swing1: sym(30), swing2: sym(25), twist: sym(40), src: D06, dofs: ['flex/ext', 'lat.flex', 'axial rot'] },
  head: { swing1: sym(25), swing2: sym(20), twist: sym(30), src: D06, dofs: ['flex/ext', 'lat.flex', 'axial rot'] },
  head_end: { swing1: sym(0), swing2: sym(0), twist: sym(0), src: 'docs/research/06-rig-ik-cloth.md §4.2', dofs: ['none', 'none', 'none'] },
  /** Primary axis `−Z` (the gaze direction), so swing1 = pitch about X, swing2 = yaw about Y. */
  eye: { swing1: r(-18, 20), swing2: sym(32), twist: sym(0), src: D06, dofs: ['pitch', 'yaw', 'none'] },

  /* ── arm chain. Primary axis `±X`, so swing1 is about Y and swing2 about Z (note 1). ── */
  clavicle: {
    swing1: r(-16, 20), // prot/retr about Y — hikite retraction
    swing2: r(-8, 24), // elev/depr about Z
    twist: sym(10), // no doc 06 row; a scapular bone barely rolls. ART, tight.
    src: D06,
    dofs: ['prot/retr', 'elev/depr', 'axial (ART)'],
  },
  upperarm: {
    swing1: r(-55, 175), // shoulder flex/ext -> bone Y
    swing2: r(-38, 170), // shoulder abd/add -> bone Z
    twist: r(-68, 88), // shoulder int/ext rot -> bone X = the primary axis
    src: D06,
    dofs: ['flex/ext', 'abd/add', 'int/ext rot'],
  },
  /** doc 06 §5.4: a twist helper carrying 0.50 x the parent's axial rotation. No swing. */
  upperarm_twist: { swing1: sym(0), swing2: sym(0), twist: r(-68, 88), src: D06, dofs: ['none', 'none', 'int/ext rot share'] },
  /** Deltoid helper, slerped (doc 06 §5.4 Fix 3). No doc 06 row; ART, deliberately tight. */
  deltoid: { swing1: sym(30), swing2: sym(30), twist: sym(10), src: 'docs/research/06-rig-ik-cloth.md §5.4', dofs: ['ART', 'ART', 'ART'] },
  lowerarm: {
    swing1: r(-152, 3), // elbow flexion -> bone Y. MID JOINT: see note 3.
    swing2: sym(3), // the elbow has no abduction DOF
    twist: sym(2), // pronation lives on the two forearm twist bones, not here
    src: D06,
    dofs: ['flex/ext', 'none', 'none'],
  },
  /**
   * doc 06 §3.1's `forearm pron/sup +85/−88`, with its own note "**>= 180° total is required** —
   * hikite->tsuki rotates the fist ~180°". Both twist bones carry the full range; the 0.33 / 0.67
   * DISTRIBUTION of doc 06 §5.4 is B3's (stage S10 asserts the twists sum to the source roll).
   */
  lowerarm_twist_01: { swing1: sym(0), swing2: sym(0), twist: r(-88, 85), src: D06, dofs: ['none', 'none', 'pron/sup'] },
  lowerarm_twist_02: { swing1: sym(0), swing2: sym(0), twist: r(-88, 85), src: D06, dofs: ['none', 'none', 'pron/sup'] },
  hand: {
    swing1: r(-72, 62), // wrist flex/ext -> bone Y
    swing2: sym(22), // radial/ulnar deviation -> bone Z
    twist: r(-88, 85), // doc 06 §5.4: `phi_hand` is the SOURCE of the forearm twist distribution
    src: D06,
    dofs: ['flex/ext', 'radial/ulnar dev', 'pron/sup (source)'],
  },
  /** doc 03 §12.1: MCP 88 with ROM to the anatomical limit; splay 0 ±3 is a scored fault. */
  fingers_prox: { swing1: r(-88, 0), swing2: sym(3), twist: sym(5), src: D03_12, dofs: ['MCP flex', 'splay', 'ART'] },
  /** doc 03 §12.1: PIP ROM 100–120. */
  fingers_dist: { swing1: r(-120, 0), swing2: sym(2), twist: sym(3), src: D03_12, dofs: ['PIP flex', 'splay', 'ART'] },
  /** doc 03 §12.1: DIP ROM 70–90. */
  fingers_end: { swing1: r(-90, 0), swing2: sym(2), twist: sym(3), src: D03_12, dofs: ['DIP flex', 'splay', 'ART'] },
  /** doc 03 §12.1/§12.2: thumb CMC flexion 32–40, adduction 28–45 (shuto is the deeper tuck). */
  thumb: { swing1: r(-45, 0), swing2: r(-45, 0), twist: sym(30), src: D03_12, dofs: ['CMC flex', 'CMC add', 'CMC rot'] },
  /** doc 03 §12.1: thumb MCP 32 + IP 35, combined on one bone. */
  thumb_end: { swing1: r(-50, 0), swing2: sym(5), twist: sym(10), src: D03_12, dofs: ['MCP+IP flex', 'ART', 'ART'] },

  /* ── leg chain. Primary axis `−Y` for thigh/calf, `−Z` for foot/ball/toe. ── */
  thigh: {
    swing1: r(-25, 125), // hip flex/ext about X
    swing2: r(-28, 48), // hip abd/add about Z
    twist: r(-42, 50), // hip int/ext rot about Y = the primary axis
    src: D06,
    dofs: ['flex/ext', 'abd/add', 'int/ext rot'],
  },
  thigh_twist: { swing1: sym(0), swing2: sym(0), twist: r(-42, 50), src: D06, dofs: ['none', 'none', 'int/ext rot share'] },
  calf: {
    swing1: r(-140, 0), // knee flexion about X. MID JOINT: see note 3. Hyperextension locked at 0.
    swing2: sym(0), // the knee has no frontal-plane DOF
    twist: sym(8), // tibial rotation, unlocked only above 30° of flexion
    src: D06,
    dofs: ['flex', 'none', 'int/ext rot'],
  },
  calf_twist: { swing1: sym(0), swing2: sym(0), twist: sym(12), src: D06, dofs: ['none', 'none', 'foot-yaw share'] },
  /** Primary axis `−Z` (toe direction), so swing1 = dorsi/plantar about X, swing2 = abd/add about Y. */
  foot: {
    swing1: r(-55, 24), // ankle dorsi/plantarflexion. 24° DF is what deep zenkutsu needs.
    swing2: sym(12), // ankle abd/add about Y
    twist: r(-14, 30), // inversion/eversion about Z = the primary axis
    src: D06,
    dofs: ['dorsi/plantar', 'abd/add', 'inv/ev'],
  },
  /** MTP: 65° of extension is what a koshi / ball pivot needs. */
  ball: { swing1: r(-25, 65), swing2: sym(5), twist: sym(3), src: D06, dofs: ['flex/ext', 'ART', 'ART'] },
  toe_end: { swing1: sym(0), swing2: sym(0), twist: sym(0), src: 'docs/research/06-rig-ik-cloth.md §4.2', dofs: ['none', 'none', 'none'] },
});

/** Strip a trailing `_L` / `_R` to reach the `ROM_ROWS` stem. */
const stemOf = (b: BoneName): string => b.replace(/_(?:L|R)$/, '');

/** Per-bone signed source table, doc 06 §3.1 verbatim. THE authority; `ROM` is its cone image. */
export const ROM_SIGNED: Readonly<Record<BoneName, RomDofs>> = Object.freeze(
  BONE_ORDER.reduce<Record<BoneName, RomDofs>>((acc, b) => {
    const row = ROM_ROWS[stemOf(b)];
    if (row === undefined) throw new Error(`rom.ts: no ROM row for bone '${b}'`);
    acc[b] = row;
    return acc;
  }, {} as Record<BoneName, RomDofs>),
);

/** One doc anchor per bone — the machine-readable form of the ROM exemption's clause (a). */
export const ROM_GROUP_SRC: Readonly<Record<BoneName, string>> = Object.freeze(
  BONE_ORDER.reduce<Record<BoneName, string>>((acc, b) => {
    acc[b] = ROM_SIGNED[b].src;
    return acc;
  }, {} as Record<BoneName, string>),
);

/**
 * Which two bone-local axes each bone's cone semi-axes act about — the first and second axis of
 * `(X, Y, Z)` perpendicular to `PRIMARY_AXIS`. Exported so B3's `clampSwingTwist` reads the
 * pairing rather than rediscovering it.
 */
export const ROM_PERP_AXES: Readonly<Record<BoneName, readonly ['x' | 'y' | 'z', 'x' | 'y' | 'z']>> =
  Object.freeze(
    BONE_ORDER.reduce<Record<BoneName, readonly ['x' | 'y' | 'z', 'x' | 'y' | 'z']>>((acc, b) => {
      const a = PRIMARY_AXIS_BY_NAME[b];
      const names = ['x', 'y', 'z'] as const;
      const perp = names.filter((_, i) => Math.abs(a[i]!) < 0.5);
      acc[b] = [perp[0]!, perp[1]!] as const;
      return acc;
    }, {} as Record<BoneName, readonly ['x' | 'y' | 'z', 'x' | 'y' | 'z']>),
  );

/**
 * THE frozen-shape table (§3.8). Cone semi-axes are the smaller magnitude of each signed pair;
 * only the twist axis keeps a signed min/max, which is doc 06 §3.2's own normative signature.
 */
export const ROM: Readonly<Record<BoneName, RomLimit>> = Object.freeze(
  BONE_ORDER.reduce<Record<BoneName, RomLimit>>((acc, b) => {
    const d = ROM_SIGNED[b];
    acc[b] = Object.freeze({
      swingConeXDeg: cone(d.swing1),
      swingConeZDeg: cone(d.swing2),
      twistMinDeg: d.twist.minDeg,
      twistMaxDeg: d.twist.maxDeg,
    });
    return acc;
  }, {} as Record<BoneName, RomLimit>),
);

/**
 * The four MID joints. doc 06 §6.1 folds their limit into IK step 2 and doc 06 §6.4's L9 rule makes
 * the post-clamp a no-op for them, so **stage S12 must skip these bones**. Their `ROM` cones are 0
 * (knee) and 3 (elbow) by note 2's rule, which is a correct statement about hyperextension and a
 * catastrophic one if applied as a clamp.
 */
export const ROM_MID_JOINTS: readonly BoneName[] = Object.freeze([
  'calf_L',
  'calf_R',
  'lowerarm_L',
  'lowerarm_R',
]);

/** The signed flexion ranges the four MID joints actually have. Feeds `TwoBoneArgs.midMin/MaxDeg`. */
export const MID_JOINT_SIGNED_DEG: Readonly<Record<string, SignedRange>> = Object.freeze({
  knee: ROM_ROWS.calf!.swing1,
  elbow: ROM_ROWS.lowerarm!.swing1,
});

/**
 * Bones stage S12 must not clamp at all: the four MID joints plus `root` (which carries the world
 * heading) and `ribcage` (which carries breath scale and never rotates).
 */
export const ROM_CLAMP_EXEMPT: readonly BoneName[] = Object.freeze([
  ...ROM_MID_JOINTS,
  'root',
  'ribcage',
]);

/** doc 06 §3.1's own cross-check totals, asserted as a block by `tests/data/constants.test.ts`. */
export const ROM_BLOCK_TOTALS = Object.freeze({
  /** Sigma thoraco-lumbar flex / ext / lateral / rotation across spine_01…chest. */
  thoracoLumbarFlexDeg: 91,
  thoracoLumbarExtDeg: 53,
  thoracoLumbarLatDeg: 60,
  thoracoLumbarRotDeg: 62,
  /** Sigma cervical across neck_01 + head. */
  cervicalFlexDeg: 55,
  cervicalExtDeg: 55,
  cervicalLatDeg: 45,
  cervicalRotDeg: 70,
  /** doc 06 §3.1's forearm note: >= 180° of total pronation is REQUIRED for hikite -> tsuki. */
  forearmTotalRequiredDeg: 180,
  src: D06,
});
