$ErrorActionPreference = 'Stop'
$node = 'C:\Users\bonbo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$npm = Join-Path (Split-Path $node) 'npm.cmd'
$py = 'C:\Users\bonbo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
Write-Host 'Local URL: http://localhost:8000'
Write-Host 'Network URL: http://<this-machine-LAN-IP>:8000'
Push-Location $PSScriptRoot\..
& $py -m uvicorn main:app --host 0.0.0.0 --port 8000
Pop-Location
