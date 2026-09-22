# Start OneAbility AI on Windows.  Usage:  ./run.ps1          -> http://localhost:8000
#                                          ./run.ps1 -Node    -> also start Node server.js on http://localhost:3000
param([switch]$Node, [int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$py = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host 'Creating virtual environment...'
  python -m venv (Join-Path $backend '.venv')
  & $py -m pip install --quiet --upgrade pip
  & $py -m pip install --quiet -r (Join-Path $backend 'requirements.txt')
}
if (-not (Test-Path (Join-Path $backend '.env'))) {
  Copy-Item (Join-Path $backend '.env.example') (Join-Path $backend '.env')
  Write-Host 'Created backend/.env. Add GEMINI_API_KEY there to enable Gemini (optional).'
}
if ($Node) {
  $env:SERVE_FRONTEND = '0'
  Start-Process -NoNewWindow node -ArgumentList 'server.js' -WorkingDirectory $root
  Write-Host 'Open http://localhost:3000'
} else { Write-Host "Open http://localhost:$Port" }
Set-Location $backend
& $py -m uvicorn app.main:app --host 127.0.0.1 --port $Port
