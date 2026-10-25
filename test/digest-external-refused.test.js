// CR-6A-003 (25 Okt 2026): `council digest --run <folder> --provider external --model <anything>` made the digest's one call to an external seat, which throws ExternalPause (control flow); the digest now lets control flow through, and the CLI's catch handles only
// BudgetExceeded and SecretShapedPrompt, so the command ended in a stack trace (exit 1) and no digest.md; before 0.8.3 it wrote the free template. An external seat cannot answer a digest call (it would have to pause the run), so the flag is refused up front
// with a plain sentence. Offline, $0: real verbs on a finished mock run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-18T07-00-00-000Z';

test('DX-1 (CR-6A-003, real verbs): digest --provider external is refused with a plain sentence (exit 2), nothing is written, and the free template still works without the flag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-digest-ext-')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  const first = spawnSync(process.execPath, [cli, '--chain', 'mock', '--task', 'tasks/x.md', '--run-id', RUN], { cwd: dir, encoding: 'utf8', env });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const rd = join('runs', RUN);
  const refused = spawnSync(process.execPath, [cli, 'digest', '--run', rd, '--provider', 'external', '--model', 'x'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /digest: --provider external is not available: an external seat is answered by hand and a digest call cannot pause for it\. .* Nothing was sent\./);
  assert.doesNotMatch(refused.stderr, /ExternalPause|at invoke|node:internal/, 'no stack trace');
  assert.equal(existsSync(join(dir, rd, 'digest.md')), false, 'nothing was written');
  const plain = spawnSync(process.execPath, [cli, 'digest', '--run', rd], { cwd: dir, encoding: 'utf8', env });
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.ok(readdirSync(join(dir, rd)).includes('digest.md'), 'the free template is still written without the flag');
});
