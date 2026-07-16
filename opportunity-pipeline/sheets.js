import { google } from 'googleapis';
import { SHEET_HEADERS, SHEET_NAME, SPREADSHEET_ID } from './config.js';
import { canonicalizeUrl, isExpired, normalizeDeadline } from './normalize.js';

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
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return google.sheets({ version: 'v4', auth });
}

export async function readRows({ sheets = createSheetsClient(), spreadsheetId = SPREADSHEET_ID, sheetName = SHEET_NAME } = {}) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName.replaceAll("'", "''")}'!A:Q`,
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
    const missing = SHEET_HEADERS.filter((header) => !headers.includes(header));
    if (missing.length) throw new Error(`Sheet ${sheetName} is missing headers: ${missing.join(', ')}`);
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
            range: `'${sheetName.replaceAll("'", "''")}'!H${row._rowNumber}`,
            values: [['expired']]
        }));
    const appends = [];
    let updated = 0;

    for (const candidate of candidates) {
        const current = byId.get(candidate.id) || byFingerprint.get(fingerprint(candidate));
        if (!current) {
            appends.push(rowValues(candidate));
            continue;
        }
        const merged = mergeCandidate(current, candidate);
        updates.push({
            range: `'${sheetName.replaceAll("'", "''")}'!A${current._rowNumber}:Q${current._rowNumber}`,
            values: [rowValues(merged)]
        });
        updated += 1;
    }

    if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
        });
    }
    if (appends.length) {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${sheetName.replaceAll("'", "''")}'!A:Q`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: appends }
        });
    }
    await sortByDeadline({ sheets, spreadsheetId, sheetName, rowCount: existing.length + appends.length + 1 });
    return {
        discovered: candidates.length,
        added: appends.length,
        updated,
        expired: updates.length - updated
    };
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
    const preservePublic = ['publish', 'reject'].includes(manualStatus);
    const merged = { ...current, ...candidate, status: manualStatus };
    if (preservePublic) {
        for (const field of ['name', 'deadline', 'link', 'type', 'fees', 'country']) merged[field] = current[field];
    }
    if (candidate.status === 'expired' && manualStatus !== 'reject') merged.status = 'expired';
    return merged;
}

function fingerprint(row) {
    return `${canonicalizeUrl(row.link)}|${String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${row.deadline || ''}`;
}

function rowValues(row) {
    return SHEET_HEADERS.map((header) => row[header] ?? '');
}
