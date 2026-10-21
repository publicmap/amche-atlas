// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usesIndicScript } from '../language-data.js';
import { ensureRendererForLanguages, rendererURL } from '../renderer-switch.js';

describe('usesIndicScript', () => {
    it('recognises languages with an Indic autonym', () => {
        ['hi', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'si', 'gom-deva'].forEach(code => {
            expect(usesIndicScript(code)).toBe(true);
        });
    });

    it('recognises a bare code through its Indic script variant', () => {
        expect(usesIndicScript('gom')).toBe(true);
    });

    it('ignores non-Indic languages and Latin variants', () => {
        ['en', 'ur', 'fr', 'gom-latn', '', null].forEach(code => {
            expect(usesIndicScript(code)).toBe(false);
        });
    });
});

describe('rendererURL', () => {
    beforeEach(() => {
        window.amche = { RENDERER: 'mapbox', DEFAULT_RENDERER: 'mapbox' };
    });

    it('sets a non-default renderer, keeping the other params and the hash', () => {
        expect(rendererURL('maplibre', 'http://localhost/?lang=hi#12/15.5/73.9'))
            .toBe('http://localhost/?lang=hi&renderer=maplibre#12/15.5/73.9');
    });

    it('drops the param for the default renderer', () => {
        expect(rendererURL('mapbox', 'http://localhost/?renderer=maplibre&lang=hi'))
            .toBe('http://localhost/?lang=hi');
    });
});

describe('ensureRendererForLanguages', () => {
    let errorSpy;

    beforeEach(() => {
        window.amche = { RENDERER: 'mapbox', DEFAULT_RENDERER: 'mapbox' };
        window.urlManager = { flushURLUpdate: vi.fn() };
        window.history.replaceState(null, '', '/?lang=hi');
        // jsdom logs "navigation not implemented" for the reload
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        delete window.urlManager;
        errorSpy.mockRestore();
        window.history.replaceState(null, '', '/');
    });

    it('reloads with MapLibre for an Indic language', () => {
        expect(ensureRendererForLanguages(['hi', 'en'])).toBe(true);
        expect(window.urlManager.flushURLUpdate).toHaveBeenCalled();
    });

    it('does nothing for non-Indic languages', () => {
        expect(ensureRendererForLanguages(['en', 'fr'])).toBe(false);
        expect(window.urlManager.flushURLUpdate).not.toHaveBeenCalled();
    });

    it('does nothing when already on MapLibre', () => {
        window.amche.RENDERER = 'maplibre';
        expect(ensureRendererForLanguages(['hi'])).toBe(false);
    });

    it('leaves an explicit renderer choice alone', () => {
        window.history.replaceState(null, '', '/?renderer=mapbox@3.0.0&lang=hi');
        expect(ensureRendererForLanguages(['hi'])).toBe(false);
    });
});
