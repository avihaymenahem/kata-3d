/**
 * B6 PLAYER — `src/player/scalpHair.ts` — what is LEFT of an old man's hair.
 *
 * ═══ WHY A SIBLING AND NOT MORE OF `./facialHair.ts` ═════════════════════════════════════════
 *
 * That file is 640 lines about ONE object, and most of them are the argument for where a mustache
 * goes on a head with no face. This is a second object with its own outline, its own colour and its
 * own calibration, and dropping it in beside the mustache would produce a thousand-line file whose
 * name — "facial hair" — is wrong about half its contents. Scalp hair is not facial hair.
 *
 * What is NOT duplicated is the part that was expensive to get right. `./facialHair.ts` owns the
 * skull probe and this file imports it: `measureHead`, `ellipsoidRadius` and `surfaceAt` come from
 * there, along with the matte material. Re-deriving any of that here would be re-buying two
 * documented placement bugs — a slab support probe that put the mustache 0.0011 m proud, and an
 * enclosing ellipsoid that put it 0.0281 m proud — at a different spot on the same head.
 *
 * ═══ WHAT THIS FILE HAD TO ADD, AND WHY THE MUSTACHE'S FIT COULD NOT BE REUSED AS-IS ═════════
 *
 * `Head.fit` is a SINGLE NUMBER, measured over the vertices around the lip and inside the front
 * hemisphere only. That is correct for a 0.056 m block on the face and useless here, because this
 * band wraps 3.98 rad from one temple, across the nape and back to the other, through exactly the
 * two regions `faceFit`'s own header names as the ellipsoid's worst — the crown and the nape. The
 * measured spread of the head's radial scale over the band's footprint is 0.90 to 1.19; a constant
 * anywhere in that range buries one end of the horseshoe or floats the other.
 *
 * So the fit becomes a FIELD rather than a constant: `skullFitField` regresses the surface `faceFit`
 * calibrates against — the head's own radius about its vertical axis — on height and azimuth,
 * locally, and evaluates it once per grid sample. Same evidence, too: the very head vertices
 * `measureHead` already gathered, now kept on `Head.pts` instead of thrown away. See
 * `skullFitField` for why the regression is LINEAR, and why it works in the radius rather than in
 * the ratio `faceFit` uses.
 *
 * ═══ WHAT IS MODELLED: THE HAIR, AND NOTHING ELSE ════════════════════════════════════════════
 *
 * There is no cap. The bald pate is the character's own head, lit and shaded as skin, with no
 * geometry over it — which is the only way it reads as bald rather than as shaved, because a shell
 * tinted to match skin is a different material catching the key at a different angle and the seam
 * where it ends is visible from every camera this scene has. The band below is a closed shell
 * covering the scalp it actually occupies and stopping: nothing above 0.71 of head height anywhere,
 * and nothing at all within 1.15 rad of the face's forward axis.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  SRGBColorSpace,
  Vector3,
  type MeshStandardMaterial,
} from 'three';

import type { Character } from './character';
import {
  ellipsoidRadius,
  makeMatteHairMaterial,
  measureHead,
  surfaceAt,
  type Head,
} from './facialHair';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. THE HORSESHOE
 *
 * Every height below is a fraction of the MEASURED head, chin to crown, for the reason
 * `./facialHair.ts` §1 gives: this head is 0.278 m on a 1.829 m figure, one sixth of stature where
 * the life-drawing canon says one seventh and a half, so anything derived from height lands 0.015 m
 * wrong. The canon's own landmarks, on a head measured to the crown with the face at three quarters
 * of it, are the base of the nose at 0.25, the brow and the top of the ear at 0.50, and a juvenile
 * hairline at 0.75.
 *
 * All of them then get the same +0.035 correction `MUSTACHE_Y` carries and for the same measured
 * reason: this head is an egg with no jaw, its lowest vertex is the smooth underside of the skull
 * rather than a chin, so "chin to crown" over-reports the face by about 0.010 m and every canonical
 * fraction lands that much low. Ear top therefore sits at 0.535 and the nape hairline at 0.27.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Azimuth of the horseshoe's forward tips, in radians from the face's forward axis.
 *
 * ═══ THIS ONE NUMBER IS THE DIFFERENCE BETWEEN BALD AND TONSURED ═════════════════════════════
 *
 * In advanced male-pattern loss the frontal and temporal scalp is bare and what survives starts
 * just forward of the ear. The ear is at 1.57 rad; 1.15 rad puts the tips about 0.036 m in front of
 * it, which from a front camera shows a sliver of hair at each temple in silhouette and bare skin
 * across the whole forehead between them.
 *
 * Pulling the tips back to the ear instead would leave the sides of the head bare down to the jaw
 * and the band would read as a monk's tonsure seen from the front — a ring with a gap, not a
 * receded hairline. Pushing them forward past about 0.9 rad closes the horseshoe into a fringe and
 * the man stops being bald.
 */
export const TEMPLE_PHI = 1.15;

/** Arc the band sweeps: everything except the bare frontal wedge between the two tips. 3.983 rad. */
const SWEEP = 2 * Math.PI - 2 * TEMPLE_PHI;

/**
 * The band's TOP edge, keyed by arc position — 0 at either temple tip, 1 at the back of the skull.
 *
 * ═══ THE TOP EDGE IS THE WHOLE READ ══════════════════════════════════════════════════════════
 *
 * It is the boundary between hair and skin, it is what the eye finds first, and its SHAPE is what
 * separates the two things this could be mistaken for. A horseshoe whose top edge is level all the
 * way round is a costume wig. One that rises toward the back is a bald crown: the vertex goes
 * first and the occipital hair is the last to go, so the surviving band is lowest where it has been
 * eaten into from the front (0.515, just under the top of the ear at 0.535) and highest at the
 * occiput (0.685, roughly where this skull starts to turn over).
 *
 * 0.685 and not higher: the remaining 0.315 of head above it is the bald crown, and shrinking that
 * to a strip stops reading as loss and starts reading as a bad haircut.
 */
export const HORSESHOE_TOP: readonly (readonly [number, number])[] = Object.freeze([
  [0.0, 0.5],
  [0.3, 0.565],
  [0.62, 0.655],
  [1.0, 0.7],
]);

/**
 * The band's BOTTOM edge, same key.
 *
 * ═══ THE NAPE IS AT 0.445 HERE, AND THE CANON SAYS 0.272 ═════════════════════════════════════
 *
 * The canon puts the nape hairline level with the ear lobe: 0.25, or 0.285 with §1's correction.
 * That was the first version's number and it was measurably wrong on this mesh, by 0.046 m. The
 * back of this head, profiled as radius from the head axis against height, goes
 *
 *      y 0.69 -> 0.115 m      the occiput, the widest the skull gets
 *      y 0.51 -> 0.103 m
 *      y 0.375 -> 0.089 m     a WAIST
 *      y 0.27 -> 0.101 m
 *      y 0.155 -> 0.113 m     wider than the skull
 *
 * — which is not a head narrowing toward a chin, it is a skull, a neck pinched at 0.375, and the
 * upper back flaring out below it. `measureHead` gathers vertices by dominant bone and the head
 * bone owns all of it, so "0 of head height" means the chin at the front and the shoulder blades at
 * the back, and no fraction of head height means the same thing at both ends.
 *
 * The pinch IS the nape. A band whose bottom edge ran to 0.272 crossed the waist and stood 0.0065 m
 * off it — measured by raycast against the bind-pose mesh, not guessed — because no smooth fit
 * follows a surface that reverses direction inside one kernel width. 0.375 puts the edge AT the
 * pinch and no lower, which is both the last height the fit can be trusted at and where a hairline
 * actually goes.
 *
 * ═══ AND WHY IT DROPS TO 0.290 BEHIND THE EAR ════════════════════════════════════════════════
 *
 * A first pass held the whole edge near the nape's 0.44 and the band rendered as a beret: a small
 * grey patch on the upper rear quadrant with a bare expanse of skull below it, which is not what
 * losing your hair looks like from any angle. The mass of a horseshoe is AT AND BEHIND THE EAR and
 * it hangs BELOW the ear's top, so the edge has to come down there — to 0.290, which on this mesh
 * is 0.081 m above the chin and still on the smoothly widening side of the skull rather than on the
 * jaw. The side profile runs 0.205 -> 0.064 m, 0.305 -> 0.081 m, 0.400 -> 0.081 m, so 0.290 is the
 * last height at which the surface is still a skull and not a jaw narrowing away underneath it.
 *
 * Ahead of the ear the edge climbs only to 0.345 at the tips. It was 0.400, which ended the band in
 * two short ovals sitting exactly where ears would be on a head that has none — and a small grey
 * oval at ear height on an earless egg reads as an EAR, which is a worse failure than reading as a
 * wig. Carrying the tips down to 0.345 turns each one into something with more height than width,
 * which reads as what is left of a sideburn. The surface at that azimuth runs 0.250 -> 0.081 m and
 * 0.345 -> 0.084 m, smooth the whole way, so nothing is being asked of the fit.
 *
 * It is a real edge and not a fade, and that is the honest limitation of doing this in geometry:
 * hair ends in a gradient of individual strands and a shell ends in a rim. The rim is put where the
 * silhouette hides it — in the shadow under the occiput, and at the temple where it is 0.0020 m
 * thick and edge-on to any camera in front.
 */
export const HORSESHOE_BOTTOM: readonly (readonly [number, number])[] = Object.freeze([
  [0.0, 0.355],
  [0.3, 0.325],
  [0.62, 0.355],
  [1.0, 0.395],
]);

/**
 * Irregularity of the two edges, as fractions of head height: 0.052 + 0.020 on the top edge, 0.022
 * on the bottom.
 *
 * ═══ THE NOMINAL AMPLITUDE IS NOT THE AMPLITUDE ══════════════════════════════════════════════
 *
 * These read about three times larger than what the edge does, and both reasons are worth naming
 * because the first pass set them by arithmetic and the edge came out visibly clean. `hairNoise` is
 * a sum of two smooth octaves, so it crowds the middle of [-1, 1] and reaches the ends only where
 * both octaves peak together — that is roughly a factor of two. And most of what is left is the
 * BROAD component, which moves the edge as a whole rather than making it ragged. Measured against a
 * nine-column moving average of its own top edge, the built band wanders 0.005 m locally, which on
 * a 0.278 m head is what an uneven hairline looks like and not what a saw looks like.
 *
 * ═══ A PERFECT RING READS AS A COSTUME ═══════════════════════════════════════════════════════
 *
 * A real receded hairline is uneven at two scales at once — a fine wobble where individual clumps
 * end, and a slow asymmetry because the two sides of a head do not recede together — so the top
 * edge carries TWO noises: nine cycles across the sweep (one wobble per 0.040 m of arc, about the
 * size of a clump) and 2.3 cycles (one broad lobe per side, which is what makes the left and right
 * temples disagree). One frequency alone gives either a scalloped edge with a visible period or a
 * lopsided but otherwise clean ring; neither looks accidental, and looking accidental is the point.
 *
 * The noise is a function of arc position and NOT of |arc position|, so the two halves are
 * genuinely different rather than mirrored. A mirrored hairline is as obviously manufactured as a
 * level one.
 */
const TOP_NOISE_FINE = 0.052;
const TOP_NOISE_BROAD = 0.02;
const BOTTOM_NOISE = 0.022;
const NOISE_CYCLES_FINE = 9;
const NOISE_CYCLES_BROAD = 2.3;

/** Band height below which the shell degenerates. 0.035 of head height is 0.0097 m. */
const MIN_BAND = 0.035;

/**
 * The shell's two offsets from the fitted skull surface, as fractions of head height: 0.023 buried
 * (0.0064 m) and 0.020 standing proud (0.0056 m before the taper and the wobble).
 *
 * ═══ TWO NUMBERS AND NOT A THICKNESS TIMES A SINK ════════════════════════════════════════════
 *
 * `MUSTACHE_SINK` is a FRACTION of the block's depth, which is right for a block of constant
 * section. It is wrong here and it was measured wrong: this band tapers at the temples, and a sink
 * expressed as a fraction of the tapered thickness took the bedding depth down with it — at the
 * tips the shell was 0.0025 m thick, so it bedded in by 0.0011 m, and against a fit that misses the
 * mesh by up to 0.0048 m the tip floated by 0.0037 m. The taper is supposed to thin what SHOWS, not
 * loosen what holds it on.
 *
 * So the two are independent. `HAIR_SINK` is an absolute depth and never varies: it is the budget
 * for the fitted surface standing outside the mesh, and it has to cover the worst such miss, which
 * this head's coarse vertex rings make 0.0056 m (see `skullFitField`). `HAIR_SHOW` is what is left
 * above the skull, and it is the one the taper and the thickness wobble act on. Its budget is the
 * opposite miss — the mesh standing outside the FIT, worst 0.0051 m — because that is what erupts
 * through the band.
 *
 * Both were then CHECKED and not merely reasoned about, which is how they arrived at these values
 * rather than at the 0.021/0.016 that looked sufficient. A ray fired along each of the 657 grid
 * normals against the bind-pose mannequin puts the skull inside the shell at every one of them,
 * with 0.0008 m of the buried side and 0.0007 m of the proud side left over at the two worst
 * samples. At 0.021/0.016 the bottom rim at the back was breached by 0.0005 m.
 *
 * 0.0056 m of visible hair is right for the subject as well as for the tolerances: this is not a
 * hairstyle with volume, it is what a man in his sixties has clipped short at the sides.
 */
const HAIR_SINK = 0.023;
const HAIR_SHOW = 0.02;

/**
 * Grid resolution. 73 columns over 0.34 m of arc is 0.0047 m a facet; 7 rows span up to 0.074 m.
 *
 * 73 and not 57, which was enough for the surface: the top edge's fine noise runs at 9 cycles
 * across the sweep and `hairNoise`'s second octave at 2.37 times that, so the edge carries detail
 * at 21 cycles. 57 columns sample that 2.7 times a cycle — under the Nyquist limit, where the
 * irregularity that is supposed to look accidental instead aliases into a slow beat that looks
 * deliberate. 73 columns put it at 3.4, and cost 224 vertices.
 *
 * 9 rows and not 7 for the same kind of reason in the other axis: the band is 0.090 m tall at the
 * occiput and the skull's radius changes by 0.026 m over that span, so 7 rows put 0.015 m between
 * samples on the steepest part of the fit and the shell chords across the curve it is supposed to
 * be lying on.
 */
const COLS = 73;
const ROWS = 9;

/**
 * Kernel bandwidths for `skullFitField`: 0.40 rad of azimuth, 0.050 of head height (0.014 m).
 *
 * ═══ THEY ARE DELIBERATELY NOT EQUAL ═════════════════════════════════════════════════════════
 *
 * A round kernel would be the default and it spends its resolution in the wrong place. Profiled
 * against the real vertices this skull's radius changes by 0.026 m over the 0.09 m of HEIGHT
 * between the occiput and the nape, and by under 0.008 m over a whole radian of AZIMUTH across the
 * same band. So height is where the detail is and azimuth is where the samples are, and the kernel
 * is stretched accordingly: tight in y to follow the nape's curvature, wide in phi to keep enough
 * vertices under it that the regression is not fitting noise.
 *
 * 0.014 m in y is about two thirds of this head's 0.022 m vertex spacing, which is as tight as it
 * can go before neighbourhoods start coming up empty and `skullFitField`'s fallbacks carry the fit.
 */
const FIT_SIGMA_PHI = 0.4;
const FIT_SIGMA_Y = 0.05;

/** Clearance the band's bottom edge keeps above the lowest head-owned vertex. 0.030 of H, 0.0083 m. */
const FLOOR_MARGIN = 0.03;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 2. NOISE AND THE OUTLINE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Fractional part of a sine hash — the standard shader value hash, and it needs no dependency. */
function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Two octaves of 1-D value noise on [-1, 1], smooth in its argument.
 *
 * Smooth and not white: an edge built from independent per-column samples is a saw, not a hairline.
 * The cubic `3f² − 2f³` blend gives a C¹ curve through the lattice, so the top edge has no corners
 * at column boundaries and `computeVertexNormals` has nothing to shade as a crease.
 *
 * Exported for the same reason `MUSTACHE_SECTION` is: the outline is the one part of this file
 * whose failure is silent — a noise that is constant, or that leaves the range, does not throw, it
 * just produces a clean ring or a hairline through the eyebrows.
 */
export function hairNoise(x: number): number {
  const octave = (t: number): number => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash01(i) * (1 - u) + hash01(i + 1) * u;
  };
  return (octave(x) * 0.65 + octave(x * 2.37 + 11.7) * 0.35) * 2 - 1;
}

/** Smoothstep-interpolated lookup down a `[key, value]` table. Keys ascend; ends are clamped. */
function curveAt(table: readonly (readonly [number, number])[], t: number): number {
  const firstRow = table[0];
  const lastRow = table[table.length - 1];
  if (firstRow === undefined || lastRow === undefined) return 0;
  if (t <= firstRow[0]) return firstRow[1];
  if (t >= lastRow[0]) return lastRow[1];
  for (let i = 0; i + 1 < table.length; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (a === undefined || b === undefined) break;
    if (t <= b[0]) {
      const f = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f * f * (3 - 2 * f);
    }
  }
  return lastRow[1];
}

/** `0` at either tip, `1` at the back of the skull — the key both outline tables are written in. */
const smooth01 = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

/**
 * The band's top and bottom edges at sweep position `psi` — 0 at the wearer's LEFT temple, 0.5 at
 * the back of the skull, 1 at the right temple — as fractions of head height above the lowest
 * head vertex.
 *
 * ═══ ARC POSITION IS A FOLD, NOT A SECOND TABLE ══════════════════════════════════════════════
 *
 * With the tips at ±`TEMPLE_PHI` the azimuth is `TEMPLE_PHI + psi·SWEEP`, and its distance from the
 * back of the head collapses exactly: `arcT = 1 − |2·psi − 1|`. So one table covers both sides and
 * the horseshoe is symmetric BY CONSTRUCTION, with the noise — which reads `psi` and not `arcT` —
 * as the only thing that distinguishes left from right. That is the right split: the anatomy is
 * symmetric and the wear is not.
 *
 * The noise is faded out over the last 12 % of the sweep at each end so the two tips close cleanly.
 * A 0.0089 m wobble on a band that is only 0.018 m tall there can otherwise invert the edges, and
 * `MIN_BAND` would then have to open the shell back up at whatever height the noise left it.
 */
export function horseshoeEdges(psi: number): { top: number; bottom: number } {
  const arcT = 1 - Math.abs(2 * psi - 1);
  const fade = smooth01(Math.min(psi, 1 - psi) / 0.12);

  const top =
    curveAt(HORSESHOE_TOP, arcT) +
    fade *
      (TOP_NOISE_FINE * hairNoise(psi * NOISE_CYCLES_FINE + 3.1) +
        TOP_NOISE_BROAD * hairNoise(psi * NOISE_CYCLES_BROAD + 17.9));
  const bottom =
    curveAt(HORSESHOE_BOTTOM, arcT) + fade * BOTTOM_NOISE * hairNoise(psi * 6.4 + 41.3);

  /* The shell must stay open. Noise can push the edges together at the tips, where the base band is
   * only 0.065 of head height; opening the gap DOWNWARD rather than upward keeps the top edge —
   * the one being looked at — exactly where the outline put it. */
  return { top, bottom: Math.min(bottom, top - MIN_BAND) };
}

/**
 * Multiplier on `HAIR_SHOW` — never on `HAIR_SINK` — along the sweep: full through the body of the
 * horseshoe, 0.45 at the tips over the outermost 9 %.
 *
 * Hair of constant thickness ends in a blunt face, and at the temple that face points straight at a
 * front camera — a cut edge, which is exactly the "costume" read the irregular top edge exists to
 * avoid. Thinning what shows to 0.0020 m turns the end into a wisp.
 *
 * Not taken to zero, for two separate reasons. A degenerate ring makes every triangle in the end
 * cap zero-area and `computeVertexNormals` hands back NaN for the whole end — that is
 * `./facialHair.ts`'s reason for its 0.1-scale cap rings. And 0.45 rather than something smaller is
 * a tolerance: what stands proud is also the margin against the mesh erupting through the band, and
 * the temples are where the fit's positive error is largest.
 */
function tipTaper(psi: number): number {
  return 0.45 + 0.55 * smooth01(Math.min(psi, 1 - psi) / 0.09);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE SKULL, RE-CALIBRATED PER DIRECTION
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface SkullSample {
  /** Cloud-space height. */
  readonly y: number;
  /** Azimuth about the head's vertical axis from `fwd`, positive toward the wearer's left. */
  readonly phi: number;
  /** Distance from that axis, in the horizontal plane — the radius the band has to reach. */
  readonly rho: number;
}

/** Signed angular difference wrapped into (−π, π]. */
function angDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Re-express `Head.pts` in the cylindrical terms the fit is measured in.
 *
 * Vertices within 0.10 of the ellipsoid's half-height of either pole are dropped: the crown and the
 * underside of the jaw are where a radius about the vertical axis stops meaning anything, and the
 * band's footprint tops out at 0.685 of head height, so nothing it needs is thrown away.
 */
function sampleSkull(head: Head): SkullSample[] {
  const cl = head.centre.dot(head.left);
  const cf = head.centre.dot(head.fwd);
  const out: SkullSample[] = [];
  for (const v of head.pts) {
    if (Math.abs(v.y - head.centre.y) > 0.9 * head.rb) continue;
    const a = v.dot(head.left) - cl;
    const c = v.dot(head.fwd) - cf;
    const rho = Math.hypot(a, c);
    if (rho < 1e-5) continue;
    out.push({ y: v.y, phi: Math.atan2(a, c), rho });
  }
  return out;
}

/**
 * The radius correction as a FIELD over (height, azimuth), replacing `Head.fit`'s single number.
 *
 * ═══ WHY LOCALLY LINEAR AND NOT A WEIGHTED AVERAGE ═══════════════════════════════════════════
 *
 * A weighted average of the neighbouring vertices is the obvious answer and it is wrong at exactly
 * the place this band is most exposed. Kernel averaging is unbiased only where the sample surrounds
 * the query; at a BOUNDARY it is one-sided and returns the mean of whatever lies to one side. The
 * band's bottom edge at the nape sits within one bandwidth of the last head-owned vertex, so an
 * average there sees only vertices ABOVE it, on a skull that is still widening as it climbs, and
 * reports a radius too large. The band lifts off the neck.
 *
 * Fitting `ρ ≈ c₀ + c₁·Δy + c₂·Δφ` by weighted least squares and reading off `c₀` removes that
 * bias: a one-sided neighbourhood with a consistent slope is EXTRAPOLATED along the slope instead
 * of averaged across it. This is ordinary LOESS, degree one, and the degree is the entire reason it
 * is here.
 *
 * ═══ AND WHY IT REGRESSES THE RADIUS AND NOT THE RATIO ═══════════════════════════════════════
 *
 * `faceFit` works in the RATIO of the real radius to the ellipsoid's, which is the natural quantity
 * — it normalises the ellipsoid's shape out and leaves the regression only the residual to model.
 * Doing that here cost 0.0065 m of float at the back of the skull, and the reason is worth writing
 * down because it is a property of the MESH and not of the mathematics.
 *
 * This head's vertex rings at the occiput are 0.05 m apart in height: there is a ring at 0.508 of
 * head height with a radius of 0.1029 m and the next at 0.689 with 0.1152 m, and NOTHING between
 * them. Between two rings the surface the band has to sit on is not a curve, it is the flat
 * triangle chord joining them. A regression in ratio space reconstructs the ellipsoid's curvature
 * across that gap and hands back the smooth arc — which passes through both rings correctly and
 * stands up to 0.0065 m outside the chord in the middle, exactly where it was measured to float.
 *
 * Regressing ρ directly makes the fit piecewise LINEAR in the same variables the mesh is linear in,
 * so between two rings it returns the chord. The ellipsoid is still doing its two jobs — the normal
 * comes from its gradient, and the answer is divided back through `ellipsoidRadius` so `surfaceAt`
 * receives the multiplier it expects — it has just stopped being asked to guess at what the mesh
 * does between its own vertices.
 *
 * Two guards, because an extrapolation that goes wrong goes wrong silently:
 *   * the 3×3 normal equations fall back to the weighted mean when they are near-singular, which is
 *     what a neighbourhood collapsed onto a line looks like;
 *   * the result is clamped to the radii actually seen nearby, plus 0.006 m of slack — enough for
 *     the boundary correction, which measures up to 0.004 m, and not enough for a runaway.
 *
 * `Head.pts` carries 202 vertices, of which about 190 survive `sampleSkull`; the band evaluates
 * this 399 times. 76 000 kernel weights at boot, once, and never again per frame.
 */
function skullFitField(
  head: Head,
  samples: readonly SkullSample[],
): (y: number, phi: number) => number {
  const H = head.height;
  const sy2 = (FIT_SIGMA_Y * H) ** 2;
  const sp2 = FIT_SIGMA_PHI ** 2;

  /* The radius the guards fall back to: the plain mean over the whole usable skull. */
  let mean = 0;
  if (samples.length > 0) {
    let acc = 0;
    for (const s of samples) acc += s.rho;
    mean = acc / samples.length;
  }

  /** ρ -> the multiplier `surfaceAt` wants, which is ρ over the un-calibrated ellipsoid's radius. */
  const asFit = (rho: number, y: number, phi: number): number => {
    const r = ellipsoidRadius(head, y, phi);
    return r > 1e-6 ? rho / r : head.fit;
  };

  return (y: number, phi: number): number => {
    let s0 = 0;
    let sY = 0;
    let sP = 0;
    let sYY = 0;
    let sYP = 0;
    let sPP = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let lo = Infinity;
    let hi = -Infinity;

    for (const s of samples) {
      const dy = s.y - y;
      const dp = angDiff(s.phi, phi);
      const w = Math.exp(-0.5 * ((dy * dy) / sy2 + (dp * dp) / sp2));
      if (w < 1e-4) continue;
      s0 += w;
      sY += w * dy;
      sP += w * dp;
      sYY += w * dy * dy;
      sYP += w * dy * dp;
      sPP += w * dp * dp;
      b0 += w * s.rho;
      b1 += w * dy * s.rho;
      b2 += w * dp * s.rho;
      if (w > 0.15) {
        if (s.rho < lo) lo = s.rho;
        if (s.rho > hi) hi = s.rho;
      }
    }
    if (s0 < 1e-6) return asFit(mean, y, phi);

    const wMean = b0 / s0;
    const det =
      s0 * (sYY * sPP - sYP * sYP) - sY * (sY * sPP - sYP * sP) + sP * (sY * sYP - sYY * sP);
    if (!(Math.abs(det) > 1e-12 * s0 * s0 * s0)) return asFit(wMean, y, phi);

    /* Cramer on the first unknown only — the other two are the local gradient and go unused. */
    const c0 =
      (b0 * (sYY * sPP - sYP * sYP) - sY * (b1 * sPP - sYP * b2) + sP * (b1 * sYP - sYY * b2)) / det;
    if (!Number.isFinite(c0) || lo === Infinity) return asFit(wMean, y, phi);
    const clamped = c0 < lo - 0.006 ? lo - 0.006 : c0 > hi + 0.006 ? hi + 0.006 : c0;
    return asFit(clamped, y, phi);
  };
}

/**
 * The lowest cloud-space height at which the head bone still OWNS geometry, near a given azimuth.
 *
 * Below it the surface belongs to `neck`, and everything in this file — the ellipsoid, its
 * calibration, the whole `Head` — was fitted to head-dominant vertices and knows nothing about it.
 * The outline's nape hairline at 0.272 of head height is a canonical landmark and the mesh is not
 * obliged to agree; where it does not, the band is lifted rather than allowed to run off the bottom
 * of the evidence, and `ScalpHairStats.floorClampedColumns` reports how often that happened so a
 * silent clamp cannot masquerade as a correct outline.
 *
 * ±0.45 rad of azimuth, which is wide enough to hold vertices at every column on a 202-vertex head
 * and narrow enough that the jaw does not set the floor for the nape.
 */
function skullFloor(samples: readonly SkullSample[], phi: number): number {
  let lo = Infinity;
  for (const s of samples) {
    if (Math.abs(angDiff(s.phi, phi)) > 0.45) continue;
    if (s.y < lo) lo = s.y;
  }
  return lo;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 4. COLOUR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The two tones the band is mixed from, and they are chosen against each other rather than in
 * isolation.
 *
 * `SALT` is 0xB4B1A8 — a light desaturated grey pulled very slightly warm. Pure neutral grey under
 * this dojo's warm key comes back looking blue, and blue-white hair is a specific and much older
 * look than the one asked for. `PEPPER` is 0x1A1512, which is `./facialHair.ts`'s colour verbatim
 * and therefore §5.6's `M_HAIR` colour: the dark flecks in this band are the same pigment as the
 * mustache, which is what stops a grey scalp and a dark mustache reading as two different men.
 *
 * ═══ WHY SALT-AND-PEPPER AND NOT FLAT GREY ═══════════════════════════════════════════════════
 *
 * Flat grey on a 0.006 m shell is a moulded part, and grey is the whole brief — the man is a senior
 * sensei, not a thirty-year-old, so the average has to be unambiguously grey while the variation
 * has to be wide enough to break the surface. Two tones varying per vertex cost nothing — the
 * attribute rides in the same draw call, no texture, no second material — and they do the job a
 * hair map would: they break the shell's shading into something that varies at the scale of a clump
 * instead of at the scale of the whole band.
 *
 * The distribution is not uniform, because greying is not. It runs greyest at the TEMPLES and along
 * the TOP edge and darkest low at the nape, which is the order hair actually loses its pigment, and
 * it is also the order that flatters the silhouette: the lightest hair is the part seen against the
 * bald skull, and the darkest is the part in shadow under the occiput.
 */
const SALT = 0xb4b1a8;
const PEPPER = 0x1a1512;

/**
 * Mix toward `SALT` at sweep position `psi` and row fraction `rowT` (0 at the bottom edge, 1 at the
 * top). Always inside [0, 1].
 *
 * ═══ THE MIX IS PERCEPTUAL, AND THAT CHANGES WHAT THE NUMBER MEANS ═══════════════════════════
 *
 * `PEPPER` is 0x1A1512: in sRGB its channels are around 0.098, in the renderer's LINEAR working
 * space they are around 0.008. Half way between it and `SALT` is 0.115 linear, which is 0x5D back
 * in sRGB — a third of the way, not half. So `emitBand` mixes in sRGB and hands the result to
 * `Color.setRGB(..., SRGBColorSpace)`, and this fraction means what it looks like.
 *
 * ═══ THE DISTRIBUTION HAS TO BE WIDE OR IT RENDERS AS FELT ═══════════════════════════════════
 *
 * A first pass produced tones spanning only 0x57 to 0x8F around a mean of 0x79 — measured off the
 * built colour attribute, not judged by eye — and on screen that is a light grey band with no
 * internal contrast, which under this dojo's key reads as a bandage rather than as hair. Two
 * separate causes, both worth naming:
 *
 *   * `hairNoise` is a sum of two smooth octaves and its output crowds the MIDDLE of [-1, 1]; it
 *     reaches the ends only where both octaves peak together. Multiplying it by a bigger number
 *     scales the whole distribution including the crowding. `punch` reshapes it instead, pushing
 *     magnitude toward the extremes without touching the sign or the continuity, so the flecks are
 *     actually flecks.
 *   * the mean was too LIGHT. Hair that renders brighter than the skin it sits on stops reading as
 *     hair whatever colour it is. 0.36 base puts the mean near 0x64, darker than the lit scalp,
 *     with the range now running from the unmixed `PEPPER` to the unmixed `SALT`.
 *
 * +0.14 at the temples and +0.10 up the band, because that is the order hair loses its pigment and
 * also the order that flatters the silhouette — the lightest hair against the bald skull, the
 * darkest in the shadow under the occiput.
 *
 * The two speckle frequencies are 9 and 17 cycles over the sweep, both well under the 73 columns
 * that sample them; an earlier pass ran 21.7 and 47.3 and the flecks aliased into a smooth wash.
 * The row term is inside the noise argument rather than added to it, so a fleck does not run as a
 * vertical stripe from the bottom edge to the top.
 */
export function saltPepperMix(psi: number, rowT: number): number {
  const arcT = 1 - Math.abs(2 * psi - 1);
  const speckle =
    0.3 * punch(hairNoise(psi * 9 + rowT * 3.3 + 61.2)) +
    0.18 * punch(hairNoise(psi * 17 + rowT * 5.1));
  const g = 0.36 + 0.14 * (1 - arcT) + 0.1 * rowT + speckle;
  return g < 0 ? 0 : g > 1 ? 1 : g;
}

/** Push a signed value on [-1, 1] toward its ends, sign and continuity intact. */
function punch(x: number): number {
  const t = x < -1 ? -1 : x > 1 ? 1 : x;
  return t < 0 ? -Math.pow(-t, 0.6) : Math.pow(t, 0.6);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE SHELL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

interface BandBuild {
  readonly floorClampedColumns: number;
  readonly fitLo: number;
  readonly fitHi: number;
}

/**
 * Sweep the horseshoe and close it into a solid.
 *
 * ═══ WINDING ═════════════════════════════════════════════════════════════════════════════════
 *
 * Columns advance along `tan = up × n`, which is `./facialHair.ts`'s tangent and points the way
 * azimuth increases; rows advance along `up`, the world vertical made perpendicular to the local
 * normal so the band stands ON the skull rather than shearing along it. That makes `tan × up = n`,
 * so a quad taken (column, column+1, column+1 row+1, column row+1) on the OUTER surface faces
 * outward, and the same quad reversed faces inward on the inner one. Four rims — top, bottom and
 * one at each temple — close it.
 *
 * The shell is closed and not a single-sided ribbon because the material is `FrontSide`: an open
 * ribbon shows nothing at all from below the top edge, where most of the band is seen from.
 */
function emitBand(
  head: Head,
  fitAt: (y: number, phi: number) => number,
  samples: readonly SkullSample[],
  pos: number[],
  col: number[],
  idx: number[],
): BandBuild {
  const H = head.height;
  const base = pos.length / 3;
  const O = (j: number, i: number): number => base + j * ROWS + i;
  const I = (j: number, i: number): number => base + COLS * ROWS + j * ROWS + i;

  const outer: Vector3[] = [];
  const inner: Vector3[] = [];
  const tone: number[] = [];
  let floorClampedColumns = 0;
  let fitLo = Infinity;
  let fitHi = -Infinity;

  for (let j = 0; j < COLS; j++) {
    const psi = j / (COLS - 1);
    const phi = TEMPLE_PHI + psi * SWEEP;
    const edges = horseshoeEdges(psi);

    const yTop = head.yChin + edges.top * H;
    let yBot = head.yChin + edges.bottom * H;
    const floor = skullFloor(samples, phi);
    if (Number.isFinite(floor) && yBot < floor + FLOOR_MARGIN * H) {
      yBot = Math.min(floor + FLOOR_MARGIN * H, yTop - MIN_BAND * H);
      floorClampedColumns++;
    }

    /* What SHOWS wobbles; what is BURIED does not move. A shell of exactly constant thickness has a
     * silhouette parallel to the skull under it, which is the one shape hair never has — but the
     * same wobble applied to the bedding depth would be a wobble in the clearance that keeps the
     * band on the head.
     *
     * Two frequencies, and the second reads the ROW as well as the column. A relief that varies
     * only along the sweep is a fluted column: every ripple runs the full height of the band from
     * the nape to the top edge, which is a shape hair never has either. Together they put a bump
     * about every 0.03 m in both directions — clump scale — for no vertices and no draw calls. */
    const showBase = HAIR_SHOW * H * tipTaper(psi);
    const wobbleCol = 0.18 * hairNoise(psi * 5.7 + 91.4);
    const sink = HAIR_SINK * H;

    for (let i = 0; i < ROWS; i++) {
      const rowT = i / (ROWS - 1);
      const y = yBot + (yTop - yBot) * rowT;
      const fit = fitAt(y, phi);
      if (fit < fitLo) fitLo = fit;
      if (fit > fitHi) fitHi = fit;
      const { p, n } = surfaceAt(head, y, phi, fit);
      const show = showBase * (1 + wobbleCol + 0.14 * hairNoise(psi * 13 + rowT * 4.2 + 7.7));
      inner.push(p.clone().addScaledVector(n, -sink));
      outer.push(p.clone().addScaledVector(n, show));
      tone.push(saltPepperMix(psi, rowT));
    }
  }

  /* Mixed in sRGB and converted once, not lerped in the working space — see `saltPepperMix` for
   * why blending two colours three stops apart in linear space makes the fraction lie. */
  const sr = ((SALT >> 16) & 255) / 255;
  const sg = ((SALT >> 8) & 255) / 255;
  const sb = (SALT & 255) / 255;
  const pr = ((PEPPER >> 16) & 255) / 255;
  const pg = ((PEPPER >> 8) & 255) / 255;
  const pb = (PEPPER & 255) / 255;
  const mixed = new Color();
  const push = (list: readonly Vector3[]): void => {
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      const g = tone[k];
      if (v === undefined || g === undefined) continue;
      pos.push(v.x, v.y, v.z);
      mixed.setRGB(pr + (sr - pr) * g, pg + (sg - pg) * g, pb + (sb - pb) * g, SRGBColorSpace);
      col.push(mixed.r, mixed.g, mixed.b);
    }
  };
  push(outer);
  push(inner);

  const quad = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, b, c, a, c, d);
  };
  const R = ROWS - 1;
  const C = COLS - 1;
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < R; i++) {
      quad(O(j, i), O(j + 1, i), O(j + 1, i + 1), O(j, i + 1));
      quad(I(j, i), I(j, i + 1), I(j + 1, i + 1), I(j + 1, i));
    }
    quad(O(j, R), O(j + 1, R), I(j + 1, R), I(j, R));
    quad(I(j, 0), I(j + 1, 0), O(j + 1, 0), O(j, 0));
  }
  for (let i = 0; i < R; i++) {
    quad(O(0, i), O(0, i + 1), I(0, i + 1), I(0, i));
    quad(I(C, i), I(C, i + 1), O(C, i + 1), O(C, i));
  }

  return { floorClampedColumns, fitLo, fitHi };
}

/**
 * How far the fitted surface misses the real head VERTICES, in metres, over the band's footprint.
 *
 * `HAIR_SINK` and `HAIR_SHOW` are the budgets this has to stay inside, and it is measured rather
 * than assumed for the reason `./facialHair.ts` gives twice over: both of that file's placement
 * bugs were fits that were trusted instead of checked, and both were found by measuring against
 * these same vertices.
 *
 * It is a WEAKER check than the one that settled the numbers, and the difference matters. This
 * measures the fit against the vertices; what the band actually rests on is the triangulated
 * surface BETWEEN them, which on this head's 0.05 m vertex rings falls up to 0.005 m inside the
 * curve through them. That measurement needs a raycast against the bind-pose mesh and does not
 * belong at boot — it was run once from the console and the answer is in `HAIR_SINK`'s header.
 * This one is the cheap version, kept because it costs 190 evaluations and would catch a rig whose
 * head is a shape the ellipsoid cannot follow at all.
 */
function surfaceResidual(
  head: Head,
  fitAt: (y: number, phi: number) => number,
  samples: readonly SkullSample[],
): number {
  const H = head.height;
  const yLo = head.yChin + 0.3 * H;
  const yHi = head.yChin + 0.72 * H;
  let worst = 0;
  for (const s of samples) {
    if (s.y < yLo || s.y > yHi) continue;
    if (Math.abs(angDiff(s.phi, Math.PI)) > Math.PI - TEMPLE_PHI) continue;
    const r = ellipsoidRadius(head, s.y, s.phi) * fitAt(s.y, s.phi);
    const e = Math.abs(r - s.rho);
    if (e > worst) worst = e;
  }
  return worst;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 6. ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface ScalpHairStats {
  readonly vertices: number;
  readonly triangles: number;
  /** One. One geometry, one material, and `castShadow` off — see `attachScalpHair`. */
  readonly drawCalls: number;
  /** Chin-to-crown, in metres — what every dimension in §1 was scaled by. */
  readonly headHeightM: number;
  /** How far the shell stands either side of the fitted skull surface, in metres. */
  readonly proudM: number;
  readonly sunkM: number;
  /** Worst radial miss of the fitted surface against the real head vertices. See `surfaceResidual`. */
  readonly surfaceResidualM: number;
  /** Range the per-direction fit actually took over the band. A constant could not cover it. */
  readonly fitRange: readonly [number, number];
  /** Columns whose bottom edge had to be lifted off the neck. See `skullFloor`. */
  readonly floorClampedColumns: number;
}

export interface ScalpHairHandle {
  readonly mesh: Mesh;
  readonly stats: ScalpHairStats;
  dispose(): void;
}

const SCALP_HAIR_NAME = 'karateka_scalp_hair';

/**
 * Build the surviving horseshoe of hair for `character` and parent it to the head bone.
 *
 * Returns `null` on a rig with no resolvable head or too few head vertices to fit, exactly as
 * `attachFacialHair` does and for the same reason: this is decoration, and a rig whose head bone is
 * named something else should lose its hair, not the dojo.
 */
export function attachScalpHair(character: Character): ScalpHairHandle | null {
  /* Re-attaching is the console workflow while tuning the outline, so retire an existing band
   * rather than stacking a second one on the same skull. */
  const old = character.root.getObjectByName(SCALP_HAIR_NAME);
  if (old !== undefined) {
    (old as Mesh).geometry.dispose();
    old.removeFromParent();
  }

  const head = measureHead(character);
  if (head === null) return null;

  const samples = sampleSkull(head);
  if (samples.length < 24) return null;
  const fitAt = skullFitField(head, samples);

  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const build = emitBand(head, fitAt, samples, pos, col, idx);

  /* Cloud space -> head-bone space. The derivation is `./facialHair.ts`'s file header: a vertex
   * weighted entirely to `head` and a child of the head BONE land in the same place when the
   * child's position is `boneInverse_head · p`, which is what `head.toBone` holds. */
  const p = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0).applyMatrix4(head.toBone);
    pos[i] = p.x;
    pos[i + 1] = p.y;
    pos[i + 2] = p.z;
  }

  const g = new BufferGeometry();
  g.name = SCALP_HAIR_NAME;
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  g.computeVertexNormals();

  /**
   * White base colour, because with `vertexColors` the shader multiplies the two and the band's
   * tones are the ones in the attribute. `Color`'s constructor has already taken 0x8F8D86 and
   * 0x1A1512 from sRGB into the renderer's working space, which is where a colour ATTRIBUTE is
   * assumed to be — so the mix rides through untouched rather than being converted twice.
   */
  const material: MeshStandardMaterial = makeMatteHairMaterial({
    name: 'M_SCALP_HAIR',
    color: 0xffffff,
    vertexColors: true,
  });

  const mesh = new Mesh(g, material);
  mesh.name = SCALP_HAIR_NAME;
  /**
   * RECEIVES shadow, does not CAST one — the same trade `./facialHair.ts` documents, and here it is
   * worth more. This band wraps the whole back of the skull, so a shadow-map pass would draw all
   * 1 592 of its triangles to produce a shadow that falls on the 0.008 m of scalp immediately
   * underneath it, entirely hidden by the band casting it, at a texel size this 2 m figure's map
   * cannot resolve anyway. Receiving is the half that pays: it is what puts the far side of the
   * horseshoe into shadow when the key is across the dojo, which is the only cue that the band goes
   * round the head rather than sitting on the near side of it.
   */
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  head.bone.add(mesh);

  return {
    mesh,
    stats: {
      vertices: pos.length / 3,
      triangles: idx.length / 3,
      drawCalls: 1,
      headHeightM: head.height,
      proudM: HAIR_SHOW * head.height,
      sunkM: HAIR_SINK * head.height,
      surfaceResidualM: surfaceResidual(head, fitAt, samples),
      fitRange: [build.fitLo, build.fitHi],
      floorClampedColumns: build.floorClampedColumns,
    },
    dispose(): void {
      mesh.removeFromParent();
      g.dispose();
      material.dispose();
    },
  };
}
