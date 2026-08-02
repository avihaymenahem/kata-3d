/**
 * tests/data/proportions.test.ts — the doc 07 §4 anti-heroic gate, and the closure checks that make
 * the anthropometric tables trustworthy.
 *
 * OWNERSHIP B1: "head 0.130 H ⇒ 7.7 heads (the doc 07 §4 anti-heroic gate)".
 *
 * Why that gate matters more than it looks: doc 07 §4 says "round to 7.7 for realism, not the 8.0
 * heroic canon — a stylised 8-head figure makes stance depths read SHALLOWER than the numbers say."
 * A rig built at 8 heads would score correctly on every length metric and still read wrong, because
 * the head is the unit a viewer measures stance depth against. It is the one proportion the metric
 * bank cannot catch, so it is a test.
 *
 * The second half of the file re-runs doc 06 §1.3's and doc 03 §1.4's own closure checks — the four
 * dimensional identities that are the whole reason those derived heights are usable.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTHRO,
  COM_Y_BIND_H,
  JOINT_Y,
  LIMB_R,
  PROPORTION_HEADS,
  PROPORTION_HEADS_TARGET,
  SEG_COM_PCT,
  SEG_MASS,
  STATION_R,
} from '../../src/data/constants/anthro';
import { BONE_ORDER, CAPSULES, H, H_CM } from '../../src/contracts';

describe('doc 07 §4 — the anti-heroic proportion gate', () => {
  it('head height is 0.130 H, so the figure is 7.7 heads tall, not 8.0', () => {
    expect(ANTHRO.HEAD_HEIGHT!.v).toBe(0.13);
    expect(PROPORTION_HEADS).toBeCloseTo(7.692, 3);
    expect(PROPORTION_HEADS).toBeCloseTo(PROPORTION_HEADS_TARGET.v, 1);
    expect(Math.abs(PROPORTION_HEADS - PROPORTION_HEADS_TARGET.v)).toBeLessThanOrEqual(
      PROPORTION_HEADS_TARGET.tol,
    );
  });

  it('it is NOT the 8.0 heroic canon — the gate has to be able to fail', () => {
    expect(PROPORTION_HEADS).toBeLessThan(8.0);
    // 8 heads would need a 0.125 H head; we are 4 % taller-headed than that, on purpose.
    expect(1 / 8).toBeLessThan(ANTHRO.HEAD_HEIGHT!.v);
    expect(8.0 - PROPORTION_HEADS).toBeGreaterThan(0.2);
  });

  it('H is 1.75 m / 175 cm exactly, which is what every FracH multiplies by', () => {
    expect(H).toBe(1.75);
    expect(H_CM).toBe(175);
    // doc 07 §0.2's cm column prints 22.8; the exact product is 22.75, i.e. the doc rounds up.
    expect(ANTHRO.HEAD_HEIGHT!.v * H_CM).toBeCloseTo(22.75, 6);
    expect(Math.abs(ANTHRO.HEAD_HEIGHT!.v * H_CM - 22.8)).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

describe('doc 06 §1.3 — the bind-pose chain is closed', () => {
  it('vertex is exactly 1.000 H and the floor exactly 0.000', () => {
    expect(JOINT_Y.VERTEX!.v).toBe(1);
    expect(JOINT_Y.FLOOR!.v).toBe(0);
  });

  it('the joint heights ascend monotonically up the leg and the arm hangs below the shoulder', () => {
    expect(JOINT_Y.AJC!.v).toBeLessThan(JOINT_Y.KJC!.v);
    expect(JOINT_Y.KJC!.v).toBeLessThan(JOINT_Y.HJC!.v);
    expect(JOINT_Y.HJC!.v).toBeLessThan(JOINT_Y.OMPHALION!.v);
    expect(JOINT_Y.OMPHALION!.v).toBeLessThan(JOINT_Y.SJC!.v);
    expect(JOINT_Y.SJC!.v).toBeLessThan(JOINT_Y.SUPRASTERNALE!.v);
    expect(JOINT_Y.SUPRASTERNALE!.v).toBeLessThan(JOINT_Y.CERVICALE!.v);
    expect(JOINT_Y.CERVICALE!.v).toBeLessThan(JOINT_Y.AOJ!.v);
    expect(JOINT_Y.AOJ!.v).toBeLessThan(JOINT_Y.VERTEX!.v);
    // The hanging arm: shoulder above elbow above wrist above fingertip.
    expect(JOINT_Y.SJC!.v).toBeGreaterThan(JOINT_Y.EJC!.v);
    expect(JOINT_Y.EJC!.v).toBeGreaterThan(JOINT_Y.WJC!.v);
    expect(JOINT_Y.WJC!.v).toBeGreaterThan(JOINT_Y.DACTYLION!.v);
  });

  it('every leg segment closes — and doc 06 §1.3 built the shin from `len.shank`, not `len.shank_ajc`', () => {
    const shank = JOINT_Y.KJC!.v - JOINT_Y.AJC!.v;
    // 0.2883 - 0.0390 = 0.2493 = `len.shank` (KJC -> LATERAL MALLEOLUS) EXACTLY.
    expect(shank).toBeCloseTo(ANTHRO.LEN_SHANK!.v, 9);
    /**
     * FINDING, recorded rather than papered over: doc 06 §1.3 labels the joint `AJC (ankle joint
     * centre)` but reaches it with `len.shank`, the malleolus length, and not with `len.shank_ajc =
     * 0.2529` — a 0.0036 H = 6.3 mm difference. Both numbers ship (they are doc 06 §1.1's own two
     * rows); the chain is internally consistent with the one it used, which is what matters for the
     * bind pose. B4 must build the shin from `LEN_SHANK` so its `JOINT_Y` closure test passes, and
     * B9 should know metric 1 and metric 6 inherit that 6.3 mm choice.
     */
    expect(ANTHRO.LEN_SHANK_AJC!.v - ANTHRO.LEN_SHANK!.v).toBeCloseTo(0.0036, 6);
    const thigh = JOINT_Y.HJC!.v - JOINT_Y.KJC!.v;
    expect(Math.abs(thigh - ANTHRO.LEN_THIGH!.v) / ANTHRO.LEN_THIGH!.v).toBeLessThan(0.013);
  });

  it('every arm segment closes: SJC - EJC = upperarm, EJC - WJC = forearm (<= 1.3 %)', () => {
    const upper = JOINT_Y.SJC!.v - JOINT_Y.EJC!.v;
    expect(Math.abs(upper - ANTHRO.LEN_UPPERARM!.v) / ANTHRO.LEN_UPPERARM!.v).toBeLessThan(0.013);
    const fore = JOINT_Y.EJC!.v - JOINT_Y.WJC!.v;
    expect(Math.abs(fore - ANTHRO.LEN_FOREARM!.v) / ANTHRO.LEN_FOREARM!.v).toBeLessThan(0.013);
  });

  it('doc 06 §1.3 cross-checks each derived height against an independent D&C height to <= 1.3 %', () => {
    const pairs: readonly (readonly [number, number, string])[] = [
      [JOINT_Y.AJC!.v, ANTHRO.ANKLE_Y!.v, 'AJC vs D&C ankle height'],
      [JOINT_Y.KJC!.v, ANTHRO.KNEE_Y!.v, 'KJC vs D&C knee height'],
      [JOINT_Y.HJC!.v, ANTHRO.HIP_Y_STAND!.v, 'HJC vs D&C trochanter height'],
      [JOINT_Y.EJC!.v, ANTHRO.ELBOW_Y_STAND!.v, 'EJC vs D&C elbow height'],
      [JOINT_Y.WJC!.v, ANTHRO.WRIST_Y_STAND!.v, 'WJC vs D&C wrist height'],
    ];
    for (const [a, b, label] of pairs) {
      expect(Math.abs(a - b) / b, label).toBeLessThan(0.013);
    }
  });

  it('doc 03 §1.4: shoulder height + head&neck = exactly H', () => {
    expect(ANTHRO.GH_Y_STAND!.v + ANTHRO.HEAD_AND_NECK!.v).toBeCloseTo(1.0, 9);
  });

  it('doc 03 §1.4: the three D&C landmark differences match the segment lengths', () => {
    // shoulder - elbow = 0.188 vs UPPER_ARM 0.186 -> 1.1 %
    const a = ANTHRO.GH_Y_STAND!.v - ANTHRO.ELBOW_Y_STAND!.v;
    expect(Math.abs(a - ANTHRO.UPPER_ARM!.v) / ANTHRO.UPPER_ARM!.v).toBeLessThan(0.012);
    // elbow - wrist = 0.145 vs FOREARM 0.146 -> 0.7 %
    const b = ANTHRO.ELBOW_Y_STAND!.v - ANTHRO.WRIST_Y_STAND!.v;
    expect(Math.abs(b - ANTHRO.FOREARM!.v) / ANTHRO.FOREARM!.v).toBeLessThan(0.008);
  });

  it('doc 06 §1.5\'s stated upper-arm closure does NOT close — recorded, not corrected', () => {
    /**
     * FINDING. doc 06 §1.5 asserts: "acromion->radiale 0.1906 H; SJC is 19.8 mm (0.0114 H) distal
     * to acromion; EJC is 15.5 mm (0.0089 H) proximal to radiale ⇒ SJC->EJC = 0.1906 - 0.0114 -
     * 0.0089 ≈ **0.1618 H** ✔ closes exactly". The arithmetic it prints gives **0.1703**, not
     * 0.1618 — an 0.0085 H = 1.5 cm gap. In millimetres: 333.6 - 19.8 - 15.5 = 298.3 mm = 0.1704 H,
     * while de Leva's own SJC->EJC row is 0.1618 H = 281.7 mm.
     *
     * Nothing here is "fixed": both numbers are shipped verbatim from doc 06 §1.1/§1.4, because the
     * RIG is built from `LEN_UPPERARM = 0.1618` (the de Leva joint-centre row, which §1.1 marks
     * "USE THIS FOR THE RIG") and the landmark offsets are only ever used to reconcile a MEASURED
     * height against a joint centre. The two consumers never meet. Raised as a handoff so B4 does
     * not "close" the chain by moving a bone and B9 does not read the 1.5 cm as rig error.
     */
    const stated = 0.1906 - ANTHRO.SJC_BELOW_ACROMION!.v - ANTHRO.EJC_ABOVE_RADIALE!.v;
    expect(stated).toBeCloseTo(0.1703, 4);
    expect(Math.abs(stated - ANTHRO.LEN_UPPERARM!.v)).toBeGreaterThan(0.008);
    // What IS true: the rig's upper arm is the de Leva joint-centre length, shorter than D&C's
    // acromion-based one, and by more than the two landmark offsets account for.
    expect(ANTHRO.LEN_UPPERARM!.v).toBeLessThan(ANTHRO.UPPER_ARM!.v);
  });

  it('doc 03 §1.1: reach limits are consistent with the segment lengths they are built from', () => {
    // MAX_REACH_GH->MCP2 at a straight elbow = UPPER_ARM + ELBOW_TO_MCP2.
    expect(ANTHRO.UPPER_ARM!.v + ANTHRO.ELBOW_TO_MCP2!.v).toBeCloseTo(ANTHRO.MAX_REACH_GH_MCP2!.v, 3);
    expect(ANTHRO.UPPER_ARM!.v + ANTHRO.ELBOW_TO_FIST_CENTRE!.v).toBeCloseTo(
      ANTHRO.MAX_REACH_GH_FIST!.v,
      3,
    );
    // ELBOW_TO_FIST_CENTRE = FOREARM + 0.030 (doc 03 §1.1's stated derivation).
    expect(ANTHRO.ELBOW_TO_FIST_CENTRE!.v - ANTHRO.FOREARM!.v).toBeCloseTo(0.03, 3);
  });

  it('doc 01 §1: the foot decomposes exactly — toe ahead + heel behind = FOOT_LEN', () => {
    expect(ANTHRO.TOE_AHEAD!.v + ANTHRO.HEEL_BEHIND!.v).toBeCloseTo(ANTHRO.FOOT_LEN!.v, 9);
    // MTP sits between the ankle and the toe.
    expect(ANTHRO.MTP_AHEAD!.v).toBeLessThan(ANTHRO.TOE_AHEAD!.v);
    expect(ANTHRO.MTP_AHEAD!.v).toBeGreaterThan(0);
    // LEG_EXT = THIGH + SHANK.
    expect(ANTHRO.THIGH!.v + ANTHRO.SHANK!.v).toBeCloseTo(ANTHRO.LEG_EXT!.v, 9);
  });

  it('doc 07 §0.3: the virtual FistCenter is half a fist diameter beyond the wrist', () => {
    // doc 07 §0.3 prints "0.5 x fist diameter = 0.030H"; the exact half is 0.0295, so the doc
    // rounds. Both numbers ship as the doc states them.
    expect(ANTHRO.FIST_DIAMETER!.v / 2).toBeCloseTo(0.0295, 6);
    expect(Math.abs(ANTHRO.FIST_CENTRE_BEYOND_WRIST!.v - ANTHRO.FIST_DIAMETER!.v / 2)).toBeLessThanOrEqual(5e-4 + 1e-12);
    // doc 07 §0.2's own derivation: fist diameter = 0.55 x hand length.
    expect(ANTHRO.FIST_DIAMETER!.v).toBeCloseTo(0.55 * ANTHRO.HAND!.v, 3);
  });
});

describe('doc 06 §2 — mass and COM', () => {
  it('the segment masses sum to 100 % of body mass', () => {
    const total =
      SEG_MASS.head!.v +
      SEG_MASS.trunk!.v +
      2 * (SEG_MASS.upperarm!.v + SEG_MASS.forearm!.v + SEG_MASS.hand!.v) +
      2 * (SEG_MASS.thigh!.v + SEG_MASS.shank!.v + SEG_MASS.foot!.v);
    expect(total).toBeCloseTo(100, 2);
  });

  it('the three-part trunk sums to the whole trunk', () => {
    expect(SEG_MASS.trunkUpper!.v + SEG_MASS.trunkMid!.v + SEG_MASS.trunkLow!.v).toBeCloseTo(
      SEG_MASS.trunk!.v,
      6,
    );
  });

  it('every COM position is a percentage strictly inside its own segment', () => {
    for (const [k, n] of Object.entries(SEG_COM_PCT)) {
      expect(n.v, k).toBeGreaterThan(0);
      expect(n.v, k).toBeLessThan(100);
      expect(n.unit, k).toBe('pct');
    }
  });

  it('the bind-pose COM is 0.568 H, inside the 0.55–0.57 literature band that doc 06 §2.1 cites', () => {
    expect(COM_Y_BIND_H.v).toBeCloseTo(0.5683, 4);
    // B3's `tests/solve/stances.test.ts` asserts |COM_y/H - 0.568| < 0.008 from the SOLVE; this is
    // the reference side of that same identity.
    expect(Math.abs(COM_Y_BIND_H.v - 0.568)).toBeLessThan(COM_Y_BIND_H.tol);
    expect(COM_Y_BIND_H.v).toBeGreaterThan(0.55);
    expect(COM_Y_BIND_H.v).toBeLessThan(0.58);
    // And it sits above the hip and below the shoulder, which is the sanity shape of a COM.
    expect(COM_Y_BIND_H.v).toBeGreaterThan(JOINT_Y.HJC!.v);
    expect(COM_Y_BIND_H.v).toBeLessThan(JOINT_Y.SJC!.v);
  });
});

describe('LIMB_R — the mesh radius table, total over BONE_ORDER', () => {
  it('every bone has a positive radius drawn from a doc 06 §5.1 station', () => {
    const stations = new Set(Object.values(STATION_R));
    for (const b of BONE_ORDER) {
      expect(LIMB_R[b], b).toBeDefined();
      expect(LIMB_R[b].v, b).toBeGreaterThan(0);
      expect(LIMB_R[b].unit, b).toBe('H');
      expect(stations.has(LIMB_R[b]), `${b} must reuse a §5.1 station, not invent a radius`).toBe(true);
    }
  });

  it('the radii taper distally, which is what makes a swept-ring limb read as a limb', () => {
    expect(LIMB_R.upperarm_L.v).toBeGreaterThan(LIMB_R.lowerarm_L.v);
    expect(LIMB_R.lowerarm_L.v).toBeGreaterThan(LIMB_R.hand_L.v);
    expect(LIMB_R.thigh_L.v).toBeGreaterThan(LIMB_R.calf_L.v);
    expect(LIMB_R.calf_L.v).toBeGreaterThan(LIMB_R.foot_L.v);
    expect(LIMB_R.pelvis.v).toBeGreaterThan(LIMB_R.spine_01.v);
  });

  it('doc 06 §7.6: the CLOTH CAPSULES are 0.004–0.008 H LARGER than these mesh radii', () => {
    // Two tables, two jobs. If a capsule were ever <= the mesh radius the gi would sit ON the skin,
    // which is what causes z-fighting and shading pops.
    const capOf = (id: string) => CAPSULES.find((c) => c.id === id);
    const pairs: readonly (readonly [string, keyof typeof LIMB_R])[] = [
      ['upperarm_L', 'upperarm_L'],
      ['forearm_L', 'lowerarm_twist_01_L'],
      ['thigh_L', 'thigh_L'],
      ['shank_L', 'calf_twist_L'],
    ];
    for (const [capId, bone] of pairs) {
      const cap = capOf(capId);
      if (cap === undefined) continue; // CAPSULES ids are B0's; skip rather than assert a name
      expect(cap.radiusH, `${capId} vs LIMB_R.${bone}`).toBeGreaterThan(LIMB_R[bone].v);
      expect(cap.radiusH - LIMB_R[bone].v, `${capId} clearance`).toBeLessThan(0.02);
    }
  });

  it('the head ellipsoid radii are ordered rx < rz < ry — a head is taller than it is wide', () => {
    expect(STATION_R.headRx!.v).toBeLessThan(STATION_R.headRz!.v);
    expect(STATION_R.headRz!.v).toBeLessThan(STATION_R.headRy!.v);
  });

  it('the elliptical torso stations are wider than they are deep', () => {
    expect(STATION_R.chest!.v).toBeGreaterThan(STATION_R.chestDepth!.v);
    expect(STATION_R.waist!.v).toBeGreaterThan(STATION_R.waistDepth!.v);
    expect(STATION_R.hip!.v).toBeGreaterThan(STATION_R.hipDepth!.v);
  });
});
