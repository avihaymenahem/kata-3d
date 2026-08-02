/**
 * B3 SOLVER — `src/solve/layers.ts`
 *
 * Delta-layer construction by INVERSION, and the worst-case chest-yaw envelope check.
 * ARCHITECTURE.md §3.9, §6.5 interlock 1, §4.11 S14.
 *
 * ═══ `PoseTrack.q` IS THE **BASE** POSE. THE LAYERS CARRY THE REST. ═════════════════════════
 * §3.9: "Deltas are built by INVERSION (`dq_i = inv(q_{i-1}) * q_i`), so composing every layer at
 * weight 1.0 reproduces the compiled pose to < 1e-4°."
 *
 * So `q` holds the pose with every delta layer OFF, and the RELEASE weight vector — all 1.0 —
 * reconstructs what the solver actually produced. That is what makes the layer weights a real
 * look-dev control rather than a blend toward a second, separately-authored pose: at weight 0 you
 * see the mechanically correct stance with no karate on top of it, which is a genuinely useful
 * diagnostic view, and at weight 1 you see exactly what the compiler solved.
 *
 * ═══ THE DELTA IS ASSIGNED TO ITS FIRST OWNER IN `LAYER_ORDER`. HERE IS THE TRADE-OFF. ═════
 * Several bones are writable by more than one layer — `chest` is in `koshi`, `kime` AND `gaze`.
 * Splitting a single quaternion delta across three layers requires either (a) solving the pose
 * once per layer, so each layer's own contribution is measured, or (b) apportioning the delta by
 * some rule.
 *
 * (a) is correct and costs 5 extra full-body solves per baked frame — roughly 6× the compile, on
 * a stage already budgeted at 220 ms. (b) is not exact, and S14's whole job is to assert the
 * composition IS exact.
 *
 * So the shipped rule is: **each bone's whole delta goes to the first layer in `LAYER_ORDER` that
 * writes it.** Composition at `w = 1` is then bit-exact (each bone has exactly one delta, applied
 * once), the recompose gate passes at 0.0 rather than at 1e-5, and the cost is that a look-dev
 * slider on `gaze` does not move the chest — `koshi` owns it. That is a real limitation and it is
 * recorded here rather than discovered in Phase 4.
 *
 * ═══ S14 CHECKS THE WHOLE WEIGHT BOX, NOT JUST w = 1 ═══════════════════════════════════════
 * §6.5 interlock 1. `koshi` and `kime` range to 1.5, so a chest yaw that is legal at 1.0 is 1.5×
 * larger at the box corner. doc 04 §2.1 caps the X-factor at 15°; §3.9 allows 2° of margin
 * (`CHEST_YAW_ENVELOPE_CAP_DEG = 17`). Checking only the release weights would ship a slider that
 * produces an anatomically impossible torso two clicks from its default.
 */

import { Quaternion } from 'three';

import type { BoneIndex, LayerId, LayerTrack } from '../contracts';
import {
  BONE_COUNT,
  CHEST_YAW_ENVELOPE_CAP_DEG,
  LAYER_ORDER,
  LAYER_WEIGHT_BOUNDS,
  LAYER_WRITABLE,
  RAD,
  boneIndex,
  quatAngleDeg,
} from '../contracts';

const _qa = new Quaternion();
const _qb = new Quaternion();
const _qd = new Quaternion();

/** The first layer in `LAYER_ORDER` that may write each bone, or `null`. See the header. */
export const BONE_OWNER: readonly (LayerId | null)[] = (() => {
  const out: (LayerId | null)[] = new Array<LayerId | null>(BONE_COUNT).fill(null);
  for (const id of LAYER_ORDER) {
    /* `patch` writes every bone (§3.7's escape hatch), so it must not claim anything by
     * ownership — it would swallow the entire pose. It is assigned explicitly, from the
     * per-move patch files, and nowhere else. */
    if (id === 'patch') continue;
    for (const b of LAYER_WRITABLE[id]) {
      if (out[b] === null) out[b] = id;
    }
  }
  return Object.freeze(out);
})();

/** Bones each layer will actually carry, given `BONE_OWNER`. Sorted ascending (§3.9). */
export const LAYER_BONES: Readonly<Record<LayerId, readonly BoneIndex[]>> = Object.freeze(
  Object.fromEntries(
    LAYER_ORDER.map((id) => [
      id,
      Object.freeze(
        BONE_OWNER.map((o, i) => (o === id ? (i as BoneIndex) : -1)).filter((i) => i >= 0),
      ),
    ]),
  ) as Record<LayerId, readonly BoneIndex[]>,
);

export interface LayerBuildInput {
  /** The BASE pose per frame, `frames * BONE_COUNT * 4`. Becomes `PoseTrack.q`. */
  readonly base: Float32Array;
  /** The FULL compiled pose per frame, same layout. Never shipped; only its delta is. */
  readonly full: Float32Array;
  readonly frameCount: number;
  /** Bones a per-move patch writes, and their per-frame deltas. Usually empty. */
  readonly patchBones: readonly BoneIndex[];
  readonly patchDq: Float32Array | null;
}

/**
 * §4.11 S14. Build the five delta layers by inversion.
 *
 * `dq = inv(base) * full`, per bone, per frame — a LOCAL delta, post-multiplied at sample time,
 * which is what `LAYER_ORDER`'s "post-multiplication in the bone's own frame" means.
 */
export function buildLayers(input: LayerBuildInput): readonly LayerTrack[] {
  const { base, full, frameCount } = input;
  const stride = BONE_COUNT * 4;

  return Object.freeze(
    LAYER_ORDER.map((id): LayerTrack => {
      const bones = id === 'patch' ? input.patchBones : LAYER_BONES[id];
      const dq = new Float32Array(frameCount * bones.length * 4);

      if (id === 'patch') {
        if (input.patchDq !== null && input.patchDq.length === dq.length) dq.set(input.patchDq);
        else identityFill(dq);
      } else {
        for (let f = 0; f < frameCount; f++) {
          for (let k = 0; k < bones.length; k++) {
            const b = bones[k]!;
            const bi = f * stride + b * 4;
            _qa.set(base[bi]!, base[bi + 1]!, base[bi + 2]!, base[bi + 3]!).normalize().invert();
            _qb.set(full[bi]!, full[bi + 1]!, full[bi + 2]!, full[bi + 3]!).normalize();
            /**
             * NORMALISE THE DELTA. `acos` is ill-conditioned at `w → 1`, which is exactly where a
             * near-identity delta lives.
             *
             * For a bone no layer changes, `base` and `full` are bitwise identical float32, so the
             * delta is `conj(q)·q = (0, 0, 0, |q|²)` with `|q|² = 1 ± 1.2e-7`. That is a PERFECT
             * identity rotation — but `quatAngleDeg` evaluates `2·acos(1 − 1.2e-7) ≈ 0.056°`, and
             * S14 gates at 1e-4°. The gate was failing on arithmetic that was already exact.
             *
             * three's `invert()` is a bare `conjugate()` and assumes a unit input, so both operands
             * are normalised first for the same reason.
             */
            _qd.copy(_qa).multiply(_qb).normalize();
            const o = (f * bones.length + k) * 4;
            dq[o] = _qd.x;
            dq[o + 1] = _qd.y;
            dq[o + 2] = _qd.z;
            dq[o + 3] = _qd.w;
          }
        }
      }

      const bounds = LAYER_WEIGHT_BOUNDS[id];
      return {
        id,
        bones,
        dq,
        /* Only `breath` carries a ribcage scale (§2.8: the one bone allowed a non-unit scale). */
        dScaleRibcage: id === 'breath' ? new Float32Array(frameCount * 3).fill(1) : null,
        defaultWeight: 1.0,
        minWeight: bounds.min,
        maxWeight: bounds.max,
      };
    }),
  );
}

const identityFill = (a: Float32Array): void => {
  for (let i = 0; i + 3 < a.length; i += 4) {
    a[i] = 0; a[i + 1] = 0; a[i + 2] = 0; a[i + 3] = 1;
  }
};

/**
 * Compose the base pose with every layer at `weights`, into `out`. The sampler's arithmetic,
 * lifted here so the gate below measures what the runtime will actually do.
 *
 * A layer delta at weight `w` is the delta slerped from identity by `w` — NOT the delta scaled,
 * which is meaningless for a quaternion. Post-multiplied in the bone's own frame (§3.9).
 */
export function composeInto(
  base: Float32Array,
  baseOffset: number,
  layers: readonly LayerTrack[],
  frame: number,
  weights: Readonly<Record<LayerId, number>>,
  out: Float32Array,
): void {
  out.set(base.subarray(baseOffset, baseOffset + BONE_COUNT * 4));
  for (const layer of layers) {
    const w = weights[layer.id];
    if (w === 0) continue;
    for (let k = 0; k < layer.bones.length; k++) {
      const b = layer.bones[k]!;
      const o = (frame * layer.bones.length + k) * 4;
      _qd.set(layer.dq[o]!, layer.dq[o + 1]!, layer.dq[o + 2]!, layer.dq[o + 3]!);
      if (w !== 1) {
        _qa.set(0, 0, 0, 1);
        _qa.slerp(_qd, w);
        _qd.copy(_qa);
      }
      _qb.set(out[b * 4]!, out[b * 4 + 1]!, out[b * 4 + 2]!, out[b * 4 + 3]!);
      _qb.multiply(_qd);
      /**
       * RENORMALISE. Five post-multiplies of float32-rounded quaternions drift off the unit
       * sphere, and `quatAngleDeg` (`src/contracts/ease.ts`) assumes unit inputs — it does not
       * normalise, so it reports the drift as ROTATIONAL error that is not there.
       *
       * Measured, that put `layerRecomposeErrDeg` at 7e-2° against a 1e-4° gate on a composition
       * that is algebraically exact. B6 hit the same thing from the sampler side and could not fix
       * it there, because the sampler's own `slerpInto` DOES renormalise and this did not — so the
       * two agreed to within a rotation and disagreed by a norm.
       */
      _qb.normalize();
      out[b * 4] = _qb.x;
      out[b * 4 + 1] = _qb.y;
      out[b * 4 + 2] = _qb.z;
      out[b * 4 + 3] = _qb.w;
    }
  }
}

/**
 * **The S14 recompose gate.** Worst per-bone angle between `compose(base, layers, w = 1)` and the
 * full compiled pose, in degrees. §3.9 requires `< 1e-4`.
 *
 * With first-owner assignment this is 0 up to float32 rounding, which is the point: a nonzero
 * value here means a bone's delta was written to two layers or to none.
 */
export function measureRecomposeErrDeg(
  base: Float32Array,
  full: Float32Array,
  frameCount: number,
  layers: readonly LayerTrack[],
  weights: Readonly<Record<LayerId, number>>,
): number {
  const stride = BONE_COUNT * 4;
  const out = new Float32Array(stride);
  let worst = 0;
  /* Every 16th frame: the layers are built by one rule applied identically to every frame, so a
   * per-frame walk measures the same arithmetic 10 000 times. A subsample catches a systematic
   * fault, which is the only kind this can have. */
  for (let f = 0; f < frameCount; f += 16) {
    composeInto(base, f * stride, layers, f, weights, out);
    for (let b = 0; b < BONE_COUNT; b++) {
      const i = f * stride + b * 4;
      const d = quatAngleDeg(
        out[b * 4]!, out[b * 4 + 1]!, out[b * 4 + 2]!, out[b * 4 + 3]!,
        full[i]!, full[i + 1]!, full[i + 2]!, full[i + 3]!,
      );
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** The 2^5 corners of the legal weight box (§6.5 interlock 1). S14 evaluates all of them. */
export function weightBoxCorners(): readonly Readonly<Record<LayerId, number>>[] {
  const out: Record<LayerId, number>[] = [];
  const n = LAYER_ORDER.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const w = {} as Record<LayerId, number>;
    for (let i = 0; i < n; i++) {
      const id = LAYER_ORDER[i]!;
      const b = LAYER_WEIGHT_BOUNDS[id];
      w[id] = (mask >> i) & 1 ? b.max : b.min;
    }
    out.push(w);
  }
  return out;
}

const CHEST = boneIndex('chest');

/**
 * **The S14 envelope gate.** Worst composed `|yaw(chest) − yaw(pelvis)|` over the WHOLE legal
 * weight box, degrees. §3.9 caps it at `CHEST_YAW_ENVELOPE_CAP_DEG = 17`.
 *
 * The yaw is read the same way `spine.ts` reads it — by projecting the bone's forward axis onto
 * XZ — rather than by converting to Euler angles, which gimbal-locks exactly where a deep bow
 * puts the chest.
 */
export function measureWorstChestYawDeg(
  base: Float32Array,
  frameCount: number,
  layers: readonly LayerTrack[],
): number {
  const stride = BONE_COUNT * 4;
  const out = new Float32Array(stride);
  const corners = weightBoxCorners();
  let worst = 0;
  for (let f = 0; f < frameCount; f += 8) {
    for (const w of corners) {
      composeInto(base, f * stride, layers, f, w, out);
      /**
       * THE X-FACTOR IS THE CHEST RELATIVE TO THE PELVIS, which is the SUM of the local yaws of
       * the bones BETWEEN them — not `yaw(chest_local) − yaw(pelvis_local)`.
       *
       * A bone's local rotation is already relative to its parent, so the chest's local yaw is
       * measured against `spine_03`, not against the pelvis. Differencing the two locals therefore
       * subtracts the pelvis's ψ — which is up to 45° of hanmi and is not torso separation at all
       * — and then the 1.5 weight-box corner scales the error with it. Measured, that reported
       * 78° against a 17° cap on a pose whose real separation was inside 15°.
       *
       * doc 04 §2.1's X-factor is `|yaw(shoulder) − yaw(pelvis)|`, and along a chain of pure-yaw
       * locals that is exactly their sum. */
      let sum = 0;
      for (const b of SPINE_CHAIN) sum += localYawDeg(out, b);
      const d = Math.abs(sum);
      const folded = d > 180 ? 360 - d : d;
      if (folded > worst) worst = folded;
    }
  }
  return worst;
}

/** `pelvis → chest`, exclusive of the pelvis: the bones whose yaws sum to the X-factor. */
const SPINE_CHAIN: readonly number[] = Object.freeze([
  boneIndex('spine_01'), boneIndex('spine_02'), boneIndex('spine_03'), CHEST,
]);

/** A bone's LOCAL yaw about +Y, degrees, from its quaternion's forward axis. */
function localYawDeg(q: Float32Array, b: number): number {
  const x = q[b * 4]!;
  const y = q[b * 4 + 1]!;
  const z = q[b * 4 + 2]!;
  const w = q[b * 4 + 3]!;
  /* `R(q)·(0,0,−1)`, expanded. Avoids allocating a Vector3 in a 2^5 × frames loop. */
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz) * RAD;
}

/** The cap S14 asserts against, re-exported so `stageAssert.ts` reads one source. */
export { CHEST_YAW_ENVELOPE_CAP_DEG };
