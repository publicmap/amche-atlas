import { DataUtils, GeoUtils } from './map-utils.js';
import { CameraUtils } from './map-camera-utils.js';
import { KMLConverter } from './kml-converter.js';
import { LayerConfigGenerator } from './layer-creator-ui.js';
import { StreamingGPKGReader } from './streaming-gpkg-reader.js';
import { AllmapsAPI } from './allmaps-url-api.js';
import { OSMApi } from './osm-url-api.js';

export class MapCreator {
    constructor() {
        this.currentData = null;
        this.currentGeometryType = null;
        this.currentDataSource = null;
        this.currentLayerType = null;
        // Config JSON textarea can be hand-edited; this holds those edits for
        // geojson/csv layers (whose currentData holds the raw data, not the config).
        // Tile-type layers (vector/tms/wms/...) don't need this since
        // currentData already *is* the config object.
        this._layerConfigOverride = null;
        this._originalTileConfig = null;
        // OSM layers only: 'dynamic' (default) keeps a tiny {type:'osm', id}
        // reference that's re-fetched from Overpass on every load (see
        // dynamic-layer-shorthand.js); 'static' embeds the full geometry in
        // this.currentData like any other geojson layer. See
        // getOsmDynamicConfig()/updateOsmDataModeUI().
        this._dataMode = 'dynamic';
        this._osmRef = null;
        // True once the user has manually toggled a Point/Line/Area/Label
        // checkbox — turns off auto-detection until the next data load.
        this._styleTypesUserModified = false;
        // True once the user has hand-edited the Configuration JSON — the
        // style checkboxes/pickers stop overwriting config.style until the
        // user touches one of them again (see setupEventListeners).
        this._styleManuallyEdited = false;
    }

    init() {
        this.setupEventListeners();
        this.setupColorPickers();
        this.setupMessageListener();
        window.parent.postMessage({ type: 'creator-ready' }, '*');
    }

    setupMessageListener() {
        window.addEventListener('message', async (event) => {
            if (event.data.type === 'bounds-update' && Array.isArray(event.data.bounds)) {
                this._parentBounds = event.data.bounds;
                return;
            }
            if (event.data.type === 'creator-tile-info') {
                this._handleTileInfoDetected(event.data.geometryTypes || [], event.data.fields || []);
                return;
            }
            if (event.data.type === 'load-file-data') {
                const { fileName, content, arrayBuffer } = event.data;
                const ext = fileName.split('.').pop().toLowerCase();
                this.showSelectedFile(fileName);
                try {
                    let geojson;
                    if (ext === 'gpkg') {
                        geojson = await this.parseGPKG(arrayBuffer);
                    } else if (ext === 'zip') {
                        geojson = await this.parseShapefile(arrayBuffer);
                    } else if (ext === 'kml') {
                        geojson = await KMLConverter.kmlToGeoJson(content);
                    } else if (ext === 'csv') {
                        const rows = DataUtils.parseCSV(content);
                        if (!rows || rows.length === 0) throw new Error('CSV file is empty');
                        geojson = GeoUtils.rowsToGeoJSON(rows);
                        if (!geojson) throw new Error('Could not find lat/lng columns in CSV');
                    } else if (ext === 'geojsonl' || ext === 'ndjson' || ext === 'jsonl') {
                        geojson = this.parseGeoJSONL(content);
                    } else {
                        geojson = JSON.parse(content);
                        if (!geojson.type || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
                            throw new Error('Invalid GeoJSON format');
                        }
                    }
                    this.processGeoJSON(geojson, fileName);
                } catch (error) {
                    alert('Parse error: ' + error.message);
                }
            }
        });
    }

    showSelectedFile(fileName) {
        $('#selected-file-name').text(fileName);
        $('#selected-file-info').removeClass('hidden');
    }

    clearSelectedFile() {
        $('#file-input').val('');
        $('#selected-file-info').addClass('hidden');
        $('#selected-file-name').text('');
        $('#georef-notice').addClass('hidden');
    }

    setupEventListeners() {
        $('#load-data-btn').on('click', () => this.handleLoadData());

        let urlInputTimeout;
        $('#url-input').on('input', (e) => {
            clearTimeout(urlInputTimeout);
            let url = e.target.value.trim();

            if (url) {
                $('#clear-url-btn').removeClass('hidden');
                const fileInput = $('#file-input')[0];
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    this.clearSelectedFile();
                }
            } else {
                $('#clear-url-btn').addClass('hidden');
                $('#url-validation').html('');
                return;
            }

            url = this.normalizeGoogleSheetsUrl(url);
            const validFormat = this.detectUrlFormat(url);
            $('.format-chip').removeClass('active-format');

            if (validFormat) {
                const formatMap = {
                    'CSV': 'csv',
                    'GeoJSON': 'geojson',
                    'KML': 'kml',
                    'Vector Tiles': 'vector-tiles',
                    'Raster Tiles': 'raster-tiles',
                    'MapWarper': 'mapwarper',
                    'Allmaps': 'allmaps',
                    'OSM': 'osm',
                    'Amche Atlas JSON': 'atlas-json',
                    'WMS': 'wms',
                    'Bharatlas': 'bharatlas',
                    'Overpass': 'overpass'
                };
                const formatKey = formatMap[validFormat];
                if (formatKey) {
                    $(`.format-chip[data-format="${formatKey}"]`).addClass('active-format');
                }
                urlInputTimeout = setTimeout(() => {
                    this.handleLoadData();
                }, 1000);
            } else if (this.isValidDataUrl(url)) {
                urlInputTimeout = setTimeout(() => {
                    this.handleLoadData();
                }, 1000);
            } else {
                $('#url-validation').html(`<span class="text-red-600 text-xs">Unsupported</span>`);
            }
        });

        $('#clear-url-btn').on('click', () => {
            $('#url-input').val('').focus();
            $('#clear-url-btn').addClass('hidden');
            $('#url-validation').html('');
            $('#data-preview-details').hide();
            $('#settings-section').hide();
            this.setLoadingState('default');
            $('.format-chip').removeClass('active-format');
            this._resetConfigEditorState();
            this.clearPreview();
        });

        $('#upload-file-btn').on('click', () => {
            $('#file-input').trigger('click');
        });

        $('#clear-file-btn').on('click', () => {
            this.clearSelectedFile();
            $('#data-preview-details').hide();
            $('#settings-section').hide();
            this.setLoadingState('default');
            this._resetConfigEditorState();
            this.clearPreview();
        });

        $('#file-input').on('change', (e) => {
            if (e.target.files.length > 0) {
                $('#url-input').val('');
                $('#clear-url-btn').addClass('hidden');
                $('#url-validation').html('');
                $('.format-chip').removeClass('active-format');
                this.showSelectedFile(e.target.files[0].name);
            }
            this.handleFileUpload(e);
        });

        $('#preview-geojson-io-btn').on('click', () => this.previewOnGeojsonIO());
        $('#download-geojson-btn').on('click', () => this.downloadGeoJSON());

        $('.style-color-input').on('input', (e) => {
            $(e.target).siblings('.color-preview').css('background-color', e.target.value);
            this._styleManuallyEdited = false;
            this.updateConfigPreview();
        });

        $('.style-control').on('input', (e) => {
            $(`#${e.target.id}-value`).text(e.target.value);
            this._styleManuallyEdited = false;
            this.updateConfigPreview();
        });

        $('.style-type-checkbox').on('change', () => {
            this._styleTypesUserModified = true;
            this._styleManuallyEdited = false;
            this.updateStyleSectionVisibility();
            this.updateConfigPreview();
        });

        $('#label-field-select').on('change', () => {
            this._styleManuallyEdited = false;
            this.updateConfigPreview();
        });

        $('#layer-title').on('input', (e) => {
            const title = e.target.value.trim();
            if (title) {
                $('#layer-id').val(this.generateId(title));
            }
            this.updateConfigPreview();
        });

        $('#layer-id, #layer-description, #layer-attribution').on('input', () => {
            this.updateConfigPreview();
        });

        $('#layer-type').on('change', () => {
            this.updateConfigPreview();
        });

        $('input[name="osm-data-mode"]').on('change', (e) => {
            this._dataMode = e.target.value;
            this.applyOsmDataModeFieldState();
            if (this._dataMode === 'static' && this._originalTileConfig) {
                this.currentData = JSON.parse(JSON.stringify(this._originalTileConfig));
            }
            this.updateConfigPreview();
        });

        $('#add-to-map-btn').on('click', () => this.addToMap());
        $('#cancel-btn, #back-btn').on('click', () => this.returnToBrowser());
        $('#close-btn').on('click', () => this.closeBrowser());

        $('.color-preview').on('click', function() {
            $(this).siblings('input[type="color"]').click();
        });

        $('.format-chip').on('click', (e) => {
            const $chip = $(e.currentTarget);
            const sampleUrl = $chip.data('sample');
            if (!sampleUrl) return;
            this.clearSelectedFile();

            if ($chip.data('format') === 'overpass') {
                this.showOverpassSection();
                $('#overpass-query').val(this.getSampleOverpassQuery()).trigger('input').focus();
                $('.format-chip').removeClass('active-format');
                $chip.addClass('active-format');
                return;
            }

            $('#url-input').val(sampleUrl).trigger('input').focus();
        });

        $('#overpass-query').on('input', () => {
            clearTimeout(this._overpassDebounce);
            const text = $('#overpass-query').val().trim();
            if (!text) {
                $('#overpass-status').text('');
                return;
            }
            this._overpassDebounce = setTimeout(() => {
                this.handleOverpassImport(text);
            }, 800);
        });

        $('#overpass-clear-btn').on('click', () => {
            $('#overpass-query').val('');
            $('#overpass-status').text('');
            this.hideOverpassSection();
        });

        $('#feature-id-field, #feature-name-field').on('change', () => {
            this.updateConfigPreview();
        });

        $('#enable-save-notes').on('change', (e) => {
            $('#save-notes-details').toggle(e.target.checked);
            this.updateConfigPreview();
        });

        $('#save-url-input').on('input', () => {
            this.updateConfigPreview();
        });

        $('#inspect-fields-list').on('change', 'input[type="checkbox"]', () => {
            this.updateInspectFieldsToggleLabel();
            this.updateConfigPreview();
        });

        $('#inspect-fields-toggle-all-btn').on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $checkboxes = $('#inspect-fields-list input[type="checkbox"]');
            const allChecked = $checkboxes.length > 0 && $checkboxes.filter(':checked').length === $checkboxes.length;
            $checkboxes.prop('checked', !allChecked);
            this.updateInspectFieldsToggleLabel();
            this.updateConfigPreview();
        });

        $('#include-bbox-checkbox').on('change', () => {
            this.updateConfigPreview();
        });

        let configEditTimeout;
        $('#config-preview').on('input', () => {
            clearTimeout(configEditTimeout);
            configEditTimeout = setTimeout(() => this.handleConfigJSONEdit(), 300);
        });

        $('#reset-config-json-btn').on('click', () => this.resetConfigOverride());

        $('#copy-inline-btn').on('click', () => {
            const url = $('#inline-url').val();
            window.amcheAnalytics?.trackEvent('share_action', { method: 'copy_map_url' });
            navigator.clipboard.writeText(url).then(() => {
                const $btn = $('#copy-inline-btn');
                $btn.text('Copied!').removeClass('bg-blue-600 hover:bg-blue-700').addClass('bg-green-600');
                setTimeout(() => {
                    $btn.text('Copy').removeClass('bg-green-600').addClass('bg-blue-600 hover:bg-blue-700');
                }, 2000);
            });
        });
    }

    handleConfigJSONEdit() {
        const text = $('#config-preview').val();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            $('#config-json-status').html(`<span style="color:#f87171;">✗ Invalid JSON — ${error.message}</span>`);
            return;
        }

        $('#config-json-status').html('<span style="color:#86efac;">✓ Valid — live preview updated</span>');
        $('#reset-config-json-btn').removeClass('hidden');

        if (parsed.type) {
            this.currentLayerType = parsed.type;
        }

        if (parsed.style !== undefined) {
            this._styleManuallyEdited = true;
        }

        if (this.currentLayerType === 'geojson' || this.currentLayerType === 'csv') {
            this._layerConfigOverride = parsed;
        } else {
            this.currentData = parsed;
        }

        if (parsed.title !== undefined) $('#layer-title').val(parsed.title);
        if (parsed.id !== undefined) $('#layer-id').val(parsed.id);
        if (parsed.type !== undefined) $('#layer-type').val(parsed.type);
        if (parsed.description !== undefined) $('#layer-description').val(parsed.description);
        if (parsed.attribution !== undefined) $('#layer-attribution').val(parsed.attribution);

        const baseUrl = window.location.origin + window.location.pathname;
        const configJson = JSON.stringify(parsed).replace(/"/g, "'");
        $('#inline-url').val(`${baseUrl}?layers=${encodeURIComponent(configJson)}`);

        $('#add-to-map-btn').prop('disabled', false);
        this.schedulePreview();
    }

    resetConfigOverride() {
        if (this._originalTileConfig && this.currentLayerType !== 'geojson' && this.currentLayerType !== 'csv') {
            this.currentData = JSON.parse(JSON.stringify(this._originalTileConfig));
        }
        this._resetConfigEditorState();
        this.updateConfigPreview();
    }

    _resetConfigEditorState() {
        this._layerConfigOverride = null;
        this._styleManuallyEdited = false;
        this._styleTypesUserModified = false;
        this._lastLabelFieldsKey = undefined;
        $('#config-json-status').html('');
        $('#reset-config-json-btn').addClass('hidden');
    }

    getDefaultIdField(fields) {
        const idPriority = ['id', 'fid', 'gid', 'objectid', 'objectid1', 'featureid', 'feature_id', 'osm_id', 'uid', '_id'];
        for (const field of idPriority) {
            const found = fields.find(f => f.toLowerCase() === field);
            if (found) return found;
        }
        return fields[0] || 'id';
    }

    getDefaultNameField(fields) {
        const namePriority = ['name', 'title', 'label', 'description', 'desc', 'place_name', 'location', 'address'];
        for (const field of namePriority) {
            const found = fields.find(f => f.toLowerCase() === field);
            if (found) return found;
        }
        return fields[0] || 'name';
    }

    getDefaultInspectFields(fields, limit = 3) {
        const inspectPriority = ['name', 'title', 'label', 'description', 'url', 'website', 'wikidata', 'id'];
        const matched = [];
        for (const candidate of inspectPriority) {
            const found = fields.find(f => f.toLowerCase() === candidate);
            if (found && !matched.includes(found)) matched.push(found);
            if (matched.length >= limit) break;
        }
        return matched;
    }

    getDefaultLatField(fields) {
        const latPatterns = ['lat', 'latitude', 'y', 'northing', 'lat_dd', 'decimal_latitude', 'gps_lat', 'geo_lat', 'point_y', 'coord_y'];

        for (const pattern of latPatterns) {
            const found = fields.find(f => f.toLowerCase().trim() === pattern);
            if (found) return found;
        }

        for (const pattern of latPatterns) {
            const found = fields.find(f => f.toLowerCase().trim().includes(pattern));
            if (found) return found;
        }

        return '';
    }

    getDefaultLonField(fields) {
        const lonPatterns = ['lon', 'lng', 'longitude', 'long', 'x', 'easting', 'lon_dd', 'lng_dd', 'decimal_longitude', 'gps_lon', 'gps_lng', 'geo_lon', 'geo_lng', 'point_x', 'coord_x'];

        for (const pattern of lonPatterns) {
            const found = fields.find(f => f.toLowerCase().trim() === pattern);
            if (found) return found;
        }

        for (const pattern of lonPatterns) {
            const found = fields.find(f => f.toLowerCase().trim().includes(pattern));
            if (found) return found;
        }

        return '';
    }

    detectUrlFormat(url) {
        const urlLower = url.toLowerCase();

        if (this.isOverpassShareUrl(url)) {
            return 'Overpass';
        }
        if (this.isBharatlasUrl(url)) {
            return 'Bharatlas';
        }
        if (this.isGistUrl(url)) {
            return 'GeoJSON';
        }
        if (this.isWMSUrl(url)) {
            return 'WMS';
        }
        if (this.isCSVUrl(url)) {
            return 'CSV';
        }
        if (AllmapsAPI.isAllmapsUrl(url)) {
            return 'Allmaps';
        }
        if (OSMApi.isOsmUrl(url)) {
            return 'OSM';
        }
        if (urlLower.includes('jsonkeeper.com/b/')) {
            return 'Amche Atlas JSON';
        }
        if (urlLower.endsWith('.geojson')) {
            return 'GeoJSON';
        }
        if (urlLower.endsWith('.json')) {
            return 'Amche Atlas JSON';
        }
        if (urlLower.endsWith('.kml')) {
            return 'KML';
        }
        if (urlLower.endsWith('.geojsonl') || urlLower.endsWith('.ndjson') || urlLower.endsWith('.jsonl')) {
            return 'GeoJSONL';
        }
        if (urlLower.endsWith('.gpkg')) {
            return 'GeoPackage';
        }
        if (urlLower.endsWith('.zip')) {
            return 'Shapefile';
        }
        if (urlLower.includes('{z}') && (urlLower.includes('.pbf') || urlLower.includes('.mvt'))) {
            return 'Vector Tiles';
        }
        if (urlLower.includes('{z}') && (urlLower.includes('.png') || urlLower.includes('.jpg'))) {
            return 'Raster Tiles';
        }
        if (urlLower.includes('{x}') && urlLower.includes('{y}') && urlLower.includes('{z}')) {
            return 'Raster Tiles';
        }
        if (/\/\d+\/\d+\/\d+\.(pbf|mvt)($|\?)/i.test(url)) {
            return 'Vector Tiles';
        }
        if (/\/\d+\/\d+\/\d+(\.(png|jpg|jpeg|webp))?($|\?)/i.test(url)) {
            return 'Raster Tiles';
        }
        if (urlLower.includes('mapwarper.net/maps/') || urlLower.includes('warper.wmflabs.org/maps/')) {
            return 'MapWarper';
        }
        return null;
    }

    isGistUrl(url) {
        if (!url) return false;
        return /^https?:\/\/gist\.github\.com\/(?:[^/]+\/)?[0-9a-f]{16,}/i.test(url);
    }

    async resolveGistRawUrl(url) {
        const match = url.match(/^https?:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{16,})/i);
        if (!match) return url;

        const response = await fetch(`https://api.github.com/gists/${match[1]}`);
        if (!response.ok) {
            throw new Error(`Could not resolve Gist (${response.status})`);
        }
        const data = await response.json();
        const files = Object.values(data.files || {});
        if (files.length === 0) {
            throw new Error('Gist has no files');
        }

        const geoFile = files.find(f => /\.(geojson|json|csv|kml|geojsonl|ndjson|jsonl)$/i.test(f.filename));
        return (geoFile || files[0]).raw_url;
    }

    isBharatlasUrl(url) {
        if (!url) return false;
        const urlLower = url.toLowerCase();
        if (!urlLower.includes('bharatlas.com')) return false;
        if (/bharatlas\.com\/c\/[a-z0-9]+/i.test(url)) return true;
        if (/bharatlas\.com\/api\/r2\/community\/[a-z0-9]+\//i.test(url)) return true;
        return false;
    }

    parseBharatlasUrl(url) {
        const communityMatch = url.match(/bharatlas\.com\/c\/([A-Za-z0-9]+)/i);
        if (communityMatch) {
            return { communityId: communityMatch[1], pageUrl: `https://bharatlas.com/c/${communityMatch[1]}`, geojsonUrl: null };
        }
        const apiMatch = url.match(/bharatlas\.com\/api\/r2\/community\/([A-Za-z0-9]+)\/([^?#]+)/i);
        if (apiMatch) {
            return {
                communityId: apiMatch[1],
                pageUrl: `https://bharatlas.com/c/${apiMatch[1]}`,
                geojsonUrl: url
            };
        }
        return null;
    }

    parseBharatlasPage(html, fallbackPageUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const titleEl = doc.querySelector('h2');
        const descEl = doc.querySelector('p.desc');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const description = descEl ? descEl.textContent.trim() : '';

        let geojsonUrl = null;
        const downloadLink = doc.querySelector('.actions a[download], .actions a.btn[href*="/api/"]');
        if (downloadLink) {
            const href = downloadLink.getAttribute('href');
            geojsonUrl = href.startsWith('http') ? href : `https://bharatlas.com${href}`;
        }

        let sourceText = '';
        let sourceUrl = '';
        let attributionText = '';
        const dts = doc.querySelectorAll('dl.kv dt');
        dts.forEach(dt => {
            const label = (dt.textContent || '').trim().toLowerCase();
            const dd = dt.nextElementSibling;
            if (!dd) return;
            if (label === 'source') {
                const a = dd.querySelector('a');
                if (a) {
                    sourceUrl = a.getAttribute('href') || '';
                    sourceText = (a.textContent || '').trim();
                } else {
                    sourceText = (dd.textContent || '').trim();
                }
            } else if (label === 'attribution') {
                attributionText = (dd.textContent || '').trim();
            }
        });

        return {
            title,
            description,
            geojsonUrl,
            sourceText,
            sourceUrl,
            attributionText,
            pageUrl: fallbackPageUrl
        };
    }

    buildBharatlasAttribution(meta) {
        const label = meta.attributionText || meta.sourceText || 'Source';
        const labelPart = meta.sourceUrl
            ? `<a href='${meta.sourceUrl}'>${label}</a>`
            : label;
        const viaPart = meta.pageUrl
            ? ` via <a href='${meta.pageUrl}'>bharatlas community</a>`
            : '';
        return `${labelPart}${viaPart}`;
    }

    async handleBharatlasImport(url) {
        const parsed = this.parseBharatlasUrl(url);
        if (!parsed) {
            throw new Error('Unrecognized bharatlas URL');
        }

        const pageResp = await fetch(parsed.pageUrl);
        if (!pageResp.ok) {
            throw new Error(`Could not fetch bharatlas page (${pageResp.status})`);
        }
        const html = await pageResp.text();
        const meta = this.parseBharatlasPage(html, parsed.pageUrl);

        const geojsonUrl = parsed.geojsonUrl || meta.geojsonUrl;
        if (!geojsonUrl) {
            throw new Error('Could not find GeoJSON download URL on bharatlas page');
        }
        meta.geojsonUrl = geojsonUrl;

        const geojsonResp = await fetch(geojsonUrl);
        if (!geojsonResp.ok) {
            throw new Error(`Could not fetch bharatlas GeoJSON (${geojsonResp.status})`);
        }
        const geojson = await geojsonResp.json();

        this.processGeoJSON(geojson, geojsonUrl);

        if (meta.title) {
            $('#layer-title').val(meta.title);
            $('#layer-id').val(this.generateId(meta.title));
        }
        if (meta.description) {
            $('#layer-description').val(meta.description);
        }
        const attribution = this.buildBharatlasAttribution(meta);
        if (attribution) {
            $('#layer-attribution').val(attribution);
        }

        this.updateConfigPreview();
    }

    isWMSUrl(url) {
        const urlLower = url.toLowerCase();
        if (urlLower.includes('service=wms')) {
            return true;
        }
        if (urlLower.includes('/wms') && (urlLower.includes('request=getmap') || urlLower.includes('getmap'))) {
            return true;
        }
        return false;
    }

    createWMSConfig(url) {
        const urlParts = url.split('?');
        const baseUrl = urlParts[0];
        const params = new URLSearchParams(urlParts[1] || '');

        const paramsObj = {};
        for (const [key, value] of params.entries()) {
            paramsObj[key.toLowerCase()] = value;
        }

        const layers = paramsObj.layers || paramsObj.layer || '';
        const version = paramsObj.version || '1.3.0';
        const format = paramsObj.format || 'image/png';
        const srs = paramsObj.srs || paramsObj.crs || 'EPSG:3857';

        const title = layers.split(':').pop() || 'WMS Layer';
        const id = this.generateId(title);

        return {
            id: id,
            title: title,
            type: 'wms',
            url: url,
            tileSize: parseInt(paramsObj.width || paramsObj.height || '256'),
            maxzoom: 18,
            srs: srs,
            attribution: baseUrl
        };
    }

    isOverpassShareUrl(url) {
        if (!url) return false;
        return /^https?:\/\/overpass-turbo\.eu\/s\/[A-Za-z0-9_-]+\/?$/i.test(url.trim());
    }

    parseOverpassShareId(url) {
        const m = url.trim().match(/overpass-turbo\.eu\/s\/([A-Za-z0-9_-]+)/i);
        return m ? m[1] : null;
    }

    looksLikeOverpassQuery(text) {
        if (!text) return false;
        const t = text.trim();
        if (t.length < 4) return false;
        // Strong signals — any one of these and we treat it as Overpass QL.
        if (/\[out\s*:/i.test(t)) return true;
        if (/\bout\s+(body|geom|skel|center|count|meta|tags|ids)\b/i.test(t)) return true;
        if (/\{\{\s*bbox\s*\}\}/.test(t)) return true;
        if (/\bnwr\s*\[/i.test(t)) return true;
        if (/\b(node|way|relation|rel)\s*\[["']/i.test(t)) return true;
        if (/\[\s*bbox\s*:/i.test(t)) return true;
        return false;
    }

    extractOverpassQuery(text) {
        // Strip leading/trailing whitespace; the loader will inject [out:json]
        // if no settings block is present, so we can pass the body through.
        // Replace bbox forms that Overpass-Turbo uses but our loader doesn't
        // recognize. Turbo accepts a literal "{{bbox}}" expansion at runtime;
        // we use the same placeholder, so no rewrite is needed.
        let q = String(text).trim();
        // Normalize CRLF -> LF for cleaner storage in the URL config preview.
        q = q.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        return q;
    }

    getSampleOverpassQuery() {
        return [
            '[out:json][timeout:25];',
            '// Cafés in the current viewport',
            'nwr["amenity"="cafe"]({{bbox}});',
            'out geom;'
        ].join('\n');
    }

    showOverpassSection() {
        $('#overpass-section').removeClass('hidden');
        $('#data-preview-details').hide();
    }

    hideOverpassSection() {
        $('#overpass-section').addClass('hidden');
    }

    async resolveOverpassShareUrl(url) {
        // Browsers cannot read cross-origin redirect Location headers (the
        // response becomes opaqueredirect), so we route through the Railway-
        // hosted proxy server which resolves the redirect server-side and
        // returns the underlying Overpass QL query.
        const id = this.parseOverpassShareId(url);
        if (!id) throw new Error('Invalid Overpass Turbo share URL');

        $('#overpass-status').text('Resolving share URL…');

        const response = await fetch(`https://amche-atlas-production.up.railway.app/overpass-share?id=${encodeURIComponent(id)}`);

        if (!response.ok) {
            let errMsg = `HTTP ${response.status}`;
            try {
                const errBody = await response.json();
                if (errBody.error) errMsg = errBody.error;
            } catch (_) { /* ignore */ }
            throw new Error(`Could not resolve share URL: ${errMsg}. Open the URL in overpass-turbo.eu and paste the query text here instead.`);
        }

        const data = await response.json();
        if (!data.query) {
            throw new Error(data.error || 'Empty response from resolver');
        }
        return data.query;
    }

    extractOverpassWizardSearch(query) {
        // Overpass-Turbo wizard queries embed the original search string in a
        // leading /* */ block, between curly (or straight) quotes:
        //   The original search was:
        //   “cafe”
        const m = query.match(/original search was:\s*\n\s*[“"']([^”"'\n]+)[”"']/i);
        return m ? m[1].trim() : null;
    }

    createOverpassConfig(query, sourceUrl) {
        const id = `overpass-${Math.floor(Math.random() * 90) + 10}`;
        const title = 'OSM Overpass API Query';

        const wizardSearch = this.extractOverpassWizardSearch(query);
        let description = 'Live OpenStreetMap features fetched from the Overpass API; refreshes as the viewport changes.';
        if (wizardSearch) {
            description = `Live OSM features matching <code>${wizardSearch}</code>, fetched from the Overpass API as the viewport changes.`;
        }
        if (sourceUrl) {
            description += ` Source query: <a href='${sourceUrl}' target='_blank'>${sourceUrl}</a>.`;
        }

        const viaLink = sourceUrl
            ? `<a href='${sourceUrl}'>Overpass Turbo</a>`
            : `<a href='https://overpass-api.de/'>Overpass API</a>`;
        const attribution = `© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a> via ${viaLink}`;

        return {
            id,
            title,
            type: 'overpass',
            description,
            query,
            minzoom: 13,
            attribution,
            style: {
                'circle-color': '#10b981',
                'circle-radius': 5,
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 1,
                'line-color': '#10b981',
                'line-width': 2,
                'fill-color': 'rgba(16,185,129,0.25)'
            },
            inspect: {
                id: 'id',
                title: wizardSearch || 'OSM Feature',
                label: 'name'
            },
            _sourceUrl: sourceUrl || undefined
        };
    }

    async handleOverpassImport(input, { withPreview = false } = {}) {
        const raw = String(input || '').trim();
        if (!raw) return;

        this.showOverpassSection();

        try {
            let query;
            let sourceUrl;
            if (this.isOverpassShareUrl(raw)) {
                sourceUrl = raw;
                query = await this.resolveOverpassShareUrl(raw);
                $('#overpass-query').val(query);
            } else if (this.looksLikeOverpassQuery(raw)) {
                query = this.extractOverpassQuery(raw);
            } else {
                $('#overpass-status').html('<span style="color:#fca5a5;">Not a recognized Overpass query or share URL.</span>');
                return;
            }

            const config = this.createOverpassConfig(query, sourceUrl);
            this.currentLayerType = 'overpass';
            this.currentData = config;
            this.currentDataSource = sourceUrl || null;
            this.showTileLayerSuccess(config);

            if (withPreview) {
                await this.previewOverpassData(query, config);
            } else {
                $('#overpass-status').html(`<span style="color:#a7f3d0;">✓ Query loaded. Click <strong>Load Data →</strong> to preview, or <strong>Add Map Layer</strong> to add it.</span>`);
            }
        } catch (error) {
            console.error('[MapCreator] Overpass import failed:', error);
            $('#overpass-status').html(`<span style="color:#fca5a5;">${error.message}</span>`);
            this.setLoadingState('error');
        }
    }

    async previewOverpassData(query, config) {
        if (!this._parentBounds || this._parentBounds.length !== 4) {
            $('#overpass-status').html('<span style="color:#fbbf24;">⚠ Pan the parent map under this panel once so a viewport bbox is available, then click Load Data again.</span>');
            return;
        }
        $('#overpass-status').html('<span style="color:#a7f3d0;">Fetching preview from Overpass…</span>');

        try {
            const [w, s, e, n] = this._parentBounds;
            let q = String(query)
                .replace(/\{\{\s*bbox\s*\}\}/g, `${s},${w},${n},${e}`)
                .replace(/\{\{\s*center\s*\}\}/g, `${(s + n) / 2},${(w + e) / 2}`);
            // Only inject [out:json][timeout:N]; if the query has no [out:...]
            // setting block at all. Looking for the literal "[out:" anywhere
            // is enough — Overpass QL puts all settings inside [...] blocks.
            // Checking only the leading char misses queries that start with a
            // /* ... */ comment (the overpass-turbo wizard format).
            if (!/\[\s*out\s*:/i.test(q)) {
                q = `[out:json][timeout:25];${q}`;
            }

            const resp = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(q)
            });
            if (!resp.ok) {
                if (resp.status === 429 || resp.status === 504) {
                    throw new Error(`Overpass is rate-limiting (HTTP ${resp.status}). Wait a moment and try again.`);
                }
                throw new Error(`Overpass HTTP ${resp.status}`);
            }
            const osmJson = await resp.json();

            const { default: osmtogeojson } = await import('https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0-beta.5/+esm');
            const geojson = osmtogeojson(osmJson);
            const features = geojson.features || [];
            if (features.length === 0) {
                $('#overpass-status').html('<span style="color:#fbbf24;">⚠ Query returned no features in the current viewport.</span>');
                return;
            }

            const bbox = this.calculateBBox(geojson);
            const geometryType = this.detectGeometryType(geojson);

            window.parent.postMessage({
                type: 'creator-preview',
                geojson,
                style: config.style,
                geometryType,
                bbox,
                fitBounds: false
            }, '*');

            $('#overpass-status').html(`<span style="color:#a7f3d0;">✓ Previewing ${features.length} feature${features.length === 1 ? '' : 's'}. Click <strong>Add Map Layer</strong> to add it.</span>`);
        } catch (error) {
            console.error('[MapCreator] Overpass preview failed:', error);
            $('#overpass-status').html(`<span style="color:#fca5a5;">Preview failed: ${error.message}</span>`);
        }
    }

    setupColorPickers() {
        const defaultGeoJSON = {
            type: 'FeatureCollection',
            features: []
        };
        $('#geojson-editor').val(JSON.stringify(defaultGeoJSON, null, 2));
    }

    handleLoadData() {
        const url = $('#url-input').val().trim();
        const fileInput = $('#file-input')[0];
        const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;
        const overpassText = $('#overpass-query').val().trim();
        const overpassSectionOpen = !$('#overpass-section').hasClass('hidden');

        if (url) {
            this.handleURLImport();
        } else if (hasFile) {
            this.handleFileUpload({ target: fileInput });
        } else if (overpassSectionOpen && overpassText) {
            this.handleOverpassImport(overpassText, { withPreview: true });
        } else {
            alert('Paste a URL or upload a file to load data');
        }
    }

    normalizeGoogleSheetsUrl(url) {
        if (!url.includes('docs.google.com/spreadsheets')) {
            return url;
        }

        const urlLower = url.toLowerCase();

        if (urlLower.includes('/pubhtml')) {
            return url.replace(/\/pubhtml.*$/i, '/pub?output=csv');
        }

        if (urlLower.includes('/pub')) {
            return url.replace(/\/pub(\?.*)?$/i, (match, queryString) => {
                if (queryString && queryString.includes('output=csv')) {
                    return match;
                }
                return '/pub?output=csv';
            });
        }

        const editMatch = url.match(/^(https?:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+)\/edit(?:\?([^#]*))?(?:#(.*))?$/i);
        if (editMatch) {
            const [, base, queryString, hash] = editMatch;
            let gid = null;
            if (queryString) {
                const params = new URLSearchParams(queryString);
                gid = params.get('gid');
            }
            if (!gid && hash) {
                const hashMatch = hash.match(/gid=(\d+)/);
                if (hashMatch) gid = hashMatch[1];
            }
            return `${base}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
        }

        return url;
    }

    parseGoogleSheetsHTML(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const table = doc.querySelector('table.waffle');
        if (!table) {
            throw new Error('No Google Sheets data table found in HTML response');
        }

        const extractCells = (tr) => Array.from(tr.querySelectorAll('td')).map(td => {
            td.querySelectorAll('br').forEach(br => br.replaceWith(' '));
            return td.textContent.replace(/\s+/g, ' ').trim();
        });

        const trs = Array.from(table.querySelectorAll('tbody tr'));
        if (trs.length < 2) {
            throw new Error('Google Sheets HTML has no data rows');
        }

        const rawHeaders = extractCells(trs[0]);
        let lastIdx = rawHeaders.length - 1;
        while (lastIdx >= 0 && !rawHeaders[lastIdx]) lastIdx--;
        const headers = rawHeaders.slice(0, lastIdx + 1);
        if (!headers.length) {
            throw new Error('Google Sheets HTML has no header row');
        }

        return trs.slice(1)
            .map(tr => {
                const cells = extractCells(tr);
                const row = {};
                headers.forEach((h, i) => { row[h] = cells[i] || ''; });
                return row;
            })
            .filter(row => Object.values(row).some(v => v !== ''));
    }

    isCSVUrl(url) {
        const urlLower = url.toLowerCase();
        if (urlLower.endsWith('.csv')) {
            return true;
        }
        if (urlLower.includes('output=csv')) {
            return true;
        }
        if (urlLower.includes('docs.google.com/spreadsheets')) {
            return true;
        }
        return false;
    }

    isValidDataUrl(url) {
        if (!url || url.length < 10) return false;

        const urlLower = url.toLowerCase();

        if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://') && !urlLower.startsWith('mapbox://')) {
            return false;
        }

        if (this.isOverpassShareUrl(url)) return true;
        if (this.isBharatlasUrl(url)) return true;
        if (this.isGistUrl(url)) return true;
        if (this.isWMSUrl(url)) return true;
        if (this.isCSVUrl(url)) return true;
        if (AllmapsAPI.isAllmapsUrl(url)) return true;
        if (OSMApi.isOsmUrl(url)) return true;
        if (urlLower.includes('jsonkeeper.com/b/')) return true;
        if (urlLower.endsWith('.geojson')) return true;
        if (urlLower.endsWith('.json')) return true;
        if (urlLower.endsWith('.kml')) return true;
        if (urlLower.endsWith('.geojsonl') || urlLower.endsWith('.ndjson') || urlLower.endsWith('.jsonl')) return true;
        if (urlLower.endsWith('.gpkg')) return true;
        if (urlLower.endsWith('.zip')) return true;
        if (urlLower.includes('{z}') && (urlLower.includes('.pbf') || urlLower.includes('.mvt'))) return true;
        if (urlLower.includes('{z}') && (urlLower.includes('.png') || urlLower.includes('.jpg'))) return true;
        if (/\/\d+\/\d+\/\d+(\.(pbf|mvt|png|jpg|jpeg|webp))?($|\?)/i.test(url)) return true;
        if (urlLower.includes('mapwarper.net/maps/') || urlLower.includes('warper.wmflabs.org/maps/')) return true;
        if (urlLower.includes('vector.openstreetmap.org')) return true;
        if (urlLower.includes('earthengine.googleapis.com') && urlLower.includes('/tiles/')) return true;
        if (urlLower.startsWith('mapbox://')) return true;
        if (/^[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(url)) return true;

        return false;
    }

    async handleURLImport() {
        let url = $('#url-input').val().trim();
        if (!url) {
            alert('Please enter a URL');
            return;
        }

        url = this.normalizeGoogleSheetsUrl(url);

        this.setLoadingState('loading');

        try {
            if (this.isGistUrl(url)) {
                url = await this.resolveGistRawUrl(url);
                $('#url-input').val(url);
            }

            if (this.isOverpassShareUrl(url)) {
                await this.handleOverpassImport(url, { withPreview: true });
                this.setLoadingState('success');
                return;
            }

            if (this.isBharatlasUrl(url)) {
                await this.handleBharatlasImport(url);
                return;
            }

            if (AllmapsAPI.isAllmapsUrl(url)) {
                const config = await AllmapsAPI.createConfigFromUrl(url);
                this.currentLayerType = 'tms';
                this.currentData = config;
                this.currentDataSource = url;
                this.showTileLayerSuccess(config);
                return;
            }

            if (OSMApi.isOsmUrl(url)) {
                // Mirrors the "overpass" type's handling below: a fixed geometry
                // whose style is already fully resolved (mixed point/line/polygon
                // geometry, so the Point/Line/Area checkboxes don't apply) — use
                // the generic tile-config path and preview it as inline GeoJSON.
                const config = await OSMApi.createConfigFromRef(url);
                const ref = OSMApi.extractRef(url);
                this.currentLayerType = 'osm';
                this.currentData = config;
                this.currentDataSource = url;
                this._osmRef = ref ? `${ref.type}/${ref.id}` : null;
                this._dataMode = 'dynamic';
                this.showTileLayerSuccess(config);

                const geojson = config.geojson;
                window.parent.postMessage({
                    type: 'creator-preview',
                    geojson,
                    style: config.style,
                    geometryType: this.detectGeometryType(geojson),
                    bbox: this.calculateBBox(geojson),
                    fitBounds: true
                }, '*');
                return;
            }

            if (url.includes('jsonkeeper.com/b/') || url.toLowerCase().endsWith('.json')) {
                const response = await fetch(url);
                const data = await response.json();

                if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                    this.processGeoJSON(data, url);
                } else if (data.layers && Array.isArray(data.layers)) {
                    // Atlas configuration with multiple layers
                    this.handleAtlasImport(data, url);
                } else if (data.type && data.id) {
                    this.currentLayerType = data.type;
                    this.currentData = data;
                    this.currentDataSource = url;
                    this.showTileLayerSuccess(data);
                } else {
                    throw new Error('Invalid layer configuration from JSON URL');
                }
                return;
            }

            if (url.includes('mapwarper.net/maps/') || url.includes('warper.wmflabs.org/maps/')) {
                const config = await LayerConfigGenerator.handleUrlInput(url);
                this.currentLayerType = 'raster';
                this.currentData = config;
                this.currentDataSource = url;
                this.showTileLayerSuccess(config);
                return;
            }

            if (this.isWMSUrl(url)) {
                const config = this.createWMSConfig(url);
                this.currentLayerType = 'wms';
                this.currentData = config;
                this.currentDataSource = url;
                this.showTileLayerSuccess(config);
                return;
            }

            if (url.toLowerCase().endsWith('.gpkg')) {
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                const geojson = await this.parseGPKG(buffer);
                this.processGeoJSON(geojson, url);
                return;
            }

            if (url.toLowerCase().endsWith('.zip')) {
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                const geojson = await this.parseShapefile(buffer);
                this.processGeoJSON(geojson, url);
                return;
            }

            if (url.toLowerCase().endsWith('.geojsonl') || url.toLowerCase().endsWith('.ndjson') || url.toLowerCase().endsWith('.jsonl')) {
                const response = await fetch(url);
                const text = await response.text();
                const geojson = this.parseGeoJSONL(text);
                this.processGeoJSON(geojson, url);
                return;
            }

            const layerType = LayerConfigGenerator.guessLayerType(url);

            if (layerType === 'vector' || layerType === 'raster' || layerType === 'mapbox-tileset') {
                const config = await LayerConfigGenerator.handleUrlInput(url);
                this.currentLayerType = layerType;
                this.currentData = config;
                this.currentDataSource = url;
                this.showTileLayerSuccess(config);
            } else if (layerType === 'geojson') {
                const response = await fetch(url);
                const geojson = await response.json();
                this.processGeoJSON(geojson, url);
            } else if (this.isCSVUrl(url)) {
                const response = await fetch(url);
                const csvText = await response.text();
                console.log('[MapCreator] CSV text length:', csvText.length);
                console.log('[MapCreator] First 500 chars:', csvText.substring(0, 500));
                const looksLikeHTML = /^\s*<(!doctype|html|head|meta)/i.test(csvText);
                const rows = (looksLikeHTML && url.includes('docs.google.com/spreadsheets'))
                    ? this.parseGoogleSheetsHTML(csvText)
                    : DataUtils.parseCSV(csvText);
                console.log('[MapCreator] Parsed rows:', rows.length);
                if (rows.length > 0) {
                    console.log('[MapCreator] First row keys:', Object.keys(rows[0]));
                }
                const geojson = GeoUtils.rowsToGeoJSON(rows, true);
                if (!geojson || geojson.features.length === 0) {
                    const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
                    const message = `Could not auto-detect latitude/longitude columns.\n\nColumns found: ${fields.join(', ')}\n\nPlease select the coordinate fields manually below.`;
                    alert(message);
                    this.processCSVLayerWithoutCoords(url, rows);
                } else {
                    this.processCSVLayer(url, geojson, rows);
                }
            } else if (url.toLowerCase().endsWith('.kml')) {
                const response = await fetch(url);
                const kmlText = await response.text();
                const geojson = await KMLConverter.kmlToGeoJson(kmlText);
                this.processGeoJSON(geojson, url);
            } else {
                const response = await fetch(url);
                const contentType = response.headers.get('content-type');

                if (contentType && contentType.includes('application/json')) {
                    const data = await response.json();
                    if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                        this.processGeoJSON(data, url);
                    } else {
                        throw new Error('Unknown JSON format');
                    }
                } else if (contentType && (contentType.includes('text/csv') || contentType.includes('text/plain'))) {
                    const csvText = await response.text();
                    console.log('[MapCreator] CSV text length:', csvText.length);
                    console.log('[MapCreator] First 500 chars:', csvText.substring(0, 500));
                    const looksLikeHTML = /^\s*<(!doctype|html|head|meta)/i.test(csvText);
                    const rows = (looksLikeHTML && url.includes('docs.google.com/spreadsheets'))
                        ? this.parseGoogleSheetsHTML(csvText)
                        : DataUtils.parseCSV(csvText);
                    console.log('[MapCreator] Parsed rows:', rows.length);
                    if (rows.length > 0) {
                        console.log('[MapCreator] First row keys:', Object.keys(rows[0]));
                    }
                    const geojson = GeoUtils.rowsToGeoJSON(rows, true);
                    if (!geojson || geojson.features.length === 0) {
                        const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
                        const message = `Could not auto-detect latitude/longitude columns.\n\nColumns found: ${fields.join(', ')}\n\nPlease select the coordinate fields manually below.`;
                        alert(message);
                        this.processCSVLayerWithoutCoords(url, rows);
                    } else {
                        this.processCSVLayer(url, geojson, rows);
                    }
                } else {
                    throw new Error('Unsupported file type');
                }
            }
        } catch (error) {
            alert('Could not load URL: ' + error.message);
            console.error(error);
            this.setLoadingState('error');
        }
    }

    handleAtlasImport(atlasData, url) {
        const layers = atlasData.layers.filter(layer => layer.id && layer.title);

        if (layers.length === 0) {
            throw new Error('No valid layers found in atlas');
        }

        const layerOptions = layers.map((layer, index) =>
            `<option value="${index}">${layer.title || layer.id} (${layer.type || 'unknown'})</option>`
        ).join('');

        const html = `
            <div id="atlas-selector-container" class="mt-4 p-4 border border-gray-300 rounded bg-gray-50">
                <p class="mb-2 font-semibold text-gray-900">Atlas: ${atlasData.name || 'Unnamed'}</p>
                <p class="mb-3 text-sm text-gray-600">Contains ${layers.length} layer${layers.length > 1 ? 's' : ''}. Import the full atlas or select a specific layer.</p>

                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Choose layer to import</label>
                    <select id="atlas-layer-select" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="all">All Layers (Full Atlas)</option>
                        <option disabled>──────────</option>
                        ${layerOptions}
                    </select>
                </div>

                <div class="flex gap-2">
                    <button id="cancel-atlas-import-btn" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors">Cancel</button>
                </div>
            </div>
        `;

        // Remove any existing atlas selector
        $('#atlas-selector-container').remove();

        // Insert after the load-data-btn
        $('#load-data-btn').after(html);

        // Store atlas data for later use
        this.currentAtlasUrl = url;
        this.currentAtlasData = atlasData;
        this.currentAtlasLayers = layers;
        this.currentLayerType = 'atlas';

        // Set default title and type
        if (!$('#layer-title').val()) {
            $('#layer-title').val(atlasData.name || 'Imported Atlas');
        }
        $('#layer-type').val('atlas');

        // Enable the Add Map Layer button
        $('#add-to-map-btn').prop('disabled', false);

        // Handle layer selection changes
        $('#atlas-layer-select').on('change', () => {
            const selectedValue = $('#atlas-layer-select').val();

            if (selectedValue === 'all') {
                // Hide settings section for full atlas import
                $('#settings-section').hide();
            } else {
                // Show settings section for individual layer import
                $('#settings-section').show();

                // Load the selected layer's configuration
                const selectedIndex = parseInt(selectedValue);
                const selectedLayer = this.currentAtlasLayers[selectedIndex];

                // Update title if not manually changed
                const currentTitle = $('#layer-title').val();
                if (!currentTitle || currentTitle === this.currentAtlasData.name || currentTitle === 'Imported Atlas') {
                    $('#layer-title').val(selectedLayer.title || selectedLayer.id);
                }

                // Update type and ID
                $('#layer-type').val(selectedLayer.type || 'geojson');
                $('#layer-id').val(selectedLayer.id || this.generateId(selectedLayer.title || selectedLayer.id));
            }
        });

        // Trigger initial state (all layers selected by default)
        $('#settings-section').hide();

        // Cancel button
        $('#cancel-atlas-import-btn').on('click', () => {
            $('#atlas-selector-container').remove();
            $('#settings-section').hide();
            this.currentAtlasUrl = null;
            this.currentAtlasData = null;
            this.currentAtlasLayers = null;
            this.setLoadingState('default');
        });

        this.setLoadingState('success');
    }

    setLoadingState(state) {
        const $btn = $('#load-data-btn');

        switch (state) {
            case 'loading':
                $btn.prop('disabled', true)
                    .removeClass('bg-blue-600 bg-green-600 hover:bg-blue-700 hover:bg-green-700')
                    .addClass('bg-blue-400')
                    .html('<span class="inline-flex items-center gap-2"><svg class="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Loading Data...</span>');
                break;
            case 'success':
                $btn.prop('disabled', false)
                    .removeClass('bg-blue-600 bg-blue-400 hover:bg-blue-700')
                    .addClass('bg-green-600 hover:bg-green-700')
                    .html('<span class="inline-flex items-center gap-2">↻ Refresh Data</span>');
                break;
            case 'error':
                $btn.prop('disabled', false)
                    .removeClass('bg-blue-400 bg-green-600 hover:bg-green-700')
                    .addClass('bg-blue-600 hover:bg-blue-700')
                    .text('Load Data');
                break;
            default:
                $btn.prop('disabled', false)
                    .removeClass('bg-blue-400 bg-green-600 hover:bg-green-700')
                    .addClass('bg-blue-600 hover:bg-blue-700')
                    .text('Load Data');
        }
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'gpkg') {
            this.setLoadingState('loading');
            try {
                const geojson = await this.parseGPKGStreaming(file, (count) => {
                    const spin = '<svg class="animate-spin h-4 w-4 inline" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
                    $('#load-data-btn').html(`<span class="inline-flex items-center gap-2">${spin} Reading… ${count.toLocaleString()} features</span>`);
                });
                this.processGeoJSON(geojson, file.name);
            } catch (error) {
                alert('GeoPackage error: ' + error.message);
                console.error(error);
                this.setLoadingState('error');
            }
            return;
        }

        if (ext === 'zip') {
            this.setLoadingState('loading');
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const geojson = await this.parseShapefile(e.target.result);
                    this.processGeoJSON(geojson, file.name);
                } catch (error) {
                    alert('Shapefile error: ' + error.message);
                    console.error(error);
                    this.setLoadingState('error');
                }
            };
            reader.readAsArrayBuffer(file);
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert('Warning: Large file may cause performance issues');
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target.result;

                let geojson;
                if (ext === 'kml') {
                    geojson = await KMLConverter.kmlToGeoJson(content);
                } else if (ext === 'csv') {
                    const rows = DataUtils.parseCSV(content);
                    if (!rows || rows.length === 0) {
                        throw new Error('CSV file is empty');
                    }
                    geojson = GeoUtils.rowsToGeoJSON(rows);
                    if (!geojson) {
                        throw new Error('Could not find lat/lng columns in CSV');
                    }
                } else if (ext === 'geojsonl' || ext === 'ndjson' || ext === 'jsonl') {
                    geojson = this.parseGeoJSONL(content);
                } else {
                    geojson = JSON.parse(content);
                    if (!geojson.type || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
                        throw new Error('Invalid GeoJSON format');
                    }
                }

                this.processGeoJSON(geojson, file.name);
            } catch (error) {
                alert('Parse error: ' + error.message);
                console.error(error);
            }
        };
        reader.readAsText(file);
    }

    previewOnGeojsonIO() {
        const geojsonText = $('#geojson-editor').val().trim();
        if (!geojsonText) {
            alert('No GeoJSON to preview');
            return;
        }

        try {
            const geojson = JSON.parse(geojsonText);
            const geojsonString = JSON.stringify(geojson);
            const encodedData = encodeURIComponent(geojsonString);
            const geojsonIOUrl = `https://geojson.io/#data=data:application/json,${encodedData}`;
            window.open(geojsonIOUrl, '_blank');
        } catch (error) {
            alert('Invalid GeoJSON: ' + error.message);
        }
    }

    downloadGeoJSON() {
        const geojsonText = $('#geojson-editor').val().trim();
        if (!geojsonText) {
            alert('No GeoJSON to download');
            return;
        }

        try {
            const geojson = JSON.parse(geojsonText);
            const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'layer-data.geojson';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            alert('Invalid GeoJSON: ' + error.message);
        }
    }

    processGeoJSON(geojson, sourceName) {
        if (sourceName !== 'edited') {
            this._previewFitted = false;
        }
        this.resetOsmDataMode();
        this.currentData = geojson;
        this.currentDataSource = sourceName;
        this.currentLayerType = 'geojson';

        const geometryType = this.detectGeometryType(geojson);
        this.currentGeometryType = geometryType;

        const fields = this.extractFields(geojson);
        this.populateDataFields(fields);
        this.populateLabelFieldOptions(fields);

        this.updateDataPreview(geojson);
        this.showStyleSection(geojson);
        this.showConfigSection();

        $('#layer-type').val('geojson');

        if (sourceName === 'edited') {
            return;
        }

        this._resetConfigEditorState();
        this.updateConfigPreview();
        $('#add-to-map-btn').prop('disabled', false);
        this.setLoadingState('success');
    }

    processCSVLayer(csvUrl, geojson, rows) {
        this._previewFitted = false;
        this._resetConfigEditorState();
        this.resetOsmDataMode();
        this.currentData = {
            csvUrl: csvUrl,
            geojson: geojson,
            rows: rows
        };
        this.currentDataSource = csvUrl;
        this.currentLayerType = 'csv';

        const geometryType = this.detectGeometryType(geojson);
        this.currentGeometryType = geometryType;

        const fields = this.extractFields(geojson);
        this.populateDataFields(fields);
        this.populateLabelFieldOptions(fields);

        this.updateDataPreview(geojson);
        this.showStyleSection(geojson);
        this.showConfigSection();

        $('#layer-type').val('csv');

        if (csvUrl.includes('docs.google.com/spreadsheets')) {
            $('#layer-title').val('Google Sheet CSV');
            $('#layer-description').val(`Data from Google Sheets - <a href='${csvUrl}' target='_blank'>View source</a>`);
            $('#layer-attribution').val(`<a href='${csvUrl}' target='_blank'>Google Sheets</a>`);
        }

        this.updateConfigPreview();
        $('#add-to-map-btn').prop('disabled', false);
        this.setLoadingState('success');
    }

    processCSVLayerWithoutCoords(csvUrl, rows) {
        console.log('[MapCreator] processCSVLayerWithoutCoords called', {
            rowCount: rows.length,
            columns: rows.length > 0 ? Object.keys(rows[0]) : []
        });

        this._resetConfigEditorState();
        this.resetOsmDataMode();
        this.currentData = {
            csvUrl: csvUrl,
            geojson: null,
            rows: rows
        };
        this.currentDataSource = csvUrl;
        this.currentLayerType = 'csv';

        $('#settings-section').show().removeClass('is-disabled');
        $('#settings-step-hint').hide();
        $('#data-preview-details').show();

        const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
        console.log('[MapCreator] Populating data fields with:', fields);
        this.populateDataFields(fields);

        $('#geojson-editor').val('// No preview available - select coordinate fields below');
        $('#preview-summary').html('<span class="text-yellow-600">⚠ Select coordinate fields to preview data</span>');

        $('#layer-type').val('csv');

        if (csvUrl.includes('docs.google.com/spreadsheets')) {
            $('#layer-title').val('Google Sheet CSV');
            $('#layer-description').val(`Data from Google Sheets - <a href='${csvUrl}' target='_blank'>View source</a>`);
            $('#layer-attribution').val(`<a href='${csvUrl}' target='_blank'>Google Sheets</a>`);
        }

        $('#add-to-map-btn').prop('disabled', true);
        this.setLoadingState('success');
    }

    showTileLayerSuccess(config) {
        this._resetConfigEditorState();
        this._originalTileConfig = JSON.parse(JSON.stringify(config));

        if (this.currentLayerType !== 'osm') {
            this.resetOsmDataMode();
        }

        $('#data-preview-details').hide();
        // .show() is a no-op when the element wasn't hidden via inline style,
        // so the MutationObserver bridge never fires. Remove the disabled
        // class directly so the form is interactive.
        $('#settings-section').show().removeClass('is-disabled');
        $('#settings-step-hint').hide();

        const title = config.title || 'Tile Layer';
        $('#layer-title').val(title);
        $('#layer-id').val(config.id || this.generateId(title));
        $('#layer-type').val(config.type || 'tms');
        $('#layer-description').val(config.description || '');
        $('#layer-attribution').val(config.attribution || '');

        // Point/Line/Area/Label style checkboxes only make sense for vector
        // tile layers — geometry is unknown up front, so start with just
        // Label checked and let live tile detection (see
        // _handleTileInfoDetected) or the user fill in the rest.
        if ((config.type || 'tms') === 'vector') {
            $('#style-controls').show();
            $('#geometry-type-info').text('Geometry type unknown until tiles load — check the box(es) that match your data below, or wait for it to auto-detect once the preview loads.');
            this._styleTypesUserModified = false;
            $('#style-type-point, #style-type-line, #style-type-area').prop('checked', false);
            $('#style-type-label').prop('checked', true);
            this.updateStyleSectionVisibility();

            const fields = config.inspect?.fields || [];
            this.populateLabelFieldOptions(fields, config.inspect?.label);
        } else {
            $('#style-controls').hide();
        }

        this.updateTileConfigPreview(config);
        if (this.currentLayerType === 'osm') {
            this.updateOsmDataModeUI(config);
        }
        $('#add-to-map-btn').prop('disabled', false);
        this.setLoadingState('success');
        this.schedulePreview();
    }

    // Geometry size (in characters) drives whether embedding it inline
    // ("Static") is even offered — see updateOsmDataModeUI(). Only geometry
    // coordinates count, not properties, since coordinates are what blew up
    // the URL for large ways/relations.
    calculateOsmGeometrySize(geojson) {
        const features = (geojson && geojson.features) || [];
        return JSON.stringify(features.map(f => f.geometry)).length;
    }

    // Threshold under which "Static" (fully embedded geometry) is offered as
    // an alternative to "Dynamic". In practice this only admits a single bare
    // Point — anything with real line/polygon geometry must stay Dynamic to
    // avoid recreating the too-long-URL bug this guards against.
    static OSM_STATIC_MAX_GEOMETRY_CHARS = 50;

    updateOsmDataModeUI(config) {
        $('#osm-data-mode-section').show();

        const geomSize = this.calculateOsmGeometrySize(config.geojson);
        const staticAllowed = geomSize < MapCreator.OSM_STATIC_MAX_GEOMETRY_CHARS;
        $('#data-mode-static').prop('disabled', !staticAllowed);
        $('#data-mode-static-disabled-hint').toggle(!staticAllowed);
        if (!staticAllowed) this._dataMode = 'dynamic';

        $('#data-mode-dynamic').prop('checked', this._dataMode === 'dynamic');
        $('#data-mode-static').prop('checked', this._dataMode === 'static');

        this.applyOsmDataModeFieldState();
        if (this._dataMode === 'dynamic') this.updateConfigPreview();
    }

    applyOsmDataModeFieldState() {
        const dynamic = this.currentLayerType === 'osm' && this._dataMode === 'dynamic';
        $('#layer-title, #layer-description, #layer-attribution').prop('disabled', dynamic);
        $('#osm-dynamic-note').toggle(dynamic);
    }

    // Minimal config for OSM "Dynamic" mode — the same {type, id} shorthand
    // the `?layers=osm:relation/123` URL API accepts (see
    // dynamic-layer-shorthand.js), so title/description/attribution/style are
    // re-derived from OSM on every load rather than stored here.
    getOsmDynamicConfig() {
        const title = $('#layer-title').val().trim() || this._originalTileConfig?.title || 'OSM Feature';
        const config = { type: 'osm', id: this._osmRef, title };
        if (this._originalTileConfig?.bbox) config.bbox = this._originalTileConfig.bbox;
        return config;
    }

    resetOsmDataMode() {
        this._osmRef = null;
        this._dataMode = 'dynamic';
        $('#osm-data-mode-section').hide();
        $('#layer-title, #layer-description, #layer-attribution').prop('disabled', false);
        $('#osm-dynamic-note').hide();
    }

    detectGeometryType(geojson) {
        if (!geojson.features || geojson.features.length === 0) {
            return 'Point';
        }

        const types = new Set();
        geojson.features.forEach(feature => {
            if (feature.geometry) {
                types.add(feature.geometry.type);
            }
        });

        if (types.has('Polygon') || types.has('MultiPolygon')) {
            return 'Polygon';
        } else if (types.has('LineString') || types.has('MultiLineString')) {
            return 'LineString';
        } else {
            return 'Point';
        }
    }

    updateDataPreview(geojson) {
        const geojsonText = JSON.stringify(geojson, null, 2);
        $('#geojson-editor').val(geojsonText);

        const features = geojson.features || [];
        const typeCounts = {};
        features.forEach(feature => {
            const type = feature.geometry?.type || 'Unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        });

        const statsText = Object.entries(typeCounts)
            .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
            .join(', ');

        const totalFeatures = features.length;
        $('#preview-summary').html(
            `<span class="text-green-600">✓ ${totalFeatures} feature${totalFeatures !== 1 ? 's' : ''}</span>` +
            (statsText ? ` - ${statsText}` : '')
        );

        $('#data-preview-details').show();
    }

    showStyleSection(geojson) {
        $('#settings-section').show();
        $('#style-controls').show();

        const types = this.detectGeometryTypesPresent(geojson);
        $('#geometry-type-info').text(types.length ? `Detected geometry: ${types.join(', ')}` : 'Detected geometry: unknown');

        if (!this._styleTypesUserModified) {
            this.autoCheckStyleTypes(types);
        }
        this.updateStyleSectionVisibility();
    }

    // Every distinct geometry type present in a GeoJSON FeatureCollection,
    // e.g. ['Polygon', 'Point'] for a mixed dataset.
    detectGeometryTypesPresent(geojson) {
        const types = new Set();
        (geojson?.features || []).forEach(feature => {
            if (feature.geometry?.type) types.add(feature.geometry.type);
        });
        return Array.from(types);
    }

    // Checks the Point/Line/Area boxes that match the geometry actually
    // present. Label is left untouched — it defaults on and the user (or
    // _handleTileInfoDetected) controls it independently.
    autoCheckStyleTypes(geometryTypes) {
        const has = (...gts) => gts.some(gt => geometryTypes.includes(gt));
        $('#style-type-point').prop('checked', has('Point', 'MultiPoint'));
        $('#style-type-line').prop('checked', has('LineString', 'MultiLineString'));
        $('#style-type-area').prop('checked', has('Polygon', 'MultiPolygon'));
        this.updateStyleSectionVisibility();
    }

    updateStyleSectionVisibility() {
        $('#style-section-point').toggle($('#style-type-point').is(':checked'));
        $('#style-section-line').toggle($('#style-type-line').is(':checked'));
        $('#style-section-area').toggle($('#style-type-area').is(':checked'));
        $('#style-section-label').toggle($('#style-type-label').is(':checked'));
    }

    // Builds the flat Mapbox style object from whichever Point/Line/Area/Label
    // checkboxes are checked. Multiple style "families" (fill-*, line-*,
    // circle-*, text-*) can coexist in one flat object — MapboxAPI splits them
    // into the right layer types when the layer is actually added to the map.
    buildStyleFromControls() {
        const style = {};

        if ($('#style-type-area').is(':checked')) {
            const fillColor = $('#area-fill-color').val();
            const fillOpacity = parseFloat($('#area-fill-opacity').val());
            const strokeColor = $('#area-stroke-color').val();
            const strokeWidth = parseFloat($('#area-stroke-width').val());
            style['fill-color'] = ['coalesce', ['get', 'fill-color'], ['get', 'color'], fillColor];
            style['fill-opacity'] = fillOpacity;
            style['line-color'] = ['coalesce', ['get', 'stroke-color'], ['get', 'color'], strokeColor];
            style['line-width'] = strokeWidth;
        }

        if ($('#style-type-line').is(':checked')) {
            const lineColor = $('#line-color').val();
            const lineWidth = parseFloat($('#line-width').val());
            style['line-color'] = ['coalesce', ['get', 'stroke-color'], ['get', 'color'], lineColor];
            style['line-width'] = lineWidth;
        }

        if ($('#style-type-point').is(':checked')) {
            const fillColor = $('#point-fill-color').val();
            const strokeColor = $('#point-stroke-color').val();
            const radius = parseFloat($('#point-radius').val());
            style['circle-color'] = ['coalesce', ['get', 'fill-color'], ['get', 'color'], fillColor];
            style['circle-radius'] = radius;
            style['circle-stroke-color'] = ['coalesce', ['get', 'stroke-color'], ['get', 'color'], strokeColor];
            style['circle-stroke-width'] = 2;
        }

        if ($('#style-type-label').is(':checked')) {
            const labelField = $('#label-field-select').val();
            if (labelField) {
                style['text-field'] = ['to-string', ['get', labelField]];
            }
        }

        return style;
    }

    // Populates the Label section's field dropdown. `preferredField` wins if
    // it's still a valid option; otherwise falls back to the current
    // selection, then the best-guess default (see getDefaultNameField).
    populateLabelFieldOptions(fields, preferredField) {
        const $select = $('#label-field-select');

        // Rebuilding <option> elements while the dropdown is open confuses
        // the native picker (it can stop responding to clicks). Skip the
        // rebuild entirely when the field list hasn't actually changed.
        const fieldsKey = JSON.stringify(fields);
        if (!preferredField && this._lastLabelFieldsKey === fieldsKey) {
            return;
        }
        this._lastLabelFieldsKey = fieldsKey;

        const current = $select.val();
        $select.empty().append('<option value="">None</option>');
        fields.forEach(field => {
            $select.append(`<option value="${field}">${field}</option>`);
        });

        let value = '';
        if (preferredField && fields.includes(preferredField)) {
            value = preferredField;
        } else if (current && fields.includes(current)) {
            value = current;
        } else {
            value = this.getDefaultNameField(fields);
        }
        if (value) $select.val(value);
    }

    // Called when the parent map reports back geometry types / fields it
    // found while rendering the live tile preview (vector layers only — see
    // MapBrowserControl._detectVectorTileInfo). This fires once per freshly
    // loaded vector source, asynchronously (after tiles have had a chance to
    // load) — so it can land while the user is already typing. Don't clobber
    // the JSON box (or an open label dropdown) if so.
    _handleTileInfoDetected(geometryTypes, fields) {
        const active = document.activeElement;
        if (active && (active.id === 'config-preview' || active.id === 'label-field-select')) {
            return;
        }

        if (fields && fields.length > 0) {
            this.populateLabelFieldOptions(fields);
        }
        if (!this._styleTypesUserModified) {
            this.autoCheckStyleTypes(geometryTypes);
        }
        this.updateConfigPreview();
    }

    showConfigSection() {
        // .show() is a no-op when the section wasn't hidden via inline style, so the
        // MutationObserver bridge never fires — clear the disabled state directly.
        $('#settings-section').show().removeClass('is-disabled');
        $('#settings-step-hint').hide();
        if (!$('#layer-title').val()) {
            const defaultTitle = this.generateDefaultTitle();
            $('#layer-title').val(defaultTitle);
            $('#layer-id').val(this.generateId(defaultTitle));
        }
    }

    generateDefaultTitle() {
        if (typeof this.currentDataSource === 'string') {
            const filename = this.currentDataSource.split('/').pop().split('?')[0];
            return filename.replace(/\.(geojson|json|csv|kml|gpkg|geojsonl|ndjson|jsonl|zip)$/i, '').replace(/[-_]/g, ' ');
        }
        return 'Custom Layer';
    }

    calculateBBox(geojson) {
        return CameraUtils.computeGeojsonBbox(geojson);
    }

    generateLayerConfig() {
        if (this.currentLayerType === 'osm' && this._dataMode === 'dynamic') {
            return this.getOsmDynamicConfig();
        }

        if (this.currentLayerType === 'csv') {
            return this.generateCSVLayerConfig();
        }

        if (this.currentLayerType !== 'geojson') {
            return this.currentData;
        }

        const title = $('#layer-title').val().trim() || 'Custom Layer';
        const layerId = $('#layer-id').val().trim() || this.generateId(title);
        const description = $('#layer-description').val().trim();
        const attribution = $('#layer-attribution').val().trim();

        const isExternalUrl = typeof this.currentDataSource === 'string' &&
            (this.currentDataSource.startsWith('http://') || this.currentDataSource.startsWith('https://'));

        const idField = $('#feature-id-field').val() || 'id';
        const nameField = $('#feature-name-field').val();
        const nameFieldOrDefault = nameField || 'name';
        const selectedFields = [];
        $('#inspect-fields-list input:checked').each(function() {
            selectedFields.push($(this).val());
        });

        const layerType = $('#layer-type').val() || 'geojson';

        const bbox = this.calculateBBox(this.currentData);

        const config = {
            ...(this._layerConfigOverride || {}),
            id: layerId,
            title: title,
            type: layerType,
            initiallyChecked: false,
            inspect: {
                id: idField,
                title: 'Name',
                label: nameFieldOrDefault,
                fields: selectedFields.length > 0 ? selectedFields : [idField, nameFieldOrDefault],
                fieldTitles: (selectedFields.length > 0 ? selectedFields : [idField, nameFieldOrDefault]).map(f =>
                    f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                )
            }
        };

        if (isExternalUrl) {
            config.url = this.currentDataSource;
        } else {
            // No URL to fetch from (uploaded file / pasted data) — cache the
            // GeoJSON in localStorage instead of embedding it in the shareable
            // URL. Not needed when a URL exists: that's already the source of
            // truth, and caching it would also risk masking upstream edits.
            config.dataSource = 'localStorage';
        }

        if (description) {
            config.description = description;
        }

        if (attribution) {
            config.attribution = attribution;
        }

        if (bbox && $('#include-bbox-checkbox').is(':checked')) {
            config.bbox = bbox;
        }

        if (!this._styleManuallyEdited) {
            config.style = this.buildStyleFromControls();
        }

        return config;
    }

    generateCSVLayerConfig() {
        const title = $('#layer-title').val().trim() || 'Custom CSV Layer';
        const layerId = $('#layer-id').val().trim() || this.generateId(title);
        const description = $('#layer-description').val().trim();
        const attribution = $('#layer-attribution').val().trim();

        const idField = $('#feature-id-field').val() || 'id';
        const nameField = $('#feature-name-field').val();
        const nameFieldOrDefault = nameField || 'name';
        const selectedFields = [];
        $('#inspect-fields-list input:checked').each(function() {
            selectedFields.push($(this).val());
        });

        const layerType = $('#layer-type').val() || 'csv';

        const bbox = this.currentData.geojson ? this.calculateBBox(this.currentData.geojson) : null;

        const isExternalUrl = typeof this.currentData.csvUrl === 'string' &&
            (this.currentData.csvUrl.startsWith('http://') || this.currentData.csvUrl.startsWith('https://'));

        const config = {
            ...(this._layerConfigOverride || {}),
            id: layerId,
            title: title,
            type: 'geojson',
            initiallyChecked: false,
            inspect: {
                id: idField,
                title: 'Name',
                label: nameFieldOrDefault,
                fields: selectedFields.length > 0 ? selectedFields : [idField, nameFieldOrDefault],
                fieldTitles: (selectedFields.length > 0 ? selectedFields : [idField, nameFieldOrDefault]).map(f =>
                    f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                )
            }
        };

        if (isExternalUrl) {
            config.type = layerType;
            config.url = this.currentData.csvUrl;
        } else {
            config.dataSource = 'localStorage';
        }

        if (description) {
            config.description = description;
        }

        if (attribution) {
            config.attribution = attribution;
        }

        if (bbox && $('#include-bbox-checkbox').is(':checked')) {
            config.bbox = bbox;
        }

        if (!this._styleManuallyEdited) {
            config.style = this.buildStyleFromControls();
        }

        // Save-notes write-back (Google Sheets only)
        const csvUrl = this.currentData?.csvUrl;
        const isGoogleSheet = typeof csvUrl === 'string' && csvUrl.includes('docs.google.com/spreadsheets');
        const saveUrl = $('#save-url-input').val().trim();
        if (isGoogleSheet && $('#enable-save-notes').is(':checked') && saveUrl) {
            config.saveUrl = saveUrl;
        }

        return config;
    }

    updateSaveNotesVisibility() {
        const csvUrl = this.currentData?.csvUrl;
        const isGoogleSheet = this.currentLayerType === 'csv' &&
            typeof csvUrl === 'string' &&
            csvUrl.includes('docs.google.com/spreadsheets');
        const section = document.getElementById('save-notes-section');
        if (section) section.style.display = isGoogleSheet ? '' : 'none';
    }

    updateTileConfigPreview(baseConfig) {
        const title = $('#layer-title').val().trim() || baseConfig.title;
        const layerId = $('#layer-id').val().trim() || baseConfig.id || this.generateId(title);
        const layerType = $('#layer-type').val() || baseConfig.type;
        const description = $('#layer-description').val().trim() || baseConfig.description;
        const attribution = $('#layer-attribution').val().trim() || baseConfig.attribution;

        const config = {
            ...baseConfig,
            id: layerId,
            title: title,
            type: layerType,
            description: description,
            attribution: attribution
        };

        if (!description) {
            delete config.description;
        }
        if (!attribution) {
            delete config.attribution;
        }

        if (layerType === 'vector' && !this._styleManuallyEdited) {
            config.style = this.buildStyleFromControls();
        }

        this.currentData = config;
        $('#config-preview').val(JSON.stringify(config, null, 2));
    }

    updateConfigPreview() {
        let config;

        this.updateSaveNotesVisibility();

        if (this.currentLayerType === 'osm' && this._dataMode === 'dynamic') {
            config = this.getOsmDynamicConfig();
            $('#config-preview').val(JSON.stringify(config, null, 2));

            const baseUrl = window.location.origin + window.location.pathname;
            const configJson = JSON.stringify(config).replace(/"/g, "'");
            $('#inline-url').val(`${baseUrl}?layers=${encodeURIComponent(configJson)}`);

            this.schedulePreview();
            return;
        }

        if (this.currentLayerType === 'csv') {
            config = this.generateCSVLayerConfig();
            $('#config-preview').val(JSON.stringify(config, null, 2));
        } else if (this.currentLayerType !== 'geojson') {
            this.updateTileConfigPreview(this.currentData);
            this.schedulePreview();
            return;
        } else {
            config = this.generateLayerConfig();
            $('#config-preview').val(JSON.stringify(config, null, 2));
        }

        const baseUrl = window.location.origin + window.location.pathname;
        const configJson = JSON.stringify(config).replace(/"/g, "'");
        const inlineUrl = `${baseUrl}?layers=${encodeURIComponent(configJson)}`;
        $('#inline-url').val(inlineUrl);

        this.schedulePreview();
    }

    schedulePreview() {
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this.sendPreview(), 150);
    }

    sendPreview() {
        if (this.currentLayerType === 'geojson' || this.currentLayerType === 'csv') {
            let geojson = null;
            let config = null;

            if (this.currentLayerType === 'geojson') {
                geojson = this.currentData;
                config = this.generateLayerConfig();
            } else {
                geojson = this.currentData?.geojson;
                if (!geojson) return;
                config = this.generateCSVLayerConfig();
            }

            if (!geojson || !geojson.features || geojson.features.length === 0) return;

            const bbox = this.calculateBBox(geojson);
            const fitBounds = !this._previewFitted;
            this._previewFitted = true;

            window.parent.postMessage({
                type: 'creator-preview',
                geojson: geojson,
                style: config.style,
                geometryType: this.currentGeometryType,
                bbox: bbox,
                fitBounds: fitBounds
            }, '*');
            return;
        }

        // Tile-based layer types (vector/tms/wms): render actual tiles on the
        // parent map so styling/zoom edits made in the JSON below are visible live.
        const config = this.currentData;
        if (!config || !config.type || !config.url) return;
        if (!['vector', 'tms', 'wms'].includes(config.type)) return;

        window.parent.postMessage({
            type: 'creator-tile-preview',
            config: config
        }, '*');
    }

    clearPreview() {
        clearTimeout(this._previewTimer);
        this._previewFitted = false;
        window.parent.postMessage({ type: 'creator-clear-preview' }, '*');
    }

    extractFields(geojson) {
        if (!geojson.features || geojson.features.length === 0) {
            return ['id', 'name'];
        }

        const fieldSet = new Set();
        geojson.features.slice(0, 10).forEach(feature => {
            if (feature.properties) {
                Object.keys(feature.properties).forEach(key => fieldSet.add(key));
            }
        });

        const fields = Array.from(fieldSet);
        const priorityFields = ['name', 'Name', 'title', 'Title', 'description', 'Description'];

        return fields.sort((a, b) => {
            const aIndex = priorityFields.indexOf(a);
            const bIndex = priorityFields.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });
    }

    populateDataFields(fields) {
        console.log('[MapCreator] populateDataFields called', {
            fieldsCount: fields?.length,
            currentLayerType: this.currentLayerType,
            fields: fields
        });

        if (!fields || fields.length === 0) {
            $('#data-fields-section').hide();
            return;
        }

        $('#data-fields-section').show();

        const isCSV = this.currentLayerType === 'csv';
        console.log('[MapCreator] isCSV:', isCSV);

        const $csvCoordFields = $('#csv-coordinate-fields');
        console.log('[MapCreator] CSV coordinate fields element found:', $csvCoordFields.length);

        if (isCSV) {
            console.log('[MapCreator] Showing CSV coordinate fields');
            $csvCoordFields.show();
            console.log('[MapCreator] After show(), display style:', $csvCoordFields.css('display'));
        } else {
            $csvCoordFields.hide();
        }

        const $latSelect = $('#csv-latitude-field');
        const $lonSelect = $('#csv-longitude-field');
        const $idSelect = $('#feature-id-field');
        const $nameSelect = $('#feature-name-field');
        const $fieldsList = $('#inspect-fields-list');

        $latSelect.empty().append('<option value="">Auto-detect or select...</option>');
        $lonSelect.empty().append('<option value="">Auto-detect or select...</option>');
        $idSelect.empty().append('<option value="">Select field...</option>');
        $nameSelect.empty().append('<option value="">Select field...</option>');
        $fieldsList.empty();

        const defaultLat = this.getDefaultLatField(fields);
        const defaultLon = this.getDefaultLonField(fields);
        const defaultId = this.getDefaultIdField(fields);
        const defaultName = this.getDefaultNameField(fields);
        const defaultInspectFields = this.getDefaultInspectFields(fields);

        console.log('[MapCreator] Default fields detected:', {
            lat: defaultLat,
            lon: defaultLon,
            id: defaultId,
            name: defaultName,
            inspect: defaultInspectFields
        });

        fields.forEach(field => {
            if (isCSV) {
                $latSelect.append(
                    `<option value="${field}" ${field === defaultLat ? 'selected' : ''}>${field}</option>`
                );
                $lonSelect.append(
                    `<option value="${field}" ${field === defaultLon ? 'selected' : ''}>${field}</option>`
                );
            }

            $idSelect.append(`<option value="${field}" ${field === defaultId ? 'selected' : ''}>${field}</option>`);
            $nameSelect.append(`<option value="${field}" ${field === defaultName ? 'selected' : ''}>${field}</option>`);

            const isChecked = defaultInspectFields.includes(field);
            const $checkbox = $(`
                <label class="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <input type="checkbox" value="${field}" ${isChecked ? 'checked' : ''} class="rounded">
                    <span>${field}</span>
                </label>
            `);
            $fieldsList.append($checkbox);
        });

        this.updateInspectFieldsToggleLabel();

        if (isCSV) {
            $('#csv-latitude-field, #csv-longitude-field').off('change').on('change', () => {
                this.reprocessCSV();
            });
        }
    }

    updateInspectFieldsToggleLabel() {
        const $checkboxes = $('#inspect-fields-list input[type="checkbox"]');
        const allChecked = $checkboxes.length > 0 && $checkboxes.filter(':checked').length === $checkboxes.length;
        $('#inspect-fields-toggle-all-btn').text(allChecked ? 'Deselect all' : 'Select all');
    }

    reprocessCSV() {
        const latField = $('#csv-latitude-field').val();
        const lonField = $('#csv-longitude-field').val();

        if (!latField || !lonField) {
            console.warn('Please select both latitude and longitude fields');
            $('#add-to-map-btn').prop('disabled', true);
            return;
        }

        if (!this.currentData || !this.currentData.rows) {
            console.error('No CSV data available to reprocess');
            return;
        }

        const rows = this.currentData.rows;
        const geojson = GeoUtils.rowsToGeoJSON(rows, false, latField, lonField);

        if (!geojson || geojson.features.length === 0) {
            console.error('No valid features created with selected fields');
            $('#preview-summary').html('<span class="text-red-600">⚠ 0 features - Check coordinate fields</span>');
            $('#add-to-map-btn').prop('disabled', true);
            return;
        }

        this.currentData.geojson = geojson;
        this._previewFitted = false;
        this.updateDataPreview(geojson);

        this.currentGeometryType = this.detectGeometryType(geojson);

        this.showStyleSection(geojson);
        this.updateConfigPreview();
        $('#add-to-map-btn').prop('disabled', false);
    }

    generateId(title) {
        if (!title) return '';

        const words = title.toLowerCase()
            .replace(/[^a-z0-9\s]+/g, '')
            .split(/\s+/)
            .filter(w => w.length > 0)
            .slice(0, 3);

        const base = words.join('-');
        const random = String(Math.floor(Math.random() * 90) + 10);
        return base ? `${base}-${random}` : `layer-${random}`;
    }

    addToMap() {
        console.log('[MapCreator] addToMap called, layer type:', this.currentLayerType);

        let config;

        if (this.currentLayerType === 'atlas') {
            const selectedValue = $('#atlas-layer-select').val();

            if (selectedValue === 'all') {
                // Import full atlas via ?atlas parameter
                const atlasUrl = this.currentAtlasUrl;

                console.log('[MapCreator] Sending load-atlas message to parent');
                window.parent.postMessage({
                    type: 'load-atlas',
                    atlasUrl: atlasUrl
                }, '*');
                return; // Exit early, don't send add-custom-layer message
            } else {
                // Import specific layer
                const selectedIndex = parseInt(selectedValue);
                const selectedLayer = this.currentAtlasLayers[selectedIndex];
                config = { ...selectedLayer };

                // Override title if user provided one
                const userTitle = $('#layer-title').val();
                if (userTitle && userTitle.trim()) {
                    config.title = userTitle;
                }
            }
        } else if (this.currentLayerType === 'csv') {
            config = this.generateCSVLayerConfig();
        } else if (this.currentLayerType === 'geojson') {
            config = this.generateLayerConfig();
        } else if (this.currentLayerType === 'osm' && this._dataMode === 'dynamic') {
            config = this.getOsmDynamicConfig();
        } else {
            config = this.currentData;
        }

        console.log('[MapCreator] Generated config:', config);

        if (!config.title || !config.title.trim()) {
            alert('Please enter a layer title');
            return;
        }

        if (config.dataSource === 'localStorage') {
            const geojsonData = this.currentLayerType === 'csv'
                ? this.currentData.geojson
                : this.currentData;
            try {
                LayerConfigGenerator.storeGeoJSONData(config.id, geojsonData);
            } catch (e) {
                delete config.dataSource;
                if (!config.url) {
                    config.geojson = geojsonData;
                }
            }
        }

        console.log('[MapCreator] Sending add-custom-layer message to parent');
        this.clearPreview();
        window.parent.postMessage({
            type: 'add-custom-layer',
            config: config
        }, '*');
    }

    returnToBrowser() {
        this.clearPreview();
        window.parent.postMessage({
            type: 'return-to-browser'
        }, '*');
    }

    closeBrowser() {
        this.clearPreview();
        window.parent.postMessage({
            type: 'close-browser'
        }, '*');
    }

    parseGeoJSONL(content) {
        const features = content.split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    const obj = JSON.parse(line);
                    if (obj.type === 'Feature') return obj;
                    if (obj.coordinates) return { type: 'Feature', geometry: obj, properties: {} };
                    return null;
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        return { type: 'FeatureCollection', features };
    }

    async loadSqlJs() {
        if (window._sqlJs) return window._sqlJs;
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load sql.js'));
            document.head.appendChild(script);
        });
        window._sqlJs = await window.initSqlJs({
            locateFile: f => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${f}`
        });
        return window._sqlJs;
    }

    _parseGPKGHeader(data) {
        if (data[0] !== 0x47 || data[1] !== 0x50) {
            // No GP header — treat as plain WKB directly
            return { isEmpty: false, wkbOffset: 0 };
        }
        const flags = data[3];
        // bit 0: byte order for SRS/envelope (0=big-endian, 1=little-endian)
        // bits 1-3: envelope type (0=none, 1=2D, 2=3DZ, 3=3DM, 4=3DZM)
        // bit 5: is_empty flag
        const envBytes = [0, 32, 48, 48, 64];
        return {
            isEmpty: (flags & 0x20) !== 0,
            wkbOffset: 8 + (envBytes[(flags >> 1) & 0x07] || 0)
        };
    }

    _wkbRead(data, state) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const le = data[state.pos++] === 1;
        const rawType = view.getUint32(state.pos, le);
        state.pos += 4;

        const isoBase = rawType & 0xFFFF;
        const baseType = isoBase > 3000 ? isoBase - 3000 :
                         isoBase > 2000 ? isoBase - 2000 :
                         isoBase > 1000 ? isoBase - 1000 : isoBase;
        const hasZ = (rawType & 0x80000000) !== 0 || (isoBase > 1000 && isoBase <= 1007) || isoBase > 3000;
        const hasM = (rawType & 0x40000000) !== 0 || (isoBase > 2000 && isoBase <= 2007) || isoBase > 3000;

        const readF64 = () => { const v = view.getFloat64(state.pos, le); state.pos += 8; return v; };
        const readU32 = () => { const v = view.getUint32(state.pos, le); state.pos += 4; return v; };
        const readPt = () => { const x = readF64(), y = readF64(); if (hasZ) readF64(); if (hasM) readF64(); return [x, y]; };
        const readRing = () => { const n = readU32(); return Array.from({ length: n }, readPt); };

        switch (baseType) {
            case 1: return { type: 'Point', coordinates: readPt() };
            case 2: return { type: 'LineString', coordinates: readRing() };
            case 3: { const n = readU32(); return { type: 'Polygon', coordinates: Array.from({ length: n }, readRing) }; }
            case 4: case 5: case 6: {
                const types = ['MultiPoint', 'MultiLineString', 'MultiPolygon'];
                const n = readU32();
                const coords = [];
                for (let i = 0; i < n; i++) { const g = this._wkbRead(data, state); if (g) coords.push(g.coordinates); }
                return { type: types[baseType - 4], coordinates: coords };
            }
            default: return null;
        }
    }

    async loadShpJs() {
        if (window.shp) return window.shp;
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/shpjs@4.0.4/dist/shp.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load shpjs'));
            document.head.appendChild(script);
        });
        if (!window.shp) throw new Error('shpjs did not initialise');
        return window.shp;
    }

    async parseShapefile(arrayBuffer) {
        const shpFn = await this.loadShpJs();
        const result = await shpFn(arrayBuffer);
        if (Array.isArray(result)) {
            const features = result.flatMap(fc => fc.features || []);
            return { type: 'FeatureCollection', features };
        }
        return result;
    }

    async parseGPKGStreaming(file, onProgress) {
        const reader = new StreamingGPKGReader(file);
        await reader.open();
        const tables = await reader.getGeometryTables();
        if (!tables.length) throw new Error('No geometry tables found in this GeoPackage');
        const features = [];
        const multiTable = tables.length > 1;
        for (const { tableName, geomColumn, tableInfo } of tables) {
            for await (const feature of reader.streamFeatures(tableName, geomColumn, tableInfo)) {
                if (multiTable) feature.properties._layer = tableName;
                features.push(feature);
                if (features.length % 500 === 0) onProgress?.(features.length);
            }
        }
        onProgress?.(features.length);
        return { type: 'FeatureCollection', features };
    }

    async parseGPKG(arrayBuffer) {
        const SQL = await this.loadSqlJs();
        const db = new SQL.Database(new Uint8Array(arrayBuffer));

        const tableResult = db.exec('SELECT table_name, column_name FROM gpkg_geometry_columns');
        if (!tableResult.length || !tableResult[0].values.length) {
            db.close();
            throw new Error('No geometry tables found in this GeoPackage');
        }

        const tables = tableResult[0].values.map(r => ({
            tableName: String(r[0]).trim(),
            geomColumn: String(r[1]).trim()
        }));
        console.log('[GPKG] geometry tables:', tables.map(t => t.tableName));

        const allRows = [];
        for (const { tableName, geomColumn } of tables) {
            const result = db.exec(`SELECT * FROM "${tableName}"`);
            if (!result.length) continue;

            const { columns, values } = result[0];
            const geomIdx = columns.findIndex(c => c.toLowerCase() === geomColumn.toLowerCase());
            if (geomIdx === -1) {
                console.warn('[GPKG] geom column not found in', tableName, columns);
                continue;
            }

            console.log('[GPKG] table:', tableName, 'columns:', columns, 'rows:', values.length);

            for (const row of values) {
                const geom = row[geomIdx];
                allRows.push({
                    geom: geom instanceof Uint8Array ? new Uint8Array(geom) : geom,
                    props: row,
                    columns,
                    geomIdx,
                    layer: tables.length > 1 ? tableName : null
                });
            }
        }

        db.close();

        if (allRows.length > 0) {
            const g = allRows[0].geom;
            console.log('[GPKG] row[0] geom:', g instanceof Uint8Array ? `len=${g.length} bytes[0..3]=[${Array.from(g.slice(0, 4))}]` : g);
        }

        const features = allRows.map(({ geom: geomData, props: row, columns, geomIdx, layer }, i) => {
            if (!geomData) return null;
            try {
                const { isEmpty, wkbOffset } = this._parseGPKGHeader(geomData);
                if (isEmpty) return null;
                const geometry = this._wkbRead(geomData, { pos: wkbOffset });
                if (!geometry) return null;
                const properties = {};
                columns.forEach((col, j) => { if (j !== geomIdx) properties[col] = row[j]; });
                if (layer) properties._layer = layer;
                return { type: 'Feature', geometry, properties };
            } catch (err) {
                if (i === 0) console.warn('[GPKG] Row 0 parse error:', err.message);
                return null;
            }
        }).filter(Boolean);

        console.log('[GPKG] parsed features:', features.length);
        return { type: 'FeatureCollection', features };
    }
}
