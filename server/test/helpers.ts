import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';

/** Minimal valid env for tests; override per-test as needed. */
export function testConfig(overrides: Partial<Record<string, string>> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    GEMINI_API_KEY: 'test-key-not-real',
    ALLOWED_OAUTH_AUDIENCES: 'test-audience.apps.googleusercontent.com',
    ...overrides,
  } as NodeJS.ProcessEnv);
}
