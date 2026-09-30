import assert from 'assert';
import PointsFS from 'Renderer/Shader/PointsFS.glsl';

describe('PointsFS.glsl', function () {
    it('computes a radial weight and premultiplies color/alpha under HQ_WEIGHTED', function () {
        assert.ok(PointsFS.includes('#ifdef HQ_WEIGHTED'));
        assert.ok(PointsFS.includes('pow(max(0.0, 1.0 - weightDist), 1.5)'));
        assert.ok(PointsFS.includes('gl_FragColor.rgb * weight, weight'));
    });
});
