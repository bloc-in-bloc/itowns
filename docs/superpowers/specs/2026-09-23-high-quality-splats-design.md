# High-Quality Splats rendering mode — Design

## Context

itowns renders point clouds (`PointCloudLayer` and its subclasses, e.g.
`PotreeLayer`) as `THREE.Points` using `PointsMaterial`
(`packages/Main/src/Renderer/PointsMaterial.js`), with screen-aligned
circular or square splats (`PNTS_SHAPE`). Each point is rasterized and
depth-tested independently, so nearby points on the same surface do not
blend together: at grazing angles or in sparse/undersampled areas this
produces visible gaps, aliasing, and a "confetti" look, especially when
zooming in past the point spacing.

This design adds an opt-in **High-Quality Splats** rendering mode,
based on:

- M. Schütz, *"Potree: Rendering Large Point Clouds in Web Browsers"*
  (2016 thesis), §4.2.2 "High-Quality Splats".
- M. Botsch, A. Hornung, M. Zwicker, L. Kobbelt, *"High-Quality Surface
  Splatting on Today's GPUs"* (2005) — the original 3-pass algorithm.
- Potree's production implementation (`src/viewer/HQSplatRenderer.js`,
  `src/materials/shaders/pointcloud.fs`, `normalize.fs`), used as a
  functional reference for the parts not fully detailed in the thesis.

Potree's oriented-splat/ellipse variant is **not** in scope: like
Potree's own shipped implementation, this design uses screen-aligned
circles only, since itowns point cloud sources generally do not carry
per-point normals/radii. Eye-Dome-Lighting (EDL) is a separate, later
enhancement and is explicitly out of scope for this design.

## Goals

- Blend overlapping/nearby splats into a smooth continuous surface
  instead of discrete depth-tested discs, following the classic
  depth → attribute → normalization 3-pass algorithm.
- Opt-in, global switch: `view.pointCloudQuality = 'normal' | 'high'`.
  Applies to every visible layer with `isPointCloudLayer === true`
  (generic `PointCloudLayer`, `PotreeLayer`, COPC/LAS-backed layers).
- Integrate with the existing `postprocessing` `EffectComposer`
  pipeline already used by `c3DEngine`/`RealisticSky`, rather than
  bypassing it.
- No behavior change when the mode is off (default `'normal'`).

## Non-goals

- Oriented/elliptical splats using per-point normals.
- Eye-Dome-Lighting.
- Changing the picking pipeline (picking keeps using the regular
  per-node `PointsMaterial` in `picking` mode, unaffected by this pass).

## Algorithm

Per frame, when the mode is `'high'` and at least one point cloud layer
is visible:

1. **Beauty pass (existing `RenderPass`)**: temporarily hide every
   point-cloud layer's `group` (`layer.group.visible = false`), so the
   existing composer renders all non-point-cloud content (tiles,
   3D Tiles, vector data, sky, …) into its input buffer, unaffected.
   Restore `group.visible` afterward.

2. **Depth pass**: with point-cloud groups visible and everything else
   hidden, render the scene through a plain (unmodified) `PointsMaterial`
   circle-shaped pass into an offscreen `WebGLRenderTarget`
   (`rtDepth`) that owns a `THREE.DepthTexture` (`FloatType`, since
   default `UnsignedShortType`/`UnsignedIntType` depth textures are
   precise enough here — reuse the same depth texture type already used
   by `c3DEngine.fullSizeRenderTarget.depthTexture`). This produces,
   per pixel, the depth of the nearest splat exactly like the current
   default rendering. No shader changes are required for this pass; it
   reuses each layer's current material configuration (mode, size,
   gradient, classification…) with `depthWrite: true`, `depthTest: true`.

3. **Attribute pass**: render the same point-cloud groups again, with a
   *weighted* variant of `PointsMaterial` (new `weighted: true` uniform,
   see "Material changes" below), into a second render target
   (`rtAttribute`) that shares `rtDepth`'s `depthTexture`
   (`rtAttribute.depthTexture = rtDepth.depthTexture`, mirroring
   Potree). Rendering configuration: `depthTest: true`,
   `depthWrite: false`, `blending: THREE.CustomBlending`,
   `blendEquation: THREE.AddEquation`,
   `blendSrc: THREE.OneFactor`, `blendDst: THREE.OneFactor`,
   `blendSrcAlpha: THREE.OneFactor`, `blendDstAlpha: THREE.OneFactor`
   (exact additive accumulation of `color × weight` in `.rgb` and
   `weight` in `.a` — chosen explicitly over Potree's `SRC_ALPHA`/`ONE`
   shortcut, which double-applies the weight, to match the thesis'
   "weighted sum of attributes" / "sum of weights" definition exactly).
   The depth test against `rtDepth`'s texture means only fragments at
   or in front of the nearest-splat depth contribute (no configurable
   "blend depth" tolerance in this first version — see "Future work").

4. **Normalization pass**: a fullscreen `postprocessing`-style shader
   pass reads `rtAttribute`'s color (`vec4(sum(color·weight), sum(weight))`)
   and `rtDepth`'s depth texture; outputs
   `color.rgb / max(color.a, epsilon)`, discards pixels where
   `color.a == 0` (no splat covered that pixel) or depth `>= 1.0`, and
   writes `gl_FragDepth` from the sampled depth so the result composites
   correctly against further passes.

5. **Composite**: blend the normalized result over the step-1 beauty
   buffer using a standard alpha-over composite gated by the discard
   from step 4 (i.e. pixels with no splat coverage keep the beauty
   buffer untouched; covered pixels are replaced, with their proper
   `gl_FragDepth` so future passes' own depth tests behave correctly).
   Because the composer already carries a shared depth buffer/texture
   across the `RenderPass` chain, this pass writes into that same depth
   attachment so any subsequent pass (FXAA, sky, …) still depth-tests
   correctly.

### Weight function

As defined in the thesis, Equation 4.1:

```
weight = (1 - distance²)^hardness,  distance ∈ [0, 1]
```

where `distance` is the normalized distance from the fragment to the
center of the point sprite (`length(2.0 * gl_PointCoord - 1.0)`,
already computed for the existing circle-discard test). `hardness` is
a new tunable material property (see below), defaulting to `1.5`
(matching Potree's practical default). Fragments outside the circle
(`distance > 1`) are discarded exactly as today.

## Material changes (`PointsMaterial`)

- New constructor option / property `weighted: boolean` (default
  `false`). When `true`, the fragment shader (after the existing circle
  discard and color computation) computes `weight` as above and outputs
  `gl_FragColor = vec4(diffuseColor.rgb * weight, weight)` instead of
  the normal opaque/blended output — this branch bypasses
  `<premultiplied_alpha_fragment>`/fog/tonemapping since it's an
  intermediate accumulation buffer, not a final color.
- New constructor option / property `hardness: number` (default `1.5`),
  new uniform.
- These additions are purely additive to `PointsFS.glsl`/`PointsVS.glsl`
  behind the existing `CommonMaterial.setUniformProperty` pattern; when
  `weighted` is `false` (the default, and the only value used by
  regular non-HQ rendering), generated code and behavior are unchanged.
- `PointsMaterial.copy()` and JSDoc updated accordingly.

## New module: `Renderer/HighQualitySplatsPass.js`

A subclass of `postprocessing`'s `Pass` (same import already used by
`RealisticSky.ts`: `import { Pass } from 'postprocessing'`), constructed
with the `view`. Responsibilities:

- Own `rtDepth` / `rtAttribute` render targets and the fullscreen
  normalization/composite material (own small shader pair,
  `Shader/NormalizeSplatsFS.glsl` + reuse of a passthrough vertex
  shader, following the same colocation convention as
  `Renderer/Shader/PointsFS.glsl`).
- `setSize(width, height)`: resize both render targets (called
  automatically by `EffectComposer` on resize, per the existing
  `RealisticSky` precedent).
- Maintain a `Map<PointCloudLayer, { depthMaterial, attributeMaterial }>`
  of cloned `PointsMaterial` instances per layer (mirroring Potree's
  `depthMaterials`/`attributeMaterials` maps), refreshed every frame
  from each layer's live `material` (mode, size, sizeMode, gradient,
  classification/discrete textures, ranges, opacity…), since
  `PointCloudProvider` shares one material instance across all of a
  layer's `THREE.Points` nodes (`points = new THREE.Points(geometry,
  layer.material)`). The pass temporarily reassigns
  `.material` on each `THREE.Points` node under `layer.group` for the
  duration of each sub-pass, then restores `layer.material`.
- `render(renderer, inputBuffer, outputBuffer)`: implements steps 1-5
  above, using `view.scene` traversal to find layers with
  `isPointCloudLayer === true` and `visible === true`.
- `needsDepthTexture = false` (this pass manages its own depth targets
  internally, it does not need the composer's shared depth texture as
  input — it only needs `inputBuffer`'s color for the final composite).

## Wiring: `View` / `c3DEngine`

- New `View` property `pointCloudQuality` (getter/setter), values
  `'normal'` (default) | `'high'`, stored on `c3DEngine` alongside the
  existing `composer`.
- Setter behavior:
  - `'high'`: instantiate `HighQualitySplatsPass` lazily (if not
    already created) and `composer.addPass(pass)`; call
    `view.notifyChange()`.
  - `'normal'`: `composer.removePass(pass)` if present;
    `view.notifyChange()`.
- No automatic enabling based on layer count/visibility — the mode is
  fully user-controlled, matching the agreed "view-global" scope. (The
  pass itself is a no-op — early-return before any render target work —
  when there is no visible point-cloud layer, so leaving it added has
  negligible cost, but the setter still only adds/removes it based on
  the explicit property.)
- Follows the exact add/remove-pass pattern already used by
  `RealisticSky.enabled` (`packages/Main/src/Core/Prefab/Globe/RealisticSky.ts`).

## Testing

- Unit tests (`test/unit/...` following existing `PointsMaterial`
  test conventions if present, else colocated with other Renderer
  tests): `weighted`/`hardness` uniform get/set, `copy()` behavior,
  default values, and that non-HQ rendering path (`weighted: false`)
  keeps producing the exact same shader defines as before (regression
  guard).
- An example page (`examples/source/point-cloud-hq-splats.js` +
  associated HTML, following the existing point-cloud example
  conventions) with a UI toggle for `view.pointCloudQuality`, to
  visually validate against a sample Potree/LAS dataset.
- Manual visual comparison against Potree's HQ Splats mode on an
  overlapping dataset, since blending quality is inherently a visual
  concern not easily unit-tested.

## Future work (explicitly out of scope now)

- Configurable "blend depth" tolerance (world-space radius-based, per
  thesis §4.2.2) instead of a hard depth-test cutoff.
- Eye-Dome-Lighting integration (thesis' companion technique, combined
  with HQ splats in Potree's `HQSplatRenderer` but functionally
  independent).
- Oriented/ellipse splats using per-point normals, if/when itowns point
  sources provide them.
