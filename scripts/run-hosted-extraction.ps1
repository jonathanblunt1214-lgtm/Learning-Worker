$ErrorActionPreference = 'Stop'
$projectId = 'github:jonathanblunt1214-lgtm/The-Crucible'
$workspace = $env:RUNNER_TEMP
$encryptedState = Join-Path $workspace 'state.zip.enc'
$stateZip = Join-Path $workspace 'state.zip'
$sourceTar = Join-Path $workspace 'vetted-source-bundle.tar.gz'
$vettedRoot = Join-Path $workspace 'vetted-source-root'
$learningRoot = Join-Path $workspace 'learning'
$sourcesRoot = Join-Path $vettedRoot 'sources'
$queueFile = Join-Path $learningRoot 'sources\source-queue.json'
$throughputFile = Join-Path $learningRoot 'adaptive-throughput.json'
$oversightApprovalFile = Join-Path $learningRoot 'oversight-approvals.json'
$vettedApprovalFile = Join-Path $workspace 'vetted-oversight-approvals.json'
$runStartedAt = Get-Date
if ($env:GITHUB_REPOSITORY -ne 'jonathanblunt1214-lgtm/Learning-Worker') { throw 'Unexpected repository identity.' }
if (-not $env:LEARNING_WORKER_KEY) { throw 'Encrypted-state key is unavailable.' }
$oversightPublicKey = Join-Path $workspace 'oversight-public.pem'
if (-not $env:OVERSIGHT_SIGNING_PUBLIC_KEY) { throw 'Independent oversight public key is unavailable.' }
[IO.File]::WriteAllText($oversightPublicKey, $env:OVERSIGHT_SIGNING_PUBLIC_KEY)
node scripts/vetted-custody.js (Join-Path (Get-Location) 'vetted-state') $sourceTar $oversightPublicKey $vettedApprovalFile
if ($LASTEXITCODE -ne 0) { throw 'Vetted encrypted custody verification failed.' }
New-Item -ItemType Directory -Path $vettedRoot -Force | Out-Null
tar -xzf $sourceTar -C $vettedRoot
New-Item -ItemType Directory -Path (Split-Path $queueFile) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $vettedRoot 'source-queue.json') -Destination $queueFile
Get-ChildItem -LiteralPath $vettedRoot -File -Filter '*.learning.json' | Copy-Item -Destination $learningRoot
$priorStateAvailable = $true
try { gh release download worker-state --repo $env:GITHUB_REPOSITORY --pattern 'state.zip.enc' --dir $workspace --clobber } catch { $priorStateAvailable = $false }
if ($priorStateAvailable -and (Test-Path -LiteralPath $encryptedState)) { node scripts/crypt-bundle.js decrypt $encryptedState $stateZip; Expand-Archive -LiteralPath $stateZip -DestinationPath $learningRoot -Force }
Copy-Item -LiteralPath $vettedApprovalFile -Destination $oversightApprovalFile -Force
Remove-Item -LiteralPath $oversightPublicKey -Force
node scripts/prepare-hosted-queue.js $queueFile $sourcesRoot $oversightApprovalFile
$env:PYTHONPATH = Join-Path $sourcesRoot 'runtime-python'
$env:CRUCIBLE_LEARNING_PROJECT_ID = $projectId
$env:CRUCIBLE_LEARNING_ROOT = $learningRoot
$env:CRUCIBLE_SOURCE_QUEUE = $queueFile
$env:CRUCIBLE_EXTRACTION_BATCH_SIZE = '25'
$env:CRUCIBLE_EXTRACTION_MAX_DOCUMENTS = '9'
$priorRun = gh run list --repo $env:GITHUB_REPOSITORY --workflow extract.yml --limit 5 --json databaseId,status,conclusion,createdAt,updatedAt | ConvertFrom-Json | Where-Object { [string]$_.databaseId -ne $env:GITHUB_RUN_ID -and $_.status -eq 'completed' } | Select-Object -First 1
$previousConclusion = if ($priorRun) { [string]$priorRun.conclusion } else { '' }
$throughput = node scripts/adaptive-throughput.js plan $throughputFile $previousConclusion | ConvertFrom-Json
$env:CRUCIBLE_PDF_PAGES_PER_BATCH = [string]$throughput.pagesPerDocument
Write-Output "Adaptive extraction plan: maxSources=25 maxDocuments=9 pagesPerDocument=$($throughput.pagesPerDocument) previousConclusion=$previousConclusion"
$env:CRUCIBLE_PYTHON = (Get-Command python).Source
Push-Location crucible-engine
try { node src/claimExtractionWorkerCli.js readiness; if ($LASTEXITCODE -ne 0) { throw 'Extraction readiness failed.' }; node src/claimExtractionWorkerCli.js run; if ($LASTEXITCODE -ne 0) { throw 'Extraction failed.' } } finally { Pop-Location }
$durationSeconds = [Math]::Round(((Get-Date) - $runStartedAt).TotalSeconds, 3)
node scripts/adaptive-throughput.js complete $throughputFile $durationSeconds | Out-Null
Write-Output "Adaptive extraction result: durationSeconds=$durationSeconds statePersisted=true"
$stateStage = Join-Path $workspace 'state-stage'; New-Item -ItemType Directory -Path (Join-Path $stateStage 'sources') -Force | Out-Null
Copy-Item -LiteralPath $queueFile -Destination (Join-Path $stateStage 'sources\source-queue.json')
Get-ChildItem -LiteralPath $learningRoot -File -Filter '*.learning.json' | Copy-Item -Destination $stateStage
Copy-Item -LiteralPath $throughputFile -Destination $stateStage
if (Test-Path -LiteralPath $oversightApprovalFile) { Copy-Item -LiteralPath $oversightApprovalFile -Destination $stateStage }
Compress-Archive -Path (Join-Path $stateStage '*') -DestinationPath $stateZip -CompressionLevel Optimal -Force
Remove-Item -LiteralPath $encryptedState -Force
node scripts/crypt-bundle.js encrypt $stateZip $encryptedState
gh release upload worker-state $encryptedState --repo $env:GITHUB_REPOSITORY --clobber
