/**
 * tests/solve/kokutsu.test.ts — doc 01 §4.3's hard geometric result, reproduced from the solve
 * (OWNERSHIP B3 "Verification": "`tests/solve/kokutsu.test.ts` reproduces 01 §4.3's impossibility
 * result").
 *
 * ── WHAT DOC 01 §4.3 ACTUALLY ARGUES ───────────────────────────────────────────────────────
 * The section is titled "Hard geometric result — kokutsu CANNOT be as long as zenkutsu", and its
 * first sentence is the whole argument:
 *
 *     "At `PELVIS_Y = 0.410 H` with 70 % rear load, the FRONT leg must span `0.70·S`
 *      horizontally. Straight-leg reach caps `S` at `0.459 H`."
 *
 * It is a statement about the **front** leg, and it follows from doc 06 §2.2's INVERSE weight
 * relation: 70 % on the rear foot puts the hip 0.30·S from the REAR ankle and therefore 0.70·S
 * from the FRONT one. The rear leg is the SHORT one in a kokutsu; it is never the binding
 * constraint. doc 01 §4.2's own table confirms the split directly — `hip jc Z ahead of rear ankle
 * 0.134 H` = 0.30 × 0.446, `hip jc Z behind front ankle 0.312 H` = 0.70 × 0.446.
 *
 * So the predicate is:
 *
 *     requiredFrontLeg(S) = hypot(PELVIS_Y − AJC_HEIGHT, rearShare · S)   >   LEG_LENGTH
 *
 * ── ✅ `kokutsuRequiredLegH` NOW MEASURES THE FRONT LEG. FIXED IN THE SOURCE. ───────────────
 * This file originally shipped with a compensating workaround, because `src/solve/stance.ts`
 * computed `hipAheadOfRear = stanceLenH * (1 − rearShareFrac)` — the span of the **REAR** leg —
 * while reasoning "the rear leg carries the hip". Both halves of that were the wrong way round:
 * at 70 % rear load the hip sits CLOSER to the rear ankle, so the rear leg is the one with slack,
 * and the predicate returned `0.4048 H` against an available `0.4918 H`. It demonstrated nothing.
 *
 * The source now takes `rearShareFrac` and computes `hypot(rise, stanceLenH · rearShareFrac)`,
 * which IS the front leg's span. So `requiredFrontLegH` passes `REAR_LOAD_FRAC` directly and the
 * workaround is gone — exactly the swap the original note prescribed for when this got fixed.
 * `the call convention this file depends on` still pins the reading, so a future re-spec cannot
 * quietly invert these results a second time.
 *
 * ── WHAT IS ASSERTED ───────────────────────────────────────────────────────────────────────
 * All four rows of doc 01 §4.3's consequence table, §4.1's `S` geometric maximum, and §4.2's two
 * knee flexions — every one of them from `kokutsuRequiredLegH` / `kneeFlexClosedFormDeg` /
 * `LEG_LENGTH_H` / `AJC_HEIGHT_H`, none of them from the constant table.
 */

import { describe, expect, it } from 'vitest';

import { ANTHRO, STANCES } from '../../src/data';
import {
  AJC_HEIGHT_H,
  LEG_LENGTH_H,
  kneeFlexClosedFormDeg,
  kokutsuRequiredLegH,
} from '../../src/solve';

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * The four inputs doc 01 §4.3 holds fixed, all read from the shipped stance specs.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 01 §2's master invariant — one working height for all three fighting stances. */
const PELVIS_Y_H = STANCES.kokutsu.pelvisY.v;
/** doc 01 §4.2 `weight, front leg 30 %` = [MEASURED 30.26] (de Souza 2015). */
const FRONT_LOAD_FRAC = STANCES.kokutsu.loadFront.v / 100;
/** doc 01 §4.2 `weight, rear leg 70 %` = [MEASURED 69.74] + [TRAD 70]. */
const REAR_LOAD_FRAC = 1 - FRONT_LOAD_FRAC;
/** doc 01 §4.3's rejected claim: "front foot two shoulder widths forward" = 2 × 0.259 H. */
const TWO_SHOULDER_WIDTHS_H = 2 * ANTHRO.SHOULDER_W!.v;

/**
 * doc 01 §4.3's quantity: the length the FRONT leg must have to span `rearShare·S` horizontally
 * at the fighting hip height.
 *
 * `kokutsuRequiredLegH`'s body is now `hypot(pelvisYH − AJC_HEIGHT_H, stanceLenH · rearShare)`,
 * so the share to pass is the REAR one — the parameter names the load, and the span it produces
 * is the FRONT leg's, which is doc 01 §4.3's own quantity. No indirection left.
 */
const requiredFrontLegH = (stanceLenH: number, pelvisYH = PELVIS_Y_H): number =>
  kokutsuRequiredLegH(stanceLenH, pelvisYH, REAR_LOAD_FRAC);

describe('the call convention this file depends on', () => {
  it('`kokutsuRequiredLegH(S, y, REAR_LOAD_FRAC)` is the FRONT leg — hypot(rise, 0.70·S)', () => {
    /* If this ever fails, `kokutsuRequiredLegH` has been re-specified again. The parameter names
     * the LOAD SHARE OF THE REAR LEG and the value returned is the FRONT leg's required length;
     * fix the source, not this file. Nothing below may be relaxed to make it pass. */
    const rise = PELVIS_Y_H - AJC_HEIGHT_H;
    for (const s of [0.446, 0.459, 0.518, 0.54]) {
      expect(requiredFrontLegH(s)).toBeCloseTo(Math.hypot(rise, REAR_LOAD_FRAC * s), 12);
    }
  });

  it('the REAR-leg reading is feasible at every stance length — it cannot be the doc\'s argument', () => {
    /* The positive disproof, and the reason the source's old formulation was silently useless: the
     * rear leg spans only `0.30·S`, so even at ZENKUTSU length it needs 0.4048 H against 0.4918 H
     * available — 8.7 cm of slack. Any predicate that returns THIS number cannot be doc 01 §4.3's
     * infeasibility argument. Passing the FRONT share is what produces the rear reading. */
    const rearAtZenkutsuLen = kokutsuRequiredLegH(STANCES.zenkutsu.S.v, PELVIS_Y_H, FRONT_LOAD_FRAC);
    expect(rearAtZenkutsuLen).toBeCloseTo(0.4048, 4);
    expect(rearAtZenkutsuLen).toBeLessThan(LEG_LENGTH_H);
  });

  it('the rig\'s leg length is doc 01 §1\'s LEG_EXT to within 1 mm at H = 175 cm', () => {
    /* doc 01 §4.3 states the ceiling as `0.491 H`; the rig's de Leva chain gives `0.4918 H`. The
     * two tables are not in disagreement (doc 06 §1.5) — but every margin below is quoted against
     * the rig's number, so the difference is pinned here rather than left implicit. */
    expect(LEG_LENGTH_H).toBeCloseTo(0.4918, 6);
    expect(Math.abs(LEG_LENGTH_H - ANTHRO.LEG_EXT!.v)).toBeLessThan(0.001);
    /* And the AJC datum the vertical rise is measured to: doc 01 §1 `ANKLE_Y: 0.039`. */
    expect(AJC_HEIGHT_H).toBeCloseTo(ANTHRO.ANKLE_Y!.v, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * THE HEADLINE — "kokutsu CANNOT be as long as zenkutsu"
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 01 §4.3 — kokutsu cannot be as long as zenkutsu at equal hip height, 70 % rear', () => {
  it('at ZENKUTSU.S = 0.540 H the front leg would need 0.530 H against 0.492 H available', () => {
    /* The section title, executed. This is the load-bearing claim of the whole section: the three
     * doctrines "70/30", "equal stance height" and "two shoulder widths long" cannot all be true,
     * and §4.3 drops the third. */
    const need = requiredFrontLegH(STANCES.zenkutsu.S.v);
    expect(need).toBeCloseTo(0.5296, 4);
    expect(need).toBeGreaterThan(LEG_LENGTH_H);
    expect(need - LEG_LENGTH_H).toBeGreaterThan(0.03); // 6.7 cm short at H = 175
  });

  it('row 1 — S = 0.518 H (two shoulder widths), 70 % rear, PELVIS_Y = 0.410 H: INFEASIBLE', () => {
    /* doc 01 §4.3's table row 1: "INFEASIBLE (front leg needs 0.517 H > 0.491 H)". The solve
     * gives **0.5188 H** on the rig's own segment lengths — 0.0018 H above the doc's 0.517, which
     * is the doc having used the 0.0415 H rig-heel datum in that one cell where the rest of the
     * section uses the 0.039 H AJC height (row 2 below reproduces to 0.0012 H on 0.039). The
     * INEQUALITY, which is the actual result, is unaffected either way. */
    expect(TWO_SHOULDER_WIDTHS_H).toBeCloseTo(0.518, 12);
    const need = requiredFrontLegH(TWO_SHOULDER_WIDTHS_H);
    expect(need).toBeCloseTo(0.5188, 4);
    expect(need).toBeGreaterThan(LEG_LENGTH_H);
    expect(need).toBeGreaterThan(ANTHRO.LEG_EXT!.v); // the doc's own 0.491 H ceiling too
  });

  it('row 2 — S = 0.518 H with the front leg STRAIGHT forces PELVIS_Y to 0.371 H (doc: 0.370)', () => {
    /* "PELVIS_Y = 0.370 H → drop 0.160 H; rear knee 83.7°; breaks the equal-height invariant."
     * Solved by inverting the same predicate for `pelvisYH`: the hip height at which the required
     * front leg is EXACTLY the available one. */
    const rise = Math.sqrt(LEG_LENGTH_H ** 2 - (REAR_LOAD_FRAC * TWO_SHOULDER_WIDTHS_H) ** 2);
    const pelvisY = rise + AJC_HEIGHT_H;
    expect(pelvisY).toBeCloseTo(0.3712, 4);
    expect(Math.abs(pelvisY - 0.37)).toBeLessThan(0.002);
    /* Confirm the inversion by feeding it back through the solve's own predicate. */
    expect(requiredFrontLegH(TWO_SHOULDER_WIDTHS_H, pelvisY)).toBeCloseTo(LEG_LENGTH_H, 9);

    /* The drop against doc 01 §1's standing hip height, 0.530 H: doc 01 §4.3 says 0.160 H. */
    expect(ANTHRO.HIP_Y_STAND!.v - pelvisY).toBeCloseTo(0.159, 3);

    /* "rear knee 83.7°" — the rear leg at the SAME forced hip height. It is the consequence that
     * makes the row absurd, not the hip height itself: an 84° rear knee at kokutsu is a squat. */
    const rearFlex = kneeFlexClosedFormDeg(
      Math.hypot(pelvisY - AJC_HEIGHT_H, FRONT_LOAD_FRAC * TWO_SHOULDER_WIDTHS_H),
    );
    expect(rearFlex).toBeCloseTo(83.55, 2);
    expect(Math.abs(rearFlex - 83.7)).toBeLessThan(0.5);

    /* "breaks the equal-height invariant" — doc 01 §2, tolerance `FIGHT_PELVIS_Y_TOL = 0.010 H`. */
    expect(Math.abs(pelvisY - PELVIS_Y_H)).toBeGreaterThan(0.01);
  });

  it('row 3 — S = 0.518 H at PELVIS_Y = 0.410 H forces the rear load down to ~62 % (doc: <= 60 %)', () => {
    /* "rear load must fall to <= 60 % (front-knee flexion 19.4°)". The exact ceiling on the rig's
     * segment lengths is 62.3 %; the doc's "<= 60 %" is that rounded DOWN to a round number, and
     * the doc's parenthetical is evaluated at 60 %, which is what is checked here. */
    const maxHoriz = Math.sqrt(LEG_LENGTH_H ** 2 - (PELVIS_Y_H - AJC_HEIGHT_H) ** 2);
    const maxRearShare = maxHoriz / TWO_SHOULDER_WIDTHS_H;
    expect(maxRearShare).toBeCloseTo(0.6232, 4);
    expect(maxRearShare).toBeLessThan(REAR_LOAD_FRAC);   // i.e. 70 % is out of reach
    expect(maxRearShare).toBeGreaterThan(0.6);           // i.e. the doc's 60 % IS reachable

    /* At the doc's 60 %, the front leg fits — and its knee flexion is the doc's 19.4°.
     * 20.46° here: the 1.06° offset is the de Leva rig chain (0.2425 / 0.2493 H) against doc 01
     * §1's D&C lengths (0.245 / 0.246 H), which is the same substitution that separates 0.4918 H
     * from 0.491 H above. Asserted at ±1.5° with the measured value pinned, not widened silently. */
    const need60 = Math.hypot(PELVIS_Y_H - AJC_HEIGHT_H, 0.6 * TWO_SHOULDER_WIDTHS_H);
    expect(need60).toBeLessThan(LEG_LENGTH_H);
    const frontFlex60 = kneeFlexClosedFormDeg(need60);
    expect(frontFlex60).toBeCloseTo(20.46, 2);
    expect(Math.abs(frontFlex60 - 19.4)).toBeLessThan(1.5);
  });

  it('row 4 — S = 0.446 H, 70 % rear, PELVIS_Y = 0.410 H is CONSISTENT (the shipped stance)', () => {
    /* The row the project ships. `STANCES.kokutsu.S` must be feasible, with margin — a stance
     * length that only just fits would sit on the soften shoulder at every plant. */
    const need = requiredFrontLegH(STANCES.kokutsu.S.v);
    expect(STANCES.kokutsu.S.v).toBe(0.446);
    expect(need).toBeCloseTo(0.4849, 4);
    expect(need).toBeLessThan(LEG_LENGTH_H);
    expect(LEG_LENGTH_H - need).toBeGreaterThan(0.005);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * doc 01 §4.1's HARD LIMIT and §4.2's KNEES — the same predicate, read the other way
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 01 §4.1 — `S` geometric MAX at PELVIS_Y = 0.410 H is 0.459 H', () => {
  /** The `S` at which the front leg is exactly straight: `sqrt(LEG² − rise²) / rearShare`. */
  const sMaxFor = (legH: number): number =>
    Math.sqrt(legH ** 2 - (PELVIS_Y_H - AJC_HEIGHT_H) ** 2) / REAR_LOAD_FRAC;

  it('doc 01 §1\'s LEG_EXT = 0.491 H reproduces the doc\'s 0.459 H exactly', () => {
    /* doc 01 is internally consistent: its own leg length and its own hip height give its own
     * published hard limit to 4e-4 H. That is what makes the rig's slightly different number a
     * segment-table difference rather than a mistake. */
    expect(sMaxFor(ANTHRO.LEG_EXT!.v)).toBeCloseTo(0.459, 3);
  });

  it('the rig\'s LEG_LENGTH_H = 0.4918 H gives 0.461 H — and the shipped 0.446 H is inside it', () => {
    const sMax = sMaxFor(LEG_LENGTH_H);
    expect(sMax).toBeCloseTo(0.4612, 4);
    expect(STANCES.kokutsu.S.v).toBeLessThan(sMax);
    /* …while both rejected lengths are outside it. This is the impossibility result stated as a
     * bound on `S` rather than as a bound on the leg — the same inequality, transposed. */
    expect(TWO_SHOULDER_WIDTHS_H).toBeGreaterThan(sMax);
    expect(STANCES.zenkutsu.S.v).toBeGreaterThan(sMax);
  });

  it('at exactly `S_max` the required front leg equals the available leg', () => {
    expect(requiredFrontLegH(sMaxFor(LEG_LENGTH_H))).toBeCloseTo(LEG_LENGTH_H, 9);
  });
});

describe('doc 01 §4.2 — the knee flexions the consistent row implies', () => {
  const rise = PELVIS_Y_H - AJC_HEIGHT_H;
  const S = STANCES.kokutsu.S.v;

  it('front knee ~19° (doc: 18, band 10 … 25) and rear knee ~73° (doc: 73 ± 6)', () => {
    /* Both legs of the shipped kokutsu, from the same two spans doc 01 §4.2 tabulates as
     * `hip jc Z behind front ankle 0.312` and `hip jc Z ahead of rear ankle 0.134`. Reproducing
     * §4.2 from the §4.3 predicate is what closes the section: the stance length §4.3 permits is
     * the stance length that yields §4.2's knees. */
    const frontFlex = kneeFlexClosedFormDeg(Math.hypot(rise, REAR_LOAD_FRAC * S));
    const rearFlex = kneeFlexClosedFormDeg(Math.hypot(rise, FRONT_LOAD_FRAC * S));
    expect(frontFlex).toBeGreaterThan(10);
    expect(frontFlex).toBeLessThan(25);
    expect(Math.abs(rearFlex - STANCES.kokutsu.kneeRear.v)).toBeLessThan(6);
    expect(frontFlex).toBeCloseTo(19.25, 2);
    expect(rearFlex).toBeCloseTo(73.38, 2);
  });

  it('the two hip spans are doc 01 §4.2\'s 0.312 H and 0.134 H', () => {
    expect(REAR_LOAD_FRAC * S).toBeCloseTo(0.312, 3);
    expect(FRONT_LOAD_FRAC * S).toBeCloseTo(0.134, 3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * doc 01 §4.3's THIRD RANKING ITEM — where the "two shoulder widths" claim came from
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 01 §4.3 — "drop it; use 1.72 sw"', () => {
  it('the shipped kokutsu is 1.72 shoulder widths, not 2', () => {
    expect(STANCES.kokutsu.S.v / ANTHRO.SHOULDER_W!.v).toBeCloseTo(1.72, 2);
  });

  it('front toe -> rear ankle IS ~2.1 sw — the doc\'s proposed origin of the mis-transfer', () => {
    /* doc 01 §4.3: "front toe → rear ankle = 0.546 H ≈ 2.1 sw, which is probably the origin of
     * the '2 sw' claim". doc 01 §4.1's keypoints put the front toe at `Z = −0.100` and the rear
     * ankle at `Z = +0.446`. This is the only part of the section that is an explanation rather
     * than a proof, and it costs one assertion to check it is at least arithmetically true. */
    const frontToeToRearAnkle = ANTHRO.TOE_AHEAD!.v + STANCES.kokutsu.S.v;
    expect(frontToeToRearAnkle).toBeCloseTo(0.546, 3);
    expect(frontToeToRearAnkle / ANTHRO.SHOULDER_W!.v).toBeCloseTo(2.1, 1);
    /* And that measurement, unlike the ankle-to-ankle one, is NOT a stance length — feeding it
     * to the predicate reproduces the infeasibility all over again. */
    expect(requiredFrontLegH(frontToeToRearAnkle)).toBeGreaterThan(LEG_LENGTH_H);
  });
});
