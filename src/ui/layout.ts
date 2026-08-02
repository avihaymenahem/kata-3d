/**
 * B8 UI — `src/ui/layout.ts` — the one place that decides "is this a phone".
 *
 * ═══ WHY A MODULE AND NOT A MEDIA QUERY IN EACH WIDGET ═══════════════════════════════════════
 *
 * Two consumers need the same answer and they cannot both be CSS. The HUD has to decide whether to
 * BOOT COLLAPSED — a JavaScript decision, taken once, before a stylesheet has anything to say — and
 * the transport has to decide whether the frame ordinal and the speed menu are folded away, which
 * changes what the clock element PRINTS, not just how it looks. If each widget spelled its own
 * `matchMedia('(max-width: 900px)')` next to its own `@media (max-width: 900px)`, the two would
 * drift the first time one of the four numbers was tuned, and the failure mode is silent: a panel
 * that boots collapsed while its stylesheet still thinks it is on a desktop.
 *
 * So the breakpoints are authored ONCE, as numbers, and the media-query strings are BUILT from them
 * (`COMPACT_MEDIA`, `TOUCH_MEDIA`) for the widgets to interpolate into their CSS. There is exactly
 * one definition of narrow in this block.
 *
 * ═══ WHY WIDTH *AND* HEIGHT, AND WHY NOT `pointer: coarse` ═══════════════════════════════════
 *
 * `pointer: coarse` is the tempting signal and it is the wrong one for LAYOUT. A 15" touch laptop
 * reports a coarse primary pointer and has 1920 px to spend; a phone in landscape has 932 px and is
 * not a laptop. What actually drives the layout is how much of the dojo the chrome eats, and that is
 * a question about the VIEWPORT.
 *
 *   WIDTH  — the HUD is a 232 px panel with 12 px margins, so it costs 256 px whatever the screen.
 *            At 900 px that is 28 % of the frame; below it the panel is taking more than a quarter
 *            of a scene that is 3.4 m x 2.0 m of embusen and orbits a full circle. 900 sits above
 *            every phone in landscape (932 is the widest, and height catches it — see below) and
 *            below every laptop (1280 / 1366 / 1440), so no real desktop is demoted by it.
 *
 *   HEIGHT — width alone gets phone LANDSCAPE wrong, and getting it wrong is not subtle. An
 *            iPhone 16 Pro Max on its side is 932 x 430: wider than the 900 px cut, so a
 *            width-only rule would call it a desktop and open a `100vh`-tall list down the entire
 *            right-hand side of a 430 px screen. The panel is TALL, so its cost has to be measured
 *            against the short axis too. 560 px separates every phone in landscape (320–430) from
 *            every tablet in landscape (744+) with a wide margin on both sides.
 *
 * `pointer: coarse` is still used, for the one thing it genuinely reports: whether the thing doing
 * the pointing is a finger. That drives HIT-TARGET SIZE and nothing else — see `TOUCH_MEDIA`.
 */

/**
 * At or below this width the layout is compact. Inclusive, because CSS `max-width: 900px` matches
 * AT 900 px and a boot-time decision that disagreed with the stylesheet by one pixel would be a
 * genuinely horrible bug to find.
 */
export const COMPACT_MAX_WIDTH_PX = 900;

/** At or below this height the layout is compact. Same inclusive reading as the width. */
export const COMPACT_MAX_HEIGHT_PX = 560;

/**
 * Minimum comfortable finger target, px. Apple's HIG says 44 pt, Google's Material says 48 dp, and
 * WCAG 2.2 AA only asks for 24 — 44 is the value the two platform guidelines agree is comfortable
 * rather than merely legal, and it is what the existing 24 px buttons are measured against.
 */
export const TOUCH_TARGET_PX = 44;

/** `(pointer: coarse)` — the primary pointer is a finger, not a mouse. Sizing only, never layout. */
export const COARSE_POINTER_MEDIA = '(pointer: coarse)';

/**
 * The compact LAYOUT query. A comma in a media query list is OR, so this reads "narrow OR short".
 * Interpolate it into a widget's stylesheet as `@media ${COMPACT_MEDIA} { … }`.
 */
export const COMPACT_MEDIA =
  `(max-width: ${COMPACT_MAX_WIDTH_PX}px), (max-height: ${COMPACT_MAX_HEIGHT_PX}px)` as const;

/**
 * The touch-SIZING query: compact, or a coarse primary pointer at any size.
 *
 * Deliberately wider than `COMPACT_MEDIA`. A 1920 px touchscreen is not a phone — it must not lose
 * the count list to an auto-collapse — but it is still driven by a finger, and a 24 px button is
 * just as unhittable there as it is on a 375 px handset. Sizing follows the input device; layout
 * follows the viewport.
 */
export const TOUCH_MEDIA = `${COMPACT_MEDIA}, ${COARSE_POINTER_MEDIA}` as const;

/** What `resolveLayout` is given. Structural so a test can pass three numbers instead of a `Window`. */
export interface ViewportSource {
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** Optional so the type is satisfiable in the Node-only vitest environment. */
  matchMedia?(query: string): { readonly matches: boolean };
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** `(pointer: coarse)`. False when the environment cannot answer, which is the safe default. */
  readonly coarsePointer: boolean;
}

export interface UiLayout {
  /** Narrow or short: fold the transport's extras, cap the HUD's height, shrink its margins. */
  readonly compact: boolean;
  /** Inflate every hit target to `TOUCH_TARGET_PX`. Compact, or a finger at any size. */
  readonly touchTargets: boolean;
  /** What the HUD's `collapsed` should be on the frame it is built. */
  readonly hudCollapsed: boolean;
  /** What the camera bar's `open` should be on the frame it is built. */
  readonly cameraBarOpen: boolean;
}

/**
 * The whole breakpoint decision, in one expression. `<=` mirrors CSS `max-*`, which is inclusive.
 *
 * Guards against a non-finite or zero dimension because `innerWidth` is 0 in a detached document and
 * `NaN` from a hand-built stub, and "0 x 0 is very narrow indeed" would boot every such caller into
 * a phone layout. An unmeasurable viewport is treated as roomy: the desktop layout degrades to a
 * panel that is merely large, the phone layout degrades to controls nobody can find.
 */
export function isCompactViewport(width: number, height: number): boolean {
  const w = Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;
  const h = Number.isFinite(height) && height > 0 ? height : Number.POSITIVE_INFINITY;
  return w <= COMPACT_MAX_WIDTH_PX || h <= COMPACT_MAX_HEIGHT_PX;
}

/** Reads a `Window` (or a stub) into the three facts the layout depends on. */
export function readViewport(view: ViewportSource | null | undefined): Viewport {
  if (view == null) return { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY, coarsePointer: false };
  return {
    width: view.innerWidth,
    height: view.innerHeight,
    coarsePointer: view.matchMedia?.(COARSE_POINTER_MEDIA).matches ?? false,
  };
}

/**
 * Viewport -> every layout decision the widgets take at construction time.
 *
 * Note what `coarsePointer` does NOT do: it never collapses anything. A touchscreen desktop keeps
 * the count list open and merely gets bigger buttons, because hiding a 29-row index behind a tap on
 * a 1920 px screen would be solving a problem that screen does not have.
 */
export function resolveLayout(v: Viewport): UiLayout {
  const compact = isCompactViewport(v.width, v.height);
  return {
    compact,
    touchTargets: compact || v.coarsePointer,
    /* THE side-menu rule: hidden by default on a phone, open by default on a desktop. */
    hudCollapsed: compact,
    /* Same rule, same reason. Twelve camera chips are worth their space on a laptop and are a
     * popover on a handset. */
    cameraBarOpen: !compact,
  };
}
