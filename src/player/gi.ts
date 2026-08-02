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

/**
 * The same table's stated UNCERTAINTY on a value, so this file can sit at a defensible END of B1's
 * band instead of writing a different literal beside it and hoping nobody diffs the two.
 *
 * It matters for exactly one number here. `sleeveEndH` ships `0.255 ± 0.020 H` and is tagged `TRAD`
 * — the tolerance is not measurement error, it is the RANGE A TAILOR CUTS IN: 0.235 H lands two
 * thirds of the way down this figure's forearm and 0.275 H lands seven eighths of the way, and both
 * are legal kata cuts. At the low end the cuff sits close enough to the elbow that the eye reads
 * "no sleeve", which is the complaint this revision exists to answer, so the sleeve is cut at the
 * long end of what doc 06 §7.1 sanctions rather than at its midpoint.
 */
const CTOL = (k: string): number => {
  const v = CLOTH[k];
  if (!v) throw new Error(`gi: CLOTH.${k} missing — B1 owns it (src/data/constants/cloth.ts)`);
  return v.tol;
};

const HEM_FRAC = C('uwagiHemH'); //             0.400  jacket hem above the floor
const BELT_FRAC = C('beltLineH'); //            0.6145 obi centreline
/** 0.270 H — see `CTOL`. 0.494 m along this figure's arm, i.e. 80 % down a 0.273 m forearm. */
export const SLEEVE_END_FRAC = C('sleeveEndH') + 0.75 * CTOL('sleeveEndH');
const ZUBON_HEM_FRAC = C('zubonHemH'); //       0.100  trouser hem above the floor
const OBI_W_FRAC = C('obiWidthH'); //           0.024
const OBI_T_FRAC = C('obiThicknessH'); //       0.003  5.5 mm through — a belt END is a ribbon
const OBI_TAIL_FRAC = C('obiTailH'); //         0.160
const COLLAR_W_FRAC = C('collarBandWidthH'); // 0.023
const CHEST_EASE_FRAC = C('chestEaseH'); //     0.020  rule 1: the jacket is BOXY
const BELT_GATHER_FRAC = C('beltGatherH'); //   0.012  rule 8: only the belt line is tight
const OVERLAP_FRAC = C('frontOverlapH'); //     0.130  rule 4: left front panel over right
const SHELL_FRAC = C('fabricThicknessCm') / 100 / 1.75; // 0.63 mm as a fraction of stature
/** 0.0425 H = 7.8 cm between fold crowns. §7.10: 2 cm folds instantly read as jersey. */
const FOLD_WAVELENGTH_FRAC = C('foldWavelengthH');
/** 0.29 H = 0.53 m — a HEIGHT above the floor, and exactly this figure's knee joint. */
const KNEE_CREASE_FRAC = C('kneeCreaseH');
const KNEE_CREASE_INTENSITY = C('kneeCreaseIntensity'); // 0.6

/**
 * Fold depth, as a fraction of stature. 6.4 mm of crown over the eased radius.
 *
 * doc 06 §7.9 gives the WAVELENGTH and the fold count but not an amplitude, because in §7's world
 * the amplitude is an OUTPUT of the XPBD solve. There is no solve here (see the file header), so it
 * is an input, and it is set from the one thing that is checkable by eye: 12 oz duck folded over
 * itself is `2 × fabricThicknessCm` = 1.3 mm of pure cloth, and a fold in it stands about five
 * thicknesses proud before the weave forces it to break into two folds instead of one.
 */
const FOLD_AMP_FRAC = 0.0035;

/**
 * How far the jacket hem RISES over each hip, as a fraction of stature. 5.5 cm.
 *
 * The jacket is not actually slit here, and a real uwagi is: `sideVentH` (0.19 H = 0.35 m on this
 * figure) is the length of the open side seam that lets the front and back panels swing past each
 * other. A closed tube cannot have that seam, but it can show its CONSEQUENCE, which is the part
 * the eye actually reads — panels cut with a rise at the side seam so the slit does not gape, so
 * the hem line of a hanging gi is lowest at centre-front and centre-back and highest over the hips.
 * A dead-level hem is the single loudest tell that a garment was swept rather than cut, and it is
 * what made this one terminate in a "flat, hard-cut polygon flap".
 */
const HEM_VENT_RISE_FRAC = 0.030;

/**
 * Ease RATIOS, doc 06 §7.10 rules 2 and 3 read back off the authored radii:
 * `sleeveCuffRadiusH / STATION_R.forearm = 0.0335 / 0.0255 = 1.31`, and
 * `trouserHemRadiusH / STATION_R.ankle  = 0.0435 / 0.0200 = 2.18`. They are applied to the MEASURED
 * limb here, which is the only way the same silhouette survives a change of character.
 *
 * The shoulder end of each is deliberately much tighter — a gi sleeve is cut wide at the cuff and
 * merely loose at the armhole, and running 1.3 all the way up gives a clown's shirt.
 */
const SLEEVE_RATIO_ROOT = 1.22;
const SLEEVE_RATIO_CUFF = 1.44;
const TROUSER_RATIO_HIP = 1.10;
const TROUSER_RATIO_HEM = 1.95;

/** Minimum radial clearance, as a fraction of stature, where the ratio rule would be tighter. */
const SLEEVE_CLEAR_ROOT = 0.011;
const SLEEVE_CLEAR_CUFF = 0.019;
const TROUSER_CLEAR_HIP = 0.008;
const TROUSER_CLEAR_HEM = 0.026;

/**
 * Resolution. Every count here is a FOLD budget, not a smoothness budget.
 *
 * The old numbers (28/16/20/28) were chosen so a facet chord stayed under a centimetre, and they do
 * that. What they cannot do is carry a fold: `FOLD_WAVELENGTH_FRAC · S` is 7.8 cm, a 0.20 m jacket
 * ring is 1.26 m round, so a physically-sized fold repeats about sixteen times and 28 columns gives
 * it 1.75 samples — under Nyquist, which is to say the fold aliases into facet noise and the ring
 * comes back looking like the smooth inflated shell it was. `addFolds` clamps the count to `cols/3`
 * for exactly this reason, and these numbers are what that clamp needs to leave a fold intact.
 *
 * The trouser count is the other half of a specific defect: 20 columns put one flat quad across
 * the whole buttock, and `computeVertexNormals` averaged it into the hard shading facet that was
 * visible down the seat from any angle.
 */
const JACKET_COLS = 36;
const SLEEVE_COLS = 20;
const TROUSER_COLS = 26;
const OBI_COLS = 32;

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

/**
 * doc 06 §7.9's folds, written into a ring's radii.
 *
 * ═══ WHY THE COUNT IS DERIVED AND NOT WRITTEN DOWN ═══════════════════════════════════════════
 *
 * §7.9 specifies a WAVELENGTH (`foldWavelengthH`, 0.0425 H = 7.8 cm on this figure), and §7.10
 * spends a whole rule on why: the gi is 12 oz duck, folds in it are FEW and LARGE, and 2 cm folds
 * "instantly read as jersey". A wavelength is a physical length, so the number of folds around a
 * part is that part's own circumference divided by it — which means a sleeve gets four and a
 * trouser leg gets seven WITHOUT either number being typed anywhere, and both carry folds of the
 * same physical size. Typing per-part fold counts instead is how a sleeve ends up looking like it
 * is made of a different cloth than the trousers.
 *
 * The clamp to `cols / 3` is Nyquist with a margin: a fold sampled by two columns is a zigzag, and
 * `computeVertexNormals` shades a zigzag as noise rather than as cloth. Below four folds the ring
 * is too small to carry the wavelength at all and the modulation is better read as a soft oval.
 *
 * ═══ WHY THE FOLD ONLY EVER ADDS CLOTH ═══════════════════════════════════════════════════════
 *
 * `(1 − cos)/2` is in [0, 1], never negative. A symmetric ±amp fold would put every trough INSIDE
 * the support radius the ring was measured at — that is, inside the body — and hand §7's pushout a
 * fight it cannot win, because a trough is a shape this function ASKED for and the pushout has no
 * way to tell it apart from an error. Biasing the whole modulation outward costs half an amplitude
 * of extra ease, which on a garment whose defining property is looseness is not a cost.
 */
export function addFolds(r: Float64Array, S: number, amp: number, phase: number): void {
  if (!(amp > 0)) return;
  const cols = r.length;
  let mean = 0;
  for (const x of r) mean += x;
  mean /= cols;
  const wanted = Math.round((Math.PI * 2 * mean) / (FOLD_WAVELENGTH_FRAC * S));
  const k = Math.max(4, Math.min(Math.floor(cols / 3), wanted));
  for (let j = 0; j < cols; j++) {
    const phi = (j / cols) * Math.PI * 2;
    r[j] = r[j]! + amp * 0.5 * (1 - Math.cos(k * phi + phase));
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
  /**
   * Exempt from `relaxPositions`, though NOT from the pushout or the weight smoothing.
   *
   * ═══ MEASURED, AND IT IS NOT SMALL ═══════════════════════════════════════════════════════
   *
   * The Laplacian relaxation exists to remove the pucker a per-vertex pushout leaves on a big
   * swept panel, where a vertex's grid neighbours are 4 cm away and averaging toward them is
   * genuinely a smoothing operation. On a strap they are 4 MILLIMETRES away, across a corner the
   * section was authored to have, so the same average is a shrink: measured on the collar band,
   * two passes at λ = 0.28 took the 45 mm width to 42.9 mm and crushed the 8 mm thickness to
   * under 3 — which is precisely the "collar reads as a floating ribbon" this revision is
   * fixing, arriving by a completely different route than the shape did.
   *
   * The pushout still runs, because a strap can still end up inside the body and that is an
   * error rather than a design.
   */
  readonly rigid: boolean;
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
    rigid = false,
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
    const ref: GridRef = { first, rows, cols, wrap, rigid };
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
    /* The fold inherits the end ring's per-column height, or it flattens whatever shape the hem
     * line has. `HEM_VENT_RISE_FRAC` puts a 5.5 cm rise over each hip on the jacket's first ring;
     * a fold that ignored it would hang a level lip under a scalloped hem, which is worse than
     * either on its own — a level edge you can read as a design choice, a level edge peeking out
     * from under a scalloped one you can only read as a bug. */
    dy: end.dy === undefined ? undefined : Float64Array.from(end.dy),
  });
  return [mk(-depth, inward), mk(-0.06 * depth, inward), mk(0.35 * inward, inward * 0.45)];
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 5b. STRAPS — the swept solid the obi knot and its tails are made of
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A strap's cross-section: a rounded rectangle, CCW in the (thickness, width) plane so §2's one
 * winding still produces outward normals wherever the sweep frame satisfies `n × side = tangent`.
 *
 * Eight columns, not four. Four is what the obi tails were, and a four-corner box has three
 * problems at belt scale: its corners are perfectly sharp where doubled canvas is round, its
 * silhouette is the same rectangle from every angle, and `computeVertexNormals` averages a 90°
 * corner into a shading seam that runs the whole length of the strap and reads as a crease nobody
 * put there.
 */
const STRAP_SECTION: readonly (readonly [number, number])[] = Object.freeze([
  [1, 0.62],
  [0.5, 1],
  [-0.5, 1],
  [-1, 0.62],
  [-1, -0.62],
  [-0.5, -1],
  [0.5, -1],
  [1, -0.62],
]);

interface StrapPt {
  readonly c: Vector3;
  /** Which way the strap's face points. Re-orthogonalised against the local tangent. */
  readonly n: Vector3;
  /** Half-depth, i.e. how far the strap stands off its own face plane. */
  readonly halfT: number;
  /** Half-width, across the face. */
  readonly halfW: number;
}

/**
 * Sweep `STRAP_SECTION` along a polyline and CLOSE BOTH ENDS.
 *
 * ═══ THE CAPS ARE THE POINT ══════════════════════════════════════════════════════════════════
 *
 * Every free end the obi used to have was an open quad — both tails and the knot stub — and on a
 * FrontSide material an open end is not a subtle defect: the far wall of the strap is backfacing,
 * so you look straight through the belt into the interior of the figure, and the hole tracks the
 * camera because it is the silhouette of a rectangle seen edge-on. It is the same failure the
 * jacket and sleeve hems solve with `hemFold`, on a part small enough that nobody had noticed.
 *
 * Capped by scaling the end ring toward its own axis and sliding it past the end, rather than by a
 * triangle fan: the fan would need its own winding rule and its own UV convention, while two more
 * rings keep the grid rectangular and go through the same `addGrid`, the same Laplacian relaxation
 * and the same weight smoothing as everything else. The 6 %-scale final ring is a near-degenerate
 * octagon, not a point, so the normals at the tip stay finite.
 */
function emitStrap(acc: Accum, pts: readonly StrapPt[], capLen: number): void {
  const cols = STRAP_SECTION.length;
  const n = pts.length;

  /* Central differences, so an interior point's frame does not jump at a path vertex. */
  const tan: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!.c;
    const b = pts[Math.min(n - 1, i + 1)]!.c;
    const t = b.clone().sub(a);
    tan.push(t.lengthSq() < 1e-12 ? UP.clone() : t.normalize());
  }

  const mkRow = (i: number, scale: number, slide: number): Vector3[] => {
    const p = pts[i]!;
    const t = tan[i]!;
    const nRef = p.n.clone().addScaledVector(t, -p.n.dot(t));
    if (nRef.lengthSq() < 1e-10) nRef.copy(frame(t, UP).u);
    nRef.normalize();
    // `side = t × n` makes `n × side = t`, which is §2's handedness for this sweep.
    const side = new Vector3().crossVectors(t, nRef).normalize();
    const c = p.c.clone().addScaledVector(t, slide);
    return STRAP_SECTION.map(([a, b]) =>
      c
        .clone()
        .addScaledVector(nRef, a * p.halfT * scale)
        .addScaledVector(side, b * p.halfW * scale),
    );
  };

  const grid: Vector3[][] = [mkRow(0, 0.06, -capLen), mkRow(0, 0.63, -capLen * 0.45)];
  for (let i = 0; i < n; i++) grid.push(mkRow(i, 1, 0));
  grid.push(mkRow(n - 1, 0.63, capLen * 0.45), mkRow(n - 1, 0.06, capLen));

  /* Arc length along, perimeter across — `GI_UV_UNITS`, metres, same as every other part. */
  const uvg: [number, number][][] = [];
  let along = 0;
  for (let i = 0; i < grid.length; i++) {
    if (i > 0) {
      let step = 0;
      for (let j = 0; j < cols; j++) step += grid[i]![j]!.distanceTo(grid[i - 1]![j]!);
      along += step / cols;
    }
    const row: [number, number][] = [];
    let per = 0;
    for (let j = 0; j < cols; j++) {
      if (j > 0) per += grid[i]![j]!.distanceTo(grid[i]![j - 1]!);
      row.push([along, per]);
    }
    uvg.push(row);
  }
  acc.addGrid(grid, uvg, true, true);
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
  /* 0.008 H of flare, down from 0.012. The skirt still opens — rule 4 — but the last ring no
   * longer stands 2.2 cm clear of the thigh, which is what turned the hem into a rigid shelf with
   * a lip on it. The looseness the flare was carrying is now carried by `addFolds`, which puts the
   * same volume into the silhouette as SHAPE rather than as a uniformly larger circle. */
  return CHEST_EASE_FRAC * S - gather + 0.008 * S * drop;
}

/**
 * Fold depth at a given height on the jacket.
 *
 * Zero at the belt line, and that is doc 06 §7.10 rule 8 rather than a taste call: the obi is the
 * one place the garment is TIGHT, `beltGatherH` pulls the jacket in there, and cloth under tension
 * does not fold. Folding it anyway produces a ring of ripples exactly where the eye is looking for
 * a cinch, and the belt then reads as sitting on top of a gathered skirt instead of causing it.
 */
function jacketFoldAmp(lm: GiFit, y: number): number {
  const S = lm.S;
  const atBelt = Math.exp(-Math.pow((y - lm.yBelt) / (0.045 * S), 2));
  const skirt = Math.max(0, Math.min(1, (lm.yBelt - y) / (lm.yBelt - lm.yHem)));
  return FOLD_AMP_FRAC * S * (0.45 + 0.85 * skirt) * (1 - 0.9 * atBelt);
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
    /* Kept, so the fold can be added to the EASED radius and the result still clamped against the
     * bare support radius below. Folding after the clamp would let a trough eat the clearance. */
    const support = Float64Array.from(r);
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]! + ease, 0.03 * S);
    /* One phase for the whole jacket, so the ridges run VERTICALLY from the yoke to the hem —
     * which is what a garment hanging off a pair of shoulders does. A per-row phase would spiral
     * them, and a spiral on a heavy cotton skirt reads as a wrung-out towel. */
    addFolds(r, S, jacketFoldAmp(lm, y), 0.4);
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]!, support[j]! + 0.004 * S);
    return { centre, axis: UP, u, v, r };
  };

  /**
   * The hem line, per column, relative to `yHem`.
   *
   * `(1 − cos 2φ)/2` is 0 at centre-front and centre-back and 1 over each hip, which is exactly
   * where a vented uwagi rises — see `HEM_VENT_RISE_FRAC`. Decayed over 0.09 H of climb rather than
   * applied to the hem ring alone, so the rise is a curve in the panel and not a kink in its last
   * two rows.
   */
  const ventLift = (y: number, j: number): number => {
    const phi = (j / cols) * Math.PI * 2;
    const env = Math.max(0, 1 - (y - lm.yHem) / (0.09 * S));
    return HEM_VENT_RISE_FRAC * S * env * env * 0.5 * (1 - Math.cos(2 * phi));
  };

  /* Torso: hem -> cap base, 18 rows, ~4.3 cm apart on a 1.83 m figure. Four more than before, all
   * of them spent between the hip and the hem where the skirt has to bend around a raised thigh. */
  const N = 18;
  for (let i = 0; i < N; i++) {
    const y = lm.yHem + ((yCapBase - lm.yHem) * i) / (N - 1);
    const ids = y < yHip ? idsSkirt : idsTorso;
    const ring = mkRing(y, ids, 0.030 * S, jacketEase(lm, y));
    const lift = new Float64Array(cols);
    let any = false;
    for (let j = 0; j < cols; j++) {
      lift[j] = ventLift(y, j);
      if (lift[j]! > 1e-5) any = true;
    }
    rows.push(any ? { ...ring, dy: lift } : ring);
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
 * Ring stations along the arm, as fractions of stature measured from the SHOULDER JOINT.
 *
 * Not `i / (N - 1)`, because the two things a sleeve has to get right are not evenly spaced. The
 * first three are inside the jacket; the next three are a tight triple 2.2 cm apart that carries
 * the armhole seam (`SLEEVE_SEAM_SCALE`); the rest are even, because between the deltoid and the
 * cuff nothing happens that needs resolution beyond a fold.
 *
 * ═══ THE FIRST STATION IS 0.032 H INSIDE THE SHOULDER, AND THAT IS THE FIX ═══════════════════
 *
 * It used to be 0.011 H — 2 cm — which is enough to hide the tube's open root ring and nothing
 * else. The complaint this answers is that the sleeves read as separate objects lying next to the
 * jacket, and a 2 cm burial is exactly what that looks like: the sleeve emerges from the jacket
 * within one ring of its own root, so the two surfaces meet edge-to-edge at the deltoid with no
 * overlap, no seam and a visible diameter step wherever the measured arm and the measured torso
 * disagreed. At 0.032 H (5.9 cm) three rings are under the jacket, the pushout settles them onto
 * the deltoid where a real armhole's seam allowance sits, and what comes out of the jacket is a
 * sleeve that was already inside it.
 */
export function sleeveStations(endFrac: number): number[] {
  const head = [-0.032, -0.014, 0.004, 0.028, 0.040, 0.052, 0.072];
  const out = [...head];
  const REST = 8;
  const from = head[head.length - 1]!;
  for (let i = 1; i <= REST; i++) out.push(from + (endFrac - from) * (i / REST));
  return out;
}

/**
 * Per-station radius scale that turns three of those rings into a SEAM.
 *
 * A set-in sleeve is two pieces of cloth stitched together and turned, so the seam itself sits a
 * few millimetres PROUD and the cloth is pulled in on both sides of it. Modelled the other way
 * round here — a 4.5 % dip at the seam station with the neighbours left at full radius — because
 * that is what survives `computeVertexNormals` at this resolution: a raised ridge one ring wide
 * gets its normals averaged away, while a dip between two full rings keeps two shading breaks and
 * reads as a stitched line from two metres. On a 0.09 m sleeve the dip is 4 mm.
 *
 * It is also the difference between "the jacket has sleeves" and "the jacket has tubes near it":
 * the seam says WHERE the sleeve was joined, and a garment with a visible join is one garment.
 */
const SLEEVE_SEAM_SCALE: readonly number[] = Object.freeze([
  1, 1, 1, 1, 0.955, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
]);

/**
 * A sleeve: a wide tube along the arm, ending at `SLEEVE_END_FRAC` (0.270 H from the shoulder
 * joint) — the long end of doc 06 §7.1's kata cut, 80 % down this figure's forearm.
 *
 * Its weights come from the clavicle as much as the upper arm, which is what keeps the two surfaces
 * moving together when the arm lifts: the body's own clavicle->deltoid blend is inherited wholesale
 * by the transfer.
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

  const stations = sleeveStations(SLEEVE_END_FRAC);
  const N = stations.length;
  const cols = SLEEVE_COLS;
  const rings: Ring[] = [];
  for (let i = 0; i < N; i++) {
    const t = stations[i]! * S;
    /* Progress along the VISIBLE sleeve, so the ease ramp and the folds are indexed from the
     * armhole rather than from a station buried in the chest. */
    const s = Math.max(0, Math.min(1, stations[i]! / SLEEVE_END_FRAC));
    const centre = sjc.clone().addScaledVector(axis, t);
    const { u, v } = frame(axis, UP);
    const r = new Float64Array(cols);
    if (!supportRing(body, measure, { centre, axis, u, v }, 0.022 * S, cols, r) && rings.length) {
      r.set(rings[rings.length - 1]!.r);
    }
    smoothRing(r, 2);
    const support = Float64Array.from(r);
    const ratio = SLEEVE_RATIO_ROOT + (SLEEVE_RATIO_CUFF - SLEEVE_RATIO_ROOT) * Math.pow(s, 0.7);
    const clear = (SLEEVE_CLEAR_ROOT + (SLEEVE_CLEAR_CUFF - SLEEVE_CLEAR_ROOT) * s) * S;
    const seam = SLEEVE_SEAM_SCALE[i] ?? 1;
    for (let j = 0; j < cols; j++) {
      r[j] = Math.max(r[j]! * ratio, r[j]! + clear, 0.025 * S) * seam;
    }
    /* Folds grow toward the cuff. A gi sleeve is pinned at the armhole and free at the mouth, so
     * that is the end the slack collects at — and it is the end an oi-zuki whips, which is where
     * §7.10 says the flare is "the single most identifiable gi feature in motion". */
    addFolds(r, S, FOLD_AMP_FRAC * S * (0.25 + 0.95 * s), 1.1);
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]!, support[j]! + 0.005 * S);
    rings.push({ centre, axis, u, v, r });
  }

  const first = acc.count;
  const cuff = rings[rings.length - 1]!;
  /* 0.006 H of turn-back, down from 0.009: the old step pulled the cuff mouth 1.6 cm tighter than
   * the sleeve behind it, which read as the sleeve TAPERING to a close rather than as a hem, and
   * cost the garment most of the length it actually had. */
  emitTube(acc, [...rings, ...hemFold(cuff, axis, 0.006 * S, 0.024 * S).reverse()]);
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

  /* 17 rows, up from 13. The extra four all land between the hip and the knee, which is the span
   * that was rendering as one uninterrupted balloon: at 13 rows that segment got four rings over
   * 0.40 m, so the seat and the thigh were the same quad and `computeVertexNormals` averaged the
   * whole buttock into the single hard shading facet visible down the seat from any angle. */
  const N = 17;
  const cols = TROUSER_COLS;
  const yKnee = KNEE_CREASE_FRAC * S;
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
    const support = Float64Array.from(r);
    /* `s` runs hip -> hem, and the flare is strongest at the hem, so the ratio LAGS: `s^1.6` keeps
     * the thigh close and opens the last third, which is where the fabric actually swings. */
    const k = Math.pow(s, 1.6);
    const ratio = TROUSER_RATIO_HIP + (TROUSER_RATIO_HEM - TROUSER_RATIO_HIP) * k;
    const clear = (TROUSER_CLEAR_HIP + (TROUSER_CLEAR_HEM - TROUSER_CLEAR_HIP) * k) * S;
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]! * ratio, r[j]! + clear, 0.030 * S);

    /**
     * doc 06 §7.9's knee crease. `kneeCreaseH` is 0.29 H, which on this figure is 0.530 m — the
     * height of its knee joint to within 2 mm, so the constant is read as the HEIGHT it is rather
     * than as a fraction along the leg, and it lands on the joint for any character.
     *
     * A trouser knee does two things at once and both are here: the cloth is pulled tight ACROSS
     * the cap, and it bunches into a short stack of hard folds just above and below it. Without
     * them a zubon leg is a cone, and a cone bending in the middle is the most obvious way for a
     * garment to announce that it is a swept surface.
     */
    const kneeNear = Math.exp(-Math.pow((centre.y - yKnee) / (0.038 * S), 2));
    const pinch = 1 - 0.05 * KNEE_CREASE_INTENSITY * kneeNear;
    for (let j = 0; j < cols; j++) r[j] = r[j]! * pinch;
    addFolds(r, S, FOLD_AMP_FRAC * S * (0.35 + 0.7 * k + 0.8 * kneeNear), 0.75);
    for (let j = 0; j < cols; j++) r[j] = Math.max(r[j]!, support[j]! + 0.006 * S);
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
  /* 0.0248 H = 4.5 cm, half a tolerance above `collarBandWidthH`'s 0.023 H. A gi collar is 4–5 cm
   * and the eye reads its WIDTH as the garment's weight, so this sits at the wide end of B1's band
   * rather than at its centre — see `CTOL`. */
  const halfW = ((COLLAR_W_FRAC + 0.5 * CTOL('collarBandWidthH')) * S) / 2;
  /* 4 mm half-depth, so the band is 8 mm through — two layers of 12 oz duck plus the canvas strip
   * that stiffens a real eri. Down from 0.0032 H (11.7 mm), which was not the problem: the band
   * read thin because it was a FLAT four-corner ribbon lying almost flush, not because it was
   * shallow, and `STRAP_SECTION`'s rounded profile is what fixes that. */
  const halfT = 0.0022 * S;

  const rowTop = shell.pts.length - 1;
  const yTop = shell.rowY[rowTop]!;
  /**
   * Where the two lapels cross: 0.060 H (11 cm) above the belt centreline, i.e. at the xiphoid.
   *
   * NOT at the belt, which is where the old band stopped. A gi's lapels cross at the solar plexus
   * and the single visible edge then runs on DOWN across the skirt to the hem — that long diagonal
   * over the thigh is half of what says "gi" at a distance, and cutting the band off at the obi
   * removed it, leaving a band that started at the neck, ended in mid-chest and was attached to
   * nothing at either end. That is the "floating band around the neck".
   */
  const yCross = lm.yBelt + 0.060 * S;
  const yEnd = lm.yHem + 0.010 * S;
  /* The right lapel's cap, tucked 0.015 H under the left one rather than butted against it. */
  const yUnder = yCross - 0.015 * S;

  /**
   * The band is ASYMMETRIC, because a gi's front is.
   *
   * The right panel goes on first and the LEFT panel wraps over it, so the left panel's collared
   * edge does not stop at the sternum — it carries on across the body and down to the hem at the
   * wearer's RIGHT hip. `frontOverlapH` (0.130 H) is exactly that carry, as ARC, so dividing it by
   * the jacket's own mean belt radius turns it into the azimuth the lower end lands at (−40° on
   * this figure) and keeps it 0.130 H if the torso profile is ever retuned.
   *
   * The right panel's edge is the mirror image, but only ABOVE the crossing: below it the left
   * panel is on top and the right one is not there to be seen. Ending it at the crossing is what
   * turns a symmetric ✗ into the ✓-over-✓ a karateka's chest actually shows.
   */
  const beltRing = shell.rings[Math.round(rowAtY(shell, lm.yBelt))]!;
  let rBelt = 0;
  for (const x of beltRing.r) rBelt += x;
  rBelt /= beltRing.r.length;
  const phiHem = Math.min(0.95, Math.max(0.25, (OVERLAP_FRAC * S) / 2 / rBelt));
  /* 32° at the shoulder, the lapel angle `src/rig/giMesh.ts`'s collar sweep was authored with. */
  const phiTop = 0.56;

  /**
   * Azimuth of the LEFT lapel's centreline at a height. Zero at the crossing by construction, so
   * the two lapels meet exactly where they are supposed to whatever the torso profile does.
   *
   * `^0.8` above the crossing: the edge opens quickly off the sternum and then runs nearly
   * vertical up the chest to the neck, which is the shape of a lapel that has to clear a collarbone
   * on its way past. Straight below it, because below the obi there is nothing to clear.
   */
  const phiOf = (y: number): number =>
    y >= yCross
      ? phiTop * Math.pow((y - yCross) / Math.max(1e-6, yTop - yCross), 0.8)
      : -phiHem * ((yCross - y) / Math.max(1e-6, yCross - yEnd));

  /**
   * How far the LEFT lapel rides proud of the shell, by height.
   *
   * Full 0.006 H below the crossing — where it is lying on top of the right lapel and has to clear
   * that band's whole 8 mm section, not just avoid z-fighting with the jacket — and ramped to zero
   * over the 0.09 H above it, where the two lapels have diverged and there is nothing underneath.
   * A constant offset would float the band off the back of the neck, which is the one place on the
   * garment where there is no second layer to justify it.
   */
  const proudOf = (y: number): number =>
    0.0055 * S * Math.max(0, Math.min(1, (yCross + 0.09 * S - y) / (0.09 * S)));

  const pts: StrapPt[] = [];
  const push = (y: number, phi: number, proud: number): void => {
    const row = rowAtY(shell, y);
    const c = shellAt(shell, row, phi, new Vector3());
    const n = shellNormal(shell, row, phi, new Vector3());
    pts.push({
      c: c.addScaledVector(n, SHELL_FRAC * S + halfT * 0.55 + proud),
      n,
      halfT,
      halfW,
    });
  };

  /* [1] RIGHT lapel, from under the crossing UP to the neck opening. Swept with NEGATIVE azimuth
   * so the whole strip stays monotone in φ: it continues round the back of the neck the long way
   * and comes down the left, which is what keeps `shellAt`'s wrap from folding the band back on
   * itself. */
  const A = 12;
  for (let i = 0; i <= A; i++) {
    const y = yUnder + (yTop - yUnder) * (i / A);
    push(y, -phiOf(y), 0);
  }
  /* [2] Round the back of the neck, at the collar opening. */
  const B = 10;
  for (let i = 1; i <= B; i++) {
    push(yTop, -phiTop - (Math.PI * 2 - 2 * phiTop) * (i / B), 0);
  }
  /* [3] LEFT lapel, neck opening down to the HEM — the long diagonal across the skirt. Twenty
   * samples, because this leg is 0.75 m of path against the right lapel's 0.34 m and a band that
   * chorded across the hip would lift off the shell exactly where the thigh is about to move. */
  const L = 20;
  for (let i = 1; i <= L; i++) {
    const y = yTop + (yEnd - yTop) * (i / L);
    push(y, phiOf(y) - Math.PI * 2, proudOf(y));
  }

  const first = acc.count;
  /* Capped at both ends. The old strip was `addGrid(..., wrap = true)`, which closes the band
   * around its own section but leaves ROW 0 and row n−1 open — two rectangular holes, one at the
   * crossing and one at the belt, through which a FrontSide material shows the inside of the
   * figure. `emitStrap` closes them, which also gives the lapel a finished end at the hem. */
  emitStrap(acc, pts, halfT * 1.4);
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

  const bandFirst = acc.count;

  /**
   * The band. Six rows, not four, because a black belt is wrapped TWICE.
   *
   * The extra pair buys a groove down the centreline of the band, and that groove is the whole
   * difference between a belt and a painted stripe: it is the seam between the two wraps, it is
   * the only horizontal line on a garment made entirely of vertical ones, and being a RECESS it
   * reads as a shadow under every lighting angle rather than as a highlight that vanishes when the
   * key moves. Radii are read off the jacket it sits on, so it follows the gather rather than
   * hovering at a radius of its own.
   */
  const rings: Ring[] = [];
  const p = new Vector3();
  for (const [dyF, tuckF] of [
    [-1.0, 0.0034],
    [-0.68, 0.0100],
    [-0.12, 0.0072],
    [0.12, 0.0072],
    [0.68, 0.0100],
    [1.0, 0.0034],
  ] as const) {
    const y = lm.yBelt + halfW * dyF;
    const centre = spineAt(lm, y, new Vector3());
    const { u, v } = frame(UP, FWD);
    const r = new Float64Array(cols);
    const rf = rowAtY(shell, y);
    for (let j = 0; j < cols; j++) {
      const phi = (j / cols) * Math.PI * 2;
      shellAt(shell, rf, phi, p);
      /* The crown rows have to clear the LEFT lapel, which passes under the obi and stands
       * `SHELL + halfT·1.55 + proud` = 0.0170 m proud of the jacket there. A belt that does not
       * cover it leaves a white flap lying across the black, which was visible. */
      r[j] = Math.hypot(p.x - centre.x, p.z - centre.z) + tuckF * S;
    }
    rings.push({ centre, axis: UP, u, v, r });
  }
  emitTube(acc, rings);
  acc.patch(bandFirst, torso, torso);

  /* ── the knot ────────────────────────────────────────────────────────────────────────────────
   *
   * ═══ WHY THIS IS WORTH THE VERTICES ═══════════════════════════════════════════════════════
   *
   * It is the visual centre of the uniform. It sits at the navel, it is the only place on a gi
   * where the cloth is bunched rather than hanging, and it is the one detail everyone who has
   * worn one checks first — a belt without it is a hoop, and a hoop is what the last version was.
   * doc 06 §7.3 lists `obi_knot` under the parts that are PURE SKINNING and rigid to `pelvis`, so
   * it costs nothing at runtime beyond its own triangles.
   *
   * Built as what it physically is: a bunched core with one strand passing over it and tucking
   * back under the wraps at both ends. Not a box — a box is what a stub of band looks like, and
   * the previous one was exactly that, two quads with open sides.
   */
  const knotFirst = acc.count;
  const rfBelt = rowAtY(shell, lm.yBelt);
  const front = shellAt(shell, rfBelt, 0, new Vector3());
  const nOut = shellNormal(shell, rfBelt, 0, new Vector3());
  /** Wearer's LEFT: `UP × nOut` with nOut forward is +X, and §2's frame puts LEFT on +X. */
  const across = new Vector3().crossVectors(UP, nOut).normalize();

  const knotHalfAcross = 0.023 * S; // 8.4 cm wide — a hand's breadth, which is what a knot is
  const knotHalfUp = 0.0135 * S; //    4.9 cm tall — one belt width, which is what it is made of
  const knotHalfOut = 0.0072 * S; //   2.6 cm proud of the band

  /* Sunk 35 % of its own depth into the band, because a knot is not an object resting on a belt,
   * it IS the belt with the slack pulled through itself. Floating it clear leaves a shadow gap
   * that reads as a brooch. */
  const knotC = front.clone().addScaledVector(nOut, 0.0100 * S + knotHalfOut * 0.35);

  const knotPt = (a: number, u: number, o: number, ht: number, hw: number): StrapPt => ({
    c: knotC
      .clone()
      .addScaledVector(across, a)
      .addScaledVector(UP, u)
      .addScaledVector(nOut, o),
    n: nOut,
    halfT: ht,
    halfW: hw,
  });

  /* The core: the bunched wraps, tapering and curving back toward the body at both ends. */
  emitStrap(
    acc,
    [
      knotPt(-knotHalfAcross * 0.92, 0, -0.005 * S, knotHalfOut * 0.72, knotHalfUp * 0.82),
      knotPt(-knotHalfAcross * 0.5, 0, 0.001 * S, knotHalfOut * 0.94, knotHalfUp * 0.97),
      knotPt(0, 0, 0, knotHalfOut, knotHalfUp),
      knotPt(knotHalfAcross * 0.5, 0, 0.001 * S, knotHalfOut * 0.94, knotHalfUp * 0.97),
      knotPt(knotHalfAcross * 0.92, 0, -0.005 * S, knotHalfOut * 0.72, knotHalfUp * 0.82),
    ],
    knotHalfOut * 1.3,
  );

  /* The strand pulled through: it rises over the core's crown and dives back UNDER the band at
   * both ends, which is the read that turns a lump into a knot. Its ends finish inside the band
   * (0.006 H in from a band surface 0.0100 H proud), so they are genuinely tucked, not butted. */
  const strandHalfW = 0.0115 * S; // 4.2 cm — one belt width, the strand IS the belt
  emitStrap(
    acc,
    [
      knotPt(0, -0.030 * S, -0.006 * S, 0.0030 * S, strandHalfW * 0.86),
      knotPt(0, -0.016 * S, 0.008 * S, 0.0042 * S, strandHalfW),
      knotPt(0, 0, knotHalfOut * 0.62, 0.0045 * S, strandHalfW),
      knotPt(0, 0.016 * S, 0.008 * S, 0.0042 * S, strandHalfW),
      knotPt(0, 0.030 * S, -0.006 * S, 0.0030 * S, strandHalfW * 0.86),
    ],
    0.004 * S,
  );

  /**
   * The two ends.
   *
   * ═══ SAMPLED ON THE JACKET, NOT DROPPED FROM THE KNOT ════════════════════════════════════
   *
   * The old pair hung on a straight line from the knot while the skirt they hang over FLARES, so
   * they sank into the jacket somewhere around mid-thigh and came back out lower down. Each sample
   * is placed on the shell at its own height and pushed out by the belt's own thickness instead,
   * which is what a hanging tail does: it lies on whatever the garment under it is doing.
   *
   * ═══ AND THEY ARE NOT THE SAME LENGTH ════════════════════════════════════════════════════
   *
   * 0.62 and 0.55 of `obiTailH`. Both are short of the authored 0.160 H, deliberately: with no
   * cloth solver these are rigid to the pelvis, and a full-length pair hanging dead centre is
   * exactly where mae-geri puts a knee. The asymmetry is free realism — nobody ties a belt with
   * two equal ends, and a matched pair is a tell that something was mirrored rather than tied.
   */
  const tailHalfT = (OBI_T_FRAC * S) / 2;
  for (const [side, lenF] of [
    [-1, 0.62],
    [1, 0.55],
  ] as const) {
    const len = OBI_TAIL_FRAC * S * lenF;
    const yTop = lm.yBelt - knotHalfUp * 0.85;
    const ROWS = 9;
    const pts: StrapPt[] = [];
    for (let i = 0; i < ROWS; i++) {
      const s = i / (ROWS - 1);
      const y = yTop - len * s;
      /* ±0.14 rad is 2.7 cm off centre on a 0.19 m belt radius, so two 4.2 cm tails sit 5.4 cm
       * apart and leave a centimetre of jacket between them. At the ±0.075 they started at they
       * overlapped by two thirds of their width and rendered as one 8 cm slab — which is a worse
       * failure than the missing knot was, because a single wide tail is not a thing a belt can
       * produce and the eye has no way to read it. */
      const phi = side * (0.14 + 0.06 * s);
      const row = rowAtY(shell, y);
      const c = shellAt(shell, row, phi, new Vector3());
      const n = shellNormal(shell, row, phi, new Vector3());
      pts.push({
        /* Clear of the skirt by the band's own crown near the top, easing to a hair above the
         * cloth lower down where there is no lapel underneath to clear. */
        c: c.addScaledVector(n, (0.0090 - 0.0040 * s) * S),
        n,
        halfT: tailHalfT,
        /* Tapered by a tenth over the drop. A belt end is cut square, but the two layers spread
         * slightly where they are not held, and a perfectly parallel-sided ribbon reads as vinyl. */
        halfW: strandHalfW * (1 - 0.10 * s),
      });
    }
    emitStrap(acc, pts, tailHalfT * 2.2);
  }

  /**
   * Knot and tails take weights from the HIPS ONLY, where the band takes them from the whole
   * torso set.
   *
   * doc 06 §7.3 puts `obi_knot` under "rigid to `pelvis`", and the reason shows up the moment the
   * kata does anything: `TORSO_WEIGHT_BONES` contains both thighs, the tails hang directly in
   * front of them, and a tail that picks up thigh weight follows whichever leg happened to be
   * nearest in the bind pose — so mae-geri takes one tail up with the knee and leaves the other
   * behind. The band has the opposite requirement and keeps the shared set (see its header): it is
   * stacked millimetres off the jacket and has to move with it exactly.
   */
  acc.patch(knotFirst, regionOf(body, ['pelvis', 'spine_01', 'spine_02']), torso);
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
    if (grid.rigid) continue; // see `GridRef.rigid`
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
