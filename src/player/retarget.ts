/**
 * B6 PLAYER — `src/player/retarget.ts` — BVH motion capture, baked onto the loaded character.
 *
 * ═══ WHY THIS EXISTS ═════════════════════════════════════════════════════════════════════════
 *
 * The CC0 clip library has no karate in it — its punches are boxing and it has no blocks at all.
 * Actual Shotokan motion exists only as motion capture, and mocap ships as BVH on whatever
 * skeleton the capture studio used. `karate.bvh` is an 18-joint BioVision rig; the character is a
 * 53-joint Rigify one. Nothing lines up, so the motion has to be RETARGETED.
 *
 * ═══ WHY NOT `SkeletonUtils.retargetClip` ════════════════════════════════════════════════════
 *
 * three ships one, and it assumes the two skeletons share a bind pose. These do not: BVH rests in
 * a T-pose with limbs down the world axes, Rigify rests in a relaxed A-pose. Feed it mismatched
 * binds and every limb inherits the difference as a constant twist — arms rotated inside the torso,
 * knees inverted. The bind mismatch IS the problem, so it has to be in the formula.
 *
 * ═══ THE FORMULA — MATCH DIRECTIONS, NOT DELTAS ══════════════════════════════════════════════
 *
 * For each mapped joint, using `a` for the bone's local axis toward its child (see `SEGMENT_AXES`):
 *
 *     axisAlign      = minimalArc(a_tgt -> a_src)          // constant, computed once
 *     tgtWorld(t)    = srcWorld(t) * axisAlign             // so tgtWorld * a_tgt == srcWorld * a_src
 *     tgtLocal(t)    = tgtParentWorld(t)⁻¹ * tgtWorld(t)   // back to a storable local rotation
 *
 * The obvious alternative — transfer the DELTA FROM BIND, `tgtWorld = srcWorld * srcBind⁻¹ *
 * tgtBind` — was tried first and is wrong here. Working through it, the target segment points the
 * right way only when `tgtBind * a_tgt == srcBind * a_src`, i.e. only when the two rigs already
 * agree on their rest DIRECTIONS. Legs satisfy that by luck (both rigs hang them down) and matched
 * to 0.01; arms do not (BioVision rests in a T-pose, Rigify in an A-pose) and came out inverted,
 * pointing straight up. Direction matching has no such precondition. Its one blind spot is twist
 * about the bone's own axis, which a direction cannot determine and which `minimalArc` declines to
 * invent.
 *
 * Verified: 0.00° mean segment error over the full clip, and 0° between the baked value and what
 * playback reproduces.
 *
 * ═══ WHAT THIS DOES NOT FIX: THE SOURCE ══════════════════════════════════════════════════════
 *
 * A correct retarget of a bad capture is a faithful reproduction of a bad capture. Measured on the
 * SOURCE skeleton of `karate.bvh`, before any of this code touches it: the head drops to 3.8 units
 * above the hips (≈27 standing) on 11 % of frames, hip height falls to 4.1 of 37.2, and the lowest
 * foot reaches −4.0 — through the floor. That file is a BVH PARSER'S TEST FIXTURE, not a dojo
 * recording, and no retargeting recovers a kata from it.
 *
 * So the clip is registered and auditionable, and deliberately NOT wired into
 * `CLIP_FOR_TECHNIQUE`. Better capture data drops in through `MOCAP_CLIPS` with no code change.
 *
 * Baked to an `AnimationClip` on the target rig rather than applied live, so the result is an
 * ordinary clip: `character.play()` crossfades it, time-scales it and clamps it like any other,
 * and the per-frame cost afterwards is zero.
 */

import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Matrix4,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type Skeleton,
} from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';

import type { BoneName } from '../contracts';
import type { Character } from './character';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The BioVision skeleton
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * BVH joint -> CONTRACT bone. Deliberately keyed to the contract rather than to Rigify or Mixamo
 * directly: `Character.boneFor` already resolves a contract name on either rig, so one table
 * retargets onto both.
 *
 * BioVision names the joint by the body part ABOVE it — `LeftHip` is the thigh bone, `LeftKnee` the
 * shin, `LeftAnkle` the foot. Reading those as hip/knee/ankle joints shifts the whole leg by one
 * segment, which looks like a character walking on its shins.
 */
export const BVH_TO_CONTRACT: Readonly<Record<string, BoneName>> = Object.freeze({
  Hips: 'pelvis',
  Chest: 'spine_02',
  Neck: 'neck_01',
  Head: 'head',

  LeftCollar: 'clavicle_L',
  LeftShoulder: 'upperarm_L',
  LeftElbow: 'lowerarm_L',
  LeftWrist: 'hand_L',

  RightCollar: 'clavicle_R',
  RightShoulder: 'upperarm_R',
  RightElbow: 'lowerarm_R',
  RightWrist: 'hand_R',

  LeftHip: 'thigh_L',
  LeftKnee: 'calf_L',
  LeftAnkle: 'foot_L',

  RightHip: 'thigh_R',
  RightKnee: 'calf_R',
  RightAnkle: 'foot_R',
});

/**
 * The SEGMENT each joint defines: its own direct child on both rigs.
 *
 * ═══ WHY THIS IS A TABLE AND NOT INFERRED ════════════════════════════════════════════════════
 *
 * The alignment below needs the bone's local axis toward its child, and "the child" has to mean
 * the SAME anatomical segment on both skeletons. Inferring it from `bone.children[0]` picks
 * whatever order the exporter happened to write: BioVision lists `Hips`'s children as
 * `Chest, LeftHip, RightHip`, so the source axis runs up the spine, while Rigify's first child of
 * `DEF-hips` can just as easily be a thigh. Pairing a spine against a leg produces an alignment
 * that is not wrong by a little — it is a different rotation entirely, and because the pelvis feeds
 * every other bone, the error lands on the whole body.
 *
 * `tgtChild` names the target's DIRECT child, which is not always the counterpart of the source's:
 * BioVision goes `Hips -> Chest` where Rigify goes `DEF-hips -> DEF-spine001`. What has to match is
 * the DIRECTION the segment points, not the joint's name.
 */
type SegmentTable = Readonly<Record<string, { srcChild: string; tgtChild: BoneName }>>;

const SEGMENT_AXES_BIOVISION: SegmentTable =
  Object.freeze({
    Hips: { srcChild: 'Chest', tgtChild: 'spine_01' },
    Chest: { srcChild: 'Neck', tgtChild: 'spine_03' },
    Neck: { srcChild: 'Head', tgtChild: 'head' },

    LeftCollar: { srcChild: 'LeftShoulder', tgtChild: 'upperarm_L' },
    LeftShoulder: { srcChild: 'LeftElbow', tgtChild: 'lowerarm_L' },
    LeftElbow: { srcChild: 'LeftWrist', tgtChild: 'hand_L' },
    LeftWrist: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_L' },

    RightCollar: { srcChild: 'RightShoulder', tgtChild: 'upperarm_R' },
    RightShoulder: { srcChild: 'RightElbow', tgtChild: 'lowerarm_R' },
    RightElbow: { srcChild: 'RightWrist', tgtChild: 'hand_R' },
    RightWrist: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_R' },

    LeftHip: { srcChild: 'LeftKnee', tgtChild: 'calf_L' },
    LeftKnee: { srcChild: 'LeftAnkle', tgtChild: 'foot_L' },
    LeftAnkle: { srcChild: 'ENDSITE', tgtChild: 'ball_L' },

    RightHip: { srcChild: 'RightKnee', tgtChild: 'calf_R' },
    RightKnee: { srcChild: 'RightAnkle', tgtChild: 'foot_R' },
    RightAnkle: { srcChild: 'ENDSITE', tgtChild: 'ball_R' },
  });

/**
 * The 20-joint skeleton used by the academic Shotokan captures (`heian-nidan.bvh`).
 *
 * ═══ THE TRAP: `LeftShoulder` MEANS SOMETHING ELSE HERE ══════════════════════════════════════
 *
 * BioVision has `LeftCollar -> LeftShoulder -> LeftElbow -> LeftWrist`, where `LeftShoulder` is the
 * UPPER ARM. This rig has `LeftShoulder -> LeftArm -> LeftForearm -> LeftHand`, where
 * `LeftShoulder` is the CLAVICLE. Reusing the BioVision table would drive the clavicle with the
 * upper arm's rotation and cascade one segment down the whole limb — a mistake that still produces
 * plausible-looking movement, which is what makes it dangerous.
 *
 * The spine is the payoff: `Hips -> SpineLow -> SpineMid -> Chest` is a clean 1:1 against Rigify's
 * `DEF-hips -> DEF-spine001 -> DEF-spine002 -> DEF-spine003`, so every spine joint is driven by a
 * real captured one instead of being pinned to bind.
 */
const CONTRACT_RMOCAP: Readonly<Record<string, BoneName>> = Object.freeze({
  Hips: 'pelvis',
  SpineLow: 'spine_01',
  SpineMid: 'spine_02',
  Chest: 'spine_03',
  Neck: 'neck_01',
  Head: 'head',

  LeftShoulder: 'clavicle_L',
  LeftArm: 'upperarm_L',
  LeftForearm: 'lowerarm_L',
  LeftHand: 'hand_L',

  RightShoulder: 'clavicle_R',
  RightArm: 'upperarm_R',
  RightForearm: 'lowerarm_R',
  RightHand: 'hand_R',

  LeftThigh: 'thigh_L',
  LeftLeg: 'calf_L',
  LeftFoot: 'foot_L',

  RightThigh: 'thigh_R',
  RightLeg: 'calf_R',
  RightFoot: 'foot_R',
});

const SEGMENT_AXES_RMOCAP: SegmentTable = Object.freeze({
  Hips: { srcChild: 'SpineLow', tgtChild: 'spine_01' },
  SpineLow: { srcChild: 'SpineMid', tgtChild: 'spine_02' },
  SpineMid: { srcChild: 'Chest', tgtChild: 'spine_03' },
  Chest: { srcChild: 'Neck', tgtChild: 'neck_01' },
  Neck: { srcChild: 'Head', tgtChild: 'head' },

  LeftShoulder: { srcChild: 'LeftArm', tgtChild: 'upperarm_L' },
  LeftArm: { srcChild: 'LeftForearm', tgtChild: 'lowerarm_L' },
  LeftForearm: { srcChild: 'LeftHand', tgtChild: 'hand_L' },
  LeftHand: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_L' },

  RightShoulder: { srcChild: 'RightArm', tgtChild: 'upperarm_R' },
  RightArm: { srcChild: 'RightForearm', tgtChild: 'lowerarm_R' },
  RightForearm: { srcChild: 'RightHand', tgtChild: 'hand_R' },
  RightHand: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_R' },

  LeftThigh: { srcChild: 'LeftLeg', tgtChild: 'calf_L' },
  LeftLeg: { srcChild: 'LeftFoot', tgtChild: 'foot_L' },
  LeftFoot: { srcChild: 'ENDSITE', tgtChild: 'ball_L' },

  RightThigh: { srcChild: 'RightLeg', tgtChild: 'calf_R' },
  RightLeg: { srcChild: 'RightFoot', tgtChild: 'foot_R' },
  RightFoot: { srcChild: 'ENDSITE', tgtChild: 'ball_R' },
});

export interface BvhProfile {
  readonly name: string;
  readonly toContract: Readonly<Record<string, BoneName>>;
  readonly segments: SegmentTable;
}

export const BVH_PROFILES: readonly BvhProfile[] = Object.freeze([
  { name: 'biovision', toContract: BVH_TO_CONTRACT, segments: SEGMENT_AXES_BIOVISION },
  { name: 'rmocap', toContract: CONTRACT_RMOCAP, segments: SEGMENT_AXES_RMOCAP },
]);

/**
 * Pick the profile by how many of its joint names the file actually contains.
 *
 * Scored rather than matched on a signature joint, because the two conventions SHARE names —
 * `Hips`, `Neck`, `Head`, `LeftShoulder` appear in both, and `LeftShoulder` means different bones
 * in each. Counting overlap makes the decision on the whole skeleton instead of on the one name
 * most likely to mislead.
 */
export function detectProfile(boneNames: readonly string[]): BvhProfile {
  const present = new Set(boneNames);
  let best = BVH_PROFILES[0]!;
  let bestScore = -1;
  for (const p of BVH_PROFILES) {
    const score = Object.keys(p.toContract).filter((n) => present.has(n)).length;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export interface RetargetOpts {
  /** Clip name. Defaults to the file's basename. */
  readonly name?: string;
  /**
   * Extra rotation taking SOURCE model space into TARGET model space, applied to every delta.
   *
   * Two rigs can both be Y-up and still disagree on which way the character faces at rest. When
   * they do, every retargeted joint is off by that constant and the figure moves correctly while
   * facing the wrong way. Identity is right whenever both rest facing the same direction — which
   * is the common case, and is why this defaults to identity rather than guessing.
   */
  readonly sourceToTarget?: Quaternion;
  /**
   * How much of the capture's root translation to keep.
   *
   *   `'y'`    — VERTICAL ONLY. The default, and the only sensible one for a kata.
   *   `'none'` — hips pinned at bind height.
   *   `'full'` — the capture also drives where the body travels on the floor.
   *
   * ═══ WHY `'none'` IS WRONG, EVEN THOUGH THE SCORE OWNS TRAVEL ══════════════════════════════
   *
   * Horizontal root motion must go: the kata score decides where the body stands, and a capture
   * that also translates would fight it. Vertical is a different quantity entirely. A karateka
   * DROPS into a stance and rises out of it, and the legs in the capture were recorded against
   * that falling pelvis. Pin the hips at bind height and the leg rotations no longer reach the
   * floor — the support foot floats on a kick and the stances stand too tall. Observed: 0.29 m of
   * float on the support foot mid-kick with `'none'`.
   */
  readonly rootMotion?: 'none' | 'y' | 'full';
  /** Trim to `[startS, endS]` of the source. Mocap files are long and contain several techniques. */
  readonly startS?: number;
  readonly endS?: number;
  /** Force a skeleton convention instead of sniffing it. */
  readonly profile?: BvhProfile;
  /** Drive the collarbones from the capture. Off by default — see the note at the skip. */
  readonly driveClavicles?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Bind-pose capture
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * World-space bind rotation of every bone in a skeleton, by bone name.
 *
 * Taken from `boneInverses` rather than by reading the live bones: the inverse bind matrix is the
 * bind pose BY DEFINITION and is immune to whatever clip happens to be playing, so this is safe to
 * call on a character mid-animation.
 */
interface BindPose {
  readonly q: Map<string, Quaternion>;
  readonly p: Map<string, Vector3>;
}

function bindWorld(skeleton: Skeleton): BindPose {
  const q = new Map<string, Quaternion>();
  const p = new Map<string, Vector3>();
  const m = new Matrix4();
  const s = new Vector3();
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i]!;
    const inv = skeleton.boneInverses[i];
    if (inv === undefined) continue;
    const bq = new Quaternion();
    const bp = new Vector3();
    m.copy(inv).invert().decompose(bp, bq, s);
    q.set(bone.name, bq);
    p.set(bone.name, bp);
  }
  return { q, p };
}

/**
 * Metres per source unit, from LEG LENGTH rather than from hip height.
 *
 * ═══ WHY NOT HIP HEIGHT ══════════════════════════════════════════════════════════════════════
 *
 * A BVH root joint has `OFFSET 0 0 0` — its height lives entirely in the per-frame position
 * channel, so before the mixer has posed anything the source hip height reads 0 and any scale
 * derived from it is meaningless. Worse, it fails SILENTLY into a plausible-looking number.
 *
 * Limb lengths are structural: they sit in the OFFSET hierarchy, need no animation to measure, and
 * are the quantity that actually has to match for a foot to reach the floor. `karate.bvh` measures
 * 19 + 15 = 34 units of leg against this character's 0.83 m, i.e. 2.44 cm per unit — inches, which
 * is the BioVision convention.
 */
function unitScale(
  src: Skeleton,
  character: Character,
  tgtBindPos: Map<string, Vector3>,
): number {
  const knee = src.bones.find((b) => b.name === 'LeftKnee' || b.name === 'LeftLeg');
  const ankle = src.bones.find((b) => b.name === 'LeftAnkle' || b.name === 'LeftFoot');
  if (knee === undefined || ankle === undefined) return 1;
  const srcLeg = knee.position.length() + ankle.position.length();
  if (srcLeg <= 1e-6) return 1;

  const thighB = character.boneFor('thigh_L');
  const calfB = character.boneFor('calf_L');
  const footB = character.boneFor('foot_L');
  if (thighB === null || calfB === null || footB === null) return 1;
  const a = tgtBindPos.get(thighB.name);
  const b = tgtBindPos.get(calfB.name);
  const c = tgtBindPos.get(footB.name);
  if (a === undefined || b === undefined || c === undefined) return 1;

  const tgtLeg = a.distanceTo(b) + b.distanceTo(c);
  return tgtLeg > 1e-6 ? tgtLeg / srcLeg : 1;
}

/** The character's skeleton, wherever the loader put it. */
function skeletonOf(character: Character): Skeleton | null {
  let found: Skeleton | null = null;
  character.root.traverse((o) => {
    if (found === null && (o as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) {
      found = (o as unknown as { skeleton: Skeleton }).skeleton;
    }
  });
  return found;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Retarget
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface BvhSource {
  readonly skeleton: Skeleton;
  readonly clip: AnimationClip;
}

export async function loadBvh(url: string): Promise<BvhSource> {
  const res = await new BVHLoader().loadAsync(url);
  return { skeleton: res.skeleton, clip: res.clip };
}

/**
 * Bake `src` onto `character`'s skeleton and return a clip playable through `character.play`.
 *
 * Throws only on a structurally unusable input (no skeleton, no mapped joints) — a per-joint miss
 * is survivable and leaves that joint at bind, which is visibly wrong in a way you can diagnose,
 * unlike a silently identity clip.
 */
export function retargetBvhClip(
  character: Character,
  src: BvhSource,
  opts: RetargetOpts = {},
): AnimationClip {
  const targetSkeleton = skeletonOf(character);
  if (targetSkeleton === null) throw new Error('retargetBvhClip: character has no SkinnedMesh');

  const srcRoot = src.skeleton.bones[0];
  if (srcRoot === undefined) throw new Error('retargetBvhClip: BVH skeleton is empty');

  const profile = opts.profile ?? detectProfile(src.skeleton.bones.map((b) => b.name));
  const srcBindPose = bindWorld(src.skeleton);
  const tgtBindPose = bindWorld(targetSkeleton);
  const srcBind = srcBindPose.q;
  const tgtBind = tgtBindPose.q;
  const s2t = opts.sourceToTarget ?? new Quaternion();

  /* Mapped pairs, PARENTS FIRST. `skeleton.bones` is already in hierarchy order for both loaders,
   * and the chain composition below depends on that — a child retargeted before its parent would
   * read a stale parent world and inherit the error. */
  interface Pair {
    readonly srcBone: Bone;
    readonly tgtBone: Bone;
    /** Index into `quatValues`. Carried so the sample loop never scans `pairs`. */
    readonly index: number;
    /**
     * Constant rotation taking the TARGET bone's local child-axis onto the SOURCE bone's, so that
     * `tgtWorld = srcWorld * axisAlign` makes the two bones point the same way in model space.
     * Never null: a bone with no usable axis is not driven at all (see the construction below).
     */
    readonly axisAlign: Quaternion;
  }

  /** The bone's local direction toward `child` — the axis the limb actually points along. */
  const childAxis = (child: Bone | null): Vector3 | null => {
    if (child === null) return null;
    const v = child.position.clone();
    return v.lengthSq() > 1e-12 ? v.normalize() : null;
  };
  const pairs: Pair[] = [];
  const pairByTarget = new Map<Bone, Pair>();
  for (const srcBone of src.skeleton.bones) {
    const contractName = profile.toContract[srcBone.name];
    if (contractName === undefined) continue;
    const tgtBone = character.boneFor(contractName);
    if (tgtBone === null) continue;
    const sb = srcBind.get(srcBone.name);
    const tb = tgtBind.get(tgtBone.name);
    if (sb === undefined || tb === undefined) continue;
    const seg = profile.segments[srcBone.name];
    /* `ENDSITE` names BVH's unnamed leaf terminators, of which there are several — resolve it as
     * "this bone's own leaf child", never by searching the skeleton for the name. */
    const srcChild =
      seg === undefined
        ? null
        : seg.srcChild === 'ENDSITE'
          ? ((srcBone.children.find((ch) => ch instanceof Bone) as Bone | undefined) ?? null)
          : (src.skeleton.bones.find(
              (b) => b.name === seg.srcChild && b.parent === srcBone,
            ) ?? null);
    const tgtChildBone = seg === undefined ? null : character.boneFor(seg.tgtChild);
    /* Only a DIRECT child yields a usable local axis: a grandchild's `.position` is expressed in
     * its own parent's frame, not this bone's. */
    const tgtChild = tgtChildBone?.parent === tgtBone ? tgtChildBone : null;

    const aSrc = childAxis(srcChild);
    const aTgt = childAxis(tgtChild);

    /**
     * ═══ NO AXIS ⇒ NOT DRIVEN AT ALL ═══════════════════════════════════════════════════════════
     *
     * A bone with no child on one side has no direction to match, and the tempting fallback —
     * transfer the delta from bind — is the formula already shown to be wrong whenever the two
     * rigs' rest directions differ. It is not a safe default; it is the same bug that pointed the
     * arms at the ceiling, just applied to fewer bones.
     *
     * On this rig exactly one joint lands here: `DEF-head`, which Rigify's deform skeleton gives no
     * child. Driven by the fallback it tilted the skull back through the whole kata. Pinned to its
     * bind rotation instead, the head simply rides the neck — and the neck IS direction-matched, so
     * the head still points where the capture points it. What is lost is skull tilt RELATIVE to the
     * neck, a few degrees nobody can name, against a backward tilt everybody can see.
     */
    if (aSrc === null || aTgt === null) continue;

    /**
     * ═══ CLAVICLES ARE NOT DRIVEN ═══════════════════════════════════════════════════════════════
     *
     * The clavicle is the one joint where direction-matching actively misleads. It is short, and
     * the two rigs disagree about what it even spans: Rigify's `DEF-shoulder.L` runs outward along
     * the collarbone, while the capture's `LeftShoulder -> LeftArm` segment is a different vector
     * on a different origin. Forcing our collarbone to point along theirs shrugs and rolls the
     * shoulder — the "weird shoulders" read — and because every arm bone hangs off it, that error
     * is inherited by the entire limb.
     *
     * Pinned, the shoulder keeps its rest placement and the upper arm — which IS reliably captured
     * — carries the whole arm. Shoulder elevation is lost. A 20-joint capture barely encodes it
     * anyway, and losing it costs far less than a permanently hunched figure.
     */
    if (!(opts.driveClavicles ?? false) && (contractName === 'clavicle_L' || contractName === 'clavicle_R')) {
      continue;
    }

    const pair: Pair = {
      srcBone,
      tgtBone,
      index: pairs.length,
      axisAlign: new Quaternion().setFromUnitVectors(aTgt, aSrc),
    };
    pairs.push(pair);
    pairByTarget.set(tgtBone, pair);
  }
  if (pairs.length === 0) throw new Error('retargetBvhClip: no BVH joint mapped onto the character');

  /**
   * ═══ WHY THE WHOLE TARGET HIERARCHY IS WALKED, NOT JUST THE MAPPED BONES ═══════════════════
   *
   * The BVH has 18 joints; this rig has 53. The gaps are not at the leaves — they are IN THE
   * MIDDLE. Rigify puts `DEF-spine003` between the chest and the clavicles, and an 18-joint
   * BioVision skeleton has nothing to drive it with.
   *
   * An unmapped bone holds its bind LOCAL rotation, which is not the same as holding its bind
   * WORLD: when its parent rotates, its world rotation goes with it. Reading a stale bind world
   * for such a parent detaches everything below it — the arms stop following the torso and the
   * figure folds up. Walking every bone in hierarchy order and composing
   * `world = parentWorld * local` costs nothing and is simply correct.
   */
  const orderedTargets = targetSkeleton.bones;
  const bindLocalQ = new Map<Bone, Quaternion>();
  for (const bone of orderedTargets) {
    const world = tgtBind.get(bone.name);
    if (world === undefined) continue;
    const parentWorld = bone.parent instanceof Bone ? tgtBind.get(bone.parent.name) : undefined;
    bindLocalQ.set(
      bone,
      parentWorld === undefined ? world.clone() : parentWorld.clone().invert().multiply(world),
    );
  }

  /* Sample at the capture's own rate. Resampling finer invents data; coarser discards the snap that
   * is the entire reason to use mocap for a karate technique. */
  const srcTrackLen = Math.max(...src.clip.tracks.map((t) => t.times.length));
  const fps = srcTrackLen > 1 ? (srcTrackLen - 1) / src.clip.duration : 30;
  const startS = Math.max(0, opts.startS ?? 0);
  const endS = Math.min(src.clip.duration, opts.endS ?? src.clip.duration);
  const frames = Math.max(2, Math.round((endS - startS) * fps) + 1);

  const mixer = new AnimationMixer(srcRoot);
  mixer.clipAction(src.clip).play();

  const times = new Float32Array(frames);
  const quatValues = pairs.map(() => new Float32Array(frames * 4));
  const rootValues = new Float32Array(frames * 3);

  /* World-space scratch. `worldNow` holds each mapped bone's RETARGETED world rotation for the
   * frame being built, keyed by target bone, so a child can read its parent's. */
  const worldNow = new Map<Bone, Quaternion>();
  const IDENTITY = new Quaternion();
  const desired = new Quaternion();
  const parentInv = new Quaternion();
  const srcWorld = new Quaternion();
  const rootPos = new Vector3();
  const rootBindPos = new Vector3();

  const tgtPelvis = character.boneFor('pelvis');
  const scale = unitScale(src.skeleton, character, tgtBindPose.p);

  const rootMotion = opts.rootMotion ?? 'y';
  const keepXZ = rootMotion === 'full';

  /**
   * Hip height is solved in ABSOLUTE terms — `pelvisWorldY(t) = srcRootY(t) * scale` — not as a
   * delta from a bind height, because the source's bind height is 0 and therefore not a reference
   * at all. Under that mapping a capture standing at 37 units lands at 0.91 m and one dropped into
   * a stance at 20 units lands at 0.49 m, which is exactly the sink a kata needs.
   *
   * ═══ WHY THE ANSWER GOES THROUGH THE PARENT'S INVERSE MATRIX ═══════════════════════════════
   *
   * A position track is in the bone's PARENT space, and on this rig that space is nothing like
   * world: Rigify keeps Blender's bone-local axes, so the pelvis reads a local position of
   * `(0, -0.002, 0.917)` — its "up" is local +Z, and its parent is itself a bone with its own
   * rotation and scale. Writing a world-space metre into `values[1]` moves the hips sideways by a
   * fraction of a millimetre and changes the height not at all.
   *
   * Inverting the parent's world matrix is convention-free: it is correct for Rigify, for Mixamo,
   * and for whatever rig turns up next, with no axis to guess.
   */
  const tgtPelvisBindWorld =
    tgtPelvis === null ? new Vector3() : (tgtBindPose.p.get(tgtPelvis.name)?.clone() ?? new Vector3());

  /* Baked with the character at IDENTITY. `parentInverseWorld` would otherwise fold in whatever
   * embusen position and heading the choreography had already applied, freezing one beat's
   * placement into the clip. Restored in the `finally` below. */
  const savedPos = character.root.position.clone();
  const savedQuat = character.root.quaternion.clone();
  character.root.position.set(0, 0, 0);
  character.root.quaternion.identity();
  character.root.updateMatrixWorld(true);

  const parentInverseWorld = new Matrix4();
  if (tgtPelvis?.parent != null) parentInverseWorld.copy(tgtPelvis.parent.matrixWorld).invert();
  const desiredWorld = new Vector3();
  rootBindPos.set(0, 0, 0);

  /**
   * ═══ GROUNDING: A CAPTURE'S FLOOR IS NOT AT ZERO ══════════════════════════════════════════════
   *
   * Mapping hip height absolutely assumes the source's floor sits at y = 0, and captures do not
   * oblige — this one's ankles range −9.7 to 13.4 in its own units, so the figure floated 14.5 cm.
   *
   * Solved by matching the LOWEST ankle of the whole performance to the target's own BIND ankle
   * height, rather than to zero: both skeletons measure the ankle joint centre, which sits well
   * above the sole, and driving that to the floor would bury the feet instead. A 5th percentile
   * rather than the strict minimum, so one glitched frame cannot define the floor for 27 seconds.
   */
  const tgtFootBone = character.boneFor('foot_L');
  const tgtBindAnkleY = tgtFootBone === null ? 0 : (tgtBindPose.p.get(tgtFootBone.name)?.y ?? 0);

  /**
   * Leg chains as BIND OFFSETS in each parent's own frame, so the foot can be forward-kinematicked
   * from the retargeted rotations without posing the character. Deriving the height correction from
   * the SOURCE instead was tried and is not solvable in closed form — it needs the target's leg
   * proportions and its bind ankle height, and getting the sign wrong simply lifts the figure
   * (measured: 0.145 m of float became 0.264 m). Measuring where the foot actually lands has no
   * sign to get wrong.
   */
  const legChains: { bone: Bone; offset: Vector3 }[][] = (
    [
      ['pelvis', 'thigh_L', 'calf_L', 'foot_L'],
      ['pelvis', 'thigh_R', 'calf_R', 'foot_R'],
    ] as const
  ).map((chain) => {
    const out: { bone: Bone; offset: Vector3 }[] = [];
    for (let i = 1; i < chain.length; i++) {
      const parent = character.boneFor(chain[i - 1]!);
      const childB = character.boneFor(chain[i]!);
      if (parent === null || childB === null) return [];
      const pw = tgtBindPose.p.get(parent.name);
      const cw = tgtBindPose.p.get(childB.name);
      const pq = tgtBind.get(parent.name);
      if (pw === undefined || cw === undefined || pq === undefined) return [];
      /* child position expressed in the PARENT's bind frame */
      out.push({
        bone: parent,
        offset: cw.clone().sub(pw).applyQuaternion(pq.clone().invert()),
      });
    }
    return out;
  });

  /** Pelvis-relative foot height per frame, filled during the sample loop. */
  const footRelY = new Float64Array(frames).fill(0);
  const worldYRaw = new Float64Array(frames);
  const fkStep = new Vector3();

  for (let f = 0; f < frames; f++) {
    const t = startS + ((endS - startS) * f) / (frames - 1);
    times[f] = t - startS;

    mixer.setTime(t);
    srcRoot.updateMatrixWorld(true);
    worldNow.clear();

    /* Hierarchy order, every bone — mapped ones take the capture's delta, unmapped ones keep their
     * bind LOCAL and inherit whatever their parent is doing. */
    for (const tgtBone of orderedTargets) {
      const parent = tgtBone.parent;
      const parentWorld = parent instanceof Bone ? worldNow.get(parent) : undefined;
      const pair = pairByTarget.get(tgtBone);

      if (pair === undefined) {
        const local = bindLocalQ.get(tgtBone);
        if (local === undefined) continue;
        desired.copy(parentWorld ?? IDENTITY).multiply(local);
        worldNow.set(tgtBone, desired.clone());
        continue;
      }

      /* ABSOLUTE: make the target segment POINT where the source segment points.
       * `tgtWorld = srcWorld * axisAlign` satisfies `tgtWorld * a_tgt == srcWorld * a_src` by
       * construction, so the limb direction transfers exactly regardless of what either rig calls
       * its rest pose. The residual freedom is twist about the bone's own axis, which a direction
       * can never determine and which the minimal-arc `axisAlign` declines to invent. */
      pair.srcBone.getWorldQuaternion(srcWorld);
      desired.copy(srcWorld).multiply(pair.axisAlign);
      if (s2t.w !== 1 || s2t.x !== 0 || s2t.y !== 0 || s2t.z !== 0) desired.premultiply(s2t);
      worldNow.set(tgtBone, desired.clone());

      parentInv.copy(parentWorld ?? IDENTITY).invert();
      const local = parentInv.multiply(desired);
      const o = f * 4;
      const i = pair.index;
      quatValues[i]![o] = local.x;
      quatValues[i]![o + 1] = local.y;
      quatValues[i]![o + 2] = local.z;
      quatValues[i]![o + 3] = local.w;
    }

    /* Desired hip position in WORLD, then back through the parent's inverse into the track's own
     * space. Height is absolute from the capture; XZ holds the bind unless the caller wants the
     * capture to drive travel too. */
    rootPos.setFromMatrixPosition(srcRoot.matrixWorld).sub(rootBindPos).multiplyScalar(scale);
    worldYRaw[f] = rootPos.y;
    rootValues[f * 3] = tgtPelvisBindWorld.x + (keepXZ ? rootPos.x : 0);
    rootValues[f * 3 + 2] = tgtPelvisBindWorld.z + (keepXZ ? rootPos.z : 0);

    /* FK both legs from a pelvis at the origin, using this frame's retargeted rotations, and keep
     * the lower foot's height. Cheap: six bones, no matrices. */
    let lowest = Infinity;
    for (const chain of legChains) {
      if (chain.length === 0) continue;
      let y = 0;
      for (const link of chain) {
        const q = worldNow.get(link.bone);
        if (q === undefined) continue;
        y += fkStep.copy(link.offset).applyQuaternion(q).y;
      }
      if (y < lowest) lowest = y;
    }
    footRelY[f] = Number.isFinite(lowest) ? lowest : 0;
  }

  /**
   * One constant lift, anchoring the height of the LOWER FOOT so the figure stands on the floor.
   *
   * ═══ WHICH PERCENTILE, AND WHY NOT THE MINIMUM ═══════════════════════════════════════════════
   *
   * Anchoring the strict minimum — or near it, at the 5th percentile — is the intuitive choice and
   * it is wrong: it plants the single deepest instant of the performance and leaves the other 95 %
   * of frames ABOVE the floor. Measured that way the lower foot averaged 0.178 m up, which is the
   * figure gliding through most of the kata.
   *
   * In a kata the support foot is down nearly always, so the anchor belongs where the BULK of the
   * distribution is, not at its tail. A quarter is the compromise: most frames plant, genuine
   * lifts (steps, the yoko-geri) stay above, and only the deepest stances dip slightly under —
   * a few millimetres of sole is invisible where a floating body is not.
   */
  const GROUND_PERCENTILE = 0.25;
  const groundErr: number[] = [];
  for (let f = 0; f < frames; f++) groundErr.push(worldYRaw[f]! + footRelY[f]!);
  groundErr.sort((a, b) => a - b);
  const anchor =
    groundErr[Math.min(groundErr.length - 1, Math.floor(groundErr.length * GROUND_PERCENTILE))] ?? 0;
  const lift = tgtBindAnkleY - anchor;

  for (let f = 0; f < frames; f++) {
    desiredWorld.set(rootValues[f * 3]!, worldYRaw[f]! + lift, rootValues[f * 3 + 2]!);
    desiredWorld.applyMatrix4(parentInverseWorld);
    rootValues[f * 3] = desiredWorld.x;
    rootValues[f * 3 + 1] = desiredWorld.y;
    rootValues[f * 3 + 2] = desiredWorld.z;
  }

  character.root.position.copy(savedPos);
  character.root.quaternion.copy(savedQuat);
  character.root.updateMatrixWorld(true);

  mixer.stopAllAction();

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = pairs.map(
    (p, i) => new QuaternionKeyframeTrack(`${p.tgtBone.name}.quaternion`, times, quatValues[i]!),
  );

  /**
   * ═══ UNMAPPED BONES ARE PINNED TO BIND, EXPLICITLY ═══════════════════════════════════════════
   *
   * The chain above composes each mapped bone's local rotation against what its parent's world
   * WILL be, and for an unmapped parent it assumes the bind local. Nothing enforces that at
   * playback: a bone with no track keeps whatever rotation the last clip left on it, so a figure
   * that has just been walking carries the walk's spine and finger rotations into the capture.
   * Every mapped bone below such a joint then inherits an error the bake never accounted for.
   *
   * Rigify puts two of these — `DEF-spine001` and `DEF-spine003` — directly between the driven
   * spine and the clavicles, so the arms are exactly what breaks. Two constant keys per bone is a
   * negligible cost for making playback reproduce the bake exactly.
   */
  const constTimes = new Float32Array([0, endS - startS]);
  for (const bone of orderedTargets) {
    if (pairByTarget.has(bone)) continue;
    const q = bindLocalQ.get(bone);
    if (q === undefined) continue;
    const v = new Float32Array([q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w]);
    tracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, constTimes, v));
  }
  if (rootMotion !== 'none' && tgtPelvis !== null) {
    tracks.push(new VectorKeyframeTrack(`${tgtPelvis.name}.position`, times, rootValues));
  }

  return new AnimationClip(opts.name ?? 'bvh', endS - startS, tracks);
}

/** Load, retarget and register under `name`, so `character.play(name)` just works afterwards. */
export async function addBvhClip(
  character: Character,
  url: string,
  opts: RetargetOpts = {},
): Promise<AnimationClip> {
  const src = await loadBvh(url);
  const name = opts.name ?? url.split('/').pop()?.replace(/\.bvh$/i, '') ?? 'bvh';
  const clip = retargetBvhClip(character, src, { ...opts, name });
  (character.clips as Map<string, AnimationClip>).set(name, clip);
  return clip;
}
