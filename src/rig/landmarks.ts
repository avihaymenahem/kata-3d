/**
 * B4 RIG — `src/rig/landmarks.ts`
 *
 * `sampleLandmarks(rig, tick, out)` — §3.13. Fills the 25 canonical joints of doc 07 §0.3, the two
 * virtual `*FistCenter` points, the heel / toe-tip / glenohumeral extras, and the floor-projected
 * whole-body COM. World space, metres.
 *
 * ═══ IT MUST STAMP `out.tick` ════════════════════════════════════════════════════════════════
 * `src/contracts/rig.ts` makes `Landmarks.tick` the ONE mutable field in the interface, and says why
 * in capitals: without the stamp, every `Landmarks` the harness hands B9 reports tick 0 and
 * `MetricResult.tick` is wrong for every metric — while B9's own `joints()` (which builds a fresh
 * object) would NOT show the bug, so two paths would disagree silently. `tests/rig/closure.test.ts`
 * asserts `sampleLandmarks(rig, 12345, out); out.tick === 12345`.
 *
 * ═══ MATRIX FRESHNESS IS THE CALLER'S JOB ════════════════════════════════════════════════════
 * This function reads `bone.matrixWorld` and does NOT call `updateMatrixWorld`. §6.6 budgets
 * `rig.root.updateMatrixWorld(true)` as its own frame line item, immediately after `applyPose`, so
 * re-walking the tree here would double that cost on the hot path. Any caller that has just written
 * bone quaternions must update first — `createLandmarks()` below is the allocation-free scratch
 * every caller should reuse.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  boneIndex,
  CANONICAL_COUNT,
  CANONICAL_FROM_BONE,
  CANONICAL_JOINTS,
  FIST_CENTER_OFFSET_H,
  H,
  HEEL_OFFSET_H,
  TOE_TIP_OFFSET_H,
  type BoneName,
  type Landmarks,
  type RigHandles,
} from '../contracts';
import { SEG_COM_PCT, SEG_MASS } from '../data';
import { authoredOffsetToBuiltM, BUILT_PRIMARY_AXIS, readVec3 } from './bones';

/** Caller-owned scratch, per §3.13's out-param signature. */
export function createLandmarks(): Landmarks {
  return {
    tick: 0,
    pos: new Float32Array(CANONICAL_COUNT * 3),
    quat: new Float32Array(CANONICAL_COUNT * 4),
    heelL: new Float32Array(3),
    heelR: new Float32Array(3),
    toeTipL: new Float32Array(3),
    toeTipR: new Float32Array(3),
    ghL: new Float32Array(3),
    ghR: new Float32Array(3),
    comXZ: new Float32Array(2),
  };
}

/* ── module scratch: `sampleLandmarks` allocates nothing ─────────────────────────────────── */
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _v = new Vector3();
const _off = new Vector3();
const _m = new Matrix4();
const _com = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

const worldPos = (rig: RigHandles, n: BoneName, out: Vector3): Vector3 =>
  out.setFromMatrixPosition(rig.byName[n].matrixWorld);

const write3 = (dst: Float32Array, o: number, v: Vector3): void => {
  dst[o] = v.x;
  dst[o + 1] = v.y;
  dst[o + 2] = v.z;
};

/**
 * doc 06 §2 segment COM table, as `[massPct, proximalBone, distalBone, comPctFromProximal]`.
 *
 * The two rows that need care:
 *   * TRUNK. de Leva's trunk runs suprasternale -> mid-hip, and suprasternale is NOT a bone: it sits
 *     `SUPRASTERNALE_ABOVE_CHEST_H` above the `chest` joint. Using `chest` itself puts the trunk COM
 *     at 0.6797 H and using `neck_01` puts it at 0.7140 H, against doc 06 §2.1's own 0.6989 H;
 *     the offset point reproduces 0.6993 H, which is what makes `|COM_y/H - 0.568| < 0.008` (§2.1's
 *     stated unit test, B3's `tests/solve/stances.test.ts`) come out right.
 *   * HEAD. de Leva's head runs vertex -> mid-gonion with the COM 59.76 % from the VERTEX, so the
 *     proximal endpoint is `head_end` and the distal one is `head` (the AOJ ~ the gonion line).
 */
const SUPRASTERNALE_ABOVE_CHEST_H = 0.0355;

type ComRow = readonly [
  massKey: string,
  proximal: BoneName | 'suprasternale' | 'heelL' | 'heelR',
  distal: BoneName | 'toeTipL' | 'toeTipR',
  comPctKey: string,
];

const COM_ROWS: readonly ComRow[] = [
  ['head', 'head_end', 'head', 'head'],
  ['trunk', 'suprasternale', 'pelvis', 'trunk'],
  ['upperarm', 'upperarm_L', 'lowerarm_L', 'upperarm'],
  ['upperarm', 'upperarm_R', 'lowerarm_R', 'upperarm'],
  ['forearm', 'lowerarm_L', 'hand_L', 'forearm'],
  ['forearm', 'lowerarm_R', 'hand_R', 'forearm'],
  ['hand', 'hand_L', 'fingers_end_L', 'hand'],
  ['hand', 'hand_R', 'fingers_end_R', 'hand'],
  ['thigh', 'thigh_L', 'calf_L', 'thigh'],
  ['thigh', 'thigh_R', 'calf_R', 'thigh'],
  ['shank', 'calf_L', 'foot_L', 'shank'],
  ['shank', 'calf_R', 'foot_R', 'shank'],
  ['foot', 'heelL', 'toeTipL', 'foot'],
  ['foot', 'heelR', 'toeTipR', 'foot'],
];

export function sampleLandmarks(rig: RigHandles, tick: number, out: Landmarks): void {
  // §3.10, in capitals: STAMP THE TICK.
  out.tick = tick;

  for (let i = 0; i < CANONICAL_JOINTS.length; i++) {
    const joint = CANONICAL_JOINTS[i]!;
    const bone = CANONICAL_FROM_BONE[joint];
    const m = rig.byName[bone].matrixWorld;
    m.decompose(_p, _q, _s);

    if (joint === 'LeftFistCenter' || joint === 'RightFistCenter') {
      // doc 07 §0.3: 0.030 H beyond the WRIST along the hand axis — the striking-point proxy that
      // every fist metric reads instead of `*Hand`.
      readVec3(BUILT_PRIMARY_AXIS, boneIndex(bone), _v).applyQuaternion(_q);
      _p.addScaledVector(_v, FIST_CENTER_OFFSET_H * H);
    }

    write3(out.pos, i * 3, _p);
    out.quat[i * 4] = _q.x;
    out.quat[i * 4 + 1] = _q.y;
    out.quat[i * 4 + 2] = _q.z;
    out.quat[i * 4 + 3] = _q.w;
  }

  // Heels and toe tips: authored bone-local offsets, flipped once in `bones.ts`.
  for (const h of ['L', 'R'] as const) {
    _m.copy(rig.byName[`foot_${h}` as BoneName].matrixWorld);
    authoredOffsetToBuiltM(HEEL_OFFSET_H, _off).applyMatrix4(_m);
    write3(h === 'L' ? out.heelL : out.heelR, 0, _off);

    _m.copy(rig.byName[`ball_${h}` as BoneName].matrixWorld);
    authoredOffsetToBuiltM(TOE_TIP_OFFSET_H, _off).applyMatrix4(_m);
    write3(h === 'L' ? out.toeTipL : out.toeTipR, 0, _off);

    // Glenohumeral centre === the SJC === the `upperarm` bone origin (doc 06 §4.2).
    worldPos(rig, `upperarm_${h}` as BoneName, _p);
    write3(h === 'L' ? out.ghL : out.ghR, 0, _p);
  }

  // Whole-body COM, doc 06 §2. Projected to the floor, which is what metric 42 and the support
  // polygon overlay both want.
  _com.set(0, 0, 0);
  let massSum = 0;
  for (const [massKey, prox, dist, comKey] of COM_ROWS) {
    const mass = SEG_MASS[massKey]!.v;
    const frac = SEG_COM_PCT[comKey]!.v / 100;
    resolvePoint(rig, prox, out, _a);
    resolvePoint(rig, dist, out, _b);
    _com.addScaledVector(_a.lerp(_b, frac), mass);
    massSum += mass;
  }
  _com.divideScalar(massSum);
  out.comXZ[0] = _com.x;
  out.comXZ[1] = _com.z;
}

function resolvePoint(
  rig: RigHandles,
  key: ComRow[1] | ComRow[2],
  out: Landmarks,
  dst: Vector3,
): Vector3 {
  switch (key) {
    case 'suprasternale':
      // A point on the chest bone, so it rotates with the thorax rather than floating in world Y.
      _m.copy(rig.byName.chest.matrixWorld);
      return dst.set(0, SUPRASTERNALE_ABOVE_CHEST_H * H, 0).applyMatrix4(_m);
    case 'heelL':
      return dst.set(out.heelL[0]!, out.heelL[1]!, out.heelL[2]!);
    case 'heelR':
      return dst.set(out.heelR[0]!, out.heelR[1]!, out.heelR[2]!);
    case 'toeTipL':
      return dst.set(out.toeTipL[0]!, out.toeTipL[1]!, out.toeTipL[2]!);
    case 'toeTipR':
      return dst.set(out.toeTipR[0]!, out.toeTipR[1]!, out.toeTipR[2]!);
    default:
      return dst.setFromMatrixPosition(rig.byName[key].matrixWorld);
  }
}

/** Whole-body COM including Y — the same arithmetic, exposed for B3's §2.1 unit test and B9. */
export function bodyCentreOfMass(rig: RigHandles, lm: Landmarks, out: Vector3): Vector3 {
  out.set(0, 0, 0);
  let massSum = 0;
  for (const [massKey, prox, dist, comKey] of COM_ROWS) {
    const mass = SEG_MASS[massKey]!.v;
    const frac = SEG_COM_PCT[comKey]!.v / 100;
    resolvePoint(rig, prox, lm, _a);
    resolvePoint(rig, dist, lm, _b);
    out.addScaledVector(_a.lerp(_b, frac), mass);
    massSum += mass;
  }
  return out.divideScalar(massSum);
}
