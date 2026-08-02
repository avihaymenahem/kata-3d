/**
 * B9 CRITIC — `src/eval/plan.ts`
 *
 * `buildCapturePlan(track, kata)` -> `ShotSpec[]` **SORTED ASCENDING BY TICK**.
 * ARCHITECTURE.md §7.3 (the shot table), §7.1 (why the sort is the whole design), §3.12 `ShotSpec`.
 *
 * ═══ THE SORT IS NOT A CONVENIENCE. IT IS THE DESIGN. ═════════════════════════════════════════
 *
 * Proposal B's capture loop called an exact replay-from-zero inside a nested `for mark x for cam`,
 * which is ~92 replays per kata and **~5.5 minutes of pure cloth before a single pixel** (§9.3).
 * Because this list is tick-sorted and `KataHarness.seek` is contractually monotonic-forward
 * (§3.12), cloth advances through the kata exactly **once per run** instead of once per shot.
 *
 * So: the ordering is a load-bearing invariant, not an aesthetic. `assertMonotonic` is exported and
 * `buildCapturePlan` runs it on its own output before returning — a plan that is out of order must
 * fail here, in 0 ms, and never in `tools/capture.mjs` after four minutes of SwiftShader.
 *
 * IMPORT DISCIPLINE: contracts barrel only. No `three`, no `node:*`, no wall clock.
 */

import type {
  CameraPresetId,
  Handedness,
  KataMove,
  KataScore,
  PoseTrack,
  ShotSpec,
  TrackMark,
} from '../contracts';
import { DEFAULT_KIME_CAMERAS, tickToSec } from '../contracts';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. The §7.3 shot table, as data.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Per-kime default cameras: `M_FRONT`, `M_LEFT`, `M_TOP`, `HERO`, `LOW34` (frozen in
 * `src/contracts/services.ts` as `DEFAULT_KIME_CAMERAS`).
 *
 * `M_TOP` fires on EVERY kime, not once per kata: overhead is a required orbit position, and a
 * per-limb left/right asymmetry or an elbow flaring on one side only is invisible without it
 * (judge 1, fatal A4). `LOW34` is in the DEFAULT list, not just the preset bar — a low
 * three-quarter is the one framing that exposes stance depth and head bob in the same frame.
 */
export const PLAN_BASE_CAMERAS: readonly CameraPresetId[] = DEFAULT_KIME_CAMERAS;

/** Silhouette masks (metric 60) and 4-panel strips are produced for these two ortho views only. */
export const PLAN_STRIP_CAMERAS: readonly CameraPresetId[] = Object.freeze(['M_FRONT', 'M_LEFT']);

/** The mirror check: `M_RIGHT` on every kime whose ACTING arm is the right (§7.3 row 2). */
export const PLAN_MIRROR_CAMERA: CameraPresetId = 'M_RIGHT';

/** Detail cameras, on the four steps of §7.3 row 3. */
export const PLAN_DETAIL_CAMERAS: readonly CameraPresetId[] = Object.freeze([
  'DETAIL_HANDS', 'DETAIL_FEET',
]);

/**
 * §7.3 row 3: "kime of {1, 9, 17, 18}". Step 1 is the first gedan-barai, 9 and 17 are the Heian
 * kiai steps, 18 is the first kokutsu / shuto-uke. Taikyoku has no step 18+ but does have 1 and 9,
 * and its kiai are at 8 and 16, so those are added from `kata.kiaiAt` rather than hard-coded.
 */
export const PLAN_DETAIL_STEPS: readonly number[] = Object.freeze([1, 9, 17, 18]);

/** §7.3 row 4: the JUDGE camera on the kiai ticks and the following hold-end ticks. */
export const PLAN_JUDGE_CAMERA: CameraPresetId = 'JUDGE';

/** §7.3 row 5: one `EMBUSEN` frame per kata, the floor-pattern teaching view. */
export const PLAN_EMBUSEN_CAMERA: CameraPresetId = 'EMBUSEN';

export interface CapturePlanOpts {
  /** `--steps 4,9,17`. Subsets BOTH the base rows and the extra rows. `null` = every step. */
  readonly steps?: readonly number[] | null;
  /** `--cams HERO,LOW34`. Filters the final list. `null` = every camera the plan asked for. */
  readonly cams?: readonly CameraPresetId[] | null;
  /** Drop the silhouette/strip flags (a `--profile hero` PNG-only pass). */
  readonly noStrips?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. Naming — `step-04_t07.750_kime_M_LEFT_hidari-chudan-oi-zuki_zenkutsu` (§7.3).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** Filename-safe, deterministic, locale-independent. No `toLocaleLowerCase`. */
export function slug(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) out += String.fromCharCode(c + 32);
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch;
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** `t07.750`: seconds with three decimals, integer part zero-padded to two digits. */
export function tickStamp(tick: number): string {
  const s = tickToSec(tick);
  const whole = Math.floor(s);
  return `t${String(whole).padStart(2, '0')}.${String(Math.round((s - whole) * 1000)).padStart(3, '0')}`;
}

function shotName(mark: TrackMark, cam: CameraPresetId, move: KataMove | null): string {
  const stamp = tickStamp(mark.tick);
  if (move === null) {
    // Ceremony: 'yoi_t06.700_ceremony_HERO_hachiji'.
    return `${slug(mark.label)}_${stamp}_${mark.kind}_${cam}`;
  }
  return `step-${String(move.n).padStart(2, '0')}_${stamp}_${mark.kind}_${cam}_${slug(move.label)}_${move.stance}`;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. Mark selection.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const isCeremonyLabelled = (m: TrackMark, needle: string): boolean =>
  m.kind === 'ceremony' && slug(m.label).includes(needle);

/** The yoi mark, or `null` when the ceremony has not been compiled yet. */
export const findYoi = (marks: readonly TrackMark[]): TrackMark | null =>
  marks.find((m) => isCeremonyLabelled(m, 'yoi')) ?? null;
/** The yame mark. */
export const findYame = (marks: readonly TrackMark[]): TrackMark | null =>
  marks.find((m) => isCeremonyLabelled(m, 'yame')) ?? null;

/**
 * §7.3 row 1's tick set: every `kime` mark, plus `yoi` and `yame`. 23 for Heian (21 kime + 2),
 * 22 for Taikyoku (20 kime + 2).
 */
export function baseMarks(track: PoseTrack, steps: readonly number[] | null): readonly TrackMark[] {
  const kime = track.marks.filter((m) => m.kind === 'kime' && inSteps(m.moveN, steps));
  const extra: TrackMark[] = [];
  // yoi/yame are whole-kata ceremony frames: a `--steps` subset does not remove them, because a
  // reader needs the opening and closing posture to judge any step in context.
  const yoi = findYoi(track.marks);
  const yame = findYame(track.marks);
  if (yoi) extra.push(yoi);
  if (yame) extra.push(yame);
  return Object.freeze([...kime, ...extra]);
}

const inSteps = (moveN: number, steps: readonly number[] | null): boolean =>
  steps === null || steps.includes(moveN);

/** The acting arm of a move, or `null` for a move with no technique. */
const actingArm = (m: KataMove | undefined): Handedness | null =>
  m && m.tech.id !== 'none' ? m.tech.arm : null;

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. `buildCapturePlan`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A total order on shots: tick first, then camera (by the frozen preset order), then name. The
 * secondary keys exist so two runs at one sha produce a BYTE-IDENTICAL `shotlist.json`
 * (`tests/integration/repeatability.test.ts`); `Array.prototype.sort` is only stable within equal
 * keys, so equal ticks need a real tie-break rather than luck.
 */
const CAMERA_ORDER: readonly CameraPresetId[] = Object.freeze([
  'M_FRONT', 'M_LEFT', 'M_RIGHT', 'M_TOP', 'HERO', 'LOW34', 'JUDGE',
  'DETAIL_HANDS', 'DETAIL_FEET', 'EMBUSEN', 'FOLLOW', 'ORBIT',
]);
const camRank = (c: CameraPresetId): number => {
  const i = CAMERA_ORDER.indexOf(c);
  return i < 0 ? CAMERA_ORDER.length : i;
};

export function compareShots(a: ShotSpec, b: ShotSpec): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  const ra = camRank(a.camera);
  const rb = camRank(b.camera);
  if (ra !== rb) return ra - rb;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Throws if a plan is not ascending by tick — the invariant §7.1 depends on. */
export function assertMonotonic(plan: readonly ShotSpec[]): void {
  for (let i = 1; i < plan.length; i++) {
    if (plan[i]!.tick < plan[i - 1]!.tick) {
      throw new Error(
        `buildCapturePlan produced a NON-MONOTONIC plan at index ${i}: tick ${plan[i]!.tick} ` +
          `after ${plan[i - 1]!.tick}. §7.3 requires ascending ticks so tools/capture.mjs can seek ` +
          `strictly forward and cloth advances through the kata exactly once per run (§7.1).`,
      );
    }
  }
}

export function buildCapturePlan(
  track: PoseTrack,
  kata: KataScore,
  opts: CapturePlanOpts = {},
): readonly ShotSpec[] {
  const steps = opts.steps ?? null;
  const moveByN = new Map<number, KataMove>(kata.moves.map((m) => [m.n, m]));
  const out: ShotSpec[] = [];

  const push = (
    mark: TrackMark,
    camera: CameraPresetId,
    o: { silhouette?: boolean; strip?: boolean } = {},
  ): void => {
    const move = moveByN.get(mark.moveN) ?? null;
    out.push(
      Object.freeze({
        tick: mark.tick,
        moveN: mark.moveN,
        mark: mark.kind,
        camera,
        png: true,
        silhouette: !opts.noStrips && (o.silhouette ?? false),
        strip: !opts.noStrips && (o.strip ?? false),
        name: shotName(mark, camera, move),
      }),
    );
  };

  /* ── row 1: every kime + yoi + yame, on the five default cameras ───────────────────────── */
  const base = baseMarks(track, steps);
  for (const mark of base) {
    for (const cam of PLAN_BASE_CAMERAS) {
      const isStripCam = PLAN_STRIP_CAMERAS.includes(cam);
      push(mark, cam, { silhouette: isStripCam, strip: isStripCam });
    }
  }

  /* ── row 2: + M_RIGHT on every kime whose acting arm is R ──────────────────────────────── */
  for (const mark of base) {
    if (mark.kind !== 'kime') continue;
    if (actingArm(moveByN.get(mark.moveN)) !== 'R') continue;
    push(mark, PLAN_MIRROR_CAMERA);
  }

  /* ── row 3: + DETAIL_HANDS / DETAIL_FEET on steps {1, 9, 17, 18} and every kiai step ───── */
  const detailSteps = new Set<number>([...PLAN_DETAIL_STEPS, ...kata.kiaiAt]);
  for (const mark of base) {
    if (mark.kind !== 'kime' || !detailSteps.has(mark.moveN)) continue;
    for (const cam of PLAN_DETAIL_CAMERAS) push(mark, cam);
  }

  /* ── row 4: JUDGE on each kiai tick and the first hold-end at or after it ──────────────── */
  const holdEnds = track.marks.filter((m) => m.kind === 'hold-end');
  for (const kiai of track.marks.filter((m) => m.kind === 'kiai' && inSteps(m.moveN, steps))) {
    push(kiai, PLAN_JUDGE_CAMERA);
    const after = holdEnds.find((h) => h.tick >= kiai.tick);
    if (after) push(after, PLAN_JUDGE_CAMERA);
  }

  /* ── row 5: one EMBUSEN frame per kata, at yoi (the embusen origin) ────────────────────── */
  const embusenAt = findYoi(track.marks) ?? base[0] ?? track.marks[0] ?? null;
  if (embusenAt) push(embusenAt, PLAN_EMBUSEN_CAMERA);

  /* ── filter, sort, verify ──────────────────────────────────────────────────────────────── */
  const cams = opts.cams ?? null;
  const filtered = cams === null ? out : out.filter((s) => cams.includes(s.camera));
  const sorted = Object.freeze([...filtered].sort(compareShots));
  assertMonotonic(sorted);
  return sorted;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. Plan summary — what `tools/capture.mjs` prints before it starts, and what `meta.json` records.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export interface PlanSummary {
  readonly shots: number;
  readonly pngs: number;
  readonly silhouettes: number;
  readonly strips: number;
  readonly distinctTicks: number;
  readonly cameras: readonly CameraPresetId[];
  readonly firstTick: number;
  readonly lastTick: number;
  readonly monotonic: boolean;
}

export function summarisePlan(plan: readonly ShotSpec[]): PlanSummary {
  const ticks = new Set<number>();
  const cams = new Set<CameraPresetId>();
  let png = 0;
  let sil = 0;
  let strip = 0;
  for (const s of plan) {
    ticks.add(s.tick);
    cams.add(s.camera);
    if (s.png) png++;
    if (s.silhouette) sil++;
    if (s.strip) strip++;
  }
  let monotonic = true;
  for (let i = 1; i < plan.length; i++) if (plan[i]!.tick < plan[i - 1]!.tick) monotonic = false;
  return Object.freeze({
    shots: plan.length,
    pngs: png,
    silhouettes: sil,
    strips: strip,
    distinctTicks: ticks.size,
    cameras: Object.freeze([...cams].sort((a, b) => camRank(a) - camRank(b))),
    firstTick: plan[0]?.tick ?? 0,
    lastTick: plan[plan.length - 1]?.tick ?? 0,
    monotonic,
  });
}
