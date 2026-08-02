/**
 * B4 RIG — `src/rig/giMesh.ts`
 *
 * `buildGiGeometry`: the four gi draw calls of §5.6 — `uwagi`, `zubon`, `collar`, `obi` — built
 * procedurally in T-POSE, with analytic UVs, `GiPinRing[]` for B7's XPBD pins, and an
 * **itemSize-4** tangent per §2.7.
 *
 * ═══ THE PARTICLE ↔ VERTEX CONTRACT (read this before writing `clothBridge` or `buildGarments`) ══
 *
 * `RigHandles` is frozen and carries only `pinRings`, so the mapping from a cloth particle to a
 * garment VERTEX has to be a convention. It is this one, and `GI_PARTS` publishes it:
 *
 *   For every simulated `GarmentPartId`, that part's `cols * rows` vertices are CONTIGUOUS in its
 *   mesh's `position` attribute, in ROW-MAJOR order, so particle `(row, col)` is vertex
 *   `first + row * cols + col`. `cols`/`rows` come from B1's `GARMENTS`, never from a literal here.
 *   Tube parts (`sleeve_*`, `trouser_*`) WRAP in `col`: there is no duplicated seam column, so
 *   column `cols-1` is adjacent to column `0`. Sheet parts (`skirt_*`, `obi_tail_*`) do not wrap.
 *
 * Everything else in each mesh is pure skinning (doc 06 §7.3: the chest, back, collar, obi knot and
 * the trousers above the knee are compressed against the body and simulation buys nothing there).
 *
 * ═══ WHY IT READS AS 12 oz CANVAS AND NOT SPANDEX ════════════════════════════════════════════
 * doc 06 §7.10's ten silhouette rules, as geometry rather than as shading:
 *   1. the jacket is BOXY — its radius is the body radius + `chestEaseH` (0.020 H), constant, with
 *      no taper toward the waist;
 *   2. sleeves are WIDE TUBES — cuff radius `sleeveCuffRadiusH` 0.0335 H against a 0.0255 H
 *      forearm, ease ratio 1.31;
 *   3. trousers are VERY WIDE — hem radius `trouserHemRadiusH` 0.0435 H against a 0.020 H ankle,
 *      ease ratio 2.1, and that is the single most identifiable gi feature in motion;
 *   4. the skirt is SPLIT at both sides and the front panels overlap LEFT OVER RIGHT (the wearer's
 *      left on top, `+0.004 H` proud so the two layers never fight);
 *   5. the collar is a thick STIFF doubled band, never simulated;
 *   8. nothing is tight except the belt line, where `beltGatherH` pulls the jacket in by 0.012 H.
 * The panels are generated as flat-hanging stiff sheets, not draped tubes, because a 12 oz duck
 * skirt panel hangs as a PANEL — that shape is the tell, and cloth then only has to move it.
 */

import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import {
  boneIndex,
  GARMENT_PARTS,
  H,
  type BoneName,
  type GarmentPartId,
  type GiPinRing,
} from '../contracts';
import { CLOTH, GARMENTS, STATION_R } from '../data';
import { type SkeletonBuild } from './bones';
import { garmentWeights, WEIGHT_PARAMS, type BoneWeightRow } from './skinWeights';
import { computeAnalyticTangents } from './tangents';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. DIMENSIONS — every one from B1's `CLOTH` (doc 06 §7.1 / §7.10), none re-authored here.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const C = (k: string): number => {
  const v = CLOTH[k];
  if (!v) throw new Error(`giMesh: CLOTH.${k} missing — B1 owns it (src/data/constants/cloth.ts)`);
  return v.v;
};

const HEM_H = C('uwagiHemH'); //            0.400 above the floor
const BELT_H = C('beltLineH'); //           0.6145
const SLEEVE_END_H = C('sleeveEndH'); //    0.255 from the SJC along the arm
const ZUBON_HEM_H = C('zubonHemH'); //      0.100 above the floor
const OBI_W_H = C('obiWidthH'); //          0.024
const OBI_T_H = C('obiThicknessH'); //      0.003
const OBI_TAIL_H = C('obiTailH'); //        0.160
const COLLAR_W_H = C('collarBandWidthH'); // 0.023
const OVERLAP_H = C('frontOverlapH'); //    0.130
const CHEST_EASE_H = C('chestEaseH'); //    0.020
const CUFF_R_H = C('sleeveCuffRadiusH'); // 0.0335
const TROUSER_HEM_R_H = C('trouserHemRadiusH'); // 0.0435
const BELT_GATHER_H = C('beltGatherH'); //  0.012
const SHELL_H = C('fabricThicknessCm') / 100 / H; // 0.63 mm, as FracH — §5.5's layer offset

/** doc 06 §7.3: front-L rides 0.004 H proud of front-R so the overlapping layers never fight. */
const FRONT_L_PROUD_H = 0.004;

const S = STATION_R;
const st = (k: keyof typeof STATION_R): number => S[k]!.v;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. AZIMUTH CONVENTION
 *
 * `phi` is measured from the character's FACING (world `-Z`) and increases toward the character's
 * own LEFT, which §2.1 puts at world `-X`. So `phi = 0` front, `90` char-left, `180` back,
 * `270` char-right — the same sense as the kata heading `H`, which is what keeps "front-L is the
 * wearer's left" readable rather than something to re-derive at every call site.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const azimuth = (phiDeg: number, lateral: number, depth: number, out: Vector3): Vector3 => {
  const p = (phiDeg * Math.PI) / 180;
  return out.set(-lateral * Math.sin(p), 0, -depth * Math.cos(p));
};

/** Torso half-widths at a given height, FracH — the jacket's boxy shell is this plus the ease. */
function torsoHalfWidth(yH: number): { lateral: number; depth: number } {
  const keys: readonly (readonly [number, number, number])[] = [
    [0.3900, 0.0930, 0.0620],
    [0.4700, 0.0900, 0.0620],
    [0.5308, st('hip'), st('hipDepth')],
    [0.5750, 0.0880, 0.0585],
    [0.6145, st('waist'), st('waistDepth')],
    [0.6608, 0.0800, 0.0555],
    [0.7308, st('chest'), st('chestDepth')],
    [0.7982, 0.0900, 0.0570],
    [0.8400, 0.0700, 0.0450],
  ];
  if (yH <= keys[0]![0]) return { lateral: keys[0]![1], depth: keys[0]![2] };
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (yH >= a[0] && yH <= b[0]) {
      const u = (yH - a[0]) / (b[0] - a[0]);
      return { lateral: a[1] + (b[1] - a[1]) * u, depth: a[2] + (b[2] - a[2]) * u };
    }
  }
  const last = keys[keys.length - 1]!;
  return { lateral: last[1], depth: last[2] };
}

/**
 * doc 06 §7.10 rule 4's front-panel overlap, converted from the authored ARC LENGTH
 * (`frontOverlapH` = 0.130 H, the kata cut's longest lapel) into an azimuth at the belt line —
 * ±43.4° here. Deriving it means the overlap stays 0.130 H if the torso profile is ever retuned,
 * instead of silently becoming whatever a hard-coded angle happens to subtend.
 */
const BELT_MEAN_R_H = (() => {
  const half = torsoHalfWidth(BELT_H);
  return (half.lateral + half.depth) / 2 + CHEST_EASE_H;
})();
const OVERLAP_HALF_DEG = (OVERLAP_H / 2 / BELT_MEAN_R_H) * (180 / Math.PI);
/** Side vents: a slit each side, belt line to hem (doc 06 §7.1). 10° ~ 1.5 cm of open seam. */
const VENT_HALF_DEG = 5;
const PANEL_SIDE_DEG = 100;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. A GRID / TUBE ACCUMULATOR WITH EXPLICIT UVs
 *
 * UV convention for EVERY gi panel: `u` runs along the fabric's WARP, `v` across the weft, both in
 * METRES of arc length. §2.7 defines the tangent's `xyz` as the warp direction — the parametric `u`
 * isoline — so putting the warp on `u` is what makes `computeAnalyticTangents` produce a warp
 * tangent rather than a weft one, and `GI_WEAVE_REPEAT_PER_M` below is what B5 sets `repeat` to.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** doc 06 §7.9: one weave tile is 6.77 x 7.62 mm, i.e. 147 x 131 repeats per metre. */
export const GI_WEAVE_REPEAT_PER_M: readonly [number, number] = Object.freeze([
  C('weaveRepeatsPerMetreU'),
  C('weaveRepeatsPerMetreV'),
]) as unknown as readonly [number, number];

/** All gi (and body) UVs are METRES of arc length. B5 multiplies by `GI_WEAVE_REPEAT_PER_M`. */
export const GI_UV_UNITS = 'metres' as const;

type WeightRow = BoneWeightRow;

class GiAccum {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  readonly wts: WeightRow[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /**
   * `grid[row][col]` positions with matching `uv` and per-vertex weights. Returns the base index so
   * the particle ↔ vertex contract in the header is checkable from the outside.
   */
  addGrid(
    grid: readonly (readonly Vector3[])[],
    uvGrid: readonly (readonly (readonly [number, number])[])[],
    weights: readonly (readonly WeightRow[])[],
    closedCols: boolean,
  ): { first: number; rows: number; cols: number } {
    const first = this.vertexCount;
    const rows = grid.length;
    const cols = grid[0]!.length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = grid[r]![c]!;
        this.pos.push(p.x, p.y, p.z);
        const t = uvGrid[r]![c]!;
        this.uv.push(t[0], t[1]);
        this.wts.push(weights[r]![c]!);
      }
    }
    const lastCol = closedCols ? cols : cols - 1;
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c < lastCol; c++) {
        const c1 = (c + 1) % cols;
        const a = first + r * cols + c;
        const b = first + r * cols + c1;
        const d = first + (r + 1) * cols + c;
        const e = first + (r + 1) * cols + c1;
        // Row index increases along the sweep; this winding gives outward normals for the
        // azimuth convention above (verified against the obi band, whose outward direction is known).
        this.idx.push(a, d, b, b, d, e);
      }
    }
    return { first, rows, cols };
  }

  toGeometry(name: string): BufferGeometry {
    const g = new BufferGeometry();
    g.name = name;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeVertexNormals();
    const sw = garmentWeights(this.wts);
    g.setAttribute('skinIndex', new BufferAttribute(sw.skinIndex, WEIGHT_PARAMS.maxInfluences));
    g.setAttribute('skinWeight', new BufferAttribute(sw.skinWeight, WEIGHT_PARAMS.maxInfluences));
    computeAnalyticTangents(g);
    return g;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. PART REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export type GiMeshId = 'uwagi' | 'zubon' | 'collar' | 'obi';

export interface GiPartRange {
  readonly part: GarmentPartId;
  readonly mesh: GiMeshId;
  readonly first: number;
  readonly cols: number;
  readonly rows: number;
  readonly closedCols: boolean;
}

interface PinDef {
  readonly part: GarmentPartId;
  readonly bone: BoneName;
  /** Particle indices, i.e. `row * cols + col` within the part. */
  readonly particles: readonly number[];
}

export interface GiBuild {
  readonly geometry: Readonly<Record<GiMeshId, BufferGeometry>>;
  readonly parts: readonly GiPartRange[];
  readonly pinDefs: readonly PinDef[];
}

const layoutOf = (part: GarmentPartId): { cols: number; rows: number } => {
  const g = GARMENTS.find((x) => x.part === part);
  if (!g) throw new Error(`giMesh: GARMENTS has no layout for '${part}' (B1 owns it)`);
  return { cols: g.cols, rows: g.rows };
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE PANELS
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const W = (...rows: readonly (readonly [BoneName, number])[]): WeightRow => rows;

/** Uwagi body: a BOXY closed shell, shoulder line to just below the belt (doc 06 §7.10 rule 1). */
function uwagiBody(acc: GiAccum): void {
  const cols = 32;
  const yTop = 0.8250;
  const yBot = BELT_H - 0.030;
  const ringCount = 12;

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  let vAlong = 0;
  let prevY = yTop;

  for (let r = 0; r < ringCount; r++) {
    const t = r / (ringCount - 1);
    const yH = yTop + (yBot - yTop) * t;
    const half = torsoHalfWidth(yH);
    // Rule 8: nothing is tight except the belt line, where the obi gathers the jacket in.
    const gather = Math.exp(-Math.pow((yH - BELT_H) / 0.030, 2)) * BELT_GATHER_H;
    const lat = half.lateral + CHEST_EASE_H - gather;
    const dep = half.depth + CHEST_EASE_H - gather;
    vAlong += Math.abs(yH - prevY) * H;
    prevY = yH;

    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const phi = (c / cols) * 360;
      const p = azimuth(phi, lat * H, dep * H, new Vector3());
      p.y = yH * H;
      rowP.push(p);
      rowUv.push([vAlong, ((phi * Math.PI) / 180) * ((lat + dep) / 2) * H]);
      // Chest/back ride the chest + spine chain; the hem end rides the pelvis (doc 06 §7.3).
      const up = 1 - t;
      rowW.push(
        W(
          ['chest', 0.15 + 0.65 * up],
          ['spine_03', 0.25],
          ['spine_02', 0.20 + 0.25 * t],
          ['pelvis', 0.05 + 0.55 * t],
        ),
      );
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  acc.addGrid(grid, uvg, wg, true);
}

/** Sleeve: a wide tube down the arm. Rows 0 and 1 are the pin rings (doc 06 §7.3). */
function sleeve(
  acc: GiAccum,
  sk: SkeletonBuild,
  h: 'L' | 'R',
  parts: GiPartRange[],
  pins: PinDef[],
): void {
  const part = `sleeve_${h}` as GarmentPartId;
  const { cols, rows } = layoutOf(part);
  const sjc = new Vector3().setFromMatrixPosition(sk.byName[`upperarm_${h}` as BoneName].matrixWorld);
  const dirX = Math.sign(sjc.x);

  const tStart = 0.020;
  const rAt = (t: number): number => {
    // Shoulder ease down to the kata-cut cuff. Deliberately NOT tapered to the arm: rule 2.
    const u = (t - tStart) / (SLEEVE_END_H - tStart);
    return 0.0520 + (CUFF_R_H - 0.0520) * Math.pow(u, 0.75);
  };
  const boneAt = (t: number): BoneName => {
    if (t < 0.055) return `upperarm_${h}` as BoneName;
    if (t < 0.1618) return `upperarm_${h}` as BoneName;
    return `lowerarm_${h}` as BoneName;
  };

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  for (let r = 0; r < rows; r++) {
    const t = tStart + ((SLEEVE_END_H - tStart) * r) / (rows - 1);
    const rad = rAt(t);
    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const th = (c / cols) * Math.PI * 2;
      rowP.push(
        new Vector3(
          sjc.x + dirX * t * H,
          sjc.y + Math.sin(th) * rad * H,
          sjc.z + Math.cos(th) * rad * H,
        ),
      );
      rowUv.push([(t - tStart) * H, th * rad * H]);
      const bone = boneAt(t);
      rowW.push(W([bone, 1]));
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  const g = acc.addGrid(grid, uvg, wg, true);
  parts.push({ part, mesh: 'uwagi', first: g.first, cols, rows, closedCols: true });
  pins.push({
    part,
    bone: `upperarm_${h}` as BoneName,
    particles: Array.from({ length: cols }, (_, c) => c),
  });
  pins.push({
    part,
    bone: `upperarm_${h}` as BoneName,
    particles: Array.from({ length: cols }, (_, c) => cols + c),
  });
}

/**
 * Skirt panel: a stiff sheet hanging from the belt line. `phi0..phi1` is its arc; `proud` lifts the
 * wearer's-left panel off the right one (doc 06 §7.3 / §7.10 rule 4).
 */
function skirtPanel(
  acc: GiAccum,
  part: GarmentPartId,
  phi0: number,
  phi1: number,
  proud: number,
  parts: GiPartRange[],
  pins: PinDef[],
): void {
  const { cols, rows } = layoutOf(part);
  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];

  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const yH = BELT_H + (HEM_H - BELT_H) * t;
    const half = torsoHalfWidth(yH);
    // A 12 oz panel hangs; it does not cling. The flare is small and LINEAR in drop, which is what
    // gives the straight-sided silhouette of a heavy jacket rather than a bell.
    const flare = 0.014 * t;
    const lat = half.lateral + CHEST_EASE_H + flare + proud;
    const dep = half.depth + CHEST_EASE_H + flare + proud;

    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const phi = phi0 + ((phi1 - phi0) * c) / (cols - 1);
      const p = azimuth(phi, lat * H, dep * H, new Vector3());
      p.y = yH * H;
      rowP.push(p);
      rowUv.push([t * Math.abs(BELT_H - HEM_H) * H, ((phi - phi0) * Math.PI * lat * H) / 180]);
      rowW.push(W(['pelvis', 1]));
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  const g = acc.addGrid(grid, uvg, wg, false);
  parts.push({ part, mesh: 'uwagi', first: g.first, cols, rows, closedCols: false });
  pins.push({ part, bone: 'pelvis', particles: Array.from({ length: cols }, (_, c) => c) });
}

/** Zubon above the knee: skinned, one baggy tube per thigh (doc 06 §7.3). */
function zubonUpper(acc: GiAccum, sk: SkeletonBuild, h: 'L' | 'R'): void {
  const cols = 24;
  const rows = 10;
  const hjc = new Vector3().setFromMatrixPosition(sk.byName[`thigh_${h}` as BoneName].matrixWorld);
  const yTop = BELT_H + 0.010;
  const yBot = 0.3200;

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  let vAlong = 0;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const yH = yTop + (yBot - yTop) * t;
    // Waistband is gathered under the obi; the thigh is baggy. Rule 8 again.
    const rad = t < 0.18 ? 0.0900 - 0.10 * t : 0.0700 - 0.0060 * t;
    vAlong = Math.abs(yH - yTop) * H;
    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const th = (c / cols) * Math.PI * 2;
      // Near the waist the two legs share one tube centred on the midline; lower down they
      // separate onto their own hip joint centre.
      const cx = hjc.x * Math.min(1, t / 0.35);
      rowP.push(
        new Vector3(cx + Math.sin(th) * rad * H, yH * H, hjc.z + Math.cos(th) * rad * H),
      );
      rowUv.push([vAlong, th * rad * H]);
      rowW.push(
        t < 0.22
          ? W(['pelvis', 1])
          : W([`thigh_${h}` as BoneName, 0.55 + 0.45 * t], ['pelvis', Math.max(0, 0.45 - 0.45 * t)]),
      );
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  acc.addGrid(grid, uvg, wg, true);
}

/** Trouser below the knee: the wide simulated tube. Rows 0 and 1 are the pin rings. */
function trouser(
  acc: GiAccum,
  sk: SkeletonBuild,
  h: 'L' | 'R',
  parts: GiPartRange[],
  pins: PinDef[],
): void {
  const part = `trouser_${h}` as GarmentPartId;
  const { cols, rows } = layoutOf(part);
  const knee = new Vector3().setFromMatrixPosition(sk.byName[`calf_${h}` as BoneName].matrixWorld);
  const yTop = 0.3300;

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const yH = yTop + (ZUBON_HEM_H - yTop) * t;
    // Rule 3: VERY wide. Ease ratio 2.1 at the hem against a 0.020 H ankle.
    const rad = 0.0600 + (TROUSER_HEM_R_H - 0.0600) * Math.pow(t, 0.6);
    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const th = (c / cols) * Math.PI * 2;
      rowP.push(
        new Vector3(knee.x + Math.sin(th) * rad * H, yH * H, knee.z + Math.cos(th) * rad * H),
      );
      rowUv.push([Math.abs(yH - yTop) * H, th * rad * H]);
      rowW.push(W([`calf_${h}` as BoneName, 1]));
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  const g = acc.addGrid(grid, uvg, wg, true);
  parts.push({ part, mesh: 'zubon', first: g.first, cols, rows, closedCols: true });
  pins.push({
    part,
    bone: `calf_${h}` as BoneName,
    particles: Array.from({ length: cols }, (_, c) => c),
  });
  pins.push({
    part,
    bone: `calf_${h}` as BoneName,
    particles: Array.from({ length: cols }, (_, c) => cols + c),
  });
}

/**
 * Collar (eri): a thick, stiff, doubled band running hem → neck → hem along the lapel edge.
 * Never simulated (doc 06 §7.10 rule 5). Built as a swept rectangular ribbon, `n = 4` in spirit:
 * the cross-section is an explicit 4-corner loop, which is what makes it read as a folded band.
 */
function collar(acc: GiAccum, sk: SkeletonBuild): void {
  const neck = new Vector3().setFromMatrixPosition(sk.byName.neck_01.matrixWorld);
  const halfW = (COLLAR_W_H / 2) * H;
  const halfT = ((OBI_T_H * 1.6) / 2) * H;

  // Path: right lapel bottom -> up the overlap edge -> around the back of the neck -> down the left.
  const path: Vector3[] = [];
  const addFront = (side: 1 | -1, fromT: number, toT: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const t = fromT + ((toT - fromT) * i) / (n - 1);
      const yH = BELT_H + (0.8100 - BELT_H) * t;
      const half = torsoHalfWidth(yH);
      // The lapel edge migrates from the centre-front outward as it rises to the shoulder.
      const phi = side * (6 + 26 * t);
      const p = azimuth(
        phi,
        (half.lateral + CHEST_EASE_H + SHELL_H) * H,
        (half.depth + CHEST_EASE_H + SHELL_H) * H,
        new Vector3(),
      );
      p.y = yH * H;
      path.push(p);
    }
  };
  addFront(-1, 0, 1, 9);
  for (let i = 1; i < 7; i++) {
    const phi = 180 - (180 - 32) * (1 - i / 7);
    const p = azimuth(phi, 0.058 * H, 0.050 * H, new Vector3());
    p.y = (0.8100 + 0.030 * Math.sin((i / 7) * Math.PI)) * H;
    p.x += neck.x;
    p.z += neck.z;
    path.push(p);
  }
  const mirrored = [...path].reverse().map((p) => new Vector3(-p.x, p.y, p.z));
  path.push(...mirrored.slice(1));

  const rows = path.length;
  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  let vAlong = 0;
  for (let r = 0; r < rows; r++) {
    const c0 = path[r]!;
    const prev = path[Math.max(0, r - 1)]!;
    const next = path[Math.min(rows - 1, r + 1)]!;
    const axis = next.clone().sub(prev);
    if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
    axis.normalize();
    const outward = new Vector3(c0.x, 0, c0.z);
    if (outward.lengthSq() < 1e-9) outward.set(0, 0, -1);
    outward.normalize();
    const across = new Vector3().crossVectors(axis, outward).normalize();
    if (r > 0) vAlong += c0.distanceTo(prev);

    const corners = [
      c0.clone().addScaledVector(across, -halfW).addScaledVector(outward, -halfT),
      c0.clone().addScaledVector(across, -halfW).addScaledVector(outward, halfT),
      c0.clone().addScaledVector(across, halfW).addScaledVector(outward, halfT),
      c0.clone().addScaledVector(across, halfW).addScaledVector(outward, -halfT),
    ];
    const yH = c0.y / H;
    const wRow: WeightRow =
      yH > 0.780
        ? W(['chest', 0.7], ['neck_01', 0.3])
        : yH > 0.700
          ? W(['chest', 0.75], ['spine_03', 0.25])
          : W(['spine_03', 0.5], ['spine_02', 0.5]);
    grid.push(corners);
    uvg.push(corners.map((_, k) => [vAlong, k * halfW] as [number, number]));
    wg.push(corners.map(() => wRow));
  }
  acc.addGrid(grid, uvg, wg, true);
}

/** Obi band + knot. The black belt is a silhouette device (§5.6): it separates jacket from trouser. */
function obiBand(acc: GiAccum, sk: SkeletonBuild): void {
  const cols = 32;
  const rows = 5;
  const half = torsoHalfWidth(BELT_H);
  const lat = half.lateral + CHEST_EASE_H - BELT_GATHER_H + OBI_T_H;
  const dep = half.depth + CHEST_EASE_H - BELT_GATHER_H + OBI_T_H;

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const yH = BELT_H + OBI_W_H / 2 - OBI_W_H * t;
    const bulge = Math.sin(t * Math.PI) * 0.0016;
    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const phi = (c / cols) * 360;
      const p = azimuth(phi, (lat + bulge) * H, (dep + bulge) * H, new Vector3());
      p.y = yH * H;
      rowP.push(p);
      rowUv.push([t * OBI_W_H * H, ((phi * Math.PI) / 180) * ((lat + dep) / 2) * H]);
      rowW.push(W(['pelvis', 0.7], ['spine_01', 0.3]));
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  acc.addGrid(grid, uvg, wg, true);

  // Knot: a small rounded slab at the centre front, rigid to the pelvis.
  const knotRows = 4;
  const knotCols = 10;
  const kGrid: Vector3[][] = [];
  const kUv: [number, number][][] = [];
  const kW: WeightRow[][] = [];
  const front = azimuth(0, lat * H, dep * H, new Vector3());
  for (let r = 0; r < knotRows; r++) {
    const t = r / (knotRows - 1);
    const yH = BELT_H + OBI_W_H * 0.75 - OBI_W_H * 1.5 * t;
    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < knotCols; c++) {
      const th = (c / knotCols) * Math.PI * 2;
      const rr = 0.026 * H * Math.sin(Math.max(0.08, Math.sin(t * Math.PI)) * Math.PI * 0.5);
      rowP.push(
        new Vector3(
          Math.cos(th) * rr,
          yH * H,
          front.z - 0.0075 * H - Math.abs(Math.sin(th)) * 0.006 * H,
        ),
      );
      rowUv.push([t * OBI_W_H * 1.5 * H, th * rr]);
      rowW.push(W(['pelvis', 1]));
    }
    kGrid.push(rowP);
    kUv.push(rowUv);
    kW.push(rowW);
  }
  acc.addGrid(kGrid, kUv, kW, true);
  void sk;
}

/** Obi tail: a 2-wide ribbon so it can TWIST, which is what reads correctly (doc 06 §7.3). */
function obiTail(
  acc: GiAccum,
  h: 'L' | 'R',
  parts: GiPartRange[],
  pins: PinDef[],
): void {
  const part = `obi_tail_${h}` as GarmentPartId;
  const { cols, rows } = layoutOf(part);
  const half = torsoHalfWidth(BELT_H);
  const dep = half.depth + CHEST_EASE_H - BELT_GATHER_H + OBI_T_H * 2;
  const side = h === 'L' ? -1 : 1; // §2.1: world -X is the character's left
  const xOff = side * 0.020 * H;

  const grid: Vector3[][] = [];
  const uvg: [number, number][][] = [];
  const wg: WeightRow[][] = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const yH = BELT_H - OBI_TAIL_H * t;
    const rowP: Vector3[] = [];
    const rowUv: [number, number][] = [];
    const rowW: WeightRow[] = [];
    for (let c = 0; c < cols; c++) {
      const across = (c / (cols - 1) - 0.5) * OBI_W_H * H;
      rowP.push(new Vector3(xOff + across, yH * H, -dep * H - 0.004 * H));
      rowUv.push([t * OBI_TAIL_H * H, across]);
      rowW.push(W(['pelvis', 1]));
    }
    grid.push(rowP);
    uvg.push(rowUv);
    wg.push(rowW);
  }
  const g = acc.addGrid(grid, uvg, wg, false);
  parts.push({ part, mesh: 'obi', first: g.first, cols, rows, closedCols: false });
  pins.push({ part, bone: 'pelvis', particles: Array.from({ length: cols }, (_, c) => c) });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 6. ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export function buildGiGeometry(sk: SkeletonBuild): GiBuild {
  const parts: GiPartRange[] = [];
  const pinDefs: PinDef[] = [];

  const uw = new GiAccum();
  uwagiBody(uw);
  sleeve(uw, sk, 'L', parts, pinDefs);
  sleeve(uw, sk, 'R', parts, pinDefs);
  // doc 06 §7.10 rule 4: the wearer's LEFT panel goes on top, and it is the one that rides proud.
  skirtPanel(uw, 'skirt_front_L', -OVERLAP_HALF_DEG, PANEL_SIDE_DEG, FRONT_L_PROUD_H, parts, pinDefs);
  skirtPanel(uw, 'skirt_front_R', -PANEL_SIDE_DEG, OVERLAP_HALF_DEG, 0, parts, pinDefs);
  skirtPanel(
    uw,
    'skirt_back',
    PANEL_SIDE_DEG + 2 * VENT_HALF_DEG,
    360 - PANEL_SIDE_DEG - 2 * VENT_HALF_DEG,
    0,
    parts,
    pinDefs,
  );

  const zb = new GiAccum();
  zubonUpper(zb, sk, 'L');
  zubonUpper(zb, sk, 'R');
  trouser(zb, sk, 'L', parts, pinDefs);
  trouser(zb, sk, 'R', parts, pinDefs);

  const co = new GiAccum();
  collar(co, sk);

  const ob = new GiAccum();
  obiBand(ob, sk);
  obiTail(ob, 'L', parts, pinDefs);
  obiTail(ob, 'R', parts, pinDefs);

  // The frozen `GARMENT_PARTS` order IS the global cloth particle order, so a part that never got
  // built would silently shift every downstream particle index.
  const built = new Set(parts.map((p) => p.part));
  const missing = GARMENT_PARTS.filter((p) => !built.has(p));
  if (missing.length) {
    throw new Error(`giMesh: no geometry for simulated garment part(s) ${missing.join(', ')}`);
  }

  return {
    geometry: {
      uwagi: uw.toGeometry('gi_uwagi'),
      zubon: zb.toGeometry('gi_zubon'),
      collar: co.toGeometry('gi_collar'),
      obi: ob.toGeometry('gi_obi'),
    },
    parts: parts.sort(
      (a, b) => GARMENT_PARTS.indexOf(a.part) - GARMENT_PARTS.indexOf(b.part),
    ),
    pinDefs,
  };
}

/**
 * Resolve `GiPinRing.restLocalH` AFTER the A-pose rebake (doc 06 §4.1 G4/G5). The cloth pin target
 * is `boneMatrixWorld * restLocal`, and the matrix the runtime feeds it is relative to the **A-pose
 * bind** — so a rest-local captured in T-pose would put every pin ring 45° out at the shoulder.
 */
export function finalizePinRings(
  build: GiBuild,
  sk: SkeletonBuild,
  geometryByMesh: Readonly<Record<GiMeshId, BufferGeometry>>,
): readonly GiPinRing[] {
  const inv = new Matrix4();
  const p = new Vector3();
  const out: GiPinRing[] = [];

  for (const pin of build.pinDefs) {
    const range = build.parts.find((r) => r.part === pin.part);
    if (!range) throw new Error(`finalizePinRings: no range for '${pin.part}'`);
    const pos = geometryByMesh[range.mesh].getAttribute('position');
    inv.copy(sk.bones[boneIndex(pin.bone)]!.matrixWorld).invert();

    const rest = new Float32Array(pin.particles.length * 3);
    pin.particles.forEach((particle, k) => {
      const v = range.first + particle;
      p.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(inv).divideScalar(H);
      rest[k * 3] = p.x;
      rest[k * 3 + 1] = p.y;
      rest[k * 3 + 2] = p.z;
    });
    out.push({ part: pin.part, bone: pin.bone, particles: [...pin.particles], restLocalH: rest });
  }
  return out;
}
