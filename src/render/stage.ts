/**
 * B5 RENDER — `src/render/stage.ts`
 *
 * `buildStage`: the floor, the room shell and the embusen decal plane. ARCHITECTURE.md §5.6.
 *
 * Three of the twelve opaque draw calls in the whole project live here (§5.6: floor 1 + backdrop 1 +
 * embusen decal 1). The room is a four-wall shell built by `dojoWall.ts` and it is still ONE of
 * them — see that file's header for why it is hand-built rather than a `BoxGeometry`.
 *
 * ── EVERY TEXTURE IS DRAWN IN CODE ────────────────────────────────────────────────────────────
 * `CanvasTexture` only, per doc 05 §12 and project constraint 2. Nothing is fetched.
 *
 * **The plank variance is seeded, never random.** A capture must be a pure function of
 * `(tick, camera, trackHash, layerWeights)` (§5.3, §6.3). A floor whose plank tones came from
 * `Math.random()` would differ between two runs at the same sha and break the regression gate for a
 * reason no diff would explain. `xorshift32` below is seeded from a frozen literal; that literal is
 * load-bearing and must not be "randomised for variety".
 *
 * ── WHY THE FLOOR IS A SQUARE, AND WHY IT IS BIGGER THAN THE ROOM ─────────────────────────────
 * It used to be a disc inside a cylinder, for a good reason at the time: a square floor inside a
 * CYLINDRICAL backdrop shows its own corners poking through the wall at low orbit angles, and
 * `LOW34` is in the DEFAULT shot list (§7.3). Once the backdrop became a room with corners of its
 * own (`dojoWall.ts`), that argument inverted — a disc inside a box leaves four wedges of nothing
 * at the corners, which is the same defect with the geometry swapped.
 *
 * So the floor is a square, 0.3 m larger than the room on every side, and the wall's base is pushed
 * to `WALL_BASE_Y_M = -0.75`. The floor/wall junction is therefore buried on all four sides and the
 * horizon is a STRAIGHT line broken by corner posts, which is the whole point of the change.
 *
 * The plane is subdivided 32x32 for one reason: the `color` attribute. A floor is not evenly lit —
 * it is brightest where the room's light pools and falls away into the corners — and a vertex
 * colour is the only way to say that on a tiling texture. See `floorVertexColours`.
 *
 * ── THE EMBUSEN DECAL AND THE HANDEDNESS BOUNDARY ─────────────────────────────────────────────
 * doc 02's embusen coordinates are AUTHORED-frame, where `+X` is the character's LEFT; world `+X` is
 * the character's RIGHT (§2.1). The box is NOT symmetric in x — its sigma centre sits at
 * `-0.19 L` authored — so drawing it here would require an authored->world x negation, and
 * `src/solve/frame.ts` is the ONLY file in the project permitted to do that (§2.1, ban
 * `SECOND_FRAME_CONVERSION`, ban `X_NEGATION`).
 *
 * So this decal draws only MIRROR-SYMMETRIC content: an `L`-pitch grid centred on the yoi origin,
 * the origin cross, and a radius-`L` ring. That is frame-agnostic by construction and cannot be
 * wrong in either handedness. The per-kata polyline — which IS asymmetric — belongs to
 * `src/render/overlay.ts`'s `'embusen'` layer (§4.5), where it consumes B1's already-world-correct
 * `embusenPolyline(kata)` in Phase 4.
 *
 * The same rule shapes `stageClipBox()`: its z centre is used directly (z is never negated), and its
 * x range is kept SYMMETRIC and widened by `|sigma centre x|` so it is correct under either reading.
 * The cost is 0.18 m of extra AO clip extent per side, which is free.
 *
 * ── THE MAP CONVENTION ────────────────────────────────────────────────────────────────────────
 * Every generated map carries VARIATION AROUND 1.0, never an absolute value, because a texture
 * MULTIPLIES its scalar in three. The full argument, and the measured bug it prevents, sits above
 * `makeFloorMaps` below. Read it before adding a map.
 */

import {
  BackSide,
  Box3,
  BufferAttribute,
  CanvasTexture,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type Scene,
  type Texture,
} from 'three';

import { EMB_SIGMA_X_CONST_L, EMB_SIGMA_Z_CONST_L, STAGE_AABB_M } from '../contracts';
import { L_M, MATERIAL_PARAMS } from '../data';
import {
  makeDojoWallTexture,
  makeRoomShellGeometry,
  ROOM_HALF_M,
  WALL_BASE_Y_M,
  WALL_TOP_Y_M,
} from './dojoWall';
import { assignMap, type MaterialSet } from './materials';

/**
 * §3.4.1, VERBATIM. Declared in B5's barrel, per §3.4.1's own instruction.
 *
 * Three named meshes, because Phase 4's `renderSilhouette` has to HIDE all three by reference before
 * rendering the mask — name matching on a traversed scene is the version of that which breaks the
 * first time someone renames a mesh. Anything the stage ever adds beyond these three must be
 * PARENTED to one of them (`Object3D.visible = false` culls the whole subtree in
 * `WebGLRenderer.projectObject`), or metric 60's mask silently gains a wall.
 */
export interface StageHandle {
  readonly floor: Mesh;
  readonly backdrop: Mesh;
  readonly embusen: Mesh;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Stage geometry
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Distance from the embusen origin to a wall, metres. The room is square, so this is its INRADIUS —
 * the name predates the box and is kept because it is a §3.13 barrel export.
 *
 * Floored by `ORBIT_CONTROLS.maxDistanceM` (9.0 m): the orbit camera has to stay inside the shell.
 */
export const BACKDROP_RADIUS_M = ROOM_HALF_M;
export const BACKDROP_HEIGHT_M = WALL_TOP_Y_M - WALL_BASE_Y_M;

/**
 * Floor half-extent, metres — deliberately LARGER than the room, so the boards run UNDER the wall
 * and the junction is a painted shadow line rather than a polygon seam. Comfortably clears the
 * 4.31 m worst-case embusen radius either way.
 *
 * The 1.7 m of overhang is not slack, it is the other half of `dojoWall.ts`'s far-plane trade: the
 * orbit camera reaches a horizontal radius of 8.99 m, which is 0.7 m OUTSIDE the 8.3 m wall, and a
 * camera standing past the edge of the floor would put a hard black edge across the bottom of
 * frame. Everything beyond the wall is occluded from inside the room, so the overhang is free.
 */
export const FLOOR_RADIUS_M = 10.0;

/** Dojo board width, metres. 145 mm is a standard sprung-floor board. `[ART]`. */
export const PLANK_WIDTH_M = 0.145;
/** One floor-texture tile spans this many metres in both axes: 16 boards. */
export const FLOOR_TILE_M = PLANK_WIDTH_M * 16;

/**
 * The stage AABB used by GTAO's `setSceneClipBox` and by the embusen decal, in metres.
 *
 * `4.68 x 4.68 m` (§2.5 conflict C13 = 3.78 m embusen + 0.45 m limb envelope per side). doc 02
 * §3.2's sigma centre is `(EMB_SIGMA_X_CONST_L / 2, EMB_SIGMA_Z_CONST_L / 2) = (-0.19, -2.00) L`,
 * AUTHORED frame. See the header for why only z is used directly.
 */
export const STAGE_HALF_M = STAGE_AABB_M / 2;
export const STAGE_CENTRE_Z_M = (EMB_SIGMA_Z_CONST_L / 2) * L_M; // -1.890 m — sign-safe
/** `|sigma centre x|`, the x offset whose SIGN depends on the frame. Absorbed as extra extent. */
export const STAGE_X_SLACK_M = Math.abs((EMB_SIGMA_X_CONST_L / 2) * L_M); // 0.180 m

/** Vertical extent: floor minus a hair, up to a full jodan extension plus headroom. `[ART]`. */
export const STAGE_MIN_Y_M = -0.05;
export const STAGE_MAX_Y_M = 2.3;

/**
 * §5.2's `GTAOPass.setSceneClipBox(stageAABB)` argument — it bounds ambient occlusion to the stage
 * so the backdrop shell and the far floor cannot darken the figure's crease.
 */
export function stageClipBox(): Box3 {
  const hx = STAGE_HALF_M + STAGE_X_SLACK_M;
  return new Box3(
    new Vector3(-hx, STAGE_MIN_Y_M, STAGE_CENTRE_Z_M - STAGE_HALF_M),
    new Vector3(+hx, STAGE_MAX_Y_M, STAGE_CENTRE_Z_M + STAGE_HALF_M),
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Deterministic noise — SEEDED, never random. See the header.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Frozen literal. Changing it changes every captured floor pixel. */
const FLOOR_SEED = 0x5ea15f00;

function xorshift32(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0x100000000) / 0x100000000;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Procedural maps
 *
 * HANDOFF NOTE (B4): §4.4 lists `makeFloorMaps` under B4's `src/rig/textures.ts`, and OWNERSHIP B5
 * lists the `src/rig` barrel among B5's dependencies — so the intended long-run wiring is
 * `import { makeFloorMaps } from '../rig'`. `src/rig` does not exist at the Phase-1 gate, and
 * `tests/contracts/imports.test.ts` fails any relative specifier that does not resolve, so B5 cannot
 * import it yet. These generators are therefore PRIVATE to this file (never exported, never in the
 * barrel) and are the Phase-1 source. When B4's barrel lands, either swap to it in one import or
 * move `makeFloorMaps` to B5 — a handoff decision, not a B5 edit.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE MAP CONVENTION, AND THE BUG IT EXISTS TO PREVENT. FOUND BY RENDERING IT.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * In three, a texture MULTIPLIES its scalar; it does not replace it:
 *   diffuseColor.rgb *= texture2D( map, vUv ).rgb            (`map_fragment.glsl.js`)
 *   roughnessFactor  *= texture2D( roughnessMap, vUv ).g     (`roughnessmap_fragment.glsl.js`)
 *
 * The first version of these generators painted ABSOLUTE values — `0x7D5636` into the albedo and
 * `0.42` into the roughness — which squared both against B1's identical scalars. Measured result:
 *   floor albedo  0.49 * 0.49 = 0.24 of intent  -> mean frame luma 56.7 instead of 92.8
 *   floor roughness 0.42 * 0.42 = 0.176         -> a near-mirror wood floor with a blown specular
 *                                                  streak and severe grazing-angle moire
 * Neither shows up in `tsc`, in the config test, or in any of the 63 metrics.
 *
 * So the convention here is: **every map carries VARIATION AROUND 1.0, never an absolute value.**
 * `MATERIAL_COLOR_HEX.M_FLOOR.color` stays the base hue and `MATERIAL_PARAMS.M_FLOOR.roughness`
 * stays the base gloss — which is also what makes B1's constants meaningful as look-dev knobs, and
 * what lets a critic finding route to `render.ts -> M_FLOOR.roughness` and actually change something.
 *
 * THE COROLLARY, AND IT IS A LIVE CONSTRAINT: a `roughnessMap` sample is in `[0, 1]`, so the map can
 * only ever make the floor GLOSSIER than `M_FLOOR.roughness = 0.42`, never rougher. The bright
 * specular sheet RIM lays across the far floor at grazing incidence is therefore NOT reachable from
 * this file — measured: killing it needs roughness ≈ 0.62, which is outside B1's own ±0.08
 * tolerance on the row. It is a lighting finding, routed to `LIGHTS.rim.intensity` /
 * `MATERIAL_PARAMS.M_FLOOR.roughness`, and this file deliberately does not paper over it with an
 * out-of-band override that would silently break B1's knob.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

interface FloorMaps {
  readonly albedo: Texture;
  readonly roughness: Texture;
  readonly normal: Texture;
}

function ctx2d(width: number, height: number = width): CanvasRenderingContext2D {
  if (typeof document === 'undefined') {
    throw new Error(
      'render/stage.ts: buildStage() draws CanvasTextures and needs a DOM. It is a browser-only ' +
        'path by design; the GL-free channel (tools/score.mjs) never builds a stage.',
    );
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  if (g === null) throw new Error('render/stage.ts: 2D canvas context unavailable.');
  return g;
}

/**
 * One board, resolved once so albedo, roughness and normal agree about where its grain is.
 *
 * `segs` is the reason the floor stopped reading as corduroy: the first version gave each board ONE
 * tone for the whole 2.32 m tile and a single butt joint, so the floor was sixteen full-length
 * stripes. A real sprung floor is laid in 1.8-2.4 m lengths with the joints staggered, and every
 * length is a different board off a different log — so the tone has to change ACROSS the joint, not
 * just at it.
 */
interface Board {
  readonly tone: number;
  readonly warm: number;
  readonly grainPhase: number;
  /** Joint positions along the board as fractions of the tile, ascending, plus the tone after each. */
  readonly segs: readonly { readonly at: number; readonly tone: number }[];
}

function makeFloorMaps(): FloorMaps {
  const ALB = MATERIAL_PARAMS.M_FLOOR!.textureRes!.v; // 2048
  const NRM = 1024; // per-pixel loop; 1 Mpx is ~25 ms, 4 Mpx is not worth it for plank seams
  const boardsPerTile = Math.round(FLOOR_TILE_M / PLANK_WIDTH_M); // 16
  const rnd = xorshift32(FLOOR_SEED);

  const board: Board[] = Array.from({ length: boardsPerTile }, () => {
    /* Value jitter, with roughly one board in six pulled well dark: plank-to-plank variance is what
     * sells a wood floor (doc 05 §11.1), and an even spread reads as noise rather than as timber
     * sorted by hand.
     *
     * The range is deliberately BELOW 1.0 rather than centred on it. `rgb()` clamps at 255, so a
     * multiplier map authored as `1.0 ± 0.1` throws away its entire upper half to the clamp: half
     * the boards land on pure white, the variance collapses, and the floor reads as one flat value
     * with a few dark boards in it. Measured — the first version of this pass did exactly that.
     * Mean 0.93 keeps every board on the legal side of the clamp and still leaves the floor reading
     * as `MATERIAL_COLOR_HEX.M_FLOOR.color` rather than as a darker second copy of it. */
    const heart = rnd() < 0.17;
    const tone = heart ? 0.7 + rnd() * 0.08 : 0.86 + rnd() * 0.17;
    /* Butt joints at FREE positions, not at even fractions. Placing them at `k / nSeg ± a bit`
     * makes every board's joints cluster around 0.33 / 0.5 / 0.67 of the tile, and sixteen boards
     * clustering at the same three heights is a visible band of joints running across the floor
     * every 2.32 m — which is the one thing a staggered floor is laid to avoid. Rejection-sampled
     * for a minimum 0.22-tile separation so two joints never land on top of each other. */
    const segs: { at: number; tone: number }[] = [];
    for (let k = 0, guard = 0; k < 2 && guard < 24; guard++) {
      const at = 0.12 + rnd() * 0.76;
      if (segs.every((s) => Math.abs(s.at - at) > 0.22)) {
        segs.push({ at, tone: tone * (0.9 + rnd() * 0.18) });
        k++;
      }
    }
    segs.sort((a, b) => a.at - b.at);
    return { tone, warm: 0.965 + rnd() * 0.07, grainPhase: rnd() * Math.PI * 2, segs };
  });

  /* ── Albedo, sRGB. WHITE-CENTRED variation: `MATERIAL_COLOR_HEX.M_FLOOR.color` is the base hue.
   *    Mean stays near 0.93 so the floor reads as 0x7D5636 with plank-to-plank life, not as a
   *    darker second copy of it. ────────────────────────────────────────────────────────────── */
  const ga = ctx2d(ALB);
  const bw = ALB / boardsPerTile;

  const rgb = (tone: number, warm: number): string => {
    const r = Math.min(255, Math.round(255 * tone * warm));
    const g = Math.min(255, Math.round(255 * tone));
    const b = Math.min(255, Math.round(255 * tone * (2 - warm)));
    return `rgb(${r},${g},${b})`;
  };

  for (let i = 0; i < boardsPerTile; i++) {
    const b = board[i]!;
    const x0 = Math.round(i * bw);
    const w = Math.ceil(bw) + 1;

    /* Base tone, then each segment past its joint. tone/warm are centred on 1.0 (the multiplier
     * convention above), so this whole pass is a variation map and never an absolute colour. */
    ga.fillStyle = rgb(b.tone, b.warm);
    ga.fillRect(x0, 0, w, ALB);
    for (const s of b.segs) {
      ga.fillStyle = rgb(s.tone, b.warm);
      ga.fillRect(x0, Math.round(s.at * ALB), w, ALB);
    }

    /* Grain. Two populations, because one is not enough to read as wood at 0.9 mm/px:
     *   - CATHEDRAL figure: long nested arcs, the plainsawn signature, drawn dark and soft;
     *   - straight fibre: fine near-vertical lines that carry the direction at grazing angles.
     * Every stroke is drawn a second time offset by one tile height, so a stroke that runs off the
     * bottom comes back at the top and the 2.32 m repeat has no seam line across the floor. */
    ga.save();
    for (let k = 0; k < 7; k++) {
      const cx = x0 + (0.2 + rnd() * 0.6) * bw;
      const y0 = rnd() * ALB;
      const len = ALB * (0.35 + rnd() * 0.55);
      const bow = bw * (0.12 + rnd() * 0.3);
      ga.globalAlpha = 0.1 + rnd() * 0.1;
      ga.strokeStyle = '#000000';
      ga.lineWidth = 2 + rnd() * 5;
      for (const dy of [0, -ALB, ALB]) {
        ga.beginPath();
        ga.moveTo(cx - bow, y0 + dy);
        ga.quadraticCurveTo(cx + bow, y0 + len * 0.5 + dy, cx - bow, y0 + len + dy);
        ga.stroke();
      }
    }
    for (let k = 0; k < 30; k++) {
      const u = x0 + rnd() * bw;
      const y0 = rnd() * ALB;
      const len = ALB * (0.2 + rnd() * 0.7);
      ga.globalAlpha = 0.05 + rnd() * 0.06;
      ga.strokeStyle = rnd() < 0.62 ? '#000000' : '#ffffff';
      ga.lineWidth = 1 + rnd() * 1.6;
      for (const dy of [0, -ALB, ALB]) {
        ga.beginPath();
        ga.moveTo(u, y0 + dy);
        ga.bezierCurveTo(
          u + Math.sin(b.grainPhase + k) * 4,
          y0 + len * 0.33 + dy,
          u - Math.sin(b.grainPhase - k) * 4,
          y0 + len * 0.66 + dy,
          u,
          y0 + len + dy,
        );
        ga.stroke();
      }
    }
    ga.restore();

    /* Edge shading. A board is crowned, so both its long edges turn away from the light — and at
     * 5 m from the camera a 3 mm seam line is a third of a pixel while a 15 mm shaded edge is two.
     * THIS, not the seam, is what makes boards legible at distance; without it a 145 mm plank floor
     * reads as one continuous surface with hairlines ruled on it. */
    const edge = ga.createLinearGradient(x0, 0, x0 + bw, 0);
    edge.addColorStop(0.0, 'rgba(0,0,0,0.30)');
    edge.addColorStop(0.14, 'rgba(0,0,0,0.0)');
    edge.addColorStop(0.86, 'rgba(0,0,0,0.0)');
    edge.addColorStop(1.0, 'rgba(0,0,0,0.22)');
    ga.fillStyle = edge;
    ga.fillRect(x0, 0, w, ALB);

    /* Board seam and butt joints: darkened, but nowhere near black — a 2 mm groove in a lit floor
     * is a value shift, not a hole. The seam gets a lit lip on its far side, which is what a
     * chamfered board edge actually does under a raking key. */
    ga.fillStyle = 'rgba(0,0,0,0.5)';
    ga.fillRect(x0, 0, 3, ALB);
    ga.fillStyle = 'rgba(255,255,255,0.12)';
    ga.fillRect(x0 + 3, 0, 2, ALB);
    for (const s of b.segs) {
      ga.fillStyle = 'rgba(0,0,0,0.42)';
      ga.fillRect(x0, Math.round(s.at * ALB), w, 3);
    }
  }
  const albedo = new CanvasTexture(ga.canvas);
  albedo.colorSpace = SRGBColorSpace; // set again by assignMap; explicit here for readability

  /* ── Roughness, non-colour, MULTIPLIER. `MATERIAL_PARAMS.M_FLOOR.roughness = 0.42` is the base,
   *    so this map spans [0.80, 1.00] and the effective roughness spans [0.336, 0.420]. Grooves are
   *    the ROUGHEST (1.0): dust and wax build up in them, and a groove glossier than the board
   *    reads as wet. The new term is the BUFF PATTERN — broad diagonal lanes where the floor has
   *    been polished harder, which is the difference between one uniform specular sheet and a
   *    sheet with structure in it. ─────────────────────────────────────────────────────────── */
  const gr = ctx2d(NRM);
  const rw = NRM / boardsPerTile;
  for (let i = 0; i < boardsPerTile; i++) {
    const b = board[i]!;
    // A paler board is slightly more worn, so slightly rougher.
    const v = Math.round(255 * Math.min(1, 0.88 + (0.12 * (b.tone - 0.86)) / 0.17));
    gr.fillStyle = `rgb(${v},${v},${v})`;
    gr.fillRect(Math.round(i * rw), 0, Math.ceil(rw) + 1, NRM);
    gr.fillStyle = 'rgb(255,255,255)';
    gr.fillRect(Math.round(i * rw), 0, 2, NRM);
    for (const s of b.segs) {
      gr.fillRect(Math.round(i * rw), Math.round(s.at * NRM), Math.ceil(rw), 1);
    }
  }
  /* Buff lanes: where the floor has been polished harder, and it is polished ALONG the grain, so
   * they run within ±6° of the boards. Kept faint on purpose — at 0.16 alpha and 0.11 of the tile
   * they read as grease stains rather than as polish, and because the map spans only [0.80, 1.00]
   * a visible lane is a large roughness step, which is exactly the wrong place to spend contrast.
   * Wrapped in both axes so the 2.32 m tile stays seamless. */
  gr.save();
  gr.globalAlpha = 0.055;
  gr.lineWidth = NRM * 0.045;
  gr.lineCap = 'round';
  for (let k = 0; k < 20; k++) {
    const x = rnd() * NRM;
    const y = rnd() * NRM;
    const a = (rnd() - 0.5) * 0.2;
    gr.strokeStyle = rnd() < 0.55 ? '#000000' : '#ffffff';
    for (const dx of [-NRM, 0, NRM]) {
      for (const dy of [-NRM, 0, NRM]) {
        gr.beginPath();
        gr.moveTo(x + dx, y + dy);
        gr.lineTo(x + dx + Math.sin(a) * NRM * 0.9, y + dy + Math.cos(a) * NRM * 0.9);
        gr.stroke();
      }
    }
  }
  gr.restore();
  const roughness = new CanvasTexture(gr.canvas);

  /* ── Normal, non-colour. A height field in METRES, differentiated against the real world texel
   *    size — the first version used arbitrary "height units" and produced ~54 degree normals that
   *    aliased into a moire streak at grazing angles, which is the single worst thing a floor can
   *    do in a 360-degree orbit. A dojo board is flat: sub-millimetre relief only. ──────────── */
  const gn = ctx2d(NRM);
  const img = gn.createImageData(NRM, NRM);
  const d = img.data;
  const nbw = NRM / boardsPerTile;
  /** World size of one normal-map texel, metres. */
  const texelM = FLOOR_TILE_M / NRM; // 2.32 / 1024 = 2.266 mm
  /** Height in METRES. Real numbers: a sanded board crowns ~0.25 mm; a seam is a ~0.6 mm groove. */
  const CROWN_M = 0.00025;
  const SEAM_M = 0.0006;
  const JOINT_M = 0.0004;
  const GRAIN_M = 0.00004;
  const height = (x: number, y: number): number => {
    const bi = ((Math.floor(x / nbw) % boardsPerTile) + boardsPerTile) % boardsPerTile;
    const b = board[bi]!;
    const u = (x % nbw) / nbw; // 0..1 across the board
    let h = Math.sin(Math.PI * u) * CROWN_M;
    h -= Math.exp(-(u * u) / 0.0009) * SEAM_M;
    h -= Math.exp(-((1 - u) * (1 - u)) / 0.0009) * SEAM_M * 0.4;
    for (const s of b.segs) {
      const dy = ((y / NRM - s.at + 1) % 1) * NRM;
      h -= Math.exp(-(dy * dy) / 6) * JOINT_M;
    }
    h += Math.sin(b.grainPhase + y * 0.09) * GRAIN_M;
    return h;
  };
  for (let y = 0; y < NRM; y++) {
    for (let x = 0; x < NRM; x++) {
      // Central difference over 2 texels, in metres: dh/dx has real slope units.
      const hx = (height((x + 1) % NRM, y) - height((x - 1 + NRM) % NRM, y)) / (2 * texelM);
      const hy = (height(x, (y + 1) % NRM) - height(x, (y - 1 + NRM) % NRM)) / (2 * texelM);
      // n = normalize(-dh/dx, -dh/dy, 1), packed to 0..255.
      const len = Math.hypot(hx, hy, 1);
      const o = (y * NRM + x) * 4;
      d[o] = Math.round((-hx / len) * 127.5 + 127.5);
      d[o + 1] = Math.round((-hy / len) * 127.5 + 127.5);
      d[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      d[o + 3] = 255;
    }
  }
  gn.putImageData(img, 0, 0);
  const normal = new CanvasTexture(gn.canvas);

  for (const t of [albedo, roughness, normal]) {
    t.wrapS = RepeatWrapping; // doc 05 §12: the default is ClampToEdge, which tiles as one stretch
    t.wrapT = RepeatWrapping;
    // doc 05 §11.1: MANDATORY on a floor viewed at grazing angles. Texture.DEFAULT_ANISOTROPY is 1,
    // and WebGLTextures.js:702 clamps this to capabilities.getMaxAnisotropy(), so 8 is always legal
    // even though `buildStage` has no renderer to query.
    t.anisotropy = MATERIAL_PARAMS.M_FLOOR!.mapAnisotropy!.v;
  }
  return { albedo, roughness, normal };
}

/**
 * The floor's `color` attribute: the room's light, painted onto the boards.
 *
 * A tiling texture is by definition the same everywhere, so it cannot say the one thing that turns
 * a slab into a floor IN a room — that the far corners are darker than the middle. Direct light
 * cannot say it either: the rig is four world-fixed directionals (§5.4) and a directional falls off
 * with nothing. So the falloff is authored, as a pure function of world position, and multiplied
 * into the diffuse albedo (`color_fragment.glsl.js`; it does not touch the specular, which is
 * correct — a polished floor's reflection does not dim just because the diffuse does).
 *
 * Vertex colours are consumed as LINEAR values, not sRGB, so these are true reflectance multipliers.
 */
function floorVertexColours(geo: BufferGeometry, halfM: number): void {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // The plane is authored in its own XY and rotated to the floor at build time, so local y is
    // world -z. Only the radius matters here and the falloff is radially symmetric, so it does not.
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / halfM;
    // Flat across the training area, then a long fall into the corners. The knee sits well outside
    // the 4.68 m stage box so nothing the karateka stands on is ever graded.
    const pool = 1 - 0.52 * Math.min(1, Math.max(0, (r - 0.28) / 0.72)) ** 1.6;
    col[i * 3] = pool * 1.02;
    col[i * 3 + 1] = pool;
    col[i * 3 + 2] = pool * 0.94; // the far floor cools as it leaves the shoji glow
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
}

function makeEmbusenDecal(spanM: number): Texture {
  const S = 1024;
  const g = ctx2d(S);
  const px = S / spanM; // pixels per metre
  const mid = S / 2;

  g.clearRect(0, 0, S, S);
  g.lineCap = 'butt';

  /* `L`-pitch grid, mirror-symmetric about both axes — see the header. Softer than it was: this is
   * tape on a board floor, not a HUD, and at 0.55 material opacity the half-L lines were still the
   * brightest edge in the lower third of frame at `LOW34`. */
  const steps = Math.floor(spanM / 2 / (L_M / 2));
  for (let i = -steps; i <= steps; i++) {
    const half = i % 2 !== 0; // half-L lines are fainter
    const p = mid + i * (L_M / 2) * px;
    g.strokeStyle = half ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.34)';
    g.lineWidth = half ? 1.5 : 2.5;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }

  /* Origin cross — the yoi datum. The one mark that stays fully legible. */
  g.strokeStyle = 'rgba(255,255,255,0.72)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(mid - 0.28 * px, mid);
  g.lineTo(mid + 0.28 * px, mid);
  g.moveTo(mid, mid - 0.28 * px);
  g.lineTo(mid, mid + 0.28 * px);
  g.stroke();

  /* One-`L` ring: the embusen step unit, made visible. */
  g.strokeStyle = 'rgba(255,255,255,0.24)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(mid, mid, L_M * px, 0, Math.PI * 2);
  g.stroke();

  /* Corner ticks on the stage box itself, which is what a real floor is actually marked with. */
  g.strokeStyle = 'rgba(255,255,255,0.34)';
  g.lineWidth = 5;
  const inset = 0.06 * px;
  const arm = 0.34 * px;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = mid + sx * (mid - inset);
      const cy = mid + sy * (mid - inset);
      g.beginPath();
      g.moveTo(cx - sx * arm, cy);
      g.lineTo(cx, cy);
      g.lineTo(cx, cy - sy * arm);
      g.stroke();
    }
  }

  const t = new CanvasTexture(g.canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = MATERIAL_PARAMS.M_FLOOR!.mapAnisotropy!.v;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Build
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Everything `buildStage` allocated, so `disposeStage` can free it exactly. */
const OWNED = new WeakMap<StageHandle, { geo: { dispose(): void }[]; tex: Texture[] }>();

/**
 * §3.13. Adds the floor, room shell and embusen decal to `s` and wires their maps.
 * BROWSER-ONLY: it draws `CanvasTexture`s.
 */
export function buildStage(s: Scene, m: MaterialSet): StageHandle {
  const geo: { dispose(): void }[] = [];
  const tex: Texture[] = [];

  /* ── Floor ────────────────────────────────────────────────────────────────────────────────── */
  const floorSpan = 2 * FLOOR_RADIUS_M;
  const floorGeo = new PlaneGeometry(floorSpan, floorSpan, 32, 32);
  // Graded against the ROOM, not the slab: the overhang past the wall is never seen from inside,
  // so grading against `FLOOR_RADIUS_M` would spend the whole falloff on floor nobody looks at.
  floorVertexColours(floorGeo, BACKDROP_RADIUS_M);
  geo.push(floorGeo);
  const maps = makeFloorMaps();
  tex.push(maps.albedo, maps.roughness, maps.normal);
  const repeat = floorSpan / FLOOR_TILE_M;
  for (const t of [maps.albedo, maps.roughness, maps.normal]) t.repeat.set(repeat, repeat);

  const floorMat = m.M_FLOOR as MeshStandardMaterial;
  assignMap(floorMat, 'map', maps.albedo); // SRGBColorSpace, set by policy
  assignMap(floorMat, 'roughnessMap', maps.roughness); // NoColorSpace
  assignMap(floorMat, 'normalMap', maps.normal); // NoColorSpace
  // The height field is already physically scaled (see makeFloorMaps), so this stays modest. Raising
  // it is the fastest way back to the grazing-angle moire it was written to avoid — 2.5 was tried,
  // and while the board relief is lovely at 3 m it starts to crawl on the far boards at LOW34.
  // 1.1 against the 0.25 mm crown is a 0.28 mm effective cup, which is what a real sprung board
  // does, and it is what makes each board catch its own edge of the key.
  floorMat.normalScale.set(1.1, 1.1);
  // Paired with `floorVertexColours`. Set HERE and not in `createMaterials()` on purpose: the flag
  // and the attribute that satisfies it have to land together, or the shader reads an absent
  // `color` attribute as (0,0,0) and the floor renders black.
  floorMat.vertexColors = true;

  const floor = new Mesh(floorGeo, floorMat);
  floor.name = 'stage.floor';
  floor.rotation.x = -Math.PI / 2; // local +Z -> world +Y
  floor.receiveShadow = true;
  floor.castShadow = false; // doc 05 §6.4 — prevents floor-vs-floor shadow acne
  floor.matrixAutoUpdate = false;
  floor.updateMatrix();
  s.add(floor);

  /* ── Room shell ───────────────────────────────────────────────────────────────────────────── */
  const backGeo = makeRoomShellGeometry();
  geo.push(backGeo);
  const wall = makeDojoWallTexture();
  tex.push(wall);
  const backMat = m.M_BACKDROP as MeshBasicMaterial;
  assignMap(backMat, 'map', wall);
  backMat.side = BackSide; // seen from the inside. NOT DoubleSide — §5.5, grep-banned
  backMat.vertexColors = true; // `makeRoomShellGeometry` writes the attribute; see its header
  const backdrop = new Mesh(backGeo, backMat);
  backdrop.name = 'stage.backdrop';
  // The shell is authored in world metres already (its base sits at WALL_BASE_Y_M, below the floor
  // plane, so the junction is buried), so it needs no transform at all.
  backdrop.receiveShadow = false;
  backdrop.castShadow = false;
  backdrop.matrixAutoUpdate = false;
  backdrop.updateMatrix();
  s.add(backdrop);

  /* ── Embusen decal ────────────────────────────────────────────────────────────────────────── */
  const spanM = STAGE_AABB_M;
  const embGeo = new PlaneGeometry(spanM, spanM);
  geo.push(embGeo);
  const embTex = makeEmbusenDecal(spanM);
  tex.push(embTex);
  const embMat = m.M_EMBUSEN as MeshBasicMaterial;
  assignMap(embMat, 'map', embTex);
  const embusen = new Mesh(embGeo, embMat);
  embusen.name = 'stage.embusen';
  embusen.rotation.x = -Math.PI / 2;
  embusen.position.set(0, MATERIAL_PARAMS.M_EMBUSEN!.planeYM!.v, STAGE_CENTRE_Z_M);
  embusen.receiveShadow = false;
  embusen.castShadow = false;
  embusen.renderOrder = 1; // after the floor, with depthWrite false (§5.6)
  embusen.matrixAutoUpdate = false;
  embusen.updateMatrix();
  s.add(embusen);

  const handle: StageHandle = { floor, backdrop, embusen };
  OWNED.set(handle, { geo, tex });
  return handle;
}

/** Frees the geometries and textures `buildStage` created. Materials belong to `createMaterials`. */
export function disposeStage(s: Scene, handle: StageHandle): void {
  const owned = OWNED.get(handle);
  // Materials are NOT freed here: they belong to `createMaterials()` and are shared with the rig.
  // `disposeMaterials(mats)` is the owner of that lifetime.
  for (const mesh of [handle.floor, handle.backdrop, handle.embusen]) s.remove(mesh);
  if (owned !== undefined) {
    for (const g of owned.geo) g.dispose();
    for (const t of owned.tex) t.dispose();
    OWNED.delete(handle);
  }
}
