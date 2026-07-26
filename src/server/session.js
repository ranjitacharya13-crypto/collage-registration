// Stateless admin sessions.
//
// The first version kept sessions in an in-memory Map, which works for a single
// long-running process but breaks on serverless hosts (Vercel, Netlify, Lambda)
// where each request can land on a different instance: logging in on one and
// loading the dashboard on another would look like a random logout.
//
// Instead the cookie carries its own expiry and an HMAC signature. Any instance
// can verify it with the shared secret, and nothing needs to be remembered
// server-side. Logging out is handled by clearing the cookie.

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);

/**
 * Signing secret. In production this must be set explicitly: a random secret
 * per instance would mean cookies issued by one instance are rejected by
 * another. Falling back to the admin password keeps single-host setups working
 * without extra configuration.
 */
function resolveSecret() {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return explicit;

  const derived = `${process.env.ADMIN_USER || ''}:${process.env.ADMIN_PASSWORD || ''}:${process.env.ADMIN_PIN || ''}`;
  if (derived !== '::') return `derived:${derived}`;

  // Nothing configured at all: random, so sessions simply do not survive a
  // restart. Acceptable for local development only.
  return randomBytes(32).toString('hex');
}

const SECRET = resolveSecret();

const sign = payload => createHmac('sha256', SECRET).update(payload).digest('base64url');

/** Returns the cookie value for a freshly authenticated administrator. */
export function createSession() {
  const expires = Date.now() + TTL_MS;
  const payload = `${expires}.${randomBytes(9).toString('base64url')}`;
  return { value: `${payload}.${sign(payload)}`, maxAgeSeconds: Math.floor(TTL_MS / 1000) };
}

/** True when the cookie is well formed, correctly signed and not expired. */
export function verifySession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const index = cookieValue.lastIndexOf('.');
  if (index < 1) return false;

  const payload = cookieValue.slice(0, index);
  const provided = cookieValue.slice(index + 1);
  const expected = sign(payload);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const expires = Number(payload.split('.')[0]);
  return Number.isFinite(expires) && Date.now() < expires;
}

/** Warns when the configuration would cause sessions to break across instances. */
export function sessionSecretWarning() {
  if (process.env.SESSION_SECRET?.trim()) return null;
  if (!process.env.ADMIN_PASSWORD) {
    return 'SESSION_SECRET is not set and no ADMIN_PASSWORD to derive one from: '
      + 'administrators will be logged out whenever the server restarts.';
  }
  return null;
}
