import assert from 'assert';
import { MakeHQSplatsShader } from 'Renderer/Postprocessing/HQSplatsShader';

describe('HQSplatsShader', function () {
    it('composes a fragment shader reusing the shared EDL response chunk', function () {
        const material = MakeHQSplatsShader(8, 256, 256);

        assert.ok(material.fragmentShader.includes('float computeEDL('));
        assert.ok(material.fragmentShader.includes('weighted.rgb / max(weighted.a, 1e-5)'));
        assert.equal(material.defines.KERNEL_SIZE, 8);
        assert.equal(material.uniforms.uEdlEnabled.value, false);
        assert.equal(material.uniforms.kernelRadius.value, 1.5);
        assert.equal(material.uniforms.edlStrength.value, 0.7);
    });
});
