// 0.8.3 M2e: a run that was killed while a paid call was in flight and then stopped at its cap with NO stage finished was counted twice by runSpentUsd, `--spend` and `run_status`.
// STOPPED-budget.json holds the TOTAL spend at the stop (it already includes the earlier superseded and unsettled spend), and the no-stage fallback of src/spend.js read that figure and then added the superseded
// records and the unsettled reservation again. A plain run, no tree: the number is W (the in-flight call's reservation) before the stop and after it. Offline, $0: a priced API seat on a local server that never answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { runSpentUsd, spendReport } from '../src/spend.js';
import { budgetOf } from '../src/run-budget.js';
import { RESERVATIONS_FILE, unsettledReservations } from '../src/spend-reservations.js';
import { typeCap } from './helpers/typed-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ID = '2026-10-08T12-00-00-000Z';

test('a run killed with a call in flight, then stopped at its cap before any stage finished, is counted at W once (not 2W): runSpentUsd and the spend report agree, before and after the stop', async () => {
  const srv = http.createServer(req => { req.resume(); });                                  // takes the request and never answers
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const mkWork = () => {
      const w = mkdtempSync(join(tmpdir(), 'thc-stopped-')); mkdirSync(join(w, 'tasks')); mkdirSync(join(w, 'chains'));
      writeFileSync(join(w, 'tasks', 'x.md'), 'Plan a tiny change.\n');
      const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    writeFileSync(join(w, 'chains', 'hang.json'), JSON.stringify({ ...base, name: 'hang', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}` } } }));
      return w;
    };
    const envOf = w => ({ PATH: process.env.PATH, HOME: w, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' });
    const work = mkWork(); const env = envOf(work);   // the run under test; the probe run that learns W gets its own folder, so the spend report below sees one run
    // 0.8.3 M6 typed cap T4a: a paid start waits for a typed limit (exit 21) and the limit cannot be lowered by a flag on resume, so the cap that "cannot hold a second call" is TYPED up front. A probe run (limit 30) learns W, the
    // reservation of the one in-flight call; the run under test then gets the limit ceil4(1.4 W): it holds the first call, and what is left after the kill is less than a second call.
    const sitting = async (w, runId, typed) => {
      const runDir = join(w, 'runs', runId);
      // The exit promise is attached AT SPAWN: waiting for an 'exit' event after the child has already exited never resolves (the box hang of 14 Oct 2026).
      const exitOf = c => new Promise(r => { c.on('exit', r); });
      const start = spawn(process.execPath, [cli, '--chain', 'hang', '--task', 'tasks/x.md', '--run-id', runId], { cwd: w, env: envOf(w) });
      assert.equal(await exitOf(start), 21, 'the paid start waits for a typed limit');
      typeCap(runDir, typed);
      const child = spawn(process.execPath, [cli, '--resume', runDir], { cwd: w, env: envOf(w) });
      const childExit = exitOf(child);
      let reserved = false;
      for (let i = 0; i < 300 && !reserved && child.exitCode === null; i++) { reserved = existsSync(join(runDir, RESERVATIONS_FILE)) && readFileSync(join(runDir, RESERVATIONS_FILE), 'utf8').includes('"reserved"'); if (!reserved) await new Promise(r => setTimeout(r, 50)); }
      assert.ok(reserved, 'the resumed run reserved its call (it was still alive and had not exited)');
      child.kill('SIGKILL'); await childExit;
      return runDir;
    };
    const probe = await sitting(mkWork(), '2026-10-08T11-00-00-000Z', '30');
    const W0 = unsettledReservations(probe).reduce((n, r) => n + r.usd, 0);
    assert.ok(W0 > 0);
    const runDir = await sitting(work, ID, (Math.ceil(W0 * 1.4 * 10000) / 10000).toFixed(4));
    const W = unsettledReservations(runDir).reduce((n, r) => n + r.usd, 0);
    assert.ok(W > 0 && Math.abs(W - W0) < 1e-9, 'the same call reserves the same worst case');
    const now = Date.parse('2026-10-08T13:00:00Z');
    assert.ok(Math.abs(runSpentUsd(runDir) - W) < 1e-9, 'killed: the in-flight call, once');
    // resume under a cap that cannot hold a second call: it stops before sending anything
    const resumed = spawnSync(process.execPath, [cli, '--resume', runDir], { cwd: work, encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(resumed.status, 4, resumed.stdout + resumed.stderr);
    const stopped = JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8'));
    assert.ok(Math.abs(stopped.spentUsd - W) < 1e-9, 'the stop file holds the TOTAL at the stop: the earlier unsettled reservation, once');
    assert.equal(readdirSync(runDir).some(f => f.endsWith('.usage.json')), false, 'no stage finished');
    assert.ok(Math.abs(runSpentUsd(runDir) - W) < 1e-9, `after the stop it is still W (${runSpentUsd(runDir)}), not 2W (${2 * W})`);
    assert.ok(Math.abs(spendReport(join(work, 'runs'), { days: 30, now }).totalUsd - W) < 1e-9, 'and the spend report agrees');
    assert.ok(Math.abs(budgetOf(runDir, null).spentUsd - W) < 1e-9, 'run_status reads a stopped run through budgetOf, which never read the stop file for spend: it was and stays W');
    // spend that arrives AFTER the stop is still counted: a superseded record written later is not part of the stop file's total
    mkdirSync(join(runDir, 'superseded'), { recursive: true });
    writeFileSync(join(runDir, 'superseded', 'x.call-1.usage.json'), JSON.stringify({ provider: 'openrouter', usd: 0.5 }));
    assert.ok(Math.abs(runSpentUsd(runDir) - (W + 0.5)) < 1e-9, 'a later charge is added on top');
  } finally { srv.close(); }
});
