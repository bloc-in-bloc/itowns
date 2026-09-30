import assert from 'assert';
import PointsVS from 'Renderer/Shader/PointsVS.glsl';

describe('PointsVS.glsl', function () {
    it('declares a vRadius varying used by the HQ depth pre-pass', function () {
        assert.ok(PointsVS.includes('varying float vRadius;'));
    });

    it('computes vRadius from the adaptive world-space point size', function () {
        assert.ok(PointsVS.includes('vRadius = worldSpaceSize * 0.5;'));
    });

    it('inflates the projected depth by 2x the world-space radius under HQ_DEPTH_PASS', function () {
        assert.ok(PointsVS.includes('#ifdef HQ_DEPTH_PASS'));
        assert.ok(PointsVS.includes('2.0 * vRadius'));
    });
});
