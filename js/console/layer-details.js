/**
 * Layer details - a page inside Find (js/console/find-panel.js) for one map:
 * what it is, whether it is on and how strongly, what it can do on the map,
 * its legend, the features of it in view, and where it sits in the stack.
 * It heads with the same row the map has in Find's results - the whole row
 * and its eye turn the map on or off - and opening it turns the map on.
 * It replaces the layer editor's read-only Overview; Edit still opens the full
 * editor (map-creator.html).
 *
 * The map actions go through the same window messages the editor's header
 * (js/layer-header.js) posts, so MapFeatureControl handles them unchanged.
 * Registry layers carry atlas-prefixed ids (goa-local-body); everything that
 * addresses the map uses the live layer's group id (local-body) instead - see
 * MapBrowserControl._resolveLiveLayer.
 */
import { el, icon, sectionLabel, row, iconThumb, chevron, hint, eyeButton, layerThumb } from './find-rows.js';
import { isLayerActive, setLayerActive, atlasName, plainText } from './find-browse.js';
import { LayerThumbnail } from '../layer-thumbnail.js';
import { LayerLegend } from '../layer-legend.js';
import { ruleFilter } from '../rule-legend.js';
import { LayerOrderManager } from '../layer-order-manager.js';
import { LayerActions } from './layer-actions.js';

const FEATURE_LIMIT = 6;
const post = (message) => window.postMessage(message, '*');

export class LayerDetails {
    constructor({ onBack, onSelectFeature } = {}) {
        this._onBack = onBack;
        this._onSelectFeature = onSelectFeature;
        this._layer = null;
        this.el = el('div', 'console-details');
        this.el.hidden = true;
        this._actions = new LayerActions({ onChange: () => this.refresh() });
    }

    get isOpen() {
        return !!this._layer;
    }

    open(layer, { backLabel = 'Back', activate = true } = {}) {
        this._release();
        this._layer = layer;
        if (activate && !isLayerActive(layer)) setLayerActive(layer, true);
        this._backLabel = backLabel;
        this._descOpen = false;
        this.el.hidden = false;
        this.render();
        this.el.scrollTop = 0;
    }

    close() {
        this._release();
        this._layer = null;
        this.el.hidden = true;
        this.el.replaceChildren();
    }

    refresh() {
        if (this._layer) this.render();
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

        // The page's own bar: back to the results it was opened from, or close
        const bar = el('div', 'console-details-bar');
        const back = el('button', 'console-back');
        back.type = 'button';
        back.title = this._backLabel;
        back.append(icon('arrow-left'), el('span', '', this._backLabel));
        back.addEventListener('click', () => this._onBack?.());
        const close = el('button', 'console-btn console-details-close');
        close.type = 'button';
        close.title = 'Close and go back to the results ( Esc )';
        close.setAttribute('aria-label', close.title);
        close.appendChild(icon('x-lg'));
        close.addEventListener('click', () => this._onBack?.());
        bar.append(back, close);
        this.el.appendChild(bar);

        const path = [live._sourceAtlas && atlasName(live._sourceAtlas), ...(live.tags || [])].filter(Boolean).join(' › ');
        const toggle = () => setLayerActive(layer, !(isLayerActive(layer) || isLayerActive(this._live())));
        const head = row({
            thumb: layerThumb(live),
            title,
            meta: path,
            trailing: eyeButton(on ? 'on' : 'off', toggle, on ? `Hide ${title}` : `Show ${title}`),
            className: 'console-details-row' + (on ? ' selected' : ''),
            onClick: toggle
        });
        head.title = on ? `${title} is on the map - click to hide it` : `Show ${title} on the map`;
        this.el.appendChild(head);

        const description = plainText(live.description);
        if (description) {
            const desc = el('p', 'console-details-desc' + (this._descOpen ? ' open' : ''), description);
            desc.title = this._descOpen ? 'Show less' : 'Show all';
            desc.addEventListener('click', () => {
                this._descOpen = !this._descOpen;
                this.render();
            });
            this.el.appendChild(desc);
        }

        if (on) this.el.appendChild(this._opacityRow(live));
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

    _about(live, on) {
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel('About'));
        const list = el('dl', 'console-about');
        const add = (term, value) => {
            if (value) list.append(el('dt', '', term), el('dd', '', value));
        };
        list.append(el('dt', '', 'Layer ID'), el('dd', 'console-mono', live.id));
        add('Type', live.type ? LayerThumbnail.getTypeBadge(live.type).label : '');
        if (typeof live.url === 'string' && /^https?:\/\//i.test(live.url)) {
            try { add('Source', new URL(live.url).hostname); } catch (error) { /* not a URL */ }
        }
        add('Credit', plainText(live.attribution));
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
