/**
 * Shared formatting for a single attribute/property value shown in a feature's
 * attribute table - used by both the map-marker-manager.js badge popup and
 * map-inspector.html's property panel, so the two stay visually consistent
 * and any future value-formatting enhancement (richer link previews,
 * type-specific renderers, etc.) only needs to be written once.
 */

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function truncateText(value, max = 50) {
    const s = String(value ?? '');
    return s.length > max ? `${s.slice(0, max)}...` : s;
}

// A value is treated as a link only when it's *entirely* a URL (after
// trimming) - free text that merely mentions a URL falls through to plain
// escaped text here (map-inspector.html's own linkify pass handles that case
// by scanning for embedded URLs and calling buildLinkHTML per match).
export function isUrlValue(value) {
    return /^https?:\/\/\S[^\r\n]*$/i.test(String(value ?? '').trim());
}

/** Splits a `url1, url2` / `url1; url2` value into its parts, only if every part is itself a URL. */
export function splitMultiUrlValue(value) {
    const parts = String(value ?? '').split(/[,;]/).map(p => p.trim()).filter(p => p !== '');
    return parts.length > 1 && parts.every(p => isUrlValue(p)) ? parts : null;
}

/** True if the whole value (or a `,`/`;`-joined list of it) is nothing but URL(s) - i.e. formatAttributeValue will render it as link(s), not plain text. */
export function isFullyUrlValue(value) {
    return isUrlValue(value) || splitMultiUrlValue(value) !== null;
}

const ICON_ATTRS = 'width="14" height="14" style="flex-shrink:0;display:block;" xmlns="http://www.w3.org/2000/svg"';

// A folded-corner "document" icon shared by the three Google Workspace file
// types - only the fill colors and the accent glyph on the page differ.
function workspaceDocIconSVG({ label, fill, foldFill, accent }) {
    return `<svg viewBox="0 0 24 24" ${ICON_ATTRS}><title>${escapeHtml(label)}</title>` +
        `<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="${fill}"/>` +
        `<path d="M15 2v5h5z" fill="${foldFill}"/>` +
        accent +
        `</svg>`;
}

let driveIconInstanceCounter = 0;

const SERVICE_ICONS = {
    'google-forms': () => workspaceDocIconSVG({
        label: 'Google Forms', fill: '#673AB7', foldFill: '#4E2A8E',
        accent: '<path d="M7.5 12.5l1.8 1.8L13 10.6" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<rect x="7.5" y="16" width="9" height="1.4" rx="0.7" fill="#fff"/>',
    }),
    'google-sheets': () => workspaceDocIconSVG({
        label: 'Google Sheets', fill: '#0F9D58', foldFill: '#0B7C43',
        accent: '<rect x="7" y="11" width="10" height="7" fill="none" stroke="#fff" stroke-width="1"/>' +
            '<line x1="7" y1="14.5" x2="17" y2="14.5" stroke="#fff" stroke-width="1"/>' +
            '<line x1="12" y1="11" x2="12" y2="18" stroke="#fff" stroke-width="1"/>',
    }),
    'google-docs': () => workspaceDocIconSVG({
        label: 'Google Docs', fill: '#4285F4', foldFill: '#2A5DB0',
        accent: '<rect x="7" y="11" width="10" height="1.3" rx="0.6" fill="#fff"/>' +
            '<rect x="7" y="14" width="10" height="1.3" rx="0.6" fill="#fff"/>' +
            '<rect x="7" y="17" width="6" height="1.3" rx="0.6" fill="#fff"/>',
    }),
    'google-drive': () => {
        const gradId = `drive-grad-${driveIconInstanceCounter++}`;
        return `<svg viewBox="0 0 24 24" ${ICON_ATTRS}><title>Google Drive</title>` +
            `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="#2684FC"/><stop offset="50%" stop-color="#00AC47"/><stop offset="100%" stop-color="#FFBA00"/>` +
            `</linearGradient></defs>` +
            `<polygon points="12,2 22,20 2,20" fill="url(#${gradId})"/></svg>`;
    },
    'google-maps': () => `<svg viewBox="0 0 24 24" ${ICON_ATTRS}><title>Google Maps</title>` +
        `<path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.72 11.19 7.11 11.52a1.4 1.4 0 0 0 1.78 0C13.28 21.19 20 15.25 20 10c0-4.42-3.58-8-8-8z" fill="#EA4335"/>` +
        `<circle cx="12" cy="10" r="3.2" fill="#fff"/></svg>`,
    'osm': () => `<svg viewBox="0 0 24 24" ${ICON_ATTRS}><title>OpenStreetMap</title>` +
        `<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" fill="none" stroke="#7EBC6A" stroke-width="1.6" stroke-linejoin="round"/>` +
        `<path d="M9 3v16M15 5v16" stroke="#7EBC6A" stroke-width="1.2"/></svg>`,
    'wikipedia': () => `<svg viewBox="0 0 24 24" ${ICON_ATTRS}><title>Wikipedia</title>` +
        `<circle cx="12" cy="12" r="11" fill="#000"/>` +
        `<text x="12" y="16.5" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="13" fill="#fff">W</text></svg>`,
    'wikidata': () => `<svg viewBox="0 0 24 24" ${ICON_ATTRS}><title>Wikidata</title>` +
        `<rect x="4" y="4" width="16" height="16" rx="2" transform="rotate(45 12 12)" fill="#006699"/>` +
        `<circle cx="12" cy="7" r="1.6" fill="#fff"/><circle cx="17" cy="12" r="1.6" fill="#fff"/>` +
        `<circle cx="12" cy="17" r="1.6" fill="#fff"/><circle cx="7" cy="12" r="1.6" fill="#fff"/></svg>`,
};

// Recognized services get their real (simplified) icon instead of the generic
// link icon, so a value's type (a form to fill in, a place on a map, a
// Wikipedia article...) is visible at a glance without opening the link.
// Adding a new service means adding a match pattern here and an icon above.
const URL_SERVICES = [
    { id: 'google-forms', label: 'Google Forms', match: /^https?:\/\/docs\.google\.com\/forms\// },
    { id: 'google-sheets', label: 'Google Sheets', match: /^https?:\/\/docs\.google\.com\/spreadsheets\// },
    { id: 'google-docs', label: 'Google Docs', match: /^https?:\/\/docs\.google\.com\/document\// },
    { id: 'google-drive', label: 'Google Drive', match: /^https?:\/\/drive\.google\.com\// },
    { id: 'google-maps', label: 'Google Maps', match: /^https?:\/\/(?:www\.)?google\.[a-z.]+\/maps\/|^https?:\/\/maps\.google\.[a-z.]+\/|^https?:\/\/goo\.gl\/maps\// },
    { id: 'osm', label: 'OpenStreetMap', match: /^https?:\/\/(?:www\.)?openstreetmap\.org\// },
    { id: 'wikipedia', label: 'Wikipedia', match: /^https?:\/\/[a-z][a-z-]*\.wikipedia\.org\// },
    { id: 'wikidata', label: 'Wikidata', match: /^https?:\/\/(?:www\.)?wikidata\.org\// },
];

export function detectUrlService(url) {
    const service = URL_SERVICES.find(s => s.match.test(url));
    return service ? { ...service, icon: SERVICE_ICONS[service.id] } : null;
}

const GENERIC_LINK_ICON_HTML = '<svg viewBox="0 0 16 16" width="13" height="13" style="flex-shrink:0;display:block;" fill="none" stroke="#60a5fa" stroke-width="1.4">' +
    '<path d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5"/>' +
    '<path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7 9"/></svg>';

/**
 * Renders one URL as a single clickable link: a service icon (if recognized,
 * else a generic external-link icon) followed by a truncated label - both
 * inside the same `<a>`, so clicking the icon itself also opens the link.
 * Only raw whitespace in the URL is percent-encoded for the `href` - a plain
 * encodeURI/-Component would double-encode a URL that's already
 * percent-encoded (e.g. a deep link with a JSON query param baked in).
 */
export function buildLinkHTML(url, { truncateMax = 40 } = {}) {
    const trimmed = String(url).trim();
    const href = escapeHtml(trimmed.replace(/\s/g, c => encodeURIComponent(c)));
    const label = escapeHtml(truncateText(trimmed, truncateMax));
    const service = detectUrlService(trimmed);
    const iconHTML = service ? service.icon() : GENERIC_LINK_ICON_HTML;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;max-width:100%;color:#60a5fa;text-decoration:underline;">` +
        `${iconHTML}<span style="word-break:break-all;">${label}</span>` +
        `</a>`;
}

/** Top-level entry point for a table cell's value: link(s) if it's nothing but URL(s), otherwise plain escaped text. */
export function formatAttributeValue(value, options = {}) {
    const urls = splitMultiUrlValue(value);
    if (urls) return urls.map(u => buildLinkHTML(u, options)).join('<br>');
    if (isUrlValue(value)) return buildLinkHTML(value, options);
    return escapeHtml(value);
}
