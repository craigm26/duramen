# Keeps this PC from going to sleep while round three's runs go on, and ends by itself after the
# hours given. The display may still turn off. Stop it early by ending this PowerShell process.
param([int]$Hours = 12)
Add-Type -Name Power -Namespace RegenSandbox -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$until = (Get-Date).AddHours($Hours)
while ((Get-Date) -lt $until) {
  [RegenSandbox.Power]::SetThreadExecutionState(0x80000001) | Out-Null  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  Start-Sleep -Seconds 60
}
