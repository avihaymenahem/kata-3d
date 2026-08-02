/**
 * tests/contracts/imports.test.ts — the import discipline of ARCHITECTURE.md §3, grep-enforced.
 *
 * MUST PASS FROM PHASE 0. This is the test that keeps `src/solve/**` and `src/eval/**` Node-safe
 * (§9.1 A-12) and keeps every cross-block edge going through a barrel (OWNERSHIP rule 3).
 *
 *   * `import ... from 'three'` is legal ONLY under src/rig, src/render, src/player, src/ui.
 *   * src/solve and src/eval may import ONLY Vector3, Quaternion, Matrix4, Euler, Box3 from
 *     'three' (pure math, Node-safe, doc 07 §6.5 rule 3).
 *   * src/contracts, src/data, src/cloth may not import 'three' at all — with ONE exception,
 *     spelled out below: src/contracts/rig.ts holds the five TYPE-ONLY names that §3.10's
 *     `RigHandles` is literally declared in terms of. `import type` is erased at compile time, so
 *     it emits no module edge and cannot pull GL into the Node path.
 *   * Math.random / Date.now / performance.now / new Date are banned under src/contracts,
 *     src/data, src/solve, src/cloth, src/eval.
 *   * Cross-block imports go ONLY through a block's index.ts barrel.
 *   * ease.ts, time.ts and units.ts are dependency-free (they are shared by the compiler AND the
 *     metrics module, so a hidden import would couple the two — OWNERSHIP B0).
 *
 * Sources are read through `import.meta.glob(..., { query: '?raw' })` rather than `node:fs`: the
 * orchestrator-owned tsconfig sets `types: ["vite/client"]` with no `@types/node`, and adding a
 * dependency is forbidden.
 */

import { describe, expect, it } from 'vitest';

const RAW = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Glob keys are root-absolute ('/src/contracts/bones.ts'); drop the leading slash. */
const SRC: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [k.replace(/^\//, ''), v]),
);
const SRC_FILES = Object.keys(SRC).sort();

/** Blank comments out but PRESERVE newlines, so reported line numbers stay truthful. */
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

interface Imp {
  readonly file: string;
  readonly spec: string;
  readonly stmt: string;
  readonly typeOnly: boolean;
  readonly names: readonly string[];
}

const IMPORT_RE = /\b(?:import|export)\b([^;]*?)\bfrom\s*(['"])([^'"]+)\2/g;
const BARE_IMPORT_RE = /\bimport\s*(['"])([^'"]+)\1\s*;/g;

function importsOf(file: string): Imp[] {
  const src = stripComments(SRC[file] ?? '');
  const out: Imp[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const clause = m[1] ?? '';
    const braced = /\{([\s\S]*?)\}/.exec(clause);
    const raw = braced ? braced[1]!.split(',').map((s) => s.trim()).filter(Boolean) : [];
    out.push({
      file,
      spec: m[3]!,
      stmt: m[0]!.replace(/\s+/g, ' ').trim(),
      typeOnly: /^\s*type\b/.test(clause) || (raw.length > 0 && raw.every((n) => /^type\s/.test(n))),
      names: raw.map((n) => n.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()),
    });
  }
  for (const m of src.matchAll(BARE_IMPORT_RE)) {
    out.push({ file, spec: m[2]!, stmt: m[0]!, typeOnly: false, names: [] });
  }
  return out;
}

const ALL_IMPORTS = SRC_FILES.flatMap(importsOf);

/** Normalise 'src/a/b/../c' -> 'src/a/c'. Pure string work; no node:path. */
function normalisePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Resolve a relative specifier the way `moduleResolution: bundler` and vite both do. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const base = normalisePath(`${dir}/${spec}`);
  for (const c of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (c in SRC) return c;
  }
  return null;
}

/** Top-level tree under src/ — the ownership boundary the barrel rule guards. */
const treeOf = (file: string): string | null => {
  const parts = file.split('/');
  if (parts[0] !== 'src' || parts.length <= 2) return null; // src/main.ts has no tree
  return `src/${parts[1]}`;
};

const THREE_MATH_ALLOWLIST = ['Vector3', 'Quaternion', 'Matrix4', 'Euler', 'Box3'];
const THREE_FREE_TREES = ['src/rig', 'src/render', 'src/player', 'src/ui'];
const THREE_MATH_TREES = ['src/solve', 'src/eval'];
const THREE_BANNED_TREES = ['src/contracts', 'src/data', 'src/cloth'];

/**
 * The single, named exception. §3.10 declares `RigHandles` in terms of `Bone`, `Group`,
 * `SkinnedMesh`, `Mesh` and `Skeleton`; that import is type-only and therefore erased.
 */
const THREE_TYPE_ONLY_EXCEPTION = {
  file: 'src/contracts/rig.ts',
  names: ['Bone', 'Group', 'Mesh', 'Skeleton', 'SkinnedMesh'] as readonly string[],
};

const isThree = (spec: string) => spec === 'three' || spec.startsWith('three/');

describe('the scan itself', () => {
  it('found TypeScript sources under src/', () => {
    expect(SRC_FILES.length).toBeGreaterThan(0);
  });

  it('found exactly the 11 contract files of §4.0', () => {
    expect(SRC_FILES.filter((f) => f.startsWith('src/contracts/'))).toEqual([
      'src/contracts/bones.ts',
      'src/contracts/ease.ts',
      'src/contracts/index.ts',
      'src/contracts/kata.ts',
      'src/contracts/num.ts',
      'src/contracts/pose.ts',
      'src/contracts/rig.ts',
      'src/contracts/scorecard.ts',
      'src/contracts/services.ts',
      'src/contracts/time.ts',
      'src/contracts/units.ts',
    ]);
  });

  it('parses the imports it is asked to police', () => {
    const kata = importsOf('src/contracts/kata.ts');
    expect(kata.map((i) => i.spec).sort()).toEqual(['./bones', './num', './time', './units']);
    expect(kata.every((i) => i.typeOnly)).toBe(true);
    expect(importsOf('src/contracts/rig.ts').some((i) => isThree(i.spec) && i.typeOnly)).toBe(true);
  });
});

describe('§3 — three.js containment', () => {
  it('only src/rig, src/render, src/player, src/ui may import three freely', () => {
    const bad: string[] = [];
    for (const imp of ALL_IMPORTS) {
      if (!isThree(imp.spec)) continue;
      const tree = treeOf(imp.file) ?? 'src';
      if (THREE_FREE_TREES.includes(tree)) continue;

      if (THREE_MATH_TREES.includes(tree)) {
        const illegal = imp.names.filter((n) => !THREE_MATH_ALLOWLIST.includes(n));
        if (illegal.length || imp.names.length === 0) {
          bad.push(`${imp.file}: ${imp.stmt} — only ${THREE_MATH_ALLOWLIST.join(', ')} allowed`);
        }
        continue;
      }

      if (THREE_BANNED_TREES.includes(tree)) {
        const isException =
          imp.file === THREE_TYPE_ONLY_EXCEPTION.file &&
          imp.typeOnly &&
          imp.names.length > 0 &&
          imp.names.every((n) => THREE_TYPE_ONLY_EXCEPTION.names.includes(n));
        if (!isException) bad.push(`${imp.file}: ${imp.stmt} — tree ${tree} may not import three`);
        continue;
      }

      bad.push(`${imp.file}: ${imp.stmt} — tree ${tree} is not on the three allowlist`);
    }
    expect(bad).toEqual([]);
  });

  it('src/contracts imports three ONLY type-only, only in rig.ts, only the five §3.10 names', () => {
    for (const i of ALL_IMPORTS.filter((x) => x.file.startsWith('src/contracts/') && isThree(x.spec))) {
      expect(i.file).toBe(THREE_TYPE_ONLY_EXCEPTION.file);
      expect(i.typeOnly, `${i.file}: ${i.stmt}`).toBe(true);
      for (const n of i.names) expect(THREE_TYPE_ONLY_EXCEPTION.names).toContain(n);
    }
  });

  it('no src file imports a three example/addon outside the render-capable trees', () => {
    const bad = ALL_IMPORTS.filter(
      (i) => i.spec.startsWith('three/examples') && !THREE_FREE_TREES.includes(treeOf(i.file) ?? ''),
    );
    expect(bad.map((b) => `${b.file}: ${b.spec}`)).toEqual([]);
  });
});

describe('§3 / OWNERSHIP rule 3 — barrel-only cross-block imports', () => {
  it('no deep import across a block boundary', () => {
    const bad: string[] = [];
    for (const imp of ALL_IMPORTS) {
      if (!imp.spec.startsWith('.')) continue;
      const target = resolveRelative(imp.file, imp.spec);
      if (target === null) {
        bad.push(`${imp.file}: unresolvable specifier '${imp.spec}'`);
        continue;
      }
      const from = treeOf(imp.file);
      const to = treeOf(target);
      if (to === null || from === to) continue; // intra-tree, unrestricted
      if (target !== `${to}/index.ts`) {
        bad.push(`${imp.file} -> ${target}: deep cross-block import; use the '${to}' barrel`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every relative specifier in src/ resolves to a real file', () => {
    const unresolved = ALL_IMPORTS.filter(
      (i) => i.spec.startsWith('.') && resolveRelative(i.file, i.spec) === null,
    );
    expect(unresolved.map((i) => `${i.file}: ${i.spec}`)).toEqual([]);
  });

  it('no src file imports out of the project (../../ escapes)', () => {
    const bad = ALL_IMPORTS.filter((i) => {
      if (!i.spec.startsWith('.')) return false;
      const dir = i.file.split('/').slice(0, -1).join('/');
      return !normalisePath(`${dir}/${i.spec}`).startsWith('src/');
    });
    expect(bad.map((i) => `${i.file}: ${i.spec}`)).toEqual([]);
  });
});

describe('§3 — the determinism ledger', () => {
  const BANNED_TREES = ['src/contracts', 'src/data', 'src/solve', 'src/cloth', 'src/eval'];
  const RE = /\b(?:Math\.random|Date\.now|performance\.now)\b|\bnew\s+Date\b/;

  it('no wall clock and no unseeded randomness in the compiled/measured trees', () => {
    const bad: string[] = [];
    for (const f of SRC_FILES) {
      const tree = treeOf(f);
      if (!tree || !BANNED_TREES.includes(tree)) continue;
      stripComments(SRC[f]!)
        .split('\n')
        .forEach((l, i) => {
          if (RE.test(l)) bad.push(`${f}:${i + 1}  ${l.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
});

describe('OWNERSHIP B0 — the contract block imports nothing outside itself', () => {
  it('every src/contracts import stays inside src/contracts (three type-only excepted)', () => {
    const bad: string[] = [];
    for (const imp of ALL_IMPORTS) {
      if (!imp.file.startsWith('src/contracts/')) continue;
      if (isThree(imp.spec)) continue; // covered above
      if (!imp.spec.startsWith('.')) {
        bad.push(`${imp.file}: bare import '${imp.spec}'`);
        continue;
      }
      const target = resolveRelative(imp.file, imp.spec);
      if (target === null || !target.startsWith('src/contracts/')) {
        bad.push(`${imp.file} -> ${target ?? imp.spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('ease.ts, time.ts and units.ts are dependency-free', () => {
    for (const f of ['src/contracts/ease.ts', 'src/contracts/time.ts', 'src/contracts/units.ts']) {
      expect(importsOf(f).map((i) => i.spec), f).toEqual([]);
    }
  });

  it('every cross-file contract import is type-only, so the barrel has no runtime cycles', () => {
    // bones.ts <-> pose.ts and scorecard.ts <-> services.ts are mutually referential BY DESIGN
    // (§3.4 LAYER_WRITABLE keys on LayerId; §3.12 RunInfo embeds Scorecard['perf']). That is safe
    // only while every such edge is erased.
    // index.ts is exempt: the barrel's `export * from './x'` MUST be value-level, or none of the
    // frozen constants would cross a block boundary.
    const valueEdges = ALL_IMPORTS.filter(
      (i) =>
        i.file.startsWith('src/contracts/') &&
        i.file !== 'src/contracts/index.ts' &&
        i.spec.startsWith('.') &&
        !i.typeOnly,
    );
    expect(valueEdges.map((i) => `${i.file}: ${i.stmt}`)).toEqual([]);
  });
});

describe('§4 — no file exists that §4 does not list', () => {
  it('src/data/patches holds exactly the 41 move files plus 3 indexes', () => {
    const patches = SRC_FILES.filter((f) => f.startsWith('src/data/patches/'));
    const moves = patches.filter((f) => /move-\d\d\.ts$/.test(f));
    const indexes = patches.filter((f) => f.endsWith('/index.ts'));
    expect(moves.filter((f) => f.includes('taikyoku-shodan'))).toHaveLength(20);
    expect(moves.filter((f) => f.includes('heian-shodan'))).toHaveLength(21);
    expect(moves).toHaveLength(41);
    expect(indexes.sort()).toEqual([
      'src/data/patches/heian-shodan/index.ts',
      'src/data/patches/index.ts',
      'src/data/patches/taikyoku-shodan/index.ts',
    ]);
    expect(patches).toHaveLength(44);
  });

  it('every move file default-exports a MovePatch and imports only the contracts barrel', () => {
    for (const f of SRC_FILES.filter((x) => /src\/data\/patches\/.*move-\d\d\.ts$/.test(x))) {
      const src = SRC[f]!;
      expect(src, f).toMatch(/export default patch;/);
      expect(src, f).toMatch(/const patch: MovePatch = \{/);
      expect(importsOf(f).map((i) => i.spec), f).toEqual(['../../../contracts']);
    }
  });
});
