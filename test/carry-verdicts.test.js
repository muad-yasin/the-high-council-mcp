// R1 (owner's yes, 2026-09-28): when every heard reviewer signed off clean and one seat stayed
// unheard, the next round used to re-ask the WHOLE panel on a byte-identical draft. Now the heard
// seats' verdicts on that same text are carried over and only the unheard seat is asked again. Not
// an early stop: the round cap is untouched, and unanimity still needs every seat heard. Mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget } from '../src/chain.js';

const seat = (model, extra = {}) => ({ provider: 'mock', model, lab: model, ...extra });
const config = (critics, maxRounds) => ({
  name: 'test-carry', maxRounds, signoff: 'unanimous', criteria: ['It names an owner.'],
  seats: { builder: seat('mock-builder'), reviser: seat('mock-builder'), critics },
});

test('an unchanged draft re-asks only the unheard seat; the others\' clean verdicts are carried, and it is still not agreement', async () => {
  setCache(null); setBudget(null);
  const stages = [], lines = [];
  const r = await runChain({ request: 'A test request.', config: config([seat('mock-critic-a'), seat('mock-critic-b'), seat('mock-critic-cut', { maxTokens: 1000 })], 4), log: l => lines.push(l), onStage: s => stages.push(s.label) });
  assert.equal(r.passed, false, 'a seat never heard: never agreement');
  // Round 1: the mock critics object to the first draft, so it is revised; round 2 reviews the
  // revision (a and b sign off, the cut seat is unheard); rounds 3 and 4 see that same text.
  for (const round of [3, 4]) {
    assert.ok(!stages.includes(`panel-${round}-mock-critic-a`) && !stages.includes(`panel-${round}-mock-critic-b`), `round ${round}: the heard seats are not asked again (${stages.join(', ')})`);
    assert.ok(stages.includes(`panel-${round}-mock-critic-cut`), `round ${round}: the unheard seat is asked`);
    const pv = r.panelVerdicts.filter(v => v.round === round);
    assert.deepEqual(pv.filter(v => v.carried).map(v => v.lab).sort(), ['mock-critic-a', 'mock-critic-b']);
    assert.equal(pv.find(v => v.lab === 'mock-critic-cut').carried, undefined);
  }
  assert.ok(r.panelVerdicts.filter(v => v.round <= 2).every(v => v.carried === undefined), 'nothing is carried onto a changed draft');
  assert.ok(stages.includes('panel-2-mock-critic-a'), 'after a revise the whole panel is asked');
  assert.ok(lines.some(l => /draft unchanged since round 2: carrying over the verdicts of mock-critic-a, mock-critic-b/.test(l)));
  assert.ok(lines.some(l => /NOT agreement/.test(l)), 'the round cap still says this is not agreement');
});

test('when the unheard seat is heard and clean on the unchanged draft, the panel is unanimous on that draft', async () => {
  // The cache stands in for a seat that is unreadable in round 2 (and both re-asks) and answers in
  // round 3. Round 1 is an objection round (the mock critic fails the first draft), so it is revised.
  const bad = { text: 'not json at all', usage: { input: 1, output: 3, stop: 'stop' }, provider: 'mock', model: 'mock-critic-x', usd: 0 };
  const good = { text: JSON.stringify({ meets: true, criteria: [{ criterion: 'It names an owner.', verdict: 'MET', evidence: 'Section 1.' }], failures: [], verdict_line: 'All met.' }), usage: { input: 1, output: 30, stop: 'stop' }, provider: 'mock', model: 'mock-critic-x', usd: 0 };
  setCache({ get: label => /^panel-2-x(-reask\d)?$/.test(label) ? bad : label === 'panel-3-x' ? good : null });
  setBudget(null);
  const stages = [];
  const r = await runChain({ request: 'A test request.', config: config([seat('mock-critic-a'), seat('mock-critic-x', { lab: 'x' })], 4), log: () => {}, onStage: s => stages.push(s.label) });
  setCache(null);
  assert.equal(r.passed, true, `expected unanimity in round 3, stages: ${stages.join(', ')}`);
  assert.ok(!stages.includes('panel-3-mock-critic-a'));
  const round3 = r.panelVerdicts.filter(v => v.round === 3);
  assert.deepEqual(round3.map(v => [v.lab, v.verdict, !!v.carried]).sort(), [['mock-critic-a', 'signed_off', true], ['x', 'signed_off', false]]);
  assert.ok(r.signoff.every(s => s.signedOff === true));
});
