/**
 * B9 CRITIC — `src/eval/joints.ts`
 *
 * The 480 Hz canonical-joint stream: `JointStream`, its reader/writer, and `toCanonical`.
 * ARCHITECTURE.md §3.4.1 (the frozen `JointStream` shape), §7.1 (the GL-free numeric channel),
 * §7.3 (`captures/<sha>/<kata>/joints.f32`), §9.1 A-7.
 *
 * WHY THIS FILE EXISTS AT ALL. Proposal A sampled "8 evenly spaced sub-ticks per move", which at
 * T1 is ~260 ms between samples — against metric 50 `kime_decel_time_s` at ref 0.07 s ±0.04 and
 * metric 54 `kiai_frame_alignment_s` at ±0.06 s. Both sit inside gates G-1/G-4, so both were
 * unmeasurable at the specified sampling rate (judge 2, fatal A7). The whole-kata stream at
 * `JOINT_RATE_HZ = 480` resolves the 0.07 s brake to 34 samples and the kiai window to 29.
 *
 * IMPORT DISCIPLINE (§3, `tests/contracts/imports.test.ts`): this file imports the contracts
 * barrel and nothing else. No `three`, no `node:*`, no wall clock, no `Math.random` — `src/eval/**`
 * is on the determinism ledger and must load under Vite SSR in plain Node with no GL.
 */

import type { CanonicalJoint, ChannelName, Landmarks } from '../contracts';
import {
  CANONICAL_COUNT,
  CANONICAL_INDEX,
  CHANNEL_COUNT,
  CHANNEL_INDEX,
  JOINT_RATE_HZ,
  TICK_HZ,
} from '../contracts';

/**
 * TICK_HZ / JOINT_RATE_HZ. 3840 / 480 = 8 — an exact power of two, like every other rung on the
 * §2.4 ladder, so `frameOfTick` is integer division with no rounding mode to argue about.
 */
export const JOINT_TICKS_PER_FRAME = TICK_HZ / JOINT_RATE_HZ;

/** Floats per stream frame in `pos`. */
export const JOINT_FLOATS_PER_FRAME = CANONICAL_COUNT * 3;

/**
 * §3.4.1 verbatim. Declared here and re-exported from the `src/eval` barrel, which is where
 * §3.4.1 says the owning block declares it.
 *
 * `pos` is `frameCount * CANONICAL_COUNT * 3` world metres, in `CANONICAL_JOINTS` order.
 * `chan` is `frameCount * CHANNEL_COUNT`, in `CHANNELS` order. Both grids are the SAME rate
 * (`JOINT_RATE_HZ === CHAN_RATE_HZ === 480`), which is what lets metric 51 `hip_lead_lag_s`
 * correlate a pelvis-yaw-rate channel against a fist-speed series without resampling either.
 */
export interface JointStream {
  readonly rateHz: 480;
  readonly frameCount: number;
  readonly pos: Float32Array; // frameCount * CANONICAL_COUNT * 3, world metres
  readonly chan: Float32Array; // frameCount * CHANNEL_COUNT
  frameOfTick(tick: number): number;
  tickOfFrame(f: number): number;
}

/** Thrown by every constructor/decoder in this file. Named so a tool can report it cleanly. */
export class JointStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JointStreamError';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Construction
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface JointStreamInit {
  readonly frameCount: number;
  /** frameCount * CANONICAL_COUNT * 3. Adopted, not copied — callers own the buffer. */
  readonly pos: Float32Array;
  /** frameCount * CHANNEL_COUNT. */
  readonly chan: Float32Array;
  /**
   * Tick of frame 0. Almost always 0 (the harness dumps whole kata), but a `--steps` subset
   * capture streams a window, and a metric that reports `MetricResult.tick` must not lie about
   * where the window started.
   */
  readonly startTick?: number;
}

/**
 * Wrap two typed arrays as a `JointStream`, validating the lengths. The arrays are ADOPTED:
 * `createJointStream` allocates nothing beyond the closure, so the harness can hand over the
 * buffer it already filled.
 */
export function createJointStream(init: JointStreamInit): JointStream {
  const { frameCount, pos, chan } = init;
  const startTick = init.startTick ?? 0;

  if (!Number.isInteger(frameCount) || frameCount < 0) {
    throw new JointStreamError(`frameCount must be a non-negative integer, got ${frameCount}`);
  }
  if (!Number.isInteger(startTick)) {
    throw new JointStreamError(`startTick must be an integer, got ${startTick}`);
  }
  if (startTick % JOINT_TICKS_PER_FRAME !== 0) {
    throw new JointStreamError(
      `startTick ${startTick} is not on the ${JOINT_RATE_HZ} Hz grid ` +
        `(must be a multiple of ${JOINT_TICKS_PER_FRAME} ticks)`,
    );
  }
  const wantPos = frameCount * JOINT_FLOATS_PER_FRAME;
  if (pos.length !== wantPos) {
    throw new JointStreamError(
      `pos length ${pos.length} !== frameCount*CANONICAL_COUNT*3 = ${wantPos}`,
    );
  }
  const wantChan = frameCount * CHANNEL_COUNT;
  if (chan.length !== wantChan) {
    throw new JointStreamError(
      `chan length ${chan.length} !== frameCount*CHANNEL_COUNT = ${wantChan}`,
    );
  }

  const lastFrame = frameCount === 0 ? 0 : frameCount - 1;

  return {
    rateHz: JOINT_RATE_HZ,
    frameCount,
    pos,
    chan,
    /**
     * Integer division, then CLAMPED into range. Clamping rather than throwing is deliberate:
     * a hold-end mark can land one tick past the last dumped frame after a `--steps` subset, and
     * a metric that throws there would take out the whole scorecard for an off-by-one at the tail.
     * The clamp is reported through `tickOfFrame`, so a caller that cares can detect it.
     */
    frameOfTick(tick: number): number {
      const f = Math.floor((tick - startTick) / JOINT_TICKS_PER_FRAME);
      return f < 0 ? 0 : f > lastFrame ? lastFrame : f;
    },
    tickOfFrame(f: number): number {
      return startTick + f * JOINT_TICKS_PER_FRAME;
    },
  };
}

/**
 * An all-zero stream of `frameCount` frames. The shape-correct "nothing measured yet" value.
 *
 * **`emptyJointStream(0)` MUST NOT BE INDEXED.** With `frameCount === 0` the buffers are empty, so
 * `readJoint` / `jointComponent` read past the end and yield `undefined` — which a metric would then
 * score as if it were a measurement. A caller with no real stream must SKIP the metric pass, not
 * feed it a zero-length one; `tools/score.mjs` does exactly that and reports
 * `pipelineJointStream: 'ABSENT'`.
 */
export function emptyJointStream(frameCount = 0, startTick = 0): JointStream {
  return createJointStream({
    frameCount,
    pos: new Float32Array(frameCount * JOINT_FLOATS_PER_FRAME),
    chan: new Float32Array(frameCount * CHANNEL_COUNT),
    startTick,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Indexing — every metric reads through these, never through raw arithmetic at the call site.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Float index of `joint`'s x component at stream frame `f`. */
export const posOffset = (f: number, joint: CanonicalJoint): number =>
  f * JOINT_FLOATS_PER_FRAME + CANONICAL_INDEX[joint] * 3;

/** Float index of `channel` at stream frame `f`. */
export const chanOffset = (f: number, channel: ChannelName): number =>
  f * CHANNEL_COUNT + CHANNEL_INDEX[channel];

/** World position of one canonical joint at one frame, written into `out` (length >= 3). */
export function readJoint(
  s: JointStream,
  f: number,
  joint: CanonicalJoint,
  out: Float32Array | Float64Array | number[],
): void {
  const o = posOffset(f, joint);
  out[0] = s.pos[o]!;
  out[1] = s.pos[o + 1]!;
  out[2] = s.pos[o + 2]!;
}

/** One component of one canonical joint. `axis` 0=x 1=y 2=z. Allocation-free. */
export const jointComponent = (
  s: JointStream,
  f: number,
  joint: CanonicalJoint,
  axis: 0 | 1 | 2,
): number => s.pos[posOffset(f, joint) + axis]!;

/** One channel scalar at one frame. */
export const channelAt = (s: JointStream, f: number, channel: ChannelName): number =>
  s.chan[chanOffset(f, channel)]!;

/**
 * Copy a `Landmarks` snapshot into stream frame `f`.
 *
 * `Landmarks.pos` is ALREADY `CANONICAL_COUNT*3` in `CANONICAL_JOINTS` order (§3.10), so this is
 * a straight blit, not a remap — the remap from `BONE_ORDER` to canonical order happens once, in
 * B4's `sampleLandmarks`, via the frozen `CANONICAL_FROM_BONE`. Two independent remaps would be
 * two chances to transpose a left and a right, and Channel C is the only thing that could see it
 * (§7.6). Hence the name: this converts a snapshot INTO canonical stream layout, and asserts the
 * snapshot was canonical to begin with.
 */
export function toCanonical(l: Landmarks, out: Float32Array, f: number): void {
  if (l.pos.length !== JOINT_FLOATS_PER_FRAME) {
    throw new JointStreamError(
      `Landmarks.pos length ${l.pos.length} !== CANONICAL_COUNT*3 = ${JOINT_FLOATS_PER_FRAME}; ` +
        `sampleLandmarks must fill the frozen canonical set (src/contracts/rig.ts CANONICAL_JOINTS)`,
    );
  }
  const base = f * JOINT_FLOATS_PER_FRAME;
  if (base + JOINT_FLOATS_PER_FRAME > out.length) {
    throw new JointStreamError(`frame ${f} does not fit in a ${out.length}-float pos buffer`);
  }
  out.set(l.pos, base);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Serialisation — `captures/<sha>/<kata>/joints.f32` and `chan.f32` (§7.3).
 *
 * Flat little-endian f32, no header. The frame count is recoverable from the byte length and the
 * frozen strides, and `meta.json` carries the tick map. A header would be a second place for the
 * canonical count to live, and `CANONICAL_JOINTS.length` is already the single authority.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Byte length of `joints.f32` for `frameCount` frames. */
export const jointsByteLength = (frameCount: number): number =>
  frameCount * JOINT_FLOATS_PER_FRAME * 4;
/** Byte length of `chan.f32` for `frameCount` frames. */
export const chanByteLength = (frameCount: number): number => frameCount * CHANNEL_COUNT * 4;

/** Frame count implied by a `joints.f32` byte length. Throws if it is not a whole number. */
export function frameCountOfJointsBytes(byteLength: number): number {
  const stride = JOINT_FLOATS_PER_FRAME * 4;
  if (byteLength % stride !== 0) {
    throw new JointStreamError(
      `joints.f32 byte length ${byteLength} is not a multiple of the ` +
        `${JOINT_FLOATS_PER_FRAME}-float (${stride}-byte) canonical frame stride`,
    );
  }
  return byteLength / stride;
}

/**
 * Decode the two capture buffers into a `JointStream`. The two byte lengths must agree on the
 * frame count — if they disagree the capture is torn, and silently trusting the shorter one is how
 * a G4 timing metric ends up reading the wrong tick.
 */
export function decodeJointStream(
  jointsBuf: ArrayBuffer,
  chanBuf: ArrayBuffer,
  startTick = 0,
): JointStream {
  const frameCount = frameCountOfJointsBytes(jointsBuf.byteLength);
  const chanStride = CHANNEL_COUNT * 4;
  if (chanBuf.byteLength % chanStride !== 0) {
    throw new JointStreamError(
      `chan.f32 byte length ${chanBuf.byteLength} is not a multiple of the ` +
        `${CHANNEL_COUNT}-float (${chanStride}-byte) channel frame stride`,
    );
  }
  const chanFrames = chanBuf.byteLength / chanStride;
  if (chanFrames !== frameCount) {
    throw new JointStreamError(
      `torn capture: joints.f32 has ${frameCount} frames, chan.f32 has ${chanFrames}`,
    );
  }
  return createJointStream({
    frameCount,
    pos: new Float32Array(jointsBuf),
    chan: new Float32Array(chanBuf),
    startTick,
  });
}

/** The `joints.f32` payload for a stream. Copies, so the caller may keep writing the stream. */
export const encodeJoints = (s: JointStream): ArrayBuffer => s.pos.slice().buffer;
/** The `chan.f32` payload for a stream. */
export const encodeChannels = (s: JointStream): ArrayBuffer => s.chan.slice().buffer;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Series helpers the G4 metrics are built on. Kept here rather than in `metrics.ts` because they
 * are statements about the STREAM, not about karate, and `tests/integration/pipeline.test.ts`
 * exercises them without any kata data.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Seconds per stream frame: 1/480 s. */
export const FRAME_S = 1 / JOINT_RATE_HZ;

/**
 * Central-difference speed of one canonical joint, m/s, at frame `f`.
 *
 * NOTE ON THE FINITE-DIFFERENCE BAN. `tools/verify-contracts.mjs`'s `FINITE_DIFF_NAMED` ban covers
 * `src/contracts`, `src/data`, `src/solve`, `src/cloth` and `src/player` — and DELIBERATELY not
 * `src/eval`: §9.1 A-7 requires metrics 49–52 to measure acceleration off the 480 Hz joint stream
 * rather than read `chan.accel*`, "so G4 cannot measure the compiler's own intent", and that
 * measurement IS a difference. The ban is on the compiler DRIVING cloth from one.
 */
export function jointSpeed(s: JointStream, f: number, joint: CanonicalJoint): number {
  if (s.frameCount < 2) return 0;
  const a = f <= 0 ? 0 : f - 1;
  const b = f >= s.frameCount - 1 ? s.frameCount - 1 : f + 1;
  if (a === b) return 0;
  const oa = posOffset(a, joint);
  const ob = posOffset(b, joint);
  const dx = s.pos[ob]! - s.pos[oa]!;
  const dy = s.pos[ob + 1]! - s.pos[oa + 1]!;
  const dz = s.pos[ob + 2]! - s.pos[oa + 2]!;
  return Math.hypot(dx, dy, dz) / ((b - a) * FRAME_S);
}

/** Index of the maximum of `fn` over `[f0, f1]` inclusive, and the value there. */
export function argMax(
  f0: number,
  f1: number,
  fn: (f: number) => number,
): { readonly frame: number; readonly value: number } {
  let bestF = f0;
  let bestV = -Infinity;
  for (let f = f0; f <= f1; f++) {
    const v = fn(f);
    if (v > bestV) {
      bestV = v;
      bestF = f;
    }
  }
  return { frame: bestF, value: bestV === -Infinity ? 0 : bestV };
}
