const TIFF_TYPE_SIZE = { 3: 2, 4: 4, 12: 8 };
const WEB_MERCATOR_EXTENT = 40075016.68557849;

function mercatorToMeters(x, y) {
    return [(x - 0.5) * WEB_MERCATOR_EXTENT, (0.5 - y) * WEB_MERCATOR_EXTENT];
}

function geoTransformTags([topLeft, topRight, , bottomLeft], width, height) {
    const [x0, y0] = mercatorToMeters(...topLeft);
    const [x1, y1] = mercatorToMeters(...topRight);
    const [x2, y2] = mercatorToMeters(...bottomLeft);
    const a = (x1 - x0) / width;
    const b = (x2 - x0) / height;
    const d = (y1 - y0) / width;
    const e = (y2 - y0) / height;
    const scale = Math.max(Math.abs(a), Math.abs(e));
    if (Math.abs(b) < scale * 1e-9 && Math.abs(d) < scale * 1e-9) {
        return [
            [33550, 12, [a, -e, 0]],
            [33922, 12, [0, 0, 0, x0, y0, 0]]
        ];
    }
    return [[34264, 12, [a, b, 0, x0, d, e, 0, y0, 0, 0, 0, 0, 0, 0, 0, 1]]];
}

function encodeGeoTIFF(rgba, width, height, mercatorCorners) {
    const rowBytes = width * 4;
    const rowsPerStrip = Math.max(1, Math.floor(65536 / rowBytes));
    const stripCount = Math.ceil(height / rowsPerStrip);
    const dataOffset = 8;
    const offsets = [];
    const counts = [];
    for (let i = 0; i < stripCount; i++) {
        const rows = Math.min(rowsPerStrip, height - i * rowsPerStrip);
        offsets.push(dataOffset + i * rowsPerStrip * rowBytes);
        counts.push(rows * rowBytes);
    }

    const entries = [
        [256, 4, [width]],
        [257, 4, [height]],
        [258, 3, [8, 8, 8, 8]],
        [259, 3, [1]],
        [262, 3, [2]],
        [273, 4, offsets],
        [277, 3, [4]],
        [278, 4, [rowsPerStrip]],
        [279, 4, counts],
        [284, 3, [1]],
        [338, 3, [2]],
        ...geoTransformTags(mercatorCorners, width, height),
        [34735, 3, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857]]
    ];

    const ifdOffset = dataOffset + rgba.byteLength;
    const ifdSize = 2 + entries.length * 12 + 4;
    let extraOffset = ifdOffset + ifdSize;
    const extraSize = entries.reduce((sum, [, type, values]) => {
        const size = TIFF_TYPE_SIZE[type] * values.length;
        return sum + (size > 4 ? size + (size % 2) : 0);
    }, 0);

    const buffer = new ArrayBuffer(extraOffset + extraSize);
    const view = new DataView(buffer);
    view.setUint16(0, 0x4949);
    view.setUint16(2, 42, true);
    view.setUint32(4, ifdOffset, true);
    new Uint8Array(buffer, dataOffset, rgba.byteLength).set(rgba);

    const writeValues = (offset, type, values) => {
        values.forEach((v, i) => {
            const at = offset + i * TIFF_TYPE_SIZE[type];
            if (type === 3) view.setUint16(at, v, true);
            else if (type === 4) view.setUint32(at, v, true);
            else view.setFloat64(at, v, true);
        });
    };

    view.setUint16(ifdOffset, entries.length, true);
    entries.forEach(([tag, type, values], i) => {
        const at = ifdOffset + 2 + i * 12;
        const size = TIFF_TYPE_SIZE[type] * values.length;
        view.setUint16(at, tag, true);
        view.setUint16(at + 2, type, true);
        view.setUint32(at + 4, values.length, true);
        if (size <= 4) {
            writeValues(at + 8, type, values);
        } else {
            view.setUint32(at + 8, extraOffset, true);
            writeValues(extraOffset, type, values);
            extraOffset += size + (size % 2);
        }
    });
    view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true);
    return buffer;
}

async function downloadGeoTIFF(bitmap, mercatorCorners, filename) {
    await new Promise(r => setTimeout(r, 0));
    const { width, height } = bitmap;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const tiff = encodeGeoTIFF(ctx.getImageData(0, 0, width, height).data, width, height, mercatorCorners);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([tiff], { type: 'image/tiff' }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

window.encodeGeoTIFF = encodeGeoTIFF;
window.downloadGeoTIFF = downloadGeoTIFF;
