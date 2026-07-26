import { parseResume, type ParseOptions, type SourceFormat } from 'cvjson';
import type { Env } from '../env.js';
import { maxUploadBytes } from '../env.js';
import { checkRateLimit, consumeQuota, customerForKeyHash, type AuthedCustomer } from '../db.js';
import { looksLikeKey, readKeyFromRequest, sha256Hex } from '../keys.js';
import { DEMO_DAILY_LIMIT } from '../plans.js';
import { clientIp, error, json } from '../http.js';

/**
 * Read the resume out of a request.
 *
 * Three shapes are accepted because integrators arrive with different tools:
 * a multipart upload (curl, browsers), a raw binary body (server-to-server),
 * and JSON with a `text` field (when the caller has already extracted text).
 */
async function readDocument(
  request: Request,
  limit: number,
): Promise<
  | { ok: true; input: string | Uint8Array; format?: SourceFormat }
  | { ok: false; response: Response }
> {
  const contentType = request.headers.get('content-type') ?? '';

  // Trust the declared length for an early rejection, then enforce for real
  // after reading — a client can lie about or omit Content-Length.
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > limit) {
    return {
      ok: false,
      response: error('payload_too_large', `The document exceeds the ${limit} byte limit.`),
    };
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    // `@cloudflare/workers-types` types `FormData.get` as `string | null`, but
    // a file part arrives as a Blob at runtime. Duck-type on `arrayBuffer`
    // rather than trusting either the declared type or `instanceof`.
    const field: unknown = form.get('file');
    const isBlob =
      typeof field === 'object' && field !== null && typeof (field as Blob).arrayBuffer === 'function';

    if (!isBlob) {
      return { ok: false, response: error('invalid_request', 'Attach the resume as the "file" field.') };
    }
    const bytes = new Uint8Array(await (field as Blob).arrayBuffer());
    if (bytes.byteLength > limit) {
      return {
        ok: false,
        response: error('payload_too_large', `The document exceeds the ${limit} byte limit.`),
      };
    }
    return { ok: true, input: bytes };
  }

  if (contentType.includes('application/json')) {
    let body: { text?: unknown; format?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return { ok: false, response: error('invalid_request', 'The request body is not valid JSON.') };
    }
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return {
        ok: false,
        response: error('invalid_request', 'Provide the resume text in a "text" field.'),
      };
    }
    if (body.text.length > limit) {
      return {
        ok: false,
        response: error('payload_too_large', `The text exceeds the ${limit} character limit.`),
      };
    }
    const format = typeof body.format === 'string' ? (body.format as SourceFormat) : undefined;
    return { ok: true, input: body.text, format };
  }

  // Raw binary upload.
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return { ok: false, response: error('invalid_request', 'The request body is empty.') };
  }
  if (bytes.byteLength > limit) {
    return {
      ok: false,
      response: error('payload_too_large', `The document exceeds the ${limit} byte limit.`),
    };
  }
  return { ok: true, input: bytes };
}

function optionsFromQuery(url: URL): ParseOptions {
  const options: ParseOptions = {};
  const min = Number.parseFloat(url.searchParams.get('min_confidence') ?? '');
  if (Number.isFinite(min) && min >= 0 && min <= 1) options.minConfidence = min;
  if (url.searchParams.get('include_text') === 'true') options.includeText = true;
  return options;
}

/** Authenticate, meter and parse. */
export async function handleParse(request: Request, env: Env): Promise<Response> {
  const presented = readKeyFromRequest(request);
  if (!presented) {
    return error('unauthorized', 'Provide your API key as "Authorization: Bearer cvj_live_…".');
  }
  if (!looksLikeKey(presented)) {
    return error('unauthorized', 'That does not look like a CVJSON API key.');
  }

  const customer = await customerForKeyHash(env.DB, await sha256Hex(presented));
  if (!customer) {
    return error('unauthorized', 'This API key is not valid or has been revoked.');
  }
  if (customer.status === 'canceled') {
    return error('unauthorized', 'This subscription has ended. Resubscribe to issue a new key.');
  }

  const limit = await checkRateLimit(env.DB, `key:${customer.keyId}`, customer.plan.rateLimit, 60);
  if (!limit.allowed) {
    return error('rate_limited', `Rate limit of ${customer.plan.rateLimit} requests/minute exceeded.`, {
      retry_after_seconds: Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
    });
  }

  const document = await readDocument(request, maxUploadBytes(env));
  if (!document.ok) return document.response;

  // Quota is consumed only once the request is known to be well-formed, so a
  // malformed upload never costs the customer a parse.
  const quota = await consumeQuota(env.DB, customer.id, customer.plan.quota);
  if (!quota.allowed) {
    return error(
      'quota_exceeded',
      `You have used all ${customer.plan.quota.toLocaleString('en-US')} parses on the ${customer.plan.name} plan this month. Upgrade or wait for the next period.`,
      { period: quota.state.period, quota: quota.state.quota },
    );
  }

  return runParse(document.input, {
    ...optionsFromQuery(new URL(request.url)),
    format: document.format,
  }, usageHeaders(customer, quota.state.used));
}

function usageHeaders(customer: AuthedCustomer, used: number): Record<string, string> {
  return {
    'x-cvjson-plan': customer.plan.id,
    'x-cvjson-quota-limit': String(customer.plan.quota),
    'x-cvjson-quota-used': String(used),
    'x-cvjson-quota-remaining': String(Math.max(0, customer.plan.quota - used)),
  };
}

/**
 * Anonymous demo endpoint powering the website's live preview.
 *
 * Deliberately keyless: making someone sign up before they can see the output
 * quality is the surest way to lose them. The daily per-IP cap keeps it from
 * becoming free production capacity.
 */
export async function handleDemoParse(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  const limit = await checkRateLimit(env.DB, `demo:${ip}`, DEMO_DAILY_LIMIT, 86_400);
  if (!limit.allowed) {
    return error(
      'rate_limited',
      `The demo allows ${DEMO_DAILY_LIMIT} parses per day. Subscribe for a key to keep going.`,
      { retry_after_seconds: Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)) },
    );
  }

  // The demo caps uploads harder than the paid endpoint: it is a preview, and a
  // smaller ceiling bounds what an anonymous caller can spend.
  const document = await readDocument(request, Math.min(maxUploadBytes(env), 1024 * 1024));
  if (!document.ok) return document.response;

  return runParse(document.input, { format: document.format }, {
    'x-cvjson-demo-remaining': String(limit.remaining),
  });
}

async function runParse(
  input: string | Uint8Array,
  options: ParseOptions,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const result = await parseResume(input, options);
    return json({ resume: result.resume, meta: result.meta, text: result.text }, 200, headers);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The document could not be parsed.';
    // A parse failure is the caller's document, not a server fault — 422 tells
    // them retrying the same bytes will not help.
    return error('parse_failed', message);
  }
}
