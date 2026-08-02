#!/usr/bin/env node
/**
 * tools/ssr.mjs — boot Vite in middleware mode and expose `ssrLoadModule`.
 *
 * ARCHITECTURE.md §7.1, §9.1 A-12. This is the whole reason the numeric channel needs no
 * browser: `tools/score.mjs`, `tools/build-track.mjs` and every other Node tool load the
 * project's TypeScript entry points DIRECTLY through Vite's SSR transform — no GL, no
 * Chromium, no second build target, no new dependency (`vite` is already a devDependency).
 *
 * Authored by B0 in Phase 0 and handed to B9 at the Phase-0 gate (OWNERSHIP B9 note).
 *
 * Usage as a library:
 *
 *   import { withSsr, loadModule } from './ssr.mjs';
 *   const { compileKata } = await loadModule('/src/solve/index.ts');
 *   await withSsr(async (load) => { const c = await load('/src/contracts/index.ts'); ... });
 *
 * Usage as a CLI (smoke test / inspection):
 *
 *   node tools/ssr.mjs /src/contracts/index.ts              # list export names
 *   node tools/ssr.mjs /src/contracts/index.ts BONE_COUNT   # print one export as JSON
 */

import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('vite').ViteDevServer | null} */
let cached = null;

/**
 * Start (or reuse) a Vite dev server in middleware mode.
 * `appType: 'custom'` stops Vite installing its own HTML fallback middleware; we never serve
 * a request, we only use the module graph and the SSR transform.
 */
export async function startSsr() {
  if (cached) return cached;
  cached = await createServer({
    root: PROJECT_ROOT,
    // Deliberately NOT `configFile: false` — tools must load exactly the TypeScript the
    // browser loads, through the orchestrator-owned vite.config.ts (§7.1).
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  return cached;
}

export async function stopSsr() {
  if (!cached) return;
  const s = cached;
  cached = null;
  await s.close();
}

/**
 * Normalise a module specifier to a root-relative, POSIX URL path.
 * Accepts '/src/x.ts', 'src/x.ts', 'C:\\...\\src\\x.ts' and a file:// URL.
 */
export function toSsrPath(spec) {
  let s = String(spec);
  if (s.startsWith('file://')) s = fileURLToPath(s);

  /* Inspect with forward slashes throughout: a Windows absolute path may be written with EITHER
   * separator ('C:\a\b' or 'C:/a/b').
   *
   * Two traps this avoids, both previously live:
   *  1. `path.isAbsolute(s) && s.includes(path.sep)` skipped `path.relative` for the FORWARD-slash
   *     Windows form (no backslash present), returning '/C:/…/src/x.ts' — which Vite reports as
   *     "Failed to load url … Does the file exist?" while naming a path that plainly does exist.
   *  2. Dropping that `includes(path.sep)` guard broke the ROOT-RELATIVE form instead: on Windows
   *     `path.isAbsolute('/src/x.ts')` is TRUE, so '/src/x.ts' became '/../../../../src/x.ts'.
   *
   * The rule that handles both: strip the prefix only when the path really is INSIDE the project;
   * anything else is already a root-relative ssr specifier. */
  const fwd = s.split('\\').join('/');
  const rootFwd = PROJECT_ROOT.split('\\').join('/');
  const insideProject =
    process.platform === 'win32'
      ? fwd.toLowerCase().startsWith(`${rootFwd.toLowerCase()}/`)
      : fwd.startsWith(`${rootFwd}/`);

  s = insideProject ? fwd.slice(rootFwd.length + 1) : fwd;
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

/** Load one TypeScript/ESM module through Vite's SSR pipeline. Keeps the server warm. */
export async function loadModule(spec) {
  const server = await startSsr();
  return server.ssrLoadModule(toSsrPath(spec));
}

/**
 * Run `fn(load)` with a warm SSR server and always tear it down afterwards. Use this from a
 * tool's top level so a thrown error cannot leave a listening server behind.
 */
export async function withSsr(fn) {
  try {
    const server = await startSsr();
    return await fn((spec) => server.ssrLoadModule(toSsrPath(spec)), server);
  } finally {
    await stopSsr();
  }
}

/** Rewrite an SSR stack trace so a Vite-transformed frame still points at the .ts source. */
export function explainSsrError(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  const lines = [`${e.name}: ${e.message}`];
  if (e.stack) {
    for (const l of e.stack.split('\n').slice(1, 8)) lines.push(l.replace(PROJECT_ROOT, '.'));
  }
  return lines.join('\n');
}

/* ── CLI ─────────────────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [spec, exportName] = process.argv.slice(2);
  if (!spec) {
    console.error('usage: node tools/ssr.mjs <module> [exportName]');
    process.exit(2);
  }
  try {
    await withSsr(async (load) => {
      const mod = await load(spec);
      if (exportName) {
        if (!(exportName in mod)) {
          console.error(`no export '${exportName}' in ${spec}`);
          process.exitCode = 1;
          return;
        }
        const v = mod[exportName];
        console.log(
          typeof v === 'function'
            ? `[function ${v.name || exportName}]`
            : JSON.stringify(v, (_k, x) => (x instanceof Float64Array || x instanceof Float32Array || x instanceof Int8Array ? Array.from(x) : x), 2),
        );
      } else {
        console.log(Object.keys(mod).sort().join('\n'));
      }
    });
  } catch (err) {
    console.error(explainSsrError(err));
    process.exitCode = 1;
  }
}
