# Getting to $250–500 MRR

The product is built and it runs itself. This document is about the part that
software cannot do for you: finding the first twenty customers.

**The target in plain numbers.** $250–500/month is **13–26 Starter subscribers**
at $19, or **5–10 Growth subscribers** at $49. Realistically it lands as a mix:
roughly 8 Starter and 5 Growth gets you to $400. That is a small number of
people, and it is worth holding onto — the goal is not a launch that goes viral,
it is thirteen developers who have a resume-parsing problem this week.

---

## Why the open-source core is the distribution strategy

The paid API and the free library are not in tension. The library is the top of
the funnel, and it works while you sleep:

- **npm** — `cvjson` is discoverable by anyone searching "resume parser".
  Package pages rank well and the listing never expires.
- **GitHub** — repo search for "resume parser" is a steady, permanent trickle.
- **The JSON Resume ecosystem** — an existing community with an existing
  standard, already looking for tools that speak it.

A percentage of people who install the library discover they would rather not
run PDF extraction themselves, and convert. That percentage is small, which is
why the library needs to be genuinely good rather than crippled — a deliberately
hobbled free tier converts worse than a good one, because it never gets adopted
in the first place.

---

## Launch sequence

### Before announcing anything

- [ ] Complete every step in [DEPLOYMENT.md](DEPLOYMENT.md), including the
      test-mode transaction. **Do not skip this** — an announcement that lands
      on a broken checkout is a one-shot opportunity wasted.
- [ ] Parse 20 real resumes through the demo. Fix what breaks. This is the
      highest-value hour available to you.
- [ ] Make the repo public.
- [ ] Publish `cvjson` to npm.

### Week 1 — the channels where the buyer already is

**Show HN / r/programming.** Lead with the technical decision, not the product.
"I wrote a resume parser that doesn't use an LLM" is a story; "Check out my new
SaaS" is not. Be first in the comments with the honest limitations — the
two-column PDF problem, the OCR gap. Technical audiences reward that and punish
its absence.

**Post to the niches that have the problem:**
- r/recruiting, r/Talent, r/humanresources — ATS builders and recruiting ops
- r/webdev, r/node — developers who have been handed "parse these resumes"
- Hacker News "Ask HN: what are you working on"
- Indie Hackers
- Dev.to and Hashnode — a technical write-up of how the parser segments
  sections is genuinely interesting and ranks in search for years

**Answer the questions that already exist.** Search Stack Overflow, Reddit and
GitHub issues for "resume parser", "parse CV to JSON", "extract data from
resume". People are asking this right now. A useful answer that mentions the
library converts far better than any ad, and it keeps working.

### Week 2–4 — the compounding channels

**List it where buyers browse:**
- [ ] [RapidAPI Hub](https://rapidapi.com/) — 4M+ developers, and they handle
      billing and payouts themselves. Genuinely passive. They take 25%.
- [ ] Product Hunt
- [ ] [awesome-hr](https://github.com/topics/human-resources) and similar lists
- [ ] The JSON Resume community (their GitHub org and Discord)

**Write the three articles people search for:**
1. "How to parse a resume into JSON with Node.js" — the direct query
2. "Resume parsing APIs compared" — an honest comparison, yours included; be
   fair about the competitors' strengths and it will outrank the fluff
3. "Why we parse resumes without an LLM" — the technical angle, links widely

**Talk to ATS and job-board builders directly.** Small ATS products,
applicant-tracking plugins and job boards all need this and mostly cannot
justify $800/month. Ten well-chosen emails beat a thousand impressions.

### Month 2–3 — deepen what works

- Watch which channel actually produced paying customers, and do only that.
- Ask every paying customer, once: "What nearly stopped you signing up?"
- If several customers ask for the same thing (webhooks, batch, a Python
  client), build it. If one asks, note it and wait.

---

## Pricing notes

$19 / $49 / $149 is set deliberately below the incumbents. Two things worth
knowing:

**Do not discount to win the first customers.** At this price the constraint is
finding people with the problem, not overcoming price resistance. A discount
teaches you nothing and permanently anchors the customer.

**Raise prices only for new customers.** If Growth fills up, add a tier above
it rather than repricing the people who took a chance on you early.

---

## What "hands-off" honestly means

The billing, provisioning and revocation are genuinely automatic — that part is
done and tested. What remains:

| Reality                | Roughly                                  |
| ---------------------- | ---------------------------------------- |
| Support email          | A few messages a month at this scale     |
| Parsing complaints     | Occasional; usually a one-line lexicon fix |
| Dependency updates     | Twice a year                              |
| Stripe disputes        | Rare, but only you can respond            |

The one thing that is **not** automatic and never will be is customer
acquisition. The product cannot market itself, and no amount of engineering
substitutes for the first twenty conversations. Budget an evening a week for
the first two months; after that, if the open-source funnel is working, it
largely coasts.

---

## Signals to watch

| Signal                                   | Read                                      |
| ---------------------------------------- | ----------------------------------------- |
| Demo used, no subscribe                  | Output quality or pricing — ask people     |
| Subscribe clicked, checkout abandoned    | Pricing or trust; add logos/testimonials   |
| Subscribed then cancelled in month 1     | Accuracy on their documents; ask why       |
| npm installs rising, no signups          | Funnel works; the API pitch needs sharpening |
| Nobody anywhere                          | Distribution, not product. Go where buyers are |

The last row is the common one, and the fix is always the same: fewer
announcements, more direct conversations with people who have the problem.
