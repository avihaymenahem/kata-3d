/**
 * tests/contracts/tickrate.test.ts — G-9c: every declared timing quantity below 20 ms survives
 * quantisation, and the sub-20 ms facts are carried as EXACT integer tick counts.
 *
 * RED-FIRST (ARCHITECTURE.md §4.0, §8 Phase 0).
 *
 * The four facts §2.4 names, and why a frame grid loses each of them:
 *   17 ms  hikite lead over the punching shoulder   doc 04 §2.3 [MEAS]
 *   10-20 ms  limb-stop -> visible gi crack        doc 04 §9.1  — SMALLER than one 60 fps frame
 *   25-35 ms  pelvis-sink time constant T_s        doc 04 §7.4
 *   0.13 s  T_thrust at kata demo tempo            doc 04 §2 / §10 — 8 frames at 60 fps
 *
 * At TICK_HZ = 3840 one tick is 0.2604 ms and the worst quantisation error is 0.1302 ms — three
 * orders below the tightest tolerance in doc 04 (the +-5 ms crack delay). On the 480 Hz `chan`
 * grid (2.083 ms) an envelope is fine; an EVENT is not, which is why `ImpulseEvent.crackDelayTicks`
 * is an integer tick count and never a value interpolated off a frame grid.
 */

import { describe, expect, it } from 'vitest';
import {
  CHAN_TICKS_PER_FRAME,
  CHAN_RATE_HZ,
  CRACK_DELAY_TICKS_MAX,
  CRACK_DELAY_TICKS_MIN,
  EVENT_EXACT_BELOW_MS,
  landsOnExactTick,
  msToTick,
  quantisationErrorMs,
  QUANT_TOL_MS,
  secToTick,
  survivesQuantisation,
  TAUP_MONOTONE_CHAIN,
  TICK_HZ,
  TICK_MS,
  TICK_QUANT_MS,
  tickToMs,
  tickToSec,
} from '../../src/contracts';

async function need(modulePath: string, ...symbols: readonly string[]): Promise<Record<string, unknown>> {
  const spec: string = modulePath;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (e) {
    const msg = String((e as Error).message);
    const absent = /Cannot find module|Failed to (?:load|resolve)/.test(msg);
    throw new Error(
      absent
        ? `RED-FIRST: module '${modulePath}' does not exist yet (need: ${symbols.join(', ')}). ` +
          `(${msg.split('\n')[0]})`
        : `LOAD ERROR in '${modulePath}': ${msg}`,
      { cause: e },
    );
  }
  const missing = symbols.filter((s) => !(s in mod));
  if (missing.length) {
    throw new Error(
      `RED-FIRST: missing symbol '${missing[0]}' in module '${modulePath}' ` +
        `(needed: ${symbols.join(', ')})`,
    );
  }
  return mod;
}

const FRAME_MS_60 = 1000 / 60;

describe('§2.4 — the tick clock (green from Phase 0)', () => {
  it('TICK_HZ = 3840 = 2^8 * 15 and one tick is 0.2604 ms', () => {
    expect(TICK_HZ).toBe(3840);
    expect(2 ** 8 * 15).toBe(TICK_HZ);
    // 1000/3840 is not a dyadic rational, so TICK_MS itself is inexact — which is exactly why the
    // tick, not the millisecond, is the transport unit. The TICK count is always an integer.
    expect(TICK_MS * TICK_HZ).toBeCloseTo(1000, 9);
    expect(TICK_MS).toBeCloseTo(0.260417, 6);
    expect(Number.isInteger(msToTick(17))).toBe(true);
    expect(TICK_QUANT_MS).toBe(TICK_MS / 2);
  });

  it('the 480 Hz chan grid is an exact integer number of ticks', () => {
    expect(TICK_HZ / CHAN_RATE_HZ).toBe(CHAN_TICKS_PER_FRAME);
    expect(CHAN_TICKS_PER_FRAME).toBe(8);
  });

  /**
   * The bound MUST be clock-independent. `|round(y) - y| <= 0.5` holds for every finite input, so
   * a predicate bounded by half a tick of its OWN clock is a tautology at any tick rate — it would
   * pass the very 60 fps grid §2.4 exists to reject. `QUANT_TOL_MS = 0.2` is the falsifiable form:
   * satisfied at 3840 Hz (worst case 0.130 ms) and violated by any clock coarser than 2500 Hz.
   */
  it('QUANT_TOL_MS is clock-independent, so survivesQuantisation is falsifiable', () => {
    expect(QUANT_TOL_MS).toBe(0.2);
    expect(TICK_QUANT_MS, 'this clock is inside the bound with room to spare').toBeLessThan(QUANT_TOL_MS);
    // NEGATIVE CONTROL: the same predicate on a 60 fps grid. If this ever passes, the bound has
    // been re-derived from the tick rate and every assertion below is vacuous again.
    const err60 = (ms: number) => Math.abs(Math.round(ms / FRAME_MS_60) * FRAME_MS_60 - ms);
    expect(err60(17), 'a 17 ms lead on a 60 fps grid').toBeGreaterThan(QUANT_TOL_MS);
    expect(err60(10), 'a 10 ms crack delay on a 60 fps grid').toBeGreaterThan(QUANT_TOL_MS);
    expect(err60(30), 'a 30 ms pelvis sink on a 60 fps grid').toBeGreaterThan(QUANT_TOL_MS);
  });

  it('the 17 ms hikite lead survives quantisation; a 60 fps grid destroys it', () => {
    expect(survivesQuantisation(17)).toBe(true);
    expect(Number.isInteger(msToTick(17))).toBe(true);
    expect(quantisationErrorMs(17), '17 ms costs 0.073 ms as 65 ticks').toBeLessThanOrEqual(QUANT_TOL_MS);
    expect(quantisationErrorMs(17)).toBeCloseTo(Math.abs(tickToMs(65) - 17), 12);
    // 17 ms is NOT an exact tick (17 * 3.84 = 65.28); it is merely well within tolerance. Stating
    // that plainly stops G-9c being implemented as `landsOnExactTick` on every quantity.
    expect(landsOnExactTick(17)).toBe(false);
    // A 60 fps frame is 16.67 ms: the whole 17 ms lead is ONE display frame, so any quantity
    // carried on that grid can only be 0 or 1 frames — the lead is either deleted or doubled.
    expect(Math.round(17 / FRAME_MS_60)).toBe(1);
    expect(
      Math.abs(Math.round(17 / FRAME_MS_60) * FRAME_MS_60 - 17),
    ).toBeGreaterThan(QUANT_TOL_MS);
  });

  it('the 10-20 ms crack delay maps onto exactly [38, 77] ticks', () => {
    expect(msToTick(10)).toBe(CRACK_DELAY_TICKS_MIN);
    expect(msToTick(20)).toBe(CRACK_DELAY_TICKS_MAX);
    expect(CRACK_DELAY_TICKS_MIN).toBe(38);
    expect(CRACK_DELAY_TICKS_MAX).toBe(77);
    for (let ms = 10; ms <= 20; ms += 0.25) expect(survivesQuantisation(ms)).toBe(true);
    // The whole 10-20 ms window is under ONE 60 fps frame, which is the reason it needs ticks.
    expect(20).toBeLessThan(FRAME_MS_60 * 1.25);
    expect(EVENT_EXACT_BELOW_MS).toBe(20);
  });

  it('the 25-35 ms pelvis-sink time constant survives quantisation (25 ms is exact)', () => {
    expect(msToTick(25)).toBe(96);
    expect(tickToMs(96)).toBe(25);
    // 25 ms is the one quantity of §2.4 that lands on an EXACT tick: 25 * 3840 / 1000 = 96.
    expect(landsOnExactTick(25)).toBe(true);
    expect(quantisationErrorMs(25)).toBe(0);
    for (let ms = 25; ms <= 35; ms += 0.25) expect(survivesQuantisation(ms)).toBe(true);
    // Doc 04 §7.4 also gives "sink 90 % complete 60-80 ms after contact" and "sink completes at or
    // <= 40 ms BEFORE the lock, never after" — a 2.083 ms chan grid resolves those; a 16.67 ms one
    // has three samples across the whole 40 ms budget.
    expect(40 / (1000 / CHAN_RATE_HZ)).toBeGreaterThanOrEqual(19);
  });

  it('T_thrust = 0.13 s survives quantisation', () => {
    expect(secToTick(0.13)).toBe(499);
    expect(Math.abs(tickToSec(499) - 0.13) * 1000).toBeLessThanOrEqual(TICK_QUANT_MS);
    expect(survivesQuantisation(130)).toBe(true);
  });
});

describe('G-9c — the compiled track carries them as exact ticks', () => {
  it('doc 04 §11 channel leads keep the 17 ms hikite lead as an integer tick count', async () => {
    const data = await need('../../src/data', 'CHANNEL_DYN');
    const ch = data.CHANNEL_DYN as Record<string, { leadMs: { v: number }; tauP: { v: number } }>;

    // doc 04 §2.3: "hikite onset -205 ms ... leads punching shoulder by 17 ms [MEAS]"; the §11
    // ship table rounds the pair to -205 / -186, i.e. 19 ms. Both readings are inside the +-20 ms
    // tolerance the same table gives, so the assertion is on the FACT (a positive lead of ~17 ms),
    // not on the rounding.
    const lead = ch.hikite!.leadMs.v - ch.shoulderGirdle!.leadMs.v;
    expect(lead, 'hikite must LEAD the punching shoulder').toBeGreaterThan(0);
    expect(lead).toBeGreaterThanOrEqual(14);
    expect(lead).toBeLessThanOrEqual(20);
    expect(survivesQuantisation(lead)).toBe(true);
    expect(msToTick(lead)).toBeGreaterThan(0);

    // §4.11 S6, part 1 — doc 04 §11 invariant 1: leads strictly decrease proximal -> distal.
    const order = ['rearFootDrive', 'pelvisYaw', 'thoraxYaw', 'shoulderGirdle', 'elbowExtend', 'wristLock'];
    for (let i = 1; i < order.length; i++) {
      const prev = ch[order[i - 1]!]!.leadMs.v;
      const cur = ch[order[i]!]!.leadMs.v;
      expect(cur, `lead(${order[i]}) must be <= lead(${order[i - 1]})`).toBeLessThanOrEqual(prev);
    }
    expect(ch.wristLock!.leadMs.v).toBeGreaterThan(0);

    // §4.11 S6, part 2 — tauP monotonicity, scoped to TAUP_MONOTONE_CHAIN and NOT to the whole of
    // CHANNEL_ORDER. Along CHANNEL_ORDER doc 04 §11's own table falls at four of eight steps
    // (0.45->0.42, 0.70->0.55, 0.65->0.60, 0.60->0.50), because elbowExtend/wristLock are measured
    // inside Tthrust (a different time base) and comTranslate/hikite are off the striking chain.
    // ONE order, imported from the contracts, so this test and S6 cannot ship two of them.
    for (let i = 1; i < TAUP_MONOTONE_CHAIN.length; i++) {
      const prev = ch[TAUP_MONOTONE_CHAIN[i - 1]!]!.tauP.v;
      const cur = ch[TAUP_MONOTONE_CHAIN[i]!]!.tauP.v;
      expect(
        cur,
        `tauP(${TAUP_MONOTONE_CHAIN[i]}) must be >= tauP(${TAUP_MONOTONE_CHAIN[i - 1]})`,
      ).toBeGreaterThanOrEqual(prev);
    }
    // §4.11 S6, part 3 — invariant 2's span starts at the most proximal channel.
    const minTauP = Math.min(...Object.values(ch).map((c) => c.tauP.v));
    expect(minTauP, 'min(tauP) is rearFootDrive').toBe(ch.rearFootDrive!.tauP.v);
    expect(ch.rearFootDrive!.tauP.v, 'doc 04 §11: 0.30').toBeCloseTo(0.3, 6);
  });

  it('every ImpulseEvent under 20 ms is an exact tick and every crack delay is in [38, 77]', async () => {
    const data = await need('../../src/data', 'getKata');
    const solve = await need('../../src/solve', 'compileKata');

    interface Ev {
      readonly tick: number;
      readonly kind: string;
      readonly crackDelayTicks: number;
      readonly moveN: number;
    }
    interface Track {
      readonly impulses: readonly Ev[];
      readonly marks: readonly { kind: string; tick: number }[];
      readonly bakeStats: { readonly eventsBelow20msExact: boolean };
      readonly durationTicks: number;
    }

    for (const id of ['taikyoku-shodan', 'heian-shodan']) {
      const k = (data.getKata as (i: string) => unknown)(id);
      const track = (solve.compileKata as (kk: unknown, o: unknown) => Track)(k, {
        tempoTier: 'T1',
        codeVersion: 'test',
      });

      expect(track.bakeStats.eventsBelow20msExact, `${id}: G-9c`).toBe(true);
      expect(track.impulses.length, `${id} must emit impulses`).toBeGreaterThan(0);

      for (const e of track.impulses) {
        expect(Number.isInteger(e.tick), `${id} move ${e.moveN}: event tick must be an integer`).toBe(true);
        expect(Number.isInteger(e.crackDelayTicks)).toBe(true);
        expect(e.crackDelayTicks).toBeGreaterThanOrEqual(CRACK_DELAY_TICKS_MIN);
        expect(e.crackDelayTicks).toBeLessThanOrEqual(CRACK_DELAY_TICKS_MAX);
        expect(e.tick + e.crackDelayTicks).toBeLessThanOrEqual(track.durationTicks);
      }
      for (const m of track.marks) expect(Number.isInteger(m.tick)).toBe(true);
    }
  });

  it('T_thrust in the dynamics table is 0.13 s and lands on an exact tick', async () => {
    const data = await need('../../src/data', 'DYN');
    const dyn = data.DYN as Record<string, { TthrustS: { v: number }; TtechS: { v: number } }>;
    const rows = Object.values(dyn);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(survivesQuantisation(r.TthrustS.v * 1000)).toBe(true);
      expect(survivesQuantisation(r.TtechS.v * 1000)).toBe(true);
      expect(r.TthrustS.v, 'doc 04 §10: T_thrust is 0.13 s for the punch rows').toBeLessThan(r.TtechS.v);
    }
    /* §2.4's fourth fact is "T_thrust = 0.13 s". It belongs to doc 04 §10's gyaku-zuki
     * chudan/jodan rows — NOT to whichever *zuki* row happens to come first. doc 04 §10 lists
     * choku-zuki FIRST, at 0.10, so `Object.entries(dyn).find(...)` selected the wrong row and
     * pinned a frozen test to object insertion order: B1 transcribing the table faithfully would
     * fail, and the visible repairs were to reorder DYN or to corrupt choku-zuki's MEASURED 0.10.
     * Assert the FACT, over the whole set, order-independently. */
    const zuki = Object.entries(dyn).filter(([key]) => key.includes('zuki'));
    expect(zuki.length, 'DYN must have *-zuki rows').toBeGreaterThan(0);
    expect(
      zuki.some(([, r]) => Math.abs(r.TthrustS.v - 0.13) < 1e-9),
      `doc 04 §10: some *-zuki row must carry T_thrust = 0.13 s (gyaku-zuki chudan/jodan). ` +
        `saw: ${zuki.map(([k, r]) => `${k}=${r.TthrustS.v}`).join(', ')}`,
    ).toBe(true);
    // doc 04 §10's zuki rows span 0.09 (kizami) to 0.14 (oi-zuki chudan step), ±12 % tolerance.
    for (const [key, r] of zuki) {
      expect(r.TthrustS.v, `${key}: doc 04 §10 T_thrust range for zuki rows`).toBeGreaterThanOrEqual(0.09);
      expect(r.TthrustS.v, `${key}`).toBeLessThanOrEqual(0.19);
    }
  });
});
