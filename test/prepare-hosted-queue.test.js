const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PROJECT, mergeQueue } = require('../scripts/prepare-hosted-queue');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function queue(items) {
  return { schemaVersion: 1, projectId: PROJECT, documents: items, links: [] };
}

function source(id, hash, state = 'claim-extraction-forced-pending') {
  return {
    id,
    contentSha256: hash,
    durablePath: `C:\\old\\${hash}.pdf`,
    state,
  };
}

function approvals(...hashes) {
  return {
    schemaVersion: 1,
    projectId: PROJECT,
    approvals: hashes.map((contentSha256) => ({
      contentSha256,
      decision: 'approved-for-extraction',
    })),
  };
}

test('fresh vetted membership wins while compatible prior progress is restored', () => {
  const current = queue([source('same', HASH_A), source('new', HASH_B)]);
  const priorSame = source('same', HASH_A, 'claim-extraction-in-progress');
  priorSame.claimExtraction = { nextPage: 71, candidateIds: ['candidate-1'] };
  const prior = queue([priorSame, source('removed', HASH_C, 'claim-extraction-complete')]);
  const result = mergeQueue({
    currentQueue: current,
    priorQueue: prior,
    approvals: approvals(HASH_A, HASH_B),
    sourcesRoot: path.resolve('hosted-sources'),
  });
  assert.deepEqual(result.queue.documents.map((item) => item.id), ['same', 'new']);
  assert.equal(result.queue.documents[0].state, 'claim-extraction-in-progress');
  assert.equal(result.queue.documents[0].claimExtraction.nextPage, 71);
  assert.equal(result.queue.documents[1].state, 'claim-extraction-forced-pending');
  assert.equal(result.restoredProgress, 1);
  assert.equal(result.actionable, 2);
});

test('changed content never inherits prior extraction progress', () => {
  const current = queue([source('changed', HASH_B)]);
  const priorSource = source('changed', HASH_A, 'claim-extraction-complete');
  priorSource.claimExtraction = { nextPage: null, candidateIds: ['stale'] };
  const result = mergeQueue({
    currentQueue: current,
    priorQueue: queue([priorSource]),
    approvals: approvals(HASH_B),
    sourcesRoot: path.resolve('hosted-sources'),
  });
  assert.equal(result.queue.documents[0].state, 'claim-extraction-forced-pending');
  assert.equal(result.queue.documents[0].claimExtraction, undefined);
  assert.equal(result.restoredProgress, 0);
});

test('fresh terminal or blocked state is never regressed by prior progress', () => {
  const freshComplete = source('complete', HASH_A, 'claim-extraction-complete');
  freshComplete.claimExtraction = { nextPage: null, candidateIds: ['fresh'] };
  const freshBlocked = source('blocked', HASH_B, 'retrieval-blocked');
  const priorComplete = source('complete', HASH_A, 'claim-extraction-forced-pending');
  priorComplete.claimExtraction = { nextPage: 71, candidateIds: ['prior'] };
  const priorBlocked = source('blocked', HASH_B, 'claim-extraction-complete');
  const result = mergeQueue({
    currentQueue: queue([freshComplete, freshBlocked]),
    priorQueue: queue([priorComplete, priorBlocked]),
    approvals: approvals(HASH_A, HASH_B),
    sourcesRoot: path.resolve('hosted-sources'),
  });
  assert.equal(result.queue.documents[0].state, 'claim-extraction-complete');
  assert.deepEqual(result.queue.documents[0].claimExtraction.candidateIds, ['fresh']);
  assert.equal(result.queue.documents[1].state, 'retrieval-blocked');
  assert.equal(result.restoredProgress, 0);
});

test('all unapproved extraction states including complete are inhibited', () => {
  const result = mergeQueue({
    currentQueue: queue([source('complete', HASH_A, 'claim-extraction-complete')]),
    approvals: approvals(),
    sourcesRoot: path.resolve('hosted-sources'),
  });
  assert.equal(result.queue.documents[0].state, 'oversight-vetting-pending');
  assert.equal(result.queue.documents[0].oversightVetting.priorState, 'claim-extraction-complete');
  assert.equal(result.inhibited, 1);
});

test('queue and approval identity mismatches fail closed', () => {
  assert.throws(
    () => mergeQueue({
      currentQueue: { ...queue([]), projectId: 'wrong' },
      approvals: approvals(),
      sourcesRoot: path.resolve('hosted-sources'),
    }),
    /identity or schema mismatch/,
  );
  assert.throws(
    () => mergeQueue({
      currentQueue: queue([]),
      approvals: { ...approvals(), projectId: 'wrong' },
      sourcesRoot: path.resolve('hosted-sources'),
    }),
    /approval ledger is invalid/,
  );
});
