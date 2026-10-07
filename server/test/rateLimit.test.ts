import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { createRateLimiter } from '../src/middleware/rateLimit.js';
import { ApiError } from '../src/lib/errors.js';

function fakeReqRes(sub: string) {
  const req = { user: { sub }, ip: '10.0.0.1', headers: {} } as unknown as Request;
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
  return { req, res, headers };
}

function run(limiter: ReturnType<typeof createRateLimiter>, sub: string) {
  const { req, res } = fakeReqRes(sub);
  let error: unknown;
  limiter(req, res, (err?: unknown) => (error = err));
  return error;
}

describe('rate limiter', () => {
  it('allows up to the limit, then returns 429', () => {
    let now = 0;
    const limiter = createRateLimiter(3, () => now);
    expect(run(limiter, 'alice')).toBeUndefined();
    expect(run(limiter, 'alice')).toBeUndefined();
    expect(run(limiter, 'alice')).toBeUndefined();
    const err = run(limiter, 'alice');
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
  });

  it('tracks users independently and resets after the window', () => {
    let now = 0;
    const limiter = createRateLimiter(1, () => now);
    expect(run(limiter, 'alice')).toBeUndefined();
    expect(run(limiter, 'bob')).toBeUndefined();
    expect(run(limiter, 'alice')).toBeInstanceOf(ApiError);
    now = 60_001;
    expect(run(limiter, 'alice')).toBeUndefined();
  });
});
