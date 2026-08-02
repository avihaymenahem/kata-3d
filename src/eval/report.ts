/**
 * B9 CRITIC — `src/eval/report.ts`
 *
 * `renderScorecardMd`, `renderFixQueue`, `diffRuns`. ARCHITECTURE.md §7.3 (the artefact list),
 * §7.4 (the exact scorecard row), §4.9.
 *
 * ═══ THE ROW IS THE PRODUCT ═══════════════════════════════════════════════════════════════════
 *
 * §7.4's worked example is the specification, and the panel called Proposal A's version FATAL
 * because it was internally inconsistent (fatal A6: "three tolerances and the wrong datum for one
 * number"). So every row printed here carries, explicitly:
 *
 *   value / ref / delta / delta% / score / verdict
 *   metric   the doc 07 §6.2 row it comes from
 *   ref src  WHICH document won the reference, and via which symbol   [refSource ...]
 *   tol      ONE scoring tolerance, labelled as coming from doc 07
 *   derivation   the arithmetic, when the reference is derived
 *   FIX      block, file, symbol, knob, kind, hint, suggestedDelta
 *
 * No `Num.tol` ever appears as a scoring tolerance — §3.5 defines it as "how well we KNOW the
 * constant, never used in scoring", and conflating the two is exactly what A-6 was.
 *
 * Everything here is a pure string function of the `Scorecard`. No `node:fs` (this module also runs
 * in the browser through `KataHarness.scorecard`), no wall clock.
 */

import type {
  CriticFinding,
  FixQueueEntry,
  MetricGroup,
  MetricId,
  MetricResult,
  Scorecard,
  StepScore,
} from '../contracts';
import { GROUP_WEIGHT } from '../contracts';
import { METRICS, METRIC_BY_ID, METRIC_NOTES, METRIC_NUMBER } from './metricSpecs';
import { CHANNEL_C_STATUS } from './referenceBank';
import { gateStatusOf, unmeasuredMetrics } from './score';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Formatting primitives — deterministic, locale-free.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const n4 = (x: number): string => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');
const n2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const sgn = (x: number): string => (x >= 0 ? `+${n4(x)}` : n4(x));
const pad = (s: string, w: number): string => (s.length >= w ? s : s + ' '.repeat(w - s.length));

const VERDICT_MARK: Readonly<Record<string, string>> = Object.freeze({
  pass: 'PASS', warn: 'WARN', fail: 'FAIL', fatal: 'FATAL',
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * One metric row, §7.4 verbatim in structure.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export function renderMetricRow(r: MetricResult, step: StepScore): string {
  const spec = METRIC_BY_ID[r.id];
  const num = METRIC_NUMBER[r.id];
  const L: string[] = [];

  L.push(
    `STEP ${String(step.moveN).padStart(2, '0')}  ${step.stance} ${step.label ? `(${step.label})` : ''}`.trimEnd() +
      `  t = ${n4(step.tSec)} s  tick ${step.tick}  |  ${r.id}`,
  );
  L.push(
    `  value ${n4(r.value)} ${spec?.unit ?? ''}   ref ${n4(r.ref)} ${spec?.unit ?? ''}   ` +
      `delta ${sgn(r.delta)}   (${sgn(r.deltaPct)} %)   score ${Math.round(r.score)}   ` +
      `${VERDICT_MARK[r.verdict] ?? r.verdict}${r.armed ? '' : '   [NOT ARMED — cannot fail a gate]'}`,
  );
  L.push(`  metric   ${r.source}  (doc 07 §6.2 row ${num})`);
  if (spec) {
    L.push(`  ref src  ${spec.refSource}   [refSource ${spec.refSource}]`);
    L.push(
      `  tol      +-${n4(spec.tol)} (score 100)   hard-fail +-${n4(spec.hardFail)} (score 0)` +
        `   bound ${spec.bound}      [tolerance from doc 07]`,
    );
    if (spec.derivation) L.push(`  derivation  ${spec.derivation}`);
    const note = METRIC_NOTES[r.id];
    if (note) L.push(`  note     ${note}`);
  }
  if (r.provenance) L.push(`  provenance  ${r.provenance}`);
  const f = r.fixSite;
  L.push(
    `  FIX  ${f.block}  ${f.file} -> ${f.symbol}       knob ${f.knob}   (kind: ${f.kind})`,
  );
  L.push(`       hint ${f.hint}`);
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * `scorecard.md` — one row per metric per step, worst first, provenance in each row (§7.3).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface ReportOpts {
  /** Only print rows below this score. `100` prints everything that is not perfect. */
  readonly maxScore?: number;
  /** Cap the row count so a fully red run does not produce a 4 000-line file. */
  readonly maxRows?: number;
}

export function renderScorecardMd(card: Scorecard, opts: ReportOpts = {}): string {
  const maxScore = opts.maxScore ?? 100;
  const maxRows = opts.maxRows ?? 400;
  const L: string[] = [];

  L.push(`# Scorecard — ${card.kataId} @ ${card.tempoTier}`);
  L.push('');
  L.push(`* schema          \`${card.schema}\``);
  L.push(`* gitSha          \`${card.gitSha}\``);
  L.push(`* trackHash       \`${card.trackHash}\``);
  L.push(`* contractHash    \`${card.contractHash}\``);
  L.push(`* three revision  \`${card.threeRevision}\``);
  L.push(`* generatedAt     \`${card.generatedAt}\``);
  L.push(`* captureProfile  \`${card.captureProfile}\``);
  L.push(`* **scoreKata ${n2(card.score)}** over ${card.steps.length} step(s)`);
  L.push(`* **pass: ${card.pass}**`);
  L.push('');

  /* ── gates ─────────────────────────────────────────────────────────────────────────────── */
  L.push('## Gates (§7.5)');
  L.push('');
  L.push('| gate | status | detail |');
  L.push('|---|---|---|');
  for (const [id, g] of Object.entries(card.gates)) {
    const st = gateStatusOf(g.detail);
    L.push(`| ${id} | ${st} | ${g.detail.replace(/^\w+ — /, '')} |`);
  }
  L.push('');
  L.push(
    'A `DISARMED` or `PENDING` gate returns `pass: true` so it can never fail a build — the same ' +
      'rule `MetricSpec.armed` follows. Any `PENDING` gate nevertheless forces `pass: false` on the ' +
      'scorecard as a whole: a run that could not answer the question is not a win.',
  );
  L.push('');

  /* ── channels ──────────────────────────────────────────────────────────────────────────── */
  L.push('## Channels');
  L.push('');
  L.push('| channel | state |');
  L.push('|---|---|');
  L.push(`| A — numeric scorecard | ${card.steps.length > 0 ? 'RUN' : 'NO STEPS'} |`);
  L.push(`| B — synthetic reference overlay | ${card.captureProfile === 'none' ? 'NOT RUN (no capture)' : 'RUN'} |`);
  L.push(`| C — PD-1925 photo reprojection | **${CHANNEL_C_STATUS.armed ? 'ARMED' : 'DISARMED'}** |`);
  L.push(`| D — harsh critic rubric | ${card.captureProfile === 'none' ? 'NOT RUN (judges pixels)' : 'RUN'} |`);
  L.push('');
  if (!CHANNEL_C_STATUS.armed) {
    L.push(`> **Channel C / G-5 is DISARMED.** ${CHANNEL_C_STATUS.reason}`);
    L.push('>');
    L.push(
      `> When it is armed, comparison is TOPOLOGY ONLY: \`src/eval/pd1925.ts\` refuses ` +
        `${CHANNEL_C_STATUS.excludedMetrics.map((m) => `\`${m}\``).join(', ')} because 1920s Shuri-te ` +
        `postures are shallower and more upright than modern JKA (doc 07 §6.7 step 6).`,
    );
    L.push('');
  }

  /* ── flags ─────────────────────────────────────────────────────────────────────────────── */
  L.push('## Flags');
  L.push('');
  for (const [k, v] of Object.entries(card.flags)) L.push(`* \`${k}\` = \`${String(v)}\``);
  L.push('');

  /* ── bake ──────────────────────────────────────────────────────────────────────────────── */
  L.push('## Bake (G-9)');
  L.push('');
  const b = card.bake;
  L.push(`* segments ${b.segments}, baseFrames ${b.baseFrames}, bytes ${b.bytes}, compile ${n2(b.compileMs)} ms`);
  L.push(`* framesByRate 120:${b.framesByRate['120']} 240:${b.framesByRate['240']} 480:${b.framesByRate['480']} 960:${b.framesByRate['960']}`);
  L.push(`* G-9a maxSlerpErrDeg ${n4(b.maxSlerpErrDeg)}  ·  G-9b maxStepDeg ${n4(b.maxStepDeg)} (bone ${b.maxStepBone} @ tick ${b.maxStepAtTick})  ·  G-9c eventsBelow20msExact ${b.eventsBelow20msExact}`);
  L.push(`* layerRecomposeErrDeg ${b.layerRecomposeErrDeg.toExponential(2)}, worstCaseChestYawDeg ${n2(b.worstCaseChestYawDeg)}`);
  L.push('');

  /* ── group summary ─────────────────────────────────────────────────────────────────────── */
  if (card.steps.length > 0) {
    L.push('## Per-step group scores');
    L.push('');
    L.push(`| step | label | stance | ${(['G1', 'G2', 'G3', 'G4', 'G5'] as MetricGroup[]).map((g) => `${g} (${GROUP_WEIGHT[g]})`).join(' | ')} | step |`);
    L.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const s of card.steps) {
      L.push(
        `| ${s.moveN} | ${s.label} | ${s.stance} | ` +
          (['G1', 'G2', 'G3', 'G4', 'G5'] as MetricGroup[]).map((g) => n2(s.groups[g])).join(' | ') +
          ` | **${n2(s.score)}** |`,
      );
    }
    L.push('');
  }

  /* ── worst-first metric rows ───────────────────────────────────────────────────────────── */
  const rows: { r: MetricResult; s: StepScore }[] = [];
  for (const s of card.steps) for (const r of s.metrics) if (r.score < maxScore) rows.push({ r, s });
  rows.sort((a, b2) => a.r.score - b2.r.score);

  L.push(`## Metric rows — worst first (${rows.length} below ${maxScore})`);
  L.push('');
  if (rows.length === 0) {
    L.push('_No metric was measured below the threshold._');
    L.push('');
  } else {
    L.push('```');
    for (const { r, s } of rows.slice(0, maxRows)) {
      L.push(renderMetricRow(r, s));
      L.push('');
    }
    if (rows.length > maxRows) L.push(`... ${rows.length - maxRows} more row(s) omitted`);
    L.push('```');
    L.push('');
  }

  /* ── not measured ──────────────────────────────────────────────────────────────────────── */
  const missing = unmeasuredMetrics(card.steps.flatMap((s) => s.metrics));
  L.push(`## Not measured (${missing.length} of ${METRICS.length})`);
  L.push('');
  L.push(
    'doc 07 §6.1: an absent target means the metric is SKIPPED for that step and the weight is ' +
      'redistributed. A skipped metric is never scored 0.',
  );
  L.push('');
  if (missing.length > 0) {
    L.push(missing.map((m) => `\`${m}\` (#${METRIC_NUMBER[m]})`).join(', '));
    L.push('');
  }

  /* ── fix queue + findings ──────────────────────────────────────────────────────────────── */
  L.push(renderFixQueue(card.fixQueue));
  if (card.findings.length > 0) L.push(renderFindings(card.findings));

  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * `fixqueue.json` -> markdown. Grouped BY FILE, because the unit of contention is a file (§7.7).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export function renderFixQueue(queue: readonly FixQueueEntry[]): string {
  const L: string[] = [];
  L.push(`## Fix queue (${queue.length}, worst first, deduped by fixSite.file)`);
  L.push('');
  if (queue.length === 0) {
    L.push('_Empty._');
    L.push('');
    return L.join('\n');
  }
  L.push('| # | block | file | knob | kind | worst | moves | suggestedDelta |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const e of queue) {
    const w = e.worst;
    L.push(
      `| ${e.rank} | ${e.fixSite.block} | \`${e.fixSite.file}\` | \`${e.fixSite.knob}\` | ` +
        `${e.fixSite.kind} | ${w ? `${w.id} ${Math.round(w.score)}` : e.finding?.id ?? '-'} | ` +
        `${e.affectedMoves.join(',')} | ${e.suggestedDelta === null ? '`null`' : sgn(e.suggestedDelta)} |`,
    );
  }
  L.push('');
  L.push(
    '`suggestedDelta` is `null` whenever nudging the reference would walk the rig AWAY from docs ' +
      '01/03 (§7.4) and for every non-constant fix kind. That is the mechanism by which an automated ' +
      'fix queue would otherwise raise the score while lowering the quality (judge 2, fatal A5).',
  );
  L.push('');
  return L.join('\n');
}

export function renderFindings(findings: readonly CriticFinding[]): string {
  const L: string[] = [];
  L.push(`## Findings (${findings.length})`);
  L.push('');
  for (const tier of ['A', 'B', 'C'] as const) {
    const mine = findings.filter((f) => f.tier === tier);
    if (mine.length === 0) continue;
    L.push(`### Tier ${tier} (${mine.length})`);
    L.push('');
    for (const f of mine) {
      L.push(
        `* **${f.id}** step ${f.moveN} @ t=${n4(f.tSec)} s ` +
          `${f.camera ? `[${f.camera}] ` : ''}(${f.source}) — ${f.observation}`,
      );
      L.push(`  * fix: ${f.suggestedFix}`);
      for (const s of f.fixSites) L.push(`  * \`${s.file}\` -> \`${s.knob}\` (${s.block})`);
    }
    L.push('');
  }
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * `regression.json` — §7.5: "any metric regressing more than 5 points against `--baseline` fails
 * CI even if every gate passes".
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface RunDiff {
  readonly baseSha: string;
  readonly headSha: string;
  readonly deltas: readonly { readonly id: MetricId; readonly moveN: number; readonly scoreDelta: number }[];
  readonly worstRegression: number;
  readonly regressed: readonly { readonly id: MetricId; readonly moveN: number; readonly scoreDelta: number }[];
  readonly kataScoreDelta: number;
  readonly fails: boolean;
}

export const REGRESSION_MAX_DROP = 5;

/** Compare two scorecards metric-by-metric, keyed by `(id, moveN)`. */
export function diffRuns(base: Scorecard, head: Scorecard): RunDiff {
  const key = (id: MetricId, moveN: number): string => `${id}#${moveN}`;
  const baseScores = new Map<string, number>();
  for (const s of base.steps) for (const r of s.metrics) baseScores.set(key(r.id, r.moveN), r.score);

  const deltas: { id: MetricId; moveN: number; scoreDelta: number }[] = [];
  for (const s of head.steps) {
    for (const r of s.metrics) {
      const before = baseScores.get(key(r.id, r.moveN));
      if (before === undefined) continue;
      const d = r.score - before;
      if (d !== 0) deltas.push({ id: r.id, moveN: r.moveN, scoreDelta: d });
    }
  }
  deltas.sort((a, b) => a.scoreDelta - b.scoreDelta);
  const regressed = deltas.filter((d) => d.scoreDelta < -REGRESSION_MAX_DROP);
  return Object.freeze({
    baseSha: base.gitSha,
    headSha: head.gitSha,
    deltas: Object.freeze(deltas),
    worstRegression: deltas[0]?.scoreDelta ?? 0,
    regressed: Object.freeze(regressed),
    kataScoreDelta: head.score - base.score,
    fails: regressed.length > 0,
  });
}

export function renderDiffMd(d: RunDiff): string {
  const L: string[] = [];
  L.push(`# Regression — ${d.headSha} vs ${d.baseSha}`);
  L.push('');
  L.push(`* scoreKata delta ${sgn(d.kataScoreDelta)}`);
  L.push(`* worst single-metric regression ${sgn(d.worstRegression)} (fails CI below -${REGRESSION_MAX_DROP})`);
  L.push(`* **fails: ${d.fails}**`);
  L.push('');
  if (d.regressed.length > 0) {
    L.push('| metric | step | delta |');
    L.push('|---|---|---|');
    for (const r of d.regressed) L.push(`| ${r.id} | ${r.moveN} | ${sgn(r.scoreDelta)} |`);
    L.push('');
  }
  return L.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * A one-screen console summary for `tools/score.mjs`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export function renderConsoleSummary(card: Scorecard): string {
  const L: string[] = [];
  L.push(`  kata ${card.kataId} @ ${card.tempoTier}   scoreKata ${n2(card.score)}   pass=${card.pass}`);
  L.push(`  steps ${card.steps.length}   findings ${card.findings.length}   fixQueue ${card.fixQueue.length}`);
  for (const [id, g] of Object.entries(card.gates)) {
    L.push(`    ${pad(id, 5)} ${pad(gateStatusOf(g.detail), 9)} ${g.detail.replace(/^\w+ — /, '')}`);
  }
  return L.join('\n');
}
