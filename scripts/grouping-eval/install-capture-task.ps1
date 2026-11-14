<#
  Installs (or updates) the daily evidence capture as a Windows scheduled task for the current user.
  Machine-specific paths are passed as parameters and live only in the task, never in the repository.

  .\install-capture-task.ps1 -DataRoot <repo>\.data\grouping-eval -BackupRoot <folder outside the repo>
  Remove:  Unregister-ScheduledTask -TaskPath '\DIFTillIDie\' -TaskName 'grouping-eval capture'
  Pause:   Disable-ScheduledTask   -TaskPath '\DIFTillIDie\' -TaskName 'grouping-eval capture'
#>
param(
  [Parameter(Mandatory)] [string] $DataRoot,
  [string] $BackupRoot = '',
  [string] $Time = '15:40',
  [string] $TaskName = 'grouping-eval capture',
  [string] $TaskPath = '\DIFTillIDie\'
)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'capture-task.ps1'
$checkout = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $checkout 'node_modules\jiti\lib\jiti-cli.mjs'))) { throw "no node_modules in ${checkout}: run npm ci --ignore-scripts there first" }
$node = (Get-Command node).Source

$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -DataRoot `"$DataRoot`" -BackupRoot `"$BackupRoot`" -ScheduledTime $Time -Node `"$node`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $checkout
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# Missed run (asleep or off at the time): run once as soon as possible afterwards; the run records how late it was.
# No wake timer: the task never wakes the computer. One instance at a time; give up after 20 minutes.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# Runs as you, only while you are signed in, with no stored password and no elevation.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Djurgarn tills jag dor, Issue #25: daily RSS evidence capture (evidence only; no labelling or evaluation).' -Force | Out-Null
Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Select-Object TaskPath, TaskName, State
