# Optional Windows helper: opens API + Web in two PowerShell windows.
# Prefer cross-platform: npm run dev (uses concurrently).
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "Starting SmartRoutine API on http://127.0.0.1:4000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location '$Root'; npm run dev:api"
)

Start-Sleep -Seconds 2

Write-Host "Starting SmartRoutine Web on http://localhost:5173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location '$Root'; npm run dev:web"
)

Write-Host ""
Write-Host "Open http://localhost:5173 after Vite is ready." -ForegroundColor Green
Write-Host "Seed credentials are printed by the API on first boot / npm run reset — see SETUP.md." -ForegroundColor Green
