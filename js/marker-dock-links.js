import { formatDistance, haversineDistanceMeters } from './geo-distance-utils.js';
import { defaultRouteColor } from './search/route-geojson.js';
import { badgeMode } from './search/route-badge.js';

export const LANE_WIDTH = 16;
const LABEL_ROW = 16;
const LABEL_PAD = 6;
const DOT_SIZE = 14;
const ROW_CENTRE = 18;

export function routeSegmentLabel(route, index) {
    const leg = route.result?.legs?.[index];
    const mode = route.geojson?.features?.[0]?.properties?.mode || route.profile || 'route';
    let meters = leg?.distance;
    if (meters == null) {
        const [a, b] = [route.waypoints[index], route.waypoints[index + 1]];
        if (!a || !b) return `route-${route.rid}`;
        meters = haversineDistanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    }
    const minutes = leg?.duration != null ? `${Math.max(1, Math.round(leg.duration / 60))}m-` : '';
    return `route-${route.rid}-${mode}-${minutes}${formatDistance(meters).replace(/\s+/g, '')}`;
}

const MATCH_METERS = 25;

// A lane drawn the way its route's line is on the map (route-geojson.js's
// ROUTE_STYLE): driving solid, cycling dashed and walking dotted, each on
// white.
function laneStyle(color, profile) {
    switch (badgeMode(profile)) {
        case 'cycling':
            return `width:4px;background:repeating-linear-gradient(to bottom, ${color} 0 7px, #fff 7px 11px);border-radius:2px;`;
        case 'walking':
            return `width:4px;background:#fff radial-gradient(circle, ${color} 1.5px, transparent 1.9px) center top / 4px 6px repeat-y;border-radius:2px;`;
        default:
            return `width:3px;background:${color};border-radius:2px;box-shadow:0 0 0 1px #fff;`;
    }
}

const LABEL_EDGE = { cycling: 'dashed', walking: 'dotted', driving: 'solid' };

/**
 * The docked marker standing at each of a route's waypoints. The route's own
 * marker ids are tried first, but they go stale whenever a marker is rebuilt
 * (a restored link redraws them, a drag replaces one), so a waypoint with no
 * live marker under its id falls back to whichever docked marker sits on it.
 */
export function stopMarkers(route, docked) {
    return route.waypoints.map((waypoint, index) => {
        const byId = docked.find(m => m.id === route.markerIds[index]);
        if (byId) return byId;
        const at = { lng: waypoint[0], lat: waypoint[1] };
        return docked.find(m => haversineDistanceMeters(at, m.marker.getLngLat()) < MATCH_METERS) || null;
    });
}

export function groupByRoute(routes, docked) {
    const placed = new Set();
    const out = [];
    docked.forEach(m => {
        if (placed.has(m)) return;
        const route = routes.find(r => stopMarkers(r, docked).includes(m));
        const members = route ? stopMarkers(route, docked).filter(Boolean) : [m];
        members.forEach(o => {
            if (placed.has(o)) return;
            placed.add(o);
            out.push(o);
        });
    });
    return out;
}

/**
 * Every route with two or more docked stops becomes a lane running down the
 * column beside the panels, in the order the routes first appear. A lane
 * covers every stop it has (`stops`: position in the column plus the stop's
 * 1-based number on that route) and each hop between consecutive stops is a
 * `segment` that carries the route's label.
 */
export function routeColor(route) {
    return route.color || defaultRouteColor(route);
}

export function routeButtonLabel(route) {
    const props = route.geojson?.features?.[0]?.properties || {};
    return {
        name: `route-${route.rid}`,
        rid: route.rid,
        meta: [props.mode || route.profile, props.distanceText].filter(Boolean).join(' · ')
    };
}

export function planRouteLanes(routes, ordered, stackIndex) {
    const position = new Map(ordered.map((m, i) => [m.id, i]));
    const lanes = [];
    const segments = [];
    routes.forEach(route => {
        const stops = stopMarkers(route, ordered)
            .map((m, index) => ({ pos: m ? position.get(m.id) : null, number: index + 1, index }))
            .filter(s => s.pos != null);
        if (stops.length < 2) return;
        const lane = { route, color: routeColor(route), stops, k: stackIndex.get(route.id) ?? lanes.length };
        lanes.push(lane);
        for (let i = 0; i < stops.length - 1; i++) {
            if (stops[i + 1].index !== stops[i].index + 1) continue;
            segments.push({
                lane,
                after: Math.min(stops[i].pos, stops[i + 1].pos),
                label: routeSegmentLabel(route, stops[i].index)
            });
        }
    });
    return { lanes, segments };
}

export function gapAfter(plan, pos, base) {
    const count = plan.segments.filter(s => s.after === pos).length;
    return count ? count * LABEL_ROW + LABEL_PAD : base;
}

export function renderDockLinks(container, plan, rows, left, panelLeft, routeRows = new Map(), limit = Infinity) {
    let layer = container.querySelector(':scope > .marker-dock-links');
    if (!plan?.lanes.length) {
        layer?.remove();
        return;
    }
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'marker-dock-links';
        layer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;overflow:visible;';
        container.appendChild(layer);
    }
    const box = container.getBoundingClientRect();
    const nodes = [];
    const place = (css) => {
        const node = document.createElement('div');
        node.style.cssText = `position:absolute;${css}`;
        nodes.push(node);
        return node;
    };

    plan.lanes.forEach(({ color, k, stops, route }) => {
        const x = left + k * LANE_WIDTH + LANE_WIDTH / 2 - box.left;
        const ys = stops.map(s => rows[s.pos].top + ROW_CENTRE - box.top);
        const button = routeRows.get(route.id);
        const buttonY = button ? button.top + button.height / 2 - box.top : null;
        const top = Math.min(...ys, ...(buttonY == null ? [] : [buttonY]));
        const bottom = Math.min(Math.max(...ys), limit - box.top);
        const width = badgeMode(route.profile) === 'driving' ? 3 : 4;
        place(`left:${x - width / 2}px;top:${top}px;height:${Math.max(0, bottom - top)}px;${laneStyle(color, route.profile)}`);
        stops.forEach((s, i) => {
            if (rows[s.pos].hidden) return;
            const dot = place(`left:${x - DOT_SIZE / 2}px;top:${ys[i] - DOT_SIZE / 2}px;width:${DOT_SIZE}px;height:${DOT_SIZE}px;border-radius:50%;background:${color};border:1.5px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;line-height:1;color:#fff;`);
            dot.textContent = s.number;
        });
    });

    const seen = new Map();
    plan.segments.forEach(({ lane, after, label }) => {
        const n = seen.get(after) || 0;
        seen.set(after, n + 1);
        const row = rows[after];
        if (row.hidden || row.top + row.height >= limit) return;
        const text = place(`left:${panelLeft + 4 - box.left}px;top:${row.top + row.height + LABEL_PAD / 2 + n * LABEL_ROW - box.top}px;font-size:10px;line-height:${LABEL_ROW - 4}px;color:#e5e7eb;background:rgba(17,24,39,0.85);padding:0 5px;border-left:3px ${LABEL_EDGE[badgeMode(lane.route.profile)]} ${lane.color};border-radius:3px;white-space:nowrap;`);
        text.textContent = label;
    });
    layer.replaceChildren(...nodes);
}
