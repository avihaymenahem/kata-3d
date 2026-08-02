/**
 * B6 PLAYER — `src/player/boneBasis.ts` — orthonormal bone frames, and the rotation between two.
 *
 * ═══ WHY THIS EXISTS ═════════════════════════════════════════════════════════════════════════
 *
 * `./retarget` used to align a single axis — the bone's direction toward its child — from the
 * capture onto the character. One axis fixes two of a rotation's three degrees of freedom and
 * leaves the third, the TWIST ABOUT THAT AXIS, free. `Quaternion.setFromUnitVectors` resolves the
 * free one by taking the shortest arc, which is a defensible tie-break and an arbitrary answer:
 * nothing about the shortest arc has anything to do with which way a palm faces.
 *
 * Measured on `heian-nidan.bvh`, that arbitrariness cost 179.5° on the right fist at the strongest
 * chudan zuki in the take — the fist arrived palm-UP. Two axes remove the freedom entirely.
 *
 * ═══ THE MATH ════════════════════════════════════════════════════════════════════════════════
 *
 * A PRIMARY axis `p` and any SECONDARY reference `s` not parallel to it name a full orthonormal
 * frame: `x = p̂`, `y = normalize(s - (s·x)x)`, `z = x × y`. Written as a quaternion `B`, that frame
 * is "the rotation taking the canonical axes onto this bone's anatomical ones".
 *
 * Given such a frame on each rig, the alignment `A = B_src · B_tgt⁻¹` satisfies
 *
 *     tgtWorld = srcWorld · A     ⇒     tgtWorld · B_tgt == srcWorld · B_src
 *
 * i.e. the two bones' anatomical frames coincide in world space. Taking the first column back out
 * gives `tgtWorld · p_tgt == srcWorld · p_src` — the direction match `./retarget` already had,
 * unchanged and still exact — and the second column pins the twist that used to be free.
 *
 * ═══ DEGENERACY IS NOT AN EDGE CASE HERE, IT IS THE COMMON CASE ══════════════════════════════
 *
 * As `s` approaches `p` the residual `y` shrinks and its DIRECTION becomes noise: an error of ε in
 * `s` lands as roughly `ε / sin θ` of twist. Rigs hit this constantly — a reference of "up" on a
 * thigh that hangs straight down is exactly antiparallel — so every entry point returns `null`
 * rather than a NaN-laden quaternion, and the caller falls back to single-axis alignment. Silent
 * NaN in a bake is the worst outcome available: it survives into the clip and poses the mesh at
 * the origin with no error anywhere.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Smallest |sin θ| between primary and secondary that still yields a usable frame. 0.15 ≈ 8.6°,
 * at which a 1° error in the reference becomes ~6.7° of twist — the point where a two-axis answer
 * stops being better than admitting we do not know.
 */
export const MIN_AXIS_SEPARATION = 0.15;

/**
 * Smallest |sin θ| between two consecutive segments for their cross product to name a plane.
 * Deliberately far looser than `MIN_AXIS_SEPARATION`, because the quantity is different: the
 * normal of a thin triangle is poorly SCALED but perfectly well DIRECTED, and it is only ever used
 * as a direction. AnimLib's Rigify bind pre-bends the elbow by 1.97° and the knee by 4.19° — the
 * modeller's IK pole hints, which is exactly the anatomical fact wanted here, and a 2° triangle
 * over a 0.27 m segment is four orders of magnitude above float noise.
 */
export const MIN_BEND_SIN = 0.02;

const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();

/**
 * The orthonormal frame `(p̂, ŝ⊥, p̂ × ŝ⊥)` as a quaternion, or `null` if `s` is too close to `p`
 * (or either is degenerate) for the frame to mean anything.
 *
 * `primary` survives exactly — it is the first basis vector, untouched by the orthogonalisation,
 * which is what keeps the direction match in `./retarget` exact to the last bit. Only the
 * SECONDARY is projected, so all of the approximation lands on the axis that was arbitrary before.
 */
export function orthonormalFrame(
  primary: Vector3,
  secondary: Vector3,
  out: Quaternion = new Quaternion(),
): Quaternion | null {
  if (primary.lengthSq() < 1e-12 || secondary.lengthSq() < 1e-12) return null;
  _x.copy(primary).normalize();
  _y.copy(secondary).normalize();
  /* project the secondary off the primary; because both are unit, what is left has length sin θ */
  _y.addScaledVector(_x, -_y.dot(_x));
  if (_y.length() < MIN_AXIS_SEPARATION) return null;
  _y.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * The constant rotation `A` with `tgtWorld = srcWorld · A` that makes the two bones' anatomical
 * frames coincide — so the segment points the same way AND rolls the same way about itself.
 *
 * `null` when either rig's frame is degenerate. The caller must then fall back rather than guess:
 * the two rigs are not describing the same thing, and a made-up second axis is worse than an
 * admittedly arbitrary twist, because it looks deliberate.
 */
export function frameAlign(
  primarySrc: Vector3,
  secondarySrc: Vector3,
  primaryTgt: Vector3,
  secondaryTgt: Vector3,
  out: Quaternion = new Quaternion(),
): Quaternion | null {
  const bSrc = orthonormalFrame(primarySrc, secondarySrc, new Quaternion());
  if (bSrc === null) return null;
  const bTgt = orthonormalFrame(primaryTgt, secondaryTgt, new Quaternion());
  if (bTgt === null) return null;
  return out.copy(bSrc).multiply(bTgt.invert());
}

/**
 * Unit normal of the plane through three joint positions — the bend plane of the middle joint.
 *
 * `null` when the three are collinear to within `MIN_BEND_SIN`, which is the honest answer for a
 * limb modelled dead straight: a straight arm's bend plane does not exist, and a capture whose
 * rest arm is straight has to recover it from the motion instead (see `./retarget`).
 *
 * The result is a PSEUDOVECTOR — mirroring the three points negates it — so a left and a right
 * limb of the same rig return opposite normals. That is harmless as long as both rigs are measured
 * with the same argument order, because the alignment negates BOTH secondaries and
 * `B·Rx(180°) · (B'·Rx(180°))⁻¹ == B · B'⁻¹`. Sign handling is therefore deliberately absent.
 */
export function bendPlaneNormal(
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  out: Vector3 = new Vector3(),
): Vector3 | null {
  _x.copy(p1).sub(p0);
  _y.copy(p2).sub(p1);
  if (_x.lengthSq() < 1e-12 || _y.lengthSq() < 1e-12) return null;
  _x.normalize();
  _y.normalize();
  out.crossVectors(_x, _y);
  /* both are unit, so |cross| IS sin(angle between the segments) */
  if (out.length() < MIN_BEND_SIN) return null;
  return out.normalize();
}
