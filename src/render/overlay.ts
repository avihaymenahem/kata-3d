/**
 * B5 RENDER — `src/render/overlay.ts`  —  **PHASE 4. INERT, BY DESIGN.**
 *
 * `buildOverlay`: the four debug layers — skeleton, COM, support polygon, embusen trace.
 * ARCHITECTURE.md §4.5; `OverlayHandle` is §3.4.1.
 *
 * ── WHY THIS ONE IS INERT INSTEAD OF THROWING ─────────────────────────────────────────────────
 * `silhouette.ts` and `clothBridge.ts` throw, because a fake return value from either would be
 * consumed as a real measurement. This file is different in kind: an overlay with no geometry in it is
 * a WELL-DEFINED empty overlay, and `setVisible('com', true)` on an empty overlay has an obvious and
 * honest meaning — nothing becomes visible, and `isVisible` says so. Throwing here would only stop B6
 * and B8 from wiring their call sites in Phase 2 for no safety benefit, since a missing debug line is
 * self-evident on screen the moment anyone toggles it.
 *
 * `built` is exposed so a caller (or `tests/render/config.test.ts`) can distinguish "the overlay is
 * empty because it is Phase 4" from "the overlay is empty because everything is toggled off". That
 * distinction is the whole reason an inert stub is acceptable at all.
 *
 * ── WHAT PHASE 4 MUST DO ──────────────────────────────────────────────────────────────────────
 *  * `skeleton` — 52 bones as `LineSegments` with `M_DEBUG` (`toneMapped: false`,
 *    `depthTest: false`), rebuilt per frame from `rig.bones[i].matrixWorld`. `SkeletonHelper` exists
 *    (doc 05 §9.1) but draws every bone including the seven leaf terminators, at a fixed colour.
 *  * `com` — whole-body COM projected to the floor, from `Landmarks.comXZ` (§3.10). doc 06 §2.2's
 *    solve already produced it; do not recompute it here or the overlay and the solver can disagree,
 *    which is precisely the bug an overlay is supposed to expose.
 *  * `support` — the support polygon from the two feet's plant state (`chan.plantL` / `plantR`), which
 *    is what makes doc 01 §9's balance faults (the K-family) legible.
 *  * `embusen` — THE PER-KATA POLYLINE. It belongs here, not in `stage.ts`: it is asymmetric in x, so
 *    drawing it requires already-world-correct coordinates, and B1's `embusenPolyline(kata)` supplies
 *    exactly that. `stage.ts`'s decal is deliberately limited to mirror-symmetric guides so that no
 *    second authored->world x conversion exists anywhere outside `src/solve/frame.ts` (§2.1).
 *
 * `M_DEBUG` (`materials.ts`) is already the right material for all four: `LineBasicMaterial`,
 * `toneMapped: false`, so debug geometry never picks up the AgX curve and never blooms.
 */

import type { Scene } from 'three';

export type OverlayLayer = 'skeleton' | 'com' | 'support' | 'embusen';

/**
 * §3.4.1, VERBATIM (`setVisible(k: 'skeleton'|'com'|'support'|'embusen', v: boolean): void`).
 * Declared in B5's barrel, per §3.4.1's own instruction. `OverlayLayer` names the frozen key union so
 * B8's GUI can enumerate it instead of restating it.
 */
export interface OverlayHandle {
  setVisible(k: OverlayLayer, v: boolean): void;
}

/** Extends the frozen `OverlayHandle` so a caller can tell "empty" from "off". */
export interface KataOverlayHandle extends OverlayHandle {
  /** `false` for the whole of Phase 1-3: no debug geometry has been built yet. */
  readonly built: boolean;
  isVisible(k: OverlayLayer): boolean;
}

/**
 * §3.13. **Phase 4.** Returns a real, inert handle: the visibility flags are tracked faithfully and
 * nothing is drawn, because nothing has been built. See the file header for why this one does not
 * throw.
 */
export function buildOverlay(_s: Scene): KataOverlayHandle {
  const visible: Record<OverlayLayer, boolean> = {
    skeleton: false,
    com: false,
    support: false,
    embusen: false,
  };
  return {
    built: false,
    setVisible(k, v): void {
      visible[k] = v;
    },
    isVisible(k): boolean {
      return visible[k];
    },
  };
}
