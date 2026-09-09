const fs = require('node:fs');
const path = require('node:path');

function candidateMatchesCurrentSource(record, sourceContentById) {
  if (!sourceContentById) return true;
  const provenance = record?.candidate?.provenance;
  return sourceContentById.get(String(provenance?.sourceId)) === provenance?.contentSha256;
}

function mergeCandidateOnly({ activeStore, priorStore, candidateDigest, sourceContentById = null }) {
  const active = activeStore.read();
  const prior = priorStore.read();
  const activeById = new Map(
    active.candidateRecords.map((record) => [record.candidate.id, record]),
  );
  const missing = [];
  let duplicates = 0;
  let quarantinedRecords = 0;

  for (const record of prior.candidateRecords) {
    if (record.state !== 'candidate' || (record.recordRevision ?? 0) !== 0 || !candidateMatchesCurrentSource(record, sourceContentById)) {
      const authoritative = activeById.get(record.candidate.id);
      if (authoritative && candidateDigest(authoritative) === candidateDigest(record)) {
        duplicates += 1;
        continue;
      }
      quarantinedRecords += 1;
      continue;
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
  const activeKnowledge = new Set(active.knowledgeVersions.map(candidateDigest));
  const quarantinedKnowledgeVersions = prior.knowledgeVersions.filter(
    (version) => !activeKnowledge.has(candidateDigest(version)),
  ).length;
  const quarantinedActiveVersion =
    prior.activeVersion !== null && prior.activeVersion !== active.activeVersion;
  return {
    summary: {
      imported: missing.length,
      duplicates,
      priorCandidates: prior.candidateRecords.length,
      quarantinedRecords,
      quarantinedKnowledgeVersions,
      quarantinedActiveVersion,
    },
    quarantineRequired:
      quarantinedRecords > 0 ||
      quarantinedKnowledgeVersions > 0 ||
      quarantinedActiveVersion,
  };
}

function sanitizeActiveCandidateCustody({ activeFile, activeRoot, projectId, digest, sourceContentById }) {
  if (!fs.existsSync(activeFile)) return 0;
  const envelope = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
  if (envelope?.schemaVersion !== 1 || envelope?.payload?.projectId !== projectId || envelope.payloadSha256 !== digest(envelope.payload)) {
    throw new Error('Active vetted learning envelope is invalid.');
  }
  const records = envelope.payload.candidateRecords;
  if (!Array.isArray(records)) throw new Error('Active vetted candidate records are invalid.');
  const retained = records.filter((record) => candidateMatchesCurrentSource(record, sourceContentById));
  const removed = records.length - retained.length;
  if (removed === 0) return 0;
  quarantinePriorEnvelope({ priorFile: activeFile, activeRoot, projectId, digest });
  envelope.payload.candidateRecords = retained;
  envelope.payloadSha256 = digest(envelope.payload);
  writeJsonAtomic(`${activeFile}.sanitized`, envelope);
  fs.renameSync(`${activeFile}.sanitized`, activeFile);
  return removed;
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function carryForwardQuarantines({ priorRoot, activeRoot, projectId }) {
  if (!fs.existsSync(priorRoot)) return 0;
  fs.mkdirSync(activeRoot, { recursive: true });
  let retained = 0;
  for (const entry of fs.readdirSync(priorRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.quarantine.json')) continue;
    const source = path.join(priorRoot, entry.name);
    const payload = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (
      payload?.schemaVersion !== 1 ||
      payload?.projectId !== projectId ||
      payload?.disposition !== 'excluded-from-active-learning'
    ) {
      throw new Error(`Prior quarantine artifact is invalid: ${entry.name}`);
    }
    const destination = path.join(activeRoot, entry.name);
    if (fs.existsSync(destination)) {
      if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) {
        throw new Error(`Prior quarantine artifact conflicts with active state: ${entry.name}`);
      }
    } else {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
    retained += 1;
  }
  return retained;
}

function readQuarantinePayloads({ root, projectId, digest }) {
  if (!fs.existsSync(root)) return [];
  const payloads = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.quarantine.json')) continue;
    const artifact = JSON.parse(fs.readFileSync(path.join(root, entry.name), 'utf8'));
    const envelope = artifact?.durableEnvelope;
    if (
      artifact?.schemaVersion !== 1 ||
      artifact?.projectId !== projectId ||
      artifact?.disposition !== 'excluded-from-active-learning' ||
      envelope?.schemaVersion !== 1 ||
      envelope?.payload?.projectId !== projectId ||
      envelope?.payloadSha256 !== digest(envelope.payload)
    ) {
      throw new Error(`Prior quarantine envelope is invalid: ${entry.name}`);
    }
    payloads.push(structuredClone(envelope.payload));
  }
  return payloads;
}

function quarantinePriorEnvelope({ priorFile, activeRoot, projectId, digest }) {
  const rawEnvelope = fs.readFileSync(priorFile, 'utf8');
  const priorEnvelopeSha256 = digest(rawEnvelope);
  const file = path.join(
    activeRoot,
    `prior-learning-${priorEnvelopeSha256}.quarantine.json`,
  );
  if (!fs.existsSync(file)) {
    writeJsonAtomic(file, {
      schemaVersion: 1,
      projectId,
      disposition: 'excluded-from-active-learning',
      reason: 'owner-approved quarantine of advanced prior worker state',
      priorEnvelopeSha256,
      durableEnvelope: JSON.parse(rawEnvelope),
    });
    return { file, created: true };
  }
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    existing?.projectId !== projectId ||
    existing?.priorEnvelopeSha256 !== priorEnvelopeSha256 ||
    existing?.disposition !== 'excluded-from-active-learning'
  ) {
    throw new Error('Existing prior-state quarantine artifact conflicts with this envelope.');
  }
  return { file, created: false };
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
  const queue = JSON.parse(fs.readFileSync(path.join(activeRoot, 'sources', 'source-queue.json'), 'utf8'));
  const sourceContentById = new Map([...queue.documents, ...queue.links].map((source) => [String(source.id), source.contentSha256]));
  const activeFile = path.join(path.resolve(activeRoot), `${sha(projectId)}.learning.json`);
  const staleActiveCandidatesQuarantined = sanitizeActiveCandidateCustody({ activeFile, activeRoot, projectId, digest: sha, sourceContentById });
  const quarantinesRetained = carryForwardQuarantines({ priorRoot, activeRoot, projectId });
  const quarantinePayloads = readQuarantinePayloads({ root: priorRoot, projectId, digest: sha });
  const priorFile = path.join(path.resolve(priorRoot), `${sha(projectId)}.learning.json`);
  if (!fs.existsSync(priorFile) && quarantinePayloads.length === 0) {
    const result = {
      imported: 0,
      duplicates: 0,
      priorCandidates: 0,
      quarantinedRecords: 0,
      quarantinedKnowledgeVersions: 0,
      quarantinedActiveVersion: false,
      quarantinesRetained,
      quarantineCreated: false,
      recoveredFromQuarantine: 0,
      staleActiveCandidatesQuarantined,
      priorStateAvailable: false,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  const activeStore = new DurableScientificLearningStore({ root: activeRoot, projectId });
  let recoveredFromQuarantine = 0;
  for (const payload of quarantinePayloads) {
    const recovery = mergeCandidateOnly({
      activeStore,
      priorStore: { read: () => structuredClone(payload) },
      candidateDigest: sha,
      sourceContentById,
    });
    recoveredFromQuarantine += recovery.summary.imported;
  }
  if (!fs.existsSync(priorFile)) {
    const result = {
      imported: 0,
      duplicates: 0,
      priorCandidates: 0,
      quarantinedRecords: 0,
      quarantinedKnowledgeVersions: 0,
      quarantinedActiveVersion: false,
      quarantinesRetained,
      quarantineCreated: false,
      recoveredFromQuarantine,
      staleActiveCandidatesQuarantined,
      priorStateAvailable: true,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  const priorStore = new DurableScientificLearningStore({ root: priorRoot, projectId });
  const merge = mergeCandidateOnly({ activeStore, priorStore, candidateDigest: sha, sourceContentById });
  const quarantine = merge.quarantineRequired
    ? quarantinePriorEnvelope({ priorFile, activeRoot, projectId, digest: sha })
    : null;
  const result = {
    ...merge.summary,
    quarantinesRetained,
    quarantineCreated: Boolean(quarantine?.created),
    recoveredFromQuarantine,
    staleActiveCandidatesQuarantined,
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

module.exports = {
  carryForwardQuarantines,
  candidateMatchesCurrentSource,
  mergeCandidateOnly,
  quarantinePriorEnvelope,
  readQuarantinePayloads,
  sanitizeActiveCandidateCustody,
  main,
};
