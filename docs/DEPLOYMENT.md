# Deployment runbook

Everything here is done once. After that the service provisions customers,
bills them, and revokes them without you.

Budget: about 90 minutes end to end, most of it waiting on DNS.

Running cost at the target scale: **$0–5/month.** Cloudflare Workers' free tier
covers 100k requests/day and D1's free tier covers 5M row reads/day — well past
what a few hundred dollars of MRR generates. Stripe takes 2.9% + 30¢ per charge.
Resend is free to 3,000 emails/month.

---

## 1. Prerequisites

- A Cloudflare account (free plan is fine)
- A Stripe account
- A domain. The examples use `cvjson.dev`; substitute yours everywhere.
- A [Resend](https://resend.com) account for the API-key emails

```bash
npm install
npm install -g wrangler
wrangler login
```

---

## 2. Create the database

```bash
cd packages/worker
wrangler d1 create cvjson
```

Copy the printed `database_id` into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`. Then apply the schema:

```bash
npm run db:init
```

---

## 3. Set up Stripe

Create three **recurring monthly** products in the Stripe dashboard:

| Product | Price | Note                         |
| ------- | ----- | ---------------------------- |
| Starter | $19   | 1,000 parses/month           |
| Growth  | $49   | 5,000 parses/month           |
| Scale   | $149  | 25,000 parses/month          |

Note each **price ID** (`price_…`, not the product id).

Then enable the **Billing Portal** at Settings → Billing → Customer portal.
Turn on plan switching, cancellation, payment-method updates and invoice
history. This is what keeps subscription changes off your plate — leave it off
and every upgrade becomes an email to you.

Create a **Payment Link** for each price (Stripe → Payment links). Under each
link's options, set "Save customer details" so a Stripe customer is created,
and set the success URL to `https://cvjson.dev/success`.

---

## 4. Set the secrets

```bash
cd packages/worker
wrangler secret put STRIPE_SECRET_KEY       # sk_live_…
wrangler secret put STRIPE_WEBHOOK_SECRET   # from step 6
wrangler secret put STRIPE_PRICE_STARTER    # price_…
wrangler secret put STRIPE_PRICE_GROWTH     # price_…
wrangler secret put STRIPE_PRICE_SCALE      # price_…
wrangler secret put RESEND_API_KEY          # re_…
wrangler secret put EMAIL_FROM              # "CVJSON <keys@cvjson.dev>"
```

Secrets never go in `wrangler.toml`, which is committed.

---

## 5. Deploy the API

```bash
npm run deploy
```

Then in the Cloudflare dashboard, add a custom domain of `api.cvjson.dev` to
the `cvjson-api` Worker (Workers → cvjson-api → Settings → Domains & Routes).

Verify:

```bash
curl https://api.cvjson.dev/health
# {"status":"ok","service":"cvjson-api","plans":["starter","growth","scale"]}
```

---

## 6. Point Stripe at the webhook

Stripe → Developers → Webhooks → Add endpoint.

- URL: `https://api.cvjson.dev/v1/stripe/webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `invoice.payment_succeeded`

Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` from step 4,
then redeploy so the new secret is picked up.

---

## 7. Publish the site

The site is one static file.

```
Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets
```

Upload `site/`, set the custom domain to `cvjson.dev`, and paste your three
Stripe Payment Link URLs into the `LINKS` object near the bottom of
`site/index.html`. Until you do, the subscribe buttons say so out loud rather
than failing silently.

---

## 8. Publish the npm package

This is the distribution channel, not an afterthought — it is how people find
the hosted API.

```bash
cd packages/core
npm run build
npm publish --access public
```

---

## 9. End-to-end test before announcing

Run a real transaction in Stripe **test mode** first (swap the secrets for
`sk_test_…` and test price IDs, redeploy, then swap back).

1. Click Subscribe on the site. Complete checkout with card `4242 4242 4242 4242`.
2. Confirm the API-key email arrives within a few seconds.
3. Parse something:
   ```bash
   curl -X POST https://api.cvjson.dev/v1/parse \
     -H "Authorization: Bearer cvj_live_…" \
     -F "file=@some-resume.pdf"
   ```
4. Check `GET /v1/usage` reports `used: 1`.
5. Cancel from the billing portal; confirm the key then returns `401`.

If all five pass, the loop is closed and the service runs itself.

---

## Ongoing operations

Realistically this is what is left:

| Frequency  | Task                                                          |
| ---------- | ------------------------------------------------------------- |
| Never      | Provisioning, billing, upgrades, cancellations — all automatic |
| Monthly    | Glance at Stripe revenue and Cloudflare error rate            |
| As needed  | Reply to support email                                        |
| Rarely     | Add a heading variant when a customer reports a miss          |

### Things that will eventually need a human

Being straight about this, since "zero operations" is the goal and not quite
the reality:

- **Support email.** Expect a handful a month at this scale. Mostly "how do I
  do X" — answerable from `docs/API.md`.
- **A parsing complaint.** The fix is usually one entry in
  `packages/core/src/lexicon/headings.ts`, then republish.
- **Stripe disputes.** Rare at this price point, but they arrive in your inbox
  and only you can respond.
- **Dependency updates.** `unpdf` and `wrangler` a couple of times a year.

### Monitoring

Worker observability is enabled in `wrangler.toml`; logs are in the Cloudflare
dashboard. The two things worth an alert are a spike in 5xx and a webhook
delivery failure — Stripe emails you about the latter automatically.

### If the webhook fails

Stripe retries for up to three days and shows every attempt under
Developers → Webhooks. The handler is idempotent, so replaying a delivery from
the dashboard is safe.
