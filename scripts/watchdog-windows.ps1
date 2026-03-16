param(
  [string]$AppProcessName = "Framr Studio",
  [string]$AppExecutablePath = "C:\Program Files\Framr Studio\Framr Studio.exe",
  [int]$IntervalSeconds = 3
)

while ($true) {
  $running = Get-Process -Name $AppProcessName -ErrorAction SilentlyContinue

  if (-not $running) {
    if (Test-Path $AppExecutablePath) {
      Start-Process -FilePath $AppExecutablePath | Out-Null
    } else {
      Start-Process -FilePath "explorer.exe" -ArgumentList "shell:AppsFolder\$AppProcessName" -ErrorAction SilentlyContinue | Out-Null
    }
  }

  Start-Sleep -Seconds $IntervalSeconds
}
