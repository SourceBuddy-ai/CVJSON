/** Shared HTTP helpers: consistent JSON envelopes, CORS and error shapes. */

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-api-key',
  'access-control-max-age': '86400',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...headers },
  });
}

export type ErrorType =
  | 'unauthorized'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'invalid_request'
  | 'unsupported_media'
  | 'payload_too_large'
  | 'parse_failed'
  | 'not_found'
  | 'internal';

const STATUS_FOR: Record<ErrorType, number> = {
  unauthorized: 401,
  quota_exceeded: 402,
  rate_limited: 429,
  invalid_request: 400,
  unsupported_media: 415,
  payload_too_large: 413,
  parse_failed: 422,
  not_found: 404,
  internal: 500,
};

/**
 * Error envelope.
 *
 * `type` is a stable machine-readable string and `message` explains what to do
 * about it — an integrator reading a 402 should not have to guess whether to
 * upgrade, retry, or fix their request.
 */
export function error(
  type: ErrorType,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error: { type, message, ...extra } }, STATUS_FOR[type]);
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Client IP as seen by Cloudflare, used for anonymous demo rate limiting. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}
