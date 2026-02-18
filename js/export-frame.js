export class ExportFrame {
    constructor(map, control) {
        this._map = map;
        this._control = control;
        this._el = document.createElement('div');
        this._el.className = 'map-export-frame';
        this._el.style.position = 'absolute';
        this._el.style.pointerEvents = 'none';
        this._el.style.userSelect = 'none';

        this._moveHandle = document.createElement('div');
        this._moveHandle.className = 'export-move-handle';
        this._moveHandle.style.pointerEvents = 'auto';
        this._moveHandle.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 9l-2 2 2 2M9 5l2-2 2 2M15 19l-2 2-2-2M19 9l2 2-2 2"/>
                <circle cx="12" cy="12" r="1"/>
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
            </svg>
        `;
        this._moveHandle.onmousedown = (e) => {
            e.stopPropagation();
            this._startMove(e);
        };
        this._moveHandle.ontouchstart = (e) => {
            e.stopPropagation();
            this._startMove(e);
        };
        this._el.appendChild(this._moveHandle);

        const edgeThickness = 8;
        ['top', 'bottom', 'left', 'right'].forEach(pos => {
            const edge = document.createElement('div');
            edge.className = `export-edge export-edge-${pos}`;
            edge.style.position = 'absolute';
            edge.style.pointerEvents = 'auto';
            edge.style.cursor = pos === 'top' || pos === 'bottom' ? 'ns-resize' : 'ew-resize';

            if (pos === 'top') {
                edge.style.top = '0';
                edge.style.left = '0';
                edge.style.right = '0';
                edge.style.height = `${edgeThickness}px`;
            } else if (pos === 'bottom') {
                edge.style.bottom = '0';
                edge.style.left = '0';
                edge.style.right = '0';
                edge.style.height = `${edgeThickness}px`;
            } else if (pos === 'left') {
                edge.style.top = '0';
                edge.style.left = '0';
                edge.style.bottom = '0';
                edge.style.width = `${edgeThickness}px`;
            } else if (pos === 'right') {
                edge.style.top = '0';
                edge.style.right = '0';
                edge.style.bottom = '0';
                edge.style.width = `${edgeThickness}px`;
            }

            edge.onmousedown = (e) => {
                e.stopPropagation();
                this._startMove(e);
            };
            edge.ontouchstart = (e) => {
                e.stopPropagation();
                this._startMove(e);
            };
            this._el.appendChild(edge);
        });

        ['nw', 'ne', 'se', 'sw'].forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `export-handle ${pos}`;
            handle.style.pointerEvents = 'auto';
            handle.onmousedown = (e) => {
                e.stopPropagation();
                this._startResize(e, pos);
            };
            handle.ontouchstart = (e) => {
                e.stopPropagation();
                this._startResize(e, pos);
            };
            this._el.appendChild(handle);
        });

        this._map.getContainer().appendChild(this._el);

        this._aspectRatio = 1.414;
        this._updatePosition();
    }

    remove() {
        if (this._el && this._el.parentNode) {
            this._el.parentNode.removeChild(this._el);
        }
    }

    show() {
        this._el.classList.add('active');
        this._updatePosition();
    }

    hide() {
        this._el.classList.remove('active');
    }

    setAspectRatio(ratio) {
        this._aspectRatio = ratio;
        this._updatePosition();
        this._constrainToViewport();
    }

    getBounds() {
        const rect = this._el.getBoundingClientRect();
        const mapCanvas = this._map.getCanvas().getBoundingClientRect();

        const p1 = this._map.unproject([
            rect.left - mapCanvas.left,
            rect.top - mapCanvas.top
        ]);
        const p2 = this._map.unproject([
            rect.right - mapCanvas.left,
            rect.bottom - mapCanvas.top
        ]);

        return new mapboxgl.LngLatBounds(p1, p2);
    }

    _updatePosition() {
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();

        if (!this._el.style.width || !this._el.style.left) {
            const mapW = mapRect.width;
            const w = mapW * 0.6;
            const h = w / this._aspectRatio;

            const left = (mapW - w) / 2;
            const top = (mapRect.height - h) / 2;

            this._el.style.width = w + 'px';
            this._el.style.height = h + 'px';
            this._el.style.left = left + 'px';
            this._el.style.top = top + 'px';
        } else {
            const w = parseFloat(this._el.style.width);
            const h = w / this._aspectRatio;
            this._el.style.height = h + 'px';

            this._constrainToViewport();
        }
    }

    _constrainToViewport() {
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();

        let left = parseFloat(this._el.style.left) || 0;
        let top = parseFloat(this._el.style.top) || 0;
        const width = parseFloat(this._el.style.width) || 0;
        const height = parseFloat(this._el.style.height) || 0;

        const handleSize = 12;
        const minLeft = -handleSize;
        const minTop = -handleSize;
        const maxLeft = mapRect.width - width + handleSize;
        const maxTop = mapRect.height - height + handleSize;

        left = Math.max(minLeft, Math.min(maxLeft, left));
        top = Math.max(minTop, Math.min(maxTop, top));

        this._el.style.left = left + 'px';
        this._el.style.top = top + 'px';
    }

    _startMove(e) {
        e.preventDefault();
        e.stopPropagation();

        if (this._control && this._control._onFrameInteractionStart) {
            this._control._onFrameInteractionStart();
        }

        const isTouch = e.touches && e.touches.length > 0;
        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startY = isTouch ? e.touches[0].clientY : e.clientY;

        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();
        const frameRect = this._el.getBoundingClientRect();

        const startLeft = frameRect.left - mapRect.left;
        const startTop = frameRect.top - mapRect.top;

        const performMove = (e) => {
            e.preventDefault();
            const currentX = isTouch ? e.touches[0].clientX : e.clientX;
            const currentY = isTouch ? e.touches[0].clientY : e.clientY;

            const dx = currentX - startX;
            const dy = currentY - startY;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            const width = parseFloat(this._el.style.width) || 0;
            const height = parseFloat(this._el.style.height) || 0;
            const handleSize = 12;

            newLeft = Math.max(-handleSize, Math.min(mapRect.width - width + handleSize, newLeft));
            newTop = Math.max(-handleSize, Math.min(mapRect.height - height + handleSize, newTop));

            this._el.style.left = newLeft + 'px';
            this._el.style.top = newTop + 'px';
        };

        const onUp = () => {
            if (isTouch) {
                document.removeEventListener('touchmove', performMove);
                document.removeEventListener('touchend', onUp);
            } else {
                document.removeEventListener('mousemove', performMove);
                document.removeEventListener('mouseup', onUp);
            }
        };

        if (isTouch) {
            document.addEventListener('touchmove', performMove, { passive: false });
            document.addEventListener('touchend', onUp);
        } else {
            document.addEventListener('mousemove', performMove);
            document.addEventListener('mouseup', onUp);
        }
    }

    _startResize(e, handle) {
        e.preventDefault();
        e.stopPropagation();

        if (this._control && this._control._onFrameInteractionStart) {
            this._control._onFrameInteractionStart();
        }

        const isTouch = e.touches && e.touches.length > 0;

        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();
        const frameRect = this._el.getBoundingClientRect();

        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startY = isTouch ? e.touches[0].clientY : e.clientY;
        const startW = frameRect.width;
        const startH = frameRect.height;
        const startL = frameRect.left - mapRect.left;
        const startT = frameRect.top - mapRect.top;

        const onMove = (e) => {
            e.preventDefault();
            const currentX = isTouch ? e.touches[0].clientX : e.clientX;
            const currentY = isTouch ? e.touches[0].clientY : e.clientY;
            const dx = currentX - startX;
            const dy = currentY - startY;

            let newW = startW;
            let newH = startH;
            let newL = startL;
            let newT = startT;

            if (handle.includes('e')) newW = startW + dx;
            if (handle.includes('w')) { newW = startW - dx; newL = startL + dx; }
            if (handle.includes('s')) newH = startH + dy;
            if (handle.includes('n')) { newH = startH - dy; newT = startT + dy; }

            const minSize = 50;
            if (newW < minSize) {
                if (handle.includes('w')) newL = startL + startW - minSize;
                newW = minSize;
            }
            if (newH < minSize) {
                if (handle.includes('n')) newT = startT + startH - minSize;
                newH = minSize;
            }

            const handleSize = 12;
            newL = Math.max(-handleSize, Math.min(mapRect.width - newW + handleSize, newL));
            newT = Math.max(-handleSize, Math.min(mapRect.height - newH + handleSize, newT));

            this._el.style.width = newW + 'px';
            this._el.style.height = newH + 'px';
            this._el.style.left = newL + 'px';
            this._el.style.top = newT + 'px';

            this._aspectRatio = newW / newH;
            if (this._control && this._control._onFrameChange) {
                this._control._onFrameChange(this._aspectRatio);
            }
        };

        const onUp = () => {
            if (isTouch) {
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
            } else {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
        };

        if (isTouch) {
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        } else {
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    }
}
