// Repository hygiene (2026-09-23). The working folders below hold private material on the
// maintainer's machine - run output about the author's business (runs/), task briefs (tasks/), an
// operator's real persona names (.council/), internal reviews (Review/) and test debris
// (.idempotency/). They must stay gitignored: a future .gitignore edit that drops one would commit
// them. The internal project docs live in maintainers/, never at the root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isGitCheckout = existsSync(join(root, '.git'));

for (const dir of ['runs', 'tasks', '.council', 'Review', '.idempotency']) {
  test(`${dir}/ stays gitignored`, { skip: !isGitCheckout && 'not a git checkout' }, () => {
    // check-ignore exits 0 when the path is ignored, 1 when it is not.
    const out = execFileSync('git', ['check-ignore', '--no-index', '-q', `${dir}/example.md`], { cwd: root, stdio: 'pipe' });
    assert.equal(out.length, 0);
  });
}

test('the internal project docs live in maintainers/, not at the root', () => {
  for (const f of ['HANDOFF.md', 'DECISIONS.md', 'PROGRESS.md', 'STATUS-LEDGER.md', 'IDEA-MATRIX.md']) {
    assert.equal(existsSync(join(root, f)), false, `${f} is back at the root`);
  }
  for (const f of ['maintainers/HANDOFF.md', 'maintainers/DECISIONS.md', 'maintainers/PROGRESS.md', 'maintainers/STATUS-LEDGER.md', 'maintainers/ideas/IDEA-MATRIX.md', 'maintainers/README.md']) {
    assert.ok(existsSync(join(root, f)), `${f} is missing`);
  }
});
