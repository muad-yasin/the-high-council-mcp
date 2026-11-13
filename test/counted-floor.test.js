// 0.8.4 unit 6 (D11; Mini-C&C R393/R394): the real verbs. (A) the floor a new typed limit must exceed after a budget stop is the LARGER of the stop file's figure and what the folder holds (plan A case (iv): a paid usage file of a label the stopping
// sitting never asked); (B) a resume's budget counts a call an earlier sitting SETTLED whose usage file was never written (the seed, slot H-U6-e); (C) a finished run's report.json carries totals.counted, every usage file carries its basis and the cost
// line says "counted"; (D) `--spend` says which part of its total is an estimate. Offline, $0: tests A and B start a paid chain on a loopback stub that COUNTS requests (keys fake, 127.0.0.1 only, the limit typed at the gate before any call: the
// mcp-start-cap-dialog fixture shape, R284); C and D use mock chains and a hand-built folder.
// OLD/NEW/WHY of the floor (CHANGED BEHAVIOUR, named): OLD: after a budget stop the floor was the stop file's spentUsd + assumedAtWorstCase.usd alone. NEW: the larger of that and the folder's total. WHY: the stop file is the stopping sitting's in-process
// total and never saw a paid file of a label that sitting did not ask, so a total could be typed that was below what the folder holds. CONSEQUENCE: a total that was accepted before can be refused now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { typeCap } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-11-04T12-00-00-000Z';
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);

async function fixture() {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-counted-floor-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = (args, until = null) => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const poll = until ? setInterval(() => { if (requests >= until) child.kill('SIGKILL'); }, 50) : null;
    child.on('exit', status => { clearTimeout(timer); if (poll) clearInterval(poll); resolve({ status, stdout, stderr }); });
  });
  return { srv, work, run, count: () => requests, runDir: join(work, 'runs', ID) };
}
const resLine = o => JSON.stringify({ schema: 'spend-reservations/1', at: '2026-11-04T10:00:00.000Z', ...o });

test('A the floor of a new limit after a budget stop counts a paid file the stopping sitting never asked: the stop file said $0, the folder holds $2.00', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(f.runDir, '0.001');                                              // too small for the first call: the run stops before sending anything
    const stopped = await f.run(['--resume', f.runDir]);
    assert.equal(stopped.status, 4, stopped.stdout + stopped.stderr); assert.equal(f.count(), 0);
    const st = JSON.parse(readFileSync(join(f.runDir, 'STOPPED-budget.json'), 'utf8'));
    near(st.spentUsd + (st.assumedAtWorstCase?.usd || 0), 0, 'the stop file\'s figure (what the floor was)');
    // a paid file of a label this run never asks again (written by an earlier sitting of a longer run)
    writeFileSync(join(f.runDir, 'zz-never-asked.usage.json'), JSON.stringify({ provider: 'openrouter', model: 'x/y', usage: { input: 1, output: 1 }, usd: 2, basis: 'token_priced' }));
    const raise = await f.run(['--resume', f.runDir]);
    assert.equal(raise.status, 21, raise.stdout + raise.stderr);
    const screen = readFileSync(join(f.runDir, 'cap-screen-2.md'), 'utf8');
    assert.match(screen, /It must be above \$2\.00, what the run has already counted\./, 'NEW floor: the folder\'s $2.00, not the stop file\'s $0');
    assert.equal(f.count(), 0);
  } finally { f.srv.close(); }
});

test('B a resume counts a call an earlier sitting settled whose usage file was never written: with a limit that cannot hold it and the next call, the run stops before sending', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    // the earlier sitting: the call was reserved and settled at $0.04, the process ended before the usage file was written
    writeFileSync(join(f.runDir, 'spend-reservations.jsonl'), [resLine({ event: 'reserved', id: 'r1', label: 'criteria', seat: 'openrouter/anthropic/claude-opus-5', usd: 0.1 }), resLine({ event: 'settled', id: 'r1', outcome: 'recorded', usd: 0.04, basis: 'token_priced' })].join('\n') + '\n');
    typeCap(f.runDir, '0.045');                                              // above the $0.04 already paid, below that plus the first call's expected cost
    const r = await f.run(['--resume', f.runDir], 1);
    assert.equal(f.count(), 0, `OLD: the seed did not hold the $0.04, so the call was sent (a request reached the stub): ${r.stdout}${r.stderr}`);
    assert.equal(r.status, 4, r.stdout + r.stderr);
  } finally { f.srv.close(); }
});

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-counted-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing.\n');
  return dir;
}
const runCli = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('C a finished run: every usage file names its basis, report.json carries totals.counted next to the unchanged totals.usd, and the cost line says "counted"', () => {
  const dir = workspace();
  const r = runCli(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '100000', '--run-id', '2026-11-04T13-00-00-000Z']);
  const runDir = join(dir, 'runs', '2026-11-04T13-00-00-000Z');
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  const files = readdirSync(runDir).filter(n => n.endsWith('.usage.json')).map(n => JSON.parse(readFileSync(join(runDir, n), 'utf8')));
  const paid = files.filter(u => u.usd > 0);
  assert.ok(paid.length > 0, 'the mock-budget chain bills its fixture prices');
  assert.ok(paid.every(u => u.basis === 'token_priced'), `every paid usage file names its basis: ${JSON.stringify(paid.map(u => u.basis))}`);
  assert.ok(report.totals.counted, `totals.counted: ${JSON.stringify(report.totals)}`);
  near(report.totals.counted.usd, report.totals.usd, 'with nothing unsettled the count-once figure equals totals.usd');
  near(report.totals.counted.estimatedUsd, 0, 'no estimate in a clean run'); near(report.totals.counted.bases.token_priced, report.totals.usd, 'all of it token-priced');
  assert.match(r.stdout + r.stderr, /cost: +\$[0-9.]+ counted\b/, 'the cost line names the figure');
  assert.doesNotMatch(r.stdout + r.stderr, /estimated\)/, 'and says nothing of an estimate when there is none');
});

test('D `--spend` says which part of its total is an estimate: an unsettled reservation is counted at its worst case and is named as such', () => {
  const dir = workspace();
  const runDir = join(dir, 'runs', new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(runDir, { recursive: true });   // today's id: `--days 30` only lists runs of the last 30 days
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: 'c', task: 'tasks/t.md' }));
  writeFileSync(join(runDir, 'a-stage.usage.json'), JSON.stringify({ provider: 'openrouter', model: 'x/y', usage: { input: 1, output: 1 }, usd: 0.5, basis: 'token_priced' }));
  writeFileSync(join(runDir, 'spend-reservations.jsonl'), resLine({ event: 'reserved', id: 'r1', label: 'b-stage', seat: 'openrouter/x/y', usd: 1 }) + '\n');   // never settled
  const r = runCli(dir, ['--spend', '--days', '30']);
  assert.match(r.stdout, /\$1\.50 +total/, r.stdout);
  assert.match(r.stdout, /\(of which \$1\.00 estimated\) of that total/, r.stdout);
});
