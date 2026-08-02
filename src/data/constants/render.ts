/**
 * B1 NUMBERS — `src/data/constants/render.ts`
 *
 * `LIGHTS`, `SHADOW`, `POST`, `MATERIAL_PARAMS`, `ENV` (ARCHITECTURE.md §3.13, §4.1).
 * Sources: doc 05 §5 (the lighting rig), §6 (shadows), §7.3 (the procedural IBL), §8.5 (numeric
 * pass settings), §11.1 (material specs), doc 06 §7.9 (the fabric PBR model), plus
 * ARCHITECTURE §5.1–§5.6 where the plan DECIDES against a doc (§2.6: the plan wins on decisions).
 *
 * ── WHY SOME ANCHORS POINT AT `docs/ARCHITECTURE.md` ──────────────────────────────────────
 * Four render decisions have no research-doc value to cite because the plan MADE them:
 * the CROSS light (§5.4, marked `[ART]`), the gi sheen triple (§2.5 conflict C05, `D09`),
 * the gi anisotropy (C06, `D10`) and the stage AABB (C13). Those carry
 * `docs/ARCHITECTURE.md §5.x` as their anchor, with `conf: 'ART'` where the plan invented the
 * number outright. Every other row cites a research doc.
 *
 * ── COLOURS ARE NOT `Num`s ────────────────────────────────────────────────────────────────
 * A hex colour has no unit and no tolerance, and `verify-constants` greps for a decimal literal —
 * `0xF2F0EA` would be searched for as `15921386`. §3.13's own `LIGHTS` shape already makes
 * `colorHex` a plain `number` for exactly that reason, so `MATERIAL_COLOR_HEX` follows suit and
 * `MATERIAL_PARAMS` carries only the scalars.
 *
 * ── EVERY BAN THIS FILE MUST NOT BREAK ────────────────────────────────────────────────────
 * No `DoubleSide` (§5.5 — the gi's interior is a real 0.63 mm inner shell), no `PCFSoftShadowMap`
 * (silently downgraded at runtime, doc 05 §6.1), no `TAARenderPass`/`SSAARenderPass` (§5.3), no
 * `FXAAPass` (§5.2), no `material.envMap` (doc 05 §14.1 #11 — `scene.environment` only).
 * `tools/verify-contracts.mjs` greps `src/` for all six.
 */

import type { Num } from '../../contracts';
import { A, N } from '../num';

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * LIGHTS — four world-fixed directionals. NONE OF THEM EVER MOVES.
 *
 * `posM` is WORLD metres. ARCHITECTURE §5.4's table is the decision and its coordinates are used
 * directly as `DirectionalLight.position`, so — unlike doc 07 §6.6's camera transforms (conflict
 * C16) — there is no authored-frame conversion to apply here.
 *
 * CROSS exists because the karateka reaches six distinct headings (H = 0, 45, 90, 180, 270, 315);
 * with only KEY/RIM/FILL the headings whose chest normal points away from all three lose FORM and
 * read as a flat silhouette. It is world-fixed and capped at 0.40 precisely so it cannot become a
 * camera-following practical, which would make the shading terminator and the gi's sheen lobe SWIM
 * during orbit — visible during exactly the 360° interaction this product sells.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const LIGHTS: Readonly<
  Record<
    'key' | 'rim' | 'fill' | 'cross',
    {
      readonly posM: readonly [number, number, number];
      readonly intensity: Num;
      readonly colorHex: number;
      readonly castShadow: boolean;
    }
  >
> = Object.freeze({
  key: {
    posM: [2.6, 4.2, 3.15], // elev 45.8°, azim 39.5°
    intensity: N(3, 'ratio', 0.6, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
    colorHex: 0xfff4e8, // ~5200 K, warm dojo skylight
    castShadow: true,
  },
  rim: {
    posM: [-2.1, 2.8, -3.85],
    intensity: N(1.4, 'ratio', 0.4, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
    colorHex: 0xdfe9ff, // ~7000 K, cool separation
    castShadow: false,
  },
  fill: {
    posM: [-2.98, 1.58, 2.28],
    intensity: N(0.55, 'ratio', 0.2, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
    colorHex: 0xffffff,
    castShadow: false,
  },
  /** ARCHITECTURE §5.4 `[ART]` — no doc 05 row exists; the plan adds it. */
  cross: {
    posM: [1.95, 1.4, -2.6],
    intensity: N(0.4, 'ratio', 0.1, 'docs/ARCHITECTURE.md §5.4', 'ART'),
    colorHex: 0xf6f2ee,
    castShadow: false,
  },
});

/** `key.target.position`, aimed at HIP height, not the floor. `scene.add(key.target)` is mandatory. */
export const LIGHT_TARGET_M: readonly [number, number, number] = Object.freeze([0, 0.875, 0]);
/** doc 05 §5's derived rig geometry, kept so a look-dev change can be checked against it. */
export const LIGHT_GEOMETRY = Object.freeze({
  keyElevationDeg: N(45.8, 'deg', 8, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
  keyAzimuthDeg: N(39.5, 'deg', 10, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
  rimToKeyRatio: N(0.47, 'ratio', 0.15, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
  fillToKeyRatio: N(0.18, 'ratio', 0.08, 'docs/research/05-threejs-api.md §5', 'DERIVED'),
  /** ARCHITECTURE §5.4: capped so CROSS can never fight the key or read as a second source. */
  crossToKeyRatio: N(0.13, 'ratio', 0.04, 'docs/ARCHITECTURE.md §5.4', 'ART'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * SHADOW — `PCFShadowMap` only, one caster, Mode B per-frame fitted ortho frustum.
 * doc 05 §6.4 is the recipe; ARCHITECTURE §5.5 corrects its stage AABB (conflict C13).
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const SHADOW: Readonly<Record<string, Num>> = Object.freeze({
  mapSize: N(2048, 'count', 0, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  /** C13: 3.78 m embusen + 0.45 m limb envelope per side. doc 05 §6.4's 5.5 x 4.0 m is corrected. */
  stageAabbM: N(4.68, 'm', 0.1, 'docs/ARCHITECTURE.md §5.5', 'DERIVED'),
  /** Mode A, unused but kept so the two modes stay comparable. `0.5*hypot(4.68,4.68) + 0.2`. */
  sFixedM: N(3.51, 'm', 0.2, 'docs/ARCHITECTURE.md §5.5', 'DERIVED'),
  /** Mode B, SHIPPED. Fits a one-figure AABB including extended limbs. */
  sFitH: N(0.75, 'H', 0.09, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  /** 4 texels at a 1.28 mm world texel => a ~10.2 mm penumbra: a true CONTACT shadow. */
  radius: N(4, 'count', 1.5, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  nearM: N(0.1, 'm', 0.05, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  farM: N(12, 'm', 3, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  /** Keep at 0: with `normalBias` set, a constant bias peter-pans. */
  bias: N(0, 'ratio', 0, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  normalBiasM: N(0.015, 'm', 0.008, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  /** Leaves a touch of light in the core so the IBL fill still reads. */
  intensity: N(0.92, 'ratio', 0.06, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
  /** doc 05 §6.4: derive the AABB from ~24 bone world positions, not `computeBoundingBox()`. */
  aabbBoneCount: N(24, 'count', 0, 'docs/research/05-threejs-api.md §6.4', 'DERIVED'),
});

/**
 * `blurSamples` is VSM-ONLY under PCF (doc 05 §6.3, `WebGLShadowMap.js:379-382`) and must not be
 * set; `shadowSide` stays `null` because every shell is closed. Named here so a look-dev pass
 * cannot "add" them believing they do something.
 */
export const SHADOW_DO_NOT_SET: readonly string[] = Object.freeze(['blurSamples', 'shadowSide']);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * POST — the exact pass settings of doc 05 §8.5, plus §5.3's `StillAccumulator`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

export const POST: Readonly<Record<string, Num>> = Object.freeze({
  /* UnrealBloomPass. `resolution` MUST be the canvas size — the 256² ctor default mis-spaces the mips. */
  bloomStrength: N(0.22, 'ratio', 0.1, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  bloomRadius: N(0.55, 'ratio', 0.2, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  bloomThreshold: N(0.92, 'ratio', 0.06, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  bloomMips: N(5, 'count', 0, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),

  /* GTAOPass. NOT optional: it is what produces the dark crease where the gi meets the floor. */
  gtaoRadiusM: N(0.3, 'm', 0.1, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  gtaoDistanceExponent: N(1, 'ratio', 0.5, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  gtaoThickness: N(1, 'm', 0.5, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  gtaoDistanceFallOff: N(1, 'ratio', 0.5, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  gtaoScale: N(1.15, 'ratio', 0.25, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  /** 24 => the shader derives DIRECTIONS 3, STEPS 8. */
  gtaoSamples: N(24, 'count', 8, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  gtaoBlendIntensity: N(0.85, 'ratio', 0.15, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdLumaPhi: N(10, 'ratio', 4, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdDepthPhi: N(2, 'ratio', 1, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdNormalPhi: N(3, 'ratio', 1, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdRadius: N(6, 'count', 3, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdSamples: N(16, 'count', 4, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdRings: N(2, 'count', 0, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  pdRadiusExponent: N(2, 'ratio', 0, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),

  /* BokehPass. `maxblur` is ALWAYS passed explicitly: the ctor default is 1.0 and the shader
   * default 0.01 — a 100x discrepancy (doc 05 §8.5, §14.1 #21). */
  bokehAperture: N(0.0018, 'ratio', 0.0006, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),
  bokehMaxblur: N(0.006, 'ratio', 0.002, 'docs/research/05-threejs-api.md §8.5', 'DERIVED'),

  /* §5.3 StillAccumulator — OUR Halton(2,3) view-offset jitter, which is what makes GTAO's own
   * internal `renderer.render` jitter in lockstep. 32 samples resolve a still in ~0.53 s at 60 fps. */
  stillSamples: N(32, 'count', 0, 'docs/ARCHITECTURE.md §5.3', 'DERIVED'),
  stillSamplesLowTier: N(12, 'count', 0, 'docs/ARCHITECTURE.md §5.3', 'ART'),

  /* Tone mapping. AgX, exposure 1.0; NEVER touch `outputColorSpace`. */
  toneMappingExposure: N(1, 'ratio', 0.1, 'docs/research/05-threejs-api.md §4.3', 'DERIVED'),
  maxPixelRatio: N(2, 'ratio', 0, 'docs/research/05-threejs-api.md §3', 'DERIVED'),
});

/** §5.2's pass chain, in order. `tests/render/config.test.ts` (B5) asserts the array literal. */
export const POST_PASS_ORDER: readonly string[] = Object.freeze([
  'RenderPass',
  'GTAOPass',
  'BokehPass',
  'UnrealBloomPass',
  'SMAAPass',
  'OutputPass',
  'LUTPass',
]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * MATERIAL_PARAMS — ten materials, one factory, zero `onBeforeCompile`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D05_11 = 'docs/research/05-threejs-api.md §11.1';
const D06_79 = 'docs/research/06-rig-ik-cloth.md §7.9';

export const MATERIAL_PARAMS: Readonly<Record<string, Readonly<Record<string, Num>>>> =
  Object.freeze({
    /**
     * The gi. doc 06 §7.9 argues its numbers from Estevez & Kulla's Charlie sheen model and
     * Filament cloth data; doc 05 §11.1 asserts `sheen 1.0 / 0xffffff` undefended. §2.5 ships the
     * middle with a LIVE SLIDER, because only Channel D can settle it — hence `D09`, not an
     * argument. `roughness` follows doc 06's 0.78 (doc 05 says 0.82; inside each other's tolerance).
     */
    M_GI: Object.freeze({
      roughness: N(0.78, 'ratio', 0.06, D06_79, 'DERIVED'),
      metalness: N(0, 'ratio', 0, D06_79, 'DERIVED'),
      sheen: A(0.45, 'ratio', 0.15, 'docs/ARCHITECTURE.md §5.6', 'ART', 'D09', [
        { v: 1.0, src: 'docs/research/05-threejs-api.md §11.1', label: 'doc 05: sheen 1.0 / 0xffffff' },
        { v: 0.35, src: 'docs/research/06-rig-ik-cloth.md §7.9', label: 'doc 06: cotton fibre fuzz' },
      ]),
      sheenRoughness: N(0.55, 'ratio', 0.15, D06_79, 'DERIVED'),
      specularIntensity: N(0.35, 'ratio', 0.15, D06_79, 'DERIVED'),
      ior: N(1.45, 'ratio', 0.05, D06_79, 'DERIVED'),
      /** C06: doc 05 objected only that anisotropy "needs a tangent attribute" — we generate one. */
      anisotropy: A(0.18, 'ratio', 0.07, 'docs/ARCHITECTURE.md §5.6', 'ART', 'D10', [
        { v: 0.25, src: 'docs/research/06-rig-ik-cloth.md §7.9', label: 'doc 06: warp-aligned 0.25' },
        { v: 0, src: 'docs/research/05-threejs-api.md §11.1', label: 'doc 05: omit anisotropy' },
      ]),
      weaveNormalScale: N(0.6, 'ratio', 0.2, D06_79, 'DERIVED'),
      creaseNormalScale: N(1, 'ratio', 0.2, D06_79, 'DERIVED'),
      /** Both zero, everywhere, per doc 05 §14.1 #13. */
      clearcoat: N(0, 'ratio', 0, D06_79, 'DERIVED'),
      transmission: N(0, 'ratio', 0, D06_79, 'DERIVED'),
    }),
    /** Skin. NO `SubsurfaceScatteringShader`: it is Phong-based and a `ShaderMaterial` (doc 05 §11.1). */
    M_SKIN: Object.freeze({
      roughness: N(0.48, 'ratio', 0.08, D05_11, 'DERIVED'),
      metalness: N(0, 'ratio', 0, D05_11, 'DERIVED'),
      sheen: N(0.15, 'ratio', 0.1, D05_11, 'DERIVED'),
      sheenRoughness: N(0.85, 'ratio', 0.1, D05_11, 'DERIVED'),
      ior: N(1.4, 'ratio', 0.05, D05_11, 'DERIVED'),
      specularIntensity: N(0.6, 'ratio', 0.2, D05_11, 'DERIVED'),
      normalScale: N(0.7, 'ratio', 0.2, D05_11, 'DERIVED'),
      clearcoat: N(0, 'ratio', 0, D05_11, 'DERIVED'),
      transmission: N(0, 'ratio', 0, D05_11, 'DERIVED'),
    }),
    /**
     * The obi. ARCHITECTURE §5.6: the black belt is a SILHOUETTE DEVICE — it separates jacket from
     * trousers so stance depth reads in pure outline at low and overhead orbit angles, where value
     * separation is all the viewer has.
     */
    M_OBI: Object.freeze({
      roughness: N(0.62, 'ratio', 0.08, 'docs/ARCHITECTURE.md §5.6', 'ART'),
      metalness: N(0, 'ratio', 0, 'docs/ARCHITECTURE.md §5.6', 'ART'),
      sheen: N(0.25, 'ratio', 0.1, 'docs/ARCHITECTURE.md §5.6', 'ART'),
      sheenRoughness: N(0.55, 'ratio', 0.15, 'docs/ARCHITECTURE.md §5.6', 'ART'),
    }),
    /** Floor. `map.anisotropy` is MANDATORY at grazing angles; the default is 1. */
    M_FLOOR: Object.freeze({
      roughness: N(0.42, 'ratio', 0.08, D05_11, 'DERIVED'),
      metalness: N(0, 'ratio', 0, D05_11, 'DERIVED'),
      envMapIntensity: N(1, 'ratio', 0.3, D05_11, 'DERIVED'),
      mapAnisotropy: N(8, 'count', 0, D05_11, 'DERIVED'),
      textureRes: N(2048, 'count', 0, 'docs/research/05-threejs-api.md §12', 'DERIVED'),
    }),
    M_BACKDROP: Object.freeze({
      roughness: N(1, 'ratio', 0, 'docs/ARCHITECTURE.md §5.6', 'ART'),
    }),
    M_HAIR: Object.freeze({
      roughness: N(0.55, 'ratio', 0.1, 'docs/ARCHITECTURE.md §5.6', 'ART'),
      metalness: N(0, 'ratio', 0, 'docs/ARCHITECTURE.md §5.6', 'ART'),
    }),
    M_EYE: Object.freeze({
      roughness: N(0.18, 'ratio', 0.05, 'docs/ARCHITECTURE.md §5.6', 'ART'),
      metalness: N(0, 'ratio', 0, 'docs/ARCHITECTURE.md §5.6', 'ART'),
    }),
    /** Embusen decal plane at `y = 0.002`; `depthWrite false`, `toneMapped false`, polygon-offset. */
    M_EMBUSEN: Object.freeze({
      opacity: N(0.55, 'ratio', 0.2, 'docs/ARCHITECTURE.md §5.6', 'ART'),
      planeYM: N(0.002, 'm', 0.001, 'docs/ARCHITECTURE.md §5.6', 'ART'),
    }),
    /** `scene.overrideMaterial` for metric 60's silhouette IoU. Pure white, `toneMapped false`. */
    M_MASK: Object.freeze({
      opacity: N(1, 'ratio', 0, 'docs/research/07-reference-and-datasets.md §6.6', 'DERIVED'),
    }),
    M_DEBUG: Object.freeze({
      opacity: N(1, 'ratio', 0, 'docs/ARCHITECTURE.md §5.6', 'ART'),
    }),
  });

/** Hex colours, plain numbers (see the header). Grouped by material so B5 has one lookup. */
export const MATERIAL_COLOR_HEX: Readonly<Record<string, Readonly<Record<string, number>>>> =
  Object.freeze({
    /** NEVER pure `0xffffff`: it clips the highlights and flattens the form under AgX. */
    M_GI: Object.freeze({ color: 0xf2f0ea, sheenColor: 0xe8e4da }),
    M_OBI: Object.freeze({ color: 0x14110f }),
    M_FLOOR: Object.freeze({ color: 0x7d5636 }),
    M_HAIR: Object.freeze({ color: 0x1a1512 }),
    M_MASK: Object.freeze({ color: 0xffffff }),
    M_BACKDROP: Object.freeze({ colorTop: 0x1a1c20, colorBottom: 0x0b0c0e }),
  });

/** §5.6's draw-call budget. `perf.json` asserts 12 opaque draws. */
export const DRAW_BUDGET = Object.freeze({
  opaqueDraws: N(12, 'count', 0, 'docs/ARCHITECTURE.md §5.6', 'DERIVED'),
  triangles: N(27000, 'count', 3000, 'docs/ARCHITECTURE.md §5.6', 'DERIVED'),
  bodyVerts: N(3900, 'count', 400, 'docs/research/06-rig-ik-cloth.md §5.1', 'DERIVED'),
  giVerts: N(9000, 'count', 1000, 'docs/research/06-rig-ik-cloth.md §5.1', 'DERIVED'),
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * ENV — the procedural dojo IBL. NOTHING IS FETCHED: every emitter is a `MeshBasicMaterial` quad
 * in our own scene, captured once by `PMREMGenerator.fromScene`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const D05_73 = 'docs/research/05-threejs-api.md §7.3';

export const ENV: Readonly<Record<string, Num>> = Object.freeze({
  pmremSize: N(512, 'count', 0, D05_73, 'DERIVED'),
  /** `sigma`, in RADIANS. The frozen `Unit` union has no `'rad'`; `'ratio'` plus this note carries it. */
  pmremSigma: N(0.04, 'ratio', 0.03, D05_73, 'DERIVED'),
  pmremNearM: N(0.1, 'm', 0, D05_73, 'DERIVED'),
  pmremFarM: N(40, 'm', 0, D05_73, 'DERIVED'),
  /** Capture at the karateka's CHEST (`0.55·H`), not at the floor. */
  capturePosYM: N(0.9625, 'm', 0.2, D05_73, 'DERIVED'),
  environmentIntensity: N(0.85, 'ratio', 0.25, D05_73, 'DERIVED'),
  /**
   * `scene.environmentRotation = Euler(0, this, 0)`, RADIANS — it rotates the brightest window off
   * axis for asymmetric specular. This is an ENVIRONMENT-MAP rotation, not a character yaw: §2.1's
   * "nothing else may negate a yaw" is about the authored->world conversion in `src/solve/frame.ts`
   * and does not reach here. The value is doc 05 §7.3's own literal.
   */
  environmentRotationY: N(-0.35, 'ratio', 0.5, D05_73, 'DERIVED'),
  backgroundIntensity: N(1, 'ratio', 0.4, D05_73, 'DERIVED'),
  backgroundBlurriness: N(0, 'ratio', 0, D05_73, 'DERIVED'),

  /* The procedural env scene, doc 05 §7.3's own table. */
  shellWM: N(14, 'm', 1, D05_73, 'DERIVED'),
  shellHM: N(7, 'm', 1, D05_73, 'DERIVED'),
  warmBandWM: N(6, 'm', 0.5, D05_73, 'DERIVED'),
  warmBandHM: N(1.6, 'm', 0.2, D05_73, 'DERIVED'),
  warmBandYM: N(3.6, 'm', 0.3, D05_73, 'DERIVED'),
  warmBandXM: N(6.9, 'm', 0.3, D05_73, 'DERIVED'),
  warmBandEmissive: N(6, 'ratio', 1, D05_73, 'DERIVED'),
  coolBandWM: N(3, 'm', 0.3, D05_73, 'DERIVED'),
  coolBandHM: N(1.2, 'm', 0.2, D05_73, 'DERIVED'),
  coolBandYM: N(3.4, 'm', 0.3, D05_73, 'DERIVED'),
  coolBandEmissive: N(2.2, 'ratio', 0.4, D05_73, 'DERIVED'),
  ceilingBounceYM: N(6.9, 'm', 0.3, D05_73, 'DERIVED'),
  ceilingBounceEmissive: N(1.1, 'ratio', 0.2, D05_73, 'DERIVED'),
  /** THE row that puts warm light under the jaw and inside the gi skirt. */
  floorBounceYM: N(0.02, 'm', 0.01, D05_73, 'DERIVED'),
  floorBounceSizeM: N(12, 'm', 1, D05_73, 'DERIVED'),
});

/** Env-scene hex colours, plain numbers. */
export const ENV_COLOR_HEX = Object.freeze({
  shell: 0x2a2723,
  warmBand: 0xfff2e0,
  coolBand: 0xdfe9ff,
  ceilingBounce: 0xf2ece2,
  floorBounce: 0x8a5f38,
  /** Never the raw PMREM as the visible backdrop — it looks cheap. */
  background: 0x0e0f12,
});
