# Opens a TEMPORARY public https URL to the running local server.
# 1) Keep scripts\run_local.ps1 running in another terminal.
# 2) Install Cloudflare's tunnel tool once:  winget install --id Cloudflare.cloudflared
#    (open a NEW terminal after installing so the command is found)
# 3) Run:  powershell -ExecutionPolicy Bypass -File scripts\public_url.ps1
# The URL works only while this window and the server stay open, and changes every time.
$ErrorActionPreference = "Stop"
$port = 8000

try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$port/health" | Out-Null
} catch {
    Write-Host "The app is not running on port $port. Start scripts\run_local.ps1 first." -ForegroundColor Yellow
    exit 1
}

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    $default = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (Test-Path $default) { $cloudflared = Get-Command $default }
}
if (-not $cloudflared) {
    Write-Host "cloudflared is not installed. Install it with:" -ForegroundColor Yellow
    Write-Host "    winget install --id Cloudflare.cloudflared" -ForegroundColor Cyan
    Write-Host "then open a new terminal and run this script again."
    exit 1
}

Write-Host ""
Write-Host "Starting tunnel... look for a line like  https://<random-words>.trycloudflare.com" -ForegroundColor Cyan
Write-Host "Share that address + /dashboard/   (API docs: + /docs).  Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host ""
& $cloudflared.Source tunnel --url "http://127.0.0.1:$port"
