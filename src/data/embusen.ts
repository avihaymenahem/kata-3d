/**
 * B1 NUMBERS — `src/data/embusen.ts`
 *
 * `L_H`, `L_M`, `EMB_H_H`, `ZENKUTSU_HEEL_TO_HEEL_H`, `PELVIS_AHEAD_OF_C_H`, the R0–R5 footfall
 * rules, `footPlanFor`, `embusenPolyline`, `assertEmbusenInvariants`
 * (ARCHITECTURE.md §2.3, §3.13, §4.1; doc 02 §3, §4.2, §6.2, §11).
 *
 * ═══ EVERY CONSTANT IN THIS FILE IS DERIVED. NONE IS AUTHORED. ═══════════════════════════════
 * §2.3 is explicit: "`L`, `EMB_H`, `ZENKUTSU_HEEL_TO_HEEL_H` and `PELVIS_AHEAD_OF_C_H` are
 * DERIVED, never authored." They are computed here from `STANCES` and `ANTHRO` so that editing
 * `ZENKUTSU.S` moves the embusen with it and the two can never disagree — which is the 3.85 %
 * silent-drift class of bug the panel called fatal in Proposal B.
 *
 * ═══ WHY THE COORDINATE TABLES NEED NO RESCALING ════════════════════════════════════════════
 * doc 02 §1.1 mandates "if the stance spec fixes a different `L`, multiply every `(x,z)` by
 * `L_new/L_old`". doc 02's tables are expressed IN UNITS OF `L`, i.e. dimensionless, so re-deriving
 * `L` from `ZENKUTSU.S` changes only the METRE conversion — `L_M`, not the numbers. That is exactly
 * why σ-symmetry and the closure residual survive the change: both are relative. `EMBUSEN_RESCALE`
 * in `units.ts` is the ratio, and `tests/data/embusen.test.ts` asserts `L_M = 0.91 m x
 * EMBUSEN_RESCALE` to close the loop.
 *
 * ═══ C18 — `EMB_H_H` IS THE STANCE WIDTH, NOT DOC 02'S POLYLINE `h` ═════════════════════════
 * `EMB_H_H = HACHIJI.W/2 = 0.1295 H = 0.23981 L` governs the YOI/HACHIJI STANCE WIDTH ONLY. The
 * coordinate tables and the σ axis keep doc 02 §1.1's AUTHORED `h = 0.19 L` (`EMB_POLYLINE_H_L`),
 * and §2.1 assertion 3's literal `c(21) = (-0.544, -0.354) L` is 0.19-based arithmetic that pins it.
 * Substituting `EMB_H_H` would shift every embusen `x` by 4.7 cm — 45 % of metric 42's tolerance —
 * and move the σ constant from `-0.38` to `-0.47963`.
 *
 * ═══ CONFLICT: THE KOKUTSU EMBUSEN STEP IS 1.00 L, THE KOKUTSU STANCE IS 0.446 H ════════════
 * doc 02 §1.1 sets `Lk = 1.00 L` for kokutsu and its move-18…21 coordinates depend on it: the
 * frozen `c(21) = (-0.544, -0.354)` only comes out at `step = 1.00` (at `0.446/0.540 = 0.826` it
 * would be `(-0.482, -0.292)`). doc 01 §4.3 independently PROVES kokutsu cannot be 0.518 H at equal
 * height with 70 % rear load. Both are right about different things, so:
 *
 *   - `EMB_STEP_L` (this file) is the EMBUSEN GENERATOR step: 1.00 L for zenkutsu AND kokutsu.
 *     It reproduces doc 02 §4.2 / §6.2 exactly and keeps the frozen pin.
 *   - `STANCES[id].S` is the ANKLE-TO-ANKLE stance length: 0.540 H / 0.446 H.
 *   - `c` — the MIDPOINT — is "the canonical embusen point" in doc 02 §4.2's own words, and it is
 *     what metric 42 measures. So B3 must plant the two AJCs at `c ± (S/2)·f(H)` using
 *     `AJC_HALF_SEP_L`, NOT at the generator's `ff`/`rf`. For zenkutsu the two agree exactly; for
 *     kokutsu `ff`/`rf` are 0.094 H wider than the stance and are generator scaffolding only.
 *
 * doc 02 §4.2's own note already treats `ff`/`rf` this way ("the two feet are treated as collinear
 * along the facing axis for embusen purposes … which leaves every `c` unchanged"). Raised as a
 * handoff to B3 and B9.
 */

import type {
  EmbXZ,
  Handedness,
  KataMove,
  KataScore,
  MoveOverride,
  MovePatch,
  PivotKind,
  PivotRule,
  StanceId,
} from '../contracts';
import {
  EMBUSEN_RESCALE,
  EMB_POLYLINE_H_L,
  EMB_SIGMA_X_CONST_L,
  EMB_SIGMA_Z_CONST_L,
  H,
  MOVE_SECONDS_T1,
  embSigma,
  facingAuthored,
  otherHand,
} from '../contracts';
import { ANTHRO } from './constants/anthro';
import { STANCES, STANCE_HIP_OFFSETS } from './constants/stances';
import { TEMPO_CLASSES } from './constants/dynamics';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * §3.4.1 — `FootPlan`. Declared in this barrel; its shape is frozen by §3.4.1.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface FootPlan {
  readonly moveN: number;
  /** AUTHORED frame (doc 02 §1). The single world conversion lives in `src/solve/frame.ts`. */
  readonly headingDeg: number;
  /** AJC projected to the floor, units of `L`, AUTHORED frame. */
  readonly ffXZ: readonly [number, number];
  readonly rfXZ: readonly [number, number];
  readonly cXZ: readonly [number, number];
  readonly frontFoot: Handedness;
  readonly pivotFoot: Handedness | null;
  readonly pivotKind: PivotKind;
  readonly excursion: MoveOverride['footExcursion'] | null;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE DERIVED DATUM TABLE (§2.3).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** `L = ZENKUTSU.S.v = 0.540 H`. Conflict C02: doc 02's own 0.520 H loses to doc 01's stance spec. */
export const L_H: number = STANCES.zenkutsu.S.v;
/** `L` in metres: `0.540 x 1.75 = 0.945 m`. Also `0.91 m x EMBUSEN_RESCALE`. */
export const L_M: number = L_H * H;

/** `EMB_H = HACHIJI.W.v / 2 = 0.1295 H`. Conflict C03/C18 — the STANCE half-width, not doc 02's `h`. */
export const EMB_H_H: number = STANCES.hachiji.W.v / 2;

/**
 * §2.3: `S - HEEL_BEHIND·cos(yawFront) + HEEL_BEHIND·cos(yawRear)`
 *     = `0.540 - 0.052·cos3° + 0.052·cos30°` = **0.533105**, inside the ±5e-4 gate.
 *
 * `HEEL_BEHIND` is doc 01 §1's `0.052 H`, and ONLY that (conflict C15). doc 06 §4.2's rig heel
 * landmark is a different number — `0.0415 H`, shipped frozen as `HEEL_OFFSET_H[2]` — and
 * substituting it gives 0.534497, off by 1.50e-3 = 3x the tolerance. Metric 1's datum is
 * heel-to-heel, so this, and not 0.540, is §2.6 override #1's reference.
 */
export const ZENKUTSU_HEEL_TO_HEEL_H: number = (() => {
  const s = STANCES.zenkutsu.S.v;
  const heel = ANTHRO.HEEL_BEHIND!.v;
  const yawF = STANCES.zenkutsu.yawFront.v;
  const yawR = STANCES.zenkutsu.yawRear.v;
  const deg = Math.PI / 180;
  return s - heel * Math.cos(yawF * deg) + heel * Math.cos(yawR * deg);
})();

/**
 * `FOOT_LEN/2 - HEEL_BEHIND = 0.076 - 0.052 = 0.024`. Used for foot GEOMETRY only, NEVER for the
 * embusen: §2.3's whole ankle-datum decision exists because a foot-centre datum would make the
 * embusen step 0.543 H — a second, silently different `L`.
 */
export const FOOT_CENTRE_AHEAD_OF_AJC_H: number = ANTHRO.FOOT_LEN!.v / 2 - ANTHRO.HEEL_BEHIND!.v;

/**
 * Metric 42 compares `p[0]_xz` (Hips) against `c + PELVIS_AHEAD_OF_C_H · f(H)`, not against `c`.
 * Positive = toward the facing direction.
 *
 * §2.3 gives the two fighting stances as the difference between the stance half-length and doc 01
 * §10's own measured hip offset:
 *   zenkutsu: `S/2 - hipZbehindFrontAnkle = 0.270 - 0.221 = +0.049`
 *   kokutsu:  `hipZaheadOfRearAnkle - S/2 = 0.134 - 0.223 = -0.089`
 * For the stances doc 01 prints no hip offset for, the LOAD-SHARE form of doc 06 §2.2 is used:
 * a static COM divides the inter-foot line INVERSELY to the force split, so the pelvis sits
 * `(loadFront - 0.5)·S` ahead of the midpoint. That form independently reproduces both fighting
 * stances to 4e-4 — `(0.59-0.5)·0.540 = 0.0486` and `(0.30-0.5)·0.446 = -0.0892` — which is the
 * cross-check `tests/data/derived.test.ts` asserts.
 */
const loadShareAhead = (id: StanceId): number => {
  const s = STANCES[id];
  return (s.loadFront.v / 100 - 0.5) * s.S.v;
};

export const PELVIS_AHEAD_OF_C_H: Readonly<Record<StanceId, number>> = Object.freeze({
  /* Symmetric stances: `S = 0` and a 50/50 split, so the pelvis is exactly over `c`. */
  heisoku: 0,
  musubi: 0,
  heiko: 0,
  hachiji: 0,
  kiba: 0,
  zenkutsu: STANCES.zenkutsu.S.v / 2 - STANCE_HIP_OFFSETS.zenkutsuHipBehindFrontAnkleH.v,
  kokutsu: STANCE_HIP_OFFSETS.kokutsuHipAheadOfRearAnkleH.v - STANCES.kokutsu.S.v / 2,
  'zenkutsu-ashi': loadShareAhead('zenkutsu-ashi'),
  'han-zenkutsu': loadShareAhead('han-zenkutsu'),
  moto: loadShareAhead('moto'),
});

/** The load-share cross-check form, exported so `tests/data/derived.test.ts` can assert agreement. */
export const PELVIS_AHEAD_OF_C_BY_LOAD_H: Readonly<Record<StanceId, number>> = Object.freeze(
  (Object.keys(STANCES) as StanceId[]).reduce<Record<StanceId, number>>((acc, id) => {
    acc[id] = loadShareAhead(id);
    return acc;
  }, {} as Record<StanceId, number>),
);

/**
 * The EMBUSEN GENERATOR step, units of `L`. See the header's kokutsu conflict note: doc 02 §1.1
 * fixes `Lk = 1.00 L` for kokutsu as well as zenkutsu, and the frozen `c(21)` pin requires it.
 * Every other stance steps by its own ankle-to-ankle length expressed in `L`.
 */
export const EMB_STEP_L: Readonly<Record<StanceId, number>> = Object.freeze({
  zenkutsu: 1,
  kokutsu: 1,
  heisoku: STANCES.heisoku.S.v / L_H,
  musubi: STANCES.musubi.S.v / L_H,
  heiko: STANCES.heiko.S.v / L_H,
  hachiji: STANCES.hachiji.S.v / L_H,
  kiba: STANCES.kiba.S.v / L_H,
  'zenkutsu-ashi': STANCES['zenkutsu-ashi'].S.v / L_H,
  'han-zenkutsu': STANCES['han-zenkutsu'].S.v / L_H,
  moto: STANCES.moto.S.v / L_H,
});

/**
 * Half the ANKLE-TO-ANKLE separation, units of `L`. B3 plants the two AJCs at
 * `c ± AJC_HALF_SEP_L · f(H)`, which is the same as `ff`/`rf` for zenkutsu and 0.087 L tighter for
 * kokutsu — see the header. THIS, not `ff`/`rf`, is the foot-placement authority.
 */
export const AJC_HALF_SEP_L: Readonly<Record<StanceId, number>> = Object.freeze(
  (Object.keys(STANCES) as StanceId[]).reduce<Record<StanceId, number>>((acc, id) => {
    acc[id] = STANCES[id].S.v / (2 * L_H);
    return acc;
  }, {} as Record<StanceId, number>),
);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * σ, the bounding box, and the yoi datum. All from `units.ts`, re-exported so a consumer has one
 * import and the two forms cannot drift.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 02 §3.2's 180°-rotational symmetry about `P0 = (-0.19, -2.00)`: `(-0.38 - x, -4.00 - z)`. */
export const sigma = embSigma;

/** doc 02 §3.2: `x ∈ [-2.19, +1.81]`, `z ∈ [-4.00, 0.00]` = 4.00 L x 4.00 L = 3.78 m square. */
export const EMB_BBOX = Object.freeze({
  xMin: -2.19,
  xMax: 1.81,
  zMin: -4.0,
  zMax: 0.0,
  sideL: 4.0,
  sideM: 4.0 * L_M,
});

/** Yoi feet, doc 02 §3.2: `L = (+h, 0)`, `R = (-h, 0)`, `c = (0, 0)`. */
export const YOI_FOOT_L: EmbXZ = Object.freeze([EMB_POLYLINE_H_L, 0] as const);
export const YOI_FOOT_R: EmbXZ = Object.freeze([-EMB_POLYLINE_H_L, 0] as const);
export const YOI_CENTRE: EmbXZ = Object.freeze([0, 0] as const);

/** Units of `L` -> metres. `EMBUSEN_RESCALE` is why this is 94.5 cm/L and not doc 02's 91.0. */
export const embusenToMetres = (p: EmbXZ): readonly [number, number] => [p[0] * L_M, p[1] * L_M];

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * R0–R5 — doc 02 §3.1's footfall-kinematics rules.
 *
 * doc 02 §3.1's own normative sentence is the one this implements: "**always place the moving foot
 * from the pivot foot, then take the midpoint.** That formulation is the single source of truth;
 * the `Δc` column is a convenience/cross-check."
 *
 * Reduced to two facts per rule — WHICH FOOT STAYS, and WHETHER THE FRONT SIDE CHANGES — all five
 * moving rules collapse to the same two lines:
 *     `rf = anchor` · `ff = anchor + step · f(H_new)`
 * because the anchor always ends up as the new REAR foot. Verified against every row of doc 02
 * §4.2 and §6.2 by `assertEmbusenInvariants`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface PivotRuleSpec {
  /** Which of the PREVIOUS plan's feet the generator places from. `'none'` = nothing moves (R0). */
  readonly anchor: 'front' | 'rear' | 'none';
  /**
   * Whether the anchor is a PIVOT in doc 02 §4.1's sense — a planted foot that ROTATES about a
   * stored point. `false` for R0 and R1, which doc 02's `Piv` column prints as "—" even though a
   * foot is stationary: a straight step-through has a stationary old front foot but no pivot.
   * `KataMove.pivot` is therefore `null` for R0/R1 and the anchor side for R2…R5.
   */
  readonly pivots: boolean;
  /** Whether the front leg swaps sides. */
  readonly frontChanges: boolean;
  readonly desc: string;
}

export const PIVOT_RULE_SPEC: Readonly<Record<PivotRule, PivotRuleSpec>> = Object.freeze({
  /** In place. Heian 4 only: the front foot retracts 0.5 L and returns. Net `Δc = 0`. */
  R0: { anchor: 'none', pivots: false, frontChanges: false, desc: 'in place, retract-return (Heian 4)' },
  /** Step through, no turn. The rear foot travels 2 L and becomes the new front. */
  R1: { anchor: 'front', pivots: false, frontChanges: true, desc: 'step-through, no turn' },
  /** Turn 180°, same foot stays front: the REAR foot pivots on its heel and stays rear. */
  R2: { anchor: 'rear', pivots: true, frontChanges: false, desc: 'turn 180 deg, front leg unchanged' },
  /** Turn 90/270°, front foot becomes rear; the old rear swings to the new front. */
  R3: { anchor: 'front', pivots: true, frontChanges: true, desc: 'turn 90/270 deg, front leg changes' },
  /** Turn 90°, same foot stays front: the REAR foot stays planted and stays rear. */
  R4: { anchor: 'rear', pivots: true, frontChanges: false, desc: 'turn 90 deg, front leg unchanged' },
  /** Diagonal step-through, `ΔH = ±45`: the front foot becomes rear. Same shape as R3. */
  R5: { anchor: 'front', pivots: true, frontChanges: true, desc: 'diagonal step-through, 45 deg' },
});

/** doc 02 §1: `f(H) = (sin H, 0, -cos H)`, projected to XZ. AUTHORED frame, from `units.ts`. */
const facingXZ = (headingDeg: number): readonly [number, number] => {
  const f = facingAuthored(headingDeg);
  return [f[0], f[2]];
};

/**
 * The GEOMETRIC anchor: which of the previous plan's feet the moving foot is placed from. `null`
 * only for R0, where nothing moves. On move 1 there is no previous plan — the character leaves
 * hachiji, which has no front foot — so the authored `pivot` supplies the side.
 */
export function anchorFootFor(prev: FootPlan | null, m: KataMove): Handedness | null {
  const spec = PIVOT_RULE_SPEC[m.rule];
  if (spec.anchor === 'none') return null;
  if (prev === null) return m.pivot;
  return spec.anchor === 'front' ? prev.frontFoot : otherHand(prev.frontFoot);
}

/**
 * What `KataMove.pivot` must be — `null` for R0 and R1, the anchor side for R2…R5. Used by
 * `assertEmbusenInvariants` to CHECK the authored `pivot` rather than trust it: a wrong pivot is
 * the one embusen error that still closes the heading chain and still lands every `c`, because the
 * generator would place the moving foot from the wrong side and the midpoint would absorb it.
 */
export function expectedPivotFoot(prev: FootPlan | null, m: KataMove): Handedness | null {
  return PIVOT_RULE_SPEC[m.rule].pivots ? anchorFootFor(prev, m) : null;
}

/**
 * doc 02 §6.2's move-4 excursion, as the default when no patch supplies one: the front foot slides
 * back 0.50 L along `-f` at the wind-up peak and returns forward 0.50 L, arriving at kime. Net 0 L;
 * the torso rises ~0.03 H during the retraction and re-settles.
 *
 * `atTau` is the end of `t_prep` as a fraction of the whole slot, from the move's own tempo class:
 * `(t_hold + t_prep) / t_slot`. `deltaL` is POSITIVE because §3.7 measures it along `-f(H)`.
 */
function r0DefaultExcursion(m: KataMove): NonNullable<MoveOverride['footExcursion']> {
  const c = TEMPO_CLASSES[m.tempo];
  const slot = c.tHold.v + c.tPrep.v + c.tTransit.v + c.tKime.v;
  return {
    foot: m.mover,
    atTau: (c.tHold.v + c.tPrep.v) / slot,
    deltaL: 0.5,
    torsoRiseH: 0.03,
  };
}

/**
 * THE footfall generator. `prev === null` means the move leaves yoi (hachiji), where there is no
 * front foot, so the anchor comes from the authored `pivot` and its position from the yoi datum.
 *
 * Pure: no wall clock, no `Math.random`, no mutation of its inputs.
 */
export function footPlanFor(prev: FootPlan | null, m: KataMove, patch: MovePatch): FootPlan {
  const spec = PIVOT_RULE_SPEC[m.rule];
  const excursion =
    patch.override.footExcursion ?? (m.rule === 'R0' ? r0DefaultExcursion(m) : null);

  /* R0: nothing moves. The excursion is a transient inside the move, not a displacement. */
  if (spec.anchor === 'none') {
    if (prev === null) throw new Error(`footPlanFor: rule R0 on move ${m.n} has no previous plan`);
    return {
      moveN: m.n,
      headingDeg: m.headingDeg,
      ffXZ: prev.ffXZ,
      rfXZ: prev.rfXZ,
      cXZ: prev.cXZ,
      frontFoot: prev.frontFoot,
      pivotFoot: m.pivot,
      pivotKind: m.pivotKind,
      excursion,
    };
  }

  const anchorSide = anchorFootFor(prev, m);
  if (anchorSide === null) {
    throw new Error(`footPlanFor: rule ${m.rule} on move ${m.n} has no anchor foot`);
  }

  let anchorXZ: readonly [number, number];
  if (prev === null) {
    anchorXZ = anchorSide === 'L' ? YOI_FOOT_L : YOI_FOOT_R;
  } else {
    anchorXZ = anchorSide === prev.frontFoot ? prev.ffXZ : prev.rfXZ;
  }

  const step = EMB_STEP_L[m.stance];
  const f = facingXZ(m.headingDeg);
  const ffXZ: readonly [number, number] = [anchorXZ[0] + step * f[0], anchorXZ[1] + step * f[1]];
  const cXZ: readonly [number, number] = [
    (ffXZ[0] + anchorXZ[0]) / 2,
    (ffXZ[1] + anchorXZ[1]) / 2,
  ];

  return {
    moveN: m.n,
    headingDeg: m.headingDeg,
    ffXZ,
    rfXZ: anchorXZ,
    cXZ,
    frontFoot: m.front,
    pivotFoot: m.pivot,
    pivotKind: m.pivotKind,
    excursion,
  };
}

/** Run `footPlanFor` across a whole kata. `patchOf` defaults to an empty patch per move. */
export function footPlansFor(
  k: KataScore,
  patchOf: (n: number) => MovePatch = (n) => EMPTY_PATCH(k.id, n),
): readonly FootPlan[] {
  const out: FootPlan[] = [];
  let prev: FootPlan | null = null;
  for (const m of k.moves) {
    prev = footPlanFor(prev, m, patchOf(m.n));
    out.push(prev);
  }
  return out;
}

/** An empty patch, for callers that only want the generator. Never mutated. */
export const EMPTY_PATCH = (kataId: KataScore['id'], n: number): MovePatch => ({
  kataId,
  n,
  reason: '',
  finding: null,
  override: {},
  patch: [],
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Polylines.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The STANCE-CENTRE track, units of `L`: `[yoi, c1 … cN, yoi]`. doc 02 §4.2 calls `c` "the
 * canonical embusen point", and metric 42 measures the pelvis against `c + PELVIS_AHEAD·f(H)`, so
 * this is the polyline `reports/<sha>/floor-trace.png` draws and the one a scale or offset error in
 * `L` shows up in as a visible mismatch.
 */
export function embusenPolyline(k: KataScore): readonly EmbXZ[] {
  const out: EmbXZ[] = [YOI_CENTRE];
  for (const m of k.moves) out.push(m.embusen.c);
  out.push(YOI_CENTRE);
  return Object.freeze(out);
}

/** doc 02 §3.2's own "front-foot trace" polyline, units of `L`: `[yoi L foot, ff1 … ffN, yoi L foot]`. */
export function embusenFrontFootTrace(k: KataScore): readonly EmbXZ[] {
  const out: EmbXZ[] = [YOI_FOOT_L];
  for (const m of k.moves) out.push(m.embusen.ff);
  out.push(YOI_FOOT_L);
  return Object.freeze(out);
}

/**
 * doc 02 §4.3 / §6.3's closure residual, units of `L`. Both kata end with the RIGHT foot on its
 * unchanged yoi position `(-h, 0)`; naore/yame pivots on it and draws the LEFT foot back to
 * `(+h, 0)`, giving `c = (0,0)` exactly. The residual is therefore how far the right foot has
 * drifted from `(-h, 0)` after the last move — doc 02 proves it is 0.00 cm for both kata.
 */
export function yameClosureResidualL(k: KataScore): number {
  const last = k.moves[k.moves.length - 1];
  if (last === undefined) return Number.POSITIVE_INFINITY;
  const rFoot = last.front === 'R' ? last.embusen.ff : last.embusen.rf;
  return Math.hypot(rFoot[0] - -EMB_POLYLINE_H_L, rFoot[1] - 0);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * assertEmbusenInvariants — doc 02 §11's seven generator invariants, plus the σ pairings of §3.2.
 * Throws with the FAILING INVARIANT'S NAME, which is what `validateKata` (B2) re-throws and what
 * stage S0 asserts.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Tolerance for invariant 2, units of `L`. doc 02 §6.2 prints the two diagonal rows rounded to
 * three decimals (`+1.517, -0.707` where the exact generator gives `+1.517107, -0.707107`), so an
 * exact recomputation differs from the authored table by up to 5e-4 L. OWNERSHIP B2's "1e-9 L" is
 * reachable only if B2 authors the unrounded values; the parameter lets B2's own test tighten it.
 */
export const EMB_FF_TOL_L = 1e-3;

/** Σ `tSlotS` must land within 20 % of doc 02's per-kata total (§1.4's stated tolerance). */
export const EMB_TSLOT_TOL_FRAC = 0.2;

/** doc 02 §4.3 / §6.3: "Residual = 0.00 cm". §11 invariant 4 allows < 0.01 L. */
export const EMB_CLOSURE_TOL_L = 0.01;

const fail = (invariant: string, detail: string): never => {
  throw new Error(`embusen invariant ${invariant} FAILED: ${detail}`);
};

/** The σ pairings doc 02 §3.2 states per kata. */
const SIGMA_PAIRS: Readonly<Record<string, readonly (readonly [number, number])[]>> = Object.freeze({
  'taikyoku-shodan': Object.freeze([
    [1, 9], [2, 10], [3, 11], [4, 12], [5, 13], [6, 14], [7, 15], [8, 16],
  ] as const),
  'heian-shodan': Object.freeze([
    [1, 10], [2, 11], [3, 12], [5, 13], [6, 14], [7, 15], [8, 16], [9, 17],
  ] as const),
});

/** doc 02 §3.2's extra Taikyoku identity: `c_17..c_20 == c_1..c_4` (the figure repeats). */
const REPEAT_PAIRS: Readonly<Record<string, readonly (readonly [number, number])[]>> = Object.freeze(
  {
    'taikyoku-shodan': Object.freeze([[17, 1], [18, 2], [19, 3], [20, 4]] as const),
    'heian-shodan': Object.freeze([] as const),
  },
);

/** doc 02 §5 / §7: the kiai indices, per kata. Invariant 6. */
export const KIAI_AT: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'taikyoku-shodan': Object.freeze([8, 16]),
  'heian-shodan': Object.freeze([9, 17]),
});

export function assertEmbusenInvariants(k: KataScore, tolL: number = EMB_FF_TOL_L): void {
  const moves = k.moves;
  const at = (n: number): KataMove => {
    const m = moves.find((x) => x.n === n);
    if (m === undefined) fail('I0-move-exists', `no move ${n} in ${k.id}`);
    return m as KataMove;
  };

  /* ── I1 · the heading chain from `dHeadingDeg` reproduces every `headingDeg`. ── */
  let h = 0;
  for (const m of moves) {
    h = (((h + m.dHeadingDeg) % 360) + 360) % 360;
    const want = (((m.headingDeg % 360) + 360) % 360);
    if (Math.abs(h - want) > 1e-9) {
      fail('I1-heading-chain', `move ${m.n}: chain gives ${h}, table says ${want}`);
    }
  }

  /* ── I2 · `ff`/`rf`/`c` recomputed from `pivot + Lk·f(H)` match the authored table, and the
   *        authored `pivot` matches the one the rule requires. ── */
  let prev: FootPlan | null = null;
  for (const m of moves) {
    const wantPivot = expectedPivotFoot(prev, m);
    if (m.pivot !== wantPivot) {
      fail(
        'I2-pivot-foot',
        `move ${m.n} rule ${m.rule}: authored pivot ${String(m.pivot)}, rule requires ${String(wantPivot)}`,
      );
    }
    const plan = footPlanFor(prev, m, EMPTY_PATCH(k.id, m.n));
    const near = (a: readonly [number, number], b: EmbXZ): boolean =>
      Math.abs(a[0] - b[0]) <= tolL && Math.abs(a[1] - b[1]) <= tolL;
    if (!near(plan.ffXZ, m.embusen.ff)) {
      fail('I2-ff-recompute', `move ${m.n}: generator ff (${plan.ffXZ.join(', ')}) vs authored (${m.embusen.ff.join(', ')})`);
    }
    if (!near(plan.rfXZ, m.embusen.rf)) {
      fail('I2-rf-recompute', `move ${m.n}: generator rf (${plan.rfXZ.join(', ')}) vs authored (${m.embusen.rf.join(', ')})`);
    }
    if (!near(plan.cXZ, m.embusen.c)) {
      fail('I2-c-recompute', `move ${m.n}: generator c (${plan.cXZ.join(', ')}) vs authored (${m.embusen.c.join(', ')})`);
    }
    prev = plan;
  }

  /* ── I3 · σ-symmetry, doc 02 §3.2's own validation assertions. ── */
  for (const [i, j] of SIGMA_PAIRS[k.id] ?? []) {
    const [sx, sz] = sigma(at(i).embusen.c[0], at(i).embusen.c[1]);
    const c = at(j).embusen.c;
    if (Math.abs(sx - c[0]) > 1e-6 || Math.abs(sz - c[1]) > 1e-6) {
      fail('I3-sigma', `sigma(c${i}) = (${sx}, ${sz}) but c${j} = (${c[0]}, ${c[1]})`);
    }
  }
  for (const [i, j] of REPEAT_PAIRS[k.id] ?? []) {
    const a = at(i).embusen.c;
    const b = at(j).embusen.c;
    if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6) {
      fail('I3-repeat', `c${i} must equal c${j}`);
    }
  }

  /* ── I4 · closure residual. ── */
  const residual = yameClosureResidualL(k);
  if (!(residual < EMB_CLOSURE_TOL_L)) {
    fail('I4-closure', `yame closure residual ${residual.toFixed(6)} L >= ${EMB_CLOSURE_TOL_L} L`);
  }

  /* ── I5 · Σ `tSlotS` within 20 % of doc 02's per-kata total. ── */
  const target = MOVE_SECONDS_T1[k.id];
  const sum = moves.reduce((a, m) => a + m.tSlotS, 0);
  if (Math.abs(sum - target) > target * EMB_TSLOT_TOL_FRAC) {
    fail('I5-tslot-total', `sum tSlotS = ${sum.toFixed(3)} s, target ${target} s +-20 %`);
  }

  /* ── I6 · exactly two kiai, at the documented indices, and `kiaiAt` agrees with the moves. ── */
  const kiai = moves.filter((m) => m.kiai).map((m) => m.n);
  const wantKiai = KIAI_AT[k.id] ?? [];
  if (kiai.length !== wantKiai.length || kiai.some((n, i) => n !== wantKiai[i])) {
    fail('I6-kiai', `kiai at [${kiai.join(', ')}], expected [${wantKiai.join(', ')}]`);
  }
  if (k.kiaiAt.length !== kiai.length || k.kiaiAt.some((n, i) => n !== kiai[i])) {
    fail('I6-kiai-field', `kiaiAt [${k.kiaiAt.join(', ')}] disagrees with moves [${kiai.join(', ')}]`);
  }

  /* ── I7 · every `c` inside the 4 L x 4 L bounding box. ── */
  for (const m of moves) {
    const [x, z] = m.embusen.c;
    if (x < EMB_BBOX.xMin || x > EMB_BBOX.xMax || z < EMB_BBOX.zMin || z > EMB_BBOX.zMax) {
      fail('I7-bbox', `move ${m.n} c = (${x}, ${z}) outside [${EMB_BBOX.xMin}, ${EMB_BBOX.xMax}] x [${EMB_BBOX.zMin}, ${EMB_BBOX.zMax}]`);
    }
  }
}

/** The five derived scalars, boxed for the scorecard's provenance row and for `tests/data`. */
export const DERIVED_SUMMARY = Object.freeze({
  L_H,
  L_M,
  EMB_H_H,
  ZENKUTSU_HEEL_TO_HEEL_H,
  FOOT_CENTRE_AHEAD_OF_AJC_H,
  EMBUSEN_RESCALE,
  EMB_POLYLINE_H_L,
  EMB_SIGMA_X_CONST_L,
  EMB_SIGMA_Z_CONST_L,
});
