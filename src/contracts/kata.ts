/**
 * B0 CONTRACTS — `src/contracts/kata.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.6 (the authoring DSL), §3.7 (the per-move patch, THE escape
 * hatch) and §3.8 (stance / technique / dynamics specs), verbatim.
 *
 * Every embusen coordinate here is in the AUTHORED (doc-02) frame and every embusen datum is
 * the ankle joint centre projected to the floor (§2.3, `EMBUSEN_DATUM`). The single world
 * conversion lives in `src/solve/frame.ts` (§2.1).
 */

import type { BoneName } from './bones';
import type { Num } from './num';
import type { TempoTierId } from './time';
import type { Equals, Expect, Handedness, IsNever, UnitRuleViolations } from './units';

export type StanceId =
  | 'heisoku' | 'musubi' | 'heiko' | 'hachiji'
  | 'zenkutsu' | 'zenkutsu-ashi' | 'han-zenkutsu' | 'kokutsu' | 'kiba' | 'moto';

export type TechniqueId =
  | 'none' | 'gedan-barai' | 'age-uke' | 'soto-uke' | 'uchi-uke' | 'shuto-uke'
  | 'choku-zuki' | 'oi-zuki' | 'gyaku-zuki' | 'tettsui-tate-mawashi';

export type Level = 'jodan' | 'chudan' | 'gedan';
export type HipFacing = 'shomen' | 'hanmi' | 'gyaku-hanmi';
export type HikiteForm = 'HIP-A' | 'TATE-B' | 'NONE';
export type HandShape = 'seiken' | 'shuto' | 'open' | 'nukite';
/** doc 02 §3.1 footfall rules. R0 is Heian move 4's retract-return. */
export type PivotRule = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type PivotKind = 'BALL' | 'HEEL' | 'WHOLE_FOOT' | 'NONE';
/** doc 02 §8 simultaneity rules. */
export type SimRule = 'S1' | 'S2' | 'S3';
/** doc 02 §1.4 tempo classes. */
export type TempoClass = 'M1' | 'N' | 'F' | 'T90' | 'T135' | 'T180' | 'T270' | 'D45';
/** doc 04 §6.3 pause classes. */
export type PauseClass = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
/** doc 04 §6.2. tempoScale multiplies T_prep and T_hold ONLY - never T_tech/T_thrust/T_kime. */
export type TempoTier = 'T0' | 'T1' | 'T2' | 'T3';

/**
 * The T0..T3 scale table itself lives in `time.ts` (`TEMPO_SCALE`) so the tempo table has one
 * home and no barrel ambiguity; §3.6 declares the symbol here. This assertion is the proof
 * that the two never drift: it fails to compile if the key sets differ.
 */
export type AuditTempoTier = Expect<Equals<TempoTier, TempoTierId>>;

/** Embusen coordinate. Units of L. AJC projected to the floor (§2.3). AUTHORED (doc-02) frame. */
export type EmbXZ = readonly [x: number, z: number];

export interface TechniqueRef {
  readonly id: TechniqueId;
  readonly arm: Handedness;
  readonly level: Level;
  /** Target height, FracH (doc 02 §1.2). Redundant with `level`; asserted at validate. */
  readonly targetH: number;
  readonly hand: HandShape;
  /** Named variant key into TECHNIQUES, e.g. 'tate'. */
  readonly variant?: string;
}

export interface KataMove {
  readonly n: number;                  // 1-based count
  readonly label: string;              // 'hidari gedan-barai'
  readonly labelJp: string;            // 左下段払い
  readonly labelEn: string;            // 'left downward block'
  /** Signed deg. + = to the character's LEFT. AUTHORED frame (doc 02 §1). */
  readonly dHeadingDeg: number;
  /** Resulting absolute heading, 0..360, AUTHORED frame. ASSERTED against the dH chain. */
  readonly headingDeg: number;
  readonly rule: PivotRule;
  readonly pivot: Handedness | null;   // planted foot; zero translation for the whole move
  readonly pivotKind: PivotKind;
  readonly mover: Handedness;
  readonly stance: StanceId;
  readonly front: Handedness;
  readonly weighted: Handedness;       // === front for zenkutsu, rear for kokutsu
  readonly hips: HipFacing;
  readonly tech: TechniqueRef;
  readonly hikite: HikiteForm;
  readonly kiai: boolean;
  readonly tempo: TempoClass;
  readonly pause: PauseClass;
  readonly sim: SimRule;
  /** t_slot at T1: previous kime -> this kime, seconds. doc 02 §1.4 / §4.1 / §6.1. */
  readonly tSlotS: number;
  /** Authored embusen, units of L, AJC datum. RECOMPUTED from pivot + Lk*f(H) and ASSERTED. */
  readonly embusen: { readonly ff: EmbXZ; readonly rf: EmbXZ; readonly c: EmbXZ };
  readonly notes?: string;
  /** Exact doc anchor for this row, e.g. '02-kata-sequences.md §4.1 row 4'. */
  readonly src: string;
}

export interface CeremonyPhase {
  readonly id: 'REI_IN' | 'ANNOUNCE' | 'YOI' | 'SET'
             | 'FINAL_HOLD' | 'YAME' | 'SETTLE' | 'ATTENTION' | 'REI_OUT';
  readonly stance: StanceId;
  readonly durationS: number;          // at T1
  readonly trunkPitchDeg?: number;
  readonly params?: Readonly<Record<string, number>>;
}

export type KataId = 'taikyoku-shodan' | 'heian-shodan';

export interface KataScore {
  readonly schema: 'kata-score/1';
  readonly id: KataId;
  readonly displayName: string;
  readonly displayNameJp: string;
  readonly moveCount: number;                  // asserted === moves.length
  readonly kiaiAt: readonly number[];          // asserted === moves.filter(kiai).map(n)
  readonly fastPairs: readonly (readonly [number, number])[];
  readonly openingCeremony: readonly CeremonyPhase[];
  readonly moves: readonly KataMove[];
  readonly closingCeremony: readonly CeremonyPhase[];
  /** Moves-only nominal seconds at T1: 35.25 / 39.75. Asserted within 20 %. */
  readonly totalMoveSecondsT1: number;
  readonly provenance: readonly string[];
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * §3.7 — the per-move patch, THE escape hatch
 *
 * One file per move: `src/data/patches/<kataId>/move-NN.ts`. All 41 files exist from Phase 0,
 * each exporting an empty patch. Two agents fixing two different moves never touch the same
 * file — that is what makes N parallel fix agents safe (§9.1 A-9).
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** A scalar override on a global constant, scoped to ONE move. */
export interface MoveOverride {
  readonly stance?: Partial<Record<
    'S' | 'W' | 'pelvisY' | 'kneeFront' | 'kneeRear' | 'yawFront' | 'yawRear'
    | 'loadFront' | 'pelvisTiltPost' | 'pelvisYawHanmi' | 'torsoPitch', number>>;
  readonly tech?: Partial<Record<
    'dx' | 'dy' | 'dz' | 'elbowDeg' | 'rollDeg' | 'rollStartPct' | 'rollEndPct'
    | 'poleYawDeg' | 'maxLateralDevH', number>>;
  readonly hikite?: Partial<Record<'dx' | 'dy' | 'dz' | 'leadMs', number>>;
  readonly timing?: Partial<Record<
    'tSlotS' | 'tTechS' | 'tThrustS' | 'tKimeS' | 'tHoldS' | 'tPrepS', number>>;
  /** `recoilFracL` is a fraction of the END-EFFECTOR PATH LENGTH, not of `L_M` — `C17`. */
  readonly dynamics?: Partial<Record<
    'dPsiDeg' | 'omegaPsiDegS' | 'tauP' | 'recoilFracL', number>>;
  /** Per-channel lead override, ms before arrival. doc 04 §11. */
  readonly channelLeadMs?: Partial<Record<ChannelId, number>>;
  /** doc 02 §6.2 Heian move 4: front foot slides back deltaL at atTau, returns by kime. */
  readonly footExcursion?: {
    readonly foot: Handedness;
    readonly atTau: number;        // 0..1 within the move, peak of the excursion
    readonly deltaL: number;       // signed, units of L, along -f(H)
    readonly torsoRiseH: number;   // FracH, transient pelvis rise during the retraction
  };
}

/**
 * A per-bone, per-tick corrective quaternion delta. This is the landing site for
 * "the left clavicle is shrugged at step 18 only" - a scoped fix, not a global solver edit.
 * Baked into LayerTrack 'patch', which ships at weight 1.0 but is EMPTY by default.
 */
export interface PatchKey {
  readonly bone: BoneName;
  /** Fraction of the move's [start, holdEnd] window, 0..1. Resolved to an exact tick at compile. */
  readonly atTau: number;
  /** Local-space delta, degrees, applied about the named axis in the bone's own frame. */
  readonly axis: 'x' | 'y' | 'z';
  readonly deltaDeg: number;
  /** Half-width of the raised-cosine window over which the delta ramps in and out, seconds. */
  readonly widthS: number;
}

export interface MovePatch {
  readonly kataId: KataId;
  readonly n: number;
  /** REQUIRED whenever anything below is non-empty. Printed in the scorecard. */
  readonly reason: string;
  /** The critic finding id this patch answers, e.g. 'B3' | 'shoulder_elevation_H'. */
  readonly finding: string | null;
  readonly override: MoveOverride;
  readonly patch: readonly PatchKey[];
}

/** Every move-NN.ts default-exports exactly this shape. Empty patch: reason '', finding null. */
export type MovePatchModule = { readonly default: MovePatch };

/** Move counts per kata. `PATCHES` must hold exactly this many files per kata (§4.2). */
export const MOVE_COUNT: Readonly<Record<KataId, number>> = Object.freeze({
  'taikyoku-shodan': 20,
  'heian-shodan': 21,
});
export const PATCH_FILE_COUNT = 41 as const;   // 20 + 21, §3.7

/* ═══════════════════════════════════════════════════════════════════════════════
 * §3.8 — stance / technique / dynamics specs
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** doc 01 §3-§7 + §10. Every field a Num. `pelvisY` is an INPUT to the leg solve, never an output. */
export interface StanceSpec {
  readonly id: StanceId;
  readonly S: Num;               // H, AJC<->AJC along the facing axis
  readonly W: Num;               // H, AJC<->AJC lateral
  readonly yawFront: Num;        // deg, AUTHORED frame, + = toed out toward char-left
  readonly yawRear: Num;         // deg, AUTHORED frame
  readonly pelvisY: Num;         // H, MIDHIP height. HARD CONSTRAINT of the leg solve.
  readonly kneeFront: Num;       // deg flexion (0 = straight)
  readonly kneeRear: Num;        // deg flexion
  readonly loadFront: Num;       // pct of body weight on the front foot
  readonly pelvisTiltPost: Num;  // deg, posterior tilt, + = pubis up
  readonly pelvisYawHanmi: Num;  // deg, AUTHORED frame
  readonly torsoPitch: Num;      // deg from vertical, + = forward
  readonly heelDownFront: boolean;
  readonly heelDownRear: boolean;
}

/** doc 03 §13 END table + §4-§10 keyframes. ALL offsets are GH-relative, FracH, TORSO-LOCAL. */
export interface TechniqueSpec {
  readonly id: TechniqueId;
  readonly level: Level;
  readonly refPoint: 'MCP2' | 'FIST_CENTRE' | 'WRIST' | 'FINGERTIP' | 'HAND_CENTRE';
  /** GH-relative offsets, FracH. dx is written WITHOUT the side factor; solver applies -s*dx. */
  readonly start: { readonly dx: Num; readonly dy: Num; readonly dz: Num };
  readonly mid:   { readonly dx: Num; readonly dy: Num; readonly dz: Num };
  readonly end:   { readonly dx: Num; readonly dy: Num; readonly dz: Num };
  readonly palmNormalStart: readonly [number, number, number];  // unit, torso-local
  readonly palmNormalEnd:   readonly [number, number, number];
  /** Total forearm roll across the stroke, deg, + = pronation. doc 03 §4.3. */
  readonly rollDeg: Num;
  /** Fraction of the stroke over which the roll happens, e.g. [0.65, 1.00]. */
  readonly rollWindow: readonly [number, number];
  /** doc 03 §13 "Elbow" column: the INCLUDED angle in deg. flex = 180 - included. Advisory. */
  readonly elbowIncludedDeg: Num;
  readonly leader: 'fist' | 'elbow';
  /** doc 06 §6.2 pole direction, chest-local unit vector. */
  readonly poleDirChest: readonly [number, number, number];
  readonly hand: HandShape;
  /** Path straightness budget, FracH. Metric 19 / 44 enforce it. */
  readonly maxLateralDevH: Num;
}

export type ChannelId =
  | 'rearFootDrive' | 'comTranslate' | 'pelvisYaw' | 'hikite'
  | 'thoraxYaw' | 'shoulderGirdle' | 'elbowExtend' | 'wristLock' | 'forearmRoll';

/**
 * FROZEN proximal -> distal order, doc 04 §11.
 *
 * Stage S6 asserts, ALONG THIS ORDER, doc 04 §11 invariant 1:
 * `lead(rearFootDrive) > lead(pelvisYaw) > lead(thoraxYaw) >= lead(shoulderGirdle) >
 *  lead(elbowExtend) > lead(wristLock) > 0`.
 * That holds strictly on doc 04 §11's shipped table: 280 > 260 > 245 > 205 > 187 > 186 > 88 > 80.
 *
 * *** tauP IS **NOT** MONOTONE ALONG THE WHOLE OF `CHANNEL_ORDER`. *** doc 04 §11's own table is
 * `0.30, 0.45, 0.42, 0.70, 0.55, 0.65, 0.60, 0.50` in this order, which falls at FOUR of eight
 * steps (0.45->0.42, 0.70->0.55, 0.65->0.60, 0.60->0.50). Asserting pointwise monotonicity here
 * would throw on every move and `compileKata` would never return. doc 04 §11 invariant 2
 * ("`tauP` monotonically non-decreasing from proximal to distal, 0.30 -> 0.73") describes the
 * SPAN from the most proximal channel to the END-EFFECTOR `tauP` of §10, not a pointwise order,
 * and §2.6 makes the doc's own table win over its own prose.
 *
 * S6 therefore asserts three things instead, all true of doc 04 §11/§10 verbatim:
 *   1. leads strictly descending along `CHANNEL_ORDER` (invariant 1, above);
 *   2. `tauP` monotone non-decreasing along `TAUP_MONOTONE_CHAIN` (0.30 -> 0.42 -> 0.55 -> 0.65);
 *   3. `min(tauP over CHANNEL_DYN) === CHANNEL_DYN.rearFootDrive.tauP` and the distal end of the
 *      span is `TechniqueDynamics.tauP` (0.73 for gyaku-zuki chudan), which closes invariant 2's
 *      actual "0.30 -> 0.73".
 */
export const CHANNEL_ORDER: readonly ChannelId[] = Object.freeze([
  'rearFootDrive', 'comTranslate', 'pelvisYaw', 'hikite',
  'thoraxYaw', 'shoulderGirdle', 'elbowExtend', 'wristLock', 'forearmRoll',
]);

/**
 * The subset of `CHANNEL_ORDER` over which doc 04 §11 invariant 2's `tauP` monotonicity actually
 * holds — the striking chain measured on ONE time base (`T_tech`). ONE machine-readable source,
 * so S6 and `tests/contracts/tickrate.test.ts` cannot ship two different orders.
 *
 * The four exclusions, each for a stated reason:
 *   - `elbowExtend` (0.60) and `wristLock` (0.50) carry doc 04 §11's own comment
 *     "tauP measured inside Tthrust" — a DIFFERENT, shorter time base, so their fractions are not
 *     comparable with the `T_tech` ones.
 *   - `comTranslate` (0.45) and `hikite` (0.70) are off the striking chain entirely: one is whole-
 *     body translation, the other the opposite arm.
 *   - `forearmRoll` has no row in doc 04 §11 at all; it is authored from doc 03 §4.3's roll curve.
 */
export const TAUP_MONOTONE_CHAIN: readonly ChannelId[] = Object.freeze([
  'rearFootDrive', 'pelvisYaw', 'thoraxYaw', 'shoulderGirdle',
]);
/** doc 04 §11 invariant 2's span: the proximal end. The distal end is `TechniqueDynamics.tauP`. */
export const TAUP_SPAN_PROXIMAL_CHANNEL: ChannelId = 'rearFootDrive';

/** doc 04 §11. lead is ms BEFORE arrival, at Ttech = 0.340 s; scaled by Ttech/0.340. */
export interface ChannelDyn { readonly tauP: Num; readonly leadMs: Num; }

/** The reference `T_tech` every `leadMs` in doc 04 §11 is quoted against. */
export const CHANNEL_LEAD_REF_TTECH_S = 0.34 as const;

/** doc 04 §10, one row per technique class. */
export interface TechniqueDynamics {
  readonly key: string;                 // 'oi-zuki-chudan-step'
  readonly TtechS: Num;
  readonly TthrustS: Num;
  readonly TkimeS: Num;
  readonly dPsiDeg: Num;                // magnitude; sign resolved from stance side
  readonly omegaPsiDegS: Num;
  readonly tauP: Num;                   // end-effector
  /**
   * doc 04 §10 `v_pk`, a SPEED in metres per second — 4.0–7.4 m/s. The `Ms` in the field name is
   * §3.8 verbatim and collides with §2.2's suffix table, where `Ms` means MILLISECONDS. The `Num`
   * carries the truth: `unit` MUST be `'m/s'` (§2.2 case b, `num.ts` C17 note). Never `'ms'`.
   */
  readonly vPkMs: Num;
  /**
   * doc 04 §10 recoil, "fraction of `L`" — where `L` is doc 04 §0's END-EFFECTOR PATH LENGTH
   * (~0.50 m for a chudan zuki; doc 04 §5.1's own `0.012–0.020 L = 6–10 mm` pins the scale), NOT
   * the embusen step unit `L_M = 0.945 m` of §2.3. Multiply by the technique's own path length.
   * Scaling by `L_M` makes the gyaku-zuki recoil 15.1 mm instead of 8.0 mm and turns doc 04's
   * hard ceiling ("do not exceed 0.020 L — reads as a punch being pulled, and in kata judging
   * terms as an incomplete technique") into 18.9 mm. There is no recoil metric in the 63.
   * Resolved as `C17` in `units.ts`.
   */
  readonly recoilFracL: Num;
  readonly channels: Readonly<Record<ChannelId, ChannelDyn>>;
}

/**
 * doc 06 §3.2's swing-twist clamp arguments, verbatim: an ELLIPTIC SWING CONE plus a SIGNED twist
 * range. Angles deg, bone-local (and the axis is `PRIMARY_AXIS`, which must be converted first —
 * see `bones.ts`).
 *
 * *** THIS IS THE SYMMETRIC ENVELOPE ONLY, AND THAT IS DELIBERATE. *** doc 06 §3.2's
 * `ellipticConeLimit(dir, ellipseXZ)` takes per-axis HALF-ANGLES `(bx, bz)` and is symmetric about
 * the primary axis by construction, so most of doc 06 §3.1's table — hip flex/ext +125/-25,
 * shoulder flex/ext +175/-55, shoulder abd/add +170/-38, knee 0/-140 ("hyperextension hard-locked
 * at 0"), elbow +3/-152, ankle +24/-55 — is NOT representable here. Only the twist axis gets a
 * signed min/max. The shape is doc 06 §3.2's own normative signature AND §3.8 verbatim, so it
 * stays; what must not happen is anyone reading S12's "every bone inside ROM" as enforcing the
 * signed limits.
 *
 * Where the signed limits live instead:
 *   - MID joints (knee, elbow): `TwoBoneArgs.midMinDeg / midMaxDeg` (§3.4.1), which ARE signed and
 *     which doc 06 §6.1 folds into IK step 2 rather than post-clamping.
 *   - A joints (hip, shoulder): no signed limit exists in any frozen type. B3 owns an explicit,
 *     NAMED per-bone sign gate in `src/solve/swingTwist.ts` with its own test. Without it,
 *     `swingConeXDeg = 175` on the shoulder admits 175° of EXTENSION and `swingConeZDeg = 170`
 *     admits 170° of ADDUCTION, both anatomically impossible and both invisible to the scorecard.
 *   - B1 authors the cone semi-axes as the ANATOMICALLY REACHABLE half-angle (the smaller of the
 *     two signed limits), not the larger, so the envelope errs tight.
 */
export interface RomLimit {
  readonly swingConeXDeg: number;   // elliptic cone semi-axis about the local X plane
  readonly swingConeZDeg: number;
  readonly twistMinDeg: number;
  readonly twistMaxDeg: number;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * §2.2 UNIT-RULE AUDITS. Each exemption is a dimensionless field (an index, a count, a
 * 0..1 fraction) and is named explicitly so it is visible in review. A new bare-number
 * field without a suffix breaks the build here.
 * ═══════════════════════════════════════════════════════════════════════════════ */

export type AuditTechniqueRef = Expect<IsNever<UnitRuleViolations<TechniqueRef>>>;
export type AuditCeremonyPhase = Expect<IsNever<UnitRuleViolations<CeremonyPhase>>>;
export type AuditStanceSpec = Expect<IsNever<UnitRuleViolations<StanceSpec>>>;
export type AuditTechniqueSpec = Expect<IsNever<UnitRuleViolations<TechniqueSpec>>>;
export type AuditTechniqueDynamics = Expect<IsNever<UnitRuleViolations<TechniqueDynamics>>>;
export type AuditChannelDyn = Expect<IsNever<UnitRuleViolations<ChannelDyn>>>;
export type AuditRomLimit = Expect<IsNever<UnitRuleViolations<RomLimit>>>;
/** `n` is a 1-based move index, not a measurement. */
export type AuditKataMove = Expect<IsNever<UnitRuleViolations<KataMove, 'n'>>>;
/** `moveCount` is a count; `totalMoveSecondsT1` carries its unit mid-name plus the tier label. */
export type AuditKataScore =
  Expect<IsNever<UnitRuleViolations<KataScore, 'moveCount' | 'totalMoveSecondsT1'>>>;
/** `atTau` is a 0..1 fraction of the move window (§3.7). */
export type AuditPatchKey = Expect<IsNever<UnitRuleViolations<PatchKey, 'atTau'>>>;
/** `n` is a 1-based move index. */
export type AuditMovePatch = Expect<IsNever<UnitRuleViolations<MovePatch, 'n'>>>;
