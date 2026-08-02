/**
 * tests/rig/tangents.test.ts — ARCHITECTURE §2.7 and judge finding A-11.
 *
 * "`itemSize === 4`, `|w| === 1` for every vertex, `|T| = 1 ± 1e-5`, `|dot(T, N)| < 1e-4`, and
 * `anisotropy > 0 ⇒ attributes.tangent !== undefined`."
 *
 * WHY A TEST AND NOT A COMMENT. A `vec3` tangent BINDS WITHOUT ERROR — WebGL fills the missing
 * component with 1.0 — and three's `USE_TANGENT` path then builds the bitangent as
 * `cross(normal, tangent.xyz) * tangent.w`, so every panel whose true handedness is -1 gets its
 * bitangent inverted. The gi's weave normal map and its `anisotropyRotation` both live in that frame,
 * so the failure is "half the garment shades inside out" and NOTHING else in the project can see it:
 * no metric reads a tangent, and the silhouette is unchanged.
 *
 * The handedness assertion is therefore made against an ANALYTIC case with a known answer (two flat
 * quads whose UVs differ only in the sign of `v`), not just against the shipped geometry.
 */

import { BufferAttribute, BufferGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GI_ANISOTROPY_FRAC, TANGENT_ITEM_SIZE } from '../../src/contracts';
import {
  assertTangentContract,
  buildKarateka,
  computeAnalyticTangents,
  GI_UV_UNITS,
  GI_WEAVE_REPEAT_PER_M,
  type RigMaterialSet,
} from '../../src/rig';

function stubMaterials(): RigMaterialSet {
  const m = new MeshStandardMaterial();
  return {
    M_GI: m, M_SKIN: m, M_OBI: m, M_FLOOR: m, M_BACKDROP: m,
    M_HAIR: m, M_EYE: m, M_EMBUSEN: m, M_MASK: m, M_DEBUG: m,
  };
}

const rig = buildKarateka(stubMaterials());

const meshes = [
  ['body', rig.body.geometry],
  ['uwagi', rig.gi.uwagi.geometry],
  ['zubon', rig.gi.zubon.geometry],
  ['collar', rig.gi.collar.geometry],
  ['obi', rig.gi.obi.geometry],
] as const;

describe('§2.7 — the tangent attribute contract, on every shipped geometry', () => {
  it('exists, and `anisotropy > 0` therefore has something to rotate', () => {
    expect(GI_ANISOTROPY_FRAC, 'C06 ships anisotropy 0.18 WITH an analytic tangent').toBeGreaterThan(0);
    for (const [name, g] of meshes) {
      expect(g.getAttribute('tangent'), `${name}.tangent`).toBeDefined();
    }
  });

  it('itemSize === 4 — a vec3 binds silently and mis-shades the whole gi', () => {
    expect(TANGENT_ITEM_SIZE).toBe(4);
    for (const [name, g] of meshes) {
      expect(g.getAttribute('tangent').itemSize, `${name}`).toBe(4);
      expect(g.getAttribute('tangent').itemSize).toBe(TANGENT_ITEM_SIZE);
      expect(g.getAttribute('tangent').count, `${name}`).toBe(g.getAttribute('position').count);
    }
  });

  it('|w| === 1 exactly, |T| = 1 ± 1e-5, |T·N| < 1e-4, on every vertex', () => {
    for (const [name, g] of meshes) {
      const t = g.getAttribute('tangent');
      const nrm = g.getAttribute('normal');
      let worstLen = 0;
      let worstDot = 0;
      for (let i = 0; i < t.count; i++) {
        const w = t.getW(i);
        expect(Math.abs(w), `${name} v${i} |w|`).toBe(1);
        worstLen = Math.max(worstLen, Math.abs(Math.hypot(t.getX(i), t.getY(i), t.getZ(i)) - 1));
        worstDot = Math.max(
          worstDot,
          Math.abs(t.getX(i) * nrm.getX(i) + t.getY(i) * nrm.getY(i) + t.getZ(i) * nrm.getZ(i)),
        );
      }
      expect(worstLen, `${name} worst ||T| - 1|`).toBeLessThan(1e-5);
      expect(worstDot, `${name} worst |T·N|`).toBeLessThan(1e-4);
    }
  });

  it('`assertTangentContract` agrees (it is the runtime form of the same check)', () => {
    for (const [, g] of meshes) expect(() => assertTangentContract(g)).not.toThrow();
  });

  it('every tangent is finite — a NaN here shades as a black panel, not as an error', () => {
    for (const [name, g] of meshes) {
      const t = g.getAttribute('tangent');
      for (let i = 0; i < t.count * 4; i++) {
        expect(Number.isFinite((t.array as Float32Array)[i]!), `${name} [${i}]`).toBe(true);
      }
    }
  });
});

describe('§2.7 — handedness is right, proved on an analytic case', () => {
  /** One quad in the XY plane, normal +Z, with `u` along +X and `v` along `vSign * +Y`. */
  function quad(vSign: 1 | -1): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3),
    );
    g.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    );
    const v0 = vSign === 1 ? 0 : 1;
    const v1 = vSign === 1 ? 1 : 0;
    g.setAttribute(
      'uv',
      new BufferAttribute(new Float32Array([0, v0, 1, v0, 1, v1, 0, v1]), 2),
    );
    g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    return g;
  }

  it('u along +X, v along +Y, N = +Z  =>  T = +X and w = +1', () => {
    const g = quad(1);
    const t = computeAnalyticTangents(g);
    for (let i = 0; i < t.count; i++) {
      expect(t.getX(i)).toBeCloseTo(1, 6);
      expect(t.getY(i)).toBeCloseTo(0, 6);
      expect(t.getZ(i)).toBeCloseTo(0, 6);
      // cross(N, T) = cross(+Z, +X) = +Y, and B = +Y, so dot > 0 => w = +1.
      expect(t.getW(i)).toBe(1);
    }
  });

  it('MIRRORING v flips w to -1 while T stays +X — this is the bit a vec3 loses', () => {
    const g = quad(-1);
    const t = computeAnalyticTangents(g);
    for (let i = 0; i < t.count; i++) {
      expect(t.getX(i)).toBeCloseTo(1, 6);
      expect(t.getW(i)).toBe(-1);
    }
    // A `vec3` attribute would leave WebGL to supply w = 1.0 here, and every normal-map green channel
    // on this island would read inverted. That is finding A-11, in two lines.
    expect(computeAnalyticTangents(quad(1)).getW(0)).toBe(1);
  });

  it('the reconstructed bitangent `cross(N,T)*w` really does point along the UV v axis', () => {
    for (const vSign of [1, -1] as const) {
      const g = quad(vSign);
      const t = computeAnalyticTangents(g);
      const N = new Vector3(0, 0, 1);
      const T = new Vector3(t.getX(0), t.getY(0), t.getZ(0));
      const B = new Vector3().crossVectors(N, T).multiplyScalar(t.getW(0));
      expect(B.y).toBeCloseTo(vSign, 6);
    }
  });

  it('§9.4 — a NON-INDEXED geometry is rejected loudly, not silently mis-tangented', () => {
    const g = quad(1);
    g.setIndex(null);
    expect(() => computeAnalyticTangents(g)).toThrow(/INDEXED/);
  });

  it('a degenerate-UV island still yields a unit tangent perpendicular to N', () => {
    const g = quad(1);
    // Collapse every UV to a point: `det` is 0 on both triangles, so nothing accumulates.
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]), 2));
    const t = computeAnalyticTangents(g);
    for (let i = 0; i < t.count; i++) {
      expect(Math.hypot(t.getX(i), t.getY(i), t.getZ(i))).toBeCloseTo(1, 6);
      expect(Math.abs(t.getZ(i)), 'must stay perpendicular to N = +Z').toBeLessThan(1e-6);
      expect(Math.abs(t.getW(i))).toBe(1);
    }
  });
});

describe('§2.7 / doc 06 §7.9 — the UV frame the tangent lives in', () => {
  it('gi UVs are METRES, and the weave repeat is doc 06 §7.9\'s 147 x 131 per metre', () => {
    expect(GI_UV_UNITS).toBe('metres');
    expect(GI_WEAVE_REPEAT_PER_M[0]).toBe(147);
    expect(GI_WEAVE_REPEAT_PER_M[1]).toBe(131);
  });

  it('gi UVs really are in metres — a sleeve spans ~0.24 m of warp, not 0..1', () => {
    const uv = rig.gi.uwagi.geometry.getAttribute('uv');
    let maxU = 0;
    let maxV = 0;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    // The longest warp run on the uwagi is the sleeve (0.255 H - 0.020 H = 0.41 m).
    expect(maxU).toBeGreaterThan(0.2);
    expect(maxU).toBeLessThan(1.0);
    expect(maxV).toBeGreaterThan(0.05);
    expect(maxV).toBeLessThan(1.0);
    // One weave tile is 6.77 mm along the warp, so 0.41 m is ~60 tiles: enough that a 512 tile at
    // 13.2 microns per texel is not the aliasing bottleneck (doc 06 §7.9).
    expect(maxU * GI_WEAVE_REPEAT_PER_M[0]).toBeGreaterThan(30);
  });
});
