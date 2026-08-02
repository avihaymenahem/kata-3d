/**
 * B5 RENDER — `src/render/still.ts`
 *
 * `StillAccumulator`: OUR OWN Halton(2,3) camera view-offset jitter, applied at the COMPOSER level.
 * ARCHITECTURE.md §5.3, §1 change 4, §9.2 defect S-1.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS TO FIX — RE-VERIFIED IN THE INSTALLED three@0.185.1 TREE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The two accumulation passes that ship in `three/examples/jsm/postprocessing/` both release the
 * camera's view offset before they return:
 *
 *   * `SSAARenderPass.js:250-260` restores the caller's ORIGINAL view offset if there was one, and
 *     `SSAARenderPass.js:262-264` otherwise calls `this.camera.clearViewOffset()`;
 *   * `TAARenderPass.js:166` calls `if ( this.camera.clearViewOffset ) this.camera.clearViewOffset();`
 *     UNCONDITIONALLY — it does not save or restore anything.
 *
 * And `GTAOPass.js:642` runs its OWN `renderer.render( this.scene, this.camera )` to build the
 * depth/normal G-buffer, reading whatever view offset the camera happens to carry at that moment.
 *
 * Put those together in the §5.2 chain, where the accumulation pass would sit at position [1] and
 * GTAO at position [2]: on a paused frame the COLOUR term converges over 32 jittered samples while
 * the AO term is computed unjittered and BIT-IDENTICAL on every accumulation frame. The contact
 * crease — which all three proposals called "the single biggest AAA-vs-hobby delta" — stays
 * hard-aliased forever, and it gets worse the longer you look at it, because the colour softens
 * around a razor-edged occlusion term. No proposal noticed.
 *
 * THE FIX: own the jitter one level up. `setViewOffset` -> `composer.render()` -> additive blit ->
 * `clearViewOffset`. Every pass that reads `camera` sees the same offset, INCLUDING GTAO's internal
 * render, so the AO term is jittered in lockstep with the colour term.
 *
 * `TAARenderPass` and `SSAARenderPass` are consequently removed from the project entirely and both
 * names are grep-banned (`tools/verify-contracts.mjs` ban `TAA_SSAA`, `tests/render/bans.test.ts`).
 *
 * ── BONUS: DETERMINISM ────────────────────────────────────────────────────────────────────────
 * Sample `k` is a pure function of `k`, so a captured PNG is a pure function of
 * `(tick, camera, trackHash, layerWeights)` and accumulation leaves the determinism ledger entirely
 * (§6.3). It also resolves the per-pixel IGN-rotated Vogel dither r185's PCF applies to a static
 * frame (doc 05 §6.2, §14.1 #3) — which was the accumulation pass's other job.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE OFFSETS ARE MEAN-CENTRED AND NOT `halton(k+1, b) - 0.5`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §5.3 writes `jitter_k = (halton(k+1,2) - 0.5, halton(k+1,3) - 0.5)`, and §4.5 requires
 * `tests/render/still.test.ts` to prove "the 32-sample offset set sums to (0,0) within 1e-9". Those
 * two statements are not simultaneously satisfiable, and the arithmetic says which one to keep:
 *
 *   base 2, i = 1..32: i = 1..31 is a complete permutation of {1/32 .. 31/32}, summing to 15.5;
 *                      i = 32 adds radicalInverse(32) = 1/64. Total 15.515625, mean 0.48486328125.
 *   base 3, i = 1..32: i = 1..26 is a complete permutation of {1/27 .. 26/27}, summing to 13.0;
 *                      i = 27..32 add (1 + 28 + 55 + 10 + 37 + 64)/81 = 195/81. Total 15.40740...,
 *                      mean 0.481481...
 *
 * Subtracting 0.5 therefore leaves a residual mean of `(-0.01514, -0.01852)` px — a FIXED sub-pixel
 * translation baked into every accumulated still. That is not cosmetic: the four `M_*` cameras are
 * ORTHOGRAPHIC MEASUREMENT cameras (§5.7 — "perspective foreshortening corrupts every length metric
 * read off an image"), and metric 60 `silhouette_IoU` plus metric 61 `contact_shadow_present` are
 * read off exactly those frames. A systematic half-hundredth-of-a-pixel shear in one direction is a
 * bias in a measurement instrument.
 *
 * So the offsets are the Halton set MINUS ITS OWN MEAN over the sample count in use. That keeps the
 * stratification (which is the whole point of Halton), keeps sample `k` a pure function of
 * `(k, count)`, and makes the set sum to exactly zero. `stillJitter` documents the substitution at
 * the call site.
 *
 * ── COST ──────────────────────────────────────────────────────────────────────────────────────
 * 32 chain renders per still. Interactive paused view: one sample per display frame, so a still
 * resolves in ~0.53 s and is visibly progressive; `PostStack.stillSample` / `.stillConverged` drive
 * the HUD. `fast` capture profile ~0.35 s/frame on SwiftShader, `hero` 1.5-4 s/frame (§5.3).
 */

import {
  AdditiveBlending,
  HalfFloatType,
  NoBlending,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';

import { STILL_SAMPLES } from '../contracts';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Halton — pure, exported, and the subject of tests/render/still.test.ts
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Radical inverse of `index` in `base` — the standard van der Corput / Halton construction.
 * `halton(0, b) === 0` for every base; the sequence is normally consumed from index 1.
 *
 * PURE: no state, no clock, no allocation.
 */
export function halton(index: number, base: number): number {
  if (!Number.isFinite(index) || index < 0) {
    throw new Error(`still.ts: halton index must be a finite non-negative number, got ${index}`);
  }
  if (!Number.isInteger(base) || base < 2) {
    throw new Error(`still.ts: halton base must be an integer >= 2, got ${base}`);
  }
  let f = 1;
  let r = 0;
  let i = Math.floor(index);
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Memoised per-count means of the Halton(2,3) prefix. See the header for why they are not 0.5. */
const MEAN_CACHE = new Map<number, readonly [number, number]>();

/** Mean of `halton(k+1, {2,3})` over `k = 0 .. count-1`. Pure function of `count`. */
export function haltonMean(count: number): readonly [number, number] {
  const hit = MEAN_CACHE.get(count);
  if (hit !== undefined) return hit;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < count; k++) {
    sx += halton(k + 1, 2);
    sy += halton(k + 1, 3);
  }
  const mean = Object.freeze([sx / count, sy / count]) as readonly [number, number];
  MEAN_CACHE.set(count, mean);
  return mean;
}

/**
 * Sub-pixel view offset for accumulation sample `k`, in PIXELS, in `[-0.5, 0.5]`-ish.
 *
 * §5.3's `- 0.5` is replaced by `- haltonMean(count)` so the set sums to exactly zero; the header
 * carries the arithmetic and the reason. PURE function of `(k, count)`.
 */
export function stillJitter(k: number, count: number = STILL_SAMPLES): readonly [number, number] {
  const [mx, my] = haltonMean(count);
  return [halton(k + 1, 2) - mx, halton(k + 1, 3) - my];
}

/** The whole offset set, for tests and for the HUD's jitter read-out. */
export function stillJitterSet(
  count: number = STILL_SAMPLES,
): readonly (readonly [number, number])[] {
  return Object.freeze(Array.from({ length: count }, (_, k) => stillJitter(k, count)));
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The accumulator
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Minimal structural view of the two camera classes that carry a view offset.
 * `PerspectiveCamera` and `OrthographicCamera` both implement these; the base `Camera` does not, and
 * §3.12's `CameraRig.camera` is typed as `Camera`. Feature-detected, never blind-cast.
 */
interface ViewOffsetCamera {
  setViewOffset(
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  clearViewOffset(): void;
}

const hasViewOffset = (c: Camera): c is Camera & ViewOffsetCamera =>
  typeof (c as unknown as ViewOffsetCamera).setViewOffset === 'function' &&
  typeof (c as unknown as ViewOffsetCamera).clearViewOffset === 'function';

/**
 * `tDiffuse * weight`, additively blended into the accumulation target.
 *
 * This is a FULLSCREEN pass, not a scene object, so §5.6's "zero `ShaderMaterial` in the scene
 * graph" is untouched and `GTAOPass`'s `MeshNormalMaterial` G-buffer is unaffected (§5.2: "Post-
 * processing passes are not in the scene graph; the ban does not apply to them"). It also contains
 * no `onBeforeCompile` — it is a complete shader pair, not a patched built-in.
 */
const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const ADD_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float weight;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D( tDiffuse, vUv ) * weight;
  }
`;

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D( tDiffuse, vUv );
  }
`;

export class StillAccumulator {
  private readonly renderer: WebGLRenderer;
  private camera: Camera;
  private samples: number;
  private accum: WebGLRenderTarget;
  private readonly addMat: ShaderMaterial;
  private readonly copyMat: ShaderMaterial;
  private readonly addQuad: FullScreenQuad;
  private readonly copyQuad: FullScreenQuad;
  private readonly size = new Vector2(1, 1);
  private k = 0;
  private cleared = false;
  private disposed = false;

  constructor(renderer: WebGLRenderer, camera: Camera, samples: number = STILL_SAMPLES) {
    if (!Number.isInteger(samples) || samples < 1) {
      throw new Error(`still.ts: samples must be a positive integer, got ${samples}`);
    }
    this.renderer = renderer;
    this.camera = camera;
    this.samples = samples;

    // HalfFloatType, per §5.3. A 1/32 weight into an 8-bit target would band the whole still.
    this.accum = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.accum.texture.name = 'StillAccumulator.accum';

    // Uniforms are built PER INSTANCE. A shared module-level uniform object would silently couple
    // two accumulators (the harness builds one per PostStack) to the same texture and weight.
    this.addMat = new ShaderMaterial({
      name: 'StillAccumulator.add',
      uniforms: { tDiffuse: { value: null }, weight: { value: 1 / samples } },
      vertexShader: FS_VERT,
      fragmentShader: ADD_FRAG,
      // WebGLState.js:765-767 applies `setBlending(material.blending, ...)` for any blending other
      // than NormalBlending regardless of `transparent`, so AdditiveBlending is live here.
      blending: AdditiveBlending,
      // ══ premultipliedAlpha IS LOAD-BEARING. FOUND BY RENDERING IT. ══════════════════════════
      // `WebGLState.js` resolves AdditiveBlending two completely different ways:
      //   premultipliedAlpha true  (:652) -> gl.blendFunc( ONE, ONE )                  pure add
      //   premultipliedAlpha false (:678) -> gl.blendFuncSeparate( SRC_ALPHA, ONE, ... )
      // The fragment shader below writes `texture2D(...) * weight`, which scales RGB *and* ALPHA by
      // `weight`. Under the `false` branch the blend then multiplies RGB by that same alpha a SECOND
      // time, so 32 samples at weight 1/32 accumulate to 1/1024 of the image instead of 1/1: every
      // still and every captured PNG comes out ~30x too dark while play mode looks perfectly fine.
      // It is invisible to `tsc`, to the pass-order test, and to every G1-G4 metric (none read
      // pixels). Measured before/after: mean luma 3.7 -> 117 on the same frame.
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new ShaderMaterial({
      name: 'StillAccumulator.copy',
      uniforms: { tDiffuse: { value: null } },
      vertexShader: FS_VERT,
      fragmentShader: COPY_FRAG,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.addQuad = new FullScreenQuad(this.addMat);
    this.copyQuad = new FullScreenQuad(this.copyMat);
  }

  /** Number of samples already accumulated, `0 .. sampleCount`. Drives `PostStack.stillSample`. */
  get sample(): number {
    return this.k;
  }

  get sampleCount(): number {
    return this.samples;
  }

  get converged(): boolean {
    return this.k >= this.samples;
  }

  /** The jitter offset this accumulator will use next. Exposed for the HUD and for tests. */
  get nextJitter(): readonly [number, number] {
    return stillJitter(Math.min(this.k, this.samples - 1), this.samples);
  }

  /**
   * The additive blit material. Exposed READ-ONLY so `tests/render/still.test.ts` can pin
   * `blending`/`premultipliedAlpha` without a GL context — see the constructor comment for why that
   * pair is the difference between a correct still and a 30x-too-dark one.
   */
  get additiveMaterial(): ShaderMaterial {
    return this.addMat;
  }

  /** The present blit material. Must NOT blend and must NOT re-encode (OutputPass already did). */
  get presentMaterial(): ShaderMaterial {
    return this.copyMat;
  }

  /**
   * §5.3: "Any change to tick, camera, layer weight, quality tier or canvas size calls
   * `resetStill()`." Cheap — it only marks the target for clearing on the next sample.
   */
  reset(): void {
    this.k = 0;
    this.cleared = false;
  }

  /** Quality-tier change: `low` uses 12 samples (§6.6). Always resets. */
  setSampleCount(samples: number): void {
    if (!Number.isInteger(samples) || samples < 1) {
      throw new Error(`still.ts: samples must be a positive integer, got ${samples}`);
    }
    this.samples = samples;
    this.reset();
  }

  /** Camera change (including every `snapTo`) invalidates the accumulation completely. */
  setCamera(camera: Camera): void {
    this.camera = camera;
    this.reset();
  }

  /** `wPx`/`hPx` are DRAWING-BUFFER pixels, so one jitter unit is one device pixel. */
  setSize(wPx: number, hPx: number): void {
    const w = Math.max(1, Math.floor(wPx));
    const h = Math.max(1, Math.floor(hPx));
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    this.accum.setSize(w, h);
    this.reset();
  }

  /**
   * Render ONE jittered sample of the whole composer chain into the accumulation target.
   *
   * The offset is set BEFORE `composer.render` and cleared AFTER, which is the entire point: pass [1]
   * `RenderPass`, pass [2] `GTAOPass` (including its own internal `renderer.render` at
   * `GTAOPass.js:642`) and pass [3] `BokehPass`'s depth pass all read the same jittered camera.
   *
   * No-op once converged, so `settle()` can call it in a loop without a guard.
   */
  accumulate(composer: EffectComposer, deltaTime: number): void {
    if (this.disposed) throw new Error('still.ts: accumulate() after dispose().');
    if (this.converged) return;

    const cam = this.camera;
    const jittered = hasViewOffset(cam);
    if (jittered) {
      const [jx, jy] = stillJitter(this.k, this.samples);
      cam.setViewOffset(this.size.x, this.size.y, jx, jy, this.size.x, this.size.y);
    }

    // renderToScreen = false keeps the chain result in `composer.readBuffer` so we can blit it.
    const wasToScreen = composer.renderToScreen;
    composer.renderToScreen = false;
    try {
      composer.render(deltaTime);
    } finally {
      composer.renderToScreen = wasToScreen;
      if (jittered) cam.clearViewOffset();
    }

    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    this.renderer.setRenderTarget(this.accum);
    if (!this.cleared) {
      // One clear per accumulation run: additive blending needs a known-zero starting point.
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, false, false);
      this.cleared = true;
    }
    this.addMat.uniforms.tDiffuse!.value = composer.readBuffer.texture;
    this.addMat.uniforms.weight!.value = 1 / this.samples;
    this.addQuad.render(this.renderer);

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
    this.k++;
  }

  /**
   * Blit the accumulation target to the canvas.
   *
   * No colour-space or tone-mapping work happens here, and that is correct: `OutputPass` already
   * applied `renderer.toneMapping` and the sRGB transfer inside the chain — it does so whether it
   * rendered to screen or to a buffer (`OutputPass.js:118-131`) — so `accum` already holds
   * display-referred values. Converting again would double-encode.
   */
  present(): void {
    if (this.disposed) throw new Error('still.ts: present() after dispose().');
    const prevTarget = this.renderer.getRenderTarget();
    this.copyMat.uniforms.tDiffuse!.value = this.accum.texture;
    this.renderer.setRenderTarget(null);
    this.copyQuad.render(this.renderer);
    this.renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.accum.dispose();
    this.addQuad.dispose();
    this.copyQuad.dispose();
    this.addMat.dispose();
    this.copyMat.dispose();
  }
}
