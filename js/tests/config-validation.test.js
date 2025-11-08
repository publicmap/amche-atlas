const fs = require('fs');
const path = require('path');
const {glob} = require('glob');
const {validateJsonSyntax, validateConfigStructure} = require('./lint-json');

describe('Config File Validation', () => {
    let configFiles = [];
    let mapLayerPresets = null;
    let allAvailableLayerIds = new Set();

    beforeAll(async () => {
        // Load all config atlas JSON files
        configFiles = await glob('config/*.atlas.json', {cwd: process.cwd()});

        // Load map layer presets
        const presetsPath = path.resolve('config/_map-layer-presets.json');
        if (fs.existsSync(presetsPath)) {
            const presetsContent = fs.readFileSync(presetsPath, 'utf8');
            mapLayerPresets = JSON.parse(presetsContent);
        }

        // Collect all layer IDs from presets
        if (mapLayerPresets && mapLayerPresets.layers) {
            mapLayerPresets.layers.forEach(layer => {
                if (layer.id) {
                    allAvailableLayerIds.add(layer.id);
                }
            });
        }


        // Collect layer IDs from all atlas files (including inline definitions)
        configFiles.forEach(filePath => {
            try {
                const fullPath = path.resolve(filePath);
                const content = fs.readFileSync(fullPath, 'utf8');
                const data = JSON.parse(content);

                // Extract atlas ID from filename (e.g., "goa" from "goa.atlas.json")
                const fileName = path.basename(filePath);
                const atlasId = fileName.replace('.atlas.json', '');

                // Handle different layer array structures
                let layersArray = data.layers;
                if (!layersArray && data.layersConfig) {
                    layersArray = data.layersConfig;
                }

                if (layersArray && Array.isArray(layersArray)) {
                    layersArray.forEach(layer => {
                        // Add layers that have inline definitions (have title and one of type/url/style)
                        if (layer.id && layer.title && (layer.type || layer.url || layer.style)) {
                            // Add the unprefixed ID
                            allAvailableLayerIds.add(layer.id);

                            // Also add the prefixed version (atlasId-layerId) unless the ID already has a prefix
                            // Check if ID already contains a dash (might already be prefixed)
                            if (!layer.id.includes('-') || !layer.id.startsWith(atlasId + '-')) {
                                const prefixedId = `${atlasId}-${layer.id}`;
                                allAvailableLayerIds.add(prefixedId);
                            }
                        }
                    });
                }
            } catch (error) {
                // Skip files that can't be parsed
            }
        });
    });

    describe('JSON Syntax Validation', () => {
        test('should find config files', () => {
            expect(configFiles.length).toBeGreaterThan(0);
        });

        test('should validate all config files have valid JSON syntax', () => {
            configFiles.forEach((filePath) => {
                const fullPath = path.resolve(filePath);
                expect(validateJsonSyntax(fullPath), `[${filePath}] Invalid JSON syntax`).toBe(true);
            });
        });
    });

    describe('JSON Structure Validation', () => {
        test('should validate all config files have valid structure', () => {
            expect(configFiles.length).toBeGreaterThan(0);

            configFiles.forEach((filePath) => {
                const fullPath = path.resolve(filePath);
                const content = fs.readFileSync(fullPath, 'utf8');
                const data = JSON.parse(content);

                expect(validateConfigStructure(fullPath, data), `[${filePath}] Invalid structure`).toBe(true);
            });
        });
    });

    describe('Layer Reference Validation', () => {
        test('should load map layer presets', () => {
            expect(mapLayerPresets).not.toBeNull();
            expect(mapLayerPresets.layers).toBeDefined();
            expect(Array.isArray(mapLayerPresets.layers)).toBe(true);
        });

        test('should have unique layer IDs in presets', () => {
            const layerIds = mapLayerPresets.layers.map(layer => layer.id).filter(id => id);
            const uniqueIds = new Set(layerIds);

            expect(layerIds.length).toBe(uniqueIds.size);
        });

        test('should reference valid layer IDs in all config files', () => {
            const testFiles = configFiles.filter(file =>
                !file.includes('_map-layer-presets.json') && !file.includes('_defaults.json')
            );

            testFiles.forEach((filePath) => {
                const fullPath = path.resolve(filePath);
                const content = fs.readFileSync(fullPath, 'utf8');
                const data = JSON.parse(content);

                // Handle different layer array structures
                let layersArray = data.layers;
                if (!layersArray && data.layersConfig) {
                    layersArray = data.layersConfig;
                }

                // Skip files without layers array
                if (!layersArray || !Array.isArray(layersArray)) {
                    return;
                }

                // Helper function to find closest matches
                const findClosestMatches = (invalidId, maxSuggestions = 3) => {
                    const levenshteinDistance = (str1, str2) => {
                        const matrix = [];

                        for (let i = 0; i <= str2.length; i++) {
                            matrix[i] = [i];
                        }

                        for (let j = 0; j <= str1.length; j++) {
                            matrix[0][j] = j;
                        }

                        for (let i = 1; i <= str2.length; i++) {
                            for (let j = 1; j <= str1.length; j++) {
                                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                                    matrix[i][j] = matrix[i - 1][j - 1];
                                } else {
                                    matrix[i][j] = Math.min(
                                        matrix[i - 1][j - 1] + 1,
                                        matrix[i][j - 1] + 1,
                                        matrix[i - 1][j] + 1
                                    );
                                }
                            }
                        }

                        return matrix[str2.length][str1.length];
                    };

                    return Array.from(allAvailableLayerIds)
                        .map(id => ({
                            id,
                            distance: levenshteinDistance(invalidId, id)
                        }))
                        .sort((a, b) => a.distance - b.distance)
                        .slice(0, maxSuggestions)
                        .filter(item => item.distance <= Math.max(3, invalidId.length * 0.5))
                        .map(item => item.id);
                };

                // Check each layer reference
                const invalidReferences = [];
                layersArray.forEach((layer, index) => {
                    // Skip layers that are fully defined inline
                    const isInlineDefinition = layer.title && (layer.type || layer.url || layer.style);
                    // Skip layers that are just ID references (external layers)
                    const isBareIdReference = layer.id && !layer.title && !layer.type && !layer.url && !layer.style;

                    // Only validate layers that have some definition but are missing from our known layers
                    if (layer.id && !allAvailableLayerIds.has(layer.id) && !isInlineDefinition && !isBareIdReference) {
                        const suggestions = findClosestMatches(layer.id);
                        invalidReferences.push({
                            index,
                            id: layer.id,
                            title: layer.title || 'No title',
                            suggestions
                        });
                    }
                });

                if (invalidReferences.length > 0) {
                    const errorMessage = invalidReferences
                        .map(ref => {
                            let msg = `  - Index ${ref.index}: "${ref.id}" (${ref.title})`;
                            if (ref.suggestions.length > 0) {
                                msg += `\n    Did you mean: ${ref.suggestions.join(', ')}?`;
                            }
                            return msg;
                        })
                        .join('\n');

                    throw new Error(`Invalid layer references found in ${filePath}:\n${errorMessage}\n\nAll available layer IDs: ${Array.from(allAvailableLayerIds).sort().join(', ')}`);
                }
            });
        });
    });

    describe('Map Layer Presets Validation', () => {
        const presetsFile = 'config/_map-layer-presets.json';

        test('should have required fields for each layer', () => {
            mapLayerPresets.layers.forEach((layer, index) => {
                const layerInfo = `[${presetsFile}] Layer at index ${index} (id: "${layer.id || 'undefined'}")`;

                expect(layer.id, `${layerInfo}: missing 'id' field`).toBeDefined();
                expect(typeof layer.id, `${layerInfo}: 'id' must be a string`).toBe('string');
                expect(layer.id.length, `${layerInfo}: 'id' cannot be empty`).toBeGreaterThan(0);

                expect(layer.title, `${layerInfo}: missing 'title' field`).toBeDefined();
                expect(typeof layer.title, `${layerInfo}: 'title' must be a string`).toBe('string');
                expect(layer.title.length, `${layerInfo}: 'title' cannot be empty`).toBeGreaterThan(0);

                // Type should be one of the expected values
                if (layer.type) {
                    const validTypes = ['vector', 'geojson', 'tms', 'markers', 'csv', 'style', 'terrain', 'layer-group', 'img', 'raster-style-layer'];
                    expect(validTypes, `${layerInfo}: invalid type "${layer.type}"`).toContain(layer.type);
                }
            });
        });

        test('should have valid headerImage paths for layers with images', () => {
            mapLayerPresets.layers.forEach((layer, index) => {
                const layerInfo = `[${presetsFile}] Layer at index ${index} (id: "${layer.id || 'undefined'}")`;

                if (layer.headerImage) {
                    expect(typeof layer.headerImage, `${layerInfo}: 'headerImage' must be a string`).toBe('string');
                    expect(layer.headerImage.length, `${layerInfo}: 'headerImage' cannot be empty`).toBeGreaterThan(0);
                    // Should start with assets/ for local images
                    if (!layer.headerImage.startsWith('http')) {
                        expect(layer.headerImage, `${layerInfo}: local headerImage must start with 'assets/'`).toMatch(/^assets\//);
                    }
                }
            });
        });

        test('should have valid attribution for data layers', () => {
            mapLayerPresets.layers.forEach((layer, index) => {
                const layerInfo = `[${presetsFile}] Layer at index ${index} (id: "${layer.id || 'undefined'}")`;

                // Skip style layers and terrain as they may not need attribution
                if (layer.type && !['style', 'terrain'].includes(layer.type)) {
                    if (layer.attribution) {
                        expect(typeof layer.attribution, `${layerInfo}: 'attribution' must be a string`).toBe('string');
                        expect(layer.attribution.length, `${layerInfo}: 'attribution' cannot be empty`).toBeGreaterThan(0);
                    }
                }
            });
        });
    });

    describe('Config File Consistency', () => {
        test('should have consistent naming patterns', () => {
            configFiles.forEach(filePath => {
                const fileName = path.basename(filePath);

                // File names should be lowercase with hyphens or underscores
                expect(fileName, `[${filePath}] Invalid filename pattern`).toMatch(/^[a-z0-9._-]+\.json$/);
            });
        });

        test('should have valid map center coordinates', () => {
            configFiles.forEach(filePath => {
                const fullPath = path.resolve(filePath);
                const content = fs.readFileSync(fullPath, 'utf8');
                const data = JSON.parse(content);

                if (data.map && data.map.center) {
                    expect(Array.isArray(data.map.center), `[${filePath}] map.center must be an array`).toBe(true);
                    expect(data.map.center, `[${filePath}] map.center must have exactly 2 elements [lng, lat]`).toHaveLength(2);

                    const [lng, lat] = data.map.center;
                    expect(typeof lng, `[${filePath}] map.center[0] (longitude) must be a number`).toBe('number');
                    expect(typeof lat, `[${filePath}] map.center[1] (latitude) must be a number`).toBe('number');

                    // Basic coordinate validation (longitude: -180 to 180, latitude: -90 to 90)
                    expect(lng, `[${filePath}] longitude ${lng} must be between -180 and 180`).toBeGreaterThanOrEqual(-180);
                    expect(lng, `[${filePath}] longitude ${lng} must be between -180 and 180`).toBeLessThanOrEqual(180);
                    expect(lat, `[${filePath}] latitude ${lat} must be between -90 and 90`).toBeGreaterThanOrEqual(-90);
                    expect(lat, `[${filePath}] latitude ${lat} must be between -90 and 90`).toBeLessThanOrEqual(90);
                }
            });
        });
    });
}); 