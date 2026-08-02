/**
 * tests/ui/layout.test.ts — the breakpoint that decides "is this a phone".
 *
 * `vitest.config.ts` pins `environment: 'node'`, so nothing here can render a panel and measure it.
 * What it CAN do is the part that is actually easy to get wrong and impossible to notice: the
 * decision itself, checked against the real device matrix rather than against the two sizes that
 * happened to be open in a browser while it was written. Every viewport below is a shipping device.
 *
 * The other half is drift. `src/ui/layout.ts` publishes both the numbers and the media-query strings
 * the widgets compile into their stylesheets, and the whole point of that arrangement is that the
 * JavaScript decision and the CSS rule cannot disagree. That property is worth a test, because when
 * it breaks the symptom is a panel that boots collapsed under a stylesheet that thinks it is on a
 * desktop, and nothing in the UI says so.
 */

import { describe, expect, it } from 'vitest';

import {
  COARSE_POINTER_MEDIA,
  COMPACT_MAX_HEIGHT_PX,
  COMPACT_MAX_WIDTH_PX,
  COMPACT_MEDIA,
  isCompactViewport,
  readViewport,
  resolveLayout,
  TOUCH_MEDIA,
  TOUCH_TARGET_PX,
} from '../../src/ui';

/** Real viewports, in CSS px. Landscape entries are the same device with the axes swapped. */
const PHONE_PORTRAIT = { w: 375, h: 812 }; // iPhone X / 13 mini class
const PHONE_PORTRAIT_LARGE = { w: 430, h: 932 }; // iPhone 16 Pro Max
const PHONE_LANDSCAPE = { w: 812, h: 375 };
const PHONE_LANDSCAPE_LARGE = { w: 932, h: 430 };
const TABLET_PORTRAIT = { w: 768, h: 1024 }; // iPad 9.7"/10.2"
const TABLET_LANDSCAPE = { w: 1024, h: 768 };
const TABLET_MINI_LANDSCAPE = { w: 1133, h: 744 };
const LAPTOP = { w: 1280, h: 800 };
const DESKTOP = { w: 1920, h: 1080 };

const compactOf = (v: { w: number; h: number }): boolean => isCompactViewport(v.w, v.h);

describe('isCompactViewport — the device matrix', () => {
  it('calls every phone compact, in BOTH orientations', () => {
    expect(compactOf(PHONE_PORTRAIT)).toBe(true);
    expect(compactOf(PHONE_PORTRAIT_LARGE)).toBe(true);
    expect(compactOf(PHONE_LANDSCAPE)).toBe(true);
    expect(compactOf(PHONE_LANDSCAPE_LARGE)).toBe(true);
  });

  it('catches the widest phone in landscape, which a width-only rule would call a desktop', () => {
    // 932 x 430. This is the case the height half of the rule exists for: wider than the 900 px
    // cut, so width alone would open a 100vh-tall count list down a 430 px screen.
    expect(PHONE_LANDSCAPE_LARGE.w).toBeGreaterThan(COMPACT_MAX_WIDTH_PX);
    expect(compactOf(PHONE_LANDSCAPE_LARGE)).toBe(true);
    expect(isCompactViewport(PHONE_LANDSCAPE_LARGE.w, 10_000)).toBe(false); // width alone: not compact
  });

  it('calls a tablet in PORTRAIT compact and the same tablet in LANDSCAPE roomy', () => {
    // The panel costs a fixed 256 px whatever the screen; at 768 that is a third of the frame.
    expect(compactOf(TABLET_PORTRAIT)).toBe(true);
    expect(compactOf(TABLET_LANDSCAPE)).toBe(false);
    expect(compactOf(TABLET_MINI_LANDSCAPE)).toBe(false);
  });

  it('leaves every laptop and desktop alone', () => {
    expect(compactOf(LAPTOP)).toBe(false);
    expect(compactOf(DESKTOP)).toBe(false);
  });

  it('is INCLUSIVE at both thresholds, exactly as CSS `max-width` / `max-height` are', () => {
    // One pixel of disagreement here is a panel whose JavaScript and whose stylesheet have
    // different opinions about the same screen.
    expect(isCompactViewport(COMPACT_MAX_WIDTH_PX, 2000)).toBe(true);
    expect(isCompactViewport(COMPACT_MAX_WIDTH_PX + 1, 2000)).toBe(false);
    expect(isCompactViewport(2000, COMPACT_MAX_HEIGHT_PX)).toBe(true);
    expect(isCompactViewport(2000, COMPACT_MAX_HEIGHT_PX + 1)).toBe(false);
  });

  it('treats an unmeasurable viewport as roomy, not as a phone', () => {
    // `innerWidth` is 0 in a detached document. "0 x 0 is very narrow indeed" would boot every such
    // caller into a layout whose controls are folded behind toggles nobody knows to look for.
    expect(isCompactViewport(0, 0)).toBe(false);
    expect(isCompactViewport(Number.NaN, Number.NaN)).toBe(false);
    expect(isCompactViewport(-1, -1)).toBe(false);
  });
});

describe('the media-query strings the widgets compile into their CSS', () => {
  it('are built from the same two numbers the decision is', () => {
    expect(COMPACT_MEDIA).toBe(`(max-width: ${COMPACT_MAX_WIDTH_PX}px), (max-height: ${COMPACT_MAX_HEIGHT_PX}px)`);
  });

  it('are a comma list, i.e. OR — narrow OR short, never narrow AND short', () => {
    // `and` here would leave phone landscape (wide and short) on the desktop layout.
    expect(COMPACT_MEDIA).toContain(',');
    expect(COMPACT_MEDIA).not.toContain(' and ');
  });

  it('extend to a coarse pointer for SIZING only', () => {
    expect(TOUCH_MEDIA).toBe(`${COMPACT_MEDIA}, ${COARSE_POINTER_MEDIA}`);
    expect(COMPACT_MEDIA).not.toContain('pointer');
  });

  it('names a touch target the platform guidelines actually agree on', () => {
    expect(TOUCH_TARGET_PX).toBe(44);
  });
});

describe('resolveLayout', () => {
  const at = (w: number, h: number, coarsePointer = false) =>
    resolveLayout({ width: w, height: h, coarsePointer });

  it('hides the side menu by default on a phone and shows it on a desktop', () => {
    expect(at(PHONE_PORTRAIT.w, PHONE_PORTRAIT.h).hudCollapsed).toBe(true);
    expect(at(PHONE_LANDSCAPE_LARGE.w, PHONE_LANDSCAPE_LARGE.h).hudCollapsed).toBe(true);
    expect(at(TABLET_PORTRAIT.w, TABLET_PORTRAIT.h).hudCollapsed).toBe(true);
    expect(at(LAPTOP.w, LAPTOP.h).hudCollapsed).toBe(false);
    expect(at(DESKTOP.w, DESKTOP.h).hudCollapsed).toBe(false);
  });

  it('opens the camera bar wherever the count list is open, and folds it where it is not', () => {
    expect(at(PHONE_PORTRAIT.w, PHONE_PORTRAIT.h).cameraBarOpen).toBe(false);
    expect(at(DESKTOP.w, DESKTOP.h).cameraBarOpen).toBe(true);
  });

  it('grows hit targets for a finger on a big screen WITHOUT collapsing anything', () => {
    // The touch-laptop / touchscreen-desktop case the brief calls out: a coarse pointer is a fact
    // about the INPUT, and hiding a 29-row index on a 1920 px screen solves a problem it does not
    // have. Sizing follows the device; layout follows the viewport.
    const touchDesktop = at(DESKTOP.w, DESKTOP.h, true);
    expect(touchDesktop.touchTargets).toBe(true);
    expect(touchDesktop.compact).toBe(false);
    expect(touchDesktop.hudCollapsed).toBe(false);
    expect(touchDesktop.cameraBarOpen).toBe(true);
  });

  it('grows hit targets on a phone whether or not the pointer reports itself as coarse', () => {
    // A phone emulated in desktop devtools reports a fine pointer. The layout must not depend on
    // the device admitting it is a phone.
    expect(at(PHONE_PORTRAIT.w, PHONE_PORTRAIT.h, false).touchTargets).toBe(true);
    expect(at(PHONE_PORTRAIT.w, PHONE_PORTRAIT.h, true).touchTargets).toBe(true);
  });
});

describe('readViewport', () => {
  it('reads the three facts off a window-shaped object', () => {
    const v = readViewport({
      innerWidth: 375,
      innerHeight: 812,
      matchMedia: (q: string) => ({ matches: q === COARSE_POINTER_MEDIA }),
    });
    expect(v).toEqual({ width: 375, height: 812, coarsePointer: true });
  });

  it('survives an environment with no matchMedia — the pointer is simply not coarse', () => {
    const v = readViewport({ innerWidth: 1280, innerHeight: 800 });
    expect(v.coarsePointer).toBe(false);
    expect(resolveLayout(v).touchTargets).toBe(false);
  });

  it('degrades a missing view to the desktop layout rather than to a phone one', () => {
    const layout = resolveLayout(readViewport(null));
    expect(layout.compact).toBe(false);
    expect(layout.hudCollapsed).toBe(false);
  });
});
