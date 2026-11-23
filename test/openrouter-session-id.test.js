// 0.8.4 cache part (b)2, FIX 7 (C&C 10 Nov 2026, the owner's yes after the paid cache test, then widened by him to every OpenRouter call): one OpenRouter session id per RUN, sent as the top-level `session_id` of every OpenRouter request, so the host that wrote a cache entry answers the next call.
// ONE ROW (C&C's ruling: "one row"), SID-1, two halves:
//   (a) THE RUN'S ID, real verbs, offline, $0: a mock chain with an external critic pauses; the id is in run.json (`openrouter_session`, a random id of a fixed shape that holds nothing of the run), a resume carries THE SAME ONE, and the stages finished in sitting 1 still replay from disk: no staleness warning, nothing asked again
//       (the FIX 4 class: the id is in no config, no fingerprint, no prompt hash).
//   (b) THE REQUEST, in process with fetch stubbed: with the id set an OpenRouter call with no marker AND a marked routed Claude call each carry it as a top-level field and NOTHING else of the body changes (the keys of the same request with the id off are the same, `plugins` stays the last key); a seat's own `extra.session_id` wins; a value of another shape is not sent; with no id set no request carries one. NOT checked here: a non-OpenRouter call (the body line is guarded by `provider === 'openrouter'`, src/providers.js callOpenAICompat).
// LIMIT (stated): the real-verb half makes no OpenRouter call (offline), so the line in src/cli.js that hands the id to the adapter is checked by a scan of that line (with a known-bad), not by a request.
// RED RUN: against the tree before the change (323bc03c) plus this file: (a) fails at the id in run.json (the field does not exist) and half (b) never runs; the replay-from-disk part passes there (it pins what held: NO RED OF ITS OWN, the red evidence is the id in run.json, and on the final tree the request body).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitStageAnswer } from '../src/stage-submission.js';
import * as Providers from '../src/providers.js';
import { runSingleStage, setBudget, setCache } from '../src/chain.js';
import * as Held from '../src/held-roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ID = /^thc-[0-9a-f]{24}$/;
afterEach(() => { Providers.setOpenRouterSessionId?.(null); setBudget(null); setCache(null); Held.setHeldForTest(null); });

const mockChain = () => ({
  name: 'wc', signoff: 'unanimous', maxRounds: 2, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [{ provider: 'mock', model: 'mock-review-fixture', lab: 'l1', maxTokens: 3000 }, { provider: 'external', model: 'claude-code-session', lab: 'l2' }, { provider: 'mock', model: 'mock-review-fixture', lab: 'l3', maxTokens: 3000 }] },
});
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const fromDisk = (out, label) => new RegExp(`${label}: [^\\n]*from disk`).test(out);
// what an OpenRouter request carries, the reply stubbed (the pattern of test/run-single-stage-cache.test.js)
const sentBodies = async fn => {
  const real = globalThis.fetch, key = process.env.OPENROUTER_API_KEY, bodies = [];
  process.env.OPENROUTER_API_KEY = 'sk-test-dummy-key';
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ model: 'openai/gpt-6-luna', provider: 'Azure', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 3 } }), { status: 200 }); };
  try { return { bodies, stage: await fn() }; } finally { globalThis.fetch = real; if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; }
};
const LUNA = { provider: 'openrouter', model: 'openai/gpt-6-luna', lab: 'sid', maxTokens: 1000 };
const call = async (seat, label) => { setBudget(5); return sentBodies(() => runSingleStage(seat, { system: 'You are a probe.', user: 'Answer with the single word OK.', label, log: () => {} })); };

test('SID-1 the run\'s OpenRouter session id: made once and kept in run.json (a resume carries the same one, finished stages still replay from disk), and every OpenRouter request carries it as a top-level field and nothing else changes', async () => {
  // (a) real verbs
  const dir = mkdtempSync(join(tmpdir(), 'sid-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'wc.json'), JSON.stringify(mockChain()));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    const r1 = run(['--chain', 'wc', '--task', 'tasks/t.md']);
    assert.equal(r1.status, 3, `fixture: sitting 1 paused at the external critic: ${r1.stdout}${r1.stderr}`);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const id1 = readJson(join(runDir, 'run.json')).openrouter_session;
    assert.match(String(id1), ID, 'run.json carries the run\'s id, a random id of a fixed shape');
    assert.ok(existsSync(join(runDir, 'panel-1-l1.md')) && existsSync(join(runDir, 'panel-1-l3.md')), 'fixture: the siblings were answered and saved');
    submitStageAnswer(runDir, 'panel-1-l2', readFileSync(join(runDir, 'panel-1-l1.md'), 'utf8'), {});
    const r2 = run(['--resume', runDir]);
    const out = r2.stdout + r2.stderr;
    assert.equal(readJson(join(runDir, 'run.json')).openrouter_session, id1, 'a resume carries the SAME id');
    assert.doesNotMatch(out, /CACHE STALENESS WARNING/, out);
    for (const l of ['panel-1-l1', 'panel-1-l3']) assert.ok(fromDisk(out, l), `${l}: replayed from disk, nothing asked again\n${out}`);
    for (const f of ['report.json', 'report-partial.json']) if (existsSync(join(runDir, f))) assert.equal(readFileSync(join(runDir, f), 'utf8').includes(id1), false, `the id is not in ${f}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // the CLI hands the id to the adapter (its line scanned, with a known-bad input)
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const HAND = /setOpenRouterSessionId\(sessionId\);/;
  assert.match(cli, HAND, 'src/cli.js hands the run\'s id to the provider adapter');
  assert.doesNotMatch(cli.replace(HAND, ''), HAND, 'known-bad input: the scan fails without the line');

  // (b) the request
  assert.equal(typeof Providers.setOpenRouterSessionId, 'function', 'the adapter has a setter for the run\'s id');
  const none = await call(LUNA, 'sid-none');
  assert.equal('session_id' in none.bodies[0], false, 'no id set: no request carries one');
  Providers.setOpenRouterSessionId('thc-0123456789abcdef01234567');
  const withId = await call(LUNA, 'sid-with');
  assert.equal(withId.bodies[0].session_id, 'thc-0123456789abcdef01234567', 'an OpenRouter call (no marker at all) carries the run\'s id as a top-level field');
  const keys = b => Object.keys(b);
  assert.deepEqual(keys(withId.bodies[0]).filter(k => k !== 'session_id'), keys(none.bodies[0]), 'nothing else of the body changes, the order of the other keys included (plugins stays the last)');
  assert.equal(keys(withId.bodies[0]).at(-1), 'plugins', '`plugins` is still the last key');
  // a marked routed Claude call (the pattern of FS-1 in test/run-single-stage-cache.test.js): the marker AND the id
  Held.setHeldForTest({ ...HC });
  const HEAD = 'A generic shared beginning for the session id test.\n';
  setBudget(5);
  const marked = await sentBodies(() => runSingleStage({ provider: 'openrouter', originalProvider: 'anthropic', model: 'anthropic/claude-haiku-5.5', lab: 'sidm', maxTokens: 1000 }, { system: 'You are a probe.', user: `${HEAD}Answer with the single word OK.`, label: 'sid-marked', log: () => {}, cacheHead: HEAD, cacheTtl: '5m' }));
  assert.deepEqual(marked.bodies[0].messages.find(m => m.role === 'user').content[0].cache_control, { type: 'ephemeral' }, 'premise: that call was marked');
  assert.equal(marked.bodies[0].session_id, 'thc-0123456789abcdef01234567', 'a marked routed Claude call carries the same id');
  Held.setHeldForTest(null);
  const own = await call({ ...LUNA, extra: { session_id: 'the-persons-own' } }, 'sid-own');
  assert.equal(own.bodies[0].session_id, 'the-persons-own', 'a seat\'s own session_id wins');
  Providers.setOpenRouterSessionId('not-an-id');
  const bad = await call(LUNA, 'sid-bad');
  assert.equal('session_id' in bad.bodies[0], false, 'a value of another shape is not sent');
});
