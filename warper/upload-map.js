const UPLOAD_FIELDS = [
    { name: 'title', label: 'Title', required: true },
    { name: 'description', label: 'Description (max 256 chars)', type: 'textarea', maxlength: 256 },
    { name: 'issue_year', label: 'Issue Year (year, optional)', type: 'number', hint: 'Used to display maps by year.' },
    { name: 'tag_list', label: 'Tags (comma separated)' },
    {
        name: 'map_type', label: 'Type', type: 'select',
        options: [['is_map', 'Is a map'], ['index', 'Is an index / overview map'], ['not_map', 'Is not a map']]
    }
];

const UPLOAD_METADATA_FIELDS = [
    { name: 'subject_area', label: 'Subject Area' },
    { name: 'unique_id', label: 'Metadata Unique ID' },
    { name: 'source_uri', label: 'Source / Bibliographic Ref URL', type: 'url' },
    { name: 'call_number', label: 'Call Number' },
    { name: 'publisher', label: 'Publisher' },
    { name: 'publication_place', label: 'Place of Publication' },
    { name: 'authors', label: 'Author(s)' },
    { name: 'date_depicted', label: 'Date Depicted (year)', type: 'number' },
    { name: 'scale', label: 'Scale' },
    { name: 'metadata_projection', label: 'Metadata Projection' },
    { name: 'metadata_lat', label: 'Metadata Location Lat', type: 'number', step: 'any' },
    { name: 'metadata_lon', label: 'Metadata Location Lon', type: 'number', step: 'any' }
];

class MapUploader {
    constructor() {
        this.file = null;
        this.gcps = null;
        this.modal = null;
        this._dragDepth = 0;
        this._setupDropTarget();
    }

    get baseUrl() {
        return mapwarperAPI.auth.baseUrl || (typeof warpBaseUrl !== 'undefined' && warpBaseUrl) || 'https://mapwarper.net';
    }

    _fieldHTML(f) {
        const id = `upload-${f.name}`;
        const base = 'w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
        const attrs = `id="${id}" name="${f.name}" class="${base}"${f.required ? ' required' : ''}${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${f.step ? ` step="${f.step}"` : ''}`;
        let input;
        if (f.type === 'textarea') input = `<textarea ${attrs} rows="2"></textarea>`;
        else if (f.type === 'select') input = `<select ${attrs}>${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
        else input = `<input type="${f.type || 'text'}" ${attrs} autocomplete="off">`;
        const hint = f.hint ? `<p class="text-xs text-gray-500 mt-0.5">${f.hint}</p>` : '';
        return `<div><label for="${id}" class="block text-xs font-medium text-gray-700 mb-1">${f.label}</label>${input}${hint}</div>`;
    }

    _build() {
        const modal = document.createElement('div');
        modal.id = 'upload-map-modal';
        modal.className = 'modal';
        modal.style.zIndex = '9990';
        modal.innerHTML = `
            <div class="modal-content" style="width:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow-y:auto;">
                <div class="modal-header flex justify-between items-center">
                    <span>Upload a new map</span>
                    <button type="button" data-upload-close class="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
                </div>
                <p class="text-xs text-gray-600 mb-3">By uploading images to <span data-upload-server class="font-medium"></span>, you agree that you have permission to do so, and accept that anyone else can potentially view and use them, including changing control points.</p>
                <div data-upload-auth class="hidden mb-3 p-2 rounded bg-yellow-50 border border-yellow-200 text-xs text-yellow-800">
                    You need to be logged in to upload. <button type="button" data-upload-login class="underline font-medium">Log in</button>
                </div>
                <form id="upload-map-form" class="space-y-3" novalidate>
                    <div data-upload-drop class="border-2 border-dashed border-gray-300 rounded p-3 text-center text-sm text-gray-600 cursor-pointer hover:border-blue-400">
                        <div data-upload-preview class="hidden mb-2"><img class="mx-auto max-h-32 rounded" alt=""></div>
                        <div data-upload-file-label>Drop an image here or <span class="text-blue-600 underline">choose a file</span></div>
                        <input type="file" id="upload-file" accept="image/*,.tif,.tiff" class="hidden">
                    </div>
                    <div>
                        <label for="upload-upload_url" class="block text-xs font-medium text-gray-700 mb-1">OR upload from a URL</label>
                        <input type="url" id="upload-upload_url" name="upload_url" autocomplete="off" placeholder="https://example.com/map.jpg"
                            class="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <label data-upload-gcps class="hidden flex items-start gap-2 p-2 rounded bg-blue-50 border border-blue-200 text-xs text-blue-900">
                        <input type="checkbox" id="upload-keep-gcps" checked class="mt-0.5">
                        <span>Keep the alignment: add <span data-upload-gcp-count></span> to the new map on <span data-upload-server></span><span data-upload-gcp-warp>, then warp it</span></span>
                    </label>
                    ${UPLOAD_FIELDS.map(f => this._fieldHTML(f)).join('')}
                    <details>
                        <summary class="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800 select-none">More metadata (optional)</summary>
                        <div class="grid grid-cols-2 gap-3 mt-2">
                            ${UPLOAD_METADATA_FIELDS.map(f => this._fieldHTML(f)).join('')}
                        </div>
                        <button type="button" data-upload-center class="mt-2 text-xs text-blue-600 hover:underline">Use reference map center as location</button>
                    </details>
                    <p data-upload-error class="hidden text-xs text-red-600 whitespace-pre-line"></p>
                    <div class="flex justify-end gap-2 pt-1">
                        <button type="button" class="btn secondary" data-upload-close>Cancel</button>
                        <button type="submit" class="btn" data-upload-submit>Upload</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(modal);
        this.modal = modal;

        const fileInput = modal.querySelector('#upload-file');
        const drop = modal.querySelector('[data-upload-drop]');
        modal.querySelectorAll('[data-upload-close]').forEach(b => b.addEventListener('click', () => this.close()));
        modal.addEventListener('click', e => { if (e.target === modal) this.close(); });
        modal.addEventListener('mouseover', () => {
            modal.querySelector('[data-upload-auth]').classList.toggle('hidden', mapwarperAPI.isAuthenticated);
        });
        modal.querySelector('[data-upload-login]').addEventListener('click', () => showAuthModal());
        modal.querySelector('[data-upload-center]').addEventListener('click', () => this._useMapCenter());
        drop.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => fileInput.files[0] && this.setFile(fileInput.files[0]));
        fileInput.addEventListener('click', e => e.stopPropagation());
        modal.querySelector('#upload-map-form').addEventListener('submit', e => {
            e.preventDefault();
            this.submit();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    get isOpen() {
        return this.modal && this.modal.style.display === 'block';
    }

    open(file = null, { gcps = null, center = null } = {}) {
        if (!this.modal) this._build();
        const server = this.baseUrl.replace(/^https?:\/\//, '');
        this.modal.querySelectorAll('[data-upload-server]').forEach(el => { el.textContent = server; });
        this.modal.querySelector('[data-upload-auth]').classList.toggle('hidden', mapwarperAPI.isAuthenticated);
        this._showError('');
        if (file) this.setFile(file);
        this._setGcps(gcps);
        if (center) {
            const lat = this.modal.querySelector('#upload-metadata_lat');
            const lon = this.modal.querySelector('#upload-metadata_lon');
            lat.value = center.lat.toFixed(6);
            lon.value = center.lon.toFixed(6);
        }
        this.modal.style.display = 'block';
        this.modal.querySelector('#upload-title').focus();
    }

    close() {
        if (this.modal) this.modal.style.display = 'none';
    }

    _setGcps(gcps) {
        this.gcps = gcps;
        this.modal.querySelector('[data-upload-gcps]').classList.toggle('hidden', !gcps);
        if (!gcps) return;
        this.modal.querySelector('[data-upload-gcp-count]').textContent = `${gcps.length} control point${gcps.length === 1 ? '' : 's'}`;
        this.modal.querySelector('[data-upload-gcp-warp]').classList.toggle('hidden', gcps.length < 3);
    }

    setFile(file) {
        if (!this.modal) this._build();
        this.file = file;
        this._setGcps(null);
        const title = this.modal.querySelector('#upload-title');
        if (!title.value.trim()) title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        this.modal.querySelector('[data-upload-file-label]').textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB) - click to change`;
        const preview = this.modal.querySelector('[data-upload-preview]');
        const img = preview.querySelector('img');
        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
        const previewable = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);
        img.src = previewable ? URL.createObjectURL(file) : '';
        preview.classList.toggle('hidden', !previewable);
    }

    _useMapCenter() {
        if (typeof referenceMap === 'undefined' || !referenceMap) return;
        const c = referenceMap.getCenter();
        this.modal.querySelector('#upload-metadata_lat').value = c.lat.toFixed(6);
        this.modal.querySelector('#upload-metadata_lon').value = c.lng.toFixed(6);
    }

    _showError(message) {
        const el = this.modal.querySelector('[data-upload-error]');
        el.textContent = message;
        el.classList.toggle('hidden', !message);
    }

    async submit() {
        if (!mapwarperAPI.isAuthenticated) {
            this._showError('Log in to upload a map.');
            showAuthModal();
            return;
        }
        const form = this.modal.querySelector('#upload-map-form');
        const attributes = {};
        [...UPLOAD_FIELDS, ...UPLOAD_METADATA_FIELDS, { name: 'upload_url' }].forEach(({ name }) => {
            const value = form.elements[name].value.trim();
            if (value) attributes[name] = value;
        });
        if (!attributes.title) return this._showError('A title is required.');
        if (!this.file && !attributes.upload_url) return this._showError('Choose an image file or enter an image URL.');

        const submitBtn = this.modal.querySelector('[data-upload-submit]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading…';
        this._showError('');
        try {
            if (this.file) delete attributes.upload_url;
            const baseUrl = this.baseUrl;
            const result = await mapwarperAPI.createMap(baseUrl, attributes, this.file);
            const mapId = result && result.data && result.data.id;
            if (!mapId) throw new Error('The server did not return the new map id.');
            if (this.file && this.gcps && this.modal.querySelector('#upload-keep-gcps').checked) {
                submitBtn.textContent = 'Adding control points…';
                try {
                    for (const gcp of this.gcps) await mapwarperAPI.createGCP(baseUrl, mapId, gcp);
                    if (this.gcps.length >= 3) {
                        submitBtn.textContent = 'Warping…';
                        await mapwarperAPI.warpAndWait(baseUrl, mapId, 'auto', elapsed => {
                            submitBtn.textContent = `Warping… ${Math.round(elapsed / 1000)}s`;
                        });
                    }
                } catch (gcpError) {
                    alert(`The map was uploaded, but adding its control points or warping it failed:\n${gcpError.message}`);
                }
            }
            if (typeof localGeoref !== 'undefined') localGeoref.close({ reload: false });
            this.close();
            form.reset();
            this.file = null;
            this._setGcps(null);
            this.modal.querySelector('[data-upload-preview]').classList.add('hidden');
            this.modal.querySelector('[data-upload-file-label]').innerHTML = 'Drop an image here or <span class="text-blue-600 underline">choose a file</span>';
            document.getElementById('mapwarper-url').value = `${baseUrl}/maps/${mapId}`;
            loadMapWarperMap();
        } catch (error) {
            this._showError(error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload';
        }
    }

    _setupDropTarget() {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[10001] hidden items-center justify-center bg-blue-600/20 border-4 border-dashed border-blue-500 pointer-events-none';
        overlay.innerHTML = '<div class="bg-white px-6 py-4 rounded-lg shadow text-lg font-semibold text-blue-700">Drop the image to align it on the map</div>';
        const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
        const show = visible => {
            overlay.classList.toggle('hidden', !visible);
            overlay.classList.toggle('flex', visible);
        };
        document.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
        document.addEventListener('dragenter', e => {
            if (!hasFiles(e)) return;
            this._dragDepth++;
            show(true);
        });
        document.addEventListener('dragleave', e => {
            if (!hasFiles(e)) return;
            this._dragDepth = Math.max(0, this._dragDepth - 1);
            if (this._dragDepth === 0) show(false);
        });
        document.addEventListener('dragover', e => {
            if (hasFiles(e)) e.preventDefault();
        });
        document.addEventListener('drop', e => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            this._dragDepth = 0;
            show(false);
            const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/') || /\.tiff?$/i.test(f.name));
            if (!file) alert('Drop an image file (JPG, PNG, GIF or TIFF) to upload a new map.');
            else if (this.isOpen) this.setFile(file);
            else if (typeof localGeoref !== 'undefined' && localGeoref.canGeoreference(file)) localGeoref.start(file);
            else this.open(file);
        });
    }
}

window.mapUploader = new MapUploader();
