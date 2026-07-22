/* What can be pressed, by role rather than by name: every control on the site is
   already a link, a button, or a listbox option, so nothing here needs updating
   when markup is added. Marking an element that has no .is-pressing styling is
   harmless — the class lands and no rule claims it. */
const PRESSABLE = 'a[href], button, [role="option"]';

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

// How long a finger must rest before a press is treated as deliberate, and how
// far it may stray in the meantime. Roughly what native touch highlighting uses.
const PRESS_DELAY_MS = 110;
const PRESS_SLOP_PX = 10;
// The two halves arrive together and leave separately. .is-pressing is the
// depressed look, which tracks the finger and should let go with it, held only
// long enough that a fast tap still registers. .is-touched is the hover look,
// which outlives the finger the way a cursor lingers after a mouse click.
const PRESS_HOLD_MS = 120;
const TOUCH_LINGER_MS = 500;

function setupNavigationState() {
    let touched = null;
    let engagedAt = 0;
    let pending = null;
    let pressTimer = null;
    let pressReleaseTimer = null;
    let touchReleaseTimer = null;

    const releasePress = () => {
        window.clearTimeout(pressReleaseTimer);
        touched?.classList.remove('is-pressing');
    };

    const release = () => {
        window.clearTimeout(touchReleaseTimer);
        releasePress();
        touched?.classList.remove('is-touched');
        touched = null;
    };

    const abandon = () => {
        window.clearTimeout(pressTimer);
        pending = null;
    };

    const engage = () => {
        if (!pending) return;
        window.clearTimeout(pressTimer);
        touched = pending.link;
        pending = null;
        engagedAt = Date.now();
        touched.classList.add('is-pressing', 'is-touched');
    };

    /* Touch browsers withhold :active on a tap, so a link gets no press feedback
       at all until the click handler below marks it — by which point the finger
       is already up and the page is unloading, leaving the tap looking inert.
       .is-pressing stands in from pointerdown instead. Mouse pointers are skipped
       because :active already covers them, and does it better: it lifts when the
       cursor drags off the link, which pointer events here would not.

       Nothing lights up on contact, though. A scroll begins with a finger landing
       on whatever happens to be under it — usually a title — and highlighting
       every one of those on the way past is just noise. So the press is held back
       until the finger has stayed put for a moment, and any real movement or a
       lift abandons it. pointercancel is not enough on its own: it arrives only
       once the browser has committed to scrolling, several frames after the
       finger started moving, which is long enough to flash. */
    document.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || event.button !== 0) return;
        release();
        abandon();
        const link = event.target.closest(PRESSABLE);
        if (!link) return;
        pending = { link, x: event.clientX, y: event.clientY };
        pressTimer = window.setTimeout(engage, PRESS_DELAY_MS);
    });
    document.addEventListener('pointermove', (event) => {
        if (!pending) return;
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > PRESS_SLOP_PX) abandon();
    });
    document.addEventListener('pointercancel', () => { abandon(); release(); });
    document.addEventListener('pointerup', () => {
        // A tap quicker than the delay still deserves its flash, so promote the
        // pending press now rather than dropping it.
        engage();
        if (!touched) return;
        // The depressed look follows the finger up, minus whatever of its minimum
        // it has already served, so a fast tap still shows something.
        pressReleaseTimer = window.setTimeout(releasePress, Math.max(0, PRESS_HOLD_MS - (Date.now() - engagedAt)));
        // And a tap that never produces a click (lifted off the target) still has to clear.
        touchReleaseTimer = window.setTimeout(release, TOUCH_LINGER_MS);
    });

    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const link = event.target.closest('a[href]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

        const destination = new URL(link.href, window.location.href);
        const sameDocument = destination.origin === window.location.origin
            && destination.pathname === window.location.pathname
            && destination.search === window.location.search;
        if (destination.origin !== window.location.origin || sameDocument) return;

        // Adding the held state before dropping the press keeps the two looking
        // like one continuous press across the handoff, with no frame in between
        // where the link snaps back to rest.
        link.classList.add('is-navigating');
        release();
        window.setTimeout(() => link.classList.remove('is-navigating'), 1000);
    });
}
