/**
 * tests/contracts/bones.test.ts — the 52-bone identity table.
 *
 * RED-FIRST (ARCHITECTURE.md §4.0, §8 Phase 0). The table-level assertions below hold from Phase 0;
 * the one that matters most does not, because it is about the BUILT rig: §3.4 says "this array
 * order IS the skinIndex order", and nothing proves that until `buildKarateka` exists. Everything
 * on disk — every baked `PoseTrack.q`, every cloth snapshot, every diagnostics row — is indexed by
 * `BONE_ORDER`, so a rig that builds its bones in a different order corrupts all of it silently.
 *
 * §4.0 names the assertions: BONE_COUNT === 52, parents precede children, every `_L` has an `_R`
 * twin, and the six chain-closure lengths of doc 06 §4.2 to 1e-6 H.
 */

import { describe, expect, it } from 'vitest';
import {
  BONE_COUNT,
  BONE_INDEX,
  BONE_ORDER,
  BONE_PARENT,
  BONE_PARENT_NAME,
  boneIndex,
  CHAIN_CLOSURE_H,
  DEG,
  HEEL_BEHIND_ANKLE_DOC01_H,
  HEEL_BEHIND_ANKLE_DOC06_H,
  HEEL_OFFSET_H,
  LAYER_ORDER,
  LAYER_WRITABLE,
  NON_SCALING_BONE_COUNT,
  PRIMARY_AXIS,
  PRIMARY_AXIS_FRAME,
  REST_OFFSET_BY_NAME,
  REST_OFFSET_H,
  SCALABLE_BONE,
  TOE_TIP_OFFSET_H,
  ZENKUTSU_HEEL_TO_HEEL_REF_H,
  type BoneName,
} from '../../src/contracts';

async function need(modulePath: string, ...symbols: readonly string[]): Promise<Record<string, unknown>> {
  const spec: string = modulePath;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (e) {
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

const off = (n: BoneName): readonly [number, number, number] => REST_OFFSET_BY_NAME[n];
const len = (v: readonly [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

describe('§2.8 / §3.4 — the count', () => {
  it('BONE_COUNT === BONE_ORDER.length === 52', () => {
    expect(BONE_ORDER.length).toBe(52);
    expect(BONE_COUNT).toBe(52);
    expect(BONE_COUNT).toBe(BONE_ORDER.length);
  });

  it('reconciles doc 06 §4.2: 44 headline + 7 leaf terminators + ribcage = 52', () => {
    const leafTerminators: BoneName[] = [
      'head_end', 'fingers_end_L', 'fingers_end_R', 'thumb_end_L', 'thumb_end_R',
      'toe_end_L', 'toe_end_R',
    ];
    expect(leafTerminators).toHaveLength(7);
    for (const n of leafTerminators) expect(BONE_ORDER).toContain(n);
    expect(BONE_ORDER).toContain('ribcage');
    expect(44 + 7 + 1).toBe(BONE_COUNT);
  });

  it('has no duplicate names, and boneIndex round-trips every one', () => {
    expect(new Set(BONE_ORDER).size).toBe(BONE_COUNT);
    for (let i = 0; i < BONE_COUNT; i++) {
      expect(boneIndex(BONE_ORDER[i]!)).toBe(i);
      expect(BONE_INDEX[BONE_ORDER[i]!]).toBe(i);
    }
  });
});

describe('§3.4 — parents always precede children (FK is a single forward pass)', () => {
  it('BONE_PARENT[i] < i for every bone, and -1 exactly once', () => {
    const roots: string[] = [];
    for (let i = 0; i < BONE_COUNT; i++) {
      const p = BONE_PARENT[i]!;
      if (p === -1) roots.push(BONE_ORDER[i]!);
      else expect(p, `${BONE_ORDER[i]} parent index`).toBeLessThan(i);
    }
    expect(roots).toEqual(['root']);
  });

  it('BONE_PARENT agrees with BONE_PARENT_NAME for every bone', () => {
    for (let i = 0; i < BONE_COUNT; i++) {
      const name = BONE_ORDER[i]!;
      const pn = BONE_PARENT_NAME[name];
      expect(BONE_PARENT[i]).toBe(pn === null ? -1 : boneIndex(pn));
    }
  });

  it('every bone reaches root by walking parents (no orphan, no cycle)', () => {
    for (let i = 0; i < BONE_COUNT; i++) {
      let cur = i;
      let steps = 0;
      while (BONE_PARENT[cur] !== -1) {
        cur = BONE_PARENT[cur]!;
        expect(++steps).toBeLessThan(BONE_COUNT);
      }
      expect(BONE_ORDER[cur]).toBe('root');
    }
  });
});

describe('§4.0 — every _L name has an _R twin', () => {
  it('the name sets mirror exactly', () => {
    const lefts = BONE_ORDER.filter((n) => n.endsWith('_L'));
    const rights = BONE_ORDER.filter((n) => n.endsWith('_R'));
    expect(lefts).toHaveLength(rights.length);
    // 21 mirrored pairs + 10 unmirrored (root, pelvis, spine_01..03, chest, ribcage, neck_01,
    // head, head_end) = 52.
    expect(lefts).toHaveLength(21);
    expect(21 * 2 + BONE_ORDER.filter((n) => !/_[LR]$/.test(n)).length).toBe(BONE_COUNT);
    for (const l of lefts) expect(BONE_ORDER).toContain(`${l.slice(0, -2)}_R` as BoneName);
    for (const r of rights) expect(BONE_ORDER).toContain(`${r.slice(0, -2)}_L` as BoneName);
  });

  it('twin rest offsets mirror x exactly and share y, z (doc 06 §4.2 "Right side = mirror x")', () => {
    for (const l of BONE_ORDER.filter((n) => n.endsWith('_L'))) {
      const r = `${l.slice(0, -2)}_R` as BoneName;
      const a = off(l);
      const b = off(r);
      // a[0] + b[0] === 0 rather than a[0] === -b[0]: the latter distinguishes +0 from -0, which
      // is not a real difference for a bone on the mid-sagittal plane.
      expect(a[0] + b[0], `${l}/${r} x must mirror`).toBe(0);
      expect(Math.abs(a[0]), `${l}/${r} |x|`).toBe(Math.abs(b[0]));
      expect(a[1], `${l}/${r} y`).toBe(b[1]);
      expect(a[2], `${l}/${r} z`).toBe(b[2]);
    }
  });

  it('twin parents are twins', () => {
    for (const l of BONE_ORDER.filter((n) => n.endsWith('_L'))) {
      const r = `${l.slice(0, -2)}_R` as BoneName;
      const pl = BONE_PARENT_NAME[l]!;
      const pr = BONE_PARENT_NAME[r]!;
      const expected = pl.endsWith('_L') ? `${pl.slice(0, -2)}_R` : pl;
      expect(pr).toBe(expected);
    }
  });
});

describe('doc 06 §4.2 — the six chain-closure lengths', () => {
  it('rows 1-5 close to 1e-6 H', () => {
    expect(len(off('lowerarm_L'))).toBeCloseTo(CHAIN_CLOSURE_H.upperarmToLowerarm, 6);
    expect(len(off('hand_L'))).toBeCloseTo(CHAIN_CLOSURE_H.lowerarmToHand, 6);
    expect(
      len(off('fingers_prox_L')) + len(off('fingers_dist_L')) + len(off('fingers_end_L')),
    ).toBeCloseTo(CHAIN_CLOSURE_H.handToFingersEnd, 6);
    expect(len(off('calf_L'))).toBeCloseTo(CHAIN_CLOSURE_H.thighToCalf, 6);
    expect(len(off('foot_L'))).toBeCloseTo(CHAIN_CLOSURE_H.calfToFoot, 6);
    // de Leva 1996 T4, via doc 06 §1.1: hand -> fingers_end IS len.hand_full = 0.1091 (rounded to
    // 0.1090 by the three-bone split), which is the closure doc 06 §4.2 ticks off.
    expect(CHAIN_CLOSURE_H.handToFingersEnd).toBeCloseTo(0.109, 6);
  });

  it('row 6, heel -> toe_end, is hypot(0.0010, 0.1505) = 0.150503', () => {
    const ball = off('ball_L');
    const toe = off('toe_end_L');
    const toeRelFoot = [ball[0] + toe[0], ball[1] + toe[1], ball[2] + toe[2]] as const;
    const d = Math.hypot(
      HEEL_OFFSET_H[0] - toeRelFoot[0],
      HEEL_OFFSET_H[1] - toeRelFoot[1],
      HEEL_OFFSET_H[2] - toeRelFoot[2],
    );
    expect(d).toBeCloseTo(0.15050332, 8);
    // doc 06 §4.2 prints 0.1505 (4 dp) and cross-checks it against D&C len.foot = 0.152, so this
    // row is asserted to the doc's own precision, not to 1e-6.
    expect(Math.abs(d - CHAIN_CLOSURE_H.heelToToeEnd)).toBeLessThan(5e-5);
    expect(Math.abs(d - 0.152)).toBeLessThan(0.002);
  });

  it('the auxiliary landmark offsets are doc 06 §4.2 verbatim', () => {
    expect([...HEEL_OFFSET_H]).toEqual([0, -0.03, 0.0415]);
    expect([...TOE_TIP_OFFSET_H]).toEqual([...off('toe_end_L')]);
  });

  /**
   * C15. `HEEL_OFFSET_H[2] = 0.0415` is doc 06's RIG landmark and is NOT the `HEEL_BEHIND` term of
   * §2.3's derivation of `ZENKUTSU_HEEL_TO_HEEL_H`. Substituting it there overshoots 0.533 by
   * 1.50e-3 — 3x B1's ±5e-4 gate — so B1 would fail `tests/data/derived.test.ts` and the tempting
   * "fix" would be to relax that gate or re-derive 0.5345, silently moving metric 1's shipped
   * reference: §2.6 override #1 and the single most-quoted number in the scorecard.
   */
  it('C15: metric 1 derives from doc 01 0.052, not from doc 06 0.0415', () => {
    const heelToHeel = (heelBehindH: number) =>
      0.54 - heelBehindH * Math.cos(3 * DEG) + heelBehindH * Math.cos(30 * DEG);
    expect(HEEL_BEHIND_ANKLE_DOC01_H, 'doc 01 §1 [DERIVED: 0.34*FOOT_LEN]').toBe(0.052);
    expect(HEEL_BEHIND_ANKLE_DOC06_H, 'doc 06 §4.2 rig heel landmark').toBe(0.0415);
    expect(HEEL_BEHIND_ANKLE_DOC06_H).toBe(HEEL_OFFSET_H[2]);

    expect(heelToHeel(HEEL_BEHIND_ANKLE_DOC01_H)).toBeCloseTo(0.533105, 6);
    expect(
      Math.abs(heelToHeel(HEEL_BEHIND_ANKLE_DOC01_H) - ZENKUTSU_HEEL_TO_HEEL_REF_H),
      'doc 01 0.052 is INSIDE B1’s +-5e-4 gate',
    ).toBeLessThan(5e-4);
    expect(heelToHeel(HEEL_BEHIND_ANKLE_DOC06_H)).toBeCloseTo(0.534497, 6);
    expect(
      Math.abs(heelToHeel(HEEL_BEHIND_ANKLE_DOC06_H) - ZENKUTSU_HEEL_TO_HEEL_REF_H),
      'doc 06 0.0415 is OUTSIDE it — 3x the tolerance',
    ).toBeGreaterThan(5e-4);

    // The two documents split different feet, which is the root of the disagreement.
    expect(CHAIN_CLOSURE_H.handToFingersEnd).toBeCloseTo(0.109, 6); // doc 06 toe-ahead sibling
    expect(0.109 + HEEL_BEHIND_ANKLE_DOC06_H, 'doc 06 foot = 0.1505 H').toBeCloseTo(0.1505, 6);
    expect(0.1 + HEEL_BEHIND_ANKLE_DOC01_H, 'doc 01 FOOT_LEN = 0.152 H').toBeCloseTo(0.152, 6);
  });

  it('REST_OFFSET_H and REST_OFFSET_BY_NAME are the same data', () => {
    expect(REST_OFFSET_H.length).toBe(BONE_COUNT * 3);
    for (let i = 0; i < BONE_COUNT; i++) {
      const n = BONE_ORDER[i]!;
      expect(REST_OFFSET_H[i * 3 + 0]).toBe(off(n)[0]);
      expect(REST_OFFSET_H[i * 3 + 1]).toBe(off(n)[1]);
      expect(REST_OFFSET_H[i * 3 + 2]).toBe(off(n)[2]);
    }
  });

  it('pelvis sits at 0.5308 H and the whole tree is in AUTHORED T-pose space', () => {
    expect(off('pelvis')[1]).toBe(0.5308);
    expect(off('root')).toEqual([0, 0, 0]);
    // AUTHORED frame: docs 01/02/03/04/06 label +X as the character's LEFT, so every _L bone
    // carries +x here and src/solve/frame.ts is the only place that flips it (§2.1).
    expect(off('upperarm_L')[0]).toBeGreaterThan(0);
    expect(off('upperarm_R')[0]).toBeLessThan(0);
  });
});

describe('§2.8 — ribcage is the only bone that may scale, and it is childless', () => {
  it('nothing is parented to ribcage', () => {
    const ri = boneIndex('ribcage');
    const children = BONE_ORDER.filter((_, i) => BONE_PARENT[i] === ri);
    expect(children, 'ribcage must stay a LEAF, forever').toEqual([]);
    expect(Object.entries(BONE_PARENT_NAME).filter(([, p]) => p === 'ribcage')).toEqual([]);
  });

  it('ribcage is a child of chest at (0, +0.0350, -0.0040)', () => {
    expect(BONE_PARENT_NAME.ribcage).toBe('chest');
    expect([...off('ribcage')]).toEqual([0, 0.035, -0.004]);
  });

  it('SCALABLE_BONE is ribcage; metric 59 covers the other 51', () => {
    expect(SCALABLE_BONE).toBe('ribcage');
    expect(NON_SCALING_BONE_COUNT).toBe(BONE_COUNT - 1);
    expect(NON_SCALING_BONE_COUNT).toBe(51);
  });

  it('only the breath layer writes ribcage', () => {
    const ri = boneIndex('ribcage');
    for (const id of LAYER_ORDER) {
      if (id === 'breath' || id === 'patch') continue;
      expect(LAYER_WRITABLE[id], `layer ${id} must not write ribcage`).not.toContain(ri);
    }
    expect(LAYER_WRITABLE.breath).toEqual([ri]);
  });
});

describe('§3.4 — PRIMARY_AXIS and LAYER_WRITABLE', () => {
  it('every primary axis is a unit vector', () => {
    for (let i = 0; i < BONE_COUNT; i++) {
      const m = Math.hypot(PRIMARY_AXIS[i * 3]!, PRIMARY_AXIS[i * 3 + 1]!, PRIMARY_AXIS[i * 3 + 2]!);
      expect(m, `${BONE_ORDER[i]} primary axis`).toBeCloseTo(1, 12);
    }
  });

  /**
   * These are AUTHORED-frame axes, in the same T-pose generation space as `REST_OFFSET_H`. 57 lines
   * below, the BUILT rig's positions are asserted x-NEGATED — so "positions flip, axes don't" is
   * exactly the wrong reading, and the guard against it is
   * `tests/contracts/handedness.test.ts` ("PRIMARY_AXIS is AUTHORED, so the twist axis needs
   * toWorld too"), which measures the dot product against every child direction.
   */
  it('doc 06 §0: arm chains +/-X, leg chains -Y, spine/neck +Y — in the AUTHORED frame', () => {
    expect(PRIMARY_AXIS_FRAME, 'the frame label §3.4 omitted').toBe('AUTHORED_T_POSE');
    const ax = (n: BoneName) => {
      const i = boneIndex(n);
      return [PRIMARY_AXIS[i * 3], PRIMARY_AXIS[i * 3 + 1], PRIMARY_AXIS[i * 3 + 2]];
    };
    expect(ax('lowerarm_L')).toEqual([1, 0, 0]);
    expect(ax('lowerarm_R')).toEqual([-1, 0, 0]);
    expect(ax('calf_L')).toEqual([0, -1, 0]);
    expect(ax('chest')).toEqual([0, 1, 0]);
    expect(ax('foot_L')).toEqual([0, 0, -1]);
    // The authored axis and the authored child offset agree in sign on BOTH arms, which is what
    // makes the single x-negation flip them together rather than one of them.
    expect(Math.sign(ax('lowerarm_L')[0]!)).toBe(Math.sign(off('hand_L')[0]));
    expect(Math.sign(ax('lowerarm_R')[0]!)).toBe(Math.sign(off('hand_R')[0]));
  });

  it('every LAYER_WRITABLE entry is sorted ascending and in range', () => {
    for (const id of LAYER_ORDER) {
      const list = LAYER_WRITABLE[id];
      expect(list.length, `layer ${id} must write at least one bone`).toBeGreaterThan(0);
      for (let i = 0; i < list.length; i++) {
        expect(list[i]).toBeGreaterThanOrEqual(0);
        expect(list[i]).toBeLessThan(BONE_COUNT);
        if (i > 0) expect(list[i]!, `layer ${id} sorted`).toBeGreaterThan(list[i - 1]!);
      }
    }
    expect(LAYER_WRITABLE.patch).toHaveLength(BONE_COUNT);
  });

  it('gaze writes exactly doc 06 §6.5\'s chain: chest, neck_01, head, eye_L, eye_R', () => {
    expect(LAYER_WRITABLE.gaze.map((i) => BONE_ORDER[i]).sort()).toEqual(
      ['chest', 'eye_L', 'eye_R', 'head', 'neck_01'],
    );
  });

  it('koshi writes exactly the doc 06 §6.4 L1+L2 chain: pelvis + 4 spine bones', () => {
    expect(LAYER_WRITABLE.koshi.map((i) => BONE_ORDER[i]).sort()).toEqual(
      ['chest', 'pelvis', 'spine_01', 'spine_02', 'spine_03'],
    );
  });
});

describe('§3.4 — BONE_ORDER *is* the skinIndex order of the built rig', () => {
  it('the built skeleton has the 52 bones in BONE_ORDER order with matching rest offsets', async () => {
    const render = await need('../../src/render', 'createMaterials');
    const rigMod = await need('../../src/rig', 'buildKarateka');

    interface Bone3 {
      readonly name: string;
      readonly position: { x: number; y: number; z: number };
      readonly parent: { name: string } | null;
      readonly children: readonly { name: string }[];
    }
    const rig = (rigMod.buildKarateka as (m: unknown) => {
      bones: readonly Bone3[];
      byName: Record<string, Bone3>;
      skeleton: { bones: readonly Bone3[] };
    })((render.createMaterials as () => unknown)());

    expect(rig.bones.map((b) => b.name)).toEqual([...BONE_ORDER]);
    expect(rig.skeleton.bones.map((b) => b.name)).toEqual([...BONE_ORDER]);

    // Rest offsets, in WORLD/three space: x is negated exactly once (§2.1), y and z are verbatim.
    for (const n of BONE_ORDER) {
      const b = rig.byName[n]!;
      const o = off(n);
      expect(b.position.x, `${n}.position.x`).toBeCloseTo(-o[0] * 1.75, 9);
      expect(b.position.y, `${n}.position.y`).toBeCloseTo(o[1] * 1.75, 9);
      expect(b.position.z, `${n}.position.z`).toBeCloseTo(o[2] * 1.75, 9);
    }

    expect(rig.byName.ribcage!.children, 'ribcage must be childless in the built rig too').toEqual([]);
    for (const n of BONE_ORDER) {
      const expected = BONE_PARENT_NAME[n];
      if (expected === null) continue;
      expect(rig.byName[n]!.parent?.name, `${n} parent`).toBe(expected);
    }
  });
});
