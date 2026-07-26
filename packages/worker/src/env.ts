import type { PriceEnv } from './plans.js';
import type { EmailEnv } from './email.js';

/**
 * Worker bindings and secrets.
 *
 * Everything optional is optional on purpose: the service must boot and serve
 * the health check and the demo endpoint before Stripe or Resend are wired up,
 * so a half-configured deploy fails at the specific route that needs the
 * missing secret rather than at startup.
 */
export interface Env extends PriceEnv, EmailEnv {
  DB: D1Database;

  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;

  /** Public site origin, used in emails and portal return URLs. */
  SITE_URL?: string;

  /** Maximum upload size in bytes. Defaults to 5 MB when unset. */
  MAX_UPLOAD_BYTES?: string;
}

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function maxUploadBytes(env: Env): number {
  const configured = env.MAX_UPLOAD_BYTES ? Number.parseInt(env.MAX_UPLOAD_BYTES, 10) : NaN;
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}
