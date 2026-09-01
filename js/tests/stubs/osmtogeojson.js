/**
 * Test stub for the osmtogeojson CDN module that js/overpass-loader.js imports.
 *
 * The Node test runner cannot resolve https: imports, so vite.config.mjs aliases
 * the CDN URL here. Tests that actually exercise Overpass conversion should mock
 * this with their own implementation.
 */
export default function osmtogeojson() {
    return { type: 'FeatureCollection', features: [] };
}
