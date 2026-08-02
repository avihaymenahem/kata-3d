/**
 * B0 CONTRACTS — `src/contracts/rig.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.10 verbatim.
 *
 * NOTE ON THE `three` IMPORT. §3 states that `src/contracts/**` "may not import `three` at
 * all", and §3.10 nevertheless declares `RigHandles` in terms of `Bone`, `Group`,
 * `SkinnedMesh`, `Mesh` and `Skeleton`. Both hold, because the import below is `import type`:
 * it is erased at compile time, emits no module edge, and cannot pull GL into the Node path.
 * `tests/contracts/imports.test.ts` encodes exactly this exception — type-only, this file
 * only, these five names only — and fails on any value import of `three` under
 * `src/contracts/**`.
 */

import type { Bone, Group, Mesh, Skeleton, SkinnedMesh } from 'three';
import type { BoneName } from './bones';

/** doc 07 §0.3, 25 joints, Mixamo-named, THIS ORDER. Every metric is computed on this set. */
export const CANONICAL_JOINTS = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftFistCenter',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightFistCenter',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;
export type CanonicalJoint = (typeof CANONICAL_JOINTS)[number];
export const CANONICAL_COUNT = 25 as const;

/**
 * *FistCenter is virtual: 0.030 H beyond the wrist along the hand axis. doc 07 §0.3.
 *
 * Our spine is four bones (`spine_01`, `spine_02`, `spine_03`, `chest`) against Mixamo's three
 * slots, so `Spine2` — the highest spine bone, directly under `Neck` — maps to `chest` and
 * `spine_03` carries no canonical slot. The canonical set is a comparison substrate, not a
 * bijection (doc 07 §0.3).
 */
export const CANONICAL_FROM_BONE: Readonly<Record<CanonicalJoint, BoneName>> = Object.freeze({
  Hips: 'pelvis',
  Spine: 'spine_01',
  Spine1: 'spine_02',
  Spine2: 'chest',
  Neck: 'neck_01',
  Head: 'head',
  HeadTop_End: 'head_end',
  LeftShoulder: 'clavicle_L',
  LeftArm: 'upperarm_L',
  LeftForeArm: 'lowerarm_L',
  LeftHand: 'hand_L',
  LeftFistCenter: 'hand_L',      // virtual, FIST_CENTER_OFFSET_H beyond the wrist
  RightShoulder: 'clavicle_R',
  RightArm: 'upperarm_R',
  RightForeArm: 'lowerarm_R',
  RightHand: 'hand_R',
  RightFistCenter: 'hand_R',     // virtual
  LeftUpLeg: 'thigh_L',
  LeftLeg: 'calf_L',
  LeftFoot: 'foot_L',
  LeftToeBase: 'ball_L',
  RightUpLeg: 'thigh_R',
  RightLeg: 'calf_R',
  RightFoot: 'foot_R',
  RightToeBase: 'ball_R',
});

/** O(1) canonical index. `CANONICAL_JOINTS` order IS the `Landmarks.pos` stride order. */
export const CANONICAL_INDEX: Readonly<Record<CanonicalJoint, number>> = (() => {
  const m = {} as Record<CanonicalJoint, number>;
  for (let i = 0; i < CANONICAL_JOINTS.length; i++) m[CANONICAL_JOINTS[i]!] = i;
  return Object.freeze(m);
})();

/**
 * The two virtual canonical joints, and their offset: 0.5 x fist diameter = 0.030 H beyond the
 * wrist along the hand axis (doc 07 §0.2, §0.3). It is the striking-point proxy; every fist
 * metric uses it, never `*Hand`.
 */
export const FIST_CENTER_OFFSET_H = 0.03 as const;
export const VIRTUAL_CANONICAL_JOINTS: readonly CanonicalJoint[] = Object.freeze([
  'LeftFistCenter', 'RightFistCenter',
]);

/**
 * World-space snapshot at one tick. Metres.
 *
 * `tick` is MUTABLE — the one deviation from §3.10's `readonly tick: number`. §3.13's signature is
 * `sampleLandmarks(rig, tick, out: Landmarks): void`, a CALLER-OWNED out-param: the typed arrays
 * are mutable in content, but under strict mode a `readonly` scalar cannot be assigned, so B4
 * would have to write `(out as { tick: number }).tick = tick` — an unchecked cast in the one
 * function that stamps identity onto every measured snapshot. If B4 instead left it unwritten,
 * every `Landmarks` the harness hands B9 would report tick 0 and `MetricResult.tick` would be
 * wrong for every metric, while B9's own `joints(): Landmarks` (which returns a fresh object)
 * would not exhibit the bug — two paths silently disagreeing. `sampleLandmarks` MUST stamp it;
 * `tests/rig/**` asserts `sampleLandmarks(rig, 12345, out); out.tick === 12345`.
 */
export interface Landmarks {
  tick: number;
  readonly pos: Float32Array;      // CANONICAL_COUNT*3, world metres
  readonly quat: Float32Array;     // CANONICAL_COUNT*4, world, xyzw
  /** Extra non-canonical landmarks the solver and cloth need. */
  readonly heelL: Float32Array; readonly heelR: Float32Array;      // 3 each
  readonly toeTipL: Float32Array; readonly toeTipR: Float32Array;
  readonly ghL: Float32Array; readonly ghR: Float32Array;          // glenohumeral centres
  readonly comXZ: Float32Array;    // 2, whole-body COM projected to the floor
}

/** doc 06 §7.6. 15 capsules. Radii FracH. */
export interface Capsule {
  readonly id: string;
  readonly a: BoneName; readonly b: BoneName | null;   // null => sphere at `a`
  readonly offsetA: readonly [number, number, number]; // FracH, bone-local
  readonly radiusH: number;
}

/**
 * doc 06 §7.6 collision proxies, transcribed row for row.
 *
 * COUNT NOTE. §3.10's comment and doc 06 §7.6's summary row both say "15 capsules", but doc
 * 06's own table expands to SIXTEEN (four unmirrored: head, neck, torso_upper, torso_lower;
 * six mirrored pairs: upperarm, forearm, hand, thigh, shank, foot) and the same document's
 * §7.5 cost calculation uses 16 (`988 x 16 x 8 = 126 k tests/frame`). The summary count is an
 * arithmetic slip contradicted by the table it summarises, so the table wins (§2.6: research
 * docs win on facts). Shipped: 16 capsules + the `y = 0` floor plane.
 *
 * Radii are deliberately 0.004-0.008 H larger than the body-mesh radii of doc 06 §5.1 so the
 * gi never sits ON the skin (z-fighting and shading pops).
 */
export const CAPSULES: readonly Capsule[] = Object.freeze([
  { id: 'head',        a: 'head',    b: null,      offsetA: [0, 0.03, 0], radiusH: 0.052 },
  { id: 'neck',        a: 'neck_01', b: 'head',    offsetA: [0, 0, 0],    radiusH: 0.035 },
  { id: 'torso_upper', a: 'chest',   b: 'neck_01', offsetA: [0, 0, 0],    radiusH: 0.085 },
  { id: 'torso_lower', a: 'pelvis',  b: 'spine_02', offsetA: [0, 0, 0],   radiusH: 0.08 },
  { id: 'upperarm_L',  a: 'upperarm_L', b: 'lowerarm_L', offsetA: [0, 0, 0], radiusH: 0.033 },
  { id: 'upperarm_R',  a: 'upperarm_R', b: 'lowerarm_R', offsetA: [0, 0, 0], radiusH: 0.033 },
  { id: 'forearm_L',   a: 'lowerarm_L', b: 'hand_L',     offsetA: [0, 0, 0], radiusH: 0.028 },
  { id: 'forearm_R',   a: 'lowerarm_R', b: 'hand_R',     offsetA: [0, 0, 0], radiusH: 0.028 },
  { id: 'hand_L',      a: 'hand_L', b: null, offsetA: [0.03, 0, 0],  radiusH: 0.03 },
  { id: 'hand_R',      a: 'hand_R', b: null, offsetA: [-0.03, 0, 0], radiusH: 0.03 },
  { id: 'thigh_L',     a: 'thigh_L', b: 'calf_L', offsetA: [0, 0, 0], radiusH: 0.055 },
  { id: 'thigh_R',     a: 'thigh_R', b: 'calf_R', offsetA: [0, 0, 0], radiusH: 0.055 },
  { id: 'shank_L',     a: 'calf_L', b: 'foot_L', offsetA: [0, 0, 0], radiusH: 0.038 },
  { id: 'shank_R',     a: 'calf_R', b: 'foot_R', offsetA: [0, 0, 0], radiusH: 0.038 },
  { id: 'foot_L',      a: 'foot_L', b: 'toe_end_L', offsetA: [0, 0, 0], radiusH: 0.028 },
  { id: 'foot_R',      a: 'foot_R', b: 'toe_end_R', offsetA: [0, 0, 0], radiusH: 0.028 },
]);

/** The floor is a plane, not a capsule: `y = 0`, normal `+Y` (doc 06 §7.6). */
export const FLOOR_PLANE_Y = 0 as const;

export type GarmentPartId =
  | 'sleeve_L' | 'sleeve_R'
  | 'skirt_front_L' | 'skirt_front_R' | 'skirt_back'
  | 'trouser_L' | 'trouser_R'
  | 'obi_tail_L' | 'obi_tail_R';

/** FROZEN order. The global cloth particle arrays are concatenated in exactly this order. */
export const GARMENT_PARTS: readonly GarmentPartId[] = Object.freeze([
  'sleeve_L', 'sleeve_R',
  'skirt_front_L', 'skirt_front_R', 'skirt_back',
  'trouser_L', 'trouser_R',
  'obi_tail_L', 'obi_tail_R',
]);

/** A ring of vertices pinned to a bone. doc 06 §7.3. */
export interface GiPinRing {
  readonly part: GarmentPartId;
  readonly bone: BoneName;
  /** Indices into the garment's own particle array. */
  readonly particles: readonly number[];
  /** Bone-local rest positions of those particles, FracH. */
  readonly restLocalH: Float32Array;    // particles.length*3
}

export interface RigHandles {
  readonly root: Group;                       // world/embusen anchor, on the floor
  readonly bones: readonly Bone[];            // BONE_ORDER order
  readonly byName: Readonly<Record<BoneName, Bone>>;
  readonly skeleton: Skeleton;
  readonly body: SkinnedMesh;
  readonly gi: Readonly<Record<'uwagi' | 'zubon' | 'collar' | 'obi', SkinnedMesh>>;
  readonly eyes: readonly [Mesh, Mesh];
  readonly hair: Mesh;
  readonly pinRings: readonly GiPinRing[];
}
