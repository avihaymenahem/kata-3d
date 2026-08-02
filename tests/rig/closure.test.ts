/**
 * tests/rig/closure.test.ts — the bind pose is exactly the skeleton the contract describes.
 *
 * OWNERSHIP B4 verification: "bind-pose chain closure; `bone_length_drift_pct === 0` at bind", plus
 * docs/BRIEFS.md's B4 handoff: "`sampleLandmarks` MUST stamp `out.tick`; `tests/rig` must assert
 * `sampleLandmarks(rig, 12345, out)` -> `out.tick === 12345`".
 *
 * The closure assertions are the guard against the A-pose rebake of doc 06 §4.1 G3–G5 quietly moving
 * a joint: G3 sets ROTATIONS only, so every parent->child world distance must still equal
 * `|REST_OFFSET_H| * H` to the last bit a rotation can preserve.
 */

import { Box3, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BONE_COUNT,
  BONE_ORDER,
  BONE_PARENT_NAME,
  CANONICAL_JOINTS,
  CHAIN_CLOSURE_H,
  H,
  HEEL_OFFSET_H,
  REST_OFFSET_BY_NAME,
  type BoneName,
} from '../../src/contracts';
import { ANTHRO, COM_Y_BIND_H, JOINT_Y } from '../../src/data';
import {
  boneAABB,
  bodyCentreOfMass,
  buildKarateka,
  createLandmarks,
  karatekaStats,
  sampleLandmarks,
  type RigMaterialSet,
} from '../../src/rig';

/** A stub `MaterialSet`: B5 owns the real one, and nothing here depends on its appearance. */
function stubMaterials(): RigMaterialSet {
  const m = new MeshStandardMaterial();
  return {
    M_GI: m, M_SKIN: m, M_OBI: m, M_FLOOR: m, M_BACKDROP: m,
    M_HAIR: m, M_EYE: m, M_EMBUSEN: m, M_MASK: m, M_DEBUG: m,
  };
}

const rig = buildKarateka(stubMaterials());
rig.root.updateMatrixWorld(true);

const wp = (n: BoneName): Vector3 =>
  new Vector3().setFromMatrixPosition(rig.byName[n].matrixWorld);
const offLen = (n: BoneName): number => {
  const o = REST_OFFSET_BY_NAME[n];
  return Math.hypot(o[0], o[1], o[2]);
};

describe('B4 — the built skeleton IS the contract', () => {
  it('has the 52 bones of BONE_ORDER, in order, in both `bones` and `skeleton.bones`', () => {
    expect(rig.bones).toHaveLength(BONE_COUNT);
    expect(rig.bones.map((b) => b.name)).toEqual([...BONE_ORDER]);
    expect(rig.skeleton.bones.map((b) => b.name)).toEqual([...BONE_ORDER]);
    for (const n of BONE_ORDER) expect(rig.byName[n].name).toBe(n);
  });

  it('parents every bone per BONE_PARENT_NAME, with `root` under the anchor Group', () => {
    for (const n of BONE_ORDER) {
      const parent = BONE_PARENT_NAME[n];
      if (parent === null) expect(rig.byName[n].parent).toBe(rig.root);
      else expect(rig.byName[n].parent?.name).toBe(parent);
    }
  });

  it('§2.1 — the ONE bind-pose flip landed: authored +X is world -X', () => {
    // `src/rig/bones.ts` is the allowlisted flip site; every _L bone must now sit at negative x.
    expect(rig.byName.upperarm_L.position.x).toBeLessThan(0);
    expect(rig.byName.upperarm_R.position.x).toBeGreaterThan(0);
    expect(rig.byName.eye_L.position.x).toBeLessThan(0);
    expect(rig.byName.eye_R.position.x).toBeGreaterThan(0);
    expect(wp('upperarm_L').x).toBeLessThan(0);
    expect(wp('hand_L').x).toBeLessThan(wp('upperarm_L').x);

    /**
     * §2.1 ASSERTION 1, on the BUILT rig: "at yoi, `landmarks.eye_L.x < 0` and `eye_R.x > 0`".
     *
     * `tests/contracts/handedness.test.ts` also asserts this, but it currently cannot reach the
     * assertion: it calls `bone.getWorldPosition({ x: 0, y: 0, z: 0 })`, and three's implementation is
     * `target.setFromMatrixPosition(this.matrixWorld)`, so a plain object throws
     * `TypeError: target.setFromMatrixPosition is not a function` before any expectation runs.
     * `tests/contracts/**` is FROZEN, so B4 raises a handoff rather than editing it — and asserts the
     * same property here, on a real `Vector3`, so the invariant is covered in the meantime.
     */
    expect(
      new Vector3().setFromMatrixPosition(rig.byName.eye_L.matrixWorld).x,
      '§2.1 assertion 1: the left eye is at world -X',
    ).toBeLessThan(0);
    expect(new Vector3().setFromMatrixPosition(rig.byName.eye_R.matrixWorld).x).toBeGreaterThan(0);
    expect(rig.byName.eye_L.getWorldPosition(new Vector3()).x).toBeLessThan(0);
    expect(rig.byName.eye_R.getWorldPosition(new Vector3()).x).toBeGreaterThan(0);
    // ...and exactly once: y and z are doc 06 §4.2 verbatim.
    for (const n of BONE_ORDER) {
      const o = REST_OFFSET_BY_NAME[n];
      expect(rig.byName[n].position.x).toBeCloseTo(-o[0] * H, 12);
      expect(rig.byName[n].position.y).toBeCloseTo(o[1] * H, 12);
      expect(rig.byName[n].position.z).toBeCloseTo(o[2] * H, 12);
    }
  });
});

describe('doc 06 §4.1 G3-G5 — bind-pose chain closure to 1e-6 H', () => {
  it('every parent->child world distance is |REST_OFFSET_H| * H', () => {
    for (const n of BONE_ORDER) {
      const parent = BONE_PARENT_NAME[n];
      if (parent === null) continue;
      const d = wp(n).distanceTo(wp(parent)) / H;
      expect(Math.abs(d - offLen(n)), `${n} <- ${parent}`).toBeLessThan(1e-6);
    }
  });

  it('the six doc 06 §4.2 chain-closure lengths, measured on the BUILT rig', () => {
    const close = (a: BoneName, b: BoneName) => wp(a).distanceTo(wp(b)) / H;
    expect(close('upperarm_L', 'lowerarm_L')).toBeCloseTo(CHAIN_CLOSURE_H.upperarmToLowerarm, 6);
    expect(close('lowerarm_L', 'hand_L')).toBeCloseTo(CHAIN_CLOSURE_H.lowerarmToHand, 6);
    expect(close('thigh_L', 'calf_L')).toBeCloseTo(CHAIN_CLOSURE_H.thighToCalf, 6);
    expect(close('calf_L', 'foot_L')).toBeCloseTo(CHAIN_CLOSURE_H.calfToFoot, 6);
    // hand -> fingers_end is a THREE-bone sum, so it only closes if each link closes.
    const hf =
      close('hand_L', 'fingers_prox_L') +
      close('fingers_prox_L', 'fingers_dist_L') +
      close('fingers_dist_L', 'fingers_end_L');
    expect(hf).toBeCloseTo(CHAIN_CLOSURE_H.handToFingersEnd, 6);

    const lm = createLandmarks();
    sampleLandmarks(rig, 0, lm);
    const heel = new Vector3(lm.heelL[0]!, lm.heelL[1]!, lm.heelL[2]!);
    const toe = new Vector3(lm.toeTipL[0]!, lm.toeTipL[1]!, lm.toeTipL[2]!);
    expect(heel.distanceTo(toe) / H).toBeCloseTo(CHAIN_CLOSURE_H.heelToToeEnd, 4);
  });

  it('metric 59 `bone_length_drift_pct` is 0 at bind — mirrored chains close identically', () => {
    for (const l of BONE_ORDER.filter((n) => n.endsWith('_L'))) {
      const r = `${l.slice(0, -2)}_R` as BoneName;
      const pl = BONE_PARENT_NAME[l]!;
      const pr = BONE_PARENT_NAME[r]!;
      const dl = wp(l).distanceTo(wp(pl));
      const dr = wp(r).distanceTo(wp(pr));
      const drift = dl === 0 && dr === 0 ? 0 : (Math.abs(dl - dr) / Math.max(dl, dr, 1e-12)) * 100;
      expect(drift, `${l}/${r} length drift %`).toBeLessThan(1e-9);
    }
  });

  it('the A-pose rebake moved rotations only — arms are DOWN but joints are not', () => {
    // doc 06 §4.1 G3: 45 deg shoulder abduction + 6 deg clavicle depression.
    const sjc = wp('upperarm_L');
    const ejc = wp('lowerarm_L');
    const dropDeg = (Math.asin((sjc.y - ejc.y) / sjc.distanceTo(ejc)) * 180) / Math.PI;
    expect(dropDeg).toBeGreaterThan(40);
    expect(dropDeg).toBeLessThan(60);
    // Bone-local translations are untouched, which is what keeps closure exact above.
    expect(rig.byName.upperarm_L.position.y).toBeCloseTo(REST_OFFSET_BY_NAME.upperarm_L[1] * H, 12);
  });
});

describe('doc 07 §4 / doc 06 §1.3 — anthropometry lands where the contract says', () => {
  it('the vertex is at 1.000 H and the figure is 7.7 heads, not 8', () => {
    expect(wp('head_end').y / H).toBeCloseTo(1.0, 6);
    const heads = 1 / ANTHRO.HEAD_HEIGHT!.v;
    expect(heads).toBeCloseTo(7.6923, 3);
    expect(heads, 'the doc 07 §4 anti-heroic gate: 8 heads is an automatic fail').toBeLessThan(7.9);
  });

  it('every doc 06 §1.3 bind-pose joint height is reproduced by the built rig', () => {
    const rows: readonly (readonly [BoneName, keyof typeof JOINT_Y])[] = [
      ['pelvis', 'HJC'],
      ['calf_L', 'KJC'],
      ['foot_L', 'AJC'],
      ['neck_01', 'CERVICALE'],
      ['head', 'AOJ'],
      ['head_end', 'VERTEX'],
    ];
    for (const [bone, key] of rows) {
      const want = JOINT_Y[key]!.v;
      const got = wp(bone).y / H;
      // CERVICALE is doc 06 §1.3's C7 landmark, and `neck_01`'s own comment names it "C7/T1", so a
      // few mm of disagreement is the landmark, not the chain. Everything else must be exact.
      const tol = key === 'CERVICALE' ? 0.02 : 1e-4;
      expect(Math.abs(got - want), `${bone} y (${key}) = ${got.toFixed(4)}`).toBeLessThan(tol);
    }
  });

  it('the SJC / GH lateral offset is doc 06 §1.4\'s ±0.098 H, on the correct sides', () => {
    // doc 06 §1.4's `rig.SJC.x = ±0.098` is a T-POSE GENERATION-SPACE number: SC joint 0.011 plus
    // the clavicle's own 0.087. Assert it on the local offsets, which the A-pose rebake never moves.
    for (const h of ['L', 'R'] as const) {
      const sign = h === 'L' ? -1 : 1;
      const local =
        (rig.byName[`clavicle_${h}`].position.x + rig.byName[`upperarm_${h}`].position.x) / H;
      expect(local).toBeCloseTo(sign * ANTHRO.SJC_X!.v, 6);
    }
    // In the A-POSE BIND the 6° clavicle depression tips the SC->SJC vector, so the world SJC sits a
    // few mm inboard of 0.098 H. That is what a depressed clavicle does; it is not a rig error, and
    // pinning the world value to 0.098 would be pinning the wrong pose.
    expect(Math.abs(wp('upperarm_L').x / H)).toBeCloseTo(0.0944, 3);
    expect(Math.abs(wp('upperarm_L').x / H) - ANTHRO.SJC_X!.v).toBeGreaterThan(-0.005);
    expect(wp('upperarm_L').x).toBeLessThan(0);
    expect(wp('upperarm_R').x).toBeGreaterThan(0);
    // Hips carry no A-pose rotation, so they ARE exact.
    expect(wp('thigh_L').x / H).toBeCloseTo(-ANTHRO.HJC_X!.v, 9);
    expect(wp('thigh_R').x / H).toBeCloseTo(ANTHRO.HJC_X!.v, 9);
  });

  it('the heel landmark is doc 06\'s 0.0415 H behind the AJC (conflict C15, rig side)', () => {
    const lm = createLandmarks();
    sampleLandmarks(rig, 0, lm);
    const ajc = wp('foot_L');
    expect((lm.heelL[2]! - ajc.z) / H).toBeCloseTo(HEEL_OFFSET_H[2], 6);
    expect(lm.heelL[1]! / H).toBeCloseTo(JOINT_Y.AJC!.v + HEEL_OFFSET_H[1], 6);
  });
});

describe('§3.13 / BRIEFS B4 — sampleLandmarks', () => {
  it('STAMPS out.tick', () => {
    const out = createLandmarks();
    expect(out.tick).toBe(0);
    sampleLandmarks(rig, 12345, out);
    expect(out.tick).toBe(12345);
    sampleLandmarks(rig, 0, out);
    expect(out.tick).toBe(0);
    sampleLandmarks(rig, 209856, out);
    expect(out.tick).toBe(209856);
  });

  it('fills all 25 canonical joints with finite world positions and unit quaternions', () => {
    const out = createLandmarks();
    sampleLandmarks(rig, 7, out);
    expect(out.pos).toHaveLength(CANONICAL_JOINTS.length * 3);
    for (let i = 0; i < CANONICAL_JOINTS.length; i++) {
      for (let k = 0; k < 3; k++) expect(Number.isFinite(out.pos[i * 3 + k]!)).toBe(true);
      const qn = Math.hypot(
        out.quat[i * 4]!, out.quat[i * 4 + 1]!, out.quat[i * 4 + 2]!, out.quat[i * 4 + 3]!,
      );
      expect(qn, `${CANONICAL_JOINTS[i]} quat`).toBeCloseTo(1, 5);
    }
  });

  it('the virtual *FistCenter is 0.030 H beyond the wrist along the hand axis', () => {
    const out = createLandmarks();
    sampleLandmarks(rig, 0, out);
    for (const [hand, fist] of [
      ['LeftHand', 'LeftFistCenter'],
      ['RightHand', 'RightFistCenter'],
    ] as const) {
      const hi = CANONICAL_JOINTS.indexOf(hand);
      const fi = CANONICAL_JOINTS.indexOf(fist);
      const d = Math.hypot(
        out.pos[fi * 3]! - out.pos[hi * 3]!,
        out.pos[fi * 3 + 1]! - out.pos[hi * 3 + 1]!,
        out.pos[fi * 3 + 2]! - out.pos[hi * 3 + 2]!,
      );
      expect(d / H).toBeCloseTo(0.03, 6);
    }
    // ...and it points DISTALLY, i.e. further from the shoulder than the wrist is.
    const gh = new Vector3(out.ghL[0]!, out.ghL[1]!, out.ghL[2]!);
    const wrist = CANONICAL_JOINTS.indexOf('LeftHand');
    const fist = CANONICAL_JOINTS.indexOf('LeftFistCenter');
    const dw = gh.distanceTo(new Vector3(out.pos[wrist * 3]!, out.pos[wrist * 3 + 1]!, out.pos[wrist * 3 + 2]!));
    const df = gh.distanceTo(new Vector3(out.pos[fist * 3]!, out.pos[fist * 3 + 1]!, out.pos[fist * 3 + 2]!));
    expect(df).toBeGreaterThan(dw);
  });

  /**
   * doc 06 §2.1 computes the bind-pose whole-body COM at **0.5683 H** and says explicitly: "use as a
   * unit test (`assert |COM_y/H − 0.568| < 0.008`)". That is a genuinely independent check of this
   * block: the COM comes out of `SEG_MASS` x `SEG_COM_PCT` (B1's transcription of de Leva Table 4)
   * evaluated on the BUILT skeleton's own world matrices, so it can only land inside the band if the
   * bone tree, the flip, the A-pose rebake and the segment endpoint choices are all right.
   */
  it('the whole-body COM reproduces doc 06 §2.1 to its own stated tolerance', () => {
    const out = createLandmarks();
    sampleLandmarks(rig, 0, out);
    // The skeleton is bilaterally exact (only the MESH carries §10's 1.2 % asymmetry), so the COM's
    // x must be zero to machine precision. A non-zero x here is a mirrored-limb bug.
    expect(Math.abs(out.comXZ[0]!) / H).toBeLessThan(1e-9);
    const com = bodyCentreOfMass(rig, out, new Vector3());
    expect(Math.abs(com.y / H - COM_Y_BIND_H.v)).toBeLessThan(COM_Y_BIND_H.tol);
    expect(COM_Y_BIND_H.v).toBeCloseTo(0.5683, 4);
    expect(COM_Y_BIND_H.tol).toBeCloseTo(0.008, 4);
  });
});

describe('B4 — capsules, AABB and build budget', () => {
  it('boneAABB encloses every body vertex (it is the shadow-fit source, §5.5)', () => {
    const box = boneAABB(rig, new Box3());
    const pos = rig.body.geometry.getAttribute('position');
    let outside = 0;
    for (let i = 0; i < pos.count; i++) {
      if (!box.containsPoint(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)))) outside++;
    }
    expect(outside, 'capsule envelope must be a superset of the skin').toBe(0);
    // §5.5's Mode B fit is 0.75 H = 1.31 m; the bind-pose figure must be comfortably inside it.
    const size = box.getSize(new Vector3());
    expect(Math.max(size.x, size.z)).toBeLessThan(2 * 0.75 * H);
  });

  it('the body mesh is ~3.9 k verts, the vertex budget of doc 06 §5.1', () => {
    const stats = karatekaStats()!;
    expect(stats.bodyVertices).toBeGreaterThan(3000);
    expect(stats.bodyVertices).toBeLessThan(5200);
    const giTotal = Object.values(stats.giVertices).reduce((a, b) => a + b, 0);
    expect(giTotal).toBeGreaterThan(1200);
    // §5.6's draw-call budget for the figure: body 1 + gi 4 + eyes 2 + hair 1.
    expect(stats.drawCalls).toBe(8);
  });

  /**
   * Signed volume `V = 1/6 * sum(v0 . (v1 x v2))` is positive iff the triangles wind
   * counter-clockwise seen from OUTSIDE. Getting this wrong is the classic procedural-mesh failure:
   * with `side: FrontSide` everywhere (§5.5 — there is no `DoubleSide` in this project) an
   * inside-out shell renders as a HOLE in the figure, and `M_MASK`'s silhouette and the shadow caster
   * both go with it. Nothing else in the project can see it without a picture.
   */
  it('every body shell winds OUTWARD — positive signed volume', () => {
    const p = rig.body.geometry.getAttribute('position');
    const idx = rig.body.geometry.getIndex()!;
    let v6 = 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let f = 0; f < idx.count; f += 3) {
      a.set(p.getX(idx.getX(f)), p.getY(idx.getX(f)), p.getZ(idx.getX(f)));
      b.set(p.getX(idx.getX(f + 1)), p.getY(idx.getX(f + 1)), p.getZ(idx.getX(f + 1)));
      c.set(p.getX(idx.getX(f + 2)), p.getY(idx.getX(f + 2)), p.getZ(idx.getX(f + 2)));
      v6 += a.dot(b.clone().cross(c));
    }
    const volume = v6 / 6;
    expect(volume, 'negative volume = inside-out winding = the figure renders as a hole').toBeGreaterThan(0);
    // A 70 kg human at ~1010 kg/m^3 displaces ~0.069 m^3. Overlapping shells double-count the
    // shoulder and hip junctions, so the sum runs a little high; an order-of-magnitude check is
    // what this is for.
    expect(volume).toBeGreaterThan(0.04);
    expect(volume).toBeLessThan(0.13);
  });

  /**
   * doc 06 §7.6: the collider radii are deliberately larger than the mesh radii "so the gi never sits
   * ON the skin (that causes z-fighting and shading pops)". The GEOMETRY has to honour the same rule
   * before cloth ever runs, because the skinned bind IS what `seek(tick, 'preview')` pins to (§6.4).
   */
  it('the gi CLEARS the skin — no z-fighting between garment and body', () => {
    /** Sagittal band only, so the A-posed arms and the sleeves stay out of a torso measurement. */
    const depthAt = (attr: ReturnType<typeof rig.body.geometry.getAttribute>, loH: number, hiH: number) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < attr.count; i++) {
        const y = attr.getY(i) / H;
        if (y < loH || y > hiH) continue;
        if (Math.abs(attr.getX(i)) / H > 0.03) continue;
        const d = Math.abs(attr.getZ(i)) / H;
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
      return { min, max };
    };
    const skinChest = depthAt(rig.body.geometry.getAttribute('position'), 0.74, 0.78);
    const giChest = depthAt(rig.gi.uwagi.geometry.getAttribute('position'), 0.74, 0.78);
    expect(
      giChest.min,
      `uwagi front/back at ${giChest.min.toFixed(4)} H vs chest at ${skinChest.max.toFixed(4)} H`,
    ).toBeGreaterThan(skinChest.max);
    // doc 06 §7.10 rule 1: the ease is 0.020 H (3.5 cm) — boxy, not fitted.
    expect(giChest.min - skinChest.max).toBeGreaterThan(0.012);

    /** Calf band: measure from the leg's OWN axis, since the two legs are off the midline. */
    const legAxis = wp('thigh_L');
    const legRadius = (attr: ReturnType<typeof rig.body.geometry.getAttribute>) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < attr.count; i++) {
        const y = attr.getY(i) / H;
        if (y < 0.18 || y > 0.24) continue;
        if (attr.getX(i) > 0) continue; // the character's LEFT leg is at world -X (§2.1)
        const d = Math.hypot(attr.getX(i) - legAxis.x, attr.getZ(i) - legAxis.z) / H;
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
      return { min, max };
    };
    const skinCalf = legRadius(rig.body.geometry.getAttribute('position'));
    const giCalf = legRadius(rig.gi.zubon.geometry.getAttribute('position'));
    expect(
      giCalf.min,
      `zubon at ${giCalf.min.toFixed(4)} H vs calf at ${skinCalf.max.toFixed(4)} H`,
    ).toBeGreaterThan(skinCalf.max);
    // Rule 3: trousers are VERY wide — the ease ratio at the hem is 2.1 against a 0.020 H ankle.
    expect(giCalf.min / skinCalf.max).toBeGreaterThan(1.2);
  });

  it('the figure stands ON the floor: the lowest body vertex is at y = 0', () => {
    const pos = rig.body.geometry.getAttribute('position');
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    expect(minY / H).toBeGreaterThan(-1e-6);
    expect(minY / H).toBeLessThan(0.004);
  });
});
