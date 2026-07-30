#Requires -Version 5.1
<#
.SYNOPSIS
    Clear all Syllentras chat attachment uploads for every user.
.DESCRIPTION
    Resets attachment storage to 0 MB without touching conversations or messages.

    When MOODLE_DOCKER_WWWROOT is a Linux path (normal after setup.sh), this
    script delegates to WSL ./clear-attachments.sh so docker compose can find
    moodle-docker — same pattern as .\dev.ps1.

.PARAMETER Force
    Skip the confirmation prompt.

.EXAMPLE
    .\clear-attachments.ps1
    .\clear-attachments.ps1 -Force
    .\dev.ps1 clear-attachments
#>

param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (Test-Path ".\.env") {
    Get-Content ".\.env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name  = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

# Delegate to WSL when moodle-docker lives on the Linux filesystem.
if ($env:MOODLE_DOCKER_WWWROOT -match '^/') {
    $drive  = (Get-Location).Drive.Name.ToLower()
    $relPath = (Get-Location).Path -replace '^[A-Za-z]:\\', '' -replace '\\', '/'
    $wslDir = "/mnt/$drive/$relPath"
    $forceArg = if ($Force) { "--force" } else { "" }
    Write-Host "Delegating to WSL clear-attachments.sh (moodle-docker is on the Linux filesystem)..." -ForegroundColor Cyan
    if ($forceArg) {
        wsl --cd $wslDir -- bash ./clear-attachments.sh --force
    } else {
        wsl --cd $wslDir -- bash ./clear-attachments.sh
    }
    exit $LASTEXITCODE
}

if (-not $Force) {
    Write-Host ""
    Write-Host "This will permanently delete ALL chat attachments for ALL users:" -ForegroundColor Yellow
    Write-Host "  - Postgres tables: chat_attachments, chat_attachment_chunks"
    Write-Host "  - Files under /app/uploads (api_uploads volume)"
    Write-Host ""
    Write-Host "Conversations and messages are NOT deleted." -ForegroundColor Cyan
    Write-Host ""
    $answer = Read-Host "Type YES to continue"
    if ($answer.Trim().ToUpperInvariant() -ne "YES") {
        Write-Host "Cancelled." -ForegroundColor DarkGray
        exit 0
    }
}

if (-not $env:MOODLE_DOCKER_DB) { $env:MOODLE_DOCKER_DB = "mariadb" }

if (-not ((Test-Path ".\moodle-docker\base.yml") -and (Test-Path ".\docker-compose.override.yml"))) {
    Write-Host "ERROR: moodle-docker\base.yml not found next to this project." -ForegroundColor Red
    Write-Host "Your setup likely uses WSL. Run: .\dev.ps1 clear-attachments" -ForegroundColor Yellow
    exit 1
}

$composeArgs = @(
    "compose",
    "--project-directory", ".",
    "--env-file", ".env",
    "-f", "moodle-docker/base.yml",
    "-f", "moodle-docker/service.mail.yml",
    "-f", "moodle-docker/db.$($env:MOODLE_DOCKER_DB).yml",
    "-f", "moodle-docker/webserver.port.yml",
    "-f", "docker-compose.override.yml"
)

function Invoke-DockerCompose {
    param([Parameter(Mandatory = $true)][string[]]$ExtraArgs)
    $all = $composeArgs + $ExtraArgs
    Write-Host (">> docker " + ($all -join " ")) -ForegroundColor DarkGray
    & docker @all
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed (exit $LASTEXITCODE)"
    }
}

Write-Host ""
Write-Host "Checking that postgres and api are running..." -ForegroundColor Cyan
Invoke-DockerCompose @("ps", "postgres")
Invoke-DockerCompose @("ps", "api")

Write-Host ""
Write-Host "Clearing attachment metadata in Postgres..." -ForegroundColor Cyan
Invoke-DockerCompose @(
    "exec", "-T", "postgres",
    "psql", "-U", "api_user", "-d", "syllentras", "-v", "ON_ERROR_STOP=1",
    "-c", "TRUNCATE TABLE chat_attachment_chunks, chat_attachments RESTART IDENTITY CASCADE;"
)

Write-Host ""
Write-Host "Clearing files under /app/uploads in the api container..." -ForegroundColor Cyan
Invoke-DockerCompose @(
    "exec", "-T", "api",
    "sh", "-c", "mkdir -p /app/uploads && find /app/uploads -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
)

Write-Host ""
Write-Host "Verifying storage is empty..." -ForegroundColor Cyan
Invoke-DockerCompose @(
    "exec", "-T", "api",
    "sh", "-c", "du -sh /app/uploads 2>/dev/null || echo 0"
)
Invoke-DockerCompose @(
    "exec", "-T", "postgres",
    "psql", "-U", "api_user", "-d", "syllentras", "-t", "-A",
    "-c", "SELECT 'attachments=' || COUNT(*) FROM chat_attachments; SELECT 'chunks=' || COUNT(*) FROM chat_attachment_chunks;"
)

Write-Host ""
Write-Host "Done. Attachment storage is cleared for all users (0 MB)." -ForegroundColor Green
Write-Host "Chat history is unchanged; users can upload again within the configured quota." -ForegroundColor Green
