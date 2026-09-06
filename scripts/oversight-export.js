const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const MAGIC = 'CRUCIBLE-WORKER-EXPORT-V1';
const PROJECT = 'github:jonathanblunt1214-lgtm/The-Crucible';
const REPOSITORY = 'jonathanblunt1214-lgtm/Learning-Worker';
const REF = 'refs/heads/main';
const TAG_BYTES = 16;

function shaFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function encryptionKey() {
  const value = Buffer.from(process.env.OVERSIGHT_WORKER_BUNDLE_KEY || '', 'base64');
  if (value.length !== 32) {
    throw new Error('OVERSIGHT_WORKER_BUNDLE_KEY must decode to exactly 32 bytes.');
  }
  return value;
}

function commit(value, label) {
  if (!/^[a-f0-9]{40}$/.test(value || '')) throw new Error(`${label} must be an exact Git commit.`);
  return value;
}

async function encrypt(input, output, { workerSha, vettedStateSha, now = new Date() }) {
  const iv = crypto.randomBytes(12);
  const header = {
    magic: MAGIC,
    schemaVersion: 1,
    algorithm: 'aes-256-gcm',
    stage: 'worker-candidate-export',
    projectId: PROJECT,
    repository: REPOSITORY,
    ref: REF,
    workerSha: commit(workerSha, 'workerSha'),
    vettedStateSha: commit(vettedStateSha, 'vettedStateSha'),
    generatedAt: now.toISOString(),
    plaintextSha256: shaFile(input),
    plaintextBytes: fs.statSync(input).size,
    iv: iv.toString('base64'),
  };
  const encoded = Buffer.from(`${JSON.stringify(header)}\n`);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(encoded);
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, encoded, { flag: 'wx', mode: 0o600 });
    await pipeline(
      fs.createReadStream(input),
      cipher,
      fs.createWriteStream(temporary, { flags: 'a', mode: 0o600 }),
    );
    fs.appendFileSync(temporary, cipher.getAuthTag());
    fs.renameSync(temporary, output);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return header;
}

async function decrypt(input, output) {
  const descriptor = fs.openSync(input, 'r');
  const probe = Buffer.alloc(8192);
  const count = fs.readSync(descriptor, probe, 0, probe.length, 0);
  fs.closeSync(descriptor);
  const newline = probe.subarray(0, count).indexOf(10);
  if (newline < 0) throw new Error('Worker export header is missing.');
  const encoded = probe.subarray(0, newline + 1);
  const header = JSON.parse(encoded.toString('utf8'));
  if (
    header.magic !== MAGIC ||
    header.schemaVersion !== 1 ||
    header.algorithm !== 'aes-256-gcm' ||
    header.stage !== 'worker-candidate-export' ||
    header.projectId !== PROJECT ||
    header.repository !== REPOSITORY ||
    header.ref !== REF
  ) {
    throw new Error('Worker export identity is invalid.');
  }
  commit(header.workerSha, 'workerSha');
  commit(header.vettedStateSha, 'vettedStateSha');
  const size = fs.statSync(input).size;
  const tag = Buffer.alloc(TAG_BYTES);
  const tagDescriptor = fs.openSync(input, 'r');
  fs.readSync(tagDescriptor, tag, 0, TAG_BYTES, size - TAG_BYTES);
  fs.closeSync(tagDescriptor);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(header.iv, 'base64'),
  );
  decipher.setAAD(encoded);
  decipher.setAuthTag(tag);
  await pipeline(
    fs.createReadStream(input, { start: encoded.length, end: size - TAG_BYTES - 1 }),
    decipher,
    fs.createWriteStream(output, { flags: 'wx', mode: 0o600 }),
  );
  if (fs.statSync(output).size !== header.plaintextBytes || shaFile(output) !== header.plaintextSha256) {
    throw new Error('Worker export plaintext custody failed.');
  }
  return header;
}

function split(input, root, header, maximum = 80 * 1024 * 1024) {
  fs.mkdirSync(root, { recursive: true });
  const size = fs.statSync(input).size;
  const descriptor = fs.openSync(input, 'r');
  const chunks = [];
  try {
    for (let offset = 0, index = 0; offset < size; index += 1) {
      const length = Math.min(maximum, size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const name = `worker-state.part-${String(index).padStart(4, '0')}.enc`;
      const file = path.join(root, name);
      fs.readSync(descriptor, buffer, 0, length, offset);
      fs.writeFileSync(file, buffer, { flag: 'wx', mode: 0o600 });
      chunks.push({ name, bytes: length, sha256: shaFile(file) });
      offset += length;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const manifest = {
    schemaVersion: 1,
    format: MAGIC,
    stage: header.stage,
    projectId: header.projectId,
    repository: header.repository,
    ref: header.ref,
    workerSha: header.workerSha,
    vettedStateSha: header.vettedStateSha,
    generatedAt: header.generatedAt,
    plaintextSha256: header.plaintextSha256,
    plaintextBytes: header.plaintextBytes,
    encryptedSha256: shaFile(input),
    encryptedBytes: size,
    chunks,
  };
  fs.writeFileSync(
    path.join(root, 'worker-export-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return manifest;
}

async function build(input, root, workerSha, vettedStateSha) {
  fs.mkdirSync(root, { recursive: true });
  const encrypted = path.join(root, 'worker-state.enc');
  const header = await encrypt(input, encrypted, { workerSha, vettedStateSha });
  const manifest = split(encrypted, root, header);
  fs.rmSync(encrypted, { force: true });
  return manifest;
}

async function main(argv = process.argv.slice(2)) {
  const [command, input, root, workerSha, vettedStateSha] = argv;
  if (command !== 'build' || !input || !root || !workerSha || !vettedStateSha) {
    throw new Error('Usage: oversight-export.js build <state-zip> <output-root> <worker-sha> <vetted-state-sha>');
  }
  process.stdout.write(`${JSON.stringify(await build(input, root, workerSha, vettedStateSha))}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { MAGIC, PROJECT, REPOSITORY, REF, build, decrypt, encrypt, shaFile, split };
