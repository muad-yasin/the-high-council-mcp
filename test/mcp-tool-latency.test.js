// Every MCP tool answers well inside a client's tool-call timeout (0.8.0 B7; wave-4 briefs 16 and 22).
// The agents THC is used from give a call anywhere from 30 s (the smallest documented limit; docs/mcp-clients.md "The hold") through
// 60 s (Cursor's CLI path, dsh, Zed's default) to 300 s (Codex, Hermes, goose) and some gave up on a new server after a few seconds; a tool that
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
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLocked } from '../scripts/contract-fixtures.mjs';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const BUDGET_MS = 15_000; // half of the smallest documented client limit (30 s, docs/mcp-clients.md "The hold"), a quarter of the next one (60 s)

// The detached children the server spawned for the runs in `dir`: it writes `.spawn.json` ({ pid }) into the run folder at every spawn it makes (src/run-status.js SPAWN_FILE), and nothing else is read, so a fixture's pid in some run.json is never waited for.
function childrenIn(dir) {
  const out = []; const runs = join(dir, 'runs');
  if (!existsSync(runs)) return out;
  for (const run of readdirSync(runs)) {
    try { const pid = JSON.parse(readFileSync(join(runs, run, '.spawn.json'), 'utf8')).pid; if (Number.isInteger(pid) && pid > 0) out.push({ run, pid }); } catch { /* no spawn file, or not readable yet */ }
  }
  return out;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Wait until every child has exited (a detached run finishing its last write). Nothing is ever killed here: a child still alive at the limit is a FINDING (a detached run that never ends), so the failure names its run folder and pid. */
async function waitForChildren(children, ms = 30_000) {
  const end = Date.now() + ms;
  while (children.some(c => alive(c.pid)) && Date.now() < end) await sleep(50);
  const left = children.filter(c => alive(c.pid));
  assert.deepEqual(left, [], `a detached child of this test is still running after ${ms} ms: ${left.map(c => `${c.run} (pid ${c.pid})`).join(', ')}`);
}

function client(cwd, extraEnv = {}) {
  // 0.8.4 (the add-on removal): the advice tools and the mock-advice switch (COUNCIL_ADVISE_MOCK) are gone. The server gets malformed provider keys FIRST (so no tool of this test can reach a paid provider), then the test's own env.
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys(), ...extraEnv } });
  const waiting = new Map();
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; /* not JSON-RPC */ }
      // A request from the server (an elicitation), answered the way a person who pressed "send" would.
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
      // A tool may answer in prose plus structuredContent; the older tools answer in JSON text.
      try { body = JSON.parse(m.result.content.find(c => c.type === 'text').text); } catch { body = m.result?.structuredContent ?? m.result?.content?.[0]?.text ?? null; }
      return { ms, body };
    },
    // Resolves when the SERVER has exited, not when it was told to (0.8.4: the advice runs' client-cancel STOP writer of this exit is gone with the advice tools, the wait stays as the folder is removed right after).
    // Bounded like waitForChildren: a server that does not exit is a finding (named, and killed: it is this test's own spawn), never a hang of the whole file.
    stop: (ms = 10_000) => new Promise((done, fail) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`the MCP server (pid ${child.pid}) was still running ${ms} ms after it was told to stop`)); }, ms);
      child.once('exit', () => { clearTimeout(timer); done(); });
      child.stdin.end(); child.kill();
    }),
  };
}

test('every MCP tool answers within the budget through a whole mock run, and every tool is exercised', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-latency-'));
  const c = client(dir);
  const timings = [];
  let bodyPassed = false;
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
    // The start_run child has paused but is still finishing its last files (state.json ...) when 'paused' first shows. Wait for it to END before the next sitting reuses the folder: it is recorded since 14 Oct 2026
    // (test/mcp-spawn-record.test.js), and a record of the NEXT child overwrites it, so this is the last moment it can be waited for.
    const firstChild = childrenIn(dir).filter(k => k.run === run);
    assert.equal(firstChild.length, 1, `the start_run child must be recorded: ${JSON.stringify(childrenIn(dir))}`);
    await waitForChildren(firstChild);
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

    // The contract tools (0.8.2 item 6d): a run folder that holds a locked contract (made by the real contract code), then a read and a request. Both are $0 and local.
    writeLocked(join(dir, 'runs', 'lat-contract'));
    const read = await step('contract_read', { run: 'lat-contract' });
    assert.equal(read.verified, true, JSON.stringify(read));
    const filed = await step('contract_amend', { run: 'lat-contract', version: 1, obligation_id: 'O2', reason: 'latency fixture', proposed_text: 'Every error path prints one line.' });
    assert.equal(filed.requested, true, JSON.stringify(filed));

    // 0.8.3 M6 S7: tree_status is read-only; a run that is not the root of a tree answers with a plain error, which is still a measured call.
    const notRoot = await step('tree_status', { run });
    assert.match(notRoot.error, /not the root of a recursive-councils tree/, JSON.stringify(notRoot));

    // 0.8.4 (the reply-repair tool): repair_reply for a stage that waits for no repair answers with a plain refusal and writes nothing, which is still a measured call.
    const notRepair = await step('repair_reply', { run, stage: prompt.stage, decline: true });
    assert.match(notRepair.error ?? '', /is not waiting for a repair of/, JSON.stringify(notRepair));

    // 0.8.3: tree_decide (a run that is not a tree root answers with a plain refusal) and price_raise (a run that no price refusal stopped answers with a plain refusal): each a measured call. tree_decide had no step here before (found red at the integration tip, disclosed).
    const notTree = await step('tree_decide', { run, step: 'quote', form: 'keep', reason: 'latency fixture' });
    assert.ok(notTree.refusal || notTree.error, JSON.stringify(notTree));       // a plain refusal of tree_decide for a run that is no tree root (its exact words are pinned by the tree tests)
    const notStopped = await step('price_raise', { run, step: 'quote' });
    assert.match(notStopped.refusal ?? notStopped.error ?? '', /not stopped by a price refusal|no such run|still running/, JSON.stringify(notStopped));
    // 0.8.4 D5a: stop_decide for a run that is not stopped at a choice answers with a plain refusal and writes nothing, which is still a measured call (CHANGED ACCEPTED TEST: OLD no step for it, NEW one; WHY every registered tool must be exercised).
    const notChoice = await step('stop_decide', { run, step: 'quote' });
    assert.match(notChoice.error ?? '', /not stopped at a choice|the stop cannot be read|no such run/i, JSON.stringify(notChoice));

    // 0.8.4 16c-MCP (EDITED, disclosed; OLD: no pause_run step, NEW: one; WHY: this test fails on a tool with no step): pause_run with neither person_words nor reason answers with a plain refusal and writes nothing, which is still a measured call (and cannot pause the live run of this fixture).
    const noWords = await step('pause_run', { run });
    assert.match(noWords.error ?? '', /needs person_words/, JSON.stringify(noWords));

    const untested = tools.filter(t => !timings.some(x => x.name === t));
    assert.deepEqual(untested, [], `a tool with no latency fixture: add a step to this test (${untested.join(', ')})`);
    const slowest = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
    assert.ok(slowest.ms < BUDGET_MS, `slowest call ${slowest.name} ${slowest.ms} ms`);
    // The cleanup below waits for exactly the children the server recorded: a wait that finds none passes as before the fix, so name it (the resumed run; a start_run child makes its own folder after the spawn and is not recorded by the server).
    // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD the recorded children had to include the resumed run AND the advice call (advised.run). NEW only the resumed run. WHY the advice call is no longer part of this test (council_quote / council_advise are not registered).
    const waited = childrenIn(dir).map(k => k.run);
    assert.ok(waited.includes(run), `the cleanup waits for the resumed run, it found: ${JSON.stringify(waited)}`);
    bodyPassed = true;
  } finally {
    await c.stop();
    // The resumed run's child may still be finishing its last write: wait for every detached child to exit BEFORE removing the folder it writes into (it raced the removal as ENOTEMPTY under a 16-job box suite, 14 Oct 2026); the retry stays as a second line.
    // A child that never ends is a finding, but it must not replace the failure of the body that is already being thrown.
    try { await waitForChildren(childrenIn(dir)); } catch (e) { if (bodyPassed) throw e; console.error(`cleanup: ${e.message}`); }
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (bodyPassed) throw e; }
  }
});

test('the cleanup waits for a detached writer: the child that is still writing into a run folder has exited before the folder is removed (the ENOTEMPTY race of the full-load box suite)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-latency-writer-'));
  const run = join(dir, 'runs', 'r1'); mkdirSync(run, { recursive: true });
  // a detached child that keeps creating files in the run folder for about one second, then exits on its own
  const writer = spawn(process.execPath, ['-e', `const fs=require('fs');let i=0;const t=setInterval(()=>{if(i>50){clearInterval(t);return;}try{fs.writeFileSync(${JSON.stringify(run)}+'/f'+(i++),'x');}catch{}},20);`], { detached: true, stdio: 'ignore' });
  writer.unref();
  writeFileSync(join(run, '.spawn.json'), JSON.stringify({ pid: writer.pid }));
  try {
    await sleep(100);
    const children = childrenIn(dir);
    assert.deepEqual(children, [{ run: 'r1', pid: writer.pid }], 'the helper finds the writer from the run folder');
    assert.equal(alive(writer.pid), true, 'control: the child is still writing when the wait starts');
    const t0 = Date.now();
    await waitForChildren(children);
    assert.equal(alive(writer.pid), false, 'the child has exited before the folder is touched');
    assert.ok(Date.now() - t0 >= 300, `the wait really waited (${Date.now() - t0} ms)`);
  } finally { writer.kill('SIGKILL'); }
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  assert.equal(existsSync(dir), false);
});
