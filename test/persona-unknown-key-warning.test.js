// test/persona-unknown-key-warning.test.js
//
// 0.8.4, lane C unit 5, plan C lint rule 5b: a debating seat's role.persona key that has no usable entry in the persona set in
// use is a WARNING (judgePersonaWarnings, printed by `council doctor` and the run's pre-flight list; never fatal), one finding per seat
// with the kind `persona-unknown-key`. A proposer's role.persona with the seat_personas switch ON is already refused under both forms
// (no double report); critics that debate in a chain with no proposers are reported with the switch on too.
// Rows marked PIN pass on the source before this unit; the others fail there by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePersonaWarnings } from '../src/judge-persona.js';
import { debateSystemFor } from '../src/stage-system.js';

const SET = { moses: { name: 'Moses', voice: 'Speaks in plain, weighty directives.' }, noah: { name: 'Noah', voice: 'Methodical.' } };
const debater = persona => ({ provider: 'mock', model: 'm', ...(persona === undefined ? {} : { role: { persona } }) });
const chain = (over = {}) => ({ proposals: { parts: 1 }, debate: { rounds: 1 }, seats: { proposers: [debater('moses'), debater('noah')], critics: [debater()] }, ...over });
const findings = (cfg, set = SET) => judgePersonaWarnings(cfg, set);

test('5b: an unknown role.persona key is one finding of kind persona-unknown-key, naming the seat, the key and the keys that do work', () => {
  const f = findings(chain({ seats: { proposers: [debater('moses'), debater('nobody')], critics: [debater()] } }));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'persona-unknown-key');
  assert.match(f[0].message, /seats\.proposers\[1\] names the persona "nobody"/);
  assert.match(f[0].fix, /use one of: moses, noah\./);
  assert.ok(f[0].message.endsWith(f[0].fix), 'cli.js prints the message only, so the fix ends the message');
});

test('5b: an entry with no voice (or a blank name) is not usable: every such seat is a finding', () => {
  const f = findings(chain(), { moses: { name: 'Moses' }, noah: { name: ' ', voice: 'x' } });
  assert.equal(f.length, 2);
  assert.match(f[0].message, /proposers\[0\].*"moses"/);
  assert.match(f[1].message, /proposers\[1\].*"noah"/);
  assert.doesNotMatch(f[0].fix, /use one of/);
});

test('5b: the same unknown key on two seats is a finding on each seat', () => {
  const f = findings(chain({ seats: { proposers: [debater('ghost'), debater('ghost')] } }));
  assert.deepEqual(f.map(x => /proposers\[(\d)\]/.exec(x.message)[1]), ['0', '1']);
});

test('5b: the critics are the debating seats when the chain has no proposers', () => {
  const f = findings(chain({ seats: { critics: [debater('ghost')] } }));
  assert.equal(f.length, 1);
  assert.match(f[0].message, /seats\.critics\[0\] names the persona "ghost"/);
});

test('5b: critics that debate are reported with the switch ON too (the proposer refusal does not cover them)', () => {
  const f = findings(chain({ seat_personas: { enabled: true, form: 'title' }, seats: { critics: [debater('ghost')] } }));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'persona-unknown-key');
});

test('5b PIN: keys that the set holds give no finding', () => {
  assert.deepEqual(findings(chain()), []);
});

test('5b PIN: a proposer role.persona with seat_personas on gives no 5b finding (the lint refuses it instead)', () => {
  for (const form of ['title', 'voice']) {
    const cfg = chain({ seat_personas: { enabled: true, form }, seats: { proposers: [debater('ghost')] } });
    assert.deepEqual(findings(cfg), [], `form ${form}`);
  }
});

test('5b PIN: a chain that runs no proposals or no debate has no debating seats, so no finding', () => {
  const seats = { proposers: [debater('ghost')] };
  assert.deepEqual(findings({ debate: { rounds: 1 }, seats }), []);
  assert.deepEqual(findings({ proposals: { parts: 1 }, seats }), []);
});

test('5b PIN: nothing to read gives no finding, and a persona field with the switch off still warns as before', () => {
  assert.deepEqual(findings(null), []);
  assert.deepEqual(findings({}), []);
  const f = findings({ seats: { critics: [{ provider: 'mock', model: 'm', persona: 'Noah' }] } });
  assert.equal(f.length, 1);
  assert.match(f[0].message, /seat_personas/);
});

test('5b is tied to the prompt: it warns for a seat exactly when the debate system text has no voice behind the key (the shipped persona set)', () => {
  for (const [key, expectWarning] of [['moses', false], ['noah', false], ['matthew', false], ['ghost', true]]) {
    const seat = debater(key);
    const cfg = chain({ seats: { proposers: [seat] } });
    const system = debateSystemFor(cfg, seat);
    const bare = system.includes(`You are arguing as ${key}. Let that voice`);   // applySeatRole's sentence with no "(Name). voice" between the key and "Let that voice"
    assert.equal(bare, expectWarning, `${key}: the prompt ${bare ? 'has no voice' : 'carries a voice'}`);
    assert.equal(judgePersonaWarnings(cfg).filter(f => f.kind === 'persona-unknown-key').length, expectWarning ? 1 : 0, `${key}: the warning`);
  }
});
