#Requires -Version 5.1
<#
.SYNOPSIS
    Dev environment command wrapper for AI-LMS-Tool.
.DESCRIPTION
    Wraps the docker compose command so team members don't need to remember
    the full -f flag syntax. Mirrors what moodle-docker-compose does internally.
.PARAMETER Command
    One of: up, down, restart, logs, ps, install-api,
    moodle-install, moodle-upgrade, moodle-purge, rebuild-chat-js
.EXAMPLE
    .\dev.ps1 up
    .\dev.ps1 down
    .\dev.ps1 logs
    .\dev.ps1 install-api
    .\dev.ps1 rebuild-chat-js
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("up", "down", "restart", "logs", "ps", "install-api", "moodle-install", "moodle-upgrade", "moodle-purge", "rebuild-chat-js")]
    [string]$Command = "up"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Load .env into the current PowerShell session
if (Test-Path ".\.env") {
    Get-Content ".\.env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name  = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

# ── WSL2 delegation ──────────────────────────────────────────────────────────
# When MOODLE_DOCKER_WWWROOT is a Linux path (set by setup.sh), moodle/ lives
# in the WSL2 native filesystem. Docker must be invoked from WSL2 to mount it
# efficiently — running from Windows PowerShell routes through the NTFS→WSL2
# bridge and causes 10+ second page loads.
# Translate the current Windows path to /mnt/c/... and delegate to dev.sh.
if ($env:MOODLE_DOCKER_WWWROOT -match '^/') {
    $drive  = (Get-Location).Drive.Name.ToLower()
    $relPath = (Get-Location).Path -replace '^[A-Za-z]:\\', '' -replace '\\', '/'
    $wslDir = "/mnt/$drive/$relPath"
    wsl --cd $wslDir -- bash dev.sh $Command
    exit $LASTEXITCODE
}

# Set variables that moodle-docker-compose normally exports via the shell script
# ASSETDIR must be the absolute path to moodle-docker/assets
$moodleDockerDir = (Resolve-Path ".\moodle-docker").Path
$env:ASSETDIR = "$moodleDockerDir\assets"

# Defaults for optional moodle-docker vars
if (-not $env:MOODLE_DOCKER_WEB_HOST)      { $env:MOODLE_DOCKER_WEB_HOST = "localhost" }
if (-not $env:MOODLE_DOCKER_TIMEOUT_FACTOR) { $env:MOODLE_DOCKER_TIMEOUT_FACTOR = "1" }
if (-not $env:MOODLE_DOCKER_BROWSER_TAG)    { $env:MOODLE_DOCKER_BROWSER_TAG = "4" }

# moodle-docker-compose prepends 127.0.0.1: to the web port (host-only binding)
$webPort = $env:MOODLE_DOCKER_WEB_PORT
if ($webPort -notmatch ':') {
    $env:MOODLE_DOCKER_WEB_PORT = "127.0.0.1:$webPort"
}

# Build compose command mirroring moodle-docker-compose's file selection:
#   base.yml            - webserver service
#   service.mail.yml    - mailpit (always included by moodle-docker)
#   db.mariadb.yml      - MariaDB db service (MOODLE_DOCKER_DB=mariadb)
#   webserver.port.yml  - port mapping for webserver (when port > 0)
#   docker-compose.override.yml - our plugin mount, postgres, and api
$compose = "docker compose --project-directory . --env-file .env" +
           " -f moodle-docker/base.yml" +
           " -f moodle-docker/service.mail.yml" +
           " -f moodle-docker/db.$($env:MOODLE_DOCKER_DB).yml" +
           " -f moodle-docker/webserver.port.yml" +
           " -f docker-compose.override.yml"

switch ($Command) {
    "up" {
        Write-Host "Starting all services..." -ForegroundColor Cyan
        Invoke-Expression "$compose up -d"
        Write-Host ""
        Write-Host "Moodle:  http://localhost:$webPort" -ForegroundColor Green
        Write-Host "API:     http://localhost:$($env:API_PORT)" -ForegroundColor Green
    }
    "down" {
        Write-Host "Stopping all services..." -ForegroundColor Cyan
        Invoke-Expression "$compose down"
    }
    "restart" {
        Write-Host "Restarting all services..." -ForegroundColor Cyan
        Invoke-Expression "$compose restart"
    }
    "logs" {
        Invoke-Expression "$compose logs -f"
    }
    "ps" {
        Invoke-Expression "$compose ps"
    }
    "install-api" {
        Write-Host "Installing node_modules inside api container..." -ForegroundColor Cyan
        Invoke-Expression "$compose exec api npm install"
    }
    "moodle-install" {
        Write-Host "Running Moodle database installer (first-boot only)..." -ForegroundColor Cyan
        Invoke-Expression "$compose exec webserver php admin/cli/install_database.php --agree-license --adminpass=`"$env:MOODLE_ADMIN_PASSWORD`" --adminemail=`"$env:MOODLE_ADMIN_EMAIL`""
        Write-Host ""
        Write-Host "Done. Now visit http://localhost:$webPort/admin and complete the initial setup wizard." -ForegroundColor Green
    }
    "moodle-upgrade" {
        Write-Host "Running Moodle plugin upgrade (detects and installs new/updated plugins)..." -ForegroundColor Cyan
        Invoke-Expression "$compose exec webserver php admin/cli/upgrade.php --non-interactive"
        Write-Host ""
        Write-Host "Done. Visit http://localhost:$webPort/admin to confirm and purge caches if prompted." -ForegroundColor Green
    }
    "moodle-purge" {
        Write-Host "Purging all Moodle caches (required after hook/capability definition changes)..." -ForegroundColor Cyan
        Invoke-Expression "$compose exec webserver php admin/cli/purge_caches.php"
        Write-Host "Done." -ForegroundColor Green
    }
    "rebuild-chat-js" {
        Write-Host "Rebuilding Syllentras chat widget bundle (boot.js)..." -ForegroundColor Cyan
        python "plugin/syllentras_ai/js/_build_boot.py"
        if ($LASTEXITCODE -ne 0) {
            throw "Chat JS rebuild failed (exit $LASTEXITCODE)."
        }
        Write-Host "Running Moodle plugin upgrade (no-op if version.php unchanged)..." -ForegroundColor Cyan
        Invoke-Expression "$compose exec webserver php admin/cli/upgrade.php --non-interactive"
        Write-Host "Purging all Moodle caches..." -ForegroundColor Cyan
        Invoke-Expression "$compose exec webserver php admin/cli/purge_caches.php"
        Write-Host "Done. Hard-refresh the Moodle page if it still looks stale." -ForegroundColor Green
    }
}
