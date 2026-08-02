/**
 * B4 RIG — `src/rig/textures.ts`
 *
 * Every map the karateka and the stage need, generated **in code**. Nothing is fetched: the project
 * constraint is no downloads, ever, and no network at runtime.
 *
 * ═══ WHY `DataTexture` AND NOT `CanvasTexture` ═══════════════════════════════════════════════
 * §4.4 names both as legal ("All textures are `CanvasTexture`/`DataTexture` — nothing fetched").
 * We ship `DataTexture` exclusively, because `CanvasTexture` needs `document.createElement('canvas')`
 * and the whole numeric channel — `tools/score.mjs`, `tests/integration/pipeline.test.ts`, the
 * `tests/contracts/bones.test.ts` assertion that builds the real rig — runs in **Node with no DOM**
 * (§7.1, §9.1 A-12). A `CanvasTexture` anywhere on the rig's build path would throw there, and the
 * failure would look like a rig bug rather than an environment one.
 *
 * Colour spaces follow §5.6's hard rule, which it calls "the #1 silent PBR bug": albedo and
 * emissive maps are `SRGBColorSpace`, normal / roughness / AO maps are `NoColorSpace`.
 *
 * Determinism: the noise below is a seeded integer hash, never `Math.random`. `src/rig` is not on
 * the `NONDETERMINISM` ban list, but a texture that differs between two runs would make every
 * captured PNG differ too, and §6.3's ledger has no row for that.
 */

import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { CLOTH } from '../data';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. DETERMINISTIC NOISE
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** 32-bit integer hash (Wang / xxhash-style finaliser). Pure, seedable, no state. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2246822519;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Tileable value noise on an integer lattice of period `period`. */
function valueNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (n: number) => ((n % period) + period) % period;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let per = basePeriod;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u, v, per, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    per *= 2;
  }
  return sum / norm;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. PLUMBING
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

function makeTexture(size: number, data: Uint8Array, srgb: boolean): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Height field -> tangent-space normal map, encoded `[0,255]` with `z` in the blue channel. */
function heightToNormal(
  size: number,
  height: (u: number, v: number) => number,
  scaleU: number,
  scaleV: number,
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const d = 1 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const hx = (height(u + d, v) - height(u - d, v)) / (2 * d);
      const hy = (height(u, v + d) - height(u, v - d)) / (2 * d);
      let nx = -hx * scaleU;
      let ny = -hy * scaleV;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const nz = 1 / len;
      const o = (j * size + i) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE GI WEAVE (doc 06 §7.9)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface WeaveMaps {
  readonly normal: DataTexture;
  /** Repeats per metre; B5 sets `texture.repeat` from this and the panel's metre-valued UVs. */
  readonly repeatPerM: readonly [number, number];
  readonly tileMm: readonly [number, number];
}

/**
 * Plain (1/1) 2-ply weave of #12 cotton duck: 30 ends/inch warp (0.847 mm pitch) x 20 picks/inch
 * weft (1.270 mm), tiled 8 warp x 6 weft cells = 6.77 x 7.62 mm, at 512² = 13.2 µm/texel.
 * Height field is doc 06 §7.9 verbatim: `h = A * pow(cos(pi*frac), 0.6)` per yarn, parity-alternating
 * over/under, with `A = 0.18 mm` ~ 29 % of the 0.63 mm fabric thickness. The maximum gradient is
 * `2*pi*0.18/0.847 = 1.34`, which is why §7.9 pairs it with `normalScale 0.60` — 1.0 reads as
 * corduroy.
 */
export function makeWeaveNormal(size = CLOTH.weaveTileRes!.v): WeaveMaps {
  const warpCells = 8;
  const weftCells = 6;
  const endsPerInch = CLOTH.weaveEndsPerInch!.v;
  const picksPerInch = CLOTH.weavePicksPerInch!.v;
  const warpPitchMm = 25.4 / endsPerInch;
  const weftPitchMm = 25.4 / picksPerInch;
  const tileU = warpCells * warpPitchMm;
  const tileV = weftCells * weftPitchMm;
  const A = CLOTH.weaveCrownHeightCm!.v * 10; // cm -> mm

  const height = (u: number, v: number): number => {
    const cu = u * warpCells;
    const cv = v * weftCells;
    const fu = cu - Math.floor(cu);
    const fv = cv - Math.floor(cv);
    const over = (Math.floor(cu) + Math.floor(cv)) % 2 === 0;
    const crownU = Math.pow(Math.max(0, Math.cos(Math.PI * (fu - 0.5))), 0.6);
    const crownV = Math.pow(Math.max(0, Math.cos(Math.PI * (fv - 0.5))), 0.6);
    // The yarn that is ON TOP at this cell carries the full crown; the one beneath is compressed.
    return A * (over ? crownU + 0.35 * crownV : 0.35 * crownU + crownV);
  };

  // Gradients are per-tile-fraction; convert to per-mm so `normalScale` means what §7.9 says.
  const normal = makeTexture(size, heightToNormal(size, height, 1 / tileU, 1 / tileV), false);
  return {
    normal,
    repeatPerM: [CLOTH.weaveRepeatsPerMetreU!.v, CLOTH.weaveRepeatsPerMetreV!.v],
    tileMm: [tileU, tileV],
  };
}

/**
 * The baked static crease field of doc 06 §7.9: 7–9 vertical folds per panel at 0.030–0.045 H
 * spacing (5.3–7.9 cm), the fold wavelength that separates 12 oz canvas from jersey. Because the
 * gi's UVs are METRES, the fold spacing here is expressed in metres directly and the map tiles at
 * `1 / foldSpacingM` repeats per metre along `v` (across the warp).
 */
export function makeCreaseMap(size = 512): { readonly normal: DataTexture; readonly foldSpacingM: number } {
  const spacingH = (CLOTH.creaseSpacingMinH!.v + CLOTH.creaseSpacingMaxH!.v) / 2;
  const foldSpacingM = spacingH * 1.75;

  const height = (u: number, v: number): number => {
    // Folds run along the warp (`u`), so the ridge pattern varies in `v`.
    const ridge = Math.cos(v * Math.PI * 2);
    const wobble = (fbm(u, v, 4, 3, 17) - 0.5) * 0.55;
    const along = 0.75 + 0.25 * fbm(u * 3, v, 5, 2, 91);
    return (Math.sign(ridge) * Math.pow(Math.abs(ridge), 0.65) + wobble) * along * 0.35;
  };
  return { normal: makeTexture(size, heightToNormal(size, height, 1, 1), false), foldSpacingM };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. SKIN
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface SkinMaps {
  readonly albedo: DataTexture;
  readonly normal: DataTexture;
  readonly roughness: DataTexture;
}

/**
 * Skin albedo + pore normal + roughness break-up. `M_SKIN` is a `MeshPhysicalMaterial` at
 * `roughness 0.48` (§5.6); the roughness map modulates ±0.09 around it so the forehead and the
 * bridge of the nose are shinier than the cheek, which is most of what stops a procedural head from
 * reading as painted plastic under the four-light rig of §5.4.
 */
export function makeSkinMaps(size = 512): SkinMaps {
  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const base = [0xd6, 0xa9, 0x8b];

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const mottle = fbm(u, v, 6, 4, 7) - 0.5;
      const blotch = fbm(u, v, 2, 3, 23) - 0.5;
      const o = (j * size + i) * 4;
      albedo[o] = clamp255(base[0]! * (1 + mottle * 0.10 + blotch * 0.08));
      albedo[o + 1] = clamp255(base[1]! * (1 + mottle * 0.07 + blotch * 0.05));
      albedo[o + 2] = clamp255(base[2]! * (1 + mottle * 0.05 + blotch * 0.03));
      albedo[o + 3] = 255;

      const r = 0.48 + (fbm(u, v, 10, 3, 55) - 0.5) * 0.18;
      const g8 = clamp255(r * 255);
      rough[o] = g8;
      rough[o + 1] = g8;
      rough[o + 2] = g8;
      rough[o + 3] = 255;
    }
  }

  const pore = (u: number, v: number): number =>
    fbm(u, v, 48, 3, 131) * 0.55 + fbm(u, v, 160, 2, 211) * 0.45;

  return {
    albedo: makeTexture(size, albedo, true),
    normal: makeTexture(size, heightToNormal(size, pore, 1.6, 1.6), false),
    roughness: makeTexture(size, rough, false),
  };
}

/** Head albedo — the skin base with a warmer cheek gradient and a darker brow. */
export function makeHeadAlbedo(size = 512): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const mottle = fbm(u, v, 8, 4, 61) - 0.5;
      const cheek = Math.exp(-Math.pow((v - 0.45) / 0.18, 2)) * 0.06;
      const brow = Math.exp(-Math.pow((v - 0.72) / 0.06, 2)) * 0.05;
      const o = (j * size + i) * 4;
      data[o] = clamp255(0xd6 * (1 + mottle * 0.10 + cheek - brow));
      data[o + 1] = clamp255(0xa9 * (1 + mottle * 0.07 + cheek * 0.5 - brow));
      data[o + 2] = clamp255(0x8b * (1 + mottle * 0.05 - brow));
      data[o + 3] = 255;
    }
  }
  return makeTexture(size, data, true);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. EYE
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Sclera / iris / pupil on an equirectangular-ish sphere UV, with the iris centred at the sphere's
 * `+u = 0.5, v = 0.5` pole-free band so `SphereGeometry`'s default UVs put it on the gaze axis.
 */
export function makeEyeTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const irisR = 0.19;
  const pupilR = 0.075;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const d = Math.hypot(u - 0.5, v - 0.5);
      const o = (j * size + i) * 4;
      let rgb: readonly [number, number, number];
      if (d < pupilR) {
        rgb = [10, 9, 9];
      } else if (d < irisR) {
        const t = (d - pupilR) / (irisR - pupilR);
        const fib = 0.75 + 0.25 * fbm(u * 6, v * 6, 24, 2, 303);
        const limbal = t > 0.86 ? 0.45 : 1;
        rgb = [
          clamp255((0x4a + 0x22 * t) * fib * limbal),
          clamp255((0x33 + 0x1c * t) * fib * limbal),
          clamp255((0x22 + 0x12 * t) * fib * limbal),
        ];
      } else {
        const veins = Math.max(0, fbm(u, v, 14, 3, 404) - 0.55) * 1.4;
        rgb = [clamp255(246 - veins * 40), clamp255(243 - veins * 90), clamp255(238 - veins * 90)];
      }
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
  const t = makeTexture(size, data, true);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 6. DOJO FLOOR (consumed by B5's `M_FLOOR`; §5.6 wants albedo + roughness + normal)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface FloorMaps {
  readonly albedo: DataTexture;
  readonly roughness: DataTexture;
  readonly normal: DataTexture;
  /** Metres covered by one tile, so B5 can set `repeat` from the stage size. */
  readonly tileM: number;
}

/**
 * Hardwood planks. `planksPerTile` boards across a `tileM` square, each with its own grain seed and
 * its own base value — the per-plank VARIANCE is the thing that stops a procedural floor reading as
 * a repeating decal, and it is also what the contact shadow of §5.5 lands on.
 */
export function makeFloorMaps(size = 1024, tileM = 2.4, planksPerTile = 8): FloorMaps {
  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const base = [0x7d, 0x56, 0x36];
  const grooveTexels = Math.max(1, Math.round(size / (planksPerTile * 90)));

  const plankOf = (v: number): { idx: number; local: number } => {
    const f = v * planksPerTile;
    return { idx: Math.floor(f), local: f - Math.floor(f) };
  };

  for (let j = 0; j < size; j++) {
    const { idx, local } = plankOf(j / size);
    const tone = 0.88 + 0.24 * hash2(idx, 7, 991);
    const stagger = hash2(idx, 13, 771);
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      // Grain: stretched noise along the plank, plus a few darker rays.
      const grain = fbm(u * 1.0 + stagger, v * 26, 9, 4, 1300 + idx * 7);
      const ray = Math.pow(Math.max(0, fbm(u * 2 + stagger, v * 60, 7, 2, 1700 + idx)), 3) * 0.5;
      const edge =
        local < grooveTexels / (size / planksPerTile) ||
        local > 1 - grooveTexels / (size / planksPerTile)
          ? 0.55
          : 1;
      const endJoint =
        Math.abs(((u + stagger) % 0.5) - 0.0) < grooveTexels / size * 2 ? 0.6 : 1;
      const k = tone * (0.86 + grain * 0.28 - ray) * edge * endJoint;
      const o = (j * size + i) * 4;
      albedo[o] = clamp255(base[0]! * k);
      albedo[o + 1] = clamp255(base[1]! * k);
      albedo[o + 2] = clamp255(base[2]! * k);
      albedo[o + 3] = 255;

      // Boards are polished; the grooves and grain are not.
      const r = 0.42 + (1 - edge) * 0.22 + (grain - 0.5) * 0.10;
      const g8 = clamp255(r * 255);
      rough[o] = g8;
      rough[o + 1] = g8;
      rough[o + 2] = g8;
      rough[o + 3] = 255;
    }
  }

  const height = (u: number, v: number): number => {
    const { idx, local } = plankOf(v);
    const groove = Math.min(local, 1 - local) < 0.02 ? -0.6 : 0;
    return groove + fbm(u + idx * 0.13, v * 26, 9, 3, 1300 + idx * 7) * 0.18;
  };

  return {
    albedo: makeTexture(size, albedo, true),
    roughness: makeTexture(size, rough, false),
    normal: makeTexture(size, heightToNormal(size, height, 0.9, 0.9), false),
    tileM,
  };
}

function clamp255(x: number): number {
  const v = Math.round(x);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
