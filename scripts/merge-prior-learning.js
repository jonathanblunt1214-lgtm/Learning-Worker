const fs = require('node:fs');
const path = require('node:path');

function mergeCandidateOnly({ activeStore, priorStore, candidateDigest }) {
  const active = activeStore.read();
  const prior = priorStore.read();
  if (prior.knowledgeVersions.length || prior.activeVersion !== null) {
    throw new Error('Prior worker state contains knowledge versions; automatic merge is forbidden.');
  }

  const activeById = new Map(
    active.candidateRecords.map((record) => [record.candidate.id, record]),
  );
  const missing = [];
  let duplicates = 0;

  for (const record of prior.candidateRecords) {
    if (record.state !== 'candidate' || record.recordRevision !== 0) {
      throw new Error(
        `Prior worker record ${record.candidate.id} advanced beyond candidate-only state.`,
      );
    }
    const existing = activeById.get(record.candidate.id);
    if (existing) {
      if (candidateDigest(existing.candidate) !== candidateDigest(record.candidate)) {
        throw new Error(`Candidate ${record.candidate.id} conflicts with fresh vetted state.`);
      }
      duplicates += 1;
    } else {
      missing.push(record.candidate);
    }
  }

  activeStore.ingestMany(missing);
  return { imported: missing.length, duplicates, priorCandidates: prior.candidateRecords.length };
}

function main(argv = process.argv.slice(2)) {
  const [engineRoot, activeRoot, priorRoot, projectId] = argv;
  if (!engineRoot || !activeRoot || !priorRoot || !projectId) {
    throw new Error(
      'Usage: merge-prior-learning.js <crucible-engine-root> <active-root> <prior-root> <project-id>',
    );
  }
  const scientificLearning = require(path.resolve(engineRoot, 'src', 'scientificLearning.js'));
  const { DurableScientificLearningStore, sha } = scientificLearning;
  const priorFile = path.join(path.resolve(priorRoot), `${sha(projectId)}.learning.json`);
  if (!fs.existsSync(priorFile)) {
    const result = { imported: 0, duplicates: 0, priorCandidates: 0, priorStateAvailable: false };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  const activeStore = new DurableScientificLearningStore({ root: activeRoot, projectId });
  const priorStore = new DurableScientificLearningStore({ root: priorRoot, projectId });
  const result = {
    ...mergeCandidateOnly({ activeStore, priorStore, candidateDigest: sha }),
    priorStateAvailable: true,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { mergeCandidateOnly, main };
