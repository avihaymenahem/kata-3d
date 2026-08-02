/**
 * B8 UI — `src/ui/cameraBar.ts` — the twelve camera presets, as things you can touch.
 *
 * ═══ WHY THIS FILE EXISTS AT ALL ═════════════════════════════════════════════════════════════
 *
 * Until now the camera was reachable ONLY from the keyboard: `1`-`9` for the presets, `0` for
 * overhead, `m` to cycle the four measurement cameras, `r` to reset, `f` for the heading-locked
 * follow. On a phone there is no keyboard, so "360-degree kata viewer" shipped with eleven of its
 * twelve viewpoints unreachable — not hard to find, not hidden behind a menu, UNREACHABLE. That is
 * the single biggest hole in the touch story and no amount of resizing the existing panels closes
 * it, because there was no control to resize.
 *
 * ═══ WHY TOP-LEFT, AND WHY A POPOVER ═════════════════════════════════════════════════════════
 *
 * Three pieces of chrome are already spoken for: the HUD owns top-right, the transport owns bottom
 * centre, `#kata-hint` owns bottom-left. Top-left is the only corner left, and it is the right one
 * anyway — the two panels a viewer drives continuously (counts, scrub) stay where video players and
 * this app have already put them, and the one they touch occasionally moves out of their way.
 *
 * Occasionally is the operative word, and it is why the twelve chips live behind a toggle instead of
 * sitting on screen. A camera preset is a decision you take once and then watch the result of; a
 * grid that stays open is a grid that is covering the dojo during the part you actually came for.
 * On a compact viewport the panel also closes ITSELF after a preset is chosen, because on a 375 px
 * screen the panel and the thing it changes cannot both be visible, and leaving it open would mean
 * the user's first action after every camera change is to dismiss a menu.
 *
 * ═══ WHY THE LABELS LIVE HERE AND THE IDS DO NOT ═════════════════════════════════════════════
 *
 * `CameraPresetId` is B0's frozen union (`src/contracts/services.ts` §5.7). The ORDER and the
 * WORDING are presentation, which is this block's job — but the id set is not, so `PRESET_LABEL` is
 * typed `Record<CameraPresetId, …>` and is therefore exhaustive by construction: adding a preset to
 * the contract breaks this file at compile time instead of silently shipping a bar that is missing a
 * camera. Nothing here imports `src/player`, which is where `CAMERA_KEY_ORDER` lives, because that
 * barrel pulls three into a block that must stay free of it.
 */

import type { CameraPresetId } from '../contracts';

import { COMPACT_MEDIA, TOUCH_MEDIA, TOUCH_TARGET_PX } from './layout';

export interface CameraBarHost {
  /** `exact` snaps instead of blending — §5.7's `snapTo`, the same thing `r` does. */
  setPreset(id: CameraPresetId, exact?: boolean): void;
  /** Heading-locked follow on ORBIT. `undefined` toggles. */
  setFollowCam(on?: boolean): void;
  readonly followCam: boolean;
  /** The preset now active, so the chip that is showing can say so. */
  readonly active: string;
}

export interface CameraBar {
  /** Re-read `active` / `followCam` from the host. */
  refresh(): void;
  /** Open or close the chip grid. `undefined` toggles. */
  setOpen(on?: boolean): void;
  readonly open: boolean;
  dispose(): void;
}

/**
 * Chip text and hover title per preset. Short on the chip because three have to fit across a 232 px
 * panel; the title carries the keyboard equivalent, so a desktop user learns the shortcut from the
 * control rather than from the hint line they may have dismissed.
 */
const PRESET_LABEL: Record<CameraPresetId, { readonly text: string; readonly key: string }> = {
  ORBIT: { text: 'orbit', key: '1' },
  HERO: { text: 'hero', key: '2' },
  JUDGE: { text: 'judge', key: '3' },
  LOW34: { text: 'low ¾', key: '4' },
  FOLLOW: { text: 'follow', key: '5' },
  EMBUSEN: { text: 'embusen', key: '6' },
  DETAIL_HANDS: { text: 'hands', key: '7' },
  DETAIL_FEET: { text: 'feet', key: '8' },
  M_FRONT: { text: 'front', key: '9' },
  M_LEFT: { text: 'left', key: 'm' },
  M_RIGHT: { text: 'right', key: 'm' },
  M_TOP: { text: 'top', key: '0' },
};

/**
 * The three groups, in the order a viewer reaches for them: the six you watch a kata from, the two
 * that close in on a technique, the four frozen ortho cameras a measurement is read off (§5.7).
 * Grouped rather than listed 1-12 because "detail" and "measure" answer completely different
 * questions from "which angle", and a flat grid of twelve makes the reviewer read all twelve.
 */
const GROUPS: readonly { readonly name: string; readonly ids: readonly CameraPresetId[] }[] = [
  { name: 'view', ids: ['ORBIT', 'HERO', 'JUDGE', 'LOW34', 'FOLLOW', 'EMBUSEN'] },
  { name: 'detail', ids: ['DETAIL_HANDS', 'DETAIL_FEET'] },
  { name: 'measure', ids: ['M_FRONT', 'M_LEFT', 'M_RIGHT', 'M_TOP'] },
];

/**
 * `touch-action: manipulation` on every button, everywhere in this block: it keeps the tap but drops
 * the 300 ms double-tap-to-zoom wait, which on a chip grid reads as the whole UI being laggy.
 * `-webkit-tap-highlight-color` kills the grey flash iOS paints over a tapped control, which fights
 * the `:active` state the chips already draw.
 */
const CSS = `
.kata-cam{position:fixed;top:12px;left:12px;display:flex;flex-direction:column;align-items:flex-start;
  gap:6px;font:12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  color:var(--kata-fg,#cbd2d9);max-width:calc(100vw - 24px)}
.kata-cam button{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:inherit;border-radius:6px;font:inherit;cursor:pointer;touch-action:manipulation;
  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.kata-cam button:hover{background:rgba(255,255,255,.13)}
.kata-cam button:active{background:rgba(125,211,160,.22)}
.kata-cam__toggle{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;font-size:11px;
  letter-spacing:.07em;text-transform:uppercase;
  background:rgba(11,12,14,.82);backdrop-filter:blur(14px);box-shadow:0 8px 28px rgba(0,0,0,.5)}
.kata-cam__toggle b{font-weight:600;color:var(--kata-accent,#7dd3a0);text-transform:none;
  letter-spacing:0;font-size:11px}
.kata-cam__panel{width:232px;max-width:100%;box-sizing:border-box;padding:8px 9px 9px;border-radius:10px;
  background:rgba(11,12,14,.82);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.09);box-shadow:0 8px 28px rgba(0,0,0,.5)}
.kata-cam[data-open="0"] .kata-cam__panel{display:none}
.kata-cam__head{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--kata-dim,#7c8894);
  margin:6px 0 4px}
.kata-cam__head:first-child{margin-top:0}
.kata-cam__grid{display:flex;flex-wrap:wrap;gap:5px}
.kata-cam__chip{flex:1 1 60px;min-width:60px;height:26px;padding:0 6px;font-size:11px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.kata-cam__chip[data-active="1"]{background:rgba(125,211,160,.18);border-color:rgba(125,211,160,.55);
  color:var(--kata-accent,#7dd3a0)}
.kata-cam__foot{display:flex;gap:5px;margin-top:8px;padding-top:8px;
  border-top:1px solid rgba(255,255,255,.08)}
.kata-cam__foot button{height:26px;padding:0 8px;font-size:11px;white-space:nowrap}
.kata-cam__follow{flex:1 1 auto}
.kata-cam__follow[data-on="1"]{background:rgba(125,211,160,.22);border-color:rgba(125,211,160,.55);
  color:var(--kata-accent,#7dd3a0)}

/* ── compact: the toggle keeps its corner, the panel becomes a popover under it ────────────── */
@media ${COMPACT_MEDIA}{
  .kata-cam{top:calc(10px + env(safe-area-inset-top));left:calc(10px + env(safe-area-inset-left))}
  .kata-cam__panel{width:min(268px,calc(100vw - 20px))}
  /* The grid is scrollable rather than tall: in landscape the viewport is ~430 px and twelve chips
     plus three headers plus the footer do not fit above the transport strip. */
  .kata-cam__scroll{max-height:min(52vh,320px);max-height:min(52dvh,320px);overflow-y:auto;
    overscroll-behavior:contain}
}

/* ── touch sizing: compact OR a coarse pointer at any width ────────────────────────────────── */
@media ${TOUCH_MEDIA}{
  .kata-cam__toggle{height:${TOUCH_TARGET_PX}px;padding:0 14px;font-size:12px}
  .kata-cam__chip{height:${TOUCH_TARGET_PX}px;flex-basis:72px;min-width:72px;font-size:12px}
  .kata-cam__foot button{height:${TOUCH_TARGET_PX}px;font-size:12px}
}
`;

export function createCameraBar(
  host: CameraBarHost,
  mount: HTMLElement,
  opts: { readonly open?: boolean } = {},
): CameraBar {
  const doc = mount.ownerDocument;
  const view = doc.defaultView;

  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'kata-cam';

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'kata-cam__toggle';
  const toggleWord = doc.createElement('span');
  toggleWord.textContent = 'cam';
  const toggleName = doc.createElement('b');
  toggle.append(toggleWord, toggleName);

  const panel = doc.createElement('div');
  panel.className = 'kata-cam__panel';
  /* One scroll container around the groups, so the footer's follow/reset pair stays pinned and
   * reachable when the grid runs out of room in landscape. */
  const scroll = doc.createElement('div');
  scroll.className = 'kata-cam__scroll';

  let open = opts.open ?? true;

  /* Chips are indexed by id so `refresh` can mark the active one without walking the DOM. */
  const chips = new Map<CameraPresetId, HTMLButtonElement>();

  for (const group of GROUPS) {
    const head = doc.createElement('div');
    head.className = 'kata-cam__head';
    head.textContent = group.name;
    const grid = doc.createElement('div');
    grid.className = 'kata-cam__grid';
    for (const id of group.ids) {
      const meta = PRESET_LABEL[id];
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'kata-cam__chip';
      chip.textContent = meta.text;
      chip.title = `${id} — also the ${meta.key} key`;
      chip.addEventListener('click', () => {
        /* Blend, never snap. `KataCameraRig.setPreset` already falls back to `snapTo` when the
         * change crosses the persp/ortho boundary (§5.7 defines no interpolation between the two),
         * so asking for a blend here gets the eased move where one exists and the exact cut where
         * one does not — without this file having to know which presets are ortho. */
        host.setPreset(id);
        refresh();
        /* See the header: on a handset the panel is covering the change it just made. */
        if (compactNow()) setOpen(false);
      });
      chips.set(id, chip);
      grid.append(chip);
    }
    scroll.append(head, grid);
  }

  const foot = doc.createElement('div');
  foot.className = 'kata-cam__foot';

  /**
   * The follow-cam toggle — `f` — which had no on-screen control of any kind.
   *
   * It stays a TOGGLE rather than joining the preset grid because it is not a viewpoint: it is a
   * modifier on ORBIT that holds your chosen angle relative to the karateka as he turns. Its own
   * host call already forces the camera back to ORBIT when it is switched on, so tapping it from a
   * measurement camera does the useful thing instead of setting a flag with no visible effect.
   */
  const follow = doc.createElement('button');
  follow.type = 'button';
  follow.className = 'kata-cam__follow';
  follow.title = 'hold the angle relative to him as he turns — also the f key';
  follow.addEventListener('click', () => {
    host.setFollowCam();
    refresh();
  });

  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.textContent = 'reset';
  reset.title = 'snap back to the default orbit — also the r key';
  reset.addEventListener('click', () => {
    host.setPreset('ORBIT', true);
    refresh();
  });

  foot.append(follow, reset);
  panel.append(scroll, foot);
  root.append(toggle, panel);
  mount.append(style, root);

  /* `matchMedia` rather than re-reading `innerWidth`: rotating a phone fires it once, and it is the
   * SAME query string the stylesheet above is compiled from, so the two can never disagree. */
  const mq = view?.matchMedia?.(COMPACT_MEDIA) ?? null;
  const compactNow = (): boolean => mq?.matches ?? false;

  function applyOpen(): void {
    root.dataset['open'] = open ? '1' : '0';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.title = open ? 'hide the camera presets' : 'show the camera presets';
  }

  function setOpen(on?: boolean): void {
    open = on ?? !open;
    applyOpen();
  }

  toggle.addEventListener('click', () => setOpen());

  let lastActive = '';
  let lastFollow: boolean | null = null;

  function refresh(): void {
    const active = host.active;
    if (active !== lastActive) {
      const prev = chips.get(lastActive as CameraPresetId);
      if (prev !== undefined) delete prev.dataset['active'];
      const next = chips.get(active as CameraPresetId);
      if (next !== undefined) next.dataset['active'] = '1';
      /* The collapsed toggle is the only thing on screen in compact mode, so it carries the answer
       * to "which camera am I looking through" that the grid would otherwise have to be open for. */
      toggleName.textContent = PRESET_LABEL[active as CameraPresetId]?.text ?? active;
      lastActive = active;
    }
    if (host.followCam !== lastFollow) {
      lastFollow = host.followCam;
      follow.dataset['on'] = lastFollow ? '1' : '0';
      follow.textContent = lastFollow ? 'follow ON' : 'follow';
    }
  }
  applyOpen();
  refresh();

  /**
   * The OTHER way these two values change is `src/player/app.ts`'s WINDOW key handler (`1`-`9`,
   * `0`, `m`, `r`, `f`), which this block cannot see. One `keyup` listener is the entire cost of
   * staying in sync with it — and `keyup` specifically, so the player's `keydown` has already
   * applied the change by the time we read it back, whatever order the two listeners registered in.
   *
   * Deliberately NOT the rAF poll the transport uses. The transport polls because its clock changes
   * continuously with playback; a camera preset changes only on a discrete input event, and a
   * per-frame read of two properties to notice something that happens twice a minute is waste.
   */
  const onKeyUp = (): void => refresh();
  view?.addEventListener('keyup', onKeyUp);

  return {
    refresh,
    setOpen,
    get open(): boolean {
      return open;
    },
    dispose(): void {
      view?.removeEventListener('keyup', onKeyUp);
      root.remove();
      style.remove();
    },
  };
}
