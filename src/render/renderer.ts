/**
 * B5 RENDER — `src/render/renderer.ts`
 *
 * `createRenderer`: the exact constructor and settings of ARCHITECTURE.md §5.1, which is
 * doc 05 §3 / §15 with our numbers.
 *
 * ── THE FOUR THINGS THIS FILE EXISTS TO GET RIGHT ─────────────────────────────────────────────
 *
 * 1. **Tone mapping.** `AgXToneMapping`, exposure `1.0` (§5.1). Doc 05 §16 uncertainty 1 states
 *    plainly that the operator is an art call, not an engine fact, and §5.1 makes the call. The
 *    operator therefore ships as ONE named binding, `TONE_MAPPING`, with `TONE_MAPPING_OPTIONS`
 *    next to it, so switching to `ACESFilmicToneMapping` is a one-line change plus a re-tune of
 *    `toneMappingExposure` — never a hunt through the tree. Doc 05 §14.1 #27: ACES pre-divides
 *    exposure by 0.6 and AgX does not, so the two are NOT interchangeable at a fixed exposure.
 *
 * 2. **`outputColorSpace` is never assigned.** The default is already `SRGBColorSpace`
 *    (doc 05 §4.1, `WebGLRenderer.js:304`), `OutputPass` reads it off the renderer every frame
 *    (`OutputPass.js:96-113`), and assigning it is the classic way to double-encode. We ASSERT it
 *    instead — `assertRendererInvariants` — so "correct output colour space" is a checked
 *    property rather than a hopeful comment.
 *
 * 3. **`PCFShadowMap`, explicitly.** `PCFSoftShadowMap` is deprecated and `WebGLShadowMap.js:99`
 *    MUTATES `renderer.shadowMap.type` back to `PCFShadowMap` inside `render()`, so any code that
 *    reads the value back sees a different number than it wrote (doc 05 §6.1, §14.1 #1). The
 *    constant is grep-banned project-wide.
 *
 * 4. **r155+ physical light semantics.** `useLegacyLights` / `physicallyCorrectLights` /
 *    `outputEncoding` do not exist in this build at all (doc 05 §4.4), so there is nothing to set
 *    — and every pre-r155 tutorial intensity is π× too small (§14.1 #26). `LIGHTS` in
 *    `src/data/constants/render.ts` is authored in post-r155 units; see `lights.ts`.
 *
 * `reversedDepthBuffer` stays `false`: the PCF branch of `shadowmap_pars_fragment.glsl.js:122` has
 * no reversed-depth guard where the VSM branch at `:159-167` does, so flipping it silently inverts
 * the shadow bias convention (doc 05 §14.1 #7).
 */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type ToneMapping,
} from 'three';

import { HARNESS_CANVAS_PX, HARNESS_DPR } from '../contracts';
import { POST } from '../data';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The tone-mapping decision, isolated.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * §5.1's decision. Doc 05 §4.3 argues it: AgX gives the best highlight rolloff and a neutral hue
 * path for a white cotton gi under a strong key, and avoids the ACES magenta/orange skew on skin.
 */
export const TONE_MAPPING: ToneMapping = AgXToneMapping;

/**
 * The three operators doc 05 §16 uncertainty 1 says a critic may legitimately prefer, with the
 * exposure each one needs. Only the names are persisted anywhere — doc 05 §14.1 #28: the enum
 * integers are NOT in a sensible order (`CustomToneMapping = 5`, `AgXToneMapping = 6`).
 */
export const TONE_MAPPING_OPTIONS: Readonly<
  Record<'agx' | 'aces' | 'neutral', { readonly op: ToneMapping; readonly exposure: number }>
> = Object.freeze({
  /** SHIPPED. `color *= exposure`, then Rec.2020 inset + 6th-order sigmoid. */
  agx: { op: AgXToneMapping, exposure: POST.toneMappingExposure.v },
  /**
   * `tonemapping_pars_fragment.glsl.js:62` applies `color *= exposure / 0.6`, so matching AgX's
   * apparent brightness needs `exposure * 0.6`. Switching without this is a +0.74 EV jump that
   * reads as "the grade changed", not "the operator changed".
   */
  aces: { op: ACESFilmicToneMapping, exposure: POST.toneMappingExposure.v * 0.6 },
  /** Khronos PBR Neutral. `color *= exposure`, best albedo fidelity, flatter highlights. */
  neutral: { op: NeutralToneMapping, exposure: POST.toneMappingExposure.v },
});

/** doc 05 §3: `Math.min(devicePixelRatio, 2)`. */
export const MAX_PIXEL_RATIO = POST.maxPixelRatio.v;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Construction
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * §5.1 boot step 1. `harness: true` pins the canvas to 1024 x 1024 at DPR 1 (§6.3 determinism
 * ledger) and turns on `preserveDrawingBuffer` so `canvas.toDataURL()` returns the frame that was
 * just drawn rather than a cleared buffer.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  o: { harness: boolean },
): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false, // MSAA is bypassed by EffectComposer anyway (doc 05 §14.1 #23); we ship SMAA
    alpha: false, // opaque canvas is cheaper
    stencil: false, // nothing in the project needs stencil
    depth: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: false, // doc 05 §14.1 #7 — PCF has no reversed-depth guard
    preserveDrawingBuffer: o.harness, // harness only: +VRAM, -perf (doc 05 §3)
  });

  if (o.harness) {
    renderer.setPixelRatio(HARNESS_DPR);
    renderer.setSize(HARNESS_CANVAS_PX, HARNESS_CANVAS_PX, false);
  } else {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    renderer.setPixelRatio(Math.min(dpr, MAX_PIXEL_RATIO));
    renderer.setSize(canvas.clientWidth || 1600, canvas.clientHeight || 900);
  }

  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = TONE_MAPPING_OPTIONS.agx.exposure;
  // renderer.outputColorSpace is ALREADY SRGBColorSpace and must not be assigned. Asserted below.

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  assertRendererInvariants(renderer);
  return renderer;
}

/**
 * The three renderer facts every downstream pass silently depends on. Called by `createRenderer`,
 * and callable again after any look-dev change, because doc 05 §6.1 documents one of them
 * (`shadowMap.type`) as being mutated by the engine itself at first shadow render.
 *
 * Throws rather than warns: a double-encoded frame or a silently-downgraded shadow filter is a
 * Tier-A visual finding that no numeric metric in the 63 can see.
 */
export function assertRendererInvariants(renderer: WebGLRenderer): void {
  const bad: string[] = [];
  if (renderer.outputColorSpace !== SRGBColorSpace) {
    bad.push(
      `outputColorSpace is '${String(renderer.outputColorSpace)}', expected '${String(
        SRGBColorSpace,
      )}'. §5.1: never assign it — the default is already correct and OutputPass reads it off the ` +
        `renderer each frame.`,
    );
  }
  if (renderer.shadowMap.type !== PCFShadowMap) {
    bad.push(
      `shadowMap.type is ${String(renderer.shadowMap.type)}, expected PCFShadowMap ` +
        `(${String(PCFShadowMap)}). doc 05 §14.1 #1: the deprecated soft variant is mutated back ` +
        `to this value inside render(), so writing it and reading it back disagree.`,
    );
  }
  if (renderer.shadowMap.enabled !== true) {
    bad.push('shadowMap.enabled is false — metric 61 contact_shadow_present cannot pass.');
  }
  if (bad.length > 0) {
    throw new Error(`render/renderer.ts invariant violated:\n  - ${bad.join('\n  - ')}`);
  }
}
