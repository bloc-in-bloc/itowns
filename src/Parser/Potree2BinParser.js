import * as THREE from 'three';
import { spawn, Pool, Transfer } from 'threads';

let _pool;
function getPool() {
    const initWorker = () => new Worker(
        new URL('../Worker/Potree2Worker.js', import.meta.url),
    );
    _pool = Pool(async () => spawn(initWorker()), {
        size: 1,
    });
    return _pool;
}

function decoder(w, metadata) {
    return metadata.encoding === 'BROTLI' ? w.parseBrotli : w.parse;
}

export default {
    /** @module Potree2BinParser */
    /** Parse .bin PotreeConverter 2.0 format and convert to a THREE.BufferGeometry
     * @function parse
     * @param {ArrayBuffer} buffer - the bin buffer.
     * @param {Object} options
     * @param {string[]} options.in.pointAttributes - the point attributes information contained in metadata.js
     * @return {Promise} - a promise that resolves with a THREE.BufferGeometry.
     *
     */
    parse: async function parse(buffer, options) {
        const metadata = options.in.source.metadata;
        const layer = options.out;

        const pointAttributes = layer.pointAttributes;
        const scale = metadata.scale;
        const box = options.in.bbox;
        const min = box.min;
        const size = box.max.clone().sub(box.min);
        const max = box.max;
        const offset = metadata.offset;
        const numPoints = options.in.numPoints;

        const pool = getPool();
        const data = await pool.queue((w) => {
            const decode = decoder(w, metadata);
            return decode(Transfer(buffer), {
                pointAttributes,
                scale,
                min,
                max,
                size,
                offset,
                numPoints,
            });
        });

        const buffers = data.attributeBuffers;
        const geometry = new THREE.BufferGeometry();
        Object.keys(buffers).forEach((property) => {
            const buffer = buffers[property].buffer;

            if (property === 'position') {
                geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer), 3));
            } else if (property === 'rgba') {
                geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buffer), 4, true));
            } else if (property === 'NORMAL') {
                geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buffer), 3));
            } else if (property === 'INDICES') {
                const bufferAttribute = new THREE.BufferAttribute(new Uint8Array(buffer), 4);
                bufferAttribute.normalized = true;
                geometry.setAttribute('indices', bufferAttribute);
            } else {
                const bufferAttribute = new THREE.BufferAttribute(new Float32Array(buffer), 1);

                const batchAttribute = buffers[property].attribute;
                bufferAttribute.potree = {
                    offset: buffers[property].offset,
                    scale: buffers[property].scale,
                    preciseBuffer: buffers[property].preciseBuffer,
                    range: batchAttribute.range,
                };

                geometry.setAttribute(property, bufferAttribute);
            }
        });

        geometry.computeBoundingBox();

        return { geometry, density: data.density };
    },
};
