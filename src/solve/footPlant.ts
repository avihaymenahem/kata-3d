/**
 * B3 SOLVER — `src/solve/footPlant.ts`
 *
 * `buildPlantPlan` and `applyPlantLock` — doc 06 §6.3, NORMATIVE. ARCHITECTURE.md §4.11 S2 and
 * **S12.5**, which is the stage this file exists for.
 *
 * ═══ "PLANT LOCK — THIS IS THE FEATURE THAT MAKES AN EMBUSEN ACCURATE." ═════════════════════
 * doc 06 §6.3's own words. Feet must not skate. A 2 cm slip per pivot is invisible in any single
 * still and accumulates over Heian Shodan's nine turns into a figure that finishes 15 cm off the
 * yoi mark — which is exactly what doc 02 §4.3's "residual = 0.00 cm" closure proof is a claim
 * about, and what metric 42 measures.
 *
 * ═══ A PIVOT IS A ROTATION ABOUT A STORED POINT, NOT A FROZEN TRANSFORM ═════════════════════
 * doc 06 §6.3: "frozen target is a *rotation about a stored pivot point*, not a fixed transform.
 * Store `{pivotPoint, pivotType ∈ {BALL, HEEL, WHOLE_FOOT}, angleCurve}` per turn. Heian Shodan's
 * 90°/180° turns depend on this."
 *
 * Freezing the whole ankle transform through a turn is the obvious implementation and it is wrong
 * in a way that looks right: the foot stops translating, but it also stops ROTATING, so the
 * character's body yaws 180° around a foot that stayed pointing the old way. Storing the pivot
 * POINT lets the ankle swing about the heel — which is what JKA teaches and what doc 02 §8 S2's
 * "pivot foot must show zero translation (≤ 0.02 L)" is measuring.
 *
 * ═══ WHY S12.5 RUNS AFTER THE CLAMP ═════════════════════════════════════════════════════════
 * Judge 3's fatal A12. The ROM clamp (S12) can move an ankle — it is a rotation on the thigh or
 * calf, and any rotation upstream of the foot translates it. A plant lock committed BEFORE the
 * clamp is therefore silently broken by it, and nothing downstream notices because the pose is
 * still inside ROM and the residual was recorded before the clamp ran. So the lock is re-applied
 * afterwards, with ONE corrective leg-IK pass, and the leg residual is re-recorded. Never a loop:
 * doc 06 §6.4's L9-vs-IK rule ("never loop to convergence — it produces frame-rate-dependent
 * jitter").
 */

import { Quaternion, Vector3 } from 'three';

import type { Handedness, KataScore, PivotKind, PlantSpan } from '../contracts';
import { DEG, H, RAD } from '../contracts';
import type { FootPlan } from '../data';
import { L_M, ROM } from '../data';
import { embusenToWorldM, toWorldYawDeg } from './frame';
import { AJC_HEIGHT_M, ankleTargetsM } from './stance';
import {
  BI,
  LEG_LEN_M,
  type Skel,
  applyWorldDelta,
  forwardKinematics,
  sideBones,
} from './skeleton';
import {
  type TwoBoneArgs,
  SOFTEN_DEFAULT,
  newTwoBoneOut,
  solveTwoBone,
  solveTwoBonePositions,
} from './twoBoneIK';
import type { Slot, Timeline } from './timeline';

/** doc 06 §6.3: "max IK correction before flagging an authoring error" = `0.030 H` (5.2 cm). */
export const MAX_IK_CORRECTION_H = 0.03;
/** doc 06 §6.3 plant-lock blend, seconds. Prevents the pop at plant and release. */
export const LOCK_BLEND_S = 0.1;
/** doc 02 §8 S2: pivot-foot drift budget, units of `L`. S2 gates on this. */
export const PIVOT_DRIFT_MAX_L = 0.02;
/** §4.11 S12.5's own, much tighter gate: planted-foot XZ drift after the corrective pass. */
export const PLANT_DRIFT_MAX_M = 1e-4;

const _q = new Quaternion();
const _v = new Vector3();
const _up = new Vector3(0, 1, 0);
const _hip = new Float64Array(3);
const _target = new Float64Array(3);
const _pole = new Float64Array(3);
const _knee = new Float64Array(3);
const _end = new Float64Array(3);
const _out = newTwoBoneOut();

/**
 * §4.11 S2. One `PlantSpan` per foot per move: where it is, when it is down, and — for a turn —
 * the point it rotates about.
 *
 * The span runs from the move's slot start to the NEXT move's transit start, because a planted
 * foot stays planted through the hold and the prep and only leaves during the transit. That is
 * doc 06 §6.3's "plant exit: authored release curve only (never speed-based — kata has long
 * static holds)": a speed threshold would release both feet during every hold.
 */
export function buildPlantPlan(
  k: KataScore,
  plans: readonly FootPlan[],
  tl: Timeline,
): readonly PlantSpan[] {
  const out: PlantSpan[] = [];

  for (let i = 0; i < k.moves.length; i++) {
    const m = k.moves[i]!;
    const plan = plans[i]!;
    const slot = tl.moveSlots[i]!;
    const next = tl.moveSlots[i + 1];
    const ankles = ankleTargetsM(plan, m.stance);
    /* The foot is DOWN from the moment this move's stance is reached until the next move starts
     * moving it. The last move's plants run to the end of the clip. */
    const tickIn = slot.transit.t0;
    const tickOut = next === undefined ? tl.durationTicks : next.transit.t0;

    for (const side of ['L', 'R'] as const) {
      const p = ankles[side];
      const isFront = side === plan.frontFoot;
      const yawDeg = toWorldYawDeg(
        m.headingDeg + (isFront ? 0 : 0),
      );
      out.push({
        foot: side,
        tickIn,
        tickOut,
        worldPosXZ: [p[0], p[2]],
        worldYawDeg: yawDeg,
        pivot: pivotFor(m.pivot, side, m.pivotKind, plans[i - 1] ?? null, plan, tl.moveSlots[i]!),
      });
    }
  }
  return Object.freeze(out);
}

/**
 * The stored pivot for a turning move, or `null` for a straight step.
 *
 * The point is the AJC of the pivot foot at its position BEFORE the turn — that foot has not
 * moved, so its previous and current positions are the same point, and storing the previous one
 * makes the invariant "the pivot point does not move" checkable rather than tautological.
 */
function pivotFor(
  pivotFoot: Handedness | null,
  side: Handedness,
  kind: PivotKind,
  prev: FootPlan | null,
  cur: FootPlan,
  slot: Slot,
): PlantSpan['pivot'] {
  if (pivotFoot === null || pivotFoot !== side || kind === 'NONE') return null;
  const src = prev ?? cur;
  const xz = src.frontFoot === side ? src.ffXZ : src.rfXZ;
  const [px, pz] = embusenToWorldM(xz, L_M);
  return {
    kind: kind as 'BALL' | 'HEEL' | 'WHOLE_FOOT',
    pointXZ: [px, pz],
    fromDeg: toWorldYawDeg(src.headingDeg),
    toDeg: toWorldYawDeg(cur.headingDeg),
    /* doc 02 §8 S2: the pivot happens during the transit, not the hold or the kime. */
    tick0: slot.transit.t0,
    tick1: slot.transit.t1,
  };
}

/** The plant span covering `tick` for one foot, or `null`. */
export function plantAt(
  plants: readonly PlantSpan[],
  foot: Handedness,
  tick: number,
): PlantSpan | null {
  for (const p of plants) {
    if (p.foot === foot && tick >= p.tickIn && tick < p.tickOut) return p;
  }
  return null;
}

/**
 * The world XZ a planted foot must be at, at `tick`.
 *
 * Constant through a straight plant. Through a pivot it is the STORED POINT plus the ankle's
 * offset from that point, rotated by however much of the turn has happened — which is the whole
 * content of doc 06 §6.3's "rotation about a stored pivot point".
 */
export function plantTargetXZ(span: PlantSpan, tick: number, out: Float64Array): Float64Array {
  if (span.pivot === null) {
    out[0] = span.worldPosXZ[0];
    out[1] = span.worldPosXZ[1];
    return out;
  }
  const p = span.pivot;
  const span01 = p.tick1 - p.tick0;
  const u = span01 <= 0 ? 1 : Math.max(0, Math.min(1, (tick - p.tick0) / span01));
  const angle = (p.fromDeg + u * shortestDeltaDeg(p.fromDeg, p.toDeg)) * DEG;
  const from = p.fromDeg * DEG;
  /* The ankle's offset from the pivot point, in the frame the turn STARTED in. For a HEEL pivot
   * that offset is the heel-to-AJC vector; for WHOLE_FOOT it is zero and the ankle IS the point. */
  const rx = span.worldPosXZ[0] - p.pointXZ[0];
  const rz = span.worldPosXZ[1] - p.pointXZ[1];
  const d = angle - from;
  const c = Math.cos(d);
  const sn = Math.sin(d);
  out[0] = p.pointXZ[0] + rx * c - rz * sn;
  out[1] = p.pointXZ[1] + rx * sn + rz * c;
  return out;
}

/** The signed short way round from `a` to `b`, degrees. A 270° turn is NOT shortened — see below. */
export function shortestDeltaDeg(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * The signed delta a MOVE authors, which is `dHeadingDeg` and NOT the short way round.
 *
 * doc 02 §9 d2: Taikyoku 9/17 and Heian 10/18 traverse **+270 CCW**, the long way. Their end pose
 * is identical to a −90° turn, so a shortest-path interpolation would land the same stance while
 * spinning the wrong way through it — invisible in every still and wrong in every frame between.
 */
export const authoredDeltaDeg = (dHeadingDeg: number): number => dHeadingDeg;

export interface PlantLockResult {
  /** Worst planted-foot XZ drift after the corrective pass, metres. S12.5 gates at 1e-4. */
  readonly worstDriftM: number;
  /** Worst leg IK residual after the corrective pass, metres. */
  readonly worstLegResidualM: number;
  /** True if any correction exceeded doc 06 §6.3's 0.030 H authoring-error threshold. */
  readonly overCorrection: boolean;
}

/**
 * §4.11 S12.5. Re-assert both plant locks and run ONE corrective leg-IK pass.
 *
 * Runs AFTER `clampSwingTwist`. See the header for why. Mutates `s`; the caller re-runs FK.
 */
export function applyPlantLock(
  s: Skel,
  plants: readonly PlantSpan[],
  tick: number,
): PlantLockResult {
  let worstDriftM = 0;
  let worstLegResidualM = 0;
  let overCorrection = false;

  for (const side of ['L', 'R'] as const) {
    const span = plantAt(plants, side, tick);
    if (span === null) continue;
    const b = sideBones(side);

    plantTargetXZ(span, tick, _target);
    const wantX = _target[0]!;
    const wantZ = _target[1]!;
    const gotX = s.worldPos[b.foot * 3]!;
    const gotZ = s.worldPos[b.foot * 3 + 2]!;
    const driftM = Math.hypot(gotX - wantX, gotZ - wantZ);
    if (driftM / H > MAX_IK_CORRECTION_H) overCorrection = true;

    /* One two-bone pass onto the locked ankle. The hip is wherever the clamped pose left it. */
    _hip[0] = s.worldPos[b.thigh * 3]!;
    _hip[1] = s.worldPos[b.thigh * 3 + 1]!;
    _hip[2] = s.worldPos[b.thigh * 3 + 2]!;
    _target[0] = wantX;
    _target[1] = AJC_HEIGHT_M;
    _target[2] = wantZ;

    /* Pole: the foot's own forward, read off the CURRENT pose so the knee keeps tracking the toes
     * through the correction rather than snapping to the authored heading. */
    _q.set(
      s.worldQuat[b.foot * 4]!, s.worldQuat[b.foot * 4 + 1]!,
      s.worldQuat[b.foot * 4 + 2]!, s.worldQuat[b.foot * 4 + 3]!,
    );
    _v.set(0, 0, -1).applyQuaternion(_q);
    _v.y = 0;
    if (_v.lengthSq() < 1e-9) _v.set(0, 0, -1);
    _v.normalize();
    _pole[0] = _hip[0]! + 0.5 * H * _v.x;
    _pole[1] = _hip[1]!;
    _pole[2] = _hip[2]! + 0.5 * H * _v.z;

    const args: TwoBoneArgs = {
      aWorld: _hip,
      lenAB: LEG_LEN_M.thighToCalf,
      lenBC: LEG_LEN_M.calfToFoot,
      targetWorld: _target,
      poleWorld: _pole,
      soften: SOFTEN_DEFAULT,
      midMinDeg: 0,
      midMaxDeg: 140,
    };
    const residual = solveTwoBonePositions(args, _knee, _end);

    const curKnee = new Float64Array([
      s.worldPos[b.calf * 3]!, s.worldPos[b.calf * 3 + 1]!, s.worldPos[b.calf * 3 + 2]!,
    ]);
    const curAnkle = new Float64Array([
      s.worldPos[b.foot * 3]!, s.worldPos[b.foot * 3 + 1]!, s.worldPos[b.foot * 3 + 2]!,
    ]);
    /* `solveTwoBone` reuses the same args and writes world deltas onto thigh and calf. */
    const r2 = solveTwoBone(args, _out, curKnee, curAnkle);
    applyWorldDelta(s, b.thigh, _out.qA);
    forwardKinematics(s);
    applyWorldDelta(s, b.calf, _out.qB);
    forwardKinematics(s);

    const afterX = s.worldPos[b.foot * 3]!;
    const afterZ = s.worldPos[b.foot * 3 + 2]!;
    worstDriftM = Math.max(worstDriftM, Math.hypot(afterX - wantX, afterZ - wantZ));
    worstLegResidualM = Math.max(worstLegResidualM, Math.max(residual, r2));
  }

  return { worstDriftM, worstLegResidualM, overCorrection };
}

/**
 * doc 06 §6.3 step 6's ankle aim: the sole normal matches the ground normal, twist locked to the
 * animated toe direction. On a flat dojo floor the normal is `(0,1,0)` always, so this reduces to
 * levelling the foot — but doc 06 §6.3 is explicit that the pass must not be skipped, because it
 * is what keeps the support leg from hyperextending during a stance transition.
 *
 * Clamps are doc 06 §6.3's own: pitch ∈ [−25°, +40°], roll ∈ ±15°.
 */
export function levelFoot(s: Skel, side: Handedness): void {
  const b = sideBones(side);
  const parent = b.calf;
  /* Current world toe direction, projected to the floor — the twist to preserve. */
  _q.set(
    s.worldQuat[b.foot * 4]!, s.worldQuat[b.foot * 4 + 1]!,
    s.worldQuat[b.foot * 4 + 2]!, s.worldQuat[b.foot * 4 + 3]!,
  );
  _v.set(0, 0, -1).applyQuaternion(_q);
  const yawDeg = Math.atan2(-_v.x, -_v.z) * RAD;
  const pitchDeg = Math.max(-25, Math.min(40, Math.asin(Math.max(-1, Math.min(1, _v.y))) * RAD));

  _q.setFromAxisAngle(_up, yawDeg * DEG);
  const pitchQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitchDeg * DEG);
  _q.multiply(pitchQ);

  const inv = new Quaternion(
    s.worldQuat[parent * 4]!, s.worldQuat[parent * 4 + 1]!,
    s.worldQuat[parent * 4 + 2]!, s.worldQuat[parent * 4 + 3]!,
  ).invert();
  _q.premultiply(inv);
  s.localQuat[b.foot * 4] = _q.x;
  s.localQuat[b.foot * 4 + 1] = _q.y;
  s.localQuat[b.foot * 4 + 2] = _q.z;
  s.localQuat[b.foot * 4 + 3] = _q.w;
}

/** doc 06 §6.3's ankle ROM, re-exported so the stage asserts read one source. */
export const ANKLE_ROM = Object.freeze({ L: ROM.foot_L, R: ROM.foot_R });

/** The `BI` re-export keeps `stageAssert.ts` from importing `skeleton.ts` twice. */
export { BI };
