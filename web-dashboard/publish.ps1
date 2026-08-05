# publish.ps1 - build data locally (optional) then push it live to the VPS.
# Usage:
#   .\publish.ps1            # run full pipeline, then push + swap live
#   .\publish.ps1 -NoBuild   # push the existing local DBs only (no pipeline)
#
# Requires publish.config.ps1 (copy from publish.config.ps1.example) and SSH
# key access to the VPS. The VPS must allow passwordless `systemctl restart`
# for the deploy user (configured by deploy/setup_vps.sh).
[CmdletBinding()]
param([switch]$NoBuild)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path "$root\publish.config.ps1")) {
  throw "publish.config.ps1 not found. Copy publish.config.ps1.example to publish.config.ps1 and edit it."
}
. "$root\publish.config.ps1"

$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "venv missing at $py - create it: python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt" }

if (-not $NoBuild) {
  $env:PYTHONUTF8 = "1"
  # $ErrorActionPreference only governs cmdlets — a native exe that exits
  # non-zero sets $LASTEXITCODE and PowerShell carries on regardless. Without
  # these guards a failed build step still publishes, which is exactly how a
  # broken pol_refresh step (insider mirror) stayed hidden while the job looked
  # green. Ship stale-but-known data deliberately with -NoBuild, not by accident.
  Write-Host "[publish] Building market data (run.py) ..."
  & $py run.py
  if ($LASTEXITCODE -ne 0) {
    throw "run.py failed (exit $LASTEXITCODE) - refusing to publish. Fix it, or re-run with -NoBuild to ship the existing DBs."
  }
  # --recent: the daily run only needs to top up the last year. The full
  # multi-decade pull is a one-off, run by hand without the flag.
  Write-Host "[publish] Refreshing commodity prices (ingest_commodities.py) ..."
  & $py ingest_commodities.py --recent
  if ($LASTEXITCODE -ne 0) {
    throw "ingest_commodities.py failed (exit $LASTEXITCODE) - refusing to publish. Fix it, or re-run with -NoBuild to ship the existing DBs."
  }
  Write-Host "[publish] Building congressional/insider data (pol_refresh.py) ..."
  & $py pol_refresh.py
  if ($LASTEXITCODE -ne 0) {
    throw "pol_refresh.py failed (exit $LASTEXITCODE) - refusing to publish. Fix it, or re-run with -NoBuild to ship the existing DBs."
  }
}

foreach ($f in @("stocks.db", "politicians.db")) {
  if (-not (Test-Path "$root\$f")) { throw "$f not found - run without -NoBuild first." }
}

# Flush WAL into the main .db files so the copied files are complete — copying a
# WAL-mode DB without checkpointing (esp. while a writer is active) ships stale
# or empty data.
Write-Host "[publish] Checkpointing DBs (WAL -> main) ..."
& $py -c "import sqlite3
for f in ('stocks.db','politicians.db'):
    try: c=sqlite3.connect(f); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()
    except Exception as e: print('checkpoint warn', f, e)"
if ($LASTEXITCODE -ne 0) { throw "checkpoint failed (exit $LASTEXITCODE) - the DBs may be mid-write; not publishing." }

$sshArgs = @()
if ($SSH_KEY -and (Test-Path $SSH_KEY)) { $sshArgs = @("-i", $SSH_KEY) }
$target = "$VPS_USER@$VPS_HOST"

Write-Host "[publish] Uploading DBs to $target ..."
& ssh @sshArgs $target "mkdir -p $VPS_DATA/_incoming"
if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed" }
& scp @sshArgs "$root\stocks.db" "$root\politicians.db" "${target}:$VPS_DATA/_incoming/"
if ($LASTEXITCODE -ne 0) { throw "scp upload failed" }

Write-Host "[publish] Swapping live + restarting $VPS_SERVICE ..."
& ssh @sshArgs $target "mv $VPS_DATA/_incoming/*.db $VPS_DATA/ && rm -f $VPS_DATA/stocks.db-wal $VPS_DATA/stocks.db-shm $VPS_DATA/politicians.db-wal $VPS_DATA/politicians.db-shm && sudo systemctl restart $VPS_SERVICE"
if ($LASTEXITCODE -ne 0) { throw "remote swap/restart failed" }

Write-Host "[publish] Done - live data updated at https://$VPS_HOST"
