/**
 * B4 RIG — `src/rig/bones.ts`
 *
 * `buildSkeleton`: the 52 `Bone`s of `BONE_ORDER`, built in T-POSE generation space and rebaked
 * to an **A-pose bind** per doc 06 §4.1 G1–G5.
 *
 * ═══ THIS FILE IS THE ONE ALLOWLISTED BIND-POSE FLIP SITE ═══════════════════════════════════
 *
 * `src/contracts/bones.ts` carries `REST_OFFSET_H` in the AUTHORED frame, where `+X` is the
 * character's LEFT (docs 01/02/03/04/06). ARCHITECTURE §2.1 puts world `+X` on the character's
 * RIGHT, and `tests/contracts/bones.test.ts` pins the BUILT rig at
 * `position.x = -REST_OFFSET_H[i*3] * H`. `tools/verify-contracts.mjs` (ban `SIDE_SIGN_LEAK`)
 * allows exactly three files to NAME `SIDE_SIGN`: `src/contracts/units.ts` defines it,
 * `src/solve/frame.ts` is the runtime conversion, and THIS file is the bind-pose flip. The flip
 * is a NAMED multiply by `SIDE_SIGN`, never a bare minus (ban `X_NEGATION` greps for the bare
 * form, and §7.7 routes rubric A10 to `SIDE_SIGN`, so an unnamed minus here would make that
 * routing a lie).
 *
 * `sideSign(h)` is not a substitute for the positions: it is per-limb, so `sideSign('R')` applied
 * to `eye_R`'s already-negative authored x would land the right eye at negative x too. It IS the
 * right tool for the per-side A-pose rotations, and that is how they are written below.
 *
 * Every other file in `src/rig/**` consumes `BUILT_REST_OFFSET_M` / `BUILT_PRIMARY_AXIS` or the
 * built bones' own world matrices, so the flip happens exactly once in the whole block.
 *
 * ═══ WHY A-POSE BIND (doc 06 §4.1, quantified) ══════════════════════════════════════════════
 * Karate shoulder abduction in kihon/kata spans 0°…120°. A T-pose bind (90°) gives a maximum
 * deviation of 90° from bind and puts the most-used band (0–60°: every tsuki and gedan-barai) at
 * 30–90°. An A-pose bind at 45° gives a maximum deviation of 75° and puts that band inside ±45°.
 * LBS error grows as `1 - cos(delta/2)`: 29 % collapse at 90°, 8 % at 45°.
 */

import { Bone, Group, Matrix4, Vector3 } from 'three';
import {
  BONE_COUNT,
  BONE_ORDER,
  BONE_PARENT_NAME,
  boneIndex,
  DEG,
  H,
  PRIMARY_AXIS,
  REST_OFFSET_H,
  SIDE_SIGN,
  sideSign,
  type BoneName,
  type Handedness,
} from '../contracts';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. THE FLIP — applied here, once, to the two authored tables `src/rig/**` reads.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** `SIDE_SIGN * 0` is `-0`; normalise it so a mid-sagittal bone reports a plain `0`. */
const flipX = (authoredX: number): number => {
  const x = SIDE_SIGN * authoredX;
  return x === 0 ? 0 : x;
};

/**
 * Parent-local rest translation in the BUILT (three.js/world) frame, **metres**.
 * `x` carries the single §2.1 negation; `y` and `z` are doc 06 §4.2 verbatim.
 */
export const BUILT_REST_OFFSET_M: Readonly<Float64Array> = (() => {
  const a = new Float64Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    a[i * 3 + 0] = flipX(REST_OFFSET_H[i * 3 + 0]!) * H;
    a[i * 3 + 1] = REST_OFFSET_H[i * 3 + 1]! * H;
    a[i * 3 + 2] = REST_OFFSET_H[i * 3 + 2]! * H;
  }
  return a;
})();

/**
 * Bone primary axis in the BUILT frame — i.e. `toWorld(PRIMARY_AXIS[b])`, which
 * `src/contracts/bones.ts` warns in capitals must happen before any swing-twist use. Because the
 * negation touches x only, the 16 spine/leg/foot/eye axes are unchanged and all 26 arm-chain axes
 * invert. B3 gets the same vector from `src/solve/frame.ts`'s `toWorld`; `src/rig/**` gets it from
 * here, so neither block re-derives the flip.
 */
export const BUILT_PRIMARY_AXIS: Readonly<Float64Array> = (() => {
  const a = new Float64Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    a[i * 3 + 0] = flipX(PRIMARY_AXIS[i * 3 + 0]!);
    a[i * 3 + 1] = PRIMARY_AXIS[i * 3 + 1]!;
    a[i * 3 + 2] = PRIMARY_AXIS[i * 3 + 2]!;
  }
  return a;
})();

/** Read a `BONE_COUNT*3` table into a `Vector3`. */
export const readVec3 = (src: Readonly<Float64Array>, i: number, out: Vector3): Vector3 =>
  out.set(src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!);

/**
 * Convert an AUTHORED bone-local offset (FracH) to the BUILT frame, in metres.
 *
 * `src/contracts/bones.ts`'s `HEEL_OFFSET_H` / `TOE_TIP_OFFSET_H` and `CAPSULES[].offsetA` are all
 * authored-frame FracH, and two of the capsule offsets (`hand_L` `+0.03`, `hand_R` `-0.03`) carry a
 * real x. Routing them through here keeps the §2.1 flip in this one file instead of letting
 * `landmarks.ts` and `capsules.ts` each grow their own.
 */
export const authoredOffsetToBuiltM = (
  v: readonly [number, number, number],
  out: Vector3,
): Vector3 => out.set(flipX(v[0]) * H, v[1] * H, v[2] * H);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. THE A-POSE BIND (doc 06 §4.1 G3)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * doc 06 §4.1 G3, in AUTHORED degrees about the bone's local Z. The built rig multiplies each by
 * `sideSign(h)`, which is the same single §2.1 flip expressed per-limb: `sideSign('L') = -1`, so
 * the authored `-45` becomes a world `+45`, and `R_z(+45°)` takes the left arm's `-X` rest
 * direction down to `(-cos45, -sin45, 0)` — arm down, which is what an A-pose is.
 */
export const BIND_A_POSE = Object.freeze({
  /** Shoulder abduction from T-pose to A-pose. */
  upperarmAbductionDeg: -45,
  /** Slight clavicle depression that rides with it. */
  clavicleElevDeg: -6,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE BUILD
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A T-pose skeleton, before the A-pose rebake. `buildBodyGeometry`, `buildGiGeometry` and
 * `computeSkinWeights` all run against THIS pose (doc 06 §4.1 G1–G2: distance fields are cleanest
 * in T-pose, where the arm is maximally separated from the ribs).
 */
export interface SkeletonBuild {
  /** World/embusen anchor, on the floor. `RigHandles.root`. */
  readonly root: Group;
  readonly bones: readonly Bone[];
  readonly byName: Readonly<Record<BoneName, Bone>>;
  /** T-pose world matrices, one per bone, `BONE_ORDER` order. */
  readonly tposeWorld: readonly Matrix4[];
  /** T-pose world joint positions, `BONE_COUNT*3`, metres. */
  readonly tposeJoint: Float64Array;
}

const NAME_PREFIX = '';

/** Build the 52-bone tree in T-pose. All local quaternions are identity (doc 06 §0). */
export function buildSkeleton(): SkeletonBuild {
  const root = new Group();
  root.name = 'karateka_root';

  const bones: Bone[] = [];
  const byName = {} as Record<BoneName, Bone>;

  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONE_ORDER[i]!;
    const b = new Bone();
    b.name = `${NAME_PREFIX}${name}`;
    // The ONE bind-pose flip: x through SIDE_SIGN (see the file header), y and z verbatim.
    b.position.set(
      BUILT_REST_OFFSET_M[i * 3 + 0]!,
      BUILT_REST_OFFSET_M[i * 3 + 1]!,
      BUILT_REST_OFFSET_M[i * 3 + 2]!,
    );
    bones.push(b);
    byName[name] = b;
  }

  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONE_ORDER[i]!;
    const parent = BONE_PARENT_NAME[name];
    if (parent === null) root.add(bones[i]!);
    else byName[parent].add(bones[i]!);
  }

  root.updateMatrixWorld(true);

  const tposeWorld: Matrix4[] = [];
  const tposeJoint = new Float64Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    const m = bones[i]!.matrixWorld.clone();
    tposeWorld.push(m);
    tposeJoint[i * 3 + 0] = m.elements[12]!;
    tposeJoint[i * 3 + 1] = m.elements[13]!;
    tposeJoint[i * 3 + 2] = m.elements[14]!;
  }

  return { root, bones, byName, tposeWorld, tposeJoint };
}

/**
 * doc 06 §4.1 G3 + the matrices G4 needs. Sets the A-pose local rotations, refreshes the world
 * matrices, and returns `skinMatrix[i] = aposeWorld[i] * inverse(tposeWorld[i])` — the LBS bone
 * matrix that carries a T-pose vertex to its A-pose bind position.
 *
 * Only `rotation` is touched. `bone.position` stays at `BUILT_REST_OFFSET_M`, which is what
 * `tests/contracts/bones.test.ts` asserts and what makes bind-pose chain closure exact.
 */
export function applyBindAPose(sk: SkeletonBuild): {
  readonly skinMatrix: readonly Matrix4[];
  readonly aposeJoint: Float64Array;
} {
  for (const h of ['L', 'R'] as readonly Handedness[]) {
    const s = sideSign(h);
    sk.byName[`upperarm_${h}` as BoneName].rotation.z =
      s * BIND_A_POSE.upperarmAbductionDeg * DEG;
    sk.byName[`clavicle_${h}` as BoneName].rotation.z = s * BIND_A_POSE.clavicleElevDeg * DEG;
  }
  sk.root.updateMatrixWorld(true);

  const inv = new Matrix4();
  const skinMatrix: Matrix4[] = [];
  const aposeJoint = new Float64Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    const w = sk.bones[i]!.matrixWorld;
    inv.copy(sk.tposeWorld[i]!).invert();
    skinMatrix.push(new Matrix4().multiplyMatrices(w, inv));
    aposeJoint[i * 3 + 0] = w.elements[12]!;
    aposeJoint[i * 3 + 1] = w.elements[13]!;
    aposeJoint[i * 3 + 2] = w.elements[14]!;
  }
  return { skinMatrix, aposeJoint };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. CHAIN TOPOLOGY — shared by the mesh builders, the weight solver and the capsules.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The bone each bone's skinning/geometry segment runs TOWARD. `null` means "leaf": the segment is
 * a short stub along `BUILT_PRIMARY_AXIS`.
 *
 * This is deliberately NOT "the first child in `BONE_PARENT_NAME`". Doc 06 §5.3 step 1 requires a
 * SEGMENT, and the twist helpers (`*_twist*`, `deltoid_*`) are siblings of the real chain child,
 * so taking "first child" would give `upperarm_L` a segment to `upperarm_twist_L` — 20 % of the
 * real bone — and the falloff would then miss the distal 80 % of the arm entirely.
 */
export const SEGMENT_TOWARD: Readonly<Record<BoneName, BoneName | null>> = Object.freeze({
  root: 'pelvis',
  pelvis: 'spine_01',
  spine_01: 'spine_02',
  spine_02: 'spine_03',
  spine_03: 'chest',
  chest: 'neck_01',
  ribcage: null,
  neck_01: 'head',
  head: 'head_end',
  head_end: null,
  eye_L: null,
  eye_R: null,
  clavicle_L: 'upperarm_L',
  upperarm_L: 'lowerarm_L',
  upperarm_twist_L: null,
  deltoid_L: null,
  lowerarm_L: 'hand_L',
  lowerarm_twist_01_L: null,
  lowerarm_twist_02_L: null,
  hand_L: 'fingers_prox_L',
  fingers_prox_L: 'fingers_dist_L',
  fingers_dist_L: 'fingers_end_L',
  fingers_end_L: null,
  thumb_L: 'thumb_end_L',
  thumb_end_L: null,
  thigh_L: 'calf_L',
  thigh_twist_L: null,
  calf_L: 'foot_L',
  calf_twist_L: null,
  foot_L: 'ball_L',
  ball_L: 'toe_end_L',
  toe_end_L: null,
  clavicle_R: 'upperarm_R',
  upperarm_R: 'lowerarm_R',
  upperarm_twist_R: null,
  deltoid_R: null,
  lowerarm_R: 'hand_R',
  lowerarm_twist_01_R: null,
  lowerarm_twist_02_R: null,
  hand_R: 'fingers_prox_R',
  fingers_prox_R: 'fingers_dist_R',
  fingers_dist_R: 'fingers_end_R',
  fingers_end_R: null,
  thumb_R: 'thumb_end_R',
  thumb_end_R: null,
  thigh_R: 'calf_R',
  thigh_twist_R: null,
  calf_R: 'foot_R',
  calf_twist_R: null,
  foot_R: 'ball_R',
  ball_R: 'toe_end_R',
  toe_end_R: null,
});

/**
 * The five twist chains of doc 06 §5.4 Fix 1, as `[carrier, ...stations, terminator]`. The twist
 * of the TERMINATOR's local quaternion is redistributed onto the stations at the listed fractions
 * so no single LBS blend band ever spans the whole roll. B3 drives them (S10 / doc 06 §6.4 L6);
 * `src/rig/skinWeights.ts` sizes their blend bands from the same table.
 */
export interface TwistChain {
  readonly carrier: BoneName;
  readonly terminator: BoneName;
  readonly stations: readonly { readonly bone: BoneName; readonly frac: number }[];
}

export const TWIST_CHAINS: readonly TwistChain[] = Object.freeze(
  (['L', 'R'] as readonly Handedness[]).flatMap((h) => [
    {
      carrier: `lowerarm_${h}` as BoneName,
      terminator: `hand_${h}` as BoneName,
      stations: [
        { bone: `lowerarm_twist_01_${h}` as BoneName, frac: 0.33 },
        { bone: `lowerarm_twist_02_${h}` as BoneName, frac: 0.67 },
      ],
    },
    {
      carrier: `upperarm_${h}` as BoneName,
      terminator: `upperarm_${h}` as BoneName,
      stations: [{ bone: `upperarm_twist_${h}` as BoneName, frac: 0.5 }],
    },
    {
      carrier: `thigh_${h}` as BoneName,
      terminator: `thigh_${h}` as BoneName,
      stations: [{ bone: `thigh_twist_${h}` as BoneName, frac: 0.5 }],
    },
    {
      carrier: `calf_${h}` as BoneName,
      terminator: `foot_${h}` as BoneName,
      stations: [{ bone: `calf_twist_${h}` as BoneName, frac: 0.5 }],
    },
  ]),
);

/** Every bone that participates in a twist chain, for the narrow-band rule in `skinWeights.ts`. */
export const TWIST_STATION_BONES: readonly BoneName[] = Object.freeze(
  TWIST_CHAINS.flatMap((c) => c.stations.map((s) => s.bone)),
);

/**
 * Anatomical grouping. The skin-weight visibility gate of doc 06 §5.3 step 2 exists to stop the
 * inner thigh being weighted to the opposite thigh and the medial forearm to the ribs. We generate
 * the mesh, so we know which limb every vertex belongs to exactly — a group gate is therefore both
 * cheaper and STRICTER than the ray test, and the ray test's own `dot(...) > 0.25` half still runs
 * on top of it (`skinWeights.ts`).
 */
export type LimbGroup = 'trunk' | 'head' | 'arm_L' | 'arm_R' | 'leg_L' | 'leg_R';

export const LIMB_GROUP: Readonly<Record<BoneName, LimbGroup>> = Object.freeze(
  BONE_ORDER.reduce<Record<BoneName, LimbGroup>>((acc, n) => {
    if (/_L$/.test(n) && /^(clavicle|upperarm|deltoid|lowerarm|hand|fingers|thumb)/.test(n)) {
      acc[n] = 'arm_L';
    } else if (/_R$/.test(n) && /^(clavicle|upperarm|deltoid|lowerarm|hand|fingers|thumb)/.test(n)) {
      acc[n] = 'arm_R';
    } else if (/^(thigh|calf|foot|ball|toe)/.test(n)) {
      acc[n] = /_L$/.test(n) ? 'leg_L' : 'leg_R';
    } else if (/^(neck_01|head|head_end|eye_)/.test(n)) {
      acc[n] = 'head';
    } else {
      acc[n] = 'trunk';
    }
    return acc;
  }, {} as Record<BoneName, LimbGroup>),
);

/** Which bone groups a vertex of a given group may be weighted to (doc 06 §5.3 step 2). */
export const GROUP_ALLOW: Readonly<Record<LimbGroup, readonly LimbGroup[]>> = Object.freeze({
  trunk: ['trunk', 'arm_L', 'arm_R', 'leg_L', 'leg_R', 'head'],
  head: ['head', 'trunk'],
  arm_L: ['arm_L', 'trunk'],
  arm_R: ['arm_R', 'trunk'],
  leg_L: ['leg_L', 'trunk'],
  leg_R: ['leg_R', 'trunk'],
});

/** `boneIndex` for every bone of a group, precomputed. */
export const BONES_OF_GROUP: Readonly<Record<LimbGroup, readonly number[]>> = Object.freeze(
  (['trunk', 'head', 'arm_L', 'arm_R', 'leg_L', 'leg_R'] as readonly LimbGroup[]).reduce<
    Record<LimbGroup, readonly number[]>
  >(
    (acc, g) => {
      acc[g] = BONE_ORDER.filter((n) => LIMB_GROUP[n] === g).map((n) => boneIndex(n) as number);
      return acc;
    },
    {} as Record<LimbGroup, readonly number[]>,
  ),
);
