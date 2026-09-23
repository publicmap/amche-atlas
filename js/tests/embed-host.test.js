// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

const ATLAS_URL = 'https://amche.in/?atlas=osm&layers=topo#10.32/10.83/76.95';
const HOST_URL = 'https://openstreetmap.in/map.html?atlas=osm#10.32/10.83/76.95';

/**
 * embed-host.js reads `window.parent` and wires up its message listener at
 * import time, so each case sets the page up first and then imports it fresh.
 */
async function loadEmbedHost({ embedded = true, referrer = '' } = {}) {
    vi.resetModules();
    const parent = embedded ? { postMessage() {} } : window;
    Object.defineProperty(window, 'parent', { value: parent, configurable: true, writable: true });
    Object.defineProperty(document, 'referrer', { value: referrer, configurable: true });
    const module = await import('../embed-host.js');
    return { ...module, parent };
}

function postFromParent(parent, data, origin) {
    const event = new MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: parent });
    window.dispatchEvent(event);
}

describe('embed-host', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/?atlas=osm&layers=topo#10.32/10.83/76.95');
    });

    it('leaves the URL alone when the atlas is not embedded', async () => {
        const { rebaseOnEmbedHost } = await loadEmbedHost({ embedded: false, referrer: HOST_URL });
        expect(rebaseOnEmbedHost(ATLAS_URL)).toBe(ATLAS_URL);
    });

    it('leaves the URL alone when embedded but the host is unknown', async () => {
        const { rebaseOnEmbedHost } = await loadEmbedHost({ referrer: '' });
        expect(rebaseOnEmbedHost(ATLAS_URL)).toBe(ATLAS_URL);
    });

    it('rebases onto the referring page, keeping the parameters and hash', async () => {
        const { rebaseOnEmbedHost } = await loadEmbedHost({ referrer: 'https://openstreetmap.in/map.html?other=1#9/1/2' });
        expect(rebaseOnEmbedHost(ATLAS_URL))
            .toBe('https://openstreetmap.in/map.html?atlas=osm&layers=topo#10.32/10.83/76.95');
    });

    it('prefers a host that identifies itself over the referrer', async () => {
        const { rebaseOnEmbedHost, parent } = await loadEmbedHost({ referrer: 'https://stale.example/old.html' });
        postFromParent(parent, { type: 'amche:embed', href: HOST_URL }, 'https://openstreetmap.in');
        expect(rebaseOnEmbedHost(ATLAS_URL))
            .toBe('https://openstreetmap.in/map.html?atlas=osm&layers=topo#10.32/10.83/76.95');
    });

    it('ignores a page claiming to be somewhere other than where it posted from', async () => {
        const { rebaseOnEmbedHost, parent } = await loadEmbedHost({ referrer: '' });
        postFromParent(parent, { type: 'amche:embed', href: 'https://bank.example/' }, 'https://attacker.example');
        expect(rebaseOnEmbedHost(ATLAS_URL)).toBe(ATLAS_URL);
    });

    it('ignores messages that did not come from the embedding parent', async () => {
        const { rebaseOnEmbedHost } = await loadEmbedHost({ referrer: '' });
        postFromParent({ some: 'other frame' }, { type: 'amche:embed', href: HOST_URL }, 'https://openstreetmap.in');
        expect(rebaseOnEmbedHost(ATLAS_URL)).toBe(ATLAS_URL);
    });

    it('carries a parameter-less map URL over without inventing a query string', async () => {
        const { rebaseOnEmbedHost } = await loadEmbedHost({ referrer: 'https://openstreetmap.in/' });
        expect(rebaseOnEmbedHost('https://amche.in/#9/1/2')).toBe('https://openstreetmap.in/#9/1/2');
    });
});
