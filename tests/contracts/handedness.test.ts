/**
 * tests/contracts/handedness.test.ts — the three §2.1 assertions, VERBATIM.
 *
 * RED-FIRST (ARCHITECTURE.md §4.0, §8 Phase 0). It references symbols that later blocks create;
 * it must fail NOW, naming the missing symbol, and go green when the solver, the kata data and
 * the rig land.
 *
 * Why these three and no others: docs 01/02/03/04/06 label `+X` as the character's LEFT, doc 07
 * §0.1 proves that frame is left-handed, and three.js is right-handed by construction. §2.1's
 * resolution is that authored data keeps every doc number verbatim and exactly ONE conversion
 * exists, in `src/solve/frame.ts`. These assertions are the only thing standing between that
 * resolution and rubric A10, "the whole kata is mirrored" — which is invisible to the scorecard
 * and to Channel B, because both are built from the same `SIDE_SIGN` (§7.6).
 *
 *   1. at *yoi*, `landmarks.eye_L.x < 0` and `landmarks.eye_R.x > 0`;
 *   2. Taikyoku move 1 (`hidari gedan-barai`, `H = 90`): facing is world `−X`, and the LEFT ankle
 *      is `0.540 H` ahead of the right along that facing, and `landmarks.LeftFistCenter.x < 0`;
 *   3. Heian move 21: `c = (−0.544, −0.354) L`, and the kata's `σ` symmetry holds.
 *
 * DEVIATION FROM §2.1 ASSERTION 3, and why. §2.1 states the third assertion as "Heian move 21:
 * pelvis XZ = `σ`-image of move 12's". That pairing is arithmetically impossible and no data set
 * can satisfy it. Doc 02 §6.2 gives `c12 = (−0.690, −4.000)`; with doc 02 §3.2's own
 * `σ(x,z) = (−0.38 − x, −4.00 − z)` that maps to `(+0.310, 0.000)` — which is `c1`/`c3`/`c18`/`c20`,
 * 0.854 L away from `c21`. Doc 02 §3.2 enumerates the real Heian orbit itself:
 * `σ(c_i) == c_(i+9)` for `i ∈ {1,2,3}` and `σ(c_5..c_9) == c_13..c_17`. Moves 18–21 are the
 * kokutsu tail hanging off the two diagonal spurs and have NO σ counterpart anywhere in the kata —
 * `σ(c21) = (+0.164, −3.646)` matches nothing (enumerated, all 21 values). §2.6 gives the research
 * doc the fact, so the pairing is corrected to `3 ↔ 12`, which is EXACT (both zenkutsu, headings
 * 270° and 90°, i.e. 180° apart, so `PELVIS_AHEAD_OF_C_H[zenkutsu] = +0.049` maps correctly under
 * the point reflection and the pelvis form closes to 1e-16). `σ(c1)==c10` and `σ(c2)==c11` are
 * added for coverage. The `c(21) = (−0.544, −0.354)` literal of §2.1 is CORRECT and is kept as its
 * own independent expectation; the move-21 symmetry that does hold is the x-mirror of move 19
 * about the move-20 stance centre `x = +0.31`, asserted below.
 */

import { describe, expect, it } from 'vitest';
import {
  BONE_ORDER,
  BONE_PARENT_NAME,
  CANONICAL_COUNT,
  CANONICAL_INDEX,
  DEG,
  embSigma,
  EMB_POLYLINE_H_L,
  EMB_SIGMA_X_CONST_L,
  EMB_SIGMA_Z_CONST_L,
  facingAuthored,
  facingWorld,
  H,
  LAYER_WEIGHTS_DEFAULT,
  PRIMARY_AXIS_BY_NAME,
  REST_OFFSET_BY_NAME,
  SIDE_SIGN,
  sideSign,
  WORLD_YAW_OF_HEADING_SIGN,
  type BoneName,
} from '../../src/contracts';

/* ── red-first plumbing ───────────────────────────────────────────────────────
 * A dynamic import with a NON-LITERAL specifier: `tsc --noEmit` cannot resolve it, so a module
 * that does not exist yet is a RUNTIME failure naming the missing symbol rather than a type
 * error in this file. That distinction is the Phase-0 exit gate.
 * ──────────────────────────────────────────────────────────────────────────── */
async function need(modulePath: string, ...symbols: readonly string[]): Promise<Record<string, unknown>> {
  const spec: string = modulePath;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (e) {
    // Distinguish "not written yet" (the Phase-0 expectation) from "exists but threw at load".
    // Reporting symbols[0] for BOTH cases sent the reader after a symbol that was already
    // exported, in a module that plainly existed, with the real error discarded.
    const msg = String((e as Error).message);
    const absent = /Cannot find module|Failed to (?:load|resolve)/.test(msg);
    throw new Error(
      absent
        ? `RED-FIRST: module '${modulePath}' does not exist yet (need: ${symbols.join(', ')}). ` +
          `(${msg.split('\n')[0]})`
        : `LOAD ERROR in '${modulePath}': ${msg}`,
      { cause: e },
    );
  }
  const missing = symbols.filter((s) => !(s in mod));
  if (missing.length) {
    throw new Error(
      `RED-FIRST: missing symbol '${missing[0]}' in module '${modulePath}' ` +
        `(needed: ${symbols.join(', ')})`,
    );
  }
  return mod;
}

/** doc 02 §3.2, from the ONE frozen home (`units.ts`) rather than a local literal. */
const SIGMA = embSigma;

describe('§2.1 preconditions (contracts only — green from Phase 0)', () => {
  it('SIDE_SIGN is -1: authored LEFT (+X) becomes world -X', () => {
    expect(SIDE_SIGN).toBe(-1);
    expect(sideSign('L')).toBe(-1);
    expect(sideSign('R')).toBe(1);
  });

  it('the AUTHORED rest offsets keep the doc frame: eye_L has +x, eye_R has -x', () => {
    expect(REST_OFFSET_BY_NAME.eye_L[0]).toBeGreaterThan(0);
    expect(REST_OFFSET_BY_NAME.eye_R[0]).toBeLessThan(0);
    expect(REST_OFFSET_BY_NAME.eye_L[0]).toBe(-REST_OFFSET_BY_NAME.eye_R[0]);
  });

  it("doc 03 §13's dx = -s*0.130 lands the chudan punch on the centre line, both sides", () => {
    // doc 03 §0.3: `dx` is TORSO-LOCAL, origin = GH of the ACTING arm, `+` = toward the
    // character's LEFT, "expressed as +-s*k". §13 writes every zuki row as dx = -s*0.130.
    // §3.8: TechniqueSpec.dx stores the MAGNITUDE k; the solver applies -s*dx, in WORLD space.
    // §2.1: s(L) = SIDE_SIGN*(+1) = -1, s(R) = SIDE_SIGN*(-1) = +1.
    //
    // The check that this is all consistent: half the biacromial breadth is 0.259/2 = 0.1295 H
    // (doc 07 §0.2), so -s*0.130 from the acting GH must put MCP2 on the mid-sagittal plane —
    // which is exactly the classic Shotokan chudan-zuki alignment. If the sign were inverted the
    // fist would finish 0.26 H off the centre line, on the wrong side of the body.
    const k = 0.13;
    const ghFromCentreH = 0.259 / 2;
    for (const hand of ['L', 'R'] as const) {
      const s = sideSign(hand);
      const ghWorldX = s * ghFromCentreH; // left GH at world -X, right GH at world +X
      expect(ghWorldX * (hand === 'L' ? 1 : -1)).toBeLessThan(0);
      expect(ghWorldX + -s * k, `${hand} chudan-zuki MCP2 world x`).toBeCloseTo(0, 2);
    }

    // gedan-barai (dx = -s*0.046) must stay on the acting arm's OWN side of the centre line.
    for (const hand of ['L', 'R'] as const) {
      const s = sideSign(hand);
      const fistX = s * ghFromCentreH + -s * 0.046;
      expect(Math.sign(fistX), `${hand} gedan-barai fist stays on its own side`).toBe(s);
    }

    // And the two sides are exact mirrors — a single multiplication by s, no quaternion chirality.
    expect(-sideSign('L') * k).toBe(-(-sideSign('R') * k));
  });

  it('facingWorld is the x-flip of facingAuthored, and three.js rotation.y = +H reproduces it', () => {
    for (const hDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const a = facingAuthored(hDeg);
      const w = facingWorld(hDeg);
      expect(w[0], `f(${hDeg}).x = -f_auth(${hDeg}).x`).toBeCloseTo(-a[0], 12);
      expect(w[1]).toBe(0);
      expect(w[2], 'z is verbatim — the conversion touches x only').toBeCloseTo(a[2], 12);

      // three.js applies rotation.y = beta as the right-handed R_y(beta):
      //   R_y(beta) * (0,0,-1) = (-sin beta, 0, -cos beta).
      // With beta = H*DEG that IS facingWorld(H) — which is WHY toWorldYawDeg is the IDENTITY on
      // headings and not a negation. §2.1's prose ("negates every authored yaw magnitude") is
      // about the authored ROTATION, which for heading H is -H; negating it gives +H.
      const beta = hDeg * WORLD_YAW_OF_HEADING_SIGN * DEG;
      expect(-Math.sin(beta)).toBeCloseTo(w[0], 12);
      expect(-Math.cos(beta)).toBeCloseTo(w[2], 12);
    }
    expect(WORLD_YAW_OF_HEADING_SIGN, 'toWorldYawDeg(headingDeg) === headingDeg').toBe(1);
    // At H = 90 the character faces world -X, which is assertion 2's whole point.
    expect(facingWorld(90)[0]).toBeCloseTo(-1, 12);
    expect(facingAuthored(90)[0]).toBeCloseTo(+1, 12);
  });
});

describe('§2.1 assertion 1 — at yoi, eye_L.x < 0 and eye_R.x > 0', () => {
  it('the WORLD frame conversion flips the authored eye offsets', async () => {
    const frame = await need('../../src/solve', 'toWorld', 'toWorldYawDeg');
    const toWorld = frame.toWorld as (v: readonly [number, number, number]) => [number, number, number];
    expect(toWorld(REST_OFFSET_BY_NAME.eye_L)[0]).toBeLessThan(0);
    expect(toWorld(REST_OFFSET_BY_NAME.eye_R)[0]).toBeGreaterThan(0);
  });

  it('the BUILT rig puts the left eye at negative world x at yoi', async () => {
    const render = await need('../../src/render', 'createMaterials');
    const rigMod = await need('../../src/rig', 'buildKarateka', 'sampleLandmarks');
    const buildKarateka = rigMod.buildKarateka as (m: unknown) => {
      root: { updateMatrixWorld(force: boolean): void };
      byName: Record<string, { getWorldPosition(t: { x: number; y: number; z: number }): { x: number } }>;
    };
    const rig = buildKarateka((render.createMaterials as () => unknown)());
    rig.root.updateMatrixWorld(true);
    const p = { x: 0, y: 0, z: 0 };
    expect(rig.byName.eye_L!.getWorldPosition({ ...p }).x).toBeLessThan(0);
    expect(rig.byName.eye_R!.getWorldPosition({ ...p }).x).toBeGreaterThan(0);
  });
});

describe('§2.1 assertion 2 — Taikyoku move 1, hidari gedan-barai, H = 90', () => {
  it('facing is world -X, left ankle leads by 0.540 H, LeftFistCenter.x < 0', async () => {
    const data = await need('../../src/data', 'STANCES');
    const solve = await need('../../src/solve', 'compileKata', 'toWorldYawDeg');
    const kata = await need('../../src/data', 'getKata');

    const k = (kata.getKata as (id: string) => { moves: { n: number; headingDeg: number }[] })(
      'taikyoku-shodan',
    );
    const move1 = k.moves.find((m) => m.n === 1)!;
    expect(move1.headingDeg, 'doc 02 §4.1 row 1: H = 90').toBe(90);

    // World facing: f(H) = (-sin H, 0, -cos H). At H = 90 that is (-1, 0, 0) = world -X.
    const worldYawDeg = (solve.toWorldYawDeg as (a: number) => number)(move1.headingDeg);
    const f: readonly [number, number, number] = [
      -Math.sin(move1.headingDeg * DEG),
      0,
      -Math.cos(move1.headingDeg * DEG),
    ];
    expect(f[0]).toBeCloseTo(-1, 12);
    expect(f[2]).toBeCloseTo(0, 12);
    expect(worldYawDeg).toBeCloseTo(90, 12);

    const track = (solve.compileKata as (kk: unknown, o: unknown) => {
      plants: { foot: 'L' | 'R'; worldPosXZ: readonly [number, number]; tickIn: number }[];
      marks: { kind: string; moveN: number; tick: number }[];
    })(k, { tempoTier: 'T1', codeVersion: 'test' });

    const kime = track.marks.find((m) => m.kind === 'kime' && m.moveN === 1)!;
    const plantAt = (foot: 'L' | 'R') =>
      track.plants
        .filter((p) => p.foot === foot && p.tickIn <= kime.tick)
        .sort((a, b) => b.tickIn - a.tickIn)[0]!.worldPosXZ;

    const [lx, lz] = plantAt('L');
    const [rx, rz] = plantAt('R');
    // Ankle-joint-centre separation ALONG the facing axis (§2.3: the embusen datum is the AJC).
    const along = (lx - rx) * f[0] + (lz - rz) * f[2];
    const stances = data.STANCES as Record<string, { S: { v: number } }>;
    expect(stances.zenkutsu!.S.v, 'doc 01 §3.1 ZENKUTSU.S').toBeCloseTo(0.54, 6);
    expect(along, 'the LEFT ankle is 0.540 H ahead of the right along the facing').toBeCloseTo(
      0.54 * H,
      3,
    );

    /* The fist assertion needs the pose actually applied to the rig, which is the full runtime
     * read path: sampler -> applyPose -> sampleLandmarks. */
    const render = await need('../../src/render', 'createMaterials');
    const rigMod = await need('../../src/rig', 'buildKarateka', 'sampleLandmarks');
    const player = await need('../../src/player', 'createSampler', 'applyPose');

    const rig = (rigMod.buildKarateka as (m: unknown) => unknown)(
      (render.createMaterials as () => unknown)(),
    );
    const source = (player.createSampler as (t: unknown) => {
      sample(tick: number, w: Record<string, number>, out: unknown): void;
    })(track);
    const frame = {
      q: new Float32Array(52 * 4),
      rootPos: new Float32Array(3),
      rootQuat: new Float32Array(4),
      chan: new Float32Array(14),
      scaleRibcage: new Float32Array(3),
    };
    source.sample(kime.tick, LAYER_WEIGHTS_DEFAULT, frame);
    (player.applyPose as (r: unknown, f: unknown) => void)(rig, frame);

    const landmarks = { pos: new Float32Array(CANONICAL_COUNT * 3) } as unknown as { pos: Float32Array };
    (rigMod.sampleLandmarks as (r: unknown, tick: number, out: unknown) => void)(
      rig,
      kime.tick,
      landmarks,
    );
    expect(
      landmarks.pos[CANONICAL_INDEX.LeftFistCenter * 3],
      'landmarks.LeftFistCenter.x < 0',
    ).toBeLessThan(0);
  });
});

describe('§3.4 — PRIMARY_AXIS is AUTHORED, so the twist axis needs toWorld too', () => {
  /**
   * The unguarded failure this catches: `PRIMARY_AXIS` carries no frame label in §3.4 and IS
   * authored (`AXIS_LEFT = [1,0,0]` is the character's left arm). The single §2.1 x-negation flips
   * the built rig's arm-chain bone directions, so of the 30 bones with children the 14 arm-chain
   * ones point at `dot = -1` against the raw table while all 16 spine/leg/foot ones point at `+1`.
   * doc 06 §3.2's `clampSwingTwist(q, a, ...)` needs `a` in the same frame as the bone-local `q`,
   * i.e. the BUILT rig's. Feeding it the raw table inverts the twist axis on every arm bone:
   * `TechniqueSpec.rollDeg` (+ = pronation, doc 03 §4.3) then rotates the fist the wrong way —
   * palm up at kime on every zuki — and `ROM.forearm`'s asymmetric +85/-88 clamp binds on
   * supination. §3.4.1's `JointStream` carries only `pos`, so metric 23 `fist_roll_deg` cannot see
   * it and metric 62 measures a radius, not a direction. This test is the only guard.
   */
  it('the raw table disagrees with the built rig on the arm chains and agrees on the rest', () => {
    const firstChild = (n: BoneName): BoneName | undefined =>
      BONE_ORDER.find((c) => BONE_PARENT_NAME[c] === n);
    /** Bones with a child whose first-child offset has a direction at all. */
    const measurable = BONE_ORDER.filter((n) => {
      const c = firstChild(n);
      return c !== undefined && Math.hypot(...REST_OFFSET_BY_NAME[c]) >= 1e-9;
    });
    const isArmChain = (n: BoneName) =>
      /_(?:L|R)$/.test(n) && !/^(?:thigh|calf|foot|ball|toe|eye)/.test(n);
    const armChain = measurable.filter(isArmChain);
    expect(measurable.length, 'bones with a directional first child').toBe(30);
    expect(armChain.length, 'the arm-chain bones are the ones the x-flip inverts').toBe(14);

    /** The one legal conversion, inlined here only because src/solve does not exist yet. */
    const flipX = (v: readonly [number, number, number]): [number, number, number] =>
      [SIDE_SIGN * v[0], v[1], v[2]];
    const dot = (a: readonly number[], b: readonly number[]) =>
      (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / Math.hypot(b[0]!, b[1]!, b[2]!);

    const mismatched: string[] = [];
    const agreed: BoneName[] = [];
    for (const n of measurable) {
      const authoredDir = REST_OFFSET_BY_NAME[firstChild(n)!];
      const authoredAxis = PRIMARY_AXIS_BY_NAME[n];
      const worldDir = flipX(authoredDir); // == the built rig's bone.position, / H

      // BOTH converted: a reflection preserves dot products, so the axis still points down the
      // bone. This is the invariant src/solve/swingTwist.ts preserves by converting the axis.
      expect(
        dot(flipX(authoredAxis), worldDir),
        `${n}: converted axis must point at its child`,
      ).toBeGreaterThan(0.85);

      // RAW authored axis against the BUILT rig's direction — the bug this test exists to catch.
      const raw = dot(authoredAxis, worldDir);
      if (raw > 0.85) agreed.push(n);
      else mismatched.push(`${n} (${raw.toFixed(3)})`);
    }
    expect(
      mismatched.length,
      `raw-axis mismatches: ${mismatched.join(', ')}`,
    ).toBe(armChain.length);
    expect(agreed.filter(isArmChain), 'no arm-chain bone may agree with the raw axis').toEqual([]);
    expect(agreed.length, 'every spine/leg/foot bone agrees — its axis has no x component').toBe(
      measurable.length - armChain.length,
    );
  });

  it('B3 must route PRIMARY_AXIS through toWorld: dot(toWorld(axis), child dir) > 0.85', async () => {
    const frame = await need('../../src/solve', 'toWorld');
    const toWorld = frame.toWorld as (v: readonly [number, number, number]) => [number, number, number];
    const bad: string[] = [];
    for (const n of BONE_ORDER) {
      const child = BONE_ORDER.find((c) => BONE_PARENT_NAME[c] === n);
      if (!child) continue;
      const o = toWorld(REST_OFFSET_BY_NAME[child]);
      const len = Math.hypot(o[0], o[1], o[2]);
      if (len < 1e-9) continue;
      const a = toWorld(PRIMARY_AXIS_BY_NAME[n as BoneName]);
      const d = (a[0] * o[0] + a[1] * o[1] + a[2] * o[2]) / len;
      if (!(d > 0.85)) bad.push(`${n}: dot = ${d.toFixed(3)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('§2.1 assertion 3 — the Heian σ orbit, and c(21)', () => {
  it('σ is doc 02 §3.2 verbatim: axis at x = -h, constants (-0.38, -4.00) (green from Phase 0)', () => {
    expect(EMB_POLYLINE_H_L, "doc 02 §1.1 h = w/2 = 0.19 L, AUTHORED (C18)").toBe(0.19);
    expect(EMB_SIGMA_X_CONST_L, 'σ reflects about x = -h, so the x constant is -2h').toBe(
      -2 * EMB_POLYLINE_H_L,
    );
    expect(EMB_SIGMA_Z_CONST_L, 'the z constant is the bbox depth').toBe(-4.0);
    // σ is an involution: applying it twice is the identity. That is what makes it a symmetry
    // rather than a coordinate convention.
    const [ax, az] = SIGMA(0.31, -1.5);
    expect(SIGMA(ax, az)[0]).toBeCloseTo(0.31, 12);
    expect(SIGMA(ax, az)[1]).toBeCloseTo(-1.5, 12);
  });

  it('c(21) = (-0.544, -0.354) L', async () => {
    const kata = await need('../../src/data', 'getKata');
    interface Mv {
      readonly n: number;
      readonly embusen: { readonly c: readonly [number, number] };
    }
    const k = (kata.getKata as (id: string) => { moves: readonly Mv[] })('heian-shodan');
    const m21 = k.moves.find((m) => m.n === 21)!;
    expect(m21.embusen.c[0], '§2.1: c = (-0.544, -0.354) L').toBeCloseTo(-0.544, 3);
    expect(m21.embusen.c[1]).toBeCloseTo(-0.354, 3);
  });

  it('σ(c_i) === c_(i+9) for i in {1,2,3}, and the pelvis form closes for 3 -> 12', async () => {
    const kata = await need('../../src/data', 'getKata');
    const emb = await need('../../src/data', 'PELVIS_AHEAD_OF_C_H', 'L_H');

    interface Mv {
      readonly n: number;
      readonly headingDeg: number;
      readonly stance: string;
      readonly embusen: { readonly c: readonly [number, number] };
    }
    const k = (kata.getKata as (id: string) => { moves: readonly Mv[] })('heian-shodan');
    const at = (n: number) => k.moves.find((m) => m.n === n)!;

    // doc 02 §3.2's own validation assertion, verbatim. NOT 12 -> 21: σ(c12) = (+0.310, 0.000),
    // which is c1/c3/c18/c20 — see the deviation note in this file's header.
    for (const i of [1, 2, 3] as const) {
      const src = at(i);
      const dst = at(i + 9);
      const [sx, sz] = SIGMA(src.embusen.c[0], src.embusen.c[1]);
      expect(sx, `σ(c${i}).x must equal c${i + 9}.x`).toBeCloseTo(dst.embusen.c[0], 6);
      expect(sz, `σ(c${i}).z must equal c${i + 9}.z`).toBeCloseTo(dst.embusen.c[1], 6);
    }

    // Metric 42 compares Hips against c + PELVIS_AHEAD_OF_C_H * f(H), not against c (§2.3).
    // 3 and 12 are both zenkutsu with headings 270° and 90° — exactly 180° apart — so the same
    // +0.049 H offset maps correctly through the point reflection and the identity is EXACT.
    const ahead = emb.PELVIS_AHEAD_OF_C_H as Record<string, number>;
    const lh = emb.L_H as number;
    const pelvisXZ = (m: Mv): readonly [number, number] => {
      const a = (ahead[m.stance] ?? 0) / lh; // FracH -> units of L
      return [
        m.embusen.c[0] + a * Math.sin(m.headingDeg * DEG),
        m.embusen.c[1] - a * Math.cos(m.headingDeg * DEG),
      ];
    };
    for (const [i, j] of [[3, 12], [1, 10], [2, 11]] as const) {
      expect(at(i).stance, `move ${i} must be zenkutsu for the σ pelvis form`).toBe('zenkutsu');
      expect(at(j).stance).toBe('zenkutsu');
      expect(Math.abs(((at(i).headingDeg - at(j).headingDeg) % 360) + 360) % 360).toBe(180);
      const [px, pz] = SIGMA(...(pelvisXZ(at(i)) as [number, number]));
      const q = pelvisXZ(at(j));
      expect(px, `pelvis XZ of move ${j} is the σ-image of move ${i}`).toBeCloseTo(q[0], 9);
      expect(pz).toBeCloseTo(q[1], 9);
    }
  });

  it('moves 18-21 lie OUTSIDE the σ orbit; move 21 mirrors move 19 about x = +0.31', async () => {
    const kata = await need('../../src/data', 'getKata');
    interface Mv {
      readonly n: number;
      readonly embusen: { readonly c: readonly [number, number] };
    }
    const k = (kata.getKata as (id: string) => { moves: readonly Mv[] })('heian-shodan');
    const c = (n: number) => k.moves.find((m) => m.n === n)!.embusen.c;

    // σ(c21) = (+0.164, -3.646) matches no c in the kata: the kokutsu tail on the two diagonal
    // spurs of doc 02 §3.2 has no σ counterpart. Pinning that is what stops a later agent from
    // "fixing" the arithmetic by moving move 21's embusen and deleting the NE spur — which would
    // break doc 02 §6.3's exact naore closure (L foot travels 1.30 L from (-0.897, -0.707)).
    const [sx, sz] = SIGMA(c(21)[0], c(21)[1]);
    for (const m of k.moves) {
      expect(
        Math.hypot(m.embusen.c[0] - sx, m.embusen.c[1] - sz),
        `σ(c21) must not coincide with c${m.n}`,
      ).toBeGreaterThan(0.05);
    }

    // The symmetry move 21 DOES have: the x-mirror of move 19 about the move-20 stance centre.
    const axis = c(20)[0];
    expect(axis, 'c(20) sits on the bottom bar centre x = +0.31').toBeCloseTo(0.31, 3);
    expect(2 * axis - c(19)[0], 'c(21).x = 2*0.31 - c(19).x').toBeCloseTo(c(21)[0], 3);
    expect(c(19)[1], 'both spur tips share z = -0.354').toBeCloseTo(c(21)[1], 3);
  });
});
