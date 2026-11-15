# Starts the API + dashboard and prints the local and network URLs.
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$python = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { Write-Host "Create the venv first: python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"; exit 1 }
if (-not (Test-Path "models/uci-italy/CO.pkl")) { & $python train_model.py data/AirQualityUCI.csv; & $python train_model.py data/Beijing_Aotizhongxin.csv }
$port = 8000
$lan = (Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1).IPv4Address.IPAddress
Write-Host ""
Write-Host "  Local URL     : http://127.0.0.1:$port/dashboard/" -ForegroundColor Cyan
Write-Host "  API docs      : http://127.0.0.1:$port/docs" -ForegroundColor Cyan
if ($lan) { Write-Host "  Network URL   : http://${lan}:$port/dashboard/  (same Wi-Fi devices)" -ForegroundColor Cyan }
Write-Host "  Public URL    : run scripts\public_url.ps1 in a second terminal" -ForegroundColor DarkGray
Write-Host ""
& $python -m uvicorn main:app --host 0.0.0.0 --port $port
