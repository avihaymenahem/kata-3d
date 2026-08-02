/**
 * B3 SOLVER — `src/solve/hand.ts`
 *
 * `HAND_POSES` and `solveHand` — doc 03 §12. ARCHITECTURE.md §4.11 S4.
 *
 * ═══ A HAND SHAPE IS A POSE, NOT AN IK PROBLEM ══════════════════════════════════════════════
 * The four shapes (`seiken`, `shuto`, `open`, `nukite`) are fully specified by doc 03 §12 as
 * per-bone joint angles, and B1 ships them as `HAND_SHAPE_ANGLES`. There is nothing to solve:
 * the fingers have no target. This file's whole job is to apply them and to blend BETWEEN them
 * when a technique changes shape mid-move — which only happens on the transitions into and out of
 * shuto-uke in Heian 18–21.
 *
 * ═══ THE BLEND USES `kimeEase`, NOT A LINEAR RAMP ═══════════════════════════════════════════
 * §3.3: "There is no `lerp` on a pose channel anywhere in the codebase." A hand that opens
 * linearly reads as a glove inflating; the same `S(τ)` that governs the fist's path governs the
 * shape change, so the hand finishes forming exactly at kime and not before.
 */

import { Euler, Quaternion } from 'three';

import type { BoneName, HandShape, Handedness } from '../contracts';
import { DEG, kimeEase } from '../contracts';
import { HAND_SHAPE_ANGLES } from '../data';
import { type Skel, setLocal } from './skeleton';
import { boneIndex } from '../contracts';

const _q = new Quaternion();
const _qb = new Quaternion();
const _e = new Euler();

/** The finger/thumb bones a hand shape writes. Everything else in the hand is inherited. */
export const HAND_BONES_L: readonly BoneName[] = Object.freeze([
  'fingers_prox_L', 'fingers_dist_L', 'thumb_L',
]);
export const HAND_BONES_R: readonly BoneName[] = Object.freeze([
  'fingers_prox_R', 'fingers_dist_R', 'thumb_R',
]);

export const handBones = (side: Handedness): readonly BoneName[] =>
  side === 'L' ? HAND_BONES_L : HAND_BONES_R;

/** doc 03 §12's four shapes, from B1's table. Re-exported under §4.3's own name. */
export const HAND_POSES = HAND_SHAPE_ANGLES;

/** The Euler triple (degrees, XYZ) one shape asks of one bone, or zeros if it names none. */
export function shapeAngles(shape: HandShape, bone: BoneName): readonly [number, number, number] {
  const table = HAND_POSES[shape];
  return table?.[bone] ?? [0, 0, 0];
}

/**
 * §4.11 S4. Set one hand to `shape`, or blend from `from` to `shape` at `τ`.
 *
 * Mutates `s`; the caller re-runs FK. Blending is done on the QUATERNIONS rather than on the
 * Euler triples: interpolating Eulers through a 90° thumb rotation takes the joint through a
 * different path than slerp does, and on `shuto` — where the thumb tucks across the palm — that
 * path passes through the fingers.
 */
export function solveHand(
  s: Skel,
  side: Handedness,
  shape: HandShape,
  tau = 1,
  from: HandShape | null = null,
  tauPeak = 0.73,
): void {
  const blend = from === null || from === shape ? 1 : kimeEase(tau, tauPeak);
  for (const bone of handBones(side)) {
    const idx = boneIndex(bone);
    const to = shapeAngles(shape, bone);
    _e.set(to[0] * DEG, to[1] * DEG, to[2] * DEG, 'XYZ');
    _q.setFromEuler(_e);
    if (blend < 1 && from !== null) {
      const f = shapeAngles(from, bone);
      _e.set(f[0] * DEG, f[1] * DEG, f[2] * DEG, 'XYZ');
      _qb.setFromEuler(_e);
      _qb.slerp(_q, blend);
      setLocal(s, idx, _qb);
    } else {
      setLocal(s, idx, _q);
    }
  }
}

/**
 * The hand shape a move's technique and its hikite each ask for.
 *
 * The HIKITE hand is not always the same shape as the working hand: doc 02 §1.3's TATE-B is an
 * OPEN hand (shuto-uke's rear hand rides on the centre line, palm up), while HIP-A is a closed
 * fist. doc 02 §9 d6 settles the one case sources disagree on — Heian 7–9's non-blocking hand is
 * a closed fist, not open.
 */
export function hikiteShape(form: 'HIP-A' | 'TATE-B' | 'NONE'): HandShape {
  return form === 'TATE-B' ? 'shuto' : 'seiken';
}
