/**
 * B3 SOLVER — `src/solve/frame.ts`
 *
 * *** THE HANDEDNESS BOUNDARY. THIS FILE IS THE ONLY ONE IN THE PROJECT ALLOWED TO NEGATE AN X
 *     OR A YAW. *** ARCHITECTURE.md §2.1, §4.3; `tools/verify-contracts.mjs` bans
 *     `SIDE_SIGN`, `toWorld*`, `position.x = -` and `rotation.y = -` everywhere else
 *     (`SIDE_SIGN_LEAK`, `SECOND_FRAME_CONVERSION`, `X_NEGATION`, `YAW_NEGATION`).
 *
 * Docs 01/02/03/04/06 all label `+X` as the character's LEFT. Doc 07 §0.1 proves that frame is
 * left-handed against our right-handed world, so authored LEFT must land at world `−X`. Every
 * authored number in `src/data/**` and `src/contracts/bones.ts` is kept VERBATIM in the doc frame
 * and converted here, exactly once, at the point of use.
 *
 * ═══ TWO YAW CONVERTERS, AND THEY ARE NOT THE SAME FUNCTION ═════════════════════════════════
 * This is the trap `docs/BRIEFS.md` B3 calls out by name, and it is worth restating because the
 * naive reading of §2.1's prose ("negates every authored x and every authored yaw magnitude")
 * mirrors the entire kata:
 *
 *   `toWorldYawDeg(headingDeg)`  is the **IDENTITY**.  doc-02 headings.
 *   `toWorldPsiDeg(psiDeg)`      is a **NEGATION**.    doc-04 §0 ψ-class hip/shoulder yaws.
 *
 * The derivation lives in `src/contracts/units.ts` and is pinned by
 * `tests/contracts/handedness.test.ts`; the short form is that three.js applies
 * `rotation.y = β` as `R_y(β)`, and `R_y(H·DEG)·(0,0,−1) = (−sin H, 0, −cos H) = facingWorld(H)`.
 * A heading is not itself an authored rotation — the authored rotation that PRODUCES heading `H`
 * is `−H`, and negating THAT gives `+H`. ψ, by contrast, IS authored as a rotation (+ = left hip
 * advanced), so it flips like any other authored yaw.
 *
 * Merging them is invisible at `H = 0` and at `ψ = 0`, i.e. at yoi, which is exactly the frame a
 * reviewer looks at first.
 *
 * ═══ WHY `toWorld` IS ITS OWN INVERSE, AND WHY THAT IS NOT AN EXCUSE TO SKIP IT ══════════════
 * The conversion is a reflection: `toWorld(toWorld(v)) === v`. It is therefore tempting to "just
 * negate x where you need it". Don't — the ban exists because a reflection applied an even number
 * of times along one path and an odd number along another produces a figure that is internally
 * consistent, passes every scalar metric, and is mirrored. §7.6 notes the scorecard and Channel B
 * are both built from this same `SIDE_SIGN`, so neither can see it.
 */

import type { Handedness } from '../contracts';
import {
  DEG,
  H,
  SIDE_SIGN,
  WORLD_YAW_OF_HEADING_SIGN,
  WORLD_YAW_OF_PSI_SIGN,
  facingWorld,
  sideSign,
} from '../contracts';

export type Vec3 = readonly [number, number, number];

/** Re-exported so no consumer needs to reach past this file for the per-limb lateral sign. */
export { sideSign };
export type { Handedness };

/**
 * §3.13. AUTHORED point/offset -> WORLD. The single x-negation of §2.1.
 *
 * Works on positions, offsets and direction vectors alike, because the conversion is a pure
 * reflection about the YZ plane and carries no translation.
 */
export function toWorld(v: Vec3): [number, number, number] {
  return [SIDE_SIGN * v[0], v[1], v[2]];
}

/** In-place form for the hot paths (per-bone, per-tick). Same reflection, no allocation. */
export function toWorldInto(v: Vec3, out: Float64Array, o = 0): Float64Array {
  out[o + 0] = SIDE_SIGN * v[0];
  out[o + 1] = v[1];
  out[o + 2] = v[2];
  return out;
}

/** `toWorld` on a flat `Float64Array` triple, in place. Used for `PRIMARY_AXIS` / `REST_OFFSET_H`. */
export function toWorldTripleInPlace(a: Float64Array, i: number): void {
  a[i * 3] = SIDE_SIGN * a[i * 3]!;
}

/**
 * §3.13. A doc-02 HEADING, authored -> world, in degrees. **THE IDENTITY.**
 *
 * Written as a multiplication by the named contract constant rather than as `return deg`, so the
 * claim is machine-checkable from `units.ts` and a reader sees which of the two conventions this
 * is without leaving the line.
 */
export function toWorldYawDeg(authoredDeg: number): number {
  return WORLD_YAW_OF_HEADING_SIGN * authoredDeg;
}

/**
 * A doc-04 §0 ψ-class authored yaw (pelvis/thorax rotation, + = the character's LEFT hip advanced)
 * -> world. **A NEGATION.** Deliberately NOT named `toWorldYaw*` — the ban's regex
 * (`/(?:function|const|let|var)\s+toWorld(?:YawDeg|Yaw)?\b/`) would not catch a second definition
 * elsewhere named `toWorldPsiDeg`, so the separation is enforced by review and by
 * `tests/solve/stances.test.ts`, not by grep.
 */
export function toWorldPsiDeg(authoredPsiDeg: number): number {
  return WORLD_YAW_OF_PSI_SIGN * authoredPsiDeg;
}

/** doc 02 §1 `f(H)` in the WORLD frame: `(−sin H, 0, −cos H)`. Re-exported from `units.ts`. */
export const worldFacing = facingWorld;

/** The world-frame LEFT-of-the-character unit vector at heading `H`: `f(H)` rotated +90° about Y. */
export function worldCharLeft(headingDeg: number): readonly [number, number, number] {
  const f = facingWorld(headingDeg);
  /* Rotating (fx, 0, fz) by +90° about +Y gives (fz, 0, −fx). At H = 0 that is (−1, 0, 0), which
   * is world −X — the character's left, exactly as §2.1 requires. */
  return [f[2], 0, -f[0]];
}

/**
 * An AUTHORED embusen point `[x, z]` in units of `L` -> a WORLD `[x, z]` in METRES.
 *
 * Two conversions in one call on purpose: an embusen coordinate is never useful in one frame and
 * the wrong unit, and splitting them invites a call site that scales without reflecting.
 */
export function embusenToWorldM(xz: readonly [number, number], lMetres: number): [number, number] {
  return [SIDE_SIGN * xz[0] * lMetres, xz[1] * lMetres];
}

/** FracH -> world metres. Here rather than in a util file so the solver has one import for frames. */
export const hToM = (fracH: number): number => fracH * H;
/** World metres -> FracH. */
export const mToH = (metres: number): number => metres / H;

/** Degrees -> radians, re-exported so the solver's trig has one source. */
export const deg = (d: number): number => d * DEG;

/**
 * The world yaw, in RADIANS, to apply as `root.rotation.y` for an authored heading.
 * B6 assigns this directly; the `+` is the whole content of the `YAW_NEGATION` ban.
 */
export function rootYawRad(authoredHeadingDeg: number): number {
  return toWorldYawDeg(authoredHeadingDeg) * DEG;
}
