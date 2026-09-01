import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { handlers } from '../../config/haryana.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<string xmlns="https://hsac.org.in">&lt;root&gt;&lt;OWNER&gt;सुभाष कुमार पुत्र टेका 1/2 भाग  वासी   राजकुमार पुत्र लालसिंह 1/3 भाग  वासी   &lt;/OWNER&gt;&lt;NVCODE&gt;04101&lt;/NVCODE&gt;&lt;CKHEWAT&gt;102&lt;/CKHEWAT&gt;&lt;/root&gt;</string>`;

const FEATURE = {
    properties: {
        n_d_code: '05',
        n_t_code: '136',
        n_v_code: '04101',
        n_murr_no: '14',
        n_khas_no: '12/1'
    }
};

function makeWindow(url) {
    const dom = new JSDOM('<body></body>', { url, runScripts: 'outside-only' });
    // jsdom exposes window.crypto without subtle and no TextEncoder; browsers have both.
    Object.defineProperty(dom.window, 'crypto', { value: webcrypto, configurable: true });
    dom.window.TextEncoder = TextEncoder;
    return dom.window;
}

/** Dispatch a cross-origin message with a stubbed source window. */
function postToWindow(win, data, origin) {
    const source = { postMessage: vi.fn() };
    const event = new win.MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    win.dispatchEvent(event);
    return source;
}

/** Request signing is async (crypto.subtle), so wait for the reply rather than one tick. */
const awaitReply = (source) => vi.waitFor(() => expect(source.postMessage).toHaveBeenCalled());

describe('HSAC bridge userscript', () => {
    const source = readFileSync(new URL('../../tools/hsac-bridge.user.js', import.meta.url), 'utf8');
    let win;

    beforeEach(() => {
        win = makeWindow('https://hsac.in/eodb/map');
        win.localStorage.setItem('eodb_req_sign_key', 'test-signing-key');
        win.localStorage.setItem('eodb_device_id', 'web-123-abc');
        win.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => SAMPLE_XML });
        win.eval(source);
    });

    it('answers a ping from an allowed origin only', () => {
        const allowed = postToWindow(win, { type: 'hsac-bridge-ping' }, 'https://amche.in');
        expect(allowed.postMessage).toHaveBeenCalledWith(
            { type: 'hsac-bridge-ready', signedIn: true },
            'https://amche.in'
        );

        const blocked = postToWindow(win, { type: 'hsac-bridge-ping' }, 'https://evil.example');
        expect(blocked.postMessage).not.toHaveBeenCalled();
    });

    it('signs the land-record request the way the HSAC client does', async () => {
        const source = postToWindow(win, {
            type: 'hsac-land-record',
            requestId: 'lr-1',
            params: { dCode: '05', tCode: '136', vCode: '04101', murabbaNo: '14', khasraNo: '12/1' }
        }, 'https://amche.in');

        await awaitReply(source);

        const [url, init] = win.fetch.mock.calls[0];
        expect(url).toBe('/eodb_backend/mapserver/land-record/Owner_name?Dcode1=05&Tcode1=136&Nvcode1=04101&Mustno1=14&Khasra1=12%2F1');
        expect(init.credentials).toBe('include');
        expect(init.headers['X-Device-Id']).toBe('web-123-abc');

        const expected = createHmac('sha256', 'test-signing-key')
            .update(`GET\n/mapserver/land-record/owner_name\n${init.headers['X-Signed-At']}\n`)
            .digest('hex');
        expect(init.headers['X-Signature']).toBe(expected);

        expect(source.postMessage).toHaveBeenCalledWith(
            { type: 'hsac-land-record-result', requestId: 'lr-1', ok: true, status: 200, xml: SAMPLE_XML },
            'https://amche.in'
        );
    });

    it('announces itself to its opener so a reloaded amche page can reconnect', () => {
        const opener = { closed: false, postMessage: vi.fn() };
        const fresh = makeWindow('https://hsac.in/eodb/map');
        fresh.localStorage.setItem('eodb_req_sign_key', 'test-signing-key');
        Object.defineProperty(fresh, 'opener', { value: opener, configurable: true });
        fresh.eval(source);

        const targets = opener.postMessage.mock.calls.map(([, origin]) => origin);
        expect(targets).toContain('https://amche.in');
        expect(targets).not.toContain('*');
        expect(opener.postMessage.mock.calls[0][0]).toEqual({ type: 'hsac-bridge-ready', signedIn: true });
    });

    it('remembers callers on other amche origins and announces to them later', () => {
        postToWindow(win, { type: 'hsac-bridge-ping' }, 'https://dev.amche.in');
        postToWindow(win, { type: 'hsac-bridge-ping' }, 'https://evil.example');
        const remembered = win.localStorage.getItem('amche_bridge_origins');
        expect(JSON.parse(remembered)).toEqual(['https://dev.amche.in']);

        const opener = { closed: false, postMessage: vi.fn() };
        const fresh = makeWindow('https://hsac.in/eodb/map');
        fresh.localStorage.setItem('amche_bridge_origins', remembered);
        Object.defineProperty(fresh, 'opener', { value: opener, configurable: true });
        fresh.eval(source);

        expect(opener.postMessage.mock.calls.map(([, origin]) => origin)).toContain('https://dev.amche.in');
    });

    it('reports a signed-out session back to the caller', async () => {
        win.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => '{"message":"Authentication required"}' });
        const source = postToWindow(win, {
            type: 'hsac-land-record',
            requestId: 'lr-2',
            params: { khasraNo: '12/1' }
        }, 'https://amche.in');

        await awaitReply(source);

        expect(source.postMessage.mock.calls[0][0]).toMatchObject({ ok: false, status: 401 });
    });
});

describe('getHaryanaLandRecord', () => {
    async function render({ fetchImpl }) {
        const html = await handlers.getHaryanaLandRecord({ feature: FEATURE });
        const win = makeWindow('https://amche.in/');
        win.document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
        win.fetch = fetchImpl;
        win.eval(html.match(/<script>([\s\S]*)<\/script>/)[1]);
        const container = win.document.getElementById(html.match(/id="(hsac-land-record-[^"]+)"/)[1]);
        await vi.waitFor(() => expect(container.querySelector('[data-field], [data-role="connect"]')).toBeTruthy());
        return { win, container };
    }

    /** Stands in for an HSAC tab whose heartbeat reaches an amche page it has no handle from. */
    function announcingBridgeTab(win, xml) {
        const tab = {
            closed: false,
            postMessage: vi.fn((message) => {
                if (message.type !== 'hsac-land-record') return;
                deliver({ type: 'hsac-land-record-result', requestId: message.requestId, ok: true, status: 200, xml });
            })
        };
        function deliver(data) {
            const event = new win.MessageEvent('message', { data, origin: 'https://hsac.in' });
            Object.defineProperty(event, 'source', { value: tab });
            win.dispatchEvent(event);
        }
        tab.announce = () => deliver({ type: 'hsac-bridge-ready', signedIn: true });
        return tab;
    }

    it('lists the owner first, then the remaining record fields', async () => {
        const { container } = await render({
            fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => SAMPLE_XML })
        });

        const labels = [...container.querySelectorAll('[data-field]')].map((el) => el.dataset.field);
        expect(labels).toEqual(['Owner', 'Village Code', 'Khewat No.']);
        expect(container.textContent).toContain('सुभाष कुमार');
        expect(container.textContent).toContain('102');
    });

    it('splits multi-share owner text into one line per share', async () => {
        const { container } = await render({
            fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => SAMPLE_XML })
        });

        const owner = container.querySelector('[data-field="Owner"] [data-role="value"]').textContent;
        expect(owner.split('\n').filter(Boolean)).toHaveLength(2);
    });

    it('offers the HSAC bridge when the proxy hits the login gate', async () => {
        const { container } = await render({
            fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' })
        });

        expect(container.textContent).toContain('signed-in session');
        expect(container.querySelector('[data-role="connect"]').textContent).toBe('Open HSAC tab');
        expect(container.querySelector('a[href*="hsac-bridge.user.js"]')).toBeTruthy();
    });

    it('adopts an HSAC tab that announces itself, without a fresh connect', async () => {
        const { win, container } = await render({
            fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' })
        });
        expect(container.querySelector('[data-role="connect"]')).toBeTruthy();

        announcingBridgeTab(win, SAMPLE_XML).announce();

        await vi.waitFor(() => expect(container.querySelector('[data-field="Owner"]')).toBeTruthy());
        expect(container.textContent).toContain('via your signed-in HSAC tab');
    });

    it('ignores bridge messages from any other origin', async () => {
        const { win, container } = await render({
            fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' })
        });

        const event = new win.MessageEvent('message', {
            data: { type: 'hsac-bridge-ready', signedIn: true },
            origin: 'https://evil.example'
        });
        Object.defineProperty(event, 'source', { value: { closed: false, postMessage: vi.fn() } });
        win.dispatchEvent(event);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(container.querySelector('[data-role="connect"]')).toBeTruthy();
    });

    it('requests the plot codes from the proxy in HSAC parameter form', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => SAMPLE_XML });
        await render({ fetchImpl });

        const proxied = new URL(fetchImpl.mock.calls[0][0]).searchParams.get('url');
        expect(proxied).toBe('https://hsac.in/eodb_backend/mapserver/land-record/Owner_name?Dcode1=05&Tcode1=136&Nvcode1=04101&Mustno1=14&Khasra1=12%2F1');
    });
});
