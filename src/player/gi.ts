/**
 * B6 PLAYER — `src/player/gi.ts` — a karate gi for the LOADED character.
 *
 * ═══ WHY NOT RE-SKIN `src/rig`'s GI ══════════════════════════════════════════════════════════
 *
 * `src/rig/giMesh.ts` already builds a proper karateka's gi — four panels, doc 06 §7.10's ten
 * silhouette rules, arc-length UVs, the lot. It is authored against the CONTRACT skeleton and, more
 * to the point, against the CONTRACT BODY: every ring radius is `STATION_R.chest + chestEaseH`,
 * i.e. a fraction of a 1.75 m figure whose torso `bodyMesh.ts` generated to match.
 *
 * The figure on screen is none of that. Measured off `AnimLib.glb`'s bind pose:
 *
 *      stature                 1.829 m      (contract H = 1.75 m, +4.5 %)
 *      shoulder joint          ±0.192 m from the spine axis
 *      forearm radius          ~0.049 m     (contract `STATION_R.forearm` = 0.0255 H = 0.0446 m)
 *      deltoid radius          ~0.085 m
 *      hip joint               ±0.089 m,  y = 0.932 m
 *
 * so the proportions differ limb by limb, not by one uniform scale. Transferring the existing panels
 * therefore means re-fitting every ring anyway — and re-fitting a mesh to a body you have to measure
 * first is strictly more work than generating the ring straight from the measurement. Route (a)'s
 * only real prize, the authored SHAPE, is not in the vertices; it is in `src/data/constants/cloth.ts`
 * — `chestEaseH`, `sleeveCuffRadiusH`, `trouserHemRadiusH`, `beltGatherH`, `frontOverlapH`. Those are
 * numbers, they are already a cross-block import away, and this file consumes every one of them.
 *
 * So: route (b), with the retired gi's dimension table driving it.
 *
 * ═══ THE CONSTRUCTION, IN FOUR STEPS ═════════════════════════════════════════════════════════
 *
 *   1. MEASURE. Every garment ring asks the body's BIND-POSE vertices, restricted to the bones that
 *      ring belongs on, for their convex support radius in the ring's own plane:
 *      `h(φ) = max_i (a_i cos φ + b_i sin φ)`. The support function never UNDERSTATES a silhouette,
 *      which matters: the failure mode we are buying insurance against is a limb poking through
 *      cloth, and a support radius errs outward — toward loose fabric — by construction.
 *
 *   2. EASE. `radius = max(h·ratio, h + minClear)`. The absolute term is doc 06 §7.10 rule 1's
 *      `chestEaseH`; the ratio term is rules 2 and 3, whose whole content is that a gi is defined by
 *      RATIOS (cuff/forearm 1.31, trouser hem/ankle 2.1) rather than by a constant offset. Both,
 *      because this body is chunkier than the contract's in some places and thinner in others, and
 *      whichever rule gives the looser garment is the one that reads as 12 oz duck.
 *
 *   3. SKIN BY TRANSFER. The body is already correctly skinned by Quaternius. Each garment vertex
 *      takes the inverse-distance blend of its four nearest BODY vertices' bone weights, restricted
 *      to that part's own bone set, then three Laplacian passes over the garment's own grid.
 *      The restriction is not a detail: without it the left trouser leg picks up right-thigh weights
 *      across the 2 cm crotch gap and then follows the WRONG LEG for part of every stance.
 *
 *   4. PUSH OUT. Two relaxation passes move any garment vertex that ended up inside the body back
 *      out along the nearest body vertex's normal, to a 6 mm clearance. This is what lets steps 1–2
 *      stay simple: the analytic shoulder cap does not have to be exactly right, it has to be close,
 *      and the pushout closes the gap.
 *
 * ═══ WHAT THIS IS NOT ════════════════════════════════════════════════════════════════════════
 *
 * There is no cloth simulation here. The gi is pure LBS: it deforms because its weights are the
 * body's weights, and it hangs where the bind pose put it. A skirt panel therefore swings with the
 * thigh it was nearest to rather than lagging behind it, and the obi tails do not settle. §7.3's
 * simulated parts and `src/cloth` are a separate question; this file is the part that has to be
 * right first, because a gi that intersects the body under animation is worse than no gi at all.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  MeshPhysicalMaterial,
  SkinnedMesh,
  Vector3,
  type Material,
  type Object3D,
  type Skeleton,
} from 'three';

import type { BoneName } from '../contracts';
import { CLOTH } from '../data';
import { GI_WEAVE_REPEAT_PER_M, makeWeaveNormal } from '../rig';
import type { Character } from './character';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. DIMENSIONS — B1's `CLOTH`, in FRACTIONS OF STATURE, scaled by the MEASURED stature
 *
 * Not by `H`. `H` is the contract's 1.75 m and this glTF is 1.829 m; using the constant would put
 * the belt line 4.5 % of a body-height too low, which is 8 cm — the difference between an obi at the
 * navel and an obi across the hip bones.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const C = (k: string): number => {
  const v = CLOTH[k];
  if (!v) throw new Error(`gi: CLOTH.${k} missing — B1 owns it (src/data/constants/cloth.ts)`);
  return v.v;
};

const HEM_FRAC = C('uwagiHemH'); //             0.400  jacket hem above the floor
const BELT_FRAC = C('beltLineH'); //            0.6145 obi centreline
const SLEEVE_END_FRAC = C('sleeveEndH'); //     0.255  from the shoulder joint, along the arm
const ZUBON_HEM_FRAC = C('zubonHemH'); //       0.100  trouser hem above the floor
const OBI_W_FRAC = C('obiWidthH'); //           0.024
const OBI_TAIL_FRAC = C('obiTailH'); //         0.160
const COLLAR_W_FRAC = C('collarBandWidthH'); // 0.023
const CHEST_EASE_FRAC = C('chestEaseH'); //     0.020  rule 1: the jacket is BOXY
const BELT_GATHER_FRAC = C('beltGatherH'); //   0.012  rule 8: only the belt line is tight
const OVERLAP_FRAC = C('frontOverlapH'); //     0.130  rule 4: left front panel over right
const SHELL_FRAC = C('fabricThicknessCm') / 100 / 1.75; // 0.63 mm as a fraction of stature

/**
 * Ease RATIOS, doc 06 §7.10 rules 2 and 3 read back off the authored radii:
 * `sleeveCuffRadiusH / STATION_R.forearm = 0.0335 / 0.0255 = 1.31`, and
 * `trouserHemRadiusH / STATION_R.ankle  = 0.0435 / 0.0200 = 2.18`. They are applied to the MEASURED
 * limb here, which is the only way the same silhouette survives a change of character.
 *
 * The shoulder end of each is deliberately much tighter — a gi sleeve is cut wide at the cuff and
 * merely loose at the armhole, and running 1.3 all the way up gives a clown's shirt.
 */
const SLEEVE_RATIO_ROOT = 1.14;
const SLEEVE_RATIO_CUFF = 1.34;
const TROUSER_RATIO_HIP = 1.10;
const TROUSER_RATIO_HEM = 1.95;

/** Minimum radial clearance, as a fraction of stature, where the ratio rule would be tighter. */
const SLEEVE_CLEAR_ROOT = 0.007;
const SLEEVE_CLEAR_CUFF = 0.014;
const TROUSER_CLEAR_HIP = 0.008;
const TROUSER_CLEAR_HEM = 0.026;

/** Resolution. 28 columns puts a 0.30 m-radius jacket ring at 6.7 cm per facet — smooth at 2 m. */
const JACKET_COLS = 28;
const SLEEVE_COLS = 16;
const TROUSER_COLS = 20;
const OBI_COLS = 28;

/** §4's pushout: 6 mm of guaranteed air between cloth and skin, ~10x the fabric thickness. */
const PUSHOUT_CLEAR_FRAC = 0.0033;
const PUSHOUT_PASSES = 2;

/** §3's weight transfer. */
const TRANSFER_K = 4;
const SMOOTH_PASSES = 3;
const MAX_INFLUENCES = 4;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 2. FRAME CONVENTION
 *
 * Local (mesh) space, measured off the bind pose: the character faces **+Z** and its own LEFT is
 * **+X**. `dirOf(φ) = FWD·cos φ + LEFT·sin φ`, so φ = 0 front, +90° the wearer's left, 180° back.
 *
 * Every swept surface in this file is built from rings that share one rule:
 *
 *      rows increase along `axis`,  `v = axis × u`,  columns increase with φ in the (u, v) plane
 *
 * which makes `u × v === axis` and lets ONE triangle winding — `(a,b,d), (b,e,d)` — give outward
 * normals everywhere. Get the handedness backwards and the garment renders as a hole: three's
 * materials are all FrontSide (`tests/render/bans.test.ts` bans `DoubleSide` outright), so an
 * inside-out tube is not subtly wrong, it is invisible.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const FWD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

/* For a vertical part `frame(UP, FWD)` returns `u = FWD`, `v = LEFT`, so a column's direction is
 * `(sin φ, 0, cos φ)` and the inverse read is `φ = atan2(x, z)`. Both appear below. */

interface Ring {
  readonly centre: Vector3;
  /** Unit sweep direction; rows increase along it. */
  readonly axis: Vector3;
  readonly u: Vector3;
  readonly v: Vector3;
  /** Radius per column. Length is the tube's column count. */
  readonly r: Float64Array;
  /**
   * Per-column displacement along `axis`, so a "ring" can be a non-planar curve.
   *
   * Only the jacket's shoulder cap uses it, and it is the whole reason the neck opening works: the
   * body's crown is 9 cm higher over the deltoids than it is at the sternum, so any PLANAR ring that
   * clears the shoulders also sits above the chin, and the collar swallows the head.
   */
  readonly dy?: Float64Array;
}

/** World position of column `j` on a ring. */
function ringPoint(ring: Ring, j: number, out: Vector3): Vector3 {
  const phi = (j / ring.r.length) * Math.PI * 2;
  const rad = ring.r[j]!;
  out
    .copy(ring.centre)
    .addScaledVector(ring.u, Math.cos(phi) * rad)
    .addScaledVector(ring.v, Math.sin(phi) * rad);
  const d = ring.dy;
  if (d !== undefined) out.addScaledVector(ring.axis, d[j]!);
  return out;
}

/** `v = axis × u`, with `u` re-orthogonalised against `axis` first. */
function frame(axis: Vector3, hint: Vector3): { u: Vector3; v: Vector3 } {
  const h = Math.abs(hint.dot(axis)) > 0.98 ? (Math.abs(axis.y) > 0.9 ? FWD : UP) : hint;
  const u = h.clone().addScaledVector(axis, -h.dot(axis)).normalize();
  return { u, v: new Vector3().crossVectors(axis, u).normalize() };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE BODY, AS A MEASURABLE POINT CLOUD
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface Body {
  readonly n: number;
  /** Bind-pose position, in the space bone deltas apply to (`bindMatrix · position`). */
  readonly pos: Float64Array;
  readonly nrm: Float64Array;
  readonly si: Uint16Array;
  readonly sw: Float32Array;
  /** Highest-weighted bone per vertex — what a region membership test reads. */
  readonly dom: Int32Array;
  readonly skeleton: Skeleton;
  readonly attachTo: Object3D;
  readonly statureM: number;
  readonly boneIdx: ReadonlyMap<BoneName, number>;
  readonly bindPos: ReadonlyMap<BoneName, Vector3>;
}

/**
 * Gather every `SkinnedMesh` under the character that shares the FIRST one's skeleton.
 *
 * Sharing matters twice over. It is what lets one merged garment bind to one skeleton, and it is
 * what makes the point cloud a single coordinate system: positions are stored as `bindMatrix ·
 * position`, which is the space three's skinning applies bone deltas in, so a garment emitted with
 * an identity `bindMatrix` lands in exactly the same frame no matter which body mesh a measurement
 * came from. `AnimLib.glb` splits the mannequin into `Mannequin_1` (panels) and `Mannequin_2`
 * (joints); measuring only the first leaves the elbow and knee balls unaccounted for.
 */
function gatherBody(character: Character): Body | null {
  const meshes: SkinnedMesh[] = [];
  character.root.traverse((o: Object3D) => {
    const m = o as SkinnedMesh;
    if (m.isSkinnedMesh === true && m.skeleton !== undefined) meshes.push(m);
  });
  const first = meshes[0];
  if (first === undefined) return null;
  const skeleton = first.skeleton;
  const kept = meshes.filter((m) => m.skeleton === skeleton && m.name.startsWith('gi_') === false);

  let n = 0;
  for (const m of kept) n += m.geometry.getAttribute('position').count;

  const pos = new Float64Array(n * 3);
  const nrm = new Float64Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const dom = new Int32Array(n);

  const p = new Vector3();
  let w = 0;
  for (const m of kept) {
    const g = m.geometry;
    const ap = g.getAttribute('position');
    const an = g.getAttribute('normal');
    const ai = g.getAttribute('skinIndex');
    const aw = g.getAttribute('skinWeight');
    const nrmMat = new Matrix4().extractRotation(m.bindMatrix);
    for (let i = 0; i < ap.count; i++, w++) {
      p.set(ap.getX(i), ap.getY(i), ap.getZ(i)).applyMatrix4(m.bindMatrix);
      pos[w * 3] = p.x;
      pos[w * 3 + 1] = p.y;
      pos[w * 3 + 2] = p.z;
      p.set(an.getX(i), an.getY(i), an.getZ(i)).applyMatrix4(nrmMat).normalize();
      nrm[w * 3] = p.x;
      nrm[w * 3 + 1] = p.y;
      nrm[w * 3 + 2] = p.z;
      let best = -1;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const bi = (k === 0 ? ai.getX(i) : k === 1 ? ai.getY(i) : k === 2 ? ai.getZ(i) : ai.getW(i)) | 0;
        const bw = k === 0 ? aw.getX(i) : k === 1 ? aw.getY(i) : k === 2 ? aw.getZ(i) : aw.getW(i);
        si[w * 4 + k] = bi;
        sw[w * 4 + k] = bw;
        if (bw > bestW) {
          bestW = bw;
          best = bi;
        }
      }
      dom[w] = best;
    }
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  /* Bind-pose bone frames: `boneInverses[i]` is `inverse(bone.matrixWorld)` captured when the
   * skeleton was built, so inverting it back recovers the bone IN THE CLOUD'S SPACE — the one
   * measurement that must not be read off `bone.matrixWorld`, which is mid-animation by the time
   * anyone calls this. */
  const boneIdx = new Map<BoneName, number>();
  const bindPos = new Map<BoneName, Vector3>();
  const m4 = new Matrix4();
  for (const name of MEASURED_BONES) {
    const bone = character.boneFor(name);
    if (bone === null) continue;
    const idx = skeleton.bones.indexOf(bone);
    if (idx < 0) continue;
    boneIdx.set(name, idx);
    const invBind = skeleton.boneInverses[idx];
    if (invBind === undefined) continue;
    bindPos.set(name, new Vector3().setFromMatrixPosition(m4.copy(invBind).invert()));
  }

  return {
    n,
    pos,
    nrm,
    si,
    sw,
    dom,
    skeleton,
    attachTo: first.parent ?? character.root,
    statureM: maxY - minY,
    boneIdx,
    bindPos,
  };
}

/**
 * The one bone set the jacket, the collar and the obi all take weights from.
 *
 * SHARED ON PURPOSE. Those three surfaces are stacked millimetres apart — the collar sits on the
 * jacket plus a fabric thickness, the obi on the jacket plus four — so any difference in their
 * weights shows up as the layers sliding through each other under animation, not as a subtlety.
 * Giving the collar its own tighter set (chest and spine only) measured 42 mm of collar inside the
 * chest at `heian-nidan` t = 9.7 s; taking weights from the same region at the same place makes the
 * transfer produce near-identical rows and the stack moves as one.
 *
 * That the arms are in the set costs nothing at the waist — the nearest upper-arm vertex to an obi
 * vertex is 60 cm away and never wins the inverse-square blend.
 */
const TORSO_WEIGHT_BONES: readonly BoneName[] = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'chest',
  'neck_01',
  'clavicle_L',
  'clavicle_R',
  'upperarm_L',
  'upperarm_R',
  'thigh_L',
  'thigh_R',
];

/** Every contract bone this file needs a bind position or a region for. */
const MEASURED_BONES: readonly BoneName[] = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'chest',
  'neck_01',
  'head',
  'clavicle_L',
  'upperarm_L',
  'lowerarm_L',
  'hand_L',
  'clavicle_R',
  'upperarm_R',
  'lowerarm_R',
  'hand_R',
  'thigh_L',
  'calf_L',
  'foot_L',
  'thigh_R',
  'calf_R',
  'foot_R',
];

/** Vertex ids whose dominant bone is one of `names`. */
function regionOf(body: Body, names: readonly BoneName[]): Int32Array {
  const want = new Set<number>();
  for (const nm of names) {
    const i = body.boneIdx.get(nm);
    if (i !== undefined) want.add(i);
  }
  const out: number[] = [];
  for (let i = 0; i < body.n; i++) if (want.has(body.dom[i]!)) out.push(i);
  return Int32Array.from(out);
}

/** Drop the part of a region further than `maxR` from the vertical line through (x, z). */
function clipToAxis(body: Body, ids: Int32Array, x: number, z: number, maxR: number): Int32Array {
  const out: number[] = [];
  const m2 = maxR * maxR;
  for (const i of ids) {
    const dx = body.pos[i * 3]! - x;
    const dz = body.pos[i * 3 + 2]! - z;
    if (dx * dx + dz * dz <= m2) out.push(i);
  }
  return Int32Array.from(out);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 4. MEASUREMENT — the convex support radius of a body region in a ring's plane
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `h(φ) = max_i (a_i cos φ + b_i sin φ)` over the region vertices inside a slab of half-thickness
 * `halfSlab` about the ring plane, where `(a, b)` are the vertex's coordinates in `(u, v)`.
 *
 * Deliberately the SUPPORT function and not a windowed radial maximum. This mannequin is 8.5 k
 * vertices over 1.8 m, so a horizontal slab through a forearm holds a dozen points and a radial
 * maximum between two of them under-reads the silhouette by whatever the facet chord happens to be.
 * The support function cannot under-read: every vertex constrains every direction. Its price is that
 * it rounds convex corners OUTWARD, which on a near-elliptical cross-section is under a millimetre
 * and on the shoulder is why the yoke is built analytically instead (see `jacketRings`).
 *
 * Returns `false` when the slab caught nothing, so the caller can widen or fall back rather than
 * emit a zero-radius ring — a collapsed ring is a visible spike, not a missing one.
 */
function supportRing(
  body: Body,
  ids: Int32Array,
  ring: { centre: Vector3; axis: Vector3; u: Vector3; v: Vector3 },
  halfSlab: number,
  cols: number,
  out: Float64Array,
): boolean {
  const cs = new Float64Array(cols);
  const sn = new Float64Array(cols);
  for (let j = 0; j < cols; j++) {
    const phi = (j / cols) * Math.PI * 2;
    cs[j] = Math.cos(phi);
    sn[j] = Math.sin(phi);
  }
  out.fill(0);
  let hits = 0;
  const { centre, axis, u, v } = ring;
  for (const i of ids) {
    const dx = body.pos[i * 3]! - centre.x;
    const dy = body.pos[i * 3 + 1]! - centre.y;
    const dz = body.pos[i * 3 + 2]! - centre.z;
    const along = dx * axis.x + dy * axis.y + dz * axis.z;
    if (along < -halfSlab || along > halfSlab) continue;
    const a = dx * u.x + dy * u.y + dz * u.z;
    const b = dx * v.x + dy * v.y + dz * v.z;
    if (a * a + b * b < 1e-8) continue;
    hits++;
    for (let j = 0; j < cols; j++) {
      const h = a * cs[j]! + b * sn[j]!;
      if (h > out[j]!) out[j] = h;
    }
  }
  return hits > 0;
}

/** Circular [1 2 1] smoothing, `passes` times. Takes the facet edge off a coarse support ring. */
function smoothRing(r: Float64Array, passes: number): void {
  const n = r.length;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) {
      tmp[j] = 0.25 * r[(j - 1 + n) % n]! + 0.5 * r[j]! + 0.25 * r[(j + 1) % n]!;
    }
    r.set(tmp);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE ACCUMULATOR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface GridRef {
  readonly first: number;
  readonly rows: number;
  readonly cols: number;
  readonly wrap: boolean;
}

/** Which body bones a run of garment vertices may take weights — and pushout normals — from. */
interface Patch {
  readonly first: number;
  readonly count: number;
  readonly weightIds: Int32Array;
  readonly pushIds: Int32Array;
}

class Accum {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  readonly grids: GridRef[] = [];
  readonly patches: Patch[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  /** `grid[row][col]`, with `uv[row][col]` in METRES of arc length (`GI_UV_UNITS`). */
  addGrid(
    grid: readonly (readonly Vector3[])[],
    uvg: readonly (readonly (readonly [number, number])[])[],
    wrap: boolean,
  ): GridRef {
    const first = this.count;
    const rows = grid.length;
    const cols = grid[0]!.length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = grid[r]![c]!;
        this.pos.push(p.x, p.y, p.z);
        const t = uvg[r]![c]!;
        this.uv.push(t[0], t[1]);
      }
    }
    const lastCol = wrap ? cols : cols - 1;
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c < lastCol; c++) {
        const c1 = (c + 1) % cols;
        const a = first + r * cols + c;
        const b = first + r * cols + c1;
        const d = first + (r + 1) * cols + c;
        const e = first + (r + 1) * cols + c1;
        // §2's one winding. `u × v === axis` makes (a,b,d) face outward; see the frame convention.
        this.idx.push(a, b, d, b, e, d);
      }
    }
    const ref: GridRef = { first, rows, cols, wrap };
    this.grids.push(ref);
    return ref;
  }

  patch(first: number, weightIds: Int32Array, pushIds: Int32Array): void {
    this.patches.push({ first, count: this.count - first, weightIds, pushIds });
  }
}

/** Evaluate a ring list into a `[row][col]` point grid. */
function tubePoints(rings: readonly Ring[]): Vector3[][] {
  const cols = rings[0]!.r.length;
  return rings.map((ring) => {
    const row: Vector3[] = [];
    for (let j = 0; j < cols; j++) row.push(ringPoint(ring, j, new Vector3()));
    return row;
  });
}

/**
 * Sweep a ring list into a grid with arc-length UVs — metres along the warp on `u`, metres across
 * the weft on `v`, which is `GI_UV_UNITS` and what `GI_WEAVE_REPEAT_PER_M` is a repeat count for.
 *
 * `along` accumulates the MEAN vertex-to-vertex step rather than the centre-to-centre one: the
 * shoulder cap's rings all share a centre and differ only in `dy`, so a centre-based arc length
 * would give every cap row the same `u` and paste one texel column across the whole shoulder.
 */
function emitTube(acc: Accum, rings: readonly Ring[], wrap = true): GridRef {
  const cols = rings[0]!.r.length;
  const grid = tubePoints(rings);
  const uvg: [number, number][][] = [];
  let along = 0;
  for (let i = 0; i < grid.length; i++) {
    if (i > 0) {
      let step = 0;
      for (let j = 0; j < cols; j++) step += grid[i]![j]!.distanceTo(grid[i - 1]![j]!);
      along += step / cols;
    }
    let mean = 0;
    for (let j = 0; j < cols; j++) mean += rings[i]!.r[j]!;
    mean /= cols;
    const rowUv: [number, number][] = [];
    for (let j = 0; j < cols; j++) rowUv.push([along, (j / cols) * Math.PI * 2 * mean]);
    uvg.push(rowUv);
  }
  return acc.addGrid(grid, uvg, wrap);
}

/**
 * The three extra rings that turn a raw tube end into a FOLDED HEM.
 *
 * A tube that simply stops has a zero-thickness edge, and because every material is FrontSide the
 * inside of the tube does not render — so a grazing look under a jacket hem or into a sleeve cuff
 * sees straight through the garment. Folding the surface back on itself gives the edge a visible
 * lip and an inner lining whose normals point at the limb, which is exactly what a 12 oz hem does.
 *
 * `outward` is the unit direction pointing OUT of the tube at that end. Returned in strip order
 * from deepest-inside to the lip, so a first-row hem prepends them as-is and a last-row hem appends
 * them reversed.
 */
function hemFold(end: Ring, outward: Vector3, inward: number, depth: number): Ring[] {
  const mk = (along: number, dr: number): Ring => ({
    centre: end.centre.clone().addScaledVector(outward, along),
    axis: end.axis,
    u: end.u,
    v: end.v,
    r: end.r.map((x) => Math.max(0.004, x - dr)),
  });
  return [mk(-depth, inward), mk(-0.06 * depth, inward), mk(0.35 * inward, inward * 0.45)];
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 6. THE PANELS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The jacket, kept around after it is emitted so the collar and the obi can be laid ON it rather
 * than near it. Indexed by a FRACTIONAL ROW rather than by height, because the shoulder cap's rows
 * are not planar (see `Ring.dy`) and a height lookup there has no single answer.
 */
interface Shell {
  readonly rings: readonly Ring[];
  readonly pts: readonly (readonly Vector3[])[];
  /** Mean height per row — the only thing a height-keyed caller (the obi) needs. */
  readonly rowY: Float64Array;
  readonly cols: number;
}

function makeShell(rings: readonly Ring[]): Shell {
  const pts = tubePoints(rings);
  const rowY = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    let s = 0;
    for (const p of pts[i]!) s += p.y;
    rowY[i] = s / pts[i]!.length;
  }
  return { rings, pts, rowY, cols: rings[0]!.r.length };
}

/** Bilinear read at fractional row `rf` and azimuth `phi`. */
function shellAt(sh: Shell, rf: number, phi: number, out: Vector3): Vector3 {
  const rows = sh.pts.length;
  const r = Math.max(0, Math.min(rows - 1.0001, rf));
  const i0 = Math.floor(r);
  const i1 = Math.min(rows - 1, i0 + 1);
  const ft = r - i0;
  const f = ((phi / (Math.PI * 2)) * sh.cols + sh.cols * 4) % sh.cols;
  const j0 = Math.floor(f) % sh.cols;
  const j1 = (j0 + 1) % sh.cols;
  const fc = f - Math.floor(f);
  const a = sh.pts[i0]![j0]!;
  const b = sh.pts[i0]![j1]!;
  const c = sh.pts[i1]![j0]!;
  const d = sh.pts[i1]![j1]!;
  return out.set(
    (a.x * (1 - fc) + b.x * fc) * (1 - ft) + (c.x * (1 - fc) + d.x * fc) * ft,
    (a.y * (1 - fc) + b.y * fc) * (1 - ft) + (c.y * (1 - fc) + d.y * fc) * ft,
    (a.z * (1 - fc) + b.z * fc) * (1 - ft) + (c.z * (1 - fc) + d.z * fc) * ft,
  );
}

/** Fractional row whose mean height is `y`. */
function rowAtY(sh: Shell, y: number): number {
  const n = sh.rowY.length;
  for (let i = 0; i + 1 < n; i++) {
    const a = sh.rowY[i]!;
    const b = sh.rowY[i + 1]!;
    if (y >= a && y <= b) return b - a > 1e-6 ? i + (y - a) / (b - a) : i;
  }
  return y < sh.rowY[0]! ? 0 : n - 1;
}

/** Outward unit normal, by finite difference. `Tφ × Trow` is outward under §2's frame. */
function shellNormal(sh: Shell, rf: number, phi: number, out: Vector3): Vector3 {
  const dp = 0.06;
  const a = shellAt(sh, rf, phi - dp, new Vector3());
  const b = shellAt(sh, rf, phi + dp, new Vector3());
  const c = shellAt(sh, Math.max(0, rf - 0.5), phi, new Vector3());
  const e = shellAt(sh, rf + 0.5, phi, new Vector3());
  return out.crossVectors(b.sub(a), e.sub(c)).normalize();
}

interface GiFit {
  readonly S: number;
  readonly yHem: number;
  readonly yBelt: number;
  readonly yShoulder: number;
  readonly yNeck: number;
  readonly spine: readonly Vector3[];
  readonly shoulderReach: number;
}

function landmarksOf(body: Body): GiFit | null {
  const need = (n: BoneName): Vector3 | null => body.bindPos.get(n) ?? null;
  const pelvis = need('pelvis');
  const neck = need('neck_01');
  const armL = need('upperarm_L');
  if (pelvis === null || neck === null || armL === null) return null;

  const S = body.statureM;
  const spine: Vector3[] = [];
  for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01'] as const) {
    const p = body.bindPos.get(n);
    if (p !== undefined && (spine.length === 0 || p.y > spine[spine.length - 1]!.y + 1e-4)) {
      spine.push(p.clone());
    }
  }

  return {
    S,
    yHem: HEM_FRAC * S,
    yBelt: BELT_FRAC * S,
    yShoulder: armL.y,
    yNeck: neck.y,
    spine,
    /* Where the deltoid ends and the arm begins. Every jacket measurement is clipped to this radius
     * about the spine axis, because the bind pose is a T-POSE: a horizontal slab at shoulder height
     * otherwise catches the whole arm out to the fingertips and the support radius comes back as
     * 0.97 m. Derived from the shoulder joint rather than assumed, so it survives an A-pose bind. */
    shoulderReach: Math.hypot(armL.x, armL.z - pelvis.z) + 0.045 * S,
  };
}

/** Spine centreline at height `y`, extended linearly past both ends. */
function spineAt(lm: GiFit, y: number, out: Vector3): Vector3 {
  const s = lm.spine;
  if (s.length === 1) return out.copy(s[0]!).setY(y);
  let i = 0;
  while (i + 2 < s.length && s[i + 1]!.y < y) i++;
  const a = s[i]!;
  const b = s[i + 1]!;
  const t = (y - a.y) / (b.y - a.y);
  return out.set(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
}

/**
 * doc 06 §7.10's jacket, as a radius offset over the measured torso:
 *
 *   rule 1  BOXY — a constant `chestEaseH` (0.020 H) with no waist taper;
 *   rule 8  nothing is tight except the belt line, where `beltGatherH` (0.012 H) pulls it in;
 *   rule 4  the skirt flares, LINEARLY in drop — a heavy jacket hangs straight-sided, not belled.
 */
function jacketEase(lm: GiFit, y: number): number {
  const S = lm.S;
  const gather =
    BELT_GATHER_FRAC * S * Math.exp(-Math.pow((y - lm.yBelt) / (0.030 * S), 2));
  const drop = Math.max(0, Math.min(1, (lm.yBelt - y) / (lm.yBelt - lm.yHem)));
  return CHEST_EASE_FRAC * S - gather + 0.012 * S * drop;
}

/**
 * The uwagi: one closed tube, hem to neck, plus an analytic shoulder cap.
 *
 * ═══ WHY THE CAP IS NOT MORE MEASURED RINGS ══════════════════════════════════════════════════
 *
 * Horizontal rings cannot close the top. The topmost one that still clears the deltoids sits above
 * them — measured, the deltoid crown is at y = 1.53 m against a shoulder joint at 1.44 — and a ring
 * up there catches only the neck, so the jacket would stop at the collarbone with an open top that
 * a slightly-high camera looks straight down into. Capping it with a flat annulus instead puts a
 * horizontal shelf at 1.48 m through a shoulder that reaches 1.53: the deltoid comes out through
 * the fabric.
 *
 * So the cap is a quarter-ellipse in the (radial, vertical) half-plane, from the top torso ring out
 * at the shoulder width to the neck ring above the deltoid crown, per column. It is approximately
 * right by construction and made exactly right by §4's pushout, which is the division of labour
 * that keeps this function readable.
 */
function jacketShell(body: Body, lm: GiFit): Shell {
  const S = lm.S;
  const cols = JACKET_COLS;
  const torso: BoneName[] = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'chest'];
  const withArms: BoneName[] = [...torso, 'clavicle_L', 'clavicle_R', 'upperarm_L', 'upperarm_R'];
  const withThighs: BoneName[] = [...torso, 'thigh_L', 'thigh_R'];

  const axisPt = spineAt(lm, lm.yShoulder, new Vector3());
  const idsTorso = clipToAxis(body, regionOf(body, withArms), axisPt.x, axisPt.z, lm.shoulderReach);
  const idsSkirt = clipToAxis(body, regionOf(body, withThighs), axisPt.x, axisPt.z, lm.shoulderReach);
  const idsNeck = regionOf(body, ['neck_01']);

  const yHip = body.bindPos.get('thigh_L')?.y ?? lm.yBelt - 0.10 * S;
  const yCapBase = lm.yShoulder - 0.012 * S;

  const rows: Ring[] = [];
  const mkRing = (y: number, ids: Int32Array, slab: number, ease: number): Ring => {
    const centre = spineAt(lm, y, new Vector3());
    const { u, v } = frame(UP, FWD);
    const r = new Float64Array(cols);
    if (!supportRing(body, ids, { centre, axis: UP, u, v }, slab, cols, r) && rows.length > 0) {
      r.set(rows[rows.length - 1]!.r);
    }
    smoothRing(r, 2);
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]! + ease, 0.03 * S);
    return { centre, axis: UP, u, v, r };
  };

  /* Torso: hem -> cap base, 14 rows, ~5.5 cm apart on a 1.83 m figure. */
  const N = 14;
  for (let i = 0; i < N; i++) {
    const y = lm.yHem + ((yCapBase - lm.yHem) * i) / (N - 1);
    const ids = y < yHip ? idsSkirt : idsTorso;
    rows.push(mkRing(y, ids, 0.030 * S, jacketEase(lm, y)));
  }

  /* Neck ring: measured off the neck alone, so the collar opening is a collar and not a cowl. */
  const capCentre = spineAt(lm, yCapBase, new Vector3());
  const capFrame = frame(UP, FWD);
  const rNeck = new Float64Array(cols);
  const neckProbe = { centre: spineAt(lm, lm.yNeck + 0.020 * S, new Vector3()), axis: UP, ...capFrame };
  if (!supportRing(body, idsNeck, neckProbe, 0.045 * S, cols, rNeck)) rNeck.fill(0.037 * S);
  smoothRing(rNeck, 2);
  for (let j = 0; j < cols; j++) rNeck[j] = Math.max(rNeck[j]! + 0.009 * S, 0.030 * S);

  /* Per-column crown: how high the body reaches OUTSIDE the collar opening, in each azimuth wedge.
   * Restricting to `ρ ≥ rNeck` is what separates the two heights that were being conflated — the
   * neck's own crown, which the opening is a hole for, from the deltoid's, which it must clear. */
  const crown = new Float64Array(cols);
  crown.fill(lm.yNeck + 0.004 * S);
  for (const i of idsTorso) {
    const y = body.pos[i * 3 + 1]!;
    if (y < yCapBase - 0.02 * S) continue;
    const dx = body.pos[i * 3]! - capCentre.x;
    const dz = body.pos[i * 3 + 2]! - capCentre.z;
    const rho = Math.hypot(dx, dz);
    const jf = (Math.atan2(dx, dz) / (Math.PI * 2)) * cols;
    for (let k = -2; k <= 2; k++) {
      const j = ((Math.round(jf) + k) % cols + cols) % cols;
      if (rho < rNeck[j]!) continue;
      if (y > crown[j]!) crown[j] = y;
    }
  }
  smoothRing(crown, 2);

  /* Cap: a quarter-ellipse per column, from the top torso ring out at the shoulder to the collar
   * opening above that column's crown. Five rows. */
  const top = rows[rows.length - 1]!;
  const CAP = 5;
  for (let i = 1; i <= CAP; i++) {
    const t = i / CAP;
    const s = Math.sin((t * Math.PI) / 2);
    const k = Math.cos((t * Math.PI) / 2);
    const r = new Float64Array(cols);
    const dy = new Float64Array(cols);
    for (let j = 0; j < cols; j++) {
      r[j] = rNeck[j]! + (top.r[j]! - rNeck[j]!) * k;
      dy[j] = (crown[j]! + 0.010 * S - yCapBase) * s;
    }
    rows.push({ centre: capCentre.clone(), axis: UP, u: capFrame.u, v: capFrame.v, r, dy });
  }

  return makeShell(rows);
}

function buildJacket(acc: Accum, body: Body, lm: GiFit, shell: Shell): void {
  const S = lm.S;
  const first = acc.count;
  const hem = shell.rings[0]!;
  const rings = [...hemFold(hem, UP.clone().negate(), 0.010 * S, 0.026 * S), ...shell.rings];
  emitTube(acc, rings);

  /* `upperarm_*` and `neck_01` are in the WEIGHT set even though the jacket is not a sleeve.
   *
   * Measured over `heian-nidan` with them left out: 15–30 garment vertices per frame end up inside
   * the body, worst case 55 mm, and every one of them is on the shoulder or at the collar opening.
   * The cause is not the shape — the shoulder has 3.7 cm of ease — it is that a jacket rigid to the
   * chest cannot get out of a deltoid's way when the arm crosses the body. A real jacket's shoulder
   * moves with the arm, and the nearest-vertex transfer reproduces that for free: only the vertices
   * genuinely nearest the deltoid pick up arm weight, and `smoothWeights` feathers the boundary. */
  const weight = regionOf(body, TORSO_WEIGHT_BONES);
  const push = clipToAxis(
    body,
    regionOf(body, [
      'pelvis',
      'spine_01',
      'spine_02',
      'spine_03',
      'chest',
      'clavicle_L',
      'clavicle_R',
      'upperarm_L',
      'upperarm_R',
      'thigh_L',
      'thigh_R',
      'neck_01',
    ]),
    0,
    lm.spine[0]!.z,
    lm.shoulderReach,
  );
  acc.patch(first, weight, push);
}

/**
 * A sleeve: a wide straight tube along the arm, ending at `sleeveEndH` (0.255 H from the shoulder
 * joint) — the kata cut, three-quarters down the forearm.
 *
 * The inboard end starts 2 cm INSIDE the shoulder joint, so its open ring is buried in the jacket's
 * shoulder cap rather than leaving a gap at the armhole. Its weights come from the clavicle as much
 * as the upper arm, which is what keeps the two surfaces moving together when the arm lifts: the
 * body's own clavicle->deltoid blend is inherited wholesale by the transfer.
 */
function buildSleeve(acc: Accum, body: Body, lm: GiFit, h: 'L' | 'R'): void {
  const S = lm.S;
  const sjc = body.bindPos.get(`upperarm_${h}` as BoneName);
  const wrist = body.bindPos.get(`hand_${h}` as BoneName);
  if (sjc === undefined || wrist === undefined) return;

  const axis = wrist.clone().sub(sjc).normalize();
  const arm = regionOf(body, [
    `clavicle_${h}` as BoneName,
    `upperarm_${h}` as BoneName,
    `lowerarm_${h}` as BoneName,
  ]);
  const measure = regionOf(body, [`upperarm_${h}` as BoneName, `lowerarm_${h}` as BoneName]);

  const t0 = -0.011 * S;
  const t1 = SLEEVE_END_FRAC * S;
  const N = 10;
  const cols = SLEEVE_COLS;
  const rings: Ring[] = [];
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const t = t0 + (t1 - t0) * s;
    const centre = sjc.clone().addScaledVector(axis, t);
    const { u, v } = frame(axis, UP);
    const r = new Float64Array(cols);
    if (!supportRing(body, measure, { centre, axis, u, v }, 0.022 * S, cols, r) && rings.length) {
      r.set(rings[rings.length - 1]!.r);
    }
    smoothRing(r, 2);
    const ratio = SLEEVE_RATIO_ROOT + (SLEEVE_RATIO_CUFF - SLEEVE_RATIO_ROOT) * Math.pow(s, 0.7);
    const clear = (SLEEVE_CLEAR_ROOT + (SLEEVE_CLEAR_CUFF - SLEEVE_CLEAR_ROOT) * s) * S;
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]! * ratio, r[j]! + clear, 0.025 * S);
    rings.push({ centre, axis, u, v, r });
  }

  const first = acc.count;
  const cuff = rings[rings.length - 1]!;
  emitTube(acc, [...rings, ...hemFold(cuff, axis, 0.009 * S, 0.024 * S).reverse()]);
  acc.patch(first, arm, measure);
}

/**
 * A trouser leg: hip to shin, ending at `zubonHemH` (0.100 H above the floor — 8 cm clear of this
 * character's ankle, which is the gap that lets the foot read).
 *
 * doc 06 §7.10 rule 3 calls the flare "the single most identifiable gi feature in motion", and it is
 * the one place a ratio beats an offset outright: `trouserHemRadiusH / ankle = 2.18`, so the hem
 * scales with the leg instead of adding a constant that would look like a cuff on a thin ankle and
 * like nothing at all on a thick one.
 *
 * It starts ABOVE the hip joint and therefore inside the jacket, which is why there is no waistband
 * here at all — the two legs would have to merge across the crotch to make one, and the jacket
 * covers every millimetre of the result down to mid-thigh anyway.
 */
function buildTrouser(acc: Accum, body: Body, lm: GiFit, h: 'L' | 'R'): void {
  const S = lm.S;
  const hip = body.bindPos.get(`thigh_${h}` as BoneName);
  const knee = body.bindPos.get(`calf_${h}` as BoneName);
  const ankle = body.bindPos.get(`foot_${h}` as BoneName);
  if (hip === undefined || knee === undefined || ankle === undefined) return;

  const leg = regionOf(body, [
    `thigh_${h}` as BoneName,
    `calf_${h}` as BoneName,
    `foot_${h}` as BoneName,
  ]);
  const weight = regionOf(body, [
    'pelvis',
    `thigh_${h}` as BoneName,
    `calf_${h}` as BoneName,
    `foot_${h}` as BoneName,
  ]);

  /* Centreline: above the hip, then hip -> knee -> the hem's height on the shin. */
  const yTop = hip.y + 0.042 * S;
  const yHem = ZUBON_HEM_FRAC * S;
  const kneeToAnkle = ankle.clone().sub(knee);
  const hemPt = knee
    .clone()
    .addScaledVector(kneeToAnkle, Math.max(0, Math.min(1, (yHem - knee.y) / kneeToAnkle.y)));
  const path: Vector3[] = [
    new Vector3(hip.x * 0.86, yTop, hip.z),
    hip.clone(),
    knee.clone(),
    hemPt,
  ];

  const N = 13;
  const cols = TROUSER_COLS;
  const rings: Ring[] = [];
  const total = path.length - 1;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const g = Math.min(total - 1, Math.floor(s * total));
    const local = s * total - g;
    const a = path[g]!;
    const b = path[g + 1]!;
    const centre = a.clone().lerp(b, local);
    const axis = b.clone().sub(a).normalize().negate(); // rows run bottom -> top
    const { u, v } = frame(axis, FWD);
    const r = new Float64Array(cols);
    if (!supportRing(body, leg, { centre, axis, u, v }, 0.028 * S, cols, r) && rings.length) {
      r.set(rings[rings.length - 1]!.r);
    }
    smoothRing(r, 2);
    /* `s` runs hip -> hem, and the flare is strongest at the hem, so the ratio LAGS: `s^1.6` keeps
     * the thigh close and opens the last third, which is where the fabric actually swings. */
    const k = Math.pow(s, 1.6);
    const ratio = TROUSER_RATIO_HIP + (TROUSER_RATIO_HEM - TROUSER_RATIO_HIP) * k;
    const clear = (TROUSER_CLEAR_HIP + (TROUSER_CLEAR_HEM - TROUSER_CLEAR_HIP) * k) * S;
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]! * ratio, r[j]! + clear, 0.030 * S);
    rings.push({ centre, axis, u, v, r });
  }
  rings.reverse(); // emit bottom -> top so rows increase along `axis`

  const first = acc.count;
  const hem = rings[0]!;
  emitTube(acc, [...hemFold(hem, hem.axis.clone().negate(), 0.011 * S, 0.030 * S), ...rings]);
  acc.patch(first, weight, leg);
}

/**
 * The collar (eri): a thick doubled band laid ON the jacket, hem-of-lapel -> neck -> hem, never
 * simulated (doc 06 §7.10 rule 5).
 *
 * It is the whole read. The jacket beneath is a closed tube — a real gi's underlapping front panel
 * covers the chest, and modelling the two panels separately buys a seam nobody sees and an open
 * front that leaks skin the moment a weight blend moves either edge. What the eye recognises as
 * "karate gi" rather than "white pyjamas" is this V and its thickness, so the V is a solid band
 * swept along the jacket's own surface, and the wearer's LEFT lapel rides `frontOverlapH`-derived
 * millimetres proud of the right (rule 4, left over right).
 */
function buildCollar(acc: Accum, body: Body, lm: GiFit, shell: Shell): void {
  const S = lm.S;
  const halfW = (COLLAR_W_FRAC * S) / 2;
  const halfT = 0.0032 * S;

  const rowBot = rowAtY(shell, lm.yBelt - 0.004 * S);
  const rowTop = shell.pts.length - 1;

  /**
   * The band is ASYMMETRIC, because a gi's front is.
   *
   * The right panel goes on first and the LEFT panel wraps over it, so the left panel's collared
   * edge does not stop at the sternum — it carries on across the body and vanishes under the obi at
   * the wearer's RIGHT hip. `frontOverlapH` (0.130 H) is exactly that carry, as ARC, so dividing it
   * by the jacket's own mean belt radius turns it into the azimuth the lower end lands at (−40° on
   * this figure) and keeps it 0.130 H if the torso profile is ever retuned.
   *
   * The right panel's edge is the mirror image, but only ABOVE the crossing: below it the left
   * panel is on top and the right one is not there to be seen. Truncating it at the crossing is
   * what turns a symmetric ✗ into the ✓-over-✓ a karateka's chest actually shows.
   */
  const beltRing = shell.rings[Math.round(rowAtY(shell, lm.yBelt))]!;
  let rBelt = 0;
  for (const x of beltRing.r) rBelt += x;
  rBelt /= beltRing.r.length;
  const phiLow = -Math.min(0.85, Math.max(0.20, (OVERLAP_FRAC * S) / 2 / rBelt));
  /* 32° at the shoulder, the lapel angle `src/rig/giMesh.ts`'s collar sweep was authored with. */
  const phiTop = 0.56;
  /** Azimuth as a function of the climb. `s^0.6` crosses the midline at the sternum, not the yoke. */
  const phiAt = (s: number): number => phiLow + (phiTop - phiLow) * Math.pow(s, 0.6);
  const rowAt = (s: number): number => rowBot + (rowTop - rowBot) * s;
  const sCross = Math.pow(-phiLow / (phiTop - phiLow), 1 / 0.6);

  const L = 12;
  const B = 7;
  const path: { row: number; phi: number; proud: number }[] = [];
  /* Right band, crossing -> shoulder. Mirrored in φ and swept with NEGATIVE azimuth so the whole
   * strip is monotone: it continues round the back of the neck the long way and comes down the
   * left, which is what keeps `shellAt`'s wrap from folding the band back on itself. */
  for (let i = 0; i <= L; i++) {
    const s = sCross + (1 - sCross) * (i / L);
    path.push({ row: rowAt(s), phi: -phiAt(s), proud: 0 });
  }
  for (let i = 1; i <= B; i++) {
    const s = i / B;
    path.push({ row: rowTop, phi: -phiTop - (Math.PI * 2 - 2 * phiTop) * s, proud: 0 });
  }
  /* Left band, shoulder -> the right hip. `0.004 H` proud is `src/rig/giMesh.ts`'s
   * `FRONT_L_PROUD_H`: enough that the two layers never z-fight, small enough to read as cloth. */
  for (let i = 1; i <= L; i++) {
    const s = 1 - i / L;
    path.push({ row: rowAt(s), phi: phiAt(s) - Math.PI * 2, proud: 0.004 * S });
  }
  const proud = Float64Array.from(path.map((q) => q.proud));

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const centres: Vector3[] = [];
  const normals: Vector3[] = [];
  for (const q of path) {
    centres.push(shellAt(shell, q.row, q.phi, new Vector3()));
    normals.push(shellNormal(shell, q.row, q.phi, new Vector3()));
  }

  let along = 0;
  for (let i = 0; i < path.length; i++) {
    const c0 = centres[i]!;
    const nOut = normals[i]!;
    const prev = centres[Math.max(0, i - 1)]!;
    const next = centres[Math.min(path.length - 1, i + 1)]!;
    const tan = next.clone().sub(prev);
    if (tan.lengthSq() < 1e-12) tan.copy(UP);
    tan.normalize();
    if (i > 0) along += c0.distanceTo(prev);

    const u = nOut.clone().addScaledVector(tan, -nOut.dot(tan)).normalize();
    const v = new Vector3().crossVectors(tan, u).normalize();
    const base = c0.clone().addScaledVector(u, halfT + SHELL_FRAC * S + proud[i]!);

    // Corners CCW in the (u, v) plane, matching §2's winding.
    const corner = (a: number, b: number): Vector3 =>
      base.clone().addScaledVector(u, a * halfT).addScaledVector(v, b * halfW);
    grid.push([corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)]);
    uvg.push([
      [along, 0],
      [along, halfT * 2],
      [along, halfT * 2 + halfW * 2],
      [along, halfT * 4 + halfW * 2],
    ]);
  }

  const first = acc.count;
  acc.addGrid(grid, uvg, true);
  const torso = regionOf(body, TORSO_WEIGHT_BONES);
  /* Pushed out of the neck as well as the torso: the band behind the neck is the one piece of the
   * gi a head-bob can drive a body vertex through, and it is the piece nobody would forgive. */
  acc.patch(first, torso, torso);
}

/**
 * The obi: a band at the belt line, a knot at centre-front and two hanging ends.
 *
 * §5.6 calls `M_OBI` a SILHOUETTE DEVICE — the one near-black element on a white figure, which is
 * what tells a viewer where the hips are and therefore whether a stance is settled. It rides the
 * jacket surface plus a few millimetres, and it stands proud because the jacket is GATHERED under
 * it by `beltGatherH` rather than because the belt is inflated.
 */
function buildObi(acc: Accum, body: Body, lm: GiFit, shell: Shell): void {
  const S = lm.S;
  const cols = OBI_COLS;
  const halfW = (OBI_W_FRAC * S) / 2;
  const torso = regionOf(body, TORSO_WEIGHT_BONES);

  const first = acc.count;

  /* Band: four rows across the belt width, radius read off the jacket it sits on. */
  const rings: Ring[] = [];
  const ys = [-halfW, -halfW * 0.55, halfW * 0.55, halfW];
  const p = new Vector3();
  for (const dy of ys) {
    const y = lm.yBelt + dy;
    const centre = spineAt(lm, y, new Vector3());
    const { u, v } = frame(UP, FWD);
    const r = new Float64Array(cols);
    const rf = rowAtY(shell, y);
    for (let j = 0; j < cols; j++) {
      const phi = (j / cols) * Math.PI * 2;
      shellAt(shell, rf, phi, p);
      /* The edges tuck back toward the jacket so the band reads as wrapped, not as a hoop. The
       * middle has to clear `halfT + SHELL + FRONT_L_PROUD` = 0.0078 H, because the left lapel
       * passes UNDER the obi and a belt that does not cover it leaves a white flap over the black. */
      const tuck = Math.abs(dy) > halfW * 0.8 ? 0.0030 * S : 0.0095 * S;
      r[j] = Math.hypot(p.x - centre.x, p.z - centre.z) + tuck;
    }
    rings.push({ centre, axis: UP, u, v, r });
  }
  emitTube(acc, rings);

  /* Knot: a short stub of band crossing the front centre, plus two ends hanging from it. */
  const rfBelt = rowAtY(shell, lm.yBelt);
  const front = shellAt(shell, rfBelt, 0, new Vector3());
  const nOut = shellNormal(shell, rfBelt, 0, new Vector3());
  const knotC = front.clone().addScaledVector(nOut, 0.014 * S);
  const across = new Vector3().crossVectors(UP, nOut).normalize();
  {
    const grid: Vector3[][] = [];
    const uvg: [number, number][][] = [];
    const kw = 0.026 * S;
    const kh = halfW * 1.15;
    const kd = 0.009 * S;
    // Rows run +across -> -across, which makes `axis = -across` and `axis × nOut = UP`: §2's
    // handedness, without which the knot renders as a hole in the belt.
    for (let i = 0; i < 2; i++) {
      const c = knotC.clone().addScaledVector(across, (i === 0 ? 1 : -1) * kw);
      const corner = (a: number, b: number): Vector3 =>
        c.clone().addScaledVector(nOut, a * kd).addScaledVector(UP, b * kh);
      grid.push([corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)]);
      uvg.push([
        [i * kw * 2, 0],
        [i * kw * 2, kd * 2],
        [i * kw * 2, kd * 2 + kh * 2],
        [i * kw * 2, kd * 4 + kh * 2],
      ]);
    }
    acc.addGrid(grid, uvg, true);
  }

  /* Two ends. Deliberately SHORT of the authored `obiTailH` and splayed off centre: with no cloth
   * solver they are rigid to the pelvis, and a full-length pair hanging dead centre is exactly
   * where mae-geri puts a knee. 0.62 of the authored drop clears the jacket hem and still reads. */
  for (const side of [-1, 1] as const) {
    const grid: Vector3[][] = [];
    const uvg: [number, number][][] = [];
    const tw = 0.013 * S;
    const td = 0.0035 * S;
    const len = OBI_TAIL_FRAC * S * 0.62;
    const ROWS = 7;
    for (let i = 0; i < ROWS; i++) {
      const s = i / (ROWS - 1);
      const drop = len * s;
      const c = knotC
        .clone()
        .addScaledVector(across, side * (0.016 * S + 0.020 * S * s))
        .addScaledVector(UP, -drop - halfW * 0.5)
        .addScaledVector(nOut, -0.004 * S * s);
      // Rows run downward, so `axis = -UP` and `axis × nOut = -across` — hence the minus.
      const corner = (a: number, b: number): Vector3 =>
        c.clone().addScaledVector(nOut, a * td).addScaledVector(across, -b * tw);
      grid.push([corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)]);
      uvg.push([
        [drop, 0],
        [drop, td * 2],
        [drop, td * 2 + tw * 2],
        [drop, td * 4 + tw * 2],
      ]);
    }
    acc.addGrid(grid, uvg, true);
  }

  acc.patch(first, torso, torso);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 7. SKINNING BY TRANSFER, AND THE PUSHOUT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Each garment vertex takes the inverse-square-distance blend of its `TRANSFER_K` nearest body
 * vertices' weights, restricted to the part's own bone region.
 *
 * Brute force, on purpose. The worst case here is the jacket's ~700 vertices against the torso's
 * ~3 k, which is 2 M squared-distance evaluations and about 15 ms — once, at attach. A grid or a
 * k-d tree would be faster and would also be a second thing that can be wrong, in a file where a
 * wrong weight does not throw, it just makes the gi swim.
 */
function transferWeights(
  acc: Accum,
  body: Body,
  out: { idx: Uint16Array; wt: Float32Array },
): void {
  const nearIdx = new Int32Array(TRANSFER_K);
  const nearD2 = new Float64Array(TRANSFER_K);

  for (const patch of acc.patches) {
    if (patch.weightIds.length === 0) continue;
    for (let g = patch.first; g < patch.first + patch.count; g++) {
      const gx = acc.pos[g * 3]!;
      const gy = acc.pos[g * 3 + 1]!;
      const gz = acc.pos[g * 3 + 2]!;
      nearIdx.fill(-1);
      nearD2.fill(Infinity);
      for (const i of patch.weightIds) {
        const dx = body.pos[i * 3]! - gx;
        const dy = body.pos[i * 3 + 1]! - gy;
        const dz = body.pos[i * 3 + 2]! - gz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= nearD2[TRANSFER_K - 1]!) continue;
        let k = TRANSFER_K - 1;
        while (k > 0 && nearD2[k - 1]! > d2) {
          nearD2[k] = nearD2[k - 1]!;
          nearIdx[k] = nearIdx[k - 1]!;
          k--;
        }
        nearD2[k] = d2;
        nearIdx[k] = i;
      }

      const acc4 = new Map<number, number>();
      for (let k = 0; k < TRANSFER_K; k++) {
        const i = nearIdx[k]!;
        if (i < 0) continue;
        /* Inverse SQUARE distance, floored at 1 mm². Plain 1/d makes a garment vertex equidistant
         * from two body vertices average them; 1/d² makes the nearer one dominate, which is what
         * keeps a trouser vertex 3 mm off the shin from picking up any of the thigh behind it. */
        const w = 1 / Math.max(nearD2[k]!, 1e-6);
        for (let c = 0; c < 4; c++) {
          const bw = body.sw[i * 4 + c]!;
          if (bw <= 0) continue;
          const b = body.si[i * 4 + c]!;
          acc4.set(b, (acc4.get(b) ?? 0) + bw * w);
        }
      }
      writeTop4(acc4, out, g);
    }
  }

  smoothWeights(acc, out);
}

function writeTop4(
  src: ReadonlyMap<number, number>,
  out: { idx: Uint16Array; wt: Float32Array },
  g: number,
): void {
  const pairs = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_INFLUENCES);
  let total = 0;
  for (const [, w] of pairs) total += w;
  for (let k = 0; k < MAX_INFLUENCES; k++) {
    const pr = pairs[k];
    out.idx[g * MAX_INFLUENCES + k] = pr ? pr[0] : 0;
    out.wt[g * MAX_INFLUENCES + k] = pr && total > 0 ? pr[1] / total : 0;
  }
}

/**
 * Laplacian smoothing over each grid's own (row, col) neighbourhood.
 *
 * Nearest-neighbour transfer is piecewise constant wherever the body's own weights step — across
 * the seam between two mannequin panels, or where a trouser vertex switches from thigh-nearest to
 * shin-nearest. Left alone those steps become creases in the deformation: a ring of the trouser
 * rotates with the shin while the ring 2 cm above it does not. Three passes at half weight spread
 * each step over about five rings, which is roughly the length a real seam distributes a bend over.
 */
function smoothWeights(acc: Accum, out: { idx: Uint16Array; wt: Float32Array }): void {
  const n = acc.count;
  const rowOf = (g: number): Map<number, number> => {
    const m = new Map<number, number>();
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const w = out.wt[g * MAX_INFLUENCES + k]!;
      if (w > 0) m.set(out.idx[g * MAX_INFLUENCES + k]!, w);
    }
    return m;
  };

  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const cur: Map<number, number>[] = new Array(n);
    for (let g = 0; g < n; g++) cur[g] = rowOf(g);
    for (const grid of acc.grids) {
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const g = grid.first + r * grid.cols + c;
          const blend = new Map<number, number>();
          const add = (src: Map<number, number>, w: number): void => {
            for (const [b, v] of src) blend.set(b, (blend.get(b) ?? 0) + v * w);
          };
          add(cur[g]!, 1);
          let count = 0;
          const push = (rr: number, cc: number): void => {
            if (rr < 0 || rr >= grid.rows) return;
            const c2 = grid.wrap ? (cc + grid.cols) % grid.cols : cc;
            if (c2 < 0 || c2 >= grid.cols) return;
            add(cur[grid.first + rr * grid.cols + c2]!, 0.25);
            count++;
          };
          push(r - 1, c);
          push(r + 1, c);
          push(r, c - 1);
          push(r, c + 1);
          if (count === 0) continue;
          writeTop4(blend, out, g);
        }
      }
    }
  }
}

/**
 * Move any garment vertex that ended up inside the body back out, to `PUSHOUT_CLEAR_FRAC` of
 * stature (6 mm here) measured against the nearest body vertex's TANGENT PLANE.
 *
 * Plane, not point: on a mesh this coarse — ~2 cm between vertices — a point-to-point distance test
 * calls a vertex sitting 5 mm under a flat panel "18 mm away, fine" whenever the nearest vertex is
 * off to one side. `dot(g - b, n_b)` is signed and asks the only question that matters, which side
 * of the surface the vertex is on.
 *
 * A light Laplacian pass follows each pushout because the correction is per-vertex and the nearest
 * body vertex changes discontinuously; without it a resolved penetration leaves a visible pucker.
 */
function pushOut(acc: Accum, body: Body, clear: number): void {
  for (let pass = 0; pass < PUSHOUT_PASSES; pass++) {
    for (const patch of acc.patches) {
      if (patch.pushIds.length === 0) continue;
      for (let g = patch.first; g < patch.first + patch.count; g++) {
        const gx = acc.pos[g * 3]!;
        const gy = acc.pos[g * 3 + 1]!;
        const gz = acc.pos[g * 3 + 2]!;
        let bestD2 = Infinity;
        let best = -1;
        for (const i of patch.pushIds) {
          const dx = body.pos[i * 3]! - gx;
          const dy = body.pos[i * 3 + 1]! - gy;
          const dz = body.pos[i * 3 + 2]! - gz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
        if (best < 0) continue;
        const nx = body.nrm[best * 3]!;
        const ny = body.nrm[best * 3 + 1]!;
        const nz = body.nrm[best * 3 + 2]!;
        const d =
          (gx - body.pos[best * 3]!) * nx +
          (gy - body.pos[best * 3 + 1]!) * ny +
          (gz - body.pos[best * 3 + 2]!) * nz;
        if (d >= clear) continue;
        const k = clear - d;
        acc.pos[g * 3] = gx + nx * k;
        acc.pos[g * 3 + 1] = gy + ny * k;
        acc.pos[g * 3 + 2] = gz + nz * k;
      }
    }
    relaxPositions(acc, 0.28);
  }
}

/** One Laplacian pass over the grid neighbourhood, `lambda` toward the neighbour mean. */
function relaxPositions(acc: Accum, lambda: number): void {
  const src = Float64Array.from(acc.pos);
  for (const grid of acc.grids) {
    for (let r = 1; r + 1 < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const g = grid.first + r * grid.cols + c;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        const add = (rr: number, cc: number): void => {
          if (rr < 0 || rr >= grid.rows) return;
          const c2 = grid.wrap ? (cc + grid.cols) % grid.cols : cc;
          if (c2 < 0 || c2 >= grid.cols) return;
          const h = grid.first + rr * grid.cols + c2;
          sx += src[h * 3]!;
          sy += src[h * 3 + 1]!;
          sz += src[h * 3 + 2]!;
          n++;
        };
        add(r - 1, c);
        add(r + 1, c);
        add(r, c - 1);
        add(r, c + 1);
        if (n === 0) continue;
        acc.pos[g * 3] = src[g * 3]! + lambda * (sx / n - src[g * 3]!);
        acc.pos[g * 3 + 1] = src[g * 3 + 1]! + lambda * (sy / n - src[g * 3 + 1]!);
        acc.pos[g * 3 + 2] = src[g * 3 + 2]! + lambda * (sz / n - src[g * 3 + 2]!);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 8. MATERIALS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * §3.4.1's `MaterialSet`, restated structurally and narrowed to the two keys a gi needs — the same
 * move `src/rig/karateka.ts` makes with `RigMaterialSet`, and for the same reason: B5 owns the type,
 * and `createMaterials()` satisfies this by shape without B6 taking a hard edge on it.
 */
export interface GiMaterials {
  readonly M_GI?: Material;
  readonly M_OBI?: Material;
}

/**
 * The fallback look, for a caller with no `MaterialSet` (tests, and `attachGi(character)` from the
 * console). §5.6's `M_GI` verbatim, down to the weave normal — which is `src/rig`'s procedural
 * `DataTexture`, not a fetch, because "everything generated in code" is the project idiom and
 * because a texture that has to load is a texture that is absent on frame one.
 */
function fallbackMaterials(): {
  M_GI: Material;
  M_OBI: Material;
  owned: readonly { dispose(): void }[];
} {
  const weave = makeWeaveNormal();
  weave.normal.repeat.set(GI_WEAVE_REPEAT_PER_M[0], GI_WEAVE_REPEAT_PER_M[1]);

  const M_GI = new MeshPhysicalMaterial({
    name: 'M_GI_fallback',
    color: new Color(0xf2f0ea), // never pure white; it clips under AgX
    roughness: 0.78,
    metalness: 0,
    sheen: 0.45,
    sheenColor: new Color(0xe8e4da),
    sheenRoughness: 0.55,
    specularIntensity: 0.35,
    ior: 1.45,
    normalMap: weave.normal,
  });
  M_GI.normalScale.set(0.6, 0.6);

  const M_OBI = new MeshPhysicalMaterial({
    name: 'M_OBI_fallback',
    color: new Color(0x14110f),
    roughness: 0.72,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.6,
    specularIntensity: 0.3,
  });

  return { M_GI, M_OBI, owned: [M_GI, M_OBI, weave.normal] };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 9. THE ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface GiStats {
  readonly vertices: number;
  readonly triangles: number;
  /** One per material. Everything on `M_GI` is ONE merged mesh; the obi is the second. */
  readonly drawCalls: number;
  /** The stature every dimension was scaled by, in metres. */
  readonly statureM: number;
}

export interface GiHandle {
  readonly meshes: readonly SkinnedMesh[];
  readonly stats: GiStats;
  dispose(): void;
}

/**
 * Deliberately NOT `gi_uwagi` / `gi_obi`: `src/rig/karateka.ts` already puts meshes of those names
 * in the scene for the retired procedural figure, and two objects sharing a name is how a
 * `getObjectByName` in some future debug console silently retires the wrong one.
 */
const GI_MESH_NAMES = ['karateka_gi', 'karateka_obi'] as const;

/**
 * Build a gi for `character` and add it to the scene graph beside the body.
 *
 * Returns `null`-free: a character with no skinned mesh, or with no resolvable pelvis, throws
 * rather than silently attaching nothing — an invisible gi and a missing gi look identical from the
 * outside, and the second one at least says which bone map failed.
 */
export function attachGi(character: Character, materials?: GiMaterials): GiHandle {
  /* Re-attaching is the console workflow (`attachGi(c)` twice while tuning), so retire an existing
   * gi first instead of stacking a second one on the same skeleton. */
  for (const nm of GI_MESH_NAMES) {
    const old = character.root.getObjectByName(nm);
    if (old !== undefined) {
      const m = old as SkinnedMesh;
      m.removeFromParent();
      m.geometry.dispose();
    }
  }

  const body = gatherBody(character);
  if (body === null) throw new Error('attachGi: the character carries no SkinnedMesh');
  const lm = landmarksOf(body);
  if (lm === null) {
    throw new Error(
      `attachGi: rig flavour '${character.flavour}' resolved no pelvis/neck/shoulder — ` +
        'CONTRACT_TO_RIGIFY / CONTRACT_TO_MIXAMO in ./character.ts is what maps them',
    );
  }

  const shell = jacketShell(body, lm);

  const cloth = new Accum();
  buildJacket(cloth, body, lm, shell);
  buildSleeve(cloth, body, lm, 'L');
  buildSleeve(cloth, body, lm, 'R');
  buildTrouser(cloth, body, lm, 'L');
  buildTrouser(cloth, body, lm, 'R');
  buildCollar(cloth, body, lm, shell);

  const obi = new Accum();
  buildObi(obi, body, lm, shell);

  const clear = PUSHOUT_CLEAR_FRAC * lm.S;
  pushOut(cloth, body, clear);
  pushOut(obi, body, clear * 1.6);

  const mats = materials ?? {};
  const fb = mats.M_GI !== undefined && mats.M_OBI !== undefined ? null : fallbackMaterials();
  const M_GI = mats.M_GI ?? fb!.M_GI;
  const M_OBI = mats.M_OBI ?? fb!.M_OBI;

  const meshes: SkinnedMesh[] = [
    finalise(cloth, body, GI_MESH_NAMES[0], M_GI),
    finalise(obi, body, GI_MESH_NAMES[1], M_OBI),
  ];

  let vertices = 0;
  let triangles = 0;
  for (const m of meshes) {
    vertices += m.geometry.getAttribute('position').count;
    triangles += (m.geometry.getIndex()?.count ?? 0) / 3;
  }

  return {
    meshes,
    stats: { vertices, triangles, drawCalls: meshes.length, statureM: lm.S },
    dispose(): void {
      for (const m of meshes) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      if (fb !== null) for (const x of fb.owned) x.dispose();
    },
  };
}

/** Weights, buffers, bind, parent. The last step, identical for both meshes. */
function finalise(acc: Accum, body: Body, name: string, material: Material): SkinnedMesh {
  const n = acc.count;
  const w = { idx: new Uint16Array(n * MAX_INFLUENCES), wt: new Float32Array(n * MAX_INFLUENCES) };
  transferWeights(acc, body, w);

  const g = new BufferGeometry();
  g.name = name;
  g.setAttribute('position', new BufferAttribute(new Float32Array(acc.pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(acc.uv), 2));
  g.setIndex(new BufferAttribute(new Uint32Array(acc.idx), 1));
  g.setAttribute('skinIndex', new BufferAttribute(w.idx, MAX_INFLUENCES));
  g.setAttribute('skinWeight', new BufferAttribute(w.wt, MAX_INFLUENCES));
  g.computeVertexNormals();

  const mesh = new SkinnedMesh(g, material);
  mesh.name = name;
  /* Bound with an IDENTITY bind matrix because `gatherBody` already stored every position in
   * `bindMatrix · position` space. `bindMode` stays `AttachedBindMode`, so three refreshes
   * `bindMatrixInverse` from `matrixWorld` each frame and the character's own root transform
   * cancels exactly as it does for the body mesh. */
  mesh.bind(body.skeleton, new Matrix4());
  mesh.normalizeSkinWeights();
  /* §5.1: the karateka never frustum-culls — a skinned bounding volume is the BIND pose's, and a
   * kicking leg leaves it. */
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.attachTo.add(mesh);
  return mesh;
}
