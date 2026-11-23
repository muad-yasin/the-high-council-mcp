// test/first-ten-minutes.test.js
//
// A first-time user's path, walked offline on 2026-09-25: npx demo, doctor, init, a dry run,
// a missing or refused key, a local model server that is not running. Each test pins one place
// where that walk hit a dead end. Offline and $0: fetch is stubbed, every chain run is mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { councilCommand, unignoredEnvFile } from '../src/invocation.js';
import { call, setRetrySleep, accountHint } from '../src/providers.js';
import { panelLabCount } from '../src/chain.js';
import { DEFAULT_MAX_USD } from '../src/default-cap.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const root = resolve(here, '..');
const noKeys = { PATH: process.env.PATH };

test('councilCommand: npx users are told to type npx, everyone else council', () => {
  assert.equal(councilCommand({ npm_command: 'exec' }), 'npx the-high-council');
  assert.equal(councilCommand({}), 'council');
  assert.equal(councilCommand({ npm_command: 'test' }), 'council');
});

test('the demo names a next command an npx user can actually run', () => {
  const out = execFileSync('node', [cli, 'demo'], { encoding: 'utf8', env: { ...noKeys, npm_command: 'exec' } });
  assert.match(out, /"npx the-high-council init"/);
  assert.match(out, /"npx the-high-council doctor"/);
  assert.doesNotMatch(out, /"council /);
});

test('doctor: a Start here block, one schemaVersion line instead of one per chain, and no one-key line while every shipped chain answers its criteria stage through the Claude subscription', () => {
  const out = execFileSync('node', [cli, 'doctor'], { encoding: 'utf8', env: noKeys });
  assert.match(out, /Start here:/);
  assert.equal(out.match(/no schemaVersion declared/g)?.length ?? 0, 1);
  // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10 and 01:56: plan-default-opro-council retires and the default chain seats Claude on the Anthropic key). OLD: doctor printed "one key: OPENROUTER_API_KEY plus your agent session (Claude Code, for example) runs plan-default-opro-council (...)" (the quick-start chain, whose criteria seat was a paid OpenRouter seat), and the test required the line. NEW: no shipped chain qualifies (each seats its criteria stage through the Claude subscription, an external seat that is not the session), so doctor prints no one-key line; the test derives that from the chain files instead of typing it. WHY: the line is derived from the seats, and the chain that earned it is gone. The gate itself is pinned by test/one-key-decider.test.js.
  const chainsDir = join(root, 'chains');
  for (const f of readdirSync(chainsDir).filter(n => /^plan-.*council\.json$/.test(n))) {
    const criteria = JSON.parse(readFileSync(join(chainsDir, f), 'utf8')).seats.criteria;
    assert.ok(criteria.provider === 'external' && criteria.model !== 'claude-code-session', `${f}: the criteria seat is a subscription seat, so the chain is not on a one-key line`);
  }
  assert.equal(out.split('\n').some(l => /^\s*one key:/.test(l)), false, 'no one-key line');
  assert.match(out, /local-ollama\s+runnable.*needs Ollama running locally/);
});

// 0.8.3 decider-readiness unit (24 Okt 2026; Muad: "B sounds fine to me"). The pin held in BOTH states (C&C thcmcp-cd): doctor's one-key line carried the caveat exactly while the conflict decider's three prompt functions are recorded in
// src/roles.js, and not before; plan-china-medium-council names the session as its decider, so the line said so when the decider can pause the run.
// CHANGED ACCEPTED TEST (0.8.4 HS, Muad 05 Nov 2026 22:19: every layered chain needs a handling session). OLD: the caveat is on the line iff the decider's prompt is recorded. NEW: the caveat is never on the line, in either state. WHY: the line now says the chain needs the session ("plus your agent session"), and every chain it lists pauses at its session seats, so a swing-pause caveat adds nothing.
test('doctor: no line carries the swing-pause caveat, whether or not the decider\'s prompt is recorded', async () => {
  const out = execFileSync('node', [cli, 'doctor'], { encoding: 'utf8', env: noKeys });
  assert.equal(out.includes('a swing between judge layers pauses the run and leaves a file to answer'), false, 'no caveat');   // CHANGED (0.8.4 seats unit): the line it sat on is gone with the one-key chain; the caveat text is still pinned absent
});

test('unignoredEnvFile: warns only when git would commit .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-env-'));
  const exitWith = status => () => { const e = new Error('git'); e.status = status; throw e; };
  assert.equal(unignoredEnvFile(dir, { exec: exitWith(1) }), false, 'no .env, nothing to warn about');
  writeFileSync(join(dir, '.env'), 'OPENROUTER_API_KEY=x\n');
  assert.equal(unignoredEnvFile(dir, { exec: exitWith(1) }), true, 'in a repo and not ignored');
  assert.equal(unignoredEnvFile(dir, { exec: () => {} }), false, 'ignored');
  assert.equal(unignoredEnvFile(dir, { exec: exitWith(128) }), false, 'not a git repo');
  assert.equal(unignoredEnvFile(dir, { exec: exitWith(undefined) }), false, 'git not installed');
});

test('accountHint: 401, 402 and 403 are said in words, naming the env var; other statuses get nothing', () => {
  assert.match(accountHint(401, 'openrouter/openai/gpt-5.6-luna'), /OPENROUTER_API_KEY/);
  assert.match(accountHint(401, 'anthropic/claude-sonnet-5'), /ANTHROPIC_API_KEY/);
  assert.match(accountHint(402, 'openrouter/x'), /credit/);
  assert.match(accountHint(403, 'openai/gpt-5'), /OPENAI_API_KEY/);
  assert.equal(accountHint(500, 'openrouter/x'), null);
  assert.equal(accountHint(429, 'openrouter/x'), null);
  assert.equal(typeof accountHint(401, 'no-such-provider/x'), 'string', 'an unknown provider still gets a hint, just no variable name');
});

async function withFetch(responder, fn) {
  const original = globalThis.fetch;
  const hadKey = process.env.OPENROUTER_API_KEY;
  globalThis.fetch = async () => responder();
  process.env.OPENROUTER_API_KEY = 'sk-test';
  setRetrySleep(async () => {});
  try { return await fn(); }
  finally {
    globalThis.fetch = original; setRetrySleep(null);
    if (hadKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = hadKey;
  }
}

test('a refused key reaches the user with the hint attached, and is still not retried', async () => {
  let calls = 0;
  await withFetch(() => { calls++; return new Response('{"error":{"message":"User not found.","code":401}}', { status: 401 }); }, async () => {
    await assert.rejects(
      call('openrouter', { model: 'x/y', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10 }),
      err => err.status === 401 && /HTTP 401/.test(err.message) && /OPENROUTER_API_KEY/.test(err.message),
    );
  });
  assert.equal(calls, 1);
});

test('a local model server that is not running is named, with what to start', async () => {
  const refused = () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED', syscall: 'connect' }; throw e; };
  await withFetch(refused, async () => {
    await assert.rejects(
      call('ollama', { model: 'llama3.1', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 10 }),
      err => /nothing is listening at http:\/\/localhost:11434/.test(err.message) && /ollama pull/.test(err.message) && !err.maybeBilled,
    );
  });
});

test('dry run with --task: a task larger than the assumed prompt is priced again with it added', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dry-'));
  writeFileSync(join(dir, 'small.md'), 'Plan a habit tracker.\n');
  writeFileSync(join(dir, 'big.md'), 'word '.repeat(40000));   // CHANGED (0.8.4 seats unit): was 20000; plan-mini-council assumes a 28,000-token prompt, so the big task must exceed that
  const small = execFileSync('node', [cli, '--task', 'small.md', '--chain', 'plan-mini-council', '--dry-run'], { encoding: 'utf8', cwd: dir, env: noKeys });
  assert.match(small, /fits inside the \d+-token prompt/);   // CHANGED (0.8.4 seats unit): was the 4000-token prompt of verify; the number is the chain's own assumed prompt
  const big = execFileSync('node', [cli, '--task', 'big.md', '--chain', 'plan-mini-council', '--dry-run'], { encoding: 'utf8', cwd: dir, env: noKeys });
  const [, base] = big.match(/TOTAL.*\$([\d.]+)\s+per run/);
  const [, again] = big.match(/Priced again with your task added to every prompt: \$([\d.]+)/);
  assert.ok(Number(again) > Number(base), `${again} > ${base}`);
});

// Changed by the owner's decision of 7 Oct 2026 ("build it tonight", item 8c: the dry run shows two figures, expected and maximum): the note and the doctor line say "expected" and "at most" instead of "worst case".
test('a run whose expected cost is above the cap, or whose upper estimate is, says so before spending, and a task large enough to cross the cap still stops at it', () => {   // title moved with the $12 default: mock-budget\'s expected figure is under the cap now, so the note takes its "within the cap, but its upper estimate is" form (src/cli.js 3909); both forms start with the prefix asserted below
  const dir = mkdtempSync(join(tmpdir(), 'thc-cap-'));
  // CHANGED (expected-cost gate, 27 Okt 2026, owner: the gate decides on the expected case, not the worst case). OLD: the one-line task; the build's WORST case crossed the $7 default. NEW: a task of about 40,000
  // characters, so the first call's EXPECTED cost alone (~$10 at the fixture price) crosses it and the run still stops at the cap. WHY: on the one-line task every call now fits.
  // CHANGED ACCEPTED (default cap $12, 10 Nov 2026, Muad). OLD bar: 40,000 characters (about $10, above the $7 default). NEW bar: 5,000 characters per dollar of the default cap (60,000 for $12, about $15 at the fixture price), so the first call's expected cost crosses it again; the exit-4 stop and the note are asserted as before.
  writeFileSync(join(dir, 'task.md'), 'Plan a habit tracker.\n' + 'x'.repeat(DEFAULT_MAX_USD * 5000) + '\n');
  const r = spawnSync('node', [cli, '--task', 'task.md', '--chain', 'mock-budget'], { encoding: 'utf8', cwd: dir, env: noKeys });
  assert.equal(r.status, 4);
  const note = r.stdout.indexOf('note:  this chain\'s expected cost is');
  assert.ok(note > 0 && note < r.stdout.indexOf('Stage:'), 'the note comes before the first stage');
});

test('doctor: the one-key line counts a chain\'s panel labs by labOf, critics only', () => {
  // Every seat by model-id prefix called cheap-7-v2 a 9-lab chain; its panel was seven labs. 0.8.3 (lane B, commit 2): cheap-7-v2 is retired, so the check reads its successor: the writer stages are one model, Luna proposes AND judges, and the panel is the nine judges, nine labs.
  const oneKey = JSON.parse(readFileSync(join(root, 'chains', 'plan-china-medium-council.json'), 'utf8'));
  assert.equal(panelLabCount(oneKey), 8, 'eight judges, one lab each (a lab is a model in these chains)');   // CHANGED (0.8.4 seats unit): was the nine-judge one-key chain, retired
  const seat = (lab, model = 'm') => ({ provider: 'openrouter', model: `vendor/${model}`, ...(lab ? { lab } : {}) });
  assert.equal(panelLabCount({ seats: { builder: seat('x'), critics: [seat('a'), seat('a', 'n'), seat('b')] } }), 2, 'a seat\'s own lab wins; the builder is not on the panel');
  assert.equal(panelLabCount({ seats: { critics: [seat(null), seat(null, 'n')] } }), 1, 'no lab: the provider is the lab');
  assert.equal(panelLabCount({ seats: {} }), 0);
  // CHANGED (0.8.4 seats unit): the doctor line that printed the count is gone with the one-key chain (see the doctor test above); the count itself is still pinned on a shipped chain and on the synthetic cases.
});
