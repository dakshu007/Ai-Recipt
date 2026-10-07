import type { RequestHandler } from 'express';
import { errors } from '../lib/errors.js';

/**
 * Fixed-window per-user rate limit, applied after auth so the key is the
 * verified account (falling back to IP for unauthenticated paths). This is a
 * burst brake in front of the daily quota — it protects the upstream key and
 * keeps one client from starving others.
 *
 * In-memory on purpose: correct for a single instance. Behind a load balancer
 * with several instances, replace with a shared store (e.g. Redis).
 */

interface Window {
  windowStart: number;
  count: number;
}

export function createRateLimiter(limitPerMinute: number, now: () => number = Date.now): RequestHandler {
  const WINDOW_MS = 60_000;
  const windows = new Map<string, Window>();
  let lastSweep = 0;

  return (req, res, next) => {
    const ts = now();

    // Periodically drop expired windows so the map doesn't grow forever.
    if (ts - lastSweep > WINDOW_MS) {
      lastSweep = ts;
      for (const [key, w] of windows) {
        if (ts - w.windowStart >= WINDOW_MS) windows.delete(key);
      }
    }

    const key = req.user?.sub ?? `ip:${req.ip ?? 'unknown'}`;
    let w = windows.get(key);
    if (!w || ts - w.windowStart >= WINDOW_MS) {
      w = { windowStart: ts, count: 0 };
      windows.set(key, w);
    }
    w.count += 1;

    const remaining = Math.max(0, limitPerMinute - w.count);
    res.setHeader('RateLimit-Limit', String(limitPerMinute));
    res.setHeader('RateLimit-Remaining', String(remaining));

    if (w.count > limitPerMinute) {
      const retryAfterSec = Math.ceil((w.windowStart + WINDOW_MS - ts) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      next(errors.rateLimited());
      return;
    }
    next();
  };
}
