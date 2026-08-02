/**
 * B2 KATA — `src/data/patches/index.ts`
 *
 * The PATCHES registry: all 41 explicit imports, ARCHITECTURE.md §4.2.
 *
 * WRITTEN ONCE, IN PHASE 0, AND NEVER EDITED AGAIN (§9.1 A-9 point 2). That is the whole point:
 * a fix agent scoped to one move edits `<kataId>/move-NN.ts` and nothing else, so two agents
 * fixing two different moves are structurally unable to collide. If you are here to change a
 * move, you are in the wrong file.
 */

import type { KataId, MovePatch } from '../../contracts';
import { MOVE_COUNT, PATCH_FILE_COUNT } from '../../contracts';

import t01 from './taikyoku-shodan/move-01';
import t02 from './taikyoku-shodan/move-02';
import t03 from './taikyoku-shodan/move-03';
import t04 from './taikyoku-shodan/move-04';
import t05 from './taikyoku-shodan/move-05';
import t06 from './taikyoku-shodan/move-06';
import t07 from './taikyoku-shodan/move-07';
import t08 from './taikyoku-shodan/move-08';
import t09 from './taikyoku-shodan/move-09';
import t10 from './taikyoku-shodan/move-10';
import t11 from './taikyoku-shodan/move-11';
import t12 from './taikyoku-shodan/move-12';
import t13 from './taikyoku-shodan/move-13';
import t14 from './taikyoku-shodan/move-14';
import t15 from './taikyoku-shodan/move-15';
import t16 from './taikyoku-shodan/move-16';
import t17 from './taikyoku-shodan/move-17';
import t18 from './taikyoku-shodan/move-18';
import t19 from './taikyoku-shodan/move-19';
import t20 from './taikyoku-shodan/move-20';

import h01 from './heian-shodan/move-01';
import h02 from './heian-shodan/move-02';
import h03 from './heian-shodan/move-03';
import h04 from './heian-shodan/move-04';
import h05 from './heian-shodan/move-05';
import h06 from './heian-shodan/move-06';
import h07 from './heian-shodan/move-07';
import h08 from './heian-shodan/move-08';
import h09 from './heian-shodan/move-09';
import h10 from './heian-shodan/move-10';
import h11 from './heian-shodan/move-11';
import h12 from './heian-shodan/move-12';
import h13 from './heian-shodan/move-13';
import h14 from './heian-shodan/move-14';
import h15 from './heian-shodan/move-15';
import h16 from './heian-shodan/move-16';
import h17 from './heian-shodan/move-17';
import h18 from './heian-shodan/move-18';
import h19 from './heian-shodan/move-19';
import h20 from './heian-shodan/move-20';
import h21 from './heian-shodan/move-21';

/** doc 02 §4.1 — 20 moves, index 0 = move 1. */
export const TAIKYOKU_SHODAN_PATCHES: readonly MovePatch[] = Object.freeze([
  t01, t02, t03, t04, t05, t06, t07, t08, t09, t10,
  t11, t12, t13, t14, t15, t16, t17, t18, t19, t20,
]);

/** doc 02 §6.1 — 21 moves, index 0 = move 1. */
export const HEIAN_SHODAN_PATCHES: readonly MovePatch[] = Object.freeze([
  h01, h02, h03, h04, h05, h06, h07, h08, h09, h10,
  h11, h12, h13, h14, h15, h16, h17, h18, h19, h20,
  h21,
]);

export const PATCHES: Readonly<Record<KataId, readonly MovePatch[]>> = Object.freeze({
  'taikyoku-shodan': TAIKYOKU_SHODAN_PATCHES,
  'heian-shodan': HEIAN_SHODAN_PATCHES,
});

/**
 * Structural self-check, evaluated at module load so a miscounted registry fails the very first
 * import rather than a downstream metric. `tests/kata/patches.test.ts` (B2) covers the shape of
 * each entry; this covers the registry itself.
 */
for (const kataId of Object.keys(PATCHES) as KataId[]) {
  const arr = PATCHES[kataId];
  if (arr.length !== MOVE_COUNT[kataId]) {
    throw new Error(
      `patches/index.ts: ${kataId} has ${arr.length} patch files, expected ${MOVE_COUNT[kataId]}`,
    );
  }
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i]!;
    if (p.kataId !== kataId || p.n !== i + 1) {
      throw new Error(
        `patches/index.ts: slot ${i} of ${kataId} holds ${p.kataId} move ${p.n}`,
      );
    }
  }
}

if (TAIKYOKU_SHODAN_PATCHES.length + HEIAN_SHODAN_PATCHES.length !== PATCH_FILE_COUNT) {
  throw new Error('patches/index.ts: total patch count !== PATCH_FILE_COUNT (41)');
}

/** 1-based move lookup. Throws on an out-of-range move rather than returning undefined. */
export function movePatch(kataId: KataId, n: number): MovePatch {
  const arr = PATCHES[kataId];
  const p = arr[n - 1];
  if (!p) throw new Error(`no patch for ${kataId} move ${n} (1..${arr.length})`);
  return p;
}
