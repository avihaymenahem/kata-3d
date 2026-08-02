/**
 * B1 NUMBERS — `src/data/constants/stances.ts`
 *
 * `STANCES`, `FIGHT_PELVIS_Y`, `mirrorStance` (ARCHITECTURE.md §3.13, §4.1). Source: doc 01 §10's
 * copy-paste constant block, with §3–§7 for the fields §10 omits.
 *
 * ── EVERYTHING HERE IS THE AUTHORED (doc-01) FRAME, HIDARI, VERBATIM ───────────────────────
 * §2.1: "authored data keeps every doc number verbatim; exactly one conversion exists, in
 * `src/solve/frame.ts`". All ten specs are written for **hidari** (left foot forward), which is how
 * doc 01 writes every table. `mirrorStance(spec, 'R')` produces the migi form.
 *
 * ── SIGN CLASS OF `yawFront` / `yawRear` / `pelvisYawHanmi` — READ BEFORE CONVERTING ───────
 * `StanceSpec`'s field comment reads "+ = toed out toward char-left". **doc 01's own convention is
 * the opposite**: doc 01 §0 states "Positive yaw turns the character toward their RIGHT", and its
 * numbers are only geometrically correct under that reading. Proof, on the one row that matters:
 * hidari zenkutsu's REAR foot is the RIGHT foot and doc 01 §3.1 gives it `+30`. "Toed out" for a
 * right foot means the toe points toward the character's right, which in the authored frame is
 * `-X`. With `R_y(t)·(0,0,-1) = (-sin t, 0, -cos t)`, reaching `-X` needs `sin t > 0`, i.e.
 * `t = +30`. ✔ doc 01 is self-consistent; the field comment is not.
 *
 * CONSEQUENCE (handed to B3, not acted on here): these three fields are **psi-class**, not
 * heading-class. They flip sign into the world frame — `WORLD_YAW_OF_PSI_SIGN` in
 * `src/contracts/units.ts` — exactly like doc 04 §0's pelvis `psi`, and unlike doc 02's headings,
 * for which `toWorldYawDeg` is the identity. B1 stores the doc value unchanged either way.
 *
 * ── PELVIS HEIGHT IS AN INPUT, NEVER AN OUTPUT ────────────────────────────────────────────
 * §3.8: "`pelvisY` is an INPUT to the leg solve, never an output." Stage S3 asserts it comes back
 * out equal to 1e-9, which is what makes head bob structurally impossible rather than tuned away.
 */

import type { Handedness, Num, StanceId, StanceSpec } from '../../contracts';
import { otherHand, sideSign } from '../../contracts';
import { A, N } from '../num';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE MASTER INVARIANT (doc 01 §2): one working height for all three fighting stances.
 * `PELVIS_Y_FIGHT = 0.410 H`, a 0.120 H drop from standing. §2.6 override #6 ships this over
 * doc 07's seeded 0.470, which doc 01's own lookup labels *moto-dachi (kumite)*.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const FIGHT_PELVIS_Y: Num = A(
  0.41,
  'H',
  0.01,
  'docs/research/01-stances.md §10',
  'DERIVED',
  'D02',
  [
    { v: 0.47, src: 'docs/research/01-stances.md §2', label: 'moto-dachi (kumite) height' },
    { v: 0.44, src: 'docs/research/01-stances.md §2', label: 'too high — FAIL for kihon' },
    { v: 0.38, src: 'docs/research/01-stances.md §2', label: 'competition-deep' },
  ],
);

/** doc 01 §2: the drop from `HIP_Y_STAND = 0.530` that produces `FIGHT_PELVIS_Y`. */
export const PELVIS_DROP_FIGHT_H = N(0.12, 'H', 0.01, 'docs/research/01-stances.md §10', 'DERIVED');
/** doc 01 §6: standing/preparatory pelvis height (hachiji / heiko). */
export const PELVIS_Y_YOI_H = N(0.523, 'H', 0.006, 'docs/research/01-stances.md §10', 'DERIVED');

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The ten stances. Field-for-field from doc 01 §10; the four fields §10 does not print per
 * stance (`pelvisTiltPost`, `torsoPitch`, `pelvisYawHanmi`, the two heel flags) come from §3.3 /
 * §4.2 / §5.2 / §6 and are cited individually.
 *
 * Symmetric stances (heisoku, musubi, heiko, hachiji, kiba) have no front/rear foot. doc 01 §10
 * writes them as `yawL` / `yawR`; the hidari convention maps L -> `yawFront`, R -> `yawRear`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D01_ALTS = [
  { v: 55.27, src: 'docs/research/01-stances.md §12', label: 'de Souza 2015, force plate [MEASURED]' },
  { v: 60.1, src: 'docs/research/01-stances.md §3.6', label: 'Nakayama 60/40 at S = 0.530 H' },
  { v: 70.8, src: 'docs/research/01-stances.md §3.6', label: 'modern dojo 70/30 at S = 0.450 H' },
] as const;

const ZENKUTSU: StanceSpec = {
  id: 'zenkutsu',
  /** §2.6 override #1's input, and `L_H`'s single source (§2.3, conflict C02). */
  S: N(0.54, 'H', 0.04, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** §2.6 override #2 ships this over doc 07's 0.14, which 07 §7.1 admits conflicts with itself. */
  W: A(0.17, 'H', 0.04, 'docs/research/01-stances.md §10', 'TRAD', 'D13', [
    { v: 0.191, src: 'docs/research/01-stances.md §11', label: 'one hip width' },
    { v: 0.259, src: 'docs/research/01-stances.md §11', label: 'one shoulder width' },
  ]),
  yawFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  /** §2.6 override #9. tol 20…45 per §3.1; the 45° reading is dispute D05. */
  yawRear: A(30, 'deg', 15, 'docs/research/01-stances.md §10', 'TRAD', 'D05', [
    { v: 45, src: 'docs/research/01-stances.md §11', label: 'The Martial Way "at least 45°"' },
  ]),
  pelvisY: FIGHT_PELVIS_Y,
  /** §2.6 override #3 ships 57 over doc 07's 45; doc 01 §3.2 derives it by 2-link sagittal IK. */
  kneeFront: N(57, 'deg', 7, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** §2.6 override #4 ships 10 over doc 07's 8. */
  kneeRear: N(10, 'deg', 8, 'docs/research/01-stances.md §10', 'TRAD'),
  /** §2.6 override #7 ships 59 over doc 07's 62; doc 01 §3.6 resolves it geometrically. */
  loadFront: A(59, 'pct', 3, 'docs/research/01-stances.md §10', 'DERIVED', 'D01', D01_ALTS),
  pelvisTiltPost: N(7, 'deg', 4, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYawHanmi: A(45, 'deg', 6, 'docs/research/01-stances.md §10', 'TRAD', 'D06', [
    { v: 90, src: 'docs/research/01-stances.md §11', label: 'Yahara "pure hanmi = 90°"' },
  ]),
  torsoPitch: N(0, 'deg', 3, 'docs/research/01-stances.md §10', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

const KOKUTSU: StanceSpec = {
  id: 'kokutsu',
  /** doc 01 §4.3 proves the traditional "two shoulder widths" (0.518 H) is INFEASIBLE at equal
   *  height with 70 % rear load; the geometric max is 0.459 H. Dispute D07. */
  S: A(0.446, 'H', 0.025, 'docs/research/01-stances.md §10', 'DERIVED', 'D07', [
    { v: 0.518, src: 'docs/research/01-stances.md §4.3', label: '"two shoulder widths" (infeasible)' },
  ]),
  W: N(0, 'H', 0.02, 'docs/research/01-stances.md §10', 'TRAD'),
  yawFront: N(0, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: N(90, 'deg', 8, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisY: FIGHT_PELVIS_Y,
  kneeFront: N(18, 'deg', 8, 'docs/research/01-stances.md §10', 'TRAD'),
  kneeRear: N(73, 'deg', 6, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** doc 01 §4.2: 30 front / 70 rear, [MEASURED 30.26] — the one weight split that is not disputed. */
  loadFront: N(30, 'pct', 5, 'docs/research/01-stances.md §10', 'MEASURED'),
  pelvisTiltPost: N(6, 'deg', 4, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYawHanmi: A(45, 'deg', 7, 'docs/research/01-stances.md §10', 'TRAD', 'D06', [
    { v: 90, src: 'docs/research/01-stances.md §11', label: 'Wikipedia "90 degrees or more away"' },
  ]),
  torsoPitch: N(0, 'deg', 3, 'docs/research/01-stances.md §10', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

const KIBA: StanceSpec = {
  id: 'kiba',
  S: N(0, 'H', 0.015, 'docs/research/01-stances.md §10', 'TRAD'),
  W: N(0.52, 'H', 0.02, 'docs/research/01-stances.md §10', 'DERIVED'),
  yawFront: N(4, 'deg', 4, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: N(-4, 'deg', 4, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisY: FIGHT_PELVIS_Y,
  kneeFront: N(59.5, 'deg', 5, 'docs/research/01-stances.md §10', 'DERIVED'),
  kneeRear: N(59.5, 'deg', 5, 'docs/research/01-stances.md §10', 'DERIVED'),
  loadFront: N(50, 'pct', 3, 'docs/research/01-stances.md §10', 'MEASURED'),
  /** doc 01 §5.2: "hips rolled upward", +8…+16, **never negative** (fault B7). */
  pelvisTiltPost: N(12, 'deg', 4, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisYawHanmi: N(0, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  torsoPitch: N(0, 'deg', 3, 'docs/research/01-stances.md §5.2', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

const HEISOKU: StanceSpec = {
  id: 'heisoku',
  S: N(0, 'H', 0.01, 'docs/research/01-stances.md §10', 'TRAD'),
  /** doc 01 §6: inner foot edges touching, so the AJCs are one foot breadth apart. */
  W: N(0.055, 'H', 0.02, 'docs/research/01-stances.md §10', 'TRAD'),
  yawFront: N(0, 'deg', 3, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: N(0, 'deg', 3, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisY: N(0.529, 'H', 0.006, 'docs/research/01-stances.md §10', 'DERIVED'),
  kneeFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  kneeRear: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  loadFront: N(50, 'pct', 2, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisTiltPost: N(2, 'deg', 3, 'docs/research/01-stances.md §6', 'DERIVED'),
  pelvisYawHanmi: N(0, 'deg', 3, 'docs/research/01-stances.md §6', 'TRAD'),
  torsoPitch: N(0, 'deg', 2, 'docs/research/01-stances.md §6', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

const MUSUBI: StanceSpec = {
  id: 'musubi',
  S: N(0, 'H', 0.01, 'docs/research/01-stances.md §10', 'TRAD'),
  W: N(0.03, 'H', 0.02, 'docs/research/01-stances.md §10', 'TRAD'),
  /** doc 01 §11.8: 45° each (90° included) vs 30° each (60° included). Dispute D12. */
  yawFront: N(-45, 'deg', 8, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: A(45, 'deg', 8, 'docs/research/01-stances.md §10', 'TRAD', 'D12', [
    { v: 30, src: 'docs/research/01-stances.md §11', label: 'traditional-karate.com 60° included' },
    { v: 22.5, src: 'docs/research/02-kata-sequences.md §2', label: 'doc 02 rei: 22.5° per foot' },
  ]),
  pelvisY: N(0.529, 'H', 0.006, 'docs/research/01-stances.md §10', 'DERIVED'),
  kneeFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  kneeRear: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  loadFront: N(50, 'pct', 2, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisTiltPost: N(2, 'deg', 3, 'docs/research/01-stances.md §6', 'DERIVED'),
  pelvisYawHanmi: N(0, 'deg', 3, 'docs/research/01-stances.md §6', 'TRAD'),
  torsoPitch: N(0, 'deg', 2, 'docs/research/01-stances.md §6', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

const HEIKO: StanceSpec = {
  id: 'heiko',
  S: N(0, 'H', 0.01, 'docs/research/01-stances.md §10', 'TRAD'),
  W: N(0.259, 'H', 0.03, 'docs/research/01-stances.md §10', 'TRAD'),
  yawFront: N(0, 'deg', 4, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: N(0, 'deg', 4, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisY: PELVIS_Y_YOI_H,
  kneeFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  kneeRear: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  loadFront: N(50, 'pct', 2, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisTiltPost: N(3, 'deg', 3, 'docs/research/01-stances.md §6', 'DERIVED'),
  pelvisYawHanmi: N(0, 'deg', 3, 'docs/research/01-stances.md §6', 'TRAD'),
  torsoPitch: N(0, 'deg', 2, 'docs/research/01-stances.md §6', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

/** THE CANONICAL YOI POSE (doc 01 §6: musubi for the bow, hachiji on the command *yoi*). */
const HACHIJI: StanceSpec = {
  id: 'hachiji',
  S: N(0, 'H', 0.01, 'docs/research/01-stances.md §10', 'TRAD'),
  /** `EMB_H_H` is DERIVED as `W/2` (§2.3, conflict C03) — never authored. */
  W: N(0.259, 'H', 0.03, 'docs/research/01-stances.md §10', 'TRAD'),
  yawFront: N(-30, 'deg', 15, 'docs/research/01-stances.md §10', 'TRAD'),
  /** doc 01 §11.9: textual sources say 45°, JKA yoi in practice looks 20–30°. Dispute D11. */
  yawRear: A(30, 'deg', 15, 'docs/research/01-stances.md §10', 'TRAD', 'D11', [
    { v: 45, src: 'docs/research/01-stances.md §11', label: 'Wikipedia / karatephilosophy 45°' },
  ]),
  pelvisY: PELVIS_Y_YOI_H,
  kneeFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  kneeRear: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  loadFront: N(50, 'pct', 2, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisTiltPost: N(3, 'deg', 3, 'docs/research/01-stances.md §6', 'DERIVED'),
  pelvisYawHanmi: N(0, 'deg', 3, 'docs/research/01-stances.md §6', 'TRAD'),
  torsoPitch: N(0, 'deg', 2, 'docs/research/01-stances.md §6', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

/**
 * `ashi-zenkutsu` (doc 01 §3.4, "short/narrow"). §3.4 gives bands (`S` 0.40–0.48 H,
 * `W` 0.055–0.09 H); this ships doc 01 §3.6's own solved row at `S = 0.450` — the only point
 * inside §3.4's band for which §3.6 prints a knee angle and a load share — and §3.4's narrow
 * `W = 0.055` (inner foot edges in line, i.e. one foot breadth between the AJCs).
 */
const ZENKUTSU_ASHI: StanceSpec = {
  id: 'zenkutsu-ashi',
  S: N(0.45, 'H', 0.04, 'docs/research/01-stances.md §3.6', 'DERIVED'),
  W: N(0.055, 'H', 0.018, 'docs/research/01-stances.md §3.4', 'TRAD'),
  yawFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: N(30, 'deg', 15, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisY: FIGHT_PELVIS_Y,
  kneeFront: N(73.5, 'deg', 7, 'docs/research/01-stances.md §3.6', 'DERIVED'),
  kneeRear: N(10, 'deg', 8, 'docs/research/01-stances.md §10', 'TRAD'),
  loadFront: N(70.8, 'pct', 4, 'docs/research/01-stances.md §3.6', 'DERIVED'),
  pelvisTiltPost: N(7, 'deg', 4, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYawHanmi: N(45, 'deg', 6, 'docs/research/01-stances.md §10', 'TRAD'),
  torsoPitch: N(0, 'deg', 3, 'docs/research/01-stances.md §10', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

/** doc 01 §7.B `han-zenkutsu-dachi` — holds fighting height at half the length. */
const HAN_ZENKUTSU: StanceSpec = {
  id: 'han-zenkutsu',
  S: N(0.27, 'H', 0.03, 'docs/research/01-stances.md §10', 'DERIVED'),
  W: N(0.17, 'H', 0.04, 'docs/research/01-stances.md §10', 'TRAD'),
  yawFront: N(3, 'deg', 5, 'docs/research/01-stances.md §7.B', 'TRAD'),
  yawRear: N(30, 'deg', 15, 'docs/research/01-stances.md §7.B', 'TRAD'),
  pelvisY: FIGHT_PELVIS_Y,
  kneeFront: N(74.6, 'deg', 6, 'docs/research/01-stances.md §10', 'DERIVED'),
  kneeRear: N(71, 'deg', 6, 'docs/research/01-stances.md §10', 'DERIVED'),
  loadFront: N(55, 'pct', 5, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisTiltPost: N(7, 'deg', 4, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYawHanmi: N(45, 'deg', 6, 'docs/research/01-stances.md §7.B', 'TRAD'),
  torsoPitch: N(0, 'deg', 3, 'docs/research/01-stances.md §10', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

/** doc 01 §7.B `moto-dachi` — the ONE stance that does not hold fighting height (0.470 H). */
const MOTO: StanceSpec = {
  id: 'moto',
  S: N(0.3, 'H', 0.03, 'docs/research/01-stances.md §10', 'DERIVED'),
  W: N(0.1, 'H', 0.03, 'docs/research/01-stances.md §10', 'TRAD'),
  yawFront: N(3, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  yawRear: N(25, 'deg', 5, 'docs/research/01-stances.md §10', 'TRAD'),
  pelvisY: N(0.47, 'H', 0.01, 'docs/research/01-stances.md §10', 'TRAD'),
  kneeFront: N(46, 'deg', 6, 'docs/research/01-stances.md §10', 'DERIVED'),
  kneeRear: N(40, 'deg', 6, 'docs/research/01-stances.md §10', 'DERIVED'),
  loadFront: N(55, 'pct', 5, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisTiltPost: N(7, 'deg', 4, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYawHanmi: N(30, 'deg', 10, 'docs/research/01-stances.md §10', 'TRAD'),
  torsoPitch: N(0, 'deg', 3, 'docs/research/01-stances.md §7.B', 'TRAD'),
  heelDownFront: true,
  heelDownRear: true,
};

export const STANCES: Readonly<Record<StanceId, StanceSpec>> = Object.freeze({
  heisoku: HEISOKU,
  musubi: MUSUBI,
  heiko: HEIKO,
  hachiji: HACHIJI,
  zenkutsu: ZENKUTSU,
  'zenkutsu-ashi': ZENKUTSU_ASHI,
  'han-zenkutsu': HAN_ZENKUTSU,
  kokutsu: KOKUTSU,
  kiba: KIBA,
  moto: MOTO,
});

/** The three stances doc 01 §2's equal-height invariant binds (fault X1, metric 6). */
export const FIGHT_STANCES: readonly StanceId[] = Object.freeze(['zenkutsu', 'kokutsu', 'kiba']);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * mirrorStance
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * doc 01 §10: "Mirror for `migi`: negate every `X`, every `yaw`, and every `pelvisYaw`." Lengths
 * (`S`, `W`, `pelvisY`), flexions and load shares are side-independent and pass through.
 *
 * The mirror factor is expressed with `sideSign(otherHand(side))`, which is `+1` for `'L'` (hidari
 * — the authored form, returned unchanged) and `-1` for `'R'`. §2.1 is explicit that handedness is
 * carried by RELABELLING the side sign and never by a bare geometric negation, and the brief for
 * this block forbids naming the raw constant outside its three allowlisted files. No `x`
 * coordinate is touched here at all: `StanceSpec` carries no `x`, only the two foot yaws and the
 * hanmi yaw.
 */
export function mirrorStance(s: StanceSpec, side: Handedness): StanceSpec {
  const m = sideSign(otherHand(side));
  if (m === 1) return s;
  const flip = (n: Num): Num => ({ ...n, v: n.v * m });
  return {
    ...s,
    yawFront: flip(s.yawFront),
    yawRear: flip(s.yawRear),
    pelvisYawHanmi: flip(s.pelvisYawHanmi),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The doc 01 §3.2 / §4.2 derived offsets `PELVIS_AHEAD_OF_C_H` is built from (§2.3). Kept here,
 * next to the stance they belong to, so `src/data/embusen.ts` derives rather than re-authors.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const STANCE_HIP_OFFSETS = Object.freeze({
  /** doc 01 §10 `ZENKUTSU.hipZbehindFrontAnkle`. `+` = behind, since forward is `-Z`. */
  zenkutsuHipBehindFrontAnkleH: N(0.221, 'H', 0.02, 'docs/research/01-stances.md §10', 'DERIVED'),
  zenkutsuHipAheadOfRearAnkleH: N(0.319, 'H', 0.02, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** doc 01 §10 `KOKUTSU.hipZaheadOfRearAnkle`. */
  kokutsuHipAheadOfRearAnkleH: N(0.134, 'H', 0.015, 'docs/research/01-stances.md §10', 'DERIVED'),
  kokutsuHipBehindFrontAnkleH: N(0.312, 'H', 0.015, 'docs/research/01-stances.md §4.2', 'DERIVED'),
  /** doc 01 §10 knee tracking, front leg. `tests/solve/stances.test.ts` reproduces both. */
  zenkutsuKneeFrontDZvsAnkleH: N(0.011, 'H', 0.027, 'docs/research/01-stances.md §10', 'DERIVED'),
  zenkutsuKneeFrontDXvsAnkleH: N(0.005, 'H', 0.01, 'docs/research/01-stances.md §10', 'DERIVED'),
  kokutsuKneeFrontDZvsAnkleH: N(0.127, 'H', 0.025, 'docs/research/01-stances.md §10', 'DERIVED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * doc 01 §8 — the step trajectory laws. `STEP` in doc 01 §10's block.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const STEP = Object.freeze({
  durKihonMinS: N(0.45, 's', 0.05, 'docs/research/01-stances.md §10', 'DERIVED'),
  durKihonMaxS: N(0.7, 's', 0.05, 'docs/research/01-stances.md §10', 'DERIVED'),
  durKataSlowMinS: N(1.2, 's', 0.1, 'docs/research/01-stances.md §10', 'DERIVED'),
  durKataSlowMaxS: N(2, 's', 0.1, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** The no-dip law (doc 01 §8.1). `pelvisYBand` is the JKA-correct band; `pelvisYFail` the p-p hard fail. */
  pelvisYBandH: N(0.008, 'H', 0.002, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYBandPassH: N(0.015, 'H', 0.003, 'docs/research/01-stances.md §10', 'DERIVED'),
  pelvisYFailH: N(0.034, 'H', 0.004, 'docs/research/01-stances.md §10', 'DERIVED'),
  swingClearanceH: N(0.008, 'H', 0.004, 'docs/research/01-stances.md §10', 'DERIVED'),
  swingClearanceMaxH: N(0.015, 'H', 0.004, 'docs/research/01-stances.md §10', 'DERIVED'),
  midStepSupportKneeDeg: N(78, 'deg', 4, 'docs/research/01-stances.md §10', 'DERIVED'),
  midStepPelvisZaheadOfSupportAnkleH: N(0.072, 'H', 0.015, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** doc 01 §8.3 koshi no kaiten: hold, then snap. `holdThenSnap` in `src/contracts/ease.ts`. */
  yawHoldUntil: N(0.55, 'ratio', 0.08, 'docs/research/01-stances.md §10', 'TRAD'),
  yaw90PctAt: N(0.92, 'ratio', 0.05, 'docs/research/01-stances.md §10', 'DERIVED'),
  lateralSwayFastH: N(0.015, 'H', 0.005, 'docs/research/01-stances.md §10', 'DERIVED'),
  lateralSwaySlowH: N(0.035, 'H', 0.01, 'docs/research/01-stances.md §10', 'DERIVED'),
  /** doc 01 §8.2: back-loaded pelvis Z easing — 35 % of travel by t = 0.5. */
  pelvisZFracAtHalf: N(0.35, 'ratio', 0.08, 'docs/research/01-stances.md §8.2', 'TRAD'),
  /** doc 01 §8.1: head Y peak-to-peak, JKA-correct. Metric 17's neighbourhood. */
  headYppH: N(0.01, 'H', 0.002, 'docs/research/01-stances.md §8.1', 'DERIVED'),
});

/**
 * doc 01 §3.5's hard result: at `S = 0.540 H` the rear shank leans 45.7° from vertical, so a flat
 * rear heel needs a rear-foot yaw of at least 30°, and above `S = 0.580 H` heel lift is a
 * geometric necessity rather than laziness. Fault Z3 is the most common zenkutsu fault for exactly
 * this reason.
 */
export const ZENKUTSU_LIMITS = Object.freeze({
  sMinH: N(0.5, 'H', 0.01, 'docs/research/01-stances.md §3.1', 'DERIVED'),
  sMaxH: N(0.58, 'H', 0.01, 'docs/research/01-stances.md §3.1', 'DERIVED'),
  rearShankLeanDeg: N(45.7, 'deg', 3, 'docs/research/01-stances.md §3.2', 'DERIVED'),
  rearLegLineLeanDeg: N(40.7, 'deg', 3, 'docs/research/01-stances.md §3.2', 'DERIVED'),
  minRearYawForFlatHeelDeg: N(30, 'deg', 2, 'docs/research/01-stances.md §3.5', 'DERIVED'),
  frontShinTiltDeg: N(-2.5, 'deg', 5, 'docs/research/01-stances.md §3.2', 'DERIVED'),
  frontKneeYH: N(0.284, 'H', 0.01, 'docs/research/01-stances.md §3.2', 'DERIVED'),
  /** doc 01 §4.3: kokutsu's geometric MAX length at `PELVIS_Y = 0.410 H`. */
  kokutsuSMaxH: N(0.459, 'H', 0.005, 'docs/research/01-stances.md §4.1', 'DERIVED'),
});
