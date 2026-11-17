/**
 * The properties of a feature just drawn, as key and value fields, shown in the
 * layer editor's Features section (js/creator-features.js) when a point, line
 * or area is finished on the map. Every change is applied as it is typed;
 * Done closes the form and Delete drops the feature.
 */

import { displayValue, geometryKind, parseCellValue } from './feature-table-data.js';

export class FeatureForm {
    /**
     * @param {jQuery} $root
     * @param {{onChange: function(number, Object), onDelete: function(number), onClose: function()}} handlers
     */
    constructor($root, handlers) {
        this.$root = $root;
        this.handlers = handlers;
        this.index = -1;
    }

    get open() {
        return this.index >= 0;
    }

    show(index, feature) {
        this.index = index;
        this.original = { ...(feature.properties || {}) };
        const kind = geometryKind(feature.geometry?.type);
        const name = feature.properties?.name;
        const $card = $('<div class="ff-card">');
        $card.append($('<div class="ff-head">').append(
            $('<span class="ff-title">').text(`New ${kind.toLowerCase()}${name ? `: ${name}` : ''}`),
            $('<span class="ff-sub">').text('Properties')
        ));
        this.$rows = $('<div class="ff-rows">');
        Object.entries(feature.properties || {}).forEach(([key, value]) => this._row(key, displayValue(value)));
        $card.append(this.$rows);

        const $add = $('<button type="button" class="ff-add">').html('<sl-icon name="plus-lg"></sl-icon> Add property');
        $add.on('click', () => this._row('', '').find('.ff-key').trigger('focus'));
        const $done = $('<button type="button" class="ff-done">').html('<sl-icon name="check2"></sl-icon> Done');
        $done.on('click', () => this.close());
        const $delete = $('<button type="button" class="ff-delete">').html('<sl-icon name="trash"></sl-icon> Delete');
        $delete.on('click', () => {
            const index = this.index;
            this.close();
            this.handlers.onDelete(index);
        });
        $card.append($('<div class="ff-actions">').append($add, $('<span class="flex-1">'), $delete, $done));

        $card.on('input', 'input', () => this._changed());
        $card.on('keydown', 'input', (event) => {
            if (event.key === 'Enter') this.close();
        });
        this.$root.empty().append($card).removeClass('hidden');

        const $name = this.$rows.find('.ff-key').filter((_, el) => el.value === 'name').closest('.ff-row').find('.ff-value');
        const $focus = $name.length ? $name : this.$rows.find('.ff-value').first();
        setTimeout(() => $focus.trigger('focus').trigger('select'), 0);
    }

    close() {
        if (!this.open) return;
        this.index = -1;
        this.$root.empty().addClass('hidden');
        this.handlers.onClose?.();
    }

    /** The feature at `index` was removed or the rows moved: keep the form on its feature. */
    shift(removedIndex) {
        if (!this.open) return;
        if (removedIndex === this.index) this.close();
        else if (removedIndex < this.index) this.index--;
    }

    _row(key, value) {
        const $row = $('<div class="ff-row">').append(
            $('<input type="text" class="ff-key" placeholder="key" aria-label="Key">').val(key),
            $('<input type="text" class="ff-value" placeholder="value" aria-label="Value">').val(value),
            $('<button type="button" class="ff-remove" title="Remove this property" aria-label="Remove property">').html('<sl-icon name="x-lg"></sl-icon>')
        );
        $row.find('.ff-remove').on('click', () => {
            $row.remove();
            this._changed();
        });
        this.$rows.append($row);
        return $row;
    }

    _changed() {
        const properties = {};
        this.$rows.find('.ff-row').each((_, row) => {
            const key = $(row).find('.ff-key').val().trim();
            if (key) properties[key] = parseCellValue($(row).find('.ff-value').val(), this.original[key]);
        });
        this.handlers.onChange(this.index, properties);
    }
}
