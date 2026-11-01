// The per-cap spend caps' contract (0.8.4 DUALCAP unit 1): the switch and its names, a seat's billing account, the mock-only declaration that lets an
// offline seat count against a cap, the caps a chain is asked for, the seats no enabled cap covers, the lint rule, and the record field names the later
// units write. src/caps.js, src/uncovered.js, src/chain-lint.js. Owner: "'two-cap system' we NEED it for B3" (31 Okt 2026); one ceiling PER cap; a cap is
// asked for only if a seat bills through it; a paid seat no enabled cap covers is refused before anything is sent; a seat's cap follows seat.provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerNames, isFreeProvider } from '../src/providers.js';
import { CAPS_SETTING, MOCK_BILLS_FIELD, BILLING_CAP_IDS, capCeilingName, CAP_CEILING_NAMES, parseCapsSetting, isPaidSeat, billingAccountOf, seatBillingRefusal, CAP_RECORD_FIELDS } from '../src/caps.js';
import { capsInForce, uncoveredSeats } from '../src/uncovered.js';
import { lintChain } from '../src/chain-lint.js';
import { resolveChainSeats } from '../src/chain.js';
import { chainIsPaid } from '../src/start-scope.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chainsDir = join(root, 'chains');
const chain = (seats, more = {}) => ({ name: 'fixture', maxRounds: 1, seats, ...more });

test('C1: the names: the switch, the mock-only seat field, one ceiling setting per billing provider (derived from src/providers.js; the free local provider has none)', () => {
  assert.equal(CAPS_SETTING, 'COUNCIL_SPEND_CAPS');
  assert.equal(MOCK_BILLS_FIELD, 'mockBills');
  assert.deepEqual([...BILLING_CAP_IDS], providerNames().filter(p => !isFreeProvider(p)));
  assert.ok(BILLING_CAP_IDS.includes('openrouter') && BILLING_CAP_IDS.includes('anthropic'));
  for (const free of ['ollama', 'mock', 'external']) assert.ok(!BILLING_CAP_IDS.includes(free), free);
  assert.ok(Object.isFrozen(BILLING_CAP_IDS) && Object.isFrozen(CAP_CEILING_NAMES));
  assert.equal(capCeilingName('openrouter'), 'COUNCIL_MAX_USD_LIMIT_OPENROUTER');
  assert.equal(capCeilingName('anthropic'), 'COUNCIL_MAX_USD_LIMIT_ANTHROPIC');
  assert.deepEqual([...CAP_CEILING_NAMES], BILLING_CAP_IDS.map(capCeilingName));
  for (const bad of ['ollama', 'mock', 'external', 'xai', '', 'OPENROUTER', undefined, null, 5]) assert.throws(() => capCeilingName(bad), TypeError, String(bad));
});

test('C2: the switch is OFF when the setting is unset or blank: no cap, so the run keeps today\'s one typed limit', () => {
  for (const raw of [undefined, null, '', '   ', '\t \n']) assert.deepEqual(parseCapsSetting(raw), { ok: true, caps: [] }, JSON.stringify(raw));
});

test('C3: ON: a list of billing provider ids in any order, case and spacing; the answer is sorted and names each id once', () => {
  assert.deepEqual(parseCapsSetting('openrouter,anthropic'), { ok: true, caps: ['anthropic', 'openrouter'] });
  assert.deepEqual(parseCapsSetting(' OpenRouter , Anthropic '), { ok: true, caps: ['anthropic', 'openrouter'] });
  assert.deepEqual(parseCapsSetting('openrouter'), { ok: true, caps: ['openrouter'] });
  assert.deepEqual(parseCapsSetting('anthropic,openrouter,ANTHROPIC'), { ok: true, caps: ['anthropic', 'openrouter'] });
});

test('C4: FAIL CLOSED: a dollar figure, an unknown or free provider, an empty entry, an off word, a host placeholder or a value that is not text is refused (a stable code and one sentence that names the setting and ends "Nothing was started."), never read as OFF', () => {
  const cases = [
    ['5', 'amount'], ['$5', 'amount'], ['5.50', 'amount'], ['openrouter=5', 'amount'], ['openrouter:5', 'amount'], ['openrouter 5', 'amount'], ['anthropic,openrouter=10', 'amount'],
    ['xai', 'unknown_provider'], ['grok', 'unknown_provider'], ['openrouter,claude', 'unknown_provider'],
    ['ollama', 'free_provider'], ['mock', 'free_provider'], ['external', 'free_provider'],
    ['openrouter,', 'empty_entry'], [',anthropic', 'empty_entry'], ['openrouter,,anthropic', 'empty_entry'],
    ['none', 'off_word'], ['off', 'off_word'], ['false', 'off_word'],
    ['${user_config.spend_caps}', 'placeholder'],
  ];
  for (const [raw, code] of cases) {
    const r = parseCapsSetting(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(r.code, code, raw);
    assert.match(r.sentence, /COUNCIL_SPEND_CAPS/, raw);
    assert.match(r.sentence, /Nothing was started\.$/, raw);
    assert.equal(Object.hasOwn(r, 'caps'), false, raw);
  }
  for (const raw of [5, true, ['openrouter'], { openrouter: true }]) {
    const r = parseCapsSetting(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(r.code, 'not_text', JSON.stringify(raw));
  }
});

test('C5: a seat\'s billing account is its provider when it bills, after single-vendor rerouting (the billing path, never labOf or the model\'s maker); free seats have none; a mock seat has the account its mockBills names', () => {
  assert.equal(billingAccountOf({ provider: 'openrouter', model: 'z-ai/glm-5.3-flash' }), 'openrouter');
  assert.equal(billingAccountOf({ provider: 'anthropic', model: 'claude-haiku-5-5', lab: 'openrouter' }), 'anthropic', 'the lab never decides the account');
  assert.equal(billingAccountOf({ provider: 'openrouter', originalProvider: 'anthropic', model: 'anthropic/claude-sonnet-5' }), 'openrouter', 'a Claude model reached through OpenRouter is billed by OpenRouter');
  for (const seat of [{ provider: 'external' }, { provider: 'external', model: 'subscription:opus' }, { provider: 'ollama', model: 'llama3' }, { provider: 'mock', model: 'mock-priced' }]) assert.equal(billingAccountOf(seat), null, JSON.stringify(seat));
  assert.equal(billingAccountOf({ provider: 'mock', model: 'mock-priced', mockBills: 'openrouter' }), 'openrouter');
  assert.equal(billingAccountOf({ provider: 'mock', model: 'mock-priced', mockBills: 'anthropic' }), 'anthropic');
  assert.equal(billingAccountOf({ provider: 'openrouter', model: 'x/y', mockBills: 'anthropic' }), 'openrouter', 'on a real seat the field never moves the spend to another cap');
  assert.equal(billingAccountOf({ provider: 'mock', model: 'mock-priced', mockBills: 'xai' }), null, 'a declaration that names no billing provider counts nowhere (seatBillingRefusal refuses the run)');
  assert.equal(billingAccountOf(null), null);
  assert.equal(billingAccountOf(undefined), null);
});

test('C5b: ONE billing predicate: isPaidSeat (src/caps.js) is what chainIsPaid reads; a mock seat with a declaration is still not a paid seat when the switch is OFF', () => {
  assert.equal(isPaidSeat({ provider: 'openrouter', model: 'a/b' }), true);
  assert.equal(isPaidSeat({ provider: 'anthropic', model: 'claude-opus-5-5' }), true);
  for (const seat of [{ provider: 'mock', model: 'mock-priced' }, { provider: 'mock', model: 'mock-priced', mockBills: 'openrouter' }, { provider: 'external' }, { provider: 'ollama', model: 'llama3' }, null, undefined]) assert.equal(isPaidSeat(seat), false, JSON.stringify(seat));
  assert.equal(chainIsPaid(chain({ builder: { provider: 'mock', model: 'mock-priced', mockBills: 'openrouter' }, critics: [{ provider: 'mock', model: 'mock-priced', lab: 'a' }] })), false);
  assert.equal(chainIsPaid(chain({ builder: { provider: 'mock', model: 'mock-priced' }, critics: [{ provider: 'openrouter', model: 'a/b', lab: 'a' }] })), true);
  const src = readFileSync(join(root, 'src', 'start-scope.js'), 'utf8');
  assert.match(src, /import \{[^}]*\bisPaidSeat\b[^}]*\} from '\.\/caps\.js'/, 'start-scope reads the predicate from src/caps.js');
  assert.doesNotMatch(src, /const isPaidSeat\s*=/, 'no second copy of the predicate');
});

test('C6: the declaration is honoured ONLY on a mock seat: on any other seat it is refused whatever it names (C&C, 1 Nov 2026: otherwise one seat key is a way around a cap); a mock value that is not a billing provider is refused too; the switch plays no part', () => {
  for (const seat of [
    { provider: 'openrouter', model: 'x/y', mockBills: 'anthropic' },
    { provider: 'openrouter', model: 'x/y', mockBills: 'openrouter' },
    { provider: 'anthropic', model: 'claude-opus-5-5', mockBills: 'none' },
    { provider: 'external', mockBills: 'anthropic' },
    { provider: 'ollama', model: 'llama3', mockBills: 'openrouter' },
  ]) {
    const r = seatBillingRefusal(seat);
    assert.equal(r?.code, 'mock_bills_on_real_seat', JSON.stringify(seat));
    assert.match(r.sentence, /mockBills/);
    assert.ok(r.sentence.includes(seat.provider), 'the sentence names the seat\'s own provider');
  }
  for (const v of ['xai', 'ollama', 'mock', 'external', '', 'OpenRouter', 'openrouter ', 5, null, true, ['openrouter']]) {
    const r = seatBillingRefusal({ provider: 'mock', model: 'mock-priced', mockBills: v });
    assert.equal(r?.code, 'mock_bills_not_a_billing_provider', JSON.stringify(v));
    assert.match(r.sentence, /mockBills/);
  }
  for (const seat of [{ provider: 'mock', model: 'mock-priced', mockBills: 'openrouter' }, { provider: 'mock', model: 'mock-priced', mockBills: 'anthropic' }, { provider: 'openrouter', model: 'x/y' }, { provider: 'mock' }, { provider: 'external' }, null, undefined]) assert.equal(seatBillingRefusal(seat), null, JSON.stringify(seat));
});

test('C7: the caps a chain is asked for: only the enabled caps a seat bills through (an OpenRouter-only chain is never asked for an Anthropic figure); OFF asks for none; a free chain for none', () => {
  const orOnly = chain({ builder: { provider: 'openrouter', model: 'a/b' }, critics: [{ provider: 'openrouter', model: 'c/d', lab: 'c' }, { provider: 'external', model: 'session', lab: 'e' }] });
  assert.deepEqual(capsInForce(orOnly, ['anthropic', 'openrouter']), ['openrouter']);
  const both = chain({ builder: { provider: 'mock', model: 'mock-priced', mockBills: 'anthropic' }, critics: [{ provider: 'mock', model: 'mock-priced', mockBills: 'openrouter', lab: 'a' }, { provider: 'mock', model: 'mock-priced', lab: 'b' }] });
  assert.deepEqual(capsInForce(both, ['anthropic', 'openrouter']), ['anthropic', 'openrouter']);
  assert.deepEqual(capsInForce(both, ['openrouter']), ['openrouter']);
  assert.deepEqual(capsInForce(both, []), [], 'OFF');
  assert.deepEqual(capsInForce(chain({ builder: { provider: 'mock', model: 'mock-priced' }, critics: [{ provider: 'external', lab: 'e' }] }), ['anthropic', 'openrouter']), [], 'nothing bills: no cap is asked for');
});

test('C8: a seat whose account no enabled cap covers is named, one entry per provider/model with its roles (refused before anything is sent, like an unpriced seat); OFF names none; the default security reviewer seat counts; the input is the rerouted roster', () => {
  const verify = chain({ builder: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, critics: [{ provider: 'openai', model: 'gpt-6', lab: 'o' }, { provider: 'google', model: 'gemini-3', lab: 'g' }, { provider: 'openai', model: 'gpt-6', lab: 'o2' }] });
  assert.deepEqual(uncoveredSeats(verify, ['anthropic', 'openrouter']), [
    { account: 'openai', provider: 'openai', model: 'gpt-6', roles: 'critics[0], critics[2]' },
    { account: 'google', provider: 'google', model: 'gemini-3', roles: 'critics[1]' },
  ]);
  assert.deepEqual(uncoveredSeats(verify, []), [], 'OFF: nothing is uncovered, the one cap counts every seat');
  const mockMixed = chain({ builder: { provider: 'mock', model: 'mock-priced', mockBills: 'anthropic' }, critics: [{ provider: 'mock', model: 'mock-priced', mockBills: 'openrouter', lab: 'a' }] });
  assert.deepEqual(uncoveredSeats(mockMixed, ['openrouter']), [{ account: 'anthropic', provider: 'mock', model: 'mock-priced', roles: 'builder' }], 'an offline seat can be uncovered too, so the refusal is testable with no key');
  const reviewed = chain({ builder: { provider: 'openrouter', model: 'a/b' }, critics: [{ provider: 'openrouter', model: 'c/d', lab: 'c' }] }, { security_review: { enabled: true } });
  assert.deepEqual(capsInForce(reviewed, ['openrouter']), ['openrouter']);
  assert.deepEqual(uncoveredSeats(reviewed, ['openrouter']).map(u => [u.account, u.roles]), [['anthropic', 'security_reviewer (default)']]);
  assert.deepEqual(capsInForce(reviewed, ['anthropic', 'openrouter']), ['anthropic', 'openrouter']);
  const routed = resolveChainSeats(chain({ builder: { provider: 'anthropic', model: 'claude-sonnet-5' }, critics: [{ provider: 'external', model: 'session', lab: 'c' }] }, { transport: 'openrouter' }));
  assert.deepEqual(capsInForce(routed, ['anthropic', 'openrouter']), ['openrouter'], 'a Claude seat rerouted through OpenRouter counts against the OpenRouter cap');
  assert.deepEqual(uncoveredSeats(routed, ['openrouter']), []);
});

test('C9: chain-lint refuses the declaration on any seat that is not mock and a mock declaration that names no billing provider; a correct mock declaration and every shipped chain lint as before', () => {
  const found = cfg => lintChain(cfg, 'fixture.json').filter(f => f.kind === 'invalid-mock-bills');
  const onReal = found(chain({ builder: { provider: 'openrouter', model: 'a/b', mockBills: 'anthropic' }, critics: [{ provider: 'openrouter', model: 'c/d', lab: 'c' }] }));
  assert.equal(onReal.length, 1);
  assert.match(onReal[0].message, /mockBills/);
  assert.match(onReal[0].fix, /fixture\.json/);
  assert.equal(found(chain({ builder: { provider: 'mock', model: 'mock-priced', mockBills: 'xai' }, critics: [{ provider: 'mock', model: 'mock-priced', lab: 'c' }] })).length, 1);
  assert.equal(found(chain({ builder: { provider: 'external', mockBills: 'openrouter' }, critics: [{ provider: 'mock', model: 'mock-priced', lab: 'c', mockBills: 'none' }] })).length, 2, 'every offending seat is named');
  assert.deepEqual(found(chain({ builder: { provider: 'mock', model: 'mock-priced', mockBills: 'anthropic' }, critics: [{ provider: 'mock', model: 'mock-priced', mockBills: 'openrouter', lab: 'c' }] })), []);
  for (const file of readdirSync(chainsDir).filter(n => n.endsWith('.json'))) assert.deepEqual(found(JSON.parse(readFileSync(join(chainsDir, file), 'utf8'))), [], file);
});

test('C10: the record field names the later units write, all ABSENT when the switch is OFF (src/caps.js is the one place they are named)', () => {
  assert.deepEqual(CAP_RECORD_FIELDS, {
    runJson: 'caps',
    scope: 'caps',
    report: 'caps',
    stop: { name: 'capName', spentUsd: 'capSpentUsd', assumedUsd: 'capAssumedUsd' },
    error: 'capName',
    gate: 'cap_name',
    reservation: 'capName',
    usage: 'capName',
  });
  assert.ok(Object.isFrozen(CAP_RECORD_FIELDS) && Object.isFrozen(CAP_RECORD_FIELDS.stop));
});
