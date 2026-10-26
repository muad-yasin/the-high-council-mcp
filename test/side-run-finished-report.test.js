// CR-1D-001 (finished side run): a --replay that FINISHES with one seat's debate reply lost after the send (a 200 whose body was dropped) writes the charge in its folder (the hook) AND folds it into its own report.json, as the main run does:
// totals.usd + totals.supersededUsd + superseded[]. Two records of one folder must not disagree about money. Offline, $0: loopback stub; the key is a placeholder literal; every seat that is not the stub's is a mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { typeCap } from './helpers/typed-cap.js';
import { supersededStagesOf, supersededSpendOf } from '../src/superseded.js';
import { runSpentUsd } from '../src/spend.js';
import { call as mockCall } from '../src/providers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-14T12-00-00-000Z';
const DATE = '2026-10-14';

test('SF-1 (CR-1D-001): a replay that finishes with a debate reply lost after the send: the charge is in the folder, in report.json totals and in superseded[], and --spend reads the same figure', async () => {
  let requests = 0;
  const srv = http.createServer((req, res) => { const n = ++requests; let raw = ''; req.on('data', d => { raw += d; }); req.on('end', async () => {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (n > 1) return res.end('this is not json');   // the first request (the seat's proposal) is served as the mock proposer would; every later one loses its body
    const body = JSON.parse(raw); const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n'); const user = body.messages.filter(m => m.role === 'user').at(-1)?.content ?? '';
    const r = await mockCall('mock', { model: 'mock-proposer-a', system, messages: [{ role: 'user', content: user }], maxTokens: body.max_tokens ?? body.max_completion_tokens });
    res.end(JSON.stringify({ id: 'stub-1', model: body.model, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }], usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output } }));
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-side-fin-')); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
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
  try {
    assert.equal((await run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 0);
    const seat = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, lab: 'orx', baseUrl: `http://127.0.0.1:${srv.address().port}` };
    writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', seats: { ...base.seats, proposers: [seat, ...base.seats.proposers] } }));
    const first = await run(['--replay', join('runs', ID), '--replay-date', DATE, '--max-usd', '30']);
    assert.equal(first.status, 21, first.stdout + first.stderr);
    const d = join(work, 'runs', `${ID}.replay-${DATE}`); typeCap(d, '3.25');
    const line = first.stderr.split('\n').find(l => /^\s*(2\.\s+)?\S+\s+--replay\s/.test(l));
    const go = await run(line.replace(/^\s*(2\.\s+)?\S+\s+/, '').trim().split(/\s+/));
    assert.ok([0, 22].includes(go.status), `the replay finished: ${go.stdout}${go.stderr}`);
    const charges = supersededStagesOf(d);
    assert.ok(charges.length >= 1 && charges.every(c => c.kind === 'billed'), `the lost call left its charge (${JSON.stringify(charges)})`);
    const report = JSON.parse(readFileSync(join(d, 'report.json'), 'utf8'));
    console.log('SF-1: totals', JSON.stringify(report.totals).slice(0, 150), '| superseded[]', JSON.stringify(report.superseded), '| disk', supersededSpendOf(d), '| runSpentUsd', runSpentUsd(d));
    assert.equal(report.totals.supersededUsd, supersededSpendOf(d), 'the report absorbed the charge');
    assert.deepEqual((report.superseded ?? []).map(s => s.label).sort(), charges.map(c => c.label).sort());
    assert.ok(Math.abs(runSpentUsd(d) - report.totals.usd) < 1e-9, '--spend and report.json say the same amount');
  } finally { srv.close(); }
});
