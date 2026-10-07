// A seat with no price row cannot be held by a spend cap (it projects at $0), so under a cap it is refused before anything is sent (0.8.2 item 8a; ChatGPT review 1 #4a; owner, 7 Oct 2026: "build it tonight";
// C&C: exempt mock, external and ollama only; the text names the seat and both ways out; exit 5; the dry run shows the same refusal). Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unpricedSeats } from '../src/unpriced.js';
import { needsPrice } from '../src/cost.js';
import { runSingleStage, setBudget, UnpricedSeat } from '../src/chain.js';
import { dryRunReport } from '../src/dry-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const UNPRICED = { provider: 'openrouter', model: 'vendor/not-in-the-price-table', maxTokens: 500 };
const PRICED = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500 };

test('needsPrice: an unpriced paid seat needs a row; mock, external and ollama never do; a priced seat does not', () => {
  assert.equal(needsPrice(UNPRICED), true);
  assert.equal(needsPrice({ provider: 'anthropic', model: 'no-such-model' }), true);
  for (const seat of [{ provider: 'mock', model: 'mock-whatever' }, { provider: 'external' }, { provider: 'ollama', model: 'any-local-model:7b' }, PRICED, null, undefined]) assert.equal(needsPrice(seat), false, JSON.stringify(seat));
});

test('unpricedSeats lists each unpriced provider/model once with the roles it fills, in every seat slot the run uses', () => {
  const config = { name: 't', maxRounds: 1, criteria: ['x'], seats: { builder: UNPRICED, reviser: UNPRICED, finalist: { provider: 'mock', model: 'mock-x' }, critics: [PRICED, { ...UNPRICED, model: 'vendor/second' }, { provider: 'ollama', model: 'm' }] }, preflight: { seats: [{ provider: 'openai', model: 'gpt-not-priced' }] } };
  const found = unpricedSeats(config);
  assert.deepEqual(found.map(f => `${f.provider}/${f.model}`).sort(), ['openai/gpt-not-priced', 'openrouter/vendor/not-in-the-price-table', 'openrouter/vendor/second']);
  assert.match(found.find(f => f.model === 'vendor/not-in-the-price-table').roles, /builder.*reviser|reviser.*builder/);
  assert.deepEqual(unpricedSeats({ name: 't', seats: { builder: { provider: 'mock', model: 'm' }, critics: [PRICED] } }), []);
  for (const f of ['cheap-7-v2', 'plan-premium-7', 'plan-highest-7', 'plan-daily-7', 'plan-lanes-4', 'local-ollama', 'mock']) {
    const c = JSON.parse(JSON.stringify(JSON.parse(require_json(f))));
    assert.deepEqual(unpricedSeats(c), [], `${f}: every shipped seat has a price row (or is exempt)`);
  }
});
import { readFileSync } from 'node:fs';
function require_json(name) { return readFileSync(join(root, 'chains', `${name}.json`), 'utf8'); }

test('the CLI refuses a chain with an unpriced seat under the default cap: exit 5, the seat and BOTH ways out are named, nothing is sent, no run folder is made', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-unpriced-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing.\n');
  const seat = { ...UNPRICED, maxTokens: 1000 };
  writeFileSync(join(dir, 'chains', 'up.json'), JSON.stringify({ name: 'up', description: 'x', maxRounds: 1, signoff: 'first', seats: { criteria: seat, builder: seat, critics: [seat] } }));
  const env = { PATH: process.env.PATH, HOME: dir, OPENROUTER_API_KEY: 'sk-or-v1-' + 'a'.repeat(40) };
  const r = spawnSync(process.execPath, [cli, '--chain', 'up', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stderr, /openrouter\/vendor\/not-in-the-price-table/);
  assert.match(r.stderr, /spend cap of \$7\.00 cannot hold it/);
  assert.match(r.stderr, /Nothing was sent and nothing was spent/);
  assert.match(r.stderr, /src\/pricing\.json/); assert.match(r.stderr, /--max-usd none/);
  assert.equal(existsSync(join(dir, 'runs')) && readdirSync(join(dir, 'runs')).length > 0, false, 'refused before a run folder exists');
  // a cap given on the command line is the cap named
  const r2 = spawnSync(process.execPath, [cli, '--chain', 'up', '--task', 'tasks/t.md', '--max-usd', '2'], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(r2.status, 5); assert.match(r2.stderr, /spend cap of \$2\.00 cannot hold it/);
});

test('the dry run shows the same refusal at $0: the text names the cap, and the JSON says cap.unpricedSeatsRefused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-unpriced-'));
  mkdirSync(join(dir, 'chains'));
  const seat = { ...UNPRICED, maxTokens: 1000 };
  const cfg = { name: 'up', description: 'x', maxRounds: 1, signoff: 'first', seats: { criteria: seat, builder: seat, critics: [seat] } };
  writeFileSync(join(dir, 'chains', 'up.json'), JSON.stringify(cfg));
  const env = { PATH: process.env.PATH, HOME: dir };
  const out = spawnSync(process.execPath, [cli, '--chain', 'up', '--dry-run'], { cwd: dir, encoding: 'utf8', env }).stdout;
  assert.match(out, /spend cap of \$7\.00 cannot hold it/);
  assert.equal(dryRunReport(cfg, { defaultCapUsd: 7 }).cap.unpricedSeatsRefused, true);
  assert.equal(dryRunReport(cfg, { defaultCapUsd: null }).cap.unpricedSeatsRefused, false, 'no cap, nothing to refuse');
  assert.equal(dryRunReport(JSON.parse(require_json('cheap-7-v2')), { defaultCapUsd: 7 }).cap.unpricedSeatsRefused, false);
});

test('invoke() is the backstop: under a cap an unpriced seat is refused before the call is sent; with no cap, or a priced seat, the call goes out', async () => {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    req.resume(); req.on('end', () => { hits++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  const env0 = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-v1-' + 'b'.repeat(40);
  try {
    setBudget(5);
    await assert.rejects(() => runSingleStage({ ...UNPRICED, baseUrl }, { system: 's', user: 'u', label: 'backstop' }), err => err instanceof UnpricedSeat && err.controlFlow === true && /no price/.test(err.message));
    assert.equal(hits, 0, 'nothing was sent');
    const ok = await runSingleStage({ ...PRICED, baseUrl }, { system: 's', user: 'u', label: 'priced' });
    assert.equal(hits, 1, 'a priced seat is called under the same cap'); assert.ok(ok.text);
    setBudget(null);
    await runSingleStage({ ...UNPRICED, baseUrl }, { system: 's', user: 'u', label: 'nocap' });
    assert.equal(hits, 2, 'with no cap the unpriced seat is called (--max-usd none is the way out)');
  } finally { setBudget(null); if (env0 === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env0; srv.close(); }
});

test('review fixes (item 8): the dry-run flag looks at every seat slot (an unpriced seat of a stage that is switched off is refused too), and --rematch / --replay refuse under a cap with exit 5 before paying', () => {
  const cfg = { name: 'off', description: 'x', maxRounds: 1, signoff: 'first', seats: { criteria: { provider: 'mock', model: 'mock' }, builder: { provider: 'mock', model: 'mock' }, critics: [{ provider: 'mock', model: 'mock' }], coldRead: { ...UNPRICED } } };
  assert.equal(dryRunReport(cfg, { defaultCapUsd: 7 }).cap.unpricedSeatsRefused, true, 'coldRead is not enabled, so no planned row names it, and the run is still refused');
  const dir = mkdtempSync(join(tmpdir(), 'thc-unpriced-side-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'side.json'), JSON.stringify({ ...base, name: 'side' }));
  const env = { PATH: process.env.PATH, HOME: dir };
  assert.equal(spawnSync(process.execPath, [cli, '--chain', 'side', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 }).status, 0);
  const id = readdirSync(join(dir, 'runs'))[0];
  // the chain the run recorded now seats an unpriced paid model
  const bad = { ...base, name: 'side', seats: { ...base.seats, critics: [...base.seats.critics.slice(0, -1), { ...UNPRICED, lab: 'zz' }] } };
  writeFileSync(join(dir, 'chains', 'side.json'), JSON.stringify(bad));
  for (const flags of [['--rematch', `runs/${id}`], ['--replay', `runs/${id}`, '--replay-date', '2026-10-07']]) {
    const r = spawnSync(process.execPath, [cli, ...flags], { cwd: dir, encoding: 'utf8', env: { ...env, OPENROUTER_API_KEY: 'sk-or-v1-' + 'f'.repeat(40) }, timeout: 120_000 });
    assert.equal(r.status, 5, `${flags[0]}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /spend cap of \$7\.00 cannot hold it/, flags[0]);
  }
});
