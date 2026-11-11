#!/usr/bin/env bash
# Firebase project + web app; writes the public web config to .state/firebase.env.
source "$(dirname "$0")/lib.sh"

FB="https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}"

log "Firebase project"
if [[ -z "$(gapi GET "${FB}" | json_get projectId)" ]]; then
  op="$(gapi POST "${FB}:addFirebase" '{}')"
  op_name="$(json_get name <<<"${op}")"
  if [[ -z "${op_name}" ]]; then
    warn "addFirebase failed: $(json_get error message <<<"${op}")"
    warn "First-time Firebase use requires accepting the Firebase terms in the console:"
    warn "  https://console.firebase.google.com/  → Create a project → 'Add Firebase to Google Cloud project'"
    warn "  → pick ${PROJECT_ID} → accept terms (Analytics not needed). Then re-run this script."
    exit 2
  fi
  for _ in $(seq 1 30); do
    [[ "$(gapi GET "https://firebase.googleapis.com/v1beta1/${op_name}" | json_get done)" == "True" ]] && break
    sleep 4
  done
fi
ok "Firebase enabled on ${PROJECT_ID}"

log "Firebase web app"
APP_ID="$(gapi GET "${FB}/webApps" | json_get apps 0 appId 2>/dev/null || true)"
if [[ -z "${APP_ID}" ]]; then
  op="$(gapi POST "${FB}/webApps" '{"displayName":"Help desk"}')"
  op_name="$(json_get name <<<"${op}")"
  for _ in $(seq 1 30); do
    res="$(gapi GET "https://firebase.googleapis.com/v1beta1/${op_name}")"
    [[ "$(json_get done <<<"${res}")" == "True" ]] && break
    sleep 3
  done
  APP_ID="$(gapi GET "${FB}/webApps" | json_get apps 0 appId)"
fi
[[ -n "${APP_ID}" ]] || die "Could not create a Firebase web app"

CONFIG="$(gapi GET "${FB}/webApps/${APP_ID}/config")"
cat >"${STATE_DIR}/firebase.env" <<EOF
FIREBASE_PROJECT_ID=$(json_get projectId <<<"${CONFIG}")
FIREBASE_API_KEY=$(json_get apiKey <<<"${CONFIG}")
FIREBASE_AUTH_DOMAIN=$(json_get authDomain <<<"${CONFIG}")
FIREBASE_APP_ID=$(json_get appId <<<"${CONFIG}")
EOF
ok "Web config saved to infra/.state/firebase.env"

log "Checking the Google sign-in provider"
IDP="$(gapi GET "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com")"
if [[ "$(json_get enabled <<<"${IDP}")" != "True" ]]; then
  warn "Google sign-in is not enabled yet. One-time manual step (the CLI cannot create the OAuth client):"
  warn "  https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
  warn "  → Get started → Google → Enable → set support email → Save. Then re-run this script."
  exit 2
fi
ok "Google sign-in provider enabled"
