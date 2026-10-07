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
import { writeLocked } from '../scripts/contract-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const BUDGET_MS = 15_000; // a quarter of the shortest client timeout we know of (60 s)

function client(cwd) {
  // COUNCIL_ADVISE_MOCK: the add-on's tools run their mock advice chains (offline, $0).
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_MOCK: '1', COUNCIL_ADVISE_COOLDOWN_MS: '0' } });
  const waiting = new Map();
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; /* not JSON-RPC */ }
      // A request from the server: the only one is council_advise's elicitation, answered the way a
      // person who read the text and pressed "send" would.
      if (m.method && m.id !== undefined) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: m.method === 'elicitation/create' ? { action: 'accept', content: { send: true } } : {} }) + '\n');
      } else if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
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
      await send('initialize', { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'latency', version: '0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    list: async () => (await send('tools/list', {})).result.tools.map(t => t.name),
    async call(name, args) {
      const t0 = performance.now();
      const m = await send('tools/call', { name, arguments: args });
      const ms = performance.now() - t0;
      let body = null;
      // The add-on's tools answer in prose plus structuredContent; every older tool answers in JSON text.
      try { body = JSON.parse(m.result.content.find(c => c.type === 'text').text); } catch { body = m.result?.structuredContent ?? m.result?.content?.[0]?.text ?? null; }
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

    // The add-on (0.8.1 M1, S1): a quote, a send the person approves through the elicitation dialog, and
    // run_status holding for a change. Each hold is 1 s, far inside the budget.
    const brief = {
      schema_version: 'advice-brief/1', moment: 'before_commit',
      question: 'Should the note list keep ticked items or remove them?',
      decision_at_stake: 'Removing them loses the history; keeping them clutters the list.',
      options_considered: [{ name: 'Keep', summary: 'Grey them out at the bottom.' }, { name: 'Remove', summary: 'Delete on tick.' }],
      tried: [{ what: 'Asked two users', result: 'They disagreed.' }],
      sensitivity: 'public', not_included: ['the conversation'],
    };
    const quote = await step('council_quote', { brief, mode: 'single' });
    assert.ok(quote.quote_id, JSON.stringify(quote));
    const advised = await step('council_advise', { quote_id: quote.quote_id, confirm_sha256: quote.text.sha256, wait_seconds: 1 });
    assert.ok(advised.run, JSON.stringify(advised));
    await step('run_status', { run: advised.run, wait_seconds: 1 });

    // The contract tools (0.8.2 item 6d): a run folder that holds a locked contract (made by the real contract code), then a read and a request. Both are $0 and local.
    writeLocked(join(dir, 'runs', 'lat-contract'));
    const read = await step('contract_read', { run: 'lat-contract' });
    assert.equal(read.verified, true, JSON.stringify(read));
    const filed = await step('contract_amend', { run: 'lat-contract', version: 1, obligation_id: 'O2', reason: 'latency fixture', proposed_text: 'Every error path prints one line.' });
    assert.equal(filed.requested, true, JSON.stringify(filed));

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
