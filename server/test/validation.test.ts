import { describe, expect, it } from 'vitest';
import { base64DecodedBytes, buildExtractRequestSchema } from '../src/lib/validation.js';

const schema = buildExtractRequestSchema({ MAX_TEXT_CHARS: 100, MAX_IMAGE_BYTES: 30 });

const b64 = (bytes: number) => Buffer.alloc(bytes, 65).toString('base64');

describe('extract request schema', () => {
  it('accepts text-only input', () => {
    expect(schema.safeParse({ text: 'Uber $23.40' }).success).toBe(true);
  });

  it('accepts image-only input within limits', () => {
    expect(schema.safeParse({ image: { mimeType: 'image/png', dataBase64: b64(30) } }).success).toBe(true);
  });

  it('rejects empty requests and whitespace-only text', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ text: '   ' }).success).toBe(false);
  });

  it('rejects oversized text', () => {
    expect(schema.safeParse({ text: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects oversized images', () => {
    expect(schema.safeParse({ image: { mimeType: 'image/jpeg', dataBase64: b64(31) } }).success).toBe(false);
  });

  it('rejects disallowed mime types and invalid base64', () => {
    expect(schema.safeParse({ image: { mimeType: 'image/svg+xml', dataBase64: b64(10) } }).success).toBe(false);
    expect(schema.safeParse({ image: { mimeType: 'text/html', dataBase64: b64(10) } }).success).toBe(false);
    expect(schema.safeParse({ image: { mimeType: 'image/png', dataBase64: '!!not-base64!!' } }).success).toBe(false);
  });

  it('rejects unknown fields (strict schema)', () => {
    expect(schema.safeParse({ text: 'ok', admin: true }).success).toBe(false);
  });
});

describe('base64DecodedBytes', () => {
  it('computes decoded sizes without decoding', () => {
    for (const n of [1, 2, 3, 29, 30, 31]) {
      expect(base64DecodedBytes(b64(n))).toBe(n);
    }
  });
});
