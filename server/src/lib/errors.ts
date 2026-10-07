/**
 * Errors that are safe to show to the client. Anything not an ApiError is
 * logged server-side and returned as an opaque 500 — internals never leak.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  unauthorized: (msg = 'Missing or invalid credentials.') => new ApiError(401, 'unauthorized', msg),
  badRequest: (msg: string) => new ApiError(400, 'bad_request', msg),
  quotaExceeded: (msg: string) => new ApiError(402, 'quota_exceeded', msg),
  rateLimited: (msg = 'Too many requests — slow down.') => new ApiError(429, 'rate_limited', msg),
  upstreamUnavailable: (msg = 'The extraction service is temporarily unavailable. Try again shortly.') =>
    new ApiError(503, 'upstream_unavailable', msg),
};
