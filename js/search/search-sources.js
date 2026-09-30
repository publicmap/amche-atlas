const STORAGE_KEY = 'searchSources';

export const SEARCH_SOURCES = [
    { id: 'layers', label: 'Maps & layers' },
    { id: 'features', label: 'Features in view' },
    { id: 'markers', label: 'Markers' },
    { id: 'countries', label: 'Countries' },
    { id: 'places', label: 'Places (Mapbox)' },
    { id: 'nominatim', label: 'Places (OpenStreetMap)' },
    { id: 'cadastral', label: 'Survey numbers' },
    { id: 'directions', label: 'Directions' }
];

function load() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
        return new Set();
    }
}

const disabled = load();

export function isSearchSourceEnabled(id) {
    return !disabled.has(id);
}

export function setSearchSourceEnabled(id, enabled) {
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...disabled]));
    } catch {}
    window.dispatchEvent(new CustomEvent('searchSourcesChanged', { detail: { id, enabled } }));
}
