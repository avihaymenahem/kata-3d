/**
 * B6 PLAYER — `src/player/locomotion.ts` — matching a walk clip's cadence to real ground speed.
 *
 * ═══ THE BUG THIS EXISTS TO KILL ═════════════════════════════════════════════════════════════
 *
 * "Walking speed doesn't match actual progress." The step clips are IN-PLACE: the feet cycle but
 * the mesh never translates, and the root is driven separately by the kata score. Those two rates
 * have nothing to do with each other, so the feet skate — the classic foot-slide. Playing a clip
 * authored for ~1.1 m/s while the score moves the root at 0.4 m/s means the legs churn through
 * roughly three strides for every one the body actually takes.
 *
 * The fix is the standard one: measure what ground speed the clip DEPICTS, then time-scale it to
 * whatever ground speed the score is actually asking for. Contact stays put, the slide goes away.
 *
 * ═══ MEASURING A SPEED THAT IS NOT IN THE FILE ═══════════════════════════════════════════════
 *
 * An in-place clip stores no velocity anywhere — it has to be inferred from the legs. Over one
 * cycle each foot sweeps from maximally forward to maximally back RELATIVE TO THE PELVIS, and that
 * excursion is the stride length; a full cycle contains one such stride per foot, so
 *
 *     depicted speed = (strideL + strideR) / cycleDuration
 *
 * measured along the character's own forward axis, and sampled from the real skinned pose rather
 * than assumed, so it stays correct if the clip is ever swapped.
 */

import { Vector3 } from 'three';

import type { Character } from './character';

const _hip = new Vector3();
const _foot = new Vector3();
const _fwd = new Vector3();

/** Sample count over one cycle. 48 resolves the contact extremes without costing anything real. */
const SAMPLES = 48;

/**
 * Clamp on the correction.
 *
 * A time-scale below this makes a walk read as slow motion — visibly worse than a mild slide — and
 * above it the legs blur. When the score demands a speed outside the band the honest outcome is a
 * SMALL residual slide rather than a clip played at a speed it cannot carry.
 */
const TIME_SCALE_MIN = 0.35;
const TIME_SCALE_MAX = 2.6;

/** Below this the character is effectively turning in place, and any walk cadence is wrong. */
export const STILL_SPEED_MS = 0.05;

/**
 * Ground speed, in m/s, that `clipName` depicts. `null` if the clip is missing or shows no stride
 * (an idle, a pose) — callers must treat that as "do not time-scale this".
 *
 * DESTRUCTIVE: it drives the mixer to take its samples. Call at load, before the first frame, and
 * never inside the render loop.
 */
export function measureClipGroundSpeed(character: Character, clipName: string): number | null {
  const clip = character.clips.get(clipName);
  if (clip === undefined || clip.duration <= 0) return null;

  const pelvis = character.boneFor('pelvis');
  const footL = character.boneFor('foot_L');
  const footR = character.boneFor('foot_R');
  if (pelvis === null || footL === null || footR === null) return null;

  const action = character.play(clipName, 0);
  if (action === null) return null;

  let minL = Infinity, maxL = -Infinity, minR = Infinity, maxR = -Infinity;

  for (let i = 0; i < SAMPLES; i++) {
    character.mixer.setTime((i / SAMPLES) * clip.duration);
    character.root.updateMatrixWorld(true);

    /* The character's own forward, taken from the root each sample rather than assumed to be world
     * −Z: this runs before any kata places the figure, but the root still carries the model's
     * rest-facing offset and a caller is free to have turned it. */
    _fwd.set(0, 0, 1).applyQuaternion(character.root.quaternion).setY(0);
    if (_fwd.lengthSq() < 1e-12) return null;
    _fwd.normalize();

    _hip.setFromMatrixPosition(pelvis.matrixWorld);

    _foot.setFromMatrixPosition(footL.matrixWorld).sub(_hip);
    const dL = _foot.dot(_fwd);
    if (dL < minL) minL = dL;
    if (dL > maxL) maxL = dL;

    _foot.setFromMatrixPosition(footR.matrixWorld).sub(_hip);
    const dR = _foot.dot(_fwd);
    if (dR < minR) minR = dR;
    if (dR > maxR) maxR = dR;
  }

  const strideM = maxL - minL + (maxR - minR);
  /* A pose or an idle sways the feet a couple of centimetres. Anything under a 10 cm total
   * excursion is not depicting locomotion and must not become a divisor. */
  if (!Number.isFinite(strideM) || strideM < 0.1) return null;

  return strideM / clip.duration;
}

/**
 * The `timeScale` that makes `clipSpeedMs` read as `wantMs` on the floor, clamped to the band where
 * a walk still looks like a walk. `1` whenever the clip's own speed is unknown or degenerate.
 */
export function timeScaleForSpeed(clipSpeedMs: number | null, wantMs: number): number {
  if (clipSpeedMs === null || clipSpeedMs <= 1e-6) return 1;
  const raw = wantMs / clipSpeedMs;
  return Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, raw));
}
