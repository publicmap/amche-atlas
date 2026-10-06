const { bump } = require('./bump-lib');

bump({
    name: 'maplibre-gl',
    repo: 'maplibre/maplibre-gl-js',
    patterns: [
        [/(maplibre-gl@v?)\d+\.\d+\.\d+(?:-[\w.]+)?(?=\/)/g, '$1$V'],
        [/(maplibre:\s*\{\s*version:\s*')[^']+(?=')/g, '$1$V']
    ]
});
