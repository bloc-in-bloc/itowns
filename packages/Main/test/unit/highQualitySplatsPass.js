import assert from 'assert';
import * as THREE from 'three';
import HighQualitySplatsPass from 'Renderer/HighQualitySplatsPass';
import PointsMaterial from 'Renderer/PointsMaterial';
import Renderer from './bootstrap';

function createPointCloudLayer() {
    const object3d = new THREE.Object3D();
    const group = new THREE.Group();
    object3d.add(group);
    const material = new PointsMaterial();
    const points = new THREE.Points(new THREE.BufferGeometry(), material);
    group.add(points);

    return {
        isPointCloudLayer: true,
        visible: true,
        object3d,
        group,
        material,
    };
}

function createView(layers) {
    const scene = new THREE.Scene();
    layers.forEach(l => scene.add(l.object3d));

    return {
        scene,
        camera3D: new THREE.PerspectiveCamera(),
        getLayers: filter => layers.filter(l => !filter || filter(l)),
    };
}

describe('HighQualitySplatsPass', function () {
    it('should have needsDepthTexture set so the composer shares its depth texture', function () {
        const pass = new HighQualitySplatsPass(createView([]));
        assert.equal(pass.needsDepthTexture, true);
    });

    it('should copy the beauty depth texture via setDepthTexture()', function () {
        const pass = new HighQualitySplatsPass(createView([]));
        const depthTexture = new THREE.DepthTexture();
        pass.setDepthTexture(depthTexture);
        assert.equal(pass.fullscreenMaterial.uniforms.uBeautyDepth.value, depthTexture);
    });

    it('should pass through the beauty buffer and mark the composite inactive when there is no visible point cloud layer', function () {
        const view = createView([]);
        const pass = new HighQualitySplatsPass(view);
        pass.setSize(4, 4);

        const renderer = new Renderer();
        const inputBuffer = { texture: new THREE.Texture() };
        const outputBuffer = { texture: new THREE.Texture() };

        const renderCalls = [];
        renderer.render = (scene, camera) => renderCalls.push({ scene, camera });

        pass.render(renderer, inputBuffer, outputBuffer);

        assert.equal(pass.fullscreenMaterial.uniforms.uActive.value, false);
        assert.equal(pass.fullscreenMaterial.uniforms.uBeautyMap.value, inputBuffer.texture);
        assert.equal(renderCalls.length, 1, 'only the composite draw should happen');
        assert.equal(renderCalls[0].scene, pass.scene);
    });

    it('should render points with the depth/attribute materials and restore the original material', function () {
        const layer = createPointCloudLayer();
        const view = createView([layer]);
        const pass = new HighQualitySplatsPass(view);
        pass.setSize(4, 4);

        const renderer = new Renderer();
        const inputBuffer = { texture: new THREE.Texture() };
        const outputBuffer = { texture: new THREE.Texture() };
        const points = layer.group.children[0];

        const materialsDuringRender = [];
        const originalRender = renderer.render.bind(renderer);
        renderer.render = (scene, camera) => {
            materialsDuringRender.push(points.material);
            originalRender(scene, camera);
        };

        pass.render(renderer, inputBuffer, outputBuffer);

        assert.equal(materialsDuringRender.length, 3, 'depth pass, attribute pass, then composite');
        assert.equal(materialsDuringRender[0].weighted, false, 'depth pass material must not be weighted');
        assert.equal(materialsDuringRender[1].weighted, true, 'attribute pass material must be weighted');
        assert.equal(points.material, layer.material, 'original material must be restored after both passes');
        assert.equal(pass.fullscreenMaterial.uniforms.uActive.value, true);
    });

    it('should hide non point-cloud objects during the depth/attribute passes only', function () {
        const layer = createPointCloudLayer();
        const view = createView([layer]);
        const otherObject3d = new THREE.Object3D();
        view.scene.add(otherObject3d);

        const pass = new HighQualitySplatsPass(view);
        pass.setSize(4, 4);

        const renderer = new Renderer();
        const visibilitySamples = [];
        renderer.render = () => visibilitySamples.push(otherObject3d.visible);

        pass.render(renderer, { texture: new THREE.Texture() }, { texture: new THREE.Texture() });

        assert.deepEqual(visibilitySamples, [false, false, true], 'hidden for depth+attribute, visible again for composite');
        assert.equal(otherObject3d.visible, true, 'must be restored after render()');
    });
});
