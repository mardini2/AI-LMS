#!/usr/bin/env bash
# Dev environment command wrapper for AI-LMS-Tool (WSL2 / Linux / macOS).
#
# Run from a WSL2 terminal while cd'd into the project:
#   cd /mnt/c/Users/<you>/source/repos/AI-LMS-Tool
#   ./dev.sh up
#
# Or from PowerShell — dev.ps1 auto-delegates here when it detects a Linux
# path in MOODLE_DOCKER_WWWROOT:
#   .\dev.ps1 up
#
# Commands: up | down | restart | logs | ps | install-api |
#           moodle-install | moodle-upgrade | moodle-purge | rebuild-chat-js |
#           tunnel | tunnel-stop

set -euo pipefail

CMD="${1:-up}"

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    echo "ERROR: .env not found. Run ./setup.sh first." >&2
    exit 1
fi
# Strip \r (CRLF) before sourcing — .env lives on the Windows filesystem
# and may have Windows line endings when accessed via /mnt/c/...
set -a
# shellcheck disable=SC1091
source <(tr -d '\r' < .env)
set +a

# ── Derive moodle-docker location from MOODLE_DOCKER_WWWROOT ─────────────────
# MOODLE_DOCKER_WWWROOT = /home/user/AI-LMS-Tool-deps/moodle
# moodle-docker dir     = /home/user/AI-LMS-Tool-deps/moodle-docker
MOODLE_DOCKER_DIR="$(dirname "$MOODLE_DOCKER_WWWROOT")/moodle-docker"
export ASSETDIR="$MOODLE_DOCKER_DIR/assets"

# ── Apply moodle-docker defaults ─────────────────────────────────────────────
export MOODLE_DOCKER_WEB_HOST="${MOODLE_DOCKER_WEB_HOST:-localhost}"
export MOODLE_DOCKER_TIMEOUT_FACTOR="${MOODLE_DOCKER_TIMEOUT_FACTOR:-1}"
export MOODLE_DOCKER_BROWSER_TAG="${MOODLE_DOCKER_BROWSER_TAG:-4}"

# Prepend 127.0.0.1: to port if not already a host:port pair
if [[ "${MOODLE_DOCKER_WEB_PORT:-8000}" != *:* ]]; then
    export MOODLE_DOCKER_WEB_PORT="127.0.0.1:${MOODLE_DOCKER_WEB_PORT:-8000}"
fi
WEB_PORT="${MOODLE_DOCKER_WEB_PORT##*:}"
API_PORT="${API_PORT:-3000}"

# ── Build compose command ─────────────────────────────────────────────────────
# Mirrors the file selection in dev.ps1:
#   base.yml           - webserver service
#   service.mail.yml   - mailpit
#   db.<DB>.yml        - database service (mariadb / pgsql / etc.)
#   webserver.port.yml - port mapping for webserver
#   docker-compose.override.yml - plugin mount, postgres, api
COMPOSE="docker compose --project-directory . --env-file .env \
  -f $MOODLE_DOCKER_DIR/base.yml \
  -f $MOODLE_DOCKER_DIR/service.mail.yml \
  -f $MOODLE_DOCKER_DIR/db.${MOODLE_DOCKER_DB}.yml \
  -f $MOODLE_DOCKER_DIR/webserver.port.yml \
  -f docker-compose.override.yml"

# ── Tunnel helpers ────────────────────────────────────────────────────────────
TUNNEL_STATE_FILE=".tunnel-state"
TUNNEL_MOODLE_NAME="ai-lms-cloudflared-moodle"
TUNNEL_API_NAME="ai-lms-cloudflared-api"
MOODLE_CONFIG_PHP="${MOODLE_DOCKER_WWWROOT}/config.php"

tunnel_require_python() {
    if command -v python3 >/dev/null 2>&1; then
        TUNNEL_PY=python3
    elif command -v python >/dev/null 2>&1; then
        TUNNEL_PY=python
    else
        echo "ERROR: python3 or python is required for tunnel commands." >&2
        exit 1
    fi
}

tunnel_env_get() {
    local key="$1"
    tr -d '\r' < .env | sed -n "s/^${key}=//p" | tail -n1
}

tunnel_env_set() {
    local key="$1"
    local val="$2"
    tunnel_require_python
    "$TUNNEL_PY" - "$key" "$val" <<'PY'
import pathlib, sys
key, val = sys.argv[1], sys.argv[2]
path = pathlib.Path(".env")
text = path.read_text(encoding="utf-8")
newline = "\r\n" if "\r\n" in text else "\n"
lines = text.splitlines()
found = False
out = []
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={val}")
        found = True
    else:
        out.append(line)
if not found:
    if out and out[-1] != "":
        out.append("")
    out.append(f"{key}={val}")
path.write_text(newline.join(out) + newline, encoding="utf-8")
PY
}

tunnel_cloudflared_running() {
    docker ps -q -f "name=^/${TUNNEL_MOODLE_NAME}$" 2>/dev/null | grep -q .
}

tunnel_wait_for_url() {
    local name="$1"
    local timeout="${2:-60}"
    local elapsed=0
    local url=""
    while [ "$elapsed" -lt "$timeout" ]; do
        url="$(docker logs "$name" 2>&1 | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | head -n1 || true)"
        if [ -n "$url" ]; then
            echo "$url"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    echo "ERROR: Timed out waiting for trycloudflare URL from container ${name}." >&2
    docker logs "$name" >&2 || true
    return 1
}

tunnel_moodle_get_api_url() {
    $COMPOSE exec -T webserver php -r \
        'define("CLI_SCRIPT", true); require("config.php"); echo (string)(get_config("local_syllentras_ai", "api_url") ?: "");'
}

tunnel_moodle_set_api_url() {
    local url="$1"
    $COMPOSE exec -T -e SYLLENTRAS_API_URL="$url" webserver php -r \
        'define("CLI_SCRIPT", true); require("config.php"); set_config("api_url", getenv("SYLLENTRAS_API_URL") ?: "", "local_syllentras_ai");'
}

# moodle-docker builds $CFG->wwwroot dynamically in the Docker branch. Do not
# regex-replace the Gitpod single-quoted assignment — inject a marked override
# after that if/else so tunnel HTTPS wwwroot + sslproxy take effect, then remove
# the block on restore.
TUNNEL_CFG_BEGIN="// BEGIN AI-LMS-TOOL TUNNEL OVERRIDE"
TUNNEL_CFG_END="// END AI-LMS-TOOL TUNNEL OVERRIDE"

tunnel_repair_moodle_config() {
    # Undo accidental mangling from the old Gitpod-line patcher, if present.
    tunnel_require_python
    "$TUNNEL_PY" - "$MOODLE_CONFIG_PHP" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
original = text
text = re.sub(
    r"(// Gitpod\.io deployment\.\n\s*\$CFG->wwwroot\s*=\s*)'https://[^']+\.trycloudflare\.com'",
    r"\1'https://'",
    text,
    count=1,
)
text = re.sub(
    r"(// Gitpod\.io deployment\.\n\s*\$CFG->wwwroot\s*=\s*'https://'\s*\.\s*\$_SERVER\['HTTP_HOST'\]\s*;\n\s*\$CFG->sslproxy\s*=\s*)true",
    r"\1false",
    text,
    count=1,
)
if text != original:
    open(path, "w", encoding="utf-8").write(text)
    print("Repaired Moodle config.php Gitpod wwwroot/sslproxy lines.")
PY
}

tunnel_patch_moodle_config() {
    local wwwroot="$1"
    tunnel_require_python
    "$TUNNEL_PY" - "$MOODLE_CONFIG_PHP" "$wwwroot" "$TUNNEL_CFG_BEGIN" "$TUNNEL_CFG_END" <<'PY'
import re, sys
path, wwwroot, begin, end = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = open(path, encoding="utf-8").read()
# Remove any previous override block first.
text = re.sub(
    re.escape(begin) + r".*?" + re.escape(end) + r"\n?",
    "",
    text,
    count=1,
    flags=re.S,
)
block = (
    f"{begin}\n"
    f"$CFG->wwwroot = '{wwwroot}';\n"
    f"$CFG->sslproxy = true;\n"
    f"{end}\n"
)
# Insert after the Gitpod/Docker wwwroot if/else, before $CFG->dataroot.
m = re.search(r"(\$CFG->dataroot\s*=)", text)
if not m:
    raise SystemExit(f"ERROR: $CFG->dataroot not found in {path}; cannot insert tunnel override")
text = text[: m.start()] + block + "\n" + text[m.start() :]
open(path, "w", encoding="utf-8").write(text)
PY
}

tunnel_restore_moodle_config() {
    tunnel_require_python
    tunnel_repair_moodle_config
    "$TUNNEL_PY" - "$MOODLE_CONFIG_PHP" "$TUNNEL_CFG_BEGIN" "$TUNNEL_CFG_END" <<'PY'
import re, sys
path, begin, end = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
new = re.sub(
    re.escape(begin) + r".*?" + re.escape(end) + r"\n?",
    "",
    text,
    count=1,
    flags=re.S,
)
# Also drop a blank line left behind if we created a double blank.
new = re.sub(r"\n{3,}", "\n\n", new)
if new != text:
    open(path, "w", encoding="utf-8").write(new)
PY
}

tunnel_write_state() {
    # Args: prev_api_url prev_cors prev_public prev_internal_host moodle_url api_url
    tunnel_require_python
    "$TUNNEL_PY" - "$TUNNEL_STATE_FILE" \
        "$1" "$2" "$3" "$4" "$5" "$6" \
        "$TUNNEL_MOODLE_NAME" "$TUNNEL_API_NAME" <<'PY'
import json, sys
path = sys.argv[1]
state = {
    "prev_api_url": sys.argv[2],
    "prev_cors_origin": sys.argv[3],
    "prev_moodle_public_url": sys.argv[4],
    "prev_moodle_internal_host": sys.argv[5],
    "moodle_tunnel_url": sys.argv[6],
    "api_tunnel_url": sys.argv[7],
    "moodle_container": sys.argv[8],
    "api_container": sys.argv[9],
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
PY
}

tunnel_state_get() {
    local key="$1"
    tunnel_require_python
    "$TUNNEL_PY" - "$TUNNEL_STATE_FILE" "$key" <<'PY'
import json, sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
print(state.get(sys.argv[2], ""))
PY
}

tunnel_stop_cloudflared() {
    docker rm -f "$TUNNEL_MOODLE_NAME" "$TUNNEL_API_NAME" >/dev/null 2>&1 || true
}

# Compose prefers already-exported shell vars over --env-file. Because this
# script sources .env with set -a at startup, we must re-export CORS /
# MOODLE_PUBLIC_URL / MOODLE_INTERNAL_HOST before force-recreate or the API
# keeps the old values.
tunnel_recreate_api() {
    local cors_origin="$1"
    local public_url="${2:-}"
    local internal_host="${3:-localhost:${WEB_PORT}}"
    export CORS_ORIGIN="$cors_origin"
    export MOODLE_PUBLIC_URL="$public_url"
    export MOODLE_INTERNAL_HOST="$internal_host"
    $COMPOSE up -d --force-recreate api

    local actual_cors=""
    local actual_host=""
    local waited=0
    while [ "$waited" -lt 45 ]; do
        actual_cors="$($COMPOSE exec -T api printenv CORS_ORIGIN 2>/dev/null | tr -d '\r' || true)"
        actual_host="$($COMPOSE exec -T api printenv MOODLE_INTERNAL_HOST 2>/dev/null | tr -d '\r' || true)"
        if [ "$actual_cors" = "$cors_origin" ] && [ "$actual_host" = "$internal_host" ]; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    echo "ERROR: API env mismatch after recreate." >&2
    echo "  CORS_ORIGIN: expected '${cors_origin}', got '${actual_cors:-<unset>}'" >&2
    echo "  MOODLE_INTERNAL_HOST: expected '${internal_host}', got '${actual_host:-<unset>}'" >&2
    return 1
}

tunnel_hostname_from_url() {
    local url="$1"
    tunnel_require_python
    "$TUNNEL_PY" - "$url" <<'PY'
from urllib.parse import urlparse
import sys
print(urlparse(sys.argv[1]).hostname or "")
PY
}

tunnel_restore() {
    if [ ! -f "$TUNNEL_STATE_FILE" ]; then
        echo "No active tunnel state (.tunnel-state missing)."
        # Still repair any leftover Gitpod mangling / override block from a bad run.
        if [ -f "$MOODLE_CONFIG_PHP" ]; then
            tunnel_restore_moodle_config
        fi
        tunnel_stop_cloudflared
        return 0
    fi

    echo "Restoring local Moodle/API config from tunnel session..."
    local prev_api_url prev_cors prev_public prev_internal_host
    prev_api_url="$(tunnel_state_get prev_api_url)"
    prev_cors="$(tunnel_state_get prev_cors_origin)"
    prev_public="$(tunnel_state_get prev_moodle_public_url)"
    prev_internal_host="$(tunnel_state_get prev_moodle_internal_host)"

    if [ -f "$MOODLE_CONFIG_PHP" ]; then
        tunnel_restore_moodle_config
    fi

    local restore_cors="${prev_cors:-http://localhost:${WEB_PORT}}"
    local restore_public="${prev_public:-}"
    local restore_internal_host="${prev_internal_host:-localhost:${WEB_PORT}}"
    tunnel_env_set "CORS_ORIGIN" "$restore_cors"
    tunnel_env_set "MOODLE_PUBLIC_URL" "$restore_public"
    tunnel_env_set "MOODLE_INTERNAL_HOST" "$restore_internal_host"

    # Ensure webserver is up long enough to restore plugin api_url in the DB.
    $COMPOSE up -d webserver >/dev/null 2>&1 || true
    if $COMPOSE exec -T webserver true >/dev/null 2>&1; then
        tunnel_moodle_set_api_url "$prev_api_url"
        $COMPOSE exec -T webserver php admin/cli/purge_caches.php >/dev/null || true
    else
        echo "WARNING: Could not reach Moodle webserver to restore api_url." >&2
    fi

    tunnel_recreate_api "$restore_cors" "$restore_public" "$restore_internal_host" >/dev/null 2>&1 || true

    tunnel_stop_cloudflared
    rm -f "$TUNNEL_STATE_FILE"
    echo "Local config restored."
}

tunnel_restore_if_stale() {
    if [ ! -f "$TUNNEL_STATE_FILE" ]; then
        return 0
    fi
    if tunnel_cloudflared_running; then
        return 0
    fi
    echo "Stale tunnel state detected (cloudflared not running). Restoring local config..."
    tunnel_restore
}

tunnel_start() {
    if [ -f "$TUNNEL_STATE_FILE" ]; then
        echo "ERROR: A tunnel session is already active (.tunnel-state exists)." >&2
        echo "Run: ./dev.sh tunnel-stop" >&2
        exit 1
    fi
    if [ ! -f "$MOODLE_CONFIG_PHP" ]; then
        echo "ERROR: Moodle config not found at $MOODLE_CONFIG_PHP" >&2
        exit 1
    fi

    echo "Ensuring local stack is up..."
    $COMPOSE up -d

    echo "Starting Cloudflare quick tunnels..."
    tunnel_stop_cloudflared
    docker run -d --name "$TUNNEL_MOODLE_NAME" --add-host=host.docker.internal:host-gateway \
        cloudflare/cloudflared:latest tunnel --url "http://host.docker.internal:${WEB_PORT}" >/dev/null
    docker run -d --name "$TUNNEL_API_NAME" --add-host=host.docker.internal:host-gateway \
        cloudflare/cloudflared:latest tunnel --url "http://host.docker.internal:${API_PORT}" >/dev/null

    echo "Waiting for tunnel URLs..."
    local moodle_url api_url
    if ! moodle_url="$(tunnel_wait_for_url "$TUNNEL_MOODLE_NAME")"; then
        tunnel_stop_cloudflared
        exit 1
    fi
    if ! api_url="$(tunnel_wait_for_url "$TUNNEL_API_NAME")"; then
        tunnel_stop_cloudflared
        exit 1
    fi

    local prev_api_url prev_cors prev_public prev_internal_host moodle_tunnel_host
    prev_api_url="$(tunnel_moodle_get_api_url)"
    prev_cors="$(tunnel_env_get CORS_ORIGIN)"
    prev_public="$(tunnel_env_get MOODLE_PUBLIC_URL)"
    prev_internal_host="$(tunnel_env_get MOODLE_INTERNAL_HOST)"
    if [ -z "$prev_internal_host" ]; then
        prev_internal_host="localhost:${WEB_PORT}"
    fi
    moodle_tunnel_host="$(tunnel_hostname_from_url "$moodle_url")"
    if [ -z "$moodle_tunnel_host" ]; then
        echo "ERROR: Could not parse hostname from Moodle tunnel URL: $moodle_url" >&2
        tunnel_stop_cloudflared
        exit 1
    fi

    tunnel_write_state \
        "$prev_api_url" \
        "$prev_cors" \
        "$prev_public" \
        "$prev_internal_host" \
        "$moodle_url" \
        "$api_url"

    echo "Rewiring Moodle wwwroot / sslproxy / api_url..."
    tunnel_repair_moodle_config
    tunnel_patch_moodle_config "$moodle_url"
    tunnel_moodle_set_api_url "$api_url"

    echo "Updating .env CORS_ORIGIN, MOODLE_PUBLIC_URL, MOODLE_INTERNAL_HOST..."
    tunnel_env_set "CORS_ORIGIN" "$moodle_url"
    tunnel_env_set "MOODLE_PUBLIC_URL" "$moodle_url"
    tunnel_env_set "MOODLE_INTERNAL_HOST" "$moodle_tunnel_host"

    echo "Recreating API container with tunnel env..."
    if ! tunnel_recreate_api "$moodle_url" "$moodle_url" "$moodle_tunnel_host"; then
        tunnel_restore
        exit 1
    fi

    echo "Purging Moodle caches..."
    $COMPOSE exec -T webserver php admin/cli/purge_caches.php

    echo ""
    echo "Tunnel is ready:"
    echo "  Moodle:  $moodle_url"
    echo "  API:     $api_url"
    echo ""
    echo "Tunnels are running in the background."
    echo "Stop with: ./dev.sh tunnel-stop   (or: ./dev.sh down)"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$CMD" in
    up)
        tunnel_restore_if_stale
        # If override markers remain without .tunnel-state, strip them.
        if [ -f "$MOODLE_CONFIG_PHP" ] && grep -q "BEGIN AI-LMS-TOOL TUNNEL OVERRIDE" "$MOODLE_CONFIG_PHP"; then
            echo "Removing leftover tunnel override from Moodle config.php..."
            tunnel_restore_moodle_config
        elif [ -f "$MOODLE_CONFIG_PHP" ]; then
            tunnel_repair_moodle_config
        fi
        echo "Starting all services..."
        $COMPOSE up -d
        echo ""
        echo "Moodle:  http://localhost:$WEB_PORT"
        echo "API:     http://localhost:${API_PORT}"
        ;;
    down)
        if [ -f "$TUNNEL_STATE_FILE" ]; then
            tunnel_restore
        fi
        echo "Stopping all services..."
        $COMPOSE down
        ;;
    restart)
        echo "Restarting all services..."
        $COMPOSE restart
        ;;
    logs)
        $COMPOSE logs -f
        ;;
    ps)
        $COMPOSE ps
        ;;
    install-api)
        echo "Installing node_modules inside api container..."
        $COMPOSE exec api npm install
        ;;
    moodle-install)
        echo "Running Moodle database installer (first-boot only)..."
        $COMPOSE exec webserver php admin/cli/install_database.php \
            --agree-license \
            --adminpass="$MOODLE_ADMIN_PASSWORD" \
            --adminemail="$MOODLE_ADMIN_EMAIL"
        echo ""
        echo "Done. Now visit http://localhost:$WEB_PORT/admin and complete the initial setup wizard."
        ;;
    moodle-upgrade)
        echo "Running Moodle plugin upgrade (detects and installs new/updated plugins)..."
        $COMPOSE exec webserver php admin/cli/upgrade.php --non-interactive
        echo ""
        echo "Done. Visit http://localhost:$WEB_PORT/admin to confirm and purge caches if prompted."
        ;;
    moodle-purge)
        echo "Purging all Moodle caches (required after hook/capability definition changes)..."
        $COMPOSE exec webserver php admin/cli/purge_caches.php
        echo "Done."
        ;;
    rebuild-chat-js)
        echo "Rebuilding Syllentras chat widget bundle (boot.js)..."
        if command -v python3 >/dev/null 2>&1; then
            PY=python3
        elif command -v python >/dev/null 2>&1; then
            PY=python
        else
            echo "ERROR: python3 or python is required to rebuild chat JS." >&2
            exit 1
        fi
        "$PY" plugin/syllentras_ai/js/_build_boot.py
        echo "Running Moodle plugin upgrade (no-op if version.php unchanged)..."
        $COMPOSE exec webserver php admin/cli/upgrade.php --non-interactive
        echo "Purging all Moodle caches..."
        $COMPOSE exec webserver php admin/cli/purge_caches.php
        echo "Done. Hard-refresh the Moodle page if it still looks stale."
        ;;
    tunnel)
        tunnel_start
        ;;
    tunnel-stop)
        tunnel_restore
        ;;
    *)
        echo "Usage: ./dev.sh {up|down|restart|logs|ps|install-api|moodle-install|moodle-upgrade|moodle-purge|rebuild-chat-js|tunnel|tunnel-stop}"
        exit 1
        ;;
esac
