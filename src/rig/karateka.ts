/**
 * B4 RIG — `src/rig/karateka.ts`
 *
 * `buildKarateka(mats)` — §3.13's single entry point. Runs doc 06 §4.1's G1–G5 in order and returns
 * the frozen `RigHandles` of §3.10.
 *
 *   G1  build every piece of geometry in T-POSE               `bodyMesh.ts`, `giMesh.ts`
 *   G2  compute skin weights in T-POSE                        `skinWeights.ts`
 *   G3  set the A-pose local rotations                        `bones.ts applyBindAPose`
 *   G4  CPU-skin the geometry once through the A-pose and     here
 *       OVERWRITE `geometry.attributes.position`
 *   G5  `new Skeleton(bones)` (which calls `calculateInverses`
 *       against the now-A-posed world matrices) and `bind`     here
 *
 * ═══ WHY THE REBAKE IS NOT OPTIONAL ══════════════════════════════════════════════════════════
 * The bind pose IS the pose in which LBS is exact. Karate's shoulder abduction runs 0°…120°, so a
 * T-pose bind (90°) puts the most-used band — every tsuki and every gedan-barai, 0–60° — at 30–90°
 * from bind, where LBS deviation `1 - cos(delta/2)` costs up to 29 % of the armpit's volume. The
 * A-pose bind at 45° puts that band inside ±45°, i.e. ≤ 8 %. Generating in T-pose and BINDING in
 * A-pose is how we get the clean T-pose distance field of G2 and the cheap A-pose deviation of G4 at
 * the same time.
 *
 * ═══ NODE SAFETY ═════════════════════════════════════════════════════════════════════════════
 * Nothing on this path touches the DOM or GL: geometry, bones, skeletons and `DataTexture` are all
 * pure JS. `tests/contracts/bones.test.ts` builds the real rig under vitest's `node` environment, and
 * `tools/score.mjs` does the same through `ssrLoadModule`, so a `CanvasTexture` or a `document`
 * reference anywhere below would break the whole numeric channel (§7.1). That is why
 * `src/rig/textures.ts` is `DataTexture`-only and why this file creates no textures at all — the
 * maps live on B5's materials.
 */

import {
  Matrix4,
  Mesh,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { boneIndex, H, type BoneName, type RigHandles } from '../contracts';
import { STATION_R } from '../data';
import { applyBindAPose, buildSkeleton, type SkeletonBuild } from './bones';
import { buildBodyGeometry } from './bodyMesh';
import {
  buildGiGeometry,
  finalizePinRings,
  type GiMeshId,
  type GiPartRange,
} from './giMesh';
import { bindSegments, computeSkinWeights, WEIGHT_PARAMS, type SkinWeights } from './skinWeights';
import { computeAnalyticTangents } from './tangents';
import { BufferAttribute } from 'three';

/**
 * §3.4.1's `MaterialSet`, restated structurally.
 *
 * B5 owns the type and exports it from `src/render`. We do NOT import it, because `src/render`
 * lands in the same phase as this file and a hard module edge would make B4's typecheck depend on
 * B5's file existing. The shape below is §3.4.1 verbatim, so `buildKarateka(createMaterials())`
 * typechecks by structural compatibility the moment B5's barrel appears.
 */
export type RigMaterialSet = Readonly<
  Record<
    | 'M_GI'
    | 'M_SKIN'
    | 'M_OBI'
    | 'M_FLOOR'
    | 'M_BACKDROP'
    | 'M_HAIR'
    | 'M_EYE'
    | 'M_EMBUSEN'
    | 'M_MASK'
    | 'M_DEBUG',
    Material
  >
>;

/**
 * §10's countermeasure for "perfect bilateral symmetry", which it lists among the things that make a
 * figure read cheap. A deterministic ±1.2 % radial asymmetry, applied to the BODY mesh only (the gi
 * is loose, so an asymmetry there would be invisible) and about each vertex's own dominant bone
 * segment, so no bone length and no joint centre moves. Metric 59 `bone_length_drift_pct` and the
 * bind-pose closure test are therefore both untouched.
 */
const LIMB_ASYMMETRY = 0.012;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * G4 — the CPU skin (three.js LBS, doc 06 §4.4: max 4 influences, hard)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Overwrite `geometry.attributes.position` with the LBS result of `skinMatrix`, then recompute
 * normals from the new positions. `skinMatrix[i] = aposeWorld[i] * inverse(tposeWorld[i])`, so this
 * is exactly `mesh.applyBoneTransform` for a bind matrix of identity — done in bulk, and without
 * needing the `SkinnedMesh` to exist yet.
 */
function rebakeToBind(
  geometry: BufferGeometry,
  sw: SkinWeights,
  skinMatrix: readonly Matrix4[],
): void {
  const pos = geometry.getAttribute('position');
  const K = WEIGHT_PARAMS.maxInfluences;
  const p = new Vector3();
  const acc = new Vector3();
  const tmp = new Vector3();

  for (let v = 0; v < pos.count; v++) {
    p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
    acc.set(0, 0, 0);
    let total = 0;
    for (let k = 0; k < K; k++) {
      const w = sw.skinWeight[v * K + k]!;
      if (w === 0) continue;
      tmp.copy(p).applyMatrix4(skinMatrix[sw.skinIndex[v * K + k]!]!);
      acc.addScaledVector(tmp, w);
      total += w;
    }
    if (total > 0) pos.setXYZ(v, acc.x, acc.y, acc.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** §10's asymmetry, applied about each vertex's dominant bone segment so no joint centre moves. */
function applyLimbAsymmetry(
  geometry: BufferGeometry,
  group: Uint8Array,
  sw: SkinWeights,
  segA: Float64Array,
  segB: Float64Array,
  leftGroups: readonly number[],
  rightGroups: readonly number[],
): void {
  const pos = geometry.getAttribute('position');
  const K = WEIGHT_PARAMS.maxInfluences;
  const p = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const ab = new Vector3();
  const cp = new Vector3();

  for (let v = 0; v < pos.count; v++) {
    const g = group[v]!;
    const s = leftGroups.includes(g)
      ? 1 + LIMB_ASYMMETRY
      : rightGroups.includes(g)
        ? 1 - LIMB_ASYMMETRY
        : 1;
    if (s === 1) continue;

    let dom = sw.skinIndex[v * K]!;
    let domW = sw.skinWeight[v * K]!;
    for (let k = 1; k < K; k++) {
      if (sw.skinWeight[v * K + k]! > domW) {
        domW = sw.skinWeight[v * K + k]!;
        dom = sw.skinIndex[v * K + k]!;
      }
    }
    a.set(segA[dom * 3]!, segA[dom * 3 + 1]!, segA[dom * 3 + 2]!);
    b.set(segB[dom * 3]!, segB[dom * 3 + 1]!, segB[dom * 3 + 2]!);
    p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
    ab.copy(b).sub(a);
    const den = ab.lengthSq();
    let t = den < 1e-16 ? 0 : p.clone().sub(a).dot(ab) / den;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    cp.copy(a).addScaledVector(ab, t);
    p.sub(cp).multiplyScalar(s).add(cp);
    pos.setXYZ(v, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Eyes and hair
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Human eyeball: 24 mm diameter, so `r = 0.0069 H`. Parented to `eye_L/R` so gaze drives it. */
const EYE_RADIUS_H = 0.0069;

function buildEye(mat: Material): Mesh {
  const g = new SphereGeometry(EYE_RADIUS_H * H, 20, 14);
  const m = new Mesh(g, mat);
  // `SphereGeometry`'s uv (0.5, 0.5) lands on +X; the gaze axis is -Z, so yaw it a quarter turn and
  // the procedurally-centred iris of `makeEyeTexture` ends up looking where the bone looks.
  m.rotation.y = Math.PI / 2;
  m.name = 'eye';
  m.castShadow = false;
  m.receiveShadow = false;
  m.frustumCulled = false;
  return m;
}

/**
 * Hair: a shaped cap, no strands (§5.6 `M_HAIR`). A partial sphere scaled onto the head ellipsoid
 * plus 2 mm, cut off above the brow so it reads as a short Shotokan cut rather than a helmet.
 */
function buildHair(mat: Material): Mesh {
  const g = new SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const rx = STATION_R.headRx!.v + 0.0016;
  const ry = STATION_R.headRy!.v + 0.0016;
  const rz = STATION_R.headRz!.v + 0.0016;
  g.scale(rx * H, ry * H, rz * H);
  // The head ellipsoid centre sits above and forward of the AOJ (see bodyMesh's HEADNECK_PROFILE).
  g.translate(0, 0.0205 * H, -0.024 * H);
  const m = new Mesh(g, mat);
  m.name = 'hair';
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const fallbackMaterialWarnings: string[] = [];

/** Diagnostics the tests and the HUD read. Not part of the frozen `RigHandles`. */
export interface KaratekaStats {
  readonly bodyVertices: number;
  readonly giVertices: Readonly<Record<GiMeshId, number>>;
  readonly meanInfluences: number;
  readonly rigidified: number;
  readonly twistSplit: number;
  readonly drawCalls: number;
}

let lastStats: KaratekaStats | null = null;
export const karatekaStats = (): KaratekaStats | null => lastStats;

let lastGiParts: readonly GiPartRange[] = [];
/**
 * The particle <-> vertex mapping for every simulated garment part of the rig `buildKarateka` last
 * returned. `RigHandles` is frozen and carries only `pinRings`, so this is how B7's `buildGarments`
 * and B5's `clothBridge` learn where a `GarmentLayout`'s vertices actually live. See the contract in
 * `src/rig/giMesh.ts`'s header.
 */
export const giParts = (): readonly GiPartRange[] => lastGiParts;

export function buildKarateka(mats: RigMaterialSet): RigHandles {
  const pick = (k: keyof RigMaterialSet): Material => {
    const m = mats?.[k];
    if (m) return m;
    // B5 owns the materials; if a key is missing we must not crash the whole numeric channel, but we
    // must also not pretend the look is right. Reuse whatever the set does have.
    if (!fallbackMaterialWarnings.includes(k)) fallbackMaterialWarnings.push(k);
    const any = Object.values(mats ?? {}).find(Boolean) as Material | undefined;
    if (!any) throw new Error(`buildKarateka: MaterialSet is empty (need at least ${k})`);
    return any;
  };

  /* G1 — T-pose skeleton and geometry. */
  const sk: SkeletonBuild = buildSkeleton();
  const body = buildBodyGeometry(sk);
  const seg = bindSegments(sk);

  /* G2 — weights, in T-pose. */
  const bodyW = computeSkinWeights(body.geometry, body.group, sk, seg);

  applyLimbAsymmetry(body.geometry, body.group, bodyW, seg.a, seg.b, [2, 4], [3, 5]);

  const gi = buildGiGeometry(sk);
  const giW: Record<GiMeshId, SkinWeights> = {
    uwagi: readGarmentWeights(gi.geometry.uwagi),
    zubon: readGarmentWeights(gi.geometry.zubon),
    collar: readGarmentWeights(gi.geometry.collar),
    obi: readGarmentWeights(gi.geometry.obi),
  };

  /* G3 — the A-pose. */
  const { skinMatrix } = applyBindAPose(sk);

  /* G4 — rebake every shell through the A-pose and overwrite positions. */
  rebakeToBind(body.geometry, bodyW, skinMatrix);
  for (const id of ['uwagi', 'zubon', 'collar', 'obi'] as const) {
    rebakeToBind(gi.geometry[id], giW[id], skinMatrix);
    // Positions and normals moved, so the §2.7 tangent frame has to be rebuilt on the BIND pose —
    // the GLSL path transforms it by the skin matrix from there.
    computeAnalyticTangents(gi.geometry[id]);
  }
  computeAnalyticTangents(body.geometry);

  body.geometry.setAttribute(
    'skinIndex',
    new BufferAttribute(bodyW.skinIndex, WEIGHT_PARAMS.maxInfluences),
  );
  body.geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(bodyW.skinWeight, WEIGHT_PARAMS.maxInfluences),
  );

  /* G5 — inverses against the A-pose, then bind. */
  const skeleton = new Skeleton([...sk.bones]);
  const identity = new Matrix4();

  const bodyMesh = new SkinnedMesh(body.geometry, pick('M_SKIN'));
  bodyMesh.name = 'karateka_body';
  const giMeshes = {
    uwagi: new SkinnedMesh(gi.geometry.uwagi, pick('M_GI')),
    zubon: new SkinnedMesh(gi.geometry.zubon, pick('M_GI')),
    collar: new SkinnedMesh(gi.geometry.collar, pick('M_GI')),
    obi: new SkinnedMesh(gi.geometry.obi, pick('M_OBI')),
  } as const;
  giMeshes.uwagi.name = 'gi_uwagi';
  giMeshes.zubon.name = 'gi_zubon';
  giMeshes.collar.name = 'gi_collar';
  giMeshes.obi.name = 'gi_obi';

  for (const m of [bodyMesh, giMeshes.uwagi, giMeshes.zubon, giMeshes.collar, giMeshes.obi]) {
    // §5.1: the karateka never frustum-culls (the shadow caster and the silhouette pass both need
    // it resident) and always casts.
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.normalizeSkinWeights(); // §4.4's belt-and-braces pass, on top of §5.3 step 5
    sk.root.add(m);
    m.bind(skeleton, identity);
  }

  const eyes: [Mesh, Mesh] = [buildEye(pick('M_EYE')), buildEye(pick('M_EYE'))];
  sk.byName.eye_L.add(eyes[0]);
  sk.byName.eye_R.add(eyes[1]);

  const hair = buildHair(pick('M_HAIR'));
  sk.byName.head.add(hair);

  sk.root.updateMatrixWorld(true);
  const pinRings = finalizePinRings(gi, sk, gi.geometry);
  lastGiParts = gi.parts;

  lastStats = {
    bodyVertices: body.geometry.getAttribute('position').count,
    giVertices: {
      uwagi: gi.geometry.uwagi.getAttribute('position').count,
      zubon: gi.geometry.zubon.getAttribute('position').count,
      collar: gi.geometry.collar.getAttribute('position').count,
      obi: gi.geometry.obi.getAttribute('position').count,
    },
    meanInfluences: bodyW.stats.meanInfluences,
    rigidified: bodyW.stats.rigidified,
    twistSplit: bodyW.stats.twistSplit,
    drawCalls: 8,
  };

  return {
    root: sk.root,
    bones: sk.bones,
    byName: sk.byName,
    skeleton,
    body: bodyMesh,
    gi: giMeshes,
    eyes,
    hair,
    pinRings,
  };
}

/** The garment weights were written straight onto the geometry by `GiAccum.toGeometry`. */
function readGarmentWeights(g: BufferGeometry): SkinWeights {
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  return {
    skinIndex: si.array as Uint16Array,
    skinWeight: sw.array as Float32Array,
    stats: {
      vertexCount: si.count,
      meanInfluences: 0,
      rigidified: 0,
      twistSplit: 0,
    },
  };
}

/** For `tests/rig/**` and for B5's `refitShadow`: the bone index of a name, without a deep import. */
export const rigBoneIndex = (n: BoneName): number => boneIndex(n);
