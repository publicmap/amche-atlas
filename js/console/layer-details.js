/**
 * Layer details - a page inside Find (js/console/find-panel.js) for one map:
 * what it is, whether it is on and how strongly, what it can do on the map,
 * its legend, the features of it in view, and where it sits in the stack.
 * Its bar is the console's navigation while it is open (the atlas label and
 * search step aside): back, and where it was opened from › this map. It heads
 * with the same row the map has in Find's results - the whole row and its eye
 * turn the map on or off - and opening it turns the map on unless asked not to.
 * It replaces the layer editor's read-only Overview; Edit still opens the full
 * editor (map-creator.html).
 *
 * The map actions go through the same window messages the editor's header
 * (js/layer-header.js) posts, so MapFeatureControl handles them unchanged.
 * Registry layers carry atlas-prefixed ids (goa-local-body); everything that
 * addresses the map uses the live layer's group id (local-body) instead - see
 * MapBrowserControl._resolveLiveLayer.
 */
import { el, icon, sectionLabel, row, iconThumb, chevron, hint, layerThumb, richText, linkButton } from './find-rows.js';
import { isLayerActive, setLayerActive, layerEye, atlasName, plainText } from './find-browse.js';
import { LayerThumbnail } from '../layer-thumbnail.js';
import { LayerLegend } from '../layer-legend.js';
import { ruleFilter } from '../rule-legend.js';
import { LayerOrderManager } from '../layer-order-manager.js';
import { LayerActions } from './layer-actions.js';
import { RasterAdjust } from '../raster-adjust.js';
import { isStarred, setStarred } from '../starred-layers.js';

const FEATURE_LIMIT = 6;
const DESC_FOLD = 220;
const post = (message) => window.postMessage(message, '*');

export class LayerDetails {
    constructor({ onBack, onSelectFeature } = {}) {
        this._onBack = onBack;
        this._onSelectFeature = onSelectFeature;
        this._layer = null;
        this.el = el('div', 'console-details');
        this.el.hidden = true;
        this._actions = new LayerActions({ onChange: () => this.refresh() });
        // A slider dragged here changes the layer, and the map's update redraws
        // this page: hold the redraw until the pointer is let go, or the drag
        // loses the slider under it.
        this.el.addEventListener('pointerdown', () => {
            this._pressed = true;
            const release = () => {
                window.removeEventListener('pointerup', release, true);
                window.removeEventListener('pointercancel', release, true);
                this._pressed = false;
                this._resumeRefresh();
            };
            window.addEventListener('pointerup', release, true);
            window.addEventListener('pointercancel', release, true);
        });
        // An open colour picker would close if the page were redrawn under it
        this.el.addEventListener('sl-show', () => { this._pickerOpen = true; });
        this.el.addEventListener('sl-after-hide', () => {
            this._pickerOpen = false;
            this._resumeRefresh();
        });
    }

    get _holding() {
        return !!(this._pressed || this._pickerOpen);
    }

    _resumeRefresh() {
        if (!this._holding && this._heldRefresh) this.refresh();
    }

    get isOpen() {
        return !!this._layer;
    }

    get layer() {
        return this._layer;
    }

    /** @param {{from?: string, activate?: boolean}} [options] - from: the view it was opened from, named in the breadcrumb */
    open(layer, { from = '', activate = true } = {}) {
        this._release();
        this._layer = layer;
        if (activate && !isLayerActive(layer)) setLayerActive(layer, true);
        this._from = from;
        this._backLabel = from ? `Back to ${from}` : 'Back';
        this._descOpen = false;
        this.el.hidden = false;
        this.render();
        this.el.scrollTop = 0;
    }

    close() {
        this._release();
        this._layer = null;
        this._raster = null;
        this._pressed = this._pickerOpen = false;
        this.el.hidden = true;
        this.el.replaceChildren();
    }

    refresh() {
        this._heldRefresh = this._holding;
        if (this._layer && !this._holding) this.render();
    }

    // A copy, as the editor gets: the legend and thumbnail resolve style values
    // in place, and the live layer shares its style object with the map's own
    // config, which isolation dims from.
    _live() {
        const live = window.browserControl?._resolveLiveLayer?.(this._layer) || this._layer;
        try {
            return JSON.parse(JSON.stringify(live));
        } catch (error) {
            return { ...live };
        }
    }

    _release() {
        window.browserControl?._clearLegendFilter?.();
        this._actions.release();
    }

    render() {
        const layer = this._layer;
        const live = this._live();
        const on = isLayerActive(layer) || isLayerActive(live);
        const title = live.title || live.name || live.id;
        this.el.replaceChildren();

        // The console's navigation while the page is open: back, then where it
        // was opened from › this map
        const bar = el('div', 'console-details-bar');
        const back = el('button', 'console-back');
        back.type = 'button';
        back.title = `${this._backLabel} ( Esc )`;
        back.setAttribute('aria-label', this._backLabel);
        const crumb = el('span', 'console-crumb');
        if (this._from) crumb.append(el('span', 'console-crumb-from', this._from), el('span', 'console-crumb-sep', '›'));
        crumb.appendChild(el('span', 'console-crumb-current', title));
        back.append(icon('arrow-left'), crumb);
        back.addEventListener('click', () => this._onBack?.());
        const close = el('button', 'console-btn console-details-close');
        close.type = 'button';
        close.title = 'Close and go back to the results ( Esc )';
        close.setAttribute('aria-label', close.title);
        close.appendChild(icon('x-lg'));
        close.addEventListener('click', () => this._onBack?.());
        bar.append(back, this._starButton(live), close);
        this.el.appendChild(bar);

        const path = [live._sourceAtlas && atlasName(live._sourceAtlas), ...(live.tags || [])].filter(Boolean).join(' › ');
        const toggle = () => setLayerActive(layer, !(isLayerActive(layer) || isLayerActive(this._live())));
        const head = row({
            thumb: layerThumb(live),
            title,
            meta: path,
            trailing: layerEye(layer, { on }),
            className: 'console-details-row' + (on ? ' selected' : ''),
            onClick: toggle
        });
        head.title = on ? `${title} is on the map - click to hide it` : `Show ${title} on the map`;
        this.el.appendChild(head);

        // The whole description, its links live; a long one folds to a few lines
        const desc = richText(live.description, 'console-details-desc' + (this._descOpen ? ' open' : ''));
        if (desc) {
            this.el.appendChild(desc);
            if (plainText(live.description).length > DESC_FOLD) {
                const more = linkButton(this._descOpen ? 'Show less' : 'Show more', () => {
                    this._descOpen = !this._descOpen;
                    this.render();
                });
                more.classList.add('console-details-more');
                this.el.appendChild(more);
            }
        }

        if (on) this.el.appendChild(this._opacityRow(live));
        if (on && RasterAdjust.isRaster(live)) this.el.appendChild(this._rasterSection(live));
        this.el.appendChild(this._actions.render(live, on));

        const legend = LayerLegend.generate(live, { onPreview: on ? (ruleId) => this._previewRule(live, ruleId) : undefined });
        if (legend) {
            const section = el('section', 'console-section');
            const holder = el('div', 'console-legend');
            holder.appendChild(legend);
            section.append(sectionLabel('Legend'), holder);
            this.el.appendChild(section);
        }

        if (on) this._featuresSection(live);
        this.el.appendChild(this._about(live, on));
    }

    _opacityRow(live) {
        const wrap = el('div', 'console-visibility');
        wrap.appendChild(el('span', 'console-visibility-label', 'Opacity'));
        const pct = Math.round((live.opacity ?? 1) * 100);
        const slider = el('input', 'console-opacity');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = String(pct);
        slider.setAttribute('aria-label', 'Opacity');
        const value = el('span', 'console-opacity-value', `${pct}%`);
        slider.addEventListener('input', () => {
            value.textContent = `${slider.value}%`;
            post({ type: 'update-layer-opacity', layerId: live.id, opacity: slider.value / 100 });
        });
        wrap.append(slider, value);
        return wrap;
    }

    // Kept across redraws of the page so a dragged slider or an open colour
    // picker isn't swapped out from under the pointer; only its values update.
    _rasterSection(live) {
        if (this._raster?.id !== live.id) {
            const details = el('details', 'console-raster');
            details.open = !!this._rasterOpen;
            details.addEventListener('toggle', () => { this._rasterOpen = details.open; });
            details.appendChild(el('summary', 'console-raster-summary', 'Image adjustments'));
            const body = el('div', 'console-raster-body');
            const adjust = new RasterAdjust({ post, buttonClass: 'console-action' });
            adjust.mount(body);
            details.appendChild(body);
            this._raster = { id: live.id, details, adjust };
        }
        this._raster.adjust.render(live);
        return this._raster.details;
    }

    _previewRule(live, ruleId) {
        const control = window.browserControl;
        if (!control) return;
        const filter = ruleId ? ruleFilter(live, ruleId) : null;
        if (filter) control._previewLegendFilter(live.id, filter);
        else control._clearLegendFilter();
    }

    /** Up to a few distinct features of this map drawn in the current view. */
    _featuresSection(live) {
        const features = this._featuresInView(live);
        if (!features.length) return;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel('In this view'));
        features.forEach(({ feature, label }) => {
            section.appendChild(row({
                thumb: iconThumb('bounding-box-circles'),
                title: label,
                meta: feature.geometry?.type || '',
                trailing: chevron(),
                onClick: () => {
                    window.featureControl?._stateManager?.handleFeatureClicks([feature]);
                    window.featureControl?._markerManager?._openInspectorPanel?.();
                    this._onSelectFeature?.();
                }
            }));
        });
        this.el.appendChild(section);
    }

    _featuresInView(live) {
        const map = window.map;
        const api = window.layerControl?._mapboxAPI;
        if (!map || !api?.getLayerGroupIds) return [];
        try {
            const ids = api.getLayerGroupIds(live.id, live).filter(id => map.getLayer(id));
            if (!ids.length) return [];
            const field = live.inspect?.label;
            const seen = new Set();
            const out = [];
            for (const feature of map.queryRenderedFeatures({ layers: ids })) {
                const props = feature.properties || {};
                const label = String(props[field] ?? props.name ?? props.title ?? props.id ?? feature.id ?? '').trim();
                if (!label || seen.has(label)) continue;
                seen.add(label);
                out.push({ feature, label });
                if (out.length >= FEATURE_LIMIT) break;
            }
            return out;
        } catch (error) {
            return [];
        }
    }

    /** The map's star (js/starred-layers.js), as in the layer editor. */
    _starButton(live) {
        const defaults = window.browserControl?._getAtlasInitiallyCheckedIds?.(live._sourceAtlas || 'index') || [];
        const starred = isStarred(live, { isDefault: !!live.initiallyChecked || defaults.includes(live._prefixedId) });
        const button = el('button', 'console-btn console-details-star' + (starred ? ' on' : ''));
        button.type = 'button';
        button.title = starred ? 'Starred - click to unstar' : 'Star this map to find it again';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(starred));
        button.appendChild(icon(starred ? 'star-fill' : 'star'));
        button.addEventListener('click', () => {
            setStarred(live, !starred);
            this.render();
        });
        return button;
    }

    _about(live, on) {
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel('About'));
        const list = el('dl', 'console-about');
        const add = (term, value) => {
            if (!value) return;
            const dd = el('dd');
            dd.append(value);
            list.append(el('dt', '', term), dd);
        };
        list.append(el('dt', '', 'Layer ID'), el('dd', 'console-mono', live.id));
        add('Type', live.type ? LayerThumbnail.getTypeBadge(live.type).label : '');
        if (typeof live.url === 'string' && /^https?:\/\//i.test(live.url)) {
            try { add('Source', new URL(live.url).hostname); } catch (error) { /* not a URL */ }
        }
        // Where the data comes from: the original source, then what it came through
        add('Sources', richText(live.attribution, 'console-details-sources'));
        add('License', live.license || 'Not given');
        if (on) {
            const stack = this._stack(live);
            if (stack) {
                const dd = el('dd', 'console-stack');
                dd.appendChild(el('span', '', `${stack.index + 1} of ${stack.ids.length} ${stack.isBasemap ? 'basemaps' : 'overlays'}`));
                dd.appendChild(this._moveButton('arrow-up', 'Move up', stack, -1));
                dd.appendChild(this._moveButton('arrow-down', 'Move down', stack, 1));
                list.append(el('dt', '', 'Stack'), dd);
            }
        }
        section.appendChild(list);
        if (!on) section.appendChild(hint('Turn this map on to compare, mask or export it, and to see its features in view.'));
        return section;
    }

    _stack(live) {
        const visible = window.browserControl?._layerStack?._getVisibleLayers?.() || [];
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(visible);
        const isBasemap = LayerOrderManager.isBasemap(live);
        const ids = (isBasemap ? basemaps : overlays).map(l => l.id);
        const index = ids.indexOf(live.id);
        if (index === -1) return null;
        return { ids, index, isBasemap, overlayIds: overlays.map(l => l.id), basemapIds: basemaps.map(l => l.id) };
    }

    _moveButton(iconName, title, stack, delta) {
        const to = stack.index + delta;
        const button = el('button', 'console-btn console-btn-sm');
        button.type = 'button';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.disabled = to < 0 || to >= stack.ids.length;
        button.appendChild(icon(iconName));
        button.addEventListener('click', () => {
            const ids = [...stack.ids];
            ids.splice(to, 0, ids.splice(stack.index, 1)[0]);
            post({
                type: 'reorder-layers',
                overlayOrder: stack.isBasemap ? stack.overlayIds : ids,
                basemapOrder: stack.isBasemap ? ids : stack.basemapIds
            });
            setTimeout(() => this.refresh(), 200);
        });
        return button;
    }
}
