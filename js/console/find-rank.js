/**
 * How well a name matches Find's query (js/console/find-panel.js), best
 * first: the name starts with it, then a word of the name is it, then a word
 * starts with it, then it appears inside a word. Anything matching only in
 * other text (description, tags, id) comes after every name match.
 */
const NO_MATCH = 5;

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchRank(name, term, otherText = []) {
    const needle = String(term || '').trim().toLowerCase();
    if (!needle) return 0;
    const text = String(name || '').toLowerCase();
    if (text.startsWith(needle)) return 0;
    const pattern = escape(needle);
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}($|[^\\p{L}\\p{N}])`, 'u').test(text)) return 1;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}`, 'u').test(text)) return 2;
    if (text.includes(needle)) return 3;
    return otherText.some(other => String(other || '').toLowerCase().includes(needle)) ? 4 : NO_MATCH;
}

/** `items` sorted by matchRank of `name(item)`, keeping their order within a rank. */
export function byRank(items, term, name, otherText = () => []) {
    return items
        .map((item, index) => ({ item, index, rank: matchRank(name(item), term, otherText(item)) }))
        .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
        .map(({ item }) => item);
}
