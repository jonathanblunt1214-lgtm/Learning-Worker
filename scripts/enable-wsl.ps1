$ErrorActionPreference = 'Stop'

$features = @(
  'Microsoft-Windows-Subsystem-Linux',
  'VirtualMachinePlatform'
)

foreach ($feature in $features) {
  Write-Host "Enabling $feature ..."
  & dism.exe /Online /Enable-Feature "/FeatureName:$feature" /All /NoRestart
  if ($LASTEXITCODE -notin @(0, 3010)) {
    throw "DISM failed for $feature with exit $LASTEXITCODE."
  }
}

Write-Host 'WSL prerequisites are enabled. A Windows restart is required before Ubuntu and the GitHub runner can be installed.'
