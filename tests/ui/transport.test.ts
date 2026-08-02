/**
 * tests/ui/transport.test.ts — the read-out arithmetic behind the HUD's transport strip.
 *
 * `vitest.config.ts` pins `environment: 'node'`, so the DOM half of `src/ui/transport.ts` is not
 * reachable from here and adding jsdom would be a new dependency. What IS testable, and what the
 * bugs actually live in, is the arithmetic: the clock string, the frame ordinal a reviewer counts
 * steps with, and the two clamps that keep a knob on its rail. Those are exported as pure functions
 * precisely so this file can exist.
 */

import { describe, expect, it } from 'vitest';

import { DISPLAY_TICKS, TICK_HZ } from '../../src/contracts';
import {
  formatTransportClock,
  frameIndexOf,
  pointerFraction,
  positionFraction,
} from '../../src/ui';

/** The transport's step, derived the same way `src/player/app.ts` derives `DISPLAY_FRAME_S`. */
const FRAME_S = DISPLAY_TICKS / TICK_HZ;

describe('the display frame the transport steps by', () => {
  it('is exactly one 60 fps frame, from B0’s frozen constants', () => {
    expect(FRAME_S).toBe(1 / 60);
    expect(DISPLAY_TICKS).toBe(64);
    expect(TICK_HZ).toBe(3840);
  });

  it('is COARSER than the 100 Hz capture, so no step can land between two rendered images', () => {
    expect(FRAME_S).toBeGreaterThan(1 / 100);
  });
});

describe('formatTransportClock', () => {
  it('reads `current / duration s` at two decimals', () => {
    expect(formatTransportClock(12.4, 26.9)).toBe('12.40 / 26.90 s');
  });

  it('keeps two decimals so a single frame step is always visible in the readout', () => {
    // 1/60 s = 16.7 ms. At ONE decimal these two would both print "1.0".
    expect(formatTransportClock(1.0, 10)).not.toBe(formatTransportClock(1.0 + FRAME_S, 10));
  });

  it('never prints a negative position or NaN', () => {
    expect(formatTransportClock(-0.5, 10)).toBe('0.00 / 10.00 s');
    expect(formatTransportClock(Number.NaN, Number.NaN)).toBe('0.00 / 0.00 s');
  });
});

describe('frameIndexOf', () => {
  it('counts whole frames from zero', () => {
    expect(frameIndexOf(0, FRAME_S)).toBe(0);
    expect(frameIndexOf(1, FRAME_S)).toBe(60);
  });

  it('advances by exactly 1 per step, which is the property the button claims', () => {
    let t = 7.5;
    const start = frameIndexOf(t, FRAME_S);
    for (let i = 1; i <= 12; i++) {
      t += FRAME_S;
      expect(frameIndexOf(t, FRAME_S)).toBe(start + i);
    }
  });

  it('rounds rather than floors, so accumulated float drift never eats a step', () => {
    // Summing 1/60 six hundred times lands a hair under 10 s; `Math.floor` would report 599.
    let t = 0;
    for (let i = 0; i < 600; i++) t += FRAME_S;
    expect(t).not.toBe(10);
    expect(frameIndexOf(t, FRAME_S)).toBe(600);
  });

  it('degrades to 0 on a zero-length frame or a NaN clock', () => {
    expect(frameIndexOf(5, 0)).toBe(0);
    expect(frameIndexOf(Number.NaN, FRAME_S)).toBe(0);
  });
});

describe('positionFraction', () => {
  it('is current / duration, clamped to the rail', () => {
    expect(positionFraction(5, 20)).toBe(0.25);
    expect(positionFraction(-1, 20)).toBe(0);
    expect(positionFraction(99, 20)).toBe(1);
  });

  it('parks at the left rather than at NaN for a zero-length source', () => {
    expect(positionFraction(3, 0)).toBe(0);
    expect(positionFraction(3, Number.NaN)).toBe(0);
  });
});

describe('pointerFraction', () => {
  it('maps a pointer x onto [0,1] across the scrub', () => {
    expect(pointerFraction(140, 100, 160)).toBe(0.25);
    expect(pointerFraction(100, 100, 160)).toBe(0);
    expect(pointerFraction(260, 100, 160)).toBe(1);
  });

  it('clamps a drag that leaves the strip — the normal case once the pointer is captured', () => {
    expect(pointerFraction(-500, 100, 160)).toBe(0);
    expect(pointerFraction(5000, 100, 160)).toBe(1);
  });

  it('is 0 for a strip that has not been laid out yet', () => {
    expect(pointerFraction(50, 0, 0)).toBe(0);
  });
});
