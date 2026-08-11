/**
 * Google Sheets helpers shared by the "sheet" layer type (js/mapbox-api.js) and
 * map-creator.html's "All Sheets (combined)" option (js/map-creator.js).
 *
 * Google's CSV export (`/export?format=csv&gid=<gid>`) only ever returns a
 * single tab — there is no spreadsheet URL that returns every tab combined.
 * Combining tabs means discovering them (fetchSheetTabs) and fetching each
 * one's CSV separately, then merging the rows client-side (fetchAllSheetRows).
 */
import { DataUtils } from './map-utils.js';

export function isGoogleSheetUrl(url) {
    return typeof url === 'string' && url.includes('docs.google.com/spreadsheets');
}

export function extractSpreadsheetId(url) {
    const match = typeof url === 'string' ? url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) : null;
    return match ? match[1] : null;
}

export function buildCsvUrl(spreadsheetId, gid) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid !== undefined && gid !== null && gid !== '' ? `&gid=${gid}` : ''}`;
}

/** The spreadsheet's own (tab-agnostic) URL — what a `sheet` layer's `url` should be. */
export function buildEditUrl(spreadsheetId) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/**
 * Lists every tab of a Google Sheet (name + gid) by scraping the public
 * /htmlview page, which embeds a `items.push({name, pageUrl, gid, ...})` call
 * per tab for its sheet-switcher widget. Works for any sheet shared as
 * "Anyone with the link can view" - no publish-to-web or API key needed.
 */
export async function fetchSheetTabs(spreadsheetId) {
    const response = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/htmlview`);
    if (!response.ok) {
        throw new Error('Could not load the list of sheet tabs');
    }
    const html = await response.text();
    const tabs = [];
    const re = /items\.push\(\{name:\s*"((?:\\.|[^"\\])*)",\s*pageUrl:\s*"(?:\\.|[^"\\])*",\s*gid:\s*"(-?\d+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        tabs.push({ name: m[1].replace(/\\(.)/g, '$1'), gid: m[2] });
    }
    return tabs;
}

/** Parses the gviz HTML table Google sometimes returns instead of CSV (e.g. for `/pub` links). */
export function parseSheetsHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const table = doc.querySelector('table.waffle');
    if (!table) {
        throw new Error('No Google Sheets data table found in HTML response');
    }

    const extractCells = (tr) => Array.from(tr.querySelectorAll('td')).map(td => {
        td.querySelectorAll('br').forEach(br => br.replaceWith(' '));
        return td.textContent.replace(/\s+/g, ' ').trim();
    });

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    if (trs.length < 2) {
        throw new Error('Google Sheets HTML has no data rows');
    }

    const rawHeaders = extractCells(trs[0]);
    let lastIdx = rawHeaders.length - 1;
    while (lastIdx >= 0 && !rawHeaders[lastIdx]) lastIdx--;
    const headers = rawHeaders.slice(0, lastIdx + 1);
    if (!headers.length) {
        throw new Error('Google Sheets HTML has no header row');
    }

    return trs.slice(1)
        .map(tr => {
            const cells = extractCells(tr);
            const row = {};
            headers.forEach((h, i) => { row[h] = cells[i] || ''; });
            return row;
        })
        .filter(row => Object.values(row).some(v => v !== ''));
}

export async function fetchCsvRows(url) {
    const response = await fetch(url);
    const csvText = await response.text();
    const looksLikeHTML = /^\s*<(!doctype|html|head|meta)/i.test(csvText);
    return (looksLikeHTML && isGoogleSheetUrl(url))
        ? parseSheetsHTML(csvText)
        : DataUtils.parseCSV(csvText);
}

/**
 * Fetches every tab's CSV and concatenates the rows. `$row` (the auto-generated
 * per-tab line number - see DataUtils.parseCSV) is rewritten with the tab's gid
 * so ids stay unique across the merged set, and each row gets a `$sheet` field
 * naming its source tab - the same `$`-prefixed, auto-generated convention as
 * `$row`/`$table`, not a real column from the sheet.
 */
export async function fetchAllSheetRows(spreadsheetId, tabs) {
    const allRows = [];
    for (const tab of tabs) {
        try {
            const rows = await fetchCsvRows(buildCsvUrl(spreadsheetId, tab.gid));
            rows.forEach(row => {
                if (row['$row'] !== undefined) row['$row'] = `${tab.gid}-${row['$row']}`;
                row['$sheet'] = tab.name;
            });
            allRows.push(...rows);
        } catch (error) {
            console.warn(`[GoogleSheetsAPI] Failed to load sheet "${tab.name}" (gid=${tab.gid}):`, error);
        }
    }
    return allRows;
}

/**
 * Convenience for the "sheet" layer type: given any Google Sheets URL (with or
 * without a gid — the gid is ignored, since the point is to merge every tab),
 * discovers every tab and returns the merged rows.
 */
export async function fetchAllRowsFromUrl(url) {
    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) {
        throw new Error('Not a recognizable Google Sheets URL');
    }
    const tabs = await fetchSheetTabs(spreadsheetId);
    if (!tabs.length) {
        throw new Error('Could not find any tabs in this spreadsheet');
    }
    return fetchAllSheetRows(spreadsheetId, tabs);
}
