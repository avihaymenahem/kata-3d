/**
 * tests/contracts/ease.test.ts — the kime ease, its analytic derivatives, and the one thing that
 * makes them worth having: the easing the CRITIC measures is bit-identical to the easing the
 * COMPILER baked.
 *
 * RED-FIRST (ARCHITECTURE.md §4.0, §8 Phase 0). The contract-level assertions below hold from
 * Phase 0; the cross-block identity does not, because `src/solve/channels.ts` (B3) and
 * `CHANNEL_DYN` (B1) do not exist yet. That identity is the load-bearing one: §3.3's entire
 * justification for putting the easing in a frozen contract file is that the compiler and the
 * metrics module cannot drift apart, and nothing else in the suite tests it.
 *
 * §4.0 names the assertions: S(0)=0, S(1)=1, S'(0)=S'(1)=0, S(0.5)<0.30 at tauP=0.73, and
 * `kimeEaseAcc === numeric d2S/dtau2` to 1e-6.
 */

import { describe, expect, it } from 'vitest';
import {
  aFromPeak,
  criticalDampClosed,
  easeInOutCubic,
  easeOutCubic,
  holdThenSnap,
  holdThenSnapVel,
  HOLD_UNTIL_DEFAULT,
  kimeEase,
  kimeEaseAcc,
  kimeEaseVel,
  KIME_TAU_PEAK_DEFAULT,
  overshootRatio,
  quatAngleDeg,
  settle2,
  SETTLE_ZETA_MAX,
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

/** Numerically invert S to find the tau at which a given fraction of the path is covered. */
function tauAtDistance(frac: number, tauPeak: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (kimeEase(mid, tauPeak) < frac) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('§3.3 / doc 04 §4.2 — the curve', () => {
  it('a = tauP / (1 - tauP); a(0.73) = 2.7037', () => {
    expect(aFromPeak(0.73)).toBeCloseTo(2.7037037, 6);
    expect(aFromPeak(0.5)).toBe(1);
    expect(KIME_TAU_PEAK_DEFAULT).toBe(0.73);
  });

  it('S(0) = 0 and S(1) = 1, exactly', () => {
    expect(kimeEase(0)).toBe(0);
    expect(kimeEase(1)).toBe(1);
    for (const tp of [0.3, 0.42, 0.55, 0.65, 0.73, 0.78]) {
      expect(kimeEase(0, tp)).toBe(0);
      expect(kimeEase(1, tp)).toBeCloseTo(1, 12);
    }
  });

  it("S'(0) = S'(1) = 0 — the C1 dead stop at the lock. This IS kime.", () => {
    expect(kimeEaseVel(0)).toBe(0);
    expect(kimeEaseVel(1)).toBe(0);
    for (const tp of [0.42, 0.55, 0.65, 0.73, 0.78]) {
      expect(kimeEaseVel(0, tp)).toBe(0);
      expect(kimeEaseVel(1, tp)).toBe(0);
    }
  });

  it('S(0.5) < 0.30 at tauP = 0.73 (doc 04 §4.4 gives 21.9 %)', () => {
    expect(kimeEase(0.5)).toBeLessThan(0.3);
    expect(kimeEase(0.5)).toBeCloseTo(0.219, 3);
  });

  it('S is monotone non-decreasing and stays in [0, 1]', () => {
    for (const tp of [0.3, 0.45, 0.6, 0.73, 0.78]) {
      let prev = -1;
      for (let k = 0; k <= 2000; k++) {
        const v = kimeEase(k / 2000, tp);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-15);
        expect(v).toBeGreaterThanOrEqual(-1e-15);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
        prev = v;
      }
    }
  });

  it('tau is clamped outside [0, 1]', () => {
    expect(kimeEase(-1)).toBe(0);
    expect(kimeEase(2)).toBe(1);
    expect(kimeEaseVel(-1)).toBe(0);
    expect(kimeEaseVel(2)).toBe(0);
  });

  /**
   * §3.9 evaluates `chan.accelL/accelR` on the WHOLE-KATA 480 Hz grid, so tau is outside [0,1]
   * through every hold and every inter-move gap. Clamping tau rather than the value held
   * `S''(1) = -(a+1)(a+2) = -17.42` forever — a constant brake of about -75 m/s^2 (7.7 g) on a limb
   * at rest — which the cloth wrinkle drive, metric 50 `kime_decel_time_s` and metric 51
   * `accel_profile_skew` would all have read as a permanently decelerating wrist.
   */
  it('kimeEaseAcc returns 0 outside the stroke — no phantom brake through the holds', () => {
    for (const tp of [0.3, 0.42, 0.5, 0.55, 0.65, 0.73, 0.78]) {
      for (const t of [1.0001, 1.5, 2, 5, 1e6]) {
        expect(kimeEaseAcc(t, tp), `acc(${t}, ${tp}) must be 0 after the lock`).toBe(0);
      }
      // tau < 0 must be 0 too — and for tauP < 0.5 the old clamp returned +Infinity there.
      for (const t of [-1e-9, -1, -1e6]) {
        expect(kimeEaseAcc(t, tp), `acc(${t}, ${tp}) must be 0 before the stroke`).toBe(0);
      }
    }
    // tau === 1 EXACTLY keeps the one-sided brake: it is the largest-magnitude sample on the curve
    // and the physical delta-v step that ImpulseEvent carries. The discontinuity there IS kime.
    const a = aFromPeak(KIME_TAU_PEAK_DEFAULT);
    expect(kimeEaseAcc(1)).toBeCloseTo(-(a + 1) * (a + 2), 9);
    expect(kimeEaseAcc(1)).toBeLessThan(-17);
    // Symmetric with its siblings at the endpoints.
    expect(kimeEase(1.5)).toBe(1);
    expect(kimeEaseVel(1.5)).toBe(0);
  });

  it("kimeEaseVel is exactly S' (analytic, not fitted)", () => {
    const h = 1e-6;
    let worst = 0;
    for (const tp of [0.42, 0.55, 0.65, 0.73, 0.78]) {
      for (let k = 1; k < 1000; k++) {
        const t = k / 1000;
        const num = (kimeEase(t + h, tp) - kimeEase(t - h, tp)) / (2 * h);
        worst = Math.max(worst, Math.abs(num - kimeEaseVel(t, tp)));
      }
    }
    expect(worst).toBeLessThan
      (1e-6);
  });

  it('peak speed is 2.009x mean at tauP = 0.73, and peaks AT tauP', () => {
    const a = aFromPeak(0.73);
    expect((a + 2) * Math.pow(a / (a + 1), a)).toBeCloseTo(2.009, 3);
    let bestT = 0;
    let best = -1;
    for (let k = 0; k <= 100_000; k++) {
      const t = k / 100_000;
      const v = kimeEaseVel(t);
      if (v > best) {
        best = v;
        bestT = t;
      }
    }
    expect(bestT).toBeCloseTo(0.73, 4);
  });

  it('doc 04 §4.4, tauP = 0.73: 48.6 % of the time covers the first 20 % of the path', () => {
    expect(tauAtDistance(0.2, 0.73) * 100).toBeCloseTo(48.6, 1);
    expect((1 - tauAtDistance(0.8, 0.73)) * 100).toBeCloseTo(18.0, 1);
    expect((1 - tauAtDistance(0.5, 0.73)) * 100).toBeCloseTo(33.2, 1);
    // Linear would spend 20 % on 20 % — a 2.4x error exactly where a trained eye reads (§10).
    expect(48.6 / 20).toBeCloseTo(2.43, 2);
  });
});

describe('§3.3 / §1 change 3 — kimeEaseAcc is ANALYTIC', () => {
  /**
   * Mixed absolute/relative error: |S''| reaches O(10) near the origin, so a pure absolute bound
   * would be measuring the central difference's own truncation error rather than the formula.
   */
  const accErr = (tp: number, lo: number, hi: number, h = 1e-4) => {
    let worst = 0;
    let worstAt = 0;
    for (let k = 1; k < 1000; k++) {
      const t = k / 1000;
      if (t < lo || t > hi || t - h < 0 || t + h > 1) continue;
      const num = (kimeEase(t + h, tp) - 2 * kimeEase(t, tp) + kimeEase(t - h, tp)) / (h * h);
      const err = Math.abs(num - kimeEaseAcc(t, tp)) / Math.max(1, Math.abs(kimeEaseAcc(t, tp)));
      if (err > worst) {
        worst = err;
        worstAt = t;
      }
    }
    return { worst, worstAt };
  };

  it('kimeEaseAcc === numeric d2S/dtau2 to 1e-6 at the default tauP over the whole interval', () => {
    const { worst, worstAt } = accErr(KIME_TAU_PEAK_DEFAULT, 0, 1);
    expect(worst, `worst at tau = ${worstAt}`).toBeLessThan(1e-6);
  });

  it('holds to 1e-6 for every doc 04 §4.3 channel tauP away from the origin', () => {
    // For tauP < 0.5 the exponent a-1 is negative and S'' genuinely diverges as tau -> 0+, so the
    // central difference — not the formula — is what breaks down there. kimeEaseAcc returns the
    // true analytic value; §3.9's accel channels are wrist channels at tauP = 0.73, and every
    // channel in doc 04 §4.3 that drives an accel* signal has tauP >= 0.50.
    for (const tp of [0.3, 0.42, 0.5, 0.55, 0.65, 0.73, 0.78]) {
      const { worst, worstAt } = accErr(tp, 0.05, 0.95);
      expect(worst, `tauP ${tp}, worst at tau = ${worstAt}`).toBeLessThan(1e-6);
    }
  });

  it("S''(tauPeak) = 0 exactly — the zero of the acceleration IS the velocity peak", () => {
    for (const tp of [0.55, 0.65, 0.73, 0.78]) {
      expect(Math.abs(kimeEaseAcc(tp, tp))).toBeLessThan(1e-12);
    }
  });

  it('the acceleration is positive before the peak and negative after: one accel, one brake', () => {
    expect(kimeEaseAcc(0.4)).toBeGreaterThan(0);
    expect(kimeEaseAcc(0.9)).toBeLessThan(0);
    // doc 04 §4.1 requirement 3: positive-accel time exceeds negative in 96.4 % of trials, i.e.
    // tauP > 0.50 always.
    expect(KIME_TAU_PEAK_DEFAULT).toBeGreaterThan(0.5);
  });
});

describe('doc 01 §8.3 — holdThenSnap makes a linear pelvis yaw unrepresentable', () => {
  it('holds flat to tau = 0.55, then ease-out cubic to 1', () => {
    expect(HOLD_UNTIL_DEFAULT).toBe(0.55);
    for (let k = 0; k <= 55; k++) expect(holdThenSnap(k / 100)).toBe(0);
    expect(holdThenSnap(1)).toBe(1);
    // doc 01 §8.3: 90 % of the rotation complete by t = 0.92 (+-0.05).
    expect(holdThenSnap(0.92)).toBeGreaterThan(0.9);
  });

  it('satisfies the doc 01 §9.5 X3 predicate structurally: |psi(0.5) - psi_start| <= 8 deg', () => {
    // Stage S7 asserts this on every move. With holdThenSnap the value is identically 0, so the
    // "hips ramp linearly / robotic turn" fault has no code path (§10).
    for (const excursionDeg of [45, 90, 180, 270]) {
      expect(Math.abs(holdThenSnap(0.5) * excursionDeg)).toBeLessThanOrEqual(8);
    }
  });

  it('holdThenSnapVel is the exact derivative away from the kink at holdUntil', () => {
    const h = 1e-6;
    let worst = 0;
    for (let k = 1; k < 1000; k++) {
      const t = k / 1000;
      if (Math.abs(t - HOLD_UNTIL_DEFAULT) < 1e-2) continue; // the authored velocity step
      const num = (holdThenSnap(t + h) - holdThenSnap(t - h)) / (2 * h);
      worst = Math.max(worst, Math.abs(num - holdThenSnapVel(t)));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('the snap is a velocity STEP at holdUntil — which is why the bake ladder must refine there', () => {
    expect(holdThenSnapVel(HOLD_UNTIL_DEFAULT - 1e-9)).toBe(0);
    expect(holdThenSnapVel(HOLD_UNTIL_DEFAULT + 1e-9)).toBeCloseTo(3 / (1 - HOLD_UNTIL_DEFAULT), 6);
  });
});

describe('§3.3 — the remaining exports', () => {
  it('criticalDampClosed is a unit step response with no overshoot', () => {
    expect(criticalDampClosed(-1, 14)).toBe(0);
    expect(criticalDampClosed(0, 14)).toBe(0);
    let prev = -1;
    for (let k = 0; k <= 1000; k++) {
      const v = criticalDampClosed(k / 100, 14);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-15);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    // doc 06 §6.5 head spring: omega = 14 rad/s, ~0.30 s settle.
    expect(criticalDampClosed(0.3, 14)).toBeGreaterThan(0.9);
  });

  it('settle2 overshoot ratios match doc 04 §5.1 (zeta 0.30 -> 0.372, 0.40 -> 0.254)', () => {
    expect(overshootRatio(0.3)).toBeCloseTo(0.372, 3);
    expect(overshootRatio(0.35)).toBeCloseTo(0.309, 3);
    expect(overshootRatio(0.4)).toBeCloseTo(0.254, 3);
    expect(overshootRatio(0.5)).toBeCloseTo(0.163, 3);
    expect(settle2(-1, 45, 0.4)).toBe(0);
    expect(settle2(0, 45, 0.4)).toBe(0);
  });

  /**
   * The `zeta >= 1` branch is the ANALYTIC CONTINUATION of doc 04 §5.1's amplitude-1 sine
   * (sin(ix) = i sinh(x)), so it is CONTINUOUS at zeta = 1. The previous invented form,
   * `omegaN*t*e^(1-omegaN*t)`, jumped 61x there (peak 0.0165 at zeta 0.999, 1.0000 at zeta 1.0)
   * and ignored zeta entirely above 1 — and §4.8's ui/look.ts exposes zeta as a live slider, so a
   * reviewer would have read the jump as a solver blow-up rather than a branch seam.
   */
  it('settle2 is continuous across the zeta = 1 branch seam', () => {
    const peak = (z: number) => {
      let best = -1;
      for (let k = 1; k <= 200_000; k++) best = Math.max(best, settle2(k / 1e6, 54, z));
      return best;
    };
    const below = peak(0.9999);
    const at = peak(1);
    const above = peak(1.0001);
    expect(at, 'the amplitude-1 sine has no oscillatory term at critical damping').toBeCloseTo(0, 6);
    expect(Math.abs(below - at), 'no jump from the underdamped side').toBeLessThan(1e-2);
    expect(Math.abs(above - at), 'no jump from the overdamped side').toBeLessThan(1e-2);
    // Bounded for every zeta, so an out-of-band knob can never produce a blow-up.
    for (const z of [1.0, 1.2, 2, 5, 20]) {
      expect(peak(z), `zeta ${z}`).toBeLessThan(0.55);
      expect(peak(z)).toBeGreaterThanOrEqual(0);
    }
    // The shipped table never reaches the seam: doc 04 §5.1's largest row is 0.55 + 0.10.
    expect(SETTLE_ZETA_MAX).toBe(0.65);
    expect(SETTLE_ZETA_MAX).toBeLessThan(1);
    expect(overshootRatio(1), 'no overshoot at or above critical damping').toBe(0);
  });

  it("settle2's own peak is atan(wd/(zeta*wn))/wd, and pi/wd is doc 04's overshoot column", () => {
    // §3.3: settle2 "returns a signed OFFSET multiplier" — doc 04 §5.1's x(t), the deviation from
    // the settled value. Its own first maximum is at atan(wd/(zeta*wn))/wd = 23.4 ms at wn 54.
    // doc 04's "time to peak overshoot" column (55 +- 20 ms for the fist channel) measures the
    // STEP RESPONSE's first peak, which is at pi/wd. B3 must not confuse the two.
    const wn = 54;
    const zeta = 0.4;
    const wd = wn * Math.sqrt(1 - zeta * zeta);

    let peakT = 0;
    let peak = -1;
    for (let k = 1; k <= 100_000; k++) {
      const t = k / 1_000_000;
      const v = settle2(t, wn, zeta);
      if (v > peak) {
        peak = v;
        peakT = t;
      }
    }
    expect(peakT * 1000).toBeCloseTo((Math.atan(wd / (zeta * wn)) / wd) * 1000, 2);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(1);

    const stepPeakMs = (Math.PI / wd) * 1000;
    expect(stepPeakMs, 'doc 04 §5.1 fist channel: 55 +- 20 ms').toBeGreaterThan(35);
    expect(stepPeakMs).toBeLessThan(75);

    // First zero crossing after the peak is at pi/wd, and the second lobe is the one clearly
    // readable bounce doc 04 §5.1 asks for (M_p = 0.254 at zeta 0.40).
    expect(Math.abs(settle2(Math.PI / wd, wn, zeta))).toBeLessThan(1e-12);
    expect(settle2(Math.PI / wd + 1e-4, wn, zeta)).toBeLessThan(0);
    expect(overshootRatio(zeta)).toBeCloseTo(0.254, 3);
  });

  it('easeOutCubic / easeInOutCubic are unit-interval and monotone', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    let p = -1;
    for (let k = 0; k <= 1000; k++) {
      const v = easeInOutCubic(k / 1000);
      expect(v).toBeGreaterThanOrEqual(p);
      p = v;
    }
  });

  it('quatAngleDeg folds the quaternion double cover', () => {
    expect(quatAngleDeg(0, 0, 0, 1, 0, 0, 0, 1)).toBe(0);
    expect(quatAngleDeg(0, 0, 0, 1, 0, 0, 0, -1)).toBe(0);
    const s = Math.sin(Math.PI / 4);
    const c = Math.cos(Math.PI / 4);
    expect(quatAngleDeg(0, 0, 0, 1, 0, s, 0, c)).toBeCloseTo(90, 10);
    expect(quatAngleDeg(0, 0, 0, 1, 0, -s, 0, -c)).toBeCloseTo(90, 10);
  });
});

describe('§3.3 — the compiler and the critic share ONE easing implementation', () => {
  it('channelAlpha/Vel/Acc are bit-identical to kimeEase/Vel/Acc at each channel tauP', async () => {
    const solve = await need('../../src/solve', 'channelAlpha', 'channelVel', 'channelAcc');
    const data = await need('../../src/data', 'CHANNEL_DYN');

    const channelAlpha = solve.channelAlpha as (ch: string, tau: number) => number;
    const channelVel = solve.channelVel as (ch: string, tau: number) => number;
    const channelAcc = solve.channelAcc as (ch: string, tau: number) => number;
    const dyn = data.CHANNEL_DYN as Record<string, { tauP: { v: number } }>;

    for (const [ch, spec] of Object.entries(dyn)) {
      const tp = spec.tauP.v;
      for (let k = 0; k <= 100; k++) {
        const tau = k / 100;
        expect(channelAlpha(ch, tau), `${ch} alpha @ ${tau}`).toBe(kimeEase(tau, tp));
        expect(channelVel(ch, tau), `${ch} vel @ ${tau}`).toBe(kimeEaseVel(tau, tp));
        if (tau > 0) expect(channelAcc(ch, tau), `${ch} acc @ ${tau}`).toBe(kimeEaseAcc(tau, tp));
      }
    }
  });
});
