import { describe, expect, it } from 'vitest';
import { sanitizeCell, sanitizeRow } from '../src/lib/sanitize.js';

describe('sanitizeCell', () => {
  it('passes plain text through', () => {
    expect(sanitizeCell('Uber')).toBe('Uber');
  });

  it('neutralizes formula injection triggers', () => {
    expect(sanitizeCell('=IMPORTXML("http://evil","//x")')).toBe("'=IMPORTXML(\"http://evil\",\"//x\")");
    expect(sanitizeCell('+cmd|/C calc')).toBe("'+cmd|/C calc");
    expect(sanitizeCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('neutralizes tab/CR prefixes after control-char replacement leaves leading content', () => {
    // Control chars become spaces and are trimmed; a surviving trigger still gets escaped.
    expect(sanitizeCell('\t=1+1')).toBe("'=1+1");
  });

  it('strips control characters', () => {
    expect(sanitizeCell('a\u0007b\u0000c')).toBe('a b c');
  });

  it('handles null/undefined and truncates oversized cells', () => {
    expect(sanitizeCell(null)).toBe('');
    expect(sanitizeCell(undefined)).toBe('');
    expect(sanitizeCell('x'.repeat(2000)).length).toBe(500);
  });
});

describe('sanitizeRow', () => {
  it('normalizes a well-formed row', () => {
    expect(sanitizeRow({ date: '2026-06-03', vendor: 'Uber', amount: 23.4, category: 'Travel' })).toEqual({
      date: '2026-06-03',
      vendor: 'Uber',
      amount: 23.4,
      category: 'Travel',
    });
  });

  it('rejects malformed dates and unknown categories', () => {
    const row = sanitizeRow({ date: 'junk', vendor: 'X', amount: 1, category: 'Weapons' });
    expect(row.date).toBe('');
    expect(row.category).toBe('Other');
  });

  it('clamps and rounds amounts, drops non-numeric ones', () => {
    expect(sanitizeRow({ vendor: 'X', amount: 99999999999, category: 'Other' }).amount).toBe(10_000_000);
    expect(sanitizeRow({ vendor: 'X', amount: 23.456, category: 'Other' }).amount).toBeCloseTo(23.46);
    expect(sanitizeRow({ vendor: 'X', amount: '12; DROP TABLE', category: 'Other' }).amount).toBe('');
    expect(sanitizeRow({ vendor: 'X', amount: Infinity, category: 'Other' }).amount).toBe('');
  });

  it('escapes formula injection coming from model output', () => {
    const row = sanitizeRow({ vendor: '=HYPERLINK("http://evil")', amount: 1, category: 'Other' });
    expect(row.vendor.startsWith("'=")).toBe(true);
  });
});
