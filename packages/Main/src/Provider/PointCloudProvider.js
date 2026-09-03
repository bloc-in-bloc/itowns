import * as THREE from 'three';

// Picking ids are encoded in the RGBA channels of a render target, so we have
// 32 bits available. Rather than splitting them into a fixed object id / point
// index pair (which used to cap both to 16 bits), each Points object is given a
// contiguous range of the global 32 bits id space: the point at local index `i`
// of an object gets the id `baseId + i`. Decoding is then a matter of finding
// the object whose range contains the read value.
// Id 0 is reserved so that background pixels (0, 0, 0, 0) match no point.
const MAX_PICKING_ID = 0xffffffff;
let nextPickingId = 1;

function addPickingAttribute(points) {
    // generate unique id for picking
    const numPoints = points.geometry.attributes.position.count;
    const baseId = nextPickingId;

    if (numPoints > MAX_PICKING_ID - baseId) {
        console.warn('Picking id space exhausted: picking is disabled for this Points instance');
        return points;
    }
    nextPickingId += numPoints;

    const ids = new Uint8Array(4 * numPoints);
    for (let i = 0; i < numPoints; i++) {
        const v = baseId + i;
        ids[4 * i + 0] = (v >>> 24) & 0xff;
        ids[4 * i + 1] = (v >>> 16) & 0xff;
        ids[4 * i + 2] = (v >>> 8) & 0xff;
        ids[4 * i + 3] = v & 0xff;
    }

    points.baseId = baseId;
    points.pickingIdCount = numPoints;
    points.geometry.setAttribute('unique_id', new THREE.BufferAttribute(ids, 4, true));
    return points;
}

export default {
    executeCommand(command) {
        const layer = command.layer;
        const node = command.requester;

        return node.load().then((geometry) => {
            const points = new THREE.Points(geometry, layer.material);
            addPickingAttribute(points);
            points.frustumCulled = false;
            points.matrixAutoUpdate = false;
            points.position.fromArray(geometry.userData.position);
            points.quaternion.fromArray(geometry.userData.quaternion).invert();
            points.updateMatrix();

            points.layer = layer;
            points.userData.node = node;
            return points;
        });
    },
};
