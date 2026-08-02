/**
 * B6 PLAYER — `src/player/cameraRig.ts`
 *
 * `createCameraRig` (§3.13) implementing the twelve presets of §5.7 behind the frozen `CameraRig`
 * seam of §3.12. Phase 1 needs exactly one of them to work — `ORBIT`, so the P1 exit gate
 * ("orbitable with the mouse") is reachable — but all twelve are wired here because the preset
 * TABLE is B1 data (`CAMERA_PRESET_PARAMS`) and interpreting that table is this file's whole job.
 * Leaving nine presets unimplemented would just move the interpretation somewhere else later.
 *
 * ═══ WHAT THIS FILE DECIDES, AND WHY ══════════════════════════════════════════════════════════
 *
 * 1. TWO CAMERA OBJECTS, NOT TWELVE. One `PerspectiveCamera` and one `OrthographicCamera`, reused
 *    across presets. `PostStack.setCamera` has to be called whenever the ACTIVE object changes
 *    identity (B5's handoff: it re-points RenderPass, GTAOPass and BokehPass and resets the still
 *    accumulator), so the number of identities is a cost, and two is the minimum that can express
 *    §5.7's persp/ortho split.
 *
 * 2. `posH` / `targetH` FOR AN ANCHORED PRESET ARE OFFSETS, NOT ABSOLUTES. That reading is
 *    normative — `src/data/constants/camera.ts`'s header states it and exports `CAMERA_ANCHORED`
 *    specifically so B6 "cannot implement the absolute reading by accident". The anchor is read out
 *    of `Landmarks.pos`, not off a `Bone`, because `CameraRig.update(dt, landmarks)` is the frozen
 *    signature and a landmark snapshot is the only pose the seam carries.
 *
 * 3. `ORBIT` AND `FOLLOW` LOCK THE TARGET'S Y. §5.7: "target = critically damped follow of pelvis
 *    XZ, tau = 0.35 s, y locked". So the followed point is `(pelvis.x, 0.55 H, pelvis.z)` —
 *    `ORBIT_TARGET_H`'s y — and `posH` is the offset from THAT point. A target that tracked pelvis y
 *    as well would bob the whole frame with the stance, which is exactly the artefact metric 17
 *    `head_bob_H` exists to catch; a camera that reproduces it makes the metric unreadable by eye.
 *
 * 4. A PRESET CHANGE ONLY BLENDS PERSP -> PERSP. §5.7 blends "position/target over 0.6 s with
 *    easeOutCubic, fov linear". There is no defined interpolation between a perspective frustum and
 *    an orthographic one — lerping the projection matrices is not a camera move, it is a smear — so
 *    any change that crosses the kind boundary SNAPS, and says so via `blending === false`.
 *    `snapTo` never blends at all: that is the harness path, and a blending camera makes captures
 *    non-deterministic (§5.7, §6.3).
 *
 * 5. THE FOUR `M_*` CAMERAS KEEP THEIR FROZEN FRUSTUM HEIGHT AT EVERY ASPECT. `orthoHeightH` is
 *    authoritative and the WIDTH follows the canvas aspect. At the harness's pinned 1024 x 1024
 *    that is exactly §5.7's 1:1 measurement frustum; on a wide interactive canvas the extra width is
 *    empty dojo, and every VERTICAL length metric read off the frame is unchanged. Scaling height by
 *    aspect instead would silently rescale every measurement with the browser window.
 *
 * ═══ TRAPS ════════════════════════════════════════════════════════════════════════════════════
 *   * `tools/verify-contracts.mjs` bans `rotation.y = -`, `position.x = -` and any second definition
 *     of `toWorld*` anywhere under `src/`. This file therefore never negates a component in place
 *     and never names a frame conversion; `CAMERA_PRESET_PARAMS` is already world-frame (C16).
 *   * `OrbitControls` mutates `camera.position` AND `controls.target`. Following a moving figure
 *     means translating BOTH by the same delta — writing `target` alone silently rotates the view.
 */

import { OrthographicCamera, PerspectiveCamera, TOUCH, Vector3, type Camera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  CANONICAL_FROM_BONE,
  CANONICAL_JOINTS,
  H,
  easeOutCubic,
  type CameraPresetId,
  type CameraRig,
  CANONICAL_INDEX,
  type Landmarks,
} from '../contracts';
import {
  CAMERA_BLEND_S,
  CAMERA_PRESET_PARAMS,
  ORBIT_CONTROLS,
  ORBIT_TARGET_H,
  type CameraPresetParams,
} from '../data';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Anchor resolution
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `BoneName` -> index into `Landmarks.pos`, for the three anchored presets (`pelvis`, `hand_R`,
 * `foot_L`). Built by inverting `CANONICAL_FROM_BONE`; the FIRST canonical joint wins, so `hand_R`
 * resolves to `RightHand` (the wrist) rather than to the virtual `RightFistCenter` that follows it.
 */
const ANCHOR_JOINT_INDEX: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < CANONICAL_JOINTS.length; i++) {
    const bone: string = CANONICAL_FROM_BONE[CANONICAL_JOINTS[i]];
    if (!(bone in m)) m[bone] = i;
  }
  return Object.freeze(m);
})();

/** Keys `1`..`9` of §6.7's keyboard map, in order. Additive presets are reachable from the barrel. */
export const CAMERA_KEY_ORDER: readonly CameraPresetId[] = Object.freeze([
  'ORBIT',
  'HERO',
  'JUDGE',
  'LOW34',
  'FOLLOW',
  'EMBUSEN',
  'DETAIL_HANDS',
  'DETAIL_FEET',
  'M_FRONT',
]);

/** The four frozen measurement cameras, in the order `M_TOP`'s cycle key walks them. */
export const CAMERA_MEASUREMENT_ORDER: readonly CameraPresetId[] = Object.freeze([
  'M_FRONT',
  'M_LEFT',
  'M_RIGHT',
  'M_TOP',
]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Public shape
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface CameraRigOpts {
  /**
   * The element `OrbitControls` listens on. `null`/omitted means NO controls at all — which is both
   * the harness requirement (`?harness=1` disables OrbitControls, §3.4.1) and what makes this module
   * importable in the GL-free Node channel.
   */
  readonly domElement?: HTMLElement | null;
  /** Canvas aspect (w / h). Defaults to 1, i.e. the harness framing. */
  readonly aspect?: number;
  /** Called when the ACTIVE camera object changes identity. Wire it to `PostStack.setCamera`. */
  readonly onCameraSwap?: (camera: Camera) => void;
  /** Called whenever the view matrix moved. Wire it to `PostStack.resetStill` (§5.3). */
  readonly onViewChange?: () => void;
}

export interface KataCameraRig extends CameraRig {
  /** `null` in harness/Node mode. Exposed so the composition root can hear its `change` event. */
  readonly controls: OrbitControls | null;
  /** True while a `setPreset` blend is in flight. Always false after `snapTo`. */
  readonly blending: boolean;
  readonly params: CameraPresetParams;
  setSize(width: number, height: number): void;
  dispose(): void;

  /**
   * HEADING-LOCKED FOLLOW, on the ORBIT camera only.
   *
   * ═══ WHAT IT ADDS, GIVEN ORBIT ALREADY FOLLOWS ═══════════════════════════════════════════════
   *
   * `update` already TRANSLATES the orbit target and the eye by the same delta, so the figure stays
   * centred while the user's azimuth, elevation and zoom survive him crossing the embusen. What it
   * does not do is turn with him — and a kata turns 90°, 180° and 270°, so a camera parked front-on
   * at count 1 is looking at his back by count 3.
   *
   * Enabled, the eye also ORBITS about the target by however much his heading changed, holding your
   * chosen angle RELATIVE TO HIM. Pick his front-left once and it stays his front-left for the whole
   * kata.
   *
   * Damped rather than rigid on purpose: a 270° turn applied to the camera in one frame is a whip
   * pan, and following it exactly is nauseating to watch. `FOLLOW_HEADING_TAU_S` lets the camera
   * lag and settle, which is what a human operator does.
   */
  setFollowHeading(on: boolean): void;
  readonly followHeading: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Implementation
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const UP_Y: readonly [number, number, number] = [0, 1, 0];

/**
 * Time constant for the heading-locked follow, seconds.
 *
 * 0.45 s puts roughly 90 % of a turn behind the camera within ~1 s — slower than the figure, which
 * is the point. A kata's fastest turn is doc 02's `T270` class at 2.05 s, and matching that exactly
 * would swing the whole room through frame; lagging it reads as an operator turning to keep up.
 */
const FOLLOW_HEADING_TAU_S = 0.45;

/** Below this the hip line is too short to have a direction — degenerate landmarks, not a pose. */
const FOLLOW_MIN_HIP_SPAN_M = 0.02;

/**
 * The figure's facing, in radians about +Y, read off `Landmarks`.
 *
 * ═══ THE HIP LINE, NOT THE FEET, AND NOT THE SHOULDERS ═══════════════════════════════════════
 *
 * Feet are the intuitive source and are now WRONG: the foot IK latches a planted foot to a fixed
 * world position, so a heel-to-toe vector stops rotating with the body while the latch holds.
 * Measured — rotating the root by exactly 90° moved a foot-derived facing by 133.6°, because one
 * foot came along and the locked one did not.
 *
 * Shoulders are wrong for a different reason: a karateka's shoulders counter-rotate against the
 * hips, and that counter-rotation IS the technique. A camera driven by them would sway on every
 * punch.
 *
 * The hip line turns when the stance turns and at no other time, and the IK only ever moves the
 * pelvis vertically, so it survives everything above.
 */
function facingFromLandmarks(l: Landmarks): number | null {
  const iL = CANONICAL_INDEX.LeftUpLeg * 3;
  const iR = CANONICAL_INDEX.RightUpLeg * 3;
  /* Right-ward along the hip line, flattened. */
  const rx = l.pos[iR]! - l.pos[iL]!;
  const rz = l.pos[iR + 2]! - l.pos[iL + 2]!;
  if (Math.hypot(rx, rz) < FOLLOW_MIN_HIP_SPAN_M) return null;
  /* forward = right x up, which for up = +Y is (-rz, 0, rx). */
  return Math.atan2(-rz, rx);
}

/** Shortest signed difference `to - from`, in radians. Kata headings wrap through 180°. */
function shortestAngleRad(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
/** §5.7: `up = -Z` for `M_TOP` and `EMBUSEN`, the two cameras that look straight down. */
const UP_MINUS_Z: readonly [number, number, number] = [0, 0, -1];

/** First-order critically damped step. `tau = 0` is rigid. */
const dampAlpha = (dt: number, tauS: number): number =>
  tauS <= 0 ? 1 : 1 - Math.exp(-dt / tauS);

export function createCameraRig(o: CameraRigOpts = {}): KataCameraRig {
  let aspect = o.aspect !== undefined && o.aspect > 0 ? o.aspect : 1;

  const persp = new PerspectiveCamera(
    CAMERA_PRESET_PARAMS.ORBIT.fovDeg,
    aspect,
    CAMERA_PRESET_PARAMS.ORBIT.nearH * H,
    CAMERA_PRESET_PARAMS.ORBIT.farH * H,
  );
  persp.name = 'camera.persp';

  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  ortho.name = 'camera.ortho';

  let active: CameraPresetId = 'ORBIT';
  let params: CameraPresetParams = CAMERA_PRESET_PARAMS[active];
  let current: PerspectiveCamera | OrthographicCamera = persp;

  /* Scratch. `update` runs every frame; §6.6 budgets 0.02 ms, so it allocates nothing. */
  const _anchor = new Vector3();
  const _base = new Vector3();
  const _pos = new Vector3();
  const _target = new Vector3();
  const _delta = new Vector3();

  /** The damped follow point for every anchored preset. Seeded to the bind-pose target. */
  const follow = new Vector3(0, ORBIT_TARGET_H[1] * H, 0);
  /** The aim point of the non-orbit presets, so `lookAt` and the blend agree on one value. */
  const aim = new Vector3(0, ORBIT_TARGET_H[1] * H, 0);
  /**
   * The last pose `update` was given. `snapTo` has no landmarks parameter (§3.12 froze it), and a
   * snap that slid into its anchor over the following second would be both visible and
   * non-deterministic — the harness snaps and then captures. So the last pose is cached and the
   * damped follow is short-circuited to alpha = 1 on any preset change.
   */
  let lastLandmarks: Landmarks | null = null;
  let anchorDirty = true;

  /* Blend state (§5.7: 0.6 s, easeOutCubic on position/target, linear on fov). */
  let blendT = 1;
  /** Heading-locked follow, ORBIT only. See `setFollowHeading`. */
  /**
   * ON by default.
   *
   * Off, the camera holds a fixed compass bearing while the kata turns 90, 180 and 270 degrees
   * beneath it — so a view framed front-on at count 1 is looking at the karateka's back by count 3,
   * and the viewer has to chase him with a drag to see anything. On, the chosen angle is held
   * RELATIVE to him and the kata reads from one consistent side without touching the camera.
   *
   * `f` still turns it off, which is what you want for studying the FLOOR PATTERN — the embusen is
   * a fixed shape in the room and only a room-fixed camera shows it as one.
   */
  let followHeading = true;
  /** The figure's facing last frame; `null` until the first usable reading. */
  let lastFacingRad: number | null = null;
  /** Turn the figure has made that the camera has not caught up with yet, radians. */
  let pendingYawRad = 0;
  const fromPos = new Vector3();
  const fromAim = new Vector3();
  let fromFov = persp.fov;

  const controls: OrbitControls | null =
    o.domElement != null ? new OrbitControls(persp, o.domElement) : null;
  if (controls !== null) {
    controls.enableDamping = ORBIT_CONTROLS.enableDamping;
    controls.dampingFactor = ORBIT_CONTROLS.dampingFactor;
    controls.minDistance = ORBIT_CONTROLS.minDistanceM;
    controls.maxDistance = ORBIT_CONTROLS.maxDistanceM;
    controls.minPolarAngle = ORBIT_CONTROLS.minPolarAngleRad;
    controls.maxPolarAngle = ORBIT_CONTROLS.maxPolarAngleRad;
    controls.screenSpacePanning = false;

    /**
     * ═══ PAN IS OFF, AND NOT AS A PREFERENCE ═══════════════════════════════════════════════════
     *
     * It cannot work here, and leaving it on is actively worse than removing it. `update` follows
     * the karateka by re-deriving `controls.target` from the damped follow point every frame and
     * translating the eye by the same delta (see the ORBIT branch). A pan moves target and eye
     * together by `p`; the very next frame measures `_delta = _target - controls.target = -p` and
     * puts both back. So the gesture is undone one frame after it is made — visible as a twitch,
     * never as a pan.
     *
     * That matters most on touch, because the two-finger drag is not an obscure gesture here: it IS
     * the pinch-zoom (`TOUCH.DOLLY_PAN` below), and every pinch carries some translation with it.
     * With pan enabled, zooming in on a phone jitters the whole dojo on every frame of the gesture.
     *
     * The camera is never left without a way to recentre: it is ALWAYS framed on the figure by
     * construction, which is what pan would otherwise be used to fix.
     */
    controls.enablePan = false;

    /**
     * ═══ THE TOUCH GESTURE MAP IS PINNED, NOT INHERITED ════════════════════════════════════════
     *
     * These two lines are three's current defaults, written out on purpose. One-finger-orbit is not
     * a nicety of this product, it is the product — "a 360-degree kata viewer" is a promise about
     * exactly this gesture — and it reaches OrbitControls only because `#kata-canvas` sets
     * `touch-action: none`, which is itself a line in another file that looks deletable. Pinning the
     * map here means a three upgrade that re-tunes its defaults (the mouse map has been re-tuned
     * before) shows up as a diff on this file rather than as a viewer that silently stops rotating
     * under a finger, which is a symptom nobody debugs by reading a changelog.
     *
     * `DOLLY_PAN` and not `DOLLY_ROTATE` for the two-finger case even though pan is disabled above:
     * `DOLLY_ROTATE` would make a two-finger twist rotate the camera as well, so a pinch aimed at
     * zooming would also swing the view — the same complaint the pan jitter caused, from the other
     * direction. With pan off, `DOLLY_PAN` degrades to a clean pinch-zoom and nothing else.
     */
    controls.touches.ONE = TOUCH.ROTATE;
    controls.touches.TWO = TOUCH.DOLLY_PAN;
  }

  const viewChanged = (): void => {
    o.onViewChange?.();
  };

  /**
   * The anchor point a preset is measured from, in world metres.
   *  - static preset  -> the world origin, so `posH`/`targetH` read as absolutes;
   *  - ORBIT / FOLLOW -> the DAMPED follow point, with y locked to `ORBIT_TARGET_H`;
   *  - DETAIL_*       -> the damped anchor-bone position, all three components.
   */
  function resolveAnchor(p: CameraPresetParams, dt: number): void {
    if (p.anchorBone === null) {
      _anchor.set(0, 0, 0);
      return;
    }
    const idx = ANCHOR_JOINT_INDEX[p.anchorBone];
    const lm = lastLandmarks;
    if (lm === null || idx === undefined) {
      // No pose yet: fall back to the locked target so the first frame is still framed on the figure.
      _base.set(0, ORBIT_TARGET_H[1] * H, 0);
    } else {
      _base.set(lm.pos[idx * 3], lm.pos[idx * 3 + 1], lm.pos[idx * 3 + 2]);
      if (p.id === 'ORBIT' || p.id === 'FOLLOW') _base.setY(ORBIT_TARGET_H[1] * H);
    }
    follow.lerp(_base, anchorDirty ? 1 : dampAlpha(dt, p.followTauS));
    anchorDirty = false;
    _anchor.copy(follow);
  }

  /** Writes the preset's world position and aim point into `_pos` / `_target`. */
  function resolvePose(p: CameraPresetParams): void {
    _pos.set(p.posH[0] * H, p.posH[1] * H, p.posH[2] * H).add(_anchor);
    _target.set(p.targetH[0] * H, p.targetH[1] * H, p.targetH[2] * H).add(_anchor);
  }

  function applyFrustum(p: CameraPresetParams): void {
    if (p.kind === 'persp') {
      persp.fov = p.fovDeg ?? 39.6;
      persp.aspect = aspect;
      persp.near = p.nearH * H;
      persp.far = p.farH * H;
      persp.updateProjectionMatrix();
      return;
    }
    // Height is authoritative; width follows the aspect. See decision 5 in the header.
    const halfH = ((p.orthoHeightH ?? 2.2) * H) / 2;
    const halfW = halfH * aspect;
    ortho.left = -halfW;
    ortho.right = halfW;
    ortho.top = halfH;
    ortho.bottom = -halfH;
    ortho.near = p.nearH * H;
    ortho.far = p.farH * H;
    ortho.updateProjectionMatrix();
  }

  function selectCamera(p: CameraPresetParams): void {
    const next: PerspectiveCamera | OrthographicCamera = p.kind === 'persp' ? persp : ortho;
    const up = p.upIsMinusZ ? UP_MINUS_Z : UP_Y;
    next.up.set(up[0], up[1], up[2]);
    if (next !== current) {
      current = next;
      o.onCameraSwap?.(current);
    }
  }

  /** Places the active camera exactly, with no blend. */
  function place(p: CameraPresetParams): void {
    selectCamera(p);
    applyFrustum(p);
    current.position.copy(_pos);
    aim.copy(_target);
    current.lookAt(aim);
    if (controls !== null) {
      controls.enabled = p.id === 'ORBIT' && blendT >= 1;
      if (p.id === 'ORBIT') controls.target.copy(aim);
    }
    viewChanged();
  }

  /* Seed the initial ORBIT pose. `follow` already holds the locked bind-pose target. */
  resolveAnchor(params, 1);
  resolvePose(params);
  place(params);

  const rig: KataCameraRig = {
    get active() {
      return active;
    },
    get params() {
      return params;
    },
    get camera(): Camera {
      return current;
    },
    get controls() {
      return controls;
    },
    get blending() {
      return blendT < 1;
    },

    setPreset(id): void {
      if (id === active) return;
      const next = CAMERA_PRESET_PARAMS[id];
      const crossesKind = next.kind !== params.kind;
      if (crossesKind) {
        rig.snapTo(id);
        return;
      }
      // Freeze where we are NOW (OrbitControls may have moved us) as the blend origin.
      fromPos.copy(current.position);
      fromAim.copy(aim);
      fromFov = persp.fov;
      active = id;
      params = next;
      blendT = 0;
      anchorDirty = true;
      if (controls !== null) controls.enabled = false;
    },

    snapTo(id): void {
      active = id;
      params = CAMERA_PRESET_PARAMS[id];
      blendT = 1;
      anchorDirty = true;
      resolveAnchor(params, 1);
      resolvePose(params);
      place(params);
    },

    update(dtSeconds, landmarks): void {
      // A tab-switch hands back a multi-second delta; clamping keeps the damped follow stable.
      const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? Math.min(dtSeconds, 0.25) : 0;
      lastLandmarks = landmarks;
      resolveAnchor(params, dt);
      resolvePose(params);

      if (blendT < 1) {
        blendT = Math.min(1, blendT + (CAMERA_BLEND_S > 0 ? dt / CAMERA_BLEND_S : 1));
        const u = easeOutCubic(blendT);
        selectCamera(params);
        persp.fov = fromFov + ((params.fovDeg ?? fromFov) - fromFov) * blendT; // linear on fov
        persp.aspect = aspect;
        persp.near = params.nearH * H;
        persp.far = params.farH * H;
        persp.updateProjectionMatrix();
        current.position.lerpVectors(fromPos, _pos, u);
        aim.lerpVectors(fromAim, _target, u);
        current.lookAt(aim);
        if (blendT >= 1 && controls !== null) {
          controls.enabled = params.id === 'ORBIT';
          if (params.id === 'ORBIT') controls.target.copy(aim);
        }
        viewChanged();
        return;
      }

      if (active === 'ORBIT' && controls !== null) {
        // Follow by TRANSLATING both the orbit target and the eye by the same delta, so the user's
        // azimuth/elevation/zoom survive the figure moving across the embusen.
        _delta.subVectors(_target, controls.target);
        if (_delta.lengthSq() > 0) {
          controls.target.add(_delta);
          persp.position.add(_delta);
        }

        /* ── heading lock: orbit the eye by however much HE turned ──────────────────────────
         *
         * Translation above keeps him centred; this keeps him at the same ANGLE. The turn is
         * accumulated and released through a first-order lag rather than applied outright, so a
         * 180° count does not whip the room through frame in one step. `pendingYawRad` is the
         * debt: it holds whatever the camera still owes, so no rotation is ever dropped, only
         * deferred. */
        if (followHeading) {
          const facing = facingFromLandmarks(landmarks);
          if (facing !== null) {
            if (lastFacingRad !== null) {
              pendingYawRad += shortestAngleRad(lastFacingRad, facing);
            }
            lastFacingRad = facing;
          }
          if (dt > 0 && Math.abs(pendingYawRad) > 1e-6) {
            const step = pendingYawRad * (1 - Math.exp(-dt / FOLLOW_HEADING_TAU_S));
            pendingYawRad -= step;
            const ox = persp.position.x - controls.target.x;
            const oz = persp.position.z - controls.target.z;
            const c = Math.cos(step);
            const sn = Math.sin(step);
            /* +`step` about +Y. With azimuth read as `atan2(x, z)`, the pair below advances it BY
             * `step`; the transposed pair retards it, which is the sign this first shipped with —
             * the camera turned the wrong way out of every count. */
            persp.position.x = controls.target.x + (ox * c + oz * sn);
            persp.position.z = controls.target.z + (oz * c - ox * sn);
            viewChanged();
          }
        }

        aim.copy(controls.target);
        controls.update(dt);
        return;
      }

      // Static and anchored non-orbit presets: place exactly every frame. Cheap, and it means a
      // DETAIL_* camera cannot drift out of sync with its anchor.
      selectCamera(params);
      applyFrustum(params);
      current.position.copy(_pos);
      aim.copy(_target);
      current.lookAt(aim);
    },

    setFollowHeading(on: boolean): void {
      if (on === followHeading) return;
      followHeading = on;
      /* Re-seed rather than carry a stale reading across the gap: while OFF the figure keeps
       * turning, and a difference measured against a facing from thirty seconds ago would spin the
       * camera on the frame it is switched back on. */
      lastFacingRad = lastLandmarks === null ? null : facingFromLandmarks(lastLandmarks);
      pendingYawRad = 0;
    },
    get followHeading(): boolean {
      return followHeading;
    },

    setSize(width, height): void {
      const a = width > 0 && height > 0 ? width / height : 1;
      if (a === aspect) return;
      aspect = a;
      applyFrustum(params);
      viewChanged();
    },

    dispose(): void {
      controls?.dispose();
    },
  };

  return rig;
}
