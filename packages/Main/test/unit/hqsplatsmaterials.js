import assert from 'assert';
import * as THREE from 'three';
import {
    createHQSplatMaterials,
    syncHQSplatMaterial,
    setPointCloudLayerMaterial,
} from 'Renderer/Postprocessing/HQSplatsMaterials';
import PointsMaterial, { PNTS_SHAPE, PNTS_SIZE_MODE, PNTS_MODE } from 'Renderer/PointsMaterial';

describe('HQSplatsMaterials', function () {
    describe('createHQSplatMaterials', function () {
        it('forces circular shape and the HQ_DEPTH_PASS/HQ_WEIGHTED defines', function () {
            const { depthMaterial, attributeMaterial } = createHQSplatMaterials();

            assert.equal(depthMaterial.shape, PNTS_SHAPE.CIRCLE);
            assert.equal(depthMaterial.defines.HQ_DEPTH_PASS, 1);
            assert.equal(depthMaterial.colorWrite, false);
            assert.equal(depthMaterial.depthWrite, true);

            assert.equal(attributeMaterial.shape, PNTS_SHAPE.CIRCLE);
            assert.equal(attributeMaterial.defines.HQ_WEIGHTED, 1);
            assert.equal(attributeMaterial.depthWrite, false);
            assert.equal(attributeMaterial.blending, THREE.CustomBlending);
            assert.equal(attributeMaterial.blendSrc, THREE.SrcAlphaFactor);
            assert.equal(attributeMaterial.blendDst, THREE.OneFactor);
        });
    });

    describe('syncHQSplatMaterial', function () {
        it('copies display-affecting properties from the source material', function () {
            const source = new PointsMaterial();
            source.size = 4;
            source.opacity = 0.5;

            const { depthMaterial } = createHQSplatMaterials();
            syncHQSplatMaterial(depthMaterial, source);

            assert.equal(depthMaterial.size, 4);
            assert.equal(depthMaterial.opacity, 0.5);
        });

        it('copies the display mode so HQ passes render the layer\'s actual coloring', function () {
            const source = new PointsMaterial({ mode: PNTS_MODE.INTENSITY });

            const { depthMaterial, attributeMaterial } = createHQSplatMaterials();
            syncHQSplatMaterial(depthMaterial, source);
            syncHQSplatMaterial(attributeMaterial, source);

            assert.equal(depthMaterial.mode, PNTS_MODE.INTENSITY);
            assert.equal(attributeMaterial.mode, PNTS_MODE.INTENSITY);
        });

        it('copies sizeMode and scale so ADAPTIVE point clouds keep their real footprint', function () {
            const source = new PointsMaterial({
                sizeMode: PNTS_SIZE_MODE.ADAPTIVE,
                scale: 42,
            });

            const { depthMaterial, attributeMaterial } = createHQSplatMaterials();
            syncHQSplatMaterial(depthMaterial, source);
            syncHQSplatMaterial(attributeMaterial, source);

            assert.equal(depthMaterial.sizeMode, PNTS_SIZE_MODE.ADAPTIVE);
            assert.equal(depthMaterial.scale, 42);
            assert.equal(attributeMaterial.sizeMode, PNTS_SIZE_MODE.ADAPTIVE);
            assert.equal(attributeMaterial.scale, 42);
        });
    });

    describe('setPointCloudLayerMaterial', function () {
        it('assigns the material to every loaded node mesh and can restore it', function () {
            const originalMaterial = new PointsMaterial();
            const layer = { group: new THREE.Group() };
            const nodeA = new THREE.Points(new THREE.BufferGeometry(), originalMaterial);
            const nodeB = new THREE.Points(new THREE.BufferGeometry(), originalMaterial);
            layer.group.add(nodeA, nodeB);

            const { depthMaterial } = createHQSplatMaterials();
            setPointCloudLayerMaterial(layer, depthMaterial);
            assert.equal(nodeA.material, depthMaterial);
            assert.equal(nodeB.material, depthMaterial);

            setPointCloudLayerMaterial(layer, originalMaterial);
            assert.equal(nodeA.material, originalMaterial);
            assert.equal(nodeB.material, originalMaterial);
        });
    });
});
