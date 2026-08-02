/**
 * B8 UI — `src/ui/index.ts`
 *
 * THE BARREL. Cross-block imports go ONLY through here (OWNERSHIP rule 3,
 * `tests/contracts/imports.test.ts`), and `src/main.ts` reaches this block through it.
 *
 * Nothing here touches three. The HUD is plain DOM over the canvas, mounted into the `#hud-root`
 * that `index.html` reserves — which is what keeps it out of the render loop entirely.
 *
 * Nor does the audio: it is `speechSynthesis` plus an `AudioContext`, no renderer, no assets, and it
 * has to be reachable from `src/main.ts` through this barrel like everything else (OWNERSHIP rule 3
 * would otherwise report a deep cross-block import).
 */

export { createHud, type Hud, type HudBeat, type HudHost } from './hud';
/* The camera bar is mounted BY `createHud`, like the transport. What crosses the barrel is the host
 * shape `src/main.ts` fills in — the presets and the follow-cam toggle were keyboard-only until it
 * existed, so this is the type that makes them reachable without a keyboard. */
export { createCameraBar, type CameraBar, type CameraBarHost } from './cameraBar';
/* The breakpoints themselves, so `tests/ui` can assert the phone/desktop decision without a DOM and
 * so any later widget takes the SAME decision instead of inventing a second definition of narrow. */
export {
  COARSE_POINTER_MEDIA,
  COMPACT_MAX_HEIGHT_PX,
  COMPACT_MAX_WIDTH_PX,
  COMPACT_MEDIA,
  isCompactViewport,
  readViewport,
  resolveLayout,
  TOUCH_MEDIA,
  TOUCH_TARGET_PX,
  type UiLayout,
  type Viewport,
  type ViewportSource,
} from './layout';
export {
  createKataAudio,
  countKana,
  countRomaji,
  parseBeatLabel,
  pickVoice,
  renderSfx,
  toKana,
  type BeatSpeech,
  type KataAudio,
  type KataAudioOpts,
  type SfxKind,
  type VoiceChoice,
  type VoiceLike,
} from './audio';
/* The transport strip is mounted BY `createHud` — a caller never constructs it directly. What has
 * to cross the barrel is the host shape `src/main.ts` fills in, plus the four pure read-out helpers
 * so `tests/ui` can assert the clock and the frame ordinal without a DOM. */
export {
  createTransport,
  formatClockSeconds,
  formatTransportClock,
  frameIndexOf,
  pointerFraction,
  positionFraction,
  type HudTransport,
  type HudTransportHost,
} from './transport';
