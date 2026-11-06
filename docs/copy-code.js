// Copy buttons for the guide's code. A code block gets a button in its top
// right corner; inline `code` copies itself when clicked, its copy icon
// showing on hover. Code inside a link is left alone so the link still works.
const COPY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6ZM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2Z"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0Z"/></svg>';

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // The clipboard API needs a secure context; fall back for plain http.
        const area = Object.assign(document.createElement('textarea'), { value: text });
        area.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    }
}

function flash(el, onDone) {
    el.classList.add('copied');
    clearTimeout(el._copyTimer);
    el._copyTimer = setTimeout(() => {
        el.classList.remove('copied');
        onDone?.();
    }, 1400);
}

function addBlockButton(pre) {
    const code = pre.querySelector('code') || pre;
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.title = 'Copy to clipboard';
    button.setAttribute('aria-label', 'Copy code to clipboard');
    button.innerHTML = COPY_ICON;
    button.addEventListener('click', async () => {
        if (!await copyText(code.textContent.replace(/\n$/, ''))) return;
        button.innerHTML = `${DONE_ICON}<span>Copied</span>`;
        flash(button, () => { button.innerHTML = COPY_ICON; });
    });
    wrap.appendChild(button);
}

function makeInlineCopyable(code) {
    code.classList.add('copy-inline');
    code.tabIndex = 0;
    code.setAttribute('role', 'button');
    code.title = 'Click to copy';
    const copy = async () => {
        if (await copyText(code.textContent)) flash(code);
    };
    code.addEventListener('click', copy);
    code.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        copy();
    });
}

function addCopyButtons(root) {
    root.querySelectorAll('pre').forEach(addBlockButton);
    root.querySelectorAll('code').forEach(code => {
        if (code.closest('pre, a')) return;
        makeInlineCopyable(code);
    });
}
