/**
 * Style value references: a colour in a layer's `style` can name another value
 * to inherit instead of carrying its own.
 *
 *   "$name"            an atlas constant (the atlas `constants` block)
 *   "@fill-color"      another property of the same layer
 *   "@layer-id#fill-color"   a property of another layer in the atlas
 *
 * Constants in atlas files are already substituted when the file loads (see
 * js/atlas-constants.js); this resolves what that pass can't - a layer added
 * at runtime (the creator, `?layers=` JSON) and the cross-property and
 * cross-layer links, which need the live layer styles. Resolution is
 * deliberately limited to `*-color` properties so a `text-field` that happens
 * to read "$5" is never touched.
 *
 * A reference whose target is missing or circular is dropped from the
 * resolved style, so the layer falls back to its default for that property.
 */

const CONSTANT_REF = /^\$([A-Za-z_][\w-]*)$/;
const PROPERTY_REF = /^@(?:([^#\s]+)#)?([A-Za-z][\w\-/]*)$/;

const PREVIEW_KEY = 'preview-color';

const isColorProperty = (key) => /-color$/.test(key);

/** Parse a reference string, or null when the value is an ordinary value. */
export function parseStyleReference(value) {
    if (typeof value !== 'string') return null;
    const constant = CONSTANT_REF.exec(value);
    if (constant) return { kind: 'constant', name: constant[1] };
    const property = PROPERTY_REF.exec(value);
    if (property) return { kind: 'property', layerId: property[1] || null, property: property[2] };
    return null;
}

export function isStyleReference(value) {
    return parseStyleReference(value) !== null;
}

export function formatStyleReference(reference) {
    if (reference.kind === 'constant') return `$${reference.name}`;
    return reference.layerId ? `@${reference.layerId}#${reference.property}` : `@${reference.property}`;
}

/**
 * The context the browser provides: the parent map page installs it as
 * `styleRefContext` (js/style-reference-context.js), and the embedded creator /
 * layer-info pages reach it through window.parent.
 */
export function defaultReferenceContext() {
    for (const target of [globalThis, globalThis.parent]) {
        try {
            if (target && target.styleRefContext) return target.styleRefContext;
        } catch (error) { /* cross-origin parent */ }
    }
    return null;
}

/**
 * @param {Object} style - A layer style, possibly with "prefix/property" keys
 * @param {Object|null} [context] - `{ getConstants(), getLayerStyle(id) }`
 * @returns {Object} The style with every reference replaced by its value
 */
export function resolveStyleReferences(style, context = defaultReferenceContext()) {
    if (!style || typeof style !== 'object') return style;
    if (!Object.keys(style).some(key => isColorProperty(key.split('/').pop()) && isStyleReference(style[key]))) {
        return style;
    }

    const resolved = {};
    Object.keys(style).forEach(key => {
        const value = resolveEntry(style, key, context, new Set());
        if (value !== undefined) resolved[key] = value;
    });
    return resolved;
}

function resolveEntry(scope, key, context, visiting, scopeId = '') {
    const value = scope[key];
    if (!isColorProperty(key.split('/').pop())) return value;

    const reference = parseStyleReference(value);
    if (!reference) return value;

    const visitKey = `${scopeId}\u0000${key}`;
    if (visiting.has(visitKey)) {
        console.warn(`[StyleReferences] Circular reference at ${key}`);
        return undefined;
    }

    visiting.add(visitKey);
    try {
        if (reference.kind === 'constant') return resolveConstant(reference.name, context, visiting, value);

        const otherLayer = reference.layerId && reference.layerId !== scopeId;
        const targetScope = otherLayer ? context?.getLayerStyle?.(reference.layerId) : scope;
        const nextScopeId = otherLayer ? reference.layerId : scopeId;
        if (!targetScope || targetScope[reference.property] === undefined) {
            console.warn(`[StyleReferences] ${value} does not resolve to a style property`);
            return undefined;
        }
        return resolveEntry(targetScope, reference.property, context, visiting, nextScopeId);
    } finally {
        visiting.delete(visitKey);
    }
}

function resolveConstant(name, context, visiting, original) {
    const constants = context?.getConstants?.() || {};
    // An unknown constant is left as-is, matching atlas-file substitution.
    if (!Object.prototype.hasOwnProperty.call(constants, name)) return original;

    const visitKey = `$${name}`;
    if (visiting.has(visitKey)) {
        console.warn(`[StyleReferences] Circular constant reference: $${name}`);
        return undefined;
    }
    visiting.add(visitKey);
    try {
        const target = constants[name];
        return isStyleReference(target) && parseStyleReference(target).kind === 'constant'
            ? resolveConstant(parseStyleReference(target).name, context, visiting, target)
            : JSON.parse(JSON.stringify(target));
    } finally {
        visiting.delete(visitKey);
    }
}

/**
 * What a reference currently points at, for the editor's preview: the target
 * value, or undefined when it can't be resolved.
 */
export function previewReference(value, scopeStyle, context = defaultReferenceContext()) {
    const probe = { [PREVIEW_KEY]: value, ...scopeStyle };
    const resolved = resolveStyleReferences(probe, context);
    return resolved[PREVIEW_KEY] === value ? undefined : resolved[PREVIEW_KEY];
}

/**
 * What the style editor can link a colour to: the atlas constants and the
 * other layers' styles.
 * @param {string} [excludeLayerId] - The layer being edited
 */
export function referenceCandidates(excludeLayerId, context = defaultReferenceContext()) {
    if (!context) return { constants: {}, layers: [] };
    return {
        constants: context.getConstants?.() || {},
        layers: (context.listLayers?.() || []).filter(layer => layer.id !== excludeLayerId)
    };
}
