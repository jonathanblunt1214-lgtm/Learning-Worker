$ErrorActionPreference = 'Stop'
$projectId = 'github:jonathanblunt1214-lgtm/The-Crucible'
$workspace = $env:RUNNER_TEMP
$encryptedState = Join-Path $workspace 'state.zip.enc'
$stateZip = Join-Path $workspace 'state.zip'
$sourceTar = Join-Path $workspace 'vetted-source-bundle.tar.gz'
$vettedRoot = Join-Path $workspace 'vetted-source-root'
$learningRoot = Join-Path $workspace 'learning'
$priorLearningRoot = Join-Path $workspace 'prior-learning'
$sourcesRoot = Join-Path $vettedRoot 'sources'
$queueFile = Join-Path $learningRoot 'sources\source-queue.json'
$priorQueueFile = Join-Path $priorLearningRoot 'sources\source-queue.json'
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
$vettedStateSha = (git -C vetted-state rev-parse HEAD).Trim()
$vettedReport = Get-Content -Raw (Join-Path (Get-Location) 'vetted-state\encrypted-custody-report.json') | ConvertFrom-Json
Write-Output "Vetted custody lineage: commit=$vettedStateSha generatedAt=$($vettedReport.generatedAt)"
New-Item -ItemType Directory -Path $vettedRoot -Force | Out-Null
tar -xzf $sourceTar -C $vettedRoot
New-Item -ItemType Directory -Path (Split-Path $queueFile) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $vettedRoot 'source-queue.json') -Destination $queueFile
Get-ChildItem -LiteralPath $vettedRoot -File -Filter '*.learning.json' | Copy-Item -Destination $learningRoot
$priorStateAvailable = $true
try { gh release download worker-state --repo $env:GITHUB_REPOSITORY --pattern 'state.zip.enc' --dir $workspace --clobber } catch { $priorStateAvailable = $false }
if ($priorStateAvailable -and (Test-Path -LiteralPath $encryptedState)) {
  node scripts/crypt-bundle.js decrypt $encryptedState $stateZip
  if ($LASTEXITCODE -ne 0) { throw 'Prior encrypted worker state could not be authenticated.' }
  New-Item -ItemType Directory -Path $priorLearningRoot -Force | Out-Null
  Expand-Archive -LiteralPath $stateZip -DestinationPath $priorLearningRoot -Force
}
Copy-Item -LiteralPath $vettedApprovalFile -Destination $oversightApprovalFile -Force
Remove-Item -LiteralPath $oversightPublicKey -Force
$queuePreparation = node scripts/prepare-hosted-queue.js $queueFile $sourcesRoot $oversightApprovalFile $priorQueueFile | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Hosted queue preparation failed.' }
$learningMerge = node scripts/merge-prior-learning.js (Join-Path (Get-Location) 'crucible-engine') $learningRoot $priorLearningRoot $projectId | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Prior candidate merge failed.' }
Write-Output "Hosted state merge: actionable=$($queuePreparation.actionable) restoredProgress=$($queuePreparation.restoredProgress) importedCandidates=$($learningMerge.imported) quarantinedRecords=$($learningMerge.quarantinedRecords) quarantinedKnowledgeVersions=$($learningMerge.quarantinedKnowledgeVersions) quarantinedActiveVersion=$($learningMerge.quarantinedActiveVersion)"
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
$pipelineFailure = $null
$extractionResult = $null
Push-Location crucible-engine
try {
  node src/claimExtractionWorkerCli.js readiness
  if ($LASTEXITCODE -ne 0) {
    $pipelineFailure = 'Extraction readiness failed.'
  } else {
    $extractionOutput = @(node src/claimExtractionWorkerCli.js run)
    $extractionExitCode = $LASTEXITCODE
    $extractionOutput | ForEach-Object { Write-Output $_ }
    if ($extractionExitCode -ne 0) {
      $pipelineFailure = 'Extraction failed.'
    } else {
      $extractionResult = ($extractionOutput -join [Environment]::NewLine) | ConvertFrom-Json
      if ($queuePreparation.actionable -gt 0 -and $extractionResult.processed -eq 0) {
        $pipelineFailure = "Extraction processed zero sources while $($queuePreparation.actionable) actionable sources were queued."
      } elseif ($extractionResult.processed -gt 0 -and ($extractionResult.completed + $extractionResult.continuing) -eq 0) {
        $pipelineFailure = "Extraction blocked every processed source ($($extractionResult.blocked) blocked)."
      }
    }
  }
} finally { Pop-Location }
$durationSeconds = [Math]::Round(((Get-Date) - $runStartedAt).TotalSeconds, 3)
if (-not $pipelineFailure) { node scripts/adaptive-throughput.js complete $throughputFile $durationSeconds | Out-Null }
$artifactFailure = $null
try {
  $stateStage = Join-Path $workspace 'state-stage'; New-Item -ItemType Directory -Path (Join-Path $stateStage 'sources') -Force | Out-Null
  Copy-Item -LiteralPath $queueFile -Destination (Join-Path $stateStage 'sources\source-queue.json')
  Get-ChildItem -LiteralPath $learningRoot -File -Filter '*.learning.json' | Copy-Item -Destination $stateStage
  Get-ChildItem -LiteralPath $learningRoot -File -Filter '*.quarantine.json' | Copy-Item -Destination $stateStage
  Copy-Item -LiteralPath $throughputFile -Destination $stateStage
  if (Test-Path -LiteralPath $oversightApprovalFile) { Copy-Item -LiteralPath $oversightApprovalFile -Destination $stateStage }
  Compress-Archive -Path (Join-Path $stateStage '*') -DestinationPath $stateZip -CompressionLevel Optimal -Force
  Remove-Item -LiteralPath $encryptedState -Force
  node scripts/crypt-bundle.js encrypt $stateZip $encryptedState
  if ($LASTEXITCODE -ne 0) { throw 'Worker state encryption failed.' }
  gh release upload worker-state $encryptedState --repo $env:GITHUB_REPOSITORY --clobber
  if ($LASTEXITCODE -ne 0) { throw 'Encrypted worker state upload failed.' }
  Write-Output "Adaptive extraction result: durationSeconds=$durationSeconds statePersisted=true"
} catch {
  $artifactFailure = $_.Exception.Message
}
if ($pipelineFailure -and $artifactFailure) { Write-Warning "Additive state persistence also failed: $artifactFailure" }
if ($pipelineFailure) { throw $pipelineFailure }
if ($artifactFailure) { throw $artifactFailure }
