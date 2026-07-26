/**
 * Stripe webhook verification and the small slice of the Stripe REST API this
 * service calls.
 *
 * The official Stripe SDK is not used: it pulls in Node built-ins that a Worker
 * does not have, and this service touches three endpoints. Signature
 * verification is implemented against Stripe's documented scheme rather than
 * skipped — an unverified webhook endpoint is a public "provision me a free
 * account" button.
 */

/** Reject signatures older than this to blunt replay of a captured request. */
const TOLERANCE_SECONDS = 300;

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** Parse a `Stripe-Signature` header into its timestamp and v1 signatures. */
function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (!key || !value) continue;
    if (key.trim() === 't') timestamp = Number.parseInt(value, 10);
    // Stripe sends several v1 entries while a secret is being rotated.
    if (key.trim() === 'v1') signatures.push(value.trim());
  }

  if (timestamp === undefined || Number.isNaN(timestamp) || signatures.length === 0) return undefined;
  return { timestamp, signatures };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare two hex strings without leaking their divergence point through
 * timing. Length is compared first, which is not secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify a webhook request and return the parsed event.
 *
 * Takes the raw body text — re-serialising a parsed body would change the bytes
 * and invalidate the signature.
 */
export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ ok: true; event: StripeEvent } | { ok: false; reason: string }> {
  if (!signatureHeader) return { ok: false, reason: 'missing signature header' };
  if (!secret) return { ok: false, reason: 'webhook secret not configured' };

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed signature header' };

  if (Math.abs(nowSeconds - parsed.timestamp) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'signature timestamp outside tolerance' };
  }

  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${rawBody}`);
  if (!parsed.signatures.some((candidate) => timingSafeEqual(candidate, expected))) {
    return { ok: false, reason: 'signature mismatch' };
  }

  try {
    return { ok: true, event: JSON.parse(rawBody) as StripeEvent };
  } catch {
    return { ok: false, reason: 'body is not valid JSON' };
  }
}

/* -------------------------------------------------------------------------- */
/* Outbound Stripe calls                                                      */
/* -------------------------------------------------------------------------- */

async function stripeRequest(
  secretKey: string,
  path: string,
  init: { method: string; body?: URLSearchParams },
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: init.body,
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(`Stripe ${path} failed: ${error?.message ?? response.status}`);
  }
  return payload;
}

/** Fetch a subscription, used to read the price a checkout resolved to. */
export async function getSubscription(
  secretKey: string,
  subscriptionId: string,
): Promise<Record<string, unknown>> {
  return stripeRequest(secretKey, `subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
  });
}

/**
 * Create a Billing Portal session.
 *
 * This is what makes the service self-operating: upgrades, downgrades, card
 * updates, invoices and cancellation all happen in Stripe's hosted UI, so none
 * of them arrive as a support request.
 */
export async function createPortalSession(
  secretKey: string,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const body = new URLSearchParams({ customer: customerId, return_url: returnUrl });
  const session = await stripeRequest(secretKey, 'billing_portal/sessions', { method: 'POST', body });
  return session.url as string;
}

/** Pull the first price id out of a subscription object. */
export function priceIdFromSubscription(subscription: Record<string, unknown>): string | undefined {
  const items = subscription.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
  return items?.data?.[0]?.price?.id;
}
