#!/usr/bin/env bash
# APIs, Artifact Registry, service accounts, IAM and network. Idempotent.
source "$(dirname "$0")/lib.sh"

log "Project ${PROJECT_ID} · region ${REGION}"

log "Enabling APIs"
gc services enable \
  run.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  firebase.googleapis.com \
  identitytoolkit.googleapis.com \
  apikeys.googleapis.com
ok "APIs enabled"

log "Artifact Registry repository ${AR_REPO}"
if ! gc artifacts repositories describe "${AR_REPO}" --location "${REGION}" >/dev/null 2>&1; then
  gc artifacts repositories create "${AR_REPO}" --location "${REGION}" \
    --repository-format docker --description "Help desk images"
fi
# Stay inside the 0.5 GB free storage: keep only the 3 most recent app images.
cat >"${STATE_DIR}/ar-cleanup.json" <<'JSON'
[
  { "name": "keep-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "packageNamePrefixes": ["app"], "keepCount": 3 } },
  { "name": "keep-postgres", "action": { "type": "Keep" }, "condition": { "packageNamePrefixes": ["postgres"] } },
  { "name": "delete-old", "action": { "type": "Delete" }, "condition": { "tagState": "ANY", "olderThan": "1d" } }
]
JSON
gc artifacts repositories set-cleanup-policies "${AR_REPO}" --location "${REGION}" \
  --policy "${STATE_DIR}/ar-cleanup.json" --no-dry-run >/dev/null
ok "Artifact Registry ready: ${REGISTRY}"

create_sa() {
  local id="$1" display="$2"
  gc iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    gc iam service-accounts create "${id}" --display-name "${display}"
}
grant() {
  gc projects add-iam-policy-binding "${PROJECT_ID}" --member "serviceAccount:$1" --role "$2" \
    --condition=None >/dev/null
}

log "Service accounts (least privilege)"
create_sa "${APP}-run" "Help desk Cloud Run runtime"
create_sa "${APP}-db" "Help desk PostgreSQL VM"
create_sa "${APP}-build" "Help desk Cloud Build"

grant "${RUN_SA}" roles/logging.logWriter
grant "${RUN_SA}" roles/cloudtrace.agent

grant "${DB_SA}" roles/logging.logWriter
grant "${DB_SA}" roles/monitoring.metricWriter
grant "${DB_SA}" roles/artifactregistry.reader

grant "${BUILD_SA}" roles/logging.logWriter
grant "${BUILD_SA}" roles/artifactregistry.writer
grant "${BUILD_SA}" roles/storage.objectViewer
ok "Service accounts configured"

log "Network: Private Google Access + firewall"
# Lets the DB VM (no external IP) reach Artifact Registry and Secret Manager.
gc compute networks subnets update "${SUBNET}" --region "${REGION}" \
  --enable-private-ip-google-access >/dev/null
SUBNET_RANGE="$(gc compute networks subnets describe "${SUBNET}" --region "${REGION}" \
  --format='value(ipCidrRange)')"

if ! gc compute firewall-rules describe "${APP}-allow-postgres" >/dev/null 2>&1; then
  gc compute firewall-rules create "${APP}-allow-postgres" --network "${NETWORK}" \
    --direction INGRESS --action ALLOW --rules tcp:5432 \
    --source-ranges "${SUBNET_RANGE}" --target-tags "${DB_VM}" \
    --description "PostgreSQL from Cloud Run Direct VPC egress (same subnet) only"
fi
if ! gc compute firewall-rules describe "${APP}-allow-iap-ssh" >/dev/null 2>&1; then
  gc compute firewall-rules create "${APP}-allow-iap-ssh" --network "${NETWORK}" \
    --direction INGRESS --action ALLOW --rules tcp:22 \
    --source-ranges 35.235.240.0/20 --target-tags "${DB_VM}" \
    --description "SSH to the DB VM through IAP only (gcloud compute ssh --tunnel-through-iap)"
fi
ok "Network ready (subnet ${SUBNET_RANGE})"
