#!/usr/bin/env bash
# PostgreSQL on an always-free e2-micro VM (no external IP). Idempotent.
source "$(dirname "$0")/lib.sh"

log "Database password secret"
if ! secret_exists "${SECRET_DB_PASSWORD}"; then
  secret_put "${SECRET_DB_PASSWORD}" "$(openssl rand -hex 24)"
fi
gc secrets add-iam-policy-binding "${SECRET_DB_PASSWORD}" \
  --member "serviceAccount:${DB_SA}" --role roles/secretmanager.secretAccessor >/dev/null
ok "Secret ${SECRET_DB_PASSWORD} ready"

log "Building PostgreSQL ${POSTGRES_VERSION} + pgvector ${PGVECTOR_VERSION} image"
if ! gc artifacts docker images describe "${POSTGRES_IMAGE}" >/dev/null 2>&1; then
  gc builds submit "${INFRA_DIR}/db-vm" --region "${REGION}" \
    --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
    --config "${INFRA_DIR}/cloudbuild.postgres.yaml" \
    --substitutions "_TARGET=${POSTGRES_IMAGE},_PGVECTOR_VERSION=${PGVECTOR_VERSION}"
fi
ok "Image ${POSTGRES_IMAGE}"

log "Static internal IP"
if ! gc compute addresses describe "${DB_IP_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  gc compute addresses create "${DB_IP_NAME}" --region "${REGION}" --subnet "${SUBNET}"
fi
DB_IP="$(gc compute addresses describe "${DB_IP_NAME}" --region "${REGION}" --format='value(address)')"
ok "DB internal IP ${DB_IP}"

log "Persistent data disk"
if ! gc compute disks describe "${DB_DATA_DISK}" --zone "${ZONE}" >/dev/null 2>&1; then
  # 10 GB boot + 10 GB data = 20 GB of the 30 GB free standard PD.
  gc compute disks create "${DB_DATA_DISK}" --zone "${ZONE}" --size 10GB --type pd-standard
fi

log "VM ${DB_VM}"
USER_DATA="${STATE_DIR}/cloud-init.yaml"
sed -e "s#__POSTGRES_IMAGE__#${POSTGRES_IMAGE}#g" \
  -e "s#__REGISTRY_HOST__#${REGION}-docker.pkg.dev#g" \
  -e "s#__DB_USER__#${DB_USER}#g" \
  -e "s#__DB_NAME__#${DB_NAME}#g" \
  -e "s#__SECRET__#${SECRET_DB_PASSWORD}#g" \
  "${INFRA_DIR}/db-vm/cloud-init.yaml" >"${USER_DATA}"

if ! gc compute instances describe "${DB_VM}" --zone "${ZONE}" >/dev/null 2>&1; then
  gc compute instances create "${DB_VM}" \
    --zone "${ZONE}" \
    --machine-type e2-micro \
    --image-family cos-stable --image-project cos-cloud \
    --boot-disk-size 10GB --boot-disk-type pd-standard \
    --disk "name=${DB_DATA_DISK},device-name=data,mode=rw,auto-delete=no" \
    --network-interface "subnet=${SUBNET},private-network-ip=${DB_IP},no-address" \
    --service-account "${DB_SA}" --scopes cloud-platform \
    --tags "${DB_VM}" \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata-from-file "user-data=${USER_DATA}" \
    --metadata "google-logging-enabled=true,google-monitoring-enabled=true,enable-oslogin=true"
else
  CURRENT="$(gc compute instances describe "${DB_VM}" --zone "${ZONE}" \
    --format='value(metadata.items.user-data)')"
  if [[ "${CURRENT}" != "$(cat "${USER_DATA}")" ]]; then
    gc compute instances add-metadata "${DB_VM}" --zone "${ZONE}" \
      --metadata-from-file "user-data=${USER_DATA}" >/dev/null
    # cloud-init applies user-data at boot. The data disk is kept; the container is
    # re-created from the new image (same Postgres major and libc).
    warn "DB VM configuration changed — restarting ${DB_VM} (about 1 minute of DB downtime)"
    # stop/start (not reset) so Postgres shuts down cleanly.
    gc compute instances stop "${DB_VM}" --zone "${ZONE}" >/dev/null
    gc compute instances start "${DB_VM}" --zone "${ZONE}" >/dev/null
    log "Waiting for PostgreSQL to accept connections"
    for _ in $(seq 1 40); do
      if gc compute instances get-serial-port-output "${DB_VM}" --zone "${ZONE}" 2>/dev/null |
        grep -q "Started postgres.service"; then break; fi
      sleep 6
    done
    sleep 20 # give the container time to finish starting the database
  else
    ok "VM configuration unchanged"
  fi
fi
ok "VM ${DB_VM} running"

log "DATABASE_URL secret for Cloud Run"
DB_PASSWORD="$(gc secrets versions access latest --secret "${SECRET_DB_PASSWORD}")"
secret_put "${SECRET_DATABASE_URL}" "postgres://${DB_USER}:${DB_PASSWORD}@${DB_IP}:5432/${DB_NAME}"
gc secrets add-iam-policy-binding "${SECRET_DATABASE_URL}" \
  --member "serviceAccount:${RUN_SA}" --role roles/secretmanager.secretAccessor >/dev/null
ok "Secret ${SECRET_DATABASE_URL} ready"
