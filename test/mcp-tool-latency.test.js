// Every MCP tool answers well inside a client's tool-call timeout (0.8.0 B7; wave-4 briefs 16 and 22).
// The agents THC is used from give a call anywhere from 60 s (Cursor's CLI path, dsh, Zed's default) to
// 300 s (Codex, Hermes, goose) and some gave up on a new server after a few seconds; a tool that
// blocks (the run itself is a detached child, so none should) would look like a hung council. This
// runs one real server over stdio through a full mock run - write_task, start_run to an external
// pause, external_prompt, submit_stage, resume - and times every call. Offline, $0.
//
// It derives the tool list from the server, so a new tool with no fixture here fails the test: add a
// step to `steps` (that is the point). The budget is generous on purpose (a loaded machine, a cold
// disk); the reports measured 1 ms to 310 ms per call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const BUDGET_MS = 15_000; // a quarter of the shortest client timeout we know of (60 s)

function client(cwd) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
  const waiting = new Map();
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      try { const m = JSON.parse(line); if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* not JSON-RPC */ }
    }
  });
  let n = 0;
  const send = (method, params) => new Promise((ok, fail) => {
    const id = ++n;
    const timer = setTimeout(() => { waiting.delete(id); fail(new Error(`${method} ${params?.name ?? ''} gave no answer in ${BUDGET_MS} ms`)); }, BUDGET_MS);
    waiting.set(id, m => { clearTimeout(timer); ok(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    async init() {
      await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'latency', version: '0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    list: async () => (await send('tools/list', {})).result.tools.map(t => t.name),
    async call(name, args) {
      const t0 = performance.now();
      const m = await send('tools/call', { name, arguments: args });
      const ms = performance.now() - t0;
      let body = null;
      try { body = JSON.parse(m.result.content.find(c => c.type === 'text').text); } catch { body = m.result?.content?.[0]?.text ?? null; }
      return { ms, body };
    },
    stop: () => { child.stdin.end(); child.kill(); },
  };
}

test('every MCP tool answers within the budget through a whole mock run, and every tool is exercised', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-latency-'));
  const c = client(dir);
  const timings = [];
  const step = async (name, args) => {
    const r = await c.call(name, args);
    timings.push({ name, ms: Math.round(r.ms) });
    assert.ok(r.ms < BUDGET_MS, `${name} took ${Math.round(r.ms)} ms (budget ${BUDGET_MS} ms)`);
    return r.body;
  };
  try {
    await c.init();
    const tools = await c.list();

    await step('write_task', { name: 'lat', content: '# A plan\n\nPlan a small note-taking app: one list, add and tick items.\n' });
    await step('list_chains', {});
    await step('dry_run', { chain: 'mock-external' });
    const started = await step('start_run', { chain: 'mock-external', task: 'tasks/lat.md', max_usd: 5 });
    assert.equal(started.started, true, JSON.stringify(started));
    const run = started.run;

    // The run is a detached child: poll, never block, until it has paused at its external builder.
    let status;
    for (let i = 0; i < 100; i++) {
      status = await step('run_status', { run });
      if (status.status === 'paused') break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert.equal(status.status, 'paused', `the run never paused: ${JSON.stringify(status)}`);
    const prompt = await step('external_prompt', { run });
    assert.ok(prompt.stage && prompt.prompt, JSON.stringify(prompt));
    await step('prepare_stage_prompt', { run });
    await step('submit_stage', { run, stage: prompt.stage, content: '# Plan\n\nA small note-taking app: one list, add and tick items.\n' });
    await step('resume_run', { run, max_usd: 5 });

    // Let the resumed child settle (it pauses again at the reviser or finishes) before anything reads its folder.
    for (let i = 0; i < 100; i++) {
      status = await step('run_status', { run });
      if (['paused', 'done', 'stopped', 'budget_stopped', 'blocked'].includes(status.status)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await step('run_status', { run, brief: true });
    await step('list_runs', {});
    await step('read_run_file', { run, file: 'run.log' });
    await step('plan_outline', { run });
    await step('spend_report', {});
    await step('verdict_stats', {});
    await step('metrics_report', {});

    const untested = tools.filter(t => !timings.some(x => x.name === t));
    assert.deepEqual(untested, [], `a tool with no latency fixture: add a step to this test (${untested.join(', ')})`);
    const slowest = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
    assert.ok(slowest.ms < BUDGET_MS, `slowest call ${slowest.name} ${slowest.ms} ms`);
  } finally {
    c.stop();
    // The resumed run's child may still be finishing its last write: retry the cleanup.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
