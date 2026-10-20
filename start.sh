#!/bin/zsh
# Start the PlacidWay demo n8n on this Mac: http://localhost:5678
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
set -a; source ./.env; set +a
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false N8N_USER_FOLDER="$HOME/.n8n-placidway" N8N_CONCURRENCY_PRODUCTION_LIMIT=1 N8N_SECURE_COOKIE=false
N8N="$HOME/n8n-rt/node_modules/.bin/n8n"
if [ ! -f "$N8N_USER_FOLDER/.imported" ]; then
  python3 scripts/build_workflows.py >/dev/null 2>&1 || true
  for f in workflows/exported/placidway-fb-error-handler.json workflows/exported/placidway-fb-dashboard.json workflows/exported/placidway-fb-daily-post.json; do "$N8N" import:workflow --input="$f"; done
  mkdir -p "$N8N_USER_FOLDER"; touch "$N8N_USER_FOLDER/.imported"
fi
exec "$N8N" start
