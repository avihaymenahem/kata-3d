/**
 * tests/kata/patches.test.ts — the 41 per-move patch files, §3.7's escape hatch.
 *
 * OWNERSHIP B2 verification: "41 modules exist, shape-valid, non-empty patch ⇒ non-empty reason".
 *
 * ═══ WHY A NON-EMPTY PATCH WITHOUT A REASON IS A HARD FAILURE ═══════════════════════════════
 * §3.7's whole design is that a per-move patch is a SCOPED, ATTRIBUTED override — the escape hatch
 * that stops a single-step complaint from turning into a global solver or constant edit (§9.1
 * A-9). An unattributed patch is indistinguishable from a fudge factor: it silently moves one move
 * off the doc, and six months later nobody can tell whether it answers a critic finding or hides
 * one. The scorecard prints `reason`, and this test is what guarantees there is something to print.
 *
 * ═══ AND WHY `patches/index.ts` IS ASSERTED TO BE THE PHASE-0 FILE ══════════════════════════
 * The registry is "written once, in Phase 1, and never edited again" — that is what makes two
 * agents fixing two different moves structurally unable to collide. If a fix agent ever adds a
 * move file and edits the index to register it, the collision-freedom argument is gone. The count
 * assertions below are the tripwire.
 */

import { describe, expect, it } from 'vitest';

import {
  HEIAN_SHODAN_PATCHES,
  PATCHES,
  TAIKYOKU_SHODAN_PATCHES,
  getKata,
  getPatch,
  movePatch,
} from '../../src/data';
import { MOVE_COUNT, PATCH_FILE_COUNT } from '../../src/contracts';
import type { KataId, MovePatch, PatchKey } from '../../src/contracts';

const KATA_IDS: readonly KataId[] = ['taikyoku-shodan', 'heian-shodan'];
const ALL: readonly MovePatch[] = [...TAIKYOKU_SHODAN_PATCHES, ...HEIAN_SHODAN_PATCHES];

const AXES: readonly PatchKey['axis'][] = ['x', 'y', 'z'];

describe('§3.7 / §4.2 — the registry', () => {
  it('holds exactly 41 patches: 20 Taikyoku + 21 Heian', () => {
    expect(TAIKYOKU_SHODAN_PATCHES).toHaveLength(MOVE_COUNT['taikyoku-shodan']);
    expect(HEIAN_SHODAN_PATCHES).toHaveLength(MOVE_COUNT['heian-shodan']);
    expect(ALL).toHaveLength(PATCH_FILE_COUNT);
    expect(PATCH_FILE_COUNT).toBe(41);
  });

  it('every slot holds its own kata and its own 1-based move number', () => {
    for (const id of KATA_IDS) {
      PATCHES[id].forEach((p, i) => {
        expect(p.kataId, `${id}[${i}]`).toBe(id);
        expect(p.n, `${id}[${i}]`).toBe(i + 1);
      });
    }
  });

  it('there is exactly one patch per move of each shipped kata', () => {
    for (const id of KATA_IDS) {
      const k = getKata(id);
      expect(PATCHES[id]).toHaveLength(k.moves.length);
      for (const m of k.moves) expect(getPatch(id, m.n).n).toBe(m.n);
    }
  });

  it('getPatch and movePatch are the same lookup, and both throw out of range', () => {
    expect(getPatch('heian-shodan', 21)).toBe(movePatch('heian-shodan', 21));
    expect(() => getPatch('heian-shodan', 22)).toThrowError(/no patch/);
    expect(() => getPatch('taikyoku-shodan', 21)).toThrowError(/no patch/);
    expect(() => getPatch('taikyoku-shodan', 0)).toThrowError(/no patch/);
  });
});

describe('§3.7 — shape', () => {
  it('every patch has the full MovePatch shape, with no optional field left off', () => {
    for (const p of ALL) {
      const where = `${p.kataId} move ${p.n}`;
      expect(typeof p.reason, where).toBe('string');
      expect(p.finding === null || typeof p.finding === 'string', where).toBe(true);
      expect(typeof p.override, where).toBe('object');
      expect(Array.isArray(p.patch), where).toBe(true);
    }
  });

  it('every PatchKey names a real bone axis and a tau inside the move window', () => {
    for (const p of ALL) {
      for (const key of p.patch) {
        const where = `${p.kataId} move ${p.n} / ${key.bone}`;
        expect(AXES, where).toContain(key.axis);
        expect(key.atTau, where).toBeGreaterThanOrEqual(0);
        expect(key.atTau, where).toBeLessThanOrEqual(1);
        expect(Number.isFinite(key.deltaDeg), where).toBe(true);
        expect(key.widthS, where).toBeGreaterThan(0);
      }
    }
  });

  it('a footExcursion override, if present, is net-signed and inside the move', () => {
    for (const p of ALL) {
      const e = p.override.footExcursion;
      if (e === undefined) continue;
      const where = `${p.kataId} move ${p.n}`;
      expect(['L', 'R'], where).toContain(e.foot);
      expect(e.atTau, where).toBeGreaterThan(0);
      expect(e.atTau, where).toBeLessThan(1);
      expect(Number.isFinite(e.deltaL), where).toBe(true);
      expect(Number.isFinite(e.torsoRiseH), where).toBe(true);
    }
  });
});

describe('§3.7 — a non-empty patch MUST carry a reason and a finding id', () => {
  const isEmpty = (p: MovePatch): boolean =>
    p.patch.length === 0 && Object.keys(p.override).length === 0;

  it('reason is non-empty wherever override or patch is non-empty', () => {
    const offenders = ALL.filter((p) => !isEmpty(p) && p.reason.trim() === '')
      .map((p) => `${p.kataId} move ${p.n}`);
    expect(offenders, 'a scoped override with no stated reason is a fudge factor').toEqual([]);
  });

  it('finding is set wherever override or patch is non-empty (OWNERSHIP B2 per-move-fix mode)', () => {
    const offenders = ALL.filter((p) => !isEmpty(p) && (p.finding === null || p.finding.trim() === ''))
      .map((p) => `${p.kataId} move ${p.n}`);
    expect(offenders, 'a routed fix names the finding it answers').toEqual([]);
  });

  it('the converse holds too: an EMPTY patch carries no reason and no finding', () => {
    const offenders = ALL.filter((p) => isEmpty(p) && (p.reason !== '' || p.finding !== null))
      .map((p) => `${p.kataId} move ${p.n}`);
    expect(offenders, 'a reason with nothing to justify is a stale patch').toEqual([]);
  });

  it('ships with all 41 patches empty — Phase 2 has routed no findings yet', () => {
    /* This is a STATE assertion, not a rule: it will legitimately change in Phase 5, when
     * `npm run route` starts writing per-move fixes. Update the expectation then; do not delete
     * the test, because the three above are what keep those fixes attributed. */
    expect(ALL.filter((p) => !isEmpty(p)).map((p) => `${p.kataId} move ${p.n}`)).toEqual([]);
  });
});
