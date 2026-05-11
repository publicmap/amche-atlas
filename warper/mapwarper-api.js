const MAPWARPER_SERVERS = [
    {
        id: 'mapwarper',
        name: 'Default',
        url: 'https://mapwarper.net',
        signupPath: '/u/sign_up',
        oauthProviders: []
    },
    {
        id: 'wmflabs',
        name: 'WMF Warper',
        url: 'https://warper.wmflabs.org',
        signupPath: '/u/sign_up',
        oauthProviders: ['mediawiki', 'github']
    }
];

class MapwarperAPI {
    constructor() {
        this.auth = { token: null, userId: null, baseUrl: null, login: null, userData: null };
        this._restoreAuth();
    }

    get isAuthenticated() {
        return !!this.auth.token;
    }

    _authHeaders() {
        return {
            'X-User-Token': this.auth.token,
            'X-User-Id': this.auth.userId
        };
    }

    _restoreAuth() {
        try {
            const saved = localStorage.getItem('mapwarperAuth');
            if (saved) this.auth = JSON.parse(saved);
        } catch (e) {
            localStorage.removeItem('mapwarperAuth');
        }
    }

    saveAuth() {
        localStorage.setItem('mapwarperAuth', JSON.stringify(this.auth));
    }

    clearAuth() {
        this.auth = { token: null, userId: null, baseUrl: null, login: null, userData: null };
        localStorage.removeItem('mapwarperAuth');
    }

    async loginWithOAuth(baseUrl, provider) {
        return new Promise((resolve, reject) => {
            const server = MAPWARPER_SERVERS.find(s => s.url === baseUrl);
            const popup = window.open(
                '',
                'mapwarper-oauth',
                'width=600,height=700,menubar=no,toolbar=no,location=no,status=no'
            );

            if (!popup) {
                reject(new Error('Popup blocked — please allow popups for this site.'));
                return;
            }

            if (server && server.oauthViaSignIn) {
                popup.location.href = `${baseUrl}/u/sign_in`;
                this._oauthPopup = popup;
                this._oauthReject = reject;
                reject(new Error('oauth-via-signin'));
                return;
            }

            const action = `${baseUrl}/u/auth/${provider}?omniauth_window_type=newWindow`;
            popup.document.write(
                '<html><body><form id="f" method="post" action="' + action + '"></form>' +
                '<script>document.getElementById("f").submit();<\/script></body></html>'
            );
            popup.document.close();

            this._oauthPopup = popup;
            this._oauthReject = reject;

            const cleanup = () => {
                clearInterval(pollInterval);
                clearInterval(checkClosed);
                window.removeEventListener('message', messageHandler);
                this._oauthPopup = null;
                this._oauthReject = null;
            };

            const pollInterval = setInterval(() => {
                if (!popup.closed) {
                    try { popup.postMessage('requestCredentials', baseUrl); } catch (e) { /* cross-origin, ok */ }
                }
            }, 500);

            const checkClosed = setInterval(() => {
                if (popup.closed) {
                    cleanup();
                    reject(new Error('oauth-popup-closed'));
                }
            }, 500);

            const messageHandler = (event) => {
                const data = event.data;
                if (!data || !data.auth_token) return;
                cleanup();
                popup.close();
                this.auth = {
                    token: data.auth_token,
                    userId: String(data.id),
                    baseUrl,
                    login: data.name || data.email || provider,
                    userData: {
                        id: String(data.id),
                        attributes: { login: data.name || data.email, provider: data.provider }
                    }
                };
                resolve(this.auth);
            };

            window.addEventListener('message', messageHandler);
        });
    }

    dismissOAuth() {
        if (this._oauthPopup && !this._oauthPopup.closed) {
            this._oauthPopup.close();
        }
    }

    async login(baseUrl, email, password) {
        const response = await fetch(`${baseUrl}/api/v1/auth/sign_in.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: { email, password } })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        this.auth = {
            token: data.meta.auth_token,
            userId: data.data.id,
            baseUrl,
            login: data.data.attributes.login,
            userData: data.data
        };
        return data;
    }

    async getMap(baseUrl, mapId) {
        const response = await fetch(`${baseUrl}/api/v1/maps/${mapId}.json`);
        if (!response.ok) throw new Error(`Failed to fetch map: ${response.status}`);
        return response.json();
    }

    async getGCPs(baseUrl, mapId) {
        const response = await fetch(`${baseUrl}/api/v1/maps/${mapId}/gcps`);
        if (!response.ok) throw new Error(`Failed to fetch GCPs: ${response.status}`);
        return response.json();
    }

    async deleteGCP(baseUrl, gcpId) {
        const response = await fetch(`${baseUrl}/api/v1/gcps/${gcpId}`, {
            method: 'DELETE',
            headers: this._authHeaders()
        });
        if (!response.ok) throw new Error(`Failed to delete GCP ${gcpId}: ${response.status}`);
    }

    async createGCP(baseUrl, mapId, gcp) {
        const response = await fetch(`${baseUrl}/api/v1/gcps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
            body: JSON.stringify({ data: { type: 'gcps', attributes: { map_id: parseInt(mapId), x: gcp.x, y: gcp.y, lat: gcp.lat, lon: gcp.lon } } })
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Failed to create GCP: ${err}`);
        }
        return response.json();
    }

    async updateGCP(baseUrl, gcpId, gcp) {
        const response = await fetch(`${baseUrl}/api/v1/gcps/${gcpId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
            body: JSON.stringify({ data: { type: 'gcps', id: String(gcpId), attributes: { x: gcp.x, y: gcp.y, lat: gcp.lat, lon: gcp.lon } } })
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Failed to update GCP ${gcpId}: ${err}`);
        }
        return response.json();
    }

    async syncGCPs(baseUrl, mapId, gcps) {
        const existingData = await this.getGCPs(baseUrl, mapId);
        const existingIds = new Set((existingData.data || []).map(g => String(g.id)));
        const submittedIds = new Set(gcps.filter(g => g.gcpId).map(g => String(g.gcpId)));

        const toDelete = (existingData.data || []).filter(g => !submittedIds.has(String(g.id)));
        const toUpdate = gcps.filter(g => g.gcpId && existingIds.has(String(g.gcpId)));
        const toCreate = gcps.filter(g => !g.gcpId);

        await Promise.all(toDelete.map(g => this.deleteGCP(baseUrl, g.id)));
        await Promise.all(toUpdate.map(g => this.updateGCP(baseUrl, g.gcpId, g)));
        const created = await Promise.all(toCreate.map(g => this.createGCP(baseUrl, mapId, g)));
        return { deleted: toDelete.length, updated: toUpdate.length, created: toCreate.length, createdData: created };
    }

    async getUserActivity(baseUrl, userId, page = 1) {
        const response = await fetch(`${baseUrl}/api/v1/activity/users/${userId}?per_page=100&page=${page}`, {
            headers: this._authHeaders()
        });
        if (!response.ok) throw new Error(`Failed to fetch user activity: ${response.status}`);
        return response.json();
    }


    async getMapStatus(baseUrl, mapId) {
        const response = await fetch(`${baseUrl}/api/v1/maps/${mapId}/status`);
        if (!response.ok) throw new Error(`Failed to get map status: ${response.status}`);
        return (await response.text()).trim();
    }

    async warpMap(baseUrl, mapId, warpType = 'auto') {
        const body = new URLSearchParams({
            use_mask: 'true',
            format: 'json',
            transform_options: warpType,
            resample_options: 'near'
        });
        const response = await fetch(`${baseUrl}/api/v1/maps/${mapId}/rectify`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this._authHeaders() },
            body
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Warp failed (${response.status}): ${err}`);
        }
        return response.json();
    }

    async getLayer(baseUrl, layerId) {
        const response = await fetch(`${baseUrl}/api/v1/layers/${layerId}.json`);
        if (!response.ok) throw new Error(`Failed to fetch layer: ${response.status}`);
        return response.json();
    }

    async getLayerMaps(baseUrl, layerId, page = 1, perPage = 50) {
        const response = await fetch(`${baseUrl}/api/v1/layers/${layerId}/maps?page=${page}&per_page=${perPage}`);
        if (!response.ok) throw new Error(`Failed to fetch layer maps: ${response.status}`);
        return response.json();
    }
}

window.mapwarperAPI = new MapwarperAPI();
window.MAPWARPER_SERVERS = MAPWARPER_SERVERS;
