#!/usr/bin/env bash
# One-command deployment: ./infra/deploy.sh   (each step is idempotent)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/scripts" && pwd)"

bash "${DIR}/01-bootstrap.sh"
bash "${DIR}/02-firebase.sh"
bash "${DIR}/03-database.sh"
bash "${DIR}/04-deploy.sh"
