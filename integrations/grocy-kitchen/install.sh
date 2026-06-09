#!/usr/bin/env bash
# ============================================================================
# Grocy Kitchen — overlay installer for a *stock* Oikos Docker deployment
# ============================================================================
# Installs the Grocy-backed Kitchen integration onto an existing Oikos stack
# that runs the prebuilt image (no rebuild needed). It:
#
#   1. copies the Grocy proxy route + 3 patched core files into  <stack>/custom/
#   2. copies the grocy-kitchen module into                      <stack>/modules/
#   3. writes  docker-compose.override.yml  with the bind-mounts
#   4. appends GROCY_URL / GROCY_API_KEY to .env if missing
#   5. restarts the stack
#
# Run it FROM A CHECKOUT OF THIS REPO (branch feat/grocy-kitchen):
#
#   git clone -b feat/grocy-kitchen https://github.com/joshuawowk/oikos
#   cd oikos/integrations/grocy-kitchen
#   ./install.sh /docker/oikos
#
# NOTE on versions: the pre-patched core files (server/index.js, public/router.js,
# public/utils/kitchen-tabs.js) in this repo correspond to the upstream commit this
# branch is based on. If your Oikos image is much newer, prefer applying the diffs
# in ./patches/ to your image's own files instead (see README, "Method C").
# ============================================================================
set -euo pipefail

STACK_DIR="${1:-}"
[ -n "$STACK_DIR" ] || { echo "Usage: $0 /path/to/oikos-stack-dir (the dir with docker-compose.yml)"; exit 1; }
[ -d "$STACK_DIR" ] || { echo "ERROR: $STACK_DIR does not exist"; exit 1; }
[ -f "$STACK_DIR/docker-compose.yml" ] || echo "WARN: no docker-compose.yml in $STACK_DIR — continuing anyway"

# Resolve repo root relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

for f in server/routes/grocy.js server/index.js public/router.js public/utils/kitchen-tabs.js modules/grocy-kitchen/module.json; do
  [ -f "$REPO_ROOT/$f" ] || { echo "ERROR: $REPO_ROOT/$f missing — run from a checkout of the feat/grocy-kitchen branch"; exit 1; }
done

TS="$(date +%Y%m%d-%H%M%S)"

# ── 1. custom/ overlay files ────────────────────────────────────────────────
mkdir -p "$STACK_DIR/custom"
for f in custom/grocy.js custom/index.js custom/router.js custom/kitchen-tabs.js; do
  [ -f "$STACK_DIR/$f" ] && cp "$STACK_DIR/$f" "$STACK_DIR/$f.bak.$TS"
done
cp "$REPO_ROOT/server/routes/grocy.js"           "$STACK_DIR/custom/grocy.js"
cp "$REPO_ROOT/server/index.js"                  "$STACK_DIR/custom/index.js"
cp "$REPO_ROOT/public/router.js"                 "$STACK_DIR/custom/router.js"
cp "$REPO_ROOT/public/utils/kitchen-tabs.js"     "$STACK_DIR/custom/kitchen-tabs.js"
echo "✓ custom/ overlay files installed"

# ── 2. module ───────────────────────────────────────────────────────────────
# Keep backups OUTSIDE modules/ — Oikos scans every subfolder of modules/ and a
# *.bak folder there shows up as a broken module in Settings → Modules.
mkdir -p "$STACK_DIR/modules" "$STACK_DIR/module-backups"
[ -d "$STACK_DIR/modules/grocy-kitchen" ] && cp -r "$STACK_DIR/modules/grocy-kitchen" "$STACK_DIR/module-backups/grocy-kitchen.bak.$TS"
rm -rf "$STACK_DIR/modules/grocy-kitchen"
cp -r "$REPO_ROOT/modules/grocy-kitchen" "$STACK_DIR/modules/grocy-kitchen"
echo "✓ grocy-kitchen module installed"

# ── 3. compose override with the bind-mounts ───────────────────────────────
# Detect the service name (default upstream name is "oikos")
SERVICE="oikos"
if [ -f "$STACK_DIR/docker-compose.yml" ]; then
  DETECTED="$(awk '/^services:/{f=1;next} f && /^[a-zA-Z0-9_-]+:/{gsub(":","");print $1;exit}' "$STACK_DIR/docker-compose.yml" || true)"
  [ -n "$DETECTED" ] && SERVICE="$DETECTED"
fi

OVERRIDE="$STACK_DIR/docker-compose.override.yml"
if [ -f "$OVERRIDE" ]; then
  cp "$OVERRIDE" "$OVERRIDE.bak.$TS"
  echo "WARN: $OVERRIDE already existed — backed up to $OVERRIDE.bak.$TS and OVERWRITTEN."
  echo "      Merge your previous overrides back in manually if you had any."
fi
cat > "$OVERRIDE" <<EOF
# Added by integrations/grocy-kitchen/install.sh — Grocy Kitchen overlay mounts
services:
  ${SERVICE}:
    volumes:
      - ./modules:/app/modules
      - ./custom/grocy.js:/app/server/routes/grocy.js:ro
      - ./custom/index.js:/app/server/index.js:ro
      - ./custom/router.js:/app/public/router.js:ro
      - ./custom/kitchen-tabs.js:/app/public/utils/kitchen-tabs.js:ro
EOF
echo "✓ docker-compose.override.yml written (service: ${SERVICE})"

# ── 4. .env ─────────────────────────────────────────────────────────────────
ENV_FILE="$STACK_DIR/.env"
touch "$ENV_FILE"
if ! grep -q '^GROCY_URL=' "$ENV_FILE"; then
  { echo ""; echo "# Grocy Kitchen integration"; cat "$SCRIPT_DIR/env.grocy.example" | grep -E '^(GROCY_|# GROCY_)'; } >> "$ENV_FILE"
  echo "✓ GROCY_* variables appended to .env — EDIT $ENV_FILE and set GROCY_URL + GROCY_API_KEY"
else
  echo "✓ GROCY_URL already present in .env — leaving it alone"
fi

# ── 5. restart ──────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1 && [ -f "$STACK_DIR/docker-compose.yml" ]; then
  ( cd "$STACK_DIR" && docker compose up -d )
  echo "✓ stack restarted"
  echo
  echo "Verify: open Oikos and click Kitchen — you should see Stock · Shopping · Recipes · Meal Plan · Products."
  echo "If GROCY_URL/GROCY_API_KEY were just added, set them in $ENV_FILE and run 'docker compose up -d' again."
else
  echo "Docker not found or no compose file — files are in place; restart the stack yourself."
fi
