# High-Quality Splats Rendering Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `view.pointCloudQuality = 'high'` rendering mode that blends overlapping point-cloud splats into a smooth surface using the classic depth → attribute → normalization 3-pass algorithm (Schütz 2016 thesis §4.2.2 / Botsch et al. 2005), instead of itowns' current independently depth-tested splats.

**Architecture:** Two new `postprocessing` `Pass` subclasses are wired into itowns' existing `EffectComposer` (`c3DEngine.composer`): `HiddenPointCloudsRenderPass` (hides point-cloud layers while the rest of the scene renders as the "beauty" pass) and `HighQualitySplatsPass` (renders point clouds only, twice, into private offscreen targets — an unmodified depth pass and a weighted-additive attribute pass sharing that depth — then a fullscreen shader normalizes and composites the result over the beauty buffer, respecting depth against the rest of the scene). `PointsMaterial` gains `weighted`/`hardness` uniforms to drive the attribute pass' fragment shader branch. `View.pointCloudQuality` is the public on/off switch; default `'normal'` is a complete no-op (composer untouched).

**Tech Stack:** three.js `ShaderMaterial`/`WebGLRenderTarget`/`DepthTexture`, the `postprocessing` npm package (`Pass`, `RenderPass`, `EffectComposer`) already used by `packages/Main/src/Core/Prefab/Globe/RealisticSky.ts`, itowns' `CommonMaterial` uniform-property helper, mocha/assert unit tests (`packages/Main/test/unit`) using the mocked `Renderer`/`webgl-mock` bootstrap.

**Spec:** `docs/superpowers/specs/2026-09-23-high-quality-splats-design.md`

## Global Constraints

- Default behavior (`pointCloudQuality: 'normal'`, the default) must be byte-for-byte unchanged: no new render targets, passes, or extra draw calls when the mode is off.
- Circles-only splats (no oriented/ellipse splats); weight `= (1 - distance²)^hardness` (thesis Eq. 4.1), `hardness` defaults to `1.5`.
- Applies to every layer with `isPointCloudLayer === true` (generic `PointCloudLayer`, `PotreeLayer`, COPC/LAS-backed layers), not just Potree.
- No Eye-Dome-Lighting and no configurable "blend depth" tolerance in this iteration (documented future work in the spec).
- Follow the existing `RealisticSky.ts` convention: custom `postprocessing` passes added/removed together from `view.mainLoop.gfxEngine.composer`.
- Additive blending in the attribute pass must use `THREE.CustomBlending` with `blendEquation: THREE.AddEquation`, `blendSrc/blendDst/blendSrcAlpha/blendDstAlpha: THREE.OneFactor` (exact weighted-sum accumulation — do not use the `SRC_ALPHA`/`ONE` shortcut).
- Run `npm run test-unit` (inside `packages/Main`) after every task; run `npm run lint` (repo root) before the final commit of each task.

---

### Task 1: `PointsMaterial` weighted/hardness support

**Files:**
- Modify: `packages/Main/src/Renderer/PointsMaterial.js`
- Modify: `packages/Main/src/Renderer/Shader/PointsFS.glsl`
- Modify: `packages/Main/test/unit/pointsmaterial.js`

**Interfaces:**
- Produces: `PointsMaterial#weighted: boolean` (default `false`), `PointsMaterial#hardness: number` (default `1.5`) — both plain uniform-backed properties via `CommonMaterial.setUniformProperty`, consumed by Task 4 (`HighQualitySplatsPass`) to build the attribute-pass material and by users to tune `layer.material.hardness`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/Main/test/unit/pointsmaterial.js` (new `describe` block, keep existing content untouched):

```js
describe('#weighted / #hardness', function () {
    it('should default to unweighted with hardness 1.5', function () {
        const material = new PointsMaterial();
        assert.equal(material.weighted, false);
        assert.equal(material.hardness, 1.5);
    });

    it('should expose weighted and hardness as uniforms', function () {
        const material = new PointsMaterial();
        material.weighted = true;
        material.hardness = 2;
        assert.equal(material.uniforms.weighted.value, true);
        assert.equal(material.uniforms.hardness.value, 2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/Main && npm run test-unit -- --grep "weighted / #hardness"`
Expected: FAIL — `material.weighted`/`material.hardness` are `undefined` (no such uniforms).

- [ ] **Step 3: Implement `weighted`/`hardness` in `PointsMaterial`**

In `packages/Main/src/Renderer/PointsMaterial.js`, inside the constructor, right after the existing `CommonMaterial.setUniformProperty(this, 'ambientBoost', ambientBoost);` line, add:

```js
        CommonMaterial.setUniformProperty(this, 'weighted', weighted);
        CommonMaterial.setUniformProperty(this, 'hardness', hardness);
```

Add `weighted = false` and `hardness = 1.5` to the destructured options above (next to `ambientBoost = 0.0,`):

```js
            ambientBoost = 0.0,
            weighted = false,
            hardness = 1.5,
```

Add matching JSDoc `@param` entries right below the existing `@param {number} [options.ambientBoost=0.0]` line in the class doc comment:

```js
     * @param      {boolean} [options.weighted=false]  When true, the fragment shader outputs a
     * weighted `color * weight` / `weight` pair instead of a final color, for use in the
     * High-Quality Splats attribute pass. See {@link View#pointCloudQuality}.
     * @param      {number}  [options.hardness=1.5]  Smoothness of the High-Quality Splats weight
     * falloff (`weight = (1 - distance^2)^hardness`). Only used when `weighted` is true.
```

- [ ] **Step 4: Add the weighted branch to `PointsFS.glsl`**

Replace the whole content of `packages/Main/src/Renderer/Shader/PointsFS.glsl` with:

```glsl
#define USE_COLOR_ALPHA

#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

uniform vec3 diffuse;
uniform float opacity;
uniform float ambientBoost;

uniform bool picking;
uniform int shape;
uniform bool weighted;
uniform float hardness;

void main() {

// Early discard (clipping planes and shape)
#include <clipping_planes_fragment>
    // Normalized distance to the splat center, in [0, 1] range (0 = center).
    float splatDistance = length(2.0 * gl_PointCoord - 1.0);
    if (shape == PNTS_SHAPE_CIRCLE) {
        //circular rendering in glsl
        if (splatDistance > 1.0) {
            discard;
        }
    }

#include <logdepthbuf_fragment>

    vec4 diffuseColor = vec4(diffuse, opacity);
#include <map_particle_fragment>
#include <color_fragment>

#include <alphatest_fragment>
#include <alphahash_fragment>

    vec3 outgoingLight = diffuseColor.rgb;

    outgoingLight = max(outgoingLight, vec3(ambientBoost));

    if (weighted) {
        // High-Quality Splats attribute pass (Schütz 2016 thesis, Eq. 4.1):
        // accumulate a weighted sum of colors in .rgb and a sum of weights in
        // .a, via additive blending set up by HighQualitySplatsPass. This is
        // an intermediate accumulation buffer, not a final display color, so
        // fog/tonemapping/colorspace/premultiplied-alpha do not apply here.
        float weight = pow(max(0.0, 1.0 - splatDistance * splatDistance), hardness);
        gl_FragColor = vec4(outgoingLight * weight, weight);
        return;
    }

#include <opaque_fragment> // gl_FragColor
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
#include <premultiplied_alpha_fragment>

}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/Main && npm run test-unit`
Expected: PASS (all `pointsmaterial.js` tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/Main/src/Renderer/PointsMaterial.js packages/Main/src/Renderer/Shader/PointsFS.glsl packages/Main/test/unit/pointsmaterial.js
git commit -m "feat(PointsMaterial): add weighted/hardness uniforms for High-Quality Splats"
```

---

### Task 2: Normalization/composite shader pair

**Files:**
- Create: `packages/Main/src/Renderer/Shader/NormalizeSplatsVS.glsl`
- Create: `packages/Main/src/Renderer/Shader/NormalizeSplatsFS.glsl`

**Interfaces:**
- Produces: two GLSL modules imported (via the project's existing `.glsl` webpack/rollup raw-string loader, same mechanism as `PointsVS.glsl`/`PointsFS.glsl`) by Task 4's `HighQualitySplatsPass` as `NormalizeSplatsVS`/`NormalizeSplatsFS` string constants. Expected uniforms consumed by that material: `uBeautyMap` (sampler2D), `uBeautyDepth` (sampler2D), `uSplatAccum` (sampler2D), `uSplatDepth` (sampler2D), `uActive` (bool). Expects vertex attributes `position` (vec3) and `uv` (vec2) as provided by `postprocessing`'s `Pass.fullscreenGeometry`.

This task has no dedicated unit test (GLSL text cannot be exercised without a real WebGL context); it is validated end-to-end by Task 4's tests and by manual visual testing in Task 6.

- [ ] **Step 1: Create the vertex shader**

`packages/Main/src/Renderer/Shader/NormalizeSplatsVS.glsl`:

```glsl
varying vec2 vUv;

void main() {
    vUv = uv;
    // The fullscreen triangle from postprocessing's Pass.fullscreenGeometry
    // already spans clip space; no projection needed.
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
```

- [ ] **Step 2: Create the fragment shader**

`packages/Main/src/Renderer/Shader/NormalizeSplatsFS.glsl`:

```glsl
#extension GL_EXT_frag_depth : enable

precision highp float;

// Color (and depth, via a shared depth attachment) of the rest of the scene,
// rendered without point clouds by HiddenPointCloudsRenderPass.
uniform sampler2D uBeautyMap;
uniform sampler2D uBeautyDepth;

// Weighted-sum color (.rgb) / sum-of-weights (.a) from the attribute pass,
// and the nearest-splat depth from the depth pass.
uniform sampler2D uSplatAccum;
uniform sampler2D uSplatDepth;

// False when there is no visible point cloud layer this frame: the beauty
// buffer is passed through untouched.
uniform bool uActive;

varying vec2 vUv;

void main() {
    vec4 beauty = texture2D(uBeautyMap, vUv);
    float beautyDepth = texture2D(uBeautyDepth, vUv).r;

    if (!uActive) {
        gl_FragColor = beauty;
        gl_FragDepthEXT = beautyDepth;
        return;
    }

    float splatDepth = texture2D(uSplatDepth, vUv).r;
    vec4 accum = texture2D(uSplatAccum, vUv);

    // No splat covers this pixel, or the rest of the scene occludes the
    // nearest splat: keep the beauty buffer as-is.
    if (accum.a <= 0.0 || splatDepth >= 1.0 || splatDepth > beautyDepth) {
        gl_FragColor = beauty;
        gl_FragDepthEXT = beautyDepth;
    } else {
        gl_FragColor = vec4(accum.rgb / accum.a, 1.0);
        gl_FragDepthEXT = splatDepth;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/Main/src/Renderer/Shader/NormalizeSplatsVS.glsl packages/Main/src/Renderer/Shader/NormalizeSplatsFS.glsl
git commit -m "feat(Renderer): add normalization/composite shaders for High-Quality Splats"
```

---

### Task 3: `HiddenPointCloudsRenderPass`

**Files:**
- Create: `packages/Main/src/Renderer/HiddenPointCloudsRenderPass.js`
- Create: `packages/Main/test/unit/hiddenPointCloudsRenderPass.js`

**Interfaces:**
- Consumes: a `view`-like object exposing `.scene` (`THREE.Scene`), `.camera3D` (`THREE.Camera`), and `.getLayers(filter)` (same contract as `View#getLayers`, returns `Array<Layer>`), where a point-cloud layer exposes `.isPointCloudLayer === true` and `.object3d` (`THREE.Object3D`, the layer's root node already added as a child of `view.scene`).
- Produces: `HiddenPointCloudsRenderPass` (default export), a `postprocessing` `RenderPass` subclass with constructor `new HiddenPointCloudsRenderPass(view)`, consumed by Task 5 (`c3DEngine`).

- [ ] **Step 1: Write the failing test**

`packages/Main/test/unit/hiddenPointCloudsRenderPass.js`:

```js
import assert from 'assert';
import * as THREE from 'three';
import HiddenPointCloudsRenderPass from 'Renderer/HiddenPointCloudsRenderPass';
import Renderer from './bootstrap';

describe('HiddenPointCloudsRenderPass', function () {
    it('should hide point cloud layers only while rendering, then restore visibility', function () {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();

        const pointCloudObject3d = new THREE.Object3D();
        pointCloudObject3d.visible = true;
        scene.add(pointCloudObject3d);

        const otherObject3d = new THREE.Object3D();
        otherObject3d.visible = true;
        scene.add(otherObject3d);

        const pointCloudLayer = { isPointCloudLayer: true, object3d: pointCloudObject3d };
        const view = {
            scene,
            camera3D: camera,
            getLayers: filter => [pointCloudLayer].filter(l => !filter || filter(l)),
        };

        const pass = new HiddenPointCloudsRenderPass(view);

        const renderer = new Renderer();
        let visibilityDuringRender;
        renderer.render = () => {
            visibilityDuringRender = pointCloudObject3d.visible;
        };

        pass.render(renderer, /* inputBuffer */ { texture: null }, /* outputBuffer */ null);

        assert.equal(visibilityDuringRender, false, 'point cloud object3d must be hidden during render');
        assert.equal(pointCloudObject3d.visible, true, 'point cloud object3d must be restored after render');
        assert.equal(otherObject3d.visible, true, 'non point cloud object3d must stay untouched');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/Main && npm run test-unit -- --grep "HiddenPointCloudsRenderPass"`
Expected: FAIL — cannot find module `Renderer/HiddenPointCloudsRenderPass`.

- [ ] **Step 3: Implement `HiddenPointCloudsRenderPass`**

`packages/Main/src/Renderer/HiddenPointCloudsRenderPass.js`:

```js
import { RenderPass } from 'postprocessing';

/**
 * A `RenderPass` that temporarily hides every visible point-cloud layer's
 * `object3d` while it renders, so the rest of the scene (the "beauty" pass)
 * is drawn without point clouds. Used by the High-Quality Splats rendering
 * mode ({@link View#pointCloudQuality}), whose own {@link HighQualitySplatsPass}
 * renders the point clouds separately afterward.
 */
class HiddenPointCloudsRenderPass extends RenderPass {
    /**
     * @param {View} view - the view whose scene/camera should be rendered.
     */
    constructor(view) {
        super(view.scene, view.camera3D);
        this.view = view;
    }

    render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
        const pointCloudLayers = this.view.getLayers(l => l.isPointCloudLayer);
        const visibility = pointCloudLayers.map(l => l.object3d.visible);
        pointCloudLayers.forEach((l) => { l.object3d.visible = false; });

        super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);

        pointCloudLayers.forEach((l, i) => { l.object3d.visible = visibility[i]; });
    }
}

export default HiddenPointCloudsRenderPass;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/Main && npm run test-unit -- --grep "HiddenPointCloudsRenderPass"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/Main/src/Renderer/HiddenPointCloudsRenderPass.js packages/Main/test/unit/hiddenPointCloudsRenderPass.js
git commit -m "feat(Renderer): add HiddenPointCloudsRenderPass for High-Quality Splats"
```

---

### Task 4: `HighQualitySplatsPass`

**Files:**
- Create: `packages/Main/src/Renderer/HighQualitySplatsPass.js`
- Create: `packages/Main/test/unit/highQualitySplatsPass.js`

**Interfaces:**
- Consumes: `HiddenPointCloudsRenderPass`'s `view` contract, plus `layer.material` (a `PointsMaterial`, must have `.size`, `.sizeMode`, `.minAttenuatedSize`, `.maxAttenuatedSize`, `.mode`, `.shape`, `.gamma`, `.ambientBoost`, `.opacity`, `.hardness`, `.classificationTexture`, `.discreteTexture`, `.visibilityTexture`, `.gradientTexture`, `.intensityRange`, `.elevationRange`, `.angleRange`, `.octreeSpacing`, `.octreeSize`) and `layer.group.children` (`Array<THREE.Points>`) per `PointCloudLayer`/`PointCloudProvider`'s existing contract.
- Produces: `HighQualitySplatsPass` (default export), constructor `new HighQualitySplatsPass(view)`, a `postprocessing` `Pass` with `needsDepthTexture = true`, consumed by Task 5 (`c3DEngine`).

- [ ] **Step 1: Write the failing tests**

`packages/Main/test/unit/highQualitySplatsPass.js`:

```js
import assert from 'assert';
import * as THREE from 'three';
import HighQualitySplatsPass from 'Renderer/HighQualitySplatsPass';
import PointsMaterial from 'Renderer/PointsMaterial';
import Renderer from './bootstrap';

function createPointCloudLayer() {
    const object3d = new THREE.Object3D();
    const group = new THREE.Group();
    object3d.add(group);
    const material = new PointsMaterial();
    const points = new THREE.Points(new THREE.BufferGeometry(), material);
    group.add(points);

    return {
        isPointCloudLayer: true,
        visible: true,
        object3d,
        group,
        material,
    };
}

function createView(layers) {
    const scene = new THREE.Scene();
    layers.forEach(l => scene.add(l.object3d));

    return {
        scene,
        camera3D: new THREE.PerspectiveCamera(),
        getLayers: filter => layers.filter(l => !filter || filter(l)),
    };
}

describe('HighQualitySplatsPass', function () {
    it('should have needsDepthTexture set so the composer shares its depth texture', function () {
        const pass = new HighQualitySplatsPass(createView([]));
        assert.equal(pass.needsDepthTexture, true);
    });

    it('should copy the beauty depth texture via setDepthTexture()', function () {
        const pass = new HighQualitySplatsPass(createView([]));
        const depthTexture = new THREE.DepthTexture();
        pass.setDepthTexture(depthTexture);
        assert.equal(pass.fullscreenMaterial.uniforms.uBeautyDepth.value, depthTexture);
    });

    it('should pass through the beauty buffer and mark the composite inactive when there is no visible point cloud layer', function () {
        const view = createView([]);
        const pass = new HighQualitySplatsPass(view);
        pass.setSize(4, 4);

        const renderer = new Renderer();
        const inputBuffer = { texture: new THREE.Texture() };
        const outputBuffer = { texture: new THREE.Texture() };

        const renderCalls = [];
        renderer.render = (scene, camera) => renderCalls.push({ scene, camera });

        pass.render(renderer, inputBuffer, outputBuffer);

        assert.equal(pass.fullscreenMaterial.uniforms.uActive.value, false);
        assert.equal(pass.fullscreenMaterial.uniforms.uBeautyMap.value, inputBuffer.texture);
        assert.equal(renderCalls.length, 1, 'only the composite draw should happen');
        assert.equal(renderCalls[0].scene, pass.scene);
    });

    it('should render points with the depth/attribute materials and restore the original material', function () {
        const layer = createPointCloudLayer();
        const view = createView([layer]);
        const pass = new HighQualitySplatsPass(view);
        pass.setSize(4, 4);

        const renderer = new Renderer();
        const inputBuffer = { texture: new THREE.Texture() };
        const outputBuffer = { texture: new THREE.Texture() };
        const points = layer.group.children[0];

        const materialsDuringRender = [];
        const originalRender = renderer.render.bind(renderer);
        renderer.render = (scene, camera) => {
            materialsDuringRender.push(points.material);
            originalRender(scene, camera);
        };

        pass.render(renderer, inputBuffer, outputBuffer);

        assert.equal(materialsDuringRender.length, 3, 'depth pass, attribute pass, then composite');
        assert.equal(materialsDuringRender[0].weighted, false, 'depth pass material must not be weighted');
        assert.equal(materialsDuringRender[1].weighted, true, 'attribute pass material must be weighted');
        assert.equal(points.material, layer.material, 'original material must be restored after both passes');
        assert.equal(pass.fullscreenMaterial.uniforms.uActive.value, true);
    });

    it('should hide non point-cloud objects during the depth/attribute passes only', function () {
        const layer = createPointCloudLayer();
        const view = createView([layer]);
        const otherObject3d = new THREE.Object3D();
        view.scene.add(otherObject3d);

        const pass = new HighQualitySplatsPass(view);
        pass.setSize(4, 4);

        const renderer = new Renderer();
        const visibilitySamples = [];
        renderer.render = () => visibilitySamples.push(otherObject3d.visible);

        pass.render(renderer, { texture: new THREE.Texture() }, { texture: new THREE.Texture() });

        assert.deepEqual(visibilitySamples, [false, false, true], 'hidden for depth+attribute, visible again for composite');
        assert.equal(otherObject3d.visible, true, 'must be restored after render()');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/Main && npm run test-unit -- --grep "HighQualitySplatsPass"`
Expected: FAIL — cannot find module `Renderer/HighQualitySplatsPass`.

- [ ] **Step 3: Implement `HighQualitySplatsPass`**

`packages/Main/src/Renderer/HighQualitySplatsPass.js`:

```js
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import PointsMaterial from 'Renderer/PointsMaterial';
import NormalizeSplatsVS from 'Renderer/Shader/NormalizeSplatsVS.glsl';
import NormalizeSplatsFS from 'Renderer/Shader/NormalizeSplatsFS.glsl';

// Properties of PointsMaterial that must be kept in sync between a layer's
// live material and the private depth/attribute materials used for the High
// Quality Splats passes.
const SYNCED_PROPERTIES = [
    'size', 'sizeMode', 'minAttenuatedSize', 'maxAttenuatedSize',
    'mode', 'shape', 'gamma', 'ambientBoost', 'opacity', 'hardness',
    'classificationTexture', 'discreteTexture', 'visibilityTexture', 'gradientTexture',
    'intensityRange', 'elevationRange', 'angleRange',
    'octreeSpacing', 'octreeSize',
];

/**
 * Renders point-cloud layers as High-Quality Splats: a depth pass (nearest
 * splat per pixel, unmodified `PointsMaterial`), a weighted attribute pass
 * (additive accumulation of `color * weight` / `weight`, depth-tested
 * against the depth pass), and a normalization pass that divides the
 * accumulated color by the accumulated weight and composites the result over
 * the rest of the scene (the "beauty" buffer produced upstream by
 * {@link HiddenPointCloudsRenderPass}).
 *
 * See M. Schütz, "Potree: Rendering Large Point Clouds in Web Browsers"
 * (2016 thesis), §4.2.2, and {@link View#pointCloudQuality}.
 */
class HighQualitySplatsPass extends Pass {
    /**
     * @param {View} view - the view whose point-cloud layers should be rendered.
     */
    constructor(view) {
        super('HighQualitySplatsPass');
        this.view = view;
        this.needsDepthTexture = true;

        this.rtDepth = new THREE.WebGLRenderTarget(1, 1, {
            depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
        });
        this.rtAttribute = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
        this.rtAttribute.depthTexture = this.rtDepth.depthTexture;

        this.fullscreenMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uBeautyMap: new THREE.Uniform(null),
                uBeautyDepth: new THREE.Uniform(null),
                uSplatAccum: new THREE.Uniform(this.rtAttribute.texture),
                uSplatDepth: new THREE.Uniform(this.rtDepth.depthTexture),
                uActive: new THREE.Uniform(false),
            },
            vertexShader: NormalizeSplatsVS,
            fragmentShader: NormalizeSplatsFS,
            depthTest: false,
            depthWrite: false,
        });

        // One { depthMaterial, attributeMaterial } pair per point-cloud
        // layer: PointCloudProvider shares a single material instance across
        // all of a layer's THREE.Points nodes, so we mirror that per-layer
        // granularity rather than per-node.
        this.pointCloudMaterials = new Map();
    }

    setDepthTexture(depthTexture) {
        this.fullscreenMaterial.uniforms.uBeautyDepth.value = depthTexture;
    }

    setSize(width, height) {
        this.rtDepth.setSize(width, height);
        this.rtAttribute.setSize(width, height);
    }

    getPointCloudMaterials(layer) {
        let materials = this.pointCloudMaterials.get(layer);
        if (!materials) {
            const depthMaterial = new PointsMaterial();
            const attributeMaterial = new PointsMaterial();

            attributeMaterial.weighted = true;
            attributeMaterial.depthWrite = false;
            attributeMaterial.blending = THREE.CustomBlending;
            attributeMaterial.blendEquation = THREE.AddEquation;
            attributeMaterial.blendSrc = THREE.OneFactor;
            attributeMaterial.blendDst = THREE.OneFactor;
            attributeMaterial.blendSrcAlpha = THREE.OneFactor;
            attributeMaterial.blendDstAlpha = THREE.OneFactor;

            materials = { depthMaterial, attributeMaterial };
            this.pointCloudMaterials.set(layer, materials);
        }
        return materials;
    }

    syncMaterial(target, source) {
        for (const property of SYNCED_PROPERTIES) {
            target[property] = source[property];
        }
    }

    // Hides every top-level child of view.scene that isn't one of the given
    // point-cloud layers' object3d, so the depth/attribute passes only
    // render point clouds. Returns the saved visibility to restore later.
    hideOtherObjects(pointCloudLayers) {
        const pointCloudObject3ds = new Set(pointCloudLayers.map(l => l.object3d));
        const saved = [];
        for (const child of this.view.scene.children) {
            saved.push([child, child.visible]);
            if (!pointCloudObject3ds.has(child)) {
                child.visible = false;
            }
        }
        return saved;
    }

    restoreObjects(saved) {
        for (const [child, visible] of saved) {
            child.visible = visible;
        }
    }

    render(renderer, inputBuffer, outputBuffer) {
        const pointCloudLayers = this.view.getLayers(l => l.isPointCloudLayer && l.visible);

        this.fullscreenMaterial.uniforms.uBeautyMap.value = inputBuffer.texture;
        this.fullscreenMaterial.uniforms.uActive.value = pointCloudLayers.length > 0;

        if (pointCloudLayers.length > 0) {
            const savedVisibility = this.hideOtherObjects(pointCloudLayers);

            // Depth pass: plain, unmodified point rendering; standard depth
            // test picks the nearest splat per pixel, exactly like today's
            // single-pass rendering.
            for (const layer of pointCloudLayers) {
                const { depthMaterial } = this.getPointCloudMaterials(layer);
                this.syncMaterial(depthMaterial, layer.material);
                for (const points of layer.group.children) {
                    points.material = depthMaterial;
                }
            }
            renderer.setRenderTarget(this.rtDepth);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, true, true);
            renderer.render(this.view.scene, this.view.camera3D);

            // Attribute pass: weighted additive accumulation, depth-tested
            // against the depth pass' depth texture (shared via
            // rtAttribute.depthTexture = rtDepth.depthTexture).
            for (const layer of pointCloudLayers) {
                const { attributeMaterial } = this.getPointCloudMaterials(layer);
                this.syncMaterial(attributeMaterial, layer.material);
                for (const points of layer.group.children) {
                    points.material = attributeMaterial;
                }
            }
            renderer.setRenderTarget(this.rtAttribute);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, true, true);
            renderer.render(this.view.scene, this.view.camera3D);

            // Restore each point cloud layer's original material and the
            // rest of the scene's visibility.
            for (const layer of pointCloudLayers) {
                for (const points of layer.group.children) {
                    points.material = layer.material;
                }
            }
            this.restoreObjects(savedVisibility);
        }

        // Normalization + composite pass.
        renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
        renderer.render(this.scene, this.camera);
    }
}

export default HighQualitySplatsPass;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/Main && npm run test-unit -- --grep "HighQualitySplatsPass"`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run the full unit test suite**

Run: `cd packages/Main && npm run test-unit`
Expected: PASS (no regressions in `pointsmaterial.js`, `pointcloudlayer.js`, etc.)

- [ ] **Step 6: Commit**

```bash
git add packages/Main/src/Renderer/HighQualitySplatsPass.js packages/Main/test/unit/highQualitySplatsPass.js
git commit -m "feat(Renderer): add HighQualitySplatsPass implementing the 3-pass HQ splats algorithm"
```

---

### Task 5: Wire `view.pointCloudQuality` through `c3DEngine`/`View`

**Files:**
- Modify: `packages/Main/src/Renderer/c3DEngine.js`
- Modify: `packages/Main/src/Core/View.js`
- Modify: `packages/Main/test/unit/view.js`

**Interfaces:**
- Consumes: `HiddenPointCloudsRenderPass` (Task 3), `HighQualitySplatsPass` (Task 4), `this.composer` (`postprocessing.EffectComposer`, already present on `c3DEngine`).
- Produces: `c3DEngine#pointCloudQuality: 'normal' | 'high'` (getter), `c3DEngine#setPointCloudQuality(view, quality)`, and `View#pointCloudQuality` (getter/setter, delegates to the above), consumed by Task 6 (example) and end users.

- [ ] **Step 1: Write the failing tests**

Add to `packages/Main/test/unit/view.js` (new `describe` block; the file already has `renderer`/`viewer` set up in `before`/`beforeEach`, reuse them):

```js
    describe('pointCloudQuality', function () {
        it('should default to normal', function () {
            assert.equal(viewer.pointCloudQuality, 'normal');
        });

        it('should add the High-Quality Splats passes to the composer when set to high', function () {
            const before = viewer.mainLoop.gfxEngine.composer.passes.length;
            viewer.pointCloudQuality = 'high';
            assert.equal(viewer.pointCloudQuality, 'high');
            assert.equal(viewer.mainLoop.gfxEngine.composer.passes.length, before + 2);
        });

        it('should remove the passes when set back to normal', function () {
            viewer.pointCloudQuality = 'high';
            const before = viewer.mainLoop.gfxEngine.composer.passes.length;
            viewer.pointCloudQuality = 'normal';
            assert.equal(viewer.pointCloudQuality, 'normal');
            assert.equal(viewer.mainLoop.gfxEngine.composer.passes.length, before - 2);
        });

        it('should reject invalid values', function () {
            assert.throws(() => { viewer.pointCloudQuality = 'ultra'; });
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/Main && npm run test-unit -- --grep "pointCloudQuality"`
Expected: FAIL — `viewer.pointCloudQuality` is `undefined`.

- [ ] **Step 3: Implement `c3DEngine#pointCloudQuality`**

In `packages/Main/src/Renderer/c3DEngine.js`, add the imports near the top (after the existing `import { deprecatedC3DEngineWebGLOptions } ...` line):

```js
import HiddenPointCloudsRenderPass from 'Renderer/HiddenPointCloudsRenderPass';
import HighQualitySplatsPass from 'Renderer/HighQualitySplatsPass';
```

In the constructor, right after `this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });`, add:

```js
        this._pointCloudQuality = 'normal';
        this._hiddenPointCloudsPass = null;
        this._highQualitySplatsPass = null;
```

Add these methods right after `getRenderer()`:

```js
    /**
     * The current point cloud rendering quality.
     * @returns {'normal'|'high'}
     */
    get pointCloudQuality() {
        return this._pointCloudQuality;
    }

    /**
     * Sets the point cloud rendering quality.
     *
     * `'high'` enables the High-Quality Splats rendering mode: point clouds
     * are rendered through an extra depth/attribute/normalization pass
     * sequence that blends overlapping splats into a smoother surface (see
     * M. Schütz, "Potree: Rendering Large Point Clouds in Web Browsers",
     * 2016 thesis, §4.2.2). `'normal'` (default) is a no-op on the composer.
     *
     * @param {View} view - the view whose point clouds should be rendered.
     * @param {'normal'|'high'} quality - the quality to switch to.
     */
    setPointCloudQuality(view, quality) {
        if (quality !== 'normal' && quality !== 'high') {
            throw new Error(`Invalid pointCloudQuality '${quality}', expected 'normal' or 'high'.`);
        }
        if (this._pointCloudQuality === quality) {
            return;
        }
        this._pointCloudQuality = quality;

        if (!this._hiddenPointCloudsPass) {
            this._hiddenPointCloudsPass = new HiddenPointCloudsRenderPass(view);
            this._highQualitySplatsPass = new HighQualitySplatsPass(view);
        }

        if (quality === 'high') {
            this.composer.addPass(this._hiddenPointCloudsPass);
            this.composer.addPass(this._highQualitySplatsPass);
        } else {
            this.composer.removePass(this._hiddenPointCloudsPass);
            this.composer.removePass(this._highQualitySplatsPass);
        }
    }
```

In `dispose()`, right before `this.composer.dispose();`, add:

```js
        this._hiddenPointCloudsPass?.dispose();
        this._highQualitySplatsPass?.dispose();
```

- [ ] **Step 4: Implement `View#pointCloudQuality`**

In `packages/Main/src/Core/View.js`, right after the `get camera3D()` getter (before the `dispose()` JSDoc comment), add:

```js
    /**
     * Gets or sets the point cloud rendering quality.
     *
     * `'normal'` (default) renders point clouds as independent,
     * depth-tested splats. `'high'` enables the High-Quality Splats
     * rendering mode, blending overlapping splats into a smoother surface
     * (see M. Schütz, "Potree: Rendering Large Point Clouds in Web
     * Browsers", 2016 thesis, §4.2.2). Applies to every layer with
     * `isPointCloudLayer === true`.
     * @type {'normal'|'high'}
     */
    get pointCloudQuality() {
        return this.mainLoop.gfxEngine.pointCloudQuality;
    }

    set pointCloudQuality(quality) {
        this.mainLoop.gfxEngine.setPointCloudQuality(this, quality);
        this.notifyChange();
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/Main && npm run test-unit -- --grep "pointCloudQuality"`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Run the full unit test suite**

Run: `cd packages/Main && npm run test-unit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/Main/src/Renderer/c3DEngine.js packages/Main/src/Core/View.js packages/Main/test/unit/view.js
git commit -m "feat(View): add pointCloudQuality property to toggle High-Quality Splats"
```

---

### Task 6: Example toggle and manual visual validation

**Files:**
- Modify: `examples/potree_3d_map.html`

**Interfaces:**
- Consumes: `View#pointCloudQuality` (Task 5).
- Produces: a manual visual-validation entry point; no new automated test.

- [ ] **Step 1: Add a lil-gui checkbox**

In `examples/potree_3d_map.html`, inside the `onLayerReady()` function, right after the existing `debug.PointCloudDebug.initTools(view, potreeLayer, debugGui);` line, add:

```js
                // High-Quality Splats toggle
                var hqSplatsState = { enabled: false };
                debugGui.add(hqSplatsState, 'enabled').name('High-Quality Splats').onChange(function (value) {
                    view.pointCloudQuality = value ? 'high' : 'normal';
                    view.notifyChange();
                });
```

- [ ] **Step 2: Manually validate in a browser**

Run: `npm run start` (repo root, or the existing itowns dev-server script used for examples), then open `examples/potree_3d_map.html` in a browser, zoom into the Melbourne point cloud until individual splats are visible, and toggle "High-Quality Splats" in the GUI.
Expected: with the toggle on, splats blend into a continuous surface (no visible per-point discs/gaps); with it off, rendering is identical to before this plan (independent depth-tested circles). No console errors.

- [ ] **Step 3: Commit**

```bash
git add examples/potree_3d_map.html
git commit -m "feat(examples): add High-Quality Splats toggle to potree_3d_map"
```

---

### Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit test suite**

Run: `cd packages/Main && npm run test-unit`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run lint**

Run: `npm run lint` (repo root)
Expected: no errors on any file touched by this plan (`PointsMaterial.js`, `PointsFS.glsl`, `NormalizeSplatsVS.glsl`, `NormalizeSplatsFS.glsl`, `HiddenPointCloudsRenderPass.js`, `HighQualitySplatsPass.js`, `c3DEngine.js`, `View.js`, `pointsmaterial.js`, `hiddenPointCloudsRenderPass.js`, `highQualitySplatsPass.js`, `view.js`, `potree_3d_map.html`).

- [ ] **Step 3: Fix any lint/test failures found, then re-run both commands until clean.**

No commit needed for this task unless fixes were required (in which case: `git add -A && git commit -m "fix: address lint/test issues in High-Quality Splats implementation"`).
