/**
 * B0 CONTRACTS — `src/contracts/index.ts`
 *
 * THE BARREL. ARCHITECTURE.md §4.0.
 *
 * Cross-block imports go ONLY through a block's `index.ts` barrel; deep imports across blocks
 * fail the build (§3 import discipline, OWNERSHIP rule 3, `tests/contracts/imports.test.ts`).
 * So every other block imports from `'../contracts'` and never from `'../contracts/bones'`.
 *
 * After Phase 0 this block is CLOSED. A change requires an `[integrator]` commit plus a
 * `docs/CONTRACT-CHANGELOG.md` entry, and every agent stops until it lands (OWNERSHIP B0).
 */

export * from './units';
export * from './time';
export * from './ease';
export * from './num';
export * from './bones';
export * from './kata';
export * from './pose';
export * from './rig';
export * from './scorecard';
export * from './services';
