/**
 * Where a position falls on a route line, for navigation
 * (js/route-navigation.js): the nearest point on the line, how far it is from
 * the line, and how far along the line it lies - all in metres.
 */
import { haversineDistanceMeters } from './geo-distance-utils.js';

const at = (c) => ({ lng: c[0], lat: c[1] });

export function lineLength(coordinates) {
    let total = 0;
    for (let i = 1; i < coordinates.length; i++) total += haversineDistanceMeters(at(coordinates[i - 1]), at(coordinates[i]));
    return total;
}

/** Nearest point on a polyline of [lng, lat], projected locally (fine at street scale). */
export function nearestOnLine(coordinates, point) {
    let best = { distance: Infinity, along: 0, point: coordinates[0] || point };
    let travelled = 0;
    const kx = Math.cos(point[1] * Math.PI / 180);
    for (let i = 1; i < coordinates.length; i++) {
        const [a, b] = [coordinates[i - 1], coordinates[i]];
        const dx = (b[0] - a[0]) * kx;
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, (((point[0] - a[0]) * kx) * dx + (point[1] - a[1]) * dy) / len2)) : 0;
        const foot = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const distance = haversineDistanceMeters(at(foot), at(point));
        const segment = haversineDistanceMeters(at(a), at(b));
        if (distance < best.distance) best = { distance, along: travelled + segment * t, point: foot };
        travelled += segment;
    }
    return best;
}
