/**
 * B1 NUMBERS — `src/data/constants/cloth.ts`
 *
 * `CLOTH`, `GARMENTS` (ARCHITECTURE.md §3.13, §4.1). Sources: doc 06 §7.1 (garment inventory and
 * fabric weight), §7.3 (the per-part grid, 988 particles), §7.4–§7.5 (XPBD and its concrete
 * parameters), §7.7 (robustness), §7.9–§7.10 (creases and the gi silhouette rules), doc 04 §9
 * (snap and settle).
 *
 * ── `alpha_bend` IS THE ONE NUMBER THAT DECIDES WHETHER THE GI IS CANVAS OR A BED SHEET ────
 * doc 06 §7.5 ships `8.0e-3 rad/(N·m)` as a STARTING value and says, in its own words, do not
 * trust it blind — calibrate against the swatch test. `tests/cloth/swatch.test.ts` (B7) is that
 * gate: a 0.20 m swatch on a 3 cm grid, clamped along one edge, 2 s of settle, free edge drooping
 * `7.5 ± 1.5 cm` (`= 0.043 ± 0.009 H`). A generic-cloth alpha (~0.5) droops ~17 cm. Until that test
 * is green the number here is provisional, which is why it ships with the swatch target beside it.
 *
 * ── UNITS THE FROZEN `Unit` UNION CANNOT SPELL ─────────────────────────────────────────────
 * XPBD compliance is `m/N` (stretch, shear) and areal density is `kg/m²`; §3.5's union has neither
 * (it has `'N/m'`, the reciprocal, and `'rad/(N.m)'`, which fits bend compliance exactly). Those
 * entries carry `'ratio'` plus an explicit comment naming the real unit; raised as a handoff to the
 * orchestrator rather than fixed by coercing a wrong unit onto a `Num`.
 */

import type { GarmentPartId, Num } from '../../contracts';
import { GARMENT_PARTS } from '../../contracts';
import { N } from '../num';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * GARMENTS — doc 06 §7.3's NORMATIVE per-part table. 988 particles, which is the number
 * `createClothSystem` allocates and `ClothSystem.particleCount` reports.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface GarmentLayoutSpec {
  readonly part: GarmentPartId;
  readonly cols: number;
  readonly rows: number;
  readonly particles: number;
  readonly approach: 'skin' | 'xpbd';
}

/** doc 06 §7.3, row for row. `cols` = around/wide, `rows` = along/tall. */
export const GARMENTS: readonly GarmentLayoutSpec[] = Object.freeze([
  { part: 'sleeve_L', cols: 12, rows: 10, particles: 120, approach: 'xpbd' },
  { part: 'sleeve_R', cols: 12, rows: 10, particles: 120, approach: 'xpbd' },
  { part: 'skirt_front_L', cols: 12, rows: 9, particles: 108, approach: 'xpbd' },
  { part: 'skirt_front_R', cols: 12, rows: 9, particles: 108, approach: 'xpbd' },
  { part: 'skirt_back', cols: 16, rows: 9, particles: 144, approach: 'xpbd' },
  { part: 'trouser_L', cols: 14, rows: 12, particles: 168, approach: 'xpbd' },
  { part: 'trouser_R', cols: 14, rows: 12, particles: 168, approach: 'xpbd' },
  { part: 'obi_tail_L', cols: 2, rows: 13, particles: 26, approach: 'xpbd' },
  { part: 'obi_tail_R', cols: 2, rows: 13, particles: 26, approach: 'xpbd' },
]);

/** 120·2 + 108·2 + 144 + 168·2 + 26·2 = 988. doc 06 §7.3's total, asserted in `tests/data`. */
export const GARMENT_PARTICLE_TOTAL = 988 as const;

/**
 * The parts doc 06 §7.3 marks PURE SKINNING — no particles, no simulation. They are not
 * `GarmentPartId`s (§3.10 enumerates only the simulated nine), so they are named here for B4's
 * geometry pass: the jacket chest and back are compressed under the obi and simulating them buys
 * nothing and risks poking through; the collar is a stiff doubled band ("never simulate it"); the
 * obi knot is rigid to `pelvis`.
 */
export const SKINNED_GARMENT_PARTS: readonly string[] = Object.freeze([
  'uwagi_chest',
  'uwagi_back',
  'collar',
  'obi_knot',
]);

/** doc 06 §7.3: constraints ~= 3.1 x particles => ~3060. Drives B7's array sizing. */
export const CONSTRAINTS_PER_PARTICLE = 3.1 as const;

/** Per-part air drag, doc 06 §7.5 ("sleeves catch the most air"). Linear, per frame. */
export const GARMENT_DRAG: Readonly<Record<GarmentPartId, number>> = Object.freeze(
  GARMENT_PARTS.reduce<Record<GarmentPartId, number>>((acc, p) => {
    acc[p] = p.startsWith('sleeve')
      ? 0.05
      : p.startsWith('trouser')
        ? 0.04
        : p.startsWith('obi')
          ? 0.02
          : 0.03; // skirt
    return acc;
  }, {} as Record<GarmentPartId, number>),
);

/** Per-part layer offset, FracH. doc 06 §7.3: front-L gets +0.004 H so the layers never fight. */
export const GARMENT_LAYER_OFFSET_H: Readonly<Record<GarmentPartId, number>> = Object.freeze(
  GARMENT_PARTS.reduce<Record<GarmentPartId, number>>((acc, p) => {
    acc[p] = p === 'skirt_front_L' ? 0.004 : 0;
    return acc;
  }, {} as Record<GarmentPartId, number>),
);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * CLOTH
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D71 = 'docs/research/06-rig-ik-cloth.md §7.1';
const D75 = 'docs/research/06-rig-ik-cloth.md §7.5';
const D77 = 'docs/research/06-rig-ik-cloth.md §7.7';
const D79 = 'docs/research/06-rig-ik-cloth.md §7.9';
const D710 = 'docs/research/06-rig-ik-cloth.md §7.10';
const D0491 = 'docs/research/04-dynamics-timing.md §9.1';
const D0492 = 'docs/research/04-dynamics-timing.md §9.2';

export const CLOTH: Readonly<Record<string, Num>> = Object.freeze({
  /* ── doc 06 §7.5 · the solver ── */
  nSub: N(8, 'count', 0, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  dtSubstepMs: N(2.083, 'ms', 0.001, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  itersPerSubstep: N(1, 'count', 0, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  gridCellM: N(0.03, 'm', 0.002, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  /** Compliance, real unit `m/N`. 12 oz duck canvas is effectively inextensible. */
  alphaStretch: N(0, 'ratio', 0, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  alphaStretchSoftGi: N(2.0e-6, 'ratio', 5e-7, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  /** Compliance, real unit `m/N`. Canvas resists shear but not rigidly. */
  alphaShear: N(4.0e-5, 'ratio', 1e-5, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  /** THE calibration knob. See the header: `tests/cloth/swatch.test.ts` is its gate. */
  alphaBend: N(8.0e-3, 'rad/(N.m)', 2e-3, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  alphaBend14oz: N(4.0e-3, 'rad/(N.m)', 1e-3, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  alphaBendObi: N(5.0e-4, 'rad/(N.m)', 1e-4, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  alphaBend8oz: N(5.0e-2, 'rad/(N.m)', 1e-2, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  dampingPerFrame: N(0.98, 'ratio', 0.005, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  dampingPerSubstep: N(0.99748, 'ratio', 0.0005, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  frictionOnSkin: N(0.6, 'ratio', 0.1, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  frictionOnGi: N(0.45, 'ratio', 0.1, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  /** Explosion guard. `'m/s'`, not the `Ms` milliseconds suffix. */
  maxVelocity: N(12, 'm/s', 1, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  /** CFL cap, Macklin 2019 §6.4: at most 0.30 of a particle radius per substep. */
  maxSubstepDispFracR: N(0.3, 'ratio', 0.05, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  pinRingsPerTube: N(2, 'count', 0, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),

  /* ── doc 06 §7.1 · fabric ── */
  /** Areal density, real unit `g/m²`. 12 oz/yd² duck canvas — the kata/competition weight. */
  arealDensity: N(407, 'ratio', 20, 'docs/research/06-rig-ik-cloth.md §7.1', 'MEASURED'),
  /** 0.63 mm. `= 407 / 650000 g/cm³`. Also the `giShell` inner-shell offset of §5.5. */
  fabricThicknessCm: N(0.063, 'cm', 0.005, 'docs/research/06-rig-ik-cloth.md §7.1', 'DERIVED'),

  /* ── doc 06 §7.1 · garment dimensions, kata cut (§7.10 rule 9: shortest legal, longest lapel) ── */
  uwagiHemH: N(0.4, 'H', 0.03, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  skirtDropMinH: N(0.19, 'H', 0.005, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  skirtDropMaxH: N(0.215, 'H', 0.005, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  sleeveEndH: N(0.255, 'H', 0.02, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  zubonHemH: N(0.1, 'H', 0.02, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  obiWidthH: N(0.024, 'H', 0.003, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  obiThicknessH: N(0.003, 'H', 0.0005, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  obiTailH: N(0.16, 'H', 0.02, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  beltLineH: N(0.6145, 'H', 0.009, 'docs/research/06-rig-ik-cloth.md §7.1', 'DERIVED'),
  collarBandWidthH: N(0.023, 'H', 0.0035, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  /** Kata cut = the LONGEST lapel, so the top of §7.1's 0.090–0.130 band. */
  frontOverlapH: N(0.13, 'H', 0.02, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),
  sideVentH: N(0.19, 'H', 0.0125, 'docs/research/06-rig-ik-cloth.md §7.1', 'TRAD'),

  /* ── doc 06 §7.10 · the silhouette rules that make a gi read as a gi ── */
  chestEaseH: N(0.02, 'H', 0.004, 'docs/research/06-rig-ik-cloth.md §7.10', 'TRAD'),
  sleeveCuffRadiusH: N(0.0335, 'H', 0.0025, 'docs/research/06-rig-ik-cloth.md §7.10', 'DERIVED'),
  sleeveEaseRatio: N(1.35, 'ratio', 0.1, 'docs/research/06-rig-ik-cloth.md §7.10', 'DERIVED'),
  trouserHemRadiusH: N(0.0435, 'H', 0.0035, 'docs/research/06-rig-ik-cloth.md §7.10', 'DERIVED'),
  trouserEaseRatio: N(2.1, 'ratio', 0.2, 'docs/research/06-rig-ik-cloth.md §7.10', 'DERIVED'),
  /** Because it is HEAVY, folds are FEW and LARGE. 2 cm folds instantly read as jersey. */
  foldWavelengthH: N(0.0425, 'H', 0.0075, 'docs/research/06-rig-ik-cloth.md §7.10', 'TRAD'),
  /** Metric 63 `hem_overshoot_H`. §7.10 rule 7: 0.030–0.045 H, settling in 0.25–0.40 s. */
  hemOvershootH: N(0.0375, 'H', 0.0075, 'docs/research/06-rig-ik-cloth.md §7.10', 'DERIVED'),
  hemSettleS: N(0.325, 's', 0.075, 'docs/research/06-rig-ik-cloth.md §7.10', 'DERIVED'),

  /* ── doc 06 §7.9 · creases, the weave map, and the belt gather ── */
  creaseSpacingMinH: N(0.03, 'H', 0.003, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  creaseSpacingMaxH: N(0.045, 'H', 0.003, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  creaseFoldsPerPanel: N(8, 'count', 1, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  kneeCreaseH: N(0.29, 'H', 0.01, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  kneeCreaseIntensity: N(0.6, 'ratio', 0.1, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  /** The ONE place the gi is tight. */
  beltGatherH: N(0.012, 'H', 0.002, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  beltGatherBandH: N(0.024, 'H', 0.003, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  beltGatherFolds: N(10, 'count', 2, 'docs/research/06-rig-ik-cloth.md §7.9', 'TRAD'),
  /** Asymmetric hysteresis is why cotton keeps a crease and lycra does not. */
  wrinkleAttackS: N(0.05, 's', 0.01, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  wrinkleReleaseS: N(0.9, 's', 0.15, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  wrinkleOnsetStrain: N(-0.03, 'ratio', 0.005, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  wrinkleSaturateStrain: N(-0.12, 'ratio', 0.02, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  weaveEndsPerInch: N(30, 'count', 3, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  weavePicksPerInch: N(20, 'count', 2, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  weaveTileRes: N(512, 'count', 0, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  weaveRepeatsPerMetreU: N(147, 'count', 5, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  weaveRepeatsPerMetreV: N(131, 'count', 5, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),
  weaveCrownHeightCm: N(0.018, 'cm', 0.003, 'docs/research/06-rig-ik-cloth.md §7.9', 'DERIVED'),

  /* ── doc 06 §7.5 · the swatch calibration gate ── */
  swatchSizeM: N(0.2, 'm', 0, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  swatchSettleS: N(2, 's', 0, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  swatchDroopCm: N(7.5, 'cm', 1.5, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  swatchDroopH: N(0.043, 'H', 0.009, 'docs/research/06-rig-ik-cloth.md §7.5', 'DERIVED'),
  cantileverBendLengthCm: N(4.25, 'cm', 0.75, 'docs/research/06-rig-ik-cloth.md §7.5', 'MEASURED'),

  /* ── doc 06 §7.7 · robustness. Mandatory for a scrubbable player. ── */
  teleportThresholdH: N(0.05, 'H', 0.005, 'docs/research/06-rig-ik-cloth.md §7.7', 'DERIVED'),
  settleFramesAtLoad: N(30, 'count', 5, 'docs/research/06-rig-ik-cloth.md §7.7', 'DERIVED'),
  snapshotIntervalS: N(1, 's', 0, 'docs/research/06-rig-ik-cloth.md §7.7', 'DERIVED'),

  /* ── doc 04 §9 · snap and settle ── */
  /** Below `EVENT_EXACT_BELOW_MS`, so it is carried as `ImpulseEvent.crackDelayTicks` (§2.4). */
  snapDelaySleeveMinMs: N(10, 'ms', 5, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  snapDelaySleeveMaxMs: N(20, 'ms', 5, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  snapDelayTrouserMinMs: N(16, 'ms', 8, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  snapDelayTrouserMaxMs: N(31, 'ms', 8, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  snapAmplitudeMinH: N(0.004, 'H', 0.003, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  snapAmplitudeMaxH: N(0.01, 'H', 0.003, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  waveSpeedMinOnPanel: N(11, 'm/s', 4, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  waveSpeedMaxOnPanel: N(20, 'm/s', 4, 'docs/research/04-dynamics-timing.md §9.1', 'DERIVED'),
  /** doc 04 §9.3: the stretch limit and the self-collision thickness. Wind is ZERO — dojo interior. */
  stretchLimit: N(1.02, 'ratio', 0.01, 'docs/research/04-dynamics-timing.md §9.3', 'DERIVED'),
  selfCollisionThicknessH: N(0.004, 'H', 0.002, 'docs/research/04-dynamics-timing.md §9.3', 'DERIVED'),
  wind: N(0, 'm/s', 0, 'docs/research/04-dynamics-timing.md §9.3', 'TRAD'),
});

/**
 * doc 04 §9.2's per-element settle parameters. The obi ends are STILL VISIBLY MOVING during the
 * pose hold — that is correct, and it is one of the cheapest, strongest realism cues available.
 * The jacket skirt must be still before the next count starts at T1 (0.80 s < 1.90 s ✔).
 */
export const CLOTH_SETTLE: Readonly<
  Record<
    'sleeveHem' | 'trouserHem' | 'jacketSkirt' | 'obiTail',
    {
      readonly omegaN: Num;
      readonly zeta: Num;
      readonly overshootMs: Num;
      readonly overshootH: Num;
      readonly settledS: Num;
    }
  >
> = Object.freeze({
  sleeveHem: {
    omegaN: N(9.75, 'rad/s', 1.25, D0492, 'DERIVED'),
    zeta: N(0.3, 'ratio', 0.08, D0492, 'DERIVED'),
    overshootMs: N(55, 'ms', 20, D0492, 'DERIVED'),
    overshootH: N(0.0325, 'H', 0.0125, D0492, 'DERIVED'),
    settledS: N(0.375, 's', 0.075, D0492, 'DERIVED'),
  },
  trouserHem: {
    omegaN: N(6.8, 'rad/s', 0.5, D0492, 'DERIVED'),
    zeta: N(0.26, 'ratio', 0.08, D0492, 'DERIVED'),
    overshootMs: N(75, 'ms', 25, D0492, 'DERIVED'),
    overshootH: N(0.04, 'H', 0.015, D0492, 'DERIVED'),
    settledS: N(0.5, 's', 0.1, D0492, 'DERIVED'),
  },
  jacketSkirt: {
    omegaN: N(7.1, 'rad/s', 0.7, D0492, 'DERIVED'),
    zeta: N(0.24, 'ratio', 0.08, D0492, 'DERIVED'),
    overshootMs: N(90, 'ms', 30, D0492, 'DERIVED'),
    overshootH: N(0.045, 'H', 0.015, D0492, 'DERIVED'),
    settledS: N(0.65, 's', 0.15, D0492, 'DERIVED'),
  },
  obiTail: {
    omegaN: N(6.35, 'rad/s', 0.95, D0492, 'DERIVED'),
    zeta: N(0.18, 'ratio', 0.06, D0492, 'DERIVED'),
    overshootMs: N(110, 'ms', 40, D0492, 'DERIVED'),
    overshootH: N(0.075, 'H', 0.025, D0492, 'DERIVED'),
    settledS: N(1.4, 's', 0.4, D0492, 'DERIVED'),
  },
});

/** Free (unpinned) length per element, FracH — doc 04 §9.2's own `L` column. */
export const CLOTH_FREE_LENGTH_H = Object.freeze({
  sleeveHem: N(0.12, 'H', 0.02, D0492, 'DERIVED'),
  trouserHem: N(0.185, 'H', 0.025, D0492, 'DERIVED'),
  jacketSkirt: N(0.17, 'H', 0.03, D0492, 'DERIVED'),
  obiTail: N(0.24, 'H', 0.04, D0492, 'DERIVED'),
});

/** Greppable registry of the doc anchors this file cites, for `tools/verify-constants.mjs`. */
export const CLOTH_SRC_SECTIONS: readonly string[] = Object.freeze([
  D71,
  D75,
  D77,
  D79,
  D710,
  D0491,
  D0492,
]);
