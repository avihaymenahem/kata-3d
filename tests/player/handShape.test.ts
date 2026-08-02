/**
 * B6 PLAYER — the pure core of `src/player/handShape`.
 *
 * Imports the module DIRECTLY rather than through the block barrel, for the reason
 * `footIk.test.ts` records: the barrel pulls `./character`, which pulls `GLTFLoader`.
 *
 * ═══ WHY THESE FOUR THINGS AND NOT THE HANDLE ════════════════════════════════════════════════
 *
 * `createHandShaper` needs a skinned GLB with a Rigify hand and cannot run in Node at all. What CAN
 * run — and what the whole module stands or falls on — was factored out of it:
 *
 *   `HAND_SHAPES`  the doc 03 §12 angle table. A fist that is not dramatically tighter than every
 *                  other shape is the original defect wearing a new name.
 *   `swingAxis`    the sign convention. Get this backwards and the fingers open instead of closing.
 *   `palmFacing`   the axis derivation, and specifically its MIRROR behaviour. This is where the
 *                  first attempt died: see below.
 *   `handEase`     the blend, whose only job is to have no velocity step at either end.
 *
 * ═══ EVERY COORDINATE BELOW IS MEASURED OFF THE SHIPPED RIG ══════════════════════════════════
 *
 * Read out of `AnimLib.glb`'s Rigify bind pose through `skeleton.boneInverses` in the running page,
 * metres, character 1.829 m tall. Synthetic hands would pass this suite and hide the one fact that
 * actually broke the first implementation: the bind fingers are DEAD STRAIGHT — 0.00°, 0.17°, 0.00°,
 * 0.10°, 0.02° of interior bend across the five digits — so the bend-plane axis that works for the
 * elbow is float noise here, and it disagreed BETWEEN HANDS. The left index's "bend normal" came out
 * (0, −0.97, +0.23) against the right index's (0, −0.03, −1.00) for the same mirrored joint. One
 * hand would have curled and the other splayed sideways. The mirror assertions are that bug's
 * regression test.
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';

import {
  HAND_SHAPES,
  MIN_SWING_SIN,
  handEase,
  hikiteHandShape,
  palmFacing,
  swingAxis,
  type HandShapeId,
} from '../../src/player/handShape';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The rig, as measured
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** Bind joint origins of the LEFT hand. The right is the exact mirror in x, and is built from this. */
const LEFT = {
  wrist: v(0.7389, 1.4408, -0.0654),
  index: { mcp: v(0.8588, 1.4388, -0.0345), pip: v(0.8995, 1.4388, -0.0345) },
  middle: { mcp: v(0.8605, 1.4412, -0.0602), pip: v(0.9028, 1.4412, -0.0622) },
  ring: { mcp: v(0.858, 1.4409, -0.0825), pip: v(0.8973, 1.4409, -0.0839) },
  pinky: { mcp: v(0.8466, 1.4392, -0.1062), pip: v(0.8868, 1.4392, -0.1089) },
  thumb: { mcp: v(0.7662, 1.418, -0.0318), ip: v(0.8394, 1.3769, 0.0061) },
};

const mirror = (p: Vector3): Vector3 => v(-p.x, p.y, p.z);
const RIGHT = {
  wrist: mirror(LEFT.wrist),
  index: { mcp: mirror(LEFT.index.mcp), pip: mirror(LEFT.index.pip) },
  middle: { mcp: mirror(LEFT.middle.mcp), pip: mirror(LEFT.middle.pip) },
  ring: { mcp: mirror(LEFT.ring.mcp), pip: mirror(LEFT.ring.pip) },
  pinky: { mcp: mirror(LEFT.pinky.mcp), pip: mirror(LEFT.pinky.pip) },
  thumb: { mcp: mirror(LEFT.thumb.mcp), ip: mirror(LEFT.thumb.ip) },
};

type Hand = typeof LEFT;
const dirOf = (a: Vector3, b: Vector3): Vector3 => new Vector3().subVectors(b, a).normalize();
const resolvePalm = (h: Hand): Vector3 | null =>
  palmFacing(h.wrist, h.index.mcp, h.pinky.mcp, dirOf(h.middle.mcp, h.middle.pip), h.thumb.ip);

/**
 * The answer this rig should give: the ordinary palms-down T-pose, both hands.
 *
 * Not a coincidence worth asserting loosely — the four MCP joints and the wrist sit at
 * y = 1.4388…1.4412, i.e. coplanar to 2.4 mm over a 122 mm palm, so the plane is well conditioned
 * and its normal is world ±Y to within half a degree.
 */
const DOWN = v(0, -1, 0);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * HAND_SHAPES — is a fist actually a fist
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const IDS: readonly HandShapeId[] = ['seiken', 'shuto', 'open', 'nukite'];
const fingerTotal = (id: HandShapeId): number => {
  const f = HAND_SHAPES[id].finger;
  return f.mcpDeg + f.pipDeg + f.dipDeg;
};

describe('HAND_SHAPES — doc 03 §12, joint for joint', () => {
  it('carries all four of B1 s shapes and nothing else', () => {
    expect(Object.keys(HAND_SHAPES).sort()).toEqual([...IDS].sort());
  });

  it('makes seiken an order of magnitude tighter than every other shape', () => {
    /* THE assertion of this file. The user-visible defect was "our hand is always open"; a table
     * whose fist is a gentle curl fixes nothing while looking like it did. 265° folds the fingertips
     * onto the palm and leaves the proximal phalanges square to it, which is what puts the first two
     * knuckles forward. */
    expect(fingerTotal('seiken')).toBe(265);
    for (const id of IDS) {
      if (id === 'seiken') continue;
      expect(fingerTotal(id), id).toBeLessThan(30);
      expect(fingerTotal('seiken') / Math.max(1, fingerTotal(id)), id).toBeGreaterThan(8);
    }
  });

  it('never asks a joint to hyperextend', () => {
    /* Positive is toward the palm by the module's own convention, so a negative anywhere in the
     * table is a finger bending backwards — the one output nobody would read as a hand. */
    for (const id of IDS) {
      const s = HAND_SHAPES[id];
      for (const [k, d] of Object.entries(s.finger)) expect(d, `${id}.${k}`).toBeGreaterThanOrEqual(0);
      for (const [k, d] of Object.entries(s.thumb)) expect(d, `${id}.${k}`).toBeGreaterThanOrEqual(0);
      expect(s.spread, id).toBeGreaterThanOrEqual(0);
      expect(s.spread, id).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the model s finger fan only on the relaxed hand', () => {
    /* "Fingers straight and TOGETHER" is the literal definition of shuto and nukite, and a closed
     * fist has no fan either. Only doc 02 §2's rei/yoi hand hangs as modelled. */
    expect(HAND_SHAPES.open.spread).toBe(1);
    for (const id of ['seiken', 'shuto', 'nukite'] as const) expect(HAND_SHAPES[id].spread, id).toBe(0);
  });

  it('keeps every thumb aim a fraction, so a shape cannot overshoot its own fingers', () => {
    /* `aim` scales a MEASURED angle — the swing from the bind thumb onto the bearing of that
     * shape's folded fingers — so anything outside [0, 1] means "past the fingers", which is a
     * thumb sticking out the far side of the hand. */
    for (const id of IDS) {
      expect(HAND_SHAPES[id].thumb.aim, id).toBeGreaterThanOrEqual(0);
      expect(HAND_SHAPES[id].thumb.aim, id).toBeLessThanOrEqual(1);
    }
  });

  it('folds the fist s thumb and swings the knife-hand s — the opposite trade', () => {
    /**
     * The two held shapes want the thumb in completely different places and get there in opposite
     * ways, and this is the assertion that says so rather than letting the four numbers drift into
     * looking like typos:
     *
     *   seiken — the thumb CLAMPS over the folded fingers. Little swing (0.25 of the way onto the
     *            finger bearing), a lot of fold (115° across the two distal joints).
     *   shuto  — the thumb TUCKS along the extended blade. Nearly all swing (0.9), almost no fold.
     *
     * Both are calibrated against the shipped rig — see `HAND_SHAPES` — not taken from doc 03 §12,
     * whose CMC angle pair assumes a thumb that starts in the palm plane and this one does not.
     */
    const fold = (id: HandShapeId): number =>
      HAND_SHAPES[id].thumb.mcpFlexDeg + HAND_SHAPES[id].thumb.ipFlexDeg;
    expect(HAND_SHAPES.seiken.thumb.aim).toBeLessThan(HAND_SHAPES.shuto.thumb.aim);
    expect(fold('seiken')).toBeGreaterThan(fold('shuto') * 3);
    /* Most of the fist's fold is at the LAST joint, where the excess thumb length actually is.
     * Shifting it toward the knuckle drove the tip through the fingers — 18 mm proud at MCP 35,
     * 4 mm at MCP 50. */
    expect(HAND_SHAPES.seiken.thumb.ipFlexDeg).toBeGreaterThan(HAND_SHAPES.seiken.thumb.mcpFlexDeg);
    /* And the relaxed hand does neither hard: rei/yoi's thumb hangs, it is not pressed. */
    expect(fold('open')).toBeLessThan(fold('shuto'));
    expect(HAND_SHAPES.open.thumb.aim).toBeLessThan(HAND_SHAPES.shuto.thumb.aim);
  });
});

describe('hikiteHandShape — doc 02 §1.3', () => {
  it('opens the pulling hand only behind a shuto-uke', () => {
    expect(hikiteHandShape('TATE-B')).toBe('shuto');
    expect(hikiteHandShape('HIP-A')).toBe('seiken');
    /* doc 02 §9 d6 settles the case sources disagree on: Heian 7–9's non-blocking hand is a FIST. */
    expect(hikiteHandShape('NONE')).toBe('seiken');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * swingAxis — the sign, which is the whole game
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('swingAxis — a positive angle goes TOWARD the second argument', () => {
  it('recovers the target direction exactly for perpendicular inputs', () => {
    /* The identity the module's comment claims: rotating `a` about `a × t` by the angle between them
     * lands ON `t`. If this held only approximately, every curl in the file would be off by
     * whatever the error was. */
    const a = v(1, 0, 0);
    const t = v(0, -1, 0);
    const w = swingAxis(a, t);
    expect(w).not.toBeNull();
    expect(a.clone().applyAxisAngle(w!, a.angleTo(t)).distanceTo(t)).toBeLessThan(1e-12);
    /* The measured Rigify answer for the left index, spelled out so a sign flip is legible. */
    expect(w!.distanceTo(v(0, 0, -1))).toBeLessThan(1e-12);
  });

  it('curls every measured digit of BOTH hands toward the palm, never away', () => {
    /**
     * The regression test for the bug in the header. Ten real bind directions — five digits, two
     * hands — each rotated by the module's own axis and asked whether the tip moved toward the palm
     * or away from it. The bend-plane implementation passed on one hand and failed on the other,
     * which is precisely the failure a single-hand test cannot see.
     */
    for (const [name, h] of [['L', LEFT] as const, ['R', RIGHT] as const]) {
      const palm = resolvePalm(h)!;
      for (const digit of ['index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
        const chain = h[digit];
        const along = dirOf(chain.mcp, 'pip' in chain ? chain.pip : chain.ip);
        const w = swingAxis(along, palm);
        expect(w, `${name}.${digit}`).not.toBeNull();
        const before = along.dot(palm);
        for (const deg of [10, 45, 88]) {
          const after = along.clone().applyAxisAngle(w!, (deg * Math.PI) / 180).dot(palm);
          expect(after, `${name}.${digit} @${deg}`).toBeGreaterThan(before);
        }
        /**
         * For a FINGER, 90° of flexion puts the segment square to the palm plane — dot ≈ 1 with the
         * palm normal — which is the geometric statement of "the knuckles now face forward", and is
         * what makes the seiken MCP angle of 88° mean what doc 03 says it means.
         *
         * The thumb is excluded because it is genuinely different, not because it fails: its
         * metacarpal already leaves the palm plane at bind, measured 26.5° palmward
         * (`dot(along, palm) = 0.446`), so a further 90° carries it PAST square and back out. That
         * is the anatomy of an opposable thumb and it is why its authored angles are the smallest
         * in the table.
         */
        if (digit !== 'thumb') {
          const square = along.clone().applyAxisAngle(w!, Math.PI / 2).dot(palm);
          expect(square, `${name}.${digit} square`).toBeGreaterThan(0.99);
        } else {
          expect(before, `${name}.thumb bind lean`).toBeCloseTo(0.446, 2);
        }
      }
    }
  });

  it('mirrors: the same anatomical curl comes out as opposite world axes', () => {
    /* Not a nicety — the two hands ARE mirror images, so an implementation that returned the same
     * world axis for both would be curling one hand open. */
    const l = swingAxis(dirOf(LEFT.index.mcp, LEFT.index.pip), resolvePalm(LEFT)!)!;
    const r = swingAxis(dirOf(RIGHT.index.mcp, RIGHT.index.pip), resolvePalm(RIGHT)!)!;
    expect(l.dot(r)).toBeLessThan(-0.99);
  });

  it('refuses a degenerate pair rather than returning a noise axis', () => {
    /* The bind fingers of this rig are collinear to 0.17°, i.e. a sine of 0.003 — well under the
     * 0.02 floor. That is exactly why the bend-plane derivation had to be abandoned, and this is the
     * guard that makes any future attempt at it fail loudly instead of shipping noise. */
    expect(swingAxis(v(1, 0, 0), v(1, 0, 0))).toBeNull();
    expect(swingAxis(v(1, 0, 0), v(-1, 0, 0))).toBeNull();
    expect(swingAxis(v(0, 0, 0), v(0, -1, 0))).toBeNull();
    const nearly = v(1, 0, 0).applyAxisAngle(v(0, 0, 1), (0.17 * Math.PI) / 180);
    expect(Math.sin((0.17 * Math.PI) / 180)).toBeLessThan(MIN_SWING_SIN);
    expect(swingAxis(v(1, 0, 0), nearly)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * palmFacing
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('palmFacing — the plane is measured, the side is anatomy', () => {
  it('reads world -Y on BOTH hands from the real bind pose', () => {
    for (const [name, h] of [['L', LEFT] as const, ['R', RIGHT] as const]) {
      const p = resolvePalm(h);
      expect(p, name).not.toBeNull();
      expect(p!.length(), name).toBeCloseTo(1, 12);
      /* Half a degree of the palms-down T-pose. The residual is the 2.4 mm of knuckle-plane
       * non-planarity, not an error in the derivation. */
      expect(p!.angleTo(DOWN) * (180 / Math.PI), name).toBeLessThan(0.5);
    }
  });

  it('takes its sign from the thumb, which is the only mirror-safe cue available', () => {
    /**
     * `cross(fingerDir, knuckleLine)` alone is handedness-dependent: it comes out +Y on the left and
     * −Y on the right for the SAME anatomical side of the same pose. Flipping the thumb to the back
     * of the hand must therefore flip the answer — that is the proof the sign is coming from the
     * thumb and not from a cross-product convention that happens to be right for one hand.
     */
    const flipped = { ...LEFT, thumb: { ...LEFT.thumb, ip: v(0.8394, 1.5047, 0.0061) } };
    const p = resolvePalm(flipped);
    expect(p).not.toBeNull();
    expect(p!.angleTo(DOWN) * (180 / Math.PI)).toBeGreaterThan(179);
  });

  it('gives up rather than guess when the thumb names no side', () => {
    /* A thumb modelled flat in the palm plane carries no sign, and inventing one is how a hand ends
     * up curling backwards on some future model. 0.004 m is a tenth of the 0.0639 m this rig
     * actually offers, so a real hand is never close to this branch. */
    const flat = { ...LEFT, thumb: { ...LEFT.thumb, ip: v(0.8394, 1.4408, 0.0061) } };
    expect(resolvePalm(flat)).toBeNull();
  });

  it('gives up on a degenerate knuckle line', () => {
    const collapsed = { ...LEFT, pinky: { ...LEFT.pinky, mcp: LEFT.index.mcp.clone() } };
    expect(resolvePalm(collapsed)).toBeNull();
  });

  it('is unchanged by which finger supplies the direction', () => {
    /* The four fingers fan by up to 2.71°, so if the answer moved with the choice of finger the
     * plane would not really be a plane. Measured spread of the four answers: under 0.2°. */
    const answers = (['index', 'middle', 'ring', 'pinky'] as const).map((f) =>
      palmFacing(LEFT.wrist, LEFT.index.mcp, LEFT.pinky.mcp, dirOf(LEFT[f].mcp, LEFT[f].pip), LEFT.thumb.ip),
    );
    for (const a of answers) expect(a).not.toBeNull();
    for (const a of answers) {
      expect(a!.angleTo(answers[0]!) * (180 / Math.PI)).toBeLessThan(0.2);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * handEase
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('handEase — no velocity step at either end', () => {
  it('pins the endpoints and the midpoint', () => {
    expect(handEase(0)).toBe(0);
    expect(handEase(1)).toBe(1);
    expect(handEase(0.5)).toBeCloseTo(0.5, 12);
  });

  it('clamps outside [0, 1] instead of overshooting', () => {
    /* `t` is `elapsed / blendS` and a long frame can push it past 1. The cubic keeps rising after
     * that, so an unclamped curve would drive the fist PAST its own pose — a visible over-curl on
     * exactly the frames a slow machine produces. */
    expect(handEase(-3)).toBe(0);
    expect(handEase(1.4)).toBe(1);
    expect(handEase(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('is monotone', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const e = handEase(i / 200);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('starts and ends at rest, which a linear ramp does not', () => {
    /* The reason the curve is not `t`. 265° of curl arriving with a step in velocity reads as a
     * flick at the start and a stop at the end; smoothstep's derivative is 0 at both. */
    const h = 1e-4;
    expect((handEase(h) - handEase(0)) / h).toBeLessThan(1e-3);
    expect((handEase(1) - handEase(1 - h)) / h).toBeLessThan(1e-3);
    /* And it is genuinely faster in the middle — a curve flat everywhere would also pass above. */
    expect((handEase(0.5 + h) - handEase(0.5 - h)) / (2 * h)).toBeCloseTo(1.5, 6);
  });

  it('is symmetric about the midpoint', () => {
    /* A shape change has no kime to lean toward — see the note on why this is not `kimeEase`. */
    for (const t of [0.1, 0.25, 0.4, 0.49]) {
      expect(handEase(t) + handEase(1 - t)).toBeCloseTo(1, 12);
    }
  });
});
