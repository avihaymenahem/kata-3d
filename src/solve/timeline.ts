/**
 * B3 SOLVER — `src/solve/timeline.ts`
 *
 * `buildTimeline` — the whole clip as integer tick windows. doc 02 §1.4, doc 04 §6.2–§6.3;
 * ARCHITECTURE.md §4.11 S1.
 *
 * ═══ EVERY BOUNDARY IS AN INTEGER TICK, AND THEY ARE ROUNDED CUMULATIVELY ═══════════════════
 * The naive construction rounds each window's DURATION to ticks and sums them. That accumulates
 * drift — 41 moves × up to half a tick each — and worse, it makes window `k`'s end differ from
 * window `k+1`'s start, so S1's contiguity invariant fails on data that is arithmetically fine.
 *
 * This file instead accumulates EXACT SECONDS and rounds each CUMULATIVE boundary once. Durations
 * are then differences of integers, so they are integers by construction, contiguity is exact by
 * construction, and the total drift against the authored `Σ tSlotS` is bounded by half a tick
 * (0.13 ms) for the whole clip rather than growing with the move count.
 *
 * ═══ `tempoScale` MULTIPLIES `T_prep` AND `T_hold` ONLY ═════════════════════════════════════
 * doc 04 §6.2, §11 invariant 7, and it is structural rather than stylistic: it makes the JKA
 * "contrast in speed" criterion impossible to violate by retiming. A tempo tier changes how long
 * the character waits and winds up; it cannot flatten the technique itself. `T_transit` and
 * `T_kime` are therefore passed through untouched, and S1 asserts exactly that by recomputing the
 * unscaled pair from `TEMPO_CLASSES` and comparing.
 */

import type { CeremonyPhase, KataId, KataScore, MovePatch, TempoTier } from '../contracts';
import { TEMPO_SCALE, secToTick } from '../contracts';
import { TEMPO_CLASSES, tHoldFor } from '../data';

export type SlotKind = 'ceremony-open' | 'move' | 'ceremony-close';

/** One integer tick window, half-open: `[t0, t1)`. */
export interface Window {
  readonly t0: number;
  readonly t1: number;
}

export interface Slot {
  readonly kind: SlotKind;
  /** 1-based move number; 0 for a ceremony phase. */
  readonly moveN: number;
  /** Ceremony phase id, or the move's tempo class. Diagnostics only. */
  readonly label: string;
  readonly t0: number;
  readonly t1: number;
  /** The previous kime sustained. Scaled by `tempoScale`. */
  readonly hold: Window;
  /** Head/eyes lead, weight onto the pivot foot, hikite wind-up. Scaled by `tempoScale`. */
  readonly prep: Window;
  /** Translation, yaw and limb travel. NEVER scaled. */
  readonly transit: Window;
  /** The terminal snap. NEVER scaled. */
  readonly kime: Window;
  /** The arrival tick — the last tick of `kime`, i.e. `t1 - 1`. This is where a mark lands. */
  readonly kimeTick: number;
}

export interface Timeline {
  readonly kataId: KataId;
  readonly tempoTier: TempoTier;
  readonly tempoScale: number;
  readonly slots: readonly Slot[];
  /** Move slots only, indexed by `moveN - 1`. */
  readonly moveSlots: readonly Slot[];
  readonly durationTicks: number;
  readonly durationS: number;
  /** `Σ tSlotS` after scaling, in seconds — what metric 48 `kata_total_s` measures. */
  readonly moveSecondsScaled: number;
}

/** Four exact second durations for one move, before tick quantisation. */
interface Parts {
  readonly holdS: number;
  readonly prepS: number;
  readonly transitS: number;
  readonly kimeS: number;
}

/**
 * doc 02 §1.4's decomposition for one move at one tier.
 *
 * `tHoldFor` reconstructs the kata's own hold as `t_slot − (t_prep + t_transit + t_kime)`, which
 * reproduces doc 02 §1.4's Taikyoku column exactly and returns the authored Heian value for
 * Heian — so the four parts sum to the AUTHORED `tSlotS` at T1 and the timeline cannot disagree
 * with the score's own total.
 *
 * A per-move `timing` override (§3.7 `MoveOverride.timing`) replaces the corresponding part.
 */
export function movePartsS(
  kataId: KataId,
  tempo: Slot['label'],
  scale: number,
  patch: MovePatch,
): Parts {
  const c = TEMPO_CLASSES[tempo as keyof typeof TEMPO_CLASSES];
  const t = patch.override.timing;
  const prepS = (t?.tPrepS ?? c.tPrep.v) * scale;
  const kimeS = t?.tKimeS ?? c.tKime.v;
  const holdBase = t?.tHoldS ?? tHoldFor(kataId, tempo as Parameters<typeof tHoldFor>[1]);
  const holdS = holdBase * scale;
  /* `tSlotS` is the authority for the whole slot when a patch overrides it; transit absorbs the
   * difference, because transit is the only part with no independent doc-04 budget. */
  const transitS =
    t?.tSlotS === undefined
      ? c.tTransit.v
      : Math.max(1 / 240, t.tSlotS - (holdS + prepS + kimeS));
  return { holdS, prepS, transitS, kimeS };
}

/** A ceremony phase is all hold: nothing arrives, so `tempoScale` applies to the whole of it. */
const ceremonyPartsS = (p: CeremonyPhase, scale: number): Parts => ({
  holdS: p.durationS * scale,
  prepS: 0,
  transitS: 0,
  kimeS: 0,
});

/**
 * §4.11 S1. Build the whole clip: opening ceremony, every move, closing ceremony.
 *
 * Pure: no wall clock, no randomness, no mutation of its inputs.
 */
export function buildTimeline(
  k: KataScore,
  tempoTier: TempoTier,
  patchOf: (n: number) => MovePatch,
): Timeline {
  const scale = TEMPO_SCALE[tempoTier];
  const slots: Slot[] = [];
  const moveSlots: Slot[] = [];

  /* EXACT seconds, accumulated. Every tick boundary is `secToTick` of a cumulative value. */
  let cumS = 0;
  let cumTick = 0;
  let moveSecondsScaled = 0;

  const push = (kind: SlotKind, moveN: number, label: string, parts: Parts): void => {
    const t0 = cumTick;
    const bHold = secToTick(cumS + parts.holdS);
    const bPrep = secToTick(cumS + parts.holdS + parts.prepS);
    const bTransit = secToTick(cumS + parts.holdS + parts.prepS + parts.transitS);
    const total = parts.holdS + parts.prepS + parts.transitS + parts.kimeS;
    let bKime = secToTick(cumS + total);

    /* Every window must be NON-EMPTY (S1). A 0.05 s P0 pause at T3 rounds three boundaries onto
     * the same tick; nudging forward is the only repair that preserves both contiguity and
     * ordering, and it costs at most 4 ticks (1.04 ms) per slot. */
    const h1 = Math.max(bHold, t0 + 1);
    const p1 = Math.max(bPrep, h1 + 1);
    const r1 = Math.max(bTransit, p1 + 1);
    if (bKime < r1 + 1) bKime = r1 + 1;

    const slot: Slot = {
      kind,
      moveN,
      label,
      t0,
      t1: bKime,
      hold: { t0, t1: h1 },
      prep: { t0: h1, t1: p1 },
      transit: { t0: p1, t1: r1 },
      kime: { t0: r1, t1: bKime },
      kimeTick: bKime - 1,
    };
    slots.push(slot);
    if (kind === 'move') {
      moveSlots.push(slot);
      moveSecondsScaled += total;
    }
    cumS += total;
    cumTick = bKime;
  };

  for (const p of k.openingCeremony) push('ceremony-open', 0, p.id, ceremonyPartsS(p, scale));
  for (const m of k.moves) {
    push('move', m.n, m.tempo, movePartsS(k.id, m.tempo, scale, patchOf(m.n)));
  }
  for (const p of k.closingCeremony) push('ceremony-close', 0, p.id, ceremonyPartsS(p, scale));

  return {
    kataId: k.id,
    tempoTier,
    tempoScale: scale,
    slots: Object.freeze(slots),
    moveSlots: Object.freeze(moveSlots),
    durationTicks: cumTick,
    durationS: cumTick / 3840,
    moveSecondsScaled,
  };
}

/**
 * Progress `τ ∈ [0, 1]` through a move's TECHNIQUE window at an absolute tick.
 *
 * The technique runs `transit.t0 → t1`: `T_transit + T_kime`. Before `transit.t0` it is 0 (the
 * character is holding or winding up), after `t1` it is 1 (the pose is locked). That is what
 * makes `chan.tauMove` a well-defined 0..1 everywhere on the clip rather than only inside a move.
 */
export function tauOfSlot(s: Slot, tick: number): number {
  const a = s.transit.t0;
  const b = s.t1;
  if (tick <= a) return 0;
  if (tick >= b) return 1;
  return (tick - a) / (b - a);
}

/** The technique window's duration in seconds — the `T` in `S''(τ)·L/T²`. */
export function techDurationS(s: Slot): number {
  return (s.t1 - s.transit.t0) / 3840;
}

/** The slot containing `tick`, or `null` past the end. Binary search; the slots are ascending. */
export function slotAt(tl: Timeline, tick: number): Slot | null {
  let lo = 0;
  let hi = tl.slots.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = tl.slots[mid]!;
    if (tick < s.t0) hi = mid - 1;
    else if (tick >= s.t1) lo = mid + 1;
    else return s;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * S1's exit invariant, as a report the stage asserter turns into a throw.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface TimelineReport {
  readonly ok: boolean;
  readonly detail: string;
}

export function checkTimeline(tl: Timeline, k: KataScore): TimelineReport {
  const bad: string[] = [];

  let cursor = 0;
  for (const s of tl.slots) {
    if (s.t0 !== cursor) bad.push(`slot ${s.label}@${s.moveN}: starts at ${s.t0}, expected ${cursor}`);
    const ws = [s.hold, s.prep, s.transit, s.kime];
    for (const w of ws) {
      if (!Number.isInteger(w.t0) || !Number.isInteger(w.t1)) {
        bad.push(`slot ${s.label}@${s.moveN}: non-integer window ${w.t0}..${w.t1}`);
      }
      if (w.t1 <= w.t0) bad.push(`slot ${s.label}@${s.moveN}: empty window ${w.t0}..${w.t1}`);
    }
    if (s.hold.t1 !== s.prep.t0 || s.prep.t1 !== s.transit.t0 || s.transit.t1 !== s.kime.t0) {
      bad.push(`slot ${s.label}@${s.moveN}: windows are not contiguous`);
    }
    if (s.kime.t1 !== s.t1) bad.push(`slot ${s.label}@${s.moveN}: kime does not end the slot`);
    cursor = s.t1;
  }
  if (cursor !== tl.durationTicks) {
    bad.push(`slots end at ${cursor}, durationTicks is ${tl.durationTicks}`);
  }

  /* `tempoScale` touched only `T_prep` and `T_hold` — recompute the unscaled pair and compare. */
  for (const s of tl.moveSlots) {
    const c = TEMPO_CLASSES[s.label as keyof typeof TEMPO_CLASSES];
    if (c === undefined) continue;
    const transitTicks = s.transit.t1 - s.transit.t0;
    const kimeTicks = s.kime.t1 - s.kime.t0;
    const wantTransit = secToTick(c.tTransit.v);
    const wantKime = secToTick(c.tKime.v);
    /* +-4 ticks: the cumulative rounding and the non-empty nudge each cost at most one tick per
     * boundary, and there are four boundaries. A tempoScale leak would be off by 22-35 %. */
    if (Math.abs(transitTicks - wantTransit) > 4) {
      bad.push(`move ${s.moveN}: T_transit ${transitTicks} ticks, unscaled is ${wantTransit} — tempoScale leaked`);
    }
    if (Math.abs(kimeTicks - wantKime) > 4) {
      bad.push(`move ${s.moveN}: T_kime ${kimeTicks} ticks, unscaled is ${wantKime} — tempoScale leaked`);
    }
  }

  if (tl.moveSlots.length !== k.moves.length) {
    bad.push(`${tl.moveSlots.length} move slots for ${k.moves.length} moves`);
  }

  return { ok: bad.length === 0, detail: bad.slice(0, 6).join('; ') };
}
