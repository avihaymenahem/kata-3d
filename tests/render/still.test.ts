/**
 * tests/render/still.test.ts — the `StillAccumulator`'s jitter sequence.
 *
 * ARCHITECTURE.md §4.5: "Halton(2,3) sample k is a pure function of k; the 32-sample offset set sums
 * to (0,0) within 1e-9".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWO CLAIMS, AND WHY THEY FORCED A DOCUMENTED SUBSTITUTION IN src/render/still.ts
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.3 writes the offsets as `halton(k+1, b) - 0.5`. §4.5 requires the 32-sample set to sum to
 * `(0, 0)` within `1e-9`. Those are NOT simultaneously satisfiable, and this file proves it from
 * first principles before asserting the fix:
 *
 *   base 2, i = 1..32:  i = 1..31 is a complete permutation of {1/32 .. 31/32}  =>  sum 15.5
 *                       i = 32 contributes radicalInverse(32) = 1/64
 *                       total 15.515625, mean 0.48486328125, so `- 0.5` leaves -0.484375 over 32
 *   base 3, i = 1..32:  i = 1..26 is a complete permutation of {1/27 .. 26/27}  =>  sum 13
 *                       i = 27..32 contribute (1 + 28 + 55 + 10 + 37 + 64)/81 = 195/81
 *                       total 15.4074..., mean 0.481481..., so `- 0.5` leaves -0.592592... over 32
 *
 * `still.ts` therefore subtracts the SET'S OWN MEAN instead of 0.5. That keeps the stratification,
 * keeps sample `k` a pure function of `(k, count)`, and makes the sum exactly zero. This matters
 * because the four `M_*` cameras are ORTHOGRAPHIC MEASUREMENT cameras (§5.7) and metrics 60 and 61 are
 * read off exactly those accumulated frames: a fixed sub-pixel translation is a bias in an instrument.
 *
 * Both readings are asserted below — the raw `-0.5` residual as ARITHMETIC (so the substitution is
 * justified by a number, not by a claim), and the mean-centred set as the SHIPPED behaviour.
 *
 * `[GL-free]`: nothing here constructs a renderer. `halton`, `haltonMean`, `stillJitter` and
 * `stillJitterSet` are pure.
 */

import { describe, expect, it } from 'vitest';
import {
  AdditiveBlending,
  NoBlending,
  PerspectiveCamera,
  type WebGLRenderer,
} from 'three';

import { STILL_SAMPLES, STILL_SAMPLES_LOW } from '../../src/contracts';
import {
  StillAccumulator,
  halton,
  haltonMean,
  stillJitter,
  stillJitterSet,
} from '../../src/render';

const SUM_TOL = 1e-9;

/** Independent re-implementation, digit-by-digit, so the test does not just echo the source. */
function radicalInverseReference(i: number, base: number): number {
  const digits: number[] = [];
  let n = i;
  while (n > 0) {
    digits.push(n % base);
    n = Math.floor(n / base);
  }
  // 0.d0 d1 d2 ... in `base`, where d0 is the LEAST significant digit of `i`.
  let v = 0;
  for (let k = 0; k < digits.length; k++) v += digits[k]! / Math.pow(base, k + 1);
  return v;
}

describe('halton — the radical-inverse primitive', () => {
  it('halton(0, b) === 0 for every base', () => {
    for (const b of [2, 3, 5, 7, 11]) expect(halton(0, b)).toBe(0);
  });

  it('base 2 reproduces the van der Corput sequence exactly', () => {
    // 1/2, 1/4, 3/4, 1/8, 5/8, 3/8, 7/8, 1/16 — exact dyadic rationals, so `toBe` is legitimate.
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((i) => halton(i, 2))).toEqual([
      0.5, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875, 0.0625,
    ]);
  });

  it('base 3 matches an independent digit-reversal implementation', () => {
    for (let i = 0; i <= 200; i++) {
      expect(halton(i, 3)).toBeCloseTo(radicalInverseReference(i, 3), 12);
    }
  });

  it('every value lies in [0, 1)', () => {
    for (const b of [2, 3]) {
      for (let i = 0; i < 512; i++) {
        const v = halton(i, b);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('the first 2^n - 1 base-2 values are a permutation of {k/2^n}', () => {
    const n = 5;
    const N = 2 ** n; // 32
    const got = Array.from({ length: N - 1 }, (_, k) => halton(k + 1, 2)).sort((a, b) => a - b);
    const want = Array.from({ length: N - 1 }, (_, k) => (k + 1) / N);
    expect(got).toEqual(want);
  });

  it('rejects a bad index or base rather than returning a plausible number', () => {
    expect(() => halton(-1, 2)).toThrow(/non-negative/);
    expect(() => halton(Number.NaN, 2)).toThrow(/finite/);
    expect(() => halton(1, 1)).toThrow(/base/);
    expect(() => halton(1, 2.5)).toThrow(/base/);
  });
});

describe('§5.3 arithmetic — why `- 0.5` is NOT the right centring', () => {
  it('the base-2 prefix sums to 15.515625 over 32 samples, not 16', () => {
    let s = 0;
    for (let k = 0; k < 32; k++) s += halton(k + 1, 2);
    // 31 complete values summing to 15.5, plus radicalInverse(32) = 1/64.
    expect(s).toBeCloseTo(15.5 + 1 / 64, 12);
    expect(s).toBeCloseTo(15.515625, 12);
  });

  it('the base-3 prefix sums to 195/81 + 13 over 32 samples', () => {
    let s = 0;
    for (let k = 0; k < 32; k++) s += halton(k + 1, 3);
    expect(s).toBeCloseTo(13 + 195 / 81, 12);
  });

  it("so `halton - 0.5` leaves a NON-ZERO residual — the reason still.ts substitutes the mean", () => {
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 32; k++) {
      sx += halton(k + 1, 2) - 0.5;
      sy += halton(k + 1, 3) - 0.5;
    }
    expect(sx).toBeCloseTo(-0.484375, 12);
    expect(sy).toBeCloseTo(13 + 195 / 81 - 16, 12);
    // Both are far outside the 1e-9 the §4.5 gate demands.
    expect(Math.abs(sx)).toBeGreaterThan(SUM_TOL);
    expect(Math.abs(sy)).toBeGreaterThan(SUM_TOL);
  });

  it('haltonMean(32) is the measured mean, not 0.5', () => {
    const [mx, my] = haltonMean(32);
    expect(mx).toBeCloseTo(15.515625 / 32, 12);
    expect(my).toBeCloseTo((13 + 195 / 81) / 32, 12);
    expect(mx).not.toBeCloseTo(0.5, 6);
    expect(my).not.toBeCloseTo(0.5, 6);
  });
});

describe('§4.5 gate — the 32 offsets sum to (0, 0) within 1e-9', () => {
  it('sums to zero at STILL_SAMPLES = 32', () => {
    expect(STILL_SAMPLES).toBe(32);
    const set = stillJitterSet(STILL_SAMPLES);
    expect(set).toHaveLength(32);
    const sx = set.reduce((a, j) => a + j[0], 0);
    const sy = set.reduce((a, j) => a + j[1], 0);
    expect(Math.abs(sx)).toBeLessThan(SUM_TOL);
    expect(Math.abs(sy)).toBeLessThan(SUM_TOL);
  });

  it('sums to zero at the low tier too (STILL_SAMPLES_LOW = 12, §6.6)', () => {
    expect(STILL_SAMPLES_LOW).toBe(12);
    const set = stillJitterSet(STILL_SAMPLES_LOW);
    expect(set).toHaveLength(12);
    expect(Math.abs(set.reduce((a, j) => a + j[0], 0))).toBeLessThan(SUM_TOL);
    expect(Math.abs(set.reduce((a, j) => a + j[1], 0))).toBeLessThan(SUM_TOL);
  });

  it('sums to zero at every count the project could plausibly ship', () => {
    for (const n of [1, 2, 4, 8, 12, 16, 24, 32, 48, 64]) {
      const set = stillJitterSet(n);
      expect(Math.abs(set.reduce((a, j) => a + j[0], 0)), `count ${n} x`).toBeLessThan(SUM_TOL);
      expect(Math.abs(set.reduce((a, j) => a + j[1], 0)), `count ${n} y`).toBeLessThan(SUM_TOL);
    }
  });
});

describe('§4.5 gate — sample k is a PURE function of k', () => {
  it('repeated calls return identical values', () => {
    for (let k = 0; k < STILL_SAMPLES; k++) {
      const a = stillJitter(k);
      const b = stillJitter(k);
      expect(a[0]).toBe(b[0]);
      expect(a[1]).toBe(b[1]);
    }
  });

  it('call ORDER does not change any value — no hidden accumulation index', () => {
    const forward = Array.from({ length: STILL_SAMPLES }, (_, k) => stillJitter(k));
    const backward: (readonly [number, number])[] = [];
    for (let k = STILL_SAMPLES - 1; k >= 0; k--) backward[k] = stillJitter(k);
    const interleaved = [
      ...Array.from({ length: 16 }, (_, i) => stillJitter(i * 2)),
      ...Array.from({ length: 16 }, (_, i) => stillJitter(i * 2 + 1)),
    ];
    expect(backward).toEqual(forward);
    for (let i = 0; i < 16; i++) {
      expect(interleaved[i]).toEqual(forward[i * 2]);
      expect(interleaved[16 + i]).toEqual(forward[i * 2 + 1]);
    }
  });

  it('is a function of (k, count): the same k at a different count differs', () => {
    // The mean depends on the count, so the 12-sample and 32-sample offsets for k = 0 must differ.
    // This is the property that makes `resetStill()` mandatory on a quality-tier change (§5.3).
    expect(stillJitter(0, 12)[0]).not.toBe(stillJitter(0, 32)[0]);
  });

  it('every offset is a sub-pixel offset — inside (-1, 1) px', () => {
    for (const [jx, jy] of stillJitterSet(STILL_SAMPLES)) {
      expect(Math.abs(jx)).toBeLessThan(1);
      expect(Math.abs(jy)).toBeLessThan(1);
    }
  });

  it('the 32 offsets are all distinct — 32 renders, 32 distinct sub-pixel positions', () => {
    const keys = new Set(stillJitterSet(STILL_SAMPLES).map(([x, y]) => `${x},${y}`));
    expect(keys.size).toBe(STILL_SAMPLES);
  });

  it('the accumulator resets on every change §5.3 lists', () => {
    // Construction needs no GL: WebGLRenderTarget, ShaderMaterial and FullScreenQuad are all plain
    // objects until something renders them. That is what makes the blend state below testable.
    const fake = {} as unknown as WebGLRenderer;
    const acc = new StillAccumulator(fake, new PerspectiveCamera(), STILL_SAMPLES);
    expect(acc.sample).toBe(0);
    expect(acc.converged).toBe(false);
    expect(acc.sampleCount).toBe(STILL_SAMPLES);

    acc.setSampleCount(STILL_SAMPLES_LOW); // quality-tier change
    expect(acc.sampleCount).toBe(STILL_SAMPLES_LOW);
    expect(acc.sample).toBe(0);

    acc.setCamera(new PerspectiveCamera()); // camera change (every snapTo)
    expect(acc.sample).toBe(0);

    acc.setSize(1024, 1024); // canvas / DPR change
    expect(acc.sample).toBe(0);

    expect(() => acc.setSampleCount(0)).toThrow(/positive integer/);
    acc.dispose();
    expect(() => acc.present()).toThrow(/after dispose/);
  });

  it('the additive blit is PREMULTIPLIED — the 30x-too-dark bug, pinned', () => {
    // WebGLState.js resolves AdditiveBlending two different ways:
    //   premultipliedAlpha true  (:652) -> blendFunc( ONE, ONE )                 pure add
    //   premultipliedAlpha false (:678) -> blendFuncSeparate( SRC_ALPHA, ONE, ...)
    // The blit shader writes `texture2D(...) * weight`, scaling RGB *and* ALPHA. Under the `false`
    // branch the blend multiplies RGB by that alpha AGAIN, so 32 samples at 1/32 land on 1/1024 and
    // every captured PNG comes out ~30x too dark while play mode looks fine. Measured before/after:
    // mean luma 3.7 -> 117 on the same frame. Nothing else in the project can catch this: `tsc` is
    // happy, the pass order is unchanged, and no G1-G4 metric reads a pixel.
    const fake = {} as unknown as WebGLRenderer;
    const acc = new StillAccumulator(fake, new PerspectiveCamera(), STILL_SAMPLES);
    expect(acc.additiveMaterial.blending).toBe(AdditiveBlending);
    expect(acc.additiveMaterial.premultipliedAlpha).toBe(true);
    expect(acc.additiveMaterial.depthTest).toBe(false);
    expect(acc.additiveMaterial.depthWrite).toBe(false);
    expect(acc.additiveMaterial.uniforms.weight!.value).toBeCloseTo(1 / STILL_SAMPLES, 12);
    acc.dispose();
  });

  it('the present blit does NOT blend and does NOT re-encode', () => {
    // OutputPass already applied renderer.toneMapping and the sRGB transfer inside the chain — it
    // does so whether it rendered to screen or to a buffer (OutputPass.js:118-131) — so the
    // accumulation target already holds display-referred values. A second conversion double-encodes.
    const fake = {} as unknown as WebGLRenderer;
    const acc = new StillAccumulator(fake, new PerspectiveCamera(), STILL_SAMPLES);
    expect(acc.presentMaterial.blending).toBe(NoBlending);
    expect(acc.presentMaterial.fragmentShader).not.toMatch(/pow|linearTo|sRGB|toneMapping/i);
    acc.dispose();
  });

  it('stratifies: both axes cover their range, so this is not a clustered set', () => {
    // A Halton set's whole value over uniform random is even coverage. Check every quarter of the
    // [-0.5, 0.5] span is populated on both axes.
    const set = stillJitterSet(STILL_SAMPLES);
    for (const axis of [0, 1] as const) {
      const buckets = new Set(set.map((j) => Math.floor((j[axis] + 0.5) * 4)));
      expect(buckets.size, `axis ${axis} coverage`).toBeGreaterThanOrEqual(4);
    }
  });
});
