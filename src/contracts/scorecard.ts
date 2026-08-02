/**
 * B0 CONTRACTS — `src/contracts/scorecard.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.11 verbatim, plus §2.6 (the reference-precedence rule and its
 * eight mandatory overrides, as a frozen table) and §7.5 (the group weights).
 *
 * `MetricId` is the 63-member VERBATIM string union, not `string & {__metric}`: throwing away
 * compile-time exhaustiveness was one of the defects deliberately not imported (§9.4).
 */

import type { KataId, KataMove, Level, StanceId, TechniqueId, TempoTier } from './kata';
import type { Unit } from './num';
import type { BakeStats, LayerId } from './pose';
import type { CameraPresetId } from './services';

export type MetricGroup = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type Verdict = 'pass' | 'warn' | 'fail' | 'fatal';
export type BlockId = 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9';
export type GateId =
  | 'G-1' | 'G-2' | 'G-3' | 'G-4' | 'G-5' | 'G-6' | 'G-7' | 'G-8' | 'G-9' | 'G-10' | 'G-11';

/** 63 metrics: the 61 of doc 07 §6.2 verbatim + 2 additions (§7.3). VERBATIM string union. */
export type MetricId =
  // G1 stance & base (17)
  | 'stance_len_H' | 'stance_width_H' | 'front_knee_flex_deg' | 'rear_knee_flex_deg'
  | 'knee_over_toe_H' | 'hip_height_H' | 'weight_front_pct' | 'front_foot_yaw_deg'
  | 'rear_foot_yaw_deg' | 'rear_heel_gap_H' | 'pelvis_yaw_deg' | 'shoulder_pelvis_diff_deg'
  | 'torso_pitch_deg' | 'torso_roll_deg' | 'head_height_H' | 'head_yaw_deg' | 'head_bob_H'
  // G2 upper-body technique (23)
  | 'active_fist_H' | 'active_fist_lateral_H' | 'arm_extension_ratio' | 'punch_elbow_flex_deg'
  | 'wrist_break_deg' | 'fist_roll_deg' | 'hikite_fist_H' | 'hikite_lateral_H'
  | 'hikite_back_H' | 'hikite_elbow_flex_deg' | 'hikite_present' | 'shoulder_elevation_H'
  | 'gedan_barai_fist_H' | 'gedan_barai_fist_over_knee_H' | 'gedan_barai_forearm_incline_deg'
  | 'age_uke_wrist_H' | 'age_uke_forward_H' | 'age_uke_forearm_angle_deg'
  | 'shuto_uke_hand_H' | 'shuto_uke_elbow_flex_deg' | 'shuto_uke_support_hand_H'
  | 'tettsui_uchi_fist_H' | 'finger_curl_state'
  // G3 embusen & orientation (5)
  | 'facing_yaw_err_deg' | 'embusen_pos_err_H' | 'embusen_return_err_H'
  | 'step_path_lateral_dev_H' | 'turn_pivot_foot_slip_H'
  // G4 timing & dynamics (9)
  | 'move_duration_s' | 'kime_hold_s' | 'kata_total_s' | 'peak_fist_speed_Hps'
  | 'kime_decel_time_s' | 'hip_lead_lag_s' | 'accel_profile_skew'
  | 'double_support_frac' | 'kiai_frame_alignment_s'
  // G5 rendering & integrity (7)
  | 'foot_slide_Hps' | 'ground_penetration_H' | 'float_gap_H' | 'self_intersection_count'
  | 'bone_length_drift_pct' | 'silhouette_IoU' | 'contact_shadow_present'
  // ADDED (§7.3)
  | 'forearm_radius_retention' | 'hem_overshoot_H';

export const METRIC_COUNT = 63 as const;
/**
 * The shipped grouping. 17 + 23 + 5 + 9 + 9 = 63. doc 07 §6.2's G5 has seven rows; the two
 * §7.3 additions (`forearm_radius_retention`, `hem_overshoot_H`) are integrity metrics and
 * join G5, which is also the group whose weight is smallest, so adding to it cannot silently
 * re-weight the score.
 */
export const METRIC_COUNT_BY_GROUP: Readonly<Record<MetricGroup, number>> = Object.freeze({
  G1: 17, G2: 23, G3: 5, G4: 9, G5: 9,
});

/** 0.34*G1 + 0.30*G2 + 0.12*G3 + 0.14*G4 + 0.10*G5   (doc 07 §6.3, quoted in §3.11). */
export const GROUP_WEIGHT: Readonly<Record<MetricGroup, number>> = Object.freeze({
  G1: 0.34, G2: 0.3, G3: 0.12, G4: 0.14, G5: 0.1,
});

/** Where the reference VALUE came from. Enforced by tests/eval/precedence.test.ts (§2.6). */
export type RefSource =
  | 'doc01' | 'doc02' | 'doc03' | 'doc04' | 'doc06' | 'doc07' | 'DERIVED_01_03' | 'PROJECT';

/**
 * §2.6, the rule that makes the scorecard honest, stated once:
 *
 *   For a reference VALUE, docs 01 / 03 / 02 win, in that order.
 *   For a TOLERANCE and a HARD-FAIL, doc 07 wins.
 *
 * The eight mandatory overrides below ship as a frozen table so `tests/eval/precedence.test.ts`
 * has a single source to check `METRICS` against, and so no fix agent can "improve the score"
 * by walking a reference back toward doc 07's seed. Doc 07's TOLERANCES stay exactly as given.
 *
 * §3.11 does not declare this table; it is added here because §2.6 makes it normative and
 * leaving it loose in B9 is precisely the drift the rule exists to prevent. Recorded as an
 * addition.
 */
export const REF_VALUE_PRECEDENCE: readonly RefSource[] = Object.freeze([
  'doc01', 'doc03', 'doc02',
]);

export interface RefOverride {
  readonly metric: MetricId;
  readonly doc07Seed: number;
  readonly ships: number;
  readonly refSource: RefSource;
  readonly source: string;
  readonly why: string;
}

export const MANDATORY_REF_OVERRIDES: readonly RefOverride[] = Object.freeze([
  {
    metric: 'stance_len_H', doc07Seed: 0.45, ships: 0.533, refSource: 'doc01',
    source: 'ZENKUTSU_HEEL_TO_HEEL_H, docs/research/01-stances.md §3.1 + §10',
    why: '07 midpoints two worded sources; 01 derives it. Metric 1 datum is heel-to-heel, so 0.540 (ankle) is also wrong — §2.3.',
  },
  {
    metric: 'stance_width_H', doc07Seed: 0.14, ships: 0.17, refSource: 'doc01',
    source: 'docs/research/01-stances.md §10 ZENKUTSU.W',
    why: '07 §7.1 admits its own 0.14 conflicts with every worded source.',
  },
  {
    metric: 'front_knee_flex_deg', doc07Seed: 45, ships: 57, refSource: 'doc01',
    source: 'docs/research/01-stances.md §3.2 / §10 kneeFront',
    why: '01 derives it by 2-link sagittal IK at PELVIS_Y = 0.410 H.',
  },
  {
    metric: 'rear_knee_flex_deg', doc07Seed: 8, ships: 10, refSource: 'doc01',
    source: 'docs/research/01-stances.md §10 kneeRear',
    why: 'Same derivation as front_knee_flex_deg.',
  },
  {
    metric: 'hip_height_H', doc07Seed: 0.47, ships: 0.41, refSource: 'doc01',
    source: 'docs/research/01-stances.md §2 / §10 FIGHT_PELVIS_Y',
    why: "07 derives from a 0.060 H drop; 01's drop is 0.120 H. 01's own lookup labels 0.470 moto-dachi (kumite) and 0.440 'too high — FAIL for kihon'.",
  },
  {
    metric: 'weight_front_pct', doc07Seed: 62, ships: 59, refSource: 'doc01',
    source: 'docs/research/01-stances.md §3.6 / §10 loadFront',
    why: '01 resolves it geometrically at S = 0.540 H (dispute D01).',
  },
  {
    metric: 'rear_foot_yaw_deg', doc07Seed: 25, ships: 30, refSource: 'doc01',
    source: 'docs/research/01-stances.md §10 yawRear',
    why: '01 §3.5 ankle-ROM argument (dispute D05).',
  },
  {
    metric: 'age_uke_forearm_angle_deg', doc07Seed: 45, ships: 25, refSource: 'doc03',
    source: 'docs/research/03-techniques-upper.md §14.1',
    why: '45 deg puts the wrist at 1.036 H, above the vertex (dispute D03).',
  },
  {
    metric: 'shuto_uke_elbow_flex_deg', doc07Seed: 90, ships: 121, refSource: 'doc03',
    source: 'docs/research/03-techniques-upper.md §13 (59 deg INCLUDED) + §9.1 correction',
    why: "03 §13's column is the INCLUDED angle; flex = 180 - included = 121 (dispute D04).",
  },
]);

/**
 * The five metrics whose authoritative source is a GH-relative offset in doc 03 §13 (§2.6).
 * Their references are computed once, offline, in Phase 1, written into the ref bank as a
 * literal with `refSource: 'DERIVED_01_03'` and a mandatory `derivation` string, and
 * `tests/eval/derivedRefs.test.ts` recomputes them.
 */
export const DERIVED_01_03_METRICS: readonly MetricId[] = Object.freeze([
  'active_fist_H',        // metric 18
  'gedan_barai_fist_H',   // metric 30
  'age_uke_wrist_H',      // metric 33
  'shuto_uke_hand_H',     // metric 36
  'tettsui_uchi_fist_H',  // metric 39
]);

/** The critic -> fix mapping. This is the whole point of the architecture. */
export interface FixSite {
  readonly file: string;      // 'src/data/constants/stances.ts'
  readonly symbol: string;    // 'ZENKUTSU.S'
  /** A dotted path an agent can edit without reading the file first. */
  readonly knob: string;      // 'ZENKUTSU.S.v'
  readonly kind: 'constant' | 'move-override' | 'move-patch' | 'technique-keyframe'
               | 'channel-dynamics' | 'solver' | 'rig' | 'cloth' | 'render' | 'eval' | 'frozen';
  readonly block: BlockId;
  readonly hint: string;      // '+0.001 H in S ~ +0.19 % stance_len_H'
}

export interface MetricSpec {
  readonly id: MetricId;
  readonly group: MetricGroup;
  readonly unit: Unit;
  readonly ref: number;
  readonly refSource: RefSource;
  /** REQUIRED when refSource === 'DERIVED_01_03'. The arithmetic, as text. */
  readonly derivation?: string;
  readonly tol: number;               // from doc 07. |d| <= tol -> 100
  readonly hardFail: number;          // from doc 07. |d| >= hardFail -> 0
  readonly bound: 'both' | 'upperOnly' | 'lowerOnly';
  /** Per-stance / per-level / per-kata reference overrides. doc 07 §6.2 alternate table. */
  readonly refByStance?: Readonly<Partial<Record<StanceId, { ref: number; tol: number; hardFail: number }>>>;
  readonly refByLevel?: Readonly<Partial<Record<Level, { ref: number; tol: number; hardFail: number }>>>;
  readonly refByKata?: Readonly<Partial<Record<KataId, { ref: number; tol: number; hardFail: number }>>>;
  readonly fatal: boolean;
  /**
   * FALSE means: score and report, but NEVER fail a gate. Used for metrics whose threshold is
   * admittedly invented until calibrated (metric 60 - doc 07 uncertainty 12). Flipping this to
   * true is an integrator commit that must cite the calibration report.
   */
  readonly armed: boolean;
  readonly weight: number;            // within-group, default 1
  readonly appliesTo: (m: KataMove) => boolean;
  readonly source: string;            // 'docs/research/07-reference-and-datasets.md §6.2 G1#1'
  readonly fixSite: FixSite;
  /** doc 07 §6.8 rubric ids this metric backs, e.g. ['A6']. */
  readonly rubric: readonly string[];
}

export interface MetricResult {
  readonly id: MetricId;
  readonly moveN: number;
  readonly tick: number;
  readonly camera: CameraPresetId | null;
  readonly value: number;
  readonly ref: number;
  readonly delta: number;             // signed, value - ref
  readonly deltaPct: number;          // signed % of ref
  readonly score: number;             // 0..100, doc 07 §6.3 verbatim
  readonly verdict: Verdict;
  readonly armed: boolean;
  readonly fixSite: FixSite;
  readonly source: string;
  /** 'ZENKUTSU.S = 0.540 H +-0.040 [DERIVED] docs/research/01-stances.md §3.1' */
  readonly provenance: string;
}

/** doc 01 §9 (Z/K/B/Y/X families) and doc 03 §11 (F family) as executable predicates. */
export interface CriticFinding {
  readonly tier: 'A' | 'B' | 'C';
  /** 'Z3' | 'X3' | 'F8' | 'A9' | a MetricId */
  readonly id: string;
  readonly moveN: number;
  readonly tick: number;
  readonly tSec: number;
  readonly camera: CameraPresetId | null;
  readonly observation: string;
  readonly suggestedFix: string;
  readonly fixSites: readonly FixSite[];    // most likely first
  readonly evidence: readonly string[];     // capture paths, relative to captures/<sha>/
  readonly source: 'metric' | 'fault' | 'vlm' | 'human';
}

export interface StepScore {
  readonly moveN: number;
  readonly label: string;
  readonly stance: StanceId;
  readonly tech: TechniqueId;
  readonly tick: number;
  readonly tSec: number;
  readonly groups: Readonly<Record<MetricGroup, number>>;
  /** 0.34*G1 + 0.30*G2 + 0.12*G3 + 0.14*G4 + 0.10*G5   (doc 07 §6.3) */
  readonly score: number;
  readonly metrics: readonly MetricResult[];
  readonly faults: readonly CriticFinding[];
}

export interface FixQueueEntry {
  readonly fixSite: FixSite;
  readonly worst: MetricResult | null;
  readonly finding: CriticFinding | null;
  readonly affectedMoves: readonly number[];
  /**
   * Signed nudge in the CONSTANT'S OWN unit, or null when the sign is not determinable.
   * MUST be null whenever the metric's refSource is 'doc07' and an override exists (§2.6) -
   * a delta that walks the rig away from docs 01/03 raises the score and lowers the quality.
   */
  readonly suggestedDelta: number | null;
  readonly rank: number;
}

export interface Scorecard {
  readonly schema: 'kata-scorecard/3';
  readonly kataId: KataId;
  readonly tempoTier: TempoTier;
  readonly gitSha: string;
  readonly trackHash: string;
  readonly contractHash: string;
  readonly threeRevision: string;      // '185'
  readonly generatedAt: string;
  readonly captureProfile: 'none' | 'fast' | 'hero';
  /** Recorded so a scorecard taken with non-default layer weights is never mistaken for release. */
  readonly layerWeights: Readonly<Record<LayerId, number>>;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly score: number;              // mean(StepScore.score)
  readonly steps: readonly StepScore[];
  readonly findings: readonly CriticFinding[];
  readonly channelC: {
    readonly mpjpe2dH: number; readonly pckH: number;
    readonly limbAngleMaeDeg: number; readonly matched: number;
  } | null;
  readonly gates: Readonly<Record<GateId, { readonly pass: boolean; readonly detail: string }>>;
  readonly bake: BakeStats;
  readonly determinism: { readonly seeksChecked: number; readonly mismatches: number };
  readonly perf: {
    readonly sampleUs: number; readonly frameMsP50: number;
    readonly frameMsP95: number; readonly frameMsP99: number;
    readonly drawCalls: number; readonly tris: number;
  } | null;
  readonly fixQueue: readonly FixQueueEntry[];      // worst-first, deduped by fixSite.file, <= 20
  readonly regression: {
    readonly baseSha: string;
    readonly deltas: readonly { id: MetricId; moveN: number; scoreDelta: number }[];
  } | null;
  readonly pass: boolean;
}

/* ── Gate thresholds, §7.5, so B9 cannot re-invent them. ──────────────────────── */

export const GATE_THRESHOLDS = Object.freeze({
  /** G-1 */ kataScoreMin: 85,
  /** G-3 */ stepScoreMin: 70,
  /** G-4 */ g1PerStepMin: 80,
  /** G-4 */ g2PerStepMin: 80,
  /** G-5 */ channelCPckMin: 0.85,
  /** G-5 */ channelCMatchedMin: 6,
  /** G-7 */ determinismMismatchesMax: 0,
  /** G-8 */ ikResidualMaxM: 0.005,
  /** G-11 */ requiredTempoTiers: ['T1', 'T2'] as readonly TempoTier[],
  /** §7.5: any metric regressing more than this against --baseline fails CI. */
  regressionMaxDrop: 5,
});
