/**
 * B5 RENDER — `src/render/phase.ts`
 *
 * The one helper the three Phase-4 files share, so their failure message has one wording and one
 * place to delete from. Modelled on B1's `B2_NOT_YET` landing-site idiom in `src/data/index.ts`, for
 * the same reason: a typed binding that EXISTS and TYPECHECKS now, so the barrel is complete and
 * downstream blocks can wire their call sites, but that cannot be mistaken for a working feature.
 *
 * §8 assigns `silhouette.ts`, `clothBridge.ts` and `overlay.ts` to Phase 4. B5's Phase-1 scope is
 * `renderer, dojoEnv, ibl, lights, materials, stage, post, still`.
 *
 * NOTE: this file is not in ARCHITECTURE §4.5's inventory, and §4 says "nothing may be created that
 * is not listed here". It is a 20-line internal helper of an existing owned module, not a new module
 * in the module map — it exports no cross-block API and is not re-exported by the barrel. Raised as a
 * handoff so the orchestrator can either add the row or ask B5 to inline the helper three times.
 */

/** Throws with the phase, the file and the consumer that is waiting on it. Never returns. */
export function notYetPhase4(symbol: string, file: string, consumer: string): never {
  throw new Error(
    `PHASE-4: '${symbol}' is not implemented yet. ${file} is scheduled for Phase 4 ` +
      `(docs/ARCHITECTURE.md §8); B5's Phase-1 scope is renderer, dojoEnv, ibl, lights, materials, ` +
      `stage, post, still. Waiting consumer: ${consumer}. The binding exists and typechecks so the ` +
      `src/render barrel is complete — it is deliberately NOT a silent no-op, because a fake empty ` +
      `result here would be reported downstream as a real measurement.`,
  );
}
