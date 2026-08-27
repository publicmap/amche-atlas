// "to <place>" - implies from the current map view.
const TO_ONLY_PATTERN = /^\s*(?:directions?\s+)?to\s+(.+?)\s*$/i

// "<place> to <place>" (an optional "directions"/"from" prefix is allowed).
const FROM_TO_PATTERN = /^\s*(?:directions?\s+)?(?:from\s+)?(.+?)\s+to\s+(.+?)\s*$/i

const MIN_PLACE_TEXT_LENGTH = 2

/**
 * Detect a "directions" intent in a typed query. Deliberately loose - the
 * caller (directions-provider.js) only turns this into a visible suggestion
 * once both sides actually resolve to a location, so a real place name that
 * happens to contain " to " (e.g. "Road to Nowhere") just fails to resolve
 * and never shows a directions result; it never *replaces* normal place
 * suggestions for the same query.
 *
 * @returns {{ fromText: string, toText: string } | null}
 *   fromText is '' for the "to <place>" form, meaning "from current view".
 */
export function parseDirectionsQuery(query) {
    if (!query) return null

    const toOnly = query.match(TO_ONLY_PATTERN)
    if (toOnly && toOnly[1].trim().length >= MIN_PLACE_TEXT_LENGTH) {
        return { fromText: '', toText: toOnly[1].trim() }
    }

    const match = query.match(FROM_TO_PATTERN)
    if (!match) return null

    const fromText = match[1].trim()
    const toText = match[2].trim()
    if (fromText.length < MIN_PLACE_TEXT_LENGTH || toText.length < MIN_PLACE_TEXT_LENGTH) return null

    return { fromText, toText }
}
