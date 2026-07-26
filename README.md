# CVJSON

**Turn any resume into structured JSON.**

CVJSON parses a resume — PDF, DOCX, HTML or plain text — into the
[JSON Resume](https://jsonresume.org/schema) schema. Contact details, work
history, education, skills and certifications come back typed, dated and
sorted, with a confidence score on every field.

The parser is MIT licensed and runs anywhere JavaScript does. A hosted API is
available if you would rather not run it yourself.

```bash
npm install cvjson
```

```ts
import { parseResume } from 'cvjson';

const { resume, meta } = await parseResume(pdfBuffer);

resume.basics.name         // "Jane Rodriguez"
resume.work[0].name        // "Stripe"
resume.work[0].position    // "Staff Software Engineer"
resume.work[0].startDate   // "2021-01"
resume.skills[0].keywords  // ["Go", "Python", "TypeScript"]
meta.confidence.work       // 0.93
```

---

## Why this exists

Resume parsing is a crowded market. The enterprise vendors (Affinda,
Textkernel, Daxtra) run from $75 to $800+ a month and usually want a sales
call. A budget tier already exists too — CVParserPro from $29/month,
Superparser, and several free tiers — so "cheaper than the incumbents" is not,
on its own, a reason to pick this.

What is actually different about CVJSON:

|                      | CVJSON                        | Most alternatives      |
| -------------------- | ----------------------------- | ---------------------- |
| Self-host option     | Yes, the parser is MIT        | No — API only          |
| Output format        | JSON Resume (open standard)   | Proprietary schema     |
| Stores your resumes  | No                            | Usually yes            |
| Cost per parse       | Zero — no model inference     | Metered credits        |
| Determinism          | Same input, same output       | Varies with the model  |

If you want the most accurate parser available and do not care where the data
goes, one of the LLM-backed services will likely beat this on messy documents.
CVJSON is for the case where you need the parsing to be reproducible, free at
the margin, and runnable inside your own infrastructure.

## What it does well, and what it does not

It is a **deterministic parser**, not a language model. That is a deliberate
trade:

- It will not invent a job that is not on the page, and the same input always
  gives the same output.
- It costs nothing per call to run, which is why the hosted pricing can be flat.
- It runs in ~10ms, offline, with no API keys or model downloads.

The flip side is honest to state:

- A resume laid out as a two-column graphic-design piece will parse poorly.
  PDF text extraction reads such layouts in visual order, which interleaves the
  columns.
- A scanned resume is an image. There is no text layer, so the parser reports a
  warning telling you it needs OCR first.
- Highly unusual section headings may not be recognised. The heading lexicon
  covers a few hundred variants; genuinely novel ones fall through.

Every parse returns `meta.confidence` and `meta.warnings` so these cases are
visible rather than silent.

## Supported input

| Format | Notes                                                        |
| ------ | ------------------------------------------------------------ |
| PDF    | Text layer only. Scans need OCR first — a warning says so.     |
| DOCX   | Including bullets, which Word stores as a style, not a glyph. |
| HTML   | Block structure and list items are preserved.                 |
| Text   | Passed straight through.                                      |

PDF support uses [`unpdf`](https://github.com/unjs/unpdf), declared as an
optional peer dependency and imported on demand — install it only if you parse
PDFs.

## What it extracts

`basics` (name, email, phone, location, profiles, summary, label) · `work` ·
`education` · `skills` · `projects` · `certificates` · `awards` ·
`publications` · `languages` · `interests` · `volunteer` · `references`

## API

### `parseResume(input, options?)`

Accepts a `string`, `Uint8Array` or `ArrayBuffer`. The format is detected from
magic bytes unless overridden.

```ts
const result = await parseResume(buffer, {
  minConfidence: 0.5,   // drop fields the parser is unsure about
  includeText: true,    // also return the extracted raw text
  format: 'pdf',        // skip detection
  canonical: 'https://example.com/jane',
});
```

Returns `{ resume, meta, text? }` where `resume` is JSON Resume and `meta`
carries the parser version, source format, timing, detected sections,
per-field confidence and any warnings.

### `parseResumeText(text, options?)`

Synchronous variant for callers that already have plain text.

### Confidence scores

`meta.confidence` maps field paths to a number in `[0, 1]`:

```json
{ "basics.email": 0.97, "basics.name": 0.95, "work": 0.93, "basics.label": 0.4 }
```

These are **heuristic self-assessments, not calibrated probabilities**. They
rank fields against each other within one parse so you can decide what needs a
human look. Do not present them to end users as accuracy percentages.

## Hosted API

If you would rather not run it, the same parser is available as an API.

```bash
curl -X POST https://api.cvjson.dev/v1/parse \
  -H "Authorization: Bearer cvj_live_…" \
  -F "file=@resume.pdf"
```

Plans start at $19/month for 1,000 parses. Documents are parsed in memory and
never stored. See [docs/API.md](docs/API.md) for the full reference.

## Repository layout

```
packages/core     The MIT-licensed parser, published to npm as `cvjson`
packages/worker   The hosted API — Cloudflare Worker, D1, Stripe billing
site              Landing page and live demo
docs              API reference, deployment runbook, launch checklist
```

## Development

```bash
npm install
npm test          # 192 tests across both packages
npm run typecheck
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
