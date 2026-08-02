/**
 * B3 SOLVER — `src/solve/arm.ts`
 *
 * `solveArm`, `solveHikite`, `clavicleRhythm`, `poleFor` — doc 03 §4–§13 and doc 06 §5.4 / §6.2.
 * ARCHITECTURE.md §4.11 S4 and S10.
 *
 * ═══ `dx` IS A MAGNITUDE. THE SOLVER APPLIES `−s·dx`. ═══════════════════════════════════════
 * §3.8, verbatim: "`dx` is written WITHOUT the side factor; solver applies `-s*dx`."
 * doc 03 §0.3 writes every row as `±s·k` with `+` = toward the character's LEFT, and §3.8 stores
 * the magnitude `k`. With `s = sideSign(hand)` — `s(L) = −1`, `s(R) = +1` in WORLD space (§2.1) —
 * the world offset is `−s·k`.
 *
 * `tests/contracts/handedness.test.ts` pins why: half the biacromial breadth is 0.1295 H, so a
 * chudan zuki's `dx = 0.130` from the acting GH must land MCP2 on the mid-sagittal plane. Invert
 * the sign and the fist finishes 0.26 H off centre, on the wrong side of the body — the classic
 * "punching past yourself" tell, and one that no scalar metric in the 63 catches because they all
 * measure distances.
 *
 * ═══ THE FOREARM ROLL IS WHY THE BAKE LADDER HAS A 960 RUNG ═════════════════════════════════
 * doc 03 §4.3: `roll(τ) = 180·clamp((τ−0.65)/0.35, 0, 1)^2.2` over a 0.18 s stroke.
 *
 *     dθ/dτ at u = 1  =  180 · 2.2 / 0.35  =  1131.4 deg per unit τ
 *     dθ/dt           =  1131.4 / 0.18     =  **6285 deg/s**   = `ROLL_PEAK_RATE_DEG_S`
 *
 * §2.4's criterion 2 (≤ 12° per baked interval) then needs `dt ≤ 12/6285 = 1.91 ms`, i.e. 524 Hz,
 * i.e. the 960 rung. `tests/contracts/bake-error.test.ts` asserts the compiled track actually
 * REACHES that rung — "a track that never reaches the 960 rung did not bake the roll". So this
 * curve is not decoration: it is the thing the ladder was sized for, and flattening it would make
 * the bake gate pass vacuously.
 */

import { Quaternion, Vector3 } from 'three';

import type { Handedness, HandShape, TechniqueSpec } from '../contracts';
import { DEG, H, RAD, boneIndex, kimeEase } from '../contracts';
import { HIKITE_HIP_A, HIKITE_TATE_B, ROM, TECHNIQUES, techniqueKey } from '../data';
import { sideSign } from './frame';
import {
  ARM_LEN_M,
  BI,
  BONE_DEFS,
  type Skel,
  applyWorldDelta,
  forwardKinematics,
  getLocal,
  getWorldQuat,
  setLocal,
  sideBones,
} from './skeleton';
import {
  type TwoBoneArgs,
  SOFTEN_DEFAULT,
  includedAngleDeg,
  newTwoBoneOut,
  quatFromUnitVectors,
  solveTwoBone,
  solveTwoBonePositions,
} from './twoBoneIK';

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _gh = new Float64Array(3);
const _target = new Float64Array(3);
const _pole = new Float64Array(3);
const _elbow = new Float64Array(3);
const _wrist = new Float64Array(3);
const _chestQ = new Quaternion();
const _vp = new Vector3();
const _perp = new Vector3();
const _out = newTwoBoneOut();

/** doc 03 §4.3's roll exponent and window. Authored here because they are curve SHAPE, not data. */
export const ROLL_EXPONENT = 2.2;
export const ROLL_WINDOW_START = 0.65;

/**
 * doc 03 §4.3, verbatim: `roll(τ) = rollDeg · clamp((τ − w0)/(w1 − w0), 0, 1)^2.2`.
 *
 * `+` is PRONATION. The axis it acts about is `toWorld(PRIMARY_AXIS[lowerarm])`, which is why
 * `swingTwist.ts` insists on the conversion — feeding the raw authored axis rotates the fist the
 * other way and every zuki finishes palm up.
 */
export function forearmRollDeg(
  tau: number,
  rollDeg: number,
  window: readonly [number, number],
): number {
  const w0 = window[0];
  const w1 = window[1];
  const span = w1 - w0;
  if (span <= 1e-9) return tau >= w1 ? rollDeg : 0;
  const u = Math.max(0, Math.min(1, (tau - w0) / span));
  return rollDeg * Math.pow(u, ROLL_EXPONENT);
}

/** The analytic `dθ/dt` of `forearmRollDeg`, deg/s. Used by the bake planner to pick a rung. */
export function forearmRollRateDegS(
  tau: number,
  rollDeg: number,
  window: readonly [number, number],
  durationS: number,
): number {
  const span = window[1] - window[0];
  if (span <= 1e-9 || durationS <= 1e-9) return 0;
  const u = Math.max(0, Math.min(1, (tau - window[0]) / span));
  if (u <= 0) return 0;
  return (rollDeg * ROLL_EXPONENT * Math.pow(u, ROLL_EXPONENT - 1)) / span / durationS;
}

/** The peak rate over the whole stroke — at `u = 1`, since the exponent is > 1. */
export function forearmRollPeakRateDegS(
  rollDeg: number,
  window: readonly [number, number],
  durationS: number,
): number {
  return forearmRollRateDegS(window[1], rollDeg, window, durationS);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The end-effector path.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The technique's end-effector position at `τ`, in TORSO-LOCAL FracH offsets from the acting GH.
 *
 * doc 03's `start`/`mid`/`end` are three authored keys; the path between them is `kimeEase` at the
 * technique's own `tauP`, quadratic-Bézier-style through `mid`. `mid` is a THROUGH point, not a
 * control point — doc 03 §13's mid rows are measured positions the fist passes through, so a
 * Bézier that only approaches them would put the elbow-lead arc in the wrong place.
 */
export function techniquePathLocal(
  spec: TechniqueSpec,
  tau: number,
  tauPeak: number,
  out: Float64Array,
): Float64Array {
  const a = kimeEase(tau, tauPeak);
  /* A QUADRATIC BÉZIER THAT PASSES THROUGH `mid`, not two straight legs joined at it.
   *
   * `mid` is a measured position the fist passes through (doc 03 §13), so it must be hit exactly
   * — but joining `start→mid` and `mid→end` with straight segments puts a CORNER there, and a
   * corner is a discontinuity in velocity. The bake sees it as curvature no rung can absorb:
   * G-9a's midpoint slerp error was 5.64° against a 0.25° budget, with per-frame steps already
   * comfortably inside G-9b. It is also wrong about the technique — an uke arcs, and the elbow
   * lead of doc 03 §8.1 IS that arc.
   *
   * The control point that makes `B(0.5) = mid` is `C = 2·mid − (start + end)/2`, from
   * `B(0.5) = (P0 + 2C + P2)/4`. One multiply-add more than the piecewise form, and C¹ everywhere. */
  const u = a;
  const w0 = (1 - u) * (1 - u);
  const w1 = 2 * (1 - u) * u;
  const w2 = u * u;
  out[0] = w0 * spec.start.dx.v + w1 * ctrl(spec.start.dx.v, spec.mid.dx.v, spec.end.dx.v) + w2 * spec.end.dx.v;
  out[1] = w0 * spec.start.dy.v + w1 * ctrl(spec.start.dy.v, spec.mid.dy.v, spec.end.dy.v) + w2 * spec.end.dy.v;
  out[2] = w0 * spec.start.dz.v + w1 * ctrl(spec.start.dz.v, spec.mid.dz.v, spec.end.dz.v) + w2 * spec.end.dz.v;
  return out;
}

/** The Bézier control point that makes the curve pass through `m` at `u = 0.5`. */
const ctrl = (p0: number, m: number, p2: number): number => 2 * m - (p0 + p2) / 2;

/**
 * The end-effector PATH LENGTH in metres — doc 04 §0's `L`, ~0.50 m for a chudan zuki.
 *
 * THIS, and not `L_M = 0.945 m`, is what `recoilFracL` and the accel channels scale by. That is
 * conflict C17, spelled out in `src/contracts/kata.ts`'s `recoilFracL` doc block: scaling by the
 * embusen step unit makes the gyaku-zuki recoil 15.1 mm instead of 8.0 mm and turns doc 04's hard
 * ceiling into 18.9 mm. There is no recoil metric in the 63, so nothing downstream would catch it.
 */
export function techniquePathLenM(spec: TechniqueSpec): number {
  const d1 = Math.hypot(
    spec.mid.dx.v - spec.start.dx.v,
    spec.mid.dy.v - spec.start.dy.v,
    spec.mid.dz.v - spec.start.dz.v,
  );
  const d2 = Math.hypot(
    spec.end.dx.v - spec.mid.dx.v,
    spec.end.dy.v - spec.mid.dy.v,
    spec.end.dz.v - spec.mid.dz.v,
  );
  return (d1 + d2) * H;
}

/**
 * Torso-local FracH offset -> WORLD metres, anchored at the acting GH.
 *
 * `−s·dx` is applied HERE and nowhere else in the arm solve. `s = sideSign(hand)`.
 */
export function localToWorld(
  local: Float64Array,
  hand: Handedness,
  ghWorld: Float64Array,
  chestQuat: Quaternion,
  out: Float64Array,
): Float64Array {
  const s = sideSign(hand);
  _v.set(-s * local[0]! * H, local[1]! * H, local[2]! * H).applyQuaternion(chestQuat);
  out[0] = ghWorld[0]! + _v.x;
  out[1] = ghWorld[1]! + _v.y;
  out[2] = ghWorld[2]! + _v.z;
  return out;
}

/**
 * doc 06 §6.2's pole defaults, chest-local, with the same `±` = same-side convention. `P = A + 0.5H·dir`.
 *
 * doc 06 §6.2 also says: "Interpolate the pole direction with the same easing curve as the
 * technique, never step-change it (a pole flip snaps the elbow 180°)." The caller interpolates;
 * this returns the endpoint for one technique.
 */
export function poleFor(
  spec: TechniqueSpec,
  hand: Handedness,
  ghWorld: Float64Array,
  chestQuat: Quaternion,
  out: Float64Array,
): Float64Array {
  return poleFromDir(spec.poleDirChest, hand, ghWorld, chestQuat, out);
}

/** `poleFor` for an already-interpolated direction. `P = A + 0.5H·dir`, doc 06 §6.2. */
export function poleFromDir(
  dir: readonly [number, number, number],
  hand: Handedness,
  ghWorld: Float64Array,
  chestQuat: Quaternion,
  out: Float64Array,
): Float64Array {
  const s = sideSign(hand);
  /* `dir[0]`'s sign is the same-side convention, so it takes the same `−s` the offsets do. */
  _v.set(-s * dir[0], dir[1], dir[2]).normalize().applyQuaternion(chestQuat);
  out[0] = ghWorld[0]! + 0.5 * H * _v.x;
  out[1] = ghWorld[1]! + 0.5 * H * _v.y;
  out[2] = ghWorld[2]! + 0.5 * H * _v.z;
  return out;
}

export interface ArmSolve {
  /** `|wristReached − target|`, metres. S4 gates at `< 0.005` at every arrival tick. */
  readonly residualM: number;
  /** The INCLUDED elbow angle the solve produced. S4 gates at ±5° of `elbowIncludedDeg`. */
  readonly elbowIncludedDeg: number;
  /** Applied forearm roll at this τ, degrees. */
  readonly rollDeg: number;
  /** `|F|` from the GH, FracH. S4 gates at `<= 0.381` (MCP2) / `<= 0.362` (fist centre). */
  readonly reachH: number;
}

/**
 * §4.11 S4. Solve one arm to its technique target at `τ`.
 *
 * Mutates `s`; the caller re-runs FK. Returns the measurements S4 asserts.
 */
/**
 * `rollTau` is the progress through **`T_thrust`**, not through the whole technique window, and
 * that distinction is what sizes the bake ladder.
 *
 * doc 04 §11 notes `elbowExtend`/`wristLock` are "measured inside `Tthrust`" — a different, much
 * shorter time base — and the forearm roll belongs to the same phase: it is the final pronation
 * that lands the fist, not something spread across the whole reach. For `oi-zuki-chudan-step`
 * (`T_tech` 0.52 s, `T_thrust` 0.14 s) the roll therefore spans `0.35 × 0.14 = 0.049 s` and peaks
 * at `180·2.2/0.35/0.14 = 8081 °/s`, which needs `8081/12 = 673 Hz` — the **960 rung**.
 *
 * Drive it on `T_tech` instead and the peak drops to 2176 °/s, 181 Hz, comfortably inside the 240
 * rung. The bake would still pass G-9a and G-9b — with the 960 rung never used, which is exactly
 * the vacuous pass `tests/contracts/bake-error.test.ts` step 3 exists to catch ("a track that
 * never reaches the 960 rung did not bake the roll").
 */
export function solveArm(
  s: Skel,
  hand: Handedness,
  spec: TechniqueSpec,
  tau: number,
  tauPeak: number,
  rollTau: number = tau,
): ArmSolve {
  techniquePathLocal(spec, tau, tauPeak, _local);
  return solveArmToLocal(s, hand, spec, _local, forearmRollDeg(rollTau, spec.rollDeg.v, spec.rollWindow));
}

const _local = new Float64Array(3);

/**
 * Wrist → the technique's own reference point, in FracH along the forearm axis.
 *
 * `TechniqueSpec.refPoint` names WHAT doc 03 §13's offsets locate, and it is not the wrist:
 * a zuki row is the MCP2 knuckle, a shuto row is the fingertip. The two-bone chain must therefore
 * be solved to that point, with `lenBC` extended to match — otherwise the target sits beyond the
 * chain's reach and `softenReach` silently absorbs the difference.
 *
 * The size of that error is not marginal. GH→wrist is `0.1618 + 0.1545 = 0.3163 H`, and the
 * chudan-zuki END is `hypot(0.130, 0.118, 0.337) = 0.379 H` from the GH — 0.063 H (11 cm) out of
 * reach. Measured, the solve returned an 11.2 cm residual and left both arms near bind, which is
 * exactly what the rendered figure showed.
 *
 * Distances come from doc 06 §4.2's own hand chain: `fingers_prox` (MCP) at 0.0495,
 * `fingers_dist` at 0.0795, `fingers_end` (dactylion) at 0.109.
 */
export const WRIST_TO_REF_H: Readonly<Record<TechniqueSpec['refPoint'], number>> = Object.freeze({
  WRIST: 0,
  /** The closed fist's centre — half way to the knuckle line. */
  FIST_CENTRE: 0.0248,
  /** doc 06 §4.2 `fingers_prox`: the index MCP, i.e. the seiken striking surface. */
  MCP2: 0.0495,
  HAND_CENTRE: 0.0495,
  /** doc 06 §4.2 `fingers_end` = dactylion. Shuto and nukite reach here. */
  FINGERTIP: 0.109,
});

/** `lenBC` for a technique: elbow → its reference point, metres. */
export function forearmToRefM(spec: TechniqueSpec): number {
  return ARM_LEN_M.lowerarmToHand + WRIST_TO_REF_H[spec.refPoint] * H;
}

/**
 * GH → reference point when the elbow sits at the technique's own `elbowIncludedDeg`, metres.
 *
 * The law of cosines on the two segments: `sqrt(a² + b² − 2ab·cos θ)`. For a chudan zuki
 * (a = 0.1618 H, b = 0.204 H, θ = 172°) that is 0.3649 H against 0.3658 H straight — 1.6 mm short
 * of lockout, which is the whole margin the solve needs to stay well-conditioned.
 */
export function chainLenAtElbowM(spec: TechniqueSpec): number {
  const a = ARM_LEN_M.upperarmToLowerarm;
  const b = forearmToRefM(spec);
  const theta = Math.min(180, Math.max(1, spec.elbowIncludedDeg.v)) / RAD;
  return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(theta));
}

/**
 * Solve one arm to an ALREADY-RESOLVED torso-local offset.
 *
 * Split out from `solveArm` because the arm's path across a whole kata is not one technique
 * curve. doc 02 §1.4 decomposes a count as `t_hold + t_prep + t_transit + t_kime`, and `t_hold`
 * is "**previous kime sustained**" — so through the hold the arm stays where the LAST move left
 * it, chambers during `t_prep`, and only then runs the technique.
 *
 * Driving the arm straight off `techniquePathLocal(τ)` with `τ = 0` through the hold instead
 * parks it at `spec.start` — the chamber, e.g. at the opposite earlobe for gedan-barai — which
 * means at every slot boundary the arm teleports from full extension back to the chamber in one
 * tick. That is an ~80° discontinuity, it is invisible in any still, and it is exactly what G-9a
 * catches: the midpoint slerp error explodes because there is no smooth path between the frames.
 */
export function solveArmToLocal(
  s: Skel,
  hand: Handedness,
  spec: TechniqueSpec,
  local: Float64Array,
  rollDeg: number,
  /**
   * Chest-local pole DIRECTION, already interpolated. Defaults to `spec.poleDirChest`.
   *
   * doc 06 §6.2 is explicit: "Interpolate the pole direction with the same easing curve as the
   * technique, **never step-change it (a pole flip snaps the elbow 180°)**." The step change is
   * not hypothetical — an arm that is the hikite in move N and the working arm in move N+1 has
   * two different poles for the same wrist position, so at the slot boundary the elbow swings
   * while the fist stays put. Measured: 36° on `lowerarm_L` in 1 ms at the move 8→9 seam.
   */
  poleDirChest?: readonly [number, number, number],
): ArmSolve {
  const b = sideBones(hand);
  preposeArm(s, hand);
  /**
   * THE CHEST QUATERNION GETS ITS OWN SCRATCH, and that is not a style preference.
   *
   * It was sharing `_q2` with `protractClavicle`, which runs between the two uses and overwrites
   * it — so `poleFromDir` built the pole in the CLAVICLE's frame instead of the chest's. The pole
   * defines the bend plane, so the plane jumped between ticks and the whole arm chain flipped with
   * it. That is the 23° `lowerarm_R` step, and it survived every other explanation precisely
   * because it had nothing to do with reach, protraction or the bake.
   */
  getWorldQuat(s, BI.chest, _chestQ);

  _gh[0] = s.worldPos[b.upperarm * 3]!;
  _gh[1] = s.worldPos[b.upperarm * 3 + 1]!;
  _gh[2] = s.worldPos[b.upperarm * 3 + 2]!;

  localToWorld(local, hand, _gh, _chestQ, _target);

  /* ── Scapular protraction, BEFORE the IK. doc 06 §5.4 Fix 3's real purpose. ─────────────────
   *
   * doc 03 §13's END sits `0.379 H` from a FIXED GH while the anatomical chain reaches
   * `0.1618 + 0.1545 + 0.0495 = 0.3658 H` — and §13 also asks for `elbowIncludedDeg = 172`, i.e.
   * an elbow that is NOT locked straight. Both are only satisfiable if the shoulder itself travels
   * forward, which is what it does: the scapula protracts at kime. Rotating the clavicle toward
   * the target swings the GH up to `|clavicle| = 0.0983 H` forward, which covers the 0.013 H
   * shortfall at about 8° of protraction — well inside `ROM.clavicle`.
   *
   * Doing it AFTER the IK instead would move the GH out from under a solved arm and re-open the
   * residual it was meant to close. */
  /* Protract to the STRAIGHT-ARM length, not to `chainLenAtElbowM(spec)`.
   *
   * Targeting the bent-elbow length was tried and is worse, measurably: it protracts further, which
   * pulls the target inside the reach, and the two-swing construction of doc 06 §6.1 step 5 then
   * has room to resolve the elbow to the OTHER side of the pole plane. `maxStepDeg` went 23° → 162°
   * — a full flip — which is the failure doc 06 §6.2 describes for a pole step-change, arriving
   * here by a different route. `chainLenAtElbowM` is kept because S4 needs it to check the elbow
   * angle, but it must not drive the shoulder. */
  protractClavicle(s, hand, _target);
  forwardKinematics(s);
  _gh[0] = s.worldPos[b.upperarm * 3]!;
  _gh[1] = s.worldPos[b.upperarm * 3 + 1]!;
  _gh[2] = s.worldPos[b.upperarm * 3 + 2]!;

  poleFromDir(poleDirChest ?? spec.poleDirChest, hand, _gh, _chestQ, _pole);

  const args: TwoBoneArgs = {
    aWorld: _gh,
    lenAB: ARM_LEN_M.upperarmToLowerarm,
    /* To the technique's OWN reference point, not to the wrist. See `WRIST_TO_REF_H`. */
    lenBC: forearmToRefM(spec),
    targetWorld: _target,
    poleWorld: _pole,
    /* The arm DOES soften: unlike a planted foot, a striking limb is exactly the case doc 06
     * §6.1 introduced `soften` for — the visible pop as it locks out at kime. */
    soften: SOFTEN_DEFAULT,
    /* doc 06 §3.1: elbow +3/−152, "hyperextension hard-locked". Folded into IK step 2 (§6.1). */
    midMinDeg: 0,
    midMaxDeg: 152,
  };
  const residualM = solveTwoBonePositions(args, _elbow, _wrist);

  /**
   * ═══ THE BEND PLANE FIXES THE TWIST. THIS IS doc 06 §6.1 STEP 6, AND IT IS NOT OPTIONAL HERE.
   *
   * doc 06 §6.1 step 5 builds the bones with `quatFromUnitVectors`, whose whole virtue is that it
   * "preserves whatever twist the animation already had". That assumes there IS an incoming pose
   * with sensible twist — step 5 is written for a delta applied to an ANIMATED frame.
   *
   * We solve from BIND on every tick (`resetToBind`, so the pose stays a pure function of the
   * tick — §6.1). There is no incoming twist to preserve, so `quatFromUnitVectors` hands back its
   * MINIMAL-ARC twist, which is an arbitrary function of the two directions and changes
   * non-smoothly as the target moves. The elbow position is unaffected — it is fixed by the pole
   * plane — but the upper arm's roll is not, and the lowerarm's LOCAL quaternion absorbs the
   * difference. Measured: a 23.5° step on `lowerarm_R` in 1 ms, at the 960 rung, with the arm's
   * endpoint residual already at zero. Turning protraction off entirely changed it by 0.4°, which
   * is what ruled every other candidate out.
   *
   * So both bones are built from an EXPLICIT frame instead: the bone's own axis toward its solved
   * direction, and its reference perpendicular onto the bend-plane normal. The plane is a smooth
   * function of the target and the pole, so the twist is too — and step 6's "optional axial twist"
   * becomes the thing that makes the whole chain well-conditioned.
   */
  /**
   * ═══ doc 06 §6.1 STEP 5, AS WRITTEN. THREE ALTERNATIVES WERE TRIED AND ALL ARE WORSE. ══════
   *
   * The free twist `quatFromUnitVectors` leaves is real (see the note below), and the obvious
   * remedies all backfire. Measured worst per-frame step, same track, same everything else:
   *
   *     delta form, doc 06 §6.1 step 5 as written ......  23.5°   <- shipped
   *     fully-pinned frame, ref = bend-plane normal .... 179.9°
   *     minimal-arc swing, no reference ................  55.9°
   *     fully-pinned frame, ref = pole direction ....... 180.0°
   *
   * Both pinned frames fail for the same reason the free form does, only harder: the reference
   * vector they roll onto has its OWN sign flip, so pinning the twist to it just moves the
   * discontinuity rather than removing it. The delta form at least starts from the current pose,
   * which is continuous.
   *
   * The residual 23.5° step is on `lowerarm`, at the configuration where the upper arm's local
   * rotation approaches 180° — the right arm's rest axis is world +X and at heading 90 the body
   * faces −X, so a right-arm technique there is very nearly antiparallel to rest. The real fix is
   * a rest pose whose arm axis is not antiparallel to any technique direction (an A-pose rather
   * than a T-pose), which is a B4 change to `REST_OFFSET_H` and therefore a contract re-freeze.
   * Recorded as a handoff rather than worked around here.
   */
  const curElbow = new Float64Array([
    s.worldPos[b.lowerarm * 3]!, s.worldPos[b.lowerarm * 3 + 1]!, s.worldPos[b.lowerarm * 3 + 2]!,
  ]);
  const curWrist = new Float64Array([
    s.worldPos[b.hand * 3]!, s.worldPos[b.hand * 3 + 1]!, s.worldPos[b.hand * 3 + 2]!,
  ]);
  solveTwoBone(args, _out, curElbow, curWrist);
  applyWorldDelta(s, b.upperarm, _out.qA);
  forwardKinematics(s);
  applyWorldDelta(s, b.lowerarm, _out.qB);
  forwardKinematics(s);

  /* The roll, about the forearm's CONVERTED primary axis, on the THRUST time base. */
  applyForearmRoll(s, hand, rollDeg);
  forwardKinematics(s);

  return {
    residualM,
    elbowIncludedDeg: includedAngleDeg(_gh, _elbow, _wrist),
    rollDeg,
    reachH: Math.hypot(_wrist[0]! - _gh[0]!, _wrist[1]! - _gh[1]!, _wrist[2]! - _gh[2]!) / H,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE BEND-PLANE FRAME. doc 06 §6.1 step 6, made mandatory — see the note in `solveArmToLocal`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const _u = new Vector3();
const _dir = new Vector3();
const _qf = new Quaternion();
const _qp = new Quaternion();

/**
 * Swing both arm bones DOWN into a neutral hanging pose before the technique IK runs.
 *
 * ═══ THIS IS AN A-POSE, IMPLEMENTED IN THE SOLVER RATHER THAN THE CONTRACT ══════════════════
 * The bind pose is a T-POSE: `REST_OFFSET_H` puts the arm chain along ±X, so the right arm's rest
 * direction is world `+X`. At heading 90 the body faces world `−X`, which makes a right-arm
 * technique **exactly antiparallel to rest** — and an antiparallel swing is the one input
 * `quatFromUnitVectors` cannot resolve, because every perpendicular is an equally valid 180° axis.
 * Measured: the upper arm's local rotation hits 180.0° and Heian's worst baked step reaches 174°.
 *
 * The textbook fix is an A-pose rest, but `REST_OFFSET_H` is frozen in `src/contracts/bones.ts`
 * and changing it is one of the four changes OWNERSHIP says "stops every agent" — it is the
 * skinIndex order's sibling, and B4's mesh, weights and `tests/rig/**` are all built on it.
 *
 * Pre-posing achieves the same thing without touching it. The IK's step 5 measures its deltas
 * from the CURRENT pose, so if the arm already hangs down, the delta to any technique target is a
 * modest swing instead of a near-180° flip. The bind pose is unchanged, the skinning is unchanged,
 * and the degenerate input simply never arises.
 *
 * Down-and-slightly-forward, which is where a karateka's arms rest at yoi anyway (doc 02 §2's
 * fists at 0.55 H, 0.10 H forward of the hip coronal plane).
 */
export function preposeArm(s: Skel, hand: Handedness): void {
  const b = sideBones(hand);
  const gh = [
    s.worldPos[b.upperarm * 3]!,
    s.worldPos[b.upperarm * 3 + 1]!,
    s.worldPos[b.upperarm * 3 + 2]!,
  ];
  getWorldQuat(s, BI.chest, _q2);
  /* Chest-local down-and-forward, so the neutral follows the torso rather than the world. */
  _v.set(0, -1, -0.25).normalize().applyQuaternion(_q2);

  _neutralA[0] = gh[0]! + ARM_LEN_M.upperarmToLowerarm * _v.x;
  _neutralA[1] = gh[1]! + ARM_LEN_M.upperarmToLowerarm * _v.y;
  _neutralA[2] = gh[2]! + ARM_LEN_M.upperarmToLowerarm * _v.z;
  _neutralGh[0] = gh[0]!;
  _neutralGh[1] = gh[1]!;
  _neutralGh[2] = gh[2]!;
  applyChainSwing(s, b.upperarm, _neutralGh, _neutralA);
  forwardKinematics(s);

  _neutralB[0] = _neutralA[0]! + ARM_LEN_M.lowerarmToHand * _v.x;
  _neutralB[1] = _neutralA[1]! + ARM_LEN_M.lowerarmToHand * _v.y;
  _neutralB[2] = _neutralA[2]! + ARM_LEN_M.lowerarmToHand * _v.z;
  applyChainSwing(s, b.lowerarm, _neutralA, _neutralB);
  forwardKinematics(s);
}

const _neutralGh = new Float64Array(3);
const _neutralA = new Float64Array(3);
const _neutralB = new Float64Array(3);

/**
 * Point one bone's primary axis from `from` to `to`, by the MINIMAL arc, and write its local.
 *
 * ═══ WHY NOT A FULLY-PINNED FRAME ══════════════════════════════════════════════════════════
 * The obvious "fix" for `quatFromUnitVectors`'s free twist is to pin the second degree of freedom
 * too — swing the axis onto the direction, then roll until the bone's reference perpendicular
 * lands on the bend-plane normal. That was tried and is decisively worse.
 *
 * Forcing the perpendicular onto the NORMAL rolls the bone 90° away from where the anatomy wants
 * it, and combined with the rest axis it drives the upper arm's local rotation all the way to
 * **exactly 180.0°** — the antipodal point, measured at tick 83332. Every half-angle downstream
 * then flips: `deltoidHelper` went from a 23° worst step to 179.87°. Pinning the twist to the
 * wrong reference is worse than leaving it free.
 *
 * The minimal arc keeps the bone's rotation as small as it can be, which is what keeps it away
 * from 180° in the first place. The residual twist variation it does leave is real and is what
 * `lowerarm_R`'s remaining step is; the right place to constrain it is the bone's own ROM twist
 * range in S12, not a frame invented here.
 */
export function applyChainSwing(
  s: Skel,
  bone: number,
  from: Float64Array,
  to: Float64Array,
  /**
   * The in-plane direction the bone's UNDERSIDE should face — i.e. where the elbow points.
   *
   * Supplying it removes the free twist AND the antipodal degeneracy at once. Without it the
   * bone's orientation is `quatFromUnitVectors(restAxis, dir)`, the minimal arc, and for an arm
   * that is a 180° flip about an ARBITRARY perpendicular whenever the target is antiparallel to
   * the rest axis. That is not a rare corner: the right arm's rest axis is world +X, and at
   * heading 90 the body faces −X, so **every right-arm punch at that heading is exactly
   * antiparallel**. Measured, the upper arm's local rotation hit 180.0° and everything derived
   * from it — the deltoid's half-angle, the forearm's local — flipped with it.
   *
   * With the reference supplied, both degrees of freedom are pinned by smooth inputs (the target
   * and the pole), so the orientation is a smooth function of them and 180° is just another angle.
   */
  refWorld?: Float64Array,
): void {
  _dir.set(to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!);
  if (_dir.lengthSq() < 1e-18) return;
  _dir.normalize();

  const axis = BONE_DEFS[bone]!.axisWorld;
  _u.set(axis[0], axis[1], axis[2]).normalize();
  quatFromUnitVectors(_u, _dir, _qf);

  if (refWorld !== undefined) {
    /* The bone's own underside at rest: local −Y, orthogonalised against its axis. Every rest
     * local is identity (doc 06 §0), so the bone's rest frame IS this pair. */
    _vp.set(0, -1, 0);
    _vp.addScaledVector(_u, -_vp.dot(_u));
    if (_vp.lengthSq() > 1e-12) {
      _vp.normalize().applyQuaternion(_qf);
      /* Where it should end up: the pole direction, flattened into the plane ⊥ to the bone. */
      _perp.set(refWorld[0]!, refWorld[1]!, refWorld[2]!);
      _perp.addScaledVector(_dir, -_perp.dot(_dir));
      if (_perp.lengthSq() > 1e-12) {
        _perp.normalize();
        const roll = Math.atan2(_vp.clone().cross(_perp).dot(_dir), _vp.dot(_perp));
        _qp.setFromAxisAngle(_dir, roll);
        _qf.premultiply(_qp);
      }
    }
  }

  const p = BONE_DEFS[bone]!.parent;
  if (p >= 0) {
    _qp.set(
      s.worldQuat[p * 4]!, s.worldQuat[p * 4 + 1]!, s.worldQuat[p * 4 + 2]!, s.worldQuat[p * 4 + 3]!,
    ).invert();
    _qf.premultiply(_qp);
  }
  setLocal(s, bone, _qf);
}

/**
 * The in-plane unit direction toward the pole — the direction the elbow bends.
 *
 * This is `_v` from doc 06 §6.1 step 3, the same vector `solveTwoBonePositions` places the elbow
 * along, so the orientation and the position agree by construction.
 */
export function poleInPlaneDir(
  a: Float64Array,
  target: Float64Array,
  pole: Float64Array,
  outV: Float64Array,
): void {
  _u.set(target[0]! - a[0]!, target[1]! - a[1]!, target[2]! - a[2]!);
  if (_u.lengthSq() < 1e-18) _u.set(0, 0, -1);
  _u.normalize();
  _vp.set(pole[0]! - a[0]!, pole[1]! - a[1]!, pole[2]! - a[2]!);
  _vp.addScaledVector(_u, -_vp.dot(_u));
  if (_vp.lengthSq() < 1e-12) {
    /* Deterministic fallback, derived from `_u` alone so it cannot depend on evaluation order. */
    _vp.set(0, -1, 0);
    if (Math.abs(_u.y) > 0.9) _vp.set(0, 0, 1);
    _vp.addScaledVector(_u, -_vp.dot(_u));
  }
  _vp.normalize();
  outV[0] = _vp.x;
  outV[1] = _vp.y;
  outV[2] = _vp.z;
}

/**
 * doc 06 §5.4 Fix 3 — scapular protraction toward a reach target.
 *
 * Rotates the clavicle so the GH travels toward `targetWorld`, by exactly the shortfall between
 * the target's distance and the chain's straight-arm reach, and no more. Clamped to `ROM.clavicle`.
 *
 * Only acts when the arm is genuinely extended: a chambered hikite is nowhere near its reach
 * limit, and protracting for it would shrug the shoulder through the whole hold — which is the
 * permanent-shrug artefact doc 06 §5.4 is written against.
 */
export function protractClavicle(
  s: Skel,
  hand: Handedness,
  targetWorld: Float64Array,
  /**
   * The chain length the shoulder should protract TO — normally the technique's own
   * `elbowIncludedDeg`, not the fully-straight arm.
   *
   * This is what keeps the solve off the lockout singularity. At full extension `d(elbowAngle) /
   * d(reach) → ∞`, so a target that demands a straight arm makes the elbow angle explode for a
   * micrometre of reach change — measured as a **23.5° step on `lowerarm_R` in 1 ms**, at the 960
   * rung, which no bake ladder can absorb. `soften` blunts it but cannot remove it when the target
   * sits AT the limit by construction.
   *
   * doc 03 §13 never asks for a straight arm: `elbowIncludedDeg` is 172° for a zuki. Protracting
   * until the remaining reach needs exactly that angle satisfies the doc AND leaves the chain in
   * its well-conditioned interior.
   */
  chainLenM?: number,
): number {
  const b = sideBones(hand);
  const clavicleLenM = Math.hypot(
    s.worldPos[b.upperarm * 3]! - s.worldPos[b.clavicle * 3]!,
    s.worldPos[b.upperarm * 3 + 1]! - s.worldPos[b.clavicle * 3 + 1]!,
    s.worldPos[b.upperarm * 3 + 2]! - s.worldPos[b.clavicle * 3 + 2]!,
  );
  if (clavicleLenM < 1e-6) return 0;

  const reachM = chainLenM ?? ARM_LEN_M.upperarmToLowerarm + ARM_LEN_M.lowerarmToHand;
  const distM = Math.hypot(
    targetWorld[0]! - s.worldPos[b.upperarm * 3]!,
    targetWorld[1]! - s.worldPos[b.upperarm * 3 + 1]!,
    targetWorld[2]! - s.worldPos[b.upperarm * 3 + 2]!,
  );
  const shortfallM = distM - reachM;
  if (shortfallM <= 0) return 0;

  /* The GH moves on an arc of radius `clavicleLenM`; `sin θ` of that arc is the forward travel. */
  /**
   * Protract only to `PROTRACTION_REACH_FRAC` of the shortfall, never all of it.
   *
   * Closing the gap completely puts the chain AT full extension, which is the two-bone solve's
   * singularity: `d(elbowAngle)/d(reach) → ∞` there, so the last millimetre of reach costs tens of
   * degrees of elbow swing and the baker sees a 23° step in 1 ms. Leaving a deliberate sliver
   * unreached keeps the solve in its well-conditioned interior; `soften` then absorbs the sliver
   * smoothly, which is the job doc 06 §6.1 introduced it for.
   *
   * The cost is a residual of a few millimetres at kime, which is REPORTED (`ikResidualM`) rather
   * than hidden — doc 06 §6.4's own rule for a clamp that cannot fully close.
   */
  const sinT = Math.min(1, (shortfallM * PROTRACTION_REACH_FRAC) / clavicleLenM);
  const rom = ROM[hand === 'L' ? 'clavicle_L' : 'clavicle_R'];
  const maxDeg = Math.min(PROTRACTION_MAX_DEG, Math.max(rom.swingConeXDeg, rom.swingConeZDeg));
  const deg = Math.min(Math.asin(sinT) * RAD, maxDeg);

  /**
   * About the clavicle's OWN local +Y, with the sign from `sideSign`. NOT about an axis built
   * from `cross(currentDir, targetDir)`.
   *
   * The cross-product form looks more general and is a trap: as the arm approaches the reach
   * line the two vectors become parallel, the cross product collapses toward zero, and the
   * normalised axis flips to whatever the rounding decides. That is a discontinuity precisely
   * where protraction is largest — measured as `maxStepDeg` jumping 11.3° → 23.2° and G-9a
   * doubling the moment this function was introduced.
   *
   * A fixed axis cannot flip, and it is also the better anatomy: protraction is the scapula
   * sliding FORWARD around the ribcage, i.e. a rotation in the transverse plane, not a free swing
   * toward an arbitrary point. `R_y(φ)` carries a left clavicle (world −X) toward −Z for φ < 0 and
   * a right one (+X) toward −Z for φ > 0 — which is exactly `sideSign`.
   */
  _q2.setFromAxisAngle(_up, sideSign(hand) * deg * DEG);
  getLocal(s, b.clavicle, _q);
  _q.multiply(_q2);
  setLocal(s, b.clavicle, _q);
  return deg;
}

/**
 * A cap on scapular protraction, degrees. doc 06 §5.4's concern is the opposite failure — a
 * permanently shrugged shoulder — so the travel that closes doc 03 §13's 0.013 H shortfall is
 * allowed and nothing beyond it. 8° covers the shortfall with margin; `ROM.clavicle` is wider and
 * would let a mis-scaled target drag the whole shoulder girdle round.
 */
export const PROTRACTION_MAX_DEG = 8;

/** How much of the reach shortfall protraction closes. See `protractClavicle`'s note. */
export const PROTRACTION_REACH_FRAC = 0.75;

const _up = new Vector3(0, 1, 0);

/**
 * Distribute the roll across the two forearm twist bones, doc 06 §5.4 Fix 1.
 *
 * `lowerarm_twist_01` sits 33 % along and carries 0.33×; `lowerarm_twist_02` sits 67 % along and
 * carries 0.67×. The `hand` bone carries the remainder, so the total is the authored roll — S10's
 * exit invariant is "twist sums to the source roll to 1e-6", which this satisfies by
 * construction rather than by tuning.
 */
export function applyForearmRoll(s: Skel, hand: Handedness, rollDeg: number): void {
  const names = hand === 'L'
    ? (['lowerarm_twist_01_L', 'lowerarm_twist_02_L'] as const)
    : (['lowerarm_twist_01_R', 'lowerarm_twist_02_R'] as const);
  const shares = [0.33, 0.67 - 0.33];
  const b = sideBones(hand);

  let applied = 0;
  for (let i = 0; i < names.length; i++) {
    const idx = twistIndex(names[i]!);
    const part = rollDeg * shares[i]!;
    axisRoll(s, idx, part);
    applied += part;
  }
  /* The hand takes the residual so the SUM is exact. */
  axisRoll(s, b.hand, rollDeg - applied);
}

/** Post-multiply a rotation about the bone's own CONVERTED primary axis. */
function axisRoll(s: Skel, bone: number, deg: number): void {
  if (Math.abs(deg) < 1e-12) return;
  getLocal(s, bone, _q);
  const a = ARM_AXIS[bone] ?? [1, 0, 0];
  _q2.setFromAxisAngle(_v.set(a[0]!, a[1]!, a[2]!).normalize(), deg * DEG);
  _q.multiply(_q2);
  setLocal(s, bone, _q);
}

/* Converted primary axes, resolved once. `BONE_DEFS[i].axisWorld` already went through `toWorld`. */
const ARM_AXIS: Readonly<Record<number, readonly [number, number, number]>> = Object.freeze(
  Object.fromEntries(BONE_DEFS.map((d) => [d.index as number, d.axisWorld])),
);

const twistIndex = (n: string): number => boneIndex(n as Parameters<typeof boneIndex>[0]);

/**
 * §4.11 S4. The hikite — doc 03 §3's "the hikite is the DRIVER, not an afterthought".
 *
 * doc 02 §1.3 names two forms and B1 ships them as `TechniqueSpec`s, so the hikite solves through
 * exactly the same path as a technique. Its peak angular velocity leads the striking fist's by
 * 20–35 ms, which is `CHANNEL_DYN.hikite.leadMs − CHANNEL_DYN.shoulderGirdle.leadMs`; the caller
 * supplies the led `τ`.
 */
export function solveHikite(
  s: Skel,
  hand: Handedness,
  form: 'HIP-A' | 'TATE-B' | 'NONE',
  tau: number,
  tauPeak: number,
): ArmSolve | null {
  if (form === 'NONE') return null;
  const spec = form === 'HIP-A' ? HIKITE_HIP_A : HIKITE_TATE_B;
  return solveArm(s, hand, spec, tau, tauPeak);
}

/**
 * doc 06 §5.4 Fix 3 — scapulohumeral rhythm. The clavicle takes a share of the humerus elevation
 * so the shoulder does not collapse at full reach.
 *
 * The classic 2:1 rhythm: for every 3° of arm elevation, 2° is glenohumeral and 1° scapular. Above
 * 30° of elevation only; below that the scapula is quiet, and driving it anyway produces the
 * permanent shrug doc 06 §5.4 is written against.
 */
export const SCAPULAR_RHYTHM_RATIO = 1 / 3;
export const SCAPULAR_ONSET_DEG = 30;

export function clavicleRhythm(s: Skel, hand: Handedness): number {
  const b = sideBones(hand);
  /* Humerus elevation: the angle between the upperarm's world direction and straight down. */
  _v.set(
    s.worldPos[b.lowerarm * 3]! - s.worldPos[b.upperarm * 3]!,
    s.worldPos[b.lowerarm * 3 + 1]! - s.worldPos[b.upperarm * 3 + 1]!,
    s.worldPos[b.lowerarm * 3 + 2]! - s.worldPos[b.upperarm * 3 + 2]!,
  );
  if (_v.lengthSq() < 1e-12) return 0;
  _v.normalize();
  const elevationDeg = Math.acos(Math.max(-1, Math.min(1, -_v.y))) * RAD;
  const over = elevationDeg - SCAPULAR_ONSET_DEG;
  if (over <= 0) return 0;

  const scapDeg = over * SCAPULAR_RHYTHM_RATIO;
  const clavRom = ROM[hand === 'L' ? 'clavicle_L' : 'clavicle_R'];
  const capped = Math.min(scapDeg, Math.max(clavRom.swingConeXDeg, clavRom.swingConeZDeg));

  /* Elevate the clavicle about the chest's forward axis, toward the same side. */
  getLocal(s, b.clavicle, _q);
  _q2.setFromAxisAngle(_v.set(0, 0, sideSign(hand)), capped * DEG);
  _q.multiply(_q2);
  setLocal(s, b.clavicle, _q);
  return capped;
}

/**
 * doc 06 §5.4 Fix 2 — the deltoid helper: a half-slerp between clavicle and upperarm, which is
 * what stops the shoulder-cap collapse the skinning cannot fix on its own. S10 checks it stays
 * inside `ROM`.
 */
export function deltoidHelper(s: Skel, hand: Handedness): void {
  const deltoid = twistIndex(hand === 'L' ? 'deltoid_L' : 'deltoid_R');

  /**
   * ═══ DEFERRED TO PHASE 4, DELIBERATELY. THE HELPER IS OFF AND THE BONE STAYS AT REST. ══════
   *
   * doc 06 §5.4 Fix 2's half-slerp — `slerp(identity, upperarm_local, 0.5)` — is DISCONTINUOUS,
   * and not marginally. A half-rotation flips its axis when the source crosses 180°, and the
   * upper arm's local rotation reaches exactly **180.0°** at tick 83332 (measured). The helper
   * then produced a **179.87°** step, the largest single discontinuity in the track. Clamping the
   * ANGLE was tried and does not help: it bounds the magnitude at 60° but the axis still flips,
   * giving a 120° step instead. There is no stable half-angle of a rotation that reaches π.
   *
   * What it costs to switch off: the deltoid is a SKINNING helper. It exists so the shoulder cap
   * does not collapse under the skin weights, and B4's `tests/rig/candywrapper` already covers
   * that geometry at bind. Nothing in Phase 2's gates measures it, and nothing visible in the
   * render depends on it.
   *
   * What the real fix needs: a formulation that cannot reach π — driving it from the SWING
   * component alone (bounded by `ROM`'s cone, via `splitSwingTwist`) rather than from the full
   * local rotation. That belongs with the rest of the §5.4 skinning work in Phase 4, alongside
   * the candy-wrapper and shoulder-collapse tuning it is part of.
   */
  setLocal(s, deltoid, IDENTITY_Q);
}

const IDENTITY_Q = new Quaternion();

/** Resolve a `TechniqueRef` to B1's spec. Throws rather than returning undefined at a boundary. */
export function specFor(id: string, level: 'jodan' | 'chudan' | 'gedan'): TechniqueSpec {
  const key = techniqueKey(id, level);
  const spec = TECHNIQUES[key];
  if (spec === undefined) throw new Error(`solveArm: no TECHNIQUES entry for '${key}'`);
  return spec;
}

/** The hand shape a technique asks for — `hand.ts` turns it into finger angles. */
export const handShapeOf = (spec: TechniqueSpec): HandShape => spec.hand;
