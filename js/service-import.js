import { ArcgisAPI } from './arcgis-url-api.js';
import { WfsAPI } from './wfs-url-api.js';

const PROVIDERS = { arcgis: ArcgisAPI, wfs: WfsAPI };
const PROVIDER_LABELS = { arcgis: 'ArcGIS REST', wfs: 'WFS' };

const GEOMETRY_ICONS = { point: '📍', multipoint: '📍', polyline: '〰️', polygon: '⬠', envelope: '⬠' };
const KIND_ICONS = { root: '🌐', folder: '📁', service: '🗂️', group: '📂', layer: '▦' };

function normalizeKey(key) {
    let value = String(key || '');
    try { value = decodeURIComponent(value); } catch (error) { /* keep raw */ }
    return value.toLowerCase().replace(/\/$/, '');
}

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nodeIcon(node) {
    if (node.kind === 'layer' && node.geometryType) {
        return GEOMETRY_ICONS[node.geometryType.replace('esriGeometry', '').toLowerCase()] || KIND_ICONS.layer;
    }
    return KIND_ICONS[node.kind] || KIND_ICONS.layer;
}

/**
 * Tree browser for service directories (ArcGIS REST, WFS) plus the glue that
 * turns a picked layer into a creator layer. The creator hands over a
 * `needs-input` / `ok` result's `service` payload via show(); everything
 * from there (browsing, picking another layer, switching the output format)
 * lives here so map-creator.js only needs a couple of hooks.
 */
export class ServiceImport {
    constructor(creator) {
        this.creator = creator;
        this.state = null;
        this._token = 0;
    }

    isActive() {
        return !!this.state;
    }

    get api() {
        return PROVIDERS[this.state.provider];
    }

    async show(service, description = null) {
        const { provider, parsed } = service;
        const api = PROVIDERS[provider];
        this.state = { provider, parsed, description, inheritStyle: true, sourceUrl: description ? description.parsed.url || description.config.url : null };

        const rootNode = api.rootNode(parsed);
        this._renderBrowser(provider, rootNode);

        if (description) await this.applyDescription(description);
        else this.creator.setLoadingState('success');

        const path = api.ancestorUrls ? api.ancestorUrls(parsed) : [rootNode.key];
        const selectedKey = provider === 'arcgis'
            ? (parsed.kind === 'layer' ? parsed.url : null)
            : (parsed.typeName ? `wfs:${parsed.endpoint}#${parsed.typeName}` : null);
        await this._expandTo(path.slice(1), selectedKey);
    }

    reset() {
        this.state = null;
        this._token++;
        $('#service-browser-container').remove();
        $('#service-output-section').hide();
    }

    _renderBrowser(provider, rootNode) {
        $('#service-browser-container').remove();
        const html = `
            <div id="service-browser-container" class="mt-4 p-3 rounded-lg" style="background:#111827;border:1px solid #374151;">
                <div class="flex items-center justify-between mb-2 gap-2">
                    <div class="text-sm font-semibold" style="color:#bfdbfe;">${PROVIDER_LABELS[provider]} layers</div>
                    <input type="text" id="service-tree-filter" placeholder="Filter loaded layers…"
                        class="px-2 py-1 rounded text-xs w-44">
                </div>
                <div id="service-tree" class="scrollbar-thin text-sm" style="max-height:260px;overflow-y:auto;"></div>
                <div id="service-tree-status" class="text-xs mt-2" style="color:#9ca3af;">Pick a layer to load it.</div>
            </div>`;
        $('#load-data-btn').after(html);

        const $root = this._renderNode(rootNode, 0);
        $('#service-tree').append($('<ul class="service-tree-list"></ul>').append($root));
        $('#service-tree-filter').on('input', e => this._applyFilter(e.target.value));
    }

    _renderNode(node, depth) {
        const expandable = !node.selectable;
        const $li = $('<li></li>').data('node', node);
        const caret = expandable ? '<span class="service-caret inline-block w-4 text-center" style="color:#9ca3af;">▸</span>' : '<span class="inline-block w-4"></span>';
        const hint = node.hint ? `<span class="ml-2 text-xs" style="color:#6b7280;">${escapeHtml(node.hint)}</span>` : '';
        const $row = $(`
            <div class="service-row flex items-center py-1 px-1 rounded cursor-pointer" style="padding-left:${depth * 14 + 4}px;">
                ${caret}<span class="mr-1.5">${nodeIcon(node)}</span>
                <span class="truncate" style="color:#f3f4f6;">${escapeHtml(node.name)}</span>${hint}
            </div>`);
        $row.on('mouseenter', () => { if (!$row.hasClass('is-selected')) $row.css('background', '#1f2937'); })
            .on('mouseleave', () => { if (!$row.hasClass('is-selected')) $row.css('background', ''); });
        $row.on('click', () => (node.selectable ? this._pick(node, $row) : this._toggle(node, $li)));
        $li.append($row).append('<ul class="service-children" style="display:none;"></ul>');
        $li.data('depth', depth);
        return $li;
    }

    async _toggle(node, $li, forceOpen = false) {
        if (node.loading) await node.loading;
        const $kids = $li.children('ul');
        const $caret = $li.children('.service-row').find('.service-caret');
        const open = forceOpen || !$kids.is(':visible');

        if (node.loaded) {
            $kids.toggle(open);
            $caret.text(open ? '▾' : '▸');
            return;
        }

        node.loaded = true;
        $caret.text('▾');
        $kids.show().html('<li class="text-xs py-1" style="color:#9ca3af;padding-left:28px;">Loading…</li>');
        node.loading = (async () => {
            try {
                node.children = node.children || await this.api.listChildren(node);
                $kids.empty();
                const depth = $li.data('depth') + 1;
                node.children.forEach(child => $kids.append(this._renderNode(child, depth)));
                if (!node.children.length) {
                    $kids.html('<li class="text-xs py-1" style="color:#9ca3af;padding-left:28px;">Nothing browsable here</li>');
                }
            } catch (error) {
                node.loaded = false;
                $caret.text('▸');
                $kids.html(`<li class="text-xs py-1" style="color:#fca5a5;padding-left:28px;">${escapeHtml(error.message)}</li>`);
            }
        })();
        await node.loading;
        node.loading = null;
    }

    async _expandTo(path, selectedKey) {
        let $li = $('#service-tree > ul > li').first();
        let node = $li.data('node');
        for (const key of path) {
            await this._toggle(node, $li, true);
            const index = (node.children || []).findIndex(child => normalizeKey(child.key) === normalizeKey(key));
            if (index < 0) return;
            node = node.children[index];
            $li = $li.children('ul').children('li').eq(index);
        }
        await this._toggle(node, $li, true);

        if (!selectedKey) return;
        const index = (node.children || []).findIndex(child => normalizeKey(child.key) === normalizeKey(selectedKey));
        if (index < 0) return;
        const $row = $li.children('ul').children('li').eq(index).children('.service-row');
        this._markSelected($row);
        $row[0]?.scrollIntoView?.({ block: 'nearest' });
    }

    _markSelected($row) {
        $('#service-tree .service-row.is-selected').removeClass('is-selected').css('background', '');
        $row.addClass('is-selected').css('background', '#1e3a8a');
    }

    _applyFilter(text) {
        const query = text.trim().toLowerCase();
        $('#service-tree li').each(function () {
            const $li = $(this);
            if (!$li.data('node')) return;
            const own = $li.children('.service-row').text().toLowerCase();
            const nested = $li.find('li .service-row').text().toLowerCase();
            $li.toggle(!query || own.includes(query) || nested.includes(query));
        });
    }

    async _pick(node, $row) {
        this._markSelected($row);
        const { provider, parsed } = this.state;
        const token = ++this._token;
        $('#service-tree-status').text(`Loading ${node.name}…`);
        this.creator.setLoadingState('loading');
        try {
            const description = provider === 'arcgis'
                ? await ArcgisAPI.describeLayer(node.url, { where: node.url === parsed.url ? undefined : null, inheritStyle: this.state.inheritStyle })
                : await WfsAPI.describeLayer(node.url, { typeName: node.typeName });
            if (token !== this._token) return;
            this.state.sourceUrl = provider === 'arcgis' ? node.url : description.config.url;
            await this.applyDescription(description);
            $('#service-tree-status').text(`Loaded ${node.name}. Pick another layer to switch.`);
        } catch (error) {
            if (token !== this._token) return;
            $('#service-tree-status').html(`<span style="color:#fca5a5;">${escapeHtml(error.message)}</span>`);
            this.creator.setLoadingState('error');
        }
    }

    async applyDescription(description) {
        this.state.description = description;
        this._renderOutputSection(description);
        await this._applyOutput(description);
    }

    _renderOutputSection(description) {
        const $select = $('#service-output-select').empty();
        description.outputs.forEach(option => {
            const recommended = option.id === description.output ? ' (selected)' : '';
            $select.append($('<option></option>').val(option.id).text(option.label + recommended));
        });
        $select.val(description.output);
        this._updateOutputHint(description);
        this._renderStyleSection(description);
        const count = description.count;
        $('#service-output-count').text(count === null ? '' : `${count.toLocaleString()} feature${count === 1 ? '' : 's'}`);
        $('#service-output-section').show();
    }

    // Offered only when the service actually carries symbology to inherit.
    _renderStyleSection(description) {
        const info = description.styleInfo;
        const available = !!(info && (info.style || info.warnings.length));
        $('#service-style-section').toggle(available);
        if (!available) return;

        $('#service-style-inherit').prop('checked', this.state.inheritStyle).prop('disabled', !info.style);
        const notes = [info.summary, ...info.warnings.map(w => `Approximated: ${w}`)].filter(Boolean);
        $('#service-style-note').text(notes.join(' · '));
    }

    async setInheritStyle(inherit) {
        this.state.inheritStyle = inherit;
        await this.changeOutput(this.state.description.output);
    }

    _updateOutputHint(description) {
        const option = description.outputs.find(o => o.id === $('#service-output-select').val());
        $('#service-output-hint').text(option ? option.hint : '');
    }

    async changeOutput(output) {
        const { provider, description, parsed } = this.state;
        this.creator.setLoadingState('loading');
        try {
            const url = provider === 'arcgis' ? description.parsed.url : description.config.url;
            const next = provider === 'arcgis'
                ? await ArcgisAPI.describeLayer(url, { output, where: description.where, inheritStyle: this.state.inheritStyle })
                : await WfsAPI.describeLayer(url, { typeName: description.parsed.typeName, output });
            this.state.description = next;
            this._renderStyleSection(next);
            this._updateOutputHint(next);
            await this._applyOutput(next);
        } catch (error) {
            alert('Could not switch output: ' + error.message);
            this.creator.setLoadingState('error');
        }
    }

    async _applyOutput(description) {
        const creator = this.creator;
        const { config, fields, allFields, geometryTypes } = description;
        const sourceUrl = this.state.sourceUrl || config.url;

        if (description.output === 'snapshot') {
            const api = this.state.provider === 'arcgis' ? ArcgisAPI : WfsAPI;
            $('#service-output-hint').text('Downloading features…');
            const geojson = await api.fetchAllFeatures(config, {
                onProgress: (done, total) => $('#service-output-hint').text(`Downloading features… ${done}${total ? ` / ${total}` : ''}`)
            });
            this._updateOutputHint(description);
            if (!geojson.features.length) throw new Error('The layer returned no features');
            creator.processGeoJSON(geojson, `${this.state.provider}-snapshot`);
            $('#layer-title').val(config.title);
            $('#layer-id').val(config.id);
            $('#layer-description').val(config.description || '');
            $('#layer-attribution').val(config.attribution || '');
            creator.updateConfigPreview();
            return;
        }

        creator.currentLayerType = config.type === 'geojson' ? 'geojson-url' : config.type;
        creator.currentData = config;
        creator.currentDataSource = sourceUrl;
        creator.showTileLayerSuccess(config);

        // showTileLayerSuccess rebuilds the style from the simple controls; the
        // service's own symbology has to survive that, so hold it as an edit.
        if (config.style) {
            creator._styleManuallyEdited = true;
            creator.currentData = { ...creator.currentData, style: config.style };
        }

        if (config.type === 'tms') return;
        creator.autoCheckStyleTypes(geometryTypes);
        const labelField = config.inspect?.label;
        creator.populateLabelFieldOptions(fields, labelField);
        creator.populateDataFields(allFields.length ? allFields : fields, config.inspect?.id, labelField);
        const inspected = new Set(config.inspect?.fields || []);
        $('#inspect-fields-list input[type="checkbox"]').each((_, el) => { el.checked = inspected.has(el.value); });
        creator.updateInspectFieldsToggleLabel();
        creator.updateConfigPreview();
    }
}
