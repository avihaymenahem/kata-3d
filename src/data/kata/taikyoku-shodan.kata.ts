/**
 * B2 KATA — `src/data/kata/taikyoku-shodan.kata.ts`
 *
 * doc 02 §4.1's movement table and §4.2's embusen table, transcribed ROW FOR ROW. Twenty moves,
 * two techniques (`gedan-barai` ×8, `chudan oi-zuki` ×12), zenkutsu-dachi throughout, kiai at 8
 * and 16. ARCHITECTURE.md §3.6, §8 Phase 2; OWNERSHIP B2.
 *
 * ═══ WHAT IS AUTHORED AND WHAT IS DERIVED ═══════════════════════════════════════════════════
 * AUTHORED, one field per doc column: `dHeadingDeg`, `headingDeg`, `rule`, `pivot`, `mover`,
 * `front`, the technique, `kiai`, `tempo`, `tSlotS`, `sim`, and all three embusen points.
 *
 * `headingDeg` is authored EVEN THOUGH the `dHeadingDeg` chain reproduces it, and the embusen
 * points are authored EVEN THOUGH `footPlanFor` regenerates them, because that redundancy is the
 * entire content of doc 02 §11 invariants 1 and 2: `assertEmbusenInvariants` recomputes both and
 * throws on a mismatch. Deriving either would make the invariant assert `x === x`.
 *
 * The same reasoning governs `pivot`. It is authored from doc 02 §4.1's `Piv` column and CHECKED
 * against `PIVOT_RULE_SPEC` by invariant `I2-pivot-foot` — a wrong pivot is the one embusen error
 * that still closes the heading chain and still lands every `c`, because the generator would place
 * the moving foot from the wrong side and the midpoint would absorb it.
 *
 * DERIVED in `row()` below, because §11's own interop contract states them as definitions rather
 * than observations: `weighted` (`=== front` in zenkutsu), the three labels, `hips`, `hikite`,
 * `pivotKind`, `targetH`. `pause` comes from doc 04 §6.3's own Taikyoku pause map, which is a
 * published table, not a derivation — it is authored below as `PAUSE_MAP`.
 *
 * ═══ THE TWO SOURCE DISAGREEMENTS THIS TABLE RESOLVES (doc 02 §9) ═══════════════════════════
 * `d1` — the 180° turns (3, 11, 19) pivot on the REAR foot. karateyon's front-foot pivot is
 *        rejected: it advances `c` by `+1 L·f_old` and breaks the exact yame closure of §4.3.
 * `d2` — moves 9 and 17 traverse **+270 CCW** (the long way to the character's left), not −90.
 *        The end pose is identical; three sources give 270 and two name the sense as "to the
 *        left". doc 02 uncertainty 5 is the standing note if reference video ever contradicts it.
 *
 * Both are recorded per-move in `notes`, so the scorecard prints the resolution next to any
 * finding that lands on one of those five moves.
 */

import type {
  EmbXZ,
  Handedness,
  HipFacing,
  KataMove,
  KataScore,
  PauseClass,
  PivotKind,
  PivotRule,
  SimRule,
  TechniqueRef,
  TempoClass,
} from '../../contracts';
import { MOVE_SECONDS_T1 } from '../../contracts';
import { CEREMONY_PROVENANCE, OPENING_CEREMONY, closingCeremony } from './ceremony';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The two techniques, as doc 02 §4.1 names them. `targetH` is §1.2's absolute end height; it is
 * redundant with `level` by design and `validateKata` asserts it lands inside `level`'s zone.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

type TechKey = 'gedan-barai' | 'oi-zuki';

interface TechRow {
  readonly ref: Omit<TechniqueRef, 'arm'>;
  readonly romaji: string;
  readonly jp: string;
  readonly en: string;
  /** doc 02 §10: square (shomen) for oi-zuki; 45° hanmi for gedan-barai. */
  readonly hips: HipFacing;
}

const TECH: Readonly<Record<TechKey, TechRow>> = Object.freeze({
  /** doc 02 §1.2 gedan-barai blocking-fist end height 0.36 H (±0.04). */
  'gedan-barai': {
    ref: { id: 'gedan-barai', level: 'gedan', targetH: 0.36, hand: 'seiken' },
    romaji: 'gedan-barai',
    jp: '下段払い',
    en: 'downward block',
    hips: 'hanmi',
  },
  /** doc 02 §1.2 chudan target (solar plexus / suigetsu) 0.72 H (±0.02). */
  'oi-zuki': {
    ref: { id: 'oi-zuki', level: 'chudan', targetH: 0.72, hand: 'seiken' },
    romaji: 'chudan oi-zuki',
    jp: '中段追い突き',
    en: 'middle lunge punch',
    hips: 'shomen',
  },
});

const SIDE_ROMAJI: Readonly<Record<Handedness, string>> = Object.freeze({ L: 'hidari', R: 'migi' });
const SIDE_JP: Readonly<Record<Handedness, string>> = Object.freeze({ L: '左', R: '右' });
const SIDE_EN: Readonly<Record<Handedness, string>> = Object.freeze({ L: 'left', R: 'right' });

/**
 * doc 04 §6.3's **Taikyoku Shodan pause map**, verbatim — the class of the hold that FOLLOWS each
 * count, given the documented counting groups `1-2 | 3-4 | 5-6-7-8ᴷ | 9-10 | 11-12 | 13-14-15-16ᴷ
 * | 17-18 | 19-20ᴷ`. This is a published table, not a derivation, so it is authored:
 *
 *     P1  1,3,5,6,7,9,11,13,14,15,17,19   P2  2,4,10,12,18   P3  8,16   P4  20
 *
 * Note the SHAPE of it, because Heian's map is derived from exactly this rule in the sibling file:
 * P2 marks the count IMMEDIATELY BEFORE a turn (moves 3, 5, 11, 13, 19 are the turns), P3 the
 * kiai counts (which take precedence over P2 at 8 and 16), P4 the last count.
 */
const PAUSE_MAP: Readonly<Record<number, PauseClass>> = Object.freeze({
  1: 'P1', 2: 'P2', 3: 'P1', 4: 'P2', 5: 'P1', 6: 'P1', 7: 'P1', 8: 'P3', 9: 'P1', 10: 'P2',
  11: 'P1', 12: 'P2', 13: 'P1', 14: 'P1', 15: 'P1', 16: 'P3', 17: 'P1', 18: 'P2', 19: 'P1',
  20: 'P4',
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The row builder. One call per doc 02 §4.1 row, in table order.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

interface Row {
  readonly n: number;
  /** §4.1 `ΔH` column. Signed deg, + = to the character's LEFT (CCW seen from +Y). */
  readonly dH: number;
  /** §4.1 `H` column. Authored, then CHECKED against the `dH` chain by invariant I1. */
  readonly h: number;
  readonly rule: PivotRule;
  /** §4.1 `Piv` column: the planted, rotating foot. `null` where the table prints "—". */
  readonly piv: Handedness | null;
  /** §4.1 `Mov` column. */
  readonly mov: Handedness;
  /** The front leg AFTER the move — §4.1's `Fwd` column. */
  readonly front: Handedness;
  readonly tech: TechKey;
  /** §4.1 `arm` column: the working limb. The hikite is the other one. */
  readonly arm: Handedness;
  readonly tempo: TempoClass;
  readonly tSlotS: number;
  readonly sim: SimRule;
  readonly kiai?: true;
  /** §4.2, units of L, AJC projected to the floor, AUTHORED frame. */
  readonly ff: EmbXZ;
  readonly rf: EmbXZ;
  readonly c: EmbXZ;
  /** doc 02 §9 disagreement code, if the row resolves one. */
  readonly notes?: string;
}

/** doc 02 §8 S2: the pivot is an in-place yaw about the HEEL, which JKA keeps down and flat. */
const pivotKindFor = (r: Row): PivotKind => (r.piv === null ? 'NONE' : 'HEEL');

function row(r: Row): KataMove {
  const t = TECH[r.tech];
  const pause = PAUSE_MAP[r.n];
  if (pause === undefined) throw new Error(`taikyoku: no pause class for move ${r.n}`);
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
    stance: 'zenkutsu',
    front: r.front,
    /** §11: `weighted === front` for zenkutsu. Asserted in `validateKata`, not assumed. */
    weighted: r.front,
    hips: t.hips,
    tech: Object.freeze({ ...t.ref, arm: r.arm }),
    /** doc 02 §1.3: every Taikyoku move uses the HIP-A hikite (oi-zuki and gedan-barai both). */
    hikite: 'HIP-A',
    kiai: r.kiai === true,
    tempo: r.tempo,
    pause,
    sim: r.sim,
    tSlotS: r.tSlotS,
    embusen: Object.freeze({ ff: r.ff, rf: r.rf, c: r.c }),
    ...(r.notes === undefined ? {} : { notes: r.notes }),
    src: `02-kata-sequences.md §4.1 row ${r.n}`,
  }) satisfies KataMove;
}

const D1 =
  'doc 02 §9 d1: the 180° turn pivots on the REAR foot. karateyon\'s front-foot pivot advances c ' +
  'by +1 L·f_old and breaks the exact yame closure of §4.3.';
const D2 =
  'doc 02 §9 d2: body yaw traverses +270 CCW (the long way, to the character\'s left), not −90. ' +
  'Net heading is identical either way; see doc 02 uncertainty 5.';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * doc 02 §4.1 / §4.2 — the twenty rows.
 *
 * The `c` column traces the "I": bottom bar (1–4), stem down (5–8), top bar (9–12), stem back up
 * (13–16), bottom bar again (17–20). σ pairs `i ↔ i+8` and `c17..c20 === c1..c4`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const MOVES: readonly KataMove[] = Object.freeze([
  row({ n: 1, dH: 90, h: 90, rule: 'R3', piv: 'R', mov: 'L', front: 'L', tech: 'gedan-barai', arm: 'L',
        tempo: 'M1', tSlotS: 2.0, sim: 'S1',
        ff: [0.81, 0.0], rf: [-0.19, 0.0], c: [0.31, 0.0] }),
  row({ n: 2, dH: 0, h: 90, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [1.81, 0.0], rf: [0.81, 0.0], c: [1.31, 0.0] }),
  row({ n: 3, dH: -180, h: 270, rule: 'R2', piv: 'L', mov: 'R', front: 'R', tech: 'gedan-barai', arm: 'R',
        tempo: 'T180', tSlotS: 2.05, sim: 'S2', notes: D1,
        ff: [-0.19, 0.0], rf: [0.81, 0.0], c: [0.31, 0.0] }),
  row({ n: 4, dH: 0, h: 270, rule: 'R1', piv: null, mov: 'L', front: 'L', tech: 'oi-zuki', arm: 'L',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [-1.19, 0.0], rf: [-0.19, 0.0], c: [-0.69, 0.0] }),
  row({ n: 5, dH: 90, h: 0, rule: 'R4', piv: 'R', mov: 'L', front: 'L', tech: 'gedan-barai', arm: 'L',
        tempo: 'T90', tSlotS: 2.05, sim: 'S2',
        ff: [-0.19, -1.0], rf: [-0.19, 0.0], c: [-0.19, -0.5] }),
  row({ n: 6, dH: 0, h: 0, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [-0.19, -2.0], rf: [-0.19, -1.0], c: [-0.19, -1.5] }),
  row({ n: 7, dH: 0, h: 0, rule: 'R1', piv: null, mov: 'L', front: 'L', tech: 'oi-zuki', arm: 'L',
        tempo: 'F', tSlotS: 0.8, sim: 'S1',
        ff: [-0.19, -3.0], rf: [-0.19, -2.0], c: [-0.19, -2.5] }),
  row({ n: 8, dH: 0, h: 0, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'F', tSlotS: 0.8, sim: 'S1', kiai: true,
        ff: [-0.19, -4.0], rf: [-0.19, -3.0], c: [-0.19, -3.5] }),
  row({ n: 9, dH: 270, h: 270, rule: 'R3', piv: 'R', mov: 'L', front: 'L', tech: 'gedan-barai', arm: 'L',
        tempo: 'T270', tSlotS: 2.5, sim: 'S2', notes: D2,
        ff: [-1.19, -4.0], rf: [-0.19, -4.0], c: [-0.69, -4.0] }),
  row({ n: 10, dH: 0, h: 270, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [-2.19, -4.0], rf: [-1.19, -4.0], c: [-1.69, -4.0] }),
  row({ n: 11, dH: -180, h: 90, rule: 'R2', piv: 'L', mov: 'R', front: 'R', tech: 'gedan-barai', arm: 'R',
        tempo: 'T180', tSlotS: 2.05, sim: 'S2', notes: D1,
        ff: [-0.19, -4.0], rf: [-1.19, -4.0], c: [-0.69, -4.0] }),
  row({ n: 12, dH: 0, h: 90, rule: 'R1', piv: null, mov: 'L', front: 'L', tech: 'oi-zuki', arm: 'L',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [0.81, -4.0], rf: [-0.19, -4.0], c: [0.31, -4.0] }),
  row({ n: 13, dH: 90, h: 180, rule: 'R4', piv: 'R', mov: 'L', front: 'L', tech: 'gedan-barai', arm: 'L',
        tempo: 'T90', tSlotS: 2.05, sim: 'S2',
        ff: [-0.19, -3.0], rf: [-0.19, -4.0], c: [-0.19, -3.5] }),
  row({ n: 14, dH: 0, h: 180, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [-0.19, -2.0], rf: [-0.19, -3.0], c: [-0.19, -2.5] }),
  row({ n: 15, dH: 0, h: 180, rule: 'R1', piv: null, mov: 'L', front: 'L', tech: 'oi-zuki', arm: 'L',
        tempo: 'F', tSlotS: 0.8, sim: 'S1',
        ff: [-0.19, -1.0], rf: [-0.19, -2.0], c: [-0.19, -1.5] }),
  row({ n: 16, dH: 0, h: 180, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'F', tSlotS: 0.8, sim: 'S1', kiai: true,
        ff: [-0.19, 0.0], rf: [-0.19, -1.0], c: [-0.19, -0.5] }),
  row({ n: 17, dH: 270, h: 90, rule: 'R3', piv: 'R', mov: 'L', front: 'L', tech: 'gedan-barai', arm: 'L',
        tempo: 'T270', tSlotS: 2.5, sim: 'S2', notes: D2,
        ff: [0.81, 0.0], rf: [-0.19, 0.0], c: [0.31, 0.0] }),
  row({ n: 18, dH: 0, h: 90, rule: 'R1', piv: null, mov: 'R', front: 'R', tech: 'oi-zuki', arm: 'R',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [1.81, 0.0], rf: [0.81, 0.0], c: [1.31, 0.0] }),
  row({ n: 19, dH: -180, h: 270, rule: 'R2', piv: 'L', mov: 'R', front: 'R', tech: 'gedan-barai', arm: 'R',
        tempo: 'T180', tSlotS: 2.05, sim: 'S2', notes: D1,
        ff: [-0.19, 0.0], rf: [0.81, 0.0], c: [0.31, 0.0] }),
  row({ n: 20, dH: 0, h: 270, rule: 'R1', piv: null, mov: 'L', front: 'L', tech: 'oi-zuki', arm: 'L',
        tempo: 'N', tSlotS: 1.85, sim: 'S1',
        ff: [-1.19, 0.0], rf: [-0.19, 0.0], c: [-0.69, 0.0] }),
]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE SCORE.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const TAIKYOKU_SHODAN: KataScore = Object.freeze({
  schema: 'kata-score/1',
  id: 'taikyoku-shodan',
  displayName: 'Taikyoku Shodan',
  displayNameJp: '太極初段',
  moveCount: MOVES.length,
  /** doc 02 §5: the last chudan oi-zuki at the bottom of the "I" and the last at the top. */
  kiaiAt: Object.freeze([8, 16]),
  /**
   * doc 02 §5: the 2nd and 3rd punch of each triple follow the 1st as a quick "one-two".
   * doc 02 uncertainty 9 records that `1--2--3` (even) is an equally documented phrasing; this
   * spec ships `1---2-3` and B8 exposes the alternative as a switch.
   */
  fastPairs: Object.freeze([Object.freeze([7, 8] as const), Object.freeze([15, 16] as const)]),
  openingCeremony: OPENING_CEREMONY,
  moves: MOVES,
  closingCeremony: closingCeremony('taikyoku-shodan'),
  totalMoveSecondsT1: MOVE_SECONDS_T1['taikyoku-shodan'],
  provenance: Object.freeze([
    '02-kata-sequences.md §4.1 (movement table, 20 rows)',
    '02-kata-sequences.md §4.2 (embusen coordinates, h = 0.19 L)',
    '02-kata-sequences.md §4.3 (yame closure proof, residual 0.00 cm)',
    '02-kata-sequences.md §5 (kiai at 8 and 16; fast pairs (7,8) and (15,16))',
    '04-dynamics-timing.md §6.3 (Taikyoku pause map: P1×12, P2×5, P3×2, P4×1)',
    'Hickey Karate Center, "The First Kata: Taikyoku Shodan" (270° backward to the left; yame)',
    'KarateYon Taikyoku Shodan (full 20-count with degrees and pivot legs)',
    'shotokankarateonline Taikyoku step-by-step; northstowekarate (kiai 8/16, complex moves 9/17)',
    ...CEREMONY_PROVENANCE,
  ]),
}) satisfies KataScore;
