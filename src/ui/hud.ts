/**
 * B8 UI — `src/ui/hud.ts` — the move-selection HUD.
 *
 * ═══ WHY A LIST AND NOT ARROW KEYS ═══════════════════════════════════════════════════════════
 *
 * Stepping a kata with `←` / `→` makes you count in your head to find move 14, and gives no way to
 * see where you are or what is coming. A kata IS a numbered list — doc 02 authors it as one — so the
 * control should be that list: every count visible, named, and one click away, with the current one
 * marked. The arrow keys still work; they are no longer the only way in.
 *
 * Mounts into `#hud-root`, which `index.html` reserves for exactly this and which already sets
 * `pointer-events: none` on the root and `auto` on its children — so the panel is clickable while
 * the rest of the overlay stays transparent to OrbitControls. Styles are inline here rather than in
 * `theme.css` because this is a self-contained widget and splitting six rules across two files
 * makes it harder to delete, not easier.
 *
 * ═══ THE SECOND HALF OF THE HUD ══════════════════════════════════════════════════════════════
 *
 * A count list answers "which move", never "which frame". The video-style transport that answers
 * the second question is `./transport.ts`, and it mounts as a SIBLING at the bottom of the frame
 * rather than as more rows in this panel — the panel is already 29 counts plus a legend plus a clip
 * selector against a `100vh` cap, and a scrub bar that scrolls out of view is not a scrub bar.
 * It is still built and disposed from here, so the HUD stays one object with one lifetime.
 */

import { createTransport, type HudTransportHost } from './transport';

export interface HudBeat {
  readonly kind: 'ceremony' | 'move';
  readonly n: number;
  readonly label: string;
  readonly kiai: boolean;
  /**
   * How real this count's technique is. Shown as a badge so a count driven by real Shotokan capture
   * is distinguishable at a glance from one wearing a borrowed clip — which is the difference
   * between "this is finished" and "this is a placeholder that looks finished".
   */
  readonly source: 'mocap' | 'approx' | 'standin' | null;
}

/** Badge text and tooltip per provenance. Terse on screen, explicit on hover. */
const SOURCE_BADGE: Record<'mocap' | 'approx' | 'standin', { mark: string; title: string }> = {
  mocap: { mark: '✓', title: 'real Shotokan motion capture' },
  approx: { mark: '~', title: 'real human motion, wrong art — a boxing punch standing in' },
  standin: { mark: '·', title: 'placeholder — the library has no clip for this technique' },
};

export interface HudHost {
  readonly beats: readonly HudBeat[];
  readonly clips: readonly string[];
  goToBeat(index: number): void;
  setPlaying(play?: boolean): void;
  readonly playing: boolean;
  soloClip(name: string | null): void;
  readonly solo: string | null;
  /**
   * Frame-accurate playback control, if the caller has it.
   *
   * OPTIONAL, and that is a compatibility decision rather than a design one: a host object written
   * before the transport existed still satisfies `HudHost`, and the strip simply does not mount.
   * Making it required would turn "this build predates the transport" into a type error in
   * `src/main.ts` — a file this block does not own.
   */
  readonly transport?: HudTransportHost;
}

export interface Hud {
  /** Mark `index` as current and scroll it into view. Cheap enough to call every beat change. */
  setActive(index: number): void;
  /** Collapse the panel to its title bar. `undefined` toggles. */
  setCollapsed(on?: boolean): void;
  readonly collapsed: boolean;
  /** Re-read `playing` / `solo` from the host. */
  refresh(): void;
  dispose(): void;
}

const CSS = `
.kata-hud{position:fixed;top:12px;right:12px;width:232px;max-height:calc(100vh - 24px);
  display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
  background:rgba(11,12,14,.82);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.09);box-shadow:0 8px 28px rgba(0,0,0,.5);
  font:12px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--kata-fg,#cbd2d9)}
.kata-hud__bar{display:flex;align-items:center;gap:8px;padding:9px 10px;
  border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto}
.kata-hud__title{font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--kata-accent,#7dd3a0);font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kata-hud__btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:inherit;border-radius:6px;padding:3px 9px;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.kata-hud__btn:hover{background:rgba(255,255,255,.12)}
.kata-hud__list{overflow-y:auto;overscroll-behavior:contain;flex:1 1 auto;padding:4px 0}
.kata-hud__row{display:flex;align-items:baseline;gap:8px;padding:4px 10px;cursor:pointer;
  border-left:2px solid transparent;white-space:nowrap}
.kata-hud__row:hover{background:rgba(255,255,255,.06)}
.kata-hud__row[data-active="1"]{background:rgba(125,211,160,.14);border-left-color:var(--kata-accent,#7dd3a0)}
.kata-hud__n{width:17px;text-align:right;color:var(--kata-dim,#7c8894);
  font-variant-numeric:tabular-nums;font-size:11px;flex:0 0 auto}
.kata-hud__row[data-active="1"] .kata-hud__n{color:var(--kata-accent,#7dd3a0)}
.kata-hud__label{overflow:hidden;text-overflow:ellipsis;flex:1 1 auto}
.kata-hud__row[data-kind="ceremony"] .kata-hud__label{color:var(--kata-dim,#7c8894);font-style:italic}
.kata-hud__kiai{color:#ffb347;font-size:9px;font-weight:700;letter-spacing:.06em;flex:0 0 auto}
.kata-hud__src{flex:0 0 auto;width:12px;text-align:center;font-size:11px;font-weight:700;cursor:help}
.kata-hud__src[data-src="mocap"]{color:#7dd3a0}
.kata-hud__src[data-src="approx"]{color:#e0b354}
.kata-hud__src[data-src="standin"]{color:#5a626b}
.kata-hud__legend{flex:0 0 auto;border-top:1px solid rgba(255,255,255,.08);padding:6px 10px;
  display:flex;gap:10px;font-size:10px;color:var(--kata-dim,#7c8894)}
.kata-hud__legend b{font-weight:700}
.kata-hud__legend .m{color:#7dd3a0}
.kata-hud__legend .a{color:#e0b354}
.kata-hud__legend .s{color:#5a626b}
.kata-hud__foot{flex:0 0 auto;border-top:1px solid rgba(255,255,255,.08);padding:7px 10px;
  display:flex;align-items:center;gap:7px}
.kata-hud__foot label{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--kata-dim,#7c8894)}
.kata-hud__sel{flex:1;min-width:0;appearance:none;background:rgba(255,255,255,.05);color:inherit;
  border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:3px 6px;font:inherit;font-size:11px;cursor:pointer}
.kata-hud__sel option{background:#14161a;color:#cbd2d9}
.kata-hud__min{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:inherit;border-radius:6px;width:22px;height:22px;padding:0;font:inherit;font-size:13px;
  line-height:1;cursor:pointer;flex:0 0 auto}
.kata-hud__min:hover{background:rgba(255,255,255,.12)}
/* Collapsed: the bar survives, everything below it goes. display:none rather than height:0 —
   a zero-height scroll container still traps the wheel over its footprint. */
.kata-hud[data-collapsed="1"]{width:auto}
.kata-hud[data-collapsed="1"] .kata-hud__list,
.kata-hud[data-collapsed="1"] .kata-hud__legend,
.kata-hud[data-collapsed="1"] .kata-hud__foot{display:none}
.kata-hud[data-collapsed="1"] .kata-hud__title{max-width:150px}
`;

const SCORE_OPTION = '— kata score —';

export function createHud(host: HudHost, mount: HTMLElement): Hud {
  const doc = mount.ownerDocument;

  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'kata-hud';

  /* ── bar ──────────────────────────────────────────────────────────────────────────────────── */
  const bar = doc.createElement('div');
  bar.className = 'kata-hud__bar';
  const title = doc.createElement('div');
  title.className = 'kata-hud__title';
  title.textContent = 'kata';
  const playBtn = doc.createElement('button');
  playBtn.className = 'kata-hud__btn';
  playBtn.type = 'button';

  /**
   * Collapse, because this panel is 29 rows tall and permanently covers the right quarter of the
   * dojo. The kata travels a 3.4 m x 2.0 m pattern and the camera orbits a full circle, so there
   * are plenty of angles where the figure is behind the list — and a viewer who just wants to WATCH
   * has no reason to keep a 29-row index on screen.
   *
   * The title bar deliberately survives: collapsing to nothing leaves no affordance to come back,
   * and the bar is also where the current clip name is displayed.
   */
  const minBtn = doc.createElement('button');
  minBtn.className = 'kata-hud__min';
  minBtn.type = 'button';
  bar.append(title, playBtn, minBtn);

  /* ── the counts ───────────────────────────────────────────────────────────────────────────── */
  const list = doc.createElement('div');
  list.className = 'kata-hud__list';
  const rows: HTMLElement[] = host.beats.map((b, i) => {
    const row = doc.createElement('div');
    row.className = 'kata-hud__row';
    row.dataset['kind'] = b.kind;

    const n = doc.createElement('span');
    n.className = 'kata-hud__n';
    n.textContent = b.kind === 'move' ? String(b.n) : '·';

    const label = doc.createElement('span');
    label.className = 'kata-hud__label';
    /* The count is already in its own column — repeating it in the label wastes the width the
     * Japanese technique name needs. */
    label.textContent = b.label.replace(/^\d+\.\s*/, '');
    label.title = b.label;

    row.append(n, label);
    if (b.kiai) {
      const k = doc.createElement('span');
      k.className = 'kata-hud__kiai';
      k.textContent = 'KIAI';
      row.append(k);
    }
    if (b.source !== null) {
      const s = doc.createElement('span');
      s.className = 'kata-hud__src';
      s.dataset['src'] = b.source;
      s.textContent = SOURCE_BADGE[b.source].mark;
      s.title = SOURCE_BADGE[b.source].title;
      row.append(s);
    }
    row.addEventListener('click', () => {
      host.goToBeat(i);
      setActive(i);
      refresh();
    });
    list.append(row);
    return row;
  });

  /* ── clip audition ────────────────────────────────────────────────────────────────────────── */
  const foot = doc.createElement('div');
  foot.className = 'kata-hud__foot';
  const clipLabel = doc.createElement('label');
  clipLabel.textContent = 'clip';
  const sel = doc.createElement('select');
  sel.className = 'kata-hud__sel';
  for (const name of [SCORE_OPTION, ...host.clips]) {
    const opt = doc.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.append(opt);
  }
  sel.addEventListener('change', () => {
    host.soloClip(sel.value === SCORE_OPTION ? null : sel.value);
    refresh();
  });
  foot.append(clipLabel, sel);

  /* ── legend ───────────────────────────────────────────────────────────────────────────────── */
  const legend = doc.createElement('div');
  legend.className = 'kata-hud__legend';
  const done = host.beats.filter((b) => b.source === 'mocap').length;
  const total = host.beats.filter((b) => b.source !== null).length;
  legend.innerHTML =
    `<span><b class="m">✓</b> real</span><span><b class="a">~</b> approx</span>` +
    `<span><b class="s">·</b> stand-in</span>`;
  const tally = doc.createElement('span');
  tally.style.marginLeft = 'auto';
  tally.textContent = `${done}/${total}`;
  tally.title = 'counts driven by real Shotokan motion capture';
  legend.append(tally);

  root.append(bar, list, legend, foot);
  mount.append(style, root);

  /* Built BEFORE the first `refresh()` below, because `refresh` pushes state into it. */
  const transport = host.transport === undefined ? null : createTransport(host.transport, mount);

  let active = -1;
  let collapsed = false;

  function applyCollapsed(): void {
    if (collapsed) root.dataset['collapsed'] = '1';
    else delete root.dataset['collapsed'];
    minBtn.textContent = collapsed ? '+' : '−';
    minBtn.title = collapsed ? 'show the count list' : 'minimise the count list';
    minBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    /* Re-run the scroll-into-view that `setActive` skips while hidden: a list expanded after
     * twenty counts of playback would otherwise open at the top, nowhere near the current one. */
    if (!collapsed) rows[active]?.scrollIntoView({ block: 'nearest' });
  }

  minBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsed();
  });
  applyCollapsed();

  function setActive(index: number): void {
    if (index === active) return;
    const prev = rows[active];
    if (prev !== undefined) delete prev.dataset['active'];
    const next = rows[index];
    if (next !== undefined) {
      next.dataset['active'] = '1';
      /* `nearest` rather than `center`: while the kata plays this fires every count, and centring
       * would keep the list in constant motion under the pointer. Skipped while collapsed —
       * scrolling a `display:none` container silently does nothing, and `applyCollapsed` replays
       * it on expand so the list opens at the count actually being performed. */
      if (!collapsed) next.scrollIntoView({ block: 'nearest' });
    }
    active = index;
  }

  function refresh(): void {
    const soloing = host.solo !== null;
    /* This button used to read `clip` and go disabled while a clip was soloed, because the frame
     * loop advanced the mixer unconditionally in that mode and never looked at `kataPlaying` — so
     * the button toggled a flag nothing read, and the flag then took effect out of nowhere when the
     * audition ended. `src/player/app.ts` now runs BOTH views off one clock, so pause pauses
     * whichever one is on screen and there is nothing left to disable. */
    playBtn.textContent = host.playing ? 'pause' : 'play';
    title.textContent = soloing ? (host.solo ?? 'clip') : 'kata';
    const want = host.solo ?? SCORE_OPTION;
    if (sel.value !== want) sel.value = want;
    transport?.refresh();
  }

  playBtn.addEventListener('click', () => {
    host.setPlaying();
    refresh();
  });
  refresh();

  return {
    setActive,
    setCollapsed(on?: boolean): void {
      collapsed = on ?? !collapsed;
      applyCollapsed();
    },
    get collapsed(): boolean {
      return collapsed;
    },
    refresh,
    dispose(): void {
      transport?.dispose();
      root.remove();
      style.remove();
    },
  };
}
