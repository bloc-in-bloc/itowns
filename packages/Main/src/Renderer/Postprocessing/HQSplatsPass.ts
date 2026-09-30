import {
    PerspectiveCamera,
    ShaderMaterial,
    WebGLRenderTarget,
    type WebGLRenderer,
    Camera,
    Color,
    Object3DEventMap,
    Scene,
    DepthTexture,
    UnsignedIntType,
    HalfFloatType,
    RGBAFormat,
    Group,
    Mesh,
    PlaneGeometry,
    type Texture,
} from 'three';
import { Pass, CopyMaterial } from 'postprocessing';
import { MakeHQSplatsShader } from './HQSplatsShader';
import {
    createHQSplatMaterials,
    syncHQSplatMaterial,
    setPointCloudLayerMaterial,
    type HQSplatMaterials,
} from './HQSplatsMaterials';
import type { EDLPass } from './EDLPass';

interface HQEligibleLayer {
    group: Group;
    material: import('../PointsMaterial').default;
}

type NullableCopyMaterial = Omit<CopyMaterial, 'inputBuffer' | 'depthBuffer'> & {
    inputBuffer: Texture | null;
    depthBuffer: Texture | null;
};

/**
 * A post-processing pass implementing Potree/Schuetz's "High-Quality
 * Splats" 3-pass weighted-blending algorithm for octree-based
 * (`PNTS_SIZE_MODE.ADAPTIVE`) point clouds, optionally folding in
 * Eye-Dome-Lighting shading (read from a companion `EDLPass`).
 */
class HQSplatsPass extends Pass {
    private _edlPass: EDLPass;
    private _activeScene: Scene | null = null;
    private _activeCamera: Camera | null = null;
    private _depthTarget: WebGLRenderTarget;
    private _attributeTarget: WebGLRenderTarget;
    private _materialCache = new WeakMap<object, HQSplatMaterials>();
    private _savedClearColor = new Color();
    private _depthCopyMaterial: CopyMaterial;
    private _depthCopyScene: Scene;

    /** Eligible (ADAPTIVE size mode) point-cloud layers to render this
     * frame. Set by `PointCloudRenderer` before `render()` is invoked. */
    pointCloudLayers: HQEligibleLayer[] = [];

    constructor(edlPass: EDLPass, width = 256, height = 256, kernelSize = 8) {
        super('HQSplatsPass');

        // Needs the depth of the previous passes (terrain, meshes...) to
        // occlude point clouds.
        this.needsDepthTexture = true;
        // Disabled by default: HQ splats are opt-in and only actually
        // enabled by `PointCloudRenderer`'s wiring (see `EDLPass`,
        // disabled the same way). EDL and HQ splats compose (HQ folds in
        // EDL shading when both are enabled); they are not mutually
        // exclusive.
        this.enabled = false;
        this._edlPass = edlPass;

        this.fullscreenMaterial = MakeHQSplatsShader(kernelSize, width, height);

        this._depthTarget = new WebGLRenderTarget(width, height);
        this._depthTarget.depthBuffer = true;
        this._depthTarget.depthTexture = new DepthTexture(width, height);
        // Same precision as the composer's depth texture copied into it
        this._depthTarget.depthTexture.type = UnsignedIntType;

        this._attributeTarget = new WebGLRenderTarget(width, height, {
            format: RGBAFormat,
            type: HalfFloatType,
        });
        this._attributeTarget.depthBuffer = true;
        // Shares the depth surface computed by the depth pre-pass: must
        // never be cleared with `renderer.clear(true, true, true)`.
        this._attributeTarget.depthTexture = this._depthTarget.depthTexture;

        // Depth-only copy of the scene depth into _depthTarget, so that the
        // scene geometry occludes splats in both the depth and attribute
        // passes.
        this._depthCopyMaterial = new CopyMaterial();
        // `null` is supported at runtime (disables color/depth write) but
        // not allowed by postprocessing's typings.
        (this._depthCopyMaterial as NullableCopyMaterial).inputBuffer = null;
        this._depthCopyScene = new Scene();
        const depthCopyMesh = new Mesh(new PlaneGeometry(2, 2), this._depthCopyMaterial);
        depthCopyMesh.frustumCulled = false;
        this._depthCopyScene.add(depthCopyMesh);
    }

    setDepthTexture(depthTexture: Texture | null) {
        (this._depthCopyMaterial as NullableCopyMaterial).depthBuffer = depthTexture;
    }

    get resolution() {
        return (this.fullscreenMaterial as ShaderMaterial).uniforms.resolution.value;
    }

    set mainCamera(camera: Camera) {
        this._activeCamera = camera;
        this.copyCameraSettings();
    }

    set mainScene(scene: Scene<Object3DEventMap>) {
        this._activeScene = scene;
    }

    setSize(width: number, height: number) {
        (this.fullscreenMaterial as ShaderMaterial).uniforms.resolution.value.set(width, height);
        this._depthTarget.setSize(width, height);
        this._attributeTarget.setSize(width, height);
    }

    copyCameraSettings() {
        if (!this._activeCamera) {
            return;
        }
        const u = (this.fullscreenMaterial as ShaderMaterial).uniforms;
        u.cameraNear.value = (this._activeCamera instanceof PerspectiveCamera ?
            this._activeCamera.near : null);
        u.cameraFar.value = (this._activeCamera instanceof PerspectiveCamera ?
            this._activeCamera.far : null);

        (this.fullscreenMaterial as ShaderMaterial).defines.PERSPECTIVE_CAMERA =
            this._activeCamera instanceof PerspectiveCamera ? 1 : 0;
    }

    private getMaterials(layer: HQEligibleLayer): HQSplatMaterials {
        let materials = this._materialCache.get(layer);
        if (!materials) {
            materials = createHQSplatMaterials();
            this._materialCache.set(layer, materials);
        }
        return materials;
    }

    render(
        renderer: WebGLRenderer,
        inputBuffer: WebGLRenderTarget,
        outputBuffer: WebGLRenderTarget,
    ) {
        if (!this._activeScene || !this._activeCamera) {
            return;
        }

        const layers = this.pointCloudLayers;

        // --- Depth pre-pass: inflated splats establish the surface depth ---
        layers.forEach((layer) => {
            const { depthMaterial } = this.getMaterials(layer);
            syncHQSplatMaterial(depthMaterial, layer.material);
            setPointCloudLayerMaterial(layer, depthMaterial);
        });

        renderer.setRenderTarget(this._depthTarget);
        renderer.clear(true, true, true);
        if (this._depthCopyMaterial.depthBuffer) {
            renderer.render(this._depthCopyScene, this.camera);
        }
        renderer.render(this._activeScene, this._activeCamera);

        // --- Attribute pass: weighted additive blending, depth-tested
        // (not written) against the pre-pass surface. The depth buffer is
        // shared with _depthTarget and must NOT be cleared here. The
        // accumulation buffer must start from (0, 0, 0, 0), not the
        // renderer's current clear color (e.g. sky color), or normalized
        // colors come out tinted/dimmed.
        layers.forEach((layer) => {
            const { attributeMaterial } = this.getMaterials(layer);
            syncHQSplatMaterial(attributeMaterial, layer.material);
            setPointCloudLayerMaterial(layer, attributeMaterial);
        });

        renderer.getClearColor(this._savedClearColor);
        const savedClearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);

        renderer.setRenderTarget(this._attributeTarget);
        renderer.clear(true, false, true);
        renderer.render(this._activeScene, this._activeCamera);

        renderer.setClearColor(this._savedClearColor, savedClearAlpha);

        // --- Restore each layer's own material ---
        layers.forEach((layer) => {
            setPointCloudLayerMaterial(layer, layer.material);
        });

        // --- Normalization (+ optional EDL) pass ---
        const u = (this.fullscreenMaterial as ShaderMaterial).uniforms;
        u.tScene.value = inputBuffer.texture;
        u.tDepth.value = this._depthTarget.depthTexture;
        u.tWeighted.value = this._attributeTarget.texture;
        u.uEdlEnabled.value = this._edlPass.enabled;
        u.edlStrength.value = this._edlPass.strength;
        u.kernelRadius.value = this._edlPass.kernelRadius;

        this.copyCameraSettings();

        renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
        renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.fullscreenMaterial.dispose();
        this._depthCopyMaterial.dispose();
        (this._depthCopyScene.children[0] as Mesh).geometry.dispose();
        this._depthTarget.dispose();
        this._attributeTarget.dispose();
    }
}

export { HQSplatsPass };
