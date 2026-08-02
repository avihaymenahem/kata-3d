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
 * three ships one, and it assumes the two skeletons share a bind pose. These do not, and not by a
 * little. Measured: `AnimLib.glb`'s Rigify rests in a clean T-pose, both arms horizontal along ±X
 * with the palms down. `karate.bvh` rests with the upper arms out and the forearms hanging
 * straight down — a goalpost, elbows at 90°. `heian-nidan.bvh` rests with the LEFT arm straight up
 * and the RIGHT arm straight down, which is not a pose a body can hold and is the one place that
 * file is not mirror-symmetric. Feed any of those to a bind-difference retarget and every limb
 * inherits the mismatch as a constant twist — arms rotated inside the torso, knees inverted. The
 * bind mismatch IS the problem, so it has to be in the formula.
 *
 * ═══ THE FORMULA — MATCH FRAMES, NOT DELTAS ══════════════════════════════════════════════════
 *
 * For each mapped joint, using `a` for the bone's local axis toward its child and `r` for its ROLL
 * REFERENCE (see `SEGMENT_AXES_*` and `./boneBasis`):
 *
 *     B          = orthonormalFrame(a, r)                  // per rig, constant, computed once
 *     axisAlign  = B_src * B_tgt⁻¹                         // so tgtWorld * B_tgt == srcWorld * B_src
 *     tgtWorld(t)= srcWorld(t) * axisAlign
 *     tgtLocal(t)= tgtParentWorld(t)⁻¹ * tgtWorld(t)       // back to a storable local rotation
 *
 * The obvious alternative — transfer the DELTA FROM BIND, `tgtWorld = srcWorld * srcBind⁻¹ *
 * tgtBind` — was tried first and is wrong here. Working through it, the target segment points the
 * right way only when `tgtBind * a_tgt == srcBind * a_src`, i.e. only when the two rigs already
 * agree on their rest DIRECTIONS. Legs satisfy that by luck (both rigs hang them down) and matched
 * to 0.01; arms do not and came out inverted, pointing straight up. Frame matching has no such
 * precondition.
 *
 * ═══ WHY A SECOND AXIS, WHEN THE FIRST ONE ALREADY MEASURED 0.00° ════════════════════════════
 *
 * Because a direction is not an orientation. One axis fixes two of three degrees of freedom, and
 * the third — TWIST ABOUT THE BONE — is exactly the visible quantity at the two ends of the body:
 * which way a palm faces, which way a sole rolls. The previous build resolved it with
 * `setFromUnitVectors`, whose shortest arc is a tie-break and not an answer.
 *
 * For most of the skeleton the tie-break was accidentally RIGHT, and that is worth recording so
 * nobody re-derives it. Where the two rigs' rest poses differ only by a rotation about the
 * LEFT-RIGHT axis — pelvis, all three spine joints, neck, both thighs, both shins, both feet — the
 * shortest arc turns in exactly that plane and carries the anatomical reference along with it.
 * Measured on `heian-nidan.bvh`, twist error on all eleven of those bones was already 0.00–0.06°
 * before this change and is 0.00° after it. In particular THE ANKLES WERE NEVER BROKEN BY THIS
 * FILE: the source's sole normal reached the character's foot to 0.06°, and if a foot looks wrong
 * on screen the cause is the capture or `./footIk`, not the alignment.
 *
 * It is the ARMS that the tie-break got wrong, and it got them wrong ASYMMETRICALLY, which is why
 * the failure reads as anatomically impossible rather than as a uniform offset. `heian-nidan.bvh`
 * rests with its LEFT arm straight up (+Z) and its RIGHT arm straight down (−Z) — the one place
 * the file is not mirror-symmetric — so the two shortest arcs turn about opposite axes and land
 * the two palms in mirror-opposite places. Measured at the take's extended chudan zuki, where
 * Shotokan puts the fist palm-down: the fist was 179.5° and 151.8° from palm-down on the right,
 * 22.3° and 96.1° on the left. Right fist upside down, left fist roughly right.
 *
 * After: 11.6° / 16.2° right, 24.4° / 49.3° left. Mean over those four instants 112.4° -> 25.4°,
 * worst 179.5° -> 49.3°.
 *
 * Direction accuracy is unchanged, which is the point of `orthonormalFrame` keeping the primary
 * axis as its first basis vector: 0.00° mean segment error over the full clip both before and
 * after, worst-case 0.03° -> 0.04° (float noise from one extra matrix round trip), and 0° between
 * the baked value and what playback reproduces.
 *
 * ═══ WHAT THE ARM NUMBER ABOVE IS NOT ════════════════════════════════════════════════════════
 *
 * It is not zero, and it cannot be. The reference the arms align on is the ELBOW'S BEND PLANE, and
 * this capture's rest arm is dead straight, so the plane is not in its bind — it is measured from
 * the take (`bendFromMotion`). That recovers the plane, not the capture's rest PRONATION, which
 * nothing in the file records: the alignment therefore reads "the source at its mean forearm roll
 * sits where the character's bind sits". For a kata, where the fist is pronated most of the time,
 * that is close to right, and the ~25° residual is what "close to" costs. A capture with a
 * different roll distribution would land differently, and the honest fix is a source that names
 * its own palm — a thumb, a knuckle, any second joint in the hand.
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
import { bendPlaneNormal, frameAlign } from './boneBasis';
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
 *
 * ═══ `roll` — THE SECOND AXIS ════════════════════════════════════════════════════════════════
 *
 * A direction alone leaves the twist about it free (see `./boneBasis`). `roll` names the ANATOMICAL
 * reference that pins it, and the name has to mean the same thing on both rigs or the cure is worse
 * than the disease:
 *
 *   `hipLine`  left hip joint -> right hip joint. Both rigs rest with the pelvis square and the
 *              spine untwisted, so this is the same physical direction on each. Perpendicular to
 *              every spine and leg segment, which is what makes it usable there.
 *   `standUp`  knee -> hip: the STANDING axis, i.e. the floor normal for a rig that rests standing.
 *              Used on the foot, where it says "the sole faces the floor" — the one statement that
 *              fixes ankle roll. NOT used up the leg or spine, where it is parallel to the segment.
 *   `bendOut`  the bend plane of the joint at this bone's FAR end (upper arm -> the elbow).
 *   `bendIn`   the bend plane of the joint at this bone's NEAR end (forearm -> the elbow).
 *              Same plane, read in two different bones' frames. The elbow is a hinge, so its plane
 *              is a property of the arm and not of the pose.
 *   `none`     no shared reference exists — fall back to single-axis and admit the twist is a
 *              guess. Cheaper than a wrong reference, which looks deliberate.
 */
type RollRef = 'hipLine' | 'standUp' | 'bendOut' | 'bendIn' | 'none';

type SegmentTable = Readonly<
  Record<string, { srcChild: string; tgtChild: BoneName; roll: RollRef }>
>;

const SEGMENT_AXES_BIOVISION: SegmentTable =
  Object.freeze({
    Hips: { srcChild: 'Chest', tgtChild: 'spine_01', roll: 'hipLine' },
    Chest: { srcChild: 'Neck', tgtChild: 'spine_03', roll: 'hipLine' },
    Neck: { srcChild: 'Head', tgtChild: 'head', roll: 'hipLine' },

    LeftCollar: { srcChild: 'LeftShoulder', tgtChild: 'upperarm_L', roll: 'none' },
    LeftShoulder: { srcChild: 'LeftElbow', tgtChild: 'lowerarm_L', roll: 'bendOut' },
    LeftElbow: { srcChild: 'LeftWrist', tgtChild: 'hand_L', roll: 'bendIn' },
    /* The wrist has no shared reference: BioVision's hand is one bone with an end site and no
     * thumb, so nothing on the source names the palm. Direction-matched, twist guessed. */
    LeftWrist: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_L', roll: 'none' },

    RightCollar: { srcChild: 'RightShoulder', tgtChild: 'upperarm_R', roll: 'none' },
    RightShoulder: { srcChild: 'RightElbow', tgtChild: 'lowerarm_R', roll: 'bendOut' },
    RightElbow: { srcChild: 'RightWrist', tgtChild: 'hand_R', roll: 'bendIn' },
    RightWrist: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_R', roll: 'none' },

    LeftHip: { srcChild: 'LeftKnee', tgtChild: 'calf_L', roll: 'hipLine' },
    LeftKnee: { srcChild: 'LeftAnkle', tgtChild: 'foot_L', roll: 'hipLine' },
    LeftAnkle: { srcChild: 'ENDSITE', tgtChild: 'ball_L', roll: 'standUp' },

    RightHip: { srcChild: 'RightKnee', tgtChild: 'calf_R', roll: 'hipLine' },
    RightKnee: { srcChild: 'RightAnkle', tgtChild: 'foot_R', roll: 'hipLine' },
    RightAnkle: { srcChild: 'ENDSITE', tgtChild: 'ball_R', roll: 'standUp' },
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
  Hips: { srcChild: 'SpineLow', tgtChild: 'spine_01', roll: 'hipLine' },
  SpineLow: { srcChild: 'SpineMid', tgtChild: 'spine_02', roll: 'hipLine' },
  SpineMid: { srcChild: 'Chest', tgtChild: 'spine_03', roll: 'hipLine' },
  Chest: { srcChild: 'Neck', tgtChild: 'neck_01', roll: 'hipLine' },
  Neck: { srcChild: 'Head', tgtChild: 'head', roll: 'hipLine' },

  LeftShoulder: { srcChild: 'LeftArm', tgtChild: 'upperarm_L', roll: 'none' },
  LeftArm: { srcChild: 'LeftForearm', tgtChild: 'lowerarm_L', roll: 'bendOut' },
  LeftForearm: { srcChild: 'LeftHand', tgtChild: 'hand_L', roll: 'bendIn' },
  /* `LeftHand` is a LEAF here — 20 joints, no fingers, no end site — so it has no direction to
   * match and is not driven at all. See the note at the `continue` in the pair loop. */
  LeftHand: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_L', roll: 'none' },

  RightShoulder: { srcChild: 'RightArm', tgtChild: 'upperarm_R', roll: 'none' },
  RightArm: { srcChild: 'RightForearm', tgtChild: 'lowerarm_R', roll: 'bendOut' },
  RightForearm: { srcChild: 'RightHand', tgtChild: 'hand_R', roll: 'bendIn' },
  RightHand: { srcChild: 'ENDSITE', tgtChild: 'fingers_prox_R', roll: 'none' },

  LeftThigh: { srcChild: 'LeftLeg', tgtChild: 'calf_L', roll: 'hipLine' },
  LeftLeg: { srcChild: 'LeftFoot', tgtChild: 'foot_L', roll: 'hipLine' },
  LeftFoot: { srcChild: 'ENDSITE', tgtChild: 'ball_L', roll: 'standUp' },

  RightThigh: { srcChild: 'RightLeg', tgtChild: 'calf_R', roll: 'hipLine' },
  RightLeg: { srcChild: 'RightFoot', tgtChild: 'foot_R', roll: 'hipLine' },
  RightFoot: { srcChild: 'ENDSITE', tgtChild: 'ball_R', roll: 'standUp' },
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Roll references — the second axis, resolved from each rig's OWN geometry
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Everything needed to answer "which way does this bone's roll reference point, in its own frame".
 *
 * Held per rig, and every number in it comes from that rig's bind pose — never from a world axis
 * constant. `standUp` is the rig's own leg, not `(0,1,0)`: the BVH rests Z-up and the character
 * Y-up, and a hard-coded axis would silently mean "backwards" on one of them.
 */
interface RollRefs {
  readonly bind: BindPose;
  /** Left hip joint -> right hip joint, world at bind. */
  readonly hipLine: Vector3 | null;
  /** Knee -> hip, world at bind: the standing axis, i.e. the floor normal of a rig at rest. */
  readonly standUp: Vector3 | null;
  /** Elbow bend-plane normal, ALREADY in the named bone's own local frame. */
  readonly bend: ReadonlyMap<string, Vector3>;
}

/** The whole-body references, averaged over both sides so one missing bone cannot skew them. */
function bodyRefs(
  pos: ReadonlyMap<string, Vector3>,
  boneNameFor: (c: BoneName) => string | null,
): { hipLine: Vector3 | null; standUp: Vector3 | null } {
  const at = (c: BoneName): Vector3 | null => {
    const n = boneNameFor(c);
    return n === null ? null : (pos.get(n) ?? null);
  };
  const hipL = at('thigh_L');
  const hipR = at('thigh_R');
  const kneeL = at('calf_L');
  const kneeR = at('calf_R');

  let hipLine: Vector3 | null = null;
  if (hipL !== null && hipR !== null) {
    const v = hipR.clone().sub(hipL);
    if (v.lengthSq() > 1e-12) hipLine = v.normalize();
  }

  const up = new Vector3();
  if (hipL !== null && kneeL !== null) up.add(hipL).sub(kneeL);
  if (hipR !== null && kneeR !== null) up.add(hipR).sub(kneeR);
  const standUp = up.lengthSq() > 1e-12 ? up.normalize() : null;

  return { hipLine, standUp };
}

/** The three joints whose triangle is one bone's bend plane, named on one rig. */
interface BendTriple {
  /** Whose local frame the normal is stored in. */
  readonly bone: string;
  readonly joints: readonly [string, string, string];
}

/**
 * Which triangle each `bendOut`/`bendIn` bone reads, derived from the segment table rather than
 * written out again — one table stays one table, and the two rigs' chains cannot drift apart.
 *
 * `bendOut` on bone A takes (A, its segment child, that child's segment child); `bendIn` on bone B
 * takes (whatever has B as its segment child, B, B's segment child). Both name the SAME three
 * joints and therefore the same plane, which is the whole point — the elbow's plane read once in
 * the humerus's frame and once in the forearm's.
 */
function bendTriples(profile: BvhProfile): { src: BendTriple[]; tgt: BendTriple[] } {
  const segs = profile.segments;
  const parentOf = new Map<string, string>();
  for (const [name, seg] of Object.entries(segs)) parentOf.set(seg.srcChild, name);

  const src: BendTriple[] = [];
  const tgt: BendTriple[] = [];
  for (const [name, seg] of Object.entries(segs)) {
    if (seg.roll !== 'bendOut' && seg.roll !== 'bendIn') continue;
    const contract = profile.toContract[name];
    if (contract === undefined) continue;

    let a: string, b: string, c: string;
    let tA: BoneName | undefined, tB: BoneName | undefined, tC: BoneName | undefined;
    if (seg.roll === 'bendOut') {
      const mid = segs[seg.srcChild];
      if (mid === undefined) continue;
      [a, b, c] = [name, seg.srcChild, mid.srcChild];
      [tA, tB, tC] = [contract, seg.tgtChild, mid.tgtChild];
    } else {
      const upName = parentOf.get(name);
      const up = upName === undefined ? undefined : segs[upName];
      if (upName === undefined || up === undefined) continue;
      [a, b, c] = [upName, name, seg.srcChild];
      [tA, tB, tC] = [profile.toContract[upName]!, up.tgtChild, seg.tgtChild];
    }
    /* `ENDSITE` is the shared name of every BVH leaf, so it cannot key a position lookup — a
     * triple that reaches one is skipped and that bone falls back to single-axis. */
    if ([a, b, c].includes('ENDSITE')) continue;
    if (tA === undefined || tB === undefined || tC === undefined) continue;
    src.push({ bone: name, joints: [a, b, c] });
    tgt.push({ bone: contract, joints: [tA, tB, tC] });
  }
  return { src, tgt };
}

/** Bend-plane normals taken from a rig's BIND pose, in each bone's own local frame. */
function bendFromBind(
  bind: BindPose,
  pos: ReadonlyMap<string, Vector3>,
  triples: readonly BendTriple[],
  boneNameFor: (key: string) => string | null,
): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  const p = (key: string): Vector3 | null => {
    const n = boneNameFor(key);
    return n === null ? null : (pos.get(n) ?? null);
  };
  for (const t of triples) {
    const [j0, j1, j2] = t.joints;
    const p0 = p(j0), p1 = p(j1), p2 = p(j2);
    const own = boneNameFor(t.bone);
    if (p0 === null || p1 === null || p2 === null || own === null) continue;
    const n = bendPlaneNormal(p0, p1, p2);
    const q = bind.q.get(own);
    if (n === null || q === undefined) continue;
    out.set(t.bone, n.applyQuaternion(q.clone().invert()).normalize());
  }
  return out;
}

/** Elbow must be bent at least this much for the frame's plane to be signal rather than noise. */
const BEND_SAMPLE_MIN_COS = Math.cos((45 * Math.PI) / 180);
/** Frames sampled when measuring a bend plane from motion. 240 over ~27 s is ~9 Hz — plenty. */
const BEND_SAMPLES = 240;

/**
 * Bend-plane normals measured from the CAPTURE'S OWN MOTION, for a rig whose bind arm is straight.
 *
 * ═══ WHY THIS IS MEASUREMENT AND NOT INVENTION ═══════════════════════════════════════════════
 *
 * `heian-nidan.bvh` rests with both arms dead straight (`LeftArm -> LeftForearm -> LeftHand` are
 * collinear along ±Z to the last decimal), so its bind names no elbow plane. But THE ELBOW IS A
 * HINGE: its axis is a fixed property of the arm, not of the pose, so every frame in which the arm
 * is meaningfully bent measures the same quantity. Averaging over the whole take, weighted by how
 * bent the arm is, is reading a constant off the data — not choosing one.
 *
 * Measured over the WHOLE source clip on purpose, never the trimmed window, so every slice of one
 * capture (`mocap-oi-zuki` and the full `heian-nidan`) gets the identical alignment. A per-window
 * measurement would make two clips of the same performance disagree about which way a fist faces.
 *
 * Residual scatter on `heian-nidan`: 15.2° (right) and 27.9° (left) mean deviation about the mean
 * normal, against a 225° range of captured forearm twist — the arms are the noisiest part of this
 * solve. That scatter is the honest error bar on the result; see the header.
 */
function bendFromMotion(
  skeleton: Skeleton,
  mixer: AnimationMixer,
  duration: number,
  triples: readonly BendTriple[],
): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  if (triples.length === 0 || duration <= 0) return out;
  const bones = new Map(skeleton.bones.map((b) => [b.name, b]));
  const root = skeleton.bones[0];
  if (root === undefined) return out;

  const sums = triples.map(() => new Vector3());
  const p0 = new Vector3(), p1 = new Vector3(), p2 = new Vector3();
  const d0 = new Vector3(), d1 = new Vector3(), n = new Vector3();
  const inv = new Quaternion();

  for (let i = 0; i < BEND_SAMPLES; i++) {
    mixer.setTime((duration * i) / (BEND_SAMPLES - 1));
    root.updateMatrixWorld(true);
    for (let k = 0; k < triples.length; k++) {
      const t = triples[k]!;
      const a = bones.get(t.joints[0]);
      const b = bones.get(t.joints[1]);
      const c = bones.get(t.joints[2]);
      const own = bones.get(t.bone);
      if (a === undefined || b === undefined || c === undefined || own === undefined) continue;
      a.getWorldPosition(p0);
      b.getWorldPosition(p1);
      c.getWorldPosition(p2);
      d0.copy(p1).sub(p0);
      d1.copy(p2).sub(p1);
      if (d0.lengthSq() < 1e-12 || d1.lengthSq() < 1e-12) continue;
      d0.normalize();
      d1.normalize();
      if (d0.dot(d1) > BEND_SAMPLE_MIN_COS) continue;
      /* |cross| IS sin(bend), so using it unnormalised weights each frame by how much the joint
       * was actually bent — a nearly straight frame carries nearly no vote. */
      n.crossVectors(d0, d1);
      own.getWorldQuaternion(inv).invert();
      sums[k]!.add(n.applyQuaternion(inv));
    }
  }
  for (let k = 0; k < triples.length; k++) {
    const s = sums[k]!;
    if (s.lengthSq() > 1e-12) out.set(triples[k]!.bone, s.normalize());
  }
  return out;
}

/** The roll reference for one bone, in that bone's own local frame. `null` = fall back. */
function rollAxis(refs: RollRefs, boneName: string, key: string, kind: RollRef): Vector3 | null {
  if (kind === 'none') return null;
  if (kind === 'bendOut' || kind === 'bendIn') return refs.bend.get(key) ?? null;
  const world = kind === 'hipLine' ? refs.hipLine : refs.standUp;
  const q = refs.bind.q.get(boneName);
  if (world === null || q === undefined) return null;
  return world.clone().applyQuaternion(q.clone().invert());
}

/**
 * Rest-pose world positions of a BVH skeleton, composed from the OFFSET hierarchy.
 *
 * ═══ WHY `bindWorld` CANNOT SUPPLY THESE ═════════════════════════════════════════════════════
 *
 * `BVHLoader` constructs its `Skeleton` from bones whose `matrixWorld` has never been updated, so
 * every inverse it computes is the IDENTITY and the bind pose it reports is "every joint at the
 * origin, unrotated". The rotations in that are accidentally correct — a BVH rest pose really is
 * unrotated, which is why the direction match never noticed — but every position reads (0,0,0),
 * and a roll reference built from those is silently null. Cost of finding that out: the spine and
 * legs quietly falling back to single-axis while the arms worked.
 *
 * Composed from `.position` alone, ignoring rotations, which is exact for a BVH (rest rotations
 * are identity) and stays exact if the skeleton has since been posed: BVH gives every non-root
 * bone a position track whose keys all equal its offset. A posed ROOT would shift everything
 * uniformly, and every use here is a DIFFERENCE of two joints, so it cancels.
 */
function restPositions(skeleton: Skeleton): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  for (const bone of skeleton.bones) {
    const parent = bone.parent;
    const base = parent instanceof Bone ? out.get(parent.name) : undefined;
    out.set(bone.name, (base?.clone() ?? new Vector3()).add(bone.position));
  }
  return out;
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

  /* Created HERE rather than beside the sample loop because the bend-plane measurement below needs
   * the source posed, and that has to happen before the alignments are built. Sampling it leaves
   * the source skeleton on its last sampled frame, which is harmless: every later read of a bone's
   * `.position` wants an OFFSET, and BVH gives non-root bones a position track whose every key IS
   * the offset. Only the root translates, and nothing below reads the root's position. */
  const mixer = new AnimationMixer(srcRoot);
  mixer.clipAction(src.clip).play();

  /* ── the two rigs' roll references ─────────────────────────────────────────────────────────
   *
   * Both are resolved from the rig's own bind geometry, keyed to the CONTRACT so one code path
   * serves BioVision, this capture, Rigify and Mixamo. The source's bend planes are the one
   * exception: a BVH that rests with a straight arm has none, so they come from its motion. */
  const srcNameOf = (() => {
    const rev = new Map<BoneName, string>();
    for (const [bvh, contract] of Object.entries(profile.toContract)) {
      if (!rev.has(contract)) rev.set(contract, bvh);
    }
    return (c: BoneName): string | null => rev.get(c) ?? null;
  })();
  const tgtNameOf = (c: BoneName): string | null => character.boneFor(c)?.name ?? null;

  const srcRest = restPositions(src.skeleton);
  const triples = bendTriples(profile);
  const srcBendBind = bendFromBind(srcBindPose, srcRest, triples.src, (k) => k);
  const srcBend =
    srcBendBind.size === triples.src.length
      ? srcBendBind
      : new Map([
          ...bendFromMotion(
            src.skeleton,
            mixer,
            src.clip.duration,
            triples.src.filter((t) => !srcBendBind.has(t.bone)),
          ),
          ...srcBendBind,
        ]);
  const srcRefs: RollRefs = {
    bind: srcBindPose,
    ...bodyRefs(srcRest, srcNameOf),
    bend: srcBend,
  };
  const tgtRefs: RollRefs = {
    bind: tgtBindPose,
    ...bodyRefs(tgtBindPose.p, tgtNameOf),
    bend: bendFromBind(tgtBindPose, tgtBindPose.p, triples.tgt, (k) => tgtNameOf(k as BoneName)),
  };

  /* Mapped pairs, PARENTS FIRST. `skeleton.bones` is already in hierarchy order for both loaders,
   * and the chain composition below depends on that — a child retargeted before its parent would
   * read a stale parent world and inherit the error. */
  interface Pair {
    readonly srcBone: Bone;
    readonly tgtBone: Bone;
    /** Index into `quatValues`. Carried so the sample loop never scans `pairs`. */
    readonly index: number;
    /**
     * Constant rotation taking the TARGET bone's local FRAME onto the SOURCE bone's, so that
     * `tgtWorld = srcWorld * axisAlign` makes the two bones point the same way in model space AND
     * roll the same way about themselves. Falls back to the child axis alone where the two rigs
     * share no second reference. Never null: a bone with no usable axis is not driven at all.
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
     * `DEF-head` lands here from the TARGET side: Rigify's deform skeleton gives it no child.
     * Driven by the fallback it tilted the skull back through the whole kata. Pinned to its bind
     * rotation instead, the head simply rides the neck — and the neck IS direction-matched, so the
     * head still points where the capture points it. What is lost is skull tilt RELATIVE to the
     * neck, a few degrees nobody can name, against a backward tilt everybody can see.
     *
     * ═══ AND THE HANDS, FROM THE SOURCE SIDE — MEASURED, NOT ASSUMED ═══════════════════════════
     *
     * `heian-nidan.bvh` ends each arm AT the wrist: `LeftHand` and `RightHand` are 3-channel leaves
     * with no end site, no finger and no thumb, so there is no wrist->something direction to match.
     * With the forearm now frame-aligned there was a real case for driving them anyway — inherit
     * the forearm's frame correspondence and lay the capture's own wrist rotation on top, which is
     * the standard formula for a joint that lacks a direction. It was tried and it is WRONG HERE,
     * for a reason that is visible in one measurement: the capture's hand sits a MEDIAN 95.6° (left)
     * and 82.2° (right) away from its forearm, all take long, ranging over only ±30° about that.
     * A wrist does not bend 90° and stay there. That constant is a frame convention the file never
     * records, not a pose, and transferring it plants a permanently broken wrist — the exact defect
     * this work exists to remove. The ±30° that rides on top is the real wrist motion, and it is
     * not separable from the constant without inventing the constant.
     *
     * So the hands stay pinned to bind LOCAL, i.e. rigid to the forearm — and that is now worth
     * having, because the forearm's roll is what a pinned hand inherits. Fixing the forearm's frame
     * IS the palm fix; the wrist joint itself was never where the visible error lived.
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

    /**
     * ═══ TWO AXES WHEN BOTH RIGS OFFER A SECOND ONE, ONE WHEN THEY DO NOT ══════════════════════
     *
     * `frameAlign` builds an orthonormal frame on each rig from (child direction, roll reference)
     * and returns the rotation that makes the two frames coincide. Its first column is the child
     * direction untouched, so the direction match is bit-for-bit what `setFromUnitVectors` gave —
     * measured at 0.00° mean over the whole clip before and after. The second column is the part
     * that used to be a coin flip.
     *
     * `null` means one of the rigs has no usable reference for this bone — the references are
     * parallel to the segment, or the source's bind names no bend plane. Then, and only then, the
     * old shortest-arc answer stands: it is arbitrary, but it is arbitrary in a documented place
     * rather than everywhere.
     */
    const rollSrc = rollAxis(srcRefs, srcBone.name, srcBone.name, seg?.roll ?? 'none');
    const rollTgt = rollAxis(tgtRefs, tgtBone.name, contractName, seg?.roll ?? 'none');
    const framed =
      rollSrc !== null && rollTgt !== null ? frameAlign(aSrc, rollSrc, aTgt, rollTgt) : null;

    const pair: Pair = {
      srcBone,
      tgtBone,
      index: pairs.length,
      axisAlign: framed ?? new Quaternion().setFromUnitVectors(aTgt, aSrc),
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

      /* ABSOLUTE: make the target segment POINT where the source segment points, and ROLL the way
       * the source segment rolls. `tgtWorld = srcWorld * axisAlign` satisfies
       * `tgtWorld * a_tgt == srcWorld * a_src` by construction, so the limb direction transfers
       * exactly regardless of what either rig calls its rest pose; where `axisAlign` came from a
       * two-axis frame it also satisfies the same identity for the roll reference. */
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
