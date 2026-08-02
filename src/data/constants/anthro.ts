/**
 * B1 NUMBERS — `src/data/constants/anthro.ts`
 *
 * `ANTHRO`, `JOINT_Y`, `LIMB_R`, `SEG_MASS` (ARCHITECTURE.md §3.13, §4.1).
 * Sources: doc 01 §1/§10 (Drillis & Contini via Winter), doc 03 §1.1–§1.5, doc 06 §1–§2
 * (de Leva 1996 Table 4, male), doc 07 §0.2.
 *
 * ── WHICH TABLE WINS WHERE (doc 06 §1.5, "READ THIS BEFORE CODING") ────────────────────────
 * D&C and de Leva are NOT in disagreement; they use different endpoints. Do not average them.
 *   - RIG BONE LENGTHS come from de Leva joint-centre-to-joint-centre (doc 06 §1.1): `LEN_*`.
 *   - LANDMARK HEIGHTS and the karate-literature conversions come from D&C (doc 01 §1,
 *     doc 03 §1.3, doc 07 §0.2): `SHOULDER_W`, `HIP_Y_STAND`, `FOOT_LEN`, …
 *   - `JOINT_Y` is doc 06 §1.3's closed bottom-up chain built from the de Leva lengths, and every
 *     entry cross-checks against an independent D&C height to <= 1.3 %.
 * `FOOT_LEN` is the one real disagreement (D&C 0.152 vs de Leva 0.1483); doc 06 §1.5 adopts
 * 0.152 and this file follows it.
 *
 * ── LIMB_R IS THE MESH RADIUS TABLE, NOT THE COLLIDER TABLE ────────────────────────────────
 * `LIMB_R` carries doc 06 §5.1's body-mesh generation radii. The CLOTH COLLIDER radii already
 * ship frozen, as `Capsule.radiusH` in `CAPSULES` (§3.10), and doc 06 §7.6 states they are
 * deliberately 0.004–0.008 H LARGER than these so the gi never sits on the skin. Two tables, two
 * jobs; B4 builds geometry from `LIMB_R` and colliders from `CAPSULES`.
 */

import type { BoneName, Num } from '../../contracts';
import { BONE_ORDER } from '../../contracts';
import { N } from '../num';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * ANTHRO — segment lengths, breadths and the karate-literature unit conversions.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const ANTHRO: Readonly<Record<string, Num>> = Object.freeze({
  /* ── doc 01 §1 / §10 · Drillis & Contini via Winter Fig. 4.1 · LANDMARK proportions ── */
  ANKLE_Y: N(0.039, 'H', 0.004, 'docs/research/01-stances.md §1', 'TRAD'),
  KNEE_Y: N(0.285, 'H', 0.006, 'docs/research/01-stances.md §1', 'TRAD'),
  THIGH: N(0.245, 'H', 0.012, 'docs/research/01-stances.md §1', 'TRAD'),
  SHANK: N(0.246, 'H', 0.012, 'docs/research/01-stances.md §1', 'TRAD'),
  LEG_EXT: N(0.491, 'H', 0.017, 'docs/research/01-stances.md §1', 'DERIVED'),
  HIP_Y_STAND: N(0.53, 'H', 0.01, 'docs/research/01-stances.md §1', 'TRAD'),
  EYE_Y_STAND: N(0.936, 'H', 0.008, 'docs/research/01-stances.md §1', 'TRAD'),
  HIP_JOINT_SEP: N(0.098, 'H', 0.01, 'docs/research/01-stances.md §1', 'DERIVED'),
  SHOULDER_W: N(0.259, 'H', 0.02, 'docs/research/01-stances.md §1', 'TRAD'),
  HIP_W: N(0.191, 'H', 0.015, 'docs/research/01-stances.md §1', 'TRAD'),
  FOOT_LEN: N(0.152, 'H', 0.01, 'docs/research/01-stances.md §1', 'TRAD'),
  FOOT_BREADTH: N(0.055, 'H', 0.006, 'docs/research/01-stances.md §1', 'TRAD'),
  TOE_AHEAD: N(0.1, 'H', 0.008, 'docs/research/01-stances.md §1', 'DERIVED'),
  MTP_AHEAD: N(0.07, 'H', 0.008, 'docs/research/01-stances.md §1', 'DERIVED'),
  /**
   * doc 01 §1 `HEEL_BEHIND_ANKLE = 0.052 H [DERIVED: 0.34·FOOT_LEN]`. THIS is the only input to
   * `ZENKUTSU_HEEL_TO_HEEL_H` (§2.3, conflict C15). doc 06 §4.2's rig heel landmark is a
   * DIFFERENT number (0.0415 H) and ships frozen as `HEEL_OFFSET_H[2]`; substituting it here
   * fails the ±5e-4 derived gate by 3x.
   */
  HEEL_BEHIND: N(0.052, 'H', 0.006, 'docs/research/01-stances.md §1', 'DERIVED'),

  /** doc 07 §0.2 head height — the anti-heroic proportion gate: `1 / 0.130 = 7.7 heads`. */
  HEAD_HEIGHT: N(0.13, 'H', 0.006, 'docs/research/07-reference-and-datasets.md §0.2', 'TRAD'),
  /** doc 07 §0.2 `fist diameter [DERIVED] = 0.55 x hand length`. `*FistCenter` sits at half of it. */
  FIST_DIAMETER: N(0.059, 'H', 0.005, 'docs/research/07-reference-and-datasets.md §0.2', 'DERIVED'),

  /* ── doc 03 §1.1 · upper-limb segment lengths and reach limits ── */
  UPPER_ARM: N(0.186, 'H', 0.008, 'docs/research/03-techniques-upper.md §1.1', 'MEASURED'),
  FOREARM: N(0.146, 'H', 0.007, 'docs/research/03-techniques-upper.md §1.1', 'MEASURED'),
  HAND: N(0.108, 'H', 0.006, 'docs/research/03-techniques-upper.md §1.1', 'MEASURED'),
  WRIST_TO_MCP2: N(0.049, 'H', 0.005, 'docs/research/03-techniques-upper.md §1.1', 'DERIVED'),
  ELBOW_TO_FIST_CENTRE: N(0.176, 'H', 0.008, 'docs/research/03-techniques-upper.md §1.1', 'DERIVED'),
  ELBOW_TO_MCP2: N(0.195, 'H', 0.009, 'docs/research/03-techniques-upper.md §1.1', 'DERIVED'),
  HEAD_AND_NECK: N(0.182, 'H', 0.008, 'docs/research/03-techniques-upper.md §1.1', 'MEASURED'),
  /** Hard reach ceilings. Stage S4 asserts `|F| <= 0.381 H` (MCP2) / `<= 0.362 H` (fist centre). */
  MAX_REACH_GH_MCP2: N(0.381, 'H', 0.002, 'docs/research/03-techniques-upper.md §1.1', 'DERIVED'),
  MAX_REACH_GH_FIST: N(0.362, 'H', 0.002, 'docs/research/03-techniques-upper.md §1.1', 'DERIVED'),

  /* ── doc 03 §1.2 · THE FIST UNIT. Every JKA "one fist" distance scales with it. ── */
  FIST_UNIT: N(0.055, 'H', 0.005, 'docs/research/03-techniques-upper.md §1.2', 'DERIVED'),
  FIST_KNUCKLE_BREADTH: N(0.049, 'H', 0.004, 'docs/research/03-techniques-upper.md §1.2', 'DERIVED'),
  FIST_DEPTH: N(0.051, 'H', 0.005, 'docs/research/03-techniques-upper.md §1.2', 'DERIVED'),

  /* ── doc 06 §1.1 · de Leva 1996 Table 4 male · JOINT-CENTRE lengths. USE FOR THE RIG. ── */
  LEN_HEAD: N(0.1168, 'H', 0.0035, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_HEAD_ALT: N(0.1395, 'H', 0.0042, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_TRUNK: N(0.3055, 'H', 0.0092, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_TRUNK_ALT: N(0.3465, 'H', 0.0104, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_TRUNK_UPPER: N(0.0981, 'H', 0.0049, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_TRUNK_MID: N(0.1238, 'H', 0.0062, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_TRUNK_LOW: N(0.0837, 'H', 0.0042, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_UPPERARM: N(0.1618, 'H', 0.0049, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_FOREARM: N(0.1545, 'H', 0.0046, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_HAND_TO_MCP3: N(0.0495, 'H', 0.0025, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_HAND_FULL: N(0.1091, 'H', 0.0033, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_THIGH: N(0.2425, 'H', 0.0073, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_SHANK: N(0.2493, 'H', 0.0075, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_SHANK_AJC: N(0.2529, 'H', 0.0076, 'docs/research/06-rig-ik-cloth.md §1.1', 'MEASURED'),
  LEN_FOOT: N(0.152, 'H', 0.0046, 'docs/research/06-rig-ik-cloth.md §1.1', 'TRAD'),

  /* ── doc 06 §1.4 · breadths, depths and the RIG's lateral joint offsets ── */
  BRD_BIACROMIAL: N(0.226, 'H', 0.0113, 'docs/research/06-rig-ik-cloth.md §1.4', 'MEASURED'),
  BRD_BIDELTOID: N(0.28, 'H', 0.0168, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  BRD_CHEST: N(0.174, 'H', 0.0087, 'docs/research/06-rig-ik-cloth.md §1.4', 'TRAD'),
  DEP_CHEST: N(0.115, 'H', 0.0092, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  BRD_WAIST: N(0.154, 'H', 0.0123, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  BRD_HIP: N(0.191, 'H', 0.0096, 'docs/research/06-rig-ik-cloth.md §1.4', 'TRAD'),
  DEP_HIP: N(0.126, 'H', 0.0101, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  BRD_FOOT: N(0.055, 'H', 0.0028, 'docs/research/06-rig-ik-cloth.md §1.4', 'TRAD'),
  /** Rig lateral offsets, magnitudes only — the side is applied by `sideSign(h)` (§2.1). */
  SJC_X: N(0.098, 'H', 0.0059, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  HJC_X: N(0.05, 'H', 0.003, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  SC_JOINT_X: N(0.011, 'H', 0.0022, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  EYE_X: N(0.0175, 'H', 0.0018, 'docs/research/06-rig-ik-cloth.md §1.4', 'DERIVED'),
  /** doc 06 §1.5: SJC is 19.8 mm distal to the acromion; EJC 15.5 mm proximal to radiale. */
  SJC_BELOW_ACROMION: N(0.0114, 'H', 0.0011, 'docs/research/06-rig-ik-cloth.md §1.5', 'DERIVED'),
  EJC_ABOVE_RADIALE: N(0.0089, 'H', 0.0009, 'docs/research/06-rig-ik-cloth.md §1.5', 'DERIVED'),

  /* ── doc 03 §1.3 · torso/head landmark heights the technique specs are quoted against ── */
  GH_Y_STAND: N(0.818, 'H', 0.008, 'docs/research/03-techniques-upper.md §1.3', 'MEASURED'),
  ACROMION_Y_STAND: N(0.845, 'H', 0.01, 'docs/research/03-techniques-upper.md §1.3', 'DERIVED'),
  ELBOW_Y_STAND: N(0.63, 'H', 0.008, 'docs/research/03-techniques-upper.md §1.3', 'MEASURED'),
  WRIST_Y_STAND: N(0.485, 'H', 0.01, 'docs/research/03-techniques-upper.md §1.3', 'TRAD'),
  SUIGETSU_Y: N(0.7, 'H', 0.015, 'docs/research/03-techniques-upper.md §1.3', 'DERIVED'),
  JINCHU_Y: N(0.905, 'H', 0.015, 'docs/research/03-techniques-upper.md §1.3', 'DERIVED'),
  FOREHEAD_Y: N(0.96, 'H', 0.015, 'docs/research/03-techniques-upper.md §1.3', 'DERIVED'),
  CHIN_Y: N(0.87, 'H', 0.015, 'docs/research/03-techniques-upper.md §1.3', 'TRAD'),
  LOWER_ABDOMEN_Y: N(0.56, 'H', 0.015, 'docs/research/03-techniques-upper.md §1.3', 'DERIVED'),
  /** GH lateral offset the technique `dx` values are measured from. Magnitude only. */
  GH_X: N(0.13, 'H', 0.008, 'docs/research/03-techniques-upper.md §1.3', 'MEASURED'),

  /* ── doc 03 §2 · global technique invariants that are anthropometric, not per-technique ── */
  ELBOW_END_ZUKI_DEG: N(171, 'deg', 3, 'docs/research/03-techniques-upper.md §2', 'TRAD'),
  ELBOW_END_GEDAN_BARAI_DEG: N(172, 'deg', 4, 'docs/research/03-techniques-upper.md §2', 'TRAD'),
  ELBOW_ABSOLUTE_MAX_DEG: N(176, 'deg', 0, 'docs/research/03-techniques-upper.md §2', 'DERIVED'),
  SHOULDER_Y_RISE_MAX: N(0.008, 'H', 0.002, 'docs/research/03-techniques-upper.md §2', 'DERIVED'),
  SHOULDER_PROTRACTION_MAX: N(0.012, 'H', 0.003, 'docs/research/03-techniques-upper.md §2', 'DERIVED'),
  /** `0.130 · sin 45°` — the forward travel the punching GH gains from the hanmi->shomen turn. */
  GH_FORWARD_TRAVEL_HANMI: N(0.092, 'H', 0.008, 'docs/research/03-techniques-upper.md §2', 'DERIVED'),
  WRIST_ULNAR_DEV_SEIKEN_DEG: N(4, 'deg', 3, 'docs/research/03-techniques-upper.md §2', 'DERIVED'),

  /* ── doc 07 §0.3 · the virtual `*FistCenter` canonical joint ── */
  FIST_CENTRE_BEYOND_WRIST: N(0.03, 'H', 0.003, 'docs/research/07-reference-and-datasets.md §0.3', 'DERIVED'),
});

/**
 * `1 / HEAD_HEIGHT` — the doc 07 §4 anti-heroic proportion gate. 7.7 heads, deliberately NOT the
 * 8.0 heroic canon: an 8-head figure makes stance depths read shallower than the numbers say.
 */
export const PROPORTION_HEADS = 1 / ANTHRO.HEAD_HEIGHT!.v;
export const PROPORTION_HEADS_TARGET = N(
  7.7,
  'count',
  0.1,
  'docs/research/07-reference-and-datasets.md §4',
  'DERIVED',
);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * JOINT_Y — doc 06 §1.3's closed bind-pose chain, bottom-up from the §1.1 lengths.
 * Every entry cross-checks against an independent D&C height to <= 1.3 % (asserted in
 * `tests/data/proportions.test.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const JOINT_Y: Readonly<Record<string, Num>> = Object.freeze({
  FLOOR: N(0, 'H', 0, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  AJC: N(0.039, 'H', 0.004, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  KJC: N(0.2883, 'H', 0.0075, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  HJC: N(0.5308, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  MIDHIP: N(0.5308, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  OMPHALION: N(0.6145, 'H', 0.009, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  SJC: N(0.7982, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  SUPRASTERNALE: N(0.8363, 'H', 0.009, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  EJC: N(0.6364, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  WJC: N(0.482, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  DACTYLION: N(0.3729, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  CERVICALE: N(0.8773, 'H', 0.009, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  AOJ: N(0.918, 'H', 0.009, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
  VERTEX: N(1, 'H', 0, 'docs/research/06-rig-ik-cloth.md §1.3', 'DERIVED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * SEG_MASS — de Leva 1996 Table 4, male. PERCENT of body mass (the doc's own unit), so the
 * literal in `v` is the literal in doc 06 §2. Divide by 100 for a fraction.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const SEG_MASS: Readonly<Record<string, Num>> = Object.freeze({
  head: N(6.94, 'pct', 0.35, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunk: N(43.46, 'pct', 2.17, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunkUpper: N(15.96, 'pct', 0.8, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunkMid: N(16.33, 'pct', 0.82, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunkLow: N(11.17, 'pct', 0.56, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  upperarm: N(2.71, 'pct', 0.14, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  forearm: N(1.62, 'pct', 0.08, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  hand: N(0.61, 'pct', 0.03, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  thigh: N(14.16, 'pct', 0.71, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  shank: N(4.33, 'pct', 0.22, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  foot: N(1.37, 'pct', 0.07, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
});

/** de Leva COM position as a PERCENT of the segment's own §1.1 length, from the proximal end. */
export const SEG_COM_PCT: Readonly<Record<string, Num>> = Object.freeze({
  head: N(59.76, 'pct', 3, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunk: N(44.86, 'pct', 2.24, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunkUpper: N(29.99, 'pct', 1.5, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunkMid: N(45.02, 'pct', 2.25, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  trunkLow: N(61.15, 'pct', 3.06, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  upperarm: N(57.72, 'pct', 2.89, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  forearm: N(45.74, 'pct', 2.29, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  hand: N(79, 'pct', 3.95, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  thigh: N(40.95, 'pct', 2.05, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  shank: N(44.59, 'pct', 2.23, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
  foot: N(44.15, 'pct', 2.21, 'docs/research/06-rig-ik-cloth.md §2', 'MEASURED'),
});

/**
 * doc 06 §2.1's whole-body bind-pose COM height, and the unit test it exists to be:
 * `assert |COM_y/H - 0.568| < 0.008` (`tests/solve/stances.test.ts`, B3).
 */
export const COM_Y_BIND_H = N(0.5683, 'H', 0.008, 'docs/research/06-rig-ik-cloth.md §2.1', 'DERIVED');

/**
 * doc 06 §2.2's pelvis-solve gain. `dCOM/dpelvis ~= 0.89`, so `1/0.89 = 1.12` is exact but
 * unstable; 0.90 converges monotonically in <= 3 iterations.
 */
export const COM_SOLVE = Object.freeze({
  gain: N(0.9, 'ratio', 0.05, 'docs/research/06-rig-ik-cloth.md §2.2', 'DERIVED'),
  iterations: N(3, 'count', 0, 'docs/research/06-rig-ik-cloth.md §2.2', 'DERIVED'),
  tolH: N(0.002, 'H', 0.0005, 'docs/research/06-rig-ik-cloth.md §2.2', 'DERIVED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * LIMB_R — doc 06 §5.1's body-mesh generation radii, mapped onto all 52 `BoneName`s.
 *
 * doc 06 §5.1 gives radii by anatomical STATION; the rig has 52 bones. The mapping below is
 * stated station-by-station; every bone that a station does not name inherits the radius of the
 * station it sits inside, and the pure leaf terminators (`*_end`, `ribcage`, `root`) carry the
 * radius of their parent so that a swept ring built at a terminator does not collapse to a point.
 * `conf` is `MEASURED`/`DERIVED` per §5.1's own labelling of that row.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const R51 = 'docs/research/06-rig-ik-cloth.md §5.1';

/** Station radii, doc 06 §5.1 verbatim (the elliptical torso stations use the major semi-axis). */
export const STATION_R: Readonly<Record<string, Num>> = Object.freeze({
  neck: N(0.0346, 'H', 0.0017, R51, 'DERIVED'),
  chest: N(0.087, 'H', 0.0044, R51, 'DERIVED'),
  chestDepth: N(0.0575, 'H', 0.0029, R51, 'DERIVED'),
  waist: N(0.077, 'H', 0.0039, R51, 'DERIVED'),
  waistDepth: N(0.0545, 'H', 0.0027, R51, 'DERIVED'),
  hip: N(0.0955, 'H', 0.0048, R51, 'DERIVED'),
  hipDepth: N(0.063, 'H', 0.0032, R51, 'DERIVED'),
  upperarmMid: N(0.0291, 'H', 0.0015, R51, 'DERIVED'),
  elbow: N(0.0263, 'H', 0.0013, R51, 'DERIVED'),
  forearmMax: N(0.0255, 'H', 0.0013, R51, 'DERIVED'),
  wrist: N(0.0159, 'H', 0.0008, R51, 'DERIVED'),
  thighMid: N(0.05, 'H', 0.0025, R51, 'DERIVED'),
  knee: N(0.0337, 'H', 0.0017, R51, 'DERIVED'),
  calfMax: N(0.0337, 'H', 0.0017, R51, 'DERIVED'),
  ankle: N(0.02, 'H', 0.001, R51, 'DERIVED'),
  headRx: N(0.0443, 'H', 0.0022, R51, 'DERIVED'),
  headRy: N(0.062, 'H', 0.0031, R51, 'DERIVED'),
  headRz: N(0.0557, 'H', 0.0028, R51, 'DERIVED'),
});

/** Which §5.1 station each bone's swept ring is generated from. */
const LIMB_R_STATION: Readonly<Record<BoneName, keyof typeof STATION_R>> = Object.freeze({
  root: 'hip',
  pelvis: 'hip',
  spine_01: 'waist',
  spine_02: 'waist',
  spine_03: 'chest',
  chest: 'chest',
  ribcage: 'chest',
  neck_01: 'neck',
  head: 'headRy',
  head_end: 'headRy',
  eye_L: 'wrist',
  eye_R: 'wrist',
  clavicle_L: 'upperarmMid',
  upperarm_L: 'upperarmMid',
  upperarm_twist_L: 'upperarmMid',
  deltoid_L: 'upperarmMid',
  lowerarm_L: 'elbow',
  lowerarm_twist_01_L: 'forearmMax',
  lowerarm_twist_02_L: 'forearmMax',
  hand_L: 'wrist',
  fingers_prox_L: 'wrist',
  fingers_dist_L: 'wrist',
  fingers_end_L: 'wrist',
  thumb_L: 'wrist',
  thumb_end_L: 'wrist',
  thigh_L: 'thighMid',
  thigh_twist_L: 'thighMid',
  calf_L: 'knee',
  calf_twist_L: 'calfMax',
  foot_L: 'ankle',
  ball_L: 'ankle',
  toe_end_L: 'ankle',
  clavicle_R: 'upperarmMid',
  upperarm_R: 'upperarmMid',
  upperarm_twist_R: 'upperarmMid',
  deltoid_R: 'upperarmMid',
  lowerarm_R: 'elbow',
  lowerarm_twist_01_R: 'forearmMax',
  lowerarm_twist_02_R: 'forearmMax',
  hand_R: 'wrist',
  fingers_prox_R: 'wrist',
  fingers_dist_R: 'wrist',
  fingers_end_R: 'wrist',
  thumb_R: 'wrist',
  thumb_end_R: 'wrist',
  thigh_R: 'thighMid',
  thigh_twist_R: 'thighMid',
  calf_R: 'knee',
  calf_twist_R: 'calfMax',
  foot_R: 'ankle',
  ball_R: 'ankle',
  toe_end_R: 'ankle',
});

/**
 * Per-bone MESH radius, FracH. Built from `LIMB_R_STATION` so the numbers exist exactly once and
 * `BONE_ORDER` is the authority on completeness — a 53rd bone would fail to compile here rather
 * than silently ship at radius `undefined`.
 */
export const LIMB_R: Readonly<Record<BoneName, Num>> = Object.freeze(
  BONE_ORDER.reduce<Record<BoneName, Num>>((acc, b) => {
    acc[b] = STATION_R[LIMB_R_STATION[b]]!;
    return acc;
  }, {} as Record<BoneName, Num>),
);

/**
 * doc 06 §5.2's edge-loop rule, as data: 4 loops per major flexing joint, one exactly at the
 * joint centre, spaced by `+-0.35 x r_bone`, plus one distal at `+0.70 x r_bone`.
 */
export const MESH_LOOPS = Object.freeze({
  loopsPerFlexingJoint: N(4, 'count', 0, 'docs/research/06-rig-ik-cloth.md §5.2', 'DERIVED'),
  spacingFracR: N(0.35, 'ratio', 0.05, 'docs/research/06-rig-ik-cloth.md §5.2', 'DERIVED'),
  distalFracR: N(0.7, 'ratio', 0.1, 'docs/research/06-rig-ik-cloth.md §5.2', 'DERIVED'),
  innerLoopBiasPct: N(25, 'pct', 5, 'docs/research/06-rig-ik-cloth.md §5.2', 'DERIVED'),
  /** doc 06 §5.3 steps 3 and 7: bone-glow falloff, and the mid-limb rigidify radius. */
  weightKappa: N(2.6, 'ratio', 0.2, 'docs/research/06-rig-ik-cloth.md §5.3', 'DERIVED'),
  weightExponent: N(3, 'count', 0, 'docs/research/06-rig-ik-cloth.md §5.3', 'DERIVED'),
  weightSmoothLambda: N(0.35, 'ratio', 0.05, 'docs/research/06-rig-ik-cloth.md §5.3', 'DERIVED'),
  weightSmoothIters: N(5, 'count', 0, 'docs/research/06-rig-ik-cloth.md §5.3', 'DERIVED'),
  rigidifyFracR: N(1.8, 'ratio', 0.2, 'docs/research/06-rig-ik-cloth.md §5.3', 'DERIVED'),
  maxInfluences: N(4, 'count', 0, 'docs/research/06-rig-ik-cloth.md §5.3', 'DERIVED'),
  /** doc 06 §5.4: twist distribution along the forearm, and the retention gate (metric 62). */
  forearmTwist01Frac: N(0.33, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §5.4', 'DERIVED'),
  forearmTwist02Frac: N(0.67, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §5.4', 'DERIVED'),
  proximalTwistFrac: N(0.5, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §5.4', 'DERIVED'),
  radiusRetentionMin: N(0.97, 'ratio', 0.01, 'docs/research/06-rig-ik-cloth.md §5.4', 'DERIVED'),
});

/**
 * doc 06 §6.5's look-at chain: distribution weights (sum 1.0), clamps, gaze lead and blink.
 * B3's `src/solve/gaze.ts` consumes this; the eye residual clamp itself lives in `ROM.eye_*`.
 */
export const GAZE = Object.freeze({
  wChest: N(0.15, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  wNeck: N(0.35, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  wHead: N(0.5, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  yawClampDeg: N(80, 'deg', 5, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  pitchMinDeg: N(-40, 'deg', 5, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  pitchMaxDeg: N(25, 'deg', 5, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  headSpringOmega: N(14, 'rad/s', 2, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  headSpringZeta: N(1, 'ratio', 0.05, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  /** "the eyes arrive before the body" — without lead, turns look reactive. */
  leadS: N(0.09, 's', 0.02, 'docs/research/06-rig-ik-cloth.md §6.5', 'TRAD'),
  saccadeLatencyS: N(0.03, 's', 0.01, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  blinkPeriodS: N(3.5, 's', 1.5, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  blinkDurationS: N(0.11, 's', 0.02, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  blinkSuppressKimeS: N(0.15, 's', 0.03, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  owlNeckShiftAtDeg: N(45, 'deg', 5, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
  owlNeckShiftFrac: N(0.05, 'ratio', 0.01, 'docs/research/06-rig-ik-cloth.md §6.5', 'DERIVED'),
});

/**
 * doc 06 §6.4 L2's spine counter-rotation ("whip"). The transient shoulder LAG behind the hips is
 * what reads as karate; zero lag reads as aerobics. `c` runs `spine_01 -> chest`, sum 0.84.
 */
export const SPINE_WHIP = Object.freeze({
  tauS: N(0.055, 's', 0.01, 'docs/research/06-rig-ik-cloth.md §6.4', 'DERIVED'),
  c01: N(0.1, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.4', 'DERIVED'),
  c02: N(0.18, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.4', 'DERIVED'),
  c03: N(0.26, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.4', 'DERIVED'),
  cChest: N(0.3, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §6.4', 'DERIVED'),
});

/** doc 06 §6.1's two-bone IK soften factor, and §6.3's plant-lock thresholds. */
export const IK = Object.freeze({
  soften: N(0.97, 'ratio', 0.01, 'docs/research/06-rig-ik-cloth.md §6.1', 'DERIVED'),
  plantEnterSpeedHps: N(0.05, 'Hps', 0.01, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  plantEnterHeightH: N(0.045, 'H', 0.005, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  plantBlendS: N(0.1, 's', 0.02, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  maxCorrectionH: N(0.03, 'H', 0.005, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  pelvisDropMaxH: N(0.06, 'H', 0.005, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  pelvisFilterTauS: N(0.08, 's', 0.02, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  anklePitchMinDeg: N(-25, 'deg', 3, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  anklePitchMaxDeg: N(40, 'deg', 3, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
  ankleRollMaxDeg: N(15, 'deg', 3, 'docs/research/06-rig-ik-cloth.md §6.3', 'DERIVED'),
});
