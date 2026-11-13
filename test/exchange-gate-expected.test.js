// PR #2 fix unit, item 5: the spend gate priced a layer exchange's calls (labels ldebate-<pass>-<seat>, lreply-<pass>-<seat>, and their -x<k> rounds) at their WORST case (the whole maxTokens as output), because expectedOutputTokensOf had no figure for them,
// while the dry run prices the same rows at the review size of the seat (critiqueTokensFor, "reviewOut"). A run could stop at its limit on a call the dry run had counted at a fraction of that. ONE function now: the gate reads the dry run's figure for these calls.
// The ENDING exchange (round "end": ldebate-end-..., lreply-end-...) is gated at the same figure (owner: the largest size is always calculated unrealistically); its size was not measured on an ending exchange. A re-ask or a -retry of an exchange call is gated at the expected cost of the call it repeats, like every other planned call;
// the charge of an exchange call whose answer carried no usage figure (typicalOutputTokensOf) is the same per-seat figure. Offline, $0. The functions are reached through the namespace, so a missing export fails ONE test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as cost from '../src/cost.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEAT = { provider: 'openrouter', model: 'anthropic/claude-opus-5', maxTokens: 20000, lab: 'a' };
const OWN = { ...SEAT, estimate: { critiqueTokens: 700 } };   // a seat's own figure (critiqueTokensFor reads it first)
const EST = { critiqueTokens: 5000 };
const P = { system: 'S', user: 'U'.repeat(400) };
const EXCHANGE_LABELS = ['ldebate-1-la', 'lreply-1-la', 'ldebate-2-x2-lb', 'lreply-3-x3-lb', 'ldebate-12-la'];
const ENDING_LABELS = ['ldebate-end-la', 'lreply-end-la', 'ldebate-end-x2-lb', 'lreply-end-x7-lb'];

test('the gate\'s expected output of a layer exchange call is the review size of the seat, the dry run\'s figure: the seat\'s own, else the chain\'s critiqueTokens (the price table\'s measured one if larger), never above the call\'s cap', () => {
  for (const label of [...EXCHANGE_LABELS, ...ENDING_LABELS]) {
    assert.equal(cost.expectedOutputTokensOf(label, SEAT, EST), cost.critiqueTokensFor(SEAT, EST.critiqueTokens), `${label}: the chain's figure`);
    assert.equal(cost.expectedOutputTokensOf(label, OWN, EST), 700, `${label}: the seat's own figure`);
    assert.equal(cost.expectedOutputTokensOf(label, { ...SEAT, maxTokens: 900 }, EST), 900, `${label}: never above the call's cap`);
  }
  assert.ok(cost.critiqueTokensFor(SEAT, EST.critiqueTokens) >= 5000 && cost.critiqueTokensFor(SEAT, EST.critiqueTokens) < SEAT.maxTokens, 'premise: the figure is below the worst case');
});

test('ONE function for the gate and the dry run: on every shipped layered chain, each exchange row of the dry run is priced at the figure the gate uses for the same seat', () => {
  let checked = 0;
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const config = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    const critics = config.seats?.critics ?? [];
    if (!critics.some(s => s.layer)) continue;
    const rows = cost.estimateChainRows(config).filter(r => /^l(debate|reply)-L\d+-/.test(r.label) && !/-x\d+$/.test(r.label));
    for (const row of rows) {
      const seats = critics.filter(s => `${s.provider}/${s.model}` === row.seat);
      assert.ok(seats.length > 0, `${f} ${row.label}: the row's seat is a critic of the chain`);
      const seat = seats[0];
      const perCall = cost.expectedOutputTokensOf(row.label.replace(/^(l(?:debate|reply))-L\d+-.*/, '$1-1-x'), { ...seat, maxTokens: seat.panelMaxTokens ?? seat.maxTokens }, config.estimate ?? {});
      assert.equal(perCall * (row.times ?? 1), row.output, `${f} ${row.label}: the gate's figure times the calls is the row's output`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `rows checked: ${checked}`);
});

test('the ending exchange is gated at the same figure as the exchange of a pass, not at its worst case: its calls (ldebate-end-..., lreply-end-..., any round) have an expected size and an expected cost', () => {
  for (const label of ENDING_LABELS) {
    assert.equal(cost.expectedOutputTokensOf(label, SEAT, EST), cost.expectedOutputTokensOf('ldebate-1-la', SEAT, EST), label);
    const usd = cost.expectedCallUsd(SEAT, { ...P, label, estimate: EST });
    assert.ok(typeof usd === 'number' && usd > 0 && usd < cost.projectAttempts(SEAT, P).first, `${label}: an expected cost below the worst case`);
  }
});

test('a re-ask or a -retry of an exchange call is gated at the expected cost of the call it repeats; the label itself of a repeat has no figure of its own', () => {
  const expected = cost.expectedCallUsd(SEAT, { ...P, label: 'ldebate-1-la', estimate: EST });
  assert.ok(typeof expected === 'number' && expected > 0, 'premise: the call has an expected cost');
  for (const label of ['ldebate-1-la-retry', 'ldebate-1-la-reask1', 'lreply-2-x2-lb-retry']) assert.equal(cost.expectedOutputTokensOf(label, SEAT, EST), null, `${label}: no figure of its own`);
  assert.equal(cost.repeatExpectedCallUsd(SEAT, { ...P, label: 'ldebate-1-la-retry', estimate: EST }), expected);
  assert.equal(cost.repeatExpectedCallUsd(SEAT, { ...P, label: 'lreply-1-la-reask1', estimate: EST }), cost.expectedCallUsd(SEAT, { ...P, label: 'lreply-1-la', estimate: EST }));
  assert.equal(cost.repeatExpectedCallUsd(SEAT, { ...P, label: 'ldebate-end-la-retry', estimate: EST }), cost.expectedCallUsd(SEAT, { ...P, label: 'ldebate-end-la', estimate: EST }), 'the ending exchange too');
});

test('the charge of an exchange call whose answer carried no usage figure is the same per-seat figure: a seat with its own critiqueTokens is charged that, not the chain\'s; a seat with none is charged as before', () => {
  assert.equal(cost.typicalOutputTokensOf('ldebate-1-la', OWN, EST), 700, 'the seat\'s own figure');
  assert.equal(cost.typicalOutputTokensOf('lreply-2-x2-lb', OWN, EST), 700);
  assert.equal(cost.typicalOutputTokensOf('ldebate-1-la', SEAT, EST), cost.critiqueTokensFor(SEAT, EST.critiqueTokens));
  assert.equal(cost.typicalOutputTokensOf('ldebate-end-la', OWN, EST), 700, 'the ending exchange too');
});
