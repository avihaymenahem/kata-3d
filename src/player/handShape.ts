/**
 * B6 PLAYER — `src/player/handShape.ts` — the karateka's HAND, which no capture drives.
 *
 * ═══ WHY THIS EXISTS ═════════════════════════════════════════════════════════════════════════
 *
 * `heian-nidan.bvh` is 20 joints and ends each arm AT the wrist — no finger, no thumb, no end site
 * (see the hands note in `./retarget.ts`). The character is a 53-joint Rigify with 30 finger bones.
 * So the bake writes every one of those 30 a CONSTANT track pinned to bind (the `pairByTarget` miss
 * loop at the end of `retargetBvhClip`), and bind on this rig is a FLAT, SPLAYED, OPEN HAND.
 *
 * The result is a karateka who punches with an open hand for the entire kata. Of everything still
 * wrong with the figure, that is the one a person who has never trained can name at a glance: a
 * seiken-zuki lands on the first two knuckles, and there are no knuckles on an open hand.
 *
 * Nothing in a capture can fix it, now or later, unless the capture has fingers — and none of the
 * academic Shotokan sets do. The shape is not motion; it is a POSE the technique NAMES, and B2's
 * kata data already names it: every `KataMove.tech.hand` carries one of the four values below. So
 * this module is not inventing choreography. It is applying data the score has always had and the
 * render path has never read.
 *
 * ═══ THE NUMBERS ARE NOT NEW EITHER ══════════════════════════════════════════════════════════
 *
 * `src/solve/hand.ts` and `HAND_SHAPE_ANGLES` (doc 03 §12) authored these four shapes as per-joint
 * angles for the RETIRED procedural rig, against B1's 52-bone contract skeleton. That skeleton
 * collapses all four fingers into one representative chain and gives the thumb two bones; Rigify
 * has four separate fingers of three bones each plus a three-bone thumb. The JOINTS still
 * correspond one for one —
 *
 *     fingers_prox = MCP = `DEF-f_*.01`   ·   fingers_dist = PIP = `DEF-f_*.02`
 *     fingers_end  = DIP = `DEF-f_*.03`   ·   thumb = CMC = `DEF-thumb.01`
 *     thumb_end = MCP+IP combined, which Rigify splits across `DEF-thumb.02` and `.03`
 *
 * — so the angles carry over unchanged, and the only authoring decision here is how to divide the
 * contract's single combined `thumb_end` figure between the two bones Rigify has. It is SPLIT, not
 * duplicated: the doc's 35° of distal thumb flexion stays 35° in total (20 + 15), because doubling
 * it would be inventing curl the source never published.
 *
 * ═══ THE AXIS PROBLEM, AND WHY IT IS SOLVED BY MEASUREMENT ═══════════════════════════════════
 *
 * Rigify keeps Blender's bone-local frames. This project has already paid twice for assuming what a
 * local axis means — the pelvis whose own "up" is local +Z (`./footIk`, `./retarget`) — and a finger
 * gets it wrong in the most visible way available: rotate about the wrong local axis and the hand
 * does not close, it SPLAYS SIDEWAYS, which reads as a deformity rather than as a bug.
 *
 * Two candidate measurements exist and only one of them works here:
 *
 *   1. THE BIND BEND PLANE — `cross(prox→mid, mid→dist)`, exactly what `bendPlaneNormal` gives the
 *      elbow. UNUSABLE ON THIS RIG, and measurably so: the bind fingers are dead straight. Measured
 *      interior bend, both hands, all five digits: 0.00°, 0.17°, 0.00°, 0.10°, 0.02°. The resulting
 *      "axes" are float noise and they do not even agree between hands — the left index reports
 *      (0, −0.97, +0.23) against the right index's (0, −0.03, −1.00) for what is a mirrored joint.
 *      Shipping that would have splayed one hand and curled the other.
 *
 *   2. THE PALM PLANE — which is real, measurable, and mirror-consistent. The four MCP joints and
 *      the wrist are coplanar to under a millimetre (all five sit at y = 1.4388…1.4412 in the bind
 *      T-pose), so `cross(fingerDirection, knuckleLine)` is a well-conditioned normal to it. Its
 *      SIGN is handedness-dependent and therefore cannot be trusted — it comes out +Y on the left
 *      and −Y on the right for the same anatomical side of the same pose — so the sign is settled
 *      ANATOMICALLY, by the thumb: the thumb opposes the fingers, so its distal end is on the palmar
 *      side by construction. Measured here at 63.9 mm below the knuckle plane on BOTH hands against
 *      a 43 mm metacarpal, which is not a margin floating point can flip.
 *
 * The answer, on both hands, is that the palm faces world −Y at bind — the ordinary palms-down
 * T-pose — and every curl axis in this file is `swingAxis(alongBone, palmFacing)` derived from that.
 * Nothing here names X, Y or Z.
 *
 * ═══ WHY THE POSES ARE PRECOMPUTED QUATERNIONS AND THE BLEND IS A SLERP ══════════════════════
 *
 * Each digit's target local rotation for each shape is `bindLocal · delta`, and every term of that
 * is constant — so all 4 shapes × 30 bones are built ONCE and the per-frame path is one slerp per
 * bone, no trigonometry and no allocation.
 *
 * Writing an ABSOLUTE value derived from bind (rather than composing onto whatever is on the bone)
 * is what makes the pass idempotent. It runs after `character.update()`, on bones the mixer has just
 * written; a relative compose would accumulate into a hand that curls itself shut over a few seconds
 * the moment a clip stopped supplying finger tracks.
 *
 * The blend is a SLERP and not a lerp of the angles, for the reason `src/solve/hand.ts` gives:
 * interpolating a 45° thumb adduction as Euler components takes the joint through a different path
 * than the shortest arc, and on `shuto` — where the thumb tucks across the palm — that path passes
 * through the fingers.
 *
 * ═══ WHY IT BLENDS AT ALL ════════════════════════════════════════════════════════════════════
 *
 * A fist that appears in one frame reads as a glitch, not as a technique: 265° of total finger curl
 * arriving in 16 ms is a pop, and the eye catches it precisely because the hand is what it was
 * already watching. 0.15 s is ~9 display frames — under a tenth of the 1.3–1.8 s a Taikyoku count
 * occupies, so the shape is fully formed well before kime and is never the thing that lands late.
 */

import { Quaternion, Vector3, type Bone, type Skeleton } from 'three';

import type { HandShape, Handedness } from '../contracts';
import { sanitizeBoneName, type Character } from './character';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The shapes — pure data, no rig, no three
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * doc 03 §12's four hand shapes.
 *
 * Written as the literal union so this module reads standalone, and tied to B1's frozen `HandShape`
 * by the `satisfies` on `HAND_SHAPES` below — a fifth shape added to the contract fails to compile
 * here rather than silently falling through to the default.
 */
export type HandShapeId = 'seiken' | 'shuto' | 'open' | 'nukite';

/** Flexion at the three finger joints, degrees. Positive always curls TOWARD the palm. */
export interface FingerCurl {
  /** Knuckle — `DEF-f_*.01`. */
  readonly mcpDeg: number;
  /** Middle joint — `DEF-f_*.02`. */
  readonly pipDeg: number;
  /** Last joint — `DEF-f_*.03`. */
  readonly dipDeg: number;
}

/**
 * The thumb, which is not a finger and does not move like one — and on this rig cannot be posed
 * like one either.
 *
 * ═══ WHY THE METACARPAL IS AIMED AND NOT FLEXED ══════════════════════════════════════════════
 *
 * doc 03 §12 gives the thumb an angle pair at the CMC — 32° flexion plus 28° adduction for seiken,
 * 40/45 for shuto — and those numbers are authored against a hand whose thumb metacarpal STARTS IN
 * THE PALM PLANE. This rig's does not: measured off its bind pose, `DEF-thumb.01` already leaves
 * the plane of the four knuckles by 24°, and the tip of the three-bone chain sits 64 mm palmward of
 * it before anything is posed. On that geometry "flex further toward the palm" points the thumb
 * UNDER the fist rather than across its face, and the numbers do exactly that: applied literally
 * they left the thumb tip 133 mm from the folded index/middle phalanges — further away than the
 * open hand's own 109 mm.
 *
 * That is not a tuning miss, and it was checked before being called one. A sweep of the WHOLE
 * (CMC flexion 10–70°) × (adduction 0–80°) × (MCP 10–70°) × (IP 0–60°) grid on this rig could not
 * bring the tip closer than 81 mm, and its optimum sat at the LOW end of every flexion range —
 * i.e. every degree of the motion the doc calls for makes this thumb worse. The thumb chain reaches
 * 132 mm from the CMC and the fist face is 103 mm away, so the reach was never the problem. The
 * BEARING was.
 *
 * So the metacarpal is AIMED instead: swung onto the direction from its own root to where THAT
 * SHAPE's folded fingers actually end up, computed from the rig's bind geometry and the shape's own
 * finger angles. The same formula serves every shape because the target moves with the fingers —
 * a fist's fingers fold and the thumb comes across them; a knife-hand's stay straight and the same
 * aim lays the thumb alongside them, which is what "thumb tucked" means. `mcpFlexDeg`/`ipFlexDeg`
 * then WRAP the last two bones so the pad lies on the fingers instead of standing off them.
 */
export interface ThumbCurl {
  /**
   * How far along the swing from bind to the finger bearing the metacarpal goes, 0..1. 1 points the
   * straight thumb exactly at the target; the wrap below takes up the overshoot.
   */
  readonly aim: number;
  /** `DEF-thumb.02` — the thumb's own knuckle. */
  readonly mcpFlexDeg: number;
  /** `DEF-thumb.03` — the interphalangeal joint. */
  readonly ipFlexDeg: number;
}

export interface HandShapeSpec {
  readonly finger: FingerCurl;
  readonly thumb: ThumbCurl;
  /**
   * How much of the rig's OWN bind splay to keep. 1 leaves the fingers fanned as modelled; 0 brings
   * every finger parallel to the middle one, which is what "fingers together" means for a shape that
   * asks for it.
   *
   * A fraction of a measured quantity rather than an authored angle, because the splay is a property
   * of the model and not of the kata: on this rig it is 2.71° (index), 0.36° (ring) and 1.13°
   * (pinky) off the middle finger. Small — the knuckles are already only 22–26 mm apart, so the
   * fingers are nearly touching at bind — but it is the literal content of "straight and TOGETHER",
   * and a differently-modelled hand with a wider fan gets closed by the same code.
   */
  readonly spread: number;
}

/**
 * doc 03 §12, joint for joint, via `src/solve/hand.ts`'s `HAND_POSES`.
 *
 * SEIKEN is the one that matters and it is deliberately the extreme of the table: 88 + 105 + 72 =
 * 265° of curl per finger, which folds the fingertips flat against the palm and leaves the proximal
 * phalanges standing square to it. That squareness IS the technique — a fore-fist strikes on the
 * first two knuckles, and a loose curl presents the middle phalanges instead, which is both wrong
 * and, on a fighter, how fingers get broken.
 */
export const HAND_SHAPES: Readonly<Record<HandShapeId, HandShapeSpec>> = Object.freeze({
  /**
   * doc 03 §12.1 — MCP 88, PIP 105, DIP 72. The fingers are the doc's, unchanged.
   *
   * The thumb is not, and the numbers are CALIBRATED against this rig rather than authored: swept
   * over aim 0.2–0.5 × MCP 30–60° × IP 50–80°, `(0.25, 35, 80)` puts the thumb tip 25 mm from the
   * middle phalanges of the folded index and middle fingers and 18 mm PROUD of them — resting on
   * the fist rather than sunk into it. Most of the fold sits in the last joint because most of the
   * excess length is out there; a bigger share at the MCP drives the tip through the fingers
   * (measured 12 mm of proud at MCP 40, 4 mm at MCP 50).
   *
   * The `aim` is deliberately SMALL. This rig's bind thumb already points roughly along the palm,
   * so most of the closing is fold, not swing — pushing the aim to 1.0 with the same wrap sails the
   * tip 43 mm past the fist instead of onto it.
   */
  seiken: Object.freeze({
    finger: Object.freeze({ mcpDeg: 88, pipDeg: 105, dipDeg: 72 }),
    thumb: Object.freeze({ aim: 0.25, mcpFlexDeg: 35, ipFlexDeg: 80 }),
    spread: 0,
  }),

  /**
   * doc 03 §12.2 — MCP 6, PIP 6, DIP 3; thumb tucked hard alongside the blade.
   *
   * Nearly all swing and almost no fold, which is the opposite of the fist and is what "tucked"
   * means for a knife-hand: the thumb lies ALONG the extended fingers, out of the striking edge's
   * way, rather than curling under them. Measured 19 mm from the index/middle phalanges.
   */
  shuto: Object.freeze({
    finger: Object.freeze({ mcpDeg: 6, pipDeg: 6, dipDeg: 3 }),
    thumb: Object.freeze({ aim: 0.9, mcpFlexDeg: 10, ipFlexDeg: 15 }),
    spread: 0,
  }),

  /**
   * doc 03 §12.3 — fingers extended and pressed together, PIP 12° so the tips line up.
   *
   * The doc publishes that 12° for its ONE representative (middle) finger and says what it is for:
   * levelling the fingertips of the spear-hand. Applied uniformly here, which levels nothing —
   * the middle finger still reaches 21 mm past the index. Honest and visible rather than invented;
   * a per-finger version wants the four tip distances, which this rig has but the doc does not.
   */
  nukite: Object.freeze({
    finger: Object.freeze({ mcpDeg: 0, pipDeg: 12, dipDeg: 0 }),
    thumb: Object.freeze({ aim: 0.9, mcpFlexDeg: 10, ipFlexDeg: 15 }),
    spread: 0,
  }),

  /**
   * The relaxed hand of doc 02 §2's rei and yoi ("hands open, thumbs tucked"). doc 03 publishes no
   * joint table for it — these are `ART` in B1's terms, a shuto with the tension released — and it
   * is the only shape that keeps the model's own finger fan, because a hanging hand is not held.
   *
   * The partial `aim` is what "relaxed" means here: the thumb drifts most of the way toward the
   * fingers and stops, instead of being pressed against them the way a held shape presses it.
   */
  open: Object.freeze({
    finger: Object.freeze({ mcpDeg: 10, pipDeg: 8, dipDeg: 4 }),
    thumb: Object.freeze({ aim: 0.45, mcpFlexDeg: 7, ipFlexDeg: 5 }),
    spread: 1,
  }),
}) satisfies Readonly<Record<HandShape, HandShapeSpec>>;

/**
 * Which shape the PULLING hand takes, given the move's hikite form.
 *
 * Not always the same as the working hand's, and `src/solve/hand.ts` settled which: doc 02 §1.3's
 * TATE-B rides on the centre line behind a shuto-uke and is an open blade, while HIP-A is a closed
 * fist on the hip. doc 02 §9 d6 resolves the one case sources disagree on — Heian 7–9's non-blocking
 * hand is a fist, not open. A punch's hikite is therefore always `seiken`, which is the case that
 * matters for Taikyoku Shodan, where all twenty counts use HIP-A.
 */
export function hikiteHandShape(form: 'HIP-A' | 'TATE-B' | 'NONE'): HandShapeId {
  return form === 'TATE-B' ? 'shuto' : 'seiken';
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Pure geometry — the axis derivation, testable with no GLB
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Below this sine between two directions there is no well-conditioned axis between them.
 *
 * 0.02 is 1.15°. Chosen against the quantity it is protecting: the finger-to-palm angle is 90° by
 * construction (the fingers lie IN the palm plane, the palm normal is perpendicular to it), so a
 * legitimate curl axis is never anywhere near this floor. Anything that is means the palm plane
 * itself did not resolve, and the honest answer is to leave that bone at bind.
 */
export const MIN_SWING_SIN = 0.02;

/**
 * The rotation axis whose POSITIVE angle swings `along` toward `toward`, in whatever frame both are
 * expressed in. `null` when the two are parallel and there is no arc between them.
 *
 * `cross(a, t)` and not `cross(t, a)`, and the sign is the whole point, so here is the check rather
 * than the assertion: rotating `a` about `w` by a small angle moves it by `w × a`, and with
 * `w = a × t` that is `(a × t) × a = t(a·a) − a(a·t) = t` for perpendicular unit inputs. Positive
 * therefore means "toward `toward`" for any pair, on either hand, on any rig — which is exactly why
 * this file can be axis-convention-free.
 */
export function swingAxis(along: Vector3, toward: Vector3): Vector3 | null {
  const w = new Vector3().crossVectors(along, toward);
  const sin = w.length() / Math.max(1e-12, along.length() * toward.length());
  return sin < MIN_SWING_SIN ? null : w.normalize();
}

/**
 * The unit vector the PALM FACES — i.e. the side the fingers curl toward — from bind geometry alone.
 *
 * `null` when the hand's own geometry cannot answer: a degenerate knuckle line, or a thumb sitting
 * in the palm plane and therefore naming no side. Both are "leave the hand at bind", never a guess.
 *
 * @param wrist      hand-bone origin.
 * @param mcpIndex   index knuckle.
 * @param mcpPinky   little-finger knuckle. With `mcpIndex` these give the knuckle line.
 * @param fingerDir  which way the fingers point — any finger's proximal segment will do.
 * @param thumbTip   distal thumb joint. THE SIGN COMES FROM HERE; see the header.
 */
export function palmFacing(
  wrist: Vector3,
  mcpIndex: Vector3,
  mcpPinky: Vector3,
  fingerDir: Vector3,
  thumbTip: Vector3,
): Vector3 | null {
  const across = new Vector3().subVectors(mcpPinky, mcpIndex);
  const n = swingAxis(fingerDir, across);
  if (n === null) return null;
  /* How far the thumb's far end sits off the palm plane, in metres. Measured on this rig at
   * 0.0639 m against a 0.0430 m thumb metacarpal — the thumb is not merely off-plane, it is most of
   * a bone's length off it, on both hands. A threshold a tenth of that rejects a rig whose thumb was
   * modelled flat (no side to read) without ever rejecting an anatomical one. */
  const palmar = n.dot(new Vector3().subVectors(thumbTip, wrist));
  if (Math.abs(palmar) < 0.004) return null;
  return palmar > 0 ? n : n.negate();
}

/**
 * Ease for the shape change: Hermite smoothstep on `[0, 1]`, clamped.
 *
 * The same curve `choreography.ts` uses for the embusen travel, and for the same reason — a linear
 * ramp has a velocity step at both ends, and on a fist closing over 265° that step is visible as a
 * flick at the start and a stop at the end. Smoothstep is zero-derivative at both, so the hand
 * departs from and arrives at rest.
 *
 * Deliberately NOT `kimeEase`. That curve is asymmetric about a peak because a STRIKE is: it models
 * a stroke that accelerates to kime. A hand shape has no kime — it is not travelling anywhere — and
 * borrowing the strike's asymmetry would make the fist form fastest at a moment chosen for a
 * different quantity.
 */
export function handEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The rig side
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** The four fingers, in knuckle order. `middle` is the splay reference — see `HandShapeSpec`. */
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
type FingerId = (typeof FINGERS)[number];
type DigitId = FingerId | 'thumb';

/**
 * Digit chains per rig convention, proximal -> distal, with `%` standing in for the side.
 *
 * Authored with Rigify's DOTS intact and looked up through `sanitizeBoneName`, exactly as
 * `CONTRACT_TO_RIGIFY` is: three strips `.` from every glTF node name, so `DEF-f_index.01.L` arrives
 * as `DEF-f_index01L`. A table written against the sanitized names would work and would then be the
 * only place in the codebase spelling Rigify differently from Blender.
 *
 * The contract map in `./character.ts` cannot serve here: it collapses all four fingers onto the
 * middle one (`fingers_prox_L -> DEF-f_middle.01.L`) and has no name at all for `DEF-thumb.02`.
 * That collapse was right for a solver posing one representative chain and is wrong for a hand you
 * can see, where a fist is four fingers or it is nothing.
 */
const DIGIT_CHAINS: Readonly<Record<'rigify' | 'mixamo', Readonly<Record<DigitId, readonly string[]>>>> =
  Object.freeze({
    rigify: Object.freeze({
      index: Object.freeze(['DEF-f_index.01.%', 'DEF-f_index.02.%', 'DEF-f_index.03.%']),
      middle: Object.freeze(['DEF-f_middle.01.%', 'DEF-f_middle.02.%', 'DEF-f_middle.03.%']),
      ring: Object.freeze(['DEF-f_ring.01.%', 'DEF-f_ring.02.%', 'DEF-f_ring.03.%']),
      pinky: Object.freeze(['DEF-f_pinky.01.%', 'DEF-f_pinky.02.%', 'DEF-f_pinky.03.%']),
      thumb: Object.freeze(['DEF-thumb.01.%', 'DEF-thumb.02.%', 'DEF-thumb.03.%']),
    }),
    /* Mixamo spells the side out and prefixes every joint `mixamorig:`; `Character.bones` registers
     * both the raw and the stripped name, so the bare form resolves on either. Kept current because
     * `Xbot.glb` is still the `?model=` option and the path to Mixamo-retargeted clips. */
    mixamo: Object.freeze({
      index: Object.freeze(['%HandIndex1', '%HandIndex2', '%HandIndex3']),
      middle: Object.freeze(['%HandMiddle1', '%HandMiddle2', '%HandMiddle3']),
      ring: Object.freeze(['%HandRing1', '%HandRing2', '%HandRing3']),
      pinky: Object.freeze(['%HandPinky1', '%HandPinky2', '%HandPinky3']),
      thumb: Object.freeze(['%HandThumb1', '%HandThumb2', '%HandThumb3']),
    }),
  });

export interface HandShaperOpts {
  /** Seconds to ease between two shapes. See `HAND_BLEND_S`. */
  readonly blendS?: number;
  /** Shape both hands start in. `open` is the closest thing to the rig's own bind hand. */
  readonly initial?: HandShapeId;
  /** Start switched off, for an A/B against the un-shaped hand. */
  readonly enabled?: boolean;
}

/** Default ease. ~9 display frames — fast enough to precede kime, slow enough not to pop. */
export const HAND_BLEND_S = 0.15;

export interface HandSideStats {
  readonly side: Handedness;
  /** Shape being eased toward — what the score last asked for. */
  readonly shape: HandShapeId;
  /** 0..1 through the current ease. 1 means the shape is fully formed. */
  readonly blend: number;
  /** Bones this side actually drives. 15 on a complete Rigify hand; 0 means the rig gave up none. */
  readonly bones: number;
  /** The measured palm normal, world at bind. `null` means the hand is NOT being shaped. */
  readonly palm: readonly [number, number, number] | null;
}

export interface HandShaperStats {
  readonly enabled: boolean;
  readonly sides: readonly HandSideStats[];
  readonly frames: number;
}

export interface HandShaper {
  /**
   * Ask one hand for a shape. A no-op when it is already the target, so a caller may call this every
   * frame from the score without restarting the ease.
   *
   * `blendS` of 0 snaps, which is what boot wants — a figure that fades its fists in over the first
   * frames of the page reads as a loading artefact.
   */
  set(side: Handedness, shape: HandShapeId, blendS?: number): void;
  /**
   * Advance the eases and write the fingers. Call AFTER `character.update(dt)`, which is the thing
   * that puts the mixer's (bind-pinned, or boxing-clip) finger rotations on the bones this then
   * replaces. Order against `footIk` does not matter: no bone is touched by both.
   */
  update(dtS?: number): void;
  /** Restore the animated hand, for an A/B toggle. */
  setEnabled(on: boolean): void;
  dispose(): void;
  readonly stats: HandShaperStats;
}

/* ── implementation ────────────────────────────────────────────────────────────────────────── */

interface Phalanx {
  readonly bone: Bone;
  /** Target local rotation per shape — `bindLocal · delta`, constant, built once. */
  readonly poses: Record<HandShapeId, Quaternion>;
  /** Value written last frame. Doubles as the snapshot a mid-ease `set` blends away from. */
  readonly cur: Quaternion;
  /** Where the current ease started. */
  readonly from: Quaternion;
  /** What was on the bone immediately before this pass last wrote it — the rollback value. */
  readonly before: Quaternion;
  /** True once `before` holds a real reading. */
  written: boolean;
}

interface Side {
  readonly side: Handedness;
  readonly phalanges: Phalanx[];
  readonly palm: Vector3 | null;
  shape: HandShapeId;
  blendS: number;
  /** Seconds into the current ease. */
  t: number;
  /** False while an ease is running. */
  settled: boolean;
}

/** The character's skeleton, wherever the loader put it. */
function skeletonOf(character: Character): Skeleton | null {
  let found: Skeleton | null = null;
  character.root.traverse((o) => {
    if (found === null && (o as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) {
      found = (o as unknown as { skeleton: Skeleton }).skeleton;
    }
  });
  return found;
}

const DEG = Math.PI / 180;

/**
 * How far OUT of the finger bone axis the thumb's aim point sits, metres.
 *
 * Half this mesh's finger thickness plus half the thumb's. The bones run down the middle of the
 * geometry, so aiming at a bone axis aims INSIDE the finger and the thumb pad sinks through it.
 * 18 mm on a hand whose proximal phalanx is 40 mm long is the right order; the wrap angles take up
 * whatever this misses, which is why it does not need to be exact.
 */
const THUMB_LAY_M = 0.018;

/**
 * Build the hand-shape pass for `character`.
 *
 * NEVER THROWS. A rig with no fingers, no thumb, or an unresolvable palm yields a handle whose
 * `update()` is a no-op and whose `stats` says which hand it gave up on — the same failure policy
 * as `createFootIk`, and for the same reason: a viewer that shows an un-shaped hand is a worse
 * viewer, while a viewer that will not boot is no viewer.
 */
export function createHandShaper(character: Character, opts: HandShaperOpts = {}): HandShaper {
  const blendS = opts.blendS ?? HAND_BLEND_S;
  const initial: HandShapeId = opts.initial ?? 'open';
  let enabled = opts.enabled ?? true;

  const skeleton = skeletonOf(character);
  const chains =
    character.flavour === 'mixamo' ? DIGIT_CHAINS.mixamo : DIGIT_CHAINS.rigify;
  const sideToken = (s: Handedness): string =>
    character.flavour === 'mixamo' ? (s === 'L' ? 'Left' : 'Right') : s;

  /** By name, tolerating the dot-stripping every glTF node name goes through. */
  const boneNamed = (name: string): Bone | null =>
    character.bones.get(name) ?? character.bones.get(sanitizeBoneName(name)) ?? null;

  /** Bind WORLD rotation and position of a bone, from `boneInverses` — immune to what is playing. */
  const bindOf = (bone: Bone | null): { p: Vector3; q: Quaternion } | null => {
    if (skeleton === null || bone === null) return null;
    const i = skeleton.bones.indexOf(bone);
    if (i < 0) return null;
    const inv = skeleton.boneInverses[i];
    if (inv === undefined) return null;
    const p = new Vector3();
    const q = new Quaternion();
    inv.clone().invert().decompose(p, q, new Vector3());
    return { p, q };
  };

  const sides: Side[] = [];

  for (const side of ['L', 'R'] as const) {
    const tok = sideToken(side);
    const nameOf = (digit: DigitId, j: number): string =>
      (chains[digit][j] ?? '').replace('%', tok);

    /* Every digit's three bones plus their bind frames, or nothing. A hand missing a joint is not
     * half-shaped: the chain's angles are cumulative, so a fist with no PIP is not a looser fist,
     * it is a hand with one finger sticking out. */
    const digits = new Map<DigitId, { bones: Bone[]; bind: { p: Vector3; q: Quaternion }[] }>();
    for (const digit of [...FINGERS, 'thumb'] as const) {
      const bones: Bone[] = [];
      const bind: { p: Vector3; q: Quaternion }[] = [];
      for (let j = 0; j < 3; j++) {
        const b = boneNamed(nameOf(digit, j));
        const bb = bindOf(b);
        if (b === null || bb === null) break;
        bones.push(b);
        bind.push(bb);
      }
      if (bones.length === 3) digits.set(digit, { bones, bind });
    }

    const wrist = bindOf(character.boneFor(side === 'L' ? 'hand_L' : 'hand_R'));
    const index = digits.get('index');
    const middle = digits.get('middle');
    const pinky = digits.get('pinky');
    const thumb = digits.get('thumb');

    /**
     * The one direction everything else hangs off. Without all four of these the palm plane has no
     * definition and the hand is left exactly as the animation delivered it — which is the current,
     * visibly wrong behaviour, and strictly better than a hand curled about a guessed axis.
     */
    const palm =
      wrist === null || index === undefined || middle === undefined || pinky === undefined || thumb === undefined
        ? null
        : palmFacing(
            wrist.p,
            index.bind[0]!.p,
            pinky.bind[0]!.p,
            new Vector3().subVectors(middle.bind[1]!.p, middle.bind[0]!.p),
            thumb.bind[2]!.p,
          );

    /** The middle finger's proximal direction — what "together" is measured against. */
    const midDir =
      middle === undefined
        ? null
        : new Vector3().subVectors(middle.bind[1]!.p, middle.bind[0]!.p).normalize();

    const ALL_SHAPES = Object.keys(HAND_SHAPES) as HandShapeId[];

    /** Bind LOCAL, from the two bind WORLDs — never read off a bone that may be carrying a clip. */
    const bindLocalOf = (bone: Bone, bind: { q: Quaternion }): Quaternion => {
      const parent =
        bone.parent === null || (bone.parent as { isBone?: boolean }).isBone !== true
          ? null
          : bindOf(bone.parent as Bone);
      return parent === null ? bind.q.clone() : parent.q.clone().invert().multiply(bind.q);
    };

    /**
     * A digit bone's own direction toward its tip, in WORLD at bind.
     *
     * The distal bone (`j === 2`) has no child in the DEF chain, so it borrows the whole chain's
     * direction. That is a measurement, not a shortcut: this rig's bind digits are collinear to
     * 0.00–0.17° (the same fact that ruled the bend-plane method out above), so the borrowed
     * direction is right to within a fifth of a degree.
     */
    const alongOf = (chain: { bind: { p: Vector3 }[] }, j: number): Vector3 | null => {
      const from = j === 2 ? chain.bind[0]!.p : chain.bind[j]!.p;
      const to = j === 2 ? chain.bind[2]!.p : chain.bind[j + 1]!.p;
      const v = new Vector3().subVectors(to, from);
      return v.lengthSq() < 1e-12 ? null : v.normalize();
    };

    const phalanges: Phalanx[] = [];
    /** Per-digit, per-bone, per-shape LOCAL DELTA from bind. Kept so the thumb can FK the fingers. */
    const deltas = new Map<DigitId, Record<HandShapeId, Quaternion>[]>();

    const addPhalanx = (
      bone: Bone,
      bind: { q: Quaternion },
      byShape: Record<HandShapeId, Quaternion>,
    ): void => {
      const bindLocal = bindLocalOf(bone, bind);
      const poses = {} as Record<HandShapeId, Quaternion>;
      for (const id of ALL_SHAPES) poses[id] = bindLocal.clone().multiply(byShape[id]);
      phalanges.push({
        bone,
        poses,
        cur: poses[initial].clone(),
        from: poses[initial].clone(),
        before: new Quaternion(),
        written: false,
      });
    };

    /* ── phase 1: the four fingers ──────────────────────────────────────────────────────────── */
    if (palm !== null && midDir !== null) {
      for (const digit of FINGERS) {
        const chain = digits.get(digit);
        if (chain === undefined) continue;
        const perBone: Record<HandShapeId, Quaternion>[] = [];
        for (let j = 0; j < 3; j++) {
          const along = alongOf(chain, j);
          const curlWorld = along === null ? null : swingAxis(along, palm);
          if (along === null || curlWorld === null) break;
          const invBind = chain.bind[j]!.q.clone().invert();
          /* Into the bone's OWN frame, so post-multiplying `bindLocal` rotates about it — the one
           * step where a hard-coded axis would have been silently wrong on this rig. */
          const curl = curlWorld.clone().applyQuaternion(invBind);

          /* The knuckle gets a second, sideways degree of freedom: the fan the model was built with,
           * closed by swinging each finger onto the MIDDLE finger's own bearing. Measured, not
           * authored — see `HandShapeSpec.spread`. */
          const alignAxis = j === 0 ? swingAxis(along, midDir) : null;
          const alignRad = j === 0 ? along.angleTo(midDir) : 0;
          if (alignAxis !== null) alignAxis.applyQuaternion(invBind);

          const byShape = {} as Record<HandShapeId, Quaternion>;
          for (const id of ALL_SHAPES) {
            const spec = HAND_SHAPES[id];
            const flexDeg = [spec.finger.mcpDeg, spec.finger.pipDeg, spec.finger.dipDeg][j]!;
            const q = new Quaternion().setFromAxisAngle(curl, flexDeg * DEG);
            if (alignAxis !== null) {
              /* Sideways first, curl on top. The correction is at most 2.71° here, so the order is
               * immaterial on a finger; it is written this way to match the thumb, where it is not. */
              q.premultiply(
                new Quaternion().setFromAxisAngle(alignAxis, alignRad * (1 - spec.spread)),
              );
            }
            byShape[id] = q;
          }
          perBone.push(byShape);
          addPhalanx(chain.bones[j]!, chain.bind[j]!, byShape);
        }
        if (perBone.length === 3) deltas.set(digit, perBone);
      }
    }

    /**
     * ═══ PHASE 2: WHERE THIS SHAPE'S FINGERS ACTUALLY END UP ═════════════════════════════════
     *
     * Forward-kinematic the index and middle chains from the BIND pose using the shape's own local
     * deltas, and take the middle of each proximal-to-distal span. For a fist that point is the
     * front face of the folded fingers; for a knife-hand it is simply a point out along them. The
     * thumb is then aimed at it, which is why one rule covers both: what the thumb should do is
     * "go where the fingers went", and the fingers are where the shape put them.
     *
     * Exact rather than approximated — `world = parentWorld · local` composed twice — and it costs
     * four shapes × two fingers of quaternion algebra ONCE, at construction.
     */
    const fingerFace = (id: HandShapeId): Vector3 | null => {
      const acc = new Vector3();
      let n = 0;
      for (const digit of ['index', 'middle'] as const) {
        const chain = digits.get(digit);
        const d = deltas.get(digit);
        if (chain === undefined || d === undefined) continue;
        const [q0, q1] = [chain.bind[0]!.q, chain.bind[1]!.q];
        const [p0, p1, p2] = [chain.bind[0]!.p, chain.bind[1]!.p, chain.bind[2]!.p];
        /* `W0 = Qparent · bindLocal0 · d0`, and `Qparent · bindLocal0` IS the bone's bind world. */
        const w0 = q0.clone().multiply(d[0]![id]);
        const w1 = w0
          .clone()
          .multiply(q0.clone().invert().multiply(q1))
          .multiply(d[1]![id]);
        const pip = new Vector3()
          .subVectors(p1, p0)
          .applyQuaternion(q0.clone().invert())
          .applyQuaternion(w0)
          .add(p0);
        const dip = new Vector3()
          .subVectors(p2, p1)
          .applyQuaternion(q1.clone().invert())
          .applyQuaternion(w1)
          .add(pip);
        acc.add(pip).add(dip);
        n += 2;
      }
      if (n === 0) return null;
      acc.divideScalar(n);
      /* Out to the SURFACE the thumb lies on, not to the bone axis inside it. 18 mm is half this
       * mesh's finger thickness plus half the thumb's; without it the aim points into the fingers
       * and the pad sinks through them. */
      return palm === null ? acc : acc.addScaledVector(palm, THUMB_LAY_M);
    };

    /**
     * ═══ PHASE 3: THE THUMB, AS A PLANAR CHAIN IN THE PLANE IT HAS TO REACH ACROSS ═══════════
     *
     * All three thumb bones turn about ONE axis: the normal of the plane containing the bind thumb
     * and the direction from its root to `fingerFace(id)`. That is the single decision that made
     * the thumb work, and the reason is worth stating because the obvious alternative was tried and
     * measured:
     *
     * Wrapping the last two bones about their own PALM-derived curl axis — the axis every finger
     * uses — is wrong here, because once the metacarpal has swung onto the finger bearing that axis
     * is no longer perpendicular to the plane the thumb has to close in. Bending about it swings the
     * tip sideways OUT of the plane instead of shortening the reach along it, and the best the whole
     * (aim, MCP, IP) grid could then do was 42 mm of residual. About the plane normal the same grid
     * reaches 25 mm with anatomically ordinary angles, and 6 mm if allowed silly ones. The chain
     * stays planar exactly because a rotation about `n` fixes `n`, so every joint below the first
     * still sees the same world axis.
     *
     * The residual will not go to zero on this model and should not be filed as a bug: its thumb
     * reaches 135 mm from the CMC against a 103 mm gap to the fist face, i.e. it is a THIRD longer
     * than the reach it has to make, so something has to be folded harder than a human thumb folds.
     * 25 mm on a hand with 110 mm fingers reads as "thumb over the fist", not as a pinch.
     */
    const thumbChain = digits.get('thumb');
    const thumbAlong = thumbChain === undefined ? null : alongOf(thumbChain, 2);
    if (palm !== null && thumbChain !== undefined && thumbAlong !== null && deltas.size > 0) {
      /** Per shape: the swing onto that shape's own finger bearing, and the plane it happens in. */
      const aims = new Map<HandShapeId, { axis: Vector3; rad: number }>();
      for (const id of ALL_SHAPES) {
        const face = fingerFace(id);
        if (face === null) continue;
        const dir = new Vector3().subVectors(face, thumbChain.bind[0]!.p);
        if (dir.lengthSq() < 1e-12) continue;
        dir.normalize();
        const axis = swingAxis(thumbAlong, dir);
        if (axis !== null) aims.set(id, { axis, rad: thumbAlong.angleTo(dir) });
      }

      for (let j = 0; j < 3; j++) {
        const invBind = thumbChain.bind[j]!.q.clone().invert();
        const byShape = {} as Record<HandShapeId, Quaternion>;
        for (const id of ALL_SHAPES) {
          const spec = HAND_SHAPES[id];
          const aim = aims.get(id);
          if (aim === undefined) {
            byShape[id] = new Quaternion();
            continue;
          }
          const rad =
            j === 0
              ? aim.rad * spec.thumb.aim
              : (j === 1 ? spec.thumb.mcpFlexDeg : spec.thumb.ipFlexDeg) * DEG;
          byShape[id] = new Quaternion().setFromAxisAngle(
            aim.axis.clone().applyQuaternion(invBind),
            rad,
          );
        }
        addPhalanx(thumbChain.bones[j]!, thumbChain.bind[j]!, byShape);
      }
    }

    sides.push({
      side,
      phalanges,
      palm,
      shape: initial,
      blendS,
      t: blendS,
      settled: true,
    });
  }

  const stats: HandShaperStats = {
    enabled,
    frames: 0,
    sides: sides.map((s) => ({
      side: s.side,
      shape: s.shape,
      blend: 1,
      bones: s.phalanges.length,
      palm: s.palm === null ? null : ([s.palm.x, s.palm.y, s.palm.z] as const),
    })),
  };
  /* `stats` is read by the HUD and by the browser probe every frame, so its rows are MUTATED in
   * place rather than rebuilt — a fresh array per frame is 60 allocations a second for a diagnostic
   * nobody is watching most of the time. */
  const rows = stats.sides as {
    side: Handedness;
    shape: HandShapeId;
    blend: number;
    bones: number;
    palm: readonly [number, number, number] | null;
  }[];
  const mutable = stats as { enabled: boolean; frames: number };

  /**
   * Put back whatever was on each bone before this pass last overwrote it — the same ledger idea as
   * `footIk`'s, and for the same reason. The rollback is BIT-FOR-BIT conditional: if the value has
   * moved, the mixer wrote the bone since and restoring would be undoing real animation, not ours.
   *
   * The remembered value is the CLIP's, not bind, so an A/B toggle shows exactly what the viewer
   * had before this module existed rather than a third pose belonging to neither.
   */
  const restore = (): void => {
    for (const s of sides) {
      for (const p of s.phalanges) {
        if (!p.written) continue;
        p.written = false;
        const q = p.bone.quaternion;
        if (q.x === p.cur.x && q.y === p.cur.y && q.z === p.cur.z && q.w === p.cur.w) {
          q.copy(p.before);
        }
      }
    }
  };

  return {
    set(side: Handedness, shape: HandShapeId, blend?: number): void {
      const s = sides.find((x) => x.side === side);
      if (s === undefined || s.shape === shape) return;
      /* The ease restarts from WHERE THE HAND IS, not from the shape it was nominally in. A count
       * that changes shape mid-transition — Heian's shuto-uke pair — would otherwise jump back to
       * the previous shape's pose for one frame before easing again. */
      for (const p of s.phalanges) p.from.copy(p.cur);
      s.shape = shape;
      s.blendS = blend ?? blendS;
      s.t = 0;
      s.settled = false;
    },

    update(dtS: number = 1 / 60): void {
      mutable.enabled = enabled;
      if (!enabled) return;
      const dt = dtS > 0 ? dtS : 0;

      for (let i = 0; i < sides.length; i++) {
        const s = sides[i]!;
        const row = rows[i]!;
        row.shape = s.shape;

        if (s.settled) {
          row.blend = 1;
          /* Still written every frame: the mixer has just overwritten these bones with the clip's
           * own finger rotations (bind-pinned on the retargeted capture, a boxer's open hand on the
           * library clips), so "settled" means the TARGET stopped moving, never that the write can
           * be skipped. */
          for (const p of s.phalanges) {
            p.before.copy(p.bone.quaternion);
            p.written = true;
            p.bone.quaternion.copy(p.cur);
          }
          continue;
        }

        s.t += dt;
        const w = s.blendS > 1e-6 ? Math.min(1, s.t / s.blendS) : 1;
        const e = handEase(w);
        row.blend = e;
        for (const p of s.phalanges) {
          p.cur.slerpQuaternions(p.from, p.poses[s.shape], e);
          p.before.copy(p.bone.quaternion);
          p.written = true;
          p.bone.quaternion.copy(p.cur);
        }
        if (w >= 1) s.settled = true;
      }
      mutable.frames++;
    },

    setEnabled(on: boolean): void {
      if (on === enabled) return;
      enabled = on;
      mutable.enabled = on;
      if (!on) restore();
    },

    dispose(): void {
      restore();
      for (const s of sides) s.phalanges.length = 0;
      sides.length = 0;
      rows.length = 0;
    },

    stats,
  };
}
