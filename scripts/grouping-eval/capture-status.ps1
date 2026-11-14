<#
  Shows the daily capture's health: the scheduled task, the last runs and the last complete capture.
  .\capture-status.ps1 -DataRoot <repo>\.data\grouping-eval
#>
param(
  [Parameter(Mandatory)] [string] $DataRoot,
  [string] $TaskName = 'grouping-eval capture',
  [string] $TaskPath = '\DIFTillIDie\'
)
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $info = $task | Get-ScheduledTaskInfo
  "Task: $TaskPath$TaskName  state $($task.State)  last run $($info.LastRunTime)  result $($info.LastTaskResult)  next run $($info.NextRunTime)"
}
else { 'Task: not installed' }

$runs = Join-Path $DataRoot 'capture-runs.jsonl'
if (-not (Test-Path $runs)) { 'No runs recorded yet.'; return }
$all = Get-Content $runs | ForEach-Object { $_ | ConvertFrom-Json }
''
'Last runs:'
$all | Select-Object -Last 7 | ForEach-Object {
  $src = ($_.sources | ForEach-Object { if ($_.ok) { "$($_.id) ok" } else { "$($_.id) FAILED" } }) -join ', '
  "  $($_.startedAt)  $($_.trigger)$(if ($_.minutesLate) { " +$($_.minutesLate) min" })  $($_.status)  $($_.articleCount) articles  $($_.snapshot)  [$src]$(if ($_.notes) { '  ' + ($_.notes -join '; ') })"
}
$ok = $all | Where-Object { $_.status -eq 'success' } | Select-Object -Last 1
''
if ($ok) {
  $age = (Get-Date) - [datetime]$ok.startedAt
  "Last complete capture: $($ok.startedAt) ($([math]::Round($age.TotalHours)) h ago) -> $($ok.snapshot)"
  if ($age.TotalHours -gt 36) { 'WARNING: no complete capture in the last 36 hours.' }
}
else { 'WARNING: no complete capture recorded.' }
