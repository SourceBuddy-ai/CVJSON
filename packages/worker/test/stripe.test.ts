import { describe, expect, it } from 'vitest';
import { priceIdFromSubscription, verifyStripeWebhook } from '../src/stripe.js';

const SECRET = 'whsec_test_secret';

async function sign(body: string, timestamp: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

const NOW = 1_800_000_000;
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });

describe('verifyStripeWebhook', () => {
  it('accepts a correctly signed payload', async () => {
    const result = await verifyStripeWebhook(BODY, await sign(BODY, NOW), SECRET, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.id).toBe('evt_1');
  });

  it('rejects a tampered body', async () => {
    // The signature is valid for BODY, but the body has since been altered —
    // this is the attack the whole mechanism exists to stop.
    const header = await sign(BODY, NOW);
    const tampered = BODY.replace('evt_1', 'evt_attacker');
    const result = await verifyStripeWebhook(tampered, header, SECRET, NOW);
    expect(result).toMatchObject({ ok: false, reason: 'signature mismatch' });
  });

  it('rejects a signature made with the wrong secret', async () => {
    const header = await sign(BODY, NOW, 'whsec_wrong');
    const result = await verifyStripeWebhook(BODY, header, SECRET, NOW);
    expect(result).toMatchObject({ ok: false, reason: 'signature mismatch' });
  });

  it('rejects a replayed request outside the tolerance window', async () => {
    const stale = NOW - 3600;
    const result = await verifyStripeWebhook(BODY, await sign(BODY, stale), SECRET, NOW);
    expect(result).toMatchObject({ ok: false, reason: 'signature timestamp outside tolerance' });
  });

  it('accepts a signature just inside the tolerance window', async () => {
    const recent = NOW - 299;
    const result = await verifyStripeWebhook(BODY, await sign(BODY, recent), SECRET, NOW);
    expect(result.ok).toBe(true);
  });

  it('accepts when one of several rotated signatures matches', async () => {
    const valid = await sign(BODY, NOW);
    const header = `${valid},v1=${'0'.repeat(64)}`;
    const result = await verifyStripeWebhook(BODY, header, SECRET, NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing or malformed header', async () => {
    expect(await verifyStripeWebhook(BODY, null, SECRET, NOW)).toMatchObject({ ok: false });
    expect(await verifyStripeWebhook(BODY, 'garbage', SECRET, NOW)).toMatchObject({
      ok: false,
      reason: 'malformed signature header',
    });
  });

  it('refuses to verify when no secret is configured', async () => {
    // Without this an unconfigured deploy would accept every webhook.
    const result = await verifyStripeWebhook(BODY, await sign(BODY, NOW), '', NOW);
    expect(result).toMatchObject({ ok: false, reason: 'webhook secret not configured' });
  });

  it('reports a signed payload that is not JSON', async () => {
    const body = 'not json';
    const result = await verifyStripeWebhook(body, await sign(body, NOW), SECRET, NOW);
    expect(result).toMatchObject({ ok: false, reason: 'body is not valid JSON' });
  });
});

describe('priceIdFromSubscription', () => {
  it('reads the first line item price', () => {
    expect(priceIdFromSubscription({ items: { data: [{ price: { id: 'price_123' } }] } })).toBe('price_123');
  });

  it('returns undefined when the shape is unexpected', () => {
    expect(priceIdFromSubscription({})).toBeUndefined();
    expect(priceIdFromSubscription({ items: { data: [] } })).toBeUndefined();
  });
});
