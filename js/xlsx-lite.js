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
 * Tokenizes a formula expression into string literals, cell/range references
 * (e.g. `B3`, `B3:B10`, `B3:B` - only the anchor/start cell is kept, since
 * evaluation treats ranges as an elementwise per-row value, matching
 * ARRAYFORMULA's own row-broadcast semantics), comparison operators,
 * `&`/`,`/`(`/`)` punctuation and bare identifiers (function names). Returns
 * null on any character it can't classify.
 */
function tokenizeFormulaExpr(str) {
    const tokenPattern = /\s*(?:"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|(\$?[A-Z]+\$?[0-9]+(?::\$?[A-Z]+\$?[0-9]*)?)|(<>|<=|>=|=|<|>)|(&)|(,)|(\()|(\)))\s*/y;
    const tokens = [];
    let pos = 0;
    while (pos < str.length) {
        tokenPattern.lastIndex = pos;
        const m = tokenPattern.exec(str);
        if (!m || m[0].length === 0) return null;
        if (m[1] !== undefined) tokens.push({ type: 'STRING', value: m[1].replace(/""/g, '"') });
        else if (m[2] !== undefined) tokens.push({ type: 'FUNC', value: m[2].toUpperCase() });
        else if (m[3] !== undefined) tokens.push({ type: 'CELLREF', value: m[3].split(':')[0].replace(/\$/g, '') });
        else if (m[4] !== undefined) tokens.push({ type: 'COMPARE', value: m[4] });
        else if (m[5] !== undefined) tokens.push({ type: 'AMP' });
        else if (m[6] !== undefined) tokens.push({ type: 'COMMA' });
        else if (m[7] !== undefined) tokens.push({ type: 'LPAREN' });
        else tokens.push({ type: 'RPAREN' });
        pos = tokenPattern.lastIndex;
    }
    return tokens;
}

/**
 * Evaluates a tokenized formula expression built from string literals,
 * cell/range references, `&` concatenation, parenthesized groups, and the
 * spreadsheet functions actually needed to recover a HYPERLINK() cell's real
 * target: `CONCATENATE(...)` (comma-separated args joined with no
 * separator), `ARRAYFORMULA(expr)` (a transparent wrapper - array-vs-scalar
 * evaluation is already handled by shifting cell references per output row,
 * see shiftCellRef), `IF(cond, a, b)` where `cond` is an `=`/`<>`/`<`/`>`
 * comparison of two such expressions, and `HYPERLINK(url, label)` (resolves
 * to `url`, discarding the label). Cell references resolve via
 * `resolveCellRef(ref)`. Returns null for anything outside this subset
 * (other functions, arithmetic, truthy conditions, etc.) - full formula
 * evaluation is out of scope here.
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
        if (t.type === 'FUNC') {
            const name = t.value;
            pos++;
            if (!consume('LPAREN')) return null;

            if (name === 'CONCATENATE') {
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

            if (name === 'ARRAYFORMULA') {
                const inner = parseExpr();
                if (inner === null) return null;
                return consume('RPAREN') ? inner : null;
            }

            if (name === 'HYPERLINK') {
                const url = parseExpr();
                if (url === null) return null;
                if (consume('COMMA') && parseExpr() === null) return null; // label - evaluated, then discarded
                return consume('RPAREN') ? url : null;
            }

            if (name === 'IF') {
                const cond = parseCondition();
                if (cond === null || !consume('COMMA')) return null;
                const trueVal = parseExpr();
                if (trueVal === null || !consume('COMMA')) return null;
                const falseVal = parseExpr();
                if (falseVal === null || !consume('RPAREN')) return null;
                return cond ? trueVal : falseVal;
            }

            return null; // unsupported function
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

    // A comparison, used only as an IF() condition (e.g. `B3:B=""`). Returns a
    // boolean, or null if there's no top-level comparison operator (bare
    // truthy conditions aren't supported).
    function parseCondition() {
        const left = parseExpr();
        if (left === null) return null;
        const op = peek();
        if (!op || op.type !== 'COMPARE') return null;
        pos++;
        const right = parseExpr();
        if (right === null) return null;
        switch (op.value) {
            case '=': return left === right;
            case '<>': return left !== right;
            case '<': return left < right;
            case '>': return left > right;
            case '<=': return left <= right;
            case '>=': return left >= right;
            default: return null;
        }
    }

    const value = parseExpr();
    return (value !== null && pos === tokens.length) ? value : null;
}

/**
 * Resolves the URL argument of a formula string (already XML-entity-decoded)
 * containing a `HYPERLINK(url, label)` call, however deeply it's nested -
 * directly, wrapped in `ARRAYFORMULA(...)`, behind an `IF(cond, "",
 * HYPERLINK(...))` guard, etc. Handles Google's habit of splitting long URLs
 * into `"a"&"b"&"c"` chunks, wrapping them in `CONCATENATE(...)`, and
 * referencing other cells/ranges (`&B3&`, `&B3:B&`) - the latter resolved
 * against the sheet's cached values via `resolveCellRef(ref)`. Returns null
 * if the formula has no HYPERLINK() call, or uses anything outside the
 * subset `evaluateFormulaTokens` supports - evaluating arbitrary formulas is
 * out of scope here.
 */
function extractHyperlinkTarget(formula, resolveCellRef) {
    const trimmed = typeof formula === 'string' ? formula.trim().replace(/^=/, '') : '';
    if (!trimmed || !/HYPERLINK/i.test(trimmed)) return null;

    const tokens = tokenizeFormulaExpr(trimmed);
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

function columnIndexToLetters(index) {
    let n = index + 1;
    let letters = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

function parseCellRef(ref) {
    const m = typeof ref === 'string' ? ref.match(/^([A-Z]+)([0-9]+)$/) : null;
    return m ? { col: columnLettersToIndex(m[1]), row: parseInt(m[2], 10) } : null;
}

/** Shifts a cell reference by (deltaCol, deltaRow) - used to translate a shared formula's relative references from its master cell to whichever cell is actually being evaluated. */
function shiftCellRef(ref, deltaCol, deltaRow) {
    const parsed = parseCellRef(ref);
    if (!parsed) return ref;
    const col = parsed.col + deltaCol;
    const row = parsed.row + deltaRow;
    if (col < 0 || row < 1) return ref;
    return `${columnIndexToLetters(col)}${row}`;
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

/** Finds the array-formula range (if any) whose cell rectangle contains `ref`. */
function findContainingArrayFormula(ref, arrayFormulaRanges) {
    const target = parseCellRef(ref);
    if (!target) return null;
    return arrayFormulaRanges.find(r =>
        target.col >= r.startCol && target.col <= r.endCol &&
        target.row >= r.startRow && target.row <= r.endRow
    ) || null;
}

/**
 * Resolves a cell's own formula text, handling two ways Excel/Sheets avoid
 * repeating formula text on every cell of a fill-down or ARRAYFORMULA:
 * - Shared formulas (`<f t="shared" si="N">`): text is stored once, on the
 *   group's first ("master") cell - other member cells have an empty
 *   `<f t="shared" si="N"/>` and rely on relative-reference shifting.
 * - Array formulas (`<f t="array" ref="N3:N355">`): text is stored once, on
 *   the range's top-left cell - every other cell in the range has no `<f>`
 *   at all, so containment in `arrayFormulaRanges` is checked by position.
 * Returns `{ text, originRef }` (originRef is the master/top-left cell's ref,
 * needed to compute how far this cell's own references have shifted), or
 * null if there's no usable formula text.
 */
function resolveFormulaText(cellEl, ref, sharedFormulaMasters, arrayFormulaRanges) {
    const formulaEl = cellEl.getElementsByTagName('f')[0];
    if (formulaEl) {
        if (formulaEl.textContent) return { text: formulaEl.textContent, originRef: ref };
        if (formulaEl.getAttribute('t') === 'shared') {
            const master = sharedFormulaMasters.get(formulaEl.getAttribute('si'));
            if (master) return { text: master.text, originRef: master.ref };
        }
    }
    const arrayMatch = findContainingArrayFormula(ref, arrayFormulaRanges);
    if (arrayMatch) return { text: arrayMatch.text, originRef: arrayMatch.startRef };
    return null;
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

    // Pre-pass: shared-formula master text, keyed by `si` (see resolveFormulaText).
    const sharedFormulaMasters = new Map();
    cellEls.forEach(cellEl => {
        const formulaEl = cellEl.getElementsByTagName('f')[0];
        const ref = cellEl.getAttribute('r');
        if (formulaEl && ref && formulaEl.getAttribute('t') === 'shared' && formulaEl.textContent) {
            const si = formulaEl.getAttribute('si');
            if (si !== null) sharedFormulaMasters.set(si, { ref, text: formulaEl.textContent });
        }
    });

    // Pre-pass: array-formula (ARRAYFORMULA) output ranges - text lives only
    // on the range's top-left cell, keyed by its cell rectangle (see
    // findContainingArrayFormula/resolveFormulaText).
    const arrayFormulaRanges = [];
    cellEls.forEach(cellEl => {
        const formulaEl = cellEl.getElementsByTagName('f')[0];
        if (!formulaEl || formulaEl.getAttribute('t') !== 'array' || !formulaEl.textContent) return;
        const refAttr = formulaEl.getAttribute('ref') || cellEl.getAttribute('r');
        if (!refAttr) return;
        const [startRefRaw, endRefRaw] = refAttr.includes(':') ? refAttr.split(':') : [refAttr, refAttr];
        const start = parseCellRef(startRefRaw);
        const end = parseCellRef(endRefRaw);
        if (!start || !end) return;
        arrayFormulaRanges.push({
            startRef: startRefRaw,
            startCol: start.col, endCol: end.col,
            startRow: start.row, endRow: end.row,
            text: formulaEl.textContent,
        });
    });

    function readCellValue(cellEl, ref) {
        const formula = resolveFormulaText(cellEl, ref, sharedFormulaMasters, arrayFormulaRanges);
        if (formula) {
            const origin = parseCellRef(formula.originRef);
            const target = parseCellRef(ref);
            const deltaCol = origin && target ? target.col - origin.col : 0;
            const deltaRow = origin && target ? target.row - origin.row : 0;
            const resolveCellRef = (cellRef) => cellValuesByRef.get(shiftCellRef(cellRef, deltaCol, deltaRow)) ?? '';
            const hyperlinkUrl = extractHyperlinkTarget(formula.text, resolveCellRef);
            if (hyperlinkUrl !== null) return hyperlinkUrl;
        }
        return readCachedCellValue(cellEl, sharedStrings);
    }

    return Array.from(doc.getElementsByTagName('row')).map(rowEl => {
        const record = [];
        Array.from(rowEl.getElementsByTagName('c')).forEach(cellEl => {
            const ref = cellEl.getAttribute('r') || '';
            const colLetters = ref.match(/^[A-Z]+/)?.[0];
            if (!colLetters) return;
            record[columnLettersToIndex(colLetters)] = readCellValue(cellEl, ref);
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
