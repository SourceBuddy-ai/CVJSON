-- CVJSON API schema (Cloudflare D1 / SQLite).
--
-- Deliberately small: the service stores who is entitled to call it and how
-- much they have called it. Resume content is never written to disk — it is
-- parsed in memory and returned — which keeps the data-protection surface of
-- the product close to zero and removes an entire category of operational and
-- legal obligation.

CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,          -- Stripe customer id (cus_…)
  email           TEXT NOT NULL,
  plan            TEXT NOT NULL,             -- starter | growth | scale
  status          TEXT NOT NULL,             -- active | past_due | canceled
  subscription_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Only the SHA-256 of each key is stored, so a copy of this table does not
-- yield working credentials.
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,              -- public prefix, safe to display
  customer_id TEXT NOT NULL REFERENCES customers(id),
  key_hash    TEXT NOT NULL UNIQUE,
  name        TEXT,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_customer ON api_keys(customer_id);

-- One row per customer per calendar month.
CREATE TABLE IF NOT EXISTS usage (
  customer_id TEXT NOT NULL,
  period      TEXT NOT NULL,                 -- YYYY-MM, UTC
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, period)
);

-- Fixed-window counters. Rows are disposable; the scheduled handler purges them.
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket     TEXT PRIMARY KEY,               -- "<scope>:<window start>"
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expiry ON rate_limit(expires_at);

-- Stripe retries deliveries and does not guarantee exactly-once, so every
-- handled event id is recorded to make provisioning idempotent.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
