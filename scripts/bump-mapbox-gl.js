const { bump } = require('./bump-lib');

bump({
    name: 'mapbox-gl',
    repo: 'mapbox/mapbox-gl-js',
    patterns: [
        [/(mapbox-gl@v?)\d+\.\d+\.\d+(?:-[\w.]+)?(?=\/)/g, '$1$V'],
        [/(mapbox-gl-js\/v)\d+\.\d+\.\d+(?:-[\w.]+)?(?=\/mapbox-gl\.)/g, '$1$V'],
        [/(mapbox:\s*\{\s*version:\s*')[^']+(?=')/g, '$1$V']
    ]
});
