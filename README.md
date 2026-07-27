# job-scraper-by-azya

Automated job search pipeline: every 6 hours, discover new Software Engineer /
Backend / Full Stack / ML / .NET postings, evaluate each with Claude against
the same scoring rubric [career-ops](../career-ops) uses, drop anything under
3.5/5, log every evaluated posting permanently, and send a Telegram alert for
everything that clears the bar. Runs on n8n, hosted on Google Cloud.

Design rationale and what's explicitly excluded (no LinkedIn/Indeed/Handshake
scraping, no anti-bot evasion) is in
`docs/superpowers/specs/2026-07-27-job-scraper-n8n-design.md`.

## What's here

```
sql/schema.sql, sql/seed.sql   Postgres schema + verified company list
scripts/verify-sources.mjs     Re-verify ATS tokens are still live, regenerate seed.sql
scripts/validate-inline-code.mjs  Runs the exact n8n Code node JS against live APIs
n8n/code-nodes/*.mjs           Tested standalone versions of the normalize/dedup/filter logic
n8n/workflows/*.json           Importable n8n workflows (see below)
prompts/build-prompt.mjs       Builds the Claude system prompt from the REAL profile.yml
deploy/setup-gcp.sh            Provisions Cloud SQL, Secret Manager, Cloud Run, Cloud Scheduler
tests/                         Unit tests (npm test) — 15 passing
```

## What has actually been verified to work

- **Every seed company** in `sql/seed.sql` (25 companies across Greenhouse/
  Lever/Ashby) was confirmed live against the real public APIs — not
  guessed. Re-run `npm run verify-sources` periodically; ATS tokens do get
  retired.
- **The exact inline JS in the n8n workflow JSON** (not just the standalone
  modules) was run against live Greenhouse/Lever/Ashby responses via
  `node scripts/validate-inline-code.mjs` — correctly normalized 187/287/751
  real postings just now, plus verified the keyword gate and dedup hash.
- **The evaluation prompt** was built from the candidate's real
  `career-ops/config/profile.yml` (not a fabricated resume) and unit-tested
  to confirm it contains real proof points and the real career-ops score
  bands, plus a prompt-injection boundary around the untrusted JD text (a
  malicious job posting could otherwise try to instruct the evaluator model
  directly — see "Security" below).
- **15/15 unit tests pass** (`npm test`).

## What still needs your credentials to verify live

These can't be tested without your own keys — I built and reasoned through
them carefully, but treat the first live run as the real test:

1. **Claude API call** (`n8n/workflows/evaluate-job.json`) — needs
   `ANTHROPIC_API_KEY`. Sanity-check the JSON parsing against one real
   response before trusting it unattended.
2. **Telegram delivery** — needs a bot token (`@BotFather`) and your chat ID.
3. **Adzuna aggregator** — needs a free Adzuna developer account
   (`app_id`/`app_key`).
4. **YC "Work at a Startup" ingestion** — not wired up yet. It needs a real
   Algolia app ID/search key pulled from `workatastartup.com`'s own network
   requests (DevTools → Network → filter `algolia.net`); I deliberately did
   not fabricate a plausible-looking key. Add it as
   `n8n/workflows/ingestion-yc.json` following the pattern of
   `ingestion-aggregator.json` once you have the real key.
5. **Full n8n runtime** — I could not install n8n locally in this
   environment (its dependency tree hit Windows path-length limits under
   `npm install`), so I validated the actual Code node logic by extracting
   it and running it against live data instead of running it inside n8n
   itself. Importing the workflow JSON into a real n8n instance and doing
   one manual end-to-end run is the remaining verification step — do this
   before turning on the 6-hour schedule.

## Setup

1. **Load the database**: `gcloud sql connect ...` then run `sql/schema.sql`
   and `sql/seed.sql` (deploy/setup-gcp.sh prints the exact commands).
2. **Regenerate the eval prompt** whenever `career-ops/config/profile.yml`
   changes: `node prompts/build-prompt.mjs path/to/profile.yml > system_prompt.txt`,
   then update the `eval-system-prompt` secret.
3. **Run `deploy/setup-gcp.sh`** (edit the variables at the top first — GCP
   project, DB password, Anthropic/Telegram/Adzuna keys).
4. **Import the workflows** into the deployed n8n UI: `n8n/workflows/
   main-orchestrator.json`, `ingestion-ats.json`, `ingestion-aggregator.json`,
   `ingestion-manual-inbox.json`, `evaluate-job.json`.
5. **Create n8n credentials**: Postgres (`job-db`), Anthropic API header auth,
   Telegram Bot (`telegram-bot`), Adzuna (used as `$credentials.adzunaApi` in
   `ingestion-aggregator.json` — set up as an HTTP Query Auth credential).
6. **Activate all workflows**, then manually run
   `gcloud scheduler jobs run job-pipeline-6h --location=$REGION` once and
   check Postgres (`SELECT * FROM job_evaluations ORDER BY evaluated_at DESC`)
   and Telegram before trusting the unattended 6-hour cadence.

## Security

- No direct scraping of LinkedIn/Indeed/Handshake, and no anti-bot evasion
  tooling — see the design spec for why.
- The Cloud Run service requires authentication; only Cloud Scheduler (via a
  dedicated service account with `run.invoker`) can trigger a run.
- Job description text is untrusted external content (anyone can post a job
  with any text in it). The evaluation prompt explicitly instructs Claude to
  treat it as data, not instructions, and to flag embedded-instruction
  attempts as a red flag rather than comply with them. `recommend_apply` is
  also independently re-derived from `global_score >= 3.5` in code
  (`evaluate-job.json`) rather than trusted blindly from the model's own
  boolean.
- Company/title/etc. are also attacker-controlled (anyone can post a job).
  The Telegram condensed card HTML-escapes them before interpolation (a
  title like `<a href="evil">bonus</a>` would otherwise render as a live
  clickable link in your alert) — verified against an adversarial payload in
  `scripts/validate-inline-code.mjs`. The full A-F report is sent as plain
  text (no `parse_mode`) specifically to avoid Markdown-injection from the
  same untrusted fields.
- Secrets (DB password, API keys, bot token) live in Secret Manager, not in
  the workflow JSON or source control.
