// A policy's max_usd_per_run (0.8.2 item 8c; owner, 7 Oct 2026: "make it a warning, not a refusal"): still REFUSES when the expected cost is over the limit, now names both figures, and WARNS (the run starts)
// when only the maximum is over it. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluatePolicy } from '../src/policy.js';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const ctx = (expected, maximum) => ({ config: { name: 'x' }, allSeats: [], worstCaseUsd: expected, maximumUsd: maximum, monthToDateUsd: 0 });

test('evaluatePolicy: expected over the limit refuses and names both figures; expected under and maximum over warns and passes; both under says nothing', () => {
  const policy = { max_usd_per_run: 1 };
  const over = evaluatePolicy(policy, ctx(2, 5));
  assert.equal(over.ok, false); assert.equal(over.warnings.length, 0);
  assert.match(over.reasons[0], /expected cost .* is \$2\.0000 and its maximum \$5\.0000, over the \$1\.0000 limit/);
  const warn = evaluatePolicy(policy, ctx(0.5, 3));
  assert.equal(warn.ok, true, 'the run is not refused');
  assert.equal(warn.warnings.length, 1);
  assert.match(warn.warnings[0], /expected cost is \$0\.5000, within the \$1\.0000 limit, but its maximum cost .* is \$3\.0000, over it/);
  assert.deepEqual(warn.checks.map(c => [c.field, c.ok]), [['max_usd_per_run', true]], 'a warning is not a failed check');
  const quiet = evaluatePolicy(policy, ctx(0.5, 0.9));
  assert.deepEqual([quiet.ok, quiet.warnings], [true, []]);
  assert.deepEqual(evaluatePolicy({}, ctx(9, 99)).warnings, [], 'no limit, no warning');
});

function workspace(limit) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-polmax-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a habit tracker.\n');
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['mock'], max_usd_per_run: limit }));
  return dir;
}
const env = dir => ({ PATH: process.env.PATH, HOME: dir });

test('through the CLI on a chain with fixture prices: expected over the limit is refused (exit 12); expected under and maximum over starts with a warning in the dry run, the log and WARNINGS.md', () => {
  const r = dryRunReport(JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8')), {}).estimate;
  assert.ok(r.maximumUsd > r.expectedUsd * 1.01, `fixture: mock-budget maximum ${r.maximumUsd} is above its expected ${r.expectedUsd}`);
  const between = ((r.expectedUsd + r.maximumUsd) / 2);
  // refused: the limit is under the expected cost
  const d1 = workspace(r.expectedUsd / 2);
  const refused = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1000'], { cwd: d1, encoding: 'utf8', env: env(d1) });
  assert.equal(refused.status, 12, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /max_usd_per_run: this chain's expected cost/);
  assert.equal(existsSync(join(d1, 'runs')) && readdirSync(join(d1, 'runs')).length > 0, false, 'nothing ran');
  // warned: the limit sits between the two figures
  const d2 = workspace(between);
  const dry = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--dry-run'], { cwd: d2, encoding: 'utf8', env: env(d2) });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /policy warning - max_usd_per_run: this chain's expected cost is .* within the .* limit, but its maximum cost/);
  const json = JSON.parse(spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--dry-run', '--json'], { cwd: d2, encoding: 'utf8', env: env(d2) }).stdout);
  assert.equal(json.policyWarnings.length, 1);
  const run = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1000'], { cwd: d2, encoding: 'utf8', env: env(d2), timeout: 120_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /policy warning - max_usd_per_run/);
  const folder = join(d2, 'runs', readdirSync(join(d2, 'runs'))[0]);
  assert.match(readFileSync(join(folder, 'WARNINGS.md'), 'utf8'), /- policy: max_usd_per_run: this chain's expected cost is/);
  const report = JSON.parse(readFileSync(join(folder, 'report.json'), 'utf8'));
  assert.equal(report.policy.warnings.length, 1, 'report.json carries it, additively');
  assert.deepEqual(report.policy.checks.map(c => [c.field, c.ok]), [['allowed_providers', true], ['max_usd_per_run', true]]);
  // a limit above the maximum: no warning at all
  const d3 = workspace(r.maximumUsd * 2);
  const quiet = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--dry-run'], { cwd: d3, encoding: 'utf8', env: env(d3) });
  assert.doesNotMatch(quiet.stdout, /policy warning/);
});

import { spawn } from 'node:child_process';
test('through MCP start_run: the warning is in the tool\'s RESULT (a detached run\'s log is read by nobody), and the finished run carries it in WARNINGS.md and report.json', async () => {
  const r = dryRunReport(JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8')), {}).estimate;
  const dir = workspace((r.expectedUsd + r.maximumUsd) / 2);
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: env(dir) });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const send = (method, params) => new Promise((ok, fail) => { const id = ++n; const t = setTimeout(() => fail(new Error(`${method} timed out`)), 60_000); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'polmax', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const res = await send('tools/call', { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/t.md', max_usd: 1000 } });
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.started, true, JSON.stringify(body));
    assert.equal(body.policy_warnings.length, 1);
    assert.match(body.policy_warnings[0], /expected cost is .* within the .* limit, but its maximum cost/);
    // no policy file: no field
    const plain = mkdtempSync(join(tmpdir(), 'thc-polmax-')); mkdirSync(join(plain, 'tasks')); writeFileSync(join(plain, 'tasks', 't.md'), 'x\n');
    // (the same server cannot be pointed at another folder; the CLI's own no-warning case is covered above)
    for (let i = 0; i < 100; i++) { const runs = existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')) : []; if (runs.length && existsSync(join(dir, 'runs', runs[0], 'report.json'))) break; await new Promise(r2 => setTimeout(r2, 200)); }
    const folder = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.match(readFileSync(join(folder, 'WARNINGS.md'), 'utf8'), /- policy: max_usd_per_run/);
    assert.equal(JSON.parse(readFileSync(join(folder, 'report.json'), 'utf8')).policy.warnings.length, 1);
  } finally { child.stdin.end(); child.kill(); }
});
