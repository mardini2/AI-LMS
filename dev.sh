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
#           moodle-install | moodle-upgrade | moodle-purge

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

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$CMD" in
    up)
        echo "Starting all services..."
        $COMPOSE up -d
        echo ""
        echo "Moodle:  http://localhost:$WEB_PORT"
        echo "API:     http://localhost:${API_PORT:-3000}"
        ;;
    down)
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
    *)
        echo "Usage: ./dev.sh {up|down|restart|logs|ps|install-api|moodle-install|moodle-upgrade|moodle-purge}"
        exit 1
        ;;
esac
