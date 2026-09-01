/**
 * ============================================================================
 * Haryana Atlas - Layer Inspection Handlers
 * ============================================================================
 *
 * Custom functions that run when users click on map features in Haryana layers.
 *
 * See layer-handlers.template.js for more examples and documentation.
 * ============================================================================
 */

const BRIDGE_SCRIPT_URL = 'https://github.com/publicmap/amche-atlas/blob/main/tools/hsac-bridge.user.js';

export const handlers = {

    /**
     * HSAC Land Record (Owner details)
     * Fetches owner information for a cadastral plot from the Haryana Space
     * Applications Centre EODB land-record service.
     *
     * hsac.in gates this endpoint behind a phone/OTP session and refuses
     * cross-origin requests, so lookups run through the shared proxy or, once
     * connected, through the user's own signed-in hsac.in tab - see
     * docs/HARYANA-LAND-RECORDS.md and tools/hsac-bridge.user.js.
     *
     * Used for: HSAC Cadastrals layer (id: "plots")
     * Properties needed: n_d_code, n_t_code, n_v_code, n_murr_no, n_khas_no
     */
    getHaryanaLandRecord: async ({ feature }) => {
        const p = feature.properties || {};
        const params = {
            dCode: p.n_d_code || '',
            tCode: p.n_t_code || '',
            vCode: p.n_v_code || '',
            murabbaNo: p.n_murr_no || '',
            khasraNo: p.n_khas_no || ''
        };

        const apiUrl = `https://hsac.in/eodb_backend/mapserver/land-record/Owner_name`
            + `?Dcode1=${encodeURIComponent(params.dCode)}`
            + `&Tcode1=${encodeURIComponent(params.tCode)}`
            + `&Nvcode1=${encodeURIComponent(params.vCode)}`
            + `&Mustno1=${encodeURIComponent(params.murabbaNo)}`
            + `&Khasra1=${encodeURIComponent(params.khasraNo)}`;

        const proxyUrl = `https://amche-atlas-production.up.railway.app/proxy`
            + `?url=${encodeURIComponent(apiUrl)}`
            + `&referer=${encodeURIComponent('https://hsac.in/eodb/map')}`;

        const requestId = `hsac-land-record-${Object.values(params).join('-').replace(/[^\w-]/g, '_')}`;

        return `
            <div style="border: 1px solid #374151; border-radius: 4px; margin: 8px 0; overflow: hidden; background: #111827;">
                <div style="padding: 4px 8px; font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: 0.06em; border-bottom: 1px solid #374151; display: flex; align-items: center; gap: 5px;">
                    <sl-icon name="person-vcard" style="font-size: 12px;"></sl-icon>
                    <a href="https://hsac.in/eodb/map" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Haryana Land Record</a>
                    <span style="color: #4b5563;">|</span>
                    <a href="https://jamabandi.nic.in/" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Jamabandi</a>
                </div>
                <div id="${requestId}" data-executed="false">
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; color: #9ca3af; font-size: 10px;">
                        <svg style="width: 12px; height: 12px; animation: spin 1s linear infinite; flex-shrink: 0;" fill="none" viewBox="0 0 24 24">
                            <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Loading...</span>
                    </div>
                </div>
            </div>
            <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
            <script>
                (function() {
                    if (!window.__bhunakshaCache) window.__bhunakshaCache = new Map();

                    const requestId = '${requestId}';
                    const proxyUrl = '${proxyUrl}';
                    const params = ${JSON.stringify(params)};
                    const HSAC_ORIGIN = 'https://hsac.in';
                    const BRIDGE_SCRIPT_URL = '${BRIDGE_SCRIPT_URL}';

                    const container = document.getElementById(requestId);
                    if (!container) return;

                    if (window.__bhunakshaCache.has(requestId)) {
                        container.innerHTML = window.__bhunakshaCache.get(requestId);
                        container.setAttribute('data-executed', 'true');
                        return;
                    }
                    if (container.getAttribute('data-executed') === 'true') return;
                    container.setAttribute('data-executed', 'true');

                    // The handler renders inside the same-origin inspector iframe; the bridge
                    // window handle lives on the top window so one HSAC tab serves every lookup.
                    const W = (function() {
                        try { return window.top.document ? window.top : window; } catch (e) { return window; }
                    })();

                    const bridge = W.__hsacBridge || (W.__hsacBridge = (function() {
                        let win = null, ready = false, ping = null;
                        const pending = new Map();
                        const waiters = [];

                        W.addEventListener('message', function(event) {
                            if (event.origin !== HSAC_ORIGIN || !event.data) return;
                            if (event.data.type === 'hsac-bridge-ready') {
                                // Adopt the announcing window: after a page reload this is the
                                // only way back to an HSAC tab we no longer hold a handle on.
                                if (event.source) win = event.source;
                                ready = true;
                                if (ping) { clearInterval(ping); ping = null; }
                                waiters.splice(0).forEach(fn => fn());
                            } else if (event.data.type === 'hsac-land-record-result') {
                                const resolve = pending.get(event.data.requestId);
                                if (resolve) { pending.delete(event.data.requestId); resolve(event.data); }
                            }
                        });

                        return {
                            isReady: function() { return ready && !!win && !win.closed; },
                            connect: function() {
                                win = window.open(HSAC_ORIGIN + '/eodb/map', 'amche-hsac-bridge');
                                ready = false;
                                if (!win) return false;
                                if (!ping) {
                                    ping = setInterval(function() {
                                        try { win.postMessage({ type: 'hsac-bridge-ping' }, HSAC_ORIGIN); } catch (e) {}
                                    }, 700);
                                    setTimeout(function() { if (ping) { clearInterval(ping); ping = null; } }, 120000);
                                }
                                return true;
                            },
                            onReady: function(fn) { if (this.isReady()) fn(); else waiters.push(fn); },
                            request: function(payload) {
                                const self = this;
                                return new Promise(function(resolve, reject) {
                                    if (!self.isReady()) return reject(new Error('bridge not connected'));
                                    const id = 'lr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                                    const timer = setTimeout(function() {
                                        pending.delete(id);
                                        reject(new Error('bridge timed out'));
                                    }, 30000);
                                    pending.set(id, function(data) { clearTimeout(timer); resolve(data); });
                                    win.postMessage({ type: 'hsac-land-record', requestId: id, params: payload }, HSAC_ORIGIN);
                                });
                            }
                        };
                    })());

                    const FIELD_TITLES = {
                        OWNER: 'Owner',
                        NVCODE: 'Village Code',
                        CKHEWAT: 'Khewat No.',
                        CKHATONI: 'Khatauni No.',
                        MURABBA: 'Murabba No.',
                        KHASRA: 'Khasra No.'
                    };

                    function escapeHtml(s) {
                        return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
                    }

                    function ownerLines(text) {
                        const clean = text.replace(/\\s+/g, ' ').trim();
                        const parts = clean.split(/(?<=वासी)\\s*/).map(s => s.trim()).filter(Boolean);
                        return parts.length ? parts : [clean];
                    }

                    function parseRows(xml) {
                        const outer = new DOMParser().parseFromString(xml, 'text/xml');
                        const inner = outer.documentElement ? outer.documentElement.textContent : '';
                        if (!inner || !inner.trim()) return [];
                        const root = new DOMParser().parseFromString(inner.trim(), 'text/xml');
                        if (!root.documentElement || root.querySelector('parsererror')) return [];

                        const nodes = Array.from(root.documentElement.children);
                        const owner = nodes.find(n => n.tagName.toUpperCase() === 'OWNER');
                        const ordered = owner ? [owner].concat(nodes.filter(n => n !== owner)) : nodes;

                        return ordered.reduce(function(rows, node) {
                            const value = (node.textContent || '').trim();
                            if (!value) return rows;
                            const tag = node.tagName.toUpperCase();
                            rows.push([
                                FIELD_TITLES[tag] || node.tagName,
                                tag === 'OWNER' ? ownerLines(value).join('\\n') : value
                            ]);
                            return rows;
                        }, []);
                    }

                    function setLoading(message) {
                        container.innerHTML = '<div style="padding:6px 8px;color:#9ca3af;font-size:10px;">' + escapeHtml(message) + '</div>';
                    }

                    function renderRecord(xml, source) {
                        const rows = parseRows(xml);
                        const body = rows.map(([key, value]) =>
                            \`<div data-field="\${escapeHtml(key)}" style="display:flex;font-size:10px;padding:2px 8px;border-bottom:1px solid #374151;">
                                <div style="color:#9ca3af;min-width:90px;font-weight:500;flex-shrink:0;">\${escapeHtml(key)}</div>
                                <div data-role="value" style="color:#e5e7eb;flex:1;word-break:break-word;white-space:pre-line;">\${escapeHtml(value)}</div>
                            </div>\`
                        ).join('') || '<div style="padding:4px 8px;color:#9ca3af;font-size:10px;">No owner data available</div>';

                        const html = body + \`
                            <div style="padding:4px 8px;font-style:italic;font-size:10px;color:#6b7280;border-top:1px solid #374151;">
                                Retrieved live from <a href="https://hsac.in/eodb/map" target="_blank" style="color:#60a5fa;">HSAC EODB</a>\${source === 'bridge' ? ' via your signed-in HSAC tab' : ''}. For information purposes only.
                            </div>
                        \`;
                        if (!document.body.contains(container)) return;
                        container.innerHTML = html;
                        if (rows.length) window.__bhunakshaCache.set(requestId, html);
                    }

                    function renderError(message) {
                        if (!document.body.contains(container)) return;
                        container.innerHTML = \`
                            <div style="display:flex;align-items:center;gap:8px;color:#f87171;padding:6px 8px;font-size:10px;">
                                <sl-icon name="exclamation-octagon" style="font-size:14px;flex-shrink:0;"></sl-icon>
                                <span>\${escapeHtml(message)} Check <a href="https://hsac.in/eodb/map" target="_blank" style="color:#60a5fa;">HSAC EODB Map</a></span>
                            </div>
                        \`;
                    }

                    // A bridge tab left open from before this page load announces itself
                    // within a heartbeat, so an offered card upgrades itself to a lookup.
                    let awaitingAnnounce = false;
                    function armAutoRetry() {
                        if (awaitingAnnounce || bridge.isReady()) return;
                        awaitingAnnounce = true;
                        bridge.onReady(function() {
                            awaitingAnnounce = false;
                            if (document.body.contains(container)) lookupViaBridge();
                        });
                    }

                    function renderConnect(message) {
                        if (!document.body.contains(container)) return;
                        const connected = bridge.isReady();
                        container.innerHTML = \`
                            <div style="padding:6px 8px;font-size:10px;color:#9ca3af;line-height:1.6;">
                                <div>\${escapeHtml(message)}</div>
                                <div style="margin-top:6px;display:flex;gap:8px;align-items:center;">
                                    <button data-role="connect" style="background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:3px;padding:3px 8px;font-size:10px;cursor:pointer;">\${connected ? 'Retry lookup' : 'Open HSAC tab'}</button>
                                    <span style="color:#6b7280;">Khasra \${escapeHtml(params.khasraNo)}</span>
                                </div>
                                <div style="margin-top:5px;color:#6b7280;">Live lookups need the one-time <a href="\${BRIDGE_SCRIPT_URL}" target="_blank" style="color:#60a5fa;">amche HSAC bridge userscript</a> and a signed-in hsac.in tab. Your login stays on hsac.in.\${connected ? '' : ' An HSAC tab that is already open reconnects on its own within a few seconds.'}</div>
                            </div>
                        \`;
                        if (!connected) armAutoRetry();
                        const button = container.querySelector('[data-role="connect"]');
                        if (!button) return;
                        button.addEventListener('click', function() {
                            if (bridge.isReady()) { lookupViaBridge(); return; }
                            if (!bridge.connect()) {
                                renderConnect('Popup blocked. Allow popups for this site, then try again.');
                                return;
                            }
                            setLoading('Waiting for the HSAC tab to answer...');
                            bridge.onReady(lookupViaBridge);
                        });
                    }

                    async function lookupViaBridge() {
                        setLoading('Asking your signed-in HSAC tab...');
                        try {
                            const result = await bridge.request(params);
                            if (result.ok) return renderRecord(result.xml, 'bridge');
                            if (result.status === 401 || result.status === 403) {
                                return renderConnect('Your HSAC tab is not signed in. Complete the OTP login there, then retry.');
                            }
                            renderError('HSAC returned HTTP ' + result.status + '.');
                        } catch (error) {
                            console.error('[HSAC] Bridge error:', error);
                            renderConnect('Could not reach the HSAC tab (' + error.message + ').');
                        }
                    }

                    async function lookupViaProxy() {
                        try {
                            const response = await fetch(proxyUrl);
                            if (response.status === 401 || response.status === 403) {
                                return renderConnect('HSAC requires a signed-in session for land records.');
                            }
                            if (!response.ok) throw new Error('HTTP ' + response.status);
                            renderRecord(await response.text(), 'proxy');
                        } catch (error) {
                            console.error('[HSAC] Proxy error:', error);
                            renderError('Error fetching land record (' + error.message + ').');
                        }
                    }

                    setTimeout(function() {
                        if (bridge.isReady()) lookupViaBridge(); else lookupViaProxy();
                    }, 0);
                })();
            </script>
        `;
    },

};
