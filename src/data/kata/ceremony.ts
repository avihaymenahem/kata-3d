/**
 * B2 KATA — `src/data/kata/ceremony.ts`
 *
 * doc 02 §2's rei / yoi / yame table, transcribed row for row. ARCHITECTURE.md §3.6
 * (`CeremonyPhase`), §8 Phase 2.
 *
 * ═══ THE TWO HALVES ARE ASYMMETRIC, AND THAT IS THE POINT ════════════════════════════════════
 * `OPENING` is identical for both kata (both start from musubi at the origin). `closingCeremony`
 * is a FUNCTION because `FINAL_HOLD` is held in the LAST MOVE'S stance — zenkutsu for Taikyoku,
 * kokutsu for Heian — and because the yame turn differs: doc 02 §4.3 closes Taikyoku with
 * `ΔH = +90` and a 1.38 L draw of the left foot, doc 02 §6.3 closes Heian with `ΔH = +45` and a
 * 1.30 L draw. Hard-coding one of the two would put the character 45° off the yoi heading at the
 * final bow in the other kata, which no metric in the 63 measures and which a VLM critic WOULD
 * see in `strip/yame_M_FRONT.png`.
 *
 * ═══ WHY EVERY PARAM IS A BARE NUMBER WITH A UNIT SUFFIX ════════════════════════════════════
 * `CeremonyPhase.params` is `Readonly<Record<string, number>>` in the frozen §3.6 shape, so the
 * §2.2 unit audit cannot reach individual keys (`AuditCeremonyPhase` only sees `params` itself).
 * The suffix convention is therefore held BY HAND here: every key carries `Deg`, `S`, `H`, `L` or
 * `Pct`. A key without one is a review defect even though the compiler will accept it.
 *
 * These are AUTHORED-frame numbers (doc 02 §1): the yoi step is toward `+X` = the character's
 * LEFT. The single world conversion is B3's, per §2.1.
 */

import type { CeremonyPhase, KataId, StanceId } from '../../contracts';

const D02_2 = '02-kata-sequences.md §2';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Shared posture numbers. Named once so `REI_IN` and `REI_OUT` cannot drift — doc 02 §2 states
 * the closing bow as "identical to `REI_IN`", and an identity claim in prose is exactly the kind
 * of thing that decays into two slightly different tables.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 02 §2: trunk 30° forward from vertical, tol ±15° (source range 15–45°). Uncertainty 10. */
export const REI_TRUNK_PITCH_DEG = 30;

/** doc 02 §2 / §10: musubi-dachi, each foot 22.5° out of the mid-sagittal (included angle 45°). */
export const MUSUBI_FOOT_OUT_DEG = 22.5;

/** doc 02 §2 / §10: hachiji-dachi, toes out 30° each (tol ±15°). */
export const HACHIJI_TOE_OUT_DEG = 30;

/**
 * The bow, sub-phased. doc 02 §2 prints "1.0 down / 1.0 hold / 1.0 up = 3.0"; the split is kept
 * because B3's timeline needs the three segments, not just their sum.
 */
const REI_PARAMS: Readonly<Record<string, number>> = Object.freeze({
  footOutDeg: MUSUBI_FOOT_OUT_DEG,
  /** Cervical angle relative to the trunk. 0° is what makes the gaze descend with the bow. */
  cervicalDeg: 0,
  /** Palms flat on the outer thighs, sliding down this far during the bow. */
  handSlideH: 0.06,
  downS: 1.0,
  holdS: 1.0,
  upS: 1.0,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * OPENING — doc 02 §2 rows 1–4. Σ = 6.70 s at T1.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const OPENING_CEREMONY: readonly CeremonyPhase[] = Object.freeze([
  {
    id: 'REI_IN',
    stance: 'musubi',
    durationS: 3.0,
    trunkPitchDeg: REI_TRUNK_PITCH_DEG,
    params: REI_PARAMS,
  },
  {
    /** Kata name called; no limb motion. Erect, so the pitch is stated as 0 rather than omitted. */
    id: 'ANNOUNCE',
    stance: 'musubi',
    durationS: 1.5,
    trunkPitchDeg: 0,
    params: Object.freeze({ footOutDeg: MUSUBI_FOOT_OUT_DEG }),
  },
  {
    /**
     * musubi → hachiji. The LEFT foot steps toward `+X` by `w = 0.385 L`; the right foot is fixed,
     * which is the whole reason doc 02 §3.2's stem sits at `x = −h` and not at `x = 0`
     * (uncertainty 3). Both fists close and travel down-forward to gedan.
     */
    id: 'YOI',
    stance: 'hachiji',
    durationS: 1.2,
    trunkPitchDeg: 0,
    params: Object.freeze({
      stepFootLeftXL: 0.385,
      fistCentreYH: 0.55,
      fistLateralH: 0.13,
      fistForwardOfHipH: 0.1,
      /** doc 02 §2 "elbows 165–170°" — the included angle, midpoint. */
      elbowIncludedDeg: 167.5,
      toeOutDeg: HACHIJI_TOE_OUT_DEG,
    }),
  },
  {
    /** Still, exhale. [DERIVED] in doc 02 §2. */
    id: 'SET',
    stance: 'hachiji',
    durationS: 1.0,
    trunkPitchDeg: 0,
    params: Object.freeze({ toeOutDeg: HACHIJI_TOE_OUT_DEG }),
  },
]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * CLOSING — doc 02 §2 rows 6–10, parameterised by the kata's last stance and its yame turn.
 * Σ = 8.20 s at T1, both kata.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 02 §4.3 / §6.3: the yame/naore turn and the distance the LEFT foot travels back to `(+h, 0)`. */
export interface YameSpec {
  /** Signed deg, AUTHORED frame, + = to the character's LEFT. `+90` Taikyoku, `+45` Heian. */
  readonly dHeadingDeg: number;
  /** Units of `L`. `1.38` Taikyoku, `1.30` Heian. */
  readonly leftFootTravelL: number;
  /** The stance the FINAL_HOLD is sustained in — the last move's stance. */
  readonly finalStance: StanceId;
}

export const YAME: Readonly<Record<KataId, YameSpec>> = Object.freeze({
  /** doc 02 §4.3: after move 20 `H = 270`, pivot on R, draw L from `(−1.19, 0)` to `(+0.19, 0)`. */
  'taikyoku-shodan': Object.freeze({
    dHeadingDeg: 90,
    leftFootTravelL: 1.38,
    finalStance: 'zenkutsu' as StanceId,
  }),
  /** doc 02 §6.3: after move 21 `H = 315`, pivot on R, draw L from `(−0.897, −0.707)`. */
  'heian-shodan': Object.freeze({
    dHeadingDeg: 45,
    leftFootTravelL: 1.3,
    finalStance: 'kokutsu' as StanceId,
  }),
});

/**
 * doc 02 §2 rows 6–10. `FINAL_HOLD` sits in the last move's stance; everything after `YAME` is
 * back on the yoi datum, so the remaining rows are kata-independent.
 *
 * Pure: builds a fresh frozen array per call and reads nothing but its argument.
 */
export function closingCeremony(id: KataId): readonly CeremonyPhase[] {
  const y = YAME[id];
  return Object.freeze([
    {
      /** JKA England prints "Hold position" at the last move. Kime sustained, zanshin. */
      id: 'FINAL_HOLD',
      stance: y.finalStance,
      durationS: 2.0,
      trunkPitchDeg: 0,
      params: Object.freeze({}),
    },
    {
      /**
       * "On instruction NAORE, return to YOI position, bring left foot back." The pivot is the
       * RIGHT foot, which has been on its yoi position `(−h, 0)` since move 19 (Taikyoku) / 20
       * (Heian) — that is doc 02 §4.3 / §6.3's zero-residual closure.
       */
      id: 'YAME',
      stance: 'hachiji',
      durationS: 1.2,
      trunkPitchDeg: 0,
      params: Object.freeze({
        dHeadingDeg: y.dHeadingDeg,
        leftFootTravelL: y.leftFootTravelL,
        toeOutDeg: HACHIJI_TOE_OUT_DEG,
      }),
    },
    {
      id: 'SETTLE',
      stance: 'hachiji',
      durationS: 1.0,
      trunkPitchDeg: 0,
      params: Object.freeze({ toeOutDeg: HACHIJI_TOE_OUT_DEG }),
    },
    {
      /** Left foot draws in to heels-together. */
      id: 'ATTENTION',
      stance: 'musubi',
      durationS: 1.0,
      trunkPitchDeg: 0,
      params: Object.freeze({ footOutDeg: MUSUBI_FOOT_OUT_DEG }),
    },
    {
      /** doc 02 §2: "identical to `REI_IN`" — enforced by sharing `REI_PARAMS`, not by copying. */
      id: 'REI_OUT',
      stance: 'musubi',
      durationS: 3.0,
      trunkPitchDeg: REI_TRUNK_PITCH_DEG,
      params: REI_PARAMS,
    },
  ] as const satisfies readonly CeremonyPhase[]);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Totals. doc 02 §2: "Taikyoku Shodan `6.70 + 35.25 + 8.20 = 50.15 s`; Heian Shodan
 * `6.70 + 39.75 + 8.20 = 54.65 s`. Tolerance ±20 %."
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const sumS = (ps: readonly CeremonyPhase[]): number => ps.reduce((a, p) => a + p.durationS, 0);

/** 6.70 s. Asserted against the phase table, not authored, so the two cannot disagree. */
export const OPENING_SECONDS_T1: number = sumS(OPENING_CEREMONY);

/** 8.20 s, identical for both kata (only `FINAL_HOLD`'s stance and the yame turn differ). */
export const CLOSING_SECONDS_T1: number = sumS(closingCeremony('taikyoku-shodan'));

/** doc 02 §2's own arithmetic, as a function of the moves-only total. */
export const clipSecondsT1 = (moveSecondsT1: number): number =>
  OPENING_SECONDS_T1 + moveSecondsT1 + CLOSING_SECONDS_T1;

/** The provenance row both kata carry for their ceremony half. */
export const CEREMONY_PROVENANCE: readonly string[] = Object.freeze([
  `${D02_2} (rei/yoi/yame table: musubi 22.5° per foot, trunk 30°, hachiji toes-out 30°, 6.70 + 8.20 s)`,
]);
