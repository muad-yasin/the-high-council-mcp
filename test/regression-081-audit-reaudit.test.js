// 0.8.1 pre-release audit round, the RE-AUDIT of the fixes (Review/Audit_0.8.1_Reaudit_Fixes_2026-10-06.md), fixed in the second pass. Each test fails on d82108e.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { priceOfChain } from '../src/send-path-refusals.js';
import { runChain, setBudget, setCache, cutOffRetryCap } from '../src/chain.js';
import { requestGate } from '../src/gate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chain = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));
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

test('RA-4: advise-single-deepseek\'s ceiling covers its first call and ONE retry at the dearest brief (the rule behind every advise.usd), at the refreshed price row', () => {
  const c = chain('advise-single-deepseek');
  const seat = c.seats.critics[0]; const cap = seat.maxTokens ?? 36000;
  const retryChain = structuredClone(c); retryChain.seats.critics[0].maxTokens = cutOffRetryCap(cap);
  for (const text of ['x'.repeat(48_000), '日'.repeat(48_000), 'x'.repeat(12_000)]) {
    const sum = priceOfChain(c, text).worst + priceOfChain(retryChain, text).worst;
    assert.ok(sum <= c.advise.usd, `first + retry ${sum.toFixed(4)} must fit the ceiling ${c.advise.usd}`);
  }
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

test('RA-6: calls_at_most is a bound that fails on the old row count: three seats that all need their retry make 6 calls, the old bound said 3', async () => {
  const mock = (model, lab) => ({ provider: 'mock', model, lab });
  const config = { name: 'ra6', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
    advise: { enabled: true, usd: 100, rounds: 0, synthesis: 'none', max_wall_ms: 120000 }, seats: { critics: [mock('mock-unreadable', 'a'), mock('mock-unreadable', 'b'), mock('mock-unreadable', 'c')] } };
  const labels = [];
  setCache(null); setBudget(null);
  await runChain({ config, request: 'Should we cache it?\n\nWe plan to cache it for 24 hours.\n', log: () => {}, onStage: s => labels.push(s.label) }).catch(() => {});
  const bound = priceOfChain(config, 'Should we cache it?\n\nWe plan to cache it for 24 hours.\n').calls;
  assert.ok(labels.filter(l => /-retry$/.test(l)).length === 3, `fixture: every seat was retried (${labels})`);
  assert.ok(labels.length > 3, `observed ${labels.length} calls, more than the three rows the old bound counted`);
  assert.ok(labels.length <= bound, `${labels.length} calls made, calls_at_most said ${bound}`);
});

test('RA-7: every advice seat whose price row was not raised in the audit pins max_price EQUAL to its row (a lower max_price could leave no endpoint to route to)', () => {
  const RAISED = new Set(['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'z-ai/glm-5.2', 'meta-llama/llama-3.3-70b-instruct']);
  const pricing = JSON.parse(readFileSync(join(root, 'src', 'pricing.json'), 'utf8'));
  const bad = [];
  for (const f of readdirSync(join(root, 'chains')).filter(f => /^advise-/.test(f))) for (const s of chain(f.slice(0, -5)).seats.critics) {
    const mp = s.extra?.provider?.max_price; const row = pricing[`${s.provider}/${s.model}`];
    if (!mp || !row || RAISED.has(s.model)) continue;
    if (mp.prompt !== row.in || mp.completion !== row.out) bad.push(`${f}: ${s.model} max_price ${JSON.stringify(mp)} vs row ${row.in}/${row.out}`);
  }
  assert.deepEqual(bad, []);
});

test('RA-8: an advice call stopped by the run cap is "asked again with a new quote" (its approval is used up), in the CLI text and in the MCP status line', () => {
  const cliSrc = readFileSync(cli, 'utf8');
  assert.doesNotMatch(cliSrc, /ask again with a higher --max-usd/);
  assert.match(cliSrc, /new quote/);
  const srv = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
  assert.match(srv, /budget\.stoppedByCap \? \(isAdviceFolder\(dir\)/);
});

test('RA-9: the three label-only sites judge a reply against the cap it was asked at (advise.js, chain.js, security-review.js)', () => {
  const read = f => readFileSync(join(root, f), 'utf8');
  assert.doesNotMatch(read('src/advise.js'), /abstentionReasonCode\(st\?\.usage \|\| \{\}, cap\)/);
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
