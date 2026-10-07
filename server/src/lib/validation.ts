import { z } from 'zod';
import type { Config } from '../config.js';

/** Mime types we will forward to Gemini. Anything else is rejected. */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded size of a base64 string without decoding it. */
export function base64DecodedBytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function buildExtractRequestSchema(config: Pick<Config, 'MAX_TEXT_CHARS' | 'MAX_IMAGE_BYTES'>) {
  return z
    .object({
      text: z.string().max(config.MAX_TEXT_CHARS, 'text too long').optional(),
      image: z
        .object({
          mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
          dataBase64: z
            .string()
            .min(1)
            .regex(BASE64_RE, 'invalid base64')
            .refine((b64) => base64DecodedBytes(b64) <= config.MAX_IMAGE_BYTES, 'image too large'),
        })
        .optional(),
    })
    .strict()
    .refine((body) => (body.text ?? '').trim().length > 0 || body.image !== undefined, {
      message: 'provide text or an image',
    });
}

export type ExtractRequest = z.infer<ReturnType<typeof buildExtractRequestSchema>>;

/** Shape we demand from the model before any row reaches a sheet. */
export const modelRowsSchema = z.array(z.record(z.string(), z.unknown())).max(100);
