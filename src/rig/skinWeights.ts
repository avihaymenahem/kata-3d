/**
 * B4 RIG — `src/rig/skinWeights.ts`
 *
 * `computeSkinWeights`: doc 06 §5.3's seven steps, verbatim in structure, computed in **T-pose**
 * (§4.1 G2 — the distance field is cleanest there, with the arm maximally clear of the ribs), plus
 * §5.4 Fix 1's twist banding and Fix 3's four shoulder mitigations.
 *
 * ═══ THE THREE PLACES THIS FILE DEPARTS FROM §5.3, AND THE ARITHMETIC FOR EACH ══════════
 *
 * (1) THE GLOW RADIUS IS CAPPED BY THE BONE'S OWN SEGMENT LENGTH.
 * §5.3 step 3 sets `R_b = kappa * r_b` with `kappa = 2.6` and defends it with "a blend band
 * ~1.3 x r_b wide, i.e. ~7.7 cm at the knee — about 3 edge loops". That holds for a bone whose LENGTH
 * is several times its radius; `pelvis` has `r = 0.0955 H = 16.7 cm`, so `kappa*r = 43.4 cm` and the
 * pelvis would glow past the chest, turning the whole trunk into one blob with a rubber spine. So
 *     `R_b = max(1.15 * r_b, min(kappa * r_b, 1.35 * L_b))`.
 * At the knee `kappa*r = 15.3 cm` and `1.35*L = 32.7 cm`, so the cap never binds and §5.3's own
 * numbers ship unchanged wherever they were already consistent.
 *
 * (2) A BONE MAY NOT GLOW MORE THAN `crossJointFrac` OF ITS OWN LENGTH PAST ITS SEGMENT'S ENDS.
 * §5.3 step 3 warns that `p = 2` "bleeds across joints (a knee vertex gets non-zero weight from the
 * hip)"; `p = 3` reduces that but `kappa * r` is still an ISOTROPIC radius. Measured: `upperarm`
 * (`r = 5.1 cm`) glowed 13.2 cm past the elbow — half way down the forearm — and put 9.5 % of an
 * UNTWISTED frame onto the ring at 33 % of the forearm, which cost metric 62 four points for no gain
 * in elbow flexion (the flex blend lives in the first 3 cm). The cap is re-asserted AFTER smoothing,
 * because five 1-ring Laplacian iterations carry weight ~5 loops further on their own.
 *
 * (3) THE TWIST CHAINS PARTITION AXIALLY, NOT BY 3-D DISTANCE.
 * A twist band is a band in ONE dimension, but a point-to-segment distance mixes the axial offset
 * with the radial one — and on the forearm the radial term (4.5 cm) is comparable to the station
 * spacing (8.9 cm), so a distance field CANNOT separate two twist stations at all: measured, it put
 * 55/45 weights on a ring 3 cm from the elbow. So each chain's CARRIER (`lowerarm`, `upperarm`,
 * `thigh`, `calf`) keeps one ordinary distance field — which is what makes the elbow / knee / wrist /
 * ankle blends exactly §5.3's — and its weight is then SPLIT among the chain's frames by a 1-D
 * partition of unity in the axial coordinate alone (step 6c). `deltoid_*` and every `*_twist*` bone
 * has no distance field of its own; it exists only as a band.
 *
 * ═══ CANDY-WRAPPER: WHAT IS ACHIEVABLE, STATED HONESTLY ═════════════════════════════
 *
 * LBS puts a vertex blended `w`/`1-w` between two frames that differ by a twist `theta` about the
 * shared axis at radius `r * |w + (1-w) e^{i theta}|`. At `w = 0.5` that is `r * cos(theta/2)`. With
 * four frames spanning a 180° forearm roll (`lowerarm`, `twist_01`, `twist_02`, `hand`) the
 * adjacent-frame step is at BEST `180/3 = 60°` — doc 06 §5.4's normative 0.33/0.67 IS that minimax —
 * so **`cos(30°) = 0.866` is a hard floor** for the worst point of any C0 partition of unity.
 * doc 06 §5.4's claim that rigidify takes 2 twist bones to "30°, 3.4 % — invisible" does not follow:
 * narrowing a blend band does not reduce the twist ACROSS it, and §Uncertainties 9 concedes the table
 * is an upper bound.
 *
 * What the axial partition buys is to put every crossing strictly BETWEEN edge loops, so no VERTEX
 * ever sits near a 50/50 blend: measured, every forearm ring from 21 % to 90 % holds a single frame at
 * weight 1.000 and therefore full radius through the whole 180° roll. The residual 60° step is
 * absorbed inside one ~1.5 cm quad on a deliberately CIRCULAR cross-section, where it costs no
 * silhouette and no vertex normal — only a sub-centimetre texture shear. The wrist keeps a real blend
 * (it must: the wrist FLEXES) and so keeps a real ~0.91 dip. `tests/rig/candywrapper.test.ts` measures
 * ring retention AND interpolated-surface retention, against three controls, so all of that is a
 * measurement rather than a claim.
 */

import type { BufferGeometry } from 'three';
import { Vector3 } from 'three';
import {
  BONE_COUNT,
  BONE_ORDER,
  boneIndex,
  H,
  type BoneName,
} from '../contracts';
import { LIMB_R, MESH_LOOPS } from '../data';
import {
  BONES_OF_GROUP,
  BUILT_PRIMARY_AXIS,
  GROUP_ALLOW,
  LIMB_GROUP,
  readVec3,
  SEGMENT_TOWARD,
  type LimbGroup,
  type SkeletonBuild,
} from './bones';
import { LIMB_GROUP_ORDER } from './bodyMesh';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. TUNING — every value traced to doc 06 via B1's `MESH_LOOPS`, plus the two named departures.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const WEIGHT_PARAMS = Object.freeze({
  kappa: MESH_LOOPS.weightKappa.v, //           §5.3 step 3
  exponent: MESH_LOOPS.weightExponent.v, //     §5.3 step 3
  maxInfluences: MESH_LOOPS.maxInfluences.v, // §5.3 step 4 / §4.4 (three.js hard limit)
  smoothLambda: MESH_LOOPS.weightSmoothLambda.v, // §5.3 step 6
  smoothIters: MESH_LOOPS.weightSmoothIters.v, //   §5.3 step 6
  rigidifyFracR: MESH_LOOPS.rigidifyFracR.v, //     §5.3 step 7
  /** §5.3 step 2's cheap surface-facing half of the visibility gate. */
  facingGate: 0.25,
  /** Departure (1) in the header: the glow radius is capped by the bone's own segment length. */
  bandCap: 1.35,
  minGlowFracR: 1.15,
  /**
   * How far past its own segment's ends a bone's glow may reach, as a fraction of its own length.
   * See the `overshoot` guard in `computeSkinWeights` for the measurement that fixes this number.
   */
  crossJointFrac: 0.15,
  /**
   * §5.4 Fix 1: HALF-width of each twist-band crossing, as a fraction of the carrier bone. The
   * forearm's crossings sit at 0.165 and 0.500 and its edge loops at 0.119 / 0.215 / 0.454 / 0.551,
   * so 0.035 keeps every crossing strictly BETWEEN loops — which is what "the blend band is only 1
   * loop wide" has to mean if it is to mean anything.
   */
  twistBlendFrac: 0.035,
  /** §5.4 Fix 3d: `upperarm` may never touch a vertex medial to the shoulder ring. */
  armMedialCutoffH: 0.062,
  /**
   * §5.3 step 2, the OTHER half of the same defect. A sided bone may not reach across the
   * mid-sagittal plane by more than this. Measured: `clavicle_L`'s segment starts at the STERNUM
   * (`SC_JOINT_X = 0.011 H`) and its glow radius is 0.132 m, so without this gate it reached the
   * RIGHT shoulder — the same "medial forearm to the ribs" failure §5.3 names, one joint up. The
   * arm band is deliberately small (2.1 cm, enough for a smooth sternum blend); the leg band is
   * larger because the crotch gusset legitimately blends BOTH thighs, and forbidding that tears the
   * pelvis open at doc 06 §3.1's 125° of hip flexion.
   */
  midlineBandArmH: 0.012,
  midlineBandLegH: 0.045,
  /** How much of the chest/spine_03 weight the childless `ribcage` takes over (§2.8, breath). */
  ribcageShare: 0.55,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. TWIST BANDS (doc 06 §5.4 Fix 1 + Fix 3b)
 *
 * `from`/`to` are fractions along the CARRIER bone's own segment. The bands are Voronoi-like about
 * each station's twist fraction so a station sits in the MIDDLE of the band it owns — the ring at
 * the station is then rigid, and the crossing lands between rings.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface TwistBand {
  readonly bone: BoneName;
  /** Where this frame's STATION sits along the carrier, 0..1. Drives the glow-radius cap. */
  readonly at: number;
  /** The axial band this frame OWNS for skinning, 0..1 along the carrier. */
  readonly from: number;
  readonly to: number;
  /** Fraction of the chain's total roll this frame carries. For the test and for B3's S10. */
  readonly twistFrac: number;
}

export interface TwistChainBands {
  readonly carrier: BoneName;
  readonly toward: BoneName;
  readonly bands: readonly TwistBand[];
  /**
   * Every station along the chain, INCLUDING the terminator's — the terminator (`hand`, `foot`) keeps
   * its own child segment rather than a band, but it is still a frame the surface blends toward, so
   * it must be counted when sizing the blend width.
   */
  readonly stations: readonly number[];
}

const chainBands = (h: 'L' | 'R'): readonly TwistChainBands[] => [
  {
    // Forearm pronation. doc 06 §5.4's normative 0.33 / 0.67 IS the 4-frame minimax: with `lowerarm`
    // at 0 and `hand` at 1, equal spacing gives the smallest possible adjacent step (60° of a 180°
    // roll), and every other split makes some step larger.
    //
    // `hand` deliberately does NOT get a band: it keeps its own wrist->MCP segment so the PALM is
    // owned by the wrist bone. Banding it to the distal forearm sliver instead handed the palm to
    // `fingers_prox`, and a seiken fist would then have bent the palm along with the fingers.
    carrier: `lowerarm_${h}` as BoneName,
    toward: `hand_${h}` as BoneName,
    stations: [0, 0.33, 0.67, 1.0],
    bands: [
      { bone: `lowerarm_${h}` as BoneName, at: 0, from: 0.0, to: 0.165, twistFrac: 0.0 },
      {
        bone: `lowerarm_twist_01_${h}` as BoneName,
        at: 0.33,
        from: 0.165,
        to: 0.5,
        twistFrac: 0.33,
      },
      {
        bone: `lowerarm_twist_02_${h}` as BoneName,
        at: 0.67,
        from: 0.5,
        to: 1.0,
        twistFrac: 0.67,
      },
    ],
  },
  {
    // Humeral rotation. `deltoid` owns the cap ring (§5.4 Fix 3b: weight it 0.75-1.0 to deltoid);
    // `upperarm_twist` is at 20 % along and carries 0.5x the upperarm roll, so it owns the
    // PROXIMAL band — the distal band rides the upperarm's full roll.
    carrier: `upperarm_${h}` as BoneName,
    toward: `lowerarm_${h}` as BoneName,
    stations: [0.11, 0.34, 0.73],
    bands: [
      { bone: `deltoid_${h}` as BoneName, at: 0.11, from: 0.0, to: 0.22, twistFrac: 0.25 },
      {
        bone: `upperarm_twist_${h}` as BoneName,
        at: 0.34,
        from: 0.22,
        to: 0.46,
        twistFrac: 0.5,
      },
      { bone: `upperarm_${h}` as BoneName, at: 0.73, from: 0.46, to: 1.0, twistFrac: 1.0 },
    ],
  },
  {
    carrier: `thigh_${h}` as BoneName,
    toward: `calf_${h}` as BoneName,
    stations: [0.21, 0.71],
    bands: [
      { bone: `thigh_twist_${h}` as BoneName, at: 0.21, from: 0.0, to: 0.42, twistFrac: 0.5 },
      { bone: `thigh_${h}` as BoneName, at: 0.71, from: 0.42, to: 1.0, twistFrac: 1.0 },
    ],
  },
  {
    // Foot yaw travels UP the shank, so the distal band is the twisted one.
    carrier: `calf_${h}` as BoneName,
    toward: `foot_${h}` as BoneName,
    stations: [0.31, 0.81, 1.0],
    bands: [
      { bone: `calf_${h}` as BoneName, at: 0.31, from: 0.0, to: 0.62, twistFrac: 0.0 },
      { bone: `calf_twist_${h}` as BoneName, at: 0.81, from: 0.62, to: 1.0, twistFrac: 0.5 },
    ],
  },
];

export const TWIST_BANDS: readonly TwistChainBands[] = Object.freeze([
  ...chainBands('L'),
  ...chainBands('R'),
]);

/**
 * Bones that exist ONLY as a twist band — `deltoid_*` and every `*_twist*`. They get no distance
 * field of their own: they receive their weight by SPLITTING their carrier's (see `applyTwistSplit`).
 */
const SPLIT_ONLY = new Set<BoneName>(
  TWIST_BANDS.flatMap((c) => c.bands.filter((b) => b.bone !== c.carrier).map((b) => b.bone)),
);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. BIND-POSE SEGMENTS (doc 06 §5.3 step 1 — the SEGMENT, never the infinite line)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface BindSegments {
  /** `BONE_COUNT*3` each, T-pose world metres. */
  readonly a: Float64Array;
  readonly b: Float64Array;
  /** Glow radius per bone, metres. */
  readonly glow: Float64Array;
  /** Mesh radius per bone, metres. */
  readonly radius: Float64Array;
  /** Segment length per bone, metres. Caps the cross-joint axial overshoot. */
  readonly length: Float64Array;
}

export function bindSegments(sk: SkeletonBuild): BindSegments {
  const a = new Float64Array(BONE_COUNT * 3);
  const b = new Float64Array(BONE_COUNT * 3);
  const glow = new Float64Array(BONE_COUNT);
  const radius = new Float64Array(BONE_COUNT);
  const length = new Float64Array(BONE_COUNT);
  const pA = new Vector3();
  const pB = new Vector3();
  const axis = new Vector3();

  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONE_ORDER[i]!;
    const rBone = LIMB_R[name]!.v * H;
    radius[i] = rBone;

    readVec3(sk.tposeJoint, i, pA);
    const toward = SEGMENT_TOWARD[name];
    if (toward !== null) {
      readVec3(sk.tposeJoint, boneIndex(toward), pB);
    } else {
      readVec3(BUILT_PRIMARY_AXIS, i, axis);
      pB.copy(pA).addScaledVector(axis, 0.5 * rBone);
    }

    a[i * 3] = pA.x;
    a[i * 3 + 1] = pA.y;
    a[i * 3 + 2] = pA.z;
    b[i * 3] = pB.x;
    b[i * 3 + 1] = pB.y;
    b[i * 3 + 2] = pB.z;

    length[i] = pA.distanceTo(pB);
    const cap = WEIGHT_PARAMS.bandCap * length[i]!;
    glow[i] = Math.max(
      WEIGHT_PARAMS.minGlowFracR * rBone,
      Math.min(WEIGHT_PARAMS.kappa * rBone, cap),
    );
  }
  return { a, b, glow, radius, length };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. THE SOLVER
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface SkinWeights {
  /** `vertexCount*4`. */
  readonly skinIndex: Uint16Array;
  readonly skinWeight: Float32Array;
  /** Diagnostics the tests read. */
  readonly stats: {
    readonly vertexCount: number;
    readonly meanInfluences: number;
    readonly rigidified: number;
    readonly twistSplit: number;
  };
}

/**
 * Nearest point on segment `[A,B]` to `p`, the clamped parametric `t`, and the AXIAL OVERSHOOT past
 * either end in metres (doc 06 §5.3 step 1 — the SEGMENT, never the infinite line).
 */
function segDistance(
  p: Vector3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  out: Vector3,
): { d: number; t: number; overshoot: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const den = dx * dx + dy * dy + dz * dz;
  const len = Math.sqrt(den);
  const raw = den < 1e-16 ? 0 : ((p.x - ax) * dx + (p.y - ay) * dy + (p.z - az) * dz) / den;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  out.set(ax + dx * t, ay + dy * t, az + dz * t);
  const overshoot = raw < 0 ? -raw * len : raw > 1 ? (raw - 1) * len : 0;
  return { d: out.distanceTo(p), t, overshoot };
}

const smoothstep01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** 1-ring adjacency from the index buffer, for §5.3 step 6. */
function oneRing(index: ArrayLike<number>, vertexCount: number): readonly number[][] {
  const adj: number[][] = Array.from({ length: vertexCount }, () => []);
  const seen = new Set<number>();
  for (let f = 0; f < index.length; f += 3) {
    const t = [index[f]!, index[f + 1]!, index[f + 2]!];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        if (i === k) continue;
        const key = t[i]! * vertexCount + t[k]!;
        if (seen.has(key)) continue;
        seen.add(key);
        adj[t[i]!]!.push(t[k]!);
      }
    }
  }
  return adj;
}

const shoulderRingHalfWidth = (): number => WEIGHT_PARAMS.armMedialCutoffH * H;

/**
 * §5.3 step 2's midline gate, as a smooth CROSS-FADE rather than a hard reject: `1` on the bone's own
 * side, `0.5` on the mid-sagittal plane, `0` once the vertex is more than `band` onto the far side.
 *
 * It has to be smooth because `clavicle_*`'s skinning segment STARTS at the sternum
 * (`SC_JOINT_X = 0.011 H`), so a hard cut there would put a weight discontinuity — i.e. a crease in
 * the skin — exactly where the gi's collar meets the chest. It has to exist at all because
 * `clavicle_L`'s glow radius is 0.132 m from an origin 0.019 m off the midline, so without it the
 * left clavicle reached the RIGHT shoulder: the same defect as "the medial forearm to the ribs", one
 * joint up.
 */
function midlineFadeOf(name: BoneName, x: number): number {
  const side = name.endsWith('_L') ? -1 : name.endsWith('_R') ? 1 : 0;
  if (side === 0) return 1;
  const g = LIMB_GROUP[name];
  const band =
    (g === 'leg_L' || g === 'leg_R'
      ? WEIGHT_PARAMS.midlineBandLegH
      : WEIGHT_PARAMS.midlineBandArmH) * H;
  const t = (side * x + band) / (2 * band);
  return t <= 0 ? 0 : t < 1 ? t : 1;
}

export function computeSkinWeights(
  geometry: BufferGeometry,
  group: Uint8Array,
  sk: SkeletonBuild,
  seg: BindSegments,
): SkinWeights {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const index = geometry.getIndex()!.array;
  const n = pos.count;
  const K = WEIGHT_PARAMS.maxInfluences;

  const wRow = new Float64Array(BONE_COUNT);
  const dRow = new Float64Array(BONE_COUNT);

  const idxOut = new Uint16Array(n * K);
  const wOut = new Float32Array(n * K);

  const p = new Vector3();
  const vn = new Vector3();
  const cp = new Vector3();
  const dir = new Vector3();

  const groupBones: readonly number[][] = LIMB_GROUP_ORDER.map((g) =>
    GROUP_ALLOW[g].flatMap((allowed) => BONES_OF_GROUP[allowed]),
  );

  const chestI = boneIndex('chest');
  const spine02I = boneIndex('spine_02');
  const spine03I = boneIndex('spine_03');
  const ribcageI = boneIndex('ribcage');
  /**
   * §2.8: `ribcage` "carries the ribcage / upper-abdomen skin weights". The band runs from just below
   * spine_02 (the lower ribs / upper abdomen) to just above `chest` (the sternum). `ribcage` is
   * EXCLUDED from the ordinary falloff below and gets weight only from the explicit donation pass at
   * the end of this function — because its own segment is a leaf stub whose glow radius reaches the
   * jaw, and `GROUP_ALLOW.head` permits trunk bones, so the natural falloff put measurable ribcage
   * weight on the top of the SKULL. Breath would then have inflated the head.
   */
  const ribBandLo = sk.tposeJoint[spine02I * 3 + 1]! - 0.010 * H;
  const ribBandHi = sk.tposeJoint[chestI * 3 + 1]! + 0.045 * H;

  let rigidified = 0;
  let twistSplit = 0;
  let influenceSum = 0;

  /* ── steps 1-5, per vertex ────────────────────────────────────────────────────────────── */
  for (let v = 0; v < n; v++) {
    p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
    vn.set(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    const g = group[v]!;
    wRow.fill(0);
    dRow.fill(Number.POSITIVE_INFINITY);

    for (const bi of groupBones[g]!) {
      const name = BONE_ORDER[bi]!;
      // `ribcage` is band-donated, never distance-fielded. See `ribBandLo`'s comment.
      if (bi === ribcageI) continue;
      // Twist stations and the deltoid helper get their weight by splitting their CARRIER's, in
      // step 6c — a distance field of their own cannot separate stations 8.9 cm apart on a limb
      // 4.5 cm in radius.
      if (SPLIT_ONLY.has(name)) continue;
      const { d, overshoot } = segDistance(
        p,
        seg.a[bi * 3]!,
        seg.a[bi * 3 + 1]!,
        seg.a[bi * 3 + 2]!,
        seg.b[bi * 3]!,
        seg.b[bi * 3 + 1]!,
        seg.b[bi * 3 + 2]!,
        cp,
      );
      dRow[bi] = d;

      const R = seg.glow[bi]!;
      if (d >= R) continue;
      /**
       * §5.3 step 3 warns that `p = 2` "bleeds across joints (a knee vertex gets non-zero weight from
       * the hip)". `p = 3` reduces it but does not remove it, and `kappa * r` is an ISOTROPIC radius:
       * the upperarm's `r = 0.0509 m` gives a 0.132 m glow, which reaches 0.132 m past the elbow —
       * halfway down the forearm. Measured: that put ~5 % of an untwisted `upperarm` frame onto the
       * mid-forearm and dropped metric 62 from 1.000 to 0.948, for no benefit to elbow flexion (the
       * flex blend lives in the first 3 cm, well inside the cap).
       */
      if (overshoot > WEIGHT_PARAMS.crossJointFrac * seg.length[bi]!) continue;

      // §5.3 step 2, the cheap half: if the closest skeleton point lies on the OUTSIDE of the
      // surface at `v`, the bone is not visible from `v` and must not pull on it.
      dir.copy(cp).sub(p);
      const dl = dir.length();
      if (dl > 1e-9 && dir.divideScalar(dl).dot(vn) > WEIGHT_PARAMS.facingGate) continue;

      // §5.4 Fix 3d: no arm bone may ever touch a vertex medial to the shoulder ring.
      if (/^(upperarm|deltoid|lowerarm|hand|fingers|thumb)/.test(name)) {
        if (Math.abs(p.x) < shoulderRingHalfWidth()) continue;
      }
      // §5.3 step 2: a sided bone may not reach across the midline (see `midlineFadeOf`).
      const fade = midlineFadeOf(name, p.x);
      if (fade <= 0) continue;

      wRow[bi] = Math.pow((R - d) / R, WEIGHT_PARAMS.exponent) * fade;
    }

    writeTopK(wRow, dRow, idxOut, wOut, v, K);
  }

  /* ── step 6: Laplacian weight smoothing, 5 iterations, lambda 0.35 ───────────────────── */
  const adj = oneRing(index, n);
  for (let it = 0; it < WEIGHT_PARAMS.smoothIters; it++) {
    const nextIdx = new Uint16Array(idxOut.length);
    const nextW = new Float32Array(wOut.length);
    for (let v = 0; v < n; v++) {
      wRow.fill(0);
      for (let k = 0; k < K; k++) wRow[idxOut[v * K + k]!]! += wOut[v * K + k]!;
      const nb = adj[v]!;
      if (nb.length > 0) {
        const lam = WEIGHT_PARAMS.smoothLambda;
        for (let bi = 0; bi < BONE_COUNT; bi++) wRow[bi] = (1 - lam) * wRow[bi]!;
        const share = WEIGHT_PARAMS.smoothLambda / nb.length;
        for (const u of nb) {
          for (let k = 0; k < K; k++) wRow[idxOut[u * K + k]!]! += share * wOut[u * K + k]!;
        }
      }
      dRow.fill(Number.POSITIVE_INFINITY);
      for (let bi = 0; bi < BONE_COUNT; bi++) if (wRow[bi]! > 0) dRow[bi] = 1 - wRow[bi]!;
      writeTopK(wRow, dRow, nextIdx, nextW, v, K);
    }
    idxOut.set(nextIdx);
    wOut.set(nextW);
  }

  /* ── step 6b: re-assert the midline gate AFTER smoothing ─────────────────────────────────
   * Laplacian smoothing pulls weight across the 1-ring, so a vertex one edge loop OUTSIDE the
   * sternum band inherits the far clavicle from its neighbour INSIDE it. Measured: exactly one
   * vertex, and it is the same class of defect §5.3 step 2 names. Re-applying the same smooth
   * cross-fade makes the invariant structural instead of approximate, and because the fade is a
   * continuous function of x it introduces no discontinuity of its own.                        */
  for (let v = 0; v < n; v++) {
    p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
    for (let k = 0; k < K; k++) {
      if (wOut[v * K + k]! <= 0) continue;
      const bi = idxOut[v * K + k]!;
      const f = midlineFadeOf(BONE_ORDER[bi]!, p.x);
      if (f < 1) wOut[v * K + k] = wOut[v * K + k]! * f;
      // The cross-joint overshoot cap is a hard invariant too, and smoothing violates it: five
      // 1-ring iterations carry a bone's weight ~5 loops past where step 3 allowed it. Measured,
      // that put 9.5 % of an untwisted `upperarm` frame onto the ring at 33 % of the FOREARM —
      // 2.5x further than the cap — and cost metric 62 4 points.
      const { overshoot } = segDistance(
        p,
        seg.a[bi * 3]!, seg.a[bi * 3 + 1]!, seg.a[bi * 3 + 2]!,
        seg.b[bi * 3]!, seg.b[bi * 3 + 1]!, seg.b[bi * 3 + 2]!,
        cp,
      );
      if (overshoot > WEIGHT_PARAMS.crossJointFrac * seg.length[bi]!) wOut[v * K + k] = 0;
    }
    let s = 0;
    for (let k = 0; k < K; k++) s += wOut[v * K + k]!;
    if (s > 0) for (let k = 0; k < K; k++) wOut[v * K + k] = wOut[v * K + k]! / s;
  }

  /* ── step 6c: the AXIAL twist split — doc 06 §5.4 Fix 1, done the only way that works ────
   *
   * Each twist chain's CARRIER (`lowerarm`, `upperarm`, `thigh`, `calf`) owns one ordinary distance
   * field, so the elbow / knee / wrist / ankle blends against its neighbours are exactly what §5.3
   * produces. Its weight is then SPLIT among the chain's frames by a 1-D partition of unity in the
   * AXIAL coordinate alone.
   *
   * Why axial and not 3-D. A twist band is a band in ONE dimension, but a point-to-segment distance
   * mixes the axial offset with the radial one — and on the forearm the radial term (4.5 cm) is
   * comparable to the station spacing (8.9 cm), so a distance-based falloff cannot separate two
   * stations at all: measured, it put 55/45 weights on a ring 3 cm from the elbow and retention
   * dropped to 0.873. The axial partition puts the crossings exactly where they belong and makes the
   * blend width an explicit number (`twistBlendFrac`) rather than an emergent one.
   *
   * `twistBlendFrac` is chosen so each crossing is NARROWER THAN ONE EDGE LOOP — the literal content
   * of §5.4's "the blend band is only 1 loop wide" — and `bodyMesh.ts` places the loops so no ring
   * lands inside a crossing. Every ring then keeps full radius through a 180° roll. What remains is
   * an unavoidable consequence of LBS with 4 frames over 180°: the RULED SURFACE between the two
   * rings that straddle a crossing twists ~60° across one quad, so its interior necks in to
   * `cos(30°) = 0.866`. No partition of unity can do better — `tests/rig/candywrapper.test.ts`
   * measures both quantities and proves the floor.
   */
  for (const chain of TWIST_BANDS) {
    const ci = boneIndex(chain.carrier);
    const boundaries: number[] = [];
    for (let b = 0; b + 1 < chain.bands.length; b++) boundaries.push(chain.bands[b + 1]!.from);
    if (boundaries.length === 0) continue;

    for (let v = 0; v < n; v++) {
      let slot = -1;
      for (let k = 0; k < K; k++) if (idxOut[v * K + k]! === ci && wOut[v * K + k]! > 0) slot = k;
      if (slot < 0) continue;
      const wCarrier = wOut[v * K + slot]!;

      p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
      const { t: u } = segDistance(
        p,
        seg.a[ci * 3]!,
        seg.a[ci * 3 + 1]!,
        seg.a[ci * 3 + 2]!,
        seg.b[ci * 3]!,
        seg.b[ci * 3 + 1]!,
        seg.b[ci * 3 + 2]!,
        cp,
      );

      // Accumulate the vertex's whole influence set, splitting the carrier's share.
      wRow.fill(0);
      dRow.fill(Number.POSITIVE_INFINITY);
      for (let k = 0; k < K; k++) {
        if (k === slot || wOut[v * K + k]! <= 0) continue;
        wRow[idxOut[v * K + k]!]! += wOut[v * K + k]!;
      }
      /**
       * `s_b(u)` ramps 0 -> 1 across boundary `b`, so band 0 owns `1 - s_0`, band `k` owns
       * `s_{k-1} - s_k`, and the last owns `s_{last-1}`. The shares sum to 1 exactly for any `u`,
       * and stay non-negative because the boundaries are far more than `2*hw` apart.
       */
      const hw = WEIGHT_PARAMS.twistBlendFrac;
      let prev = 1;
      for (let b = 0; b < chain.bands.length; b++) {
        const s = b < boundaries.length ? smoothstep01((u - (boundaries[b]! - hw)) / (2 * hw)) : 0;
        const share = prev - s;
        prev = s;
        if (share > 0) wRow[boneIndex(chain.bands[b]!.bone)]! += wCarrier * share;
      }
      for (let bi = 0; bi < BONE_COUNT; bi++) if (wRow[bi]! > 0) dRow[bi] = 1 - wRow[bi]!;
      writeTopK(wRow, dRow, idxOut, wOut, v, K);
      twistSplit++;
    }
  }

  /* ── step 7: rigidify mid-limb ────────────────────────────────────────────────────────── */
  for (let v = 0; v < n; v++) {
    p.set(pos.getX(v), pos.getY(v), pos.getZ(v));

    // Dominant bone after smoothing.
    let dom = idxOut[v * K]!;
    let domW = wOut[v * K]!;
    for (let k = 1; k < K; k++) {
      if (wOut[v * K + k]! > domW) {
        domW = wOut[v * K + k]!;
        dom = idxOut[v * K + k]!;
      }
    }

    // 7 — mid-limb rigidify: farther than 1.8 * r from EVERY joint centre.
    let nearestJoint = Number.POSITIVE_INFINITY;
    for (let bi = 0; bi < BONE_COUNT; bi++) {
      const dx = p.x - sk.tposeJoint[bi * 3]!;
      const dy = p.y - sk.tposeJoint[bi * 3 + 1]!;
      const dz = p.z - sk.tposeJoint[bi * 3 + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nearestJoint) nearestJoint = d2;
    }
    if (Math.sqrt(nearestJoint) > WEIGHT_PARAMS.rigidifyFracR * seg.radius[dom]!) {
      setRigid(idxOut, wOut, v, K, dom);
      rigidified++;
      influenceSum += 1;
      continue;
    }

    for (let k = 0; k < K; k++) if (wOut[v * K + k]! > 0) influenceSum++;
  }

  /* ── ribcage: §2.8's childless breath bone must carry the ribcage / upper-abdomen band ─── */
  for (let v = 0; v < n; v++) {
    if (group[v]! !== LIMB_GROUP_ORDER.indexOf('trunk')) continue;
    const y = pos.getY(v);
    if (y < ribBandLo || y > ribBandHi) continue;
    const centre = (ribBandLo + ribBandHi) / 2;
    const half = (ribBandHi - ribBandLo) / 2;
    const win = Math.cos((Math.min(1, Math.abs(y - centre) / half) * Math.PI) / 2) ** 2;
    const share = WEIGHT_PARAMS.ribcageShare * win;
    if (share <= 0) continue;

    let donated = 0;
    for (let k = 0; k < K; k++) {
      const bi = idxOut[v * K + k]!;
      if (bi !== chestI && bi !== spine03I) continue;
      const take = wOut[v * K + k]! * share;
      wOut[v * K + k] = wOut[v * K + k]! - take;
      donated += take;
    }
    if (donated <= 0) continue;

    // Fold the donation into an existing ribcage slot, or displace the smallest slot.
    let slot = -1;
    for (let k = 0; k < K; k++) if (idxOut[v * K + k]! === ribcageI) slot = k;
    if (slot < 0) {
      let worst = 0;
      for (let k = 1; k < K; k++) if (wOut[v * K + k]! < wOut[v * K + worst]!) worst = k;
      // Never displace a slot that is carrying more than the donation itself.
      if (wOut[v * K + worst]! > donated) {
        for (let k = 0; k < K; k++) {
          const bi = idxOut[v * K + k]!;
          if (bi === chestI || bi === spine03I) wOut[v * K + k] = wOut[v * K + k]! + donated / 2;
        }
        continue;
      }
      donated += wOut[v * K + worst]!;
      idxOut[v * K + worst] = ribcageI;
      wOut[v * K + worst] = donated;
    } else {
      wOut[v * K + slot] = wOut[v * K + slot]! + donated;
    }
  }

  /* ── final normalise (§5.3 step 5; `normalizeSkinWeights()` runs again in karateka.ts) ── */
  for (let v = 0; v < n; v++) {
    let s = 0;
    for (let k = 0; k < K; k++) s += wOut[v * K + k]!;
    if (s <= 0) {
      idxOut[v * K] = 0;
      wOut[v * K] = 1;
      for (let k = 1; k < K; k++) {
        idxOut[v * K + k] = 0;
        wOut[v * K + k] = 0;
      }
      continue;
    }
    for (let k = 0; k < K; k++) wOut[v * K + k] = wOut[v * K + k]! / s;
  }

  return {
    skinIndex: idxOut,
    skinWeight: wOut,
    stats: {
      vertexCount: n,
      meanInfluences: influenceSum / Math.max(1, n),
      rigidified,
      twistSplit,
    },
  };
}

/** §5.3 step 4 + 5: keep the four largest, normalise; on a total miss fall back to `argmin d`. */
function writeTopK(
  wRow: Float64Array,
  dRow: Float64Array,
  idxOut: Uint16Array,
  wOut: Float32Array,
  v: number,
  K: number,
): void {
  const top: number[] = [];
  for (let bi = 0; bi < BONE_COUNT; bi++) {
    if (wRow[bi]! <= 0) continue;
    top.push(bi);
  }
  top.sort((x, y) => wRow[y]! - wRow[x]! || x - y);

  let sum = 0;
  for (let k = 0; k < K && k < top.length; k++) sum += wRow[top[k]!]!;

  if (sum <= 0) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let bi = 0; bi < BONE_COUNT; bi++) {
      if (dRow[bi]! < bestD) {
        bestD = dRow[bi]!;
        best = bi;
      }
    }
    idxOut[v * K] = best;
    wOut[v * K] = 1;
    for (let k = 1; k < K; k++) {
      idxOut[v * K + k] = 0;
      wOut[v * K + k] = 0;
    }
    return;
  }

  for (let k = 0; k < K; k++) {
    const bi = k < top.length ? top[k]! : 0;
    idxOut[v * K + k] = bi;
    wOut[v * K + k] = k < top.length ? wRow[bi]! / sum : 0;
  }
}

function setRigid(
  idxOut: Uint16Array,
  wOut: Float32Array,
  v: number,
  K: number,
  bone: number,
): void {
  idxOut[v * K] = bone;
  wOut[v * K] = 1;
  for (let k = 1; k < K; k++) {
    idxOut[v * K + k] = 0;
    wOut[v * K + k] = 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. GARMENT WEIGHTS — a garment grid is pinned to named bones, not distance-fielded.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** One garment vertex's explicit influence list. */
export type BoneWeightRow = readonly (readonly [BoneName, number])[];

/**
 * Weight a garment vertex set from an explicit `[bone, weight]` list per vertex. Cloth overwrites
 * the simulated parts' POSITIONS every frame, but the skinned bind must still be correct: it is
 * what `seek(tick, 'preview')` pins to (§6.4) and what the first-frame settle starts from.
 */
export function garmentWeights(rows: readonly BoneWeightRow[]): SkinWeights {
  const K = WEIGHT_PARAMS.maxInfluences;
  const n = rows.length;
  const idxOut = new Uint16Array(n * K);
  const wOut = new Float32Array(n * K);
  for (let v = 0; v < n; v++) {
    const list = [...rows[v]!].sort((a, b) => b[1] - a[1]).slice(0, K);
    let s = 0;
    for (const [, w] of list) s += w;
    if (s <= 0) {
      idxOut[v * K] = 0;
      wOut[v * K] = 1;
      continue;
    }
    for (let k = 0; k < K; k++) {
      if (k < list.length) {
        idxOut[v * K + k] = boneIndex(list[k]![0]);
        wOut[v * K + k] = list[k]![1] / s;
      }
    }
  }
  return {
    skinIndex: idxOut,
    skinWeight: wOut,
    stats: { vertexCount: n, meanInfluences: 0, rigidified: 0, twistSplit: 0 },
  };
}

/** Convenience for the tests and for B9: which `LimbGroup` a bone belongs to. */
export const groupOfBone = (n: BoneName): LimbGroup => LIMB_GROUP[n];
