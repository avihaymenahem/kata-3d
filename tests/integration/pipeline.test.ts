/**
 * tests/integration/pipeline.test.ts — the GL-free numeric channel, end to end, in Node.
 *
 * ARCHITECTURE.md §4.9 ("compile -> solve -> joints -> metrics -> gates, Node, NO GL"), §7.1,
 * §9.1 A-12 ("`tests/integration/pipeline.test.ts` runs the same path under vitest").
 *
 * ═══ SCOPE AT THE PHASE-1 GATE ════════════════════════════════════════════════════════════════
 *
 * `compileKata` (B3) and `computeMetrics` (B9 `metrics.ts`) are Phase 2/3 (§8), so the COMPILE stage
 * is stood in for by a hand-built stub `PoseTrack` and a hand-built `JointStream`. Everything from
 * `joints` onward is the REAL shipping code: `buildCapturePlan`, `scoreMetric/Group/Step/Kata`,
 * `evaluateGates`, `buildFixQueue`, `renderScorecardMd`. When B3 lands, the stub is replaced by
 * `compileKata` and the rest of this file stays as it is.
 *
 * The stub is deliberately shaped like Heian Shodan (21 moves, kiai at 9 and 17, 12 right-arm
 * techniques, kokutsu on 18-21) so §7.3's published shot counts are checkable arithmetic rather than
 * a number this file invented: 115 + 12 + 8 + 4 + 1 = **140**.
 */

import { describe, expect, it } from 'vitest';
import type {
  BakeStats,
  CriticFinding,
  KataMove,
  KataScore,
  MetricResult,
  PoseTrack,
  SolveDiagnostics,
  TrackMark,
} from '../../src/contracts';
import {
  CANONICAL_COUNT,
  CANONICAL_INDEX,
  CHANNEL_COUNT,
  JOINT_RATE_HZ,
  LAYER_WEIGHTS_DEFAULT,
  TICK_HZ,
  secToTick,
} from '../../src/contracts';
import {
  JOINT_FLOATS_PER_FRAME,
  JOINT_TICKS_PER_FRAME,
  METRIC_BY_ID,
  ZERO_BAKE_STATS,
  buildCapturePlan,
  buildFixQueue,
  channelAt,
  createJointStream,
  decodeJointStream,
  deviation,
  emptyScorecard,
  encodeChannels,
  encodeJoints,
  gateStatusOf,
  jointComponent,
  jointSpeed,
  posOffset,
  renderScorecardMd,
  scoreGroup,
  scoreKata,
  scoreMetric,
  scoreRun,
  scoreStep,
  suggestedDeltaFor,
  summarisePlan,
  verdictOf,
} from '../../src/eval';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * The stand-in for B3's compile stage.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const MOVES = 21;
const KIAI_AT = [9, 17];
/** Twelve right-arm techniques, so §7.3 row 2's `M_RIGHT` count is 12, as published. */
const RIGHT_ARM = new Set([2, 4, 6, 8, 9, 10, 12, 14, 16, 17, 19, 21]);

function stubMove(n: number): KataMove {
  const kokutsu = n >= 18;
  return {
    n,
    label: kokutsu ? 'hidari chudan shuto-uke' : 'migi chudan oi-zuki',
    labelJp: '-',
    labelEn: '-',
    dHeadingDeg: 0,
    headingDeg: 0,
    rule: 'R1',
    pivot: null,
    pivotKind: 'NONE',
    mover: 'L',
    stance: kokutsu ? 'kokutsu' : 'zenkutsu',
    front: 'L',
    weighted: kokutsu ? 'R' : 'L',
    hips: 'shomen',
    tech: {
      id: kokutsu ? 'shuto-uke' : 'oi-zuki',
      arm: RIGHT_ARM.has(n) ? 'R' : 'L',
      level: 'chudan',
      targetH: 0.72,
      hand: kokutsu ? 'shuto' : 'seiken',
    },
    hikite: 'HIP-A',
    kiai: KIAI_AT.includes(n),
    tempo: 'N',
    pause: 'P1',
    sim: 'S1',
    tSlotS: 1.9,
    embusen: { ff: [0, 0], rf: [0, -1], c: [0, -0.5] },
    src: 'tests/integration/pipeline.test.ts (stub, not doc 02)',
  };
}

const STUB_KATA: KataScore = {
  schema: 'kata-score/1',
  id: 'heian-shodan',
  displayName: 'stub',
  displayNameJp: '-',
  moveCount: MOVES,
  kiaiAt: KIAI_AT,
  fastPairs: [[8, 9], [16, 17]],
  openingCeremony: [],
  moves: Array.from({ length: MOVES }, (_, i) => stubMove(i + 1)),
  closingCeremony: [],
  totalMoveSecondsT1: 39.75,
  provenance: ['stub'],
};

/** One mark set per move, plus the yoi/yame ceremony marks §7.3 row 1 needs. */
function stubMarks(): readonly TrackMark[] {
  const out: TrackMark[] = [{ kind: 'ceremony', tick: 0, moveN: 0, label: 'YOI' }];
  for (let n = 1; n <= MOVES; n++) {
    const base = secToTick(2 + n * 1.9);
    out.push({ kind: 'move-start', tick: base, moveN: n, label: `start ${n}` });
    out.push({ kind: 'kime', tick: base + secToTick(0.6), moveN: n, label: `kime ${n}` });
    if (KIAI_AT.includes(n)) {
      out.push({ kind: 'kiai', tick: base + secToTick(0.6), moveN: n, label: `kiai ${n}` });
    }
    out.push({ kind: 'hold-end', tick: base + secToTick(0.9), moveN: n, label: `hold ${n}` });
  }
  out.push({ kind: 'ceremony', tick: secToTick(2 + (MOVES + 1) * 1.9), moveN: 0, label: 'YAME' });
  return out.sort((a, b) => a.tick - b.tick);
}

const STUB_DIAGNOSTICS: SolveDiagnostics = {
  rateHz: 480,
  frameCount: 2,
  ikResidualM: new Float32Array(8),
  plantSlipM: new Float32Array(4),
  comErrH: new Float32Array(2),
  headYH: new Float32Array(2),
  pelvisYawDeg: new Float32Array(2),
  clampSatByMove: new Float32Array(0),
  worst: {
    ikResidualM: 0.0012, ikResidualAtTick: 4096, ikResidualMoveN: 4,
    plantSlipM: 0.0004, plantSlipAtTick: 5000,
    headBobH: 0.006, headBobMoveN: 3,
    clampSat: 0.4, clampSatBone: 0 as SolveDiagnostics['worst']['clampSatBone'],
  },
};

const GOOD_BAKE: BakeStats = {
  ...ZERO_BAKE_STATS,
  segments: 12,
  baseFrames: 5000,
  bytes: 1_000_000,
  compileMs: 180,
  maxSlerpErrDeg: 0.11,
  maxStepDeg: 9.4,
  eventsBelow20msExact: true,
  layerRecomposeErrDeg: 1e-6,
  worstCaseChestYawDeg: 14.2,
  stageAssertsPassed: ['S0', 'S13'],
};

function stubTrack(bake: BakeStats = GOOD_BAKE): PoseTrack {
  const marks = stubMarks();
  return {
    schema: 'pose-track/2',
    kataId: 'heian-shodan',
    tempoTier: 'T1',
    durationTicks: marks[marks.length - 1]!.tick,
    durationS: marks[marks.length - 1]!.tick / TICK_HZ,
    segments: [],
    q: new Float32Array(0),
    rootPos: new Float32Array(0),
    rootQuat: new Float32Array(0),
    layers: [],
    chanRateHz: 480,
    chanFrameCount: 0,
    chan: new Float32Array(0),
    impulses: [],
    marks,
    plants: [],
    diagnostics: STUB_DIAGNOSTICS,
    bakeStats: bake,
    hash: 'stub0000stub0000',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. The 480 Hz joint stream (§7.1, §9.1 A-7).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('JointStream — the substrate that makes metrics 49-52 measurable at all', () => {
  const FRAMES = 64;
  const pos = new Float32Array(FRAMES * JOINT_FLOATS_PER_FRAME);
  const chan = new Float32Array(FRAMES * CHANNEL_COUNT);
  // Move the right fist 1 m along +X over 64 frames: a constant 1/(63/480) m/s ~ 7.62 m/s.
  for (let f = 0; f < FRAMES; f++) {
    pos[posOffset(f, 'RightFistCenter')] = f / (FRAMES - 1);
    chan[f * CHANNEL_COUNT] = f / (FRAMES - 1); // breath
  }
  const s = createJointStream({ frameCount: FRAMES, pos, chan });

  it('runs at 480 Hz with 8 ticks per frame, and 3840/480 is exact', () => {
    expect(s.rateHz).toBe(JOINT_RATE_HZ);
    expect(JOINT_TICKS_PER_FRAME).toBe(8);
    expect(TICK_HZ / JOINT_RATE_HZ).toBe(JOINT_TICKS_PER_FRAME);
  });

  it('maps tick <-> frame by exact integer division and clamps at the tail', () => {
    expect(s.frameOfTick(0)).toBe(0);
    expect(s.frameOfTick(8)).toBe(1);
    expect(s.frameOfTick(15)).toBe(1);
    expect(s.frameOfTick(16)).toBe(2);
    expect(s.tickOfFrame(7)).toBe(56);
    // Clamped, not thrown: a hold-end mark can land one tick past the last dumped frame.
    expect(s.frameOfTick(-100)).toBe(0);
    expect(s.frameOfTick(1e9)).toBe(FRAMES - 1);
  });

  it('resolves doc 07 metric 50\'s 0.07 s brake to ~34 samples (§9.1 A-7)', () => {
    const framesIn70ms = 0.07 * JOINT_RATE_HZ;
    expect(Math.round(framesIn70ms)).toBe(34);
  });

  it('reads canonical joints and channels by name, allocation-free', () => {
    expect(jointComponent(s, FRAMES - 1, 'RightFistCenter', 0)).toBeCloseTo(1, 6);
    expect(jointComponent(s, 0, 'RightFistCenter', 0)).toBe(0);
    expect(channelAt(s, FRAMES - 1, 'breath')).toBeCloseTo(1, 6);
    expect(posOffset(0, 'Hips')).toBe(CANONICAL_INDEX.Hips * 3);
    expect(JOINT_FLOATS_PER_FRAME).toBe(CANONICAL_COUNT * 3);
  });

  it('measures a constant fist speed off the stream, not off chan.accel*', () => {
    const v = jointSpeed(s, 32, 'RightFistCenter');
    const expected = (1 / (FRAMES - 1)) / (1 / JOINT_RATE_HZ);
    expect(v).toBeCloseTo(expected, 4);
  });

  it('round-trips through the capture buffers of §7.3', () => {
    const back = decodeJointStream(encodeJoints(s), encodeChannels(s));
    expect(back.frameCount).toBe(FRAMES);
    expect(back.pos).toEqual(s.pos);
    expect(back.chan).toEqual(s.chan);
  });

  it('refuses a torn capture rather than trusting the shorter buffer', () => {
    expect(() => decodeJointStream(encodeJoints(s), new Float32Array(CHANNEL_COUNT).buffer)).toThrow(
      /torn capture/,
    );
  });

  it('refuses a startTick off the 480 Hz grid', () => {
    expect(() => createJointStream({ frameCount: 1, pos: new Float32Array(75), chan: new Float32Array(14), startTick: 3 })).toThrow(
      /not on the 480 Hz grid/,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. doc 07 §6.3, verbatim.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('scoreMetric — doc 07 §6.3 verbatim', () => {
  it('is 100 inside tol, 0 beyond hard-fail, linear between', () => {
    expect(scoreMetric(0.533, 0.533, 0.05, 0.15)).toBe(100);
    expect(scoreMetric(0.583, 0.533, 0.05, 0.15)).toBe(100); // exactly at tol
    expect(scoreMetric(0.683, 0.533, 0.05, 0.15)).toBe(0); // exactly at hard-fail
    expect(scoreMetric(0.783, 0.533, 0.05, 0.15)).toBe(0);
    // Half-way through the ramp.
    expect(scoreMetric(0.533 + 0.1, 0.533, 0.05, 0.15)).toBeCloseTo(50, 9);
  });

  it('reproduces §7.4\'s worked example arithmetic', () => {
    // value 0.4968, ref 0.5330, delta -0.0362, tol 0.05 -> INSIDE tol, so score 100.
    // §7.4 prints score 65, which back-solves to a tolerance §7.4 does not use; the ARITHMETIC that
    // matters is that there is exactly ONE scoring tolerance and it is doc 07's 0.05.
    const d = Math.abs(0.4968 - 0.533);
    expect(d).toBeCloseTo(0.0362, 4);
    expect(d).toBeLessThan(METRIC_BY_ID.stance_len_H.tol);
    expect(scoreMetric(0.4968, 0.533, 0.05, 0.15)).toBe(100);
  });

  it('applies the signed branch for one-sided tolerances', () => {
    // metric 10 rear_heel_gap_H: ref 0, +0.008 tol. A heel BELOW the floor is not a fault here.
    expect(deviation(-0.02, 0, 'upperOnly')).toBe(0);
    expect(deviation(+0.02, 0, 'upperOnly')).toBeCloseTo(0.02, 9);
    expect(scoreMetric(-0.02, 0, 0.008, 0.02, 'upperOnly')).toBe(100);
    expect(scoreMetric(+0.02, 0, 0.008, 0.02, 'upperOnly')).toBe(0);
    // metric 60 silhouette_IoU: ref 0.86, only a LOWER excursion counts.
    expect(scoreMetric(0.95, 0.86, 0.04, 0.16, 'lowerOnly')).toBe(100);
    expect(scoreMetric(0.7, 0.86, 0.04, 0.16, 'lowerOnly')).toBe(0);
  });

  it('does not divide by zero on the boolean/count rows where hardFail === tol + 0', () => {
    expect(scoreMetric(0, 1, 0, 1)).toBe(0);
    expect(scoreMetric(1, 1, 0, 1)).toBe(100);
  });

  it('weights groups 0.34/0.30/0.12/0.14/0.10 and REDISTRIBUTES an unmeasured group', () => {
    expect(scoreStep({ G1: 100, G2: 100, G3: 100, G4: 100, G5: 100 })).toBeCloseTo(100, 9);
    expect(scoreStep({ G1: 50, G2: 100, G3: 100, G4: 100, G5: 100 })).toBeCloseTo(83, 9);
    // An unmeasured G5 must not cost 10 points; it must not count at all (doc 07 §6.1).
    expect(scoreStep({ G1: 100, G2: 100, G3: 100, G4: 100, G5: null })).toBeCloseTo(100, 9);
    expect(scoreStep({})).toBe(0);
  });

  it('scoreGroup returns null for an empty group and scoreKata means over steps', () => {
    expect(scoreGroup([])).toBeNull();
    expect(scoreKata([])).toBe(0);
  });

  it('maps score to a verdict, and fatal only when the metric IS fatal', () => {
    const fatalSpec = METRIC_BY_ID.hikite_present;
    const plainSpec = METRIC_BY_ID.stance_width_H;
    expect(verdictOf(100, plainSpec)).toBe('pass');
    expect(verdictOf(85, plainSpec)).toBe('warn');
    expect(verdictOf(40, plainSpec)).toBe('fail');
    expect(verdictOf(0, plainSpec)).toBe('fail');
    expect(verdictOf(0, fatalSpec)).toBe('fatal');
    // metric 51's fatal trigger is a SIGN INVERSION, which scoring cannot infer.
    expect(verdictOf(60, METRIC_BY_ID.hip_lead_lag_s, true)).toBe('fatal');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. `buildCapturePlan` — the tick-sorted shot list of §7.3.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('buildCapturePlan — §7.3', () => {
  const track = stubTrack();
  const plan = buildCapturePlan(track, STUB_KATA);
  const sum = summarisePlan(plan);

  it('is SORTED ASCENDING BY TICK — the invariant the whole capture design rests on', () => {
    expect(sum.monotonic).toBe(true);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.tick, `shot ${i}`).toBeGreaterThanOrEqual(plan[i - 1]!.tick);
    }
  });

  it('produces §7.3\'s published Heian count: 115 + 12 + 8 + 4 + 1 = 140', () => {
    const base = plan.filter((s) => ['M_FRONT', 'M_LEFT', 'M_TOP', 'HERO', 'LOW34'].includes(s.camera));
    expect(base).toHaveLength(23 * 5); // 21 kime + yoi + yame, five default cameras
    expect(plan.filter((s) => s.camera === 'M_RIGHT')).toHaveLength(12);
    expect(plan.filter((s) => s.camera === 'DETAIL_HANDS')).toHaveLength(4);
    expect(plan.filter((s) => s.camera === 'DETAIL_FEET')).toHaveLength(4);
    expect(plan.filter((s) => s.camera === 'JUDGE')).toHaveLength(4);
    expect(plan.filter((s) => s.camera === 'EMBUSEN')).toHaveLength(1);
    expect(plan).toHaveLength(140);
    expect(sum.pngs).toBe(140);
  });

  it('fires M_TOP on EVERY kime, not once per kata (judge 1, fatal A4)', () => {
    expect(plan.filter((s) => s.camera === 'M_TOP' && s.mark === 'kime')).toHaveLength(21);
  });

  it('fires M_RIGHT only where the ACTING arm is the right', () => {
    for (const s of plan.filter((x) => x.camera === 'M_RIGHT')) {
      expect(RIGHT_ARM.has(s.moveN), `move ${s.moveN}`).toBe(true);
    }
  });

  it('emits 46 silhouette masks and 46 strips, on M_FRONT and M_LEFT only', () => {
    expect(sum.silhouettes).toBe(23 * 2);
    expect(sum.strips).toBe(23 * 2);
    for (const s of plan.filter((x) => x.silhouette || x.strip)) {
      expect(['M_FRONT', 'M_LEFT'], s.name).toContain(s.camera);
    }
  });

  it('names shots the §7.3 way: step-NN_tSS.SSS_mark_CAM_label_stance', () => {
    const one = plan.find((s) => s.moveN === 4 && s.camera === 'M_LEFT')!;
    expect(one.name).toMatch(/^step-04_t\d\d\.\d{3}_kime_M_LEFT_migi-chudan-oi-zuki_zenkutsu$/);
    const yoi = plan.find((s) => s.camera === 'EMBUSEN')!;
    expect(yoi.name).toMatch(/^yoi_t00\.000_ceremony_EMBUSEN$/);
  });

  it('subsets by --steps and by --cams without breaking the sort', () => {
    const subset = buildCapturePlan(track, STUB_KATA, { steps: [4, 9], cams: ['M_FRONT', 'HERO'] });
    expect(subset.length).toBeGreaterThan(0);
    for (const s of subset) expect(['M_FRONT', 'HERO']).toContain(s.camera);
    for (const s of subset) expect([0, 4, 9]).toContain(s.moveN); // 0 = the yoi/yame ceremony frames
    expect(summarisePlan(subset).monotonic).toBe(true);
  });

  it('drops silhouettes and strips when asked (a PNG-only hero pass)', () => {
    const p = buildCapturePlan(track, STUB_KATA, { noStrips: true });
    expect(summarisePlan(p).silhouettes).toBe(0);
    expect(summarisePlan(p).strips).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. Gates and the scorecard (§3.11, §7.5).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const META = {
  kataId: 'heian-shodan' as const,
  tempoTier: 'T1' as const,
  gitSha: 'testsha',
  trackHash: 'stub0000stub0000',
  contractHash: '36a86277afa0d663',
  captureProfile: 'none' as const,
  layerWeights: LAYER_WEIGHTS_DEFAULT,
  bake: ZERO_BAKE_STATS,
  baselineSha: null,
};

describe('the shape-correct all-zero scorecard — the Phase-1 deliverable', () => {
  const card = emptyScorecard(META);

  it('has every one of §3.11\'s 22 top-level fields', () => {
    expect(Object.keys(card).sort()).toEqual(
      [
        'bake', 'captureProfile', 'channelC', 'contractHash', 'determinism', 'findings', 'fixQueue',
        'flags', 'gates', 'generatedAt', 'gitSha', 'kataId', 'layerWeights', 'pass', 'perf',
        'regression', 'score', 'schema', 'steps', 'tempoTier', 'threeRevision', 'trackHash',
      ].sort(),
    );
    expect(card.schema).toBe('kata-scorecard/3');
    expect(card.score).toBe(0);
    expect(card.steps).toEqual([]);
    expect(card.channelC).toBeNull();
    expect(card.perf).toBeNull();
    expect(card.regression).toBeNull();
  });

  it('declares all eleven gates', () => {
    expect(Object.keys(card.gates)).toEqual([
      'G-1', 'G-2', 'G-3', 'G-4', 'G-5', 'G-6', 'G-7', 'G-8', 'G-9', 'G-10', 'G-11',
    ]);
  });

  it('reads pass: FALSE, because a run that measured nothing is not a win', () => {
    expect(card.pass).toBe(false);
    expect(String(card.flags.gatesPending)).not.toBe('none');
    expect(card.flags.gatesFailed).toBe('none');
  });

  it('makes the DISARMED state of Channel C / G-5 VISIBLE, not silently absent', () => {
    expect(gateStatusOf(card.gates['G-5'].detail)).toBe('DISARMED');
    expect(card.gates['G-5'].pass).toBe(true); // a disarmed gate can never fail a build
    expect(card.gates['G-5'].detail).toMatch(/EMPTY reference bank/);
    expect(card.gates['G-5'].detail).toMatch(/NOT downloaded/);
    expect(card.gates['G-5'].detail).toMatch(/HEIAN NIDAN/);
    expect(card.flags.channelC).toBe('DISARMED');
    expect(card.flags.gatesDisarmed).toBe('G-5');
    expect(card.flags.channelA_status).toBe('ABSENT');
  });

  it('never lets a DISARMED or PENDING gate report pass: false', () => {
    for (const g of Object.values(card.gates)) {
      const st = gateStatusOf(g.detail);
      if (st === 'DISARMED' || st === 'PENDING') expect(g.pass, g.detail).toBe(true);
    }
  });
});

describe('gates against a real bake and real diagnostics', () => {
  it('G-9 passes on a bake inside G-9a/b/c and fails outside', () => {
    const good = scoreRun([], [], { ...META, bake: GOOD_BAKE });
    expect(gateStatusOf(good.gates['G-9'].detail)).toBe('PASS');

    const bad = scoreRun([], [], { ...META, bake: { ...GOOD_BAKE, maxStepDeg: 52 } });
    expect(gateStatusOf(bad.gates['G-9'].detail)).toBe('FAIL');
    // 52 deg/key is doc 03 §4.3's forearm roll at 120 Hz — the arithmetic judge 1 called fatal.
    expect(bad.gates['G-9'].detail).toMatch(/maxStepDeg 52\.000 <= 12 : false/);
    expect(bad.pass).toBe(false);
  });

  it('G-8 reads the compiler\'s own worst ikResidual', () => {
    const card = scoreRun([], [], META, { diagnosticsWorst: STUB_DIAGNOSTICS.worst });
    expect(gateStatusOf(card.gates['G-8'].detail)).toBe('PASS');
    const worse = scoreRun([], [], META, {
      diagnosticsWorst: { ...STUB_DIAGNOSTICS.worst, ikResidualM: 0.02 },
    });
    expect(gateStatusOf(worse.gates['G-8'].detail)).toBe('FAIL');
  });

  it('G-10 is PENDING while verify-reference has not run, never PASS on two of three', () => {
    const two = scoreRun([], [], META, { verifiers: { constants: true, contracts: true, reference: null } });
    expect(gateStatusOf(two.gates['G-10'].detail)).toBe('PENDING');
    const three = scoreRun([], [], META, { verifiers: { constants: true, contracts: true, reference: true } });
    expect(gateStatusOf(three.gates['G-10'].detail)).toBe('PASS');
    const drift = scoreRun([], [], META, { verifiers: { constants: false, contracts: true, reference: true } });
    expect(gateStatusOf(drift.gates['G-10'].detail)).toBe('FAIL');
  });

  it('G-7 is PENDING at zero seeks, not a free pass on zero mismatches', () => {
    const zero = scoreRun([], [], META, { determinism: { seeksChecked: 0, mismatches: 0 } });
    expect(gateStatusOf(zero.gates['G-7'].detail)).toBe('PENDING');
    const real = scoreRun([], [], META, { determinism: { seeksChecked: 200, mismatches: 0 } });
    expect(gateStatusOf(real.gates['G-7'].detail)).toBe('PASS');
  });

  it('G-4 is PENDING on an unmeasured G1/G2, never FAIL on the reported 0', () => {
    // StepScore.groups has no nullable slot, so an unmeasured group reports 0. Reading that as a
    // score would fail G-4 on a clean rig whose G1 pass had not run.
    const g3Only = scoreRun(
      [failing('embusen_pos_err_H', 4, 0.01, 100)],
      [],
      META,
      { steps: [{ moveN: 4, label: '-', stance: 'zenkutsu', tech: 'oi-zuki', tick: 4000 }] },
    );
    expect(g3Only.steps[0]!.groups.G1).toBe(0);
    expect(gateStatusOf(g3Only.gates['G-4'].detail)).toBe('PENDING');
    expect(g3Only.gates['G-4'].detail).toMatch(/must not be read as a score/);

    // With both groups measured and above 80, it PASSES.
    const both = scoreRun(
      [failing('stance_len_H', 4, 0.533, 100), failing('hikite_fist_H', 4, 0.51, 100)],
      [],
      META,
      { steps: [{ moveN: 4, label: '-', stance: 'zenkutsu', tech: 'oi-zuki', tick: 4000 }] },
    );
    expect(gateStatusOf(both.gates['G-4'].detail)).toBe('PASS');

    // And with a measured G1 below 80 it FAILS, naming the step.
    const low = scoreRun(
      [failing('stance_len_H', 4, 0.47, 40), failing('hikite_fist_H', 4, 0.51, 100)],
      [],
      META,
      { steps: [{ moveN: 4, label: '-', stance: 'zenkutsu', tech: 'oi-zuki', tick: 4000 }] },
    );
    expect(gateStatusOf(low.gates['G-4'].detail)).toBe('FAIL');
    expect(low.gates['G-4'].detail).toMatch(/step4 G1=40\.0/);
  });

  it('a non-default layer weight sets pass: false (§6.5 interlock 3)', () => {
    const dirty = scoreRun([], [], {
      ...META,
      layerWeights: { ...LAYER_WEIGHTS_DEFAULT, koshi: 1.3 },
    });
    expect(dirty.flags.layerWeightsDirty).toBe(true);
    expect(dirty.pass).toBe(false);
  });

  it('a non-full stageMask sets pass: false (§7.5)', () => {
    expect(scoreRun([], [], META, { stageMaskFull: false }).pass).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. The fix queue (§7.4, §7.7) and the report (§7.3).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

function failing(id: MetricResult['id'], moveN: number, value: number, score: number): MetricResult {
  const spec = METRIC_BY_ID[id];
  return {
    id,
    moveN,
    tick: 1000 * moveN,
    camera: null,
    value,
    ref: spec.ref,
    delta: value - spec.ref,
    deltaPct: (100 * (value - spec.ref)) / spec.ref,
    score,
    verdict: verdictOf(score, spec),
    armed: spec.armed,
    fixSite: spec.fixSite,
    source: spec.source,
    provenance: 'stub',
  };
}

describe('the fix queue — grouped BY FILE, worst first (§7.7)', () => {
  const results = [
    failing('stance_len_H', 4, 0.47, 55),
    failing('stance_len_H', 7, 0.48, 62),
    failing('hip_height_H', 4, 0.45, 30),
    failing('head_bob_H', 3, 0.02, 20),
  ];

  it('emits at most one entry per file, ranked worst first', () => {
    const q = buildFixQueue(results, []);
    const files = q.map((e) => e.fixSite.file);
    expect(new Set(files).size).toBe(files.length);
    for (let i = 1; i < q.length; i++) {
      expect(q[i]!.rank).toBe(i + 1);
      expect(q[i - 1]!.worst!.score).toBeLessThanOrEqual(q[i]!.worst!.score);
    }
    // stance_len_H and hip_height_H both live in stances.ts, so they collapse to one work item.
    expect(files).toContain('src/data/constants/stances.ts');
    expect(files).toContain('src/solve/stance.ts');
    expect(files).toHaveLength(2);
  });

  it('records every affected move on the collapsed entry', () => {
    const q = buildFixQueue(results, []);
    const stances = q.find((e) => e.fixSite.file === 'src/data/constants/stances.ts')!;
    expect(stances.affectedMoves).toEqual([4, 7]);
  });

  it('suppresses suggestedDelta wherever the nudge would walk away from docs 01/03 (§7.4)', () => {
    // A solver fix site never gets a numeric nudge: "move solveStance by +0.0362" is not an
    // instruction.
    expect(suggestedDeltaFor(failing('head_bob_H', 3, 0.02, 20), METRIC_BY_ID.head_bob_H)).toBeNull();
    // A constant fix site does, and it points back TOWARD the reference.
    const d = suggestedDeltaFor(failing('stance_len_H', 4, 0.47, 55), METRIC_BY_ID.stance_len_H);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
    // Boolean/count rows never get one.
    expect(suggestedDeltaFor(failing('hikite_present', 4, 0, 0), METRIC_BY_ID.hikite_present)).toBeNull();
  });

  it('still routes a fault whose file no metric blames', () => {
    const finding: CriticFinding = {
      tier: 'A', id: 'Z7', moveN: 5, tick: 4000, tSec: 1.04, camera: 'M_FRONT',
      observation: 'front knee valgus', suggestedFix: 'pole vector',
      fixSites: [{
        file: 'src/solve/twoBoneIK.ts', symbol: 'solveTwoBone', knob: 'solveTwoBone()',
        kind: 'solver', block: 'B3', hint: 'pole vector',
      }],
      evidence: [], source: 'fault',
    };
    const q = buildFixQueue([], [finding]);
    expect(q).toHaveLength(1);
    expect(q[0]!.worst).toBeNull();
    expect(q[0]!.finding!.id).toBe('Z7');
    expect(q[0]!.suggestedDelta).toBeNull();
  });
});

describe('renderScorecardMd — §7.3 / §7.4', () => {
  const card = scoreRun(
    [failing('stance_len_H', 4, 0.47, 55)],
    [],
    { ...META, bake: GOOD_BAKE },
    { steps: [{ moveN: 4, label: 'migi chudan oi-zuki', stance: 'zenkutsu', tech: 'oi-zuki', tick: 4000 }] },
  );
  const md = renderScorecardMd(card);

  it('prints ONE scoring tolerance, labelled as doc 07\'s, plus the refSource', () => {
    expect(md).toContain('[tolerance from doc 07]');
    expect(md).toContain('[refSource doc01]');
    expect(md).toContain('hard-fail');
  });

  it('prints the derivation and the metric-1 bias note', () => {
    expect(md).toContain('derivation');
    expect(md).toContain('HEEL_BEHIND');
    expect(md).toMatch(/C15/);
  });

  it('prints the fix site as block / file / symbol / knob / kind', () => {
    expect(md).toContain('src/data/constants/stances.ts -> STANCES');
    expect(md).toContain('knob STANCES.zenkutsu.S.v');
    expect(md).toContain('(kind: constant)');
  });

  it('prints the gates table and the DISARMED Channel C notice', () => {
    expect(md).toContain('## Gates (§7.5)');
    expect(md).toContain('**Channel C / G-5 is DISARMED.**');
    expect(md).toContain('`stance_len_H`');
  });

  it('lists what was NOT measured, and says why that is not a zero', () => {
    expect(md).toContain('## Not measured (62 of 63)');
    expect(md).toContain('redistributed');
  });
});
