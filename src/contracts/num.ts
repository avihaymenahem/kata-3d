/**
 * B0 CONTRACTS — `src/contracts/num.ts`
 *
 * FROZEN. ARCHITECTURE.md §3.5 verbatim.
 *
 * A number and its citation are the SAME OBJECT. That is what lets the scorecard print
 * provenance next to a failure (§7.4) and lets `tools/verify-constants.mjs` prove the
 * citation is still true by grepping the cited doc section for the literal value.
 */

/**
 * §3.5's union, plus the two units the plan's own frozen fields are documented in and could not
 * otherwise carry:
 *   - `'m/s'`  — §3.8 `TechniqueDynamics.vPkMs` ("// m/s", doc 04 §10 `v_pk` = 4.0–7.4 m/s).
 *     The field NAME ends in `Ms`, which §2.2's suffix table reads as MILLISECONDS; carrying the
 *     unit on the `Num` itself (§2.2 case b) is what makes it unambiguous, and it is why
 *     `verify-constants.mjs` will grep doc 04 §10 for a speed rather than a duration.
 *   - `'rad/s'` — §3.13 `SETTLE[*].omegaN` (doc 04 §5.1 `omega_n` = 22–63 rad/s). Coercing it to
 *     `'deg/s'` would misreport the value by 57.3x in the §7.4 provenance row.
 * Additive only: no previously legal unit string becomes illegal.
 */
export type Unit =
  | 'H' | 'm' | 'cm' | 'deg' | 'deg/s' | 's' | 'ms' | 'pct'
  | 'ratio' | 'Hps' | 'count' | 'bool' | 'N/m' | 'rad/(N.m)'
  | 'm/s' | 'rad/s';

export type Confidence = 'MEASURED' | 'TRAD' | 'DERIVED' | 'ART';

/**
 * A number and its citation are the SAME OBJECT. This is what lets the scorecard print provenance
 * next to a failure and lets tools/verify-constants.mjs prove the citation is still true.
 */
export interface Num {
  readonly v: number;        // the value, expressed in `unit`
  readonly unit: Unit;
  /** How well we KNOW the number. Never used for scoring - scoring tolerances come from doc 07. */
  readonly tol: number;
  /** Exact doc anchor, e.g. 'docs/research/01-stances.md §3.1'. Greppable. */
  readonly src: string;
  readonly conf: Confidence;
}

/** A disputed value: ships `v`, but every `alt` is one GUI toggle away. See DISPUTED.md. */
export interface AltNum extends Num {
  readonly disputeId: `D${number}`;                  // 'D01' .. 'D14'
  readonly alt: readonly { readonly v: number; readonly src: string; readonly label: string }[];
}

export const N = (v: number, unit: Unit, tol: number, src: string, conf: Confidence): Num =>
  ({ v, unit, tol, src, conf });

/** Narrow an unknown to a `Num`. The discriminator `flat()` uses. */
export const isNum = (x: unknown): x is Num =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Num).v === 'number' &&
  typeof (x as Num).unit === 'string' &&
  typeof (x as Num).src === 'string';

/** Hot-loop mirror: recursively strips provenance. flat(ZENKUTSU).S === 0.540 */
export type Flat<T> = { readonly [K in keyof T]: T[K] extends Num ? number : Flat<T[K]> };

export function flat<T extends object>(t: T): Flat<T> {
  const out = (Array.isArray(t) ? [] : {}) as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    const v = (t as Record<string, unknown>)[k];
    if (isNum(v)) out[k] = v.v;
    else if (typeof v === 'object' && v !== null) out[k] = flat(v as object);
    else out[k] = v;
  }
  return Object.freeze(out) as Flat<T>;
}

/**
 * Deterministic decimal rendering: integers print bare, everything else prints with at least
 * three and at most four decimals, trailing zeros trimmed beyond the third. `0.540`, `0.1295`,
 * `175`, `59`.
 */
const fmtValue = (x: number): string => {
  if (Number.isInteger(x)) return String(x);
  const four = x.toFixed(4);
  return four.endsWith('0') ? four.slice(0, -1) : four;
};

/** '0.540 H +-0.040 [DERIVED] docs/research/01-stances.md §3.1' */
export function fmtNum(n: Num): string {
  return `${fmtValue(n.v)} ${n.unit} +-${fmtValue(n.tol)} [${n.conf}] ${n.src}`;
}

/**
 * The full scorecard provenance row of §7.4:
 * 'ZENKUTSU.S = 0.540 H +-0.040 [DERIVED] docs/research/01-stances.md §3.1'
 *
 * §3.5 freezes `fmtNum(n: Num): string`, which cannot see the symbol name; this is the named
 * form the scorecard actually prints. Recorded as an addition.
 */
export function fmtNamedNum(name: string, n: Num): string {
  return `${name} = ${fmtNum(n)}`;
}

/** '[D09] gi sheen — ships 0.45, alt 1.00 (05 §11.1), 0.35 (06 §7.9)' */
export function fmtAltNum(name: string, n: AltNum): string {
  const alts = n.alt.map((a) => `${fmtValue(a.v)} (${a.label}, ${a.src})`).join(', ');
  return `[${n.disputeId}] ${name} = ${fmtNum(n)} | alt: ${alts}`;
}
