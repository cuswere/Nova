export function initSharedPage() {
    setupNavigationState();
    finishScreenRefresh();
}

function finishScreenRefresh() {
    const overlay = document.querySelector('.screen-refresh');
    if (!overlay) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        overlay.remove();
        return;
    }
    window.setTimeout(() => overlay.remove(), 380);
}

function setupNavigationState() {
    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const link = event.target.closest('a[href]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

        const destination = new URL(link.href, window.location.href);
        const sameDocument = destination.origin === window.location.origin
            && destination.pathname === window.location.pathname
            && destination.search === window.location.search;
        if (destination.origin !== window.location.origin || sameDocument) return;

        link.classList.add('is-navigating');
        window.setTimeout(() => link.classList.remove('is-navigating'), 1000);
    });
}
