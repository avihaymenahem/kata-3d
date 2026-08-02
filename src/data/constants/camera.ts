/**
 * B1 NUMBERS — `src/data/constants/camera.ts`
 *
 * `CAMERA_PRESET_PARAMS` (ARCHITECTURE.md §3.13, §4.1). Sources: ARCHITECTURE §5.7's preset table
 * and doc 07 §6.6's Channel-B camera spec.
 *
 * ═══ C16 — WHY THE FOUR MEASUREMENT CAMERAS ARE AUTHORED FROM `units.ts` AND NOT FROM §5.7 ═══
 *
 * `CameraPresetParams.posH` is declared WORLD (§3.4.1), and §2.1 fixes world `+X` = the character's
 * RIGHT. doc 07 §6.6 writes `CAM_LEFT` at `(+3H, 0.5H, 0)` because doc 07 §0.1's own table sets
 * "character's LEFT = +X" — the AUTHORED frame, which §0.1 is itself the section that proves is
 * left-handed. ARCHITECTURE §5.7 quotes doc 07's literals into a field it declares world.
 *
 * So `M_LEFT` — the camera that SEES the character's left side — sits at world `-3H`. The resolved
 * world constants ship frozen as `M_LEFT_POS_H` / `M_RIGHT_POS_H` / `M_FRONT_POS_H` / `M_TOP_POS_H`
 * in `src/contracts/units.ts`, and this file authors from THOSE and never from §5.7's or doc 07's
 * literals. That is the whole point of C16: B1 therefore needs no handedness conversion of its own,
 * which is why this block no longer touches the side-sign constant at all.
 *
 * ═══ WHAT `posH` MEANS FOR AN ANCHORED PRESET ════════════════════════════════════════════════
 *
 * §3.4.1 declares `posH` "fraction of H, world frame" and `anchorBone` "DETAIL_* / FOLLOW; null =
 * static". A camera pinned to a moving fist cannot have an absolute world position, so:
 *
 *   `anchorBone === null`  ->  `posH` is an ABSOLUTE world position and `targetH` an absolute point
 *   `anchorBone !== null`  ->  `posH` is an OFFSET from the anchor bone's world position, and
 *                              `targetH` an offset from the same anchor (so `[0,0,0]` looks at it)
 *
 * The offsets for `DETAIL_HANDS` / `DETAIL_FEET` have exactly §5.7's radii — 1.4 m = 0.800 H and
 * 1.1 m = 0.629 H — along a fixed three-quarter direction, so the framing is deterministic and a
 * capture is reproducible. Recorded as a handoff to B6, which implements `createCameraRig`.
 *
 * ═══ ORTHO IS MANDATORY FOR MEASUREMENT ══════════════════════════════════════════════════════
 * Perspective foreshortening corrupts every length metric read off an image (§5.7, doc 07 §6.6).
 * The four `M_*` presets are `frozen: true`, `orthoHeightH = 2.2`, aspect 1:1, near `0.1H`,
 * far `10H`, and `snapTo` is the only path the harness uses — a blending camera makes captures
 * non-deterministic.
 */

import type { BoneName, CameraPresetId } from '../../contracts';
import {
  H,
  M_FAR_H,
  M_FRONT_POS_H,
  M_LEFT_POS_H,
  M_NEAR_H,
  M_ORTHO_HEIGHT_H,
  M_RIGHT_POS_H,
  M_TOP_POS_H,
} from '../../contracts';

type V3 = readonly [number, number, number];

/**
 * §3.4.1's `CameraPresetParams`, field for field. It is one of the two auxiliary shared types that
 * section declares in the OWNING BLOCK'S BARREL rather than in `src/contracts/**` (the other is
 * `FootPlan`, in `src/data/embusen.ts`), so this is its single definition and `src/data/index.ts`
 * re-exports it.
 */
export interface CameraPresetParams {
  readonly id: CameraPresetId;
  readonly kind: 'persp' | 'ortho';
  /** persp only. */
  readonly fovDeg?: number;
  /** ortho only, fraction of H. */
  readonly orthoHeightH?: number;
  /** Fraction of H, WORLD frame. See the header for the anchored-preset reading. */
  readonly posH: readonly [number, number, number];
  readonly targetH: readonly [number, number, number];
  /** True only for `M_TOP` and `EMBUSEN`. */
  readonly upIsMinusZ: boolean;
  readonly nearH: number;
  readonly farH: number;
  /** `DETAIL_*` / `FOLLOW` / `ORBIT`; `null` = static. */
  readonly anchorBone: BoneName | null;
  /** 0 = rigid. */
  readonly followTauS: number;
  /** True for `M_FRONT` / `M_LEFT` / `M_RIGHT` / `M_TOP`. */
  readonly frozen: boolean;
}

/** §5.7's OrbitControls target, `(0, 0.55·H, 0)` — chest height, not the floor. */
export const ORBIT_TARGET_H: V3 = Object.freeze([0, 0.55, 0]);

/** §5.7's OrbitControls limits, verbatim (doc 05 §13). */
export const ORBIT_CONTROLS = Object.freeze({
  enableDamping: true,
  dampingFactor: 0.05,
  minDistanceM: 1.6,
  /**
   * §5.7 authored 9.0 m. Reduced to 7.2 because 9.0 IS NOT REACHABLE without tearing a hole in
   * the dojo.
   *
   * ═══ THE GEOMETRY ════════════════════════════════════════════════════════════════════════════
   *
   * `M_FAR_H = 10` puts every preset's far plane at 10 · H = 17.5 m, and the hall measures 16.6 m
   * across, so its far wall sits at roughly `d + 8.3` m of depth from a camera orbiting at `d`.
   * The chamfered corners reach further still. Past about 7.5 m of dolly they cross the far plane
   * and get clipped, and what shows through the gap is the background colour — the black artefact
   * on the wall, worst at full zoom-out, which is exactly where the frustum is tightest.
   *
   * Three ways out, and only one is available here. `M_FAR_H` lives in `src/contracts/units.ts`,
   * which is hash-frozen. Shrinking the hall would make a 16.6 m dojo into something smaller than
   * a real one. Capping the orbit costs 1.8 m of pull-back and costs nothing else: the figure is
   * 1.8 m tall and the whole room already reads at 7.2 m.
   *
   * Tinting the background warm (`ENV_COLOR_HEX.background`) hides the seam and is still worth
   * having as a backstop, but it does not close it — this does.
   */
  maxDistanceM: 7.2,
  minPolarAngleRad: 0.15,
  maxPolarAngleRad: 1.52,
});

/** §5.7: interactive preset changes blend over 0.6 s; `snapTo` is exact and resets the still. */
export const CAMERA_BLEND_S = 0.6;

/* ── Shared frustum depths. Every preset uses the measurement pair so a length read off any
 *    camera lands on the same near/far precision profile. ── */
const NEAR_H = M_NEAR_H;
const FAR_H = M_FAR_H;

/** Unit three-quarter direction for the two detail cameras: `normalize(0.5, 0.3, 0.8)`. */
const detailDir = ((): V3 => {
  const n = Math.hypot(0.5, 0.3, 0.8);
  return [0.5 / n, 0.3 / n, 0.8 / n];
})();
const scaled = (d: V3, r: number): V3 => [d[0] * r, d[1] * r, d[2] * r];

/** Unit direction for `DETAIL_FEET`: lower and slightly more front-on than the hands framing. */
const feetDir = ((): V3 => {
  const n = Math.hypot(0.6, 0.45, 0.8);
  return [0.6 / n, 0.45 / n, 0.8 / n];
})();

/** §5.7 radii, metres -> FracH. 1.4 m for the hands, 1.1 m for the feet. */
const DETAIL_HANDS_RADIUS_H = 1.4 / H;
const DETAIL_FEET_RADIUS_H = 1.1 / H;

const persp = (
  id: CameraPresetId,
  fovDeg: number,
  posH: V3,
  targetH: V3,
  o: {
    anchorBone?: BoneName | null;
    followTauS?: number;
    frozen?: boolean;
  } = {},
): CameraPresetParams => ({
  id,
  kind: 'persp',
  fovDeg,
  posH,
  targetH,
  upIsMinusZ: false,
  nearH: NEAR_H,
  farH: FAR_H,
  anchorBone: o.anchorBone ?? null,
  followTauS: o.followTauS ?? 0,
  frozen: o.frozen ?? false,
});

const ortho = (
  id: CameraPresetId,
  orthoHeightH: number,
  posH: V3,
  targetH: V3,
  o: { upIsMinusZ?: boolean; frozen?: boolean } = {},
): CameraPresetParams => ({
  id,
  kind: 'ortho',
  orthoHeightH,
  posH,
  targetH,
  upIsMinusZ: o.upIsMinusZ ?? false,
  nearH: NEAR_H,
  farH: FAR_H,
  anchorBone: null,
  followTauS: 0,
  frozen: o.frozen ?? false,
});

export const CAMERA_PRESET_PARAMS: Readonly<Record<CameraPresetId, CameraPresetParams>> =
  Object.freeze({
    /**
     * The default 360° play camera. User-controlled; its TARGET is a critically damped follow of
     * pelvis XZ at tau = 0.35 s with `y` locked, which is why `anchorBone` is `pelvis` while the
     * figure stays framed across the 3.78 m embusen.
     */
    ORBIT: persp('ORBIT', 39.6, [1.6, 0.95, 2.2], [0, 0, 0], {
      anchorBone: 'pelvis',
      followTauS: 0.35,
    }),
    /** The default LOOK. 35 mm equivalent. */
    HERO: persp('HERO', 39.6, [1.6, 0.95, 2.2], ORBIT_TARGET_H),
    /**
     * The "does it read as karate" camera: 50 mm, static, on the opening facing axis.
     * §5.7 gives it in metres — `(0, 1.55, +6.0)` — so it is divided by `H` here rather than
     * re-derived, which keeps the doc literals visible at the call site.
     */
    JUDGE: persp('JUDGE', 27.0, [0, 1.55 / H, 6.0 / H], [0, 0.55, 0]),
    /**
     * THE WEIGHT CAMERA. A low three-quarter is the one framing that exposes stance depth and head
     * bob in the same frame, which is why §5.7 puts it in the DEFAULT SHOT LIST and not just the
     * preset bar.
     */
    LOW34: persp('LOW34', 35.0, [1.3, 0.35, 1.7], [0, 0.45, 0]),
    /** Radius held, target tracks pelvis XZ with a 0.25 s critically damped lag. */
    FOLLOW: persp('FOLLOW', 39.6, [1.6, 0.95, 2.2], [0, 0, 0], {
      anchorBone: 'pelvis',
      followTauS: 0.25,
    }),
    /** Floor-pattern teaching view: straight down, up = `-Z`, ortho height 4.4 m. */
    EMBUSEN: ortho('EMBUSEN', 4.4 / H, [0, 4, 0], [0, 0, 0], { upIsMinusZ: true }),
    /** 85 mm on the acting fist — twist, candy-wrapper and the armpit collapse zone. */
    DETAIL_HANDS: persp(
      'DETAIL_HANDS',
      16.1,
      scaled(detailDir, DETAIL_HANDS_RADIUS_H),
      [0, 0, 0],
      { anchorBone: 'hand_R', followTauS: 0.12 },
    ),
    /** 85 mm on the front ankle — plant lock, heel contact, foot slide. */
    DETAIL_FEET: persp('DETAIL_FEET', 16.1, scaled(feetDir, DETAIL_FEET_RADIUS_H), [0, 0, 0], {
      anchorBone: 'foot_L',
      followTauS: 0.12,
    }),

    /* ── The four measurement cameras. FROZEN FOREVER, authored from `units.ts` (C16). ── */
    M_FRONT: ortho('M_FRONT', M_ORTHO_HEIGHT_H, M_FRONT_POS_H, [0, 0.5, 0], { frozen: true }),
    M_LEFT: ortho('M_LEFT', M_ORTHO_HEIGHT_H, M_LEFT_POS_H, [0, 0.5, 0], { frozen: true }),
    M_RIGHT: ortho('M_RIGHT', M_ORTHO_HEIGHT_H, M_RIGHT_POS_H, [0, 0.5, 0], { frozen: true }),
    M_TOP: ortho('M_TOP', M_ORTHO_HEIGHT_H, M_TOP_POS_H, [0, 0, 0], {
      upIsMinusZ: true,
      frozen: true,
    }),
  });

/**
 * The anchored presets, and what `posH` means for them. Exported so B6 cannot implement the
 * absolute reading by accident and so `tests/data/constants.test.ts` can assert the two classes
 * stay disjoint.
 */
export const CAMERA_ANCHORED: readonly CameraPresetId[] = Object.freeze(
  (Object.keys(CAMERA_PRESET_PARAMS) as CameraPresetId[]).filter(
    (id) => CAMERA_PRESET_PARAMS[id].anchorBone !== null,
  ),
);

/** `DETAIL_*` radii, exposed because B6 re-derives the framing when the anchor bone changes side. */
export const CAMERA_DETAIL_RADIUS_H = Object.freeze({
  hands: DETAIL_HANDS_RADIUS_H,
  feet: DETAIL_FEET_RADIUS_H,
});
