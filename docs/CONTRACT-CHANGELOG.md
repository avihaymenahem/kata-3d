# CONTRACT CHANGELOG

Every change to `src/contracts/**` gets an entry here. Orchestrator-owned; blocks raise a handoff note
instead of editing. Reproduce hashes at any time with `node tools/verify-contracts.mjs --print-hashes`.

---

## 2026-07-31 — Phase 0 FREEZE (initial) + adversarial-audit repair

**`contractHash` `d68c014d069afb98` → `36a86277afa0d663`** · 8 of 11 files changed by the repair pass.

Written by B0 (`agent/contracts`), then audited by three adversarial reviewers (completeness,
numerics, buildability) — 30 findings, 5 BLOCKER, all three verdicts `NEEDS_REPAIR` — then repaired.
Five findings were **refuted with arithmetic** rather than applied; see the repair record.

### Per-file sha256 at freeze

| file | sha256 |
|---|---|
| `src/contracts/units.ts` | `06a1be575ecd42f28155937ddf2dfa0bcb08463466bc9d039f894acc3f6e0ac6` |
| `src/contracts/time.ts` | `6819e6e037f96315c77252c1c50c52d1e44e6c095a76e4bee196ab95b47359ba` |
| `src/contracts/ease.ts` | `fd4694a7f01a3c1551a57606a37fa993240efe28e527ba429aeb056893636f4a` |
| `src/contracts/num.ts` | `32a6d6b2e71b6a7f6ab74efae4b133ca9c705506df6f2db0bc2698a7204e17d8` |
| `src/contracts/bones.ts` | `541195b834a82d74f702d723dc62815775a497e53c4aad7da1a3de09a7e3b606` |
| `src/contracts/kata.ts` | `6c6fa359cde62c74c548c51e73db7e02a8082b5341ed9bab14f8417332900379` |
| `src/contracts/pose.ts` | `22f71aec588bc6692edff4620fbcb01f7fbcb8ad2dcde306c7a607a67e4ba3f5` |
| `src/contracts/rig.ts` | `c9536b565e54000026c839c2da9840a6092593dfa7d3eaf617bfe513fb67c901` |
| `src/contracts/scorecard.ts` | `693d61599a945adf8238bdb9e0daa6cc327ea6338e24debcb388a58e4054851b` |
| `src/contracts/services.ts` | `a5854f1d57f05279d77b7e094dfc4427dcc60ce9dfbf51750af521c4af965567` |
| `src/contracts/index.ts` | `3bda2f92d2b85337a62ee2af33b7b248c0fc3fdd70fb2e836e63fba5bca7c42d` |

### Gate observed at freeze

`npx tsc --noEmit` exit 0 · `node tools/verify-contracts.mjs` OK (17 banned constructs, 4 positive
requirements deferred, 1 forbidden file, 18 §2.5 resolutions) · `npx vitest run tests/contracts`
**91 passed / 16 failed**, every failure a RED-FIRST message naming a missing downstream symbol
(`src/solve`, `src/data`, `src/render`); `imports` and `freeze` pass.

### Owner handoff at this gate

`tools/verify-contracts.mjs` transfers **B0 → B9**. It is the one file that changes owner. It exports
`CONTRACT_FILES`, `FREEZE`, `CONTRACT_HASH_AT_FREEZE`, `hashFile`, `contractHash`, `normalise`,
`stripComments`, `runChecks()` so `tools/verify-all.mjs` aggregates it without re-implementing anything.
`Scorecard.contractHash` and `RunInfo.contractHash` are fed from `contractHash()`.

### Deliberate deviations from ARCHITECTURE §3, accepted

1. `TEMPO_SCALE` lives in `time.ts`, not `kata.ts` (`export *` cannot carry the name twice). `kata.ts`
   declares `TempoTier` plus a compile-time proof `Equals<TempoTier, keyof typeof TEMPO_SCALE>`.
2. `ease.ts` adds `holdThenSnapVel` — §6.3 and §9.1 A-2 both require `holdThenSnap'` to be analytic, and
   B3 is forbidden from defining easing functions.
3. `rig.ts` carries a **type-only** `import type {...} from 'three'` for the five classes §3.10 declares
   `RigHandles` in terms of. Fully erased, no module edge, Node path unaffected.
   `tests/contracts/imports.test.ts` encodes the exception by name and fails any *value* import of three
   under `src/contracts`.
4. `CAPSULES` ships **16**, not 15 (doc 06 §7.6's table and §7.5's cost math both use 16).
5. `MANDATORY_REF_OVERRIDES` ships **9** rows, not "eight" (§2.6's table lists 9).
6. All **14** §2.5 conflicts shipped as named constants, not the 8 §8 asks for. A superset closes every
   re-litigation path.

### Plan corrections this audit forced (applied to `docs/ARCHITECTURE.md` / `docs/OWNERSHIP.md`)

| # | correction |
|---|---|
| 1 | §2.1 assertion 3: `σ`-image pairing **move 21 ↔ 12 → move 3 ↔ 12**. The old pairing is arithmetically impossible: `σ(c12) = (+0.310, 0.000)`, which is `c1`/`c3`/`c18`/`c20`, **0.854 L from `c21`**. Moves 18–21 lie outside the `σ` orbit. The `c21` literal was always correct; only the pairing was wrong. |
| 2 | §5.7 camera table: `M_LEFT`/`M_RIGHT` x-coordinates **swapped** to the WORLD frame the field declares — `M_LEFT = (−3H, 0.5H, 0)`, `M_RIGHT = (+3H, 0.5H, 0)`. Doc 07 §6.6 writes them in the authored left-handed frame. (C16) |
| 3 | §2.3: `EMB_H` is the **yoi/hachiji stance width only** — it is *not* doc 02's embusen `h`, which stays at the authored `0.19 L`. (C18) |
| 4 | §4.11 S6: assert `TAUP_MONOTONE_CHAIN` + the min/span form, **not** pointwise `tauP` monotonicity — doc 04 §11's own table violates that at 4 of 8 steps. |
| 5 | §2.5 row 14 bone count `45` → **52** (44 headline → 45 with `ribcage` → 52 fully expanded). §2.8/§3.4 govern. |
| 6 | §2.6 "eight mandatory overrides" → **nine**. §3.10 "15 capsules" → **16**. |
| 7 | §8 Phase-1 gate: `handedness` is green **per-test** (assertion 1 + preconditions) at P1; assertions 2–3 need B2/B3/B6 and are a **Phase-2** gate item. The alternative reading would force a cross-block test to be made vacuous. |
| 8 | OWNERSHIP B1 deps: `SIDE_SIGN` → **`sideSign(h)`** (the bare symbol is banned outside 3 allowlisted files). |
| 9 | OWNERSHIP B1 DoD: **ROM exemption** — `RomLimit`'s ~208 values stay bare `…Deg` fields (the frozen shape wins); verified as a block against doc 06 §3.1, with per-group `src` comments. |
| 10 | OWNERSHIP B0 verification: "green" is **per-assertion**; `bones` and `ease` each keep exactly one deliberate red cross-block assertion. |
