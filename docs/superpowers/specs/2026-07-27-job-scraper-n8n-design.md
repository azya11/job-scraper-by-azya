# Job Search Automation — n8n on GCP (design spec)

Date: 2026-07-27
Status: approved, implementing

## Goal

Every 6 hours, discover new Software Engineer / Backend / Full Stack / ML / .NET
postings, evaluate each against the candidate's real profile using the same
scoring rubric as `career-ops` (Blocks A-F + G), drop anything scoring below
3.5/5, log every evaluated posting (pass or fail) permanently, and send a
Telegram alert for everything that clears the bar.

## Non-goals / explicit exclusions

- No direct scraping of LinkedIn/Indeed/Handshake, and no anti-bot evasion
  tooling (TLS/fingerprint impersonation, residential proxy rotation, CDP-leak
  hiding). These sites' ToS prohibit automated access; a system that exists to
  defeat their bot defenses on a recurring schedule is not something this
  project builds, independent of how benign the end use is.
- Handshake is not automated at all (login-walled behind a real .edu account —
  not worth the ban risk for a small slice of volume).
- No bespoke per-company scraper maintenance for career portals with no public
  JSON API. Coverage there is a documented gap, closable later per-company.

## Sourcing (sustainable tiers only)

1. **ATS public JSON APIs** — Greenhouse, Lever, Ashby. Official endpoints
   meant to be called programmatically; zero evasion risk. Company list lives
   in a `company_sources` Postgres table (data, not workflow logic) seeded
   with big tech + notable startups confirmed live against the real APIs.
2. **Accelerators** — YC "Work at a Startup" public Algolia search endpoint,
   covers the whole YC portfolio in one query.
3. **Licensed aggregator API** — Adzuna or JSearch (RapidAPI) for
   Indeed/LinkedIn-indexed coverage. These vendors license the data and
   re-serve it through a documented API — this is the actual substitute for
   scraping those two sites directly.
4. **Best-effort managed actor (optional)** — a single Apify actor branch,
   wrapped in continue-on-fail so its breakage never blocks the other tiers.
   Used only within Apify's own terms as a hosted product.
5. **FAANG/custom portals** — plain HTTP GET against whatever a confirmed
   public endpoint returns (e.g. Amazon's `amazon.jobs/en/search.json`). No
   stealth browser, no fingerprint spoofing. Portals with no such endpoint are
   simply not covered automatically.
6. **Manual inbox** — an n8n Form/Webhook where the user pastes any URL (a
   Handshake posting, a direct link, anything) and it re-enters the same
   normalize → evaluate → alert pipeline, mirroring career-ops' `pipeline.md`
   inbox pattern.

## Architecture

```
Cloud Scheduler (cron 0 */6 * * *)
        │  HTTP POST
        ▼
n8n Webhook Trigger (Cloud Run, min-instances=0)
        │
        ├─ Ingestion branches (parallel, continue-on-fail each):
        │     Greenhouse | Lever | Ashby | YC Algolia | Aggregator API | Apify (optional)
        │
        ▼
   Normalizer (Code node) → common job schema
        ▼
   Keyword gate (target roles from profile.yml)
        ▼
   Dedup (sha256(canonical url), Postgres INSERT ... ON CONFLICT DO NOTHING)
        ▼
   Per-job Evaluate sub-workflow (Execute Workflow, one call per surviving job)
        │   Claude API — career-ops A-F/G rubric, real profile.yml data
        ▼
   Persist to job_evaluations (every job, pass or fail)
        ▼
   If global_score >= 3.5 → Telegram (condensed card + full A-F report)
```

Cloud Scheduler → Webhook (not n8n's internal Schedule Trigger) because a
scale-to-zero Cloud Run container can't reliably keep its own crontab alive;
an external HTTP hit wakes it on demand and costs nothing between runs.

## Data model (Postgres / Cloud SQL)

- `company_sources(id, name, ats_type, identifier, active)` — editable list of
  what to query each run.
- `job_evaluations(id, job_hash UNIQUE, url, company, title, location,
  source_platform, match_cv_score, north_star_score, comp_score,
  cultural_score, red_flags_score, global_score, posting_legitimacy,
  full_report_md, full_report_json, telegram_sent, evaluated_at)` — permanent
  log of every evaluated posting.
- `manual_inbox(id, url, note, added_at, processed)` — user-pasted URLs
  awaiting the next run.

## Scoring

Reuses career-ops' actual rubric (`career-ops/modes/_shared.md`), not an
invented one: Blocks A-F (Match CV, North Star alignment, Comp, Cultural
signals, Red flags, weighted Global 1-5) plus Block G posting-legitimacy as a
separate qualitative tier. Same bands: 4.5+ strong match, 4.0-4.4 good,
3.5-3.9 decent, below 3.5 → drop (no Telegram alert, still logged).

Candidate data for the prompt comes from the real
`career-ops/config/profile.yml` (target roles, archetypes, proof points, comp
range, location) — not a fabricated resume.

## Error handling

Each ingestion branch fails independently (n8n continue-on-fail); a run
summary records which sources succeeded/failed so silent breakage is visible
rather than just quietly losing a source.

## Testing plan

- Unit-test the normalizer, dedup-hash, and keyword-filter logic as plain
  Node modules before they go into n8n Code nodes.
- Verify every `company_sources` seed row against the live Greenhouse/
  Lever/Ashby/YC endpoints before committing the seed data — no unverified
  tokens ship.
- Import and manually execute the n8n workflows locally against the real
  (free, keyless) ATS endpoints to confirm wiring and data flow.
- Claude API, Telegram, and Adzuna/JSearch calls need the user's own
  credentials to test live — those are exercised as far as possible without
  keys (prompt construction, payload shape) and documented as the remaining
  manual verification step once keys are supplied.
