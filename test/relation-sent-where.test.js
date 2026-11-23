// 0.8.4 (C&C GO "answer back off", Muad's yes): the relation sentence (relationRule, W6) is sent only where a judge is SHOWN its own earlier objections, that is on a chain with answer_back on. On a unanimous panel chain with answer_back
// off the judges are not asked for a relation and a repeated objection keeps its id the 0.8.3 way. Rows:
//   RS-1 an answer_back-on panel prompt is byte for byte what it was: the critic's own prompt plus the relation sentence at its end (the seven planning chains send the same bytes as before).
//   RS-2 an answer_back-off panel prompt is the critic's own prompt, nothing added: no relation sentence anywhere in it.
//   RS-3 the cost estimate prices exactly what is sent: its panel system texts follow the same switch.
//   RS-4 an UNASKED relation in a reply of an answer_back-off chain changes no id and refuses nothing: the objection keeps its hash id and the run reads the reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { criticPromptFor, panelPromptFor, climbSortingFor, systemTextsFor } from '../src/stage-system.js';
import * as R from '../src/roles.js';
import { setHeldForTest } from '../src/held-roles.js';
import { runChain, setCache, setBudget } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';

const seat = { provider: 'mock', model: 'mock-critic-a', lab: 'la' };
const chain = extra => ({ name: 'rs', signoff: 'unanimous', maxRounds: 2, criteria: ['It exists.'], seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [seat, { provider: 'mock', model: 'mock-critic-b', lab: 'lb' }] }, ...extra });
const ON = chain({ answer_back: { enabled: true } });
const OFF = chain({});

test('RS-1 answer_back on: the panel prompt is the critic prompt plus the relation sentence, as before the switch existed', () => {
  setHeldForTest(null);
  assert.equal(panelPromptFor(seat, false, undefined, ON), `${criticPromptFor(seat, false, undefined, ON, climbSortingFor(seat, ON))}\n\n${R.relationRule()}`);
});

test('RS-2 answer_back off: the panel prompt is the critic prompt, nothing added; no relation sentence in it', () => {
  setHeldForTest(null);
  const p = panelPromptFor(seat, false, undefined, OFF);
  assert.equal(p, criticPromptFor(seat, false, undefined, OFF, climbSortingFor(seat, OFF)));
  assert.ok(!p.includes(R.relationRule()) && !p.includes('set "relation" to one of'), 'no relation sentence');
});

test('RS-3 the estimate prices what is sent: its panel system texts end with the relation sentence only on a chain with answer_back on', () => {
  setHeldForTest(null);
  const ends = cfg => systemTextsFor('panel-1-la', cfg, seat).every(t => t.endsWith(R.relationRule()));
  const none = cfg => systemTextsFor('panel-1-la', cfg, seat).every(t => !t.includes(R.relationRule()));
  assert.ok(ends(ON), 'answer_back on: every priced panel text carries the relation sentence');
  assert.ok(none(OFF), 'answer_back off: no priced panel text carries it');
});

test('RS-4 an unasked relation on an answer_back-off chain changes no id and refuses nothing', async () => {
  setHeldForTest(null);
  const failure = { criterion: 'It exists.', problem: 'Still missing.', quote: 'a passage', relation: 'continues O-00000000' };
  const verdict = JSON.stringify({ meets: false, criteria: [{ criterion: 'It exists.', verdict: 'FAILED', evidence: 'no' }], failures: [failure], verdict_line: 'no' });
  const lines = [];
  setBudget(null);
  setCache({ invalidate() {}, get: label => (label.startsWith('panel-') ? { text: verdict, provider: 'mock', model: 'm', usage: { input: 1, output: 1 } } : null) });
  try {
    const result = await runChain({ request: 'A task.', config: { ...OFF, seats: { ...OFF.seats, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'la' }, { provider: 'mock', model: 'mock-critic-b', lab: 'lb' }] } }, log: l => lines.push(l), runId: 'r-rs4' });
    const text = lines.join('\n');
    assert.doesNotMatch(text, /relation field cannot be used|relation_missing|relation_unreadable|continues_not_standing/, 'no refusal');
    const ids = result.signoff.flatMap(x => x.objections || []).map(o => o.id).filter(Boolean);
    assert.ok(ids.length >= 1, 'the objection is on the record');
    assert.ok(ids.every(id => !/#/.test(id)), `no suffixed id: ${ids.join(', ')}`);
    assert.ok(ids.includes(objectionId('la', failure)), 'the id is the derived hash id');
  } finally { setCache(null); }
});
