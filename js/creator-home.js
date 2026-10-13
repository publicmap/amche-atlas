/**
 * The Map Maker home screen: what the creator shows when nothing is loaded yet.
 *
 * Three ways in - paste a link (with a format dropdown that lists the supported
 * formats and follows the autodetected one; Enter or pasting imports it), open a
 * file, or pick from the data sources the atlases offer for the current view. Each hands over to the regular form, which stays
 * hidden behind this screen until there is something to edit.
 */

import { renderTitle } from './creator-home-title.js';
import { AtlasPicker } from './creator-home-atlas.js';

export const FORMAT_KEYS = {
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
    'Overpass': 'overpass',
    'WFS': 'wfs',
    'ArcGIS': 'arcgis'
};

const AUTODETECT_LABEL = 'Autodetect';
const DEFAULT_PLACEHOLDER = 'Paste a link to a map, data file or service';

export class CreatorHome {
    constructor(creator) {
        this.creator = creator;
        this.$root = null;
    }

    init() {
        this.$root = $('#creator-home');
        if (!this.$root.length) return;

        this.$input = $('#ch-url');
        this.$formatBtn = $('#ch-format-btn');
        this.$panel = $('#ch-format-panel');
        if (new URLSearchParams(window.location.search).get('mode') === 'layer') return;

        renderTitle(document.getElementById('ch-title'));
        this.picker = new AtlasPicker({
            $list: $('#ch-atlas-list'),
            onUse: (layerId, customize) => {
                this.hide();
                window.parent.postMessage({ type: 'creator-use-layer', layerId, customize }, '*');
            }
        });
        this.buildFormatCards();
        this.bind();
        this.listenForLayerData();
        this.show();
    }

    show() {
        $('body').addClass('home-active');
        setTimeout(() => this.$input.trigger('focus'), 50);
    }

    hide() {
        $('body').removeClass('home-active');
        this.closePanel();
    }

    buildFormatCards() {
        this.$panel.empty();
        $('#formats-help .format-card').each((_, card) => {
            const $card = $(card).clone();
            $card.removeClass('active-format format-chip');
            if (!$card.is('button')) {
                $card.attr('role', 'button').attr('tabindex', 0).addClass('upload-only');
            }
            this.$panel.append($card);
        });
    }

    bind() {
        $('#ch-atlas-btn').on('click', (e) => {
            e.stopPropagation();
            this.closePanel();
            const open = !$('#ch-atlas-panel').hasClass('open');
            this.setAtlasOpen(open);
            if (open) window.parent.postMessage({ type: 'request-layer-data' }, '*');
        });
        $('#ch-close').on('click', () => $('#close-btn').trigger('click'));

        this.$formatBtn.on('click', (e) => {
            e.stopPropagation();
            this.$panel.toggleClass('open');
            this.$formatBtn.attr('aria-expanded', this.$panel.hasClass('open'));
        });
        $(document).on('click', (e) => {
            if (!$(e.target).closest('#ch-format-panel').length) this.closePanel();
            if (!$(e.target).closest('#ch-atlas-panel').length) this.setAtlasOpen(false);
        });
        $(document).on('keydown', (e) => {
            if (e.key !== 'Escape') return;
            this.closePanel();
            this.setAtlasOpen(false);
        });

        $('#ch-atlas-panel').on('click', (e) => e.stopPropagation());
        this.$panel.on('click', '.format-card', (e) => this.pickFormat($(e.currentTarget)));
        this.$input.on('input', () => this.updateDetection());
        this.$input.on('paste', () => setTimeout(() => this.submit({ onlyIfValid: true }), 50));
        this.$input.on('keydown', (e) => {
            if (e.key === 'Enter') this.submit();
        });
        $('#ch-import-btn').on('click', () => $('#file-input').trigger('click'));
        $('#file-input').on('change', (e) => {
            if (e.target.files.length > 0) this.hide();
        });
    }

    setAtlasOpen(open) {
        $('#ch-atlas-panel').toggleClass('open', open);
        $('#ch-atlas-btn').attr('aria-expanded', open);
    }

    listenForLayerData() {
        window.addEventListener('message', (event) => {
            if (event.data?.type === 'layer-data') this.picker.setData(event.data);
            if (event.data?.type === 'bounds-update') this.picker.setBounds(event.data.bounds);
        });
        window.parent.postMessage({ type: 'request-layer-data' }, '*');
    }

    closePanel() {
        this.$panel.removeClass('open');
        this.$formatBtn.attr('aria-expanded', false);
    }

    pickFormat($card) {
        if ($card.hasClass('upload-only')) {
            this.closePanel();
            $('#file-input').trigger('click');
            return;
        }
        if ($card.data('format') === 'overpass') {
            this.hide();
            this.creator.showOverpassSection();
            $('#overpass-query').val(this.creator.getSampleOverpassQuery()).trigger('input').trigger('focus');
            return;
        }
        this.$input.val($card.data('sample')).trigger('input').trigger('focus');
        this.closePanel();
    }

    detect(url) {
        const normalized = this.creator.normalizeGoogleSheetsUrl(url);
        const label = this.creator.detectUrlFormat(normalized);
        return { label, valid: !!label || this.creator.isValidDataUrl(normalized) };
    }

    updateDetection() {
        const url = this.$input.val().trim();
        this.$panel.find('.format-card').removeClass('active-format');
        this.$formatBtn.removeClass('is-detected is-unsupported');
        $('#ch-error').text('');

        if (!url) {
            this.$formatBtn.find('.ch-format-label').text(AUTODETECT_LABEL);
            return;
        }
        const { label, valid } = this.detect(url);
        if (label) {
            this.$formatBtn.addClass('is-detected').find('.ch-format-label').text(label);
            const key = FORMAT_KEYS[label];
            if (key) this.$panel.find(`.format-card[data-format="${key}"]`).addClass('active-format');
        } else {
            this.$formatBtn.addClass(valid ? '' : 'is-unsupported')
                .find('.ch-format-label').text(valid ? 'Data link' : 'Unsupported');
        }
    }

    submit({ onlyIfValid = false } = {}) {
        const url = this.$input.val().trim();
        if (!url) return;
        if (!this.detect(url).valid) {
            if (!onlyIfValid) $('#ch-error').text('This link isn\'t a supported format. Open the format list to see what works.');
            return;
        }
        this.hide();
        const creator = this.creator;
        $('#url-input').val(url).trigger('input');
        clearTimeout(creator._urlInputTimeout);
        creator.handleLoadData();
    }
}
