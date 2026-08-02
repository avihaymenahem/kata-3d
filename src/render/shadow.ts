/**
 * B5 RENDER — `src/render/shadow.ts`
 *
 * `configureShadow` + `refitShadow`: Shadow Mode B — a per-frame fitted ortho frustum with a
 * LIGHT-SPACE TEXEL SNAP. ARCHITECTURE.md §5.5; doc 05 §6.3 / §6.4.
 *
 * ── THIS FILE IS THE ROUTE FOR ONE NAMED CRITIC COMPLAINT ─────────────────────────────────────
 * §7.7: "figure pasted on the floor" -> metric 61 `contact_shadow_present`, rubric B14, block B5,
 * `render/shadow.ts -> S_FIT, radius`. The whole design of this file is aimed at that one line.
 *
 * The arithmetic, all of it (§5.5):
 *   S_fit      = 0.75 H            = 1.3125 m       half-extent of the fitted box
 *   mapSize    = 2048              -> world texel t = 2 * 1.3125 / 2048 = 1.2817 mm
 *   radius     = 4 texels          -> PCF penumbra  ~ 2 * 4 * 1.2817   = 10.25 mm
 * A ~10 mm penumbra under a foot at 1.75 m body height IS a contact shadow. Mode A's fixed
 * `S_fixed = 3.51 m` box gives t = 3.43 mm and a 27 mm penumbra — a soft grey blob, which is
 * exactly the "mushy shadow" of Channel-D rubric item C9.
 *
 * ── WHY THE BOX MOVES BUT THE LIGHT DOES NOT ──────────────────────────────────────────────────
 * §5.4 is absolute: none of the four lights ever moves, because a moving directional makes the
 * shading terminator and the gi's sheen lobe SWIM during orbit. But the karateka walks a 3.78 m
 * embusen, and a box big enough to cover all of it cannot also have a 1.28 mm texel.
 *
 * `DirectionalLightShadow.updateMatrices` pins the shadow camera to the light's own world position
 * and aims it at `light.target`, so the box cannot be translated by moving the camera without
 * moving the light. It CAN be translated by making the ortho bounds ASYMMETRIC:
 * `left/right/bottom/top` are independent, so an off-axis box is free. That is what `refitShadow`
 * does. The light's position, direction, colour and intensity are untouched, every frame.
 *
 * ── WHY THE EXTENT IS HELD CONSTANT ───────────────────────────────────────────────────────────
 * The penumbra is `2 * radius * t` and `t = extent / mapSize`. If the extent tracked the figure's
 * AABB, then t — and therefore the penumbra — would breathe as the arms extend and retract: the
 * contact shadow would soften on every punch. So the extent is PINNED at `2 * S_fit`, quantised to
 * whole texels, and only the CENTRE moves. It grows, in whole-texel steps, only if a pose genuinely
 * exceeds the box; `ShadowFit.grew` records that so a look-dev pass can see it happen.
 *
 * ── WHY THE SNAP EXISTS ───────────────────────────────────────────────────────────────────────
 * three.js does not texel-snap shadow cameras (doc 05 §6.4 step 3, marked `[DERIVED — three.js does
 * not do this for you]`). Without it, a sub-texel translation of the box re-quantises every shadow
 * edge every frame and the whole shadow crawls while the user orbits — on a product whose entire
 * proposition is a 360 degree orbit. `snapShadowBox` is a pure function precisely so
 * `tests/render/config.test.ts` can prove the snap is idempotent without a GL context.
 *
 * ── WHAT IS DELIBERATELY NOT SET ──────────────────────────────────────────────────────────────
 * `blurSamples` is VSM-ONLY (doc 05 §14.1 #2, `WebGLShadowMap.js:379-382` reads it inside the VSM
 * branch); setting it under PCF does nothing and misleads the next reader. `shadowSide` stays
 * `null` because every shell in the project is closed (§5.5). `bias` stays exactly 0: with
 * `normalBias` set, a constant bias peter-pans the feet off their own shadow. `near`/`far` are
 * CONSTANTS, not refitted — re-deriving them per frame changes depth precision per frame, which
 * makes the bias behave differently at different poses. Both are named in `SHADOW_DO_NOT_SET`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE FIT TAKES A `Landmarks` AS WELL AS A `RigHandles` — THE SHADOW-CLIPPING BUG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `refitShadow` originally read ONE thing: `rig.byName[bone].matrixWorld`, the procedural
 * skeleton. That was correct while the procedural karateka WAS the figure on screen. It stopped
 * being correct the moment `src/player/character.ts` retired the solver from the render path: the
 * procedural rig is still built and still in the graph (`app.ts` keeps it for `rig.bones.length`
 * and the teardown path) but it is `visible = false`, it is never posed, and it never leaves the
 * embusen origin in bind pose. `applyPose` runs only on the `?rig=proc` path.
 *
 * So the box was fitted, every frame, around a stationary invisible figure at the origin — a
 * 2.625 m box centred on `(0.01, 0.05)` in light space — while the glTF character walked the
 * embusen out past `x = ±1.42 m, z = ±1.89 m`. Measured against the live page, the character's own
 * light-space centre travels to `(-1.32, -0.18)` at count 3 and `(+1.35, +0.27)` at count 11, i.e.
 * ONE FULL BOX-WIDTH off. `getShadow` (`shadowmap_pars_fragment.glsl.js`) returns 1.0 — fully lit —
 * for any fragment whose shadow coord falls outside `[0,1]`, so the half of the figure outside the
 * frustum simply had no shadow. That is the reported "shadow being cut in some areas", and it is
 * also metric 61 `contact_shadow_present` / rubric B14 failing with no visible cause.
 *
 * The fix is NOT a bigger box — `S_fit` is what buys the 1.28 mm texel, and doubling it to cover the
 * whole embusen would put the penumbra at 41 mm, which is rubric C9's "mushy shadow" twice over.
 * The fix is to fit the FIGURE THAT IS ACTUALLY ON SCREEN, so `refitShadow` now also accepts the
 * `Landmarks` struct — which `src/player/characterLandmarks.ts` samples off the visible character
 * every frame, in world metres, against the same 25 canonical joints every metric uses. Extent
 * unchanged, texel unchanged, penumbra unchanged; only the centre now follows the right body.
 *
 * ── WHY THE LANDMARK PATH GATES ON REACH ──────────────────────────────────────────────────────
 * `Landmarks` is a FIXED-SIZE struct with no liveness flag, and `sampleCharacterLandmarks` documents
 * that an unmapped joint "keeps whatever it had rather than collapsing to the origin" — the right
 * call for camera framing, a trap for an AABB. On the shipped Rigify model exactly one canonical
 * slot is unmapped (`HeadTop_End`; Rigify has no head-tip terminator), so it holds the value
 * `sampleLandmarks` seeded from the procedural bind pose AT THE ORIGIN. Fitting that naively
 * stretches the box from the character back to world zero: measured 2.69 m of light-space width for
 * a 1.75 m figure, which would trip `grew` and soften the contact shadow on exactly the counts
 * furthest from centre. So a point further than `SHADOW_FIT_REACH_M` from the pelvis is not a joint
 * of this body and is dropped. See that constant for the number and its anatomy.
 */

import { Matrix4, Vector3, type Camera, type DirectionalLight } from 'three';

import {
  CANONICAL_FROM_BONE,
  CANONICAL_JOINTS,
  H,
  type BoneName,
  type Landmarks,
  type RigHandles,
} from '../contracts';
import { LIMB_R, SHADOW } from '../data';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Derived geometry — every number traceable to `SHADOW` in src/data/constants/render.ts
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Mode B half-extent, metres. `0.75 H = 1.3125 m`. */
export const S_FIT_M = SHADOW.sFitH.v * H;
/** `2048`. */
export const SHADOW_MAP_PX = SHADOW.mapSize.v;
/** World texel size, metres. `2 * S_FIT_M / mapSize = 1.2817e-3`. */
export const SHADOW_TEXEL_M = (2 * S_FIT_M) / SHADOW_MAP_PX;
/** PCF penumbra width, metres. `2 * radius * texel = 1.025e-2`. The contact-shadow number. */
export const SHADOW_PENUMBRA_M = 2 * SHADOW.radius.v * SHADOW_TEXEL_M;

/**
 * The 24 bones whose world positions, inflated by `LIMB_R`, form the shadow AABB
 * (`SHADOW.aabbBoneCount = 24`). doc 05 §6.4 step 1: this is ~50x cheaper than
 * `SkinnedMesh.computeBoundingBox()`, which CPU-skins every vertex.
 *
 * Chosen so that every extremity that can leave the torso box is represented: both fists and both
 * finger tips (a jodan age-uke and a full oi-zuki), both toe tips and both balls (zenkutsu depth and
 * a lifted rear heel), and `head_end` (the top of the silhouette).
 */
export const SHADOW_AABB_BONES: readonly BoneName[] = Object.freeze([
  'pelvis', 'spine_02', 'chest', 'head_end',
  'clavicle_L', 'upperarm_L', 'lowerarm_L', 'hand_L', 'fingers_end_L',
  'clavicle_R', 'upperarm_R', 'lowerarm_R', 'hand_R', 'fingers_end_R',
  'thigh_L', 'calf_L', 'foot_L', 'ball_L', 'toe_end_L',
  'thigh_R', 'calf_R', 'foot_R', 'ball_R', 'toe_end_R',
]);

/** §5.5 / doc 05 §14.1 #2 — named so a look-dev pass cannot "add" them believing they do anything. */
export const SHADOW_NEVER_SET: readonly string[] = Object.freeze([
  'blurSamples', // VSM only under PCF
  'shadowSide', // closed shells
]);

/**
 * The two shapes `refitShadow` can fit to. `RigHandles` is the procedural skeleton (`?rig=proc`);
 * `Landmarks` is the world-space joint snapshot of whichever figure is actually on screen. Same
 * output — a light-space AABB — from whichever figure the caller is rendering.
 */
export type ShadowFitSource = RigHandles | Landmarks;

/**
 * Landmark plausibility gate, metres: `1.0 H = 1.75 m` from the pelvis.
 *
 * A single joint of ONE body cannot be a whole body height from its own pelvis. The anatomical
 * ceiling is the fingertip of a fully extended overhead arm at `~0.72 H` and the toe tip of a high
 * mae-geri at `~0.70 H` (doc 06 §5.1 segment lengths), so `1.0 H` clears every real pose by 39 %
 * while still rejecting a landmark stranded at the embusen origin once the figure is more than
 * 1.75 m from it. Measured over all 29 beats of Taikyoku Shodan on the shipped model, the accepted
 * set never needs more than `0.42 m` of light-space half-width or `0.90 m` of half-height against
 * `S_fit = 1.3125 m` — `grew` stays false and the texel stays at 1.2817 mm for the whole kata.
 *
 * The anchor is canonical joint 0, `Hips` -> `pelvis`. It is the one contract bone that maps on
 * BOTH skeleton conventions the project loads (`Hips` on Mixamo, `DEF-hips` on Rigify) and on the
 * procedural rig, so it is the only landmark that cannot itself be the stale one.
 *
 * The gate is landmark-only ON PURPOSE. The `RigHandles` path reads live bones off one coherent
 * skeleton, where a "stale" bone is not a state that exists; gating it would be a check that can
 * only ever produce false negatives.
 */
export const SHADOW_FIT_REACH_M = H;

/**
 * Per-canonical-joint inflation radius, metres, in `CANONICAL_JOINTS` order — so the landmark fit is
 * an indexed walk with no per-frame table lookup. Same `LIMB_R` inflation the bone path applies, for
 * the same reason: it is the limb's SURFACE that casts, not its centre line.
 *
 * The two virtual `*FistCenter` joints inherit `hand_*`'s radius, which is the correct one — they
 * ARE the fist, 55 mm beyond the wrist along the hand axis.
 */
const CANONICAL_INFLATE_M: readonly number[] = Object.freeze(
  CANONICAL_JOINTS.map((j) => (LIMB_R[CANONICAL_FROM_BONE[j]]?.v ?? 0) * H),
);

/**
 * Inflation for `Landmarks`' four extra foot points. The canonical set stops at `ball_*` and
 * `hand_*`, where `SHADOW_AABB_BONES` goes all the way out to `toe_end_*` and `fingers_end_*`;
 * `heelL/R` and `toeTipL/R` are what restore the missing ~5 cm at the end of the foot, and they are
 * the points directly under the contact shadow this whole file is named for.
 */
const FOOT_INFLATE_M = (LIMB_R.ball_L?.v ?? 0) * H;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Static configuration
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * §5.1 boot step 9. Pure property assignment — `[GL-free]`, so `tests/render/config.test.ts`
 * configures a real `DirectionalLight` in Node and reads every value back.
 */
export function configureShadow(light: DirectionalLight): void {
  const sh = light.shadow;
  sh.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);

  sh.bias = SHADOW.bias.v; // exactly 0 — normalBias does the work
  sh.normalBias = SHADOW.normalBiasM.v; // 0.015 m ~ 12x texel; tune 0.007..0.023 by eye
  sh.radius = SHADOW.radius.v; // 4 texels -> ~10.2 mm penumbra
  sh.intensity = SHADOW.intensity.v; // 0.92, so the IBL fill still reads inside the core

  const cam = sh.camera;
  cam.near = SHADOW.nearM.v; // 0.10 m — CONSTANT, see the header
  cam.far = SHADOW.farM.v; // 12.0 m
  cam.left = -S_FIT_M;
  cam.right = S_FIT_M;
  cam.bottom = -S_FIT_M;
  cam.top = S_FIT_M;
  cam.updateProjectionMatrix();

  // `blurSamples` and `shadowSide` deliberately untouched — see SHADOW_NEVER_SET.
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The snap — a pure function, so it is provable without GL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface ShadowFit {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  /** World texel size actually used. Constant unless `grew` is true. */
  readonly texelM: number;
  /** Snapped box centre in light space, metres. */
  readonly centreX: number;
  readonly centreY: number;
  /** True when the pose exceeded `2 * S_fit` and the box had to grow (penumbra widens with it). */
  readonly grew: boolean;
  /** Distance along the light axis to the nearest / farthest inflated bone point, metres. */
  readonly nearNeededM: number;
  readonly farNeededM: number;
}

/**
 * Turn a light-space XY interval into a texel-snapped, constant-extent ortho box.
 *
 * Both the half-extents and the centre are quantised to the texel grid. Quantising the centre alone
 * is not enough: if the extent is not a whole number of texels the grid itself shifts, and the snap
 * buys nothing.
 *
 * PURE. Same inputs -> same outputs, no three.js objects, no GL. Called once per frame by
 * `refitShadow` and directly by `tests/render/config.test.ts`.
 */
export function snapShadowBox(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  mapSizePx: number = SHADOW_MAP_PX,
  sFitM: number = S_FIT_M,
  nearNeededM = SHADOW.nearM.v,
  farNeededM = SHADOW.farM.v,
): ShadowFit {
  const baseTexel = (2 * sFitM) / mapSizePx;

  const needX = (maxX - minX) / 2;
  const needY = (maxY - minY) / 2;
  const grew = needX > sFitM || needY > sFitM;

  // Whole-texel half-extents. `Math.ceil` never shrinks the box below what the pose needs.
  const halfX = Math.ceil(Math.max(sFitM, needX) / baseTexel) * baseTexel;
  const halfY = Math.ceil(Math.max(sFitM, needY) / baseTexel) * baseTexel;

  const centreX = Math.round((minX + maxX) / 2 / baseTexel) * baseTexel;
  const centreY = Math.round((minY + maxY) / 2 / baseTexel) * baseTexel;

  return {
    left: centreX - halfX,
    right: centreX + halfX,
    bottom: centreY - halfY,
    top: centreY + halfY,
    texelM: baseTexel,
    centreX,
    centreY,
    grew,
    nearNeededM,
    farNeededM,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Per-frame refit
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/* Scratch. `refitShadow` runs every frame at a 0.02 ms budget (§6.6), so it allocates nothing. */
const _eye = new Vector3();
const _at = new Vector3();
const _axisX = new Vector3();
const _axisY = new Vector3();
const _axisZ = new Vector3();
const _p = new Vector3();
const _rel = new Vector3();
const _anchor = new Vector3();
const _basis = new Matrix4();

/**
 * The light-space bounds under construction. Module-scoped rather than local so the two accumulators
 * below can share one `addPoint` without either allocating a result object per frame.
 */
const _box = { minX: 0, maxX: 0, minY: 0, maxY: 0, minD: 0, maxD: 0, found: 0 };
const REACH_SQ_M2 = SHADOW_FIT_REACH_M * SHADOW_FIT_REACH_M;

function resetBox(): void {
  _box.minX = Infinity;
  _box.maxX = -Infinity;
  _box.minY = Infinity;
  _box.maxY = -Infinity;
  _box.minD = Infinity;
  _box.maxD = -Infinity;
  _box.found = 0;
}

/**
 * Fold the world point currently in `_p`, inflated by `r` metres, into `_box`. Requires `_eye` and
 * the three light axes to be current for this frame.
 */
function addPoint(r: number): void {
  _rel.subVectors(_p, _eye);
  const x = _rel.dot(_axisX);
  const y = _rel.dot(_axisY);
  // Light space looks down its own -Z, so distance in front of the light is `-dot(rel, axisZ)`.
  const d = -_rel.dot(_axisZ);
  if (x - r < _box.minX) _box.minX = x - r;
  if (x + r > _box.maxX) _box.maxX = x + r;
  if (y - r < _box.minY) _box.minY = y - r;
  if (y + r > _box.maxY) _box.maxY = y + r;
  if (d - r < _box.minD) _box.minD = d - r;
  if (d + r > _box.maxD) _box.maxD = d + r;
  _box.found++;
}

/** The 24 named bones of `SHADOW_AABB_BONES`, read live off one coherent skeleton. */
function accumulateRig(rig: RigHandles): void {
  for (const name of SHADOW_AABB_BONES) {
    const bone = rig.byName[name];
    if (bone === undefined) continue;
    _p.setFromMatrixPosition(bone.matrixWorld);
    // Inflate by the bone's own capsule radius so a limb's surface, not its centre line, bounds the
    // box. `LIMB_R` is FracH (doc 06 §7.6 radii); the multiply by H is the conversion to metres.
    addPoint((LIMB_R[name]?.v ?? 0) * H);
  }
}

/** One world triple out of a `Landmarks` array, admitted only if it is within reach of the pelvis. */
function addLandmark(src: Float32Array, o: number, r: number): void {
  _p.set(src[o] ?? 0, src[o + 1] ?? 0, src[o + 2] ?? 0);
  if (_p.distanceToSquared(_anchor) > REACH_SQ_M2) return; // not a joint of this body — see the header
  addPoint(r);
}

/** The 25 canonical joints plus the four foot points, gated on `SHADOW_FIT_REACH_M`. */
function accumulateLandmarks(l: Landmarks): void {
  // Canonical index 0 is `Hips` -> `pelvis`, the one bone that maps on every skeleton in the project.
  _anchor.set(l.pos[0] ?? 0, l.pos[1] ?? 0, l.pos[2] ?? 0);
  for (let i = 0; i < CANONICAL_JOINTS.length; i++) {
    addLandmark(l.pos, i * 3, CANONICAL_INFLATE_M[i] ?? 0);
  }
  addLandmark(l.heelL, 0, FOOT_INFLATE_M);
  addLandmark(l.heelR, 0, FOOT_INFLATE_M);
  addLandmark(l.toeTipL, 0, FOOT_INFLATE_M);
  addLandmark(l.toeTipR, 0, FOOT_INFLATE_M);
}

/**
 * §3.13. Fit the key light's ortho shadow box around the figure, in light space, snapped to the
 * texel grid. Call once per frame, after the figure's `updateMatrixWorld(true)`.
 *
 * `figure` is whichever body is ON SCREEN — a `RigHandles` on the `?rig=proc` path, a `Landmarks`
 * on the clip-driven one. It is not a style choice: fitting the retired procedural rig while the
 * glTF character walks the embusen is the shadow-clipping bug this file's header describes, and a
 * union that accepts both is what lets `src/player/app.ts` name the right body at the call site
 * instead of two files disagreeing about which figure is real.
 *
 * `_cam` is INTENTIONALLY UNUSED, and that is the point: Mode B fits the FIGURE, never the view
 * frustum. A view-dependent fit re-quantises the shadow whenever the camera moves, which is the
 * shadow-swim artefact this whole file exists to kill — on a product built around a 360 degree
 * orbit. The parameter stays in the signature because §3.13 froze it and a future cascade split
 * would need it.
 */
export function refitShadow(
  figure: ShadowFitSource,
  light: DirectionalLight,
  _cam: Camera,
): void {
  // Light-space basis, exactly as Matrix4.lookAt(eye, target, up) builds it — which is what
  // Object3D.lookAt, and therefore DirectionalLightShadow.updateMatrices, uses:
  //   z = normalize(eye - target),  x = normalize(cross(up, z)),  y = cross(z, x)
  _eye.setFromMatrixPosition(light.matrixWorld);
  _at.setFromMatrixPosition(light.target.matrixWorld);
  _basis.lookAt(_eye, _at, light.up);
  _axisX.setFromMatrixColumn(_basis, 0);
  _axisY.setFromMatrixColumn(_basis, 1);
  _axisZ.setFromMatrixColumn(_basis, 2);

  resetBox();
  // `byName` is `RigHandles`' own field and appears on no `Landmarks`; discriminating on the rig
  // side keeps a future extra field on `Landmarks` from silently changing which branch runs.
  if ('byName' in figure) accumulateRig(figure);
  else accumulateLandmarks(figure);

  if (_box.found === 0) {
    // No figure yet (or a partial one). Leave the symmetric box `configureShadow` installed rather
    // than fitting to `Infinity` — a silently NaN projection matrix drops the shadow entirely.
    return;
  }

  const fit = snapShadowBox(
    _box.minX,
    _box.maxX,
    _box.minY,
    _box.maxY,
    SHADOW_MAP_PX,
    S_FIT_M,
    _box.minD,
    _box.maxD,
  );
  const cam = light.shadow.camera;
  cam.left = fit.left;
  cam.right = fit.right;
  cam.bottom = fit.bottom;
  cam.top = fit.top;

  // near/far are CONSTANTS (see the header) — they are only widened if the figure would otherwise
  // fall outside the frustum entirely, because that loses the shadow completely and metric 61
  // `contact_shadow_present` would fail with no visible cause. A slightly different depth precision
  // is strictly better than no shadow.
  //
  // Derived from THIS frame's bounds against the §5.5 constants, never from the camera's current
  // values: reading back what a previous frame widened makes the pair a one-way ratchet, so a single
  // bad frame — the pre-`updateMatrixWorld` boot call, which measures a degenerate light basis and
  // reports `minD ~ -0.1` — permanently pinned `near` at 0.01 for the rest of the session.
  cam.near = Math.min(SHADOW.nearM.v, Math.max(0.01, _box.minD - 0.05));
  cam.far = Math.max(SHADOW.farM.v, _box.maxD + 0.5);

  cam.updateProjectionMatrix();
  LAST_FIT = fit;
}

/**
 * The most recent fit, for the HUD and for `perf.json` / diagnostics. Read-only by convention; it
 * exists so a look-dev pass can watch `grew` flip during a full-extension pose instead of guessing.
 */
export let LAST_FIT: ShadowFit | null = null;
