/**
 * How style properties are grouped into the style editor's tabs.
 *
 * Each property belongs to exactly one category, so a tab is a filter over the
 * style and the "*" tab can list every property once, section by section.
 *
 *   point   core marker appearance: circle colour, radius, opacity, stroke
 *   line    line-*
 *   area    fill-* (incl. fill-pattern and fill-extrusion-*)
 *   label   text-*
 *   circle  the remaining circle-* (blur, translate, pitch, stroke opacity)
 *   icon    icon-* and symbol-*
 *
 * Variant-prefixed keys ("hatch/fill-pattern") are grouped by the property
 * they style, so a variant's pattern sits with the other area properties.
 */

export const STYLE_CATEGORIES = ['point', 'line', 'area', 'label', 'circle', 'icon'];

export const CATEGORY_LABELS = {
    point: 'Point', line: 'Line', area: 'Area', label: 'Label', circle: 'Circle', icon: 'Icon', other: 'Other'
};

/** The tabs, in display order. `rules` is the consolidated rules view, `all` is "*". */
export const STYLE_TABS = [
    { id: 'rules', label: 'Rules' },
    ...STYLE_CATEGORIES.map(id => ({ id, label: CATEGORY_LABELS[id] })),
    { id: 'all', label: '*' }
];

const POINT_CORE = new Set([
    'circle-color', 'circle-radius', 'circle-opacity', 'circle-stroke-color', 'circle-stroke-width'
]);

/** A property name without its variant prefix ("hatch/fill-pattern" -> "fill-pattern"). */
export function baseProperty(key) {
    const slash = key.indexOf('/');
    return slash > 0 ? key.substring(slash + 1) : key;
}

/** The variant prefix of a key, or '' for the base style. */
export function variantPrefix(key) {
    const slash = key.indexOf('/');
    return slash > 0 ? key.substring(0, slash) : '';
}

/** The category a style key belongs to, or null when none of the tabs claim it. */
export function categoryOf(key) {
    const property = baseProperty(key);
    if (POINT_CORE.has(property)) return 'point';
    if (property.startsWith('circle-')) return 'circle';
    if (property.startsWith('fill-')) return 'area';
    if (property.startsWith('line-')) return 'line';
    if (property.startsWith('text-')) return 'label';
    if (property.startsWith('icon-') || property.startsWith('symbol-')) return 'icon';
    return null;
}

/** Whether a key shows under a tab. Rules is a view of its own, "*" shows everything. */
export function tabMatches(tabId, key) {
    if (tabId === 'all') return true;
    if (tabId === 'rules') return false;
    return categoryOf(key) === tabId;
}

/**
 * The keys for the "*" tab in display order: those no category claims first,
 * then each category's keys in the tabs' order. Returns `[{ category, keys }]`.
 */
export function groupForAllTab(keys) {
    const groups = [{ category: 'other', keys: keys.filter(key => categoryOf(key) === null) }];
    STYLE_CATEGORIES.forEach(category => {
        groups.push({ category, keys: keys.filter(key => categoryOf(key) === category) });
    });
    return groups.filter(group => group.keys.length);
}

/** The tab a property should open on when navigated to: its category, never Rules or "*". */
export function tabForKey(key) {
    return categoryOf(key) || 'all';
}
