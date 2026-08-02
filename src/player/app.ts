/**
 * B6 PLAYER — `src/player/app.ts` — THE COMPOSITION ROOT (Phase-1 subset)
 *
 * §4.6 makes this "the only file importing every barrel", and §8's Phase-1 exit gate is
 * "`npm run dev` shows the procedural karateka standing at bind pose in the lit dojo with a visible
 * contact shadow". This file is what makes that gate reachable.
 *
 * ═══ WHY THE COMPOSITION IS HERE AND NOT IN `src/main.ts` ═════════════════════════════════════
 *
 * `src/main.ts` MAY NOT IMPORT `three` — AT ALL, not even `import type`. `tests/contracts/
 * imports.test.ts` computes a file's ownership tree with `treeOf`, which returns `null` for any path
 * with fewer than three segments (`src/main.ts` has two). The three-containment check then falls
 * back to the pseudo-tree `'src'`, which is on none of its three lists — free, math-only, or banned
 * — so it lands in the final `else` and is reported as "tree src is not on the three allowlist".
 * The allowlist is `src/rig`, `src/render`, `src/player`, `src/ui`.
 *
 * That is not a bug to work around: it is what forces the entry point to stay a URL-parameter shim,
 * which is exactly how §4.6 describes it ("entry; URL params"). Every line that touches a renderer,
 * a scene or a camera therefore lives under `src/player/**`, and this is the file §4.6 nominates.
 *
 * ═══ WHAT IS DELIBERATELY *NOT* HERE ═════════════════════════════════════════════════════════
 *
 * `bootApp(o: BootOpts): Promise<AppHandle>` — §3.13's frozen entry point — is NOT exported yet, and
 * that is on purpose. `AppHandle` requires `transport`, `source`, `cloth` and `weights`, and all four
 * are downstream of B3's `compileKata`, which does not exist before Phase 2. Shipping a `bootApp`
 * that returned a half-populated `AppHandle` would let a downstream block bind to it and typecheck,
 * which is worse than not having it: the missing pieces would surface as runtime holes instead of as
 * a compile error. `bootStage` below is a NARROWER, differently-named Phase-1 function; Phase 2 adds
 * `bootApp` beside it (transport + sampler + poseApply + loop + harness) and this becomes its
 * scene-building half.
 *
 * ═══ BOOT ORDER IS §5.1, IN ORDER ════════════════════════════════════════════════════════════
 *
 *   renderer -> scene -> IBL (PMREM) -> lights (+ shadow) -> materials -> stage -> karateka ->
 *   camera -> composer -> compileAsync -> setAnimationLoop
 *
 * The order is load-bearing in three places: `sheen` is nearly invisible without
 * `scene.environment` (doc 05 §14.1 #14) so the IBL precedes anything that reads it; `buildLights`
 * calls `configureShadow` internally so the shadow camera exists before `refitShadow`; and
 * `compileAsync` must see the FINAL scene graph or the first frame stalls on shader compilation
 * while the still accumulator is already integrating.
 */

import { Scene, Timer, type AnimationAction, type Camera, type WebGLRenderer } from 'three';

import {
  BONE_COUNT,
  CHANNEL_COUNT,
  DISPLAY_TICKS,
  LAYER_WEIGHTS_DEFAULT,
  RATE_MAX,
  RATE_MIN,
  TICK_HZ,
  type CameraPresetId,
  type KataId,
  type Landmarks,
  type PoseFrame,
  type PoseTrack,
  type RigHandles,
  type TempoTier,
} from '../contracts';
import { CAMERA_PRESET_PARAMS, POST, getKata } from '../data';
import { STAGES, STAGE_MASK_FULL, compileKata } from '../solve';

/** One stage's `stageMask` bit, by id. Throws on a typo rather than silently masking nothing. */
const stageBit = (id: string): number => {
  const s = STAGES.find((x) => x.id === id);
  if (s === undefined) throw new Error(`bootStage: no compile stage '${id}'`);
  return s.bit;
};
/* Intra-block, so a deep path is legal here (`tests/contracts/imports.test.ts` restricts only
 * CROSS-tree imports). Going through `./index` would be a cycle: the barrel re-exports this file. */
import { createSampler } from './sampler';
import { applyPose } from './poseApply';
import { loadCharacter, type Character } from './character';
import { buildChoreography, type Beat, type Choreography } from './choreography';
import { sampleCharacterLandmarks } from './characterLandmarks';
import { addBvhClip } from './retarget';
import { createFootIk, type FootIk } from './footIk';
import { createHandShaper, type HandShaper } from './handShape';
import { attachGi, type GiHandle } from './gi';
import { attachFacialHair, type FacialHairHandle } from './facialHair';
import {
  buildKarateka,
  createLandmarks,
  karatekaStats,
  sampleLandmarks,
  type KaratekaStats,
} from '../rig';
import {
  buildEnvironment,
  buildLights,
  buildStage,
  buildDojoProps,
  buildPost,
  createMaterials,
  disposeLights,
  disposeMaterials,
  disposeDojoProps,
  disposeStage,
  refitShadow,
  stageClipBox,
  createRenderer,
  type IblHandle,
  type KataPostStack,
  type LightRig,
  type MaterialSet,
  type StageHandle,
} from '../render';
import { CAMERA_KEY_ORDER, CAMERA_MEASUREMENT_ORDER, createCameraRig, type KataCameraRig } from './cameraRig';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Options and handle
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface StageBootOpts {
  readonly canvas: HTMLCanvasElement;
  /** §6.6 quality tiers. `low` drops GTAO and bloom — the SwiftShader smoke path. */
  readonly quality?: 'low' | 'high' | 'max';
  /** `?harness=1`: pins 1024 x 1024 at DPR 1 and disables OrbitControls (§3.4.1). */
  readonly harness?: boolean;
  /** Keyboard camera presets and pointer wiring. Off in harness mode regardless. */
  readonly interactive?: boolean;
  /**
   * Hand the view to `StillAccumulator` once the user stops moving (§5.3's progressive still).
   * DEFAULT FALSE, and the reason is measured — see `IDLE_BEFORE_STILL_S` below. Harness mode
   * ignores this and always accumulates, because a capture only ever reads the CONVERGED frame.
   */
  readonly progressiveStill?: boolean;
  /**
   * Compile this kata and play it. Omit for the Phase-1 static bind-pose view.
   *
   * The compile is SYNCHRONOUS and currently costs seconds, not the §4.11 target of 220 ms — it
   * runs 6 800 full-body solves plus a 480 Hz probe pass. That is a real gap and it is a
   * PERFORMANCE gap, not a correctness one; boot shows a status line rather than pretending the
   * page is idle.
   */
  readonly kataId?: KataId;
  readonly tempoTier?: TempoTier;
  readonly startTick?: number;
  /** Start playing immediately. `false` boots paused on `startTick`, which is what a capture wants. */
  readonly autoplay?: boolean;
  /** Called before the compile so the caller can put something on screen first. */
  readonly onCompileStart?: (kataId: KataId) => void;
  /**
   * Called when a strict compile fails a stage gate and the boot falls back to an ADVISORY
   * compile (§4.11's `stageMask`). The track still renders; it is not gate-clean. A caller that
   * ignores this is showing a figure it has been told is wrong.
   */
  readonly onGateFail?: (message: string) => void;
  /**
   * Render the RIGGED, CLIP-DRIVEN character (`public/models/*.glb`) instead of the procedural
   * figure driven by `compileKata`. Default true — see the header of `./character.ts` for why the
   * procedural path was retired from the render path.
   *
   * `false` restores the Phase-2 behaviour, which is still the only way to LOOK at what the solver
   * produces. `?rig=proc` sets it.
   */
  readonly proceduralRig?: boolean;
  /** Override the character/clip glTF. `?model=Xbot.glb` sets it. */
  readonly modelUrl?: string;
  /** Fired when `[` / `]` auditions a different clip, so the caller can label it on screen. */
  readonly onClipChange?: (name: string, index: number, total: number) => void;
  /** Fired when the kata advances to a new count or ceremony phase. */
  readonly onBeatChange?: (label: string, kiai: boolean, index: number) => void;
  /** Fired when the heading-locked follow camera is toggled, so a HUD can reflect it. */
  readonly onFollowCamChange?: (on: boolean) => void;
  /** Open on the score-driven kata instead of the continuous capture. `?view=score` sets it. */
  readonly scoreView?: boolean;
  /** Which clip the continuous view opens on. Defaults to the retargeted Shotokan capture. */
  readonly startClip?: string;
}

/**
 * Quaternius's CC0 Universal Animation Library — one self-contained glTF carrying a rigged mesh AND
 * 46 clips on the same Rigify skeleton, so it needs no retargeting step at all. Its `Punch_Jab`,
 * `Punch_Cross` and `Punch_Enter` are the first real recorded strikes in the project.
 *
 * `Xbot.glb` remains beside it as the Mixamo-skeleton option: fewer clips (7), but any Mixamo FBX
 * in existence retargets onto it by name, which is the path to actual Shotokan technique clips.
 */
export const DEFAULT_MODEL_URL = 'models/AnimLib.glb';

/**
 * Motion-capture files retargeted onto the character at boot.
 *
 * `startS`/`endS` slice one capture into named techniques — a mocap take is a continuous
 * performance, not a clip library, so the ranges are how a 21.7 s session becomes usable pieces.
 * Left unset the whole take is registered under one name, which is the right starting point before
 * anyone has looked at where its techniques actually fall.
 */
export const MOCAP_CLIPS: readonly {
  readonly name: string;
  readonly url: string;
  readonly startS?: number;
  readonly endS?: number;
  /**
   * Whether the capture's own floor travel is kept.
   *
   * ═══ IT DEPENDS ON WHO OWNS THE TRAVEL ══════════════════════════════════════════════════════
   *
   * A clip the KATA SCORE drives must not translate: the score already lerps the root along the
   * embusen, and a clip that also moved would fight it. A clip played WHOLE has no score behind it,
   * so dropping its horizontal motion strands the performer — he steps through the entire kata
   * without going anywhere, feet cycling on the spot.
   *
   * So it is per-entry, not global: `'full'` for a complete performance, the `'y'` default for the
   * technique slices the score triggers.
   */
  readonly rootMotion?: 'none' | 'y' | 'full';
}[] = Object.freeze([
  /* Real Shotokan — Heian Nidan, 20 joints at 100 Hz, from an academic capture. The whole
   * technique vocabulary of the Heian series is in here: gedan-barai, oi-zuki, age-uke, shuto-uke. */
  { name: 'heian-nidan', url: 'models/mocap/heian-nidan.bvh', rootMotion: 'full' },

  /* ── individual techniques, sliced out of that take ────────────────────────────────────────
   *
   * The windows were CHOSEN BY MEASUREMENT, not by eye. Every instant where a hand reaches ≥86 %
   * arm extension and is a local maximum was collected — 31 across the take — and each scored on
   * how its hand moved over the preceding 0.5 s, relative to the pelvis and to the direction the
   * feet point:
   *
   *   oi-zuki      t=0.44  chudan height (+0.23 m), driving FORWARD (+0.16 m) and LEVEL (+0.04 m)
   *   gedan-barai  t=22.96 DESCENDS 0.59 m while sweeping 0.47 m forward — the strongest downward
   *                        sweep in the take, which is what a gedan-barai is
   *
   * Windows open ~0.9 s before kime so the wind-up is included; a technique that begins at its
   * own impact reads as a twitch. Between the two they cover all 20 counts of Taikyoku Shodan. */
  { name: 'mocap-oi-zuki', url: 'models/mocap/heian-nidan.bvh', startS: 1.35, endS: 2.6 },
  /* Kept only to audition. A BVH parser's test fixture — see the source-quality note in
   * `./retarget.ts`. Not wired into any technique. */
  { name: 'karate', url: 'models/mocap/karate.bvh' },
]);

/** Numbers the self-verification pass and the HUD read. Not a frozen interface. */
export interface StageStats {
  /** Whole-frame draw calls: scene + every post pass. NOT §5.6's scene budget — see `sceneMeshes`. */
  readonly drawCalls: number;
  readonly triangles: number;
  /** Opaque scene meshes, i.e. what §5.6's draw-call budget counts. */
  readonly sceneMeshes: number;
  readonly programs: number;
  readonly bones: number;
  readonly passes: readonly string[];
  readonly quality: string;
  readonly mode: string;
  readonly stillSample: number;
  readonly stillConverged: boolean;
  readonly camera: string;
  readonly canvasPx: readonly [number, number];
  readonly dpr: number;
  readonly frameMs: number;
  readonly karateka: KaratekaStats | null;
}

/**
 * The Phase-2 playback surface.
 *
 * Deliberately NOT `AppHandle` (§3.13): that shape also requires `cloth` and `weights`, and B7
 * does not exist yet. This is the honest subset — a compiled track, a sampler over it, and a
 * cursor — under a name that cannot be mistaken for the frozen one.
 */
export interface StageTransport {
  readonly track: PoseTrack;
  /** Current integer tick. Always inside `[0, durationTicks)`. */
  tick: number;
  playing: boolean;
  /** Jump to an exact tick. Path-independent by construction (§6.1). */
  seek(tick: number): void;
  toggle(): void;
  /** Playback rate multiplier. doc 02 §9 d10's 0.58x–1.05x range lives here. */
  rate: number;
}

export interface StageBoot {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly materials: MaterialSet;
  readonly ibl: IblHandle;
  readonly lights: LightRig;
  readonly stage: StageHandle;
  readonly rig: RigHandles;
  /** The clip-driven figure. `null` under `?rig=proc`, where `rig` is what you see instead. */
  readonly character: Character | null;
  /**
   * The hand-shape pass. Exposed where `footIk` is not, because it is the only one of the two whose
   * result cannot be read off the scene at all: a foot is either through the floor or it is not,
   * while "is that a fist" needs the module's own `stats` to say which shape it believes it is
   * holding, on which hand, and whether it resolved a palm plane for that hand in the first place.
   * `setEnabled` is also the only way to look at the un-shaped hand for comparison.
   */
  readonly handShaper: HandShaper | null;
  /** B2's score driving that figure. `null` without a `kataId`, or on the procedural path. */
  readonly choreography: Choreography | null;
  readonly cameraRig: KataCameraRig;
  readonly post: KataPostStack;
  readonly landmarks: Landmarks;
  /** `null` when `bootStage` was called without a `kataId` — the Phase-1 static-pose path. */
  readonly transport: StageTransport | null;
  setCameraPreset(id: string, exact?: boolean): void;
  stats(): StageStats;
  dispose(): void;

  /* ── kata transport, for a HUD to drive instead of the keyboard ─────────────────────────── */
  /** Jump to a beat by index and hold there. Out-of-range wraps, matching the arrow keys. */
  goToBeat(index: number): void;
  /** `undefined` toggles. */
  setPlaying(play?: boolean): void;
  readonly playing: boolean;
  /** Index of the beat currently showing, or `-1` without a kata. */
  readonly beatIndex: number;
  /**
   * Play ONE clip on loop, suspending the kata score — the only way to watch a raw or retargeted
   * clip end to end. `null` hands control back to the score.
   */
  soloClip(name: string | null): void;
  /** The clip being auditioned, or `null` when the score is driving. */
  readonly solo: string | null;

  /**
   * Heading-locked follow on the ORBIT camera: hold the chosen angle RELATIVE to the karateka as he
   * turns, instead of only tracking his position. `f` toggles it. See `KataCameraRig.setFollowHeading`.
   */
  setFollowCam(on?: boolean): void;
  readonly followCam: boolean;

  /* ── frame-accurate transport, over WHICHEVER view is on screen ─────────────────────────────
   *
   * ═══ ONE CLOCK, TWO VIEWS ══════════════════════════════════════════════════════════════════
   *
   * The two playback modes advance completely different things — the continuous view is an
   * `AnimationAction` ticked by `character.mixer`, the score view is the `kataTimeS` accumulator
   * that positions the root and picks clips — and until now only the second one had a pause. The
   * fix is not two transports but one delta: every frame, exactly one number of clip-seconds is
   * produced (from `dt * rate` while playing, or from a queued step while paused) and handed to
   * BOTH consumers. Frame stepping, slow motion and pause then mean the same thing in both views
   * by construction, instead of by two implementations agreeing.
   *
   * Everything below reports and drives SECONDS, not ticks: `StageTransport.tick` above is the
   * procedural solver's clock and exists only under `?rig=proc`, which renders nothing the clip
   * path shows. */
  /** Seconds one `stepDisplayFrames(1)` covers — `DISPLAY_FRAME_S`. */
  readonly frameSeconds: number;
  /** Length of what is playing: the auditioned clip's duration, or the whole score's. */
  readonly durationSeconds: number;
  /** Position inside that, always in `[0, durationSeconds)`. */
  readonly currentSeconds: number;
  /** Jump to an absolute second and HOLD there. Pauses, exactly as `goToBeat` does. */
  seekSeconds(t: number): void;
  /**
   * Step `n` display frames and hold. §3.12's `Transport` froze this name for the same operation
   * on the procedural clock; reusing it keeps one verb for one idea across both.
   */
  stepDisplayFrames(n: number): void;
  /** Playback speed multiplier, clamped to §6.7's `RATE_MIN`…`RATE_MAX`. Negative runs backwards. */
  setRate(r: number): void;
  readonly rate: number;
}

/**
 * ═══ ONE DISPLAY FRAME — 1/60 s, NOT THE CAPTURE'S 1/100 ═════════════════════════════════════
 *
 * Two grids exist and they disagree: `heian-nidan.bvh` was captured at 100 Hz, and the page renders
 * at the display's ~60 Hz. Three reasons the step is the DISPLAY frame:
 *
 *   1. It is the only grid both views have. The score view has no capture frames at all — it is a
 *      continuous root lerp plus crossfades — so a 100 Hz step would be meaningful in the mocap
 *      view and arbitrary in the other, and the whole point of this transport is that one button
 *      means one thing in both.
 *   2. 1/60 s > 1/100 s, so every step crosses at least one captured key. Stepping the finer grid
 *      would produce presses that land between two rendered images and look like a dropped click;
 *      stepping the coarser one cannot.
 *   3. B0 already froze it. `DISPLAY_TICKS = 64` at `TICK_HZ = 3840` is exactly 1/60 s, it is what
 *      §3.12's `stepDisplayFrames` means, and it is what the existing `←`/`→` keys already move the
 *      procedural transport by. A second, differently-sized "frame" in the same app would be a bug
 *      generator.
 *
 * Derived from the frozen constants rather than written as `1 / 60`, so it cannot drift from them.
 */
export const DISPLAY_FRAME_S = DISPLAY_TICKS / TICK_HZ;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Boot
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Seconds of no interaction before the still accumulator takes over, WHEN it is enabled.
 *
 * ═══ WHY `progressiveStill` DEFAULTS TO FALSE — MEASURED, NOT PREFERENCE ══════════════════════
 *
 * `StillAccumulator.accumulate` blits each sample with a FIXED weight `1 / samples`
 * (`still.ts:382`), and `present()` blits the accumulation target RAW (`still.ts:398-405`). So after
 * `k` of `N` samples the screen shows `k/N` of the correct exposure: at `k = 1` that is 3 % of
 * full brightness — near black — reaching correct exposure only at `k = N`.
 *
 * At convergence the sum of weights is exactly 1, so the CONVERGED still and every captured PNG are
 * correct, which is why B5's own tests and browser check are green: they measure at `k = N`. The
 * defect is confined to the INTERACTIVE progressive path, and B6 is the only block that drives it.
 * Observed with real pixels: a frame grabbed mid-accumulation reads `lumaMean 14.65` against
 * `113.91` for the same converged view — a 7.8x under-exposure, i.e. every mouse-stop would fade the
 * dojo up from black over 32 display frames (0.53 s at 60 fps; ~30 s under SwiftShader).
 *
 * A progressive present has to normalise by the samples accumulated SO FAR (`1/k`), not by the
 * final count. That is a one-line change in `present()` — B5's file, so it is a handoff, and this
 * flag is the fence until it lands. `?still=1` opts in for anyone wanting to look at a converged
 * frame interactively.
 */
const IDLE_BEFORE_STILL_S = 0.35;

export async function bootStage(o: StageBootOpts): Promise<StageBoot> {
  const harness = o.harness === true;
  const interactive = harness ? false : o.interactive !== false;
  const progressiveStill = harness || o.progressiveStill === true;
  const quality = o.quality ?? 'high';

  /* ── §5.1 [1] renderer ────────────────────────────────────────────────────────────────────── */
  const renderer = createRenderer(o.canvas, { harness });
  // `info` resets itself at the start of EVERY renderer.render(), and a still frame ends with the
  // accumulator's one-quad present() — so an unmanaged read reports `calls: 1`, which is a lie about
  // §5.6's draw budget. Reset once per frame instead and read the whole frame's total.
  renderer.info.autoReset = false;

  /* ── §5.1 [2] scene ──────────────────────────────────────────────────────────────────────── */
  const scene = new Scene();
  scene.name = 'dojo';

  /* ── §5.1 [3] IBL. BEFORE any material that reads it (doc 05 §14.1 #14). ─────────────────── */
  const ibl = buildEnvironment(renderer, scene);

  /* ── §5.1 [4] lights. `buildLights` adds all four targets and configures KEY's shadow. ───── */
  const lights = buildLights(scene);

  /* ── §5.1 [5] materials, then the stage that owns the floor maps ──────────────────────────── */
  const materials = createMaterials();
  const stage = buildStage(scene, materials);
  /**
   * The hall's furniture. Parented to `stage.backdrop` inside `buildDojoProps`, not to the scene —
   * see its header for why (metric 60's mask hides the stage by reference).
   *
   * NON-FATAL, like the gi and the mocap before it. A dojo with no benches is a worse-looking app;
   * a dojo that refuses to boot is no app at all, and decoration has no business being able to
   * cause the second. Observed: a mid-edit `props.ts` threw and took the whole page to the boot
   * error screen, hiding a working renderer, character, score and HUD behind a missing bench.
   */
  let props: ReturnType<typeof buildDojoProps> | null = null;
  try {
    props = buildDojoProps(stage);
  } catch (err) {
    console.warn('[kata] dojo props failed to build — rendering the bare hall', err);
  }

  /* ── §5.1 [6] the karateka ────────────────────────────────────────────────────────────────
   *
   * BOTH figures are built. The procedural rig stays in the graph even when the clip-driven
   * character is on screen, because `?rig=proc` is still the only way to look at what the retired
   * solver produces, and because `sampleLandmarks` is written against `RigHandles` and seeds the
   * `Landmarks` buffer before the character exists. It is made INVISIBLE rather than omitted:
   * `visible = false` skips the draw but keeps the hierarchy that path reads.
   *
   * `refitShadow` no longer needs it — that takes `RigHandles | Landmarks` now, and on the clip
   * path it is handed the landmarks resampled from the character every frame. */
  const rig = buildKarateka(materials);
  scene.add(rig.root);
  rig.root.updateMatrixWorld(true);

  const landmarks = createLandmarks();
  sampleLandmarks(rig, 0, landmarks);

  const useProcedural = o.proceduralRig === true;
  let character: Character | null = null;
  if (!useProcedural) {
    character = await loadCharacter(o.modelUrl ?? DEFAULT_MODEL_URL);
    scene.add(character.root);
    character.root.updateMatrixWorld(true);
    /* First clip that exists, in preference order — the two libraries name their idle differently
     * and a missing name must not leave the figure frozen in bind pose. */
    for (const name of ['Idle_Loop', 'idle', ...character.clipNames]) {
      if (character.play(name, 0) !== null) break;
    }
    /**
     * ═══ THE IMPORTED FIGURE WEARS ITS OWN MATERIALS, AND THEY ARE NOT OURS ══════════════════
     *
     * `AnimLib.glb` ships a preview look in two materials: `M_Main`, orange plastic `#e7aa3a`, for
     * the body, and `M_Joints`, violet `#aa66db`, for the spheres at every articulation. Under a
     * white gi the violet surfaced as rings at the neck, both wrists and both ankles.
     *
     * ═══ WHY BOTH ARE RE-MATERIALLED AND NEITHER IS HIDDEN ══════════════════════════════════
     *
     * Hiding `M_Joints` was tried first, on the reading that articulation spheres are a modelling
     * aid. They are not — or not only. They are also the CAP GEOMETRY that closes the body mesh:
     * `M_Main` is open at the neck, the wrists and the ankles, and the spheres are what fills those
     * openings. Hidden, the neck became a hole looking into an unlit interior, made worse by
     * `M_Main` being `DoubleSide`, so the inside of the torso rendered rather than nothing at all.
     *
     * Painting both with B5's `M_SKIN` fills the seams with the same tone as the limb they join,
     * which is what the geometry was always for. Matched on MATERIAL name rather than mesh name:
     * `Mannequin_1`/`Mannequin_2` is this particular file's accident, while `M_Main`/`M_Joints`
     * describe what the geometry IS, and a differently exported character would keep the second
     * naming and not the first.
     */
    character.root.traverse((o) => {
      const m = o as { isMesh?: boolean; material?: { name?: string } };
      if (m.isMesh !== true || m.material === undefined) return;
      if (/joint|main|skin|body/i.test(m.material.name ?? '')) {
        (o as unknown as { material: MaterialSet['M_SKIN'] }).material = materials.M_SKIN;
      }
    });

    rig.root.visible = false;

    /* ── real karate, retargeted from motion capture ──────────────────────────────────────────
     *
     * The CC0 clip library has no karate in it — boxing punches, and no blocks at all. Actual
     * Shotokan motion exists only as mocap, so `karate.bvh` (18-joint BioVision, 21.7 s) is baked
     * onto this character's skeleton at boot and registered as an ordinary clip.
     *
     * NON-FATAL by design: a missing or malformed capture must degrade to "the library clips only",
     * not to a dojo that will not boot. The warning names the file so the cause is not a mystery. */
    for (const m of MOCAP_CLIPS) {
      try {
        await addBvhClip(character, m.url, {
          name: m.name,
          startS: m.startS,
          endS: m.endS,
          rootMotion: m.rootMotion,
        });
      } catch (err) {
        console.warn(`[kata] mocap '${m.name}' (${m.url}) did not load — continuing without it`, err);
      }
    }
  }

  /* ── the kata score, driving that character ──────────────────────────────────────────────── */
  let choreography: Choreography | null = null;
  let kataTimeS = 0;
  let kataPlaying = o.autoplay !== false;
  /* Declared HERE and not beside the key handler: `frame` closes over both, and `setAnimationLoop`
   * is installed above those declarations. rAF makes that safe today, but only by timing. */
  const onBeatChange = o.onBeatChange;
  let lastBeatLabel = '';
  /** Non-null while a single clip is being auditioned; the kata score is suspended meanwhile. */
  let soloClipName: string | null = null;
  /** §6.7's speed multiplier. Applied to the frame's `dt`, never to a clip's own `timeScale`. */
  let playRate = 1;
  /**
   * Clip-seconds owed to the next frame by a step taken while paused.
   *
   * The step is QUEUED rather than applied at the call site, and that is the whole reason both views
   * step identically: the frame loop is the one place that already knows how to hand the same delta
   * to `kataTimeS`, to `choreography.update` and to `character.update` in the right order. Applying
   * it eagerly would mean writing that sequence a second time and keeping the two copies agreeing.
   */
  let pendingStepS = 0;

  /**
   * ═══ THE DEFAULT VIEW IS THE CAPTURE, PLAYED WHOLE ═══════════════════════════════════════════
   *
   * The score-driven view assembles a kata from 1–1.5 s clip fragments, crossfading between them
   * while the root is lerped along the embusen independently. Three things follow from that, and
   * all three were observed:
   *
   *   * every count starts and ends abruptly, because a fragment has no follow-through;
   *   * transitions are a blend between two unrelated poses, and a blend takes the SHORT PATH in
   *     quaternion space with no notion of the body being in the way — which is how a hand ends up
   *     passing through the head;
   *   * the technique is only ever as right as the window someone chose for it.
   *
   * None of that is fixable by choosing better fragments. A continuous capture has real
   * follow-through, real weight transfer, and no interpolation artefacts, because a human did it
   * in one take. `?view=score` still opens the score-driven view — it is the thing B2's data
   * drives, and it is where the embusen and timing work is visible.
   */
  if (character !== null && o.kataId !== undefined) {
    choreography = buildChoreography(getKata(o.kataId), character);
    /* Seed the landmarks from the character's OPENING position. `createCameraRig` below places its
     * initial pose from these, so without this the camera boots framing the embusen origin and
     * swings to the character on frame one. */
    character.root.updateMatrixWorld(true);
    sampleCharacterLandmarks(character, 0, landmarks);
  }

  /**
   * Foot IK. Built AFTER the character so it can measure the sole off the mesh, and driven at the
   * very end of the frame so nothing re-poses the skeleton behind it — it reads world matrices and
   * writes bone locals, so any later pose write silently undoes it.
   *
   * Measured on `heian-nidan`: sole penetration -0.204 m -> -0.041 m, float +0.055 m -> +0.009 m,
   * mean sole height exactly 0.000, and no knee inversion introduced. 0.078 ms/frame.
   */
  const footIk: FootIk | null = character !== null ? createFootIk(character) : null;

  /**
   * Hand shapes. The capture has no fingers at all, so without this the karateka punches with an
   * open hand for the whole kata — see the header of `./handShape`.
   *
   * Built here beside the foot IK because both are per-frame passes over bones the mixer owns, but
   * they share nothing else: the foot pass reads world matrices and must therefore run LAST, while
   * this one only writes bone locals and can run the moment `character.update` has finished. It is
   * driven immediately after the mixer, below, so the shaped fingers are in the very first
   * `updateMatrixWorld` of the frame rather than a matrix walk later.
   */
  const handShaper: HandShaper | null = character !== null ? createHandShaper(character) : null;

  /**
   * The gi. Attached BEFORE the foot IK runs but after the character exists, because it skins itself
   * against the body mesh's existing weights — the body is already correctly bound, so a
   * nearest-vertex weight transfer inherits a deformation that is known good rather than guessed.
   *
   * NON-FATAL: a karateka in a plain mannequin is a worse-looking app, not a broken one, so a
   * failure here warns and continues instead of taking the dojo down with it.
   */
  let gi: GiHandle | null = null;
  let facialHair: FacialHairHandle | null = null;
  if (character !== null) {
    try {
      gi = attachGi(character, { M_GI: materials.M_GI, M_OBI: materials.M_OBI });
    } catch (err) {
      console.warn('[kata] gi could not be attached — rendering the bare figure', err);
    }
    /* Parented to the head BONE inside `attachFacialHair`, not to the scene, and returning `null`
     * rather than throwing on a rig it cannot measure — same non-fatal contract as the gi above. It
     * takes no material: see `makeHairMaterial` for why it owns a matte one instead of `M_HAIR`.
     *
     * The `try` is not redundant with that contract. Returning `null` covers the case the module
     * ANTICIPATES; it cannot cover the one it does not, and a throw here reached the boot error
     * screen and hid a working renderer, dojo, character and HUD behind a missing moustache. Every
     * decorative attachment in this function is now wrapped for the same reason — props and the gi
     * each took the page down exactly once before earning theirs. */
    try {
      facialHair = attachFacialHair(character);
    } catch (err) {
      console.warn('[kata] facial hair could not be attached — rendering the bare face', err);
    }
  }

  /**
   * The score's hand shapes, applied to whichever hands the beat names. Called every frame rather
   * than only on a beat change: `set` is a no-op when the shape is already the target, and driving
   * it unconditionally means a seek, a `goToBeat` and the loop back to the top all land on the right
   * shapes without three separate places remembering to say so.
   */
  const applyBeatHands = (beat: Beat | undefined, blendS?: number): void => {
    if (beat === undefined) return;
    handShaper?.set('L', beat.handL, blendS);
    handShaper?.set('R', beat.handR, blendS);
  };

  if (character !== null && o.scoreView !== true) {
    const start = o.startClip ?? 'heian-nidan';
    if (character.clips.has(start)) {
      soloClipName = start;
      character.play(start, 0, { loop: 'repeat' });
    }

    /**
     * ═══ THE CONTINUOUS VIEW HOLDS SEIKEN, BECAUSE IT HAS NOTHING BETTER TO GO ON ══════════════
     *
     * A raw capture is 20 joints of body and no technique labels: nothing in `heian-nidan.bvh` says
     * which count is running, so per-technique shapes are not derivable here the way they are from
     * the score. The default therefore has to be a CONSTANT, and for a karate kata that constant is
     * the closed fist — Heian Nidan is fists for the overwhelming majority of its length, and the
     * one place it is not (the shuto-uke pair) is wrong by one hand shape, against a punch that
     * would otherwise be wrong for the entire take.
     *
     * Snapped, not eased: a page that fades its fists closed over its first frames reads as a
     * loading artefact rather than as a stance.
     */
    handShaper?.set('L', 'seiken', 0);
    handShaper?.set('R', 'seiken', 0);
  } else {
    /* Score view: open on beat 0's own shapes with no ease, for the same reason. */
    applyBeatHands(choreography?.beats[0], 0);
  }

  /* ── §5.1 [7] camera ─────────────────────────────────────────────────────────────────────── */
  // Declared BEFORE createCameraRig: the rig places its initial pose inside its own constructor and
  // that fires `onViewChange` synchronously, so a `let` declared below would be in its TDZ.
  let idleS = 0;
  let post: KataPostStack | null = null;
  const cameraRig = createCameraRig({
    domElement: harness ? null : o.canvas,
    aspect: viewAspect(renderer, o.canvas),
    onCameraSwap: (c: Camera) => post?.setCamera(c),
    onViewChange: () => {
      // Any view change invalidates accumulated samples (§5.3).
      post?.resetStill();
      idleS = 0;
    },
  });
  cameraRig.update(0, landmarks);

  /* ── §5.1 [8] composer ───────────────────────────────────────────────────────────────────── */
  post = buildPost(renderer, scene, cameraRig.camera, { quality, clipBox: stageClipBox() });
  const postStack: KataPostStack = post;

  /* Mode B shadow fit. Cheap (§6.6 budgets 0.02 ms) and re-run every frame once posing lands.
   * Fit the figure that is ON SCREEN: `landmarks` is resampled from the character every frame, while
   * `rig` never leaves bind pose at the origin once the clip path owns the render. */
  refitShadow(character !== null ? landmarks : rig, lights.key, cameraRig.camera);

  /* ── §5.1 [9] compile every program before the first frame ───────────────────────────────── */
  await renderer.compileAsync(scene, cameraRig.camera);

  /* ── compile + sampler, if a kata was asked for ──────────────────────────────────────────── */
  let transport: StageTransport | null = null;
  let source: ReturnType<typeof createSampler> | null = null;
  let poseFrame: PoseFrame | null = null;
  /* The compile runs ONLY for the procedural path now. It costs seconds of blocked main thread and
   * its output drives nothing the clip path renders, so paying for it by default would be a
   * multi-second boot stall in exchange for an unread `Float32Array`. */
  if (o.kataId !== undefined && useProcedural) {
    o.onCompileStart?.(o.kataId);
    /**
     * STRICT FIRST, THEN ADVISORY — and say so loudly.
     *
     * §4.11: "A stage mask that is not full sets `flags.stageMask` in `run.json` and makes every
     * gate ADVISORY." That is the sanctioned mechanism for looking at a pose whose gates are not
     * yet green, and it is the right one here: a build gate that stops the dev preview from
     * rendering at all makes the pose impossible to inspect, which is precisely when you most
     * need to see it.
     *
     * What it must never do is fail quietly. The failing stage is reported through `onGateFail`
     * so the caller can put it on screen, and a track compiled this way is NOT gate-clean — it is
     * a diagnostic view. `npm test` still runs the strict path and still fails.
     */
    const opts = { tempoTier: o.tempoTier ?? 'T1', codeVersion: 'phase2' };
    let track: PoseTrack;
    try {
      track = compileKata(getKata(o.kataId), opts);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('stage ')) throw err;
      o.onGateFail?.(err.message);
      const advisory = STAGE_MASK_FULL & ~stageBit('S13') & ~stageBit('S14');
      track = compileKata(getKata(o.kataId), { ...opts, stageMask: advisory });
    }
    source = createSampler(track);
    /* Caller-owned scratch, allocated ONCE. §3.9: "the sampler never allocates." */
    poseFrame = {
      q: new Float32Array(BONE_COUNT * 4),
      rootPos: new Float32Array(3),
      rootQuat: new Float32Array(4),
      chan: new Float32Array(CHANNEL_COUNT),
      scaleRibcage: new Float32Array(3),
    };
    const clampTick = (t: number): number =>
      ((Math.round(t) % track.durationTicks) + track.durationTicks) % track.durationTicks;
    transport = {
      track,
      tick: clampTick(o.startTick ?? 0),
      playing: o.autoplay ?? true,
      rate: 1,
      seek(t: number): void {
        this.tick = clampTick(t);
      },
      toggle(): void {
        this.playing = !this.playing;
      },
    };
  }

  /* ── frame loop ──────────────────────────────────────────────────────────────────────────── */
  const timer = new Timer();
  let frameMs = 0;
  let drawCalls = 0;
  let triangles = 0;
  let disposed = false;

  const markInteraction = (): void => {
    idleS = 0;
    if (progressiveStill && postStack.mode !== 'play') postStack.setMode('play');
  };

  /* ═══════════════════════════════════════════════════════════════════════════════════════════
   * Seconds-domain transport, over whichever view is on screen
   * ═══════════════════════════════════════════════════════════════════════════════════════════ */

  /**
   * The live `AnimationAction` behind the auditioned clip.
   *
   * Fetched from the mixer rather than kept as a field because `Character` does not expose one, and
   * `mixer.existingAction(clip)` is exactly the lookup `play()` itself does — the action a clip has
   * been played on is cached on the mixer for the mixer's lifetime.
   *
   * This is also the ONLY handle that can be seeked. `character.play(name)` early-returns when the
   * clip is already current, so it cannot re-position anything, and `mixer.setTime()` multiplies its
   * argument by `mixer.timeScale` — a silent no-op the moment anything has zeroed that to pause.
   * Both cost this project real debugging time. Writing `action.time` sidesteps both.
   */
  const soloAction = (): AnimationAction | null => {
    if (character === null || soloClipName === null) return null;
    const clip = character.clips.get(soloClipName);
    return clip === undefined ? null : character.mixer.existingAction(clip);
  };

  const kataDurationS = (): number => choreography?.durationS ?? 0;
  /** Wrap into `[0, durationS)`. Backward stepping past zero must land at the end, not at −0.03. */
  const wrapKata = (t: number): number => {
    const d = kataDurationS();
    return d > 0 ? ((t % d) + d) % d : 0;
  };

  const durationSecondsNow = (): number =>
    soloClipName !== null
      ? (character?.clips.get(soloClipName)?.duration ?? 0)
      : kataDurationS();

  const currentSecondsNow = (): number =>
    soloClipName !== null ? (soloAction()?.time ?? 0) : wrapKata(kataTimeS);

  /**
   * Re-seat the camera and the shadow ON the frame just seeked to.
   *
   * A seek moves the figure without a `dt`, so nothing else this frame would resample the landmarks:
   * the camera would keep easing from where the body WAS, which on a two-metre embusen jump is a
   * visible swing away from the pose the user asked to look at. Same three lines `goToBeat` runs for
   * the same reason — left duplicated there rather than refactored, so this addition cannot change
   * the behaviour of a path that already works.
   */
  const resettleView = (): void => {
    if (character !== null) {
      character.root.updateMatrixWorld(true);
      sampleCharacterLandmarks(character, 0, landmarks);
      cameraRig.update(0, landmarks);
    }
    markInteraction();
  };

  /**
   * Absolute seek, in seconds, over whichever view is live.
   *
   * PAUSES, for the reason spelled out on `goToBeat`: a scrub means "show me this frame", and
   * leaving playback running makes the frame you released on the wrong one by the time you have
   * looked at it — and silently resurrects a kata the user explicitly paused.
   */
  const seekSeconds = (t: number): void => {
    const dur = durationSecondsNow();
    if (!(dur > 0)) return;
    kataPlaying = false;
    /* A queued step is stale the moment an ABSOLUTE position is asked for; applying it afterwards
     * would land one frame off wherever the pointer was released. */
    pendingStepS = 0;

    if (soloClipName !== null) {
      const action = soloAction();
      if (action === null) return;
      /* Short of the very last sample: at exactly `duration` a LoopRepeat action wraps to 0 on the
       * next update, so releasing the scrub at the far right would snap the figure back to frame 0. */
      action.time = Math.min(Math.max(t, 0), Math.max(dur - DISPLAY_FRAME_S, 0));
      /* `update(0)` writes no time but DOES run every binding's `apply()`, which is what actually
       * pushes the newly-evaluated pose onto the bones. Without it the seek is invisible until the
       * next frame — and while paused there is no next frame that moves anything. */
      character?.update(0);
    } else if (choreography !== null) {
      kataTimeS = wrapKata(t);
      /* Re-arm the technique trigger: the score fires each beat's clip ONCE, so a seek inside a beat
       * that has already fired would otherwise show the previous count's clip until the next one. */
      choreography.invalidate();
      choreography.update(kataTimeS);
      applyBeatHands(choreography.beats[choreography.at]);
      character?.update(0);
    }
    /* Re-shape the fingers the mixer has just re-written. `character.update(0)` above exists
     * precisely so a paused seek is VISIBLE, and without this line the half of the pose this module
     * owns is not: the hand would show the clip's own bind-pinned fingers — flat and open — until
     * the next animation frame. One frame at 60 Hz, but a scrub is exactly when someone is looking
     * closely at a single held pose. */
    handShaper?.update(0);
    resettleView();
  };

  /** Queue ±`n` display frames and hold. See `pendingStepS` and `DISPLAY_FRAME_S`. */
  const stepDisplayFrames = (n: number): void => {
    if (!Number.isFinite(n) || n === 0) return;
    kataPlaying = false;
    pendingStepS += n * DISPLAY_FRAME_S;
    markInteraction();
  };

  const setRate = (r: number): void => {
    if (!Number.isFinite(r)) return;
    playRate = Math.min(RATE_MAX, Math.max(RATE_MIN, r));
    markInteraction();
  };

  const frame = (time: number): void => {
    if (disposed) return;
    timer.update(time);
    const dt = timer.getDelta();
    renderer.info.reset();

    /* ── §6.1's whole runtime read path: advance a tick, sample, apply. ────────────────────
     *
     * The tick is advanced from the frame's own `dt`, but the POSE is a pure function of the
     * resulting integer — nothing accumulates in the pose itself. That is what makes a scrub, a
     * reverse step and a cold seek produce identical bytes, and it is why `transport.tick` can be
     * written from outside at any time with no re-sync. */
    if (transport !== null && source !== null && poseFrame !== null) {
      if (transport.playing) {
        transport.tick =
          (transport.tick + dt * TICK_HZ * transport.rate) % transport.track.durationTicks;
      }
      source.sample(Math.round(transport.tick), LAYER_WEIGHTS_DEFAULT, poseFrame);
      applyPose(rig, poseFrame);
      /* The sampler and `applyPose` both stay off the matrix walk (§6.6 budgets it separately),
       * so the caller does it once, here, before anything reads a world position. */
      rig.root.updateMatrixWorld(true);
    }

    /* The clip path. The score moves the root and picks the clip; the mixer writes the bones. Order
     * matters: `choreography.update` may start a crossfade that `mixer.update` must then advance in
     * the SAME frame, or the first frame of every technique renders at the outgoing clip's pose. */
    if (character !== null) {
      /* ═══ THE ONE CLOCK ═══════════════════════════════════════════════════════════════════
       *
       * Exactly one number of clip-seconds is produced per frame and spent on every consumer:
       * real time while playing, a queued step while paused, and nothing at all otherwise. That
       * single line is what makes pause, slow motion and frame stepping mean the same thing in the
       * score view and in the continuous-capture view.
       *
       * It also retires a long-standing asymmetry: `character.update(dt)` used to run
       * unconditionally, so the auditioned-clip view had NO pause — `kataPlaying` was a flag
       * nothing read there, which is why the HUD had to grey its play button out while soloing. */
      const clipDt = kataPlaying ? dt * playRate : pendingStepS;
      pendingStepS = 0;

      /* A solo clip SUSPENDS the score rather than competing with it: `choreography.update` picks a
       * clip every frame, so leaving it running would overwrite the auditioned one instantly. */
      if (choreography !== null && soloClipName === null) {
        kataTimeS = wrapKata(kataTimeS + clipDt);
        choreography.update(kataTimeS);
        const beat = choreography.beats[choreography.at];
        applyBeatHands(beat);
        if (beat !== undefined && beat.label !== lastBeatLabel) {
          lastBeatLabel = beat.label;
          onBeatChange?.(beat.label, beat.kiai, choreography.at);
        }
      }
      character.update(clipDt);
      /* AFTER the mixer, which has just written every finger bone — the retargeted capture pins
       * them all to bind and the library clips carry a boxer's open hand — and BEFORE the matrix
       * walk, so the shaped fingers are in the first world update of the frame rather than a walk
       * later. Real `dt`, not `clipDt`: a hand asked for a new shape while the transport is paused
       * still has to finish arriving at it. */
      handShaper?.update(dt);
      character.root.updateMatrixWorld(true);
      /* Landmarks come from the figure that is actually on screen. Without this the camera frames,
       * and the shadow fits, the invisible procedural rig standing back at the embusen origin. */
      /* LAST write to the skeleton this frame, by construction — see `createFootIk`. Landmarks are
       * sampled after it so the camera and the contact shadow track the GROUNDED figure. */
      footIk?.update(dt);
      character.root.updateMatrixWorld(true);
      sampleCharacterLandmarks(character, 0, landmarks);
    }

    cameraRig.update(dt, landmarks);
    /* Same source as the camera. `?rig=proc` still fits the bones directly: nothing resamples
     * `landmarks` from the procedural rig inside this loop, so they would be a bind-pose snapshot. */
    refitShadow(character !== null ? landmarks : rig, lights.key, cameraRig.camera);

    if (progressiveStill) {
      // Harness mode never plays: the capture path is snapTo + settle (§6.3 determinism ledger).
      idleS += dt;
      if ((harness || idleS > IDLE_BEFORE_STILL_S) && postStack.mode === 'play') {
        postStack.setMode('still');
      }
    }

    postStack.render(dt);
    frameMs = dt * 1000;
    drawCalls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
  };

  renderer.setAnimationLoop(frame);

  /* ── resize ──────────────────────────────────────────────────────────────────────────────── */
  /**
   * ═══ MEASURE THE PARENT, NEVER THE CANVAS ════════════════════════════════════════════════════
   *
   * This read `o.canvas.clientWidth`, and that is a LATCH that can only ever grow.
   *
   * `WebGLRenderer.setSize(w, h)` defaults `updateStyle` to true, so it writes an INLINE
   * `style.width: 1222px` onto the canvas — which overrides the `width: 100%` rule in
   * `index.html`. From then on `clientWidth` reports the value this function itself last set, not
   * the space actually available. Growing still worked, because a bigger window makes the parent
   * bigger and the canvas is `width:100%`... until the first inline write pins it.
   *
   * Observed at 375 x 812: `#kata-stage` correctly reported 375 x 812 while `#kata-canvas` inside
   * it was still 1222 x 808, so the renderer kept drawing a landscape frame that the phone
   * viewport simply cropped — the karateka rendered at dead centre of a canvas whose centre was
   * off the right of the screen. `window.dispatchEvent(new Event('resize'))` could not clear it;
   * nothing could, because the measurement was self-referential.
   *
   * The parent is `#kata-stage`, `position: fixed; inset: 0`, and nothing writes inline styles to
   * it. `getBoundingClientRect` over `clientWidth` so a fractional CSS size (common on phones with
   * an odd DPR) does not truncate and leave a one-pixel seam.
   */
  const sizeSource: HTMLElement = o.canvas.parentElement ?? o.canvas;
  const applySize = (): void => {
    if (harness) return; // pinned 1024 x 1024 DPR 1
    const r = sizeSource.getBoundingClientRect();
    const w = Math.round(r.width) || o.canvas.clientWidth || 1600;
    const h = Math.round(r.height) || o.canvas.clientHeight || 900;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    postStack.setSize(w, h, Math.min(dpr, POST.maxPixelRatio.v));
    cameraRig.setSize(w, h);
    markInteraction();
  };
  applySize();

  /* Observe the PARENT for the same reason: the canvas's own box is downstream of this function,
   * so observing it is a feedback loop that can also miss a shrink entirely. */
  const ro =
    typeof ResizeObserver === 'function' && !harness ? new ResizeObserver(() => applySize()) : null;
  ro?.observe(sizeSource);

  /* ── input: §6.7's `1`-`9` camera presets, plus `0`/`m` for the measurement cameras ──────── */
  const setCameraPreset = (id: string, exact = false): void => {
    // Validated against B1's own table rather than against a second list of names, so an unknown id
    // from the URL or a stale keybinding is a no-op instead of an undefined-preset crash.
    if (!(id in CAMERA_PRESET_PARAMS)) return;
    const preset = id as CameraPresetId;
    if (exact) cameraRig.snapTo(preset);
    else cameraRig.setPreset(preset);
    markInteraction();
  };

  const onClipChange = o.onClipChange;
  const onFollowCamChange = o.onFollowCamChange;
  let measurementCursor = 0;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '9') {
      const preset = CAMERA_KEY_ORDER[Number(k) - 1];
      if (preset !== undefined) setCameraPreset(preset);
      return;
    }
    if (k === '0') {
      setCameraPreset('M_TOP', true);
      return;
    }
    if (k === 'm' || k === 'M') {
      const preset = CAMERA_MEASUREMENT_ORDER[measurementCursor % CAMERA_MEASUREMENT_ORDER.length];
      measurementCursor++;
      if (preset !== undefined) setCameraPreset(preset, true);
      return;
    }
    if (k === 'r' || k === 'R') setCameraPreset('ORBIT', true);
    if (k === 'f' || k === 'F') {
      /* Heading lock only means anything on ORBIT — every other preset is a fixed measurement
       * camera — so switch there rather than silently toggling a flag with no visible effect. */
      if (cameraRig.active !== 'ORBIT') setCameraPreset('ORBIT', true);
      cameraRig.setFollowHeading(!cameraRig.followHeading);
      onFollowCamChange?.(cameraRig.followHeading);
      markInteraction();
      return;
    }

    /* `,` / `.` step one display frame, the keys every NLE and every video player binds to exactly
     * this. Bound BEFORE the score block on purpose: they are the one transport that has to work
     * identically in the score view and while a clip is soloed, and the score block below returns
     * early for the arrows. */
    if (k === ',' || k === '<') {
      stepDisplayFrames(-1);
      return;
    }
    if (k === '.' || k === '>') {
      stepDisplayFrames(1);
      return;
    }

    /* `[` / `]` walk the clip list. The whole point of loading a 46-clip library is being able to
     * LOOK at what is in it; a library you cannot audition is a library you cannot choose from. */
    if (character !== null && (k === '[' || k === ']')) {
      const names = character.clipNames;
      const at = character.current === null ? -1 : names.indexOf(character.current);
      const next = (at + (k === ']' ? 1 : -1) + names.length) % names.length;
      const name = names[next];
      if (name !== undefined) {
        character.play(name);
        onClipChange?.(name, next, names.length);
      }
      markInteraction();
      return;
    }

    /* Transport over the kata score. SPACE toggles; the arrows jump whole COUNTS rather than
     * frames, because "show me count 7" is the question a reviewer actually asks of a kata. */
    if (choreography !== null) {
      const jumpTo = (idx: number): void => {
        const list = choreography!.beats;
        const b = list[((idx % list.length) + list.length) % list.length];
        if (b === undefined) return;
        kataTimeS = b.startS;
        choreography!.invalidate();
        choreography!.update(kataTimeS);
        markInteraction();
      };
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        /* SPACE used to drop out of an audition instead of pausing it, because the frame loop
         * ignored `kataPlaying` while a clip was soloed — toggling it there changed nothing
         * visible and then took effect out of nowhere when the solo ended. One clock now drives
         * both views, so SPACE is plain play/pause and never changes WHAT is playing. */
        kataPlaying = !kataPlaying;
        markInteraction();
        return;
      }
      if (k === 'ArrowRight') return jumpTo(choreography.at + 1);
      if (k === 'ArrowLeft') return jumpTo(choreography.at - 1);
      if (k === 'Home') {
        kataTimeS = 0;
        choreography.invalidate();
        choreography.update(0);
        markInteraction();
        return;
      }
    }

    /* Transport keys. Space toggles; the arrows scrub by one 60 fps display frame
     * (`DISPLAY_TICKS = 64`), which is the granularity a reviewer actually steps at. */
    if (transport === null) return;
    if (k === ' ' || k === 'Spacebar') {
      transport.toggle();
      e.preventDefault();
      markInteraction();
      return;
    }
    if (k === 'ArrowRight') { transport.seek(transport.tick + 64); markInteraction(); return; }
    if (k === 'ArrowLeft') { transport.seek(transport.tick - 64); markInteraction(); return; }
    if (k === 'Home') { transport.seek(0); markInteraction(); }
  };

  const onPointerDown = (): void => markInteraction();
  const onWheel = (): void => markInteraction();

  if (interactive) {
    window.addEventListener('keydown', onKeyDown);
    o.canvas.addEventListener('pointerdown', onPointerDown);
    o.canvas.addEventListener('wheel', onWheel, { passive: true });
    cameraRig.controls?.addEventListener('change', markInteraction);
  }

  /* ── handle ──────────────────────────────────────────────────────────────────────────────── */
  const boot: StageBoot = {
    renderer,
    scene,
    materials,
    ibl,
    lights,
    stage,
    rig,
    character,
    handShaper,
    choreography,
    cameraRig,
    post: postStack,
    landmarks,
    transport,
    setCameraPreset,
    setFollowCam(on?: boolean): void {
      const want = on ?? !cameraRig.followHeading;
      if (want && cameraRig.active !== 'ORBIT') setCameraPreset('ORBIT', true);
      cameraRig.setFollowHeading(want);
      onFollowCamChange?.(cameraRig.followHeading);
      markInteraction();
    },
    get followCam(): boolean {
      return cameraRig.followHeading;
    },

    goToBeat(index: number): void {
      if (choreography === null) return;
      const list = choreography.beats;
      if (list.length === 0) return;
      const b = list[((index % list.length) + list.length) % list.length];
      if (b === undefined) return;
      /* ═══ JUMPING TO A COUNT PAUSES ═══════════════════════════════════════════════════════
       *
       * Clicking a count means "show me this one", not "start running from here". Leaving playback
       * on made every click a moving target: the figure teleported to the new embusen point and
       * immediately walked off it, so a second click landed somewhere else again and the camera
       * chased the whole time. It also silently resurrected playback after an explicit pause.
       *
       * Pausing makes the click land exactly where it says it will. `setPlaying(true)` — the play
       * button — is the one thing that starts motion, which is the property that was missing. */
      soloClipName = null;
      kataPlaying = false;
      kataTimeS = b.startS;
      choreography.invalidate();
      choreography.update(kataTimeS);
      /* The hands belong to the count being jumped to, not to the one being left. Without this the
       * shapes only catch up on the next animation frame — invisible while playing, but a click on
       * a count PAUSES, and the whole point of pausing is that the frame you are looking at is the
       * one you asked for. */
      applyBeatHands(b);
      lastBeatLabel = b.label;
      onBeatChange?.(b.label, b.kiai, choreography.at);

      /* Settle the camera ON the new stance instead of letting it ease across from the old one:
       * `landmarks` are resampled here so the rig's next update starts from where the figure now
       * IS, not from where it was two metres ago. */
      if (character !== null) {
        character.root.updateMatrixWorld(true);
        sampleCharacterLandmarks(character, 0, landmarks);
        cameraRig.update(0, landmarks);
      }
      markInteraction();
    },

    setPlaying(play?: boolean): void {
      kataPlaying = play ?? !kataPlaying;
      markInteraction();
    },
    get playing(): boolean {
      return kataPlaying;
    },
    get beatIndex(): number {
      return choreography?.at ?? -1;
    },

    soloClip(name: string | null): void {
      if (character === null) return;
      soloClipName = name;
      if (name !== null) {
        /* Choosing a clip means "show me this clip move", so it starts playing. It has to be said
         * out loud now that the audition view HAS a pause: pick a clip while the kata is paused —
         * which is exactly what clicking a count leaves you in — and without this you would get a
         * frozen figure and no clue that the clip had loaded at all. The 0.2 s crossfade below also
         * needs a running mixer to resolve; frozen, it would hold the outgoing pose. */
        kataPlaying = true;
        pendingStepS = 0;
        character.play(name, 0.2, { loop: 'repeat', timeScale: 1 });
      } else if (choreography !== null) {
        /* Re-arm the technique trigger: the score fires each beat's clip once, and returning from
         * an audition mid-beat would otherwise skip it until the next count. */
        choreography.invalidate();
        choreography.update(kataTimeS);
      }
      markInteraction();
    },
    get solo(): string | null {
      return soloClipName;
    },

    frameSeconds: DISPLAY_FRAME_S,
    get durationSeconds(): number {
      return durationSecondsNow();
    },
    get currentSeconds(): number {
      return currentSecondsNow();
    },
    seekSeconds,
    stepDisplayFrames,
    setRate,
    get rate(): number {
      return playRate;
    },

    stats(): StageStats {
      const info = renderer.info;
      return {
        // Whole-frame totals, snapshotted inside the loop: scene draws PLUS every post pass. §5.6's
        // 11-mesh scene budget is `sceneMeshes` below; the two numbers measure different things.
        drawCalls,
        triangles,
        sceneMeshes: countSceneMeshes(scene),
        programs: info.programs?.length ?? 0,
        bones: rig.bones.length,
        passes: postStack.instantiatedPasses,
        quality: postStack.quality,
        mode: postStack.mode,
        stillSample: postStack.stillSample,
        stillConverged: postStack.stillConverged,
        camera: cameraRig.active,
        canvasPx: [o.canvas.width, o.canvas.height],
        dpr: renderer.getPixelRatio(),
        frameMs,
        karateka: karatekaStats(),
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      ro?.disconnect();
      if (interactive) {
        window.removeEventListener('keydown', onKeyDown);
        o.canvas.removeEventListener('pointerdown', onPointerDown);
        o.canvas.removeEventListener('wheel', onWheel);
        cameraRig.controls?.removeEventListener('change', markInteraction);
      }
      cameraRig.dispose();
      postStack.dispose();
      gi?.dispose();
      facialHair?.dispose();
      footIk?.dispose();
      handShaper?.dispose();
      character?.dispose();
      scene.remove(rig.root);
      if (props !== null) disposeDojoProps(props);
      disposeStage(scene, stage);
      disposeLights(scene, lights);
      disposeMaterials(materials);
      ibl.dispose();
      renderer.dispose();
    },
  };

  return boot;
}

/** §5.6's draw-call budget counts opaque scene meshes. Its own table sums to 11, not the stated 12. */
function countSceneMeshes(scene: Scene): number {
  let n = 0;
  scene.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh === true) n++;
  });
  return n;
}

/** Aspect of the drawing buffer, falling back to the canvas attribute size. */
function viewAspect(renderer: WebGLRenderer, canvas: HTMLCanvasElement): number {
  const w = canvas.clientWidth || canvas.width || renderer.domElement.width || 1;
  const h = canvas.clientHeight || canvas.height || renderer.domElement.height || 1;
  return h > 0 ? w / h : 1;
}
