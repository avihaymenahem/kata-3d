/**
 * tests/data/embusen.test.ts — doc 02 §11's seven generator invariants, σ-symmetry, the closure
 * residual and the bounding box (OWNERSHIP B1).
 *
 * ── WHY THERE IS A FIXTURE IN HERE ─────────────────────────────────────────────────────────
 * `assertEmbusenInvariants(k: KataScore)` takes B2's data, and `src/data/kata/**` does not exist
 * until Phase 2 (§8). ARCHITECTURE §8 explicitly sanctions the answer: "consumer-side fixtures live
 * in the consumer's own `tests/<block>/` — never as a stub inside another block's directory." The
 * `TAIKYOKU_FIXTURE` below is that fixture: doc 02 §4.1's movement table and §4.2's coordinate table
 * transcribed for the sole purpose of EXERCISING THE GENERATOR. It is **not** kata data — it carries
 * no labels, no kanji and no ceremony, it lives in a test file, and B2 owns the shipping transcription.
 *
 * ── THE ONE RED-FIRST TEST ─────────────────────────────────────────────────────────────────
 * The last `describe` runs the same invariants against B2's REAL `getKata`, and is RED until Phase 2
 * by construction — the same pattern B0 used for the single deliberate cross-block assertion in
 * `tests/contracts/bones.test.ts` and `ease.test.ts`. It must not be deleted or made vacuous to go
 * green: it is the only thing that will notice if B2's transcription and this generator disagree.
 * §8's Phase-1 exit gate requires `tests/data/derived` green, not this file.
 */

import { describe, expect, it } from 'vitest';
import type {
  EmbXZ,
  Handedness,
  KataMove,
  KataScore,
  PivotKind,
  PivotRule,
  TempoClass,
} from '../../src/contracts';
import { EMB_POLYLINE_H_L, MOVE_SECONDS_T1, embSigma } from '../../src/contracts';
import {
  EMPTY_PATCH,
  EMB_BBOX,
  EMB_CLOSURE_TOL_L,
  PIVOT_RULE_SPEC,
  YOI_CENTRE,
  YOI_FOOT_L,
  YOI_FOOT_R,
  anchorFootFor,
  assertEmbusenInvariants,
  embusenFrontFootTrace,
  embusenPolyline,
  embusenToMetres,
  expectedPivotFoot,
  footPlanFor,
  footPlansFor,
  L_M,
  sigma,
  yameClosureResidualL,
} from '../../src/data/embusen';
import { TEMPO_CLASSES } from '../../src/data/constants/dynamics';

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * THE FIXTURE. doc 02 §4.1 (movement table) + §4.2 (coordinates), Taikyoku Shodan.
 * Row order: n, dH, H, rule, pivot, mover, front, gedan-barai?, kiai, tempo, tSlot, ff, rf, c
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

type Row = readonly [
  n: number,
  dH: number,
  h: number,
  rule: PivotRule,
  pivot: Handedness | null,
  mover: Handedness,
  front: Handedness,
  isBlock: boolean,
  kiai: boolean,
  tempo: TempoClass,
  tSlot: number,
  ff: EmbXZ,
  rf: EmbXZ,
  c: EmbXZ,
];

const T: readonly Row[] = [
  [1, 90, 90, 'R3', 'R', 'L', 'L', true, false, 'M1', 2.0, [0.81, 0], [-0.19, 0], [0.31, 0]],
  [2, 0, 90, 'R1', null, 'R', 'R', false, false, 'N', 1.85, [1.81, 0], [0.81, 0], [1.31, 0]],
  [3, -180, 270, 'R2', 'L', 'R', 'R', true, false, 'T180', 2.05, [-0.19, 0], [0.81, 0], [0.31, 0]],
  [4, 0, 270, 'R1', null, 'L', 'L', false, false, 'N', 1.85, [-1.19, 0], [-0.19, 0], [-0.69, 0]],
  [5, 90, 0, 'R4', 'R', 'L', 'L', true, false, 'T90', 2.05, [-0.19, -1.0], [-0.19, 0], [-0.19, -0.5]],
  [6, 0, 0, 'R1', null, 'R', 'R', false, false, 'N', 1.85, [-0.19, -2.0], [-0.19, -1.0], [-0.19, -1.5]],
  [7, 0, 0, 'R1', null, 'L', 'L', false, false, 'F', 0.8, [-0.19, -3.0], [-0.19, -2.0], [-0.19, -2.5]],
  [8, 0, 0, 'R1', null, 'R', 'R', false, true, 'F', 0.8, [-0.19, -4.0], [-0.19, -3.0], [-0.19, -3.5]],
  [9, 270, 270, 'R3', 'R', 'L', 'L', true, false, 'T270', 2.5, [-1.19, -4.0], [-0.19, -4.0], [-0.69, -4.0]],
  [10, 0, 270, 'R1', null, 'R', 'R', false, false, 'N', 1.85, [-2.19, -4.0], [-1.19, -4.0], [-1.69, -4.0]],
  [11, -180, 90, 'R2', 'L', 'R', 'R', true, false, 'T180', 2.05, [-0.19, -4.0], [-1.19, -4.0], [-0.69, -4.0]],
  [12, 0, 90, 'R1', null, 'L', 'L', false, false, 'N', 1.85, [0.81, -4.0], [-0.19, -4.0], [0.31, -4.0]],
  [13, 90, 180, 'R4', 'R', 'L', 'L', true, false, 'T90', 2.05, [-0.19, -3.0], [-0.19, -4.0], [-0.19, -3.5]],
  [14, 0, 180, 'R1', null, 'R', 'R', false, false, 'N', 1.85, [-0.19, -2.0], [-0.19, -3.0], [-0.19, -2.5]],
  [15, 0, 180, 'R1', null, 'L', 'L', false, false, 'F', 0.8, [-0.19, -1.0], [-0.19, -2.0], [-0.19, -1.5]],
  [16, 0, 180, 'R1', null, 'R', 'R', false, true, 'F', 0.8, [-0.19, 0], [-0.19, -1.0], [-0.19, -0.5]],
  [17, 270, 90, 'R3', 'R', 'L', 'L', true, false, 'T270', 2.5, [0.81, 0], [-0.19, 0], [0.31, 0]],
  [18, 0, 90, 'R1', null, 'R', 'R', false, false, 'N', 1.85, [1.81, 0], [0.81, 0], [1.31, 0]],
  [19, -180, 270, 'R2', 'L', 'R', 'R', true, false, 'T180', 2.05, [-0.19, 0], [0.81, 0], [0.31, 0]],
  [20, 0, 270, 'R1', null, 'L', 'L', false, false, 'N', 1.85, [-1.19, 0], [-0.19, 0], [-0.69, 0]],
];

const toMove = (r: Row): KataMove => ({
  n: r[0],
  label: `fixture-${r[0]}`,
  labelJp: '',
  labelEn: '',
  dHeadingDeg: r[1],
  headingDeg: r[2],
  rule: r[3],
  pivot: r[4],
  pivotKind: (r[3] === 'R1' || r[3] === 'R0' ? 'NONE' : 'HEEL') as PivotKind,
  mover: r[5],
  stance: 'zenkutsu',
  front: r[6],
  weighted: r[6],
  hips: r[7] ? 'hanmi' : 'shomen',
  tech: r[7]
    ? { id: 'gedan-barai', arm: r[6], level: 'gedan', targetH: 0.36, hand: 'seiken' }
    : { id: 'oi-zuki', arm: r[6], level: 'chudan', targetH: 0.72, hand: 'seiken' },
  hikite: 'HIP-A',
  kiai: r[8],
  tempo: r[9],
  pause: r[8] ? 'P3' : 'P1',
  sim: r[7] ? 'S2' : 'S1',
  tSlotS: r[10],
  embusen: { ff: r[11], rf: r[12], c: r[13] },
  src: `docs/research/02-kata-sequences.md §4.1 row ${r[0]}`,
});

const TAIKYOKU_FIXTURE: KataScore = {
  schema: 'kata-score/1',
  id: 'taikyoku-shodan',
  displayName: 'Taikyoku Shodan (test fixture)',
  displayNameJp: '',
  moveCount: T.length,
  kiaiAt: [8, 16],
  fastPairs: [
    [7, 8],
    [15, 16],
  ],
  openingCeremony: [],
  moves: T.map(toMove),
  closingCeremony: [],
  totalMoveSecondsT1: 35.25,
  provenance: ['docs/research/02-kata-sequences.md §4.1', 'docs/research/02-kata-sequences.md §4.2'],
};

/* ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the σ map itself (doc 02 §3.2)', () => {
  it('is doc 02\'s own (-0.38 - x, -4.00 - z), and it is an involution', () => {
    expect(sigma).toBe(embSigma);
    expect(sigma(0.31, 0)).toEqual([-0.69, -4.0]);
    const [x, z] = sigma(1.31, -1.5);
    expect(sigma(x, z)[0]).toBeCloseTo(1.31, 12);
    expect(sigma(x, z)[1]).toBeCloseTo(-1.5, 12);
  });

  it('its x constant is -2h, so the axis sits at x = -h, not at x = 0', () => {
    expect(-0.38).toBe(-2 * EMB_POLYLINE_H_L);
    // The centre of symmetry is P0 = (-h, -2.00) — doc 02 §3.2's own point.
    const [px, pz] = sigma(-EMB_POLYLINE_H_L, -2.0);
    expect(px).toBeCloseTo(-EMB_POLYLINE_H_L, 12);
    expect(pz).toBeCloseTo(-2.0, 12);
  });
});

describe('the yoi datum and the L -> metre conversion', () => {
  it('yoi feet are (+h, 0) and (-h, 0) with c = (0, 0)', () => {
    expect(YOI_FOOT_L).toEqual([EMB_POLYLINE_H_L, 0]);
    expect(YOI_FOOT_R).toEqual([-EMB_POLYLINE_H_L, 0]);
    expect(YOI_CENTRE).toEqual([0, 0]);
    expect((YOI_FOOT_L[0] + YOI_FOOT_R[0]) / 2).toBe(YOI_CENTRE[0]);
  });

  it('embusenToMetres scales by the DERIVED L_M = 0.945 m', () => {
    expect(embusenToMetres([1, 0])).toEqual([L_M, 0]);
    expect(embusenToMetres([0.31, -4.0])[0]).toBeCloseTo(0.31 * 0.945, 9);
    // doc 02 §4.2's cm column used the OLD L (91.0 cm): +0.31 L -> +28.2 cm. With the derived L it
    // is 29.3 cm. That shift is C02, and it is why the tables stay dimensionless in L.
    expect(0.31 * 91.0).toBeCloseTo(28.2, 1);
    expect(0.31 * L_M * 100).toBeCloseTo(29.3, 1);
  });
});

describe('R0–R5 (doc 02 §3.1) — the rule table and its two orthogonal facts', () => {
  it('all six rules exist; R0 and R1 have no PIVOT even though a foot is stationary', () => {
    for (const r of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'] as const) {
      expect(PIVOT_RULE_SPEC[r], r).toBeDefined();
      expect(PIVOT_RULE_SPEC[r].desc.length, r).toBeGreaterThan(0);
    }
    expect(PIVOT_RULE_SPEC.R0.pivots).toBe(false);
    expect(PIVOT_RULE_SPEC.R1.pivots).toBe(false);
    for (const r of ['R2', 'R3', 'R4', 'R5'] as const) expect(PIVOT_RULE_SPEC[r].pivots, r).toBe(true);
  });

  it('the front leg changes on the step-through rules and holds on the turn-in-place rules', () => {
    expect(PIVOT_RULE_SPEC.R1.frontChanges).toBe(true);
    expect(PIVOT_RULE_SPEC.R3.frontChanges).toBe(true);
    expect(PIVOT_RULE_SPEC.R5.frontChanges).toBe(true);
    expect(PIVOT_RULE_SPEC.R2.frontChanges).toBe(false);
    expect(PIVOT_RULE_SPEC.R4.frontChanges).toBe(false);
    expect(PIVOT_RULE_SPEC.R0.frontChanges).toBe(false);
  });

  it('move 1 leaves hachiji, where there is no front foot, so the anchor comes from `pivot`', () => {
    const m1 = TAIKYOKU_FIXTURE.moves[0]!;
    expect(anchorFootFor(null, m1)).toBe('R');
    const p = footPlanFor(null, m1, EMPTY_PATCH('taikyoku-shodan', 1));
    expect(p.rfXZ).toEqual(YOI_FOOT_R); // the right foot never moved
    expect(p.ffXZ[0]).toBeCloseTo(0.81, 12);
    expect(p.frontFoot).toBe('L');
  });

  it('the anchor always becomes the new REAR foot — that is why all five rules are two lines', () => {
    const plans = footPlansFor(TAIKYOKU_FIXTURE);
    let prev = null as (typeof plans)[number] | null;
    for (const [i, plan] of plans.entries()) {
      const m = TAIKYOKU_FIXTURE.moves[i]!;
      if (m.rule === 'R0') continue;
      const anchor = anchorFootFor(prev, m)!;
      const anchorPos =
        prev === null
          ? anchor === 'L'
            ? YOI_FOOT_L
            : YOI_FOOT_R
          : anchor === prev.frontFoot
            ? prev.ffXZ
            : prev.rfXZ;
      expect(plan.rfXZ, `move ${m.n}`).toEqual(anchorPos);
      prev = plan;
    }
  });

  it('every step is exactly 1.00 L long, and c is exactly the midpoint', () => {
    for (const p of footPlansFor(TAIKYOKU_FIXTURE)) {
      expect(Math.hypot(p.ffXZ[0] - p.rfXZ[0], p.ffXZ[1] - p.rfXZ[1]), `move ${p.moveN}`).toBeCloseTo(1.0, 9);
      expect(p.cXZ[0]).toBeCloseTo((p.ffXZ[0] + p.rfXZ[0]) / 2, 12);
      expect(p.cXZ[1]).toBeCloseTo((p.ffXZ[1] + p.rfXZ[1]) / 2, 12);
    }
  });

  it('the R0 footExcursion path exists and defaults to doc 02 §6.2\'s retract-return', () => {
    // Heian 4 is the only R0 move. Build it as a one-off: same shape, rule R0, no displacement.
    const prev = footPlanFor(null, TAIKYOKU_FIXTURE.moves[0]!, EMPTY_PATCH('taikyoku-shodan', 1));
    const r0: KataMove = {
      ...TAIKYOKU_FIXTURE.moves[1]!,
      n: 4,
      rule: 'R0',
      pivot: null,
      mover: prev.frontFoot,
      front: prev.frontFoot,
      dHeadingDeg: 0,
      headingDeg: prev.headingDeg,
      tempo: 'N',
      embusen: { ff: prev.ffXZ as EmbXZ, rf: prev.rfXZ as EmbXZ, c: prev.cXZ as EmbXZ },
    };
    const plan = footPlanFor(prev, r0, EMPTY_PATCH('heian-shodan', 4));
    // Net displacement is ZERO — that is the whole point of R0.
    expect(plan.ffXZ).toEqual(prev.ffXZ);
    expect(plan.rfXZ).toEqual(prev.rfXZ);
    expect(plan.cXZ).toEqual(prev.cXZ);
    // And the excursion is synthesised from doc 02 §6.2: 0.50 L back along -f, torso rises 0.03 H.
    expect(plan.excursion).not.toBeNull();
    expect(plan.excursion!.deltaL).toBe(0.5);
    expect(plan.excursion!.torsoRiseH).toBeCloseTo(0.03, 9);
    expect(plan.excursion!.foot).toBe(prev.frontFoot);
    // atTau is the end of t_prep as a fraction of the slot: (t_hold + t_prep) / t_slot.
    const c = TEMPO_CLASSES.N;
    const slot = c.tHold.v + c.tPrep.v + c.tTransit.v + c.tKime.v;
    expect(plan.excursion!.atTau).toBeCloseTo((c.tHold.v + c.tPrep.v) / slot, 12);
    expect(plan.excursion!.atTau).toBeGreaterThan(0);
    expect(plan.excursion!.atTau).toBeLessThan(1);
    // A transient -0.25 L * f at the wind-up peak: doc 02 §3.1's own Δc cross-check for R0.
    expect(plan.excursion!.deltaL / 2).toBeCloseTo(0.25, 12);
  });

  it('a patch-supplied footExcursion overrides the R0 default', () => {
    const prev = footPlanFor(null, TAIKYOKU_FIXTURE.moves[0]!, EMPTY_PATCH('taikyoku-shodan', 1));
    const r0: KataMove = { ...TAIKYOKU_FIXTURE.moves[1]!, n: 4, rule: 'R0', pivot: null };
    const patched = footPlanFor(prev, r0, {
      ...EMPTY_PATCH('heian-shodan', 4),
      reason: 'test',
      override: { footExcursion: { foot: 'L', atTau: 0.4, deltaL: 0.25, torsoRiseH: 0.01 } },
    });
    expect(patched.excursion).toEqual({ foot: 'L', atTau: 0.4, deltaL: 0.25, torsoRiseH: 0.01 });
  });

  it('a non-R0 move carries no excursion unless a patch adds one', () => {
    const p = footPlanFor(null, TAIKYOKU_FIXTURE.moves[0]!, EMPTY_PATCH('taikyoku-shodan', 1));
    expect(p.excursion).toBeNull();
  });

  it('expectedPivotFoot CHECKS the authored pivot rather than trusting it', () => {
    const plans = footPlansFor(TAIKYOKU_FIXTURE);
    let prev = null as (typeof plans)[number] | null;
    for (const [i, m] of TAIKYOKU_FIXTURE.moves.entries()) {
      expect(expectedPivotFoot(prev, m), `move ${m.n} rule ${m.rule}`).toBe(m.pivot);
      prev = plans[i]!;
    }
  });
});

describe('doc 02 §11 — the seven generator invariants, on the §4.1/§4.2 fixture', () => {
  it('assertEmbusenInvariants passes on the transcribed table', () => {
    expect(() => assertEmbusenInvariants(TAIKYOKU_FIXTURE)).not.toThrow();
  });

  it('I1 · the heading chain reproduces every headingDeg', () => {
    let h = 0;
    for (const m of TAIKYOKU_FIXTURE.moves) {
      h = (((h + m.dHeadingDeg) % 360) + 360) % 360;
      expect(h, `move ${m.n}`).toBe(m.headingDeg % 360);
    }
    // …and it catches a broken chain.
    const broken = {
      ...TAIKYOKU_FIXTURE,
      moves: TAIKYOKU_FIXTURE.moves.map((m) => (m.n === 5 ? { ...m, headingDeg: 45 } : m)),
    };
    expect(() => assertEmbusenInvariants(broken)).toThrow(/I1-heading-chain/);
  });

  it('I2 · ff / rf / c all recompute from pivot + Lk*f(H), and a wrong pivot is caught', () => {
    for (const [i, plan] of footPlansFor(TAIKYOKU_FIXTURE).entries()) {
      const m = TAIKYOKU_FIXTURE.moves[i]!;
      expect(plan.ffXZ[0], `ff.x move ${m.n}`).toBeCloseTo(m.embusen.ff[0], 9);
      expect(plan.ffXZ[1], `ff.z move ${m.n}`).toBeCloseTo(m.embusen.ff[1], 9);
      expect(plan.rfXZ[0], `rf.x move ${m.n}`).toBeCloseTo(m.embusen.rf[0], 9);
      expect(plan.cXZ[0], `c.x move ${m.n}`).toBeCloseTo(m.embusen.c[0], 9);
      expect(plan.cXZ[1], `c.z move ${m.n}`).toBeCloseTo(m.embusen.c[1], 9);
    }
    // doc 02 §9 d1: pivoting move 3 on the FRONT foot advances c by +1 L and breaks yame closure.
    const wrongPivot = {
      ...TAIKYOKU_FIXTURE,
      moves: TAIKYOKU_FIXTURE.moves.map((m) => (m.n === 3 ? { ...m, pivot: 'R' as Handedness } : m)),
    };
    expect(() => assertEmbusenInvariants(wrongPivot)).toThrow(/I2-pivot-foot/);
  });

  it('I2 · this fixture recomputes to 1e-9 L, because §4.2 has no rounded diagonal rows', () => {
    expect(() => assertEmbusenInvariants(TAIKYOKU_FIXTURE, 1e-9)).not.toThrow();
  });

  it('I3 · σ(c_i) === c_(i+8) for i = 1..8, and c_17..c_20 === c_1..c_4', () => {
    const c = (n: number) => TAIKYOKU_FIXTURE.moves.find((m) => m.n === n)!.embusen.c;
    for (let i = 1; i <= 8; i++) {
      const [sx, sz] = sigma(c(i)[0], c(i)[1]);
      expect(sx, `sigma(c${i}).x`).toBeCloseTo(c(i + 8)[0], 9);
      expect(sz, `sigma(c${i}).z`).toBeCloseTo(c(i + 8)[1], 9);
    }
    for (let i = 17; i <= 20; i++) expect(c(i)).toEqual(c(i - 16));
    // Break one and the invariant fires.
    const broken = {
      ...TAIKYOKU_FIXTURE,
      moves: TAIKYOKU_FIXTURE.moves.map((m) =>
        m.n === 9 ? { ...m, embusen: { ...m.embusen, c: [-0.5, -4.0] as EmbXZ } } : m,
      ),
    };
    expect(() => assertEmbusenInvariants(broken)).toThrow(/I2-c-recompute|I3-sigma/);
  });

  it('I4 · the yame closure residual is 0.00 L, well under the 0.01 L tolerance', () => {
    expect(yameClosureResidualL(TAIKYOKU_FIXTURE)).toBeCloseTo(0, 12);
    expect(yameClosureResidualL(TAIKYOKU_FIXTURE)).toBeLessThan(EMB_CLOSURE_TOL_L);
    // The right foot has been on (-h, 0) since move 19 — that is what makes closure exact.
    const last = TAIKYOKU_FIXTURE.moves[TAIKYOKU_FIXTURE.moves.length - 1]!;
    expect(last.embusen.rf).toEqual([-EMB_POLYLINE_H_L, 0]);
  });

  it('I5 · sum tSlotS lands within 20 % of doc 02\'s 35.25 s', () => {
    const sum = TAIKYOKU_FIXTURE.moves.reduce((a, m) => a + m.tSlotS, 0);
    expect(sum).toBeCloseTo(35.25, 6);
    expect(Math.abs(sum - MOVE_SECONDS_T1['taikyoku-shodan'])).toBeLessThan(
      MOVE_SECONDS_T1['taikyoku-shodan'] * 0.2,
    );
    const slow = {
      ...TAIKYOKU_FIXTURE,
      moves: TAIKYOKU_FIXTURE.moves.map((m) => ({ ...m, tSlotS: m.tSlotS * 1.5 })),
    };
    expect(() => assertEmbusenInvariants(slow)).toThrow(/I5-tslot-total/);
  });

  it('I6 · exactly two kiai, at 8 and 16, and kiaiAt agrees with the moves', () => {
    expect(TAIKYOKU_FIXTURE.moves.filter((m) => m.kiai).map((m) => m.n)).toEqual([8, 16]);
    const wrong = {
      ...TAIKYOKU_FIXTURE,
      moves: TAIKYOKU_FIXTURE.moves.map((m) => (m.n === 7 ? { ...m, kiai: true } : m)),
    };
    expect(() => assertEmbusenInvariants(wrong)).toThrow(/I6-kiai/);
  });

  it('I7 · every c is inside the 4 L x 4 L box, and the box is doc 02 §3.2\'s', () => {
    for (const m of TAIKYOKU_FIXTURE.moves) {
      const [x, z] = m.embusen.c;
      expect(x, `move ${m.n} c.x`).toBeGreaterThanOrEqual(EMB_BBOX.xMin);
      expect(x, `move ${m.n} c.x`).toBeLessThanOrEqual(EMB_BBOX.xMax);
      expect(z, `move ${m.n} c.z`).toBeGreaterThanOrEqual(EMB_BBOX.zMin);
      expect(z, `move ${m.n} c.z`).toBeLessThanOrEqual(EMB_BBOX.zMax);
    }
    // The "I" is NOT mirror-symmetric: the bars are offset by exactly 1.00 L (doc 02 §3.2).
    const bottomBarCentreX = 0.31;
    const topBarCentreX = -0.69;
    expect(bottomBarCentreX - topBarCentreX).toBeCloseTo(1.0, 9);
  });
});

describe('the polylines', () => {
  it('embusenPolyline is the stance-centre track, yoi-bracketed', () => {
    const poly = embusenPolyline(TAIKYOKU_FIXTURE);
    expect(poly).toHaveLength(TAIKYOKU_FIXTURE.moves.length + 2);
    expect(poly[0]).toEqual(YOI_CENTRE);
    expect(poly[poly.length - 1]).toEqual(YOI_CENTRE);
    expect(poly[1]).toEqual([0.31, 0]);
  });

  it('embusenFrontFootTrace is doc 02 §3.2\'s front-foot polyline and spans the full bbox', () => {
    const trace = embusenFrontFootTrace(TAIKYOKU_FIXTURE);
    expect(trace[0]).toEqual(YOI_FOOT_L);
    const xs = trace.map((p) => p[0]);
    const zs = trace.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(EMB_BBOX.xMin, 9);
    expect(Math.max(...xs)).toBeCloseTo(EMB_BBOX.xMax, 9);
    expect(Math.min(...zs)).toBeCloseTo(EMB_BBOX.zMin, 9);
    expect(Math.max(...zs)).toBeCloseTo(EMB_BBOX.zMax, 9);
  });

  it('footPlanFor is PURE: two runs over the same kata give identical plans', () => {
    const a = footPlansFor(TAIKYOKU_FIXTURE);
    const b = footPlansFor(TAIKYOKU_FIXTURE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RED-FIRST CROSS-BLOCK TEST. See the file header: this is RED until B2 lands
 * `src/data/kata/**` in Phase 2, and it must not be deleted or stubbed to make the file green.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 02 §11 on B2\'s REAL kata data — RED-FIRST until Phase 2', () => {
  it('assertEmbusenInvariants passes on both shipped kata', async () => {
    const mod = (await import('../../src/data')) as unknown as {
      getKata(id: string): KataScore;
    };
    for (const id of ['taikyoku-shodan', 'heian-shodan'] as const) {
      const k = mod.getKata(id);
      expect(k.moves.length, id).toBeGreaterThan(0);
      assertEmbusenInvariants(k);
      expect(yameClosureResidualL(k), `${id} closure`).toBeLessThan(EMB_CLOSURE_TOL_L);
    }
  });
});
