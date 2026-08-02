/**
 * tests/contracts/bake-error.test.ts — G-9a and G-9b, measured off the baked track itself.
 *
 * RED-FIRST (ARCHITECTURE.md §4.0, §8 Phase 0).
 *
 * THIS IS THE TEST THAT ANSWERS THE PANEL'S UNANIMOUS FATAL (§9.1 A-1). Proposal A sized its flat
 * 120 Hz bake against the 900 deg/s pelvis; stage S4 actually ships doc 03 §4.3's forearm roll,
 *
 *     roll(tau) = 180 * clamp((tau - 0.65)/0.35, 0, 1)^2.2      over a 0.18 s stroke
 *
 * whose peak rate is 6285 deg/s = 52 deg per key at 120 Hz. The bound must therefore be measured,
 * not argued, and it must be measured from `PoseTrack.q` — not read out of `bakeStats`, which is
 * the compiler's own report on itself.
 */

import { describe, expect, it } from 'vitest';
import {
  BAKE_MAX_ERR_DEG,
  BAKE_MAX_STEP_DEG,
  BONE_COUNT,
  POSE_LADDER,
  quatAngleDeg,
  TICK_HZ,
  ticksPerFrame,
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

/** doc 03 §4.3, verbatim. `t` is the fraction of the stroke. */
const docRoll = (t: number): number =>
  180 * Math.pow(Math.min(Math.max((t - 0.65) / 0.35, 0), 1), 2.2);

const STROKE_S = 0.18; // doc 03 §4.3 / ARCHITECTURE §2.4

describe('§2.4 — the ladder arithmetic that forced the 960 rung (green from Phase 0)', () => {
  it("doc 03 §4.3's roll really does peak at ~6285 deg/s", () => {
    let peak = 0;
    const h = 1e-6;
    for (let k = 0; k <= 200_000; k++) {
      const t = k / 200_000;
      const d = (docRoll(Math.min(1, t + h)) - docRoll(Math.max(0, t - h))) / (2 * h * STROKE_S);
      if (d > peak) peak = d;
    }
    expect(peak).toBeGreaterThan(6200);
    expect(peak).toBeLessThan(6400);
  });

  it('criterion 2 (<= 12 deg/interval) binds at ~524 Hz, so 480 is not enough', () => {
    const dt = BAKE_MAX_STEP_DEG / 6285;
    expect(1 / dt).toBeGreaterThan(480);
    expect(1 / dt).toBeLessThan(960);
    expect(POSE_LADDER).toContain(960);
  });

  it('criterion 1 (<= 0.25 deg midpoint) binds at only ~245 Hz — criterion 2 is the binding one', () => {
    const thetaPP = 1.2e5; // deg/s^2, doc 03 §4.3 second derivative peak
    const hzCriterion1 = 1 / Math.sqrt((BAKE_MAX_ERR_DEG * 8) / thetaPP);
    const hzCriterion2 = 6285 / BAKE_MAX_STEP_DEG;
    expect(hzCriterion1).toBeGreaterThan(240);
    expect(hzCriterion1).toBeLessThan(260);
    expect(hzCriterion1, 'criterion 2 must be the binding one').toBeLessThan(hzCriterion2);
  });

  it('every ladder rung divides TICK_HZ exactly (§6.2 term 3 cannot round)', () => {
    for (const hz of POSE_LADDER) {
      expect(TICK_HZ % hz).toBe(0);
      const tpf = ticksPerFrame(hz);
      expect(Number.isInteger(Math.log2(tpf)), `${tpf} must be a power of two`).toBe(true);
    }
  });
});

describe('G-9a / G-9b — measured from the baked track', () => {
  it('reconstructs the roll from a baked track and holds both bounds', async () => {
    const data = await need('../../src/data', 'getKata');
    const solve = await need('../../src/solve', 'compileKata');

    interface Seg {
      readonly startTick: number;
      readonly frameCount: number;
      readonly rateHz: number;
      readonly ticksPerFrame: number;
      readonly qOffset: number;
      readonly reason: string;
    }
    interface Track {
      readonly q: Float32Array;
      readonly segments: readonly Seg[];
      readonly bakeStats: {
        readonly maxSlerpErrDeg: number;
        readonly maxStepDeg: number;
        readonly eventsBelow20msExact: boolean;
        readonly layerRecomposeErrDeg: number;
        readonly framesByRate: Readonly<Record<string, number>>;
      };
    }

    const k = (data.getKata as (id: string) => unknown)('taikyoku-shodan');
    const track = (solve.compileKata as (kk: unknown, o: unknown) => Track)(k, {
      tempoTier: 'T1',
      codeVersion: 'test',
    });

    /* 1. The compiler's own report must claim both bounds. */
    expect(track.bakeStats.maxSlerpErrDeg).toBeLessThan(BAKE_MAX_ERR_DEG);
    expect(track.bakeStats.maxStepDeg).toBeLessThanOrEqual(BAKE_MAX_STEP_DEG);
    expect(track.bakeStats.eventsBelow20msExact).toBe(true);
    expect(track.bakeStats.layerRecomposeErrDeg).toBeLessThan(1e-4);

    /* 2. INDEPENDENTLY recompute the per-interval angular step from PoseTrack.q, so the report
     *    cannot be wrong without this failing too. This is G-9b with teeth. */
    let worstStep = 0;
    let worstBone = -1;
    let worstTick = -1;
    for (const seg of track.segments) {
      const stride = BONE_COUNT * 4;
      for (let f = 0; f + 1 < seg.frameCount; f++) {
        const a = seg.qOffset + f * stride;
        const b = a + stride;
        for (let bone = 0; bone < BONE_COUNT; bone++) {
          const ai = a + bone * 4;
          const bi = b + bone * 4;
          const d = quatAngleDeg(
            track.q[ai]!, track.q[ai + 1]!, track.q[ai + 2]!, track.q[ai + 3]!,
            track.q[bi]!, track.q[bi + 1]!, track.q[bi + 2]!, track.q[bi + 3]!,
          );
          if (d > worstStep) {
            worstStep = d;
            worstBone = bone;
            worstTick = seg.startTick + f * seg.ticksPerFrame;
          }
        }
      }
    }
    expect(
      worstStep,
      `worst angular step ${worstStep.toFixed(3)} deg at bone ${worstBone}, tick ${worstTick}`,
    ).toBeLessThanOrEqual(BAKE_MAX_STEP_DEG);
    expect(Math.abs(worstStep - track.bakeStats.maxStepDeg)).toBeLessThan(1e-2);

    /* 3. A track that never reaches the 960 rung did not bake the roll: criterion 2 binds at
     *    524 Hz, above the 480 rung. */
    expect(track.bakeStats.framesByRate['960']).toBeGreaterThan(0);
    expect(track.segments.some((s) => s.rateHz === 960)).toBe(true);

    /* 4. Segments are contiguous, ascending, and each startTick is on its own frame grid (S13). */
    let cursor = track.segments[0]!.startTick;
    for (const seg of track.segments) {
      expect(seg.frameCount).toBeGreaterThanOrEqual(2);
      expect(seg.startTick % seg.ticksPerFrame).toBe(0);
      expect(seg.startTick).toBe(cursor);
      cursor = seg.startTick + (seg.frameCount - 1) * seg.ticksPerFrame;
    }
  });
});
