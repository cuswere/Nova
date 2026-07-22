import { initSharedPage } from './shared.js';

const FORM_ACTION = 'https://script.google.com/macros/s/AKfycbzlRGwFvvOxhwLVMfcbah_PhqAkTENbD6A2MEzTpojI7HdRhT4HRa4FPnbIcHa9adY/exec';
const PENDING_MS = 800;
const THANKS_COUNT = 3;
const THANKS_STAGGER_MS = 50;
const THANKS_FADE_MS = 200;

function setupFeedbackForm() {
    const form = document.querySelector('.feedback-form');
    if (!form) return;

    const status = form.querySelector('.form-status');
    const submitButton = form.querySelector('.form-submit');
    let submitting = false;

    const setStatus = (text, kind) => {
        status.textContent = text;
        status.className = kind ? `form-status form-status-${kind}` : 'form-status';
    };

    const showLoading = () => {
        status.className = 'form-status form-status-loading';
        status.replaceChildren();
        const spinner = document.createElement('span');
        spinner.className = 'form-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        status.append(spinner, 'Sending…');
    };

    const closeThanksMenus = (except = null) => {
        status.querySelectorAll('.thanks-item.is-open').forEach((item) => {
            if (item === except) return;
            item.classList.remove('is-open');
            item.querySelector('.thanks-label')?.setAttribute('aria-expanded', 'false');
        });
    };

    const makeThanksItem = (index) => {
        const item = document.createElement('span');
        item.className = 'thanks-item';
        window.setTimeout(() => item.classList.add('is-in'), index * THANKS_STAGGER_MS);

        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'thanks-label';
        label.textContent = 'THANK YOU';
        label.setAttribute('aria-haspopup', 'true');
        label.setAttribute('aria-expanded', 'false');
        label.addEventListener('click', () => {
            const open = !item.classList.contains('is-open');
            closeThanksMenus(item);
            item.classList.toggle('is-open', open);
            label.setAttribute('aria-expanded', String(open));
        });

        const menu = document.createElement('span');
        menu.className = 'thanks-menu';
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'thanks-menu-option';
        option.textContent = "You're welcome";
        option.addEventListener('click', () => {
            closeThanksMenus();
            item.classList.add('is-leaving');
            window.setTimeout(() => item.classList.add('is-gone'), THANKS_FADE_MS);
        });
        menu.appendChild(option);
        item.append(label, menu);
        return item;
    };

    const showThanks = () => {
        status.className = 'form-status form-status-thanks';
        const stack = document.createElement('span');
        stack.className = 'thanks-stack';
        for (let index = 0; index < THANKS_COUNT; index += 1) stack.appendChild(makeThanksItem(index));
        status.replaceChildren(stack);
    };

    const sendFeedback = async (body) => {
        const response = await fetch(FORM_ACTION, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        if (!response.ok) throw new Error(`Feedback endpoint returned HTTP ${response.status}`);

        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Feedback was not accepted');
    };

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.thanks-item')) closeThanksMenus();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeThanksMenus();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submitting) return;

        const name = form.querySelector('#name');
        const messageField = form.querySelector('#suggestion');
        const message = messageField.value.trim();
        if (!message) {
            setStatus('There needs to be a message.', 'error');
            messageField.focus();
            return;
        }
        if (!FORM_ACTION) {
            setStatus('Feedback is not connected.', 'error');
            return;
        }

        const body = new URLSearchParams({ name: name.value, message });
        submitting = true;
        submitButton.disabled = true;
        showLoading();

        try {
            await Promise.all([
                sendFeedback(body),
                new Promise((resolve) => window.setTimeout(resolve, PENDING_MS))
            ]);
            form.reset();
            showThanks();
        } catch (error) {
            console.error('Error submitting feedback:', error);
            setStatus('Something went wrong — please try again.', 'error');
        } finally {
            submitting = false;
            submitButton.disabled = false;
        }
    });
}

initSharedPage();
setupFeedbackForm();
