const { execSync } = require('child_process');
const fs = require('fs');

const version = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error('Usage: npm run bump:mapbox-gl -- <version>   (e.g. 3.32.0)');
    process.exit(1);
}

const patterns = [
    [/(mapbox-gl@v?)\d+\.\d+\.\d+(?:-[\w.]+)?(?=\/)/g, `$1${version}`],
    [/(mapbox-gl-js\/v)\d+\.\d+\.\d+(?:-[\w.]+)?(?=\/mapbox-gl\.)/g, `$1${version}`]
];

const files = execSync('git ls-files "*.html" "*.js" "*.mjs"', { encoding: 'utf8' })
    .split('\n')
    .filter(f => f && !f.startsWith('scripts/') && !f.includes('node_modules'));

let changed = 0;
for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const out = patterns.reduce((s, [re, rep]) => s.replace(re, rep), src);
    if (out !== src) {
        fs.writeFileSync(file, out);
        console.log(`updated ${file}`);
        changed++;
    }
}
console.log(`${changed} file(s) updated to mapbox-gl ${version}`);
