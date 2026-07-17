import { USER_AGENT } from './config.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const REQUEST_HEADERS = {
    'user-agent': USER_AGENT,
    'accept-language': 'en-US,en;q=0.9'
};

export class HttpStatusError extends Error {
    constructor(status, statusText, url) {
        super(`${status} ${statusText || ''}`.trim());
        this.status = status;
        this.url = url;
    }
}

// A 4xx other than 429 is a refusal, not a hiccup: retrying cannot change the answer
// and only multiplies load on a host that already said no.
function isRetryable(error) {
    if (!(error instanceof HttpStatusError)) return true;
    return error.status === 429 || error.status >= 500;
}

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
                    ...REQUEST_HEADERS,
                    accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            if (!response.ok) throw new HttpStatusError(response.status, response.statusText, url);
            return {
                text: await response.text(),
                finalUrl: response.url,
                etag: response.headers.get('etag') || ''
            };
        } catch (error) {
            lastError = error;
            if (!isRetryable(error)) break;
            if (attempt < retries) await sleep(750 * (attempt + 1));
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Unable to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

export async function postForm(url, fields, { retries = 2, delayMs = 0, timeoutMs = 25_000 } = {}) {
    if (delayMs > 0) await sleep(delayMs);

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    ...REQUEST_HEADERS,
                    accept: 'application/json,text/plain,*/*',
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: new URLSearchParams(fields)
            });
            if (!response.ok) throw new HttpStatusError(response.status, response.statusText, url);
            return {
                text: await response.text(),
                finalUrl: response.url,
                etag: response.headers.get('etag') || ''
            };
        } catch (error) {
            lastError = error;
            if (!isRetryable(error)) break;
            if (attempt < retries) await sleep(750 * (attempt + 1));
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Unable to POST ${url}: ${lastError?.message || 'unknown error'}`);
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
