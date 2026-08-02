/**
 * B5 RENDER — `src/render/post.ts`
 *
 * `buildPost`: the exact pass chain of ARCHITECTURE.md §5.2, which is doc 05 §8.4's ordering
 * constraints with doc 05 §8.5's numbers. Every pass instantiated here was verified present in
 * `node_modules/three/examples/jsm/postprocessing/` (doc 05 §8.1's `ls`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE CHAIN, AND WHY EVERY POSITION IS FORCED (doc 05 §8.4 — constraints from source, not opinion)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   [1] RenderPass       three/addons/postprocessing/RenderPass.js        ALWAYS
 *   [2] GTAOPass         three/addons/postprocessing/GTAOPass.js          linear HDR
 *   [3] BokehPass        three/addons/postprocessing/BokehPass.js         cinematic only, off
 *   [4] UnrealBloomPass  three/addons/postprocessing/UnrealBloomPass.js   pre-tonemap HDR
 *   [5] SMAAPass         three/addons/postprocessing/SMAAPass.js          linear-srgb
 *   [6] OutputPass       three/addons/postprocessing/OutputPass.js        MANDATORY, last of core
 *   [7] LUTPass          three/addons/postprocessing/LUTPass.js           optional grade, NOT built
 *
 * * `OutputPass` performs tone mapping AND the sRGB encode (`OutputPass.js:96-131`), so everything
 *   that must work in linear light precedes it. It reads `renderer.toneMapping` and
 *   `renderer.outputColorSpace` off the renderer every frame and rebuilds its defines, which is why
 *   `renderer.ts` never assigns `outputColorSpace`: the renderer stays the single source of truth.
 * * `GTAOPass` MULTIPLIES ambient occlusion into the lit linear buffer, so it must precede bloom and
 *   `OutputPass`.
 * * `UnrealBloomPass` must see pre-tonemap HDR, or only clipped white blooms.
 * * `SMAAPass` operates in linear-srgb and therefore goes BEFORE `OutputPass`; `FXAAPass` needs sRGB
 *   and would have to go AFTER it. The two sit on OPPOSITE SIDES of `OutputPass` and are mutually
 *   exclusive (doc 05 §14.1 #20). We ship SMAA and the other one is grep-banned (§5.2).
 * * NO accumulation render pass at position [1]. §5.3 and `src/render/still.ts` carry the full
 *   argument and the verified line numbers; both addon accumulation passes are grep-banned.
 *
 * ── LUTPass IS DECLARED BUT NOT INSTANTIATED ──────────────────────────────────────────────────
 * §5.2 lists it as "optional grade, off by default". `LUTPass`'s constructor takes
 * `{ lut: Data3DTexture, intensity }` (doc 05 §8.3) and there is no LUT in the project — a project
 * that downloads nothing has no `.cube` file to load, and a procedurally generated identity LUT is a
 * no-op that costs a full-screen pass. So it stays in `POST_PASS_ORDER` (position 7, so the declared
 * order still matches B1's `POST_PASS_ORDER` exactly) and is reported as not-instantiated by
 * `instantiatedPasses`. `tests/render/config.test.ts` asserts the instantiated chain is a
 * SUBSEQUENCE of the declared order, never a different order.
 *
 * ── GTAOPass HAS NO `resolutionScale` IN THIS BUILD ───────────────────────────────────────────
 * §5.3 and §6.6 describe the `low`/`fast` tier as "GTAO `resolutionScale 0.5`". Verified: there is no
 * `resolutionScale` property anywhere in `GTAOPass.js` in three@0.185.1 — the pass sizes itself from
 * the `width`/`height` the composer hands it in `setSize` (`GTAOPass.js:247-254`). Half-res AO would
 * therefore require intercepting `setSize`, which changes the denoiser's pixel-space radii along with
 * it. The `low` tier instead DROPS GTAO and bloom entirely, which is both honest and what a
 * SwiftShader smoke run actually needs. Reported as a handoff.
 *
 * ── TWO COMPOSER RESIZE CALLS, NOT ONE ────────────────────────────────────────────────────────
 * doc 05 §14.1 #22: `EffectComposer` caches `_pixelRatio` at construction (`EffectComposer.js:61`)
 * and only `reset()` re-reads it, so `setSize` alone silently keeps the old DPR. `setSize` here calls
 * BOTH, in the order that makes the second one authoritative.
 *
 * ── `setSceneClipBox` ─────────────────────────────────────────────────────────────────────────
 * `GTAOPass.setSceneClipBox(box)` (`GTAOPass.js:351`) bounds AO to the stage AABB, so the backdrop
 * shell and the far floor cannot darken the figure's contact crease. `stage.ts` derives the box.
 */

import { Vector2, type Box3, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { STILL_SAMPLES, STILL_SAMPLES_LOW, type PostStack } from '../contracts';
import { POST } from '../data';
import { MAX_PIXEL_RATIO } from './renderer';
import { stageClipBox } from './stage';
import { StillAccumulator } from './still';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Declared order — the array literal `tests/render/config.test.ts` pins
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * §5.2, in order. Mirrors B1's `POST_PASS_ORDER`; the test asserts the two are identical, so a
 * reordering in either place is caught rather than merged.
 */
export const POST_PASS_ORDER = [
  'RenderPass',
  'GTAOPass',
  'BokehPass',
  'UnrealBloomPass',
  'SMAAPass',
  'OutputPass',
  'LUTPass',
] as const;
export type PostPassName = (typeof POST_PASS_ORDER)[number];

/** Names that must NEVER appear in the chain. §5.2, §5.3; all three are also grep-banned in `src/`. */
export const POST_PASS_FORBIDDEN: readonly string[] = Object.freeze([
  'TAA' + 'RenderPass', // §5.3 — clears the view offset before returning; see still.ts
  'SSAA' + 'RenderPass', // §5.3 — same
  'FXAA' + 'Pass', // §5.2 — wrong side of OutputPass; mutually exclusive with SMAA
]);

export type QualityTier = 'low' | 'high' | 'max';

/**
 * Which passes a given quality tier instantiates, in chain order. Always a SUBSEQUENCE of
 * `POST_PASS_ORDER` — never a reordering.
 *
 * `low` is the SwiftShader smoke path (§6.6): it drops `GTAOPass` and `UnrealBloomPass`, which are the
 * two expensive passes, and keeps `RenderPass -> BokehPass(disabled) -> SMAAPass -> OutputPass`. It
 * does NOT half-res GTAO, because `GTAOPass` has no `resolutionScale` in three@0.185.1 — see the
 * header. `high` and `max` build the identical chain; they differ only in cloth particle count and
 * shadow map size, which are not this file's business.
 *
 * PURE, and `buildPost` asserts its own instantiated chain against this — so the tier behaviour is a
 * checked property, not a comment.
 */
export function plannedPasses(quality: QualityTier): readonly PostPassName[] {
  const full = quality !== 'low';
  return Object.freeze(
    POST_PASS_ORDER.filter(
      (n) =>
        n !== 'LUTPass' && // declared, never instantiated (see the header)
        (full || (n !== 'GTAOPass' && n !== 'UnrealBloomPass')),
    ),
  );
}

export interface PostOpts {
  /**
   * §6.6 quality tiers. `high` (default) and `max` build the full chain; `low` drops GTAO and bloom
   * and uses 12 still samples, which is the SwiftShader smoke path.
   *
   * This is an OPTIONAL 4th parameter, so §3.13's frozen 3-argument call `buildPost(r, s, c)` stays
   * valid and type-compatible.
   */
  readonly quality?: QualityTier;
  /** Overrides the AO clip box. Defaults to `stageClipBox()`. */
  readonly clipBox?: Box3;
  /** Bokeh focus distance, metres. Only read when the cinematic pass is enabled. */
  readonly bokehFocusM?: number;
}

/** What `buildPost` returns: `PostStack` plus B5-side diagnostics the HUD and the tests read. */
export interface KataPostStack extends PostStack {
  readonly quality: QualityTier;
  /** The passes actually instantiated, in chain order. A subsequence of `POST_PASS_ORDER`. */
  readonly instantiatedPasses: readonly string[];
  readonly mode: 'play' | 'still' | 'capture';
  /** `[3]` BokehPass. Off by default — "cinematic mode only" (§5.2). */
  setBokehEnabled(on: boolean): void;
  /** Re-aims the depth-of-field plane. No-op while bokeh is disabled. */
  setBokehFocus(distanceM: number): void;
  /** Any camera change must reset accumulation AND re-point every camera-bound pass. */
  setCamera(camera: Camera): void;
  readonly composer: EffectComposer;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Build
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** §3.13. Requires a live WebGL context. */
export function buildPost(
  r: WebGLRenderer,
  s: Scene,
  c: Camera,
  o: PostOpts = {},
): KataPostStack {
  const quality: QualityTier = o.quality ?? 'high';
  const wantAO = quality !== 'low';
  const wantBloom = quality !== 'low';

  const drawing = new Vector2();
  r.getDrawingBufferSize(drawing);

  const composer = new EffectComposer(r); // HalfFloatType by default (EffectComposer.js:71)
  const instantiated: string[] = [];

  /* ── [1] RenderPass. ALWAYS. ──────────────────────────────────────────────────────────────── */
  const renderPass = new RenderPass(s, c);
  composer.addPass(renderPass);
  instantiated.push('RenderPass');

  /* ── [2] GTAOPass. NOT OPTIONAL at high/max: it is what produces the crease where the gi meets
   *        the floor and where the rear heel meets the boards (§5.5). ─────────────────────────── */
  let gtao: GTAOPass | null = null;
  if (wantAO) {
    // @types/three types only the 5-argument constructor, while the JS accepts 7 and merely forwards
    // arguments 6 and 7 to updateGtaoMaterial / updatePdMaterial (GTAOPass.js:229, :235). Calling
    // those two explicitly is identical and type-safe.
    gtao = new GTAOPass(s, c, drawing.x, drawing.y);
    gtao.updateGtaoMaterial({
      radius: POST.gtaoRadiusM.v, // 0.30 m world
      distanceExponent: POST.gtaoDistanceExponent.v, // 1.0
      thickness: POST.gtaoThickness.v, // 1.0
      distanceFallOff: POST.gtaoDistanceFallOff.v, // 1.0
      scale: POST.gtaoScale.v, // 1.15
      samples: POST.gtaoSamples.v, // 24 => shader DIRECTIONS 3, STEPS 8
      // World-space, not screen-space: the orbit distance is clamped to 1.6..9.0 m (doc 05 §13), so a
      // fixed world radius keeps the crease the same physical size at every orbit distance.
      screenSpaceRadius: false,
    });
    gtao.updatePdMaterial({
      lumaPhi: POST.pdLumaPhi.v, // 10
      depthPhi: POST.pdDepthPhi.v, // 2
      normalPhi: POST.pdNormalPhi.v, // 3
      radius: POST.pdRadius.v, // 6 px
      radiusExponent: POST.pdRadiusExponent.v, // 2
      rings: POST.pdRings.v, // 2
      samples: POST.pdSamples.v, // 16
    });
    gtao.blendIntensity = POST.gtaoBlendIntensity.v; // 0.85
    gtao.setSceneClipBox(o.clipBox ?? stageClipBox());
    composer.addPass(gtao);
    instantiated.push('GTAOPass');
  }

  /* ── [3] BokehPass. Built but DISABLED: "cinematic mode only". `maxblur` is ALWAYS explicit —
   *        the ctor default is 1.0 and the shader default 0.01, a 100x gap (doc 05 §14.1 #21). ── */
  const bokeh = new BokehPass(s, c, {
    focus: o.bokehFocusM ?? 3.0,
    aperture: POST.bokehAperture.v, // 0.0018
    maxblur: POST.bokehMaxblur.v, // 0.006
  });
  bokeh.enabled = false;
  composer.addPass(bokeh);
  instantiated.push('BokehPass');

  /* ── [4] UnrealBloomPass. `resolution` MUST be the canvas size: the 256x256 ctor default
   *        mis-spaces the 5-mip chain and the bloom reads as a uniform haze. ────────────────── */
  let bloom: UnrealBloomPass | null = null;
  if (wantBloom) {
    bloom = new UnrealBloomPass(
      new Vector2(drawing.x, drawing.y),
      POST.bloomStrength.v, // 0.22 — a dojo is not a sci-fi scene
      POST.bloomRadius.v, // 0.55
      POST.bloomThreshold.v, // 0.92 — only the shoji highlight and the gi specular bloom
    );
    composer.addPass(bloom);
    instantiated.push('UnrealBloomPass');
  }

  /* ── [5] SMAAPass. No arguments; it auto-sizes via setSize. Its area/search LUTs are embedded
   *        base64 (`SMAAPass.js:54`), so there is NO network fetch — project constraint 2. ───── */
  const smaa = new SMAAPass();
  composer.addPass(smaa);
  instantiated.push('SMAAPass');

  /* ── [6] OutputPass. MANDATORY. Tone map + sRGB encode, read off the renderer. ────────────── */
  const output = new OutputPass();
  composer.addPass(output);
  instantiated.push('OutputPass');

  /* ── [7] LUTPass. Declared, not instantiated. See the header. ─────────────────────────────── */

  // Internal consistency: what we built must be exactly what the tier plan says, in that order.
  const planned = plannedPasses(quality);
  if (instantiated.length !== planned.length || instantiated.some((n, i) => n !== planned[i])) {
    throw new Error(
      `render/post.ts: chain [${instantiated.join(' -> ')}] disagrees with plannedPasses('${quality}')` +
        ` = [${planned.join(' -> ')}]. §5.2's order is a hard constraint, not a preference.`,
    );
  }

  const still = new StillAccumulator(
    r,
    c,
    quality === 'low' ? STILL_SAMPLES_LOW : STILL_SAMPLES,
  );
  still.setSize(drawing.x, drawing.y);

  let mode: 'play' | 'still' | 'capture' = 'play';
  let disposed = false;

  const stack: KataPostStack = {
    quality,
    instantiatedPasses: Object.freeze([...instantiated]),
    composer,

    get mode() {
      return mode;
    },
    get stillSample() {
      return still.sample;
    },
    get stillConverged() {
      return still.converged;
    },

    setMode(next): void {
      if (next === mode) return;
      mode = next;
      // Switching in either direction invalidates whatever was accumulated.
      still.reset();
    },

    resetStill(): void {
      still.reset();
    },

    setBokehEnabled(on): void {
      bokeh.enabled = on;
      still.reset();
    },

    setBokehFocus(distanceM): void {
      const u = bokeh.uniforms as unknown as Record<string, { value: number } | undefined>;
      const focus = u['focus'];
      if (focus !== undefined) focus.value = distanceM;
      still.reset();
    },

    setCamera(next): void {
      renderPass.camera = next;
      bokeh.camera = next;
      if (gtao !== null) gtao.camera = next;
      still.setCamera(next);
    },

    render(dtSeconds): void {
      if (disposed) throw new Error('render/post.ts: render() after dispose().');
      if (mode === 'play') {
        composer.renderToScreen = true;
        composer.render(dtSeconds);
        // Playing invalidates any partial still, so a pause always starts a clean accumulation.
        if (still.sample !== 0) still.reset();
        return;
      }
      // 'still' (interactive, one sample per display frame) and 'capture' (settle() loops until
      // converged) are the SAME code path — that is what makes the interactive still and the
      // captured PNG bit-identical at convergence.
      if (!still.converged) still.accumulate(composer, dtSeconds);
      still.present();
    },

    setSize(w, h, dpr): void {
      const pr = Math.min(dpr, MAX_PIXEL_RATIO);
      r.setPixelRatio(pr);
      r.setSize(w, h);
      // BOTH, in this order: setPixelRatio re-runs setSize internally with the new ratio
      // (EffectComposer.js:342), so it must come last to be authoritative (doc 05 §14.1 #22).
      composer.setSize(w, h);
      composer.setPixelRatio(pr);
      // UnrealBloomPass.resolution and GTAOPass's RTs are updated by composer.setSize -> pass.setSize.
      still.setSize(Math.round(w * pr), Math.round(h * pr));
      still.reset();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      still.dispose();
      for (const p of composer.passes) p.dispose();
      composer.dispose();
    },
  };

  return stack;
}
