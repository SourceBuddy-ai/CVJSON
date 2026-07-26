import type { Env } from './env.js';
import { customerForKeyHash, purgeExpiredRateLimits, readUsage } from './db.js';
import { looksLikeKey, readKeyFromRequest, sha256Hex } from './keys.js';
import { PLANS } from './plans.js';
import { createPortalSession } from './stripe.js';
import { handleDemoParse, handleParse } from './routes/parse.js';
import { handleStripeWebhook } from './routes/webhook.js';
import { error, json, preflight } from './http.js';

/**
 * CVJSON hosted API.
 *
 * Routing is a flat switch rather than a framework: there are six endpoints,
 * and every dependency skipped is one less thing to keep patched on a service
 * meant to run unattended.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight();

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      return await route(path, request, env, url);
    } catch (cause) {
      // Never leak an internal message or stack to the caller.
      console.error('unhandled error', { path, cause });
      return error('internal', 'Something went wrong on our side. Please try again.');
    }
  },

  /**
   * Scheduled cleanup. Rate-limit rows are write-heavy and short-lived; without
   * this the table would grow without bound.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const deleted = await purgeExpiredRateLimits(env.DB);
    console.log('purged expired rate limit rows', { deleted });
  },
};

async function route(path: string, request: Request, env: Env, url: URL): Promise<Response> {
  if (path === '/' || path === '/health') {
    return json({ status: 'ok', service: 'cvjson-api', plans: Object.keys(PLANS) });
  }

  if (path === '/v1/parse') {
    if (request.method !== 'POST') return error('invalid_request', 'Use POST to parse a document.');
    return handleParse(request, env);
  }

  if (path === '/v1/demo/parse') {
    if (request.method !== 'POST') return error('invalid_request', 'Use POST to parse a document.');
    return handleDemoParse(request, env);
  }

  if (path === '/v1/usage') {
    if (request.method !== 'GET') return error('invalid_request', 'Use GET to read usage.');
    return handleUsage(request, env);
  }

  if (path === '/v1/portal') {
    if (request.method !== 'POST') return error('invalid_request', 'Use POST to open the billing portal.');
    return handlePortal(request, env, url);
  }

  if (path === '/v1/stripe/webhook') {
    if (request.method !== 'POST') return error('invalid_request', 'Webhooks are delivered by POST.');
    return handleStripeWebhook(request, env);
  }

  return error('not_found', `No route for ${path}.`);
}

/** Current period usage for the presented key. Costs no quota. */
async function handleUsage(request: Request, env: Env): Promise<Response> {
  const presented = readKeyFromRequest(request);
  if (!presented || !looksLikeKey(presented)) {
    return error('unauthorized', 'Provide your API key as "Authorization: Bearer cvj_live_…".');
  }

  const customer = await customerForKeyHash(env.DB, await sha256Hex(presented));
  if (!customer) return error('unauthorized', 'This API key is not valid or has been revoked.');

  const usage = await readUsage(env.DB, customer.id, customer.plan.quota);
  return json({
    plan: { id: customer.plan.id, name: customer.plan.name, quota: customer.plan.quota },
    status: customer.status,
    period: usage.period,
    used: usage.used,
    remaining: Math.max(0, usage.quota - usage.used),
  });
}

/**
 * Hand the customer a Stripe Billing Portal link.
 *
 * Authenticated with the API key they already have, so there is no separate
 * account system, no password reset flow, and nothing to operate.
 */
async function handlePortal(request: Request, env: Env, url: URL): Promise<Response> {
  const presented = readKeyFromRequest(request);
  if (!presented || !looksLikeKey(presented)) {
    return error('unauthorized', 'Provide your API key as "Authorization: Bearer cvj_live_…".');
  }

  const customer = await customerForKeyHash(env.DB, await sha256Hex(presented));
  if (!customer) return error('unauthorized', 'This API key is not valid or has been revoked.');

  if (!env.STRIPE_SECRET_KEY) {
    return error('internal', 'Billing is not configured on this deployment.');
  }

  const returnUrl = env.SITE_URL ?? url.origin;
  const portalUrl = await createPortalSession(env.STRIPE_SECRET_KEY, customer.id, returnUrl);
  return json({ url: portalUrl });
}
