/**
 * ============================================================================
 * ConfigManager - Central Configuration Specification for Map Layers
 * ============================================================================
 *
 * ⚠️  IMPORTANT: This is the SINGLE SOURCE OF TRUTH for all layer schemas
 * ⚠️  ALL configuration changes MUST start here and be documented below
 *
 * FILE STRUCTURE:
 * ---------------
 * 1. Documentation (THIS SECTION)
 * 2. LAYER_TYPES constants (line 110+)
 * 3. LAYER_SPECIFICATIONS definitions (line 115+)
 * 4. ConfigManager class with utility methods (line 485+)
 * 5. Implementation guide and best practices (line 665+)
 *
 * This is the SINGLE SOURCE OF TRUTH for all layer configuration schemas.
 * ALL schema changes MUST be managed here and documented below.
 *
 * OVERVIEW:
 * ---------
 * This file defines all supported layer types (style, vector, geojson, tms, etc.)
 * and their configuration schemas. Used by MapLayerControl and MapboxAPI for
 * rendering different layer types.
 *
 * HOW TO ADD A NEW LAYER TYPE:
 * -----------------------------
 * 1. Add the new type constant to LAYER_TYPES object below (line 8+)
 *    Example: MY_TYPE: 'my-type'
 *
 * 2. Add the full specification to LAYER_SPECIFICATIONS object (line 21+)
 *    - name: Human-readable name for the layer type
 *    - description: Brief description of what this layer type does
 *    - required: Array of required configuration fields
 *    - optional: Array of optional configuration fields
 *    - requiredOneOf: (optional) Array where at least one field is required
 *    - properties: Detailed schema for each field with type, description, defaults
 *    - example: A working example configuration
 *
 * 3. Implement rendering logic in MapboxAPI (js/mapbox-api.js):
 *    - Add case in addLayer() method to handle your new type
 *    - Implement source creation (addSource)
 *    - Implement layer creation with appropriate Mapbox GL style
 *    - Handle opacity controls if needed
 *    - Add cleanup in removeLayer() method
 *
 * 4. Update Layer Creator UI (js/layer-creator-ui.js):
 *    - Add new option to type dropdown in _createLayerTypeSelect()
 *    - Add field validation for type-specific fields
 *    - Update form fields based on new type requirements
 *
 * 5. Update documentation (/docs/API.md):
 *    - Add example of new layer type with all supported fields
 *    - Document use cases and limitations
 *    - Add to table of supported layer types
 *
 * 6. Add tests (js/tests/):
 *    - Create unit tests for new layer type validation
 *    - Add integration tests for rendering behavior
 *    - Test URL parameter handling if applicable
 *
 * FILES IMPACTED BY SCHEMA CHANGES:
 * ----------------------------------
 * CORE FILES (always check these):
 * - js/config-manager.js (THIS FILE) - Update LAYER_SPECIFICATIONS
 * - js/mapbox-api.js - Implement rendering logic for new type
 * - js/layer-creator-ui.js - Update UI form for new fields
 *
 * OPTIONAL FILES (check if adding new capabilities):
 * - js/map-feature-control.js - If layer supports feature inspection
 * - js/map-layer-controls.js - If special UI controls needed
 * - js/url-manager.js - If new URL parameters needed
 * - config/_defaults.json - Add default styling for new type
 *
 * DOCUMENTATION FILES:
 * - /docs/API.md - Document new layer type and examples
 * - CLAUDE.md - Update architecture overview if significant change
 *
 * TEST FILES:
 * - js/tests/config-manager.test.js - Add validation tests
 * - js/tests/mapbox-api.test.js - Add rendering tests
 * - e2e/*.spec.js - Add end-to-end tests
 *
 * COMMON PROPERTY PATTERNS:
 * -------------------------
 * All layer types should support these standard properties:
 * - id (required): Unique layer identifier
 * - type (required): Layer type from LAYER_TYPES
 * - title (optional): Display name in UI
 * - description (optional): Layer description (supports HTML)
 * - headerImage (optional): Header image URL for layer card
 * - attribution (optional): Data attribution text
 * - initiallyChecked (optional): Whether layer is visible on load
 * - opacity (optional): Layer opacity (0-1)
 * - style (optional): Type-specific Mapbox GL style properties
 *
 * VALIDATION:
 * -----------
 * Use ConfigManager.validateLayerConfig(config) to validate any layer config.
 * This method checks required fields, known properties, and returns errors/warnings.
 *
 * EXAMPLES:
 * ---------
 * See LAYER_SPECIFICATIONS below for complete examples of each layer type.
 * Copy the example and modify for your needs - all fields are documented inline.
 *
 * QUICK REFERENCE - MOST COMMON TASKS:
 * -------------------------------------
 * 1. Add new optional field to existing layer type:
 *    → Update LAYER_SPECIFICATIONS[type].optional array (around line 110+)
 *    → Add field to LAYER_SPECIFICATIONS[type].properties object
 *    → Update example configuration
 *    → Implement handling in mapbox-api.js addLayer() method
 *    → Document in /docs/API.md
 *
 * 2. Make optional field required:
 *    → Move from 'optional' array to 'required' array in specification
 *    → Update validation tests
 *    → Update all existing configs in /config/ to include field
 *
 * 3. Change default value:
 *    → Update properties[field].default in specification
 *    → Update config/_defaults.json if style-related
 *
 * 4. Add new layer type:
 *    → See detailed guide in IMPLEMENTATION GUIDE section at bottom of file
 *    → Follow step-by-step checklist
 *
 * 5. Deprecate a field:
 *    → Move to 'optional' array with note in description
 *    → Keep handling in mapbox-api.js for backwards compatibility
 *    → Add migration guide in documentation
 *    → Plan removal for next major version
 */

export const LAYER_TYPES = {
    STYLE: 'style',
    VECTOR: 'vector',
    TMS: 'tms',
    WMTS: 'wmts',
    WMS: 'wms',
    GEOJSON: 'geojson',
    CSV: 'csv',
    IMG: 'img',
    RASTER_STYLE: 'raster-style-layer',
    LAYER_GROUP: 'layer-group'
};

export const LAYER_SPECIFICATIONS = {
    [LAYER_TYPES.STYLE]: {
        name: 'Style Layer',
        description: 'Controls visibility of layers already present in the base Mapbox style',
        required: ['id', 'type', 'layers'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'style', description: 'Layer type identifier' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            layers: {
                type: 'array',
                description: 'Array of sublayers to control',
                items: {
                    sourceLayer: { type: 'string', description: 'Source layer name from style' },
                    title: { type: 'string', description: 'Display name for sublayer' }
                }
            },
            style: { type: 'object', description: 'Paint/layout properties to apply when visible' }
        },
        example: {
            id: 'contours',
            type: 'style',
            title: 'Contour Lines',
            layers: [
                { sourceLayer: 'contour', title: 'Contours' },
                { sourceLayer: 'contour_index', title: 'Index Contours' }
            ]
        }
    },

    [LAYER_TYPES.VECTOR]: {
        name: 'Vector Tile Layer',
        description: 'Vector tiles (.pbf/.mvt) with configurable styling',
        required: ['id', 'type', 'url', 'sourceLayer'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'filter', 'inspect', 'opacity', 'maxzoom'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'vector', description: 'Layer type identifier' },
            url: { type: 'string', description: 'Vector tile URL template with {z}/{x}/{y}' },
            sourceLayer: { type: 'string', description: 'Source layer name within vector tiles' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            style: { type: 'object', description: 'Mapbox GL style properties (fill-*, line-*, circle-*, text-*)' },
            filter: { type: 'array', description: 'Mapbox GL filter expression' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity multiplier' },
            maxzoom: { type: 'number', default: 22, description: 'Maximum zoom level for tiles' },
            inspect: {
                type: 'object',
                description: 'Feature inspection configuration',
                properties: {
                    id: { type: 'string', description: 'Property to use as feature ID' },
                    title: { type: 'string', description: 'Title for popup' },
                    label: { type: 'string', description: 'Property to use as feature label' },
                    fields: { type: 'array', description: 'Properties to display in popup' }
                }
            }
        },
        example: {
            id: 'villages',
            type: 'vector',
            title: 'Village Boundaries',
            url: 'https://example.com/tiles/{z}/{x}/{y}.pbf',
            sourceLayer: 'villages',
            style: {
                'fill-color': '#f0f0f0',
                'fill-opacity': 0.5,
                'line-color': '#333',
                'line-width': 2
            },
            inspect: {
                title: 'Village Info',
                label: 'name',
                fields: ['population', 'area']
            }
        }
    },

    [LAYER_TYPES.TMS]: {
        name: 'Tile Map Service (Raster)',
        description: 'Raster tile service with XYZ or TMS tiling scheme',
        required: ['id', 'type', 'url'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'opacity', 'scheme', 'maxzoom', 'urlTimeParam', 'geojson'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'tms', description: 'Layer type identifier' },
            url: { type: 'string', description: 'Tile URL template with {z}/{x}/{y}' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            scheme: { type: 'string', enum: ['xyz', 'tms'], default: 'xyz', description: 'Tile coordinate scheme' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity' },
            maxzoom: { type: 'number', default: 22, description: 'Maximum zoom level for tiles' },
            style: { type: 'object', description: 'Raster paint properties (raster-*)' },
            urlTimeParam: { type: 'string', description: 'Time parameter template (e.g., "TIME={time}")' },
            geojson: { type: 'object', description: 'Optional GeoJSON overlay rendered with SimpleStyle spec' }
        },
        example: {
            id: 'satellite',
            type: 'tms',
            title: 'Satellite Imagery',
            url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            opacity: 0.8,
            maxzoom: 18
        }
    },

    [LAYER_TYPES.WMTS]: {
        name: 'Web Map Tile Service',
        description: 'OGC WMTS standard raster tiles',
        required: ['id', 'type', 'url'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'opacity', 'tileSize', 'maxzoom', 'forceWebMercator', 'urlTimeParam'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'wmts', description: 'Layer type identifier' },
            url: { type: 'string', description: 'WMTS GetTile URL with TileMatrix/TileRow/TileCol parameters' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            tileSize: { type: 'number', default: 256, description: 'Tile size in pixels' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity' },
            maxzoom: { type: 'number', default: 22, description: 'Maximum zoom level' },
            forceWebMercator: { type: 'boolean', description: 'Force conversion to EPSG:3857' },
            style: { type: 'object', description: 'Raster paint properties (raster-*)' },
            urlTimeParam: { type: 'string', description: 'Time parameter template (e.g., "TIME={time}")' }
        },
        example: {
            id: 'nasa-viirs',
            type: 'wmts',
            title: 'NASA VIIRS',
            url: 'https://gibs.earthdata.nasa.gov/wmts/.../TileMatrix={z}/TileRow={y}/TileCol={x}.png',
            urlTimeParam: 'TIME={time}',
            opacity: 0.9
        }
    },

    [LAYER_TYPES.WMS]: {
        name: 'Web Map Service',
        description: 'OGC WMS standard raster service',
        required: ['id', 'type', 'url'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'opacity', 'tileSize', 'srs', 'maxzoom', 'proxyUrl', 'proxyReferer', 'urlTimeParam'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'wms', description: 'Layer type identifier' },
            url: { type: 'string', description: 'WMS GetMap base URL with parameters' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            tileSize: { type: 'number', default: 256, description: 'Tile size for requests' },
            srs: { type: 'string', default: 'EPSG:3857', description: 'Spatial reference system' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity' },
            maxzoom: { type: 'number', default: 22, description: 'Maximum zoom level' },
            proxyUrl: { type: 'string', description: 'Proxy server URL for CORS' },
            proxyReferer: { type: 'string', description: 'Referer header for proxy' },
            style: { type: 'object', description: 'Raster paint properties (raster-*)' },
            urlTimeParam: { type: 'string', description: 'Time parameter template (e.g., "TIME={time}")' }
        },
        example: {
            id: 'weather-radar',
            type: 'wms',
            title: 'Weather Radar',
            url: 'https://example.com/wms?service=WMS&version=1.1.1&request=GetMap&layers=radar&styles=',
            srs: 'EPSG:3857',
            opacity: 0.7
        }
    },

    [LAYER_TYPES.GEOJSON]: {
        name: 'GeoJSON Layer',
        description: 'Vector features in GeoJSON format',
        required: ['id', 'type'],
        requiredOneOf: ['url', 'data'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'filter', 'inspect', 'opacity', 'clustered', 'clusterMaxZoom', 'clusterRadius', 'clusterSeparateBy', 'clusterStyles'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'geojson', description: 'Layer type identifier' },
            url: { type: 'string', description: 'GeoJSON data URL (or .kml file)' },
            data: { type: 'object', description: 'Inline GeoJSON data' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            style: { type: 'object', description: 'Mapbox GL style properties (fill-*, line-*, circle-*, text-*)' },
            filter: { type: 'array', description: 'Mapbox GL filter expression' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity multiplier' },
            clustered: { type: 'boolean', default: false, description: 'Enable point clustering' },
            clusterMaxZoom: { type: 'number', default: 14, description: 'Max zoom for clustering' },
            clusterRadius: { type: 'number', default: 50, description: 'Cluster radius in pixels' },
            clusterSeparateBy: { type: 'string', description: 'Property name to create separate clusters by category' },
            clusterStyles: { type: 'object', description: 'Color mapping for clustered categories' },
            inspect: {
                type: 'object',
                description: 'Feature inspection configuration',
                properties: {
                    id: { type: 'string', description: 'Property to use as feature ID' },
                    title: { type: 'string', description: 'Title for popup' },
                    label: { type: 'string', description: 'Property to use as feature label' },
                    fields: { type: 'array', description: 'Properties to display in popup' }
                }
            }
        },
        example: {
            id: 'poi',
            type: 'geojson',
            title: 'Points of Interest',
            url: 'https://example.com/data.geojson',
            clustered: true,
            clusterSeparateBy: 'category',
            clusterStyles: {
                'restaurant': { color: '#ff0000' },
                'hotel': { color: '#0000ff' }
            },
            style: {
                'circle-radius': 8,
                'circle-color': '#f00'
            }
        }
    },

    [LAYER_TYPES.CSV]: {
        name: 'CSV Layer',
        description: 'Tabular data with latitude/longitude columns',
        required: ['id', 'type'],
        requiredOneOf: ['url', 'data'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'inspect', 'opacity', 'csvParser', 'refresh'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'csv', description: 'Layer type identifier' },
            url: { type: 'string', description: 'CSV data URL' },
            data: { type: 'string', description: 'Inline CSV data' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            style: { type: 'object', description: 'Mapbox GL style properties (circle-*, text-*)' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity multiplier' },
            csvParser: { type: 'function', description: 'Custom CSV parsing function' },
            refresh: { type: 'number', description: 'Auto-refresh interval in milliseconds' },
            inspect: {
                type: 'object',
                description: 'Feature inspection configuration',
                properties: {
                    id: { type: 'string', description: 'Property to use as feature ID' },
                    title: { type: 'string', description: 'Title for popup' },
                    label: { type: 'string', description: 'Property to use as feature label' },
                    fields: { type: 'array', description: 'Properties to display in popup' }
                }
            }
        },
        example: {
            id: 'sensors',
            type: 'csv',
            title: 'Sensor Locations',
            url: 'https://example.com/sensors.csv',
            refresh: 60000,
            style: {
                'circle-radius': 6,
                'circle-color': '#00ff00'
            }
        }
    },

    [LAYER_TYPES.IMG]: {
        name: 'Image Overlay',
        description: 'Single georeferenced image overlay',
        required: ['id', 'type', 'url', 'bounds'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'opacity', 'refresh', 'urlTimeParam'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'img', description: 'Layer type identifier' },
            url: { type: 'string', description: 'Image URL' },
            bounds: { type: 'array', description: 'Bounding box [west, south, east, north]' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            opacity: { type: 'number', min: 0, max: 1, default: 0.85, description: 'Image opacity' },
            refresh: { type: 'number', description: 'Auto-refresh interval in milliseconds' },
            style: { type: 'object', description: 'Raster paint properties (raster-*)' },
            urlTimeParam: { type: 'string', description: 'Time parameter template (e.g., "TIME={time}")' }
        },
        example: {
            id: 'historic-map',
            type: 'img',
            title: 'Historic Map 1906',
            url: 'https://example.com/map.jpg',
            bounds: [73.5, 15.0, 74.5, 16.0],
            opacity: 0.7
        }
    },

    [LAYER_TYPES.RASTER_STYLE]: {
        name: 'Raster Style Layer',
        description: 'Controls existing raster layers in the base map style',
        required: ['id', 'type', 'styleLayer'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked', 'style', 'opacity'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'raster-style-layer', description: 'Layer type identifier' },
            styleLayer: { type: 'string', description: 'Style layer ID to control' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether layer is visible on load' },
            opacity: { type: 'number', min: 0, max: 1, default: 1, description: 'Layer opacity' },
            style: { type: 'object', description: 'Raster paint properties to apply' }
        },
        example: {
            id: 'hillshade-control',
            type: 'raster-style-layer',
            title: 'Hillshade',
            styleLayer: 'hillshade',
            opacity: 0.5
        }
    },

    [LAYER_TYPES.LAYER_GROUP]: {
        name: 'Layer Group',
        description: 'Radio button group to toggle between multiple layers',
        required: ['id', 'type', 'groups'],
        optional: ['title', 'description', 'headerImage', 'attribution', 'initiallyChecked'],
        properties: {
            id: { type: 'string', description: 'Unique layer identifier' },
            type: { type: 'string', value: 'layer-group', description: 'Layer type identifier' },
            title: { type: 'string', description: 'Display name in UI' },
            description: { type: 'string', description: 'Layer description (supports HTML)' },
            headerImage: { type: 'string', description: 'Header image URL for layer card' },
            attribution: { type: 'string', description: 'Data attribution text' },
            initiallyChecked: { type: 'boolean', default: false, description: 'Whether group is visible on load' },
            groups: {
                type: 'array',
                description: 'Array of layer options',
                items: {
                    id: { type: 'string', description: 'Layer ID to toggle' },
                    title: { type: 'string', description: 'Option label' },
                    attribution: { type: 'string', description: 'Source link' },
                    location: { type: 'string', description: 'Location to fly to when selected' }
                }
            }
        },
        example: {
            id: 'basemap-group',
            type: 'layer-group',
            title: 'Base Map',
            groups: [
                { id: 'streets', title: 'Streets' },
                { id: 'satellite', title: 'Satellite' },
                { id: 'terrain', title: 'Terrain' }
            ]
        }
    }
};

/**
 * ConfigManager - Utility class for layer configuration management
 *
 * METHODS:
 * --------
 * - getLayerType(config): Extract layer type from config
 * - getLayerSpec(type): Get specification for a layer type
 * - getAllLayerTypes(): Get array of all supported layer types
 * - validateLayerConfig(config): Validate config and return errors/warnings
 * - getLayerDocumentation(type): Get human-readable documentation for type
 * - generateLayerTemplate(type): Generate minimal config template for type
 *
 * USAGE:
 * ------
 * // Validate a configuration
 * const result = ConfigManager.validateLayerConfig(myConfig);
 * if (!result.valid) {
 *     console.error('Validation errors:', result.errors);
 *     console.warn('Warnings:', result.warnings);
 * }
 *
 * // Get documentation for a layer type
 * const docs = ConfigManager.getLayerDocumentation('geojson');
 * console.log(docs.description);
 * console.log('Required fields:', docs.required);
 * console.log('Example:', docs.example);
 *
 * // Generate a template for a new layer
 * const template = ConfigManager.generateLayerTemplate('vector');
 * template.id = 'my-custom-layer';
 * template.url = 'https://example.com/tiles/{z}/{x}/{y}.pbf';
 */
export class ConfigManager {
    static getLayerType(config) {
        return config?.type || null;
    }

    static getLayerSpec(type) {
        return LAYER_SPECIFICATIONS[type] || null;
    }

    static getAllLayerTypes() {
        return Object.values(LAYER_TYPES);
    }

    static validateLayerConfig(config) {
        const errors = [];
        const warnings = [];

        if (!config.id) {
            errors.push('Missing required field: id');
        }

        if (!config.type) {
            errors.push('Missing required field: type');
        }

        const spec = this.getLayerSpec(config.type);
        if (!spec) {
            warnings.push(`Unknown layer type: ${config.type}`);
            return { valid: false, errors, warnings };
        }

        spec.required?.forEach(field => {
            if (config[field] === undefined) {
                errors.push(`Missing required field: ${field}`);
            }
        });

        if (spec.requiredOneOf) {
            const hasOne = spec.requiredOneOf.some(field => config[field] !== undefined);
            if (!hasOne) {
                errors.push(`Must have one of: ${spec.requiredOneOf.join(', ')}`);
            }
        }

        Object.keys(config).forEach(key => {
            if (!spec.required?.includes(key) && !spec.optional?.includes(key) && key !== 'type' && key !== 'id') {
                warnings.push(`Unknown property: ${key}`);
            }
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    static getLayerDocumentation(type) {
        const spec = this.getLayerSpec(type);
        if (!spec) return null;

        return {
            name: spec.name,
            description: spec.description,
            required: spec.required || [],
            optional: spec.optional || [],
            properties: spec.properties || {},
            example: spec.example || null
        };
    }

    static generateLayerTemplate(type) {
        const spec = this.getLayerSpec(type);
        if (!spec) return null;

        const template = {
            id: 'my-layer-id',
            type: type
        };

        spec.required?.forEach(field => {
            if (field !== 'id' && field !== 'type') {
                const prop = spec.properties[field];
                if (prop?.default !== undefined) {
                    template[field] = prop.default;
                } else if (prop?.value !== undefined) {
                    template[field] = prop.value;
                } else {
                    template[field] = null;
                }
            }
        });

        return template;
    }
}

/**
 * IMPLEMENTATION GUIDE FOR NEW LAYER TYPES
 * =========================================
 *
 * STEP-BY-STEP IMPLEMENTATION CHECKLIST:
 * ---------------------------------------
 *
 * □ 1. Define Schema (THIS FILE - js/config-manager.js)
 *    - Add type constant to LAYER_TYPES
 *    - Add complete specification to LAYER_SPECIFICATIONS
 *    - Include all required/optional fields
 *    - Document each property with type and description
 *    - Provide working example
 *
 * □ 2. Implement Rendering (js/mapbox-api.js)
 *    Location: MapboxAPI.addLayer() method
 *
 *    Add case statement:
 *    ```javascript
 *    case LAYER_TYPES.MY_TYPE:
 *        // Create source
 *        this.map.addSource(sourceId, {
 *            type: 'geojson|raster|vector',
 *            // ... source configuration
 *        });
 *
 *        // Create layer(s)
 *        this.map.addLayer({
 *            id: layerId,
 *            type: 'fill|line|circle|symbol|raster',
 *            source: sourceId,
 *            paint: {
 *                // Apply config.style properties
 *            },
 *            layout: {
 *                'visibility': 'visible'
 *            }
 *        });
 *
 *        // Store layer reference
 *        this._layers.set(config.id, {
 *            config,
 *            mapboxLayerIds: [layerId],
 *            sourceId
 *        });
 *        break;
 *    ```
 *
 *    Cleanup in removeLayer():
 *    ```javascript
 *    if (this.map.getLayer(layerId)) {
 *        this.map.removeLayer(layerId);
 *    }
 *    if (this.map.getSource(sourceId)) {
 *        this.map.removeSource(sourceId);
 *    }
 *    ```
 *
 *    Opacity handling in setLayerOpacity():
 *    Add case for your layer type's paint properties
 *
 * □ 3. Update Layer Creator UI (js/layer-creator-ui.js)
 *    Location: _createLayerTypeSelect() method
 *
 *    Add to dropdown:
 *    ```javascript
 *    const option = document.createElement('sl-option');
 *    option.value = LAYER_TYPES.MY_TYPE;
 *    option.textContent = 'My Layer Type';
 *    ```
 *
 *    Location: _updateFieldsForLayerType() method
 *    Show/hide relevant form fields based on type
 *
 * □ 4. Add Default Styling (config/_defaults.json)
 *    ```json
 *    "my-type": {
 *        "style": {
 *            "fill-color": "#3b82f6",
 *            "fill-opacity": 0.5
 *        },
 *        "opacity": 0.9
 *    }
 *    ```
 *
 * □ 5. Update Documentation (docs/API.md)
 *    Add section with:
 *    - Layer type description
 *    - Complete example configuration
 *    - Supported properties table
 *    - Common use cases
 *    - Known limitations
 *
 * □ 6. Write Tests
 *    Unit tests (js/tests/config-manager.test.js):
 *    - Test validation of required fields
 *    - Test validation of optional fields
 *    - Test error/warning messages
 *
 *    Integration tests (js/tests/mapbox-api.test.js):
 *    - Test layer rendering
 *    - Test layer removal
 *    - Test opacity controls
 *
 *    E2E tests (e2e/*.spec.js):
 *    - Test loading layer from config
 *    - Test layer visibility toggle
 *    - Test URL parameter handling
 *
 * PROPERTY NAMING CONVENTIONS:
 * ----------------------------
 * - Use camelCase for property names (e.g., sourceLayer, maxZoom)
 * - Follow Mapbox GL naming for style properties (e.g., fill-color, line-width)
 * - Boolean flags should be prefixed with 'is' or use adjectives (e.g., clustered, initiallyChecked)
 * - Time/refresh intervals in milliseconds (e.g., refresh: 60000)
 * - Opacity values as 0-1 range, not percentages
 *
 * MAPBOX GL LAYER TYPE MAPPING:
 * ------------------------------
 * Your layer type determines which Mapbox GL layer type to use:
 * - Polygon data → 'fill' layer (with optional 'line' layer for borders)
 * - Line data → 'line' layer
 * - Point data → 'circle' or 'symbol' layer
 * - Raster data → 'raster' layer
 * - Text labels → 'symbol' layer
 *
 * OPACITY HANDLING:
 * -----------------
 * Different Mapbox GL layer types use different opacity properties:
 * - fill: fill-opacity
 * - line: line-opacity
 * - circle: circle-opacity
 * - symbol: icon-opacity, text-opacity
 * - raster: raster-opacity
 *
 * Implement in MapboxAPI.setLayerOpacity() and _applyOpacityToLayers()
 *
 * FEATURE INSPECTION:
 * -------------------
 * If your layer type supports feature inspection (click to see properties):
 * 1. Add 'inspect' property to optional fields
 * 2. Register layers with MapFeatureStateManager in addLayer()
 * 3. Ensure features have unique IDs for state tracking
 *
 * CLUSTERING:
 * -----------
 * For point-based layers that should support clustering:
 * 1. Add clustering properties to schema (clustered, clusterMaxZoom, clusterRadius)
 * 2. Set cluster options when creating GeoJSON source
 * 3. Create separate layers for clusters vs unclustered points
 *
 * REFRESH/REAL-TIME DATA:
 * -----------------------
 * For layers that need periodic updates:
 * 1. Add 'refresh' property (interval in milliseconds)
 * 2. Implement setInterval in addLayer() to refetch data
 * 3. Store interval ID for cleanup in removeLayer()
 *
 * TIME-BASED LAYERS:
 * ------------------
 * For layers with temporal data (e.g., satellite imagery):
 * 1. Add 'urlTimeParam' property for time template string
 * 2. Implement time slider UI if needed
 * 3. Update URL when time changes using string replacement
 *
 * TESTING YOUR IMPLEMENTATION:
 * -----------------------------
 * 1. Create test config in config/index.atlas.json
 * 2. Load map and verify layer renders correctly
 * 3. Test toggle on/off functionality
 * 4. Test opacity slider
 * 5. Test feature inspection (if applicable)
 * 6. Test URL parameters: ?atlas=index&layers=your-layer-id
 * 7. Test layer removal and memory cleanup
 * 8. Check browser console for errors/warnings
 * 9. Verify ConfigManager.validateLayerConfig() passes
 * 10. Run automated tests: npm test
 *
 * DEBUGGING TIPS:
 * ---------------
 * - Check browser console for Mapbox GL errors
 * - Use MapboxAPI._layers Map to inspect registered layers
 * - Verify source exists: map.getSource(sourceId)
 * - Verify layer exists: map.getLayer(layerId)
 * - Check layer visibility: map.getLayoutProperty(layerId, 'visibility')
 * - Inspect paint properties: map.getPaintProperty(layerId, 'fill-color')
 * - Use Mapbox GL Inspector browser extension for debugging
 *
 * PERFORMANCE CONSIDERATIONS:
 * ---------------------------
 * - Vector tiles: Set appropriate maxzoom for tile generation
 * - GeoJSON: Consider clustering for >1000 points
 * - Raster: Use appropriate tile size (256x256 or 512x512)
 * - Refresh intervals: Don't poll too frequently (minimum 5000ms)
 * - Feature inspection: Limit inspectable features with filters
 *
 * COMMON PITFALLS:
 * ----------------
 * - Forgetting to remove sources when removing layers (memory leak)
 * - Not handling layer removal before source removal (Mapbox error)
 * - Using wrong opacity property for layer type
 * - Not validating config before rendering
 * - Hardcoding layer IDs instead of generating unique ones
 * - Not clearing intervals/timeouts in cleanup
 * - Missing error handling for network requests
 * - Not testing with invalid/malformed data
 *
 * NEED HELP?
 * ----------
 * - Review existing layer type implementations in mapbox-api.js
 * - Check LAYER_SPECIFICATIONS examples below
 * - Consult Mapbox GL JS documentation: https://docs.mapbox.com/mapbox-gl-js/
 * - Run validation: ConfigManager.validateLayerConfig(yourConfig)
 * - Check API docs: /docs/API.md
 */

export default ConfigManager;
