// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrackLog, trackDistance, trackToGpx, tracksToGeoJSON } from '../gpx-log.js';
import { withSystemLayerDefaults, isLocalDataLayer } from '../../config/index.js';

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key)
    };
}

function fakeLocator() {
    const control = {
        isTracking: false,
        locate: vi.fn(() => { control.isTracking = true; }),
        on: vi.fn((type, listener) => { control.emit = listener; })
    };
    return control;
}

const position = (lng, lat, timestamp) => ({ coords: { longitude: lng, latitude: lat, accuracy: 5, altitude: 12 }, timestamp });

describe('gpx-log', () => {
    afterEach(() => vi.useRealTimers());

    it('measures a track and writes it as GPX', () => {
        const track = { id: 't1', startedAt: Date.UTC(2026, 9, 21, 9), points: [[73.8, 15.5, Date.UTC(2026, 9, 21, 9), 5, 12], [73.81, 15.5, Date.UTC(2026, 9, 21, 9, 1), 5, null]] };
        expect(Math.round(trackDistance(track.points))).toBe(1072);
        const gpx = trackToGpx(track);
        expect(gpx).toContain('<trkpt lat="15.5" lon="73.8"><ele>12</ele><time>2026-10-21T09:00:00.000Z</time></trkpt>');
        expect(gpx).toContain('<trkpt lat="15.5" lon="73.81"><time>2026-10-21T09:01:00.000Z</time></trkpt>');
    });

    it('draws each track as a line, marking the current one and the latest fix', () => {
        const tracks = [
            { id: 'old', startedAt: 1, points: [[73.8, 15.5, 1], [73.81, 15.5, 2]] },
            { id: 'now', startedAt: 3, points: [[73.9, 15.6, 3]] }
        ];
        const { features } = tracksToGeoJSON(tracks, 'now', { lng: 73.91, lat: 15.6 });
        expect(features.map(f => [f.id, f.geometry.type, f.properties.current])).toEqual([
            ['old', 'LineString', false],
            ['now', 'Point', true],
            ['position', 'Point', true]
        ]);
    });

    it('logs the map watch\'s latest fix every interval while Log Track is on, and clears tracks', () => {
        vi.useFakeTimers();
        const storage = memoryStorage();
        const control = fakeLocator();
        const log = new TrackLog({ storage, session: memoryStorage(), locator: () => control });
        log.start();
        log.setInterval(5);
        log.setLogging(true);
        expect(control.locate).toHaveBeenCalledTimes(1);
        control.emit(position(73.8, 15.5, 1000));
        control.emit(position(73.81, 15.5, 2000));
        vi.advanceTimersByTime(5000);
        vi.advanceTimersByTime(5000);
        expect(log.tracks()[0].points).toEqual([[73.8, 15.5, 1000, 5, 12], [73.81, 15.5, 2000, 5, 12]]);

        control.isTracking = false;
        expect(log.paused).toBe(true);
        log.setLogging(false);
        expect(log.paused).toBe(false);
        expect(new TrackLog({ storage, session: memoryStorage(), locator: () => control }).settings).toEqual({ logging: false, interval: 5 });
        log.clear();
        expect(log.tracks()).toEqual([]);
    });
});

describe('reserved layers', () => {
    it('gives a reserved layer its fixed type and keeps the gpx data local', () => {
        expect(withSystemLayerDefaults({ id: 'gpx', title: 'GPS Tracks', type: 'csv' })).toEqual({ id: 'gpx', title: 'GPS Tracks', type: 'geojson', geojson: null });
        expect(withSystemLayerDefaults({ id: 'forests' })).toEqual({ id: 'forests' });
        expect(isLocalDataLayer('gpx')).toBe(true);
        expect(isLocalDataLayer('selection')).toBe(false);
    });
});
