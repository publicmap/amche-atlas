/**
 * Mapbox GL style-spec property tables.
 *
 * A layer config carries a single flat `style` object that mixes the paint and
 * layout properties of every map layer type it paints — one geojson layer can
 * draw fill, line, circle and symbol passes out of the same object. These
 * tables say which property belongs to which map layer type, and whether it is
 * a paint or a layout property.
 *
 * Shared by js/mapbox-api.js (which splits a style for setPaintProperty /
 * setLayoutProperty when the layer is rendered) and js/style-property-editor.js
 * (which renders one input control per property). Kept in its own module so the
 * editor can read the spec without pulling in the whole renderer.
 */

export const STYLE_PROPERTY_MAPPING = {
    layout: {
        common: ['visibility'],
        fill: ['fill-sort-key'],
        line: ['line-cap', 'line-join', 'line-miter-limit', 'line-round-limit', 'line-sort-key'],
        symbol: ['icon-allow-overlap', 'icon-anchor', 'icon-image', 'icon-size', 'icon-rotate', 'text-field', 'text-font', 'text-size', 'text-anchor', 'text-line-height', 'text-max-width', 'text-letter-spacing', 'text-justify', 'text-allow-overlap', 'text-transform', 'text-offset', 'text-rotation-alignment', 'text-pitch-alignment', 'text-writing-mode', 'text-variable-anchor', 'text-radial-offset', 'text-keep-upright', 'text-padding', 'symbol-placement', 'symbol-spacing', 'symbol-avoid-edges', 'icon-rotation-alignment', 'icon-pitch-alignment', 'icon-keep-upright'],
        circle: ['circle-sort-key'],
        raster: [],
        background: [],
        hillshade: []
    },
    paint: {
        fill: ['fill-color', 'fill-opacity', 'fill-outline-color', 'fill-translate'],
        'fill-extrusion': ['fill-extrusion-opacity', 'fill-extrusion-color', 'fill-extrusion-translate', 'fill-extrusion-height', 'fill-extrusion-base', 'fill-extrusion-vertical-gradient'],
        line: ['line-color', 'line-width', 'line-opacity', 'line-dasharray', 'line-translate', 'line-offset'],
        symbol: ['icon-color', 'icon-opacity', 'text-color', 'text-halo-color', 'text-halo-width', 'text-halo-blur', 'text-opacity'],
        circle: ['circle-radius', 'circle-color', 'circle-opacity', 'circle-stroke-width', 'circle-stroke-color'],
        raster: ['raster-opacity', 'raster-contrast', 'raster-saturation', 'raster-brightness-min', 'raster-brightness-max'],
        background: ['background-color', 'background-opacity'],
        hillshade: ['hillshade-exaggeration', 'hillshade-highlight-color', 'hillshade-shadow-color']
    }
};

/**
 * Name patterns that mark a property as layout when it isn't in the tables
 * above — a newer spec property, or one the tables don't list yet. Everything
 * else is treated as paint, which is where most properties live.
 */
const LAYOUT_NAME_PATTERNS = [
    '-sort-key', '-placement', '-anchor', '-field', '-font', '-size', '-image',
    '-cap', '-join', '-allow-overlap', '-keep-upright', '-writing-mode',
    '-transform', '-offset', '-alignment', '-justify', '-line-height',
    '-max-width', '-variable-anchor', '-radial-offset', '-padding'
];

/**
 * Which Mapbox GL layer types a layer config of each amche type can paint.
 * Vector-ish sources render up to five passes out of one style object; raster
 * sources only ever render a raster layer.
 */
const VECTOR_MAP_LAYER_TYPES = ['fill', 'line', 'circle', 'symbol', 'fill-extrusion'];

const CONFIG_TYPE_MAP_LAYER_TYPES = {
    vector: VECTOR_MAP_LAYER_TYPES,
    geojson: VECTOR_MAP_LAYER_TYPES,
    csv: VECTOR_MAP_LAYER_TYPES,
    overpass: VECTOR_MAP_LAYER_TYPES,
    js: VECTOR_MAP_LAYER_TYPES,
    style: [...VECTOR_MAP_LAYER_TYPES, 'raster', 'background', 'hillshade'],
    'layer-group': [...VECTOR_MAP_LAYER_TYPES, 'raster', 'background', 'hillshade'],
    tms: ['raster'],
    wmts: ['raster'],
    wms: ['raster'],
    cog: ['raster'],
    img: ['raster'],
    'raster-style-layer': ['raster']
};

/**
 * Map layer types whose spec properties are offered for a config's style.
 * Unknown config types fall back to the vector passes.
 */
export function getMapLayerTypes(configType) {
    return CONFIG_TYPE_MAP_LAYER_TYPES[configType] || VECTOR_MAP_LAYER_TYPES;
}

/**
 * Whether a property is paint or layout, from the tables alone.
 * Returns null for a property the tables don't list.
 */
export function lookupPropertyKind(property) {
    for (const kind of ['layout', 'paint']) {
        for (const properties of Object.values(STYLE_PROPERTY_MAPPING[kind])) {
            if (properties.includes(property)) return kind;
        }
    }
    return null;
}

/**
 * Whether a property is paint or layout, falling back to the name patterns for
 * properties the tables don't list. Always answers with one of the two.
 */
export function guessPropertyKind(property) {
    const known = lookupPropertyKind(property);
    if (known) return known;
    if (property === 'visibility') return 'layout';
    return LAYOUT_NAME_PATTERNS.some(pattern => property.includes(pattern)) ? 'layout' : 'paint';
}

/**
 * Every spec property a config of this type can carry, as
 * [{ property, kind }] sorted by kind then name.
 */
export function getSpecProperties(configType) {
    const kinds = new Map();

    const collect = (kind, properties) => (properties || []).forEach(property => {
        if (!kinds.has(property)) kinds.set(property, kind);
    });

    collect('layout', STYLE_PROPERTY_MAPPING.layout.common);
    getMapLayerTypes(configType).forEach(layerType => {
        collect('paint', STYLE_PROPERTY_MAPPING.paint[layerType]);
        collect('layout', STYLE_PROPERTY_MAPPING.layout[layerType]);
    });

    return [...kinds.entries()]
        .map(([property, kind]) => ({ property, kind }))
        .sort((a, b) => (a.kind === b.kind ? a.property.localeCompare(b.property) : a.kind.localeCompare(b.kind)));
}
