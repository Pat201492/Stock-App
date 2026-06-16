# Stock-App self-installing updater (Windows / PowerShell)
# ---------------------------------------------------------
# One-liner (shown on the site's "Update data" page):
#   irm https://<your-host>/update.ps1 | iex
#
# Behaviour:
#   1. If the app isn't installed locally  -> git clone + venv + pip install
#      If it is                            -> git pull
#   2. Refresh the data (run.py + pol_refresh.py)
#   3. If publish.config.ps1 exists        -> push DBs to the VPS and swap live
#      Otherwise                           -> build locally only (no push)
#
# Install location: %STOCKAPP_DIR% if set, else %USERPROFILE%\stock-app
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/Pat201492/Stock-App.git"
$Dir = if ($env:STOCKAPP_DIR) { $env:STOCKAPP_DIR } else { Join-Path $env:USERPROFILE "stock-app" }

function Need($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Required command '$cmd' not found on PATH. Install it first (git / python)."
  }
}
Need git
Need python

if (-not (Test-Path (Join-Path $Dir ".git"))) {
  Write-Host "[update] Installing Stock-App to $Dir ..."
  git clone $RepoUrl $Dir
} else {
  Write-Host "[update] Updating code in $Dir ..."
  git -C $Dir pull --ff-only
}
# backend lives under web-dashboard/ after the 2026-06 repo reorg
Set-Location (Join-Path $Dir "web-dashboard")

$py = Join-Path $Dir "web-dashboard\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "[update] Creating venv + installing dependencies ..."
  python -m venv .venv
  & $py -m pip install --quiet --upgrade pip
  & $py -m pip install --quiet -r requirements.txt
  try { & $py -m textblob.download_corpora } catch {}
}

if (Test-Path ".\publish.config.ps1") {
  Write-Host "[update] Refreshing data and publishing live ..."
  powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1
} else {
  Write-Host "[update] No publish.config.ps1 found - building data locally only (no push)."
  $env:PYTHONUTF8 = "1"
  & $py run.py
  & $py pol_refresh.py
  Write-Host "[update] Built locally. Copy publish.config.ps1.example -> publish.config.ps1 and edit it to push live."
}
Write-Host "[update] Complete."
