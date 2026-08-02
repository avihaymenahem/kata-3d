/**
 * B9 CRITIC — `src/eval/fileMap.ts`
 *
 * `BLAME_MAP`: `MetricId | FaultId | RubricId -> FixSite[]`, and `blame(id)`.
 * ARCHITECTURE.md §7.7 ("complaint -> file, mechanically"), §4.9, §3.13.
 *
 * ═══ WHY THIS FILE IS SEPARATE FROM `metricSpecs.ts` ══════════════════════════════════════════
 *
 * `MetricSpec.fixSite` covers the 63 metrics. It does NOT cover:
 *
 *   * the ~60 executable FAULT predicates of doc 01 §9 (Z / K / B / Y / X families) and doc 03 §11.1
 *     (F family) — several of which have no doc 07 metric at all (Z7 knee valgus, F1 chicken-winged
 *     elbow, F11 premature roll, F16 no snap-back);
 *   * the ~20 Channel D rubric ids of doc 07 §6.8 with no metric behind them (A9, B6, B11, B15, C4,
 *     C5, C7, C10, C13 …), which is exactly the set a VLM critic reports and a router must still be
 *     able to route.
 *
 * Without those rows, a Tier-A VLM finding lands with no owner and the loop stalls on a human.
 * `docs/critic/routing.md` is the prose companion (orchestrator-owned).
 *
 * `tests/eval/fixsites.test.ts` reads every `FixSite.file` here and in `metricSpecs.ts`, and fails
 * if the named `symbol` does not resolve to an exported binding — a fix site cannot silently rot.
 */

import type { BlockId, CriticFinding, FixSite, MetricId } from '../contracts';
import { METRICS, symbolOfKnob } from './metricSpecs';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. Site constructors.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const s = (
  file: string,
  knob: string,
  kind: FixSite['kind'],
  block: BlockId,
  hint: string,
): FixSite => Object.freeze({ file, symbol: symbolOfKnob(knob), knob, kind, block, hint });

const b1 = (file: string, knob: string, hint: string, kind: FixSite['kind'] = 'constant'): FixSite =>
  s(`src/data/constants/${file}`, knob, kind, 'B1', hint);
const b3 = (file: string, symbol: string, hint: string): FixSite =>
  s(`src/solve/${file}`, `${symbol}()`, 'solver', 'B3', hint);
const b4 = (file: string, knob: string, hint: string): FixSite =>
  s(`src/rig/${file}`, knob, 'rig', 'B4', hint);
const b5 = (file: string, knob: string, hint: string): FixSite =>
  s(`src/render/${file}`, knob, 'render', 'B5', hint);
const b7 = (file: string, knob: string, hint: string): FixSite =>
  s(`src/cloth/${file}`, knob, 'cloth', 'B7', hint);
const b8 = (file: string, knob: string, hint: string): FixSite =>
  s(`src/ui/${file}`, knob, 'render', 'B8', hint);

/**
 * The per-move escape hatch. `<kata>` and `<NN>` are placeholders the router substitutes from the
 * finding's `moveN`: 41 files exist from Phase 1, so two agents fixing two different moves are
 * STRUCTURALLY unable to collide (§9.1 A-9 answer 2).
 */
const movePatch = (hint: string): FixSite =>
  s('src/data/patches/<kata>/move-<NN>.ts', 'patch', 'move-patch', 'B2', hint);
const moveOverride = (knob: string, hint: string): FixSite =>
  s('src/data/patches/<kata>/move-<NN>.ts', knob, 'move-override', 'B2', hint);

/**
 * The four changes that stop every agent (OWNERSHIP). Routing here is deliberate and rare.
 *
 * NOTE ON THE SYMBOL. The global mirror constant in `src/contracts/units.ts` is grep-banned outside
 * three allowlisted files (`tools/verify-contracts.mjs` ban `SIDE_SIGN_LEAK`), and a routing table is
 * not one of them. Naming it here as a string literal would trip the ban, and weakening the ban to
 * accommodate a comment would be strictly worse than routing to the exported accessor every other
 * block is required to use: `sideSign(h)`. The `hint` carries the conflict id (C01) so the agent
 * lands on the right paragraph of `units.ts`, which it has to open regardless — the change is an
 * `[integrator]` commit that stops every agent.
 */
const frozen = (knob: string, hint: string): FixSite =>
  s('src/contracts/units.ts', knob, 'frozen', 'B0', hint);

/** Resolve the `<kata>` / `<NN>` placeholders for a concrete finding. */
export function resolveMoveSite(site: FixSite, kataId: string, moveN: number): FixSite {
  if (!site.file.includes('<kata>')) return site;
  return Object.freeze({
    ...site,
    file: site.file
      .replace('<kata>', kataId)
      .replace('<NN>', String(moveN).padStart(2, '0')),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. doc 01 §9 — Z (zenkutsu), K (kokutsu), B (kiba), Y (standing/yoi), X (cross-stance).
 *
 * `ARCHITECTURE §7.7` gives the routes it names; the rest follow the same logic — an authored
 * scalar routes to B1, a derived pose quantity routes to the stage of B3 that produces it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const STANCE_SOLVE = b3('stance.ts', 'solveStance',
  'S3 asserts pelvisY comes back equal to its input to 1e-9, so a height fault is a solver fault, never a tuning one');

const FAULT_SITES: Readonly<Record<string, readonly FixSite[]>> = Object.freeze({
  /* ── Z · zenkutsu-dachi (doc 01 §9.1) ─────────────────────────────────────────────────── */
  Z1: [b1('stances.ts', 'STANCES.zenkutsu.S.v', 'S < 0.500 H. §7.7 row 1'),
       moveOverride('override.stance.S', 'scope it to one step instead of moving every zenkutsu')],
  Z2: [b1('stances.ts', 'STANCES.zenkutsu.S.v', 'S > 0.580 H forces a heel lift (doc 01 §3.5) — Z3 becomes unavoidable')],
  Z3: [b1('stances.ts', 'STANCES.zenkutsu.yawRear.v',
        'doc 01 §3.5 proves the lift is GEOMETRICALLY FORCED above S > 0.580 H, so the fix is the yaw, not effort. §7.7 row 3')],
  Z4: [STANCE_SOLVE],
  Z5: [STANCE_SOLVE],
  Z6: [STANCE_SOLVE],
  Z7: [b3('twoBoneIK.ts', 'solveTwoBone',
        'knee valgus is a POLE-VECTOR fault: the mid joint bends toward poleWorld. Critical — looks amateur and reads as injury')],
  Z8: [b1('stances.ts', 'STANCES.zenkutsu.W.v', 'W < 0.100 H; dispute D13')],
  Z9: [b1('stances.ts', 'STANCES.zenkutsu.W.v', 'W > 0.240 H; dispute D13')],
  Z10: [b1('stances.ts', 'FIGHT_PELVIS_Y.v', 'PELVIS_Y > 0.440 H — doc 01 §2 labels 0.440 "too high, FAIL for kihon". §7.7 row 2')],
  Z11: [b1('stances.ts', 'FIGHT_PELVIS_Y.v', 'PELVIS_Y < 0.375 H — hips break')],
  Z12: [b1('stances.ts', 'STANCES.zenkutsu.torsoPitch.v', 'forward lean > 5 deg')],
  Z13: [b1('stances.ts', 'STANCES.zenkutsu.pelvisTiltPost.v', 'ANY anterior tilt fails; doc 01 §3.3 says never negative')],
  Z14: [b1('stances.ts', 'STANCES.zenkutsu.yawRear.v', 'rear foot over-rotated past +50 deg')],
  Z15: [b1('stances.ts', 'STANCES.zenkutsu.yawRear.v', 'rear foot forced square below +18 deg, which then forces Z3')],
  Z16: [b1('stances.ts', 'STANCES.zenkutsu.yawFront.v', 'front foot turned out past -12 deg')],
  Z17: [b3('spine.ts', 'solveSpineWhip', '|torso_yaw - pelvis_yaw| > 10 deg; S8 caps the X-factor at 15 deg')],
  Z18: [b3('gaze.ts', 'solveGaze', '|head_yaw_absolute| > 8 deg — the eyes lead the technique')],
  Z19: [STANCE_SOLVE],
  Z20: [b3('spine.ts', 'solveSpineWhip', 'hips rotate too early; S7 asserts |psi(0.5) - psi_start| <= 8 deg')],
  Z21: [b3('footPlant.ts', 'buildPlantPlan', 'swing sole clearance > 0.020 H reads as a WALK, not a step')],
  Z22: [STANCE_SOLVE],

  /* ── K · kokutsu-dachi (doc 01 §9.2) ──────────────────────────────────────────────────── */
  K1: [b1('stances.ts', 'STANCES.kokutsu.loadFront.v', 'front load > 40 % — critical; doc 01 §4.2 measures 30.26 %')],
  K2: [b1('stances.ts', 'STANCES.kokutsu.kneeRear.v', 'rear knee flexion < 62 deg or drop < 0.095 H')],
  K3: [b1('stances.ts', 'STANCES.kokutsu.kneeFront.v', 'front knee locked below 8 deg')],
  K4: [b3('twoBoneIK.ts', 'solveTwoBone', 'rear knee collapsing inward — a pole-vector fault, same family as Z7')],
  K5: [b3('footPlant.ts', 'buildPlantPlan', 'heels must lie on one line to 0.030 H')],
  K6: [b1('stances.ts', 'STANCES.kokutsu.yawRear.v', 'rear foot outside [82, 98] deg')],
  K7: [b1('stances.ts', 'STANCES.kokutsu.pelvisYawHanmi.v', 'hips square instead of hanmi; dispute D06')],
  K8: [b1('stances.ts', 'STANCES.kokutsu.pelvisYawHanmi.v', 'hips over-turned past 60 deg; style-dependent, doc 01 §11')],
  K9: [STANCE_SOLVE],
  K10: [b1('stances.ts', 'STANCES.kokutsu.S.v', 'S > 0.470 H geometrically forces K1 or K2; doc 01 §4.3, dispute D07')],
  K11: [b1('stances.ts', 'STANCES.kokutsu.S.v', 'S < 0.400 H')],
  K12: [b3('footPlant.ts', 'applyPlantLock', 'front heel lifted above 0.004 H')],

  /* ── B · kiba-dachi (doc 01 §9.3) ─────────────────────────────────────────────────────── */
  B1: [b1('stances.ts', 'STANCES.kiba.W.v', 'W < 0.470 H forces drop < 0.088 H — critical')],
  B2: [b1('stances.ts', 'STANCES.kiba.W.v', 'W > 0.555 H forces drop > 0.148 H and the feet roll')],
  B3: [b3('twoBoneIK.ts', 'solveTwoBone', 'knees inside the feet by > 0.012 H — critical')],
  B4: [b3('twoBoneIK.ts', 'solveTwoBone', 'knees pushed > 0.025 H lateral of the ankles distorts the stance (Bertel)')],
  B5: [b1('stances.ts', 'STANCES.kiba.yawFront.v', '|foot_yaw| > 10 deg is shiko-dachi, not kiba-dachi')],
  B6: [b3('footPlant.ts', 'buildPlantPlan', 'fore/aft foot offset |dZ| > 0.020 H')],
  B7: [b1('stances.ts', 'STANCES.kiba.pelvisTiltPost.v', 'buttocks out: sagittal tilt below +6 deg')],
  B8: [b1('stances.ts', 'STANCES.kiba.torsoPitch.v', 'forward lean > 3 deg or |roll| > 2 deg')],
  B9: [b3('footPlant.ts', 'applyPlantLock', 'any of the 4 foot corners above 0.004 H')],
  B10: [b1('stances.ts', 'STANCES.kiba.kneeFront.v', 'knee flexion < 52 deg')],
  B11: [b1('stances.ts', 'FIGHT_PELVIS_Y.v',
        'doc 01 §2 MASTER INVARIANT: |PELVIS_Y(kiba) - PELVIS_Y(zenkutsu)| > 0.012 H is critical — one working height for all three fighting stances')],

  /* ── Y · standing / yoi (doc 01 §9.4) ─────────────────────────────────────────────────── */
  Y1: [b1('stances.ts', 'STANCES.hachiji.W.v', 'yoi wider than 0.310 H')],
  Y2: [b1('stances.ts', 'STANCES.hachiji.W.v', 'yoi narrower than 0.210 H')],
  Y3: [b1('stances.ts', 'STANCES.hachiji.kneeFront.v', 'knees locked / hyperextended below 0.5 deg')],
  Y4: [b1('stances.ts', 'STANCES.hachiji.pelvisY.v', 'knees visibly bent at yoi, or drop > 0.020 H')],
  Y5: [b1('stances.ts', 'STANCES.musubi.W.v', 'musubi heels apart by > 0.015 H')],
  Y6: [b1('stances.ts', 'STANCES.heisoku.W.v', 'heisoku feet apart by > 0.075 H')],
  Y7: [b3('spine.ts', 'solvePelvisTilt', '|pelvis_roll| > 3 deg. The seeded 0.6 deg resting roll is drawn once from trackHash')],

  /* ── X · cross-stance / transition (doc 01 §9.5) ──────────────────────────────────────── */
  X1: [b1('stances.ts', 'FIGHT_PELVIS_Y.v', 'stances at different heights — the same master invariant as B11')],
  X2: [STANCE_SOLVE],
  X3: [b3('spine.ts', 'solveSpineWhip',
        'A LINEAR PELVIS YAW RAMP. Structurally impossible if yaw is GENERATED by holdThenSnap (contracts/ease.ts); S7 asserts the predicate at compile time. §7.7 row 5')],
  X4: [b3('footPlant.ts', 'buildPlantPlan', 'feet leave their +-0.085 H lanes by > 0.030 H')],
  X5: [b1('dynamics.ts', 'CHANNEL_DYN.rearFootDrive.leadMs.v', 'body arrives before the technique by > 0.05 s', 'channel-dynamics')],
  X6: [b1('dynamics.ts', 'CHANNEL_DYN.elbowExtend.leadMs.v', 'technique arrives AFTER the heel contact — high severity', 'channel-dynamics')],

  /* ── F · doc 03 §11.1, upper body ─────────────────────────────────────────────────────── */
  F1: [b3('arm.ts', 'poleFor', 'CHICKEN-WINGED ELBOW. §7.7 row 12: the elbow pole direction, not the endpoint')],
  F1b: [b3('arm.ts', 'poleFor', 'perpendicular distance of the elbow from the GH->knuckle line')],
  F1c: [b3('arm.ts', 'poleFor', 'elbow Y above GH_y - 0.090 H during 10-80 % of the stroke')],
  F1d: [b3('arm.ts', 'poleFor', 'elbow tip direction deviating from -Y by > 20 deg')],
  F2: [b3('spine.ts', 'solveSpineWhip', 'over-rotated shoulder at kime; doc 04 §2.1 caps the X-factor at 15 deg')],
  F2b: [b3('spine.ts', 'solveSpineWhip', 'shoulder-line yaw past shomen')],
  F2c: [b3('arm.ts', 'clavicleRhythm', 'girdle protraction: GH forward of the sternum by > 0.012 H')],
  F3: [b3('arm.ts', 'clavicleRhythm',
        'RAISED SHOULDER — an explicit JKA judging criterion. A GLOBAL shrug is the clavicle rhythm'),
       movePatch(
         'a shrug on ONE step is a PatchKey on clavicle_L/R in that move file, NEVER a global clavicleRhythm edit (§7.7 row 11) — that is the difference between fixing step 18 and re-tuning all 41 moves')],
  F4: [b1('techniques.ts', 'TECHNIQUES["oi-zuki-chudan"].end.dx.v', 'punch crossing the centreline. §7.7 row 10', 'technique-keyframe')],
  F4b: [b1('techniques.ts', 'TECHNIQUES["oi-zuki-chudan"].maxLateralDevH.v', 'knuckle deviation from the start->end chord', 'technique-keyframe')],
  F4c: [b1('techniques.ts', 'TECHNIQUES["oi-zuki-chudan"].end.dx.v', 'END knuckle X should land on the centreline in shomen', 'technique-keyframe')],
  F5: [b1('techniques.ts', 'UKE_ELBOW_CLEARANCE_H.soto.v', 'block too far from the body: elbow clearance > 0.110 H (2 fists)')],
  F5b: [b1('techniques.ts', 'TECHNIQUES["soto-uke-chudan"].end.dz.v', 'fist centre more than 0.215 H forward of GH', 'technique-keyframe')],
  F5c: [b1('techniques.ts', 'AGE_UKE_WRIST_TO_FOREHEAD_H.v', 'age-uke wrist<->forehead outside 0.028-0.083 H')],
  F6: [b1('techniques.ts', 'TECHNIQUES["soto-uke-chudan"].end.dz.v', 'block collapsed onto the body: dz < 0.155 H', 'technique-keyframe')],
  F7: [b1('techniques.ts', 'TECHNIQUES["oi-zuki-chudan"].elbowIncludedDeg.v', 'ELBOW HYPEREXTENSION above 174 deg; hard max 176', 'technique-keyframe')],
  F8: [b1('techniques.ts', 'AGE_UKE_FOREARM_INCL_DEG.v', 'age-uke forearm flat or vertical; outside 25 +-8 deg. Dispute D03')],
  F9: [b1('techniques.ts', 'HIKITE_HIP_A.end.dz.v', 'WEAK / LAZY HIKITE — the single most recognisable Shotokan signature. §7.7 row 9', 'technique-keyframe')],
  F9b: [b1('techniques.ts', 'HIKITE_HIP_A.end.dy.v', 'hikite fist not pulled to the hip', 'technique-keyframe')],
  F10: [b1('dynamics.ts', 'CHANNEL_DYN.hikite.leadMs.v',
        'hikite/strike desync above 0.020 s. The 17 ms lead is carried as an EXACT integer tick count (§2.4 G-9c)', 'channel-dynamics')],
  F11: [b1('techniques.ts', 'TECHNIQUES["oi-zuki-chudan"].rollWindow', 'roll completed before 88 % of the path', 'technique-keyframe')],
  F12: [b3('arm.ts', 'solveArm', 'WRIST BREAK at impact above 6 deg')],
  F12b: [b3('arm.ts', 'solveArm', 'wrist ulnar/radial deviation outside spec')],
  F13: [b1('stances.ts', 'STANCES.zenkutsu.torsoPitch.v', 'trunk pitch off vertical above 3 deg — JKA "maintain a straight upper body"')],
  F14: [STANCE_SOLVE],
  F15: [b1('dynamics.ts', 'CHANNEL_DYN.rearFootDrive.leadMs.v', 'foot lands before the punch by more than 0.030 s', 'channel-dynamics')],
  F16: [b1('dynamics.ts', 'DYN["tettsui-otoshi"].recoilFracL.v',
        'NO SNAP-BACK on uchi-waza. recoilFracL is a fraction of the END-EFFECTOR path length (~0.50 m), NEVER of L_M = 0.945 m (conflict C17)', 'channel-dynamics')],
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. doc 07 §6.8 Channel D rubric ids. The ~20 with no metric are the reason this table exists.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const RUBRIC_SITES: Readonly<Record<string, readonly FixSite[]>> = Object.freeze({
  A9: [b3('bake.ts', 'bakeSegments',
        'KEYFRAME SMELL. §7.7 row 17: read bake.json maxStepDeg BEFORE touching anything else — G-9b caps it at 12 deg per baked interval, and the 6285 deg/s forearm roll is what forces the 960 rung')],
  A10: [frozen('sideSign',
        'THE WHOLE KATA IS MIRRORED (hidari <-> migi). The fix is the C01 world-frame flip constant in src/contracts/units.ts — the ONE place the flip lives (§2.1). §7.7: [integrator] COMMIT ONLY; it stops all agents, invalidates every artefact on disk and needs a docs/CONTRACT-CHANGELOG.md entry. Channel C is the ONLY independent detector, because the scorecard and Channel B are both built from that same constant (§7.6), so neither can see the flip')],
  B6: [b3('arm.ts', 'poleFor', 'elbow flares outward during oi-zuki — same site as the F1 family')],
  B11: [b3('spine.ts', 'solveSpineWhip', 'turns exactly linear in yaw with no head-first sequencing — see X3')],
  B15: [b1('dynamics.ts', 'TEMPO_CLASSES.N.tHold.v',
        'IDENTICAL TIMING ON EVERY MOVE, no phrasing. tempoScale touches T_prep and T_hold only, so a tempo change can never flatten a technique (doc 04 §11 invariant 7)', 'channel-dynamics')],
  B8: [b1('cloth.ts', 'CLOTH.alphaBend.v',
        'GI COMPLETELY RIGID. §7.7 row 15: the swatch test must stay green — 0.20 m swatch, free edge droops 7.5 +-1.5 cm', 'cloth')],
  C4: [b1('dynamics.ts', 'SETTLE.fist.ampFracL.v',
        'NO MICRO-SETTLE. ampFracL is a fraction of the END-EFFECTOR path length (conflict C17); scaling by L_M makes every overshoot 1.9x too big', 'channel-dynamics')],
  C5: [b1('dynamics.ts', 'BREATH.ribcageAmplitude.v',
        'BREATHING ABSENT. Breath drives ribcage.scale, and `ribcage` is the ONLY bone permitted a non-unit scale (§2.8), so no descendant bone length can drift', 'channel-dynamics')],
  C6: [b3('impulses.ts', 'buildImpulses',
        'SLEEVE DOES NOT SNAP. §7.7 row 15b: check the EVENT COUNT first (S15 asserts exactly one limb-stop per acting limb per move), then the cloth gain'),
       b7('impulseQueue.ts', 'impulseGain', 'each ImpulseEvent must fire exactly ONCE, at exactly e.tick + e.crackDelayTicks')],
  C7: [b5('stage.ts', 'buildStage', 'no dust/contact cue on hard stance transitions')],
  C8: [b1('render.ts', 'LIGHTS.rim.intensity.v',
        'FLAT LIGHTING, no separation. §7.7 row 18. CROSS exists because the karateka reaches six headings and KEY/RIM/FILL alone lose form on three of them', 'render')],
  C9: [b5('shadow.ts', 'refitShadow', 'MUSHY SHADOW CONTACT. S_fit and radius; GTAO at 0.30 m is the second occlusion layer')],
  C10: [b8('gui.ts', 'buildGui', 'camera orbit has no ease or parallax interest — judged through the UI, per OWNERSHIP B8')],
  C11: [b7('garments.ts', 'buildGarments', 'OBI ENDS STATIC. obi_tail_L / obi_tail_R must move independently')],
  C12: [b1('render.ts', 'MATERIAL_PARAMS.M_GI.sheen.v',
        'NO SHEEN VARIATION. Dispute D09 ships 0.45 as a LIVE SLIDER because only Channel D settles it — decided by eye, never by argument (§9.1 A-3)', 'render')],
  C13: [b4('bodyMesh.ts', 'buildBodyGeometry',
        'PERFECT BILATERAL SYMMETRY reads synthetic. A seeded +-1.5 % asymmetry in limb radii plus a 0.6 deg resting pelvis roll, both drawn once from trackHash')],
  C1: [b1('techniques.ts', 'HAND_SHAPE_ANGLES.seiken', 'fingers not curled / thumb not over the index-middle knuckles (doc 03 §12.1)')],
  C2: [b4('bones.ts', 'buildSkeleton', 'toes not gripping the floor — ball_L/R and toe_end_L/R')],
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. `BLAME_MAP` and `blame`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Every routable complaint id. Metric rows come from `metricSpecs.ts` (single source of truth for
 * the 63), fault rows from doc 01 §9 / doc 03 §11.1, rubric rows from doc 07 §6.8. A rubric id that
 * a metric already backs keeps the metric's fix site FIRST and appends the rubric site.
 */
export const BLAME_MAP: Readonly<Record<string, readonly FixSite[]>> = Object.freeze(
  (() => {
    const map: Record<string, FixSite[]> = {};
    for (const m of METRICS) map[m.id] = [m.fixSite];
    for (const [id, sites] of Object.entries(FAULT_SITES)) map[id] = [...sites];
    for (const [id, sites] of Object.entries(RUBRIC_SITES)) {
      map[id] = [...(map[id] ?? []), ...sites];
    }
    // A rubric id that metrics already back inherits their sites, most-specific first.
    for (const m of METRICS) {
      for (const r of m.rubric) {
        const cur = map[r] ?? [];
        if (!cur.some((x) => x.file === m.fixSite.file && x.knob === m.fixSite.knob)) {
          map[r] = [m.fixSite, ...cur];
        }
      }
    }
    for (const k of Object.keys(map)) Object.freeze(map[k]);
    return map;
  })(),
);

/** §3.13's `blame`. Most likely fix site first; empty array for an unknown id. */
export function blame(id: MetricId | string): readonly FixSite[] {
  return BLAME_MAP[id] ?? [];
}

/** Every fault id this map can route — `tests/eval/faults.test.ts` walks it. */
export const FAULT_IDS: readonly string[] = Object.freeze(Object.keys(FAULT_SITES).sort());
/** Every doc 07 §6.8 rubric id with an explicit route. */
export const RUBRIC_IDS: readonly string[] = Object.freeze(Object.keys(RUBRIC_SITES).sort());
/** Every distinct file any route can name, for `tests/eval/fixsites.test.ts`. */
export const ALL_FIX_FILES: readonly string[] = Object.freeze(
  [...new Set(Object.values(BLAME_MAP).flatMap((v) => v.map((f) => f.file)))].sort(),
);

/**
 * Attach routes to a finding that arrived without them (a VLM reports `{tier, id, observation}`;
 * `tools/critic.mjs` fills the rest). Placeholders in a move-patch path are resolved here.
 */
export function routeFinding(f: CriticFinding, kataId: string): CriticFinding {
  if (f.fixSites.length > 0) return f;
  const sites = blame(f.id).map((site) => resolveMoveSite(site, kataId, f.moveN));
  return Object.freeze({ ...f, fixSites: Object.freeze(sites) });
}
