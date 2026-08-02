/**
 * B0 CONTRACTS — `src/contracts/bones.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.4 verbatim + §2.8 (bone count 52, and the only bone that may
 * scale). Rest offsets transcribed from doc 06 §4.2 in T-POSE GENERATION SPACE, which is the
 * AUTHORED frame — every `_L` bone carries a POSITIVE x and every `_R` bone a NEGATIVE x
 * (docs 01/02/03/04/06 label +X as the character's LEFT). The single world conversion lives
 * in `src/solve/frame.ts` (§2.1).
 *
 * Changing `BONE_ORDER` stops every agent: it is the skinIndex order, the PoseTrack
 * quaternion order, the cloth snapshot order and the diagnostics order. Integrator commit
 * only (OWNERSHIP "the four changes that stop every agent", #2).
 */

import type { LayerId } from './pose';

export type BoneName =
  | 'root' | 'pelvis'
  | 'spine_01' | 'spine_02' | 'spine_03' | 'chest' | 'ribcage'
  | 'neck_01' | 'head' | 'head_end' | 'eye_L' | 'eye_R'
  | 'clavicle_L' | 'upperarm_L' | 'upperarm_twist_L' | 'deltoid_L'
  | 'lowerarm_L' | 'lowerarm_twist_01_L' | 'lowerarm_twist_02_L'
  | 'hand_L' | 'fingers_prox_L' | 'fingers_dist_L' | 'fingers_end_L'
  | 'thumb_L' | 'thumb_end_L'
  | 'thigh_L' | 'thigh_twist_L' | 'calf_L' | 'calf_twist_L'
  | 'foot_L' | 'ball_L' | 'toe_end_L'
  | 'clavicle_R' | 'upperarm_R' | 'upperarm_twist_R' | 'deltoid_R'
  | 'lowerarm_R' | 'lowerarm_twist_01_R' | 'lowerarm_twist_02_R'
  | 'hand_R' | 'fingers_prox_R' | 'fingers_dist_R' | 'fingers_end_R'
  | 'thumb_R' | 'thumb_end_R'
  | 'thigh_R' | 'thigh_twist_R' | 'calf_R' | 'calf_twist_R'
  | 'foot_R' | 'ball_R' | 'toe_end_R';

/**
 * FROZEN. This array order IS the skinIndex order, the PoseTrack quaternion order, the
 * checkpoint order and the diagnostics order. Changing it invalidates every artefact on disk.
 * Parents always precede children (so FK is a single forward pass).
 */
export const BONE_ORDER: readonly BoneName[] = [
  /*  0 */ 'root',
  /*  1 */ 'pelvis',
  /*  2 */ 'spine_01',
  /*  3 */ 'spine_02',
  /*  4 */ 'spine_03',
  /*  5 */ 'chest',
  /*  6 */ 'ribcage',
  /*  7 */ 'neck_01',
  /*  8 */ 'head',
  /*  9 */ 'head_end',
  /* 10 */ 'eye_L',
  /* 11 */ 'eye_R',
  /* 12 */ 'clavicle_L',
  /* 13 */ 'upperarm_L',
  /* 14 */ 'upperarm_twist_L',
  /* 15 */ 'deltoid_L',
  /* 16 */ 'lowerarm_L',
  /* 17 */ 'lowerarm_twist_01_L',
  /* 18 */ 'lowerarm_twist_02_L',
  /* 19 */ 'hand_L',
  /* 20 */ 'fingers_prox_L',
  /* 21 */ 'fingers_dist_L',
  /* 22 */ 'fingers_end_L',
  /* 23 */ 'thumb_L',
  /* 24 */ 'thumb_end_L',
  /* 25 */ 'thigh_L',
  /* 26 */ 'thigh_twist_L',
  /* 27 */ 'calf_L',
  /* 28 */ 'calf_twist_L',
  /* 29 */ 'foot_L',
  /* 30 */ 'ball_L',
  /* 31 */ 'toe_end_L',
  /* 32 */ 'clavicle_R',
  /* 33 */ 'upperarm_R',
  /* 34 */ 'upperarm_twist_R',
  /* 35 */ 'deltoid_R',
  /* 36 */ 'lowerarm_R',
  /* 37 */ 'lowerarm_twist_01_R',
  /* 38 */ 'lowerarm_twist_02_R',
  /* 39 */ 'hand_R',
  /* 40 */ 'fingers_prox_R',
  /* 41 */ 'fingers_dist_R',
  /* 42 */ 'fingers_end_R',
  /* 43 */ 'thumb_R',
  /* 44 */ 'thumb_end_R',
  /* 45 */ 'thigh_R',
  /* 46 */ 'thigh_twist_R',
  /* 47 */ 'calf_R',
  /* 48 */ 'calf_twist_R',
  /* 49 */ 'foot_R',
  /* 50 */ 'ball_R',
  /* 51 */ 'toe_end_R',
];

/**
 * === BONE_ORDER.length. §2.8: doc 06 §4.2's headline "44 core bones" excludes the seven leaf
 * terminators its own tree lists (`head_end`, `fingers_end_L/R`, `thumb_end_L/R`,
 * `toe_end_L/R`), which we need for landmarks and cloth pins. Fully expanded that tree is 51
 * entries; `ribcage` makes 52.
 */
export const BONE_COUNT = 52 as const;

export type BoneIndex = number & { readonly __bone: unique symbol };

const BONE_INDEX_LOOKUP: Readonly<Record<BoneName, BoneIndex>> = (() => {
  const m = {} as Record<BoneName, BoneIndex>;
  for (let i = 0; i < BONE_ORDER.length; i++) m[BONE_ORDER[i]!] = i as BoneIndex;
  return Object.freeze(m);
})();

/** O(1), from a frozen lookup. */
export function boneIndex(name: BoneName): BoneIndex {
  return BONE_INDEX_LOOKUP[name];
}

/** The frozen name -> index table itself, for callers that need to iterate it. */
export const BONE_INDEX = BONE_INDEX_LOOKUP;

/**
 * Parent name per bone, doc 06 §4.2. Authoring source for `BONE_PARENT`; kept as names so a
 * reordering of `BONE_ORDER` cannot silently reparent anything.
 * `null` for `root` only.
 */
export const BONE_PARENT_NAME: Readonly<Record<BoneName, BoneName | null>> = Object.freeze({
  root: null,
  pelvis: 'root',
  spine_01: 'pelvis',
  spine_02: 'spine_01',
  spine_03: 'spine_02',
  chest: 'spine_03',
  ribcage: 'chest',            // §2.8 — LEAF, no children, ever
  neck_01: 'chest',
  head: 'neck_01',
  head_end: 'head',
  eye_L: 'head',
  eye_R: 'head',
  clavicle_L: 'chest',
  upperarm_L: 'clavicle_L',
  upperarm_twist_L: 'upperarm_L',
  deltoid_L: 'upperarm_L',
  lowerarm_L: 'upperarm_L',
  lowerarm_twist_01_L: 'lowerarm_L',
  lowerarm_twist_02_L: 'lowerarm_L',
  hand_L: 'lowerarm_L',
  fingers_prox_L: 'hand_L',
  fingers_dist_L: 'fingers_prox_L',
  fingers_end_L: 'fingers_dist_L',
  thumb_L: 'hand_L',
  thumb_end_L: 'thumb_L',
  thigh_L: 'pelvis',
  thigh_twist_L: 'thigh_L',
  calf_L: 'thigh_L',
  calf_twist_L: 'calf_L',
  foot_L: 'calf_L',
  ball_L: 'foot_L',
  toe_end_L: 'ball_L',
  clavicle_R: 'chest',
  upperarm_R: 'clavicle_R',
  upperarm_twist_R: 'upperarm_R',
  deltoid_R: 'upperarm_R',
  lowerarm_R: 'upperarm_R',
  lowerarm_twist_01_R: 'lowerarm_R',
  lowerarm_twist_02_R: 'lowerarm_R',
  hand_R: 'lowerarm_R',
  fingers_prox_R: 'hand_R',
  fingers_dist_R: 'fingers_prox_R',
  fingers_end_R: 'fingers_dist_R',
  thumb_R: 'hand_R',
  thumb_end_R: 'thumb_R',
  thigh_R: 'pelvis',
  thigh_twist_R: 'thigh_R',
  calf_R: 'thigh_R',
  calf_twist_R: 'calf_R',
  foot_R: 'calf_R',
  ball_R: 'foot_R',
  toe_end_R: 'ball_R',
});

/** BONE_PARENT[i] is the index of bone i's parent; -1 for 'root'. */
export const BONE_PARENT: Readonly<Int8Array> = (() => {
  const a = new Int8Array(BONE_COUNT);
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = BONE_PARENT_NAME[BONE_ORDER[i]!];
    a[i] = p === null ? -1 : BONE_INDEX_LOOKUP[p];
  }
  return a;
})();

/**
 * Parent-local rest translation, FracH, in T-POSE GENERATION SPACE (doc 06 §4.2).
 *
 * Transcribed row for row from doc 06 §4.2's tree. `_R` bones mirror x, per that section's
 * "Right side = mirror `x`". `ribcage` is the one addition, at (0, +0.0350, -0.0040) (§2.8).
 * These are AUTHORED-frame numbers, kept verbatim per §2.1; `src/solve/frame.ts` negates x.
 */
const REST_OFFSET_TABLE: Readonly<Record<BoneName, readonly [number, number, number]>> =
  Object.freeze({
    root: [0, 0.0, 0.0],                              // world/embusen anchor, on the floor
    pelvis: [0, +0.5308, 0.0],                        // origin = MIDHIP
    spine_01: [0, +0.06, +0.004],                     // L5/S1
    spine_02: [0, +0.07, -0.002],                     // L3/L2
    spine_03: [0, +0.07, -0.004],                     // T11/T10
    chest: [0, +0.07, -0.004],                        // T6/T5
    ribcage: [0, +0.035, -0.004],                     // §2.8 — LEAF, the only scalable bone
    neck_01: [0, +0.0622, -0.004],                    // C7/T1
    head: [0, +0.055, +0.006],                        // AOJ
    head_end: [0, +0.082, -0.004],                    // leaf, = vertex
    eye_L: [+0.0175, +0.0165, -0.066],
    eye_R: [-0.0175, +0.0165, -0.066],
    clavicle_L: [+0.011, +0.0272, -0.039],            // origin = SC joint
    upperarm_L: [+0.087, -0.0298, +0.035],            // origin = SJC
    upperarm_twist_L: [+0.0324, 0, 0],                // 20 % along; carries 0.5x upperarm roll
    deltoid_L: [+0.0324, +0.008, 0],                  // helper, half-slerp clav<->upperarm
    lowerarm_L: [+0.1618, 0, 0],                      // origin = EJC
    lowerarm_twist_01_L: [+0.0515, 0, 0],             // 33 % along; 0.33x hand roll
    lowerarm_twist_02_L: [+0.103, 0, 0],              // 67 % along; 0.67x hand roll
    hand_L: [+0.1545, 0, 0],                          // origin = WJC
    fingers_prox_L: [+0.0495, 0, 0],                  // all 4 fingers, one bone
    fingers_dist_L: [+0.03, 0, 0],
    fingers_end_L: [+0.0295, 0, 0],                   // leaf, = dactylion
    thumb_L: [+0.015, -0.0042, -0.019],
    thumb_end_L: [+0.033, -0.004, -0.019],            // leaf
    thigh_L: [+0.05, 0.0, 0.0],                       // origin = HJC
    thigh_twist_L: [0, -0.0485, 0.0],                 // 20 % down; 0.5x thigh roll
    calf_L: [0, -0.2425, 0.0],                        // origin = KJC
    calf_twist_L: [0, -0.162, 0.0],                   // 65 % down; 0.5x foot yaw
    foot_L: [0, -0.2493, 0.0],                        // origin = AJC
    ball_L: [0, -0.0192, -0.0697],                    // origin = MTP
    toe_end_L: [0, -0.0098, -0.0393],                 // leaf, = toe tip
    clavicle_R: [-0.011, +0.0272, -0.039],
    upperarm_R: [-0.087, -0.0298, +0.035],
    upperarm_twist_R: [-0.0324, 0, 0],
    deltoid_R: [-0.0324, +0.008, 0],
    lowerarm_R: [-0.1618, 0, 0],
    lowerarm_twist_01_R: [-0.0515, 0, 0],
    lowerarm_twist_02_R: [-0.103, 0, 0],
    hand_R: [-0.1545, 0, 0],
    fingers_prox_R: [-0.0495, 0, 0],
    fingers_dist_R: [-0.03, 0, 0],
    fingers_end_R: [-0.0295, 0, 0],
    thumb_R: [-0.015, -0.0042, -0.019],
    thumb_end_R: [-0.033, -0.004, -0.019],
    thigh_R: [-0.05, 0.0, 0.0],
    thigh_twist_R: [0, -0.0485, 0.0],
    calf_R: [0, -0.2425, 0.0],
    calf_twist_R: [0, -0.162, 0.0],
    foot_R: [0, -0.2493, 0.0],
    ball_R: [0, -0.0192, -0.0697],
    toe_end_R: [0, -0.0098, -0.0393],
  });

/** Parent-local rest translation, FracH, in T-POSE GENERATION SPACE (doc 06 §4.2). */
export const REST_OFFSET_H: Readonly<Float64Array> = (() => {
  const a = new Float64Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    const o = REST_OFFSET_TABLE[BONE_ORDER[i]!];
    a[i * 3 + 0] = o[0];
    a[i * 3 + 1] = o[1];
    a[i * 3 + 2] = o[2];
  }
  return a;
})();

/** Same data, keyed by name. Read-only mirror for authoring code. */
export const REST_OFFSET_BY_NAME = REST_OFFSET_TABLE;

/**
 * Bone primary axis (unit, bone-local) used by the swing-twist split (doc 06 §3.2).
 *
 * *** AUTHORED FRAME — the same T-POSE GENERATION SPACE as `REST_OFFSET_H` above. ***
 *
 * doc 06 §0, NORMATIVE: "Left-arm chain primary axis = +X; right-arm chain primary axis =
 * -X. Leg chain primary axis = -Y. Spine/neck chain primary axis = +Y. 'Twist' for a bone =
 * rotation about its own primary axis." Feet continue along the toe direction (-Z), which is
 * why doc 06 §3.1 lists ankle inversion/eversion about Z; eyes carry the gaze direction.
 *
 * *** MUST BE CONVERTED BEFORE USE. *** doc 06 §3.2's `clampSwingTwist(q, a, ...)` requires `a`
 * in the SAME frame as the bone-local quaternion `q`, i.e. the BUILT rig's frame, which carries
 * the single §2.1 x-negation (`tests/contracts/bones.test.ts` pins the built rig at
 * `position.x = -REST_OFFSET_H[i*3] * H`). Because that negation applies to x only, the 16
 * spine/leg/foot bones below are unaffected (their axes have no x component) while all 26
 * arm-chain bones INVERT. So `splitSwingTwist` / `clampSwingTwist` must take
 * `toWorld(PRIMARY_AXIS[b])` from `src/solve/frame.ts`, never the raw table.
 *
 * Passing the raw table would flip the twist axis on every arm bone: `TechniqueSpec.rollDeg`
 * (+ = pronation, doc 03 §4.3) would rotate the fist the wrong way — palm UP at kime instead of
 * palm down on every zuki — and `ROM.forearm`'s asymmetric +85/-88 clamp would bind on
 * supination instead of pronation. Nothing downstream sees it: §3.4.1's `JointStream` carries
 * only `pos`, so metric 23 `fist_roll_deg` is blind to hand orientation and metric 62
 * `forearm_radius_retention` measures a radius, not a direction. The guard is therefore a test,
 * not a metric: `tests/contracts/bones.test.ts` asserts
 * `dot(toWorld(PRIMARY_AXIS[b]), normalize(childBone.position)) > 0.85` for every bone with a
 * child.
 */
export const PRIMARY_AXIS_FRAME = 'AUTHORED_T_POSE' as const;
const AXIS_UP = [0, 1, 0] as const;
const AXIS_DOWN = [0, -1, 0] as const;
const AXIS_LEFT = [1, 0, 0] as const;     // AUTHORED +X — the character's left arm chain
const AXIS_RIGHT = [-1, 0, 0] as const;
const AXIS_FWD = [0, 0, -1] as const;     // facing at yoi

const PRIMARY_AXIS_TABLE: Readonly<Record<BoneName, readonly [number, number, number]>> =
  Object.freeze({
    root: AXIS_UP, pelvis: AXIS_UP,
    spine_01: AXIS_UP, spine_02: AXIS_UP, spine_03: AXIS_UP, chest: AXIS_UP, ribcage: AXIS_UP,
    neck_01: AXIS_UP, head: AXIS_UP, head_end: AXIS_UP,
    eye_L: AXIS_FWD, eye_R: AXIS_FWD,
    clavicle_L: AXIS_LEFT, upperarm_L: AXIS_LEFT, upperarm_twist_L: AXIS_LEFT,
    deltoid_L: AXIS_LEFT, lowerarm_L: AXIS_LEFT, lowerarm_twist_01_L: AXIS_LEFT,
    lowerarm_twist_02_L: AXIS_LEFT, hand_L: AXIS_LEFT, fingers_prox_L: AXIS_LEFT,
    fingers_dist_L: AXIS_LEFT, fingers_end_L: AXIS_LEFT, thumb_L: AXIS_LEFT,
    thumb_end_L: AXIS_LEFT,
    thigh_L: AXIS_DOWN, thigh_twist_L: AXIS_DOWN, calf_L: AXIS_DOWN, calf_twist_L: AXIS_DOWN,
    foot_L: AXIS_FWD, ball_L: AXIS_FWD, toe_end_L: AXIS_FWD,
    clavicle_R: AXIS_RIGHT, upperarm_R: AXIS_RIGHT, upperarm_twist_R: AXIS_RIGHT,
    deltoid_R: AXIS_RIGHT, lowerarm_R: AXIS_RIGHT, lowerarm_twist_01_R: AXIS_RIGHT,
    lowerarm_twist_02_R: AXIS_RIGHT, hand_R: AXIS_RIGHT, fingers_prox_R: AXIS_RIGHT,
    fingers_dist_R: AXIS_RIGHT, fingers_end_R: AXIS_RIGHT, thumb_R: AXIS_RIGHT,
    thumb_end_R: AXIS_RIGHT,
    thigh_R: AXIS_DOWN, thigh_twist_R: AXIS_DOWN, calf_R: AXIS_DOWN, calf_twist_R: AXIS_DOWN,
    foot_R: AXIS_FWD, ball_R: AXIS_FWD, toe_end_R: AXIS_FWD,
  });

export const PRIMARY_AXIS: Readonly<Float64Array> = (() => {
  const a = new Float64Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    const v = PRIMARY_AXIS_TABLE[BONE_ORDER[i]!];
    a[i * 3 + 0] = v[0];
    a[i * 3 + 1] = v[1];
    a[i * 3 + 2] = v[2];
  }
  return a;
})();

export const PRIMARY_AXIS_BY_NAME = PRIMARY_AXIS_TABLE;

/** All rest LOCAL quaternions are identity by construction (doc 06 §0). Asserted, not stored. */
export const REST_LOCAL_QUAT_IS_IDENTITY = true as const;

/**
 * Auxiliary landmarks that are NOT bones but which the leg solve, the embusen datum and the
 * cloth pins all need (doc 06 §4.2): `heel = foot + (0, -0.0300, +0.0415)` and
 * `toe_tip = ball + (0, -0.0098, -0.0393)`. Bone-local, FracH, AUTHORED frame.
 *
 * `HEEL_OFFSET_H[2] = +0.0415` is doc 06 §4.2's RIG heel landmark (doc 06 §6.3 names it
 * "heel-behind-AJC horizontal offset"). It is NOT the `HEEL_BEHIND` term of §2.3's derivation of
 * `ZENKUTSU_HEEL_TO_HEEL_H`: that term is doc 01 §1's `HEEL_BEHIND_ANKLE = 0.052 H`
 * `[DERIVED: 0.34·FOOT_LEN]`, and it is the ONLY input to that constant. Verified:
 *   0.540 - 0.052·cos3° + 0.052·cos30° = 0.533105   PASS against 0.533 ± 5e-4
 *   0.540 - 0.0415·cos3° + 0.0415·cos30° = 0.534497 FAIL, off by 1.50e-3 = 3x the tolerance
 * The two documents split different feet — doc 06: 0.109 + 0.0415 = 0.1505 H; doc 01:
 * 0.100 + 0.052 = 0.152 H. Resolved as `C15` in `units.ts`: metric 1's REFERENCE follows doc 01
 * (§2.6 precedence), the RIG landmark follows doc 06, and B9 must know metric 1 therefore
 * measures ≈0.5345 against a 0.533 reference.
 */
export const HEEL_OFFSET_H = [0, -0.03, +0.0415] as const;      // local to foot_L / foot_R
export const TOE_TIP_OFFSET_H = [0, -0.0098, -0.0393] as const; // local to ball_L / ball_R

/**
 * The six chain-closure lengths of doc 06 §4.2, in FracH. `tests/contracts/bones.test.ts`
 * recomputes each from `REST_OFFSET_H` and asserts agreement.
 *
 * Rows 1-5 are exact single offsets or exact sums. Row 6 is
 * `|heel - toe_end|` measured in foot-local space:
 *   heel     = (0, -0.0300, +0.0415)
 *   toe_end  = ball + toe_end = (0, -0.0290, -0.1090)
 *   distance = hypot(0.0010, 0.1505) = 0.15050332...  which doc 06 prints as 0.1505.
 */
export const CHAIN_CLOSURE_H = Object.freeze({
  upperarmToLowerarm: 0.1618,
  lowerarmToHand: 0.1545,
  handToFingersEnd: 0.109,
  thighToCalf: 0.2425,
  calfToFoot: 0.2493,
  heelToToeEnd: 0.1505,
});

/**
 * Bones that may be written by a runtime delta layer. Everything else is base-only.
 *
 * Grounded in doc 06 §6.4's NORMATIVE evaluation order and doc 04 §5.1's settle channels:
 *   koshi  <- L1 hip drive + L2 spine counter-rotation/whip (c = [0.10, 0.18, 0.26, 0.30]
 *             for spine_01 -> chest); the transient shoulder lag behind the hips is what
 *             reads as karate. Zero lag = "aerobics".
 *   kime   <- doc 04 §5.1 second-order settle channels: fist, elbow, pelvis, thorax, head,
 *             comY, kneeF — i.e. the striking chain plus the trunk and the loaded knee.
 *   breath <- `ribcage` ONLY (§2.8). It is the only bone in the rig permitted a non-unit
 *             scale, and it is childless, so no descendant transform inherits the scale.
 *   gaze   <- doc 06 §6.5 look-at chain: chest 0.15, neck_01 0.35, head 0.50, eyes take the
 *             residual after the head is solved.
 *   patch  <- every bone. `PatchKey.bone` is an unrestricted `BoneName` (§3.7): this is the
 *             escape hatch for "the left clavicle is shrugged at step 18 only".
 */
const layerBones = (...names: readonly BoneName[]): readonly BoneIndex[] =>
  Object.freeze(names.map(boneIndex).sort((a, b) => a - b));

export const LAYER_WRITABLE: Readonly<Record<LayerId, readonly BoneIndex[]>> = Object.freeze({
  koshi: layerBones('pelvis', 'spine_01', 'spine_02', 'spine_03', 'chest'),
  kime: layerBones(
    'pelvis', 'spine_03', 'chest', 'neck_01', 'head',
    'clavicle_L', 'upperarm_L', 'upperarm_twist_L', 'deltoid_L',
    'lowerarm_L', 'lowerarm_twist_01_L', 'lowerarm_twist_02_L', 'hand_L',
    'clavicle_R', 'upperarm_R', 'upperarm_twist_R', 'deltoid_R',
    'lowerarm_R', 'lowerarm_twist_01_R', 'lowerarm_twist_02_R', 'hand_R',
    'calf_L', 'calf_R',
  ),
  breath: layerBones('ribcage'),
  gaze: layerBones('chest', 'neck_01', 'head', 'eye_L', 'eye_R'),
  patch: Object.freeze(BONE_ORDER.map((_, i) => i as BoneIndex)),
});

/** The only bone permitted a non-unit `scale` (§2.8). Metric 59 covers the other 51. */
export const SCALABLE_BONE: BoneName = 'ribcage';
export const NON_SCALING_BONE_COUNT = 51 as const;
