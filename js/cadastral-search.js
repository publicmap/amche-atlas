import levenshtein from 'fast-levenshtein'
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

const PARQUET_URL = '/data/cadastral_search.parquet'
const VILLAGES_URL = '/data/villages.json'

let initPromise = null
let parquetFile = null
let parquetMetadata = null
let rowOffsets = null
let villageList = []

async function _doInit() {
    const villages = await fetch(VILLAGES_URL).then(r => r.json())
    villageList = villages

    parquetFile = await asyncBufferFromUrl({ url: PARQUET_URL })
    parquetMetadata = await parquetMetadataAsync(parquetFile)

    rowOffsets = [0]
    for (const rg of parquetMetadata.row_groups) {
        rowOffsets.push(rowOffsets.at(-1) + Number(rg.num_rows))
    }
}

function lazyInit() {
    if (!initPromise) initPromise = _doInit()
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

export async function queryCadastralPlots(villagePart, surveyRaw, limit = 5) {
    await lazyInit()

    const surveyNorm = surveyRaw.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const candidates = findMatchingVillages(villagePart)
    if (!candidates.length) return []

    const results = []

    for (const candidate of candidates) {
        if (results.length >= limit) break

        const candidateLower = candidate.village.toLowerCase()
        const ranges = getMatchingRowGroupRanges(candidate.village)

        for (const range of ranges) {
            if (results.length >= limit) break

            const rows = await parquetReadObjects({
                file: parquetFile,
                compressors,
                columns: ['village', 'taluka', 'survey', 'subdiv', 'lon', 'lat'],
                rowStart: range.start,
                rowEnd: range.end,
            })

            for (const row of rows) {
                if (results.length >= limit) break
                if (row.village.toLowerCase() !== candidateLower) continue
                const rowNorm = (row.survey + (row.subdiv || '')).replace(/[^a-z0-9]/gi, '').toLowerCase()
                if (!rowNorm.startsWith(surveyNorm)) continue
                results.push(row)
            }
        }
    }

    return results.map(r => ({
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
    }))
}
