/**
 * OpenStreetMap in the place menu (js/map-location-menu-control.js): the
 * credit under the address, and the OSM data explorer each address part's
 * OSM icon opens (js/location-address.js) - the object's OSM data in one tab,
 * and in the other where the address comes from and how to fix it on OSM,
 * with links to the spot on openstreetmap.org, the editor, a note, the wiki
 * and the local community.
 */
import { osmObjectUrl } from './nominatim-search.js';
import { buildTabs } from './location-tabs.js';

const OSM_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg';
const DIALOG_ID = 'place-osm-dialog';
const NOMINATIM_DETAILS_UI = 'https://nominatim.openstreetmap.org/ui/details.html';
const OSM_TYPE_WORDS = { N: 'node', W: 'way', R: 'relation' };

/** The links for a map view: {lat, lng, zoom}, the matched place, and the country name. */
export function osmContextLinks({ lat, lng, zoom }, place = null, country = null) {
    const z = Math.round(zoom);
    const la = lat.toFixed(5);
    const ln = lng.toFixed(5);
    const object = place && osmObjectUrl(place.osmType, place.osmId);
    return [
        {
            icon: 'box-arrow-up-right',
            label: place?.name ? `${place.name} on OpenStreetMap` : 'This place on OpenStreetMap',
            href: object || `https://www.openstreetmap.org/search?lat=${la}&lon=${ln}&zoom=${z}`
        },
        { icon: 'pencil', label: 'Edit the map here', href: `https://www.openstreetmap.org/edit#map=${Math.max(z, 16)}/${la}/${ln}` },
        {
            icon: 'question-circle',
            label: country ? `Help · mapping ${country} on the OSM Wiki` : 'Help · OSM Wiki',
            href: country
                ? `https://wiki.openstreetmap.org/w/index.php?search=${encodeURIComponent(country)}`
                : 'https://wiki.openstreetmap.org/wiki/Beginners%27_guide'
        },
        { icon: 'people', label: 'OSM community near here', href: `https://openstreetmap.community/?map=${la},${ln}&zoom=${zoom.toFixed(2)}` }
    ];
}

function linkRow({ icon, label, href }) {
    const link = document.createElement('a');
    link.className = 'place-row';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const iconEl = document.createElement('sl-icon');
    iconEl.setAttribute('name', icon);
    const span = document.createElement('span');
    span.textContent = label;
    link.append(iconEl, span);
    return link;
}

function block(tag, className, html) {
    const el = document.createElement(tag);
    el.className = className;
    el.innerHTML = html;
    return el;
}

function helpPanel(view, object, country) {
    const z = Math.max(Math.round(view.zoom), 16);
    const [first, edit, ...help] = osmContextLinks(view, object, country);
    const links = document.createElement('div');
    links.className = 'place-fix-links';
    [
        first,
        edit,
        { icon: 'chat-square-text', label: 'Leave a note for local mappers', href: `https://www.openstreetmap.org/note/new#map=${z}/${view.lat.toFixed(5)}/${view.lng.toFixed(5)}` },
        { icon: 'signpost-2', label: 'How addresses are mapped', href: 'https://wiki.openstreetmap.org/wiki/Addresses' },
        ...help
    ].forEach(item => links.appendChild(linkRow(item)));

    const section = (title, ...children) => {
        const el = document.createElement('section');
        el.className = 'place-fix-section';
        const label = document.createElement('div');
        label.className = 'place-fix-label';
        label.textContent = title;
        el.append(label, ...children);
        return el;
    };
    const licence = document.createElement('a');
    licence.className = 'place-osm-licence';
    licence.href = 'https://www.openstreetmap.org/copyright';
    licence.target = '_blank';
    licence.rel = 'noopener noreferrer';
    licence.textContent = '© OpenStreetMap contributors · Open Database License (ODbL)';
    return [
        section('Where it comes from',
            block('p', 'place-fix-text', 'This address comes from <strong>OpenStreetMap</strong> (OSM), the free map of the world made by volunteers. For the centre of the map, OSM\'s search engine <strong>Nominatim</strong> finds the nearest mapped place and the street, locality and administrative areas it lies in. A wrong or missing part means the map data there is wrong or missing.')),
        section('How to fix it',
            block('ol', 'place-fix-steps', [
                'Open the place on OpenStreetMap and look at its tags, such as <code>name</code>, <code>addr:housenumber</code> and <code>addr:street</code>.',
                'Sign in with a free account and edit the map here: add or correct the house number, the street\'s name, or the place it is in.',
                'Save with a short comment. The address here follows once Nominatim has picked up the change, usually within the hour.'
            ].map(step => `<li>${step}</li>`).join('')),
            block('p', 'place-fix-text place-fix-aside', 'Not sure how? Leave a note on the map and a local mapper can fix it.')),
        section('Resources', links, licence)
    ];
}

function externalLink(label, href, title) {
    const link = document.createElement('a');
    link.className = 'place-data-action';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = title;
    const text = document.createElement('span');
    text.textContent = label;
    const icon = document.createElement('sl-icon');
    icon.setAttribute('name', 'box-arrow-up-right');
    link.append(text, icon);
    return link;
}

/**
 * The OSM data explorer for one address part's object, nearly full screen:
 * the place menu's header (tabs, then the object and its actions), then the
 * object's OSM data or a Help tab on where the address comes from and how to
 * fix it. openstreetmap.org refuses to be framed (frame-ancestors 'self');
 * Nominatim's details page, which shows the object's OSM data, does not.
 *
 * @param {{view, country}} context - the map view and the country name
 * @param {{osmType, osmId, name}} object
 */
export function showOsmDialog({ view, country }, object) {
    document.getElementById(DIALOG_ID)?.remove();
    const type = OSM_TYPE_WORDS[object.osmType] || String(object.osmType).toLowerCase();
    const name = object.name || 'OSM object';
    const dialog = document.createElement('sl-dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'place-fix-dialog';
    dialog.label = `${name} - OpenStreetMap data`;
    dialog.setAttribute('no-header', '');

    const header = document.createElement('div');
    header.className = 'place-data-header';
    dialog.appendChild(header);
    const panels = buildTabs(dialog, [
        { id: 'osm-data', label: 'OSM data', icon: 'database' },
        { id: 'osm-help', label: 'Help', icon: 'question-circle' }
    ], 'osm-data', () => {}, header);

    const title = document.createElement('div');
    title.className = 'place-data-title';
    const titleName = document.createElement('span');
    titleName.className = 'place-data-name';
    titleName.textContent = name;
    const titleId = document.createElement('span');
    titleId.className = 'place-data-id';
    titleId.textContent = `${type} ${object.osmId}`;
    title.append(titleName, titleId);

    const actions = document.createElement('div');
    actions.className = 'place-data-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'place-data-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<sl-icon name="x-lg"></sl-icon>';
    close.addEventListener('click', () => dialog.hide());
    actions.append(
        externalLink('OpenStreetMap', osmObjectUrl(object.osmType, object.osmId), `${name} on openstreetmap.org`),
        externalLink('Edit', `https://www.openstreetmap.org/edit?${type}=${object.osmId}`, `Edit ${name} on OpenStreetMap`),
        close
    );
    header.append(title, actions);

    const frame = document.createElement('iframe');
    frame.className = 'place-data-frame';
    frame.title = dialog.label;
    frame.src = `${NOMINATIM_DETAILS_UI}?osmtype=${type[0].toUpperCase()}&osmid=${encodeURIComponent(object.osmId)}`;
    panels['osm-data'].append(frame);
    const help = document.createElement('div');
    help.className = 'place-fix-help';
    help.append(...helpPanel(view, object, country));
    panels['osm-help'].append(help);

    dialog.addEventListener('sl-after-hide', (e) => { if (e.target === dialog) dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.show();
    return dialog;
}

/** The OpenStreetMap credit for the address. */
export function buildOsmFooter() {
    const footer = document.createElement('div');
    footer.className = 'place-osm';

    const credit = document.createElement('a');
    credit.className = 'place-osm-credit';
    credit.href = 'https://www.openstreetmap.org/copyright';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    const logo = document.createElement('img');
    logo.src = OSM_LOGO;
    logo.alt = '';
    const text = document.createElement('span');
    text.textContent = '© OpenStreetMap contributors';
    credit.append(logo, text);

    footer.append(credit);
    return footer;
}
