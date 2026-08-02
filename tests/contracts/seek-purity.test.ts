/**
 * tests/contracts/seek-purity.test.ts — §6.1, stated precisely and then tested.
 *
 * RED-FIRST (ARCHITECTURE.md §4.0, §8 Phase 0).
 *
 *   For every integer `tick` and every layer-weight vector `w`, `sample(tick, w, out)` writes
 *   exactly the same bytes into `out`, regardless of how the transport arrived at `tick` — cold
 *   seek, forward playback, reverse playback, or a scrub drag.
 *
 * This is not an aspiration; it is a property of the data structure (§6.2). The test is therefore
 * BITWISE, not approximate: it compares the Float32Array byte images, at 512 sampled ticks, for
 * all 52 bones plus the root, under three arrival paths. It also asserts the one piece of mutable
 * state the sampler is allowed — the segment cursor cache — changes no output byte (§6.1), and
 * that `sample` allocates nothing (§6.6 budgets 3.6 us).
 */

import { describe, expect, it } from 'vitest';
import {
  BONE_COUNT,
  CHANNEL_COUNT,
  LAYER_ORDER,
  LAYER_WEIGHTS_DEFAULT,
  type LayerId,
} from '../../src/contracts';

async function need(modulePath: string, ...symbols: readonly string[]): Promise<Record<string, unknown>> {
  const spec: string = modulePath;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (e) {
    const msg = String((e as Error).message);
    const absent = /Cannot find module|Failed to (?:load|resolve)/.test(msg);
    throw new Error(
      absent
        ? `RED-FIRST: module '${modulePath}' does not exist yet (need: ${symbols.join(', ')}). ` +
          `(${msg.split('\n')[0]})`
        : `LOAD ERROR in '${modulePath}': ${msg}`,
      { cause: e },
    );
  }
  const missing = symbols.filter((s) => !(s in mod));
  if (missing.length) {
    throw new Error(
      `RED-FIRST: missing symbol '${missing[0]}' in module '${modulePath}' ` +
        `(needed: ${symbols.join(', ')})`,
    );
  }
  return mod;
}

interface Frame {
  q: Float32Array;
  rootPos: Float32Array;
  rootQuat: Float32Array;
  chan: Float32Array;
  scaleRibcage: Float32Array;
}
interface Sampler {
  sample(tick: number, w: Readonly<Record<LayerId, number>>, out: Frame): void;
  keyTickAtOrBefore(tick: number): number;
}

const newFrame = (): Frame => ({
  q: new Float32Array(BONE_COUNT * 4),
  rootPos: new Float32Array(3),
  rootQuat: new Float32Array(4),
  chan: new Float32Array(CHANNEL_COUNT),
  scaleRibcage: new Float32Array(3),
});

/**
 * A truly BITWISE image of the frame: the raw bytes behind every typed array, hex-encoded.
 * Comparing numbers would hide -0 vs +0; comparing bytes does not.
 */
const imageOf = (f: Frame): string => {
  let s = '';
  for (const p of [f.q, f.rootPos, f.rootQuat, f.chan, f.scaleRibcage]) {
    const bytes = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
    for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
    s += '|';
  }
  return s;
};

describe('§6.2 — the alpha of term 3 is an exact dyadic rational (green from Phase 0)', () => {
  it('every legal alpha is representable without rounding in float64', () => {
    for (const tpf of [32, 16, 8, 4]) {
      for (let k = 0; k < tpf; k++) {
        const alpha = k / tpf;
        // Exactly representable => multiplying back recovers k with zero error, and the value has
        // a terminating binary expansion.
        expect(alpha * tpf).toBe(k);
        expect(Number.isInteger(alpha * 2 ** 5)).toBe(true);
      }
    }
  });

  it('LAYER_ORDER is frozen and the default weight vector is exactly 1 everywhere', () => {
    expect(LAYER_ORDER).toEqual(['koshi', 'kime', 'breath', 'gaze', 'patch']);
    for (const id of LAYER_ORDER) expect(LAYER_WEIGHTS_DEFAULT[id]).toBe(1);
  });
});

describe('§6.1 — sample(tick, w) is path-independent, bitwise', () => {
  it('cold seek === forward play === reverse seek at 512 ticks', async () => {
    const data = await need('../../src/data', 'getKata');
    const solve = await need('../../src/solve', 'compileKata');
    const player = await need('../../src/player', 'createSampler');

    const k = (data.getKata as (id: string) => unknown)('taikyoku-shodan');
    const track = (solve.compileKata as (kk: unknown, o: unknown) => { durationTicks: number })(k, {
      tempoTier: 'T1',
      codeVersion: 'test',
    });
    const makeSampler = player.createSampler as (t: unknown) => Sampler;

    const w = LAYER_WEIGHTS_DEFAULT;
    const N = 512;
    const last = track.durationTicks - 1;
    const ticks: number[] = [];
    for (let i = 0; i < N; i++) ticks.push(Math.round((i * last) / (N - 1)));

    /* Path A — a fresh sampler per tick: the coldest possible seek. */
    const cold = new Map<number, string>();
    for (const t of ticks) {
      const s = makeSampler(track);
      const out = newFrame();
      s.sample(t, w, out);
      cold.set(t, imageOf(out));
    }

    /* Path B — one sampler, walked strictly FORWARD through every sampled tick. */
    const fwd = new Map<number, string>();
    {
      const s = makeSampler(track);
      const out = newFrame();
      for (const t of ticks) {
        s.sample(t, w, out);
        fwd.set(t, imageOf(out));
      }
    }

    /* Path C — one sampler, walked strictly BACKWARD. Reverse is free because sampling is
     * stateless; if it is not, the cursor cache is load-bearing and §6.1 is false. */
    const rev = new Map<number, string>();
    {
      const s = makeSampler(track);
      const out = newFrame();
      for (const t of [...ticks].reverse()) {
        s.sample(t, w, out);
        rev.set(t, imageOf(out));
      }
    }

    const mismatches = ticks.filter(
      (t) => cold.get(t) !== fwd.get(t) || cold.get(t) !== rev.get(t),
    );
    expect(mismatches, `path-dependent at ticks ${mismatches.slice(0, 8).join(', ')}`).toEqual([]);
  });

  it('sample() writes into caller-owned scratch and never swaps a buffer', async () => {
    const data = await need('../../src/data', 'getKata');
    const solve = await need('../../src/solve', 'compileKata');
    const player = await need('../../src/player', 'createSampler');

    const k = (data.getKata as (id: string) => unknown)('taikyoku-shodan');
    const track = (solve.compileKata as (kk: unknown, o: unknown) => { durationTicks: number })(k, {
      tempoTier: 'T1',
      codeVersion: 'test',
    });
    const s = (player.createSampler as (t: unknown) => Sampler)(track);
    const out = newFrame();
    const qBuf = out.q.buffer;
    const rootPosBuf = out.rootPos.buffer;
    const rootQuatBuf = out.rootQuat.buffer;
    const chanBuf = out.chan.buffer;
    const ribcageBuf = out.scaleRibcage.buffer;

    for (let i = 0; i < 10_000; i++) {
      s.sample((i * 37) % track.durationTicks, LAYER_WEIGHTS_DEFAULT, out);
    }

    /* §3.9: the sampler never allocates. A sampler that built a new Float32Array per call would
     * have swapped these.
     *
     * `toBe` (Object.is), NOT `toEqual`. Vitest's `toEqual` is defined as
     * `equals(actual, expected, [...customTesters, iterableEquality])` and deliberately OMITS
     * `arrayBufferEquality`, which only `toStrictEqual` installs
     * (node_modules/@vitest/expect/dist/index.js:1097-1111). An ArrayBuffer exposes no own
     * enumerable keys, so `expect([...buffers]).toEqual(buffers)` passes for ANY four
     * ArrayBuffers — different identity, different bytes, even different byteLength — and the
     * assertion was a complete no-op. `toStrictEqual` would compare BYTES rather than identity,
     * which is also not what is being asserted here. Only `toBe` checks identity.
     * (The heap-growth form of the assertion lives in tests/player/sampler.test.ts, which owns
     * the 10 000-call allocation budget.) */
    expect(out.q.buffer, 'q buffer was swapped => the sampler allocated').toBe(qBuf);
    expect(out.rootPos.buffer, 'rootPos buffer was swapped').toBe(rootPosBuf);
    expect(out.rootQuat.buffer, 'rootQuat buffer was swapped').toBe(rootQuatBuf);
    expect(out.chan.buffer, 'chan buffer was swapped').toBe(chanBuf);
    expect(out.scaleRibcage.buffer, 'scaleRibcage buffer was swapped').toBe(ribcageBuf);
    expect(out.q).toHaveLength(BONE_COUNT * 4);
    expect([...out.q].some((v) => Number.isNaN(v)), 'no NaN in a sampled pose').toBe(false);
  });

  it('keyTickAtOrBefore is monotone and lands on a baked key', async () => {
    const data = await need('../../src/data', 'getKata');
    const solve = await need('../../src/solve', 'compileKata');
    const player = await need('../../src/player', 'createSampler');

    const k = (data.getKata as (id: string) => unknown)('taikyoku-shodan');
    const track = (solve.compileKata as (kk: unknown, o: unknown) => {
      durationTicks: number;
      segments: readonly { startTick: number; ticksPerFrame: number; frameCount: number }[];
    })(k, { tempoTier: 'T1', codeVersion: 'test' });
    const s = (player.createSampler as (t: unknown) => Sampler)(track);

    let prev = -1;
    for (let t = 0; t < track.durationTicks; t += 97) {
      const key = s.keyTickAtOrBefore(t);
      expect(key).toBeLessThanOrEqual(t);
      expect(key).toBeGreaterThanOrEqual(prev);
      const seg = [...track.segments].reverse().find((sg) => sg.startTick <= key)!;
      expect((key - seg.startTick) % seg.ticksPerFrame).toBe(0);
      prev = key;
    }
  });
});
