/**
 * B5 RENDER — `src/render/ibl.ts`
 *
 * `buildEnvironment`: bake the procedural dojo scene of `dojoEnv.ts` into a PMREM and install it as
 * `scene.environment`. ARCHITECTURE.md §5.1 boot step 7; doc 05 §7.1 / §7.3.
 *
 * NO HDR FILE, NO DOWNLOAD, NO NETWORK. `PMREMGenerator.fromScene` renders our own `Scene` through
 * an internal cube camera — this is the "no external HDR" answer doc 05 §7.2 identifies, and it is
 * fully deterministic because the source scene is authored geometry.
 *
 * ── THE FOUR TRAPS THIS FILE IS BUILT AROUND ──────────────────────────────────────────────────
 *
 * 1. **`pmrem.dispose()` frees the GENERATOR, not the render target** (doc 05 §14.1 #29,
 *    `PMREMGenerator.js:205-210`). `fromScene` hands back a `WebGLRenderTarget` that WE own. Losing
 *    the reference leaks 6 cube faces of half-float for the life of the page; disposing it while
 *    `scene.environment` still points at its texture renders the whole figure black. So the RT is
 *    captured in the closure and freed only by `IblHandle.dispose()`, which also clears
 *    `scene.environment` first.
 *
 * 2. **Exactly one `PMREMGenerator` may exist at a time** (doc 05 §14.1 #30 — the class behaves
 *    like a singleton and `dispose()` on one instance can break another). `LIVE` below is a hard
 *    guard: a second concurrent generator throws instead of silently corrupting the first bake.
 *
 * 3. **`material.envMap` silently overrides `scene.environment`**, after which
 *    `scene.environmentIntensity` stops applying entirely (doc 05 §14.1 #11,
 *    `WebGLRenderer.js:2344`). This is why `materials.ts` never assigns `envMap` and why
 *    `.envMap =` is grep-banned project-wide. There is exactly ONE global environment knob and it
 *    lives here.
 *
 * 4. **`scene.background` must NOT be the raw PMREM** (doc 05 §7.3). Showing the crude procedural
 *    room as the visible backdrop looks cheap; §5.1 sets a flat `0x0e0f12` and `stage.ts` puts a
 *    real gradient shell in front of it.
 *
 * `scene.environment` only reaches `MeshStandardMaterial` / `MeshLambertMaterial` /
 * `MeshPhongMaterial` (doc 05 §14.1 #12, `WebGLRenderer.js:2341`) — `MeshPhysicalMaterial` extends
 * Standard, so the gi and skin are covered. Nothing in the scene graph is a `ShaderMaterial`, which
 * §5.2 requires anyway for GTAO's `MeshNormalMaterial` G-buffer.
 *
 * And doc 05 §14.1 #14: `sheen` is nearly invisible WITHOUT `scene.environment`. Tune sheen after
 * this file has run, never before.
 */

import {
  Color,
  Euler,
  PMREMGenerator,
  Vector3,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

import { ENV, ENV_COLOR_HEX } from '../data';
import { buildDojoEnvScene, type DojoEnvOpts } from './dojoEnv';

/**
 * §3.4.1, VERBATIM. Declared in B5's barrel, per §3.4.1's own instruction.
 *
 * `dispose()` frees the `WebGLRenderTarget` `PMREMGenerator.fromScene` handed us — the thing
 * `pmrem.dispose()` does NOT free (doc 05 §14.1 #29). See trap 1 in the header below.
 */
export interface IblHandle {
  readonly texture: Texture;
  dispose(): void;
}

/** doc 05 §14.1 #30 — one generator, ever. Incremented for the life of a bake, then released. */
let LIVE = 0;

export interface IblOpts extends DojoEnvOpts {
  /** PMREM cube-face size. `512` (`ENV.pmremSize`) buys visibly cleaner gi/skin specular over 256. */
  readonly size?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * TRAP 5, FOUND BY RUNNING IT: doc 05 §7.3's OWN TABLE RECOMMENDS A CLIPPING sigma
 *
 * doc 05 §7.3 recommends `size: 512` AND `sigma: 0.04` in adjacent rows. Booting that combination in
 * three@0.185.1 logs, on every page load, twice:
 *
 *   THREE.sigmaRadians, 0.04, is too large and will clip, as it requested 40 samples when the
 *   maximum is set to 20
 *
 * The arithmetic, from `PMREMGenerator.js:606-645`:
 *   MAX_SAMPLES        = 20                              (:36)
 *   STANDARD_DEVIATIONS = 3                              (:619)
 *   pixels             = sizeLods[0] - 1 = size - 1      (:626)
 *   radiansPerPixel    = PI / (2 * pixels)               (:627)
 *   sigmaPixels        = sigmaRadians / radiansPerPixel  (:628)
 *   samples            = 1 + floor(3 * sigmaPixels)      (:629)   -> warns if > 20
 *
 * At `size = 256` (the ctor default): `radiansPerPixel = PI/510 = 6.1601e-3`, so sigma 0.04 gives
 * `samples = 1 + floor(3 * 6.4934) = 20`. EXACTLY at the limit. doc 05's 0.04 is calibrated for the
 * DEFAULT size — and then the very next row of the same table doubles the size to 512, which HALVES
 * the allowed sigma and puts the recommended value at exactly 2x the ceiling.
 *
 * The consequence is not cosmetic. The weight loop at `:642` still runs only `MAX_SAMPLES` taps, so
 * the Gaussian is truncated at `20 / sigmaPixels = 1.54` standard deviations instead of 3, then
 * renormalised. The blur therefore ends up NARROWER and harder-edged than the value asks for — which
 * is the opposite of what the sigma exists to do ("remove the hard edges of our procedural emitter
 * quads") — while also breaking §8's Phase-6 exit gate, "zero console warnings".
 *
 * B5's answer: clamp to the engine's own derived ceiling for the chosen size. This is NOT an art
 * decision and NOT a B5 override of a B1 constant — it is the largest sigma at which the engine
 * actually delivers the full 3-sigma kernel `ENV.pmremSigma` is asking for. The clamp is derived, not
 * authored, and `PMREM_SIGMA_CLAMPED` records whether it fired. Raised as a handoff to B1 so the
 * constant itself can be reconciled with the size.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** `PMREMGenerator.js:36`. Mirrored, not imported: it is a module-private constant. */
export const PMREM_MAX_SAMPLES = 20;
/** `PMREMGenerator.js:619`. */
export const PMREM_STANDARD_DEVIATIONS = 3;

/**
 * The largest `sigmaRadians` at which `PMREMGenerator._halfBlur` still fits its whole kernel inside
 * `MAX_SAMPLES` taps for a given cube-face size — i.e. the largest value that does NOT truncate the
 * Gaussian and does NOT log a warning.
 *
 * Solving `1 + floor(STANDARD_DEVIATIONS * sigma / radiansPerPixel) <= MAX_SAMPLES` gives
 * `sigma <= ((MAX_SAMPLES - 1) / STANDARD_DEVIATIONS) * radiansPerPixel`, which lands `samples`
 * exactly on `MAX_SAMPLES`. PURE, and asserted in `tests/render/config.test.ts` against the numbers
 * for 256 and 512.
 */
export function maxPmremSigma(size: number): number {
  const lodMax = Math.floor(Math.log2(size));
  const pixels = Math.pow(2, lodMax) - 1;
  const radiansPerPixel = Math.PI / (2 * pixels);
  return ((PMREM_MAX_SAMPLES - 1) / PMREM_STANDARD_DEVIATIONS) * radiansPerPixel;
}

/** True after `buildEnvironment` if `ENV.pmremSigma` had to be clamped. Read by the HUD / handoff. */
export let PMREM_SIGMA_CLAMPED: { readonly authored: number; readonly used: number } | null = null;

/**
 * §3.13. Builds the PMREM, installs it on `scene`, and returns the handle that owns the render
 * target. Requires a live WebGL context (the bake is 6 real cube renders), so this is the one file
 * in the IBL path that cannot run in the Node/GL-free channel.
 */
export function buildEnvironment(r: WebGLRenderer, s: Scene, o: IblOpts = {}): IblHandle {
  if (LIVE !== 0) {
    throw new Error(
      'render/ibl.ts: a PMREMGenerator is already live. doc 05 §14.1 #30 — the class behaves like ' +
        'a singleton and dispose() on one instance can break another. Dispose the previous ' +
        'IblHandle before building a second environment.',
    );
  }

  const dojo = buildDojoEnvScene(o);
  const pmrem = new PMREMGenerator(r);
  LIVE++;

  const size = o.size ?? ENV.pmremSize.v;
  const sigmaCeiling = maxPmremSigma(size);
  const sigma = Math.min(ENV.pmremSigma.v, sigmaCeiling);
  PMREM_SIGMA_CLAMPED =
    sigma < ENV.pmremSigma.v ? { authored: ENV.pmremSigma.v, used: sigma } : null;

  let rt;
  try {
    rt = pmrem.fromScene(dojo.scene, sigma, ENV.pmremNearM.v, ENV.pmremFarM.v, {
      size,
      // Capture at the karateka's CHEST (0.55 H), not at the floor: an eye-level capture is what
      // makes the warm floor bounce reach the underside of the jaw and the inside of the gi skirt.
      position: new Vector3(0, ENV.capturePosYM.v, 0),
    });
  } finally {
    // The generator is finished with either way; only the RT must survive.
    pmrem.dispose();
    LIVE--;
    dojo.dispose();
  }

  s.environment = rt.texture;
  s.environmentIntensity = ENV.environmentIntensity.v;
  // Radians. Rotating the brightest window off-axis is what keeps the gi's specular from sitting
  // dead centre on every orbit angle. This is an ENVIRONMENT rotation, not a character yaw, so
  // §2.1's "nothing else may negate a yaw" does not reach here (see ENV.environmentRotationY).
  s.environmentRotation = new Euler(0, ENV.environmentRotationY.v, 0);

  // NEVER the raw PMREM (trap 4). stage.ts adds the gradient shell in front of this.
  s.background = new Color(ENV_COLOR_HEX.background);
  s.backgroundIntensity = ENV.backgroundIntensity.v;
  s.backgroundBlurriness = ENV.backgroundBlurriness.v;

  let disposed = false;
  return {
    texture: rt.texture,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Order matters: drop the reference before freeing the GPU memory behind it.
      if (s.environment === rt.texture) s.environment = null;
      rt.dispose();
    },
  };
}
