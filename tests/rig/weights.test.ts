/**
 * tests/rig/weights.test.ts — doc 06 §5.3's seven steps, as assertions.
 *
 * OWNERSHIP B4 verification: "Σ = 1 ± 1e-4; no vertex with 5 influences; no `ribcage` weight outside
 * the torso band".
 *
 * The third one is the sharp one, and it caught a real bug during development: `ribcage`'s skinning
 * segment is a LEAF STUB, its glow radius reached the jaw, and `GROUP_ALLOW.head` permits trunk
 * bones — so the ordinary falloff put ribcage weight on the top of the SKULL. `ribcage` is the only
 * bone allowed a non-unit scale (§2.8) and breath drives that scale, so the symptom would have been
 * the head inflating 2.2 % on every inhale, at every tick of both kata, with no metric watching (all
 * 55 of G1-G4 read the 25 canonical joints, and `HeadTop_End` is a JOINT — it does not move when the
 * skin around it does).
 */

import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BONE_COUNT,
  BONE_ORDER,
  boneIndex,
  GARMENT_PARTS,
  H,
  type BoneName,
} from '../../src/contracts';
import { GARMENTS } from '../../src/data';
import {
  buildKarateka,
  giParts,
  karatekaStats,
  LIMB_GROUP,
  WEIGHT_PARAMS,
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
rig.root.updateMatrixWorld(true);

const K = WEIGHT_PARAMS.maxInfluences;

interface Skinned {
  readonly label: string;
  readonly idx: Uint16Array;
  readonly w: Float32Array;
  readonly count: number;
  readonly y: (v: number) => number;
}

function read(label: string, mesh: { geometry: import('three').BufferGeometry }): Skinned {
  const g = mesh.geometry;
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const pos = g.getAttribute('position');
  const idx = new Uint16Array(si.count * K);
  const w = new Float32Array(sw.count * K);
  for (let v = 0; v < si.count; v++) {
    idx[v * K] = si.getX(v);
    idx[v * K + 1] = si.getY(v);
    idx[v * K + 2] = si.getZ(v);
    idx[v * K + 3] = si.getW(v);
    w[v * K] = sw.getX(v);
    w[v * K + 1] = sw.getY(v);
    w[v * K + 2] = sw.getZ(v);
    w[v * K + 3] = sw.getW(v);
  }
  return { label, idx, w, count: si.count, y: (v) => pos.getY(v) };
}

const skinned: readonly Skinned[] = [
  read('body', rig.body),
  read('uwagi', rig.gi.uwagi),
  read('zubon', rig.gi.zubon),
  read('collar', rig.gi.collar),
  read('obi', rig.gi.obi),
];

describe('doc 06 §4.4 — three.js allows exactly 4 influences, hard', () => {
  it('every skinned mesh has itemSize-4 skinIndex/skinWeight of matching length', () => {
    for (const s of skinned) {
      const g =
        s.label === 'body'
          ? rig.body.geometry
          : rig.gi[s.label as 'uwagi' | 'zubon' | 'collar' | 'obi'].geometry;
      expect(g.getAttribute('skinIndex').itemSize, s.label).toBe(4);
      expect(g.getAttribute('skinWeight').itemSize, s.label).toBe(4);
      expect(g.getAttribute('skinIndex').count, s.label).toBe(g.getAttribute('position').count);
      expect(g.getAttribute('skinWeight').count, s.label).toBe(g.getAttribute('position').count);
    }
  });

  it('no vertex has a 5th influence — and no vertex names the same bone twice', () => {
    for (const s of skinned) {
      for (let v = 0; v < s.count; v++) {
        const live: number[] = [];
        for (let k = 0; k < K; k++) if (s.w[v * K + k]! > 0) live.push(s.idx[v * K + k]!);
        expect(live.length, `${s.label} v${v} influence count`).toBeLessThanOrEqual(4);
        expect(live.length, `${s.label} v${v} has no influence at all`).toBeGreaterThan(0);
        // A duplicated bone in two slots is the classic silent way a 4-influence limit turns into a
        // 3-influence one: the weights still sum to 1 so no other assertion notices.
        expect(new Set(live).size, `${s.label} v${v} duplicate bone slot`).toBe(live.length);
      }
    }
  });
});

describe('doc 06 §5.3 step 5 — the weights are a partition of unity', () => {
  it('Σ w = 1 ± 1e-4 on every vertex of every skinned mesh', () => {
    for (const s of skinned) {
      let worst = 0;
      let worstV = -1;
      for (let v = 0; v < s.count; v++) {
        let sum = 0;
        for (let k = 0; k < K; k++) sum += s.w[v * K + k]!;
        if (Math.abs(sum - 1) > worst) {
          worst = Math.abs(sum - 1);
          worstV = v;
        }
      }
      expect(worst, `${s.label} worst |Σw - 1| at v${worstV}`).toBeLessThan(1e-4);
    }
  });

  it('every weight is finite, non-negative and ≤ 1, and every index is a real bone', () => {
    for (const s of skinned) {
      for (let v = 0; v < s.count; v++) {
        for (let k = 0; k < K; k++) {
          const w = s.w[v * K + k]!;
          expect(Number.isFinite(w), `${s.label} v${v}.${k}`).toBe(true);
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1 + 1e-6);
          const b = s.idx[v * K + k]!;
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b, `${s.label} v${v}.${k} bone index`).toBeLessThan(BONE_COUNT);
        }
      }
    }
  });
});

describe('§2.8 — ribcage carries the ribcage/upper-abdomen band and NOTHING else', () => {
  const ri = boneIndex('ribcage');
  const bandLo = 0.63;
  const bandHi = 0.87;

  it('no ribcage weight outside the torso band, on any mesh', () => {
    for (const s of skinned) {
      for (let v = 0; v < s.count; v++) {
        for (let k = 0; k < K; k++) {
          if (s.idx[v * K + k]! !== ri || s.w[v * K + k]! <= 0) continue;
          const yH = s.y(v) / H;
          expect(yH, `${s.label} v${v} ribcage weight height`).toBeGreaterThan(bandLo);
          expect(yH, `${s.label} v${v} ribcage weight height`).toBeLessThan(bandHi);
        }
      }
    }
  });

  it('ribcage DOES carry real weight — breath must actually move skin', () => {
    let verts = 0;
    let maxW = 0;
    for (let v = 0; v < skinned[0]!.count; v++) {
      for (let k = 0; k < K; k++) {
        if (skinned[0]!.idx[v * K + k]! !== ri) continue;
        const w = skinned[0]!.w[v * K + k]!;
        if (w > 0) verts++;
        maxW = Math.max(maxW, w);
      }
    }
    expect(verts, 'a ribcage with no weight makes the breath layer a no-op').toBeGreaterThan(120);
    expect(maxW).toBeGreaterThan(0.3);
    expect(maxW).toBeLessThanOrEqual(WEIGHT_PARAMS.ribcageShare + 1e-6);
  });

  it('no vertex is rigid on ribcage (it would then never rotate with the thorax)', () => {
    // `ribcage` inherits `chest`'s rotation, so a fully-ribcage vertex still turns with the torso —
    // but it would ALSO take the full 2.2 % breath scale, which at w = 1 reads as a pulsing lump.
    for (let v = 0; v < skinned[0]!.count; v++) {
      for (let k = 0; k < K; k++) {
        if (skinned[0]!.idx[v * K + k]! === ri) {
          expect(skinned[0]!.w[v * K + k]!, `body v${v}`).toBeLessThan(0.9);
        }
      }
    }
  });
});

describe('doc 06 §5.3 step 2 — the visibility gate stops cross-limb bleeding', () => {
  /**
   * The defect §5.3 step 2 exists to prevent, stated precisely: "the inner thigh gets weighted to the
   * opposite thigh, and the medial forearm to the ribs". So the invariant is about a LIMB vertex, not
   * about every vertex. A TRUNK vertex at the crotch legitimately blends `thigh_L` and `thigh_R` —
   * that is the groin gusset doing its job, and forbidding it would tear the pelvis open at 125° of
   * hip flexion. A vertex whose own limb is `leg_L` may see `leg_L` and `trunk` and nothing else.
   */
  it('no LIMB vertex is weighted to a different limb', () => {
    const body = skinned[0]!;
    const pos = rig.body.geometry.getAttribute('position');
    // Inside the sternum band BOTH clavicles legitimately blend — the SC joint is at the sternum, so
    // that band is the one place a "left" and a "right" bone share vertices, and the cross-fade in
    // `skinWeights.ts` is what makes it smooth. Outside it, sharing is the bug §5.3 step 2 names.
    const sternum = WEIGHT_PARAMS.midlineBandArmH * H;
    const bad: string[] = [];
    for (let v = 0; v < body.count; v++) {
      if (Math.abs(pos.getX(v)) <= sternum) continue;
      const bones: BoneName[] = [];
      let dom = body.idx[v * K]!;
      let domW = body.w[v * K]!;
      for (let k = 0; k < K; k++) {
        if (body.w[v * K + k]! <= 0) continue;
        bones.push(BONE_ORDER[body.idx[v * K + k]!]!);
        if (body.w[v * K + k]! > domW) {
          domW = body.w[v * K + k]!;
          dom = body.idx[v * K + k]!;
        }
      }
      const own = LIMB_GROUP[BONE_ORDER[dom]!];
      if (own === 'trunk' || own === 'head') continue;
      const foreign = bones
        .map((b) => LIMB_GROUP[b])
        .filter((g) => g !== own && g !== 'trunk' && g !== 'head');
      if (foreign.length) bad.push(`v${v} (${own}) <- ${[...new Set(foreign)].join('+')}`);
    }
    expect(bad.slice(0, 8).join(' | ')).toBe('');
  });

  it('§5.4 Fix 3d — no arm bone touches a vertex medial to the shoulder ring', () => {
    const body = skinned[0]!;
    const pos = rig.body.geometry.getAttribute('position');
    const cutoff = WEIGHT_PARAMS.armMedialCutoffH * H;
    for (let v = 0; v < body.count; v++) {
      if (Math.abs(pos.getX(v)) >= cutoff) continue;
      for (let k = 0; k < K; k++) {
        if (body.w[v * K + k]! <= 0) continue;
        const n = BONE_ORDER[body.idx[v * K + k]!]!;
        expect(
          /^(upperarm|deltoid|lowerarm|hand|fingers|thumb)/.test(n),
          `body v${v} at |x| ${(Math.abs(pos.getX(v)) / H).toFixed(4)} H is weighted to ${n} ` +
            '— the "sucked-in chest" artifact',
        ).toBe(false);
      }
    }
  });
});

describe('doc 06 §5.3 steps 6-7 — smoothing and rigidify ran', () => {
  it('rigidify produced single-influence vertices, and the twist bands are rigid', () => {
    const stats = karatekaStats()!;
    expect(stats.twistSplit, 'doc 06 §5.4 Fix 1 must actually run').toBeGreaterThan(150);
    expect(stats.rigidified + stats.twistSplit).toBeGreaterThan(200);
    expect(stats.meanInfluences).toBeGreaterThan(1);
    expect(stats.meanInfluences).toBeLessThanOrEqual(4);
  });

  it('the tuning values are B1\'s doc-06 constants, not local literals', () => {
    expect(WEIGHT_PARAMS.kappa).toBe(2.6); //        §5.3 step 3
    expect(WEIGHT_PARAMS.exponent).toBe(3); //       §5.3 step 3
    expect(WEIGHT_PARAMS.maxInfluences).toBe(4); //  §4.4
    expect(WEIGHT_PARAMS.smoothLambda).toBe(0.35); //§5.3 step 6
    expect(WEIGHT_PARAMS.smoothIters).toBe(5); //    §5.3 step 6
    expect(WEIGHT_PARAMS.rigidifyFracR).toBe(1.8); //§5.3 step 7
  });
});

describe('the gi is pinned to the bones its cloth pins name', () => {
  it('every simulated part\'s first two rows are weighted to its pin bone', () => {
    for (const ring of rig.pinRings) {
      expect(ring.particles.length).toBeGreaterThan(0);
      expect(ring.restLocalH).toHaveLength(ring.particles.length * 3);
      for (let k = 0; k < ring.restLocalH.length; k++) {
        expect(Number.isFinite(ring.restLocalH[k]!)).toBe(true);
        // Bone-local rest offsets, FracH — a pin further than half a body height from its own bone
        // means the ring was captured in the wrong pose (T-pose instead of the A-pose bind).
        expect(Math.abs(ring.restLocalH[k]!)).toBeLessThan(0.5);
      }
    }
    const parts = new Set(rig.pinRings.map((r) => r.part));
    expect(parts.size, 'all 9 simulated garment parts need pins').toBe(9);
  });

  /**
   * The particle <-> vertex contract published in `giMesh.ts`'s header, checked end to end. B7's
   * `buildGarments` and B5's `clothBridge` both index the garment geometries through it, and a
   * one-part offset error would silently drive the wrong panel — so the sum has to be doc 06 §7.3's
   * 988 exactly, and every part's block has to be inside its own mesh.
   */
  it('the gi grids match GARMENTS to the particle — 988 total (doc 06 §7.3)', () => {
    const ranges = giParts();
    expect(ranges.map((r) => r.part)).toEqual([...GARMENT_PARTS]);

    let total = 0;
    for (const r of ranges) {
      const spec = GARMENTS.find((g) => g.part === r.part)!;
      expect(r.cols, `${r.part} cols`).toBe(spec.cols);
      expect(r.rows, `${r.part} rows`).toBe(spec.rows);
      expect(r.cols * r.rows, `${r.part} particles`).toBe(spec.particles);
      total += spec.particles;

      const count = rig.gi[r.mesh].geometry.getAttribute('position').count;
      expect(r.first, `${r.part} block start`).toBeGreaterThanOrEqual(0);
      expect(r.first + r.cols * r.rows, `${r.part} block must fit inside ${r.mesh}`).toBeLessThanOrEqual(
        count,
      );
      // Tube parts wrap in `col`; sheet parts do not. B7 needs that right to build the shear
      // constraints, and it is not recoverable from the vertex data alone.
      expect(r.closedCols, `${r.part} wrap`).toBe(/^(sleeve|trouser)_/.test(r.part));
    }
    expect(total, 'doc 06 §7.3 sizes the cloth budget at exactly 988 particles').toBe(988);
  });

  it('no two garment parts overlap in their own mesh\'s vertex buffer', () => {
    for (const mesh of ['uwagi', 'zubon', 'collar', 'obi'] as const) {
      const inMesh = giParts()
        .filter((r) => r.mesh === mesh)
        .map((r) => [r.first, r.first + r.cols * r.rows] as const)
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < inMesh.length; i++) {
        expect(inMesh[i]![0], `${mesh} block ${i} overlaps its predecessor`).toBeGreaterThanOrEqual(
          inMesh[i - 1]![1],
        );
      }
    }
  });
});
