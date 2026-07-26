# CVJSON API reference

Base URL: `https://api.cvjson.dev`

All responses are JSON. All endpoints accept CORS preflight.

---

## Authentication

Pass your API key as a bearer token:

```
Authorization: Bearer cvj_live_…
```

An `X-API-Key: cvj_live_…` header is also accepted.

Keys are shown **once**, in the email sent when you subscribe. They are stored
only as a SHA-256 hash, so they cannot be recovered — if you lose one, issue a
replacement from the billing portal.

---

## `POST /v1/parse`

Parse a resume.

### Request

Three body formats are accepted.

**Multipart upload** — the usual choice from a browser or `curl`:

```bash
curl -X POST https://api.cvjson.dev/v1/parse \
  -H "Authorization: Bearer cvj_live_…" \
  -F "file=@resume.pdf"
```

**Raw binary** — for server-to-server calls:

```bash
curl -X POST https://api.cvjson.dev/v1/parse \
  -H "Authorization: Bearer cvj_live_…" \
  -H "Content-Type: application/pdf" \
  --data-binary @resume.pdf
```

**JSON** — when you already have the text:

```bash
curl -X POST https://api.cvjson.dev/v1/parse \
  -H "Authorization: Bearer cvj_live_…" \
  -H "Content-Type: application/json" \
  -d '{"text": "Jane Rodriguez\njane@example.com\n..."}'
```

### Query parameters

| Parameter         | Type    | Description                                              |
| ----------------- | ------- | -------------------------------------------------------- |
| `min_confidence`  | `0`–`1` | Drop fields scoring below this. Default `0` (keep all).   |
| `include_text`    | `true`  | Also return the extracted raw text.                       |

### Response

```json
{
  "resume": {
    "$schema": "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
    "basics": {
      "name": "Jane A. Rodriguez",
      "email": "jane.rodriguez@example.com",
      "phone": "(415) 555-0182",
      "label": "Senior Software Engineer",
      "location": { "city": "San Francisco", "region": "CA", "countryCode": "US" },
      "profiles": [
        { "network": "LinkedIn", "username": "janerodriguez", "url": "https://linkedin.com/in/janerodriguez" }
      ]
    },
    "work": [
      {
        "name": "Stripe",
        "position": "Staff Software Engineer",
        "startDate": "2021-01",
        "location": "San Francisco, CA",
        "highlights": ["Designed the idempotency layer…"]
      }
    ],
    "education": [
      {
        "institution": "Carnegie Mellon University",
        "studyType": "Master of Science",
        "area": "Computer Science",
        "startDate": "2014",
        "endDate": "2016",
        "score": "3.9/4.0"
      }
    ],
    "skills": [{ "name": "Languages", "keywords": ["Go", "Python", "TypeScript"] }]
  },
  "meta": {
    "parser": "cvjson@0.1.0",
    "sourceFormat": "pdf",
    "durationMs": 12,
    "textLength": 1525,
    "sectionsDetected": ["summary", "work", "education", "skills"],
    "confidence": { "basics.email": 0.97, "work": 0.93 },
    "warnings": []
  }
}
```

A current role has **no `endDate`** — that is how JSON Resume expresses
"present". Do not read a missing `endDate` as missing data.

### Response headers

| Header                      | Meaning                             |
| --------------------------- | ----------------------------------- |
| `X-CVJSON-Plan`             | Plan id (`starter`, `growth`, `scale`) |
| `X-CVJSON-Quota-Limit`      | Parses included this month          |
| `X-CVJSON-Quota-Used`       | Parses used so far                  |
| `X-CVJSON-Quota-Remaining`  | Parses left                         |

---

## `GET /v1/usage`

Current period usage. Does not consume quota.

```json
{
  "plan": { "id": "starter", "name": "Starter", "quota": 1000 },
  "status": "active",
  "period": "2026-07",
  "used": 143,
  "remaining": 857
}
```

---

## `POST /v1/portal`

Returns a one-time Stripe Billing Portal URL, authenticated with your API key.
Use it to change plan, update a card, download invoices or cancel.

```json
{ "url": "https://billing.stripe.com/session/…" }
```

---

## `POST /v1/demo/parse`

Unauthenticated demo used by the website. Limited to 10 parses per IP per day
and 1 MB per document. Not for production use.

---

## Errors

Every error has the same shape:

```json
{ "error": { "type": "quota_exceeded", "message": "You have used all 1,000 parses…" } }
```

| Status | `type`              | What to do                                        |
| ------ | ------------------- | ------------------------------------------------- |
| 400    | `invalid_request`   | Fix the request body or method.                    |
| 401    | `unauthorized`      | Check the key; it may have been revoked.           |
| 402    | `quota_exceeded`    | Upgrade, or wait for the next monthly period.      |
| 413    | `payload_too_large` | Document exceeds 5 MB.                             |
| 415    | `unsupported_media` | Send PDF, DOCX, HTML or text.                      |
| 422    | `parse_failed`      | The document could not be read. Retrying won't help. |
| 429    | `rate_limited`      | Back off; see `retry_after_seconds`.               |
| 500    | `internal`          | Retry with backoff.                                 |

---

## Rate limits

| Plan    | Requests / minute | Parses / month |
| ------- | ----------------- | -------------- |
| Starter | 60                | 1,000          |
| Growth  | 120               | 5,000          |
| Scale   | 300               | 25,000         |

Exceeding the per-minute limit returns `429` with `retry_after_seconds`.
Exceeding the monthly quota returns `402` and **is not billed as overage**.

---

## Data handling

Resume content is parsed in memory and returned. It is never written to
storage or logs. The only persisted data is your hashed API key, your Stripe
customer record, and a monthly request counter.
