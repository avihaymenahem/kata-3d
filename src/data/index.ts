/**
 * B1 NUMBERS — `src/data/index.ts`
 *
 * THE BARREL. Every cross-block read of a constant comes through this file
 * (OWNERSHIP rule 3, `tests/contracts/imports.test.ts`): `import { STANCES } from '../data'` is
 * legal, `import { STANCES } from '../data/constants/stances'` is not.
 *
 * This file belongs to B1 and re-exports B2's kata barrel; B2 never edits it (OWNERSHIP B1).
 *
 * ═══ B2'S LANDING SITE — CLOSED IN PHASE 2 ═══════════════════════════════════════════════════
 *
 * §3.13 puts `KATA`, `getKata`, `getPatch` and `validateKata` in B2's barrel at
 * `src/data/kata/index.ts`. Until Phase 2 that file did not exist, so the four names shipped here
 * as typed stubs that threw a RED-FIRST message — they had to EXIST and TYPECHECK from Phase 0
 * because the frozen red-first tests resolve `getKata` against THIS barrel (docs/BRIEFS.md).
 *
 * B2's barrel landed, so the `── B2 LANDING SITE ──` block is gone and the four names are the one
 * re-export the header always specified. Nothing else in this file changed. This edit is the
 * INTEGRATOR step described here from the start, not B2 reaching into B1's file (OWNERSHIP B1).
 *
 * `src/data/patches/**` has existed since Phase 0, so its real registry is re-exported under its
 * own names and was never stubbed.
 */

/* ── B1's own modules ──────────────────────────────────────────────────────────────────────── */

export * from './num';
export * from './constants/anthro';
export * from './constants/stances';
export * from './constants/techniques';
export * from './constants/dynamics';
export * from './constants/rom';
export * from './constants/cloth';
export * from './constants/render';
export * from './constants/camera';
export * from './embusen';

/* ── B2's patch registry. Real, and available now: the 41 move files exist from Phase 0. ───── */

export { PATCHES, TAIKYOKU_SHODAN_PATCHES, HEIAN_SHODAN_PATCHES, movePatch } from './patches';

/* ── B2's kata barrel. §3.13's four names, plus the two scores and the ceremony helpers. ────── */

export { KATA, getKata, getPatch, validateKata } from './kata';
export {
  CLOSING_SECONDS_T1,
  HEIAN_SHODAN,
  LEVEL_ZONE_H,
  OPENING_CEREMONY,
  OPENING_SECONDS_T1,
  TAIKYOKU_SHODAN,
  YAME,
  clipSecondsT1,
  closingCeremony,
  type YameSpec,
} from './kata';
