# Trains the models, starts the API, and sends test requests to it, all from one terminal.
#
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1              # train + start + test
#   powershell -ExecutionPolicy Bypass -File scripts\run_all.ps1 -SkipTraining
#
# The server keeps running at the end. Press Ctrl+C to stop it.
param([switch]$SkipTraining)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$python = ".\.venv\Scripts\python.exe"
$url = "http://127.0.0.1:8000"

if (-not (Test-Path $python)) {
    Write-Host "Setting up Python packages (first run only)..." -ForegroundColor Cyan
    python -m venv .venv
    & $python -m pip install -r requirements.txt
}

# 1. Train (prints the results for every pollutant)
if (-not $SkipTraining) {
    Write-Host "`n=== 1. Training ===" -ForegroundColor Cyan
    & $python train_model.py data\AirQualityUCI.csv
    & $python train_model.py data\Beijing_Aotizhongxin.csv
}

# 2. Start the server in the background
Write-Host "`n=== 2. Starting the server ===" -ForegroundColor Cyan
$server = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" `
    -PassThru -NoNewWindow
for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-RestMethod "$url/health" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
}

# 3. Send requests to the server, like Postman does
Write-Host "`n=== 3. GET / ===" -ForegroundColor Cyan
Invoke-RestMethod "$url/" | ConvertTo-Json

Write-Host "`n=== GET /health ===" -ForegroundColor Cyan
Invoke-RestMethod "$url/health" | ConvertTo-Json

Write-Host "`n=== POST /predict ===" -ForegroundColor Cyan
$body = @{
    pollutant = "CO"; hour = 18; weekday = 2
    lag_1 = 2.4; lag_2 = 2.0; lag_3 = 1.7; lag_24 = 2.9
    temperature = 12.5; relative_humidity = 55.0; absolute_humidity = 0.8
} | ConvertTo-Json
Write-Host "Sending: $($body -replace '\s+', ' ')"
Invoke-RestMethod "$url/predict" -Method Post -ContentType "application/json" -Body $body | ConvertTo-Json

Write-Host "`n=== POST /predict with a bad hour (expect 422) ===" -ForegroundColor Cyan
try {
    Invoke-RestMethod "$url/predict" -Method Post -ContentType "application/json" -Body '{"pollutant":"CO","hour":30,"weekday":2,"lag_1":2.4}'
} catch {
    Write-Host "Status $($_.Exception.Response.StatusCode.value__): the input was rejected, as it should be"
}

Write-Host "`n=== JSON report for CO (saved to report_CO.json) ===" -ForegroundColor Cyan
Invoke-WebRequest "$url/api/report/uci-italy/CO?download=true" -OutFile report_CO.json -UseBasicParsing
(Get-Content report_CO.json -Raw -Encoding UTF8 | ConvertFrom-Json).summary

Write-Host "`nServer is running:" -ForegroundColor Green
Write-Host "  Dashboard : $url/dashboard/"
Write-Host "  API docs  : $url/docs"
Write-Host "  Postman   : POST $url/predict"
Write-Host "Press Ctrl+C to stop."
Wait-Process -Id $server.Id
