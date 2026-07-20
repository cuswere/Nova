import { auth, sheets as sheetsClient } from '@googleapis/sheets';
import { SHEET_HEADERS, SHEET_NAME, SPREADSHEET_ID } from './config.js';
import { areSameOpportunity, preferCandidate } from './dedupe.js';
import { canonicalizeUrl, isExpired, normalizeDeadline } from './normalize.js';

export function columnLetter(columnNumber) {
    let value = columnNumber;
    let result = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        value = Math.floor((value - 1) / 26);
    }
    return result;
}

const LAST_COLUMN = columnLetter(SHEET_HEADERS.length);
const STATUS_COLUMN = columnLetter(SHEET_HEADERS.indexOf('status') + 1);
const FORMULA_PREFIX = /^[=+\-@]/;

export function escapeSheetValue(value) {
    const text = String(value ?? '');
    return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function getCredentials() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is required');
    try {
        const decoded = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (error) {
        throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON: ${error.message}`);
    }
}

export function createSheetsClient(credentials = getCredentials()) {
    const googleAuth = new auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return sheetsClient({ version: 'v4', auth: googleAuth });
}

export async function readRows({ sheets = createSheetsClient(), spreadsheetId = SPREADSHEET_ID, sheetName = SHEET_NAME } = {}) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName.replaceAll("'", "''")}'!A:${LAST_COLUMN}`,
        valueRenderOption: 'FORMATTED_VALUE'
    });
    const values = response.data.values || [];
    if (!values.length) return [];
    const headers = values[0].map((value) => String(value).trim().toLowerCase());
    return values.slice(1).filter((row) => row.some(Boolean)).map((row, index) => ({
        _rowNumber: index + 2,
        ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']))
    }));
}

export async function assertSchema({ sheets = createSheetsClient(), spreadsheetId = SPREADSHEET_ID, sheetName = SHEET_NAME } = {}) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName.replaceAll("'", "''")}'!1:1`
    });
    const headers = (response.data.values?.[0] || []).map((value) => String(value).trim().toLowerCase());
    const matches = headers.length === SHEET_HEADERS.length && SHEET_HEADERS.every((header, index) => headers[index] === header);
    if (!matches) throw new Error(`Sheet ${sheetName} header sequence mismatch. Expected: ${SHEET_HEADERS.join(', ')}; found: ${headers.join(', ') || '(empty)'}`);
}

export async function upsertCandidates(candidates, options = {}) {
    const sheets = options.sheets || createSheetsClient();
    const spreadsheetId = options.spreadsheetId || SPREADSHEET_ID;
    const sheetName = options.sheetName || SHEET_NAME;
    await assertSchema({ sheets, spreadsheetId, sheetName });
    const existing = await readRows({ sheets, spreadsheetId, sheetName });
    const byId = new Map(existing.filter((row) => row.id).map((row) => [row.id, row]));
    const byFingerprint = new Map(existing.map((row) => [fingerprint(row), row]));
    const updates = existing
        .filter((row) => ['review', 'publish'].includes(row.status) && isExpired(normalizeDeadline(row.deadline)))
        .map((row) => ({
            range: `'${sheetName.replaceAll("'", "''")}'!${STATUS_COLUMN}${row._rowNumber}`,
            values: [['expired']]
        }));
    const appends = [];
    let updated = 0;
    let skippedExpired = 0;

    for (const candidate of candidates) {
        const current = byId.get(candidate.id) ||
            byFingerprint.get(fingerprint(candidate)) ||
            existing.find((row) => areSameOpportunity(row, candidate));
        if (!current) {
            // A candidate discovered for the first time already past its deadline was
            // never live for anyone to review; adding it as a new row has no editorial
            // value and only clutters the sheet. Only rows an editor already saw
            // (existing rows transitioning to expired, below) are worth flagging.
            if (candidate.status === 'expired') {
                skippedExpired += 1;
                continue;
            }
            appends.push(rowValues(candidate));
            continue;
        }
        const merged = mergeCandidate(current, candidate);
        updates.push({
            range: `'${sheetName.replaceAll("'", "''")}'!A${current._rowNumber}:${LAST_COLUMN}${current._rowNumber}`,
            values: [rowValues(merged)]
        });
        updated += 1;
    }

    if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            // Rows are already normalized. RAW prevents ISO dates such as
            // 2026-08-02 from becoming an unformatted Sheets serial (46236).
            requestBody: { valueInputOption: 'RAW', data: updates }
        });
    }
    if (appends.length) {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${sheetName.replaceAll("'", "''")}'!A:${LAST_COLUMN}`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: appends }
        });
        // Google Sheets may copy the header row's formatting when rows are
        // inserted immediately below it. Keep imported opportunities in the
        // normal data style instead of inheriting the gray/bold header style.
        await resetAppendedRowFormatting({
            sheets,
            spreadsheetId,
            sheetName,
            startRowIndex: existing.length + 1,
            rowCount: appends.length
        });
    }
    await sortByDeadline({ sheets, spreadsheetId, sheetName, rowCount: existing.length + appends.length + 1 });
    return {
        discovered: candidates.length,
        added: appends.length,
        updated,
        expired: updates.length - updated,
        skippedExpired
    };
}

async function resetAppendedRowFormatting({ sheets, spreadsheetId, sheetName, startRowIndex, rowCount }) {
    const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties'
    });
    const sheet = (metadata.data.sheets || []).find(({ properties }) => properties.title === sheetName);
    if (!sheet) throw new Error(`Sheet ${sheetName} was not found`);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                repeatCell: {
                    range: {
                        sheetId: sheet.properties.sheetId,
                        startRowIndex,
                        endRowIndex: startRowIndex + rowCount,
                        startColumnIndex: 0,
                        endColumnIndex: SHEET_HEADERS.length
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 },
                            textFormat: { bold: false }
                        }
                    },
                    fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold'
                }
            }]
        }
    });
}

async function sortByDeadline({ sheets, spreadsheetId, sheetName, rowCount }) {
    const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties'
    });
    const sheet = (metadata.data.sheets || []).find(({ properties }) => properties.title === sheetName);
    if (!sheet) throw new Error(`Sheet ${sheetName} was not found`);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                sortRange: {
                    range: {
                        sheetId: sheet.properties.sheetId,
                        startRowIndex: 1,
                        endRowIndex: Math.max(rowCount, 2),
                        startColumnIndex: 0,
                        endColumnIndex: SHEET_HEADERS.length
                    },
                    sortSpecs: [{ dimensionIndex: 1, sortOrder: 'DESCENDING' }]
                }
            }]
        }
    });
}

export function mergeCandidate(current, candidate) {
    const manualStatus = current.status || 'review';
    // publish/reject are editorial decisions on the whole row, not just the
    // public fields. A re-fetch matching one of these rows must not clobber
    // manual corrections to description, source metadata, etc. — only
    // bookkeeping timestamps advance so the row still shows as recently seen.
    if (['publish', 'reject'].includes(manualStatus)) {
        return {
            ...current,
            last_seen: candidate.last_seen || current.last_seen,
            checked_at: candidate.checked_at || current.checked_at
        };
    }
    const preferred = preferCandidate(current, candidate);
    const merged = {
        ...current,
        ...candidate,
        ...preferred,
        last_seen: candidate.last_seen || current.last_seen,
        checked_at: candidate.checked_at || current.checked_at,
        status: manualStatus
    };
    if (candidate.status === 'expired') merged.status = 'expired';
    return merged;
}

function fingerprint(row) {
    return `${canonicalizeUrl(row.link)}|${String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${row.deadline || ''}`;
}

export function rowValues(row) {
    return SHEET_HEADERS.map((header) => escapeSheetValue(row[header]));
}
