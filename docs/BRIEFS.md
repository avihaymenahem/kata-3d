# PER-BLOCK BRIEFS — handoffs out of the Phase-0 freeze

Orchestrator-owned. **Every block agent must read its own section before writing code**, in addition to
`docs/ARCHITECTURE.md` and `docs/OWNERSHIP.md`. These are the things B0 learned while freezing the
contracts that are not obvious from the plan, plus the signatures the frozen red-first tests pin down.

`tests/contracts/**` is FROZEN. If a signature here is wrong for you, raise a handoff note in your
return value — **never edit a contract test to match your code.**

---

## Signatures the red-first tests pin down (match these exactly)

| block | barrel | required exports |
|---|---|---|
| B1 | `src/data` | `STANCES`, `CHANNEL_DYN` (with `.leadMs.v`, `.tauP.v`), `DYN` (rows keyed with `'zuki'` in the key; fields `TtechS`/`TthrustS` as `Num`), `L_H`, `PELVIS_AHEAD_OF_C_H` keyed by `StanceId`, `getKata` (re-exported from B2) |
| B3 | `src/solve` | `toWorld([x,y,z])`, `toWorldYawDeg(deg)`, `compileKata(kata, {tempoTier, codeVersion})`, `channelAlpha/channelVel/channelAcc(channelId, tau)` |
| B4 | `src/rig` | `buildKarateka(materialSet)` → `{bones, byName, skeleton}`, `sampleLandmarks(rig, tick, out)` |
| B5 | `src/render` | `createMaterials()` |
| B6 | `src/player` | `createSampler(track)`, `applyPose(rig, frame)` |

## Positive requirements armed in `tools/verify-contracts.mjs`

Currently deferred with a `note:`; they become **hard failures** the moment the file lands.

* `src/solve/channels.ts` must reference `kimeEaseAcc` **and** `holdThenSnapVel`
* `src/solve/impulses.ts` must reference `crackDelayTicks`
* `src/render/materials.ts` must reference `FrontSide`

## The `frame.ts` allowlist (global, non-negotiable)

`src/solve/frame.ts` is the **only** file permitted to name `SIDE_SIGN`, to define
`toWorld`/`toWorldYawDeg`, or to assign a negative `rotation.y`. `src/rig/bones.ts` is the one
additional allowlisted **bind-pose flip site**, and it must name `SIDE_SIGN` rather than write a bare
minus (the `X_NEGATION` grep looks for the bare form). All three rules are hard-coded in
`tools/verify-contracts.mjs`. Consequence for B1: keep every doc number **verbatim in the authored
frame** and let the solver apply `-s*dx` (§3.8).

---

## B1 — NUMBERS

* `ZENKUTSU_HEEL_TO_HEEL_H` derives from doc 01's `0.052` **only**. Doc 06's `0.0415` fails the ±5e-4
  gate by 3×. (C15)
* `recoilFracL` and `SETTLE[*].ampFracL` are fractions of the **technique's end-effector path length
  ≈ 0.50 m**, never of `L_M = 0.945 m`. (C17) Getting this wrong makes every recoil ~1.9× too big.
* `DYN` key order must not be load-bearing. `choku-zuki` keeps its **MEASURED** `T_thrust = 0.10`.
* `vPkMs` carries unit `'m/s'`; `SETTLE.omegaN` carries `'rad/s'`. Do not rename either — both names are
  §3.8/§3.9 verbatim, i.e. a DECISION (a reviewer proposed `vPkMps`; declined).
* Author ROM cone semi-axes as the **smaller** of doc 06 §3.1's two signed limits. See the ROM exemption
  in `docs/OWNERSHIP.md` B1 — ROM values stay bare `…Deg`, verified as a block.
* Never author `zeta >= SETTLE_ZETA_MAX = 0.65`.
* Author `CAMERA_PRESET_PARAMS` from `units.ts`'s `M_*_POS_H`, **not** from ARCHITECTURE §5.7's literals
  or doc 07 §6.6's — the L/R pair is swapped between the authored and world frames. (C16)

## B3 — SOLVER

* `toWorldYawDeg` **is the identity on headings** — derivation and test live in `units.ts` /
  `handedness.test.ts`. A **separately named** helper in the same file negates doc 04 §0's ψ-class yaws.
  Do not merge the two.
* `PRIMARY_AXIS` must go through `toWorld` **before** `splitSwingTwist`/`clampSwingTwist`.
* S6 asserts `leads` + `TAUP_MONOTONE_CHAIN` + the min/span form — **not** pointwise `tauP` monotonicity
  (doc 04 §11's own table violates that at 4 of 8 steps).
* A **named hip/shoulder sign gate** is owed in `src/solve/swingTwist.ts`: `RomLimit`'s cone cannot hold
  doc 06 §3.1's asymmetric limits, and they must not be smuggled into `RomLimit`.
* `eventsBelow20msExact` is the structural **integer-tick** check — not `survivesQuantisation` in a loop.

## B4 — RIG

* `src/rig/bones.ts` is an allowlisted bind-pose flip site and must **name `SIDE_SIGN`**, not write a
  bare minus.
* `sampleLandmarks` **must stamp `out.tick`** (now assignable, no cast needed).
  `tests/rig` must assert `sampleLandmarks(rig, 12345, out)` → `out.tick === 12345`.

## B5 — RENDER

* `src/render/materials.ts` must reference `FrontSide`; `DoubleSide` is grep-banned project-wide. The
  gi's inner surface is a real **0.63 mm inner shell**, not a backface trick.
* `StillAccumulator` replaces `TAARenderPass`/`SSAARenderPass` entirely — **we** own the camera
  view-offset jitter, because `SSAARenderPass.js:262` and `TAARenderPass.js:166` clear it before
  returning, leaving `GTAOPass.js:642` to compute AO unjittered.

## B8 — UI

* Clamp the settle-`zeta` slider to `[0.05, SETTLE_ZETA_MAX = 0.65]`. The `zeta >= 1` branch is now
  continuous and bounded rather than a 61× jump, but it is a **guard, not a modelled regime**.

## B9 — CRITIC

* **Metric 1 carries a known systematic bias.** It measures ≈`0.5345` (the rig's heel landmark uses doc
  06's `0.0415`) against a `0.533` reference (doc 01's `0.052`): **−0.0014 H / −0.26 %**, well inside doc
  07's ±0.05 tolerance but not zero. **It must not be "corrected" by moving either number.**
* Add an assertion that at *yoi* under `M_LEFT`, the projected `eye_L` is **nearer the camera** than
  `eye_R` — an independent mirror detector that does not depend on Channel C.
* `tools/verify-contracts.mjs` is **now B9's file** (17 bans, 18 conflict ids), handed over at the
  Phase-0 gate. Feed `Scorecard.contractHash` / `RunInfo.contractHash` from its `contractHash()`.

---

## Project-wide hard constraints (all blocks, every phase)

1. **No new npm dependencies.** Frozen: `three@0.185.1`, `lil-gui`, `vite`, `typescript`, `vitest`,
   `playwright`. Need something else → report it, do not install it.
2. **No downloading anything, ever** — no images, plates, mocap, HDRs, fonts, textures. Everything is
   generated procedurally in code. In particular **do not fetch the PD-1925 Funakoshi plates or any
   Wikimedia asset**; Channel C / gate **G-5 ships DISARMED** with an empty reference bank, pending a
   separate decision by the project owner.
3. **No network at runtime.**
4. Touch only files your block owns. `package.json`, `tsconfig.json`, `vite.config.ts`,
   `vitest.config.ts`, `.gitignore`, `docs/**` are ORCHESTRATOR-owned and already written.
5. TS strict, ESM, no `.ts` in import specifiers. `noUnusedLocals`/`noUnusedParameters` are ON.
6. Verify by **running** (`npx tsc --noEmit`, `npx vitest run <paths>`). Never report a gate you did not
   personally observe.
