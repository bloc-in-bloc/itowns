import assert from 'assert';
import * as THREE from 'three';
import PointCloudRenderer from 'Renderer/PointCloudRenderer';
import { PNTS_SIZE_MODE } from 'Renderer/PointsMaterial';
import Renderer from './bootstrap';

function makePCLayer(sizeMode) {
    return {
        isGeometryLayer: true,
        isPointCloudLayer: true,
        visible: true,
        object3d: { visible: true },
        material: { sizeMode },
    };
}

describe('PointCloudRenderer', function () {
    let renderer;
    let pointCloudRenderer;

    beforeEach(function () {
        renderer = new Renderer();
        pointCloudRenderer = new PointCloudRenderer(renderer, 64, 64);
        // Isolate the composer/pass-graph wiring under test from
        // postprocessing's internal EffectComposer.render(), which is not
        // exercised against the test-only fake WebGLRenderer.
        pointCloudRenderer._composer.render = () => {};
    });

    it('exposes edlPass and hqSplatsPass, both disabled by default', function () {
        assert.equal(pointCloudRenderer.edlPass.enabled, false);
        assert.equal(pointCloudRenderer.hqSplatsPass.enabled, false);
    });

    it('routes only ADAPTIVE point-cloud layers to hqSplatsPass when enabled', function () {
        pointCloudRenderer.hqSplatsPass.enabled = true;

        const adaptive = makePCLayer(PNTS_SIZE_MODE.ADAPTIVE);
        const attenuated = makePCLayer(PNTS_SIZE_MODE.ATTENUATED);
        const view = { getLayers: () => [adaptive, attenuated] };

        pointCloudRenderer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), view);

        assert.deepEqual(pointCloudRenderer.hqSplatsPass.pointCloudLayers, [adaptive]);
    });

    it('never mutates edlPass.enabled, even while hqSplatsPass is active', function () {
        pointCloudRenderer.edlPass.enabled = true;
        pointCloudRenderer.hqSplatsPass.enabled = true;

        const view = { getLayers: () => [] };
        pointCloudRenderer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), view);

        assert.equal(pointCloudRenderer.edlPass.enabled, true);
        assert.equal(pointCloudRenderer.edlPass.renderToScreen, false);
        assert.equal(pointCloudRenderer.hqSplatsPass.renderToScreen, true);
    });

    it('falls back to the plain render pass when both edl and hq are disabled', function () {
        const view = { getLayers: () => [] };
        pointCloudRenderer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), view);

        assert.equal(pointCloudRenderer._fallbackPass.enabled, true);
        assert.equal(pointCloudRenderer._copyPass.enabled, true);
    });

    it('keeps the plain fallback pass enabled for non-adaptive layers when hq is on and edl is off', function () {
        pointCloudRenderer.hqSplatsPass.enabled = true;
        const view = { getLayers: () => [] };
        pointCloudRenderer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), view);

        assert.equal(pointCloudRenderer._fallbackPass.enabled, true);
        assert.equal(pointCloudRenderer._copyPass.enabled, false);
    });
});
