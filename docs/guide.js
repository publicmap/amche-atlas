const PAGES = [
    { slug: 'home', file: 'guides/home.md', label: 'Home' },
    { slug: 'controls', file: 'guides/controls.md', label: 'Atlas controls', group: 'Guide' },
    { slug: 'quickstart', file: 'guides/quickstart.md', label: '10 minute quickstart', group: 'Tutorials' },
    { slug: 'adding-data', file: 'guides/adding-data.md', label: 'Adding your own data', group: 'Tutorials' },
    { slug: 'curating-atlas', file: 'guides/curating-atlas.md', label: 'Curating a map atlas for your community', group: 'Tutorials' },
    { slug: 'hosting-instance', file: 'guides/hosting-instance.md', label: 'Hosting your own atlas instance', group: 'Tutorials' },
    { slug: 'url-api', file: 'API.md', label: 'Using the URL API', group: 'Tutorials' },
];

// The open page's own headings, nested under its entry in the sidebar,
// so a long guide can be navigated section by section without scrolling
// it first. Rendered empty until the page's markdown has been parsed.
function renderPageToc(sections) {
    if (!sections.length) return '';
    return `<ul class="page-toc">
        ${sections.map(s => `
            <li class="depth-${s.depth}"><a href="#${s.id}">${s.text}</a></li>
        `).join('')}
    </ul>`;
}

function renderToc(activeSlug, sections = []) {
    const toc = document.getElementById('toc');
    const groups = [{ name: null, items: PAGES.filter(p => !p.group) }];
    for (const p of PAGES) {
        if (!p.group) continue;
        let group = groups.find(g => g.name === p.group);
        if (!group) groups.push(group = { name: p.group, items: [] });
        group.items.push(p);
    }
    toc.innerHTML = groups.map(group => `
        ${group.name ? `<h2>${group.name}</h2>` : ''}
        <${group.name === 'Tutorials' ? 'ol' : 'ul'}>
            ${group.items.map((p, i) => `
                <li>
                    <a href="?page=${p.slug}" class="${p.slug === activeSlug ? 'active' : ''}">
                        ${group.name === 'Tutorials' ? `<span class="num">${i + 1}.</span>` : ''}${p.label}
                    </a>
                    ${p.slug === activeSlug ? renderPageToc(sections) : ''}
                </li>
            `).join('')}
        </${group.name === 'Tutorials' ? 'ol' : 'ul'}>
    `).join('');
}

const REPO = 'https://github.com/publicmap/amche-atlas';

function slugify(text) {
    return text.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-');
}

// Every heading becomes its own link target, the way GitHub renders
// markdown - so any section of a guide can be linked to directly.
// Returns the h2/h3 sections, which become the sidebar's page TOC.
function linkHeadings(root) {
    const used = new Set();
    const sections = [];
    root.querySelectorAll('h1, h2, h3, h4').forEach(heading => {
        const base = slugify(heading.textContent) || 'section';
        let id = base;
        for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        heading.id = id;
        heading.innerHTML = `<a class="heading-anchor" href="#${id}">${heading.innerHTML}</a>`;
        if (heading.tagName === 'H2' || heading.tagName === 'H3') {
            sections.push({ id, text: heading.textContent, depth: heading.tagName === 'H2' ? 2 : 3 });
        }
    });
    return sections;
}

// Highlights the section currently at the top of the viewport in the
// page TOC, so the sidebar tracks where the reader actually is.
let visibleSections = [];

function syncActiveSection() {
    if (!visibleSections.length) return;
    const top = (id) => document.getElementById(id)?.getBoundingClientRect().top ?? Infinity;
    let currentId = visibleSections[0].id;

    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        // At the foot of the page the last few sections can never reach
        // the top, so track the first one still visible instead.
        currentId = (visibleSections.find(s => top(s.id) >= 0) || visibleSections.at(-1)).id;
    } else {
        for (const section of visibleSections) {
            if (top(section.id) > 120) break;
            currentId = section.id;
        }
    }
    document.querySelectorAll('.page-toc a').forEach(link => {
        link.classList.toggle('current', link.getAttribute('href') === `#${currentId}`);
    });
}

// Anything that isn't another guide page or a section of this one leaves the
// guide entirely - GitHub, the map, a code example - so give it its own tab
// rather than losing the reader's place.
function openOffsiteLinksInNewTab(root) {
    root.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href.startsWith('#') || href.startsWith('?page=')) return;
        link.target = '_blank';
        link.rel = 'noopener';
    });
}

function scrollToHash() {
    if (!location.hash) return window.scrollTo(0, 0);
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

let currentSlug = null;

async function loadPage() {
    const slug = new URLSearchParams(location.search).get('page') || 'home';
    const page = PAGES.find(p => p.slug === slug) || PAGES[0];
    currentSlug = page.slug;
    renderToc(page.slug);

    const content = document.getElementById('content');
    content.innerHTML = '<p class="loading">Loading…</p>';
    document.title = page.slug === 'home' ? 'Amche Atlas — Help & Guide' : `${page.label} — Amche Atlas`;

    try {
        const response = await fetch(page.file);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const markdown = await response.text();
        const html = window.marked ? marked.parse(markdown) : markdown;
        // Images and file links in the markdown are written relative to the
        // markdown file, so they resolve on GitHub too. The browser resolves
        // them against this page instead, so rebase them onto the file's own
        // folder. In-guide links (?page=, #section) and absolute URLs are
        // already correct and left alone.
        const folder = page.file.slice(0, page.file.lastIndexOf('/') + 1);
        content.innerHTML = html.replace(
            /(src|href)="(?!https?:|\/|#|\?|data:|mailto:)/g, `$1="${folder}`);
        visibleSections = linkHeadings(content);
        openOffsiteLinksInNewTab(content);
        renderToc(page.slug, visibleSections);
        content.insertAdjacentHTML('beforeend', `
            <footer class="page-footer">
                <a class="edit-source" href="${REPO}/edit/main/docs/${page.file}">Edit source</a>
                <span>This page is written in markdown. Corrections welcome.</span>
            </footer>
        `);
        scrollToHash();
        syncActiveSection();
    } catch (error) {
        visibleSections = [];
        content.innerHTML = `<p>Couldn't load this page (${error.message}). ` +
            `<a href="${REPO}/tree/main/docs/${page.file}">View it on GitHub</a> instead.</p>`;
    }
}

let scrollPending = false;
window.addEventListener('scroll', () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
        scrollPending = false;
        syncActiveSection();
    });
}, { passive: true });

window.addEventListener('popstate', () => {
    const slug = new URLSearchParams(location.search).get('page') || 'home';
    if (slug === currentSlug) scrollToHash();
    else loadPage();
});

document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="?page="]');
    if (!link) return;
    event.preventDefault();
    history.pushState(null, '', link.getAttribute('href'));
    loadPage();
});

loadPage();
