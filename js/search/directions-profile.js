/**
 * The routing profile every route in the app is drawn with - the search
 * control's "X to Y" matches and the nearby-features menu's "Navigate" action
 * both read it from here, so switching profile in the nearby-features menu
 * (see map-nearby-features-control.js) also changes what a searched route
 * returns. Persisted per browser, since a user who walks doesn't want to
 * re-pick "Walking" on every visit.
 *
 * IDs are Mapbox Directions routing profiles:
 * https://docs.mapbox.com/api/navigation/directions/#routing-profiles
 */
const STORAGE_KEY = 'amche:directions-profile';

export const DIRECTIONS_PROFILES = [
    { id: 'driving-traffic', label: 'Driving (traffic)', subtext: 'Roads, using live traffic', icon: 'car-front-fill' },
    { id: 'driving', label: 'Driving', subtext: 'Roads, ignoring traffic', icon: 'car-front' },
    { id: 'walking', label: 'Walking', subtext: 'Footpaths and pedestrian ways', icon: 'person-walking' },
    { id: 'cycling', label: 'Cycling', subtext: 'Bike paths and quiet roads', icon: 'bicycle' }
];

const DEFAULT_PROFILE_ID = 'driving';

let currentId = null;

export function getDirectionsProfile() {
    if (currentId) return currentId;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && DIRECTIONS_PROFILES.some(p => p.id === stored)) currentId = stored;
    } catch (e) {
        // Private mode / storage disabled - fall through to the default.
    }
    return currentId || DEFAULT_PROFILE_ID;
}

export function setDirectionsProfile(id) {
    if (!DIRECTIONS_PROFILES.some(p => p.id === id)) return getDirectionsProfile();
    currentId = id;
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
        // Not persisting is fine - the in-memory value still applies.
    }
    return currentId;
}

export function getDirectionsProfileInfo(id = getDirectionsProfile()) {
    return DIRECTIONS_PROFILES.find(p => p.id === id) || DIRECTIONS_PROFILES.find(p => p.id === DEFAULT_PROFILE_ID);
}
