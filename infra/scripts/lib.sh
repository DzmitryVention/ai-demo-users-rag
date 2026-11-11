# shellcheck shell=bash
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${INFRA_DIR}/.." && pwd)"
# shellcheck source=../config.sh
source "${INFRA_DIR}/config.sh"

log()  { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ -n "${PROJECT_ID}" ]] || die "PROJECT_ID is not set (gcloud config set project <id>)"
command -v gcloud >/dev/null || die "gcloud CLI is required"

gc() { gcloud --project "${PROJECT_ID}" --quiet "$@"; }

# Authenticated call to a Google REST API (for things gcloud has no command for).
gapi() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS -X "${method}" -H "Authorization: Bearer $(gcloud auth print-access-token)"
    -H "x-goog-user-project: ${PROJECT_ID}" -H "Content-Type: application/json")
  [[ -n "${body}" ]] && args+=(-d "${body}")
  curl "${args[@]}" "${url}"
}

# Read a (nested) field from JSON on stdin: `json_get config apiKey`. Prints "" if absent.
json_get() {
  python3 -c '
import json, sys
d = json.load(sys.stdin)
for k in sys.argv[1:]:
    d = d[int(k)] if isinstance(d, list) else (d or {}).get(k)
print("" if d is None else d)' "$@"
}

secret_exists() { gc secrets describe "$1" >/dev/null 2>&1; }

# Creates the secret if missing and adds a new version only when the value changed.
secret_put() {
  local name="$1" value="$2"
  if ! secret_exists "${name}"; then
    gc secrets create "${name}" --replication-policy=automatic >/dev/null
  else
    local current
    current="$(gc secrets versions access latest --secret "${name}" 2>/dev/null || true)"
    [[ "${current}" == "${value}" ]] && return 0
  fi
  printf '%s' "${value}" | gc secrets versions add "${name}" --data-file=- >/dev/null
  # Free tier = 6 active (enabled or disabled) versions: destroy superseded ones.
  gc secrets versions list "${name}" --filter='state!=DESTROYED' --sort-by='~createTime' \
    --format='value(name)' | tail -n +2 | while read -r v; do
      gc secrets versions destroy "${v##*/}" --secret "${name}" >/dev/null
    done
}
