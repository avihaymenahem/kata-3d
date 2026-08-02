/**
 * B6 PLAYER — `src/player/selfCollision.ts` — keeping the karateka's hands out of his own body.
 *
 * ═══ THE DEFECT, MEASURED ════════════════════════════════════════════════════════════════════
 *
 * Swept over the whole of `heian-nidan` at 60 Hz (1 612 frames), against SEGMENTS rather than bone
 * origins — the head as `DEF-head` -> crown, the torso as `DEF-spine001` -> `DEF-spine003`, so the
 * number means the same anatomical thing whatever a rig calls its joints:
 *
 *     left wrist  -> head axis      min 0.010 m  (t = 2.65)     86 frames under 0.10 m
 *     right wrist -> head axis      min 0.008 m  (t = 0.67)
 *     left wrist  -> spine axis     min 0.014 m  (t = 11.48)   194 frames under 0.13 m
 *     left forearm-> head axis      min 0.010 m               115 frames under 0.10 m
 *
 * The skull measures 0.097 m in radius about that axis on this mesh and the ribcage 0.115 m, so a
 * wrist at 0.010 m is not close to the head — it is INSIDE it, past the far side of the skull.
 *
 * ═══ WHOSE FAULT IS IT — THE SOURCE WAS CHECKED FIRST ════════════════════════════════════════
 *
 * Retargeting transfers JOINT ANGLES, and an angle that cleared the performer's ribs need not clear
 * ours. But that is a hypothesis, not a diagnosis, so the SOURCE skeleton was run through the same
 * measurement: `heian-nidan.bvh` forward-kinematicked from its own offsets, scaled to this
 * character's stature by the same thigh + shin + hips-to-head proxy the numbers above use
 * (140.23 source units -> 1.4841 m, k = 0.01058). Both columns are therefore in OUR metres:
 *
 *                                   SOURCE      TARGET
 *     left wrist  -> head axis      0.100       0.010        frames < 0.10 m:  13  ->  86
 *     right wrist -> head axis      0.013       0.008
 *     left wrist  -> spine axis     0.046       0.014        frames < 0.13 m: 191 -> 194
 *     left forearm-> head axis      0.097       0.010        frames < 0.10 m:  44 -> 115
 *
 * Two things follow, and they point at different fixes:
 *
 *   1. THE PROPORTION MISMATCH IS REAL AND IS THE BULK OF IT. Six and a half times as many frames
 *      put a wrist inside the head after retargeting as before, and the worst left-wrist clearance
 *      collapses from a clean 0.100 m to 0.010 m. Segment ratios say exactly where the mismatch is,
 *      and it is NOT the arm: measured against each skeleton's own stature the arms agree to 0.2 %
 *      (0.3686 target vs 0.3678 source; upper arm 0.1849 vs 0.1860, forearm 0.1837 vs 0.1818). What
 *      differs is the TORSO — hips-to-chest 0.2700 vs 0.2202 (+23 %) — and the head stack above the
 *      chest, 0.3477 vs 0.2929 (+19 %). This character has the same arms on a longer body and a
 *      bigger head, so a guard the performer held beside his temple lands inside ours.
 *
 *   2. BUT THE CAPTURE SELF-INTERSECTS TOO. The source's own right wrist passes 0.013 m from its own
 *      head axis at t = 0.67, and its left wrist 0.046 m from its own spine axis at t = 11.98. A
 *      20-joint marker solve has no notion of a solid body either. 13 frames of the source are
 *      already inside the head before this project touches them.
 *
 * ═══ WHY PUSH-OUT AND NOT PROPORTION MATCHING ════════════════════════════════════════════════
 *
 * Point 2 settles it. Scaling the target's segments toward the source's ratios reproduces the
 * performance faithfully — INCLUDING the 13 frames where the performer's own hand was inside his own
 * head. A fix that cannot reach a quarter of the offending moments is not the fix. Point 1 says the
 * same thing from the other side: the arms already match to 0.2 %, so there is nothing to scale
 * there; the mismatch lives in the torso and the head, and "shrink the character's head 19 % to
 * match the performer" changes who the character IS to avoid a contact. Games ship collision
 * push-out for exactly this reason, and this is that.
 *
 * ═══ THE SHAPE OF THE FIX ════════════════════════════════════════════════════════════════════
 *
 * Per arm, per frame, four steps:
 *
 *   1. PROBE. The fist (a sphere carried by the hand bone) and the forearm (a capsule from elbow to
 *      wrist) against six body capsules — head, chest, abdomen, pelvis, and both upper arms.
 *   2. REDUCE TO ONE WRIST DISPLACEMENT. Every contact is converted to "how far would the WRIST have
 *      to move to clear this", divided by how much of that motion the contact point actually
 *      inherits, and the largest wins. Two relaxation passes, so a hand cornered between the chest
 *      and the upper arm resolves against both.
 *   3. EASE. The raw requirement is filtered toward with a 90 ms time constant plus a rate cap.
 *   4. SOLVE. `solveTwoBone` from `./footIk` — the same closed form, the same pole read from the
 *      animated pose — with the correction SHORTENED, never the target clamped, whenever the wrist
 *      would otherwise be pushed past the arm's reach ceiling.
 *
 * ═══ WHAT IT ACTUALLY BOUGHT ═════════════════════════════════════════════════════════════════
 *
 * Same 60 Hz sweep, same metrics, the pass toggled with `setEnabled` so nothing else differs:
 *
 *                                          before      after
 *     left wrist  -> head axis, min        0.010       0.081   m
 *     right wrist -> head axis, min        0.008       0.025   m
 *     left wrist  -> spine axis, min       0.014       0.075   m
 *     left forearm-> spine axis, min       0.011       0.075   m
 *     frames, wrist   < 0.10 m of head       86           8    −91 %
 *     frames, forearm < 0.10 m of head      115          12    −90 %
 *     frames, wrist   < 0.13 m of spine     194          43    −78 %
 *     frames, forearm < 0.13 m of spine     205          44    −79 %
 *
 * Against the SKINNED MESH rather than an axis — every body vertex re-skinned per frame, nearest
 * surface point and its normal — the deepest interpenetration at the worst moments goes 0.069 m ->
 * 0.008 m (t = 8.02, left hand in the neck), 0.066 m -> 0.000 m (t = 2.65, left fist in the crown),
 * 0.034 m -> 0.000 m (t = 13.44).
 *
 * Cost 0.058 ms/frame against `./footIk`'s 0.078 ms. Correction magnitude: mean 15 mm, p90 90 mm,
 * max 183 mm (the ceiling). Jitter — the per-frame change in the applied correction — max 20 mm,
 * i.e. exactly `maxRateMs * dt` and never more, mean 1.8 mm. The elbow's interior angle over the
 * whole clip runs 9.0°–177.2° before and 9.0°–175.7° after: the pass never straightened an elbow
 * past where the animation already had it, and never inverted one.
 *
 * ═══ WHY THE CAPSULES DELIBERATELY UNDER-COVER ═══════════════════════════════════════════════
 *
 * A torso is not round. Measured on this mesh's own vertices, by dominant skin weight, in bind
 * space: at chest height the body is 0.134 m half-wide and 0.115 m half-deep; at the navel 0.117 by
 * 0.107; at the hips 0.130 by 0.119. A circular capsule has to pick one, and the two choices are not
 * worth the same:
 *
 *   * too FAT and a correct hikite — the Shotokan pull-back fist, which sits ON the floating ribs by
 *     definition — gets shoved 20 mm off the body for the whole kata. That is a visible kata error
 *     and it is present on every frame.
 *   * too THIN and a hand grazing the widest part of the flank is missed. That is invisible.
 *
 * So every radius here is the measured half-DEPTH, the smaller of the two, and the sides are
 * knowingly left short by 10–25 mm. The deep failures this module exists for — a wrist 0.014 m from
 * the spine axis — are inside any radius at all.
 *
 * This is also why `CAPSULES` in `src/contracts/rig.ts` is prior art and not a source. Its torso
 * radii (0.085 H = 0.155 m upper, 0.080 H = 0.146 m lower) are 35 % fatter than what this mesh
 * measures, and its own comment says why: they were authored to hold CLOTH off the skin, "0.004–
 * 0.008 H larger than the body-mesh radii ... so the gi never sits ON the skin". A cloth proxy wants
 * to be generous; a self-collision proxy wants to be exact. The one number that did carry over is
 * the head: that table says 0.052 H and this mesh measures 0.053 H, which is a pleasant confirmation
 * that the head sphere was right and had simply been sized for a rig that no longer renders.
 *
 * ═══ WHY THE EASE IS A FILTER AND NOT A LATCH ════════════════════════════════════════════════
 *
 * `./footIk` needs `stepLatch` because "is this foot on the floor" is a BINARY decision read off a
 * continuous height, and a binary decision read off a continuous quantity chatters. Penetration
 * depth is not that: it is already continuous in the pose, it reaches a contact at exactly zero, and
 * it leaves at exactly zero. There is nothing to debounce. What remains is that the DEPTH can change
 * fast — a punch retracting past the ribs changes it by 40 mm in three frames — so the applied
 * correction is a first-order filter on the requirement VECTOR (tau 90 ms) with a 0.6 m/s rate cap
 * on top. Filtering the vector rather than the magnitude matters when the winning collider changes:
 * the normal then rotates through the intermediate directions instead of snapping.
 *
 * ═══ MEASURED RIG FACTS THE CODE LEANS ON ════════════════════════════════════════════════════
 *
 * Off the Rigify bind pose via `skeleton.boneInverses`, character 1.8287 m:
 *
 *     DEF-hips        y 0.9167     DEF-upper_arm.L  x 0.1919, y 1.4408
 *     DEF-spine001    y 1.0505     DEF-forearm.L    x 0.4663      upper arm 0.2744
 *     DEF-spine002    y 1.1736     DEF-hand.L       x 0.7389      forearm   0.2726
 *     DEF-spine003    y 1.3148
 *     DEF-neck        y 1.4876     head verts       y 1.5512 .. 1.8292, |x| <= 0.087
 *     DEF-head        y 1.5687     — i.e. the head BONE sits at the jaw, 0.26 m below the crown
 *
 * That last line is the trap in the QA report this module answers. "Wrist 0.072 m from the head
 * BONE" understates the problem, because the bone is at the skull's base and the skull extends
 * 0.26 m past it; and it would overstate the problem on a rig that puts the head bone at the skull's
 * centre. Nothing here measures against a joint origin — the head is a capsule spanning the actual
 * cranium, positioned from the bind mesh and carried in the head bone's own frame.
 *
 * The capsule's axis is taken from the SPINE (`chest` -> `neck_01`), not from `neck_01` -> `head`.
 * Rigify leans that second vector forward by 0.0156 m over its 0.0826 m length, so extending it to
 * the crown would tilt the top of the head capsule 36 mm in front of where the skull actually is.
 * Same class of error as the pelvis's local +Z: the bone's own axes are not the body's axes.
 */

import { Matrix4, Quaternion, Vector3, type Bone, type Skeleton } from 'three';

import type { BoneName } from '../contracts';
import { createTwoBoneOut, solveTwoBone } from './footIk';
import type { Character } from './character';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The pure core — no bones, no scene graph, unit-testable in Node
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Result slot for {@link closestSegments}. Caller-owned so the per-frame path allocates nothing. */
export interface ClosestPair {
  /** Parameter of the closest point along the FIRST segment, in [0, 1]. */
  s: number;
  /** Parameter of the closest point along the SECOND segment, in [0, 1]. */
  t: number;
  /** Distance between the two closest points. */
  dist: number;
  readonly p1: Vector3;
  readonly p2: Vector3;
}

export function createClosestPair(): ClosestPair {
  return { s: 0, t: 0, dist: 0, p1: new Vector3(), p2: new Vector3() };
}

const _d1 = new Vector3();
const _d2 = new Vector3();
const _r = new Vector3();

/**
 * Closest points between two segments — Ericson, *Real-Time Collision Detection* §5.1.9.
 *
 * Every collision this module resolves is one of these: a fist is a degenerate segment, a forearm
 * and a capsule axis are ordinary ones. Written out rather than reached for from three because
 * three ships no segment-segment primitive, and because the PARAMETERS matter as much as the
 * distance — `s` is how much of a wrist displacement the contact point would inherit, and step 2 of
 * the fix divides by it.
 *
 * The three degenerate branches are not decoration. A fist sphere is `a1 === b1`, so the `a < eps`
 * branch runs on roughly half of all tests; a collider whose two bind points coincide would take
 * the `e < eps` one; and a rig that mapped neither would take the first. Each returns the right
 * answer rather than a NaN that would propagate into a bone rotation.
 */
export function closestSegments(
  a1: Vector3,
  b1: Vector3,
  a2: Vector3,
  b2: Vector3,
  out: ClosestPair,
): void {
  _d1.subVectors(b1, a1);
  _d2.subVectors(b2, a2);
  _r.subVectors(a1, a2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);

  let s: number;
  let t: number;
  if (a < 1e-12 && e < 1e-12) {
    s = 0;
    t = 0;
  } else if (a < 1e-12) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = _d1.dot(_r);
    if (e < 1e-12) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = _d1.dot(_d2);
      const den = a * e - b * b;
      /* `den === 0` is PARALLEL, not degenerate: any `s` gives the same distance, and 0 is as good
       * an answer as the closed form would give. Dividing anyway would produce Infinity. */
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  out.s = s;
  out.t = t;
  out.p1.copy(_d1).multiplyScalar(s).add(a1);
  out.p2.copy(_d2).multiplyScalar(t).add(a2);
  out.dist = out.p1.distanceTo(out.p2);
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Result slot for {@link capsulePush}. */
export interface Push {
  /** Penetration depth in metres. 0 when the two capsules are clear of each other. */
  depth: number;
  /** Unit vector pointing OUT of the collider, i.e. the direction the probe must move. */
  readonly normal: Vector3;
  /** Where along the probe segment the contact sits: 0 at `a1`, 1 at `b1`. */
  s: number;
}

export function createPush(): Push {
  return { depth: 0, normal: new Vector3(0, 1, 0), s: 0 };
}

const _pair = createClosestPair();
const _mid = new Vector3();
const _ax = new Vector3();
const _alt = new Vector3();

/**
 * Capsule-vs-capsule overlap. `(a1, b1, r1)` is the PROBE — a fist or a forearm — and
 * `(a2, b2, r2)` the body. Returns true and fills `out` when they overlap.
 *
 * ═══ THE NORMAL IS THE HARD PART, NOT THE DEPTH ══════════════════════════════════════════════
 *
 * The depth is `r1 + r2 − dist` and there is nothing to it. The DIRECTION is where a naive
 * implementation quietly produces garbage, because the obvious answer — normalise the vector
 * between the two closest points — is exactly zero on the cases this module was written for. A
 * wrist measured 0.014 m from the spine axis against a 0.115 m capsule is not near the surface; it
 * is 0.101 m inside, and at the moment it crosses the axis the closest-point vector vanishes and
 * flips sign. Normalising that gives a push direction that reverses between two adjacent frames,
 * which is a limb snapping through the body — worse than the penetration it was meant to fix.
 *
 * So the direction is resolved in three layers, cheapest first, each strictly better defined than
 * the last:
 *
 *   1. closest point to closest point. Correct and stable for any shallow contact, which is what
 *      the module sees once it is doing its job.
 *   2. the probe's MIDPOINT out from the collider axis. Still defined when (1) has collapsed,
 *      because a segment through an axis is generally not centred on it.
 *   3. any unit vector perpendicular to the collider axis, chosen deterministically from whichever
 *      world axis is least aligned with it. Reached only when the probe lies exactly on the axis,
 *      and its virtue is that it is the SAME direction on the next frame — an arbitrary but
 *      repeatable answer beats a well-motivated one that changes every frame.
 */
export function capsulePush(
  a1: Vector3,
  b1: Vector3,
  r1: number,
  a2: Vector3,
  b2: Vector3,
  r2: number,
  out: Push,
): boolean {
  closestSegments(a1, b1, a2, b2, _pair);
  const want = r1 + r2;
  if (_pair.dist >= want) {
    out.depth = 0;
    return false;
  }
  out.depth = want - _pair.dist;
  out.s = _pair.s;

  out.normal.subVectors(_pair.p1, _pair.p2);
  if (out.normal.lengthSq() > 1e-12) {
    out.normal.normalize();
    return true;
  }

  /* Layer 2: the probe's midpoint, pushed out from the collider's axis. */
  _mid.addVectors(a1, b1).multiplyScalar(0.5);
  _ax.subVectors(b2, a2);
  const axLen2 = _ax.lengthSq();
  if (axLen2 > 1e-12) {
    const k = clamp01(_alt.subVectors(_mid, a2).dot(_ax) / axLen2);
    out.normal.copy(_ax).multiplyScalar(k).add(a2);
    out.normal.subVectors(_mid, out.normal);
  } else {
    out.normal.subVectors(_mid, a2);
  }
  if (out.normal.lengthSq() > 1e-12) {
    out.normal.normalize();
    return true;
  }

  /* Layer 3: perpendicular to the axis, deterministically. */
  if (axLen2 > 1e-12) {
    _ax.normalize();
    const ax = Math.abs(_ax.x);
    const ay = Math.abs(_ax.y);
    const az = Math.abs(_ax.z);
    _alt.set(ax <= ay && ax <= az ? 1 : 0, ay < ax && ay <= az ? 1 : 0, az < ax && az < ay ? 1 : 0);
    out.normal.crossVectors(_ax, _alt).normalize();
  } else {
    out.normal.set(0, 1, 0);
  }
  return true;
}

/**
 * The largest `k` in `[0, 1]` for which `|tip + k·delta − root|` stays within `limit`.
 *
 * ═══ WHY THE CORRECTION IS SHORTENED AND THE TARGET IS NOT CLAMPED ═══════════════════════════
 *
 * `./footIk` clamps its ankle target onto the reach sphere because a foot MUST end up on the floor
 * and the only question is where horizontally. An arm has no such obligation: nothing requires the
 * hand to be at any particular place, only that it not be inside the chest. Clamping the target
 * would answer "the wrist cannot get there" by putting it as far along the line as the arm reaches
 * — which is a straight arm, and a straight arm is the one silhouette this correction must never
 * produce. It reads as the limb being dragged rather than as the karateka holding his own guard.
 *
 * Shortening the correction instead means the arm keeps whatever bend the capture gave it and
 * simply resolves less of the penetration. Some residual is the honest cost; a locked elbow is not.
 *
 * `|tip + k·delta − root|² = limit²` is a quadratic in `k` whose discriminant cannot be negative
 * while `|tip − root| <= limit`, so the positive root always exists and no branch is needed for
 * "no solution". Two cases are worth naming because they are the ones that actually occur:
 *
 *   * the correction points INWARD (`u·v < 0`, a hand being pushed back toward the shoulder). The
 *     positive root exceeds 1 and the clamp returns 1 — full correction, correctly.
 *   * the arm is ALREADY at the limit and the correction points outward. The root is 0 and the
 *     correction is dropped entirely, which is right: a fully extended punch must not be extended
 *     further to resolve a contact.
 */
export function reachScale(root: Vector3, tip: Vector3, delta: Vector3, limit: number): number {
  const ux = tip.x - root.x;
  const uy = tip.y - root.y;
  const uz = tip.z - root.z;
  const vv = delta.lengthSq();
  if (vv < 1e-18) return 1;
  const uu = ux * ux + uy * uy + uz * uz;
  const uv = ux * delta.x + uy * delta.y + uz * delta.z;
  const c = uu - limit * limit;
  if (c <= 0 && uv <= 0) return 1;
  const disc = uv * uv - vv * c;
  if (disc <= 0) return 0;
  const k = (-uv + Math.sqrt(disc)) / vv;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

/**
 * One step of the anti-jitter filter: move `cur` toward `want`, then cap its rate and its size.
 *
 * Frame-rate-independent by construction (`1 − exp(−dt/tau)`), because the three numbers that
 * govern it are quoted in seconds and metres per second and would otherwise mean something else on
 * every machine. The rate cap is second and the magnitude cap third, in that order: capping the
 * magnitude first would let a single frame's overshoot survive as a direction change.
 */
export function smoothToward(
  cur: Vector3,
  want: Vector3,
  dtS: number,
  tauS: number,
  maxRateMs: number,
  maxMagM: number,
): void {
  const dt = dtS > 1e-6 ? dtS : 1 / 60;
  const alpha = tauS > 1e-6 ? 1 - Math.exp(-dt / tauS) : 1;
  const nx = cur.x + (want.x - cur.x) * alpha;
  const ny = cur.y + (want.y - cur.y) * alpha;
  const nz = cur.z + (want.z - cur.z) * alpha;
  let dx = nx - cur.x;
  let dy = ny - cur.y;
  let dz = nz - cur.z;
  const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxStep = maxRateMs * dt;
  if (step > maxStep && step > 1e-12) {
    const k = maxStep / step;
    dx *= k;
    dy *= k;
    dz *= k;
  }
  cur.set(cur.x + dx, cur.y + dy, cur.z + dz);
  const mag = cur.length();
  if (mag > maxMagM && mag > 1e-12) cur.multiplyScalar(maxMagM / mag);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Options
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Every length is a FRACTION OF THE CHARACTER'S HEIGHT, not metres.
 *
 * The measurements in the header are this 1.8287 m model's, but nothing about them is special to
 * it: a torso is a torso. Expressed as FracH — the same unit `CAPSULES` in `src/contracts/rig.ts`
 * uses, for the same reason — they survive a differently-sized character with no retuning, and the
 * one number that must NOT scale (the ease time constant) is visibly in different units.
 */
export interface SelfCollisionOpts {
  readonly enabled?: boolean;

  /** Skull capsule: radius, and where its two ends sit above the head bone along the spine's up. */
  readonly headRadiusH?: number;
  readonly headLowH?: number;
  readonly headHighH?: number;

  /** Ribcage, navel and hip capsule radii. Measured half-DEPTHS — see the header on under-covering. */
  readonly chestRadiusH?: number;
  readonly abdomenRadiusH?: number;
  readonly pelvisRadiusH?: number;
  /**
   * How far up the `chest` -> `neck_01` run the ribcage capsule stops.
   *
   * Not 1. A capsule ending AT the neck joint puts a 0.115 m hemisphere around the throat, which is
   * twice the neck's actual radius, and a shuto-uke that passes correctly in front of the throat
   * would be pushed off it. Stopping at 0.75 puts the cap at y 1.559 against upper-chest vertices
   * that reach 1.523 — covered, without the bulge.
   */
  readonly chestTopFrac?: number;

  /** Upper-arm capsule radius. Measured p50 0.060 m, p90 0.078 m; the default under-covers at 0.055. */
  readonly upperArmRadiusH?: number;

  /** The moving parts: the fist sphere and the forearm capsule. */
  readonly fistRadiusH?: number;
  readonly fistOffsetH?: number;
  readonly forearmRadiusH?: number;

  /**
   * Extra clearance beyond just-touching, in FracH.
   *
   * Zero would resolve to surfaces exactly in contact, which is a z-fight and a shading seam rather
   * than a fix. 0.004 H = 7 mm is about one skin thickness and is invisible as a gap.
   */
  readonly marginH?: number;

  /**
   * Ease time constants, SECONDS — not FracH, see the note on the interface.
   *
   * ═══ ASYMMETRIC, AND THE ASYMMETRY IS THE WHOLE DESIGN ══════════════════════════════════════
   *
   * The two directions are not the same problem. Measured on this clip, the right hand crosses the
   * skull between t = 0.633 and t = 0.700 — FOUR frames, from 0.082 m of clearance to 0.008 m and
   * back out to 0.076 m. A symmetric 90 ms ease reaches barely a third of the requirement inside
   * that window and the hand is through the head before the correction arrives. So the ATTACK is
   * 35 ms: about two frames at 60 Hz, fast enough to catch a transit.
   *
   * A 35 ms RELEASE would then be the jitter this module is supposed to prevent — a contact that
   * blinks on and off at the frame rate would produce a correction that blinks with it. The release
   * is 120 ms, so the arm always leaves a contact more slowly than it entered one, and the applied
   * correction is a low-pass filter with memory rather than a follower. Compressors have used this
   * shape on audio for the same reason for sixty years: rise on the signal, fall on the average.
   */
  readonly tauS?: number;
  readonly releaseTauS?: number;
  /** Rate cap on the correction, m/s, and its absolute ceiling in FracH. */
  readonly maxRateMs?: number;
  readonly maxCorrectionH?: number;

  /**
   * Fraction of `upperarm + forearm` the wrist may be pushed to.
   *
   * Below 1 so the elbow can never lock. The floor under it is the arm's CURRENT extension, exactly
   * as in `./footIk` — a punch the animation already threw at 99 % extension must not be folded
   * back 1 % to satisfy a ceiling.
   */
  readonly maxReach?: number;

  /**
   * How little of a wrist displacement a contact may inherit before the requirement is capped.
   *
   * A contact at parameter `s` along elbow -> wrist moves by `s` times whatever the wrist moves, so
   * clearing it needs `depth / s` of wrist travel — and as `s` goes to 0 that goes to infinity. A
   * contact at the elbow cannot be fixed by moving the wrist at all, and pretending otherwise
   * throws the hand across the room. 0.4 is the floor: below it the requirement is computed as if
   * the contact were at 0.4 and is therefore deliberately under-served.
   */
  readonly minContactFrac?: number;

  /** Relaxation passes per arm. 2 resolves a hand cornered between two colliders; 1 does not. */
  readonly iterations?: number;

  /**
   * Put the hand back on the world orientation the animation gave it after the arm has moved.
   *
   * Same argument as `./footIk`'s `preserveFootOrientation`: the solve rotates the upper arm, the
   * hand hangs off it, so a 30 mm wrist push also rolls the fist by a few degrees. Where the fist
   * points is the capture's business — a chudan-zuki is palm-down and that is the whole technique —
   * and this pass has no opinion about it.
   */
  readonly preserveHandOrientation?: boolean;
}

interface ResolvedOpts {
  headRadiusH: number;
  headLowH: number;
  headHighH: number;
  chestRadiusH: number;
  abdomenRadiusH: number;
  pelvisRadiusH: number;
  chestTopFrac: number;
  upperArmRadiusH: number;
  fistRadiusH: number;
  fistOffsetH: number;
  forearmRadiusH: number;
  marginH: number;
  tauS: number;
  releaseTauS: number;
  maxRateMs: number;
  maxCorrectionH: number;
  maxReach: number;
  minContactFrac: number;
  iterations: number;
  preserveHandOrientation: boolean;
}

export const SELF_COLLISION_DEFAULTS: Readonly<ResolvedOpts> = Object.freeze({
  /* 0.0530 H = 0.0969 m. The mesh's own head vertices span |x| <= 0.087 and y 1.5512..1.8292 about
   * a bone at 1.5687; a capsule from +0.030 H to +0.089 H at this radius covers 1.527..1.828. */
  headRadiusH: 0.053,
  headLowH: 0.03,
  headHighH: 0.089,
  /* Half-DEPTHS, measured: chest 0.115 m, navel 0.107 m, hips 0.119 m. */
  chestRadiusH: 0.0629,
  abdomenRadiusH: 0.0585,
  pelvisRadiusH: 0.0651,
  chestTopFrac: 0.75,
  upperArmRadiusH: 0.0301,
  fistRadiusH: 0.0246,
  fistOffsetH: 0.027,
  forearmRadiusH: 0.0246,
  marginH: 0.004,
  tauS: 0.035,
  releaseTauS: 0.12,
  /**
   * 1.2 m/s = 20 mm per 60 Hz frame, and it was swept rather than chosen.
   *
   * Over the whole clip, with everything else fixed: 1.0 m/s leaves 44 frames with a wrist inside
   * 0.13 m of the spine axis, 1.2 leaves 43, 1.5 leaves 33. The knee of that curve is at 1.0–1.2
   * and the last step buys 10 frames for a 50 % larger worst-case slew. Oscillation
   * is flat across the whole range — the sign of `d|correction|` reverses on 50 of 739 engaged
   * frames at every setting tested — so the cap is not what keeps the pass steady; the asymmetric
   * ease is. It is here as a hard ceiling on one bad frame, not as the stabiliser.
   *
   * The magnitude ceiling is 0.10 H = 0.183 m: the deepest contact this clip presents is 0.150 m
   * (the left wrist at the navel, t = 11.57) and a ceiling under the worst real case is a ceiling
   * that silently gives up on it. Raising it to 0.13 H changes no measured outcome.
   */
  maxRateMs: 1.2,
  maxCorrectionH: 0.1,
  maxReach: 0.985,
  minContactFrac: 0.4,
  iterations: 2,
  preserveHandOrientation: true,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Handle
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface SelfCollisionArmStats {
  readonly side: 'L' | 'R';
  /** Deepest penetration the ANIMATED pose presented this frame, metres. 0 when clear. */
  readonly penetrationM: number;
  /** Magnitude of the eased wrist correction actually applied, metres. */
  readonly correctionM: number;
  /** Change in that correction since the previous frame — THE jitter metric, metres. */
  readonly jitterM: number;
  /** Id of the collider that won the frame, or `null` when nothing was touching. */
  readonly hit: string | null;
  /** True when the correction had to be shortened to keep the elbow from straightening. */
  readonly reachLimited: boolean;
}

export interface SelfCollisionStats {
  readonly enabled: boolean;
  /** Empty when the rig mapped no usable arm — the pass is then inert, not throwing. */
  readonly arms: readonly SelfCollisionArmStats[];
  readonly colliders: number;
  readonly frames: number;
}

export interface SelfCollision {
  /**
   * Solve one frame. Call AFTER `character.update(dt)` and AFTER
   * `character.root.updateMatrixWorld(true)` — this reads world matrices and writes bone locals, so
   * anything that re-poses the skeleton afterwards silently undoes it.
   *
   * `dtS` drives the ease and the rate cap; it defaults to a 60 Hz frame so `update()` with no
   * argument still behaves, but passing the real delta is what makes `tauS` and `maxRateMs` mean
   * what their units say at any frame rate.
   */
  update(dtS?: number): void;
  /** Switch the pass off (restoring the animated pose) or back on. For an A/B toggle in the HUD. */
  setEnabled(on: boolean): void;
  dispose(): void;
  readonly stats: SelfCollisionStats;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Implementation
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** One body capsule, its two ends held in the CARRIER bone's own frame so they follow the pose. */
interface Collider {
  readonly id: string;
  readonly bone: Bone;
  readonly a: Vector3;
  readonly b: Vector3;
  readonly r: number;
  /** `'L'`/`'R'` for a limb capsule, which its own arm must not be tested against. */
  readonly side: 'L' | 'R' | null;
  /** Scratch: this frame's world-space ends. */
  readonly wa: Vector3;
  readonly wb: Vector3;
}

interface Arm {
  readonly side: 'L' | 'R';
  readonly shoulder: Bone;
  readonly elbow: Bone;
  readonly wrist: Bone;
  /** Fist centre, in the WRIST bone's frame. */
  readonly fistLocal: Vector3;
  /** Last non-degenerate bend-plane normal, world space. Seeded from bind. */
  readonly pole: Vector3;
  /** The eased correction currently applied to the wrist, world metres. */
  readonly delta: Vector3;
  /** Previous frame's `delta`, for the jitter metric. */
  readonly prevDelta: Vector3;
  penM: number;
  jitterM: number;
  hit: string | null;
  reachLimited: boolean;
}

/** One bone-local channel this module overwrote, and what was there before. */
interface WrittenQuat {
  readonly bone: Bone;
  readonly before: Quaternion;
  readonly after: Quaternion;
  live: boolean;
}

const _p = new Vector3();
const _q = new Vector3();
const _scale = new Vector3();
const _wq = new Quaternion();
const _wq2 = new Quaternion();
const _tmpQ = new Quaternion();
const _mat = new Matrix4();
const _shoulder = new Vector3();
const _elbow = new Vector3();
const _wrist = new Vector3();
const _fist = new Vector3();
const _probeA = new Vector3();
const _probeB = new Vector3();
const _want = new Vector3();
const _need = new Vector3();
const _escape = new Vector3();
const _shoulderQ = new Quaternion();
const _elbowQ = new Quaternion();
const _handQ = new Quaternion();
const _push = createPush();

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
 * Bind-pose world position of one bone, from `boneInverses`.
 *
 * The inverse bind matrix IS the bind pose by definition and is immune to whatever clip happens to
 * be playing, so construction is safe mid-animation — the same reason `./footIk` and `./retarget`
 * both read it rather than sampling live bones. `null` when the bone is not skinned by this
 * skeleton, which is a real possibility on a rig with helper joints.
 */
function bindPos(skeleton: Skeleton, bone: Bone | null): Vector3 | null {
  if (bone === null) return null;
  const i = skeleton.bones.indexOf(bone);
  if (i < 0) return null;
  const inv = skeleton.boneInverses[i];
  if (inv === undefined) return null;
  return new Vector3().setFromMatrixPosition(_mat.copy(inv).invert());
}

/** Bind world point -> a fixed point in `bone`'s own frame. Convention-free by construction. */
function toBoneLocal(skeleton: Skeleton, bone: Bone, world: Vector3): Vector3 {
  const i = skeleton.bones.indexOf(bone);
  const inv = skeleton.boneInverses[i];
  return inv === undefined ? world.clone() : world.clone().applyMatrix4(inv);
}

/**
 * Create the self-collision pass for `character`.
 *
 * Never throws. A rig that maps neither arm, or has no skeleton, yields a handle whose `update()`
 * is a no-op and whose `stats.arms` is empty — a viewer that quietly keeps the intersecting pose is
 * a far better failure than one that will not boot, and `stats` says which happened. An unmapped
 * torso joint drops THAT capsule and keeps the rest, for the same reason `./footIk` lets one leg
 * disable itself without taking the other with it.
 */
export function createSelfCollision(
  character: Character,
  opts: SelfCollisionOpts = {},
): SelfCollision {
  const D = SELF_COLLISION_DEFAULTS;
  const o: ResolvedOpts = {
    headRadiusH: opts.headRadiusH ?? D.headRadiusH,
    headLowH: opts.headLowH ?? D.headLowH,
    headHighH: opts.headHighH ?? D.headHighH,
    chestRadiusH: opts.chestRadiusH ?? D.chestRadiusH,
    abdomenRadiusH: opts.abdomenRadiusH ?? D.abdomenRadiusH,
    pelvisRadiusH: opts.pelvisRadiusH ?? D.pelvisRadiusH,
    chestTopFrac: opts.chestTopFrac ?? D.chestTopFrac,
    upperArmRadiusH: opts.upperArmRadiusH ?? D.upperArmRadiusH,
    fistRadiusH: opts.fistRadiusH ?? D.fistRadiusH,
    fistOffsetH: opts.fistOffsetH ?? D.fistOffsetH,
    forearmRadiusH: opts.forearmRadiusH ?? D.forearmRadiusH,
    marginH: opts.marginH ?? D.marginH,
    tauS: opts.tauS ?? D.tauS,
    releaseTauS: opts.releaseTauS ?? D.releaseTauS,
    maxRateMs: opts.maxRateMs ?? D.maxRateMs,
    maxCorrectionH: opts.maxCorrectionH ?? D.maxCorrectionH,
    maxReach: opts.maxReach ?? D.maxReach,
    minContactFrac: opts.minContactFrac ?? D.minContactFrac,
    iterations: opts.iterations ?? D.iterations,
    preserveHandOrientation: opts.preserveHandOrientation ?? D.preserveHandOrientation,
  };

  const skeleton = skeletonOf(character);
  const H = character.heightM > 0.1 ? character.heightM : 1.8287;
  const m = (fracH: number): number => fracH * H;

  const colliders: Collider[] = [];
  const arms: Arm[] = [];

  if (skeleton !== null) {
    const bone = (n: BoneName): Bone | null => character.boneFor(n);
    const bp = (n: BoneName): Vector3 | null => bindPos(skeleton, bone(n));

    const headB = bp('head');
    const neckB = bp('neck_01');
    const chestB = bp('chest');
    const spine1B = bp('spine_01');
    const pelvisB = bp('pelvis');

    /**
     * The body's own up, measured from the spine and not named.
     *
     * `chest` -> `neck_01` is the one run on this skeleton that is unambiguously "up the torso" and
     * is present on both supported rig flavours. Falling back through `pelvis` -> `chest` and then
     * to world +Y costs nothing and means a rig missing a joint degrades rather than mis-orients.
     */
    const up = new Vector3(0, 1, 0);
    if (chestB !== null && neckB !== null) up.subVectors(neckB, chestB);
    else if (pelvisB !== null && chestB !== null) up.subVectors(chestB, pelvisB);
    if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
    up.normalize();

    const add = (
      id: string,
      carrier: Bone | null,
      a: Vector3 | null,
      b: Vector3 | null,
      r: number,
      side: 'L' | 'R' | null,
    ): void => {
      if (carrier === null || a === null || b === null || r <= 0) return;
      colliders.push({
        id,
        bone: carrier,
        a: toBoneLocal(skeleton, carrier, a),
        b: toBoneLocal(skeleton, carrier, b),
        r,
        side,
        wa: new Vector3(),
        wb: new Vector3(),
      });
    };

    /* ── the skull ───────────────────────────────────────────────────────────────────────────
     *
     * Spanned along the SPINE'S up from the head bone, for the reason in the header: `neck_01` ->
     * `head` leans 0.0156 m forward over 0.0826 m, so extending it to the crown would put the top
     * of the capsule 36 mm in front of the skull. */
    if (headB !== null) {
      add(
        'head',
        bone('head'),
        headB.clone().addScaledVector(up, m(o.headLowH)),
        headB.clone().addScaledVector(up, m(o.headHighH)),
        m(o.headRadiusH),
        null,
      );
    }

    /* ── the trunk, three capsules on three carriers ─────────────────────────────────────────
     *
     * Each spans between two BIND joint positions but is carried by the bone that sits inside that
     * span, so the proxy bends with the spine instead of pivoting about one end. The ribcage stops
     * short of the neck; see `chestTopFrac`. */
    if (chestB !== null && neckB !== null) {
      add(
        'chest',
        bone('chest'),
        chestB,
        chestB.clone().lerp(neckB, o.chestTopFrac),
        m(o.chestRadiusH),
        null,
      );
    }
    if (spine1B !== null && chestB !== null) {
      add('abdomen', bone('spine_02'), spine1B, chestB, m(o.abdomenRadiusH), null);
    }
    if (pelvisB !== null && spine1B !== null) {
      add('pelvis', bone('pelvis'), pelvisB, spine1B, m(o.pelvisRadiusH), null);
    }

    /* ── the upper arms ──────────────────────────────────────────────────────────────────────
     *
     * Present so a hand can be kept out of the OTHER arm — a shuto-uke sweeps the blocking hand
     * across the guard arm, and 0.055 m of upper arm is exactly what it crosses. Each is tagged
     * with its side and skipped when testing that side's own hand, which would otherwise report a
     * permanent contact between a forearm and the upper arm it hangs off. */
    for (const side of ['L', 'R'] as const) {
      add(
        `upperarm_${side}`,
        bone(`upperarm_${side}`),
        bp(`upperarm_${side}`),
        bp(`lowerarm_${side}`),
        m(o.upperArmRadiusH),
        side,
      );
    }

    /* ── the arms themselves ─────────────────────────────────────────────────────────────────── */
    for (const side of ['L', 'R'] as const) {
      const shoulder = bone(`upperarm_${side}`);
      const elbow = bone(`lowerarm_${side}`);
      const wrist = bone(`hand_${side}`);
      if (shoulder === null || elbow === null || wrist === null) continue;
      const sB = bindPos(skeleton, shoulder);
      const eB = bindPos(skeleton, elbow);
      const wB = bindPos(skeleton, wrist);
      if (sB === null || eB === null || wB === null) continue;

      /* The fist sits PAST the wrist joint, along the forearm's own direction — 0.027 H = 49 mm on
       * this character, which is where the knuckles are on a closed seiken. Held in the wrist
       * bone's frame so wrist flexion carries it, rather than being recomputed from the forearm
       * every frame, which would ignore the wrist entirely. */
      const fistWorld = wB.clone().addScaledVector(_q.subVectors(wB, eB).normalize(), m(o.fistOffsetH));

      /* Seed the pole from bind: cross(wrist − shoulder, elbow − shoulder). This rig's bind arm is a
       * clean T-pose and is dead straight, so the seed degenerates — fall back to the body's up,
       * which puts the elbow's bend plane vertical and is the anatomically right guess for an arm
       * whose animated pose has not yet been read. It is only ever consulted on frames where the
       * animated arm is ALSO perfectly straight, which is a punch at full kime. */
      const pole = new Vector3().subVectors(wB, sB).cross(_q.subVectors(eB, sB));
      if (pole.lengthSq() < 1e-12) pole.copy(up);
      pole.normalize();

      arms.push({
        side,
        shoulder,
        elbow,
        wrist,
        fistLocal: toBoneLocal(skeleton, wrist, fistWorld),
        pole,
        delta: new Vector3(),
        prevDelta: new Vector3(),
        penM: 0,
        jitterM: 0,
        hit: null,
        reachLimited: false,
      });
    }
  }

  const out = createTwoBoneOut();
  const written: WrittenQuat[] = [];

  /* ── the "did the animation overwrite us?" ledger ──────────────────────────────────────────
   *
   * Identical in shape and in purpose to the one in `./footIk` — see its comment for the full
   * argument. In one line: every bone written here is rewritten by the mixer next frame TODAY, but
   * a clip missing a track for `DEF-upper_armL` would leave the correction on the bone and compose
   * the next one on top of it, curling the arm over a few seconds. So the write is remembered along
   * with what it replaced and rolled back at the top of the next frame if and only if the value is
   * still bit-for-bit ours. */
  const rememberQuat = (b: Bone, before: Quaternion): WrittenQuat => {
    for (const w of written) {
      if (w.bone === b) {
        w.before.copy(before);
        w.live = true;
        return w;
      }
    }
    const w: WrittenQuat = { bone: b, before: before.clone(), after: new Quaternion(), live: true };
    written.push(w);
    return w;
  };

  /** True when something was actually rolled back, i.e. the world matrices are now stale. */
  const restore = (): boolean => {
    let dirty = false;
    for (const w of written) {
      if (!w.live) continue;
      w.live = false;
      const c = w.bone.quaternion;
      if (c.x === w.after.x && c.y === w.after.y && c.z === w.after.z && c.w === w.after.w) {
        c.copy(w.before);
        dirty = true;
      }
    }
    return dirty;
  };

  const armStats = arms.map((a) => ({
    side: a.side,
    penetrationM: 0,
    correctionM: 0,
    jitterM: 0,
    hit: null as string | null,
    reachLimited: false,
  }));
  const stats = {
    enabled: opts.enabled ?? true,
    arms: armStats,
    colliders: colliders.length,
    frames: 0,
  };

  let enabled = opts.enabled ?? true;
  const margin = m(o.marginH);
  const maxCorrection = m(o.maxCorrectionH);
  const fistR = m(o.fistRadiusH);
  const forearmR = m(o.forearmRadiusH);

  /**
   * Reduce every contact this arm is in to ONE wrist displacement, written into `_want`.
   *
   * ═══ WHY A WRIST DISPLACEMENT AND NOT A FORCE PER CONTACT ═══════════════════════════════════
   *
   * The only handle this pass has on the arm is where the two-bone solve puts the wrist. A contact
   * partway down the forearm is therefore not "push this point out" but "how far would the WRIST
   * have to move for this point to clear", and the answer is `depth / s` where `s` is the contact's
   * parameter along elbow -> wrist — because the elbow stays roughly put while the wrist swings, so
   * a point at `s` inherits `s` of the wrist's motion. The fist is past the wrist, `s > 1`, and
   * needs LESS wrist travel than its own depth; a contact at the elbow needs infinite travel, which
   * is what `minContactFrac` exists to refuse.
   *
   * The largest requirement wins outright rather than the contacts being summed. Summing two
   * normals that disagree produces a direction that satisfies neither and is not the shortest way
   * out of either; taking the deepest and re-measuring is the standard relaxation, and two passes
   * is enough for the one case that actually occurs — a hand cornered between the ribcage and the
   * opposite upper arm.
   */
  const solveDelta = (arm: Arm): void => {
    _want.set(0, 0, 0);
    arm.penM = 0;
    arm.hit = null;

    const armLen = _elbow.distanceTo(_wrist);
    const fistS = armLen > 1e-6 ? _elbow.distanceTo(_fist) / armLen : 1;

    for (let iter = 0; iter < o.iterations; iter++) {
      let bestNeed = 0;
      let bestId: string | null = null;
      _need.set(0, 0, 0);

      for (const col of colliders) {
        if (col.side === arm.side) continue;

        for (let probe = 0; probe < 2; probe++) {
          /* probe 0 is the fist, a sphere; probe 1 the forearm, a capsule. Both are offset by the
           * correction accumulated so far in this relaxation — the fist by all of it, the forearm's
           * far end by all of it and its near end by none, which is the same first-order model the
           * `depth / s` division rests on. */
          let r: number;
          let sScale: number;
          if (probe === 0) {
            _probeA.copy(_fist).addScaledVector(_want, fistS);
            _probeB.copy(_probeA);
            r = fistR;
            sScale = fistS;
          } else {
            _probeA.copy(_elbow);
            _probeB.copy(_wrist).add(_want);
            r = forearmR;
            sScale = 1;
          }
          if (!capsulePush(_probeA, _probeB, r + margin, col.wa, col.wb, col.r, _push)) continue;

          const s = probe === 0 ? sScale : Math.max(o.minContactFrac, _push.s);
          const need = _push.depth / s;
          /* `penM` reports what the ANIMATED pose presented, so it is read on the first pass only —
           * on later passes the probes have already been displaced and the depth is a residual. */
          if (iter === 0 && _push.depth > arm.penM) arm.penM = _push.depth;
          if (need > bestNeed) {
            bestNeed = need;
            bestId = col.id;
            _need.copy(_push.normal).multiplyScalar(need);
          }
        }
      }

      if (bestNeed <= 0) break;
      _want.add(_need);
      if (arm.hit === null) arm.hit = bestId;
    }
  };

  const update = (dtS: number = 1 / 60): void => {
    const dirty = restore();
    if (!enabled || arms.length === 0 || colliders.length === 0) {
      /* The rollback invalidated the matrices the caller had already computed; leaving them stale
       * would hand the renderer last frame's corrected pose over this frame's animated locals. */
      if (dirty) character.root.updateMatrixWorld(true);
      stats.enabled = enabled;
      return;
    }
    if (dirty) character.root.updateMatrixWorld(true);

    const dt = dtS > 1e-6 ? dtS : 1 / 60;

    for (const col of colliders) {
      col.wa.copy(col.a).applyMatrix4(col.bone.matrixWorld);
      col.wb.copy(col.b).applyMatrix4(col.bone.matrixWorld);
    }

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i]!;
      const s = armStats[i]!;
      arm.prevDelta.copy(arm.delta);
      arm.reachLimited = false;

      _shoulder.setFromMatrixPosition(arm.shoulder.matrixWorld);
      _elbow.setFromMatrixPosition(arm.elbow.matrixWorld);
      arm.wrist.matrixWorld.decompose(_wrist, _handQ, _scale);
      _fist.copy(arm.fistLocal).applyMatrix4(arm.wrist.matrixWorld);

      solveDelta(arm);

      /* ── AN ESCAPE IN PROGRESS IS NEVER REVERSED ──────────────────────────────────────────
       *
       * The one measured regression of the first working build, and it is worth writing down
       * because the geometry that causes it is not obvious. `capsulePush` returns the shortest way
       * out of the collider FROM WHERE THE PROBE IS NOW. Once a probe has travelled past the
       * collider's axis — and the right fist crosses the skull's axis outright at t = 0.68 — the
       * shortest way out points out of the FAR SIDE, i.e. the opposite direction to the one that
       * was being pushed a frame earlier. Applied literally, the correction turns around and drives
       * the hand deeper into the head on its way to the other side: measured 0.051 m of mesh
       * penetration without this pass and 0.080 m with it, a fix that made its own defect worse.
       *
       * The cure is to take the direction already being escaped along as authoritative and strip
       * out any component of the new requirement that opposes it. What survives is the LATERAL
       * part, so a hand crossing the head is deflected around it rather than shoved through it; and
       * when the requirement is exactly opposed, the correction is zero, decays over `releaseTauS`
       * and the pass gets out of the animation's way. Never worse than doing nothing, which is the
       * property a reversal cannot offer.
       *
       * `arm.delta` is the applied correction and therefore already smoothed, which is what makes
       * it a usable memory of the escape: it is a low-passed history of the direction, not one
       * frame's answer. */
      if (arm.delta.lengthSq() > 1e-8 && _want.lengthSq() > 1e-12) {
        _escape.copy(arm.delta).normalize();
        const along = _want.dot(_escape);
        if (along < 0) _want.addScaledVector(_escape, -along);
      }

      /* Shorten the requirement, if need be, so the wrist is never pushed past the arm's usable
       * reach — the elbow keeps its bend and the correction gives way instead. Done on the RAW
       * requirement rather than on the eased one so the ease never has to walk back a target it was
       * already told it could not have. */
      const span = _shoulder.distanceTo(_elbow) + _elbow.distanceTo(_wrist);
      const limit = Math.max(o.maxReach * span, _shoulder.distanceTo(_wrist));
      if (_want.lengthSq() > 1e-12) {
        const k = reachScale(_shoulder, _wrist, _want, limit);
        if (k < 1) {
          _want.multiplyScalar(k);
          arm.reachLimited = true;
        }
      }

      /* Attack when the requirement is growing, release when it is shrinking — see `tauS`. Compared
       * on squared length so a direction change at constant depth takes the SLOW path, which is the
       * conservative reading: the winning collider has changed, and turning a correction is not an
       * emergency the way meeting a new one is. */
      const growing = _want.lengthSq() > arm.delta.lengthSq();
      smoothToward(
        arm.delta,
        _want,
        dt,
        growing ? o.tauS : o.releaseTauS,
        o.maxRateMs,
        maxCorrection,
      );
      arm.jitterM = arm.delta.distanceTo(arm.prevDelta);

      s.side = arm.side;
      s.penetrationM = arm.penM;
      s.correctionM = arm.delta.length();
      s.jitterM = arm.jitterM;
      s.hit = arm.hit;
      s.reachLimited = arm.reachLimited;

      /* Below a tenth of a millimetre there is nothing to write, and writing anyway would put a
       * float-noise rotation on two bones every frame of the 90 % of the clip that is clear — a
       * ledger entry, two matrix walks and a hand re-orientation, all to move nothing. */
      if (s.correctionM < 1e-4) continue;

      _q.addVectors(_wrist, arm.delta);
      arm.shoulder.matrixWorld.decompose(_p, _shoulderQ, _scale);
      arm.elbow.matrixWorld.decompose(_p, _elbowQ, _scale);
      solveTwoBone(
        _shoulder,
        _elbow,
        _wrist,
        _q,
        _shoulderQ,
        _elbowQ,
        arm.pole,
        o.maxReach,
        out,
      );
      arm.pole.copy(out.bendAxis);
      s.reachLimited = s.reachLimited || out.clamped;

      /* World rotation -> local, against each bone's LIVE parent. The upper arm is solved and its
       * subtree refreshed first, so the forearm's parent world below is the post-solve one. */
      if (arm.shoulder.parent !== null) {
        arm.shoulder.parent.matrixWorld.decompose(_p, _wq2, _scale);
        _tmpQ.copy(_wq2).invert().multiply(out.hipWorld);
      } else {
        _tmpQ.copy(out.hipWorld);
      }
      const wUpper = rememberQuat(arm.shoulder, _wq.copy(arm.shoulder.quaternion));
      arm.shoulder.quaternion.copy(_tmpQ);
      arm.shoulder.updateMatrixWorld(true);
      wUpper.after.copy(arm.shoulder.quaternion);

      if (arm.elbow.parent !== null) {
        arm.elbow.parent.matrixWorld.decompose(_p, _wq2, _scale);
        _tmpQ.copy(_wq2).invert().multiply(out.kneeWorld);
      } else {
        _tmpQ.copy(out.kneeWorld);
      }
      const wFore = rememberQuat(arm.elbow, _wq.copy(arm.elbow.quaternion));
      arm.elbow.quaternion.copy(_tmpQ);
      arm.elbow.updateMatrixWorld(true);
      wFore.after.copy(arm.elbow.quaternion);

      if (o.preserveHandOrientation && arm.wrist.parent !== null) {
        /* `_handQ` still holds the hand's ANIMATED world rotation, decomposed above before any of
         * this frame's arm rotations existed. That is the orientation the fist is put back onto. */
        arm.wrist.parent.matrixWorld.decompose(_p, _wq2, _scale);
        _tmpQ.copy(_wq2).invert().multiply(_handQ);
        const wHand = rememberQuat(arm.wrist, _wq.copy(arm.wrist.quaternion));
        arm.wrist.quaternion.copy(_tmpQ);
        arm.wrist.updateMatrixWorld(true);
        wHand.after.copy(arm.wrist.quaternion);
      }
    }

    stats.enabled = enabled;
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
        for (const arm of arms) {
          arm.delta.set(0, 0, 0);
          arm.prevDelta.set(0, 0, 0);
          arm.penM = 0;
          arm.jitterM = 0;
          arm.hit = null;
        }
        for (const s of armStats) {
          s.penetrationM = 0;
          s.correctionM = 0;
          s.jitterM = 0;
          s.hit = null;
          s.reachLimited = false;
        }
      }
    },
    dispose(): void {
      restore();
      character.root.updateMatrixWorld(true);
      written.length = 0;
      arms.length = 0;
      armStats.length = 0;
      colliders.length = 0;
    },
    stats,
  };
}
