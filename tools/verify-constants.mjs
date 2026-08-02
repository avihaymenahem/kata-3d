#!/usr/bin/env node
/**
 * tools/verify-constants.mjs — every `Num` in `src/data/**` vs the doc section it cites.
 *
 * ARCHITECTURE.md §2.6 ("`tools/verify-reference.mjs` … greps each ref entry's cited doc section for
 * the literal value and fails CI on drift" — this is the same machine for the CONSTANTS side),
 * §4.9, §7.2, gate **G-10**. OWNERSHIP B1 verification: "`node tools/verify-constants.mjs` clean —
 * it greps the cited markdown section for the literal value and fails on drift".
 *
 *   node tools/verify-constants.mjs                 verify. exit 0 = clean, 1 = drift.
 *   node tools/verify-constants.mjs --strict        promote every SOFT finding to a hard failure.
 *   node tools/verify-constants.mjs --verbose       print every entry, not just the failures.
 *   node tools/verify-constants.mjs --only stances  restrict to symbols/paths containing a string.
 *   node tools/verify-constants.mjs --json out.json write the full result set.
 *
 * ═══ THE MATCHING RULE, AND WHY IT IS NOT "GREP THE LITERAL" AND NOTHING ELSE ══════════════════
 *
 * `src/data/num.ts` rule R3 (B1's, authored before this tool) states the convention this file has
 * to respect:
 *
 *   "Where a doc gives a range and its own prose designates one end … that end is shipped with the
 *    doc's own `conf`. Otherwise the ARITHMETIC MIDPOINT is shipped with `conf: 'DERIVED'` … a
 *    `DERIVED` or `ART` value must be verified as 'the cited section exists and the value lies
 *    inside the range/arithmetic it states', not as 'the literal appears'. A literal-only verifier
 *    will report false drift on every midpoint."
 *
 * So each entry gets one of three EVIDENCE grades, and the grade is scored against `conf`:
 *
 *   LITERAL   the value appears as a number token in the cited section          strongest
 *   RANGE     the value lies inside a numeric range written in that section     acceptable
 *   MISSING   neither
 *
 *   conf MEASURED | TRAD   MISSING is a HARD FAILURE. These classes assert "the section prints
 *                          this literal", so a missing literal is drift by definition.
 *   conf DERIVED  | ART    MISSING is a SOFT finding, reported and counted, hard under `--strict`.
 *   any class              a missing FILE or a missing SECTION is always a HARD FAILURE — an
 *                          unresolvable citation is the one thing the provenance layer exists to
 *                          prevent.
 *
 * Every failure line names: the FILE that defines the symbol, the SYMBOL (dotted path), the CITED
 * ANCHOR, and THE TWO DIFFERING VALUES — ours, and the nearest number actually present in that
 * section.
 *
 * TRAPS THIS FILE HANDLES, all of which produced false results while it was being written:
 *   1. The research docs use U+2212 MINUS SIGN (`−0.118`), not ASCII hyphen. Un-normalised, every
 *      negative constant in doc 03 §13 reported as drift.
 *   2. They use U+2013 EN DASH for ranges (`0.45–0.70`) and `±` for tolerances.
 *   3. `0.54` in code vs `0.540` in a table is the same number; string grep says otherwise.
 *   4. Section `§3` must include its own `§3.1`/`§3.2` subsections, or every constant citing a
 *      chapter fails. Section `§3.1` must NOT bleed into `§3.2`, or the tool passes on anything.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainSsrError, loadModule, stopSsr } from './ssr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => path.join(ROOT, ...p.split('/'));

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. Markdown: section extraction and numeric evidence.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * CRLF -> LF, U+2212 MINUS SIGN -> '-', U+2013/U+2014 dashes and U+2026 ellipsis -> '~' (a range
 * marker the range parser understands), NBSP -> ' '.
 *
 * THE CRLF LINE IS LOAD-BEARING AND FIXED A REAL BUG. `01-stances.md` is LF and
 * `03-techniques-upper.md` is CRLF. In JavaScript `\r` IS a line terminator, so `.` does not match
 * it and `$` (without the `m` flag) does not match before it: the heading regex returned `null` for
 * every line of every CRLF doc, and this tool reported SECTION_MISSING for all 199 constants citing
 * doc 03 — failing loudly for a reason that had nothing to do with the constants. A verifier whose
 * own text handling is wrong is worse than no verifier.
 */
export function normaliseText(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/−/g, '-')
    .replace(/[–—]/g, '~')
    .replace(/…/g, '~')
    .replace(/ /g, ' ');
}

const docCache = new Map();

function readDoc(relPath) {
  if (docCache.has(relPath)) return docCache.get(relPath);
  const p = abs(relPath);
  const doc = existsSync(p) ? normaliseText(readFileSync(p, 'utf8')) : null;
  docCache.set(relPath, doc);
  return doc;
}

/**
 * Every heading in a doc, as `{ level, number, title, line }`.
 * Recognises `## 10. Title`, `### 3.1 Title`, `#### Group G1 - Title` (no number: skipped).
 */
function headingsOf(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+([0-9]+(?:\.[0-9]+)*)[.)]?\s*(.*)$/.exec(lines[i]);
    if (m) out.push({ level: m[1].length, number: m[2], title: m[3], line: i });
  }
  return out;
}

const headingCache = new Map();
function getHeadings(relPath, text) {
  if (!headingCache.has(relPath)) headingCache.set(relPath, headingsOf(text));
  return headingCache.get(relPath);
}

/**
 * The body of one numbered section, INCLUDING its subsections and EXCLUDING the next section at the
 * same or a shallower level. `§3` therefore carries §3.1…§3.6; `§3.1` stops at §3.2.
 */
export function sectionBody(relPath, sectionNumber) {
  const text = readDoc(relPath);
  if (text === null) return { ok: false, reason: 'FILE_MISSING', body: '' };
  const heads = getHeadings(relPath, text);
  const idx = heads.findIndex((h) => h.number === sectionNumber);
  if (idx < 0) return { ok: false, reason: 'SECTION_MISSING', body: '' };
  const start = heads[idx];
  const lines = text.split('\n');
  let end = lines.length;
  for (let j = idx + 1; j < heads.length; j++) {
    if (heads[j].level <= start.level) {
      end = heads[j].line;
      break;
    }
  }
  return { ok: true, reason: 'OK', body: lines.slice(start.line, end).join('\n') };
}

const NUM_TOKEN = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
/** `3.9 k`, `27 k` — the docs abbreviate vertex and triangle budgets this way. */
const K_TOKEN = /(-?\d+(?:\.\d+)?)\s*k\b/gi;
const EPS = 5e-7;

/** Every numeric token in a body, deduped, in first-appearance order. */
function numbersIn(body) {
  const seen = new Set();
  const out = [];
  const push = (v) => {
    if (!Number.isFinite(v) || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const m of body.matchAll(NUM_TOKEN)) push(Number.parseFloat(m[0]));
  // `~3.9 k verts` is 3900. Without this, three DERIVED budget constants report as unverifiable
  // when the section states them plainly.
  for (const m of body.matchAll(K_TOKEN)) push(Number.parseFloat(m[1]) * 1000);
  return out;
}

/**
 * Explicit numeric ranges. Handles `a~b` (any dash, already normalised), `a to b`, `a ± b`,
 * `a +- b`, `[a, b]`, and `a ... b`.
 */
function rangesIn(body) {
  const out = [];
  const N = '(-?\\d+(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`${N}\\s*~\\s*${N}`, 'g'),
    new RegExp(`${N}\\s+to\\s+${N}`, 'gi'),
    new RegExp(`${N}\\s*\\u00b1\\s*${N}`, 'g'),
    new RegExp(`${N}\\s*\\+-\\s*${N}`, 'g'),
    new RegExp(`\\[\\s*${N}\\s*,\\s*${N}\\s*\\]`, 'g'),
  ];
  for (let i = 0; i < patterns.length; i++) {
    for (const m of body.matchAll(patterns[i])) {
      const a = Number.parseFloat(m[1]);
      const b = Number.parseFloat(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      // `a ± b` / `a +- b` are centre+halfwidth, not endpoints.
      const tolForm = i === 2 || i === 3;
      out.push(tolForm ? { lo: a - Math.abs(b), hi: a + Math.abs(b) } : { lo: Math.min(a, b), hi: Math.max(a, b) });
    }
  }
  return out;
}

/**
 * `LITERAL` | `LITERAL_PCT` | `LITERAL_ABS` | `RANGE` | `MISSING`, plus the nearest number present
 * for the failure message.
 *
 * The two extra LITERAL grades are NOT slack. Each is a project convention frozen elsewhere, and
 * each is graded separately so the loosening stays visible in the report:
 *
 *   LITERAL_PCT   `unit: 'ratio'` against a section that prints a percentage, or `unit: 'pct'`
 *                 against a section that prints a fraction. doc 01 §8.2 states "35 % of travel by
 *                 t = 0.5" and B1 ships `STEP.pelvisZFracAtHalf = 0.35` with `unit: 'ratio'`. Same
 *                 number, different unit form. Scoped to those two units only.
 *   LITERAL_ABS   a `dx` field only. §3.8: "dx is written WITHOUT the side factor; solver applies
 *                 -s*dx", and doc 03's tables encode the side as a separate `s` factor (`s·0.025` /
 *                 `−s·0.030`). So `TECHNIQUES['soto-uke-chudan'].start.dx = -0.025` IS doc 03 §9.2's
 *                 `s·0.025`. Scoped to fields literally named `dx`, so a sign error anywhere else —
 *                 the mirroring bug class of rubric A10 — is still a hard failure.
 */
export function evidenceFor(body, value, ctx = {}) {
  const nums = numbersIn(body);
  for (const n of nums) if (Math.abs(n - value) <= EPS) return { grade: 'LITERAL', nearest: n, distance: 0 };

  const unit = ctx.unit ?? null;
  if (unit === 'ratio' || unit === 'pct') {
    const alt = unit === 'ratio' ? value * 100 : value / 100;
    for (const n of nums) {
      if (Math.abs(n - alt) <= EPS) return { grade: 'LITERAL_PCT', nearest: n, distance: 0 };
    }
  }

  const leaf = (ctx.path ?? '').split('.').pop();
  if (leaf === 'dx') {
    for (const n of nums) {
      if (Math.abs(Math.abs(n) - Math.abs(value)) <= EPS) {
        return { grade: 'LITERAL_ABS', nearest: n, distance: 0 };
      }
    }
  }

  for (const r of rangesIn(body)) {
    if (value >= r.lo - EPS && value <= r.hi + EPS) {
      return { grade: 'RANGE', nearest: null, distance: 0, range: r };
    }
  }

  let nearest = null;
  let distance = Infinity;
  for (const n of nums) {
    const d = Math.abs(n - value);
    if (d < distance) {
      distance = d;
      nearest = n;
    }
  }
  return { grade: 'MISSING', nearest, distance };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. symbol -> defining file, by scanning src/data/**.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

function walkTs(dirRel, out = []) {
  const d = abs(dirRel);
  if (!existsSync(d)) return out;
  for (const name of readdirSync(d)) {
    const child = path.join(d, name);
    const childRel = `${dirRel}/${name}`;
    if (statSync(child).isDirectory()) walkTs(childRel, out);
    else if (name.endsWith('.ts')) out.push(childRel);
  }
  return out;
}

const EXPORT_DECL = /^export\s+(?:declare\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

function buildSymbolFileMap() {
  const map = new Map();
  for (const f of walkTs('src/data')) {
    const src = readFileSync(abs(f), 'utf8');
    for (const m of src.matchAll(EXPORT_DECL)) {
      if (!map.has(m[1])) map.set(m[1], f);
    }
  }
  return map;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. The run.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const HARD_CONF = new Set(['MEASURED', 'TRAD']);
const LITERAL_GRADES = new Set(['LITERAL', 'LITERAL_PCT', 'LITERAL_ABS']);

function classify(entry, ev, sec) {
  if (!sec.ok) return { severity: 'HARD', code: sec.reason };
  if (LITERAL_GRADES.has(ev.grade)) return { severity: 'OK', code: ev.grade };
  if (ev.grade === 'RANGE') return { severity: 'NOTE', code: 'RANGE' };
  return { severity: HARD_CONF.has(entry.conf) ? 'HARD' : 'SOFT', code: 'NO_MATCH' };
}

export async function run(opts = {}) {
  const strict = Boolean(opts.strict);
  const only = opts.only ?? null;

  const data = await loadModule('src/data/index.ts');
  const { collectNums, parseSrc, isNum } = data;
  if (typeof collectNums !== 'function' || typeof parseSrc !== 'function') {
    throw new Error(
      'src/data barrel does not export collectNums / parseSrc (src/data/num.ts). ' +
        'verify-constants walks the constant tree through B1\'s own helpers on purpose, so the tool ' +
        'and tests/data/** cannot disagree about what "every Num" means.',
    );
  }

  const symbolFile = buildSymbolFileMap();
  const exportNames = Object.keys(data).sort();

  /* Collect every Num, deduped by object identity so FIGHT_PELVIS_Y is not reported twice as
   * itself and as STANCES.zenkutsu.pelvisY. The first (alphabetically-rooted) path is canonical;
   * the rest are recorded as aliases. */
  const byIdentity = new Map();
  for (const name of exportNames) {
    const value = data[name];
    if (value === null || value === undefined) continue;
    if (typeof value === 'function') continue;
    if (typeof value !== 'object' && !isNum(value)) continue;
    let found;
    try {
      found = collectNums(value, name);
    } catch {
      continue; // a getter or exotic object: not a constant tree.
    }
    for (const { path: p, num } of found) {
      const cur = byIdentity.get(num);
      if (cur) cur.aliases.push(p);
      else byIdentity.set(num, { path: p, num, aliases: [] });
    }
  }

  const entries = [];
  for (const { path: p, num, aliases } of byIdentity.values()) {
    const rootSymbol = /^[A-Za-z_$][\w$]*/.exec(p)?.[0] ?? p;
    entries.push({
      path: p,
      aliases,
      symbol: rootSymbol,
      file: symbolFile.get(rootSymbol) ?? 'src/data/index.ts',
      v: num.v,
      unit: num.unit,
      tol: num.tol,
      src: num.src,
      conf: num.conf,
      disputeId: num.disputeId ?? null,
      alt: Array.isArray(num.alt) ? num.alt : null,
    });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const results = [];
  const hard = [];
  const soft = [];
  const notes = [];

  for (const e of entries) {
    if (only && !e.path.includes(only) && !e.file.includes(only)) continue;
    const anchor = parseSrc(e.src);
    if (anchor === null) {
      const r = { ...e, grade: 'MISSING', severity: 'HARD', code: 'UNPARSEABLE_SRC', nearest: null };
      results.push(r);
      hard.push(r);
      continue;
    }
    const sec = sectionBody(anchor.file, anchor.section);
    const ev = sec.ok
      ? evidenceFor(sec.body, e.v, { unit: e.unit, path: e.path })
      : { grade: 'MISSING', nearest: null, distance: Infinity };
    const cls = classify(e, ev, sec);
    const r = {
      ...e,
      docFile: anchor.file,
      docSection: anchor.section,
      grade: ev.grade,
      nearest: ev.nearest,
      distance: ev.distance,
      severity: cls.severity,
      code: cls.code,
    };
    results.push(r);
    if (cls.severity === 'HARD') hard.push(r);
    else if (cls.severity === 'SOFT') soft.push(r);
    else if (cls.severity === 'NOTE') notes.push(r);

    /* Every AltNum's alternative citations must resolve too — a dispute whose "other reading" cites
     * a section that does not exist cannot be settled by a human toggling it (§2.5, B8's DISPUTES). */
    if (e.alt) {
      for (const a of e.alt) {
        const aa = parseSrc(a.src);
        const asec = aa ? sectionBody(aa.file, aa.section) : { ok: false, reason: 'UNPARSEABLE_SRC' };
        if (!asec.ok) {
          const ar = {
            ...e,
            path: `${e.path}.alt[${a.label}]`,
            v: a.v,
            src: a.src,
            docFile: aa?.file ?? '?',
            docSection: aa?.section ?? '?',
            grade: 'MISSING',
            severity: 'HARD',
            code: asec.reason,
            nearest: null,
          };
          results.push(ar);
          hard.push(ar);
        }
      }
    }
  }

  /* ── the ROM block check (OWNERSHIP B1 "ROM EXEMPTION") ─────────────────────────────────── */
  const romReport = checkRomBlock(data);
  for (const r of romReport.failures) hard.push(r);

  const summary = {
    numsFound: entries.length,
    checked: results.length,
    literal: results.filter((r) => r.code === 'LITERAL').length,
    literalPct: results.filter((r) => r.code === 'LITERAL_PCT').length,
    literalAbs: results.filter((r) => r.code === 'LITERAL_ABS').length,
    range: notes.length,
    hardFailures: hard.length,
    softFindings: soft.length,
    strict,
    rom: romReport.summary,
  };

  return { summary, results, hard, soft, notes, rom: romReport };
}

/**
 * OWNERSHIP B1's ROM EXEMPTION: `RomLimit` declares four bare `…Deg` fields, so the ~208 range-of-
 * motion values cannot individually be `Num`s without breaking a frozen interface. The frozen shape
 * wins, and this tool "validates the ROM table AS A BLOCK against doc 06 §3.1 rather than
 * value-by-value".
 *
 * As a block means: (a) `ROM` covers every bone; (b) every `ROM_GROUP_SRC` anchor resolves to a real
 * doc section; (c) the aggregate totals B1 publishes in `ROM_BLOCK_TOTALS` DO appear as literals in
 * the section they cite — those are the numbers doc 06 §3.1 actually prints as sums.
 */
function checkRomBlock(data) {
  const failures = [];
  const { ROM, ROM_GROUP_SRC, ROM_BLOCK_TOTALS } = data;
  if (!ROM || !ROM_GROUP_SRC) {
    return { summary: { present: false }, failures, totals: [] };
  }

  const bones = Object.keys(ROM);
  const missingSrc = bones.filter((b) => !ROM_GROUP_SRC[b]);
  if (missingSrc.length) {
    failures.push({
      path: 'ROM',
      file: 'src/data/constants/rom.ts',
      symbol: 'ROM_GROUP_SRC',
      v: NaN,
      src: '-',
      conf: 'DERIVED',
      severity: 'HARD',
      code: 'ROM_SRC_MISSING',
      grade: 'MISSING',
      nearest: null,
      detail: `${missingSrc.length} bone(s) have no ROM_GROUP_SRC anchor: ${missingSrc.slice(0, 6).join(', ')}`,
    });
  }

  const badAnchor = [];
  for (const [bone, src] of Object.entries(ROM_GROUP_SRC)) {
    const a = data.parseSrc(src);
    const sec = a ? sectionBody(a.file, a.section) : { ok: false, reason: 'UNPARSEABLE_SRC' };
    if (!sec.ok) badAnchor.push(`${bone} -> ${src} (${sec.reason})`);
  }
  if (badAnchor.length) {
    failures.push({
      path: 'ROM_GROUP_SRC',
      file: 'src/data/constants/rom.ts',
      symbol: 'ROM_GROUP_SRC',
      v: NaN,
      src: '-',
      conf: 'DERIVED',
      severity: 'HARD',
      code: 'ROM_ANCHOR_UNRESOLVED',
      grade: 'MISSING',
      nearest: null,
      detail: badAnchor.slice(0, 8).join('; '),
    });
  }

  const totals = [];
  if (ROM_BLOCK_TOTALS && typeof ROM_BLOCK_TOTALS.src === 'string') {
    const a = data.parseSrc(ROM_BLOCK_TOTALS.src);
    const sec = a ? sectionBody(a.file, a.section) : { ok: false, reason: 'UNPARSEABLE_SRC' };
    for (const [k, v] of Object.entries(ROM_BLOCK_TOTALS)) {
      if (typeof v !== 'number') continue;
      const ev = sec.ok ? evidenceFor(sec.body, v) : { grade: 'MISSING', nearest: null, distance: Infinity };
      totals.push({ key: k, v, grade: ev.grade, nearest: ev.nearest });
      if (!sec.ok || ev.grade === 'MISSING') {
        failures.push({
          path: `ROM_BLOCK_TOTALS.${k}`,
          file: 'src/data/constants/rom.ts',
          symbol: 'ROM_BLOCK_TOTALS',
          v,
          src: ROM_BLOCK_TOTALS.src,
          docFile: a?.file ?? '?',
          docSection: a?.section ?? '?',
          conf: 'DERIVED',
          severity: 'HARD',
          code: sec.ok ? 'ROM_TOTAL_DRIFT' : sec.reason,
          grade: ev.grade,
          nearest: ev.nearest,
        });
      }
    }
  }

  return {
    summary: {
      present: true,
      bones: bones.length,
      anchors: Object.keys(ROM_GROUP_SRC).length,
      totalsChecked: totals.length,
      totalsLiteral: totals.filter((t) => t.grade === 'LITERAL').length,
    },
    failures,
    totals,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. Reporting.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

function fmtEntry(r) {
  const L = [];
  const both =
    r.nearest === null
      ? `ours ${r.v} — the cited section contains NO number within reach`
      : `ours ${r.v}   vs   nearest in section ${r.nearest}   (delta ${(r.v - r.nearest).toPrecision(4)})`;
  L.push(`  ${r.code}  ${r.file}`);
  L.push(`      symbol  ${r.path}${r.disputeId ? `  [${r.disputeId}]` : ''}`);
  L.push(`      cited   ${r.src}${r.unit ? `   (unit ${r.unit}, conf ${r.conf})` : ''}`);
  L.push(`      values  ${both}`);
  if (r.detail) L.push(`      detail  ${r.detail}`);
  if (r.code === 'SECTION_MISSING') {
    L.push(`      => docs/${r.docFile} has no numbered heading '${r.docSection}'.`);
  }
  if (r.code === 'FILE_MISSING') L.push(`      => ${r.docFile} does not exist.`);
  return L.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : null;
  };

  try {
    const out = await run({ strict: flag('strict'), only: value('only') });
    const { summary, results, hard, soft, notes } = out;

    if (flag('verbose')) {
      for (const r of results) {
        console.log(
          `  ${r.code.padEnd(15)} ${String(r.v).padEnd(10)} ${r.conf.padEnd(9)} ${r.path}  <- ${r.src}`,
        );
      }
      console.log('');
    }

    console.log(`verify-constants: ${summary.numsFound} Num(s) in src/data/**, ${summary.checked} checked`);
    console.log(
      `  LITERAL ${summary.literal}   LITERAL_PCT ${summary.literalPct}   ` +
        `LITERAL_ABS ${summary.literalAbs}   RANGE ${summary.range}   ` +
        `HARD ${summary.hardFailures}   SOFT ${summary.softFindings}`,
    );
    if (summary.literalPct + summary.literalAbs > 0) {
      for (const r of results.filter((x) => x.code === 'LITERAL_PCT' || x.code === 'LITERAL_ABS')) {
        console.log(`    ${r.code}  ${r.path} = ${r.v} ${r.unit}  matched ${r.nearest}  <- ${r.src}`);
      }
    }
    if (summary.rom.present) {
      console.log(
        `  ROM block: ${summary.rom.bones} bones, ${summary.rom.anchors} group anchors, ` +
          `${summary.rom.totalsLiteral}/${summary.rom.totalsChecked} block totals literal ` +
          `(OWNERSHIP B1 ROM EXEMPTION: verified as a block, not value-by-value)`,
      );
    }

    if (notes.length && flag('verbose')) {
      console.log(`\n  ${notes.length} RANGE match(es) — inside a range the section states, not a literal:`);
      for (const r of notes) console.log(`    ${r.v} ${r.path}  <- ${r.src}`);
    }

    if (soft.length) {
      console.log(
        `\n  ${soft.length} SOFT finding(s) — DERIVED/ART values whose literal is not in the cited ` +
          `section. Legal under src/data/num.ts rule R3; run with --strict to treat as failures:`,
      );
      for (const r of soft) {
        console.log(
          `    ${r.path} = ${r.v} ${r.unit} [${r.conf}]  <- ${r.src}` +
            (r.nearest === null ? '  (section has no numbers)' : `  nearest ${r.nearest}`),
        );
      }
    }

    const jsonPath = value('json');
    if (jsonPath) {
      const p = path.isAbsolute(jsonPath) ? jsonPath : path.join(ROOT, jsonPath);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(out, null, 2));
      console.log(`  wrote ${path.relative(ROOT, p).split(path.sep).join('/')}`);
    }

    const failures = flag('strict') ? [...hard, ...soft] : hard;
    if (failures.length) {
      console.error(`\nverify-constants: ${failures.length} DRIFT / UNRESOLVED CITATION\n`);
      for (const r of failures) console.error(`${fmtEntry(r)}\n`);
      console.error(
        'A hard failure means either (a) the cited doc section does not exist, or (b) a MEASURED/TRAD\n' +
          'value is not printed in the section that claims it. Fix the CONSTANT or fix the CITATION —\n' +
          'never the doc: docs/research/** is read-only (OWNERSHIP).\n',
      );
      process.exitCode = 1;
    } else {
      console.log('\nverify-constants: OK — every citation resolves and no drift found');
    }
  } catch (err) {
    console.error(explainSsrError(err));
    process.exitCode = 1;
  } finally {
    await stopSsr();
  }
}
