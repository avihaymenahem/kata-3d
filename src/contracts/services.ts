/**
 * B0 CONTRACTS — `src/contracts/services.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.12 verbatim, plus the still-accumulator and harness constants of
 * §5.3 / §6.3 that the interfaces below refer to by name.
 *
 * These are the runtime seams. `KataHarness` is the frozen boundary between the player (B6)
 * and the critic (B9) — `window.__KATA_HARNESS__`.
 *
 * The `import('three').Camera` below is a type-only inline import, erased at compile time; see
 * the note at the head of `rig.ts`.
 */

import type { TempoTier } from './kata';
import type { BakeStats, LayerId, PoseFrame, PoseTrack, TrackMark } from './pose';
import type { Landmarks } from './rig';
import type { MetricResult, Scorecard } from './scorecard';

export interface Transport {
  readonly tick: number;                 // integer, TICK_HZ
  readonly rate: number;                 // -2 .. +2; 0 = paused
  readonly playing: boolean;
  readonly loop: { readonly t0: number; readonly t1: number } | null;
  advance(dtSeconds: number): number;    // returns the new integer tick
  seekTick(tick: number): void;
  seekMove(n: number, phase: TrackMark['kind']): void;
  stepDisplayFrames(n: number): void;    // +-DISPLAY_TICKS
  stepKeys(n: number): void;             // +-1 baked key in the current segment
  loopMove(n: number): void;
  clearLoop(): void;
  setRate(r: number): void;
  readonly marks: readonly TrackMark[];
}

/** Rate presets of §6.7. Negative rate = reverse, free, because sampling is stateless. */
export const RATE_PRESETS: readonly number[] = Object.freeze([0.1, 0.25, 0.5, 1, 1.5, 2]);
export const RATE_MIN = -2 as const;
export const RATE_MAX = 2 as const;

/** A layer that CANNOT be baked. There is exactly one: the debug pose-poke. Never active in a run. */
export interface RuntimeLayer {
  readonly id: 'poke';
  readonly enabled: boolean;
  apply(frame: PoseFrame, tick: number): void;
}

export interface ClothSystem {
  /** Advance to `tick` from the current state. Consumes ImpulseEvents whose fire tick is crossed. */
  step(tick: number): void;
  /** Snapshot-restore + fixed-substep fast-forward. Deterministic given `track.hash`. */
  seek(tick: number, mode: 'exact' | 'preview'): void;
  /** Writes into the garment BufferAttributes via render/clothBridge. */
  upload(): void;
  reinit(tick: number): void;
  readonly stateHash: string;
  readonly particleCount: number;
}

/** doc 06 §7.4 / §7.5, fenced by §6.4: fixed substep, driven by ticks, never by wall clock. */
export const CLOTH_SUBSTEPS_PER_FRAME = 8 as const;
export const CLOTH_SUBSTEP_HZ = 480 as const;

export type CameraPresetId =
  | 'ORBIT' | 'HERO' | 'JUDGE' | 'LOW34' | 'FOLLOW' | 'EMBUSEN'
  | 'DETAIL_HANDS' | 'DETAIL_FEET'
  | 'M_FRONT' | 'M_LEFT' | 'M_RIGHT' | 'M_TOP';

/**
 * The four ortho measurement cameras, FROZEN FOREVER at doc 07 §6.6's transforms. Ortho is
 * mandatory: perspective foreshortening corrupts every length metric read off an image (§5.7).
 */
export const MEASUREMENT_CAMERAS: readonly CameraPresetId[] = Object.freeze([
  'M_FRONT', 'M_LEFT', 'M_RIGHT', 'M_TOP',
]);

/** The default per-kime camera set of §7.3. `LOW34` is in the DEFAULT list, not just the bar. */
export const DEFAULT_KIME_CAMERAS: readonly CameraPresetId[] = Object.freeze([
  'M_FRONT', 'M_LEFT', 'M_TOP', 'HERO', 'LOW34',
]);

export interface CameraRig {
  readonly active: CameraPresetId;
  /** Eased blend over 0.6 s. Interactive use only. */
  setPreset(id: CameraPresetId): void;
  /** Exact, no blend, resets the still accumulator. THE harness path. */
  snapTo(id: CameraPresetId): void;
  update(dtSeconds: number, landmarks: Landmarks): void;
  readonly camera: import('three').Camera;
}

/** Interactive preset changes blend over this long; `snapTo` never blends (§5.7). */
export const CAMERA_BLEND_S = 0.6 as const;

export interface PostStack {
  setMode(mode: 'play' | 'still' | 'capture'): void;
  /** Progressive still accumulation: sample index k, pure function of k. Resets on any change. */
  resetStill(): void;
  readonly stillSample: number;     // 0..STILL_SAMPLES
  readonly stillConverged: boolean;
  render(dtSeconds: number): void;
  setSize(w: number, h: number, dpr: number): void;
  dispose(): void;
}

/**
 * §5.3. `StillAccumulator` owns the Halton(2,3) camera view-offset jitter, at the composer
 * level, so it applies to every pass that reads `camera` — including GTAOPass's own internal
 * `renderer.render(this.scene, this.camera)`. Sample `k` is a pure function of `k`, so a
 * captured PNG is a pure function of (tick, camera, trackHash, layerWeights) and TAA
 * convergence leaves the determinism ledger entirely.
 */
export const STILL_SAMPLES = 32 as const;
export const STILL_SAMPLES_LOW = 12 as const;   // mobile `low` tier, §6.6

/** `?harness=1` pins the canvas so a capture is size-independent (§6.3, §3.4.1 BootOpts). */
export const HARNESS_CANVAS_PX = 1024 as const;
export const HARNESS_DPR = 1 as const;

export interface ShotSpec {
  readonly tick: number;
  readonly moveN: number;
  readonly mark: TrackMark['kind'];
  readonly camera: CameraPresetId;
  readonly png: boolean;
  readonly silhouette: boolean;
  readonly strip: boolean;
  /** 'step-04_t07.750_kime_M_LEFT_hidari-chudan-oi-zuki_zenkutsu' */
  readonly name: string;
}

export interface RunInfo {
  readonly gitSha: string; readonly trackHash: string; readonly contractHash: string;
  readonly threeRevision: string; readonly tempoTier: TempoTier;
  readonly layerWeights: Readonly<Record<LayerId, number>>;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly bake: BakeStats;
  readonly diagnosticsWorst: PoseTrack['diagnostics']['worst'];
  readonly clothStateHash: string;
  readonly perf: Scorecard['perf'];
}

/** window.__KATA_HARNESS__ . The frozen boundary between the player (B6) and the critic (B9). */
export interface KataHarness {
  readonly ready: Promise<void>;
  readonly trackHash: string;
  listKata(): readonly string[];
  load(kataId: string, o?: { tempoTier?: TempoTier; quality?: 'low' | 'high' | 'max' }): Promise<void>;
  plan(): readonly ShotSpec[];
  marks(): readonly TrackMark[];
  /**
   * Seek then settle. `mode: 'exact'` replays cloth from the last snapshot at a fixed substep.
   * The capture driver calls this in MONOTONICALLY INCREASING tick order, so cloth advances
   * through the whole kata exactly ONCE per run, not once per shot.
   */
  seek(tick: number, o?: { mode?: 'exact' | 'preview' }): Promise<void>;
  setCamera(id: CameraPresetId): void;               // snapTo, never blends
  setLayerWeight(id: LayerId, w: number): void;      // look-dev only; see refuseNonDefault
  /** Renders until the still accumulator converges (STILL_SAMPLES frames). */
  settle(): Promise<void>;
  joints(): Landmarks;
  /** The 480 Hz canonical-joint stream for [fromTick, toTick]. CANONICAL_COUNT*3 f32 per frame. */
  streamJoints(fromTick: number, toTick: number): ArrayBuffer;
  streamChannels(fromTick: number, toTick: number): ArrayBuffer;
  /** In-page metric pass. Identical code to the Node path (src/eval is GL-free). */
  metrics(moveN: number): readonly MetricResult[];
  scorecard(): Scorecard;
  shot(): string;                                    // dataURL, PNG of the live canvas
  silhouette(): string;                              // dataURL, white-on-black mask
  strip(moveN: number, cam: CameraPresetId): string; // [ours | ref stick | overlay | absdiff]
  runInfo(): RunInfo;
  /** TRUE unless every layer weight is exactly its defaultWeight. Capture ABORTS when true. */
  readonly layerWeightsDirty: boolean;
}

/** The global the harness installs itself on. B9's browser driver waits for this. */
export const HARNESS_GLOBAL = '__KATA_HARNESS__' as const;
