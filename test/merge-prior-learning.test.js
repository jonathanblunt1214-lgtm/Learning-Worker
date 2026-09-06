const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  carryForwardQuarantines,
  mergeCandidateOnly,
  quarantinePriorEnvelope,
} = require('../scripts/merge-prior-learning');

function candidate(id, claim = id) {
  return { id, claim };
}

function record(value, state = 'candidate', recordRevision = 0) {
  return { candidate: value, state, recordRevision };
}

class FakeStore {
  constructor(payload) {
    this.payload = structuredClone(payload);
  }
  read() {
    return structuredClone(this.payload);
  }
  ingestMany(candidates) {
    for (const value of candidates) this.payload.candidateRecords.push(record(value));
    return candidates;
  }
}

function store(records = [], knowledgeVersions = [], activeVersion = null) {
  return new FakeStore({ candidateRecords: records, knowledgeVersions, activeVersion });
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

test('candidate-only prior state is unioned into fresh vetted state', () => {
  const active = store([record(candidate('fresh'))]);
  const prior = store([record(candidate('fresh')), record(candidate('prior'))]);
  const result = mergeCandidateOnly({ activeStore: active, priorStore: prior, candidateDigest: digest });
  assert.deepEqual(active.read().candidateRecords.map((item) => item.candidate.id), ['fresh', 'prior']);
  assert.deepEqual(result, {
    summary: {
      imported: 1,
      duplicates: 1,
      priorCandidates: 2,
      quarantinedRecords: 0,
      quarantinedKnowledgeVersions: 0,
      quarantinedActiveVersion: false,
    },
    quarantineRequired: false,
  });
});

test('conflicting duplicate candidate bodies fail closed', () => {
  assert.throws(
    () => mergeCandidateOnly({
      activeStore: store([record(candidate('same', 'fresh body'))]),
      priorStore: store([record(candidate('same', 'prior body'))]),
      candidateDigest: digest,
    }),
    /conflicts with fresh vetted state/,
  );
});

test('advanced records and knowledge versions are excluded for quarantine', () => {
  const active = store();
  const result = mergeCandidateOnly({
    activeStore: active,
    priorStore: store(
      [record(candidate('advanced'), 'hypothesis', 1)],
      [{ version: 1 }],
      1,
    ),
    candidateDigest: digest,
  });
  assert.equal(active.read().candidateRecords.length, 0);
  assert.equal(result.summary.quarantinedRecords, 1);
  assert.equal(result.summary.quarantinedKnowledgeVersions, 1);
  assert.equal(result.summary.quarantinedActiveVersion, true);
  assert.equal(result.quarantineRequired, true);
});

test('identical advanced state already vetted as active is not quarantined again', () => {
  const advanced = record(candidate('advanced'), 'hypothesis', 1);
  const knowledge = { version: 1, claim: 'same' };
  const result = mergeCandidateOnly({
    activeStore: store([advanced], [knowledge], 1),
    priorStore: store([advanced], [knowledge], 1),
    candidateDigest: digest,
  });
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.quarantinedRecords, 0);
  assert.equal(result.summary.quarantinedKnowledgeVersions, 0);
  assert.equal(result.summary.quarantinedActiveVersion, false);
  assert.equal(result.quarantineRequired, false);
});

test('quarantine preserves the complete prior envelope and carries forward unchanged', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prior-quarantine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const priorFile = path.join(root, 'prior.learning.json');
  const activeRoot = path.join(root, 'active');
  const nextRoot = path.join(root, 'next');
  const projectId = 'github:jonathanblunt1214-lgtm/The-Crucible';
  const envelope = { schemaVersion: 1, payload: { advanced: true }, payloadSha256: 'a'.repeat(64) };
  fs.writeFileSync(priorFile, `${JSON.stringify(envelope, null, 2)}\n`);
  fs.mkdirSync(activeRoot);
  const created = quarantinePriorEnvelope({
    priorFile,
    activeRoot,
    projectId,
    digest,
  });
  assert.equal(created.created, true);
  const artifact = JSON.parse(fs.readFileSync(created.file, 'utf8'));
  assert.deepEqual(artifact.durableEnvelope, envelope);
  assert.equal(artifact.disposition, 'excluded-from-active-learning');
  assert.equal(carryForwardQuarantines({ priorRoot: activeRoot, activeRoot: nextRoot, projectId }), 1);
  const copied = path.join(nextRoot, path.basename(created.file));
  assert.ok(fs.readFileSync(created.file).equals(fs.readFileSync(copied)));
});
