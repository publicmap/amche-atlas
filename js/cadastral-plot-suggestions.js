const MAX_SUGGESTIONS = 20

const normalize = value => String(value ?? '').trim().toLowerCase()

function plotLayerIds(map) {
    return map.getStyle()?.layers
        ?.filter(l => l.type === 'fill' && l.id.toLowerCase().includes('plot'))
        .map(l => l.id) || []
}

function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true })
}

export function queryRenderedPlotSurveys(map, village, query = '') {
    const layers = plotLayerIds(map)
    if (!map || !layers.length || !village) return []

    let features = []
    try {
        features = map.queryRenderedFeatures({ layers })
    } catch {
        return []
    }

    const wanted = normalize(village)
    const needle = normalize(query)
    const surveys = new Map()

    features.forEach(feature => {
        const p = feature.properties
        if (!p || p.survey == null) return
        if (normalize(p.villagenam || p.Village) !== wanted) return
        const survey = String(p.survey).replace(/\s+/g, ' ').trim()
        if (!survey || surveys.has(survey)) return
        if (needle && !normalize(survey).includes(needle)) return
        surveys.set(survey, p.villagenam || p.Village)
    })

    return [...surveys.keys()]
        .sort((a, b) => {
            const aStarts = needle && normalize(a).startsWith(needle) ? 0 : 1
            const bStarts = needle && normalize(b).startsWith(needle) ? 0 : 1
            return aStarts - bStarts || naturalCompare(a, b)
        })
        .slice(0, MAX_SUGGESTIONS)
}
