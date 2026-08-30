param(
  [Parameter(Mandatory = $true)]
  [string]$EnginePath
)

$ErrorActionPreference = 'Stop'
$expectedRepository = 'jonathanblunt1214-lgtm/Learning-Worker'
$projectId = 'github:jonathanblunt1214-lgtm/The-Crucible'
$learningRoot = Join-Path $env:LOCALAPPDATA 'The-Crucible\scientific-learning'
$queueFile = Join-Path $learningRoot 'sources\source-queue.json'
$killSwitch = Join-Path $learningRoot 'EXTRACTION-KILL'
$nodeExecutable = 'C:\Users\jonat\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$pythonExecutable = 'C:\Users\jonat\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

if ($env:GITHUB_REPOSITORY -ne $expectedRepository) {
  throw "Refusing unexpected repository identity."
}
if ($env:RUNNER_OS -ne 'Windows') {
  throw "The learning worker requires its dedicated Windows runner."
}
if (Test-Path -LiteralPath $killSwitch) {
  Write-Host '[Learning Worker] Extraction kill switch is active; exiting without changes.'
  exit 0
}
foreach ($requiredPath in @($EnginePath, $queueFile, $nodeExecutable, $pythonExecutable)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required configured path is unavailable."
  }
}

$queue = Get-Content -Raw -LiteralPath $queueFile | ConvertFrom-Json
if ($queue.schemaVersion -ne 1 -or $queue.projectId -ne $projectId) {
  throw "Source queue identity or schema does not match The Crucible."
}

$env:CRUCIBLE_LEARNING_PROJECT_ID = $projectId
$env:CRUCIBLE_LEARNING_ROOT = $learningRoot
$env:CRUCIBLE_SOURCE_QUEUE = $queueFile
$env:CRUCIBLE_EXTRACTION_BATCH_SIZE = '25'
$env:CRUCIBLE_PDF_PAGES_PER_BATCH = '20'
$env:CRUCIBLE_PYTHON = $pythonExecutable

Push-Location -LiteralPath $EnginePath
try {
  & $nodeExecutable src/claimExtractionWorkerCli.js readiness
  if ($LASTEXITCODE -ne 0) { throw "Extraction readiness failed." }
  & $nodeExecutable src/claimExtractionWorkerCli.js run
  if ($LASTEXITCODE -ne 0) { throw "Extraction run failed." }
} finally {
  Pop-Location
}
