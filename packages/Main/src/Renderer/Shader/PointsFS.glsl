#define USE_COLOR_ALPHA

#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

uniform vec3 diffuse;
uniform float opacity;
uniform float ambientBoost;

uniform bool picking;
uniform int shape;
uniform bool weighted;
uniform float hardness;

void main() {

// Early discard (clipping planes and shape)
#include <clipping_planes_fragment>
    // Normalized distance to the splat center, in [0, 1] range (0 = center).
    float splatDistance = length(2.0 * gl_PointCoord - 1.0);
    if (shape == PNTS_SHAPE_CIRCLE) {
        //circular rendering in glsl
        if (splatDistance > 1.0) {
            discard;
        }
    }

#include <logdepthbuf_fragment>

    vec4 diffuseColor = vec4(diffuse, opacity);
#include <map_particle_fragment>
#include <color_fragment>

#include <alphatest_fragment>
#include <alphahash_fragment>

    vec3 outgoingLight = diffuseColor.rgb;

    outgoingLight = max(outgoingLight, vec3(ambientBoost));

    if (weighted) {
        // High-Quality Splats attribute pass (Schütz 2016 thesis, Eq. 4.1):
        // accumulate a weighted sum of colors in .rgb and a sum of weights in
        // .a, via additive blending set up by HighQualitySplatsPass. This is
        // an intermediate accumulation buffer, not a final display color, so
        // fog/tonemapping/colorspace/premultiplied-alpha do not apply here.
        float weight = pow(max(0.0, 1.0 - splatDistance * splatDistance), hardness);
        gl_FragColor = vec4(outgoingLight * weight, weight);
        return;
    }

#include <opaque_fragment> // gl_FragColor
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
#include <premultiplied_alpha_fragment>

}
