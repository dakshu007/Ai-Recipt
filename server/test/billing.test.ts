import { describe, expect, it } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { createApp } from '../src/app.js';
import { InMemoryEntitlementStore } from '../src/services/entitlements.js';
import { testConfig } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

function billingApp(entitlements: InMemoryEntitlementStore) {
  return createApp({
    config: testConfig({
      STRIPE_SECRET_KEY: 'sk_test_not_real',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    }),
    verifier: async () => ({ sub: 'unused' }),
    extract: async () => [],
    entitlements,
  });
}

function checkoutCompletedPayload(email: string): string {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    api_version: '2025-05-28.basil',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        payment_status: 'paid',
        customer_details: { email },
        customer_email: email,
      },
    },
  });
}

describe('POST /v1/billing/webhook', () => {
  it('upgrades the plan on a correctly signed checkout.session.completed', async () => {
    const entitlements = new InMemoryEntitlementStore();
    const payload = checkoutCompletedPayload('Alice@Example.com');
    const stripe = new Stripe('sk_test_not_real');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const res = await request(billingApp(entitlements))
      .post('/v1/billing/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(await entitlements.getPlan('alice@example.com')).toBe('pro');
  });

  it('rejects unsigned payloads without touching entitlements', async () => {
    const entitlements = new InMemoryEntitlementStore();
    const res = await request(billingApp(entitlements))
      .post('/v1/billing/webhook')
      .set('content-type', 'application/json')
      .send(checkoutCompletedPayload('alice@example.com'));
    expect(res.status).toBe(400);
    expect(await entitlements.getPlan('alice@example.com')).toBe('free');
  });

  it('rejects forged signatures', async () => {
    const entitlements = new InMemoryEntitlementStore();
    const payload = checkoutCompletedPayload('alice@example.com');
    const stripe = new Stripe('sk_test_not_real');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong_secret' });

    const res = await request(billingApp(entitlements))
      .post('/v1/billing/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(payload);
    expect(res.status).toBe(400);
    expect(await entitlements.getPlan('alice@example.com')).toBe('free');
  });

  it('does not upgrade unpaid sessions even when correctly signed', async () => {
    const entitlements = new InMemoryEntitlementStore();
    const payload = checkoutCompletedPayload('alice@example.com').replace('"paid"', '"unpaid"');
    const stripe = new Stripe('sk_test_not_real');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const res = await request(billingApp(entitlements))
      .post('/v1/billing/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(payload);
    expect(res.status).toBe(200);
    expect(await entitlements.getPlan('alice@example.com')).toBe('free');
  });

  it('is not mounted at all when billing is not configured', async () => {
    const app = createApp({
      config: testConfig(),
      verifier: async () => ({ sub: 'unused' }),
      extract: async () => [],
    });
    const res = await request(app)
      .post('/v1/billing/webhook')
      .set('content-type', 'application/json')
      .send('{}');
    // Falls through to authenticated routes → 401, no billing surface exposed.
    expect(res.status).toBe(401);
  });
});
