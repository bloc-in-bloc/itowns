# High-Quality Splats for Point Clouds — Design

## Context

itowns already implements Eye-Dome Lighting (EDL) for point clouds as a
postprocessing `Pass` (`EDLPass`/`EDLShader`) driven by
`view.mainLoop.gfxEngine.pointCloudRenderer.edlPass`. EDL enhances depth
perception by shading based on neighboring depth differences, but each point
is still rendered as an independent, hard-edged disc: overlapping/adjacent
splats show visible seams, gaps, and aliasing at typical point densities.

Potree (Schuetz, *"Potree: Rendering Large Point Clouds in Web Browsers"*,
master's thesis, TU Wien, 2016, §4.3 "High-Quality Splatting") solves this
with a three-pass weighted-blending technique:

1. A **depth pre-pass** renders inflated splats (radius × 2) to establish an
   approximate surface depth.
2. An **attribute pass** re-renders the true-sized splats with a radial
   weight falloff, additively blending `weight·color` and `weight` into an
   RGBA target, depth-tested (not written) against the pre-pass depth.
3. A **normalization pass** divides the accumulated color by the
   accumulated weight to reconstruct a smooth, seam-free color, optionally
   folding in EDL shading in the same pass.

This spec adapts that technique to itowns' rendering pipeline
(`PointCloudRenderer`, `PointsMaterial`, `PointsVS.glsl`/`PointsFS.glsl`),
reusing the existing EDL infrastructure where possible.

## Goals

- Implement HQ Splats as a new postprocessing pass,
  `view.mainLoop.gfxEngine.pointCloudRenderer.hqSplatsPass`, mirroring the
  ergonomics of `edlPass` (`.enabled`, GUI-toggleable).
- Support combining HQ Splats with EDL in a single normalization pass (as in
  Potree), reusing `edlPass`'s `strength`/`kernelRadius` parameters and
  `enabled` flag as the single source of truth for "apply EDL shading".
- Scope HQ Splats to `PointCloudLayer` instances whose material is in
  `PNTS_SIZE_MODE.ADAPTIVE` (octree-based adaptive point size), since this is
  the only mode with a reliable world-space point radius. Other point
  clouds/layers continue to render through the existing forward/EDL path,
  unaffected.
- Add an example GUI toggle (`examples/pointcloud_loader_globe.html`) and
  unit tests at a level of coverage comparable to the existing `EDLPass`.

## Non-goals

- Supporting HQ Splats for `VALUE`/`ATTENUATED` size modes (no reliable
  world-space radius without further design work).
- Changing the visual behavior or public API of EDL when HQ Splats is
  disabled.
- Compositing HQ-splatted and non-adaptive point clouds into the same
  weighted buffer (non-adaptive point clouds simply render normally
  alongside/underneath, as today).

## Architecture

`PointCloudRenderer`'s `EffectComposer` chain currently is:

```
LambdaPass (show others, hide point clouds)
terrainPass (render others)
LambdaPass (hide others, show point clouds)
edlPass (forward-render point clouds + EDL shading, or passthrough if disabled)
fallbackPass (plain render, enabled only when edlPass disabled)
copyPass (enabled only when edlPass disabled)
```

We insert a new pass, `hqSplatsPass`, immediately after `edlPass`. Exactly one
of `{hqSplatsPass, edlPass, fallback+copy}` renders the point clouds each
frame:

- If `hqSplatsPass.enabled` is `true`: `hqSplatsPass` renders and shades the
  point clouds (folding in EDL shading if `edlPass.enabled` is also `true`).
  `edlPass` itself is disabled for that frame (skipped by the composer) to
  avoid a redundant forward render.
- Otherwise, behavior is unchanged: `edlPass` (if enabled) or the
  fallback/copy passes render normally.

### HQSplatsPass render steps

1. **Layer selection.** From `mainScene`'s visible geometry layers (as
   already collected in `PointCloudRenderer.render`), filter to
   `isPointCloudLayer && material.sizeMode === PNTS_SIZE_MODE.ADAPTIVE`.
   Non-adaptive point-cloud layers and other geometry layers are left
   visible for the surrounding `terrainPass`/normal rendering, unaffected by
   this pass.

2. **Material preparation.** For each eligible layer, lazily create and
   cache (`WeakMap<PointCloudLayer, {depthMaterial, attributeMaterial}>`)
   two `PointsMaterial` clones:
   - `depthMaterial`: define `HQ_DEPTH_PASS` set, `shape` forced to
     `PNTS_SHAPE.CIRCLE`, `colorWrite = false`, `depthWrite = true`,
     `depthTest = true`.
   - `attributeMaterial`: define `HQ_WEIGHTED` set, `shape` forced to
     `PNTS_SHAPE.CIRCLE`, `depthWrite = false`, `depthTest = true`,
     `blending = THREE.CustomBlending`, `blendSrc = THREE.SrcAlphaFactor`,
     `blendDst = THREE.OneFactor`, `blendSrcAlpha = THREE.SrcAlphaFactor`,
     `blendDstAlpha = THREE.OneFactor`, `transparent = true`.

   Each frame, before rendering, copy the relevant display-affecting
   properties from the layer's live material into both clones: `size`,
   `minSize`/`maxSize` (if present), `sizeMode` (always `ADAPTIVE` here),
   `opacity`, `mode`, classification/discrete/gradient/visibility textures,
   `intensityRange`/`elevationRange`/`angleRange`, adaptive-size uniforms
   (`octreeSpacing`, `octreeSize`, `nodeDepth`, `nodeStartOffset`,
   `nodeBBoxMin` — these are actually re-set per-node via each mesh's
   existing `onBeforeRender` callback, so only the material-level
   properties need copying here), and `gamma`/`ambientBoost`.

3. **Mesh material swap.** Because itowns creates one `THREE.Points` mesh
   per octree node with a *direct reference* to the shared
   `layer.material` (`PointCloudProvider.js`), rather than a single
   swappable top-level material like Potree's custom renderer, we must
   traverse each eligible layer's `object3d` and temporarily reassign
   `.material` on every visible `Points` child:
   - Before the depth pass: swap to `depthMaterial`.
   - Before the attribute pass: swap to `attributeMaterial`.
   - After the attribute pass: restore the original `layer.material`
     reference on every swapped mesh.

   This traversal happens twice per frame (once per pass) only for
   eligible layers; non-eligible layers/objects are untouched.

4. **Depth pre-pass.** Render `mainScene` (with only eligible layers'
   meshes swapped and visible, others hidden via the same
   show/hide convention used elsewhere in `PointCloudRenderer`) into
   `_depthTarget`, a `WebGLRenderTarget` with an attached `DepthTexture`
   and `colorWrite` disabled on the material (color buffer is otherwise
   unused). Vertex shader (`HQ_DEPTH_PASS`) inflates the projected depth by
   `2 × vRadius` (see Shader changes below) before computing
   `gl_Position`.

5. **Attribute pass.** Render into `_attributeTarget`, a second
   `WebGLRenderTarget` whose `depthTexture` is set to
   **the same `DepthTexture` instance** as `_depthTarget` (matching
   Potree's approach), so the GPU depth-tests the true-sized splats against
   the pre-pass surface without writing depth. Fragment shader
   (`HQ_WEIGHTED`) computes a radial weight and outputs
   `(color * weight, weight)`; `CustomBlending` accumulates these
   additively across overlapping splats.

6. **Normalization (+ optional EDL) pass.** A fullscreen pass (new
   `HQSplatsShader.ts`) that:
   - Samples `_attributeTarget.texture` and divides `rgb` by
     `max(a, 1e-5)` to reconstruct the blended color.
   - Samples the shared depth texture; discards (background) where depth
     is at the far/threshold value (reusing the existing
     `DEPTH_THRESHOLD`/`USE_REVERSED_DEPTH_BUFFER` convention from
     `EDLShader.ts`).
   - If `edlPass.enabled`, applies the same EDL response kernel as
     `EDLShader.ts` (`strength`/`kernelRadius` read directly from
     `edlPass`), factored into a shared GLSL helper (see below) so the
     math isn't duplicated between `EDLShader.ts` and `HQSplatsShader.ts`.
   - Composites the result over `inputBuffer.texture` (previously
     rendered terrain/other layers), exactly like `EDLPass` does today.
   - Writes `gl_FragDepth` from the shared depth texture so later passes
     (transform gizmos, overlays) depth-test correctly.

7. **Restore visibility/materials** exactly as `EDLPass`/`PointCloudRenderer`
   already do for the show/hide toggling.

### Shader changes

`PointsVS.glsl`:
- New varying `vRadius` (world-space point radius), computed only when
  `sizeMode == PNTS_SIZE_MODE.ADAPTIVE` (reusing the existing
  `worldSpaceSize` computation already present in the adaptive branch).
- New `#ifdef HQ_DEPTH_PASS` block (after standard point-size/projection
  logic): inflate `mvPosition` along its view-space direction by
  `2 * vRadius` before the final `gl_Position = projectionMatrix * mvPosition`
  reprojection, matching Potree's `pointcloud.vs` depth-pass adjustment.

`PointsFS.glsl`:
- New `#ifdef HQ_WEIGHTED` block: always treat the point as circular
  (regardless of the `shape` uniform) using
  `float dist = length(gl_PointCoord - 0.5) * 2.0;`, `discard` if
  `dist > 1.0`, else `weight = pow(max(0.0, 1.0 - dist), 1.5)`, and output
  `gl_FragColor = vec4(diffuseColor.rgb * weight, weight)`.

Both defines are additive to the existing shader logic and don't affect the
default (non-HQ) rendering path when undefined.

### New/changed files

- `packages/Main/src/Renderer/Postprocessing/HQSplatsPass.ts` (new)
- `packages/Main/src/Renderer/Postprocessing/HQSplatsShader.ts` (new)
- `packages/Main/src/Renderer/Postprocessing/EDLShader.ts` (refactor: extract
  the EDL response/kernel GLSL into a shared exported chunk/function used by
  both shaders)
- `packages/Main/src/Renderer/Shader/PointsVS.glsl`,
  `packages/Main/src/Renderer/Shader/PointsFS.glsl` (additive changes above)
- `packages/Main/src/Renderer/PointCloudRenderer.ts` (wire `hqSplatsPass`,
  mutual exclusion with `edlPass`)
- `examples/pointcloud_loader_globe.html` and
  `examples/jsm/postprocessing/HQSplatsPass.js` (+ shader mirror file) — GUI
  toggle folder "High-Quality Splats", following the exact pattern of the
  existing "Eye-Dome Lighting" folder.
- Unit tests: pass construction/resize/enable wiring (mirroring existing
  `EDLPass` test coverage) and a focused test for the mesh material
  swap/restore helper in `PointCloudRenderer`.

## Data flow summary

```
PointCloudLayer (ADAPTIVE) --swap--> depthMaterial --render--> _depthTarget (depth only)
PointCloudLayer (ADAPTIVE) --swap--> attributeMaterial --render(blended)--> _attributeTarget (shares depthTexture)
_attributeTarget.rgb / _attributeTarget.a  ---\
shared depthTexture (+ EDL kernel if enabled) ---> normalization shader ---> composite over inputBuffer
```

## Error handling / edge cases

- **Division by zero**: normalization pass guards with
  `max(accumulatedWeight, 1e-5)`.
- **Resize**: `_depthTarget`/`_attributeTarget` resized alongside the
  existing `_pointCloudRenderTarget` in `setSize`.
- **Reversed depth buffer**: reuse `EDLShader.ts`'s existing
  `USE_REVERSED_DEPTH_BUFFER`/`DEPTH_THRESHOLD` handling verbatim.
- **Mixed layer eligibility**: non-adaptive point-cloud layers (or other
  geometry) remain visible and render normally through the surrounding
  terrain/EDL path; they are not blended into the HQ weighted buffer. This
  is a documented limitation, not a bug.
- **Toggling mid-session**: enabling/disabling `hqSplatsPass.enabled` or
  `edlPass.enabled` at runtime must not leave any `Points` mesh with a
  swapped material permanently attached — the swap/restore step always
  executes in the same synchronous pass, guaranteeing restoration even if
  the pass is toggled off on the next frame.

## Testing plan

- Unit tests (Mocha, matching existing `EDLPass`-level tests): pass
  construction defaults, `setSize` propagation, `enabled` wiring in
  `PointCloudRenderer`, and the material swap/restore helper (verifying
  original materials are restored on all traversed meshes even on
  re-entrant/toggled calls).
- Manual visual verification via the updated
  `examples/pointcloud_loader_globe.html` example against an adaptive
  Potree/COPC dataset, comparing seams/gaps with HQ Splats on vs. off, and
  with EDL combined vs. not.
- Existing lint/build/test suites (`npm run lint`, `npm run test`) must
  continue to pass.

## References

- M. Schütz, *"Potree: Rendering Large Point Clouds in Web Browsers"*,
  master's thesis, TU Wien, 2016 — §4.3 "High-Quality Splatting" (pages
  38-41).
- Potree source: `src/viewer/HQSplatRenderer.js`,
  `src/materials/shaders/{pointcloud.vs,pointcloud.fs,normalize.fs,
  normalize_and_edl.fs}`, `src/materials/{NormalizationMaterial.js,
  NormalizationEDLMaterial.js}`.
- itowns existing EDL implementation:
  `packages/Main/src/Renderer/PointCloudRenderer.ts`,
  `packages/Main/src/Renderer/Postprocessing/{EDLPass.ts,EDLShader.ts}`.
