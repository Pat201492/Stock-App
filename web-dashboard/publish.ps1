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

& ssh @sshArgs $target "mkdir -p $VPS_DATA/_incoming"
if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed" }

# Ship one DB at a time, gzipped, swapping and restarting between files.
#
# The old shape sent both databases uncompressed into _incoming and swapped at
# the end, needing ~350MB of spare disk on a box with well under a gigabyte
# free. Per-file gzip alone is not enough, and measuring showed why: the running
# service holds the live database files open, so `mv` frees nothing until the
# process lets go. Swapping stocks.db and then uploading politicians.db meant the
# old stocks.db inode was still on disk underneath the new one — measured peak
# went *up*, to ~396MB. Restarting between files drops those inodes, so the peak
# is one database plus its own .gz (~230MB) instead of everything at once.
#
# Cost is a second brief restart. The atomic `mv` is kept either way: a
# half-written transfer never becomes the live file.
$dbs = @("stocks.db", "politicians.db")
foreach ($f in $dbs) {
  $gz = Join-Path $env:TEMP "$f.gz"
  Write-Host "[publish] Compressing $f ..."
  & $py -c "import gzip,shutil,sys; i=open(sys.argv[1],'rb'); o=gzip.open(sys.argv[2],'wb',compresslevel=6); shutil.copyfileobj(i,o,1048576); o.close(); i.close()" "$root\$f" "$gz"
  if ($LASTEXITCODE -ne 0) { throw "compressing $f failed (exit $LASTEXITCODE)" }

  $srcMB = [math]::Round((Get-Item "$root\$f").Length / 1MB)
  $gzMB  = [math]::Round((Get-Item $gz).Length / 1MB)
  Write-Host "[publish] Uploading $f ($srcMB MB -> $gzMB MB) to $target ..."
  & scp @sshArgs $gz "${target}:$VPS_DATA/_incoming/"
  if ($LASTEXITCODE -ne 0) { Remove-Item $gz -Force -EA SilentlyContinue; throw "scp of $f failed" }
  Remove-Item $gz -Force -EA SilentlyContinue

  # gunzip removes the .gz as it writes, so the two never both sit at full size.
  # Only once the decompressed file exists does it replace the live one.
  # The restart is what actually reclaims the replaced file: until the service
  # closes it, the old inode still occupies disk even though `mv` unlinked it.
  Write-Host "[publish] Unpacking, swapping and reloading for $f ..."
  & ssh @sshArgs $target "set -e; cd $VPS_DATA/_incoming && gzip -df $f.gz && mv -f $f $VPS_DATA/$f && rm -f $VPS_DATA/$f-wal $VPS_DATA/$f-shm && sudo systemctl restart $VPS_SERVICE"
  if ($LASTEXITCODE -ne 0) { throw "remote unpack/swap of $f failed" }
}

Write-Host "[publish] Done - live data updated at https://$VPS_HOST"
