/**
 * B5 RENDER — `src/render/materials.ts`
 *
 * `createMaterials`: the ten materials of ARCHITECTURE.md §5.6. ONE factory, so a future WebGPU port
 * touches one file (doc 05 §2.3).
 *
 * ── THE HARD RULES, ALL GREP-ENFORCED ─────────────────────────────────────────────────────────
 *
 * * **`side: FrontSide`, everywhere.** §5.5 deletes all three proposals' "DoubleSide + backface
 *   albedo x0.72" gi trick, because no backface-colour property exists anywhere in
 *   `three/src/materials/` and `onBeforeCompile` is banned, so the claim is unimplementable. It is
 *   replaced by REAL GEOMETRY: `src/cloth/giShell.ts` extrudes a 0.63 mm inner shell (the measured
 *   12 oz duck thickness, doc 06 §7.1) with inverted winding, welded at the free edges. The interior
 *   then darkens for real, via GTAO + the shadow term + the inverted normals. `DoubleSide` does not
 *   appear anywhere in this project; `tools/verify-contracts.mjs` and `tests/render/bans.test.ts`
 *   both grep for it, and `verify-contracts` additionally REQUIRES the token `FrontSide` in this
 *   exact file (docs/BRIEFS.md, "Positive requirements").
 *
 * * **Zero `onBeforeCompile`, zero `ShaderMaterial` in the scene graph** (§5.6, doc 05 §14.1 #24).
 *   `GTAOPass` renders its own normal G-buffer with `MeshNormalMaterial` (`GTAOPass.js:161, :505`);
 *   `MeshNormalMaterial` honours `USE_SKINNING`, so a skinned figure's AO normals are correct — but a
 *   `ShaderMaterial` would render garbage normals and poison the AO for the whole frame.
 *
 * * **Every `material.envMap` stays `null`.** doc 05 §14.1 #11, `WebGLRenderer.js:2344`: setting it
 *   silently overrides `scene.environment` AND disables `scene.environmentIntensity` for that
 *   material. `ibl.ts` owns the one global environment knob. This file never names `envMap`.
 *
 * * **`transmission = 0` and `clearcoat = 0` everywhere** (§5.6, doc 05 §14.1 #13). Any
 *   `transmission > 0` forces an entire extra scene render per frame
 *   (`WebGLRenderer.js:1983-2048`), and nothing in a dojo is refractive.
 *
 * * **Colour space per map slot.** Albedo / emissive / sheenColor are `SRGBColorSpace`; normal,
 *   roughness, metalness, AO, displacement and thickness are `NoColorSpace`. doc 05 §12 calls
 *   getting this wrong "the #1 silent PBR bug". Because the maps themselves are authored elsewhere
 *   (B4's `src/rig/textures.ts` for the figure, `stage.ts` for the floor and backdrop), the POLICY
 *   lives here as `TEXTURE_COLOR_SPACE` and every attachment goes through `assignMap`, which sets
 *   the colour space from the table rather than trusting the caller.
 *
 * ── WHY `createMaterials()` ATTACHES NO TEXTURES ───────────────────────────────────────────────
 * §3.13 freezes the signature as `createMaterials(): MaterialSet` — no arguments — and B4 builds the
 * figure's `CanvasTexture`s. So this factory sets every SCALAR and COLOUR and leaves every map
 * `null`. Two consequences, both deliberate:
 *   1. it is `[GL-free]` and `[DOM-free]`, so `tests/render/config.test.ts` constructs all ten
 *      materials in Node and checks every `MATERIAL_PARAMS` field against the property it landed on;
 *   2. maps are attached later, at exactly one choke point (`assignMap`), which is the only place
 *      colour space can be got wrong.
 *
 * ── `sheen` AND WHEN TO TUNE IT ───────────────────────────────────────────────────────────────
 * doc 05 §14.1 #14: `sheen` is nearly invisible without `scene.environment` — the indirect term is
 * `irradiance * sheenColor * IBLSheenBRDF(...)` (`lights_physical_pars_fragment.glsl.js:589`). Tune
 * it AFTER `ibl.ts` has run, never before. The value ships at `0.45` as dispute `D09` with a live
 * slider (§2.5 conflict C05): doc 05 §11.1 asserts 1.0 undefended, doc 06 §7.9 argues 0.35 from
 * Filament cloth data, and only Channel D settles it.
 *
 * ── `anisotropy` AND THE TANGENT ──────────────────────────────────────────────────────────────
 * §2.5 conflict C06 ships `anisotropy 0.18` because doc 05's only objection was "needs a tangent
 * attribute" — and we generate the geometry, so B4 generates an itemSize-4 analytic tangent with a
 * real handedness `w` (§2.7). `anisotropyRotation` stays `0` because that tangent IS the warp
 * direction. Verified safe if a tangent is ever missing: `normal_fragment_begin.glsl.js:22-30` falls
 * back to `getTangentFrame(...)` under `USE_ANISOTROPY` without `USE_TANGENT`, so the shader still
 * compiles — it just loses warp alignment.
 */

import {
  Color,
  FrontSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';

import { MATERIAL_COLOR_HEX, MATERIAL_PARAMS } from '../data';

/**
 * §3.4.1, VERBATIM. Declared here rather than in `src/contracts/**` because §3.4.1 says so
 * explicitly: "These are declared in the barrel of the block that owns them, but they appear in
 * cross-block signatures, so their shape is frozen here." B4's `buildKarateka(mats: MaterialSet)`
 * and B6's `bootApp` both consume it through the `src/render` barrel.
 *
 * The value type is `Material`, not a union of concrete classes, and that is deliberate: a consumer
 * that needs `MeshStandardMaterial` narrows at the assignment site, so swapping a material's class
 * during look-dev is not a cross-block breaking change.
 */
export type MaterialSet = Readonly<
  Record<
    | 'M_GI'
    | 'M_SKIN'
    | 'M_OBI'
    | 'M_FLOOR'
    | 'M_BACKDROP'
    | 'M_HAIR'
    | 'M_EYE'
    | 'M_EMBUSEN'
    | 'M_MASK'
    | 'M_DEBUG',
    Material
  >
>;

export type MaterialId = keyof MaterialSet;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * B5-LOCAL LOOK DEFAULTS
 *
 * `MATERIAL_COLOR_HEX` (B1) carries a colour for every material whose colour is load-bearing. Four
 * materials have none, because §5.6 describes their colour as coming from a map or from debug art
 * direction. They are grouped here, named, and flagged: if any of them ever needs to be tuned by a
 * critic finding, the fix is a HANDOFF to B1 to add the row — B5 never edits a constant file
 * (OWNERSHIP B5, "Every judgement is written back to render.ts BY HANDOFF TO B1").
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export const B5_LOCAL_COLOR_HEX = Object.freeze({
  /**
   * Skin base. §5.6's `M_SKIN` row says "per-character albedo" and B4's `makeHeadAlbedo` supplies
   * the map; this is the value the map multiplies, and the value that ships until it exists.
   * Deliberately a mid warm tone, not a light one: doc 07 §4's anti-heroic gate is about
   * proportions, but a too-pale skin against a `0xF2F0EA` gi destroys the value separation that
   * makes the silhouette read at `LOW34` and `M_TOP`.
   */
  skin: 0xb98a6a,
  /** Eye base. White, because the sclera/iris/pupil `CanvasTexture` carries all of the colour. */
  eye: 0xffffff,
  /**
   * Embusen decal ink. Cool GREY so it never reads as part of the warm wood floor.
   *
   * It shipped at `0x8FB4D0`, which is a saturated sky blue, and against a warm room it reads as a
   * HUD overlay drawn on top of the render rather than as tape laid on the boards — the marking is
   * a teaching aid, not a heads-up display, and the difference is entirely in the saturation. This
   * is the same hue at a third of the chroma: still unmistakably not-wood at a glance, still fully
   * legible at `M_TOP`, and now sitting IN the scene. `M_EMBUSEN` is `toneMapped: false`, so what
   * is authored here is what lands on the floor.
   */
  embusen: 0xa9bcc6,
  /** Debug lines: skeleton, reference stick, COM, support polygon. `toneMapped: false`. */
  debug: 0x0a84ff,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Colour-space policy — doc 05 §12
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Every map slot this project ever assigns. `envMap` is absent BY CONSTRUCTION (see the header). */
export type MapSlot =
  | 'map'
  | 'emissiveMap'
  | 'sheenColorMap'
  | 'specularColorMap'
  | 'normalMap'
  | 'bumpMap'
  | 'roughnessMap'
  | 'metalnessMap'
  | 'sheenRoughnessMap'
  | 'aoMap'
  | 'alphaMap'
  | 'displacementMap'
  | 'anisotropyMap';

/**
 * The one table. `SRGBColorSpace` for colour data, `NoColorSpace` for everything else. doc 05 §12:
 * "setting sRGB here is the #1 silent PBR bug".
 */
export const TEXTURE_COLOR_SPACE: Readonly<Record<MapSlot, string>> = Object.freeze({
  map: SRGBColorSpace,
  emissiveMap: SRGBColorSpace,
  sheenColorMap: SRGBColorSpace,
  specularColorMap: SRGBColorSpace,
  normalMap: NoColorSpace,
  bumpMap: NoColorSpace,
  roughnessMap: NoColorSpace,
  metalnessMap: NoColorSpace,
  sheenRoughnessMap: NoColorSpace,
  aoMap: NoColorSpace,
  alphaMap: NoColorSpace,
  displacementMap: NoColorSpace,
  anisotropyMap: NoColorSpace,
});

/**
 * THE ONLY legal way to attach a texture to a material in this project. Sets the colour space from
 * `TEXTURE_COLOR_SPACE` — it does not trust the caller — and refuses `envMap` outright.
 *
 * `[GL-free]`: pure property assignment, so `tests/render/config.test.ts` proves the policy in Node.
 */
export function assignMap(material: Material, slot: MapSlot, texture: Texture | null): void {
  if ((slot as string) === 'envMap') {
    throw new Error(
      'render/materials.ts: envMap is forbidden (§5.6, doc 05 §14.1 #11). Assigning it silently ' +
        'overrides scene.environment and disables scene.environmentIntensity for this material. ' +
        'Use scene.environment (src/render/ibl.ts) — there is exactly one environment knob.',
    );
  }
  const expected = TEXTURE_COLOR_SPACE[slot];
  if (expected === undefined) {
    throw new Error(`render/materials.ts: unknown map slot '${String(slot)}'.`);
  }
  if (texture !== null) texture.colorSpace = expected;
  (material as unknown as Record<string, Texture | null>)[slot] = texture;
  material.needsUpdate = true;
}

/**
 * §5.6: all materials `toneMapped = true` except the three that draw measurement or UI pixels.
 * `M_MASK` in particular MUST stay untone-mapped or metric 60's silhouette IoU reads a tone curve
 * instead of a mask.
 */
export const MATERIAL_TONE_MAPPED: Readonly<Record<MaterialId, boolean>> = Object.freeze({
  M_GI: true,
  M_SKIN: true,
  M_OBI: true,
  M_FLOOR: true,
  M_BACKDROP: true,
  M_HAIR: true,
  M_EYE: true,
  M_EMBUSEN: false,
  M_MASK: false,
  M_DEBUG: false,
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The factory
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const P = MATERIAL_PARAMS;
const C = MATERIAL_COLOR_HEX;

/**
 * §3.13. Ten materials, 12 opaque draw calls (§5.6: body 1 + gi 4 + eyes 2 + hair 1 + floor 1 +
 * backdrop 1 + embusen decal 1).
 *
 * `[GL-free]` and `[DOM-free]` — see the header.
 */
export function createMaterials(): MaterialSet {
  /* ── M_GI — the cotton gi. `MeshPhysicalMaterial` purely for `sheen`. ────────────────────── */
  const M_GI = new MeshPhysicalMaterial({
    name: 'M_GI',
    color: new Color(C.M_GI!.color!), // 0xF2F0EA — never pure white; it clips under AgX
    roughness: P.M_GI!.roughness!.v, // 0.78
    metalness: P.M_GI!.metalness!.v, // 0
    sheen: P.M_GI!.sheen!.v, // 0.45, dispute D09, live slider
    sheenColor: new Color(C.M_GI!.sheenColor!), // 0xE8E4DA
    sheenRoughness: P.M_GI!.sheenRoughness!.v, // 0.55 — 1.0 is too diffuse for canvas
    specularIntensity: P.M_GI!.specularIntensity!.v, // 0.35 — canvas is not glossy
    ior: P.M_GI!.ior!.v, // 1.45
    anisotropy: P.M_GI!.anisotropy!.v, // 0.18, warp-aligned via B4's itemSize-4 tangent
    anisotropyRotation: 0, // the tangent IS the warp direction (§2.7)
    side: FrontSide, // §5.5 — the interior is a real 0.63 mm inner shell
    toneMapped: MATERIAL_TONE_MAPPED.M_GI,
  });
  M_GI.normalScale.set(P.M_GI!.weaveNormalScale!.v, P.M_GI!.weaveNormalScale!.v); // (0.60, 0.60)
  M_GI.clearcoat = P.M_GI!.clearcoat!.v; // 0
  M_GI.transmission = P.M_GI!.transmission!.v; // 0 — never non-zero: +1 full scene render/frame

  /**
   * ═══ THE GI DOES NOT MIRROR THE WINDOWS ══════════════════════════════════════════════════════
   *
   * `envMapIntensity` defaults to 1, so every material reflects `scene.environment` at full
   * strength. For the floor that is correct and wanted — `dojoEnv.ts`'s window quads are area
   * sources and reflect as bounded window SHAPES, which is what sells a lacquered sprung floor.
   *
   * On the gi it is the "sun glimpse" a viewer reported: white cotton was picking up the shoji
   * band, which `dojoEnv` captures at 6.0x, and returning it as a bright moving patch across the
   * chest and shoulders. Roughness spreads that patch; it does not remove it, because a rough
   * surface still integrates the same incoming radiance. The energy has to come down.
   *
   * 0.30 keeps the ambient term that stops the uniform going flat and dead in shadow, while
   * dropping the specular window image below where the eye reads it as a reflection. Heavy cotton
   * canvas genuinely is close to a Lambertian absorber — it has no business mirroring anything.
   *
   * Set HERE and not in `render.ts` because it is a per-material renderer property, not one of
   * §5.6's authored PBR scalars, and B5 owns the material objects.
   */
  M_GI.envMapIntensity = 0.3;

  /* ── M_SKIN — no SSS. `SubsurfaceScatteringShader` is Phong-based AND a ShaderMaterial. ──── */
  const M_SKIN = new MeshPhysicalMaterial({
    name: 'M_SKIN',
    color: new Color(B5_LOCAL_COLOR_HEX.skin),
    roughness: P.M_SKIN!.roughness!.v, // 0.48
    metalness: P.M_SKIN!.metalness!.v, // 0
    sheen: P.M_SKIN!.sheen!.v, // 0.15 — peach fuzz, NOT the cotton value
    sheenRoughness: P.M_SKIN!.sheenRoughness!.v, // 0.85
    ior: P.M_SKIN!.ior!.v, // 1.40
    specularIntensity: P.M_SKIN!.specularIntensity!.v, // 0.6
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_SKIN,
  });
  M_SKIN.normalScale.set(P.M_SKIN!.normalScale!.v, P.M_SKIN!.normalScale!.v); // (0.7, 0.7)
  M_SKIN.clearcoat = P.M_SKIN!.clearcoat!.v;
  M_SKIN.transmission = P.M_SKIN!.transmission!.v;

  /* ── M_OBI — a SILHOUETTE DEVICE, not decoration. See §5.6. ─────────────────────────────── */
  const M_OBI = new MeshPhysicalMaterial({
    name: 'M_OBI',
    color: new Color(C.M_OBI!.color!), // 0x14110F
    roughness: P.M_OBI!.roughness!.v, // 0.62
    metalness: P.M_OBI!.metalness!.v, // 0
    sheen: P.M_OBI!.sheen!.v, // 0.25
    sheenRoughness: P.M_OBI!.sheenRoughness!.v, // 0.55
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_OBI,
  });
  M_OBI.clearcoat = 0;
  M_OBI.transmission = 0;

  /* ── M_FLOOR — Standard, not Physical: nothing here needs sheen. ─────────────────────────── */
  const M_FLOOR = new MeshStandardMaterial({
    name: 'M_FLOOR',
    color: new Color(C.M_FLOOR!.color!), // 0x7D5636 sealed wood
    roughness: P.M_FLOOR!.roughness!.v, // 0.42
    metalness: P.M_FLOOR!.metalness!.v, // 0
    envMapIntensity: P.M_FLOOR!.envMapIntensity!.v, // 1.0 — a per-material multiplier, NOT an envMap
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_FLOOR,
  });

  /* ── M_BACKDROP — unlit gradient shell. `stage.ts` attaches the CanvasTexture. ───────────── */
  const M_BACKDROP = new MeshBasicMaterial({
    name: 'M_BACKDROP',
    color: new Color(0xffffff), // the gradient map carries every value
    side: FrontSide, // stage.ts flips this to BackSide for the shell it builds
    toneMapped: MATERIAL_TONE_MAPPED.M_BACKDROP,
    fog: false,
  });

  /* ── M_HAIR — a shaped cap, no strands (§5.6). ───────────────────────────────────────────── */
  const M_HAIR = new MeshStandardMaterial({
    name: 'M_HAIR',
    color: new Color(C.M_HAIR!.color!), // 0x1A1512
    roughness: P.M_HAIR!.roughness!.v, // 0.55
    metalness: P.M_HAIR!.metalness!.v, // 0
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_HAIR,
  });

  /* ── M_EYE — the one glossy surface in the scene. ────────────────────────────────────────── */
  const M_EYE = new MeshStandardMaterial({
    name: 'M_EYE',
    color: new Color(B5_LOCAL_COLOR_HEX.eye),
    roughness: P.M_EYE!.roughness!.v, // 0.18
    metalness: P.M_EYE!.metalness!.v, // 0
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_EYE,
  });

  /* ── M_EMBUSEN — a decal plane at y = 0.002. `depthWrite: false` + polygon offset. ───────── */
  const M_EMBUSEN = new MeshBasicMaterial({
    name: 'M_EMBUSEN',
    color: new Color(B5_LOCAL_COLOR_HEX.embusen),
    transparent: true,
    opacity: P.M_EMBUSEN!.opacity!.v, // 0.55
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_EMBUSEN, // false — a teaching overlay, not lit geometry
    fog: false,
  });

  /* ── M_MASK — `scene.overrideMaterial` for metric 60. Pure white, untone-mapped. ─────────── */
  const M_MASK = new MeshBasicMaterial({
    name: 'M_MASK',
    color: new Color(C.M_MASK!.color!), // 0xFFFFFF
    opacity: P.M_MASK!.opacity!.v, // 1
    side: FrontSide,
    toneMapped: MATERIAL_TONE_MAPPED.M_MASK, // false — a mask must not carry a tone curve
    fog: false,
  });

  /* ── M_DEBUG — skeleton / reference stick / embusen trace. ───────────────────────────────── */
  const M_DEBUG = new LineBasicMaterial({
    name: 'M_DEBUG',
    color: new Color(B5_LOCAL_COLOR_HEX.debug),
    opacity: P.M_DEBUG!.opacity!.v, // 1
    toneMapped: MATERIAL_TONE_MAPPED.M_DEBUG,
    fog: false,
  });

  return Object.freeze({
    M_GI,
    M_SKIN,
    M_OBI,
    M_FLOOR,
    M_BACKDROP,
    M_HAIR,
    M_EYE,
    M_EMBUSEN,
    M_MASK,
    M_DEBUG,
  });
}

/** Frees every material in a set. Called by the app teardown path. */
export function disposeMaterials(mats: MaterialSet): void {
  for (const m of Object.values(mats)) m.dispose();
}
