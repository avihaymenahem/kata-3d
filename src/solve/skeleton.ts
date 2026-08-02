/**
 * B3 SOLVER — `src/solve/skeleton.ts`
 *
 * The BIND pose and the forward-kinematics pass every other stage builds on. doc 06 §4.1–§4.2;
 * ARCHITECTURE.md §4.3.
 *
 * ═══ THIS IS THE SOLVER'S SKELETON, NOT THE RIG'S ═══════════════════════════════════════════
 * B4's `src/rig/bones.ts` builds a three.js `Bone` tree for RENDERING. This file builds the same
 * geometry as flat `Float64Array`s for SOLVING. They are not duplicates and they must not be
 * merged: `src/solve/**` is Node-safe and GL-free by contract (§9.1 A-12,
 * `tests/contracts/imports.test.ts`), so the compiler cannot touch a `Bone`, and the renderer
 * cannot afford a `Float64Array` round trip per frame. What keeps them identical is that BOTH
 * read `REST_OFFSET_H` and apply the SAME single §2.1 conversion — B4 through its allowlisted
 * bind-pose flip site, this file through `toWorld`.
 *
 * ═══ EVERY REST LOCAL QUATERNION IS IDENTITY ════════════════════════════════════════════════
 * `REST_LOCAL_QUAT_IS_IDENTITY` (doc 06 §0). That is what makes a bone-local quaternion in
 * `PoseTrack.q` mean "rotation away from bind" with no per-bone offset to remember, and it is why
 * the delta layers of §3.9 can be built by plain inversion. Asserted here rather than assumed.
 */

import { Quaternion, Vector3 } from 'three';

import type { BoneIndex, BoneName } from '../contracts';
import {
  BONE_COUNT,
  BONE_ORDER,
  BONE_PARENT,
  H,
  HEEL_OFFSET_H,
  REST_OFFSET_H,
  TOE_TIP_OFFSET_H,
  boneIndex,
} from '../contracts';
import { toWorld } from './frame';
import { primaryAxisWorld } from './swingTwist';

export interface BoneDef {
  readonly index: BoneIndex;
  readonly name: BoneName;
  readonly parent: number;
  /** Parent-local rest translation, WORLD frame, METRES. */
  readonly offsetM: readonly [number, number, number];
  /** `|offsetM|`. Zero for `root` and for the two zero-offset helpers. */
  readonly lengthM: number;
  /** `toWorld(PRIMARY_AXIS[bone])` — the twist axis, already converted. */
  readonly axisWorld: readonly [number, number, number];
  readonly children: readonly BoneIndex[];
}

const buildDefs = (): readonly BoneDef[] => {
  const kids: BoneIndex[][] = Array.from({ length: BONE_COUNT }, () => []);
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = BONE_PARENT[i]!;
    if (p >= 0) kids[p]!.push(i as BoneIndex);
  }
  return Object.freeze(
    BONE_ORDER.map((name, i) => {
      const o = toWorld([
        REST_OFFSET_H[i * 3]!,
        REST_OFFSET_H[i * 3 + 1]!,
        REST_OFFSET_H[i * 3 + 2]!,
      ]);
      const offsetM: readonly [number, number, number] = [o[0] * H, o[1] * H, o[2] * H];
      return Object.freeze({
        index: i as BoneIndex,
        name,
        parent: BONE_PARENT[i]!,
        offsetM,
        lengthM: Math.hypot(offsetM[0], offsetM[1], offsetM[2]),
        axisWorld: primaryAxisWorld(name),
        children: Object.freeze(kids[i]!),
      });
    }),
  );
};

/** One `BoneDef` per bone, in `BONE_ORDER`. Parents always precede children. */
export const BONE_DEFS: readonly BoneDef[] = buildDefs();

/** Parent-local rest offset in WORLD metres, flat. `boneOffset(i)` reads `[i*3 .. i*3+2]`. */
export const BONE_OFFSET_M: Readonly<Float64Array> = (() => {
  const a = new Float64Array(BONE_COUNT * 3);
  for (const d of BONE_DEFS) {
    a[d.index * 3] = d.offsetM[0];
    a[d.index * 3 + 1] = d.offsetM[1];
    a[d.index * 3 + 2] = d.offsetM[2];
  }
  return a;
})();

/** Parent-local rest offset of one bone, WORLD frame, metres. */
export function boneOffset(b: BoneIndex | number): readonly [number, number, number] {
  return BONE_DEFS[b]!.offsetM;
}

/** Bone-to-parent distance in metres — the segment length the IK uses as `lenAB` / `lenBC`. */
export function boneLengthM(b: BoneIndex | number): number {
  return BONE_DEFS[b]!.lengthM;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * FORWARD KINEMATICS. One forward pass; `BONE_ORDER` guarantees parents come first.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Caller-owned FK scratch. Hoisted per solve, never per frame. */
export interface Skel {
  /** World position per bone, metres. `BONE_COUNT*3`. */
  readonly worldPos: Float64Array;
  /** World rotation per bone, xyzw. `BONE_COUNT*4`. */
  readonly worldQuat: Float64Array;
  /** Bone-LOCAL rotation per bone, xyzw. The thing that ends up in `PoseTrack.q`. */
  readonly localQuat: Float64Array;
  /** World root translation, metres. */
  readonly rootPos: Float64Array;
  /** World root rotation, xyzw. */
  readonly rootQuat: Float64Array;
}

export function newSkel(): Skel {
  const s: Skel = {
    worldPos: new Float64Array(BONE_COUNT * 3),
    worldQuat: new Float64Array(BONE_COUNT * 4),
    localQuat: new Float64Array(BONE_COUNT * 4),
    rootPos: new Float64Array(3),
    rootQuat: new Float64Array([0, 0, 0, 1]),
  };
  resetToBind(s);
  return s;
}

/** Every local quaternion to identity (doc 06 §0), root at the origin. */
export function resetToBind(s: Skel): void {
  for (let i = 0; i < BONE_COUNT; i++) {
    s.localQuat[i * 4] = 0;
    s.localQuat[i * 4 + 1] = 0;
    s.localQuat[i * 4 + 2] = 0;
    s.localQuat[i * 4 + 3] = 1;
  }
  s.rootPos[0] = 0;
  s.rootPos[1] = 0;
  s.rootPos[2] = 0;
  s.rootQuat[0] = 0;
  s.rootQuat[1] = 0;
  s.rootQuat[2] = 0;
  s.rootQuat[3] = 1;
  forwardKinematics(s);
}

const _q = new Quaternion();
const _qp = new Quaternion();
const _v = new Vector3();

/**
 * Resolve `localQuat` + `rootPos`/`rootQuat` into `worldPos`/`worldQuat`. Allocation-free.
 *
 * The root bone (index 0) takes the track's root transform directly; every other bone is
 * `parentWorld ∘ (offset, local)`.
 */
export function forwardKinematics(s: Skel): void {
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = BONE_PARENT[i]!;
    if (p < 0) {
      /* `root`: the track's world transform. Its own rest offset is (0,0,0) on the floor. */
      _q.set(s.rootQuat[0]!, s.rootQuat[1]!, s.rootQuat[2]!, s.rootQuat[3]!);
      _q.multiply(_qp.set(s.localQuat[0]!, s.localQuat[1]!, s.localQuat[2]!, s.localQuat[3]!));
      s.worldQuat[0] = _q.x;
      s.worldQuat[1] = _q.y;
      s.worldQuat[2] = _q.z;
      s.worldQuat[3] = _q.w;
      s.worldPos[0] = s.rootPos[0]!;
      s.worldPos[1] = s.rootPos[1]!;
      s.worldPos[2] = s.rootPos[2]!;
      continue;
    }
    _qp.set(
      s.worldQuat[p * 4]!,
      s.worldQuat[p * 4 + 1]!,
      s.worldQuat[p * 4 + 2]!,
      s.worldQuat[p * 4 + 3]!,
    );
    _v.set(BONE_OFFSET_M[i * 3]!, BONE_OFFSET_M[i * 3 + 1]!, BONE_OFFSET_M[i * 3 + 2]!);
    _v.applyQuaternion(_qp);
    s.worldPos[i * 3] = s.worldPos[p * 3]! + _v.x;
    s.worldPos[i * 3 + 1] = s.worldPos[p * 3 + 1]! + _v.y;
    s.worldPos[i * 3 + 2] = s.worldPos[p * 3 + 2]! + _v.z;

    _q.copy(_qp).multiply(
      _tmpQ.set(s.localQuat[i * 4]!, s.localQuat[i * 4 + 1]!, s.localQuat[i * 4 + 2]!, s.localQuat[i * 4 + 3]!),
    );
    s.worldQuat[i * 4] = _q.x;
    s.worldQuat[i * 4 + 1] = _q.y;
    s.worldQuat[i * 4 + 2] = _q.z;
    s.worldQuat[i * 4 + 3] = _q.w;
  }
}

const _tmpQ = new Quaternion();

/** Read one bone's world position into `out`. */
export function worldPosOf(s: Skel, b: BoneIndex | number, out: Float64Array): Float64Array {
  out[0] = s.worldPos[b * 3]!;
  out[1] = s.worldPos[b * 3 + 1]!;
  out[2] = s.worldPos[b * 3 + 2]!;
  return out;
}

/** Write a bone's LOCAL quaternion. The caller re-runs `forwardKinematics` when it is done. */
export function setLocal(s: Skel, b: BoneIndex | number, q: Quaternion): void {
  s.localQuat[b * 4] = q.x;
  s.localQuat[b * 4 + 1] = q.y;
  s.localQuat[b * 4 + 2] = q.z;
  s.localQuat[b * 4 + 3] = q.w;
}

/** Read a bone's LOCAL quaternion into `out`. */
export function getLocal(s: Skel, b: BoneIndex | number, out: Quaternion): Quaternion {
  return out.set(
    s.localQuat[b * 4]!,
    s.localQuat[b * 4 + 1]!,
    s.localQuat[b * 4 + 2]!,
    s.localQuat[b * 4 + 3]!,
  );
}

/** Read a bone's WORLD quaternion into `out`. */
export function getWorldQuat(s: Skel, b: BoneIndex | number, out: Quaternion): Quaternion {
  return out.set(
    s.worldQuat[b * 4]!,
    s.worldQuat[b * 4 + 1]!,
    s.worldQuat[b * 4 + 2]!,
    s.worldQuat[b * 4 + 3]!,
  );
}

/**
 * Apply a WORLD-space delta to a bone and store the result as its LOCAL quaternion — doc 06 §6.1
 * step 5's "convert back: `bone.quaternion = parent.worldQuat.invert() * bone.worldQuat`".
 */
export function applyWorldDelta(s: Skel, b: BoneIndex | number, deltaXYZW: Float64Array): void {
  const p = BONE_PARENT[b]!;
  _q.set(deltaXYZW[0]!, deltaXYZW[1]!, deltaXYZW[2]!, deltaXYZW[3]!);
  getWorldQuat(s, b, _tmpQ);
  _q.multiply(_tmpQ); // world' = delta * world
  if (p < 0) {
    setLocal(s, b, _q);
    return;
  }
  getWorldQuat(s, p, _qp).invert();
  _q.premultiply(_qp);
  setLocal(s, b, _q);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The BIND pose, resolved once. Used for rest heights, segment lengths and the COM datum.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const BIND: Skel = newSkel();

/** Bind-pose world position of every bone, metres. Frozen at module load; never mutated. */
export const REST_WORLD_M: Readonly<Float64Array> = BIND.worldPos.slice();

/** Bind-pose world position of one bone, metres. */
export function restWorld(b: BoneIndex | number): readonly [number, number, number] {
  return [REST_WORLD_M[b * 3]!, REST_WORLD_M[b * 3 + 1]!, REST_WORLD_M[b * 3 + 2]!];
}

/** Bind-pose height of a bone above the floor, FracH. `pelvis` -> 0.5308, `head_end` -> ~1.0. */
export function restHeightH(b: BoneIndex | number): number {
  return REST_WORLD_M[b * 3 + 1]! / H;
}

/* ── The two auxiliary foot landmarks doc 06 §4.2 defines but does not make bones. ────────── */

/** `heel = foot + (0, −0.0300, +0.0415)`, bone-local, converted. */
export const HEEL_OFFSET_M: readonly [number, number, number] = (() => {
  const w = toWorld(HEEL_OFFSET_H);
  return [w[0] * H, w[1] * H, w[2] * H];
})();

/** `toe_tip = ball + (0, −0.0098, −0.0393)`, bone-local, converted. */
export const TOE_TIP_OFFSET_M: readonly [number, number, number] = (() => {
  const w = toWorld(TOE_TIP_OFFSET_H);
  return [w[0] * H, w[1] * H, w[2] * H];
})();

/** World position of a foot's heel landmark. */
export function heelWorld(s: Skel, side: 'L' | 'R', out: Float64Array): Float64Array {
  const f = boneIndex(side === 'L' ? 'foot_L' : 'foot_R');
  getWorldQuat(s, f, _q);
  _v.set(HEEL_OFFSET_M[0], HEEL_OFFSET_M[1], HEEL_OFFSET_M[2]).applyQuaternion(_q);
  out[0] = s.worldPos[f * 3]! + _v.x;
  out[1] = s.worldPos[f * 3 + 1]! + _v.y;
  out[2] = s.worldPos[f * 3 + 2]! + _v.z;
  return out;
}

/** World position of a foot's toe-tip landmark. */
export function toeTipWorld(s: Skel, side: 'L' | 'R', out: Float64Array): Float64Array {
  const b = boneIndex(side === 'L' ? 'ball_L' : 'ball_R');
  getWorldQuat(s, b, _q);
  _v.set(TOE_TIP_OFFSET_M[0], TOE_TIP_OFFSET_M[1], TOE_TIP_OFFSET_M[2]).applyQuaternion(_q);
  out[0] = s.worldPos[b * 3]! + _v.x;
  out[1] = s.worldPos[b * 3 + 1]! + _v.y;
  out[2] = s.worldPos[b * 3 + 2]! + _v.z;
  return out;
}

/* ── Named indices the stages use constantly. Resolved once, not per call. ────────────────── */

export const BI = Object.freeze({
  root: boneIndex('root'),
  pelvis: boneIndex('pelvis'),
  spine01: boneIndex('spine_01'),
  spine02: boneIndex('spine_02'),
  spine03: boneIndex('spine_03'),
  chest: boneIndex('chest'),
  ribcage: boneIndex('ribcage'),
  neck: boneIndex('neck_01'),
  head: boneIndex('head'),
  headEnd: boneIndex('head_end'),
  eyeL: boneIndex('eye_L'),
  eyeR: boneIndex('eye_R'),
  clavicleL: boneIndex('clavicle_L'),
  clavicleR: boneIndex('clavicle_R'),
  upperarmL: boneIndex('upperarm_L'),
  upperarmR: boneIndex('upperarm_R'),
  lowerarmL: boneIndex('lowerarm_L'),
  lowerarmR: boneIndex('lowerarm_R'),
  handL: boneIndex('hand_L'),
  handR: boneIndex('hand_R'),
  thighL: boneIndex('thigh_L'),
  thighR: boneIndex('thigh_R'),
  calfL: boneIndex('calf_L'),
  calfR: boneIndex('calf_R'),
  footL: boneIndex('foot_L'),
  footR: boneIndex('foot_R'),
  ballL: boneIndex('ball_L'),
  ballR: boneIndex('ball_R'),
});

/** Side-indexed accessors, so a stage never writes `side === 'L' ? … : …` inline. */
export const sideBones = (side: 'L' | 'R') =>
  side === 'L'
    ? { clavicle: BI.clavicleL, upperarm: BI.upperarmL, lowerarm: BI.lowerarmL, hand: BI.handL,
        thigh: BI.thighL, calf: BI.calfL, foot: BI.footL, ball: BI.ballL, eye: BI.eyeL }
    : { clavicle: BI.clavicleR, upperarm: BI.upperarmR, lowerarm: BI.lowerarmR, hand: BI.handR,
        thigh: BI.thighR, calf: BI.calfR, foot: BI.footR, ball: BI.ballR, eye: BI.eyeR };

/** Thigh->calf and calf->foot lengths, metres — `lenAB`/`lenBC` for the leg chain. */
export const LEG_LEN_M = Object.freeze({
  thighToCalf: boneLengthM(BI.calfL),
  calfToFoot: boneLengthM(BI.footL),
});

/** Upperarm->lowerarm and lowerarm->hand lengths, metres — the arm chain. */
export const ARM_LEN_M = Object.freeze({
  upperarmToLowerarm: boneLengthM(BI.lowerarmL),
  lowerarmToHand: boneLengthM(BI.handL),
});
