/**
 * Praxis Nova — feedback endpoint.
 *
 * Backs the "Send Feedback" form on feedback.html. Lives in Apps Script, not in
 * this repo's runtime: paste it into the feedback spreadsheet (Extensions →
 * Apps Script), then Deploy → New deployment → Web app, with
 *   Execute as: Me
 *   Who has access: Anyone
 * and put the resulting /exec URL into FEEDBACK_FORM_ACTION in app.js.
 *
 * The frontend posts url-encoded `name` / `message` fields with mode:'no-cors',
 * so nothing here needs CORS headers and the response body is never read.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1lDQtA_lTx7tHwkmpTP8Tj2xYiqY8Z72b8CpD0cPJVPs/edit
 */

var SHEET_NAME = 'Feedback';
var HEADERS = ['timestamp', 'name', 'message'];

function doPost(e) {
  var params = (e && e.parameter) || {};
  var message = String(params.message || '').trim();

  // A blank message is the only thing worth rejecting — name is optional.
  if (!message) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'empty message' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet().appendRow([
      new Date(),
      String(params.name || '').trim().slice(0, 200),
      message.slice(0, 5000)
    ]);
  } finally {
    lock.releaseLock();
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
