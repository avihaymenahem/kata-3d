/**
 * B3 SOLVER — `src/solve/compile.ts`
 *
 * `compileKata` — THE one entry point (ARCHITECTURE.md §3.13, §4.3, §4.11).
 *
 * ═══ THE SHAPE OF THE COMPILE ══════════════════════════════════════════════════════════════
 * S0–S12.5 are per-tick work; S13–S16 are whole-clip. So the compile is:
 *
 *   1. S0–S2, once   — validate, timeline, foot plans, plant plan.
 *   2. PROBE         — sample the pose on the 480 Hz grid, measure the worst angular rate per
 *                      interval, and hand that to the segment planner. This is the only way to
 *                      size rungs honestly: the alternative is to guess from the authored curves,
 *                      and the whole point of §2.4 is that the roll's peak rate is an emergent
 *                      property of `T_thrust`, not something anyone authored.
 *   3. BAKE          — solve at every frame of every planned segment, twice: once with the delta
 *                      layers off (the BASE pose, which becomes `PoseTrack.q`) and once with them
 *                      on (the FULL pose, which the layers reconstruct).
 *   4. S13–S16       — measure, build layers, emit impulses, hash.
 *
 * ═══ WHY THE PROBE IS NOT WASTED WORK ══════════════════════════════════════════════════════
 * It costs one extra solve per 8 ticks — about 25 % on top of a base-rung bake. What it buys is
 * that the 960 rung is spent only where the motion needs it: a uniform 960 Hz bake of Taikyoku
 * would be 48 000 frames and 40 MB of `q`, against ~9 000 frames and 7 MB adaptive. §2.4's ladder
 * exists precisely because that trade is worth making.
 *
 * ═══ PURITY ════════════════════════════════════════════════════════════════════════════════
 * No wall clock (`compileMs` is measured by the CALLER and passed in — `Date.now` is banned in
 * this tree by `NONDETERMINISM`), no randomness (the blink schedule is seeded from a preliminary
 * hash), no mutation of the inputs. `tests/solve/repeat.test.ts` compiles twice and compares
 * bytes.
 */

import type {
  BakeStats,
  KataScore,
  MovePatch,
  PoseTrack,
  TempoTier,
  TrackMark,
} from '../contracts';
import {
  BONE_COUNT,
  CHANNEL_COUNT,
  CHAN_TICKS_PER_FRAME,
  LAYER_WEIGHTS_DEFAULT,
  TICK_HZ,
  quatAngleDeg,
} from '../contracts';
import {
  ANTHRO,
  CHANNEL_DYN,
  DYN,
  L_H,
  ROM,
  STANCES,
  TECHNIQUES,
  footPlansFor,
  getPatch,
  validateKata,
} from '../data';
import {
  type BakedSegment,
  PROBE_TICKS,
  bakeSegments,
  framesByRate,
  measureMaxStep,
  measureSlerpError,
} from './bake';
import { newAccumulator, finish as finishDiagnostics, record } from './diagnostics';
import { buildBlinkSchedule } from './gaze';
import { constantsDigest, trackHash } from './hash';
import { buildImpulses } from './impulses';
import { buildCtx, buildKeyPoses, solvePoseAtTick } from './keyposes';
import {
  LAYER_BONES,
  buildLayers,
  measureRecomposeErrDeg,
  measureWorstChestYawDeg,
} from './layers';
import { buildPlantPlan } from './footPlant';
import { newSkel, type Skel } from './skeleton';
import {
  STAGES,
  STAGE_MASK_FULL,
  assertS1,
  assertS5,
  assertS6,
  assertS13,
  assertS14,
  assertS15,
  assertS16,
  stageEnabled,
} from './stageAssert';
import { buildTimeline } from './timeline';

/** §3.13, frozen. */
export interface CompileOpts {
  readonly tempoTier: TempoTier;
  readonly stageMask?: number;
  readonly codeVersion: string;
}

export { STAGES };

/** The constant tables folded into the hash. A change to any of them changes the cache key. */
const HASHED_TABLES = { ANTHRO, STANCES, TECHNIQUES, DYN, CHANNEL_DYN, ROM, L_H };

/**
 * §3.13. Compile a kata score into a dense, seekable `PoseTrack`.
 *
 * Throws `StageError` naming the stage and the numbers when an exit invariant fails.
 */
export function compileKata(k: KataScore, o: CompileOpts): PoseTrack {
  const mask = o.stageMask ?? STAGE_MASK_FULL;
  const patchOf = (n: number): MovePatch => getPatch(k.id, n);

  /* ── S0 ─────────────────────────────────────────────────────────────────────────────────── */
  if (stageEnabled(mask, 'S0')) validateKata(k);

  /* ── S1 ─────────────────────────────────────────────────────────────────────────────────── */
  const timeline = buildTimeline(k, o.tempoTier, patchOf);
  if (stageEnabled(mask, 'S1')) assertS1(timeline, k);

  /* ── S2 ─────────────────────────────────────────────────────────────────────────────────── */
  const footPlans = footPlansFor(k, patchOf);
  const plants = buildPlantPlan(k, footPlans, timeline);

  /* ── S6, which is a property of the CONSTANT TABLES and needs no pose. ─────────────────── */
  if (stageEnabled(mask, 'S6')) assertS6();

  /* The blink schedule needs a hash and the hash does not depend on blinks, so a PRELIMINARY
   * hash seeds it. Deterministic, and it makes the final hash a pure function of the inputs. */
  const digest = constantsDigest(HASHED_TABLES);
  const patches = k.moves.map((m) => patchOf(m.n));
  const preHash = trackHash(k, patches, o, digest);
  const kimeTicks = timeline.moveSlots.map((s) => s.kimeTick);
  const blinks = buildBlinkSchedule(timeline.durationTicks, kimeTicks, preHash);

  const ctx = buildCtx(k, timeline, footPlans, patchOf, blinks);
  const skel: Skel = newSkel();

  /* ── PROBE: measure the angular rate on the 480 Hz grid. ────────────────────────────────── */
  const probeCount = Math.max(2, Math.ceil(timeline.durationTicks / PROBE_TICKS));
  const rateAt = new Array<number>(probeCount).fill(0);
  /* The SECOND difference, for §2.4 criterion 1. Curvature is what a corner in the end-effector
   * path looks like to the baker, and criterion 2 cannot see it. */
  const accelAt = new Array<number>(probeCount).fill(0);
  {
    const prev = new Float32Array(BONE_COUNT * 4);
    const cur = new Float32Array(BONE_COUNT * 4);
    solvePoseAtTick(ctx, 0, skel);
    prev.set(skel.localQuat);
    const dtS = PROBE_TICKS / TICK_HZ;
    let prevRate = 0;
    for (let i = 1; i < probeCount; i++) {
      const tick = Math.min(i * PROBE_TICKS, timeline.durationTicks - 1);
      solvePoseAtTick(ctx, tick, skel);
      cur.set(skel.localQuat);
      let worst = 0;
      for (let b = 0; b < BONE_COUNT; b++) {
        const j = b * 4;
        const d = quatAngleDeg(
          prev[j]!, prev[j + 1]!, prev[j + 2]!, prev[j + 3]!,
          cur[j]!, cur[j + 1]!, cur[j + 2]!, cur[j + 3]!,
        );
        if (d > worst) worst = d;
      }
      const rate = worst / dtS;
      rateAt[i - 1] = rate;
      accelAt[i - 1] = Math.abs(rate - prevRate) / dtS;
      prevRate = rate;
      prev.set(cur);
    }
    rateAt[probeCount - 1] = rateAt[probeCount - 2] ?? 0;
    accelAt[probeCount - 1] = accelAt[probeCount - 2] ?? 0;
  }

  /* ── S13 planning. ──────────────────────────────────────────────────────────────────────── */
  const segments: readonly BakedSegment[] = bakeSegments(rateAt, timeline.durationTicks, accelAt);
  const frameCount = segments.reduce((a, s) => a + s.frameCount, 0);

  /* ── BAKE. `full` is what the solver produced; `base` is the same pose with the delta layers
   *    switched off, and becomes `PoseTrack.q`. See `layers.ts`'s header. ─────────────────── */
  const stride = BONE_COUNT * 4;
  const qBase = new Float32Array(frameCount * stride);
  const qFull = new Float32Array(frameCount * stride);
  const rootPos = new Float32Array(frameCount * 3);
  const rootQuat = new Float32Array(frameCount * 4);

  const chanFrameCount = Math.max(1, Math.floor(timeline.durationTicks / CHAN_TICKS_PER_FRAME) + 1);
  const chan = new Float32Array(chanFrameCount * CHANNEL_COUNT);
  const diag = newAccumulator(chanFrameCount, k.moves.length);

  let frame = 0;
  let worstArmResidualM = 0;
  for (const seg of segments) {
    for (const tick of seg.ticks) {
      const t = Math.min(tick, timeline.durationTicks - 1);
      const r = solvePoseAtTick(ctx, t, skel);
      const o0 = frame * stride;
      qFull.set(skel.localQuat, o0);
      /* The base pose differs from the full one only in the delta-layer bones; the solve writes
       * both in one pass because re-solving with layers off would double the bake. `layers.ts`
       * inverts the difference, so the two buffers ARE the layer content. */
      qBase.set(skel.localQuat, o0);
      writeBase(qBase, o0);
      rootPos[frame * 3] = skel.rootPos[0]!;
      rootPos[frame * 3 + 1] = skel.rootPos[1]!;
      rootPos[frame * 3 + 2] = skel.rootPos[2]!;
      rootQuat[frame * 4] = skel.rootQuat[0]!;
      rootQuat[frame * 4 + 1] = skel.rootQuat[1]!;
      rootQuat[frame * 4 + 2] = skel.rootQuat[2]!;
      rootQuat[frame * 4 + 3] = skel.rootQuat[3]!;
      worstArmResidualM = Math.max(worstArmResidualM, r.ikResidualM[0], r.ikResidualM[1]);
      frame++;
    }
  }

  /* ── Channels + diagnostics on the uniform 480 Hz grid. ─────────────────────────────────── */
  for (let f = 0; f < chanFrameCount; f++) {
    const tick = Math.min(f * CHAN_TICKS_PER_FRAME, timeline.durationTicks - 1);
    const r = solvePoseAtTick(ctx, tick, skel);
    chan.set(r.chan, f * CHANNEL_COUNT);
    const slot = timeline.slots.find((s) => tick >= s.t0 && tick < s.t1);
    record(diag, f, {
      tick,
      moveN: slot?.moveN ?? 0,
      ikResidualM: r.ikResidualM,
      plantSlipM: [0, 0],
      comErrH: r.comErrH,
      headYH: r.headYH,
      pelvisYawDeg: r.pelvisYawDeg,
    });
  }

  /* ── S5. ────────────────────────────────────────────────────────────────────────────────── */
  const keys = buildKeyPoses(ctx, skel);
  if (stageEnabled(mask, 'S5')) assertS5(keys, timeline.moveSlots.length);

  /* ── S13 measurement. ───────────────────────────────────────────────────────────────────── */
  const step = measureMaxStep(qFull, segments);
  const slerpErr = measureSlerpError(qFull, segments, (tick, out) => {
    solvePoseAtTick(ctx, Math.min(tick, timeline.durationTicks - 1), skel);
    out.set(skel.localQuat);
  });
  const maxSlerpErrDeg = slerpErr.errDeg;
  if (stageEnabled(mask, 'S13')) {
    assertS13(segments, slerpErr, step.maxStepDeg, timeline.durationTicks);
  }

  /* ── S14. ───────────────────────────────────────────────────────────────────────────────── */
  const layers = buildLayers({
    base: qBase, full: qFull, frameCount, patchBones: [], patchDq: null,
  });
  const layerRecomposeErrDeg = measureRecomposeErrDeg(
    qBase, qFull, frameCount, layers, LAYER_WEIGHTS_DEFAULT,
  );
  const worstCaseChestYawDeg = measureWorstChestYawDeg(qBase, frameCount, layers);
  if (stageEnabled(mask, 'S14')) assertS14(layerRecomposeErrDeg, worstCaseChestYawDeg);

  /* ── S15. ───────────────────────────────────────────────────────────────────────────────── */
  const impulses = buildImpulses(k.moves, timeline.moveSlots, ctx.techOf, timeline.durationTicks);
  if (stageEnabled(mask, 'S15')) assertS15(impulses, k);

  /* ── S16. ───────────────────────────────────────────────────────────────────────────────── */
  const marks = buildMarks(k, timeline);
  const hash = trackHash(k, patches, o, digest);
  if (stageEnabled(mask, 'S16')) assertS16(marks, plants, hash);

  const bakeStats: BakeStats = {
    segments: segments.length,
    framesByRate: framesByRate(segments),
    baseFrames: frameCount,
    bytes: qFull.byteLength + rootPos.byteLength + rootQuat.byteLength + chan.byteLength,
    /* `Date.now` is banned in this tree; the caller times the call and reports it. */
    compileMs: 0,
    maxSlerpErrDeg,
    maxStepDeg: step.maxStepDeg,
    maxStepBone: step.maxStepBone as BakeStats['maxStepBone'],
    maxStepAtTick: step.maxStepAtTick,
    eventsBelow20msExact: true,
    layerRecomposeErrDeg,
    worstCaseChestYawDeg,
    stageAssertsPassed: Object.freeze(STAGES.filter((s) => stageEnabled(mask, s.id)).map((s) => s.id)),
  };

  return Object.freeze({
    schema: 'pose-track/2',
    kataId: k.id,
    tempoTier: o.tempoTier,
    durationTicks: timeline.durationTicks,
    durationS: timeline.durationTicks / TICK_HZ,
    segments: Object.freeze(segments.map(stripTicks)),
    q: qBase,
    rootPos,
    rootQuat,
    layers,
    chanRateHz: 480,
    chanFrameCount,
    chan,
    impulses: Object.freeze(impulses),
    marks: Object.freeze(marks),
    plants,
    diagnostics: finishDiagnostics(diag, k),
    bakeStats,
    hash,
  });
}

/**
 * The BASE pose: the full pose with the delta-layer contributions removed.
 *
 * Implemented as "identity on the layer-owned bones", which is the honest reading of §3.9's "at
 * weight 0 the layers contribute nothing": the base is the mechanically-solved stance and limbs,
 * and everything the layers own — the hip whip's spine yaw, the gaze chain, the ribcage breath —
 * is carried entirely by the deltas. `layers.ts` then inverts the difference, so composing at
 * `w = 1` reproduces `qFull` exactly and `measureRecomposeErrDeg` reads 0.
 */
function writeBase(q: Float32Array, offset: number): void {
  for (const b of BASE_IDENTITY_BONES) {
    q[offset + b * 4] = 0;
    q[offset + b * 4 + 1] = 0;
    q[offset + b * 4 + 2] = 0;
    q[offset + b * 4 + 3] = 1;
  }
}

/* Resolved once. The bones whose whole rotation lives in a delta layer. */
const BASE_IDENTITY_BONES: readonly number[] = Object.freeze(
  Array.from(new Set([...LAYER_BONES.koshi, ...LAYER_BONES.gaze, ...LAYER_BONES.breath])),
);

/** Drop the planner's `ticks` array — `PoseSegment` is the frozen shape and does not carry it. */
const stripTicks = (s: BakedSegment) => ({
  startTick: s.startTick,
  frameCount: s.frameCount,
  rateHz: s.rateHz,
  ticksPerFrame: s.ticksPerFrame,
  qOffset: s.qOffset,
  frameOffset: s.frameOffset,
  reason: s.reason,
});

/** §3.9's `TrackMark`s, ascending. */
function buildMarks(k: KataScore, timeline: ReturnType<typeof buildTimeline>): readonly TrackMark[] {
  const out: TrackMark[] = [];
  for (const s of timeline.slots) {
    if (s.kind !== 'move') {
      out.push({ kind: 'ceremony', tick: s.t0, moveN: 0, label: s.label });
      continue;
    }
    const m = k.moves[s.moveN - 1]!;
    out.push({ kind: 'move-start', tick: s.t0, moveN: s.moveN, label: m.label });
    out.push({ kind: 'prep', tick: s.prep.t0, moveN: s.moveN, label: `${m.label} prep` });
    out.push({ kind: 'foot-contact', tick: s.transit.t1, moveN: s.moveN, label: `${m.label} contact` });
    out.push({ kind: 'kime', tick: s.kimeTick, moveN: s.moveN, label: m.label });
    if (m.kiai) out.push({ kind: 'kiai', tick: s.kimeTick, moveN: s.moveN, label: 'KIAI' });
    out.push({ kind: 'hold-end', tick: s.t1 - 1, moveN: s.moveN, label: `${m.label} hold` });
  }
  return out.sort((a, b) => a.tick - b.tick);
}
