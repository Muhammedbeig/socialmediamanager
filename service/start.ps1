# Starts the Social Publisher service with no window, logging to data\logs\service.log.
# Windows runs this at login once service\install-startup.ps1 has been run.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logs = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs "service.log"

# Keep the log from growing without end: start a fresh one past 5 MB.
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) {
    Move-Item -Force $log (Join-Path $logs "service.previous.log")
}

# One instance only: if something already answers on the app's port, do nothing.
$port = 3000
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^APP_URL=' } | Select-Object -First 1
    if ($line -and ([uri]($line -replace '^APP_URL=', '')).Port -gt 0) { $port = ([uri]($line -replace '^APP_URL=', '')).Port }
}
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Add-Content $log "$(Get-Date -Format o) Port $port is already in use; not starting a second copy."
    exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $root "node_modules\tsx\dist\cli.mjs"
& $node $tsx (Join-Path $root "service\main.ts") *>> $log
