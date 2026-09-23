/**
 * Embed host
 *
 * When the atlas is embedded in an iframe (see docs/guides/hosting-instance.md),
 * a share link pointing at amche.in is the wrong link to hand out: the visitor
 * is looking at someone else's page, and that is where a shared link should
 * reopen. Only the origin and path come from the host - the map's own query
 * parameters and hash still describe the view, and the host mirrors those onto
 * its address bar from the `{type: 'url'}` messages url-manager.js posts out.
 *
 * The host identifies itself either way round:
 *  - explicitly, by posting `{type: 'amche:embed', href}` into the frame, which
 *    keeps working when a referrer is stripped, and
 *  - implicitly via document.referrer, so an embed that wires up nothing at all
 *    still gets links back to itself.
 *
 * Only the main application page runs this - the app's own internal iframes
 * (map-browser, map-export, map-inspector) don't load the sharing code.
 */

const isEmbedded = window.parent !== window;

let declaredHostHref = null;

if (isEmbedded) {
    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        if (event.data?.type !== 'amche:embed' || typeof event.data.href !== 'string') return;
        try {
            // A page may name itself, not somewhere else: the URL it claims has
            // to match the origin the message actually came from.
            const url = new URL(event.data.href);
            if (url.origin === event.origin) declaredHostHref = url.href;
        } catch (error) {
            console.debug('[EmbedHost] Ignoring unparseable host URL:', error);
        }
    });
}

/** The embedding page's origin + path, or null when not embedded. */
function embedHostBase() {
    if (!isEmbedded) return null;
    const href = declaredHostHref || document.referrer;
    if (!href) return null;
    try {
        const url = new URL(href);
        if (url.href === window.location.href) return null;
        return url.origin + url.pathname;
    } catch (error) {
        return null;
    }
}

/**
 * Rewrites a link to this map so it points at the embedding page instead,
 * keeping the parameters and hash that describe the view. Returns `href`
 * unchanged when the atlas isn't embedded.
 */
export function rebaseOnEmbedHost(href) {
    const base = embedHostBase();
    if (!base) return href;
    try {
        const url = new URL(href, window.location.href);
        return base + url.search + url.hash;
    } catch (error) {
        console.debug('[EmbedHost] Failed to rebase share URL:', error);
        return href;
    }
}
