function attachBoxBodyDrag(georef) {
    const container = referenceMap.getCanvasContainer();
    const toMercator = e => {
        const m = mapboxgl.MercatorCoordinate.fromLngLat(e.lngLat);
        return [m.x, m.y];
    };
    const inside = p => {
        const { box } = georef;
        const [lx, ly] = boxToLocal(box, p, [box.cx, box.cy]);
        return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2;
    };
    let drag = null;

    const onDown = e => {
        if (georef.mode !== 'bbox') return;
        if (e.originalEvent.button > 0 || (e.points && e.points.length > 1)) return;
        if (e.originalEvent.target.closest && e.originalEvent.target.closest('.mapboxgl-marker')) return;
        const p = toMercator(e);
        if (!inside(p)) return;
        e.preventDefault();
        editHistory.record(georef.historyTarget, 'move image');
        drag = { box: { ...georef.box }, at: p };
        container.style.cursor = 'grabbing';
    };
    const onMove = e => {
        if (georef.mode !== 'bbox') return;
        const p = toMercator(e);
        if (!drag) {
            container.style.cursor = inside(p) ? 'move' : '';
            return;
        }
        georef.box = { ...drag.box, cx: drag.box.cx + p[0] - drag.at[0], cy: drag.box.cy + p[1] - drag.at[1] };
        georef._update();
    };
    const onUp = () => {
        if (!drag) return;
        drag = null;
        container.style.cursor = '';
        georef._update();
    };

    referenceMap.on('mousedown', onDown);
    referenceMap.on('touchstart', onDown);
    referenceMap.on('mousemove', onMove);
    referenceMap.on('touchmove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
        referenceMap.off('mousedown', onDown);
        referenceMap.off('touchstart', onDown);
        referenceMap.off('mousemove', onMove);
        referenceMap.off('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        container.style.cursor = '';
    };
}

window.attachBoxBodyDrag = attachBoxBodyDrag;
