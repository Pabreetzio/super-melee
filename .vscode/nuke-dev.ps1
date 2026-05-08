$ErrorActionPreference = 'SilentlyContinue'

$ports = @(43187, 43991)

Write-Host "Stopping Super Melee dev ports: $($ports -join ', ')"

$pids = @()
$netstat = netstat -ano -p tcp

foreach ($line in $netstat) {
  foreach ($port in $ports) {
    if ($line -match ":$port\s" -and $line -match "LISTENING\s+(\d+)$") {
      $pids += [int]$Matches[1]
    }
  }
}

$pids = @($pids | Where-Object { $_ -and $_ -ne $PID } | Select-Object -Unique)

if ($pids.Count -eq 0) {
  Write-Host 'No Super Melee dev processes found.'
  exit 0
}

Write-Host "Stopping process ids: $($pids -join ', ')"

$pids | ForEach-Object {
  Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 500

$remaining = @()
$netstat = netstat -ano -p tcp
foreach ($line in $netstat) {
  foreach ($port in $ports) {
    if ($line -match ":$port\s" -and $line -match "LISTENING\s+(\d+)$") {
      $remaining += [int]$Matches[1]
    }
  }
}

if ($remaining.Count -gt 0) {
  Write-Host "Warning: ports still have listeners: $($remaining -join ', ')"
  exit 1
}

Write-Host 'Nuke complete.'
