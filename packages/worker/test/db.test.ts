import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  claimWebhookEvent,
  consumeQuota,
  countActiveKeys,
  currentPeriod,
  customerForKeyHash,
  insertApiKey,
  purgeExpiredRateLimits,
  readUsage,
  revokeKeysForCustomer,
  setCustomerStatus,
  upsertCustomer,
} from '../src/db.js';
import { generateKey, looksLikeKey, readKeyFromRequest, sha256Hex } from '../src/keys.js';
import { createTestD1, SCHEMA_PATH } from './d1.js';

let db: D1Database;

async function seedCustomer(plan = 'starter'): Promise<{ customerId: string; secret: string }> {
  const customerId = 'cus_test123';
  await upsertCustomer(db, {
    id: customerId,
    email: 'buyer@example.com',
    plan,
    status: 'active',
    subscriptionId: 'sub_1',
  });
  const key = await generateKey();
  await insertApiKey(db, { id: key.id, customerId, hash: key.hash });
  return { customerId, secret: key.secret };
}

beforeEach(() => {
  db = createTestD1(SCHEMA_PATH);
});

describe('api keys', () => {
  it('generates a scannable, correctly shaped key', async () => {
    const key = await generateKey();
    expect(key.secret).toMatch(/^cvj_live_[0-9a-f]{48}$/);
    expect(looksLikeKey(key.secret)).toBe(true);
    expect(key.hash).toBe(await sha256Hex(key.secret));
  });

  it('never repeats a key', async () => {
    const keys = await Promise.all(Array.from({ length: 50 }, () => generateKey()));
    expect(new Set(keys.map((k) => k.secret)).size).toBe(50);
  });

  it('rejects malformed keys before any database work', () => {
    expect(looksLikeKey('cvj_live_short')).toBe(false);
    expect(looksLikeKey('sk_live_' + 'a'.repeat(48))).toBe(false);
    expect(looksLikeKey('')).toBe(false);
  });

  it('reads a key from either supported header', () => {
    const bearer = new Request('https://x', { headers: { authorization: 'Bearer cvj_live_abc' } });
    expect(readKeyFromRequest(bearer)).toBe('cvj_live_abc');

    const custom = new Request('https://x', { headers: { 'x-api-key': 'cvj_live_def' } });
    expect(readKeyFromRequest(custom)).toBe('cvj_live_def');

    expect(readKeyFromRequest(new Request('https://x'))).toBeUndefined();
  });

  it('resolves a key hash to its customer and plan', async () => {
    const { secret } = await seedCustomer('growth');
    const customer = await customerForKeyHash(db, await sha256Hex(secret));
    expect(customer).toMatchObject({ email: 'buyer@example.com', status: 'active' });
    expect(customer?.plan.quota).toBe(5_000);
  });

  it('does not resolve a revoked key', async () => {
    const { customerId, secret } = await seedCustomer();
    await revokeKeysForCustomer(db, customerId);
    expect(await customerForKeyHash(db, await sha256Hex(secret))).toBeUndefined();
    expect(await countActiveKeys(db, customerId)).toBe(0);
  });

  it('does not resolve an unknown key', async () => {
    await seedCustomer();
    expect(await customerForKeyHash(db, await sha256Hex('cvj_live_nope'))).toBeUndefined();
  });
});

describe('quota', () => {
  it('counts each parse against the current period', async () => {
    const { customerId } = await seedCustomer();
    const first = await consumeQuota(db, customerId, 3);
    const second = await consumeQuota(db, customerId, 3);
    expect(first.state.used).toBe(1);
    expect(second.state.used).toBe(2);
    expect(second.state.period).toBe(currentPeriod());
  });

  it('refuses once the quota is spent and does not keep counting', async () => {
    const { customerId } = await seedCustomer();
    for (let i = 0; i < 3; i += 1) {
      expect((await consumeQuota(db, customerId, 3)).allowed).toBe(true);
    }
    const blocked = await consumeQuota(db, customerId, 3);
    expect(blocked.allowed).toBe(false);

    // The refused call must not have incremented the counter past the cap.
    expect((await readUsage(db, customerId, 3)).used).toBe(3);
  });

  it('meters each period separately', async () => {
    const { customerId } = await seedCustomer();
    await consumeQuota(db, customerId, 10, '2026-01');
    await consumeQuota(db, customerId, 10, '2026-01');
    await consumeQuota(db, customerId, 10, '2026-02');

    expect((await readUsage(db, customerId, 10, '2026-01')).used).toBe(2);
    expect((await readUsage(db, customerId, 10, '2026-02')).used).toBe(1);
  });

  it('reports zero usage for a period with no activity', async () => {
    const { customerId } = await seedCustomer();
    expect((await readUsage(db, customerId, 1_000)).used).toBe(0);
  });
});

describe('rate limiting', () => {
  it('allows up to the limit and then refuses', async () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect((await checkRateLimit(db, 'key:abc', 3, 60, now)).allowed).toBe(true);
    }
    expect((await checkRateLimit(db, 'key:abc', 3, 60, now)).allowed).toBe(false);
  });

  it('keeps separate buckets independent', async () => {
    const now = 1_800_000_000_000;
    await checkRateLimit(db, 'key:a', 1, 60, now);
    expect((await checkRateLimit(db, 'key:b', 1, 60, now)).allowed).toBe(true);
  });

  it('resets in the next window', async () => {
    const now = 1_800_000_000_000;
    await checkRateLimit(db, 'key:abc', 1, 60, now);
    expect((await checkRateLimit(db, 'key:abc', 1, 60, now)).allowed).toBe(false);
    expect((await checkRateLimit(db, 'key:abc', 1, 60, now + 60_000)).allowed).toBe(true);
  });

  it('purges only windows that have expired', async () => {
    const now = 1_800_000_000_000;
    await checkRateLimit(db, 'old', 5, 60, now);
    await checkRateLimit(db, 'new', 5, 60, now + 600_000);

    const deleted = await purgeExpiredRateLimits(db, now + 300_000);
    expect(deleted).toBe(1);
    // The surviving window must still hold its count.
    expect((await checkRateLimit(db, 'new', 5, 60, now + 600_000)).remaining).toBe(3);
  });
});

describe('webhook idempotency', () => {
  it('claims an event once and refuses the retry', async () => {
    // Stripe retries deliveries; without this a retried checkout would mint a
    // second API key and send a second email.
    expect(await claimWebhookEvent(db, 'evt_1')).toBe(true);
    expect(await claimWebhookEvent(db, 'evt_1')).toBe(false);
    expect(await claimWebhookEvent(db, 'evt_2')).toBe(true);
  });
});

describe('customer lifecycle', () => {
  it('updates plan and status on re-upsert without duplicating the row', async () => {
    const { customerId, secret } = await seedCustomer('starter');
    await upsertCustomer(db, {
      id: customerId,
      email: 'buyer@example.com',
      plan: 'scale',
      status: 'active',
      subscriptionId: 'sub_1',
    });

    const customer = await customerForKeyHash(db, await sha256Hex(secret));
    expect(customer?.plan.id).toBe('scale');
    expect(customer?.plan.quota).toBe(25_000);
  });

  it('records a cancellation', async () => {
    const { customerId, secret } = await seedCustomer();
    await setCustomerStatus(db, customerId, 'canceled');
    const customer = await customerForKeyHash(db, await sha256Hex(secret));
    expect(customer?.status).toBe('canceled');
  });
});
