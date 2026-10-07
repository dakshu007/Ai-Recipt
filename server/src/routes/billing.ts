import { Router, raw } from 'express';
import Stripe from 'stripe';
import type { Config } from '../config.js';
import { logger } from '../lib/logger.js';
import { normalizeEmail, type EntitlementStore } from '../services/entitlements.js';

/**
 * Stripe webhook — the ONLY code path that can change a user's plan.
 *
 * - The raw body (not parsed JSON) is fed to constructEvent, which verifies
 *   the `stripe-signature` HMAC; forged or replayed-and-tampered payloads are
 *   rejected before any state changes.
 * - Always answers 2xx for verified events we don't care about, so Stripe
 *   doesn't retry them forever.
 */
export function createBillingRouter(config: Config, entitlements: EntitlementStore): Router {
  const router = Router();
  const stripe = new Stripe(config.STRIPE_SECRET_KEY!);
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET!;

  router.post('/billing/webhook', raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      res.status(400).json({ error: { code: 'bad_request', message: 'Missing signature.' } });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
    } catch {
      logger.warn('stripe webhook signature verification failed');
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid signature.' } });
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const email = session.customer_details?.email ?? session.customer_email;
          if (email && session.payment_status === 'paid') {
            await entitlements.setPlan(email, 'pro');
            logger.info('plan upgraded via checkout', { email: normalizeEmail(email) });
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customer = await stripe.customers.retrieve(String(subscription.customer));
          if (!customer.deleted && customer.email) {
            await entitlements.setPlan(customer.email, 'free');
            logger.info('plan downgraded on subscription end', { email: normalizeEmail(customer.email) });
          }
          break;
        }
        default:
          break; // verified but irrelevant — acknowledge so Stripe stops retrying
      }
      res.json({ received: true });
    } catch (err) {
      logger.error('stripe webhook handling failed', {
        type: event.type,
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: { code: 'internal', message: 'Webhook handling failed.' } });
    }
  });

  return router;
}
