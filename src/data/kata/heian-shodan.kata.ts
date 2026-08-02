/**
 * B2 KATA — `src/data/kata/heian-shodan.kata.ts`
 *
 * doc 02 §6.1's movement table and §6.2's embusen table, transcribed ROW FOR ROW. Twenty-one
 * moves, five techniques (`gedan-barai` ×6, `chudan oi-zuki` ×7, `tettsui tate-mawashi-uchi` ×1,
 * `jodan age-uke` ×3, `chudan shuto-uke` ×4), zenkutsu 1–17 and kokutsu 18–21, kiai at 9 and 17.
 * ARCHITECTURE.md §3.6, §8 Phase 4; OWNERSHIP B2.
 *
 * The authoring discipline is the sibling file's — read `taikyoku-shodan.kata.ts`'s header for
 * what is authored, what is derived, and why the redundant fields stay redundant. Heian adds four
 * things Taikyoku has none of, each called out below.
 *
 * ═══ 1 · THE DIAGONALS ARE AUTHORED AT FULL PRECISION, NOT AT doc 02's THREE DECIMALS ═══════
 * doc 02 §6.2 prints moves 19 and 21 rounded (`+1.517, −0.707`); the generator gives
 * `+1.5171067811865475, −0.70710678118654757`. OWNERSHIP B2's verification asks for agreement to
 * **1e-9 L**, and `src/data/embusen.ts`'s own note says that is "reachable only if B2 authors the
 * unrounded values". So the literals below carry all 17 digits, with doc 02's printed value in the
 * comment beside them. `tests/kata/heian.test.ts` runs `assertEmbusenInvariants(k, 1e-9)`.
 *
 * This is what makes `c(21) = (−0.5435533905932738, −0.3535533905932737)` rather than
 * `(−0.544, −0.354)`. §2.1 assertion 3 pins the rounded form to 3 decimals, and the exact value
 * sits 4.47e-4 from it — inside `toBeCloseTo(…, 3)`'s 5e-4 window, with 11 % to spare. Rounding
 * the literals to make that margin larger would break the 1e-9 recompute; do not.
 *
 * ═══ 2 · MOVE 4 IS THE ONLY `R0`, AND THE ONLY `S3` ═════════════════════════════════════════
 * Net zero displacement (doc 02 §9 d3): the right/front foot slides back 0.50 L at the wind-up
 * peak and returns forward 0.50 L, arriving at kime. The excursion itself is NOT authored here —
 * `src/data/embusen.ts`'s `r0DefaultExcursion` derives it from the move's own tempo class, and a
 * per-move patch can override it (§3.7 `MoveOverride.footExcursion`). Its embusen row is move 3's,
 * unchanged, which is exactly what `footPlanFor` returns for `R0`.
 *
 * ═══ 3 · THE KOKUTSU TAIL (18–21) LIES OUTSIDE THE σ ORBIT ══════════════════════════════════
 * doc 02 §3.2's Heian orbit is `σ(c_i) === c_(i+9)` for `i ∈ {1,2,3}` and
 * `σ(c_5..c_9) === c_13..c_17`. Move 4 has no positional counterpart (it is the zero-displacement
 * move) and moves 18–21 hang off the two diagonal spurs with no σ image anywhere in the kata —
 * `σ(c21) = (+0.1635533905932738, −3.6464466094067262)` matches nothing. See the deviation note in
 * `tests/contracts/handedness.test.ts`: §2.1's original "21 ↔ 12" pairing is arithmetically
 * impossible and was corrected to "3 ↔ 12" at the Phase-0 audit.
 *
 * ═══ 4 · THE FOUR SOURCE DISAGREEMENTS THIS TABLE RESOLVES (doc 02 §9) ══════════════════════
 * `d3/d4` — move 4 is **zenkutsu with net 0** displacement at **0.78 H** end height. renoji-dachi
 *           and neko-ashi are rejected: a retained ½-step shifts every downstream coordinate by
 *           0.50 L and breaks the closure rule.
 * `d6`    — moves 7–9's non-blocking hand is a **closed fist at the hip** (HIP-A), not open.
 * `d7/d8` — moves 10 and 18 are **+270 CCW**. themartialway's "90° left" would force move 14 to be
 *           a right turn and destroy the shared "I" embusen.
 * `d9`    — move 19 is **−45**, move 20 is **−135**. themartialway lists both as 45° right, which
 *           is a transcription error.
 */

import type {
  EmbXZ,
  Handedness,
  HikiteForm,
  HipFacing,
  KataMove,
  KataScore,
  Level,
  PauseClass,
  PivotKind,
  PivotRule,
  SimRule,
  StanceId,
  TechniqueRef,
  TempoClass,
} from '../../contracts';
import { MOVE_SECONDS_T1 } from '../../contracts';
import { CEREMONY_PROVENANCE, OPENING_CEREMONY, closingCeremony } from './ceremony';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The five techniques, as doc 02 §6.1 names them.
 *
 * `targetH` is doc 02 §1.2's absolute end height. Two rows do NOT sit on their level's canonical
 * target and that is deliberate:
 *   - tettsui `0.78` is doc 02 §9 d4's explicit midpoint between Bertel's 0.82 and the "chudan"
 *     0.72, flagged ±0.06 and disputed;
 *   - shuto-uke `0.75` is §1.2's own "blocking-hand centre height", chudan zone, hand near the
 *     shoulder line.
 * Both are inside the chudan ZONE (0.60–0.82), which is what `validateKata` asserts. Asserting
 * `targetH === TARGET_H[level]` instead would reject doc 02's own numbers.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

type TechKey = 'gedan-barai' | 'oi-zuki' | 'tettsui' | 'age-uke' | 'shuto-uke';

interface TechRow {
  readonly ref: Omit<TechniqueRef, 'arm'>;
  readonly romaji: string;
  readonly jp: string;
  readonly en: string;
  /** doc 02 §10: shomen for the thrusting/striking techniques, hanmi for the blocks. */
  readonly hips: HipFacing;
  /** doc 02 §1.3: HIP-A everywhere except chudan shuto-uke, which uses TATE-B. */
  readonly hikite: HikiteForm;
}

const T = (
  id: TechniqueRef['id'],
  level: Level,
  targetH: number,
  hand: TechniqueRef['hand'],
): Omit<TechniqueRef, 'arm'> => Object.freeze({ id, level, targetH, hand });

const TECH: Readonly<Record<TechKey, TechRow>> = Object.freeze({
  /** doc 02 §1.2: gedan-barai blocking-fist end height 0.36 H (±0.04). */
  'gedan-barai': {
    ref: T('gedan-barai', 'gedan', 0.36, 'seiken'),
    romaji: 'gedan-barai', jp: '下段払い', en: 'downward block',
    hips: 'hanmi', hikite: 'HIP-A',
  },
  /** doc 02 §1.2: chudan target (solar plexus / suigetsu) 0.72 H (±0.02). */
  'oi-zuki': {
    ref: T('oi-zuki', 'chudan', 0.72, 'seiken'),
    romaji: 'chudan oi-zuki', jp: '中段追い突き', en: 'middle lunge punch',
    hips: 'shomen', hikite: 'HIP-A',
  },
  /** doc 02 §6.1 move 4 + §9 d4: "chudan-high", 0.78 H ±0.06 — the disputed midpoint. */
  tettsui: {
    ref: T('tettsui-tate-mawashi', 'chudan', 0.78, 'seiken'),
    romaji: 'kentsui tate-mawashi-uchi', jp: '拳槌縦回し打ち',
    en: 'vertical circular hammer-fist strike',
    hips: 'shomen', hikite: 'HIP-A',
  },
  /**
   * doc 02 §6.1: "jodan, defends 0.90; wrist ends 0.97". `targetH` carries the DEFENDED height
   * (§1.2's jodan strike/defence target, the philtrum), not the wrist's; the 0.97 H wrist height
   * is a technique-geometry number and lives on `AGE_UKE_JODAN.end.dy` in B1's table.
   */
  'age-uke': {
    ref: T('age-uke', 'jodan', 0.9, 'seiken'),
    romaji: 'jodan age-uke', jp: '上段揚げ受け', en: 'upper rising block',
    hips: 'shomen', hikite: 'HIP-A',
  },
  /** doc 02 §1.2: shuto-uke blocking-hand centre height 0.75 H (±0.05). doc 02 §1.3: TATE-B. */
  'shuto-uke': {
    ref: T('shuto-uke', 'chudan', 0.75, 'shuto'),
    romaji: 'chudan shuto-uke', jp: '中段手刀受け', en: 'middle knife-hand block',
    hips: 'hanmi', hikite: 'TATE-B',
  },
});

const SIDE_ROMAJI: Readonly<Record<Handedness, string>> = Object.freeze({ L: 'hidari', R: 'migi' });
const SIDE_JP: Readonly<Record<Handedness, string>> = Object.freeze({ L: '左', R: '右' });
const SIDE_EN: Readonly<Record<Handedness, string>> = Object.freeze({ L: 'left', R: 'right' });

/**
 * The pause class of the hold that FOLLOWS each count.
 *
 * doc 04 §6.3 publishes a pause map for Taikyoku only. Its shape is a rule, and the rule
 * reproduces that published map exactly (verified in `tests/kata/taikyoku.test.ts`):
 *
 *     P4  the last count · P3  the kiai counts · P2  the count immediately BEFORE a turn ·
 *     P1  everything else
 *
 * Applied here: turns are at 3, 6, 10, 12, 14, 18, 19, 20, 21, so P2 marks 2, 5, 11, 13, 18, 19,
 * 20; the kiai at 9 and 17 take precedence over P2 at 17; 21 is P4.
 *
 * ONE EXCEPTION, and it is the only P0 in either kata. doc 02 §7 names `(4, 5)` as fast pair C —
 * "the hammer-fist and the punch immediately after it share the same quick cadence" — and doc 04
 * §6.3 defines P0 as exactly that: "in-combination (block+counter in one breath)". Taikyoku's
 * fast pairs are the 2nd and 3rd of a triple and doc 04's own map gives them P1, so this is not a
 * general fast-pair rule; it is move 4 only. (doc 02 §9 d5: the cadence is sourced to dokarate and
 * JKA England prints none, so B8 exposes it as a switch.)
 */
const PAUSE_MAP: Readonly<Record<number, PauseClass>> = Object.freeze({
  1: 'P1', 2: 'P2', 3: 'P1', 4: 'P0', 5: 'P2', 6: 'P1', 7: 'P1', 8: 'P1', 9: 'P3', 10: 'P1',
  11: 'P2', 12: 'P1', 13: 'P2', 14: 'P1', 15: 'P1', 16: 'P1', 17: 'P3', 18: 'P2', 19: 'P2',
  20: 'P2', 21: 'P4',
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The row builder. One call per doc 02 §6.1 row, in table order.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

interface Row {
  readonly n: number;
  readonly dH: number;
  readonly h: number;
  readonly rule: PivotRule;
  readonly piv: Handedness | null;
  readonly mov: Handedness;
  readonly stance: StanceId;
  /** §6.1's `Fwd` column — the front leg after the move. `weighted` is derived from it + stance. */
  readonly front: Handedness;
  readonly tech: TechKey;
  readonly arm: Handedness;
  readonly tempo: TempoClass;
  readonly tSlotS: number;
  readonly sim: SimRule;
  readonly kiai?: true;
  readonly ff: EmbXZ;
  readonly rf: EmbXZ;
  readonly c: EmbXZ;
  readonly notes?: string;
}

/** doc 02 §8 S2: the pivot is an in-place yaw about the HEEL. `R0`/`R1` have no pivot at all. */
const pivotKindFor = (r: Row): PivotKind => (r.piv === null ? 'NONE' : 'HEEL');

/**
 * §11's own definition: `weighted === front` for zenkutsu, `=== rear` for kokutsu. doc 02 §6.1
 * prints it explicitly for 18–21 ("L front (R weighted)"), which is what this reproduces.
 * `validateKata` asserts the rule against every row rather than trusting this one line.
 */
const weightedFor = (r: Row): Handedness =>
  r.stance === 'kokutsu' ? (r.front === 'L' ? 'R' : 'L') : r.front;

function row(r: Row): KataMove {
  const t = TECH[r.tech];
  const pause = PAUSE_MAP[r.n];
  if (pause === undefined) throw new Error(`heian: no pause class for move ${r.n}`);
  return Object.freeze({
    n: r.n,
    label: `${SIDE_ROMAJI[r.arm]} ${t.romaji}`,
    labelJp: `${SIDE_JP[r.arm]}${t.jp}`,
    labelEn: `${SIDE_EN[r.arm]} ${t.en}`,
    dHeadingDeg: r.dH,
    headingDeg: r.h,
    rule: r.rule,
    pivot: r.piv,
    pivotKind: pivotKindFor(r),
    mover: r.mov,
    stance: r.stance,
    front: r.front,
    weighted: weightedFor(r),
    hips: t.hips,
    tech: Object.freeze({ ...t.ref, arm: r.arm }),
    hikite: t.hikite,
    kiai: r.kiai === true,
    tempo: r.tempo,
    pause,
    sim: r.sim,
    tSlotS: r.tSlotS,
    embusen: Object.freeze({ ff: r.ff, rf: r.rf, c: r.c }),
    ...(r.notes === undefined ? {} : { notes: r.notes }),
    src: `02-kata-sequences.md §6.1 row ${r.n}`,
  }) satisfies KataMove;
}

const D3_D4 =
  'doc 02 §9 d3/d4: zenkutsu with NET ZERO displacement (renoji/neko-ashi rejected — a retained ' +
  '½-step shifts every downstream coordinate by 0.50 L), end height 0.78 H ±0.06 (midpoint of ' +
  'Bertel\'s 0.82 and the majority "chudan" 0.72). doc 02 uncertainty 6 keeps this open.';
const D6 =
  'doc 02 §9 d6: the non-blocking hand is a CLOSED fist at the hip (HIP-A). karate-notes\' open ' +
  '"left hand protection" is rejected in favour of the JKA England / techniquesdekarate pattern.';
const D7 =
  'doc 02 §9 d7: +270 CCW. themartialway\'s "90° left" would give H=90, force move 14 to be a ' +
  'RIGHT turn, and destroy the shared "I" embusen.';
const D8 =
  'doc 02 §9 d8: +270 CCW to H=90 (+X side). Required for the mirror with move 20\'s 135° right ' +
  'turn and for the 45° naore.';
const D9 =
  'doc 02 §9 d9: move 19 is −45 and move 20 is −135. themartialway lists both as "45° right", ' +
  'which is a transcription error (JKA England: "⅜ turn to right" = 135°).';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * doc 02 §6.1 / §6.2 — the twenty-one rows.
 *
 * Same "I" as Taikyoku (JKA England: "same embusen as Kihon") plus the two diagonal spurs off the
 * bottom bar at moves 19 and 21.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const MOVES: readonly KataMove[] = Object.freeze([
  row({ n: 1, dH: 90, h: 90, rule: 'R3', piv: 'R', mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'gedan-barai', arm: 'L', tempo: 'M1', tSlotS: 2.2, sim: 'S1',
        ff: [0.81, 0.0], rf: [-0.19, 0.0], c: [0.31, 0.0] }),
  row({ n: 2, dH: 0, h: 90, rule: 'R1', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'oi-zuki', arm: 'R', tempo: 'N', tSlotS: 2.1, sim: 'S1',
        ff: [1.81, 0.0], rf: [0.81, 0.0], c: [1.31, 0.0] }),
  row({ n: 3, dH: -180, h: 270, rule: 'R2', piv: 'L', mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'gedan-barai', arm: 'R', tempo: 'T180', tSlotS: 2.3, sim: 'S2',
        ff: [-0.19, 0.0], rf: [0.81, 0.0], c: [0.31, 0.0] }),
  /** The only `R0` and the only `S3`. Embusen row === move 3's, which is what `footPlanFor` returns. */
  row({ n: 4, dH: 0, h: 270, rule: 'R0', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'tettsui', arm: 'R', tempo: 'N', tSlotS: 2.1, sim: 'S3', notes: D3_D4,
        ff: [-0.19, 0.0], rf: [0.81, 0.0], c: [0.31, 0.0] }),
  row({ n: 5, dH: 0, h: 270, rule: 'R1', piv: null, mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'oi-zuki', arm: 'L', tempo: 'F', tSlotS: 0.85, sim: 'S1',
        ff: [-1.19, 0.0], rf: [-0.19, 0.0], c: [-0.69, 0.0] }),
  row({ n: 6, dH: 90, h: 0, rule: 'R4', piv: 'R', mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'gedan-barai', arm: 'L', tempo: 'T90', tSlotS: 2.3, sim: 'S2',
        ff: [-0.19, -1.0], rf: [-0.19, 0.0], c: [-0.19, -0.5] }),
  row({ n: 7, dH: 0, h: 0, rule: 'R1', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'age-uke', arm: 'R', tempo: 'N', tSlotS: 2.1, sim: 'S1', notes: D6,
        ff: [-0.19, -2.0], rf: [-0.19, -1.0], c: [-0.19, -1.5] }),
  row({ n: 8, dH: 0, h: 0, rule: 'R1', piv: null, mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'age-uke', arm: 'L', tempo: 'F', tSlotS: 0.85, sim: 'S1', notes: D6,
        ff: [-0.19, -3.0], rf: [-0.19, -2.0], c: [-0.19, -2.5] }),
  row({ n: 9, dH: 0, h: 0, rule: 'R1', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'age-uke', arm: 'R', tempo: 'F', tSlotS: 0.85, sim: 'S1', kiai: true, notes: D6,
        ff: [-0.19, -4.0], rf: [-0.19, -3.0], c: [-0.19, -3.5] }),
  row({ n: 10, dH: 270, h: 270, rule: 'R3', piv: 'R', mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'gedan-barai', arm: 'L', tempo: 'T270', tSlotS: 2.8, sim: 'S2', notes: D7,
        ff: [-1.19, -4.0], rf: [-0.19, -4.0], c: [-0.69, -4.0] }),
  row({ n: 11, dH: 0, h: 270, rule: 'R1', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'oi-zuki', arm: 'R', tempo: 'N', tSlotS: 2.1, sim: 'S1',
        ff: [-2.19, -4.0], rf: [-1.19, -4.0], c: [-1.69, -4.0] }),
  row({ n: 12, dH: -180, h: 90, rule: 'R2', piv: 'L', mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'gedan-barai', arm: 'R', tempo: 'T180', tSlotS: 2.3, sim: 'S2',
        ff: [-0.19, -4.0], rf: [-1.19, -4.0], c: [-0.69, -4.0] }),
  row({ n: 13, dH: 0, h: 90, rule: 'R1', piv: null, mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'oi-zuki', arm: 'L', tempo: 'N', tSlotS: 2.1, sim: 'S1',
        ff: [0.81, -4.0], rf: [-0.19, -4.0], c: [0.31, -4.0] }),
  row({ n: 14, dH: 90, h: 180, rule: 'R4', piv: 'R', mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'gedan-barai', arm: 'L', tempo: 'T90', tSlotS: 2.3, sim: 'S2',
        ff: [-0.19, -3.0], rf: [-0.19, -4.0], c: [-0.19, -3.5] }),
  row({ n: 15, dH: 0, h: 180, rule: 'R1', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'oi-zuki', arm: 'R', tempo: 'N', tSlotS: 2.1, sim: 'S1',
        ff: [-0.19, -2.0], rf: [-0.19, -3.0], c: [-0.19, -2.5] }),
  row({ n: 16, dH: 0, h: 180, rule: 'R1', piv: null, mov: 'L', stance: 'zenkutsu', front: 'L',
        tech: 'oi-zuki', arm: 'L', tempo: 'F', tSlotS: 0.85, sim: 'S1',
        ff: [-0.19, -1.0], rf: [-0.19, -2.0], c: [-0.19, -1.5] }),
  row({ n: 17, dH: 0, h: 180, rule: 'R1', piv: null, mov: 'R', stance: 'zenkutsu', front: 'R',
        tech: 'oi-zuki', arm: 'R', tempo: 'F', tSlotS: 0.85, sim: 'S1', kiai: true,
        ff: [-0.19, 0.0], rf: [-0.19, -1.0], c: [-0.19, -0.5] }),
  /** Kokutsu from here. `weighted` flips to the REAR foot — doc 02 §6.1's "(R weighted)" column. */
  row({ n: 18, dH: 270, h: 90, rule: 'R3', piv: 'R', mov: 'L', stance: 'kokutsu', front: 'L',
        tech: 'shuto-uke', arm: 'L', tempo: 'T270', tSlotS: 2.8, sim: 'S2', notes: D8,
        ff: [0.81, 0.0], rf: [-0.19, 0.0], c: [0.31, 0.0] }),
  /** NW spur. doc 02 §6.2 prints ff (+1.517, −0.707), c (+1.164, −0.354); these are the exact values. */
  row({ n: 19, dH: -45, h: 45, rule: 'R5', piv: 'L', mov: 'R', stance: 'kokutsu', front: 'R',
        tech: 'shuto-uke', arm: 'R', tempo: 'D45', tSlotS: 1.75, sim: 'S2', notes: D9,
        ff: [1.5171067811865475, -0.70710678118654757],
        rf: [0.81, 0.0],
        c: [1.1635533905932738, -0.35355339059327379] }),
  row({ n: 20, dH: -135, h: 270, rule: 'R2', piv: 'L', mov: 'R', stance: 'kokutsu', front: 'R',
        tech: 'shuto-uke', arm: 'R', tempo: 'T135', tSlotS: 2.4, sim: 'S2', notes: D9,
        ff: [-0.19, 0.0], rf: [0.81, 0.0], c: [0.31, 0.0] }),
  /** NE spur. doc 02 §6.2 prints ff (−0.897, −0.707), c (−0.544, −0.354) — §2.1 assertion 3's pin. */
  row({ n: 21, dH: 45, h: 315, rule: 'R5', piv: 'R', mov: 'L', stance: 'kokutsu', front: 'L',
        tech: 'shuto-uke', arm: 'L', tempo: 'D45', tSlotS: 1.75, sim: 'S2',
        ff: [-0.89710678118654763, -0.70710678118654735],
        rf: [-0.19, 0.0],
        c: [-0.54355339059327379, -0.35355339059327368] }),
]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE SCORE.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const HEIAN_SHODAN: KataScore = Object.freeze({
  schema: 'kata-score/1',
  id: 'heian-shodan',
  displayName: 'Heian Shodan',
  displayNameJp: '平安初段',
  moveCount: MOVES.length,
  /** doc 02 §7: the 3rd age-uke (right) and the 3rd oi-zuki (right). JKA England prints KIAI at both. */
  kiaiAt: Object.freeze([9, 17]),
  /**
   * doc 02 §7's three pairs, in move order: C `(4,5)` the hammer-fist and its counter, A `(8,9)`
   * the 2nd and 3rd age-uke, B `(16,17)` the 2nd and 3rd oi-zuki. Uncertainty 9 records that the
   * even `1--2--3` phrasing of the two triples is equally documented; B8 exposes the switch.
   */
  fastPairs: Object.freeze([
    Object.freeze([4, 5] as const),
    Object.freeze([8, 9] as const),
    Object.freeze([16, 17] as const),
  ]),
  openingCeremony: OPENING_CEREMONY,
  moves: MOVES,
  closingCeremony: closingCeremony('heian-shodan'),
  totalMoveSecondsT1: MOVE_SECONDS_T1['heian-shodan'],
  provenance: Object.freeze([
    '02-kata-sequences.md §6.1 (movement table, 21 rows)',
    '02-kata-sequences.md §6.2 (embusen coordinates, h = 0.19 L, Lk = 1.00 L; move-4 excursion)',
    '02-kata-sequences.md §6.3 (naore closure proof, residual 0.00 cm)',
    '02-kata-sequences.md §7 (kiai at 9 and 17; fast pairs (4,5), (8,9), (16,17))',
    '02-kata-sequences.md §9 d3/d4/d6/d7/d8/d9 (the six resolutions carried in move `notes`)',
    '04-dynamics-timing.md §6.3 (pause classes; the map is derived by Taikyoku\'s own rule)',
    'JKA England / Copley Heian Shodan sheet (fractional turns, KIAI 9 & 17, 40 s, same embusen as Kihon)',
    'techniquesdekarate (JKA France) 21-count Japanese names; shotokankarateonline pivot feet',
    'Andre Bertel (270° at 18, 135° at 20, tettsui trajectory); shotokanfitness (move 4 half-step)',
    ...CEREMONY_PROVENANCE,
  ]),
}) satisfies KataScore;
