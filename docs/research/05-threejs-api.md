# 05 — THREE.JS 0.185.1 GROUND TRUTH (AAA realtime rendering spec)

Target: 3D 360° kata player (single karateka, orbitable, scrubbable). Not a game.
Installed package verified: `node_modules/three/package.json` → `"version": "0.185.1"`; `node_modules/three/src/constants.js:1` → `export const REVISION = '185'`.

**Verification rule used in this document.** Every API claim below was checked by reading the installed files under `C:\Users\avihay\projects\karate\node_modules\three\`. Web sources were used only for *current best practice* and *release history*, then re-confirmed locally. Where the public three.js migration wiki disagrees with the installed 0.185.1 tree, the installed tree wins and the disagreement is listed in §14.2 and §16.

Path shorthand used throughout: `T/` = `C:\Users\avihay\projects\karate\node_modules\three\`.

---

## 1. Coordinate, scale and units contract

Right-handed. Three.js is right-handed by construction (`Matrix4.makePerspective`, `Object3D.up = (0,1,0)`).

| param | value | unit | tolerance | source |
|---|---|---|---|---|
| `handedness` | right-handed | — | exact | `T/src/math/Matrix4.js` `makePerspective` / `makeOrthographic` (OpenGL/RH clip convention) |
| `up axis` | `+Y` | — | exact | `T/src/core/Object3D.js:1655` — `Object3D.DEFAULT_UP = new Vector3( 0, 1, 0 )`, cloned into `this.up` at `:138` |
| facing at yoi | `-Z` | — | exact | project convention (declared here) |
| character's LEFT | `+X` | — | exact | project convention (declared here) |
| character's RIGHT | `-X` | — | exact | derived from above |
| embusen plane | `XZ` (y = 0) | — | exact | project convention |
| world unit | 1 unit = 1 metre | m | exact | required for r155+ physical light decay |
| `H` (body height) | 1.75 | units (m) | ±0.00 (reference) | project constant; 175 cm |
| floor plane | `y = 0` | m | exact | project convention |
| yoi origin | `(0, 0, 0)` | m | exact | project convention |
| camera default orbit target | `(0, 0.55·H, 0)` = `(0, 0.9625, 0)` | m | ±0.05 H | [DERIVED] mid-torso of a standing figure |

Rotation-order note: `Object3D.rotation` is an `Euler` whose default order is `'XYZ'` — `T/src/math/Euler.js:447` → `Euler.DEFAULT_ORDER = 'XYZ'` (consumed by the ctor at `:35`). Authored kata data MUST be stored as quaternions, not Eulers, to avoid order ambiguity (see §10).

---

## 2. Renderer choice: WebGLRenderer vs WebGPURenderer (this exact build)

### 2.1 What actually exists locally

| artifact | present | path |
|---|---|---|
| `WebGLRenderer` | yes | `T/src/renderers/WebGLRenderer.js` (3703 lines) |
| `WebGPURenderer` | yes | `T/src/renderers/webgpu/WebGPURenderer.js` (107 lines) |
| `three/webgpu` subpath export | yes | `T/package.json` → `"./webgpu": "./build/three.webgpu.js"` |
| `three/tsl` subpath export | yes | `T/package.json` → `"./tsl": "./build/three.tsl.js"` |
| `three/addons/*` alias | yes | `T/package.json` → `"./addons/*": "./examples/jsm/*"` |
| WebGL2 fallback backend for WebGPU | yes | `T/src/renderers/webgl-fallback/WebGLBackend.js` |
| `RenderPipeline` (node post FX, WebGPU only) | yes | `T/src/renderers/common/RenderPipeline.js` (`"can only be used with WebGPURenderer"`) |
| `PostProcessing` (WebGPU) | yes, **deprecated r183** | `T/src/renderers/common/PostProcessing.js:19` warns → use `RenderPipeline` |
| `EffectComposer` (WebGL only) | yes | `T/examples/jsm/postprocessing/EffectComposer.js` |

`WebGPURenderer` constructor options (verbatim from `T/src/renderers/webgpu/WebGPURenderer.js:31-45`): `logarithmicDepthBuffer=false`, `reversedDepthBuffer=false`, `alpha=true`, `depth=true`, `stencil=false`, `antialias=false`, `samples=0` (→ 4 when `antialias`), `forceWebGL=false`, `multiview=false`, `outputType=undefined`, `outputBufferType=HalfFloatType`.

### 2.2 Real trade-off for a shipping-quality scene, 2026

| axis | WebGLRenderer | WebGPURenderer (`three/webgpu`) |
|---|---|---|
| maturity in this build | stable | self-described "new alternative"; upstream docs still call it experimental |
| `ShaderMaterial` / `RawShaderMaterial` / `onBeforeCompile` | supported | **not supported** — must port to NodeMaterial + TSL |
| `EffectComposer` + `examples/jsm/postprocessing/*` (30 passes) | supported | **not supported** — needs `RenderPipeline` + `examples/jsm/tsl/display/*` (44 node files) |
| AA options | SMAAPass, FXAAPass, TAARenderPass, SSAARenderPass, MSAA via `antialias` | `SMAANode`, `FXAANode`, `TRAANode`, `TAAUNode`, `SSAAPassNode`, MSAA `samples` |
| exclusive quality wins | — | `SSGINode`, `SSSNode`, `SSRNode`, `RecurrentDenoiseNode`, `FSR1Node`, `GodraysNode`, `ClusteredLighting`, `TileShadowNode` |
| init | synchronous | `await renderer.init()` unless using `setAnimationLoop` (`T/src/renderers/common/Renderer.js:767 async init()`) |
| shadow type set | `BasicShadowMap`/`PCFShadowMap`/`VSMShadowMap` | same enum, `PCFShadowMap` default (`T/src/renderers/common/Renderer.js:703-707`) |
| perf for our scene (1 skinned figure, ~30 draw calls) | CPU cost is irrelevant at this draw count | no measurable win; WebGPU wins only at high draw counts / compute |

### 2.3 RECOMMENDATION — `WebGLRenderer`

Reasons, in priority order:
1. Our scene is **1 skinned character + floor + IBL ≈ 10–40 draw calls**. WebGPU's advantage is CPU-side binding cost at 1000s of draw calls and compute workloads. We have neither. There is no throughput argument.
2. The entire mature post-FX toolkit in this build is WebGL-only: `GTAOPass`, `SMAAPass`, `TAARenderPass`, `UnrealBloomPass`, `BokehPass`, `OutputPass`. WebGPU forces a full TSL rewrite of the chain for zero visual gain at our scene complexity.
3. `TAARenderPass` (still-frame accumulation, 32 jitter samples) is a *huge* quality lever for a scrubbable/paused player and exists only on the WebGL path in this build (`T/examples/jsm/postprocessing/TAARenderPass.js:93` uses `_JitterVectors[5]`, 32 entries).
4. Zero async-init complexity in the boot path.

Escape hatch: keep all material creation behind one factory so a future WebGPU port only touches that factory. Do **not** use `onBeforeCompile` anywhere — it is the one thing that makes a WebGPU port impossible.

Sources: `T/src/renderers/webgpu/WebGPURenderer.js`; `T/src/renderers/common/RenderPipeline.js`; https://threejs.org/manual/en/webgpurenderer.html ; https://github.com/mrdoob/three.js/wiki/Migration-Guide

---

## 3. WebGLRenderer construction — verified parameter table

Defaults read from `T/src/renderers/WebGLRenderer.js:73-83`.

| param | default | recommended (this project) | unit | tolerance | note |
|---|---|---|---|---|---|
| `canvas` | auto-created | own `<canvas>` | — | — | |
| `context` | `null` | `null` | — | — | |
| `depth` | `true` | `true` | bool | exact | |
| `stencil` | `false` | `false` | bool | exact | keep false; nothing needs stencil |
| `alpha` | `false` | `false` | bool | exact | opaque canvas = cheaper |
| `antialias` | `false` | `false` | bool | exact | MSAA is bypassed once `EffectComposer` is used; we use SMAA+TAA |
| `premultipliedAlpha` | `true` | `true` | bool | exact | |
| `preserveDrawingBuffer` | `false` | `true` **only** during frame capture | bool | exact | +VRAM, -perf; toggle per capture session |
| `powerPreference` | `'default'` | `'high-performance'` | enum | exact | |
| `failIfMajorPerformanceCaveat` | `false` | `false` | bool | exact | |
| `reversedDepthBuffer` | `false` | `false` | bool | exact | see §14.1 gotcha #7 |

| runtime prop | default | recommended | source |
|---|---|---|---|
| `autoClear` | `true` | `true` (managed by `RenderPass`) | `WebGLRenderer.js:198` |
| `sortObjects` | `true` | `true` | `WebGLRenderer.js:241` |
| `localClippingEnabled` | `false` | `false` | `WebGLRenderer.js:259` |
| `transmissionResolutionScale` | `1.0` | `0.5` if any transmission material ships | `WebGLRenderer.js:289` |
| `setPixelRatio(v)` | 1 | `Math.min(devicePixelRatio, 2)` | `WebGLRenderer.js:628` |
| `capabilities.getMaxAnisotropy()` | driver | clamp texture `anisotropy` to it | `T/src/renderers/webgl/WebGLCapabilities.js:8,121` |
| `compileAsync(scene,camera)` | — | call once before first frame | `WebGLRenderer.js:1487` |
| `compile(scene,camera,targetScene)` | — | sync variant | `WebGLRenderer.js:1380` |
| `setAnimationLoop(cb)` | — | use it (XR-safe) | `WebGLRenderer.js:1581` |

---

## 4. Color pipeline

### 4.1 Color-space constants actually in this build
`T/src/constants.js:1300-1332`

| name | value | note |
|---|---|---|
| `NoColorSpace` | `''` | use for normal/roughness/metalness/AO/displacement maps |
| `SRGBColorSpace` | `'srgb'` | use for albedo/emissive/sheenColor maps |
| `LinearSRGBColorSpace` | `'srgb-linear'` | working space |
| `LinearTransfer` | `'linear'` | transfer-function id |
| `SRGBTransfer` | `'srgb'` | transfer-function id |

| param | value | unit | tolerance | source |
|---|---|---|---|---|
| `ColorManagement.enabled` | `true` (default) | bool | exact | `T/src/math/ColorManagement.js:21` |
| `ColorManagement.workingColorSpace` | `LinearSRGBColorSpace` | enum | exact | `T/src/math/ColorManagement.js:23` |
| `renderer.outputColorSpace` | `SRGBColorSpace` (default) | enum | exact | `T/src/renderers/WebGLRenderer.js:304` (`_outputColorSpace`), accessor at `:3592` |
| unpack space for `srgb-linear` working space | `SRGBColorSpace` | enum | exact | `T/src/math/ColorManagement.js:183` |

Do **not** set `renderer.outputColorSpace` manually — the default is already correct. When `EffectComposer` is used, `OutputPass` reads `renderer.outputColorSpace` and `renderer.toneMapping` off the renderer each frame and rebuilds its defines (`T/examples/jsm/postprocessing/OutputPass.js:96-113`), so the renderer props remain the single source of truth.

### 4.2 Tone mapping enums present in this build
Exact names + integer values, `T/src/constants.js:422-482`. **`CustomToneMapping = 5` and `AgXToneMapping = 6` — note the non-monotonic ordering; never hard-code integers.**

| enum name | int | GLSL fn present | source |
|---|---|---|---|
| `NoToneMapping` | 0 | n/a | `constants.js:422` |
| `LinearToneMapping` | 1 | `LinearToneMapping()` | `tonemapping_pars_fragment.glsl.js:10` |
| `ReinhardToneMapping` | 2 | `ReinhardToneMapping()` | `:17` |
| `CineonToneMapping` | 3 | `CineonToneMapping()` | `:25` |
| `ACESFilmicToneMapping` | 4 | `ACESFilmicToneMapping()` | `:46` |
| `CustomToneMapping` | 5 | stub `{ return color; }` | `:199` |
| `AgXToneMapping` | 6 | `AgXToneMapping()` | `:113` |
| `NeutralToneMapping` | 7 | `NeutralToneMapping()` | `:170` |

Path: `T/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js` (200 lines).

Internal exposure math, verified:

| operator | exposure applied as | source |
|---|---|---|
| `LinearToneMapping` | `saturate(exposure * color)` | `:12` |
| `ACESFilmicToneMapping` | `color *= exposure / 0.6` — **note the /0.6 pre-divide** | `:62` |
| `AgXToneMapping` | `color *= exposure`, then Rec.2020 inset, log2 over `[-12.47393, +4.026069]` EV, 6th-order sigmoid, outset | `:132-143` |
| `NeutralToneMapping` | `color *= exposure` (Khronos PBR Neutral) | `:175` |

### 4.3 Recommended settings for this project

| param | value | unit | tolerance | rationale |
|---|---|---|---|---|
| `renderer.toneMapping` | `AgXToneMapping` | enum | — | best highlight rolloff + neutral hue path for white cotton gi under a strong key; avoids the ACES magenta/orange skew on skin. Fallback `NeutralToneMapping` if the look is judged too desaturated. |
| `renderer.toneMappingExposure` | `1.0` | ratio | ±0.15 | [DERIVED] art-direction default; AgX applies exposure pre-transform (`:135`) so ±0.15 ≈ ±0.2 EV |
| `material.toneMapped` | `true` for all scene materials | bool | exact | `T/src/materials/Material.js:457`. Set `false` only for UI/HUD quads. |
| composer buffer type | `HalfFloatType` | enum | exact | already the `EffectComposer` default: `T/examples/jsm/postprocessing/EffectComposer.js:71` |

### 4.4 r155+ lighting/intensity semantics (verified in this build)

| fact | verification |
|---|---|
| `useLegacyLights` — **gone**, not even a shim | `grep -r useLegacyLights T/src` → 0 files |
| `physicallyCorrectLights` — **gone** | `grep -r physicallyCorrectLights T/src` → 0 files |
| `outputEncoding` / `sRGBEncoding` / `LinearEncoding` — **gone** | `grep -r` → 0 files each |
| light intensity is **not** internally scaled by `PI` | no `* PI` on irradiance in `T/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js:48-50` (`getAmbientLightIrradiance` returns `ambientLightColor` unmodified) |
| point/spot intensity is candela; `SpotLight.power = intensity * PI` | `T/src/lights/SpotLight.js:137,144` |
| `RectAreaLight.power = intensity * width * height * PI` (nits ↔ lumens) | `T/src/lights/RectAreaLight.js:77-87` |
| distance falloff = Frostbite windowed inverse-power, `1/max(d^decay, 0.01)` × `saturate(1 - (d/cutoff)^4)^2` | `T/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js:56-70` |
| `SpotLight` defaults: `distance=0, angle=PI/3, penumbra=0, decay=2` | `T/src/lights/SpotLight.js:39` |
| PBR indirect specular uses split dielectric/metallic multi-scatter, then `mix()` by metalness (r181 energy-conservation change) | `T/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js:596-625` |
| PMREM prefilter uses GGX **VNDF** importance sampling (Heitz 2018) | `T/src/extras/PMREMGenerator.js:61-64` |

Practical consequence: **all directional/ambient/hemisphere intensity values found in pre-r155 tutorials are wrong by a factor of π (≈3.14) — multiply legacy values by π.**

Sources: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733 ; https://github.com/mrdoob/three.js/releases/tag/r155 ; local files above.

---

## 5. Lighting rig for the kata player (numeric target)

Scene scale 1 unit = 1 m, H = 1.75 m. All intensities are r185 (post-r155) unitless irradiance for directional/ambient/hemi.

| light | type | position (units) | position (H-relative) | intensity | unit | tolerance | castShadow |
|---|---|---|---|---|---|---|---|
| KEY | `DirectionalLight` | `(2.60, 4.20, 3.15)` | `(1.49H, 2.40H, 1.80H)` | `3.0` | unitless | ±0.6 | **yes** |
| RIM / back | `DirectionalLight` | `(-2.10, 2.80, -3.85)` | `(-1.20H, 1.60H, -2.20H)` | `1.4` | unitless | ±0.4 | no |
| FILL (bounce) | `DirectionalLight` | `(-2.98, 1.58, 2.28)` | `(-1.70H, 0.90H, 1.30H)` | `0.55` | unitless | ±0.2 | no |
| ambient wrap | `scene.environment` PMREM | — | — | `environmentIntensity = 0.85` | ratio | ±0.25 | — |
| `AmbientLight` | avoid | — | — | `0` (omit) | — | — | — |

| param | value | unit | tolerance | source / rationale |
|---|---|---|---|---|
| key elevation angle above horizon | `45.8` | deg | ±8 | [DERIVED] `atan2(4.20, hypot(2.60,3.15)) = atan(4.20/4.084) = 45.8°`; classic 45° key |
| key azimuth from `-Z` (character front), toward `+X`/left | `39.5` | deg | ±10 | [DERIVED] `atan2(2.60, 3.15)` |
| rim-to-key intensity ratio | `0.47` | ratio | ±0.15 | [DERIVED] keeps gi silhouette readable on dark floor |
| fill-to-key ratio | `0.18` | ratio | ±0.08 | [DERIVED] |
| key color | `0xfff4e8` (≈5200 K) | hex | — | [DERIVED] warm dojo skylight |
| rim color | `0xdfe9ff` (≈7000 K) | hex | — | [DERIVED] cool separation |
| `light.target.position` (KEY) | `(0, 0.50·H, 0)` = `(0, 0.875, 0)` | m | ±0.15 | [DERIVED] aim at hip height, not floor |

`DirectionalLight` API notes: `target` is an `Object3D` and **must be added to the scene** (or have its `matrixWorld` updated) for the direction to take effect (`T/src/lights/DirectionalLight.js:70`). `DirectionalLight.dispose()` exists and forwards to `shadow.dispose()` (`:85`).

---

## 6. Shadows

### 6.1 Shadow map types present in this build
`T/src/constants.js:57-83`

| enum | int | present | status in 0.185.1 |
|---|---|---|---|
| `BasicShadowMap` | 0 | yes | unfiltered, `sampler2D` path |
| `PCFShadowMap` | 1 | yes | **DEFAULT and the only good option.** Vogel-disk 5-tap + IGN rotation on top of hardware `sampler2DShadow` 2×2 → ~20 effective taps |
| `PCFSoftShadowMap` | 2 | constant exists | **DEPRECATED — silently downgraded to `PCFShadowMap` with a console warning** |
| `VSMShadowMap` | 3 | yes | works, but see caveat |

**The single most important shadow gotcha in this release.** `T/src/renderers/webgl/WebGLShadowMap.js:99-104`:

```
if ( this.type === PCFSoftShadowMap ) {
    warn( 'WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.' );
    this.type = PCFShadowMap;
}
```

The mutation happens inside `render()`, so `renderer.shadowMap.type` *changes value at runtime* after the first shadow render. Any code that reads it back will see `1`, not `2`.

`VSMShadowMap` caveat, from the source doc comment at `T/src/constants.js:74-83`: with VSM **all shadow receivers also cast shadows**. On a floor plane that means the floor self-shadows. Combined with VSM light-bleeding this is wrong for a clean single-figure dojo shot. **Use `PCFShadowMap`.**

### 6.2 New in r185: `shadow.radius` finally means something on PCF

`T/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js:94-149`

| detail | value | source line |
|---|---|---|
| taps | 5 Vogel-disk samples | `:137-143` |
| per-tap hardware filtering | 2×2 (`sampler2DShadow` + `LinearFilter`) | `:129` comment |
| effective taps | ~20 | `:130` comment |
| golden angle | `2.399963229728653` rad | `:106` |
| per-pixel rotation | Interleaved Gradient Noise of `gl_FragCoord.xy`, `phi = IGN * PI2` | `:97-101, :135` |
| kernel radius in world | `shadowRadius * (1/shadowMapSize.x)` in shadow-UV space | `:131-132` |
| bias application | `shadowCoord.z += shadowBias` (PCF path has **no** reversed-depth branch, unlike VSM at `:159-167`) | `:122` |
| point-light PCF | same Vogel 5-tap on `samplerCubeShadow`, `texelSize = shadowRadius / shadowMapSize.x` | `:263-330` |

Practical: because per-pixel IGN rotation is applied, a static PCF shadow **dithers/shimmers subtly frame-to-frame at the same camera position**. `TAARenderPass` accumulation resolves this to a clean soft penumbra — a second reason to use TAA (§8).

### 6.3 `LightShadow` parameters — verified defaults
`T/src/lights/LightShadow.js`

| param | default | line | meaning |
|---|---|---|---|
| `camera` | per-light | `:32` | `OrthographicCamera(-5,5,5,-5,0.5,500)` for directional (`T/src/lights/DirectionalLightShadow.js:16`) |
| `intensity` | `1` | `:41` | shadow darkness; `mix(1.0, shadow, shadowIntensity)` in GLSL |
| `bias` | `0` | `:53` | constant depth offset, shadow-clip units |
| `biasNode` | `null` | `:63` | WebGPU/TSL only |
| `normalBias` | `0` | `:74` | world-space offset along the surface normal |
| `radius` | `1` | `:87` | PCF Vogel-disk radius in texels; VSM blur radius |
| `blurSamples` | `8` | `:95` | **VSM only** (`WebGLShadowMap.js:379-382` sets `VSM_SAMPLES`); ignored by PCF |
| `mapSize` | `Vector2(512,512)` | `:104` | clamped to `capabilities.maxTextureSize` at `WebGLShadowMap.js:180-198` |
| `autoUpdate` | `true` | `:148` | |
| `needsUpdate` | `false` | `:158` | |

### 6.4 Contact-shadow recipe: one figure on a wood floor

Texel math (exact): for `DirectionalLightShadow` with symmetric ortho half-extent `S` metres and `mapSize = N`, world texel size `t = 2S/N`. PCF penumbra width `≈ 2·radius·t`.

Assumed embusen bounding box for Heian-class kata: **5.5 m (X) × 4.0 m (Z)**, marked [DERIVED] — replace with the real figure from the kata research doc.

| param | value | unit | tolerance | derivation |
|---|---|---|---|---|
| `shadow.mapSize` | `2048 × 2048` | px | must be power of 2 | quality/VRAM knee for one caster; 16 MB depth |
| Mode A: fixed frustum half-extent `S_fixed` | `3.60` | m | ±0.2 | [DERIVED] `0.5·hypot(5.5,4.0) + 0.2` |
| Mode A texel `t` | `3.52` | mm | — | `2·3.60/2048` |
| Mode A `shadow.radius` | `3.0` | texels | ±1.0 | penumbra ≈ `2·3·3.52 = 21` mm |
| **Mode B (recommended): per-frame fitted frustum** half-extent `S_fit` | `0.75·H = 1.31` | m | ±0.15 | [DERIVED] fits a 1-figure AABB incl. extended limbs |
| Mode B texel `t` | `1.28` | mm | — | `2·1.31/2048` |
| Mode B `shadow.radius` | `4.0` | texels | ±1.5 | penumbra ≈ `10.2` mm — reads as a true contact shadow |
| `shadow.camera.near` | `0.10` | m | ±0.05 | keep tight; drives depth precision |
| `shadow.camera.far` | `12.0` | m | ±3 | ≥ light distance + `S` |
| `shadow.bias` | `0.0` | shadow-clip | keep 0 | with `normalBias` set, constant bias causes peter-panning |
| `shadow.normalBias` | `0.015` | m | ±0.008 | [DERIVED] ≈ 12× texel `t` at Mode B; must exceed `t·sqrt(2)/tan(grazing)` |
| `shadow.intensity` | `0.92` | ratio | ±0.06 | leave a touch of light in the core so IBL fill reads |
| `mesh.material.shadowSide` | leave `null` | — | — | `T/src/materials/Material.js:341`; for a closed gi mesh the default cull is correct |
| gi/skin `castShadow` | `true` | bool | — | |
| floor `castShadow` | **`false`** | bool | exact | prevents floor-vs-floor acne |
| floor `receiveShadow` | `true` | bool | exact | |

**Mode B per-frame refit** (recommended). Each frame, compute the skinned figure's world AABB and re-aim the ortho box:

1. `skinnedMesh.computeBoundingBox()` — recomputes from the *current* skinned pose (`T/src/objects/SkinnedMesh.js:107-130`, uses `applyBoneTransform`). Cost is O(vertices) on the CPU; at ≤8 k verts this is fine at 60 fps, but prefer to derive the AABB from ~24 bone world positions inflated by a per-bone radius — ~50× cheaper. [DERIVED]
2. Set `shadow.camera.left/right/bottom/top = ±S_fit`, then `shadow.camera.updateProjectionMatrix()`.
3. Snap the shadow-camera position to a texel grid (`pos = round(pos / t) * t` in light space) to kill shadow swimming during orbit. [DERIVED — three.js does not do this for you]

**Second layer: screen-space contact occlusion.** PCF alone cannot produce the dark crease where the gi meets the floor and where the trailing foot meets the heel. Add `GTAOPass` (§8) with `radius ≈ 0.30 m`. This is the single biggest "AAA vs hobby" delta for this scene.

### 6.5 PCSS / CSM availability in this build

| helper | present locally | path |
|---|---|---|
| PCSS (percentage-closer soft shadows) | **NO** | `grep -ril "pcss\|percentage.closer.soft" T/examples/jsm T/src` → 0 files |
| `CSM` (cascaded shadow maps, WebGL) | yes | `T/examples/jsm/csm/CSM.js` |
| `CSMFrustum`, `CSMHelper`, `CSMShader` | yes | `T/examples/jsm/csm/` |
| `CSMShadowNode` (WebGPU) | yes | `T/examples/jsm/csm/CSMShadowNode.js` |
| `TileShadowNode` (WebGPU) | yes | `T/examples/jsm/tsl/shadows/TileShadowNode.js` |
| `ShadowMapViewer` (debug) | yes | `T/examples/jsm/utils/ShadowMapViewer.js` |
| `ProgressiveLightMap` (bake AO/GI to a lightmap) | yes | `T/examples/jsm/misc/ProgressiveLightMap.js` |

**CSM is NOT wanted here.** `CSM.js` defaults (`T/examples/jsm/csm/CSM.js:61-139`): `cascades=3`, `maxFar=100000`, `mode='practical'`, `shadowMapSize=2048`, `shadowBias=0.000001`, `lightMargin=200`. CSM exists for kilometre-scale view distances. Our subject occupies a 5.5 m box; one tightly-fitted cascade beats three loose ones, and `CSM.setupMaterial()` patches material shaders (a WebGPU-portability landmine).

The threejs.org PCSS example lives in `examples/` (HTML), which npm does **not** ship — `T/package.json` `files: ["build","examples/jsm","LICENSE","package.json","README.md","src"]`. If PCSS is ever wanted it must be hand-ported.

Sources: `T/src/renderers/webgl/WebGLShadowMap.js`; `T/src/lights/LightShadow.js`; `T/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js`; https://github.com/mrdoob/three.js/wiki/Migration-Guide ; https://threejs.org/examples/webgl_shadowmap_pcss.html

---

## 7. IBL with zero external HDR downloads

### 7.1 `PMREMGenerator` — exact API in this build
`T/src/extras/PMREMGenerator.js` (WebGL). A separate WebGPU copy exists at `T/src/renderers/common/extras/PMREMGenerator.js`.

| method | signature | line |
|---|---|---|
| ctor | `new PMREMGenerator( renderer )` | `:73` |
| from a scene | `fromScene( scene, sigma = 0, near = 0.1, far = 100, options = {} )` → `WebGLRenderTarget` | `:109` |
| — `options.size` | `256` (default) | `:112` |
| — `options.position` | `Vector3(0,0,0)` — cube-camera position | `:113` |
| from equirect | `fromEquirectangular( equirectangular, renderTarget = null )` | `:153` |
| from cubemap | `fromCubemap( cubemap, renderTarget = null )` | `:169` |
| precompile | `compileCubemapShader()` / `compileEquirectangularShader()` | `:179` / `:194` |
| free | `dispose()` | `:210` |

Prefilter quality: GGX VNDF importance sampling per `T/src/extras/PMREMGenerator.js:61-64`. This is materially better than the older Gaussian-blur PMREM and matches the GGX BRDF in `lights_physical_pars_fragment.glsl.js`.

### 7.2 Procedural environment sources shipped locally (no network)
`T/examples/jsm/environments/` — exactly three files:

| class | import path | what it is | source |
|---|---|---|---|
| `RoomEnvironment` | `three/addons/environments/RoomEnvironment.js` | box room, `BackSide` `MeshStandardMaterial`, 1 `PointLight(0xffffff, 900, 28, 2)` at `(0.418, 16.199, 0.300)`, `InstancedMesh` of 6 boxes + emissive area strips; `this.position.y = -3.5` | `RoomEnvironment.js:34-56` |
| `ColorEnvironment` | `three/addons/environments/ColorEnvironment.js` | `SphereGeometry(1,16,16)`, `BackSide` `MeshBasicMaterial(color)` — uniform ambient | `ColorEnvironment.js:29-42` |
| `DebugEnvironment` | `three/addons/environments/DebugEnvironment.js` | primary-colour debug box | file present |

All three are plain `Scene` subclasses with a `dispose()`. **Nothing is fetched from the network.** They are the correct "no external HDR" answer.

### 7.3 Recommended dojo IBL build (procedural, deterministic)

```
// build once, at boot
const pmrem = new PMREMGenerator( renderer );
pmrem.compileCubemapShader();                       // optional warm-up
const dojo = buildDojoEnvScene();                   // our own Scene, see table
const rt   = pmrem.fromScene( dojo, 0.04, 0.1, 40, { size: 512 } );
scene.environment = rt.texture;
pmrem.dispose();                                    // generator only
dojo.dispose?.();
// keep `rt` — dispose it on teardown: rt.dispose()
```

| param | value | unit | tolerance | rationale |
|---|---|---|---|---|
| `options.size` | `512` | px per cube face | 256 / 512 / 1024 | 256 is the documented sweet spot (`:105`); 512 buys visibly cleaner specular on the gi and skin for ~4× the one-time cost |
| `sigma` | `0.04` | radians | 0–0.10 | small pre-blur removes the hard edges of our procedural emitter quads without flattening the room gradient |
| `near` / `far` | `0.1` / `40` | m | — | must enclose the whole env scene |
| `options.position` | `(0, 0.55·H, 0)` = `(0, 0.9625, 0)` | m | ±0.2 | capture the cubemap at the karateka's chest, not at the floor |
| `scene.environmentIntensity` | `0.85` | ratio | ±0.25 | `T/src/scenes/Scene.js:95` |
| `scene.environmentRotation` | `Euler(0, -0.35, 0)` | rad | ±0.5 on Y | `T/src/scenes/Scene.js:104`; rotate the brightest window off-axis for asymmetric spec |
| `scene.background` | `Color(0x0e0f12)` or a separate gradient, **not** the PMREM | — | — | showing the crude procedural room as the visible backdrop looks cheap |
| `scene.backgroundBlurriness` | `0.0` | ratio | 0–1 | `T/src/scenes/Scene.js:69` — only relevant if a texture background is used |
| `scene.backgroundIntensity` | `1.0` | ratio | ±0.4 | `T/src/scenes/Scene.js:77` |
| `scene.backgroundRotation` | `Euler()` | rad | — | `T/src/scenes/Scene.js:86` |

Env scene content to author ourselves (all procedural, all `MeshBasicMaterial`/emissive so PMREM captures them directly, [DERIVED]):

| element | geometry | size (m) | emissive/colour | purpose |
|---|---|---|---|---|
| shell | `BoxGeometry`, `side: BackSide` | `14 × 7 × 14` | `0x2a2723` roughness 1 | dojo interior value |
| upper window band, camera-left | `PlaneGeometry` | `6.0 × 1.6` at `y = 3.6`, `x = +6.9` | `0xfff2e0`, emissiveIntensity `6.0` | KEY-matching soft box |
| upper window band, camera-right | `PlaneGeometry` | `3.0 × 1.2` at `y = 3.4`, `x = -6.9` | `0xdfe9ff`, emissiveIntensity `2.2` | cool fill |
| ceiling bounce | `PlaneGeometry` | `10 × 10` at `y = 6.9` | `0xf2ece2`, emissiveIntensity `1.1` | top-down wrap |
| floor bounce | `PlaneGeometry` | `12 × 12` at `y = 0.02` | wood albedo `0x8a5f38` | warm underside bounce on the gi and jaw |

### 7.4 `scene.environmentIntensity` vs `material.envMapIntensity` — the trap

| behaviour | verification |
|---|---|
| `scene.environmentIntensity` and `scene.environmentRotation` both exist | `T/src/scenes/Scene.js:95, :104` |
| the renderer only routes `scene.environment` into `MeshStandardMaterial` / `MeshLambertMaterial` / `MeshPhongMaterial` | `T/src/renderers/WebGLRenderer.js:2341` |
| `material.envMap` **overrides** `scene.environment` for that material | `WebGLRenderer.js:2344` `environments.get( material.envMap \|\| environment, usePMREM )` |
| once `material.envMap` is set, only `material.envMapIntensity` applies | `T/src/renderers/webgl/WebGLMaterials.js:58,74,407` |
| `material.envMapRotation` is composed with the scene rotation | `WebGLMaterials.js:238-250` |

Rule: **set `scene.environment` and leave every `material.envMap` at `null`.** Then `scene.environmentIntensity` is one global knob. `material.envMapIntensity` still exists as a per-material multiplier and does apply.

Source: `T/src/scenes/Scene.js`; `T/src/renderers/webgl/WebGLMaterials.js`; https://threejs.org/docs/pages/RoomEnvironment.html

---

## 8. Post-processing — full local inventory and the correct order

### 8.1 Every file in `T/examples/jsm/postprocessing/` (30 files, verified `ls`)

`AfterimagePass.js`, `BloomPass.js`, `BokehPass.js`, `ClearPass.js`, `CubeTexturePass.js`, `DotScreenPass.js`, `EffectComposer.js`, `FXAAPass.js`, `FilmPass.js`, `GTAOPass.js`, `GlitchPass.js`, `HalftonePass.js`, `LUTPass.js`, `MaskPass.js`, `OutlinePass.js`, `OutputPass.js`, `Pass.js`, `RenderPass.js`, `RenderPixelatedPass.js`, `RenderTransitionPass.js`, `SAOPass.js`, `SMAAPass.js`, `SSAARenderPass.js`, `SSAOPass.js`, `SSRPass.js`, `SavePass.js`, `ShaderPass.js`, `TAARenderPass.js`, `TexturePass.js`, `UnrealBloomPass.js`

### 8.2 Every file in `T/examples/jsm/shaders/` (52 files, verified `ls`)

`ACESFilmicToneMappingShader.js`, `AfterimageShader.js`, `BasicShader.js`, `BleachBypassShader.js`, `BlendShader.js`, `BokehShader.js`, `BokehShader2.js`, `BrightnessContrastShader.js`, `ColorCorrectionShader.js`, `ColorifyShader.js`, `ConvolutionShader.js`, `CopyShader.js`, `DOFMipMapShader.js`, `DepthLimitedBlurShader.js`, `DigitalGlitch.js`, `DotScreenShader.js`, `ExposureShader.js`, `FXAAShader.js`, `FilmShader.js`, `FocusShader.js`, `FreiChenShader.js`, `GTAOShader.js`, `GammaCorrectionShader.js`, `HalftoneShader.js`, `HorizontalBlurShader.js`, `HorizontalTiltShiftShader.js`, `HueSaturationShader.js`, `KaleidoShader.js`, `LuminosityHighPassShader.js`, `LuminosityShader.js`, `MirrorShader.js`, `NormalMapShader.js`, `OutputShader.js`, `PoissonDenoiseShader.js`, `RGBShiftShader.js`, `SAOShader.js`, `SMAAShader.js`, `SSAOShader.js`, `SSRShader.js`, `SepiaShader.js`, `SobelOperatorShader.js`, `SubsurfaceScatteringShader.js`, `TechnicolorShader.js`, `ToonShader.js`, `TriangleBlurShader.js`, `UnpackDepthRGBAShader.js`, `VelocityShader.js`, `VerticalBlurShader.js`, `VerticalTiltShiftShader.js`, `VignetteShader.js`, `VolumeShader.js`, `WaterRefractionShader.js`

Category map for what we care about:

| need | available passes | verdict |
|---|---|---|
| bloom | `UnrealBloomPass` (mip-chain, 5 mips, HalfFloat), `BloomPass` (legacy 2-pass gaussian) | use `UnrealBloomPass` |
| SMAA | `SMAAPass` | **yes** — area/search LUTs are embedded base64, no network fetch (`SMAAPass.js:54` `this._getAreaTexture()`) |
| TAA | `TAARenderPass` (accumulation, no reprojection) | **yes**, for paused/scrubbed frames |
| SSAA | `SSAARenderPass` (`sampleLevel` 0–5 → 1/2/4/8/16/32 samples) | offline capture only |
| FXAA | `FXAAPass` | fallback only; must run **after** `OutputPass` (needs sRGB) |
| AO | `GTAOPass` (horizon-based, Poisson denoise), `SSAOPass`, `SAOPass` | **`GTAOPass`** — best quality of the three |
| SSR | `SSRPass` | skip — wood floor reflection is better done with a low-roughness `MeshPhysicalMaterial` + IBL |
| DOF / bokeh | `BokehPass` | optional, cinematic mode only |
| grade | `LUTPass` (`Data3DTexture`) | optional final grade |
| output | `OutputPass` | **mandatory** |

### 8.3 Exact constructor signatures (read from source)

| pass | import path | signature | source |
|---|---|---|---|
| `EffectComposer` | `three/addons/postprocessing/EffectComposer.js` | `new EffectComposer( renderer, renderTarget? )` — default RT is `HalfFloatType` at `w*pixelRatio × h*pixelRatio` | `EffectComposer.js:52, :71` |
| `RenderPass` | `.../RenderPass.js` | `new RenderPass( scene, camera, overrideMaterial = null, clearColor = null, clearAlpha = null )` | `RenderPass.js:30` |
| `GTAOPass` | `.../GTAOPass.js` | `new GTAOPass( scene, camera, width = 512, height = 512, parameters?, aoParameters?, pdParameters? )` | `GTAOPass.js:56` |
| `UnrealBloomPass` | `.../UnrealBloomPass.js` | `new UnrealBloomPass( resolution, strength = 1, radius, threshold )` — `resolution` is a `Vector2`, default `(256,256)` | `UnrealBloomPass.js:46, :78` |
| `BokehPass` | `.../BokehPass.js` | `new BokehPass( scene, camera, { focus = 1.0, aperture = 0.025, maxblur = 1.0 } )` | `BokehPass.js:39, :28-30` |
| `TAARenderPass` | `.../TAARenderPass.js` | `new TAARenderPass( scene, camera, clearColor = 0x000000, clearAlpha = 0 )` | `TAARenderPass.js:35` |
| `SSAARenderPass` | `.../SSAARenderPass.js` | `new SSAARenderPass( scene, camera, clearColor = 0x000000, clearAlpha = 0 )` | `SSAARenderPass.js:36` |
| `SMAAPass` | `.../SMAAPass.js` | `new SMAAPass()` — **no arguments** (auto-sizes via `setSize`) | `SMAAPass.js:30` |
| `FXAAPass` | `.../FXAAPass.js` | `new FXAAPass()` | `FXAAPass.js:20` |
| `OutputPass` | `.../OutputPass.js` | `new OutputPass()` | `OutputPass.js:38` |
| `ShaderPass` | `.../ShaderPass.js` | `new ShaderPass( shader, textureID = 'tDiffuse' )` | `ShaderPass.js:30` |
| `LUTPass` | `.../LUTPass.js` | `new LUTPass( { lut: Data3DTexture, intensity: number } = {} )` | `LUTPass.js:77` |
| `SSAOPass` | `.../SSAOPass.js` | `new SSAOPass( scene, camera, width = 512, height = 512, kernelSize = 32 )` | `SSAOPass.js:55` |
| `SAOPass` | `.../SAOPass.js` | `new SAOPass( scene, camera, resolution = new Vector2(256,256) )` | `SAOPass.js:47` |
| `SSRPass` | `.../SSRPass.js` | `new SSRPass({ renderer, scene, camera, width=512, height=512, selects=null, bouncing=false, groundReflector=null })` — **object arg** | `SSRPass.js:46` |

### 8.4 THE PASS ORDER (this project)

Hard constraints from the source, not opinion:
- `OutputPass` performs tone mapping + sRGB encode (`OutputPass.js:96-113`), so everything that must operate in **linear** light goes **before** it.
- `SMAAPass` operates in `linear-srgb` → **before** `OutputPass` (`T/examples/jsm/postprocessing/SMAAPass.js` + https://threejs.org/docs/pages/SMAAPass.html).
- `FXAAPass` needs sRGB input → **after** `OutputPass` (`OutputPass.js:20-21` doc comment).
- `GTAOPass` multiplies AO into the lit linear buffer → **before** bloom and before `OutputPass`.
- Bloom must see pre-tonemap HDR values → **before** `OutputPass`.

| # | pass | color space in | required? | notes |
|---|---|---|---|---|
| 1 | `TAARenderPass( scene, camera )` **or** `RenderPass( scene, camera )` | — | yes (one of them) | `TAARenderPass` when the timeline is paused/scrubbing; plain `RenderPass` while playing |
| 2 | `GTAOPass( scene, camera, w, h, params, aoParams, pdParams )` | linear HDR | yes | AO multiply must happen on linear radiance |
| 3 | `BokehPass( scene, camera, {...} )` | linear HDR | optional (cinematic) | reads its own depth pass; must precede bloom or bokeh disks won't bloom |
| 4 | `UnrealBloomPass( new Vector2(w,h), strength, radius, threshold )` | linear HDR | yes | must see pre-tonemap values |
| 5 | `SMAAPass()` | linear-srgb | yes | **before** `OutputPass` — SMAA operates in linear-srgb |
| 6 | `OutputPass()` | linear-srgb → sRGB | **mandatory, last of the core chain** | applies `renderer.toneMapping` + `outputColorSpace` |
| 7 | `LUTPass({ lut, intensity })` | sRGB | optional | final grade, after `OutputPass` |
| 7' | `FXAAPass()` | sRGB | only if replacing SMAA | **after** `OutputPass` — FXAA needs sRGB input |

Compact form:

```
RenderPass|TAARenderPass -> GTAOPass -> [BokehPass] -> UnrealBloomPass
  -> SMAAPass -> OutputPass -> [LUTPass]
```

`SMAAPass` and `FXAAPass` are mutually exclusive and sit on **opposite sides** of `OutputPass`. Never add both.

### 8.5 Numeric pass settings

`UnrealBloomPass` (`T/examples/jsm/postprocessing/UnrealBloomPass.js`)

| param | value | unit | tolerance | source |
|---|---|---|---|---|
| `resolution` | `Vector2(w, h)` (canvas px) | px | — | ctor arg; default `(256,256)` at `:78` — passing canvas size is required for correct mip spacing |
| `strength` | `0.22` | ratio | ±0.10 | [DERIVED] subtle; a dojo is not a sci-fi scene |
| `radius` | `0.55` | ratio | ±0.20 | [DERIVED] |
| `threshold` | `0.92` | luminance | ±0.06 | [DERIVED] only the window highlight + gi specular should bloom |
| internal mips | `5` | count | fixed | `:101` `this.nMips = 5` |
| internal RT type | `HalfFloatType` | enum | fixed | `:105,111,118` |

`GTAOPass` — defaults verified from `GTAOShader.uniforms` (`T/examples/jsm/shaders/GTAOShader.js:39-54`) and `GTAOPass` ctor (`:59-83`)

| param | shipped default | recommended | unit | tolerance | source line |
|---|---|---|---|---|---|
| `aoParameters.radius` | `0.25` | `0.30` | m (world) | ±0.10 | `GTAOShader.js:48` |
| `aoParameters.distanceExponent` | `1.0` | `1.0` | exp | ±0.5 | `:49` |
| `aoParameters.thickness` | `1.0` | `1.0` | m | ±0.5 | `:50` |
| `aoParameters.distanceFallOff` | `1.0` | `1.0` | ratio | ±0.5 | `:51` |
| `aoParameters.scale` | `1.0` | `1.15` | ratio | ±0.25 | `:52` |
| `aoParameters.samples` | `SAMPLES = 16` | `24` | count | 8–32 | `:30`; shader derives `DIRECTIONS = SAMPLES < 30 ? 3 : 5`, `STEPS = ceil(SAMPLES/DIRECTIONS)` (`:202-203`) |
| `aoParameters.screenSpaceRadius` | `false` | `false` | bool | — | `GTAOPass.js:414` — keep world-space; our camera distance range is bounded |
| `blendIntensity` | `1.0` | `0.85` | ratio | ±0.15 | `GTAOPass.js:114` |
| `pdParameters.lumaPhi` | `10` | `10` | — | ±4 | `GTAOPass.js:175` |
| `pdParameters.depthPhi` | `2` | `2` | — | ±1 | `:176` |
| `pdParameters.normalPhi` | `3` | `3` | — | ±1 | `:177` |
| `pdParameters.radius` | `8` | `6` | px | ±3 | `:178` |
| `pdSamples` | `16` | `16` | count | 8–24 | `:83` |
| `pdRings` | `2` | `2` | count | — | `:67` |
| `pdRadiusExponent` | `2` | `2` | exp | — | `:75` |
| `output` | `GTAOPass.OUTPUT.Default = 0` | `0` | enum | — | `:717-725`; debug values: `Off:-1, Default:0, Diffuse:1, Depth:2, Normal:3, AO:4, Denoise:5` |

`GTAOPass` internals worth knowing: it renders its own normal G-buffer with `MeshNormalMaterial` (`GTAOPass.js:106-107`, `:505` clear `0x7777ff`) into a `HalfFloatType` + `NearestFilter` RT (`:317-322`), and owns a `DepthTexture` unless you feed one via `setGBuffer(depthTexture, normalTexture)` (`:304`). **`MeshNormalMaterial` respects `USE_SKINNING`, so the skinned figure's normals are correct — but any custom `ShaderMaterial` will render wrong normals here.** Also call `setSceneClipBox( box )` (`:351`) with the embusen AABB to bound AO to the stage.

`TAARenderPass` (`T/examples/jsm/postprocessing/TAARenderPass.js`)

| param | value | unit | tolerance | source |
|---|---|---|---|---|
| `sampleLevel` | `0` (default) | level | fixed for TAA | `:45` — TAA ignores it beyond `numSamplesPerFrame = 2^sampleLevel` per `update` (`:131`) |
| `accumulate` | `false` (default) → set `true` when paused | bool | exact | `:54` |
| jitter table used | `_JitterVectors[5]` = **32 samples** | count | fixed | `:93`, table at `:211` |
| frames to full convergence | `32` (at `sampleLevel = 0`) | frames | exact | `:125-162` |
| reprojection | **none** | — | — | `:11` doc: accumulates only when the scene is static |

Player integration rule: set `taaPass.accumulate = false` while `isPlaying`, and `= true` on the frame the user pauses or releases the scrub handle. Any camera or bone change must reset accumulation — the pass does this itself by returning `accumulateIndex = -1` when `accumulate === false` (`:84-88`), so simply toggling it off/on for one frame is a valid reset.

`SSAARenderPass` for offline still capture: `sampleLevel = 5` → 32 samples, `unbiased = true` (`:61, :71`). Use only in the capture harness; ~32× cost.

`BokehPass` uniform defaults (`T/examples/jsm/shaders/BokehShader.js:24-31`): `focus 1.0`, `aspect 1.0`, `aperture 0.025`, `maxblur 0.01`, `nearClip 1.0`, `farClip 1000.0`. **Note the `maxblur` mismatch: `BokehPass` ctor defaults `maxblur` to `1.0` (`BokehPass.js:30`) while the shader default is `0.01`.** Always pass it explicitly. Recommended cinematic values [DERIVED]: `focus = distance(camera, target)`, `aperture = 0.0018`, `maxblur = 0.006`.

Composer housekeeping and full method list (`T/examples/jsm/postprocessing/EffectComposer.js`): `swapBuffers()` `:136`, `addPass(pass)` `:149`, `insertPass(pass,index)` `:162`, `removePass(pass)` `:174`, `isLastEnabledPass(passIndex)` `:192`, `render(deltaTime)` `:214`, `reset(renderTarget?)` `:286`, `setSize(width,height)` `:317`, `setPixelRatio(pixelRatio)` `:342`, `dispose()` `:354`. Both `setSize` **and** `setPixelRatio` must be called on resize/DPI change — `_pixelRatio` is cached at construction (`:61`) and only re-read by `reset()` (`:291`).

Sources: local files above; https://threejs.org/docs/pages/SMAAPass.html ; https://threejs.org/docs/pages/TAARenderPass.html ; https://threejs.org/docs/pages/GTAOPass.html ; https://threejs.org/docs/pages/OutputPass.html

---

## 9. SkinnedMesh — building a rig in code

### 9.1 API surface, verified

| item | signature / value | source |
|---|---|---|
| `Bone` | `new Bone()` — no args; plain `Object3D` with `isBone = true`, `type = 'Bone'` | `T/src/objects/Bone.js:22-35` |
| `Skeleton` | `new Skeleton( bones = [], boneInverses = [] )`; calls `init()` in ctor | `T/src/objects/Skeleton.js:46, :82` |
| `Skeleton.init()` | allocates `boneMatrices = new Float32Array( bones.length * 16 )`; if `boneInverses.length === 0` → `calculateInverses()` | `:91-120` |
| `Skeleton.calculateInverses()` | `boneInverses[i] = bones[i].matrixWorld.clone().invert()` | `:130-146` |
| `Skeleton.pose()` | restores rest pose from `boneInverses`, then decomposes into `position/quaternion/scale` | `:153-190` |
| `Skeleton.update()` | fills `boneMatrices`, flags `boneTexture.needsUpdate` | `:199` |
| `Skeleton.computeBoneTexture()` | `size = ceil(sqrt(bones.length * 4))` → next pow2, `DataTexture`, **4 texels per matrix** | `:243-263` |
| `Skeleton.dispose()` | disposes `boneTexture` | `:298-306` |
| `SkinnedMesh` | `new SkinnedMesh( geometry, material )` | `T/src/objects/SkinnedMesh.js:46` |
| `SkinnedMesh.bind( skeleton, bindMatrix? )` | if `bindMatrix` omitted → `updateMatrixWorld(true)`, uses `this.matrixWorld`, and calls `skeleton.calculateInverses()` | `:230-246` |
| `SkinnedMesh.bindMode` | `AttachedBindMode` (`'attached'`) default; `DetachedBindMode` = `'detached'` | `:69`; `T/src/constants.js:490,499` |
| `SkinnedMesh.bindMatrix` / `bindMatrixInverse` | `Matrix4` | `:76, :83` |
| `SkinnedMesh.normalizeSkinWeights()` | divides each `Vector4` by its **`manhattanLength()`** (L1, i.e. sum) — falls back to `(1,0,0,0)` if the sum is 0 | `:262-288` |
| `SkinnedMesh.pose()` | forwards to `skeleton.pose()` | `:252` |
| `SkinnedMesh.applyBoneTransform( index, target )` | CPU skinning of one vertex | `:319` |
| `SkinnedMesh.computeBoundingBox()` / `computeBoundingSphere()` | CPU-skins **every** vertex; `boundingBox`/`boundingSphere` start `null` | `:107-160` |
| `SkeletonHelper` | `T/src/helpers/SkeletonHelper.js` | present |
| `SkeletonUtils` | `retarget`, `retargetClip`, `clone`, `getBoneByName`, `getBones`, `getHelperFromSkeleton`, `parallelTraverse` | `T/examples/jsm/utils/SkeletonUtils.js:492` |
| `CCDIKSolver` | `T/examples/jsm/animation/CCDIKSolver.js` | present — usable for foot/hand IK snapping |

### 9.2 Skin attribute rules — HARD constraints

| param | value | unit | tolerance | source |
|---|---|---|---|---|
| bones per vertex | **exactly 4** (`vec4` attributes) | count | hard limit | `skinbase_vertex.glsl.js:4-7` reads `skinIndex.x/.y/.z/.w`; `skinning_vertex.glsl.js:7-10` uses `skinWeight.x/.y/.z/.w` |
| `skinIndex` itemSize | `4` | count | exact | as above |
| `skinWeight` itemSize | `4` | count | exact | as above |
| `skinIndex` buffer type | `Uint16BufferAttribute` (or `Uint8` ≤255 bones) | — | — | index is cast via `getBoneMatrix(float i)` → `int(i)*4` |
| `skinIndex` normalized flag | **`false`** | bool | exact | it is an index, not a normalized value — `normalized: true` silently destroys it |
| `skinWeight` buffer type | `Float32BufferAttribute` | — | — | recommended; `Uint8` + `normalized: true` also works but loses precision |
| `skinWeight` sum per vertex | `1.0` | ratio | ±1e-4 | enforce by calling `normalizeSkinWeights()` once after authoring |
| normalization metric used by three | **L1 (`manhattanLength`)** not L2 | — | exact | `SkinnedMesh.js:270` |
| unused slots | `skinIndex = 0`, `skinWeight = 0` | — | exact | a 0 weight on bone 0 is harmless |
| max bones | **no engine limit** — no `maxBones`/`MAX_BONES` anywhere | count | — | `grep -r "maxBones\|MAX_BONES" T/src` → 0 hits; bone matrices always go through a float texture |
| bone matrix texture layout | 4 RGBA texels per bone; side = next-pow2 of `sqrt(bones*4)` | px | exact | `Skeleton.js:243-263` |
| bone-count budget for our rig | `26–34` | count | ±6 | [DERIVED] spine×4, neck, head, clavicle×2, shoulder/elbow/wrist ×2, hip/knee/ankle/toe ×2 = 24 core + optional hand/finger stubs |

Skinning GLSL, verbatim structure (`T/src/renderers/shaders/ShaderChunk/skinning_vertex.glsl.js`):
```
vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
skinned  = boneMatX * skinVertex * skinWeight.x + ... + boneMatW * skinVertex * skinWeight.w;
transformed = ( bindMatrixInverse * skinned ).xyz;
```
Linear blend skinning (LBS). No dual-quaternion option. **Expect candy-wrapper collapse at ≥90° twists** — the karate elbow/forearm twist during a reverse punch and the wrist rotation in *uraken* are exactly where this shows. Mitigation: insert a dedicated twist/roll bone between elbow and wrist and distribute the twist 0.5/0.5. [DERIVED]

### 9.3 GPU skinning — anything special?

No. It is always on and always GPU:

| fact | source |
|---|---|
| bone matrices are delivered as `uniform highp sampler2D boneTexture` with `texelFetch` — **no uniform-array path, no bone-count cap** | `T/src/renderers/shaders/ShaderChunk/skinning_pars_vertex.glsl.js:8-22` |
| `USE_SKINNING` define is driven automatically from `object.isSkinnedMesh` | `T/src/renderers/WebGLRenderer.js:2297` (`materialProperties.skinning`) |
| you do **not** call `computeBoneTexture()` yourself | `Skeleton.update()` handles it; called from the renderer |
| `MeshDepthMaterial` / `MeshNormalMaterial` / `MeshDistanceMaterial` also honour skinning | required for correct shadow + GTAO normals |

**Frustum-culling caveat (real bug source).** `SkinnedMesh.boundingSphere` starts `null` and is computed **once, lazily**, from whatever pose is current (`SkinnedMesh.js:142-160, :187`). A figure that later extends a leg into *kekomi* can pop out of frustum. Fix one of:
- `skinnedMesh.frustumCulled = false` (cheapest; we render exactly one character), **or**
- recompute `computeBoundingSphere()` on a keypose cadence (e.g. every 10 frames).

Recommendation: `frustumCulled = false`. One draw call.

### 9.4 Canonical build order (must be in this order)

1. Create `Bone` hierarchy; set `bone.position` (and only `position`) to the **rest-pose** offsets; leave `quaternion` identity.
2. `root.updateMatrixWorld( true )`.
3. `const skeleton = new Skeleton( bonesArrayInIndexOrder )` — index order must match `skinIndex` values. `boneInverses` are auto-computed from the current world matrices, i.e. **the rest pose is captured here**.
4. Build `BufferGeometry` in the same rest pose; add `skinIndex` (`Uint16`, itemSize 4, `normalized: false`) and `skinWeight` (`Float32`, itemSize 4).
5. `const mesh = new SkinnedMesh( geometry, material )`; `mesh.add( rootBone )`.
6. `mesh.bind( skeleton )` — omit `bindMatrix` so it derives from `mesh.matrixWorld`.
7. `mesh.normalizeSkinWeights()`.
8. `mesh.frustumCulled = false`; `mesh.castShadow = true`.

Sources: `T/src/objects/{SkinnedMesh,Skeleton,Bone}.js`; `T/src/renderers/shaders/ShaderChunk/skin*.glsl.js`; https://threejs.org/docs/pages/SkinnedMesh.html ; https://deepwiki.com/mrdoob/three.js/5.2-object-manipulation

---

## 10. Animation: `AnimationMixer` vs direct quaternion writes

### 10.1 Signatures, verified

| item | signature | source |
|---|---|---|
| `AnimationClip` | `new AnimationClip( name = '', duration = -1, tracks = [], blendMode = NormalAnimationBlendMode )` | `T/src/animation/AnimationClip.js:31` |
| — `duration = -1` | auto-computed by `resetDuration()` | `:302` |
| — methods | `resetDuration()`, `trim()`, `validate()`, `optimize()`, `clone()`, `toJSON()`, static `parse/toJSON/findByName` | `:302-406` |
| `KeyframeTrack` | `new KeyframeTrack( name, times, values, interpolation? )` | `T/src/animation/KeyframeTrack.js:29` |
| `QuaternionKeyframeTrack` | `new QuaternionKeyframeTrack( name, times, values, interpolation? )`; values are flat `[x,y,z,w, ...]`, valueSize 4 | `T/src/animation/tracks/QuaternionKeyframeTrack.js:19` |
| `VectorKeyframeTrack` | same shape, valueSize inferred = `values.length / times.length` | `KeyframeTrack.js:277` |
| `NumberKeyframeTrack`, `ColorKeyframeTrack`, `BooleanKeyframeTrack`, `StringKeyframeTrack` | present | `T/src/animation/tracks/` |
| `AnimationMixer` | `new AnimationMixer( root )`; props `time = 0`, `timeScale = 1` | `T/src/animation/AnimationMixer.js:23, :37, :49` |
| — methods | `clipAction( clip, optionalRoot?, blendMode? )`, `existingAction`, `stopAllAction`, `update( dt )`, `setTime( t )`, `getRoot`, `uncacheClip/Root/Action` | `:557, :625, :652, :676, :722, :740, :752, :801, :845` |
| `AnimationAction` | `new AnimationAction( mixer, clip, localRoot = null, blendMode = clip.blendMode )` | `T/src/animation/AnimationAction.js:17` |
| — props | `blendMode`, `loop = LoopRepeat`, `time = 0`, `timeScale = 1`, `weight = 1`, `repetitions = Infinity`, `paused = false`, `enabled = true`, `clampWhenFinished = false`, `zeroSlopeAtStart = true`, `zeroSlopeAtEnd = true` | `:29-167` |
| — methods | `play/stop/reset/isRunning/isScheduled/startAt/setLoop/setEffectiveWeight/getEffectiveWeight/fadeIn/fadeOut/crossFadeFrom/crossFadeTo/stopFading/setEffectiveTimeScale/getEffectiveTimeScale/setDuration/syncWith/halt/warp/stopWarping/getMixer/getClip/getRoot` | `:176-552` |

### 10.2 Interpolation modes present — and the quaternion hole

`T/src/constants.js:1150-1177`

| enum | int | interpolant class | works on `QuaternionKeyframeTrack`? |
|---|---|---|---|
| `InterpolateDiscrete` | 2300 | `DiscreteInterpolant` | yes |
| `InterpolateLinear` | 2301 | `QuaternionLinearInterpolant` (slerp) for quats, `LinearInterpolant` otherwise | yes — **default** |
| `InterpolateSmooth` | 2302 | `CubicInterpolant` | **NO** |
| `InterpolateBezier` | 2303 | `BezierInterpolant` | **NO** |

`T/src/animation/tracks/QuaternionKeyframeTrack.js` last line: `QuaternionKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;`. Requesting `InterpolateSmooth` on a quaternion track hits `KeyframeTrack.setInterpolation`'s `factoryMethod === undefined` branch (`KeyframeTrack.js:210-235`), which **silently falls back to `InterpolateLinear`** and logs `'unsupported interpolation for quaternion keyframe track named …'`. There is also no `InterpolantFactoryMethodBezier` on it.

Interpolant files present: `T/src/math/interpolants/` → `BezierInterpolant.js`, `CubicInterpolant.js`, `DiscreteInterpolant.js`, `LinearInterpolant.js`, `QuaternionLinearInterpolant.js`.

**Consequence for kata authoring: rotational easing cannot be delegated to three.js.** Slerp between keys is piecewise-constant angular velocity — the classic robotic look. Fix: **bake the easing into the key density.** Sample the authored ease curve at a fixed rate and emit dense linear quaternion keys.

| param | value | unit | tolerance | rationale |
|---|---|---|---|---|
| bake rate for authored kata clips | `60` | keys/s | 30–120 | [DERIVED] at 60 Hz, slerp error inside one key interval is below perceptual threshold for the fastest kata segment |
| max angular step per key at bake rate | `12` | deg | ≤18 | [DERIVED] a 700 °/s *gyaku-zuki* hip snap at 60 Hz ⇒ 11.7 °/key |
| track time array type | `Float32Array` | — | — | `KeyframeTrack.TimeBufferType` |
| track value array type | `Float32Array` | — | — | `KeyframeTrack.ValueBufferType` |
| `clip.optimize()` before shipping | yes | — | — | `AnimationClip.js:364` removes redundant collinear keys; run once at build time, not per load |

### 10.3 Additive blending API

| item | value | source |
|---|---|---|
| `NormalAnimationBlendMode` | `2500` | `T/src/constants.js:1209` |
| `AdditiveAnimationBlendMode` | `2501` | `T/src/constants.js:1218` |
| how to select | `mixer.clipAction( clip, root, AdditiveAnimationBlendMode )` or `clip.blendMode` | `AnimationMixer.js:557`; `AnimationAction.js:17` |
| accumulation path | `propertyMixers[j].accumulateAdditive( weight )` vs `.accumulate( accuIndex, weight )` | `AnimationAction.js:610-630` |
| clip conversion | `AnimationUtils.makeClipAdditive( targetClip, referenceFrame = 0, referenceClip = targetClip, fps = 30 )` | `T/src/animation/AnimationUtils.js:251`, static at `:478` |
| skips non-numeric tracks | `bool` / `string` tracks are skipped | `:265` |

Use for the kata player: keep the base kata clip `Normal`, and layer **additive** micro-clips for breathing, *kiai* chest expansion, and head-tracking corrections. Reference frame must be the yoi pose.

### 10.4 Scrubbing — the exact working idiom, and the trap

`mixer.setTime( t )` (`AnimationMixer.js:722-736`) zeroes `mixer.time` and every `action.time`, then calls `update( t )`. That works **only if the action is still advancing**.

Verified failure chain when `loop = LoopOnce` and `clampWhenFinished = true`:
1. On reaching `time >= duration`, `_updateTime` sets `this.paused = true` (`AnimationAction.js:770-771`).
2. `_updateTimeScale` returns `0` because `if ( ! this.paused )` guards the assignment (`:676-681`).
3. `deltaTime *= 0` ⇒ `_updateTime( 0 )` ⇒ time never moves. `mixer.setTime(t)` therefore **jumps the pose to t = 0 and freezes there**.

And with `clampWhenFinished = false`, `enabled = false` (`:772`), after which `_update` returns immediately (`:564-572`) — pose frozen at the last frame forever.

**The correct scrubbing idiom** (verified against `_updateTime`'s `deltaTime === 0` fast path at `AnimationAction.js:733-739`, which returns `this.time + 0` without any clamping, wrapping or state mutation):

```
action.paused = true;          // stop autonomous advance
action.enabled = true;         // MUST stay true or _update() early-returns
action.time = tSeconds;        // absolute seek, 0 .. clip.duration
mixer.update( 0 );             // re-evaluates interpolants AND applies bindings
```

`mixer.update(0)` does apply the property bindings — `AnimationMixer.update` runs `bindings[i].apply(accuIndex)` unconditionally after the action loop (`AnimationMixer.js:699-707`). Confirmed.

Additional constraints:
- `loop` should be `LoopRepeat` with `repetitions = Infinity` for the scrub track, so no clamp/disable path is ever reachable.
- Track names must survive `PropertyBinding.parseTrackName`. Reserved characters are `[ ] . : /` (`T/src/animation/PropertyBinding.js:3`). Bone names containing any of these break binding. `PropertyBinding.sanitizeNodeName(name)` replaces whitespace with `_` and strips reserved chars (`:185-189`). Supported object names in a path are only `['material','materials','bones','map']` (`:36`).
- Canonical bone track name: `"<BoneName>.quaternion"`; also valid: `".bones[<BoneName>].quaternion"`.

### 10.5 `AnimationMixer` vs direct per-frame quaternion writes — decision

| criterion | `AnimationMixer` + `QuaternionKeyframeTrack` | direct `bone.quaternion.copy(...)` per frame |
|---|---|---|
| absolute seek / scrub | yes, via the idiom in §10.4 | yes, trivially |
| variable playback rate, reverse | `action.timeScale` (negative works) | manual |
| crossfade between kata / into yoi | `crossFadeTo`, `fadeIn/fadeOut`, `warp` — free | must hand-write slerp blending |
| additive layers (breath, kiai) | `AdditiveAnimationBlendMode` + `makeClipAdditive` | must hand-write accumulation |
| `finished` / `loop` events | `mixer.dispatchEvent` (`AnimationAction.js:777, :866`) | manual |
| rotational easing quality | **linear slerp only** — must pre-bake dense keys | full control of any easing curve |
| CPU cost, 30 bones @60 fps | ~30 interpolant evaluations + 30 binding applies; negligible | negligible |
| serialization | `AnimationClip.toJSON()` / `parse()` round-trips | own format |
| debug / retarget tooling | `SkeletonUtils.retargetClip`, `AnimationClipCreator`, `clip.validate()` | none |

**RECOMMENDATION: `AnimationMixer` + `QuaternionKeyframeTrack`, with kata poses baked to dense 60 Hz linear quaternion keys at build time.**

Why:
1. Crossfade, additive layering, reverse playback and event dispatch are exactly the features a kata *player* needs, and re-implementing them correctly (especially additive quaternion accumulation) is where hand-rolled systems break.
2. The only real weakness — no smooth quaternion interpolation — is fully neutralized by baking at 60 Hz, which we control. The authoring layer keeps arbitrary easing (ease-out for the hip snap, ease-in for the *hikite* recovery); the runtime just plays keys.
3. `AnimationClip.toJSON`/`parse` gives a free, stable on-disk format for authored kata data, plus `clip.validate()` as a data-integrity gate in CI.
4. It keeps the door open to `SkeletonUtils.retargetClip` if the rig proportions change.

Hybrid: keep a thin post-mixer hook (run after `mixer.update`, before `renderer.render`) for procedural overrides — eye/head look-at, ground-contact foot IK via `CCDIKSolver`, and cloth-ish gi jitter. Those must write bone quaternions **after** the mixer or the mixer will overwrite them next frame.

Sources: `T/src/animation/*`; `T/src/constants.js`; https://threejs.org/docs/pages/AnimationMixer.html

---

## 11. `MeshPhysicalMaterial` in this build — feature-by-feature verdict

All properties verified in `T/src/materials/MeshPhysicalMaterial.js` (574 lines). Feature toggles are getter/setter pairs that flip `defines` and bump `version` — assigning them triggers a shader recompile.

| feature | present | default | key props (line) | cost | verdict for this project |
|---|---|---|---|---|---|
| `sheen` | yes | `0` | `sheenColor 0x000000` (`:223`), `sheenRoughness 1.0` (`:244`), `sheenColorMap` (`:236`), `sheenRoughnessMap` (`:256`); getter `:470` | medium | **YES for the gi.** This is the single feature that makes cotton read as cotton. Indirect sheen is `irradiance * sheenColor * IBLSheenBRDF(...) * RECIPROCAL_PI` (`lights_physical_pars_fragment.glsl.js:589`) — it **requires** `scene.environment` to be visible at all. |
| `clearcoat` | yes | `0` | `clearcoatRoughness 0.0` (`:106`), `clearcoatNormalScale Vector2(1,1)` (`:127`), maps at `:98,:118,:138`; getter `:396` | medium | **NO for gi/skin.** **Weak yes for lacquered wood floor** — but a plain low-roughness `MeshStandardMaterial` is cheaper and visually equivalent at our grazing angles. |
| `anisotropy` | yes | `0` | `anisotropyRotation 0` (`:73`), `anisotropyMap` (`:86`); getter `:370` | medium | **NO.** Requires a `tangent` attribute (`WebGLRenderer.js:2346`: `vertexTangents = !!geometry.attributes.tangent && (normalMap \|\| anisotropy > 0)`). Brushed-metal look, wrong for everything here. |
| `transmission` | yes | `0` | `transmissionMap` (`:268`), `thickness 0` (`:278`), `thicknessMap` (`:290`), `attenuationDistance Infinity` (`:300`), `attenuationColor (1,1,1)` (`:309`); getter `:500` | **HIGH** | **NO.** Any `transmission > 0` forces a whole extra scene render into a transmission RT each frame (`WebGLRenderer.js:1983-2048`). Nothing in a dojo is refractive. |
| `iridescence` | yes | `0` | `iridescenceIOR 1.3` (`:191`), `iridescenceThicknessRange [100,400]` nm (`:200`), maps `:182,:215`; getter `:420` | medium | **NO.** Thin-film. Irrelevant. |
| `ior` | yes | `1.5` | `:146`; `reflectivity` setter maps to it via `(1+0.4r)/(1-0.4r)` (`:167`) | free | leave `1.5` for cotton/wood; `1.4` for skin [DERIVED] |
| `specularIntensity` / `specularColor` | yes | `1.0` / `(1,1,1)` | `:318, :338`, maps `:330, :351` | free | useful to kill specular on the gi's matte inner surfaces |
| `dispersion` | yes | copied at `:540` | — | high | NO |

### 11.1 Concrete material specs

**Karate-gi (cotton canvas, white)** — `MeshPhysicalMaterial`

| param | value | unit | tolerance | note |
|---|---|---|---|---|
| `color` | `0xf2f0ea` | hex | — | never pure `0xffffff`; leaves headroom under AgX |
| `roughness` | `0.82` | ratio | ±0.06 | heavy canvas |
| `metalness` | `0.0` | ratio | exact | |
| `sheen` | `1.0` | ratio | ±0.15 | |
| `sheenRoughness` | `0.55` | ratio | ±0.15 | crisp cotton fuzz; `1.0` (the default) is too diffuse for canvas |
| `sheenColor` | `0xffffff` | hex | — | white fibre |
| `ior` | `1.5` | — | — | |
| `specularIntensity` | `0.35` | ratio | ±0.15 | canvas is not glossy |
| `normalMap` | procedural weave, `NoColorSpace` | — | — | 2–4 px twill period at texel scale |
| `normalScale` | `Vector2(0.45, 0.45)` | ratio | ±0.2 | |
| `side` | `FrontSide` | enum | — | model the gi as a closed shell; `DoubleSide` doubles shadow cost |
| `sheenColorMap` | optional | — | — | darken sheen in creases |

**Tatami / wood floor** — `MeshStandardMaterial` (not Physical)

| param | value | unit | tolerance | note |
|---|---|---|---|---|
| `color` | `0x7d5636` (wood) / `0xbfa66b` (tatami) | hex | — | |
| `roughness` | `0.42` (sealed wood) / `0.88` (tatami) | ratio | ±0.08 | |
| `metalness` | `0.0` | ratio | exact | |
| `roughnessMap` | procedural, `NoColorSpace` | — | — | plank-to-plank variance is what sells the floor |
| `normalMap` | plank seams + grain, `NoColorSpace` | — | — | |
| `map.anisotropy` | `min(8, capabilities.getMaxAnisotropy())` | — | — | mandatory on a floor viewed at grazing angles; default is `Texture.DEFAULT_ANISOTROPY = 1` (`T/src/textures/Texture.js:810`) |
| `envMapIntensity` | `1.0` | ratio | ±0.3 | |
| `receiveShadow` | `true` | bool | exact | |
| `castShadow` | `false` | bool | exact | |

**Skin** — `MeshPhysicalMaterial`

| param | value | unit | tolerance | note |
|---|---|---|---|---|
| `color` | per-character albedo | hex | — | `SRGBColorSpace` if from a map |
| `roughness` | `0.48` | ratio | ±0.08 | |
| `metalness` | `0.0` | ratio | exact | |
| `sheen` | `0.15` | ratio | ±0.10 | very light peach-fuzz; **not** the cotton value |
| `sheenRoughness` | `0.85` | ratio | ±0.10 | |
| `ior` | `1.4` | — | ±0.05 | |
| `specularIntensity` | `0.6` | ratio | ±0.2 | |
| `normalScale` | `Vector2(0.7, 0.7)` | ratio | ±0.2 | |

Real subsurface scattering: `MeshPhysicalMaterial` has **no** SSS/`thicknessColor` diffusion term. The only shipped option is `T/examples/jsm/shaders/SubsurfaceScatteringShader.js`, which is built on `ShaderLib['phong']` (`:35`) — Phong, not PBR — with uniforms `thicknessColor 0xffffff`, `thicknessDistortion 0.1`, `thicknessAmbient 0.0`, `thicknessAttenuation 0.1`, `thicknessPower 2.0`, `thicknessScale 10.0` (`:38-43`). **Verdict: do not use it.** Mixing a Phong-based material into an otherwise PBR scene will not match, and it is a `ShaderMaterial` (blocks any future WebGPU port). At the camera distances of a full-body kata shot, `sheen 0.15` + a warm bounce from the floor in the PMREM is a better cost/benefit trade. Revisit only if a close-up face shot ships. `SSSNode` exists but is WebGPU-only (`T/examples/jsm/tsl/display/SSSNode.js`).

---

## 12. Procedural textures (zero external assets)

| class | present | use |
|---|---|---|
| `CanvasTexture` | yes | `T/src/textures/CanvasTexture.js` — 2D-canvas-drawn wood planks, tatami weave, gi twill |
| `DataTexture` | yes | `T/src/textures/DataTexture.js` — noise, normal maps built numerically |
| `Data3DTexture` | yes | LUTs for `LUTPass` |
| `DataArrayTexture`, `FramebufferTexture`, `DepthTexture`, `CubeTexture`, `VideoTexture`, `HTMLTexture`, `ExternalTexture`, `VideoFrameTexture` | yes | `T/src/textures/` |

| param | value | tolerance | source / rule |
|---|---|---|---|
| `Texture.DEFAULT_ANISOTROPY` | `1` | — | `T/src/textures/Texture.js:810` — **always override on the floor** |
| default `minFilter` | `LinearMipmapLinearFilter` | — | `Texture.js:48` |
| default `magFilter` | `LinearFilter` | — | `Texture.js:48` |
| default `wrapS`/`wrapT` | `ClampToEdgeWrapping` | — | `Texture.js:48` — **set `RepeatWrapping` for tiling floors** |
| default `colorSpace` | `NoColorSpace` | — | `Texture.js:48` — **must set `SRGBColorSpace` on albedo/emissive maps** |
| default `generateMipmaps` | `true` | — | `Texture.js:257` |
| default `flipY` | `true` | — | `Texture.js:281` |
| albedo / emissive / sheenColor maps | `SRGBColorSpace` | exact | color data |
| normal / roughness / metalness / AO / displacement / thickness maps | `NoColorSpace` | exact | non-color data; setting sRGB here is the #1 silent PBR bug |
| `CanvasTexture` size for floor | `2048 × 2048` | pow2 | [DERIVED] 5.5 m embusen ⇒ ~2.7 mm/texel with 2 tiles |

---

## 13. Additional useful addons present locally

| addon | path | relevance |
|---|---|---|
| `OrbitControls` | `T/examples/jsm/controls/OrbitControls.js` | **the** orbit camera. Defaults: `target Vector3(0,0,0)` (`:108`), `minDistance 0` (`:125`), `maxDistance Infinity` (`:133`), `minPolarAngle 0` (`:173`), `maxPolarAngle PI` (`:181`), `enableDamping false` (`:209`), `dampingFactor 0.05` (`:219`), `zoomToCursor false` (`:306`), `autoRotate false` (`:318`) |
| `Timer` | `T/src/core/Timer.js` | `connect(document)`, `disconnect()`, `getDelta()`, `getElapsed()`, `setTimescale()`, `reset()`, `dispose()`, `update(timestamp)` |
| `Clock` | `T/src/core/Clock.js` | **DEPRECATED r183** — warns at `:61`. Use `Timer`. |
| `SkeletonUtils` | `T/examples/jsm/utils/SkeletonUtils.js` | retarget / clone |
| `BufferGeometryUtils` | `T/examples/jsm/utils/BufferGeometryUtils.js` | exports (`:1487-1501`): `computeMikkTSpaceTangents`, `mergeGeometries`, `mergeAttributes`, `deepCloneAttribute`, `deinterleaveAttribute`, `deinterleaveGeometry`, `interleaveAttributes`, `estimateBytesUsed`, `mergeVertices`, `toTrianglesDrawMode`, `computeMorphedAttributes`, `mergeGroups`, `toCreasedNormals` |
| `toCreasedNormals` | `BufferGeometryUtils.js:1315` | `(geometry, creaseAngle = PI/3)` — hard/soft normal split for the procedural body mesh |
| `mergeVertices` | `:643` | `(geometry, tolerance = 1e-4)` |
| `CCDIKSolver` | `T/examples/jsm/animation/CCDIKSolver.js` | foot-ground IK |
| `AnimationClipCreator` | `T/examples/jsm/animation/AnimationClipCreator.js` | quick test clips |
| `SceneOptimizer` | `T/examples/jsm/utils/SceneOptimizer.js` | build-time scene flattening |
| `ShadowMapViewer` | `T/examples/jsm/utils/ShadowMapViewer.js` | debug overlay for shadow atlas |
| `ProgressiveLightMap` | `T/examples/jsm/misc/ProgressiveLightMap.js` | `(renderer, res = 1024)` — bake static AO/GI into a floor lightmap |
| `RectAreaLightUniformsLib` | `T/examples/jsm/lights/RectAreaLightUniformsLib.js` | **must** `init()` before any `RectAreaLight` renders |
| `LightProbeGenerator` | `T/examples/jsm/lights/LightProbeGenerator.js` | SH9 probe from cubemap |
| `HDRLoader` | `T/examples/jsm/loaders/HDRLoader.js` | if an .hdr ever ships. `RGBELoader.js` exists but is a **deprecated r180 shim** that warns and extends `HDRLoader` (`RGBELoader.js:3-11`) |

---

## 14. Gotchas — things that silently break in 0.185.1

### 14.1 Verified-present traps

| # | trap | evidence | fix |
|---|---|---|---|
| 1 | `PCFSoftShadowMap` is deprecated and **mutates `renderer.shadowMap.type` to `PCFShadowMap` at first render** | `T/src/renderers/webgl/WebGLShadowMap.js:99-104` | set `PCFShadowMap` explicitly |
| 2 | `shadow.blurSamples` is **VSM-only**; setting it under PCF does nothing | `WebGLShadowMap.js:379-382` only reads it in the VSM branch | use `shadow.radius` for PCF softness |
| 3 | PCF shadows **dither per pixel** (IGN-rotated Vogel disk) → visible temporal shimmer on a static frame | `shadowmap_pars_fragment.glsl.js:135` | enable `TAARenderPass.accumulate` when paused |
| 4 | `InterpolateSmooth` / `InterpolateBezier` **silently fall back to linear** on quaternion tracks | `QuaternionKeyframeTrack.js` (`InterpolantFactoryMethodSmooth = undefined`) + `KeyframeTrack.js:210-235` | bake dense keys |
| 5 | `LoopOnce` + `clampWhenFinished` ⇒ `paused = true` ⇒ **`mixer.setTime()` snaps to 0 and freezes** | `AnimationAction.js:770-771` + `:676-681` | use `action.time = t; mixer.update(0)` and keep `enabled = true` |
| 6 | `LoopOnce` without `clampWhenFinished` ⇒ `enabled = false` ⇒ `_update` early-returns forever | `AnimationAction.js:772` + `:564-572` | as above |
| 7 | `reversedDepthBuffer: true` changes the PCF shadow bias sign convention — the PCF branch has **no** `USE_REVERSED_DEPTH_BUFFER` guard (VSM does) | `shadowmap_pars_fragment.glsl.js:122` vs `:159-167` | leave `reversedDepthBuffer` at `false` |
| 8 | `SkinnedMesh.boundingSphere` is computed **once**, from whatever pose was current → figure pops out of frustum on extension | `SkinnedMesh.js:142-160, :187` | `frustumCulled = false` |
| 9 | `skinIndex` with `normalized: true` silently destroys bone indices | index is `int(i)` in `skinning_pars_vertex.glsl.js:12` | always `normalized: false` |
| 10 | `normalizeSkinWeights()` normalizes by **L1** (`manhattanLength`), not L2 | `SkinnedMesh.js:270` | expected — do not "fix" it |
| 11 | `material.envMap` **silently overrides** `scene.environment`, and then `scene.environmentIntensity` stops applying | `WebGLRenderer.js:2344`; `WebGLMaterials.js:58,74,407` | never set `material.envMap`; use `scene.environment` only |
| 12 | `scene.environment` reaches only `MeshStandardMaterial`/`MeshLambertMaterial`/`MeshPhongMaterial` | `WebGLRenderer.js:2341` | `ShaderMaterial` gets no IBL — one more reason to avoid it |
| 13 | `transmission > 0` forces an entire extra scene render pass per frame | `WebGLRenderer.js:1983-2048` | keep `transmission = 0`; if unavoidable, `renderer.transmissionResolutionScale = 0.5` (`:289`) |
| 14 | `sheen` is nearly invisible without `scene.environment` | indirect sheen term at `lights_physical_pars_fragment.glsl.js:589` | set up IBL before tuning sheen |
| 15 | `Clock` is deprecated (r183) and logs a warning on construction | `T/src/core/Clock.js:61` | use `Timer` |
| 16 | `PostProcessing` (WebGPU) is deprecated (r183) → `RenderPipeline` | `T/src/renderers/common/PostProcessing.js:19` | n/a for us (WebGL path) |
| 17 | `RGBELoader` is a deprecated r180 shim that warns | `T/examples/jsm/loaders/RGBELoader.js:3-11` | use `HDRLoader` |
| 18 | `Matrix3.scale()/rotate()/translate()` deprecated in **r185** | `T/src/math/Matrix3.js:419, :436, :454` | `makeScale/makeRotation/makeTranslation` |
| 19 | `RectAreaLight` renders black unless `RectAreaLightUniformsLib.init()` was called | `T/examples/jsm/lights/RectAreaLightUniformsLib.js` | call it, or avoid rect lights |
| 20 | `SMAAPass` operates in linear-srgb and **must precede** `OutputPass`; `FXAAPass` needs sRGB and **must follow** it | `OutputPass.js:20-21` doc; https://threejs.org/docs/pages/SMAAPass.html | see §8.4 |
| 21 | `BokehPass` ctor default `maxblur = 1.0` but `BokehShader` default is `0.01` — a 100× discrepancy | `BokehPass.js:30` vs `BokehShader.js:29` | always pass `maxblur` explicitly |
| 22 | `EffectComposer` caches `_pixelRatio` at construction; `setSize` alone is not enough on DPI change | `EffectComposer.js:61` (cache), `:317` `setSize`, `:342` `setPixelRatio`, `:291` (only `reset()` re-reads it) | call both `setSize` and `setPixelRatio` |
| 23 | `renderer.antialias` MSAA is bypassed once you render through `EffectComposer` | composer RT is a plain `WebGLRenderTarget` with `samples` unset (`EffectComposer.js:71`) | rely on SMAA/TAA |
| 24 | `GTAOPass` renders its own normal G-buffer with `MeshNormalMaterial` | `GTAOPass.js:106, :505` | any `ShaderMaterial` in the scene yields wrong AO normals |
| 25 | `DirectionalLight.target` must be in the scene graph (or manually matrix-updated) | `T/src/lights/DirectionalLight.js:70` | `scene.add(light.target)` |
| 26 | Pre-r155 tutorial light intensities are **π× too small** | `lights_pars_begin.glsl.js:48-50` (no π scaling) | multiply legacy values by π |
| 27 | `ACESFilmicToneMapping` pre-divides exposure by `0.6`; AgX/Neutral do not — switching operators changes apparent brightness | `tonemapping_pars_fragment.glsl.js:62` vs `:135, :175` | re-tune `toneMappingExposure` after any operator change |
| 28 | Tone-mapping enum integers are **not** in a sensible order (`CustomToneMapping = 5`, `AgXToneMapping = 6`) | `T/src/constants.js:464, :472` | never persist the integer; persist the name |
| 29 | `PMREMGenerator.fromScene()` returns a `WebGLRenderTarget` you own — `pmrem.dispose()` frees the generator, **not** the target | `T/src/extras/PMREMGenerator.js:205-210` | keep the RT reference; `rt.dispose()` on teardown |
| 30 | `PMREMGenerator` docs warn it behaves like a singleton — `dispose()` on one instance can break others | `T/src/extras/PMREMGenerator.js:206-208` | use exactly one instance |
| 31 | `RoomEnvironment` sets `this.position.y = -3.5`; per the migration guide its position changed in r183, so PMREM lighting differs from older tutorials | `T/examples/jsm/environments/RoomEnvironment.js:38` | tune `environmentIntensity` fresh; don't reuse old numbers |
| 32 | `examples/` (HTML demos, PCSS example, fonts beyond `examples/fonts`) are **not shipped** by npm | `T/package.json` `files` array | only `build`, `examples/jsm`, `src` are available |

### 14.2 Migration-guide items that do NOT apply to installed 0.185.1

The public wiki's `r184 → r185` section lists several changes that are **absent** from this exact package. Do not code against them.

| wiki claim | reality in 0.185.1 | evidence |
|---|---|---|
| "`Object3D.dispose()` added; custom types must call `super.dispose()`" | **`Object3D` has no `dispose()`** | `grep dispose T/src/core/Object3D.js` → 0 hits; also absent from `T/build/three.core.js` `class Object3D` body (checked programmatically) |
| "`LightProbeGrid` renamed to `LightProbeGridWebGL`" | still `LightProbeGrid.js` / `LightProbeGridHelper.js` | `ls T/examples/jsm/lighting/`, `ls T/examples/jsm/helpers/` |
| "`SimplifyModifier.modify()` now async (meshoptimizer)" | `modify( geometry, count )` is **synchronous**, no `async` keyword | `T/examples/jsm/modifiers/SimplifyModifier.js:37` |
| "`PCFSoftShadowMap` with `WebGPURenderer` removed" | the constant still exists and `ShadowNode` still maps it (`_shadowFilterLib` includes `PCFSoftShadowFilter`); the **WebGL** renderer is the one that deprecates it | `T/src/nodes/lighting/ShadowNode.js:177, :426`; `WebGLShadowMap.js:99` |

Interpretation: `0.185.1` is a patch release, and/or the wiki section is partly forward-dated to r186 dev. **Always verify against `node_modules`, never against the wiki.**

Source: https://github.com/mrdoob/three.js/wiki/Migration-Guide ; https://github.com/mrdoob/three.js/releases/tag/r185 ; local files.

---

## 15. Canonical boot sequence (order matters)

```
1.  renderer = new WebGLRenderer({ canvas, antialias:false, alpha:false,
                                   powerPreference:'high-performance',
                                   stencil:false, depth:true })
2.  renderer.setPixelRatio( Math.min(devicePixelRatio, 2) )
3.  renderer.setSize( w, h )
4.  renderer.toneMapping = AgXToneMapping ; renderer.toneMappingExposure = 1.0
    // renderer.outputColorSpace already SRGBColorSpace — do not touch
5.  renderer.shadowMap.enabled = true ; renderer.shadowMap.type = PCFShadowMap
6.  scene = new Scene()
7.  pmrem = new PMREMGenerator(renderer)
    envRT = pmrem.fromScene( dojoEnvScene, 0.04, 0.1, 40, { size:512, position:(0,0.9625,0) } )
    scene.environment = envRT.texture
    scene.environmentIntensity = 0.85
    scene.environmentRotation = new Euler(0,-0.35,0)
    pmrem.dispose()                       // keep envRT
8.  add KEY/RIM/FILL DirectionalLights (§5); scene.add(key.target)
9.  configure key.shadow per §6.4
10. build SkinnedMesh per §9.4 ; frustumCulled = false ; castShadow = true
11. floor mesh: receiveShadow = true, castShadow = false
12. mixer = new AnimationMixer( skinnedMesh ) ; action = mixer.clipAction(kataClip)
    action.loop = LoopRepeat ; action.repetitions = Infinity ; action.play()
13. composer = new EffectComposer( renderer )     // HalfFloat by default
    passes in the order of §8.4
14. controls = new OrbitControls( camera, renderer.domElement )
    enableDamping = true ; dampingFactor = 0.05
    target = (0, 0.9625, 0) ; minDistance = 1.6 ; maxDistance = 9.0
    minPolarAngle = 0.15 ; maxPolarAngle = 1.52          // rad, keeps camera above floor
15. await renderer.compileAsync( scene, camera )
16. renderer.setAnimationLoop( frame )
```

Per-frame `frame(dtMs)`:
```
dt = timer.getDelta()
if (playing) { mixer.update(dt) } else { action.time = scrubT; mixer.update(0) }
runPostMixerHooks()          // head look-at, foot IK -- AFTER mixer
refitShadowFrustum()         // §6.4 Mode B, with texel snapping
controls.update()
taaPass.accumulate = !playing
composer.render(dt)
```

---

## 16. Uncertainties

1. **`toneMapping` choice is an art call, not a fact.** `AgXToneMapping` is recommended on the reasoning that a white cotton gi under a strong key is exactly the case where ACES's highlight hue skew shows. A critic could legitimately argue for `NeutralToneMapping` (Khronos PBR Neutral, better albedo fidelity) or `ACESFilmicToneMapping` (more "cinematic"). All three exist in this build; the decision must be made by eye against reference footage. Every `toneMappingExposure` and light-intensity number in §4.3/§5 shifts with that choice.

2. **All lighting intensities, colours and positions in §5 are [DERIVED] art direction**, not engine facts. They are internally consistent (ratios and angles are computed), but no source prescribes them.

3. **Embusen bounding box assumed as 5.5 m × 4.0 m.** Every shadow-frustum and texel-density number in §6.4 depends on it. If the kata research doc gives different dimensions, recompute `S_fixed = 0.5·hypot(W,D) + 0.2` and `t = 2S/N`.

4. **`normalBias = 0.015 m` is a first estimate.** The correct value depends on the final mesh's silhouette curvature and the key light's grazing angle at the floor. It must be tuned visually: too small ⇒ shadow acne in the gi folds; too large ⇒ the feet detach from their shadows (peter-panning). The ±0.008 tolerance is a guess.

5. **Mode B per-frame shadow refit cost is unmeasured.** The claim that deriving the AABB from ~24 bone world positions is ~50× cheaper than `computeBoundingBox()` is arithmetic on vertex counts, not a benchmark. Texel snapping in light space is also a technique I am prescribing; three.js does not provide it and it is not validated here.

6. **The 60 Hz key-bake rate is derived from an assumed peak angular velocity of ~700 °/s** for a hip snap. If the biomechanics research gives a higher peak (some sources put elite *gyaku-zuki* hip rotation well above that), the bake rate must rise proportionally to keep the per-key angular step ≤ 18°.

7. **`InterpolateBezier` on non-quaternion tracks is untested here.** `BezierInterpolant.js` exists and r185 refactored its `inTangents`/`outTangents`, but I did not read the interpolant body or verify the value-array layout it expects. Do not use it without reading `T/src/math/interpolants/BezierInterpolant.js` first.

8. **GTAO `radius = 0.30 m` and `samples = 24` are estimates.** They will interact with `resolutionScale` and with the camera's distance range; screen-space AO parameters are notoriously scene-dependent. `screenSpaceRadius = false` assumes the orbit distance stays within roughly 1.6–9 m; if the player allows extreme close-ups, `true` may be better.

9. **`sheenRoughness = 0.55` for the gi contradicts the three.js default of `1.0`** and the commonly-cited "0.5 for cotton" figure from forum posts. There is no authoritative measured value; heavy karate canvas is coarser than shirting cotton, so the true value may be higher. Tune against reference photographs.

10. **The recommendation against `SubsurfaceScatteringShader` assumes a full-body framing.** If the final player ships a close-up face camera, the trade-off flips and a proper SSS solution (or a WebGPU port using `SSSNode`) becomes necessary. The claim that `sheen 0.15` is an adequate substitute is not validated.

11. **The `WebGLRenderer` recommendation is contingent on scene complexity staying low.** If the project later adds crowd figures, GPU cloth simulation, or particle-heavy effects, the WebGPU + TSL path becomes the right answer and the entire §8 post-FX chain must be rebuilt with `RenderPipeline` + `examples/jsm/tsl/display/*`. The estimate of "10–40 draw calls" is an assumption about the final scene, not a measurement.

12. **The `mixer.update(0)` scrub idiom was verified by reading `_update`, `_updateTime`, `_updateTimeScale` and `AnimationMixer.update`, but not by running it.** In particular the interaction of `_accuIndex` toggling with repeated `update(0)` calls on the same frame, and the behaviour of `PropertyMixer.accumulate` when the same `accuIndex` is written twice, were not traced. Verify empirically before relying on it for frame-accurate capture.

13. **`Object3D.dispose()` absence may be version-drift, not a wiki error.** If the project ever bumps to r186+, the wiki items in §14.2 may become live. Re-run the local verification after any three.js upgrade.

14. **Texel-size and penumbra formulas assume a symmetric ortho shadow frustum and no `shadow.camera.zoom`.** `LightShadow` also supports non-square `mapSize` and `getFrameExtents()` tiling for point lights (`WebGLShadowMap.js:174-198`); those cases were not analysed.

15. **`TAARenderPass` convergence is stated as 32 frames at `sampleLevel = 0`**, read from `_JitterVectors[5].length` and the `accumulateIndex` loop. Whether increasing `sampleLevel` (which raises `numSamplesPerFrame = 2^sampleLevel`, `TAARenderPass.js:131`) reduces wall-clock convergence time proportionally was not tested.
