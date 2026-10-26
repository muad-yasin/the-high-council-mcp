// The paid-start predicate and the scope the typed limit is bound to (0.8.3 M6 typed cap T4a; T4 start-path page sections 1 and 4; 14 Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainIsPaid, buildStartScope as scopeOf } from '../src/start-scope.js';
import { capScopeSha256 } from '../src/gate.js';
const buildStartScope = parts => { const scope = scopeOf(parts); return { scope, sha256: capScopeSha256(scope) }; };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = s => createHash('sha256').update(s).digest('hex');
const chain = name => JSON.parse(readFileSync(join(ROOT, 'chains', `${name}.json`), 'utf8'));
const seatsOf = (...kinds) => ({ seats: { builder: { provider: kinds[0], model: 'm' }, critics: kinds.slice(1).map(provider => ({ provider, model: 'm' })) } });
const parts = (over = {}) => ({
  taskSha256: sha('task'), contextSha256: sha('context'), chainSha256: sha('chain'), seats: [{ role: 'builder', provider: 'openrouter', model: 'a/b' }, { role: 'critics[0]', provider: 'anthropic', model: 'c' }],
  policySha256: sha('policy'), sensitivityFloor: 'internal', piiMode: 'warn', userPrices: [{ key: 'openrouter/a/b', file_in: 1, file_out: 4, effective_in: 1, effective_out: 4 }], ...over,
});

test('chainIsPaid: a free-only chain is not a paid start, a chain with one billing seat is; a shipped mock chain, an ollama chain, a real chain', () => {
  assert.equal(chainIsPaid(chain('mock')), false, 'mock');
  assert.equal(chainIsPaid(chain('local-ollama')), false, 'ollama is free');
  assert.equal(chainIsPaid(chain('verify')), true, 'verify names real providers');
  assert.equal(chainIsPaid(seatsOf('mock', 'external', 'ollama')), false, 'mock + external + ollama');
  assert.equal(chainIsPaid(seatsOf('mock', 'mock', 'openrouter')), true, 'ONE billing seat among free ones makes it paid');
  assert.equal(chainIsPaid(seatsOf('external', 'anthropic')), true);
});

test('buildStartScope: key order and seat-input shape do not matter; every field changed alone changes the digest; ceilings are not in it', () => {
  const base = buildStartScope(parts());
  assert.match(base.sha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(base.scope, 'ceilings'), false, 'ceilings are NOT part of the scope: they are bound in the gate and re-checked at consume');
  const changes = {
    task: { taskSha256: sha('task2') }, context: { contextSha256: sha('context2') }, context_gone: { contextSha256: null }, chain: { chainSha256: sha('chain2') }, policy: { policySha256: null }, floor: { sensitivityFloor: 'public' }, pii: { piiMode: 'block' },
    seat_model: { seats: [{ role: 'builder', provider: 'openrouter', model: 'a/other' }, { role: 'critics[0]', provider: 'anthropic', model: 'c' }] },
    price_in: { userPrices: [{ key: 'openrouter/a/b', file_in: 1.5, file_out: 4, effective_in: 1, effective_out: 4 }] }, price_out_effective: { userPrices: [{ key: 'openrouter/a/b', file_in: 1, file_out: 4, effective_in: 1, effective_out: 5 }] }, price_key: { userPrices: [{ key: 'openrouter/a/c', file_in: 1, file_out: 4, effective_in: 1, effective_out: 4 }] }, price_row_added: { userPrices: [] }, price_extra_row: { userPrices: [{ key: 'openrouter/a/b', file_in: 1, file_out: 4, effective_in: 1, effective_out: 4 }, { key: 'openrouter/a/z', file_in: 2, file_out: 3, effective_in: 2, effective_out: 3 }] },
    seat_order: { seats: [{ role: 'critics[0]', provider: 'anthropic', model: 'c' }, { role: 'builder', provider: 'openrouter', model: 'a/b' }] },
  };
  for (const [name, over] of Object.entries(changes)) assert.notEqual(buildStartScope(parts(over)).sha256, base.sha256, `${name} changes the digest`);
});

test('buildStartScope: with NO user-priced seat the scope has no user_prices key at all (unused means unchanged: a run made before the price row existed hashes as it did)', () => {
  const none = buildStartScope(parts({ userPrices: [] }));
  assert.equal(Object.hasOwn(none.scope, 'user_prices'), false);
  assert.deepEqual(Object.keys(none.scope).sort(), ['chain_sha256', 'context_sha256', 'pii_mode', 'policy_sha256', 'seats', 'sensitivity_floor', 'task_sha256']);
});

test('buildStartScope: the user price rows are sorted by key (the order the file or the seats came in does not change the digest)', () => {
  const a = { key: 'openrouter/a/b', file_in: 1, file_out: 4, effective_in: 1, effective_out: 4 }; const z = { key: 'openrouter/a/z', file_in: 2, file_out: 3, effective_in: 2, effective_out: 3 };
  assert.equal(buildStartScope(parts({ userPrices: [a, z] })).sha256, buildStartScope(parts({ userPrices: [z, a] })).sha256);
});

test('buildStartScope: a missing or malformed field throws (a digest that covers less than the screen showed is not given)', () => {
  const bad = {
    'no task digest': { taskSha256: undefined }, 'context undefined': { contextSha256: undefined }, 'short chain digest': { chainSha256: 'abc' }, 'seats not a list': { seats: 'x' }, 'seat without model': { seats: [{ role: 'r', provider: 'p' }] }, 'policy undefined': { policySha256: undefined },
    'floor a number': { sensitivityFloor: 5 }, 'userPrices missing': { userPrices: undefined }, 'userPrices zero figure': { userPrices: [{ key: 'openrouter/a/b', file_in: 0, file_out: 4, effective_in: 1, effective_out: 4 }] }, 'userPrices key without a slash': { userPrices: [{ key: 'ab', file_in: 1, file_out: 4, effective_in: 1, effective_out: 4 }] }, 'pii undefined': { piiMode: undefined }, 
  };
  for (const [name, over] of Object.entries(bad)) assert.throws(() => buildStartScope(parts(over)), /start scope:/, name);
});

test('buildStartScope: the same inputs give the same digest in a LATER PROCESS (the screen is shown in one process and consumed in another)', () => {
  const here = buildStartScope(parts()).sha256;
  const code = `import { buildStartScope } from ${JSON.stringify(join(ROOT, 'src/start-scope.js'))}; import { capScopeSha256 } from ${JSON.stringify(join(ROOT, 'src/gate.js'))}; console.log(capScopeSha256(buildStartScope(${JSON.stringify(parts())})));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), here);
});

import { changedParts } from '../src/start-scope.js';
test('changedParts names the inputs that differ between two scope objects, in a fixed order; an absent part equals null/empty (a missing user_prices key is the same as no user-priced seat)', () => {
  const a = buildStartScope(parts()).scope;
  assert.deepEqual(changedParts(a, a), []);
  assert.deepEqual(changedParts(a, buildStartScope(parts({ taskSha256: sha('t2'), chainSha256: sha('c2') })).scope), ['the task', 'the chain file']);
  assert.deepEqual(changedParts(a, buildStartScope(parts({ contextSha256: null, policySha256: null, piiMode: 'block' })).scope), ['the context documents', 'the policy file', 'the personal-data check']);
  assert.deepEqual(changedParts(a, buildStartScope(parts({ seats: [{ role: 'builder', provider: 'openrouter', model: 'a/other' }] })).scope), ['the seats']);
  assert.deepEqual(changedParts(a, buildStartScope(parts({ userPrices: [] })).scope), ["a price row of the project's pricing.user.json"]);
  assert.deepEqual(changedParts({ ...a, user_prices: undefined }, buildStartScope(parts({ userPrices: [] })).scope), [], 'absent equals none');
});

test('buildStartScope (T5b): the optional deliverable hash is OMITTED when absent (the scope, hence the digest, is exactly what it was before), changes the digest when present, is validated, and changedParts names it "the draft it works from"', () => {
  const without = buildStartScope(parts());
  assert.equal(Object.hasOwn(without.scope, 'deliverable_sha256'), false);
  const { deliverable_sha256: _unused, ...rest } = without.scope;
  assert.equal(without.sha256, capScopeSha256(rest), 'the digest of a scope without the field is the digest of the same object built by hand');
  const withIt = buildStartScope(parts({ deliverableSha256: sha('draft') }));
  assert.equal(withIt.scope.deliverable_sha256, sha('draft')); assert.notEqual(withIt.sha256, without.sha256);
  assert.notEqual(buildStartScope(parts({ deliverableSha256: sha('draft2') })).sha256, withIt.sha256, 'a changed draft is a changed scope');
  assert.throws(() => scopeOf(parts({ deliverableSha256: 'not-a-digest' })), /deliverableSha256 must be a sha256 hex digest or null/);
  assert.deepEqual(changedParts(withIt.scope, buildStartScope(parts({ deliverableSha256: sha('draft2') })).scope), ['the draft it works from']);
  assert.deepEqual(changedParts(without.scope, withIt.scope), ['the draft it works from'], 'a scope that lacks the part reads as absent');
});
