// 0.8.1 pre-release audit round (MAN-4), area A5 (the 0.8.0 fixes FX-1..FX-15 and the plausible items), findings fixed in batch 2.
// A5-2 FX-15 widened a trailing "Disputed" strip to the build stage and the draft readers, so a real plan paragraph starting with "Disputed" vanished;
// A5-1 `council handoff --from-run` took no run lock and could overwrite a finished run's HANDOFF.md (also on a case-insensitive disk, FX-9);
// A5-4 the MCP status budget of a finished run missed later handoff spend; A5-5 `check-lock --run` passed when report.json had no criteria;
// A5-7 the declined_only stop mislabelled itself; A5-8 the call site of existsExactCase was unpinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, setBudget, setCache } from '../src/chain.js';
import { parseDisputes, stripDeclined } from '../src/draft-disputes.js';
import { pickDraft } from '../src/handoff-from-run.js';

const external = { provider: 'external', model: 'claude-code-session' };
const cfg = () => ({ name: 'a52', maxRounds: 1, criteria: ['It exists.'], seats: { builder: external, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } });
const cacheOf = text => ({ get: l => (l === 'build' ? { text, provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0, ms: 0 } : null), warn() {}, invalidate() {} });
const PLAN = '# Plan\n\nDo the thing.\n\nDisputed payments are escalated to a human reviewer within 24 hours.\n';

test('A5-2: the build stage strips DECLINED lines only: a plan paragraph that starts with "Disputed" stays in the draft, the deliverable and nothing is recorded as a dispute', async () => {
  setBudget(null); setCache(cacheOf(PLAN));
  const r = await runChain({ request: 'Req.', config: cfg(), log: () => {} });
  setCache(null);
  assert.match(r.deliverable, /Disputed payments are escalated to a human reviewer within 24 hours\./);
  assert.deepEqual(r.disputes.filter(d => d.round === 'build'), []);
});

test('A5-2: the draft readers FX-15 added (stripDeclined, pickDraft for build.md and revise-N.md) strip DECLINED lines only; the reviser stages\' own strip (parseDisputes default) is unchanged', () => {
  assert.equal(stripDeclined(PLAN), PLAN.trimEnd());
  assert.equal(stripDeclined('# P\n\nBody.\n\nDECLINED: taste\n'), '# P\n\nBody.');
  const dir = mkdtempSync(join(tmpdir(), 'thc-a52-'));
  writeFileSync(join(dir, 'build.md'), `${PLAN}\nDECLINED: not asked for\n`);
  assert.match(pickDraft(dir).text, /Disputed payments are escalated/);
  assert.doesNotMatch(pickDraft(dir).text, /DECLINED/);
  // the reviser's 0.8.0 behaviour (a trailing Disputed block is the model's own, stripped and recorded) stays
  assert.deepEqual(parseDisputes('# P\n\nBody.\n\nDISPUTED: the order is open.\n').disputes, ['the order is open.']);
});

// ---- A5-1 / FX-9: the handoff branch takes the run lock and never overwrites a HANDOFF.md that appears after it chose its name ----
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const cleanEnv = extra => { const e = { ...process.env, ...extra }; for (const k of Object.keys(e)) if (/API_KEY/.test(k)) delete e[k]; return e; };
function finishedRun() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-a51-')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  writeFileSync(join(dir, 'chains', 'fx.json'), JSON.stringify({ name: 'fx', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  const r = spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'fx'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run };
}

test('A5-1: `council handoff --from-run` on a run another process holds the lock of is refused with exit 13 (like --resume), and writes nothing', () => {
  const { dir, run } = finishedRun();
  const holder = spawn('sleep', ['30']);
  try {
    writeFileSync(join(run, '.council.lock'), JSON.stringify({ pid: holder.pid, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));
    const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', run, '--max-usd', '100'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
    assert.equal(r.status, 13, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /already running|holds/i);
    assert.equal(existsSync(join(run, 'HANDOFF.md')), false);
    assert.equal(existsSync(join(run, 'HANDOFF-from-run.md')), false);
  } finally { holder.kill(); }
});

test('A5-1 / FX-9: a HANDOFF.md that appears while the handoff call runs is never overwritten (exclusive create; the new file gets another name)', async () => {
  const { dir, run } = finishedRun();
  const child = spawn(process.execPath, [cli, 'handoff', '--from-run', run, '--max-usd', '100'], { cwd: dir, env: cleanEnv({ COUNCIL_MOCK_DELAY_MS: '2500' }) });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  await new Promise(r => setTimeout(r, 1200));
  writeFileSync(join(run, 'HANDOFF.md'), 'ORIGINAL FINISHED HANDOFF\n');   // the real file of a finished run (or, on a case-insensitive disk, what handoff.md already is)
  const code = await new Promise(r => child.on('close', r));
  assert.equal(code, 0, out);
  assert.equal(readFileSync(join(run, 'HANDOFF.md'), 'utf8'), 'ORIGINAL FINISHED HANDOFF\n', 'the original was overwritten');
  assert.ok(readdirSync(run).some(f => /^HANDOFF-from-run.*\.md$/.test(f)), `the handoff was written under another name: ${readdirSync(run)}`);
  assert.match(out, /HANDOFF-from-run/);
});

test('A5-8 (guard): the handoff branch chooses its output name with existsExactCase (not existsSync, which finds handoff.md as HANDOFF.md on a case-insensitive disk) and writes with the exclusive flag', () => {
  const src = readFileSync(join(dirname(cli), 'cli.js'), 'utf8');
  assert.match(src, /existsExactCase\(hRunDir, 'HANDOFF\.md'\)/);
  assert.doesNotMatch(src, /existsSync\(join\(hRunDir, 'HANDOFF\.md'\)\)/);
  assert.match(src, /flag: 'wx'/);
  assert.match(src, /acquireRunLock\(hRunDir\)/);
});
