#!/usr/bin/env node
/**
 * tools/build-track.mjs — headless compile of both tracks. No browser, no GL, no pixels.
 *
 * ARCHITECTURE.md §4.9, §7.2 (`npm run build:track -- --kata all --tempo T1`), §9.1 A-12.
 *
 *   node tools/build-track.mjs                          both kata at T1
 *   node tools/build-track.mjs --kata heian-shodan       one kata
 *   node tools/build-track.mjs --tempo T2                the second required tempo (gate G-11)
 *   node tools/build-track.mjs --stage-mask 0x7fff       debug bisection (makes gates advisory)
 *
 * Writes `reports/track-<kata>-<tempo>.json`: the `BakeStats`, the `SolveDiagnostics.worst` summary,
 * the mark/impulse/plant counts and the `trackHash`. Never the buffers — a `PoseTrack` is ~11 MB and
 * `reports/` is meant to be readable.
 *
 * ═══ WHAT THIS DOES BEFORE B3 EXISTS ══════════════════════════════════════════════════════════
 *
 * `compileKata` lands in Phase 2/3 (§8) and `src/data/kata/**` in Phase 2. Until then this tool
 * reports `status: 'PENDING'` with the exact missing module and exits **0** — a Phase-1 gate must not
 * be red because a Phase-2 file has not been written. The moment `src/solve/index.ts` exists, a
 * compile failure is a real failure and exits **1**. There is no path where a broken compiler is
 * reported as pending.
 *
 * This file contains NO domain logic (§4.9: "tools/*.mjs are not typechecked and therefore may not
 * contain domain logic; they read JSON and call `ssrLoadModule`-ed TypeScript"). Everything numeric
 * happens inside `src/solve` and `src/eval`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainSsrError, loadModule, stopSsr } from './ssr.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => path.join(ROOT, ...p.split('/'));

export const KATA_IDS = ['taikyoku-shodan', 'heian-shodan'];
export const CODE_VERSION = 'phase1';

/** Parse the flag set §7.2 gives `critic` / `score` / `shots`. Shared by the tools. */
export function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.values[name] = next;
      i++;
    } else {
      out.flags.add(name);
    }
  }
  return out;
}

export function kataListOf(value) {
  if (!value || value === 'all') return [...KATA_IDS];
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((k) => !KATA_IDS.includes(k));
  if (bad.length) throw new Error(`unknown kata id(s): ${bad.join(', ')}. Known: ${KATA_IDS.join(', ')}`);
  return ids;
}

/** `src/solve/index.ts` exists? Determines PENDING vs a real failure. */
export const solveBarrelExists = () => existsSync(abs('src/solve/index.ts'));
/** `src/data/kata/index.ts` exists? B2's barrel; `getKata` throws a RED-FIRST message until it does. */
export const kataBarrelExists = () => existsSync(abs('src/data/kata/index.ts'));

/**
 * Compile one kata, or return a PENDING record naming the block that owes the missing module.
 * Returns `{ status, kataId, tempoTier, track|null, reason|null }`. `track` is the live `PoseTrack`,
 * so a caller (`tools/score.mjs`) can walk it without a second compile.
 */
export async function compileTrack(kataId, tempoTier, o = {}) {
  const pending = (reason) => ({ status: 'PENDING', kataId, tempoTier, track: null, reason });

  if (!solveBarrelExists()) {
    return pending(
      'src/solve/index.ts does not exist — compileKata is B3, Phase 2/3 (ARCHITECTURE §8). ' +
        'Nothing to compile yet.',
    );
  }
  if (!kataBarrelExists()) {
    return pending(
      'src/data/kata/index.ts does not exist — the 41 authored moves are B2, Phase 2 ' +
        '(ARCHITECTURE §8). src/data/index.ts ships a typed landing site that throws RED-FIRST.',
    );
  }

  const data = await loadModule('src/data/index.ts');
  const solve = await loadModule('src/solve/index.ts');
  if (typeof solve.compileKata !== 'function') {
    throw new Error('src/solve barrel exists but exports no compileKata (§3.13)');
  }

  const kata = data.getKata(kataId);
  const opts = { tempoTier, codeVersion: o.codeVersion ?? CODE_VERSION };
  if (o.stageMask !== undefined && o.stageMask !== null) opts.stageMask = o.stageMask;
  const track = solve.compileKata(kata, opts);
  return { status: 'OK', kataId, tempoTier, track, reason: null, kata };
}

/** The JSON-safe summary written to `reports/track-<kata>-<tempo>.json`. */
export function summariseTrack(res) {
  if (res.status !== 'OK') {
    return {
      status: res.status,
      kataId: res.kataId,
      tempoTier: res.tempoTier,
      reason: res.reason,
      codeVersion: CODE_VERSION,
    };
  }
  const t = res.track;
  return {
    status: 'OK',
    schema: t.schema,
    kataId: t.kataId,
    tempoTier: t.tempoTier,
    trackHash: t.hash,
    durationTicks: t.durationTicks,
    durationS: t.durationS,
    segments: t.segments.length,
    counts: {
      marks: t.marks.length,
      impulses: t.impulses.length,
      plants: t.plants.length,
      layers: t.layers.length,
      chanFrames: t.chanFrameCount,
    },
    bake: t.bakeStats,
    diagnosticsWorst: t.diagnostics?.worst ?? null,
  };
}

function writeJson(relPath, value) {
  const p = abs(relPath);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
  return relPath;
}

export async function buildTracks(o = {}) {
  const kata = o.kata ?? [...KATA_IDS];
  const tempoTier = o.tempoTier ?? 'T1';
  const written = [];
  const results = [];
  for (const id of kata) {
    const res = await compileTrack(id, tempoTier, o);
    results.push(res);
    written.push(writeJson(`reports/track-${id}-${tempoTier}.json`, summariseTrack(res)));
  }
  return { results, written };
}

/* ── CLI ─────────────────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { values } = parseArgs(process.argv.slice(2));
  try {
    const kata = kataListOf(values.kata);
    const tempoTier = values.tempo ?? 'T1';
    const stageMask = values['stage-mask'] ? Number.parseInt(values['stage-mask'], 16) : null;

    const { results, written } = await buildTracks({ kata, tempoTier, stageMask });

    let pendingCount = 0;
    for (const r of results) {
      if (r.status === 'OK') {
        const b = r.track.bakeStats;
        console.log(
          `build-track: ${r.kataId} @ ${r.tempoTier}  hash ${r.track.hash}  ` +
            `${r.track.durationTicks} ticks  ${b.segments} segments  ${b.baseFrames} baseFrames  ` +
            `${b.compileMs.toFixed(1)} ms`,
        );
        console.log(
          `  G-9a maxSlerpErrDeg ${b.maxSlerpErrDeg.toFixed(4)}  ` +
            `G-9b maxStepDeg ${b.maxStepDeg.toFixed(3)}  G-9c ${b.eventsBelow20msExact}`,
        );
      } else {
        pendingCount++;
        console.log(`build-track: ${r.kataId} @ ${r.tempoTier}  status ${r.status}`);
        console.log(`  ${r.reason}`);
      }
    }
    for (const w of written) console.log(`  wrote ${w}`);

    if (pendingCount > 0) {
      console.log(
        `\nbuild-track: ${pendingCount} of ${results.length} PENDING — exiting 0 on purpose. ` +
          `A Phase-1 gate must not be red because a Phase-2/3 file has not been written yet. Once ` +
          `src/solve/index.ts exists, a compile failure exits 1.`,
      );
    }
  } catch (err) {
    console.error(explainSsrError(err));
    process.exitCode = 1;
  } finally {
    await stopSsr();
  }
}
