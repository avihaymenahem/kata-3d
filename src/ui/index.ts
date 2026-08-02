/**
 * B8 UI — `src/ui/index.ts`
 *
 * THE BARREL. Cross-block imports go ONLY through here (OWNERSHIP rule 3,
 * `tests/contracts/imports.test.ts`), and `src/main.ts` reaches this block through it.
 *
 * Nothing here touches three. The HUD is plain DOM over the canvas, mounted into the `#hud-root`
 * that `index.html` reserves — which is what keeps it out of the render loop entirely.
 */

export { createHud, type Hud, type HudBeat, type HudHost } from './hud';
