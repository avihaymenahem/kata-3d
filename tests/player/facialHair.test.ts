/**
 * B6 PLAYER — the pure core of `src/player/facialHair`, and of `src/player/scalpHair` beside it.
 *
 * Imported DIRECTLY, not through the block barrel: the barrel pulls `./character`, which pulls
 * `GLTFLoader`. Both modules' dependency on `Character` is `import type` and therefore erased, so
 * what is left is three's `Vector3` and arithmetic — Node safe.
 *
 * `attachFacialHair` needs a skinned GLB and cannot run here. The two things factored out of it are
 * the two whose failure is silent: the axis derivation, which decides whether the mustache lands on
 * the face or on the back of the skull, and the cross-section, whose winding order decides whether
 * it renders at all.
 *
 * ═══ WHY THE SCALP HAIR IS TESTED IN THE MUSTACHE'S FILE ═════════════════════════════════════
 *
 * `./scalpHair` is a separate module for a reason its own header gives, but its testable surface is
 * the same surface for the same reason — an outline and a colour ramp whose failures are SILENT.
 * A hairline that comes out level, or mirrored, or through the eyebrows, throws nothing and renders
 * happily; so does a salt-and-pepper mix that has collapsed to one tone. Splitting them across two
 * files would mean two copies of that paragraph and one of them going stale.
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';

import { MUSTACHE_SECTION, faceAxes } from '../../src/player/facialHair';
import {
  HORSESHOE_BOTTOM,
  HORSESHOE_TOP,
  TEMPLE_PHI,
  hairNoise,
  horseshoeEdges,
  saltPepperMix,
} from '../../src/player/scalpHair';

/** `AnimLib.glb`'s bind pose: shoulder joints at ±0.192 m, z = −0.065. */
const SHOULDER_L = new Vector3(0.192, 1.441, -0.065);
const SHOULDER_R = new Vector3(-0.192, 1.441, -0.065);

describe('faceAxes — which way the head is pointing', () => {
  /**
   * The convention `gi.ts` §2 documents, checked against the rig it was measured on rather than
   * asserted. Rigify keeps Blender's bone-local axes and the pelvis's local "up" is +Z, so a file
   * that ASSUMES the world convention here is one bind pose away from a mustache on an ear.
   */
  it('recovers +X left and +Z forward from this rig’s shoulders', () => {
    const a = faceAxes(SHOULDER_L, SHOULDER_R)!;
    expect(a.left.x).toBeCloseTo(1, 12);
    expect(a.fwd.z).toBeCloseTo(1, 12);
    expect(a.left.y).toBe(0);
    expect(a.fwd.y).toBeCloseTo(0, 12);
  });

  it('turns with the body instead of returning a constant', () => {
    /* The same shoulders, yawed 90° so the figure faces −X. Forward must follow. */
    const yaw = (v: Vector3): Vector3 => new Vector3(-v.z, v.y, v.x);
    const a = faceAxes(yaw(SHOULDER_L), yaw(SHOULDER_R))!;
    expect(a.left.z).toBeCloseTo(1, 12);
    expect(a.fwd.x).toBeCloseTo(-1, 12);
  });

  it('ignores a shoulder height difference rather than tilting the face', () => {
    /* An A-pose or an asymmetric bind must not roll the mustache off the horizontal. */
    const a = faceAxes(new Vector3(0.192, 1.52, -0.065), SHOULDER_R)!;
    expect(a.left.y).toBe(0);
    expect(a.left.length()).toBeCloseTo(1, 12);
    expect(a.fwd.dot(a.left)).toBeCloseTo(0, 12);
  });

  it('is right-handed: left × up = fwd, and fwd is a unit vector', () => {
    const a = faceAxes(SHOULDER_L, SHOULDER_R)!;
    const cross = new Vector3().crossVectors(a.left, new Vector3(0, 1, 0));
    expect(a.fwd.distanceTo(cross)).toBeCloseTo(0, 12);
    expect(a.fwd.length()).toBeCloseTo(1, 12);
  });

  it('returns null on coincident shoulders instead of a NaN basis', () => {
    expect(faceAxes(SHOULDER_L, SHOULDER_L.clone())).toBeNull();
    /* Purely vertical separation projects to nothing in the horizontal plane. */
    expect(faceAxes(new Vector3(0, 1.6, 0), new Vector3(0, 1.4, 0))).toBeNull();
  });
});

describe('MUSTACHE_SECTION — the cross-section swept across the face', () => {
  /**
   * ═══ THE OWNER ASKED FOR RECTANGULAR ═════════════════════════════════════════════════════
   *
   * A first version swept a lens and tapered it to a point at each end, and the correction was
   * explicit: one piece, rectangular, not pointy. What makes a silhouette rectangular is not the
   * absence of curves, it is the presence of STRAIGHT RUNS — a pair of columns sharing a `b` of
   * exactly ±1 is a flat top and a flat bottom, and those are the two edges you actually see on a
   * mustache viewed from the front.
   */
  it('has a flat top and a flat bottom, each two columns wide', () => {
    const top = MUSTACHE_SECTION.filter(([b]) => b === 1);
    const bottom = MUSTACHE_SECTION.filter(([b]) => b === -1);
    expect(top.length).toBe(2);
    expect(bottom.length).toBe(2);
  });

  it('is symmetric top to bottom, so the block does not lean', () => {
    for (const [b, a] of MUSTACHE_SECTION) {
      expect(MUSTACHE_SECTION.some(([b2, a2]) => b2 === -b && a2 === a)).toBe(true);
    }
  });

  /**
   * Winding. `gi.ts` §2's rule is that one triangle order gives outward normals everywhere as long
   * as `u × v` is the direction rows advance along; here `u` is up, `v` is outward, and the sweep
   * runs toward the wearer's left. Reverse the column order and every triangle faces inward, which
   * on a FrontSide material is not subtly wrong — the mustache simply is not there.
   */
  it('is wound counter-clockwise in the (up, outward) plane', () => {
    let area2 = 0;
    for (let i = 0; i < MUSTACHE_SECTION.length; i++) {
      const [b0, a0] = MUSTACHE_SECTION[i]!;
      const [b1, a1] = MUSTACHE_SECTION[(i + 1) % MUSTACHE_SECTION.length]!;
      area2 += b0 * a1 - b1 * a0;
    }
    expect(area2).toBeGreaterThan(0);
  });

  it('is convex, so no column folds back through its neighbours', () => {
    const n = MUSTACHE_SECTION.length;
    for (let i = 0; i < n; i++) {
      const p = MUSTACHE_SECTION[i]!;
      const q = MUSTACHE_SECTION[(i + 1) % n]!;
      const r = MUSTACHE_SECTION[(i + 2) % n]!;
      const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
      expect(cross).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays inside the unit box, so the half-extents mean what they say', () => {
    for (const [b, a] of MUSTACHE_SECTION) {
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
      expect(Math.abs(a)).toBeLessThanOrEqual(1);
    }
    /* Reaches it in both axes, or the block is smaller than the dimensions that name it. */
    expect(MUSTACHE_SECTION.some(([b]) => b === 1)).toBe(true);
    expect(MUSTACHE_SECTION.some(([, a]) => a === 1)).toBe(true);
  });

  /**
   * The corner radius is a tenth of the section and not zero: `computeVertexNormals` averages a
   * truly square corner into a hard shading seam running the length of the block, and a mustache
   * with a bright line down its top edge reads as moulded plastic.
   */
  it('rounds its corners rather than meeting at right angles', () => {
    const corners = MUSTACHE_SECTION.filter(([b, a]) => Math.abs(b) !== 1 && Math.abs(a) !== 1);
    expect(corners.length).toBe(0);
    /* Every column is either on a flat run or on the chamfer between two — eight columns, four
     * flats of two each, which is what makes the silhouette read as four straight edges. */
    expect(MUSTACHE_SECTION.length).toBe(8);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `src/player/scalpHair` — the horseshoe an old man has left
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** 73 columns is `COLS`; sampling the outline there is sampling it where it is actually built. */
const COLS = 73;
const psiAt = (j: number): number => j / (COLS - 1);

describe('hairNoise — the wobble the hairline is built from', () => {
  it('stays inside [-1, 1] everywhere the band reads it', () => {
    for (let i = 0; i <= 4000; i++) {
      const n = hairNoise((i / 4000) * 60 - 5);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  /**
   * SMOOTH, and this is the assertion that separates a hairline from a saw. Independent per-column
   * samples — `hash01` used directly, which is what a first draft of any value noise looks like —
   * would satisfy every other test in this block and render as a comb. What makes the edge read as
   * an edge is that a small step in the argument makes a small step in the answer.
   *
   * The bound is a Lipschitz one and it is checked at a step forty times finer than the grid, so it
   * is testing the FUNCTION rather than the sampling rate. At the rate the band actually reads it —
   * 9 cycles over 73 columns — the worst single-column jump is 0.35, which through
   * `TOP_NOISE_FINE` is 0.005 m of hairline between neighbouring columns 0.0047 m apart. That is
   * the intended raggedness, and it is why the grid is sampled at 73 and not 57.
   */
  it('is continuous: a small step in x makes a small step in the answer', () => {
    const h = 0.005;
    let worst = 0;
    for (let j = 0; j < 6000; j++) {
      worst = Math.max(worst, Math.abs(hairNoise((j + 1) * h) - hairNoise(j * h)));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('is deterministic, so the same karateka gets the same hairline twice', () => {
    expect(hairNoise(3.7)).toBe(hairNoise(3.7));
    expect(hairNoise(0)).toBe(hairNoise(0));
  });

  /**
   * Uses its range. A noise that never leaves ±0.1 is arithmetically a noise and visually a
   * straight line, and `TOP_NOISE_FINE` is set against what this actually delivers — see its
   * header, which records that the nominal amplitude is about three times the wander.
   */
  it('actually varies rather than hovering at its mean', () => {
    const xs = Array.from({ length: 600 }, (_, i) => hairNoise(i * 0.137));
    expect(Math.max(...xs)).toBeGreaterThan(0.5);
    expect(Math.min(...xs)).toBeLessThan(-0.5);
  });
});

describe('the horseshoe outline', () => {
  /**
   * The tables are keyed by ARC POSITION — 0 at either temple tip, 1 at the back of the skull —
   * which is what lets one table describe both sides. Ascending keys spanning the whole range, or
   * `curveAt` interpolates against a domain the sweep leaves.
   */
  it('is keyed by an ascending arc position covering 0 to 1', () => {
    for (const table of [HORSESHOE_TOP, HORSESHOE_BOTTOM]) {
      expect(table[0]![0]).toBe(0);
      expect(table[table.length - 1]![0]).toBe(1);
      for (let i = 0; i + 1 < table.length; i++) expect(table[i + 1]![0]).toBeGreaterThan(table[i]![0]);
    }
  });

  /**
   * ═══ A BALD CROWN, AND A HAIRLINE THAT RISES TOWARD IT ════════════════════════════════════
   *
   * The single fact that makes this male-pattern loss rather than a monk's tonsure or a fringe:
   * the vertex goes first and the occipital hair is the last to go, so the band is LOWEST where it
   * has been eaten into from the front and HIGHEST at the back. A table that levelled out would
   * render as a costume wig and throw nothing.
   */
  it('rises from the temple to the back of the skull', () => {
    for (let i = 0; i + 1 < HORSESHOE_TOP.length; i++) {
      expect(HORSESHOE_TOP[i + 1]![1]).toBeGreaterThan(HORSESHOE_TOP[i]![1]);
    }
  });

  it('leaves the crown and the whole forehead bare', () => {
    /* Nothing above 0.75 of head height anywhere — that is the bald pate, and it is the character's
     * own skin because this module puts no geometry there. */
    for (let j = 0; j < COLS; j++) expect(horseshoeEdges(psiAt(j)).top).toBeLessThan(0.75);
    /* And a bare frontal wedge: the tips stop 1.15 rad off the face's forward axis, so 2.3 rad of
     * the 6.28 carries no band at all. */
    expect(TEMPLE_PHI).toBeGreaterThan(0.9);
    expect(TEMPLE_PHI).toBeLessThan(Math.PI / 2);
  });

  /**
   * The shell has to stay open. Noise can push the two edges together at the tips, where the base
   * band is at its shortest, and a closed or inverted band is degenerate geometry —
   * `computeVertexNormals` returns NaN for a zero-area triangle and takes the whole end with it.
   */
  it('never lets the top edge meet or cross the bottom', () => {
    for (let j = 0; j < COLS * 4; j++) {
      const { top, bottom } = horseshoeEdges(j / (COLS * 4 - 1));
      expect(top - bottom).toBeGreaterThanOrEqual(0.034);
    }
  });

  it('keeps both edges on the skull rather than on the crown or the jaw', () => {
    for (let j = 0; j < COLS * 4; j++) {
      const { top, bottom } = horseshoeEdges(j / (COLS * 4 - 1));
      expect(bottom).toBeGreaterThan(0.25);
      expect(top).toBeLessThan(0.78);
    }
  });

  /**
   * ═══ IRREGULAR, AND NOT MIRRORED ══════════════════════════════════════════════════════════
   *
   * Two different failures with the same cause, so they are asserted together. The base tables are
   * a function of |arc position| and are therefore perfectly symmetric; the noise reads the SWEEP
   * position instead, so the left temple and the right temple disagree. A hairline that is level is
   * manufactured, and one that is a perfect mirror of itself is manufactured in a different way.
   */
  it('is uneven along its length and different on the two sides', () => {
    /* Local wander: the top edge against a five-column running mean of itself. */
    const top = Array.from({ length: COLS }, (_, j) => horseshoeEdges(psiAt(j)).top);
    let wander = 0;
    for (let j = 2; j + 2 < COLS; j++) {
      const mean = (top[j - 2]! + top[j - 1]! + top[j]! + top[j + 1]! + top[j + 2]!) / 5;
      wander = Math.max(wander, Math.abs(top[j]! - mean));
    }
    /* 0.006 of head height is 0.0017 m — a low bar deliberately, because what is being caught here
     * is the noise term having been dropped entirely, not a tuning change. */
    expect(wander).toBeGreaterThan(0.006);

    /* Mirror pairs: psi and 1 - psi sit at the same arc position on opposite sides. */
    let asymmetry = 0;
    for (let j = 0; j < COLS; j++) {
      asymmetry = Math.max(
        asymmetry,
        Math.abs(horseshoeEdges(psiAt(j)).top - horseshoeEdges(1 - psiAt(j)).top),
      );
    }
    expect(asymmetry).toBeGreaterThan(0.01);
  });

  /** The two tips are the only place the base band is short enough for the noise to invert it. */
  it('closes its tips cleanly, with the noise faded out', () => {
    for (const psi of [0, 1]) {
      const { top, bottom } = horseshoeEdges(psi);
      expect(top).toBeCloseTo(HORSESHOE_TOP[0]![1], 10);
      expect(bottom).toBeCloseTo(HORSESHOE_BOTTOM[0]![1], 10);
    }
  });
});

describe('saltPepperMix — grey hair, and not a flat grey', () => {
  const grid: { psi: number; rowT: number; g: number }[] = [];
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < 9; i++) {
      const psi = psiAt(j);
      const rowT = i / 8;
      grid.push({ psi, rowT, g: saltPepperMix(psi, rowT) });
    }
  }

  it('stays a mix, never leaving the two tones it blends', () => {
    for (const { g } of grid) {
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  /**
   * ═══ THE ONE ASSERTION THAT WOULD HAVE CAUGHT THE FELT ════════════════════════════════════
   *
   * The first build produced tones spanning 0x57 to 0x8F and rendered as a bandage — arithmetically
   * a salt-and-pepper mix, visually one colour. What was missing was SPREAD, so spread is what is
   * asserted: the mix has to reach both ends of its range and its samples have to be genuinely
   * scattered between them, or the flecks are not flecks.
   */
  it('spreads across its whole range instead of collapsing to one tone', () => {
    const gs = grid.map((x) => x.g);
    expect(Math.min(...gs)).toBeLessThan(0.15);
    expect(Math.max(...gs)).toBeGreaterThan(0.85);
    const mean = gs.reduce((a, b) => a + b, 0) / gs.length;
    const sd = Math.sqrt(gs.reduce((a, b) => a + (b - mean) ** 2, 0) / gs.length);
    /* 0.147 as built. The bar is 0.12 because what it has to catch is the collapse — the version
     * that rendered as felt sat at 0.06 — and not a retune of the speckle. */
    expect(sd).toBeGreaterThan(0.12);
  });

  /**
   * Grey, and reading darker than the lit scalp it sits on. Hair that renders brighter than skin
   * stops being hair whatever colour it is, which is why the base sits where it does — but a mean
   * near the `PEPPER` end would be a young man's hair, and the brief is a senior sensei.
   */
  it('averages to grey rather than to black or to white', () => {
    const mean = grid.reduce((a, x) => a + x.g, 0) / grid.length;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.7);
  });

  /**
   * Greying runs temples-first and top-down. Compared as AVERAGES over the whole band and not
   * sample by sample: the speckle is larger than either gradient by design, so any individual pair
   * of samples can and should contradict the trend.
   */
  it('greys the temples before the back, and the top edge before the roots', () => {
    const mean = (f: (x: { psi: number; rowT: number }) => boolean): number => {
      const sel = grid.filter(f);
      return sel.reduce((a, x) => a + x.g, 0) / sel.length;
    };
    const arcT = (psi: number): number => 1 - Math.abs(2 * psi - 1);
    expect(mean((x) => arcT(x.psi) < 0.25)).toBeGreaterThan(mean((x) => arcT(x.psi) > 0.75));
    expect(mean((x) => x.rowT > 0.75)).toBeGreaterThan(mean((x) => x.rowT < 0.25));
  });
});
