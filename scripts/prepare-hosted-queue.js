const fs = require('node:fs');
const path = require('node:path');

const PROJECT = 'github:jonathanblunt1214-lgtm/The-Crucible';
const EXTRACTION_STATES = new Set([
  'claim-extraction-forced-pending',
  'claim-extraction-in-progress',
  'claim-extraction-complete',
]);
const PROGRESS_STATES = new Set([
  'claim-extraction-forced-pending',
  'claim-extraction-in-progress',
  'claim-extraction-complete',
]);

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`);
  }
}

function sources(queue) {
  if (!Array.isArray(queue.documents) || !Array.isArray(queue.links)) {
    throw new Error('Queue source collections are invalid.');
  }
  return [...queue.documents, ...queue.links];
}

function validateQueue(queue, label) {
  if (queue?.schemaVersion !== 1 || queue?.projectId !== PROJECT) {
    throw new Error(`${label} identity or schema mismatch.`);
  }
  const ids = new Set();
  for (const source of sources(queue)) {
    if (typeof source?.id !== 'string' || ids.has(source.id)) {
      throw new Error(`${label} contains a missing or duplicate source id.`);
    }
    ids.add(source.id);
  }
  return queue;
}

function validateApprovals(approvals) {
  if (
    approvals?.schemaVersion !== 1 ||
    approvals?.projectId !== PROJECT ||
    !Array.isArray(approvals.approvals)
  ) {
    throw new Error('Independent oversight approval ledger is invalid.');
  }
  return new Set(
    approvals.approvals
      .filter(
        (item) =>
          item?.decision === 'approved-for-extraction' &&
          /^[a-f0-9]{64}$/.test(item.contentSha256 || ''),
      )
      .map((item) => item.contentSha256),
  );
}

function compatibleProgress(current, prior) {
  return Boolean(
    prior &&
      current.contentSha256 &&
      current.contentSha256 === prior.contentSha256 &&
      PROGRESS_STATES.has(current.state) &&
      PROGRESS_STATES.has(prior.state),
  );
}

function progressScore(source) {
  if (source.state === 'claim-extraction-complete') return Number.MAX_SAFE_INTEGER;
  const progress = source.claimExtraction || {};
  const nextPage = Number.isSafeInteger(progress.nextPage) ? progress.nextPage : 0;
  const windows = Array.isArray(progress.windows) ? progress.windows.length : 0;
  const candidates = Array.isArray(progress.candidateIds) ? progress.candidateIds.length : 0;
  return nextPage * 1_000_000 + windows * 1_000 + candidates;
}

function mergeQueue({ currentQueue, priorQueue = null, approvals, sourcesRoot }) {
  const current = validateQueue(structuredClone(currentQueue), 'Current vetted queue');
  const prior = priorQueue
    ? validateQueue(structuredClone(priorQueue), 'Prior worker queue')
    : null;
  const allowed = validateApprovals(approvals);
  const priorById = new Map(prior ? sources(prior).map((source) => [source.id, source]) : []);
  const resolvedRoot = path.resolve(sourcesRoot);
  let restoredProgress = 0;
  let inhibited = 0;

  for (const source of sources(current)) {
    const priorSource = priorById.get(source.id);
    if (compatibleProgress(source, priorSource) && progressScore(priorSource) > progressScore(source)) {
      source.state = priorSource.state;
      if (priorSource.claimExtraction) {
        source.claimExtraction = structuredClone(priorSource.claimExtraction);
      } else {
        delete source.claimExtraction;
      }
      restoredProgress += 1;
    }

    if (source.contentSha256 && source.durablePath) {
      const extension = path.extname(source.durablePath).toLowerCase();
      const hostedPath = path.resolve(resolvedRoot, `${source.contentSha256}${extension}`);
      if (!hostedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Unsafe hosted source path.');
      }
      source.durablePath = hostedPath;
    }

    const approved = allowed.has(source.contentSha256);
    if (!approved && EXTRACTION_STATES.has(source.state)) {
      source.oversightVetting = {
        state: 'pending',
        contentSha256: source.contentSha256 || null,
        priorState: source.state,
      };
      source.state = 'oversight-vetting-pending';
      inhibited += 1;
    } else if (
      approved &&
      source.state === 'oversight-vetting-pending' &&
      source.oversightVetting?.contentSha256 === source.contentSha256
    ) {
      source.state = source.oversightVetting.priorState || 'claim-extraction-forced-pending';
      source.oversightVetting = { ...source.oversightVetting, state: 'approved' };
    }
  }

  const actionable = sources(current).filter((source) =>
    ['claim-extraction-forced-pending', 'claim-extraction-in-progress'].includes(source.state),
  ).length;
  return { queue: current, restoredProgress, inhibited, actionable };
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function main(argv = process.argv.slice(2)) {
  const [queueFile, sourcesRoot, approvalFile, priorQueueFile] = argv;
  if (!queueFile || !sourcesRoot || !approvalFile) {
    throw new Error(
      'Usage: prepare-hosted-queue.js <queue-file> <sources-root> <oversight-approval-file> [prior-queue-file]',
    );
  }
  const currentQueue = readJson(queueFile, 'Current vetted queue');
  const approvals = fs.existsSync(approvalFile)
    ? readJson(approvalFile, 'Independent oversight approval ledger')
    : { schemaVersion: 1, projectId: PROJECT, approvals: [] };
  const priorQueue = priorQueueFile && fs.existsSync(priorQueueFile)
    ? readJson(priorQueueFile, 'Prior worker queue')
    : null;
  const result = mergeQueue({ currentQueue, priorQueue, approvals, sourcesRoot });
  writeJsonAtomic(queueFile, result.queue);
  const summary = {
    restoredProgress: result.restoredProgress,
    inhibited: result.inhibited,
    actionable: result.actionable,
    priorStateAvailable: Boolean(priorQueue),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { PROJECT, mergeQueue, main };
