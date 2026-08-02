/**
 * B6 PLAYER — `src/player/choreography.ts` — B2's kata score, driving clip playback.
 *
 * ═══ WHAT THIS FILE IS, AND WHAT IT REPLACED ═════════════════════════════════════════════════
 *
 * The project used to compute every bone quaternion of every frame from stance geometry and
 * biomechanics constants. That is retired (see `./character.ts`). What was NEVER wrong, and what
 * this file consumes, is B2's kata score: the move tables, the embusen coordinates, the headings,
 * the tempo classes and the pause map, all sourced line by line from doc 02.
 *
 * The split is now clean and it is the right one:
 *
 *   * a CLIP library supplies how a human body moves — the part measurement cannot author;
 *   * the KATA SCORE supplies where the body stands, which way it faces, and when it moves — the
 *     part a clip library knows nothing about.
 *
 * Neither half can produce a kata alone. `Punch_Cross` played on a loop is a boxer; a correct
 * embusen with no motion is a diagram.
 *
 * ═══ WHAT IS HONEST ABOUT THE RESULT, AND WHAT IS NOT ════════════════════════════════════════
 *
 * Correct here: the floor pattern, the headings, the per-move timing, the pauses, the kiai counts,
 * and the step-then-strike-then-hold rhythm. Those come from the score and are as good as the score.
 *
 * NOT correct here: the techniques themselves. The CC0 library ships boxing punches and has no
 * karate in it at all — no zenkutsu-dachi, no hikite, no blocks. `CLIP_FOR_TECHNIQUE` below maps
 * each of doc 02's ten techniques to the nearest thing available and several of those are frank
 * substitutions, marked as such. This reads as "a person performing the shape of Taikyoku Shodan",
 * not "a karateka performing Taikyoku Shodan", and the gap closes by adding clips, not by editing
 * this file.
 */

import type { CeremonyPhase, KataMove, KataScore, TechniqueId } from '../contracts';
import { L_M, PAUSE_CLASSES } from '../data';
/* Reaching into B3's barrel for exactly two functions, on purpose. §2.1 allows the project ONE
 * handedness conversion and it lives in `src/solve/frame.ts`; re-deriving `x -> SIDE_SIGN * x` here
 * would create the second one, which is the precise bug that rule exists to prevent. The retired
 * solver keeps this much of its job. */
import { embusenToWorldM, rootYawRad, toWorldYawDeg } from '../solve';
import type { Character } from './character';
import { STILL_SPEED_MS, measureClipGroundSpeed, timeScaleForSpeed } from './locomotion';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Clip vocabulary
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * doc 02's ten techniques -> the CC0 library's 46 clips.
 *
 * `SUBSTITUTE` marks a mapping that is a stand-in rather than a likeness — kept visible in the
 * source because an unmarked wrong mapping is indistinguishable from a right one on screen, and
 * this table is the shopping list for whichever clip pack lands next.
 */
export const CLIP_FOR_TECHNIQUE: Readonly<Record<TechniqueId, string>> = Object.freeze({
  none: 'Idle_Loop',

  /* REAL SHOTOKAN, sliced out of the Heian Nidan capture — window confirmed BY EYE, not only by
   * heuristic (see `MOCAP_CLIPS`). Twelve of Taikyoku's twenty counts. */
  'oi-zuki': 'mocap-oi-zuki',

  /* REVERTED to a stand-in, deliberately. A window was chosen here by scoring "descends furthest
   * while sweeping forward", which sounded like a gedan-barai and was in fact an arm coming down
   * from overhead. Heian Nidan barely uses gedan-barai, and nothing in the capture puts an extended
   * fist below the pelvis where one has to end — measured minimum is +0.10 m ABOVE it.
   *
   * A wrong technique labelled `mocap` is worse than an honest placeholder: it retires the problem
   * from the todo list without solving it. This needs a capture that contains the technique. */
  'gedan-barai': 'Punch_Enter',

  /* Still boxing: real recorded human motion, wrong martial art. `gyaku-zuki` drives off the rear
   * hip and `choku-zuki` is a standing straight punch; a cross and a jab are the closest recorded
   * equivalents of those two weight transfers. Neither appears in Taikyoku Shodan. */
  'gyaku-zuki': 'Punch_Cross',
  'choku-zuki': 'Punch_Jab',

  /* SUBSTITUTE. There is no block in the CC0 library. `Punch_Enter` is a guard-raising transition,
   * which at least ends with the arms up and forward, and is the least wrong of 46 options.
   * These four still share it, so they look identical to each other — a real defect, and the next
   * thing more capture data fixes. */
  'age-uke': 'Punch_Enter',
  'soto-uke': 'Punch_Enter',
  'uchi-uke': 'Punch_Enter',
  'shuto-uke': 'Punch_Enter',

  /* SUBSTITUTE. A hammer-fist is a descending arc; `Sword_Attack` is the only descending arc here. */
  'tettsui-tate-mawashi': 'Sword_Attack',
});

/**
 * How truthful each technique's clip actually is — surfaced in the HUD so the gap is VISIBLE.
 *
 * Without this the viewer cannot tell a real captured gedan-barai from a boxing punch wearing its
 * name, and neither can anyone reviewing the app. A wrong technique that looks confident is worse
 * than one labelled wrong, so the label ships with the thing it describes.
 *
 *   `mocap`   — real Shotokan motion capture. The goal state.
 *   `approx`  — real recorded human motion, wrong martial art (a boxing cross for `oi-zuki`).
 *   `standin` — nearest available clip, and not the technique at all (all five `uke`).
 */
export type TechniqueSource = 'mocap' | 'approx' | 'standin';

export const TECHNIQUE_SOURCE: Readonly<Record<TechniqueId, TechniqueSource>> = Object.freeze({
  none: 'mocap',

  'oi-zuki': 'mocap',

  'gyaku-zuki': 'approx',
  'choku-zuki': 'approx',

  'gedan-barai': 'standin',
  'age-uke': 'standin',
  'soto-uke': 'standin',
  'uchi-uke': 'standin',
  'shuto-uke': 'standin',
  'tettsui-tate-mawashi': 'standin',
});

/** Locomotion between counts. Formal walk reads closer to a kata step than the athletic one. */
export const STEP_CLIP = 'Walk_Formal_Loop';
/** Standing still: ceremony, yoi, and the hold after a technique clamps. */
export const REST_CLIP = 'Idle_Loop';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Shape
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface Beat {
  readonly kind: 'ceremony' | 'move';
  /** doc 02 count for a move; `0` for ceremony phases. */
  readonly n: number;
  readonly label: string;
  readonly startS: number;
  readonly durS: number;
  /** Where the character STANDS during this beat — world metres, from `embusen.c`. */
  readonly x: number;
  readonly z: number;
  /** `root.rotation.y`, already carrying the model's rest-facing offset. */
  readonly yawRad: number;
  readonly techClip: string | null;
  /** Provenance of `techClip`. `null` for ceremony phases, which have no technique. */
  readonly source: TechniqueSource | null;
  readonly kiai: boolean;
}

export interface Choreography {
  readonly beats: readonly Beat[];
  readonly durationS: number;
  /** Index of the beat covering the last `update`. */
  readonly at: number;
  /** Drives the character's root transform and clip selection for absolute time `tS`. */
  update(tS: number): void;
  /** Force the next `update` to re-trigger its technique — used after a seek. */
  invalidate(): void;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Constants of the read
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The model's rest facing, as a yaw offset.
 *
 * Measured, not assumed: the loaded figure's toes point along **world +Z**, while doc 02 §1 defines
 * `f(H) = (−sin H, 0, −cos H)`, putting heading 0 at world **−Z**. Without the half turn every
 * heading in the score is mirrored and the whole kata runs backwards down the embusen.
 */
export const MODEL_FACING_OFFSET_RAD = Math.PI;

/**
 * Fraction of a move's slot spent travelling to the new embusen point.
 *
 * doc 04's own shape for a count is step, strike, hold — the feet arrive BEFORE the technique
 * lands, never with it. Travel finishing at 0.55 and the strike firing at 0.42 overlaps them
 * slightly, which is what keeps the count from reading as two separate events.
 */
const TRAVEL_END_FRAC = 0.55;
const TECH_FIRE_FRAC = 0.42;

/** Below this, a count is a technique-in-place and the step clip is skipped entirely. */
const STEP_DISTANCE_MIN_M = 0.06;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Build
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Shortest signed delta between two angles, in radians. Headings turn 180° and 270° in this data. */
function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Hermite smoothstep. A linear step reads as a slide; the ease is what makes it a weight shift. */
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * ═══ WHY YAW ACCUMULATES `dHeadingDeg` INSTEAD OF READING `headingDeg` ════════════════════════
 *
 * The two agree on WHERE the character ends up facing and disagree on HOW it gets there, and in a
 * kata the how is the content. Counts 2→3 and 18→19 of Taikyoku are 180° turns: from the absolute
 * heading alone, "turn left" and "turn right" are both exact, and a shortest-arc interpolation
 * picks between them on a floating-point tie. doc 02 authors the signed `dHeadingDeg` precisely
 * because the direction is choreography, not geometry.
 *
 * So the beat's yaw is the RUNNING SUM, deliberately un-normalised — count 3 sits at 450° rather
 * than 90° so that a plain lerp from count 2's 270° sweeps the authored way round. `checkYawChain`
 * asserts the sum still agrees with every authored absolute heading, mod 360.
 */
function beatForMove(m: KataMove, startS: number, yawRad: number): Beat {
  const [x, z] = embusenToWorldM(m.embusen.c, L_M);
  /* `tSlotS` is the count itself; doc 04 §6.3's pause class is the hold AFTER it. A beat owns both,
   * so the technique's clamped final frame is what fills the pause. */
  const durS = m.tSlotS + PAUSE_CLASSES[m.pause].v;
  return {
    kind: 'move',
    n: m.n,
    label: `${m.n}. ${m.label}`,
    startS,
    durS,
    x,
    z,
    yawRad,
    techClip: CLIP_FOR_TECHNIQUE[m.tech.id] ?? null,
    source: TECHNIQUE_SOURCE[m.tech.id] ?? 'standin',
    kiai: m.kiai,
  };
}

/**
 * Every accumulated yaw must still equal the authored absolute heading, mod 360. Returns the
 * offending counts; an empty array means the `dHeadingDeg` chain closes.
 *
 * Cheap, and it catches the failure that is otherwise invisible: one wrong delta rotates the whole
 * remainder of the kata, and a figure facing consistently wrong looks exactly like a figure facing
 * right if you do not know the kata.
 */
export function checkYawChain(kata: KataScore, tolDeg = 1e-6): readonly number[] {
  const bad: number[] = [];
  let yawDeg = 0;
  for (const m of kata.moves) {
    yawDeg += m.dHeadingDeg;
    const want = toWorldYawDeg(m.headingDeg);
    let d = (yawDeg - want) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    if (Math.abs(d) > tolDeg) bad.push(m.n);
  }
  return bad;
}

function beatForCeremony(p: CeremonyPhase, startS: number): Beat {
  return {
    kind: 'ceremony',
    n: 0,
    label: p.id.toLowerCase().replace(/_/g, ' '),
    startS,
    durS: p.durationS,
    /* Every ceremony phase happens at the embusen origin facing the shomen — the kata has not
     * started moving yet, and it returns here to finish. */
    x: 0,
    z: 0,
    yawRad: MODEL_FACING_OFFSET_RAD,
    techClip: null,
    source: null,
    kiai: false,
  };
}

/**
 * The score, laid out on a timeline. PURE — no three.js, no character, no GLB — so the layout can
 * be asserted in Node without a renderer, which is the only way these numbers ever get checked:
 * a wrong embusen coordinate is invisible on screen unless you already know the kata.
 */
/**
 * Slide the whole performance so its floor pattern is CENTRED on the dojo's embusen marking.
 *
 * doc 02's coordinates are relative to the kata's STARTING point, which is a corner of the pattern
 * and not its middle — Taikyoku Shodan runs from z = 0 to z = −3.78, so laid down raw it begins at
 * the centre of the 4.68 m marking and walks two metres off the far edge of it. The marking exists
 * to show exactly this pattern; a performance that leaves it is drawing the diagram in the wrong
 * place, not performing a different kata.
 *
 * Uniform across every beat, ceremony included: the offset re-places the performance, it does not
 * re-choreograph it, so the bow must stay where it is relative to count 1.
 */
function embusenCentre(beats: readonly Beat[]): { dx: number; dz: number } {
  const moves = beats.filter((b) => b.kind === 'move');
  if (moves.length === 0) return { dx: 0, dz: 0 };
  const xs = moves.map((b) => b.x);
  const zs = moves.map((b) => b.z);
  return {
    dx: -(Math.min(...xs) + Math.max(...xs)) / 2,
    dz: -(Math.min(...zs) + Math.max(...zs)) / 2,
  };
}

export function buildBeats(kata: KataScore): Beat[] {
  const beats: Beat[] = [];
  let t = 0;
  for (const p of kata.openingCeremony) {
    beats.push(beatForCeremony(p, t));
    t += p.durationS;
  }
  let yawDeg = 0;
  for (const m of kata.moves) {
    yawDeg += m.dHeadingDeg;
    const b = beatForMove(m, t, rootYawRad(yawDeg) + MODEL_FACING_OFFSET_RAD);
    beats.push(b);
    t += b.durS;
  }
  for (const p of kata.closingCeremony) {
    beats.push(beatForCeremony(p, t));
    t += p.durationS;
  }

  const { dx, dz } = embusenCentre(beats);
  return beats.map((b) => ({ ...b, x: b.x + dx, z: b.z + dz }));
}

export function buildChoreography(kata: KataScore, character: Character): Choreography {
  const beats = buildBeats(kata);
  const last = beats[beats.length - 1];
  const durationS = last === undefined ? 0 : last.startS + last.durS;

  /* Measured ONCE, here, because it drives the mixer to take its samples and must never run inside
   * the frame loop. It is a property of the clip, not of the kata, so once is also enough. */
  const stepSpeedMs = measureClipGroundSpeed(character, STEP_CLIP);

  let at = 0;
  /** The beat whose technique has already fired; `-1` re-arms the trigger. */
  let firedFor = -1;

  const choreography: Choreography = {
    beats,
    durationS,
    get at(): number {
      return at;
    },

    invalidate(): void {
      firedFor = -1;
    },

    update(tS: number): void {
      if (beats.length === 0) return;
      const now = ((tS % durationS) + durationS) % durationS;

      /* Linear scan from the current beat. The list is ~35 entries and playback is monotonic, so
       * this is O(1) amortised; a seek costs one wrap of the list and nothing else. */
      let i = at;
      if (now < beats[i]!.startS) i = 0;
      while (i + 1 < beats.length && now >= beats[i + 1]!.startS) i++;
      if (i !== at) {
        at = i;
        firedFor = -1;
      }

      const b = beats[i]!;
      const prev = i === 0 ? beats[beats.length - 1]! : beats[i - 1]!;
      const local = b.durS > 0 ? (now - b.startS) / b.durS : 1;

      /* ── root transform: travel from the previous beat's stance to this one ───────────────── */
      const k = smooth(local / TRAVEL_END_FRAC);
      character.root.position.x = prev.x + (b.x - prev.x) * k;
      character.root.position.z = prev.z + (b.z - prev.z) * k;

      /* Between two counts the yaws already carry the authored winding, so a PLAIN difference
       * turns the way doc 02 says. Across a ceremony boundary — and across the loop back to the
       * top — they do not share a winding origin, so there the shortest arc is the only sane
       * reading; the alternative is a figure that unwinds 450° on the walk back to rei. */
      const chained = b.kind === 'move' && prev.kind === 'move' && b.n === prev.n + 1;
      const dYaw = chained ? b.yawRad - prev.yawRad : shortestAngle(prev.yawRad, b.yawRad);
      character.root.rotation.y = prev.yawRad + dYaw * k;

      /* ── clip selection: step, then strike, then let the clamp hold ──────────────────────── */
      const distM = Math.hypot(b.x - prev.x, b.z - prev.z);
      const turning = Math.abs(dYaw) > 0.2;
      const stepping = distM > STEP_DISTANCE_MIN_M || turning;

      if (local >= TECH_FIRE_FRAC && b.techClip !== null) {
        if (firedFor !== i) {
          /* Fit the recorded strike to this count's remaining slot, so a fast count snaps and a
           * slow one settles — the tempo class reaching the body instead of stopping at the score. */
          const clip = character.clips.get(b.techClip);
          const remainingS = b.durS * (1 - TECH_FIRE_FRAC);
          const scale =
            clip === undefined || remainingS <= 0
              ? 1
              : Math.min(2.2, Math.max(0.6, clip.duration / remainingS));
          character.play(b.techClip, 0.12, { loop: 'once', timeScale: scale });
          firedFor = i;
        }
      } else if (b.kind === 'move' && stepping && local < TECH_FIRE_FRAC) {
        /* Cadence follows the ACTUAL ground speed of this count, not the clip's authored speed.
         * `distM` is covered over the travel window, so that window's duration — not the whole
         * slot — is what sets the speed. Without this the legs churn at the clip's own pace while
         * the body creeps along the embusen, which is the foot-slide the user reported. */
        const travelS = b.durS * TRAVEL_END_FRAC;
        const wantMs = travelS > 0 ? distM / travelS : 0;
        character.play(STEP_CLIP, 0.2, {
          timeScale: wantMs < STILL_SPEED_MS ? 1 : timeScaleForSpeed(stepSpeedMs, wantMs),
        });
      } else if (b.techClip === null) {
        character.play(REST_CLIP, 0.3);
      }
    },
  };

  /* Place the figure at beat 0 before the first frame, so boot never shows it at the origin in a
   * pose belonging to the end of the kata. */
  choreography.update(0);
  return choreography;
}
