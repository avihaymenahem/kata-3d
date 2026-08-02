/**
 * B8 UI — `src/ui/transport.ts` — the video-player transport strip.
 *
 * ═══ WHY A SEPARATE STRIP AND NOT ANOTHER ROW IN THE HUD PANEL ════════════════════════════════
 *
 * The HUD panel is already 29 counts plus a legend plus a clip selector, and it is capped at
 * `calc(100vh - 24px)`: on a laptop the list is the first thing that starts scrolling. A transport
 * has to be reachable WITHOUT scrolling — a scrub bar you have to hunt for is not a scrub bar — so
 * it gets the one piece of chrome every video player has trained people to look at, the bottom
 * centre of the frame. That also puts it clear of `#kata-hint` (bottom-LEFT, ~16 px tall) and of the
 * panel itself (top-right), so nothing overlaps at any viewport width.
 *
 * ═══ WHY IT POLLS ON rAF INSTEAD OF BEING PUSHED ═════════════════════════════════════════════
 *
 * The player has exactly one outbound event, `onBeatChange`, and a beat is ~1.3 s — three orders of
 * magnitude coarser than the position this bar draws. Adding a per-frame callback to `StageBoot`
 * would put a DOM write inside the render loop, which is the one place §6.6 budgets by the
 * microsecond. Polling three numbers off the boot handle on our own rAF costs nothing, cannot
 * stall the renderer, and repaints only when a value actually changed.
 *
 * ═══ THE COMPACT LAYOUT — WHAT A PHONE LOSES, AND WHY THAT ONE ═══════════════════════════════
 *
 * Seven controls across a 375 px screen at a hittable 44 px each would need 308 px of buttons before
 * the scrub bar got a single pixel, and the scrub bar is the control this strip exists for. Scaling
 * everything up uniformly does not solve that; it makes it worse. So the strip splits in two, and
 * the split is chosen by what a finger needs CONTINUOUSLY versus OCCASIONALLY:
 *
 *   ALWAYS      play/pause, the scrub, the position, and the fold toggle. These are the controls
 *               you use while watching, and they fit one 44 px row with ~175 px left for the rail.
 *   FOLDED      skip-to-start, the two single-frame steps, the frame ordinal, the total duration and
 *               the speed menu. Frame stepping is a REVIEW action — you have already stopped to look
 *               at something — and a review action can afford one extra tap. The speed menu is set
 *               once per session, not per count.
 *
 * The duration is dropped from the visible clock rather than abbreviated, because it is CONSTANT:
 * `26.88` never changes while you watch, so paying ~44 px of permanent rail for it on the narrowest
 * screen is the worst trade on the strip. It reappears in the folded row, where it costs nothing.
 *
 * The folded row opens ABOVE the always-visible one, which is why the strip is bottom-anchored and
 * wraps rather than being two nested rows: the play button and the scrub must not MOVE when the
 * fold opens, or every use of the toggle is followed by re-finding the control you were aiming at.
 *
 * ═══ POINTER RULES ═══════════════════════════════════════════════════════════════════════════
 *
 * `#hud-root` is `pointer-events: none` with `auto` on its children, so the strip is grabbable while
 * the rest of the overlay stays transparent to OrbitControls. Three things still have to be said
 * explicitly: `touch-action: none` on the scrub (otherwise a touch drag scrolls the page instead of
 * seeking, the same reason `#kata-canvas` sets it), `touch-action: manipulation` on every button
 * (which keeps the tap but drops the 300 ms double-tap-to-zoom wait — on a transport that delay
 * reads as dropped presses), and `stopPropagation` on pointer and key events (`src/player/app.ts`
 * binds `keydown` on WINDOW, so an arrow key pressed while a transport button has focus would ALSO
 * jump a whole count, and a space would toggle play twice).
 */

/* `RATE_PRESETS` rather than a set invented here: §6.7 froze the speed ladder in B0 and
 * `src/contracts` is three-free, so importing it keeps this block's "nothing here touches three"
 * promise intact while making the menu the same ladder the rest of the system means by "rate". */
import { RATE_PRESETS } from '../contracts';

import { COMPACT_MEDIA, TOUCH_MEDIA, TOUCH_TARGET_PX } from './layout';

export interface HudTransportHost {
  /**
   * Seconds one step covers. Supplied by the player rather than recomputed here so the buttons can
   * name the real quantum in their tooltips instead of a guess.
   */
  readonly frameSeconds: number;
  /** Length of whatever is currently playing — the auditioned clip, or the whole kata score. */
  readonly durationSeconds: number;
  readonly currentSeconds: number;
  readonly playing: boolean;
  readonly rate: number;
  /** `undefined` toggles. */
  setPlaying(play?: boolean): void;
  /** Absolute seek. PAUSES, deliberately — see the note on the scrub handler below. */
  seekSeconds(t: number): void;
  stepDisplayFrames(n: number): void;
  setRate(r: number): void;
}

export interface HudTransport {
  /** Re-read the host and repaint now. The strip also polls, so this is only for instant feedback. */
  refresh(): void;
  dispose(): void;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Pure read-out helpers — exported so they are testable in the Node-only vitest environment
 * (`vitest.config.ts` pins `environment: 'node'`, so nothing that touches the DOM can be covered).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * One clock number: `12.40`.
 *
 * Two decimals because one frame is 16.7 ms: at one decimal a frame step would move the readout on
 * some presses and not others, which reads as a dropped click. This is also the ONLY thing the
 * compact strip prints — see the header on why the duration is dropped rather than shortened — so
 * the clamping that keeps a negative or NaN clock off the screen has to live down here, in the piece
 * both layouts share, rather than in the full string.
 */
export function formatClockSeconds(seconds: number): string {
  return (Number.isFinite(seconds) ? Math.max(seconds, 0) : 0).toFixed(2);
}

/** `12.40 / 26.90 s`. The wide layout's readout; composed from the piece above, never re-derived. */
export function formatTransportClock(currentS: number, durationS: number): string {
  return `${formatClockSeconds(currentS)} / ${formatClockSeconds(durationS)} s`;
}

/**
 * The frame ORDINAL, shown beside the clock.
 *
 * This is the readout that makes frame stepping verifiable by eye: seconds at two decimals cannot
 * distinguish "advanced one frame" from "advanced one and a bit", but an integer that goes 744 ->
 * 745 -> 746 on three presses can. Rounded, not floored, so float drift in the accumulated clock
 * never shows up as a step that appears to do nothing.
 */
export function frameIndexOf(currentS: number, frameSeconds: number): number {
  if (!(frameSeconds > 0) || !Number.isFinite(currentS)) return 0;
  return Math.max(0, Math.round(currentS / frameSeconds));
}

/** Clamped `current / duration`. A zero-length source parks the knob at the left, not at NaN. */
export function positionFraction(currentS: number, durationS: number): number {
  if (!(durationS > 0) || !Number.isFinite(currentS)) return 0;
  return Math.min(1, Math.max(0, currentS / durationS));
}

/** Where along a scrub of width `width`, starting at `left`, the pointer landed. Clamped to [0,1]. */
export function pointerFraction(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width));
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The strip
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ═══ THE READOUT'S `min-width` IS LOAD-BEARING, NOT COSMETIC ═════════════════════════════════
 *
 * `.kata-tp__scrub` is the one flexible child of the row, so every pixel the readout gains it takes
 * from the rail. Left to size itself the clock is a few pixels wider at "26.86 / 26.88 s f1612"
 * than at "1.05 / 26.88 s f63" — and DRAGGING is what changes those digits, so the rail was
 * shrinking under the pointer while it was being dragged. Measured before the fix: a drag released
 * at 95 % of the rail landed at 100 % of the clip, with the error growing the further right you
 * went. `font-variant-numeric: tabular-nums` fixes the width of a digit, not of a string that gains
 * digits; only reserving the width does that.
 *
 * The reserved widths cover the widest strings either view produces: `999.99 / 999.99 s` and
 * `f9999` (the score view is ~40 s, i.e. ~2 400 frames). The compact layout reserves 48 px for the
 * same reason at its own width, for `999.99`.
 *
 * ═══ WHY `order` AND A WRAP, NOT TWO NESTED ROWS ═════════════════════════════════════════════
 *
 * The strip is ONE flex container that wraps, with an explicit zero-height break element, and the
 * compact layout re-sequences its children with `order`. Nesting two row divs instead would need the
 * wide layout to flatten them again (`display: contents` on a flex child is still patchy across
 * engines), and would put the always-visible row in the DOM AFTER the folded one — so keyboard tab
 * order would walk the frame-step buttons before the play button on every viewport. One container
 * keeps the DOM in reading order for the wide case, which is the case a screen reader and a tab key
 * see, and moves pixels only where the pixels are short.
 */
const CSS = `
.kata-tp{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);
  display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:7px 10px;border-radius:10px;
  width:min(620px,calc(100vw - 300px));box-sizing:border-box;
  background:rgba(11,12,14,.82);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.09);box-shadow:0 8px 28px rgba(0,0,0,.5);
  font:12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--kata-fg,#cbd2d9);
  user-select:none;-webkit-user-select:none}
.kata-tp__btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:inherit;border-radius:6px;padding:0 8px;height:24px;min-width:26px;font:inherit;font-size:11px;
  line-height:1;cursor:pointer;flex:0 0 auto;font-variant-numeric:tabular-nums;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.kata-tp__btn:hover{background:rgba(255,255,255,.13)}
.kata-tp__btn:active{background:rgba(125,211,160,.22)}
.kata-tp__btn--play{min-width:32px;font-size:12px;color:var(--kata-accent,#7dd3a0)}
.kata-tp__scrub{position:relative;flex:1 1 auto;min-width:70px;height:20px;display:flex;
  align-items:center;cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent}
.kata-tp__track{position:relative;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.15)}
.kata-tp__fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--kata-accent,#7dd3a0)}
.kata-tp__knob{position:absolute;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;
  background:#eef2f5;box-shadow:0 1px 3px rgba(0,0,0,.65);pointer-events:none}
.kata-tp__scrub[data-drag="1"] .kata-tp__knob{transform:scale(1.25)}
.kata-tp__clock{flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:11px;white-space:nowrap;
  color:var(--kata-dim,#7c8894)}
.kata-tp__clock b{display:inline-block;min-width:100px;text-align:right;
  color:var(--kata-fg,#cbd2d9);font-weight:600}
.kata-tp__frame{display:inline-block;min-width:42px;text-align:right;margin-left:6px;color:#e0b354;
  font-variant-numeric:tabular-nums;font-size:11px;flex:0 0 auto}
.kata-tp__rate{appearance:none;background:rgba(255,255,255,.05);color:inherit;flex:0 0 auto;
  border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:2px 4px;height:24px;
  font:inherit;font-size:11px;cursor:pointer;touch-action:manipulation}
.kata-tp__rate option{background:#14161a;color:#cbd2d9}
/* Wide layout: the fold does not exist, so neither does its toggle, its break, or the separate
   duration read-out the compact clock hands off to. */
.kata-tp__break{display:none;flex-basis:100%;height:0;margin:0}
.kata-tp__more{display:none}
.kata-tp__dur{display:none;font-variant-numeric:tabular-nums;font-size:11px;flex:0 0 auto;
  color:var(--kata-dim,#7c8894);white-space:nowrap}

/* ═══ COMPACT ════════════════════════════════════════════════════════════════════════════════
   Edge to edge, because every pixel not spent on the frame of the strip is a pixel of scrub rail,
   and full-bleed bottom chrome is what every video player on a phone already does.
   'env(safe-area-inset-bottom)' keeps it off the iOS home indicator, which sits over the bottom
   ~34 px in portrait and would otherwise swallow the play button. */
@media ${COMPACT_MEDIA}{
  .kata-tp{left:8px;right:8px;width:auto;transform:none;gap:6px;row-gap:6px;padding:6px 8px;
    bottom:calc(8px + env(safe-area-inset-bottom))}
  .kata-tp__more{display:inline-flex;align-items:center;justify-content:center}
  .kata-tp__dur{display:inline-block}
  .kata-tp__break{display:block}
  /* The fold, above; the always-visible row, below and therefore anchored to the screen edge. */
  .kata-tp__home{order:1}
  .kata-tp__back{order:2}
  .kata-tp__fwd{order:3}
  .kata-tp__frame{order:4;margin-left:0;text-align:left}
  .kata-tp__dur{order:5;margin-left:auto}
  .kata-tp__rate{order:6}
  .kata-tp__break{order:7}
  .kata-tp__play{order:8}
  .kata-tp__scrub{order:9}
  .kata-tp__clock{order:10}
  .kata-tp__more{order:11}
  /* '999.99' and no more — the duration moved to the fold. */
  .kata-tp__clock b{min-width:48px}
  .kata-tp[data-extras="0"] .kata-tp__home,
  .kata-tp[data-extras="0"] .kata-tp__back,
  .kata-tp[data-extras="0"] .kata-tp__fwd,
  .kata-tp[data-extras="0"] .kata-tp__frame,
  .kata-tp[data-extras="0"] .kata-tp__dur,
  .kata-tp[data-extras="0"] .kata-tp__rate,
  .kata-tp[data-extras="0"] .kata-tp__break{display:none}
  .kata-tp__more[data-on="1"]{background:rgba(125,211,160,.22);border-color:rgba(125,211,160,.55);
    color:var(--kata-accent,#7dd3a0)}
  /* Opening the fold takes the strip from 58 px to 114 px, straight up through where index.html
     parks '#kata-hint' on a compact viewport (a full-width line 88 px off the bottom edge). Measured
     with the fold open: the hint's text ran through the middle of the frame-step buttons.
     ':has()' lets the widget that TOOK the space be the one that says so, instead of index.html
     having to know this strip has two heights — and the trade is the right way round, because the
     hint carries the current count's NAME and the fold is opened to step frames, which is the one
     task where the count you are on is the least interesting thing on screen. */
  body:has(.kata-tp[data-extras="1"]) #kata-hint{display:none}
}

/* ═══ TOUCH SIZING — compact, OR a coarse pointer at any width ═══════════════════════════════
   The scrub grows to a full ${TOUCH_TARGET_PX} px HIT box while its RAIL stays 6 px: a thumb needs
   the target, the eye needs the thin line, and they are not the same rectangle. The knob doubles
   because it is what a finger aims at, and at 11 px it is smaller than the fingertip covering it. */
@media ${TOUCH_MEDIA}{
  .kata-tp__btn{height:${TOUCH_TARGET_PX}px;min-width:${TOUCH_TARGET_PX}px;font-size:12px;border-radius:8px}
  .kata-tp__btn--play{min-width:52px;font-size:16px}
  .kata-tp__scrub{height:${TOUCH_TARGET_PX}px;min-width:90px}
  .kata-tp__track{height:6px;border-radius:3px}
  .kata-tp__knob{width:18px;height:18px;margin:-9px 0 0 -9px}
  .kata-tp__rate{height:${TOUCH_TARGET_PX}px;font-size:12px;padding:0 6px;border-radius:8px}
  .kata-tp__clock{font-size:12px}
  .kata-tp__frame,.kata-tp__dur{font-size:12px}
}
`;

export function createTransport(host: HudTransportHost, mount: HTMLElement): HudTransport {
  const doc = mount.ownerDocument;
  const view = doc.defaultView;

  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'kata-tp';

  const button = (label: string, title: string, cls: string): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `kata-tp__btn ${cls}`;
    b.textContent = label;
    b.title = title;
    return b;
  };

  /* One frame in milliseconds, quoted in every tooltip: the whole point of the two step buttons is
   * that they move by a KNOWN quantum, and a button that just says "step" leaves the reviewer
   * guessing whether they moved 1 ms or 1 count. */
  const frameMs = (host.frameSeconds * 1000).toFixed(1);

  const homeBtn = button('⏮', 'back to the start', 'kata-tp__home');
  const backBtn = button('−1f', `step back one frame (${frameMs} ms) — also the , key`, 'kata-tp__back');
  const playBtn = button('▶', 'play / pause — also the space bar', 'kata-tp__play kata-tp__btn--play');
  const fwdBtn = button('+1f', `step forward one frame (${frameMs} ms) — also the . key`, 'kata-tp__fwd');

  const scrub = doc.createElement('div');
  scrub.className = 'kata-tp__scrub';
  scrub.title = 'drag to scrub — scrubbing holds the frame it lands on, like clicking a count';
  const track = doc.createElement('div');
  track.className = 'kata-tp__track';
  const fill = doc.createElement('div');
  fill.className = 'kata-tp__fill';
  const knob = doc.createElement('div');
  knob.className = 'kata-tp__knob';
  track.append(fill, knob);
  scrub.append(track);

  const clock = doc.createElement('span');
  clock.className = 'kata-tp__clock';
  const clockText = doc.createElement('b');
  clock.append(clockText);

  const frameText = doc.createElement('span');
  frameText.className = 'kata-tp__frame';
  frameText.title = 'frame ordinal — this is the number that must change by exactly 1 per step';

  /* Compact only: where the duration goes when the clock stops printing it. A separate element
   * rather than a longer clock string, so the always-visible readout keeps its reserved width and
   * the rail underneath it cannot move while a drag is in flight. */
  const durText = doc.createElement('span');
  durText.className = 'kata-tp__dur';
  durText.title = 'total length of what is playing';

  const rate = doc.createElement('select');
  rate.className = 'kata-tp__rate';
  rate.title = 'playback speed — slow motion is how a technique becomes readable';
  for (const r of RATE_PRESETS) {
    const opt = doc.createElement('option');
    opt.value = String(r);
    opt.textContent = `${r}×`;
    rate.append(opt);
  }

  const brk = doc.createElement('div');
  brk.className = 'kata-tp__break';

  const moreBtn = button('⋯', 'frame steps, speed and totals', 'kata-tp__more');

  root.append(homeBtn, backBtn, playBtn, fwdBtn, scrub, clock, frameText, durText, rate, brk, moreBtn);
  mount.append(style, root);

  /* ── layout mode ──────────────────────────────────────────────────────────────────────────── */

  /**
   * `matchMedia` on the SAME string the stylesheet above is compiled from, so the JavaScript that
   * decides what the clock PRINTS and the CSS that decides where it SITS cannot disagree. Listened
   * to rather than read once: rotating a phone from portrait to landscape can cross the boundary in
   * either direction, and a clock still printing the wide string in a 48 px box is a clipped number.
   */
  const mq = view?.matchMedia?.(COMPACT_MEDIA) ?? null;
  let compact = mq?.matches ?? false;
  let extrasOpen = false;

  function applyExtras(): void {
    root.dataset['extras'] = extrasOpen ? '1' : '0';
    moreBtn.dataset['on'] = extrasOpen ? '1' : '0';
    moreBtn.setAttribute('aria-expanded', extrasOpen ? 'true' : 'false');
  }
  applyExtras();

  /* ── paint ────────────────────────────────────────────────────────────────────────────────── */

  let lastClock = '';
  let lastFrame = -1;
  let lastDur = Number.NaN;
  let lastFrac = -1;
  let lastPlaying: boolean | null = null;
  let lastRate = Number.NaN;

  function paint(): void {
    const cur = host.currentSeconds;
    const dur = host.durationSeconds;

    const text = compact ? formatClockSeconds(cur) : formatTransportClock(cur, dur);
    if (text !== lastClock) {
      lastClock = text;
      clockText.textContent = text;
    }
    if (dur !== lastDur) {
      lastDur = dur;
      durText.textContent = `${formatClockSeconds(dur)} s total`;
    }
    const f = frameIndexOf(cur, host.frameSeconds);
    if (f !== lastFrame) {
      lastFrame = f;
      frameText.textContent = `f${f}`;
    }
    const frac = positionFraction(cur, dur);
    /* Quantised to the pixel the bar can actually show. Writing `style.width` every frame with a
     * value that rounds to the same pixel is pure layout churn for no visible change. */
    const q = Math.round(frac * 1000) / 1000;
    if (q !== lastFrac) {
      lastFrac = q;
      const pct = `${(q * 100).toFixed(2)}%`;
      fill.style.width = pct;
      knob.style.left = pct;
    }
    if (host.playing !== lastPlaying) {
      lastPlaying = host.playing;
      playBtn.textContent = lastPlaying ? '⏸' : '▶';
    }
    if (host.rate !== lastRate) {
      lastRate = host.rate;
      const want = String(lastRate);
      if (rate.value !== want) rate.value = want;
    }
  }
  paint();

  const onMediaChange = (e: MediaQueryListEvent): void => {
    compact = e.matches;
    /* The clock's STRING changes shape, not just its position, so the memo has to be invalidated —
     * otherwise a rotation into portrait keeps printing `12.40 / 26.88 s` into a 48 px box until
     * the next frame that happens to change the number. */
    lastClock = '';
    paint();
  };
  mq?.addEventListener('change', onMediaChange);

  /* ── the poll ─────────────────────────────────────────────────────────────────────────────── */

  let raf = 0;
  const loop = (): void => {
    paint();
    raf = view?.requestAnimationFrame(loop) ?? 0;
  };
  raf = view?.requestAnimationFrame(loop) ?? 0;

  /* ── input ────────────────────────────────────────────────────────────────────────────────── */

  homeBtn.addEventListener('click', () => {
    host.seekSeconds(0);
    paint();
  });
  backBtn.addEventListener('click', () => {
    host.stepDisplayFrames(-1);
    paint();
  });
  fwdBtn.addEventListener('click', () => {
    host.stepDisplayFrames(1);
    paint();
  });
  playBtn.addEventListener('click', () => {
    host.setPlaying();
    paint();
  });
  moreBtn.addEventListener('click', () => {
    extrasOpen = !extrasOpen;
    applyExtras();
  });
  rate.addEventListener('change', () => {
    const r = Number(rate.value);
    if (Number.isFinite(r)) host.setRate(r);
    paint();
  });

  /**
   * ═══ THE SCRUB ═══════════════════════════════════════════════════════════════════════════════
   *
   * `setPointerCapture` rather than window-level move/up listeners: the pointer leaving the strip
   * mid-drag is the NORMAL case, not the edge case, and capture is the only way the element keeps
   * receiving moves without the strip installing global handlers it then has to remember to remove.
   * On touch this is not a nicety — a finger tracking a rail near the bottom edge of a phone drifts
   * off it constantly, and without capture the seek would simply stop mid-gesture.
   *
   * `stopPropagation` on down/move because `src/player/app.ts` treats a pointerdown as camera
   * interaction, and `preventDefault` because a drag that starts on a fixed overlay otherwise begins
   * a text selection that follows the cursor across the canvas. Neither is what keeps the camera
   * still under a finger, though — that is `touch-action: none` on `.kata-tp__scrub` plus the fact
   * that OrbitControls is bound to `#kata-canvas` and never sees an event whose target is this
   * overlay. Without the `touch-action`, the browser would claim the gesture as a page scroll before
   * a single `pointermove` was dispatched, and the rail would be dead to a finger while working
   * perfectly with a mouse — which is exactly why a mouse-only check proves nothing here.
   *
   * Seeking PAUSES, on purpose, for the same reason `goToBeat` does: a scrub means "show me this
   * frame". Leaving playback on makes the frame you released on the wrong one by the time you
   * have looked at it, and silently resurrects a paused kata.
   */
  const seekTo = (clientX: number): void => {
    const r = scrub.getBoundingClientRect();
    host.seekSeconds(pointerFraction(clientX, r.left, r.width) * host.durationSeconds);
    paint();
  };

  const onDown = (e: PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    /* Capture THROWS for a pointer id the browser does not hold as active — a synthetic event from a
     * test driver, or a pointer released between dispatch and this handler. Uncaught, that aborts
     * the handler before the seek, so the click does nothing at all. Losing capture costs only the
     * drag-outside-the-strip case; losing the seek costs the control. */
    try {
      scrub.setPointerCapture(e.pointerId);
    } catch {
      /* dragging still works while the pointer stays over the strip */
    }
    scrub.dataset['drag'] = '1';
    seekTo(e.clientX);
  };
  const onMove = (e: PointerEvent): void => {
    if (scrub.dataset['drag'] !== '1') return;
    e.stopPropagation();
    seekTo(e.clientX);
  };
  const onUp = (e: PointerEvent): void => {
    if (scrub.dataset['drag'] !== '1') return;
    delete scrub.dataset['drag'];
    if (scrub.hasPointerCapture(e.pointerId)) scrub.releasePointerCapture(e.pointerId);
  };
  scrub.addEventListener('pointerdown', onDown);
  scrub.addEventListener('pointermove', onMove);
  scrub.addEventListener('pointerup', onUp);
  scrub.addEventListener('pointercancel', onUp);

  /* The player's key handler is on WINDOW. Without this, space with the play button focused toggles
   * playback twice (button activation + the window handler) and an arrow key jumps a whole count
   * while the user thinks they are tabbing through the strip. */
  const onKeyDown = (e: KeyboardEvent): void => e.stopPropagation();
  root.addEventListener('keydown', onKeyDown);
  /* Wheel over the strip must not zoom the camera behind it. */
  const onWheel = (e: WheelEvent): void => e.stopPropagation();
  root.addEventListener('wheel', onWheel, { passive: true });

  return {
    refresh: paint,
    dispose(): void {
      if (raf !== 0) view?.cancelAnimationFrame(raf);
      raf = 0;
      mq?.removeEventListener('change', onMediaChange);
      root.remove();
      style.remove();
    },
  };
}
