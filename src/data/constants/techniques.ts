/**
 * B1 NUMBERS — `src/data/constants/techniques.ts`
 *
 * `TECHNIQUES`, `HIKITE_HIP_A`, `HIKITE_TATE_B`, `TARGET_H`, `HAND_SHAPE_ANGLES`
 * (ARCHITECTURE.md §3.13, §4.1). Sources: doc 03 §4–§13 (keyframes, END table, hand shapes),
 * doc 02 §1.2–§1.3 (target heights, hikite forms), doc 06 §6.2 (elbow pole vectors).
 *
 * ── THE THREE SIGN / FRAME RULES, STATED ONCE ─────────────────────────────────────────────
 *
 * S1. `dx` CARRIES NO SIDE FACTOR. §3.8, verbatim: "dx is written WITHOUT the side factor; solver
 *     applies `-s*dx`." doc 03 writes every lateral offset as `±s·k`, so the stored field is
 *     `dx = +k` where doc 03 writes `-s·k`, and `dx = -k` where doc 03 writes `+s·k`. The doc's
 *     own literal is preserved in `|dx|` and repeated in the comment on every row that flips.
 *
 * S2. `palmNormalStart` / `palmNormalEnd` / `poleDirChest` follow the SAME rule on their `x`
 *     component, so B3 has exactly one convention for the whole interface: the solver applies
 *     `-s` to `x`. doc 03's `(-s·0.72, +0.10, +0.69)` therefore stores `x = +0.72`.
 *
 * S3. Every direction is shipped UNIT. doc 03 quotes several of them pre-normalisation
 *     (`(0,-0.85,+0.53)` has length 1.0017); `u3()` normalises at module load so the source keeps
 *     the doc's literals — greppable — while the shipped tuple satisfies §3.8's "unit".
 *
 * ── MID KEYFRAMES ─────────────────────────────────────────────────────────────────────────
 * doc 03 §4.1's MID row is the exact arithmetic midpoint of START and END on all three axes
 * (`(0.025+0.130)/2 = 0.0775`, `(-0.188-0.118)/2 = -0.153`, `(0.010-0.337)/2 = -0.1635`). The
 * jodan and gedan choku-zuki variants, for which doc 03 prints only START and END, therefore take
 * the same midpoint rule; it is `DERIVED`, stated here, and not re-litigated per row.
 *
 * ── `maxLateralDevH` ──────────────────────────────────────────────────────────────────────
 * A straightness budget only means something for a straight technique. doc 03 §4.2 gives zuki
 * `0.020 H`; §9.3 gives uchi-uke's near-straight rise `0.030 H`. The circular techniques
 * (age-uke, gedan-barai, soto-uke, shuto-uke, tettsui) are ARCS: they get `ARC_LATERAL_DEV_H`,
 * an explicit `ART` budget wide enough not to fire, because metrics 19/44 are straightness
 * metrics and doc 03 publishes no arc-corridor number.
 */

import type {
  HandShape,
  Level,
  Num,
  TechniqueSpec,
  BoneName,
} from '../../contracts';
import { BONE_ORDER } from '../../contracts';
import { A, N } from '../num';

/** Normalise an authored direction to unit length, keeping the doc literals at the call site. */
const u3 = (x: number, y: number, z: number): readonly [number, number, number] => {
  const n = Math.hypot(x, y, z);
  return n === 0 ? [0, 0, 0] : [x / n, y / n, z / n];
};


/** Straightness budget for the circular techniques. See the header note. */
export const ARC_LATERAL_DEV_H = N(0.12, 'H', 0.03, 'docs/research/03-techniques-upper.md §11.1', 'ART');
/** doc 03 §4.2: "max lateral deviation 0.020 H (3.5 cm)", JKA "shortest course to the target". */
const ZUKI_LATERAL_DEV_H = N(0.02, 'H', 0.005, 'docs/research/03-techniques-upper.md §4.2', 'TRAD');
/** doc 03 §9.3: uchi-uke is a near-straight rise; "lateral bulge <= 0.030 H" is hard. */
const UCHI_LATERAL_DEV_H = N(0.03, 'H', 0.005, 'docs/research/03-techniques-upper.md §9.3', 'TRAD');

/* ── doc 06 §6.2 elbow pole-vector defaults, chest-local. `x` follows rule S2. ───────────── */
const POLE_ZUKI = u3(0, -0.85, 0.53);
const POLE_SOTO_SHUTO = u3(-0.4, -0.8, 0.45);
const POLE_AGE_UKE = u3(-0.55, -0.72, 0.42);
const POLE_GEDAN_BARAI = u3(-0.25, -0.9, 0.36);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * TARGET_H — doc 02 §1.2. ABSOLUTE end-effector height as a fraction of H, which is what
 * `TechniqueRef.targetH` carries and what `validateKata` asserts against `tech.level`.
 * The GH-RELATIVE forms of doc 03 §1.5 (jodan +0.087, chudan -0.118, gedan -0.258) are the
 * stance-invariant ones and live on each `TechniqueSpec.end.dy`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const TARGET_H: Readonly<Record<Level, Num>> = Object.freeze({
  jodan: N(0.9, 'H', 0.02, 'docs/research/02-kata-sequences.md §1.2', 'DERIVED'),
  chudan: N(0.72, 'H', 0.02, 'docs/research/02-kata-sequences.md §1.2', 'DERIVED'),
  /** doc 02 §1.2's "gedan-barai blocking-fist end height" — belt level, not knee level (03 §14.2). */
  gedan: N(0.36, 'H', 0.04, 'docs/research/02-kata-sequences.md §1.2', 'DERIVED'),
});

/** doc 03 §1.5's GH-relative target offsets — stance-invariant, USE THESE in the solver. */
export const TARGET_DY_FROM_GH_H: Readonly<Record<Level, Num>> = Object.freeze({
  jodan: N(0.087, 'H', 0.012, 'docs/research/03-techniques-upper.md §1.5', 'TRAD'),
  chudan: N(-0.118, 'H', 0.015, 'docs/research/03-techniques-upper.md §1.5', 'TRAD'),
  gedan: N(-0.258, 'H', 0.02, 'docs/research/03-techniques-upper.md §1.5', 'TRAD'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The disputed scalars that are END CONSTRAINTS rather than `TechniqueSpec` fields.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * D03 — the highest-risk number in doc 03. §2.6 override #35 ships **25°** over doc 07's seeded
 * 45°: doc 03 §14.1 shows 45° puts the wrist at ~1.036 H, above the top of the head, which is
 * incompatible with JKA's own two hard constraints (elbow at eye level, wrist one fist from the
 * forehead).
 */
export const AGE_UKE_FOREARM_INCL_DEG: Num = A(25, 'deg', 8, 'docs/research/03-techniques-upper.md §7.2', 'DERIVED', 'D03', [
  { v: 45, src: 'docs/research/03-techniques-upper.md §14', label: 'themartialway + onlineshotokanacademy 45°' },
]);

/** doc 03 §7.2: the age-uke END constraint JKA states as "approximately one fist". */
export const AGE_UKE_WRIST_TO_FOREHEAD_H = N(0.053, 'H', 0.0275, 'docs/research/03-techniques-upper.md §7.2', 'TRAD');
/** doc 03 §7.2: elbow height at END = `GH_y + 0.115 H` ("the level of the eyes"). */
export const AGE_UKE_ELBOW_ABOVE_GH_H = N(0.115, 'H', 0.02, 'docs/research/03-techniques-upper.md §7.2', 'TRAD');
/** doc 03 §8.2's polar form for gedan-barai, PREFERRED because it is stance-invariant. */
export const GEDAN_BARAI_END_POLAR = Object.freeze({
  radiusH: N(0.3805, 'H', 0.006, 'docs/research/03-techniques-upper.md §8.2', 'DERIVED'),
  depressionDeg: N(30, 'deg', 5, 'docs/research/03-techniques-upper.md §8.2', 'TRAD'),
  azimuthInboardDeg: N(8, 'deg', 5, 'docs/research/03-techniques-upper.md §8.2', 'DERIVED'),
  /** doc 03 §8.3: horizontal clearance in front of the front knee = one fist. */
  knuckleAheadOfKneeH: N(-0.055, 'H', 0.03, 'docs/research/03-techniques-upper.md §8.3', 'TRAD'),
});
/** doc 03 §9.2 / §9.3 / §9.4: elbow clearance outboard of the flank, in FIST_UNITs. */
export const UKE_ELBOW_CLEARANCE_H = Object.freeze({
  soto: N(0.09, 'H', 0.0225, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'),
  uchi: N(0.09, 'H', 0.0225, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'),
  shuto: N(0.077, 'H', 0.0225, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'),
});
/** doc 03 §10.2: the hammer-fist pivots at the ELBOW; its translation is capped hard. */
export const TETTSUI_ELBOW_TRAVEL_MAX_H = N(0.045, 'H', 0.005, 'docs/research/03-techniques-upper.md §10.2', 'TRAD');

/**
 * D04 — the "90° elbow" correction. Every consulted source says 90° for soto/uchi/shuto-uke;
 * doc 03 §9.1 proves that is geometrically impossible with Drillis & Contini segments alongside
 * the same sources' other two constraints, and normatively ships the included angles instead.
 * §2.6 override #37: `flex = 180 - included`, so shuto-uke's 59° included is 121° of flexion.
 */
const d04 = (v: number, src: string): Num =>
  A(v, 'deg', 8, src, 'DERIVED', 'D04', [
    { v: 90, src: 'docs/research/03-techniques-upper.md §9.1', label: 'every consulted source: "a 90-degree bend"' },
  ]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * TECHNIQUES — key `${id}-${level}`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 03 §4.1 START (the hikite chamber) is shared by every zuki variant. */
const ZUKI_START = {
  dx: N(0.025, 'H', 0.015, 'docs/research/03-techniques-upper.md §4.1', 'TRAD'), // doc: -s*0.025
  dy: N(-0.188, 'H', 0.015, 'docs/research/03-techniques-upper.md §4.1', 'TRAD'),
  dz: N(0.01, 'H', 0.02, 'docs/research/03-techniques-upper.md §4.1', 'TRAD'),
} as const;

const CHOKU_ZUKI_CHUDAN: TechniqueSpec = {
  id: 'choku-zuki',
  level: 'chudan',
  refPoint: 'MCP2',
  start: ZUKI_START,
  mid: {
    dx: N(0.0775, 'H', 0.015, 'docs/research/03-techniques-upper.md §4.1', 'DERIVED'), // doc: -s*0.0775
    dy: N(-0.153, 'H', 0.015, 'docs/research/03-techniques-upper.md §4.1', 'DERIVED'),
    dz: N(-0.1635, 'H', 0.02, 'docs/research/03-techniques-upper.md §4.1', 'DERIVED'),
  },
  end: {
    dx: N(0.13, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.130
    dy: N(-0.118, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.337, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  palmNormalStart: u3(0, 1, 0),
  palmNormalEnd: u3(0, -1, 0),
  rollDeg: N(180, 'deg', 8, 'docs/research/03-techniques-upper.md §4.3', 'TRAD'),
  rollWindow: [0.65, 1.0],
  elbowIncludedDeg: N(172, 'deg', 3, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  leader: 'fist',
  poleDirChest: POLE_ZUKI,
  hand: 'seiken',
  maxLateralDevH: ZUKI_LATERAL_DEV_H,
};

/** Midpoint rule (see the header): MID = (START + END)/2 on all three axes. */
const zukiMid = (endDx: number, endDy: number, endDz: number, src: string) => ({
  dx: N((ZUKI_START.dx.v + endDx) / 2, 'H', 0.015, src, 'DERIVED'),
  dy: N((ZUKI_START.dy.v + endDy) / 2, 'H', 0.015, src, 'DERIVED'),
  dz: N((ZUKI_START.dz.v + endDz) / 2, 'H', 0.02, src, 'DERIVED'),
});

const CHOKU_ZUKI_JODAN: TechniqueSpec = {
  ...CHOKU_ZUKI_CHUDAN,
  level: 'jodan',
  mid: zukiMid(0.13, 0.087, -0.346, 'docs/research/03-techniques-upper.md §4.1'),
  end: {
    dx: N(0.13, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.130
    dy: N(0.087, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.346, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  elbowIncludedDeg: N(171, 'deg', 3, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
};

const CHOKU_ZUKI_GEDAN: TechniqueSpec = {
  ...CHOKU_ZUKI_CHUDAN,
  level: 'gedan',
  mid: zukiMid(0.13, -0.258, -0.247, 'docs/research/03-techniques-upper.md §4.1'),
  end: {
    dx: N(0.13, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.130
    dy: N(-0.258, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.247, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
};

/**
 * doc 03 §5.1: "Same torso-relative keyframes as §4.1." The differences (arm = stepping side,
 * pelvis 45 -> 0, arm-stroke start at 60 % of the step) are TIMING and live in `DYN`/`CHANNEL_DYN`,
 * not in the pose. Same for gyaku-zuki (§6): the geometry is identical, the driver is not.
 */
const OI_ZUKI_CHUDAN: TechniqueSpec = { ...CHOKU_ZUKI_CHUDAN, id: 'oi-zuki' };
const OI_ZUKI_JODAN: TechniqueSpec = { ...CHOKU_ZUKI_JODAN, id: 'oi-zuki' };
const GYAKU_ZUKI_CHUDAN: TechniqueSpec = { ...CHOKU_ZUKI_CHUDAN, id: 'gyaku-zuki' };
const GYAKU_ZUKI_JODAN: TechniqueSpec = { ...CHOKU_ZUKI_JODAN, id: 'gyaku-zuki' };

const AGE_UKE_JODAN: TechniqueSpec = {
  id: 'age-uke',
  level: 'jodan',
  refPoint: 'FIST_CENTRE',
  start: {
    dx: N(0.15, 'H', 0.02, 'docs/research/03-techniques-upper.md §7.1', 'TRAD'), // doc: -s*0.150, crossed in front of the chin
    dy: N(0.042, 'H', 0.015, 'docs/research/03-techniques-upper.md §7.1', 'TRAD'),
    dz: N(-0.09, 'H', 0.02, 'docs/research/03-techniques-upper.md §7.1', 'TRAD'),
  },
  mid: {
    dx: N(0.09, 'H', 0.02, 'docs/research/03-techniques-upper.md §7.1', 'TRAD'), // doc: -s*0.090
    dy: N(0.09, 'H', 0.015, 'docs/research/03-techniques-upper.md §7.1', 'TRAD'),
    dz: N(-0.09, 'H', 0.02, 'docs/research/03-techniques-upper.md §7.1', 'TRAD'),
  },
  end: {
    dx: N(0.136, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.136
    dy: N(0.181, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.079, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  /** START palm faces the practitioner; END palm faces forward/outward (three sources agree). */
  palmNormalStart: u3(0, 0, 1),
  palmNormalEnd: u3(0.2, 0.15, -0.97), // doc: (-s*0.20, +0.15, -0.97)
  rollDeg: N(170, 'deg', 20, 'docs/research/03-techniques-upper.md §7.3', 'DERIVED'),
  rollWindow: [0.7, 1.0],
  elbowIncludedDeg: N(83, 'deg', 10, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  leader: 'elbow',
  poleDirChest: POLE_AGE_UKE,
  hand: 'seiken',
  maxLateralDevH: ARC_LATERAL_DEV_H,
};

const GEDAN_BARAI: TechniqueSpec = {
  id: 'gedan-barai',
  level: 'gedan',
  refPoint: 'MCP2',
  start: {
    dx: N(0.18, 'H', 0.02, 'docs/research/03-techniques-upper.md §8.1', 'TRAD'), // doc: -s*0.180, chamber at the opposite earlobe
    dy: N(0.085, 'H', 0.015, 'docs/research/03-techniques-upper.md §8.1', 'TRAD'),
    dz: N(-0.02, 'H', 0.02, 'docs/research/03-techniques-upper.md §8.1', 'TRAD'),
  },
  mid: {
    dx: N(0.11, 'H', 0.02, 'docs/research/03-techniques-upper.md §8.1', 'TRAD'), // doc: -s*0.110
    dy: N(-0.118, 'H', 0.015, 'docs/research/03-techniques-upper.md §8.1', 'TRAD'),
    dz: N(-0.15, 'H', 0.02, 'docs/research/03-techniques-upper.md §8.1', 'TRAD'),
  },
  end: {
    dx: N(0.046, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.046
    dy: N(-0.19, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.326, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  /**
   * doc 03 §8.2: the roll runs "palm-toward-neck -> palm-down". At START the fist is at the
   * OPPOSITE earlobe (`dx` puts it across the body), so palm-toward-neck points back across the
   * midline; under rule S2 that stores as `x = -1`.
   */
  palmNormalStart: u3(-1, 0, 0),
  palmNormalEnd: u3(0, -1, 0),
  rollDeg: N(180, 'deg', 15, 'docs/research/03-techniques-upper.md §8.2', 'TRAD'),
  rollWindow: [0.7, 1.0],
  elbowIncludedDeg: N(172, 'deg', 4, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  leader: 'elbow',
  poleDirChest: POLE_GEDAN_BARAI,
  hand: 'seiken',
  maxLateralDevH: ARC_LATERAL_DEV_H,
};

const SOTO_UKE_CHUDAN: TechniqueSpec = {
  id: 'soto-uke',
  level: 'chudan',
  refPoint: 'FIST_CENTRE',
  start: {
    dx: N(-0.025, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'), // doc: s*0.025, fist up & out above the shoulder
    dy: N(0.15, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'),
    dz: N(-0.175, 'H', 0.025, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'),
  },
  mid: {
    dx: N(-0.075, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'), // doc: s*0.075
    dy: N(0.07, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'),
    dz: N(-0.145, 'H', 0.025, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'),
  },
  end: {
    dx: N(0.03, 'H', 0.035, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.030
    dy: N(-0.01, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.185, 'H', 0.025, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  palmNormalStart: u3(0, 0, -1),
  palmNormalEnd: u3(0, 0, 1),
  rollDeg: N(180, 'deg', 20, 'docs/research/03-techniques-upper.md §9.2', 'TRAD'),
  rollWindow: [0.55, 1.0],
  elbowIncludedDeg: d04(62, 'docs/research/03-techniques-upper.md §13'),
  leader: 'elbow',
  poleDirChest: POLE_SOTO_SHUTO,
  hand: 'seiken',
  maxLateralDevH: ARC_LATERAL_DEV_H,
};

const UCHI_UKE_CHUDAN: TechniqueSpec = {
  id: 'uchi-uke',
  level: 'chudan',
  refPoint: 'FIST_CENTRE',
  start: {
    dx: N(0.055, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'), // doc: -s*0.055, own flank above the hip
    dy: N(-0.175, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'),
    dz: N(-0.03, 'H', 0.025, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'),
  },
  mid: {
    dx: N(0.045, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'), // doc: -s*0.045
    dy: N(-0.085, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'),
    dz: N(-0.115, 'H', 0.025, 'docs/research/03-techniques-upper.md §9.3', 'TRAD'),
  },
  end: {
    dx: N(0, 'H', 0.035, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dy: N(-0.005, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.19, 'H', 0.025, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  palmNormalStart: u3(0, 1, 0),
  palmNormalEnd: u3(0, 0, 1),
  rollDeg: N(90, 'deg', 20, 'docs/research/03-techniques-upper.md §9.3', 'DERIVED'),
  rollWindow: [0.6, 1.0],
  elbowIncludedDeg: d04(63, 'docs/research/03-techniques-upper.md §13'),
  leader: 'elbow',
  poleDirChest: POLE_ZUKI,
  hand: 'seiken',
  maxLateralDevH: UCHI_LATERAL_DEV_H,
};

/**
 * doc 03 §9.4 quotes shuto-uke's three keyframes against THREE different reference points —
 * hand centre at START, wrist at MID, fingertip at END — while `TechniqueSpec` carries one
 * `refPoint`. §13's END table (the row stage S4 asserts) is the FINGERTIP, so that is the shipped
 * `refPoint`; START and MID keep doc 03 §9.4's own numbers and are therefore advisory guides on a
 * near-neighbour of the same hand. Recorded as a handoff to B3.
 */
const SHUTO_UKE_CHUDAN: TechniqueSpec = {
  id: 'shuto-uke',
  level: 'chudan',
  refPoint: 'FINGERTIP',
  start: {
    dx: N(0.23, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'), // doc: -s*0.230, top of the OPPOSITE shoulder
    dy: N(0.027, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'),
    dz: N(-0.06, 'H', 0.025, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'),
  },
  mid: {
    dx: N(0.06, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'), // doc: -s*0.060 (wrist)
    dy: N(0.03, 'H', 0.02, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'),
    dz: N(-0.13, 'H', 0.025, 'docs/research/03-techniques-upper.md §9.4', 'TRAD'),
  },
  end: {
    dx: N(0.01, 'H', 0.03, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.010 (fingertip)
    dy: N(0.005, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.25, 'H', 0.03, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  /** START: back-of-hand outward, across the body. END: doc 03 §9.4's `(-s*0.72, +0.10, +0.69)`. */
  palmNormalStart: u3(1, 0, 0),
  palmNormalEnd: u3(0.72, 0.1, 0.69),
  rollDeg: N(135, 'deg', 20, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
  rollWindow: [0.6, 1.0],
  elbowIncludedDeg: d04(59, 'docs/research/03-techniques-upper.md §13'),
  leader: 'elbow',
  poleDirChest: POLE_SOTO_SHUTO,
  hand: 'shuto',
  maxLateralDevH: ARC_LATERAL_DEV_H,
};

/** doc 03 §10.2 `TATE_MAWASHI_TETTSUI` — Heian Shodan move 4. The elbow is the pivot. */
const TETTSUI_TATE_CHUDAN: TechniqueSpec = {
  id: 'tettsui-tate-mawashi',
  level: 'chudan',
  refPoint: 'FIST_CENTRE',
  start: {
    dx: N(-0.03, 'H', 0.02, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'), // doc: s*0.030, beside/above the same-side ear
    dy: N(0.135, 'H', 0.02, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'),
    dz: N(-0.01, 'H', 0.025, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'),
  },
  mid: {
    dx: N(0.01, 'H', 0.02, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'), // doc: -s*0.010
    dy: N(0.03, 'H', 0.02, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'),
    dz: N(-0.21, 'H', 0.025, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'),
  },
  end: {
    dx: N(0.1, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'DERIVED'), // doc: -s*0.100
    dy: N(-0.118, 'H', 0.02, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
    dz: N(-0.297, 'H', 0.025, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  },
  palmNormalStart: u3(1, 0, 0), // doc: (-s*1, 0, 0) — palm faces inboard toward the head
  palmNormalEnd: u3(0.6, 0.8, 0), // doc: (-s*0.60, +0.80, 0)
  rollDeg: N(60, 'deg', 20, 'docs/research/03-techniques-upper.md §10.2', 'DERIVED'),
  rollWindow: [0.6, 1.0],
  /** Hammer strikes are NEVER fully extended. doc 03 §10.2's 135° is the most speculative row. */
  elbowIncludedDeg: N(135, 'deg', 12, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  leader: 'elbow',
  poleDirChest: POLE_GEDAN_BARAI,
  hand: 'seiken',
  maxLateralDevH: ARC_LATERAL_DEV_H,
};

export const TECHNIQUES: Readonly<Record<string, TechniqueSpec>> = Object.freeze({
  'choku-zuki-chudan': CHOKU_ZUKI_CHUDAN,
  'choku-zuki-jodan': CHOKU_ZUKI_JODAN,
  'choku-zuki-gedan': CHOKU_ZUKI_GEDAN,
  'oi-zuki-chudan': OI_ZUKI_CHUDAN,
  'oi-zuki-jodan': OI_ZUKI_JODAN,
  'gyaku-zuki-chudan': GYAKU_ZUKI_CHUDAN,
  'gyaku-zuki-jodan': GYAKU_ZUKI_JODAN,
  'age-uke-jodan': AGE_UKE_JODAN,
  'gedan-barai-gedan': GEDAN_BARAI,
  'soto-uke-chudan': SOTO_UKE_CHUDAN,
  'uchi-uke-chudan': UCHI_UKE_CHUDAN,
  'shuto-uke-chudan': SHUTO_UKE_CHUDAN,
  'tettsui-tate-mawashi-chudan': TETTSUI_TATE_CHUDAN,
});

/** The `${id}-${level}` key a `TechniqueRef` resolves to. One place, so B2/B3 cannot disagree. */
export const techniqueKey = (id: string, level: Level): string => `${id}-${level}`;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * HIKITE — doc 03 §3 (the canonical form) and doc 03 §9.4 (shuto-uke's different one).
 * doc 02 §1.3 names them HIP-A and TATE-B; `HikiteForm` in §3.6 is that naming.
 *
 * The hikite is the DRIVER, not an afterthought (doc 03 §3, JKA `tai no shinshuku`): its peak
 * angular velocity leads the striking fist's by 20–35 ms, which is `CHANNEL_DYN.hikite.leadMs`
 * minus `CHANNEL_DYN.shoulderGirdle.leadMs`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** HIP-A. `start` is the previous technique's END (the fist is pulled FROM full extension). */
export const HIKITE_HIP_A: TechniqueSpec = {
  id: 'none',
  level: 'gedan',
  refPoint: 'FIST_CENTRE',
  start: {
    dx: N(0.13, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
    dy: N(-0.118, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
    dz: N(-0.337, 'H', 0.015, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  },
  mid: {
    dx: N(0.0775, 'H', 0.02, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
    dy: N(-0.153, 'H', 0.02, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
    dz: N(-0.1585, 'H', 0.025, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
  },
  end: {
    dx: N(0.025, 'H', 0.015, 'docs/research/03-techniques-upper.md §3', 'TRAD'), // doc: -s*0.025, fist on the hip
    dy: N(-0.188, 'H', 0.015, 'docs/research/03-techniques-upper.md §3', 'TRAD'),
    dz: N(0.02, 'H', 0.02, 'docs/research/03-techniques-upper.md §3', 'TRAD'),
  },
  palmNormalStart: u3(0, -1, 0),
  /** JKA "back of the fist facing downward" => palm UP. */
  palmNormalEnd: u3(0, 1, 0),
  rollDeg: N(180, 'deg', 10, 'docs/research/03-techniques-upper.md §3', 'TRAD'),
  rollWindow: [0.6, 1.0],
  elbowIncludedDeg: N(63, 'deg', 8, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
  leader: 'elbow',
  poleDirChest: POLE_ZUKI,
  hand: 'seiken',
  maxLateralDevH: N(0.03, 'H', 0.01, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
};

/** TATE-B — the shuto-uke hikite: OPEN hand, palm UP, in front of the solar plexus. */
export const HIKITE_TATE_B: TechniqueSpec = {
  id: 'none',
  level: 'chudan',
  refPoint: 'HAND_CENTRE',
  /** doc 03 §9.4 chamber, absolute `(-s*0.030, 0.585, -0.090)`, re-expressed GH-relative. */
  start: {
    dx: N(0.16, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
    dy: N(-0.233, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
    dz: N(-0.08, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
  },
  mid: {
    dx: N(0.1475, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
    dy: N(-0.1755, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
    dz: N(-0.0675, 'H', 0.03, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
  },
  end: {
    dx: N(0.135, 'H', 0.03, 'docs/research/03-techniques-upper.md §13', 'TRAD'), // doc: -s*0.135
    dy: N(-0.118, 'H', 0.03, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
    dz: N(-0.055, 'H', 0.03, 'docs/research/03-techniques-upper.md §13', 'TRAD'),
  },
  /** Chamber is palm DOWN; the block completes with the hikite palm UP, fingertips forward. */
  palmNormalStart: u3(0, -1, 0),
  palmNormalEnd: u3(0, 1, 0),
  rollDeg: N(180, 'deg', 15, 'docs/research/03-techniques-upper.md §13', 'DERIVED'),
  rollWindow: [0.6, 1.0],
  elbowIncludedDeg: d04(62, 'docs/research/03-techniques-upper.md §13'),
  leader: 'elbow',
  poleDirChest: POLE_ZUKI,
  hand: 'shuto',
  maxLateralDevH: N(0.03, 'H', 0.01, 'docs/research/03-techniques-upper.md §9.4', 'DERIVED'),
};

/** doc 03 §3 hard limits — faults F9 / F9b measure against these. */
export const HIKITE_LIMITS = Object.freeze({
  elbowDzMinH: N(0.163, 'H', 0.025, 'docs/research/03-techniques-upper.md §3', 'TRAD'),
  elbowDyH: N(-0.09, 'H', 0.02, 'docs/research/03-techniques-upper.md §3', 'TRAD'),
  fistXMinH: N(0.085, 'H', 0.015, 'docs/research/03-techniques-upper.md §3', 'TRAD'),
  elbowXMaxH: N(0.165, 'H', 0.02, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
  elbowYMaxBelowGhH: N(0.07, 'H', 0.015, 'docs/research/03-techniques-upper.md §3', 'DERIVED'),
  /** doc 03 §3: peak angular velocity leads the striking fist's by 0.020–0.035 s. */
  peakLeadS: N(0.0275, 's', 0.0075, 'docs/research/03-techniques-upper.md §3', 'MEASURED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * HAND_SHAPE_ANGLES — doc 03 §12. Per-bone LOCAL Euler triplets in DEGREES, order `ZXY`
 * (doc 06 §0 `rot.order`), written `[x, y, z]`.
 *
 * SIGN: flexion is NEGATIVE about the bone's local X, following doc 06 §3.1's own labelling for
 * the two joints it prints a sign for ("knee flex X flexion −", "elbow flex X flexion −"). Thumb
 * adduction is negative about Z (doc 06 §3.1: "abd/add Z abduction +").
 *
 * The rig has three phalanx bones per hand, so doc 03 §12's four joints map:
 *   `fingers_prox` = MCP · `fingers_dist` = PIP · `fingers_end` = DIP · `thumb` = CMC ·
 *   `thumb_end` = MCP+IP combined · `hand` = the wrist (flex/ext and ulnar deviation)
 *
 * The table is built over `BONE_ORDER` so it is a total `Record<BoneName, …>` (§3.13) with a
 * single source for the non-zero rows; a 53rd bone would fail to compile rather than ship
 * `undefined`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

type Triple = readonly [number, number, number];
const ZERO3: Triple = [0, 0, 0];

/** Non-zero rows only; `_L`/`_R` share the same local angles (the mirror is in the bind pose). */
type HandRows = Partial<Record<string, Triple>>;

/** doc 03 §12.1 SEIKEN — MCP 88, PIP 105, DIP 72, thumb CMC 32 flex / 28 add, IP 35. */
const SEIKEN_ROWS: HandRows = {
  hand: [0, 0, -4], // doc 03 §12.1 wrist flex/ext 0, ulnar dev +4 (ulnar = -Z under doc 06 §3.1)
  fingers_prox: [-88, 0, 0],
  fingers_dist: [-105, 0, 0],
  fingers_end: [-72, 0, 0],
  thumb: [-32, 0, -28],
  thumb_end: [-35, 0, 0],
};

/** doc 03 §12.2 SHUTO — MCP 6, PIP 6, DIP 3, thumb CMC 40 flex / 45 add, IP 30. */
const SHUTO_ROWS: HandRows = {
  hand: [0, 0, 0], // doc 03 §12.2: wrist flex/ext 0 AND ulnar dev 0 (explicit JKA caution)
  fingers_prox: [-6, 0, 0],
  fingers_dist: [-6, 0, 0],
  fingers_end: [-3, 0, 0],
  thumb: [-40, 0, -45],
  thumb_end: [-30, 0, 0],
};

/** doc 03 §12.3 NUKITE — fingers extended and together; middle PIP flexed 12° to level the tips. */
const NUKITE_ROWS: HandRows = {
  hand: [0, 0, 0],
  fingers_prox: [0, 0, 0],
  fingers_dist: [-12, 0, 0],
  fingers_end: [0, 0, 0],
  thumb: [-40, 0, -45],
  thumb_end: [-30, 0, 0],
};

/**
 * OPEN — the relaxed natural hand of doc 02 §2's rei/yoi ("hands open, thumbs tucked"). doc 03
 * publishes no joint table for it, so these are `ART`: a shuto with the tension released.
 */
const OPEN_ROWS: HandRows = {
  hand: [0, 0, 0],
  fingers_prox: [-10, 0, 0],
  fingers_dist: [-8, 0, 0],
  fingers_end: [-4, 0, 0],
  thumb: [-20, 0, -15],
  thumb_end: [-12, 0, 0],
};

const expand = (rows: HandRows): Readonly<Record<BoneName, Triple>> =>
  Object.freeze(
    BONE_ORDER.reduce<Record<BoneName, Triple>>((acc, b) => {
      const stem = b.replace(/_(?:L|R)$/, '');
      acc[b] = rows[stem] ?? ZERO3;
      return acc;
    }, {} as Record<BoneName, Triple>),
  );

export const HAND_SHAPE_ANGLES: Readonly<
  Record<HandShape, Readonly<Record<BoneName, Triple>>>
> = Object.freeze({
  seiken: expand(SEIKEN_ROWS),
  shuto: expand(SHUTO_ROWS),
  open: expand(OPEN_ROWS),
  nukite: expand(NUKITE_ROWS),
});

/** The doc anchor for each hand shape, so `tests/data` and B9 can cite the table as a block. */
export const HAND_SHAPE_SRC: Readonly<Record<HandShape, string>> = Object.freeze({
  seiken: 'docs/research/03-techniques-upper.md §12.1',
  shuto: 'docs/research/03-techniques-upper.md §12.2',
  nukite: 'docs/research/03-techniques-upper.md §12.3',
  open: 'docs/research/02-kata-sequences.md §2',
});
