import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL_API_PARAMS } from '../url-api-params.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_MD = path.resolve(__dirname, '../../docs/API.md');

/**
 * Extract the parameter names documented in the "## Parameters" section of
 * docs/API.md — i.e. the `### \`name\`` headings between "## Parameters" and the
 * next level-2 heading. Layer-type `###` headings (under "## Layer Source
 * Formats") are intentionally excluded by scoping to the Parameters section.
 */
function getDocumentedParams() {
    const md = fs.readFileSync(API_MD, 'utf8');

    const start = md.indexOf('## Parameters');
    expect(start, '"## Parameters" heading not found in docs/API.md').toBeGreaterThanOrEqual(0);

    const afterHeading = md.slice(start + '## Parameters'.length);
    const endRel = afterHeading.indexOf('\n## ');
    const section = endRel === -1 ? afterHeading : afterHeading.slice(0, endRel);

    const params = [];
    const re = /^###\s+`([^`]+)`/gm;
    let m;
    while ((m = re.exec(section)) !== null) {
        params.push(m[1]);
    }
    return params;
}

describe('URL API ↔ docs/API.md sync', () => {
    it('every parameter logged on load is documented, and vice versa', () => {
        const documented = getDocumentedParams();
        const documentedSet = new Set(documented);
        const loggedSet = new Set(URL_API_PARAMS);

        const undocumented = [...loggedSet].filter(p => !documentedSet.has(p));
        const unlisted = [...documentedSet].filter(p => !loggedSet.has(p));

        expect(
            undocumented,
            `Parameters in URL_API_PARAMS (js/url-api-params.js) but missing a "### \`name\`" section in docs/API.md → ${undocumented.join(', ')}`
        ).toEqual([]);

        expect(
            unlisted,
            `Parameters documented in docs/API.md but missing from URL_API_PARAMS (js/url-api-params.js) → ${unlisted.join(', ')}`
        ).toEqual([]);
    });

    it('docs/API.md has no duplicate parameter headings', () => {
        const documented = getDocumentedParams();
        expect(documented.length, `Duplicate parameter heading(s) in docs/API.md: ${documented.join(', ')}`)
            .toBe(new Set(documented).size);
    });
});
