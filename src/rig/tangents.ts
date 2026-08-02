/**
 * B4 RIG — `src/rig/tangents.ts`
 *
 * ARCHITECTURE §2.7, verbatim: the gi's `tangent` attribute is a `BufferAttribute` with
 * **`itemSize = 4`** — `xyz` = the unit warp direction (the parametric `u` isoline of the panel),
 * `w = sign(dot(cross(N, T), B)) ∈ {−1, +1}`.
 *
 * WHY IT MATTERS. `three`'s `USE_TANGENT` GLSL path declares `attribute vec4 tangent` and reads the
 * handedness out of `w` (`normal_vertex.glsl.js` builds the bitangent as
 * `cross(objectNormal, objectTangent.xyz) * objectTangent.w`). A `vec3` attribute BINDS WITHOUT
 * ERROR — WebGL fills the missing component with 1.0 — and then mis-shades the entire gi: every
 * panel whose real handedness is −1 gets its bitangent inverted, which flips the normal map's
 * green channel and the anisotropy rotation on roughly half the garment. Judge finding A-11.
 *
 * WHY IT IS ANALYTIC. `BufferGeometry.computeTangents()` throws when `index === null`, and
 * `BufferGeometryUtils.toCreasedNormals` always returns a NON-indexed geometry, so the pairing that
 * every proposal assumed is unusable (§9.4). `tools/verify-contracts.mjs` bans `.computeTangents(`
 * project-wide. We generate the geometry, so we generate the tangent — including `w`.
 *
 * We also never call `mikktspace`: it is a WASM dependency, and the dependency set is frozen.
 */

import { BufferAttribute, type BufferGeometry, Vector3 } from 'three';

const EPS_LEN = 1e-12;

/**
 * Accumulate per-vertex `(T, B)` from the UV derivatives of every incident triangle, orthonormalise
 * `T` against `N`, and store the handedness in `w`.
 *
 * Requires `position`, `normal`, `uv` and an index. Returns the attribute it installed.
 */
export function computeAnalyticTangents(geometry: BufferGeometry): BufferAttribute {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const indexAttr = geometry.getIndex();
  if (!pos || !nrm || !uv) {
    throw new Error(
      'computeAnalyticTangents: geometry needs position, normal and uv attributes ' +
        '(ARCHITECTURE §2.7 — the tangent is the parametric u isoline, so a UV is mandatory)',
    );
  }
  if (!indexAttr) {
    throw new Error(
      'computeAnalyticTangents: geometry must be INDEXED. Non-indexed is exactly the trap §9.4 ' +
        'names: toCreasedNormals returns non-indexed and computeTangents() then throws.',
    );
  }

  const n = pos.count;
  const index = indexAttr.array;
  const tanAcc = new Float64Array(n * 3);
  const bitAcc = new Float64Array(n * 3);

  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const sdir = new Vector3();
  const tdir = new Vector3();

  for (let f = 0; f + 2 < index.length; f += 3) {
    const i0 = index[f]!;
    const i1 = index[f + 1]!;
    const i2 = index[f + 2]!;

    p0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    p1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    p2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    const u0 = uv.getX(i0);
    const v0 = uv.getY(i0);
    const du1 = uv.getX(i1) - u0;
    const dv1 = uv.getY(i1) - v0;
    const du2 = uv.getX(i2) - u0;
    const dv2 = uv.getY(i2) - v0;

    e1.copy(p1).sub(p0);
    e2.copy(p2).sub(p0);

    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-14) continue; // degenerate UV triangle: contributes nothing
    const inv = 1 / det;

    sdir
      .copy(e1)
      .multiplyScalar(dv2 * inv)
      .addScaledVector(e2, -dv1 * inv);
    tdir
      .copy(e2)
      .multiplyScalar(du1 * inv)
      .addScaledVector(e1, -du2 * inv);

    for (const i of [i0, i1, i2]) {
      tanAcc[i * 3] = tanAcc[i * 3]! + sdir.x;
      tanAcc[i * 3 + 1] = tanAcc[i * 3 + 1]! + sdir.y;
      tanAcc[i * 3 + 2] = tanAcc[i * 3 + 2]! + sdir.z;
      bitAcc[i * 3] = bitAcc[i * 3]! + tdir.x;
      bitAcc[i * 3 + 1] = bitAcc[i * 3 + 1]! + tdir.y;
      bitAcc[i * 3 + 2] = bitAcc[i * 3 + 2]! + tdir.z;
    }
  }

  const out = new Float32Array(n * 4);
  const N = new Vector3();
  const T = new Vector3();
  const B = new Vector3();
  const tmp = new Vector3();

  for (let i = 0; i < n; i++) {
    N.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (N.lengthSq() < EPS_LEN) N.set(0, 1, 0);
    else N.normalize();

    T.set(tanAcc[i * 3]!, tanAcc[i * 3 + 1]!, tanAcc[i * 3 + 2]!);
    B.set(bitAcc[i * 3]!, bitAcc[i * 3 + 1]!, bitAcc[i * 3 + 2]!);

    // Gram-Schmidt against N. This is what makes |dot(T, N)| < 1e-4 true rather than approximately
    // true, and the GLSL path assumes it (it re-derives B from cross(N, T)).
    T.addScaledVector(N, -N.dot(T));
    if (T.lengthSq() < EPS_LEN) {
      // No usable UV gradient here (a pole, or a fully degenerate island). Any unit vector
      // perpendicular to N is a legal warp direction; pick one deterministically.
      tmp.set(0, 0, 1);
      if (Math.abs(N.z) > 0.9) tmp.set(1, 0, 0);
      T.copy(tmp).addScaledVector(N, -N.dot(tmp));
    }
    T.normalize();

    if (B.lengthSq() < EPS_LEN) B.crossVectors(N, T);
    const w = tmp.crossVectors(N, T).dot(B) < 0 ? -1 : 1;

    out[i * 4] = T.x;
    out[i * 4 + 1] = T.y;
    out[i * 4 + 2] = T.z;
    out[i * 4 + 3] = w;
  }

  const attr = new BufferAttribute(out, 4);
  geometry.setAttribute('tangent', attr);
  return attr;
}

/** §2.7's own assertion set, callable at runtime so a bad panel fails loudly rather than shades wrong. */
export function assertTangentContract(geometry: BufferGeometry): void {
  const t = geometry.getAttribute('tangent');
  const nrm = geometry.getAttribute('normal');
  if (!t) throw new Error('tangent attribute missing (§2.7)');
  if (t.itemSize !== 4) throw new Error(`tangent itemSize must be 4, got ${t.itemSize} (§2.7)`);
  for (let i = 0; i < t.count; i++) {
    const w = t.getW(i);
    if (w !== -1 && w !== 1) throw new Error(`tangent.w must be +-1 at vertex ${i}, got ${w}`);
    const len = Math.hypot(t.getX(i), t.getY(i), t.getZ(i));
    if (Math.abs(len - 1) > 1e-5) throw new Error(`|T| must be 1 at vertex ${i}, got ${len}`);
    const d = t.getX(i) * nrm.getX(i) + t.getY(i) * nrm.getY(i) + t.getZ(i) * nrm.getZ(i);
    if (Math.abs(d) > 1e-4) throw new Error(`|T.N| must be ~0 at vertex ${i}, got ${d}`);
  }
}
