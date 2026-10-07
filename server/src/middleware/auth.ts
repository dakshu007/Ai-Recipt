import type { RequestHandler } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Authentication: every API call must carry a Google ID token
 * (`Authorization: Bearer <token>`). The Apps Script add-on obtains one with
 * ScriptApp.getIdentityToken() — no passwords, no API keys handed to users.
 *
 * Verification checks Google's signature, expiry, issuer, and that `aud`
 * matches one of our configured OAuth client IDs, so tokens minted for other
 * apps are rejected even though they're also "valid Google tokens".
 */

export interface AuthedUser {
  /** Stable Google account id — quota key. */
  sub: string;
  /** Verified email, if the token carries one — entitlement key. */
  email?: string | undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export type TokenVerifier = (token: string) => Promise<AuthedUser>;

export function createGoogleTokenVerifier(config: Config): TokenVerifier {
  const client = new OAuth2Client();
  return async (token: string): Promise<AuthedUser> => {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: config.ALLOWED_OAUTH_AUDIENCES,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('token payload missing sub');
    return {
      sub: payload.sub,
      // Only trust the email for entitlements if Google marked it verified.
      email: payload.email && payload.email_verified ? payload.email : undefined,
    };
  };
}

export function createAuthMiddleware(config: Config, verify: TokenVerifier): RequestHandler {
  // Explicitly guarded dev-only bypass; loadConfig() rejects this in production.
  if (config.DEV_FAKE_USER && config.NODE_ENV !== 'production') {
    const [sub, email] = config.DEV_FAKE_USER.split(':');
    const fakeUser: AuthedUser = { sub: sub || 'dev-user', email: email || undefined };
    logger.warn('auth running in DEV_FAKE_USER mode — all requests act as this user');
    return (req, _res, next) => {
      req.user = fakeUser;
      next();
    };
  }

  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      next(errors.unauthorized());
      return;
    }
    try {
      req.user = await verify(token);
      next();
    } catch {
      // Deliberately generic: don't tell callers *why* the token failed.
      next(errors.unauthorized());
    }
  };
}
