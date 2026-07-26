/**
 * API key generation and verification.
 *
 * Keys are shown to the customer exactly once, at provisioning time, and only
 * their SHA-256 hash is stored. A database leak therefore does not hand an
 * attacker working credentials, and there is no "recover my key" path to
 * operate — the customer rotates instead, which is self-serve.
 */

const KEY_BYTES = 24;

export interface GeneratedKey {
  /** The full secret, returned to the customer once and never stored. */
  secret: string;
  /** Public identifier, safe to log and display. */
  id: string;
  /** SHA-256 of `secret`, hex encoded. This is what goes in the database. */
  hash: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/**
 * Mint a new API key.
 *
 * The `cvj_live_` prefix lets secret scanners (GitHub's included) recognise a
 * leaked key on sight, and the short id prefix lets a customer identify which
 * key is which without revealing the secret.
 */
export async function generateKey(): Promise<GeneratedKey> {
  const random = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(random);
  const body = toHex(random);
  const secret = `cvj_live_${body}`;
  return {
    secret,
    id: `cvj_${body.slice(0, 8)}`,
    hash: await sha256Hex(secret),
  };
}

/** Extract a bearer token from an Authorization header, or an `x-api-key`. */
export function readKeyFromRequest(request: Request): string | undefined {
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const header = request.headers.get('x-api-key');
  return header?.trim() || undefined;
}

/** Shape check before touching the database, so malformed input costs nothing. */
export function looksLikeKey(candidate: string): boolean {
  return /^cvj_live_[0-9a-f]{48}$/.test(candidate);
}
