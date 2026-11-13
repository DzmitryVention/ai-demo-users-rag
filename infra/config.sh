# Shared configuration for all infra scripts. Override any value via env vars.
# shellcheck shell=bash

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
# us-central1 / us-west1 / us-east1 are the only regions with an always-free e2-micro.
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-${REGION}-a}"
NETWORK="${NETWORK:-default}"
SUBNET="${SUBNET:-default}"

APP="${APP:-helpdesk}"
AR_REPO="${AR_REPO:-${APP}}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
APP_IMAGE="${REGISTRY}/app"
POSTGRES_VERSION="${POSTGRES_VERSION:-18}"
PGVECTOR_VERSION="${PGVECTOR_VERSION:-v0.8.7}"
# Postgres + pgvector, built on the same Alpine base (feature 002, plan D7).
POSTGRES_IMAGE="${REGISTRY}/postgres-pgvector:${POSTGRES_VERSION}-${PGVECTOR_VERSION}"

RUN_SERVICE="${RUN_SERVICE:-${APP}}"
MIGRATE_JOB="${MIGRATE_JOB:-${APP}-migrate}"
DB_VM="${DB_VM:-${APP}-db}"
DB_IP_NAME="${DB_IP_NAME:-${APP}-db-ip}"
DB_DATA_DISK="${DB_DATA_DISK:-${APP}-db-data}"
DB_NAME="${DB_NAME:-helpdesk}"
DB_USER="${DB_USER:-helpdesk}"

RUN_SA="${APP}-run@${PROJECT_ID}.iam.gserviceaccount.com"
DB_SA="${APP}-db@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="${APP}-build@${PROJECT_ID}.iam.gserviceaccount.com"

SECRET_DB_PASSWORD="${APP}-db-password"
SECRET_DATABASE_URL="${APP}-database-url"
SECRET_GEMINI_API_KEY="${APP}-gemini-api-key"

# Feature 002: AI assistant
TASKS_QUEUE="${TASKS_QUEUE:-${APP}-bot}"
TASKS_SA="${APP}-tasks@${PROJECT_ID}.iam.gserviceaccount.com"
SETUP_JOB="${SETUP_JOB:-${APP}-bot-setup}"
# Set by the first bot setup run only (later changes are made by admins in the UI).
BOT_INITIAL_MODE="${BOT_INITIAL_MODE:-live}"

# Local, git-ignored overrides (e.g. ADMIN_EMAILS). See config.local.example.sh.
_LOCAL_CONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.local.sh"
# shellcheck source=/dev/null
[[ -f "${_LOCAL_CONFIG}" ]] && source "${_LOCAL_CONFIG}"

# Comma-separated admin emails. Required for deploy; keep real addresses out of git.
ADMIN_EMAILS="${ADMIN_EMAILS:-}"

STATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.state"
mkdir -p "${STATE_DIR}"
