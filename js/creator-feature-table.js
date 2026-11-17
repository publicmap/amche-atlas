/**
 * The feature table in the layer editor's Features section
 * (js/creator-features.js): one row per feature, one column per property.
 *
 * Editable (a layer whose data the editor holds), every cell is an input that
 * commits on change, each row has a delete button, each column header a
 * remove button that takes the property off every feature, and a + header adds
 * a column. Read only, the same table as text. Each row's geometry icon zooms
 * the map to that feature.
 */

import { tableColumns, displayValue, geometryKind } from './feature-table-data.js';

export const ROW_LIMIT = 200;

const ICONS = { Point: 'geo-alt', Line: 'bezier2', Area: 'pentagon', Feature: 'question-circle' };

export class FeatureTable {
    /**
     * @param {jQuery} $root
     * @param {{onEdit, onDeleteRow, onDeleteColumn, onAddColumn, onZoom, onFocusRow}} handlers
     */
    constructor($root, handlers) {
        this.$root = $root;
        this.handlers = handlers;
        this._bind();
    }

    render(collection, { editable = false, highlight = -1 } = {}) {
        const features = collection?.features || [];
        const columns = tableColumns(collection);
        this.columns = columns;
        this.$root.empty();
        if (!features.length) {
            this.$root.append($('<div class="ft-empty">').text(editable ? 'No features yet.' : 'This layer has no features loaded.'));
            return;
        }

        const $table = $('<table class="ft-table">').toggleClass('is-editable', editable);
        const $head = $('<tr>').append($('<th class="ft-geom-col">'));
        columns.forEach(key => {
            const $th = $('<th>').append($('<span class="ft-key">').text(key).attr('title', key));
            if (editable) {
                $th.append($('<button type="button" class="ft-col-del">')
                    .attr({ 'data-key': key, title: `Remove "${key}" from every feature`, 'aria-label': `Remove column ${key}` })
                    .html('<sl-icon name="x-lg"></sl-icon>'));
            }
            $head.append($th);
        });
        if (editable) {
            $head.append($('<th class="ft-add-col">').append(
                $('<button type="button" class="ft-col-add" title="Add a column" aria-label="Add a column">').html('<sl-icon name="plus-lg"></sl-icon>')
            ));
        }
        $table.append($('<thead>').append($head));

        const $body = $('<tbody>');
        features.slice(0, ROW_LIMIT).forEach((feature, index) => {
            const kind = geometryKind(feature.geometry?.type);
            const $row = $('<tr>').attr('data-index', index).toggleClass('is-highlight', index === highlight);
            $row.append($('<td class="ft-geom-col">').append(
                $('<button type="button" class="ft-zoom">').attr({ title: `Zoom to this ${kind.toLowerCase()}`, 'aria-label': `Zoom to row ${index + 1}` })
                    .html(`<sl-icon name="${ICONS[kind]}"></sl-icon>`)
            ));
            columns.forEach(key => {
                const value = displayValue(feature.properties?.[key]);
                const $cell = $('<td>');
                if (editable) {
                    $cell.append($('<input type="text" class="ft-cell">').attr({ 'data-key': key, 'aria-label': key }).val(value));
                } else {
                    $cell.text(value).attr('title', value);
                }
                $row.append($cell);
            });
            if (editable) {
                $row.append($('<td class="ft-row-actions">').append(
                    $('<button type="button" class="ft-row-del" title="Delete this feature" aria-label="Delete feature">').html('<sl-icon name="trash"></sl-icon>')
                ));
            }
            $body.append($row);
        });
        $table.append($body);
        this.$root.append($('<div class="ft-scroll">').append($table));
        if (features.length > ROW_LIMIT) {
            this.$root.append($('<div class="ft-more">').text(`Showing the first ${ROW_LIMIT} of ${features.length.toLocaleString()} features.`));
        }
    }

    _bind() {
        const rowIndex = (el) => Number($(el).closest('tr').attr('data-index'));
        this.$root.on('change', '.ft-cell', (event) => {
            this.handlers.onEdit(rowIndex(event.target), event.target.dataset.key, event.target.value);
        });
        this.$root.on('keydown', '.ft-cell', (event) => {
            if (event.key === 'Enter') event.target.blur();
        });
        this.$root.on('focusin', 'tbody tr', (event) => this.handlers.onFocusRow?.(rowIndex(event.currentTarget)));
        this.$root.on('click', '.ft-row-del', (event) => this.handlers.onDeleteRow(rowIndex(event.currentTarget)));
        this.$root.on('click', '.ft-zoom', (event) => this.handlers.onZoom(rowIndex(event.currentTarget)));
        this.$root.on('click', '.ft-col-del', (event) => this.handlers.onDeleteColumn(event.currentTarget.dataset.key));
        this.$root.on('click', '.ft-col-add', (event) => this._askColumn($(event.currentTarget).closest('th')));
    }

    // The + header becomes a name field; Enter adds the column, Escape or leaving drops it.
    _askColumn($th) {
        const $input = $('<input type="text" class="ft-col-name" placeholder="name" aria-label="New column name">');
        $th.empty().append($input);
        $input.trigger('focus');
        let done = false;
        const finish = (add) => {
            if (done) return;
            done = true;
            const key = String($input.val() || '').trim();
            if (add && key && !this.columns.includes(key)) this.handlers.onAddColumn(key);
            else this.handlers.onAddColumn(null);
        };
        $input.on('keydown', (event) => {
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish(false);
            }
        });
        $input.on('blur', () => finish(true));
    }
}
