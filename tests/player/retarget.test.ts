/**
 * B6 PLAYER — the two-axis bone frame that `src/player/retarget.ts` bakes with.
 *
 * Imports `src/player/boneBasis` DIRECTLY, not the block barrel and not `retarget` itself: the
 * barrel pulls `./character` -> `GLTFLoader`, and `retarget` pulls `BVHLoader`. This module's only
 * import is `three`'s math, so the whole of the retarget's geometry is checkable in Node with no
 * renderer, no GLB and no capture file — which is exactly why the frame construction was split out
 * of `retarget` in the first place. The parts that need a rig (which reference each bone reads,
 * whether a rest arm is straight enough to name a plane) are measured against the real skeletons
 * and recorded in that file's header; they are not unit-testable and are not faked here.
 */

import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  MIN_AXIS_SEPARATION,
  MIN_BEND_SIN,
  bendPlaneNormal,
  frameAlign,
  orthonormalFrame,
} from '../../src/player/boneBasis';

const X = (): Vector3 => new Vector3(1, 0, 0);
const Y = (): Vector3 => new Vector3(0, 1, 0);
const Z = (): Vector3 => new Vector3(0, 0, 1);

/** The three basis vectors a frame quaternion maps the canonical axes onto. */
function axesOf(q: Quaternion): { x: Vector3; y: Vector3; z: Vector3 } {
  return {
    x: X().applyQuaternion(q),
    y: Y().applyQuaternion(q),
    z: Z().applyQuaternion(q),
  };
}

const angleDeg = (a: Vector3, b: Vector3): number =>
  (Math.acos(Math.min(1, Math.max(-1, a.clone().normalize().dot(b.clone().normalize())))) * 180) /
  Math.PI;

/** Deterministic pseudo-random unit vectors — a fixed seed, so a failure is reproducible. */
function* unitVectors(count: number): Generator<Vector3> {
  let s = 20250802;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    yield new Vector3(r * Math.cos(t), r * Math.sin(t), z);
  }
}

describe('orthonormalFrame', () => {
  it('is orthonormal, right-handed, and keeps the primary axis exactly', () => {
    const primary = new Vector3(0.3, -0.9, 0.2);
    const secondary = new Vector3(0.8, 0.1, -0.4);
    const q = orthonormalFrame(primary, secondary);
    expect(q).not.toBeNull();
    const { x, y, z } = axesOf(q!);

    for (const v of [x, y, z]) expect(v.length()).toBeCloseTo(1, 10);
    expect(x.dot(y)).toBeCloseTo(0, 10);
    expect(y.dot(z)).toBeCloseTo(0, 10);
    expect(z.dot(x)).toBeCloseTo(0, 10);
    /* right-handed: z == x cross y, not its negation */
    expect(new Vector3().crossVectors(x, y).distanceTo(z)).toBeCloseTo(0, 10);
    /* the direction match in retarget.ts rides on this one: the primary survives untouched */
    expect(angleDeg(x, primary)).toBeCloseTo(0, 8);
  });

  it('puts the secondary in the +XY half-plane — the roll it reports is the roll asked for', () => {
    const primary = X();
    const secondary = new Vector3(0.5, 0, 0.87);
    const { y } = axesOf(orthonormalFrame(primary, secondary)!);
    /* the secondary, with its primary component removed, is +Z here */
    expect(angleDeg(y, Z())).toBeCloseTo(0, 6);
    expect(y.dot(secondary)).toBeGreaterThan(0);
  });

  it('is scale invariant — callers pass unnormalised bone offsets', () => {
    const a = orthonormalFrame(new Vector3(0, 4, 0), new Vector3(9, 0, 0))!;
    const b = orthonormalFrame(new Vector3(0, 1, 0), new Vector3(1, 0, 0))!;
    expect(a.angleTo(b)).toBeCloseTo(0, 10);
  });

  it('refuses a parallel, an antiparallel and a zero-length secondary rather than emitting NaN', () => {
    expect(orthonormalFrame(Y(), Y())).toBeNull();
    expect(orthonormalFrame(Y(), new Vector3(0, -3, 0))).toBeNull();
    expect(orthonormalFrame(Y(), new Vector3(0, 0, 0))).toBeNull();
    expect(orthonormalFrame(new Vector3(0, 0, 0), Y())).toBeNull();
  });

  it('refuses exactly at the separation threshold, and accepts just past it', () => {
    /* a secondary MIN_AXIS_SEPARATION off the primary sits right on the boundary */
    const justUnder = Math.asin(MIN_AXIS_SEPARATION) - 1e-4;
    const justOver = Math.asin(MIN_AXIS_SEPARATION) + 1e-4;
    const at = (rad: number): Vector3 => new Vector3(Math.cos(rad), 0, Math.sin(rad));
    expect(orthonormalFrame(X(), at(justUnder))).toBeNull();
    expect(orthonormalFrame(X(), at(justOver))).not.toBeNull();
  });

  it('never returns a non-finite component, whatever it is fed', () => {
    for (const primary of unitVectors(40)) {
      for (const secondary of unitVectors(3)) {
        const q = orthonormalFrame(primary, secondary);
        if (q === null) continue;
        for (const c of [q.x, q.y, q.z, q.w]) expect(Number.isFinite(c)).toBe(true);
        expect(q.length()).toBeCloseTo(1, 10);
      }
    }
  });
});

describe('frameAlign', () => {
  it('aligning a frame with itself is the identity', () => {
    const p = new Vector3(0.2, 0.5, -0.84);
    const s = new Vector3(-0.7, 0.1, 0.3);
    const a = frameAlign(p, s, p, s);
    expect(a).not.toBeNull();
    /* 6 places, not 9: the frame goes through a rotation matrix on the way to a quaternion, which
     * costs ~4e-8 rad. Two orders of magnitude below the 0.01° the bake is measured at. */
    expect(a!.angleTo(new Quaternion())).toBeCloseTo(0, 6);
  });

  it('carries the target primary exactly onto the source primary — direction stays exact', () => {
    for (const pSrc of unitVectors(24)) {
      /* built by cross product, so it is exactly perpendicular and never degenerate */
      const seed = Math.abs(pSrc.z) < 0.9 ? Z() : X();
      const sSrc = new Vector3().crossVectors(pSrc, seed).normalize();
      const pTgt = new Vector3(0, 1, 0);
      const sTgt = new Vector3(1, 0, 0);
      const a = frameAlign(pSrc, sSrc, pTgt, sTgt);
      expect(a).not.toBeNull();
      expect(angleDeg(pTgt.clone().applyQuaternion(a!), pSrc)).toBeLessThan(1e-4);
    }
  });

  it('carries the target roll reference onto the source one, up to the primary component', () => {
    const pSrc = new Vector3(0, 0, 1);
    const sSrc = new Vector3(1, 0, 0.4);
    const pTgt = new Vector3(0, 1, 0);
    const sTgt = new Vector3(0, -0.3, 1);
    const a = frameAlign(pSrc, sSrc, pTgt, sTgt)!;
    const moved = sTgt.clone().applyQuaternion(a);
    /* compare only the parts perpendicular to the (now shared) primary: that is the roll */
    const perp = (v: Vector3, axis: Vector3): Vector3 =>
      v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
    const axis = pSrc.clone().normalize();
    expect(angleDeg(perp(moved, axis), perp(sSrc, axis))).toBeCloseTo(0, 6);
  });

  it('recovers the rotation between two rigs that differ by exactly that rotation', () => {
    const p = new Vector3(0, 1, 0);
    const s = new Vector3(0, 0.2, 1);
    for (const axis of unitVectors(12)) {
      const q = new Quaternion().setFromAxisAngle(axis, 1.1);
      const a = frameAlign(p.clone().applyQuaternion(q), s.clone().applyQuaternion(q), p, s)!;
      expect(a.angleTo(q)).toBeCloseTo(0, 6);
    }
  });

  it('is null when EITHER rig is degenerate, so the caller can fall back', () => {
    const p = new Vector3(0, 1, 0);
    const s = new Vector3(1, 0, 0);
    expect(frameAlign(p, p, p, s)).toBeNull();
    expect(frameAlign(p, s, p, p)).toBeNull();
    expect(frameAlign(p, s, p, s)).not.toBeNull();
  });
});

describe('bendPlaneNormal', () => {
  it('names the plane of a bent chain and is perpendicular to both segments', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 0, 0);
    const c = new Vector3(1, 1, 0);
    const n = bendPlaneNormal(a, b, c);
    expect(n).not.toBeNull();
    expect(n!.length()).toBeCloseTo(1, 10);
    expect(n!.dot(b.clone().sub(a))).toBeCloseTo(0, 10);
    expect(n!.dot(c.clone().sub(b))).toBeCloseTo(0, 10);
    expect(angleDeg(n!, new Vector3(0, 0, 1))).toBeCloseTo(0, 6);
  });

  it('is a pseudovector: mirroring the chain flips it', () => {
    const n = bendPlaneNormal(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 1, 0))!;
    const m = bendPlaneNormal(new Vector3(0, 0, 0), new Vector3(-1, 0, 0), new Vector3(-1, 1, 0))!;
    expect(angleDeg(n, m)).toBeCloseTo(180, 4);
  });

  it('is null for a straight chain — a straight limb has no bend plane', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(0, 0, 26.08);
    const c = new Vector3(0, 0, 51.58); // heian-nidan.bvh's rest left arm, to the decimal
    expect(bendPlaneNormal(a, b, c)).toBeNull();
    expect(bendPlaneNormal(a, b, new Vector3(0, 0, -10))).toBeNull(); // folded back on itself
  });

  it('is null for a coincident joint pair, not NaN', () => {
    const a = new Vector3(1, 2, 3);
    expect(bendPlaneNormal(a, a, new Vector3(4, 5, 6))).toBeNull();
    expect(bendPlaneNormal(a, new Vector3(4, 5, 6), new Vector3(4, 5, 6))).toBeNull();
  });

  it('accepts a bend as slight as the character rig’s 1.97° elbow pre-bend', () => {
    /* AnimLib's Rigify bind: forearm 5 mm behind the shoulder-to-wrist line over 0.27 m. That is
     * the modeller's IK pole hint and it is the only elbow plane the target rig has. */
    const shoulder = new Vector3(0.1919, 1.4408, -0.0654);
    const elbow = new Vector3(0.4663, 1.4408, -0.0701);
    const wrist = new Vector3(0.7389, 1.4408, -0.0654);
    const n = bendPlaneNormal(shoulder, elbow, wrist);
    expect(n).not.toBeNull();
    expect(angleDeg(n!, new Vector3(0, -1, 0))).toBeLessThan(1);
    /* and the threshold is what lets it through */
    expect(Math.sin((1.97 * Math.PI) / 180)).toBeGreaterThan(MIN_BEND_SIN);
  });
});
