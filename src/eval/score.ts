/**
 * B9 CRITIC — `src/eval/score.ts`
 *
 * `scoreMetric` / `scoreGroup` / `scoreStep` / `scoreKata` — doc 07 §6.3 VERBATIM — plus the
 * eleven gates of ARCHITECTURE.md §7.5 and `scoreRun`, which assembles the §3.11 `Scorecard`.
 *
 * ═══ THE THREE THINGS THIS FILE REFUSES TO DO ═════════════════════════════════════════════════
 *
 * 1. It never invents a tolerance. Every `tol` and `hardFail` arrives on a `MetricSpec` and comes
 *    from doc 07 (§2.6). "Three tolerances for one number" is what the panel called fatal (A6).
 * 2. It never lets an UNMEASURED metric read as a failure, and never lets it read as a pass. Doc 07
 *    §6.1: "Any key absent -> that metric is skipped for that step (weight redistributed)". A
 *    skipped metric contributes no weight, and the count of skips is reported.
 * 3. It never reports a green build for a run that could not be measured. A gate that was DISARMED
 *    (Channel C / G-5) or PENDING (nothing captured yet) returns `pass: true` — it must not be able
 *    to fail a build, exactly like an `armed: false` metric — but any PENDING gate forces
 *    `Scorecard.pass` to FALSE and is named in `flags.gatesPending`. A shape-correct all-zero
 *    scorecard therefore reads `pass: false`, with the reason printed.
 */

import type {
  BakeStats,
  CriticFinding,
  FixQueueEntry,
  GateId,
  KataId,
  LayerId,
  Level,
  MetricGroup,
  MetricId,
  MetricResult,
  MetricSpec,
  PoseTrack,
  Scorecard,
  StanceId,
  StepScore,
  TechniqueId,
  TempoTier,
  Verdict,
} from '../contracts';
import {
  BAKE_MAX_ERR_DEG,
  BAKE_MAX_STEP_DEG,
  GATE_THRESHOLDS,
  GROUP_WEIGHT,
  LAYER_WEIGHTS_DEFAULT,
  tickToSec,
} from '../contracts';
import { METRICS, METRIC_BY_ID, METRIC_NUMBER } from './metricSpecs';
import { CHANNEL_C_STATUS, referenceStatusSummary } from './referenceBank';

export const METRIC_GROUPS: readonly MetricGroup[] = Object.freeze(['G1', 'G2', 'G3', 'G4', 'G5']);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. §3.4.1's `ScoreMeta`, declared in the owning block.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface ScoreMeta {
  readonly kataId: KataId;
  readonly tempoTier: TempoTier;
  readonly gitSha: string;
  readonly trackHash: string;
  readonly contractHash: string;
  readonly captureProfile: 'none' | 'fast' | 'hero';
  readonly layerWeights: Readonly<Record<LayerId, number>>;
  readonly bake: BakeStats;
  readonly baselineSha: string | null;
}

/** Per-step context the `StepScore` shape needs and a `MetricResult` does not carry. */
export interface StepContext {
  readonly moveN: number;
  readonly label: string;
  readonly stance: StanceId;
  readonly tech: TechniqueId;
  readonly tick: number;
  readonly level?: Level;
}

/** Everything `scoreRun` needs beyond §3.13's three frozen arguments. All optional. */
export interface ScoreRunOpts {
  readonly steps?: readonly StepContext[];
  readonly threeRevision?: string;
  readonly generatedAt?: string;
  readonly flags?: Readonly<Record<string, string | number | boolean>>;
  readonly determinism?: { readonly seeksChecked: number; readonly mismatches: number };
  readonly perf?: Scorecard['perf'];
  readonly channelC?: Scorecard['channelC'];
  readonly diagnosticsWorst?: PoseTrack['diagnostics']['worst'] | null;
  /** G-10 inputs: the three verifiers, run by `tools/verify-all.mjs`. */
  readonly verifiers?: Readonly<Record<'constants' | 'reference' | 'contracts', boolean | null>>;
  /** G-11 input: did the OTHER required tempo tier pass? `null` = not run. */
  readonly otherTempoPass?: boolean | null;
  /** Non-full `CompileOpts.stageMask` makes every gate advisory and forces `pass: false` (§7.5). */
  readonly stageMaskFull?: boolean;
  readonly regression?: Scorecard['regression'];
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. doc 07 §6.3, verbatim.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The signed deviation doc 07 §6.3 scores. §6.3 says `d = |value - ref|` and adds "for asymmetric
 * tolerances use the signed branch" — six metrics (10, 17, 44, 45, 55, 57) publish a `+tol` and two
 * (56, 60) a `-tol`, so the branch is not optional.
 *
 *   'both'      d = |value - ref|
 *   'upperOnly' only an excursion ABOVE ref counts (rear heel gap, head bob, foot slide)
 *   'lowerOnly' only an excursion BELOW ref counts (ground penetration, silhouette IoU)
 */
export function deviation(value: number, ref: number, bound: MetricSpec['bound']): number {
  switch (bound) {
    case 'upperOnly':
      return Math.max(0, value - ref);
    case 'lowerOnly':
      return Math.max(0, ref - value);
    case 'both':
      return Math.abs(value - ref);
  }
}

/**
 * doc 07 §6.3:
 *   if d <= tol:        s = 100
 *   elif d >= hardFail: s = 0
 *   else:               s = 100 * (1 - (d - tol) / (hardFail - tol))
 *
 * `hardFail === tol` (metrics 28, 40, 58, 61 — the boolean/count rows) would divide by zero; there
 * the step is a cliff, which is what those rows mean.
 */
export function scoreMetric(
  value: number,
  ref: number,
  tol: number,
  hardFail: number,
  bound: MetricSpec['bound'] = 'both',
): number {
  const d = deviation(value, ref, bound);
  if (d <= tol) return 100;
  if (d >= hardFail) return 0;
  if (hardFail <= tol) return 0;
  return 100 * (1 - (d - tol) / (hardFail - tol));
}

/**
 * Verdict bands. §3.11 freezes the four names but no thresholds, so they are pinned here to the
 * ones the gates already use: `G-3` puts the step floor at 70, so 70 is the pass/warn boundary that
 * a step can absorb.
 *
 * `fatalCondition` exists because two doc 07 rows have a fatal trigger that is NOT "beyond
 * hard-fail": metric 51 `hip_lead_lag_s` is fatal on SIGN INVERSION (a value of +0.01 s is an
 * inverted chain but only 0.07 s from ref, well inside the +-0.12 hard-fail), and metric 40 is
 * fatal on an enum mismatch. `metrics.ts` passes the predicate; scoring cannot infer it.
 */
export function verdictOf(score: number, spec: MetricSpec, fatalCondition = false): Verdict {
  if (spec.fatal && (fatalCondition || score <= 0)) return 'fatal';
  if (score >= 100) return 'pass';
  if (score >= GATE_THRESHOLDS.stepScoreMin) return 'warn';
  return 'fail';
}

/** doc 07 §6.3 `scoreGroup(g) = Sum(w_i * s_i) / Sum(w_i)`. Empty group -> `null` (skipped). */
export function scoreGroup(results: readonly MetricResult[]): number | null {
  let num = 0;
  let den = 0;
  for (const r of results) {
    const w = METRIC_BY_ID[r.id]?.weight ?? 1;
    num += w * r.score;
    den += w;
  }
  return den === 0 ? null : num / den;
}

/**
 * doc 07 §6.3 `scoreStep = 0.34*G1 + 0.30*G2 + 0.12*G3 + 0.14*G4 + 0.10*G5`, with doc 07 §6.1's
 * redistribution rule applied at the GROUP level too: a group with no measured metric contributes
 * neither score nor weight. Without that, an unmeasured G5 (metrics 60/61/63 need pixels and cloth)
 * would silently cost every step 10 points and `G-3` would fail on a clean rig.
 */
export function scoreStep(groups: Readonly<Partial<Record<MetricGroup, number | null>>>): number {
  let num = 0;
  let den = 0;
  for (const g of METRIC_GROUPS) {
    const v = groups[g];
    if (v === null || v === undefined) continue;
    num += GROUP_WEIGHT[g] * v;
    den += GROUP_WEIGHT[g];
  }
  return den === 0 ? 0 : num / den;
}

/** doc 07 §6.3 `scoreKata = mean(scoreStep)` — NOT min; the minimum is `G-3`'s job. */
export function scoreKata(steps: readonly StepScore[]): number {
  if (steps.length === 0) return 0;
  let sum = 0;
  for (const s of steps) sum += s.score;
  return sum / steps.length;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. Step assembly.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const ZERO_GROUPS: Readonly<Record<MetricGroup, number>> = Object.freeze({
  G1: 0, G2: 0, G3: 0, G4: 0, G5: 0,
});

/**
 * Group `results` by `moveN` into `StepScore[]`, ascending. A group with no measured metric scores
 * `0` in the reported `groups` record (the frozen shape has no nullable slot) but is EXCLUDED from
 * the weighted step score — `groupsMeasured` in `flags` records which groups were real.
 */
export function buildSteps(
  results: readonly MetricResult[],
  faults: readonly CriticFinding[],
  steps: readonly StepContext[],
): readonly StepScore[] {
  const byMove = new Map<number, MetricResult[]>();
  for (const r of results) {
    const arr = byMove.get(r.moveN);
    if (arr) arr.push(r);
    else byMove.set(r.moveN, [r]);
  }
  const ctxByMove = new Map<number, StepContext>(steps.map((s) => [s.moveN, s]));
  const moveNs = [...new Set([...byMove.keys(), ...steps.map((s) => s.moveN)])].sort((a, b) => a - b);

  const out: StepScore[] = [];
  for (const moveN of moveNs) {
    const mine = byMove.get(moveN) ?? [];
    const ctx = ctxByMove.get(moveN);
    const perGroup: Partial<Record<MetricGroup, number | null>> = {};
    for (const g of METRIC_GROUPS) {
      perGroup[g] = scoreGroup(mine.filter((r) => METRIC_BY_ID[r.id]?.group === g));
    }
    const reported = { ...ZERO_GROUPS };
    for (const g of METRIC_GROUPS) reported[g] = perGroup[g] ?? 0;

    const tick = ctx?.tick ?? mine[0]?.tick ?? 0;
    out.push(
      Object.freeze({
        moveN,
        label: ctx?.label ?? '',
        stance: ctx?.stance ?? ('zenkutsu' as StanceId),
        tech: ctx?.tech ?? ('none' as TechniqueId),
        tick,
        tSec: tickToSec(tick),
        groups: Object.freeze(reported),
        score: scoreStep(perGroup),
        metrics: Object.freeze([...mine]),
        faults: Object.freeze(faults.filter((f) => f.moveN === moveN)),
      }),
    );
  }
  return Object.freeze(out);
}

/** Which groups actually produced a measurement, for `flags`. */
export function measuredGroups(results: readonly MetricResult[]): readonly MetricGroup[] {
  const seen = new Set<MetricGroup>();
  for (const r of results) {
    const g = METRIC_BY_ID[r.id]?.group;
    if (g) seen.add(g);
  }
  return Object.freeze(METRIC_GROUPS.filter((g) => seen.has(g)));
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. The fix queue — §7.4, §7.7. Worst first, deduped BY FILE, <= 20.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const FIX_QUEUE_MAX = 20;

/**
 * `suggestedDelta` is `null` whenever the metric's `refSource` is `'doc07'` AND an override exists
 * (§7.4). More precisely, and more usefully: it is null unless the reference we are nudging toward
 * is one we actually believe. A signed nudge computed against doc 07's seeded value walks the rig
 * away from docs 01/03 while the score rises — the mechanism by which Proposal A's fix queue would
 * have degraded authenticity automatically (judge 2, fatal A5).
 *
 * It is also null for every non-`'constant'` fix kind: "move `solveStance` by +0.0362" is not a
 * meaningful instruction.
 */
export function suggestedDeltaFor(worst: MetricResult, spec: MetricSpec): number | null {
  if (spec.fixSite.kind !== 'constant' && spec.fixSite.kind !== 'technique-keyframe') return null;
  if (spec.refSource === 'doc07' && spec.derivation !== undefined) return null;
  if (spec.unit === 'bool' || spec.unit === 'count') return null;
  if (!Number.isFinite(worst.delta)) return null;
  return -worst.delta;
}

/** Group every failing result by `fixSite.file`, worst first. */
export function buildFixQueue(
  results: readonly MetricResult[],
  findings: readonly CriticFinding[],
): readonly FixQueueEntry[] {
  const byFile = new Map<string, { worst: MetricResult; moves: Set<number> }>();
  for (const r of results) {
    if (r.score >= 100) continue;
    const key = r.fixSite.file;
    const cur = byFile.get(key);
    if (!cur) byFile.set(key, { worst: r, moves: new Set([r.moveN]) });
    else {
      cur.moves.add(r.moveN);
      if (r.score < cur.worst.score) cur.worst = r;
    }
  }

  const entries: FixQueueEntry[] = [];
  const claimed = new Set<string>();
  for (const [file, v] of byFile) {
    claimed.add(file);
    const spec = METRIC_BY_ID[v.worst.id];
    entries.push(
      Object.freeze({
        fixSite: v.worst.fixSite,
        worst: v.worst,
        finding: findings.find((f) => f.id === v.worst.id) ?? null,
        affectedMoves: Object.freeze([...v.moves].sort((a, b) => a - b)),
        suggestedDelta: spec ? suggestedDeltaFor(v.worst, spec) : null,
        rank: 0,
      }),
    );
  }

  /**
   * A fault predicate can fire on a file that no METRIC blames — doc 01 §9's Z7 (knee valgus) and
   * doc 03 §11.1's F1 (chicken-winged elbow) have no doc 07 metric at all. Those still need a work
   * item, or the executable-predicate channel would be advisory in practice.
   */
  for (const f of findings) {
    const first = f.fixSites[0];
    if (!first || claimed.has(first.file)) continue;
    claimed.add(first.file);
    entries.push(
      Object.freeze({
        fixSite: first,
        worst: null,
        finding: f,
        affectedMoves: Object.freeze([f.moveN]),
        suggestedDelta: null,
        rank: 0,
      }),
    );
  }

  /** Worst first. A fault-only entry has no score, so it sorts alongside a score-0 metric. */
  entries.sort((a, b) => (a.worst?.score ?? 0) - (b.worst?.score ?? 0));
  return Object.freeze(
    entries.slice(0, FIX_QUEUE_MAX).map((e, i) => Object.freeze({ ...e, rank: i + 1 })),
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. The gates — §7.5.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A gate's `detail` always begins with one of these four words, so a reader (and
 * `tools/critic.mjs`) can tell a real failure from an un-measurable one without parsing prose.
 *
 *   PASS      evaluated, held
 *   FAIL      evaluated, did not hold        -> pass: false, blocks the build
 *   DISARMED  deliberately not armed          -> pass: true, recorded in flags.gatesDisarmed
 *   PENDING   not evaluable in this run       -> pass: true, recorded in flags.gatesPending,
 *                                               and forces Scorecard.pass = false
 */
export type GateStatus = 'PASS' | 'FAIL' | 'DISARMED' | 'PENDING';

const gate = (status: GateStatus, detail: string): { pass: boolean; detail: string } =>
  Object.freeze({ pass: status !== 'FAIL', detail: `${status} — ${detail}` });

export const gateStatusOf = (detail: string): GateStatus =>
  (detail.split(' ')[0] as GateStatus) ?? 'PENDING';

/**
 * G-5 ships DISARMED. Channel C needs the 16 public-domain 1925 Funakoshi plates from Wikimedia
 * Commons, and this project downloads nothing, ever (docs/BRIEFS.md project constraint 2). The
 * reference bank is EMPTY, `posture-match.json` does not exist and has not been human-signed, and
 * §8 Phase 5 makes arming G-5 an explicit later step. It is disarmed here rather than absent so no
 * reader can mistake "no Channel C data" for "Channel C passed".
 */
export const GATE_ARMED: Readonly<Record<GateId, boolean>> = Object.freeze({
  'G-1': true, 'G-2': true, 'G-3': true, 'G-4': true,
  'G-5': false,
  'G-6': true, 'G-7': true, 'G-8': true, 'G-9': true, 'G-10': true, 'G-11': true,
});

export interface GateInput {
  readonly card: Omit<Scorecard, 'gates' | 'pass' | 'fixQueue'>;
  readonly verifiers?: ScoreRunOpts['verifiers'];
  readonly otherTempoPass?: boolean | null;
  readonly diagnosticsWorst?: PoseTrack['diagnostics']['worst'] | null;
}

/** §3.13's `GATES`. Each `test` is a pure function of the scorecard-so-far. */
export const GATES: readonly {
  readonly id: GateId;
  readonly test: (i: GateInput) => { pass: boolean; detail: string };
}[] = Object.freeze([
  {
    id: 'G-1' as GateId,
    test: ({ card }: GateInput) => {
      if (card.steps.length === 0) return gate('PENDING', 'no steps scored (needs B2 kata + B3 compileKata)');
      const ok = card.score >= GATE_THRESHOLDS.kataScoreMin;
      return gate(ok ? 'PASS' : 'FAIL', `scoreKata ${card.score.toFixed(2)} vs >= ${GATE_THRESHOLDS.kataScoreMin} (07 §6.3)`);
    },
  },
  {
    id: 'G-2' as GateId,
    test: ({ card }: GateInput) => {
      const armedFatal: string[] = [];
      for (const s of card.steps) {
        for (const r of s.metrics) {
          if (r.verdict === 'fatal' && r.armed) armedFatal.push(`${r.id}@step${r.moveN}`);
        }
      }
      if (card.steps.length === 0) return gate('PENDING', 'no metrics evaluated');
      return armedFatal.length === 0
        ? gate('PASS', 'no ARMED metric flagged fatal (07 §6.3)')
        : gate('FAIL', `armed fatal: ${armedFatal.join(', ')}`);
    },
  },
  {
    id: 'G-3' as GateId,
    test: ({ card }: GateInput) => {
      if (card.steps.length === 0) return gate('PENDING', 'no steps scored');
      let min = Infinity;
      let at = 0;
      for (const s of card.steps) if (s.score < min) { min = s.score; at = s.moveN; }
      const ok = min >= GATE_THRESHOLDS.stepScoreMin;
      return gate(ok ? 'PASS' : 'FAIL', `min(scoreStep) ${min.toFixed(2)} at step ${at} vs >= ${GATE_THRESHOLDS.stepScoreMin}`);
    },
  },
  {
    id: 'G-4' as GateId,
    /**
     * "G1 >= 80 AND G2 >= 80 on EVERY step" (07 §6.3).
     *
     * The unmeasured case has to be handled explicitly. `StepScore.groups` is a frozen
     * `Record<MetricGroup, number>` with no nullable slot, so a group that produced no measurement
     * is REPORTED as 0 — and reading that 0 as a score would make this gate FAIL on a clean rig for
     * which the G1 pass simply had not run. It is not a failure and it is not a pass: it is PENDING.
     * The presence test reads `s.metrics`, which is on the frozen shape.
     */
    test: ({ card }: GateInput) => {
      if (card.steps.length === 0) return gate('PENDING', 'no steps scored');
      const absent: string[] = [];
      const bad: string[] = [];
      for (const s of card.steps) {
        const has = (g: MetricGroup): boolean =>
          s.metrics.some((r) => METRIC_BY_ID[r.id]?.group === g);
        for (const g of ['G1', 'G2'] as const) {
          if (!has(g)) {
            absent.push(`step${s.moveN} ${g}`);
            continue;
          }
          const min = g === 'G1' ? GATE_THRESHOLDS.g1PerStepMin : GATE_THRESHOLDS.g2PerStepMin;
          if (s.groups[g] < min) bad.push(`step${s.moveN} ${g}=${s.groups[g].toFixed(1)}`);
        }
      }
      if (bad.length) return gate('FAIL', bad.join(', '));
      if (absent.length) {
        return gate(
          'PENDING',
          `no G1/G2 measurement on ${absent.length} step-group(s): ${absent.slice(0, 8).join(', ')}` +
            `${absent.length > 8 ? ' …' : ''} — an unmeasured group reports 0 in StepScore.groups and ` +
            `must not be read as a score`,
        );
      }
      return gate('PASS', `G1 and G2 >= 80 on all ${card.steps.length} steps`);
    },
  },
  {
    id: 'G-5' as GateId,
    test: ({ card }: GateInput) => {
      if (!GATE_ARMED['G-5']) return gate('DISARMED', CHANNEL_C_STATUS.reason);
      const c = card.channelC;
      if (!c) return gate('PENDING', 'Channel C not run');
      const ok = c.pckH >= GATE_THRESHOLDS.channelCPckMin && c.matched >= GATE_THRESHOLDS.channelCMatchedMin;
      return gate(ok ? 'PASS' : 'FAIL', `PCK@0.030H ${c.pckH.toFixed(3)} on ${c.matched} posture-matched plates`);
    },
  },
  {
    id: 'G-6' as GateId,
    test: ({ card }: GateInput) => {
      if (card.captureProfile === 'none') {
        return gate('PENDING', 'Channel D judges PIXELS; no capture in this run (--profile none)');
      }
      const tierA = card.findings.filter((f) => f.tier === 'A' && f.source === 'vlm');
      return tierA.length === 0
        ? gate('PASS', 'Channel D reports zero Tier-A findings (07 §6.8)')
        : gate('FAIL', `Tier-A: ${tierA.map((f) => f.id).join(', ')}`);
    },
  },
  {
    id: 'G-7' as GateId,
    test: ({ card }: GateInput) => {
      const d = card.determinism;
      if (d.seeksChecked === 0) return gate('PENDING', 'verifyDeterminism has not run (needs B6 createSampler)');
      const ok = d.mismatches <= GATE_THRESHOLDS.determinismMismatchesMax;
      return gate(ok ? 'PASS' : 'FAIL', `${d.mismatches} mismatch(es) over ${d.seeksChecked} random seek sequences`);
    },
  },
  {
    id: 'G-8' as GateId,
    test: ({ diagnosticsWorst }: GateInput) => {
      if (!diagnosticsWorst) return gate('PENDING', 'no SolveDiagnostics (needs B3 compileKata)');
      const ok = diagnosticsWorst.ikResidualM < GATE_THRESHOLDS.ikResidualMaxM;
      return gate(
        ok ? 'PASS' : 'FAIL',
        `max ikResidual ${diagnosticsWorst.ikResidualM.toExponential(3)} m at tick ` +
          `${diagnosticsWorst.ikResidualAtTick} (move ${diagnosticsWorst.ikResidualMoveN}) vs < ${GATE_THRESHOLDS.ikResidualMaxM} m`,
      );
    },
  },
  {
    id: 'G-9' as GateId,
    test: ({ card }: GateInput) => {
      const b = card.bake;
      if (b.baseFrames === 0) return gate('PENDING', 'nothing baked (needs B3 bakeSegments)');
      const a = b.maxSlerpErrDeg < BAKE_MAX_ERR_DEG;
      const bb = b.maxStepDeg <= BAKE_MAX_STEP_DEG;
      const c = b.eventsBelow20msExact;
      const detail =
        `G-9a maxSlerpErrDeg ${b.maxSlerpErrDeg.toFixed(4)} < ${BAKE_MAX_ERR_DEG} : ${a}; ` +
        `G-9b maxStepDeg ${b.maxStepDeg.toFixed(3)} <= ${BAKE_MAX_STEP_DEG} : ${bb}; ` +
        `G-9c eventsBelow20msExact : ${c}`;
      return gate(a && bb && c ? 'PASS' : 'FAIL', detail);
    },
  },
  {
    id: 'G-10' as GateId,
    test: ({ verifiers }: GateInput) => {
      if (!verifiers) return gate('PENDING', 'verifier results not supplied (run node tools/verify-all.mjs)');
      const unknown = Object.entries(verifiers).filter(([, v]) => v === null).map(([k]) => k);
      const failed = Object.entries(verifiers).filter(([, v]) => v === false).map(([k]) => k);
      if (failed.length) return gate('FAIL', `verify-${failed.join(', verify-')} reported drift`);
      if (unknown.length) return gate('PENDING', `not run: verify-${unknown.join(', verify-')}`);
      return gate('PASS', 'verify-constants + verify-reference + verify-contracts all clean');
    },
  },
  {
    id: 'G-11' as GateId,
    test: ({ card, otherTempoPass }: GateInput) => {
      const need = GATE_THRESHOLDS.requiredTempoTiers;
      if (!need.includes(card.tempoTier)) {
        return gate('PENDING', `this run is ${card.tempoTier}; G-11 requires ${need.join(' and ')}`);
      }
      if (otherTempoPass === null || otherTempoPass === undefined) {
        const other = need.find((t) => t !== card.tempoTier);
        return gate('PENDING', `${card.tempoTier} measured; ${other} not run in this invocation`);
      }
      return otherTempoPass
        ? gate('PASS', `every gate holds at ${need.join(' and ')}`)
        : gate('FAIL', `gates hold at ${card.tempoTier} but not at the other required tier`);
    },
  },
]);

export function evaluateGates(input: GateInput): Readonly<Record<GateId, { pass: boolean; detail: string }>> {
  const out = {} as Record<GateId, { pass: boolean; detail: string }>;
  for (const g of GATES) out[g.id] = g.test(input);
  return Object.freeze(out);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 6. Zero values — the shape-correct "nothing measured yet" scorecard.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** A `BakeStats` with every field present and every number zero. `baseFrames === 0` means PENDING. */
export const ZERO_BAKE_STATS: BakeStats = Object.freeze({
  segments: 0,
  framesByRate: Object.freeze({ '120': 0, '240': 0, '480': 0, '960': 0 }),
  baseFrames: 0,
  bytes: 0,
  compileMs: 0,
  maxSlerpErrDeg: 0,
  maxStepDeg: 0,
  maxStepBone: 0 as unknown as BakeStats['maxStepBone'],
  maxStepAtTick: 0,
  eventsBelow20msExact: false,
  layerRecomposeErrDeg: 0,
  worstCaseChestYawDeg: 0,
  stageAssertsPassed: Object.freeze([]),
});

export const ZERO_DETERMINISM = Object.freeze({ seeksChecked: 0, mismatches: 0 });

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 7. `scoreRun` — §3.13.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `layerWeightsDirty` in scorecard terms: TRUE unless every weight is exactly its default (§6.5
 * interlock 3). `tools/score.mjs` exits non-zero when it is true, so no scorecard can ever be
 * produced from an out-of-spec composition.
 */
export function layerWeightsDirty(w: Readonly<Record<LayerId, number>>): boolean {
  for (const k of Object.keys(LAYER_WEIGHTS_DEFAULT) as LayerId[]) {
    if (w[k] !== LAYER_WEIGHTS_DEFAULT[k]) return true;
  }
  return false;
}

export function scoreRun(
  results: readonly MetricResult[],
  faults: readonly CriticFinding[],
  meta: ScoreMeta,
  opts: ScoreRunOpts = {},
): Scorecard {
  const steps = buildSteps(results, faults, opts.steps ?? []);
  const dirty = layerWeightsDirty(meta.layerWeights);
  const stageMaskFull = opts.stageMaskFull ?? true;

  const measured = measuredGroups(results);
  /**
   * `referenceStatusSummary()` is folded in HERE rather than left to the caller. The requirement is
   * that the disarmed state is visible IN THE SCORECARD; if `tools/score.mjs` had to remember to
   * pass it, an in-page `KataHarness.scorecard()` would silently omit it, and a silently absent
   * channel is exactly defect S-3 (§9.2).
   */
  const flags: Record<string, string | number | boolean> = {
    metricsDeclared: METRICS.length,
    metricResults: results.length,
    metricIdsNeverMeasured: unmeasuredMetrics(results).length,
    groupsMeasured: measured.join(',') || 'none',
    channelC: CHANNEL_C_STATUS.armed ? 'ARMED' : 'DISARMED',
    channelCReason: CHANNEL_C_STATUS.reason,
    ...referenceStatusSummary(),
    layerWeightsDirty: dirty,
    stageMaskFull,
    ...(opts.flags ?? {}),
  };

  const partial: Omit<Scorecard, 'gates' | 'pass' | 'fixQueue'> = {
    schema: 'kata-scorecard/3',
    kataId: meta.kataId,
    tempoTier: meta.tempoTier,
    gitSha: meta.gitSha,
    trackHash: meta.trackHash,
    contractHash: meta.contractHash,
    threeRevision: opts.threeRevision ?? '185',
    generatedAt: opts.generatedAt ?? '',
    captureProfile: meta.captureProfile,
    layerWeights: meta.layerWeights,
    flags: Object.freeze(flags),
    score: scoreKata(steps),
    steps,
    findings: Object.freeze([...faults]),
    channelC: opts.channelC ?? null,
    bake: meta.bake,
    determinism: opts.determinism ?? ZERO_DETERMINISM,
    perf: opts.perf ?? null,
    regression: opts.regression ?? null,
  };

  const gates = evaluateGates({
    card: partial,
    verifiers: opts.verifiers,
    otherTempoPass: opts.otherTempoPass ?? null,
    diagnosticsWorst: opts.diagnosticsWorst ?? null,
  });

  const disarmed: GateId[] = [];
  const pending: GateId[] = [];
  const failed: GateId[] = [];
  for (const [id, g] of Object.entries(gates) as [GateId, { pass: boolean; detail: string }][]) {
    const st = gateStatusOf(g.detail);
    if (st === 'DISARMED') disarmed.push(id);
    else if (st === 'PENDING') pending.push(id);
    else if (st === 'FAIL') failed.push(id);
  }

  /**
   * §7.5: "`layerWeightsDirty` or a non-full `stageMask` makes ALL gates advisory and sets
   * `pass: false`". Extended, for the same reason: a PENDING gate means the run could not answer
   * the question, so it cannot be a win either.
   */
  const pass =
    failed.length === 0 && pending.length === 0 && !dirty && stageMaskFull && steps.length > 0;

  const finalFlags = Object.freeze({
    ...flags,
    gatesDisarmed: disarmed.join(',') || 'none',
    gatesPending: pending.join(',') || 'none',
    gatesFailed: failed.join(',') || 'none',
  });

  return Object.freeze({
    ...partial,
    flags: finalFlags,
    gates,
    fixQueue: buildFixQueue(results, faults),
    pass,
  });
}

/**
 * The Phase-1 deliverable: a scorecard that is SHAPE-CORRECT with every value zero or absent.
 * Every field of §3.11 is present and correctly typed; nothing is faked as measured. `pass` is
 * `false` and `flags.gatesPending` names the gates that could not be answered.
 */
export function emptyScorecard(meta: ScoreMeta, opts: ScoreRunOpts = {}): Scorecard {
  return scoreRun([], [], meta, opts);
}

/** Every metric that produced no result at all, for the `scorecard.md` "not measured" block. */
export function unmeasuredMetrics(results: readonly MetricResult[]): readonly MetricId[] {
  const seen = new Set<MetricId>(results.map((r) => r.id));
  return Object.freeze(
    METRICS.filter((m) => !seen.has(m.id))
      .map((m) => m.id)
      .sort((a, b) => METRIC_NUMBER[a] - METRIC_NUMBER[b]),
  );
}
