/**
 * tests/eval/precedence.test.ts — ARCHITECTURE.md §2.6, the rule that makes the scorecard honest.
 *
 *   For a reference VALUE, docs 01 / 03 / 02 win, in that order.
 *   For a TOLERANCE and a HARD-FAIL, doc 07 wins.
 *
 * §2.6: "enforced by `tests/eval/precedence.test.ts`, which fails if any metric whose reference
 * appears in 01 §10, 03 §13/§14 or 02 §1.2 uses doc 07's seeded value."
 *
 * This is the test that stops judge 2's fatal A5: with doc 07's seeded `hip_height_H = 0.470` against
 * our correct 0.410, an agent raising the hips would improve the score while standing the karateka
 * out of kihon depth — and the automated fix queue would do it unprompted.
 *
 * Green at the Phase-1 gate; it needs only `src/eval/metricSpecs.ts` and B1's constants.
 */

import { describe, expect, it } from 'vitest';
import {
  DERIVED_01_03_METRICS,
  GROUP_WEIGHT,
  MANDATORY_REF_OVERRIDES,
  METRIC_COUNT,
  METRIC_COUNT_BY_GROUP,
  MOVE_SECONDS_T1,
} from '../../src/contracts';
import type { MetricGroup, MetricId } from '../../src/contracts';
import {
  ALL_REF_OVERRIDES,
  DERIVED_REFS,
  DOC03_CROSSCHECK,
  GH_Y_FIGHT_H,
  METRICS,
  METRIC_BY_ID,
  METRIC_1_BIAS_NOTE,
  METRIC_1_EXPECTED_BIAS_H,
  METRIC_1_EXPECTED_BIAS_PCT,
  REF_PRECEDENCE_APPLIED,
  REGISTRY_AUDIT,
  refFor,
} from '../../src/eval';

const GROUPS: readonly MetricGroup[] = ['G1', 'G2', 'G3', 'G4', 'G5'];

describe('the registry itself (§3.11)', () => {
  it('ships exactly 63 metrics, each id once', () => {
    expect(METRICS).toHaveLength(METRIC_COUNT);
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRIC_COUNT);
  });

  it('splits 17 / 23 / 5 / 9 / 9 across G1..G5', () => {
    for (const g of GROUPS) {
      expect(METRICS.filter((m) => m.group === g).length, g).toBe(METRIC_COUNT_BY_GROUP[g]);
    }
  });

  it('passes its own structural audit with zero problems', () => {
    expect(REGISTRY_AUDIT.problems).toEqual([]);
  });

  it('gives every metric a resolvable fixSite and a doc 07 §6.2 source', () => {
    for (const m of METRICS) {
      expect(m.fixSite.file, m.id).toMatch(/^(?:src|tools|data|assets)\//);
      expect(m.fixSite.symbol, m.id).toMatch(/^[A-Za-z_$][\w$]*$/);
      expect(m.fixSite.knob.length, m.id).toBeGreaterThan(0);
      expect(m.fixSite.hint.length, m.id).toBeGreaterThan(0);
      expect(m.source, m.id).toContain('07-reference-and-datasets.md §6.2');
      expect(m.weight, m.id).toBeGreaterThan(0);
      expect(m.hardFail, m.id).toBeGreaterThanOrEqual(m.tol);
    }
  });

  it('keeps doc 07 §6.3\'s group weights untouched', () => {
    expect(GROUP_WEIGHT).toEqual({ G1: 0.34, G2: 0.3, G3: 0.12, G4: 0.14, G5: 0.1 });
    let sum = 0;
    for (const g of GROUPS) sum += GROUP_WEIGHT[g];
    expect(sum).toBeCloseTo(1, 12);
  });
});

describe('§2.6 — the NINE mandatory reference overrides', () => {
  it('ships all nine, and none of them uses doc 07\'s seed', () => {
    expect(MANDATORY_REF_OVERRIDES).toHaveLength(9);
    for (const o of MANDATORY_REF_OVERRIDES) {
      const spec = METRIC_BY_ID[o.metric];
      expect(spec, o.metric).toBeDefined();
      // The shipped value is the doc-01/03 value, NOT doc 07's seed.
      const tol = o.metric === 'stance_len_H' ? 5e-4 : 1e-9;
      expect(Math.abs(spec.ref - o.ships), `${o.metric} ships ${spec.ref}`).toBeLessThanOrEqual(tol);
      expect(Math.abs(spec.ref - o.doc07Seed), `${o.metric} must not use doc 07's seed`).toBeGreaterThan(1e-6);
      expect(spec.refSource, o.metric).toBe(o.refSource);
      expect(spec.refSource, o.metric).not.toBe('doc07');
    }
  });

  it('names the nine metrics §2.6\'s table names', () => {
    expect(MANDATORY_REF_OVERRIDES.map((o) => o.metric).sort()).toEqual(
      [
        'age_uke_forearm_angle_deg',
        'front_knee_flex_deg',
        'hip_height_H',
        'rear_foot_yaw_deg',
        'rear_knee_flex_deg',
        'shuto_uke_elbow_flex_deg',
        'stance_len_H',
        'stance_width_H',
        'weight_front_pct',
      ].sort(),
    );
  });

  it('ships the exact overridden values of §2.6\'s table', () => {
    expect(METRIC_BY_ID.stance_len_H.ref).toBeCloseTo(0.533, 3);
    expect(METRIC_BY_ID.stance_width_H.ref).toBe(0.17);
    expect(METRIC_BY_ID.front_knee_flex_deg.ref).toBe(57);
    expect(METRIC_BY_ID.rear_knee_flex_deg.ref).toBe(10);
    expect(METRIC_BY_ID.hip_height_H.ref).toBe(0.41);
    expect(METRIC_BY_ID.weight_front_pct.ref).toBe(59);
    expect(METRIC_BY_ID.rear_foot_yaw_deg.ref).toBe(30);
    expect(METRIC_BY_ID.age_uke_forearm_angle_deg.ref).toBe(25);
    expect(METRIC_BY_ID.shuto_uke_elbow_flex_deg.ref).toBe(121);
  });

  it('keeps doc 07\'s tolerances EXACTLY as doc 07 gives them', () => {
    // §2.6: "Tolerances stay exactly as doc 07 §6.2 gives them."
    expect([METRIC_BY_ID.stance_len_H.tol, METRIC_BY_ID.stance_len_H.hardFail]).toEqual([0.05, 0.15]);
    expect([METRIC_BY_ID.stance_width_H.tol, METRIC_BY_ID.stance_width_H.hardFail]).toEqual([0.04, 0.1]);
    expect([METRIC_BY_ID.front_knee_flex_deg.tol, METRIC_BY_ID.front_knee_flex_deg.hardFail]).toEqual([10, 22]);
    expect([METRIC_BY_ID.rear_knee_flex_deg.tol, METRIC_BY_ID.rear_knee_flex_deg.hardFail]).toEqual([7, 20]);
    expect([METRIC_BY_ID.hip_height_H.tol, METRIC_BY_ID.hip_height_H.hardFail]).toEqual([0.025, 0.06]);
    expect([METRIC_BY_ID.weight_front_pct.tol, METRIC_BY_ID.weight_front_pct.hardFail]).toEqual([8, 20]);
    expect([METRIC_BY_ID.rear_foot_yaw_deg.tol, METRIC_BY_ID.rear_foot_yaw_deg.hardFail]).toEqual([12, 30]);
    expect([METRIC_BY_ID.age_uke_forearm_angle_deg.tol, METRIC_BY_ID.age_uke_forearm_angle_deg.hardFail]).toEqual([12, 28]);
    expect([METRIC_BY_ID.shuto_uke_elbow_flex_deg.tol, METRIC_BY_ID.shuto_uke_elbow_flex_deg.hardFail]).toEqual([15, 35]);
  });
});

describe('§2.6 — the FIVE DERIVED_01_03 metrics', () => {
  it('tags exactly the five frozen ids and gives each a mandatory derivation', () => {
    expect([...DERIVED_01_03_METRICS].sort()).toEqual(
      ['active_fist_H', 'age_uke_wrist_H', 'gedan_barai_fist_H', 'shuto_uke_hand_H', 'tettsui_uchi_fist_H'].sort(),
    );
    for (const id of DERIVED_01_03_METRICS) {
      expect(METRIC_BY_ID[id].refSource, id).toBe('DERIVED_01_03');
      expect(METRIC_BY_ID[id].derivation, id).toBeTruthy();
    }
    // No OTHER metric may claim the tag.
    const tagged = METRICS.filter((m) => m.refSource === 'DERIVED_01_03').map((m) => m.id).sort();
    expect(tagged).toEqual([...DERIVED_01_03_METRICS].sort());
  });

  it('evaluates doc 03\'s GH-relative offsets against doc 01\'s zenkutsu GH world position', () => {
    // GH_Y_STAND (doc 03 §1.3) 0.818 - PELVIS_DROP_FIGHT (doc 01 §10) 0.120 = 0.698.
    expect(GH_Y_FIGHT_H).toBeCloseTo(0.698, 9);
    expect(METRIC_BY_ID.active_fist_H.ref).toBeCloseTo(0.58, 9); // chudan
    expect(METRIC_BY_ID.gedan_barai_fist_H.ref).toBeCloseTo(0.508, 9);
    expect(METRIC_BY_ID.age_uke_wrist_H.ref).toBeCloseTo(0.868, 9);
    expect(METRIC_BY_ID.shuto_uke_hand_H.ref).toBeCloseTo(0.646, 9);
    expect(METRIC_BY_ID.tettsui_uchi_fist_H.ref).toBeCloseTo(0.58, 9);
  });

  it('recomputes every derived reference from its own arithmetic', () => {
    expect(DERIVED_REFS.length).toBeGreaterThanOrEqual(DERIVED_01_03_METRICS.length);
    for (const r of DERIVED_REFS) {
      expect(r.recompute(), `${r.metric}/${r.level ?? 'base'}`).toBeCloseTo(r.ships, 9);
      expect(r.derivation.length, `${r.metric} derivation`).toBeGreaterThan(20);
    }
  });

  it('carries a per-level reference for metric 18, since a fist height is level-dependent', () => {
    const spec = METRIC_BY_ID.active_fist_H;
    expect(spec.refByLevel).toBeDefined();
    expect(refFor(spec, { level: 'jodan' }).ref).toBeCloseTo(0.785, 9);
    expect(refFor(spec, { level: 'chudan' }).ref).toBeCloseTo(0.58, 9);
    expect(refFor(spec, { level: 'gedan' }).ref).toBeCloseTo(0.44, 9);
    // doc 07's tolerance is used on every branch.
    for (const lvl of ['jodan', 'chudan', 'gedan'] as const) {
      expect(refFor(spec, { level: lvl }).tol).toBe(0.025);
      expect(refFor(spec, { level: lvl }).hardFail).toBe(0.06);
    }
  });

  it('agrees with B1\'s TECHNIQUES wherever they describe the same point', () => {
    for (const c of DOC03_CROSSCHECK) {
      expect(c.agree, `${c.name}: metricSpecs ${c.mine} vs src/data ${c.b1}`).toBe(true);
    }
    expect(DOC03_CROSSCHECK.length).toBeGreaterThanOrEqual(9);
  });
});

describe('§2.6 — the precedence rule applied beyond the nine mandatory rows', () => {
  it('records every discretionary application, with a source and an argument', () => {
    for (const r of REF_PRECEDENCE_APPLIED) {
      const spec = METRIC_BY_ID[r.metric];
      expect(spec, r.metric).toBeDefined();
      expect(spec.refSource, r.metric).toBe(r.refSource);
      expect(spec.refSource, r.metric).not.toBe('doc07');
      expect(Math.abs(spec.ref - r.ships), r.metric).toBeLessThan(1e-9);
      expect(Math.abs(spec.ref - r.doc07Seed), r.metric).toBeGreaterThan(1e-6);
      expect(r.source, r.metric).toMatch(/docs\/research\/\d\d-/);
      expect(r.why.length, r.metric).toBeGreaterThan(40);
    }
  });

  it('ships the four rows the freeze did not enumerate', () => {
    expect(REF_PRECEDENCE_APPLIED.map((r) => r.metric).sort()).toEqual(
      ['head_height_H', 'hikite_elbow_flex_deg', 'hikite_fist_H', 'shuto_uke_support_hand_H'].sort(),
    );
    expect(METRIC_BY_ID.head_height_H.ref).toBeCloseTo(0.88, 9);
    expect(METRIC_BY_ID.hikite_fist_H.ref).toBeCloseTo(0.51, 9);
    expect(METRIC_BY_ID.hikite_elbow_flex_deg.ref).toBe(117);
    expect(METRIC_BY_ID.shuto_uke_support_hand_H.ref).toBeCloseTo(0.58, 9);
  });

  it('lists the mandatory nine plus the discretionary rows as one auditable ledger', () => {
    expect(ALL_REF_OVERRIDES).toHaveLength(MANDATORY_REF_OVERRIDES.length + REF_PRECEDENCE_APPLIED.length);
  });

  it('leaves every other metric on doc 07', () => {
    const overridden = new Set<MetricId>(ALL_REF_OVERRIDES.map((o) => o.metric));
    for (const m of METRICS) {
      if (overridden.has(m.id)) continue;
      if (m.refSource === 'DERIVED_01_03') continue;
      // doc02 / doc04 / PROJECT rows are the embusen, head-bob and §7.3-addition metrics.
      expect(['doc07', 'doc01', 'doc02', 'doc04', 'PROJECT'], m.id).toContain(m.refSource);
    }
  });
});

describe('metric 1 — the documented, deliberate bias (C15, docs/BRIEFS.md B9)', () => {
  it('is 0.0014 H / 0.26 % in magnitude and is NOT corrected anywhere', () => {
    expect(Math.abs(METRIC_1_EXPECTED_BIAS_H)).toBeCloseTo(0.0014, 4);
    expect(Math.abs(METRIC_1_EXPECTED_BIAS_PCT)).toBeCloseTo(0.26, 2);
    // Sits inside doc 07's tolerance, so it can never by itself cost a point.
    expect(Math.abs(METRIC_1_EXPECTED_BIAS_H)).toBeLessThan(METRIC_BY_ID.stance_len_H.tol);
  });

  it('states both numbers and forbids "fixing" either', () => {
    expect(METRIC_1_BIAS_NOTE).toContain('0.0415');
    expect(METRIC_1_BIAS_NOTE).toContain('0.052');
    expect(METRIC_1_BIAS_NOTE).toContain('C15');
    expect(METRIC_1_BIAS_NOTE.toLowerCase()).toContain('do not');
  });
});

describe('doc 07 §6.2 alternate tables', () => {
  it('gives every stance its own reference for metrics 1, 2, 3, 4, 6, 7', () => {
    for (const id of [
      'stance_len_H', 'stance_width_H', 'front_knee_flex_deg',
      'rear_knee_flex_deg', 'hip_height_H', 'weight_front_pct',
    ] as MetricId[]) {
      const spec = METRIC_BY_ID[id];
      expect(spec.refByStance, id).toBeDefined();
      // Heian's kokutsu steps 18-21 must NOT be scored against zenkutsu references (§9.3).
      expect(refFor(spec, { stance: 'kokutsu' }).axis).toBe('stance:kokutsu');
    }
  });

  it('scores kokutsu against doc 01 §10\'s kokutsu numbers, not zenkutsu\'s', () => {
    expect(refFor(METRIC_BY_ID.weight_front_pct, { stance: 'kokutsu' }).ref).toBe(30);
    expect(refFor(METRIC_BY_ID.rear_knee_flex_deg, { stance: 'kokutsu' }).ref).toBe(73);
    expect(refFor(METRIC_BY_ID.front_knee_flex_deg, { stance: 'kokutsu' }).ref).toBe(18);
    expect(refFor(METRIC_BY_ID.stance_width_H, { stance: 'kokutsu' }).ref).toBe(0);
    // doc 01 §2's MASTER INVARIANT: one working height for all three fighting stances.
    for (const s of ['zenkutsu', 'kokutsu', 'kiba'] as const) {
      expect(refFor(METRIC_BY_ID.hip_height_H, { stance: s }).ref, s).toBeCloseTo(0.41, 9);
    }
  });

  it('uses refByKata for metric 48 — 35.25 s Taikyoku vs 39.75 s Heian (§9.3)', () => {
    const spec = METRIC_BY_ID.kata_total_s;
    expect(refFor(spec, { kataId: 'taikyoku-shodan' }).ref).toBe(MOVE_SECONDS_T1['taikyoku-shodan']);
    expect(refFor(spec, { kataId: 'heian-shodan' }).ref).toBe(MOVE_SECONDS_T1['heian-shodan']);
    expect(refFor(spec, { kataId: 'heian-shodan' }).tol).toBe(8);
  });
});

describe('fatal and armed flags', () => {
  it('flags exactly the doc 07 fatal rows plus metric 17 (§10)', () => {
    expect(METRICS.filter((m) => m.fatal).map((m) => m.id).sort()).toEqual(
      [
        'head_bob_H',              // §10: "fatal: true, armed: true"
        'hikite_present',          // 07 §6.2 #28 false = fatal
        'finger_curl_state',       // #40 mismatch = fatal
        'hip_lead_lag_s',          // #51 sign inversion = fatal
        'self_intersection_count', // #58 >= 1 = fatal
        'silhouette_IoU',          // #60 < 0.70 = fatal, but NOT armed
      ].sort(),
    );
  });

  it('ships metric 60 DISARMED until tools/calibrate-envelope.mjs has run (§9.2 S-4)', () => {
    expect(METRIC_BY_ID.silhouette_IoU.armed).toBe(false);
    expect(METRIC_BY_ID.silhouette_IoU.fatal).toBe(true);
    expect(METRIC_BY_ID.silhouette_IoU.fixSite.hint).toMatch(/calibrat/i);
    // Everything else is armed: an unarmed metric cannot fail a gate, so silence must be rare.
    expect(METRICS.filter((m) => !m.armed).map((m) => m.id)).toEqual(['silhouette_IoU']);
  });

  it('uses one-sided bounds only where doc 07 publishes a signed tolerance', () => {
    const upper = METRICS.filter((m) => m.bound === 'upperOnly').map((m) => m.id).sort();
    const lower = METRICS.filter((m) => m.bound === 'lowerOnly').map((m) => m.id).sort();
    expect(upper).toEqual(
      ['float_gap_H', 'foot_slide_Hps', 'head_bob_H', 'rear_heel_gap_H',
       'self_intersection_count', 'step_path_lateral_dev_H', 'turn_pivot_foot_slip_H'].sort(),
    );
    expect(lower).toEqual(['forearm_radius_retention', 'ground_penetration_H', 'silhouette_IoU'].sort());
  });
});
