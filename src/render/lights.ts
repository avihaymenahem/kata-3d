/**
 * B5 RENDER — `src/render/lights.ts`
 *
 * `buildLights`: KEY / RIM / FILL / CROSS. ARCHITECTURE.md §5.4, doc 05 §5. All four intensities are
 * B1's, in `LIGHTS`; B5 authors no number.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE THING THAT MATTERS MOST IN THIS FILE: RIM SEPARATION
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * The subject is a `0xF2F0EA` gi standing on a `0xC0A279` pale sprung floor lit by a warm key. In
 * value terms the gi and the lit floor are NEIGHBOURS — and since the floor went from a dark
 * red-brown to dojo timber they are CLOSER neighbours than they were, not further apart. At `LOW34`
 * and `M_TOP` — both in the default shot list (§7.3) — value separation is all the viewer has. RIM
 * at `1.15` (0.47x key, `0xDFE9FF` ~7000 K) from `(-2.10, 5.40, -3.85)` is what puts a cool edge
 * along the shoulders and the crown so the silhouette detaches from the floor. It is the single
 * highest-leverage light in the rig, and Channel-D rubric item C8 ("flat lighting, no separation")
 * routes to its intensity (§7.7).
 *
 * RIM used to sit at `y = 2.80`, an elevation of 23.7 deg to `LIGHT_AIM_M`. That is BELOW the angle
 * at which the ORBIT frame's bottom edge grazes the floor (~40 deg), and a directional light's
 * mirror image in a flat plane is an unbounded sheet — so the sheet landed across the far boards,
 * in frame, at every azimuth in front of the figure. It was the loudest thing in the render. The
 * arithmetic, the measurement and the reason a `roughnessMap` cannot reach it are all written out
 * in `src/data/constants/render.ts` above `LIGHTS`; the short version is that RIM's elevation, not
 * its intensity and not the floor's roughness, was the lever, and lifting it to 45.9 deg dropped
 * worst-case floor specular from 2.494 to 0.332 with the separation edge intact.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THERE ARE FOUR, AND WHY NONE OF THEM MOVES
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * The karateka reaches six distinct headings across the embusen (H = 0, 45, 90, 180, 270, 315). With
 * only KEY/RIM/FILL, the headings whose chest normal points away from all three lose FORM on the
 * front plane and read as a flat silhouette. CROSS `[ART]` answers that: world-fixed, low, on the
 * opposite azimuth from KEY, and capped at `0.32` (0.13x key) so it can never fight the key or read
 * as a second source. It casts no shadow.
 *
 * All four now sit between 28 and 46 degrees of elevation, measured to `LIGHT_AIM_M`. That band is
 * not a style choice: below it a directional's mirror sheet is inside the frame (see the RIM note
 * above), and above it the rig stops modelling and starts flattening the figure from overhead. FILL
 * and CROSS came up from 10.6 and 9.2 degrees for the first reason; they are still the two lowest
 * lamps and still read as bounce rather than as sources.
 *
 * The rejected alternative was a camera-following practical. A moving directional makes the shading
 * terminator and the gi's sheen lobe SWIM during orbit — visible during exactly the 360 degree
 * interaction this product sells. So: **nothing here ever follows the camera, and nothing here moves
 * per frame.** `refitShadow` (`shadow.ts`) re-aims the shadow BOX every frame using asymmetric ortho
 * bounds precisely so the LIGHT can stay nailed down.
 *
 * ── NO AmbientLight, EVER ─────────────────────────────────────────────────────────────────────
 * §5.4 omits it entirely; the ambient wrap is `scene.environment` at `environmentIntensity 0.85`
 * (`ibl.ts`). An `AmbientLight` adds a flat, direction-free term that raises the floor of every
 * shadow and destroys exactly the value separation the rim exists to create.
 * `assertNoAmbientLight` is a tripwire, not decoration: it is the cheapest possible defence against
 * a future "the shadows look too dark" fix landing in the wrong place.
 *
 * ── r155+ INTENSITY SEMANTICS ─────────────────────────────────────────────────────────────────
 * doc 05 §4.4: `useLegacyLights` and `physicallyCorrectLights` do not exist in this build (0 grep
 * hits under `three/src`), directional irradiance is NOT internally scaled by PI
 * (`lights_pars_begin.glsl.js:48-50`), and therefore every pre-r155 tutorial intensity is PI times
 * too small (§14.1 #26). `LIGHTS` is authored post-r155; do not "fix" `3.0` down to `1.0`.
 *
 * ── `light.target` MUST BE IN THE SCENE ───────────────────────────────────────────────────────
 * doc 05 §14.1 #25, `DirectionalLight.js:70`: the target is an `Object3D` whose `matrixWorld` must be
 * updated for the direction to take effect. All four targets are added, not just KEY's, so no light's
 * direction depends on an un-updated matrix staying accidentally at the identity.
 */

import { AmbientLight, Color, DirectionalLight, HemisphereLight, type Scene } from 'three';

import { ENV, LIGHTS, LIGHT_TARGET_M } from '../data';
import { configureShadow } from './shadow';

/**
 * §3.4.1, VERBATIM. Declared in B5's barrel, per §3.4.1's own instruction.
 *
 * Four named slots, not an array: §7.7 routes rubric C8 to `LIGHTS.rim.intensity.v` and
 * `LIGHTS.cross.intensity.v` by NAME, so the rig has to be addressable by name too or the routing
 * table is a lie.
 */
export interface LightRig {
  readonly key: DirectionalLight;
  readonly rim: DirectionalLight;
  readonly fill: DirectionalLight;
  readonly cross: DirectionalLight;
}

/**
 * All four lights aim at this point: hip height, `0.50 H = 0.875 m` (doc 05 §5's `light.target`
 * row). For a directional light the target only sets a DIRECTION, so aiming the whole rig at the
 * figure's centre of mass — rather than at the floor origin — is what keeps the terminator on the
 * body instead of grazing the boards. Consequence worth knowing: KEY's elevation measured to this
 * point is `atan((4.20 - 0.875) / 4.084) = 39.2 deg`, not the `45.8 deg` doc 05 §5 derives to the
 * origin. Both numbers are correct; they measure different angles.
 */
export const LIGHT_AIM_M: readonly [number, number, number] = LIGHT_TARGET_M;

/** §3.13. Adds all four lights and all four targets to `s`, and configures KEY's shadow. */
export function buildLights(s: Scene): LightRig {
  const make = (spec: (typeof LIGHTS)['key'], name: string): DirectionalLight => {
    const l = new DirectionalLight(new Color(spec.colorHex), spec.intensity.v);
    l.name = name;
    l.position.set(spec.posM[0], spec.posM[1], spec.posM[2]);
    l.castShadow = spec.castShadow;
    l.target.name = `${name}.target`;
    l.target.position.set(LIGHT_AIM_M[0], LIGHT_AIM_M[1], LIGHT_AIM_M[2]);
    // doc 05 §14.1 #25 — without this the direction silently ignores `target.position`.
    s.add(l.target);
    s.add(l);
    return l;
  };

  const key = make(LIGHTS.key, 'KEY'); // 2.45, 0xFFF4E8 ~5200 K, 45.0° — CASTS SHADOW
  const rim = make(LIGHTS.rim, 'RIM'); // 1.15, 0xDFE9FF ~7000 K, 45.9° — the separation light
  const fill = make(LIGHTS.fill, 'FILL'); // 0.44, white, 34.0°
  const cross = make(LIGHTS.cross, 'CROSS'); // 0.32, 0xF6F2EE, 28.0° — [ART], off-axis headings

  configureShadow(key);
  assertNoAmbientLight(s);

  return { key, rim, fill, cross };
}

/**
 * §5.4: `AmbientLight` is omitted entirely. `HemisphereLight` is the same mistake wearing a hat — a
 * direction-free wrap that competes with `scene.environment`'s IBL for the same job and wins,
 * because it is cheaper to add than to notice.
 *
 * Throws with the routing already written out, so the next agent fixes the cause rather than the
 * symptom.
 */
export function assertNoAmbientLight(s: Scene): void {
  const found: string[] = [];
  s.traverse((o) => {
    if (o instanceof AmbientLight) found.push(o.name || 'AmbientLight');
    else if (o instanceof HemisphereLight) found.push(o.name || 'HemisphereLight');
  });
  if (found.length > 0) {
    throw new Error(
      `render/lights.ts: §5.4 omits ambient lighting entirely, but the scene contains ` +
        `[${found.join(', ')}]. The ambient wrap is scene.environment at environmentIntensity ` +
        `${ENV.environmentIntensity.v} (src/render/ibl.ts). ` +
        `A flat ambient term raises the floor of every shadow and destroys the value separation ` +
        `RIM exists to create — Channel-D rubric C8. If the core reads too dark, the fix is a ` +
        `handoff to B1 for LIGHTS.fill.intensity or ENV.environmentIntensity, never a new light.`,
    );
  }
}

/** Removes and disposes the rig. `DirectionalLight.dispose()` forwards to `shadow.dispose()`. */
export function disposeLights(s: Scene, rig: LightRig): void {
  for (const l of [rig.key, rig.rim, rig.fill, rig.cross]) {
    s.remove(l.target);
    s.remove(l);
    l.dispose();
  }
}
