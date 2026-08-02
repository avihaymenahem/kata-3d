/**
 * B5 RENDER — `src/render/props.ts`
 *
 * `buildDojoProps` / `disposeDojoProps`: THE FURNITURE. Everything in the hall that is not the
 * building itself — makiwara, benches, getabako, the kamiza's boards, the clock.
 *
 * `[ART]` in its entirety, same standing as `dojoWall.ts`: ARCHITECTURE.md budgets the room at one
 * draw call and says nothing about what stands in it. The constraint this file honours is the
 * draw-call one, and it honours it in the same way the wall does — by merging.
 *
 * ── WHAT A SHOTOKAN DOJO ACTUALLY CONTAINS, AND WHAT IT DOES NOT ──────────────────────────────
 * The hall has four named sides and they are not interchangeable. Everything below is placed by
 * that map, not by composition:
 *
 *   * **shomen / kamiza** (`-Z` here, the wall the karateka faces at yoi) — reverential space.
 *     Kakejiku, dojo kun, flag, the dojo's own name board. NO equipment, ever.
 *   * **shimoza** (`+Z`, the entrance end) — the working end. Training aids mount here: this is
 *     where the makiwara goes, and where the genkan's shoe rack stands.
 *   * **joseki / shimoseki** (`±X`, the sides) — conventionally BARE. `+X` is left empty on
 *     purpose; a room where every wall carries something reads as a showroom, not a dojo.
 *
 * Four things were considered and deliberately left out, because getting these wrong is the
 * difference between a dojo and a generic martial-arts set:
 *
 *   1. **A weapons rack.** Bo, sai and tonfa are Okinawan KOBUDO. Shotokan is the mainland-Japan
 *      modernisation of karate that left the weapons behind in Okinawa in 1922, and no JKA/JKS/SKIF
 *      grading syllabus contains one. A rack here would be a category error that anyone who trains
 *      would spot instantly. (The side walls are where a rack WOULD go, if the art used them —
 *      which is part of why `+X` is bare.)
 *   2. **Hojo undo implements** — chishi, nigiri game, ishi sashi. Goju-ryu and Uechi-ryu, from
 *      Higaonna's Chinese lineage. The makiwara is the ONLY member of that family that crossed into
 *      Shotokan, and it crossed because Funakoshi put a build appendix for it in `Karate-do Kyohan`.
 *   3. **A mirror run.** A commercial-studio convention. A traditional hall has bare walls.
 *   4. **Stacked tatami.** Shotokan trains on bare sprung wood — which is exactly what `stage.ts`
 *      lays down. Stacked mats only make sense in a hall shared with judo or aikido.
 *
 * A **nafudakake** (the rank board of hanging name tags) is real and IS here, but note where: this
 * building is shoji from 1.03 m up, and hanging a timber board on a paper screen is not a thing.
 * Everything wall-mounted therefore lands on one of the only two solid surfaces the elevation
 * offers — the shomen's boarded panel, or the `koshiita` wainscot below 0.95 m — or it stands on
 * the getabako, which is how a notice board ends up over a genkan in a real building anyway.
 *
 * ── ONE MESH PER MATERIAL. TWO MATERIALS. TWO DRAW CALLS. ─────────────────────────────────────
 * Nine separate props at one mesh each would be nine draw calls against a 43-call frame. Instead
 * everything opaque is baked into ONE `BufferGeometry` with ONE `MeshStandardMaterial`, and the
 * whole thing indexes a single `CanvasTexture` ATLAS — the same trick `dojoWall.ts` uses to get the
 * shomen panel into the wall's draw call, applied to ten cells instead of two.
 *
 * The atlas is what makes one material enough. Painted artwork (the dojo kun, the hinomaru, the
 * name board, the clock face, the tag field) and structural material (timber grain, straw rope)
 * cannot share a shader constant, but they can share a texture, so they do. The convention that
 * keeps them from fighting is `stage.ts`'s, extended by one rule:
 *
 *   * **material cells carry VARIATION AROUND 1.0** (grain, rope twist, cloth) and the vertex
 *     colour carries the actual timber tone. `albedo = white * atlas * vColor`.
 *   * **artwork cells carry ABSOLUTE albedo** (paper, ink, vermilion) and the vertex colour is
 *     white, carrying only the ambient bake.
 *
 * Getting that backwards is the bug `stage.ts`'s header documents at length — a map that multiplies
 * an already-correct scalar squares it, and nothing in `tsc` or the config test catches it.
 *
 * The SECOND draw call is contact shadow, and it is the one call here that is not optional. §5.1's
 * shadow camera is fitted to a 2.625 m box around the karateka (`shadow.ts`, `S_FIT_M`), so nothing
 * seven metres away casts anything — a bench standing on a lit floor with no darkening under it
 * reads as a decal, and no amount of vertex-colour bake on the BENCH fixes light on the FLOOR. So
 * six quads at y = 6 mm, multiply-blended, in their own material. It buys back every prop's weight.
 *
 * ── THE EMBUSEN IS A NO-GO BOX AND IT IS CHECKED, NOT TRUSTED ─────────────────────────────────
 * `STAGE_HALF_M` is 2.34 m about `(0, STAGE_CENTRE_Z_M)`, and the figure works that whole square —
 * the 0.45 m limb envelope per side is already inside it (`stage.ts`, C13). A prop that intersects
 * it is not a composition problem, it is the karateka's arm going through a bench at move 12 of a
 * kata nobody re-watches at that angle. `PROP_KEEP_CLEAR` is that box plus 0.25 m, and
 * `buildDojoProps` scans every vertex it emitted against it and throws. Placement here is authored
 * by hand; the assertion is what makes hand-authored placement safe to edit later.
 *
 * ── TEXT: THIS FILE USES `fillText`, AND `dojoWall.ts` DELIBERATELY DOES NOT ──────────────────
 * `dojoWall.ts` draws its enso as a swept path and says why: `fillText` resolves through whatever
 * font the machine has, so two runs at the same sha differ and §6.3's capture stops being a pure
 * function of `(tick, camera, trackHash, layerWeights)`.
 *
 * That reasoning is correct and it is overridden here, on purpose, for two cells only — the dojo
 * kun and the kanban, and nothing else. The trade is:
 *
 *   * the alternative for the dojo kun is drawing 場, 道, 完, 誠 … as hand-authored paths. A path
 *     that is one stroke wrong is not a stylised character, it is GIBBERISH to anyone who reads
 *     Japanese, and it is gibberish hanging on the kamiza wall of the user's own dojo. Determinism
 *     is worth less than that.
 *   * the exposure is bounded: two atlas cells out of ten, neither touching the karateka, the floor
 *     or any measurement camera's framing. Metric 60's mask hides the whole stage anyway.
 *   * the tofu case is DETECTED rather than hoped about. `hasCjkFont()` rasterises two unrelated
 *     kanji and compares them byte for byte, and the dojo kun falls back to English if they match.
 *     Note that the OBVIOUS probe — comparing `measureText` advance widths against a notdef
 *     sentinel — does not work for CJK and reports tofu on a machine that has a perfectly good
 *     Japanese face: full-width glyphs are exactly 1 em and so is the notdef box, so the widths
 *     agree either way. Only the raster tells the truth.
 *
 * The KANBAN is Latin (`REFAEL LADAEV` / `KARATE`) by the owner's instruction — it was built in
 * katakana first. The font dependency remains, because a system serif is still a font.
 *
 * ── DETERMINISM EVERYWHERE ELSE ───────────────────────────────────────────────────────────────
 * Same rule as the floor and the wall: every variation comes from a seeded `xorshift32` with a
 * frozen literal. `Math.random()` in a texture generator makes two runs at the same sha differ for
 * a reason no diff would explain.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  SRGBColorSpace,
  type Texture,
} from 'three';

import { ROOM_HALF_M, KAMIZA_STANDOFF_M } from './dojoWall';
import { assignMap } from './materials';
import { STAGE_CENTRE_Z_M, STAGE_HALF_M, STAGE_X_SLACK_M, type StageHandle } from './stage';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The no-go box
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Slack added to the stage AABB before anything is allowed to stand near it, metres.
 *
 * The AABB already contains the limb envelope, so this is not a safety margin on the FIGURE — it is
 * one on the eye. A post 5 cm outside the embusen is a post the camera will, at some azimuth,
 * appear to grow out of the karateka's shoulder.
 */
const KEEP_CLEAR_SLACK_M = 0.25;

/** The XZ rectangle no prop vertex may enter. `[minX, maxX, minZ, maxZ]`, world metres. */
export const PROP_KEEP_CLEAR: readonly [number, number, number, number] = Object.freeze([
  -(STAGE_HALF_M + STAGE_X_SLACK_M + KEEP_CLEAR_SLACK_M),
  +(STAGE_HALF_M + STAGE_X_SLACK_M + KEEP_CLEAR_SLACK_M),
  STAGE_CENTRE_Z_M - STAGE_HALF_M - KEEP_CLEAR_SLACK_M,
  STAGE_CENTRE_Z_M + STAGE_HALF_M + KEEP_CLEAR_SLACK_M,
]) as readonly [number, number, number, number];

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The plan, in metres
 *
 * Every number below is a real dimension off a real object. Where a range exists in the sources the
 * mid is taken and the range is noted, because a critic finding about a prop's size has to have
 * somewhere to land.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Inside face of a main wall. Props stand off it by their own half-depth plus a 20 mm reveal. */
const WALL = ROOM_HALF_M;
/** Front face of the shomen panel — the panel is itself stood off the wall (`dojoWall.ts`). */
const SHOMEN_FACE_Z = -ROOM_HALF_M + KAMIZA_STANDOFF_M;

/**
 * Midpoint of the `-X`/`-Z` chamfer, and its inward normal.
 *
 * `dojoWall.ts` cuts 3.4 m off each corner, so this segment runs from `(-4.9, -8.3)` to
 * `(-8.3, -4.9)` — 4.81 m of wall at 45°. It is where the kanban hangs, and the reason is measured
 * rather than aesthetic: see `PROP_PLAN.kanban`.
 */
const CHAMFER_MID_M = (ROOM_HALF_M + (ROOM_HALF_M - 3.4)) / 2; // 6.6 m on each axis
/**
 * Yaw that lays a board flat on that wall, radians. `+PI/4` and NOT `-PI/4`, which is a sign this
 * file got wrong once and which cost a render to find: `pushBox` yaws by three's convention
 * (`x' = x cos + z sin`, `z' = -x sin + z cos`), so `+PI/4` sends the board's local `+Z` to the
 * inward normal `(+1, 0, +1)/sqrt2` and its local `+X` to `(+1, 0, -1)/sqrt2` — which is exactly
 * screen-right for anyone standing in the room looking at this corner, so the lettering reads the
 * right way round. `-PI/4` sends the board's face along the wall instead and renders it as a
 * 12-pixel fin sticking into the room.
 */
const CHAMFER_ROT_Y = Math.PI / 4;

export const PROP_PLAN = Object.freeze({
  /**
   * TACHI-MAKIWARA, indoor based type. Shureido's shipping unit is 1.4 m overall in pasania, and
   * the taper is the whole point of the object: 95 mm of stock at the socket down to ~19 mm at the
   * top, so the post gives under a punch instead of stopping it dead. The taper is in THICKNESS
   * only — the 95 mm width is constant, which is why the post bends along one axis and not the
   * other.
   *
   * The striking pad centres on the practitioner's solar plexus. No source gives that as an
   * absolute, because it is not one; 1.25 m is it for a 1.70 m karateka, and it is also where a
   * 1.4 m commercial unit puts it, which is the corroboration.
   *
   * TWO of them, at the 1.633 m post pitch of the `+Z` wall, so they line up with the building.
   * Placed on the SHIMOZA — training aids belong at the entrance end, never on the shomen — with
   * 0.75 m behind for the post to flex into and 6.8 m of clear floor in front.
   */
  makiwara: {
    xM: [-2.35, -0.6] as readonly number[],
    zM: WALL - 0.75,
    /** Steel foundation plate, 400 x 400 mm. Bolted down; a sprung floor cannot take a buried post. */
    plateM: [0.4, 0.012, 0.4] as readonly [number, number, number],
    /** Socket the post drops into, 100 x 100 x 220 mm. */
    socketM: [0.1, 0.22, 0.1] as readonly [number, number, number],
    /** Post top, world metres. Exposed length is this minus the socket. */
    topYM: 1.4,
    /** Width (constant) and thickness at the socket / at the top. */
    postWM: 0.095,
    postT0M: 0.095,
    postT1M: 0.019,
    /** Leather over foam, 115 x 175 x 15 mm. Modelled 30 mm deep with its lashing proud of it. */
    padM: [0.115, 0.175, 0.03] as readonly [number, number, number],
    padYM: 1.25,
  },

  /**
   * BENCHES on the `-X` wall. Backless, 400-450 mm seat, 1200-1500 mm long, ~400 mm deep — Japanese
   * furniture standard, and the same object in every dojo that has one.
   *
   * Honest note: a strictly traditional dojo has NO seating. Students kneel in seiza at the
   * shimoza and visitors sit on the floor. Benches are a modern accommodation for waiting parents
   * — real, documented in working Japanese dojos, and the single most useful prop in the room for
   * this particular problem, because a 16.6 m hall's biggest failure is that the floor runs to the
   * wainscot with nothing to break the join. Benches at the 1.75 m bay pitch do exactly that.
   *
   * BOTH side walls, unevenly. The convention that side walls stay free of ORNAMENT is real and is
   * why nothing hangs on them — but seating is not ornament, and a hall this size seats visitors on
   * whichever side they came in on. It is also the only honest way to stop a quarter of the orbit
   * from being a bare wall: everything else a dojo owns belongs on the shimoza by rule, so if the
   * joseki side is to have anything at all, this is what it is. Uneven (3 and 2) because a room
   * where the furniture mirrors reads as a set.
   */
  bench: {
    runs: [
      { xM: -WALL + 0.22, zM: [-2.45, -0.7, 1.05] as readonly number[] },
      { xM: WALL - 0.22, zM: [-1.55, 0.2] as readonly number[] },
    ] as readonly { readonly xM: number; readonly zM: readonly number[] }[],
    lenM: 1.45,
    depthM: 0.38,
    seatYM: 0.42,
  },

  /**
   * GETABAKO in the genkan corner of the shimoza. Japanese school shoe-rack standard: 1532 x 350 x
   * 1500 mm outside, 6 columns x 7 rows, each cubby 222 x 330 x 180 mm inside. Those three numbers
   * are consistent with each other to the millimetre once the 18 mm shelves are subtracted, which
   * is how you know they came off a real catalogue and not off a mood board.
   *
   * 350 mm deep is not arbitrary either — it is the depth an adult shoe needs, and it is why every
   * shoe rack in Japan is that deep.
   */
  getabako: {
    xM: 3.9,
    zM: WALL - 0.195,
    sizeM: [1.532, 1.5, 0.35] as readonly [number, number, number],
    cols: 6,
    rows: 7,
  },

  /**
   * NAFUDAKAKE — the rank board, standing on top of the getabako against the shimoza wall. 1083 x
   * 498 mm is a real hinoki maker's 102-tag size; tags are ~50 x 150 mm slats with the name brushed
   * vertically, arranged by grade.
   *
   * On the getabako rather than on the wall because of the shoji problem in the header. It is also
   * simply where a notice board ends up in a real genkan.
   */
  nafuda: {
    sizeM: [1.083, 0.498, 0.045] as readonly [number, number, number],
    rows: 3,
  },

  /**
   * WALL CLOCK on the shimoza, on the centre `hashira` — the `+Z` wall is 9.8 m of two whole tiles,
   * so its posts land at 1.633 m intervals and there is one dead centre at x = 0.
   *
   * The rear wall and not the shomen, and that is a rule rather than a preference: the shomen takes
   * nothing functional. It is also simply the right place — the instructor stands at the kamiza
   * facing the class, so the clock has to be behind them.
   */
  clock: { xM: 0, yM: 2.3, radiusM: 0.16, depthM: 0.055 },

  /**
   * THE KAMIZA BOARDS, applied to the shomen panel's boarded cedar — which `dojoWall.ts` paints
   * from x = ±2.625, y = 0.95..3.58, with a 1.47 m kakejiku carrying the enso on the centreline.
   * That leaves two 1.75 m fields either side of the scroll and everything here fits inside them.
   *
   *   * **dojo kun** — the five precepts, portrait format because five columns of twelve characters
   *     is a portrait shape. Left field.
   *   * **hinomaru** — 2:3, disc diameter 3/5 of the hoist, centred (1999 Act). Right field, on the
   *     same centreline as the kun board. It is also the only saturated colour anywhere in the
   *     hall, which is worth a prop on its own.
   */
  kun: { xM: -1.675, yM: 2.3, sizeM: [0.84, 1.26, 0.045] as readonly [number, number, number] },
  flag: { xM: 1.675, yM: 2.3, sizeM: [0.93, 0.62, 0.028] as readonly [number, number, number] },

  /**
   * THE KANBAN — the dojo's own name board — and it is on the `-X`/`-Z` CHAMFER rather than on the
   * shomen, which is a placement chosen by measurement and not by taste.
   *
   * The shomen is where a kamiza board belongs, and it is where this one started. Projecting its
   * centre through the ORBIT preset's camera on a plain page load puts it at NDC x = 1.30 — off the
   * right edge of the frame entirely, and the part of the shomen that IS on screen (NDC x = 0.97)
   * sits under the HUD panel. On a page load nobody ever sees it. A sign nobody can see is not a
   * sign.
   *
   * The same projection puts the `-X`/`-Z` chamfer at NDC x = -0.09 — dead centre — because the
   * ORBIT preset's `posH` of `[1.6, 0.95, 2.2]` looks diagonally across the hall at exactly that
   * corner. So the board goes there: 2.2 m of it, on the one wall the default view is aimed at, at
   * 1.50 m to its centre so it lands mid-frame instead of clipped to the top edge.
   *
   * That is also defensible as a dojo: a kanban is a CLUB's board, not a reverential one — it hangs
   * where people read it, traditionally at the entrance — and the shomen is left to the kakejiku,
   * the dojo kun and the flag, which is a cleaner kamiza than four competing boards on one panel.
   *
   * 2.60 x 0.80 m is large for a carved board — a Japanese maker's is 900 x 300 mm — and it is
   * large on purpose: every wall in this hall is 10-18 m from the camera at every legal orbit
   * radius, so a 900 mm board would be 40 screen px with unreadable lettering. At 2.6 m the big
   * line's 0.25 m cap height resolves to ~16 px at the default distance, which is about where
   * uppercase Latin stops being a texture and starts being a word. The 3.25:1 proportion is a real
   * kanban's, so the board is long rather than merely big.
   */
  kanban: {
    yM: 1.5,
    sizeM: [2.6, 0.8, 0.06] as readonly [number, number, number],
    /** Standoff from the chamfer face, metres. A hung board, not a painted one. */
    standoffM: 0.05,
  },
});

/**
 * The XZ footprint of every prop group, for the keep-clear assertion and for
 * `tests/render/props.test.ts`. Derived from `PROP_PLAN` so the two can never disagree.
 */
export function propFootprints(): readonly {
  readonly id: string;
  readonly box: readonly [number, number, number, number];
}[] {
  const P = PROP_PLAN;
  const out: { id: string; box: [number, number, number, number] }[] = [];
  for (const [i, x] of P.makiwara.xM.entries()) {
    const h = P.makiwara.plateM[0]! / 2;
    out.push({
      id: `makiwara${i}`,
      box: [x - h, x + h, P.makiwara.zM - h, P.makiwara.zM + h],
    });
  }
  for (const [r, run] of P.bench.runs.entries()) {
    for (const [i, z] of run.zM.entries()) {
      const hx = P.bench.depthM / 2;
      const hz = P.bench.lenM / 2;
      out.push({
        id: `bench${r}.${i}`,
        box: [run.xM - hx, run.xM + hx, z - hz, z + hz],
      });
    }
  }
  const gx = P.getabako.sizeM[0] / 2;
  const gz = P.getabako.sizeM[2] / 2;
  out.push({
    id: 'getabako',
    box: [P.getabako.xM - gx, P.getabako.xM + gx, P.getabako.zM - gz, P.getabako.zM + gz],
  });
  for (const [id, b] of [
    ['kun', P.kun],
    ['flag', P.flag],
  ] as const) {
    const hx = b.sizeM[0] / 2;
    out.push({
      id,
      box: [b.xM - hx, b.xM + hx, SHOMEN_FACE_Z, SHOMEN_FACE_Z + b.sizeM[2]],
    });
  }
  {
    // The chamfer board is at 45°, so its axis-aligned footprint is the rotated half-diagonal.
    const [w, , d] = P.kanban.sizeM;
    const r = (w + d) / 2 / Math.SQRT2;
    const c = -(CHAMFER_MID_M - P.kanban.standoffM / Math.SQRT2);
    out.push({ id: 'kanban', box: [c - r, c + r, c - r, c + r] });
  }
  out.push({
    id: 'clock',
    box: [
      P.clock.xM - P.clock.radiusM,
      P.clock.xM + P.clock.radiusM,
      WALL - P.clock.depthM,
      WALL,
    ],
  });
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Palette — sRGB, and deliberately borrowed from `dojoWall.ts`
 *
 * The props have to look like they were built by whoever built the room. Every timber tone here is
 * either lifted straight from the elevation's palette or sits between two of its entries.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const C = Object.freeze({
  /** `hinoki` — pale cypress. Benches and the shoe rack: the two things that get handled daily. */
  hinoki: 0xa98d64,
  /** `sugi` — cedar. The wall's own rail colour, so the joinery matches the building. */
  sugi: 0x8a6a45,
  /** `keyaki` — dark zelkova, what a carved kanban is made of. Between the wall's post and ranma. */
  keyaki: 0x4a3524,
  keyakiDeep: 0x2a1d13,
  /** Inside a shoe cubby. Near-black by construction: it is a 330 mm hole with one open face. */
  cavity: 0x0f0c09,
  /** Rice-straw rope on the makiwara. */
  straw: 0xb09667,
  /** Cowhide over foam, and the lashing cord. */
  leather: 0x241811,
  /** The makiwara's foundation plate. The only metal in the room. */
  steel: 0x40444a,
  /** Bleached cotton, folded. Reads as gi without being as bright as the one on the karateka. */
  cotton: 0xc9c4b8,
  obi: 0x121212,
  /** Painted artwork rides on white so the atlas cell carries the whole albedo. See the header. */
  artwork: 0xffffff,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Deterministic noise — SEEDED, never random. See the header.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Frozen literal. Changing it changes every prop texel. */
const PROPS_SEED = 0x71c3d05b;

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
      'render/props.ts: the prop atlas is a CanvasTexture and needs a DOM. It is a browser-only ' +
        'path by design; the GL-free channel (tools/score.mjs) never builds a stage.',
    );
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  if (g === null) throw new Error('render/props.ts: 2D canvas context unavailable.');
  return g;
}

/* Note on colour literals below: the canvas paints ARTWORK values (paper, ink, vermilion, the
 * clock's enamel) and those are not the same set as `C`, which is the vertex-colour palette for
 * MATERIALS. The two are deliberately kept apart — see the atlas convention in the header — so the
 * paint functions take CSS strings directly rather than going through `C`. */

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The atlas
 *
 * 1024², ten cells, 16 px of gutter everywhere. Cells are laid out so that neighbours are tonally
 * close and the whole background is near-white, because at the mip levels these props are actually
 * sampled at (a 0.6 m board at 12 m is ~20 screen px, so mip ~4) a 16 px gutter is ONE texel and
 * bleed is a certainty rather than a risk. Near-white bleed lightens an edge; the alternative,
 * black bleed, puts a dark fringe around every board. `bleed()` then replicates each cell's own
 * edge outward so the first ring of that blur is the cell's own colour.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const ATLAS_PX = 1024;

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const cell = (x: number, y: number, w: number, h: number): Cell => Object.freeze({ x, y, w, h });

const A = Object.freeze({
  /** Timber grain. Variation around 1.0; the vertex colour supplies the species. */
  wood: cell(0, 0, 448, 384),
  /** Contact-shadow falloff. White at the rim, so bleed out of it darkens nothing. */
  contact: cell(464, 0, 224, 224),
  clock: cell(704, 0, 192, 192),
  straw: cell(912, 0, 112, 112),
  flag: cell(464, 240, 288, 192),
  /** Flat 1.0. For the steel plate and the cubby backs, where the vertex colour is the whole story. */
  plain: cell(768, 240, 56, 56),
  cotton: cell(768, 312, 56, 56),
  kun: cell(0, 400, 240, 360),
  nafuda: cell(448, 448, 412, 190),
  /** 760 x 234 = 3.25, which is the board's own 2.60 x 0.80 m. Horizontal, because the text is. */
  kanban: cell(0, 776, 760, 234),
});

/** UV of a point given in cell-local `[0,1]`, inset half a texel so a cell never samples its gutter. */
function uvIn(c: Cell, u: number, v: number): readonly [number, number] {
  const pad = 0.5;
  const x = c.x + pad + u * (c.w - 2 * pad);
  // Canvas row 0 is v = 1 (CanvasTexture.flipY defaults true), so v is measured from the bottom.
  const y = c.y + pad + (1 - v) * (c.h - 2 * pad);
  return [x / ATLAS_PX, 1 - y / ATLAS_PX];
}

/** Replicate a cell's edge pixels outward, so the first mip ring is the cell's own colour. */
function bleed(g: CanvasRenderingContext2D, c: Cell, px: number): void {
  const s = g.canvas;
  g.drawImage(s, c.x, c.y, c.w, 1, c.x - px, c.y - px, c.w + 2 * px, px);
  g.drawImage(s, c.x, c.y + c.h - 1, c.w, 1, c.x - px, c.y + c.h, c.w + 2 * px, px);
  g.drawImage(s, c.x, c.y, 1, c.h, c.x - px, c.y, px, c.h);
  g.drawImage(s, c.x + c.w - 1, c.y, 1, c.h, c.x + c.w, c.y, px, c.h);
}

/* ── CJK availability ───────────────────────────────────────────────────────────────────────────
 *
 * Two unrelated kanji, rasterised at the same size and compared byte for byte. A machine with a
 * Japanese face draws two different pictures; a machine without one draws the SAME notdef box
 * twice. This is stronger than measuring an advance width, because a fallback face can report a
 * plausible width for a glyph it renders as a square.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Mincho first: a carved kanban and a brushed precept are serif objects, not UI labels. */
const CJK_STACK =
  '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", "Noto Serif JP", ' +
  '"Yu Gothic", "MS Gothic", "Hiragino Sans", "Noto Sans JP", serif';

function hasCjkFont(): boolean {
  try {
    const g = ctx2d(40, 40);
    const shot = (ch: string): string => {
      g.clearRect(0, 0, 40, 40);
      g.fillStyle = '#000';
      g.font = `32px ${CJK_STACK}`;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillText(ch, 20, 20);
      return g.getImageData(0, 0, 40, 40).data.join(',');
    };
    return shot('空') !== shot('場'); // 空 vs 場
  } catch {
    return false;
  }
}

/* ── Painted cells ──────────────────────────────────────────────────────────────────────────── */

/**
 * Timber grain, WHITE-CENTRED. Mean sits at 0.93 rather than 1.0 for the reason `stage.ts`
 * documents: `rgb()` clamps at 255, so variation authored about 1.0 throws its upper half away and
 * the swatch collapses to a flat value with a few dark streaks in it.
 */
function paintWood(g: CanvasRenderingContext2D, c: Cell, rnd: () => number): void {
  g.save();
  g.beginPath();
  g.rect(c.x, c.y, c.w, c.h);
  g.clip();
  g.fillStyle = 'rgb(237,237,237)';
  g.fillRect(c.x, c.y, c.w, c.h);

  /* Long grain: many fine lines, a few heavy ones. Vertical in the cell; parts map their longest
   * face to whichever axis suits, so the grain runs with the length about half the time, which is
   * what a joiner would do and is invisible when it is not. */
  for (let i = 0; i < 260; i++) {
    const x = c.x + rnd() * c.w;
    const w = 1 + rnd() * (rnd() < 0.12 ? 5 : 2);
    const dark = rnd() < 0.62;
    g.fillStyle = dark ? `rgba(96,74,50,${0.05 + rnd() * 0.13})` : `rgba(255,248,236,${0.05 + rnd() * 0.1})`;
    g.fillRect(x, c.y - 4, w, c.h + 8);
  }
  /* Cathedral figure — the arcs a flat-sawn board shows where the growth rings surface. Without
   * them the swatch is corduroy, which is the same failure the floor generator names. */
  g.lineWidth = 2;
  for (let k = 0; k < 7; k++) {
    const cx = c.x + rnd() * c.w;
    const cy = c.y + rnd() * c.h;
    g.strokeStyle = `rgba(104,80,54,${0.06 + rnd() * 0.1})`;
    for (let r = 6; r < 70; r += 4 + rnd() * 5) {
      g.beginPath();
      g.ellipse(cx, cy, r * 0.32, r, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  /* Two knots. One per board is about right and they are what stops the swatch tiling visibly. */
  for (let k = 0; k < 2; k++) {
    const cx = c.x + 40 + rnd() * (c.w - 80);
    const cy = c.y + 40 + rnd() * (c.h - 80);
    const r = 7 + rnd() * 8;
    g.fillStyle = 'rgba(74,56,36,0.5)';
    g.beginPath();
    g.ellipse(cx, cy, r * 0.72, r, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(88,68,44,0.28)';
    for (let i = 1; i < 5; i++) {
      g.beginPath();
      g.ellipse(cx, cy, r * 0.72 + i * 4, r + i * 5, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.restore();
}

/** Rice-straw rope, wound. Variation around 1.0; `C.straw` supplies the colour. */
function paintStraw(g: CanvasRenderingContext2D, c: Cell, rnd: () => number): void {
  g.save();
  g.beginPath();
  g.rect(c.x, c.y, c.w, c.h);
  g.clip();
  g.fillStyle = 'rgb(232,232,232)';
  g.fillRect(c.x, c.y, c.w, c.h);
  /* Coils across, each one hatched along the lay of the twist. A rope reads by its twist, not by
   * its colour, and the twist is the only thing that survives at 20 screen px. */
  const coil = 13;
  for (let y = 0; y < c.h; y += coil) {
    g.fillStyle = `rgba(70,54,32,${0.2 + rnd() * 0.1})`;
    g.fillRect(c.x, c.y + y, c.w, 2);
    for (let x = -coil; x < c.w; x += 6) {
      g.strokeStyle = `rgba(255,246,226,${0.16 + rnd() * 0.16})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(c.x + x, c.y + y + coil);
      g.lineTo(c.x + x + coil * 0.9, c.y + y + 2);
      g.stroke();
    }
  }
  g.restore();
}

/** Bleached cotton with a fold shadow. Variation around 1.0. */
function paintCotton(g: CanvasRenderingContext2D, c: Cell): void {
  g.fillStyle = 'rgb(240,240,240)';
  g.fillRect(c.x, c.y, c.w, c.h);
  const grad = g.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grad;
  g.fillRect(c.x, c.y, c.w, c.h);
}

/** Flat 1.0. */
function paintPlain(g: CanvasRenderingContext2D, c: Cell): void {
  g.fillStyle = 'rgb(255,255,255)';
  g.fillRect(c.x, c.y, c.w, c.h);
}

/**
 * Contact-shadow falloff, for the multiply pass. White at the rim so the quad's edge is invisible
 * and so bleeding out of this cell into a neighbour does nothing.
 *
 * A squircle rather than a circle: the things standing on it are benches and cabinets, and a round
 * blur under a 1.45 m bench reads as a spotlight.
 */
function paintContact(g: CanvasRenderingContext2D, c: Cell): void {
  const img = g.createImageData(c.w, c.h);
  const d = img.data;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const u = (x / (c.w - 1)) * 2 - 1;
      const v = (y / (c.h - 1)) * 2 - 1;
      // p = 3 rounds the corners of the square without turning it into a disc.
      const r = Math.min(1, Math.pow(Math.abs(u) ** 3 + Math.abs(v) ** 3, 1 / 3));
      const t = 1 - r;
      // 0.46 at the centre: an ambient-occlusion darkening, not a cast shadow. There is no shadow
      // to cast — S_FIT_M leaves everything out here unlit by the shadow map (see the header).
      const k = Math.round(255 * (1 - 0.54 * t * t * (3 - 2 * t)));
      const i = (y * c.w + x) * 4;
      d[i] = k;
      d[i + 1] = k;
      d[i + 2] = k;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, c.x, c.y);
}

/** The hinomaru. 2:3, disc diameter 3/5 of the hoist, centred — the 1999 Act spec. */
function paintFlag(g: CanvasRenderingContext2D, c: Cell): void {
  // Never pure white: the field is cloth in a warm room, and 255 clips before AgX gets a look at it.
  g.fillStyle = '#f2eee6';
  g.fillRect(c.x, c.y, c.w, c.h);
  g.fillStyle = '#bc002d';
  g.beginPath();
  g.arc(c.x + c.w / 2, c.y + c.h / 2, (c.h * 3) / 10, 0, Math.PI * 2);
  g.fill();
  /* Cloth: a slack vertical fold and a little shading at the hoist, so it is a flag hanging flat
   * rather than a rectangle of red on a rectangle of white. */
  const grad = g.createLinearGradient(c.x, c.y, c.x + c.w, c.y);
  grad.addColorStop(0, 'rgba(0,0,0,0.16)');
  grad.addColorStop(0.14, 'rgba(0,0,0,0.0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.09)');
  g.fillStyle = grad;
  g.fillRect(c.x, c.y, c.w, c.h);
}

/** Clock face: off-white, plain rim, twelve ticks, two hands. Fixed time, because everything here
 * is a pure function of the seed and a running clock is not. 19:12 — an evening class. */
function paintClock(g: CanvasRenderingContext2D, c: Cell): void {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const R = c.w / 2;
  g.fillStyle = '#181513';
  g.fillRect(c.x, c.y, c.w, c.h);
  g.fillStyle = '#e8e3d6';
  g.beginPath();
  g.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2b2620';
  g.lineWidth = R * 0.07;
  g.beginPath();
  g.arc(cx, cy, R * 0.87, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const heavy = i % 3 === 0;
    g.strokeStyle = '#1b1815';
    g.lineWidth = heavy ? R * 0.075 : R * 0.035;
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * R * 0.78, cy - Math.cos(a) * R * 0.78);
    g.lineTo(cx + Math.sin(a) * (heavy ? R * 0.62 : R * 0.68), cy - Math.cos(a) * (heavy ? R * 0.62 : R * 0.68));
    g.stroke();
  }
  const hand = (turns: number, len: number, w: number): void => {
    const a = turns * Math.PI * 2;
    g.strokeStyle = '#151210';
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - Math.sin(a) * R * 0.1, cy + Math.cos(a) * R * 0.1);
    g.lineTo(cx + Math.sin(a) * R * len, cy - Math.cos(a) * R * len);
    g.stroke();
  };
  hand((7 + 12 / 60) / 12, 0.44, R * 0.085); // hour
  hand(12 / 60, 0.66, R * 0.055); // minute
  g.fillStyle = '#151210';
  g.beginPath();
  g.arc(cx, cy, R * 0.05, 0, Math.PI * 2);
  g.fill();
}

/**
 * The nafudakake's tag field: a dark ground with three rails of pale hinoki slats, each brushed
 * vertically. Some slots empty, because a rank board is never full — that is the whole point of it.
 */
function paintNafuda(g: CanvasRenderingContext2D, c: Cell, rnd: () => number): void {
  g.save();
  g.beginPath();
  g.rect(c.x, c.y, c.w, c.h);
  g.clip();
  g.fillStyle = '#221a12';
  g.fillRect(c.x, c.y, c.w, c.h);
  const rows = 3;
  const rh = c.h / rows;
  const tagW = c.w / 15;
  for (let r = 0; r < rows; r++) {
    const y0 = c.y + r * rh + rh * 0.1;
    const th = rh * 0.78;
    // The rail the tags hang on.
    g.fillStyle = '#6d5133';
    g.fillRect(c.x, y0 + th, c.w, Math.max(2, rh * 0.06));
    for (let i = 0; i < 15; i++) {
      // Seniors first, so the gaps cluster at the low-grade end of each rail.
      if (rnd() < 0.07 + (i / 15) * 0.3) continue;
      const x0 = c.x + i * tagW + tagW * 0.13;
      const w = tagW * 0.74;
      const t = 0.86 + rnd() * 0.24;
      g.fillStyle = `rgb(${Math.round(214 * t)},${Math.round(196 * t)},${Math.round(160 * t)})`;
      g.fillRect(x0, y0, w, th);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(x0 + w, y0, Math.max(1, w * 0.11), th); // the slat's own shadow
      // Name, brushed vertically. Marks rather than characters: at 412 px across the whole board a
      // tag is 20 px wide and any glyph in it is one blob, so a glyph would be a lie with a cost.
      g.fillStyle = 'rgba(24,18,12,0.82)';
      const marks = 3 + Math.floor(rnd() * 3);
      for (let m = 0; m < marks; m++) {
        const my = y0 + th * (0.12 + (m / marks) * 0.78);
        g.fillRect(x0 + w * 0.2, my, w * 0.6, Math.max(1, th * 0.045));
        if (rnd() < 0.5) g.fillRect(x0 + w * 0.42, my, Math.max(1, w * 0.16), th * 0.12);
      }
    }
  }
  g.restore();
}

/**
 * THE DOJO KUN. Five precepts, each headed by 一、 — "hitotsu", literally "one" — placed on every
 * line precisely so that no precept ranks above another. Written vertically, read right to left.
 *
 * Text verified against the Japan Karate Association's and the Japan Karate Shoto Federation's own
 * publications. No author line: attribution is contested between Funakoshi himself and the JKA
 * staff who condensed it out of his twenty precepts, and a board that takes a side on that would be
 * making a claim this file is not entitled to make.
 */
const DOJO_KUN_JA: readonly string[] = Object.freeze([
  '一、人格完成に努むること',
  '一、誠の道を守ること',
  '一、努力の精神を養うこと',
  '一、礼儀を重んずること',
  '一、血気の勇を戒むること',
]);

const DOJO_KUN_EN: readonly string[] = Object.freeze([
  'Seek perfection of character',
  'Be faithful',
  'Endeavour',
  'Respect others',
  'Refrain from violent behaviour',
]);

function paintKun(g: CanvasRenderingContext2D, c: Cell, cjk: boolean): void {
  g.save();
  g.beginPath();
  g.rect(c.x, c.y, c.w, c.h);
  g.clip();
  /* Paper, matched to the enso scroll's `K.paperHex` so the two read as the same stock. */
  g.fillStyle = '#d7cbb2';
  g.fillRect(c.x, c.y, c.w, c.h);
  const inset = c.w * 0.06;
  g.strokeStyle = 'rgba(30,22,14,0.55)';
  g.lineWidth = Math.max(2, c.w * 0.012);
  g.strokeRect(c.x + inset, c.y + inset, c.w - 2 * inset, c.h - 2 * inset);
  g.fillStyle = '#17110b';

  if (cjk) {
    /* Five columns, RIGHT TO LEFT. Column 0 is the rightmost, which is where a Japanese reader
     * starts; drawing them left to right would put the fifth precept first, which is the kind of
     * error that only shows up when someone who reads the language looks at the render. */
    const n = DOJO_KUN_JA.length;
    const colW = (c.w - 2.4 * inset) / n;
    const size = Math.min(colW * 0.72, (c.h - 2.6 * inset) / 12.4);
    g.font = `${size}px ${CJK_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const cx = c.x + c.w - 1.2 * inset - (i + 0.5) * colW;
      const chars = [...DOJO_KUN_JA[i]!];
      for (const [j, ch] of chars.entries()) {
        // Vertical Japanese sets 、 to the upper right of its em box, not on the baseline centre.
        const punct = ch === '、';
        g.fillText(
          ch,
          cx + (punct ? size * 0.3 : 0),
          c.y + 1.3 * inset + (j + 0.5) * size * 1.06 - (punct ? size * 0.28 : 0),
        );
      }
    }
  } else {
    /* No CJK face on this machine. English rather than romaji: a line of romaji is neither
     * readable to a Japanese reader nor meaningful to anyone else, and this is a fallback that
     * should look like a considered choice rather than like breakage. */
    const size = (c.h - 2.8 * inset) / 11;
    g.font = `${size}px "Times New Roman", Georgia, serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (const [i, line] of DOJO_KUN_EN.entries()) {
      const y = c.y + 2.2 * inset + (i + 0.5) * ((c.h - 4 * inset) / 5);
      g.fillRect(c.x + 1.6 * inset, y - size * 0.06, size * 0.5, Math.max(2, size * 0.1));
      g.fillText(line, c.x + 1.6 * inset + size * 0.8, y);
    }
  }
  g.restore();
}

/**
 * THE KANBAN — the dojo's own name board. `REFAEL LADAEV` over `KARATE`, in Latin.
 *
 * It was built in katakana first — `ラファエル・ラダエフ空手道場`, which is how a Japanese sign sets a
 * foreign name — and changed on the owner's instruction. A roman-letter board is not a climbdown:
 * plenty of dojos outside Japan carry one, and it is the only version of this sign that is legible
 * at the 10-18 m every wall in this hall sits at from every legal orbit radius.
 *
 * TWO LINES, HORIZONTAL, and that follows from the alphabet rather than from taste. Vertical
 * setting is a CJK convention; a column of stacked roman capitals reads as a shopfront, not as a
 * carved board.
 *
 * The two lines are NOT the same size, and that is the real sign hierarchy rather than a flourish:
 * `KARATE` is what has to be legible from across a 16.6 m hall, and the name is what you read once
 * you have walked up to it. Sizing them equally would have made both illegible, because the long
 * line is what sets the scale — 13 tracked capitals in 2.4 m of usable board is a 0.13 m cap
 * height, and forcing `KARATE` to match would have thrown away the 0.25 m it can otherwise have.
 *
 * Finished the way a carved board is finished: strokes incised into dark keyaki and picked out
 * pale, each over its own shadow bed, with a vermilion seal at the right-hand end.
 * `letterSpacing` is deliberately not used — it is not in every browser's 2D context and this file
 * may not add a dependency to find out — so tracking is applied by drawing glyph by glyph.
 */
const KANBAN_LINES: readonly string[] = Object.freeze(['REFAEL LADAEV', 'KARATE']);

const KANBAN_FONT = (px: number): string =>
  `700 ${px}px "Times New Roman", Georgia, "Book Antiqua", serif`;

/** Advance of one tracked line at a given size, including the tracking between glyphs. */
function lineWidth(g: CanvasRenderingContext2D, text: string, size: number, trackFrac: number): number {
  const chars = [...text];
  let w = 0;
  for (const ch of chars) w += g.measureText(ch).width;
  return w + size * trackFrac * (chars.length - 1);
}

/**
 * Draw one line of tracked capitals centred in `[x0, x1]`, carved, SHRUNK TO FIT.
 *
 * The fit loop is not defensive programming, it is required: glyph advances come from whichever
 * serif the machine resolved, and the first version of this board — sized by eye against Times —
 * overflowed its atlas cell and clipped the R off `REFAEL`. Anything that measures a system font
 * has to measure it and then believe the answer.
 */
function carvedLine(
  g: CanvasRenderingContext2D,
  text: string,
  x0: number,
  x1: number,
  y: number,
  target: number,
  trackFrac: number,
): void {
  let size = target;
  const maxW = x1 - x0;
  for (let k = 0; k < 6; k++) {
    g.font = KANBAN_FONT(size);
    const w = lineWidth(g, text, size, trackFrac);
    if (w <= maxW) break;
    size *= (maxW / w) * 0.995;
  }
  g.font = KANBAN_FONT(size);
  const track = size * trackFrac;
  const chars = [...text];
  let x = (x0 + x1) / 2 - lineWidth(g, text, size, trackFrac) / 2;
  for (const ch of chars) {
    const w = g.measureText(ch).width;
    // The bed first, offset down-right: an incised stroke is lit from the top-left, so what the eye
    // reads as depth is the shadow on the far wall of the cut, not the stroke itself.
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(ch, x + w / 2 + size * 0.045, y + size * 0.05);
    g.fillStyle = '#e8dfc6';
    g.fillText(ch, x + w / 2, y);
    x += w + track;
  }
}

function paintKanban(g: CanvasRenderingContext2D, c: Cell, rnd: () => number): void {
  g.save();
  g.beginPath();
  g.rect(c.x, c.y, c.w, c.h);
  g.clip();
  /* Keyaki, planed. Absolute albedo, because this cell is artwork rather than material. */
  g.fillStyle = '#3d2b1b';
  g.fillRect(c.x, c.y, c.w, c.h);
  /* Grain along the length, which is how a board this shape is cut. */
  for (let i = 0; i < 150; i++) {
    g.fillStyle = `rgba(${rnd() < 0.6 ? '22,15,9' : '112,84,54'},${0.05 + rnd() * 0.12})`;
    g.fillRect(c.x - 4, c.y + rnd() * c.h, c.w + 8, 1 + rnd() * 3);
  }
  /* A chamfer around the edge: the light catches the top and left arris, the bottom and right go
   * dark. It is the cheapest possible "this is a solid board and not a sticker". */
  const ch = c.h * 0.06;
  g.fillStyle = 'rgba(255,232,196,0.18)';
  g.fillRect(c.x, c.y, c.w, ch);
  g.fillRect(c.x, c.y, ch, c.h);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(c.x, c.y + c.h - ch, c.w, ch);
  g.fillRect(c.x + c.w - ch, c.y, ch, c.h);

  /* The seal takes the right-hand end, so the text is centred on what is left of the board. */
  const sealS = c.h * 0.5;
  const textL = c.x + c.h * 0.11;
  const textR = c.x + c.w - sealS - c.h * 0.28;

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  /* A bold serif in caps is the closest a system font gets to a chisel-cut inscription, and it
   * holds its stroke weight down to the ~16 px this board is actually read at. */
  carvedLine(g, KANBAN_LINES[0]!, textL, textR, c.y + c.h * 0.29, c.h * 0.26, 0.1);
  carvedLine(g, KANBAN_LINES[1]!, textL, textR, c.y + c.h * 0.7, c.h * 0.44, 0.2);

  /* The seal. A vermilion square with the strokes knocked out of it — a real rakkan is carved in
   * relief, so the ink is the ground and the strokes are the paper. Abstract by design: it is a
   * seal, not a character, and 100 px of atlas is not where a kanji gets to be right. */
  {
    const sx = c.x + c.w - sealS - c.h * 0.14;
    const sy = c.y + (c.h - sealS) / 2;
    g.fillStyle = '#a8231f';
    g.fillRect(sx, sy, sealS, sealS);
    g.fillStyle = 'rgba(61,43,27,0.92)';
    for (let i = 0; i < 4; i++) {
      g.fillRect(sx + sealS * 0.18, sy + sealS * (0.2 + i * 0.18), sealS * 0.64, Math.max(1, sealS * 0.06));
    }
    g.fillRect(sx + sealS * 0.46, sy + sealS * 0.2, Math.max(1, sealS * 0.09), sealS * 0.6);
  }
  g.restore();
}

function makePropsAtlas(): Texture {
  const g = ctx2d(ATLAS_PX, ATLAS_PX);
  const rnd = xorshift32(PROPS_SEED);
  /* The kanban is Latin by instruction, so the dojo kun is the only cell left that needs a
   * Japanese face. Probed once per atlas rather than once per cell. */
  const cjk = hasCjkFont();
  if (!cjk && typeof console !== 'undefined') {
    console.warn(
      'render/props.ts: no CJK face resolved on this machine, so the dojo kun board falls back to ' +
        'English. See the file header — this is a detected fallback, not a bug.',
    );
  }

  // Near-white ground: at the mip levels these cells are sampled at, whatever surrounds them bleeds
  // in. A light bleed lightens an edge; a dark one puts a halo round every board. See the section
  // header above `ATLAS_PX`.
  g.fillStyle = 'rgb(248,248,248)';
  g.fillRect(0, 0, ATLAS_PX, ATLAS_PX);

  paintWood(g, A.wood, rnd);
  paintContact(g, A.contact);
  paintClock(g, A.clock);
  paintStraw(g, A.straw, rnd);
  paintFlag(g, A.flag);
  paintPlain(g, A.plain);
  paintCotton(g, A.cotton);
  paintKanban(g, A.kanban, rnd);
  paintKun(g, A.kun, cjk);
  paintNafuda(g, A.nafuda, rnd);

  for (const c of Object.values(A)) bleed(g, c, 8);

  const t = new CanvasTexture(g.canvas);
  t.colorSpace = SRGBColorSpace;
  // An atlas must never wrap: a UV that runs off a cell has to clamp into its own gutter, not
  // reappear on the far side of the sheet.
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The bake
 *
 * Everything is emitted into flat arrays and closed once, exactly as `makeRoomShellGeometry` does.
 * `BufferGeometryUtils.mergeGeometries` would do the same job at the cost of allocating and then
 * throwing away one `BufferGeometry` per box, and it cannot give a box a different atlas cell per
 * face, which is what the whole one-material scheme rests on.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface Bake {
  readonly pos: number[];
  readonly nrm: number[];
  readonly uv: number[];
  readonly col: number[];
  readonly idx: number[];
}

const newBake = (): Bake => ({ pos: [], nrm: [], uv: [], col: [], idx: [] });

const LIN = new Color();

/**
 * Ambient darkening baked per vertex, and the reason it has to exist.
 *
 * `refitShadow` fits KEY's shadow camera to a 2.625 m box around the karateka, so the shadow map
 * contains the figure and nothing else. Every prop in this file is 5-8 m from the origin: it is
 * lit by four directional lights and the IBL, and it receives and casts NOTHING. The only occlusion
 * it will ever have is the occlusion painted here.
 *
 * Two terms. `y` is contact — the first 0.30 m off the floor goes to 0.5, which is the crevice
 * between an object and the boards it stands on. `cavity` is a caller-supplied multiplier for the
 * inside of things, and it is what makes the getabako read as forty-two holes rather than as a
 * printed grid.
 */
function ao(y: number, cavity = 1): number {
  const t = Math.min(1, Math.max(0, y / 0.3));
  return (0.5 + 0.5 * (t * t * (3 - 2 * t))) * cavity;
}

/** Push `n` copies of one linear vertex colour. `hex` is sRGB; three's colour attribute is linear. */
function pushCol(b: Bake, hexRgb: number, shade: number, n: number): void {
  LIN.setHex(hexRgb, SRGBColorSpace);
  for (let i = 0; i < n; i++) b.col.push(LIN.r * shade, LIN.g * shade, LIN.b * shade);
}

interface BoxOpts {
  /** Atlas cell every face samples. */
  readonly c: Cell;
  /** sRGB tint. */
  readonly hex: number;
  /** Extra multiplier on top of the contact term — cavities, undersides, shaded returns. */
  readonly cavity?: number;
  /** Sub-window of the cell, so two boxes cut from "the same board" are not the same pixels. */
  readonly win?: readonly [number, number, number, number];
  /**
   * Yaw about the box centre, radians. Zero for everything that stands against a main wall — the
   * building is axis-aligned and so is its furniture. The one exception is the kanban, which hangs
   * on a 45° chamfer, and it is the reason this exists at all.
   */
  readonly rotY?: number;
}

/** One box, 24 verts / 12 tris, given by centre, full size and an optional yaw. */
function pushBox(
  b: Bake,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  o: BoxOpts,
): void {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const w = o.win ?? [0, 0, 1, 1];
  const uv = (u: number, v: number): readonly [number, number] =>
    uvIn(o.c, w[0]! + u * w[2]!, w[1]! + v * w[3]!);

  /** `[normal, four corners ccw seen from outside]`. */
  const faces: readonly (readonly [
    readonly [number, number, number],
    readonly (readonly [number, number, number])[],
  ])[] = [
    [
      [0, 0, 1],
      [
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
        [-hx, hy, hz],
      ],
    ],
    [
      [0, 0, -1],
      [
        [hx, -hy, -hz],
        [-hx, -hy, -hz],
        [-hx, hy, -hz],
        [hx, hy, -hz],
      ],
    ],
    [
      [1, 0, 0],
      [
        [hx, -hy, hz],
        [hx, -hy, -hz],
        [hx, hy, -hz],
        [hx, hy, hz],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-hx, -hy, -hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
        [-hx, hy, -hz],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-hx, hy, hz],
        [hx, hy, hz],
        [hx, hy, -hz],
        [-hx, hy, -hz],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
      ],
    ],
  ];

  const yaw = o.rotY ?? 0;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const rot = (x: number, z: number): readonly [number, number] => [cs * x + sn * z, -sn * x + cs * z];

  for (const [n, quad] of faces) {
    const base = b.pos.length / 3;
    // The underside of a shelf or a seat never sees the key. Half a stop off it separates the
    // planes of a stack of shelves without any of them casting anything.
    const face = n[1] < 0 ? 0.62 : n[1] > 0 ? 1.0 : 0.88;
    const [nx, nz] = rot(n[0], n[2]);
    for (const [i, p] of quad.entries()) {
      const [px, pz] = rot(p[0], p[2]);
      b.pos.push(cx + px, cy + p[1], cz + pz);
      b.nrm.push(nx, n[1], nz);
      const [u, v] = uv(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      b.uv.push(u, v);
      LIN.setHex(o.hex, SRGBColorSpace);
      const s = ao(cy + p[1], o.cavity) * face;
      b.col.push(LIN.r * s, LIN.g * s, LIN.b * s);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** One quad from four world-space corners, wound ccw as seen from `n`. */
function pushQuad(
  b: Bake,
  quad: readonly (readonly [number, number, number])[],
  n: readonly [number, number, number],
  c: Cell,
  hexRgb: number,
  shade = 1,
): void {
  const base = b.pos.length / 3;
  for (const [i, p] of quad.entries()) {
    b.pos.push(p[0], p[1], p[2]);
    b.nrm.push(n[0], n[1], n[2]);
    const [u, v] = uvIn(c, i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    b.uv.push(u, v);
  }
  pushCol(b, hexRgb, shade, 4);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * The makiwara post: a rectangular prism that tapers in ONE axis over its length.
 *
 * `segs` rings rather than a single box because the taper is the object. A box lerped only at its
 * ends still has straight silhouette edges — which is fine, they ARE straight — but the vertex
 * colour needs the intermediate rows to carry the contact term smoothly, and 10 rings is 82
 * triangles.
 */
function pushTaperedPost(
  b: Bake,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  wM: number,
  t0: number,
  t1: number,
  segs: number,
): void {
  const rows = segs + 1;
  // Four side strips, each with its own normal, so the arrises stay sharp.
  const sides: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 1, 0], // +Z face: x from -w/2 to +w/2
    [1, 0, 0, 0],
    [0, 0, -1, 0],
    [-1, 0, 0, 0],
  ];
  for (const [si, n] of sides.entries()) {
    const start = b.pos.length / 3;
    for (let j = 0; j < rows; j++) {
      const f = j / segs;
      const y = y0 + f * (y1 - y0);
      const t = (t0 + f * (t1 - t0)) / 2;
      const w = wM / 2;
      const corners: readonly (readonly [number, number])[] =
        si === 0
          ? [
              [-w, t],
              [w, t],
            ]
          : si === 1
            ? [
                [w, t],
                [w, -t],
              ]
            : si === 2
              ? [
                  [w, -t],
                  [-w, -t],
                ]
              : [
                  [-w, -t],
                  [-w, t],
                ];
      for (const [k, cxz] of corners.entries()) {
        b.pos.push(cx + cxz[0]!, y, cz + cxz[1]!);
        b.nrm.push(n[0]!, n[1]!, n[2]!);
        const [u, v] = uvIn(A.wood, 0.05 + k * 0.16, 0.02 + f * 0.9);
        b.uv.push(u, v);
        const s = ao(y) * (n[2] !== 0 ? 0.94 : 0.84);
        LIN.setHex(C.sugi, SRGBColorSpace);
        b.col.push(LIN.r * s, LIN.g * s, LIN.b * s);
      }
    }
    for (let j = 0; j < segs; j++) {
      const p = start + j * 2;
      b.idx.push(p, p + 1, p + 3, p, p + 3, p + 2);
    }
  }
  // Top end grain — always in shadow of the pad and always visible from a high camera.
  const w = wM / 2;
  const t = t1 / 2;
  pushQuad(
    b,
    [
      [cx - w, y1, cz + t],
      [cx + w, y1, cz + t],
      [cx + w, y1, cz - t],
      [cx - w, y1, cz - t],
    ],
    [0, 1, 0],
    A.wood,
    C.keyakiDeep,
    0.9,
  );
}

/** A shallow cylinder facing `-Z`: the clock. Side ring plus a front cap, no back — it is on a wall. */
function pushDisc(
  b: Bake,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  depth: number,
  segs: number,
): void {
  const zF = cz - depth / 2;
  const zB = cz + depth / 2;
  // Rim.
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const p0: readonly [number, number] = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
    const p1: readonly [number, number] = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
    const base = b.pos.length / 3;
    const nx = Math.cos((a0 + a1) / 2);
    const ny = Math.sin((a0 + a1) / 2);
    for (const [x, y, z] of [
      [p0[0], p0[1], zB],
      [p1[0], p1[1], zB],
      [p1[0], p1[1], zF],
      [p0[0], p0[1], zF],
    ] as const) {
      b.pos.push(x, y, z);
      b.nrm.push(nx, ny, 0);
      b.uv.push(...uvIn(A.plain, 0.5, 0.5));
    }
    pushCol(b, C.keyakiDeep, 0.8, 4);
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Face, as a fan, with the clock cell mapped across it.
  const centre = b.pos.length / 3;
  b.pos.push(cx, cy, zF);
  b.nrm.push(0, 0, -1);
  b.uv.push(...uvIn(A.clock, 0.5, 0.5));
  pushCol(b, C.artwork, 1, 1);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    b.pos.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, zF);
    b.nrm.push(0, 0, -1);
    b.uv.push(...uvIn(A.clock, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5));
    pushCol(b, C.artwork, 1, 1);
  }
  for (let i = 0; i < segs; i++) {
    b.idx.push(centre, centre + 1 + i + 1, centre + 1 + i);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The props themselves
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

function bakeMakiwara(b: Bake, x: number): void {
  const M = PROP_PLAN.makiwara;
  const z = M.zM;
  const [pw, ph, pd] = M.plateM;
  pushBox(b, x, ph / 2, z, pw, ph, pd, { c: A.plain, hex: C.steel, cavity: 0.9 });
  const [sw, sh, sd] = M.socketM;
  pushBox(b, x, ph + sh / 2, z, sw, sh, sd, { c: A.plain, hex: C.steel });

  const y0 = ph + sh;
  pushTaperedPost(b, x, z, y0, M.topYM, M.postWM, M.postT0M, M.postT1M, 10);

  /* The pad, on the face the striker meets — which is `-Z`, the room side, because the practitioner
   * stands between the makiwara and the embusen and punches toward the wall. */
  const f = (M.padYM - y0) / (M.topYM - y0);
  const postHalfT = (M.postT0M + f * (M.postT1M - M.postT0M)) / 2;
  const [aw, ah, ad] = M.padM;
  const padZ = z - postHalfT - ad / 2;
  pushBox(b, x, M.padYM, padZ, aw, ah, ad, { c: A.straw, hex: C.straw, cavity: 1 });
  /* Lashing: two cords over the pad, which is how it is held on — holes punched round the edge and
   * laced. Also the only thing at this scale that says "bound" rather than "glued". */
  for (const dy of [-0.045, 0.045]) {
    pushBox(b, x, M.padYM + dy, padZ - ad / 2 - 0.004, aw * 1.16, 0.012, 0.01, {
      c: A.plain,
      hex: C.leather,
    });
  }
}

function bakeBench(b: Bake, x: number, z: number, rnd: () => number): void {
  const B = PROP_PLAN.bench;
  const legT = 0.038;
  const seatT = 0.042;
  const legY = B.seatYM - seatT / 2;

  pushBox(b, x, B.seatYM, z, B.depthM, seatT, B.lenM, {
    c: A.wood,
    hex: C.hinoki,
    win: [0.02 + rnd() * 0.3, 0.05, 0.4, 0.9],
  });
  for (const dz of [-1, 1]) {
    pushBox(b, x, legY / 2, z + dz * (B.lenM / 2 - 0.14), B.depthM - 0.05, legY, legT, {
      c: A.wood,
      hex: C.hinoki,
      win: [0.5, 0.05, 0.4, 0.9],
    });
  }
  // The stretcher. A bench without one looks like two planks and a wish.
  pushBox(b, x, 0.15, z, 0.05, 0.07, B.lenM - 0.34, { c: A.wood, hex: C.sugi });
}

/** Folded gi on the middle bench — set dressing, and the only thing in the hall that says someone
 * else was here today. */
function bakeGiStack(b: Bake, x: number, z: number): void {
  const y0 = PROP_PLAN.bench.seatYM + 0.021;
  for (let i = 0; i < 3; i++) {
    pushBox(b, x, y0 + 0.028 + i * 0.056, z, 0.3, 0.056, 0.26, {
      c: A.cotton,
      hex: C.cotton,
      cavity: 1,
    });
  }
  pushBox(b, x, y0 + 0.196, z, 0.17, 0.05, 0.075, { c: A.plain, hex: C.obi, cavity: 1 });
}

function bakeGetabako(b: Bake, rnd: () => number): void {
  const G = PROP_PLAN.getabako;
  const [W, H, D] = G.sizeM;
  const x = G.xM;
  const z = G.zM;
  const side = 0.025;
  const plinth = 0.09;
  const shelfT = 0.018;
  const divT = 0.018;

  const innerW = W - 2 * side;
  const innerH = H - plinth - 0.03;
  const rowH = innerH / G.rows;
  const colW = (innerW - (G.cols - 1) * divT) / G.cols;
  const y0 = plinth;

  // Carcass.
  for (const dx of [-1, 1]) {
    pushBox(b, x + dx * (W / 2 - side / 2), H / 2, z, side, H, D, { c: A.wood, hex: C.hinoki });
  }
  pushBox(b, x, H - 0.015, z, W, 0.03, D, { c: A.wood, hex: C.hinoki });
  pushBox(b, x, plinth / 2, z, W, plinth, D, { c: A.wood, hex: C.sugi, cavity: 0.8 });
  // Back. One quad, near-black — it is a 350 mm hole with one open face and it must not read as a
  // painted grid on a solid slab.
  const zb = z + D / 2 - 0.004;
  pushQuad(
    b,
    [
      [x + innerW / 2, y0, zb],
      [x - innerW / 2, y0, zb],
      [x - innerW / 2, y0 + innerH, zb],
      [x + innerW / 2, y0 + innerH, zb],
    ],
    [0, 0, -1],
    A.plain,
    C.cavity,
    0.55,
  );

  for (let r = 1; r < G.rows; r++) {
    pushBox(b, x, y0 + r * rowH, z, innerW, shelfT, D - 0.02, {
      c: A.wood,
      hex: C.hinoki,
      cavity: 0.78,
    });
  }
  for (let c = 1; c < G.cols; c++) {
    pushBox(b, x - innerW / 2 + c * (colW + divT) - divT / 2, y0 + innerH / 2, z, divT, innerH, D - 0.02, {
      c: A.wood,
      hex: C.hinoki,
      cavity: 0.72,
    });
  }

  /* Shoes, one box per pair, toes toward the room — which is the etiquette: you turn them round as
   * you take them off so they point at the door. Six pairs in forty-two cubbies, because a rack
   * that is full is a rack nobody is training at. */
  const zs = z - D / 2 + 0.16;
  for (let k = 0; k < 6; k++) {
    const cIdx = Math.floor(rnd() * G.cols);
    const rIdx = Math.floor(rnd() * G.rows);
    const sx = x - innerW / 2 + cIdx * (colW + divT) + colW / 2;
    pushBox(b, sx, y0 + rIdx * rowH + shelfT + 0.036, zs, colW * 0.82, 0.072, 0.24, {
      c: A.plain,
      hex: rnd() < 0.4 ? 0x2b2622 : 0x151312,
      cavity: 0.6,
    });
  }
}

function bakeNafuda(b: Bake): void {
  const N = PROP_PLAN.nafuda;
  const G = PROP_PLAN.getabako;
  const [W, H, D] = N.sizeM;
  const x = G.xM;
  const y0 = G.sizeM[1];
  const zBack = G.zM + G.sizeM[2] / 2 - 0.01;
  const z = zBack - D / 2;
  const rail = 0.05;

  pushBox(b, x, y0 + rail / 2, z, W, rail, D, { c: A.wood, hex: C.keyaki });
  pushBox(b, x, y0 + H - rail / 2, z, W, rail, D, { c: A.wood, hex: C.keyaki });
  for (const dx of [-1, 1]) {
    pushBox(b, x + dx * (W / 2 - rail / 2), y0 + H / 2, z, rail, H - 2 * rail, D, {
      c: A.wood,
      hex: C.keyaki,
    });
  }
  const fw = W - 2 * rail;
  const fh = H - 2 * rail;
  const zf = z - D / 2 + 0.002;
  pushQuad(
    b,
    [
      [x + fw / 2, y0 + rail, zf],
      [x - fw / 2, y0 + rail, zf],
      [x - fw / 2, y0 + rail + fh, zf],
      [x + fw / 2, y0 + rail + fh, zf],
    ],
    [0, 0, -1],
    A.nafuda,
    C.artwork,
    0.94,
  );
  // The rails the tags actually hang off, proud of the field. Three of them, matching the cell.
  for (let r = 1; r <= N.rows; r++) {
    pushBox(b, x, y0 + rail + (fh * r) / N.rows - 0.006, zf - 0.008, fw, 0.012, 0.018, {
      c: A.wood,
      hex: C.sugi,
      cavity: 0.9,
    });
  }
}

/** A framed board applied to the shomen panel, facing `+Z`. Body plus an inset artwork face. */
function bakeShomenBoard(
  b: Bake,
  x: number,
  y: number,
  sizeM: readonly [number, number, number],
  art: Cell,
  frameHex: number,
  inset: number,
): void {
  const [W, H, D] = sizeM;
  const z = SHOMEN_FACE_Z + D / 2;
  pushBox(b, x, y, z, W, H, D, { c: A.wood, hex: frameHex, cavity: 0.95 });
  const fw = W - 2 * inset;
  const fh = H - 2 * inset;
  const zf = z + D / 2 + 0.0015;
  pushQuad(
    b,
    [
      [x - fw / 2, y - fh / 2, zf],
      [x + fw / 2, y - fh / 2, zf],
      [x + fw / 2, y + fh / 2, zf],
      [x - fw / 2, y + fh / 2, zf],
    ],
    [0, 0, 1],
    art,
    C.artwork,
    // The shomen is the deepest wall in the room and `dojoWall.ts` grades its panel down from the
    // top. 0.9 keeps these boards sitting IN that panel rather than on top of it.
    0.9,
  );
}

/**
 * The kanban, hung on the `-X`/`-Z` chamfer at 45°.
 *
 * The board is a yawed box; its artwork face is a quad standing 1.5 mm proud of it, built by
 * rotating the four corners in the same frame. It is the only prop in the file that is not
 * axis-aligned, which is why `pushBox` learned a `rotY` and `pushQuad` takes raw world corners.
 */
function bakeKanban(b: Bake): void {
  const K = PROP_PLAN.kanban;
  const [W, H, D] = K.sizeM;
  // Inward normal of this chamfer is (+1, 0, +1)/sqrt2 — into the room from the far corner.
  const n = Math.SQRT1_2;
  const off = K.standoffM + D / 2;
  const cx = -CHAMFER_MID_M + off * n;
  const cz = -CHAMFER_MID_M + off * n;
  pushBox(b, cx, K.yM, cz, W, H, D, { c: A.wood, hex: C.keyakiDeep, rotY: CHAMFER_ROT_Y, cavity: 0.95 });

  /* The artwork face. `u` runs along the wall toward `+X`/`-Z`, which is the direction a reader
   * standing in the room scans left to right — get this backwards and the board is mirrored. */
  const fw = W / 2;
  const fh = H / 2;
  const fz = D / 2 + 0.0015;
  const c45 = Math.cos(CHAMFER_ROT_Y);
  const s45 = Math.sin(CHAMFER_ROT_Y);
  const p = (lx: number, ly: number): readonly [number, number, number] => [
    cx + c45 * lx + s45 * fz,
    K.yM + ly,
    cz - s45 * lx + c45 * fz,
  ];
  pushQuad(
    b,
    [p(-fw, -fh), p(fw, -fh), p(fw, fh), p(-fw, fh)],
    [n, 0, n],
    A.kanban,
    C.artwork,
    // Brighter than the shomen boards: this one is meant to be read, and the chamfer is the wall
    // `makeRoomShellGeometry`'s corner term darkens hardest.
    1.06,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Build
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface DojoPropsHandle {
  /** Every opaque prop, merged. ONE draw call. */
  readonly solid: Mesh;
  /** The multiply-blended ground darkening. ONE draw call. See the header. */
  readonly contact: Mesh;
}

const OWNED = new WeakMap<DojoPropsHandle, { geo: BufferGeometry[]; tex: Texture[] }>();

/** Throws if any emitted vertex is inside `PROP_KEEP_CLEAR`. See the header. */
function assertClearOfEmbusen(pos: readonly number[], what: string): void {
  const [x0, x1, z0, z1] = PROP_KEEP_CLEAR;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!;
    const z = pos[i + 2]!;
    if (x > x0 && x < x1 && z > z0 && z < z1) {
      throw new Error(
        `render/props.ts: ${what} puts a vertex at (${x.toFixed(2)}, ${z.toFixed(2)}) inside the ` +
          `embusen keep-clear box [${x0.toFixed(2)}, ${x1.toFixed(2)}] x ` +
          `[${z0.toFixed(2)}, ${z1.toFixed(2)}]. The karateka works that whole square; a prop in ` +
          `it is a limb through a bench. Move it in PROP_PLAN.`,
      );
    }
  }
}

/**
 * Builds the dojo's furniture and parents it to the stage.
 *
 * PARENTED TO `stage.backdrop`, not added to the scene, and that is `stage.ts`'s own rule: its
 * `StageHandle` doc says anything the stage gains beyond its three named meshes must hang off one
 * of them, because Phase 4's `renderSilhouette` hides the stage BY REFERENCE before rendering
 * metric 60's mask and `Object3D.visible = false` culls a whole subtree. A props mesh added
 * straight to the scene would be a wall in that mask, silently, and metric 60 ships unarmed so
 * nothing downstream would flag it.
 *
 * `backdrop` and not `floor` because the backdrop carries NO transform at all — it is authored in
 * world metres, exactly as this file is — while the floor is rotated -90° about x and everything
 * here would have to be counter-rotated to compensate.
 *
 * BROWSER-ONLY: it draws a `CanvasTexture`.
 */
export function buildDojoProps(stage: StageHandle): DojoPropsHandle {
  const rnd = xorshift32(PROPS_SEED ^ 0x5f3a);
  const atlas = makePropsAtlas();

  /* ── Opaque ───────────────────────────────────────────────────────────────────────────────── */
  const b = newBake();
  for (const x of PROP_PLAN.makiwara.xM) bakeMakiwara(b, x);
  for (const [r, run] of PROP_PLAN.bench.runs.entries()) {
    for (const [i, z] of run.zM.entries()) {
      bakeBench(b, run.xM, z, rnd);
      // One stack of folded gi, on the middle bench of the longer run only. Two would read as a
      // pattern rather than as something someone put down.
      if (r === 0 && i === 1) bakeGiStack(b, run.xM, z + 0.42);
    }
  }
  bakeGetabako(b, rnd);
  bakeNafuda(b);
  pushDisc(
    b,
    PROP_PLAN.clock.xM,
    PROP_PLAN.clock.yM,
    WALL - PROP_PLAN.clock.depthM / 2,
    PROP_PLAN.clock.radiusM,
    PROP_PLAN.clock.depthM,
    20,
  );
  bakeShomenBoard(b, PROP_PLAN.kun.xM, PROP_PLAN.kun.yM, PROP_PLAN.kun.sizeM, A.kun, C.keyaki, 0.05);
  bakeShomenBoard(
    b,
    PROP_PLAN.flag.xM,
    PROP_PLAN.flag.yM,
    PROP_PLAN.flag.sizeM,
    A.flag,
    C.keyakiDeep,
    0.028,
  );
  bakeKanban(b);
  assertClearOfEmbusen(b.pos, 'the opaque prop bake');

  const solidGeo = new BufferGeometry();
  solidGeo.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
  solidGeo.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
  solidGeo.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
  solidGeo.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3));
  solidGeo.setIndex(b.idx);
  solidGeo.computeBoundingSphere();

  /* Defined here and not in `createMaterials()` on purpose: §3.13 freezes that factory's signature
   * and its ten `MaterialId`s, and a prop material is not one of them. `assignMap` is still the
   * only way the texture gets attached — the colour-space policy is not optional. */
  const solidMat = new MeshStandardMaterial({
    color: 0xffffff, // white: the atlas and the vertex colour carry the whole albedo
    roughness: 0.74,
    metalness: 0.0,
    vertexColors: true,
    envMapIntensity: 0.95,
  });
  solidMat.name = 'M_PROPS';
  assignMap(solidMat, 'map', atlas);

  const solid = new Mesh(solidGeo, solidMat);
  solid.name = 'stage.props';
  // Neither casts nor receives: `S_FIT_M` puts the shadow camera around the karateka and nothing
  // else, so a `castShadow` here would cost a shadow-map draw call for geometry that is outside the
  // frustum every frame. The occlusion these props need is baked (see `ao`) and multiplied (below).
  solid.castShadow = false;
  solid.receiveShadow = false;
  solid.matrixAutoUpdate = false;
  solid.updateMatrix();

  /* ── Contact ──────────────────────────────────────────────────────────────────────────────── */
  const cb = newBake();
  const pad = 0.16;
  const groundY = 0.006;
  const quad = (cx: number, cz: number, hx: number, hz: number): void => {
    pushQuad(
      cb,
      [
        [cx - hx, groundY, cz + hz],
        [cx + hx, groundY, cz + hz],
        [cx + hx, groundY, cz - hz],
        [cx - hx, groundY, cz - hz],
      ],
      [0, 1, 0],
      A.contact,
      0xffffff,
      1,
    );
  };
  for (const x of PROP_PLAN.makiwara.xM) {
    quad(x, PROP_PLAN.makiwara.zM, PROP_PLAN.makiwara.plateM[0] / 2 + pad, PROP_PLAN.makiwara.plateM[2] / 2 + pad);
  }
  for (const run of PROP_PLAN.bench.runs) {
    for (const z of run.zM) {
      quad(run.xM, z, PROP_PLAN.bench.depthM / 2 + pad, PROP_PLAN.bench.lenM / 2 + pad * 0.7);
    }
  }
  quad(
    PROP_PLAN.getabako.xM,
    PROP_PLAN.getabako.zM,
    PROP_PLAN.getabako.sizeM[0] / 2 + pad,
    PROP_PLAN.getabako.sizeM[2] / 2 + pad,
  );
  assertClearOfEmbusen(cb.pos, 'the contact-shadow bake');

  const contactGeo = new BufferGeometry();
  contactGeo.setAttribute('position', new BufferAttribute(new Float32Array(cb.pos), 3));
  contactGeo.setAttribute('normal', new BufferAttribute(new Float32Array(cb.nrm), 3));
  contactGeo.setAttribute('uv', new BufferAttribute(new Float32Array(cb.uv), 2));
  contactGeo.setIndex(cb.idx);
  contactGeo.computeBoundingSphere();

  /* `MultiplyBlending` rather than a black quad at low alpha: a multiply DARKENS whatever the floor
   * already is, so it survives the floor's own plank-to-plank tone variation and its radial grade
   * instead of averaging them away. It also needs no colour match — white is a no-op.
   *
   * The composer renders to a linear target, and three disables the material tone-map include for
   * anything not drawn straight to the canvas (`WebGLPrograms`: toneMapping is NoToneMapping when
   * a render target is bound), so this multiply happens in linear light. That is the only place it
   * is physically meaningful. */
  const contactMat = new MeshBasicMaterial({
    map: atlas,
    blending: MultiplyBlending,
    // NOT optional and NOT cosmetic. `WebGLState.setBlending` only programs the multiply blend func
    // when this is set; without it three logs an error and LEAVES THE PREVIOUS BLEND FUNC IN PLACE,
    // so the quad draws as an ordinary alpha-blended dark shape — a black smear across the floor,
    // which is exactly what it did before this line existed.
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
  });
  contactMat.name = 'M_PROPS_CONTACT';
  assignMap(contactMat, 'map', atlas);

  const contact = new Mesh(contactGeo, contactMat);
  contact.name = 'stage.props.contact';
  contact.renderOrder = 1; // after the floor, with depthWrite false — the embusen decal's rule
  contact.castShadow = false;
  contact.receiveShadow = false;
  contact.matrixAutoUpdate = false;
  contact.updateMatrix();

  stage.backdrop.add(solid);
  stage.backdrop.add(contact);

  const handle: DojoPropsHandle = { solid, contact };
  OWNED.set(handle, { geo: [solidGeo, contactGeo], tex: [atlas] });
  return handle;
}

/** Frees everything `buildDojoProps` allocated, including its two locally-defined materials. */
export function disposeDojoProps(handle: DojoPropsHandle): void {
  for (const mesh of [handle.solid, handle.contact]) {
    mesh.removeFromParent();
    // Unlike `disposeStage`, these materials are NOT shared with `createMaterials()` — this file
    // owns them, so this file frees them.
    (mesh.material as { dispose(): void }).dispose();
  }
  const owned = OWNED.get(handle);
  if (owned !== undefined) {
    for (const g of owned.geo) g.dispose();
    for (const t of owned.tex) t.dispose();
    OWNED.delete(handle);
  }
}
