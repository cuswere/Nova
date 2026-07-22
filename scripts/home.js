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

initSharedPage();
setupOptionDetails();
