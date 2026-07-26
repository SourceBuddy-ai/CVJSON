/**
 * Transactional email via Resend.
 *
 * Only two messages exist: "here is your API key" and "your key was revoked".
 * Both are triggered by a Stripe webhook, so nobody has to send them.
 */

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SITE_URL?: string;
}

interface SendResult {
  sent: boolean;
  reason?: string;
}

async function send(env: EmailEnv, to: string, subject: string, text: string): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    // Email is not configured. The caller has already provisioned the account,
    // so this must not fail the webhook — Stripe would retry and we would mint
    // duplicate keys. Report it and let the log carry the signal.
    return { sent: false, reason: 'email not configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
  });

  if (!response.ok) {
    return { sent: false, reason: `resend responded ${response.status}` };
  }
  return { sent: true };
}

export async function sendApiKeyEmail(
  env: EmailEnv,
  to: string,
  options: { secret: string; planName: string; quota: number },
): Promise<SendResult> {
  const site = env.SITE_URL ?? 'https://cvjson.dev';
  const body = `Your CVJSON API key is ready.

  ${options.secret}

This is the only time the key is shown — it is stored hashed, so it cannot be
recovered later. Save it somewhere safe now. If you lose it, you can issue a new
one from the billing portal.

Plan: ${options.planName} (${options.quota.toLocaleString('en-US')} parses per month)

Parse your first resume:

  curl -X POST ${site.replace(/\/$/, '')}/v1/parse \\
    -H "Authorization: Bearer ${options.secret}" \\
    -F "file=@resume.pdf"

Docs: ${site}/docs
Manage your subscription: ${site}/billing

— CVJSON`;

  return send(env, to, 'Your CVJSON API key', body);
}

export async function sendRevocationEmail(env: EmailEnv, to: string): Promise<SendResult> {
  const site = env.SITE_URL ?? 'https://cvjson.dev';
  const body = `Your CVJSON subscription has ended and your API keys have been revoked.

Requests using them will now return 401.

If this was not intentional, resubscribing from ${site}/pricing issues a new key
straight away.

— CVJSON`;

  return send(env, to, 'CVJSON subscription ended', body);
}
