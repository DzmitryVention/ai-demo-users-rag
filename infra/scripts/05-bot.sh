#!/usr/bin/env bash
# Feature 002 — AI assistant infrastructure: Gemini API key, Cloud Tasks queue and
# service accounts. Idempotent. Run before 04-deploy.sh (deploy.sh does that).
source "$(dirname "$0")/lib.sh"

PROJECT_NUMBER="$(gc projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

log "Enabling APIs (Gemini, Cloud Tasks, API keys)"
gc services enable generativelanguage.googleapis.com cloudtasks.googleapis.com apikeys.googleapis.com
ok "APIs enabled"

log "Gemini API key → Secret Manager"
# The key lives in this billing-enabled project, so requests use the paid tier
# (prompts are not used to improve Google products — spec 002 D-AI).
if ! secret_exists "${SECRET_GEMINI_API_KEY}"; then
  KEY_NAME="$(gc services api-keys list --filter="displayName=${APP}-gemini" --format='value(name)' | head -n1)"
  if [[ -z "${KEY_NAME}" ]]; then
    gc services api-keys create --display-name "${APP}-gemini" \
      --api-target=service=generativelanguage.googleapis.com >/dev/null
    KEY_NAME="$(gc services api-keys list --filter="displayName=${APP}-gemini" --format='value(name)' | head -n1)"
  fi
  [[ -n "${KEY_NAME}" ]] || die "Could not create the Gemini API key"
  # Read the key and store it directly; it is never printed or written to disk.
  secret_put "${SECRET_GEMINI_API_KEY}" "$(gc services api-keys get-key-string "${KEY_NAME}" --format='value(keyString)')"
fi
gc secrets add-iam-policy-binding "${SECRET_GEMINI_API_KEY}" \
  --member "serviceAccount:${RUN_SA}" --role roles/secretmanager.secretAccessor >/dev/null
ok "Secret ${SECRET_GEMINI_API_KEY} ready (restricted to the Gemini API)"

log "Cloud Tasks service account and queue"
gc iam service-accounts describe "${TASKS_SA}" >/dev/null 2>&1 ||
  gc iam service-accounts create "${APP}-tasks" --display-name "Help desk Cloud Tasks caller"

if ! gc tasks queues describe "${TASKS_QUEUE}" --location "${REGION}" >/dev/null 2>&1; then
  gc tasks queues create "${TASKS_QUEUE}" --location "${REGION}" \
    --max-concurrent-dispatches 2 --max-dispatches-per-second 1 \
    --max-attempts 3 --min-backoff 10s --max-backoff 120s
fi

# The API (running as RUN_SA) creates tasks whose OIDC token is minted for TASKS_SA.
gc tasks queues add-iam-policy-binding "${TASKS_QUEUE}" --location "${REGION}" \
  --member "serviceAccount:${RUN_SA}" --role roles/cloudtasks.enqueuer >/dev/null
gc iam service-accounts add-iam-policy-binding "${TASKS_SA}" \
  --member "serviceAccount:${RUN_SA}" --role roles/iam.serviceAccountUser >/dev/null
# The Cloud Tasks service agent signs the OIDC tokens.
gc beta services identity create --service=cloudtasks.googleapis.com >/dev/null 2>&1 || true
gc iam service-accounts add-iam-policy-binding "${TASKS_SA}" \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountOpenIdTokenCreator >/dev/null
ok "Queue ${TASKS_QUEUE} ready"

warn "Recommended one-time step: set a \$20 monthly spend cap for the Gemini API in Google AI Studio"
warn "  (aistudio.google.com → Spend → Monthly spend cap). The app also stops itself at \$18."
