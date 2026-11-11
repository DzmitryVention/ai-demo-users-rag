# Infrastructure (Google Cloud, free tier)

Everything is created with idempotent `gcloud` scripts. Architecture and cost
rationale: [`specs/001-users-helpdesk/plan.md`](../specs/001-users-helpdesk/plan.md).

## Prerequisites

- `gcloud` CLI, logged in: `gcloud auth login`
- A project with billing enabled (required by Cloud Run / Compute even within free limits):
  `gcloud config set project <PROJECT_ID>`
- `python3`, `openssl`, `curl` (pre-installed on macOS/Linux)

## Deploy

```bash
./infra/deploy.sh
```

| Step | Script                    | Creates                                                                                                                          |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `scripts/01-bootstrap.sh` | APIs, Artifact Registry (+cleanup policy), 3 service accounts, IAM, Private Google Access, firewall rules                        |
| 2    | `scripts/02-firebase.sh`  | Firebase on the project, web app, `.state/firebase.env`                                                                          |
| 3    | `scripts/03-database.sh`  | DB password secret, Postgres image mirror, static internal IP, data disk, e2-micro COS VM, `DATABASE_URL` secret                 |
| 4    | `scripts/04-deploy.sh`    | Cloud Build image → `helpdesk-migrate` job (schema + 100 fake users) → `helpdesk` Cloud Run service → Firebase authorized domain |

Re-deploy code only: `./infra/scripts/04-deploy.sh`.

### Manual console steps (one time)

The CLI cannot accept the Firebase terms or create the Google OAuth client, so
`02-firebase.sh` stops with exit code 2 and prints what to do:

1. **Add Firebase to the project** (first-time accounts must accept the Firebase terms):
   <https://console.firebase.google.com/> → **Create a project** → _Add Firebase to Google Cloud project_ →
   pick the project → accept terms (Google Analytics not needed).
2. **Enable Google sign-in**: `https://console.firebase.google.com/project/<PROJECT_ID>/authentication/providers`
   → **Get started** → **Google** → **Enable** → choose a support email → **Save**.
3. Re-run `./infra/deploy.sh` (finished steps are skipped).

## Configuration

Admin emails are not stored in git. Before the first deploy:

```bash
cp infra/config.local.example.sh infra/config.local.sh   # git-ignored
# edit ADMIN_EMAILS in infra/config.local.sh
```

Override any value in `config.sh` via environment variables, e.g.

```bash
ADMIN_EMAILS="a@example.com,b@example.com" REGION=us-east1 ./infra/deploy.sh
```

## Operations

```bash
# Logs
gcloud run services logs read helpdesk --region us-central1 --limit 50

# Shell on the DB VM (IAP tunnel, no public IP)
gcloud compute ssh helpdesk-db --zone us-central1-a --tunnel-through-iap

# psql on the VM
gcloud compute ssh helpdesk-db --zone us-central1-a --tunnel-through-iap \
  --command 'docker exec -it postgres psql -U helpdesk helpdesk'

# Backup to your machine
gcloud compute ssh helpdesk-db --zone us-central1-a --tunnel-through-iap \
  --command 'docker exec postgres pg_dump -U helpdesk -Fc helpdesk' > helpdesk.dump
```

## Free-tier guard rails

- e2-micro + standard PD in `us-central1` (10 GB boot + 10 GB data ≤ 30 GB).
- No external IPs, no Cloud NAT, no Serverless VPC connector, no load balancer.
- Cloud Run scales to zero, `max-instances=3`.
- Artifact Registry cleanup keeps the 3 latest app images (< 0.5 GB).
- Old secret versions are destroyed (≤ 6 active versions).
- Set a budget alert anyway: `gcloud billing budgets create ...` (Console → Billing → Budgets).

## Teardown

```bash
./infra/teardown.sh             # keeps data disk, password and images
DELETE_DATA=1 ./infra/teardown.sh
```
