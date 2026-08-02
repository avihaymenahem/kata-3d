/**
 * tests/render/config.test.ts — the GL-FREE half of B5.
 *
 * ARCHITECTURE.md §4.5: "GL-free: the pass-order array; every `MATERIAL_PARAMS` field lands on the
 * right material property; no `material.envMap` set".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS TESTABLE WITHOUT A WEBGL CONTEXT, AND WHY THAT IS MOST OF IT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vitest.config.ts` runs `environment: 'node'` on purpose, so there is no `document` and no GL. Four
 * of B5's modules were deliberately written so their CONFIGURATION is separable from their RENDERING:
 *
 *   * `materials.ts` — `createMaterials()` attaches no textures and touches no canvas, so all ten
 *     materials construct in Node and every `MATERIAL_PARAMS` field can be read back off the property
 *     it actually landed on. This is the difference between "the constant exists" and "the constant is
 *     wired to the right slot", and the second is the one that silently breaks.
 *   * `shadow.ts` — `configureShadow` is pure property assignment on a real `DirectionalLight`, and
 *     `snapShadowBox` is a pure function, so the texel snap that stops the shadow swimming during
 *     orbit is provable arithmetically instead of by eye.
 *   * `lights.ts` — a `Scene` and four `DirectionalLight`s need no context, so the rig's intensities,
 *     colours, positions, targets and the AmbientLight tripwire are all checkable.
 *   * `dojoEnv.ts` — plain geometry and unlit materials, so the procedural IBL SOURCE is inspectable
 *     even though the PMREM bake is not.
 *
 * What is NOT here: `buildEnvironment` (6 real cube renders), `buildStage` (CanvasTexture), and
 * `buildPost` (render targets). Their configuration is nonetheless pinned — `plannedPasses` is the
 * pure function `buildPost` checks its own chain against, and `stageClipBox` is pure.
 */

import { describe, expect, it } from 'vitest';
import {
  Bone,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Scene,
  Texture,
  Vector3,
  AgXToneMapping,
  ACESFilmicToneMapping,
  FrontSide,
  type Material,
} from 'three';

import {
  ENV,
  ENV_COLOR_HEX,
  LIGHTS,
  LIGHT_TARGET_M,
  MATERIAL_COLOR_HEX,
  MATERIAL_PARAMS,
  POST,
  POST_PASS_ORDER as B1_POST_PASS_ORDER,
  SHADOW,
  SHADOW_DO_NOT_SET,
} from '../../src/data';
import { H, STAGE_AABB_M, type RigHandles } from '../../src/contracts';
import {
  MATERIAL_TONE_MAPPED,
  PMREM_MAX_SAMPLES,
  PMREM_STANDARD_DEVIATIONS,
  POST_PASS_FORBIDDEN,
  POST_PASS_ORDER,
  SHADOW_AABB_BONES,
  SHADOW_NEVER_SET,
  SHADOW_PENUMBRA_M,
  SHADOW_TEXEL_M,
  S_FIT_M,
  TEXTURE_COLOR_SPACE,
  TONE_MAPPING,
  TONE_MAPPING_OPTIONS,
  assignMap,
  assertNoAmbientLight,
  buildLights,
  createMaterials,
  maxPmremSigma,
  plannedPasses,
  snapShadowBox,
  stageClipBox,
  type MapSlot,
  type MaterialId,
} from '../../src/render';
import { buildDojoEnvScene } from '../../src/render/dojoEnv';
import { configureShadow, refitShadow } from '../../src/render/shadow';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.2 — the pass order
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('§5.2 — the pass-order array literal', () => {
  it('is exactly §5.2, in order', () => {
    expect([...POST_PASS_ORDER]).toEqual([
      'RenderPass',
      'GTAOPass',
      'BokehPass',
      'UnrealBloomPass',
      'SMAAPass',
      'OutputPass',
      'LUTPass',
    ]);
  });

  it("agrees with B1's POST_PASS_ORDER — a reorder in either place is caught, not merged", () => {
    expect([...POST_PASS_ORDER]).toEqual([...B1_POST_PASS_ORDER]);
  });

  it('puts OutputPass after everything that must work in linear light', () => {
    const i = (n: string) => POST_PASS_ORDER.indexOf(n as never);
    // doc 05 §8.4: AO multiplies linear radiance; bloom needs pre-tonemap HDR; SMAA is linear-srgb.
    expect(i('GTAOPass')).toBeLessThan(i('OutputPass'));
    expect(i('UnrealBloomPass')).toBeLessThan(i('OutputPass'));
    expect(i('SMAAPass')).toBeLessThan(i('OutputPass'));
    // Bokeh must precede bloom or the bokeh disks do not bloom (doc 05 §8.4 note 3).
    expect(i('BokehPass')).toBeLessThan(i('UnrealBloomPass'));
    // AO before bloom, so an occluded crease cannot bloom back out again.
    expect(i('GTAOPass')).toBeLessThan(i('UnrealBloomPass'));
    // A grade, if it ever ships, is after the sRGB encode.
    expect(i('LUTPass')).toBeGreaterThan(i('OutputPass'));
  });

  it('starts with RenderPass — never an accumulation pass (§5.3)', () => {
    expect(POST_PASS_ORDER[0]).toBe('RenderPass');
  });

  it('contains none of the three forbidden passes', () => {
    for (const bad of POST_PASS_FORBIDDEN) {
      expect(POST_PASS_ORDER as readonly string[]).not.toContain(bad);
    }
    expect(POST_PASS_FORBIDDEN).toHaveLength(3);
  });
});

describe('§6.6 — quality tiers plan a SUBSEQUENCE of the chain, never a reordering', () => {
  const isSubsequence = (sub: readonly string[], full: readonly string[]): boolean => {
    let i = 0;
    for (const f of full) if (i < sub.length && sub[i] === f) i++;
    return i === sub.length;
  };

  for (const q of ['low', 'high', 'max'] as const) {
    it(`'${q}' is a subsequence of POST_PASS_ORDER`, () => {
      expect(isSubsequence(plannedPasses(q), POST_PASS_ORDER)).toBe(true);
    });
  }

  it('high and max build the same chain', () => {
    expect([...plannedPasses('high')]).toEqual([...plannedPasses('max')]);
  });

  it('high/max instantiate everything except LUTPass', () => {
    expect([...plannedPasses('high')]).toEqual([
      'RenderPass',
      'GTAOPass',
      'BokehPass',
      'UnrealBloomPass',
      'SMAAPass',
      'OutputPass',
    ]);
  });

  it('low drops GTAO and bloom — the SwiftShader smoke path — and nothing else', () => {
    expect([...plannedPasses('low')]).toEqual([
      'RenderPass',
      'BokehPass',
      'SMAAPass',
      'OutputPass',
    ]);
  });

  it('every tier keeps RenderPass, SMAA and the mandatory OutputPass', () => {
    for (const q of ['low', 'high', 'max'] as const) {
      const p = plannedPasses(q);
      expect(p).toContain('RenderPass');
      expect(p).toContain('SMAAPass');
      expect(p).toContain('OutputPass');
      expect(p[p.length - 1]).toBe('OutputPass');
    }
  });

  it('LUTPass is declared but never instantiated at any tier', () => {
    for (const q of ['low', 'high', 'max'] as const) {
      expect(plannedPasses(q)).not.toContain('LUTPass');
    }
    expect(POST_PASS_ORDER).toContain('LUTPass');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.1 — tone mapping and colour output
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('§5.1 — tone mapping', () => {
  it('ships AgXToneMapping', () => {
    expect(TONE_MAPPING).toBe(AgXToneMapping);
    expect(TONE_MAPPING_OPTIONS.agx.op).toBe(AgXToneMapping);
  });

  it('exposure is POST.toneMappingExposure', () => {
    expect(TONE_MAPPING_OPTIONS.agx.exposure).toBe(POST.toneMappingExposure.v);
  });

  it('the ACES alternative carries the /0.6 exposure correction (doc 05 §14.1 #27)', () => {
    // tonemapping_pars_fragment.glsl.js:62 applies `color *= exposure / 0.6` for ACES and
    // `color *= exposure` for AgX, so swapping the operator at a fixed exposure is a +0.74 EV jump.
    expect(TONE_MAPPING_OPTIONS.aces.op).toBe(ACESFilmicToneMapping);
    expect(TONE_MAPPING_OPTIONS.aces.exposure).toBeCloseTo(POST.toneMappingExposure.v * 0.6, 12);
  });

  it('offers exactly the three operators doc 05 §16 uncertainty 1 names', () => {
    expect(Object.keys(TONE_MAPPING_OPTIONS).sort()).toEqual(['aces', 'agx', 'neutral']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.6 — MATERIAL_PARAMS lands on the right property
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const MATS = createMaterials();
const ALL_IDS: readonly MaterialId[] = [
  'M_GI',
  'M_SKIN',
  'M_OBI',
  'M_FLOOR',
  'M_BACKDROP',
  'M_HAIR',
  'M_EYE',
  'M_EMBUSEN',
  'M_MASK',
  'M_DEBUG',
];

/** Read a numeric property off a material without `any`. */
const num = (m: Material, key: string): unknown =>
  (m as unknown as Record<string, unknown>)[key];

describe('§5.6 — createMaterials() is GL-free and complete', () => {
  it('builds all ten materials in Node with no DOM and no GL', () => {
    expect(Object.keys(MATS).sort()).toEqual([...ALL_IDS].sort());
  });

  it('names every material after its id, so a scorecard can blame one', () => {
    for (const id of ALL_IDS) expect(MATS[id].name).toBe(id);
  });
});

describe('§5.6 — every MATERIAL_PARAMS field lands on the correct material property', () => {
  /** `MATERIAL_PARAMS` key -> the material property it must land on. */
  const FIELD_TO_PROP: Readonly<Record<string, string>> = {
    roughness: 'roughness',
    metalness: 'metalness',
    sheen: 'sheen',
    sheenRoughness: 'sheenRoughness',
    specularIntensity: 'specularIntensity',
    ior: 'ior',
    anisotropy: 'anisotropy',
    clearcoat: 'clearcoat',
    transmission: 'transmission',
    envMapIntensity: 'envMapIntensity',
    opacity: 'opacity',
  };
  /** Fields that are NOT a direct scalar property; each is checked explicitly further down. */
  const INDIRECT = new Set([
    'weaveNormalScale', // -> normalScale.x/y
    'creaseNormalScale', // -> the crease map's own scale, Phase 4 (cloth wrinkle blend)
    'normalScale', // -> normalScale.x/y
    'mapAnisotropy', // -> texture.anisotropy, set in stage.ts / B4's textures
    'textureRes', // -> canvas size, set in stage.ts
    'planeYM', // -> mesh.position.y, set in stage.ts
  ]);

  /**
   * `${id}.${field}` pairs that are UNREACHABLE on the material class §5.6 prescribes, with the
   * reason. Listed rather than silently skipped: an unwired constant is a look-dev knob that appears
   * in B8's LOOK folder, moves, and does nothing — which is worse than an absent one.
   *
   * HANDOFF (B1): `MATERIAL_PARAMS.M_BACKDROP.roughness` has no landing site. §5.6 specifies
   * `M_BACKDROP` as a `MeshBasicMaterial` (an unlit gradient shell — it must NOT respond to the
   * light rig, or the backdrop picks up the key's terminator), and `MeshBasicMaterial` has no
   * `roughness`. Either drop the row or change §5.6's class; B5 may not edit a constant file.
   */
  const UNWIRED = new Set(['M_BACKDROP.roughness']);

  for (const id of ALL_IDS) {
    const params = MATERIAL_PARAMS[id];
    if (params === undefined) continue;
    for (const [field, spec] of Object.entries(params)) {
      const prop = FIELD_TO_PROP[field];
      if (prop === undefined) {
        it(`${id}.${field} is accounted for`, () => {
          expect(
            INDIRECT.has(field),
            `MATERIAL_PARAMS.${id}.${field} is neither a direct property nor a documented indirect ` +
              `one. Either wire it in src/render/materials.ts or add it to INDIRECT with a reason — ` +
              `an unwired constant is a look-dev knob that silently does nothing.`,
          ).toBe(true);
        });
        continue;
      }
      if (UNWIRED.has(`${id}.${field}`)) {
        it(`${id}.${field} is a KNOWN unwired constant (handoff to B1)`, () => {
          expect(num(MATS[id], prop)).toBeUndefined();
        });
        continue;
      }
      it(`${id}.${field} === material.${prop} (${spec.v})`, () => {
        expect(num(MATS[id], prop)).toBeCloseTo(spec.v, 12);
      });
    }
  }

  it('M_GI.weaveNormalScale lands on both components of normalScale', () => {
    const gi = MATS.M_GI as MeshPhysicalMaterial;
    const s = MATERIAL_PARAMS.M_GI!.weaveNormalScale!.v;
    expect(gi.normalScale.x).toBeCloseTo(s, 12);
    expect(gi.normalScale.y).toBeCloseTo(s, 12);
  });

  it('M_SKIN.normalScale lands on both components of normalScale', () => {
    const skin = MATS.M_SKIN as MeshPhysicalMaterial;
    const s = MATERIAL_PARAMS.M_SKIN!.normalScale!.v;
    expect(skin.normalScale.x).toBeCloseTo(s, 12);
    expect(skin.normalScale.y).toBeCloseTo(s, 12);
  });

  it('M_GI.anisotropyRotation is 0 — the analytic tangent IS the warp direction (§2.7)', () => {
    expect((MATS.M_GI as MeshPhysicalMaterial).anisotropyRotation).toBe(0);
  });
});

describe('§5.6 — colours match MATERIAL_COLOR_HEX exactly', () => {
  const hexOf = (m: Material, key: 'color' | 'sheenColor'): number =>
    (m as unknown as Record<string, { getHex(cs: string): number }>)[key]!.getHex(SRGBColorSpace);

  it('M_GI is 0xF2F0EA — never pure white (it clips the highlights under AgX)', () => {
    expect(hexOf(MATS.M_GI, 'color')).toBe(MATERIAL_COLOR_HEX.M_GI!.color);
    expect(hexOf(MATS.M_GI, 'color')).not.toBe(0xffffff);
  });

  it('M_GI.sheenColor is 0xE8E4DA (§2.5 conflict C05, dispute D09)', () => {
    expect(hexOf(MATS.M_GI, 'sheenColor')).toBe(MATERIAL_COLOR_HEX.M_GI!.sheenColor);
  });

  it('M_OBI, M_FLOOR, M_HAIR and M_MASK match their B1 rows', () => {
    expect(hexOf(MATS.M_OBI, 'color')).toBe(MATERIAL_COLOR_HEX.M_OBI!.color);
    expect(hexOf(MATS.M_FLOOR, 'color')).toBe(MATERIAL_COLOR_HEX.M_FLOOR!.color);
    expect(hexOf(MATS.M_HAIR, 'color')).toBe(MATERIAL_COLOR_HEX.M_HAIR!.color);
    expect(hexOf(MATS.M_MASK, 'color')).toBe(MATERIAL_COLOR_HEX.M_MASK!.color);
  });

  it('M_OBI is near-black — it is a SILHOUETTE DEVICE, not decoration (§5.6)', () => {
    const hex = hexOf(MATS.M_OBI, 'color');
    const lum = (((hex >> 16) & 0xff) * 0.2126 + ((hex >> 8) & 0xff) * 0.7152 + (hex & 0xff) * 0.0722) / 255;
    // It has to separate the white jacket from the white trousers in pure outline at LOW34/M_TOP.
    expect(lum).toBeLessThan(0.12);
  });
});

describe('§5.6 — the hard material rules', () => {
  it('NO material has an envMap (doc 05 §14.1 #11)', () => {
    for (const id of ALL_IDS) {
      const v = num(MATS[id], 'envMap');
      expect(v ?? null, `${id}.envMap must stay null — scene.environment is the one knob`).toBeNull();
    }
  });

  it('transmission is 0 everywhere (doc 05 §14.1 #13: >0 costs a whole extra scene render)', () => {
    for (const id of ALL_IDS) {
      const v = num(MATS[id], 'transmission');
      if (v !== undefined) expect(v, `${id}.transmission`).toBe(0);
    }
  });

  it('clearcoat is 0 everywhere', () => {
    for (const id of ALL_IDS) {
      const v = num(MATS[id], 'clearcoat');
      if (v !== undefined) expect(v, `${id}.clearcoat`).toBe(0);
    }
  });

  it('every material with a `side` uses FrontSide — there is no DoubleSide in this project', () => {
    for (const id of ALL_IDS) {
      const v = num(MATS[id], 'side');
      if (v !== undefined) expect(v, `${id}.side`).toBe(FrontSide);
    }
  });

  it('toneMapped follows §5.6: true except M_EMBUSEN, M_MASK and M_DEBUG', () => {
    for (const id of ALL_IDS) {
      expect(MATS[id].toneMapped, `${id}.toneMapped`).toBe(MATERIAL_TONE_MAPPED[id]);
    }
    expect(MATERIAL_TONE_MAPPED.M_MASK).toBe(false); // a mask must not carry a tone curve
    expect(MATERIAL_TONE_MAPPED.M_EMBUSEN).toBe(false);
    expect(MATERIAL_TONE_MAPPED.M_DEBUG).toBe(false);
    expect(MATERIAL_TONE_MAPPED.M_GI).toBe(true);
  });

  it('the gi is a MeshPhysicalMaterial with non-zero sheen — that is the whole reason for it', () => {
    expect(MATS.M_GI).toBeInstanceOf(MeshPhysicalMaterial);
    expect((MATS.M_GI as MeshPhysicalMaterial).sheen).toBeGreaterThan(0);
  });

  it('the floor is a MeshStandardMaterial — nothing there needs sheen (doc 05 §11.1)', () => {
    expect(MATS.M_FLOOR).toBeInstanceOf(MeshStandardMaterial);
    expect(MATS.M_FLOOR).not.toBeInstanceOf(MeshPhysicalMaterial);
  });

  it('M_EMBUSEN is a transparent, non-depth-writing decal (§5.6)', () => {
    const m = MATS.M_EMBUSEN as MeshBasicMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.polygonOffset).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * doc 05 §12 — the colour-space policy
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 05 §12 — texture colour space', () => {
  const COLOUR_SLOTS: readonly MapSlot[] = ['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap'];
  const DATA_SLOTS: readonly MapSlot[] = [
    'normalMap',
    'bumpMap',
    'roughnessMap',
    'metalnessMap',
    'sheenRoughnessMap',
    'aoMap',
    'alphaMap',
    'displacementMap',
    'anisotropyMap',
  ];

  it('colour maps are SRGBColorSpace', () => {
    for (const s of COLOUR_SLOTS) expect(TEXTURE_COLOR_SPACE[s], s).toBe(SRGBColorSpace);
  });

  it('data maps are NoColorSpace — "the #1 silent PBR bug"', () => {
    for (const s of DATA_SLOTS) expect(TEXTURE_COLOR_SPACE[s], s).toBe(NoColorSpace);
  });

  it('the policy table covers every slot the project can assign', () => {
    expect(Object.keys(TEXTURE_COLOR_SPACE).sort()).toEqual([...COLOUR_SLOTS, ...DATA_SLOTS].sort());
  });

  it('envMap is not even a legal slot', () => {
    expect(Object.keys(TEXTURE_COLOR_SPACE)).not.toContain('envMap');
  });

  it('assignMap OVERWRITES whatever colour space the caller set', () => {
    const m = new MeshStandardMaterial();
    const wrong = new Texture();
    wrong.colorSpace = SRGBColorSpace; // the classic mistake on a normal map
    assignMap(m, 'normalMap', wrong);
    expect(wrong.colorSpace).toBe(NoColorSpace);
    expect(m.normalMap).toBe(wrong);

    const albedo = new Texture();
    albedo.colorSpace = NoColorSpace; // the classic mistake on an albedo map
    assignMap(m, 'map', albedo);
    expect(albedo.colorSpace).toBe(SRGBColorSpace);
    m.dispose();
  });

  it('assignMap refuses envMap outright', () => {
    const m = new MeshStandardMaterial();
    expect(() => assignMap(m, 'envMap' as MapSlot, new Texture())).toThrow(/envMap is forbidden/);
    expect(m.envMap).toBeNull();
    m.dispose();
  });

  it('assignMap flags the material for recompilation', () => {
    const m = new MeshStandardMaterial();
    const before = m.version;
    assignMap(m, 'roughnessMap', new Texture());
    expect(m.version).toBeGreaterThan(before);
    m.dispose();
  });

  it('assignMap(null) clears the slot without touching a texture', () => {
    const m = new MeshStandardMaterial();
    assignMap(m, 'map', new Texture());
    assignMap(m, 'map', null);
    expect(m.map).toBeNull();
    m.dispose();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.4 — the light rig
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('§5.4 — buildLights', () => {
  const scene = new Scene();
  const rig = buildLights(scene);

  it('builds KEY / RIM / FILL / CROSS', () => {
    expect(Object.keys(rig).sort()).toEqual(['cross', 'fill', 'key', 'rim']);
  });

  it('every intensity, colour and position comes from B1 verbatim', () => {
    const rows = [
      ['key', rig.key, LIGHTS.key],
      ['rim', rig.rim, LIGHTS.rim],
      ['fill', rig.fill, LIGHTS.fill],
      ['cross', rig.cross, LIGHTS.cross],
    ] as const;
    for (const [name, light, spec] of rows) {
      expect(light.intensity, `${name}.intensity`).toBeCloseTo(spec.intensity.v, 12);
      expect(light.color.getHex(SRGBColorSpace), `${name}.color`).toBe(spec.colorHex);
      expect([light.position.x, light.position.y, light.position.z], `${name}.position`).toEqual([
        spec.posM[0],
        spec.posM[1],
        spec.posM[2],
      ]);
      expect(light.castShadow, `${name}.castShadow`).toBe(spec.castShadow);
    }
  });

  it('ONLY the key casts a shadow — one caster, 2048² (§5.5)', () => {
    expect(rig.key.castShadow).toBe(true);
    expect([rig.rim.castShadow, rig.fill.castShadow, rig.cross.castShadow]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('rim is the separation light: 0.47x key, cool, from behind (§5.4)', () => {
    expect(rig.rim.intensity / rig.key.intensity).toBeCloseTo(0.47, 2);
    expect(rig.rim.position.z).toBeLessThan(0); // behind the yoi facing axis
    // Cool: blue channel above red, so it reads against the warm key.
    const hex = rig.rim.color.getHex(SRGBColorSpace);
    expect(hex & 0xff).toBeGreaterThan((hex >> 16) & 0xff);
  });

  it('cross is capped at 0.13x key so it can never read as a second source (§5.4)', () => {
    expect(rig.cross.intensity / rig.key.intensity).toBeCloseTo(0.13, 2);
    expect(rig.cross.intensity).toBeLessThan(rig.fill.intensity);
    // Opposite azimuth from KEY, and low.
    expect(Math.sign(rig.cross.position.z)).toBe(-Math.sign(rig.key.position.z));
    expect(rig.cross.position.y).toBeLessThan(rig.key.position.y);
  });

  it('all four targets are IN THE SCENE (doc 05 §14.1 #25)', () => {
    for (const l of [rig.key, rig.rim, rig.fill, rig.cross]) {
      expect(scene.children, `${l.name}.target`).toContain(l.target);
      expect(scene.children).toContain(l);
    }
  });

  it('the key aims at hip height, not at the floor', () => {
    expect([rig.key.target.position.x, rig.key.target.position.y, rig.key.target.position.z]).toEqual(
      [LIGHT_TARGET_M[0], LIGHT_TARGET_M[1], LIGHT_TARGET_M[2]],
    );
    expect(rig.key.target.position.y).toBeCloseTo(0.5 * H, 6);
  });

  it('there is no AmbientLight and no HemisphereLight', () => {
    expect(() => assertNoAmbientLight(scene)).not.toThrow();
  });

  it('the AmbientLight tripwire actually fires', async () => {
    const { AmbientLight } = await import('three');
    const dirty = new Scene();
    dirty.add(new AmbientLight(0xffffff, 1));
    expect(() => assertNoAmbientLight(dirty)).toThrow(/omits ambient lighting entirely/);
  });

  it('the HemisphereLight tripwire also fires — same mistake wearing a hat', async () => {
    const { HemisphereLight } = await import('three');
    const dirty = new Scene();
    dirty.add(new HemisphereLight(0xffffff, 0x444444, 1));
    expect(() => assertNoAmbientLight(dirty)).toThrow(/omits ambient lighting entirely/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.5 — shadow configuration and the texel snap
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('§5.5 — configureShadow', () => {
  const light = new DirectionalLight(0xffffff, 1);
  configureShadow(light);
  const sh = light.shadow;

  it('mapSize is 2048² — one caster', () => {
    expect([sh.mapSize.x, sh.mapSize.y]).toEqual([SHADOW.mapSize.v, SHADOW.mapSize.v]);
  });

  it('bias is EXACTLY 0 and normalBias does the work (peter-panning)', () => {
    expect(sh.bias).toBe(0);
    expect(sh.normalBias).toBeCloseTo(SHADOW.normalBiasM.v, 12);
  });

  it('radius is 4 texels and intensity 0.92', () => {
    expect(sh.radius).toBeCloseTo(SHADOW.radius.v, 12);
    expect(sh.intensity).toBeCloseTo(SHADOW.intensity.v, 12);
  });

  it('near/far are the §5.5 constants', () => {
    expect(sh.camera.near).toBeCloseTo(SHADOW.nearM.v, 12);
    expect(sh.camera.far).toBeCloseTo(SHADOW.farM.v, 12);
  });

  it('the ortho box starts symmetric at ±S_fit = ±0.75 H', () => {
    expect(S_FIT_M).toBeCloseTo(SHADOW.sFitH.v * H, 12);
    expect(S_FIT_M).toBeCloseTo(1.3125, 6);
    expect(sh.camera.left).toBeCloseTo(-S_FIT_M, 12);
    expect(sh.camera.right).toBeCloseTo(S_FIT_M, 12);
    expect(sh.camera.bottom).toBeCloseTo(-S_FIT_M, 12);
    expect(sh.camera.top).toBeCloseTo(S_FIT_M, 12);
  });

  it('blurSamples is left at its default — it is VSM-only under PCF (doc 05 §14.1 #2)', () => {
    expect(sh.blurSamples).toBe(8); // LightShadow.js:95 default, untouched
    expect(SHADOW_NEVER_SET).toContain('blurSamples');
    expect([...SHADOW_DO_NOT_SET].sort()).toEqual([...SHADOW_NEVER_SET].sort());
  });

  it('the contact-shadow arithmetic of §5.5 holds: 1.28 mm texel, 10.2 mm penumbra', () => {
    expect(SHADOW_TEXEL_M).toBeCloseTo((2 * 1.3125) / 2048, 12);
    expect(SHADOW_TEXEL_M * 1000).toBeCloseTo(1.2817, 3);
    expect(SHADOW_PENUMBRA_M * 1000).toBeCloseTo(10.254, 2);
    // Mode A's fixed box would give ~27 mm — the "mushy shadow" of rubric C9.
    const modeAPenumbra = 2 * SHADOW.radius.v * ((2 * SHADOW.sFixedM.v) / SHADOW.mapSize.v);
    expect(modeAPenumbra * 1000).toBeGreaterThan(20);
    expect(SHADOW_PENUMBRA_M).toBeLessThan(modeAPenumbra / 2);
  });
});

describe('§5.5 — snapShadowBox: the light-space texel snap', () => {
  const t = SHADOW_TEXEL_M;

  it('holds the extent at 2·S_fit for any pose smaller than the box', () => {
    const fit = snapShadowBox(-0.2, 0.3, -0.4, 0.1);
    expect(fit.right - fit.left).toBeCloseTo(2 * Math.ceil(S_FIT_M / t) * t, 12);
    expect(fit.top - fit.bottom).toBeCloseTo(2 * Math.ceil(S_FIT_M / t) * t, 12);
    expect(fit.grew).toBe(false);
    expect(fit.texelM).toBeCloseTo(t, 15);
  });

  it('the extent is a WHOLE number of texels, so the grid itself never shifts', () => {
    const fit = snapShadowBox(-0.2, 0.3, -0.4, 0.1);
    expect(((fit.right - fit.left) / fit.texelM) % 1).toBeCloseTo(0, 9);
    expect(((fit.top - fit.bottom) / fit.texelM) % 1).toBeCloseTo(0, 9);
  });

  it('the centre lands on the texel grid', () => {
    const fit = snapShadowBox(0.113_47, 0.9137, -1.117_3, 0.007);
    expect((fit.centreX / fit.texelM) % 1).toBeCloseTo(0, 9);
    expect((fit.centreY / fit.texelM) % 1).toBeCloseTo(0, 9);
  });

  it('IS IDEMPOTENT — re-snapping an already-snapped box changes nothing', () => {
    const a = snapShadowBox(-0.31, 0.77, -0.9, 0.4);
    const b = snapShadowBox(a.left, a.right, a.bottom, a.top);
    // Same centre and same extent: the second call has nothing left to quantise.
    expect(b.centreX).toBeCloseTo(a.centreX, 12);
    expect(b.centreY).toBeCloseTo(a.centreY, 12);
    expect(b.right - b.left).toBeCloseTo(a.right - a.left, 12);
  });

  it('THE BOX ONLY EVER MOVES IN WHOLE TEXELS — this is what kills shadow swim', () => {
    // The anti-crawl guarantee is a LATTICE property, not "the box never moves": as the figure walks
    // the embusen the box must follow it, but every edge must always land on the same texel grid, so
    // the shadow's own edge pixels are re-quantised identically every frame. A fractional step is
    // what makes a shadow crawl during an orbit.
    const base = snapShadowBox(-0.31, 0.77, -0.9, 0.4);
    for (let n = 0; n <= 40; n++) {
      const frac = n / 40; // sweep a full texel in 1/40-texel steps
      const moved = snapShadowBox(-0.31 + frac * t, 0.77 + frac * t, -0.9 + frac * t, 0.4 + frac * t);
      const stepsX = (moved.centreX - base.centreX) / t;
      const stepsY = (moved.centreY - base.centreY) / t;
      expect(Math.abs(stepsX - Math.round(stepsX)), `frac ${frac} x`).toBeLessThan(1e-6);
      expect(Math.abs(stepsY - Math.round(stepsY)), `frac ${frac} y`).toBeLessThan(1e-6);
      expect(Math.abs(stepsX), `frac ${frac} magnitude`).toBeLessThanOrEqual(1);
    }
  });

  it('a shift that cannot cross the rounding boundary does not move the box AT ALL', () => {
    // Start with a midpoint exactly on a texel centre, so any |shift| < 0.5 texel provably rounds
    // back to the same lattice point. This is the strict form of "the shadow does not swim".
    const midX = 148 * t;
    const midY = -95 * t;
    const base = snapShadowBox(midX - 0.5, midX + 0.5, midY - 0.6, midY + 0.6);
    for (const frac of [-0.45, -0.2, 0, 0.2, 0.45]) {
      const moved = snapShadowBox(
        midX - 0.5 + frac * t,
        midX + 0.5 + frac * t,
        midY - 0.6 + frac * t,
        midY + 0.6 + frac * t,
      );
      expect(moved.left, `frac ${frac}`).toBeCloseTo(base.left, 12);
      expect(moved.right, `frac ${frac}`).toBeCloseTo(base.right, 12);
      expect(moved.bottom, `frac ${frac}`).toBeCloseTo(base.bottom, 12);
      expect(moved.top, `frac ${frac}`).toBeCloseTo(base.top, 12);
    }
  });

  it('a WHOLE-texel translation moves the box by exactly that many texels', () => {
    const base = snapShadowBox(-0.31, 0.77, -0.9, 0.4);
    const moved = snapShadowBox(-0.31 + 3 * t, 0.77 + 3 * t, -0.9, 0.4);
    expect(moved.centreX - base.centreX).toBeCloseTo(3 * t, 9);
    expect(moved.centreY).toBeCloseTo(base.centreY, 12);
  });

  it('grows, and flags `grew`, when a pose genuinely exceeds 2·S_fit', () => {
    const fit = snapShadowBox(-3, 3, -0.5, 0.5);
    expect(fit.grew).toBe(true);
    expect(fit.right - fit.left).toBeGreaterThanOrEqual(6);
  });

  it('is PURE — same inputs, same outputs, order-independent', () => {
    const a = snapShadowBox(-0.31, 0.77, -0.9, 0.4);
    const z = snapShadowBox(-2, 2, -2, 2);
    const b = snapShadowBox(-0.31, 0.77, -0.9, 0.4);
    expect(b).toEqual(a);
    expect(z.grew).toBe(true);
  });
});

describe('§5.5 — refitShadow against a synthetic rig', () => {
  /** 24 bones at plausible world positions. Only `byName` and `matrixWorld` are read. */
  const makeRig = (offset: Vector3): RigHandles => {
    const root = new Group();
    const byName: Record<string, Bone> = {};
    let i = 0;
    for (const n of SHADOW_AABB_BONES) {
      const b = new Bone();
      // A rough standing figure: spread over ~0.5 m laterally and 1.75 m vertically.
      b.position.set(
        offset.x + ((i % 3) - 1) * 0.22,
        offset.y + (i / SHADOW_AABB_BONES.length) * 1.7 + 0.05,
        offset.z + (((i * 7) % 5) - 2) * 0.12,
      );
      b.updateMatrixWorld(true);
      byName[n] = b;
      root.add(b);
      i++;
    }
    return { root, byName } as unknown as RigHandles;
  };

  const makeKey = (): DirectionalLight => {
    const l = new DirectionalLight(0xffffff, 1);
    l.position.set(LIGHTS.key.posM[0], LIGHTS.key.posM[1], LIGHTS.key.posM[2]);
    l.target.position.set(LIGHT_TARGET_M[0], LIGHT_TARGET_M[1], LIGHT_TARGET_M[2]);
    configureShadow(l);
    l.updateMatrixWorld(true);
    l.target.updateMatrixWorld(true);
    return l;
  };

  const cam = new Mesh().matrixWorld; // unused by refitShadow; see the Mode B rationale
  void cam;

  it('produces a finite, whole-texel box', () => {
    const light = makeKey();
    const rig = makeRig(new Vector3(0, 0, 0));
    refitShadow(rig, light, new Scene() as never);
    const c = light.shadow.camera;
    for (const v of [c.left, c.right, c.bottom, c.top]) expect(Number.isFinite(v)).toBe(true);
    expect(c.right).toBeGreaterThan(c.left);
    expect(c.top).toBeGreaterThan(c.bottom);
    expect(((c.right - c.left) / SHADOW_TEXEL_M) % 1).toBeCloseTo(0, 6);
  });

  it('keeps the extent constant as the figure walks the embusen — only the centre moves', () => {
    const light = makeKey();
    const boxes: { w: number; h: number; cx: number }[] = [];
    for (const z of [0, -1, -2, -3.5]) {
      refitShadow(makeRig(new Vector3(0, 0, z)), light, new Scene() as never);
      const c = light.shadow.camera;
      boxes.push({ w: c.right - c.left, h: c.top - c.bottom, cx: (c.left + c.right) / 2 });
    }
    for (const b of boxes) {
      expect(b.w).toBeCloseTo(boxes[0]!.w, 9);
      expect(b.h).toBeCloseTo(boxes[0]!.h, 9);
    }
    // ...and it really did move, or the test would prove nothing.
    expect(Math.abs(boxes[3]!.cx - boxes[0]!.cx)).toBeGreaterThan(0.5);
  });

  it('is idempotent for a stationary figure — no per-frame jitter (§5.5 shadow swim)', () => {
    const light = makeKey();
    const rig = makeRig(new Vector3(0.13, 0, -1.7));
    refitShadow(rig, light, new Scene() as never);
    const a = { ...light.shadow.camera };
    refitShadow(rig, light, new Scene() as never);
    const b = light.shadow.camera;
    expect(b.left).toBe(a.left);
    expect(b.right).toBe(a.right);
    expect(b.bottom).toBe(a.bottom);
    expect(b.top).toBe(a.top);
  });

  it('LEAVES THE LIGHT ALONE — position, colour and intensity never change (§5.4)', () => {
    const light = makeKey();
    const p = light.position.clone();
    const t = light.target.position.clone();
    const i = light.intensity;
    for (const z of [0, -1.5, -3]) {
      refitShadow(makeRig(new Vector3(0, 0, z)), light, new Scene() as never);
    }
    expect(light.position.equals(p)).toBe(true);
    expect(light.target.position.equals(t)).toBe(true);
    expect(light.intensity).toBe(i);
  });

  it('leaves the configured box alone when the rig has no matching bones', () => {
    const light = makeKey();
    const empty = { root: new Group(), byName: {} } as unknown as RigHandles;
    refitShadow(empty, light, new Scene() as never);
    // Not NaN, not Infinity: a NaN projection matrix drops the shadow entirely and silently.
    expect(light.shadow.camera.left).toBeCloseTo(-S_FIT_M, 12);
    expect(light.shadow.camera.right).toBeCloseTo(S_FIT_M, 12);
  });

  it('names 24 AABB bones, matching SHADOW.aabbBoneCount', () => {
    expect(SHADOW_AABB_BONES).toHaveLength(SHADOW.aabbBoneCount.v);
    expect(new Set(SHADOW_AABB_BONES).size).toBe(SHADOW_AABB_BONES.length);
    // Every extremity that can leave the torso box must be represented, or the box clips a limb.
    for (const n of ['fingers_end_L', 'fingers_end_R', 'toe_end_L', 'toe_end_R', 'head_end']) {
      expect(SHADOW_AABB_BONES as readonly string[]).toContain(n);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.2 / §5.5 — the stage clip box
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('§5.2 — GTAOPass.setSceneClipBox argument', () => {
  const box = stageClipBox();

  it('is the 4.68 m stage AABB (§2.5 conflict C13), widened in x by the frame-safe slack', () => {
    expect(box.max.z - box.min.z).toBeCloseTo(STAGE_AABB_M, 9);
    // x is kept SYMMETRIC so no authored->world x negation happens outside src/solve/frame.ts (§2.1).
    expect(box.min.x).toBeCloseTo(-box.max.x, 12);
    expect(box.max.x - box.min.x).toBeGreaterThan(STAGE_AABB_M);
  });

  it('covers the whole embusen z range, from yoi to the far edge', () => {
    expect(box.min.z).toBeLessThan(-3.78);
    expect(box.max.z).toBeGreaterThan(0);
  });

  it('starts just below the floor and reaches a full jodan extension', () => {
    expect(box.min.y).toBeLessThan(0);
    expect(box.max.y).toBeGreaterThan(H);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §5.4 / doc 05 §7.3 — the procedural IBL source scene
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('doc 05 §7.3 — buildDojoEnvScene', () => {
  it('builds GL-free and DOM-free (it is geometry and unlit materials only)', () => {
    const h = buildDojoEnvScene();
    expect(h.scene.children.length).toBeGreaterThan(5);
    h.dispose();
  });

  it('contains a real HDR emitter — radiance above 1.0, or the IBL is a grey box', () => {
    const h = buildDojoEnvScene({ detail: false });
    let maxRadiance = 0;
    h.scene.traverse((o) => {
      if (o instanceof Mesh) {
        const m = o.material as MeshBasicMaterial;
        maxRadiance = Math.max(maxRadiance, m.color.r, m.color.g, m.color.b);
      }
    });
    // The warm shoji band ships at 6.0x. PMREMGenerator captures into HalfFloatType
    // (PMREMGenerator.js:297) with toneMapping forced to NoToneMapping (:347), so this survives.
    expect(maxRadiance).toBeGreaterThan(3);
    h.dispose();
  });

  it('IS ASYMMETRIC — the warm and cool bands are on opposite walls at different intensities', () => {
    // A symmetric environment is a flat environment. §5.4: the cool band is 2.7x dimmer and smaller.
    expect(ENV_COLOR_HEX.warmBand).not.toBe(ENV_COLOR_HEX.coolBand);
    const h = buildDojoEnvScene({ detail: false });
    const xs: number[] = [];
    h.scene.traverse((o) => {
      if (o instanceof Mesh && Math.abs(o.position.x) > 5) xs.push(o.position.x);
    });
    expect(xs.some((x) => x > 0)).toBe(true);
    expect(xs.some((x) => x < 0)).toBe(true);
    h.dispose();
  });

  it('the [ART] detail pass adds structure and is fully removable in one toggle', () => {
    const plain = buildDojoEnvScene({ detail: false });
    const detailed = buildDojoEnvScene({ detail: true });
    expect(detailed.scene.children.length).toBeGreaterThan(plain.scene.children.length);
    // doc 05 §7.3's table is FIVE elements: shell, warm band, cool band, ceiling bounce, floor
    // bounce. `detail: false` must leave exactly those and nothing else, or the A/B baseline for
    // Channel-D rubric item C8 is not a baseline.
    expect(plain.scene.children.length).toBe(5);
    plain.dispose();
    detailed.dispose();
  });

  it('dispose() is idempotent and empties the scene', () => {
    const h = buildDojoEnvScene();
    h.dispose();
    h.dispose();
    expect(h.scene.children).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * doc 05 §7.3 — the PMREM sigma ceiling. FOUND BY RUNNING IT, NOT BY READING IT.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

describe("doc 05 §7.3 — sigma vs size: the table's two rows contradict each other", () => {
  it('mirrors the engine constants (PMREMGenerator.js:36, :619)', () => {
    expect(PMREM_MAX_SAMPLES).toBe(20);
    expect(PMREM_STANDARD_DEVIATIONS).toBe(3);
  });

  /** `PMREMGenerator.js:626-629`, reimplemented so the ceiling is checked, not asserted. */
  const enginesSampleCount = (size: number, sigma: number): number => {
    const pixels = Math.pow(2, Math.floor(Math.log2(size))) - 1;
    const radiansPerPixel = Math.PI / (2 * pixels);
    return 1 + Math.floor((3 * sigma) / radiansPerPixel);
  };

  it("doc 05's own sigma 0.04 is calibrated for the DEFAULT size 256 — exactly at the limit", () => {
    expect(enginesSampleCount(256, 0.04)).toBe(20);
    expect(enginesSampleCount(256, 0.04)).toBeLessThanOrEqual(PMREM_MAX_SAMPLES);
  });

  it('...and CLIPS at 2x once the same table sets size 512 — 40 samples against a max of 20', () => {
    expect(enginesSampleCount(512, 0.04)).toBe(40);
    expect(enginesSampleCount(512, 0.04)).toBeGreaterThan(PMREM_MAX_SAMPLES);
  });

  it('maxPmremSigma(size) lands samples exactly ON the limit, never over', () => {
    for (const size of [128, 256, 512, 1024]) {
      const s = maxPmremSigma(size);
      expect(enginesSampleCount(size, s), `size ${size}`).toBe(PMREM_MAX_SAMPLES);
      // `samples` is `1 + floor(3 * sigmaPixels)`, so the bound is only exact to within one step of
      // that floor — 1/19 of the value. A 10 % nudge is comfortably past it.
      expect(enginesSampleCount(size, s * 1.1), `size ${size} nudged over`).toBeGreaterThan(
        PMREM_MAX_SAMPLES,
      );
    }
  });

  it('halves as the cube size doubles, which is exactly why 0.04 broke at 512', () => {
    expect(maxPmremSigma(256) / maxPmremSigma(512)).toBeCloseTo(511 / 255, 3);
    // Closed form, restated independently rather than as a copied literal:
    // ((MAX_SAMPLES - 1) / STANDARD_DEVIATIONS) * PI / (2 * (2^9 - 1)).
    expect(maxPmremSigma(512)).toBeCloseTo(
      ((PMREM_MAX_SAMPLES - 1) / PMREM_STANDARD_DEVIATIONS) * (Math.PI / (2 * 511)),
      12,
    );
    expect(maxPmremSigma(512)).toBeCloseTo(0.01947, 5);
  });

  it("the SHIPPED pair (ENV.pmremSize, ENV.pmremSigma) needs the clamp — this is the handoff", () => {
    expect(ENV.pmremSize.v).toBe(512);
    expect(ENV.pmremSigma.v).toBe(0.04);
    expect(ENV.pmremSigma.v).toBeGreaterThan(maxPmremSigma(ENV.pmremSize.v));
    // The clamped value is still a real pre-blur, not zero: it must stay well inside doc 05's
    // stated 0..0.10 tolerance band, or the clamp would have silently deleted the feature.
    const used = Math.min(ENV.pmremSigma.v, maxPmremSigma(ENV.pmremSize.v));
    expect(used).toBeGreaterThan(0.015);
    expect(used).toBeLessThan(0.1);
  });
});
