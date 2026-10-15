const STYLE_ID = 'external-data-card-style';

const CSS = `
.ext-data { margin: 6px 0 4px; border: 1px solid rgba(96,165,250,0.35); border-left: 3px solid #3b82f6; border-radius: 4px; background: rgba(59,130,246,0.07); overflow: hidden; }
.ext-data-header { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; padding: 2px 6px; line-height: 1.1; background: rgba(59,130,246,0.14); border-bottom: 1px solid rgba(96,165,250,0.25); font-size: 9px; font-weight: 600; color: #93c5fd; }
.ext-data-header sl-icon { font-size: 10px; flex-shrink: 0; display: block; }
.ext-data-title { line-height: 1.1; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; color: #93c5fd; }
.ext-data-links { display: flex; align-items: center; flex-wrap: wrap; gap: 0 6px; margin-left: auto; line-height: 1.1; }
.ext-data-links a { line-height: 1.1; color: #bfdbfe; text-decoration: none; }
.ext-data-links a:hover { color: #fff; text-decoration: underline; }
.ext-data-links span { color: #4b5563; }
.ext-data-body { padding: 2px 6px; }
.ext-data-row { display: flex; flex-direction: column; padding: 3px 0; border-bottom: 1px solid rgba(96,165,250,0.18); }
.ext-data-row:last-child { border-bottom: none; }
.ext-data-value { color: #f3f4f6; font-size: 10px; line-height: 1.3; word-break: break-word; white-space: pre-line; }
.ext-data-label { color: #9ca3af; font-size: 8px; line-height: 1.3; word-break: break-word; }
.ext-data-message { display: flex; align-items: center; gap: 6px; padding: 4px 0; color: #9ca3af; font-size: 9px; }
.ext-data-message.error { color: #f87171; }
.ext-data-message a { color: #60a5fa; }
.ext-data-spinner { width: 12px; height: 12px; flex-shrink: 0; animation: ext-data-spin 1s linear infinite; }
.ext-data-footer { padding: 2px 6px; line-height: 1.2; border-top: 1px solid rgba(96,165,250,0.25); font-size: 8px; font-style: italic; color: #6b7280; }
.ext-data-footer a { color: #60a5fa; }
@keyframes ext-data-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;

export function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

export function externalDataRows(rows) {
    return rows
        .map(([label, value]) =>
            `<div class="ext-data-row"><div class="ext-data-value">${escapeHTML(value)}</div><div class="ext-data-label">${escapeHTML(label)}</div></div>`)
        .join('');
}

export function externalDataMessage(text, tone = 'info') {
    return `<div class="ext-data-message${tone === 'error' ? ' error' : ''}">${text}</div>`;
}

export function externalDataLoading(text) {
    const spinner = `<svg class="ext-data-spinner" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
    return `<div class="ext-data-message">${spinner}<span>${text}</span></div>`;
}

export function externalDataCard({ id, title, icon = 'cloud-download', links = [], source, loadingHTML = '' }) {
    ensureStyle();
    const linksHTML = links
        .map(({ label, href }) => `<a href="${escapeHTML(href)}" target="_blank" rel="noopener">${escapeHTML(label)}</a>`)
        .join('<span>|</span>');
    const footerHTML = source
        ? `<div class="ext-data-footer">${source.prefix || 'Source'}: <a href="${escapeHTML(source.href)}" target="_blank" rel="noopener">${escapeHTML(source.label)}</a>${source.note ? `. ${escapeHTML(source.note)}` : ''}</div>`
        : '';
    return `<div class="ext-data">` +
        `<div class="ext-data-header"><sl-icon name="${escapeHTML(icon)}"></sl-icon><span class="ext-data-title">${escapeHTML(title)}</span><div class="ext-data-links">${linksHTML}</div></div>` +
        `<div class="ext-data-body" id="${escapeHTML(id)}" data-executed="false">${loadingHTML}</div>` +
        footerHTML +
        `</div>`;
}

if (typeof window !== 'undefined') {
    ensureStyle();
    window.externalData = {
        rows: externalDataRows,
        message: externalDataMessage,
        loading: externalDataLoading,
        escape: escapeHTML
    };
}
