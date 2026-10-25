// CR-1D-001 (25 Okt 2026): --rematch and --replay set no charge hook, so a call that failed AFTER it was sent (a 200 whose body was dropped: the provider may have billed it) added its worst case to the in-memory cap but wrote no charge file.
// A later sitting, --spend and the report never saw it, and a rerun under a typed total could pass that total by the call's worst case. The main run and the other paid verbs set the hook; armSideRun now does too.
// Offline, $0: a loopback stub answers HTTP 200 with a body that is not JSON. The original run is a finished MOCK run, then the chain file seats a paid criteria seat (as test/side-cap-gate.test.js does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { typeCap } from './helpers/typed-cap.js';
import { supersededStagesOf, supersededSpendOf } from '../src/superseded.js';
import { runSpentUsd } from '../src/spend.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';
const DATE = '2026-10-14';

async function fixture() {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); req.on('end', () => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end('this is not json'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-side-hook-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c' }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = args => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const first = await run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` };
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, criteria: seat } }));
  return { srv, work, run, count: () => requests };
}
// the arguments of the command the exit-21 text prints as step 2 (it begins with the invocation word `council`, which the test replaces by its own spawn)
const printedArgs = (stderr, verb) => {
  const line = stderr.split('\n').find(l => new RegExp(`^\\s*(2\\.\\s+)?\\S+\\s+${verb}\\s`).test(l));
  assert.ok(line, `the stop text prints the command: ${stderr}`);
  return line.replace(/^\s*(2\.\s+)?\S+\s+/, '').trim().split(/\s+/);
};

for (const [verb, folder, args] of [
  ['--rematch', `${ID}.rematch-7`, ['--rematch', join('runs', ID), '--rematch-seed', '7']],
  ['--replay', `${ID}.replay-${DATE}`, ['--replay', join('runs', ID), '--replay-date', DATE]],
]) {
  test(`SH-${verb.slice(2)} (CR-1D-001): a paid call of ${verb} that fails after it was sent leaves its charge in the side folder, and the folder's spend counts it`, async () => {
    const f = await fixture();
    try {
      const r = await f.run([...args, '--max-usd', '30']);
      assert.equal(r.status, 21, r.stdout + r.stderr);
      const d = join(f.work, 'runs', folder);
      typeCap(d, '3.25');
      const go = await f.run(printedArgs(r.stderr, verb));
      assert.ok(f.count() >= 1, `the side run reached the provider: ${go.stdout}${go.stderr}`);
      const lines = readFileSync(join(d, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      const settled = lines.find(l => l.event === 'settled');
      assert.equal(settled?.outcome, 'billed_unreadable', 'the call was sent and its reply was unreadable: charged at its worst case');
      const charges = supersededStagesOf(d);
      assert.equal(charges.length, 1, 'ONE charge record in the side folder');
      assert.deepEqual([charges[0].kind, charges[0].usd], ['billed', settled.usd]);
      assert.ok(settled.usd > 0 && supersededSpendOf(d) === settled.usd, 'the folder\'s recorded spend holds it: a next sitting counts it');
      assert.equal(runSpentUsd(d), settled.usd, '--spend reads the folder through runSpentUsd and counts it');
    } finally { f.srv.close(); }
  });
}

