/**
 * B3 SOLVER — `src/solve/bake.ts`
 *
 * The adaptive piecewise-uniform bake and its segment planner. ARCHITECTURE.md §2.4, §4.11 S13;
 * gates **G-9a**, **G-9b**, **G-9c**.
 *
 * ═══ THIS IS THE STAGE THAT ANSWERS THE PANEL'S UNANIMOUS FATAL ═════════════════════════════
 * §8's Phase-3 gate calls G-9a/b/c "the gate that answers the panel's unanimous fatal". The fatal
 * was baking a martial-arts technique onto a uniform grid: at 60 Hz the forearm roll steps 105°
 * between keys, and slerp turns that into a visible staircase no amount of shader work hides.
 *
 * The fix is not "bake everything at 960 Hz" — that is 8× the memory for a clip that is standing
 * still 70 % of the time. It is to measure the angular rate and spend rungs where the motion is.
 *
 * ═══ CRITERION 2 BINDS, AND IT IS THE ANTI-STAIRCASE ONE ═══════════════════════════════════
 * §2.4, restated in `src/contracts/time.ts`:
 *
 *   criterion 1  midpoint geodesic slerp error ≤ 0.25°   ⇒  θ''·dt²/8 ≤ 0.25  ⇒  dt ≤ 4.08 ms ⇒ 245 Hz
 *   criterion 2  angular step ≤ 12° per interval          ⇒  dt ≤ 12/6285      ⇒  dt ≤ 1.91 ms ⇒ 524 Hz
 *
 * Criterion 2 binds, which is why the ladder needs a rung above 480. The planner therefore sizes
 * rungs from the measured RATE (criterion 2) and then VERIFIES criterion 1 by measuring the actual
 * midpoint error — rather than trusting the `θ''` estimate that produced the 245 Hz figure.
 *
 * ═══ SEGMENTS SHARE THEIR BOUNDARY FRAME ═══════════════════════════════════════════════════
 * `tests/contracts/bake-error.test.ts` step 4 pins the exact contiguity form:
 *
 *     cursor = seg.startTick + (seg.frameCount − 1) · seg.ticksPerFrame
 *     expect(nextSeg.startTick).toBe(cursor)
 *
 * So segment `k`'s LAST frame sits on segment `k+1`'s FIRST tick — the boundary frame is stored
 * twice, once per segment. That duplication is deliberate: it lets the sampler resolve any tick
 * with `O(1)` arithmetic inside one segment and never straddle a boundary, which is §6.2's whole
 * "no per-bone binary search" claim.
 */

import { BONE_COUNT, POSE_LADDER, TICK_HZ, quatAngleDeg, ticksPerFrame } from '../contracts';
import type { PoseRateHz, PoseSegment, TicksPerFrame } from '../contracts';

/** §2.4 criterion 2: the anti-staircase bound, degrees per baked interval. */
export const MAX_STEP_DEG = 12.0;
/** §2.4 criterion 1: midpoint geodesic slerp error, degrees. */
export const MAX_SLERP_ERR_DEG = 0.25;

/**
 * The probe grid, in ticks. 480 Hz — fine enough to see the roll's peak, coarse enough that
 * probing the whole clip costs one solve per 8 ticks rather than one per tick.
 *
 * A coarser probe would alias the roll: its peak lasts ~12 ms, and a 120 Hz probe (8.3 ms) can
 * straddle it. 480 Hz samples it four times.
 */
export const PROBE_TICKS = 8;

/** The base rung. Everything is at least this fine; §3.9's `baseFrames` counts these. */
export const BASE_RATE_HZ: PoseRateHz = 120;

export interface BakePlanEntry {
  readonly startTick: number;
  readonly endTick: number;
  readonly rateHz: PoseRateHz;
  readonly reason: string;
}

/**
 * Pick the coarsest ladder rung whose interval keeps the angular step under `MAX_STEP_DEG`.
 *
 * `rateDegS` is the worst per-bone angular rate over the interval. `required = rate / 12` Hz.
 */
export function rungFor(rateDegS: number): PoseRateHz {
  const requiredHz = rateDegS / MAX_STEP_DEG;
  for (const hz of POSE_LADDER) {
    if (hz >= requiredHz) return hz;
  }
  return POSE_LADDER[POSE_LADDER.length - 1]!;
}

/**
 * §2.4 **criterion 1**: the midpoint geodesic error of a slerp between two keys is
 * `≈ θ''·dt²/8`, so `dt ≤ sqrt(8·MAX_SLERP_ERR_DEG / θ'')` and `requiredHz = 1/dt`.
 *
 * `accelDegS2` is the measured second difference of the pose angle, in deg/s². This is the
 * criterion §2.4 computes as 245 Hz for the roll and then sets aside because criterion 2 asks for
 * more — but it is the one that binds wherever a path CHANGES DIRECTION rather than moves fast,
 * and G-9a is stated against it directly.
 */
export function rungForAccel(accelDegS2: number): PoseRateHz {
  if (accelDegS2 <= 0) return POSE_LADDER[0]!;
  const dt = Math.sqrt((8 * MAX_SLERP_ERR_DEG) / accelDegS2);
  const requiredHz = 1 / dt;
  for (const hz of POSE_LADDER) {
    if (hz >= requiredHz) return hz;
  }
  return POSE_LADDER[POSE_LADDER.length - 1]!;
}

/** Which criterion picked a rung — carried into `PoseSegment.reason` for the fix router. */
export function reasonFor(rateDegS: number, hz: PoseRateHz): string {
  if (hz === BASE_RATE_HZ) return 'base';
  if (rateDegS > 4000) return 'roll';
  if (rateDegS > 1500) return 'kime';
  if (rateDegS > 600) return 'hipSnap';
  return 'contact';
}

/**
 * §4.11 S13. Plan the segment layout from a per-probe angular-rate signal.
 *
 * `rateAt[i]` is the worst angular rate over probe interval `i`, which covers ticks
 * `[i·PROBE_TICKS, (i+1)·PROBE_TICKS)`.
 *
 * Segments are snapped OUTWARD to their own frame grid: a segment at 960 Hz has
 * `ticksPerFrame = 4`, and `PoseSegment.startTick` must be an exact multiple of it (S13, and the
 * frozen test). Snapping outward rather than inward means a fast passage is never under-sampled
 * at its edges, at a cost of at most 31 ticks (8 ms) of extra fine baking per boundary.
 */
export function planSegments(
  rateAt: readonly number[],
  durationTicks: number,
  accelAt?: readonly number[],
): readonly BakePlanEntry[] {
  if (durationTicks <= 0) return [];

  /* 1. A rung per probe interval, from BOTH §2.4 criteria — the finer of the two.
   *
   * §2.4 names criterion 2 as the binding one and it usually is, but "usually" is not "always":
   * criterion 2 is blind to CURVATURE. A path that turns a corner between two frames can have a
   * small per-frame step and a large midpoint error, which is precisely what criterion 1 measures
   * and precisely what G-9a gates. Sizing rungs from the rate alone leaves that unbaked. */
  const rungs = rateAt.map((r, i) => {
    const byRate = rungFor(r);
    const byCurve = accelAt === undefined ? BASE_RATE_HZ : rungForAccel(accelAt[i] ?? 0);
    return byRate >= byCurve ? byRate : byCurve;
  });

  /* 2. Dilate: a fast interval pulls its neighbours up, so the transition INTO a fast passage is
   *    already fine-grained when it arrives. Without this the first interval of a roll is baked
   *    at the OLD rung and carries the whole step.
   *
   * The radius is 4 probes (32 ticks = one 120 Hz frame), not 1. A one-probe halo is not enough:
   * the coarse frame that STRADDLES the boundary is 32 ticks wide, so a fast region has to be
   * widened by a whole coarse frame on each side or that straddling frame keeps the full step. */
  const DILATE_PROBES = 4;
  const dilated = rungs.slice();
  for (let i = 0; i < rungs.length; i++) {
    const r = rungs[i]!;
    if (r <= BASE_RATE_HZ) continue;
    for (let d = 1; d <= DILATE_PROBES; d++) {
      if (i - d >= 0 && dilated[i - d]! < r) dilated[i - d] = r;
      if (i + d < rungs.length && dilated[i + d]! < r) dilated[i + d] = r;
    }
  }

  /* 3. Merge runs of equal rung into raw spans, on probe boundaries. */
  const raw: { i: number; j: number; hz: PoseRateHz }[] = [];
  let i = 0;
  while (i < dilated.length) {
    const hz = dilated[i]!;
    let j = i;
    while (j < dilated.length && dilated[j] === hz) j++;
    raw.push({ i, j, hz });
    i = j;
  }

  /* 4. Place the spans, snapping every boundary DOWN.
   *
   * The direction matters and getting it wrong is silent. Snapping a coarse span's END *outward*
   * (up) makes it overrun into the following fine span; the fine span is then pushed later,
   * collapses to its 2-frame minimum, and sits AFTER the fast motion it was planned for — which
   * stays baked at the coarse rung. The symptom is a 61° step at 120 Hz with a 960 Hz segment
   * eight ticks to its right, and every gate still reports "the ladder was used".
   *
   * Snapping DOWN instead makes the finer rung start EARLY and cover the whole fast region. The
   * ladder is dyadic, so a multiple of the coarser `ticksPerFrame` is automatically a multiple of
   * the finer one — one snap satisfies both grids, which is §2.4's own reason for the ladder. */
  const fixed: BakePlanEntry[] = [];
  let cursor = 0;
  for (let s = 0; s < raw.length; s++) {
    const e = raw[s]!;
    const tpf = ticksPerFrame(e.hz);
    const next = raw[s + 1];
    const boundaryTpf = next === undefined ? tpf : Math.max(tpf, ticksPerFrame(next.hz));

    const start = cursor;
    let end = Math.min(e.j * PROBE_TICKS, durationTicks);
    end -= end % boundaryTpf;
    /* Every segment needs >= 2 frames (S13). Growing by whole `boundaryTpf` keeps both grids. */
    while (end < start + 2 * tpf) end += boundaryTpf;
    if (end > durationTicks) {
      end = durationTicks - (durationTicks % tpf);
      if (end < start + 2 * tpf) break;
    }
    const worst = Math.max(...rateAt.slice(e.i, e.j), 0);
    fixed.push({ startTick: start, endTick: end, rateHz: e.hz, reason: reasonFor(worst, e.hz) });
    cursor = end;
  }
  if (fixed.length === 0) {
    const tpf = ticksPerFrame(BASE_RATE_HZ);
    const end = Math.max(2 * tpf, durationTicks - (durationTicks % tpf));
    return [{ startTick: 0, endTick: end, rateHz: BASE_RATE_HZ, reason: 'base' }];
  }
  /* Extend the last span to cover the clip. */
  const last = fixed[fixed.length - 1]!;
  const lastTpf = ticksPerFrame(last.rateHz);
  let tail = durationTicks - (durationTicks % lastTpf);
  if (tail < last.startTick + 2 * lastTpf) tail = last.startTick + 2 * lastTpf;
  fixed[fixed.length - 1] = { ...last, endTick: tail };

  return Object.freeze(fixed);
}

/** A `PoseSegment` plus the ticks it samples. `frameCount >= 2`, S13. */
export interface BakedSegment extends PoseSegment {
  readonly ticks: readonly number[];
}

/**
 * **§4.11 S13's entry point.** Plan the rungs and lay out the segments in one call.
 *
 * The name matters beyond tidiness: §7.7's fix router routes a bake finding to
 * `src/solve/bake.ts -> bakeSegments()`, and `tests/eval/fixsites.test.ts` asserts every routed
 * symbol resolves to a real exported binding. A stage split into helpers with different names is
 * a stage the router cannot point at.
 */
export function bakeSegments(
  rateAt: readonly number[],
  durationTicks: number,
  accelAt?: readonly number[],
): readonly BakedSegment[] {
  return layOutSegments(planSegments(rateAt, durationTicks, accelAt));
}

/** Turn a plan into segments with their frame offsets resolved. */
export function layOutSegments(plan: readonly BakePlanEntry[]): readonly BakedSegment[] {
  const out: BakedSegment[] = [];
  let qOffset = 0;
  let frameOffset = 0;
  for (const e of plan) {
    const tpf = ticksPerFrame(e.rateHz) as TicksPerFrame;
    const frameCount = Math.max(2, Math.floor((e.endTick - e.startTick) / tpf) + 1);
    const ticks: number[] = [];
    for (let f = 0; f < frameCount; f++) ticks.push(e.startTick + f * tpf);
    out.push({
      startTick: e.startTick,
      frameCount,
      rateHz: e.rateHz,
      ticksPerFrame: tpf,
      qOffset,
      frameOffset,
      reason: e.reason,
      ticks,
    });
    qOffset += frameCount * BONE_COUNT * 4;
    frameOffset += frameCount;
  }
  return out;
}

/** Total baked frames across every segment, counting shared boundary frames twice. */
export const totalFrames = (segs: readonly BakedSegment[]): number =>
  segs.reduce((a, s) => a + s.frameCount, 0);

export interface StepMeasurement {
  readonly maxStepDeg: number;
  readonly maxStepBone: number;
  readonly maxStepAtTick: number;
}

/**
 * **G-9b, measured off the baked buffer.** The worst per-bone angular step between consecutive
 * frames within a segment.
 *
 * Measured from `q` rather than accumulated during the bake, because
 * `tests/contracts/bake-error.test.ts` recomputes exactly this from `PoseTrack.q` and asserts the
 * reported number matches to 1e-2 — "so the report cannot be wrong without this failing too".
 * Computing it any other way would let the two drift.
 */
export function measureMaxStep(q: Float32Array, segs: readonly BakedSegment[]): StepMeasurement {
  let maxStepDeg = 0;
  let maxStepBone = -1;
  let maxStepAtTick = -1;
  const stride = BONE_COUNT * 4;
  for (const seg of segs) {
    for (let f = 0; f + 1 < seg.frameCount; f++) {
      const a = seg.qOffset + f * stride;
      const b = a + stride;
      for (let bone = 0; bone < BONE_COUNT; bone++) {
        const ai = a + bone * 4;
        const bi = b + bone * 4;
        const d = quatAngleDeg(
          q[ai]!, q[ai + 1]!, q[ai + 2]!, q[ai + 3]!,
          q[bi]!, q[bi + 1]!, q[bi + 2]!, q[bi + 3]!,
        );
        if (d > maxStepDeg) {
          maxStepDeg = d;
          maxStepBone = bone;
          maxStepAtTick = seg.startTick + f * seg.ticksPerFrame;
        }
      }
    }
  }
  return { maxStepDeg, maxStepBone, maxStepAtTick };
}

/**
 * **G-9a.** The midpoint geodesic error: how far the slerped pose is from the TRUE pose at the
 * interval's midpoint.
 *
 * This is the criterion the rung planner does NOT enforce directly — it sizes rungs from the rate
 * (criterion 2) and then measures this. Measuring rather than estimating matters because the
 * `θ''·dt²/8` bound assumes constant angular acceleration, and the roll's `u^2.2` curve is
 * anything but constant near `u = 1`.
 *
 * The midpoint of an interval is always an integer tick: `ticksPerFrame` is 32/16/8/4, so half of
 * it is 16/8/4/2. That is §2.4's dyadic-ladder property doing real work — on a 60 Hz grid the
 * midpoint would be a half-tick and this measurement would need its own interpolation.
 */
export interface SlerpErrMeasurement {
  readonly errDeg: number;
  readonly bone: number;
  readonly tick: number;
  readonly rateHz: number;
}

export function measureSlerpError(
  q: Float32Array,
  segs: readonly BakedSegment[],
  poseAt: (tick: number, out: Float32Array) => void,
): SlerpErrMeasurement {
  const stride = BONE_COUNT * 4;
  const mid = new Float32Array(stride);
  let errDeg = 0;
  let bone = -1;
  let tickAt = -1;
  let rateHz = 0;
  for (const seg of segs) {
    const half = seg.ticksPerFrame >> 1;
    if (half < 1) continue;
    for (let f = 0; f + 1 < seg.frameCount; f++) {
      const tick = seg.startTick + f * seg.ticksPerFrame + half;
      poseAt(tick, mid);
      const a = seg.qOffset + f * stride;
      const b = a + stride;
      for (let k = 0; k < BONE_COUNT; k++) {
        const ai = a + k * 4;
        const bi = b + k * 4;
        slerpInto(q, ai, q, bi, 0.5, _s);
        const d = quatAngleDeg(
          _s[0]!, _s[1]!, _s[2]!, _s[3]!,
          mid[k * 4]!, mid[k * 4 + 1]!, mid[k * 4 + 2]!, mid[k * 4 + 3]!,
        );
        /* WHERE, not just how much. §7.7 routes a finding to a file, and "G-9a is 5.6°" is not
         * routable while "5.6° on `hand_R` at tick 47760, baked at 240 Hz" names the technique,
         * the move and the rung that was too coarse for it. */
        if (d > errDeg) {
          errDeg = d;
          bone = k;
          tickAt = tick;
          rateHz = seg.rateHz;
        }
      }
    }
  }
  return { errDeg, bone, tick: tickAt, rateHz };
}

const _s = new Float32Array(4);

/**
 * Quaternion slerp, written out rather than taken from three's `Quaternion.slerp`.
 *
 * Not because three's is wrong — because this must be the SAME arithmetic the runtime sampler
 * uses, and the sampler works on raw `Float32Array` offsets to avoid allocating (§3.9: "the
 * sampler never allocates"). Two implementations of slerp that agree to 1e-7 would make G-9a
 * measure the difference between them rather than the bake error.
 */
export function slerpInto(
  a: Float32Array, ai: number,
  b: Float32Array, bi: number,
  t: number,
  out: Float32Array,
  oi = 0,
): void {
  let ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  const bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    /* Fold the double cover so the interpolation takes the SHORT arc. Without this a 181° step
     * interpolates the long way round and the bone spins backwards for one interval. */
    cos = -cos;
    ax = -ax; ay = -ay; az = -az; aw = -aw;
  }
  let s0: number;
  let s1: number;
  if (cos > 0.9995) {
    /* Nearly parallel: lerp + normalise. The slerp formula divides by sin(θ) → 0 here. */
    s0 = 1 - t;
    s1 = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    s0 = Math.sin((1 - t) * theta) / sin;
    s1 = Math.sin(t * theta) / sin;
  }
  let x = s0 * ax + s1 * bx;
  let y = s0 * ay + s1 * by;
  let z = s0 * az + s1 * bz;
  let w = s0 * aw + s1 * bw;
  const n = Math.hypot(x, y, z, w);
  if (n > 1e-12) { x /= n; y /= n; z /= n; w /= n; }
  out[oi] = x; out[oi + 1] = y; out[oi + 2] = z; out[oi + 3] = w;
}

/** Frames per ladder rung, for `BakeStats.framesByRate`. */
export function framesByRate(
  segs: readonly BakedSegment[],
): Readonly<Record<'120' | '240' | '480' | '960', number>> {
  const out = { '120': 0, '240': 0, '480': 0, '960': 0 };
  for (const s of segs) out[String(s.rateHz) as '120'] += s.frameCount;
  return out;
}

/** Ticks per second, re-exported so the planner's arithmetic has one clock source. */
export { TICK_HZ };
