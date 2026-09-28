precision highp float;

// Color (and depth, via a shared depth attachment) of the rest of the scene,
// rendered without point clouds by HiddenPointCloudsRenderPass.
uniform sampler2D uBeautyMap;
uniform sampler2D uBeautyDepth;

// Weighted-sum color (.rgb) / sum-of-weights (.a) from the attribute pass,
// and the nearest-splat depth from the depth pass.
uniform sampler2D uSplatAccum;
uniform sampler2D uSplatDepth;

// False when there is no visible point cloud layer this frame: the beauty
// buffer is passed through untouched.
uniform bool uActive;

varying vec2 vUv;

void main() {
    vec4 beauty = texture2D(uBeautyMap, vUv);
    float beautyDepth = texture2D(uBeautyDepth, vUv).r;

    if (!uActive) {
        gl_FragColor = beauty;
        gl_FragDepthEXT = beautyDepth;
        return;
    }

    float splatDepth = texture2D(uSplatDepth, vUv).r;
    vec4 accum = texture2D(uSplatAccum, vUv);

    // No splat covers this pixel, or the rest of the scene occludes the
    // nearest splat: keep the beauty buffer as-is.
    if (accum.a <= 0.0 || splatDepth >= 1.0 || splatDepth > beautyDepth) {
        gl_FragColor = beauty;
        gl_FragDepthEXT = beautyDepth;
    } else {
        gl_FragColor = vec4(accum.rgb / accum.a, 1.0);
        gl_FragDepthEXT = splatDepth;
    }
}
