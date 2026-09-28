varying vec2 vUv;

void main() {
    vUv = uv;
    // The fullscreen triangle from postprocessing's Pass.fullscreenGeometry
    // already spans clip space; no projection needed.
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
