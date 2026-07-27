-- Job search automation pipeline — Postgres schema (Cloud SQL)
-- Run this once against a fresh database, then load sql/seed.sql.

CREATE TABLE IF NOT EXISTS company_sources (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    ats_type    VARCHAR(20)  NOT NULL CHECK (ats_type IN ('greenhouse', 'lever', 'ashby', 'custom_json', 'yc_algolia')),
    identifier  VARCHAR(255) NOT NULL, -- board token, or endpoint path for custom_json
    active      BOOLEAN NOT NULL DEFAULT true,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ats_type, identifier)
);

CREATE TABLE IF NOT EXISTS job_evaluations (
    id                  SERIAL PRIMARY KEY,
    job_hash            VARCHAR(64) UNIQUE NOT NULL, -- sha256 of canonical URL
    url                 TEXT NOT NULL,
    company             VARCHAR(255) NOT NULL,
    title               VARCHAR(255) NOT NULL,
    location            VARCHAR(255),
    source_platform     VARCHAR(50) NOT NULL,
    archetype           VARCHAR(100),

    -- career-ops Blocks A-F (each 1.0-5.0)
    match_cv_score      NUMERIC(2,1),
    north_star_score    NUMERIC(2,1),
    comp_score          NUMERIC(2,1),
    cultural_score      NUMERIC(2,1),
    red_flags_score     NUMERIC(2,1),
    global_score        NUMERIC(2,1) NOT NULL,

    -- career-ops Block G (qualitative, does not affect global_score)
    posting_legitimacy  VARCHAR(30), -- 'high_confidence' | 'proceed_with_caution' | 'suspicious'

    recommend_apply     BOOLEAN NOT NULL, -- global_score >= 3.5
    full_report_md      TEXT NOT NULL,    -- career-ops-style A-F/G markdown report
    full_report_json    JSONB NOT NULL,   -- raw structured evaluation from Claude
    telegram_sent       BOOLEAN NOT NULL DEFAULT false,

    raw_description     TEXT,
    evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_evaluations_score ON job_evaluations(global_score);
CREATE INDEX IF NOT EXISTS idx_job_evaluations_evaluated_at ON job_evaluations(evaluated_at);

-- User-pasted URLs (Handshake, or anything else) awaiting the next 6h run.
CREATE TABLE IF NOT EXISTS manual_inbox (
    id          SERIAL PRIMARY KEY,
    url         TEXT NOT NULL,
    note        TEXT,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed   BOOLEAN NOT NULL DEFAULT false
);

-- Per-run audit: which ingestion sources succeeded/failed, so silent
-- breakage of a source is visible instead of just quietly losing coverage.
CREATE TABLE IF NOT EXISTS run_log (
    id              SERIAL PRIMARY KEY,
    run_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          VARCHAR(50) NOT NULL,
    ok              BOOLEAN NOT NULL,
    jobs_fetched    INTEGER,
    error           TEXT
);
