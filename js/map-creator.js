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
        $('#load-url-btn').on('click', () => this.handleURLImport());

        let urlInputTimeout;
        $('#url-input').on('input', (e) => {
            clearTimeout(urlInputTimeout);
            const url = e.target.value.trim();

            if (this.isValidDataUrl(url)) {
                urlInputTimeout = setTimeout(() => {
                    this.handleURLImport();
                }, 1000);
            }
        });

        $('#file-input').on('change', (e) => this.handleFileUpload(e));

        $('#load-custom-btn').on('click', () => this.loadCustomGeoJSON());
        $('#load-upload-btn').on('click', () => this.loadUploadGeoJSON());

        $('#preview-custom-geojson-io-btn').on('click', () => this.previewOnGeojsonIO('custom-geojson-input'));
        $('#preview-upload-geojson-io-btn').on('click', () => this.previewOnGeojsonIO('upload-geojson-input'));
        $('#preview-url-geojson-io-btn').on('click', () => this.previewOnGeojsonIO('url-geojson-input'));

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
    }

    setupColorPickers() {
        $('#fill-color-preview').css('background-color', '#3b82f6');
        $('#stroke-color-preview').css('background-color', '#1e40af');

        const defaultGeoJSON = {
            type: 'FeatureCollection',
            features: []
        };
        $('#custom-geojson-input').val(JSON.stringify(defaultGeoJSON, null, 2));
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
        if (urlLower.endsWith('.geojson')) return true;
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

        $('#load-url-btn').prop('disabled', true).text('Loading...');

        try {
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
        } finally {
            $('#load-url-btn').prop('disabled', false).text('Load Data');
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

    loadCustomGeoJSON() {
        const geojsonText = $('#custom-geojson-input').val().trim();
        if (!geojsonText) {
            alert('Please enter GeoJSON');
            return;
        }

        try {
            const geojson = JSON.parse(geojsonText);
            if (!geojson.type || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
                throw new Error('Invalid GeoJSON: must be a Feature or FeatureCollection');
            }

            this.processGeoJSON(geojson, 'custom-geojson');

            const featureCount = geojson.features ? geojson.features.length : (geojson.type === 'Feature' ? 1 : 0);
            if (featureCount === 0) {
                $('#layer-title').val('Custom Empty Layer');
            } else {
                $('#layer-title').val('Custom Layer');
            }
        } catch (error) {
            alert('Invalid GeoJSON: ' + error.message);
        }
    }

    loadUploadGeoJSON() {
        const geojsonText = $('#upload-geojson-input').val().trim();
        if (!geojsonText) {
            alert('No GeoJSON to load. Upload a file first.');
            return;
        }

        try {
            const geojson = JSON.parse(geojsonText);
            this.processGeoJSON(geojson, 'edited-upload');
        } catch (error) {
            alert('Invalid GeoJSON: ' + error.message);
        }
    }

    previewOnGeojsonIO(textareaId) {
        const geojsonText = $(`#${textareaId}`).val().trim();
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

    processGeoJSON(geojson, sourceName) {
        this.currentData = geojson;
        this.currentDataSource = sourceName;
        this.currentLayerType = 'geojson';

        const geometryType = this.detectGeometryType(geojson);
        this.currentGeometryType = geometryType;

        this.updateDataPreview(geojson);
        this.showStyleSection(geometryType);
        this.showConfigSection();
        this.updateConfigPreview();

        $('#add-to-map-btn').prop('disabled', false);
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

        this.updateDataPreview(geojson);
        this.showStyleSection(geometryType);
        this.showConfigSection();
        this.updateConfigPreview();

        $('#add-to-map-btn').prop('disabled', false);
    }

    showTileLayerSuccess(config) {
        const activeTab = $('.tab-button.active').data('tab');
        let textareaId = 'url-geojson-input';
        if (activeTab === 'upload') {
            textareaId = 'upload-geojson-input';
        } else if (activeTab === 'custom') {
            textareaId = 'custom-geojson-input';
        }

        $(`#${textareaId}`).val(JSON.stringify(config, null, 2));

        $('#style-section').hide();
        $('#config-section').show();

        $('#layer-title').val(config.title || 'Tile Layer');
        $('#layer-description').val(config.description || '');

        this.updateTileConfigPreview(config);
        $('#add-to-map-btn').prop('disabled', false);
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

        const activeTab = $('.tab-button.active').data('tab');
        let textareaId;
        if (activeTab === 'url') {
            textareaId = 'url-geojson-input';
        } else if (activeTab === 'upload') {
            textareaId = 'upload-geojson-input';
        } else {
            textareaId = 'custom-geojson-input';
        }

        $(`#${textareaId}`).val(geojsonText);
    }

    showStyleSection(geometryType) {
        $('#style-section').show();
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
        $('#config-section').show();
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

        const fields = this.extractFields(this.currentData);

        const config = {
            id: this.generateId(title),
            title: title,
            type: 'geojson',
            url: dataUrl,
            initiallyChecked: true,
            style: style,
            inspect: {
                id: 'id',
                title: 'Name',
                label: fields.includes('name') ? 'name' : (fields.includes('Name') ? 'Name' : fields[0] || 'id'),
                fields: fields.slice(0, 6),
                fieldTitles: fields.slice(0, 6).map(f =>
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

        const fields = this.extractFields(this.currentData.geojson);

        const config = {
            id: this.generateId(title),
            title: title,
            type: 'csv',
            url: this.currentData.csvUrl,
            initiallyChecked: true,
            style: style,
            inspect: {
                id: fields.includes('id') ? 'id' : fields[0] || 'id',
                title: 'Name',
                label: fields.includes('name') ? 'name' : (fields.includes('Name') ? 'Name' : fields[0] || 'id'),
                fields: fields.slice(0, 6),
                fieldTitles: fields.slice(0, 6).map(f =>
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
        if (this.currentLayerType === 'csv') {
            const config = this.generateCSVLayerConfig();
            $('#config-preview').val(JSON.stringify(config, null, 2));
            return;
        }

        if (this.currentLayerType !== 'geojson') {
            this.updateTileConfigPreview(this.currentData);
            return;
        }

        const config = this.generateLayerConfig();
        $('#config-preview').val(JSON.stringify(config, null, 2));
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

    generateId(title) {
        const base = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const random = Math.random().toString(36).substring(2, 8);
        return `${base}-${random}`;
    }

    addToMap() {
        let config;
        if (this.currentLayerType === 'geojson' || this.currentLayerType === 'csv') {
            config = this.generateLayerConfig();
        } else {
            config = this.currentData;
        }

        if (!config.title || !config.title.trim()) {
            alert('Please enter a layer title');
            return;
        }

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
