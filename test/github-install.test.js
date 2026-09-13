// test/github-install.test.js
//
// A `github:` or npx install runs this package's bin (package.json's "council": "src/cli.js")
// from a directory the installer chose, not from inside the package - `pkg` (resolve(here, '..'))
// and `work` (process.cwd()) must stay split, or a relative task path resolves against the
// package's own directory (inside node_modules for a real install) instead of the user's own
// files. This is the exact bug a prior fix corrected (see src/cli.js's own comment on `work`);
// this test pins it so a future edit can't silently reintroduce `work = pkg`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

test('a relative --task path resolves against the caller\'s cwd, not the package directory', () => {
  // Simulates exactly what a github:/npx install does: the bin (src/cli.js) runs with cwd set
  // to a directory that is NOT the package's own directory. If `work` were ever `pkg` again,
  // this task file - which exists only in the tmp cwd, not in `root` - would not be found.
  const cwd = mkdtempSync(join(tmpdir(), 'thc-github-install-'));
  try {
    mkdirSync(join(cwd, 'tasks'));
    writeFileSync(join(cwd, 'tasks', 'probe.md'), 'A fixture task that only exists in this throwaway cwd.');
    const out = execFileSync('node', [cli, '--task', 'tasks/probe.md', '--chain', 'verify', '--dry-run'], { cwd, encoding: 'utf8' });
    assert.match(out, /Chain: verify/, 'the dry-run must find and price the chain');
    // If `work` had resolved to the package directory instead of `cwd`, the CLI would have
    // exited with "No task file at ..." rather than pricing the chain.
    assert.doesNotMatch(out, /No task file at/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a run started from a throwaway cwd writes its runs/ folder there, not into the package directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'thc-github-install-runs-'));
  try {
    mkdirSync(join(cwd, 'tasks'));
    writeFileSync(join(cwd, 'tasks', 'probe.md'), 'Fixture task for the mock chain.');
    execFileSync('node', [cli, '--task', 'tasks/probe.md', '--chain', 'mock'], { cwd, encoding: 'utf8' });
    assert.ok(existsSync(join(cwd, 'runs')), 'runs/ must land in the caller\'s own cwd');
    // The package directory's own runs/ must not have gained a new entry from this call -
    // this is the whole point of the work/pkg split, checked from the other direction.
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
