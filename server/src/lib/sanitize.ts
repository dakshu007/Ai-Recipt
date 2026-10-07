/**
 * Output sanitization for values that will land in a spreadsheet.
 *
 * Model output is untrusted: a crafted receipt photo or pasted text can make
 * the model emit cells like `=IMPORTXML(...)` or `+cmd|...` that Sheets/Excel
 * would execute (formula injection). Every string cell is neutralized here
 * before it leaves the API, and the add-on applies the same guard again.
 */

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];
const MAX_CELL_CHARS = 500;

/** Strip control characters (keeps plain printable text and newlines out — cells are single-line). */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    out += isControl ? ' ' : ch;
  }
  return out;
}

export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = stripControlChars(text).trim();
  if (text.length > MAX_CELL_CHARS) {
    text = text.slice(0, MAX_CELL_CHARS);
  }
  // A leading apostrophe forces Sheets/Excel to treat the cell as literal text.
  if (text.length > 0 && FORMULA_TRIGGERS.includes(text[0]!)) {
    text = `'${text}`;
  }
  return text;
}

export interface ExtractedRow {
  date: string;
  vendor: string;
  amount: number | '';
  category: string;
}

const CATEGORIES = new Set(['Meals', 'Travel', 'Software', 'Office Supplies', 'Other']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize one raw row object from the model into the exact shape the sheet
 * expects. Unknown keys are dropped, values are coerced and neutralized.
 */
export function sanitizeRow(raw: Record<string, unknown>): ExtractedRow {
  const dateStr = typeof raw.date === 'string' && ISO_DATE.test(raw.date) ? raw.date : '';

  let amount: number | '' = '';
  if (typeof raw.amount === 'number' && Number.isFinite(raw.amount)) {
    // Clamp to a sane money range and 2 decimal places.
    const clamped = Math.max(-10_000_000, Math.min(10_000_000, raw.amount));
    amount = Math.round(clamped * 100) / 100;
  }

  const categoryStr = typeof raw.category === 'string' && CATEGORIES.has(raw.category) ? raw.category : 'Other';

  return {
    date: sanitizeCell(dateStr),
    vendor: sanitizeCell(raw.vendor),
    amount,
    category: categoryStr,
  };
}
