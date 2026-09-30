import {
    NoBlending,
    ShaderMaterial,
    Vector2,
} from 'three';
import { generateKernel, edlResponseChunk, fullscreenVertexShader } from './EDLShader';

// Normalization step of Potree/Schuetz's High-Quality Splats algorithm,
// optionally folding in Eye-Dome-Lighting shading (see EDLShader.ts).
// - Master thesis (pages 41-45):
//   https://www.cg.tuwien.ac.at/research/publications/2016/SCHUETZ-2016-POT/SCHUETZ-2016-POT-thesis.pdf
// - Implementation in Potree (last update 2019):
//   https://github.com/potree/potree/blob/develop/src/materials/shaders/normalize_and_edl.fs

const fragmentShader = /* glsl */ `
#include <packing>

#ifdef USE_REVERSED_DEPTH_BUFFER
#define DEPTH_THRESHOLD 0.0
#else
#define DEPTH_THRESHOLD 1.0
#endif

uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tWeighted;

uniform bool uEdlEnabled;
uniform vec2 kernel[KERNEL_SIZE];
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float kernelRadius;
uniform float edlStrength;

in vec2 vUv;

${edlResponseChunk}

void main() {
    float depth = getDepth(vUv);

    if (depth == DEPTH_THRESHOLD) {
        gl_FragColor = texture2D(tScene, vUv);
        gl_FragDepth = DEPTH_THRESHOLD;
        return;
    }

    vec4 weighted = texture2D(tWeighted, vUv);
    vec3 color = weighted.rgb / max(weighted.a, 1e-5);

    if (uEdlEnabled) {
        color = color * computeEDL(vUv);
    }

    gl_FragColor = vec4(color, 1.0);
    gl_FragDepth = depth;
}
`;

const MakeHQSplatsShader = (
    kernelSize: number,
    width: number,
    height: number,
) => new ShaderMaterial({
    name: 'HQSplatsShader',

    defines: {
        KERNEL_SIZE: kernelSize,
        PERSPECTIVE_CAMERA: 1,
    },

    uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tWeighted: { value: null },
        uEdlEnabled: { value: false },
        kernel: { value: generateKernel(kernelSize) },
        resolution: { value: new Vector2(width, height) },
        cameraNear: { value: null },
        cameraFar: { value: null },
        kernelRadius: { value: 1.5 },
        edlStrength: { value: 0.7 },
    },

    vertexShader: fullscreenVertexShader,
    fragmentShader,

    blending: NoBlending,
    toneMapped: false,
    depthWrite: true,
    depthTest: true,
});

export { MakeHQSplatsShader };
