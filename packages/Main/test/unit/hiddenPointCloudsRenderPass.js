import assert from 'assert';
import * as THREE from 'three';
import HiddenPointCloudsRenderPass from 'Renderer/HiddenPointCloudsRenderPass';
import Renderer from './bootstrap';

describe('HiddenPointCloudsRenderPass', function () {
    it('should hide point cloud layers only while rendering, then restore visibility', function () {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();

        const pointCloudObject3d = new THREE.Object3D();
        pointCloudObject3d.visible = true;
        scene.add(pointCloudObject3d);

        const otherObject3d = new THREE.Object3D();
        otherObject3d.visible = true;
        scene.add(otherObject3d);

        const pointCloudLayer = { isPointCloudLayer: true, object3d: pointCloudObject3d };
        const view = {
            scene,
            camera3D: camera,
            getLayers: filter => [pointCloudLayer].filter(l => !filter || filter(l)),
        };

        const pass = new HiddenPointCloudsRenderPass(view);

        const renderer = new Renderer();
        let visibilityDuringRender;
        renderer.render = () => {
            visibilityDuringRender = pointCloudObject3d.visible;
        };

        pass.render(renderer, /* inputBuffer */ { texture: null }, /* outputBuffer */ null);

        assert.equal(visibilityDuringRender, false, 'point cloud object3d must be hidden during render');
        assert.equal(pointCloudObject3d.visible, true, 'point cloud object3d must be restored after render');
        assert.equal(otherObject3d.visible, true, 'non point cloud object3d must stay untouched');
    });
});
