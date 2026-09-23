import { RenderPass } from 'postprocessing';

/**
 * A `RenderPass` that temporarily hides every visible point-cloud layer's
 * `object3d` while it renders, so the rest of the scene (the "beauty" pass)
 * is drawn without point clouds. Used by the High-Quality Splats rendering
 * mode ({@link View#pointCloudQuality}), whose own {@link HighQualitySplatsPass}
 * renders the point clouds separately afterward.
 */
class HiddenPointCloudsRenderPass extends RenderPass {
    /**
     * @param {View} view - the view whose scene/camera should be rendered.
     */
    constructor(view) {
        super(view.scene, view.camera3D);
        this.view = view;
    }

    render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
        const pointCloudLayers = this.view.getLayers(l => l.isPointCloudLayer);
        const visibility = pointCloudLayers.map(l => l.object3d.visible);
        pointCloudLayers.forEach((l) => { l.object3d.visible = false; });

        super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);

        pointCloudLayers.forEach((l, i) => { l.object3d.visible = visibility[i]; });
    }
}

export default HiddenPointCloudsRenderPass;
