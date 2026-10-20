#!/usr/bin/env bash
# Generate the 3 required sample posts (article, package, patient Q&A) with a REAL LLM, in DRY RUN mode.
#   1. cp .env.example .env  and set LLM_PROVIDER / LLM_API_KEY / LLM_MODEL
#   2. scripts/generate_samples.sh            (reads live placidway.com)
#      SOURCE=replay scripts/generate_samples.sh   (if your network gets the Cloudflare challenge: uses the replay mirror)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Create .env first (cp .env.example .env) and set LLM_API_KEY"; exit 1; }
set -a; source .env; set +a
export DRY_RUN=true APPROVAL_MODE=false N8N_USER_FOLDER="$HOME/.n8n-placidway-samples" N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
if [ "${SOURCE:-live}" = "replay" ]; then
  export PW_BASE_URL=http://127.0.0.1:8787
  (python3 tools/sandbox_services.py > output/sandbox_services.log 2>&1 &) ; sleep 1
fi
N8N_BIN="${N8N_BIN:-$(command -v n8n)}"
rm -rf "$N8N_USER_FOLDER"; mkdir -p output/runs
python3 scripts/build_workflows.py
for f in workflows/placidway-fb-error-handler.json workflows/placidway-fb-dashboard.json workflows/placidway-fb-daily-post.json; do "$N8N_BIN" import:workflow --input="$f"; done
"$N8N_BIN" publish:workflow --id=PwFbDailyPost001; "$N8N_BIN" publish:workflow --id=PwFbDashboard001
("$N8N_BIN" start > output/n8n-samples.log 2>&1 &) ; sleep 25
for t in article package answer; do python3 tools/trigger_run.py type=$t; done
python3 tools/make_samples.py
pkill -f "n8n start" || true
