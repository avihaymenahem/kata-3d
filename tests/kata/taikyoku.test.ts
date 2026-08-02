/**
 * tests/kata/taikyoku.test.ts — B2's numeric verification for Taikyoku Shodan.
 *
 * OWNERSHIP B2 asks for exactly this list: "heading chain from `dHeadingDeg` reproduces every
 * `headingDeg`; `ff` recomputed as `pivot + Lk·f(H)` matches the authored `ff` to 1e-9 L; kiai at
 * `[8, 16]`; fast pairs `[[7,8],[15,16]]`; Σ `tSlotS` = 35.25 ± 20 %".
 *
 * ═══ WHY THESE ARE NOT A RESTATEMENT OF `assertEmbusenInvariants` ═══════════════════════════
 * The generator's own invariants run at the DEFAULT tolerance (`EMB_FF_TOL_L = 1e-3`), which is
 * what doc 02's three-decimal printed tables can support. This file re-runs them at **1e-9** —
 * three decimal orders tighter — which only passes because both kata author full-precision
 * coordinates. It also asserts the things the generator cannot see: the technique inventory, the
 * doc 04 §6.3 pause map, and the σ orbit read off doc 02 §3.2 rather than out of B1's table.
 *
 * `getKata` is read through the `src/data` BARREL, not from `src/data/kata/**` — cross-block reads
 * go through the barrel (OWNERSHIP rule 3), and this test is the consumer-side proof that B2's
 * landing in B1's barrel actually happened.
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

const K = getKata('taikyoku-shodan');
const at = (n: number) => {
  const m = K.moves.find((x) => x.n === n);
  if (m === undefined) throw new Error(`no move ${n}`);
  return m;
};

const DEG = Math.PI / 180;
/** doc 02 §1: `f(H) = (sin H, 0, −cos H)`, projected to XZ. AUTHORED frame. */
const f = (h: number): readonly [number, number] => [Math.sin(h * DEG), -Math.cos(h * DEG)];

/** doc 02 §1.1: the embusen step is 1.00 L for both zenkutsu and kokutsu (`Lk = 1.00 L`). */
const STEP_L = 1;

describe('doc 02 §4.1 — structure', () => {
  it('is 20 zenkutsu moves, numbered 1..20', () => {
    expect(K.id).toBe('taikyoku-shodan');
    expect(K.moveCount).toBe(20);
    expect(K.moves).toHaveLength(20);
    expect(K.moves.map((m) => m.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(K.moves.every((m) => m.stance === 'zenkutsu')).toBe(true);
  });

  it('uses ONLY gedan-barai (8x) and chudan oi-zuki (12x) — doc 02 §4 preamble', () => {
    const byId = K.moves.reduce<Record<string, number>>((acc, m) => {
      acc[m.tech.id] = (acc[m.tech.id] ?? 0) + 1;
      return acc;
    }, {});
    expect(byId).toEqual({ 'gedan-barai': 8, 'oi-zuki': 12 });
    expect(K.moves.filter((m) => m.tech.id === 'gedan-barai').map((m) => m.n))
      .toEqual([1, 3, 5, 9, 11, 13, 17, 19]);
  });

  it('every move carries a doc anchor naming its own §4.1 row', () => {
    for (const m of K.moves) expect(m.src).toBe(`02-kata-sequences.md §4.1 row ${m.n}`);
  });

  it('labels are legible under a contact-sheet thumbnail (OWNERSHIP B2 visual check)', () => {
    expect(at(1).label).toBe('hidari gedan-barai');
    expect(at(1).labelJp).toBe('左下段払い');
    expect(at(1).labelEn).toBe('left downward block');
    expect(at(2).label).toBe('migi chudan oi-zuki');
    expect(at(2).labelJp).toBe('右中段追い突き');
    /* The label's side is the WORKING arm, which is what makes a mirrored move legible. */
    for (const m of K.moves) expect(m.label.startsWith(m.tech.arm === 'L' ? 'hidari' : 'migi')).toBe(true);
  });
});

describe('doc 02 §11 invariant 1 — the heading chain', () => {
  it('the dHeadingDeg chain reproduces every authored headingDeg', () => {
    let h = 0;
    for (const m of K.moves) {
      h = (((h + m.dHeadingDeg) % 360) + 360) % 360;
      expect(h, `move ${m.n}`).toBe(m.headingDeg);
    }
    /* doc 02 §4.3: yame is +90 from move 20's H = 270, closing the loop at H = 0. */
    expect(at(20).headingDeg).toBe(270);
    expect((at(20).headingDeg + 90) % 360).toBe(0);
  });

  it('doc 02 §9 d2 — moves 9 and 17 traverse +270 CCW, not −90', () => {
    expect(at(9).dHeadingDeg).toBe(270);
    expect(at(17).dHeadingDeg).toBe(270);
    /* The end pose is identical either way; the DIFFERENCE is the path, and it is authored. */
    expect((at(8).headingDeg + 270) % 360).toBe(at(9).headingDeg);
  });

  it('doc 02 §9 d1 — the three 180° turns pivot on the REAR foot', () => {
    for (const n of [3, 11, 19]) {
      expect(at(n).rule, `move ${n}`).toBe('R2');
      expect(at(n).dHeadingDeg, `move ${n}`).toBe(-180);
      expect(at(n).pivot, `move ${n}`).toBe('L');
      /* R2 keeps the same foot forward: the pivot is the rear foot and stays rear. */
      expect(at(n).front, `move ${n}`).toBe('R');
    }
  });
});

describe('doc 02 §11 invariant 2 — ff = pivot + Lk·f(H), to 1e-9 L', () => {
  it('every authored ff is the anchor foot plus one step along the new facing', () => {
    /* The anchor is the foot the previous move leaves planted; the generator's own rule is
     * "always place the moving foot from the pivot foot, then take the midpoint" (§3.1). */
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

  it('assertEmbusenInvariants passes at 1e-9 L, not just at the default 1e-3', () => {
    expect(() => assertEmbusenInvariants(K, 1e-9)).not.toThrow();
  });
});

describe('doc 02 §3.2 — the σ orbit and the repeat', () => {
  it('σ(c_i) === c_(i+8) for i = 1..8', () => {
    for (let i = 1; i <= 8; i++) {
      const [sx, sz] = sigma(at(i).embusen.c[0], at(i).embusen.c[1]);
      expect(sx, `σ(c${i}).x`).toBeCloseTo(at(i + 8).embusen.c[0], 12);
      expect(sz, `σ(c${i}).z`).toBeCloseTo(at(i + 8).embusen.c[1], 12);
    }
  });

  it('c_17..c_20 === c_1..c_4 — the figure repeats', () => {
    for (let i = 1; i <= 4; i++) {
      expect(at(i + 16).embusen.c[0], `c${i + 16}.x`).toBeCloseTo(at(i).embusen.c[0], 12);
      expect(at(i + 16).embusen.c[1], `c${i + 16}.z`).toBeCloseTo(at(i).embusen.c[1], 12);
    }
  });

  it('the "I" is NOT mirror-symmetric: bottom bar at x = +0.31, top bar at x = −0.69', () => {
    /* doc 02 §3.2's "key structural fact (non-obvious, assert it in code)". The two bars are
     * offset by exactly 1.00 L, which is the consequence of R2 retreating one stance length. */
    expect(at(1).embusen.c[0]).toBeCloseTo(0.31, 12);
    expect(at(9).embusen.c[0]).toBeCloseTo(-0.69, 12);
    expect(at(1).embusen.c[0] - at(9).embusen.c[0]).toBeCloseTo(1.0, 12);
  });

  it('every c is inside the 4 L × 4 L bounding box, and the trace fills it', () => {
    const poly = embusenPolyline(K);
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(EMB_BBOX.xMin);
    expect(Math.max(...xs)).toBeLessThanOrEqual(EMB_BBOX.xMax);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(EMB_BBOX.zMin);
    expect(Math.max(...zs)).toBeLessThanOrEqual(EMB_BBOX.zMax);
    /* The stance-centre polyline opens and closes on the yoi datum. */
    expect(poly[0]).toEqual([0, 0]);
    expect(poly[poly.length - 1]).toEqual([0, 0]);
  });

  it('doc 02 §4.3 — the yame closure residual is 0.00 cm', () => {
    expect(yameClosureResidualL(K)).toBeCloseTo(0, 12);
  });
});

describe('doc 02 §5 / §1.4 — rhythm', () => {
  it('kiai at [8, 16]', () => {
    expect(K.kiaiAt).toEqual([8, 16]);
    expect(K.moves.filter((m) => m.kiai).map((m) => m.n)).toEqual([8, 16]);
  });

  it('fast pairs are [[7,8],[15,16]] and only their second members carry tempo F', () => {
    expect(K.fastPairs.map((p) => [...p])).toEqual([[7, 8], [15, 16]]);
    expect(K.moves.filter((m) => m.tempo === 'F').map((m) => m.n)).toEqual([7, 8, 15, 16]);
  });

  it('Σ tSlotS = 35.25 s exactly, and inside doc 02 §1.4\'s ±20 %', () => {
    const sum = K.moves.reduce((a, m) => a + m.tSlotS, 0);
    expect(sum).toBeCloseTo(35.25, 9);
    expect(K.totalMoveSecondsT1).toBe(MOVE_SECONDS_T1['taikyoku-shodan']);
    expect(Math.abs(sum - K.totalMoveSecondsT1)).toBeLessThanOrEqual(
      K.totalMoveSecondsT1 * EMB_TSLOT_TOL_FRAC,
    );
  });

  it('doc 04 §6.3\'s Taikyoku pause map, verbatim', () => {
    const byClass = (c: string) => K.moves.filter((m) => m.pause === c).map((m) => m.n);
    expect(byClass('P1')).toEqual([1, 3, 5, 6, 7, 9, 11, 13, 14, 15, 17, 19]);
    expect(byClass('P2')).toEqual([2, 4, 10, 12, 18]);
    expect(byClass('P3')).toEqual([8, 16]);
    expect(byClass('P4')).toEqual([20]);
    /* §6.3's own budget line: 12 × P1 + 5 × P2 + 2 × P3 + 1 × P4 = 20 counts. */
    expect(byClass('P1').length + byClass('P2').length + byClass('P3').length + byClass('P4').length)
      .toBe(20);
  });

  it('the pause map is the RULE the Heian map is derived from', () => {
    /* P2 marks the count immediately BEFORE a turn; P3 (kiai) and P4 (last) take precedence.
     * Heian's map is generated by this rule, so pinning it here is what keeps the two honest. */
    const turnAfter = new Set(
      K.moves.filter((m) => m.n > 1 && m.dHeadingDeg !== 0).map((m) => m.n - 1),
    );
    for (const m of K.moves) {
      const expected = m.n === 20 ? 'P4' : m.kiai ? 'P3' : turnAfter.has(m.n) ? 'P2' : 'P1';
      expect(m.pause, `move ${m.n}`).toBe(expected);
    }
  });

  it('S1 on straight steps, S2 on turns — but move 1 is S1 (doc 02 §4.1/§8)', () => {
    /* Move 1 turns +90 and is still `S1` in doc 02's own table, in BOTH kata. S2's content is a
     * head-leads-hips lead and a ZERO-TRANSLATION pivot foot; move 1 leaves hachiji, where there
     * is no front foot to pivot on and no previous heading for the head to lead away from. The
     * authored column wins over the shape of the rule (§2.6). */
    expect(at(1).dHeadingDeg).toBe(90);
    expect(at(1).sim).toBe('S1');
    for (const m of K.moves) {
      const want = m.n === 1 ? 'S1' : m.dHeadingDeg === 0 ? 'S1' : 'S2';
      expect(m.sim, `move ${m.n}`).toBe(want);
    }
    expect(K.moves.filter((m) => m.sim === 'S2').map((m) => m.n)).toEqual([3, 5, 9, 11, 13, 17, 19]);
  });
});

describe('doc 02 §11 — validateKata', () => {
  it('accepts the shipped score', () => {
    expect(() => validateKata(K)).not.toThrow();
  });

  it('throws with the FAILING INVARIANT\'S NAME, not a generic message', () => {
    /* K3: weighted must equal front in zenkutsu. Flip it on one move only. */
    const broken = {
      ...K,
      moves: K.moves.map((m) => (m.n === 6 ? { ...m, weighted: 'L' as const } : m)),
    };
    expect(() => validateKata(broken)).toThrowError(/K3-weighted-foot/);

    /* K0: the two count fields must agree. */
    expect(() => validateKata({ ...K, moveCount: 19 })).toThrowError(/K0-move-count/);

    /* K9: an F-tempo move that is in no declared pair is a timing bug. */
    expect(() => validateKata({ ...K, fastPairs: [] })).toThrowError(/K9-fast-undeclared/);

    /* I1: the embusen half is rethrown from B1's generator unchanged. */
    const bentChain = {
      ...K,
      moves: K.moves.map((m) => (m.n === 5 ? { ...m, dHeadingDeg: 45 } : m)),
    };
    expect(() => validateKata(bentChain)).toThrowError(/I1-heading-chain/);
  });
});

describe('doc 02 §2 — the ceremony', () => {
  it('opens with REI_IN / ANNOUNCE / YOI / SET = 6.70 s', () => {
    expect(K.openingCeremony.map((p) => p.id)).toEqual(['REI_IN', 'ANNOUNCE', 'YOI', 'SET']);
    expect(K.openingCeremony.reduce((a, p) => a + p.durationS, 0)).toBeCloseTo(6.7, 12);
  });

  it('closes with FINAL_HOLD / YAME / SETTLE / ATTENTION / REI_OUT = 8.20 s', () => {
    expect(K.closingCeremony.map((p) => p.id))
      .toEqual(['FINAL_HOLD', 'YAME', 'SETTLE', 'ATTENTION', 'REI_OUT']);
    expect(K.closingCeremony.reduce((a, p) => a + p.durationS, 0)).toBeCloseTo(8.2, 12);
  });

  it('FINAL_HOLD is held in move 20\'s stance, and yame turns +90 (doc 02 §4.3)', () => {
    expect(K.closingCeremony[0]?.stance).toBe('zenkutsu');
    expect(K.closingCeremony[1]?.params?.dHeadingDeg).toBe(90);
    expect(K.closingCeremony[1]?.params?.leftFootTravelL).toBeCloseTo(1.38, 12);
  });

  it('the full clip is 50.15 s at T1 (doc 02 §2)', () => {
    const open = K.openingCeremony.reduce((a, p) => a + p.durationS, 0);
    const close = K.closingCeremony.reduce((a, p) => a + p.durationS, 0);
    expect(open + K.totalMoveSecondsT1 + close).toBeCloseTo(50.15, 9);
  });
});
