<#
  Daily evidence capture for Issue #25, run by Windows Task Scheduler (see install-capture-task.ps1).
  Runs capture.ts from the checkout this script lives in, logs the run, then copies the private data folder to
  each backup folder (copy only: nothing is ever deleted from a backup). Evidence only: never labels, pins or
  evaluates.

  Exit code (Task Scheduler "Last Run Result"): 0 success, 2 partial, 1 failure, 3 another capture active,
  4 captured but a backup failed, 5 the capture could not start (Node or jiti missing).
#>
param(
  [Parameter(Mandatory)] [string] $DataRoot,
  # One or more backup folders, separated by ';'. Each must be outside the repository.
  [string] $BackupRoot = '',
  [string] $ScheduledTime = '15:40',
  [string] $Node = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logs = Join-Path $DataRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logs "capture-$stamp.log"
$runs = Join-Path $DataRoot 'capture-runs.jsonl'
function Write-Log([string] $line) { Add-Content -Path $log -Value "$(Get-Date -Format o) $line" -Encoding utf8 }
function Show-Failure([string] $message) {
  # Best effort: a Windows notification, so a failure is seen without opening the logs.
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $text = $xml.GetElementsByTagName('text')
    $text.Item(0).AppendChild($xml.CreateTextNode('Djurgarn: evidence capture problem')) | Out-Null
    $text.Item(1).AppendChild($xml.CreateTextNode($message)) | Out-Null
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Windows PowerShell').Show([Windows.UI.Notifications.ToastNotification]::new($xml))
  }
  catch { Write-Log "notification failed: $($_.Exception.Message)" }
}

Write-Log "start: checkout $repo, data $DataRoot, scheduled $ScheduledTime"
try { Write-Log "checkout commit $((& git -C $repo rev-parse HEAD) 2>$null)" } catch {}
if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
$jiti = Join-Path $repo 'node_modules\jiti\lib\jiti-cli.mjs'
$before = if (Test-Path $runs) { @(Get-Content $runs).Count } else { 0 }

$code = 5
if (-not $Node -or -not (Test-Path $Node) -or -not (Test-Path $jiti)) {
  Write-Log "cannot start: node '$Node' or jiti '$jiti' not found"
}
else {
  $env:GROUPING_EVAL_ROOT = $DataRoot
  Push-Location $repo
  try {
    $out = & cmd /c "`"$Node`" `"$jiti`" scripts/grouping-eval/capture.ts --scheduled $ScheduledTime 2>&1"
    $code = $LASTEXITCODE
    $out | ForEach-Object { Write-Log "capture: $_" }
  }
  finally { Pop-Location }
}
$after = if (Test-Path $runs) { @(Get-Content $runs).Count } else { 0 }
if ($after -le $before) {
  # capture.ts never got to record the run (it could not start, or crashed): record it here.
  if ($code -eq 0) { $code = 1 }
  $record = [ordered]@{ runId = (Get-Date).ToUniversalTime().ToString('o'); trigger = 'scheduled'; status = 'failure'; exitCode = $code; snapshot = $null; articleCount = 0; sources = @(); notes = @("capture did not record a run; see logs/capture-$stamp.log") }
  Add-Content -Path $runs -Value ($record | ConvertTo-Json -Compress -Depth 4) -Encoding utf8
}
Write-Log "capture exit code $code"

foreach ($dest in ($BackupRoot -split ';' | Where-Object { $_.Trim() })) {
  $dest = $dest.Trim()
  if ($dest.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase) -or $dest.StartsWith((Resolve-Path (Join-Path $DataRoot '..\..')).Path, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Log "backup refused: $dest is inside a repository"; if ($code -eq 0) { $code = 4 }; continue
  }
  # /E copies subfolders; no /MIR or /PURGE, so a backup only ever gains files. Robocopy codes below 8 are success.
  & robocopy $DataRoot $dest /E /COPY:DAT /R:2 /W:5 /XF capture.lock /NP /NJH /NFL /NDL | ForEach-Object { if ($_.Trim()) { Write-Log "backup: $_" } }
  $rc = $LASTEXITCODE
  Write-Log "backup to ${dest}: robocopy code $rc"
  if ($rc -ge 8 -and $code -eq 0) { $code = 4 }
}

Write-Log "done: exit code $code"
if ($code -ne 0) { Show-Failure "Exit code $code. See $log" }
exit $code
