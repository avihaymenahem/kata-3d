/**
 * B2 KATA — `src/data/kata/validate.ts`
 *
 * `validateKata` — doc 02 §11's seven generator invariants plus the structural ones the
 * `KataScore` shape itself owes. ARCHITECTURE.md §3.13; OWNERSHIP B2 ("implements the 7 invariants
 * of 02 §11 and throws with the failing invariant's name").
 *
 * ═══ THE SPLIT WITH `assertEmbusenInvariants`, AND WHY IT IS NOT A DUPLICATE ════════════════
 * doc 02 §11's seven invariants are all POSITIONAL — heading chain, `ff` recompute, σ-symmetry,
 * closure, Σ `tSlotS`, kiai indices, bounding box — and B1 already ships every one of them as
 * `assertEmbusenInvariants` in `src/data/embusen.ts`, because the footfall generator that produces
 * the coordinates lives there and an invariant is worth nothing if it is not run by the code that
 * generates the thing. `validateKata` CALLS it (§3.13's own note: "`validateKata` is expected to
 * call it") and adds the checks that need the rest of the score: the technique table, the stance /
 * weight rules, the ceremony, and the cross-field identities on `KataScore` itself.
 *
 * Re-implementing the seven here would give two copies of doc 02 §11 that can disagree — exactly
 * the failure mode §2.3's DERIVED-not-AUTHORED rule exists to stop.
 *
 * ═══ EVERY THROW NAMES ITS INVARIANT ════════════════════════════════════════════════════════
 * `kata invariant K3-weighted-foot FAILED: …`. Stage S0 and `tests/kata/**` match on the prefix,
 * and the scorecard prints it verbatim, so a routed finding can name the invariant that caught it.
 * The `I*` names come back unchanged from `assertEmbusenInvariants`; the `K*` names are this
 * file's.
 */

import type {
  CeremonyPhase,
  KataMove,
  KataScore,
  Level,
  StanceId,
} from '../../contracts';
import { MOVE_COUNT, MOVE_SECONDS_T1, otherHand } from '../../contracts';
import { assertEmbusenInvariants } from '../embusen';
import { STANCES } from '../constants/stances';
import { TECHNIQUES, techniqueKey } from '../constants/techniques';

const fail = (invariant: string, detail: string): never => {
  throw new Error(`kata invariant ${invariant} FAILED: ${detail}`);
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * doc 02 §1.2's level ZONES — not its point targets.
 *
 * `TechniqueRef.targetH` is redundant with `level` and §3.6 says it is "asserted at validate".
 * The assertion is ZONE membership, because two shipped rows deliberately sit off their level's
 * canonical target: Heian's tettsui at 0.78 H (doc 02 §9 d4's disputed midpoint, ±0.06) and
 * shuto-uke at 0.75 H (§1.2's own "blocking-hand centre height"). Asserting
 * `targetH === TARGET_H[level]` would reject doc 02's own table.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const LEVEL_ZONE_H: Readonly<Record<Level, readonly [number, number]>> = Object.freeze({
  /** doc 02 §1.2 "jodan zone (neck + head)". */
  jodan: Object.freeze([0.84, 1.0] as const),
  /** doc 02 §1.2 "chudan zone (neck → belt)". */
  chudan: Object.freeze([0.6, 0.82] as const),
  /** doc 02 §1.2 "gedan zone (belt → knee)". */
  gedan: Object.freeze([0.28, 0.6] as const),
});

/** doc 02 §2's phase order. A missing or reordered phase is a timeline bug B3 cannot recover from. */
const OPENING_IDS: readonly CeremonyPhase['id'][] = ['REI_IN', 'ANNOUNCE', 'YOI', 'SET'];
const CLOSING_IDS: readonly CeremonyPhase['id'][] = [
  'FINAL_HOLD', 'YAME', 'SETTLE', 'ATTENTION', 'REI_OUT',
];

/** doc 02 §2: `6.70 + kata + 8.20`. Checked as a sum so a retimed phase cannot pass silently. */
export const OPENING_SECONDS_EXPECTED = 6.7;
export const CLOSING_SECONDS_EXPECTED = 8.2;
const CEREMONY_TOL_S = 1e-9;

/** doc 02 §1.3: TATE-B is chudan shuto-uke's hikite and nothing else's in either kata. */
const TATE_B_TECHNIQUES: readonly string[] = ['shuto-uke'];

function checkCeremony(
  k: KataScore,
  phases: readonly CeremonyPhase[],
  want: readonly CeremonyPhase['id'][],
  wantSeconds: number,
  which: string,
): void {
  const got = phases.map((p) => p.id);
  if (got.length !== want.length || got.some((id, i) => id !== want[i])) {
    fail('K7-ceremony-order', `${k.id} ${which}: [${got.join(', ')}], expected [${want.join(', ')}]`);
  }
  for (const p of phases) {
    if (!(p.durationS > 0)) {
      fail('K7-ceremony-duration', `${k.id} ${which} ${p.id}: durationS ${p.durationS} <= 0`);
    }
    if (!(p.stance in STANCES)) {
      fail('K7-ceremony-stance', `${k.id} ${which} ${p.id}: unknown stance '${p.stance}'`);
    }
  }
  const sum = phases.reduce((a, p) => a + p.durationS, 0);
  if (Math.abs(sum - wantSeconds) > CEREMONY_TOL_S) {
    fail('K7-ceremony-total', `${k.id} ${which}: ${sum} s, doc 02 §2 says ${wantSeconds} s`);
  }
}

function checkMove(k: KataScore, m: KataMove): void {
  /* Both kata have a "move 4", and a routed finding is scoped to one of them. Always name it. */
  const at = `${k.id} move ${m.n}`;

  /* ── K1 · the technique resolves in B1's table at the `${id}-${level}` key. ── */
  const key = techniqueKey(m.tech.id, m.tech.level);
  if (m.tech.id !== 'none' && !(key in TECHNIQUES)) {
    fail('K1-technique-key', `${at}: '${key}' is not in TECHNIQUES`);
  }

  /* ── K2 · `targetH` lies inside its level's doc 02 §1.2 zone. ── */
  const zone = LEVEL_ZONE_H[m.tech.level];
  if (m.tech.targetH < zone[0] || m.tech.targetH > zone[1]) {
    fail(
      'K2-target-zone',
      `${at}: targetH ${m.tech.targetH} outside the ${m.tech.level} zone [${zone[0]}, ${zone[1]}]`,
    );
  }

  /* ── K3 · `weighted === front` for zenkutsu, `=== rear` for kokutsu (§11's own definition). ── */
  const wantWeighted = m.stance === 'kokutsu' ? otherHand(m.front) : m.front;
  if (m.weighted !== wantWeighted) {
    fail(
      'K3-weighted-foot',
      `${at} (${m.stance}, front ${m.front}): weighted ${m.weighted}, expected ${wantWeighted}`,
    );
  }

  /* ── K4 · the stance exists, and the pivot/mover pair is coherent. ── */
  if (!(m.stance in STANCES)) {
    fail('K4-stance', `${at}: unknown stance '${String(m.stance as StanceId)}'`);
  }
  if (m.pivot !== null && m.pivot === m.mover) {
    fail('K4-pivot-mover', `${at}: foot ${m.pivot} cannot both pivot and move`);
  }
  /* A pivot foot rotates about a stored point; no pivot means no pivot kind, and vice versa. */
  if ((m.pivot === null) !== (m.pivotKind === 'NONE')) {
    fail(
      'K4-pivot-kind',
      `${at}: pivot ${String(m.pivot)} with pivotKind '${m.pivotKind}' — one implies the other`,
    );
  }

  /* ── K5 · the hikite form matches the technique (doc 02 §1.3). ── */
  const wantTateB = TATE_B_TECHNIQUES.includes(m.tech.id);
  if (wantTateB !== (m.hikite === 'TATE-B')) {
    fail(
      'K5-hikite-form',
      `${at} (${m.tech.id}): hikite '${m.hikite}', expected '${wantTateB ? 'TATE-B' : 'HIP-A'}'`,
    );
  }

  /* ── K6 · `tSlotS` is a real, positive duration. ── */
  if (!Number.isFinite(m.tSlotS) || m.tSlotS <= 0) {
    fail('K6-tslot', `${at}: tSlotS ${m.tSlotS}`);
  }

  /* ── K8 · the doc anchor is present and names this move's row. ── */
  if (!/§\d+\.\d+ row \d+$/.test(m.src)) {
    fail('K8-src-anchor', `${at}: src '${m.src}' does not end in a '§x.y row N' anchor`);
  }
  if (!m.src.endsWith(` row ${m.n}`)) {
    fail('K8-src-row', `${at}: src '${m.src}' points at a different row`);
  }
}

/**
 * §3.13. Throws with the failing invariant's name; returns `void` on success.
 *
 * Pure and side-effect free: it reads `k`, B1's constant tables and nothing else — no wall clock,
 * no randomness, no mutation — so `compileKata` may call it inside stage S0 without perturbing
 * the byte-identical-recompile guarantee of `tests/solve/repeat.test.ts`.
 */
export function validateKata(k: KataScore): void {
  /* ── K0 · the score's own cross-field identities. ── */
  if (k.schema !== 'kata-score/1') {
    fail('K0-schema', `${k.id}: schema '${String(k.schema)}'`);
  }
  if (k.moveCount !== k.moves.length) {
    fail('K0-move-count', `${k.id}: moveCount ${k.moveCount}, moves.length ${k.moves.length}`);
  }
  if (k.moves.length !== MOVE_COUNT[k.id]) {
    fail('K0-move-count-frozen', `${k.id}: ${k.moves.length} moves, §3.7 MOVE_COUNT says ${MOVE_COUNT[k.id]}`);
  }
  k.moves.forEach((m, i) => {
    if (m.n !== i + 1) fail('K0-move-index', `${k.id}: slot ${i} holds move ${m.n}`);
  });
  if (k.totalMoveSecondsT1 !== MOVE_SECONDS_T1[k.id]) {
    fail(
      'K0-total-seconds',
      `${k.id}: totalMoveSecondsT1 ${k.totalMoveSecondsT1}, time.ts says ${MOVE_SECONDS_T1[k.id]}`,
    );
  }
  if (k.provenance.length === 0) {
    fail('K0-provenance', `${k.id}: provenance is empty`);
  }

  /* ── K1…K6, K8 · per-move. ── */
  for (const m of k.moves) checkMove(k, m);

  /* ── K7 · the two ceremonies (doc 02 §2). ── */
  checkCeremony(k, k.openingCeremony, OPENING_IDS, OPENING_SECONDS_EXPECTED, 'openingCeremony');
  checkCeremony(k, k.closingCeremony, CLOSING_IDS, CLOSING_SECONDS_EXPECTED, 'closingCeremony');
  /* `FINAL_HOLD` is sustained in the LAST MOVE'S stance — a wrong one is a visible pose break. */
  const last = k.moves[k.moves.length - 1];
  const finalHold = k.closingCeremony[0];
  if (last !== undefined && finalHold !== undefined && finalHold.stance !== last.stance) {
    fail(
      'K7-final-hold-stance',
      `${k.id}: FINAL_HOLD is '${finalHold.stance}' but move ${last.n} ends in '${last.stance}'`,
    );
  }

  /* ── K9 · fast pairs are consecutive, in range, and the SECOND member carries tempo `F`. ──
   *
   * Only the second member is constrained, because the two kata disagree about the first and both
   * are doc 02's own tables. Taikyoku's pairs are the 2nd and 3rd punch of a triple, so BOTH
   * members are `F` (§4.1 rows 7–8, 15–16). Heian's pair C is the hammer-fist and its counter, and
   * §6.1 row 4 is `N` while row 5 is `F` — move 4 is a full-tempo strike that the next move
   * follows without a pause. What is common to all five pairs, and therefore what is asserted, is
   * that the SECOND move is the fast one. */
  const paired = new Set<number>();
  for (const [a, b] of k.fastPairs) {
    if (b !== a + 1) fail('K9-fast-pair-adjacent', `${k.id}: pair (${a}, ${b}) is not consecutive`);
    paired.add(a);
    paired.add(b);
    const second = k.moves.find((m) => m.n === b);
    if (second === undefined) fail('K9-fast-pair-range', `${k.id}: pair (${a}, ${b}) has no move ${b}`);
    else if (second.tempo !== 'F') {
      fail('K9-fast-pair-tempo', `${k.id}: move ${b} of pair (${a}, ${b}) has tempo '${second.tempo}', expected 'F'`);
    }
  }
  /* Every `F` move must be a MEMBER of a declared pair — an undeclared fast move is a timing bug
   * the rhythm switch of doc 02 uncertainty 9 would not know to re-phrase. */
  for (const m of k.moves) {
    if (m.tempo === 'F' && !paired.has(m.n)) {
      fail('K9-fast-undeclared', `${k.id}: move ${m.n} is tempo 'F' but is in no fastPairs entry`);
    }
  }

  /* ── doc 02 §11's seven POSITIONAL invariants, from B1's generator. Rethrown unchanged. ── */
  assertEmbusenInvariants(k);
}
