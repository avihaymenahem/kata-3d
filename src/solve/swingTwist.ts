/**
 * B3 SOLVER — `src/solve/swingTwist.ts`
 *
 * doc 06 §3.2's swing-twist decomposition and elliptic-cone clamp, NORMATIVE, plus the thing that
 * section cannot express: **a named per-bone sign gate for the A joints.** ARCHITECTURE.md §4.11
 * S12; `src/contracts/kata.ts`'s `RomLimit` doc block states the requirement in full.
 *
 * ═══ WHY THE CONE ALONE IS NOT A ROM CHECK ══════════════════════════════════════════════════
 * `RomLimit` is an ELLIPTIC SWING CONE plus a signed twist range, and a cone is symmetric about
 * the primary axis by construction. Most of doc 06 §3.1's table is not: hip flex/ext +125/−25,
 * shoulder flex/ext +175/−55, shoulder abd/add +170/−38. B1 authors the semi-axis as the SMALLER
 * of each signed pair so the envelope errs tight, but "tight" is not "correct" — a cone of 55°
 * still admits 55° of shoulder EXTENSION where the anatomy allows 55 and 175 of flexion where the
 * cone allows 55.
 *
 * Reading S12's "every bone inside ROM" as the cone alone therefore admits poses that are
 * anatomically impossible in one direction and needlessly clipped in the other, and **nothing
 * downstream can see it**: §3.4.1's `JointStream` carries only `pos`, so no metric in the 63
 * measures a joint's rotational sign. That is why `assertSignGate` exists here, why it is named,
 * and why it reads `ROM_SIGNED` — doc 06 §3.1 verbatim — rather than `ROM`.
 *
 * ═══ THE AXIS MUST BE CONVERTED FIRST ═══════════════════════════════════════════════════════
 * `PRIMARY_AXIS` is AUTHORED (`src/contracts/bones.ts` §3.4). doc 06 §3.2's `clampSwingTwist(q, a)`
 * needs `a` in the same frame as the bone-local `q`, i.e. the BUILT rig's, which carries the §2.1
 * x-negation. Every entry point below takes the axis through `toWorld` itself rather than trusting
 * the caller, and `primaryAxisWorld()` is the only way to obtain one. Feeding the raw table would
 * invert the twist axis on all 26 arm-chain bones — palm up at kime on every zuki — and
 * `tests/contracts/handedness.test.ts` §3.4 is the only guard in the project against it.
 */

import { Quaternion, Vector3 } from 'three';

import type { BoneName, RomLimit } from '../contracts';
import { DEG, PRIMARY_AXIS_BY_NAME, RAD } from '../contracts';
import { ROM_PERP_AXES, ROM_SIGNED } from '../data';
import { toWorld } from './frame';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/* Scratch. Module-level and reused: the clamp runs 52 bones x ~9000 frames per kata, and S13's
 * 220 ms budget does not survive an allocation per bone per frame. Never escapes this module. */
const _axis = new Vector3();
const _p = new Vector3();
const _qT = new Quaternion();
const _qS = new Quaternion();
const _qTinv = new Quaternion();
const _swingAxis = new Vector3();
const _perp1 = new Vector3();
const _perp2 = new Vector3();

/**
 * The bone's primary axis in the BUILT RIG's frame — `toWorld(PRIMARY_AXIS[bone])`.
 * THE only legal way to get a twist axis. See the header.
 */
export function primaryAxisWorld(bone: BoneName): readonly [number, number, number] {
  return toWorld(PRIMARY_AXIS_BY_NAME[bone]);
}

export interface SwingTwist {
  /** Signed twist angle about the primary axis, degrees. */
  readonly twistDeg: number;
  /** Swing magnitude, degrees, always >= 0. */
  readonly swingDeg: number;
  /** Unit swing axis, perpendicular to the primary axis. Zero vector when `swingDeg === 0`. */
  readonly swingAxis: readonly [number, number, number];
}

/**
 * doc 06 §3.2 steps 1–2. Decompose a bone-local quaternion about `axis` into twist ∘ swing.
 *
 * `q = qSwing * qTwist`, which is the order doc 06 §3.2 writes and the order `clampSwingTwist`
 * reassembles in. The twist is the projection of the vector part onto the axis; the swing is what
 * is left after removing it.
 */
export function splitSwingTwist(
  q: Quaternion,
  axis: readonly [number, number, number],
): SwingTwist {
  _axis.set(axis[0], axis[1], axis[2]).normalize();
  const d = q.x * _axis.x + q.y * _axis.y + q.z * _axis.z;
  _p.copy(_axis).multiplyScalar(d);

  _qT.set(_p.x, _p.y, _p.z, q.w);
  const nrm = Math.hypot(_qT.x, _qT.y, _qT.z, _qT.w);
  if (nrm < 1e-12) {
    /* q is a 180° swing about an axis perpendicular to `axis`: the twist is undefined, and 0 is
     * the only continuous choice. Returning NaN here would poison the whole pose. */
    _qT.set(0, 0, 0, 1);
  } else {
    _qT.set(_qT.x / nrm, _qT.y / nrm, _qT.z / nrm, _qT.w / nrm);
  }

  /* doc 06 §3.2: `qS = q * inv(qT)`. */
  _qTinv.copy(_qT).invert();
  _qS.copy(q).multiply(_qTinv);

  /* Signed twist about the axis. `atan2(p·a, q.w)` keeps the sign the projection carries. */
  const twistRad = 2 * Math.atan2(d, q.w);
  const twistDeg = normaliseDeg(twistRad * RAD);

  const swingW = clamp(_qS.w, -1, 1);
  const swingRad = 2 * Math.acos(Math.abs(swingW));
  const s = Math.hypot(_qS.x, _qS.y, _qS.z);
  if (s < 1e-12) {
    return { twistDeg, swingDeg: 0, swingAxis: [0, 0, 0] };
  }
  /* Fold the double cover so the axis is the one belonging to the shorter arc. */
  const sgn = swingW < 0 ? -1 : 1;
  _swingAxis.set((sgn * _qS.x) / s, (sgn * _qS.y) / s, (sgn * _qS.z) / s);
  return {
    twistDeg,
    swingDeg: swingRad * RAD,
    swingAxis: [_swingAxis.x, _swingAxis.y, _swingAxis.z],
  };
}

/** Fold a degree value into (−180, +180]. A twist of 350° is a twist of −10°. */
export function normaliseDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

/**
 * doc 06 §3.2's `ellipticConeLimit(dir, ellipseXZ)`, verbatim:
 *
 *     1/lim² = (cos φ / bx)² + (sin φ / bz)²,   φ = atan2(dir·ẑ_local, dir·x̂_local)
 *
 * `bx`/`bz` are HALF-ANGLES in degrees; the return is degrees. `x̂_local`/`ẑ_local` are the two
 * axes perpendicular to the primary axis, in the order `ROM_PERP_AXES` publishes — B1 owns that
 * pairing so this file cannot rediscover it differently.
 */
export function ellipticConeLimitDeg(
  dir: readonly [number, number, number],
  axis: readonly [number, number, number],
  bxDeg: number,
  bzDeg: number,
): number {
  if (bxDeg <= 0 && bzDeg <= 0) return 0;
  perpBasis(axis);
  const cx = dir[0] * _perp1.x + dir[1] * _perp1.y + dir[2] * _perp1.z;
  const cz = dir[0] * _perp2.x + dir[1] * _perp2.y + dir[2] * _perp2.z;
  const phi = Math.atan2(cz, cx);
  const c = Math.cos(phi) / Math.max(bxDeg, 1e-9);
  const s = Math.sin(phi) / Math.max(bzDeg, 1e-9);
  const inv = Math.sqrt(c * c + s * s);
  return inv < 1e-12 ? Math.max(bxDeg, bzDeg) : 1 / inv;
}

/** A stable orthonormal pair perpendicular to `axis`. Writes `_perp1` / `_perp2`. */
function perpBasis(axis: readonly [number, number, number]): void {
  _axis.set(axis[0], axis[1], axis[2]).normalize();
  /* Pick the world axis least aligned with `_axis` so the cross product never degenerates. */
  const ax = Math.abs(_axis.x);
  const ay = Math.abs(_axis.y);
  const az = Math.abs(_axis.z);
  if (ax <= ay && ax <= az) _perp1.set(1, 0, 0);
  else if (ay <= az) _perp1.set(0, 1, 0);
  else _perp1.set(0, 0, 1);
  _perp2.copy(_axis).cross(_perp1).normalize();
  _perp1.copy(_perp2).cross(_axis).normalize();
}

export interface ClampResult {
  /** 0 = untouched, 1 = the clamp was fully binding on both swing and twist. */
  readonly saturation: number;
  readonly twistClamped: boolean;
  readonly swingClamped: boolean;
}

/**
 * doc 06 §3.2 steps 3–4, NORMATIVE. Clamps `q` IN PLACE to `lim`, about the bone's primary axis.
 *
 * `axis` MUST already be `primaryAxisWorld(bone)`. `saturation` is what S12 records per move into
 * `SolveDiagnostics.clampSatByMove` — a bone that is pinned at its limit every frame is a solver
 * fault the scorecard can route, whereas a bone that touches it once is normal.
 */
export function clampSwingTwist(
  q: Quaternion,
  axis: readonly [number, number, number],
  lim: RomLimit,
): ClampResult {
  const st = splitSwingTwist(q, axis);

  const twistWanted = st.twistDeg;
  const twistGot = clamp(twistWanted, lim.twistMinDeg, lim.twistMaxDeg);
  const twistClamped = Math.abs(twistGot - twistWanted) > 1e-9;

  let swingGot = st.swingDeg;
  let swingClamped = false;
  let coneDeg = Math.max(lim.swingConeXDeg, lim.swingConeZDeg);
  if (st.swingDeg > 1e-9) {
    coneDeg = ellipticConeLimitDeg(st.swingAxis, axis, lim.swingConeXDeg, lim.swingConeZDeg);
    if (st.swingDeg > coneDeg) {
      swingGot = coneDeg;
      swingClamped = true;
    }
  }

  _axis.set(axis[0], axis[1], axis[2]).normalize();
  _qT.setFromAxisAngle(_axis, twistGot * DEG);
  if (swingGot > 1e-9) {
    _swingAxis.set(st.swingAxis[0], st.swingAxis[1], st.swingAxis[2]).normalize();
    _qS.setFromAxisAngle(_swingAxis, swingGot * DEG);
  } else {
    _qS.set(0, 0, 0, 1);
  }
  /* doc 06 §3.2 step 5: `return qS.multiply(qT)`. */
  q.copy(_qS).multiply(_qT);

  const twistSpan = Math.max(lim.twistMaxDeg - lim.twistMinDeg, 1e-9);
  const twistSat = Math.abs(twistGot - twistWanted) / twistSpan;
  const swingSat = coneDeg > 1e-9 ? Math.max(0, st.swingDeg - coneDeg) / coneDeg : 0;
  return {
    saturation: Math.min(1, Math.max(twistSat, swingSat)),
    twistClamped,
    swingClamped,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE NAMED PER-BONE SIGN GATE — the A joints (hip, shoulder) that `RomLimit` cannot hold.
 *
 * `docs/BRIEFS.md` B3: "A **named hip/shoulder sign gate** is owed in `src/solve/swingTwist.ts`:
 * `RomLimit`'s cone cannot hold doc 06 §3.1's asymmetric limits, and they must not be smuggled
 * into `RomLimit`."
 *
 * "Smuggled in" is the failure mode to avoid: widening `swingConeXDeg` to 175 so a legal shoulder
 * flexion passes the cone ALSO admits 175° of extension, which is what the tight authoring rule
 * exists to prevent. The signed limits therefore live here, read from `ROM_SIGNED`, and are
 * asserted rather than enforced — a violation is a SOLVER BUG, not a pose to be silently fixed.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** The A joints. Mid joints (knee, elbow) are handled by `TwoBoneArgs.midMin/MaxDeg` in step 2. */
export const SIGN_GATED_BONES: readonly BoneName[] = Object.freeze([
  'thigh_L', 'thigh_R', 'upperarm_L', 'upperarm_R',
]);

export interface SignGateViolation {
  readonly bone: BoneName;
  readonly dof: 'swing1' | 'swing2' | 'twist';
  readonly gotDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
}

/**
 * Check one bone's local quaternion against doc 06 §3.1's SIGNED limits. Returns the violations;
 * an empty array is a pass. Pure — it never modifies `q`.
 *
 * The swing is resolved onto the two perpendicular axes `ROM_PERP_AXES` names, so `swing1` and
 * `swing2` mean the same thing here as in `ROM_SIGNED`.
 */
export function checkSignGate(
  bone: BoneName,
  q: Quaternion,
  tolDeg = 1e-6,
): readonly SignGateViolation[] {
  const axis = primaryAxisWorld(bone);
  const st = splitSwingTwist(q, axis);
  const dofs = ROM_SIGNED[bone];
  const out: SignGateViolation[] = [];

  perpBasis(axis);
  const s1 = st.swingDeg * (st.swingAxis[0] * _perp1.x + st.swingAxis[1] * _perp1.y + st.swingAxis[2] * _perp1.z);
  const s2 = st.swingDeg * (st.swingAxis[0] * _perp2.x + st.swingAxis[1] * _perp2.y + st.swingAxis[2] * _perp2.z);

  const check = (dof: SignGateViolation['dof'], got: number, r: { minDeg: number; maxDeg: number }) => {
    if (got < r.minDeg - tolDeg || got > r.maxDeg + tolDeg) {
      out.push({ bone, dof, gotDeg: got, minDeg: r.minDeg, maxDeg: r.maxDeg });
    }
  };
  check('swing1', s1, dofs.swing1);
  check('swing2', s2, dofs.swing2);
  check('twist', st.twistDeg, dofs.twist);
  return out;
}

/**
 * S12's exit invariant for the A joints. Throws naming the bone, the DOF and the numbers.
 *
 * `tolDeg` defaults to 1.0: `ROM_SIGNED` is doc 06 §3.1's *kata clamp* column, and the solve
 * targets stance/technique geometry that sits inside it by design, so a degree of slack absorbs
 * the swing-twist round trip without hiding a real excursion.
 */
export function assertSignGate(
  bone: BoneName,
  q: Quaternion,
  where: string,
  tolDeg = 1.0,
): void {
  const bad = checkSignGate(bone, q, tolDeg);
  if (bad.length === 0) return;
  const v = bad[0]!;
  throw new Error(
    `sign gate FAILED at ${where}: ${v.bone}.${v.dof} = ${v.gotDeg.toFixed(2)}deg, ` +
      `doc 06 §3.1 allows [${v.minDeg}, ${v.maxDeg}] (RomLimit's symmetric cone cannot express this)`,
  );
}

/** The perpendicular-axis pairing, re-exported so the stage asserts read one source. */
export { ROM_PERP_AXES };
