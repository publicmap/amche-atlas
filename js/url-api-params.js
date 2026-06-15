/**
 * Canonical list of URL API parameter names.
 *
 * This is the single source of truth for the URL API surface. The debug log in
 * `url-manager.js` (`applyURLParameters`) is built from this list, and
 * `js/tests/url-api-docs.test.js` asserts it stays in sync with the
 * "## Parameters" section of `docs/API.md` — so adding/removing a parameter in
 * one place without the other fails the test.
 *
 * When you add a parameter here, document it with a `### \`name\`` section in
 * docs/API.md (and vice versa).
 */
export const URL_API_PARAMS = [
    'atlas',
    'layers',
    'selected',
    'markers',
    'geolocate',
    'q',
    'compare',
    'terrain',
    'animate',
    'fog',
    'wireframe',
    'terrainSource',
    'fov',
    'bearing',
    'pitch',
    'sound',
    'export',
    'zoomTo'
];
