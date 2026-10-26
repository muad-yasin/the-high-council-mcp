// 0.8.2 (owner, 6 Oct 2026: "no silent default chain") stopped a run without --chain; 0.8.3 E5c (owner, 14 Oct 2026: "we can do daily7 as the default for 0.8.3, yes") brought a default back, announced on stderr; the tiers (owner, 15 Okt 2026: "Default chain (CLI and MCP) = plan-mini-council") make it plan-mini-council.
// It is not a silent spend: a paid run's limit is always typed (src/start-cap.js). Offline, $0: every case here stops before any provider is touched (the default chain is never run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMOTED_CHAINS, DEFAULT_CHAIN, defaultChainNotice } from '../src/chain-name.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-no-default-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  return dir;
}

test('no --chain: the CLI uses the default chain plan-mini-council and says so; --dry-run and --forecast-cost use it for free', () => {
  const dir = workspace();
  try {
    for (const args of [['--task', 'tasks/t.md', '--dry-run'], ['--forecast-cost']]) {
      const r = run(dir, args);
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes(defaultChainNotice()), `${args.join(' ')}: the notice is printed first`);
      assert.ok(r.stdout.includes('plan-mini-council'), `${args.join(' ')}: the default chain is the one priced`);
      assert.doesNotMatch(r.stderr, /no chain named/);
    }
    assert.equal(DEFAULT_CHAIN, 'plan-mini-council');
    assert.ok(!existsSync(join(dir, 'runs')) || readdirSync(join(dir, 'runs')).length === 0, 'no run folder was created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no --chain on a real start: the notice is printed, and with no keys and no terminal nothing reaches a provider (the default chain is never run by a test)', () => {
  const dir = workspace();
  try {
    const r = run(dir, ['--task', 'tasks/t.md']);
    assert.equal(r.status, 5, `the missing-key refusal (exit 5), not a crash: ${r.stderr}`);
    assert.ok(r.stderr.includes(defaultChainNotice()));
    assert.match(r.stderr, /COUNCIL-E001/);
    assert.match(r.stderr, /"openrouter" API key isn't set, so chain "plan-mini-council"/);
    assert.equal(existsSync(join(dir, 'runs')), false, 'the refusal comes before any run folder, so no usage file and no spend reservation exists');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the default chain\'s first stage is the external criteria seat (the notice\'s "pauses there with nothing spent" rests on it)', () => {
  const chain = JSON.parse(readFileSync(join(root, 'chains', `${DEFAULT_CHAIN}.json`), 'utf8'));
  assert.equal(chain.seats.criteria.provider, 'external');
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
  assert.equal(PROMOTED_CHAINS[0], DEFAULT_CHAIN, 'the default is the first recommended chain');
  assert.deepEqual(PROMOTED_CHAINS, ['plan-mini-council', 'plan-medium-council', 'plan-high-council'], 'the recommended list: the three tiers (typed on purpose)');
  assert.match(defaultChainNotice(), /Claude Code session/);
  const dir = workspace();
  try {
    const help = run(dir, ['--help']);
    for (const name of PROMOTED_CHAINS) assert.ok(help.stdout.includes(name), `--help recommends ${name}`);
    assert.match(help.stdout, /default chain plan-mini-council is used/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
