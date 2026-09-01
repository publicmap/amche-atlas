/**
 * Goa Cadastral Sheet Geocoder
 *
 * Geocodes rows of a Google Sheet using "Village" and "Survey No." columns,
 * against the same cadastral plot dataset used by amche-atlas's cadastral
 * search (https://github.com/publicmap/amche-atlas, js/cadastral-search.js):
 *
 *   https://github.com/ourgoaindata/cadastral-search
 *
 * An optional "Taluka" input column disambiguates villages whose name
 * repeats across talukas (e.g. Verlem exists in both Sanguem and Quepem) —
 * without it, such rows are left blank and flagged "Ambiguous" rather than
 * silently geocoded to the wrong one.
 *
 * Supports a sheet made of multiple stacked tables (name row, header row,
 * data rows, blank row, next table, ...). Every row is scanned for one that
 * contains both "Village" and "Survey No." headers; each such row starts a
 * new table whose data runs until the next blank row or the next detected
 * header row. Output columns are added once per table, immediately after
 * that table's own last column — each table is sized independently, so
 * output columns can land at different column positions from one table to
 * the next.
 *
 * "Geocode selected rows" runs the same logic restricted to whatever rows
 * are currently selected, in case you don't want to (re-)run the whole sheet.
 *
 * Column headers are matched via the configurable, case-insensitive alias
 * lists in INPUT_COLUMN_ALIASES below (e.g. "Taluk"/"Subdistrict" for
 * taluka, "Sy.No."/"Plot" for survey) — edit that list to add more.
 *
 * A "Survey No." cell may describe several plots at once, separated by ",",
 * ";", or "&" (e.g. "86/3 & 3-A"); a token with no survey number of its own inherits
 * the nearest preceding token's, so "3-A" above becomes "86/3-A" (see
 * splitSurveyGroup_). Each plot in the group is geocoded independently
 * (geocodePlotGroup_): Latitude/Longitude take the first plot that matched,
 * "Matched Plot" concatenates every matched plot, and the Amche link plots
 * every matched plot as a separate marker (see buildAmcheUrl_).
 *
 * Setup: paste this file and HyparquetBundle.gs into an Apps Script project
 * bound to your Sheet (Extensions > Apps Script), save, reload the Sheet,
 * then use the "Cadastral Geocoder" menu.
 */

// ---- Config ----

const CADASTRAL_PARQUET_URL =
  'https://raw.githubusercontent.com/ourgoaindata/cadastral-search/v1.0.0/data/cadastral_search.parquet'
const CADASTRAL_VILLAGES_URL =
  'https://raw.githubusercontent.com/ourgoaindata/cadastral-search/v1.0.0/data/villages.json'

// Stop this run (and save progress) a bit before Apps Script's 6-minute
// execution limit (30 min on Google Workspace) so results are never lost.
const MAX_RUNTIME_MS = 5 * 60 * 1000

// "Matched Plot" (not "Taluka"/"Survey"/"Village") holds "survey, village,
// taluka" for the matched plot, named to avoid colliding with any existing
// input Village/Taluka column, which must never be overwritten with output.
// "Amche" and "Google Maps" link to the geocoded point on amche.in's Goa
// atlas and on Google Maps, respectively.
const OUTPUT_HEADERS = ['Latitude', 'Longitude', 'Matched Plot', 'Geocode Status', 'Amche', 'Google Maps']

// The Amche "Open" link's `layers=` value is this spreadsheet's own data
// rendered as an inline `sheet` layer (amche.in's type for "every tab of a
// Google Sheet, merged" — see docs/API.md), followed by a fixed set of
// existing atlas layer ids. This spreadsheet has one tab per taluka (Bardez,
// Bicholim, ...); `sheet` fetches and merges all of them into one layer
// instead of only whichever tab a single `gid` would point at, and tags each
// merged row with a `$sheet` field naming its source tab. Splitting the
// link into these plain (unencoded) pieces — rather than one hand percent-
// encoded template string — means updating the layer's style, inspect
// fields, or source spreadsheet is a normal edit to a JS object/array, not
// surgery on a wall of %22/%20 escapes. See buildAmcheUrl_ for how these are
// assembled and encoded into the final URL.
const AMCHE_SPREADSHEET_ID = '18L0ETYF3MXMyTlqMxaIHWMqeOOnnGLxB82yEpZTzpmI'
const AMCHE_SHEET_EDIT_URL = `https://docs.google.com/spreadsheets/d/${AMCHE_SPREADSHEET_ID}/edit`

const AMCHE_LAYER_CONFIG = {
  id: 'zone-changes',
  title: 'Zoning Changes',
  type: 'sheet',
  url: AMCHE_SHEET_EDIT_URL,
  inspect: {
    id: '$row',
    title: 'Zone',
    label: 'Zone',
    fields: ['$sheet', 'Plot', 'Geocode Status', 'Zone'],
  },
  description: `Plots notified for spot zoning changes`,
  attribution: `<a href='${AMCHE_SHEET_EDIT_URL}' target='_blank'>Google Sheets</a>`,
  style: {
    'circle-color': ['coalesce', ['get', 'fill-color'], ['get', 'color'], '#3b82f6'],
    'circle-radius': ['coalesce', ['get', 'circle-radius'], ['get', 'size'], 2],
    'circle-stroke-color': ['coalesce', ['get', 'stroke-color'], ['get', 'color'], '#1e40af'],
    'circle-stroke-width': ['coalesce', ['get', 'circle-stroke-width'], ['get', 'stroke-width'], 2],
    'text-field': ['coalesce', ['to-string', ['get', 'name']], ['to-string', ['get', 'Name']], ['to-string', ['get', 'Zone']]],
  },
}

// Existing atlas layer ids added alongside AMCHE_LAYER_CONFIG, unchanged from
// the previous hand-built template.
const AMCHE_OTHER_LAYERS = [
  'local-body',
  '39a-landuse-change',
  'plots',
  '2019-czmp-tidal-hazard-line',
  '2019-czmp-khazan',
  '2021-regional-plan',
  'selection',
  'mapbox-admin-lines',
  'mapbox-satellite',
]

const AMCHE_ATLAS = 'goa'
const AMCHE_ZOOM = 17

// Recognized names for each required/optional input column. Matching is
// case-insensitive and ignores spacing/punctuation, so "Sy.No.", "Sy. No.",
// and "SY NO" all match the "sy no" alias below. Add more aliases here as
// your sheets use different terminology — no other code needs to change.
const INPUT_COLUMN_ALIASES = {
  village: ['village', 'revenue village'],
  survey: ['survey', 'sy no', 'sy.no.', 'sy. no.', 'plot'],
  taluka: ['taluka', 'taluk', 'subdistrict'],
}

// ---- Menu ----

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cadastral Geocoder')
    .addItem('Geocode this sheet', 'geocodeCadastralSheet')
    .addItem('Geocode selected rows', 'geocodeSelectedRows')
    .addItem('Test a single lookup...', 'testCadastralLookupPrompt')
    .addSeparator()
    .addItem('Update amche link', 'updateAmcheLinks')
    .addItem('Remove geocoded fields', 'removeGeocodedFields')
    .addItem('Debug: show detected tables', 'debugCadastralTables')
    .addItem('Reset progress', 'clearCadastralProgress')
    .addToUi()
}

/**
 * Reports which sheet/rows/columns table detection actually sees. Table
 * detection always scans the whole active sheet, regardless of any
 * selection — this is here to diagnose "could not find any table" without
 * guessing (wrong tab active, unrecognized header spelling, merged cells,
 * stray whitespace, etc).
 */
function debugCadastralTables() {
  const ui = SpreadsheetApp.getUi()
  const sheet = SpreadsheetApp.getActiveSheet()
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()

  if (lastRow < 1) {
    ui.alert(`Active sheet "${sheet.getName()}" is empty.`)
    return
  }

  const allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const tables = findTables_(allValues)

  let report = `Active sheet: "${sheet.getName()}"\nRows: ${lastRow}, Columns: ${lastCol}\n\n`

  if (tables.length) {
    report += `Found ${tables.length} table(s):\n`
    tables.forEach((t, i) => {
      report +=
        `  Table ${i + 1}: header row ${t.headerRow}, data rows ${t.dataStartRow}-${t.dataEndRow}\n` +
        `    village col ${t.villageCol}, survey col ${t.surveyCol}, ` +
        `taluka col ${t.talukaCol === -1 ? '(none)' : t.talukaCol}\n`
    })
  } else {
    report += 'No table headers detected anywhere on this sheet.\n\n' +
      'First 15 non-blank rows (check these against INPUT_COLUMN_ALIASES):\n'
    let shown = 0
    for (let r = 0; r < allValues.length && shown < 15; r++) {
      const rowValues = allValues[r]
      const isBlank = rowValues.every(cell => String(cell ?? '').trim() === '')
      if (isBlank) continue
      shown += 1
      report += `  Row ${r + 1}: ${JSON.stringify(rowValues)}\n`
    }
  }

  ui.alert('Cadastral Geocoder Debug', report, ui.ButtonSet.OK)
}

/**
 * Clears the header and values of every OUTPUT_HEADERS column this script
 * added, in every detected table, restoring the sheet to its pre-geocode
 * state. Cells are cleared rather than the columns deleted, since output
 * columns for one table can share column positions with input columns of
 * another table stacked above/below it at a different width — deleting
 * whole columns would shift and corrupt those other tables.
 */
function removeGeocodedFields() {
  const ui = SpreadsheetApp.getUi()
  const sheet = SpreadsheetApp.getActiveSheet()
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()

  if (lastRow < 1) {
    ui.alert('Active sheet is empty.')
    return
  }

  const allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const tables = findTables_(allValues)

  if (!tables.length) {
    ui.alert('Could not find any table with "Village" and "Survey No." column headers.')
    return
  }

  const confirm = ui.alert(
    'Remove geocoded fields',
    `This will clear ${OUTPUT_HEADERS.join(', ')} (header and values) from ${tables.length} table(s). Continue?`,
    ui.ButtonSet.YES_NO
  )
  if (confirm !== ui.Button.YES) return

  let clearedCols = 0
  let keptHeaders = 0

  tables.forEach(table => {
    const headerRowValues = allValues[table.headerRow - 1]
    OUTPUT_HEADERS.forEach(name => {
      const col = findHeaderColumn_(headerRowValues, normalizeHeader_(name))
      if (col === -1) return
      clearedCols += 1
      if (table.dataEndRow >= table.dataStartRow) {
        sheet.getRange(table.dataStartRow, col, table.dataEndRow - table.dataStartRow + 1).clearContent()
      }
      try {
        sheet.getRange(table.headerRow, col).clearContent()
      } catch (err) {
        // Header cell belongs to a native Google Sheets "Table" object, which
        // requires every header cell to have a value — leave the header text
        // in place (values are already cleared above) rather than failing.
        keptHeaders += 1
      }
    })
  })

  const headerNote = keptHeaders
    ? ` ${keptHeaders} header label(s) could not be cleared because they're part of a Google Sheets Table (values were still cleared).`
    : ''
  ui.alert(`Cleared ${clearedCols} output column(s) across ${tables.length} table(s).${headerNote}`)
}

/**
 * Rebuilds just the "Amche" link formula for every already-geocoded row, from
 * that row's existing Latitude/Longitude — without re-running geocoding. This
 * is for tweaking AMCHE_LAYER_CONFIG / buildAmcheUrl_ (a layer style, an
 * inspect field, ...) and re-applying it across a sheet that's already been
 * geocoded, without spending time/API calls re-matching every row or
 * disturbing Latitude/Longitude/Matched Plot/Geocode Status.
 *
 * Only Latitude/Longitude survive in the sheet — the individual coordinates
 * of each sub-plot in a multi-plot row (see geocodePlotGroup_, "markers") are
 * never persisted, only used transiently when the link was first built. So a
 * multi-plot row (its "Matched Plot" contains "; ") can't be rebuilt with all
 * of its original pins from sheet data alone; those rows are left untouched
 * and counted separately. Re-run "Geocode this sheet"/"Geocode selected rows"
 * to refresh a multi-plot row's link.
 */
function updateAmcheLinks() {
  const ui = SpreadsheetApp.getUi()
  const sheet = SpreadsheetApp.getActiveSheet()
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()

  if (lastRow < 1) {
    ui.alert('Active sheet is empty.')
    return
  }

  const allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const tables = findTables_(allValues)

  if (!tables.length) {
    ui.alert('Could not find any table with "Village" and "Survey No." column headers.')
    return
  }

  let updated = 0
  let noCoords = 0
  let multiPlot = 0
  let untouchedTables = 0

  tables.forEach(table => {
    const headerRowValues = allValues[table.headerRow - 1]
    const latCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Latitude'))
    const lonCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Longitude'))
    const amcheCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Amche'))
    const matchedPlotCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Matched Plot'))

    if (latCol === -1 || lonCol === -1 || amcheCol === -1) {
      untouchedTables += 1 // never geocoded - nothing to update
      return
    }

    if (table.dataEndRow < table.dataStartRow) return

    for (let row = table.dataStartRow; row <= table.dataEndRow; row++) {
      const rowValues = allValues[row - 1]
      const lat = parseFloat(rowValues[latCol - 1])
      const lon = parseFloat(rowValues[lonCol - 1])
      if (isNaN(lat) || isNaN(lon)) {
        noCoords += 1
        continue
      }

      const matchedPlotText = matchedPlotCol === -1 ? '' : String(rowValues[matchedPlotCol - 1] ?? '')
      if (matchedPlotText.indexOf(';') !== -1) {
        multiPlot += 1
        continue
      }

      sheet.getRange(row, amcheCol).setFormula(
        `=HYPERLINK("${buildAmcheUrl_(lat, lon, [{ lat, lon }])}","Open")`
      )
      updated += 1
    }
  })

  ui.alert(
    'Update amche link',
    `Updated ${updated} link(s) across ${tables.length} table(s).\n` +
      (noCoords ? `${noCoords} row(s) skipped (no coordinates yet).\n` : '') +
      (multiPlot ? `${multiPlot} multi-plot row(s) skipped (re-run geocoding to refresh those).\n` : '') +
      (untouchedTables ? `${untouchedTables} table(s) skipped (never geocoded).\n` : ''),
    ui.ButtonSet.OK
  )
}

function clearCadastralProgress() {
  const props = PropertiesService.getDocumentProperties()
  const all = props.getProperties()
  Object.keys(all).forEach(key => {
    if (key.indexOf('CADASTRAL_NEXT_ROW_') === 0) props.deleteProperty(key)
  })
  SpreadsheetApp.getUi().alert('Progress reset. The next run will start from the first table.')
}

async function testCadastralLookupPrompt() {
  const ui = SpreadsheetApp.getUi()

  const villageResp = ui.prompt('Test cadastral lookup', 'Village name:', ui.ButtonSet.OK_CANCEL)
  if (villageResp.getSelectedButton() !== ui.Button.OK) return

  const surveyResp = ui.prompt('Test cadastral lookup', 'Survey No. (e.g. 1/2):', ui.ButtonSet.OK_CANCEL)
  if (surveyResp.getSelectedButton() !== ui.Button.OK) return

  const index = await loadCadastralIndex_()
  const result = await geocodeOne_(index, villageResp.getResponseText().trim(), surveyResp.getResponseText().trim())
  ui.alert('Result', JSON.stringify(result, null, 2), ui.ButtonSet.OK)
}

/** Run this from the Apps Script editor (Run button) to sanity-check the setup. */
async function testCadastralLookup() {
  const index = await loadCadastralIndex_()
  const result = await geocodeOne_(index, 'Verlem', '1/2')
  Logger.log(JSON.stringify(result, null, 2))
}

// ---- Main entry points ----

async function geocodeCadastralSheet() {
  const ui = SpreadsheetApp.getUi()
  const sheet = SpreadsheetApp.getActiveSheet()
  const props = PropertiesService.getDocumentProperties()
  const progressKey = 'CADASTRAL_NEXT_ROW_' + sheet.getSheetId()
  const resumeRow = Number(props.getProperty(progressKey)) || 0

  const result = await runGeocode_(sheet, row => row >= resumeRow)
  if (result.error) {
    ui.alert(result.error)
    return
  }

  const after = computeMatchStats_(sheet)

  if (result.stoppedAtRow === null) {
    props.deleteProperty(progressKey)
    ui.alert(buildRunSummary_(result, result.before, after))
  } else {
    props.setProperty(progressKey, String(result.stoppedAtRow))
    ui.alert(buildRunSummary_(
      result, result.before, after,
      `Processed ${result.processed} row(s) before running low on execution time. ` +
      `Choose "Geocode this sheet" again to continue from row ${result.stoppedAtRow}.`
    ))
  }
}

/** Geocodes only the rows currently selected (supports multiple, non-contiguous selections). */
async function geocodeSelectedRows() {
  const ui = SpreadsheetApp.getUi()
  const sheet = SpreadsheetApp.getActiveSheet()

  const selectedRows = getSelectedRows_()
  if (!selectedRows.size) {
    ui.alert('No rows selected. Select one or more cells/rows first, then run this again.')
    return
  }

  const result = await runGeocode_(sheet, row => selectedRows.has(row))
  if (result.error) {
    ui.alert(result.error)
    return
  }

  const after = computeMatchStats_(sheet)

  if (result.stoppedAtRow === null) {
    ui.alert(buildRunSummary_(result, result.before, after))
  } else {
    ui.alert(buildRunSummary_(
      result, result.before, after,
      `Processed ${result.processed} row(s) before running low on execution time. ` +
      `Re-select the remaining rows and choose "Geocode selected rows" again.`
    ))
  }
}

/**
 * Counts, across every already-geocoded table in `tables`, how many rows
 * with both a village and survey input ended up matched (Latitude filled
 * in), and splits those matches into "exact" (matched directly) vs "partial"
 * (matched only via the unpartitioned/nearby-subdivision fallback — see
 * buildUnpartitionedFallbackQueries_ and buildPartitionedFallbackQuery_) by
 * reading each row's Geocode Status
 * text. Tables that have never been geocoded (no "Latitude" output column
 * yet) are skipped rather than counted as 0 matches, so running on a subset
 * of tables doesn't drag down the overall rate with untouched ones.
 */
/**
 * "Matched Plot" holds "survey, village, taluka" for a single plot, or
 * several such groups joined with "; " when the row's Survey No. cell
 * described multiple plots (see geocodePlotGroup_). Only the first ("; "-
 * split) group is parsed — it's the one Latitude/Longitude were taken from —
 * so callers tally villages/talukas against the same plot the row's
 * coordinates actually point to, without re-deriving them from the cadastral
 * index.
 */
function parseMatchedPlotVillageTaluka_(matchedPlotText) {
  const firstPlot = String(matchedPlotText ?? '').split(';')[0]
  const parts = firstPlot.split(',').map(s => s.trim())
  if (parts.length < 3) return null
  return { village: parts[parts.length - 2], taluka: parts[parts.length - 1] }
}

function computeMatchStatsFromTables_(allValues, tables) {
  let matched = 0
  let total = 0
  let exact = 0
  let partial = 0
  let villageNotFound = 0
  const villages = new Set()
  const talukas = new Set()

  tables.forEach(table => {
    if (table.dataEndRow < table.dataStartRow) return

    const headerRowValues = allValues[table.headerRow - 1]
    const latCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Latitude'))
    if (latCol === -1) return // this table has never been geocoded
    const statusCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Geocode Status'))
    const matchedPlotCol = findHeaderColumn_(headerRowValues, normalizeHeader_('Matched Plot'))

    for (let row = table.dataStartRow; row <= table.dataEndRow; row++) {
      const rowValues = allValues[row - 1]
      const villageRaw = cellRawText_(rowValues[table.villageCol - 1])
      const surveyRaw = cellRawText_(rowValues[table.surveyCol - 1])
      if (!villageRaw || !surveyRaw) continue

      total += 1
      const status = statusCol === -1 ? '' : String(rowValues[statusCol - 1] ?? '')

      if (String(rowValues[latCol - 1] ?? '').trim() === '') {
        if (status.indexOf('Village not found') === 0) villageNotFound += 1
        continue
      }

      matched += 1
      if (status.indexOf('Unpartitioned match') === 0 || status.indexOf('Partitioned match') === 0) partial += 1
      else exact += 1

      const matchedVillageTaluka = matchedPlotCol === -1
        ? null
        : parseMatchedPlotVillageTaluka_(rowValues[matchedPlotCol - 1])
      if (matchedVillageTaluka) {
        villages.add(matchedVillageTaluka.village)
        talukas.add(matchedVillageTaluka.taluka)
      }
    }
  })

  return { matched, total, exact, partial, none: total - matched, villageNotFound, villages, talukas }
}

/** Re-reads the sheet fresh and applies computeMatchStatsFromTables_ to its current contents. */
function computeMatchStats_(sheet) {
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()
  if (lastRow < 1) {
    return { matched: 0, total: 0, exact: 0, partial: 0, none: 0, villageNotFound: 0, villages: new Set(), talukas: new Set() }
  }

  const allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  return computeMatchStatsFromTables_(allValues, findTables_(allValues))
}


/**
 * Builds the full stats block for the success/paused dialogs: how many rows
 * were considered, how many matched (with the change in matched count since
 * `before` — the sheet's own existing Latitude/status columns, snapshotted
 * by runGeocode_ before it wrote anything, whether from a previous script
 * run or from manual geocoding already present in the sheet), and a
 * precision breakdown of those matches (Exact vs the unpartitioned/nearby
 * fallback's Partial vs unmatched None).
 */
function formatGeocodingSummary_(header, before, after) {
  const rate = after.total ? (after.matched / after.total) * 100 : 0
  const rateText = after.total ? `${rate.toFixed(1)}%` : 'n/a'

  let deltaClause = ''
  if (before.total) {
    const delta = after.matched - before.matched
    deltaClause = delta === 0
      ? ' no change from previous run'
      : ` ${delta > 0 ? '+' : ''}${delta} matched from previous run`
  }

  const villageFixLine = after.villageNotFound
    ? `\nFix ${after.villageNotFound} row(s) with unmatched Village`
    : ''

  return (
    `${header}\n` +
    `Matched: ${after.matched}/${after.total} rows (${rateText})${deltaClause}\n` +
    `Match precision: ${after.exact} Exact, ${after.partial} Partial, ${after.none} None` +
    villageFixLine
  )
}

/**
 * Builds the "Done"/"Paused" dialog header: how many survey numbers, villages,
 * and talukas ended up matched, naming the talukas so a multi-taluka sheet's
 * spread is visible at a glance.
 */
function buildGeocodeHeader_(prefix, after) {
  const talukaNames = [...after.talukas].sort()
  const talukaList = talukaNames.length ? ` (${talukaNames.join(', ')})` : ''
  return (
    `${prefix}. Geocoded ${after.matched} survey nos., ${after.villages.size} villages ` +
    `in ${talukaNames.length} talukas${talukaList}`
  )
}

/**
 * Builds the full success/paused dialog text: the buildGeocodeHeader_ summary
 * line followed by the stats block from formatGeocodingSummary_, plus — only
 * when the run was interrupted by the execution time limit — a footer
 * explaining how to continue.
 */
function buildRunSummary_(result, before, after, continuationLine) {
  const prefix = result.stoppedAtRow === null ? 'Done' : 'Paused'
  const header = buildGeocodeHeader_(prefix, after)
  const summary = formatGeocodingSummary_(header, before, after)
  return continuationLine ? `${summary}\n\n${continuationLine}` : summary
}

/** Absolute sheet row numbers covered by the current selection (possibly several ranges). */
function getSelectedRows_() {
  const rows = new Set()
  const rangeList = SpreadsheetApp.getActiveRangeList()
  const ranges = rangeList ? rangeList.getRanges() : []

  if (!ranges.length) {
    const single = SpreadsheetApp.getActiveRange()
    if (single) ranges.push(single)
  }

  ranges.forEach(range => {
    const startRow = range.getRow()
    const numRows = range.getNumRows()
    for (let r = startRow; r < startRow + numRows; r++) rows.add(r)
  })

  return rows
}

/**
 * Shared geocoding loop used by both "Geocode this sheet" and "Geocode
 * selected rows". `rowIsEligible(row)` decides which absolute sheet rows to
 * actually process; table/column detection always runs over the whole sheet
 * so a partial selection still resolves against the right table's columns.
 */
async function runGeocode_(sheet, rowIsEligible) {
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()

  if (lastRow < 1) {
    return { error: 'Sheet is empty.' }
  }

  const allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues()
  const tables = findTables_(allValues)

  if (!tables.length) {
    return { error: 'Could not find any table with "Village" and "Survey No." column headers.' }
  }

  const before = computeMatchStatsFromTables_(allValues, tables)

  let index
  try {
    index = await loadCadastralIndex_()
  } catch (err) {
    return { error: 'Failed to load cadastral data: ' + err.message }
  }

  const startTime = Date.now()
  let processed = 0
  let stoppedAtRow = null

  outer:
  for (const table of tables) {
    if (table.dataEndRow < table.dataStartRow) continue // table has no data rows

    const outputCols = ensureOutputColumns_(sheet, allValues[table.headerRow - 1], table.headerRow)

    for (let row = table.dataStartRow; row <= table.dataEndRow; row++) {
      if (!rowIsEligible(row)) continue

      const rowValues = allValues[row - 1]
      const villageRaw = cellRawText_(rowValues[table.villageCol - 1])
      const surveyRaw = cellRawText_(rowValues[table.surveyCol - 1])
      const talukaRaw = table.talukaCol !== -1 ? cellRawText_(rowValues[table.talukaCol - 1]) : null

      if (!villageRaw || !surveyRaw) continue
      if (isAlreadyGeocoded_(rowValues, outputCols)) continue

      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        stoppedAtRow = row
        break outer
      }

      const result = await geocodePlotGroup_(index, villageRaw, surveyRaw, talukaRaw)
      writeRowResult_(sheet, row, outputCols, result)
      processed += 1
    }
  }

  return { processed, stoppedAtRow, before }
}

/**
 * Scans every row for one containing both "Village" and "Survey No."
 * headers, treating each as the start of a table. A table's data runs from
 * the row after its header down to (but not including) the first fully
 * blank row, or the row before the next detected header row — whichever
 * comes first.
 */
function findTables_(allValues) {
  const headerRows = []
  for (let sheetRow = 1; sheetRow <= allValues.length; sheetRow++) {
    const rowValues = allValues[sheetRow - 1]
    const villageCol = findAliasColumn_(rowValues, INPUT_COLUMN_ALIASES.village)
    const surveyCol = findAliasColumn_(rowValues, INPUT_COLUMN_ALIASES.survey)
    if (villageCol !== -1 && surveyCol !== -1 && villageCol !== surveyCol) {
      const talukaCol = findAliasColumn_(rowValues, INPUT_COLUMN_ALIASES.taluka)
      headerRows.push({ headerRow: sheetRow, villageCol, surveyCol, talukaCol })
    }
  }

  return headerRows.map((table, i) => {
    const boundaryRow = i + 1 < headerRows.length ? headerRows[i + 1].headerRow : allValues.length + 1

    let dataEndRow = table.headerRow // no data rows found yet
    for (let sheetRow = table.headerRow + 1; sheetRow < boundaryRow; sheetRow++) {
      const rowValues = allValues[sheetRow - 1]
      const isBlank = rowValues.every(cell => String(cell ?? '').trim() === '')
      if (isBlank) break
      dataEndRow = sheetRow
    }

    return { ...table, dataStartRow: table.headerRow + 1, dataEndRow }
  })
}

// ---- Cadastral index (parquet + villages, loaded once per execution) ----

let _cadastralIndex = null

async function loadCadastralIndex_() {
  if (_cadastralIndex) return _cadastralIndex

  const parquetResp = UrlFetchApp.fetch(CADASTRAL_PARQUET_URL, { muteHttpExceptions: true })
  if (parquetResp.getResponseCode() !== 200) {
    throw new Error('Failed to fetch cadastral parquet: HTTP ' + parquetResp.getResponseCode())
  }
  const arrayBuffer = signedBytesToArrayBuffer_(parquetResp.getContent())

  const villagesResp = UrlFetchApp.fetch(CADASTRAL_VILLAGES_URL, { muteHttpExceptions: true })
  if (villagesResp.getResponseCode() !== 200) {
    throw new Error('Failed to fetch villages list: HTTP ' + villagesResp.getResponseCode())
  }
  const villages = JSON.parse(villagesResp.getContentText())

  const file = {
    byteLength: arrayBuffer.byteLength,
    slice: (start, end) => arrayBuffer.slice(start, end),
  }

  const metadata = await HyparquetLib.parquetMetadataAsync(file)
  const rowOffsets = [0]
  metadata.row_groups.forEach(rg => rowOffsets.push(rowOffsets[rowOffsets.length - 1] + Number(rg.num_rows)))

  _cadastralIndex = { file, metadata, rowOffsets, villages, rowCache: {} }
  return _cadastralIndex
}

function signedBytesToArrayBuffer_(bytes) {
  const u8 = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes[i] & 0xff
  return u8.buffer
}

// ---- Geocoding logic (ported from amche-atlas js/cadastral-search.js) ----

/**
 * `options.allowFallback` (default true) lets geocodePlotGroup_ ask for a
 * direct/"exact" match attempt only, skipping the unpartitioned-fallback
 * chain below — used to find each group's first solid match before spending
 * fallback guesses on its other plots (see geocodePlotGroup_).
 */
async function geocodeOne_(index, villageInput, surveyRaw, talukaRaw, options) {
  const allowFallback = !options || options.allowFallback !== false

  const parsed = parseSurveyQuery_(surveyRaw)
  if (!parsed.surveyPrefix) {
    return { status: 'Invalid survey number: "' + surveyRaw + '"' }
  }

  const { village: villageRaw, taluka: inlineTaluka } = splitVillageDisambiguator_(villageInput)

  const tiers = findVillageTiers_(index.villages, villageRaw)
  if (!tiers.length) {
    return { status: 'Village not found: "' + villageRaw + '"' }
  }

  const talukaRawResolved = inlineTaluka || talukaRaw
  const talukaLower = talukaRawResolved ? talukaRawResolved.trim().toLowerCase() : null

  const primary = await matchSurveyAcrossVillageTiers_(index, tiers, parsed, talukaLower, villageRaw, { exact: false })
  if (primary.type === 'ambiguous') return { status: primary.message }
  if (primary.type === 'matched') return buildMatchResult_(primary)

  if (!allowFallback) {
    const triedVillages = tiers[0].candidates.map(c => `${c.village} (${c.taluka})`).join(', ')
    return { status: `No exact plot matched survey "${surveyRaw}" in ${triedVillages}` }
  }

  // Fallback for subdivided plots that could not be matched directly, tried
  // as a priority-ordered chain of exact-match guesses (see
  // buildUnpartitionedFallbackQueries_): drop any "Part" marker, then peel
  // off sub-subdivisions one hyphen level at a time, then try the previous
  // subdivision number, and finally the parent unpartitioned plot (subdiv
  // "0"). Matching here is exact (not prefix) since each step is already a
  // guess — a prefix match on a guessed number would compound the uncertainty.
  for (const fallbackSurvey of buildUnpartitionedFallbackQueries_(surveyRaw)) {
    const fallbackParsed = parseSurveyQuery_(fallbackSurvey)
    if (!fallbackParsed.surveyPrefix) continue

    const fallback = await matchSurveyAcrossVillageTiers_(index, tiers, fallbackParsed, talukaLower, villageRaw, { exact: true })
    if (fallback.type === 'ambiguous') return { status: fallback.message }
    if (fallback.type === 'matched') {
      return buildMatchResult_(fallback, { originalSurvey: surveyRaw, usedSurvey: fallbackSurvey })
    }
  }

  // Opposite case: the cell explicitly asked for the parent unpartitioned
  // plot ("86/0") but that plot no longer exists because it has since been
  // subdivided in the data. Falls back to the first subdivision ("86/1")
  // only — not "86/2", "86/3", etc — since beyond the first there's no
  // principled way to guess which subdivision was meant (see
  // buildPartitionedFallbackQuery_).
  for (const fallbackSurvey of buildPartitionedFallbackQuery_(surveyRaw)) {
    const fallbackParsed = parseSurveyQuery_(fallbackSurvey)
    if (!fallbackParsed.surveyPrefix) continue

    const fallback = await matchSurveyAcrossVillageTiers_(index, tiers, fallbackParsed, talukaLower, villageRaw, { exact: true })
    if (fallback.type === 'ambiguous') return { status: fallback.message }
    if (fallback.type === 'matched') {
      return buildMatchResult_(fallback, { originalSurvey: surveyRaw, usedSurvey: fallbackSurvey, kind: 'partitioned' })
    }
  }

  const triedVillages = tiers[0].candidates.map(c => `${c.village} (${c.taluka})`).join(', ')
  return { status: `No plot matched survey "${surveyRaw}" in ${triedVillages}` }
}

/**
 * Splits a "Survey No." cell that may describe several plots at once into
 * individual "survey/subdiv" queries, e.g. "86/3 & 3-A" -> ["86/3", "86/3-A"],
 * "82/0, 83/1" -> ["82/0", "83/1"]. Tokens are separated by ",", "&", the word
 * "and", or plain whitespace (including newlines) — surveyors run multiple
 * plots together with any of these, sometimes mixed in one cell, e.g.
 * "403/ 4-A, 4-B, 4-C and 4-D 403/4-B\n403/4-C\n403/4-D". A token with no "/"
 * of its own (e.g. "4-B" above) has no survey number, so it inherits the
 * nearest preceding token's survey number as its prefix — that's how
 * surveyors abbreviate repeated subdivisions of the same survey. Stray spaces
 * around a "/" (e.g. "403/ 4-A") are collapsed before splitting so they don't
 * get mistaken for a token boundary. The final list is deduped (order
 * preserved) since the same plot is often repeated across separators.
 */
function splitSurveyGroup_(surveyRaw) {
  const normalized = String(surveyRaw ?? '').replace(/\s*\/\s*/g, '/')
  const tokens = normalized.split(/\s*[,;&]\s*|\s+and\s+|\s+/i).map(s => s.trim()).filter(Boolean)

  let lastSurveyNum = null
  const expanded = tokens.map(token => {
    const slashIdx = token.indexOf('/')
    if (slashIdx !== -1) {
      lastSurveyNum = token.slice(0, slashIdx).trim()
      return token
    }
    return lastSurveyNum ? `${lastSurveyNum}/${token}` : token
  })

  return [...new Set(expanded)]
}

/**
 * Geocodes every plot in a survey cell (see splitSurveyGroup_) and combines
 * them into one row result, in two phases so the group never spends
 * lower-confidence fallback guesses once it already has a solid answer:
 *
 *   1. Try a direct/exact match (no fallback) for every plot in the group.
 *   2. If none matched exactly, retry every plot with fallback allowed — the
 *      group needs at least an approximate answer, so fallback guesses are
 *      worth it here. If at least one plot DID match exactly in phase 1,
 *      those results are used as-is and phase 2 never runs: one precise
 *      coordinate is sufficient, so the other plots are left as their exact-
 *      only (phase 1) result rather than chasing a fallback match for them.
 *
 * Latitude/Longitude then come from the first plot that matched (of whichever
 * phase ran), so the row's primary location doesn't shift depending on how
 * many of its plots happen to match; "Matched Plot" and "Geocode Status"
 * concatenate every sub-plot's own text (each already names its own survey
 * query, so no extra labeling is needed); and `markers` carries every matched
 * plot's location for buildAmcheUrl_ to plot as a pin (one per matched plot).
 * A single-plot cell produces exactly one sub-result, so this is a strict
 * superset of geocodeOne_'s old single-plot behavior (join/filter over one
 * element is a no-op).
 */
async function geocodePlotGroup_(index, villageRaw, surveyRaw, talukaRaw) {
  const subQueries = splitSurveyGroup_(surveyRaw)

  const exactResults = []
  for (const subQuery of subQueries) {
    exactResults.push(await geocodeOne_(index, villageRaw, subQuery, talukaRaw, { allowFallback: false }))
  }

  let subResults = exactResults
  if (!exactResults.some(r => r.lat != null && r.lon != null)) {
    subResults = []
    for (const subQuery of subQueries) {
      subResults.push(await geocodeOne_(index, villageRaw, subQuery, talukaRaw, { allowFallback: true }))
    }
  }

  const matchedSubResults = subResults.filter(r => r.lat != null && r.lon != null)
  const primary = matchedSubResults[0] || null

  return {
    lat: primary ? primary.lat : null,
    lon: primary ? primary.lon : null,
    matchedPlot: matchedSubResults.map(r => r.matchedPlot).join('; '),
    status: subResults.map(r => r.status).join('; '),
    markers: matchedSubResults.map(r => ({ lat: r.lat, lon: r.lon })),
  }
}

/** Normalizes a name to Title Case regardless of how it's cased in the source data (ALL CAPS, Title Case, etc). */
function titleCase_(s) {
  return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Searches for `parsed` across each village tier in confidence order (exact
 * name, then prefix matches, then the closest fuzzy matches by edit
 * distance), stopping at the first tier that produces a survey match. A
 * village name can repeat across talukas (villages.json lists each pairing
 * separately, e.g. Navelim in Bicholim, Salcete, and Tiswadi) — group matches
 * by each row's own `taluka` field (ground truth from the plot data), not the
 * villages.json pairing, so duplicate-named villages are never blended or
 * mislabeled.
 *
 * An exact village-name tier is ground truth: the typed name IS a real
 * village, so if it has no matching survey row, that's a "no plot found in
 * this village" outcome (returned as 'none', for geocodeOne_'s own
 * subdivision-fallback chain to keep searching within the SAME village) —
 * never a reason to fall through to prefix/fuzzy tiers and suggest a
 * different, unrelated village. Falling through past the exact tier is only
 * for when the typed name doesn't exactly match any real village at all.
 */
async function matchSurveyAcrossVillageTiers_(index, tiers, parsed, talukaLower, villageRaw, options) {
  for (const tier of tiers) {
    const uniqueVillageNames = [...new Set(tier.candidates.map(c => c.village))]
    const hitsByKey = new Map()

    for (const villageName of uniqueVillageNames) {
      const rows = await getVillageRowsCached_(index, villageName)
      for (const row of rows) {
        const score = scoreSurveyMatch_(row, parsed, options)
        if (score === null) continue
        const key = row.village + '\x1f' + row.taluka
        if (!hitsByKey.has(key)) hitsByKey.set(key, [])
        hitsByKey.get(key).push({ row, score })
      }
    }

    if (!hitsByKey.size) {
      if (tier.exact) return { type: 'none' }
      continue
    }

    let chosen = [...hitsByKey.entries()]
    if (chosen.length > 1 && talukaLower) {
      const byTaluka = chosen.filter(([key]) => key.split('\x1f')[1].toLowerCase() === talukaLower)
      if (byTaluka.length) chosen = byTaluka
    }

    if (chosen.length > 1) {
      // Suggestions use each candidate's actual (corrected) village spelling,
      // not the typed villageRaw — when this tier is a fuzzy match, that's
      // the whole point of the suggestion, and re-typing villageRaw verbatim
      // would just be ambiguous all over again.
      const suggestions = chosen
        .map(([key]) => {
          const [v, t] = key.split('\x1f')
          return `"${v}, ${titleCase_(t)}"`
        })
        .join(' or ')
      return {
        type: 'ambiguous',
        message: `Village not matched. Use ${suggestions} as the Village name`,
      }
    }

    const [, matches] = chosen[0]
    matches.sort(sortSurveyMatches_)

    // Reaching a single `chosen` entry doesn't mean the village name itself
    // is unambiguous — it can also mean only one of this name's several
    // talukas (villages.json pairings) happened to have a matching survey
    // row, which is not proof that taluka is the intended one. Flag that
    // remaining doubt (unless a taluka input already picked this one on
    // purpose) so buildMatchResult_ can surface it instead of reporting a
    // silent, potentially-wrong match.
    const villageTalukas = talukaLower
      ? []
      : talukasForVillage_(index.villages, matches[0].row.village)

    return { type: 'matched', tier, matches, villageTalukas }
  }

  return { type: 'none' }
}

/** Every taluka where villages.json lists a village named `villageName` — e.g. Camurlim exists in both Bardez and Salcete. */
function talukasForVillage_(villages, villageName) {
  const nameLower = villageName.toLowerCase()
  return [...new Set(villages.filter(v => v.village.toLowerCase() === nameLower).map(v => v.taluka))]
}

/** Builds the final geocodeOne_ result from a 'matched' outcome, optionally noting an unpartitioned- or partitioned-fallback substitution (fallbackInfo.kind). */
function buildMatchResult_(outcome, fallbackInfo) {
  const { tier, matches, villageTalukas } = outcome
  const best = matches[0].row
  const matchedSurvey = best.subdiv ? `${best.survey}/${best.subdiv}` : String(best.survey)
  const fuzzyNote = tier.exact ? '' : ` (village matched as "${best.village}", taluka ${best.taluka})`

  // The village name exists in more than one taluka, and nothing in the
  // input confirmed which one was intended (see talukasForVillage_) — this
  // match may well be correct, but it was only picked because it's the
  // taluka that happened to have this survey number, not because it was
  // confirmed, so flag it and list every taluka to choose from.
  const ambiguityNote = villageTalukas && villageTalukas.length > 1
    ? ` (Check village taluka and choose the correct match: ${
        villageTalukas.map(t => `'${best.village}, ${titleCase_(t)}'`).join(', ')
      })`
    : ''

  const statusPrefix = fallbackInfo
    ? fallbackInfo.kind === 'partitioned'
      ? `Partitioned match (no unpartitioned plot for "${fallbackInfo.originalSurvey}", used first subdivision "${fallbackInfo.usedSurvey}" instead)`
      : `Unpartitioned match (no plot for "${fallbackInfo.originalSurvey}", used "${fallbackInfo.usedSurvey}" instead)`
    : (matches.length > 1 ? `Matched (${matches.length} candidate plots, best kept)` : 'Matched')

  return {
    lat: best.lat,
    lon: best.lon,
    matchedPlot: `${matchedSurvey}, ${best.village}, ${best.taluka}`,
    status: statusPrefix + fuzzyNote + ambiguityNote,
  }
}

async function getVillageRowsCached_(index, villageName) {
  const key = villageName.toLowerCase()
  let rows = index.rowCache[key]
  if (!rows) {
    rows = await readVillageRows_(index, villageName)
    index.rowCache[key] = rows
  }
  return rows
}

async function readVillageRows_(index, villageName) {
  const candidateLower = villageName.toLowerCase()
  const ranges = getMatchingRowGroupRanges_(index.metadata, index.rowOffsets, villageName)
  const matches = []

  for (const range of ranges) {
    const rows = await HyparquetLib.parquetReadObjects({
      file: index.file,
      compressors: HyparquetLib.compressors,
      columns: ['village', 'taluka', 'survey', 'subdiv', 'lon', 'lat'],
      rowStart: range.start,
      rowEnd: range.end,
    })
    for (const row of rows) {
      if (row.village.toLowerCase() === candidateLower) matches.push(row)
    }
  }

  return matches
}

/**
 * Splits an inline taluka disambiguator out of a typed village name, e.g.
 * "Candolim, Dharbandora" -> { village: "Candolim", taluka: "Dharbandora" }.
 * This lets an ambiguous village be resolved directly in the Village cell —
 * as suggested in the "Ambiguous" status message — instead of requiring a
 * separate "Taluka" column. Takes priority over a Taluka column when both
 * are present, since it's what the user just typed to resolve this row.
 */
function splitVillageDisambiguator_(villageInput) {
  const commaIdx = villageInput.indexOf(',')
  if (commaIdx === -1) return { village: villageInput, taluka: null }
  return {
    village: villageInput.slice(0, commaIdx).trim(),
    taluka: villageInput.slice(commaIdx + 1).trim() || null,
  }
}

const MAX_FUZZY_VILLAGE_CANDIDATES = 5

function findVillageTiers_(villages, typedVillage) {
  const q = typedVillage.toLowerCase()
  const tiers = []

  const exact = villages.filter(v => v.village.toLowerCase() === q)
  if (exact.length) tiers.push({ exact: true, candidates: exact })

  const prefixMatches = villages.filter(v => v.village.toLowerCase().startsWith(q))
  if (prefixMatches.length) tiers.push({ exact: false, candidates: prefixMatches })

  const threshold = q.length <= 4 ? 1 : 2
  const closest = villages
    .map(v => ({ v, distance: HyparquetLib.levenshteinGet(v.village.toLowerCase(), q) }))
    .filter(x => x.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_FUZZY_VILLAGE_CANDIDATES)
    .map(x => x.v)
  if (closest.length) tiers.push({ exact: false, candidates: closest })

  return tiers
}

function decodeStatValue_(val) {
  if (typeof val === 'string') return val
  if (val instanceof Uint8Array || ArrayBuffer.isView(val)) return new TextDecoder().decode(val)
  if (val instanceof ArrayBuffer) return new TextDecoder().decode(val)
  return String(val)
}

function getMatchingRowGroupRanges_(metadata, rowOffsets, villageName) {
  const vLower = villageName.toLowerCase()
  const ranges = []

  metadata.row_groups.forEach((rg, i) => {
    const col = rg.columns.find(c => c.meta_data.path_in_schema[0] === 'village')
    const stats = col && col.meta_data && col.meta_data.statistics

    if (!stats || !stats.min_value || !stats.max_value) {
      ranges.push({ start: rowOffsets[i], end: rowOffsets[i + 1] })
      return
    }

    const minStr = decodeStatValue_(stats.min_value).toLowerCase()
    const maxStr = decodeStatValue_(stats.max_value).toLowerCase()

    if (maxStr >= vLower && minStr <= vLower + '￿') {
      ranges.push({ start: rowOffsets[i], end: rowOffsets[i + 1] })
    }
  })

  return ranges
}

/**
 * Reads a sheet cell as plain text, undoing Sheets' auto date-detection.
 * A survey number like "5/1" typed into a cell is silently reinterpreted by
 * Sheets as a date (May 1), so getValues() hands back a Date object instead
 * of the original string. Rebuilding "month/day" from that same Date
 * recovers the text the user typed, regardless of which date convention
 * Sheets used to parse it, since it's the exact Date object that parse
 * produced.
 */
function cellRawText_(value) {
  if (value instanceof Date) {
    return (value.getMonth() + 1) + '/' + value.getDate()
  }
  return String(value ?? '').trim()
}

function normalizeSurveySegment_(str) {
  return String(str ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function parseSurveyQuery_(raw) {
  const trimmed = raw.trim()
  const slashIdx = trimmed.indexOf('/')

  if (slashIdx === -1) {
    return {
      surveyPrefix: normalizeSurveySegment_(trimmed),
      subdivPrefix: null,
      hasSubdiv: false,
    }
  }

  return {
    surveyPrefix: normalizeSurveySegment_(trimmed.slice(0, slashIdx)),
    subdivPrefix: normalizeSurveySegment_(trimmed.slice(slashIdx + 1)),
    hasSubdiv: true,
  }
}

/**
 * Strips a "Part"/"Plot" marker (and anything after it) from raw
 * subdivision text while keeping any hyphenated sub-subdivision intact,
 * e.g. "1-A-2 (Part)" -> "1-A-2", "1 (part)" -> "1", "1 plot C" -> "1",
 * "1 P" -> "1", "1P" -> "1". "Part"/"Plot" match as a whole word (with or
 * without surrounding parens/spaces) and everything after them is dropped
 * too, since they're followed by a free-text sub-lot label (e.g. "C") rather
 * than a real subdivision code. A trailing lone "P" is stripped separately
 * as its common Sheets abbreviation.
 */
function stripPartSuffix_(subdivRaw) {
  let s = String(subdivRaw ?? '')
  s = s.replace(/\s*\(?\s*\b(?:part|plot)\b.*$/i, '')
  s = s.replace(/\s*p\s*$/i, '')
  return s.trim()
}

/**
 * Given subdivision text with any "Part" marker already stripped, returns
 * every hyphen-truncated level from most to least specific, e.g.
 * "1-A-2" -> ["1-A-2", "1-A", "1"]. A plain "1" (no hyphen) returns ["1"].
 */
function subdivHyphenLevels_(cleanedSubdiv) {
  const parts = cleanedSubdiv.split('-')
  const levels = []
  for (let i = parts.length; i >= 1; i--) levels.push(parts.slice(0, i).join('-'))
  return levels
}

/**
 * Builds the ordered list of fallback survey queries to try (via exact
 * match) when a subdivided plot has no direct match, in priority order:
 *   1. the subdivision with any "Part" marker stripped but its hyphenated
 *      sub-subdivision kept intact, e.g. "527/1-A-2 (Part)" -> "527/1-A-2"
 *   2. each coarser level with the trailing "-X" sub-subdivision peeled off
 *      one hyphen at a time: "527/1-A-2" -> "527/1-A" -> "527/1"
 *   3. the previous subdivision number once reduced to a plain number,
 *      e.g. "527/1" -> "527/0"
 *   4. the parent unpartitioned plot, "527/0"
 * Steps 3-4 only apply once the subdivision has been reduced to a plain
 * number; returns [] when the query has no subdivision to fall back from.
 */
function buildUnpartitionedFallbackQueries_(surveyRaw) {
  const trimmed = surveyRaw.trim()
  const slashIdx = trimmed.indexOf('/')
  if (slashIdx === -1) return []

  const surveyPart = trimmed.slice(0, slashIdx).trim()
  const cleaned = stripPartSuffix_(trimmed.slice(slashIdx + 1))
  if (!cleaned) return []

  const levels = subdivHyphenLevels_(cleaned)
  const queries = levels.map(level => `${surveyPart}/${level}`)

  const leaf = levels[levels.length - 1]
  if (/^\d+$/.test(leaf)) {
    const leafNum = parseInt(leaf, 10)
    if (leafNum > 0) queries.push(`${surveyPart}/${leafNum - 1}`)
    if (leafNum !== 0) queries.push(`${surveyPart}/0`)
  }

  return [...new Set(queries)]
}

/**
 * Opposite of buildUnpartitionedFallbackQueries_: handles a query explicitly
 * for the parent unpartitioned plot ("X/0") that no longer exists because
 * the plot has since been subdivided in the data. Returns the first
 * subdivision ("X/1") as the sole fallback guess, or [] if the query wasn't
 * for subdivision "0" — deliberately doesn't go further ("X/2", "X/3", ...)
 * since there's no principled way to guess which subdivision was meant.
 */
function buildPartitionedFallbackQuery_(surveyRaw) {
  const trimmed = surveyRaw.trim()
  const slashIdx = trimmed.indexOf('/')
  if (slashIdx === -1) return []

  const surveyPart = trimmed.slice(0, slashIdx).trim()
  const cleaned = stripPartSuffix_(trimmed.slice(slashIdx + 1))
  if (cleaned !== '0') return []

  return [`${surveyPart}/1`]
}

function scoreSurveyMatch_(row, parsed, options) {
  const rowSurvey = normalizeSurveySegment_(row.survey)
  const rowSubdiv = normalizeSurveySegment_(row.subdiv)
  const { surveyPrefix, subdivPrefix, hasSubdiv } = parsed
  const exact = options && options.exact

  if (!surveyPrefix) return null
  if (exact) {
    if (rowSurvey !== surveyPrefix) return null
    if (hasSubdiv && rowSubdiv !== (subdivPrefix ?? '')) return null
  } else {
    if (!rowSurvey.startsWith(surveyPrefix)) return null
    if (hasSubdiv && !rowSubdiv.startsWith(subdivPrefix ?? '')) return null
  }

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

function sortSurveyMatches_(a, b) {
  if (b.score !== a.score) return b.score - a.score

  const surveyA = normalizeSurveySegment_(a.row.survey)
  const surveyB = normalizeSurveySegment_(b.row.survey)
  if (surveyA.length !== surveyB.length) return surveyA.length - surveyB.length
  if (surveyA !== surveyB) return surveyA.localeCompare(surveyB)

  return normalizeSurveySegment_(a.row.subdiv).localeCompare(normalizeSurveySegment_(b.row.subdiv))
}

// ---- Sheet I/O helpers ----

function normalizeHeader_(s) {
  return String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
}

function findHeaderColumn_(headers, wantedNormalized) {
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader_(headers[i]) === wantedNormalized) return i + 1
  }
  return -1
}

// Strips everything but letters/digits (unlike normalizeHeader_, which only
// drops periods) so "Sy.No.", "Sy. No.", and "SY NO" all reduce to "syno"
// and match a single "sy no" alias below, regardless of spacing/punctuation.
function normalizeForAlias_(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Real headers are a few words at most; a free-text Geocode Status sentence
// written by this same script (e.g. "Matched (2 candidate plots, best kept)
// (village matched as ...)") can otherwise contain "village" or "plot" as a
// substring and get mistaken for a header cell on a later run over already-
// geocoded rows. Bounding the fallback to short cells keeps it useful for
// compound headers while excluding generated sentences.
const MAX_ALIAS_FALLBACK_HEADER_LENGTH = 40

function findAliasColumn_(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeForAlias_)
  const normalizedHeaders = headers.map(normalizeForAlias_)

  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (normalizedAliases.includes(normalizedHeaders[i])) return i + 1
  }

  // Fall back to substring containment for compound headers an exact match
  // won't catch, e.g. "Village Name" or "Survey Number" (still requires the
  // full alias word, so "Sr No" won't be guessed to mean "Survey").
  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (normalizedHeaders[i].length > MAX_ALIAS_FALLBACK_HEADER_LENGTH) continue
    if (normalizedHeaders[i] && normalizedAliases.some(alias => normalizedHeaders[i].includes(alias))) return i + 1
  }

  return -1
}

/** Highest 1-based column index with non-blank content in `rowValues`, or 0 if the row is entirely blank. */
function lastNonBlankColumn_(rowValues) {
  for (let i = rowValues.length - 1; i >= 0; i--) {
    if (String(rowValues[i] ?? '').trim() !== '') return i + 1
  }
  return 0
}

/**
 * Ensures this table's own header row has all OUTPUT_HEADERS, reusing any
 * that already exist (e.g. from a previous run) and appending the rest right
 * after this table's own last column — not the sheet's overall last column,
 * since other tables may be wider or narrower. This is what keeps each
 * table's output columns immediately adjacent to its own data instead of
 * drifting to an offset shared across all tables.
 */
function ensureOutputColumns_(sheet, headerRowValues, headerRow) {
  const outputCols = {}
  const currentHeaders = headerRowValues.slice()
  let nextCol = lastNonBlankColumn_(currentHeaders)

  OUTPUT_HEADERS.forEach(name => {
    let col = findHeaderColumn_(currentHeaders, normalizeHeader_(name))
    if (col === -1) {
      nextCol += 1
      col = nextCol
      sheet.getRange(headerRow, col).setValue(name)
      currentHeaders[col - 1] = name
    }
    outputCols[name] = col
  })

  return outputCols
}

/**
 * A row counts as already geocoded only once it has a successful match (a
 * Latitude present) AND its link columns are also filled in. The link check
 * guards against a row left with coordinates but no links by an older
 * version of this script, before the Amche/Google Maps columns existed —
 * without it such a row would look "done" and be skipped forever. Rows with
 * a status but no match (e.g. "No plot matched...", "Ambiguous...") are
 * always retried, since a fixed input (survey number, village spelling) or
 * an updated cadastral dataset may resolve them on a later run.
 */
function isAlreadyGeocoded_(rowValues, outputCols) {
  const hasLocation = String(rowValues[outputCols['Latitude'] - 1] ?? '').trim() !== ''
  if (!hasLocation) return false

  return String(rowValues[outputCols['Amche'] - 1] ?? '').trim() !== ''
}

function writeRowResult_(sheet, row, outputCols, result) {
  const hasLocation = result.lat != null && result.lon != null

  sheet.getRange(row, outputCols['Latitude']).setValue(hasLocation ? result.lat : '')
  sheet.getRange(row, outputCols['Longitude']).setValue(hasLocation ? result.lon : '')
  sheet.getRange(row, outputCols['Matched Plot']).setValue(result.matchedPlot || '')
  sheet.getRange(row, outputCols['Geocode Status']).setValue(result.status || '')

  if (hasLocation) {
    sheet.getRange(row, outputCols['Amche']).setFormula(
      `=HYPERLINK("${buildAmcheUrl_(result.lat, result.lon, result.markers)}","Open")`
    )
    sheet.getRange(row, outputCols['Google Maps']).setFormula(
      `=HYPERLINK("${buildGoogleMapsUrl_(result.lat, result.lon)}","Open")`
    )
  } else {
    sheet.getRange(row, outputCols['Amche']).setValue('')
    sheet.getRange(row, outputCols['Google Maps']).setValue('')
  }
}

/**
 * `markers` (see geocodePlotGroup_) is every matched plot's own location.
 * Adds a "&markers=lon,lat|lon,lat|..." param right before the URL's
 * #zoom/lat/lon hash — amche.in's `markers=` param is what drops a pin (and
 * selects its feature) at each location, so it's added even for a single
 * matched plot; without it the link only centers the map with no visible pin.
 * The hash itself still centers on `lat`/`lon` (the first matched plot).
 *
 * The `layers=` value is built fresh from AMCHE_LAYER_CONFIG/AMCHE_OTHER_LAYERS
 * on every call (rather than cached) so a config edit takes effect immediately.
 * encodeURIComponent is used wholesale rather than hand-picking which
 * characters to escape — the app decodes the param normally either way, so
 * there's no need to match the old template's manual %22/%20-only encoding.
 */
function buildAmcheUrl_(lat, lon, markers) {
  const layersValue = JSON.stringify(AMCHE_LAYER_CONFIG) + ',' + AMCHE_OTHER_LAYERS.join(',')
  const base =
    `https://amche.in/dev/?atlas=${AMCHE_ATLAS}&layers=${encodeURIComponent(layersValue)}` +
    `#${AMCHE_ZOOM}/${lat.toFixed(6)}/${lon.toFixed(6)}`
  if (!markers || markers.length === 0) return base

  const markersParam = markers.map(m => `${m.lon.toFixed(6)},${m.lat.toFixed(6)}`).join('|')
  const hashIdx = base.indexOf('#')
  return `${base.slice(0, hashIdx)}&markers=${markersParam}${base.slice(hashIdx)}`
}

function buildGoogleMapsUrl_(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`
}
