import * as THREE from 'three';
import PointsMaterial, { PNTS_SHAPE } from 'Renderer/PointsMaterial';

interface HQSplatMaterials {
    depthMaterial: PointsMaterial;
    attributeMaterial: PointsMaterial;
}

/**
 * Creates the pair of `PointsMaterial` instances used by `HQSplatsPass`'s
 * depth pre-pass and weighted attribute pass. Both are forced to circular
 * splats regardless of the source material's configured shape. Created
 * once per layer and cached (see `HQSplatsPass`'s material cache) — never
 * cloned/copied per frame, so their `.defines` (and the resulting compiled
 * shader program) stay stable across frames.
 *
 * @returns The depth pre-pass material and the weighted attribute material.
 */
function createHQSplatMaterials(): HQSplatMaterials {
    const depthMaterial = new PointsMaterial();
    // @ts-expect-error PointsMaterial is not typed yet
    depthMaterial.shape = PNTS_SHAPE.CIRCLE;
    depthMaterial.defines.HQ_DEPTH_PASS = 1;
    depthMaterial.colorWrite = false;
    depthMaterial.depthTest = true;
    depthMaterial.depthWrite = true;
    depthMaterial.needsUpdate = true;

    const attributeMaterial = new PointsMaterial();
    // @ts-expect-error PointsMaterial is not typed yet
    attributeMaterial.shape = PNTS_SHAPE.CIRCLE;
    attributeMaterial.defines.HQ_WEIGHTED = 1;
    attributeMaterial.transparent = true;
    attributeMaterial.depthTest = true;
    attributeMaterial.depthWrite = false;
    attributeMaterial.blending = THREE.CustomBlending;
    attributeMaterial.blendSrc = THREE.SrcAlphaFactor;
    attributeMaterial.blendDst = THREE.OneFactor;
    attributeMaterial.blendSrcAlpha = THREE.SrcAlphaFactor;
    attributeMaterial.blendDstAlpha = THREE.OneFactor;
    attributeMaterial.needsUpdate = true;

    return { depthMaterial, attributeMaterial };
}

const SYNCED_PROPERTIES = [
    'mode', 'size', 'opacity', 'sizeMode', 'scale', 'minAttenuatedSize', 'maxAttenuatedSize',
    'intensityRange', 'elevationRange', 'angleRange', 'gamma', 'ambientBoost',
    'classificationTexture', 'discreteTexture', 'gradientTexture',
    'visibilityTexture', 'visibleNodes',
] as const;

/**
 * Copies the display-affecting properties from a `PointCloudLayer`'s live
 * material onto one of the cached HQ splat materials, every frame.
 * Per-node adaptive-size uniforms (octreeSize, nodeDepth, ...) are set
 * separately by each node mesh's own `onBeforeRender` callback and don't
 * need to be copied here.
 *
 * @param target - Cached HQ splat material to update.
 * @param source - The layer's live material to copy properties from.
 */
function syncHQSplatMaterial(target: PointsMaterial, source: PointsMaterial): void {
    SYNCED_PROPERTIES.forEach((key) => {
        // @ts-expect-error PointsMaterial is not typed yet
        target[key] = source[key];
    });
}

/**
 * Assigns `material` to every currently loaded node mesh of a
 * `PointCloudLayer`. Used both to swap in HQ splat materials before a
 * sub-pass and to restore the layer's own material afterward (with
 * `setPointCloudLayerMaterial(layer, layer.material)`).
 *
 * @param layer - The point cloud layer whose node meshes are updated.
 * @param layer.group - Group holding the layer's loaded node meshes.
 * @param material - Material to assign to every loaded node mesh.
 */
function setPointCloudLayerMaterial(
    layer: { group: THREE.Group },
    material: THREE.Material,
): void {
    (layer.group.children as THREE.Points[]).forEach((points) => {
        points.material = material;
    });
}

export {
    createHQSplatMaterials,
    syncHQSplatMaterial,
    setPointCloudLayerMaterial,
};
export type { HQSplatMaterials };
