const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('hosted extraction keeps prior state separate from fresh vetted state', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'run-hosted-extraction.ps1'), 'utf8');
  assert.match(script, /prior-learning/);
  assert.match(script, /Expand-Archive[^\r\n]+\$priorLearningRoot -Force/);
  assert.doesNotMatch(script, /Expand-Archive[^\r\n]+\$learningRoot -Force/);
  assert.match(script, /prepare-hosted-queue\.js[^\r\n]+\$priorQueueFile/);
  assert.match(script, /merge-prior-learning\.js/);
  assert.match(script, /Get-ChildItem[^\r\n]+\*\.quarantine\.json[^\r\n]+Copy-Item/);
});

test('hosted extraction fails zero throughput with actionable backlog after persisting artifacts', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'run-hosted-extraction.ps1'), 'utf8');
  assert.match(script, /actionable -gt 0 -and \$extractionResult\.processed -eq 0/);
  assert.match(script, /blocked every processed source/);
  assert.match(script, /\$extractionOutput -join \[Environment\]::NewLine/);
  assert.ok(
    script.indexOf('gh release upload worker-state') < script.lastIndexOf('throw $pipelineFailure'),
    'encrypted state must be uploaded before the run reports its original pipeline failure',
  );
});

test('adaptive throughput selects exactly one prior completed run on Windows PowerShell', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'run-hosted-extraction.ps1'), 'utf8');
  assert.match(script, /foreach \(\$candidateRun in \$priorRuns\)/);
  assert.match(script, /\$priorRun = \$candidateRun\r?\n    break/);
  assert.doesNotMatch(script, /ConvertFrom-Json \| Where-Object/);
});

test('workflow runs worker regression tests before hosted extraction', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'extract.yml'), 'utf8');
  assert.match(workflow, /permissions:\r?\n  actions: read\r?\n  contents: write/);
  assert.ok(workflow.indexOf('Run worker regression tests') < workflow.indexOf('Run deterministic encrypted hosted extraction'));
});

test('hosted extraction publishes a separate candidate-only export for oversight', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'run-hosted-extraction.ps1'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'extract.yml'), 'utf8');
  assert.match(workflow, /OVERSIGHT_WORKER_BUNDLE_KEY/);
  assert.match(script, /oversight-state-stage/);
  assert.match(script, /oversight-export\.js build/);
  assert.match(script, /HEAD:oversight-export/);
  assert.match(script, /\$ErrorActionPreference = 'Continue'[\s\S]*?\$exportBranchExists = \$LASTEXITCODE -eq 0[\s\S]*?\$ErrorActionPreference = \$priorErrorActionPreference/);
  assert.doesNotMatch(script, /Get-ChildItem[^\r\n]+\.quarantine\.json[^\r\n]+\$oversightStage/);
  assert.ok(
    script.indexOf('HEAD:oversight-export') < script.lastIndexOf('throw $pipelineFailure'),
    'candidate export must remain additive to the original pipeline result',
  );
});
