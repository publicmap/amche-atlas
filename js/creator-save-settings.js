/**
 * Save settings in the layer editor's edit mode (map-creator.html): where a
 * layer's changes are kept, opened from the title bar beside Save Layer.
 *
 *  - Google Sheet: the sheet the map (or the whole atlas) is read from, with a
 *    Read only switch. Only a sheet-backed route layer can be written to, and
 *    only through the Apps Script `saveUrl` (docs/route-sheets.md); otherwise
 *    the switch stays on and says where writes would be turned on.
 *  - URL: always on - every change rides in the link's `?layers=` entry
 *    (docs/API.md). A bar shows how much of a link's length is used, and lists
 *    the changes the link can't carry (js/layer-customizations.js). Share link
 *    opens the share panel's QR and URL editor (js/share-url-panel.js).
 *  - Export: the Export panel (map-export.html) scoped to this layer.
 */
import { layerCustomizations, formatValue, liveLayer, mapWindow, urlUsage } from './layer-customizations.js';
import { isSheetAtlasUrl } from './sheet-atlas.js';

const GUIDE = 'docs/?page=sheet-atlas';
const esc = (text) => $('<div>').text(String(text ?? '')).html();

export class CreatorSaveSettings {
    constructor(creator) {
        this.creator = creator;
        this.dialog = null;
    }

    init() {
        $('#save-settings-btn').on('click', () => this.open());
    }

    _layer() {
        const page = this.creator.layerPage.layer;
        return (page && liveLayer(page.id)) || page;
    }

    async open() {
        const layer = this._layer();
        if (!layer) return;
        if (!this.dialog) {
            this.dialog = document.createElement('sl-dialog');
            this.dialog.className = 'save-settings-dialog';
            this.dialog.style.setProperty('--width', '480px');
            document.body.appendChild(this.dialog);
        }
        this.dialog.label = `Save settings · ${layer.title || layer.id}`;
        this._render(layer);
        // Shoelace's autoloader defines the dialog once it is in the page
        await customElements.whenDefined('sl-dialog');
        this.dialog.show();
    }

    _render(layer) {
        const $body = $(this.dialog).empty();
        $body.append(this._changes(layer), this._sheet(layer), this._url(layer), this._export(layer));
    }

    _changes(layer) {
        const changes = layerCustomizations(layer);
        if (!changes.length) return $('<p class="ss-lead">').text('This map has no changes over its configured settings.');
        const $list = $('<ul class="ss-changes">');
        changes.forEach(({ field, value, configured }) => {
            $list.append(`<li><span class="ss-field">${esc(field)}</span> <span class="ss-was">${esc(formatValue(configured, 30))}</span> → ${esc(formatValue(value, 60))}</li>`);
        });
        return $('<div class="ss-summary">').append(
            $('<div class="ss-count">').text(`${changes.length} Unsaved Change${changes.length === 1 ? '' : 's'}`),
            $list
        );
    }

    _section(icon, title, ...content) {
        return $('<section class="ss-section">').append(
            $('<h3 class="ss-title">').html(`<sl-icon name="${icon}"></sl-icon><span>${esc(title)}</span>`),
            ...content
        );
    }

    _note(html, variant = 'neutral') {
        return $(`<div class="ss-note ss-${variant}">`).html(html);
    }

    _sheet(layer) {
        const host = mapWindow();
        const atlasParam = new URL(host.location.href).searchParams.get('atlas');
        const atlasSheet = isSheetAtlasUrl(atlasParam) ? atlasParam : null;
        const layerUrl = layer.url || this.creator.layerPage.layer?.url;
        const layerSheet = isSheetAtlasUrl(layerUrl) ? layerUrl : null;
        const sheetUrl = layerSheet || atlasSheet;
        const routes = host.routeSheets?.owns(layer.id) ? host.routeSheets.state(layer.id) : null;
        const guide = `<a href="${GUIDE}" target="_blank" rel="noopener">An atlas in a Google Sheet</a>`;

        const $switch = $('<sl-switch class="ss-switch">Read only</sl-switch>');
        const control = $switch[0];
        control.checked = true;
        control.disabled = true;
        const parts = [];

        if (!sheetUrl) {
            parts.push(this._note(`This map isn't connected to a Google Sheet. See ${guide} to keep an atlas, its maps and routes in a sheet.`));
            return this._section('table', 'Google Sheet', $switch, ...parts);
        }
        parts.push($('<a class="ss-link" target="_blank" rel="noopener">')
            .attr('href', sheetUrl)
            .html(`<sl-icon name="box-arrow-up-right"></sl-icon> ${layerSheet ? 'Open the connected sheet' : 'Open the atlas sheet'}`));

        const fromAtlasTab = atlasSheet && layer.id === 'sheet-routes';
        if (routes && routes.canWrite) {
            control.disabled = false;
            control.checked = host.routeSheets.userReadOnly(layer.id);
            control.addEventListener('sl-change', () => host.routeSheets.setUserReadOnly(layer.id, control.checked));
            parts.push(this._note('Route edits are written to the sheet when you press <b>Save</b> in the routes legend. With Read only on, they stay in the link and Save is hidden. This switch is kept in this browser.'));
            if (fromAtlasTab) parts.push(this._note('Writes go through the Apps Script web app named as <code>saveUrl</code> in the sheet\'s <b>atlas</b> tab. Clear that row to make the sheet read only for everyone.'));
        } else if (routes?.configuredReadOnly) {
            const where = atlasSheet ? 'untick <b>read-only</b> in this map\'s row of the sheet\'s <b>layers</b> tab' : 'set <code>"readOnly": false</code> in this layer\'s Configuration JSON';
            parts.push(this._note(`This map is set to read only, so route edits aren't written to the sheet. To write them back, ${where}, then reload the map.`, 'warning'));
        } else if (routes) {
            const where = fromAtlasTab
                ? 'paste its <code>/exec</code> URL as the <code>saveUrl</code> value in the sheet\'s <b>atlas</b> tab, then reload the map'
                : 'add its <code>/exec</code> URL as <code>saveUrl</code> in this layer\'s Configuration JSON';
            parts.push(this._note(`The sheet is read only: it has no Apps Script web app to write through. To write route edits back, deploy the web app (<a href="${GUIDE}#4-saving-routes-from-amche" target="_blank" rel="noopener">how</a>) and ${where}. A sheet you can only view stays read only either way.`, 'warning'));
        } else {
            const row = atlasSheet && !layerSheet ? 'this map\'s row in the sheet\'s <b>layers</b> tab' : 'the sheet';
            parts.push(this._note(`amche reads this map from a sheet but only writes routes back, so it stays read only${layer.readOnly === false ? ' even with <b>read-only</b> unticked in its row' : ''}. To keep these changes for everyone, copy them into ${row}. See ${guide}.`, 'warning'));
        }
        return this._section('table', 'Google Sheet', $switch, ...parts);
    }

    _url(layer) {
        const usage = urlUsage();
        const percent = Math.min(100, Math.round((usage.length / usage.max) * 100));
        const state = usage.length > usage.max ? 'over' : usage.length > usage.safe ? 'long' : 'ok';
        const $switch = $('<sl-switch class="ss-switch" checked disabled>Saved in the link</sl-switch>');
        const $alert = this._note(`Every change is kept in the map's link (<code>?layers=</code>), and this can't be turned off. Links have a size limit: under ${usage.safe.toLocaleString()} characters works everywhere, including the QR code; past ${usage.max.toLocaleString()} many browsers, servers and apps cut the link short. Long styles and filters use the most.`, state === 'ok' ? 'neutral' : 'warning');
        const $bar = $('<sl-progress-bar class="ss-bar">').attr('value', percent).attr('data-state', state);
        const $label = $('<div class="ss-bar-label">').html(`<span>${usage.length.toLocaleString()} of ${usage.max.toLocaleString()} characters</span><span>${state === 'over' ? 'Over capacity' : state === 'long' ? 'Too long for a QR code' : 'Fits'}</span>`);

        const mine = usage.unsaved.filter(item => item.layer.id === layer.id);
        const others = usage.unsaved.filter(item => item.layer.id !== layer.id);
        const $missing = $('<ul class="ss-changes">');
        [...mine, ...others].forEach(({ layer: l, changes, reason }) => {
            $missing.append(`<li><b>${esc(l.title || l.id)}</b>: ${esc(changes.map(c => c.field).join(', '))}<div class="ss-reason">${esc(reason)}</div></li>`);
        });
        const $status = usage.unsaved.length
            ? $('<div>').append($('<div class="ss-count ss-bad">').text(`Not saved in the link (${usage.unsaved.length})`), $missing)
            : this._note('Every change fits in the link.');

        const $share = $('<sl-button size="small" class="ss-action"><sl-icon slot="prefix" name="qr-code"></sl-icon>Share link…</sl-button>');
        $share.on('click', () => {
            const panel = mapWindow().shareViewPanel;
            if (panel?._sharePanel?.openModal) panel._sharePanel.openModal();
            else panel?.open();
        });
        return this._section('link-45deg', 'URL', $switch, $alert, $bar, $label, $status, $share);
    }

    _export(layer) {
        const $button = $('<sl-button size="small" class="ss-action"><sl-icon slot="prefix" name="download"></sl-icon>Export…</sl-button>');
        $button.on('click', () => {
            this.dialog.hide();
            window.parent.postMessage({ type: 'open-export', layerId: layer.id }, '*');
        });
        return this._section('download', 'Export', this._note('Download the map as a file - GeoJSON, KML, CSV, an image or PDF - to keep or share outside amche.'), $button);
    }
}
