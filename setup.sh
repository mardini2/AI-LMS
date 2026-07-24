#!/usr/bin/env bash
# One-time dev environment setup for AI-LMS-Tool (WSL2 / Linux / macOS).
#
# Run this from a WSL2 terminal while cd'd into the project:
#   cd /mnt/c/Users/<you>/source/repos/AI-LMS-Tool
#   chmod +x setup.sh && ./setup.sh
#
# What it does:
#   1. Clones moodlehq/moodle-docker into ~/AI-LMS-Tool-deps/moodle-docker
#   2. Clones Moodle v5.2.1 into ~/AI-LMS-Tool-deps/moodle
#   3. Copies config.docker-template.php → moodle/config.php
#   4. Creates/updates .env with the WSL2-native MOODLE_DOCKER_WWWROOT path
#
# moodle/ and moodle-docker/ are placed in the WSL2 home directory (not the
# Windows project folder) so Docker mounts them at native Linux speed,
# eliminating the NTFS→WSL2 bridge that causes 10+ second page loads.

set -euo pipefail

DEPS_DIR="$HOME/AI-LMS-Tool-deps"

echo ""
echo "=== AI-LMS-Tool Dev Environment Setup (WSL2) ==="
echo ""

# ── 1. Clone moodle-docker ────────────────────────────────────────────────────
if [ -d "$DEPS_DIR/moodle-docker" ]; then
    echo "[SKIP] $DEPS_DIR/moodle-docker already exists"
else
    echo "[1/3] Cloning moodlehq/moodle-docker into $DEPS_DIR/moodle-docker ..."
    mkdir -p "$DEPS_DIR"
    git clone https://github.com/moodlehq/moodle-docker.git "$DEPS_DIR/moodle-docker"
fi

# ── 2. Clone Moodle v5.2.1 ───────────────────────────────────────────────────
if [ -d "$DEPS_DIR/moodle" ]; then
    echo "[SKIP] $DEPS_DIR/moodle already exists"
else
    echo "[2/3] Cloning Moodle v5.2.1 (shallow) into $DEPS_DIR/moodle ..."
    mkdir -p "$DEPS_DIR"
    git clone -b v5.2.1 --depth 1 https://github.com/moodle/moodle.git "$DEPS_DIR/moodle"
fi

# ── 3. Copy moodle-docker config template ────────────────────────────────────
if [ -f "$DEPS_DIR/moodle/config.php" ]; then
    echo "[SKIP] $DEPS_DIR/moodle/config.php already exists"
else
    echo "       Copying config.docker-template.php → moodle/config.php ..."
    cp "$DEPS_DIR/moodle-docker/config.docker-template.php" "$DEPS_DIR/moodle/config.php"
fi

# ── 4. Seed .env ─────────────────────────────────────────────────────────────
echo "[3/3] Seeding .env ..."
WWWROOT="$DEPS_DIR/moodle"

if [ -f ".env" ]; then
    # Update MOODLE_DOCKER_WWWROOT in the existing .env in place
    sed -i "s|^MOODLE_DOCKER_WWWROOT=.*|MOODLE_DOCKER_WWWROOT=$WWWROOT|" .env
    echo "      Updated MOODLE_DOCKER_WWWROOT in existing .env"
else
    cp .env.example .env
    sed -i "s|^MOODLE_DOCKER_WWWROOT=.*|MOODLE_DOCKER_WWWROOT=$WWWROOT|" .env
    echo "      Created .env from .env.example"
fi

echo "      MOODLE_DOCKER_WWWROOT=$WWWROOT"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Open .env and fill in:"
echo "       MOODLE_ADMIN_PASSWORD  - choose a local admin password"
echo "       POSTGRES_PASSWORD      - choose a local DB password"
echo "       DATABASE_URL           - update with your POSTGRES_PASSWORD"
echo "       OPENAI_API_KEY         - optional OpenAI / ChatGPT key"
echo "       GEMINI_API_KEY         - optional Google Gemini key"
echo "       ANTHROPIC_API_KEY      - optional Anthropic Claude key"
echo "       XAI_API_KEY            - optional xAI Grok key"
echo "       MISTRAL_API_KEY        - optional Mistral key"
echo "       (configure at least one provider key)"
echo "  2. Run: ./dev.sh up"
echo "     (or from PowerShell: .\\dev.ps1 up  — auto-delegates to WSL2)"
echo "  3. Follow README.md for first-boot Moodle install steps"
echo ""
