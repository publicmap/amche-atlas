const MAPWARPER_SERVERS = [
    {
        id: 'mapwarper',
        name: 'Default',
        url: 'https://mapwarper.net',
        signupPath: '/u/sign_up',
        oauthProviders: ['osm_oauth2', 'github', 'facebook']
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
            const popup = window.open(
                `${baseUrl}/u/auth/${provider}`,
                'mapwarper-oauth',
                'width=600,height=700,menubar=no,toolbar=no,location=no,status=no'
            );

            if (!popup) {
                reject(new Error('Popup blocked — please allow popups for this site.'));
                return;
            }

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

    async addManyGCPs(baseUrl, gcps) {
        const response = await fetch(`${baseUrl}/api/v1/gcps/add_many`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
            body: JSON.stringify({ gcps })
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Failed to add GCPs: ${err}`);
        }
        return response.json();
    }

    async replaceGCPs(baseUrl, mapId, gcps) {
        const existingData = await this.getGCPs(baseUrl, mapId);
        if (existingData.data && existingData.data.length > 0) {
            await Promise.all(existingData.data.map(gcp => this.deleteGCP(baseUrl, gcp.id)));
        }
        return this.addManyGCPs(baseUrl, gcps);
    }
}

window.mapwarperAPI = new MapwarperAPI();
window.MAPWARPER_SERVERS = MAPWARPER_SERVERS;
