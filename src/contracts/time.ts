/**
 * B0 CONTRACTS — `src/contracts/time.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.2 verbatim, plus §2.4 (the dyadic ladder and its arithmetic)
 * and the T0…T3 tempo table of doc 04 §6.2.
 *
 * ZERO IMPORTS, by contract (§4.0 / OWNERSHIP B0): shared by the compiler (B3) and the
 * metrics module (B9).
 *
 * Changing `TICK_HZ` or `POSE_LADDER` stops every agent — integrator commit only
 * (OWNERSHIP "the four changes that stop every agent", #3).
 */

export const TICK_HZ = 3840 as const;          // transport clock, integer ticks
export const CHAN_RATE_HZ = 480 as const;      // channel array + diagnostics, uniform
export const JOINT_RATE_HZ = 480 as const;     // harness canonical-joint stream
export const DISPLAY_TICKS = 64 as const;      // one 60 fps frame

/**
 * `3840 = 2^8 · 15`, so every ladder rung divides it exactly and every interpolation alpha
 * is an exact dyadic rational in float64 (k/4, k/8, k/16, k/32). That exactness is the whole
 * reason §6.2 term 3 cannot leak: a non-dyadic rate makes alpha a rounded float whose value
 * depends on the arithmetic path.
 */
export const TICK_HZ_FACTORISATION = '2^8 * 15' as const;

/** The dyadic bake ladder. Index 0 is the base rung. */
export const POSE_LADDER = [120, 240, 480, 960] as const;
export type PoseRateHz = (typeof POSE_LADDER)[number];
/** TICK_HZ / rateHz. Always a power of two here: 32, 16, 8, 4. */
export type TicksPerFrame = 32 | 16 | 8 | 4;
export const ticksPerFrame = (hz: PoseRateHz): TicksPerFrame => (TICK_HZ / hz) as TicksPerFrame;

/** Ticks per rung, in ladder order: [32, 16, 8, 4]. */
export const POSE_LADDER_TPF = [32, 16, 8, 4] as const;

/** TICK_HZ / CHAN_RATE_HZ === 8. §6.2 term 7 divides by exactly this. */
export const CHAN_TICKS_PER_FRAME = 8 as const;

/* ── Build gates G-9a / G-9b / G-9c (§2.4, §7.5). ─────────────────────────────── */

export const BAKE_MAX_ERR_DEG = 0.25 as const;   // midpoint geodesic slerp error
export const BAKE_MAX_STEP_DEG = 12.0 as const;  // angular step per baked interval
export const EVENT_EXACT_BELOW_MS = 20 as const; // events under this must be exact integer ticks

/**
 * Why the ladder needs the 960 rung (§2.4). Doc 03 §4.3 authors the forearm roll as
 * `roll(tau) = 180 * clamp((tau-0.65)/0.35, 0, 1)^2.2` over a 0.18 s stroke:
 *   dtheta/dt peaks at 6285 deg/s, d2theta/dt2 at ~1.20e5 deg/s^2.
 * Criterion (2), <= 12 deg per baked interval, needs dt <= 12/6285 = 1.91 ms => 524 Hz
 *   => the 960 rung.
 * Criterion (1), theta'' * dt^2 / 8 <= 0.25 deg, needs dt <= 4.08 ms => 245 Hz.
 * Criterion (2) BINDS; it is the anti-staircase criterion.
 */
export const ROLL_PEAK_RATE_DEG_S = 6285 as const;      // doc 03 §4.3, ARCHITECTURE §2.4
export const ROLL_PEAK_ACCEL_DEG_S2 = 1.2e5 as const;   // doc 03 §4.3, ARCHITECTURE §2.4

/* ── tick <-> time. Pure integer arithmetic on the tick side. ─────────────────── */

export const secToTick = (s: number): number => Math.round(s * TICK_HZ);
export const tickToSec = (t: number): number => t / TICK_HZ;
export const msToTick = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);

/** 1000 / TICK_HZ = 0.2604166… ms. The resolution of every `ImpulseEvent` (§2.4). */
export const TICK_MS = 1000 / TICK_HZ;
/** Worst-case quantisation error of `msToTick`: half a tick, 0.1302 ms. */
export const TICK_QUANT_MS = TICK_MS / 2;
export const tickToMs = (t: number): number => (t * 1000) / TICK_HZ;

/**
 * The actual cost of carrying `msValue` as an integer tick count, in ms. THIS is the quantity a
 * caller should compare against its own tolerance; `TICK_QUANT_MS` is only its upper bound.
 */
export const quantisationErrorMs = (msValue: number): number =>
  Math.abs(tickToMs(msToTick(msValue)) - msValue);

/**
 * The CLOCK-INDEPENDENT bound G-9c is stated against. It must NOT be derived from `TICK_HZ`:
 * `|round(y) - y| <= 0.5` is true for every finite input, so a bound of half a tick makes the
 * predicate a tautology at ANY tick rate — including the 60 fps grid §2.4 exists to reject.
 * 0.2 ms is an order below the tightest tolerance in doc 04 (the +-5 ms crack delay of §9.1) and
 * an order above `TICK_QUANT_MS = 0.130`, so the predicate is satisfiable here and FALSE on any
 * clock coarser than 2500 Hz.
 */
export const QUANT_TOL_MS = 0.2 as const;

/**
 * G-9c, stated as a falsifiable predicate: carrying `msValue` as an integer tick count costs less
 * than `QUANT_TOL_MS`. At TICK_HZ = 3840 the worst case is 0.130 ms and every doc-04 quantity
 * passes; at 60 Hz the 17 ms hikite lead costs 0.33 ms and FAILS, which is the whole point.
 */
export const survivesQuantisation = (msValue: number, tolMs: number = QUANT_TOL_MS): boolean =>
  quantisationErrorMs(msValue) <= tolMs + 1e-12;

/**
 * The STRICT reading of §2.4's "lands on an exact tick": zero quantisation error, not merely a
 * small one. True for 25 ms (96 ticks) and false for 10 / 17 / 20 ms, so it is a real statement
 * about a value rather than about the clock. `BakeStats.eventsBelow20msExact` is NOT this
 * predicate — see the note on that field in `pose.ts`.
 */
export const landsOnExactTick = (msValue: number): boolean =>
  Number.isInteger((msValue * TICK_HZ) / 1000);

/** Snap a tick down to the frame grid of a given rung. */
export const floorToFrame = (t: number, tpf: TicksPerFrame): number => t - (t % tpf);

/** True iff `t` is exactly on the frame grid of `tpf`. `PoseSegment.startTick` must be. */
export const isOnFrameGrid = (t: number, tpf: TicksPerFrame): boolean => t % tpf === 0;

/**
 * The interpolation alpha of §6.2 term 3. Exactly k/32, k/16, k/8 or k/4 — representable
 * without rounding in float64, which is what makes `sample(tick)` path-independent.
 */
export const frameAlpha = (t: number, startTick: number, tpf: TicksPerFrame): number =>
  ((t - startTick) % tpf) / tpf;

/* ── The tempo table, T0…T3 (doc 04 §6.2; ARCHITECTURE §3.6, §6.7). ───────────── */

/**
 * `tempoScale` multiplies `T_prep` and `T_hold` ONLY — never `T_tech`, `T_thrust` or
 * `T_kime` (doc 04 §6.2, §11 invariant 7). That makes the JKA "contrast in speed"
 * criterion structural: a tempo change cannot flatten a technique.
 *
 * T0 slow teaching count · T1 JKA official/exam reference (DEFAULT) ·
 * T2 senior-instructor performance · T3 WKF competition, expressive.
 *
 * Lives here rather than in `kata.ts` so the tempo table has exactly one home; `TempoTier`
 * in `kata.ts` is proven to be exactly this key set by a compile-time assertion there.
 */
export const TEMPO_SCALE = {
  T0: 1.35,
  T1: 1.0,
  T2: 0.78,
  T3: 0.62,
} as const;
export type TempoTierId = keyof typeof TEMPO_SCALE;

/** Reference seconds per count at each tier (doc 04 §6.2). Diagnostics/UI only. */
export const TEMPO_SECONDS_PER_COUNT = {
  T0: 3.0,
  T1: 1.9,
  T2: 1.36,
  T3: 1.55,
} as const;

/** Whole-clip nominal seconds at T1, including both ceremonies (doc 02 §2). */
export const CLIP_SECONDS_T1 = {
  'taikyoku-shodan': 50.15,
  'heian-shodan': 54.65,
} as const;

/** Moves-only nominal seconds at T1 (doc 02 §4.1 / §6.1 t_cum totals). */
export const MOVE_SECONDS_T1 = {
  'taikyoku-shodan': 35.25,
  'heian-shodan': 39.75,
} as const;

/** Heian Shodan at T1 = 54.65 s = 209 856 ticks (§2.4). */
export const HEIAN_T1_TICKS = 209_856 as const;
