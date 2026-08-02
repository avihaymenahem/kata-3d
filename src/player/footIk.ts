/**
 * B6 PLAYER — `src/player/footIk.ts` — foot planting for the retargeted capture.
 *
 * ═══ WHY THIS EXISTS ═════════════════════════════════════════════════════════════════════════
 *
 * `retargetBvhClip` grounds the capture with ONE CONSTANT LIFT on the pelvis, chosen so that the
 * 25th percentile of the performance's lower-foot height lands on the target's bind ankle (see the
 * `GROUND_PERCENTILE` block there). That constant is the best a bake can do, and a constant cannot
 * track per-frame variation — so it doesn't. Measured over `heian-nidan` at 60 Hz, on the 192 mesh
 * vertices skinned ≥ 0.5 to `DEF-foot*`/`DEF-toe*`, the lowest point of the mesh runs:
 *
 *     mean −0.013 m, min −0.204 m (shins through the floor), max +0.055 m (gliding).
 *
 * Both ends are visible: a quarter-metre of leg disappears into the boards during the deep stances,
 * and the figure skates through the transitions. 17.4 % of the frames where the support foot is in
 * contact also slide it more than 5 mm horizontally between consecutive frames.
 *
 * None of that is a retarget bug. It is what happens when a 20-joint capture of one body's
 * proportions is replayed on another body's leg lengths: the ERROR IS PER-FRAME, so the correction
 * has to be per-frame too, and it has to be applied after the mixer has written the pose.
 *
 * ═══ THE SHAPE OF THE FIX ════════════════════════════════════════════════════════════════════
 *
 * Three passes, in this order, every frame:
 *
 *   1. GROUND SET — which foot is on the floor. Height plus speed, the standard cue, but height is
 *      measured RELATIVE TO THE LOWER OF THE TWO SOLES rather than against an absolute threshold.
 *      That distinction is load-bearing: on the frames where the whole body floats 55 mm, an
 *      absolute "sole below 25 mm" test finds NO planted foot at all — which is precisely the case
 *      the module exists to correct.
 *
 *   2. PELVIS — shift the hips vertically so the HIGHEST foot of the ground set lands exactly on the
 *      floor. Anchoring on the highest (not the lowest, and not the average) is what makes the pass
 *      safe: every other planted foot is then at or below the floor, so every leg the solver touches
 *      is asked to move its ankle UP, i.e. to SHORTEN. A leg that only ever shortens cannot
 *      hyperextend, and the "no reach left" case that would force a knee straight simply does not
 *      arise. With one foot down — most of a kata — the residual is zero and the legs are not
 *      touched at all: the entire correction is a rigid vertical slide of the body, which is the
 *      minimum-distortion answer.
 *
 *   3. LEGS — analytic two-bone IK per planted leg for the residual height, plus a world-space XZ
 *      latch that kills the slide.
 *
 * ═══ WHY ANALYTIC TWO-BONE AND NOT CCDIKSolver ═══════════════════════════════════════════════
 *
 * three ships `examples/jsm/animation/CCDIKSolver.js`, and CCD is the wrong tool for a leg. It is
 * iterative, so the pose it converges to depends on the pose it started from and on the iteration
 * count; it has no notion of a bend plane, so a knee is free to drift sideways or pop through
 * straight between two frames that look nearly identical; and it needs per-joint angle limits to be
 * safe at all, which means inventing limits for a rig that ships none. A hip/knee/ankle chain has a
 * CLOSED FORM — the law of cosines on a triangle whose three side lengths are known — and the closed
 * form is exact in one step, frame-rate independent, and reproducible.
 *
 * ═══ THE POLE VECTOR IS NOT INVENTED ═════════════════════════════════════════════════════════
 *
 * The one free parameter of a two-bone solve is which way the knee points. Every rig-agnostic guess
 * for it (the character's forward, the hip's local +Z, a fixed world axis) is a guess about bone
 * axis conventions, and this codebase has already paid for one of those: Rigify keeps Blender's
 * bone-local frames, where the PELVIS'S OWN "UP" IS LOCAL +Z. So the bend plane is READ FROM THE
 * ANIMATED POSE instead — `cross(ankle − hip, knee − hip)`, recomputed every frame from world
 * positions. The capture already knows where the knee goes; the solver's job is to not lose it.
 * Only if that cross product degenerates (a perfectly straight leg) does the last good normal get
 * reused, seeded at construction from the bind pose, which carries 2.26° of bend and so is a
 * well-defined seed rather than a coin flip.
 *
 * ═══ MEASURED RIG FACTS THE CODE LEANS ON ════════════════════════════════════════════════════
 *
 * Read off the Rigify bind pose via `skeleton.boneInverses` (metres, character 1.829 m tall):
 *
 *     DEF-thigh -> DEF-shin   0.4003      DEF-foot (ankle) world Y   0.1037
 *     DEF-shin  -> DEF-foot   0.4295      DEF-toe  (ball)  world Y   0.0152
 *
 * The ankle joint centre sits 104 mm ABOVE the sole, so "planted" means the ankle reads ≈ 0.104,
 * never 0 — driving the ankle itself to the floor buries the foot to the shin.
 *
 * A FOOT IS NOT A POINT, and pretending otherwise costs real millimetres. The sole geometry of this
 * mesh runs from z = −0.098 to z = +0.205 in bind space against an ankle at z = −0.036 and a ball
 * bone at z = +0.113 — so the toe tip reaches 92 mm PAST the joint that carries it and the heel
 * 62 mm behind the ankle. Tracking only the two joint origins, the first version of this file left
 * the mesh 66 mm through the floor, and 901 of the 906 offending frames were the toe tip on a
 * pitched foot. Contact is therefore sampled at THREE points — heel, ball, tip — and the lowest wins.
 * That is also what lets a heel-raised foot pivot on its ball without the module deciding it has
 * left the ground.
 */

import { Matrix4, Quaternion, Vector3, type Bone, type Skeleton } from 'three';

import type { Character } from './character';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The pure core — no bones, no scene graph, unit-testable in Node
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Result slot for {@link solveTwoBone}. Caller-owned so the per-frame path allocates nothing. */
export interface TwoBoneOut {
  /** The hip bone's new WORLD rotation. */
  readonly hipWorld: Quaternion;
  /** The knee bone's new WORLD rotation, with the hip's aim already folded in. */
  readonly kneeWorld: Quaternion;
  /** The bend-plane normal actually used. Feed it back as next frame's `poleFallback`. */
  readonly bendAxis: Vector3;
  /** True when the target was out of reach and was pulled in to the chain's limit. */
  clamped: boolean;
  /** Hip-to-ankle distance the solve actually produced, after clamping (m). */
  reachedDist: number;
}

export function createTwoBoneOut(): TwoBoneOut {
  return {
    hipWorld: new Quaternion(),
    kneeWorld: new Quaternion(),
    bendAxis: new Vector3(0, 0, 1),
    clamped: false,
    reachedDist: 0,
  };
}

const _ab = new Vector3();
const _cb = new Vector3();
const _ac = new Vector3();
const _at = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _r0 = new Quaternion();
const _r1 = new Quaternion();
const _r2 = new Quaternion();

/** `acos` on a cosine that floating point may have pushed a few ulp outside [−1, 1]. */
const acosSafe = (x: number): number => Math.acos(x < -1 ? -1 : x > 1 ? 1 : x);

/**
 * Analytic two-bone IK, solved entirely in WORLD space.
 *
 * ═══ THE SOLVE, IN THREE ROTATIONS ═══════════════════════════════════════════════════════════
 *
 * Write `a` for the hip, `b` for the knee, `c` for the ankle, `t` for the target, and take the two
 * segment lengths `l1 = |b − a|`, `l2 = |c − b|` from the CURRENT pose rather than from a cached
 * bind measurement — they are constant on a rig with no animated bone translations, and reading
 * them live means a rig that does animate them is still solved correctly instead of subtly wrong.
 *
 *   R0 = rotate(bendAxis, ∠(a: c,b)_new − ∠(a: c,b)_old)   on the thigh — opens/closes the triangle
 *   R1 = rotate(bendAxis, ∠(b: a,c)_new − ∠(b: a,c)_old)   on the shin  — the matching knee angle
 *   R2 = minimalArc(c − a  ->  t − a)                      on the thigh — aims the finished leg
 *
 * Both new angles come from the law of cosines on the triangle `(l1, l2, |t − a|)`, so after R0 and
 * R1 the ankle sits at distance `|t − a|` from the hip ALONG THE OLD DIRECTION `c − a`; R2 then
 * swings that whole triangle onto the target. The order matters and the composition is
 * `R2 · R1 · R0` in world space — R0 and R1 share an axis and therefore commute, which is why the
 * shin can be written without first re-running forward kinematics on the thigh.
 *
 * `bendAxis = cross(c − a, b − a)` IS the pole vector, taken from the animated pose. Rotating
 * `c − a` about it by the positive interior angle lands on `b − a`, so a positive R0 always swings
 * the knee the way it is already bent. The knee cannot invert: doing so would require the interior
 * angle to pass through 0 or π, and both new angles are `acos` of a clamped cosine on a triangle
 * whose sides are clamped strictly inside `[|l1 − l2|, l1 + l2]`.
 *
 * The reach clamp is `max(maxReach · (l1 + l2), |c − a|)` and not simply `maxReach · (l1 + l2)`.
 * The lower bound matters: this rig's bind leg is 99.93 % extended (0.8292 m of a possible
 * 0.8298 m), so a bare 0.995 ceiling would SHORTEN an already-correct standing leg by 4 mm and put
 * a visible bend in a knee nobody asked to bend.
 *
 * @param poleFallback bend normal to reuse when the current pose is too straight to define one.
 * @param maxReach     fraction of `l1 + l2` the target may sit at. 1 would allow a locked knee.
 */
export function solveTwoBone(
  hip: Vector3,
  knee: Vector3,
  ankle: Vector3,
  target: Vector3,
  hipWorld: Quaternion,
  kneeWorld: Quaternion,
  poleFallback: Vector3,
  maxReach: number,
  out: TwoBoneOut,
): void {
  _ab.copy(knee).sub(hip);
  _cb.copy(ankle).sub(knee);
  _ac.copy(ankle).sub(hip);
  _at.copy(target).sub(hip);

  const l1 = _ab.length();
  const l2 = _cb.length();
  const acLen = _ac.length();
  const want = _at.length();

  out.bendAxis.copy(_ac).cross(_ab);
  if (out.bendAxis.lengthSq() < 1e-12) out.bendAxis.copy(poleFallback).normalize();
  else out.bendAxis.normalize();

  /* A degenerate chain has no triangle to solve. Passing the pose through untouched is the only
   * honest answer — the alternative is to emit some arbitrary rotation and call it IK. */
  if (l1 < 1e-6 || l2 < 1e-6 || acLen < 1e-6 || want < 1e-6) {
    out.hipWorld.copy(hipWorld);
    out.kneeWorld.copy(kneeWorld);
    out.clamped = false;
    out.reachedDist = acLen;
    return;
  }

  const span = l1 + l2;
  const hiLimit = Math.min(span - 1e-5, Math.max(maxReach * span, acLen));
  const loLimit = Math.abs(l1 - l2) + 1e-5;
  out.clamped = want > hiLimit + 1e-9 || want < loLimit - 1e-9;
  const lat = want > hiLimit ? hiLimit : want < loLimit ? loLimit : want;
  out.reachedDist = lat;

  const acAb0 = acosSafe((l1 * l1 + acLen * acLen - l2 * l2) / (2 * l1 * acLen));
  const acAb1 = acosSafe((l1 * l1 + lat * lat - l2 * l2) / (2 * l1 * lat));
  const baBc0 = acosSafe((l1 * l1 + l2 * l2 - acLen * acLen) / (2 * l1 * l2));
  const baBc1 = acosSafe((l1 * l1 + l2 * l2 - lat * lat) / (2 * l1 * l2));

  _r0.setFromAxisAngle(out.bendAxis, acAb1 - acAb0);
  _r1.setFromAxisAngle(out.bendAxis, baBc1 - baBc0);
  _u.copy(_ac).divideScalar(acLen);
  _v.copy(_at).divideScalar(want);
  _r2.setFromUnitVectors(_u, _v);

  out.hipWorld.copy(hipWorld).premultiply(_r0).premultiply(_r2);
  /* The shin inherits R0 and R2 through its parent in the scene graph, but this is a WORLD rotation
   * and the caller turns it back into a local one against the shin's live parent — so both have to
   * be present here or the aim would be applied twice, once by the graph and once by the caller. */
  out.kneeWorld.copy(kneeWorld).premultiply(_r1).premultiply(_r0).premultiply(_r2);
}

/**
 * Pull `target` inside a sphere of radius `maxDist` about `hip`, SPENDING THE HORIZONTAL AXIS FIRST.
 * Returns true when it had to move.
 *
 * ═══ WHY NOT JUST SCALE THE WHOLE OFFSET ═════════════════════════════════════════════════════
 *
 * The obvious clamp — shorten `target − hip` uniformly — pulls the ankle up the line toward the hip,
 * which raises it off the floor. Measured with that clamp and a loosened XZ latch, the planted sole
 * floated as high as 34 mm on this clip, trading the exact defect this module exists to remove for
 * a slightly steadier foot.
 *
 * The two things being clamped are not worth the same. Height is the whole point; the horizontal
 * latch is an anti-slide nicety, and when the body has genuinely walked further than the leg is
 * long, the honest answer is that the foot slides — a real karateka's does too. So the target keeps
 * its Y and gives up horizontal radius: `r = sqrt(maxDist² − dy²)`. Only when the leg cannot reach
 * the floor at ANY horizontal offset (`|dy| ≥ maxDist`) does it fall back to scaling everything,
 * and by then the pelvis pass has already failed to keep the body in range.
 */
export function clampToReach(hip: Vector3, target: Vector3, maxDist: number, out: Vector3): boolean {
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const dz = target.z - hip.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 <= maxDist * maxDist) {
    out.copy(target);
    return false;
  }
  const r = Math.sqrt(dx * dx + dz * dz);
  const room = maxDist * maxDist - dy * dy;
  /* `room === 0` is a VALID height-preserving answer, not a degenerate one: it means the leg is
   * exactly long enough to reach that depth and must therefore stand directly under the hip, which
   * `k = 0` produces. Rejecting it — as this did at first — sent a fully extended leg down the
   * uniform-scaling path and lifted the foot off the floor, the exact defect the branch exists to
   * avoid. Only a genuinely unreachable DEPTH (`|dy| > maxDist`, i.e. `room < 0`) has no answer. */
  if (room >= 0 && r > 1e-9) {
    const k = Math.sqrt(room) / r;
    out.set(hip.x + dx * k, target.y, hip.z + dz * k);
  } else {
    const k = maxDist / Math.sqrt(d2);
    out.set(hip.x + dx * k, hip.y + dy * k, hip.z + dz * k);
  }
  return true;
}

/**
 * A contact flag with hysteresis and a blend ramp.
 *
 * `on` is the raw decision; `w` is what the solver actually weights by. The ramp exists because a
 * plant that engages in one frame moves the ankle by however much the pose was wrong — up to 190 mm
 * on this clip — and that reads as a snap. Ramping over `blendS` turns it into a settle.
 */
export interface Latch {
  on: boolean;
  w: number;
}

export function createLatch(): Latch {
  return { on: false, w: 0 };
}

/**
 * Advance a latch. `enter` and `exit` are evaluated against DIFFERENT thresholds by the caller and
 * must not both hold — that is the whole point of hysteresis, and a caller that lets them overlap
 * gets a flag that flickers at the frame rate.
 */
export function stepLatch(latch: Latch, enter: boolean, exit: boolean, dtS: number, blendS: number): void {
  if (latch.on) {
    if (exit) latch.on = false;
  } else if (enter) {
    latch.on = true;
  }
  const step = blendS > 1e-6 ? dtS / blendS : 1;
  latch.w = latch.on ? Math.min(1, latch.w + step) : Math.max(0, latch.w - step);
}

/**
 * Where the pelvis has to go so that no planted foot is left above the floor.
 *
 * `needs[i]` is how far foot `i` must move UP to put its sole on the floor — positive when it is
 * buried, negative when it is floating. The answer is the MINIMUM, i.e. the foot that needs the
 * least lift, i.e. the highest one.
 *
 * That choice is the module's safety property, so it is worth stating plainly: after shifting the
 * body by `min(needs)`, every planted foot's remaining correction is `needs[i] − min(needs) ≥ 0`.
 * Every leg the IK then touches is asked to raise its ankle, which shortens the hip-to-ankle
 * distance, which can only ever bend a knee further. Taking the mean, or the lowest foot, would
 * leave some leg with a negative residual — an ankle to be pushed DOWN and away — and that is the
 * one request a two-bone chain answers by locking its knee straight.
 */
export function groundAnchor(needs: readonly number[]): number {
  if (needs.length === 0) return 0;
  let m = needs[0]!;
  for (let i = 1; i < needs.length; i++) if (needs[i]! < m) m = needs[i]!;
  return m;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Options
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface FootIkOpts {
  /** World Y of the dojo floor. The stage paints it at 0 and the character root rides on it. */
  readonly floorY?: number;
  /** Start switched off, for an A/B toggle. */
  readonly enabled?: boolean;

  /**
   * How far ABOVE THE LOWER SOLE a foot may sit and still count as on the floor / stop counting.
   *
   * Relative, not absolute, because the body's own vertical error is the thing being corrected —
   * see the header. 0.035 m grabs both feet of a settled stance (a Shotokan stance is flat-footed on
   * both sides) while leaving the 0.21 m median lift of a swinging foot well outside.
   */
  readonly groundWindowM?: number;
  readonly groundReleaseM?: number;
  /**
   * Above this the LOWER sole is airborne and nothing is planted — the guard against gluing a
   * jumping figure to the floor. Measured: the lower sole of `heian-nidan` never exceeds +0.076 m,
   * so 0.12 m rejects a real jump without ever rejecting a real stance in this kata.
   */
  readonly airborneSoleM?: number;

  /**
   * Horizontal ankle speed gates for the XZ latch, m/s.
   *
   * Measured on this clip over the frames where the sole is under 25 mm: median 0.116, p75 0.329,
   * p90 1.031. The pair straddles that shoulder — 0.45 in sits between p75 and p90 and admits the
   * settled part of the distribution; 1.2 out sits just past p90, so the latch survives an ordinary
   * pivot and lets go of a genuine step.
   *
   * These are the SECONDARY gate. `ground` releases the latch first whenever the foot leaves the
   * floor, which is what actually ends most plants, and that is why an entry threshold this
   * generous does not glue a stepping foot down. Swept against the whole clip: 0.25/0.60 leaves
   * 11.4 % of contact frames sliding, 0.45/1.2 leaves 8.0 %, 0.60/1.5 leaves 6.9 % — the last of
   * those buys 1 point by holding through motion no reading of the distribution justifies calling
   * planted, so 0.45/1.2 is where this stops.
   */
  readonly lockSpeedMs?: number;
  readonly lockReleaseSpeedMs?: number;
  /** Drop the latch once the animation has walked this far from it — the body really did move. */
  readonly maxLockDriftM?: number;

  /**
   * Where the sole's back and front edges sit, as fractions of the ankle-to-ball run.
   *
   * Expressed as fractions rather than metres so they survive a differently-sized character.
   * Measured off this mesh's own sole vertices against its 0.149 m ankle-to-ball run: the heel
   * reaches 0.0619 m behind the ankle (0.415) and the toe tip 0.0922 m past the ball bone (0.619).
   * Both are ordinary human proportions, not a quirk of this model.
   */
  readonly heelFrac?: number;
  readonly toeTipFrac?: number;

  /** Ramp for both latches, seconds. */
  readonly blendS?: number;

  /** Exponential time constant on the pelvis shift, seconds. */
  readonly pelvisTauS?: number;
  /** Absolute ceiling on the pelvis correction. A bad frame must not launch the figure. */
  readonly maxPelvisShiftM?: number;
  /** Rate ceiling on the pelvis correction, m/s. */
  readonly maxPelvisRateMs?: number;

  /** Fraction of `thigh + shin` the ankle target may sit at. Below 1 so a knee never locks. */
  readonly maxReach?: number;
  /** Latch the planted foot's world XZ. Off leaves vertical grounding only. */
  readonly lockXZ?: boolean;
  /**
   * Put the foot back on the world orientation the animation gave it after the leg has moved.
   *
   * The solver rotates the thigh, and the foot is downstream of it, so a 40 mm ankle lift also rolls
   * the sole by a few degrees — the foot ends up standing on an edge. The capture's own foot
   * orientation is the right one to keep; the IK's business is where the ankle is, not which way it
   * points.
   */
  readonly preserveFootOrientation?: boolean;
}

interface ResolvedOpts {
  floorY: number;
  groundWindowM: number;
  groundReleaseM: number;
  airborneSoleM: number;
  lockSpeedMs: number;
  lockReleaseSpeedMs: number;
  maxLockDriftM: number;
  heelFrac: number;
  toeTipFrac: number;
  blendS: number;
  pelvisTauS: number;
  maxPelvisShiftM: number;
  maxPelvisRateMs: number;
  maxReach: number;
  lockXZ: boolean;
  preserveFootOrientation: boolean;
}

export const FOOT_IK_DEFAULTS: Readonly<ResolvedOpts> = Object.freeze({
  floorY: 0,
  groundWindowM: 0.035,
  groundReleaseM: 0.075,
  airborneSoleM: 0.12,
  lockSpeedMs: 0.45,
  lockReleaseSpeedMs: 1.2,
  maxLockDriftM: 0.12,
  heelFrac: 0.415,
  toeTipFrac: 0.619,
  blendS: 0.1,
  pelvisTauS: 0.045,
  maxPelvisShiftM: 0.3,
  maxPelvisRateMs: 3,
  maxReach: 0.995,
  lockXZ: true,
  preserveFootOrientation: true,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Handle
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface FootIkLegStats {
  readonly side: 'L' | 'R';
  /** 0..1 — this foot's share of the vertical grounding. */
  readonly groundWeight: number;
  /** 0..1 — how engaged the world-space XZ latch is. */
  readonly lockWeight: number;
  /** Sole height above the floor as the ANIMATION left it, before this frame's correction (m). */
  readonly soleY: number;
  /** True when the ankle target was out of the leg's reach and had to be pulled in. */
  readonly reachClamped: boolean;
}

export interface FootIkStats {
  readonly enabled: boolean;
  /** Vertical pelvis correction currently applied, metres. Positive lifts the body. */
  readonly pelvisShiftM: number;
  /** Empty when the rig gave up no usable leg — the pass is then inert, not throwing. */
  readonly legs: readonly FootIkLegStats[];
  readonly frames: number;
}

export interface FootIk {
  /**
   * Solve one frame. Call AFTER `character.update(dt)` and AFTER
   * `character.root.updateMatrixWorld(true)` — this reads world matrices and writes bone locals,
   * so anything that re-poses the skeleton afterwards silently undoes it.
   *
   * `dtS` drives the speed cue, the latch ramps and the pelvis filter; it defaults to a 60 Hz frame
   * so `update()` with no argument still behaves, but passing the real delta is what makes the
   * thresholds mean what their units say at any frame rate.
   */
  update(dtS?: number): void;
  /** Switch the pass off (restoring the animated pose) or back on. For an A/B toggle in the HUD. */
  setEnabled(on: boolean): void;
  dispose(): void;
  readonly stats: FootIkStats;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Implementation
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface Leg {
  readonly side: 'L' | 'R';
  readonly thigh: Bone;
  readonly calf: Bone;
  readonly foot: Bone;
  readonly ball: Bone | null;
  /** Back and middle sole contact points at bind, in the FOOT bone's own frame. */
  readonly heelLocal: Vector3;
  readonly ballLocal: Vector3;
  /** Front sole contact point at bind, in the BALL bone's frame. Null when the rig has no toe. */
  readonly tipLocal: Vector3 | null;
  readonly ground: Latch;
  readonly lock: Latch;
  /** World XZ captured when `lock` engaged; y unused. */
  readonly lockAt: Vector3;
  /** Previous frame's ANIMATED ankle world position — never the solved one. See the note at use. */
  readonly prevAnkle: Vector3;
  hasPrev: boolean;
  /** Last non-degenerate bend-plane normal, world space. Seeded from bind. */
  readonly pole: Vector3;
  soleY: number;
  clamped: boolean;
}

/** One bone-local channel this module overwrote, and what was there before. */
interface WrittenQuat {
  readonly bone: Bone;
  readonly before: Quaternion;
  readonly after: Quaternion;
  live: boolean;
}

const _p = new Vector3();
const _p2 = new Vector3();
const _scale = new Vector3();
const _wq = new Quaternion();
const _wq2 = new Quaternion();
const _tmpV = new Vector3();
const _tmpQ = new Quaternion();
const _mat = new Matrix4();
const _hip = new Vector3();
const _knee = new Vector3();
const _hipQ = new Quaternion();
const _kneeQ = new Quaternion();
const _footQ = new Quaternion();

/** The character's skeleton, wherever the loader put it. `null` if it has no skinned mesh at all. */
function skeletonOf(character: Character): Skeleton | null {
  let found: Skeleton | null = null;
  character.root.traverse((o) => {
    if (found === null && (o as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) {
      found = (o as unknown as { skeleton: Skeleton }).skeleton;
    }
  });
  return found;
}

/**
 * Bind-pose world position and rotation of one bone, from `boneInverses`.
 *
 * Taken from the inverse bind matrices rather than by reading live bones, for the same reason
 * `retarget.ts` does: the inverse bind matrix IS the bind pose by definition and is immune to
 * whatever clip happens to be playing, so construction is safe mid-animation. `null` when the bone
 * is not skinned by this skeleton, which is a real possibility on a rig with helper joints.
 */
function bindOf(skeleton: Skeleton, bone: Bone): { p: Vector3; m: Matrix4 } | null {
  const i = skeleton.bones.indexOf(bone);
  if (i < 0) return null;
  const inv = skeleton.boneInverses[i];
  if (inv === undefined) return null;
  const m = new Matrix4().copy(inv).invert();
  return { p: new Vector3().setFromMatrixPosition(m), m };
}

/**
 * Create the foot-IK pass for `character`.
 *
 * Never throws. A rig that maps no legs, or has no skeleton, yields a handle whose `update()` is a
 * no-op and whose `stats.legs` is empty — a viewer that quietly keeps the un-grounded pose is a far
 * better failure than one that will not boot, and `stats` says which happened.
 */
export function createFootIk(character: Character, opts: FootIkOpts = {}): FootIk {
  const o: ResolvedOpts = {
    floorY: opts.floorY ?? FOOT_IK_DEFAULTS.floorY,
    groundWindowM: opts.groundWindowM ?? FOOT_IK_DEFAULTS.groundWindowM,
    groundReleaseM: opts.groundReleaseM ?? FOOT_IK_DEFAULTS.groundReleaseM,
    airborneSoleM: opts.airborneSoleM ?? FOOT_IK_DEFAULTS.airborneSoleM,
    lockSpeedMs: opts.lockSpeedMs ?? FOOT_IK_DEFAULTS.lockSpeedMs,
    lockReleaseSpeedMs: opts.lockReleaseSpeedMs ?? FOOT_IK_DEFAULTS.lockReleaseSpeedMs,
    maxLockDriftM: opts.maxLockDriftM ?? FOOT_IK_DEFAULTS.maxLockDriftM,
    heelFrac: opts.heelFrac ?? FOOT_IK_DEFAULTS.heelFrac,
    toeTipFrac: opts.toeTipFrac ?? FOOT_IK_DEFAULTS.toeTipFrac,
    blendS: opts.blendS ?? FOOT_IK_DEFAULTS.blendS,
    pelvisTauS: opts.pelvisTauS ?? FOOT_IK_DEFAULTS.pelvisTauS,
    maxPelvisShiftM: opts.maxPelvisShiftM ?? FOOT_IK_DEFAULTS.maxPelvisShiftM,
    maxPelvisRateMs: opts.maxPelvisRateMs ?? FOOT_IK_DEFAULTS.maxPelvisRateMs,
    maxReach: opts.maxReach ?? FOOT_IK_DEFAULTS.maxReach,
    lockXZ: opts.lockXZ ?? FOOT_IK_DEFAULTS.lockXZ,
    preserveFootOrientation: opts.preserveFootOrientation ?? FOOT_IK_DEFAULTS.preserveFootOrientation,
  };

  const skeleton = skeletonOf(character);
  const pelvis = character.boneFor('pelvis');

  const legs: Leg[] = [];
  if (skeleton !== null) {
    for (const side of ['L', 'R'] as const) {
      const thigh = character.boneFor(`thigh_${side}`);
      const calf = character.boneFor(`calf_${side}`);
      const foot = character.boneFor(`foot_${side}`);
      const ball = character.boneFor(`ball_${side}`);
      /* An unmapped joint disables THAT LEG, not the pass. `boneFor` returns null for any contract
       * name the loaded rig has no counterpart for, and half a grounded character is strictly
       * better than none — the other leg still carries the pelvis correction. */
      if (thigh === null || calf === null || foot === null) continue;

      const bThigh = bindOf(skeleton, thigh);
      const bCalf = bindOf(skeleton, calf);
      const bFoot = bindOf(skeleton, foot);
      const bBall = ball === null ? null : bindOf(skeleton, ball);
      if (bThigh === null || bCalf === null || bFoot === null) continue;

      /**
       * ═══ THE THREE SOLE POINTS ═════════════════════════════════════════════════════════════
       *
       * Built in BIND SPACE at y = 0, which is the BIND floor — the bind pose is standing on it, as
       * its 0.1037 m ankle (a joint centre above a sole at zero) says — then pushed back through
       * each carrying bone's inverse bind matrix so they become fixed points in that bone's own
       * frame. From then on `bone.matrixWorld * point` gives their world position for free, and no
       * step of it assumes anything about which local axis means "up" — which on this Rigify rig it
       * had better not, since the pelvis's own up is local +Z.
       *
       * Deliberately NOT `o.floorY`: that is a WORLD height, and these points live in bind space.
       * The two happen to agree here (the mesh's world matrix is a pure yaw plus an XZ translation,
       * and its `bindMatrix` is identity), which is exactly why mixing them up would go unnoticed
       * until someone raised the dojo floor.
       *
       * Laid out along the horizontal ankle-to-ball run, which is the foot's own forward direction
       * however the rig happens to orient it. The heel and ball ride the FOOT bone; the tip rides
       * the BALL bone, because that is the joint the toes actually hinge on.
       */
      const fwd = new Vector3().subVectors(bBall?.p ?? bFoot.p, bFoot.p);
      fwd.y = 0;
      const run = fwd.length();
      if (run > 1e-4) fwd.divideScalar(run);
      const bindInvFoot = new Matrix4().copy(bFoot.m).invert();
      const heelLocal = new Vector3(bFoot.p.x, 0, bFoot.p.z)
        .addScaledVector(fwd, -o.heelFrac * run)
        .applyMatrix4(bindInvFoot);
      const ballLocal = new Vector3(
        bBall?.p.x ?? bFoot.p.x,
        0,
        bBall?.p.z ?? bFoot.p.z,
      ).applyMatrix4(bindInvFoot);
      const tipLocal =
        bBall === null
          ? null
          : new Vector3(bBall.p.x, 0, bBall.p.z)
              .addScaledVector(fwd, o.toeTipFrac * run)
              .applyMatrix4(_mat.copy(bBall.m).invert());

      /* Seed the pole from bind: cross(ankle − hip, knee − hip). This rig's bind leg carries 2.26°
       * of knee bend, enough for a stable normal, and it is only ever consulted on the frames where
       * the animated pose is too straight to supply one. */
      const pole = new Vector3()
        .copy(bFoot.p)
        .sub(bThigh.p)
        .cross(_tmpV.copy(bCalf.p).sub(bThigh.p));
      if (pole.lengthSq() < 1e-12) pole.set(1, 0, 0);
      pole.normalize();

      legs.push({
        side,
        thigh,
        calf,
        foot,
        ball: bBall === null ? null : ball,
        heelLocal,
        ballLocal,
        tipLocal,
        ground: createLatch(),
        lock: createLatch(),
        lockAt: new Vector3(),
        prevAnkle: new Vector3(),
        hasPrev: false,
        pole,
        soleY: 0,
        clamped: false,
      });
    }
  }

  const out = createTwoBoneOut();
  const needs: number[] = [];

  /* ── the "did the animation overwrite us?" ledger ──────────────────────────────────────────
   *
   * Every bone this module writes is also written by the mixer on the next frame, because the
   * retargeted clip bakes a track for EVERY bone of the target skeleton (see the constant-key block
   * at the end of `retargetBvhClip`). That is true today and it is not something this file can
   * enforce: a clip missing a track for, say, `DEF-shinR` leaves last frame's correction on the
   * bone, and the next correction composes on top of it — a leg that curls up over a few seconds.
   *
   * So the write is remembered along with what it replaced, and undone at the top of the next frame
   * IF AND ONLY IF the value is still bit-for-bit ours. If the mixer wrote the bone, the value has
   * moved and there is nothing to undo. Cheap (seven channels), and it makes the pass safe to run
   * against any clip rather than only against the ones that happen to be complete. */
  const written: WrittenQuat[] = [];
  const pelvisWrite = { before: new Vector3(), after: new Vector3(), live: false };

  /**
   * Open (or reopen) the ledger entry for `bone`, recording `before` as the value to roll back to.
   * Returns the entry so the caller can stamp `after` once the new value is actually on the bone —
   * indexing `written` by position instead would go wrong from frame two onward, when the entry is
   * reused in place rather than pushed.
   */
  const rememberQuat = (bone: Bone, before: Quaternion): WrittenQuat => {
    for (const w of written) {
      if (w.bone === bone) {
        w.before.copy(before);
        w.live = true;
        return w;
      }
    }
    const w: WrittenQuat = {
      bone,
      before: before.clone(),
      after: new Quaternion(),
      live: true,
    };
    written.push(w);
    return w;
  };

  /** True when something was actually rolled back, i.e. the world matrices are now stale. */
  const restore = (): boolean => {
    let dirty = false;
    for (const w of written) {
      if (!w.live) continue;
      w.live = false;
      /* Bit-identical, not "close": the mixer writing a value that happens to round to ours is not
       * a case worth guarding, but a near-match test would undo real animation. */
      const c = w.bone.quaternion;
      if (c.x === w.after.x && c.y === w.after.y && c.z === w.after.z && c.w === w.after.w) {
        c.copy(w.before);
        dirty = true;
      }
    }
    if (pelvisWrite.live && pelvis !== null) {
      pelvisWrite.live = false;
      const c = pelvis.position;
      if (c.x === pelvisWrite.after.x && c.y === pelvisWrite.after.y && c.z === pelvisWrite.after.z) {
        c.copy(pelvisWrite.before);
        dirty = true;
      }
    }
    return dirty;
  };

  const legStats = legs.map((l) => ({
    side: l.side,
    groundWeight: 0,
    lockWeight: 0,
    soleY: 0,
    reachClamped: false,
  }));
  const stats = {
    enabled: opts.enabled ?? true,
    pelvisShiftM: 0,
    legs: legStats,
    frames: 0,
  };

  let enabled = opts.enabled ?? true;
  let shift = 0;

  /** Height above the floor of the LOWEST of the three sole contact points — heel, ball, toe tip. */
  const soleHeight = (leg: Leg): number => {
    let y = _tmpV.copy(leg.heelLocal).applyMatrix4(leg.foot.matrixWorld).y;
    const b = _tmpV.copy(leg.ballLocal).applyMatrix4(leg.foot.matrixWorld).y;
    if (b < y) y = b;
    if (leg.ball !== null && leg.tipLocal !== null) {
      const t = _tmpV.copy(leg.tipLocal).applyMatrix4(leg.ball.matrixWorld).y;
      if (t < y) y = t;
    }
    return y;
  };

  const update = (dtS: number = 1 / 60): void => {
    const dirty = restore();
    if (!enabled || legs.length === 0) {
      /* The rollback invalidated the matrices the caller had already computed; leaving them stale
       * would hand the renderer last frame's corrected pose over this frame's animated locals. */
      if (dirty) character.root.updateMatrixWorld(true);
      stats.enabled = enabled;
      return;
    }
    if (dirty) character.root.updateMatrixWorld(true);

    const dt = dtS > 1e-6 ? dtS : 1 / 60;

    /* ── pass 1: which foot is on the floor ───────────────────────────────────────────────── */
    let lowest = Infinity;
    for (const leg of legs) {
      leg.soleY = soleHeight(leg);
      if (leg.soleY < lowest) lowest = leg.soleY;
    }
    const airborne = lowest > o.airborneSoleM;

    needs.length = 0;
    for (const leg of legs) {
      leg.foot.matrixWorld.decompose(_p, _wq, _scale);
      /* The speed cue reads the ANIMATED ankle against the previous frame's ANIMATED ankle. Reading
       * the solved one instead would be a feedback loop: a latched foot has zero measured speed by
       * construction, so it would satisfy its own hold condition forever and never release. */
      const speed = leg.hasPrev
        ? Math.hypot(_p.x - leg.prevAnkle.x, _p.z - leg.prevAnkle.z) / dt
        : 0;

      const rel = leg.soleY - lowest;
      stepLatch(
        leg.ground,
        !airborne && rel <= o.groundWindowM,
        airborne || rel > o.groundReleaseM,
        dt,
        o.blendS,
      );

      const drift = leg.lock.on ? Math.hypot(_p.x - leg.lockAt.x, _p.z - leg.lockAt.z) : 0;
      const wasLocked = leg.lock.on;
      stepLatch(
        leg.lock,
        o.lockXZ && leg.ground.on && speed <= o.lockSpeedMs,
        !leg.ground.on || speed > o.lockReleaseSpeedMs || drift > o.maxLockDriftM,
        dt,
        o.blendS,
      );
      if (leg.lock.on && !wasLocked) leg.lockAt.set(_p.x, _p.y, _p.z);

      leg.prevAnkle.copy(_p);
      leg.hasPrev = true;
      if (leg.ground.on) needs.push(o.floorY - leg.soleY);
    }

    /* ── pass 2: the pelvis ───────────────────────────────────────────────────────────────── */
    let wanted = groundAnchor(needs);
    if (wanted > o.maxPelvisShiftM) wanted = o.maxPelvisShiftM;
    else if (wanted < -o.maxPelvisShiftM) wanted = -o.maxPelvisShiftM;

    /* Frame-rate-independent exponential approach, then a hard rate cap. The filter is what hides
     * the step when the ground set changes — a foot joining or leaving it moves `wanted` by
     * whatever the two feet disagreed about — and the cap is what stops a single bad capture frame
     * from throwing the body. tau 45 ms is ≈ 2.7 frames at 60 Hz: fast enough that the lag against
     * this clip's own hip track stays under 5 mm, slow enough to absorb a set change. */
    const alpha = 1 - Math.exp(-dt / Math.max(1e-4, o.pelvisTauS));
    let next = shift + (wanted - shift) * alpha;
    const maxStep = o.maxPelvisRateMs * dt;
    if (next - shift > maxStep) next = shift + maxStep;
    else if (shift - next > maxStep) next = shift - maxStep;
    shift = next;

    if (pelvis !== null && pelvis.parent !== null && Math.abs(shift) > 1e-6) {
      /* Through the parent's inverse matrix, never by writing metres into `position.y`. Rigify keeps
       * Blender's bone-local axes: this pelvis's local position reads (0, −0.002, 0.917) — its own
       * "up" is local +Z — and its parent carries a rotation of its own. Adding a world metre to
       * component 1 would shift the hips a fraction of a millimetre sideways and change the height
       * not at all. The inverse matrix has no convention to get wrong. */
      pelvisWrite.before.copy(pelvis.position);
      _tmpV.setFromMatrixPosition(pelvis.matrixWorld);
      _tmpV.y += shift;
      _tmpV.applyMatrix4(_mat.copy(pelvis.parent.matrixWorld).invert());
      pelvis.position.copy(_tmpV);
      pelvisWrite.after.copy(_tmpV);
      pelvisWrite.live = true;
      pelvis.updateMatrixWorld(true);
    }

    /* ── pass 3: the legs ─────────────────────────────────────────────────────────────────── */
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      const s = legStats[i]!;
      s.groundWeight = leg.ground.w;
      s.lockWeight = leg.lock.w;
      s.soleY = leg.soleY;
      s.reachClamped = false;
      leg.clamped = false;
      if (leg.ground.w <= 0 && leg.lock.w <= 0) continue;

      /* Re-read after the pelvis moved. The shift is a rigid vertical slide of everything below the
       * hips, so the residual here is exactly `needs[i] − shift` — but measuring it again costs one
       * decompose and cannot drift out of step with what actually happened. */
      const soleNow = soleHeight(leg);
      leg.foot.matrixWorld.decompose(_p, _wq, _scale);
      const lift = (o.floorY - soleNow) * leg.ground.w;

      _tmpV.set(_p.x, _p.y + lift, _p.z);
      if (leg.lock.w > 0) {
        _tmpV.x += (leg.lockAt.x - _p.x) * leg.lock.w;
        _tmpV.z += (leg.lockAt.z - _p.z) * leg.lock.w;
      }

      _hip.setFromMatrixPosition(leg.thigh.matrixWorld);
      _knee.setFromMatrixPosition(leg.calf.matrixWorld);
      leg.thigh.matrixWorld.decompose(_p2, _hipQ, _scale);
      leg.calf.matrixWorld.decompose(_p2, _kneeQ, _scale);
      /* `_wq` still holds the foot's ANIMATED world rotation, read a few lines up and before any of
       * this frame's leg rotations exist. That is the orientation the sole is put back onto. */
      _footQ.copy(_wq);

      /* Clamp here rather than leaving it to the solver, because the POLICY — height beats latch —
       * belongs to foot planting, not to a general two-bone chain. The solver keeps its own clamp
       * as a safety net; with this in front of it, it never fires.
       *
       * The floor of the limit is the leg's CURRENT extension, so a target the animation was
       * already reaching is never pulled in. This rig's bind leg stands 99.93 % extended, and a
       * bare 0.995 ceiling would otherwise put a 4 mm bend in a knee that is simply standing. */
      const reach = Math.max(
        o.maxReach * (_hip.distanceTo(_knee) + _knee.distanceTo(_p)),
        _hip.distanceTo(_p),
      );
      const pulled = clampToReach(_hip, _tmpV, reach, _tmpV);

      solveTwoBone(_hip, _knee, _p, _tmpV, _hipQ, _kneeQ, leg.pole, o.maxReach, out);
      out.clamped = out.clamped || pulled;
      leg.pole.copy(out.bendAxis);
      leg.clamped = out.clamped;
      s.reachClamped = out.clamped;

      /* World rotation -> local, against each bone's LIVE parent. The thigh is solved and its
       * subtree refreshed first, so the shin's parent world below is the post-solve one. */
      if (leg.thigh.parent !== null) {
        leg.thigh.parent.matrixWorld.decompose(_p2, _wq2, _scale);
        _tmpQ.copy(_wq2).invert().multiply(out.hipWorld);
      } else {
        _tmpQ.copy(out.hipWorld);
      }
      const wThigh = rememberQuat(leg.thigh, _wq2.copy(leg.thigh.quaternion));
      leg.thigh.quaternion.copy(_tmpQ);
      leg.thigh.updateMatrixWorld(true);
      wThigh.after.copy(leg.thigh.quaternion);

      if (leg.calf.parent !== null) {
        leg.calf.parent.matrixWorld.decompose(_p2, _wq2, _scale);
        _tmpQ.copy(_wq2).invert().multiply(out.kneeWorld);
      } else {
        _tmpQ.copy(out.kneeWorld);
      }
      const wCalf = rememberQuat(leg.calf, _wq2.copy(leg.calf.quaternion));
      leg.calf.quaternion.copy(_tmpQ);
      leg.calf.updateMatrixWorld(true);
      wCalf.after.copy(leg.calf.quaternion);

      if (o.preserveFootOrientation && leg.foot.parent !== null) {
        leg.foot.parent.matrixWorld.decompose(_p2, _wq2, _scale);
        /* Slerped by how engaged the pass is, so a foot fading in or out of a plant does not snap
         * its ankle roll at the moment the weight crosses zero. */
        _tmpQ.copy(_wq2).invert().multiply(_footQ);
        const wFoot = rememberQuat(leg.foot, _wq2.copy(leg.foot.quaternion));
        leg.foot.quaternion.slerp(_tmpQ, Math.max(leg.ground.w, leg.lock.w));
        leg.foot.updateMatrixWorld(true);
        wFoot.after.copy(leg.foot.quaternion);
      }
    }

    stats.enabled = enabled;
    stats.pelvisShiftM = shift;
    stats.frames++;
  };

  return {
    update,
    setEnabled(on: boolean): void {
      if (on === enabled) return;
      enabled = on;
      stats.enabled = on;
      if (!on) {
        restore();
        character.root.updateMatrixWorld(true);
        shift = 0;
        for (const leg of legs) {
          leg.ground.on = false;
          leg.ground.w = 0;
          leg.lock.on = false;
          leg.lock.w = 0;
          leg.hasPrev = false;
        }
        stats.pelvisShiftM = 0;
      }
    },
    dispose(): void {
      restore();
      character.root.updateMatrixWorld(true);
      written.length = 0;
      legs.length = 0;
      legStats.length = 0;
    },
    stats,
  };
}
