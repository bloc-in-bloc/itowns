import assert from 'assert';
import * as THREE from 'three';
import { HQSplatsPass } from 'Renderer/Postprocessing/HQSplatsPass';
import { EDLPass } from 'Renderer/Postprocessing/EDLPass';
import PointsMaterial, { PNTS_SIZE_MODE } from 'Renderer/PointsMaterial';
import Renderer from './bootstrap';

describe('HQSplatsPass', function () {
    let edlPass;
    let hqSplatsPass;

    beforeEach(function () {
        edlPass = new EDLPass(64, 64);
        hqSplatsPass = new HQSplatsPass(edlPass, 64, 64);
    });

    it('is disabled by default', function () {
        assert.equal(hqSplatsPass.enabled, false);
    });

    it('resizes both offscreen render targets and the resolution uniform', function () {
        hqSplatsPass.setSize(128, 256);
        assert.deepEqual(hqSplatsPass.resolution, new THREE.Vector2(128, 256));
    });

    it('shares a single depth texture between the depth and attribute targets', function () {
        assert.equal(
            hqSplatsPass._depthTarget.depthTexture,
            hqSplatsPass._attributeTarget.depthTexture,
        );
    });

    it('does nothing before mainScene/mainCamera are set', function () {
        const renderer = new Renderer();
        assert.doesNotThrow(() => {
            hqSplatsPass.render(renderer, null, null);
        });
    });

    it('swaps eligible layers to the depth/attribute HQ materials, in order, then restores them', function () {
        const renderer = new Renderer();
        const seenMaterials = [];
        renderer.render = () => {
            seenMaterials.push(node.material);
        };
        renderer.clear = () => {};

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        hqSplatsPass.mainScene = scene;
        hqSplatsPass.mainCamera = camera;

        const originalMaterial = new PointsMaterial({ sizeMode: PNTS_SIZE_MODE.ADAPTIVE });
        const group = new THREE.Group();
        const node = new THREE.Points(new THREE.BufferGeometry(), originalMaterial);
        group.add(node);
        const layer = { group, material: originalMaterial };
        hqSplatsPass.pointCloudLayers = [layer];

        const inputBuffer = new THREE.WebGLRenderTarget(64, 64);
        const outputBuffer = new THREE.WebGLRenderTarget(64, 64);
        hqSplatsPass.render(renderer, inputBuffer, outputBuffer);

        assert.equal(seenMaterials.length, 3);
        assert.equal(seenMaterials[0].defines.HQ_DEPTH_PASS, 1);
        assert.equal(seenMaterials[1].defines.HQ_WEIGHTED, 1);
        assert.equal(seenMaterials[2], originalMaterial);
        assert.equal(node.material, originalMaterial);
    });

    it('fully clears the depth pre-pass but only clears color/stencil (never depth) on the attribute pass', function () {
        const renderer = new Renderer();
        const clearCalls = [];
        renderer.clear = (color, depth, stencil) => { clearCalls.push([color, depth, stencil]); };

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        hqSplatsPass.mainScene = scene;
        hqSplatsPass.mainCamera = camera;
        hqSplatsPass.pointCloudLayers = [];

        hqSplatsPass.render(
            renderer,
            new THREE.WebGLRenderTarget(64, 64),
            new THREE.WebGLRenderTarget(64, 64),
        );

        assert.deepEqual(clearCalls[0], [true, true, true]);
        assert.deepEqual(clearCalls[1], [true, false, true]);
    });

    it('resets the accumulation buffer to transparent black, restoring the previous clear color/alpha afterward', function () {
        const renderer = new Renderer();
        renderer.clear = () => {};
        const seenClearColors = [];
        const originalSetClearColor = renderer.setClearColor.bind(renderer);
        renderer.setClearColor = (color, alpha) => {
            seenClearColors.push([color, alpha]);
            originalSetClearColor(color, alpha);
        };
        renderer.getClearColor = target => target.set(0x123456);
        renderer.getClearAlpha = () => 0.5;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        hqSplatsPass.mainScene = scene;
        hqSplatsPass.mainCamera = camera;
        hqSplatsPass.pointCloudLayers = [];

        hqSplatsPass.render(
            renderer,
            new THREE.WebGLRenderTarget(64, 64),
            new THREE.WebGLRenderTarget(64, 64),
        );

        assert.equal(seenClearColors.length, 2);
        assert.equal(seenClearColors[0][0], 0x000000);
        assert.equal(seenClearColors[0][1], 0);
        assert.equal(seenClearColors[1][0].getHex(), 0x123456);
        assert.equal(seenClearColors[1][1], 0.5);
    });
});
