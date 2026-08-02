/**
 * B5 RENDER — `src/render/dojoWall.ts`
 *
 * `makeDojoWallTexture` / `makeRoomShellGeometry`: the ROOM. One `CanvasTexture` elevation and one
 * hand-built eight-segment shell, both authored in metres, both consumed only by `stage.ts`.
 *
 * `[ART]` in its entirety. Nothing in this file is a doc value; ARCHITECTURE.md §5.6 specifies the
 * backdrop as "1 draw call" and says nothing about what is painted on it. The constraint this file
 * honours is the draw-call one, and it honours it exactly: the shell is ONE `BufferGeometry` with
 * ONE material, same as the cylinder it replaces.
 *
 * ── WHY THE BACKDROP IS NO LONGER A CYLINDER ──────────────────────────────────────────────────
 * The first backdrop was a `CylinderGeometry` carrying a vertical gradient. Two things that costs,
 * both visible in a capture and neither fixable by re-grading the gradient:
 *
 *   1. **The horizon is an ARC.** A cyclorama has no corners, so the floor/wall junction sweeps
 *      across frame as a curve. Every real interior has a straight horizon broken by verticals; a
 *      curved one is the single most reliable "this is a product turntable, not a room" tell, and it
 *      is in frame at `LOW34` and `JUDGE`, which are both in the default shot list (§7.3).
 *   2. **There is no parallax.** A surface of revolution centred on the orbit target presents the
 *      SAME silhouette at every azimuth. Orbiting reads as the figure spinning, not as the camera
 *      moving through a space, because nothing in the background changes shape.
 *
 * A room with corners fixes both for the same one draw call: corners give straight verticals, a
 * straight horizon, and real perspective convergence that shears as the camera orbits. The plan is
 * a chamfered square rather than a square, for a reason that is entirely about the camera's far
 * plane and is set out below `ROOM_HALF_M`.
 *
 * ── WHY IT IS HAND-BUILT AND NOT A `BoxGeometry` ──────────────────────────────────────────────
 * `BoxGeometry` maps its own 0..1 UV onto EVERY face including the lid, so a single-material box
 * would paint shoji screens across the ceiling. The alternatives are a six-material array (six draw
 * calls) or one mesh per wall. Building every segment into one geometry costs ONE draw call and,
 * more usefully, lets `u` run in metres along each segment — so the panel pitch is authored in
 * metres, the tile seam sits deliberately on a post, and the corners land on a post because each
 * segment is given a whole number of tiles. It also lets the plan be something other than a box,
 * which the far-plane note below turns out to require.
 *
 * There is no lid. `ORBIT_CONTROLS.maxPolarAngleRad` is 1.52 rad — the camera is never below the
 * orbit target and never looks up — and the 17.5 m far plane (see below) crops the far wall long
 * before the top of frame reaches `WALL_TOP_Y_M`. The elevation is painted to near-black well under
 * that anyway, so a lid would be an invisible draw call.
 *
 * ── THE ELEVATION IS A REAL ELEVATION ─────────────────────────────────────────────────────────
 * Heights are washitsu proportions, not decoration: a `habaki` shadow line where the wall meets the
 * floor, a `koshiita` boarded wainscot to 0.95 m, shoji bays between the `koshi-nageshi` rail and
 * the `kamoi` lintel, a slatted `ranma` transom above it, then plaster falling into roof shadow.
 * The wainscot and the shadow line are the load-bearing pair: they are what makes the horizon read
 * as a wall MEETING a floor rather than as the edge of a lit disc.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────────────────────────
 * Same rule as the floor maps in `stage.ts`: a capture must be a pure function of
 * `(tick, camera, trackHash, layerWeights)` (§5.3, §6.3), so every variation here comes from a
 * seeded `xorshift32` with a frozen literal. `Math.random()` in a texture generator would make two
 * runs at the same sha differ for a reason no diff would explain.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The room, in metres
 *
 * THE ROOM IS SIZED BY THE CAMERA'S FAR PLANE, AND IT IS A TIGHT FIT. FOUND BY RENDERING IT.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `CAMERA_PRESET_PARAMS` gives every preset `farH = M_FAR_H`, i.e. 10 H = 17.5 m, and `ORBIT` is
 * not exempt. `ORBIT_CONTROLS.maxDistanceM` is 9.0 m. Those two numbers together say something
 * uncomfortable about any enclosing room: at full zoom-out the camera is 9 m from the target, so a
 * wall on the far side is at `9 + R`, and it is inside the far plane only for `R <= 8.5` — while the
 * camera itself is only inside the room for `R >= 9.0`. There is no R that satisfies both. Every
 * enclosed dojo clips at maximum zoom; the previous cylinder did too, and got away with it purely
 * because its far wall was painted black.
 *
 * The resolution is to stop trying to keep the camera inside and notice WHICH failure is visible.
 * A camera 0.7 m outside the shell at maximum zoom sees nothing wrong: the wall it has stepped
 * through is directly behind it, out of frame, and `BackSide` culls it anyway. A far wall past the
 * far plane is a black hole in the middle of the picture. So the room is sized against the far
 * plane, not against the orbit limit:
 *
 *   R = 8.3 m  — the far wall at full 9 m zoom-out lands at 17.3 m, inside the far plane. At the
 *                DEFAULT 5.04 m distance it is at 13.3 m, with 4 m of margin.
 *   corners chamfered by 3.4 m — the load-bearing half. A square room's corner sits at
 *                `R * sqrt(2)` = 11.7 m from the origin, so at the default distance the far corner
 *                lands at 16.8 m and at 7 m it is past the plane — and a clipped corner renders as
 *                a black trapezoid of `scene.background` right through the middle of frame at
 *                exactly the three-quarter azimuths the default shot list uses. Cutting the corners
 *                pulls the furthest point in to 9.64 m and buys another 2 m of orbit distance.
 *
 * A 16.6 m hall is also simply a better dojo than a 21 m one: closer walls mean the perspective
 * shears faster as the camera orbits, which is the whole reason for having walls with corners.
 *
 * Residual, honestly: past about 7.5 m of orbit distance the furthest chamfer VERTEX crosses the
 * plane, reaching ~1.1 m of clipped wall at the 9 m limit. It is a sliver at the horizon rather
 * than a wedge through the middle of frame. No geometry removes it — the fix is
 * `CAMERA_PRESET_PARAMS`' `farH`, which is B1's, and `ENV_COLOR_HEX.background`, which is B1's too:
 * a dark WARM background instead of `0x0e0f12` would make what clipping remains nearly invisible.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Half-extent of the room, metres — the distance from the embusen origin to a main wall. */
export const ROOM_HALF_M = 8.3;
/** How much is cut off each corner, along both axes. See the far-plane note above. */
const CHAMFER_M = 3.4;

/** Buried below the floor plane, so the floor/wall junction is a painted shadow line, not a seam. */
export const WALL_BASE_Y_M = -0.75;
/**
 * Above anything the far plane leaves standing — the elevation is painted to roof shadow by 7.6 m
 * and the last two metres exist only so a near wall at minimum zoom still has a top.
 */
export const WALL_TOP_Y_M = 9.75;

/**
 * Nominal horizontal repeat of the elevation: three shoji bays.
 *
 * NOMINAL, because `makeRoomShellGeometry` gives every wall segment a WHOLE number of tiles and
 * stretches to fit — a chamfered plan has two segment lengths and neither divides a fixed tile.
 * The stretch is -7 % on the 9.8 m main walls (1.63 m bays) and -8 % on the 4.81 m chamfers
 * (1.60 m bays), which is invisible and, as it happens, lands the two bay pitches within 2 % of
 * each other. What the whole-tile rule buys is that `u` lands on an integer at every corner, and
 * there is a post drawn at every integer `u` — so the corners are posts by construction rather
 * than by arithmetic that a later size change would silently break.
 */
export const WALL_TILE_M = 5.25;
/** Shoji bay pitch within one tile. */
const BAY_PITCH_M = WALL_TILE_M / 3;

const WALL_H_M = WALL_TOP_Y_M - WALL_BASE_Y_M; // 10.5 m — square tile, square pixels

/* ── The elevation, floor upward. Every number is a height in world metres. ─────────────────── */

const E = Object.freeze({
  /** `habaki` — the shadow line where plaster meets board. The grounding cue. */
  shadowLineTopM: 0.1,
  /** `koshiita` — the boarded wainscot. Dark, so the figure's feet always have value behind them. */
  wainscotTopM: 0.95,
  /** `koshi-nageshi` — the rail that caps the wainscot. */
  lowRailTopM: 1.03,
  /** Shoji bays run from the low rail to the lintel. 2.05 m of paper: a real screen height. */
  shojiTopM: 3.08,
  /** `kamoi` — the lintel the screens run in. */
  lintelTopM: 3.26,
  /** `ranma` — the slatted transom above the lintel. Dark, and it reads as depth. */
  ranmaTopM: 4.22,
  /** `nageshi` — the upper rail that closes the transom band. */
  highRailTopM: 4.36,
  /**
   * `hari` — the tie beam, and the reason there is anything up here at all.
   *
   * The far CORNER of a 21 m room is 15 m from the orbit target, and a corner 15 m away shows the
   * wall 2 m higher up than the near walls do — so the band between the transom and the roof is a
   * black wedge sitting in the middle of frame at exactly the three-quarter azimuths the default
   * shot list uses. A gradient to black is not a fix; a gradient to black IS the wedge. The beam,
   * and the boarding above it, give that band a horizontal and a value to read against.
   */
  beamBottomM: 5.62,
  beamTopM: 5.96,
  /** Above this the plaster is in roof shadow and the elevation is doing nothing but going dark. */
  plasterTopM: 7.6,
  /** `hashira` — the post between bays, and on every corner. */
  postWM: 0.13,
  /**
   * Kumiko grid, PER LEAF. A bay holds two sliding leaves, not one big pane, and that matters more
   * than the grid pitch does: one 1.93 m x 2.05 m pane divided 5x8 reads as a factory window, and
   * the same area as two 0.9 m leaves at 3x7 reads as shoji. The paired stile down the middle is
   * the whole tell.
   */
  kumikoCols: 3,
  kumikoRows: 7,
  kumikoPxW: 3,
  /** Leaves per bay, and the stile between them. */
  leavesPerBay: 2,
});

/** Sealed-timber and plaster tones, sRGB. Chosen bright: AgX pulls a full stop out of the mids. */
const C = Object.freeze({
  shadowLine: 0x0b0908,
  wainscot: 0x3d2c1e,
  wainscotSeam: 0x1c140d,
  rail: 0x8a6a45,
  post: 0x6d5133,
  postShade: 0x4a3722,
  /** Washi lit from OUTSIDE. The brightest thing in the room and still nowhere near clipping. */
  shoji: 0xd9c6a4,
  kumiko: 0x4b3826,
  lintel: 0x7d5f3e,
  ranma: 0x1d1610,
  ranmaSlat: 0x5d4830,
  /** `shikkui` — warm grey lime plaster. */
  plaster: 0x6d6152,
  /** The tie beam, and the dark boarded soffit above it. */
  beam: 0x5b4529,
  soffit: 0x2a231b,
  roofShadow: 0x0a0a0b,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Deterministic noise. Frozen literal — see the header.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const WALL_SEED = 0x2b7a1c39;

function xorshift32(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0x100000000) / 0x100000000;
  };
}

function ctx2d(width: number, height: number): CanvasRenderingContext2D {
  if (typeof document === 'undefined') {
    throw new Error(
      'render/dojoWall.ts: the room elevation is a CanvasTexture and needs a DOM. It is a ' +
        'browser-only path by design; the GL-free channel (tools/score.mjs) never builds a stage.',
    );
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  if (g === null) throw new Error('render/dojoWall.ts: 2D canvas context unavailable.');
  return g;
}

const hex = (v: number): string => `#${v.toString(16).padStart(6, '0')}`;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The elevation
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** 1024 px across a 5.25 m tile: 195 px/m, against ~95 screen px/m at the wall. 2x headroom. */
const TEX_W = 1024;
const TEX_H = Math.round((TEX_W * WALL_H_M) / WALL_TILE_M); // 2048 — square pixels

/* ── The shomen, and why it lives in the same canvas ────────────────────────────────────────────
 *
 * A room of identical bays repeated all the way round has no FRONT, and a dojo is a room that is
 * entirely about having a front: the shomen is what the line bows to and what every heading in the
 * embusen is measured against. Without one, the twelve-bay hall reads as a nicely detailed lobby.
 *
 * It cannot go in the tiling elevation — the whole point is that it appears exactly once — and a
 * second mesh would be a second draw call against §5.6's budget for a single 5.25 x 2.63 m panel.
 * So the canvas is grown by 512 rows and the panel is painted into the strip above the elevation,
 * as a texture ATLAS: the wall quads take `v` in `[0, WALL_V_TOP]` and the shomen quad takes
 * `[WALL_V_TOP, 1]`, both out of the same map, on the same geometry, in the same draw call.
 *
 * Atlas bleed at high mip levels is real and is handled by what is adjacent: the elevation's last
 * row is roof shadow and the panel's first row is its own dark frame, so the two rows that blur
 * into each other are the same near-black.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Height of the shomen strip in the atlas, px. 512 / 195 px/m = 2.63 m. */
const KAMIZA_PX = 512;
const TEX_TOTAL_H = TEX_H + KAMIZA_PX;
/** The `v` at which the elevation stops and the shomen strip begins. */
export const WALL_V_TOP = TEX_H / TEX_TOTAL_H;
/** World size of the shomen panel, and where it hangs on the wall. */
export const KAMIZA_W_M = WALL_TILE_M;
export const KAMIZA_H_M = (KAMIZA_PX / TEX_W) * WALL_TILE_M;
export const KAMIZA_BASE_Y_M = 0.95;
/** Stood off the wall so the panel reads as applied joinery and never z-fights. */
export const KAMIZA_STANDOFF_M = 0.035;

/**
 * Paints one horizontal repeat of the dojo wall plus the shomen panel, as one sRGB `CanvasTexture`.
 *
 * `CanvasTexture.flipY` defaults to true, so canvas row 0 lands at `v = 1`. The shomen strip is
 * therefore drawn in rows `[0, KAMIZA_PX)` and the elevation below it, with `yPx` offset by the
 * strip; `makeRoomShellGeometry` maps `v = 0` to `WALL_BASE_Y_M` and `v = WALL_V_TOP` to
 * `WALL_TOP_Y_M`. The two agree by construction and there is no vertical flip in the chain to get
 * wrong.
 */
export function makeDojoWallTexture(): Texture {
  const g = ctx2d(TEX_W, TEX_TOTAL_H);
  const rnd = xorshift32(WALL_SEED);
  const PX = TEX_W / WALL_TILE_M; // px per metre, both axes
  const xPx = (m: number): number => m * PX;
  const yPx = (m: number): number => KAMIZA_PX + (WALL_TOP_Y_M - m) * PX;
  /** Fill the full tile width between two world heights. */
  const band = (y0: number, y1: number, fill: string): void => {
    g.fillStyle = fill;
    g.fillRect(0, yPx(y1), TEX_W, yPx(y0) - yPx(y1));
  };

  /* ── 1. Flat bands, floor upward. Detail is drawn back over them. ────────────────────────── */
  band(WALL_BASE_Y_M, E.shadowLineTopM, hex(C.shadowLine));
  band(E.shadowLineTopM, E.wainscotTopM, hex(C.wainscot));
  band(E.wainscotTopM, E.lowRailTopM, hex(C.rail));
  band(E.lowRailTopM, E.shojiTopM, hex(C.shoji));
  band(E.shojiTopM, E.lintelTopM, hex(C.lintel));
  band(E.lintelTopM, E.ranmaTopM, hex(C.ranma));
  band(E.ranmaTopM, E.highRailTopM, hex(C.rail));
  band(E.highRailTopM, E.beamBottomM, hex(C.plaster));
  band(E.beamBottomM, E.beamTopM, hex(C.beam));
  band(E.beamTopM, WALL_TOP_Y_M, hex(C.soffit));

  /* ── 2. Wainscot boards. Five horizontal courses with a seeded tone per course, which is what
   *      stops a 0.85 m band of one flat brown reading as a painted stripe. ──────────────────── */
  {
    const courses = 5;
    const h = (E.wainscotTopM - E.shadowLineTopM) / courses;
    const base = new Color(C.wainscot);
    for (let i = 0; i < courses; i++) {
      const y0 = E.shadowLineTopM + i * h;
      const c = base.clone().multiplyScalar(0.86 + rnd() * 0.3);
      band(y0, y0 + h, `#${c.getHexString()}`);
      g.fillStyle = hex(C.wainscotSeam);
      g.fillRect(0, yPx(y0 + h) - 1, TEX_W, 2);
    }
    /* Vertical butt joints, staggered course to course so they never stack into a column. */
    g.fillStyle = hex(C.wainscotSeam);
    for (let i = 0; i < courses; i++) {
      const y0 = E.shadowLineTopM + i * h;
      for (let k = 0; k < 4; k++) {
        g.fillRect(Math.round(xPx(rnd() * WALL_TILE_M)), yPx(y0 + h), 2, Math.round(h * PX));
      }
    }
  }

  /* ── 3. Kumiko grid inside every bay, then the paper's own gradient. ─────────────────────── */
  for (let bay = 0; bay < 3; bay++) {
    const x0 = bay * BAY_PITCH_M + E.postWM / 2;
    const x1 = (bay + 1) * BAY_PITCH_M - E.postWM / 2;
    const w = x1 - x0;

    /* Washi is backlit and brightest at the top of the screen, where the eave stops shading it. */
    const grad = g.createLinearGradient(0, yPx(E.shojiTopM), 0, yPx(E.lowRailTopM));
    grad.addColorStop(0, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0.20)');
    g.fillStyle = grad;
    g.fillRect(xPx(x0), yPx(E.shojiTopM), xPx(w), yPx(E.lowRailTopM) - yPx(E.shojiTopM));

    /* Fibre blotching — washi is a handmade sheet, never an even value. */
    g.save();
    g.globalAlpha = 0.05;
    for (let k = 0; k < 24; k++) {
      const cx = xPx(x0 + rnd() * w);
      const cy = yPx(E.lowRailTopM + rnd() * (E.shojiTopM - E.lowRailTopM));
      const r = xPx(0.06 + rnd() * 0.22);
      g.fillStyle = rnd() < 0.5 ? '#ffffff' : '#000000';
      g.beginPath();
      g.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    /* Two leaves, each with its own kumiko grid and its own frame. */
    const leafW = w / E.leavesPerBay;
    const topPx = yPx(E.shojiTopM);
    const hPx = yPx(E.lowRailTopM) - topPx;
    g.fillStyle = hex(C.kumiko);
    for (let leaf = 0; leaf < E.leavesPerBay; leaf++) {
      const lx = x0 + leaf * leafW;
      for (let i = 1; i <= E.kumikoCols; i++) {
        const u = lx + (i / (E.kumikoCols + 1)) * leafW;
        g.fillRect(Math.round(xPx(u)), topPx, E.kumikoPxW, hPx);
      }
      for (let j = 1; j <= E.kumikoRows; j++) {
        const v = E.lowRailTopM + (j / (E.kumikoRows + 1)) * (E.shojiTopM - E.lowRailTopM);
        g.fillRect(Math.round(xPx(lx)), Math.round(yPx(v)), Math.ceil(xPx(leafW)), E.kumikoPxW);
      }
      /* The leaf's own frame, heavier than the kumiko inside it. The two stiles that meet in the
       * middle of the bay therefore double up, which is exactly what a closed pair of screens
       * looks like and is the cheapest possible "these slide" cue. */
      g.lineWidth = E.kumikoPxW * 2.4;
      g.strokeStyle = hex(C.kumiko);
      g.strokeRect(xPx(lx), topPx, xPx(leafW), hPx);
    }
  }

  /* ── 4. Ranma slats. Vertical, dark, closely spaced — a depth cue above the eye line. ────── */
  {
    const slatPitchM = 0.085;
    const n = Math.round(WALL_TILE_M / slatPitchM);
    g.fillStyle = hex(C.ranmaSlat);
    for (let i = 0; i < n; i++) {
      g.fillRect(
        Math.round(xPx((i * WALL_TILE_M) / n)),
        yPx(E.ranmaTopM),
        Math.max(2, Math.round(xPx(slatPitchM * 0.42))),
        yPx(E.lintelTopM) - yPx(E.ranmaTopM),
      );
    }
  }

  /* ── 5. Posts. On every bay boundary — which puts one on each corner of the room, because the
   *      wall is an exact multiple of the tile and the tile is an exact multiple of the bay. The
   *      seam post is drawn as two halves so the repeat is invisible. ─────────────────────── */
  {
    // Up into the tie beam, not up to the transom rail: a post that stops halfway is a stripe, and
    // the run through the plaster band is the only vertical anything up there has.
    const postTopM = E.beamBottomM;
    for (let i = 0; i <= 3; i++) {
      const cx = i * BAY_PITCH_M;
      const x0 = xPx(cx - E.postWM / 2);
      const w = xPx(E.postWM);
      const y = yPx(postTopM);
      const h = yPx(E.shadowLineTopM) - y;
      g.fillStyle = hex(C.post);
      g.fillRect(x0, y, w, h);
      /* A shaded right edge and a lit left edge: 20 px of fake round-over that reads as timber. */
      g.fillStyle = hex(C.postShade);
      g.fillRect(x0 + w - Math.max(2, w * 0.28), y, Math.max(2, w * 0.28), h);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x0, y, Math.max(2, w * 0.2), h);
    }
  }

  /* ── 6. Rail highlights. A lit top edge and a cast shadow underneath, on both rails, the lintel
   *      and the tie beam. Four 3-pixel lines, and they are what make the timber read as PROUD of
   *      the plaster rather than as four more painted stripes. ──────────────────────────────── */
  for (const topM of [E.lowRailTopM, E.lintelTopM, E.highRailTopM, E.beamTopM]) {
    g.fillStyle = 'rgba(255,240,220,0.30)';
    g.fillRect(0, yPx(topM), TEX_W, 3);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(0, yPx(topM) + 3, TEX_W, 5);
  }

  /* ── 7. Plaster. A little large-scale mottle, then the roof shadow, which is a hard multiply so
   *      the top of the wall is genuinely black and not a grey ceiling. ──────────────────── */
  g.save();
  g.globalAlpha = 0.025;
  for (let k = 0; k < 40; k++) {
    const cy = yPx(E.highRailTopM + rnd() * (E.plasterTopM - E.highRailTopM));
    g.fillStyle = rnd() < 0.5 ? '#ffffff' : '#000000';
    g.beginPath();
    g.ellipse(xPx(rnd() * WALL_TILE_M), cy, xPx(0.35 + rnd() * 0.5), xPx(0.1 + rnd() * 0.2), 0, 0, 7);
    g.fill();
  }
  g.restore();

  {
    const grad = g.createLinearGradient(0, yPx(WALL_TOP_Y_M), 0, yPx(E.highRailTopM));
    grad.addColorStop(0.0, hex(C.roofShadow));
    grad.addColorStop(0.52, 'rgba(10,10,11,0.62)');
    grad.addColorStop(1.0, 'rgba(10,10,11,0.0)');
    g.fillStyle = grad;
    // From the top of the ELEVATION, not from row 0 — row 0 is the shomen strip of the atlas.
    g.fillRect(0, yPx(WALL_TOP_Y_M), TEX_W, yPx(E.highRailTopM) - yPx(WALL_TOP_Y_M));
  }

  /* ── 8. Ambient occlusion into the floor. The wall darkens as it approaches the boards; the
   *      figure's contact shadow then has something to sit against instead of a flat value. ── */
  {
    const grad = g.createLinearGradient(0, yPx(1.5), 0, yPx(WALL_BASE_Y_M));
    grad.addColorStop(0.0, 'rgba(0,0,0,0.0)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.24)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0.78)');
    g.fillStyle = grad;
    g.fillRect(0, yPx(1.5), TEX_W, yPx(WALL_BASE_Y_M) - yPx(1.5));
  }

  /* ── 9. The shomen strip, rows [0, KAMIZA_PX). See the atlas note above `KAMIZA_PX`. ─────── */
  paintShomen(g, rnd, PX);

  const t = new CanvasTexture(g.canvas);
  t.colorSpace = SRGBColorSpace;
  // u repeats around the perimeter; v spans the wall exactly once, so it must NOT wrap — a
  // repeating v would mirror the roof shadow back onto the wainscot at the first float error.
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 8; // the wall is viewed at grazing incidence at every corner
  return t;
}

/* ── The shomen panel ────────────────────────────────────────────────────────────────────────
 *
 * Boarded cedar with a stile-and-rail frame, and a `kakejiku` — a hanging scroll — on the centre
 * line, carrying an `enso`.
 *
 * The enso is chosen over a kanji for a reason that is about determinism, not taste. Real
 * characters would mean `fillText`, and `fillText` renders through whatever font the machine
 * happens to resolve — so the same sha would produce different pixels on two machines and the
 * regression gate would report a diff nobody could explain (§5.3, §6.3: a capture is a pure
 * function of `(tick, camera, trackHash, layerWeights)`). An enso is one brush stroke, so it is a
 * path: a circle swept with a width profile and an intentional gap at the closure, drawn from the
 * same seeded stream as everything else here. It reads instantly and it renders identically
 * everywhere.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const K = Object.freeze({
  boardHex: 0x33271a,
  boardSeamHex: 0x1a130c,
  frameHex: 0x6d5133,
  /** Silk mount of the scroll, and the paper inside it. */
  mountHex: 0x584434,
  paperHex: 0xd7cbb2,
  inkHex: 0x140f0b,
  /** Roller ends at the foot of the scroll. */
  rollerHex: 0x2a2019,
  boards: 9,
  scrollWFrac: 0.28,
  scrollTopFrac: 0.06,
  scrollBottomFrac: 0.965,
});

function paintShomen(g: CanvasRenderingContext2D, rnd: () => number, px: number): void {
  const W = TEX_W;
  const H = KAMIZA_PX;

  /* Boarded ground, vertical planks with a seeded tone each. */
  const bw = W / K.boards;
  const base = new Color(K.boardHex);
  for (let i = 0; i < K.boards; i++) {
    const c = base.clone().multiplyScalar(0.85 + rnd() * 0.32);
    g.fillStyle = `#${c.getHexString()}`;
    g.fillRect(Math.round(i * bw), 0, Math.ceil(bw) + 1, H);
    g.fillStyle = hex(K.boardSeamHex);
    g.fillRect(Math.round(i * bw), 0, 3, H);
  }

  /* Frame: a heavy timber surround, lit on the top rail and shaded on the bottom one. */
  const fr = Math.round(0.075 * px); // 75 mm of stile
  g.fillStyle = hex(K.frameHex);
  g.fillRect(0, 0, W, fr);
  g.fillRect(0, H - fr, W, fr);
  g.fillRect(0, 0, fr, H);
  g.fillRect(W - fr, 0, fr, H);
  g.fillStyle = 'rgba(255,240,220,0.22)';
  g.fillRect(0, fr, W, 3);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, fr + 3, W, 6);

  /* The scroll. */
  const sw = W * K.scrollWFrac;
  const sx = (W - sw) / 2;
  const sy0 = H * K.scrollTopFrac;
  const sy1 = H * K.scrollBottomFrac;
  const sh = sy1 - sy0;
  g.fillStyle = 'rgba(0,0,0,0.45)'; // cast shadow, offset down-right
  g.fillRect(sx + 6, sy0 + 8, sw, sh);
  g.fillStyle = hex(K.mountHex);
  g.fillRect(sx, sy0, sw, sh);
  const inset = sw * 0.11;
  const py0 = sy0 + sh * 0.15;
  const py1 = sy1 - sh * 0.13;
  g.fillStyle = hex(K.paperHex);
  g.fillRect(sx + inset, py0, sw - 2 * inset, py1 - py0);
  g.fillStyle = hex(K.rollerHex);
  g.fillRect(sx - sw * 0.045, sy1 - sh * 0.035, sw * 1.09, sh * 0.05);

  /* The enso. A swept circle: the brush is loaded at the start, thins as it comes round, and lifts
   * before it closes. `steps` segments of varying width, plus a little seeded wobble in the radius
   * so it is a stroke rather than a compass arc. */
  {
    const cx = sx + sw / 2;
    const cy = (py0 + py1) / 2;
    const r = Math.min(sw - 2 * inset, py1 - py0) * 0.4;
    const start = -2.2;
    const sweep = Math.PI * 1.86; // the gap at the closure is the point of an enso
    const steps = 128;
    const wob = Array.from({ length: 6 }, () => (rnd() - 0.5) * 0.05);
    const at = (t: number): { x: number; y: number; w: number } => {
      const a = start + t * sweep;
      let rr = r;
      for (let k = 0; k < wob.length; k++) rr *= 1 + wob[k]! * Math.sin((k + 2) * a);
      // Loaded at the head, driest at the tail, with a swell through the middle of the stroke.
      const w = r * (0.24 - 0.16 * t + 0.06 * Math.sin(t * Math.PI));
      return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, w: Math.max(1.5, w) };
    };
    g.fillStyle = hex(K.inkHex);
    for (let i = 0; i < steps; i++) {
      const p = at(i / (steps - 1));
      g.beginPath();
      g.ellipse(p.x, p.y, p.w, p.w, 0, 0, Math.PI * 2);
      g.fill();
    }
    /* Dry-brush: a few pale scratches along the thin tail, where the bristles ran out of ink. */
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 26; k++) {
      const t = 0.55 + rnd() * 0.45;
      const p = at(t);
      g.globalAlpha = 0.35 + rnd() * 0.4;
      g.beginPath();
      g.ellipse(p.x, p.y, p.w * (0.15 + rnd() * 0.3), p.w * 0.9, rnd() * 3.14, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /* The panel is deeper in the room than the shoji either side of it, so it takes a soft gradient
   * from the top down — the same eave shading the elevation has, matched by eye. */
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.34)');
  shade.addColorStop(0.45, 'rgba(0,0,0,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The shell
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `(x, z)` of the eight corners of the chamfered plan, in winding order. Segment `i` runs from
 * corner `i` to corner `i + 1`, so the segments alternate 9.8 m main wall / 4.81 m chamfer.
 */
const CORNERS: readonly (readonly [number, number])[] = (() => {
  const R = ROOM_HALF_M;
  const c = ROOM_HALF_M - CHAMFER_M;
  return Object.freeze([
    [-c, +R],
    [+c, +R],
    [+R, +c],
    [+R, -c],
    [+c, -R],
    [-c, -R],
    [-R, -c],
    [-R, +c],
  ] as const);
})();

/** Unit XZ direction to `LIGHTS.key.posM`. Not imported: this bakes a LOOK, not the light. */
const KEY_AZIMUTH: readonly [number, number] = (() => {
  const n = Math.hypot(2.6, 3.15);
  return [2.6 / n, 3.15 / n];
})();

/**
 * Eight wall segments as ONE `BufferGeometry`, wound so `side: BackSide` shows the interior.
 *
 * The `color` attribute is the whole reason this is subdivided at all: it carries the LARGE-SCALE
 * light on the room, which the tiling elevation texture structurally cannot. Three terms, all pure
 * functions of world position, so the bake is deterministic:
 *
 *   * **facing** — the segments whose inward normal points at KEY are up to 34 % brighter than the
 *     ones behind the camera. Without it an enclosed room is one value repeated eight times and
 *     reads as a cardboard box; with it, orbiting past a corner is a real change in tone.
 *   * **corner** — the last 2.4 m into every corner falls off to 0.74. Corners in real rooms are
 *     the darkest thing in them, and this is what turns the vertical corner line from a graphic
 *     seam into a shaded fold.
 *   * **breakup** — two low-frequency sines in world XZ, ±8 %, which is the only thing preventing
 *     twelve identical tiles from reading as twelve identical tiles.
 *
 * `MeshBasicMaterial` multiplies `color * map * vColor`, so this is a pure multiply on an already
 * unlit surface — no lighting is being faked, the wall is simply painted with its light in it.
 */
export function makeRoomShellGeometry(vSegs = 8): BufferGeometry {
  const rows = vSegs + 1;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  for (let w = 0; w < CORNERS.length; w++) {
    const a = CORNERS[w]!;
    const b = CORNERS[(w + 1) % CORNERS.length]!;
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / segLen;
    const dz = (b[1] - a[1]) / segLen;
    // Inward normal: the wall direction turned 90° toward the room centre.
    const nx = dz;
    const nz = -dx;
    const facing = Math.max(0, nx * KEY_AZIMUTH[0] + nz * KEY_AZIMUTH[1]);
    /** Whole tiles only, so `u` is an integer at both corners and both corners get a post. */
    const uSpan = Math.max(1, Math.round(segLen / WALL_TILE_M));
    // ~0.5 m of horizontal subdivision: enough for the corner falloff and the breakup term to be
    // smooth, and the segment is flat so nothing else needs it.
    const hSegs = Math.max(8, Math.round(segLen / 0.5));
    const cols = hSegs + 1;
    const base = pos.length / 3;

    for (let j = 0; j < rows; j++) {
      const t = j / vSegs;
      const y = WALL_BASE_Y_M + t * WALL_H_M;
      for (let i = 0; i < cols; i++) {
        const s = i / hSegs;
        const along = s * segLen;
        const x = a[0] + dx * along;
        const z = a[1] + dz * along;

        pos.push(x, y, z);
        nrm.push(nx, 0, nz);
        uv.push(s * uSpan, t * WALL_V_TOP);

        const toCorner = Math.min(along, segLen - along);
        const corner = 0.74 + 0.26 * Math.min(1, toCorner / 2.4);
        const breakup =
          1 + 0.05 * Math.sin(x * 0.37 + z * 0.21) + 0.03 * Math.sin(x * 0.11 - z * 0.29);
        const lum = (0.82 + 0.34 * facing) * corner * breakup;
        // A touch warmer where it is lit and cooler where it is not: 100 K of colour separation
        // between adjacent walls is worth more than another 10 % of value separation.
        col.push(lum * (1 + 0.05 * facing), lum, lum * (1 - 0.06 * facing));
      }
    }

    for (let j = 0; j < vSegs; j++) {
      for (let i = 0; i < hSegs; i++) {
        const p = base + j * cols + i;
        idx.push(p, p + 1, p + cols, p + 1, p + cols + 1, p + cols);
      }
    }
  }

  /* ── The shomen panel, on the `-Z` wall, in this same geometry. ────────────────────────────
   *
   * `-Z` because that is the wall the karateka faces at yoi (heading 0), so it is behind the
   * figure from the front cameras and dead ahead from the rear ones — the two places a focal
   * element earns its pixels.
   *
   * The winding walks `x` DOWNWARD, matching the `-Z` wall segment above it (which runs from
   * `+c` to `-c`): both therefore produce a `-Z` face normal, which is the outward one, which is
   * what `side: BackSide` needs. Running `x` upward here would silently backface-cull the panel
   * and it would simply not be in the room. `u` runs the same way, so the painted panel reads
   * left-to-right as seen from INSIDE — facing `-Z`, screen-right is `-X`.
   */
  {
    const zOut = -ROOM_HALF_M + KAMIZA_STANDOFF_M;
    const x0 = +KAMIZA_W_M / 2;
    const x1 = -KAMIZA_W_M / 2;
    const y0 = KAMIZA_BASE_Y_M;
    const y1 = KAMIZA_BASE_Y_M + KAMIZA_H_M;
    const base = pos.length / 3;
    for (const [j, y] of [y0, y1].entries()) {
      for (const [i, x] of [x0, x1].entries()) {
        pos.push(x, y, zOut);
        nrm.push(0, 0, 1);
        uv.push(i, WALL_V_TOP + (1 - WALL_V_TOP) * j);
        // Lit as the `-Z` wall is, plus a little: the shomen is the one thing in the room that is
        // allowed to pull the eye.
        col.push(1.12, 1.06, 0.99);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
