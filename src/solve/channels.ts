/**
 * B3 SOLVER — `src/solve/channels.ts`
 *
 * doc 04 §11's per-channel timing, and the ANALYTIC derivatives that feed `chan.accelL`,
 * `chan.accelR` and `chan.pelvisYawRate`. ARCHITECTURE.md §3.3, §6.3, §4.11 S6.
 *
 * ═══ THIS FILE DEFINES NO EASING. IT LOOKS UP A tauP AND CALLS THE CONTRACT. ════════════════
 * OWNERSHIP B3: "`ease` — **the only easing source — this block may not define an easing
 * function**". Every function below is a two-liner for exactly that reason, and
 * `tools/verify-contracts.mjs` REQUIRES this file to name `kimeEaseAcc` and `holdThenSnapVel`
 * (the `REQUIRES` table). `tests/contracts/ease.test.ts` then asserts BIT identity —
 * `channelAlpha(ch, tau) === kimeEase(tau, CHANNEL_DYN[ch].tauP.v)` at 101 sample points per
 * channel, with `toBe`, not `toBeCloseTo`.
 *
 * That identity is the whole justification for putting the easing in a frozen contract file: the
 * critic measures what the compiler baked. Re-deriving `S(τ)` here — even correctly — would make
 * metric 50 `kime_decel_time_s` and metric 51 `accel_profile_skew` measure the difference between
 * two implementations of the same formula.
 *
 * ═══ WHY THE ACCEL CHANNELS ARE NOT DIFFERENCED ═════════════════════════════════════════════
 * Tangential angular acceleration is IDENTICALLY ZERO between slerped keys, so differentiating a
 * baked track twice yields an impulse train — one spike per key — instead of one crack per
 * technique. That is judge 1's fatal A2, it is why §1 change 3 exists, and it is grep-banned
 * (`FINITE_DIFF_NAMED`, `FINITE_DIFF_ACCEL`) across `src/solve`, `src/cloth` and `src/player`.
 */

import type { ChannelId } from '../contracts';
import {
  CHANNEL_LEAD_REF_TTECH_S,
  CHANNEL_ORDER,
  TAUP_MONOTONE_CHAIN,
  TAUP_SPAN_PROXIMAL_CHANNEL,
  holdThenSnap,
  holdThenSnapVel,
  kimeEase,
  kimeEaseAcc,
  kimeEaseVel,
} from '../contracts';
import { CHANNEL_DYN } from '../data';

/** The channel's own peak-velocity fraction, doc 04 §11. Throws on an unknown id. */
export function channelTauP(channelId: string): number {
  const row = CHANNEL_DYN[channelId as ChannelId];
  if (row === undefined) {
    throw new Error(`channelTauP: unknown channel '${channelId}' (have: ${CHANNEL_ORDER.join(', ')})`);
  }
  return row.tauP.v;
}

/** Normalised progress along one channel. `kimeEase` at that channel's `tauP`, nothing else. */
export function channelAlpha(channelId: string, tau: number): number {
  return kimeEase(tau, channelTauP(channelId));
}

/** Normalised speed along one channel. `kimeEaseVel` at that channel's `tauP`. */
export function channelVel(channelId: string, tau: number): number {
  return kimeEaseVel(tau, channelTauP(channelId));
}

/**
 * Normalised acceleration along one channel — `kimeEaseAcc`, the ONLY legal source of
 * `chan.accelL` / `chan.accelR` (§3.9, §6.3).
 */
export function channelAcc(channelId: string, tau: number): number {
  return kimeEaseAcc(tau, channelTauP(channelId));
}

/**
 * The channel's lead in SECONDS ahead of arrival, scaled to this move's own `T_tech`.
 *
 * doc 04 §11 quotes every `leadMs` against `T_tech = 0.340 s` (`CHANNEL_LEAD_REF_TTECH_S`), so a
 * move with a shorter technique must scale them or the proximal channels start before the move
 * does. Scaling — rather than clamping — is what keeps S6's strict lead ordering true at every
 * tempo tier: a uniform positive multiplier preserves order.
 */
export function channelLeadS(channelId: string, tTechS: number): number {
  const row = CHANNEL_DYN[channelId as ChannelId];
  if (row === undefined) throw new Error(`channelLeadS: unknown channel '${channelId}'`);
  return (row.leadMs.v / 1000) * (tTechS / CHANNEL_LEAD_REF_TTECH_S);
}

/**
 * Pelvis yaw progress, doc 01 §8.3 `koshi no kaiten`: hold to `τ = 0.55`, then `1 − (1 − u)³`.
 *
 * A linear pelvis yaw is doc 01 §9.5's fault X3 and has no code path in this project (§3.3).
 * S7 asserts `|ψ(0.5) − ψ_start| ≤ 8°`, which this satisfies exactly — it is 0.
 */
export function pelvisYawAlpha(tau: number): number {
  return holdThenSnap(tau);
}

/**
 * `chan.pelvisYawRate`, deg/s. ANALYTIC: `holdThenSnapVel` divided by the window duration, which
 * is a change of variable from τ to seconds, not a difference quotient.
 */
export function pelvisYawRateDegS(tau: number, dPsiDeg: number, windowS: number): number {
  if (windowS <= 0) return 0;
  return (holdThenSnapVel(tau) * dPsiDeg) / windowS;
}

/**
 * `chan.accelL` / `chan.accelR`, m/s². ANALYTIC: `kimeEaseAcc` scaled by path length over T².
 *
 * `S(τ)` is normalised to a unit path over a unit duration, so `d²x/dt² = S''(τ)·L/T²`. The
 * `pathLenM` is the technique's OWN end-effector path length (doc 04 §0's `L`, ~0.50 m for a
 * chudan zuki) — never `L_M = 0.945 m`, which is the embusen step unit. That is conflict C17, and
 * getting it wrong scales every recoil and every crack by 1.9×.
 */
export function endEffectorAccelMs2(
  tau: number,
  pathLenM: number,
  durationS: number,
  tauPeak: number,
): number {
  if (durationS <= 0) return 0;
  return (kimeEaseAcc(tau, tauPeak) * pathLenM) / (durationS * durationS);
}

/**
 * Peak end-effector SPEED, m/s — `v_pk` in doc 04 §10's units. Used by `impulses.ts` for the
 * `deltaVMs` a limb-stop removes.
 */
export function endEffectorSpeedMs(
  tau: number,
  pathLenM: number,
  durationS: number,
  tauPeak: number,
): number {
  if (durationS <= 0) return 0;
  return (kimeEaseVel(tau, tauPeak) * pathLenM) / durationS;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * S6's exit invariant, doc 04 §11. Three statements, NOT the one the doc's prose implies.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** The channels S6 checks lead ordering across — doc 04 §11's own eight-row table. */
export const LEAD_ORDER_CHAIN: readonly ChannelId[] = Object.freeze([
  'rearFootDrive', 'pelvisYaw', 'thoraxYaw', 'shoulderGirdle', 'elbowExtend', 'wristLock',
]);

export interface ChannelInvariantReport {
  readonly leadsDescending: boolean;
  readonly tauPMonotoneOnChain: boolean;
  readonly minTauPIsProximal: boolean;
  readonly detail: string;
}

/**
 * doc 04 §11's invariants, evaluated. See `CHANNEL_ORDER`'s doc block in `src/contracts/kata.ts`
 * for why part 2 is scoped to `TAUP_MONOTONE_CHAIN` and is NOT pointwise over `CHANNEL_ORDER`:
 * doc 04 §11's own table falls at four of its eight steps, so asserting the prose version would
 * throw on every move and `compileKata` would never return.
 */
export function checkChannelInvariants(): ChannelInvariantReport {
  const notes: string[] = [];

  let leadsDescending = true;
  for (let i = 1; i < LEAD_ORDER_CHAIN.length; i++) {
    const prev = CHANNEL_DYN[LEAD_ORDER_CHAIN[i - 1]!].leadMs.v;
    const cur = CHANNEL_DYN[LEAD_ORDER_CHAIN[i]!].leadMs.v;
    if (!(cur <= prev)) {
      leadsDescending = false;
      notes.push(`lead(${LEAD_ORDER_CHAIN[i]}) = ${cur} > lead(${LEAD_ORDER_CHAIN[i - 1]}) = ${prev}`);
    }
  }
  if (!(CHANNEL_DYN.wristLock.leadMs.v > 0)) {
    leadsDescending = false;
    notes.push('lead(wristLock) must be > 0');
  }

  let tauPMonotoneOnChain = true;
  for (let i = 1; i < TAUP_MONOTONE_CHAIN.length; i++) {
    const prev = CHANNEL_DYN[TAUP_MONOTONE_CHAIN[i - 1]!].tauP.v;
    const cur = CHANNEL_DYN[TAUP_MONOTONE_CHAIN[i]!].tauP.v;
    if (!(cur >= prev)) {
      tauPMonotoneOnChain = false;
      notes.push(`tauP(${TAUP_MONOTONE_CHAIN[i]}) = ${cur} < tauP(${TAUP_MONOTONE_CHAIN[i - 1]}) = ${prev}`);
    }
  }

  const taus = CHANNEL_ORDER.map((c) => CHANNEL_DYN[c].tauP.v);
  const minTauP = Math.min(...taus);
  const minTauPIsProximal = minTauP === CHANNEL_DYN[TAUP_SPAN_PROXIMAL_CHANNEL].tauP.v;
  if (!minTauPIsProximal) {
    notes.push(`min(tauP) = ${minTauP} is not ${TAUP_SPAN_PROXIMAL_CHANNEL}`);
  }

  return {
    leadsDescending,
    tauPMonotoneOnChain,
    minTauPIsProximal,
    detail: notes.join('; '),
  };
}
