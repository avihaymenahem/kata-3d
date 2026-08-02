/**
 * B0 CONTRACTS — `src/contracts/pose.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.9 verbatim, plus the layer weight box of §6.5.
 *
 * `PoseTrack` is the runtime contract: dense, dumb, immutable, seekable. `PoseSource.sample`
 * is the WHOLE runtime read path — a pure function of an integer plus a weight vector (§6.1,
 * §6.2). There is no accumulator, no spring, no IK solve, no clock read and no branch on
 * playback direction anywhere in it.
 *
 * Changing `CHANNELS` or `LAYER_ORDER` stops every agent — integrator commit only
 * (OWNERSHIP "the four changes that stop every agent", #4).
 */

import type { BoneIndex } from './bones';
import type { GarmentPartId } from './rig';
import type { TempoTier } from './kata';
import type { PoseRateHz, TicksPerFrame } from './time';
import type { Expect, IsNever, UnitRuleViolations } from './units';

/** 14 scalar channels, baked uniformly at CHAN_RATE_HZ. Order is FROZEN. */
export const CHANNELS = [
  'breath',        // 0..1, 1 = full inhale                                    doc 04 §8.1
  'tension',       // 0..1 kime envelope, JKA 0->10->0                         doc 04 §5
  'kiai',          // 0..1 vocal envelope                                      doc 04 §8.3
  'pelvisYawRate', // deg/s, ANALYTIC (holdThenSnap derivative)                doc 01 §8.3
  'accelL',        // m/s^2, left  wrist, ANALYTIC (kimeEaseAcc * pathLen)     doc 04 §4.5
  'accelR',        // m/s^2, right wrist, ANALYTIC
  'loadL',         // 0..1 vertical load share, left  foot                     doc 04 §7.1
  'loadR',
  'plantL',        // 0 | 1 plant state                                        doc 06 §6.3
  'plantR',
  'gazeYaw',       // deg, absolute world yaw of the gaze target
  'gazePitch',     // deg
  'blink',         // 0..1, 1 = fully closed; schedule seeded from track hash  doc 06 §6.5
  'tauMove',       // 0..1 progress within the current move window
] as const;
export type ChannelName = (typeof CHANNELS)[number];
export const CHANNEL_COUNT = 14 as const;

/** O(1) channel index. `CHANNELS` order IS the `chan` array stride order. */
export const CHANNEL_INDEX: Readonly<Record<ChannelName, number>> = (() => {
  const m = {} as Record<ChannelName, number>;
  for (let i = 0; i < CHANNELS.length; i++) m[CHANNELS[i]!] = i;
  return Object.freeze(m);
})();

/** Sparse, semantic. Authored/solved. NEVER shipped to the runtime. */
export interface PoseKey {
  readonly tick: number;
  readonly phase: 'start' | 'prep' | 'mid' | 'kime' | 'hold';
  readonly moveN: number;                    // 0 = ceremony
  readonly q: Float32Array;                  // BONE_COUNT*4, bone-local, xyzw
  readonly rootPos: Float32Array;            // 3, world metres
  readonly rootQuat: Float32Array;           // 4
  readonly chan: Float32Array;               // CHANNEL_COUNT
}

/**
 * One contiguous run of frames at a single ladder rung. Indexing inside a segment is O(1)
 * arithmetic; there is no per-bone binary search anywhere in the sampler.
 */
export interface PoseSegment {
  readonly startTick: number;      // inclusive, an exact multiple of ticksPerFrame
  readonly frameCount: number;     // >= 2
  readonly rateHz: PoseRateHz;
  readonly ticksPerFrame: TicksPerFrame;
  /** Index of this segment's frame 0 within PoseTrack.q, in FLOATS (frameIndex*BONE_COUNT*4). */
  readonly qOffset: number;
  /** Index of this segment's frame 0 within PoseTrack.rootPos / rootQuat, in FRAMES. */
  readonly frameOffset: number;
  /** Why this rung was chosen. 'base' | 'roll' | 'kime' | 'hipSnap' | 'contact'. */
  readonly reason: string;
}

export type LayerId = 'koshi' | 'kime' | 'breath' | 'gaze' | 'patch';
/** FROZEN composition order. Post-multiplication in the bone's own frame. */
export const LAYER_ORDER: readonly LayerId[] = Object.freeze([
  'koshi', 'kime', 'breath', 'gaze', 'patch',
]);

/**
 * The legal weight box, §6.5 interlock 1. `LayerTrack.minWeight / maxWeight` are compile-time
 * constants; S14 evaluates the composed chest yaw at the CORNERS of this box and asserts
 * <= 17 deg (the 15 deg X-factor cap of doc 04 §2.1 plus 2 deg margin). `patch` is capped at 1
 * because a corrective delta scaled above unity is no longer the correction that was reviewed.
 */
export const LAYER_WEIGHT_BOUNDS: Readonly<
  Record<LayerId, { readonly min: number; readonly max: number; readonly def: 1.0 }>
> = Object.freeze({
  koshi: { min: 0, max: 1.5, def: 1.0 },
  kime: { min: 0, max: 1.5, def: 1.0 },
  breath: { min: 0, max: 1.5, def: 1.0 },
  gaze: { min: 0, max: 1.5, def: 1.0 },
  patch: { min: 0, max: 1.0, def: 1.0 },
});

/** The RELEASE weight vector. `layerWeightsDirty` is true unless the live vector equals this. */
export const LAYER_WEIGHTS_DEFAULT: Readonly<Record<LayerId, number>> = Object.freeze({
  koshi: 1.0, kime: 1.0, breath: 1.0, gaze: 1.0, patch: 1.0,
});

/** S14 gate: composed chest yaw over the whole legal weight box (doc 04 §2.1 + 2 deg margin). */
export const CHEST_YAW_CAP_DEG = 15 as const;
export const CHEST_YAW_ENVELOPE_CAP_DEG = 17 as const;

/**
 * A baked delta layer. Shares PoseTrack.segments exactly, so alpha is computed once per frame.
 * dq[f][k] is the LOCAL delta applied to bone `bones[k]` at base frame f.
 * Deltas are built by INVERSION (dq_i = inv(q_{i-1}) * q_i), so composing every layer at
 * weight 1.0 reproduces the compiled pose to < 1e-4 deg. Asserted at bake time.
 */
export interface LayerTrack {
  readonly id: LayerId;
  readonly bones: readonly BoneIndex[];               // sorted ascending
  readonly dq: Float32Array;                          // baseFrameCount * bones.length * 4, xyzw
  /** breath only: ribcage non-uniform scale. null on every other layer. */
  readonly dScaleRibcage: Float32Array | null;        // baseFrameCount * 3
  readonly defaultWeight: 1.0;                        // RELEASE value. Always exactly 1.
  readonly minWeight: number;                         // look-dev floor
  readonly maxWeight: number;                         // look-dev ceiling
}

/** S14 gate: recompose error at w = 1, degrees. */
export const LAYER_RECOMPOSE_MAX_ERR_DEG = 1e-4;

/**
 * A discrete, exactly-timed mechanical event. This REPLACES thresholding a differentiated
 * acceleration signal, which produced an impulse train instead of one crack (judge 1 fatal A2).
 */
export interface ImpulseEvent {
  readonly tick: number;                  // exact, TICK_HZ
  readonly kind: 'limb-stop' | 'foot-contact' | 'hip-snap' | 'kiai';
  readonly moveN: number;
  readonly bone: BoneIndex;               // the decelerating bone
  /**
   * A SPEED: metres per second, the magnitude of the velocity step removed at the stop.
   *
   * The `Ms` suffix is §3.9 verbatim and collides with §2.2's suffix table, where `Ms` means
   * MILLISECONDS. It is NOT a time. A consumer that applies §2.2's rule literally scales the
   * crack impulse by a duration instead of a speed, and the symptom looks like a mistuned gain —
   * so the natural response is to retune `CLOTH.alphaBend` until the swatch test breaks. B3
   * produces it, B7's `impulseQueue` and cloth drive consume it; both read m/s.
   * (`TechniqueDynamics.vPkMs` has the same collision and resolves it by carrying `unit: 'm/s'`
   * on its `Num`; a bare number cannot, so the exemption is named in the audit below instead.)
   */
  readonly deltaVMs: number;
  readonly dirWorld: readonly [number, number, number];   // unit, pre-stop velocity direction
  /** doc 04 §9.1: 10-20 ms limb-stop -> visible crack. 38..77 ticks. EXACT, never interpolated. */
  readonly crackDelayTicks: number;
  readonly targets: readonly GarmentPartId[];
}

/**
 * §2.2 audit for `ImpulseEvent`. `tick` and `moveN` are indices, `bone` is a `BoneIndex`; every
 * other numeric field carries a suffix. Making the exemptions explicit is what puts `deltaVMs`'s
 * suffix collision in front of a reviewer rather than leaving it to be discovered downstream.
 */
export type AuditImpulseEvent =
  Expect<IsNever<UnitRuleViolations<ImpulseEvent, 'tick' | 'moveN' | 'bone'>>>;

/** doc 04 §9.1 at TICK_HZ = 3840: msToTick(10) = 38, msToTick(20) = 77. S15 asserts the range. */
export const CRACK_DELAY_TICKS_MIN = 38 as const;
export const CRACK_DELAY_TICKS_MAX = 77 as const;

export interface TrackMark {
  readonly kind: 'move-start' | 'prep' | 'foot-contact' | 'kime' | 'kiai' | 'hold-end' | 'ceremony';
  readonly tick: number;
  readonly moveN: number;
  readonly label: string;
}

/** Pure data the compiled foot solve produced. No runtime state. */
export interface PlantSpan {
  readonly foot: 'L' | 'R';
  readonly tickIn: number;
  readonly tickOut: number;
  readonly worldPosXZ: readonly [number, number];   // metres
  readonly worldYawDeg: number;
  readonly pivot: {
    readonly kind: 'BALL' | 'HEEL' | 'WHOLE_FOOT';
    readonly pointXZ: readonly [number, number];    // metres, the point that does NOT move
    readonly fromDeg: number; readonly toDeg: number;
    readonly tick0: number; readonly tick1: number;
  } | null;
}

/** Per-move worst-case residuals. Written by the compiler, read by the fix router. */
export interface SolveDiagnostics {
  readonly rateHz: 480;
  readonly frameCount: number;
  readonly ikResidualM: Float32Array;        // frameCount*4 : [armL, armR, legL, legR], metres
  readonly plantSlipM: Float32Array;         // frameCount*2 : [L, R], metres
  readonly comErrH: Float32Array;            // frameCount, FracH
  readonly headYH: Float32Array;             // frameCount, FracH, head_end world Y
  readonly pelvisYawDeg: Float32Array;       // frameCount, world
  /** Per-move max clamp saturation per bone, 0..1. moveCount*BONE_COUNT. Not per-frame. */
  readonly clampSatByMove: Float32Array;
  readonly worst: {
    readonly ikResidualM: number; readonly ikResidualAtTick: number; readonly ikResidualMoveN: number;
    readonly plantSlipM: number;  readonly plantSlipAtTick: number;
    readonly headBobH: number;    readonly headBobMoveN: number;
    readonly clampSat: number;    readonly clampSatBone: BoneIndex;
  };
}

export interface BakeStats {
  readonly segments: number;
  readonly framesByRate: Readonly<Record<'120' | '240' | '480' | '960', number>>;
  readonly baseFrames: number;
  readonly bytes: number;
  readonly compileMs: number;
  readonly maxSlerpErrDeg: number;     // GATE G-9a: < 0.25
  readonly maxStepDeg: number;         // GATE G-9b: <= 12.0
  readonly maxStepBone: BoneIndex;
  readonly maxStepAtTick: number;
  /**
   * GATE G-9c. Its meaning is STRUCTURAL, not numeric: every `ImpulseEvent.tick` and every
   * `crackDelayTicks` is an INTEGER TICK PRODUCED BY `msToTick`, never a value read off a frame
   * grid or carried as a fractional millisecond. Do NOT implement it by calling
   * `survivesQuantisation` in a loop — that predicate is a statement about the CLOCK (is 3840 Hz
   * fine enough?) and is true for every input at this tick rate, so a gate built on it would
   * report `true` unconditionally. `tests/contracts/tickrate.test.ts` checks the structural form:
   * `Number.isInteger` on every event tick and crack delay, plus the [38, 77] range.
   */
  readonly eventsBelow20msExact: boolean;   // GATE G-9c
  readonly layerRecomposeErrDeg: number;    // GATE: < 1e-4
  readonly worstCaseChestYawDeg: number;    // GATE: <= 15 + 2 (doc 04 §2.1 X-factor cap)
  readonly stageAssertsPassed: readonly string[];
}

/** Dense, dumb, immutable, seekable. THE runtime contract. */
export interface PoseTrack {
  readonly schema: 'pose-track/2';
  readonly kataId: string;
  readonly tempoTier: TempoTier;
  readonly durationTicks: number;
  readonly durationS: number;
  readonly segments: readonly PoseSegment[];
  /** Concatenated per segment. Bone-local quaternions, xyzw. */
  readonly q: Float32Array;
  readonly rootPos: Float32Array;            // baseFrames*3, world metres
  readonly rootQuat: Float32Array;           // baseFrames*4, xyzw
  readonly layers: readonly LayerTrack[];    // exactly LAYER_ORDER.length entries, in that order
  readonly chanRateHz: 480;
  readonly chanFrameCount: number;
  readonly chan: Float32Array;               // chanFrameCount*CHANNEL_COUNT
  readonly impulses: readonly ImpulseEvent[];
  readonly marks: readonly TrackMark[];
  readonly plants: readonly PlantSpan[];
  readonly diagnostics: SolveDiagnostics;
  readonly bakeStats: BakeStats;
  /** fnv1a-64 over every Num.v, every patch, the tempo tier, and the solver code version. */
  readonly hash: string;
}

/** Caller-owned scratch. The sampler never allocates. */
export interface PoseFrame {
  readonly q: Float32Array;          // BONE_COUNT*4
  readonly rootPos: Float32Array;    // 3
  readonly rootQuat: Float32Array;   // 4
  readonly chan: Float32Array;       // CHANNEL_COUNT
  readonly scaleRibcage: Float32Array; // 3
}

/** The WHOLE runtime read path. Pure function of an integer plus a weight vector. */
export interface PoseSource {
  readonly track: PoseTrack;
  /**
   * Writes into `out`. Slerps between the two bracketing frames of the segment containing `tick`,
   * then post-multiplies each layer delta scaled by `weights[layerId]`.
   * MUST be free of allocation, wall-clock reads and hidden state other than a segment cursor
   * cache whose only effect is speed.
   */
  sample(tick: number, weights: Readonly<Record<LayerId, number>>, out: PoseFrame): void;
  /** Nearest baked key at or below tick, for frame-stepping the UI. */
  keyTickAtOrBefore(tick: number): number;
}
