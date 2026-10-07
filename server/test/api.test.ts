import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { InMemoryUsageStore } from '../src/services/usage.js';
import { InMemoryEntitlementStore } from '../src/services/entitlements.js';
import type { ExtractFn } from '../src/services/gemini.js';
import { errors } from '../src/lib/errors.js';
import { testConfig } from './helpers.js';

const okExtract: ExtractFn = async () => [{ date: '2026-06-03', vendor: 'Uber', amount: 23.4, category: 'Travel' }];

/** Token verifier stub: "valid-<sub>[:email]" is accepted, everything else rejected. */
const stubVerifier = async (token: string) => {
  if (!token.startsWith('valid-')) throw new Error('bad token');
  const [sub, email] = token.slice('valid-'.length).split(':');
  return { sub: sub!, email: email || undefined };
};

function makeApp(overrides: Parameters<typeof createApp>[0] extends infer T ? Partial<T> : never = {}) {
  return createApp({
    config: testConfig({ FREE_DAILY_LIMIT: '2', RATE_LIMIT_PER_MINUTE: '100' }),
    verifier: stubVerifier,
    extract: okExtract,
    usage: new InMemoryUsageStore(),
    entitlements: new InMemoryEntitlementStore(),
    ...overrides,
  });
}

describe('API auth', () => {
  it('rejects requests without a token', async () => {
    const res = await request(makeApp()).post('/v1/extract').send({ text: 'Uber $5' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects requests with an invalid token', async () => {
    const res = await request(makeApp())
      .post('/v1/extract')
      .set('Authorization', 'Bearer forged')
      .send({ text: 'Uber $5' });
    expect(res.status).toBe(401);
  });

  it('healthz needs no auth and leaks nothing', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /v1/extract', () => {
  it('extracts rows for an authenticated user and reports usage', async () => {
    const res = await request(makeApp())
      .post('/v1/extract')
      .set('Authorization', 'Bearer valid-alice')
      .send({ text: 'Uber ride $23.40 on June 3' });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].vendor).toBe('Uber');
    expect(res.body.usage).toEqual({ used: 1, limit: 2, plan: 'free' });
  });

  it('rejects invalid bodies', async () => {
    const app = makeApp();
    for (const body of [{}, { text: '' }, { text: 'x', admin: true }]) {
      const res = await request(app).post('/v1/extract').set('Authorization', 'Bearer valid-alice').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('enforces the daily quota server-side per user', async () => {
    const app = makeApp();
    const call = () =>
      request(app).post('/v1/extract').set('Authorization', 'Bearer valid-alice').send({ text: 'Uber $5' });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const blocked = await call();
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('quota_exceeded');

    // A different user is unaffected.
    const other = await request(app)
      .post('/v1/extract')
      .set('Authorization', 'Bearer valid-bob')
      .send({ text: 'Uber $5' });
    expect(other.status).toBe(200);
  });

  it('refunds quota when the upstream call fails', async () => {
    const usage = new InMemoryUsageStore();
    const failingExtract: ExtractFn = async () => {
      throw errors.upstreamUnavailable();
    };
    const app = makeApp({ usage, extract: failingExtract });
    const res = await request(app)
      .post('/v1/extract')
      .set('Authorization', 'Bearer valid-alice')
      .send({ text: 'Uber $5' });
    expect(res.status).toBe(503);

    const usageRes = await request(app).get('/v1/usage').set('Authorization', 'Bearer valid-alice');
    expect(usageRes.body.used).toBe(0);
  });

  it('gives pro users the pro limit', async () => {
    const entitlements = new InMemoryEntitlementStore();
    await entitlements.setPlan('alice@example.com', 'pro');
    const app = makeApp({ entitlements });
    const res = await request(app)
      .post('/v1/extract')
      .set('Authorization', 'Bearer valid-alice:alice@example.com')
      .send({ text: 'Uber $5' });
    expect(res.status).toBe(200);
    expect(res.body.usage.plan).toBe('pro');
    expect(res.body.usage.limit).toBe(500);
  });
});

describe('hardening details', () => {
  it('does not advertise the framework', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets rate-limit headers and blocks past the per-minute limit', async () => {
    const app = createApp({
      config: testConfig({ RATE_LIMIT_PER_MINUTE: '1' }),
      verifier: stubVerifier,
      extract: okExtract,
    });
    const first = await request(app).get('/v1/usage').set('Authorization', 'Bearer valid-alice');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('1');
    const second = await request(app).get('/v1/usage').set('Authorization', 'Bearer valid-alice');
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('404s unknown paths with a generic body', async () => {
    const res = await request(makeApp()).get('/admin');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});
