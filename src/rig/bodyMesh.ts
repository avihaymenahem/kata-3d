/**
 * B4 RIG — `src/rig/bodyMesh.ts`
 *
 * `buildBodyGeometry`: doc 06 §5.1 approach **(C)** — swept elliptical rings for limbs, torso and
 * neck, a lathed head, and doc 06 §5.2's extra edge loops at every flexing joint. ~3.9 k verts.
 *
 * Everything is generated in **T-POSE** (doc 06 §4.1 G1) from the BUILT skeleton's own T-pose
 * world joint positions, so the §2.1 x-flip that `src/rig/bones.ts` applied once is inherited
 * rather than repeated. `karateka.ts` CPU-skins the result through the A-pose (G4) before binding.
 *
 * ── ONE DOCUMENTED DEVIATION FROM doc 06 §5.1 ───────────────────────────────────────────────
 * §5.1 (C) calls for "hand-authored quad patches at shoulder/hip + 2 iterations of junction-only
 * Laplacian smoothing". We instead ship each limb as its own CLOSED shell whose proximal cap sits
 * *inside* the torso shell. Reasons, in order:
 *   1. §5.1's own budget insight is that "the gi covers ~85 % of the body" — the shoulder and hip
 *      junctions are under the uwagi and the zubon at every tick of both kata, so a welded patch
 *      there buys zero pixels.
 *   2. Closed shells are watertight by construction, which is what the shadow caster and the
 *      `M_MASK` silhouette pass need; a mis-stitched 3-way patch is a hole in both.
 *   3. The junctions that ARE visible — neck→head and calf→ankle→foot — are built as single
 *      continuous sweeps here, so there is no seam anywhere a camera can see one.
 */

import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { H } from '../contracts';
import { STATION_R } from '../data';
import type { LimbGroup } from './bones';
import { type SkeletonBuild } from './bones';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. A TINY SWEPT-RING TOOLKIT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** One cross-section of a swept tube. `cross(ex, ey) === axis`, which fixes the face winding. */
export interface Ring {
  readonly c: Vector3;
  readonly axis: Vector3;
  readonly ex: Vector3;
  readonly ey: Vector3;
  /** Semi-axis along `ex` / along `ey`, metres. */
  readonly ra: number;
  readonly rb: number;
  /** UV `v`, metres of arc length along the sweep. */
  readonly v: number;
  /** Superellipse exponent: 2 = ellipse, 4 = rounded rectangle. */
  readonly n: number;
  /** Optional per-angle radial multiplier — heel bulge, nose ridge, brow. */
  readonly mod: ((thetaRad: number) => number) | null;
  /** Clamp the ring-local `ey` coordinate, so a sole can be made flat at `y = 0`. */
  readonly clampEyMax: number | null;
}

/**
 * Build a ring frame from an axis and a fixed reference direction. `ey = normalize(axis x exRef)`
 * and `ex = ey x axis`, which keeps `cross(ex, ey) === axis` (so the winding rule below holds) AND
 * keeps `ex` continuous across a bend — the leg→foot sweep turns 90° at the ankle and a
 * recomputed-from-scratch frame there would twist the tube 180°.
 */
export function ringFrame(
  c: Vector3,
  axis: Vector3,
  exRef: Vector3,
  ra: number,
  rb: number,
  v: number,
  opts?: {
    n?: number;
    mod?: ((thetaRad: number) => number) | null;
    clampEyMax?: number | null;
  },
): Ring {
  const a = axis.clone().normalize();
  const ey = new Vector3().crossVectors(a, exRef).normalize();
  const ex = new Vector3().crossVectors(ey, a).normalize();
  return {
    c: c.clone(),
    axis: a,
    ex,
    ey,
    ra,
    rb,
    v,
    n: opts?.n ?? 2,
    mod: opts?.mod ?? null,
    clampEyMax: opts?.clampEyMax ?? null,
  };
}

const superScale = (x: number, n: number): number =>
  n === 2 ? x : Math.sign(x) * Math.pow(Math.abs(x), 2 / n);

/** Accumulates positions/uvs/indices plus the per-vertex limb group the weight solver gates on. */
export class GeomAccum {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  readonly group: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private push(p: Vector3, u: number, v: number, g: number): number {
    const i = this.vertexCount;
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    this.group.push(g);
    return i;
  }

  /**
   * Sweep `rings` with `segs` radial segments. Triangles are emitted as `(a,b,d)` + `(b,c,d)` over
   * the quad `a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j)`, which with a right-handed `(ex, ey, axis)`
   * frame gives outward-facing normals (verified on a unit cylinder: `(b-a) x (d-a) = ey x axis`,
   * and `ey x axis = ex` = outward at `theta = 0`).
   */
  addSweep(
    rings: readonly Ring[],
    segs: number,
    group: number,
    opts?: { capStart?: boolean; capEnd?: boolean },
  ): { readonly first: number; readonly rows: number; readonly cols: number } {
    const first = this.vertexCount;
    const tmp = new Vector3();

    for (const r of rings) {
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const m = r.mod ? r.mod(th) : 1;
        let ea = r.ra * m * superScale(Math.cos(th), r.n);
        let eb = r.rb * m * superScale(Math.sin(th), r.n);
        if (r.clampEyMax !== null && eb > r.clampEyMax) eb = r.clampEyMax;
        // Guard against a fully collapsed ring, which would give a zero-area fan.
        if (ea === 0 && eb === 0) ea = 1e-6;
        tmp.copy(r.c).addScaledVector(r.ex, ea).addScaledVector(r.ey, eb);
        this.push(tmp, (th * (r.ra + r.rb)) / 2, r.v, group);
      }
    }

    for (let i = 0; i + 1 < rings.length; i++) {
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        const a = first + i * segs + j;
        const b = first + i * segs + j1;
        const c = first + (i + 1) * segs + j1;
        const d = first + (i + 1) * segs + j;
        this.idx.push(a, b, d, b, c, d);
      }
    }

    if (opts?.capStart) {
      const r0 = rings[0]!;
      const ci = this.push(r0.c, 0, r0.v, group);
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        this.idx.push(ci, first + j1, first + j); // reversed: faces -axis
      }
    }
    if (opts?.capEnd) {
      const rN = rings[rings.length - 1]!;
      const base = first + (rings.length - 1) * segs;
      const ci = this.push(rN.c, 0, rN.v, group);
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        this.idx.push(ci, base + j, base + j1); // faces +axis
      }
    }

    return { first, rows: rings.length, cols: segs };
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeVertexNormals();
    return g;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. PROFILES — doc 06 §5.1's radius table + §5.2's edge loops, in FracH.
 *
 * A profile row is `[t, ra, rb]` where `t` is the sweep parameter (a height for the torso/head, a
 * distance from the SJC for the arm, a height then a foot-axis distance for the leg). Every
 * `ra`/`rb` traces back to a §5.1 station; the intermediate rows interpolate between stations, and
 * the rows marked LOOP are §5.2's four-loops-per-flexing-joint rule made explicit.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const S = STATION_R;
const r = (k: keyof typeof STATION_R): number => S[k]!.v;

/** §5.2 loop offsets: joint centre, ±0.35·r, +0.70·r. Distal is positive. */
const loopOffsets = (rBone: number): readonly number[] => [
  -0.35 * rBone,
  0,
  0.35 * rBone,
  0.7 * rBone,
];

type Row = readonly [t: number, ra: number, rb: number];

/** Torso: `ex = +X` (lateral) so `ra` is the lateral semi-axis and `rb` the A-P one. */
const TORSO_PROFILE: readonly Row[] = [
  [0.4700, 0.0880, 0.0620],
  [0.5308, r('hip'), r('hipDepth')],
  [0.5750, 0.0880, 0.0585],
  [0.6145, r('waist'), r('waistDepth')],
  [0.6608, 0.0800, 0.0555],
  [0.7000, 0.0840, 0.0565],
  [0.7308, r('chest'), r('chestDepth')],
  [0.7700, 0.0890, 0.0575],
  [0.7982, 0.0900, 0.0570],
  [0.8250, 0.0830, 0.0520],
  [0.8500, 0.0680, 0.0430],
  [0.8630, 0.0520, 0.0360],
];

/** Neck + head as ONE continuous shell — the neck seam is the one junction a camera always sees. */
const HEADNECK_PROFILE: readonly (readonly [t: number, ra: number, rb: number, zc: number])[] = [
  [0.8400, 0.0470, 0.0430, -0.008],
  [0.8650, r('neck'), 0.0350, -0.006],
  [0.8850, r('neck'), 0.0350, -0.006],
  [0.9000, 0.0350, 0.0380, -0.010],
  [0.9120, 0.0370, 0.0440, -0.016],
  [0.9250, 0.0420, 0.0505, -0.021],
  [0.9345, r('headRx'), 0.0520, -0.0235],
  [0.9450, r('headRx'), 0.0545, -0.024],
  [0.9560, 0.0435, 0.0530, -0.024],
  [0.9660, 0.0412, 0.0495, -0.023],
  [0.9760, 0.0370, 0.0440, -0.021],
  [0.9850, 0.0295, 0.0345, -0.019],
  [0.9930, 0.0195, 0.0225, -0.017],
  [0.9985, 0.0090, 0.0100, -0.015],
  [1.0000, 0.0016, 0.0018, -0.014],
];

/**
 * Arm, `t` = distance from the SJC along the T-pose arm axis. `ex = +Z` so `ra` is the A-P
 * semi-axis and `rb` the supero-inferior one. Deliberately near-CIRCULAR through the mid-forearm:
 * a circular cross-section is what makes the twist-band blend of §5.4 invisible in silhouette.
 */
const LEN_UPPERARM = 0.1618;
const LEN_FOREARM = 0.1545;
const T_ELBOW = LEN_UPPERARM;
const T_WRIST = LEN_UPPERARM + LEN_FOREARM;
/** Forearm twist stations, doc 06 §5.4: 33 % and 67 % along. Rings land ON them. */
export const T_TWIST_01 = T_ELBOW + 0.33 * LEN_FOREARM;
export const T_TWIST_02 = T_ELBOW + 0.67 * LEN_FOREARM;

const elbowLoops = loopOffsets(r('elbow'));
const wristLoops = [-0.35 * r('wrist'), 0, 0.35 * r('wrist')] as const;
const shoulderLoops = loopOffsets(r('upperarmMid'));

const ARM_PROFILE: readonly Row[] = [
  [-0.0240, 0.0270, 0.0270], // cap, inside the torso shell
  [0.0000 + shoulderLoops[0]!, 0.0322, 0.0330],
  [0.0000, 0.0330, 0.0338],
  [0.0000 + shoulderLoops[2]!, 0.0332, 0.0340],
  [0.0300, 0.0322, 0.0328], // §5.2 deltoid cap ring
  [0.0560, 0.0300, 0.0302],
  [0.0900, r('upperarmMid'), r('upperarmMid')],
  [0.1250, 0.0278, 0.0278],
  [T_ELBOW + elbowLoops[0]!, 0.0268, 0.0268], // LOOP
  [T_ELBOW, r('elbow'), r('elbow')], //            LOOP (joint centre)
  [T_ELBOW + elbowLoops[2]!, 0.0262, 0.0262], // LOOP
  [T_ELBOW + elbowLoops[3]!, 0.0258, 0.0258], // LOOP
  [0.1950, r('forearmMax'), r('forearmMax')],
  [T_TWIST_01, 0.0250, 0.0250], //                 twist station 01
  [0.2320, 0.0242, 0.0242],
  [0.2470, 0.0228, 0.0228],
  [T_TWIST_02, 0.0212, 0.0212], //                 twist station 02
  [0.2830, 0.0196, 0.0196],
  [0.3000, 0.0178, 0.0178],
  [T_WRIST + wristLoops[0]!, 0.0166, 0.0166], // LOOP
  [T_WRIST, r('wrist'), r('wrist')], //            LOOP (joint centre)
  [T_WRIST + wristLoops[2]!, 0.0210, 0.0158], // LOOP — the palm widens, thins
  [0.3400, 0.0242, 0.0152],
  [0.3658, 0.0250, 0.0148], // MCP
  [0.3958, 0.0234, 0.0134],
  [0.4160, 0.0198, 0.0114],
  [0.4253, 0.0090, 0.0062], // dactylion, capped
];

const kneeLoops = loopOffsets(r('knee'));
const ankleLoops = loopOffsets(r('ankle'));

/** Leg, `t` = world height in FracH down to the AJC. `ex = +X` (lateral), `ey = +Z` (posterior). */
const LEG_PROFILE: readonly Row[] = [
  [0.5480, 0.0470, 0.0490], // cap, inside the torso shell
  [0.5308, 0.0530, 0.0560],
  [0.5133, 0.0520, 0.0550],
  [0.4800, r('thighMid'), 0.0520],
  [0.4200, 0.0490, 0.0500],
  [0.3600, 0.0430, 0.0450],
  [0.3200, 0.0375, 0.0400],
  [0.2883 + kneeLoops[2]!, 0.0350, 0.0378], // LOOP (proximal of the knee = higher)
  [0.2883, r('knee'), 0.0355], //              LOOP (joint centre)
  [0.2883 - kneeLoops[2]!, 0.0340, 0.0372], // LOOP
  [0.2883 - kneeLoops[3]!, 0.0345, 0.0384], // LOOP
  [0.2135, r('calfMax'), 0.0375],
  [0.1600, 0.0290, 0.0330],
  [0.1100, 0.0245, 0.0275],
  [0.0700, 0.0212, 0.0232],
  [0.0390 + ankleLoops[2]!, 0.0198, 0.0218], // LOOP
  [0.0390, r('ankle'), 0.0215], //             LOOP (AJC)
];

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. PROFILE RESAMPLING
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Linear resample of a monotone profile onto `count` rows, keeping the first and last exactly. */
function resample(rows: readonly Row[], count: number): Row[] {
  const t0 = rows[0]![0];
  const t1 = rows[rows.length - 1]![0];
  const out: Row[] = [];
  for (let k = 0; k < count; k++) {
    const t = t0 + ((t1 - t0) * k) / (count - 1);
    out.push([t, ...interp(rows, t)] as unknown as Row);
  }
  return out;
}

function interp(rows: readonly Row[], t: number): [number, number] {
  const asc = rows[rows.length - 1]![0] > rows[0]![0];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    const inside = asc ? t >= a[0] && t <= b[0] : t <= a[0] && t >= b[0];
    if (inside) {
      const span = b[0] - a[0];
      const u = span === 0 ? 0 : (t - a[0]) / span;
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  }
  const last = rows[rows.length - 1]!;
  return [last[1], last[2]];
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. RADIAL MODULATIONS — the few places an ellipse is not enough.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** `ey` points toward the character's FACE on the head sweep, so `theta = pi/2` is dead ahead. */
const FRONT = Math.PI / 2;
const angDist = (a: number, b: number): number => {
  const d = Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return d;
};

/** Nose ridge + brow, so the profile silhouette is not a bare egg. Amplitudes in FracH. */
function faceMod(tH: number): ((th: number) => number) | null {
  const nose = Math.exp(-Math.pow((tH - 0.9300) / 0.0125, 2)) * 0.030;
  const brow = Math.exp(-Math.pow((tH - 0.9560) / 0.0090, 2)) * 0.012;
  const chin = Math.exp(-Math.pow((tH - 0.9060) / 0.0110, 2)) * 0.010;
  if (nose + brow + chin < 1e-4) return null;
  return (th: number) => {
    const dFront = angDist(th, FRONT);
    const noseLobe = Math.exp(-Math.pow(dFront / 0.30, 2));
    const browLobe = Math.exp(-Math.pow(dFront / 0.95, 2));
    return 1 + nose * noseLobe + brow * browLobe + chin * noseLobe * 0.8;
  };
}

/**
 * Heel. The foot sweep runs forward along `-Z`, so the heel is BEHIND the ankle: push the
 * posterior half of the ankle-region rings out. `ey` is downward there, so posterior is `-ex`?
 * No — `ex = +X` throughout the leg, and the posterior direction is the sweep's own `-axis`, which
 * a radial modulation cannot reach. The heel is therefore built as extra RINGS behind the ankle
 * (see `legRings`), not as a modulation.
 */

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE BUILD
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface BodyGeometry {
  readonly geometry: BufferGeometry;
  /** Per-vertex `LimbGroup` ordinal. Consumed by `computeSkinWeights`'s §5.3 step-2 gate. */
  readonly group: Uint8Array;
}

export const LIMB_GROUP_ORDER: readonly LimbGroup[] = [
  'trunk',
  'head',
  'arm_L',
  'arm_R',
  'leg_L',
  'leg_R',
];
const gid = (g: LimbGroup): number => LIMB_GROUP_ORDER.indexOf(g);

const TORSO_SEGS = 32;
const HEAD_SEGS = 24;
const ARM_SEGS = 20;
const LEG_SEGS = 24;
const THUMB_SEGS = 8;

const TORSO_RINGS = 16;
const HEAD_RINGS = 20;

const UP_Y = new Vector3(0, 1, 0);
const DOWN_Y = new Vector3(0, -1, 0);
const EX_X = new Vector3(1, 0, 0);
const EX_Z = new Vector3(0, 0, 1);

/** Cumulative arc length, for the metre-valued UV `v`. */
function pathV(rows: readonly { readonly c: Vector3 }[], i: number, cache: number[]): number {
  if (cache.length > i) return cache[i]!;
  for (let k = cache.length; k <= i; k++) {
    cache[k] = k === 0 ? 0 : cache[k - 1]! + rows[k]!.c.distanceTo(rows[k - 1]!.c);
  }
  return cache[i]!;
}

function buildTorso(acc: GeomAccum): void {
  const rows = resample(TORSO_PROFILE, TORSO_RINGS);
  const centres = rows.map((row) => ({ c: new Vector3(0, row[0] * H, 0) }));
  const cache: number[] = [];
  const rings = rows.map((row, i) =>
    ringFrame(
      centres[i]!.c,
      UP_Y,
      EX_X,
      row[1] * H,
      row[2] * H,
      pathV(centres, i, cache),
      { n: 2.35 },
    ),
  );
  acc.addSweep(rings, TORSO_SEGS, gid('trunk'), { capStart: true, capEnd: true });
}

function buildHeadNeck(acc: GeomAccum, headZ: number): void {
  const keys: Row[] = HEADNECK_PROFILE.map((k) => [k[0], k[1], k[2]] as Row);
  const zByT = (t: number): number => {
    for (let i = 0; i + 1 < HEADNECK_PROFILE.length; i++) {
      const a = HEADNECK_PROFILE[i]!;
      const b = HEADNECK_PROFILE[i + 1]!;
      if (t >= a[0] && t <= b[0]) {
        const u = (t - a[0]) / (b[0] - a[0] || 1);
        return a[3] + (b[3] - a[3]) * u;
      }
    }
    return HEADNECK_PROFILE[HEADNECK_PROFILE.length - 1]![3];
  };
  const rows = resample(keys, HEAD_RINGS);
  const centres = rows.map((row) => ({
    c: new Vector3(0, row[0] * H, (headZ + zByT(row[0])) * H),
  }));
  const cache: number[] = [];
  const rings = rows.map((row, i) =>
    ringFrame(centres[i]!.c, UP_Y, EX_X, row[1] * H, row[2] * H, pathV(centres, i, cache), {
      mod: faceMod(row[0]),
    }),
  );
  // Both caps. The crown ring is only 2.8 mm across and the hair mesh sits over it, but an OPEN
  // shell is not watertight — and §5.5's shadow caster and the `M_MASK` silhouette pass of metric 60
  // both read this geometry, where a hole shows up as a hard-edged notch rather than as an error.
  acc.addSweep(rings, HEAD_SEGS, gid('head'), { capStart: true, capEnd: true });
}

function buildArm(acc: GeomAccum, sjc: Vector3, dirX: number, group: LimbGroup): void {
  const axis = new Vector3(dirX, 0, 0);
  const centres = ARM_PROFILE.map((row) => ({
    c: new Vector3(sjc.x + dirX * row[0] * H, sjc.y, sjc.z),
  }));
  const cache: number[] = [];
  const rings = ARM_PROFILE.map((row, i) =>
    ringFrame(centres[i]!.c, axis, EX_Z, row[1] * H, row[2] * H, pathV(centres, i, cache), {
      n: row[0] > 0.32 ? 3.0 : 2.0, // the palm is a rounded slab, not an ellipse
    }),
  );
  acc.addSweep(rings, ARM_SEGS, gid(group), { capStart: true, capEnd: true });

  // Thumb: a short tube off the radial side of the palm, T-pose palm facing -Y.
  const wrist = new Vector3(sjc.x + dirX * T_WRIST * H, sjc.y, sjc.z);
  const thumbBase = new Vector3(
    wrist.x + dirX * 0.015 * H,
    wrist.y - 0.0042 * H,
    wrist.z - 0.019 * H,
  );
  const thumbTip = new Vector3(
    wrist.x + dirX * 0.048 * H,
    wrist.y - 0.006 * H,
    wrist.z - 0.030 * H,
  );
  const thAxis = thumbTip.clone().sub(thumbBase).normalize();
  const thRadii = [0.0100, 0.0105, 0.0098, 0.0085, 0.0060, 0.0022];
  const thCentres = thRadii.map((_, i) => ({
    c: thumbBase.clone().lerp(thumbTip, i / (thRadii.length - 1)),
  }));
  const thCache: number[] = [];
  const thRings = thRadii.map((rad, i) =>
    ringFrame(
      thCentres[i]!.c,
      thAxis,
      EX_Z,
      rad * H,
      rad * H,
      pathV(thCentres, i, thCache),
      undefined,
    ),
  );
  acc.addSweep(thRings, THUMB_SEGS, gid(group), { capStart: true, capEnd: true });
}

function buildLeg(acc: GeomAccum, hjc: Vector3, group: LimbGroup): void {
  const ajcY = LEG_PROFILE[LEG_PROFILE.length - 1]![0];
  const ankleZ = hjc.z;

  interface Node {
    readonly c: Vector3;
    readonly ra: number;
    readonly rb: number;
    readonly n: number;
    readonly flatSole: boolean;
  }
  const nodes: Node[] = LEG_PROFILE.map((row) => ({
    c: new Vector3(hjc.x, row[0] * H, ankleZ),
    ra: row[1] * H,
    rb: row[2] * H,
    n: 2,
    flatSole: false,
  }));

  // Heel + foot: the sweep turns from -Y to -Z over the ankle. Cross-sections become flat-bottomed
  // rounded slabs (superellipse n = 3.4) and the heel is the first two forward rings sitting BEHIND
  // the AJC, which is what gives a real heel rather than a tapered stump.
  const foot: readonly (readonly [dz: number, y: number, ra: number, rb: number])[] = [
    [+0.0415, 0.0300, 0.0230, 0.0300], // heel, behind the AJC (doc 06 §4.2 HEEL_OFFSET_H)
    [+0.0180, 0.0280, 0.0250, 0.0280],
    [-0.0100, 0.0250, 0.0265, 0.0250],
    [-0.0400, 0.0210, 0.0272, 0.0210],
    [-0.0697, 0.0175, 0.0275, 0.0175], // MTP / ball
    [-0.0900, 0.0140, 0.0255, 0.0140],
    [-0.1090, 0.0090, 0.0180, 0.0090], // toe tip
  ];
  for (const [dz, y, ra, rb] of foot) {
    nodes.push({
      c: new Vector3(hjc.x, y * H, ankleZ + dz * H),
      ra: ra * H,
      rb: rb * H,
      n: 3.4,
      flatSole: true,
    });
  }
  void ajcY;

  const cache: number[] = [];
  const rings: Ring[] = nodes.map((nd, i) => {
    const prev = nodes[Math.max(0, i - 1)]!;
    const next = nodes[Math.min(nodes.length - 1, i + 1)]!;
    const axis = next.c.clone().sub(prev.c);
    if (axis.lengthSq() < 1e-12) axis.copy(DOWN_Y);
    return ringFrame(nd.c, axis, EX_X, nd.ra, nd.rb, pathV(nodes, i, cache), {
      n: nd.n,
      // `ey` runs downward once the sweep has turned forward, so the sole is the +ey extreme:
      // clamping it at the ring centre's own height puts the sole exactly on `y = 0`.
      clampEyMax: nd.flatSole ? nd.c.y : null,
    });
  });
  acc.addSweep(rings, LEG_SEGS, gid(group), { capStart: true, capEnd: true });
}

/** doc 06 §5.1 approach (C). Positions are T-POSE; `karateka.ts` rebakes them to the A-pose bind. */
export function buildBodyGeometry(sk: SkeletonBuild): BodyGeometry {
  const acc = new GeomAccum();
  const j = (name: 'chest' | 'head' | 'upperarm_L' | 'upperarm_R' | 'thigh_L' | 'thigh_R') => {
    const b = sk.byName[name];
    return new Vector3().setFromMatrixPosition(b.matrixWorld);
  };

  buildTorso(acc);
  buildHeadNeck(acc, j('head').z / H);
  buildArm(acc, j('upperarm_L'), Math.sign(j('upperarm_L').x), 'arm_L');
  buildArm(acc, j('upperarm_R'), Math.sign(j('upperarm_R').x), 'arm_R');
  buildLeg(acc, j('thigh_L'), 'leg_L');
  buildLeg(acc, j('thigh_R'), 'leg_R');

  return { geometry: acc.toGeometry(), group: new Uint8Array(acc.group) };
}
