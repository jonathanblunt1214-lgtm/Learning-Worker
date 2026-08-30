$ErrorActionPreference = 'Stop'
$projectId = 'github:jonathanblunt1214-lgtm/The-Crucible'
$workspace = $env:RUNNER_TEMP
$encryptedSources = Join-Path $workspace 'sources.zip.enc'
$encryptedState = Join-Path $workspace 'state.zip.enc'
$sourcesZip = Join-Path $workspace 'sources.zip'
$stateZip = Join-Path $workspace 'state.zip'
$learningRoot = Join-Path $workspace 'learning'
$sourcesRoot = Join-Path $learningRoot 'sources'
$queueFile = Join-Path $sourcesRoot 'source-queue.json'
if ($env:GITHUB_REPOSITORY -ne 'jonathanblunt1214-lgtm/Learning-Worker') { throw 'Unexpected repository identity.' }
if (-not $env:LEARNING_WORKER_KEY) { throw 'Encrypted-state key is unavailable.' }
gh release download worker-state --repo $env:GITHUB_REPOSITORY --pattern 'sources.zip.enc' --pattern 'state.zip.enc' --dir $workspace --clobber
node scripts/crypt-bundle.js decrypt $encryptedSources $sourcesZip
node scripts/crypt-bundle.js decrypt $encryptedState $stateZip
New-Item -ItemType Directory -Path $sourcesRoot -Force | Out-Null
Expand-Archive -LiteralPath $sourcesZip -DestinationPath $sourcesRoot
Expand-Archive -LiteralPath $stateZip -DestinationPath $learningRoot
node scripts/prepare-hosted-queue.js $queueFile $sourcesRoot
$env:PYTHONPATH = Join-Path $sourcesRoot 'runtime-python'
$env:CRUCIBLE_LEARNING_PROJECT_ID = $projectId
$env:CRUCIBLE_LEARNING_ROOT = $learningRoot
$env:CRUCIBLE_SOURCE_QUEUE = $queueFile
$env:CRUCIBLE_EXTRACTION_BATCH_SIZE = '25'
$env:CRUCIBLE_PDF_PAGES_PER_BATCH = '20'
$env:CRUCIBLE_PYTHON = (Get-Command python).Source
Push-Location crucible-engine
try { node src/claimExtractionWorkerCli.js readiness; if ($LASTEXITCODE -ne 0) { throw 'Extraction readiness failed.' }; node src/claimExtractionWorkerCli.js run; if ($LASTEXITCODE -ne 0) { throw 'Extraction failed.' } } finally { Pop-Location }
$stateStage = Join-Path $workspace 'state-stage'; New-Item -ItemType Directory -Path (Join-Path $stateStage 'sources') -Force | Out-Null
Copy-Item -LiteralPath $queueFile -Destination (Join-Path $stateStage 'sources\source-queue.json')
Get-ChildItem -LiteralPath $learningRoot -File -Filter '*.learning.json' | Copy-Item -Destination $stateStage
Compress-Archive -Path (Join-Path $stateStage '*') -DestinationPath $stateZip -CompressionLevel Optimal -Force
Remove-Item -LiteralPath $encryptedState -Force
node scripts/crypt-bundle.js encrypt $stateZip $encryptedState
gh release upload worker-state $encryptedState --repo $env:GITHUB_REPOSITORY --clobber

