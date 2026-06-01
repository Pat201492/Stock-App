# schedule_publish.ps1 - register a Windows Task Scheduler job that runs
# publish.ps1 on a schedule (default: daily at 03:00). Re-run to change cadence.
#
# EDIT THESE TWO LINES to change frequency:
$Interval = "Daily"      # Daily | Weekly
$AtTime   = "03:00"      # 24h local time
# For Weekly, also set which day:
$DayOfWeek = "Monday"    # only used when $Interval = "Weekly"
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
$TaskName = "StockApp-Publish"
$repo     = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)  # repo root (parent of deploy\)
$publish  = Join-Path $repo "publish.ps1"
if (-not (Test-Path $publish)) { throw "publish.ps1 not found at $publish" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$publish`"" -WorkingDirectory $repo

if ($Interval -eq "Weekly") {
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $AtTime
} else {
  $trigger = New-ScheduledTaskTrigger -Daily -At $AtTime
}

# Run whether logged in or not; wake the machine; don't run on battery-only.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description "Stock-App: build data + publish live" -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' ($Interval at $AtTime)."
Write-Host "Change cadence: edit the variables at the top of this file and re-run it."
Write-Host "Run now to test:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Remove:           Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
