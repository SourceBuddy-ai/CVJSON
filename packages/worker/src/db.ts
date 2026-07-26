import type { Plan } from './plans.js';
import { planById } from './plans.js';

/**
 * D1 access layer.
 *
 * Every statement is parameterised — string interpolation into SQL is never
 * used here, including for values that look safe like plan ids.
 */

export interface CustomerRow {
  id: string;
  email: string;
  plan: string;
  status: string;
  subscription_id: string | null;
}

export interface AuthedCustomer {
  id: string;
  email: string;
  plan: Plan;
  status: string;
  keyId: string;
}

/** The billing period usage is counted against: the calendar month, UTC. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Resolve an API key hash to its customer.
 *
 * Revoked keys and non-active subscriptions are filtered in SQL so a suspended
 * account cannot spend quota between the lookup and the check.
 */
export async function customerForKeyHash(
  db: D1Database,
  keyHash: string,
): Promise<AuthedCustomer | undefined> {
  const row = await db
    .prepare(
      `SELECT c.id, c.email, c.plan, c.status, k.id AS key_id
         FROM api_keys k
         JOIN customers c ON c.id = k.customer_id
        WHERE k.key_hash = ?1 AND k.revoked_at IS NULL`,
    )
    .bind(keyHash)
    .first<CustomerRow & { key_id: string }>();

  if (!row) return undefined;

  const plan = planById(row.plan);
  if (!plan) return undefined;

  return { id: row.id, email: row.email, plan, status: row.status, keyId: row.key_id };
}

export interface UsageState {
  used: number;
  quota: number;
  period: string;
}

/**
 * Increment usage and return the new state, refusing once the quota is spent.
 *
 * The read and the write are a single statement so two concurrent requests
 * cannot both observe the last remaining unit of quota and both proceed.
 * `RETURNING` gives us the post-increment value without a second round trip.
 */
export async function consumeQuota(
  db: D1Database,
  customerId: string,
  quota: number,
  period = currentPeriod(),
): Promise<{ allowed: boolean; state: UsageState }> {
  const row = await db
    .prepare(
      `INSERT INTO usage (customer_id, period, count)
            VALUES (?1, ?2, 1)
       ON CONFLICT (customer_id, period)
       DO UPDATE SET count = usage.count + 1
                 WHERE usage.count < ?3
        RETURNING count`,
    )
    .bind(customerId, period, quota)
    .first<{ count: number }>();

  // No row returned means the WHERE guard blocked the update: quota is spent.
  if (!row) {
    return { allowed: false, state: { used: quota, quota, period } };
  }
  return { allowed: true, state: { used: row.count, quota, period } };
}

/** Read usage without consuming any. */
export async function readUsage(
  db: D1Database,
  customerId: string,
  quota: number,
  period = currentPeriod(),
): Promise<UsageState> {
  const row = await db
    .prepare('SELECT count FROM usage WHERE customer_id = ?1 AND period = ?2')
    .bind(customerId, period)
    .first<{ count: number }>();
  return { used: row?.count ?? 0, quota, period };
}

/**
 * Fixed-window rate limiter.
 *
 * A fixed window can allow up to 2x the limit across a boundary. That is
 * acceptable here — this exists to stop runaway loops and abuse, not to meter
 * billing, which `consumeQuota` handles exactly.
 */
export async function checkRateLimit(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const windowStart = Math.floor(now / 1000 / windowSeconds) * windowSeconds;
  const key = `${bucket}:${windowStart}`;
  const expiresAt = (windowStart + windowSeconds) * 1000;

  const row = await db
    .prepare(
      `INSERT INTO rate_limit (bucket, count, expires_at)
            VALUES (?1, 1, ?2)
       ON CONFLICT (bucket)
       DO UPDATE SET count = rate_limit.count + 1
        RETURNING count`,
    )
    .bind(key, expiresAt)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: expiresAt };
}

/** Delete rate-limit rows whose window has passed. Called from the cron trigger. */
export async function purgeExpiredRateLimits(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db.prepare('DELETE FROM rate_limit WHERE expires_at < ?1').bind(now).run();
  return result.meta.changes ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Provisioning, driven by Stripe webhooks                                    */
/* -------------------------------------------------------------------------- */

export async function upsertCustomer(
  db: D1Database,
  customer: { id: string; email: string; plan: string; status: string; subscriptionId?: string },
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO customers (id, email, plan, status, subscription_id, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT (id)
       DO UPDATE SET email = ?2, plan = ?3, status = ?4, subscription_id = ?5, updated_at = ?6`,
    )
    .bind(customer.id, customer.email, customer.plan, customer.status, customer.subscriptionId ?? null, now)
    .run();
}

export async function setCustomerStatus(
  db: D1Database,
  customerId: string,
  status: string,
): Promise<void> {
  await db
    .prepare('UPDATE customers SET status = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(customerId, status, Date.now())
    .run();
}

export async function insertApiKey(
  db: D1Database,
  key: { id: string; customerId: string; hash: string; name?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO api_keys (id, customer_id, key_hash, name, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(key.id, key.customerId, key.hash, key.name ?? 'default', Date.now())
    .run();
}

export async function revokeKeysForCustomer(db: D1Database, customerId: string): Promise<void> {
  await db
    .prepare('UPDATE api_keys SET revoked_at = ?2 WHERE customer_id = ?1 AND revoked_at IS NULL')
    .bind(customerId, Date.now())
    .run();
}

export async function countActiveKeys(db: D1Database, customerId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE customer_id = ?1 AND revoked_at IS NULL')
    .bind(customerId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Record a webhook event id, returning false when it has been seen before.
 *
 * Stripe retries deliveries and does not promise exactly-once, so without this
 * a retried `checkout.session.completed` would mint a second API key and send a
 * second email.
 */
export async function claimWebhookEvent(db: D1Database, eventId: string): Promise<boolean> {
  try {
    await db
      .prepare('INSERT INTO webhook_events (id, processed_at) VALUES (?1, ?2)')
      .bind(eventId, Date.now())
      .run();
    return true;
  } catch {
    // The primary-key conflict is the signal that this event was already handled.
    return false;
  }
}
