/**
 * B6 PLAYER — the pure core of `src/player/facialHair`.
 *
 * Imported DIRECTLY, not through the block barrel: the barrel pulls `./character`, which pulls
 * `GLTFLoader`. This module's own dependency on `Character` is `import type` and therefore erased,
 * so what is left is three's `Vector3` and arithmetic — Node safe.
 *
 * `attachFacialHair` needs a skinned GLB and cannot run here. The two things factored out of it are
 * the two whose failure is silent: the axis derivation, which decides whether the mustache lands on
 * the face or on the back of the skull, and the cross-section, whose winding order decides whether
 * it renders at all.
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';

import { MUSTACHE_SECTION, faceAxes } from '../../src/player/facialHair';

/** `AnimLib.glb`'s bind pose: shoulder joints at ±0.192 m, z = −0.065. */
const SHOULDER_L = new Vector3(0.192, 1.441, -0.065);
const SHOULDER_R = new Vector3(-0.192, 1.441, -0.065);

describe('faceAxes — which way the head is pointing', () => {
  /**
   * The convention `gi.ts` §2 documents, checked against the rig it was measured on rather than
   * asserted. Rigify keeps Blender's bone-local axes and the pelvis's local "up" is +Z, so a file
   * that ASSUMES the world convention here is one bind pose away from a mustache on an ear.
   */
  it('recovers +X left and +Z forward from this rig’s shoulders', () => {
    const a = faceAxes(SHOULDER_L, SHOULDER_R)!;
    expect(a.left.x).toBeCloseTo(1, 12);
    expect(a.fwd.z).toBeCloseTo(1, 12);
    expect(a.left.y).toBe(0);
    expect(a.fwd.y).toBeCloseTo(0, 12);
  });

  it('turns with the body instead of returning a constant', () => {
    /* The same shoulders, yawed 90° so the figure faces −X. Forward must follow. */
    const yaw = (v: Vector3): Vector3 => new Vector3(-v.z, v.y, v.x);
    const a = faceAxes(yaw(SHOULDER_L), yaw(SHOULDER_R))!;
    expect(a.left.z).toBeCloseTo(1, 12);
    expect(a.fwd.x).toBeCloseTo(-1, 12);
  });

  it('ignores a shoulder height difference rather than tilting the face', () => {
    /* An A-pose or an asymmetric bind must not roll the mustache off the horizontal. */
    const a = faceAxes(new Vector3(0.192, 1.52, -0.065), SHOULDER_R)!;
    expect(a.left.y).toBe(0);
    expect(a.left.length()).toBeCloseTo(1, 12);
    expect(a.fwd.dot(a.left)).toBeCloseTo(0, 12);
  });

  it('is right-handed: left × up = fwd, and fwd is a unit vector', () => {
    const a = faceAxes(SHOULDER_L, SHOULDER_R)!;
    const cross = new Vector3().crossVectors(a.left, new Vector3(0, 1, 0));
    expect(a.fwd.distanceTo(cross)).toBeCloseTo(0, 12);
    expect(a.fwd.length()).toBeCloseTo(1, 12);
  });

  it('returns null on coincident shoulders instead of a NaN basis', () => {
    expect(faceAxes(SHOULDER_L, SHOULDER_L.clone())).toBeNull();
    /* Purely vertical separation projects to nothing in the horizontal plane. */
    expect(faceAxes(new Vector3(0, 1.6, 0), new Vector3(0, 1.4, 0))).toBeNull();
  });
});

describe('MUSTACHE_SECTION — the cross-section swept across the face', () => {
  /**
   * ═══ THE OWNER ASKED FOR RECTANGULAR ═════════════════════════════════════════════════════
   *
   * A first version swept a lens and tapered it to a point at each end, and the correction was
   * explicit: one piece, rectangular, not pointy. What makes a silhouette rectangular is not the
   * absence of curves, it is the presence of STRAIGHT RUNS — a pair of columns sharing a `b` of
   * exactly ±1 is a flat top and a flat bottom, and those are the two edges you actually see on a
   * mustache viewed from the front.
   */
  it('has a flat top and a flat bottom, each two columns wide', () => {
    const top = MUSTACHE_SECTION.filter(([b]) => b === 1);
    const bottom = MUSTACHE_SECTION.filter(([b]) => b === -1);
    expect(top.length).toBe(2);
    expect(bottom.length).toBe(2);
  });

  it('is symmetric top to bottom, so the block does not lean', () => {
    for (const [b, a] of MUSTACHE_SECTION) {
      expect(MUSTACHE_SECTION.some(([b2, a2]) => b2 === -b && a2 === a)).toBe(true);
    }
  });

  /**
   * Winding. `gi.ts` §2's rule is that one triangle order gives outward normals everywhere as long
   * as `u × v` is the direction rows advance along; here `u` is up, `v` is outward, and the sweep
   * runs toward the wearer's left. Reverse the column order and every triangle faces inward, which
   * on a FrontSide material is not subtly wrong — the mustache simply is not there.
   */
  it('is wound counter-clockwise in the (up, outward) plane', () => {
    let area2 = 0;
    for (let i = 0; i < MUSTACHE_SECTION.length; i++) {
      const [b0, a0] = MUSTACHE_SECTION[i]!;
      const [b1, a1] = MUSTACHE_SECTION[(i + 1) % MUSTACHE_SECTION.length]!;
      area2 += b0 * a1 - b1 * a0;
    }
    expect(area2).toBeGreaterThan(0);
  });

  it('is convex, so no column folds back through its neighbours', () => {
    const n = MUSTACHE_SECTION.length;
    for (let i = 0; i < n; i++) {
      const p = MUSTACHE_SECTION[i]!;
      const q = MUSTACHE_SECTION[(i + 1) % n]!;
      const r = MUSTACHE_SECTION[(i + 2) % n]!;
      const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
      expect(cross).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays inside the unit box, so the half-extents mean what they say', () => {
    for (const [b, a] of MUSTACHE_SECTION) {
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
      expect(Math.abs(a)).toBeLessThanOrEqual(1);
    }
    /* Reaches it in both axes, or the block is smaller than the dimensions that name it. */
    expect(MUSTACHE_SECTION.some(([b]) => b === 1)).toBe(true);
    expect(MUSTACHE_SECTION.some(([, a]) => a === 1)).toBe(true);
  });

  /**
   * The corner radius is a tenth of the section and not zero: `computeVertexNormals` averages a
   * truly square corner into a hard shading seam running the length of the block, and a mustache
   * with a bright line down its top edge reads as moulded plastic.
   */
  it('rounds its corners rather than meeting at right angles', () => {
    const corners = MUSTACHE_SECTION.filter(([b, a]) => Math.abs(b) !== 1 && Math.abs(a) !== 1);
    expect(corners.length).toBe(0);
    /* Every column is either on a flat run or on the chamfer between two — eight columns, four
     * flats of two each, which is what makes the silhouette read as four straight edges. */
    expect(MUSTACHE_SECTION.length).toBe(8);
  });
});
