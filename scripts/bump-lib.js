const { execSync } = require('child_process');
const fs = require('fs');

async function resolveVersion(arg, repo) {
    if (arg === 'latest') {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: { Accept: 'application/vnd.github+json' }
        });
        if (!res.ok) {
            console.error(`Could not fetch latest ${repo} release (HTTP ${res.status})`);
            process.exit(1);
        }
        return (await res.json()).tag_name.replace(/^v/, '');
    }
    return (arg || '').replace(/^v/, '');
}

async function bump({ name, repo, patterns }) {
    const version = await resolveVersion(process.argv[2], repo);
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
        console.error(`Usage: npm run bump:${name} -- <version|latest>   (e.g. 3.32.0)`);
        process.exit(1);
    }

    const files = execSync('git ls-files "*.html" "*.js" "*.mjs"', { encoding: 'utf8' })
        .split('\n')
        .filter(f => f && !f.startsWith('scripts/') && !f.includes('node_modules'));

    let changed = 0;
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const out = patterns.reduce((s, [re, rep]) => s.replace(re, rep.replace('$V', version)), src);
        if (out !== src) {
            fs.writeFileSync(file, out);
            console.log(`updated ${file}`);
            changed++;
        }
    }
    console.log(`${changed} file(s) updated to ${name} ${version}`);
}

module.exports = { bump };
