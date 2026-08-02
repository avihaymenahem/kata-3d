/**
 * tests/rig/scale.test.ts — §2.8: `ribcage` is the only bone that may carry a non-unit scale, and it
 * is a childless leaf of `chest`.
 *
 * OWNERSHIP B4 verification: "`ribcage` has no children; **no other bone ever scales**, bit-exactly,
 * at every tick of both kata". The "every tick of both kata" half of that cannot run in Phase 1 —
 * `compileKata` is B3's and lands in Phase 3, and `PoseFrame.scaleRibcage` is written by B6's
 * `applyPose` which lands in Phase 2. What CAN be asserted now, and is, is the STRUCTURAL property
 * that makes the per-tick version unfalsifiable:
 *
 *   1. `ribcage` has no children in the built tree, so no descendant transform can inherit a scale.
 *   2. Every bone is at scale exactly (1,1,1) at bind, bit-exactly, `Object.is`-equal to 1.
 *   3. Driving `ribcage.scale` to its breath extremes moves ribcage-weighted skin and moves NOTHING
 *      else — not one other vertex, and not one other bone's world position. This is the actual
 *      content of "no bone length drifts" (metric 59), tested by construction rather than by sampling.
 *   4. The figure's overall scale gate: 7.7 heads, 1.75 m, doc 07 §4's anti-heroic proportion.
 *
 * Item 3 is the one that would have caught Proposal B's defect: it drove breath from `chest.scale`,
 * which propagates down the whole arm chain and brushes metric 59's 2 % hard fail.
 */

import { MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BONE_COUNT,
  BONE_ORDER,
  BONE_PARENT,
  BONE_PARENT_NAME,
  boneIndex,
  H,
  LAYER_ORDER,
  LAYER_WRITABLE,
  NON_SCALING_BONE_COUNT,
  SCALABLE_BONE,
  type BoneName,
} from '../../src/contracts';
import { ANTHRO } from '../../src/data';
import { buildKarateka, WEIGHT_PARAMS, type RigMaterialSet } from '../../src/rig';

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

/** §2.8: `ribcage.scale = (1 + 0.022*b, 1, 1 + 0.022*b)`, x0.994 at kiai (doc 04 §8.2). */
const BREATH_GAIN = 0.022;
const KIAI_COMPRESSION = 0.994;

describe('§2.8 — ribcage is childless, forever', () => {
  it('has no children in the built tree and no bone names it as parent', () => {
    expect(rig.byName.ribcage.children).toEqual([]);
    const ri = boneIndex('ribcage');
    expect(BONE_ORDER.filter((_, i) => BONE_PARENT[i] === ri)).toEqual([]);
    expect(Object.entries(BONE_PARENT_NAME).filter(([, p]) => p === 'ribcage')).toEqual([]);
    expect(rig.byName.ribcage.parent?.name).toBe('chest');
  });

  it('SCALABLE_BONE is ribcage and metric 59 covers the other 51', () => {
    expect(SCALABLE_BONE).toBe('ribcage');
    expect(NON_SCALING_BONE_COUNT).toBe(51);
    expect(NON_SCALING_BONE_COUNT).toBe(BONE_COUNT - 1);
  });

  it('only the breath layer (and the universal patch layer) may write it', () => {
    const ri = boneIndex('ribcage');
    expect(LAYER_WRITABLE.breath).toEqual([ri]);
    for (const id of LAYER_ORDER) {
      if (id === 'breath' || id === 'patch') continue;
      expect(LAYER_WRITABLE[id], `layer ${id}`).not.toContain(ri);
    }
  });
});

describe('§2.8 — at bind, every bone scale is bit-exactly (1,1,1)', () => {
  it('all 52, Object.is-equal to 1', () => {
    for (const n of BONE_ORDER) {
      const s = rig.byName[n].scale;
      expect(Object.is(s.x, 1), `${n}.scale.x`).toBe(true);
      expect(Object.is(s.y, 1), `${n}.scale.y`).toBe(true);
      expect(Object.is(s.z, 1), `${n}.scale.z`).toBe(true);
    }
  });

  it('the anchor Group and every mesh are unscaled too', () => {
    for (const o of [rig.root, rig.body, rig.gi.uwagi, rig.gi.zubon, rig.gi.collar, rig.gi.obi]) {
      expect(o.scale.toArray()).toEqual([1, 1, 1]);
    }
  });
});

describe('§2.8 — breath moves the ribcage band and NOTHING else', () => {
  const boneWorld = (): Map<BoneName, Vector3> => {
    const m = new Map<BoneName, Vector3>();
    for (const n of BONE_ORDER) {
      m.set(n, new Vector3().setFromMatrixPosition(rig.byName[n].matrixWorld));
    }
    return m;
  };

  it('a full inhale changes no other bone world position, at all', () => {
    const before = boneWorld();
    rig.byName.ribcage.scale.set(1 + BREATH_GAIN, 1, 1 + BREATH_GAIN);
    rig.root.updateMatrixWorld(true);
    const after = boneWorld();
    for (const n of BONE_ORDER) {
      const d = before.get(n)!.distanceTo(after.get(n)!);
      expect(d, `${n} moved on inhale`).toBe(0);
    }
    rig.byName.ribcage.scale.set(1, 1, 1);
    rig.root.updateMatrixWorld(true);
  });

  it('a kiai compression changes no other bone world position, at all', () => {
    const before = boneWorld();
    rig.byName.ribcage.scale.set(KIAI_COMPRESSION, 1, KIAI_COMPRESSION);
    rig.root.updateMatrixWorld(true);
    const after = boneWorld();
    for (const n of BONE_ORDER) expect(before.get(n)!.distanceTo(after.get(n)!)).toBe(0);
    rig.byName.ribcage.scale.set(1, 1, 1);
    rig.root.updateMatrixWorld(true);
  });

  it('metric 59 `bone_length_drift_pct` is 0 across the whole legal breath range', () => {
    const lengthOf = (): number[] =>
      BONE_ORDER.map((n) => {
        const p = BONE_PARENT_NAME[n];
        if (p === null) return 0;
        return new Vector3()
          .setFromMatrixPosition(rig.byName[n].matrixWorld)
          .distanceTo(new Vector3().setFromMatrixPosition(rig.byName[p].matrixWorld));
      });
    const base = lengthOf();
    for (const b of [-1, -0.5, 0, 0.5, 1, 1.5]) {
      const s = 1 + BREATH_GAIN * b;
      rig.byName.ribcage.scale.set(s, 1, s);
      rig.root.updateMatrixWorld(true);
      const now = lengthOf();
      for (let i = 0; i < BONE_COUNT; i++) {
        const drift = base[i]! === 0 ? 0 : (Math.abs(now[i]! - base[i]!) / base[i]!) * 100;
        expect(drift, `${BONE_ORDER[i]} drift % at breath ${b}`).toBe(0);
      }
    }
    rig.byName.ribcage.scale.set(1, 1, 1);
    rig.root.updateMatrixWorld(true);
  });

  it('it DOES move ribcage-weighted skin — and only skin inside the band', () => {
    // CPU-skin the body twice, once at rest and once at full inhale, and check where it moved.
    const skinAt = (scale: number): Float64Array => {
      rig.byName.ribcage.scale.set(scale, 1, scale);
      rig.root.updateMatrixWorld(true);
      rig.skeleton.update();
      const g = rig.body.geometry;
      const pos = g.getAttribute('position');
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      const out = new Float64Array(pos.count * 3);
      const p = new Vector3();
      const acc = new Vector3();
      const tmp = new Vector3();
      for (let v = 0; v < pos.count; v++) {
        p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
        acc.set(0, 0, 0);
        for (let k = 0; k < K; k++) {
          const w = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)][k]!;
          if (w === 0) continue;
          const bi = [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)][k]!;
          const bone = rig.bones[bi]!;
          tmp
            .copy(p)
            .applyMatrix4(rig.skeleton.boneInverses[bi]!)
            .applyMatrix4(bone.matrixWorld);
          acc.addScaledVector(tmp, w);
        }
        out[v * 3] = acc.x;
        out[v * 3 + 1] = acc.y;
        out[v * 3 + 2] = acc.z;
      }
      return out;
    };

    const rest = skinAt(1);
    const inhale = skinAt(1 + BREATH_GAIN);
    rig.byName.ribcage.scale.set(1, 1, 1);
    rig.root.updateMatrixWorld(true);
    rig.skeleton.update();

    const pos = rig.body.geometry.getAttribute('position');
    let moved = 0;
    let maxMove = 0;
    for (let v = 0; v < pos.count; v++) {
      const d = Math.hypot(
        inhale[v * 3]! - rest[v * 3]!,
        inhale[v * 3 + 1]! - rest[v * 3 + 1]!,
        inhale[v * 3 + 2]! - rest[v * 3 + 2]!,
      );
      if (d > 1e-9) {
        moved++;
        maxMove = Math.max(maxMove, d);
        const yH = pos.getY(v) / H;
        expect(yH, `v${v} moved on breath but is outside the ribcage band`).toBeGreaterThan(0.63);
        expect(yH, `v${v} moved on breath but is outside the ribcage band`).toBeLessThan(0.87);
      }
    }
    expect(moved, 'breath must move real skin').toBeGreaterThan(120);
    // 2.2 % of a 0.087 H chest half-width, times the band's peak weight: a few millimetres.
    expect(maxMove / H).toBeGreaterThan(0.0004);
    expect(maxMove / H).toBeLessThan(0.004);
  });
});

describe('doc 07 §4 — the figure\'s overall SCALE is the anti-heroic one', () => {
  it('7.7 heads, from a 0.130 H head, and 1.75 m tall', () => {
    expect(ANTHRO.HEAD_HEIGHT!.v).toBe(0.13);
    const heads = 1 / ANTHRO.HEAD_HEIGHT!.v;
    expect(heads).toBeGreaterThan(7.6);
    expect(heads).toBeLessThan(7.75);
    expect(heads, 'an 8-head heroic figure is an automatic fail (doc 07 §4)').toBeLessThan(8);
    expect(H).toBe(1.75);

    // ...and the built rig actually IS that tall: the vertex sits at 1.000 H.
    const vertex = new Vector3().setFromMatrixPosition(rig.byName.head_end.matrixWorld);
    expect(vertex.y).toBeCloseTo(H, 6);
    expect(vertex.y / heads).toBeCloseTo(ANTHRO.HEAD_HEIGHT!.v * H, 6);
  });

  it('the mesh spans floor to vertex with no scale factor hiding anywhere', () => {
    const pos = rig.body.geometry.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY / H).toBeGreaterThan(-1e-6);
    expect(maxY / H).toBeCloseTo(1, 3);
    // Head height as a fraction of stature, measured on the mesh: the crown down to the chin band.
    // doc 06 §1.3 puts the AOJ at 0.918 H and doc 07 §0.2 the head at 0.130 H, so the chin lands at
    // 0.870 H — which is doc 03 §1.3's `CHIN_Y` exactly.
    expect(maxY / H - ANTHRO.HEAD_HEIGHT!.v).toBeCloseTo(0.87, 2);
  });
});
