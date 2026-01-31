import { DataUtils, GeoUtils } from './map-utils.js';
import { KMLConverter } from './kml-converter.js';
import { LayerConfigGenerator } from './layer-creator-ui.js';

export class MapCreator {
    constructor() {
        this.currentData = null;
        this.currentGeometryType = null;
        this.currentDataSource = null;
        this.currentLayerType = null;
    }

    init() {
        this.setupTabNavigation();
        this.setupEventListeners();
        this.setupColorPickers();
    }

    setupTabNavigation() {
        $('.tab-button').on('click', (e) => {
            const tabName = $(e.currentTarget).data('tab');
            this.switchTab(tabName);
        });
    }

    switchTab(tabName) {
        $('.tab-button').removeClass('active');
        $(`.tab-button[data-tab="${tabName}"]`).addClass('active');
        $('.tab-content').removeClass('active');
        $(`#tab-${tabName}`).addClass('active');
    }

    setupEventListeners() {
        $('#load-data-btn').on('click', () => this.handleLoadData());

        let urlInputTimeout;
        $('#url-input').on('input', (e) => {
            clearTimeout(urlInputTimeout);
            const url = e.target.value.trim();

            if (url) {
                $('#clear-url-btn').removeClass('hidden');
            } else {
                $('#clear-url-btn').addClass('hidden');
                $('#url-validation').html('');
                return;
            }

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
                    'Amche Atlas JSON': 'atlas-json'
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
        });

        $('#file-input').on('change', (e) => {
            this.handleFileUpload(e);
        });


        $('#preview-geojson-io-btn').on('click', () => this.previewOnGeojsonIO());
        $('#download-geojson-btn').on('click', () => this.downloadGeoJSON());

        $('#fill-color').on('input', (e) => {
            $('#fill-color-preview').css('background-color', e.target.value);
            this.updateConfigPreview();
        });

        $('#stroke-color').on('input', (e) => {
            $('#stroke-color-preview').css('background-color', e.target.value);
            this.updateConfigPreview();
        });

        $('#stroke-width').on('input', (e) => {
            $('#stroke-width-value').text(e.target.value);
            this.updateConfigPreview();
        });

        $('#layer-title, #layer-description').on('input', () => {
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
            $('#url-input').val(sampleUrl).trigger('input').focus();
        });

        $('#feature-id-field, #feature-name-field').on('change', () => {
            this.updateConfigPreview();
        });

        $('#inspect-fields-list').on('change', 'input[type="checkbox"]', () => {
            this.updateConfigPreview();
        });

        $('#copy-inline-btn').on('click', () => {
            const url = $('#inline-url').val();
            navigator.clipboard.writeText(url).then(() => {
                const $btn = $('#copy-inline-btn');
                $btn.text('Copied!').removeClass('bg-blue-600 hover:bg-blue-700').addClass('bg-green-600');
                setTimeout(() => {
                    $btn.text('Copy').removeClass('bg-green-600').addClass('bg-blue-600 hover:bg-blue-700');
                }, 2000);
            });
        });
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

    detectUrlFormat(url) {
        const urlLower = url.toLowerCase();

        if (this.isCSVUrl(url)) {
            return 'CSV';
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
        if (urlLower.includes('{z}') && (urlLower.includes('.pbf') || urlLower.includes('.mvt'))) {
            return 'Vector Tiles';
        }
        if (urlLower.includes('{z}') && (urlLower.includes('.png') || urlLower.includes('.jpg'))) {
            return 'Raster Tiles';
        }
        if (urlLower.includes('mapwarper.net/maps/')) {
            return 'MapWarper';
        }
        return null;
    }

    setupColorPickers() {
        $('#fill-color-preview').css('background-color', '#3b82f6');
        $('#stroke-color-preview').css('background-color', '#1e40af');

        const defaultGeoJSON = {
            type: 'FeatureCollection',
            features: []
        };
        $('#geojson-editor').val(JSON.stringify(defaultGeoJSON, null, 2));
    }

    handleLoadData() {
        const activeTab = $('.tab-button.active').data('tab');
        if (activeTab === 'url') {
            this.handleURLImport();
        } else if (activeTab === 'upload') {
            const fileInput = $('#file-input')[0];
            if (fileInput.files.length === 0) {
                alert('Please select a file to upload');
                return;
            }
        }
    }

    isCSVUrl(url) {
        const urlLower = url.toLowerCase();
        if (urlLower.endsWith('.csv')) {
            return true;
        }
        if (urlLower.includes('output=csv')) {
            return true;
        }
        if (urlLower.includes('docs.google.com/spreadsheets') && urlLower.includes('output=csv')) {
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

        if (this.isCSVUrl(url)) return true;
        if (urlLower.includes('jsonkeeper.com/b/')) return true;
        if (urlLower.endsWith('.geojson')) return true;
        if (urlLower.endsWith('.json')) return true;
        if (urlLower.endsWith('.kml')) return true;
        if (urlLower.includes('{z}') && (urlLower.includes('.pbf') || urlLower.includes('.mvt'))) return true;
        if (urlLower.includes('{z}') && (urlLower.includes('.png') || urlLower.includes('.jpg'))) return true;
        if (urlLower.includes('mapwarper.net/maps/')) return true;
        if (urlLower.includes('vector.openstreetmap.org')) return true;
        if (urlLower.includes('earthengine.googleapis.com') && urlLower.includes('/tiles/')) return true;
        if (urlLower.startsWith('mapbox://')) return true;
        if (/^[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(url)) return true;

        return false;
    }

    async handleURLImport() {
        const url = $('#url-input').val().trim();
        if (!url) {
            alert('Please enter a URL');
            return;
        }

        this.setLoadingState('loading');

        try {
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
                const rows = DataUtils.parseCSV(csvText);
                const geojson = GeoUtils.rowsToGeoJSON(rows);
                if (!geojson) {
                    throw new Error('Could not find lat/lng columns in CSV');
                }
                this.processCSVLayer(url, geojson, rows);
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
                    const rows = DataUtils.parseCSV(csvText);
                    const geojson = GeoUtils.rowsToGeoJSON(rows);
                    if (!geojson) {
                        throw new Error('Could not find lat/lng columns in CSV');
                    }
                    this.processGeoJSON(geojson, url);
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

        // Set default title
        if (!$('#layer-title').val()) {
            $('#layer-title').val(atlasData.name || 'Imported Atlas');
        }

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
                    .html('<span class="inline-flex items-center gap-2">✓ Data Loaded</span>');
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

        if (file.size > 5 * 1024 * 1024) {
            alert('Warning: Large file may cause performance issues');
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target.result;
                const ext = file.name.split('.').pop().toLowerCase();

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
        this.currentData = geojson;
        this.currentDataSource = sourceName;
        this.currentLayerType = 'geojson';

        const geometryType = this.detectGeometryType(geojson);
        this.currentGeometryType = geometryType;

        const fields = this.extractFields(geojson);
        this.populateDataFields(fields);

        this.updateDataPreview(geojson);
        this.showStyleSection(geometryType);
        this.showConfigSection();

        if (sourceName === 'edited') {
            return;
        }

        this.updateConfigPreview();
        $('#add-to-map-btn').prop('disabled', false);
        this.setLoadingState('success');
    }

    processCSVLayer(csvUrl, geojson, rows) {
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

        this.updateDataPreview(geojson);
        this.showStyleSection(geometryType);
        this.showConfigSection();

        if (csvUrl.includes('docs.google.com/spreadsheets')) {
            $('#layer-title').val('Google Sheet CSV');
            $('#layer-description').val(`Data from Google Sheets - <a href="${csvUrl}" target="_blank">View source</a>`);
        }

        this.updateConfigPreview();
        $('#add-to-map-btn').prop('disabled', false);
        this.setLoadingState('success');
    }

    showTileLayerSuccess(config) {
        $('#data-preview-details').hide();
        $('#settings-section').show();

        $('#layer-title').val(config.title || 'Tile Layer');
        $('#layer-description').val(config.description || '');

        this.updateTileConfigPreview(config);
        $('#add-to-map-btn').prop('disabled', false);
        this.setLoadingState('success');
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

    showStyleSection(geometryType) {
        $('#settings-section').show();
        $('#geometry-type-info').text(`Detected geometry type: ${geometryType}`);

        if (geometryType === 'Point') {
            $('#fill-color-control').show();
            $('#stroke-color-control').show();
            $('#stroke-width-control').show().find('label').html(
                'Point Size: <span id="stroke-width-value">2</span>px'
            );
        } else if (geometryType === 'LineString') {
            $('#fill-color-control').hide();
            $('#stroke-color-control').show();
            $('#stroke-width-control').show().find('label').html(
                'Line Width: <span id="stroke-width-value">2</span>px'
            );
        } else if (geometryType === 'Polygon') {
            $('#fill-color-control').show();
            $('#stroke-color-control').show();
            $('#stroke-width-control').show().find('label').html(
                'Stroke Width: <span id="stroke-width-value">2</span>px'
            );
        }
    }

    showConfigSection() {
        $('#settings-section').show();
        if (!$('#layer-title').val()) {
            $('#layer-title').val(this.generateDefaultTitle());
        }
    }

    generateDefaultTitle() {
        if (typeof this.currentDataSource === 'string') {
            const filename = this.currentDataSource.split('/').pop().split('?')[0];
            return filename.replace(/\.(geojson|json|csv|kml)$/i, '').replace(/[-_]/g, ' ');
        }
        return 'Custom Layer';
    }

    generateMapboxStyle(geometryType, fillColor, strokeColor, strokeWidth) {
        const style = {};

        if (geometryType === 'Polygon') {
            style['fill-color'] = fillColor;
            style['fill-opacity'] = 0.6;
            style['line-color'] = strokeColor;
            style['line-width'] = parseFloat(strokeWidth);
        } else if (geometryType === 'LineString') {
            style['line-color'] = strokeColor;
            style['line-width'] = parseFloat(strokeWidth);
        } else if (geometryType === 'Point') {
            style['circle-color'] = fillColor;
            style['circle-radius'] = parseFloat(strokeWidth) * 2;
            style['circle-stroke-color'] = strokeColor;
            style['circle-stroke-width'] = 2;
        }

        return style;
    }

    generateLayerConfig() {
        if (this.currentLayerType === 'csv') {
            return this.generateCSVLayerConfig();
        }

        if (this.currentLayerType !== 'geojson') {
            return this.currentData;
        }

        const title = $('#layer-title').val().trim() || 'Custom Layer';
        const description = $('#layer-description').val().trim();
        const fillColor = $('#fill-color').val();
        const strokeColor = $('#stroke-color').val();
        const strokeWidth = $('#stroke-width').val();

        const geojsonString = JSON.stringify(this.currentData);
        const base64Data = btoa(unescape(encodeURIComponent(geojsonString)));
        const dataUrl = `data:application/json;base64,${base64Data}`;

        const style = this.generateMapboxStyle(this.currentGeometryType, fillColor, strokeColor, strokeWidth);

        const idField = $('#feature-id-field').val() || 'id';
        const nameField = $('#feature-name-field').val() || 'name';
        const selectedFields = [];
        $('#inspect-fields-list input:checked').each(function() {
            selectedFields.push($(this).val());
        });

        const config = {
            id: this.generateId(title),
            title: title,
            type: 'geojson',
            url: dataUrl,
            initiallyChecked: false,
            style: style,
            inspect: {
                id: idField,
                title: 'Name',
                label: nameField,
                fields: selectedFields.length > 0 ? selectedFields : [idField, nameField],
                fieldTitles: (selectedFields.length > 0 ? selectedFields : [idField, nameField]).map(f =>
                    f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                )
            }
        };

        if (description) {
            config.description = description;
        }

        return config;
    }

    generateCSVLayerConfig() {
        const title = $('#layer-title').val().trim() || 'Custom CSV Layer';
        const description = $('#layer-description').val().trim();
        const fillColor = $('#fill-color').val();
        const strokeColor = $('#stroke-color').val();
        const strokeWidth = $('#stroke-width').val();

        const style = this.generateMapboxStyle(this.currentGeometryType, fillColor, strokeColor, strokeWidth);

        const idField = $('#feature-id-field').val() || 'id';
        const nameField = $('#feature-name-field').val() || 'name';
        const selectedFields = [];
        $('#inspect-fields-list input:checked').each(function() {
            selectedFields.push($(this).val());
        });

        const config = {
            id: this.generateId(title),
            title: title,
            type: 'csv',
            url: this.currentData.csvUrl,
            initiallyChecked: false,
            style: style,
            inspect: {
                id: idField,
                title: 'Name',
                label: nameField,
                fields: selectedFields.length > 0 ? selectedFields : [idField, nameField],
                fieldTitles: (selectedFields.length > 0 ? selectedFields : [idField, nameField]).map(f =>
                    f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                )
            }
        };

        if (description) {
            config.description = description;
        }

        return config;
    }

    updateTileConfigPreview(baseConfig) {
        const title = $('#layer-title').val().trim() || baseConfig.title;
        const description = $('#layer-description').val().trim() || baseConfig.description;

        const config = {
            ...baseConfig,
            title: title,
            description: description
        };

        if (!description) {
            delete config.description;
        }

        this.currentData = config;
        $('#config-preview').val(JSON.stringify(config, null, 2));
    }

    updateConfigPreview() {
        let config;

        if (this.currentLayerType === 'csv') {
            config = this.generateCSVLayerConfig();
            $('#config-preview').val(JSON.stringify(config, null, 2));
        } else if (this.currentLayerType !== 'geojson') {
            this.updateTileConfigPreview(this.currentData);
            return;
        } else {
            config = this.generateLayerConfig();
            $('#config-preview').val(JSON.stringify(config, null, 2));
        }

        const baseUrl = window.location.origin + window.location.pathname;
        const configJson = JSON.stringify(config).replace(/"/g, "'");
        const inlineUrl = `${baseUrl}?layers=${encodeURIComponent(configJson)}`;
        $('#inline-url').val(inlineUrl);
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
        if (!fields || fields.length === 0) {
            $('#data-fields-section').hide();
            return;
        }

        $('#data-fields-section').show();

        const $idSelect = $('#feature-id-field');
        const $nameSelect = $('#feature-name-field');
        const $fieldsList = $('#inspect-fields-list');

        $idSelect.empty().append('<option value="">Select field...</option>');
        $nameSelect.empty().append('<option value="">Select field...</option>');
        $fieldsList.empty();

        const defaultId = this.getDefaultIdField(fields);
        const defaultName = this.getDefaultNameField(fields);

        fields.forEach(field => {
            $idSelect.append(`<option value="${field}" ${field === defaultId ? 'selected' : ''}>${field}</option>`);
            $nameSelect.append(`<option value="${field}" ${field === defaultName ? 'selected' : ''}>${field}</option>`);

            const $checkbox = $(`
                <label class="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <input type="checkbox" value="${field}" checked class="rounded">
                    <span>${field}</span>
                </label>
            `);
            $fieldsList.append($checkbox);
        });
    }

    generateId(title) {
        const base = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const random = Math.random().toString(36).substring(2, 8);
        return `${base}-${random}`;
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
        } else {
            config = this.currentData;
        }

        console.log('[MapCreator] Generated config:', config);

        if (!config.title || !config.title.trim()) {
            alert('Please enter a layer title');
            return;
        }

        console.log('[MapCreator] Sending add-custom-layer message to parent');
        window.parent.postMessage({
            type: 'add-custom-layer',
            config: config
        }, '*');
    }

    returnToBrowser() {
        window.parent.postMessage({
            type: 'return-to-browser'
        }, '*');
    }

    closeBrowser() {
        window.parent.postMessage({
            type: 'close-browser'
        }, '*');
    }
}
