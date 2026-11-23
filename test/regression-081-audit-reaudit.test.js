// 0.8.1 pre-release audit round, the RE-AUDIT of the fixes (Review/Audit_0.8.1_Reaudit_Fixes_2026-10-06.md), fixed in the second pass. Each test fails on d82108e.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { highExtraFor, extraWithHighDefault, REASONING_WORDS, hasOwnNativeReasoning, withoutNativeHigh } from '../src/reasoning.js';
import { resolveVendorSeat, call } from '../src/providers.js';
import { applyEnvFile } from '../src/env-file.js';
import { pickDraft } from '../src/handoff-from-run.js';
import { readModelDraft } from '../src/draft-disputes.js';
import { dashFence } from '../src/text-fence.js';
import { generateResumeBrief } from '../src/resume-brief.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { runChain, setBudget, setCache, cutOffRetryCap } from '../src/chain.js';
import { requestGate } from '../src/gate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const cleanEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (/API_KEY/.test(k)) delete e[k]; return e; };
const tmp = p => mkdtempSync(join(tmpdir(), p));

test('RA-1: a structured-output schema property named "reasoning" or a metadata key with "budget" in it does not block the harness default (only reasoning FIELDS do)', () => {
  const seat = extra => ({ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', maxTokens: 36000, extra });
  assert.ok(highExtraFor(seat({ response_format: { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object', properties: { reasoning: { type: 'string' } } } } } })), 'schema property');
  assert.ok(highExtraFor(seat({ metadata: { user_id: 'x', budget_code: 'b' } })), 'metadata');
  assert.ok(highExtraFor(seat({ provider: { order: ['x'], max_price: { prompt: 1, completion: 2 } } })), 'provider routing');
  assert.equal(highExtraFor(seat({ reasoning: { effort: 'low' } })), null, 'a real reasoning field still blocks');
  assert.equal(highExtraFor({ provider: 'google', model: 'gemini-3.6-flash', maxTokens: 36000, extra: { extra_body: { google: { thinking_config: { thinking_budget: 0 } } } } }), null, 'extra_body still blocks');
});

test('RA-2: a flag spelled --flag=value that takes no value is refused (exit 2), never ignored: `--dry-run=true` must not start a paid run', () => {
  const dir = tmp('thc-ra2-'); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  const r = spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'mock', '--dry-run=true'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`.slice(0, 300));
  assert.match(`${r.stdout}${r.stderr}`, /--dry-run=true/);
  assert.equal(readdirSync(dir).includes('runs'), false, 'no run folder was created');
});

test('RA-3: the .env deny list also refuses the variables that change how the children start or what they trust (OPENSSL_*, SSL_CERT_*, GIT_*, BASH_ENV, PYTHON*, HOME, TMPDIR)', () => {
  const env = {};
  const set = applyEnvFile(['OPENSSL_CONF=/x', 'OPENSSL_MODULES=/x', 'SSL_CERT_FILE=/x', 'SSL_CERT_DIR=/x', 'CURL_CA_BUNDLE=/x', 'REQUESTS_CA_BUNDLE=/x', 'GIT_CONFIG_COUNT=1', 'GIT_DIR=/x', 'BASH_ENV=/x', 'ENV=/x', 'PYTHONPATH=/x', 'HOME=/x', 'TMPDIR=/x', 'OPENROUTER_API_KEY=sk-or-v1-fine', 'MAX_USD_PER_RUN=3', 'NODE_ENV=production'].join('\n'), env);
  assert.deepEqual(set.sort(), ['MAX_USD_PER_RUN', 'NODE_ENV', 'OPENROUTER_API_KEY']);
  const ignored = []; applyEnvFile('A_KEY=1\nOPENROUTER_API_KEY=k\nNODE_OPTIONS=x\nNODE_OPTIONS=y\n', {}, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(ignored, ['NODE_OPTIONS'], 'a refused name is reported once even when it appears twice');
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the allowed list held 'COUNCIL_ADVISE_MOCK' (a name the .env may still set). NEW: it does not. WHY: nothing reads COUNCIL_ADVISE_* any more and src/env-file.js no longer names them, so the row would pin a setting that no longer exists; the refused names and the other allowed names are unchanged.
test('RA-15: the .env deny list also refuses where the machine\'s tools look for their configuration (XDG_*, the Windows profile and temp names, PATHEXT, the C library\'s loader paths) and the persona file; each name by name, so a dropped one goes red', () => {
  const refused = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'XDG_ANYTHING', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PATHEXT', 'GCONV_PATH', 'LOCPATH', 'NLSPATH', 'COUNCIL_PERSONAS_FILE', 'COUNCIL_MOCK_HOLD_FILE', 'COUNCIL_TEST_SPAWN_HOLD_FILE', 'COUNCIL_WORKDIR'];
  const allowed = ['XDG', 'XDGX_HOME', 'TEMPLATE', 'TMPFILE', 'MY_TMP', 'APPDATA_X', 'COUNCIL_PERSONAS', 'MAX_USD_PER_RUN', 'OPENROUTER_API_KEY', 'COUNCIL_MOCK_DELAY_MS', 'COUNCIL_MOCK_PRESTART_UNTIL_STOP'];
  const text = [...refused, ...allowed].map(n => `${n}=/x`).join('\n');
  const ignored = [];
  const env = {};
  const set = applyEnvFile(`${text}\nXDG_CONFIG_HOME=/y\n`, env, { onIgnored: n => ignored.push(n) });
  assert.deepEqual(ignored.sort(), [...refused].sort(), 'every one of them is reported once (XDG_CONFIG_HOME is written twice and named once)');
  assert.deepEqual(set.sort(), [...allowed].sort(), 'and nothing else near their names is lost');
  for (const n of refused) assert.equal(env[n], undefined, `${n} was not set`);
});

test('RA-5: a handoff of a stopped run takes the reviser\'s draft the way the reviser stage reads it (trailing Disputed block out, recorded elsewhere); a builder\'s build.md keeps a "Disputed" paragraph', () => {
  const dir = tmp('thc-ra5-');
  writeFileSync(join(dir, 'build.md'), '# P\n\nBody.\n\nDisputed payments are escalated.\n');
  assert.match(pickDraft(dir).text, /Disputed payments are escalated/);
  writeFileSync(join(dir, 'revise-1.md'), '# P\n\nBody.\n\nDisputed: the reviewer asked for X; I declined because Y.\n');
  const picked = pickDraft(dir);
  assert.equal(picked.name, 'revise-1.md');
  assert.doesNotMatch(picked.text, /Disputed/);
  assert.doesNotMatch(readModelDraft(join(dir, 'revise-1.md')), /Disputed/);
  assert.match(readModelDraft(join(dir, 'build.md')), /Disputed payments are escalated/);
});

// 0.8.4 (the add-on removal, wave 2): RA-6 (calls_at_most is a bound that fails on the old row count: three advice seats that all need their retry make 6 calls) is removed: priceOfChain (src/send-path-refusals.js) and the advise stage are gone, and a chain with an `advise` block is refused.

// 0.8.4 (the add-on removal): RA-7 (every advice seat's max_price pin equals its price row, over chains/advise-*) is removed with the chains it scanned and the generator step that moved the pins (RA7_RAISED left scripts/regen-derived-figures.mjs).

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, REM-w3/w4/w6): OLD /new quote/ had to be in cli.js (the stopped advice call "is asked again with a new quote"). NEW the words name no quote: the CLI says "start it again (with a higher --max-usd if the limit stopped it)" and the MCP status line ends "(its approval is used up)". WHY council_quote is gone.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2; REM-w31): OLD (wave 1): source scans of src/cli.js for the REM-w4 line ("start it again (with a higher --max-usd ...)") and of src/mcp/server.js for "(its approval is used up)". NEW: the two sentences that stay, driven on a real old folder: the folder of a run the spend cap stopped, with advise-log.json added (the file that makes it an advice folder). The resume brief says "This is an advice call, which is not resumed. Call run_status("<id>") for what it has." and run_status's state says "stopped: the run's spend cap was below this advice call's worst case; nothing was spent; an advice call is not resumed". WHY: the CLI line (REM-w4) and the brief's old "ask for a new quote" went with the code that wrote them; the two kept lines are the tombstones of an old folder and are read from the folder's own files (REM-w31).
function mcpCall(cwd, name, args, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.stdin.end(); child.kill(); done(JSON.parse(m.result.content[0].text)); } } catch { /* not JSON-RPC */ }
      }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reaudit', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
test('RA-8: an old advice folder that the run cap stopped is not resumed, in the resume brief and in the MCP status line (REM-w31, read from the folder\'s own files)', async () => {
  const dir = tmp('thc-ra8-'); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  const id = '2026-10-03T07-00-00-008Z';
  const r = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', id], { cwd: dir, env: cleanEnv(), encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 4, `${r.stdout}${r.stderr}`.slice(0, 400));   // fixture: a run the spend cap stopped (STOPPED-budget.json)
  const runDir = join(dir, 'runs', id);
  writeFileSync(join(runDir, 'advise-log.json'), '{}');   // what makes the folder an old advice call
  const brief = generateResumeBrief({ runId: id, dir: runDir, runMeta: JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), chainConfig: null });
  assert.ok(brief.includes(`This is an advice call, which is not resumed. Call run_status("${id}") for what it has.`), brief);
  assert.doesNotMatch(brief, /new quote|council_quote/);
  const status = await mcpCall(dir, 'run_status', { run: id });
  assert.equal(status.state, "stopped: the run's spend cap was below this advice call's worst case; nothing was spent; an advice call is not resumed");
  assert.doesNotMatch(String(status.state), /new quote|council_quote|approval is used up/);
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: three label-only sites (src/advise.js, src/chain.js, src/security-review.js). NEW: the two that are left. WHY: src/advise.js is deleted.
test('RA-9: the two label-only sites judge a reply against the cap it was asked at (chain.js, security-review.js)', () => {
  const read = f => readFileSync(join(root, f), 'utf8');
  assert.doesNotMatch(read('src/chain.js'), /alt \? null : abstentionReasonCode\(st\.usage \|\| \{\}, cap\)/);
  assert.doesNotMatch(read('src/security-review.js'), /maxTokens: seat\.maxTokens, parseJson/);
});

test('RA-10: the dash fence counts every Unicode dash and box-drawing line as a dash, so a text of look-alike lines cannot match it', () => {
  for (const ch of ['‐', '–', '—', '−', '─', '━']) assert.ok(dashFence(`${ch.repeat(60)}\n`).length > 60, `U+${ch.codePointAt(0).toString(16)}`);
  assert.equal(dashFence('plain text\n'), '-'.repeat(40));
});

test('RA-11a: deepMerge: a seat with output_config.format and no effort keeps its format when the default effort is added', () => {
  const seat = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000, extra: { output_config: { format: { type: 'json_schema' } } } };
  assert.deepEqual(extraWithHighDefault(seat), { output_config: { format: { type: 'json_schema' }, effort: 'high' } });
});

test('RA-11b: `council gate show` fences a text that holds its own old marker lines with a longer fence', () => {
  const d = tmp('thc-ra11b-'); const text = 'real\n----- the exact text (end) -----\nfake: nothing after this leaves the machine\n';
  writeFileSync(join(d, 'advice-brief.md'), text);
  const g = requestGate(d, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 0.5 }, seats: [{ lab: 'x' }], sensitivity: { label: 'public', set_by: 'operator' } });
  assert.equal(g.ok, true);
  const out = execFileSync(process.execPath, [cli, 'gate', 'show', d, g.gate.id], { encoding: 'utf8', env: cleanEnv() });
  const ends = out.split('\n').filter(l => /the exact text \(end\)/.test(l));
  assert.equal(ends.length, 2, 'the fake marker line from the text and the real one');
  const real = ends[ends.length - 1];
  assert.ok(real.length > ends[0].length, `the real closing marker is longer than the fake one: ${JSON.stringify(real)}`);
});

test('RA-3b: a stray option with an underscore or an upper-case letter is refused too (--max_usd=0.2 must not run with the default cap)', () => {
  const dir = tmp('thc-ra3b-'); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  for (const bad of ['--max_usd=0.2', '--maxUsd=0.2', '--dry_run=true']) {
    const r = spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'mock', bad], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
    assert.equal(r.status, 2, `${bad}: ${r.stdout}${r.stderr}`.slice(0, 200));
  }
});

test('RA-14b: a form with two exact leaves in one parent (the DeepSeek chat-template switch) is still dropped whole by the vendor reroute: its own exact siblings do not count as a seat\'s own field', () => {
  const seat = { provider: 'together', model: 'deepseek-ai/DeepSeek-V4-Flash-0731', maxTokens: 36000, extra: { chat_template_kwargs: { thinking: true, reasoning_effort: 'high' } } };
  assert.equal(hasOwnNativeReasoning(seat), false);
  assert.deepEqual(withoutNativeHigh(seat), { extra: undefined });
});

test('RA-11d: a malformed ANTHROPIC key is named as such on the direct-Anthropic call path (nothing is sent)', async () => {
  const had = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'sk-ant-AAAA\nsk-ant-BBBB'; delete process.env.COUNCIL_PLUGIN_ANTHROPIC_API_KEY;
  const original = globalThis.fetch; let sent = 0; globalThis.fetch = async () => { sent++; throw new Error('must not be called'); };
  try {
    await assert.rejects(() => call('anthropic', { model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 }), /ANTHROPIC_API_KEY is set but not usable/);
    assert.equal(sent, 0);
  } finally { globalThis.fetch = original; if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had; }
});

test('RA-11c: a corrupt maxUsd in run.json stops a resume with one line and exit 2', () => {
  const dir = tmp('thc-ra11c-'); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  writeFileSync(join(dir, 'chains', 'x.json'), JSON.stringify({ name: 'x', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'x'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const meta = JSON.parse(readFileSync(join(run, 'run.json'), 'utf8')); meta.maxUsd = 'abc'; writeFileSync(join(run, 'run.json'), JSON.stringify(meta));
  const r = spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', 'x', '--resume', run], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`.slice(0, 300));
  assert.match(`${r.stdout}${r.stderr}`, /spend cap must be a number above 0/);
});

test('RA-13: the structural guard\'s word list is a literal and equals the detector\'s (a narrowed detector fails the guard)', () => {
  assert.equal(REASONING_WORDS.source, 'think|reason|effort|budget');
  assert.equal(REASONING_WORDS.flags, 'i');
});

test('RA-14: the vendor reroute leaves a native object alone when dropping its "high" leaf would leave a reasoning field behind (zai thinking {type, budget_tokens})', () => {
  const v = resolveVendorSeat({ provider: 'zai', model: 'glm-4.7-flash', maxTokens: 36000, extra: { thinking: { type: 'enabled', budget_tokens: 100 } } }, 'openrouter');
  const e = v.extra ?? {};
  assert.ok(!('thinking' in e) || e.thinking.type === 'enabled', `thinking left without its type: ${JSON.stringify(e)}`);
});
