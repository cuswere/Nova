import { USER_AGENT } from './config.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchText(url, { retries = 2, delayMs = 0, timeoutMs = 25_000 } = {}) {
    if (delayMs > 0) await sleep(delayMs);

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    'user-agent': USER_AGENT,
                    accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return {
                text: await response.text(),
                finalUrl: response.url,
                etag: response.headers.get('etag') || ''
            };
        } catch (error) {
            lastError = error;
            if (attempt < retries) await sleep(750 * (attempt + 1));
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Unable to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

export function absoluteUrl(value, base) {
    try {
        return new URL(value, base).toString();
    } catch {
        return '';
    }
}

export function cleanText(value = '') {
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
