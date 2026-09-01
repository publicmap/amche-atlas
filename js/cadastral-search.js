import levenshtein from 'fast-levenshtein'
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

let parquetUrl = null
let villagesUrl = null

let initPromise = null
let parquetFile = null
let parquetMetadata = null
let rowOffsets = null
let villageList = []

export function configureCadastralSearch({ parquetUrl: p, villagesUrl: v }) {
    if (p === parquetUrl && v === villagesUrl) return
    parquetUrl = p
    villagesUrl = v
    initPromise = null
    parquetFile = null
    parquetMetadata = null
    rowOffsets = null
    villageList = []
}

export function isCadastralSearchEnabled() {
    return Boolean(parquetUrl && villagesUrl)
}

async function _doInit() {
    if (!parquetUrl || !villagesUrl) {
        throw new Error('Cadastral search is not configured')
    }

    const villages = await fetch(villagesUrl).then(r => r.json())
    villageList = villages

    parquetFile = await asyncBufferFromUrl({ url: parquetUrl })
    parquetMetadata = await parquetMetadataAsync(parquetFile)

    rowOffsets = [0]
    for (const rg of parquetMetadata.row_groups) {
        rowOffsets.push(rowOffsets.at(-1) + Number(rg.num_rows))
    }
}

function lazyInit() {
    if (!isCadastralSearchEnabled()) {
        return Promise.reject(new Error('Cadastral search is not configured'))
    }
    if (!initPromise) {
        initPromise = _doInit().catch(err => {
            initPromise = null
            throw err
        })
    }
    return initPromise
}

function findMatchingVillages(typedVillage) {
    const q = typedVillage.toLowerCase()
    const threshold = q.length <= 4 ? 1 : 2
    const prefixMatches = villageList.filter(v => v.village.toLowerCase().startsWith(q))
    if (prefixMatches.length) return prefixMatches
    return villageList.filter(v => levenshtein.get(v.village.toLowerCase(), q) <= threshold)
}

function decodeStatValue(val) {
    if (typeof val === 'string') return val
    if (val instanceof Uint8Array || ArrayBuffer.isView(val)) return new TextDecoder().decode(val)
    if (val instanceof ArrayBuffer) return new TextDecoder().decode(val)
    return String(val)
}

function getMatchingRowGroupRanges(villageName) {
    const vLower = villageName.toLowerCase()
    const ranges = []

    parquetMetadata.row_groups.forEach((rg, i) => {
        const col = rg.columns.find(c => c.meta_data.path_in_schema[0] === 'village')
        const stats = col?.meta_data?.statistics

        if (!stats?.min_value || !stats?.max_value) {
            ranges.push({ start: rowOffsets[i], end: rowOffsets[i + 1] })
            return
        }

        const minStr = decodeStatValue(stats.min_value).toLowerCase()
        const maxStr = decodeStatValue(stats.max_value).toLowerCase()

        if (maxStr >= vLower && minStr <= vLower + '\uffff') {
            ranges.push({ start: rowOffsets[i], end: rowOffsets[i + 1] })
        }
    })

    return ranges
}

export function prewarmCadastral() {
    if (!isCadastralSearchEnabled()) return
    lazyInit().catch(() => {})
}

export function parseCadastralQuery(query) {
    const match = query.trim().match(/^([a-zA-Z\s]+?)\s+([\d].*)$/)
    if (!match) return null
    return { village: match[1].trim(), surveyRaw: match[2].trim() }
}

export function formatCadastralLabel({ village, taluka, survey, subdiv }) {
    const surveyPart = subdiv ? `Survey ${survey}/${subdiv}` : `Survey ${survey}`
    return `${village} — ${surveyPart} — ${taluka}`
}

export function formatSurveyLabel({ survey, subdiv }) {
    return subdiv ? `${survey}/${subdiv}` : String(survey ?? '')
}

function labelToSurveyRow(label) {
    const slashIdx = label.indexOf('/')
    if (slashIdx === -1) return { survey: label, subdiv: '' }
    return { survey: label.slice(0, slashIdx), subdiv: label.slice(slashIdx + 1) }
}

export function sortSurveyOptionLabels(a, b) {
    return sortSurveyMatches(
        { row: labelToSurveyRow(a), score: 0 },
        { row: labelToSurveyRow(b), score: 0 },
    )
}

export function normalizeSurveySegment(str) {
    return String(str ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function parseSurveyQuery(raw) {
    const trimmed = raw.trim()
    const slashIdx = trimmed.indexOf('/')

    if (slashIdx === -1) {
        return {
            surveyPrefix: normalizeSurveySegment(trimmed),
            subdivPrefix: null,
            hasSubdiv: false,
        }
    }

    return {
        surveyPrefix: normalizeSurveySegment(trimmed.slice(0, slashIdx)),
        subdivPrefix: normalizeSurveySegment(trimmed.slice(slashIdx + 1)),
        hasSubdiv: true,
    }
}

export function scoreSurveyMatch(row, parsed) {
    const rowSurvey = normalizeSurveySegment(row.survey)
    const rowSubdiv = normalizeSurveySegment(row.subdiv)
    const { surveyPrefix, subdivPrefix, hasSubdiv } = parsed

    if (!surveyPrefix || !rowSurvey.startsWith(surveyPrefix)) return null
    if (hasSubdiv && !rowSubdiv.startsWith(subdivPrefix ?? '')) return null

    let score = 0

    if (rowSurvey === surveyPrefix) score += 1000
    else score -= rowSurvey.length * 100

    if (hasSubdiv) {
        if (rowSubdiv === subdivPrefix) score += 500
        else score -= rowSubdiv.length * 10
    } else if (rowSubdiv) {
        score -= rowSubdiv.length * 5
    } else {
        score += 50
    }

    return score
}

function sortSurveyMatches(a, b) {
    if (b.score !== a.score) return b.score - a.score

    const surveyA = normalizeSurveySegment(a.row.survey)
    const surveyB = normalizeSurveySegment(b.row.survey)
    if (surveyA.length !== surveyB.length) return surveyA.length - surveyB.length
    if (surveyA !== surveyB) return surveyA.localeCompare(surveyB)

    return normalizeSurveySegment(a.row.subdiv).localeCompare(normalizeSurveySegment(b.row.subdiv))
}

function rowToFeature(r) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: {
            name: formatCadastralLabel(r),
            place_name: formatCadastralLabel(r),
            place_type: ['cadastral', 'plot'],
            text: formatCadastralLabel(r),
            _isLocalSuggestion: true,
            _isCadastralParquet: true,
        },
    }
}

function matchesVillageTaluka(row, villageName, taluka) {
    if (row.village.toLowerCase() !== villageName.toLowerCase()) return false
    if (taluka && row.taluka.toLowerCase() !== taluka.toLowerCase()) return false
    return true
}

export function isValidPlotCoord(lon, lat) {
    return Number.isFinite(lon) && Number.isFinite(lat)
        && lon > 73.5 && lon < 74.5 && lat > 14.8 && lat < 15.9
}

async function collectMatchesForVillage(villageName, taluka, parsed) {
    const matches = []
    const ranges = getMatchingRowGroupRanges(villageName)

    for (const range of ranges) {
        const rows = await parquetReadObjects({
            file: parquetFile,
            compressors,
            columns: ['village', 'taluka', 'survey', 'subdiv', 'lon', 'lat'],
            rowStart: range.start,
            rowEnd: range.end,
        })

        for (const row of rows) {
            if (!matchesVillageTaluka(row, villageName, taluka)) continue
            if (!isValidPlotCoord(row.lon, row.lat)) continue
            const score = scoreSurveyMatch(row, parsed)
            if (score === null) continue
            matches.push({ row, score })
        }
    }

    return matches
}

export async function getVillageList() {
    if (!isCadastralSearchEnabled()) return []
    await lazyInit()
    return villageList
}

export function villageEntryKey({ village, taluka }) {
    return `${village}\x1f${taluka}`
}

export function parseVillageEntryKey(key) {
    if (!key) return null
    const [village, taluka] = key.split('\x1f')
    if (!village || !taluka) return null
    return { village, taluka }
}

export function findVillageEntry(name, taluka) {
    if (!name || !villageList.length) return null

    const n = name.trim().toLowerCase()
    const t = taluka?.trim().toLowerCase()

    let matches = villageList.filter(v => v.village.toLowerCase() === n)
    if (!matches.length) {
        const threshold = n.length <= 4 ? 1 : 2
        matches = villageList.filter(v => levenshtein.get(v.village.toLowerCase(), n) <= threshold)
    }

    if (t) {
        const byTaluka = matches.filter(v => v.taluka.toLowerCase() === t)
        if (byTaluka.length) return byTaluka[0]
    }

    return matches[0] || null
}

export function detectVillageFromMapCenter(map) {
    if (!map || map.getZoom() < 13) return null

    const plotLayers = map.getStyle()?.layers
        ?.filter(l => l.type === 'fill' && l.id.toLowerCase().includes('plot'))
        .map(l => l.id) || []

    let features = []
    try {
        const center = map.project(map.getCenter())
        const r = 60
        const bbox = [[center.x - r, center.y - r], [center.x + r, center.y + r]]
        const opts = plotLayers.length ? { layers: plotLayers } : {}
        features = map.queryRenderedFeatures(bbox, opts)
    } catch {
        try {
            features = map.queryRenderedFeatures(map.getCenter())
        } catch {
            return null
        }
    }

    const plot = features.find(f => {
        const p = f.properties
        return p && p.survey != null && (p.villagenam || p.Village)
    })

    if (!plot) return null

    const name = plot.properties.villagenam || plot.properties.Village
    const taluka = plot.properties.talname || plot.properties.Taluk || plot.properties.taluka
    return findVillageEntry(name, taluka)
}

export async function getVillageCenter(villageName, taluka) {
    if (!isCadastralSearchEnabled() || !villageName) return null
    await lazyInit()

    const ranges = getMatchingRowGroupRanges(villageName)
    let lonSum = 0
    let latSum = 0
    let count = 0

    for (const range of ranges) {
        const rows = await parquetReadObjects({
            file: parquetFile,
            compressors,
            columns: ['village', 'taluka', 'lon', 'lat'],
            rowStart: range.start,
            rowEnd: range.end,
        })

        for (const row of rows) {
            if (!matchesVillageTaluka(row, villageName, taluka)) continue
            if (!isValidPlotCoord(row.lon, row.lat)) continue
            lonSum += row.lon
            latSum += row.lat
            count += 1
        }
    }

    if (!count) return null
    return { lon: lonSum / count, lat: latSum / count }
}

export async function queryCadastralPlotsByVillage(villageName, taluka, surveyRaw, limit = 5) {
    if (!isCadastralSearchEnabled() || !villageName) return []
    await lazyInit()

    const parsed = parseSurveyQuery(surveyRaw)
    if (!parsed.surveyPrefix) return []

    const matches = await collectMatchesForVillage(villageName, taluka, parsed)
    matches.sort(sortSurveyMatches)
    return matches.slice(0, limit).map(({ row }) => rowToFeature(row))
}

export async function listSurveyOptionsForVillage(villageName, taluka, filterRaw = '', limit = 100) {
    if (!isCadastralSearchEnabled() || !villageName) return []
    await lazyInit()

    const parsed = parseSurveyQuery(filterRaw)
    if (!parsed.surveyPrefix) return []

    const seen = new Set()
    const labels = []
    const ranges = getMatchingRowGroupRanges(villageName)

    for (const range of ranges) {
        const rows = await parquetReadObjects({
            file: parquetFile,
            compressors,
            columns: ['village', 'taluka', 'survey', 'subdiv'],
            rowStart: range.start,
            rowEnd: range.end,
        })

        for (const row of rows) {
            if (!matchesVillageTaluka(row, villageName, taluka)) continue
            if (scoreSurveyMatch(row, parsed) === null) continue
            const label = formatSurveyLabel(row)
            if (!label || seen.has(label)) continue
            seen.add(label)
            labels.push(label)
        }
    }

    labels.sort(sortSurveyOptionLabels)
    return labels.slice(0, limit)
}

export async function queryCadastralPlots(villagePart, surveyRaw, limit = 5) {
    if (!isCadastralSearchEnabled()) return []
    await lazyInit()

    const parsed = parseSurveyQuery(surveyRaw)
    const candidates = findMatchingVillages(villagePart)
    if (!candidates.length || !parsed.surveyPrefix) return []

    const matches = []

    for (const candidate of candidates) {
        const villageMatches = await collectMatchesForVillage(candidate.village, candidate.taluka, parsed)
        matches.push(...villageMatches)
    }

    matches.sort(sortSurveyMatches)

    return matches.slice(0, limit).map(({ row }) => rowToFeature(row))
}
