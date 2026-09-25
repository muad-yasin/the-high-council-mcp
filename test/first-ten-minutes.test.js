// test/first-ten-minutes.test.js
//
// A first-time user's path, walked offline on 2026-09-25: npx demo, doctor, init, a dry run,
// a missing or refused key, a local model server that is not running. Each test pins one place
// where that walk hit a dead end. Offline and $0: fetch is stubbed, every chain run is mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { councilCommand, unignoredEnvFile } from '../src/invocation.js';
import { call, setRetrySleep, accountHint } from '../src/providers.js';
import { panelLabCount } from '../src/chain.js';

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

test('doctor: a Start here block, one schemaVersion line instead of one per chain, and the one-key chains', () => {
  const out = execFileSync('node', [cli, 'doctor'], { encoding: 'utf8', env: noKeys });
  assert.match(out, /Start here:/);
  assert.equal(out.match(/no schemaVersion declared/g)?.length ?? 0, 1);
  // Derived from chains/, not typed in: every chain named on a one-key line needs only that key.
  const line = out.split('\n').find(l => l.includes('OPENROUTER_API_KEY alone runs'));
  assert.ok(line, 'at least one shipped chain runs on an OpenRouter key alone');
  assert.doesNotMatch(line, /plan-open-7/, 'a chain with external seats waits for a person, so it is not a one-key chain');
  assert.match(out, /local-ollama\s+runnable.*needs Ollama running locally/);
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
  const refused = () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
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
  writeFileSync(join(dir, 'big.md'), 'word '.repeat(20000));
  const small = execFileSync('node', [cli, '--task', 'small.md', '--chain', 'verify', '--dry-run'], { encoding: 'utf8', cwd: dir, env: noKeys });
  assert.match(small, /fits inside the 4000-token prompt/);
  const big = execFileSync('node', [cli, '--task', 'big.md', '--chain', 'verify', '--dry-run'], { encoding: 'utf8', cwd: dir, env: noKeys });
  const [, base] = big.match(/TOTAL.*\$([\d.]+)\s+per run/);
  const [, again] = big.match(/Priced again with your task added to every prompt: \$([\d.]+)/);
  assert.ok(Number(again) > Number(base), `${again} > ${base}`);
});

test('a run whose worst case is above the cap says so before spending, and still stops at the cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cap-'));
  writeFileSync(join(dir, 'task.md'), 'Plan a habit tracker.\n');
  const r = spawnSync('node', [cli, '--task', 'task.md', '--chain', 'mock-budget'], { encoding: 'utf8', cwd: dir, env: noKeys });
  assert.equal(r.status, 4);
  const note = r.stdout.indexOf('note:  this chain\'s worst case is');
  assert.ok(note > 0 && note < r.stdout.indexOf('Stage:'), 'the note comes before the first stage');
});

test('doctor: the one-key line counts a chain\'s panel labs by labOf, critics only', () => {
  // Every seat by model-id prefix called cheap-7-v2 a 9-lab chain; its panel is seven labs.
  const cheap7 = JSON.parse(readFileSync(join(root, 'chains', 'cheap-7-v2.json'), 'utf8'));
  assert.equal(panelLabCount(cheap7), 7);
  const seat = (lab, model = 'm') => ({ provider: 'openrouter', model: `vendor/${model}`, ...(lab ? { lab } : {}) });
  assert.equal(panelLabCount({ seats: { builder: seat('x'), critics: [seat('a'), seat('a', 'n'), seat('b')] } }), 2, 'a seat\'s own lab wins; the builder is not on the panel');
  assert.equal(panelLabCount({ seats: { critics: [seat(null), seat(null, 'n')] } }), 1, 'no lab: the provider is the lab');
  assert.equal(panelLabCount({ seats: {} }), 0);
  const out = execFileSync('node', [cli, 'doctor'], { encoding: 'utf8', env: noKeys });
  const line = out.split('\n').find(l => l.includes('OPENROUTER_API_KEY alone runs'));
  if (line.includes('cheap-7-v2')) assert.match(line, /cheap-7-v2 \(worst case [^,]+, 7-lab panel\)/);
  assert.doesNotMatch(line, /\d+ labs?\)/, 'the old every-seat count is gone');
});
