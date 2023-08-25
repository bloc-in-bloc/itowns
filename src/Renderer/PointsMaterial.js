import * as THREE from 'three';
import PointsVS from 'Renderer/Shader/PointsVS.glsl';
import PointsFS from 'Renderer/Shader/PointsFS.glsl';
import Capabilities from 'Core/System/Capabilities';
import ShaderUtils from 'Renderer/Shader/ShaderUtils';
import CommonMaterial from 'Renderer/CommonMaterial';

export const PNTS_MODE = {
    COLOR: 0,
    INTENSITY: 1,
    CLASSIFICATION: 2,
    NORMAL: 3,
};

export const PNTS_SIZE = {
    VALUE: 0,
    ADAPTIVE: 1,
};

export const PNTS_SHAPE = {
    CIRCLE: 0,
    SQUARE: 1,
};

const white = new THREE.Color(1.0,  1.0,  1.0);

/**
 * Every lidar point can have a classification assigned to it that defines
 * the type of object that has reflected the laser pulse. Lidar points can be
 * classified into a number of categories including bare earth or ground,
 * top of canopy, and water. The different classes are defined using numeric
 * integer codes in the files.
 *
 * @property {object} category - category classification,
 * @property {boolean} category.visible - category visibility,
 * @property {string} category.name - category name,
 * @property {THREE.Color} category.color - category color,
 * @property {number} category.opacity - category opacity,
 */
// eslint-disable-next-line
class /* istanbul ignore next */ Classification {}

export const ClassificationScheme = {
    DEFAULT: {
        0: { visible: true, name: 'never classified', color: new THREE.Color(0.5,  0.5,  0.5), opacity: 1.0 },
        1: { visible: true, name: 'unclassified', color: new THREE.Color(0.5,  0.5,  0.5), opacity: 1.0 },
        2: { visible: true, name: 'ground', color: new THREE.Color(0.63, 0.32, 0.18), opacity: 1.0 },
        3: { visible: true, name: 'low vegetation', color: new THREE.Color(0.0,  1.0,  0.0), opacity: 1.0 },
        4: { visible: true, name: 'medium vegetation', color: new THREE.Color(0.0,  0.8,  0.0), opacity: 1.0 },
        5: { visible: true, name: 'high vegetation', color: new THREE.Color(0.0,  0.6,  0.0), opacity: 1.0 },
        6: { visible: true, name: 'building', color: new THREE.Color(1.0,  0.66, 0.0), opacity: 1.0 },
        7: { visible: true, name: 'low point(noise)', color: new THREE.Color(1.0,  0.0,  1.0), opacity: 1.0 },
        8: { visible: true, name: 'key-point', color: new THREE.Color(1.0,  0.0,  0.0), opacity: 1.0 },
        9: { visible: true, name: 'water', color: new THREE.Color(0.0,  0.0,  1.0), opacity: 1.0 },
        10: { visible: true, name: 'rail', color: new THREE.Color(0.8,  0.8,  1.0), opacity: 1.0 },
        11: { visible: true, name: 'road Surface', color: new THREE.Color(0.4,  0.4,  0.7), opacity: 1.0 },
        12: { visible: true, name: 'overlap', color: new THREE.Color(1.0,  1.0,  0.0), opacity: 1.0 },
        DEFAULT: { visible: true, name: 'default', color: new THREE.Color(0.3,  0.6,  0.6), opacity: 0.5 },
    },
};

class PointsMaterial extends THREE.RawShaderMaterial {
    /**
     * @class      PointsMaterial
     * @param      {object}  [options={}]  The options
     * @param      {number}  [options.size=0]  size point
     * @param      {number}  [options.mode=PNTS_MODE.COLOR]  display mode.
     * @param      {number}  [options.mode=PNTS_SHAPE.CIRCLE]  rendered points shape.
     * @param      {THREE.Vector4}  [options.overlayColor=new THREE.Vector4(0, 0, 0, 0)]  overlay color.
     * @param      {THREE.Vector2}  [options.intensityRange=new THREE.Vector2(0, 1)]  intensity range.
     * @param      {boolean}  [options.applyOpacityClassication=false]  apply opacity classification on all display mode.
     * @param      {Classification}  [options.classification] -  define points classification.
     * @param      {number}  [options.sizeMode=SIZE_MODE.VALUE]  point cloud size mode. Only 'VALUE' or 'ADAPTIVE' are possible. VALUE use constant size, ADAPTIVE compute size depending on distance from point to camera.
     * @param      {number}  [options.adaptiveScale=1]  scale factor used by 'ADAPTIVE' size mode
     * @param      {number}  [options.minAdaptiveSize=3]  minimum scale used by 'ADAPTIVE' size mode
     * @param      {number}  [options.maxAdaptiveSize=10]  maximum scale used by 'ADAPTIVE' size mode
     * @property {Classification}  classification - points classification.
     *
     * @example
     * // change color category classification
     * const pointMaterial = new PointsMaterial();
     * pointMaterial.classification[3].color.setStyle('red');
     * pointMaterial.recomputeClassification();
     */
    constructor(options = {}) {
        const intensityRange = options.intensityRange || new THREE.Vector2(0, 1);
        const oiMaterial = options.orientedImageMaterial;
        const classification = options.classification || ClassificationScheme.DEFAULT;
        const applyOpacityClassication = options.applyOpacityClassication == undefined ? false : options.applyOpacityClassication;
        let size = options.size || 0;
        const mode = options.mode || PNTS_MODE.COLOR;
        const shape = options.shape || PNTS_SHAPE.CIRCLE;
        const sizeMode = size === 0 ? PNTS_SIZE.ADAPTIVE : (options.sizeMode || PNTS_SIZE.VALUE);
        if ((sizeMode === PNTS_SIZE.ADAPTIVE) && (size !== 0)) {
            size = 0;
        }
        const minAdaptiveSize = options.minAdaptiveSize || 3;
        const maxAdaptiveSize = options.maxAdaptiveSize || 10;
        const adaptiveScale = options.adaptiveScale || 1;

        delete options.orientedImageMaterial;
        delete options.intensityRange;
        delete options.classification;
        delete options.applyOpacityClassication;
        delete options.size;
        delete options.mode;
        delete options.shape;
        delete options.sizeMode;
        delete options.minAdaptiveSize;
        delete options.maxAdaptiveSize;
        delete options.adaptiveScale;

        super(options);

        this.vertexShader = PointsVS;

        this.scale = options.scale || 0.05 * 0.5 / Math.tan(1.0 / 2.0); // autosizing scale

        CommonMaterial.setDefineMapping(this, 'PNTS_MODE', PNTS_MODE);
        CommonMaterial.setDefineMapping(this, 'PNTS_SHAPE', PNTS_SHAPE);
        CommonMaterial.setDefineMapping(this, 'PNTS_SIZE', PNTS_SIZE);

        CommonMaterial.setUniformProperty(this, 'size', size);
        CommonMaterial.setUniformProperty(this, 'mode', mode);
        CommonMaterial.setUniformProperty(this, 'shape', shape);
        CommonMaterial.setUniformProperty(this, 'picking', false);
        CommonMaterial.setUniformProperty(this, 'opacity', this.opacity);
        CommonMaterial.setUniformProperty(this, 'overlayColor', options.overlayColor || new THREE.Vector4(0, 0, 0, 0));
        CommonMaterial.setUniformProperty(this, 'intensityRange', intensityRange);
        CommonMaterial.setUniformProperty(this, 'applyOpacityClassication', applyOpacityClassication);
        CommonMaterial.setUniformProperty(this, 'sizeMode', sizeMode);
        CommonMaterial.setUniformProperty(this, 'minAdaptiveSize', minAdaptiveSize);
        CommonMaterial.setUniformProperty(this, 'maxAdaptiveSize', maxAdaptiveSize);
        CommonMaterial.setUniformProperty(this, 'adaptiveScale', adaptiveScale);

        // add classification texture to apply classification lut.
        const data = new Uint8Array(256 * 4);
        const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
        texture.needsUpdate = true;
        texture.magFilter = THREE.NearestFilter;
        CommonMaterial.setUniformProperty(this, 'classificationLUT', texture);

        // Classification scheme
        this.classification = classification;

        // Update classification
        this.recomputeClassification();

        if (oiMaterial) {
            this.uniforms.projectiveTextureAlphaBorder = oiMaterial.uniforms.projectiveTextureAlphaBorder;
            this.uniforms.projectiveTextureDistortion = oiMaterial.uniforms.projectiveTextureDistortion;
            this.uniforms.projectiveTextureMatrix = oiMaterial.uniforms.projectiveTextureMatrix;
            this.uniforms.projectiveTexture = oiMaterial.uniforms.projectiveTexture;
            this.uniforms.mask = oiMaterial.uniforms.mask;
            this.uniforms.boostLight = oiMaterial.uniforms.boostLight;
            this.defines.ORIENTED_IMAGES_COUNT = oiMaterial.defines.ORIENTED_IMAGES_COUNT;
            this.defines.USE_DISTORTION = oiMaterial.defines.USE_DISTORTION;
            this.defines.DEBUG_ALPHA_BORDER = oiMaterial.defines.DEBUG_ALPHA_BORDER;
            this.defines.USE_TEXTURES_PROJECTIVE = true;
            this.defines.USE_BASE_MATERIAL = true;
            this.fragmentShader = ShaderUtils.unrollLoops(PointsFS, this.defines);
        } else {
            this.fragmentShader = PointsFS;
        }

        if (Capabilities.isLogDepthBufferSupported()) {
            this.defines.USE_LOGDEPTHBUF = 1;
            this.defines.USE_LOGDEPTHBUF_EXT = 1;
        }

        if (__DEBUG__) {
            this.defines.DEBUG = 1;
        }
    }

    recomputeClassification() {
        const classification = this.classification;
        const data = this.classificationLUT.image.data;
        const width = this.classificationLUT.image.width;

        for (let i = 0; i < width; i++) {
            let color;
            let opacity;
            let visible = true;

            if (classification[i]) {
                color = classification[i].color;
                visible = classification[i].visible;
                opacity = classification[i].opacity;
            } else if (classification[i % 32]) {
                color = classification[i % 32].color;
                visible = classification[i % 32].visible;
                opacity = classification[i % 32].opacity;
            } else if (classification.DEFAULT) {
                color = classification.DEFAULT.color;
                visible = classification.DEFAULT.visible;
                opacity = classification.DEFAULT.opacity;
            } else {
                color = white;
                opacity = 1.0;
            }

            const j = 4 * i;
            data[j + 0] = parseInt(255 * color.r, 10);
            data[j + 1] = parseInt(255 * color.g, 10);
            data[j + 2] = parseInt(255 * color.b, 10);
            data[j + 3] = visible ? parseInt(255 * opacity, 10) : 0;
        }

        this.classificationLUT.needsUpdate = true;

        this.dispatchEvent({
            type: 'material_property_changed',
            target: this,
        });
    }


    onBeforeCompile(shader, renderer) {
        if (renderer.capabilities.isWebGL2) {
            this.defines.WEBGL2 = true;
            shader.glslVersion = '300 es';
        }
    }

    copy(source) {
        super.copy(source);
        if (source.uniforms.projectiveTextureAlphaBorder) {
            // Don't copy oriented image because, it's a link to oriented image material.
            // It needs a reference to oriented image material.
            this.uniforms.projectiveTextureAlphaBorder = source.uniforms.projectiveTextureAlphaBorder;
            this.uniforms.projectiveTextureDistortion = source.uniforms.projectiveTextureDistortion;
            this.uniforms.projectiveTextureMatrix = source.uniforms.projectiveTextureMatrix;
            this.uniforms.projectiveTexture = source.uniforms.projectiveTexture;
            this.uniforms.mask = source.uniforms.mask;
            this.uniforms.boostLight = source.uniforms.boostLight;
        }
        return this;
    }

    enablePicking(picking) {
        this.picking = picking;
        this.blending = picking ? THREE.NoBlending : THREE.NormalBlending;
    }

    update(source) {
        this.visible = source.visible;
        this.opacity = source.opacity;
        this.transparent = source.transparent;
        this.size = source.size;
        this.mode = source.mode;
        this.pntsShape = source.shape;
        this.sizeMode = source.sizeMode;
        this.adaptiveScale = source.adaptiveScale;
        this.minAdaptiveSize = source.minAdaptiveSize;
        this.maxAdaptiveSize = source.maxAdaptiveSize;
        this.picking = source.picking;
        this.scale = source.scale;
        this.overlayColor.copy(source.overlayColor);
        this.intensityRange.copy(source.intensityRange);
        Object.assign(this.defines, source.defines);
        return this;
    }
}

export default PointsMaterial;
