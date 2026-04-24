export const handlers = {

    getMahaBhunakshaInfo: async ({ feature }) => {
        const pin = feature.properties.PIN || '';
        const ccode = feature.properties.CCODE || '';
        const vilName = feature.properties.VIL_NAME || '';
        const theName = feature.properties.THENAME || '';

        // giscode = "RVM" + district(2) + taluka(2) + "27" + district(2) + taluka_padded(4) + village_seq(4) + suffix(6)
        // suffix = (parseInt(CCODE[14:16]) + 11).padStart(2,'0') + "0000"
        const district = ccode.substring(0, 2);
        const taluka = ccode.substring(4, 6);
        const talukaFull = ccode.substring(2, 6);
        const villageSeq = ccode.substring(10, 14);
        const villageSuffix = String(parseInt(ccode.substring(14, 16), 10) + 11).padStart(2, '0') + '0000';
        const villageCode = `27${district}${talukaFull}${villageSeq}${villageSuffix}`;
        const giscode = `RVM${district}${taluka}${villageCode}`;

        const requestId = `maha-bhunaksha-${ccode}-${String(pin).replace(/\//g, '-')}`;
        const proxyUrl = `https://amche-atlas-production.up.railway.app/maha-bhunaksha?giscode=${encodeURIComponent(giscode)}&plotno=${encodeURIComponent(pin)}`;

        return `
            <div style="border: 1px solid #374151; border-radius: 4px; margin: 8px 0; overflow: hidden; background: #111827;">
                <div style="padding: 4px 8px; font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: 0.06em; border-bottom: 1px solid #374151; display: flex; align-items: center; gap: 5px;">
                    <sl-icon name="person-vcard" style="font-size: 12px;"></sl-icon>
                    <a href="https://mahabhunakasha.mahabhumi.gov.in/" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Maharashtra Land Record</a>
                    <span style="color: #4b5563;">|</span>
                    <a href="https://bhulekh.mahabhumi.gov.in/" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Bhulekh</a>
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
            <style>
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            </style>
            <script>
                (function() {
                    if (!window.__bhunakshaCache) {
                        window.__bhunakshaCache = new Map();
                    }

                    const requestId = '${requestId}';
                    const proxyUrl = '${proxyUrl}';

                    const container = document.getElementById(requestId);
                    if (!container) return;

                    if (window.__bhunakshaCache.has(requestId)) {
                        container.innerHTML = window.__bhunakshaCache.get(requestId);
                        container.setAttribute('data-executed', 'true');
                        return;
                    }

                    if (container.getAttribute('data-executed') === 'true') return;
                    container.setAttribute('data-executed', 'true');

                    setTimeout(async function() {
                    try {
                        const r = await fetch(proxyUrl);
                        const text = await r.text();
                        const data = text && text.trim() ? JSON.parse(text) : null;

                        // UTM Zone 43N (EPSG:32643) → WGS84
                        function utm43n(e, n) {
                            var a=6378137, ee=0.00669437999014, k=0.9996;
                            var x=e-500000, e1=(1-Math.sqrt(1-ee))/(1+Math.sqrt(1-ee));
                            var mu=n/k/(a*(1-ee/4-3*ee*ee/64-5*ee*ee*ee/256));
                            var p1=mu+(3*e1/2-27*e1*e1*e1/32)*Math.sin(2*mu)+(21*e1*e1/16-55*Math.pow(e1,4)/32)*Math.sin(4*mu)+(151*e1*e1*e1/96)*Math.sin(6*mu);
                            var sp=Math.sin(p1),cp=Math.cos(p1),tp=Math.tan(p1);
                            var N1=a/Math.sqrt(1-ee*sp*sp), T1=tp*tp, C1=ee/(1-ee)*cp*cp;
                            var R1=a*(1-ee)/Math.pow(1-ee*sp*sp,1.5), D=x/(N1*k);
                            var lat=p1-N1*tp/R1*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ee/(1-ee))*Math.pow(D,4)/24+(61+90*T1+298*C1+45*T1*T1-252*ee/(1-ee)-3*C1*C1)*Math.pow(D,6)/720);
                            var lon=(D-(1+2*T1+C1)*D*D*D/6+(5-2*C1+28*T1-3*C1*C1+8*ee/(1-ee)+24*T1*T1)*Math.pow(D,5)/120)/cp;
                            return [75+lon*180/Math.PI, lat*180/Math.PI];
                        }
                        function wktToGeojson(wkt) {
                            var rings=[], depth=0, start=0;
                            for (var i=0;i<wkt.length;i++) {
                                if (wkt[i]==='(') { if (++depth===3) start=i+1; }
                                else if (wkt[i]===')') { if (depth--===3) rings.push(wkt.slice(start,i)); }
                            }
                            return { type:'MultiPolygon', coordinates:[rings.map(function(r) {
                                return r.split(',').map(function(s) { var p=s.trim().split(/\\s+/); return utm43n(+p[0],+p[1]); });
                            })]};
                        }

                        // Update pink highlight layer on the map
                        if (data && data.the_geom && window.map) {
                            try {
                                var geom = wktToGeojson(data.the_geom);
                                var geojson = { type:'FeatureCollection', features:[{ type:'Feature', geometry:geom, properties:{} }] };
                                var SOURCE = 'maha-bhunaksha-highlight';
                                if (window.map.getSource(SOURCE)) {
                                    window.map.getSource(SOURCE).setData(geojson);
                                } else {
                                    window.map.addSource(SOURCE, { type:'geojson', data:geojson });
                                    window.map.addLayer({ id:SOURCE, type:'line', source:SOURCE, paint:{ 'line-color':'#ec4899', 'line-width':2.5, 'line-opacity':0.9 } });
                                }
                            } catch(e) { console.warn('[MahaBhunaksha] geom error:', e.message); }
                        }

                        let contentHTML;
                        if (data && data.info) {
                            const lines = data.info.split('\\n').filter(l => l.trim() && !/-{5,}/.test(l));
                            const rows = [];
                            for (const line of lines) {
                                const idx = line.indexOf(':');
                                if (idx > 0) rows.push([line.substring(0, idx).trim(), line.substring(idx+1).trim()]);
                            }
                            contentHTML = rows.map(([key, value]) =>
                                \`<div style="display:flex;font-size:10px;padding:2px 8px;border-bottom:1px solid #374151;">
                                    <div style="color:#9ca3af;min-width:90px;font-weight:500;flex-shrink:0;">\${key}</div>
                                    <div style="color:#e5e7eb;flex:1;word-break:break-word;">\${value}</div>
                                </div>\`
                            ).join('');
                            if (!contentHTML) contentHTML = '<div style="padding:4px 8px;color:#9ca3af;font-size:10px;">No occupant data available</div>';
                        } else {
                            contentHTML = '<div style="padding:4px 8px;color:#9ca3af;font-size:10px;">No occupant data available</div>';
                        }

                        if (!document.body.contains(container)) return;

                        const finalHTML = \`
                            \${contentHTML}
                            <div style="padding:4px 8px;font-style:italic;font-size:10px;color:#6b7280;border-top:1px solid #374151;">
                                Retrieved live from <a href="https://mahabhunakasha.mahabhumi.gov.in/" target="_blank" style="color:#60a5fa;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">Maha Bhunaksha</a>. For information purposes only.
                            </div>
                        \`;
                        container.innerHTML = finalHTML;
                        window.__bhunakshaCache.set(requestId, finalHTML);
                        container.setAttribute('data-executed', 'true');
                    } catch (error) {
                        console.error('[MahaBhunaksha] Error:', error);
                        const errorHTML = \`
                            <div style="display:flex;align-items:center;gap:8px;color:#f87171;padding:6px 8px;font-size:10px;">
                                <sl-icon name="exclamation-octagon" style="font-size:14px;flex-shrink:0;"></sl-icon>
                                <span>Error fetching land record. Check <a href="https://mahabhunakasha.mahabhumi.gov.in/" target="_blank" style="color:#60a5fa;">Maha Bhunaksha</a></span>
                            </div>
                        \`;
                        if (container && document.body.contains(container)) {
                            container.innerHTML = errorHTML;
                            window.__bhunakshaCache.set(requestId, errorHTML);
                            container.setAttribute('data-executed', 'true');
                        }
                    }
                    }, 0);
                })();
            </script>
        `;
    },

};
