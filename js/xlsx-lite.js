/**
 * Minimal client-side XLSX reader used to recover the *real* target of a
 * Google Sheets `=HYPERLINK(url, "label")` cell.
 *
 * Google's CSV/gviz exports only ever return a HYPERLINK cell's display
 * label ("Open") - the URL itself is discarded, it's simply not part of
 * either format. The XLSX export is the one format Google Sheets produces
 * that keeps the actual formula text (`<f>HYPERLINK("https://...","Open")</f>`),
 * so this module fetches that instead: unzips the workbook (XLSX is a ZIP
 * of XML parts), reads the single worksheet's cell grid, and for any cell
 * whose formula is a HYPERLINK() call, uses the resolved URL as that cell's
 * value instead of its cached display text.
 *
 * No external dependency: ZIP decompression uses the browser's native
 * DecompressionStream('deflate-raw'). Callers should feature-detect that
 * (`typeof DecompressionStream !== 'undefined'`) and fall back to CSV
 * parsing if it's unavailable.
 */
import { DataUtils } from './map-utils.js';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEndOfCentralDirectory(view, byteLength) {
    const minLen = 22;
    const maxCommentLen = 65535;
    const start = Math.max(0, byteLength - minLen - maxCommentLen);
    for (let i = byteLength - minLen; i >= start; i--) {
        if (view.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error('Not a valid ZIP/XLSX file (end of central directory not found)');
}

/** Reads the ZIP central directory, returning metadata for every entry (name, compression, offsets). */
function readCentralDirectory(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const eocdOffset = findEndOfCentralDirectory(view, bytes.length);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    let offset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder('utf-8');

    const entries = [];
    for (let i = 0; i < entryCount; i++) {
        if (view.getUint32(offset, true) !== SIG_CENTRAL) break;
        const compressionMethod = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
        entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractZipEntry(buffer, entry) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const offset = entry.localHeaderOffset;
    if (view.getUint32(offset, true) !== SIG_LOCAL) {
        throw new Error(`Corrupt ZIP local header for "${entry.name}"`);
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) return compressed;
    if (entry.compressionMethod === 8) return inflateRaw(compressed);
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for "${entry.name}"`);
}

/** Extracts every ZIP entry matching `predicate(name)` as decoded UTF-8 text, keyed by entry name. */
async function readZipTextFiles(buffer, predicate) {
    const entries = readCentralDirectory(buffer).filter(entry => predicate(entry.name));
    const decoder = new TextDecoder('utf-8');
    const files = {};
    for (const entry of entries) {
        files[entry.name] = decoder.decode(await extractZipEntry(buffer, entry));
    }
    return files;
}

/**
 * Resolves the URL argument of a `HYPERLINK(url, label)` formula string
 * (already XML-entity-decoded). Handles Google's habit of splitting long
 * URL literals into `"a"&"b"&"c"` concatenation chunks. Returns null if the
 * formula isn't a HYPERLINK() call, or if its first argument isn't built
 * purely from string literals and `&` (e.g. it references other cells) -
 * evaluating arbitrary formulas is out of scope here.
 */
function extractHyperlinkTarget(formula) {
    const trimmed = typeof formula === 'string' ? formula.trim() : '';
    const opensWith = trimmed.match(/^HYPERLINK\s*\(/i);
    if (!opensWith) return null;

    // Find the top-level comma (or closing paren) that ends the first argument.
    let depth = 0;
    let inQuotes = false;
    let firstArgEnd = -1;
    for (let i = opensWith[0].length; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (inQuotes) {
            if (ch === '"') {
                if (trimmed[i + 1] === '"') { i++; continue; }
                inQuotes = false;
            }
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { if (depth === 0) { firstArgEnd = i; break; } depth--; continue; }
        if (ch === ',' && depth === 0) { firstArgEnd = i; break; }
    }
    if (firstArgEnd === -1) return null;
    const firstArg = trimmed.slice(opensWith[0].length, firstArgEnd);

    // Evaluate as a concatenation of quoted string literals joined by `&`.
    const tokenPattern = /\s*(?:"((?:[^"]|"")*)"|(&))\s*/y;
    let pos = 0;
    let result = '';
    let expectLiteral = true;
    while (pos < firstArg.length) {
        tokenPattern.lastIndex = pos;
        const match = tokenPattern.exec(firstArg);
        if (!match || match[0].length === 0) return null;
        if (expectLiteral) {
            if (match[1] === undefined) return null;
            result += match[1].replace(/""/g, '"');
        } else if (match[2] === undefined) {
            return null;
        }
        expectLiteral = !expectLiteral;
        pos = tokenPattern.lastIndex;
    }
    return expectLiteral ? null : result; // ended expecting a literal means a dangling trailing `&`
}

function columnLettersToIndex(letters) {
    let index = 0;
    for (let i = 0; i < letters.length; i++) {
        index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
}

function parseSharedStrings(xml) {
    if (!xml) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(doc.getElementsByTagName('si')).map(si =>
        Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join('')
    );
}

/** Mimics Google Sheets' "General" numeric display (~10 significant digits), matching the CSV export. */
function formatNumericCell(raw) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return raw;
    if (Number.isInteger(num)) return String(num);
    return String(Number(num.toPrecision(10)));
}

function readCellValue(cellEl, sharedStrings) {
    const type = cellEl.getAttribute('t');
    const formulaEl = cellEl.getElementsByTagName('f')[0];
    if (formulaEl) {
        const hyperlinkUrl = extractHyperlinkTarget(formulaEl.textContent);
        if (hyperlinkUrl !== null) return hyperlinkUrl;
    }

    if (type === 'inlineStr') {
        const isEl = cellEl.getElementsByTagName('is')[0];
        return isEl ? Array.from(isEl.getElementsByTagName('t')).map(t => t.textContent).join('') : '';
    }

    const valueEl = cellEl.getElementsByTagName('v')[0];
    if (!valueEl) return '';
    const raw = valueEl.textContent;

    if (type === 's') return sharedStrings[parseInt(raw, 10)] ?? '';
    if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
    if (type === 'str' || type === 'e') return raw;
    return formatNumericCell(raw);
}

/** Parses one XLSX workbook's cell grid (assumes a single worksheet, as produced by a per-tab export) into records. */
function parseWorksheetRecords(sheetXml, sharedStrings) {
    const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    return Array.from(doc.getElementsByTagName('row')).map(rowEl => {
        const record = [];
        Array.from(rowEl.getElementsByTagName('c')).forEach(cellEl => {
            const colLetters = (cellEl.getAttribute('r') || '').match(/^[A-Z]+/)?.[0];
            if (!colLetters) return;
            record[columnLettersToIndex(colLetters)] = readCellValue(cellEl, sharedStrings);
        });
        for (let i = 0; i < record.length; i++) {
            if (record[i] === undefined) record[i] = '';
        }
        return record;
    });
}

/**
 * Fetches and parses a Google Sheets single-tab XLSX export (as built by
 * GoogleSheetsAPI.buildXlsxUrl) into the same row-object shape as
 * DataUtils.parseCSV, except HYPERLINK() cells resolve to their real URL.
 */
export async function fetchAndParseSheetXLSX(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch Google Sheet as XLSX (HTTP ${response.status})`);
    }
    const buffer = await response.arrayBuffer();

    const files = await readZipTextFiles(buffer, name =>
        name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    );
    const sheetName = Object.keys(files).find(name => name.startsWith('xl/worksheets/'));
    if (!sheetName) {
        throw new Error('No worksheet found in Google Sheets XLSX export');
    }

    const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml']);
    const records = parseWorksheetRecords(files[sheetName], sharedStrings);
    return DataUtils.recordsToRows(records);
}
