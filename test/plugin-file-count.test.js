// 0.8.1 M9 (plan M9 Work 4, MAN-6 declined = DR-17 option (a)): the file count of the npm package is a checked condition, at most 512 (the limit the
// plugin directory's submission asks for). The repository root stays the plugin, so the tracked-file count (654 at M9's entry) is not the checked
// number. Offline: `npm pack --dry-run` writes no tarball and calls no registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 512;

test(`the npm package holds at most ${LIMIT} files (npm pack --dry-run --json)`, () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const [pack] = JSON.parse(out.slice(out.indexOf('[')));
  const count = pack.files.length;
  assert.ok(count <= LIMIT, `the npm package has ${count} files; the limit is ${LIMIT}. Count it with: npm pack --dry-run --json`);
  assert.equal(count, pack.entryCount ?? count);
});
