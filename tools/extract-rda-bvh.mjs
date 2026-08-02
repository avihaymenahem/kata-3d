/**
 * Pull a BVH out of an R `.rda`, with no R installed.
 *
 * `.rda` is bzip2 (or gzip) wrapping R's XDR serialisation, and `RMoCap` stores `heian.nidan.bvh`
 * as a plain character vector — one BVH line per element. Recovering it needs no general R reader,
 * only the CHARSXP record:
 *
 *     00 04 00 09   <int32 length>   <length bytes, ASCII>
 *
 * `0x00040009` is the CHARSXP type word with the ASCII/UTF-8 encoding bits set. Scanning for that
 * and reading the length-prefixed payload recovers every string in file order, which for a
 * character vector IS the line order. A length of -1 marks R's `NA_character_` and is skipped.
 *
 * Usage: node tools/extract-rda-bvh.mjs <in.rda> <out.bvh>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, inflateSync } from 'node:zlib';

const CHARSXP = 0x00040009;

/** bzip2, gzip, or already-plain XDR — `.rda` may be any of the three. */
function decompress(buf) {
  /* `node:zlib` ships inflate and gunzip but NO bunzip, and R defaults `.rda` to bzip2 — so that
   * one branch is a hand-off to the CLI rather than a silent failure on a file that is merely
   * compressed differently. */
  if (buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
    throw new Error(
      'bzip2-compressed .rda; node:zlib cannot decompress it. Run this first:\n' +
        '  bzip2 -dkc in.rda > in.raw\n' +
        'then pass in.raw to this tool.',
    );
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf);
  if (buf[0] === 0x78) return inflateSync(buf);
  return buf;
}

function readStrings(buf) {
  const out = [];
  for (let i = 0; i + 8 <= buf.length; ) {
    if (buf.readUInt32BE(i) !== CHARSXP) {
      i++;
      continue;
    }
    const len = buf.readInt32BE(i + 4);
    if (len < 0 || i + 8 + len > buf.length) {
      i++;
      continue;
    }
    out.push(buf.toString('latin1', i + 8, i + 8 + len));
    i += 8 + len;
  }
  return out;
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/extract-rda-bvh.mjs <in.rda|in.raw> <out.bvh>');
  process.exit(2);
}

const raw = decompress(readFileSync(inPath));
if (raw.subarray(0, 4).toString('latin1') !== 'RDX2') {
  console.error(`warning: no RDX2 header (saw ${JSON.stringify(raw.subarray(0, 4).toString('latin1'))})`);
}

const strings = readStrings(raw);
/* Drop everything before the BVH's own first line — the leading strings are the object name and
 * R attribute names, not content.
 *
 * `startsWith`, not equality: RMoCap stores the whole file as ONE string with embedded newlines,
 * so the first content element is `"HIERARCHY\nROOT Hips\n{\n…"` and never equals `"HIERARCHY"`.
 * The join below then covers both shapes — a single blob passes through untouched, and a
 * line-per-element vector is reassembled. */
const start = strings.findIndex((s) => s.trimStart().startsWith('HIERARCHY'));
if (start === -1) {
  console.error(`no HIERARCHY line among ${strings.length} strings. First few:`);
  console.error(strings.slice(0, 8).map((s) => `  ${JSON.stringify(s.slice(0, 60))}`).join('\n'));
  process.exit(1);
}

const text = strings.slice(start).join('\n') + '\n';
writeFileSync(outPath, text, 'latin1');

const joints = (text.match(/^\s*(ROOT|JOINT)\s/gm) ?? []).length;
const frames = /Frames:\s*(\d+)/.exec(text);
const ft = /Frame Time:\s*([\d.]+)/.exec(text);
console.log(`${outPath}`);
console.log(`  strings recovered : ${strings.length} (BVH starts at ${start})`);
console.log(`  joints            : ${joints}`);
console.log(`  frames            : ${frames ? frames[1] : '?'}`);
console.log(`  frame time        : ${ft ? ft[1] : '?'} s`);
if (frames && ft) console.log(`  duration          : ${(+frames[1] * +ft[1]).toFixed(2)} s`);
