/**
 * tests/data/derived.test.ts — §2.3's derived datum table.
 *
 * OWNERSHIP B1 names four assertions for this file:
 *   `L_H === ZENKUTSU.S.v` · `EMB_H_H === HACHIJI.W.v/2` ·
 *   `ZENKUTSU_HEEL_TO_HEEL_H === 0.533 ± 5e-4` by the §2.3 formula · `PELVIS_AHEAD_OF_C_H` per stance.
 *
 * This is the Phase-1 gate file (§8: "`tests/data/derived` green"), and it is the test that makes
 * §2.3's "DERIVED, never authored" mean something: each assertion re-derives the constant from the
 * stance spec and would FAIL if someone hard-coded 0.540 or 0.1295 next to it.
 */

import { describe, expect, it } from 'vitest';
import {
  EMB_H_H,
  EMB_STEP_L,
  AJC_HALF_SEP_L,
  FOOT_CENTRE_AHEAD_OF_AJC_H,
  L_H,
  L_M,
  PELVIS_AHEAD_OF_C_H,
  PELVIS_AHEAD_OF_C_BY_LOAD_H,
  ZENKUTSU_HEEL_TO_HEEL_H,
  EMB_BBOX,
} from '../../src/data/embusen';
import { STANCES, STANCE_HIP_OFFSETS } from '../../src/data/constants/stances';
import { ANTHRO } from '../../src/data/constants/anthro';
import {
  EMBUSEN_RESCALE,
  EMB_H_RESOLVED_H,
  EMB_POLYLINE_H_L,
  H,
  HEEL_BEHIND_ANKLE_DOC01_H,
  HEEL_BEHIND_ANKLE_DOC06_H,
  L_DERIVED_FROM,
  L_RESOLVED_H,
  ZENKUTSU_HEEL_TO_HEEL_REF_H,
} from '../../src/contracts';
import { HEEL_OFFSET_H } from '../../src/contracts';

const DEG = Math.PI / 180;
type StanceId = keyof typeof STANCES;

describe('§2.3 / C02 — L is DERIVED from the stance spec', () => {
  it('L_H === ZENKUTSU.S.v, and it is 0.540 H', () => {
    expect(L_H).toBe(STANCES.zenkutsu.S.v);
    expect(L_H).toBeCloseTo(0.54, 12);
    // `units.ts` records the EXPECTED value and the derivation path; the two must agree.
    expect(L_RESOLVED_H).toBe(0.54);
    expect(L_H).toBe(L_RESOLVED_H);
    expect(L_DERIVED_FROM).toBe('ZENKUTSU.S.v');
  });

  it('L_M = L_H x H = 0.945 m, which is doc 02\'s 0.91 m rescaled by EMBUSEN_RESCALE', () => {
    expect(L_M).toBeCloseTo(0.945, 12);
    expect(L_M).toBe(L_H * H);
    // doc 02 §1.1's own L was 0.520 H = 0.91 m. Re-deriving L changes only the metre conversion,
    // which is why the (x,z) tables — expressed in units of L — need no rescaling.
    expect(EMBUSEN_RESCALE).toBeCloseTo(0.54 / 0.52, 12);
    expect(0.52 * H * EMBUSEN_RESCALE).toBeCloseTo(L_M, 12);
  });

  it('the bounding box is 4.00 L square = 3.78 m square', () => {
    expect(EMB_BBOX.xMax - EMB_BBOX.xMin).toBeCloseTo(4.0, 12);
    expect(EMB_BBOX.zMax - EMB_BBOX.zMin).toBeCloseTo(4.0, 12);
    expect(EMB_BBOX.sideM).toBeCloseTo(3.78, 9);
  });
});

describe('§2.3 / C03 / C18 — EMB_H is the hachiji STANCE half-width, not doc 02\'s polyline h', () => {
  it('EMB_H_H === HACHIJI.W.v / 2 === 0.1295 H', () => {
    expect(EMB_H_H).toBe(STANCES.hachiji.W.v / 2);
    expect(EMB_H_H).toBeCloseTo(0.1295, 12);
    expect(EMB_H_H).toBe(EMB_H_RESOLVED_H);
  });

  it('it is NOT doc 02\'s h = 0.19 L, and the two differ by 4.7 cm — which is why C18 scopes it', () => {
    expect(EMB_POLYLINE_H_L).toBe(0.19);
    const embHInL = EMB_H_H / L_H;
    expect(embHInL).toBeCloseTo(0.23981, 4);
    expect(Math.abs(embHInL - EMB_POLYLINE_H_L)).toBeCloseTo(0.04981, 4);
    expect(Math.abs(embHInL - EMB_POLYLINE_H_L) * L_M).toBeCloseTo(0.047, 3); // 4.7 cm
  });
});

describe('§2.6 override #1 — ZENKUTSU_HEEL_TO_HEEL_H, and why it must come from doc 01\'s 0.052', () => {
  it('=== 0.533 +- 5e-4 by the §2.3 formula', () => {
    expect(ZENKUTSU_HEEL_TO_HEEL_H).toBeCloseTo(0.533105, 6);
    expect(Math.abs(ZENKUTSU_HEEL_TO_HEEL_H - ZENKUTSU_HEEL_TO_HEEL_REF_H)).toBeLessThanOrEqual(5e-4);
    expect(ZENKUTSU_HEEL_TO_HEEL_REF_H).toBe(0.533);
  });

  it('it is re-derived, not authored: it moves when ZENKUTSU.S / the foot yaws move', () => {
    const s = STANCES.zenkutsu.S.v;
    const heel = ANTHRO.HEEL_BEHIND!.v;
    const recomputed =
      s -
      heel * Math.cos(STANCES.zenkutsu.yawFront.v * DEG) +
      heel * Math.cos(STANCES.zenkutsu.yawRear.v * DEG);
    expect(ZENKUTSU_HEEL_TO_HEEL_H).toBe(recomputed);
    // And it is genuinely SHORTER than the ankle-to-ankle S, which is metric 1's whole point.
    expect(ZENKUTSU_HEEL_TO_HEEL_H).toBeLessThan(s);
  });

  it('C15: doc 01\'s 0.052 passes the gate and doc 06\'s 0.0415 fails it by 3x', () => {
    expect(ANTHRO.HEEL_BEHIND!.v).toBe(HEEL_BEHIND_ANKLE_DOC01_H);
    expect(HEEL_BEHIND_ANKLE_DOC01_H).toBe(0.052);
    const with06 =
      STANCES.zenkutsu.S.v -
      HEEL_BEHIND_ANKLE_DOC06_H * Math.cos(STANCES.zenkutsu.yawFront.v * DEG) +
      HEEL_BEHIND_ANKLE_DOC06_H * Math.cos(STANCES.zenkutsu.yawRear.v * DEG);
    expect(with06).toBeCloseTo(0.534497, 6);
    expect(Math.abs(with06 - ZENKUTSU_HEEL_TO_HEEL_REF_H)).toBeGreaterThan(5e-4);
    expect(Math.abs(with06 - ZENKUTSU_HEEL_TO_HEEL_REF_H) / 5e-4).toBeGreaterThan(2.9);
    // The rig landmark keeps doc 06's number, and it ships frozen. Both stay, by design.
    expect(HEEL_OFFSET_H[2]).toBe(HEEL_BEHIND_ANKLE_DOC06_H);
  });
});

describe('§2.3 — FOOT_CENTRE_AHEAD_OF_AJC_H, the number the AJC datum decision exists to avoid', () => {
  it('= FOOT_LEN/2 - HEEL_BEHIND = 0.076 - 0.052 = 0.024', () => {
    expect(FOOT_CENTRE_AHEAD_OF_AJC_H).toBeCloseTo(0.024, 12);
    expect(FOOT_CENTRE_AHEAD_OF_AJC_H).toBe(ANTHRO.FOOT_LEN!.v / 2 - ANTHRO.HEEL_BEHIND!.v);
  });

  it('a foot-CENTRE datum would have made the embusen step 0.543 H — a second, silent L', () => {
    // §2.3: foot centre sits 0.024 H ahead of the AJC along the foot axis, and the two feet carry
    // different yaws (+3 front, +30 rear), so foot-centre separation is NOT S.
    const d = FOOT_CENTRE_AHEAD_OF_AJC_H;
    const sep =
      STANCES.zenkutsu.S.v -
      d * Math.cos(STANCES.zenkutsu.yawRear.v * DEG) +
      d * Math.cos(STANCES.zenkutsu.yawFront.v * DEG);
    expect(sep).toBeCloseTo(0.543, 3);
    expect(Math.abs(sep - L_H) / L_H).toBeGreaterThan(0.005); // ~0.6 %: invisible to a closure test
  });
});

describe('§2.3 — PELVIS_AHEAD_OF_C_H, per stance', () => {
  it('zenkutsu = +0.049 exactly, by S/2 - hipZbehindFrontAnkle', () => {
    expect(PELVIS_AHEAD_OF_C_H.zenkutsu).toBeCloseTo(0.049, 12);
    expect(PELVIS_AHEAD_OF_C_H.zenkutsu).toBe(
      STANCES.zenkutsu.S.v / 2 - STANCE_HIP_OFFSETS.zenkutsuHipBehindFrontAnkleH.v,
    );
    expect(PELVIS_AHEAD_OF_C_H.zenkutsu).toBeGreaterThan(0); // positive = toward the facing direction
  });

  it('kokutsu = -0.089 exactly, by hipZaheadOfRearAnkle - S/2', () => {
    expect(PELVIS_AHEAD_OF_C_H.kokutsu).toBeCloseTo(-0.089, 12);
    expect(PELVIS_AHEAD_OF_C_H.kokutsu).toBe(
      STANCE_HIP_OFFSETS.kokutsuHipAheadOfRearAnkleH.v - STANCES.kokutsu.S.v / 2,
    );
    // Kokutsu leans BACK over the rear leg, so the sign must be the opposite of zenkutsu's.
    expect(PELVIS_AHEAD_OF_C_H.kokutsu).toBeLessThan(0);
  });

  it('every symmetric stance is exactly 0.000', () => {
    for (const id of ['kiba', 'hachiji', 'heiko', 'musubi', 'heisoku'] as const) {
      expect(PELVIS_AHEAD_OF_C_H[id], id).toBe(0);
    }
  });

  it('the load-share form of doc 06 §2.2 reproduces both fighting stances to 4e-4', () => {
    // COM_xz = P_front + (1-f)(P_rear - P_front), so the pelvis sits (f - 0.5)*S ahead of the
    // midpoint. That is an INDEPENDENT derivation from §2.3's hip-offset one.
    expect(PELVIS_AHEAD_OF_C_BY_LOAD_H.zenkutsu).toBeCloseTo(0.0486, 6);
    expect(PELVIS_AHEAD_OF_C_BY_LOAD_H.kokutsu).toBeCloseTo(-0.0892, 6);
    expect(Math.abs(PELVIS_AHEAD_OF_C_BY_LOAD_H.zenkutsu - PELVIS_AHEAD_OF_C_H.zenkutsu)).toBeLessThan(5e-4);
    expect(Math.abs(PELVIS_AHEAD_OF_C_BY_LOAD_H.kokutsu - PELVIS_AHEAD_OF_C_H.kokutsu)).toBeLessThan(5e-4);
  });

  it('the three stances doc 01 gives no hip offset for use the load-share form directly', () => {
    for (const id of ['zenkutsu-ashi', 'han-zenkutsu', 'moto'] as const) {
      expect(PELVIS_AHEAD_OF_C_H[id], id).toBe(PELVIS_AHEAD_OF_C_BY_LOAD_H[id]);
      expect(PELVIS_AHEAD_OF_C_H[id], id).toBeGreaterThan(0); // all are front-weighted
    }
  });

  it('every StanceId has an entry and none is NaN — metric 42 reads this by stance', () => {
    for (const id of Object.keys(STANCES) as StanceId[]) {
      expect(Number.isFinite(PELVIS_AHEAD_OF_C_H[id]), id).toBe(true);
      expect(Math.abs(PELVIS_AHEAD_OF_C_H[id]), id).toBeLessThan(0.15);
    }
  });
});

describe('the kokutsu embusen-step conflict, made explicit', () => {
  it('the embusen GENERATOR steps 1.00 L for both zenkutsu and kokutsu (doc 02 §1.1 Lk = 1.00 L)', () => {
    expect(EMB_STEP_L.zenkutsu).toBe(1);
    expect(EMB_STEP_L.kokutsu).toBe(1);
  });

  it('but the STANCE lengths differ, so AJC_HALF_SEP_L is what B3 must plant from', () => {
    expect(AJC_HALF_SEP_L.zenkutsu).toBeCloseTo(0.5, 12); // S/2 / L = exactly half a step
    expect(AJC_HALF_SEP_L.kokutsu).toBeCloseTo(0.446 / (2 * 0.54), 12);
    expect(AJC_HALF_SEP_L.kokutsu).toBeLessThan(0.5);
    // The gap the header documents: kokutsu ff/rf are 0.094 H wider than the stance.
    const gapH = (EMB_STEP_L.kokutsu - 2 * AJC_HALF_SEP_L.kokutsu) * L_H;
    expect(gapH).toBeCloseTo(0.094, 3);
  });

  it('the frozen c(21) pin is only reachable at step = 1.00 L', () => {
    // c = anchor + (step/2)*f(315), anchor = R foot at (-h, 0), f(315) = (-0.7071, -0.7071).
    const f = [Math.sin(315 * DEG), -Math.cos(315 * DEG)] as const;
    const c = (step: number) => [-EMB_POLYLINE_H_L + (step / 2) * f[0], (step / 2) * f[1]] as const;
    const at1 = c(1);
    expect(at1[0]).toBeCloseTo(-0.544, 3);
    expect(at1[1]).toBeCloseTo(-0.354, 3);
    const atS = c(STANCES.kokutsu.S.v / L_H);
    expect(Math.abs(atS[0] - -0.544)).toBeGreaterThan(0.05); // (-0.482, -0.292): 8 cm off the pin
  });
});
