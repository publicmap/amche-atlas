/**
 * A route's badge: a disc in the route's colour with its travel mode's icon in
 * white, on a white rim so it holds up over any colour or imagery. The same
 * mark sits on the route's button in the marker dock (../route-dock-stack.js)
 * and on the route line itself (route-geojson.js's `badge/` layer).
 *
 * On the map it is a style image made on demand, one per profile and colour,
 * the first time a layer asks for it (`styleimagemissing`) - so a basemap
 * switch, which drops every added image, recovers on its own.
 */

const LOCATION_BLUE = '#1da1f2';
const PREFIX = 'route-badge:';
const SIZE = 28;
const RADIUS = 11;
const ICON = 14;

/** The Bootstrap icon per travel mode, as the dock shows it. */
export const PROFILE_ICONS = { driving: 'car-front-fill', cycling: 'bicycle', walking: 'person-walking' };

// The same three icons as SVG path data (Bootstrap Icons, MIT, 16x16), so the
// map's badge can be drawn synchronously inside `styleimagemissing`.
const ICON_PATHS = {
    driving: ['M2.52 3.515A2.5 2.5 0 0 1 4.82 2h6.362c1 0 1.904.596 2.298 1.515l.792 1.848c.075.175.21.319.38.404.5.25.855.715.965 1.262l.335 1.679q.05.242.049.49v.413c0 .814-.39 1.543-1 1.997V13.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.338c-1.292.048-2.745.088-4 .088s-2.708-.04-4-.088V13.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.892c-.61-.454-1-1.183-1-1.997v-.413a2.5 2.5 0 0 1 .049-.49l.335-1.68c.11-.546.465-1.012.964-1.261a.8.8 0 0 0 .381-.404l.792-1.848ZM3 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2m10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2M6 8a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2zM2.906 5.189a.51.51 0 0 0 .497.731c.91-.073 3.35-.17 4.597-.17s3.688.097 4.597.17a.51.51 0 0 0 .497-.731l-.956-1.913A.5.5 0 0 0 11.691 3H4.309a.5.5 0 0 0-.447.276L2.906 5.19Z'],
    cycling: ['M4 4.5a.5.5 0 0 1 .5-.5H6a.5.5 0 0 1 0 1v.5h4.14l.386-1.158A.5.5 0 0 1 11 4h1a.5.5 0 0 1 0 1h-.64l-.311.935.807 1.29a3 3 0 1 1-.848.53l-.508-.812-2.076 3.322A.5.5 0 0 1 8 10.5H5.959a3 3 0 1 1-1.815-3.274L5 5.856V5h-.5a.5.5 0 0 1-.5-.5m1.5 2.443-.508.814c.5.444.85 1.054.967 1.743h1.139zM8 9.057 9.598 6.5H6.402zM4.937 9.5a2 2 0 0 0-.487-.877l-.548.877zM3.603 8.092A2 2 0 1 0 4.937 10.5H3a.5.5 0 0 1-.424-.765zm7.947.53a2 2 0 1 0 .848-.53l1.026 1.643a.5.5 0 1 1-.848.53z'],
    walking: [
        'M9.5 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M6.44 3.752A.75.75 0 0 1 7 3.5h1.445c.742 0 1.32.643 1.243 1.38l-.43 4.083a1.8 1.8 0 0 1-.088.395l-.318.906.213.242a.8.8 0 0 1 .114.175l2 4.25a.75.75 0 1 1-1.357.638l-1.956-4.154-1.68-1.921A.75.75 0 0 1 6 8.96l.138-2.613-.435.489-.464 2.786a.75.75 0 1 1-1.48-.246l.5-3a.75.75 0 0 1 .18-.375l2-2.25Z',
        'M6.25 11.745v-1.418l1.204 1.375.261.524a.8.8 0 0 1-.12.231l-2.5 3.25a.75.75 0 1 1-1.19-.914zm4.22-4.215-.494-.494.205-1.843.006-.067 1.124 1.124h1.44a.75.75 0 0 1 0 1.5H11a.75.75 0 0 1-.531-.22Z'
    ]
};

/** The travel mode a routing profile draws as: walking, cycling, or driving for anything else. */
export function badgeMode(profile) {
    return profile === 'walking' || profile === 'cycling' ? profile : 'driving';
}

export function profileIcon(profile) {
    return PROFILE_ICONS[badgeMode(profile)];
}

/** The style image a route feature's badge is drawn with. */
export const ROUTE_BADGE_IMAGE = ['concat', PREFIX,
    ['match', ['get', 'profile'], 'cycling', 'cycling', 'walking', 'walking', 'driving'],
    ':', ['to-string', ['coalesce', ['get', 'color'], LOCATION_BLUE]]];

function drawBadge(mode, color, ratio) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.translate((SIZE - ICON) / 2, (SIZE - ICON) / 2);
    ctx.scale(ICON / 16, ICON / 16);
    ctx.fillStyle = '#ffffff';
    ICON_PATHS[mode].forEach(d => ctx.fill(new Path2D(d)));
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function installRouteBadgeImages(map) {
    if (!map || map._routeBadgeImages) return;
    map._routeBadgeImages = true;
    map.on('styleimagemissing', ({ id }) => {
        if (!id?.startsWith(PREFIX) || map.hasImage(id)) return;
        const [mode, color] = id.slice(PREFIX.length).split(':');
        if (!ICON_PATHS[mode]) return;
        const ratio = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
        map.addImage(id, drawBadge(mode, color || LOCATION_BLUE, ratio), { pixelRatio: ratio });
    });
}
