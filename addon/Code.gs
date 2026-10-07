/**
 * SheetScan add-on — thin client for the SheetScan backend API.
 *
 * Security model:
 * - NO Gemini API key lives here (or anywhere users can reach). The backend
 *   owns it. Compromising a user's copy of this script yields nothing.
 * - Every request carries the user's Google identity token; the backend
 *   verifies it and meters usage per verified account, server-side.
 * - Rows coming back are sanitized again before touching the sheet
 *   (defense in depth against spreadsheet formula injection).
 *
 * Setup: see README.md — the only configuration is the backend URL.
 */

// ---------- Menu & sidebar ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SheetScan')
    .addItem('Open extractor', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('SheetScan');
  SpreadsheetApp.getUi().showSidebar(html);
}

// ---------- Called from Sidebar.html ----------

function processInput(rawText, imageBase64, imageMimeType) {
  try {
    const result = callBackend(rawText, imageBase64, imageMimeType);
    const rows = result.rows || [];
    if (rows.length > 0) writeRowsToSheet(rows);
    return { success: true, count: rows.length, usage: result.usage || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Backend API ----------

function callBackend(rawText, imageBase64, imageMimeType) {
  const baseUrl = getBackendUrl();
  const token = ScriptApp.getIdentityToken();
  if (!token) {
    throw new Error('Could not get your Google identity token. Re-authorize the add-on and try again.');
  }

  const payload = {};
  if (rawText) payload.text = rawText;
  if (imageBase64) {
    payload.image = {
      mimeType: imageMimeType || 'image/jpeg',
      dataBase64: imageBase64
    };
  }

  const response = UrlFetchApp.fetch(baseUrl + '/v1/extract', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    validateHttpsCertificates: true,
    followRedirects: false
  });

  const status = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    // fall through to the generic error below
  }

  if (status === 200) return body;

  const serverMessage = body && body.error && body.error.message;
  if (status === 401) throw new Error('Sign-in check failed. Reopen the sidebar and try again.');
  if (status === 402) throw new Error(serverMessage || 'Daily limit reached.');
  if (status === 429) throw new Error(serverMessage || 'Too many requests — wait a minute and retry.');
  throw new Error(serverMessage || 'The extraction service is unavailable right now. Try again shortly.');
}

function getBackendUrl() {
  const url = PropertiesService.getScriptProperties().getProperty('BACKEND_URL');
  if (!url) {
    throw new Error('No backend URL configured. Run setBackendUrl from the editor first (see README).');
  }
  if (url.indexOf('https://') !== 0) {
    throw new Error('BACKEND_URL must use https.');
  }
  return url.replace(/\/+$/, '');
}

// ---------- Writing to the sheet ----------

// Cells starting with these can execute as formulas in Sheets/Excel.
// The backend already escapes them; escape again here in case anything
// ever reaches this function from another path.
var FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  var text = String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim();
  if (text.length > 500) text = text.substring(0, 500);
  if (text.length > 0 && FORMULA_TRIGGERS.indexOf(text.charAt(0)) !== -1) {
    text = "'" + text;
  }
  return text;
}

function writeRowsToSheet(rows) {
  const sheet = SpreadsheetApp.getActiveSheet();
  ensureHeaderRow(sheet);
  const startRow = sheet.getLastRow() + 1;
  const values = rows.map(function (r) {
    const amount = typeof r.amount === 'number' && isFinite(r.amount) ? r.amount : '';
    return [sanitizeCell(r.date), sanitizeCell(r.vendor), amount, sanitizeCell(r.category)];
  });
  sheet.getRange(startRow, 1, values.length, 4).setValues(values);
}

function ensureHeaderRow(sheet) {
  if (sheet.getRange('A1').getValue() === '') {
    sheet.getRange(1, 1, 1, 4)
      .setValues([['Date', 'Vendor', 'Amount', 'Category']])
      .setFontWeight('bold');
  }
}

// ---------- One-time setup helper ----------
// Select this function in the editor's function dropdown and click Run once.

function setBackendUrl() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt('Paste the SheetScan backend URL (https://...):');
  if (result.getSelectedButton() == ui.Button.OK) {
    const url = result.getResponseText().trim();
    if (url.indexOf('https://') !== 0) {
      ui.alert('The URL must start with https:// — not saved.');
      return;
    }
    PropertiesService.getScriptProperties().setProperty('BACKEND_URL', url);
    ui.alert('Saved. Reopen the SheetScan sidebar to start using it.');
  }
}
