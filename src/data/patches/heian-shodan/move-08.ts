/**
 * B2 KATA — per-move patch, THE escape hatch. ARCHITECTURE.md §3.7, §9.1 A-9.
 *
 * heian-shodan move 08  (doc 02-kata-sequences.md §6.1 row 8)
 *
 * EMPTY. Created typed and empty by B0 in Phase 0; owned by B2 from Phase 1 onward. One file
 * per move is what makes two agents fixing two different moves structurally unable to collide,
 * and it is why the routing table of §7.7 can send a step-scoped finding to exactly one file.
 *
 * TO USE THIS FILE (Phase 5, per OWNERSHIP B2 "per-move-fix mode"):
 *   - set `reason` to a non-empty sentence — `tests/kata/patches.test.ts` fails a non-empty
 *     patch with an empty reason, and the scorecard prints it;
 *   - set `finding` to the critic finding id this answers (a MetricId, or 'B3', 'X3', 'F8', …);
 *   - put SCALAR corrections in `override` (§3.7 MoveOverride: stance / tech / hikite / timing /
 *     dynamics / channelLeadMs / footExcursion);
 *   - put PER-BONE corrections in `patch` as PatchKey[] — `{bone, atTau, axis, deltaDeg, widthS}`,
 *     degrees about a named LOCAL axis, baked into LayerTrack 'patch'.
 *
 * Do NOT reach for a global solver or constant edit for a single-step complaint; that is what
 * this file exists to prevent.
 */

import type { MovePatch } from '../../../contracts';

const patch: MovePatch = {
  kataId: 'heian-shodan',
  n: 8,
  reason: '',
  finding: null,
  override: {},
  patch: [],
};

export default patch;
