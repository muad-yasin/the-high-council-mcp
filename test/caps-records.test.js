// The per-cap spend caps' record shapes that land with the contract (0.8.4 DUALCAP unit 1): the start scope's `caps` part and the switch-OFF identity,
// the reservation line's `capName` (and its closed schema), BudgetExceeded's `capName`. This file imports no new module, so on the code before the change
// each test fails on an assertion, not on a missing file. The literal digests below were computed on b8eb7839 (084/b3-prep; identical on b051a41f), before any
// of this existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStartScope, changedParts } from '../src/start-scope.js';
import { capScopeSha256 } from '../src/gate.js';
import { openReservations, unsettledReservations, RESERVATIONS_FILE } from '../src/spend-reservations.js';
import { BudgetExceeded } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hex = c => c.repeat(64);
const P1 = { taskSha256: hex('1'), contextSha256: null, chainSha256: hex('2'), seats: [{ role: 'critics[0]', provider: 'openrouter', model: 'z-ai/glm-5.3-flash' }, { role: 'critics[1]', provider: 'anthropic', model: 'claude-haiku-5-5' }, { role: 'builder', provider: 'external', model: null }], policySha256: null, sensitivityFloor: null, piiMode: 'warn', userPrices: [] };
const P2 = { taskSha256: hex('3'), contextSha256: hex('4'), chainSha256: hex('5'), seats: [{ role: 'critics[0]', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' }, { role: 'reviser', provider: 'anthropic', model: 'claude-sonnet-5-5' }], policySha256: hex('6'), sensitivityFloor: 'internal', piiMode: 'stop', userPrices: [{ key: 'openrouter/deepseek/deepseek-v4.1-flash', file_in: 0.3, file_out: 1.2, effective_in: 0.3, effective_out: 1.2 }] };
const P3 = { taskSha256: hex('7'), contextSha256: null, chainSha256: hex('8'), seats: [{ role: 'builder', provider: 'mock', model: 'mock-priced' }, { role: 'critics[0]', provider: 'mock', model: 'mock-priced' }], policySha256: null, sensitivityFloor: null, piiMode: null, userPrices: [], deliverableSha256: hex('9') };
const AT_BASE = {
  P1: '9db56e7f223ca67e523a6c5fd54a26d2ec24954c180a0bb1101511a4e7d5763a',
  P2: '13d1655c7368a2ed6dcd5ef9874339f30653a82b789a2dc0f0bd872e0fcbd022',
  P3: '2bcdd00885f558f8099e5dd64440e6e0ed8aed891733c385d10c56e558b0a1ea',
};

test('R1 SWITCH OFF: the start scope hashes byte-identical to the base b8eb7839 (literal digests computed on that commit) whether the caps part is left out or empty, and carries no caps key at all', () => {
  for (const [name, parts] of Object.entries({ P1, P2, P3 })) {
    assert.equal(capScopeSha256(buildStartScope(parts)), AT_BASE[name], `${name}, no caps part`);
    assert.equal(capScopeSha256(buildStartScope({ ...parts, caps: [] })), AT_BASE[name], `${name}, caps: []`);
    assert.equal(Object.hasOwn(buildStartScope({ ...parts, caps: [] }), 'caps'), false, `${name}: no caps key`);
  }
});

test('R2 SWITCH ON: the caps in force enter the scope, sorted, so a run whose caps change shows a new screen; a malformed list is refused; changedParts names the change', () => {
  const on = buildStartScope({ ...P1, caps: ['openrouter', 'anthropic'] });
  assert.deepEqual(on.caps, ['anthropic', 'openrouter']);
  assert.notEqual(capScopeSha256(on), AT_BASE.P1);
  assert.notEqual(capScopeSha256(on), capScopeSha256(buildStartScope({ ...P1, caps: ['openrouter'] })));
  assert.equal(capScopeSha256(on), capScopeSha256(buildStartScope({ ...P1, caps: ['anthropic', 'openrouter'] })), 'order does not matter');
  for (const bad of [['xai'], ['ollama'], ['mock'], ['openrouter', 'openrouter'], 'openrouter', [5], [''], ['OpenRouter'], null]) {
    assert.throws(() => buildStartScope({ ...P1, caps: bad }), /start scope: caps/, JSON.stringify(bad));
  }
  assert.deepEqual(changedParts(buildStartScope(P1), on), ['the spending caps in force']);
  assert.deepEqual(changedParts(buildStartScope(P1), buildStartScope({ ...P1, caps: [] })), []);
});

const tmp = () => mkdtempSync(join(tmpdir(), 'caps-records-'));
const lines = d => readFileSync(join(d, RESERVATIONS_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('R3: a reservation line carries capName only when the call counts against a per-cap cap; an OFF line keeps exactly today\'s keys; unsettled reservations pass it through; a capName that is not a billing provider is refused, nothing is written and the call is not sent', () => {
  const d = tmp();
  const sink = openReservations(d, { now: () => Date.parse('2026-11-01T03:00:00Z') });
  const off = sink.reserve({ label: 'panel-1-a', seat: 'openrouter/a/b', usd: 0.5 });
  const on = sink.reserve({ label: 'panel-1-b', seat: 'mock/mock-priced', usd: 0.7, capName: 'anthropic' });
  const [l1, l2] = lines(d);
  assert.deepEqual(Object.keys(l1), ['schema', 'event', 'id', 'label', 'seat', 'usd', 'at'], 'OFF: today\'s line');
  assert.deepEqual(Object.keys(l2), ['schema', 'event', 'id', 'label', 'seat', 'usd', 'capName', 'at']);
  assert.equal(l2.capName, 'anthropic');
  assert.deepEqual(unsettledReservations(d), [
    { id: off, label: 'panel-1-a', seat: 'openrouter/a/b', usd: 0.5 },
    { id: on, label: 'panel-1-b', seat: 'mock/mock-priced', usd: 0.7, capName: 'anthropic' },
  ]);
  sink.settle(on, { outcome: 'recorded', usd: 0.1 });
  assert.deepEqual(Object.keys(lines(d)[2]), ['schema', 'event', 'id', 'outcome', 'usd', 'at'], 'the settled line is unchanged');
  for (const bad of ['xai', 'ollama', 'mock', '', 5, null, 'OpenRouter']) {
    assert.throws(() => sink.reserve({ label: 'x', seat: 'p/m', usd: 1, capName: bad }), /capName/, JSON.stringify(bad));
  }
  assert.equal(lines(d).length, 3, 'a refused reservation writes nothing');
});

test('R4: schemas/spend-reservations-v1.json stays closed: a reserved line with a capName validates, as does an OFF line; capName on a settled line, a capName that is not an id, or any other field does not', async () => {
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const validate = new Ajv2020({ allErrors: true, allowUnionTypes: true, validateFormats: false }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'spend-reservations-v1.json'), 'utf8')));
  const reserved = { schema: 'spend-reservations/1', event: 'reserved', id: 'r1', at: '2026-11-01T03:00:00Z', label: 'x', seat: 'mock/mock-priced', usd: 1 };
  assert.equal(validate({ ...reserved, capName: 'openrouter' }), true, JSON.stringify(validate.errors));
  assert.equal(validate(reserved), true, 'an OFF line');
  assert.equal(validate({ ...reserved, capName: 'Open Router' }), false, 'not an id');
  assert.equal(validate({ schema: 'spend-reservations/1', event: 'settled', id: 'r1', at: '2026-11-01T03:00:01Z', outcome: 'recorded', usd: 0.5, capName: 'openrouter' }), false, 'the cap belongs to the reservation, not the settlement');
  assert.equal(validate({ ...reserved, capName: 'openrouter', task: 'x' }), false, 'still closed');
});

test('R5: BudgetExceeded carries the cap that stopped (capName) only when a per-cap cap did, beside the gate figure and the refused-retry mark of the base; with no capName it is exactly the base\'s error', () => {
  const off = new BudgetExceeded({ label: 'panel-1-a', seat: 'openrouter/a/b', spent: 1, cap: 2, projected: 3, gate: 0.5 });
  assert.equal(Object.hasOwn(off, 'capName'), false);
  assert.equal(off.message, 'per-run spend cap reached before stage panel-1-a');
  assert.equal(new BudgetExceeded({ label: 'panel-1-a', seat: 'openrouter/a/b', spent: 1, cap: 2, projected: 3, retryRefused: true }).message, 'per-run spend cap reached before the retry of stage panel-1-a');
  const on = new BudgetExceeded({ label: 'panel-1-a', seat: 'openrouter/a/b', spent: 1, cap: 2, projected: 3, gate: 0.5, capName: 'openrouter' });
  assert.equal(on.capName, 'openrouter');
  assert.deepEqual([on.label, on.seat, on.spent, on.cap, on.projected, on.gate, on.retryRefused, on.controlFlow], ['panel-1-a', 'openrouter/a/b', 1, 2, 3, 0.5, false, true]);
  assert.equal(on.message, 'openrouter spend cap reached before stage panel-1-a');
  assert.equal(new BudgetExceeded({ label: 'panel-1-a', seat: 'mock/mock-priced', spent: 1, cap: 2, projected: 3, retryRefused: true, capName: 'anthropic' }).message, 'anthropic spend cap reached before the retry of stage panel-1-a');
  assert.ok(on instanceof BudgetExceeded && on instanceof Error);
});
