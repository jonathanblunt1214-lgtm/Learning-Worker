const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, decrypt, shaFile } = require('../scripts/oversight-export');

test('builds a commit-bound encrypted candidate export for independent oversight', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-export-'));
  const input = path.join(root, 'state.zip');
  const output = path.join(root, 'output');
  const restored = path.join(root, 'restored.zip');
  fs.writeFileSync(input, Buffer.from('candidate-only worker state'));
  process.env.OVERSIGHT_WORKER_BUNDLE_KEY = crypto.randomBytes(32).toString('base64');
  const workerSha = 'a'.repeat(40);
  const vettedStateSha = 'b'.repeat(40);

  const manifest = await build(input, output, workerSha, vettedStateSha);
  assert.equal(manifest.workerSha, workerSha);
  assert.equal(manifest.vettedStateSha, vettedStateSha);
  assert.equal(manifest.plaintextSha256, shaFile(input));
  assert.equal(manifest.chunks.length, 1);
  assert.match(manifest.chunks[0].name, /^worker-state\.part-0000\.enc$/);

  const encrypted = path.join(root, 'joined.enc');
  fs.copyFileSync(path.join(output, manifest.chunks[0].name), encrypted);
  const header = await decrypt(encrypted, restored);
  assert.equal(header.workerSha, workerSha);
  assert.ok(fs.readFileSync(input).equals(fs.readFileSync(restored)));
});
