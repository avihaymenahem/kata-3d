/**
 * B6 PLAYER — `src/player/poseApply.ts`
 *
 * `applyPose(rig, frame)` — §3.13, and the second line of §6.6's frame budget: 52 local quats, the
 * root, and one ribcage scale, at 0.09 ms.
 *
 * ═══ IT DOES NOT UPDATE THE WORLD MATRICES, AND THAT IS DELIBERATE ═══════════════════════════
 * §6.6 lists `rig.root.updateMatrixWorld(true)` as its OWN line item immediately after this one,
 * and `src/rig/landmarks.ts` states the same split from the other side ("MATRIX FRESHNESS IS THE
 * CALLER'S JOB"). Folding the walk in here would run it twice per frame in the composition root —
 * once inside `applyPose` and once before `sampleLandmarks` and `refitShadow`, which both read
 * `matrixWorld` — and doubling a 0.06 ms tree walk is 0.4 % of the whole 16.7 ms budget spent on
 * nothing. Every caller that writes quaternions must therefore update before it MEASURES.
 *
 * ═══ WHY THE ROOT TRANSFORM GOES ON THE GROUP AND NOT ON THE `root` BONE ═════════════════════
 * `BONE_ORDER[0]` is a bone named `root`, and `RigHandles.root` is a `Group` named
 * `karateka_root` — two different objects with the same word in their name, and putting the
 * transform on the wrong one is the kind of mistake that looks right until the figure walks the
 * embusen twice as fast as the feet do.
 *
 * The solver's forward kinematics (B3's `Skel`) resolves bone 0 as
 * `worldQuat = rootQuat · localQuat[0]` and `worldPos = rootPos`. The built rig reproduces exactly
 * that when the Group carries `(rootPos, rootQuat)` and the `root` BONE carries `q[0]`, because
 * B4 builds the `root` bone as a direct child of the Group at a rest offset of `(0, 0, 0)`. So both
 * are written, from different fields, and the world transform of every bone matches the pose the
 * compiler solved. Writing `q[0]` onto the Group instead would drop `rootQuat` entirely; writing
 * `rootPos` onto the bone would leave the Group at the origin and break `RigHandles.root`'s
 * contract as the world/embusen anchor that B5's stage and B7's pins are positioned against.
 *
 * ═══ `ribcage` IS THE ONLY BONE THAT MAY SCALE (§2.8) ═══════════════════════════════════════
 * `SCALABLE_BONE` names it and `NON_SCALING_BONE_COUNT = 51` counts the rest.
 * `tests/rig/scale.test.ts` asserts BIT-EXACTLY that no other bone ever scales at any tick of
 * either kata, so this function must not touch another `scale` even to write 1 — a rewrite of an
 * untouched unit scale is free to differ in the last bit if it is ever computed rather than
 * assigned, and the test would report a rig defect for a player bug. The other 51 keep the value
 * `buildKarateka` left on them and are never named here.
 *
 * `ribcage` is childless by construction (`BONE_PARENT_NAME` gives it no children), which is what
 * makes a non-unit scale safe: no descendant transform inherits it, so the breath layer cannot
 * stretch the neck or the arms.
 *
 * ═══ ALLOCATION ═══════════════════════════════════════════════════════════════════════════════
 * Nothing here allocates. `Quaternion.set` and `Vector3.set` write in place; three's `quaternion`
 * change callback recomputes the bone's Euler `rotation` through a module-level matrix inside
 * three, not a fresh one. There is no scratch to hoist because there is no intermediate value.
 */

import {
  BONE_COUNT,
  SCALABLE_BONE,
  type PoseFrame,
  type RigHandles,
} from '../contracts';

export function applyPose(rig: RigHandles, frame: PoseFrame): void {
  const bones = rig.bones;
  const q = frame.q;

  /* `rig.bones` IS `BONE_ORDER` order — §3.10 declares it and `tests/contracts/bones.test.ts`
   * asserts it against the BUILT rig, which is that test's one deliberately-red cross-block
   * assertion. Indexing directly rather than going through `rig.byName[BONE_ORDER[i]]` is what
   * keeps this inside its 0.09 ms line: 52 string hashes per frame at 60 fps is 3120 lookups a
   * second to re-derive an order the contract already fixes. */
  for (let i = 0; i < BONE_COUNT; i++) {
    const o = i * 4;
    bones[i]!.quaternion.set(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!);
  }

  const rp = frame.rootPos;
  const rq = frame.rootQuat;
  rig.root.position.set(rp[0]!, rp[1]!, rp[2]!);
  rig.root.quaternion.set(rq[0]!, rq[1]!, rq[2]!, rq[3]!);

  const s = frame.scaleRibcage;
  rig.byName[SCALABLE_BONE].scale.set(s[0]!, s[1]!, s[2]!);
}
