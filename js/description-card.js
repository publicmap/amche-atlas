/**
 * The layer editor's description: the first two lines of the description and
 * one of the attribution, as a button. Clicking it opens the full description
 * and attribution as editable text.
 */

const DESCRIPTION_PLACEHOLDER = 'Add missing description';
const ATTRIBUTION_PLACEHOLDER = 'Add missing attribution';

export class DescriptionCard {
    init() {
        $('#desc-summary').on('click', () => this.setOpen(true));
        $('#desc-done').on('click', () => this.setOpen(false));
        $('#layer-description, #layer-attribution').on('input', () => this.refresh());
        this.refresh();
    }

    setOpen(open) {
        $('#desc-summary').toggleClass('hidden', open);
        $('#desc-editor').toggleClass('hidden', !open);
        if (open) $('#layer-description').trigger('focus');
        else this.refresh();
    }

    get isOpen() {
        return !$('#desc-editor').hasClass('hidden');
    }

    refresh() {
        const description = String($('#layer-description').val() || '').trim();
        const attribution = String($('#layer-attribution').val() || '').trim();
        const plainAttribution = attribution ? $('<div>').html(attribution).text().trim() : '';

        $('#desc-summary-text')
            .toggleClass('desc-empty', !description)
            .text(description || DESCRIPTION_PLACEHOLDER);
        $('#desc-summary-attribution')
            .toggleClass('desc-empty', !plainAttribution)
            .text(plainAttribution || ATTRIBUTION_PLACEHOLDER);
    }
}
