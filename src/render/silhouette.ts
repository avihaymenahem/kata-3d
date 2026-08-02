/**
 * B5 RENDER — `src/render/silhouette.ts`  —  **PHASE 4. DOCUMENTED STUB.**
 *
 * `renderSilhouette`: `scene.overrideMaterial = M_MASK`, render, read back a white-on-black mask.
 * ARCHITECTURE.md §4.5; consumed by metric 60 `silhouette_IoU` via `KataHarness.silhouette()`.
 *
 * ── WHY THIS IS A THROWING STUB AND NOT A NO-OP ───────────────────────────────────────────────
 * The signature returns `ImageData`. There is no honest empty value: a blank mask would make
 * `silhouetteIou(ours, ref)` return `0.0`, which metric 60 would report as a real measurement of a
 * real figure — and metric 60 ships `armed: false` precisely because its thresholds are admittedly
 * invented (§9.2 defect S-4), so nothing downstream would flag the zero as impossible. A throw is
 * the only truthful option. §8 schedules this file for Phase 4; B5's Phase-1 scope is
 * `renderer, dojoEnv, ibl, lights, materials, stage, post, still`.
 *
 * ── WHAT PHASE 4 MUST DO ──────────────────────────────────────────────────────────────────────
 *  1. Bypass the composer entirely — a mask must not be tone-mapped, bloomed, AO'd or antialiased.
 *     `M_MASK` already ships `toneMapped: false` for exactly this reason (`materials.ts`).
 *  2. `const prev = scene.overrideMaterial; scene.overrideMaterial = mats.M_MASK;` then render to an
 *     offscreen `WebGLRenderTarget` sized to the harness canvas (1024 x 1024 at DPR 1,
 *     `HARNESS_CANVAS_PX`), then restore `prev`.
 *  3. Hide the stage: `M_MASK` over the floor, backdrop and embusen decal would fill the frame
 *     white. `StageHandle` exists so those three meshes can be toggled by reference rather than by
 *     name matching.
 *  4. `renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf)` -> `new ImageData(...)`, remembering
 *     that GL reads bottom-up while `ImageData` is top-down.
 *  5. Clear the black background explicitly; `scene.background` is a `Color`, and an override
 *     material does not replace the background.
 *
 * `tools/calibrate-envelope.mjs` (B9, Phase 3) must have run and metric 60 must be armed by an
 * integrator commit citing that calibration report before any of this can gate anything (§9.2 S-4).
 */

import type { Camera, Scene, WebGLRenderer } from 'three';

import { notYetPhase4 } from './phase';

/** §3.13. **Phase 4.** Throws until implemented — see the file header. */
export function renderSilhouette(_r: WebGLRenderer, _s: Scene, _c: Camera): ImageData {
  return notYetPhase4(
    'renderSilhouette',
    'src/render/silhouette.ts',
    'metric 60 silhouette_IoU / KataHarness.silhouette()',
  );
}
