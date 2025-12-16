import { Vector3 } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { getCenter, offsetPoints } from "three-geojson/src/FlatVertexBufferUtils";

const _vec = /* @__PURE__ */ new Vector3();

// Inspired from https://github.com/gkjohnson/three-geojson/blob/main/src/constructLineObject.js
export function constructLineSegments2(lineStrings, lineMaterial) {
    // calculate total segments
    let totalSegments = 0;
    lineStrings.forEach(vertices => {
        const segments = vertices.length - 1;
        totalSegments = totalSegments + segments * 2;
    });

    // roll up all the vertices
    let index = 0;
    const posArray = new Array(totalSegments * 3);
    const vertexCounts = [];
    lineStrings.forEach(vertices => {
        const length = vertices.length;
        const segments = length - 1;
        for (let i = 0; i < segments; i++) {
            const ni = (i + 1) % length;

            const v0 = vertices[i];
            const v1 = vertices[ni];
            posArray[index + 0] = v0[0];
            posArray[index + 1] = v0[1];
            posArray[index + 2] = v0[2] || 0;

            posArray[index + 3] = v1[0];
            posArray[index + 4] = v1[1];
            posArray[index + 5] = v1[2] || 0;

            index = index + 6;
        }

        vertexCounts.push(segments * 2);
    });

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(posArray);
    const lineSegments = new LineSegments2(geometry, lineMaterial);

    // center the shape
    getCenter(posArray, lineSegments.position);
    _vec.copy(lineSegments.position).multiplyScalar(-1);
    offsetPoints(posArray, ..._vec);
    geometry.setPositions(posArray);

    return lineSegments;
}
