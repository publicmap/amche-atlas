/**
 * The address block of the place menu (js/map-location-menu-control.js): a
 * Nominatim reverse-geocode `address`, one level per row, in three
 * compartments, each listed most specific first -
 *
 *   1. Street: the place name, house number, street and postcode
 *   2. Locality: neighbourhood, quarter, suburb up to the town or village
 *   3. Administrative: the taluka up to the country
 *
 * Every part is a button; with OSM links on (js/location-osm.js) each part
 * whose OSM object is known also links to it on openstreetmap.org.
 */
import { osmObjectUrl } from './nominatim-search.js';

// Broad to specific. `zoom` is the camera zoom used when Nominatim returns no
// bounding box for that place.
const REGION_LEVELS = [
    { keys: ['country'], zoom: 5 },
    { keys: ['state', 'region', 'province'], zoom: 7 },
    { keys: ['state_district', 'district'], zoom: 9 },
    { keys: ['county'], zoom: 10 },
    { keys: ['municipality'], zoom: 11 }
];
const SETTLEMENT_LEVELS = [
    { keys: ['city', 'town', 'village', 'hamlet'], zoom: 12 },
    { keys: ['city_district', 'borough'], zoom: 13 },
    { keys: ['suburb'], zoom: 14 },
    { keys: ['hamlet'], zoom: 15 }
];
const HIDDEN_KEYS = new Set(['country_code', 'postcode']);
const DETAIL_ZOOM = 16;
// Below the settlement line, on the details line after the street - the
// neighbourhood, then the quarter it is in.
const LOCALITY_KEYS = ['neighbourhood', 'quarter'];
const LOCALITY_ZOOM = 15;
const HOUSE_ZOOM = 18;
const OSM_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg';
const OWN_KEYS = new Set(['house_number', 'house_name']);
// Street-level parts: what to call their level, and their icon.
const STREET_PARTS = {
    house_number: { label: 'house number', icon: 'hash' },
    house_name: { label: 'house name', icon: 'house' },
    road: { label: 'street', icon: 'signpost-2' },
    postcode: { label: 'postcode', icon: 'envelope' }
};
const PATH_TYPES = new Set(['footway', 'path', 'cycleway', 'bridleway', 'steps', 'pedestrian']);

// One part per level, each key used once (a hamlet is the settlement itself
// only when there is no city, town or village above it).
function chain(address, levels, taken) {
    const parts = [];
    levels.forEach(level => {
        const key = level.keys.find(k => address[k] && !taken.has(k));
        if (!key) return;
        taken.add(key);
        parts.push({ key, value: address[key], zoom: level.zoom });
    });
    return parts;
}

// The matched object when it has no name of its own: Nominatim then leaves
// it out of `address`, so a zoomed-in view would show no street at all.
function unnamedPart(place, address) {
    if (!place || place.name || place.category !== 'highway' || address.road) return null;
    const value = place.type === 'track' ? 'Unnamed track' : PATH_TYPES.has(place.type) ? 'Unnamed path' : 'Unnamed road';
    return { key: 'road', value, zoom: DETAIL_ZOOM, unnamed: true, osm: { osmType: place.osmType, osmId: place.osmId } };
}

/**
 * @param {Object|null} address - Nominatim `address`
 * @param {Object|null} place - the matched object {osmType, osmId, name, category, type}
 * @returns {{crumbs: Array<Part>, settlement: Array<Part>, details: Array<Part>, postcode: Part|null}}
 *   with Part = {key, value, zoom, query, rank}, each list broad to specific.
 *   `crumbs` is the region, `settlement` the settlement. Each part's `query` names it with its
 *   parents ("Panaji, Goa, India"), so a forward geocode finds that place
 *   rather than a namesake elsewhere. `rank` grows from the country inwards:
 *   the postcode sits just inside the settlement, and the other parts
 *   (listed most specific first, as Nominatim gives them) inside that.
 */
export function splitAddress(address, place = null) {
    if (!address) return { crumbs: [], settlement: [], details: [], postcode: null };
    const taken = new Set();
    const crumbs = chain(address, REGION_LEVELS, taken);
    const settlement = chain(address, SETTLEMENT_LEVELS, taken);
    const path = [];
    [...crumbs, ...settlement].forEach(part => {
        if (path.some(p => p.value === part.value)) {
            part.duplicate = true;
            return;
        }
        part.query = [part.value, ...path.map(p => p.value).reverse()].join(', ');
        part.rank = path.length;
        path.push(part);
    });
    const region = crumbs.filter(p => !p.duplicate);
    const local = settlement.filter(p => !p.duplicate);
    const pathValues = new Set(path.map(p => p.value));
    const within = path.map(p => p.value).reverse();
    const details = Object.entries(address)
        .filter(([key, value]) => value && !taken.has(key) && !HIDDEN_KEYS.has(key) && !key.startsWith('ISO3166') && !pathValues.has(value))
        .filter(([, value], i, all) => all.findIndex(([, v]) => v === value) === i)
        .map(([key, value]) => ({ key, value, zoom: DETAIL_ZOOM, query: [value, ...within].join(', ') }));
    // A house number has no OSM object of its own and no forward geocode finds
    // it; it is the address of the matched object, so it goes there.
    if (place?.osmType && place.osmId) {
        details.filter(part => OWN_KEYS.has(part.key)).forEach(part => {
            part.osm = { osmType: place.osmType, osmId: place.osmId };
            part.zoom = HOUSE_ZOOM;
        });
    }
    // The matched object's own name is filed under its kind of place
    // ("place": "Heritage Floresta" for a place=house); name it by its type.
    details.forEach(part => {
        if (!place?.name || part.value !== place.name || STREET_PARTS[part.key]) return;
        const house = place.type === 'house' || place.category === 'building';
        part.label = house ? 'house name' : String(place.type || part.key).replace(/_/g, ' ');
        if (house) part.icon = 'house';
    });
    const unnamed = unnamedPart(place, address);
    if (unnamed) details.unshift(unnamed);
    LOCALITY_KEYS.forEach(key => {
        const index = details.findIndex(part => part.key === key);
        if (index < 0) return;
        const [part] = details.splice(index, 1);
        part.zoom = LOCALITY_ZOOM;
        details.push(part);
    });
    details.forEach((part, j) => { part.rank = path.length + details.length - j; });
    const postcode = address.postcode
        ? {
            key: 'postcode',
            value: address.postcode,
            zoom: 13,
            query: [address.postcode, address.country].filter(Boolean).join(', '),
            rank: (local.length ? local[0].rank : region.length) + 0.5
        }
        : null;
    return { crumbs: region, settlement: local, details, postcode };
}

/**
 * The part the current view is at: the most specific one whose level the
 * map zoom has reached (the postcode is not a level), else the broadest.
 */
export function activePart(parts, zoom) {
    const levels = parts.filter(part => part.key !== 'postcode').sort((a, b) => a.rank - b.rank);
    return levels.filter(part => part.zoom <= zoom + 0.5).pop() || levels[0] || null;
}

/**
 * The point on a (Multi)LineString nearest to `[lng, lat]`, or null for any
 * other geometry. Planar, with longitude scaled to the latitude - plenty for
 * the length of a street.
 */
export function nearestOnLine(geojson, [lng, lat]) {
    const lines = geojson?.type === 'LineString' ? [geojson.coordinates]
        : geojson?.type === 'MultiLineString' ? geojson.coordinates : null;
    if (!lines) return null;
    const k = Math.cos(lat * Math.PI / 180);
    let best = null;
    let bestDistance = Infinity;
    lines.forEach(line => line.slice(1).forEach(([x2, y2], i) => {
        const [x1, y1] = line[i];
        const dx = (x2 - x1) * k;
        const dy = y2 - y1;
        const length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, (((lng - x1) * k) * dx + (lat - y1) * dy) / length)) : 0;
        const point = [x1 + (x2 - x1) * t, y1 + dy * t];
        const distance = ((point[0] - lng) * k) ** 2 + (point[1] - lat) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = point;
        }
    }));
    return best;
}

// The OSM address key a part came from, e.g. "state district"
function levelName(part) {
    return part.label || STREET_PARTS[part.key]?.label || part.key.replace(/_/g, ' ');
}

function partElement(part, handlers) {
    const wrap = document.createElement('span');
    wrap.className = `place-part${part.unnamed ? ' is-unnamed' : ''}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-part-btn';
    button.textContent = part.value;
    const street = STREET_PARTS[part.key];
    part.title = `View ${levelName(part)} center: ${part.value}`;
    const icon = part.icon || street?.icon;
    if (icon) {
        const iconEl = document.createElement('sl-icon');
        iconEl.className = 'place-part-icon';
        iconEl.setAttribute('name', icon);
        iconEl.setAttribute('aria-hidden', 'true');
        button.prepend(iconEl);
    }
    button.title = part.title;
    button.addEventListener('mouseenter', () => handlers.onPreview?.(part));
    button.addEventListener('mouseleave', () => handlers.onClearPreview?.());
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onPick?.(part);
    });
    wrap.appendChild(button);
    part.el = wrap;
    return wrap;
}

/**
 * @param {Object|null} address - Nominatim `address`
 * @param {string|null} locationName - shown when there is no `address`
 * @param {{onPick, onPreview, onClearPreview}} handlers - called with a part
 * @param {Object|null} place - the matched object (see splitAddress)
 * @returns {{el: HTMLElement, parts: Array}} - `parts` take OSM links later (linkOsmObjects)
 */
export function buildAddressBlock(address, locationName, handlers = {}, place = null) {
    const el = document.createElement('div');
    el.className = 'place-address';

    const { crumbs, settlement, details, postcode } = splitAddress(address, place);
    if (!crumbs.length && !settlement.length && !details.length && !postcode) {
        const fallback = document.createElement('div');
        fallback.className = 'place-detail';
        fallback.textContent = locationName || 'Address unavailable';
        el.appendChild(fallback);
        return { el, parts: [] };
    }

    // Three compartments, street first, each most specific first.
    const locality = [
        ...details.filter(part => LOCALITY_KEYS.includes(part.key)),
        ...[...settlement].reverse()
    ];
    const street = details.filter(part => !LOCALITY_KEYS.includes(part.key));
    [
        ['Street', [...street, ...(postcode ? [postcode] : [])]],
        ['Locality', locality],
        ['Administrative', [...crumbs].reverse()]
    ].forEach(([title, parts]) => {
        if (!parts.length) return;
        const compartment = document.createElement('section');
        compartment.className = 'place-compartment';
        compartment.dataset.compartment = title.toLowerCase();
        compartment.setAttribute('aria-label', title);
        const heading = document.createElement('div');
        heading.className = 'place-compartment-title';
        heading.textContent = title;
        compartment.appendChild(heading);
        parts.forEach(part => {
            const row = document.createElement('div');
            row.className = 'place-level';
            row.dataset.key = part.key;
            const name = document.createElement('span');
            name.className = 'place-level-name';
            name.textContent = levelName(part);
            const value = document.createElement('span');
            value.className = 'place-level-value';
            value.appendChild(partElement(part, handlers));
            row.append(name, value);
            compartment.appendChild(row);
        });
        el.appendChild(compartment);
    });
    return { el, parts: [...crumbs, ...settlement, ...details, ...(postcode ? [postcode] : [])] };
}

/**
 * Gives each part the OSM object Nominatim's details list names it with
 * (fetchNominatimAddressParts), and an OSM icon that opens it with `onOpen`
 * (the OSM data explorer, js/location-osm.js) - or, with a modifier key, on
 * openstreetmap.org. Parts without one (often the postcode) stay plain.
 */
export function linkOsmObjects(parts, osmParts, onOpen = null) {
    const byName = new Map();
    (osmParts || []).forEach(p => {
        if (p.osmType && p.osmId && !byName.has(p.name)) byName.set(p.name, p);
    });
    parts.forEach(part => {
        const osm = part.osm || byName.get(part.value);
        const url = osm && osmObjectUrl(osm.osmType, osm.osmId);
        if (!url || !part.el || part.el.querySelector('.place-osm-link')) return;
        part.osm = { osmType: osm.osmType, osmId: osm.osmId };
        const link = document.createElement('a');
        link.className = 'place-osm-link';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = `Explore ${part.value} in OpenStreetMap data`;
        link.setAttribute('aria-label', link.title);
        const img = document.createElement('img');
        img.src = OSM_LOGO;
        img.alt = '';
        link.appendChild(img);
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            onOpen(part);
        });
        part.el.appendChild(link);
    });
}
