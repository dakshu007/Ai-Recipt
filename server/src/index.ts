import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

const config = loadConfig(); // throws (and refuses to start) on unsafe/missing configuration

const app = createApp({ config });

const server = app.listen(config.PORT, () => {
  logger.info('sheetscan server listening', {
    port: config.PORT,
    env: config.NODE_ENV,
    billing: Boolean(config.STRIPE_SECRET_KEY),
  });
});

// Drain connections on platform shutdown signals (Cloud Run et al.).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
