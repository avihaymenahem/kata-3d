/**
 * tests/render/bans.test.ts — the §5 banned constructs, grep-enforced over `src/`.
 *
 * ARCHITECTURE.md §4.5: "greps `src/` for `onBeforeCompile`, `material.envMap`, `PCFSoftShadowMap`,
 * `new Clock(`, `FXAAPass`, `TAARenderPass`, `SSAARenderPass`, `DoubleSide`".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE IS ONLY WORTH ANYTHING IF THE DETECTOR ITSELF IS TESTED
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A grep test that passes because its regex never matches anything is indistinguishable from a grep
 * test that passes because the codebase is clean — and the first kind gives false confidence forever.
 * So every ban below is checked twice:
 *
 *   1. against `src/**`, which must be clean;
 *   2. against a SYNTHETIC line that contains the banned construct, which the regex MUST match.
 *
 * The second half is the part that makes "`bans.test.ts` must actually fail if someone introduces
 * `DoubleSide` or a TAA/SSAA pass" a checked claim rather than a hope.
 *
 * The banned tokens appear as literal text in THIS file, which is legal: every ban is scoped to
 * `src/**`, and `tools/verify-contracts.mjs` scopes its own identical bans to `['src', ...]` too. To
 * keep that from being load-bearing, the synthetic fixtures are still assembled from fragments, so a
 * future ban widened to `tests/**` would not turn this file red.
 *
 * Sources are read via `import.meta.glob(..., { query: '?raw' })`, exactly as
 * `tests/contracts/imports.test.ts` does: the orchestrator-owned tsconfig has no `@types/node`, and
 * adding a dependency is forbidden (project constraint 1).
 */

import { describe, expect, it } from 'vitest';

const RAW = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SRC: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [k.replace(/^\//, ''), v]),
);
const SRC_FILES = Object.keys(SRC).sort();

/**
 * Blank comments while PRESERVING newlines, so a reported line number still points at the offending
 * line. Byte-for-byte the same transform `tools/verify-contracts.mjs` `stripComments` applies, so the
 * two verifiers can never disagree about whether a doc comment counts.
 */
const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

interface Ban {
  readonly id: string;
  readonly re: RegExp;
  /** Why it is banned, with the §/doc anchor. Printed on failure. */
  readonly why: string;
  /** A line that MUST match. Assembled from fragments so the fixture is not itself a violation. */
  readonly probe: string;
  /** A near-miss that must NOT match, where the regex is narrow on purpose. */
  readonly antiProbe?: string;
}

const BANS: readonly Ban[] = [
  {
    id: 'DOUBLE_SIDE',
    re: /\bDoubleSide\b/,
    why:
      '§5.5 — the "DoubleSide + backface albedo x0.72" gi trick is unimplementable (no backface ' +
      'colour property exists in three/src/materials, and onBeforeCompile is banned). Deleted and ' +
      'replaced with a real 0.63 mm inner shell in src/cloth/giShell.ts. Every material is FrontSide.',
    probe: `side: ${'Double'}${'Side'},`,
    antiProbe: 'side: BackSide,', // BackSide is legal: stage.ts uses it for the backdrop shell
  },
  {
    id: 'TAA_PASS',
    re: /\bTAARenderPass\b/,
    why:
      '§5.3 — TAARenderPass.js:166 calls camera.clearViewOffset() before returning, so ' +
      'GTAOPass.js:642 computes its G-buffer unjittered and the AO term is bit-identical on every ' +
      'accumulation frame. Superseded by src/render/still.ts (StillAccumulator).',
    probe: `new ${'TAA'}${'RenderPass'}(scene, camera)`,
  },
  {
    id: 'SSAA_PASS',
    re: /\bSSAARenderPass\b/,
    why:
      '§5.3 — SSAARenderPass.js:250-264 restores or clears the view offset before returning; same ' +
      'defect as TAA. Superseded by src/render/still.ts.',
    probe: `new ${'SSAA'}${'RenderPass'}(scene, camera)`,
  },
  {
    id: 'FXAA_PASS',
    re: /\bFXAAPass\b/,
    why:
      '§5.2 / doc 05 §14.1 #20 — FXAA needs sRGB input and must FOLLOW OutputPass, while SMAA works ' +
      'in linear-srgb and must PRECEDE it. They are mutually exclusive and we ship SMAA.',
    probe: `new ${'FXAA'}${'Pass'}()`,
    antiProbe: 'new SMAAPass()', // the one we do ship
  },
  {
    id: 'PCF_SOFT_SHADOW',
    re: /\bPCFSoftShadowMap\b/,
    why:
      '§5.1 / doc 05 §14.1 #1 — deprecated, and WebGLShadowMap.js:99-104 MUTATES ' +
      'renderer.shadowMap.type back to PCFShadowMap inside render(), so writing it and reading it ' +
      'back disagree. PCFShadowMap only.',
    probe: `renderer.shadowMap.type = ${'PCFSoft'}${'ShadowMap'};`,
    antiProbe: 'renderer.shadowMap.type = PCFShadowMap;',
  },
  {
    id: 'ON_BEFORE_COMPILE',
    re: /\bonBeforeCompile\b/,
    why:
      '§5.6 — zero shader-string surgery anywhere in the project. It is also the one thing that ' +
      'makes a future WebGPU port impossible (doc 05 §2.3).',
    probe: `material.${'onBefore'}${'Compile'} = ( shader ) => {};`,
  },
  {
    id: 'MATERIAL_ENVMAP',
    re: /\.envMap\s*=\s*(?!null\b)/,
    why:
      '§5.6 / doc 05 §14.1 #11 — WebGLRenderer.js:2344 lets material.envMap silently OVERRIDE ' +
      'scene.environment, after which scene.environmentIntensity stops applying to that material. ' +
      'There is exactly one environment knob and it lives in src/render/ibl.ts.',
    probe: `mat.${'env'}${'Map'} = rt.texture;`,
    // Explicitly clearing it is fine, and so is the per-material multiplier, which is a DIFFERENT
    // property that M_FLOOR legitimately sets.
    antiProbe: 'mat.envMapIntensity = 1.0;',
  },
  {
    id: 'THREE_CLOCK',
    re: /\bnew\s+Clock\s*\(/,
    why: 'doc 05 §13 / §14.1 #15 — Clock is deprecated (r183) and warns on construction. Use Timer.',
    probe: `const clock = new ${'Clock'}();`,
    antiProbe: 'const timer = new Timer();',
  },
];

describe('the scan itself', () => {
  it('reads the src tree', () => {
    expect(SRC_FILES.length).toBeGreaterThan(0);
    expect(SRC_FILES.some((f) => f.startsWith('src/render/'))).toBe(true);
  });

  it('blanks comments without moving line numbers', () => {
    const src = 'a\n/* DoubleSide\n   more */\nb\n// DoubleSide\nc';
    const out = stripComments(src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(/DoubleSide/.test(out)).toBe(false);
  });
});

describe('§5 — banned constructs are absent from src/', () => {
  for (const ban of BANS) {
    it(`${ban.id} does not appear in src/`, () => {
      const hits: string[] = [];
      for (const f of SRC_FILES) {
        stripComments(SRC[f]!)
          .split('\n')
          .forEach((line, i) => {
            if (ban.re.test(line)) hits.push(`${f}:${i + 1}  ${line.trim()}`);
          });
      }
      expect(hits, `${ban.id} — ${ban.why}`).toEqual([]);
    });
  }
});

describe('§5 — the detector actually detects (this is what makes the file above meaningful)', () => {
  for (const ban of BANS) {
    it(`${ban.id} matches a line that violates it`, () => {
      expect(ban.re.test(ban.probe), `${ban.id} failed to match its own probe: ${ban.probe}`).toBe(
        true,
      );
    });

    if (ban.antiProbe !== undefined) {
      it(`${ban.id} does not match the legal near-miss`, () => {
        expect(
          ban.re.test(ban.antiProbe!),
          `${ban.id} false-positived on legal code: ${ban.antiProbe!}`,
        ).toBe(false);
      });
    }
  }

  it('a synthetic src file containing DoubleSide would fail the scan', () => {
    // The exact shape of the src-tree scan, run against a fabricated file, to prove the whole
    // pipeline (strip -> split -> test) reports rather than swallows.
    const fake = { 'src/render/fake.ts': `import { ${'Double'}${'Side'} } from 'three';\n` };
    const hits: string[] = [];
    for (const [f, body] of Object.entries(fake)) {
      stripComments(body)
        .split('\n')
        .forEach((line, i) => {
          if (/\bDoubleSide\b/.test(line)) hits.push(`${f}:${i + 1}`);
        });
    }
    expect(hits).toEqual(['src/render/fake.ts:1']);
  });

  it('a synthetic src file containing a TAA or SSAA render pass would fail the scan', () => {
    const fake = {
      'src/render/fakeA.ts': `const p = new ${'TAA'}${'RenderPass'}(s, c);\n`,
      'src/render/fakeB.ts': `const q = new ${'SSAA'}${'RenderPass'}(s, c);\n`,
    };
    const re = /\b(?:TAARenderPass|SSAARenderPass)\b/;
    const hits = Object.entries(fake)
      .filter(([, body]) => re.test(stripComments(body)))
      .map(([f]) => f);
    expect(hits.sort()).toEqual(['src/render/fakeA.ts', 'src/render/fakeB.ts']);
  });

  it('a banned construct hidden inside a comment is NOT a violation', () => {
    // Deliberate: src/render/still.ts documents the defect by naming both passes, and
    // tools/verify-contracts.mjs strips comments too. If this ever flips, the two verifiers have
    // drifted and one of them is lying.
    const body = `/** we do not use ${'TAA'}${'RenderPass'} because it clears the view offset */\n`;
    expect(/\bTAARenderPass\b/.test(stripComments(body))).toBe(false);
  });
});

describe('§5.5 / §5.6 — the positive requirements that pair with the bans', () => {
  it('src/render/materials.ts references FrontSide (verify-contracts REQUIRES it)', () => {
    const body = SRC['src/render/materials.ts'];
    expect(body, 'src/render/materials.ts must exist').toBeTypeOf('string');
    expect(/\bFrontSide\b/.test(stripComments(body!))).toBe(true);
  });

  it('no src file constructs an AmbientLight or a HemisphereLight (§5.4 omits both)', () => {
    const hits: string[] = [];
    for (const f of SRC_FILES) {
      stripComments(SRC[f]!)
        .split('\n')
        .forEach((line, i) => {
          if (/\bnew\s+(?:AmbientLight|HemisphereLight)\s*\(/.test(line)) {
            hits.push(`${f}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(
      hits,
      '§5.4 — the ambient wrap is scene.environment at environmentIntensity 0.85. A flat ambient ' +
        'term raises the floor of every shadow and kills the value separation RIM exists for (C8).',
    ).toEqual([]);
  });

  it('src/render never names the three forbidden pass classes outside a comment', () => {
    const re = /\b(?:TAARenderPass|SSAARenderPass|FXAAPass)\b/;
    const hits = SRC_FILES.filter(
      (f) => f.startsWith('src/render/') && re.test(stripComments(SRC[f]!)),
    );
    expect(hits).toEqual([]);
  });
});
