import { z } from 'zod';

/**
 * All configuration comes from the environment and is validated at boot.
 * The process refuses to start with an invalid or unsafe configuration,
 * and secret values are never logged.
 */

const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),

    // Upstream model access — the only place this key exists is this process's env.
    GEMINI_API_KEY: z.string().min(10),
    GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

    // OAuth client IDs allowed as `aud` in incoming Google ID tokens.
    // For an Apps Script add-on this is the script's GCP project OAuth client.
    ALLOWED_OAUTH_AUDIENCES: z.string().transform(csv).pipe(z.array(z.string().min(1)).min(1)),

    // Plan quotas. Pro is capped too — "unlimited" invites abuse of the upstream key.
    FREE_DAILY_LIMIT: z.coerce.number().int().min(0).default(5),
    PRO_DAILY_LIMIT: z.coerce.number().int().min(0).default(500),

    // Request shape limits.
    MAX_TEXT_CHARS: z.coerce.number().int().min(1).default(20000),
    MAX_IMAGE_BYTES: z.coerce.number().int().min(1).default(4 * 1024 * 1024),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),

    // Billing (optional — billing routes are not mounted unless both are set).
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Local development only: skip Google token verification and act as this
    // user (format: "sub:email"). Refused outright in production.
    DEV_FAKE_USER: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_FAKE_USER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DEV_FAKE_USER must not be set in production',
      });
    }
    if ((env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) || (!env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together',
      });
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Print field names and messages only — never echo the values back.
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(config)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration — ${problems}`);
  }
  return parsed.data;
}
