/**
 * Site brand
 *
 * An atlas config's `site` block (see docs/guides/embed-osm-india) rebrands
 * the app for a community running or embedding its own instance: `site.brand`
 * (logo, name) replaces amche.in on the splash card, on the main menu's hero
 * header and on the menu button above the console, and `site.actions` /
 * `site.menu` / `site.footer` become links at the top of the main menu.
 *
 * "The site" is the page the visitor is actually on - the embedding page when
 * the atlas is framed (js/embed-host.js), this page otherwise - and decides
 * which projects the splash lists (js/splash-screen-manager.js).
 */
import { embedHostHref } from './embed-host.js';

const AMCHE_HOSTS = ['amche.in', 'www.amche.in'];

let current = null;

export function siteHref() {
    return embedHostHref() || window.location.href;
}

export function isAmcheSite(href = siteHref()) {
    try {
        return AMCHE_HOSTS.includes(new URL(href).hostname);
    } catch (error) {
        return false;
    }
}

function siteKey(href) {
    const url = new URL(href, window.location.href);
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/index\.html$/, '').replace(/\/+$/, '');
}

/** Whether `href` is the site the visitor is on, or a page within it. */
export function isCurrentSite(href, site = siteHref()) {
    try {
        const project = siteKey(href);
        const here = siteKey(site);
        return here === project || here.startsWith(project + '/');
    } catch (error) {
        return false;
    }
}

export function siteBrand() {
    return current?.brand || null;
}

function safeHref(href) {
    if (typeof href !== 'string') return null;
    try {
        const url = new URL(href, window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? href : null;
    } catch (error) {
        return null;
    }
}

function fillView(href) {
    const map = window.map;
    if (!map?.getCenter) return href;
    const { lat, lng } = map.getCenter();
    return href
        .replace('{zoom}', map.getZoom().toFixed(2))
        .replace('{lat}', lat.toFixed(5))
        .replace('{lng}', lng.toFixed(5));
}

function siteLink(item, className) {
    const href = safeHref(item?.href);
    if (!href || !item.label) return null;
    const link = document.createElement('a');
    link.className = className;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.append(Object.assign(document.createElement('span'), { className: 'nav-site-label', textContent: item.label }));
    if (item.note) link.append(Object.assign(document.createElement('span'), { className: 'nav-site-note', textContent: item.note }));
    if (href.includes('{')) {
        const fill = () => { link.href = fillView(href); };
        link.addEventListener('pointerdown', fill);
        link.addEventListener('focus', fill);
    }
    return link;
}

function renderSiteMenu(site) {
    const slot = document.getElementById('nav-menu-site-slot');
    if (!slot) return;
    slot.replaceChildren();
    const actions = (site.actions || []).map(item => siteLink(item, 'nav-site-action')).filter(Boolean);
    if (actions.length) {
        const row = Object.assign(document.createElement('div'), { className: 'nav-site-actions' });
        row.append(...actions);
        slot.append(row);
    }
    (site.menu || []).forEach(section => {
        const items = (section.items || []).map(item => siteLink(item, 'nav-site-item')).filter(Boolean);
        if (!items.length) return;
        const block = Object.assign(document.createElement('section'), { className: 'nav-site-section' });
        block.append(Object.assign(document.createElement('div'), { className: 'nav-site-heading', textContent: section.title || '' }), ...items);
        slot.append(block);
    });
    const footer = (site.footer || []).map(item => siteLink(item, 'nav-site-foot')).filter(Boolean);
    if (footer.length) {
        const row = Object.assign(document.createElement('div'), { className: 'nav-site-foot-links' });
        row.append(...footer);
        slot.append(row);
    }
}

function applyLogo(img, brand) {
    if (!img || !brand.logo) return;
    img.src = brand.logo;
    img.alt = brand.name || '';
    img.style.borderRadius = '0';
    img.style.objectFit = 'contain';
}

/** Applies brand to the console's menu button, wherever it is drawn. */
export function applyConsoleBrand(home = document.querySelector('.console-home')) {
    const brand = siteBrand();
    if (!home || !brand) return;
    applyLogo(home.querySelector('img'), brand);
    const name = home.querySelector('.console-home-name');
    if (name && brand.name) name.textContent = brand.name;
    if (brand.name) {
        home.title = `${brand.name} menu`;
        home.setAttribute('aria-label', home.title);
    }
}

function applyHeroBrand(brand) {
    const hero = document.getElementById('nav-menu-hero');
    if (!hero) return;
    applyLogo(hero.querySelector('.nav-menu-logo'), brand);
    const name = hero.querySelector('.splash-brand-link');
    if (name && brand.name) {
        name.textContent = brand.name;
        hero.querySelector('.splash-meaning')?.style.setProperty('display', 'none');
    }
}

/** `site` is an atlas config's `site` block with `brand.logo` already resolved. */
export function setSite(site) {
    if (!site?.brand) return;
    current = site;
    applyConsoleBrand();
    applyHeroBrand(site.brand);
    renderSiteMenu(site);
    if (site.brand.name) document.title = site.brand.name;
}
