import assert from 'assert';
import {
    MakeEDLShader,
    generateKernel,
    edlResponseChunk,
    fullscreenVertexShader,
} from 'Renderer/Postprocessing/EDLShader';

describe('EDLShader', function () {
    describe('generateKernel', function () {
        it('generates evenly distributed unit vectors', function () {
            const kernel = generateKernel(4);
            assert.equal(kernel.length, 8);
            assert.ok(Math.abs(kernel[0] - 1) < 1e-6);
            assert.ok(Math.abs(kernel[1]) < 1e-6);
        });
    });

    describe('edlResponseChunk', function () {
        it('exposes the shared depth/EDL response GLSL functions', function () {
            assert.ok(edlResponseChunk.includes('float getDepth('));
            assert.ok(edlResponseChunk.includes('float getLogDepth('));
            assert.ok(edlResponseChunk.includes('float computeEDL('));
        });
    });

    describe('fullscreenVertexShader', function () {
        it('is a fullscreen-triangle vertex shader', function () {
            assert.ok(fullscreenVertexShader.includes('gl_Position = vec4(position.xy, 1.0, 1.0)'));
        });
    });

    describe('MakeEDLShader', function () {
        it('still composes a fragment shader using the shared chunk', function () {
            const material = MakeEDLShader(8, 256, 256);
            assert.ok(material.fragmentShader.includes('computeEDL(vUv)'));
            assert.equal(material.defines.KERNEL_SIZE, 8);
            assert.equal(material.uniforms.edlStrength.value, 0.7);
            assert.equal(material.uniforms.kernelRadius.value, 1.5);
        });
    });
});
