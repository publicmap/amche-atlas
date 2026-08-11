import { describe, it, expect } from 'vitest';
import { ConfigManager, LAYER_TYPES, LAYER_SPECIFICATIONS } from '../config-manager.js';

describe('ConfigManager', () => {
    describe('Layer Type Constants', () => {
        it('should export all layer type constants', () => {
            expect(LAYER_TYPES.STYLE).toBe('style');
            expect(LAYER_TYPES.VECTOR).toBe('vector');
            expect(LAYER_TYPES.TMS).toBe('tms');
            expect(LAYER_TYPES.WMTS).toBe('wmts');
            expect(LAYER_TYPES.WMS).toBe('wms');
            expect(LAYER_TYPES.GEOJSON).toBe('geojson');
            expect(LAYER_TYPES.CSV).toBe('csv');
            expect(LAYER_TYPES.IMG).toBe('img');
            expect(LAYER_TYPES.RASTER_STYLE).toBe('raster-style-layer');
            expect(LAYER_TYPES.LAYER_GROUP).toBe('layer-group');
        });
    });

    describe('Layer Specifications', () => {
        it('should have specifications for all layer types', () => {
            Object.values(LAYER_TYPES).forEach(type => {
                expect(LAYER_SPECIFICATIONS[type]).toBeDefined();
                expect(LAYER_SPECIFICATIONS[type].name).toBeDefined();
                expect(LAYER_SPECIFICATIONS[type].description).toBeDefined();
            });
        });

        it('should have valid examples for all layer types', () => {
            Object.values(LAYER_TYPES).forEach(type => {
                const spec = LAYER_SPECIFICATIONS[type];
                if (spec.example) {
                    expect(spec.example.id).toBeDefined();
                    expect(spec.example.type).toBe(type);
                }
            });
        });
    });

    describe('getLayerType', () => {
        it('should return layer type from config', () => {
            expect(ConfigManager.getLayerType({ type: 'vector' })).toBe('vector');
            expect(ConfigManager.getLayerType({ type: 'geojson' })).toBe('geojson');
        });

        it('should return null for missing type', () => {
            expect(ConfigManager.getLayerType({})).toBeNull();
            expect(ConfigManager.getLayerType(null)).toBeNull();
        });
    });

    describe('getLayerSpec', () => {
        it('should return specification for valid types', () => {
            const spec = ConfigManager.getLayerSpec('vector');
            expect(spec).toBeDefined();
            expect(spec.name).toBe('Vector Tile Layer');
        });

        it('should return null for invalid types', () => {
            expect(ConfigManager.getLayerSpec('invalid')).toBeNull();
        });
    });

    describe('getAllLayerTypes', () => {
        it('should return all layer types', () => {
            const types = ConfigManager.getAllLayerTypes();
            expect(types).toHaveLength(11);
            expect(types).toContain('vector');
            expect(types).toContain('geojson');
            expect(types).toContain('sheet');
        });
    });

    describe('validateLayerConfig', () => {
        it('should validate complete vector layer config', () => {
            const config = {
                id: 'test-layer',
                type: 'vector',
                url: 'https://example.com/{z}/{x}/{y}.pbf',
                sourceLayer: 'test'
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should detect missing required fields', () => {
            const config = {
                id: 'test-layer',
                type: 'vector'
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some(e => e.includes('url'))).toBe(true);
        });

        it('should detect missing id', () => {
            const config = {
                type: 'geojson',
                url: 'test.json'
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('id'))).toBe(true);
        });

        it('should detect missing type', () => {
            const config = {
                id: 'test'
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('type'))).toBe(true);
        });

        it('should warn about unknown properties', () => {
            const config = {
                id: 'test',
                type: 'geojson',
                url: 'test.json',
                unknownProp: 'value'
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.warnings.some(w => w.includes('unknownProp'))).toBe(true);
        });

        it('should validate requiredOneOf for geojson', () => {
            const validConfig1 = {
                id: 'test',
                type: 'geojson',
                url: 'test.json'
            };
            expect(ConfigManager.validateLayerConfig(validConfig1).valid).toBe(true);

            const validConfig2 = {
                id: 'test',
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            };
            expect(ConfigManager.validateLayerConfig(validConfig2).valid).toBe(true);

            const invalidConfig = {
                id: 'test',
                type: 'geojson'
            };
            const result = ConfigManager.validateLayerConfig(invalidConfig);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('url') || e.includes('data'))).toBe(true);
        });
    });

    describe('getLayerDocumentation', () => {
        it('should return documentation for valid types', () => {
            const docs = ConfigManager.getLayerDocumentation('vector');
            expect(docs).toBeDefined();
            expect(docs.name).toBe('Vector Tile Layer');
            expect(docs.required).toBeDefined();
            expect(docs.optional).toBeDefined();
            expect(docs.properties).toBeDefined();
        });

        it('should return null for invalid types', () => {
            expect(ConfigManager.getLayerDocumentation('invalid')).toBeNull();
        });
    });

    describe('generateLayerTemplate', () => {
        it('should generate valid template for vector layer', () => {
            const template = ConfigManager.generateLayerTemplate('vector');
            expect(template).toBeDefined();
            expect(template.id).toBe('my-layer-id');
            expect(template.type).toBe('vector');
            expect(template.url).toBeDefined();
            expect(template.sourceLayer).toBeDefined();
        });

        it('should generate valid template for geojson layer', () => {
            const template = ConfigManager.generateLayerTemplate('geojson');
            expect(template).toBeDefined();
            expect(template.id).toBe('my-layer-id');
            expect(template.type).toBe('geojson');
        });

        it('should return null for invalid type', () => {
            expect(ConfigManager.generateLayerTemplate('invalid')).toBeNull();
        });
    });

    describe('Layer Type Specific Validation', () => {
        it('should validate style layer config', () => {
            const config = {
                id: 'contours',
                type: 'style',
                layers: [
                    { sourceLayer: 'contour', title: 'Contours' }
                ]
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(true);
        });

        it('should validate img layer with bounds', () => {
            const config = {
                id: 'historic',
                type: 'img',
                url: 'https://example.com/map.jpg',
                bounds: [73.5, 15.0, 74.5, 16.0]
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(true);
        });

        it('should detect missing bounds for img layer', () => {
            const config = {
                id: 'historic',
                type: 'img',
                url: 'https://example.com/map.jpg'
            };
            const result = ConfigManager.validateLayerConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('bounds'))).toBe(true);
        });
    });
});
