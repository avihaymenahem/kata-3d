/**
 * B2 KATA — `src/data/kata/index.ts`
 *
 * THE KATA BARREL. ARCHITECTURE.md §3.13's "B2 KATA -> B3, B9" block, verbatim:
 *
 *     export const KATA: Readonly<Record<KataId, KataScore>>;
 *     export function getKata(id: KataId): KataScore;
 *     export function getPatch(id: KataId, n: number): MovePatch;
 *     export function validateKata(k: KataScore): void;
 *
 * `src/data/index.ts` re-exports exactly these four names, which is how the rest of the project
 * reaches them (OWNERSHIP rule 3 — nothing outside `src/data` may import this file directly).
 * Landing here retires the four RED-FIRST stubs B1 shipped in its own barrel.
 *
 * ═══ WHY THE FULL `validateKata` DOES NOT RUN AT MODULE LOAD ════════════════════════════════
 * Only the REGISTRY's own shape is checked here — that each entry is filed under its own id and
 * that the two scores are present. The seven doc-02 invariants are stage S0's job (§4.11) and
 * `tests/kata/**`'s; running them at import time would put a doc-02 arithmetic failure into the
 * stack trace of every unrelated module that happens to touch `src/data`, which turns a precise
 * "invariant I3-sigma failed at move 11" into "the data barrel would not load".
 *
 * `src/data/patches/index.ts` does self-check at load, and that is not an inconsistency: a
 * miscounted patch registry is a STRUCTURAL fault with no useful downstream behaviour, whereas a
 * kata whose σ-symmetry is off by 1e-3 still compiles, still plays, and is exactly the thing the
 * critic loop is built to find and route.
 */

import type { KataId, KataScore, MovePatch } from '../../contracts';
import { movePatch } from '../patches';
import { HEIAN_SHODAN } from './heian-shodan.kata';
import { TAIKYOKU_SHODAN } from './taikyoku-shodan.kata';

export { validateKata, LEVEL_ZONE_H } from './validate';
export {
  CLOSING_SECONDS_T1,
  OPENING_CEREMONY,
  OPENING_SECONDS_T1,
  YAME,
  clipSecondsT1,
  closingCeremony,
  type YameSpec,
} from './ceremony';
export { TAIKYOKU_SHODAN } from './taikyoku-shodan.kata';
export { HEIAN_SHODAN } from './heian-shodan.kata';

/** §3.13. Both shipped kata, keyed by `KataId`. */
export const KATA: Readonly<Record<KataId, KataScore>> = Object.freeze({
  'taikyoku-shodan': TAIKYOKU_SHODAN,
  'heian-shodan': HEIAN_SHODAN,
});

/** Registry self-check: every entry filed under its own id. Cheap, structural, load-time. */
for (const id of Object.keys(KATA) as KataId[]) {
  const k = KATA[id];
  if (k.id !== id) throw new Error(`kata/index.ts: slot '${id}' holds kata '${k.id}'`);
}

/**
 * §3.13. Throws on an unknown id rather than returning `undefined` — `KataId` is a closed union,
 * so the only way to get here with a bad id is an unchecked cast at a JSON boundary, and that is
 * precisely where a silent `undefined` would surface as a null-deref three stages later.
 */
export function getKata(id: KataId): KataScore {
  const k = KATA[id];
  if (k === undefined) throw new Error(`no kata '${String(id)}' (have: ${Object.keys(KATA).join(', ')})`);
  return k;
}

/**
 * §3.13. 1-based move lookup into the 41 per-move patch files (§3.7). Delegates to the Phase-0
 * registry rather than re-implementing the lookup: `src/data/patches/index.ts` is written once and
 * never edited, and it is what makes N parallel fix agents collision-free.
 */
export function getPatch(id: KataId, n: number): MovePatch {
  return movePatch(id, n);
}
