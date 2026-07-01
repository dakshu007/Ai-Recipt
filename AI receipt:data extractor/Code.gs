/**
 * SheetScan — AI data extractor for Google Sheets
 * Paste messy text or a receipt/invoice photo in, get clean rows out.
 *
 * Setup instructions: see README.md
 */

const MODEL = 'gemini-3.5-flash'; // if this model is retired later, check
                                   // ai.google.dev/gemini-api/docs/models
const FREE_DAILY_LIMIT = 5;

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

function processInput(rawText, imageBase64) {
  try {
    checkUsageLimit();
    const rows = extractDataWithGemini(rawText, imageBase64);
    writeRowsToSheet(rows);
    incrementUsage();
    return { success: true, count: rows.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------- Gemini API ----------

function extractDataWithGemini(rawText, imageBase64) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('No Gemini API key set yet. Run setApiKey from the editor first (see README step 4).');
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL +
    ':generateContent?key=' + apiKey;

  const parts = [{ text: buildPrompt() }];
  if (rawText) {
    parts.push({ text: 'Input text:\n' + rawText });
  }
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  }

  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const json = JSON.parse(response.getContentText());
  if (json.error) throw new Error(json.error.message);
  if (!json.candidates || !json.candidates.length) throw new Error('No response from Gemini — try again.');

  const resultText = json.candidates[0].content.parts[0].text;
  const parsed = JSON.parse(resultText);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function buildPrompt() {
  // Edit this to match whatever you're extracting — invoices, leads,
  // resumes, survey responses, anything "messy text/image -> spreadsheet row".
  return 'You extract expense data for a spreadsheet. Return ONLY a JSON array ' +
    'of objects, each with keys: date (YYYY-MM-DD or null), vendor (string), ' +
    'amount (number, no currency symbol), category (one of: Meals, Travel, ' +
    'Software, Office Supplies, Other). No extra text, no markdown — just the JSON array.';
}

// ---------- Writing to the sheet ----------

function writeRowsToSheet(rows) {
  const sheet = SpreadsheetApp.getActiveSheet();
  ensureHeaderRow(sheet);
  const startRow = sheet.getLastRow() + 1;
  const values = rows.map(function (r) {
    return [r.date || '', r.vendor || '', r.amount || '', r.category || ''];
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

// ---------- Free-tier usage gate ----------
// Simple per-user daily cap. `isPro` is a stub for now — flip it manually
// to test the paid path, then wire it to real payments later (see README).

function checkUsageLimit() {
  const props = PropertiesService.getUserProperties();
  if (props.getProperty('isPro') === 'true') return;

  const key = 'usage_' + new Date().toDateString();
  const count = parseInt(props.getProperty(key) || '0', 10);
  if (count >= FREE_DAILY_LIMIT) {
    throw new Error('Free plan: ' + FREE_DAILY_LIMIT + ' extractions/day used up. Upgrade for unlimited.');
  }
}

function incrementUsage() {
  const props = PropertiesService.getUserProperties();
  const key = 'usage_' + new Date().toDateString();
  const count = parseInt(props.getProperty(key) || '0', 10);
  props.setProperty(key, String(count + 1));
}

// ---------- One-time setup helper ----------
// Select this function in the editor's function dropdown and click Run once.
// Never hardcode your API key directly in the file above.

function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt('Paste your Gemini API key:');
  if (result.getSelectedButton() == ui.Button.OK) {
    const key = result.getResponseText().trim();
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
    ui.alert('Saved. Reopen the SheetScan sidebar to start using it.');
  }
}
