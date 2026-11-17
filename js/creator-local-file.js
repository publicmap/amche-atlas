/**
 * Save to file in the layer editor (map-creator.html, beside Save to GitHub gist).
 *
 * Files are opened with the File System Access API where the browser has it
 * (Chrome, Edge), which keeps a handle to the file: Save to file then writes
 * the layer's features back into that same GeoJSON file. A layer read from
 * several files, a non-GeoJSON file or drawn from scratch is saved as a new
 * file the first time, and to that file after. The handle is kept with the
 * layer in this browser (js/geojson-store.js), so it still saves back after a
 * reload. Browsers without the API download a copy instead.
 */

import { compactCollection } from './feature-table-data.js';
import { putFileHandle, getFileHandle } from './geojson-store.js';

const LABEL = 'Save to file';
const GEOJSON = /\.(geo)?json$/i;
const ACCEPT = {
    description: 'Map data',
    accept: { 'application/geo+json': ['.geojson', '.json', '.geojsonl', '.ndjson', '.jsonl', '.csv', '.kml', '.gpkg', '.zip'] }
};
const SAVE_TYPE = { description: 'GeoJSON', accept: { 'application/geo+json': ['.geojson'] } };

const supported = () => typeof window.showOpenFilePicker === 'function';
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';

async function writable(handle) {
    const options = { mode: 'readwrite' };
    if (await handle.queryPermission?.(options) === 'granted') return true;
    return (await handle.requestPermission?.(options)) === 'granted';
}

export class CreatorLocalFile {
    constructor(creator) {
        this.creator = creator;
        this.handle = null;
    }

    /** Pick files to read: with handles where the browser allows, else the plain file input. */
    async pick() {
        if (!supported()) {
            $('#file-input').trigger('click');
            return null;
        }
        let handles;
        try {
            handles = await window.showOpenFilePicker({ multiple: true, types: [ACCEPT], excludeAcceptAllOption: false });
        } catch (error) {
            if (error.name !== 'AbortError') console.warn('[creator-local-file] Could not open files:', error);
            return null;
        }
        const files = await Promise.all(handles.map(handle => handle.getFile()));
        // Only one GeoJSON file can take the layer's features back as they are.
        const own = handles.length === 1 && GEOJSON.test(handles[0].name) ? handles[0] : null;
        if (!this.creator._appendsFiles()) this.handle = own;
        return files;
    }

    /** An existing layer: the file it was saved to before, if any. */
    async restore(layerId) {
        this.handle = layerId ? await getFileHandle(layerId) : null;
    }

    /** Keep the file with the layer under its (saved) id. */
    remember(layerId) {
        if (this.handle && layerId) putFileHandle(layerId, this.handle);
    }

    clear() {
        this.handle = null;
    }

    async save() {
        const collection = this.creator.features.collection;
        if (!collection) {
            alert('Only layers whose features are held in the editor can be saved to a file.');
            return;
        }
        const content = JSON.stringify(compactCollection(collection), null, 2);
        const title = String($('#layer-title').val() || '').trim() || 'layer';
        const $btn = $('#save-to-file-btn');
        $btn.prop('disabled', true).find('span').text('Saving…');
        try {
            if (!this.handle && typeof window.showSaveFilePicker === 'function') {
                this.handle = await window.showSaveFilePicker({ suggestedName: `${slug(title)}.geojson`, types: [SAVE_TYPE] });
            }
            if (this.handle) {
                if (!await writable(this.handle)) throw new Error('Permission to write to the file was not given.');
                const stream = await this.handle.createWritable();
                await stream.write(content);
                await stream.close();
                this.remember(String($('#layer-id').val() || '').trim());
                $btn.find('span').text(`Saved to ${this.handle.name}`);
                setTimeout(() => $btn.find('span').text(LABEL), 2000);
            } else {
                this._download(content, `${slug(title)}.geojson`);
                $btn.find('span').text(LABEL);
            }
        } catch (error) {
            $btn.find('span').text(LABEL);
            if (error.name !== 'AbortError') alert(`Could not save the file: ${error.message}`);
        } finally {
            $btn.prop('disabled', false);
        }
    }

    _download(content, filename) {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/geo+json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
}
