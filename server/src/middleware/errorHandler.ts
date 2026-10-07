import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Single place where errors become responses. ApiErrors are intentional and
 * safe to show; anything else (bugs, upstream surprises, body-parser errors)
 * is logged with detail server-side and returned as an opaque message —
 * stack traces and internals never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // express.json() throws on oversized/malformed bodies.
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : 500;
  if (status === 413) {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large.' } });
    return;
  }
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: 'Malformed request.' } });
    return;
  }

  logger.error('unhandled error', {
    path: req.path,
    message: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side.' } });
};
