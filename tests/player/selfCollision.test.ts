/**
 * B6 PLAYER — the pure core of `src/player/selfCollision`.
 *
 * Imports the module DIRECTLY rather than through the block barrel, for the same reason
 * `footIk.test.ts` does: the barrel pulls `./character`, which pulls `GLTFLoader`. This file's
 * subject imports nothing from three but `Matrix4`, `Quaternion` and `Vector3` — its dependencies
 * on `Character` and `BoneName` are `import type`, and type imports are erased.
 *
 * ═══ WHAT IS AND IS NOT COVERED ══════════════════════════════════════════════════════════════
 *
 * `createSelfCollision` needs a skinned GLB with a Rigify skeleton and cannot run here at all, so
 * the four decisions worth being sure about were factored out of it:
 *
 *   `closestSegments` — the primitive every contact test reduces to, including its three
 *                       degenerate branches, one of which (a sphere probe) runs on half of all
 *                       real tests
 *   `capsulePush`     — depth, contact parameter, and above all the PUSH DIRECTION on the deep
 *                       penetrations this module exists for, where the obvious formula vanishes
 *   `reachScale`      — the guarantee that a correction can never straighten the elbow
 *   `smoothToward`    — the anti-jitter filter, whose failure mode is the one thing worse than
 *                       the defect being fixed
 *
 * Numbers throughout are this project's measured geometry, not synthetic units: a 0.0969 m skull
 * capsule and a 0.115 m ribcage capsule on a 1.8287 m character, a 0.2744 m upper arm and a
 * 0.2726 m forearm, and the worst clearances the 60 Hz sweep of `heian-nidan` actually produced —
 * a wrist 0.010 m from the head axis and 0.014 m from the spine axis. A unit-sphere suite would
 * pass while hiding exactly the deep-penetration behaviour that matters.
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';

import {
  capsulePush,
  closestSegments,
  createClosestPair,
  createPush,
  reachScale,
  smoothToward,
} from '../../src/player/selfCollision';

/* ── the rig and its proxies, as measured ─────────────────────────────────────────────────── */

/** Skull capsule: `DEF-head` at y 1.5687, spanned +0.030 H .. +0.089 H along the spine's up. */
const HEAD_A = new Vector3(0, 1.6236, 0.003);
const HEAD_B = new Vector3(0, 1.7314, 0.003);
const HEAD_R = 0.0969;

/** Ribcage capsule: `DEF-spine003` to 75 % of the way to `DEF-neck`, at the measured half-depth. */
const CHEST_A = new Vector3(0, 1.3148, -0.0049);
const CHEST_B = new Vector3(0, 1.4444, -0.0091);
const CHEST_R = 0.115;

const FIST_R = 0.045;
const FOREARM_R = 0.045;
/** upper arm 0.2744 + forearm 0.2726. */
const ARM_SPAN = 0.547;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * closestSegments
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('closestSegments — the primitive every contact reduces to', () => {
  it('finds the perpendicular between two skew segments', () => {
    const out = createClosestPair();
    closestSegments(
      new Vector3(-1, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 0.37, -1),
      new Vector3(0, 0.37, 1),
      out,
    );
    expect(out.dist).toBeCloseTo(0.37, 12);
    expect(out.s).toBeCloseTo(0.5, 12);
    expect(out.t).toBeCloseTo(0.5, 12);
  });

  it('clamps to the nearer endpoint when the perpendicular falls outside', () => {
    /* A fist swung past the top of the head: the closest point on the skull capsule is its cap, not
     * a point on its interior. Getting this wrong makes the head a cylinder of infinite length. */
    const out = createClosestPair();
    const fist = new Vector3(0.02, 1.9, 0.003);
    closestSegments(fist, fist, HEAD_A, HEAD_B, out);
    expect(out.t).toBe(1);
    expect(out.dist).toBeCloseTo(fist.distanceTo(HEAD_B), 12);
  });

  it('handles a degenerate FIRST segment, which is half of all real tests', () => {
    /* The fist is a sphere, i.e. `a1 === b1`. This branch runs once per collider per arm per frame
     * and a NaN here would propagate straight into a bone rotation. */
    const out = createClosestPair();
    const p = new Vector3(0.09, 1.68, 0.003);
    closestSegments(p, p, HEAD_A, HEAD_B, out);
    expect(out.s).toBe(0);
    expect(Number.isFinite(out.dist)).toBe(true);
    expect(out.dist).toBeCloseTo(0.09, 4);
  });

  it('handles two degenerate segments', () => {
    const out = createClosestPair();
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(1, 2, 3.5);
    closestSegments(a, a, b, b, out);
    expect(out.dist).toBeCloseTo(0.5, 12);
    expect(out.s).toBe(0);
    expect(out.t).toBe(0);
  });

  it('does not divide by zero on parallel segments', () => {
    /* A forearm held alongside the spine — the hikite position — is very nearly parallel to the
     * ribcage capsule, and the closed form's denominator goes to zero there. Any `s` gives the same
     * distance, so 0 is as good an answer as the formula would produce; Infinity is not. */
    const out = createClosestPair();
    closestSegments(
      new Vector3(0.17, 1.30, 0),
      new Vector3(0.17, 1.45, 0),
      CHEST_A,
      CHEST_B,
      out,
    );
    expect(Number.isFinite(out.s)).toBe(true);
    expect(Number.isFinite(out.dist)).toBe(true);
    expect(out.dist).toBeCloseTo(0.17, 2);
  });

  it('is symmetric in the distance it reports', () => {
    const a = createClosestPair();
    const b = createClosestPair();
    const p1 = new Vector3(0.1, 1.5, -0.2);
    const q1 = new Vector3(0.4, 1.6, 0.1);
    closestSegments(p1, q1, CHEST_A, CHEST_B, a);
    closestSegments(CHEST_A, CHEST_B, p1, q1, b);
    expect(a.dist).toBeCloseTo(b.dist, 12);
    expect(a.s).toBeCloseTo(b.t, 9);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * capsulePush
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('capsulePush — depth', () => {
  it('reports no contact when the fist is clear of the skull', () => {
    const out = createPush();
    const fist = new Vector3(0.25, 1.68, 0.003);
    expect(capsulePush(fist, fist, FIST_R, HEAD_A, HEAD_B, HEAD_R, out)).toBe(false);
    expect(out.depth).toBe(0);
  });

  it('reports exactly the shortfall on a shallow contact', () => {
    const out = createPush();
    /* 0.13 m from the axis against 0.0969 + 0.045 = 0.1419 of combined radius. */
    const fist = new Vector3(0.13, 1.68, 0.003);
    expect(capsulePush(fist, fist, FIST_R, HEAD_A, HEAD_B, HEAD_R, out)).toBe(true);
    expect(out.depth).toBeCloseTo(HEAD_R + FIST_R - 0.13, 6);
    expect(out.normal.x).toBeCloseTo(1, 9);
  });

  it('measures the real worst frame of the clip: a wrist 0.010 m from the head axis', () => {
    const out = createPush();
    const fist = new Vector3(0.01, 1.68, 0.003);
    expect(capsulePush(fist, fist, FIST_R, HEAD_A, HEAD_B, HEAD_R, out)).toBe(true);
    /* 0.132 m of penetration — the fist is not near the head, it is past the far side of it. */
    expect(out.depth).toBeCloseTo(HEAD_R + FIST_R - 0.01, 6);
    expect(out.normal.x).toBeCloseTo(1, 9);
  });

  it('reports where along the forearm the contact sits', () => {
    /* The whole point of `s`: a contact at 0.5 needs twice its own depth of WRIST travel to clear,
     * because a point halfway down the forearm inherits half of whatever the wrist does. */
    const out = createPush();
    /* A forearm swept horizontally past the ear at 0.10 m from the skull axis, arranged so the
     * nearest point falls exactly at its midpoint. */
    const elbow = new Vector3(0.10, 1.68, 0.303);
    const wrist = new Vector3(0.10, 1.68, -0.297);
    expect(capsulePush(elbow, wrist, FOREARM_R, HEAD_A, HEAD_B, HEAD_R, out)).toBe(true);
    expect(out.s).toBeCloseTo(0.5, 6);
    expect(out.depth).toBeCloseTo(HEAD_R + FOREARM_R - 0.10, 6);
  });
});

describe('capsulePush — the normal, which is the hard part', () => {
  it('points out of the collider on an ordinary contact', () => {
    const out = createPush();
    const fist = new Vector3(-0.05, 1.36, 0.06);
    expect(capsulePush(fist, fist, FIST_R, CHEST_A, CHEST_B, CHEST_R, out)).toBe(true);
    expect(out.normal.length()).toBeCloseTo(1, 12);
    /* Radially out from the spine axis, and with no component along it — the correction must not
     * slide a hand up the chest toward the throat. */
    expect(out.normal.dot(new Vector3(-0.05, 0, 0.06).normalize())).toBeGreaterThan(0.99);
  });

  it('always points OUT, even on a fist driven clean through the axis', () => {
    /**
     * The measured failure this whole three-layer fallback exists for. Over `heian-nidan` the left
     * wrist reaches 0.014 m from the spine axis and 0.010 m from the head axis — it goes THROUGH
     * them. `normalize(p1 − p2)` vanishes and reverses sign there, so a naive implementation pushes
     * the hand one way on one frame and the opposite way on the next: a limb snapping through the
     * body, which is worse than the penetration it was meant to fix.
     *
     * Asserted as the property that actually matters rather than as a sign pattern: applying the
     * push must RESOLVE the contact. A normal pointing inward passes any sign test you care to
     * write and fails this one, at every depth, on both capsules.
     */
    const out = createPush();
    const check = createPush();
    for (const [ca, cb, cr] of [
      [CHEST_A, CHEST_B, CHEST_R],
      [HEAD_A, HEAD_B, HEAD_R],
    ] as const) {
      for (let i = -24; i <= 24; i++) {
        const fist = new Vector3(i * 0.008, (ca.y + cb.y) / 2, 0.004);
        if (!capsulePush(fist, fist, FIST_R, ca, cb, cr, out)) continue;
        const moved = fist.clone().addScaledVector(out.normal, out.depth + 1e-9);
        capsulePush(moved, moved, FIST_R, ca, cb, cr, check);
        expect(check.depth, `x=${(i * 0.008).toFixed(3)}`).toBeLessThan(1e-6);
      }
    }
  });

  it('turns smoothly rather than snapping as a fist passes beside the spine', () => {
    /* The realistic sweep — a hikite travelling across the front of the ribs, a few millimetres off
     * the capsule's axis rather than exactly on it. The direction has to rotate through the
     * intermediate angles; a jump here is a wrist teleporting between two frames. */
    const out = createPush();
    const prev = new Vector3();
    let worstTurn = 0;
    let first = true;
    for (let i = -30; i <= 30; i++) {
      const fist = new Vector3(i * 0.004, 1.38, 0.03);
      if (!capsulePush(fist, fist, FIST_R, CHEST_A, CHEST_B, CHEST_R, out)) continue;
      if (!first) worstTurn = Math.max(worstTurn, prev.angleTo(out.normal));
      prev.copy(out.normal);
      first = false;
    }
    /* 4 mm of travel must never turn the push by more than 15°. */
    expect((worstTurn * 180) / Math.PI).toBeLessThan(15);
  });

  it('still produces a unit normal with the probe exactly on the collider axis', () => {
    /* Layer 3. There is no right answer here — every direction perpendicular to the axis is equally
     * good — so what is being asserted is that there IS an answer and that it is finite. */
    const out = createPush();
    const fist = new Vector3(0, 1.68, 0.003);
    expect(capsulePush(fist, fist, FIST_R, HEAD_A, HEAD_B, HEAD_R, out)).toBe(true);
    expect(out.normal.length()).toBeCloseTo(1, 12);
    expect(Number.isFinite(out.depth)).toBe(true);
    /* Perpendicular to the capsule's axis: pushing a hand out through the top of the skull is not
     * an escape, it is a longer route through the same head. */
    const axis = new Vector3().subVectors(HEAD_B, HEAD_A).normalize();
    expect(Math.abs(out.normal.dot(axis))).toBeLessThan(1e-9);
  });

  it('picks the SAME direction every time it is asked — repeatable beats well-motivated', () => {
    /* The degenerate case is reached on consecutive frames or not at all, so an answer that varies
     * between two calls with identical input is a per-frame direction change by construction. */
    const a = createPush();
    const b = createPush();
    const fist = new Vector3(0, 1.68, 0.003);
    capsulePush(fist, fist, FIST_R, HEAD_A, HEAD_B, HEAD_R, a);
    capsulePush(fist, fist, FIST_R, HEAD_A, HEAD_B, HEAD_R, b);
    expect(a.normal.distanceTo(b.normal)).toBe(0);
  });

  it('survives a collider whose two ends coincide', () => {
    /* A rig that mapped `chest` and `neck_01` to the same joint — Mixamo maps both `chest` and
     * `spine_03` to `Spine2`, so this is one table edit away from being real — yields a capsule of
     * zero length. It has to behave as a sphere, not divide by zero. */
    const out = createPush();
    const fist = new Vector3(0.02, 1.32, 0);
    expect(capsulePush(fist, fist, FIST_R, CHEST_A, CHEST_A, CHEST_R, out)).toBe(true);
    expect(out.normal.length()).toBeCloseTo(1, 12);
    expect(Number.isFinite(out.depth)).toBe(true);
  });

  it('survives a zero-length collider with the probe exactly on it', () => {
    const out = createPush();
    expect(capsulePush(CHEST_A, CHEST_A, FIST_R, CHEST_A, CHEST_A, CHEST_R, out)).toBe(true);
    expect(out.normal.length()).toBeCloseTo(1, 12);
    expect(out.depth).toBeCloseTo(FIST_R + CHEST_R, 12);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * reachScale
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('reachScale — the elbow can never be straightened', () => {
  const shoulder = new Vector3(0.19, 1.44, -0.07);
  /** 0.985 of upper arm + forearm — the ceiling `createSelfCollision` passes. */
  const LIMIT = 0.985 * ARM_SPAN;

  it('allows the whole correction when it stays inside the reach sphere', () => {
    const wrist = shoulder.clone().add(new Vector3(0.2, -0.1, 0.15));
    const delta = new Vector3(0.03, 0.01, 0.02);
    expect(reachScale(shoulder, wrist, delta, LIMIT)).toBe(1);
  });

  it('allows the whole correction when it points back toward the shoulder', () => {
    /* An arm already at full extension being pushed off the ribs INWARD is not a reach problem, and
     * refusing it would leave the deepest contacts of a retracted hikite unresolved. */
    const wrist = shoulder.clone().add(new Vector3(LIMIT, 0, 0));
    const delta = new Vector3(-0.05, 0.02, 0);
    expect(reachScale(shoulder, wrist, delta, LIMIT)).toBe(1);
  });

  it('drops the correction entirely when a fully extended arm is asked to extend further', () => {
    /* The kime of an oi-zuki. The honest answer is to leave the punch alone. */
    const wrist = shoulder.clone().add(new Vector3(LIMIT, 0, 0));
    const delta = new Vector3(0.04, 0, 0);
    expect(reachScale(shoulder, wrist, delta, LIMIT)).toBe(0);
  });

  it('lands the wrist exactly on the limit when it shortens a correction', () => {
    const wrist = shoulder.clone().add(new Vector3(LIMIT - 0.02, 0, 0));
    const delta = new Vector3(0.1, 0, 0);
    const k = reachScale(shoulder, wrist, delta, LIMIT);
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
    const landed = wrist.clone().addScaledVector(delta, k);
    expect(shoulder.distanceTo(landed)).toBeCloseTo(LIMIT, 9);
  });

  it('never returns a scale that pushes the wrist past the limit, on the whole sweep', () => {
    /* The invariant the "no locked elbow" claim rests on, asserted over every direction rather than
     * over the two that were convenient to write. */
    let seed = 20250802;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    for (let i = 0; i < 400; i++) {
      const wrist = shoulder
        .clone()
        .add(new Vector3(rnd(), rnd(), rnd()).normalize().multiplyScalar(0.1 + 0.4 * Math.abs(rnd())));
      const delta = new Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.12);
      const limit = Math.max(LIMIT, shoulder.distanceTo(wrist));
      const k = reachScale(shoulder, wrist, delta, limit);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      const landed = wrist.clone().addScaledVector(delta, k);
      expect(shoulder.distanceTo(landed)).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it('is a no-op for a zero correction rather than a division by zero', () => {
    const wrist = shoulder.clone().add(new Vector3(0.3, 0, 0));
    expect(reachScale(shoulder, wrist, new Vector3(), LIMIT)).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * smoothToward
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('smoothToward — a correction that cannot jitter', () => {
  const DT = 1 / 60;
  const TAU = 0.09;
  const RATE = 0.6;
  const MAX = 0.128; // 0.07 H on a 1.8287 m character

  it('eases in rather than snapping to a correction that appears in one frame', () => {
    /* A punch retracting past the ribs takes the raw requirement from 0 to 40 mm in three frames.
     * Applied raw that is a visible pop; the filter turns it into a settle. */
    const cur = new Vector3();
    const want = new Vector3(0.04, 0, 0);
    smoothToward(cur, want, DT, TAU, RATE, MAX);
    expect(cur.x).toBeGreaterThan(0);
    expect(cur.x).toBeLessThan(0.04 * 0.25);
    for (let i = 0; i < 60; i++) smoothToward(cur, want, DT, TAU, RATE, MAX);
    expect(cur.x).toBeCloseTo(0.04, 6);
  });

  it('eases back out to zero when the contact ends', () => {
    const cur = new Vector3(0.04, 0, 0);
    const want = new Vector3();
    smoothToward(cur, want, DT, TAU, RATE, MAX);
    expect(cur.x).toBeLessThan(0.04);
    expect(cur.x).toBeGreaterThan(0.03);
    for (let i = 0; i < 120; i++) smoothToward(cur, want, DT, TAU, RATE, MAX);
    expect(cur.length()).toBeLessThan(1e-4);
  });

  it('holds the per-frame change under the rate cap even when the requirement chatters', () => {
    /**
     * THE stability property, stated as the thing that is actually measured on screen: the
     * per-frame change in the applied correction. A raw requirement flipping between two opposite
     * 60 mm demands every frame — which is what a contact selection oscillating between two
     * colliders would produce — must never move the wrist more than `RATE * dt` = 10 mm in a frame.
     */
    const cur = new Vector3();
    const a = new Vector3(0.06, 0, 0);
    const b = new Vector3(-0.06, 0, 0);
    const prev = new Vector3();
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      prev.copy(cur);
      smoothToward(cur, i % 2 === 0 ? a : b, DT, TAU, RATE, MAX);
      worst = Math.max(worst, cur.distanceTo(prev));
    }
    expect(worst).toBeLessThanOrEqual(RATE * DT + 1e-12);
    /* And it does not accumulate: a symmetric chatter must average to nothing, not drift. */
    expect(cur.length()).toBeLessThan(0.012);
  });

  it('caps the magnitude so one bad capture frame cannot throw the arm', () => {
    const cur = new Vector3();
    const want = new Vector3(0, 0, 3);
    for (let i = 0; i < 600; i++) smoothToward(cur, want, DT, TAU, RATE, MAX);
    expect(cur.length()).toBeCloseTo(MAX, 9);
  });

  it('rotates through the intermediate directions when the winning collider changes', () => {
    /* Filtering the VECTOR and not the magnitude. A hand leaving the ribs for the head swaps a +X
     * requirement for a +Y one, and the applied correction has to turn rather than snap. */
    const cur = new Vector3(0.05, 0, 0);
    const want = new Vector3(0, 0.05, 0);
    smoothToward(cur, want, DT, TAU, RATE, MAX);
    expect(cur.x).toBeGreaterThan(0.03);
    expect(cur.y).toBeGreaterThan(0);
    expect(cur.y).toBeLessThan(0.02);
  });

  it('moves the same distance per SECOND whatever the frame rate', () => {
    /* The three tuning numbers are quoted in seconds and metres per second. Without this they mean
     * something different on every machine, and every measured number in the header goes with them. */
    const fast = new Vector3();
    const slow = new Vector3();
    const want = new Vector3(0.05, 0, 0);
    for (let i = 0; i < 4; i++) smoothToward(fast, want, 1 / 240, TAU, RATE, MAX);
    smoothToward(slow, want, 1 / 60, TAU, RATE, MAX);
    expect(fast.x).toBeCloseTo(slow.x, 4);
  });

  it('treats a zero or negative dt as one 60 Hz frame instead of stalling', () => {
    const cur = new Vector3();
    smoothToward(cur, new Vector3(0.05, 0, 0), 0, TAU, RATE, MAX);
    expect(cur.x).toBeGreaterThan(0);
  });
});
