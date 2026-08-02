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
 * ═══ POINTER RULES ═══════════════════════════════════════════════════════════════════════════
 *
 * `#hud-root` is `pointer-events: none` with `auto` on its children, so the strip is grabbable while
 * the rest of the overlay stays transparent to OrbitControls. Two things still have to be said
 * explicitly: `touch-action: none` on the scrub (otherwise a touch drag scrolls the page instead of
 * seeking, the same reason `#kata-canvas` sets it), and `stopPropagation` on pointer and key events
 * (`src/player/app.ts` binds `keydown` on WINDOW, so an arrow key pressed while a transport button
 * has focus would ALSO jump a whole count, and a space would toggle play twice).
 */

/* `RATE_PRESETS` rather than a set invented here: §6.7 froze the speed ladder in B0 and
 * `src/contracts` is three-free, so importing it keeps this block's "nothing here touches three"
 * promise intact while making the menu the same ladder the rest of the system means by "rate". */
import { RATE_PRESETS } from '../contracts';

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
 * `12.40 / 26.90 s`. Two decimals because one frame is 16.7 ms: at one decimal a frame step would
 * move the readout on some presses and not others, which reads as a dropped click.
 */
export function formatTransportClock(currentS: number, durationS: number): string {
  const fix = (v: number): string => (Number.isFinite(v) ? Math.max(v, 0) : 0).toFixed(2);
  return `${fix(currentS)} / ${fix(durationS)} s`;
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
 * `f9999` (the score view is ~40 s, i.e. ~2 400 frames).
 */
const CSS = `
.kata-tp{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);
  display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:10px;
  width:min(620px,calc(100vw - 300px));box-sizing:border-box;
  background:rgba(11,12,14,.82);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.09);box-shadow:0 8px 28px rgba(0,0,0,.5);
  font:12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--kata-fg,#cbd2d9)}
.kata-tp__btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:inherit;border-radius:6px;padding:0 8px;height:24px;min-width:26px;font:inherit;font-size:11px;
  line-height:1;cursor:pointer;flex:0 0 auto;font-variant-numeric:tabular-nums}
.kata-tp__btn:hover{background:rgba(255,255,255,.13)}
.kata-tp__btn:active{background:rgba(125,211,160,.22)}
.kata-tp__btn--play{min-width:32px;font-size:12px;color:var(--kata-accent,#7dd3a0)}
.kata-tp__scrub{position:relative;flex:1 1 auto;min-width:70px;height:20px;display:flex;
  align-items:center;cursor:pointer;touch-action:none}
.kata-tp__track{position:relative;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.15)}
.kata-tp__fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--kata-accent,#7dd3a0)}
.kata-tp__knob{position:absolute;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;
  background:#eef2f5;box-shadow:0 1px 3px rgba(0,0,0,.65);pointer-events:none}
.kata-tp__scrub[data-drag="1"] .kata-tp__knob{transform:scale(1.25)}
.kata-tp__clock{flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:11px;white-space:nowrap;
  color:var(--kata-dim,#7c8894)}
.kata-tp__clock b{display:inline-block;min-width:100px;text-align:right;
  color:var(--kata-fg,#cbd2d9);font-weight:600}
.kata-tp__frame{display:inline-block;min-width:42px;text-align:right;margin-left:6px;color:#e0b354}
.kata-tp__rate{appearance:none;background:rgba(255,255,255,.05);color:inherit;flex:0 0 auto;
  border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:2px 4px;height:24px;
  font:inherit;font-size:11px;cursor:pointer}
.kata-tp__rate option{background:#14161a;color:#cbd2d9}
`;

export function createTransport(host: HudTransportHost, mount: HTMLElement): HudTransport {
  const doc = mount.ownerDocument;
  const view = doc.defaultView;

  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'kata-tp';

  const button = (label: string, title: string, cls = ''): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `kata-tp__btn${cls}`;
    b.textContent = label;
    b.title = title;
    return b;
  };

  /* One frame in milliseconds, quoted in every tooltip: the whole point of the two step buttons is
   * that they move by a KNOWN quantum, and a button that just says "step" leaves the reviewer
   * guessing whether they moved 1 ms or 1 count. */
  const frameMs = (host.frameSeconds * 1000).toFixed(1);

  const homeBtn = button('⏮', 'back to the start');
  const backBtn = button('−1f', `step back one frame (${frameMs} ms) — also the , key`);
  const playBtn = button('▶', 'play / pause — also the space bar', ' kata-tp__btn--play');
  const fwdBtn = button('+1f', `step forward one frame (${frameMs} ms) — also the . key`);

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
  const frameText = doc.createElement('span');
  frameText.className = 'kata-tp__frame';
  frameText.title = 'frame ordinal — this is the number that must change by exactly 1 per step';
  clock.append(clockText, frameText);

  const rate = doc.createElement('select');
  rate.className = 'kata-tp__rate';
  rate.title = 'playback speed — slow motion is how a technique becomes readable';
  for (const r of RATE_PRESETS) {
    const opt = doc.createElement('option');
    opt.value = String(r);
    opt.textContent = `${r}×`;
    rate.append(opt);
  }

  root.append(homeBtn, backBtn, playBtn, fwdBtn, scrub, clock, rate);
  mount.append(style, root);

  /* ── paint ────────────────────────────────────────────────────────────────────────────────── */

  let lastClock = '';
  let lastFrame = -1;
  let lastFrac = -1;
  let lastPlaying: boolean | null = null;
  let lastRate = Number.NaN;

  function paint(): void {
    const cur = host.currentSeconds;
    const dur = host.durationSeconds;

    const text = formatTransportClock(cur, dur);
    if (text !== lastClock) {
      lastClock = text;
      clockText.textContent = text;
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
  rate.addEventListener('change', () => {
    const r = Number(rate.value);
    if (Number.isFinite(r)) host.setRate(r);
    paint();
  });

  /**
   * ═══ THE SCRUB ═══════════════════════════════════════════════════════════════════════════════
   *
   * `setPointerCapture` rather than window-level move/up listeners: the pointer leaving the 20 px
   * strip mid-drag is the NORMAL case, not the edge case, and capture is the only way the element
   * keeps receiving moves without the strip installing global handlers it then has to remember to
   * remove. `stopPropagation` on down/move because `src/player/app.ts` treats a pointerdown as
   * camera interaction, and `preventDefault` because a drag that starts on a fixed overlay
   * otherwise begins a text selection that follows the cursor across the canvas.
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
      root.remove();
      style.remove();
    },
  };
}
