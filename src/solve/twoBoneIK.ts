/**
 * B3 SOLVER — `src/solve/twoBoneIK.ts`
 *
 * doc 06 §6.1's analytic two-bone IK, NORMATIVE, steps (1)–(5) verbatim. ARCHITECTURE.md §3.4.1
 * (`TwoBoneArgs` / `TwoBoneOut`), §4.11 S4 / S12.5, §3.13 (`solveTwoBone` is exported so B9 can
 * build the Channel-B reference figure with the SAME IK — a reference solved by a second
 * implementation measures the difference between two solvers, not the rig).
 *
 * ═══ THE JOINT LIMIT IS FOLDED INTO STEP 2, NEVER POST-CLAMPED ══════════════════════════════
 * doc 06 §6.1: "This makes the clamp *part of the solve* instead of a post-pass that breaks the
 * endpoint." A knee clamped after the fact moves the ankle, and the ankle is what a plant lock
 * committed. So `midMinDeg`/`midMaxDeg` bound `thetaB` FIRST and `r_c` is then recomputed from
 * the law of cosines — the chain still closes on itself, it just closes short of the target, and
 * the shortfall is reported honestly as the returned residual instead of being hidden.
 *
 * That returned residual is what §4.11 S4 gates at `< 0.005 m` and what
 * `SolveDiagnostics.ikResidualM` carries per frame. It is a MEASUREMENT, not an error code.
 *
 * ═══ SOFTEN IS NOT A FUDGE ══════════════════════════════════════════════════════════════════
 * `soften = 0.97` (doc 06 §6.1, ozz-animation's parameter). Without it the limb pops visibly as
 * it straightens, because `thetaA` is a `acos` whose derivative diverges at full extension. The
 * softened reach is monotone, asymptotes to `Lsum` and is C¹ at `r = d0` (both one-sided
 * derivatives are 1), so a straightening arm decelerates instead of hitting a wall — which at
 * `oi-zuki` kime is the difference between a punch and a mannequin.
 */

import { Quaternion, Vector3 } from 'three';

import { RAD } from '../contracts';

/** §3.4.1, frozen. All lengths in METRES, all vectors world-space. */
export interface TwoBoneArgs {
  readonly aWorld: Float64Array;
  readonly lenAB: number;
  readonly lenBC: number;
  readonly targetWorld: Float64Array;
  readonly poleWorld: Float64Array;
  readonly soften: number;
  readonly midMinDeg: number;
  readonly midMaxDeg: number;
}

/** §3.4.1, frozen. `qA`/`qB` are LOCAL, xyzw. */
export interface TwoBoneOut {
  readonly qA: Float64Array;
  readonly qB: Float64Array;
  readonly reachedWorld: Float64Array;
}

/** doc 06 §6.1 step 1: `s = soften_start = 0.97`. */
export const SOFTEN_DEFAULT = 0.97;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/* Module-level scratch — S13's 220 ms budget does not survive an allocation per chain per frame. */
const _u = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const _pole = new Vector3();
const _bPrime = new Vector3();
const _cPrime = new Vector3();
const _qA = new Quaternion();
const _qB = new Quaternion();
const _tmp = new Vector3();
const _dirNow = new Vector3();
const _dirWant = new Vector3();

/**
 * doc 06 §6.1 step 1, verbatim. Monotone, asymptotic to `Lsum`, C¹ at `r = d0`.
 *
 * Exported because `tests/solve/ik.test.ts` asserts the C¹ property directly: a discontinuous
 * derivative here is invisible in a still and reads as a hitch in motion.
 */
export function softenReach(r: number, lenAB: number, lenBC: number, soften: number): number {
  const lSum = lenAB + lenBC;
  const rMin = Math.abs(lenAB - lenBC) + 0.01 * lSum;
  const d0 = soften * lSum;
  let rc = clamp(r, rMin, lSum * 0.998);
  if (r > d0) {
    const span = lSum - d0;
    rc = span > 1e-12 ? d0 + span * (1 - Math.exp(-(r - d0) / span)) : d0;
    /* The soften branch can undercut `rMin` on a chain with very unequal bones. */
    if (rc < rMin) rc = rMin;
  }
  return rc;
}

/**
 * doc 06 §6.1 step 2 including the joint-limit-aware variant.
 * Returns the interior A-B-C angle `thetaB` and the AB-to-AT angle `thetaA`, both radians, plus
 * the (possibly limit-shortened) reach actually used.
 */
export function lawOfCosines(
  rTarget: number,
  lenAB: number,
  lenBC: number,
  midMinDeg: number,
  midMaxDeg: number,
): { thetaA: number; thetaB: number; rc: number } {
  const denom = 2 * lenAB * lenBC;
  if (denom < 1e-4) {
    /* Degenerate zero-length bone — doc 06 §6.1's own guard. */
    return { thetaA: 0, thetaB: Math.PI, rc: rTarget };
  }
  let rc = rTarget;
  let cosB = clamp((lenAB * lenAB + lenBC * lenBC - rc * rc) / denom, -1, 1);
  let thetaB = Math.acos(cosB);

  /* The limit, folded in. `midMinDeg`/`midMaxDeg` are FLEXION limits (0 = straight), and
   * `thetaB` is the INTERIOR angle, so the mapping is `thetaB = PI - flex`. doc 06 §6.1:
   * `thetaB = clamp(thetaB, PI - flexMax, PI - flexMin)`. */
  const lo = Math.PI - midMaxDeg / RAD;
  const hi = Math.PI - midMinDeg / RAD;
  const thetaBClamped = clamp(thetaB, Math.min(lo, hi), Math.max(lo, hi));
  if (Math.abs(thetaBClamped - thetaB) > 1e-12) {
    thetaB = thetaBClamped;
    /* Recompute the reach the clamped bend actually achieves — this is what keeps the chain
     * closed on itself rather than leaving B floating off the AB segment. */
    rc = Math.sqrt(Math.max(0, lenAB * lenAB + lenBC * lenBC - denom * Math.cos(thetaB)));
    cosB = Math.cos(thetaB);
  }

  const thetaA =
    rc < 1e-9
      ? 0
      : Math.acos(clamp((lenAB * lenAB + rc * rc - lenBC * lenBC) / (2 * lenAB * rc), -1, 1));
  return { thetaA, thetaB, rc };
}

/**
 * doc 06 §6.1's `quatFromUnitVectors`: `w = 1 + a·b`, `xyz = a × b`, normalise; antiparallel falls
 * back to a π rotation about any perpendicular. This form preserves whatever twist the chain
 * already carried, which is why doc 06 chooses it over building Eulers.
 */
export function quatFromUnitVectors(a: Vector3, b: Vector3, out: Quaternion): Quaternion {
  const d = a.dot(b);
  if (d < -1 + 1e-6) {
    _tmp.set(1, 0, 0);
    if (Math.abs(a.x) > 0.9) _tmp.set(0, 1, 0);
    _tmp.cross(a).normalize();
    out.setFromAxisAngle(_tmp, Math.PI);
    return out;
  }
  _tmp.copy(a).cross(b);
  out.set(_tmp.x, _tmp.y, _tmp.z, 1 + d).normalize();
  return out;
}

/**
 * §3.13. Solve the chain and return the residual `|C′ − T|` in METRES.
 *
 * `out.qA` / `out.qB` are the WORLD-space DELTA rotations to pre-multiply onto the current world
 * quaternions of A and B, which is doc 06 §6.1 step 5's own formulation ("`A.worldQuat = q1 *
 * A.worldQuat`"). The caller converts to local with the parent inverse; keeping the delta in
 * world space is what makes the solve independent of the rest pose and reusable by B9.
 *
 * `bWorld` / `cWorld` are the chain's CURRENT mid and end positions. Step 5 rotates the EXISTING
 * bone directions onto the solved ones, which is what preserves the twist the pose already had —
 * that is doc 06 §6.1's stated reason for choosing `quatFromUnitVectors` over building Eulers.
 * Omit them and the deltas are measured from the solved chain itself, i.e. both are identity;
 * that is the right answer for a caller that only wants `reachedWorld`, and `solveTwoBonePositions`
 * is the cheaper way to ask for it.
 */
export function solveTwoBone(
  a: TwoBoneArgs,
  out: TwoBoneOut,
  bWorld?: Float64Array,
  cWorld?: Float64Array,
): number {
  const ax = a.aWorld[0]!;
  const ay = a.aWorld[1]!;
  const az = a.aWorld[2]!;

  /* ── step 1: reach clamp + soften ────────────────────────────────────────────────────── */
  _u.set(a.targetWorld[0]! - ax, a.targetWorld[1]! - ay, a.targetWorld[2]! - az);
  const r = _u.length();
  if (r < 1e-9) {
    /* Target sits on the root joint: no direction exists. Leave both bones alone. */
    identity(out.qA);
    identity(out.qB);
    out.reachedWorld[0] = ax;
    out.reachedWorld[1] = ay;
    out.reachedWorld[2] = az;
    return 0;
  }
  _u.multiplyScalar(1 / r);
  const rc = softenReach(r, a.lenAB, a.lenBC, a.soften);

  /* ── step 2: law of cosines, with the joint limit folded in ──────────────────────────── */
  const { thetaA, rc: rcFinal } = lawOfCosines(rc, a.lenAB, a.lenBC, a.midMinDeg, a.midMaxDeg);

  /* ── step 3: bend plane from the pole vector ─────────────────────────────────────────── */
  _pole.set(a.poleWorld[0]! - ax, a.poleWorld[1]! - ay, a.poleWorld[2]! - az);
  _n.copy(_pole).addScaledVector(_u, -_pole.dot(_u));
  if (_n.lengthSq() < 1e-8) {
    if (bWorld !== undefined) {
      _n.set(bWorld[0]! - ax, bWorld[1]! - ay, bWorld[2]! - az);
      _n.addScaledVector(_u, -_n.dot(_u));
    }
    if (_n.lengthSq() < 1e-8) {
      /* Any perpendicular. Deterministic: derived from `_u`, never from a random axis. */
      _n.set(0, 1, 0);
      if (Math.abs(_u.y) > 0.9) _n.set(1, 0, 0);
      _n.addScaledVector(_u, -_n.dot(_u));
    }
  }
  _v.copy(_n).normalize();

  /* ── step 4: target joint positions ──────────────────────────────────────────────────── */
  _bPrime
    .set(ax, ay, az)
    .addScaledVector(_u, a.lenAB * Math.cos(thetaA))
    .addScaledVector(_v, a.lenAB * Math.sin(thetaA));
  _cPrime.set(ax, ay, az).addScaledVector(_u, rcFinal);

  /* ── step 5: bones from positions — two swings, twist-preserving ─────────────────────── */

  /* q1 rotates the CURRENT A->B direction onto the solved one. */
  _tmp.set(_bPrime.x - ax, _bPrime.y - ay, _bPrime.z - az).normalize();
  if (bWorld === undefined) {
    identity(out.qA);
    _qA.set(0, 0, 0, 1);
  } else {
    _dirNow.set(bWorld[0]! - ax, bWorld[1]! - ay, bWorld[2]! - az);
    if (_dirNow.lengthSq() < 1e-18) _qA.set(0, 0, 0, 1);
    else quatFromUnitVectors(_dirNow.normalize(), _tmp, _qA);
    write(out.qA, _qA);
  }

  /* q2 rotates the current B->C direction, CARRIED THROUGH q1, onto the solved B′->C′ one.
   * Carrying it through q1 is the step a naive implementation drops, and dropping it leaves the
   * forearm counter-rotated by exactly the upper-arm swing. */
  _dirWant.set(_cPrime.x - _bPrime.x, _cPrime.y - _bPrime.y, _cPrime.z - _bPrime.z);
  const wantLen = _dirWant.length();
  if (cWorld === undefined || bWorld === undefined || wantLen < 1e-12) {
    identity(out.qB);
  } else {
    _dirNow.set(cWorld[0]! - bWorld[0]!, cWorld[1]! - bWorld[1]!, cWorld[2]! - bWorld[2]!);
    if (_dirNow.lengthSq() < 1e-18) {
      identity(out.qB);
    } else {
      _dirNow.normalize().applyQuaternion(_qA);
      _dirWant.multiplyScalar(1 / wantLen);
      quatFromUnitVectors(_dirNow, _dirWant, _qB);
      write(out.qB, _qB);
    }
  }

  out.reachedWorld[0] = _cPrime.x;
  out.reachedWorld[1] = _cPrime.y;
  out.reachedWorld[2] = _cPrime.z;

  /* THE RESIDUAL. `rcFinal < r` whenever the target is out of reach or the mid limit bound. */
  return Math.hypot(
    _cPrime.x - a.targetWorld[0]!,
    _cPrime.y - a.targetWorld[1]!,
    _cPrime.z - a.targetWorld[2]!,
  );
}

/**
 * The positional half of the solve, with no quaternion work: where B and C end up.
 *
 * `tests/solve/ik.test.ts` checks `|C′ − T| < 1e-9` in range and every doc 03 §13.1
 * law-of-cosines row through this, and `src/solve/stance.ts` uses it directly — the leg solve
 * needs the knee POSITION to place the pole and never needs a delta quaternion.
 */
export function solveTwoBonePositions(
  a: TwoBoneArgs,
  outB: Float64Array,
  outC: Float64Array,
): number {
  const ax = a.aWorld[0]!;
  const ay = a.aWorld[1]!;
  const az = a.aWorld[2]!;
  _u.set(a.targetWorld[0]! - ax, a.targetWorld[1]! - ay, a.targetWorld[2]! - az);
  const r = _u.length();
  if (r < 1e-9) {
    outB[0] = ax; outB[1] = ay + a.lenAB; outB[2] = az;
    outC[0] = ax; outC[1] = ay; outC[2] = az;
    return 0;
  }
  _u.multiplyScalar(1 / r);
  const rc = softenReach(r, a.lenAB, a.lenBC, a.soften);
  const { thetaA, rc: rcFinal } = lawOfCosines(rc, a.lenAB, a.lenBC, a.midMinDeg, a.midMaxDeg);

  _pole.set(a.poleWorld[0]! - ax, a.poleWorld[1]! - ay, a.poleWorld[2]! - az);
  _n.copy(_pole).addScaledVector(_u, -_pole.dot(_u));
  if (_n.lengthSq() < 1e-8) {
    _n.set(0, 1, 0);
    if (Math.abs(_u.y) > 0.9) _n.set(1, 0, 0);
    _n.addScaledVector(_u, -_n.dot(_u));
  }
  _v.copy(_n).normalize();

  outB[0] = ax + a.lenAB * (Math.cos(thetaA) * _u.x + Math.sin(thetaA) * _v.x);
  outB[1] = ay + a.lenAB * (Math.cos(thetaA) * _u.y + Math.sin(thetaA) * _v.y);
  outB[2] = az + a.lenAB * (Math.cos(thetaA) * _u.z + Math.sin(thetaA) * _v.z);
  outC[0] = ax + rcFinal * _u.x;
  outC[1] = ay + rcFinal * _u.y;
  outC[2] = az + rcFinal * _u.z;
  return Math.hypot(
    outC[0]! - a.targetWorld[0]!,
    outC[1]! - a.targetWorld[1]!,
    outC[2]! - a.targetWorld[2]!,
  );
}

/**
 * The INCLUDED elbow/knee angle in degrees that the solve produced, from the three positions.
 * S4 gates this against `TechniqueSpec.elbowIncludedDeg` at ±5°.
 */
export function includedAngleDeg(
  aW: Float64Array | readonly number[],
  bW: Float64Array | readonly number[],
  cW: Float64Array | readonly number[],
): number {
  const abx = aW[0]! - bW[0]!;
  const aby = aW[1]! - bW[1]!;
  const abz = aW[2]! - bW[2]!;
  const cbx = cW[0]! - bW[0]!;
  const cby = cW[1]! - bW[1]!;
  const cbz = cW[2]! - bW[2]!;
  const la = Math.hypot(abx, aby, abz);
  const lc = Math.hypot(cbx, cby, cbz);
  if (la < 1e-12 || lc < 1e-12) return 180;
  const d = clamp((abx * cbx + aby * cby + abz * cbz) / (la * lc), -1, 1);
  return Math.acos(d) * RAD;
}

/** A fresh `TwoBoneOut`. Callers hoist one per chain and reuse it. */
export function newTwoBoneOut(): TwoBoneOut {
  return {
    qA: new Float64Array([0, 0, 0, 1]),
    qB: new Float64Array([0, 0, 0, 1]),
    reachedWorld: new Float64Array(3),
  };
}

const identity = (q: Float64Array): void => {
  q[0] = 0; q[1] = 0; q[2] = 0; q[3] = 1;
};
const write = (dst: Float64Array, q: Quaternion): void => {
  dst[0] = q.x; dst[1] = q.y; dst[2] = q.z; dst[3] = q.w;
};
