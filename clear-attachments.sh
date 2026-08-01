#!/usr/bin/env bash
# Clear all Syllentras chat attachment uploads for every user.
# Resets storage to 0 MB without deleting conversations or messages.
#
# Usage (from project root, preferably via WSL when moodle-docker is on Linux):
#   ./clear-attachments.sh
#   ./clear-attachments.sh --force
#   ./dev.sh clear-attachments

set -euo pipefail

FORCE=0
if [[ "${1:-}" == "--force" || "${1:-}" == "-Force" || "${1:-}" == "-force" ]]; then
  FORCE=1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Run ./setup.sh first." >&2
  exit 1
fi

# Strip CRLF before sourcing (.env may live on the Windows filesystem).
set -a
# shellcheck disable=SC1091
source <(tr -d '\r' < .env)
set +a

if [[ "$FORCE" -ne 1 ]]; then
  echo
  echo "This will permanently delete ALL chat attachments for ALL users:"
  echo "  - Postgres tables: chat_attachments, chat_attachment_chunks"
  echo "  - Files under /app/uploads (api_uploads volume)"
  echo
  echo "Conversations and messages are NOT deleted."
  echo
  read -r -p "Type YES to continue: " answer
  if [[ "${answer^^}" != "YES" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

MOODLE_DOCKER_DB="${MOODLE_DOCKER_DB:-mariadb}"

# Same compose wiring as dev.sh: moodle-docker usually lives next to moodle/
# under MOODLE_DOCKER_WWWROOT's parent (WSL native path).
if [[ -n "${MOODLE_DOCKER_WWWROOT:-}" && "${MOODLE_DOCKER_WWWROOT}" == /* ]]; then
  MOODLE_DOCKER_DIR="$(dirname "$MOODLE_DOCKER_WWWROOT")/moodle-docker"
else
  MOODLE_DOCKER_DIR="${ROOT}/moodle-docker"
fi

if [[ -f "$MOODLE_DOCKER_DIR/base.yml" && -f docker-compose.override.yml ]]; then
  COMPOSE=(docker compose --project-directory . --env-file .env
    -f "$MOODLE_DOCKER_DIR/base.yml"
    -f "$MOODLE_DOCKER_DIR/service.mail.yml"
    -f "$MOODLE_DOCKER_DIR/db.${MOODLE_DOCKER_DB}.yml"
    -f "$MOODLE_DOCKER_DIR/webserver.port.yml"
    -f docker-compose.override.yml)
elif [[ -f docker-compose.override.yml ]]; then
  echo "ERROR: moodle-docker base.yml not found at: $MOODLE_DOCKER_DIR" >&2
  echo "Run this from WSL (./dev.sh clear-attachments) so the Linux moodle-docker path is used." >&2
  exit 1
else
  echo "ERROR: docker-compose.override.yml not found." >&2
  exit 1
fi

echo
echo "Checking that postgres and api are running..."
"${COMPOSE[@]}" ps postgres
"${COMPOSE[@]}" ps api

echo
echo "Clearing attachment metadata in Postgres..."
"${COMPOSE[@]}" exec -T postgres \
  psql -U api_user -d syllentras -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE chat_attachment_chunks, chat_attachments RESTART IDENTITY CASCADE;"

echo
echo "Clearing files under /app/uploads in the api container..."
"${COMPOSE[@]}" exec -T api sh -c \
  'mkdir -p /app/uploads && find /app/uploads -mindepth 1 -maxdepth 1 -exec rm -rf {} +'

echo
echo "Verifying storage is empty..."
"${COMPOSE[@]}" exec -T api sh -c 'du -sh /app/uploads 2>/dev/null || echo 0'
"${COMPOSE[@]}" exec -T postgres \
  psql -U api_user -d syllentras -t -A \
  -c "SELECT 'attachments=' || COUNT(*) FROM chat_attachments; SELECT 'chunks=' || COUNT(*) FROM chat_attachment_chunks;"

echo
echo "Done. Attachment storage is cleared for all users (0 MB)."
echo "Chat history is unchanged; users can upload again within the configured quota."
