/**
 * B6 PLAYER — the pure core of `src/player/gi`.
 *
 * Imports the module DIRECTLY rather than through the block barrel, for the same reason
 * `footIk.test.ts` and `choreography.test.ts` do: the barrel pulls `./character`, which pulls
 * `GLTFLoader`. `gi.ts`'s own dependency on `Character` is `import type` and therefore erased, so
 * the module itself is Node-safe.
 *
 * ═══ WHAT IS AND IS NOT COVERED ══════════════════════════════════════════════════════════════
 *
 * `attachGi` needs a skinned GLB with a Rigify skeleton and 8.5 k measurable body vertices; it
 * cannot run here at all, and every panel it builds is checked by looking at the render. What IS
 * checked here is the pair of decisions whose failure mode is SILENT — the fold generator, whose
 * whole safety argument is an inequality nobody can see in a screenshot, and the sleeve's station
 * list, which is the fix for the complaint that started this revision and would still look
 * plausible if it quietly stopped at the elbow.
 */

import { describe, expect, it } from 'vitest';

import { SLEEVE_END_FRAC, addFolds, sleeveStations } from '../../src/player/gi';

/** This project's actual figure: `AnimLib.glb`'s bind pose measures 1.8287 m. */
const S = 1.8287;
/** doc 06 §7.9's `foldWavelengthH`, the number `addFolds` derives its count from. */
const FOLD_WAVELENGTH_M = 0.0425 * S; // 0.0777 m

const ring = (cols: number, radius: number): Float64Array =>
  Float64Array.from({ length: cols }, () => radius);

describe('addFolds — doc 06 §7.9 folds, written into a ring', () => {
  /**
   * THE safety property of the whole fold system.
   *
   * Every ring in `gi.ts` is a measured body support radius plus an ease, so its radius IS the
   * clearance. A symmetric ±amp fold would put every trough inside that — inside the body — and
   * hand the pushout a shape it cannot distinguish from an error, because the trough is one the
   * ring asked for. The bias is what makes "the gi never intersects the body" survive folding, and
   * it is invisible in a render right up to the frame where a rib comes through a fold.
   */
  it('never moves a vertex inward, at any amplitude or phase', () => {
    for (const cols of [16, 20, 26, 32, 36]) {
      for (const phase of [0, 0.4, 1.1, 2.7, 5.9]) {
        const r = ring(cols, 0.19);
        addFolds(r, S, 0.0035 * S, phase);
        for (const x of r) expect(x).toBeGreaterThanOrEqual(0.19 - 1e-12);
      }
    }
  });

  it('adds at most one full amplitude, so the ease budget is bounded', () => {
    const amp = 0.0035 * S;
    const r = ring(36, 0.19);
    addFolds(r, S, amp, 0.4);
    for (const x of r) expect(x).toBeLessThanOrEqual(0.19 + amp + 1e-12);
  });

  it('is a no-op at zero or negative amplitude rather than a shift', () => {
    for (const amp of [0, -1]) {
      const r = ring(36, 0.19);
      addFolds(r, S, amp, 0.4);
      for (const x of r) expect(x).toBe(0.19);
    }
  });

  /**
   * The count is a WAVELENGTH divided by a circumference, not a literal, so a sleeve and a trouser
   * leg carry folds of the same physical size without either number being typed anywhere. Counted
   * off the result by sign changes of the first difference: a `(1 − cos kφ)/2` modulation has
   * exactly `k` maxima and `k` minima around the ring, hence `2k` turning points.
   */
  it('derives the fold count from the ring circumference and §7.9 wavelength', () => {
    const turningPoints = (r: Float64Array): number => {
      const n = r.length;
      let flips = 0;
      let prev = Math.sign(r[0]! - r[n - 1]!);
      for (let j = 0; j < n; j++) {
        const d = Math.sign(r[(j + 1) % n]! - r[j]!);
        if (d !== 0 && prev !== 0 && d !== prev) flips++;
        if (d !== 0) prev = d;
      }
      return flips;
    };

    /* A trouser thigh: 0.115 m radius, 0.72 m round, 9 folds at 7.8 cm each. 26 columns leaves
     * the Nyquist clamp (`cols / 3` = 8) as the binding constraint, which is the intended
     * behaviour — a fold narrower than three columns is facet noise, not a fold. */
    const thigh = ring(26, 0.115);
    addFolds(thigh, S, 0.0035 * S, 0);
    const kThigh = turningPoints(thigh) / 2;
    expect(kThigh).toBe(Math.min(8, Math.round((Math.PI * 2 * 0.115) / FOLD_WAVELENGTH_M)));

    /* A sleeve at the cuff: 0.08 m radius, 0.50 m round -> 6 folds, comfortably inside 20/3. */
    const cuff = ring(20, 0.08);
    addFolds(cuff, S, 0.0035 * S, 0);
    expect(turningPoints(cuff) / 2).toBe(Math.round((Math.PI * 2 * 0.08) / FOLD_WAVELENGTH_M));
  });

  it('never asks for a fold narrower than three columns (Nyquist, with margin)', () => {
    /* A jacket skirt is 1.3 m round and wants 17 folds; 36 columns can carry 12. Asking for 17
     * would alias into the facet noise `computeVertexNormals` cannot shade as cloth. */
    const skirt = ring(36, 0.21);
    addFolds(skirt, S, 0.0035 * S, 0);
    let flips = 0;
    let prev = Math.sign(skirt[0]! - skirt[35]!);
    for (let j = 0; j < 36; j++) {
      const d = Math.sign(skirt[(j + 1) % 36]! - skirt[j]!);
      if (d !== 0 && prev !== 0 && d !== prev) flips++;
      if (d !== 0) prev = d;
    }
    expect(flips / 2).toBeLessThanOrEqual(Math.floor(36 / 3));
    expect(flips / 2).toBeGreaterThanOrEqual(4);
  });

  it('keeps at least four folds on a ring too small to carry the wavelength', () => {
    /* An obi tail section is 0.02 m round: the wavelength wants zero folds, and a ring with no
     * modulation at all is the smooth inflated shell this revision exists to retire. */
    const tiny = ring(16, 0.02);
    addFolds(tiny, S, 0.0006 * S, 0);
    const distinct = new Set(Array.from(tiny, (x) => x.toFixed(6)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('sleeveStations — where the sleeve is cut, and where its seam is', () => {
  const st = sleeveStations(SLEEVE_END_FRAC);

  it('is strictly monotone, so the swept rings never fold back on themselves', () => {
    for (let i = 1; i < st.length; i++) expect(st[i]!).toBeGreaterThan(st[i - 1]!);
  });

  it('ends exactly at the cut, and buries three rings inside the jacket', () => {
    expect(st[st.length - 1]).toBeCloseTo(SLEEVE_END_FRAC, 12);
    expect(st.filter((t) => t < 0).length).toBe(2);
    /* Two negative plus the one at +0.004 H — 7 mm outboard of the joint centre and still well
     * inside a shoulder cap that reaches 0.19 m. This overlap is the whole "set-in sleeve" fix:
     * at the old 0.011 H burial the sleeve left the jacket within one ring of its own root. */
    expect(st[0]!).toBeLessThanOrEqual(-0.030);
  });

  /**
   * ═══ THE COMPLAINT THIS REVISION STARTED FROM ════════════════════════════════════════════
   *
   * "The jacket has almost no sleeves. They stop around mid-bicep." Measured off `AnimLib.glb`'s
   * bind pose, this figure's shoulder-to-elbow is 0.274 m and its elbow-to-wrist is 0.273 m, so
   * the elbow sits at 0.1498 H from the shoulder joint and the wrist at 0.2991 H. A kata cut ends
   * between them and nearer the wrist; anything at or under the elbow is the defect.
   */
  it('cuts the sleeve 80 % down the forearm, not at the elbow', () => {
    const ELBOW_FRAC = 0.274 / S;
    const WRIST_FRAC = 0.547 / S;
    const down = (SLEEVE_END_FRAC - ELBOW_FRAC) / (WRIST_FRAC - ELBOW_FRAC);
    expect(down).toBeGreaterThan(0.7);
    expect(down).toBeLessThan(0.9);
  });

  it('stays inside doc 06 §7.1’s stated tolerance on sleeveEndH', () => {
    expect(SLEEVE_END_FRAC).toBeGreaterThanOrEqual(0.255 - 0.02);
    expect(SLEEVE_END_FRAC).toBeLessThanOrEqual(0.255 + 0.02);
  });

  it('puts the armhole seam clear of both the jacket and the elbow', () => {
    /* Station 4 carries `SLEEVE_SEAM_SCALE`'s dip. It has to be outboard of the jacket's shoulder
     * cap to be visible at all, and well inboard of the elbow so a bend does not shear it. */
    const seam = st[4]!;
    expect(seam).toBeGreaterThan(0.02);
    expect(seam).toBeLessThan(0.1498);
  });
});
