#!/usr/bin/env bash
# Provisions the GCP infrastructure for the job search pipeline:
# Cloud SQL (Postgres) + Secret Manager + Cloud Run (n8n) + Cloud Scheduler
# (the actual 6-hour trigger — NOT n8n's internal Schedule Trigger, which
# can't reliably fire on a scale-to-zero Cloud Run container).
#
# Run from Cloud Shell or any shell with gcloud authenticated.
# Fill in the variables below before running.
set -euo pipefail

# Resolve paths relative to this script's own location, not the caller's
# cwd — the script is meant to be runnable as `bash deploy/setup-gcp.sh`
# from the repo root just as well as `cd deploy && bash setup-gcp.sh`.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- Required: set these before running ----
export GCP_PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export DB_PASSWORD="change-me-to-a-real-generated-password"
export ANTHROPIC_API_KEY="sk-ant-..."
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
export ADZUNA_APP_ID="..."
export ADZUNA_APP_KEY="..."

gcloud config set project "$GCP_PROJECT_ID"

echo "== Enabling required APIs =="
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com

echo "== Provisioning Cloud SQL (Postgres) =="
if gcloud sql instances describe job-pipeline-db >/dev/null 2>&1; then
  echo "(instance job-pipeline-db already exists, skipping create)"
else
  gcloud sql instances create job-pipeline-db \
    --database-version=POSTGRES_15 \
    --region="$REGION" \
    --tier=db-custom-1-3840
fi

gcloud sql users set-password postgres \
  --instance=job-pipeline-db \
  --password="$DB_PASSWORD"

gcloud sql databases create job_pipeline --instance=job-pipeline-db || true

echo "== Loading schema + seed data =="
DB_CONNECTION_NAME=$(gcloud sql instances describe job-pipeline-db --format="value(connectionName)")
# Requires the Cloud SQL Auth Proxy running locally, or run this from Cloud
# Shell which has it available. See https://cloud.google.com/sql/docs/postgres/connect-auth-proxy
echo "Connect via: cloud-sql-proxy $DB_CONNECTION_NAME"
echo "Then: psql -h 127.0.0.1 -U postgres -d job_pipeline -f $REPO_ROOT/sql/schema.sql"
echo "      psql -h 127.0.0.1 -U postgres -d job_pipeline -f $REPO_ROOT/sql/seed.sql"

echo "== Storing secrets in Secret Manager =="
create_or_update_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    echo -n "$value" | gcloud secrets versions add "$name" --data-file=-
  else
    echo -n "$value" | gcloud secrets create "$name" --data-file=-
  fi
}
create_or_update_secret db-password "$DB_PASSWORD"
create_or_update_secret anthropic-api-key "$ANTHROPIC_API_KEY"
create_or_update_secret telegram-bot-token "$TELEGRAM_BOT_TOKEN"
create_or_update_secret telegram-chat-id "$TELEGRAM_CHAT_ID"
create_or_update_secret adzuna-app-id "$ADZUNA_APP_ID"
create_or_update_secret adzuna-app-key "$ADZUNA_APP_KEY"

echo "== Building the evaluation system prompt from the real profile.yml =="
# profile.yml lives on your local machine (career-ops/config/profile.yml) —
# it is NOT part of this repo and does not exist on Cloud Shell by default.
# Upload it first: in Cloud Shell, click the "⋮" menu -> Upload, pick your
# local profile.yml, then set PROFILE_YML_PATH to wherever it landed
# (typically $HOME/profile.yml) before running this script, e.g.:
#   PROFILE_YML_PATH=$HOME/profile.yml bash deploy/setup-gcp.sh
PROFILE_PATH="${PROFILE_YML_PATH:-$HOME/profile.yml}"
if [ ! -f "$PROFILE_PATH" ]; then
  echo "ERROR: profile.yml not found at $PROFILE_PATH" >&2
  echo "Upload your career-ops/config/profile.yml to Cloud Shell (⋮ menu -> Upload file)," >&2
  echo "then re-run with: PROFILE_YML_PATH=/path/to/uploaded/profile.yml bash deploy/setup-gcp.sh" >&2
  exit 1
fi
(cd "$REPO_ROOT" && npm install --no-audit --no-fund >/dev/null)
node "$REPO_ROOT/prompts/build-prompt.mjs" "$PROFILE_PATH" > /tmp/system_prompt.txt
create_or_update_secret eval-system-prompt "$(cat /tmp/system_prompt.txt)"

echo "== Deploying n8n to Cloud Run =="
gcloud run deploy job-pipeline-n8n \
  --image=docker.io/n8nio/n8n:latest \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --port=5678 \
  --add-cloudsql-instances="$DB_CONNECTION_NAME" \
  --set-env-vars="DB_TYPE=postgresdb,DB_POSTGRESDB_HOST=/cloudsql/$DB_CONNECTION_NAME,DB_POSTGRESDB_DATABASE=job_pipeline,DB_POSTGRESDB_USER=postgres,DB_POSTGRESDB_PORT=5432" \
  --set-secrets="DB_POSTGRESDB_PASSWORD=db-password:latest,EVAL_SYSTEM_PROMPT=eval-system-prompt:latest"

N8N_URL=$(gcloud run services describe job-pipeline-n8n --region="$REGION" --format="value(status.url)")
echo "n8n deployed at: $N8N_URL (import n8n/workflows/*.json via the n8n UI, then set up Postgres/Telegram/Anthropic/Adzuna credentials pointing at the secrets above)"

echo "== Creating the Cloud Scheduler job (the actual 6-hour trigger) =="
# The Cloud Run service requires auth (--no-allow-unauthenticated above), so
# Scheduler authenticates via OIDC using a dedicated service account with
# run.invoker on this service — nobody else can trigger your pipeline.
gcloud iam service-accounts create job-pipeline-scheduler \
  --display-name="Job Pipeline Scheduler Invoker" || true

gcloud run services add-iam-policy-binding job-pipeline-n8n \
  --region="$REGION" \
  --member="serviceAccount:job-pipeline-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

gcloud scheduler jobs create http job-pipeline-6h \
  --location="$REGION" \
  --schedule="0 */6 * * *" \
  --uri="$N8N_URL/webhook/run-job-pipeline" \
  --http-method=POST \
  --oidc-service-account-email="job-pipeline-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --oidc-token-audience="$N8N_URL" || echo "(job may already exist — use 'gcloud scheduler jobs update http' to change it)"

echo ""
echo "Done. Remaining manual steps (see README.md):"
echo "  1. Load $REPO_ROOT/sql/schema.sql and sql/seed.sql into the Cloud SQL database."
echo "  2. Open the n8n UI at $N8N_URL, import $REPO_ROOT/n8n/workflows/*.json."
echo "  3. Create n8n credentials: Postgres, Anthropic API (HTTP header auth), Telegram, Adzuna."
echo "  4. Activate the workflows."
echo "  5. Manually trigger a Cloud Scheduler run once to confirm end-to-end delivery:"
echo "     gcloud scheduler jobs run job-pipeline-6h --location=$REGION"
