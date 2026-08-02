#!/usr/bin/env node
/**
 * tools/score.mjs — THE NUMERIC CHANNEL. Node only. **No GL, no browser, no playwright.**
 *
 * ARCHITECTURE.md §7.1 ("boots Vite in middleware mode (`tools/ssr.mjs` -> `server.ssrLoadModule`),
 * compiles both tracks, walks the 480 Hz canonical-joint stream, runs all 63 metrics and every fault
 * predicate, and writes the scorecard. ~9 s per kata. This gates every commit."), §7.2, §7.3, §7.4,
 * §9.1 A-12.
 *
 *   node tools/score.mjs                                   both kata, T1
 *   node tools/score.mjs --kata heian-shodan --step 9       one step, full metric detail on stdout
 *   node tools/score.mjs --tempo T2                         the second required tempo (gate G-11)
 *   node tools/score.mjs --sha <sha> --out reports           pin the output directory
 *   node tools/score.mjs --fail-on-pending                   CI mode: PENDING gates exit non-zero
 *
 * Writes, per §7.3:
 *   reports/<sha>/scorecard.json    the `Scorecard` of §3.11, VERBATIM
 *   reports/<sha>/scorecard.md      one row per metric per step, worst first, provenance in each row
 *   reports/<sha>/gates.json        G-1 .. G-11 pass/fail + detail  -> process exit code
 *   reports/<sha>/fixqueue.json     <= 20 FixQueueEntry, deduped by fixSite.file
 *   reports/<sha>/run.json          RunInfo-shaped record of the invocation
 *
 * ═══ WHAT IT PRODUCES AT THE PHASE-1 GATE, AND WHY THAT IS THE DELIVERABLE ═════════════════════
 *
 * `computeMetrics` (B9 `metrics.ts`, Phase 2) and `compileKata` (B3, Phase 2/3) do not exist yet, so
 * there is nothing to measure. This tool therefore writes a **shape-correct, all-zero/absent**
 * scorecard: every field of §3.11 present and correctly typed, `steps: []`, `score: 0`,
 * `pass: false`, and `flags.gatesPending` naming the gates that could not be answered. It does NOT
 * fabricate results. A zero-filled `MetricResult[]` would let a green run mean nothing was measured,
 * which is the one property the numeric channel exists to provide.
 *
 * NO DOMAIN LOGIC LIVES HERE (§4.9). Every number comes out of `ssrLoadModule`-ed TypeScript in
 * `src/eval` and `src/solve`; this file is argument parsing, orchestration and file writing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTrack, kataListOf, parseArgs } from './build-track.mjs';
import { explainSsrError, loadModule, stopSsr } from './ssr.mjs';
import { CONTRACT_FILES, contractHash, hashFile, runChecks } from './verify-contracts.mjs';
import { run as runVerifyConstants } from './verify-constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => path.join(ROOT, ...p.split('/'));

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. Run identity. Deterministic and never invented.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `git rev-parse --short HEAD`, or the literal `'nogit'`.
 *
 * It must NOT fall back to a timestamp or a random id: `reports/<sha>/` is the regression key
 * (§7.3, `--baseline <sha>`), and a changing sha would make every run its own baseline and silently
 * disable the regression gate.
 */
export function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || 'nogit';
  } catch {
    return 'nogit';
  }
}

/** The `contractHash` of §3.11 / §3.12, straight from the freeze manifest. */
export function currentContractHash() {
  const map = {};
  for (const f of CONTRACT_FILES) map[f] = hashFile(f);
  return contractHash(map);
}

/** `three`'s revision, read from the installed package. Never guessed. */
export function threeRevision() {
  try {
    const pkg = JSON.parse(readFileSync(abs('node_modules/three/package.json'), 'utf8'));
    const m = /^\d+\.(\d+)\./.exec(String(pkg.version));
    return m ? m[1] : String(pkg.version);
  } catch {
    return 'unknown';
  }
}

/**
 * G-10's three inputs. `verify-contracts` and `verify-constants` run in-process (the SSR server is
 * already warm); `verify-reference` does not exist until Phase 2, so it reports `null` = NOT RUN,
 * which makes G-10 PENDING with a precise reason instead of quietly passing on two of three.
 */
async function runVerifiers() {
  const out = { constants: null, reference: null, contracts: null };
  try {
    const { errors } = runChecks();
    out.contracts = errors.length === 0;
  } catch {
    out.contracts = false;
  }
  try {
    const r = await runVerifyConstants({});
    out.constants = r.summary.hardFailures === 0;
  } catch {
    out.constants = false;
  }
  // `verify-reference` is B9's Phase-2 file (§4.9). `null` means NOT RUN, which G-10 reports as
  // PENDING; it must never be reported as `true`, because two of three verifiers passing is not
  // "verify-constants + verify-reference + verify-contracts all clean".
  out.reference = existsSync(abs('tools/verify-reference.mjs')) ? false : null;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. Scoring one kata.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function writeText(dir, name, text) {
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  writeFileSync(p, text.endsWith('\n') ? text : `${text}\n`);
  return path.relative(ROOT, p).split(path.sep).join('/');
}

export async function scoreOne(kataId, o) {
  const evalMod = await loadModule('src/eval/index.ts');
  const contracts = await loadModule('src/contracts/index.ts');

  const compiled = await compileTrack(kataId, o.tempoTier, { codeVersion: o.codeVersion });
  const track = compiled.track;

  /* ── the pipeline, as far as it exists today ────────────────────────────────────────────── */
  const hasComputeMetrics = typeof evalMod.computeMetrics === 'function';
  const hasDetectFaults = typeof evalMod.detectFaults === 'function';

  let results = [];
  let faults = [];
  let steps = [];
  let plan = [];
  const pipeline = {
    compiled: compiled.status,
    computeMetrics: hasComputeMetrics,
    detectFaults: hasDetectFaults,
    jointStream: 'ABSENT',
  };

  /**
   * The 480 Hz canonical-joint stream (§7.3 `captures/<sha>/<kata>/joints.f32` + `chan.f32`).
   *
   * It is DECODED from a prior capture, never fabricated. An `emptyJointStream(0)` handed to
   * `computeMetrics` would read past the end of a zero-length buffer and produce `undefined`
   * positions that score as if they were measurements — the exact failure mode this whole tool
   * exists to prevent. No stream means metrics are SKIPPED and `pipeline.jointStream` says so.
   */
  let stream = null;
  const jointsPath = abs(`captures/${o.sha}/${kataId}/joints.f32`);
  const chanPath = abs(`captures/${o.sha}/${kataId}/chan.f32`);
  if (existsSync(jointsPath) && existsSync(chanPath)) {
    const jb = readFileSync(jointsPath);
    const cb = readFileSync(chanPath);
    stream = evalMod.decodeJointStream(
      jb.buffer.slice(jb.byteOffset, jb.byteOffset + jb.byteLength),
      cb.buffer.slice(cb.byteOffset, cb.byteOffset + cb.byteLength),
    );
    pipeline.jointStream = `${stream.frameCount} frames @ ${stream.rateHz} Hz`;
  }

  if (track !== null) {
    plan = evalMod.buildCapturePlan(track, compiled.kata, o.steps ? { steps: o.steps } : {});
    steps = compiled.kata.moves.map((m) => ({
      moveN: m.n,
      label: m.label,
      stance: m.stance,
      tech: m.tech.id,
      tick: track.marks.find((k) => k.kind === 'kime' && k.moveN === m.n)?.tick ?? 0,
      level: m.tech.level,
    }));
    if (hasComputeMetrics && stream !== null) {
      for (const m of compiled.kata.moves) {
        results = results.concat(evalMod.computeMetrics(stream, track, m.n));
      }
    }
    if (hasDetectFaults && stream !== null) faults = [...evalMod.detectFaults(stream, track)];
  }

  /* ── §3.4.1 ScoreMeta ──────────────────────────────────────────────────────────────────── */
  const meta = {
    kataId,
    tempoTier: o.tempoTier,
    gitSha: o.sha,
    trackHash: track?.hash ?? 'PENDING-B3',
    contractHash: o.contractHash,
    captureProfile: 'none',
    layerWeights: contracts.LAYER_WEIGHTS_DEFAULT,
    bake: track?.bakeStats ?? evalMod.ZERO_BAKE_STATS,
    baselineSha: o.baseline ?? null,
  };

  const card = evalMod.scoreRun(results, faults, meta, {
    steps,
    threeRevision: o.threeRevision,
    generatedAt: o.generatedAt,
    verifiers: o.verifiers,
    diagnosticsWorst: track?.diagnostics?.worst ?? null,
    // `referenceStatusSummary()` is folded in by `scoreRun` itself, so it is never missing.
    flags: {
      pipelineCompiled: pipeline.compiled,
      pipelineComputeMetrics: pipeline.computeMetrics,
      pipelineDetectFaults: pipeline.detectFaults,
      pipelineJointStream: pipeline.jointStream,
      capturePlanShots: plan.length,
      registryAuditProblems: evalMod.REGISTRY_AUDIT.problems.length,
      metric1ExpectedBiasH: Number(evalMod.METRIC_1_EXPECTED_BIAS_H.toFixed(6)),
      metric1ExpectedBiasPct: Number(evalMod.METRIC_1_EXPECTED_BIAS_PCT.toFixed(4)),
      ...(compiled.reason ? { pipelinePendingReason: compiled.reason } : {}),
    },
  });

  return { card, plan, track, evalMod, pipeline };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. CLI.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  let hadFail = false;
  let hadPending = false;

  try {
    const kataIds = kataListOf(values.kata);
    const tempoTier = values.tempo ?? 'T1';
    const sha = values.sha ?? gitSha();
    const outRoot = values.out ? path.resolve(ROOT, values.out) : abs('reports');
    const dir = path.join(outRoot, sha);
    const stepFilter = values.step
      ? values.step.split(',').map((s) => Number.parseInt(s, 10)).filter(Number.isFinite)
      : null;

    console.log(`score: sha ${sha}  tempo ${tempoTier}  kata ${kataIds.join(', ')}  (Node, NO GL)`);
    const verifiers = await runVerifiers();
    console.log(
      `  verifiers: contracts=${verifiers.contracts}  constants=${verifiers.constants}  ` +
        `reference=${verifiers.reference === null ? 'NOT RUN (tools/verify-reference.mjs is Phase 2)' : verifiers.reference}`,
    );

    const shared = {
      tempoTier,
      sha,
      contractHash: currentContractHash(),
      threeRevision: threeRevision(),
      // Deliberately NOT `new Date()`: it is recorded from the sha-scoped run, and two runs at one
      // sha must be byte-identical (tests/integration/repeatability.test.ts). `--now` overrides.
      generatedAt: values.now ?? `sha:${sha}`,
      verifiers,
      baseline: values.baseline ?? null,
      steps: stepFilter,
      codeVersion: 'phase1',
    };

    const written = [];
    for (const kataId of kataIds) {
      const { card, plan, evalMod, pipeline } = await scoreOne(kataId, shared);

      const suffix = kataIds.length > 1 ? `-${kataId}` : '';
      written.push(writeJson(dir, `scorecard${suffix}.json`, card));
      written.push(writeText(dir, `scorecard${suffix}.md`, evalMod.renderScorecardMd(card)));
      written.push(writeJson(dir, `gates${suffix}.json`, card.gates));
      written.push(writeJson(dir, `fixqueue${suffix}.json`, card.fixQueue));
      written.push(
        writeJson(dir, `run${suffix}.json`, {
          gitSha: card.gitSha,
          trackHash: card.trackHash,
          contractHash: card.contractHash,
          threeRevision: card.threeRevision,
          tempoTier: card.tempoTier,
          layerWeights: card.layerWeights,
          flags: card.flags,
          bake: card.bake,
          diagnosticsWorst: null,
          clothStateHash: 'PENDING-B7',
          perf: card.perf,
          capturePlan: evalMod.summarisePlan(plan),
          pipeline,
        }),
      );

      console.log('');
      console.log(evalMod.renderConsoleSummary(card));

      for (const g of Object.values(card.gates)) {
        const st = evalMod.gateStatusOf(g.detail);
        if (st === 'FAIL') hadFail = true;
        if (st === 'PENDING') hadPending = true;
      }

      // §6.5 interlock 3: no scorecard may EVER be produced from an out-of-spec composition.
      if (card.flags.layerWeightsDirty === true) {
        console.error('\nscore: ABORT — layerWeightsDirty. A scorecard from non-default layer weights is not a release measurement (§6.5).');
        process.exitCode = 2;
      }

      if (evalMod.REGISTRY_AUDIT.problems.length > 0) {
        console.error('\nscore: metric registry audit problems:');
        for (const p of evalMod.REGISTRY_AUDIT.problems) console.error(`  - ${p}`);
        hadFail = true;
      }
    }

    console.log('');
    for (const w of written) console.log(`  wrote ${w}`);
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(2)} s`);

    if (hadFail) {
      console.error('\nscore: a gate FAILED.');
      process.exitCode = 1;
    } else if (hadPending) {
      const msg =
        '\nscore: no gate FAILED; some are PENDING (the run could not answer them yet). ' +
        'Scorecard.pass is therefore false, by design — a shape-correct all-zero scorecard must ' +
        'never read as a win.';
      if (flags.has('fail-on-pending')) {
        console.error(`${msg}\n  --fail-on-pending was set, so this exits 1.`);
        process.exitCode = 1;
      } else {
        console.log(msg);
      }
    } else {
      console.log('\nscore: every gate PASS.');
    }
  } catch (err) {
    console.error(explainSsrError(err));
    process.exitCode = 1;
  } finally {
    await stopSsr();
  }
}
