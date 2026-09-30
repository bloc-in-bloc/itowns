import {
    type Camera,
    type Scene,
    type WebGLRenderer,
    HalfFloatType,
} from 'three';
import { EffectComposer, LambdaPass, RenderPass, CopyPass } from 'postprocessing';
import { View, Layer } from 'Main';
import { EDLPass } from './Postprocessing/EDLPass';
import { HQSplatsPass } from './Postprocessing/HQSplatsPass';

type LayerWithObject3d = Layer & { object3d: { visible: boolean } };

class PointCloudRenderer {
    private _composer: EffectComposer;
    private _edlPass: EDLPass;
    private _hqSplatsPass: HQSplatsPass;
    private _terrainPass: RenderPass;
    private _fallbackPass: RenderPass;
    private _copyPass: CopyPass;

    private _currentOthers: LayerWithObject3d[] = [];
    private _currentPCs: LayerWithObject3d[] = [];

    constructor(renderer: WebGLRenderer, width: number, height: number) {
        this._composer = new EffectComposer(renderer, {
            frameBufferType: HalfFloatType,
        });
        this._terrainPass = new RenderPass();
        this._edlPass = new EDLPass(width, height);
        this._edlPass.enabled = false;
        this._hqSplatsPass = new HQSplatsPass(this._edlPass, width, height);

        this._fallbackPass = new RenderPass();
        this._fallbackPass.clear = false;
        this._copyPass = new CopyPass();

        this._composer.addPass(new LambdaPass(() => {
            this._currentOthers.forEach((l) => { l.object3d.visible = true; });
            this._currentPCs.forEach((l) => { l.object3d.visible = false; });
        }));
        this._composer.addPass(this._terrainPass);
        this._composer.addPass(new LambdaPass(() => {
            this._currentOthers.forEach((l) => { l.object3d.visible = false; });
            // In HQ mode, point clouds must only be drawn by the HQ pass,
            // otherwise they pollute the color and depth it relies on.
            const visible = !this._hqSplatsPass.enabled;
            this._currentPCs.forEach((l) => { l.object3d.visible = visible; });
        }));
        this._composer.addPass(this._edlPass);
        this._composer.addPass(this._fallbackPass);
        this._composer.addPass(new LambdaPass(() => {
            this._currentOthers.forEach((l) => { l.object3d.visible = false; });
            this._currentPCs.forEach((l) => { l.object3d.visible = true; });
        }));
        this._composer.addPass(this._hqSplatsPass);
        this._composer.addPass(this._copyPass);
    }

    get edlPass(): EDLPass {
        return this._edlPass;
    }

    get hqSplatsPass(): HQSplatsPass {
        return this._hqSplatsPass;
    }

    setSize(width: number, height: number) {
        this._composer.setSize(width, height);
    }

    render(scene: Scene, camera: Camera, view: View) {
        const edl = this._edlPass.enabled;
        const hq = this._hqSplatsPass.enabled;

        this._fallbackPass.enabled = !edl;
        this._copyPass.enabled = !edl && !hq;
        this._edlPass.renderToScreen = edl && !hq;
        this._hqSplatsPass.renderToScreen = hq;

        const layers = view.getLayers(l => l.isGeometryLayer && l.visible);
        this._currentOthers = layers.filter(l => !l.isPointCloudLayer);
        this._currentPCs = layers.filter(l => l.isPointCloudLayer);

        // @ts-expect-error PointsMaterial/Layer are not typed yet
        this._hqSplatsPass.pointCloudLayers = hq ? this._currentPCs : [];

        this._composer.setMainCamera(camera);
        this._composer.setMainScene(scene);
        this._composer.render();

        // Restore visibility after all passes have run
        // Needs to be done here as Lambda pass would break final render
        this._currentOthers.forEach((l) => { l.object3d.visible = true; });
        this._currentPCs.forEach((l) => { l.object3d.visible = true; });
    }
}

export default PointCloudRenderer;
