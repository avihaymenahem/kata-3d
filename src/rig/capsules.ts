/**
 * B4 RIG — `src/rig/capsules.ts`
 *
 * `buildCapsules` / `updateCapsules` / `boneAABB` — §3.13.
 *
 * The `CapsuleSet` of §3.4.1 is plain typed arrays on purpose: B7 may not import `three` at all, so
 * this is the whole interface between the rig's bone matrices and the cloth's collision pass.
 *
 * Radii come from the FROZEN `CAPSULES` table in `src/contracts/rig.ts`, which ships **16** capsules
 * plus the `y = 0` floor plane — doc 06 §7.6's summary row says 15 but its own table expands to 16
 * and §7.5's cost calculation uses 16, so the table wins (§2.6). The radii are deliberately
 * 0.004–0.008 H larger than `LIMB_R`'s mesh radii so the gi never sits ON the skin, which is what
 * causes z-fighting and shading pops.
 */

import { Box3, Matrix4, Vector3 } from 'three';
import { BONE_ORDER, CAPSULES, H, type BoneName, type RigHandles } from '../contracts';
import { LIMB_R } from '../data';
import { authoredOffsetToBuiltM } from './bones';

/**
 * §3.4.1's `CapsuleSet`, declared HERE because that section puts it in `src/rig/index.ts`: it is B4's
 * type, frozen in shape, and it is deliberately plain typed arrays because B7 may not import `three`
 * at all (§3 import discipline) and consumes this as raw numbers.
 */
export interface CapsuleSet {
  readonly count: number;
  readonly a: Float32Array; // count*3, world metres
  readonly b: Float32Array; // count*3
  readonly r: Float32Array; // count, world metres
  readonly ids: readonly string[];
}

const _a = new Vector3();
const _b = new Vector3();
const _off = new Vector3();
const _m = new Matrix4();
const _axis = new Vector3();

/**
 * A sphere capsule (`b === null`) still needs a segment, or the cloth's segment-distance test
 * divides by zero. We give it a degenerate segment of length `SPHERE_SPAN * radius` along the bone's
 * own axis, which is numerically safe and geometrically indistinguishable from a sphere.
 */
const SPHERE_SPAN = 0.02;

export function buildCapsules(rig: RigHandles): CapsuleSet {
  const count = CAPSULES.length;
  const set: CapsuleSet = {
    count,
    a: new Float32Array(count * 3),
    b: new Float32Array(count * 3),
    r: new Float32Array(count),
    ids: CAPSULES.map((c) => c.id),
  };
  for (let i = 0; i < count; i++) set.r[i] = CAPSULES[i]!.radiusH * H;
  updateCapsules(rig, set);
  return set;
}

/** Refresh `a`/`b` from the current bone matrices. Allocation-free; `r` never changes. */
export function updateCapsules(rig: RigHandles, set: CapsuleSet): void {
  for (let i = 0; i < CAPSULES.length; i++) {
    const spec = CAPSULES[i]!;
    _m.copy(rig.byName[spec.a].matrixWorld);
    authoredOffsetToBuiltM(spec.offsetA as readonly [number, number, number], _off);
    _a.copy(_off).applyMatrix4(_m);

    if (spec.b !== null) {
      _b.setFromMatrixPosition(rig.byName[spec.b].matrixWorld);
    } else {
      // Extend along the bone's own +Y in bone space; any consistent direction works, and this one
      // never degenerates because the bone matrix is orthonormal.
      _axis.set(0, 1, 0).transformDirection(_m);
      _b.copy(_a).addScaledVector(_axis, SPHERE_SPAN * set.r[i]!);
    }

    set.a[i * 3] = _a.x;
    set.a[i * 3 + 1] = _a.y;
    set.a[i * 3 + 2] = _a.z;
    set.b[i * 3] = _b.x;
    set.b[i * 3 + 1] = _b.y;
    set.b[i * 3 + 2] = _b.z;
  }
}

/**
 * §5.5's shadow-fit AABB: "24 bone world positions inflated by per-bone radius, **not**
 * `computeBoundingBox()`" — the latter would have to CPU-skin every vertex and is ~50x more
 * expensive per frame.
 *
 * We inflate ALL 52 bone origins by `LIMB_R` and union that with the 16-capsule envelope. Bones
 * alone are not enough (a capsule spans two joints and bulges between them); capsules alone are not
 * enough either, and that is a real measured gap rather than a theoretical one: `CAPSULES` models
 * the hand as a single 0.030 H sphere at `WJC + 0.030 H`, so the FINGERS — which reach 0.109 H past
 * the wrist — sat 0.025 H (4.3 cm) outside the box. A shadow frustum fitted to that clips the
 * fingertips off the figure's own shadow at exactly the framing `DETAIL_HANDS` uses.
 */
export function boneAABB(rig: RigHandles, out: Box3): Box3 {
  out.makeEmpty();

  for (let i = 0; i < BONE_ORDER.length; i++) {
    const name = BONE_ORDER[i]!;
    _a.setFromMatrixPosition(rig.byName[name].matrixWorld);
    expand(out, _a, LIMB_R[name]!.v * H);
  }

  for (let i = 0; i < CAPSULES.length; i++) {
    const spec = CAPSULES[i]!;
    const rad = spec.radiusH * H;
    _m.copy(rig.byName[spec.a].matrixWorld);
    authoredOffsetToBuiltM(spec.offsetA as readonly [number, number, number], _off);
    _a.copy(_off).applyMatrix4(_m);
    expand(out, _a, rad);
    if (spec.b !== null) {
      _b.setFromMatrixPosition(rig.byName[spec.b].matrixWorld);
      expand(out, _b, rad);
    }
  }
  return out;
}

function expand(box: Box3, p: Vector3, rad: number): void {
  box.min.x = Math.min(box.min.x, p.x - rad);
  box.min.y = Math.min(box.min.y, p.y - rad);
  box.min.z = Math.min(box.min.z, p.z - rad);
  box.max.x = Math.max(box.max.x, p.x + rad);
  box.max.y = Math.max(box.max.y, p.y + rad);
  box.max.z = Math.max(box.max.z, p.z + rad);
}

/** Convenience for B7's per-particle collider whitelist (doc 06 §7.6): capsule id -> index. */
export const CAPSULE_INDEX: Readonly<Record<string, number>> = Object.freeze(
  CAPSULES.reduce<Record<string, number>>((acc, c, i) => {
    acc[c.id] = i;
    return acc;
  }, {}),
);

/** The bones each capsule is attached to, so B7 can build that whitelist without importing three. */
export const CAPSULE_BONES: readonly (readonly [BoneName, BoneName | null])[] = Object.freeze(
  CAPSULES.map((c) => [c.a, c.b] as const),
);
