/**
 * The "Map Maker" wordmark on the creator's home screen, drawn the way a map
 * is: every letter is a handful of areas (polygons), ways (their outlines) and
 * nodes (the vertices). Letters are shown as filled areas; hovering or
 * selecting a feature reveals its wireframe (way and nodes), like inspecting a
 * map - see the .ch-part rules in map-creator.html. Glyphs are Helvetica-like
 * outlines built from rectangles, rings and a few polygons, in a y-up space
 * 100 units cap-high. Letters can be dragged around and their nodes dragged to
 * reshape them.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SKINS = ['#38bdf8', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#2dd4bf', '#fb923c', '#60a5fa'];
const LETTER_GAP = 14;
const SPACE_WIDTH = 34;
const SCALE = 0.86;

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function ellipse(cx, cy, rx, ry, steps = 28, from = 0, to = Math.PI * 2) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const angle = from + ((to - from) * i) / steps;
        points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
    }
    return to - from >= Math.PI * 2 ? points.slice(0, -1) : points;
}

function ring(cx, cy, rx, ry, thickness, steps = 28) {
    return {
        outer: ellipse(cx, cy, rx, ry, steps),
        hole: ellipse(cx, cy, rx - thickness, ry - thickness, steps).reverse()
    };
}

const bowl = (cx, cy, rx, ry) => ({ area: ring(cx, cy, rx, ry, 13) });

const GLYPHS = {
    M: {
        width: 96,
        parts: [{ area: { outer: [[0, 0], [0, 100], [17, 100], [48, 26], [79, 100], [96, 100], [96, 0], [82, 0], [82, 70], [52, 0], [44, 0], [14, 70], [14, 0]] } }]
    },
    a: {
        width: 58,
        parts: [bowl(27, 27, 27, 27), { area: { outer: rect(44, 0, 14, 54) } }]
    },
    p: {
        width: 64,
        parts: [{ area: { outer: rect(0, -26, 14, 98) } }, bowl(36, 36, 30, 36)]
    },
    k: {
        width: 62,
        parts: [
            { area: { outer: rect(0, 0, 14, 100) } },
            { area: { outer: [[14, 30], [48, 72], [66, 72], [30, 28]] } },
            { area: { outer: [[26, 38], [46, 0], [64, 0], [38, 46]] } }
        ]
    },
    e: {
        width: 68,
        parts: [
            { area: { outer: ellipse(34, 36, 34, 36, 30, 0, 5.5).concat(ellipse(34, 36, 21, 23, 30, 5.5, 0)) } },
            { area: { outer: rect(10, 31, 52, 12) } }
        ]
    },
    r: {
        width: 44,
        parts: [
            { area: { outer: rect(0, 0, 14, 72) } },
            { area: { outer: ellipse(14, 42, 30, 30, 12, Math.PI / 2, 0.2).concat(ellipse(14, 42, 17, 17, 12, 0.2, Math.PI / 2)) } }
        ]
    }
};

// Two lines, so the wordmark fits the narrow side panel the creator opens in
const LINES = [['M', 'a', 'p'], ['M', 'a', 'k', 'e', 'r']];
// Baseline to baseline: cap height plus the descender of the p and a gap
const LINE_HEIGHT = 144;

function el(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
}

function withTitle(node, text) {
    const title = el('title');
    title.textContent = text;
    node.appendChild(title);
    return node;
}

const pathData = (points) => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;

const clonePoints = (points) => points.map(([x, y]) => [x, y]);
const DRAG_THRESHOLD = 4;

function drawPart(letter, part, skin) {
    const group = el('g', { class: 'ch-part', style: `color:${skin}` });
    letter.appendChild(group);
    const rings = [part.area.outer, part.area.hole].filter(Boolean).map(clonePoints);
    const area = withTitle(el('path', { class: 'ch-area', fill: skin, 'fill-rule': 'evenodd' }), 'Area');
    const way = withTitle(el('path', { class: 'ch-way', pathLength: 1, stroke: skin }), 'Way');
    group.append(area, way);

    const model = { rings, original: rings.map(clonePoints), area, way, nodes: [] };
    group.__part = model;
    rings.forEach((points, ringIndex) => {
        const stride = points.length > 12 ? 4 : 1;
        points.forEach((_, pointIndex) => {
            if (pointIndex % stride) return;
            const node = withTitle(el('circle', { class: 'ch-node', r: 2.4, stroke: skin }), 'Node');
            node.__ref = { model, ringIndex, pointIndex };
            model.nodes.push(node);
            group.appendChild(node);
        });
    });
    redrawPart(model);
}

function redrawPart(model) {
    const d = model.rings.map(pathData).join('');
    model.area.setAttribute('d', d);
    model.way.setAttribute('d', d);
    model.nodes.forEach((node) => {
        const [x, y] = model.rings[node.__ref.ringIndex][node.__ref.pointIndex];
        node.setAttribute('cx', x.toFixed(1));
        node.setAttribute('cy', y.toFixed(1));
    });
}

function placeLetter(letter) {
    const { x, y, baseline } = letter.__letter;
    letter.setAttribute('transform', `translate(${x.toFixed(1)} ${(baseline + y).toFixed(1)}) scale(${SCALE} ${-SCALE})`);
}

function resetLetter(letter) {
    letter.__letter.y = 0;
    letter.__letter.x = letter.__letter.homeX;
    placeLetter(letter);
    letter.querySelectorAll('.ch-part').forEach((group) => {
        const model = group.__part;
        model.rings = model.original.map(clonePoints);
        redrawPart(model);
    });
}

function toSvgPoint(svg, clientX, clientY, matrixSource = svg) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrixSource.getScreenCTM().inverse());
}

/**
 * Drag a letter (its fill or outline) to move it, drag one of its nodes to
 * reshape it, click a feature to select it, double-click a letter to put it back.
 */
function bindInteraction(target) {
    const svg = target.ownerSVGElement;
    let drag = null;

    target.addEventListener('pointerdown', (e) => {
        const part = e.target.closest?.('.ch-part');
        if (!part || e.button !== 0) return;
        const letter = part.parentNode;
        const node = e.target.closest('.ch-node');
        e.preventDefault();
        drag = {
            part, letter, node, moved: false, startX: e.clientX, startY: e.clientY,
            origin: toSvgPoint(svg, e.clientX, e.clientY), letterStart: { x: letter.__letter.x, y: letter.__letter.y }
        };
        letter.querySelectorAll('.ch-part').forEach((group) => group.classList.add('dragging'));
        svg.classList.add('ch-grabbing');
    });

    window.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.moved = true;
        if (drag.node) {
            const { model, ringIndex, pointIndex } = drag.node.__ref;
            const local = toSvgPoint(svg, e.clientX, e.clientY, drag.letter);
            model.rings[ringIndex][pointIndex] = [local.x, local.y];
            redrawPart(model);
        } else {
            const now = toSvgPoint(svg, e.clientX, e.clientY);
            drag.letter.__letter.x = drag.letterStart.x + now.x - drag.origin.x;
            drag.letter.__letter.y = drag.letterStart.y + now.y - drag.origin.y;
            placeLetter(drag.letter);
        }
    });

    const finish = () => {
        if (!drag) return;
        drag.letter.querySelectorAll('.ch-part').forEach((group) => group.classList.remove('dragging'));
        svg.classList.remove('ch-grabbing');
        if (!drag.moved) drag.part.classList.toggle('selected');
        drag = null;
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);

    target.addEventListener('dblclick', (e) => {
        const letter = e.target.closest?.('.ch-letter');
        if (letter) resetLetter(letter);
    });
}

/** Fills `target` (an SVG <g>) with the wordmark, each line centred on `centerX`. */
export function renderTitle(target, { centerX = 360, baseline = 200 } = {}) {
    let index = 0;

    target.replaceChildren();
    LINES.forEach((word, line) => {
        const lineBaseline = baseline + line * LINE_HEIGHT;
        const total = word.reduce((sum, ch) => sum + (ch === ' ' ? SPACE_WIDTH : GLYPHS[ch].width + LETTER_GAP), -LETTER_GAP);
        let x = centerX - (total * SCALE) / 2;
        word.forEach((ch) => {
            if (ch === ' ') {
                x += SPACE_WIDTH * SCALE;
                return;
            }
            const glyph = GLYPHS[ch];
            const group = el('g', { class: 'ch-letter' });
            group.__letter = { x, y: 0, homeX: x, baseline: lineBaseline };
            placeLetter(group);
            glyph.parts.forEach((part) => drawPart(group, part, SKINS[index % SKINS.length]));
            target.appendChild(group);
            x += (glyph.width + LETTER_GAP) * SCALE;
            index++;
        });
    });
    if (!target.__bound) {
        target.__bound = true;
        bindInteraction(target);
    }
}
