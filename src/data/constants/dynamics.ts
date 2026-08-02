/**
 * B1 NUMBERS — `src/data/constants/dynamics.ts`
 *
 * `DYN`, `CHANNEL_DYN`, `SETTLE`, `TEMPO_CLASSES`, `PAUSE_CLASSES`, `TEMPO_SCALE`
 * (ARCHITECTURE.md §3.13, §4.1). Sources: doc 04 §5 (kime + settle), §6 (tempo), §10 (the
 * consolidated per-technique table), §11 (the channel contract), doc 02 §1.4 (tempo classes).
 *
 * ── `TEMPO_SCALE` IS RE-EXPORTED, NEVER REDECLARED ────────────────────────────────────────
 * §3.2 puts the T0…T3 table in `src/contracts/time.ts` and §4.1 also lists `TEMPO_SCALE` under
 * this file. Two definitions would resolve differently depending on which barrel an importer
 * pulled, and because `tempoScale` multiplies only `T_prep` and `T_hold` the divergence is
 * INVISIBLE at T1 — the default — surfacing first at G-11 in Phase 5. So this file re-exports the
 * frozen one. `tools/verify-contracts.mjs` bans a second `export const TEMPO_SCALE` project-wide.
 *
 * ── `channels` IS THE 0.340 s REFERENCE TABLE, NOT THE ROW'S OWN OFFSETS ──────────────────
 * §3.8: "lead is ms BEFORE arrival, at Ttech = 0.340 s; scaled by Ttech/0.340". Every `DYN` row
 * therefore carries the SAME `channels` object — doc 04 §11's table — and B3 scales it by that
 * row's `TtechS / 0.340`. doc 04 §10's own per-row `hip->arr` / `sh->arr` / `elb->arr` columns are
 * the ALREADY-SCALED arrival offsets; they ship separately as `DYN_ARRIVAL_OFFSETS` so nothing
 * double-scales. Cross-check: gyaku-zuki chudan has `Ttech = 0.34`, and its 245 / 186 / 88 are
 * exactly the §11 leads ✔; gedan-barai-step scales 245 x (0.50/0.34) = 360.3 against §10's 360 ✔.
 * The turn rows are the loosest fit (shoulder 361 scaled vs §10's 300, ~20 %), which is why the
 * authored column ships too.
 *
 * ── `ampFracL` AND `recoilFracL` ARE FRACTIONS OF THE END-EFFECTOR PATH (C17) ─────────────
 * doc 04 §0's `L` is "path length travelled by the END EFFECTOR inside T_tech" (~0.50 m for a
 * chudan zuki; §5.1's own `0.012–0.020 L = 6–10 mm` pins the scale). It is NOT the embusen step
 * unit `L_M = 0.945 m`. Scaling by `L_M` makes the gyaku-zuki recoil 15.1 mm instead of 8.0 mm and
 * turns doc 04's hard ceiling into 18.9 mm — and there is no recoil metric in the 63, so nothing
 * downstream would catch it. Where a `SETTLE` row's amplitude is an ANGLE or a HEIGHT rather than
 * a path fraction, the `Num.unit` says so (`'deg'` / `'H'`, §2.2 case b).
 */

import type { ChannelDyn, ChannelId, Num, PauseClass, TechniqueDynamics, TempoClass, KataId } from '../../contracts';
import { CHANNEL_LEAD_REF_TTECH_S } from '../../contracts';
import { A, N } from '../num';

/** §3.2's frozen T0…T3 table, re-exported. See the header: this must not be redeclared. */
export { TEMPO_SCALE } from '../../contracts';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * CHANNEL_DYN — doc 04 §11's `CHANNELS` object, verbatim. `leadMs` is quoted at
 * `T_tech = 0.340 s` (`CHANNEL_LEAD_REF_TTECH_S`).
 *
 * Invariant 1 (asserted by stage S6 and by `tests/contracts/tickrate.test.ts`): leads strictly
 * descend proximal -> distal, 280 > 245 > 187 > 186 > 88 > 80 > 0.
 * Invariant 2 is a SPAN, not a pointwise order: along the full `CHANNEL_ORDER` doc 04 §11's own
 * `tauP` column falls at four of eight steps, because `elbowExtend`/`wristLock` are measured
 * inside `T_thrust` (a shorter time base) and `comTranslate`/`hikite` are off the striking chain.
 * `TAUP_MONOTONE_CHAIN` in `src/contracts/kata.ts` is the subset over which it does hold.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const CHANNEL_DYN: Readonly<Record<ChannelId, ChannelDyn>> = Object.freeze({
  rearFootDrive: {
    tauP: N(0.3, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'DERIVED'),
    leadMs: N(280, 'ms', 30, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  comTranslate: {
    tauP: N(0.45, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'DERIVED'),
    leadMs: N(260, 'ms', 30, 'docs/research/04-dynamics-timing.md §11', 'DERIVED'),
  },
  pelvisYaw: {
    tauP: N(0.42, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
    leadMs: N(245, 'ms', 25, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  /** doc 04 §2.3 [MEAS]: the hikite "leads punching shoulder by 17 ms"; §11 rounds the pair to 19. */
  hikite: {
    tauP: N(0.7, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'DERIVED'),
    leadMs: N(205, 'ms', 20, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  thoraxYaw: {
    tauP: N(0.55, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'DERIVED'),
    leadMs: N(187, 'ms', 20, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  shoulderGirdle: {
    tauP: N(0.65, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
    leadMs: N(186, 'ms', 20, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  /** doc 04 §11's own comment: this `tauP` is measured INSIDE `T_thrust`, a different time base. */
  elbowExtend: {
    tauP: N(0.6, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
    leadMs: N(88, 'ms', 15, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  wristLock: {
    tauP: N(0.5, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
    leadMs: N(80, 'ms', 10, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
  },
  /**
   * `forearmRoll` has NO ROW in doc 04 §11 — it is authored from doc 03 §4.3's roll curve,
   * `roll(t) = 180 * clamp((t-0.65)/0.35, 0, 1)^2.2`. That curve's speed rises monotonically to
   * `t = 1`, which `kimeEase` cannot represent exactly (it dead-stops at both ends), so `tauP` is
   * set to doc 03 §4.3's own "50 % of roll complete at 93 % of path" — the closest single-parameter
   * stand-in. `leadMs` is the 35 % of the stroke the roll occupies: `0.35 x 340 = 119 ms`.
   */
  forearmRoll: {
    tauP: N(0.93, 'ratio', 0.04, 'docs/research/03-techniques-upper.md §4.3', 'DERIVED'),
    leadMs: N(119, 'ms', 18, 'docs/research/03-techniques-upper.md §4.3', 'DERIVED'),
  },
});

/** doc 04 §2.3's headline lags, the ones a critic reads directly off the figure. */
export const CHAIN_LAGS = Object.freeze({
  /** THE koshi-no-kaiten signature: hip onset -> shoulder onset. */
  hipToShoulderMs: N(58, 'ms', 15, 'docs/research/04-dynamics-timing.md §2.3', 'MEASURED'),
  hipToArrivalMs: N(245, 'ms', 25, 'docs/research/04-dynamics-timing.md §2.3', 'MEASURED'),
  shoulderToArrivalMs: N(186, 'ms', 20, 'docs/research/04-dynamics-timing.md §2.3', 'MEASURED'),
  chainSpreadMs: N(198, 'ms', 30, 'docs/research/04-dynamics-timing.md §2.3', 'MEASURED'),
  /** doc 04 §2.1: X-factor cap. Stage S8 asserts <= 15° at every tick; §3.9 gates 15 + 2. */
  xFactorMaxDeg: N(15, 'deg', 4, 'docs/research/04-dynamics-timing.md §2.1', 'DERIVED'),
  /** doc 04 §2.3: the electromechanical delay added to every sEMG onset. */
  emdMs: N(30, 'ms', 15, 'docs/research/04-dynamics-timing.md §2.3', 'MEASURED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * DYN — doc 04 §10, one row per technique class. Tolerances are §10's own footer:
 * `T_*` ±12 %, `|dpsi|` ±6°, `omega_psi` ±20 %, `tauP` ±0.05, `v_pk` ±20 %, `T_kime` ±25 %,
 * recoil ±30 %.
 *
 * `T_kime` is quoted in MILLISECONDS by doc 04 §10 and carried in SECONDS by the frozen field name
 * `TkimeS`; the value below is the doc's ms figure / 1000. Flagged for `verify-constants.mjs`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D04_10 = 'docs/research/04-dynamics-timing.md §10';

interface DynRow {
  readonly key: string;
  readonly ttech: number;
  readonly tthrust: number;
  readonly dpsi: number;
  readonly omega: number;
  readonly taup: number;
  readonly vpk: number;
  readonly tkimeMs: number;
  readonly recoil: number;
  readonly hip: number;
  readonly sh: number;
  readonly elb: number;
  readonly conf: 'MEASURED' | 'DERIVED';
}

/** doc 04 §10's table, transcribed row for row. Order is the doc's; it is NOT load-bearing. */
const DYN_ROWS: readonly DynRow[] = [
  { key: 'choku-zuki', ttech: 0.28, tthrust: 0.1, dpsi: 6, omega: 90, taup: 0.7, vpk: 4.4, tkimeMs: 140, recoil: 0.014, hip: 150, sh: 130, elb: 75, conf: 'MEASURED' },
  { key: 'gyaku-zuki-chudan', ttech: 0.34, tthrust: 0.13, dpsi: 45, omega: 380, taup: 0.73, vpk: 5.1, tkimeMs: 160, recoil: 0.016, hip: 245, sh: 186, elb: 88, conf: 'MEASURED' },
  { key: 'gyaku-zuki-jodan', ttech: 0.34, tthrust: 0.13, dpsi: 45, omega: 380, taup: 0.73, vpk: 5.1, tkimeMs: 160, recoil: 0.016, hip: 245, sh: 186, elb: 88, conf: 'MEASURED' },
  { key: 'kizami-zuki', ttech: 0.24, tthrust: 0.09, dpsi: 45, omega: 350, taup: 0.7, vpk: 4.2, tkimeMs: 130, recoil: 0.014, hip: 170, sh: 130, elb: 70, conf: 'DERIVED' },
  { key: 'oi-zuki-chudan-step', ttech: 0.52, tthrust: 0.14, dpsi: 45, omega: 330, taup: 0.78, vpk: 6.5, tkimeMs: 170, recoil: 0.014, hip: 380, sh: 250, elb: 100, conf: 'DERIVED' },
  { key: 'gedan-barai-step', ttech: 0.5, tthrust: 0.14, dpsi: 65, omega: 400, taup: 0.74, vpk: 4.4, tkimeMs: 170, recoil: 0.018, hip: 360, sh: 240, elb: 105, conf: 'DERIVED' },
  { key: 'age-uke-step', ttech: 0.46, tthrust: 0.13, dpsi: 60, omega: 380, taup: 0.72, vpk: 4.2, tkimeMs: 160, recoil: 0.018, hip: 330, sh: 225, elb: 100, conf: 'DERIVED' },
  { key: 'soto-uke-step', ttech: 0.46, tthrust: 0.13, dpsi: 70, omega: 415, taup: 0.72, vpk: 4.2, tkimeMs: 160, recoil: 0.018, hip: 330, sh: 225, elb: 100, conf: 'DERIVED' },
  { key: 'uchi-uke-step', ttech: 0.46, tthrust: 0.13, dpsi: 65, omega: 400, taup: 0.72, vpk: 4.2, tkimeMs: 160, recoil: 0.018, hip: 330, sh: 225, elb: 100, conf: 'DERIVED' },
  { key: 'shuto-uke-kokutsu-step', ttech: 0.52, tthrust: 0.14, dpsi: 55, omega: 360, taup: 0.74, vpk: 4, tkimeMs: 175, recoil: 0.018, hip: 375, sh: 250, elb: 105, conf: 'DERIVED' },
  { key: 'tettsui-otoshi', ttech: 0.32, tthrust: 0.11, dpsi: 30, omega: 300, taup: 0.72, vpk: 4.6, tkimeMs: 150, recoil: 0.02, hip: 220, sh: 170, elb: 85, conf: 'DERIVED' },
  { key: 'empi-uchi', ttech: 0.28, tthrust: 0.09, dpsi: 50, omega: 400, taup: 0.68, vpk: 3.6, tkimeMs: 150, recoil: 0.016, hip: 200, sh: 150, elb: 70, conf: 'DERIVED' },
  { key: 'turn-90-technique', ttech: 0.66, tthrust: 0.14, dpsi: 90, omega: 300, taup: 0.78, vpk: 4.4, tkimeMs: 175, recoil: 0.016, hip: 480, sh: 300, elb: 105, conf: 'DERIVED' },
  { key: 'turn-180-technique', ttech: 0.78, tthrust: 0.14, dpsi: 180, omega: 330, taup: 0.8, vpk: 4.4, tkimeMs: 180, recoil: 0.016, hip: 580, sh: 330, elb: 105, conf: 'DERIVED' },
  /**
   * doc 04 §10's last row. `T_thrust`, the three arrival offsets and `T_kime` are printed as "—":
   * a ceremony transition has no terminal thrust and no lock. Zero is the faithful reading, and it
   * keeps `TthrustS < TtechS` true for every row (asserted by `tests/contracts/tickrate.test.ts`).
   */
  { key: 'yoi-kamae-transition', ttech: 0.9, tthrust: 0, dpsi: 45, omega: 90, taup: 0.5, vpk: 0.8, tkimeMs: 0, recoil: 0.004, hip: 0, sh: 0, elb: 0, conf: 'DERIVED' },
];

const dynRow = (r: DynRow): TechniqueDynamics => ({
  key: r.key,
  TtechS: N(r.ttech, 's', r.ttech * 0.12, D04_10, r.conf),
  TthrustS: N(r.tthrust, 's', r.tthrust * 0.12, D04_10, r.conf),
  TkimeS: N(r.tkimeMs / 1000, 's', (r.tkimeMs / 1000) * 0.25, D04_10, 'DERIVED'),
  dPsiDeg: N(r.dpsi, 'deg', 6, D04_10, r.conf),
  omegaPsiDegS: N(r.omega, 'deg/s', r.omega * 0.2, D04_10, r.conf),
  tauP: N(r.taup, 'ratio', 0.05, D04_10, r.conf),
  /** doc 04 §10 `v_pk`, a SPEED. The `Ms` in the frozen field name is NOT milliseconds (C17). */
  vPkMs: N(r.vpk, 'm/s', r.vpk * 0.2, D04_10, r.conf),
  /** Fraction of the END-EFFECTOR path length, never of `L_M` (C17). */
  recoilFracL: N(r.recoil, 'ratio', r.recoil * 0.3, D04_10, r.conf),
  channels: CHANNEL_DYN,
});

export const DYN: Readonly<Record<string, TechniqueDynamics>> = Object.freeze(
  DYN_ROWS.reduce<Record<string, TechniqueDynamics>>((acc, r) => {
    acc[r.key] = dynRow(r);
    return acc;
  }, {}),
);

/**
 * doc 04 §10's own per-row arrival offsets, in ms before arrival, AT THAT ROW'S `T_tech`.
 * `TechniqueDynamics.channels` cannot carry these (§3.8 fixes its `leadMs` at the 0.340 s
 * reference), so they ship alongside. Metric 54 `hip_lead_lag_s` reads `hipMs`.
 */
export const DYN_ARRIVAL_OFFSETS: Readonly<
  Record<string, { readonly hipMs: Num; readonly shoulderMs: Num; readonly elbowMs: Num }>
> = Object.freeze(
  DYN_ROWS.reduce<Record<string, { hipMs: Num; shoulderMs: Num; elbowMs: Num }>>((acc, r) => {
    acc[r.key] = {
      hipMs: N(r.hip, 'ms', r.hip * 0.15, D04_10, r.conf),
      shoulderMs: N(r.sh, 'ms', r.sh * 0.15, D04_10, r.conf),
      elbowMs: N(r.elb, 'ms', r.elb * 0.15, D04_10, r.conf),
    };
    return acc;
  }, {}),
);

/** doc 04 §1's ship values, for a technique class with no §10 row of its own. */
export const TECH_WINDOW_DEFAULTS = Object.freeze({
  stationaryHandS: N(0.34, 's', 0.04, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  steppingHandS: N(0.5, 's', 0.06, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  kickS: N(0.55, 's', 0.07, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  turnPlusTechniqueS: N(0.7, 's', 0.08, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  thrustS: N(0.13, 's', 0.02, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  prepS: N(0.4, 's', 0.12, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  /** The load-bearing bridge from the kumite literature to kata (doc 04 §12.13: unmeasured). */
  kataScaleVsKumite: N(1.25, 'ratio', 0.1, 'docs/research/04-dynamics-timing.md §1', 'DERIVED'),
  /** `CHANNEL_DYN.leadMs` is quoted against this `T_tech`; B3 scales by `TtechS / this`. */
  channelLeadRefS: N(CHANNEL_LEAD_REF_TTECH_S, 's', 0, 'docs/research/04-dynamics-timing.md §11', 'MEASURED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * SETTLE — doc 04 §5.1's second-order settle, one row per channel.
 * `x(t) = A * e^(-zeta*omega_n*t) * sin(omega_n*sqrt(1-zeta^2)*t)`, first overshoot
 * `M_p = e^(-pi*zeta/sqrt(1-zeta^2))`. Every `A` and `omega_n` in §5.1 is a RANGE, so each ships
 * the arithmetic midpoint with a `tol` covering the range (`num.ts` rule R3).
 *
 * `ampFracL`'s UNIT is per row (§2.2 case b): `'ratio'` where §5.1 quotes a fraction of the
 * end-effector path `L` (C17), `'deg'` where it quotes an angular overshoot, `'H'` where it quotes
 * a vertical one. The frozen field NAME cannot say that; the `Num` does.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D04_51 = 'docs/research/04-dynamics-timing.md §5.1';

/**
 * Hard ceiling on the settle damping ratio. B8 clamps its live slider to `[0.05, 0.65]`; nothing
 * in this block may author at or above it. The `zeta >= 1` branch of `settle2` is a numerical
 * guard, not a modelled regime.
 */
export const SETTLE_ZETA_MAX = 0.65 as const;

export const SETTLE: Readonly<
  Record<
    'fist' | 'elbow' | 'pelvis' | 'thorax' | 'head' | 'comY' | 'kneeF' | 'obi',
    { readonly omegaN: Num; readonly zeta: Num; readonly ampFracL: Num }
  >
> = Object.freeze({
  /** §5.1 row 1: 0.012–0.020 `L` = 6–10 mm. NEVER exceed 0.020 — reads as a punch being pulled. */
  fist: {
    omegaN: N(54, 'rad/s', 9, D04_51, 'DERIVED'),
    zeta: N(0.4, 'ratio', 0.06, D04_51, 'MEASURED'),
    ampFracL: N(0.016, 'ratio', 0.004, D04_51, 'DERIVED'),
  },
  /** §5.1 row 2: forearm/elbow ANGLE overshoot, 1.5–3.0 deg. */
  elbow: {
    omegaN: N(47.5, 'rad/s', 7.5, D04_51, 'DERIVED'),
    zeta: N(0.45, 'ratio', 0.08, D04_51, 'MEASURED'),
    ampFracL: N(2.25, 'deg', 0.75, D04_51, 'DERIVED'),
  },
  /** §5.1 row 3: pelvis yaw overshoot, 1.5–3.0 deg. */
  pelvis: {
    omegaN: N(36, 'rad/s', 6, D04_51, 'DERIVED'),
    zeta: N(0.35, 'ratio', 0.07, D04_51, 'MEASURED'),
    ampFracL: N(2.25, 'deg', 0.75, D04_51, 'DERIVED'),
  },
  /** §5.1 row 4: thorax yaw overshoot, 2.0–4.0 deg. The only row with 1–2 visible bounces. */
  thorax: {
    omegaN: N(31, 'rad/s', 5, D04_51, 'DERIVED'),
    zeta: N(0.3, 'ratio', 0.07, D04_51, 'MEASURED'),
    ampFracL: N(3, 'deg', 1, D04_51, 'DERIVED'),
  },
  /** §5.1 row 7: head yaw, gaze already locked, 0.5–1.2 deg. */
  head: {
    omegaN: N(42.5, 'rad/s', 7.5, D04_51, 'DERIVED'),
    zeta: N(0.55, 'ratio', 0.1, D04_51, 'MEASURED'),
    ampFracL: N(0.85, 'deg', 0.35, D04_51, 'DERIVED'),
  },
  /** §5.1 row 6: COM / head VERTICAL, 0.002–0.004 `H` = 3.5–7 mm. Unit is `H`, not a path ratio. */
  comY: {
    omegaN: N(27, 'rad/s', 5, D04_51, 'DERIVED'),
    zeta: N(0.45, 'ratio', 0.1, D04_51, 'MEASURED'),
    ampFracL: N(0.003, 'H', 0.001, D04_51, 'DERIVED'),
  },
  /** doc 04 §7.4's landing sink, not §5.1: `omega_n = 28`, `zeta = 0.45`, knee +4…+8 deg. */
  kneeF: {
    omegaN: N(28, 'rad/s', 4, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
    zeta: N(0.45, 'ratio', 0.08, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
    ampFracL: N(6, 'deg', 2, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  },
  /** doc 04 §9.2's obi free ends: the slowest element in the figure, and the cheapest realism cue. */
  obi: {
    omegaN: N(6.35, 'rad/s', 0.95, 'docs/research/04-dynamics-timing.md §9.2', 'DERIVED'),
    zeta: N(0.18, 'ratio', 0.06, 'docs/research/04-dynamics-timing.md §9.2', 'DERIVED'),
    ampFracL: N(0.075, 'H', 0.025, 'docs/research/04-dynamics-timing.md §9.2', 'DERIVED'),
  },
});

/** doc 04 §5 — the terminal lock itself, and the JKA `0 -> 10 -> 0` envelope's parameters. */
export const KIME = Object.freeze({
  rampInMs: N(-80, 'ms', 10, 'docs/research/04-dynamics-timing.md §5', 'MEASURED'),
  riseTimeMs: N(54.5, 'ms', 11, 'docs/research/04-dynamics-timing.md §5', 'MEASURED'),
  plateauKataMs: N(175, 'ms', 75, 'docs/research/04-dynamics-timing.md §5', 'DERIVED'),
  releaseMs: N(125, 'ms', 35, 'docs/research/04-dynamics-timing.md §5', 'DERIVED'),
  residualTonePct: N(20, 'pct', 8, 'docs/research/04-dynamics-timing.md §5', 'DERIVED'),
  /** `0.27 x T_tech` at `tauP = 0.73`. Metric 53 `kime_decel_time_s` measures this. */
  decelFracTtech: N(0.27, 'ratio', 0.04, 'docs/research/04-dynamics-timing.md §5', 'MEASURED'),
  terminalVelocityMax: N(0.3, 'm/s', 0.1, 'docs/research/04-dynamics-timing.md §5', 'MEASURED'),
  /**
   * doc 04 §4.5: the brake magnitude the ANALYTIC accel channels must reach at the lock, carried
   * in `g` because the frozen `Unit` union has no `'m/s2'` member (raised as a handoff). doc 04
   * §4.5's own [MEAS] figure is `25.43 ± 0.26 g = 249 m/s²`.
   */
  brakeAccelPeakG: N(25.43, 'ratio', 0.26, 'docs/research/04-dynamics-timing.md §4.5', 'MEASURED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * TEMPO — doc 02 §1.4's classes, doc 04 §6.3's pause classes.
 *
 * doc 02 §1.4 prints `t_hold` as two columns, "Heian / Taikyoku". `TEMPO_CLASSES.tHold` carries
 * the HEIAN column — the only one defined for all eight classes (`T135` and `D45` are Heian-only).
 * The Taikyoku column is not lost: it is exactly `t_slot - (t_prep + t_transit + t_kime)` from
 * `TEMPO_T_SLOT_S`, verified against every printed row (M1 2.00 - 0.83 = 1.17 ✔, N 1.85 - 0.60 =
 * 1.25 ✔, F 0.80 - 0.40 = 0.40 ✔, T90 2.05 - 0.76 = 1.29 ✔, T180 2.05 - 0.84 = 1.21 ✔,
 * T270 2.50 - 1.04 = 1.46 ✔), so `tHoldFor(kata, class)` returns it exactly.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D02_14 = 'docs/research/02-kata-sequences.md §1.4';

interface TempoRow {
  readonly id: TempoClass;
  readonly holdHeian: number;
  readonly prep: number;
  readonly transit: number;
  readonly kime: number;
  readonly slotHeian: number | null;
  readonly slotTaikyoku: number | null;
}

const TEMPO_ROWS: readonly TempoRow[] = [
  { id: 'M1', holdHeian: 1.37, prep: 0.35, transit: 0.4, kime: 0.08, slotHeian: 2.2, slotTaikyoku: 2.0 },
  { id: 'N', holdHeian: 1.5, prep: 0.18, transit: 0.34, kime: 0.08, slotHeian: 2.1, slotTaikyoku: 1.85 },
  { id: 'F', holdHeian: 0.45, prep: 0.06, transit: 0.26, kime: 0.08, slotHeian: 0.85, slotTaikyoku: 0.8 },
  { id: 'T90', holdHeian: 1.54, prep: 0.24, transit: 0.44, kime: 0.08, slotHeian: 2.3, slotTaikyoku: 2.05 },
  { id: 'T135', holdHeian: 1.56, prep: 0.26, transit: 0.5, kime: 0.08, slotHeian: 2.4, slotTaikyoku: null },
  { id: 'T180', holdHeian: 1.46, prep: 0.26, transit: 0.5, kime: 0.08, slotHeian: 2.3, slotTaikyoku: 2.05 },
  { id: 'T270', holdHeian: 1.76, prep: 0.3, transit: 0.66, kime: 0.08, slotHeian: 2.8, slotTaikyoku: 2.5 },
  { id: 'D45', holdHeian: 1.13, prep: 0.16, transit: 0.38, kime: 0.08, slotHeian: 1.75, slotTaikyoku: null },
];

export const TEMPO_CLASSES: Readonly<
  Record<TempoClass, { readonly tHold: Num; readonly tPrep: Num; readonly tTransit: Num; readonly tKime: Num }>
> = Object.freeze(
  TEMPO_ROWS.reduce<Record<string, { tHold: Num; tPrep: Num; tTransit: Num; tKime: Num }>>((acc, r) => {
    acc[r.id] = {
      tHold: N(r.holdHeian, 's', r.holdHeian * 0.2, D02_14, 'DERIVED'),
      tPrep: N(r.prep, 's', r.prep * 0.2, D02_14, 'DERIVED'),
      tTransit: N(r.transit, 's', r.transit * 0.2, D02_14, 'DERIVED'),
      tKime: N(r.kime, 's', r.kime * 0.2, D02_14, 'DERIVED'),
    };
    return acc;
  }, {}) as Record<TempoClass, { tHold: Num; tPrep: Num; tTransit: Num; tKime: Num }>,
);

/** doc 02 §1.4's `t_slot` totals per kata. `null` where the class does not occur in that kata. */
export const TEMPO_T_SLOT_S: Readonly<Record<KataId, Readonly<Partial<Record<TempoClass, Num>>>>> =
  Object.freeze({
    'heian-shodan': Object.freeze(
      TEMPO_ROWS.reduce<Partial<Record<TempoClass, Num>>>((acc, r) => {
        if (r.slotHeian !== null) acc[r.id] = N(r.slotHeian, 's', r.slotHeian * 0.2, D02_14, 'DERIVED');
        return acc;
      }, {}),
    ),
    'taikyoku-shodan': Object.freeze(
      TEMPO_ROWS.reduce<Partial<Record<TempoClass, Num>>>((acc, r) => {
        if (r.slotTaikyoku !== null) acc[r.id] = N(r.slotTaikyoku, 's', r.slotTaikyoku * 0.2, D02_14, 'DERIVED');
        return acc;
      }, {}),
    ),
  });

/**
 * `t_hold` for one kata and one tempo class, reconstructed as
 * `t_slot - (t_prep + t_transit + t_kime)` — which reproduces doc 02 §1.4's Taikyoku column
 * exactly and returns the authored Heian value for Heian. Throws rather than returning `undefined`
 * for a class that kata never uses.
 */
export function tHoldFor(kataId: KataId, cls: TempoClass): number {
  const slot = TEMPO_T_SLOT_S[kataId][cls];
  if (slot === undefined) throw new Error(`tempo class ${cls} does not occur in ${kataId}`);
  const c = TEMPO_CLASSES[cls];
  return slot.v - (c.tPrep.v + c.tTransit.v + c.tKime.v);
}

/**
 * doc 04 §6.3's pause classes. The shipped values are §6.3's OWN budget-check numbers
 * (`12 x 0.38 + 5 x 0.75 + 2 x 1.20 + 1 x 2.00`), not the range midpoints, because that budget is
 * what closes against the 38.1 s T1 target.
 */
export const PAUSE_CLASSES: Readonly<Record<PauseClass, Num>> = Object.freeze({
  /** In-combination: "combination techniques must be done in one breath". Effectively no pause. */
  P0: N(0.05, 's', 0.05, 'docs/research/04-dynamics-timing.md §6.3', 'DERIVED'),
  P1: N(0.38, 's', 0.1, 'docs/research/04-dynamics-timing.md §6.3', 'DERIVED'),
  P2: N(0.75, 's', 0.15, 'docs/research/04-dynamics-timing.md §6.3', 'DERIVED'),
  /** Kiai counts. Capped at 1.4 s: "3 s after a kiai is too long". */
  P3: N(1.2, 's', 0.2, 'docs/research/04-dynamics-timing.md §6.3', 'DERIVED'),
  /** Final movement -> yoi (zanshin). Capped at 2.5 s. */
  P4: N(2, 's', 0.4, 'docs/research/04-dynamics-timing.md §6.3', 'DERIVED'),
});

/**
 * D14 — the tempo dispute. doc 04 §6.2's official table says 40 s for Heian Shodan; measured
 * performances by named senior instructors are reported at 23.16–33.72 s (doc 04 §12.3, doc 02
 * §9 d10). T1 ships as the default because it matches the published figure and reads better on a
 * 360° orbit; T2 is the same choreography at `TEMPO_SCALE.T2`.
 */
export const TEMPO_DISPUTE_S: Num = A(
  40,
  's',
  8,
  'docs/research/04-dynamics-timing.md §6.2',
  'TRAD',
  'D14',
  [
    { v: 23.16, src: 'docs/research/04-dynamics-timing.md §12', label: 'fastest reported senior performance' },
    { v: 33.72, src: 'docs/research/04-dynamics-timing.md §12', label: 'slowest reported senior performance' },
    { v: 42, src: 'docs/research/02-kata-sequences.md §9', label: 'karate-notes 42 s' },
  ],
);

/**
 * D08 — head bob. doc 01 §8.1 states a `±0.008 H` BAND (0.016 H peak-to-peak); doc 04 §7.3 states
 * `≤ 0.008 H` PEAK-TO-PEAK. §2.5 resolves in favour of 04 §7.3 — the tighter and later statement —
 * because a `±0.008` band parks metric 17 permanently in warn. `HEAD_BOB_MAX_PP_H` is the hard
 * fail; `units.ts` carries the same three numbers as plain constants for the frozen tests.
 */
export const HEAD_BOB_PP_H: Num = A(
  0.008,
  'H',
  0.002,
  'docs/research/04-dynamics-timing.md §7.3',
  'DERIVED',
  'D08',
  [
    { v: 0.016, src: 'docs/research/01-stances.md §8.1', label: 'doc 01 ±0.008 H band, read as peak-to-peak' },
  ],
);
export const HEAD_BOB_MAX_PP_H = N(0.012, 'H', 0.002, 'docs/research/04-dynamics-timing.md §7.3', 'DERIVED');

/** doc 04 §7.4 — "the hip drops into the stance". The sink is what makes a landing land. */
export const LANDING_SINK = Object.freeze({
  atTau: N(0.62, 'ratio', 0.06, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  amplitudeH: N(0.01, 'H', 0.004, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  /** 25–35 ms: below `EVENT_EXACT_BELOW_MS`, so it is carried as integer ticks (§2.4, G-9c). */
  tauSinkMs: N(30, 'ms', 8, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  reboundFrac: N(0.2, 'ratio', 0.08, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  reboundPeakMs: N(110, 'ms', 25, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  settledMs: N(240, 'ms', 40, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  omegaN: N(28, 'rad/s', 4, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  zeta: N(0.45, 'ratio', 0.08, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
  /** "sink completes AT or <= 40 ms before the lock — never after." */
  beforeLockMaxMs: N(40, 'ms', 10, 'docs/research/04-dynamics-timing.md §7.4', 'DERIVED'),
});

/** doc 04 §7.1 / §7.2 — the weight-transfer and COM-translation profile during a step. */
export const WEIGHT_SHIFT = Object.freeze({
  contactAtTau: N(0.62, 'ratio', 0.06, 'docs/research/04-dynamics-timing.md §7.1', 'DERIVED'),
  transferBase: N(0.5, 'ratio', 0.02, 'docs/research/04-dynamics-timing.md §7.1', 'DERIVED'),
  transferGain: N(0.15, 'ratio', 0.03, 'docs/research/04-dynamics-timing.md §7.1', 'DERIVED'),
  transferTauP: N(0.45, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §7.1', 'DERIVED'),
  comTravelH: N(0.45, 'H', 0.05, 'docs/research/04-dynamics-timing.md §7.2', 'DERIVED'),
  comPeakSpeed: N(1.8, 'm/s', 0.4, 'docs/research/04-dynamics-timing.md §7.2', 'DERIVED'),
  comAtLockMax: N(0.08, 'm/s', 0.05, 'docs/research/04-dynamics-timing.md §7.2', 'DERIVED'),
  pelvisRollMaxDeg: N(0, 'deg', 2.5, 'docs/research/04-dynamics-timing.md §7.3', 'TRAD'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * BREATH + KIAI — doc 04 §8. `chan.breath`, `chan.kiai` and `ribcage.scale` read these.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const BREATH = Object.freeze({
  inhaleStart: N(0.15, 'ratio', 0.03, 'docs/research/04-dynamics-timing.md §8.1', 'DERIVED'),
  inhalePeak: N(1, 'ratio', 0, 'docs/research/04-dynamics-timing.md §8.1', 'DERIVED'),
  exhaleEnd: N(0.3, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §8.1', 'DERIVED'),
  kimeHold: N(0.22, 'ratio', 0.05, 'docs/research/04-dynamics-timing.md §8.1', 'DERIVED'),
  settleEnd: N(0.15, 'ratio', 0.03, 'docs/research/04-dynamics-timing.md §8.1', 'DERIVED'),
  /** §2.8: `ribcage.scale = (1 + 0.022*b, 1, 1 + 0.022*b)`; 0.994 at kiai. */
  ribcageInhaleScale: N(1.022, 'ratio', 0.006, 'docs/research/04-dynamics-timing.md §8.2', 'DERIVED'),
  ribcageKiaiScale: N(0.994, 'ratio', 0.004, 'docs/research/04-dynamics-timing.md §8.2', 'DERIVED'),
  ribcageAmplitude: N(0.022, 'ratio', 0.006, 'docs/research/04-dynamics-timing.md §8.2', 'DERIVED'),
  /** Shoulders must stay DOWN — this is a correctness cue, not a breathing flourish. */
  clavicleRiseMaxH: N(0.008, 'H', 0.002, 'docs/research/04-dynamics-timing.md §8.2', 'TRAD'),
  haraBulgeH: N(0.0065, 'H', 0.0015, 'docs/research/04-dynamics-timing.md §8.2', 'DERIVED'),
  abdomenLeadsChestMs: N(90, 'ms', 40, 'docs/research/04-dynamics-timing.md §8.2', 'DERIVED'),
});

export const KIAI = Object.freeze({
  durationS: N(0.3, 's', 0.12, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
  onsetMs: N(-60, 'ms', 40, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
  peakMs: N(0, 'ms', 40, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
  jawOpenPct: N(72.5, 'pct', 10, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
  jawOpenRampMs: N(70, 'ms', 25, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
  jawCloseRampMs: N(180, 'ms', 25, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
  /** Do NOT throw the head back. WKF: theatrics are a very serious foul. */
  headExtensionMaxDeg: N(0, 'deg', 3, 'docs/research/04-dynamics-timing.md §8.3', 'TRAD'),
  ribcageCompression: N(0.008, 'ratio', 0.003, 'docs/research/04-dynamics-timing.md §8.3', 'DERIVED'),
});

/** doc 04 §6.4 / doc 02 §8 — the arrival-order rule the WKF makes a foul to break. */
export const SIMULTANEITY = Object.freeze({
  /** `t(arm arrival) - t(stance settle)` must be in `[0, +0.04] s`. NEVER negative. */
  armAfterStanceMinS: N(0, 's', 0, 'docs/research/04-dynamics-timing.md §6.4', 'TRAD'),
  armAfterStanceMaxS: N(0.04, 's', 0.01, 'docs/research/04-dynamics-timing.md §6.4', 'TRAD'),
  /** doc 02 §8 S1: front-foot contact precedes arm kime by 0.04 s. */
  footDownBeforeKimeS: N(0.04, 's', 0.04, 'docs/research/02-kata-sequences.md §8', 'DERIVED'),
  rearHeelBeforeContactS: N(0.02, 's', 0.02, 'docs/research/02-kata-sequences.md §8', 'DERIVED'),
  /** doc 02 §8 S2: head/eyes reach the new heading before the hips begin to rotate. */
  headLeadOnTurnS: N(0.1, 's', 0.03, 'docs/research/02-kata-sequences.md §8', 'DERIVED'),
  pivotDriftMaxL: N(0.02, 'ratio', 0.01, 'docs/research/02-kata-sequences.md §8', 'DERIVED'),
  /** doc 03 §2: hikite may LEAD the strike, never lag. */
  hikiteMayLeadS: N(0.03, 's', 0.003, 'docs/research/03-techniques-upper.md §2', 'TRAD'),
  hikiteDesyncFailS: N(0.033, 's', 0.003, 'docs/research/03-techniques-upper.md §2', 'DERIVED'),
});
