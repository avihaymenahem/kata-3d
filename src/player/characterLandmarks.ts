/**
 * B6 PLAYER — `src/player/characterLandmarks.ts` — `Landmarks` read off the clip-driven figure.
 *
 * ═══ WHY THIS IS NOT `src/rig`'s `sampleLandmarks` ════════════════════════════════════════════
 *
 * `sampleLandmarks` takes a `RigHandles` and reads `rig.byName[bone].matrixWorld` — the procedural
 * skeleton, built to the contract's 52 bones. The figure on screen is a loaded glTF on a foreign
 * skeleton (Rigify, or Mixamo) with no `RigHandles` anywhere in it. Same OUTPUT contract, different
 * input, so it is a second reader rather than a change to the first.
 *
 * ═══ WHY IT MATTERS ══════════════════════════════════════════════════════════════════════════
 *
 * `Landmarks` is what the camera rig frames on and what the contact shadow fits to. Left reading
 * the procedural rig — which the clip path never poses and never moves — both would key off a bind
 * pose standing at the embusen origin, while the character walks 16.9 m of Taikyoku Shodan away
 * from it. The symptom is not subtle once the kata leaves the top bar: the subject exits frame and
 * the shadow stays behind.
 *
 * ═══ WHAT IS NOT FILLED, AND WHY THAT IS SAFE HERE ═══════════════════════════════════════════
 *
 * `comXZ` is the whole-body centre of mass, which needs per-segment masses this skeleton does not
 * carry. It is approximated by the pelvis ground projection — honest for framing, and NOT good
 * enough for a balance metric. Nothing on the clip path computes a balance metric; if something
 * ever does, it needs a real mass model, not this.
 */

import { Quaternion, Vector3, type Bone } from 'three';

import {
  BONE_PARENT_NAME,
  CANONICAL_FROM_BONE,
  CANONICAL_JOINTS,
  type BoneName,
  type Landmarks,
} from '../contracts';
import type { Character } from './character';

/**
 * The nearest ANCESTOR of `name` that this rig actually has.
 *
 * ═══ WHY A STALE LANDMARK IS WORSE THAN AN APPROXIMATE ONE ═══════════════════════════════════
 *
 * Not every contract joint exists on every rig — Rigify has no head-tip and no eye bones. Leaving
 * those entries untouched sounds harmless and is not: `Landmarks` is seeded once at boot from the
 * PROCEDURAL rig, which stands at the embusen origin, so an unmapped joint keeps a bind-pose
 * position at world zero for the whole session while the character walks metres away.
 *
 * Everything that consumes `Landmarks` takes bounds over all 25 joints — the camera framing and
 * the contact-shadow fit both do — so one stranded point drags the box back toward the origin. It
 * measured a 2.69 m light-space extent for a 1.75 m figure. Substituting the nearest real ancestor
 * puts the joint a few centimetres out instead of several metres, which every consumer tolerates.
 */
function nearestMapped(character: Character, name: BoneName): Bone | null {
  let cur: BoneName | null = name;
  for (let guard = 0; cur !== null && guard < 16; guard++) {
    const bone = character.boneFor(cur);
    if (bone !== null) return bone;
    cur = BONE_PARENT_NAME[cur];
  }
  return null;
}

const _p = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _quat = new Quaternion();

/** doc 07 §0.3's striking-point proxy: this far beyond the wrist, along the hand axis. */
const FIST_BEYOND_WRIST_M = 0.055;

function worldOf(bone: Bone, out: Vector3): Vector3 {
  return out.setFromMatrixPosition(bone.matrixWorld);
}

/**
 * Fill `out` from the character's CURRENT world matrices.
 *
 * The caller must have run `updateMatrixWorld` for this frame already — this reads matrices, it
 * does not refresh them, exactly like `sampleLandmarks`.
 */
export function sampleCharacterLandmarks(
  character: Character,
  tick: number,
  out: Landmarks,
): void {
  out.tick = tick;

  for (let i = 0; i < CANONICAL_JOINTS.length; i++) {
    const joint = CANONICAL_JOINTS[i]!;
    const boneName: BoneName = CANONICAL_FROM_BONE[joint];
    /* Falls back to the nearest real ancestor rather than being skipped — see `nearestMapped`. */
    const bone = nearestMapped(character, boneName);
    const o = i * 3;
    if (bone === null) continue;

    worldOf(bone, _p);

    if (joint === 'LeftFistCenter' || joint === 'RightFistCenter') {
      /* Push along wrist -> middle-finger-proximal, the hand's own axis. Falls back to the raw
       * wrist when the finger is unmapped, which is a 5 cm error and not a wrong place. */
      const knuckle = character.boneFor(joint === 'LeftFistCenter' ? 'fingers_prox_L' : 'fingers_prox_R');
      if (knuckle !== null) {
        worldOf(knuckle, _a).sub(_p);
        if (_a.lengthSq() > 1e-12) _p.addScaledVector(_a.normalize(), FIST_BEYOND_WRIST_M);
      }
    }

    out.pos[o] = _p.x;
    out.pos[o + 1] = _p.y;
    out.pos[o + 2] = _p.z;

    const q = i * 4;
    bone.getWorldQuaternion(_quat);
    out.quat[q] = _quat.x;
    out.quat[q + 1] = _quat.y;
    out.quat[q + 2] = _quat.z;
    out.quat[q + 3] = _quat.w;
  }

  fillFoot(character, 'L', out.heelL, out.toeTipL);
  fillFoot(character, 'R', out.heelR, out.toeTipR);

  const ghL = character.boneFor('upperarm_L');
  const ghR = character.boneFor('upperarm_R');
  if (ghL !== null) worldOf(ghL, _p).toArray(out.ghL);
  if (ghR !== null) worldOf(ghR, _p).toArray(out.ghR);

  const pelvis = character.boneFor('pelvis');
  if (pelvis !== null) {
    worldOf(pelvis, _p);
    out.comXZ[0] = _p.x;
    out.comXZ[1] = _p.z;
  }
}

/**
 * Heel and toe tip, derived from the ankle/ball pair rather than from a bone-local offset table:
 * a foreign skeleton has no `HEEL_OFFSET_H`, but it does have an ankle and a toe, and the heel is
 * the same distance behind the ankle as the toe is in front, projected to the floor.
 */
function fillFoot(
  character: Character,
  side: 'L' | 'R',
  heelOut: Float32Array,
  toeOut: Float32Array,
): void {
  const ankle = character.boneFor(side === 'L' ? 'foot_L' : 'foot_R');
  const ball = character.boneFor(side === 'L' ? 'ball_L' : 'ball_R');
  if (ankle === null) return;

  worldOf(ankle, _a);
  if (ball === null) {
    _a.toArray(heelOut);
    _a.toArray(toeOut);
    return;
  }
  worldOf(ball, _b);

  _p.copy(_b).sub(_a).setY(0);
  const fwd = _p.lengthSq() > 1e-12 ? _p.normalize() : _p.set(0, 0, 1);

  heelOut[0] = _a.x - fwd.x * 0.06;
  heelOut[1] = 0;
  heelOut[2] = _a.z - fwd.z * 0.06;

  toeOut[0] = _b.x + fwd.x * 0.05;
  toeOut[1] = 0;
  toeOut[2] = _b.z + fwd.z * 0.05;
}
