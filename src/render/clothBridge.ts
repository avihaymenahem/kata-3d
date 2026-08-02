/**
 * B5 RENDER — `src/render/clothBridge.ts`  —  **PHASE 4. DOCUMENTED STUB.**
 *
 * `uploadCloth`: B7's cloth particle arrays -> the garment `BufferAttribute`s. ARCHITECTURE.md §4.5.
 *
 * This bridge exists because `src/cloth/**` MAY NOT IMPORT `three` AT ALL (§3 import discipline,
 * enforced by `tests/contracts/imports.test.ts`). B7 solves in plain `Float32Array`s; B5 is the only
 * block allowed to turn those into GPU buffers. That boundary is what keeps the whole cloth solver
 * Node-testable (`tests/cloth/swatch.test.ts`, the jersey-vs-12-oz-canvas calibration gate).
 *
 * ── WHY THIS IS A THROWING STUB AND NOT A NO-OP ───────────────────────────────────────────────
 * A silent no-op would render a gi that is pinned to its skinned rest pose while
 * `ClothSystem.stateHash` advanced normally, `tests/cloth/impulse.test.ts` stayed green, and the
 * scorecard reported nothing wrong — because §6.4 fence 4 deliberately arranges that **no metric in
 * G1-G4 reads cloth state**. The failure would be invisible to all 55 of them and visible only to a
 * human looking at rubric items B8 / C6 / C11. That is exactly the class of bug this project's
 * ownership and gate structure exists to make impossible, so it throws.
 *
 * ── WHAT PHASE 4 MUST DO (§6.6 budget: 0.20 ms, including the inner shell) ────────────────────
 *  1. `cloth.upload()` is B7's entry point; this function is what B7's `upload()` calls into, or what
 *     the frame loop calls right after it — settle that with B7 before writing code, because calling
 *     both double-writes the buffers.
 *  2. Copy positions into `gi.<part>.geometry.attributes.position.array`, then set
 *     `attribute.needsUpdate = true`. Use `setUsage(DynamicDrawUsage)` once at build time.
 *  3. **The 0.63 mm inner shell (§5.5).** Its ring is DERIVED from the outer positions and normals in
 *     the SAME pass — `p_inner = p_outer - 0.00063 * N` — which is why §5.5 budgets +1.9 k triangles,
 *     ZERO extra draw calls (same geometry buffer) and only +0.05 ms. Writing it as a second loop over
 *     the same data is the easy way to lose that.
 *  4. Recompute normals for the simulated panels only. Do NOT call `geometry.computeVertexNormals()`
 *     on the whole garment every frame; and `BufferGeometry.computeTangents()` is grep-banned
 *     (§2.7 — it throws when `index === null`, and B4's tangents are analytic and itemSize-4).
 *  5. Write the per-vertex `wrinkle` attribute B7's `wrinkle.ts` produces (doc 06 §7.9), which is what
 *     the crease normal map is blended by.
 */

import type { ClothSystem, RigHandles } from '../contracts';
import { notYetPhase4 } from './phase';

/** §3.13. **Phase 4.** Throws until implemented — see the file header. */
export function uploadCloth(_rig: RigHandles, _cloth: ClothSystem): void {
  notYetPhase4(
    'uploadCloth',
    'src/render/clothBridge.ts',
    'B7 ClothSystem.upload() / the §6.6 frame loop',
  );
}
