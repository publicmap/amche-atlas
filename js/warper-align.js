const WARPER_LINK = /https?:\/\/(mapwarper\.net|warper\.wmflabs\.org)\/(maps|layers|mosaics)\/(?:tile\/|wms\/)?(\d+)/;

export function warperPageUrl(text) {
    const match = typeof text === 'string' ? text.match(WARPER_LINK) : null;
    if (!match) return null;
    const [, host, kind, id] = match;
    return `https://${host}/${kind === 'maps' ? 'maps' : 'layers'}/${id}`;
}

export function warperAlignUrl(pageUrl, map) {
    const target = new URL('warper/', window.location.href);
    target.searchParams.set('map', pageUrl);
    if (map) {
        const center = map.getCenter();
        target.hash = `${map.getZoom().toFixed(2)}/${center.lat.toFixed(5)}/${center.lng.toFixed(5)}`;
    }
    return target.href;
}

export function alignIconHTML(pageUrl, map) {
    const href = warperAlignUrl(pageUrl, map).replace(/"/g, '&quot;');
    const page = pageUrl.replace(/"/g, '&quot;');
    return `<sl-tooltip content="Align"><a class="warper-align-link" href="${href}" data-warper-map="${page}" target="_blank" rel="noopener noreferrer" aria-label="Align" style="display:inline-flex;vertical-align:-0.125em;text-decoration:none"><sl-icon name="arrows-move"></sl-icon></a></sl-tooltip>`;
}

export function addAlignLinks(container, map) {
    const seen = new Set();
    container.querySelectorAll('a[href]').forEach(link => {
        if (link.classList.contains('warper-align-link')) return;
        const pageUrl = warperPageUrl(link.getAttribute('href'));
        if (!pageUrl || seen.has(pageUrl)) return;
        seen.add(pageUrl);
        link.insertAdjacentHTML('afterend', ' ' + alignIconHTML(pageUrl, map));
    });
    return seen.size > 0;
}

export function refreshAlignLink(event, map) {
    const link = event.target.closest('.warper-align-link');
    if (!link) return false;
    link.href = warperAlignUrl(link.dataset.warperMap, map);
    return true;
}
