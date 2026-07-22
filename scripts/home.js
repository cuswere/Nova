import { initSharedPage } from './shared.js';

function setupOptionDetails() {
    document.querySelectorAll('.option-btn .info').forEach((toggle) => {
        const details = document.getElementById(toggle.getAttribute('aria-controls'));
        if (!details) return;

        toggle.addEventListener('click', () => {
            const open = details.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.textContent = open ? '−' : '+';
        });
    });
}

/* Confirms before handing the reader off to another site. Driven by the
   data-confirm-exit attribute rather than a URL, so the dialog is reusable and
   the destination stays declared in the markup. Falls through to a plain link
   wherever <dialog> is unsupported. */
function setupExitConfirm() {
    const dialog = document.querySelector('.exit-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return;

    const host = dialog.querySelector('.exit-dialog-host');
    let destination = null;
    let grab = null;

    const EDGE = 8;
    // Clamped on both axes so neither the opening position nor a drag can leave
    // the dialog partly off-screen.
    const moveTo = (left, top) => {
        const box = dialog.getBoundingClientRect();
        dialog.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE))}px`;
        dialog.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE))}px`;
    };

    const grip = dialog.querySelector('.exit-dialog-grip');
    grip.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const box = dialog.getBoundingClientRect();
        grab = { x: event.clientX - box.left, y: event.clientY - box.top };
        grip.setPointerCapture(event.pointerId);
        // Stops the press selecting the message text underneath.
        event.preventDefault();
    });
    grip.addEventListener('pointermove', (event) => {
        if (grab) moveTo(event.clientX - grab.x, event.clientY - grab.y);
    });
    // Pointer capture routes both here even when released outside the grip.
    grip.addEventListener('pointerup', () => { grab = null; });
    grip.addEventListener('pointercancel', () => { grab = null; });

    document.addEventListener('click', (event) => {
        const link = event.target.closest?.('a[data-confirm-exit]');
        if (!link || event.defaultPrevented || event.button !== 0) return;
        // A modified click already says how the reader wants it opened, and
        // can't take them anywhere by surprise. Only the plain one needs asking.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        event.preventDefault();
        destination = link.href;
        host.textContent = new URL(link.href).hostname;

        // Shown first because it cannot be measured while closed; the placement
        // lands in the same task, so no centred frame is ever painted.
        dialog.showModal();
        const anchor = link.getBoundingClientRect();
        moveTo(anchor.left, anchor.bottom + EDGE);
        // Park focus on the dialog itself rather than letting it land on a
        // button, which would open wearing a focus ring nobody asked for. Set
        // explicitly because engines differ on where showModal puts it. Tab still
        // reaches both buttons, and Escape still cancels.
        dialog.focus();
    });

    // Opened from the button's own click rather than the dialog's close event,
    // so the popup blocker sees an unambiguous user gesture. The form's
    // method="dialog" closes it either way; Escape and No open nothing.
    dialog.querySelector('[value="yes"]').addEventListener('click', () => {
        if (destination) window.open(destination, '_blank', 'noopener');
    });
    dialog.addEventListener('close', () => { destination = null; });
}

initSharedPage();
setupOptionDetails();
setupExitConfirm();
