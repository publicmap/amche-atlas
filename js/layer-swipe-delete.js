const START_PX = 6;
const MIN_DISTANCE = 24;
const FLING_SPEED = 0.6;
const MAX_SPEED = 3;
const SAMPLE_WINDOW = 100;
const STALE_MS = 80;
const GRAVITY = 2800;
const POP = 260;
const SPIN = 70;
const CURVE = 4;
const FROM = [128, 128, 128, 0.12];
const TO = [220, 38, 38, 0.9];

const fillAt = (readiness) => {
    const t = (Math.exp(CURVE * readiness) - 1) / (Math.exp(CURVE) - 1);
    const [r, g, b, a] = FROM.map((v, i) => v + (TO[i] - v) * t);
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function collapseSpace(item) {
    const spacer = document.createElement('div');
    spacer.className = 'layer-stack-spacer';
    spacer.style.height = `${item.offsetHeight}px`;
    item.parentNode.insertBefore(spacer, item);
    requestAnimationFrame(() => requestAnimationFrame(() => { spacer.style.height = '0px'; }));
    setTimeout(() => spacer.remove(), 400);
}

function eject(item, velocity) {
    const rect = item.getBoundingClientRect();
    collapseSpace(item);
    item.classList.remove('swiping');
    item.classList.add('layer-stack-ejected');
    item.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;margin:0;z-index:100000;pointer-events:none;background-color:${fillAt(1)};transform-origin:50% 50%;will-change:transform,opacity;`;
    document.body.appendChild(item);

    if (reducedMotion()) {
        item.style.transition = 'opacity 0.2s ease';
        requestAnimationFrame(() => { item.style.opacity = '0'; });
        setTimeout(() => item.remove(), 250);
        return;
    }

    const vx0 = -Math.min(MAX_SPEED, Math.max(FLING_SPEED, velocity)) * 1000;
    let x = 0;
    let y = 0;
    let rot = 0;
    let vx = vx0;
    let vy = -POP;
    const spin = -SPIN + vx0 * 0.03;
    let last = performance.now();
    const born = last;

    const step = (now) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        vy += GRAVITY * dt;
        x += vx * dt;
        y += vy * dt;
        rot += spin * dt;
        const age = now - born;
        item.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
        item.style.opacity = String(Math.max(0, 1 - Math.max(0, age - 500) / 400));
        const gone = rect.top + y > window.innerHeight + rect.height || rect.left + x < -rect.width * 2 || age > 1000;
        if (gone) item.remove();
        else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

export function attachSwipeDelete(item, onDelete) {
    let start = null;
    let swiping = false;
    let offset = 0;
    let samples = [];
    let readiness = 0;

    const velocityAt = (time) => {
        const fresh = samples.filter(s => time - s.t <= SAMPLE_WINDOW);
        if (fresh.length < 2) return 0;
        const first = fresh[0];
        const lastSample = fresh[fresh.length - 1];
        if (time - lastSample.t > STALE_MS || lastSample.t === first.t) return 0;
        return (first.x - lastSample.x) / (lastSample.t - first.t);
    };

    const reset = () => {
        start = null;
        swiping = false;
        readiness = 0;
        item.draggable = true;
        item.classList.remove('swiping');
        item.style.transition = 'transform 0.2s ease, background-color 0.2s ease';
        item.style.transform = '';
        item.style.backgroundColor = '';
        setTimeout(() => { item.style.transition = ''; }, 220);
    };

    item.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        start = { x: e.clientX, y: e.clientY, id: e.pointerId };
        samples = [{ t: e.timeStamp, x: e.clientX }];
    });

    item.addEventListener('pointermove', (e) => {
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        samples.push({ t: e.timeStamp, x: e.clientX });
        samples = samples.filter(s => e.timeStamp - s.t <= SAMPLE_WINDOW);
        if (!swiping) {
            if (Math.abs(dy) > START_PX && Math.abs(dy) > Math.abs(dx)) {
                start = null;
                return;
            }
            if (dx > -START_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
            swiping = true;
            item.draggable = false;
            item.classList.add('swiping');
            item.style.transition = 'none';
            item.setPointerCapture?.(e.pointerId);
        }
        offset = Math.min(0, dx);
        const target = -offset >= MIN_DISTANCE ? Math.min(1, velocityAt(e.timeStamp) / FLING_SPEED) : 0;
        readiness += (target - readiness) * 0.35;
        item.style.transform = `translateX(${offset}px)`;
        item.style.backgroundColor = fillAt(readiness);
    });

    const finish = (e) => {
        if (!start || e.pointerId !== start.id) return;
        if (!swiping) {
            start = null;
            return;
        }
        item.dataset.swiped = '1';
        setTimeout(() => { delete item.dataset.swiped; }, 0);
        const velocity = e.type === 'pointerup' ? velocityAt(e.timeStamp) : 0;
        if (velocity >= FLING_SPEED && -offset >= MIN_DISTANCE) {
            start = null;
            swiping = false;
            eject(item, velocity);
            onDelete();
        } else {
            reset();
        }
    };

    item.addEventListener('pointerup', finish);
    item.addEventListener('pointercancel', finish);

    item.addEventListener('dragstart', (e) => {
        if (swiping) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    item.addEventListener('click', (e) => {
        if (item.dataset.swiped || item.classList.contains('swiping')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
}
