/**
 * tests/eval/fixsites.test.ts — ARCHITECTURE.md §7.7: "a fix site cannot silently rot".
 *
 * §7.7: "`tests/eval/fixsites.test.ts` reads every declared `fixSite.file`, greps for
 * `fixSite.symbol`, and **fails if it does not resolve to an exported binding**."
 *
 * This is the test that keeps the whole architecture's central claim true — "the shortest edit
 * distance from a critic complaint to a corrected frame … with the file and field name printed by the
 * scorecard, and a test asserting the printed fix site resolves to a real exported binding" (§1).
 *
 * ═══ HOW IT BEHAVES BEFORE EVERY BLOCK HAS LANDED ═════════════════════════════════════════════
 *
 * Three assertions are permanent and hold from Phase 1: the path is inside a real owned tree, the
 * declared `block` matches OWNERSHIP's owner of that path, and no route is missing a hint. The
 * symbol check runs against every file that EXISTS, which today is `src/contracts/**`,
 * `src/data/**` and `src/eval/**` and grows monotonically as B3/B4/B5/B7/B8 land — so this test gets
 * strictly stronger over time and can never go spuriously red for another block.
 *
 * Sources are read through `import.meta.glob(..., '?raw')` rather than `node:fs`, because the
 * orchestrator-owned tsconfig ships no `@types/node` and adding a dependency is forbidden.
 */

import { describe, expect, it } from 'vitest';
import type { BlockId, FixSite } from '../../src/contracts';
import { BLAME_MAP, FAULT_IDS, METRICS, RUBRIC_IDS, blame, resolveMoveSite } from '../../src/eval';

/**
 * `docs/OWNERSHIP.md`'s summary table, as a longest-prefix-wins list. Inlined here rather than put in
 * a helper module because §4's inventory is closed — "nothing may be created that is not listed
 * here" — and `tests/eval/ownership.ts` is not on it.
 *
 * Order matters: `src/data/kata` and `src/data/patches` are B2 while the rest of `src/data` is B1, so
 * the more specific prefixes come first.
 */
const BLOCK_OF_PATH_TABLE: readonly (readonly [string, BlockId])[] = [
  ['src/contracts/', 'B0'],
  ['src/data/kata/', 'B2'],
  ['src/data/patches/', 'B2'],
  ['src/data/', 'B1'],
  ['src/solve/', 'B3'],
  ['src/rig/', 'B4'],
  ['src/render/', 'B5'],
  ['src/player/', 'B6'],
  ['src/main.ts', 'B6'],
  ['src/cloth/', 'B7'],
  ['src/ui/', 'B8'],
  ['src/eval/', 'B9'],
  ['data/reference/', 'B9'],
  ['assets/reference/', 'B9'],
  ['tools/', 'B9'],
];

const blockOfPath = (file: string): BlockId | null => {
  for (const [prefix, block] of BLOCK_OF_PATH_TABLE) if (file.startsWith(prefix)) return block;
  return null;
};

const RAW = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SRC: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [k.replace(/^\//, ''), v]),
);

/** §4's closed module inventory, read as text: a route to a path §4 does not list is rot. */
const DOCS = import.meta.glob('/docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const ARCHITECTURE = DOCS['/docs/ARCHITECTURE.md'] ?? '';

/** Every route the critic loop can emit, metric and non-metric alike. */
const ALL_SITES: readonly { readonly id: string; readonly site: FixSite }[] = Object.entries(BLAME_MAP)
  .flatMap(([id, sites]) => sites.map((site) => ({ id, site })));

/** Resolve `<kata>` / `<NN>` in a move-patch route to a real file that must exist. */
const concrete = (site: FixSite): FixSite => resolveMoveSite(site, 'heian-shodan', 18);

/**
 * Does `file` export `symbol`?
 *
 * Accepts `export const|let|var|function|class NAME`, a named re-export `export { …, NAME, … }`, and
 * — for a per-move patch file — `export default`, because §3.7 makes each of the 41 move files
 * default-export one `MovePatch` and the knob is a FIELD of that default export.
 */
function exportsSymbol(file: string, symbol: string, kind: FixSite['kind']): boolean {
  const src = SRC[file];
  if (src === undefined) return false;
  if (kind === 'move-patch' || kind === 'move-override') return /export\s+default\b/.test(src);
  const decl = new RegExp(`^export\\s+(?:declare\\s+)?(?:const|let|var|function|class)\\s+${symbol}\\b`, 'm');
  if (decl.test(src)) return true;
  const named = new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`, 's');
  return named.test(src);
}

describe('the route table itself', () => {
  it('routes every one of the 63 metrics', () => {
    for (const m of METRICS) {
      expect(blame(m.id).length, m.id).toBeGreaterThan(0);
      // The metric's own fixSite is the FIRST, most-likely site.
      expect(blame(m.id)[0]!.file, m.id).toBe(m.fixSite.file);
    }
  });

  it('routes the doc 01 §9 and doc 03 §11.1 fault families, which have no MetricSpec', () => {
    // Z/K/B/Y/X (doc 01 §9) and F (doc 03 §11.1). Several have no doc 07 metric at all: Z7 knee
    // valgus, F1 chicken-wing, F11 premature roll, F16 no snap-back.
    for (const f of ['Z1', 'Z7', 'Z19', 'K1', 'K10', 'B11', 'Y5', 'X3', 'F1', 'F3', 'F9', 'F11', 'F16']) {
      expect(FAULT_IDS, f).toContain(f);
      expect(blame(f).length, f).toBeGreaterThan(0);
    }
    expect(FAULT_IDS.filter((f) => f.startsWith('Z')).length).toBeGreaterThanOrEqual(22);
    expect(FAULT_IDS.filter((f) => f.startsWith('K')).length).toBeGreaterThanOrEqual(12);
    expect(FAULT_IDS.filter((f) => f.startsWith('F')).length).toBeGreaterThanOrEqual(16);
  });

  it('routes the doc 07 §6.8 rubric ids that no metric backs', () => {
    // These are the ones a Channel-D VLM reports and the router must still place (§4.9 note on
    // docs/critic/routing.md: "the ~20 rubric ids with no metric").
    for (const r of ['A9', 'A10', 'B6', 'B11', 'B15', 'C4', 'C5', 'C7', 'C10', 'C13']) {
      expect(RUBRIC_IDS, r).toContain(r);
      expect(blame(r).length, r).toBeGreaterThan(0);
    }
  });

  it('routes rubric A10 (whole kata mirrored) to the frozen contract, as an integrator change', () => {
    const a10 = blame('A10');
    const frozen = a10.find((s) => s.kind === 'frozen');
    expect(frozen).toBeDefined();
    expect(frozen!.file).toBe('src/contracts/units.ts');
    expect(frozen!.block).toBe('B0');
    expect(frozen!.hint).toMatch(/integrator/i);
    // Channel C is the only independent detector — the hint must say so, or an agent will "fix" it
    // by chasing the scorecard, which is built from the same constant (§7.6).
    expect(frozen!.hint).toMatch(/Channel C/);
  });

  it('gives every route a hint and a block', () => {
    for (const { id, site } of ALL_SITES) {
      expect(site.hint.length, `${id} -> ${site.file}`).toBeGreaterThan(10);
      expect(site.block, `${id} -> ${site.file}`).toMatch(/^B[0-9]$/);
      expect(site.knob.length, `${id} -> ${site.file}`).toBeGreaterThan(0);
    }
  });
});

describe('§7.7 — every fixSite path is real and owned by the block it names', () => {
  it('names a path inside an owned tree', () => {
    const bad: string[] = [];
    for (const { id, site } of ALL_SITES) {
      if (blockOfPath(concrete(site).file) === null) bad.push(`${id} -> ${site.file}`);
    }
    expect(bad).toEqual([]);
  });

  it('declares the block OWNERSHIP.md actually assigns to that path', () => {
    const bad: string[] = [];
    for (const { id, site } of ALL_SITES) {
      const owner = blockOfPath(concrete(site).file);
      if (owner !== null && owner !== site.block) {
        bad.push(`${id} -> ${site.file}: declares ${site.block}, OWNERSHIP says ${owner}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('covers every block that can own a fix', () => {
    const blocks = new Set<BlockId>(ALL_SITES.map(({ site }) => site.block));
    // B6 (player) owns no fix site: nothing in the scorecard routes to the transport or the sampler,
    // because a seek bug shows up as G-7, not as a metric. Recorded so the gap is deliberate.
    expect([...blocks].sort()).toEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B7', 'B8', 'B9']);
  });

  it('has a path->block table that covers every top-level tree §4 lists', () => {
    expect(BLOCK_OF_PATH_TABLE.length).toBeGreaterThanOrEqual(12);
  });
});

describe('§7.7 — the printed symbol resolves to a real exported binding', () => {
  /** Files a route names that exist on disk today. The set grows as blocks land. */
  const existing = ALL_SITES.filter(({ site }) => SRC[concrete(site).file] !== undefined);
  const pending = ALL_SITES.filter(({ site }) => SRC[concrete(site).file] === undefined);

  it('checks a non-trivial number of routes today', () => {
    // A vacuous version of this test would be worse than no test: assert it is doing work.
    expect(existing.length).toBeGreaterThan(40);
  });

  it('resolves every symbol in every file that exists', () => {
    const bad: string[] = [];
    for (const { id, site } of existing) {
      const c = concrete(site);
      if (!exportsSymbol(c.file, c.symbol, c.kind)) {
        bad.push(`${id} -> ${c.file} does not export '${c.symbol}' (knob ${c.knob})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('only leaves routes pending on files ARCHITECTURE §4 actually lists', () => {
    /**
     * The strong form of the pending check: a route to a file that §4's closed inventory does not
     * list is ROT — nothing will ever create it, so the complaint would land nowhere. §4: "Nothing
     * may be created that is not listed here." This assertion does not churn as blocks land; it only
     * gets easier to satisfy, and it catches a typo'd path today.
     *
     * `src/eval/silhouette.ts` (metric 60) is B9's OWN Phase-3 file and is listed in §4.9, so it is
     * legitimately pending here.
     */
    const bad: string[] = [];
    for (const { id, site } of pending) {
      const file = concrete(site).file;
      if (!ARCHITECTURE.includes(file)) bad.push(`${id} -> ${file} is not listed in ARCHITECTURE §4`);
    }
    expect(bad).toEqual([]);
    expect(pending.length, 'pending set should be non-empty before B3/B4/B5/B7/B8 land').toBeGreaterThan(0);
  });

  it('names which blocks still owe a fix-site file, so the gap is visible not silent', () => {
    const owed = [...new Set(pending.map(({ site }) => site.block))].sort();
    // B9 owes exactly one: src/eval/silhouette.ts, metric 60, which also ships `armed: false`.
    expect(owed).toContain('B9');
    expect(blame('silhouette_IoU')[0]!.file).toBe('src/eval/silhouette.ts');
  });
});

describe('the move-patch escape hatch (§9.1 A-9 answer 2)', () => {
  it('resolves <kata>/<NN> to one of the 41 pre-created files', () => {
    const site = blame('Z1').find((s) => s.kind === 'move-override');
    expect(site).toBeDefined();
    const r = resolveMoveSite(site!, 'heian-shodan', 18);
    expect(r.file).toBe('src/data/patches/heian-shodan/move-18.ts');
    expect(SRC[r.file]).toBeDefined();
  });

  it('routes a single-step shrug to the move patch, never to a global solver edit (§7.7 row 11)', () => {
    const f3 = blame('F3');
    expect(f3.some((s) => s.kind === 'move-patch')).toBe(true);
    const patchSite = f3.find((s) => s.kind === 'move-patch')!;
    expect(resolveMoveSite(patchSite, 'heian-shodan', 18).file).toBe(
      'src/data/patches/heian-shodan/move-18.ts',
    );
    expect(patchSite.hint).toMatch(/clavicle/i);
  });

  it('leaves a non-move path untouched', () => {
    const site = METRICS[0]!.fixSite;
    expect(resolveMoveSite(site, 'heian-shodan', 4)).toBe(site);
  });
});
