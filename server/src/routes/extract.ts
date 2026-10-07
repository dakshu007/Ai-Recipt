import { Router } from 'express';
import type { Config } from '../config.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { buildExtractRequestSchema } from '../lib/validation.js';
import type { ExtractFn } from '../services/gemini.js';
import type { EntitlementStore, Plan } from '../services/entitlements.js';
import { utcDateKey, type UsageStore } from '../services/usage.js';

export interface ExtractDeps {
  config: Config;
  extract: ExtractFn;
  usage: UsageStore;
  entitlements: EntitlementStore;
}

/**
 * POST /v1/extract — the one metered endpoint.
 * Order matters: validate the request shape, then reserve quota, then call
 * the model. Quota is consumed *before* the upstream call (and refunded on
 * failure) so parallel requests can't slip past the daily cap.
 */
export function createExtractRouter({ config, extract, usage, entitlements }: ExtractDeps): Router {
  const router = Router();
  const requestSchema = buildExtractRequestSchema(config);

  router.post('/extract', async (req, res, next) => {
    try {
      const user = req.user!; // auth middleware runs before this router
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request.');
      }

      const plan: Plan = user.email ? await entitlements.getPlan(user.email) : 'free';
      const limit = plan === 'pro' ? config.PRO_DAILY_LIMIT : config.FREE_DAILY_LIMIT;
      const dateKey = utcDateKey();

      const used = await usage.increment(user.sub, dateKey);
      if (used > limit) {
        await usage.increment(user.sub, dateKey, -1);
        throw errors.quotaExceeded(
          plan === 'pro'
            ? `Daily cap of ${limit} extractions reached — contact support if you need more.`
            : `Free plan: ${limit} extractions/day used up. Upgrade to Pro for more.`,
        );
      }

      let rows;
      try {
        rows = await extract({ text: parsed.data.text, image: parsed.data.image });
      } catch (err) {
        await usage.increment(user.sub, dateKey, -1); // don't charge quota for our/upstream failures
        throw err;
      }

      logger.info('extraction completed', { user: user.sub, rows: rows.length, plan });
      res.json({ rows, usage: { used, limit, plan } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/usage', async (req, res, next) => {
    try {
      const user = req.user!;
      const plan: Plan = user.email ? await entitlements.getPlan(user.email) : 'free';
      const limit = plan === 'pro' ? config.PRO_DAILY_LIMIT : config.FREE_DAILY_LIMIT;
      const used = await usage.get(user.sub, utcDateKey());
      res.json({ used, limit, plan });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
