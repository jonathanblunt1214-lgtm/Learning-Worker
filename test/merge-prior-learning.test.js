const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mergeCandidateOnly } = require('../scripts/merge-prior-learning');

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
  assert.deepEqual(result, { imported: 1, duplicates: 1, priorCandidates: 2 });
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

test('advanced records and knowledge versions cannot cross the custody boundary', () => {
  assert.throws(
    () => mergeCandidateOnly({
      activeStore: store(),
      priorStore: store([record(candidate('advanced'), 'hypothesis', 1)]),
      candidateDigest: digest,
    }),
    /advanced beyond candidate-only state/,
  );
  assert.throws(
    () => mergeCandidateOnly({
      activeStore: store(),
      priorStore: store([], [{ version: 1 }], 1),
      candidateDigest: digest,
    }),
    /knowledge versions/,
  );
});
