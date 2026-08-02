/**
 * B9 CRITIC — `src/eval/referenceBank.ts`
 *
 * Loads and VALIDATES `data/reference/<kata>.ref.json` (doc 07 §6.1, "implement verbatim"), and
 * declares the state of Channel C.
 *
 * ═══ TWO DIFFERENT "BANKS", AND ONLY ONE OF THEM IS DISARMED ══════════════════════════════════
 *
 * 1. The **Channel A reference pose bank** — `data/reference/*.ref.json`, doc 07 §6.1. HAND-AUTHORED
 *    from docs 01/03/02 with doc 07's tolerances. `tools/gen-reference.mjs` MUST NEVER EXIST
 *    (§2.6, §4.9, §9.3): "the scorecard can never disagree with the rig" is a tautology dressed as
 *    a check. It is not authored in Phase 1, so the bank is currently EMPTY, and this module reports
 *    that as `status: 'ABSENT'` rather than defaulting to something.
 *
 * 2. The **Channel C ground-truth bank** — `assets/reference/pd-1925/**`, the 16 public-domain 1925
 *    Funakoshi plates plus their hand annotations and `posture-match.json`. This ships **DISARMED**
 *    and **EMPTY**, by project decision: this project downloads nothing, ever (docs/BRIEFS.md
 *    project constraint 2), and §7.6 additionally records that doc 07 §2.1's 16 plates are the
 *    **Heian Nidan** posture sequence — we build Taikyoku Shodan and Heian Shodan, so G-5 was
 *    always mis-specified as step-matched and has to be posture-matched by a HUMAN-SIGNED
 *    `posture-match.json` before it can be armed (§8 Phase 5). Gate G-5 therefore reports
 *    `DISARMED` with this reason attached, so nobody can read "no Channel C data" as "Channel C
 *    passed".
 *
 * NO NETWORK, EVER. Nothing in this file fetches anything. `import.meta.glob` is a build-time
 * directory read of the project tree, resolved by Vite in both the browser and the Node SSR path.
 */

import type { KataId, MetricId } from '../contracts';
import { METRIC_BY_ID } from './metricSpecs';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. Channel C — the disarmed state, stated once, machine-readable.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface ChannelCStatus {
  readonly armed: false;
  readonly plateCount: 0;
  readonly postureMatchSigned: false;
  readonly reason: string;
  /** doc 07 §6.7 step 6 / §7.6: topology only. These three may NEVER enter Channel C. */
  readonly excludedMetrics: readonly MetricId[];
}

/**
 * FROZEN. Channel C is disarmed at the Phase-1 gate and stays disarmed until a human decision.
 * `excludedMetrics` is not decoration: doc 07 §6.7 step 6 is explicit that 1920s Shuri-te postures
 * are shallower and more upright than modern JKA, so optimising stance depth toward the plates
 * produces pre-war karate. `src/eval/pd1925.ts` will REFUSE these three.
 */
export const CHANNEL_C_STATUS: ChannelCStatus = Object.freeze({
  armed: false,
  plateCount: 0,
  postureMatchSigned: false,
  reason:
    'Channel C / G-5 ships DISARMED with an EMPTY reference bank. The 16 PD-1925 Funakoshi plates ' +
    'are NOT downloaded (project constraint: no network, no downloaded assets, ever), ' +
    'assets/reference/pd-1925/posture-match.json does not exist and has not been human-signed, and ' +
    'doc 07 §2.1 identifies those plates as the HEIAN NIDAN posture sequence — neither kata we ' +
    'build appears in that set, so G-5 must be posture-matched, not step-matched (§7.6, defect S-3). ' +
    'Arming it is an integrator commit in Phase 5.',
  excludedMetrics: Object.freeze<MetricId[]>(['stance_len_H', 'stance_width_H', 'hip_height_H']),
});

/** doc 07 §6.7 step 5 thresholds, kept here so `pd1925.ts` cannot re-invent them. */
export const CHANNEL_C_THRESHOLDS = Object.freeze({
  mpjpe2dHTarget: 0.025, mpjpe2dHGate: 0.04,
  pckHTarget: 0.9, pckHGate: 0.85,
  limbAngleMaeDegTarget: 7, limbAngleMaeDegGate: 12,
  pckRadiusH: 0.03,
  minMatchedPlates: 6,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. Channel A — the `kata-ref/1` schema of doc 07 §6.1, verbatim.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface RefStep {
  readonly id: number;
  readonly name_jp: string;
  readonly stance: string;
  readonly facing_yaw_deg: number;
  readonly embusen_xz: readonly [number, number];
  /** "every `targets` key must be one of the metric IDs in §6.2" — enforced by `validateRefBank`. */
  readonly targets: Readonly<Record<string, number>>;
  readonly timing?: Readonly<Record<string, number>>;
}

export interface RefBank {
  readonly schema: 'kata-ref/1';
  readonly kata: string;
  readonly H_cm: number;
  readonly convention: Readonly<Record<string, string | number>>;
  readonly tempo: { readonly total_s: number; readonly total_s_tol: number };
  readonly steps: readonly RefStep[];
}

export type RefBankStatus = 'OK' | 'ABSENT' | 'INVALID';

export interface RefBankHandle {
  readonly kataId: string;
  readonly status: RefBankStatus;
  readonly bank: RefBank | null;
  /** Empty iff `status === 'OK'`. Each string names the failing rule. */
  readonly problems: readonly string[];
  readonly path: string;
}

export class ReferenceBankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceBankError';
  }
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Validate a parsed `.ref.json` against doc 07 §6.1's rules. Returns the problem list rather than
 * throwing, because a malformed bank must show up as a reported gate rather than as a crash halfway
 * through a scoring run.
 *
 * §6.1's own binding rules, each checked:
 *   - `schema === 'kata-ref/1'`
 *   - every `targets` key is a real `MetricId` from §6.2
 *   - one file per kata, and `kata` matches the filename
 *   - `H_cm` is 175 (§2.2 `H_CM`)
 */
export function validateRefBank(raw: unknown, expectKata?: string): readonly string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ['not a JSON object'];
  if (raw['schema'] !== 'kata-ref/1') p.push(`schema is ${String(raw['schema'])}, expected 'kata-ref/1'`);
  if (typeof raw['kata'] !== 'string') p.push('missing string `kata`');
  else if (expectKata && raw['kata'] !== expectKata) {
    p.push(`kata '${String(raw['kata'])}' does not match the file name '${expectKata}'`);
  }
  if (raw['H_cm'] !== 175) p.push(`H_cm is ${String(raw['H_cm'])}, expected 175 (§2.2 H_CM)`);
  if (!isObj(raw['convention'])) p.push('missing object `convention`');
  const tempo = raw['tempo'];
  if (!isObj(tempo) || typeof tempo['total_s'] !== 'number' || typeof tempo['total_s_tol'] !== 'number') {
    p.push('missing `tempo` { total_s, total_s_tol }');
  }
  const steps = raw['steps'];
  if (!Array.isArray(steps)) {
    p.push('missing array `steps`');
    return p;
  }
  const seen = new Set<number>();
  steps.forEach((s: unknown, i: number) => {
    if (!isObj(s)) {
      p.push(`steps[${i}] is not an object`);
      return;
    }
    if (typeof s['id'] !== 'number') p.push(`steps[${i}] missing numeric id`);
    else if (seen.has(s['id'])) p.push(`steps[${i}] duplicates id ${s['id']}`);
    else seen.add(s['id']);
    const t = s['targets'];
    if (!isObj(t)) {
      p.push(`steps[${i}] missing object targets`);
      return;
    }
    for (const k of Object.keys(t)) {
      if (!(k in METRIC_BY_ID)) {
        p.push(
          `steps[${i}].targets.${k} is not a MetricId of doc 07 §6.2 — §6.1: "every targets key ` +
            `must be one of the metric IDs in §6.2"`,
        );
      }
      if (typeof t[k] !== 'number') p.push(`steps[${i}].targets.${k} is not a number`);
    }
  });
  return p;
}

/** Parse + validate in one step. Throws only when the JSON itself is unparseable. */
export function parseReferenceBank(text: string, expectKata?: string): RefBankHandle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return Object.freeze({
      kataId: expectKata ?? '',
      status: 'INVALID' as RefBankStatus,
      bank: null,
      problems: Object.freeze([`unparseable JSON: ${(e as Error).message}`]),
      path: refBankPath(expectKata ?? ''),
    });
  }
  const problems = validateRefBank(raw, expectKata);
  return Object.freeze({
    kataId: expectKata ?? (isObj(raw) && typeof raw['kata'] === 'string' ? raw['kata'] : ''),
    status: (problems.length === 0 ? 'OK' : 'INVALID') as RefBankStatus,
    bank: problems.length === 0 ? (raw as RefBank) : null,
    problems: Object.freeze([...problems]),
    path: refBankPath(expectKata ?? ''),
  });
}

export const refBankPath = (kataId: string): string => `data/reference/${kataId}.ref.json`;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. Discovery.
 *
 * `import.meta.glob` is a build-time directory read resolved by Vite, so this works identically in
 * the browser bundle and under `server.ssrLoadModule` in plain Node — no `node:fs` (the
 * orchestrator-owned tsconfig ships no `@types/node`, and adding a dependency is forbidden) and no
 * network. Today `data/reference/` holds no files, so `RAW_BANKS` is `{}` and every kata reports
 * `ABSENT`. That is the correct Phase-1 answer, not a fallback.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const RAW_BANKS = import.meta.glob('/data/reference/*.ref.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Kata ids for which a `.ref.json` exists on disk. Empty in Phase 1. */
export const AVAILABLE_REF_BANKS: readonly string[] = Object.freeze(
  Object.keys(RAW_BANKS)
    .map((k) => /([^/]+)\.ref\.json$/.exec(k)?.[1] ?? '')
    .filter(Boolean)
    .sort(),
);

/**
 * Load one kata's bank. `status: 'ABSENT'` when the file does not exist — with a problem string that
 * names the file, says who authors it and states that generating it is forbidden, so the next agent
 * does not "helpfully" write a generator.
 */
export function loadReferenceBank(kataId: KataId | string): RefBankHandle {
  const key = Object.keys(RAW_BANKS).find((k) => k.endsWith(`/${kataId}.ref.json`));
  if (key === undefined) {
    return Object.freeze({
      kataId,
      status: 'ABSENT' as RefBankStatus,
      bank: null,
      problems: Object.freeze([
        `${refBankPath(kataId)} does not exist. It is HAND-AUTHORED by B9 from docs 01/03/02 with ` +
          `doc 07's tolerances (doc 07 §6.1, ARCHITECTURE §4.9). tools/gen-reference.mjs must NEVER ` +
          `be created (§2.6, §9.3) — the scorecard has to retain the ability to disagree with the rig.`,
      ]),
      path: refBankPath(kataId),
    });
  }
  return parseReferenceBank(RAW_BANKS[key]!, kataId);
}

/** Every bank on disk, validated. Empty in Phase 1. */
export function loadAllReferenceBanks(): readonly RefBankHandle[] {
  return Object.freeze(AVAILABLE_REF_BANKS.map((k) => loadReferenceBank(k)));
}

/**
 * One line per channel, for `Scorecard.flags` and the `scorecard.md` header. Making the disarmed
 * state VISIBLE is the requirement; a silently absent channel is what §7.6 defect S-3 was.
 */
export function referenceStatusSummary(): Readonly<Record<string, string | number | boolean>> {
  const banks = loadAllReferenceBanks();
  return Object.freeze({
    channelA_refBanks: banks.length,
    channelA_status: banks.length === 0 ? 'ABSENT' : banks.map((b) => `${b.kataId}:${b.status}`).join(','),
    channelC_armed: CHANNEL_C_STATUS.armed,
    channelC_plates: CHANNEL_C_STATUS.plateCount,
    channelC_postureMatchSigned: CHANNEL_C_STATUS.postureMatchSigned,
  });
}
