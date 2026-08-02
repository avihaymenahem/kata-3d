/**
 * tests/contracts/freeze.test.ts — the contract hash freeze.
 *
 * MUST PASS FROM PHASE 0. ARCHITECTURE.md §3, §4.0, gate G-10.
 *
 * `src/contracts/**` is authored once, in Phase 0, then READ-ONLY FOREVER. This test recomputes
 * the sha256 of all 11 files and compares them against the FREEZE manifest embedded in
 * `tools/verify-contracts.mjs`.
 *
 * If this fails, the fix is NOT to update the manifest. It is an `[integrator]` commit plus a
 * `docs/CONTRACT-CHANGELOG.md` entry, and every agent stops until it lands (OWNERSHIP B0).
 *
 * Both the sources and the manifest are read with `import.meta.glob(..., { query: '?raw' })`:
 * the orchestrator-owned tsconfig has no `@types/node`, so `node:fs` and `node:crypto` are not
 * typed here. Hashing uses Web Crypto, which produces the same SHA-256 digest as the
 * `node:crypto` call inside the tool over the same UTF-8 bytes.
 */

import { describe, expect, it } from 'vitest';

const CONTRACT_RAW = import.meta.glob('/src/contracts/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const TOOL_RAW = import.meta.glob('/tools/verify-contracts.mjs', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** §4.0, barrel order. Duplicated here on purpose: the test must not read its order from the tool. */
const CONTRACT_FILES = [
  'src/contracts/units.ts',
  'src/contracts/time.ts',
  'src/contracts/ease.ts',
  'src/contracts/num.ts',
  'src/contracts/bones.ts',
  'src/contracts/kata.ts',
  'src/contracts/pose.ts',
  'src/contracts/rig.ts',
  'src/contracts/scorecard.ts',
  'src/contracts/services.ts',
  'src/contracts/index.ts',
] as const;

const SRC: Record<string, string> = Object.fromEntries(
  Object.entries(CONTRACT_RAW).map(([k, v]) => [k.replace(/^\//, ''), v]),
);

const TOOL_SRC = TOOL_RAW['/tools/verify-contracts.mjs'] ?? '';

/** Byte-for-byte the normalisation `tools/verify-contracts.mjs` applies. */
const normalise = (text: string) => text.replace(/\r\n/g, '\n').replace(/\s+$/, '');

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Pull the FREEZE object literal out of the tool source. */
function parseFreeze(toolSrc: string): Record<string, string> {
  const block = /const FREEZE = \{([\s\S]*?)\n\};/.exec(toolSrc);
  if (!block) throw new Error('tools/verify-contracts.mjs: no FREEZE block found');
  const out: Record<string, string> = {};
  for (const m of block[1]!.matchAll(/'([^']+)'\s*:\s*'([^']*)'/g)) out[m[1]!] = m[2]!;
  return out;
}

/** Re-implementation of the tool's `contractHash`, so the digest is checked, not trusted. */
async function contractHash(map: Record<string, string>): Promise<string> {
  let acc = '';
  for (const f of CONTRACT_FILES) acc += `${f} ${map[f]}\n`;
  return (await sha256Hex(acc)).slice(0, 16);
}

describe('§4.0 — the contract file set', () => {
  it('the glob found exactly the 11 files, and the tool lists them in barrel order', () => {
    expect(Object.keys(SRC).sort()).toEqual([...CONTRACT_FILES].sort());
    const listed = /const CONTRACT_FILES = \[([\s\S]*?)\];/.exec(TOOL_SRC);
    expect(listed, 'tools/verify-contracts.mjs must declare CONTRACT_FILES').toBeTruthy();
    const order = [...listed![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(order).toEqual([...CONTRACT_FILES]);
  });

  it('has a frozen hash for every one of them', () => {
    const freeze = parseFreeze(TOOL_SRC);
    const pending = CONTRACT_FILES.filter((f) => !freeze[f] || freeze[f] === 'PENDING');
    expect(pending, 'run: node tools/verify-contracts.mjs --print-hashes').toEqual([]);
    for (const f of CONTRACT_FILES) expect(freeze[f]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('§3 — the freeze holds', () => {
  it('every contract file hashes to its frozen value', async () => {
    const freeze = parseFreeze(TOOL_SRC);
    const drift: string[] = [];
    for (const f of CONTRACT_FILES) {
      const actual = await sha256Hex(normalise(SRC[f]!));
      if (freeze[f] !== actual) drift.push(`${f}\n  frozen ${freeze[f]}\n  actual ${actual}`);
    }
    expect(
      drift,
      'src/contracts/** is read-only after Phase 0: this needs an [integrator] commit and a ' +
        'docs/CONTRACT-CHANGELOG.md entry, and every agent stops until it lands.',
    ).toEqual([]);
  });

  it('line endings do not affect the hash', async () => {
    const lf = 'export const A = 1;\nexport const B = 2;\n';
    const crlf = 'export const A = 1;\r\nexport const B = 2;\r\n';
    expect(await sha256Hex(normalise(crlf))).toBe(await sha256Hex(normalise(lf)));
  });

  it('contractHash is a stable 16-hex digest and is sensitive to every member', async () => {
    const map = parseFreeze(TOOL_SRC);
    const h = await contractHash(map);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(await contractHash(map)).toBe(h);
    for (const f of CONTRACT_FILES) {
      const tampered = { ...map, [f]: 'deadbeef' };
      expect(await contractHash(tampered), `contractHash ignores ${f}`).not.toBe(h);
    }
  });
});

describe('§7.2 / G-10 — the tool itself has not lost its teeth', () => {
  it('still greps for every banned construct ARCHITECTURE names', () => {
    for (const id of [
      'DOUBLE_SIDE',
      'TAA_SSAA',
      'FXAA',
      'PCF_SOFT_SHADOW',
      'ON_BEFORE_COMPILE',
      'THREE_CLOCK',
      'COMPUTE_TANGENTS',
      'ANIMATION_MIXER',
      'MATERIAL_ENVMAP',
      'NONDETERMINISM',
      'FINITE_DIFF_NAMED',
      'FINITE_DIFF_ACCEL',
      'SIDE_SIGN_LEAK',
      'YAW_NEGATION',
      'X_NEGATION',
      'SECOND_FRAME_CONVERSION',
      'TEMPO_SCALE_DUP',
    ]) {
      expect(TOOL_SRC, `verify-contracts lost the ${id} ban`).toContain(`id: '${id}'`);
    }
  });

  it('still forbids tools/gen-reference.mjs (§2.6, §4.9)', () => {
    expect(TOOL_SRC).toContain('tools/gen-reference.mjs');
    const forbidden = import.meta.glob('/tools/gen-reference.mjs', { eager: true });
    expect(Object.keys(forbidden), 'gen-reference.mjs must never exist').toEqual([]);
  });

  it('still requires all 18 cross-doc resolutions to be recorded in units.ts', () => {
    const units = SRC['src/contracts/units.ts']!;
    // C01..C14 are §2.5's own table; C15..C18 were added by the Phase-0 adversarial audit
    // (heel-behind-AJC, the measurement-camera frame, doc 04's `L`, and the embusen `h`).
    for (let i = 1; i <= 18; i++) {
      const id = `C${String(i).padStart(2, '0')}`;
      expect(TOOL_SRC, `verify-contracts stopped requiring ${id}`).toContain(`'${id}'`);
      expect(units, `units.ts stopped recording ${id}`).toContain(id);
    }
    // Each id must appear as a ROW of the registry, not merely in prose.
    for (const m of ['C15', 'C16', 'C17', 'C18']) {
      expect(units, `${m} must be a CONFLICT_RESOLUTIONS row`).toMatch(
        new RegExp(`\\{\\s*id:\\s*'${m}'`),
      );
    }
  });

  /**
   * STRUCTURE, not formatting. Asserting the array literal byte-for-byte coupled this frozen test
   * to the whitespace and quote style of a file that changes owner at this very gate (B0 -> B9,
   * OWNERSHIP B9 note): any reformat, added entry or line reflow would have turned it red for a
   * reason unrelated to the freeze, and B9 could not fix it because tests/contracts is frozen.
   */
  it('the handedness allowlists name exactly the sites §2.1 permits', () => {
    /** id -> allowlist, parsed out of each ban object rather than matched as a literal. */
    const allowOf = (id: string): readonly string[] => {
      const at = TOOL_SRC.indexOf(`id: '${id}'`);
      expect(at, `ban ${id} not found`).toBeGreaterThan(-1);
      const block = TOOL_SRC.slice(at, TOOL_SRC.indexOf('\n  },', at));
      const m = /allow:\s*\[([^\]]*)\]/.exec(block);
      return m ? [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [];
    };

    // §2.1: exactly three named sites may carry the X flip. units.ts DEFINES SIDE_SIGN,
    // src/solve/frame.ts is THE runtime conversion, src/rig/bones.ts is the bind-pose flip
    // (tests/contracts/bones.test.ts requires the built rig at position.x = -o[0]*H, and B4
    // cannot reach src/solve). Everything else must use sideSign(h).
    expect([...allowOf('SIDE_SIGN_LEAK')].sort()).toEqual([
      'src/contracts/units.ts',
      'src/rig/bones.ts',
      'src/solve/frame.ts',
    ]);
    expect(allowOf('YAW_NEGATION')).toEqual(['src/solve/frame.ts']);
    expect([...allowOf('X_NEGATION')].sort()).toEqual([
      'src/rig/bones.ts',
      'src/solve/frame.ts',
    ]);
    expect(allowOf('SECOND_FRAME_CONVERSION')).toEqual(['src/solve/frame.ts']);
    expect(allowOf('TEMPO_SCALE_DUP')).toEqual(['src/contracts/time.ts']);

    // No handedness allowlist may grow beyond those three files.
    for (const id of ['SIDE_SIGN_LEAK', 'YAW_NEGATION', 'X_NEGATION', 'SECOND_FRAME_CONVERSION']) {
      for (const f of allowOf(id)) {
        expect(
          ['src/contracts/units.ts', 'src/solve/frame.ts', 'src/rig/bones.ts'],
          `${id} allowlists an unexpected file: ${f}`,
        ).toContain(f);
      }
    }

    // And no contract file smuggles a second conversion in.
    for (const f of CONTRACT_FILES) {
      if (f === 'src/contracts/units.ts') continue;
      expect(SRC[f]!, `${f} must not name SIDE_SIGN`).not.toMatch(/\bSIDE_SIGN\b/);
    }
  });
});
