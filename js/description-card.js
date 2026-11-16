/**
 * The layer editor's description: the first two lines of the description and
 * one of the attribution, as a button. Clicking it opens the full description,
 * attribution and license as editable text. The license (layer.license) also
 * shows as a chip in the layer header, flagged when it is missing.
 */

import { addAlignLinks, refreshAlignLink } from './warper-align.js';

const DESCRIPTION_PLACEHOLDER = 'Add missing description';
const ATTRIBUTION_PLACEHOLDER = 'Add missing attribution';

const ALLOWED_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'CODE', 'BR', 'U', 'SMALL', 'SPAN']);

/**
 * Descriptions and attributions are HTML (links, emphasis). Keep a small set of
 * inline tags and http(s) links; anything else is reduced to its text.
 */
function sanitizeInlineHtml(html) {
    const root = $('<div>').html(html)[0];
    const clean = (node) => {
        Array.from(node.childNodes).forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) return;
            if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName)) {
                child.replaceWith(document.createTextNode(child.textContent || ''));
                return;
            }
            clean(child);
            Array.from(child.attributes).forEach((attr) => {
                if (!(child.tagName === 'A' && attr.name === 'href')) child.removeAttribute(attr.name);
            });
            if (child.tagName === 'A') {
                if (/^https?:\/\//i.test(child.getAttribute('href') || '')) {
                    child.setAttribute('target', '_blank');
                    child.setAttribute('rel', 'noopener noreferrer');
                } else {
                    child.replaceWith(document.createTextNode(child.textContent || ''));
                }
            }
        });
    };
    clean(root);
    return root.innerHTML;
}

function parentMap() {
    try {
        return window.parent !== window ? window.parent.map || null : null;
    } catch {
        return null;
    }
}

export class DescriptionCard {
    init() {
        // A link in the summary opens the link, not the editor.
        $('#desc-summary').on('click', 'a', (e) => {
            e.stopImmediatePropagation();
            refreshAlignLink(e, parentMap());
        });
        // Viewing a layer, the summary is only read; Edit makes it editable
        $('#desc-summary').on('click', () => {
            if (!$('body').hasClass('is-viewing')) this.setOpen(true);
        });
        $('#desc-summary').on('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !$('body').hasClass('is-viewing')) {
                e.preventDefault();
                this.setOpen(true);
            }
        });
        $('#desc-done').on('click', () => this.setOpen(false));
        $('#layer-description, #layer-attribution, #layer-license').on('input', () => this.refresh());
        $('#lh-license-badge').on('click', () => {
            this.setOpen(true);
            $('#layer-license').trigger('focus');
        });
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

        const $description = $('#desc-summary-text').toggleClass('desc-empty', !description);
        if (description) $description.html(sanitizeInlineHtml(description));
        else $description.text(DESCRIPTION_PLACEHOLDER);
        const $attribution = $('#desc-summary-attribution').toggleClass('desc-empty', !plainAttribution);
        if (plainAttribution) {
            $attribution.html(sanitizeInlineHtml(attribution));
            addAlignLinks($attribution[0], parentMap());
        }
        else $attribution.text(ATTRIBUTION_PLACEHOLDER);

        const license = String($('#layer-license').val() || '').trim();
        $('#lh-license-badge')
            .toggleClass('is-missing', !license)
            .text(license ? `License: ${license}` : 'Add missing license')
            .attr('title', license ? `Reuse under ${license} - click to edit` : 'No license given for reuse - click to add one');
    }
}
