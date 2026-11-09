/**
 * A layer's `attribution` as ordered parts: the original source first, then
 * any intermediaries it came through (a georeferencer, a collector, a tile
 * service) in order - written back as the parts joined by commas (see
 * docs/API.md "Attribution and license").
 *
 * parseAttribution() reads the many ways attributions have been written -
 * "A via B", "Source: A - Collected by B", "A. Georeferenced using B",
 * "© A - <a>View Original</a>" - drops the connecting words, keeps "©"
 * credits, and takes any license wording out into `license`, which belongs in
 * the layer's own `license` field. No DOM, so it runs in node too.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', copy: '©', hellip: '…' };

// Hosts that pass on someone else's data: listed after the original source
const INTERMEDIARY_HOSTS = [
    'mapwarper.net', 'warper.wmflabs.org', 'maphub.co', 'indianopenmaps.com', 'datameet.org',
    'github.com/ramseraph', 'ramseraph.github.io', 'raw.githubusercontent.com/datameet', 'data.opencity.in',
    'shortbread-tiles.org', 'tiles.openstreetmap.us', 'overpass-turbo.eu', 'overpass-api.de'
];

const HOST_LABELS = {
    'mapwarper.net': 'MapWarper',
    'warper.wmflabs.org': 'Wikimaps Warper',
    'commons.wikimedia.org': 'Wikimedia Commons',
    'drive.google.com': 'Google Drive',
    'docs.google.com': 'Google Docs',
    'archive.org': 'Internet Archive'
};

const LICENSE = /\b(?:cc[- ]?0|cc[- ]?by(?:[- ](?:sa|nc|nd))*(?:[- ]?\d\.\d)?|odbl|public[- ]domain|dl-de\/by-2-0)\b/gi;
// Words left over once the connectors are gone, that name no source
const FILLER = /^(?:data|source|sources|map|maps|and)$/i;
const CONNECTORS = /\b(?:released in|collected (?:by|via)|georeferenced using|via|from)\b|\b(?:source|data)\s*:|\s[-–—]\s|^[-–—]\s|\s[-–—]$|[.;]\s|[.;]$/gi;

function decode(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, code) => {
            if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
            return ENTITIES[code.toLowerCase()] ?? match;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function host(href) {
    try {
        const url = new URL(href);
        return url.hostname.replace(/^www\./, '').toLowerCase() + url.pathname.toLowerCase();
    } catch {
        return '';
    }
}

/** A readable name for a link's site, for labels that are only a URL or "View Original". */
export function hostLabel(href) {
    const where = host(href);
    const name = where.split('/')[0];
    return HOST_LABELS[name] || name || href;
}

/** Normalises a license mention: "CC-by-sa-2.0" -> "CC-BY-SA-2.0", "public domain" -> "Public Domain". */
export function normalizeLicense(text) {
    const raw = String(text || '').trim();
    if (/^public[- ]domain$/i.test(raw)) return 'Public Domain';
    if (/^odbl$/i.test(raw)) return 'ODbL';
    if (/^cc[- ]?0$/i.test(raw)) return 'CC0';
    if (/^dl-de/i.test(raw)) return 'dl-de/by-2-0';
    return raw.toUpperCase().replace(/\s+/g, '-').replace(/^CC-?BY/, 'CC-BY').replace(/-?(\d\.\d)$/, '-$1');
}

// A derived work names its license first ("CC-BY Wikipedia/user:...")
const DERIVED = /^(?:cc0|cc[- ]?by)\b/i;

function isIntermediary(part) {
    const where = part.href ? host(part.href) : '';
    return (!!where && INTERMEDIARY_HOSTS.some(known => where.startsWith(known))) || (!!part.href && DERIVED.test(part.text));
}

function linkLabel(text, href) {
    if (!text || /^view (?:original|source)$/i.test(text) || /^https?:\/\//i.test(text)) return hostLabel(href);
    return text.replace(/[\s,;:-]+$/, '');
}

/** The part's name for grouping: "Datameet Community:LGD_Districts" -> "Datameet Community", a file name -> its site. */
export function sourceKey(part) {
    let label = part.text.replace(/^©\s*/, '').trim();
    if (part.href && (/^file:/i.test(label) || /\.(jpe?g|png|tiff?|pdf)$/i.test(label))) label = hostLabel(part.href);
    const prefix = label.match(/^([^:]{2,40}):\s*\S/);
    if (prefix && prefix[1].split(/\s+/).length <= 3) label = prefix[1].trim();
    return label;
}

/**
 * @param {string} html - an attribution as written in a config
 * @returns {{parts: Array<{text: string, href: string|null}>, license: string|null}}
 */
export function parseAttribution(html) {
    const source = String(html || '');
    const found = [];
    const licenses = [];
    const takeLicenses = (text) => text.replace(LICENSE, (match) => {
        licenses.push(normalizeLicense(match));
        return ' ';
    });
    const addText = (text) => {
        takeLicenses(decode(text)).split(CONNECTORS).forEach(piece => {
            const clean = piece.replace(/^[\s,:&-]+|[\s,:&-]+$/g, '').trim();
            if (/^https?:\/\/\S+$/i.test(clean)) found.push({ text: hostLabel(clean), href: clean });
            else if (clean && /[\p{L}\p{N}]/u.test(clean) && !FILLER.test(clean)) found.push({ text: clean, href: null });
        });
    };
    const link = /<a\b[^>]*?href\s*=\s*(['"]?)([^'"\s>]+)\1?[^>]*>([\s\S]*?)<\/a\s*>/gi;
    let last = 0;
    let match;
    while ((match = link.exec(source))) {
        addText(source.slice(last, match.index));
        const href = match[2];
        const text = decode(match[3]);
        LICENSE.lastIndex = 0;
        const licenseInLabel = text.match(LICENSE);
        if (licenseInLabel && !licenses.length) licenses.push(normalizeLicense(licenseInLabel[0]));
        // A link that is only a license names no source
        if (!licenseInLabel || text.replace(LICENSE, '').trim()) found.push({ text: linkLabel(text, href), href });
        last = link.lastIndex;
    }
    addText(source.slice(last));

    // A name given both as text and as a link ("© MapWarper - <a>View Original</a>") is kept once, as the link
    const keyOf = (part) => sourceKey(part).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const parts = [];
    found.forEach(part => {
        const same = parts.findIndex(other => keyOf(other) === keyOf(part));
        if (same === -1) parts.push(part);
        else if (!parts[same].href && part.href) parts[same] = { ...part, text: parts[same].text.startsWith('©') && !part.text.startsWith('©') ? `© ${part.text}` : part.text };
    });
    const ordered = [...parts.filter(part => !isIntermediary(part)), ...parts.filter(isIntermediary)];
    return { parts: ordered, license: licenses[0] || null };
}

/** The parts written back: links as <a href='...'>, joined by commas. */
export function formatAttribution(parts) {
    return parts.map(part => (part.href
        ? `<a href='${part.href.replace(/'/g, '%27')}'>${escapeText(part.text)}</a>`
        : escapeText(part.text))).join(', ');
}

/** A license the source implies, where the attribution does not say one. */
export function impliedLicense(parts) {
    const names = parts.map(part => `${part.text} ${part.href || ''}`.toLowerCase()).join(' ');
    if (/openhistoricalmap/.test(names)) return 'CC0';
    if (/openstreetmap/.test(names)) return 'ODbL';
    if (/mapillary/.test(names)) return 'CC-BY-SA-4.0';
    if (/\bnasa\b|\bgibs\b|\busgs\b|landsat/.test(names)) return 'Public Domain';
    return null;
}
