const DB_NAME = 'amche-geojson';
const STORE = 'geojson';
const LEGACY_PREFIX = 'geojson_';

let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).then(async db => {
            await migrateLegacy(db);
            return db;
        });
        dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
}

function run(db, mode, action) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function legacyKeys() {
    try {
        return Object.keys(localStorage).filter(key => key.startsWith(LEGACY_PREFIX));
    } catch {
        return [];
    }
}

function readLegacy(id) {
    try {
        const raw = localStorage.getItem(LEGACY_PREFIX + id);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function migrateLegacy(db) {
    for (const key of legacyKeys()) {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            await run(db, 'readwrite', store => store.put(data, key.slice(LEGACY_PREFIX.length)));
            localStorage.removeItem(key);
        } catch (error) {
            console.warn(`[geojson-store] Could not move ${key} out of localStorage:`, error);
        }
    }
}

export async function putGeoJSON(id, geojson) {
    const db = await openDb();
    await run(db, 'readwrite', store => store.put(geojson, id));
}

export async function getGeoJSON(id) {
    try {
        const db = await openDb();
        const data = await run(db, 'readonly', store => store.get(id));
        return data ?? readLegacy(id);
    } catch (error) {
        console.error('[geojson-store] Failed to read stored GeoJSON:', error);
        return readLegacy(id);
    }
}

export async function deleteGeoJSON(id) {
    try {
        const db = await openDb();
        await run(db, 'readwrite', store => store.delete(id));
    } catch (error) {
        console.warn('[geojson-store] Failed to delete stored GeoJSON:', error);
    }
}

const HANDLE_PREFIX = 'file-handle:';

export async function putFileHandle(id, handle) {
    try {
        await putGeoJSON(HANDLE_PREFIX + id, handle);
    } catch (error) {
        console.warn('[geojson-store] Could not remember the file for this layer:', error);
    }
}

export async function getFileHandle(id) {
    try {
        const db = await openDb();
        return await run(db, 'readonly', store => store.get(HANDLE_PREFIX + id)) || null;
    } catch {
        return null;
    }
}
