import type { Env } from '../env.js';
import { claimWebhookEvent, insertApiKey, revokeKeysForCustomer, setCustomerStatus, upsertCustomer } from '../db.js';
import { generateKey } from '../keys.js';
import { planForPrice, planById } from '../plans.js';
import { getSubscription, priceIdFromSubscription, verifyStripeWebhook, type StripeEvent } from '../stripe.js';
import { sendApiKeyEmail, sendRevocationEmail } from '../email.js';
import { json } from '../http.js';

/**
 * Stripe webhook handler — the whole provisioning pipeline.
 *
 * A subscription starting mints a key and emails it; a subscription changing
 * moves the customer onto the new plan's quota; a subscription ending revokes
 * the keys. No step needs a human, which is the point.
 *
 * Errors are answered with 500 so Stripe retries. Every handler is therefore
 * written to be safe to run twice, and `claimWebhookEvent` de-duplicates the
 * ones that are not naturally idempotent.
 */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const verification = await verifyStripeWebhook(
    rawBody,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET ?? '',
  );

  if (!verification.ok) {
    // 400 rather than 500: a bad signature is not something a retry can fix.
    return json({ error: { type: 'invalid_signature', message: verification.reason } }, 400);
  }

  const { event } = verification;

  const isNew = await claimWebhookEvent(env.DB, event.id);
  if (!isNew) return json({ received: true, deduplicated: true });

  try {
    await routeEvent(event, env);
  } catch (error) {
    console.error('webhook handler failed', { eventId: event.id, type: event.type, error });
    return json({ error: { type: 'handler_failed', message: 'Event will be retried.' } }, 500);
  }

  return json({ received: true });
}

async function routeEvent(event: StripeEvent, env: Env): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(event, env);
      return;
    case 'customer.subscription.updated':
      await onSubscriptionUpdated(event, env);
      return;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event, env);
      return;
    case 'invoice.payment_failed':
      await onPaymentFailed(event, env);
      return;
    case 'invoice.payment_succeeded':
      await onPaymentSucceeded(event, env);
      return;
    default:
      // Unsubscribed event types are acknowledged rather than treated as errors.
      return;
  }
}

async function onCheckoutCompleted(event: StripeEvent, env: Env): Promise<void> {
  const session = event.data.object;
  const customerId = asString(session.customer);
  const subscriptionId = asString(session.subscription);
  const email = customerEmailFrom(session);

  if (!customerId || !subscriptionId) {
    throw new Error('checkout session is missing customer or subscription');
  }
  if (!email) {
    throw new Error('checkout session is missing an email address');
  }

  const subscription = await getSubscription(env.STRIPE_SECRET_KEY ?? '', subscriptionId);
  const priceId = priceIdFromSubscription(subscription);
  const plan = priceId ? planForPrice(priceId, env) : undefined;

  if (!plan) {
    // Provisioning an unknown price would mean guessing a quota. Fail loudly so
    // the price gets mapped, rather than silently handing out an unmetered key.
    throw new Error(`no plan configured for Stripe price ${priceId ?? '(none)'}`);
  }

  await upsertCustomer(env.DB, {
    id: customerId,
    email,
    plan: plan.id,
    status: 'active',
    subscriptionId,
  });

  const key = await generateKey();
  await insertApiKey(env.DB, { id: key.id, customerId, hash: key.hash });

  const result = await sendApiKeyEmail(env, email, {
    secret: key.secret,
    planName: plan.name,
    quota: plan.quota,
  });

  if (!result.sent) {
    // The account is already usable; losing the email is bad but retrying the
    // webhook would mint a second key. Log loudly and leave the account intact.
    console.error('provisioned a key but could not email it', {
      customerId,
      keyId: key.id,
      reason: result.reason,
    });
  }
}

async function onSubscriptionUpdated(event: StripeEvent, env: Env): Promise<void> {
  const subscription = event.data.object;
  const customerId = asString(subscription.customer);
  if (!customerId) return;

  const priceId = priceIdFromSubscription(subscription);
  const plan = priceId ? planForPrice(priceId, env) : undefined;
  const status = asString(subscription.status) ?? 'active';

  // `active` and `trialing` both mean the key should work.
  const normalized = status === 'trialing' ? 'active' : status;

  if (plan) {
    const existing = await env.DB.prepare('SELECT email FROM customers WHERE id = ?1')
      .bind(customerId)
      .first<{ email: string }>();
    if (existing) {
      await upsertCustomer(env.DB, {
        id: customerId,
        email: existing.email,
        plan: plan.id,
        status: normalized,
        subscriptionId: asString(subscription.id),
      });
      return;
    }
  }

  await setCustomerStatus(env.DB, customerId, normalized);
}

async function onSubscriptionDeleted(event: StripeEvent, env: Env): Promise<void> {
  const customerId = asString(event.data.object.customer);
  if (!customerId) return;

  await setCustomerStatus(env.DB, customerId, 'canceled');
  await revokeKeysForCustomer(env.DB, customerId);

  const row = await env.DB.prepare('SELECT email FROM customers WHERE id = ?1')
    .bind(customerId)
    .first<{ email: string }>();
  if (row?.email) await sendRevocationEmail(env, row.email);
}

async function onPaymentFailed(event: StripeEvent, env: Env): Promise<void> {
  const customerId = asString(event.data.object.customer);
  if (!customerId) return;
  // Keys keep working while Stripe retries the card. Stripe cancels the
  // subscription when its dunning schedule is exhausted, and the resulting
  // `customer.subscription.deleted` is what actually revokes access.
  await setCustomerStatus(env.DB, customerId, 'past_due');
}

async function onPaymentSucceeded(event: StripeEvent, env: Env): Promise<void> {
  const customerId = asString(event.data.object.customer);
  if (!customerId) return;
  await setCustomerStatus(env.DB, customerId, 'active');
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  // Stripe returns either an id string or an expanded object.
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

function customerEmailFrom(session: Record<string, unknown>): string | undefined {
  const details = session.customer_details as { email?: string } | undefined;
  return details?.email ?? asString(session.customer_email);
}

/** Exposed for tests: the plan lookup used when provisioning. */
export { planById };
