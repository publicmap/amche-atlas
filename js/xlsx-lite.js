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
 * Tokenizes a formula-argument expression into string literals, cell
 * references (e.g. `B3`), `&`/`,`/`(`/`)` punctuation and bare identifiers
 * (function names). Returns null on any character it can't classify.
 */
function tokenizeFormulaExpr(str) {
    const tokenPattern = /\s*(?:"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|([A-Z]+[0-9]+)|(&)|(,)|(\()|(\)))\s*/y;
    const tokens = [];
    let pos = 0;
    while (pos < str.length) {
        tokenPattern.lastIndex = pos;
        const m = tokenPattern.exec(str);
        if (!m || m[0].length === 0) return null;
        if (m[1] !== undefined) tokens.push({ type: 'STRING', value: m[1].replace(/""/g, '"') });
        else if (m[2] !== undefined) tokens.push({ type: 'FUNC', value: m[2].toUpperCase() });
        else if (m[3] !== undefined) tokens.push({ type: 'CELLREF', value: m[3] });
        else if (m[4] !== undefined) tokens.push({ type: 'AMP' });
        else if (m[5] !== undefined) tokens.push({ type: 'COMMA' });
        else if (m[6] !== undefined) tokens.push({ type: 'LPAREN' });
        else tokens.push({ type: 'RPAREN' });
        pos = tokenPattern.lastIndex;
    }
    return tokens;
}

/**
 * Evaluates a tokenized formula-argument expression built from string
 * literals, cell references, `&` concatenation, parenthesized groups and
 * `CONCATENATE(...)` calls (its comma-separated args are joined with no
 * separator, matching the spreadsheet function). Cell references are
 * resolved via `resolveCellRef(ref)`. Returns null for anything else
 * (other functions, arithmetic, IF, etc.) - full formula evaluation is out
 * of scope here.
 */
function evaluateFormulaTokens(tokens, resolveCellRef) {
    let pos = 0;
    const peek = () => tokens[pos];
    const consume = (type) => (tokens[pos] && tokens[pos].type === type) ? (pos++, true) : false;

    function parseTerm() {
        const t = peek();
        if (!t) return null;
        if (t.type === 'STRING') { pos++; return t.value; }
        if (t.type === 'CELLREF') { pos++; return String(resolveCellRef(t.value) ?? ''); }
        if (t.type === 'LPAREN') {
            pos++;
            const inner = parseExpr();
            if (inner === null || !consume('RPAREN')) return null;
            return inner;
        }
        if (t.type === 'FUNC' && t.value === 'CONCATENATE') {
            pos++;
            if (!consume('LPAREN')) return null;
            let result = '';
            if (peek() && peek().type !== 'RPAREN') {
                for (; ;) {
                    const argVal = parseExpr();
                    if (argVal === null) return null;
                    result += argVal;
                    if (consume('COMMA')) continue;
                    break;
                }
            }
            return consume('RPAREN') ? result : null;
        }
        return null;
    }

    function parseExpr() {
        let result = parseTerm();
        if (result === null) return null;
        while (consume('AMP')) {
            const next = parseTerm();
            if (next === null) return null;
            result += next;
        }
        return result;
    }

    const value = parseExpr();
    return (value !== null && pos === tokens.length) ? value : null;
}

/**
 * Resolves the URL argument of a `HYPERLINK(url, label)` formula string
 * (already XML-entity-decoded). Handles Google's habit of splitting long URL
 * literals into `"a"&"b"&"c"` concatenation chunks, wrapping them in
 * `CONCATENATE(...)`, and referencing other cells (e.g. `&B3&`) - the latter
 * resolved against the sheet's cached values via `resolveCellRef(ref)`.
 * Returns null if the formula isn't a HYPERLINK() call, or if its first
 * argument uses anything beyond string literals, cell references, `&`,
 * parentheses and CONCATENATE() - evaluating arbitrary formulas (other
 * functions, arithmetic, IF, etc.) is out of scope here.
 */
function extractHyperlinkTarget(formula, resolveCellRef) {
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

    const tokens = tokenizeFormulaExpr(firstArg);
    if (!tokens) return null;
    return evaluateFormulaTokens(tokens, resolveCellRef || (() => ''));
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

/** A cell's cached/computed value (shared string, inline string, number or bool) - ignores formula text. */
function readCachedCellValue(cellEl, sharedStrings) {
    const type = cellEl.getAttribute('t');
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

function readCellValue(cellEl, sharedStrings, resolveCellRef) {
    const formulaEl = cellEl.getElementsByTagName('f')[0];
    if (formulaEl) {
        const hyperlinkUrl = extractHyperlinkTarget(formulaEl.textContent, resolveCellRef);
        if (hyperlinkUrl !== null) return hyperlinkUrl;
    }
    return readCachedCellValue(cellEl, sharedStrings);
}

/** Parses one XLSX workbook's cell grid (assumes a single worksheet, as produced by a per-tab export) into records. */
function parseWorksheetRecords(sheetXml, sharedStrings) {
    const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const cellEls = Array.from(doc.getElementsByTagName('c'));

    // Pre-pass: every cell's cached value, keyed by its ref (e.g. "B3"), so
    // HYPERLINK formulas that concatenate in other cells' values (`&B3&`) can
    // resolve them regardless of row/column traversal order below.
    const cellValuesByRef = new Map();
    cellEls.forEach(cellEl => {
        const ref = cellEl.getAttribute('r');
        if (ref) cellValuesByRef.set(ref, readCachedCellValue(cellEl, sharedStrings));
    });
    const resolveCellRef = (ref) => cellValuesByRef.get(ref) ?? '';

    return Array.from(doc.getElementsByTagName('row')).map(rowEl => {
        const record = [];
        Array.from(rowEl.getElementsByTagName('c')).forEach(cellEl => {
            const colLetters = (cellEl.getAttribute('r') || '').match(/^[A-Z]+/)?.[0];
            if (!colLetters) return;
            record[columnLettersToIndex(colLetters)] = readCellValue(cellEl, sharedStrings, resolveCellRef);
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
