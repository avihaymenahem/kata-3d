/**
 * B3 SOLVER — `src/solve/stance.ts`
 *
 * `solveStance` — the leg solve. doc 01 §3–§7, §10; ARCHITECTURE.md §4.11 S3.
 *
 * ═══ `pelvisY` IS AN INPUT, NEVER AN OUTPUT. THAT IS THE WHOLE DESIGN. ══════════════════════
 * §3.8: "`pelvisY` is an INPUT to the leg solve, never an output." S3's exit invariant is
 * `pelvisY equals its input to 1e-9`, and the reason it is stated that strongly is doc 01 §9.5's
 * pelvis-bob fault: a solver that places the feet and then lets the hips fall out of the leg
 * geometry produces a 2–4 cm vertical oscillation per step, which is the single most legible
 * "this is not a karateka" tell in the whole project. Making the hip height a HARD CONSTRAINT and
 * the knee flexion the DEPENDENT variable makes that bob structurally impossible rather than
 * merely tuned away.
 *
 * The arithmetic closes on doc 01 §10 without any fitting. With `pelvisY = 0.410 H`, an AJC at
 * the bind height `0.039 H`, and doc 01 §10's own `hipZbehindFrontAnkle = 0.221 H`:
 *
 *     r = hypot(0.410 − 0.039, 0.221) = 0.4318 H
 *     cos B = (0.2425² + 0.2493² − 0.4318²) / (2·0.2425·0.2493) = −0.5417
 *     flexion = 180° − acos(−0.5417) = **57.2°**      doc 01 §10 `kneeFront: 57`  ✓
 *
 * and `0.221 + 0.319 = 0.540 = ZENKUTSU.S` exactly, so the hip splits the two ankles at precisely
 * the authored ratio. `tests/solve/stances.test.ts` reproduces both from the solve.
 *
 * ═══ THE AJC IS THE FOOT DATUM, NOT THE GENERATOR'S `ff`/`rf` ═══════════════════════════════
 * `src/data/embusen.ts`'s header raises this as a handoff to B3, and it is load-bearing for
 * kokutsu: doc 02 §1.1 fixes the embusen GENERATOR step at `Lk = 1.00 L` (which is what makes
 * `c(21)` come out right), while `KOKUTSU.S = 0.446 H` is the ANKLE-TO-ANKLE stance length. The
 * two differ by 0.094 H. `c` — the midpoint — is the canonical embusen point and is what metric
 * 42 measures, so the feet are planted at `c ± AJC_HALF_SEP_L·f(H)` and `ff`/`rf` are generator
 * scaffolding. For zenkutsu the two agree exactly; for kokutsu, planting at `ff`/`rf` would make
 * every kokutsu stance 9 cm too long and put `kneeRear` 12° off doc 01 §10.
 */

import { Quaternion, Vector3 } from 'three';

import type { Handedness, StanceId, StanceSpec } from '../contracts';
import { DEG, H, RAD } from '../contracts';
/** `FootPlan` is declared in B1's barrel (§3.4.1), not in the contracts. */
import type { FootPlan } from '../data';
import {
  AJC_HALF_SEP_L,
  L_M,
  PELVIS_AHEAD_OF_C_H,
  STANCES,
} from '../data';
import {
  embusenToWorldM,
  toWorldPsiDeg,
  toWorldYawDeg,
  worldCharLeft,
  worldFacing,
} from './frame';
import {
  ARM_LEN_M,
  BI,
  LEG_LEN_M,
  type Skel,
  applyWorldDelta,
  forwardKinematics,
  setLocal,
  sideBones,
} from './skeleton';
import {
  type TwoBoneArgs,

  includedAngleDeg,
  newTwoBoneOut,
  solveTwoBone,
  solveTwoBonePositions,
} from './twoBoneIK';

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();

const _hip = new Float64Array(3);
const _ankle = new Float64Array(3);
const _pole = new Float64Array(3);
const _knee = new Float64Array(3);
const _end = new Float64Array(3);
const _out = newTwoBoneOut();

/** Bind-pose ankle-joint-centre height above the floor, FracH. Feet flat. */
export const AJC_HEIGHT_H: number =
  0.5308 - LEG_LEN_M.thighToCalf / H - LEG_LEN_M.calfToFoot / H;
export const AJC_HEIGHT_M: number = AJC_HEIGHT_H * H;

export interface LegSolve {
  readonly side: Handedness;
  /** Knee FLEXION in degrees, 0 = straight. The DEPENDENT variable. */
  readonly kneeFlexDeg: number;
  /** Knee world position, metres. */
  readonly kneeWorld: readonly [number, number, number];
  /** Residual `|ankleReached − ankleTarget|`, metres. S3 gates at 1e-6. */
  readonly ankleResidualM: number;
}

export interface StanceSolve {
  /** MIDHIP world position, metres. `y` is `spec.pelvisY.v * H`, EXACTLY. */
  readonly pelvisWorld: readonly [number, number, number];
  /** World yaw applied to the root, degrees. */
  readonly rootYawDeg: number;
  readonly legs: Readonly<Record<Handedness, LegSolve>>;
  /** `hipZ` behind the front ankle along the facing, FracH. doc 01 §10. */
  readonly hipBehindFrontAnkleH: number;
  /** `hipZ` ahead of the rear ankle along the facing, FracH. */
  readonly hipAheadOfRearAnkleH: number;
  /** Front-knee lateral offset vs the front ankle, FracH. doc 01 §10: +0.005, never medial. */
  readonly kneeFrontLateralH: number;
}

/** Both AJCs in WORLD metres for a foot plan. `c ± AJC_HALF_SEP_L·f(H)`. See the header. */
export function ankleTargetsM(
  plan: FootPlan,
  stance: StanceId,
): Readonly<Record<Handedness, readonly [number, number, number]>> {
  const half = AJC_HALF_SEP_L[stance] * L_M;
  const f = worldFacing(toWorldYawDeg(plan.headingDeg));
  const [cx, cz] = embusenToWorldM(plan.cXZ, L_M);

  /**
   * THE LATERAL WIDTH `W`, applied perpendicular to `f(H)` and symmetric about `c`.
   *
   * doc 02 §4.2's own closing note authorises exactly this and explains why it is invisible to
   * the embusen: "in zenkutsu-dachi the two feet are treated as **collinear** along the facing
   * axis for embusen purposes (lateral offset folded into the stance spec; if doc 01/03 specifies
   * a hip-width lateral offset `d`, apply it perpendicular to `f(H)` symmetrically about `c`,
   * **which leaves every `c` unchanged**)."
   *
   * Leaving it out puts both ankles on the centre line, which is a 0.085 H (15 cm) error on each
   * foot in zenkutsu — a tightrope stance. It also propagates: the front leg then spans a purely
   * sagittal `hypot(0.371, 0.221)` and doc 01 §10's `kneeFrontDXvsAnkle = +0.005` has no lateral
   * component to measure at all.
   *
   * `worldCharLeft` is used rather than a hand-rolled perpendicular so the one §2.1 conversion
   * still owns the handedness: the LEFT foot goes to the character's left, on both sides of the
   * body and at every heading.
   */
  const w = STANCES[stance].W.v * H;
  const lat = worldCharLeft(toWorldYawDeg(plan.headingDeg));
  const front: readonly [number, number, number] = [cx + half * f[0], AJC_HEIGHT_M, cz + half * f[2]];
  const rear: readonly [number, number, number] = [cx - half * f[0], AJC_HEIGHT_M, cz - half * f[2]];
  const base = plan.frontFoot === 'L' ? { L: front, R: rear } : { L: rear, R: front };
  return {
    L: [base.L[0] + (w / 2) * lat[0], base.L[1], base.L[2] + (w / 2) * lat[2]],
    R: [base.R[0] - (w / 2) * lat[0], base.R[1], base.R[2] - (w / 2) * lat[2]],
  };
}

/** MIDHIP world position for a foot plan. `c + PELVIS_AHEAD_OF_C_H·f(H)`, at `pelvisY`. */
export function pelvisTargetM(
  plan: FootPlan,
  spec: StanceSpec,
  stance: StanceId,
): readonly [number, number, number] {
  const ahead = PELVIS_AHEAD_OF_C_H[stance] * H;
  const f = worldFacing(toWorldYawDeg(plan.headingDeg));
  const [cx, cz] = embusenToWorldM(plan.cXZ, L_M);
  return [cx + ahead * f[0], spec.pelvisY.v * H, cz + ahead * f[2]];
}

/**
 * doc 06 §6.2's knee pole: `normalize(footForwardHorizontal)`, world — "knee tracks over the toes,
 * the single hardest karate stance requirement". Deep stances lift it so a bent knee does not sink.
 *
 * ═══ FORWARD, TILTED OUTBOARD — AND THE TILT IS WHY doc 01 §10's SIGN RULE HOLDS ════════════
 * doc 06 §6.2 gives the knee pole as `normalize(footForwardHorizontal)`, purely horizontal. With
 * the lateral stance width applied the front ankle sits 0.085 H outboard of centre while the HJC
 * sits at 0.050 H, so a purely-forward bend plane leans INWARD and the knee finishes 0.013 H
 * MEDIAL of the ankle. doc 01 §10's tolerance is `−0.005 … +0.015` and its rule is "never medial"
 * — a sign error, not a magnitude one, and the collapse every karate instructor corrects first.
 *
 * `KNEE_POLE_OUTBOARD` tilts the direction just far enough to cross the ankle, landing
 * `+0.0041 H`. It stays a DIRECTION, which is what keeps it stable — see the two rejected
 * alternatives documented on `kneePoleM`.
 */
function kneePoleM(
  hip: Float64Array,
  footYawAbsDeg: number,
  deepFlexDeg: number,
  /** `+1` if this leg's outboard direction is the character's LEFT, i.e. the left leg. */
  outboardSign: number,
  headingDeg: number,
  out: Float64Array,
): void {
  /* The foot's own forward direction — an AUTHORED yaw, so it goes through the heading converter. */
  const f = worldFacing(toWorldYawDeg(footYawAbsDeg));
  const lat = worldCharLeft(toWorldYawDeg(headingDeg));

  /**
   * A FORWARD POLE, TILTED OUTBOARD. Anchored at the hip, as doc 06 §6.2 writes it.
   *
   * Two failed alternatives are worth recording, because both look more principled:
   *
   *   * PURELY FORWARD (doc 06 §6.2 verbatim) is well-conditioned but cannot satisfy doc 01 §10:
   *     with `W` applied the front ankle sits 0.085 H outboard and the HJC 0.050 H, so the bend
   *     plane leans inward and the knee lands 0.013 H MEDIAL — a sign error against "never medial".
   *   * AIMED THROUGH doc 01 §10's PUBLISHED KNEE (`+0.005` lateral, `+0.011` behind, `0.284 H`
   *     up) fixes the statics exactly — and wrecks the dynamics. That point sits 0.126 H BELOW the
   *     hip, so `hip → knee` is nearly PARALLEL to `hip → ankle`; the perpendicular component that
   *     defines the bend plane collapses, `solveTwoBonePositions` falls into its
   *     `|n| < 1e-8` fallback, and the plane is then whatever the rounding picks. Measured: the
   *     worst baked step went 15.4° → 52.6°, and Heian to 174°.
   *
   * So: keep the forward direction, which is ~90° from the leg line and therefore stable, and add
   * just enough OUTBOARD tilt to move the knee across the ankle. The tilt is a direction, not a
   * position, so it cannot degenerate however the leg is bent.
   */
  const outboard = outboardSign * KNEE_POLE_OUTBOARD;
  let ux = f[0] + outboard * lat[0];
  let uy = 0;
  let uz = f[2] + outboard * lat[2];
  if (deepFlexDeg > 100) {
    /* doc 06 §6.2: `lerp(footForward, (0,0.35,0) + footForward, 0.4)` — lifts the pole so a
     * deeply bent knee does not sink. Kiba and han-zenkutsu reach this; zenkutsu does not. */
    uy = 0.4 * 0.35;
  }
  const n = Math.hypot(ux, uy, uz);
  if (n < 1e-9) {
    out[0] = hip[0]! + 0.5 * H * f[0];
    out[1] = hip[1]!;
    out[2] = hip[2]! + 0.5 * H * f[2];
    return;
  }
  const reach = 0.5 * H;
  out[0] = hip[0]! + (reach * ux) / n;
  out[1] = hip[1]! + (reach * uy) / n;
  out[2] = hip[2]! + (reach * uz) / n;
}

/**
 * How far the knee pole tilts OUTBOARD of the foot's forward axis, as a fraction of the forward
 * component. Calibrated so doc 01 §10's `kneeFrontDXvsAnkle = +0.005 H` comes out of the solve.
 */
export const KNEE_POLE_OUTBOARD = 0.155;

/**
 * §4.3 / §4.11 S3. Plant both feet, hold `pelvisY` exactly, and let the knees fall out of it.
 *
 * Mutates `s` (the caller's FK scratch) and returns the measurements S3 and
 * `tests/solve/stances.test.ts` assert. Pure with respect to everything else.
 */
export function solveStance(
  spec: StanceSpec,
  plan: FootPlan,
  s: Skel,
  ankleOverride?: Readonly<Record<Handedness, readonly [number, number, number]>>,
  pelvisXZOverride?: readonly [number, number],
  /**
   * Absolute AUTHORED foot yaw per side — `heading + toe-out` — already interpolated.
   *
   * The toe-out is a property of the STANCE and the heading a property of the MOVE, so both jump
   * at a stance change: hachiji's ±30° to zenkutsu's +3°/+30° across the yoi boundary is a 63°
   * foot rotation in one tick, and the FINAL_HOLD→YAME turn is another. Interpolating position
   * alone leaves the feet sliding flat and then spinning on the spot.
   */
  footYawOverride?: Readonly<Record<Handedness, number>>,
): StanceSolve {
  const stance = spec.id;
  const rootYawDeg = toWorldYawDeg(plan.headingDeg);
  /* `ankleOverride` exists because a foot's position through a STEP is not a property of either
   * the old plan or the new one — the planted foot holds while the moving foot travels, and the
   * pair swap front/rear roles at the boundary. Deriving both ankles from whichever plan is
   * "current" makes them teleport past each other in one tick (measured: a 58° foot step, at the
   * 960 rung, i.e. a discontinuity no bake ladder can absorb). `keyposes.ts` owns that
   * interpolation because it is the only place that can see both plans. */
  const ankles = ankleOverride ?? ankleTargetsM(plan, stance);
  const pelvisBase = pelvisTargetM(plan, spec, stance);
  const pelvis: readonly [number, number, number] = pelvisXZOverride
    ? [pelvisXZOverride[0], pelvisBase[1], pelvisXZOverride[1]]
    : pelvisBase;

  /* ── 1. Root and pelvis. The root sits under MIDHIP on the floor; the pelvis bone carries the
   *      height, so `rootPos.y` stays 0 and `PoseTrack.rootPos` is a floor track. ───────────── */
  s.rootPos[0] = pelvis[0];
  s.rootPos[1] = 0;
  s.rootPos[2] = pelvis[2];
  _q.setFromAxisAngle(new Vector3(0, 1, 0), rootYawDeg * DEG);
  s.rootQuat[0] = _q.x;
  s.rootQuat[1] = _q.y;
  s.rootQuat[2] = _q.z;
  s.rootQuat[3] = _q.w;

  /* The pelvis bone's rest offset already carries `+0.5308 H`; the stance wants `pelvisY`, so the
   * difference is taken on the ROOT's local translation, not by scaling a bone. */
  s.localQuat[BI.root * 4] = 0;
  s.localQuat[BI.root * 4 + 1] = 0;
  s.localQuat[BI.root * 4 + 2] = 0;
  s.localQuat[BI.root * 4 + 3] = 1;
  s.rootPos[1] = spec.pelvisY.v * H - 0.5308 * H;

  /* Pelvis posterior tilt, about the character's left-right axis. `+` = pubis up, so the world
   * rotation is negative about +X.
   *
   * The HANMI YAW IS DELIBERATELY NOT APPLIED HERE. `pelvisYawHanmi` is a doc-04 ψ-class authored
   * yaw and it is S7's (`layerHipDrive`) output, not S3's: koshi no kaiten GENERATES it through
   * `holdThenSnap` over the move window, and baking a static 45° into the stance would give the
   * hips a step change at the slot boundary that S7 would then have to undo. `toWorldPsiDeg` is
   * imported and used by `psiWorldDeg` below so the ψ converter has exactly one caller. */
  _q.setFromAxisAngle(new Vector3(1, 0, 0), -spec.pelvisTiltPost.v * DEG);
  setLocal(s, BI.pelvis, _q);
  forwardKinematics(s);

  /* ── 2. Per-leg two-bone IK. Hip is wherever FK put it; the ankle is the plan. ─────────────── */
  const legs: Record<Handedness, LegSolve> = {} as Record<Handedness, LegSolve>;
  for (const side of ['L', 'R'] as const) {
    const b = sideBones(side);
    _hip[0] = s.worldPos[b.thigh * 3]!;
    _hip[1] = s.worldPos[b.thigh * 3 + 1]!;
    _hip[2] = s.worldPos[b.thigh * 3 + 2]!;
    const a = ankles[side];
    _ankle[0] = a[0];
    _ankle[1] = a[1];
    _ankle[2] = a[2];

    const isFront = side === plan.frontFoot;
    const toeOut = isFront ? spec.yawFront.v : spec.yawRear.v;
    /* `footYawOverride` is an ABSOLUTE authored yaw; without one it is heading + toe-out. */
    const footYawAbs = footYawOverride?.[side] ?? plan.headingDeg + toeOut;
    const nominalFlex = isFront ? spec.kneeFront.v : spec.kneeRear.v;
    /**
     * BOTH LEGS GET THE SAME OUTBOARD TILT. "The knee tracks over the toes" is a rule about a
     * knee, not about which leg happens to be forward.
     *
     * Branching it on `isFront` was tried and is a STEP FUNCTION: the front foot swaps at every
     * move boundary, so the tilt would jump on both legs within a single tick and the bend plane
     * would snap with it. A constant tilt is continuous across the swap by construction.
     */
    const outboardSign = side === 'L' ? 1 : -1;
    kneePoleM(_hip, footYawAbs, nominalFlex, outboardSign, plan.headingDeg, _pole);

    /* doc 06 §3.1: knee 0/−140, "hyperextension hard-locked at 0". Folded into IK step 2. */
    const args: TwoBoneArgs = {
      aWorld: _hip,
      lenAB: LEG_LEN_M.thighToCalf,
      lenBC: LEG_LEN_M.calfToFoot,
      targetWorld: _ankle,
      poleWorld: _pole,
      /* THE LEG SOLVE DOES NOT SOFTEN. doc 06 §6.1's `soften = 0.97` exists to stop the visible
       * pop as a REACHING limb straightens, by deliberately under-reaching near full extension.
       * A stance leg needs the opposite trade: the ankle is a PLANTED contact whose position the
       * embusen depends on, and §4.11 S3 gates it at 1e-6 m.
       *
       * Zenkutsu's rear leg sits at 100.0 % of `Lsum` and kokutsu's front at 99.1 %, both inside
       * the soften band, so `0.97` under-reaches them by 9.5 mm and 5.0 mm — three orders past
       * S3's gate, and a 9.5 mm foot-placement error is directly what metric 42 measures. The
       * knee-flexion limit is still folded into step 2, so nothing about the pop-prevention that
       * matters here is lost: a leg cannot hyperextend, it simply reaches its target. */
      soften: 1,
      midMinDeg: 0,
      /* doc 06 §3.1: knee 0/−140, "hyperextension hard-locked at 0". Folded into IK step 2. */
      midMaxDeg: 140,
    };
    const residual = solveTwoBonePositions(args, _knee, _end);

    /* Apply as world deltas onto the thigh and calf. `bWorld`/`cWorld` are the CURRENT knee and
     * ankle, so the incoming twist survives (doc 06 §6.1 step 5). */
    const curKnee = new Float64Array([
      s.worldPos[b.calf * 3]!, s.worldPos[b.calf * 3 + 1]!, s.worldPos[b.calf * 3 + 2]!,
    ]);
    const curAnkle = new Float64Array([
      s.worldPos[b.foot * 3]!, s.worldPos[b.foot * 3 + 1]!, s.worldPos[b.foot * 3 + 2]!,
    ]);
    solveTwoBone(args, _out, curKnee, curAnkle);
    applyWorldDelta(s, b.thigh, _out.qA);
    forwardKinematics(s);
    applyWorldDelta(s, b.calf, _out.qB);
    forwardKinematics(s);

    /* ── 3. Foot: sole flat on the floor, toe pointing along the absolute authored yaw. ─────── */
    orientFoot(s, side, footYawAbs);
    forwardKinematics(s);

    legs[side] = {
      side,
      kneeFlexDeg: 180 - includedAngleDeg(_hip, _knee, _end),
      kneeWorld: [_knee[0]!, _knee[1]!, _knee[2]!],
      ankleResidualM: residual,
    };
  }

  /* ── 4. The doc 01 §10 measurements, read back OFF THE SOLVE. ─────────────────────────────── */
  const f = worldFacing(rootYawDeg);
  const along = (p: readonly [number, number, number], q: readonly [number, number, number]) =>
    (p[0] - q[0]) * f[0] + (p[2] - q[2]) * f[2];
  const frontAnkle = ankles[plan.frontFoot];
  const rearAnkle = ankles[plan.frontFoot === 'L' ? 'R' : 'L'];
  const hipXZ: readonly [number, number, number] = [pelvis[0], pelvis[1], pelvis[2]];

  /* Lateral offset uses the world char-left axis, so `+` means "toward the character's left". */
  const lx = f[2];
  const lz = -f[0];
  const frontKnee = legs[plan.frontFoot].kneeWorld;
  const kneeFrontLateralH =
    ((frontKnee[0] - frontAnkle[0]) * lx + (frontKnee[2] - frontAnkle[2]) * lz) / H;

  return {
    pelvisWorld: pelvis,
    rootYawDeg,
    legs,
    hipBehindFrontAnkleH: -along(hipXZ, frontAnkle) / H,
    hipAheadOfRearAnkleH: along(hipXZ, rearAnkle) / H,
    kneeFrontLateralH,
  };
}

/**
 * Level the foot: the sole flat on the floor, the toe along `heading + toeOut`.
 *
 * Built as an absolute world rotation rather than a delta, because the foot is the one bone whose
 * orientation is fully determined by the plan — it does not inherit anything useful from the leg
 * IK, which only placed the ankle POSITION.
 */
function orientFoot(s: Skel, side: Handedness, authoredYawDeg: number): void {
  const b = sideBones(side);
  /* Bind: the foot's primary axis is −Z (the toe direction), sole down. A pure world yaw about Y
   * therefore lands the toe on the wanted heading and keeps the sole level. */
  _q.setFromAxisAngle(_v.set(0, 1, 0), toWorldYawDeg(authoredYawDeg) * DEG);
  const p = b.calf;
  _q2.set(
    s.worldQuat[p * 4]!, s.worldQuat[p * 4 + 1]!, s.worldQuat[p * 4 + 2]!, s.worldQuat[p * 4 + 3]!,
  ).invert();
  _q.premultiply(_q2);
  setLocal(s, b.foot, _q);
}

/**
 * doc 01 §4.3's impossibility result, as a computable predicate.
 *
 * "kokutsu cannot be as long as zenkutsu at equal hip height with 70 % rear load." §4.3's own
 * first sentence names the binding limb:
 *
 *   > At `PELVIS_Y = 0.410 H` with 70 % rear load, the **FRONT** leg must span `0.70·S`
 *   > horizontally. Straight-leg reach caps `S` at `0.459 H`.
 *
 * ═══ IT IS THE FRONT LEG, NOT THE REAR ══════════════════════════════════════════════════════
 * This function measured the REAR leg until `tests/solve/kokutsu.test.ts` was written against the
 * doc and the discrepancy surfaced. The reasoning that produced the error is superficially
 * plausible — "70 % of the load is on the rear leg, so the rear leg is the constrained one" — and
 * it is exactly backwards. doc 06 §2.2's relation is INVERSE: more load on a foot puts the COM
 * (and the hip) CLOSER to it, so at 70 % rear the hip sits `0.30·S` from the rear ankle and
 * `0.70·S` from the front one. The FRONT leg is the one being asked to span a long way. doc 01
 * §4.2's own kokutsu numbers confirm it: `0.134 = 0.30 × 0.446` and `0.312 = 0.70 × 0.446`.
 *
 * With the rear reading the predicate returned 0.4048 H against an available 0.4918 H — 8.7 cm of
 * slack — so it reported the stance as comfortably possible and the whole §4.3 argument evaporated.
 *
 * `rearShareFrac` is the REAR load share (0.70 for kokutsu); the front leg's horizontal span is
 * therefore `S · rearShareFrac`. Any return above `LEG_LENGTH_H` is impossible.
 */
export function kokutsuRequiredLegH(stanceLenH: number, pelvisYH: number, rearShareFrac: number): number {
  const hipAheadOfFront = stanceLenH * rearShareFrac;
  return Math.hypot(pelvisYH - AJC_HEIGHT_H, hipAheadOfFront);
}

/** The character's actual leg length, FracH — `thigh + calf`. */
export const LEG_LENGTH_H: number = (LEG_LEN_M.thighToCalf + LEG_LEN_M.calfToFoot) / H;

/**
 * A doc-04 §0 ψ-class authored hip/thorax yaw -> WORLD degrees. THE only caller of
 * `toWorldPsiDeg`, so the negating converter has exactly one use site in the solver and a reader
 * looking for "where does ψ flip?" finds one answer.
 *
 * `spec.pelvisYawHanmi` is the AUTHORED +45° (hips half-facing). S7 drives the ψ channel between
 * `shomen` (0) and this value with `holdThenSnap`; both ends go through here.
 */
export function psiWorldDeg(authoredPsiDeg: number): number {
  return toWorldPsiDeg(authoredPsiDeg);
}

/** The authored hip yaw a move's `hips` field asks for, in AUTHORED degrees. */
export function hipYawAuthoredDeg(spec: StanceSpec, hips: 'shomen' | 'hanmi' | 'gyaku-hanmi'): number {
  if (hips === 'shomen') return 0;
  const mag = spec.pelvisYawHanmi.v;
  return hips === 'hanmi' ? mag : -mag;
}

/**
 * doc 01 §3.2's front-knee flexion, computed from the same law of cosines the solve uses.
 * Exported so `tests/solve/stances.test.ts` can assert the CLOSED FORM and the SOLVE agree —
 * two independent routes to `57.2°`, which is what makes the 57 in doc 01 §10 a check rather
 * than a coincidence.
 */
export function kneeFlexClosedFormDeg(hipToAnkleH: number): number {
  const l1 = LEG_LEN_M.thighToCalf / H;
  const l2 = LEG_LEN_M.calfToFoot / H;
  const c = (l1 * l1 + l2 * l2 - hipToAnkleH * hipToAnkleH) / (2 * l1 * l2);
  return 180 - Math.acos(Math.max(-1, Math.min(1, c))) * RAD;
}

/** Re-exported so `com.ts` and the stage asserts read one arm-length source. */
export { ARM_LEN_M, STANCES };
