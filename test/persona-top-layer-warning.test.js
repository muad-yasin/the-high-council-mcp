// test/persona-top-layer-warning.test.js
//
// 0.8.4, lane C unit 5, plan C item C4 (a person's own chain with another number of top-layer seats) and its warning W5.
// The harness assigns no name by position: a seat keeps the persona its author wrote. A layered chain whose TOP layer holds ONE seat
// that carries one of the two shipped top-layer names (Melchizedek, Karpathy) gets a warning (the other name is unused); the run is
// not refused. Three or more top seats say nothing. Rows marked PIN pass on the source before this unit; the W5 rows fail there by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgePersonaWarnings } from '../src/judge-persona.js';

let labCount = 0;
const judge = (layer, persona) => ({ provider: 'mock', model: 'm', lab: `lab-${layer}-${++labCount}`, layer, ...(persona === undefined ? {} : { persona }) });
const chain = (critics, over = {}) => ({ signoff: 'unanimous', seat_personas: { enabled: true, form: 'title' }, seats: { critics }, ...over });
const messages = cfg => judgePersonaWarnings(cfg, {}).map(w => w.message);

test('W5: a one-seat top layer carrying Karpathy warns, names the unused Melchizedek, and says the run still starts', () => {
  const m = messages(chain([judge(1, 'Noah'), judge(1, 'Husayn'), judge(2, 'Plato'), judge(2, 'Moses'), judge(3, 'Karpathy')]));
  assert.equal(m.length, 1);
  assert.match(m[0], /Layer 3 holds one judge/);
  assert.match(m[0], /Karpathy/);
  assert.match(m[0], /Melchizedek\) is unused/);
  assert.match(m[0], /still starts/);
});

test('W5: the same with Melchizedek alone, in any letter case and with the switch off', () => {
  const m = messages(chain([judge(1, 'Noah'), judge(2, 'Plato'), judge(3, 'melchizedek')], { seat_personas: undefined }));
  assert.ok(m.some(x => /Layer 3 holds one judge, carrying the persona Melchizedek/.test(x) && /Karpathy\) is unused/.test(x)), m.join(' | '));
});

test('W5 PIN: a one-seat top layer with any other name says nothing about the two names', () => {
  assert.deepEqual(messages(chain([judge(1, 'Noah'), judge(2, 'Plato'), judge(3, 'Einstein')])), []);
  assert.deepEqual(messages(chain([judge(1, 'Noah'), judge(2, 'Plato'), judge(3)])), []);
});

test('C4 PIN: two top seats (the shipped shape) and three or more top seats give no warning', () => {
  assert.deepEqual(messages(chain([judge(1, 'Noah'), judge(2, 'Plato'), judge(3, 'Melchizedek'), judge(3, 'Karpathy')])), []);
  assert.deepEqual(messages(chain([judge(1, 'Noah'), judge(2, 'Plato'), judge(3, 'Melchizedek'), judge(3, 'Karpathy'), judge(3, 'Einstein')])), []);
  assert.deepEqual(messages(chain([judge(1, 'Noah'), judge(2, 'Plato'), judge(3, 'Karpathy'), judge(3), judge(3)])), []);
});

test('C4 PIN: a one-seat layer BELOW the top is not a persona question: no warning', () => {
  assert.deepEqual(messages(chain([judge(1, 'Noah'), judge(2, 'Karpathy'), judge(3, 'Melchizedek'), judge(3, 'Einstein')])), []);
});

test('C4 PIN: a chain with no layers has no top layer', () => {
  assert.deepEqual(messages(chain([{ provider: 'mock', model: 'm', persona: 'Karpathy' }])), []);
});

test('C4 PIN: the shipped plan-the-high-council gives no warning (its top layer holds two seats)', () => {
  const cfg = JSON.parse(readFileSync(new URL('../chains/plan-the-high-council.json', import.meta.url), 'utf8'));
  assert.deepEqual(judgePersonaWarnings(cfg), []);
});
