// 0.8.2 (owner, 6 Oct 2026, archive the unused chains): a run recorded on an archived chain can no longer find its file, so the "no such chain"
// errors say where it went. ARCHIVED_CHAINS (src/chain-name.js) is a typed list because archive/chains/ is not in the npm package: this test keeps it
// equal to the folder in the repository. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVED_CHAINS, archivedChainHint } from '../src/chain-name.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');

test('ARCHIVED_CHAINS equals the files in archive/chains/, and none of them is also in chains/', () => {
  const archived = readdirSync(join(root, 'archive', 'chains')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  assert.deepEqual([...ARCHIVED_CHAINS].sort(), archived);
  const shipped = new Set(readdirSync(join(root, 'chains')).map(f => f.slice(0, -5)));
  assert.deepEqual(archived.filter(n => shipped.has(n)), []);
  assert.equal(archivedChainHint('cheap-7-v2'), '', 'a kept chain gets no hint (the check can fail)');
});

test('CLI: --chain <archived name> says it was archived and where to copy it from; an unknown name gets no such hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-archived-'));
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a note app.\n');
    const run = chain => spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', chain, '--dry-run'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    const a = run('plan-debate');
    assert.equal(a.status, 1, a.stdout + a.stderr);
    assert.match(a.stderr, /No such chain: "plan-debate"/);
    assert.match(a.stderr, /moved to archive\/chains\/ in 0\.8\.2/);
    const b = run('no-such-chain');
    assert.equal(b.status, 1);
    assert.doesNotMatch(b.stderr, /archive\/chains/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
