// A host that launches src/mcp/server.js from a bundle (Claude Desktop's .mcpb, mcpb/manifest.json)
// controls neither the server's working directory nor, for an optional setting the user left
// empty, whether its `${user_config.x}` placeholder was substituted. Offline, against a real
// server over stdio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keyEnvValue } from '../src/key-env.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { childGone } from './helpers/child-gone.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'src', 'mcp', 'server.js');

function mcpSession({ cwd, env, calls }) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bundle-host-test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
  ];
  // No PATH: the server must find Node for its CLI child without one, as a bundle host may not
  // put its own Node on PATH.
  const r = spawnSync(process.execPath, [server], {
    cwd, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 90_000, env: { ...malformedProviderKeys(), ...env },
  });
  const byId = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
  }
  return byId;
}
const payload = m => JSON.parse(m?.result?.content?.[0]?.text ?? 'null');
test('COUNCIL_WORKDIR puts tasks and runs there, not in the directory the host started the server in', () => {
  const hostCwd = mkdtempSync(join(tmpdir(), 'thc-host-'));
  const work = join(mkdtempSync(join(tmpdir(), 'thc-work-')), 'council'); // does not exist yet
  try {
    const res = mcpSession({
      cwd: hostCwd,
      env: { COUNCIL_WORKDIR: work },
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/demo.md', max_usd: 1 } },
      ],
    });
    assert.ok(existsSync(join(work, 'tasks', 'demo.md')), 'the task was written under COUNCIL_WORKDIR');
    assert.ok(!existsSync(join(hostCwd, 'tasks')), 'nothing was written where the host started the server');
    const started = payload(res.get(3));
    assert.equal(started?.started, true, JSON.stringify(started));
    assert.ok(existsSync(join(work, 'runs', started.run)), 'the run folder is under COUNCIL_WORKDIR');
  } finally {
    rmSync(hostCwd, { recursive: true, force: true });
  }
});

test('an unsubstituted ${user_config.x} placeholder is read as unset, not as a key or a ceiling', () => {
  // $0 BY CONSTRUCTION (Haiku batch 4 A7 #1, 13 Oct 2026): this test used to START `single-vendor-openai` to see the missing-key exit. The child ran in an empty folder, so src/cli.js fell back to the CHECKOUT's own .env, and with an OpenAI
  // key there the first stage was a PAID call (v0.8.2 shipped the same start). No real chain is started now (test/no-paid-chain-spawn.test.js refuses one). The strip is shown where it happens, and the ceiling placeholder through a MOCK run.
  const ph = '${user_config.openai_api_key}'; const phCap = '${user_config.max_usd}';
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(server).href)}); console.log(JSON.stringify({ key: process.env.OPENAI_API_KEY ?? null, cap: process.env.MAX_USD_PER_RUN ?? null }));`],
    { cwd: mkdtempSync(join(tmpdir(), 'thc-probe-')), env: { OPENAI_API_KEY: ph, MAX_USD_PER_RUN: phCap }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), { key: null, cap: null }, 'importing the server drops both placeholders from the environment, so no child can see them');
  assert.equal(keyEnvValue('OPENAI_API_KEY', { OPENAI_API_KEY: ph }), null, 'and a placeholder is not a key even if one did get through');
  const work = mkdtempSync(join(tmpdir(), 'thc-work-'));
  try {
    const res = mcpSession({
      cwd: work,
      env: { OPENAI_API_KEY: ph, MAX_USD_PER_RUN: phCap },
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/demo.md' } },
      ],
    });
    const mock = payload(res.get(3));
    assert.equal(mock?.started, true, `a placeholder ceiling must fall back to the default, got ${JSON.stringify(mock)}`);
  } finally {
    // The mock run started above is detached and may still be writing; the tmp dir is left for the OS.
  }
});

test('COUNCIL_MAX_USD_LIMIT is a ceiling the tool arguments cannot lift or remove', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-work-'));
  let capped = null;
  try {
    const res = mcpSession({
      cwd: work,
      env: { COUNCIL_MAX_USD_LIMIT: '1', MAX_USD_PER_RUN: '50' },
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md', max_usd: 'none' } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md', max_usd: 5 } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md' } },
        { name: 'start_run', arguments: { chain: 'mock-budget', task: 'tasks/demo.md', max_usd: 0 } },
      ],
    });
    // 0.7.9 ("Refuse 0 everywhere"): max_usd 0 no longer means no ceiling; the schema refuses it.
    const zero = res.get(6);
    assert.ok(zero?.error || zero?.result?.isError, `max_usd 0 must be refused, got ${JSON.stringify(zero)}`);
    assert.ok(!existsSync(join(work, 'runs')) || readdirSync(join(work, 'runs')).length <= 1, 'max_usd 0 started no run');
    for (const id of [3, 4]) {
      const r = payload(res.get(id));
      assert.equal(r?.started, false, JSON.stringify(r));
      assert.match(r.error, /COUNCIL_MAX_USD_LIMIT/);
      assert.equal(r.run, undefined, 'refused before any run folder was made');
    }
    // No max_usd: the lower of the limit ($1) and MAX_USD_PER_RUN ($50) applies, and stops the run.
    capped = payload(res.get(5));
    // On a quiet machine the cap stops the run before start_run returns (exitCode 4). On a loaded
    // one the child can get past startup first, so start_run says started:true and the stop lands
    // a moment later; either way the run must end at the cap.
    if (capped?.started) {
      const file = join(work, 'runs', capped.run, 'STOPPED-budget.json');
      const t0 = Date.now();
      while (!existsSync(file) && Date.now() - t0 < 60_000) spawnSync('sleep', ['0.2']);
    } else {
      assert.equal(capped?.exitCode, 4, JSON.stringify(capped));
    }
    const stop = JSON.parse(readFileSync(join(work, 'runs', capped.run, 'STOPPED-budget.json'), 'utf8'));
    assert.equal(stop.capUsd, 1);
  } finally {
    // 13 Oct 2026 (teardown race, ENOTEMPTY in this very rmSync): the run start_run spawned is DETACHED and keeps writing after STOPPED-budget.json appears, so removing the folder under it fails.
    // Wait for the child itself to be gone (its pid is in .spawn.json, written by the server when it spawned it): an event, with a guard, never a sleep of a guessed length.
    if (capped?.run) await childGone(join(work, 'runs', capped.run));
    rmSync(work, { recursive: true, force: true });
  }
});

// A resume with no max_usd (submit_stage always, resume_run when the agent omits it) used to pass
// `--max-usd <limit>`, and the CLI replaces a run's saved cap whenever it sees --max-usd: a run
// started at $0.5 under a $1 limit went on at $1. It keeps its own cap now, and a run saved with no
// ceiling at all (started before the limit was set) is brought under the limit.
test('COUNCIL_MAX_USD_LIMIT: a resume without max_usd keeps the run\'s own lower cap, and caps a run that had none', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-work-'));
  const waitFor = async (cond, what) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 60_000) throw new Error(`timed out waiting for ${what}`);
      await new Promise(r => setTimeout(r, 100));
    }
  };
  const paused = dir => !existsSync(join(dir, '.council.lock')) && readdirSync(dir).some(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(dir, f.slice('NEEDS-'.length))));
  const startPaused = async (env, maxUsd) => {
    const res = mcpSession({
      cwd: work, env,
      calls: [
        { name: 'write_task', arguments: { name: 'demo', content: '# Task\n\nPlan a small todo app.\n' } },
        { name: 'start_run', arguments: { chain: 'mock-external', task: 'tasks/demo.md', max_usd: maxUsd } },
      ],
    });
    const started = payload(res.get(3));
    assert.equal(started?.started, true, JSON.stringify(started));
    const dir = join(work, 'runs', started.run);
    await waitFor(() => paused(dir), 'the first external pause');
    return { run: started.run, dir };
  };
  const submitAndSettle = async (env, { run, dir }) => {
    const stage = readdirSync(dir).find(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(dir, f.slice('NEEDS-'.length)))).slice('NEEDS-'.length, -'.md'.length);
    const res = mcpSession({ cwd: work, env, calls: [{ name: 'submit_stage', arguments: { run, stage, content: '# Plan\n\nA small todo app: one list, add and tick items.\n' } }] });
    const r = payload(res.get(2));
    assert.equal(r?.resumed, true, JSON.stringify(r));
    await waitFor(() => existsSync(join(dir, 'report.json')) || paused(dir), 'the resumed sitting to pause or finish');
    return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).maxUsd;
  };
  try {
    const limited = { COUNCIL_MAX_USD_LIMIT: '1' };
    const low = await startPaused(limited, 0.5);
    assert.equal(await submitAndSettle(limited, low), 0.5, 'the run\'s own $0.5 cap survives the resume');

    const uncapped = await startPaused({}, 'none');
    assert.equal(JSON.parse(readFileSync(join(uncapped.dir, 'run.json'), 'utf8')).maxUsd, null);
    assert.equal(await submitAndSettle(limited, uncapped), 1, 'a run with no ceiling resumes under the limit');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
