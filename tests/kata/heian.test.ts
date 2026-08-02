/**
 * tests/kata/heian.test.ts — B2's numeric verification for Heian Shodan.
 *
 * OWNERSHIP B2: "same [as Taikyoku], plus the 45°/315° diagonals, kiai at `[9, 17]`, kokutsu on
 * 18–21, move 4 the only `R0`, Σ `tSlotS` = 39.75 ± 20 %".
 *
 * ═══ THE ONE THING THIS FILE GUARDS THAT NOTHING ELSE DOES ══════════════════════════════════
 * The two diagonal spurs. doc 02 §6.2 prints moves 19 and 21 rounded to three decimals, and the
 * kata file authors them at full precision so the `ff` recompute closes at 1e-9 L. That leaves
 * `c(21)` at `−0.5435533905932738`, which is **4.47e-4** from §2.1 assertion 3's printed
 * `−0.544` — inside `toBeCloseTo(…, 3)`'s 5e-4 window with 11 % to spare, and asserted from BOTH
 * ends below so neither the rounded pin nor the exact recompute can be "fixed" without the other
 * one failing.
 */

import { describe, expect, it } from 'vitest';

import {
  EMB_BBOX,
  EMB_TSLOT_TOL_FRAC,
  assertEmbusenInvariants,
  embusenPolyline,
  getKata,
  sigma,
  validateKata,
  yameClosureResidualL,
} from '../../src/data';
import { MOVE_SECONDS_T1 } from '../../src/contracts';

const K = getKata('heian-shodan');
const at = (n: number) => {
  const m = K.moves.find((x) => x.n === n);
  if (m === undefined) throw new Error(`no move ${n}`);
  return m;
};

const DEG = Math.PI / 180;
const f = (h: number): readonly [number, number] => [Math.sin(h * DEG), -Math.cos(h * DEG)];
/** doc 02 §1.1: `Lk = 1.00 L`, so the embusen step is 1 for kokutsu as well as zenkutsu. */
const STEP_L = 1;
const SQRT2_2 = Math.SQRT1_2;

describe('doc 02 §6.1 — structure', () => {
  it('is 21 moves, numbered 1..21, zenkutsu 1–17 and kokutsu 18–21', () => {
    expect(K.id).toBe('heian-shodan');
    expect(K.moveCount).toBe(21);
    expect(K.moves.map((m) => m.n)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(K.moves.filter((m) => m.stance === 'zenkutsu').map((m) => m.n))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(K.moves.filter((m) => m.stance === 'kokutsu').map((m) => m.n)).toEqual([18, 19, 20, 21]);
  });

  it('the technique inventory is doc 02 §6\'s own count: 6 + 7 + 1 + 3 + 4 = 21', () => {
    const byId = K.moves.reduce<Record<string, number>>((acc, m) => {
      acc[m.tech.id] = (acc[m.tech.id] ?? 0) + 1;
      return acc;
    }, {});
    expect(byId).toEqual({
      'gedan-barai': 6,
      'oi-zuki': 7,
      'tettsui-tate-mawashi': 1,
      'age-uke': 3,
      'shuto-uke': 4,
    });
    const ns = (id: string) => K.moves.filter((m) => m.tech.id === id).map((m) => m.n);
    expect(ns('gedan-barai')).toEqual([1, 3, 6, 10, 12, 14]);
    expect(ns('oi-zuki')).toEqual([2, 5, 11, 13, 15, 16, 17]);
    expect(ns('tettsui-tate-mawashi')).toEqual([4]);
    expect(ns('age-uke')).toEqual([7, 8, 9]);
    expect(ns('shuto-uke')).toEqual([18, 19, 20, 21]);
  });

  it('kokutsu weights the REAR foot; zenkutsu weights the front (doc 02 §11)', () => {
    for (const m of K.moves) {
      const want = m.stance === 'kokutsu' ? (m.front === 'L' ? 'R' : 'L') : m.front;
      expect(m.weighted, `move ${m.n}`).toBe(want);
    }
    /* doc 02 §6.1's own "(R weighted)" / "(L weighted)" column for the kokutsu tail. */
    expect([18, 19, 20, 21].map((n) => `${at(n).front}/${at(n).weighted}`))
      .toEqual(['L/R', 'R/L', 'R/L', 'L/R']);
  });

  it('doc 02 §1.3 — TATE-B hikite on the four shuto-uke, HIP-A everywhere else', () => {
    for (const m of K.moves) {
      expect(m.hikite, `move ${m.n}`).toBe(m.tech.id === 'shuto-uke' ? 'TATE-B' : 'HIP-A');
    }
  });

  it('every move carries a doc anchor naming its own §6.1 row', () => {
    for (const m of K.moves) expect(m.src).toBe(`02-kata-sequences.md §6.1 row ${m.n}`);
  });
});

describe('doc 02 §11 invariant 1 — the heading chain, including the diagonals', () => {
  it('the dHeadingDeg chain reproduces every authored headingDeg', () => {
    let h = 0;
    for (const m of K.moves) {
      h = (((h + m.dHeadingDeg) % 360) + 360) % 360;
      expect(h, `move ${m.n}`).toBe(m.headingDeg);
    }
  });

  it('doc 02 §9 d9 — move 19 is −45 (H 45) and move 20 is −135 (H 270)', () => {
    expect(at(19).dHeadingDeg).toBe(-45);
    expect(at(19).headingDeg).toBe(45);
    expect(at(20).dHeadingDeg).toBe(-135);
    expect(at(20).headingDeg).toBe(270);
    expect(at(21).dHeadingDeg).toBe(45);
    expect(at(21).headingDeg).toBe(315);
    /* doc 02 §1: H 45 = front-left, H 315 = front-right — both have a −Z (forward) component. */
    expect(f(45)[1]).toBeLessThan(0);
    expect(f(315)[1]).toBeLessThan(0);
  });

  it('doc 02 §9 d7/d8 — moves 10 and 18 are +270 CCW', () => {
    for (const n of [10, 18]) {
      expect(at(n).dHeadingDeg, `move ${n}`).toBe(270);
      expect(at(n).rule, `move ${n}`).toBe('R3');
      expect(at(n).pivot, `move ${n}`).toBe('R');
    }
    expect(at(10).headingDeg).toBe(270);
    expect(at(18).headingDeg).toBe(90);
  });

  it('move 4 is the ONLY R0, the only S3, and the only zero-displacement move', () => {
    expect(K.moves.filter((m) => m.rule === 'R0').map((m) => m.n)).toEqual([4]);
    expect(K.moves.filter((m) => m.sim === 'S3').map((m) => m.n)).toEqual([4]);
    expect(at(4).pivot).toBeNull();
    expect(at(4).pivotKind).toBe('NONE');
    /* Net zero: its embusen row is move 3's, unchanged (doc 02 §9 d3). */
    expect(at(4).embusen.ff).toEqual(at(3).embusen.ff);
    expect(at(4).embusen.rf).toEqual(at(3).embusen.rf);
    expect(at(4).embusen.c).toEqual(at(3).embusen.c);
    /* doc 02 §9 d4: the disputed 0.78 H end height, not the canonical chudan 0.72. */
    expect(at(4).tech.targetH).toBe(0.78);
    expect(at(4).notes).toMatch(/d3\/d4/);
  });
});

describe('doc 02 §6.2 — the two diagonal spurs, at full precision', () => {
  it('move 19 (NW spur): ff = (0.81, 0) + f(45), rounding to doc 02\'s (+1.517, −0.707)', () => {
    expect(at(19).embusen.rf).toEqual([0.81, 0.0]);
    expect(at(19).embusen.ff[0]).toBeCloseTo(0.81 + SQRT2_2, 12);
    expect(at(19).embusen.ff[1]).toBeCloseTo(-SQRT2_2, 12);
    /* doc 02 §6.2's printed row, to its own three decimals. */
    expect(at(19).embusen.ff[0]).toBeCloseTo(1.517, 3);
    expect(at(19).embusen.ff[1]).toBeCloseTo(-0.707, 3);
    expect(at(19).embusen.c[0]).toBeCloseTo(1.164, 3);
    expect(at(19).embusen.c[1]).toBeCloseTo(-0.354, 3);
  });

  it('move 21 (NE spur): ff = (−0.19, 0) + f(315), and §2.1\'s c(21) = (−0.544, −0.354)', () => {
    expect(at(21).embusen.rf).toEqual([-0.19, 0.0]);
    expect(at(21).embusen.ff[0]).toBeCloseTo(-0.19 - SQRT2_2, 12);
    expect(at(21).embusen.ff[1]).toBeCloseTo(-SQRT2_2, 12);
    expect(at(21).embusen.ff[0]).toBeCloseTo(-0.897, 3);
    /* §2.1 assertion 3's literal — the SAME pin tests/contracts/handedness.test.ts holds. */
    expect(at(21).embusen.c[0]).toBeCloseTo(-0.544, 3);
    expect(at(21).embusen.c[1]).toBeCloseTo(-0.354, 3);
    /* …and the exact value it rounds FROM. Both ends, so neither can drift alone. */
    expect(at(21).embusen.c[0]).toBeCloseTo(-0.5435533905932738, 15);
    expect(at(21).embusen.c[1]).toBeCloseTo(-0.3535533905932737, 15);
    /* The margin against the 3-decimal pin. If a later edit rounds the literals, this fails. */
    expect(Math.abs(at(21).embusen.c[0] - -0.544)).toBeGreaterThan(4e-4);
    expect(Math.abs(at(21).embusen.c[0] - -0.544)).toBeLessThan(5e-4);
  });

  it('doc 02 §6.3 — naore draws the left foot 1.30 L back to (+0.19, 0)', () => {
    const travel = Math.hypot(at(21).embusen.ff[0] - 0.19, at(21).embusen.ff[1] - 0);
    expect(travel).toBeCloseTo(1.3, 2);
    expect(K.closingCeremony[1]?.params?.leftFootTravelL).toBeCloseTo(1.3, 12);
    /* The right foot has not moved since move 20, so the residual is exactly zero. */
    expect(at(20).embusen.ff).toEqual([-0.19, 0.0]);
    expect(at(21).embusen.rf).toEqual([-0.19, 0.0]);
    expect(yameClosureResidualL(K)).toBeCloseTo(0, 12);
  });
});

describe('doc 02 §11 invariant 2 — ff = pivot + Lk·f(H), to 1e-9 L', () => {
  it('every authored ff is the anchor foot plus one step along the new facing', () => {
    for (const m of K.moves) {
      const anchor = m.embusen.rf;
      const d = f(m.headingDeg);
      expect(m.embusen.ff[0], `move ${m.n} ff.x`).toBeCloseTo(anchor[0] + STEP_L * d[0], 9);
      expect(m.embusen.ff[1], `move ${m.n} ff.z`).toBeCloseTo(anchor[1] + STEP_L * d[1], 9);
    }
  });

  it('every authored c is the midpoint of ff and rf', () => {
    for (const m of K.moves) {
      expect(m.embusen.c[0], `move ${m.n} c.x`).toBeCloseTo((m.embusen.ff[0] + m.embusen.rf[0]) / 2, 12);
      expect(m.embusen.c[1], `move ${m.n} c.z`).toBeCloseTo((m.embusen.ff[1] + m.embusen.rf[1]) / 2, 12);
    }
  });

  it('assertEmbusenInvariants passes at 1e-9 L — the whole reason for the 17-digit literals', () => {
    expect(() => assertEmbusenInvariants(K, 1e-9)).not.toThrow();
  });
});

describe('doc 02 §3.2 — the σ orbit, and the kokutsu tail that lies outside it', () => {
  it('σ(c_i) === c_(i+9) for i ∈ {1,2,3}', () => {
    for (const i of [1, 2, 3]) {
      const [sx, sz] = sigma(at(i).embusen.c[0], at(i).embusen.c[1]);
      expect(sx, `σ(c${i}).x`).toBeCloseTo(at(i + 9).embusen.c[0], 12);
      expect(sz, `σ(c${i}).z`).toBeCloseTo(at(i + 9).embusen.c[1], 12);
    }
  });

  it('σ(c_5..c_9) === c_13..c_17', () => {
    for (let i = 5; i <= 9; i++) {
      const [sx, sz] = sigma(at(i).embusen.c[0], at(i).embusen.c[1]);
      expect(sx, `σ(c${i}).x`).toBeCloseTo(at(i + 8).embusen.c[0], 12);
      expect(sz, `σ(c${i}).z`).toBeCloseTo(at(i + 8).embusen.c[1], 12);
    }
  });

  it('moves 18–21 have NO σ counterpart anywhere in the kata', () => {
    for (const n of [18, 19, 20, 21]) {
      const [sx, sz] = sigma(at(n).embusen.c[0], at(n).embusen.c[1]);
      const hit = K.moves.find(
        (m) => Math.abs(m.embusen.c[0] - sx) < 1e-6 && Math.abs(m.embusen.c[1] - sz) < 1e-6,
      );
      /* Moves 18 and 20 sit on the bottom bar at c = (+0.31, 0), whose σ-image (−0.69, −4) IS in
       * the kata (moves 10 and 12) — so only the two SPUR moves are genuinely orbit-free. */
      if (n === 19 || n === 21) expect(hit, `σ(c${n}) unexpectedly matched move ${hit?.n}`).toBeUndefined();
    }
    /* The §2.1 deviation note's own enumeration: σ(c21) = (+0.1636, −3.6464), matching nothing. */
    const [sx, sz] = sigma(at(21).embusen.c[0], at(21).embusen.c[1]);
    expect(sx).toBeCloseTo(0.1635533905932738, 12);
    expect(sz).toBeCloseTo(-3.6464466094067262, 12);
  });

  it('move 21 mirrors move 19 about the move-20 stance centre x = +0.31', () => {
    expect(0.62 - at(19).embusen.c[0]).toBeCloseTo(at(21).embusen.c[0], 12);
    expect(at(19).embusen.c[1]).toBeCloseTo(at(21).embusen.c[1], 12);
    expect(at(20).embusen.c[0]).toBeCloseTo(0.31, 12);
  });

  it('every c is inside the 4 L × 4 L bounding box', () => {
    const poly = embusenPolyline(K);
    for (const [x, z] of poly) {
      expect(x).toBeGreaterThanOrEqual(EMB_BBOX.xMin);
      expect(x).toBeLessThanOrEqual(EMB_BBOX.xMax);
      expect(z).toBeGreaterThanOrEqual(EMB_BBOX.zMin);
      expect(z).toBeLessThanOrEqual(EMB_BBOX.zMax);
    }
  });
});

describe('doc 02 §7 / §1.4 — rhythm', () => {
  it('kiai at [9, 17]', () => {
    expect(K.kiaiAt).toEqual([9, 17]);
    expect(K.moves.filter((m) => m.kiai).map((m) => m.n)).toEqual([9, 17]);
    /* Both are the third of a triple, both right-armed — doc 02 §7's own description. */
    expect(at(9).tech.arm).toBe('R');
    expect(at(17).tech.arm).toBe('R');
  });

  it('fast pairs are (4,5), (8,9) and (16,17), and only their second members carry tempo F', () => {
    expect(K.fastPairs.map((p) => [...p])).toEqual([[4, 5], [8, 9], [16, 17]]);
    expect(K.moves.filter((m) => m.tempo === 'F').map((m) => m.n)).toEqual([5, 8, 9, 16, 17]);
  });

  it('Σ tSlotS = 39.75 s exactly, and inside doc 02 §1.4\'s ±20 %', () => {
    const sum = K.moves.reduce((a, m) => a + m.tSlotS, 0);
    expect(sum).toBeCloseTo(39.75, 9);
    expect(K.totalMoveSecondsT1).toBe(MOVE_SECONDS_T1['heian-shodan']);
    expect(Math.abs(sum - K.totalMoveSecondsT1)).toBeLessThanOrEqual(
      K.totalMoveSecondsT1 * EMB_TSLOT_TOL_FRAC,
    );
  });

  it('the two Heian-only tempo classes land on the moves that need them', () => {
    expect(K.moves.filter((m) => m.tempo === 'T135').map((m) => m.n)).toEqual([20]);
    expect(K.moves.filter((m) => m.tempo === 'D45').map((m) => m.n)).toEqual([19, 21]);
    expect(K.moves.filter((m) => m.tempo === 'T270').map((m) => m.n)).toEqual([10, 18]);
  });

  it('the pause map follows Taikyoku\'s published rule, with move 4 the sole P0', () => {
    const turnAfter = new Set(
      K.moves.filter((m) => m.n > 1 && m.dHeadingDeg !== 0).map((m) => m.n - 1),
    );
    for (const m of K.moves) {
      if (m.n === 4) {
        /* doc 02 §7 fast pair C + doc 04 §6.3's P0 definition ("block+counter in one breath"). */
        expect(m.pause, 'move 4 is the only P0 in either kata').toBe('P0');
        continue;
      }
      const expected = m.n === 21 ? 'P4' : m.kiai ? 'P3' : turnAfter.has(m.n) ? 'P2' : 'P1';
      expect(m.pause, `move ${m.n}`).toBe(expected);
    }
    expect(K.moves.filter((m) => m.pause === 'P0').map((m) => m.n)).toEqual([4]);
    expect(K.moves.filter((m) => m.pause === 'P3').map((m) => m.n)).toEqual([9, 17]);
    expect(K.moves.filter((m) => m.pause === 'P4').map((m) => m.n)).toEqual([21]);
  });

  it('S1 on straight steps, S2 on turns, S3 on move 4 — but move 1 is S1 (doc 02 §6.1/§8)', () => {
    /* Same exception as Taikyoku: move 1 turns +90 out of hachiji and doc 02 prints `S1`, because
     * S2's content (head leads hips by 0.10 s, pivot foot shows zero translation) needs a previous
     * heading and a front foot, and yoi has neither. */
    expect(at(1).dHeadingDeg).toBe(90);
    expect(at(1).sim).toBe('S1');
    for (const m of K.moves) {
      const want = m.n === 4 ? 'S3' : m.n === 1 ? 'S1' : m.dHeadingDeg === 0 ? 'S1' : 'S2';
      expect(m.sim, `move ${m.n}`).toBe(want);
    }
    expect(K.moves.filter((m) => m.sim === 'S2').map((m) => m.n))
      .toEqual([3, 6, 10, 12, 14, 18, 19, 20, 21]);
  });
});

describe('doc 02 §11 — validateKata', () => {
  it('accepts the shipped score', () => {
    expect(() => validateKata(K)).not.toThrow();
  });

  it('K3 catches a kokutsu row that weights the front foot', () => {
    const broken = {
      ...K,
      moves: K.moves.map((m) => (m.n === 18 ? { ...m, weighted: m.front } : m)),
    };
    expect(() => validateKata(broken)).toThrowError(/K3-weighted-foot.*heian-shodan move 18/s);
  });

  it('K2 catches a target height pushed out of its level zone', () => {
    const broken = {
      ...K,
      moves: K.moves.map((m) =>
        m.n === 4 ? { ...m, tech: { ...m.tech, targetH: 0.95 } } : m,
      ),
    };
    expect(() => validateKata(broken)).toThrowError(/K2-target-zone/);
  });

  it('K5 catches a shuto-uke authored with the HIP-A hikite', () => {
    const broken = {
      ...K,
      moves: K.moves.map((m) => (m.n === 19 ? { ...m, hikite: 'HIP-A' as const } : m)),
    };
    expect(() => validateKata(broken)).toThrowError(/K5-hikite-form/);
  });

  it('I2 catches a moved spur: rounding move 21 to doc 02\'s three decimals still passes at 1e-3', () => {
    const rounded = {
      ...K,
      moves: K.moves.map((m) =>
        m.n === 21
          ? { ...m, embusen: { ...m.embusen, c: [-0.544, -0.354] as const } }
          : m,
      ),
    };
    /* The default 1e-3 tolerance is what doc 02's printed table can support… */
    expect(() => validateKata(rounded)).not.toThrow();
    /* …and 1e-9 is what catches it. That gap is the reason the literals carry 17 digits. */
    expect(() => assertEmbusenInvariants(rounded, 1e-9)).toThrowError(/I2-c-recompute/);
  });
});

describe('doc 02 §2 — the ceremony', () => {
  it('FINAL_HOLD is held in move 21\'s KOKUTSU, and naore turns +45', () => {
    expect(K.closingCeremony[0]?.stance).toBe('kokutsu');
    expect(K.closingCeremony[1]?.params?.dHeadingDeg).toBe(45);
  });

  it('the full clip is 54.65 s at T1 (doc 02 §2)', () => {
    const open = K.openingCeremony.reduce((a, p) => a + p.durationS, 0);
    const close = K.closingCeremony.reduce((a, p) => a + p.durationS, 0);
    expect(open).toBeCloseTo(6.7, 12);
    expect(close).toBeCloseTo(8.2, 12);
    expect(open + K.totalMoveSecondsT1 + close).toBeCloseTo(54.65, 9);
  });
});
