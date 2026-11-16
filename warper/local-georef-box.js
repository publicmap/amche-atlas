const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const EDGE_NORMALS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ROTATE_SNAP = Math.PI / 12;
const MIN_BOX_SIZE = 1e-9;

function boxToWorld(box, lx, ly) {
    const cos = Math.cos(box.angle);
    const sin = Math.sin(box.angle);
    return [box.cx + lx * cos - ly * sin, box.cy + lx * sin + ly * cos];
}

function boxToLocal(box, [px, py], [ox, oy]) {
    const cos = Math.cos(box.angle);
    const sin = Math.sin(box.angle);
    const dx = px - ox;
    const dy = py - oy;
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

function boxFromAnchor(box, [fx, fy], w, h, hx, hy) {
    const [cx, cy] = boxToWorld({ ...box, cx: fx, cy: fy }, hx, hy);
    return { ...box, w, h, cx, cy };
}

function resizeBoxFromCorner(box, i, p, aspect = null) {
    const [sx, sy] = CORNER_SIGNS[i];
    const anchor = boxToWorld(box, -sx * box.w / 2, -sy * box.h / 2);
    const [lx, ly] = boxToLocal(box, p, anchor);
    let w = Math.max(sx * lx, MIN_BOX_SIZE);
    let h = Math.max(sy * ly, MIN_BOX_SIZE);
    if (aspect) {
        w = Math.max(w, h * aspect);
        h = w / aspect;
    }
    return boxFromAnchor(box, anchor, w, h, sx * w / 2, sy * h / 2);
}

function resizeBoxFromEdge(box, i, p, aspect = null) {
    const [nx, ny] = EDGE_NORMALS[i];
    const anchor = boxToWorld(box, -nx * box.w / 2, -ny * box.h / 2);
    const [lx, ly] = boxToLocal(box, p, anchor);
    let w = nx ? Math.max(nx * lx, MIN_BOX_SIZE) : box.w;
    let h = ny ? Math.max(ny * ly, MIN_BOX_SIZE) : box.h;
    if (aspect && nx) h = w / aspect;
    if (aspect && ny) w = h * aspect;
    return boxFromAnchor(box, anchor, w, h, nx * w / 2, ny * h / 2);
}

function boxAnchor(box) {
    return boxToWorld(box, (box.ax || 0) * box.w / 2, (box.ay || 0) * box.h / 2);
}

function boxWithAnchorAt(box, [ax, ay], w, h) {
    const [ox, oy] = boxToWorld({ ...box, cx: 0, cy: 0 }, (box.ax || 0) * w / 2, (box.ay || 0) * h / 2);
    return { ...box, w, h, cx: ax - ox, cy: ay - oy };
}

function scaleAxis(pointer, side, anchor, current) {
    const span = side - anchor;
    if (Math.abs(span) < 1e-6) return current;
    return Math.max(2 * pointer / span, MIN_BOX_SIZE);
}

function scaleBoxFromCorner(box, i, p, aspect = null) {
    const [sx, sy] = CORNER_SIGNS[i];
    const anchor = boxAnchor(box);
    const [lx, ly] = boxToLocal(box, p, anchor);
    let w = scaleAxis(lx, sx, box.ax || 0, box.w);
    let h = scaleAxis(ly, sy, box.ay || 0, box.h);
    if (aspect) {
        w = Math.max(w, h * aspect);
        h = w / aspect;
    }
    return boxWithAnchorAt(box, anchor, w, h);
}

function scaleBoxFromEdge(box, i, p, aspect = null) {
    const [nx, ny] = EDGE_NORMALS[i];
    const anchor = boxAnchor(box);
    const [lx, ly] = boxToLocal(box, p, anchor);
    let w = nx ? scaleAxis(lx, nx, box.ax || 0, box.w) : box.w;
    let h = ny ? scaleAxis(ly, ny, box.ay || 0, box.h) : box.h;
    if (aspect && nx) h = w / aspect;
    if (aspect && ny) w = h * aspect;
    return boxWithAnchorAt(box, anchor, w, h);
}

function moveBoxAnchor(box, p, snapDistance) {
    const [lx, ly] = boxToLocal(box, p, [box.cx, box.cy]);
    let ax = lx / (box.w / 2);
    let ay = ly / (box.h / 2);
    for (const tx of [-1, 0, 1]) {
        for (const ty of [-1, 0, 1]) {
            if (Math.hypot((ax - tx) * box.w / 2, (ay - ty) * box.h / 2) < snapDistance) {
                ax = tx;
                ay = ty;
            }
        }
    }
    return { ...box, ax, ay };
}

function snapAngle(angle, snap) {
    return snap ? Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP : angle;
}

function rotateBoxBy(startBox, [sx, sy], [px, py], snap = false) {
    const [ax, ay] = boxAnchor(startBox);
    const from = Math.atan2(sy - ay, sx - ax);
    const to = Math.atan2(py - ay, px - ax);
    const angle = snapAngle(startBox.angle + to - from, snap);
    return boxWithAnchorAt({ ...startBox, angle }, [ax, ay], startBox.w, startBox.h);
}

window.boxToWorld = boxToWorld;
