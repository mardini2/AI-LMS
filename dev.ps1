#Requires -Version 5.1
<#
.SYNOPSIS
    Dev environment command wrapper for AI-LMS-Tool.
.DESCRIPTION
    Wraps the docker compose command so team members don't need to remember
    the full -f flag syntax.
.PARAMETER Command
    One of: up, down, restart, logs, ps, install-api
.EXAMPLE
    .\dev.ps1 up
    .\dev.ps1 down
    .\dev.ps1 logs
    .\dev.ps1 install-api    # installs node_modules inside the api container
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("up", "down", "restart", "logs", "ps", "install-api")]
    [string]$Command = "up"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$composeFiles = "-f moodle-docker/base.yml -f docker-compose.override.yml"

switch ($Command) {
    "up" {
        Write-Host "Starting all services..." -ForegroundColor Cyan
        Invoke-Expression "docker compose $composeFiles up -d"
        Write-Host ""
        Write-Host "Services started. Access Moodle at: http://localhost:$env:MOODLE_DOCKER_WEB_PORT" -ForegroundColor Green
        Write-Host "API running at:                     http://localhost:$env:API_PORT" -ForegroundColor Green
    }
    "down" {
        Write-Host "Stopping all services..." -ForegroundColor Cyan
        Invoke-Expression "docker compose $composeFiles down"
    }
    "restart" {
        Write-Host "Restarting all services..." -ForegroundColor Cyan
        Invoke-Expression "docker compose $composeFiles restart"
    }
    "logs" {
        Invoke-Expression "docker compose $composeFiles logs -f"
    }
    "ps" {
        Invoke-Expression "docker compose $composeFiles ps"
    }
    "install-api" {
        Write-Host "Installing node_modules inside api container..." -ForegroundColor Cyan
        Invoke-Expression "docker compose $composeFiles exec api npm install"
    }
}
