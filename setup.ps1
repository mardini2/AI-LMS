#Requires -Version 5.1
<#
.SYNOPSIS
    One-time dev environment setup for AI-LMS-Tool (Windows).
.DESCRIPTION
    Clones moodle-docker and Moodle v5.2.1, then seeds .env from .env.example
    with MOODLE_DOCKER_WWWROOT set to the correct absolute path automatically.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== AI-LMS-Tool Dev Environment Setup ===" -ForegroundColor Cyan
Write-Host ""

# Clone moodle-docker
if (Test-Path "./moodle-docker") {
    Write-Host "[SKIP] ./moodle-docker already exists" -ForegroundColor Yellow
} else {
    Write-Host "[1/3] Cloning moodlehq/moodle-docker..." -ForegroundColor Green
    git clone https://github.com/moodlehq/moodle-docker.git ./moodle-docker
}

# Clone Moodle v5.2.1
if (Test-Path "./moodle") {
    Write-Host "[SKIP] ./moodle already exists" -ForegroundColor Yellow
} else {
    Write-Host "[2/3] Cloning Moodle v5.2.1 (shallow)..." -ForegroundColor Green
    git clone -b v5.2.1 --depth 1 https://github.com/moodle/moodle.git ./moodle
}

# Seed .env from .env.example
Write-Host "[3/3] Seeding .env..." -ForegroundColor Green

if (Test-Path "./.env") {
    Write-Host "[SKIP] .env already exists - skipping to avoid overwriting secrets" -ForegroundColor Yellow
} else {
    Copy-Item .env.example .env

    # MOODLE_DOCKER_WWWROOT must be an absolute path with forward slashes
    $wwwroot = (Resolve-Path .\moodle).Path -replace '\\', '/'
    $envContent = Get-Content .env -Raw
    $envContent = $envContent -replace '(?m)^MOODLE_DOCKER_WWWROOT=$', "MOODLE_DOCKER_WWWROOT=$wwwroot"
    Set-Content .env $envContent -NoNewline

    Write-Host "  Set MOODLE_DOCKER_WWWROOT=$wwwroot" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Open .env and fill in:" -ForegroundColor White
Write-Host "       MOODLE_ADMIN_PASSWORD  - choose a local admin password" -ForegroundColor Gray
Write-Host "       POSTGRES_PASSWORD      - choose a local DB password" -ForegroundColor Gray
Write-Host "       DATABASE_URL           - update with your POSTGRES_PASSWORD" -ForegroundColor Gray
Write-Host "       GEMINI_API_KEY         - get from your team lead" -ForegroundColor Gray
Write-Host "  2. Run: .\dev.ps1 up" -ForegroundColor White
Write-Host "  3. Follow README.md for first-boot Moodle install steps" -ForegroundColor White
Write-Host ""
