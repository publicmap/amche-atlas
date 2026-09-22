/**
 * Builds/rewrites `text-field` style-spec expressions from the current
 * locale (see js/locale-manager.js) - a `coalesce` over each candidate name
 * field, most-preferred language first, always ending in the bare `name`
 * property as the universal fallback.
 *
 * NAME_FIELD_TEMPLATES is the configurable list the task asked for: each
 * entry is a field-name pattern with `{lang}` standing in for an ISO
 * language code, tried in this order for every language in priority order.
 * OSM's own convention is `name:<lang>` (colon); `name_<lang>` (underscore)
 * covers vector tile schemas that can't use a colon in a property name
 * (Shortbread, OpenMapTiles, ...). Add more templates here if another
 * naming convention needs supporting.
 */
const NAME_FIELD_TEMPLATES = ['name:{lang}', 'name_{lang}'];

/** `coalesce(get(name:hi), get(name_hi), get(name:en), get(name_en), get(name))`. */
export function buildNameCoalesce(languageCodes) {
    const fields = [];
    (languageCodes || []).forEach(lang => {
        if (!lang) return;
        NAME_FIELD_TEMPLATES.forEach(template => fields.push(template.replace('{lang}', lang)));
    });
    fields.push('name');

    const seen = new Set();
    const deduped = fields.filter(field => {
        if (seen.has(field)) return false;
        seen.add(field);
        return true;
    });

    if (deduped.length === 1) return ['get', deduped[0]];
    return ['coalesce', ...deduped.map(field => ['get', field])];
}

// `name`, `name_<anything>`, or `name:<anything>` - deliberately generic
// (not checked against a specific language list) so any OSM/vector-tile
// name-localization field is recognised, not just the languages currently
// configured.
const NAME_FIELD_PATTERN = /^name([_:].+)?$/;

export function isNameField(field) {
    return typeof field === 'string' && NAME_FIELD_PATTERN.test(field);
}

/**
 * Same fallback chain buildNameCoalesce() bakes into a map style's
 * `text-field`, applied instead to a plain feature-properties object - for
 * anywhere else a name field's value is shown outside the map's own
 * rendering, e.g. js/map-marker-manager.js's inspect popups/badges (see
 * inspect.label / inspect.fields in docs/API.md). Returns `undefined` if
 * nothing in the chain (or the bare field itself) has a value.
 *
 * A non-name field (e.g. `ref`, or `Name` capitalised - a different,
 * deliberately-authored field) passes through untouched, exactly like
 * localizeTextField's own node-matching does.
 */
export function resolveLocalizedProperty(properties, field, languageCodes) {
    if (!properties || !isNameField(field)) return properties?.[field];
    for (const lang of languageCodes || []) {
        if (!lang) continue;
        for (const template of NAME_FIELD_TEMPLATES) {
            const value = properties[template.replace('{lang}', lang)];
            if (value !== null && value !== undefined && value !== '') return value;
        }
    }
    return properties[field] ?? properties.name;
}

/** `["get", "<name field>"]`, optionally wrapped in a single `to-string`. */
function isNameGetNode(node) {
    if (!Array.isArray(node)) return false;
    if (node[0] === 'get' && isNameField(node[1])) return true;
    if (node[0] === 'to-string' && isNameGetNode(node[1])) return true;
    return false;
}

/** A `coalesce` whose every argument is itself a name-get node (nesting allowed). */
function isAllNameCoalesce(node) {
    if (!Array.isArray(node) || node[0] !== 'coalesce') return false;
    return node.slice(1).every(arg => isNameGetNode(arg) || isAllNameCoalesce(arg));
}

function isReplaceableNode(node) {
    return isNameGetNode(node) || isAllNameCoalesce(node);
}

/**
 * Rewrites every name-field lookup inside a `text-field` expression (however
 * deeply nested inside `step`/`match`/`case`/etc. branches) to the current
 * locale's coalesce chain, leaving everything else - literal strings, gets
 * on non-name fields like `ref` or `Name` (capitalised - a different,
 * deliberately-authored field, not a locale one), other expression
 * operators - untouched.
 *
 * `expr` may be a plain string (legacy `"{name}"` interpolation syntax) or
 * any other non-array value; both pass through unchanged, since only the
 * expression-array form can be safely identified and rewritten.
 */
export function localizeTextField(expr, languageCodes) {
    if (isReplaceableNode(expr)) return buildNameCoalesce(languageCodes);
    if (Array.isArray(expr)) return expr.map(item => localizeTextField(item, languageCodes));
    return expr;
}
