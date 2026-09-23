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

    // The base Pass.dispose() only disposes own properties that are
    // WebGLRenderTarget/Material/Texture/Pass instances (rtDepth,
    // rtAttribute, fullscreenMaterial): it can't reach the per-layer
    // depth/attribute materials held inside pointCloudMaterials, so they're
    // disposed explicitly here to avoid leaking them.
    dispose() {
        for (const { depthMaterial, attributeMaterial } of this.pointCloudMaterials.values()) {
            depthMaterial.dispose();
            attributeMaterial.dispose();
        }
        this.pointCloudMaterials.clear();

        super.dispose();
    }
}

export default HighQualitySplatsPass;
