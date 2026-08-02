/**
 * B0 CONTRACTS — `src/contracts/units.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.1 verbatim, plus §2.1 (world frame / handedness),
 * §2.2 (the unit-suffix rule, expressed as enforceable types) and §2.5 (the resolved
 * cross-doc conflicts, as named constants so no later agent re-litigates them).
 *
 * ZERO IMPORTS, by contract: this file is read by the compiler (B3) *and* the metrics
 * module (B9); a hidden import would couple the two.
 */

/** Reference body height. Every FracH value multiplies by this to become metres. */
export const H = 1.75 as const;            // m
export const H_CM = 175 as const;          // cm
export const DEG = Math.PI / 180;          // deg -> rad
export const RAD = 180 / Math.PI;          // rad -> deg
export const GRAVITY = -9.81 as const;     // m/s^2, world Y

/**
 * +1 would mean authored +X === world +X. Doc 07 §0.1 proves the authored frame is left-handed,
 * so authored LEFT (+X) must become world -X. This is the ONLY place the flip lives.
 */
export const SIDE_SIGN = -1 as const;

/* ────────────────────────────────────────────────────────────────────────────────
 * §2.1 WORLD FRAME — decided once, never re-litigated.
 *
 * up                        = +Y
 * character facing at yoi   = -Z
 * world +X                  = the character's RIGHT
 * world -X                  = the character's LEFT
 * embusen plane             = XZ, floor at y = 0 exactly
 * heading H                 = degrees; H = 0 at yoi; H increases when the character
 *                             turns to their own LEFT
 * authored facing vector    = f_auth(H) = ( sin H, 0, -cos H)   AUTHORING SPACE ONLY
 * world facing vector       = f(H)      = (-sin H, 0, -cos H)
 * three.js root yaw         = root.rotation.y = +H * DEG (rad)
 *
 * Docs 01/02/03/04/06 label +X as the character's LEFT. Exactly one conversion exists,
 * in `src/solve/frame.ts`; it negates every authored x and every authored yaw magnitude.
 * NOTHING ELSE IN THE CODEBASE MAY NEGATE AN X OR A YAW — grepped by
 * `tools/verify-contracts.mjs`.
 * ──────────────────────────────────────────────────────────────────────────────── */

/** Authored (doc-02) facing basis. Kept here so the two forms can never drift apart. */
export const facingAuthored = (headingDeg: number): readonly [number, number, number] => [
  Math.sin(headingDeg * DEG),
  0,
  -Math.cos(headingDeg * DEG),
];

/**
 * WORLD facing basis, §2.1's `f(H) = (-sin H, 0, -cos H)` verbatim. The two forms live side by
 * side so the x-flip between them is visible in one screen rather than inferred.
 *
 * This is a HEADING -> BASIS helper, not a point transform: converting an authored point or
 * offset is still `toWorld` in `src/solve/frame.ts`, which stays the only such conversion (§2.1,
 * ban `SECOND_FRAME_CONVERSION`).
 */
export const facingWorld = (headingDeg: number): readonly [number, number, number] => [
  -Math.sin(headingDeg * DEG),
  0,
  -Math.cos(headingDeg * DEG),
];

/* ────────────────────────────────────────────────────────────────────────────────
 * THE YAW ARITHMETIC, WRITTEN OUT — because §2.1's prose ("negates every authored x
 * and every authored yaw MAGNITUDE") is read by three different blocks and the naive
 * reading of it inverts the whole kata (rubric A10).
 *
 * three.js applies `rotation.y = beta` as the right-handed R_y(beta), so
 *     R_y(beta) * (0,0,-1) = (-sin beta, 0, -cos beta).
 * With `beta = H * DEG` that is EXACTLY `facingWorld(H)`. Therefore:
 *
 *   toWorldYawDeg(headingDeg) === headingDeg          THE IDENTITY. Not a negation.
 *
 * Why that is consistent with "negate the authored yaw magnitude": in the AUTHORED frame
 * `facingAuthored(H) = (sin H, 0, -cos H)` is produced by an authored rotation of MINUS H
 * (R_y(-H)*(0,0,-1) = (sin H, 0, -cos H)). The world conversion negates it, giving +H.
 * The stored FIELD VALUE therefore passes through unchanged for any quantity whose authored
 * sign convention is already "+ = toward the character's own LEFT" — which is doc 02 §1's
 * heading convention and doc 01 §10's `yawFront`/`yawRear` convention ("+ = toed out toward
 * char-left"), because world char-left is `-X` and R_y(+k) rotates `-Z` toward `-X`.
 *
 * The quantities that DO flip sign are the ones authored with the OPPOSITE convention, the
 * clearest being doc 04 §0's pelvis yaw `psi` ("+ = the character's LEFT hip is advanced
 * toward the target", i.e. the pelvis normal turns toward char-RIGHT). `psi = +45` is an
 * authored rotation of +45 about +Y, so its world yaw is -45.
 *
 * B3's `src/solve/frame.ts` therefore needs TWO named converters, both in that one file:
 * `toWorldYawDeg` for headings (identity) and a separately named helper for authored psi-class
 * yaws (negation). Pinned by `tests/contracts/handedness.test.ts`.
 * ──────────────────────────────────────────────────────────────────────────────── */

/** `toWorldYawDeg` is the identity on doc-02 headings. See the derivation above. */
export const WORLD_YAW_OF_HEADING_SIGN = 1 as const;
/** doc 04 §0 `psi`-class authored yaws (+ = left hip advanced) DO flip. */
export const WORLD_YAW_OF_PSI_SIGN = -1 as const;

/* ── Branded scalars. A bare number is never accepted where one of these is declared. ── */

export type FracH = number & { readonly __fracH: unique symbol };
export type Metres = number & { readonly __m: unique symbol };
export type Deg = number & { readonly __deg: unique symbol };
export type Rad = number & { readonly __rad: unique symbol };
export type Sec = number & { readonly __s: unique symbol };
export type Tick = number & { readonly __tick: unique symbol };
/** §2.2: milliseconds. Event timings under 20 ms are carried as integer ticks, not Ms. */
export type Ms = number & { readonly __ms: unique symbol };
/** §2.2: percentage, 0…100. */
export type Pct = number & { readonly __pct: unique symbol };
/** §2.2: speed normalised by height — `H` per second. */
export type Hps = number & { readonly __hps: unique symbol };

export const fracH = (n: number) => n as FracH;
export const metres = (n: number) => n as Metres;
export const deg = (n: number) => n as Deg;
export const rad = (n: number) => n as Rad;
export const sec = (n: number) => n as Sec;
export const tick = (n: number) => n as Tick;
export const ms = (n: number) => n as Ms;
export const pct = (n: number) => n as Pct;
export const hps = (n: number) => n as Hps;

/** FracH <-> metres. The only legal conversion. */
export const hToM = (v: FracH): Metres => (v * H) as Metres;
export const mToH = (v: Metres): FracH => (v / H) as FracH;

/** deg <-> rad. Every authored angle is degrees (§2.2). */
export const degToRad = (v: Deg): Rad => (v * DEG) as Rad;
export const radToDeg = (v: Rad): Deg => (v * RAD) as Deg;

export type Handedness = 'L' | 'R';
/** Multiplies every lateral (X) offset for a given limb side, in WORLD space. */
export const sideSign = (h: Handedness): -1 | 1 => (h === 'L' ? SIDE_SIGN : (-SIDE_SIGN as 1));
/** The opposite hand. `hikite` is always `other(tech.arm)`. */
export const otherHand = (h: Handedness): Handedness => (h === 'L' ? 'R' : 'L');

/* ────────────────────────────────────────────────────────────────────────────────
 * §2.2 THE UNIT RULE, AS ENFORCEABLE TYPES
 *
 * "Every numeric field name in a frozen interface either (a) ends in H, M, Deg, Rad,
 *  S, Ms, Pct, Hps, Ticks or Frac, or (b) is a `Num` carrying its own `unit`.
 *  There is no third case."
 *
 * `UnitRuleViolations<T, Exempt>` resolves to the union of T's bare-number field names
 * that carry no unit suffix and are not explicitly exempted. An interface is clean iff
 * that union is `never`. Every exemption must be spelled out at the call site, which is
 * what makes a dimensionless field (an index, a count, a 0..1 ratio) visible in review
 * instead of silently slipping through as an unlabelled measurement.
 *
 *   export type AuditStanceSpec = Expect<IsNever<UnitRuleViolations<StanceSpec>>>;
 * ──────────────────────────────────────────────────────────────────────────────── */

export type UnitSuffixed =
  | `${string}H`
  | `${string}M`
  | `${string}Deg`
  | `${string}Rad`
  | `${string}S`
  | `${string}Ms`
  | `${string}Pct`
  | `${string}Hps`
  | `${string}Ticks`
  | `${string}Frac`;

export type UnitRuleViolations<T, Exempt extends string = never> = {
  readonly [K in keyof T & string]: T[K] extends number | undefined
    ? K extends Exempt
      ? never
      : K extends UnitSuffixed
        ? never
        : K
    : never;
}[keyof T & string];

/** Compile-time assertion primitives. Used only in type position; erased at build. */
export type IsNever<T> = [T] extends [never] ? true : false;
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export type Expect<T extends true> = T;

/* ────────────────────────────────────────────────────────────────────────────────
 * §2.5 CROSS-DOC CONFLICTS — RESOLVED HERE, ONCE.
 *
 * Each constant below carries the resolution quoted from ARCHITECTURE §2.5 so that a
 * later agent cannot silently re-open the question by "just fixing the number".
 * The live ones also carry their `disputeId`; every disputed value ships as an `AltNum`
 * in B1 with a lil-gui A/B toggle (§2.5, `src/data/constants/DISPUTED.md`).
 * ──────────────────────────────────────────────────────────────────────────────── */

/**
 * C01. `+X` = LEFT (01/02/03/04/06) vs RIGHT (07 §0.1).
 * RESOLVED: "`+X` = RIGHT, `SIDE_SIGN = −1`" — see `SIDE_SIGN` above and §2.1.
 */
export const AUTHORED_X_IS = 'CHARACTER_LEFT' as const;
export const WORLD_PLUS_X_IS = 'CHARACTER_RIGHT' as const;

/**
 * C02. `L = 0.520 H` (02 §1.1) vs `S = 0.540 H` (01 §3.1).
 * RESOLVED: "`L = ZENKUTSU.S.v = 0.540 H`, derived" — 02 §1.1 mandates the rescale.
 * `L_RESOLVED_H` is the EXPECTED value only; `src/data/embusen.ts` DERIVES it from
 * `ZENKUTSU.S.v` and `tests/data/derived.test.ts` asserts the two agree.
 */
export const L_RESOLVED_H = 0.54 as const;
export const L_DERIVED_FROM = 'ZENKUTSU.S.v' as const;
export const EMBUSEN_RESCALE = 0.54 / 0.52; // 1.038462 — applied to every doc-02 coordinate

/**
 * C03. `h = 0.19 L` from `w = 0.385 L` (02) vs `HACHIJI.W = 0.259 H` (01).
 * RESOLVED: "`EMB_H = HACHIJI.W.v/2 = 0.1295 H`, derived" — closure and σ are relative.
 *
 * SCOPE OF THAT RESOLUTION (see C18). `EMB_H` is the DERIVED yoi/hachiji STANCE half-width.
 * It is NOT substituted back into doc 02's coordinate tables: those are authored verbatim at
 * doc 02 §1.1's own `h = 0.19 L`, and §2.1 assertion 3's literal `c(21) = (-0.544, -0.354) L`
 * pins that. `EMB_H = 0.1295 H = 0.23981 L` differs from `0.19 L` by `0.04981 L = 4.7 cm`, so
 * regenerating the tables from it would move every embusen x AND the σ axis. §2.5's own
 * justification — "closure and σ are relative" — is only true under this scoping.
 */
export const EMB_H_RESOLVED_H = 0.1295 as const;
export const EMB_H_DERIVED_FROM = 'HACHIJI.W.v / 2' as const;

/** doc 02 §1.1 `h = w/2`, units of L. AUTHORED VERBATIM; the coordinate tables are built from it. */
export const EMB_POLYLINE_H_L = 0.19 as const;
/**
 * doc 02 §3.2's 180°-rotational symmetry `σ(x,z) = (-0.38 - x, -4.00 - z)`, units of L.
 * The x constant is `-2 * EMB_POLYLINE_H_L`; the z constant is the bbox depth. ONE machine-readable
 * home, so `tests/data/embusen.test.ts` and `tests/contracts/handedness.test.ts` cannot drift.
 */
export const EMB_SIGMA_X_CONST_L = -0.38 as const;
export const EMB_SIGMA_Z_CONST_L = -4.0 as const;
export const embSigma = (x: number, z: number): readonly [number, number] => [
  EMB_SIGMA_X_CONST_L - x,
  EMB_SIGMA_Z_CONST_L - z,
];

/**
 * C04. Embusen datum: foot centre vs ankle.
 * RESOLVED: "AJC" (§2.3). Every embusen coordinate in doc 02 §4.2 / §6.2 is reinterpreted
 * as the ankle joint centre projected to the floor, so `L` and `ZENKUTSU.S` are the same
 * number by definition. Foot centre sits `FOOT_CENTRE_AHEAD_OF_AJC_H` ahead of AJC and is
 * used for foot GEOMETRY only, never for embusen.
 */
export const EMBUSEN_DATUM = 'AJC' as const;
export const FOOT_CENTRE_AHEAD_OF_AJC_H = 0.024 as const;

/**
 * C05. gi `sheen 1.0 / 0xffffff` (05 §11.1) vs `0.35 / 0xE8E4DA` (06 §7.9).
 * RESOLVED: "`sheen 0.45`, `sheenColor 0xE8E4DA`, `sheenRoughness 0.55`, dispute `D09`,
 * live slider" — 06 argues from Filament cloth data; 05's 1.0 is undefended. Only
 * Channel D settles it, so it ships as a live knob, not an argument.
 */
export const GI_SHEEN_FRAC = 0.45 as const;
export const GI_SHEEN_COLOR_HEX = 0xe8e4da as const;
export const GI_SHEEN_ROUGHNESS_FRAC = 0.55 as const;

/**
 * C06. gi `anisotropy 0.25` (06 §7.9) vs NO (05 §11).
 * RESOLVED: "`anisotropy 0.18` with an `itemSize = 4` analytic tangent" — 05's objection is
 * "needs a tangent attribute"; we generate the geometry, so we generate the tangent,
 * including the handedness `w` (§2.7).
 */
export const GI_ANISOTROPY_FRAC = 0.18 as const;
export const TANGENT_ITEM_SIZE = 4 as const;

/**
 * C07. zenkutsu weight 55 / 59 / 62 / 70 % front.
 * RESOLVED: "**59 %**, dispute `D01`; metric tol from 07 (`±8`)" — 01 §3.6 resolves it
 * geometrically at `S = 0.540 H`.
 */
export const ZENKUTSU_LOAD_FRONT_PCT = 59 as const;

/**
 * C08. age-uke forearm 25° vs 45°.
 * RESOLVED: "**25°**, dispute `D03`" — 03 §14.1: 45° puts the wrist at 1.036 H, above the vertex.
 */
export const AGE_UKE_FOREARM_DEG = 25 as const;

/**
 * C09. chudan-uke elbow 90° vs 62/63/59° included.
 * RESOLVED: "**03 §13's included angles**, dispute `D04`" — 90° is geometrically impossible
 * with de Leva segments plus the same sources' other constraints. `flex = 180 − included`.
 */
export const ELBOW_ANGLE_KIND = 'included' as const;
export const elbowFlexFromIncluded = (includedDeg: number): number => 180 - includedDeg;

/**
 * C10. hanmi 45° vs 90°.
 * RESOLVED: "**45°**, dispute `D06`" — 01 §11.6, 04 §12.1: JKA manual reading.
 */
export const HANMI_DEG = 45 as const;

/**
 * C11. rear-foot yaw 30° vs 45°.
 * RESOLVED: "**30°**, tol 20–45, dispute `D05`" — 01 §11.5.
 */
export const REAR_FOOT_YAW_DEG = 30 as const;

/**
 * C12. head bob: 01 §8.1 band `±0.008 H` vs 04 §7.3 `≤ 0.008 H` peak-to-peak.
 * RESOLVED: "`≤ 0.008 H` peak-to-peak is the authored clamp; `0.012 H` is the max; metric 17
 * ref `≤ 0.010` with tol `+0.010`" — 04 §7.3 is the tighter and later statement. Proposal C
 * shipped a `±0.008` *band* (0.016 p-p) and parked permanently in warn; we do not.
 */
export const HEAD_BOB_CLAMP_H = 0.008 as const;   // authored clamp, PEAK-TO-PEAK
export const HEAD_BOB_MAX_H = 0.012 as const;     // hard max, peak-to-peak
export const HEAD_BOB_METRIC_REF_H = 0.01 as const;
export const HEAD_BOB_METRIC_TOL_H = 0.01 as const;

/**
 * C13. stage AABB 5.5 × 4.0 m (05 §16 uncertainty 3).
 * RESOLVED: "**4.68 × 4.68 m** ⇒ Mode A `S_fixed = 3.51 m`; Mode B `S_fit = 0.75 H = 1.31 m`"
 * — 3.78 m embusen + 0.45 m limb envelope per side.
 */
export const STAGE_AABB_M = 4.68 as const;
export const SHADOW_S_FIXED_M = 3.51 as const;
export const SHADOW_S_FIT_H = 0.75 as const;

/**
 * C14. bone count 44 (06 §4.2).
 * RESOLVED: "**45**: add `ribcage`" (§2.5) — where 45 counts doc 06's own headline "44 core
 * bones" plus `ribcage`. Doc 06's tree also lists seven leaf terminators its headline
 * excludes, so FULLY EXPANDED the shipped count is **52** (§2.8, §3.4). `BONE_ORDER.length`
 * in `bones.ts` is the single authority; `BONE_COUNT === 52`.
 */
export const BONE_COUNT_DOC06_HEADLINE = 44 as const;
export const BONE_COUNT_DOC06_PLUS_RIBCAGE = 45 as const;
export const BONE_COUNT_FULLY_EXPANDED = 52 as const;

/* ────────────────────────────────────────────────────────────────────────────────
 * C15…C18 — four conflicts §2.5 does not enumerate but the freeze must still resolve,
 * each found by an adversarial audit of Phase 0 and each verified by arithmetic here.
 * ──────────────────────────────────────────────────────────────────────────────── */

/**
 * C15. heel-behind-AJC: doc 01 §1 `HEEL_BEHIND_ANKLE = 0.052 H [DERIVED: 0.34·FOOT_LEN]` vs
 * doc 06 §4.2/§6.3's rig heel landmark `+0.0415 H` (doc 06 §6.3 calls it, verbatim,
 * "heel-behind-AJC horizontal offset"). The two documents genuinely disagree: doc 06 splits a
 * 0.1505 H foot (0.109 toe + 0.0415 heel), doc 01 a 0.152 H foot (0.100 + 0.052).
 *
 * RESOLVED, by §2.6 precedence (docs 01/03/02 win on a reference VALUE):
 *   - metric 1's REFERENCE uses doc 01's 0.052. §2.3's derivation is
 *     `0.540 - 0.052·cos3° + 0.052·cos30° = 0.533105`, inside the ±5e-4 gate of
 *     `tests/data/derived.test.ts`. Substituting 0.0415 gives 0.534497 — off by 1.50e-3, 3×
 *     the tolerance — so `ZENKUTSU_HEEL_TO_HEEL_H` MUST be derived from 0.052.
 *   - the RIG's heel landmark keeps doc 06's 0.0415 (`HEEL_OFFSET_H` in `bones.ts`), because
 *     that is the number doc 06 §4.2's own chain closure `hypot(0.0010, 0.1505) = 0.1505` and
 *     doc 06 §6.3's ankle-height formula are both built from.
 * Consequence B9 must know: metric 1 MEASURES ≈0.5345 against a 0.533 reference, a systematic
 * -0.0014 H (-0.26 %) bias, well inside doc 07's ±0.05 tolerance but not zero.
 */
export const HEEL_BEHIND_ANKLE_DOC01_H = 0.052 as const;    // metric 1's reference input
export const HEEL_BEHIND_ANKLE_DOC06_H = 0.0415 as const;   // the rig landmark
export const ZENKUTSU_HEEL_TO_HEEL_REF_H = 0.533 as const;  // §2.6 override #1, from doc 01

/**
 * C16. Measurement-camera transforms: doc 07 §6.6's `CAM_LEFT (+3H, 0.5H, 0)` /
 * `CAM_RIGHT (-3H, 0.5H, 0)` are AUTHORED-frame numbers — doc 07 §0.1's own table sets
 * "character's LEFT = +X", and §0.1 is the very section that proves that frame is left-handed.
 * §3.4.1 declares `CameraPresetParams.posH` as "fraction of H, WORLD frame", and §5.7 quotes
 * doc 07 §6.6's literals into it unconverted.
 *
 * RESOLVED: `posH` is WORLD, so the x of every side camera flips. `M_LEFT` — the camera that
 * SEES the character's left side — sits at world `-3H`, because world `-X` is char-left (§2.1).
 * B1 authors `CAMERA_PRESET_PARAMS` from the constants below, never from §5.7's literals, and
 * therefore needs no handedness conversion of its own.
 */
export const M_FRONT_POS_H = [0, 0.5, +3] as const;   // on the yoi facing axis, looking -Z
export const M_LEFT_POS_H = [-3, 0.5, 0] as const;    // WORLD -X = char-left  (doc 07 wrote +3)
export const M_RIGHT_POS_H = [+3, 0.5, 0] as const;   // WORLD +X = char-right (doc 07 wrote -3)
export const M_TOP_POS_H = [0, 4, 0] as const;        // looking down, up = -Z
export const M_ORTHO_HEIGHT_H = 2.2 as const;
export const M_NEAR_H = 0.1 as const;
export const M_FAR_H = 10 as const;

/**
 * C17. The symbol `L` means two different things across the docs, and both reach frozen fields.
 *   - doc 04 §0: `L` = "path length travelled by the END EFFECTOR inside T_tech". Its own §5.1
 *     rows pin the scale: `0.012–0.020 L = 6–10 mm` and `0.004–0.008 L = 2–4 mm` both imply
 *     `L ≈ 0.500 m` for a chudan zuki (doc 03 §4.1 measures the straight path at 0.388 H
 *     = 0.679 m, so ≈0.5–0.7 m depending on the technique).
 *   - §2.3 / C02: `L` = the EMBUSEN STEP UNIT = `ZENKUTSU.S` = 0.540 H = 0.945 m.
 *
 * RESOLVED: `TechniqueDynamics.recoilFracL`, `MoveOverride.dynamics.recoilFracL` and B1's
 * `SETTLE[*].ampFracL` are fractions of the TECHNIQUE'S OWN end-effector path length (doc 04's
 * `L`). B3 multiplies them by that path length, NEVER by `L_M`. Scaling by `L_M` makes the
 * gyaku-zuki recoil 15.1 mm instead of 8.0 mm and turns doc 04 §5.1's hard ceiling ("do not
 * exceed 0.020 L — reads as a punch being pulled") into 18.9 mm. There is no recoil metric in
 * the 63, so nothing downstream would catch it.
 */
export const RECOIL_L_IS = 'END_EFFECTOR_PATH_LENGTH' as const;
export const EMBUSEN_L_IS = 'ZENKUTSU_S' as const;
/** doc 04 §5.1's own mm cross-check: the `L` its recoil rows are quoted against, in metres. */
export const DOC04_RECOIL_L_REF_M = 0.5 as const;

/**
 * C18. doc 02's embusen `h`: authored `0.19 L` (§1.1, and the header of both §4.2 and §6.2
 * coordinate tables) vs `EMB_H = HACHIJI.W.v/2 = 0.1295 H = 0.23981 L` (§2.3, C03).
 *
 * RESOLVED: the coordinate tables and the σ axis keep doc 02's `h = 0.19 L` VERBATIM
 * (`EMB_POLYLINE_H_L`, `EMB_SIGMA_X_CONST_L`); `EMB_H` governs the yoi/hachiji STANCE width
 * only. §2.1 assertion 3's literal `c(21) = (-0.544, -0.354) L` is 0.19-based arithmetic and is
 * the pin. Regenerating the tables from `EMB_H` would shift every embusen x by 4.7 cm (45 % of
 * metric 42's ±0.06 H tolerance) and move the σ constant from -0.38 to -0.47963.
 */
export const EMB_POLYLINE_H_SOURCE = 'doc 02 §1.1 h = w/2 = 0.19 L, AUTHORED' as const;
export const EMB_H_GOVERNS = 'YOI_HACHIJI_STANCE_WIDTH_ONLY' as const;

/** Greppable registry of every §2.5 resolution. `tools/verify-contracts.mjs` reads it. */
export const CONFLICT_RESOLUTIONS = [
  { id: 'C01', shipped: 'SIDE_SIGN = -1 (+X = character RIGHT)', disputeId: null, src: '§2.1, §2.5' },
  { id: 'C02', shipped: 'L = ZENKUTSU.S.v = 0.540 H, DERIVED', disputeId: null, src: '§2.3, §2.5' },
  { id: 'C03', shipped: 'EMB_H = HACHIJI.W.v/2 = 0.1295 H, DERIVED', disputeId: null, src: '§2.3, §2.5' },
  { id: 'C04', shipped: 'embusen datum = AJC projected to floor', disputeId: null, src: '§2.3, §2.5' },
  { id: 'C05', shipped: 'gi sheen 0.45 / 0xE8E4DA / roughness 0.55', disputeId: 'D09', src: '§2.5, §5.6' },
  { id: 'C06', shipped: 'gi anisotropy 0.18 + itemSize-4 analytic tangent', disputeId: null, src: '§2.5, §2.7' },
  { id: 'C07', shipped: 'zenkutsu front load 59 pct', disputeId: 'D01', src: '§2.5, §2.6 #7' },
  { id: 'C08', shipped: 'age-uke forearm 25 deg', disputeId: 'D03', src: '§2.5, §2.6 #35' },
  { id: 'C09', shipped: 'elbow angles are INCLUDED (03 §13); flex = 180 - included', disputeId: 'D04', src: '§2.5, §2.6 #37' },
  { id: 'C10', shipped: 'hanmi 45 deg', disputeId: 'D06', src: '§2.5' },
  { id: 'C11', shipped: 'rear-foot yaw 30 deg', disputeId: 'D05', src: '§2.5, §2.6 #9' },
  { id: 'C12', shipped: 'head bob <= 0.008 H PEAK-TO-PEAK authored, 0.012 H max', disputeId: null, src: '§2.5, §10' },
  { id: 'C13', shipped: 'stage AABB 4.68 x 4.68 m; S_fit = 0.75 H', disputeId: null, src: '§2.5, §5.5' },
  { id: 'C14', shipped: 'BONE_COUNT = 52 (44 headline + 7 leaf terminators + ribcage)', disputeId: null, src: '§2.5, §2.8' },
  { id: 'C15', shipped: 'heel-behind-AJC: metric 1 REFERENCE uses doc 01 0.052 H (=> 0.533105); the RIG landmark keeps doc 06 0.0415 H', disputeId: null, src: '§2.3, §2.6 #1; doc 01 §1 vs doc 06 §4.2/§6.3' },
  { id: 'C16', shipped: 'doc 07 §6.6 camera transforms are AUTHORED; CameraPresetParams.posH is WORLD, so M_LEFT = (-3H, 0.5H, 0) and M_RIGHT = (+3H, 0.5H, 0)', disputeId: null, src: '§2.1, §3.4.1, §5.7; doc 07 §0.1 vs §6.6' },
  { id: 'C17', shipped: "recoilFracL / ampFracL scale by the TECHNIQUE'S end-effector path length (doc 04 §0 L ~ 0.50 m), never by the embusen L_M = 0.945 m", disputeId: null, src: '§2.3, §3.8; doc 04 §0 vs §5.1/§10' },
  { id: 'C18', shipped: "embusen tables and the sigma axis keep doc 02's authored h = 0.19 L; EMB_H governs the yoi/hachiji stance width only", disputeId: null, src: '§2.1 assertion 3, §2.3, C03; doc 02 §1.1/§3.2' },
] as const;
