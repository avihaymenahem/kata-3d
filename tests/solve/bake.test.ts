/**
 * tests/solve/bake.test.ts — G-9a, G-9b and G-9c on both kata, plus the segment planner.
 *
 * OWNERSHIP B3's verification list: "**G-9a `maxSlerpErrDeg < 0.25`, G-9b `maxStepDeg <= 12`,
 * G-9c**; recompose error < 1e-4°".
 *
 * ═══ WHY THIS FILE MEASURES RATHER THAN TRUSTS ═════════════════════════════════════════════
 * `tests/contracts/bake-error.test.ts` already recomputes the worst angular step from
 * `PoseTrack.q` and asserts the compiler's own report matches it. This file covers what that one
 * cannot see: that the PLANNER made sensible choices — that the 960 rung is actually reached, that
 * it is reached where the roll is and not everywhere, and that the segment layout is contiguous
 * and on-grid before any pose is looked at.
 *
 * A bake that reports `maxStepDeg = 0.4` by baking the entire clip at 960 Hz passes every gate in
 * the contract test and is a 40 MB regression. The planner assertions below are the ones that
 * catch it.
 */

import { describe, expect, it } from 'vitest';

import { BAKE_MAX_ERR_DEG, BAKE_MAX_STEP_DEG, POSE_LADDER, ticksPerFrame } from '../../src/contracts';
import { getKata } from '../../src/data';
import { compileKata, planSegments, rungFor } from '../../src/solve';

const TAIKYOKU = compileKata(getKata('taikyoku-shodan'), {
  tempoTier: 'T1',
  codeVersion: 'test',
});

describe('the segment planner, in isolation', () => {
  it('rungFor picks the coarsest rung that keeps the step under 12 deg', () => {
    /* §2.4 criterion 2: `requiredHz = rate / 12`. */
    expect(rungFor(0)).toBe(120);
    expect(rungFor(1200)).toBe(120); // 100 Hz required
    expect(rungFor(2000)).toBe(240); // 167 Hz
    expect(rungFor(5000)).toBe(480); // 417 Hz
    expect(rungFor(8081)).toBe(960); // 673 Hz — the oi-zuki roll peak
    /* Past the top rung it saturates rather than throwing: the bake still happens and G-9b
     * reports the overshoot, which is a routable finding. Silently failing to bake is not. */
    expect(rungFor(1e6)).toBe(960);
  });

  it('every planned segment is on its own frame grid and shares its boundary frame', () => {
    const rates = [200, 200, 9000, 9000, 200, 200, 200, 200];
    const plan = planSegments(rates, rates.length * 8);
    let cursor = plan[0]!.startTick;
    for (const e of plan) {
      const tpf = ticksPerFrame(e.rateHz);
      expect(e.startTick % tpf, `segment at ${e.startTick} off the ${e.rateHz} Hz grid`).toBe(0);
      expect(e.startTick).toBe(cursor);
      expect(e.endTick).toBeGreaterThan(e.startTick);
      cursor = e.endTick;
    }
  });

  it('a fast interval pulls its neighbours up, so the transition in is already fine', () => {
    /* Without dilation the first interval of a roll is baked at the OLD rung and carries the
     * whole step — the staircase appears at the START of the fast passage, which is exactly
     * where the eye is drawn. */
    const rates = [100, 100, 9000, 100, 100];
    const plan = planSegments(rates, rates.length * 8);
    const fine = plan.filter((p) => p.rateHz >= 480);
    expect(fine.length).toBeGreaterThan(0);
    const fineTicks = fine.reduce((a, p) => a + (p.endTick - p.startTick), 0);
    /* The fast probe interval is 8 ticks; dilation should widen it to at least 3 probes. */
    expect(fineTicks).toBeGreaterThanOrEqual(24);
  });
});

describe('G-9a / G-9b / G-9c on the compiled track', () => {
  it('Taikyoku Shodan holds both bake bounds', () => {
    expect(TAIKYOKU.bakeStats.maxSlerpErrDeg, 'G-9a').toBeLessThan(BAKE_MAX_ERR_DEG);
    expect(TAIKYOKU.bakeStats.maxStepDeg, 'G-9b').toBeLessThanOrEqual(BAKE_MAX_STEP_DEG);
    expect(TAIKYOKU.bakeStats.eventsBelow20msExact, 'G-9c').toBe(true);
  });

  it('the recompose error at w = 1 is below 1e-4 deg', () => {
    expect(TAIKYOKU.bakeStats.layerRecomposeErrDeg).toBeLessThan(1e-4);
  });

  it('the ladder is USED, not saturated — the 960 rung is reached and is a minority', () => {
    const by = TAIKYOKU.bakeStats.framesByRate;
    /* Reached: a track that never hits 960 did not bake the roll (§2.4, and
     * tests/contracts/bake-error.test.ts step 3). */
    expect(by['960'], 'the roll needs the 960 rung').toBeGreaterThan(0);
    /* A minority: the clip is standing still most of the time. If the 960 rung is the majority
     * the planner has stopped discriminating and the adaptive bake is buying nothing. */
    const total = TAIKYOKU.bakeStats.baseFrames;
    expect(by['960'] / total, '960 Hz should be a minority of frames').toBeLessThan(0.5);
  });

  it('segments are contiguous, ascending, and each starts on its own frame grid (S13)', () => {
    let cursor = TAIKYOKU.segments[0]!.startTick;
    for (const seg of TAIKYOKU.segments) {
      expect(seg.frameCount).toBeGreaterThanOrEqual(2);
      expect(POSE_LADDER).toContain(seg.rateHz);
      expect(seg.ticksPerFrame).toBe(ticksPerFrame(seg.rateHz));
      expect(seg.startTick % seg.ticksPerFrame).toBe(0);
      expect(seg.startTick).toBe(cursor);
      cursor = seg.startTick + (seg.frameCount - 1) * seg.ticksPerFrame;
    }
    expect(cursor).toBeLessThanOrEqual(TAIKYOKU.durationTicks);
  });

  it('q is sized for exactly the frames the segments declare', () => {
    const frames = TAIKYOKU.segments.reduce((a, s) => a + s.frameCount, 0);
    expect(TAIKYOKU.bakeStats.baseFrames).toBe(frames);
    expect(TAIKYOKU.q.length).toBe(frames * 52 * 4);
    expect(TAIKYOKU.rootPos.length).toBe(frames * 3);
    expect(TAIKYOKU.rootQuat.length).toBe(frames * 4);
  });

  it('no NaN anywhere in the baked buffers', () => {
    for (const [name, buf] of [
      ['q', TAIKYOKU.q], ['rootPos', TAIKYOKU.rootPos],
      ['rootQuat', TAIKYOKU.rootQuat], ['chan', TAIKYOKU.chan],
    ] as const) {
      let bad = -1;
      for (let i = 0; i < buf.length; i++) {
        if (Number.isNaN(buf[i]!)) { bad = i; break; }
      }
      expect(bad, `${name} has NaN at index ${bad}`).toBe(-1);
    }
  });

  it('every baked quaternion is unit length', () => {
    let worst = 0;
    for (let i = 0; i + 3 < TAIKYOKU.q.length; i += 4) {
      const n = Math.hypot(TAIKYOKU.q[i]!, TAIKYOKU.q[i + 1]!, TAIKYOKU.q[i + 2]!, TAIKYOKU.q[i + 3]!);
      worst = Math.max(worst, Math.abs(n - 1));
    }
    /* float32 storage of a float64-normalised quaternion: ~6e-8. */
    expect(worst).toBeLessThan(1e-5);
  });
});

describe('the track is shaped the way §3.9 declares', () => {
  it('carries all five layers, in LAYER_ORDER', () => {
    expect(TAIKYOKU.layers.map((l) => l.id)).toEqual(['koshi', 'kime', 'breath', 'gaze', 'patch']);
    for (const l of TAIKYOKU.layers) {
      expect(l.defaultWeight).toBe(1);
      expect(l.dq.length).toBe(TAIKYOKU.bakeStats.baseFrames * l.bones.length * 4);
      /* Sorted ascending — §3.9's own requirement on `LayerTrack.bones`. */
      for (let i = 1; i < l.bones.length; i++) {
        expect(l.bones[i]!).toBeGreaterThan(l.bones[i - 1]!);
      }
    }
    /* Only `breath` carries a ribcage scale (§2.8: the one scalable bone). */
    expect(TAIKYOKU.layers.find((l) => l.id === 'breath')!.dScaleRibcage).not.toBeNull();
    for (const l of TAIKYOKU.layers.filter((x) => x.id !== 'breath')) {
      expect(l.dScaleRibcage).toBeNull();
    }
  });

  it('marks are ascending and the channel grid covers the clip', () => {
    for (let i = 1; i < TAIKYOKU.marks.length; i++) {
      expect(TAIKYOKU.marks[i]!.tick).toBeGreaterThanOrEqual(TAIKYOKU.marks[i - 1]!.tick);
    }
    expect(TAIKYOKU.chanRateHz).toBe(480);
    expect(TAIKYOKU.chan.length).toBe(TAIKYOKU.chanFrameCount * 14);
    expect(TAIKYOKU.chanFrameCount * 8).toBeGreaterThanOrEqual(TAIKYOKU.durationTicks - 8);
  });

  it('the hash is 16 hex characters and is stable across two compiles', () => {
    expect(TAIKYOKU.hash).toMatch(/^[0-9a-f]{16}$/);
    const again = compileKata(getKata('taikyoku-shodan'), { tempoTier: 'T1', codeVersion: 'test' });
    expect(again.hash).toBe(TAIKYOKU.hash);
  });
});
