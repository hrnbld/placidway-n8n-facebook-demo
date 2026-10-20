#!/usr/bin/env bash
# Usage: scripts/n8n_local.sh {install|import|start|stop|logs}   (env profile: scripts/sandbox.env or your own .env)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-scripts/sandbox.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
N8N_BIN="${N8N_BIN:-$(command -v n8n || echo "$HOME/n8n-rt/node_modules/.bin/n8n")}"
case "${1:-}" in
  install) npm install -g n8n@2.43.8 ;;   # needs Node >= 24
  import)
    python3 scripts/build_workflows.py
    for f in workflows/placidway-fb-error-handler.json workflows/placidway-fb-dashboard.json workflows/placidway-fb-daily-post.json; do
      "$N8N_BIN" import:workflow --input="$f"
    done
    "$N8N_BIN" publish:workflow --id=PwFbDailyPost001
    "$N8N_BIN" publish:workflow --id=PwFbDashboard001 ;;
  start) mkdir -p output; setsid nohup "$N8N_BIN" start > output/n8n.log 2>&1 & echo "n8n starting on :$N8N_PORT (log: output/n8n.log)";;
  stop) pkill -f "n8n start" || true ;;
  logs) tail -n 50 output/n8n.log ;;
  export)
    mkdir -p workflows/exported
    "$N8N_BIN" export:workflow --id=PwFbDailyPost001 --output=workflows/exported/placidway-fb-daily-post.json --pretty
    "$N8N_BIN" export:workflow --id=PwFbErrorHandl01 --output=workflows/exported/placidway-fb-error-handler.json --pretty
    "$N8N_BIN" export:workflow --id=PwFbDashboard001 --output=workflows/exported/placidway-fb-dashboard.json --pretty ;;
  *) echo "usage: $0 {install|import|start|stop|logs|export}"; exit 1 ;;
esac
