/**
 * B6 PLAYER — `src/player/character.ts` — the rigged character and its animation mixer.
 *
 * ═══ WHY THIS FILE EXISTS ═════════════════════════════════════════════════════════════════════
 *
 * Phases 1–2 drove a procedurally-built figure from `compileKata`: every bone quaternion computed
 * from stance tables and biomechanics constants. That approach produces geometrically correct poses
 * and reads as a robot, because human motion carries micro-detail — weight shift, overshoot,
 * asymmetry, anticipation, settle — that cannot be authored from constants at any reasonable cost.
 *
 * The industry answer, and now ours: a rigged mesh plus recorded clips, played by `AnimationMixer`.
 * `src/solve/**` is retired from the render path. What survives, and what still matters, is B2's
 * kata data — the move tables, embusen coordinates, headings, timings and pause map. Those stop
 * being input to a pose solver and become the CHOREOGRAPHY layer: which clip plays, where the
 * character stands, which way they face, how long they hold.
 *
 * ═══ WHY THE MIXAMO SKELETON SPECIFICALLY ════════════════════════════════════════════════════
 *
 * `Xbot.glb` carries the stock Mixamo rig — 67 joints, every one named `mixamorig:*`, fingers
 * included. That naming is the de-facto interchange standard for humanoid clips: any Mixamo FBX
 * retargets onto it by NAME, with no bone remapping and no retarget step at all. Choosing a
 * bespoke skeleton here would have made every future clip a retargeting project.
 */

import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { BoneName } from '../contracts';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The contract skeleton <-> Mixamo skeleton map
 *
 * B1's `BONE_ORDER` is a 52-joint Unreal-flavoured skeleton; Mixamo ships 67. The mapping is
 * total in the directions that matter and partial in one:
 *
 *   * Every contract joint that CARRIES MOTION has a Mixamo counterpart.
 *   * `upperarm_twist_*`, `lowerarm_twist_*`, `thigh_twist_*`, `calf_twist_*` and `deltoid_*` have
 *     NONE, and correctly so — twist and helper joints are a skinning convention for distributing
 *     roll across a limb, not independent degrees of freedom. Mixamo's skinning does that job with
 *     weights instead. They were solver conveniences and have no meaning once clips drive the rig.
 *   * `ribcage` is scale-only (`SCALABLE_BONE`) and has no rotational counterpart either.
 *
 * Kept because the camera rig, the contact-shadow fit and every landmark read are written against
 * contract names, and because retargeting a non-Mixamo clip later needs exactly this table.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Contract bone -> Mixamo joint, WITHOUT the `mixamorig:` prefix. `null` = no counterpart. */
export const CONTRACT_TO_MIXAMO: Readonly<Partial<Record<BoneName, string>>> = Object.freeze({
  pelvis: 'Hips',
  spine_01: 'Spine',
  spine_02: 'Spine1',
  spine_03: 'Spine2',
  /* Mixamo has three spine joints to the contract's four-plus-chest. `Spine2` is the highest, so it
   * serves as `chest`: the shoulders and neck hang off it, which is what `chest` means to the
   * camera and to the shoulder-lag read. `spine_03` maps there too — they coincide. */
  chest: 'Spine2',
  neck_01: 'Neck',
  head: 'Head',
  head_end: 'HeadTop_End',
  eye_L: 'LeftEye',
  eye_R: 'RightEye',

  clavicle_L: 'LeftShoulder',
  upperarm_L: 'LeftArm',
  lowerarm_L: 'LeftForeArm',
  hand_L: 'LeftHand',
  /* The contract collapses four fingers into one `fingers_*` chain; Mixamo keeps all four. The
   * middle finger is the representative — it is the one a fist's `refPoint` (MCP2/knuckle) and a
   * shuto's blade edge are both measured against. */
  fingers_prox_L: 'LeftHandMiddle1',
  fingers_dist_L: 'LeftHandMiddle2',
  fingers_end_L: 'LeftHandMiddle4',
  thumb_L: 'LeftHandThumb1',
  thumb_end_L: 'LeftHandThumb4',

  clavicle_R: 'RightShoulder',
  upperarm_R: 'RightArm',
  lowerarm_R: 'RightForeArm',
  hand_R: 'RightHand',
  fingers_prox_R: 'RightHandMiddle1',
  fingers_dist_R: 'RightHandMiddle2',
  fingers_end_R: 'RightHandMiddle4',
  thumb_R: 'RightHandThumb1',
  thumb_end_R: 'RightHandThumb4',

  thigh_L: 'LeftUpLeg',
  calf_L: 'LeftLeg',
  foot_L: 'LeftFoot',
  ball_L: 'LeftToeBase',
  toe_end_L: 'LeftToe_End',

  thigh_R: 'RightUpLeg',
  calf_R: 'RightLeg',
  foot_R: 'RightFoot',
  ball_R: 'RightToeBase',
  toe_end_R: 'RightToe_End',
});

/**
 * The same map for the Blender **Rigify** deform skeleton (`DEF-*`), which is what Quaternius's
 * CC0 Universal Animation Library ships on. Two rig conventions are supported, not one, because the
 * best free CHARACTER rig (Mixamo, by ubiquity of clips) and the best free CC0 CLIP LIBRARY (this
 * one) do not agree on names — and pretending otherwise means a silent all-identity pose.
 *
 * Rigify has no toe-tip terminator, no eye bones and one fewer spine joint than Mixamo; those
 * contract entries stay unmapped rather than being aimed at a near-miss joint.
 */
export const CONTRACT_TO_RIGIFY: Readonly<Partial<Record<BoneName, string>>> = Object.freeze({
  pelvis: 'DEF-hips',
  spine_01: 'DEF-spine.001',
  spine_02: 'DEF-spine.002',
  spine_03: 'DEF-spine.003',
  chest: 'DEF-spine.003',
  neck_01: 'DEF-neck',
  head: 'DEF-head',

  clavicle_L: 'DEF-shoulder.L',
  upperarm_L: 'DEF-upper_arm.L',
  lowerarm_L: 'DEF-forearm.L',
  hand_L: 'DEF-hand.L',
  fingers_prox_L: 'DEF-f_middle.01.L',
  fingers_dist_L: 'DEF-f_middle.02.L',
  fingers_end_L: 'DEF-f_middle.03.L',
  thumb_L: 'DEF-thumb.01.L',
  thumb_end_L: 'DEF-thumb.03.L',

  clavicle_R: 'DEF-shoulder.R',
  upperarm_R: 'DEF-upper_arm.R',
  lowerarm_R: 'DEF-forearm.R',
  hand_R: 'DEF-hand.R',
  fingers_prox_R: 'DEF-f_middle.01.R',
  fingers_dist_R: 'DEF-f_middle.02.R',
  fingers_end_R: 'DEF-f_middle.03.R',
  thumb_R: 'DEF-thumb.01.R',
  thumb_end_R: 'DEF-thumb.03.R',

  thigh_L: 'DEF-thigh.L',
  calf_L: 'DEF-shin.L',
  foot_L: 'DEF-foot.L',
  ball_L: 'DEF-toe.L',

  thigh_R: 'DEF-thigh.R',
  calf_R: 'DEF-shin.R',
  foot_R: 'DEF-foot.R',
  ball_R: 'DEF-toe.R',
});

/**
 * Mirror of three's `PropertyBinding.sanitizeNodeName`, which every glTF node name passes through.
 *
 * ═══ WHY THIS IS NOT OPTIONAL ════════════════════════════════════════════════════════════════
 *
 * `.`, `[`, `]`, `:` and `/` are RESERVED in an animation property path (`node.position[x]`), so
 * three strips them from node names at load and whitespace becomes `_`. Rigify names every side
 * and index with a dot — `DEF-hand.L`, `DEF-spine.001` — and all of them arrive as `DEF-handL`
 * and `DEF-spine001`.
 *
 * A map written against the authored names therefore misses on exactly the bones that carry the
 * limbs, while `DEF-hips` and `DEF-head` keep resolving because they contain no dot. The failure
 * mode is the dangerous kind: no error, no missing clip, just a figure whose arms and legs never
 * move — indistinguishable at a glance from a bad clip. Look it up sanitized, always.
 */
export function sanitizeBoneName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[\\[\]./:]/g, '');
}

export type SkeletonFlavour = 'mixamo' | 'rigify' | 'unknown';

/** Sniffed from the loaded joint names — a glTF carries no field that says which rig it is. */
export function detectFlavour(boneNames: Iterable<string>): SkeletonFlavour {
  for (const n of boneNames) {
    if (/^mixamorig/i.test(n)) return 'mixamo';
    if (/^DEF-/.test(n)) return 'rigify';
  }
  return 'unknown';
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Handle
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface Character {
  /** Scene-graph parent. Translate/rotate THIS to drive the character along the embusen. */
  readonly root: Group;
  readonly mixer: AnimationMixer;
  /** By clip name, as authored in the glTF. */
  readonly clips: ReadonlyMap<string, AnimationClip>;
  /**
   * By joint name. Mixamo joints are registered under BOTH their raw name and the name with the
   * `mixamorig:` prefix stripped, so `'Hips'` and `'mixamorig:Hips'` both resolve.
   */
  readonly bones: ReadonlyMap<string, Bone>;
  /** Which rig convention the loaded file uses. Decides which contract map `boneFor` reads. */
  readonly flavour: SkeletonFlavour;
  /**
   * Every clip currently registered, glTF-declared order first.
   *
   * A LIVE view over `clips`, not a snapshot: retargeted mocap is added after load, and a list
   * captured at construction would leave those clips unreachable from the `[` / `]` audition keys —
   * present in the file, invisible in the UI.
   */
  readonly clipNames: readonly string[];
  /** Contract bone name -> the live `Bone`, for landmark and camera reads. */
  boneFor(name: BoneName): Bone | null;
  /** Measured from the loaded bind pose, in metres. */
  readonly heightM: number;
  /** Currently-playing clip name, or `null` before the first `play`. */
  readonly current: string | null;
  /**
   * Crossfade to `name`. Returns `null` for an unknown clip rather than throwing — a missing clip
   * should degrade to "keeps doing the last thing", not take the page down.
   *
   * `loop: 'once'` clamps on the final frame instead of cycling, and ALWAYS restarts even if the
   * clip is already current. That is what a technique needs: a kata throws the same `Punch_Cross`
   * on consecutive counts, and a repeat request that no-ops would drop the second one entirely.
   */
  play(name: string, fadeS?: number, opts?: PlayOpts): AnimationAction | null;
  update(dt: number): void;
  dispose(): void;
}

export interface PlayOpts {
  /** `'repeat'` cycles forever (locomotion, idles); `'once'` clamps on the last frame (strikes). */
  readonly loop?: 'repeat' | 'once';
  /** Playback rate for this clip. Used to fit a recorded strike into a kata's tempo slot. */
  readonly timeScale?: number;
}

/** Default crossfade. Long enough to hide a foot-position mismatch between two unrelated clips. */
export const DEFAULT_FADE_S = 0.28;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Load
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export async function loadCharacter(url: string): Promise<Character> {
  const gltf = await new GLTFLoader().loadAsync(url);

  const root = new Group();
  root.name = 'karateka';
  root.add(gltf.scene);

  const bones = new Map<string, Bone>();
  gltf.scene.traverse((o: Object3D) => {
    if ((o as { isBone?: boolean }).isBone === true) {
      bones.set(o.name, o as Bone);
      const stripped = o.name.replace(/^mixamorig:?/i, '');
      if (stripped !== o.name) bones.set(stripped, o as Bone);
    }
    if ((o as { isMesh?: boolean }).isMesh === true) {
      const m = o as SkinnedMesh;
      m.castShadow = true;
      m.receiveShadow = true;
      /* A skinned mesh's bounding volume is the BIND pose's. Once a clip swings a limb outside it,
       * three culls the whole mesh and the character vanishes at certain camera angles. Skinned
       * meshes are one draw call; skipping the cull test is the standard trade. */
      m.frustumCulled = false;
    }
  });

  const clips = new Map<string, AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name, c);

  const mixer = new AnimationMixer(gltf.scene);
  const heightM = new Box3().setFromObject(gltf.scene).getSize(new Vector3()).y;
  const flavour = detectFlavour(bones.keys());
  const contractMap = flavour === 'rigify' ? CONTRACT_TO_RIGIFY : CONTRACT_TO_MIXAMO;

  let current: string | null = null;
  let action: AnimationAction | null = null;

  const character: Character = {
    root,
    mixer,
    clips,
    bones,
    flavour,
    heightM,
    get clipNames(): readonly string[] {
      return [...clips.keys()];
    },
    get current(): string | null {
      return current;
    },

    boneFor(name: BoneName): Bone | null {
      const rigName = contractMap[name];
      if (rigName === undefined) return null;
      return bones.get(rigName) ?? bones.get(sanitizeBoneName(rigName)) ?? null;
    },

    play(name: string, fadeS: number = DEFAULT_FADE_S, opts: PlayOpts = {}): AnimationAction | null {
      const clip = clips.get(name);
      if (clip === undefined) return null;
      const once = opts.loop === 'once';
      if (name === current && action !== null && !once) {
        /* Already running — but a caller may be re-requesting it at a DIFFERENT rate (the walk
         * cadence tracks each count's ground speed). Re-entering would restart the cycle mid-stride
         * and pop the feet, so update the rate in place and leave the phase alone. */
        if (opts.timeScale !== undefined) action.timeScale = opts.timeScale;
        return action;
      }

      const next = mixer.clipAction(clip);
      next.reset();
      if (once) {
        next.setLoop(LoopOnce, 1);
        /* Without this the action snaps back to frame 0 on finish, so every technique would end by
         * teleporting to its wind-up. Clamping is what turns the last frame into the kata's hold. */
        next.clampWhenFinished = true;
      } else {
        next.setLoop(LoopRepeat, Infinity);
        next.clampWhenFinished = false;
      }
      next.timeScale = opts.timeScale ?? 1;
      next.enabled = true;
      next.setEffectiveWeight(1);

      /* Self-crossfade is undefined behaviour in three — a repeated one-shot fades the action into
       * itself and lands at weight 0, i.e. an invisible technique. Restart it outright instead. */
      if (action !== null && action !== next) {
        if (fadeS > 0) {
          next.crossFadeFrom(action, fadeS, true);
        } else {
          /* An INSTANT switch still has to stop the outgoing action. `crossFadeFrom` is what
           * normally retires it, and skipping that for a zero fade leaves BOTH actions playing at
           * full weight: the mixer then averages two clips over the same bones. Silent, and it
           * looks like a broken retarget rather than a leaked action — the incoming clip's hip
           * track fights the outgoing one and the body barely moves. */
          action.stop();
        }
      }
      next.play();

      action = next;
      current = name;
      return next;
    },

    update(dt: number): void {
      mixer.update(dt);
    },

    dispose(): void {
      mixer.stopAllAction();
      root.removeFromParent();
      gltf.scene.traverse((o: Object3D) => {
        const m = o as Partial<SkinnedMesh>;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) for (const x of mat) x.dispose();
        else mat?.dispose();
      });
    },
  };

  return character;
}
