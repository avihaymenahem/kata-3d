/**
 * B6 PLAYER — `src/player/facialHair.ts` — a mustache for the LOADED character.
 *
 * ═══ WHY THIS IS NOT IN `./gi.ts` ════════════════════════════════════════════════════════════
 *
 * It shares that file's measurement idea — ask the BIND-POSE body where its surface is, then lay
 * geometry on the answer — and nothing else. The gi is a skinned garment spanning eleven bones and
 * exists to survive deformation; this is two hundred vertices rigidly attached to one bone, and its
 * entire difficulty is anatomical placement on a head that has no face to place things by. Putting
 * a mustache in a file called `gi.ts` would also make `attachGi` the function you have to read to
 * find out why the karateka has facial hair, which is the kind of thing that stays wrong.
 *
 * ═══ RIGID TO `head`, NOT SKINNED ════════════════════════════════════════════════════════════
 *
 * The gi is a `SkinnedMesh` because it spans joints. A mustache spans nothing: every part of it is
 * 100 % weighted to `head` by definition, and a skinned mesh whose weights are all one bone is a
 * rigid mesh that pays for four influences per vertex and a per-frame bone-matrix upload to arrive
 * at the same answer. So it is a plain `Mesh` parented to the head BONE — bones are `Object3D`s —
 * which needs the geometry expressed in that bone's own space.
 *
 * The conversion is one matrix and it is exact. three's skinning evaluates
 *
 *      final = mesh.matrixWorld · bindMatrixInverse · (Σ wᵢ · boneᵢ.matrixWorld · boneInverseᵢ)
 *              · bindMatrix · p
 *
 * so a vertex weighted entirely to `head`, in `./gi.ts`'s cloud space (`bindMatrix · position`,
 * with `bindMatrix = I` and `AttachedBindMode` cancelling `mesh.matrixWorld`), lands at
 * `head.matrixWorld · boneInverse_head · p`. A child of the head bone lands at
 * `head.matrixWorld · localP`. Equate them: `localP = boneInverse_head · p`, which is
 * `skeleton.boneInverses[headIdx]` — the same matrix `./gi.ts` inverts to recover bind positions,
 * used in the direction it was stored in.
 *
 * ═══ ONE PIECE, STRAIGHT-EDGED, AND NO BROWS ═════════════════════════════════════════════════
 *
 * All three were owner corrections on a first version, and all three are worth writing down
 * because the first version's reasoning was defensible and still wrong:
 *
 *   * EYEBROWS. Argued for on the grounds that a mustache on a featureless egg has nothing to be
 *     measured against. What actually rendered was two dark tapered wedges high on a blank head,
 *     which read as horns — the argument was about what brows would ANCHOR, and it ignored what
 *     they would look like with no eyes, nose or hairline anywhere near them. Gone entirely rather
 *     than behind a flag: a flag is a claim that someone might want them.
 *
 *   * ONE PIECE. Swept as a single span across the philtrum rather than as a mirrored pair. A pair
 *     meeting at the centre leaves a seam exactly where the eye looks first, and two halves that
 *     agree to a tenth of a millimetre still shade as two objects.
 *
 *   * STRAIGHT-EDGED. The taper that closed the first version's ends without cap geometry was the
 *     same taper that made them points. The section is now CONSTANT across the whole span and the
 *     ends are capped flat, which costs two rings and buys a silhouette with four straight edges.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Bone,
  type Object3D,
  type SkinnedMesh,
} from 'three';

import type { Character } from './character';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. PROPORTIONS
 *
 * Every dimension is a fraction of the MEASURED head, never of stature and never a literal metre.
 * The head this loads onto is 0.278 m from chin to crown on a 1.829 m figure — one sixth of the
 * stature where a life-drawing canon says one seventh and a half — so anything derived from height
 * would put the mustache 1.5 cm low, which on a face is the difference between a mustache and a
 * mouth. Anything derived from the head is right on this character and on a differently
 * proportioned one.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Height up the head, as a fraction of chin-to-crown.
 *
 * The classical canon divides the FACE into equal thirds — hairline to brow, brow to the base of
 * the nose, nose to chin — which on a head measured to the CROWN puts the base of the nose at 0.29.
 * A mustache sits in the gap between that and the lip.
 *
 * 0.30 rather than the canon's 0.265, and the extra is a correction for the MODEL rather than a
 * preference: this head is an egg with no jaw, so its lowest vertex is the smooth underside of the
 * skull and not a chin. Measuring "chin to crown" against it over-reports the face by about a
 * centimetre, and every canonical fraction lands that much too low — the first version at 0.275
 * put the mustache on the underside of the jaw, where the egg has already turned away from the
 * camera, and it was invisible from the front.
 */
const MUSTACHE_Y = 0.30;

/**
 * Half-angle about the face's forward axis, in radians.
 *
 * A mustache is as wide as the mouth and no wider — about 6 cm on an adult — which on a head this
 * size is ±0.30 rad. The brief asked for modest and believable at the default camera distance, and
 * the failure mode in the other direction is not subtlety, it is a handlebar. The other end of the
 * range is worse: a block much narrower than the mouth stops reading as a mustache and starts
 * reading as one specific twentieth-century face, which is not a look a dojo wants.
 */
const MUSTACHE_HALF_ARC = 0.25;

/** Section size, as fractions of head height. 1.33 cm top to bottom, 1.44 cm front to back. */
const MUSTACHE_HALF_H = 0.024;
const MUSTACHE_HALF_D = 0.026;

/**
 * How far the section is pushed back INTO the face, as a fraction of its own depth.
 *
 * Hair does not have a back. The moment a gap opens between it and the head the illusion is a
 * plastic prop glued to a mannequin, and a gap is what any surface fit guarantees the instant it
 * over-reads by a millimetre. Sinking 28 % of the depth leaves 6.8 mm proud and 5.3 mm buried, so
 * the fit's error in EITHER direction stays invisible.
 */
const MUSTACHE_SINK = 0.30;

/**
 * The neighbourhood the fitted head is calibrated against: ±0.10 of head height (2.8 cm) either
 * side of the mustache, and 0.35 rad of azimuth beyond each end of it. See `faceFit`.
 */
const FIT_Y_BAND = 0.10;
const FIT_ARC_MARGIN = 0.35;

/**
 * Depth of the section's back face relative to its front, as a fraction.
 *
 * The block is asymmetric front to back: full depth outward, 45 % of it inward. The shallow back
 * is what beds into the cheek without the buried half of the shape having to be as deep as the
 * visible half — a symmetric section sunk far enough to be safe would have to be twice as thick to
 * stand the same distance proud.
 */
const MUSTACHE_BACK = 0.45;

/**
 * The cross-section: a rounded rectangle, CCW in the (up, outward) plane.
 *
 * ═══ WHY A RECTANGLE AND NOT A LENS ══════════════════════════════════════════════════════════
 *
 * A lens section has no straight edges anywhere, so its silhouette from every angle is a smooth
 * bulge and the whole shape reads as a smear on the lip rather than as a thing with a top and a
 * bottom. The corner radius here is a tenth of the section, enough that `computeVertexNormals`
 * has a facet to shade the transition with — a truly square corner averages into a hard seam
 * running the length of the block — and small enough that the top and bottom edges stay straight.
 *
 * Eight columns. The pair that matter are the two flat runs at `b = ±1`, which are the edges you
 * actually see; the rest are the corners that let those edges end without a crease.
 */
export const MUSTACHE_SECTION: readonly (readonly [number, number])[] = Object.freeze([
  [1.0, 0.5],
  [0.55, 1.0],
  [-0.55, 1.0],
  [-1.0, 0.5],
  [-1.0, -0.5],
  [-0.55, -1.0],
  [0.55, -1.0],
  [1.0, -0.5],
]);

/** Spans across the block. 11 over 6 cm is 6 mm a facet, under the shading threshold. */
const SPANS = 11;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 2. THE HEAD, MEASURED
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The head's own axes, from the two shoulder joints.
 *
 * ═══ MEASURED, NEVER NAMED ═══════════════════════════════════════════════════════════════════
 *
 * `./gi.ts` documents its cloud as facing +Z with the wearer's left on +X, and its collar lands on
 * the chest, so the convention is not in doubt for THIS file. It is still derived, because the rig
 * underneath is Rigify and Rigify keeps Blender's bone-local axes — the pelvis's local "up" is +Z —
 * and the header of `./boneBasis.ts` exists precisely because assuming an axis convention on this
 * rig has cost the project real debugging time. Two joint positions and a cross product cannot be
 * wrong about which way a body faces.
 *
 * `left × up` and not `up × left`: with left on +X and up on +Y, the first gives +Z and the second
 * gives −Z, and a mustache on the back of the head is not a failure anyone would misread — but it
 * is one an inverted sign would produce silently on a character whose bind pose faces the other
 * way, which is exactly the case this derivation exists to survive.
 */
export function faceAxes(
  shoulderL: Vector3,
  shoulderR: Vector3,
): { left: Vector3; fwd: Vector3 } | null {
  const left = shoulderL.clone().sub(shoulderR).setY(0);
  if (left.lengthSq() < 1e-8) return null;
  left.normalize();
  return { left, fwd: new Vector3().crossVectors(left, new Vector3(0, 1, 0)).normalize() };
}

interface Head {
  readonly bone: Bone;
  /** `inverse(head.matrixWorld)` at bind time — the cloud space -> bone space matrix. */
  readonly toBone: Matrix4;
  /** Chin height and chin-to-crown, in cloud space. */
  readonly yChin: number;
  readonly height: number;
  /** Unit vector the face points along, in cloud space. */
  readonly fwd: Vector3;
  /** Unit vector toward the wearer's own left. */
  readonly left: Vector3;
  /** Centre of the fitted ellipsoid, in cloud space. */
  readonly centre: Vector3;
  /** Semi-axes along `left`, up, and `fwd`. */
  readonly ra: number;
  readonly rb: number;
  readonly rc: number;
  /** Radius multiplier that lifts the fit onto the face. See `faceFit`. */
  readonly fit: number;
}

/** The un-calibrated ellipsoid's radius at a height and an azimuth, about the head's own axis. */
function ellipsoidRadius(
  e: { centre: Vector3; ra: number; rb: number; rc: number },
  y: number,
  phi: number,
): number {
  const k = Math.sqrt(Math.max(0, 1 - ((y - e.centre.y) / e.rb) ** 2));
  const denom = Math.hypot(Math.sin(phi) / e.ra, Math.cos(phi) / e.rc);
  return denom > 1e-9 ? k / denom : 0;
}

/**
 * How much the fitted ellipsoid has to grow to reach the FACE, in the mustache's own neighbourhood.
 *
 * ═══ WHY THE FIT IS CALIBRATED LOCALLY AND NOT INFLATED GLOBALLY ═════════════════════════════
 *
 * A bbox ellipsoid passes through the six extreme vertices and lies inside the head everywhere
 * else, by an amount that varies with how un-ellipsoidal the head is. On this one that amount is
 * 4 mm at the mustache line — enough that a block standing 5 mm proud of the fit ends up 1 mm proud
 * of the face, with the middle of it sunk under the surface and only its ends showing. That is what
 * rendered, and it is the second time this file has produced a buried mustache by trusting a fit.
 *
 * Inflating the whole ellipsoid to enclose every vertex was the previous attempt and it failed the
 * other way: the worst-fitting vertices are on the crown and the nape, so enclosing them grew every
 * axis by 20 % and stood the mustache 28 mm off the face.
 *
 * The scale that is actually wanted is the one that reaches the FACE, so it is measured there — the
 * largest ratio of a real vertex's radius to the ellipsoid's radius in the same direction, over the
 * vertices within `FIT_Y_BAND` of the mustache and inside its arc plus a margin. Never below 1, so
 * a head that is genuinely an ellipsoid is left alone. The result keeps the fit's SHAPE, which is
 * what the normal needs, and fixes its SIZE, which is what the placement needs.
 */
function faceFit(
  pts: readonly Vector3[],
  e: { centre: Vector3; ra: number; rb: number; rc: number; left: Vector3; fwd: Vector3 },
  yMustache: number,
  band: number,
): number {
  const cl = e.centre.dot(e.left);
  const cf = e.centre.dot(e.fwd);
  let fit = 1;
  for (const v of pts) {
    if (Math.abs(v.y - yMustache) > band) continue;
    const la = v.dot(e.left) - cl;
    const lc = v.dot(e.fwd) - cf;
    const rho = Math.hypot(la, lc);
    if (rho < 1e-6 || lc <= 0) continue; // front hemisphere only
    const phi = Math.atan2(la, lc);
    if (Math.abs(phi) > MUSTACHE_HALF_ARC + FIT_ARC_MARGIN) continue;
    const r = ellipsoidRadius(e, v.y, phi);
    if (r > 1e-6) fit = Math.max(fit, rho / r);
  }
  return fit;
}

/**
 * Fit an ellipsoid to the body vertices whose dominant bone is `head`.
 *
 * `AnimLib.glb` splits the mannequin across `Mannequin_1` and `Mannequin_2`, and the second one is
 * the joint caps — so gathering only the first would miss whatever part of the skull is capped and
 * under-report the crown. Both are walked, exactly as `gi.ts`'s `gatherBody` does.
 *
 * ═══ THE HEAD IS FITTED, NOT PROBED ══════════════════════════════════════════════════════════
 *
 * `./gi.ts` measures every garment ring with a convex support function over the body vertices in a
 * slab, and that is right there: the torso carries 3 000 vertices, a slab through the chest holds a
 * hundred, and the support function's guarantee — it never understates a silhouette — is what keeps
 * cloth off skin.
 *
 * This head is 202 VERTICES over 0.28 m. A slab through the face holds about a dozen, and the first
 * version of this file did exactly what `gi.ts` does and got a mustache 1.1 mm proud of a surface
 * it should have cleared by six: the slab at the mustache's own height caught the underside of the
 * skull, where the egg has already narrowed, and placed the ends 4 cm behind the face. It was
 * invisible on screen — measured, not guessed.
 *
 * The fit here is the BBOX ellipsoid: it passes through the six extreme vertices and is used for
 * the surface NORMAL, which only has to be smooth and roughly right. It is deliberately NOT used
 * for the surface RADIUS — see `surfaceAt`. An earlier revision inflated it to the 95th percentile
 * of the vertices' own ellipsoid radii, on the reasoning that a fit which encloses the head can
 * never bury anything; it enclosed it by 20 % in every axis and stood the mustache 28 mm off the
 * face, a shelf rather than a mustache. Measured, again, not guessed. The head is not an ellipsoid
 * — it is flatter over the crown than one — so no single scale makes the fit both safe and close.
 */
function measureHead(character: Character): Head | null {
  const bone = character.boneFor('head');
  if (bone === null) return null;

  const meshes: SkinnedMesh[] = [];
  character.root.traverse((o: Object3D) => {
    const m = o as SkinnedMesh;
    if (m.isSkinnedMesh === true && m.skeleton !== undefined && !m.name.startsWith('karateka_')) {
      meshes.push(m);
    }
  });
  const first = meshes[0];
  if (first === undefined) return null;
  const skeleton = first.skeleton;
  const headIdx = skeleton.bones.indexOf(bone);
  const invBind = skeleton.boneInverses[headIdx];
  if (headIdx < 0 || invBind === undefined) return null;

  const pts: Vector3[] = [];
  for (const m of meshes) {
    if (m.skeleton !== skeleton) continue;
    const g = m.geometry;
    const ap = g.getAttribute('position');
    const ai = g.getAttribute('skinIndex');
    const aw = g.getAttribute('skinWeight');
    for (let i = 0; i < ap.count; i++) {
      let best = -1;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const b = (k === 0 ? ai.getX(i) : k === 1 ? ai.getY(i) : k === 2 ? ai.getZ(i) : ai.getW(i)) | 0;
        const w = k === 0 ? aw.getX(i) : k === 1 ? aw.getY(i) : k === 2 ? aw.getZ(i) : aw.getW(i);
        if (w > bestW) {
          bestW = w;
          best = b;
        }
      }
      if (best === headIdx) {
        pts.push(new Vector3(ap.getX(i), ap.getY(i), ap.getZ(i)).applyMatrix4(m.bindMatrix));
      }
    }
  }
  if (pts.length < 24) return null;

  /* Facing, from the SHOULDERS rather than from an assumed axis — see `faceAxes`. */
  const bindOf = (b: Bone | null): Vector3 | null => {
    if (b === null) return null;
    const i = skeleton.bones.indexOf(b);
    const inv = skeleton.boneInverses[i];
    return inv === undefined
      ? null
      : new Vector3().setFromMatrixPosition(new Matrix4().copy(inv).invert());
  };
  const pL = bindOf(character.boneFor('upperarm_L'));
  const pR = bindOf(character.boneFor('upperarm_R'));
  if (pL === null || pR === null) return null;
  const axes = faceAxes(pL, pR);
  if (axes === null) return null;

  const la: number[] = [];
  const lb: number[] = [];
  const lc: number[] = [];
  for (const p of pts) {
    la.push(p.dot(axes.left));
    lb.push(p.y);
    lc.push(p.dot(axes.fwd));
  }
  const span = (v: readonly number[]): { mid: number; half: number } => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of v) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return { mid: (lo + hi) / 2, half: Math.max(1e-4, (hi - lo) / 2) };
  };
  const sa = span(la);
  const sb = span(lb);
  const sc = span(lc);

  const centre = new Vector3()
    .addScaledVector(axes.left, sa.mid)
    .addScaledVector(axes.fwd, sc.mid);
  centre.y = sb.mid;

  const height = sb.half * 2;
  const e = { centre, ra: sa.half, rb: sb.half, rc: sc.half, left: axes.left, fwd: axes.fwd };
  const fit = faceFit(pts, e, sb.mid - sb.half + MUSTACHE_Y * height, FIT_Y_BAND * height);

  return {
    bone,
    toBone: new Matrix4().copy(invBind),
    yChin: sb.mid - sb.half,
    height,
    fwd: axes.fwd,
    left: axes.left,
    centre,
    ra: sa.half,
    rb: sb.half,
    rc: sc.half,
    fit,
  };
}

/**
 * Where the head's surface is at a height and an azimuth, and which way it faces there.
 *
 * The azimuth is measured about the head's vertical axis from `fwd`, positive toward the wearer's
 * left.
 *
 * The radius is the fit scaled by `faceFit` — smooth, and calibrated so it reaches the face rather
 * than the average of the whole skull.
 *
 * The normal is the ellipsoid's own gradient, `(a/ra², b/rb², c/rc²)`, taken on the UNSCALED
 * surface because a uniform scale does not change a direction. It carries the VERTICAL term, which
 * matters more than it sounds: a mustache sits where the face has already begun to lean back under
 * the cheekbone, and laid along a purely radial normal it would stand straight out of the head —
 * about 20° of pitch away from lying on the lip.
 */
function surfaceAt(head: Head, y: number, phi: number): { p: Vector3; n: Vector3 } {
  const b = y - head.centre.y;
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  const r = ellipsoidRadius(head, y, phi) * head.fit;
  const a = r * sn;
  const c = r * cs;

  const p = head.centre.clone().addScaledVector(head.left, a).addScaledVector(head.fwd, c);
  p.y = y;

  const n = new Vector3()
    .addScaledVector(head.left, a / (head.ra * head.ra))
    .addScaledVector(head.fwd, c / (head.rc * head.rc));
  n.y = b / (head.rb * head.rb);
  if (n.lengthSq() < 1e-14) n.copy(head.fwd);
  return { p, n: n.normalize() };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE BLOCK
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Sweep `MUSTACHE_SECTION` across the face at a constant height and a constant size, and cap both
 * ends flat.
 *
 * ═══ THE CAPS ════════════════════════════════════════════════════════════════════════════════
 *
 * One extra ring at each end, scaled to a tenth and slid a bare 0.3 mm past the end face. That is
 * a bevel too small to see and it is doing two jobs: it CLOSES the block, which a FrontSide
 * material needs or the end shows the inside of the head, and it gives the corner between the end
 * face and the top edge a facet to shade with instead of a hard normal discontinuity. A truly
 * degenerate ring would close it too, but every triangle in the cap would have zero area and
 * `computeVertexNormals` would hand back NaNs for the whole end.
 *
 * Rows increase toward the wearer's LEFT and columns run CCW in (up, outward), which makes
 * `u × v = up × n = left` — the tangent rows advance along. That is `./gi.ts` §2's handedness rule,
 * and getting it backwards here would not look subtly wrong, it would make the mustache invisible.
 */
function emitMustache(head: Head, pos: number[], idx: number[]): void {
  const cols = MUSTACHE_SECTION.length;
  const H = head.height;
  const halfH = MUSTACHE_HALF_H * H;
  const halfD = MUSTACHE_HALF_D * H;
  const y = head.yChin + MUSTACHE_Y * H;
  const capLen = halfD * 0.06;

  const grid: Vector3[][] = [];
  const ring = (phi: number, scale: number, slide: number): Vector3[] => {
    const { p, n } = surfaceAt(head, y, phi);
    /* Up, made perpendicular to the local normal, so the block stands ON the face rather than
     * shearing along it wherever the surface leans back. */
    const up = new Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
    /* `left` at this azimuth: the tangent the sweep advances along, and the axis a cap slides on. */
    const tan = new Vector3().crossVectors(up, n).normalize();
    const base = p.clone().addScaledVector(n, -halfD * MUSTACHE_SINK).addScaledVector(tan, slide);
    return MUSTACHE_SECTION.map(([b, a]) =>
      base
        .clone()
        .addScaledVector(up, b * halfH * scale)
        .addScaledVector(n, (a > 0 ? a : a * MUSTACHE_BACK) * halfD * scale),
    );
  };

  grid.push(ring(-MUSTACHE_HALF_ARC, 0.1, -capLen));
  for (let r = 0; r < SPANS; r++) {
    const t = (r / (SPANS - 1)) * 2 - 1;
    grid.push(ring(t * MUSTACHE_HALF_ARC, 1, 0));
  }
  grid.push(ring(MUSTACHE_HALF_ARC, 0.1, capLen));

  const first = pos.length / 3;
  for (const row of grid) for (const p of row) pos.push(p.x, p.y, p.z);
  for (let r = 0; r + 1 < grid.length; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a = first + r * cols + c;
      const b = first + r * cols + c1;
      const d = first + (r + 1) * cols + c;
      const e = first + (r + 1) * cols + c1;
      idx.push(a, b, d, b, e, d);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 4. ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface FacialHairStats {
  readonly vertices: number;
  readonly triangles: number;
  /** One. The whole mustache is a single geometry on a single material. */
  readonly drawCalls: number;
  /** Chin-to-crown, in metres — what every dimension above was scaled by. */
  readonly headHeightM: number;
}

export interface FacialHairHandle {
  readonly mesh: Mesh;
  readonly stats: FacialHairStats;
  dispose(): void;
}

const FACIAL_HAIR_NAME = 'karateka_facial_hair';

/**
 * The mustache's own material, built here rather than taken from B5's `MaterialSet`.
 *
 * ═══ WHY NOT `M_HAIR` ════════════════════════════════════════════════════════════════════════
 *
 * §5.6's `M_HAIR` is `MeshStandardMaterial` at roughness 0.55 with the default `envMapIntensity`
 * of 1, which is a soft specular lobe plus a full environment reflection. On a near-black surface
 * a few centimetres across, directly under the key, that is a highlight — and a highlight on hair
 * does not read as gloss, it reads as WET. The owner has now reported garment shine three times
 * and Channel D settled dispute D09 by taking `M_GI.sheen` to zero outright; a mustache that
 * arrived shining the week after would be the same defect wearing a different hat.
 *
 * The alternative — mutating `materials.M_HAIR` from B6 — is worse than owning a material: it is
 * one block reaching into another's frozen set to change a value B5 is responsible for, and it
 * would silently retune the procedural figure's hair cap the moment `?rig=proc` made it visible.
 *
 * So: §5.6's hair COLOUR verbatim, `0x1A1512`, with roughness up at 0.88 and `envMapIntensity`
 * at 0.10 to match what `materials.ts` now does for every cloth surface. HANDOFF: when B5 has a
 * matte hair material, this should take it as an option and this function should go.
 */
function makeHairMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    name: 'M_FACIAL_HAIR',
    color: new Color(0x1a1512),
    roughness: 0.88,
    metalness: 0,
  });
  m.envMapIntensity = 0.1;
  return m;
}

/**
 * Build a mustache for `character` and parent it to the head bone.
 *
 * Returns `null` when the character has no resolvable head or too few head vertices to fit, rather
 * than throwing: unlike the gi, this is decoration on decoration, and a rig whose head bone is
 * named something else should lose a mustache, not the dojo. `attachGi` throws because an invisible
 * gi and a missing gi look identical from the outside and the difference matters; a missing
 * mustache is self-evident.
 */
export function attachFacialHair(character: Character): FacialHairHandle | null {
  /* Re-attaching is the console workflow while tuning, so retire an existing one first instead of
   * stacking a second mustache on the same face. */
  const old = character.root.getObjectByName(FACIAL_HAIR_NAME);
  if (old !== undefined) {
    (old as Mesh).geometry.dispose();
    old.removeFromParent();
  }

  const head = measureHead(character);
  if (head === null) return null;

  const pos: number[] = [];
  const idx: number[] = [];
  emitMustache(head, pos, idx);

  /* Cloud space -> head-bone space. See the file header for the derivation. */
  const p = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i]!, pos[i + 1]!, pos[i + 2]!).applyMatrix4(head.toBone);
    pos[i] = p.x;
    pos[i + 1] = p.y;
    pos[i + 2] = p.z;
  }

  const g = new BufferGeometry();
  g.name = FACIAL_HAIR_NAME;
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  g.computeVertexNormals();

  const material = makeHairMaterial();
  const mesh = new Mesh(g, material);
  mesh.name = FACIAL_HAIR_NAME;
  /**
   * RECEIVES shadow but does not cast one, which is the whole draw-call cost of this module.
   *
   * `castShadow` puts the mesh in the shadow map's own render, so it is a second draw call for a
   * 5.6 cm object whose shadow falls on the 6 mm of lip directly behind it — invisible at any
   * camera this scene has, and completely invisible under the 2048-texel map covering a 2 m
   * figure. Receiving is the half that matters: it is what darkens the mustache when the key is
   * behind him, and it is free.
   */
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  /* Culled normally, unlike the gi: this one's bounding sphere is exact in its own local space and
   * the bone transform above it is what moves it, so three's culling test is correct here. The gi
   * has to opt out because a SKINNED bounding volume is the bind pose's and a kicking leg leaves it. */
  head.bone.add(mesh);

  return {
    mesh,
    stats: {
      vertices: pos.length / 3,
      triangles: idx.length / 3,
      drawCalls: 1,
      headHeightM: head.height,
    },
    dispose(): void {
      mesh.removeFromParent();
      g.dispose();
      material.dispose();
    },
  };
}
