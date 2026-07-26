import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/env.js';
import { generateKey } from '../src/keys.js';
import { insertApiKey, upsertCustomer } from '../src/db.js';
import { createTestD1, SCHEMA_PATH } from './d1.js';

const RESUME = `Jane Rodriguez
jane@example.com | (415) 555-0182

EXPERIENCE
Stripe | Staff Engineer | Jan 2021 - Present
• Designed the idempotency layer

SKILLS
Go, Python, Kubernetes
`;

let env: Env;
let apiKey: string;

async function seed(plan = 'starter'): Promise<string> {
  await upsertCustomer(env.DB, {
    id: 'cus_test',
    email: 'buyer@example.com',
    plan,
    status: 'active',
    subscriptionId: 'sub_1',
  });
  const key = await generateKey();
  await insertApiKey(env.DB, { id: key.id, customerId: 'cus_test', hash: key.hash });
  return key.secret;
}

function parseRequest(body: string, key?: string): Request {
  return new Request('https://api.cvjson.dev/v1/parse', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ text: body }),
  });
}

beforeEach(async () => {
  env = { DB: createTestD1(SCHEMA_PATH), SITE_URL: 'https://cvjson.dev' } as Env;
  apiKey = await seed();
});

describe('routing', () => {
  it('answers the health check', async () => {
    const response = await worker.fetch(new Request('https://api.cvjson.dev/health'), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('answers CORS preflight', async () => {
    const response = await worker.fetch(
      new Request('https://api.cvjson.dev/v1/parse', { method: 'OPTIONS' }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('404s an unknown path', async () => {
    const response = await worker.fetch(new Request('https://api.cvjson.dev/nope'), env);
    expect(response.status).toBe(404);
  });

  it('rejects the wrong method on /v1/parse', async () => {
    const response = await worker.fetch(new Request('https://api.cvjson.dev/v1/parse'), env);
    expect(response.status).toBe(400);
  });
});

describe('authentication', () => {
  it('rejects a request with no key', async () => {
    const response = await worker.fetch(parseRequest(RESUME), env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { type: 'unauthorized' } });
  });

  it('rejects a malformed key without consulting the database', async () => {
    const response = await worker.fetch(parseRequest(RESUME, 'not-a-key'), env);
    expect(response.status).toBe(401);
  });

  it('rejects a well-formed key that was never issued', async () => {
    const response = await worker.fetch(parseRequest(RESUME, `cvj_live_${'a'.repeat(48)}`), env);
    expect(response.status).toBe(401);
  });
});

describe('parsing', () => {
  it('parses a resume and reports quota in the headers', async () => {
    const response = await worker.fetch(parseRequest(RESUME, apiKey), env);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { resume: { basics?: { name?: string } } };
    expect(body.resume.basics?.name).toBe('Jane Rodriguez');

    expect(response.headers.get('x-cvjson-plan')).toBe('starter');
    expect(response.headers.get('x-cvjson-quota-used')).toBe('1');
    expect(response.headers.get('x-cvjson-quota-remaining')).toBe('999');
  });

  it('rejects a JSON body with no text', async () => {
    const request = new Request('https://api.cvjson.dev/v1/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({}),
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
  });

  it('does not spend quota on a malformed request', async () => {
    const bad = new Request('https://api.cvjson.dev/v1/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: 'not json',
    });
    await worker.fetch(bad, env);

    const usage = await worker.fetch(
      new Request('https://api.cvjson.dev/v1/usage', { headers: { authorization: `Bearer ${apiKey}` } }),
      env,
    );
    await expect(usage.json()).resolves.toMatchObject({ used: 0 });
  });

  it('rejects an oversized payload', async () => {
    env.MAX_UPLOAD_BYTES = '100';
    const response = await worker.fetch(parseRequest(RESUME.repeat(20), apiKey), env);
    expect(response.status).toBe(413);
  });
});

describe('quota enforcement', () => {
  it('returns 402 once the plan quota is spent', async () => {
    // Fill the month by hand rather than issuing 1,000 requests.
    await env.DB.prepare('INSERT INTO usage (customer_id, period, count) VALUES (?1, ?2, 1000)')
      .bind('cus_test', new Date().toISOString().slice(0, 7))
      .run();

    const response = await worker.fetch(parseRequest(RESUME, apiKey), env);
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ error: { type: 'quota_exceeded' } });
  });
});

describe('usage endpoint', () => {
  it('reports plan and remaining quota without spending any', async () => {
    await worker.fetch(parseRequest(RESUME, apiKey), env);

    const response = await worker.fetch(
      new Request('https://api.cvjson.dev/v1/usage', { headers: { authorization: `Bearer ${apiKey}` } }),
      env,
    );
    const body = await response.json();
    expect(body).toMatchObject({ used: 1, remaining: 999, status: 'active' });

    // Reading usage must not itself consume quota.
    const again = await worker.fetch(
      new Request('https://api.cvjson.dev/v1/usage', { headers: { authorization: `Bearer ${apiKey}` } }),
      env,
    );
    await expect(again.json()).resolves.toMatchObject({ used: 1 });
  });
});

describe('demo endpoint', () => {
  it('parses without a key', async () => {
    const request = new Request('https://api.cvjson.dev/v1/demo/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ text: RESUME }),
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-cvjson-demo-remaining')).toBe('9');
  });

  it('rate limits an IP after the daily allowance', async () => {
    const make = () =>
      new Request('https://api.cvjson.dev/v1/demo/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.10' },
        body: JSON.stringify({ text: RESUME }),
      });

    for (let i = 0; i < 10; i += 1) {
      expect((await worker.fetch(make(), env)).status).toBe(200);
    }
    const blocked = await worker.fetch(make(), env);
    expect(blocked.status).toBe(429);
  });
});

describe('webhook endpoint', () => {
  it('rejects an unsigned webhook', async () => {
    const request = new Request('https://api.cvjson.dev/v1/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } }),
    });
    const response = await worker.fetch(request, { ...env, STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { type: 'invalid_signature' } });
  });
});
