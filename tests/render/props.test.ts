/**
 * tests/render/props.test.ts — the dojo furniture's PLACEMENT, checked without a GL context.
 *
 * `buildDojoProps` needs a DOM (it draws a `CanvasTexture` atlas) and is therefore untestable here,
 * exactly as `buildStage` is. What IS testable is the thing that actually matters and the thing a
 * later edit is most likely to break silently:
 *
 *   **no prop may stand in the embusen.**
 *
 * `STAGE_AABB_M` is 4.68 m about `(0, STAGE_CENTRE_Z_M)` and the karateka works that whole square —
 * the 0.45 m limb envelope per side is already inside it (`stage.ts`, conflict C13). A prop that
 * intersects it does not look wrong from most angles; it looks wrong for four frames at move 12 of
 * one kata, which is precisely the class of defect a render never catches and a test always does.
 *
 * `props.ts` also asserts this at BUILD time over every vertex it emits, which is stricter than the
 * footprint check below — a rotated board's true extent is smaller than its axis-aligned box. The
 * two are deliberately not the same check: this one runs in CI on every commit and fails with the
 * offending prop's NAME, the runtime one runs in the browser and fails with a coordinate. Losing
 * either would leave a hand-authored layout with no guard rail at all.
 */

import { describe, expect, it } from 'vitest';

import { STAGE_AABB_M } from '../../src/contracts';
import { PROP_KEEP_CLEAR, PROP_PLAN, ROOM_HALF_M, propFootprints } from '../../src/render';

/** `[minX, maxX, minZ, maxZ]` overlap test, open intervals — touching is legal, crossing is not. */
const overlaps = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean => a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2];

describe('props — the embusen keep-clear box', () => {
  it('is the stage AABB grown by a real, non-zero margin', () => {
    const [x0, x1, z0, z1] = PROP_KEEP_CLEAR;
    expect(x1 - x0).toBeGreaterThan(STAGE_AABB_M);
    expect(z1 - z0).toBeGreaterThan(STAGE_AABB_M);
    // Symmetric in x about the embusen origin; offset in z, because the embusen is.
    expect(x0 + x1).toBeCloseTo(0, 6);
    expect(z0 + z1).toBeLessThan(0);
  });

  it('contains no prop footprint', () => {
    const hits = propFootprints()
      .filter((p) => overlaps(p.box, PROP_KEEP_CLEAR))
      .map((p) => `${p.id} @ [${p.box.map((v) => v.toFixed(2)).join(', ')}]`);
    expect(
      hits,
      'a prop is standing in the embusen — the karateka travels that whole 4.68 m square',
    ).toEqual([]);
  });

  it('would catch a prop that was moved into it (the detector detects)', () => {
    // Same shape as the real check, run against a fabricated prop on the embusen centreline.
    const fake = { id: 'bench-in-the-way', box: [-0.5, 0.5, -2.5, -1.5] as const };
    expect(overlaps(fake.box, PROP_KEEP_CLEAR)).toBe(true);
  });
});

describe('props — everything is inside the hall', () => {
  it('no footprint crosses a wall', () => {
    const outside = propFootprints()
      .filter((p) => p.box.some((v) => Math.abs(v) > ROOM_HALF_M + 0.001))
      .map((p) => p.id);
    expect(outside, `props must stand inside the ${2 * ROOM_HALF_M} m hall`).toEqual([]);
  });

  it('no two props occupy the same floor', () => {
    // The getabako and the makiwara share the shimoza wall and the two bench runs share their
    // pitch; an overlap here means a prop was moved by hand into another one.
    const f = propFootprints().filter((p) => !/^(kun|flag|kanban|clock)$/.test(p.id));
    const clashes: string[] = [];
    for (let i = 0; i < f.length; i++) {
      for (let j = i + 1; j < f.length; j++) {
        if (overlaps(f[i]!.box, f[j]!.box)) clashes.push(`${f[i]!.id} vs ${f[j]!.id}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('props — the plan is a Shotokan dojo and not a generic one', () => {
  it('puts the training aids on the shimoza, never on the shomen', () => {
    // Shomen is `-Z`. A makiwara at negative z would be equipment on the kamiza wall, which is the
    // one placement every source in the research agrees is wrong.
    expect(PROP_PLAN.makiwara.zM).toBeGreaterThan(0);
    expect(PROP_PLAN.getabako.zM).toBeGreaterThan(0);
    expect(PROP_PLAN.clock.xM).toBeDefined();
  });

  it('gives the makiwara a real makiwara profile', () => {
    const M = PROP_PLAN.makiwara;
    // Tapered in THICKNESS only: the post bends along one axis, which is the whole object.
    expect(M.postT1M).toBeLessThan(M.postT0M / 3);
    expect(M.postT0M).toBeCloseTo(M.postWM, 3);
    // Shureido's shipping unit is 1.4 m overall with the pad centred at the solar plexus.
    expect(M.topYM).toBeCloseTo(1.4, 2);
    expect(M.padYM).toBeGreaterThan(1.1);
    expect(M.padYM).toBeLessThan(M.topYM);
  });

  it('gives the getabako cubbies an adult shoe fits in', () => {
    const G = PROP_PLAN.getabako;
    const innerW = G.sizeM[0] - 0.05 - (G.cols - 1) * 0.018;
    // Japanese school shoe-box standard: 222 mm wide, 330-350 mm deep.
    expect(innerW / G.cols).toBeGreaterThan(0.2);
    expect(G.sizeM[2]).toBeGreaterThanOrEqual(0.33);
  });

  it('seats visitors on both side walls, unevenly', () => {
    const runs = PROP_PLAN.bench.runs;
    expect(runs).toHaveLength(2);
    expect(Math.sign(runs[0]!.xM)).not.toBe(Math.sign(runs[1]!.xM));
    // Uneven on purpose — a room whose furniture mirrors reads as a set, not as a room.
    expect(runs[0]!.zM.length).not.toBe(runs[1]!.zM.length);
  });
});
