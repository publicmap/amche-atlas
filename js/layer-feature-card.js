/**
 * The feature the layer editor (map-creator.html) was opened on - a feature
 * picked in Find (js/console/find-panel.js) or a marker's chip: its name and
 * every attribute, the same card a marker shows (MapMarkerManager's
 * _buildFeatureRowsHTML, in the map's window).
 */
const markerManager = () => window.parent?.featureControl?._markerManager || null;

export function renderFeatureCard(layerId, feature) {
    const card = document.getElementById('feature-card');
    if (!card) return;
    card.replaceChildren();
    const manager = markerManager();
    card.style.display = feature && manager ? '' : 'none';
    if (!feature || !manager) return;

    const f = { layerId: feature.layerId || layerId, feature, featureId: feature.id };
    const head = document.createElement('div');
    head.className = 'feature-card-head';
    const kicker = document.createElement('div');
    kicker.className = 'feature-card-kicker';
    kicker.textContent = 'Feature';
    const title = document.createElement('div');
    title.className = 'feature-card-title';
    title.textContent = String(manager._getBadgeLabelInfo(f).value ?? feature.id ?? '');
    head.append(kicker, title);

    const body = document.createElement('div');
    body.className = 'feature-card-body';
    body.innerHTML = manager._buildFeatureRowsHTML(f);
    card.append(head, body);

    const showAll = body.querySelector('.badge-show-all-props-btn');
    showAll?.addEventListener('click', () => {
        const shown = body.querySelector('.badge-shown-properties');
        const all = body.querySelector('.badge-all-properties');
        const showingAll = all.style.display !== 'none';
        all.style.display = showingAll ? 'none' : 'block';
        if (shown) shown.style.display = showingAll ? 'block' : 'none';
        showAll.textContent = showingAll ? `Show all ${showAll.dataset.total} properties` : 'Show less';
    });
}
