import express from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import { createAuthMiddleware, createGoogleTokenVerifier, type TokenVerifier } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createExtractRouter } from './routes/extract.js';
import { createBillingRouter } from './routes/billing.js';
import { createGeminiExtractor, type ExtractFn } from './services/gemini.js';
import { InMemoryUsageStore, type UsageStore } from './services/usage.js';
import { InMemoryEntitlementStore, type EntitlementStore } from './services/entitlements.js';

/**
 * App factory with injectable dependencies (used directly by tests; index.ts
 * calls it with real implementations).
 *
 * Security defaults baked in here:
 * - helmet security headers, x-powered-by disabled
 * - no CORS middleware at all: the add-on calls server-to-server via
 *   UrlFetchApp, so browsers get same-origin-only by default
 * - JSON body size capped just above the max allowed image payload
 * - Stripe webhook mounted BEFORE the JSON parser (it needs the raw body)
 */
export interface AppDeps {
  config: Config;
  verifier?: TokenVerifier;
  extract?: ExtractFn;
  usage?: UsageStore;
  entitlements?: EntitlementStore;
}

export function createApp(deps: AppDeps): express.Express {
  const { config } = deps;
  const verifier = deps.verifier ?? createGoogleTokenVerifier(config);
  const extract = deps.extract ?? createGeminiExtractor(config);
  const usage = deps.usage ?? new InMemoryUsageStore();
  const entitlements = deps.entitlements ?? new InMemoryEntitlementStore();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // one hop: the cloud load balancer / reverse proxy
  app.use(helmet());

  // Liveness probe — unauthenticated, reveals nothing.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Webhook first: raw body, authenticated by Stripe's signature instead of a user token.
  if (config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET) {
    app.use('/v1', createBillingRouter(config, entitlements));
  }

  // base64 inflates by ~4/3; add headroom for the JSON envelope around it.
  const bodyLimit = Math.ceil(config.MAX_IMAGE_BYTES * 1.4) + 64 * 1024;
  app.use(express.json({ limit: bodyLimit }));

  app.use('/v1', createAuthMiddleware(config, verifier));
  app.use('/v1', createRateLimiter(config.RATE_LIMIT_PER_MINUTE));
  app.use('/v1', createExtractRouter({ config, extract, usage, entitlements }));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
  });
  app.use(errorHandler);

  return app;
}
