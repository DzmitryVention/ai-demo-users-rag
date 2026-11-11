#!/usr/bin/env bash
# Build → migrate (Cloud Run job) → deploy (Cloud Run service). Safe to re-run.
source "$(dirname "$0")/lib.sh"

[[ -f "${STATE_DIR}/firebase.env" ]] || die "Run 02-firebase.sh first"
[[ -n "${ADMIN_EMAILS}" ]] || die "ADMIN_EMAILS is empty: set it in infra/config.local.sh or the environment"
# shellcheck disable=SC1091
source "${STATE_DIR}/firebase.env"

TAG="${TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo manual)-$(date +%Y%m%d%H%M%S)}"
IMAGE="${APP_IMAGE}:${TAG}"

log "Building ${IMAGE} with Cloud Build"
gc builds submit "${ROOT_DIR}" --region "${REGION}" \
  --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --config "${INFRA_DIR}/cloudbuild.yaml" \
  --substitutions "_IMAGE=${APP_IMAGE},_TAG=${TAG}"
ok "Image built"

# Shared flags: Direct VPC egress (no Serverless VPC connector → no extra cost).
VPC_FLAGS=(--network "${NETWORK}" --subnet "${SUBNET}" --vpc-egress private-ranges-only)

log "Running database migrations (job ${MIGRATE_JOB})"
gc run jobs deploy "${MIGRATE_JOB}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --command node --args apps/api/dist/migrate.js \
  --service-account "${RUN_SA}" \
  --set-secrets "DATABASE_URL=${SECRET_DATABASE_URL}:latest" \
  --cpu 1 --memory 512Mi --task-timeout 300s --max-retries 3 \
  "${VPC_FLAGS[@]}"
gc run jobs execute "${MIGRATE_JOB}" --region "${REGION}" --wait
ok "Migrations applied"

log "Deploying Cloud Run service ${RUN_SERVICE}"
# '^|^' switches the env-var delimiter so ADMIN_EMAILS may contain commas.
ENV_VARS="^|^NODE_ENV=production|LOG_LEVEL=info|DB_POOL_MAX=5"
ENV_VARS+="|ADMIN_EMAILS=${ADMIN_EMAILS}"
ENV_VARS+="|FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}|FIREBASE_API_KEY=${FIREBASE_API_KEY}"
ENV_VARS+="|FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}|FIREBASE_APP_ID=${FIREBASE_APP_ID}"

gc run deploy "${RUN_SERVICE}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --service-account "${RUN_SA}" \
  --set-env-vars "${ENV_VARS}" \
  --set-secrets "DATABASE_URL=${SECRET_DATABASE_URL}:latest" \
  --execution-environment gen2 \
  --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 3 --concurrency 80 \
  --timeout 30s \
  --startup-probe "httpGet.path=/api/health,initialDelaySeconds=0,periodSeconds=3,failureThreshold=10" \
  --no-invoker-iam-check \
  "${VPC_FLAGS[@]}"

URL="$(gc run services describe "${RUN_SERVICE}" --region "${REGION}" --format='value(status.url)')"
ok "Deployed: ${URL}"

log "Authorizing ${URL#https://} for Firebase sign-in"
IT="https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config"
DOMAINS="$(gapi GET "${IT}" | python3 -c '
import json, sys
host = sys.argv[1]
domains = json.load(sys.stdin).get("authorizedDomains", [])
if host not in domains: domains.append(host)
print(json.dumps({"authorizedDomains": domains}))' "${URL#https://}")"
gapi PATCH "${IT}?updateMask=authorizedDomains" "${DOMAINS}" >/dev/null
ok "Authorized domains updated"

log "Smoke test"
curl -sf "${URL}/api/health" && echo
printf '\n\033[1;32mOpen %s\033[0m\n' "${URL}"
