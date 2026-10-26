// T4c (carried from T4b2/T5b; Review/Build_0.8.3/m6-closing/T4c_Gate_Note.md items A and B). The stop block a budget stop prints (src/cli.js, the log lines after "STOPPED: per-run spend cap reached"):
//   A. PINS of the way out: a PAID chain's line asks for a NEW TOTAL (`council --resume runs/<id>   (asks for a new total above $X)`), a FREE chain's names `--max-usd <higher>`. They pin existing words (no mutation): they fail as soon as the words change.
//   B. The `spent:` line names its basis. Nothing assumed -> the RECORDED figure alone, byte for byte as before. Something assumed (a replayed stage that kept no figure, charged at its worst case) -> both bases, recorded first,
//      so the raise floor of the resume line ("above $B", the COUNTED figure) is explained: recorded + assumed = counted.
// Offline, $0: the paid seat points at a local stub that counts requests (none are sent: the limit is too small for the first call); the free chain is the priced mock chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatUsd } from '../src/cost.js';
import { runSpentUsd } from '../src/spend.js';
import { typeCap } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';
const free = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
const freeDir = () => { const dir = mkdtempSync(join(tmpdir(), 'thc-stop-bases-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n'); return dir; };

test('A pin, PAID chain: the stop block says the resume asks for a new total above the counted figure, and offers no --max-usd', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-stop-bases-paid-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = args => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('exit', status => { clearTimeout(timer); resolve({ status, out }); });
  });
  try {
    const runDir = join(work, 'runs', ID);
    assert.equal((await run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(runDir, '0.001');                                    // too small for the first call: the run stops before any request
    const stopped = await run(['--resume', runDir]);
    assert.equal(stopped.status, 4, stopped.out); assert.equal(requests, 0);
    assert.match(stopped.out, new RegExp(`^  resume:  .*--resume runs/${ID}   \\(asks for a new total above \\$0\\.0000\\)$`, 'm'));
    assert.doesNotMatch(stopped.out, /--max-usd <higher>/);
    assert.match(stopped.out, /^  spent:   \$0\.0000 of \$0\.0010 ceiling$/m, 'nothing assumed: the recorded figure alone');
  } finally { srv.close(); }
});

test('A pin, FREE chain, and B with nothing assumed: the resume names --max-usd <higher>, and the spent line is the recorded figure alone, byte for byte', () => {
  const dir = freeDir();
  const r = free(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', ID]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, new RegExp(`^  resume:  .*--resume runs/${ID} --max-usd <higher>$`, 'm'));
  const stopped = JSON.parse(readFileSync(join(dir, 'runs', ID, 'STOPPED-budget.json'), 'utf8'));
  assert.equal(stopped.assumedAtWorstCase, undefined, 'fixture: nothing was assumed');
  assert.ok(out.split('\n').includes(`  spent:   ${formatUsd(stopped.spentUsd)} of ${formatUsd(1)} ceiling`), out);
  assert.doesNotMatch(out, /assumed at worst case/);
});

test('B with something assumed: the spent line names both bases, recorded first, and recorded + assumed = the counted figure the resume floor uses', () => {
  const dir = freeDir();
  assert.equal(free(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', ID]).status, 4);
  const rd = join(dir, 'runs', ID);
  const usageFile = join(rd, 'criteria.usage.json');
  const record = JSON.parse(readFileSync(usageFile, 'utf8'));
  delete record.usd;                                              // the figure is lost; the replay is trusted and charged at its worst case
  writeFileSync(usageFile, JSON.stringify(record));
  const cap = runSpentUsd(rd) + 1e-6;
  const r = free(dir, ['--resume', join('runs', ID), '--max-usd', String(cap)]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  const stopped = JSON.parse(readFileSync(join(rd, 'STOPPED-budget.json'), 'utf8'));
  const assumed = stopped.assumedAtWorstCase.usd; assert.ok(assumed > 0);
  const counted = stopped.spentUsd + assumed;
  assert.ok(out.split('\n').includes(`  spent:   ${formatUsd(stopped.spentUsd)} recorded, ${formatUsd(assumed)} assumed at worst case for replayed stages with no figure (${formatUsd(counted)} counted) of ${formatUsd(cap)} ceiling`), out);
  assert.ok(Math.abs(stopped.spentUsd + assumed - counted) < 1e-9);
});
