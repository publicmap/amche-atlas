// In-flight initialize() promise, keyed off the registry instance. Held in
// a module-level WeakMap (not on the instance) because postMessage to iframes
// structured-clones the registry, and Promises can't be cloned.
const inFlightInit = new WeakMap();

export class LayerRegistry {
    constructor() {
        this._registry = new Map(); // layerId -> layer config
        this._atlasLayers = new Map(); // atlasId -> array of layer configs
        this._atlasMetadata = new Map(); // atlasId -> atlas metadata (color, name, etc.)
        this._currentAtlas = 'index'; // default atlas
        this._initialized = false;
    }

    async initialize() {
        if (this._initialized) return;
        const existing = inFlightInit.get(this);
        if (existing) return existing;
        const promise = this._doInitialize();
        inFlightInit.set(this, promise);
        try {
            await promise;
        } finally {
            inFlightInit.delete(this);
        }
    }

    async _doInitialize() {
        // Build the list of atlas entries to load. Each entry is normalized to
        // { atlasId, url, baseUrl }:
        //   - Local atlases are referenced by short id and loaded from config/<id>.atlas.json
        //   - External atlases are referenced by full URL; their id is derived from the filename
        //     and their layers' relative URLs are resolved against the file's base URL.
        const indexAtlasId = window.amche.DEFAULT_ATLAS.slice(window.amche.DEFAULT_ATLAS.indexOf('config/') + 7, window.amche.DEFAULT_ATLAS.indexOf('.atlas.json'));
        const atlasEntries = [{ atlasId: indexAtlasId, url: window.amche.DEFAULT_ATLAS, baseUrl: null }];

        const indexResponse = await fetch(window.amche.DEFAULT_ATLAS);
        if (indexResponse.ok) {
            const indexConfig = await indexResponse.json();
            if (indexConfig.atlases && Array.isArray(indexConfig.atlases)) {
                indexConfig.atlases.forEach(entry => {
                    const parsed = this._parseAtlasEntry(entry);
                    if (parsed) atlasEntries.push(parsed);
                });
            }
        }

        // Create a Set for fast lookup of known atlas IDs
        const knownAtlases = new Set(atlasEntries.map(e => e.atlasId));

        // Load all atlas configurations in parallel
        const atlasPromises = atlasEntries.map(async ({ atlasId, url, baseUrl }) => {
            const isExternal = !!url && (url.startsWith('http://') || url.startsWith('https://'));
            try {
                const fetchUrl = url || `config/${atlasId}.atlas.json`;
                const response = await fetch(fetchUrl);
                if (response.ok) {
                    // Check Content-Type to ensure we're getting JSON, not HTML (e.g., 404 page).
                    // Skip for external URLs since hosts like raw.githubusercontent.com serve
                    // .json files as text/plain.
                    if (!isExternal) {
                        const contentType = response.headers.get('content-type') || '';
                        if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
                            return {
                                atlasId,
                                error: `Invalid content type: ${contentType} (expected JSON)`,
                                success: false
                            };
                        }
                    }

                    const config = await response.json();
                    return { atlasId, config, baseUrl, url: fetchUrl, success: true };
                } else {
                    return { atlasId, error: `HTTP ${response.status}`, success: false };
                }
            } catch (error) {
                // Handle JSON parsing errors specifically
                if (error.message.includes('JSON') || error.message.includes('DOCTYPE')) {
                    return {
                        atlasId,
                        error: `Invalid JSON response (likely HTML/404 page)`,
                        success: false
                    };
                }
                return { atlasId, error: error.message, success: false };
            }
        });

        // Wait for all atlas fetches to complete (whether successful or not)
        const atlasResults = await Promise.allSettled(atlasPromises);

        // Cross-atlas references that carry their own overrides (e.g. goa referencing
        // `india-district` with a custom title/style). Collected during registration and
        // resolved after all atlases load, since the base definition may load later.
        const crossAtlasOverrides = [];

        // Process all successfully loaded atlas configurations
        for (const result of atlasResults) {
            if (result.status === 'fulfilled' && result.value.success) {
                const { atlasId, config, baseUrl, url } = result.value;

                // Store atlas metadata (color, name, etc.)
                this._atlasMetadata.set(atlasId, {
                    // Resolved URL the config was loaded from (external URL for cross-repo
                    // atlases, local config/<id>.atlas.json otherwise). Lets other modules
                    // re-fetch the correct source instead of assuming a local file.
                    url: url || `config/${atlasId}.atlas.json`,
                    // True for cross-repo atlases referenced by full URL in index's
                    // `atlases` array. Used to exclude them from location-based
                    // ?atlas auto-detection (see SplashScreenManager).
                    isExternal: !!url && (url.startsWith('http://') || url.startsWith('https://')),
                    color: config.color || '#2563eb', // Default to blue if not specified
                    name: config.name || atlasId,
                    map: config.map || null,
                    areaOfInterest: config.areaOfInterest || '',
                    description: config.description || '',
                    bbox: this._extractBbox(config),
                    geojson: config.geojson || null,
                    tags: config.tags || [],
                    icon: config.icon || null,
                    headerImage: config.headerImage || null,
                    // Atlas-level style/inspect defaults cascaded to every layer in this atlas
                    // (see _resolveLayer). `stylePresets` is a named-preset dictionary that layers
                    // may opt into via `stylePreset: "<name>"`.
                    style: config.style || null,
                    inspect: config.inspect || null,
                    stylePresets: config.stylePresets || null
                });

                if (config.layers && Array.isArray(config.layers)) {
                    this._atlasLayers.set(atlasId, config.layers);

                    // Register each layer with appropriate ID
                    config.layers.forEach(layer => {
                        const resolvedLayer = this._resolveLayer(layer, atlasId);
                        // Resolve relative URLs in external atlas layers against the source base URL
                        if (resolvedLayer && baseUrl) {
                            this._resolveRelativeUrls(resolvedLayer, baseUrl);
                        }
                        if (resolvedLayer) {
                            // Check if the layer ID already has an atlas prefix
                            const layerId = resolvedLayer.id;
                            let prefixedId;
                            let sourceAtlas = atlasId; // Default to current atlas

                            // If the ID already contains a dash and might be prefixed, check if it's a valid atlas prefix
                            if (layerId.includes('-')) {
                                const potentialPrefix = layerId.split('-')[0];
                                // If it's a known atlas prefix, use the ID as-is (it's already prefixed)
                                if (knownAtlases.has(potentialPrefix)) {
                                    prefixedId = layerId;
                                    // The source atlas should be the prefix, not the current atlas
                                    sourceAtlas = potentialPrefix;
                                } else {
                                    // Not a valid prefix, add the atlas prefix
                                    prefixedId = `${atlasId}-${layerId}`;
                                }
                            } else {
                                // No dash, definitely not prefixed
                                prefixedId = `${atlasId}-${layerId}`;
                            }

                            // A reference to a layer owned by another atlas that also
                            // carries overrides: register a per-atlas variant keyed
                            // `<atlas>-<prefixedId>` that cascades the overrides over the
                            // base definition (mirrors map-init's runtime merge). Resolved
                            // after all atlases load. Bare references (id only) fall through
                            // to the shared-entry logic below.
                            if (sourceAtlas !== atlasId && this._hasLayerOverrides(layer)) {
                                crossAtlasOverrides.push({ atlasId, prefixedId, override: resolvedLayer });
                                return;
                            }

                            // Check if layer is already in registry
                            const existingEntry = this._registry.get(prefixedId);

                            if (!existingEntry) {
                                // Not in registry yet, add it
                                this._registry.set(prefixedId, {
                                    ...resolvedLayer,
                                    _sourceAtlas: sourceAtlas,
                                    _prefixedId: prefixedId,
                                    // Store the original unprefixed ID for reference
                                    _originalId: layerId
                                });
                            } else if (!resolvedLayer.type && !resolvedLayer.title) {
                                // This is a reference to a layer defined elsewhere, skip it
                                // The actual layer definition will be/has been loaded from its source atlas
                                // Do nothing - the complete layer definition takes precedence
                            } else if (existingEntry && (!existingEntry.type || !existingEntry.title)) {
                                // Registry has an incomplete entry (from a cross-atlas reference loaded earlier)
                                // Update it with the complete definition from the source atlas
                                // Merge tags from both entries to preserve cascaded tags
                                const mergedTags = existingEntry.tags && resolvedLayer.tags
                                    ? [...new Set([...existingEntry.tags, ...resolvedLayer.tags])]
                                    : (existingEntry.tags || resolvedLayer.tags || []);

                                this._registry.set(prefixedId, {
                                    ...resolvedLayer,
                                    tags: mergedTags,
                                    _sourceAtlas: sourceAtlas,
                                    _prefixedId: prefixedId,
                                    _originalId: layerId,
                                    // Preserve any metadata from the incomplete entry
                                    ...(existingEntry._crossAtlasReference && { _crossAtlasReference: existingEntry._crossAtlasReference })
                                });
                            }
                            // If entry exists and is complete, leave it as-is (first complete definition wins)

                        }
                    });
                }
            } else {
                // Handle failed atlas loads
                const atlasId = result.status === 'fulfilled'
                    ? result.value.atlasId
                    : 'unknown';
                const error = result.status === 'fulfilled'
                    ? result.value.error
                    : result.reason?.message || 'Unknown error';
                console.warn(`[LayerRegistry] Failed to load atlas ${atlasId}:`, error);
            }
        }

        // After all atlases are loaded, resolve cross-atlas references
        this._resolveCrossAtlasReferences();

        // Apply per-atlas overrides on top of their (now-loaded) base definitions
        this._applyCrossAtlasOverrides(crossAtlasOverrides);

        // Create consolidated index of atlas to layer IDs
        const layerIndex = {};
        for (const [layerId, layer] of this._registry.entries()) {
            const atlasId = layer._sourceAtlas || 'unknown';
            if (!layerIndex[atlasId]) {
                layerIndex[atlasId] = [];
            }
            layerIndex[atlasId].push({
                id: layerId,
                title: layer.title || layer.name || layerId
            });
        }

        this._initialized = true;
    }

    /**
     * Resolve cross-atlas references after all atlases are loaded
     */
    _resolveCrossAtlasReferences() {
        // Find all layers that are incomplete (missing title, type, etc.)
        const incompleteLayers = [];
        for (const [layerId, layer] of this._registry.entries()) {
            // Check if layer is incomplete - missing type or title (or both)
            const isIncomplete = (!layer.type || !layer.title) && layer.id.includes('-');
            if (isIncomplete) {
                incompleteLayers.push({ layerId, layer });
            }
        }

        // Try to resolve each incomplete layer
        for (const { layerId, layer } of incompleteLayers) {
            const potentialAtlas = layer.id.split('-')[0];
            const originalId = layer.id.substring(potentialAtlas.length + 1);

            // Try to find the original layer in the potential atlas
            const crossAtlasLayers = this._atlasLayers.get(potentialAtlas);
            if (crossAtlasLayers) {
                const originalLayer = crossAtlasLayers.find(l => l.id === originalId);
                if (originalLayer) {
                    // Found the original layer, update the registry entry
                    const resolvedLayer = {
                        ...originalLayer,
                        id: layer.id, // Keep the cross-atlas ID
                        _crossAtlasReference: true,
                        _originalAtlas: potentialAtlas,
                        _originalId: originalId,
                        _sourceAtlas: layer._sourceAtlas || potentialAtlas, // Use potentialAtlas as source if not set
                        _prefixedId: layer._prefixedId || layerId // Preserve the prefixed ID
                    };

                    console.debug(`[LayerRegistry] Resolved incomplete cross-atlas layer ${layerId} from ${potentialAtlas} atlas: ${originalId} -> type: ${originalLayer.type || 'missing'}`);
                    this._registry.set(layerId, resolvedLayer);
                }
            }
        }
    }

    /**
     * Whether a layer config carries definition overrides beyond instance-level
     * settings. Used to distinguish a bare cross-atlas reference (`{id}`) from one
     * that customizes the referenced layer (title, style, tags, …).
     */
    _hasLayerOverrides(layer) {
        const INSTANCE_ONLY = new Set(['id', 'initiallyChecked', 'opacity']);
        return Object.keys(layer).some(key => !INSTANCE_ONLY.has(key));
    }

    /**
     * Register per-atlas variants for cross-atlas references that carry overrides.
     * The variant is keyed `<atlas>-<basePrefixedId>` and merges the overrides over
     * the base definition, with `_sourceAtlas` set to the referencing atlas so it
     * surfaces under that atlas (e.g. in the browser). Top-level shallow merge mirrors
     * map-init's runtime merge, so the variant matches what the map actually renders.
     * The base entry is left untouched, so the owning atlas is unaffected.
     */
    _applyCrossAtlasOverrides(overrides) {
        for (const { atlasId, prefixedId, override } of overrides) {
            const base = this._registry.get(prefixedId);
            if (!base) {
                console.debug(`[LayerRegistry] Cross-atlas override ${atlasId}-${prefixedId} skipped: base layer ${prefixedId} not found`);
                continue;
            }
            const variantId = `${atlasId}-${prefixedId}`;
            this._registry.set(variantId, {
                ...base,
                ...override,
                id: prefixedId,
                _sourceAtlas: atlasId,
                _prefixedId: variantId,
                _originalId: prefixedId,
                _baseAtlas: base._sourceAtlas,
                _crossAtlasOverride: true
            });
        }
    }

    /**
     * Set the current active atlas
     */
    setCurrentAtlas(atlasId) {
        this._currentAtlas = atlasId;
    }

    /**
     * Mark an atlas as imported (loaded via URL parameter)
     * @param {string} atlasId - The atlas ID (usually 'imported')
     * @param {object} metadata - Atlas metadata (name, color, etc.)
     * @param {object} config - Full atlas config with layers array (optional)
     */
    markImportedAtlas(atlasId, metadata, config = null) {
        this._atlasMetadata.set(atlasId, {
            ...metadata,
            geojson: metadata.geojson || (config && config.geojson) || null,
            tags: metadata.tags || (config && config.tags) || [],
            icon: metadata.icon || (config && config.icon) || null,
            headerImage: metadata.headerImage || (config && config.headerImage) || null,
            style: metadata.style || (config && config.style) || null,
            inspect: metadata.inspect || (config && config.inspect) || null,
            stylePresets: metadata.stylePresets || (config && config.stylePresets) || null,
            isImported: true
        });

        if (config && config.layers && Array.isArray(config.layers)) {
            this._atlasLayers.set(atlasId, config.layers);

            const baseUrl = metadata.sourceUrl ? this._getBaseUrl(metadata.sourceUrl) : null;

            config.layers.forEach(layer => {
                // Resolve layer with atlas tags
                const resolvedLayer = this._resolveLayer(layer, atlasId);
                if (resolvedLayer && baseUrl) {
                    this._resolveRelativeUrls(resolvedLayer, baseUrl);
                }

                if (resolvedLayer) {
                    const layerId = resolvedLayer.id;
                    const prefixedId = `${atlasId}-${layerId}`;

                    if (!this._registry.has(prefixedId)) {
                        this._registry.set(prefixedId, {
                            ...resolvedLayer,
                            _sourceAtlas: atlasId,
                            _prefixedId: prefixedId,
                            _originalId: layerId
                        });
                    }
                }
            });
        }
    }

    /**
     * Normalize an atlas reference from index.atlas.json's `atlases` array into
     * { atlasId, url, baseUrl }.
     *   - A short id (e.g. "goa") → loaded from config/goa.atlas.json
     *   - A full URL (e.g. "https://.../dfes-dmp.atlas.json") → loaded directly,
     *     with the atlas id derived from the filename and baseUrl set for
     *     resolving the config's relative layer URLs.
     * @param {string} entry - Atlas reference
     * @returns {{atlasId: string, url: string|null, baseUrl: string|null}|null}
     */
    _parseAtlasEntry(entry) {
        if (!entry || typeof entry !== 'string') return null;

        if (entry.startsWith('http://') || entry.startsWith('https://')) {
            const filename = entry.split('/').pop().split('?')[0] || '';
            const atlasId = filename.replace(/\.atlas\.json$/i, '').replace(/\.json$/i, '');
            if (!atlasId) {
                console.warn('[LayerRegistry] Could not derive atlas id from URL:', entry);
                return null;
            }
            return { atlasId, url: entry, baseUrl: this._getBaseUrl(entry) };
        }

        return { atlasId: entry, url: null, baseUrl: null };
    }

    /**
     * Get base URL from a full URL (directory containing the file)
     * @param {string} url - Full URL to a file
     * @returns {string} Base URL (directory path)
     */
    _getBaseUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            pathParts.pop(); // Remove filename
            urlObj.pathname = pathParts.join('/') + '/';
            return urlObj.toString();
        } catch (e) {
            console.warn('[LayerRegistry] Failed to parse base URL from:', url);
            return null;
        }
    }

    /**
     * Resolve relative URLs in layer config to absolute URLs
     * @param {object} layer - Layer configuration
     * @param {string} baseUrl - Base URL to resolve against
     */
    _resolveRelativeUrls(layer, baseUrl) {

        const urlFields = ['url', 'thumbnail', 'tiles', 'headerImage'];

        urlFields.forEach(field => {
            if (layer[field]) {
                if (typeof layer[field] === 'string') {
                    const resolved = this._resolveUrl(layer[field], baseUrl);
                    layer[field] = resolved;
                } else if (Array.isArray(layer[field])) {
                    layer[field] = layer[field].map(url => {
                        const resolved = this._resolveUrl(url, baseUrl);
                        return resolved;
                    });
                }
            }
        });

        if (layer.source && typeof layer.source === 'object') {
            if (layer.source.url) {
                const resolved = this._resolveUrl(layer.source.url, baseUrl);
                layer.source.url = resolved;
            }
            if (layer.source.tiles && Array.isArray(layer.source.tiles)) {
                layer.source.tiles = layer.source.tiles.map(url => {
                    const resolved = this._resolveUrl(url, baseUrl);
                    return resolved;
                });
            }
        }

        if (layer.style && typeof layer.style === 'object') {
            this._resolveStyleUrls(layer.style, baseUrl, 'style');
        }

        if (layer.paint && typeof layer.paint === 'object') {
            this._resolveStyleUrls(layer.paint, baseUrl, 'paint');
        }

        if (layer.layout && typeof layer.layout === 'object') {
            this._resolveStyleUrls(layer.layout, baseUrl, 'layout');
        }
    }

    /**
     * Resolve URLs in style/paint/layout objects
     * @param {object} styleObj - Style object
     * @param {string} baseUrl - Base URL to resolve against
     * @param {string} objName - Name of the object (for logging)
     */
    _resolveStyleUrls(styleObj, baseUrl, objName) {
        const imageProps = ['icon-image', 'fill-pattern', 'line-pattern', 'background-pattern'];

        imageProps.forEach(prop => {
            if (styleObj[prop]) {
                if (typeof styleObj[prop] === 'string') {
                    const resolved = this._resolveUrl(styleObj[prop], baseUrl);
                    styleObj[prop] = resolved;
                } else if (Array.isArray(styleObj[prop])) {
                    this._resolveUrlsInExpression(styleObj[prop], baseUrl, `${objName}.${prop}`);
                }
            }
        });
    }

    /**
     * Resolve URLs within a Mapbox expression (array)
     * @param {Array} expression - Mapbox expression array
     * @param {string} baseUrl - Base URL to resolve against
     * @param {string} context - Context for logging
     */
    _resolveUrlsInExpression(expression, baseUrl, context) {
        for (let i = 0; i < expression.length; i++) {
            if (typeof expression[i] === 'string' && this._looksLikeIconPath(expression[i])) {
                const resolved = this._resolveUrl(expression[i], baseUrl);
                if (resolved !== expression[i]) {
                    expression[i] = resolved;
                }
            } else if (Array.isArray(expression[i])) {
                this._resolveUrlsInExpression(expression[i], baseUrl, context);
            }
        }
    }

    /**
     * Check if a string looks like an icon path (not a property value)
     * @param {string} str - String to check
     * @returns {boolean} True if it looks like an icon path
     */
    _looksLikeIconPath(str) {
        // Must have a file extension or be a URL
        return (str.includes('.png') || str.includes('.jpg') || str.includes('.svg') ||
            str.includes('.jpeg') || str.includes('.gif') ||
            str.startsWith('http://') || str.startsWith('https://') ||
            str.startsWith('assets/') || str.startsWith('data/') || str.startsWith('images/'));
    }

    /**
     * Resolve a single URL (if relative) against a base URL
     * @param {string} url - URL to resolve
     * @param {string} baseUrl - Base URL to resolve against
     * @returns {string} Resolved absolute URL
     */
    _resolveUrl(url, baseUrl) {
        if (!url || typeof url !== 'string') return url;

        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
            return url;
        }

        try {
            // Handle GitHub repo-root relative paths (common pattern)
            // If base is in a subdirectory (e.g., /config/) and url starts with common repo folders
            if (baseUrl.includes('raw.githubusercontent.com') &&
                (url.startsWith('assets/') || url.startsWith('data/') || url.startsWith('images/'))) {
                const baseUrlObj = new URL(baseUrl);
                const pathParts = baseUrlObj.pathname.split('/').filter(p => p);

                // GitHub URL structure: /org/repo/refs/heads/branch/ or /org/repo/branch/
                // Determine repo root based on whether it uses /refs/heads/ structure
                let rootPathIndex;
                if (pathParts[2] === 'refs' && pathParts[3] === 'heads' && pathParts.length > 5) {
                    // /org/repo/refs/heads/branch/... → take first 5 parts
                    rootPathIndex = 5;
                } else if (pathParts.length > 3) {
                    // /org/repo/branch/... → take first 3 parts
                    rootPathIndex = 3;
                }

                if (rootPathIndex && pathParts.length > rootPathIndex) {
                    const rootPath = '/' + pathParts.slice(0, rootPathIndex).join('/') + '/' + url;
                    baseUrlObj.pathname = rootPath;
                    return baseUrlObj.toString();
                }
            }

            return new URL(url, baseUrl).toString();
        } catch (e) {
            console.warn('[LayerRegistry] Failed to resolve URL:', url, 'against base:', baseUrl);
            return url;
        }
    }

    /**
     * Get the imported atlas ID if one exists
     */
    getImportedAtlasId() {
        for (const [atlasId, metadata] of this._atlasMetadata.entries()) {
            if (metadata.isImported) {
                return atlasId;
            }
        }
        return null;
    }

    /**
     * Resolve a layer (cascade atlas-level style / inspect / stylePresets,
     * but NOT headerImage or tags) onto the layer config.
     *
     * Cascade order for `style` and `inspect` (later wins; all shallow-merged):
     *   1. Atlas-level `style` / `inspect` (applied to every layer in the atlas)
     *   2. Named preset from atlas `stylePresets["<name>"]` (if layer sets `stylePreset`)
     *   3. Per-layer `style` / `inspect`
     *
     * A preset entry may carry both `style` and `inspect` keys, and either is optional.
     * Setting `inspect: false`/`null` on a layer disables interactivity and skips the
     * inspect cascade entirely.
     */
    _resolveLayer(layer, atlasId) {
        const atlasMetadata = this._atlasMetadata.get(atlasId);

        if (!atlasMetadata) {
            return layer;
        }

        const resolvedLayer = { ...layer };

        // Only cascade atlas properties if this is a complete layer definition (has type or title)
        // References to layers from other atlases (no type/title) should not get atlas properties
        const isCompleteDefinition = resolvedLayer.type || resolvedLayer.title;

        // Note: Atlas-level tags are NOT cascaded to layers
        // They are displayed as badges in the atlas header only
        // Layers only use explicitly defined tags

        // Note: Atlas-level headerImage is NOT cascaded to layers
        // Layers only use their own explicitly defined headerImage

        if (isCompleteDefinition) {
            // Resolve named style preset, if any
            let preset = null;
            if (resolvedLayer.stylePreset) {
                preset = atlasMetadata.stylePresets && atlasMetadata.stylePresets[resolvedLayer.stylePreset];
                if (!preset) {
                    console.warn(`[LayerRegistry] Unknown stylePreset "${resolvedLayer.stylePreset}" referenced by layer "${resolvedLayer.id}" in atlas "${atlasId}"`);
                }
            }

            // Cascade style: atlas defaults < preset < layer
            const atlasStyle = atlasMetadata.style;
            const presetStyle = preset && preset.style;
            if (atlasStyle || presetStyle) {
                resolvedLayer.style = {
                    ...(atlasStyle || {}),
                    ...(presetStyle || {}),
                    ...(resolvedLayer.style || {})
                };
            }

            // Cascade inspect: atlas defaults < preset < layer.
            // Skip when layer explicitly disables inspect with `false`/`null`.
            if (resolvedLayer.inspect !== false && resolvedLayer.inspect !== null) {
                const atlasInspect = atlasMetadata.inspect;
                const presetInspect = preset && preset.inspect;
                if (atlasInspect || presetInspect) {
                    resolvedLayer.inspect = {
                        ...(atlasInspect || {}),
                        ...(presetInspect || {}),
                        ...(resolvedLayer.inspect || {})
                    };
                }
            }
        }

        return resolvedLayer;
    }

    /**
     * Apply the atlas-level cascade (style, inspect, stylePresets)
     * to a layer config. Used by map-init for fully-defined layers loaded
     * directly from the active atlas, which don't pass through getLayer().
     * The bare-reference path (id-only layers) already gets the cascade via
     * the registry entry built in _doInitialize().
     */
    applyAtlasCascade(layer, atlasId) {
        return this._resolveLayer(layer, atlasId);
    }

    /**
     * Get a layer by ID, handling both prefixed and unprefixed IDs
     * @param {string} layerId - The layer ID (can be prefixed with atlas-)
     * @param {string} currentAtlas - The current atlas context (optional)
     * @param {boolean} silent - Suppress the "not found" warning (for callers that have a fallback)
     * @returns {object|null} The layer configuration
     */
    getLayer(layerId, currentAtlas = null, silent = false) {
        if (!layerId) return null;

        const contextAtlas = currentAtlas || this._currentAtlas;

        // First, try unprefixed ID in current atlas
        const currentAtlasId = `${contextAtlas}-${layerId}`;
        if (this._registry.has(currentAtlasId)) {
            return this._registry.get(currentAtlasId);
        }

        // Then try the ID as-is (might be prefixed)
        if (this._registry.has(layerId)) {
            return this._registry.get(layerId);
        }

        // Finally, fall back to the index atlas for shared/system layers
        // (e.g. 'selection', 'notes') that are defined once in index.atlas.json
        // but referenced from every atlas context.
        if (contextAtlas !== 'index') {
            const indexId = `index-${layerId}`;
            if (this._registry.has(indexId)) {
                return this._registry.get(indexId);
            }
        }

        if (!silent) {
            console.warn(`[LayerRegistry] Layer not found: ${layerId} (context: ${contextAtlas})`);
        }
        return null;
    }

    /**
     * Get all layers for a specific atlas
     */
    getAtlasLayers(atlasId) {
        return this._atlasLayers.get(atlasId) || [];
    }

    /**
     * Search layers across all atlases
     */
    searchLayers(searchTerm, excludeAtlas = null) {
        const results = [];
        const term = searchTerm.toLowerCase();

        for (const [prefixedId, layer] of this._registry.entries()) {
            // Skip layers from excluded atlas
            if (excludeAtlas && layer._sourceAtlas === excludeAtlas) {
                continue;
            }

            // Search in layer properties
            const matches =
                (layer.id && layer.id.toLowerCase().includes(term)) ||
                (layer.title && layer.title.toLowerCase().includes(term)) ||
                (layer.name && layer.name.toLowerCase().includes(term)) ||
                (layer.description && layer.description.toLowerCase().includes(term)) ||
                (layer.tags && Array.isArray(layer.tags) &&
                    layer.tags.some(tag => tag.toLowerCase().includes(term)));

            if (matches) {
                results.push(layer);
            }
        }

        return results;
    }

    /**
     * Tries to load a layer from a different config file based on a prefix
     * @param {string} layerId - The ID of the layer to load (e.g., 'prefix-layerName')
     * @param {Object} layerConfig - The initial configuration for the layer
     * @returns {Promise<Object|null>} The loaded layer configuration or null if not found
     */
    async tryLoadCrossConfigLayer(layerId, layerConfig) {
        // Parse the layer ID to extract potential config prefix
        const dashIndex = layerId.indexOf('-');
        if (dashIndex === -1) return null;

        const configPrefix = layerId.substring(0, dashIndex);
        const originalLayerId = layerId.substring(dashIndex + 1);

        // Try to load the config file
        try {
            const configPath = `config/${configPrefix}.atlas.json`;
            const configResponse = await fetch(configPath);

            if (!configResponse.ok) {
                return null;
            }

            const crossConfig = await configResponse.json();

            // Look for the layer in the cross-config
            if (crossConfig.layers && Array.isArray(crossConfig.layers)) {
                const foundLayer = crossConfig.layers.find(layer => layer.id === originalLayerId);

                if (foundLayer) {

                    // Create a merged layer with the prefixed ID and source config info
                    return {
                        ...foundLayer,
                        id: layerId, // Keep the prefixed ID
                        title: `${foundLayer.title} (${configPrefix})`, // Add config source to title
                        _sourceConfig: configPrefix,
                        _originalId: originalLayerId,
                        // Preserve important URL-specific properties
                        ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                        ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                        ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity })
                    };
                }
            }

            // Also check if we need to load the cross-config's library
            try {
                const libraryResponse = await fetch('config/_map-layer-presets.json');
                const layerLibrary = await libraryResponse.json();

                // Look for the original layer ID in the main library
                const libraryLayer = layerLibrary.layers.find(lib => lib.id === originalLayerId);

                if (libraryLayer) {

                    return {
                        ...libraryLayer,
                        id: layerId, // Keep the prefixed ID
                        title: `${libraryLayer.title} (${configPrefix})`, // Add config source to title
                        _sourceConfig: configPrefix,
                        _originalId: originalLayerId,
                        // Preserve important URL-specific properties
                        ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                        ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                        ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity })
                    };
                }
            } catch (libraryError) {
                // Ignore library loading errors
            }

            return null;

        } catch (error) {
            return null;
        }
    }

    /**
     * Normalize a layer ID for URL serialization
     * Removes atlas prefix if it matches current atlas
     */
    normalizeLayerId(layerId, currentAtlas = null) {
        const contextAtlas = currentAtlas || this._currentAtlas;
        const prefix = `${contextAtlas}-`;

        if (layerId.startsWith(prefix)) {
            return layerId.substring(prefix.length);
        }

        return layerId;
    }

    /**
     * Get the full prefixed ID for a layer
     */
    getPrefixedLayerId(layerId, atlasId = null) {
        const contextAtlas = atlasId || this._currentAtlas;

        // If already prefixed, return as-is
        if (layerId.includes('-')) {
            const potentialPrefix = layerId.split('-')[0];
            if (this._atlasLayers.has(potentialPrefix)) {
                return layerId;
            }
        }

        return `${contextAtlas}-${layerId}`;
    }

    /**
     * Check if two layer IDs refer to the same layer (accounting for prefixes)
     */
    isSameLayer(layerId1, layerId2) {
        const layer1 = this.getLayer(layerId1);
        const layer2 = this.getLayer(layerId2);

        if (!layer1 || !layer2) return false;

        // Compare the base IDs
        const baseId1 = layer1.id || layerId1;
        const baseId2 = layer2.id || layerId2;

        return baseId1 === baseId2;
    }

    /**
     * Get the current atlas ID
     */
    getCurrentAtlas() {
        return this._currentAtlas;
    }

    /**
     * Check if the registry is initialized
     */
    isInitialized() {
        return this._initialized;
    }

    /**
     * Get the current GeoIP data (populated from Cloudflare trace + ipapi.co at startup)
     * @returns {object|null} GeoIP data with { ip, countryCode, colo, lat, lng, city, region, country }
     */
    getGeoip() {
        return window.amche?.geoip || null;
    }

    /**
     * Get atlas metadata (color, name, etc.) by atlas ID
     * @param {string} atlasId - The atlas ID
     * @returns {object|null} The atlas metadata or null if not found
     */
    getAtlasMetadata(atlasId) {
        return this._atlasMetadata.get(atlasId) || null;
    }

    /**
     * Get the color for an atlas by ID
     * @param {string} atlasId - The atlas ID
     * @returns {string} The color hex code (defaults to blue if not found)
     */
    getAtlasColor(atlasId) {
        const metadata = this._atlasMetadata.get(atlasId);
        return metadata?.color || '#2563eb'; // Default to blue
    }

    /**
     * Extract bounding box from atlas config (supports bbox, map.bounds, and geojson)
     * @param {object} config - The atlas configuration object
     * @returns {array|null} Bounding box as [west, south, east, north] or null
     */
    _extractBbox(config) {
        // 1. Check for top-level bbox [west, south, east, north]
        if (config.bbox && Array.isArray(config.bbox) && config.bbox.length === 4) {
            return config.bbox;
        }

        // 2. Check for map.bounds format: [[west, south], [east, north]]
        if (config.map && config.map.bounds && Array.isArray(config.map.bounds)) {
            const bounds = config.map.bounds;
            if (bounds.length === 2 && Array.isArray(bounds[0]) && Array.isArray(bounds[1])) {
                const [sw, ne] = bounds;
                return [sw[0], sw[1], ne[0], ne[1]]; // Convert to [west, south, east, north]
            }
        }

        // 3. Fall back to geojson format
        if (config.geojson) {
            return this._extractBboxFromGeojson(config.geojson);
        }

        return null;
    }

    /**
     * Extract bounding box from GeoJSON
     * @param {object} geojson - The GeoJSON object
     * @returns {array|null} Bounding box as [west, south, east, north] or null
     */
    _extractBboxFromGeojson(geojson) {
        if (!geojson || !geojson.features || geojson.features.length === 0) {
            return null;
        }

        const feature = geojson.features[0];
        if (!feature.geometry || !feature.geometry.coordinates) {
            return null;
        }

        // For Polygon type, coordinates are [[[lon, lat], ...]]
        const coords = feature.geometry.coordinates[0];
        if (!coords || coords.length === 0) {
            return null;
        }

        // Calculate bbox from coordinates
        let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
        coords.forEach(([lon, lat]) => {
            west = Math.min(west, lon);
            south = Math.min(south, lat);
            east = Math.max(east, lon);
            north = Math.max(north, lat);
        });

        return [west, south, east, north];
    }

    /**
     * Check if a point (lng, lat) is within an atlas bbox
     * @param {string} atlasId - The atlas ID
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     * @returns {boolean} True if point is within bbox
     */
    isPointInAtlasBbox(atlasId, lng, lat) {
        const metadata = this._atlasMetadata.get(atlasId);
        if (!metadata || !metadata.bbox) {
            return false;
        }

        const [west, south, east, north] = metadata.bbox;
        return lng >= west && lng <= east && lat >= south && lat <= north;
    }
}
