/**
 * B1 NUMBERS — `src/data/num.ts`
 *
 * The provenance layer. `Num`, `AltNum`, `N`, `flat`, `fmtNum` are FROZEN in
 * `src/contracts/num.ts` (ARCHITECTURE.md §3.5); this file re-exports them so every constant
 * file has one import, and adds the B1-local helpers the frozen shapes do not carry:
 *
 *   - `A(...)`            the `AltNum` constructor (one shipped value + every documented alt)
 *   - `DISPUTES`          the 14 live disputes of §2.5, machine-readable, one row per `disputeId`
 *   - `collectNums(...)`  a deterministic walk over a constant tree, used by `tests/data/**`
 *   - `parseSrc(...)`     splits a `Num.src` anchor into { file, section } so a test can prove
 *                         the citation resolves to a real markdown heading
 *
 * ── THE CITATION RULES EVERY CONSTANT FILE IN THIS BLOCK FOLLOWS ────────────────────────────
 *
 * R1. `src` is written as a COMPLETE LITERAL STRING at every call site —
 *     `'docs/research/01-stances.md §10'`, never a template built from a path constant. A human
 *     grep for `01-stances.md §10` must find every number that claims that section, and
 *     `tools/verify-constants.mjs` (B9) greps the cited section for the literal value.
 *
 * R2. `conf` says how the value relates to that section:
 *       MEASURED  the section prints this literal, from an instrumented study
 *       TRAD      the section prints this literal, from a traditional/instructional authority
 *       DERIVED   the section's own arithmetic or its stated RANGE produces this value; the
 *                 literal itself may not appear (see R3)
 *       ART       an authorial choice this project makes; the section is the argument, not the
 *                 value
 *
 * R3. RANGE CONVENTION (uniform across this block). Where a doc gives a range and its own prose
 *     designates one end ("ship this", "kata cut", "RECOMMENDED"), that end is shipped with the
 *     doc's own `conf`. Otherwise the ARITHMETIC MIDPOINT is shipped with `conf: 'DERIVED'` and a
 *     `tol` that covers the whole range. Consequence for B9: a `DERIVED` or `ART` value must be
 *     verified as "the cited section exists and the value lies inside the range/arithmetic it
 *     states", not as "the literal appears". A literal-only verifier will report false drift on
 *     every midpoint.
 *
 * R4. Unit suffixes obey §2.2. Where a frozen field NAME disagrees with its unit — the two cases
 *     are `TechniqueDynamics.vPkMs` (a speed, `'m/s'`) and `SETTLE[*].ampFracL` (per-channel:
 *     `'ratio'`, `'deg'` or `'H'`) — the `Num.unit` carries the truth, per §2.2 case (b).
 *
 * ZERO `three` imports, zero wall-clock reads: `src/data/**` is on the determinism ledger
 * (§3 import discipline).
 */

import type { AltNum, Confidence, Num, Unit } from '../contracts';
import { N, isNum } from '../contracts';

export type { AltNum, Confidence, Flat, Num, Unit } from '../contracts';
export { flat, fmtAltNum, fmtNamedNum, fmtNum, isNum, N } from '../contracts';

/** `AltNum` id space. `D01` … `D14`; see `DISPUTES` and `src/data/constants/DISPUTED.md`. */
export type DisputeId = `D${number}`;

/**
 * The `AltNum` constructor. Ships `v`, but every `alt` is one lil-gui toggle away (§2.5, B8's
 * DISPUTES folder). Deliberately positional-identical to `N` with two extra arguments so a
 * dispute can be added to an existing constant by appending, never by rewriting.
 */
export const A = (
  v: number,
  unit: Unit,
  tol: number,
  src: string,
  conf: Confidence,
  disputeId: DisputeId,
  alt: readonly { readonly v: number; readonly src: string; readonly label: string }[],
): AltNum => ({ ...N(v, unit, tol, src, conf), disputeId, alt });

export const isAltNum = (x: unknown): x is AltNum =>
  isNum(x) && typeof (x as AltNum).disputeId === 'string' && Array.isArray((x as AltNum).alt);

/**
 * The 14 live disputes of §2.5, as data. B8 renders one A/B toggle per row; `DISPUTED.md` carries
 * the prose argument for each. `knob` is the dotted path of the shipped `AltNum` so a GUI can
 * find it without a second registry.
 */
export interface DisputeRow {
  readonly id: DisputeId;
  readonly title: string;
  /** Dotted path from the `src/data` barrel to the shipped `AltNum`. */
  readonly knob: string;
  readonly file: string;
}

export const DISPUTES: readonly DisputeRow[] = Object.freeze([
  { id: 'D01', title: 'zenkutsu front weight 59 % vs 55.3 / 60 / 70', knob: 'STANCES.zenkutsu.loadFront', file: 'src/data/constants/stances.ts' },
  { id: 'D02', title: 'fighting pelvis height 0.410 H (derived, never measured)', knob: 'FIGHT_PELVIS_Y', file: 'src/data/constants/stances.ts' },
  { id: 'D03', title: 'age-uke forearm inclination 25 deg vs 45', knob: 'AGE_UKE_FOREARM_INCL_DEG', file: 'src/data/constants/techniques.ts' },
  { id: 'D04', title: 'chudan-uke elbow: doc 03 included angles vs the sources’ 90 deg', knob: 'TECHNIQUES["soto-uke-chudan"].elbowIncludedDeg', file: 'src/data/constants/techniques.ts' },
  { id: 'D05', title: 'zenkutsu rear-foot yaw 30 deg vs 45', knob: 'STANCES.zenkutsu.yawRear', file: 'src/data/constants/stances.ts' },
  { id: 'D06', title: 'hanmi 45 deg (JKA) vs 90 deg (Yahara/Bertel)', knob: 'STANCES.zenkutsu.pelvisYawHanmi', file: 'src/data/constants/stances.ts' },
  { id: 'D07', title: 'kokutsu length 0.446 H (1.72 sw) vs "two shoulder widths"', knob: 'STANCES.kokutsu.S', file: 'src/data/constants/stances.ts' },
  { id: 'D08', title: 'head bob <= 0.008 H peak-to-peak vs a +-0.008 H band', knob: 'HEAD_BOB_PP_H', file: 'src/data/constants/dynamics.ts' },
  { id: 'D09', title: 'gi sheen 0.45 vs 1.00 (05 §11.1) vs 0.35 (06 §7.9)', knob: 'MATERIAL_PARAMS.M_GI.sheen', file: 'src/data/constants/render.ts' },
  { id: 'D10', title: 'gi anisotropy 0.18 vs 0.25 (06 §7.9) vs none (05 §11)', knob: 'MATERIAL_PARAMS.M_GI.anisotropy', file: 'src/data/constants/render.ts' },
  { id: 'D11', title: 'hachiji (yoi) foot yaw 30 deg vs 45', knob: 'STANCES.hachiji.yawRear', file: 'src/data/constants/stances.ts' },
  { id: 'D12', title: 'musubi foot yaw 45 deg each vs 30 deg each (60 deg included)', knob: 'STANCES.musubi.yawRear', file: 'src/data/constants/stances.ts' },
  { id: 'D13', title: 'zenkutsu width 0.170 H vs one hip width 0.191 vs one shoulder width 0.259', knob: 'STANCES.zenkutsu.W', file: 'src/data/constants/stances.ts' },
  { id: 'D14', title: 'kata tempo: official 40 s (T1) vs measured senior performance 23-34 s (T2)', knob: 'TEMPO_DISPUTE_S', file: 'src/data/constants/dynamics.ts' },
]);

export const DISPUTE_COUNT = 14 as const;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * Introspection used by `tests/data/**` and, later, by `tools/verify-constants.mjs`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface NumEntry {
  /** Dotted path from the root object passed to `collectNums`, e.g. `zenkutsu.S`. */
  readonly path: string;
  readonly num: Num;
}

/**
 * Depth-first, insertion-ordered walk collecting every `Num` in a constant tree. Deterministic:
 * `Object.keys` order on frozen object literals is insertion order, and arrays walk by index.
 */
export function collectNums(root: unknown, prefix = ''): readonly NumEntry[] {
  const out: NumEntry[] = [];
  const walk = (node: unknown, path: string): void => {
    if (isNum(node)) {
      out.push({ path, num: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const k of Object.keys(node as Record<string, unknown>)) {
        walk((node as Record<string, unknown>)[k], path === '' ? k : `${path}.${k}`);
      }
    }
  };
  walk(root, prefix);
  return out;
}

/** A parsed `Num.src` anchor. `section` is the bare number, e.g. `'3.1'` or `'10'`. */
export interface SrcAnchor {
  readonly file: string;
  readonly section: string;
}

/**
 * `'docs/research/01-stances.md §3.1'` -> `{ file: 'docs/research/01-stances.md', section: '3.1' }`.
 * Returns `null` for an unparseable anchor, which `tests/data/constants.test.ts` treats as a
 * failure — an unresolvable citation is the one thing this whole layer exists to prevent.
 */
export function parseSrc(src: string): SrcAnchor | null {
  const m = /^(\S+\.md)\s+§\s*([0-9]+(?:\.[0-9]+)*)\b/.exec(src);
  if (!m) return null;
  return { file: m[1]!, section: m[2]! };
}

/**
 * The §2.2 suffix -> unit table, as the tests apply it. A field named `…H` must carry `'H'`, a
 * field named `…Deg` must carry `'deg'`, and so on. The three documented exemptions are frozen
 * field names whose suffix lies about the unit (§3.8, `num.ts` C17 note) plus the per-channel
 * `ampFracL`.
 */
export const SUFFIX_UNITS: readonly { readonly suffix: string; readonly units: readonly Unit[] }[] =
  Object.freeze([
    { suffix: 'Deg', units: ['deg'] },
    { suffix: 'DegS', units: ['deg/s'] },
    { suffix: 'Pct', units: ['pct'] },
    { suffix: 'Hps', units: ['Hps'] },
    { suffix: 'Ms', units: ['ms'] },
    { suffix: 'S', units: ['s'] },
    { suffix: 'H', units: ['H'] },
    { suffix: 'M', units: ['m'] },
    { suffix: 'Cm', units: ['cm'] },
  ]);

/**
 * Field names whose frozen suffix contradicts their unit. Each is quoted verbatim from §3.8 and
 * each carries the truth on the `Num` itself (§2.2 case b).
 */
export const SUFFIX_EXEMPT: readonly string[] = Object.freeze([
  'vPkMs',      // doc 04 §10 v_pk is a SPEED, 4.0-7.4 m/s. `Ms` here is NOT milliseconds.
  'ampFracL',   // SETTLE: per-channel unit — 'ratio' (fraction of the end-effector path, C17),
  //              'deg' (an angular overshoot) or 'H' (a vertical overshoot).
  'omegaN',     // doc 04 §5.1 omega_n, rad/s.
  'recoilFracL',// C17: fraction of the END-EFFECTOR path length, never of L_M.
]);
