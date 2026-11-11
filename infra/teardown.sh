#!/usr/bin/env bash
# Deletes every resource created by deploy.sh. The data disk is kept unless
# DELETE_DATA=1 is set. Firebase and enabled APIs are left in place.
source "$(dirname "$0")/scripts/lib.sh"

read -r -p "Delete help desk resources in ${PROJECT_ID}? Type the project id to confirm: " answer
[[ "${answer}" == "${PROJECT_ID}" ]] || die "Aborted"

gc run services delete "${RUN_SERVICE}" --region "${REGION}" 2>/dev/null || true
gc run jobs delete "${MIGRATE_JOB}" --region "${REGION}" 2>/dev/null || true
gc compute instances delete "${DB_VM}" --zone "${ZONE}" 2>/dev/null || true
gc compute addresses delete "${DB_IP_NAME}" --region "${REGION}" 2>/dev/null || true
gc compute firewall-rules delete "${APP}-allow-postgres" "${APP}-allow-iap-ssh" 2>/dev/null || true
gc secrets delete "${SECRET_DATABASE_URL}" 2>/dev/null || true
if [[ "${DELETE_DATA:-0}" == "1" ]]; then
  gc compute disks delete "${DB_DATA_DISK}" --zone "${ZONE}" 2>/dev/null || true
  gc secrets delete "${SECRET_DB_PASSWORD}" 2>/dev/null || true
  gc artifacts repositories delete "${AR_REPO}" --location "${REGION}" 2>/dev/null || true
else
  warn "Kept data disk ${DB_DATA_DISK}, secret ${SECRET_DB_PASSWORD} and registry (DELETE_DATA=1 removes them)"
fi
ok "Teardown complete"
