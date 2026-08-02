/**
 * B2 KATA — per-kata patch entry point for `taikyoku-shodan`.
 *
 * The 20 explicit imports live in `../index.ts` (ARCHITECTURE.md §4.2: "PATCHES registry:
 * 41 explicit imports, written ONCE in P1"); this file only re-exports the slice so a consumer
 * that cares about one kata does not have to name the other. Written once, never edited.
 *
 * doc 02-kata-sequences.md §4.1.
 */

export { TAIKYOKU_SHODAN_PATCHES } from '../index';
