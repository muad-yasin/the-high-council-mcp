// An advice call whose seat OpenRouter refused at its price pin FAILS WHOLE (0.8.3, 18 Okt 2026; Muad: "judge refused for its price should fail the whole call and tell the user about it, instead of sending half a call"; gate note
// Review/Build_0.8.3/m7/A_Advice_Refusal_Fails_Whole_Call_Gate_Note.md, C&C PASS with conditions). This REVERSES the morning's A3a commit 2 rule (PR-10 in test/price-refused.test.js, flipped in this commit).
// Offline, $0: a local stub server answers HTTP 404 (the one probe's body) to the refused OpenRouter seat; the other seats are mocks or a second stub-served OpenRouter seat. The CLI and MCP rows drive the REAL verbs.
// What is pinned: the engine rethrows at all three sites (blind wave, debate wave, synthesis), every sibling of the wave is recorded before the throw, the CLI exits 16 with the stop files and no report, the run is not resumable,
// the MCP answer names the cause, the spend and the run folder (absolute) and returns no opinion text, labelled untrusted, a STOP request in the folder does not change that, and the two sentences in README / CHANGELOG say it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PriceRefused } from '../src/price-refused.js';
import { runChain, setCache, setBudget } from '../src/chain.js';
import { call as mockCall } from '../src/providers.js';
import { deriveRunStatus, runResumability } from '../src/run-status.js';
import { usageSpendOf } from '../src/spend.js';
import { makeResultFor } from '../src/mcp/advice.js';
import { writeStopRequest } from '../src/stop-files.js';
import { TRUST_META_KEY } from '../src/return-path.js';
import { createHash } from 'node:crypto';
import { requestGate, answerGate, readGateAnswer } from '../src/gate.js';
import { gateSeatsOf } from '../src/send-path-refusals.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-18T12-00-00-000Z';
const PROBE_BODY = { error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } };
const REFUSED_MODEL = 'qwen/qwen3.7-plus';
const SERVED_MODEL = 'google/gemini-3.8-flash';

// A stub OpenRouter: `answer(model, n)` decides per request (n = requests so far, this one included). Served = an advisor reply written by the mock provider; refused = the probe's 404.
async function stub(answer) {
  const hits = [];
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}'); hits.push(body.model);
      const a = await answer(body.model, hits.length);
      if (a === 'refuse') { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify(PROBE_BODY)); return; }
      const system = (body.messages ?? []).filter(m => m.role === 'system').map(m => m.content).join('\n');   // the mock reads the advisor prompt to answer in the advisor's JSON, as a real host would
      const r = await mockCall('mock', { model: a, system, messages: [{ role: 'user', content: (body.messages ?? []).filter(m => m.role === 'user').at(-1)?.content ?? '' }], maxTokens: body.max_tokens ?? 500 });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'stub', model: body.model, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }], usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}
// refused model gets the 404, the served model gets an advisor reply ('proceed' unless `served` says otherwise)
const byModel = (served = 'mock-advisor-proceed') => stub(model => (model === REFUSED_MODEL ? 'refuse' : served));
// zdr + data_collection: an advice seat is routed to zero-retention endpoints only (the adopted call checks it); the price pin is filled from the table
const or = (url, model, lab) => ({ provider: 'openrouter', model, lab, maxTokens: 500, baseUrl: url, extra: { provider: { zdr: true, data_collection: 'deny' } } });
const mock = (model, lab) => ({ provider: 'mock', model, lab });

const withEnv = async fn => {
  const had = { k: process.env.OPENROUTER_API_KEY, l: process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST };
  process.env.OPENROUTER_API_KEY = 'sk-test'; process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = '1';
  try { return await fn(); } finally {
    if (had.k === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had.k;
    if (had.l === undefined) delete process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; else process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = had.l;
  }
};
const cfg = (critics, advise = {}, builder = null) => ({ name: 'test-advice-refusal', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1, rounds: 0, max_wall_ms: 120000, ...advise }, seats: { ...(builder ? { builder } : {}), critics } });
const go = (config, stages = []) => { setCache(null); setBudget(null); return runChain({ config, request: '# Should we cache the price list?\n\nWe plan to cache it for 24 hours.\n', log: () => {}, onStage: s => stages.push(s.label) }); };
const rejected = p => p.then(() => null, e => e);

test('AR-1 (engine, blind wave): a refused seat fails the whole call; every sibling of the wave is recorded first; a second refused seat of the wave rides along as `also`; nothing after the wave runs', async () => {
  const s = await byModel();
  await withEnv(async () => {
    try {
      const stages = [];
      const err = await rejected(go(cfg([mock('mock-advisor-proceed', 'adv-a'), or(s.url, REFUSED_MODEL, 'orx'), mock('mock-advisor-proceed', 'adv-c'), or(s.url, REFUSED_MODEL, 'ory')], { rounds: 1, synthesis: 'seat' }, mock('mock-advise-synth', 'synth')), stages));
      assert.ok(err instanceof PriceRefused && err.controlFlow === true, `expected PriceRefused, got ${err?.constructor?.name}: ${err?.message}`);
      assert.equal(err.seat, `openrouter/${REFUSED_MODEL}`);
      assert.equal(err.also?.length, 1, 'the second refused seat of the wave is named on the same error');
      assert.ok(stages.includes('advise-adv-a') && stages.includes('advise-adv-c'), `both mock voices were recorded before the throw: ${stages}`);
      assert.ok(!stages.some(l => /^advise-(debate|synthesis)/.test(l)), 'no debate and no synthesis was paid for after the refusal');
    } finally { await s.close(); }
  });
});

test('AR-2 (engine, debate wave): the blind wave is paid in full, then a refused debate seat fails the whole call', async () => {
  // the served seat answers the blind wave; its debate reply (second request to it) is refused. Seats disagree so the debate runs.
  let servedCalls = 0;
  const s = await stub(model => { if (model === REFUSED_MODEL) return 'refuse'; servedCalls += 1; return servedCalls === 1 ? 'mock-advisor-proceed' : 'refuse'; });
  await withEnv(async () => {
    try {
      const stages = [];
      const err = await rejected(go(cfg([or(s.url, SERVED_MODEL, 'ora'), mock('mock-advisor-stop', 'adv-b'), mock('mock-advisor-proceed', 'adv-c')], { rounds: 1 }), stages));
      assert.ok(err instanceof PriceRefused, `expected PriceRefused, got ${err?.constructor?.name}: ${err?.message}`);
      assert.ok(stages.includes('advise-ora') && stages.includes('advise-adv-b') && stages.includes('advise-adv-c'), `the blind wave is recorded: ${stages}`);
      assert.ok(stages.some(l => l.startsWith('advise-debate-1-')), `the debate wave ran and its mock replies are recorded: ${stages}`);
    } finally { await s.close(); }
  });
});

test('AR-3 (engine, synthesis): a refused synthesis seat fails the whole call although every opinion was paid for', async () => {
  const s = await byModel();
  await withEnv(async () => {
    try {
      const stages = [];
      const err = await rejected(go(cfg([mock('mock-advisor-proceed', 'adv-a'), mock('mock-advisor-proceed', 'adv-c')], { rounds: 0, synthesis: 'seat' }, or(s.url, REFUSED_MODEL, 'synth')), stages));
      assert.ok(err instanceof PriceRefused, `expected PriceRefused, got ${err?.constructor?.name}: ${err?.message}`);
      assert.ok(stages.includes('advise-adv-a') && stages.includes('advise-adv-c'), `the opinions are recorded: ${stages}`);
    } finally { await s.close(); }
  });
});

test('AR-4 (engine, one seat and a mixed wave): a single refused seat meets the PriceRefused (not the "none returned a readable opinion" floor); with a down lab beside it the REFUSAL wins when it comes first', async () => {
  const s = await byModel();
  await withEnv(async () => {
    try {
      const one = await rejected(go(cfg([or(s.url, REFUSED_MODEL, 'orx')])));
      assert.ok(one instanceof PriceRefused, `one seat: ${one?.constructor?.name}: ${one?.message}`);
      const mixed = await rejected(go(cfg([or(s.url, REFUSED_MODEL, 'orx'), mock('mock-provider-error', 'down'), mock('mock-advisor-proceed', 'adv-c')])));
      assert.ok(mixed instanceof PriceRefused, `mixed wave, refusal first: ${mixed?.constructor?.name}: ${mixed?.message}`);
    } finally { await s.close(); }
  });
});

// ---- real verbs: the CLI, then the MCP answer on the folder it left --------------------------------------------------------------
function workspace(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-advice-refusal-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Should we cache the price list for 24 hours?\n');
  writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain));
  // an advice call's chain never comes from the project's chains/ on a resume: the operator's folder, a sibling outside the work folder (COUNCIL_ADVICE_CHAINS_DIR)
  mkdirSync(`${dir}-chains`); writeFileSync(join(`${dir}-chains`, `${chain.name}.json`), JSON.stringify(chain));
  return dir;
}
const spawnCli = dir => args => new Promise(done => {
  let out = '';
  const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), ...malformedProviderKeys(), OPENROUTER_API_KEY: 'test-key-not-real', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1', COUNCIL_ADVICE_CHAINS_DIR: `${dir}-chains` } });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  child.on('exit', code => done({ code, out }));
});

// A real failed advice call: a brief, its meta, an approved gate (answered through the same answerGate the terminal form calls), then --advice-adopt against the stub (the served seat answers, the refused seat gets the 404).
async function failedAdviceRun(s) {
  const dir = workspace({ ...cfg([or(s.url, SERVED_MODEL, 'ora'), or(s.url, REFUSED_MODEL, 'orx'), mock('mock-advisor-proceed', 'adv-c')]), name: 'advice-refused-cli' });
  const rd = join(dir, 'runs', RUN);
  // an advice call starts the way the send path starts it: a brief, its meta, an approved gate (answered here through the same answerGate the terminal form calls), then --advice-adopt
  mkdirSync(rd, { recursive: true });
  const text = '# A brief\n\nShould we cache the price list for 24 hours?\n'; const sha = createHash('sha256').update(text).digest('hex');
  writeFileSync(join(rd, 'advice-brief.md'), text);
  writeFileSync(join(rd, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain: 'advice-refused-cli', gate: 'g1', brief_sha256: sha, mode: 'council', advisor: null, effective_sensitivity: 'public', question_hash: sha.slice(0, 16), question_words: [sha.slice(0, 8)], has_new_evidence: false, quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 1 }, previous_run: null, dispositions: [] }));
  const g = requestGate(rd, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 1 }, seats: gateSeatsOf(JSON.parse(readFileSync(join(`${dir}-chains`, 'advice-refused-cli.json'), 'utf8'))), sensitivity: { label: 'public', set_by: 'test' } });   // public: a seat with no zero-retention endpoint is allowed, the stub has none
  assert.ok(g.ok, g.message);
  const a = answerGate(rd, 'g1', { channel: 'cli', shownSha256: readGateAnswer(rd, 'g1').gate.sha256, decision: 'approved', actor: 'test', tty: true });
  assert.ok(a.ok, a.message);
  const first = await spawnCli(dir)(['--advice-adopt', `runs/${RUN}`]);
  assert.equal(first.code, 16, first.out);   // EXIT_RUN_FAILED (src/cli.js, not exported)
  return { dir, rd, first };
}

test('AR-5 (real verbs): the CLI exits 16 with STOPPED-error.json (kind price_refused, seats, spentUsd, callsPaid, runPath), the sentence names the run folder, no report.json / report-partial.json, the paid sibling is on disk, and the run is NOT resumable', async () => {
  const s = await byModel();
  try {
    const { dir, rd } = await failedAdviceRun(s);
    const e = JSON.parse(readFileSync(join(rd, 'STOPPED-error.json'), 'utf8'));
    assert.equal(e.exitCode, 16); assert.equal(e.kind, 'price_refused'); assert.deepEqual(e.seats, [`openrouter/${REFUSED_MODEL}`]);
    assert.equal(e.runPath, `runs/${RUN}`);
    // calls_paid is EXACT: the served OpenRouter call + the mock voice; the refused call (HTTP 404, nothing generated) leaves no usage file, so the sentence's "their answers are in the folder" is true of every counted call
    const served = s.hits.filter(m => m === SERVED_MODEL).length;
    assert.equal(e.callsPaid, served + 1, `callsPaid ${e.callsPaid} = served ${served} + the mock voice`);
    assert.deepEqual(readdirSync(rd).filter(f => /^advise-.*\.usage\.json$/.test(f)).sort(), ['advise-adv-c.usage.json', 'advise-ora.usage.json'], 'one usage file per paid call, none for the refused seat');
    assert.ok(e.spentUsd > 0, `the served seat is priced, so something was spent: ${e.spentUsd}`);
    assert.ok(e.message.length > 500, 'the sentence is stored whole, not cut at 500 characters');
    for (const w of [`runs/${RUN}/`, 'not delivered', 'never delivered in part', 'pricing.user.json', 'ask for a new quote']) assert.ok(e.message.includes(w), `the sentence says "${w}": ${e.message}`);
    assert.ok(!existsSync(join(rd, 'report.json')) && !existsSync(join(rd, 'report-partial.json')), 'nothing is delivered from a failed call');
    assert.ok(existsSync(join(rd, 'advise-ora.usage.json')), 'the served sibling was recorded before the call failed');
    // the two figures agree: the CLI's in-process spend and the usage files
    assert.ok(Math.abs(e.spentUsd - usageSpendOf(rd).usd) < 1e-9, `spentUsd ${e.spentUsd} vs usage files ${usageSpendOf(rd).usd}`);
    assert.equal(deriveRunStatus(rd, null), 'failed');
    const res = runResumability(rd, null);
    assert.equal(res.resumable, false); assert.equal(res.reason, 'advice_call', 'an advice call is never resumed, whatever ended it (0.8.1 decided rule 6): runResumability already says so, no new word');
    assert.ok(!/--resume/.test(readFileSync(join(rd, 'STOPPED-error.md'), 'utf8')), 'STOPPED-error.md offers no resume');
    { const stopped = readFileSync(join(rd, 'STOPPED-error.md'), 'utf8'); assert.ok(stopped.includes('refused at its price limit') && !/\bpin\b/i.test(stopped), 'STOPPED-error.md says "price limit", not "pin" (term sweep, 23 Okt 2026)'); }

    // ---- the MCP answer on that folder (council_advise / run_status share makeResultFor) ----
    const resultFor = makeResultFor({ runsDir: join(dir, 'runs'), masks: new Map(), statusOf: run => deriveRunStatus(join(dir, 'runs', run), null) });
    const check = r => {
      const body = JSON.parse(r.content[0].text);
      assert.equal(body.cause, 'price_refused'); assert.equal(body.status, 'failed'); assert.equal(body.delivered, false);
      assert.equal(body.run_folder, `runs/${RUN}`, 'the relative folder, as the sentence names it (no other MCP answer returns an absolute path)'); assert.equal(body.calls_paid, 2); assert.ok(body.spent_usd > 0);
      assert.ok(body.note.includes(`runs/${RUN}/`) && body.seats.includes(`openrouter/${REFUSED_MODEL}`));
      assert.ok(body.untrusted_fields.includes('note') && r._meta?.[TRUST_META_KEY]?.trust === 'untrusted_model_output', 'the quoted OpenRouter text is labelled untrusted');
      assert.ok(!('answer' in body) && !('dissent' in body) && !('leaning_words' in body) && !r.structuredContent, 'no opinion text of any kind');
    };
    check(resultFor(RUN));
    // a client's STOP request in the same folder does not change the answer: STOPPED-error.md wins the status
    writeStopRequest(rd, { by: 'client_cancel', run: RUN, note: 'test' });
    assert.equal(deriveRunStatus(rd, null), 'failed');
    check(resultFor(RUN));
    assert.ok(!readdirSync(rd).some(f => /^STOPPED-(client_cancel|user|wall_clock)/.test(f)), 'no STOPPED-<by> marker was written');
  } finally { await s.close(); }
});

// ---- AR-7: run_status THROUGH THE SERVER (src/mcp/server.js, the failed + advice + price_refused route), not makeResultFor directly -------------------------------------------------------------------
function mcpSession(dir) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_COOLDOWN_MS: '0' } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in 40 s from the MCP child pid ${child.pid}`)); }, 40_000); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'advice-refusal-test', version: '1' } }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return { async call(name, args) { await ready; return (await rpc('tools/call', { name, arguments: args })).result; }, close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }) };
}

test('AR-7 (real verbs): run_status on a failed advice folder with STOPPED-error.json kind price_refused answers through the server route with cause price_refused, delivered:false, the relative folder and `note` labelled untrusted', async () => {
  const s = await byModel();
  try {
    const { dir } = await failedAdviceRun(s);
    const m = mcpSession(dir);
    try {
      const r = await m.call('run_status', { run: RUN });
      const body = JSON.parse(r.content[0].text);
      assert.equal(body.cause, 'price_refused', JSON.stringify(body).slice(0, 400)); assert.equal(body.delivered, false); assert.equal(body.run_folder, `runs/${RUN}`);
      assert.ok(body.untrusted_fields?.includes('note') && body.note.includes(`runs/${RUN}/`), 'the sentence is in a field labelled untrusted');
      assert.ok(!('answer' in body) && !('dissent' in body), 'no opinion text');
    } finally { await m.close(); }
  } finally { await s.close(); }
});

test('AR-6: README and CHANGELOG say the call fails whole, and no longer say the other seats\' opinions are returned', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8'); const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  for (const [name, text] of [['README.md', readme], ['CHANGELOG.md', changelog]]) {
    assert.ok(/advice call, which cannot pause, fails as a whole|never delivered in part/.test(text), `${name} states the whole-call failure`);
    assert.ok(!/returns the other seats' opinions/.test(text), `${name} no longer describes the dropout rule`);
  }
});
