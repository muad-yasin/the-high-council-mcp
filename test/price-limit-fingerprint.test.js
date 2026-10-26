// 0.8.3 (Muad 23 Okt 2026, "2: ii"): a seat's own price limit (extra.provider.max_price prompt/completion) is not part of the stage-cache fingerprint, so raising it keeps the finished stages (a pricing.user.json
// raise always did). Everything else in the chain stays in it. Rows: FL-1 only the two limit fields leave it (single seat, nested seats, add/remove/lower); FL-2 each other field still changes it;
// FL-3 an already-empty container is not pruned; FL-4 `summary` is still excluded; FL-5 a config with no limit hashes exactly as at 8c71d2b; FL-6 the snapshot helpers (priceLimitsOf, withPriceLimits, limitFreeSha256Of); FL-7 the real verb: a resume after a limit raise keeps the finished stages and the answered external stage, a model edit does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintInputs } from '../src/cache-integrity.js';
import { priceLimitsOf, withoutPriceLimits, withPriceLimits, limitFreeSha256Of } from '../src/price-limits.js';

const seat = (mp, more = {}) => ({ provider: 'openrouter', model: 'a/b', maxTokens: 100, extra: { reasoning: { effort: 'high' }, provider: { only: ['p'], ...(mp === undefined ? {} : { max_price: mp }) } }, ...more });
const chain = (mp, more = {}) => ({ name: 'x', maxRounds: 2, seats: { critics: [seat(mp, more), { provider: 'mock', model: 'm' }], builder: { provider: 'external', model: 'e' } } });
const fp = c => fingerprintInputs('the task', c);

test('FL-1 only the two limit fields leave the fingerprint: raise, lower, add, remove, in a single seat and inside the critics list', () => {
  const base = fp(chain({ prompt: 1, completion: 2 }));
  assert.equal(fp(chain({ prompt: 9, completion: 20 })), base, 'raised');       // red at 8c71d2b: the fingerprints differ
  assert.equal(fp(chain({ prompt: 0.5, completion: 1 })), base, 'lowered');
  assert.equal(fp(chain({ prompt: 1 })), base, 'one field only');
  assert.equal(fp(chain(undefined)), base, 'removed');
  assert.equal(fp({ ...chain(undefined), seats: { ...chain(undefined).seats, builder: seat({ prompt: 3, completion: 4 }) } }), fp({ ...chain(undefined), seats: { ...chain(undefined).seats, builder: seat(undefined) } }), 'a single seat slot');
  const bare = { name: 'y', seats: { critics: [{ provider: 'mock', model: 'm' }] } };
  const pinned = { name: 'y', seats: { critics: [{ provider: 'mock', model: 'm', extra: { provider: { max_price: { prompt: 1, completion: 2 } } } }] } };
  assert.equal(fp(pinned), fp(bare), 'a seat whose only extra was the limit: adding one is the same as none');
});

test('FL-2 everything else still changes it: model, caps, lab, reasoning, other provider keys, other max_price keys, the roster', () => {
  const base = fp(chain({ prompt: 1, completion: 2 }));
  const differs = (c, why) => assert.notEqual(fp(c), base, why);
  differs(chain({ prompt: 1, completion: 2 }, { model: 'a/c' }), 'model');
  differs(chain({ prompt: 1, completion: 2 }, { maxTokens: 101 }), 'maxTokens');
  differs(chain({ prompt: 1, completion: 2 }, { lab: 'z' }), 'lab');
  { const c = chain({ prompt: 1, completion: 2 }); c.seats.critics[0].extra.reasoning.effort = 'low'; differs(c, 'reasoning'); }
  { const c = chain({ prompt: 1, completion: 2 }); c.seats.critics[0].extra.provider.only = ['q']; differs(c, 'provider.only'); }
  { const c = chain({ prompt: 1, completion: 2 }); c.seats.critics[0].extra.provider.zdr = true; differs(c, 'provider.zdr'); }
  differs(chain({ prompt: 1, completion: 2, request: 0.1 }), 'max_price.request is not a limit THC treats as its pin');
  { const c = chain({ prompt: 1, completion: 2 }); c.seats.critics.push({ provider: 'mock', model: 'n' }); differs(c, 'roster'); }
  { const c = chain({ prompt: 1, completion: 2 }); c.maxRounds = 3; differs(c, 'rounds'); }
});

test('FL-3 a container that was already empty is not pruned (only what the removal emptied goes)', () => {
  const a = { name: 'z', seats: { critics: [{ provider: 'mock', model: 'm', extra: { provider: {} } }] } };
  assert.equal(withoutPriceLimits(a), a, 'no limit: the very same object');
  const b = { name: 'z', seats: { critics: [{ provider: 'mock', model: 'm', extra: { provider: {}, other: 1 } }] } };
  assert.notEqual(fp(a), fp(b));
  assert.deepEqual(withoutPriceLimits({ x: { extra: { provider: { max_price: { prompt: 1 } } } } }), { x: {} }, 'a seat with nothing else in extra loses extra');
  assert.deepEqual(withoutPriceLimits({ x: { extra: { provider: { max_price: { prompt: 1, request: 2 } }, k: 1 } } }), { x: { extra: { provider: { max_price: { request: 2 } }, k: 1 } } });
});

test('FL-4 summary is still excluded', () => {
  assert.equal(fp({ ...chain({ prompt: 1, completion: 2 }), summary: 'a' }), fp({ ...chain({ prompt: 5, completion: 6 }), summary: 'b' }));
});

test('FL-5 a config with no limit hashes EXACTLY as at 8c71d2b, so no existing paused run is paid for again (the value was computed with the 8c71d2b function)', () => {
  const cfg = { name: 'x', summary: 'card', maxRounds: 2, seats: { critics: [{ provider: 'openrouter', model: 'a/b', maxTokens: 100, extra: { provider: { only: ['p'] } } }, { provider: 'mock', model: 'm' }], builder: { provider: 'external', model: 'e' } } };
  assert.equal(fingerprintInputs('the task', cfg), 'e27eb0916f48');
});

test('FL-6 the helpers: priceLimitsOf lists every limit with its path as typed, withPriceLimits puts them back, limitFreeSha256Of is blind to the two numbers and to formatting only', () => {
  const c = chain({ prompt: 1, completion: 2 });
  assert.deepEqual(priceLimitsOf(c), [{ path: ['seats', 'critics', 0], limits: { prompt: 1, completion: 2 } }]);
  assert.deepEqual(priceLimitsOf(chain({ prompt: 'x' })), [{ path: ['seats', 'critics', 0], limits: { prompt: 'x' } }], 'kept as typed');
  assert.deepEqual(priceLimitsOf(chain(undefined)), []);
  const raised = chain({ prompt: 9, completion: 20 });
  assert.deepEqual(withPriceLimits(raised, priceLimitsOf(c)), c, 'the old limits back in');
  assert.deepEqual(withPriceLimits(chain(undefined), priceLimitsOf(c)), c, 'a removed limit put back');
  assert.deepEqual(raised, chain({ prompt: 9, completion: 20 }), 'the input is not written');
  const text = o => JSON.stringify(o, null, 2);
  assert.equal(limitFreeSha256Of(text(c)), limitFreeSha256Of(JSON.stringify(raised)));
  assert.notEqual(limitFreeSha256Of(text(c)), limitFreeSha256Of(text(chain({ prompt: 1, completion: 2 }, { model: 'a/c' }))));
});

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const ID = '2026-10-23T18-20-00-000Z';
test('FL-7 REAL VERB, mock chain, $0 (chains/mock-external.json with a limit on every proposer): after a limit raise the resume replays the finished stages for free and uses the answered external stage; after a model edit the same stages go stale into superseded/', { timeout: 300_000 }, () => {
  const work = mkdtempSync(join(tmpdir(), 'fl7-'));
  mkdirSync(join(work, 'chains')); mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 't.md'), '# Task\nPlan a tiny thing.\n');
  const chain = JSON.parse(readFileSync(join(dirname(CLI), '..', 'chains', 'mock-external.json'), 'utf8'));
  chain.name = 'fl7-pin';
  for (const p of chain.seats.proposers) p.extra = { provider: { max_price: { prompt: 1, completion: 2 } } };
  const write = c => writeFileSync(join(work, 'chains', 'fl7-pin.json'), JSON.stringify(c, null, 2));
  const cli = args => spawnSync(process.execPath, [CLI, ...args], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work }, timeout: 120_000 });
  write(chain);
  const first = cli(['--task', 'tasks/t.md', '--chain', 'fl7-pin', '--run-id', ID]); assert.equal(first.status, 3, first.stdout + first.stderr);       // paused at the external builder
  const run = join(work, 'runs', ID);
  writeFileSync(join(run, 'build.md'), 'BUILT DRAFT\n\nA plan.\n');
  for (const p of chain.seats.proposers) p.extra.provider.max_price = { prompt: 5, completion: 9 };
  write(chain);
  const raised = cli(['--resume', `runs/${ID}`]);
  assert.doesNotMatch(raised.stdout + raised.stderr, /CACHE STALENESS WARNING/, 'a limit raise leaves every finished stage fresh');       // red at 8c71d2b: eight warnings
  assert.equal(readdirSync(run).filter(f => f === 'superseded').length, 0, 'nothing was set aside');
  assert.ok(existsSync(join(run, 'build.md')), 'the answered external stage is used, not asked again');
  chain.seats.proposers[0].model = 'mock-proposer-a2'; write(chain);
  const edited = cli(['--resume', `runs/${ID}`]);
  assert.match(edited.stdout + edited.stderr, /CACHE STALENESS WARNING: stage "criteria"/, 'a model edit still makes the stages stale');
  assert.ok(existsSync(join(run, 'superseded')), 'and sets them aside');
});
