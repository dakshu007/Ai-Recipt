import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  GEMINI_API_KEY: 'test-key-not-real',
  ALLOWED_OAUTH_AUDIENCES: 'aud-1.apps.googleusercontent.com, aud-2.apps.googleusercontent.com',
};

describe('loadConfig', () => {
  it('applies safe defaults and parses audience lists', () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    expect(config.NODE_ENV).toBe('production');
    expect(config.FREE_DAILY_LIMIT).toBe(5);
    expect(config.ALLOWED_OAUTH_AUDIENCES).toEqual([
      'aud-1.apps.googleusercontent.com',
      'aud-2.apps.googleusercontent.com',
    ]);
  });

  it('refuses to start without the Gemini key or audiences', () => {
    expect(() => loadConfig({ ALLOWED_OAUTH_AUDIENCES: 'a' } as NodeJS.ProcessEnv)).toThrow(/GEMINI_API_KEY/);
    expect(() => loadConfig({ GEMINI_API_KEY: 'test-key-not-real' } as NodeJS.ProcessEnv)).toThrow(
      /ALLOWED_OAUTH_AUDIENCES/,
    );
  });

  it('refuses DEV_FAKE_USER in production', () => {
    expect(() => loadConfig({ ...base, DEV_FAKE_USER: 'x:y@z.com' } as NodeJS.ProcessEnv)).toThrow(/DEV_FAKE_USER/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'development', DEV_FAKE_USER: 'x:y@z.com' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('requires Stripe key and webhook secret together', () => {
    expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_x' } as NodeJS.ProcessEnv)).toThrow(/together/);
    expect(() => loadConfig({ ...base, STRIPE_WEBHOOK_SECRET: 'whsec_x' } as NodeJS.ProcessEnv)).toThrow(/together/);
  });

  it('never echoes configuration values in error messages', () => {
    try {
      loadConfig({ ...base, GEMINI_API_KEY: 'short', PORT: 'not-a-port-value' } as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('short');
      expect((err as Error).message).not.toContain('not-a-port-value');
    }
  });
});
