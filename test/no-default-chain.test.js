// 0.8.2 (owner, 6 Oct 2026: "no silent default chain"): `council --task x` without --chain used to run
// `verify`, whose Gemini 2.5 seat is closed to new Google projects. It now refuses and names the chains
// the README recommends. Offline, $0: every case here stops before any provider is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMOTED_CHAINS, noChainRefusal } from '../src/chain-name.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-no-default-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  return dir;
}

test('no --chain: the CLI refuses with exit 2, names the recommended chains, and starts nothing', () => {
  const dir = workspace();
  try {
    for (const args of [['--task', 'tasks/t.md'], ['--task', 'tasks/t.md', '--dry-run'], ['--forecast-cost']]) {
      const r = run(dir, args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /no chain named/);
      for (const name of PROMOTED_CHAINS) assert.ok(r.stderr.includes(name), `${args.join(' ')}: the refusal names ${name}`);
      assert.doesNotMatch(r.stderr, /\bverify\b/, 'the refusal does not send a person to the old default');
    }
    assert.ok(!existsSync(join(dir, 'runs')) || readdirSync(join(dir, 'runs')).length === 0, 'no run folder was created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an explicit --chain still runs, and --resume still takes its chain from run.json (no --chain needed)', () => {
  const dir = workspace();
  try {
    const ok = run(dir, ['--chain', 'mock', '--task', 'tasks/t.md']);
    assert.equal(ok.status, 0, ok.stderr);
    const id = readdirSync(join(dir, 'runs'))[0];
    const r = run(dir, ['--resume', `runs/${id}`]);
    assert.doesNotMatch(r.stderr, /no chain named/, `resume must not ask for --chain: ${r.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every chain the refusal and --help recommend exists in chains/ (an archived chain cannot stay recommended)', () => {
  const shipped = new Set(readdirSync(join(root, 'chains')).map(f => f.replace(/\.json$/, '')));
  const missing = names => names.filter(n => !shipped.has(n));
  assert.deepEqual(missing(PROMOTED_CHAINS), [], 'a recommended chain is not in chains/');
  assert.deepEqual(missing([...PROMOTED_CHAINS, 'no-such-chain']), ['no-such-chain'], 'the check can fail: an unshipped name is reported');
  assert.match(noChainRefusal(), /cheap-7-v2/);
  const dir = workspace();
  try {
    const help = run(dir, ['--help']);
    for (const name of PROMOTED_CHAINS) assert.ok(help.stdout.includes(name), `--help recommends ${name}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
