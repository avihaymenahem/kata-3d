/**
 * B6 PLAYER — `src/main.ts` — the entry point. §4.6: "entry; URL params".
 *
 * ═══ THIS FILE MAY NOT IMPORT `three`. NOT EVEN `import type`. ════════════════════════════════
 *
 * `tests/contracts/imports.test.ts` derives a file's ownership tree with `treeOf`, which returns
 * `null` for any path under `src/` with fewer than three segments — and `src/main.ts` has two. The
 * three-containment check then falls back to the pseudo-tree `'src'`, which appears on none of its
 * three lists (free / math-only / banned), so it falls through to the final `else` and is reported
 * as "tree src is not on the three allowlist". The allowlist is `src/rig`, `src/render`,
 * `src/player`, `src/ui`. Type-only imports are not excepted: the check keys on the SPECIFIER.
 *
 * The consequence is the right one. This file parses the URL, finds the canvas, and delegates; every
 * line that touches a renderer, a scene, a camera or a bone lives in `src/player/app.ts`. Importing
 * `./player` is legal because it resolves to that block's barrel (OWNERSHIP rule 3).
 *
 * ═══ URL SURFACE ═════════════════════════════════════════════════════════════════════════════
 *
 * The full `BootOpts` surface of §3.4.1 is parsed HERE, in Phase 1, even though only three fields do
 * anything yet — so the query string a capture tool or a bug report pastes stays stable across
 * phases instead of growing one parameter per phase.
 *
 *   ?harness=1        pins 1024 x 1024 at DPR 1, disables OrbitControls (§3.4.1, §6.3)
 *   ?quality=low      §6.6 tier: low | high | max. `low` drops GTAO + bloom (SwiftShader path)
 *   ?cam=LOW34        initial camera preset, any CameraPresetId
 *   ?still=1          opt in to §5.3's progressive still on idle. OFF by default — see the
 *                     measured reason on `IDLE_BEFORE_STILL_S` in src/player/app.ts
 *   ?kata=heian-shodan   PARSED, INERT until Phase 2 (needs B3's compileKata)
 *   ?tempo=T2            PARSED, INERT until Phase 2
 *   ?tick=29760          PARSED, INERT until Phase 2
 *   ?stageMask=0x7fff    PARSED, INERT until Phase 2
 *   ?hint=0           hides the keyboard hint line
 */

import type { KataId, TempoTier } from './contracts';
import { bootStage, type StageBoot } from './player';
import { createHud } from './ui';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The diagnostics global
 *
 * NOT `window.__KATA_HARNESS__`. That name is the FROZEN B6 <-> B9 boundary of §3.12 and it ships in
 * Phase 2 with the full `KataHarness` surface; publishing a partial object under that name would let
 * `tools/browser.mjs`'s `waitForHarness` resolve against something that cannot answer `plan()` or
 * `streamJoints()`. `__KATA_BOOT__` is a separate, clearly-Phase-1 name, and it exists because the
 * only honest way to verify a render is to read the live renderer's own numbers back out of the page.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface KataBootGlobal {
  readonly phase: 1;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
  ready: Promise<void>;
  ok: boolean;
  error: string | null;
  boot: StageBoot | null;
}

declare global {
  interface Window {
    __KATA_BOOT__?: KataBootGlobal;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * URL parsing
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const QUALITIES = ['low', 'high', 'max'] as const;
type Quality = (typeof QUALITIES)[number];

const KATA_IDS: readonly KataId[] = ['taikyoku-shodan', 'heian-shodan'];
const TEMPO_TIERS: readonly TempoTier[] = ['T0', 'T1', 'T2', 'T3'];

const q = new URLSearchParams(location.search);

/** `?flag`, `?flag=1`, `?flag=true`, `?flag=yes` are all true; `=0` / `=false` / `=no` are false. */
function flag(name: string, dflt: boolean): boolean {
  if (!q.has(name)) return dflt;
  const v = (q.get(name) ?? '').toLowerCase();
  if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return dflt;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], dflt: T): T {
  const v = q.get(name);
  if (v === null) return dflt;
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  return hit ?? dflt;
}

/** Accepts decimal and `0x`-prefixed hex, because §7.2 documents `--stage-mask <hex>`. */
function integer(name: string, dflt: number): number {
  const v = q.get(name);
  if (v === null) return dflt;
  const n = /^0[xX]/.test(v) ? Number.parseInt(v.slice(2), 16) : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

const harness = flag('harness', false);
const quality: Quality = oneOf<Quality>('quality', QUALITIES, harness ? 'max' : 'high');
const kataId: KataId = oneOf<KataId>('kata', KATA_IDS, 'taikyoku-shodan');
const tempoTier: TempoTier = oneOf<TempoTier>('tempo', TEMPO_TIERS, 'T1');
const startTick = integer('tick', 0);
const stageMask = integer('stageMask', -1);
const cam = q.get('cam');
const showHint = flag('hint', !harness);
const progressiveStill = flag('still', false);
/** `?rig=proc` renders the retired procedural solver output instead of the clip-driven character. */
const proceduralRig = q.get('rig') === 'proc';
/** `?model=Xbot.glb` swaps the character/clip glTF. Bare filenames resolve under `public/models`. */
const modelParam = q.get('model');
const modelUrl =
  modelParam === null ? undefined : modelParam.includes('/') ? modelParam : `models/${modelParam}`;

const params = Object.freeze({
  harness,
  quality,
  kataId,
  tempoTier,
  startTick,
  stageMask,
  progressiveStill,
  proceduralRig,
  model: modelUrl ?? null,
  cam: cam ?? null,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Boot
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const statusEl = document.getElementById('boot-status');
const messageEl = statusEl?.querySelector<HTMLElement>('.msg') ?? null;
const titleEl = statusEl?.querySelector<HTMLElement>('h1') ?? null;
const hintEl = document.getElementById('kata-hint');

function fail(what: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error && err.stack ? `\n\n${err.stack}` : '';
  if (statusEl !== null) {
    statusEl.hidden = false;
    statusEl.classList.add('failed');
    if (titleEl !== null) titleEl.textContent = 'boot failed';
    if (messageEl !== null) messageEl.textContent = `${what}\n\n${detail}${stack}`;
  }
  // Also to the console, so `page.on('console')` in a capture/e2e run sees it as an error.
  console.error(`[kata] ${what}`, err);
}

/** Declared at module scope so `onBeatChange`, created before boot returns, can reach it. */
let hud: ReturnType<typeof createHud> | null = null;

let resolveReady: () => void = () => {};
const g: KataBootGlobal = {
  phase: 1,
  params,
  ready: new Promise<void>((res) => {
    resolveReady = res;
  }),
  ok: false,
  error: null,
  boot: null,
};
window.__KATA_BOOT__ = g;

async function main(): Promise<void> {
  const canvas = document.getElementById('kata-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(
      "index.html must contain <canvas id='kata-canvas'>. Found: " +
        (canvas === null ? 'nothing' : canvas.tagName),
    );
  }

  const boot = await bootStage({
    canvas,
    quality,
    harness,
    interactive: !harness,
    progressiveStill,
    kataId,
    tempoTier,
    startTick,
    proceduralRig,
    modelUrl,
    scoreView: q.get('view') === 'score',
    onClipChange: (name, index, total) => {
      if (hintEl !== null) {
        hintEl.textContent = `clip ${index + 1}/${total} — ${name}   ·   [ ] audition · 1-9 cameras`;
        hintEl.hidden = false;
      }
    },
    onBeatChange: (label, kiai, index) => {
      hud?.setActive(index);
      if (hintEl !== null) {
        hintEl.textContent = `${label}${kiai ? '   — KIAI!' : ''}`;
        hintEl.hidden = false;
      }
    },
    /* A harness run wants a DETERMINISTIC still at an exact tick, not a moving figure — §6.3's
     * determinism ledger. Interactive boots play. */
    autoplay: !harness,
    onGateFail: (msg) => {
      /* Visible, not just logged: a figure rendered from an advisory compile is a diagnostic
       * view, and the page must not look like a passing build. */
      console.warn(`[kata] GATE FAILING, rendering advisory track — ${msg}`);
      if (hintEl !== null) {
        hintEl.textContent = `⚠ advisory compile — ${msg}`;
        hintEl.hidden = false;
      }
    },
    onCompileStart: (id) => {
      /* The compile is seconds, not milliseconds (§4.11's 220 ms is a target, not yet a fact), and
       * it blocks the main thread. Saying so beats a page that looks hung. */
      if (messageEl !== null) messageEl.textContent = `compiling ${id}…`;
      console.info(`[kata] compiling ${id} at ${tempoTier} — this currently takes seconds`);
    },
  });
  if (cam !== null) boot.setCameraPreset(cam, true);

  /* The HUD is built AFTER boot because its list is the compiled score and its clip menu includes
   * the retargeted mocap, neither of which exists until the character has loaded. */
  const hudRoot = document.getElementById('hud-root');
  if (hudRoot !== null && boot.choreography !== null && boot.character !== null && !harness) {
    const ch = boot.choreography;
    const character = boot.character;
    hud = createHud(
      {
        beats: ch.beats,
        clips: character.clipNames,
        goToBeat: (i) => boot.goToBeat(i),
        setPlaying: (p) => boot.setPlaying(p),
        get playing() {
          return boot.playing;
        },
        soloClip: (n) => boot.soloClip(n),
        get solo() {
          return boot.solo;
        },
      },
      hudRoot,
    );
    hud.setActive(boot.beatIndex);
  }

  g.boot = boot;
  g.ok = true;
  if (statusEl !== null) statusEl.hidden = true;
  if (hintEl !== null) hintEl.hidden = !showHint;
  if (!harness) canvas.focus();

  const t = boot.transport;
  if (t !== null) {
    console.info(
      `[kata] ${kataId} @ ${tempoTier}: ${t.track.durationTicks} ticks ` +
        `(${t.track.durationS.toFixed(2)} s), ${t.track.segments.length} segments, ` +
        `${t.track.bakeStats.baseFrames} frames, hash ${t.track.hash}. ` +
        `SPACE play/pause · ←/→ step · Home restart.`,
    );
  }
  /* `?stageMask` is still inert: it belongs on the compile call, but a partial mask makes every
   * gate advisory (§4.11), so exposing it from a URL before the gates are all green would let a
   * broken build look green. It lands with the Phase-2 exit gate. */
  if (stageMask !== -1) {
    console.info(`[kata] ?stageMask=${stageMask} is parsed but INERT — see the note in src/main.ts.`);
  }
}

main()
  .then(() => resolveReady())
  .catch((err: unknown) => {
    g.error = err instanceof Error ? err.message : String(err);
    fail('The dojo did not boot.', err);
    resolveReady();
  });
