/**
 * tests/solve/ik.test.ts — doc 06 §6.1's analytic two-bone IK, and doc 03 §13.1's
 * "self-consistency guarantee (run as a unit test)" run as the unit test it asks to be
 * (OWNERSHIP B3 "Verification": `|C′ − T| < 1e-9` in range; every 03 §13.1 law-of-cosines row
 * to ±1.0°).
 *
 * ── WHAT THIS FILE IS ACTUALLY GUARDING ────────────────────────────────────────────────────
 * Four properties, each of which fails SILENTLY if broken — no exception, no NaN, just a pose
 * that is subtly wrong in every frame:
 *
 *   1. EXACTNESS IN RANGE. A target inside the reachable annulus must be hit to 1e-9 m. The
 *      residual `solveTwoBonePositions` returns is what §4.11 S4 gates at 0.005 m (G-8) and what
 *      `SolveDiagnostics.ikResidualM` reports per frame. If the solve leaks a millimetre on
 *      targets it CAN reach, every G-8 budget downstream is spent before the hard cases arrive.
 *
 *   2. THE DOC 03 ELBOW ANGLES ARE COMPUTED, NOT QUOTED. doc 03 §13.1: "Every elbow angle in this
 *      document was **computed**, not quoted, via the law of cosines from the stated positions."
 *      That makes the §13 table a closed system: the `dx/dy/dz` and the `Elbow °` column cannot
 *      drift apart without one of them being wrong. Reproducing all thirteen rows from
 *      `lawOfCosines` — the SAME function the solver runs — turns the doc's claim into a gate.
 *      Tolerance is doc 03 §13.1's own ±1.0°; it is NOT loosened anywhere in this file.
 *
 *   3. SOFTEN IS C¹. doc 06 §6.1: "This is monotone, asymptotes to `Lsum`, and is C¹ at `r = d0`
 *      (both one-sided derivatives = 1)." A kink here is invisible in a still and reads as a
 *      hitch at every kime, because the arm crosses `d0` exactly when it is moving fastest.
 *
 *   4. THE MID-JOINT LIMIT IS FOLDED INTO STEP 2, NOT POST-CLAMPED. doc 06 §6.1: "This makes the
 *      clamp *part of the solve* instead of a post-pass that breaks the endpoint." The observable
 *      difference is precisely this: a limited chain must stay CLOSED (`|B′−A| = lenAB`,
 *      `|C′−B′| = lenBC`) and report its shortfall as a residual. A post-clamp would keep the
 *      residual at zero and detach the mid joint instead — which is the failure a plant lock
 *      cannot survive, because the ankle it committed to would move.
 *
 * ── ONE FINDING, RECORDED HERE RATHER THAN PAPERED OVER ────────────────────────────────────
 * doc 03 §13's `shuto-uke` row is tabulated against the **fingertip** but its `59°` is the
 * **wrist**-referenced angle of §9.4. §13.1 defines exactly three `b` values (fist centre 0.176,
 * MCP2 0.195, FOREARM 0.146 "wrist ref") and no elbow→fingertip length, and 59° is not
 * reproducible from the fingertip offsets under any of them (elbow→fingertip = FOREARM + HAND =
 * 0.254 H gives 67.29°, 8.3° out). §9.4's own `END — wrist` row `(s·0.003, −0.052, −0.159)` with
 * `b = FOREARM` gives **59.07°** — inside ±1.0°. The row below therefore carries §9.4's wrist
 * coordinates, flagged, and the tolerance stays at ±1.0°. See the REPORT section of this file's
 * hand-off note.
 */

import { describe, expect, it } from 'vitest';

import { RAD } from '../../src/contracts';
import { ANTHRO } from '../../src/data';
import {
  SOFTEN_DEFAULT,
  includedAngleDeg,
  lawOfCosines,
  softenReach,
  solveTwoBonePositions,
  type TwoBoneArgs,
} from '../../src/solve';

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * Shared helpers. Everything here is deterministic — `tests/contracts/imports.test.ts` bans the
 * wall clock and unseeded randomness from the compiled trees, and a test that samples the solve
 * with `Math.random` would report a different failure every run.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

const V = (x: number, y: number, z: number) => new Float64Array([x, y, z]);
const ORIGIN = () => V(0, 0, 0);
const dist = (a: Float64Array, b: Float64Array) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** A fixed spread of unit directions — no RNG, so a failure is reproducible from the row index. */
const DIRECTIONS: readonly (readonly [number, number, number])[] = Object.freeze([
  [0, 0, -1], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1],
  [0.6, -0.5, -0.62], [-0.35, 0.8, -0.49], [0.7, 0.1, 0.7], [-0.2, -0.9, 0.39],
  [0.45, 0.45, -0.77], [-0.8, -0.3, -0.52],
]);

const unit = (d: readonly [number, number, number]): readonly [number, number, number] => {
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
};

/** `TwoBoneArgs` with the fields this file varies, and doc 06 §6.1's defaults for the rest. */
function args(o: {
  lenAB: number;
  lenBC: number;
  target: Float64Array;
  pole?: Float64Array;
  soften?: number;
  midMinDeg?: number;
  midMaxDeg?: number;
}): TwoBoneArgs {
  return {
    aWorld: ORIGIN(),
    lenAB: o.lenAB,
    lenBC: o.lenBC,
    targetWorld: o.target,
    /* doc 06 §6.2's knee form: a point on a direction from A. Any non-colinear pole picks a
     * bend plane; the endpoint is plane-INDEPENDENT, which the annulus test relies on. */
    poleWorld: o.pole ?? V(0.0, -1.0, 0.35),
    soften: o.soften ?? SOFTEN_DEFAULT,
    midMinDeg: o.midMinDeg ?? 0,
    midMaxDeg: o.midMaxDeg ?? 180,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 1. `|C′ − T| < 1e-9` STRICTLY INSIDE THE REACHABLE ANNULUS
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 06 §6.1 — the endpoint is exact inside the reachable annulus', () => {
  /* The annulus doc 06 §6.1 step 1 defines: inner `r_min = |L1−L2| + 0.01·Lsum`, outer `d0 =
   * soften·Lsum` (past `d0` the soften branch DELIBERATELY under-reaches, so that band is
   * tested separately below and is not a defect). "Strictly inside" = 5 % clear of both ends. */
  const CHAINS: readonly (readonly [string, number, number])[] = Object.freeze([
    ['equal bones (arm-like)', 0.2831, 0.2704],       // ARM_LEN_M scale, metres
    ['unequal bones (leg-like)', 0.4244, 0.4363],     // LEG_LEN_M scale, metres
    ['very unequal', 0.4, 0.12],
    ['tiny chain', 0.01, 0.013],
  ]);

  it.each(CHAINS)('%s: every in-range target is hit to < 1e-9 m', (_name, lenAB, lenBC) => {
    const lSum = lenAB + lenBC;
    const rMin = Math.abs(lenAB - lenBC) + 0.01 * lSum;
    const rLo = rMin + 0.05 * (SOFTEN_DEFAULT * lSum - rMin);
    const rHi = rMin + 0.95 * (SOFTEN_DEFAULT * lSum - rMin);

    let worst = 0;
    for (const raw of DIRECTIONS) {
      const u = unit(raw);
      for (let k = 0; k <= 8; k++) {
        const r = rLo + ((rHi - rLo) * k) / 8;
        const target = V(u[0] * r, u[1] * r, u[2] * r);
        const outB = new Float64Array(3);
        const outC = new Float64Array(3);
        const residual = solveTwoBonePositions(args({ lenAB, lenBC, target }), outB, outC);
        /* The returned residual and the measured one must agree — `SolveDiagnostics.ikResidualM`
         * carries the RETURNED number, so a solve that reached the target while reporting
         * something else would pass every downstream gate on a lie. */
        expect(Math.abs(residual - dist(outC, target))).toBeLessThan(1e-12);
        worst = Math.max(worst, residual);
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('the endpoint does not depend on the pole — only the bend plane does', () => {
    /* doc 06 §6.1 steps 3–4: the pole picks `v`, and `C′ = A + r_c·u` has no `v` in it. If a
     * refactor ever lets the pole leak into the endpoint, every technique's fist position starts
     * tracking the elbow-swivel authoring, and doc 03 §13's "solver priority" order inverts. */
    const target = V(0.10, -0.22, -0.30);
    const ref = new Float64Array(3);
    const refB = new Float64Array(3);
    solveTwoBonePositions(args({ lenAB: 0.2831, lenBC: 0.2704, target }), refB, ref);
    for (const raw of DIRECTIONS) {
      const p = unit(raw);
      const outB = new Float64Array(3);
      const outC = new Float64Array(3);
      solveTwoBonePositions(
        args({ lenAB: 0.2831, lenBC: 0.2704, target, pole: V(p[0], p[1], p[2]) }),
        outB,
        outC,
      );
      expect(dist(outC, ref)).toBeLessThan(1e-12);
    }
  });

  it('the chain closes on itself at every in-range target', () => {
    /* `|B′−A| = lenAB` and `|C′−B′| = lenBC`. Bones do not stretch; doc 06 §0 and B4's
     * `bone_length_drift_pct === 0` both depend on the solve never asking them to. */
    const lenAB = 0.4244;
    const lenBC = 0.4363;
    const lSum = lenAB + lenBC;
    const rMin = Math.abs(lenAB - lenBC) + 0.01 * lSum;
    for (const raw of DIRECTIONS) {
      const u = unit(raw);
      for (let k = 0; k <= 6; k++) {
        const r = rMin * 1.05 + ((0.96 * lSum - rMin * 1.05) * k) / 6;
        const outB = new Float64Array(3);
        const outC = new Float64Array(3);
        solveTwoBonePositions(
          args({ lenAB, lenBC, target: V(u[0] * r, u[1] * r, u[2] * r) }),
          outB,
          outC,
        );
        expect(Math.abs(dist(outB, ORIGIN()) - lenAB)).toBeLessThan(1e-9);
        expect(Math.abs(dist(outC, outB) - lenBC)).toBeLessThan(1e-9);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 2. doc 03 §13.1 — EVERY LAW-OF-COSINES ROW, ±1.0°
 *
 *   c = |offset_endEffector|                      // GH -> end-effector
 *   θ = acos( (a² + b² − c²) / (2·a·b) )          // elbow angle, degrees
 *   a = UPPER_ARM = 0.186 H
 *   b = ELBOW_TO_FIST_CENTRE 0.176 | ELBOW_TO_MCP2 0.195 | FOREARM 0.146 (wrist ref)
 *
 * `a` and `b` are read from B1's `ANTHRO`, not re-typed, so a change to the shipped segment
 * lengths surfaces here as a doc-03 disagreement rather than silently agreeing with itself.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

const A_UPPER_ARM = ANTHRO.UPPER_ARM!.v;
const B_MCP2 = ANTHRO.ELBOW_TO_MCP2!.v;
const B_FIST = ANTHRO.ELBOW_TO_FIST_CENTRE!.v;
const B_WRIST = ANTHRO.FOREARM!.v;

interface LocRow {
  readonly name: string;
  /** doc 03 §13's own literals with `s = +1` (LEFT limb, §0.2). Only `|offset|` enters θ. */
  readonly d: readonly [number, number, number];
  readonly b: number;
  /** The `Elbow °` column. */
  readonly deg: number;
  /** §13.1's reach ceiling for this row's reference point, or null where the doc states none. */
  readonly reachMaxH: number | null;
  readonly note?: string;
}

const LOC_ROWS: readonly LocRow[] = Object.freeze([
  { name: 'choku-zuki chudan (MCP2)', d: [-0.13, -0.118, -0.337], b: B_MCP2, deg: 172, reachMaxH: ANTHRO.MAX_REACH_GH_MCP2!.v },
  { name: 'choku-zuki jodan (MCP2)', d: [-0.13, 0.087, -0.346], b: B_MCP2, deg: 171, reachMaxH: ANTHRO.MAX_REACH_GH_MCP2!.v },
  { name: 'choku-zuki gedan (MCP2)', d: [-0.13, -0.258, -0.247], b: B_MCP2, deg: 172, reachMaxH: ANTHRO.MAX_REACH_GH_MCP2!.v },
  { name: 'oi-zuki chudan (MCP2)', d: [-0.13, -0.118, -0.337], b: B_MCP2, deg: 172, reachMaxH: ANTHRO.MAX_REACH_GH_MCP2!.v },
  { name: 'gyaku-zuki chudan (MCP2)', d: [-0.13, -0.118, -0.337], b: B_MCP2, deg: 172, reachMaxH: ANTHRO.MAX_REACH_GH_MCP2!.v },
  { name: 'age-uke (fist ctr)', d: [-0.136, 0.181, -0.079], b: B_FIST, deg: 83, reachMaxH: ANTHRO.MAX_REACH_GH_FIST!.v },
  { name: 'gedan-barai (MCP2)', d: [-0.046, -0.19, -0.326], b: B_MCP2, deg: 172, reachMaxH: ANTHRO.MAX_REACH_GH_MCP2!.v },
  { name: 'soto-uke (fist ctr)', d: [-0.03, -0.01, -0.185], b: B_FIST, deg: 62, reachMaxH: ANTHRO.MAX_REACH_GH_FIST!.v },
  { name: 'uchi-uke (fist ctr)', d: [0.0, -0.005, -0.19], b: B_FIST, deg: 63, reachMaxH: ANTHRO.MAX_REACH_GH_FIST!.v },
  {
    name: 'shuto-uke (§13 row tabulated at the fingertip; §9.4 END — wrist)',
    /* §13's fingertip offsets are `(−s·0.010, +0.005, −0.250)`; the 59° next to them is §9.4's
     * `END — wrist` row `(s·0.003, −0.052, −0.159)` against `b = FOREARM`. See the file header —
     * §13.1 publishes no elbow→fingertip `b`, and the fingertip reading misses by 8.3°. */
    d: [0.003, -0.052, -0.159],
    b: B_WRIST,
    deg: 59,
    reachMaxH: null,
    note: 'wrist-referenced, per doc 03 §9.4',
  },
  { name: 'tettsui (tate) (fist ctr)', d: [-0.1, -0.118, -0.297], b: B_FIST, deg: 135, reachMaxH: ANTHRO.MAX_REACH_GH_FIST!.v },
  { name: 'hikite, all except shuto-uke (fist ctr)', d: [-0.025, -0.188, 0.02], b: B_FIST, deg: 63, reachMaxH: ANTHRO.MAX_REACH_GH_FIST!.v },
  {
    name: 'hikite, shuto-uke (hand ctr)',
    /* §13.1 lists no elbow→hand-centre `b`. `ELBOW_TO_FIST_CENTRE` is the one that reproduces
     * BOTH hand-centre rows in the document — this one (62°) and §9.4's START (83°, checked
     * below) — so the hand centre and the fist centre are the same `b` in doc 03's arithmetic. */
    d: [-0.135, -0.118, -0.055],
    b: B_FIST,
    deg: 62,
    reachMaxH: ANTHRO.MAX_REACH_GH_FIST!.v,
    note: 'hand centre reproduces on b = ELBOW_TO_FIST_CENTRE',
  },
]);

/** doc 03 §13.1's tolerance, verbatim. Nothing in this file may widen it. */
const LOC_TOL_DEG = 1.0;

describe('doc 03 §13.1 — every law-of-cosines row, ±1.0°', () => {
  it.each(LOC_ROWS.map((r) => [r.name, r] as const))('%s', (_n, row) => {
    const c = Math.hypot(row.d[0], row.d[1], row.d[2]);

    /* Route 1 — `lawOfCosines`, the solver's own step 2, unclamped (`0…180` is a no-op range).
     * `thetaB` IS the included elbow angle: doc 06 §6.1 calls it "interior angle A-B-C". */
    const { thetaB } = lawOfCosines(c, A_UPPER_ARM, row.b, 0, 180);
    expect(Math.abs(thetaB * RAD - row.deg)).toBeLessThan(LOC_TOL_DEG);

    /* Route 2 — solve for the actual joint POSITIONS and measure the angle geometrically with
     * `includedAngleDeg`, the function §4.11 S4 gates `TechniqueSpec.elbowIncludedDeg` with.
     * Two independent routes to the same number is what makes the row a check and not a tautology.
     *
     * `soften: 1` because doc 03 §13.1's arithmetic has no soften term in it — the zuki rows sit
     * at 99.7 % of `Lsum`, deep inside the default 0.97 soften band, so leaving `SOFTEN_DEFAULT`
     * on would measure the soften curve rather than the doc's law of cosines. */
    const outB = new Float64Array(3);
    const outC = new Float64Array(3);
    const target = V(row.d[0], row.d[1], row.d[2]);
    const residual = solveTwoBonePositions(
      args({ lenAB: A_UPPER_ARM, lenBC: row.b, target, soften: 1 }),
      outB,
      outC,
    );
    expect(residual).toBeLessThan(1e-9);
    expect(Math.abs(includedAngleDeg(ORIGIN(), outB, outC) - row.deg)).toBeLessThan(LOC_TOL_DEG);

    /* §13.1 assertions 1 and 2: `|E − GH| = UPPER_ARM` and `|F − E| = ` this row's `b`. */
    expect(Math.abs(dist(outB, ORIGIN()) - A_UPPER_ARM)).toBeLessThan(1e-9);
    expect(Math.abs(dist(outC, outB) - row.b)).toBeLessThan(1e-9);

    /* §13.1 assertion 4: "reach limit never exceeded". */
    if (row.reachMaxH !== null) expect(c).toBeLessThanOrEqual(row.reachMaxH);
  });

  it('doc 03 §9.4 START — hand centre, 83° — confirms the hand-centre `b`', () => {
    /* The second hand-centre row in the document. It reproduces on the SAME `b` as the shuto-uke
     * hikite row above (82.68° vs 83), which is the evidence for that row's choice of `b` — one
     * row agreeing could be a coincidence, two cannot. */
    const c = Math.hypot(-0.23, 0.027, -0.06);
    const { thetaB } = lawOfCosines(c, A_UPPER_ARM, B_FIST, 0, 180);
    expect(Math.abs(thetaB * RAD - 83)).toBeLessThan(LOC_TOL_DEG);
  });

  it('the fingertip reading of the shuto-uke row is the one that does NOT reproduce', () => {
    /* Recorded so the header's claim is checkable rather than asserted. elbow→fingertip =
     * FOREARM + HAND = 0.254 H against §13's fingertip offsets gives 67.29°, 8.29° off the
     * tabulated 59 — far outside §13.1's own ±1.0°. */
    const c = Math.hypot(-0.01, 0.005, -0.25);
    const bFingertip = ANTHRO.FOREARM!.v + ANTHRO.HAND!.v;
    const { thetaB } = lawOfCosines(c, A_UPPER_ARM, bFingertip, 0, 180);
    expect(thetaB * RAD).toBeGreaterThan(59 + LOC_TOL_DEG);
    expect(thetaB * RAD).toBeCloseTo(67.285, 2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 3. `softenReach` — MONOTONE, ASYMPTOTIC TO `Lsum`, C¹ AT `d0`
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 06 §6.1 step 1 — the soften curve', () => {
  const CHAINS: readonly (readonly [number, number])[] = Object.freeze([
    [0.4, 0.3],
    [0.4244, 0.4363],   // LEG_LEN_M scale
    [0.2831, 0.2704],   // ARM_LEN_M scale
    [0.1, 0.1],         // equal bones: r_min collapses to 0.01·Lsum
  ]);

  it.each(CHAINS)('L1=%f L2=%f — monotone non-decreasing in r', (lenAB, lenBC) => {
    const lSum = lenAB + lenBC;
    let prev = -Infinity;
    for (let k = 0; k <= 2000; k++) {
      const r = (2.0 * lSum * k) / 2000;
      const rc = softenReach(r, lenAB, lenBC, SOFTEN_DEFAULT);
      expect(rc).toBeGreaterThanOrEqual(prev - 1e-15);
      prev = rc;
    }
  });

  it.each(CHAINS)('L1=%f L2=%f — asymptotes to Lsum and never overshoots it', (lenAB, lenBC) => {
    const lSum = lenAB + lenBC;
    /* Never above `Lsum`: overshooting is what the clamp exists to prevent, and one ULP of
     * overshoot makes `acos` return NaN in step 2 on the very frame the arm locks out. */
    for (const mult of [1.0, 1.01, 1.1, 1.5, 2, 5, 20, 100]) {
      expect(softenReach(mult * lSum, lenAB, lenBC, SOFTEN_DEFAULT)).toBeLessThanOrEqual(lSum + 1e-15);
    }
    /* And it genuinely approaches it rather than saturating early. */
    expect(softenReach(1.5 * lSum, lenAB, lenBC, SOFTEN_DEFAULT)).toBeGreaterThan(lSum - 1e-3 * lSum);
    expect(Math.abs(softenReach(50 * lSum, lenAB, lenBC, SOFTEN_DEFAULT) - lSum)).toBeLessThan(1e-12);
    /* Strictly inside `Lsum` while the limb is still bending — otherwise "soften" is a clamp. */
    expect(softenReach(1.0 * lSum, lenAB, lenBC, SOFTEN_DEFAULT)).toBeLessThan(lSum);
  });

  it.each(CHAINS)('L1=%f L2=%f — C¹ at r = soften·Lsum: both one-sided derivatives are 1', (lenAB, lenBC) => {
    const lSum = lenAB + lenBC;
    const d0 = SOFTEN_DEFAULT * lSum;
    const h = 1e-7;
    const f = (r: number) => softenReach(r, lenAB, lenBC, SOFTEN_DEFAULT);

    /* Continuity first — a C¹ claim about a discontinuous function is meaningless. */
    expect(Math.abs(f(d0 + h) - f(d0))).toBeLessThan(1e-6);

    const left = (f(d0) - f(d0 - h)) / h;
    const right = (f(d0 + h) - f(d0)) / h;
    /* doc 06 §6.1: "both one-sided derivatives = 1". The residual on the right is the O(h) term
     * of `1 − exp(−h/span)`, not a kink; 1e-4 is ~40x that term and ~1e4x below a real kink
     * (the pre-soften clamp would give a right derivative of 0). */
    expect(Math.abs(left - 1)).toBeLessThan(1e-4);
    expect(Math.abs(right - 1)).toBeLessThan(1e-4);
  });

  it('below d0 the curve is the identity — soften must not perturb an in-range reach', () => {
    const lenAB = 0.4244;
    const lenBC = 0.4363;
    const lSum = lenAB + lenBC;
    const rMin = Math.abs(lenAB - lenBC) + 0.01 * lSum;
    for (let k = 0; k <= 50; k++) {
      const r = rMin + ((SOFTEN_DEFAULT * lSum - rMin) * k) / 50;
      expect(Math.abs(softenReach(r, lenAB, lenBC, SOFTEN_DEFAULT) - r)).toBeLessThan(1e-15);
    }
    /* And below `r_min` it holds at `r_min` — the inner hole of the annulus, not a negative reach. */
    expect(softenReach(0, lenAB, lenBC, SOFTEN_DEFAULT)).toBeCloseTo(rMin, 12);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * 4. THE MID-JOINT LIMIT IS PART OF THE SOLVE, NOT A POST-PASS
 *
 * doc 06 §6.1: `thetaB = clamp(thetaB, PI − flexMax, PI − flexMin)` and THEN `r_c` is recomputed
 * from the law of cosines. With `midMaxDeg = 140` (doc 06 §3.1's knee flexion clamp) the chain
 * cannot fold past 140°, so every target closer than `sqrt(L1²+L2²−2·L1·L2·cos 40°)` is out of
 * the LIMITED reach even though it is well inside the geometric one.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 06 §6.1 step 2 — the mid limit shortens the reach without opening the chain', () => {
  const lenAB = 0.4244;
  const lenBC = 0.4363;
  const MID_MAX = 140;
  /** The tightest fold `midMaxDeg = 140` allows: `thetaB = 180 − 140 = 40°`. */
  const rLimited = Math.sqrt(
    lenAB * lenAB + lenBC * lenBC - 2 * lenAB * lenBC * Math.cos((180 - MID_MAX) / RAD),
  );

  it('a target inside the limited reach still leaves the chain closed, and the residual grows', () => {
    let prevResidual = -Infinity;
    for (let k = 0; k <= 10; k++) {
      /* March the target IN from the limit toward the root — deeper violation each step. */
      const r = rLimited * (1 - 0.07 * k);
      const u = unit([0.2, -0.9, -0.4]);
      const target = V(u[0] * r, u[1] * r, u[2] * r);
      const outB = new Float64Array(3);
      const outC = new Float64Array(3);
      const residual = solveTwoBonePositions(
        args({ lenAB, lenBC, target, midMinDeg: 0, midMaxDeg: MID_MAX }),
        outB,
        outC,
      );

      /* THE POINT OF THE WHOLE TEST. A post-clamp would move B and leave `|C′−B′| ≠ lenBC`. */
      expect(Math.abs(dist(outB, ORIGIN()) - lenAB), `k=${k} |B'-A|`).toBeLessThan(1e-9);
      expect(Math.abs(dist(outC, outB) - lenBC), `k=${k} |C'-B'|`).toBeLessThan(1e-9);

      /* The flexion actually achieved is the limit, not something past it. */
      const flexDeg = 180 - includedAngleDeg(ORIGIN(), outB, outC);
      expect(flexDeg).toBeLessThanOrEqual(MID_MAX + 1e-9);
      expect(flexDeg).toBeCloseTo(MID_MAX, 9);

      /* The shortfall is REPORTED, monotonically, rather than hidden. */
      expect(residual, `k=${k} residual`).toBeGreaterThan(prevResidual);
      expect(Math.abs(residual - dist(outC, target))).toBeLessThan(1e-12);
      /* C′ sits on the limited sphere: the endpoint moved, the chain did not break. */
      expect(Math.abs(dist(outC, ORIGIN()) - rLimited)).toBeLessThan(1e-9);
      prevResidual = residual;
    }
    expect(prevResidual).toBeGreaterThan(0.02); // ~2 cm of honest shortfall at the deepest sample
  });

  it('the same targets are hit exactly once the limit is lifted', () => {
    /* The control. If these failed too, the test above would be measuring the annulus, not the
     * limit — `midMaxDeg = 180` is the only difference between the two runs. */
    for (let k = 0; k <= 10; k++) {
      const r = rLimited * (1 - 0.07 * k);
      const u = unit([0.2, -0.9, -0.4]);
      const target = V(u[0] * r, u[1] * r, u[2] * r);
      const outB = new Float64Array(3);
      const outC = new Float64Array(3);
      const residual = solveTwoBonePositions(
        args({ lenAB, lenBC, target, midMinDeg: 0, midMaxDeg: 180 }),
        outB,
        outC,
      );
      expect(residual).toBeLessThan(1e-9);
    }
  });

  it('the limit also holds the chain closed on the far side (out of reach beyond Lsum)', () => {
    /* The other boundary of the same invariant: past `Lsum` the soften branch under-reaches, and
     * the chain must still close. Residual `> 0` here is doc 06 §6.1's design, not a failure —
     * §4.11 S4 gates the MAGNITUDE at 0.005 m, which is why it must be reported truthfully. */
    const lSum = lenAB + lenBC;
    for (const mult of [1.0, 1.05, 1.25, 2.0]) {
      const u = unit([0.1, 0.3, -0.95]);
      const r = mult * lSum;
      const target = V(u[0] * r, u[1] * r, u[2] * r);
      const outB = new Float64Array(3);
      const outC = new Float64Array(3);
      const residual = solveTwoBonePositions(args({ lenAB, lenBC, target }), outB, outC);
      expect(Math.abs(dist(outB, ORIGIN()) - lenAB)).toBeLessThan(1e-9);
      expect(Math.abs(dist(outC, outB) - lenBC)).toBeLessThan(1e-9);
      expect(residual).toBeGreaterThan(0);
      expect(dist(outC, ORIGIN())).toBeLessThanOrEqual(lSum + 1e-12);
    }
  });
});
