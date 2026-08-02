/**
 * B6 PLAYER — the pure core of `src/player/footIk`.
 *
 * Imports the module DIRECTLY rather than through the block barrel, for the same reason
 * `choreography.test.ts` does: the barrel pulls `./character`, which pulls `GLTFLoader`. This file's
 * subject imports nothing from three but `Matrix4`, `Quaternion` and `Vector3` — pure math, Node
 * safe — because its dependency on `Character` is `import type`, and type imports are erased.
 *
 * ═══ WHAT IS AND IS NOT COVERED ══════════════════════════════════════════════════════════════
 *
 * `createFootIk` needs a skinned GLB with a Rigify skeleton and cannot run here at all. That is why
 * the three decisions worth being sure about were factored OUT of it and are tested here instead:
 *
 *   `solveTwoBone`   — does the ankle land on the target, and does the knee survive it
 *   `clampToReach`   — what gets sacrificed when the target is further than the leg is long
 *   `stepLatch`      — hysteresis that cannot chatter
 *   `groundAnchor`   — the invariant the whole no-hyperextension argument rests on
 *
 * Numbers throughout are this project's actual rig, measured off the Rigify bind pose: a 0.4003 m
 * thigh and a 0.4295 m shin on a 1.829 m character, with the ankle joint centre 0.1037 m above the
 * sole. Testing against a synthetic 1-1 chain would pass while hiding exactly the near-straight-leg
 * behaviour that matters, because this rig's bind leg stands 99.93 % extended.
 */

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';

import {
  clampToReach,
  createLatch,
  createTwoBoneOut,
  groundAnchor,
  solveTwoBone,
  stepLatch,
} from '../../src/player/footIk';

/* ── the rig, as measured ─────────────────────────────────────────────────────────────────── */

const HIP = new Vector3(0.089, 0.9321, 0.0014);
const KNEE = new Vector3(0.089, 0.5318, -0.0014);
const ANKLE = new Vector3(0.089, 0.1037, -0.0358);
const L1 = HIP.distanceTo(KNEE); // 0.4003
const L2 = KNEE.distanceTo(ANKLE); // 0.4295
const SPAN = L1 + L2; // 0.8298

/**
 * A BENT stance leg, which is the pose the solver actually meets.
 *
 * The bind leg above stands 99.93 % extended — 0.8292 m of a possible 0.8298 — so from THAT pose
 * almost every correction that moves the ankle down or sideways is out of reach, and a "does it
 * reach the target" suite written against it would be testing the clamp instead of the solve. Over
 * `heian-nidan` the knee measures 131° mean and 50° minimum; folding the shin 60° about the bend
 * axis puts this chain at 124°, right by that mean, with 92 mm of extension still in hand.
 */
const BENT_ANKLE = KNEE.clone().add(
  new Vector3()
    .subVectors(ANKLE, KNEE)
    .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(-1, 0, 0), Math.PI / 3)),
);

/**
 * Forward-kinematic the solved chain the way the scene graph will.
 *
 * The bone OFFSETS are fixed — `knee` sits at a constant vector in the thigh's frame and `ankle` at
 * a constant vector in the shin's — so re-deriving the joint positions from the two returned world
 * rotations is exactly what `updateMatrixWorld` does, and is therefore a real check on the solve
 * rather than a restatement of it.
 */
function fk(
  hip: Vector3,
  knee0: Vector3,
  ankle0: Vector3,
  hipQ0: Quaternion,
  kneeQ0: Quaternion,
  hipQ1: Quaternion,
  kneeQ1: Quaternion,
): { knee: Vector3; ankle: Vector3 } {
  const kneeLocal = new Vector3().subVectors(knee0, hip).applyQuaternion(hipQ0.clone().invert());
  const ankleLocal = new Vector3().subVectors(ankle0, knee0).applyQuaternion(kneeQ0.clone().invert());
  const knee = hip.clone().add(kneeLocal.clone().applyQuaternion(hipQ1));
  const ankle = knee.clone().add(ankleLocal.clone().applyQuaternion(kneeQ1));
  return { knee, ankle };
}

/** Interior knee angle in degrees. 180 is a locked-straight leg; past it the knee has inverted. */
const kneeDeg = (hip: Vector3, knee: Vector3, ankle: Vector3): number =>
  (new Vector3().subVectors(hip, knee).angleTo(new Vector3().subVectors(ankle, knee)) * 180) /
  Math.PI;

/** Signed side of the hip->ankle line the knee bulges toward, projected on a reference normal. */
const bendSide = (hip: Vector3, knee: Vector3, ankle: Vector3, ref: Vector3): number =>
  new Vector3()
    .subVectors(ankle, hip)
    .cross(new Vector3().subVectors(knee, hip))
    .dot(ref);

const POLE = new Vector3(-1, 0, 0);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * solveTwoBone
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('solveTwoBone — the ankle goes where it is told', () => {
  /* The load-bearing one. Everything else the module does is bookkeeping around this. */
  const reachable: readonly [string, Vector3][] = [
    ['straight up 50 mm — the sink correction', new Vector3(0, 0.05, 0)],
    ['straight up 207 mm — the deepest sink measured on heian-nidan', new Vector3(0, 0.207, 0)],
    ['down 55 mm — the float correction', new Vector3(0, -0.055, 0)],
    ['sideways 80 mm — an XZ latch holding against a moving body', new Vector3(0.08, 0, 0)],
    ['forward 120 mm at the drift limit', new Vector3(0, 0.02, 0.12)],
    ['up and back, a deep stance settling', new Vector3(0, 0.15, -0.09)],
  ];

  for (const [label, delta] of reachable) {
    it(`${label}`, () => {
      const target = BENT_ANKLE.clone().add(delta);
      /* Guard, not decoration: if a future edit to `BENT_ANKLE` pushed one of these outside the
       * chain's span, the case would silently become a clamp test wearing a reach test's name. */
      expect(HIP.distanceTo(target)).toBeLessThan(SPAN * 0.995);

      const out = createTwoBoneOut();
      const hipQ0 = new Quaternion();
      const kneeQ0 = new Quaternion();
      solveTwoBone(HIP, KNEE, BENT_ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);

      const got = fk(HIP, KNEE, BENT_ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
      expect(got.ankle.distanceTo(target)).toBeLessThan(1e-6);
      expect(out.clamped).toBe(false);
      /* The segment lengths are a rotation-only solve's one non-negotiable: any drift here means
       * the answer stretched the leg rather than bending it. */
      expect(HIP.distanceTo(got.knee)).toBeCloseTo(L1, 9);
      expect(got.knee.distanceTo(got.ankle)).toBeCloseTo(L2, 9);
    });
  }

  it('works from a rotated pose — nothing assumes an identity bind', () => {
    /* Rigify keeps Blender's bone-local axes and this rig's pelvis "up" is local +Z, so a solver
     * that quietly assumed the bone frames were world frames would still pass every test above.
     * Feeding it arbitrary world rotations for the same joint POSITIONS is what catches that. */
    const hipQ0 = new Quaternion().setFromAxisAngle(new Vector3(0.3, 0.8, 0.5).normalize(), 1.1);
    const kneeQ0 = new Quaternion().setFromAxisAngle(new Vector3(-0.6, 0.2, 0.7).normalize(), -2.2);
    const target = BENT_ANKLE.clone().add(new Vector3(0.03, 0.09, -0.04));
    const out = createTwoBoneOut();
    solveTwoBone(HIP, KNEE, BENT_ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);
    const got = fk(HIP, KNEE, BENT_ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
    expect(got.ankle.distanceTo(target)).toBeLessThan(1e-6);
  });

  it('leaves an already-correct pose alone, even on the near-straight bind leg', () => {
    /* A no-op request must be a no-op ANSWER. The bind leg stands 99.93 % extended, so a solver
     * that applied its 0.995 ceiling unconditionally would shorten it by 4 mm and put a visible
     * bend in a knee that is simply standing. The floor under the reach limit is what prevents it. */
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    solveTwoBone(HIP, KNEE, ANKLE, ANKLE.clone(), hipQ0, kneeQ0, POLE, 0.995, out);
    expect(out.hipWorld.angleTo(hipQ0)).toBeLessThan(1e-9);
    expect(out.kneeWorld.angleTo(kneeQ0)).toBeLessThan(1e-9);
    expect(out.clamped).toBe(false);
  });

  it('reports a clamp when a near-straight leg is asked to reach further down', () => {
    /* Worth pinning as a fact about this rig, not just as solver behaviour: from the bind pose the
     * leg has 0.6 mm of extension left, so ANY downward correction is out of reach. That is exactly
     * why the pelvis pass anchors on the highest planted foot — it guarantees the legs are only
     * ever asked to shorten, and this case never arises in the real pass. */
    const target = ANKLE.clone().add(new Vector3(0, -0.055, 0));
    expect(HIP.distanceTo(target)).toBeGreaterThan(SPAN);
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    solveTwoBone(HIP, KNEE, ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);
    expect(out.clamped).toBe(true);
    const got = fk(HIP, KNEE, ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
    expect(HIP.distanceTo(got.ankle)).toBeLessThanOrEqual(SPAN + 1e-9);
    expect(kneeDeg(HIP, got.knee, got.ankle)).toBeLessThan(180);
  });

  it('is idempotent — re-solving a solved pose does not creep', () => {
    /* The pass runs every frame against a target that often has not moved. Any residual per-solve
     * error would accumulate into a leg that slowly curls. */
    const target = BENT_ANKLE.clone().add(new Vector3(0.02, 0.06, 0.01));
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    solveTwoBone(HIP, KNEE, BENT_ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);
    const first = fk(HIP, KNEE, BENT_ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);

    const hipQ1 = out.hipWorld.clone();
    const kneeQ1 = out.kneeWorld.clone();
    const out2 = createTwoBoneOut();
    solveTwoBone(HIP, first.knee, first.ankle, target, hipQ1, kneeQ1, POLE, 0.995, out2);
    expect(out2.hipWorld.angleTo(hipQ1)).toBeLessThan(1e-6);
    expect(out2.kneeWorld.angleTo(kneeQ1)).toBeLessThan(1e-6);
  });
});

describe('solveTwoBone — the knee', () => {
  it('keeps the bend direction the animated pose gave it', () => {
    /* The pole vector is READ, never invented. Whatever side the capture put the knee on, the solve
     * has to leave it there — a knee that flips side for one frame is the single most visible
     * failure this module could have. */
    const ref = new Vector3()
      .subVectors(BENT_ANKLE, HIP)
      .cross(new Vector3().subVectors(KNEE, HIP))
      .normalize();
    expect(bendSide(HIP, KNEE, BENT_ANKLE, ref)).toBeGreaterThan(0);

    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    /* Deliberately spans reachable AND clamped targets — a clamp is where a naive implementation
     * flips the knee, because the triangle it solves collapses. */
    for (const dy of [0.01, 0.05, 0.1, 0.2, 0.3, -0.02, -0.05, -0.3, 0.6]) {
      const target = BENT_ANKLE.clone().add(new Vector3(0.04, dy, -0.03));
      solveTwoBone(HIP, KNEE, BENT_ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);
      const got = fk(HIP, KNEE, BENT_ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
      expect(bendSide(HIP, got.knee, got.ankle, out.bendAxis), `dy=${dy}`).toBeGreaterThan(0);
      expect(kneeDeg(HIP, got.knee, got.ankle), `dy=${dy}`).toBeLessThan(180);
    }
  });

  it('never straightens past the reach ceiling, however far the target is', () => {
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    for (const reach of [0.9, 1.5, 3, 40]) {
      const target = new Vector3(HIP.x, HIP.y - SPAN * reach, HIP.z);
      solveTwoBone(HIP, KNEE, ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);
      const got = fk(HIP, KNEE, ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
      expect(HIP.distanceTo(got.ankle), `reach=${reach}`).toBeLessThanOrEqual(SPAN + 1e-9);
      expect(kneeDeg(HIP, got.knee, got.ankle), `reach=${reach}`).toBeLessThan(180);
      if (reach > 1) expect(out.clamped).toBe(true);
    }
  });

  it('never folds past the inner limit either', () => {
    /* The other end of the same triangle: a target closer than |l1 − l2| has no solution and an
     * unclamped `acos` would return NaN, which propagates into every bone below the hip. */
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    const target = HIP.clone().add(new Vector3(0, -0.001, 0));
    solveTwoBone(HIP, KNEE, ANKLE, target, hipQ0, kneeQ0, POLE, 0.995, out);
    const got = fk(HIP, KNEE, ANKLE, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
    expect(Number.isFinite(got.ankle.x)).toBe(true);
    expect(HIP.distanceTo(got.ankle)).toBeGreaterThanOrEqual(Math.abs(L1 - L2) - 1e-6);
    expect(out.clamped).toBe(true);
  });

  it('falls back to the supplied pole when the leg is perfectly straight', () => {
    /* `cross(ankle − hip, knee − hip)` is the pole, and it vanishes on a dead-straight leg. Reusing
     * the last good normal is the only answer that does not pick a knee direction at random. */
    const hip = new Vector3(0, 1, 0);
    const knee = new Vector3(0, 1 - L1, 0);
    const ankle = new Vector3(0, 1 - SPAN, 0);
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion();
    const kneeQ0 = new Quaternion();
    solveTwoBone(hip, knee, ankle, ankle.clone().add(new Vector3(0, 0.1, 0)), hipQ0, kneeQ0, POLE, 0.995, out);
    expect(out.bendAxis.distanceTo(POLE)).toBeLessThan(1e-9);
    const got = fk(hip, knee, ankle, hipQ0, kneeQ0, out.hipWorld, out.kneeWorld);
    expect(Number.isFinite(got.knee.x)).toBe(true);
    /* The knee has to leave the hip-ankle line along the FALLBACK normal, not some arbitrary one. */
    expect(Math.abs(new Vector3().subVectors(got.knee, hip).normalize().dot(POLE))).toBeLessThan(1e-9);
  });

  it('passes a degenerate chain through untouched instead of inventing a rotation', () => {
    const out = createTwoBoneOut();
    const hipQ0 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
    const kneeQ0 = new Quaternion();
    solveTwoBone(HIP, HIP.clone(), HIP.clone(), ANKLE, hipQ0, kneeQ0, POLE, 0.995, out);
    expect(out.hipWorld.angleTo(hipQ0)).toBeLessThan(1e-12);
    expect(out.kneeWorld.angleTo(kneeQ0)).toBeLessThan(1e-12);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * clampToReach
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('clampToReach — height beats the horizontal latch', () => {
  const hip = new Vector3(0, 0.93, 0);

  it('leaves a target inside the sphere exactly where it is', () => {
    const t = new Vector3(0.1, 0.2, 0.05);
    const out = new Vector3();
    expect(clampToReach(hip, t, 0.83, out)).toBe(false);
    expect(out.distanceTo(t)).toBe(0);
  });

  it('keeps the target height and gives up horizontal radius instead', () => {
    /* The whole point. A uniform pull-in toward the hip raises the ankle, which is the defect the
     * module exists to remove — measured at 34 mm of float on this clip before this was fixed. */
    const t = new Vector3(0.6, 0.45, 0.4);
    const out = new Vector3();
    expect(clampToReach(hip, t, 0.83, out)).toBe(true);
    expect(out.y).toBe(t.y);
    expect(hip.distanceTo(out)).toBeCloseTo(0.83, 9);
    /* Pulled straight in along the horizontal bearing, not swung sideways. */
    const b0 = Math.atan2(t.z - hip.z, t.x - hip.x);
    const b1 = Math.atan2(out.z - hip.z, out.x - hip.x);
    expect(b1).toBeCloseTo(b0, 9);
  });

  it('still keeps the height when the leg is exactly long enough, standing straight down', () => {
    /* The case that first got this wrong. `dy` equal to the full leg length leaves ZERO horizontal
     * room, and rejecting that as degenerate sent a fully extended leg down the uniform-scaling
     * path — lifting the foot. Zero room is a valid answer: put the ankle under the hip. */
    const t = new Vector3(0.6, hip.y - 0.83, 0.4);
    const out = new Vector3();
    expect(clampToReach(hip, t, 0.83, out)).toBe(true);
    expect(out.y).toBe(t.y);
    expect(out.x).toBeCloseTo(hip.x, 9);
    expect(out.z).toBeCloseTo(hip.z, 9);
    expect(hip.distanceTo(out)).toBeCloseTo(0.83, 9);
  });

  it('scales everything only when the leg cannot reach that depth at any offset', () => {
    const t = new Vector3(0.2, hip.y - 1.4, 0.1);
    const out = new Vector3();
    expect(clampToReach(hip, t, 0.83, out)).toBe(true);
    expect(hip.distanceTo(out)).toBeCloseTo(0.83, 9);
    expect(out.y).toBeGreaterThan(t.y);
  });

  it('is safe to call with target and out aliased to the same vector', () => {
    /* The per-frame path does exactly this to avoid an allocation. */
    const v = new Vector3(0.6, 0.45, 0.4);
    clampToReach(hip, v, 0.83, v);
    expect(hip.distanceTo(v)).toBeCloseTo(0.83, 9);
    expect(v.y).toBeCloseTo(0.45, 9);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * stepLatch
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('stepLatch — contact that cannot chatter', () => {
  const DT = 1 / 60;

  it('holds on until the loose exit condition fires, not when the tight entry stops', () => {
    const l = createLatch();
    stepLatch(l, true, false, DT, 0.1);
    expect(l.on).toBe(true);
    /* The band between the thresholds: neither enter nor exit. A latch without hysteresis would
     * drop here and re-take next frame, at the frame rate. */
    for (let i = 0; i < 30; i++) stepLatch(l, false, false, DT, 0.1);
    expect(l.on).toBe(true);
    stepLatch(l, false, true, DT, 0.1);
    expect(l.on).toBe(false);
  });

  it('ramps the weight over blendS and clamps it to [0, 1]', () => {
    /* 0.1 s at 60 Hz is six frames, so half weight lands on frame three. The ramp matters: a plant
     * engaging in one frame moves the ankle by however wrong the pose was — up to 207 mm on this
     * clip — and that reads as a snap rather than a settle. */
    const l = createLatch();
    for (let i = 0; i < 3; i++) stepLatch(l, true, false, DT, 0.1);
    expect(l.w).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 3; i++) stepLatch(l, true, false, DT, 0.1);
    expect(l.w).toBeCloseTo(1, 12);
    for (let i = 0; i < 200; i++) stepLatch(l, true, false, DT, 0.1);
    expect(l.w).toBe(1);
    for (let i = 0; i < 200; i++) stepLatch(l, false, true, DT, 0.1);
    expect(l.w).toBe(0);
  });

  it('engages in one step when blendS is zero', () => {
    const l = createLatch();
    stepLatch(l, true, false, DT, 0);
    expect(l.w).toBe(1);
  });

  it('ramps at the same rate per SECOND whatever the frame rate', () => {
    /* The thresholds are quoted in seconds, so a 30 Hz frame must move the weight twice as far as
     * a 60 Hz one — otherwise every tuning number silently means something else on a slow machine. */
    const fast = createLatch();
    const slow = createLatch();
    for (let i = 0; i < 4; i++) stepLatch(fast, true, false, 1 / 120, 0.1);
    stepLatch(slow, true, false, 1 / 30, 0.1);
    expect(fast.w).toBeCloseTo(slow.w, 9);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * groundAnchor
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('groundAnchor — the no-hyperextension invariant', () => {
  it('anchors on the foot needing the least lift, i.e. the highest one', () => {
    expect(groundAnchor([0.207, 0.08])).toBeCloseTo(0.08, 9);
    expect(groundAnchor([-0.055, -0.02])).toBeCloseTo(-0.055, 9);
  });

  it('is zero with nothing on the ground, so an airborne figure is left alone', () => {
    expect(groundAnchor([])).toBe(0);
  });

  /**
   * The property the whole design rests on: after shifting the body by the anchor, EVERY planted
   * foot's remaining correction is upward, so every leg the solver touches only ever shortens.
   * Take the mean or the lowest foot instead and some leg gets a negative residual — an ankle to be
   * pushed down and away — which is the one request a two-bone chain answers by locking its knee.
   */
  it('leaves every residual non-negative, on the real range and on noise', () => {
    const cases: number[][] = [
      [0.207, 0.08],
      [-0.055, -0.02],
      [0.19, -0.03],
      [0.0, 0.0],
      [0.035],
    ];
    /* Deterministic pseudo-random — `tests/contracts/imports.test.ts` bans Math.random under the
     * Node-safe trees and a flaky invariant test would be worse than none. */
    let seed = 20250802;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 0.5 - 0.25;
    };
    for (let i = 0; i < 200; i++) cases.push([rnd(), rnd()]);

    for (const needs of cases) {
      const a = groundAnchor(needs);
      for (const n of needs) {
        expect(n - a, `needs=${JSON.stringify(needs)}`).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });
});
