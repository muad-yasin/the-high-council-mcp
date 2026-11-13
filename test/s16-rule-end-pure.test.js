// 0.8.4 S16 (E): the pure parts of the end by rule of a run with no handling session (behaviour: test/s16-rule-end.test.js): the ONE predicate of the offline mock chain (chain-lint's rule 1f reads the same function), the stops that end by rule and the ones that never do,
// and the words (WORDING S16-w65b, w65c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfflineMockChain, endsAtStopWithoutHandler, ruleStopWords, exchangeTriggerOf, exchangeTriggerWords } from '../src/chain.js';
import { finishedAtStopWords } from '../src/verdict-headline.js';
import { renderBoardMd } from '../src/report-shape.js';

const mock = (extra = {}) => ({ provider: 'mock', model: 'mock-x', ...extra });
const chain = (seats = {}, extra = {}) => ({ name: 'c', seats: { builder: mock(), reviser: mock(), critics: [mock({ layer: 1 }), mock({ layer: 2 }), mock({ layer: 3 })], ...seats }, ...extra });
const noMock = chain({ security_reviewer: { provider: 'anthropic', model: 'claude-opus-5-5' } });
const handled = chain({ reviser: { provider: 'external', model: 'claude-code-session' }, security_reviewer: { provider: 'anthropic', model: 'claude-opus-5-5' } });
const cap = (extra = {}) => ({ kind: 'overseer_cap', rounds: 3, cap: 3, ...extra });
const silent = (layer, extra = {}) => ({ kind: 'layer_bound', why: 'unheard', layer, ...extra });

test('the offline mock chain is one predicate: every seat mock; a default security reviewer (security_review on, no seat named) is not mock; a missing slot is skipped', () => {
  assert.equal(isOfflineMockChain(chain()), true);
  assert.equal(isOfflineMockChain(noMock), false);
  assert.equal(isOfflineMockChain(chain({}, { security_review: { enabled: true } })), false, 'the default security reviewer is a real seat');
  assert.equal(isOfflineMockChain(chain({ skeleton: null })), true);
});

test('T21aq, T21bf: the stops that end by rule: the limit when it is not the hard stop, a silent seat of layer 1 or 2; never layer 3\'s own silence, the hard stop, a revisions bound or a stall', () => {
  assert.equal(endsAtStopWithoutHandler(noMock, cap(), 3), true);
  assert.equal(endsAtStopWithoutHandler(noMock, cap({ rounds: 7, cap: 7 }), 3), false, 'the hard stop after seven overseer rounds stays the person\'s');
  assert.equal(endsAtStopWithoutHandler(noMock, silent(1), 3), true);
  assert.equal(endsAtStopWithoutHandler(noMock, silent(2), 3), true);
  assert.equal(endsAtStopWithoutHandler(noMock, silent(3), 3), false);
  assert.equal(endsAtStopWithoutHandler(noMock, { kind: 'layer_bound', why: 'revisions', layer: 1 }, 3), false);
  assert.equal(endsAtStopWithoutHandler(noMock, { kind: 'stall_stop', why: 'top_layer', rounds: 2 }, 3), false);
});

test('Muad\'s pick: an all-mock chain and a chain with a handling session never end by rule', () => {
  assert.equal(endsAtStopWithoutHandler(chain(), cap(), 3), false);
  assert.equal(endsAtStopWithoutHandler(handled, cap(), 3), false);
  assert.equal(endsAtStopWithoutHandler(handled, silent(1), 3), false);
});

test('WORDING S16-w65b: the cause words are true for the stop they name', () => {
  assert.equal(ruleStopWords(cap()), 'the overseer-round limit was reached');
  assert.equal(ruleStopWords(silent(2)), 'a seat of layer 2 gave no usable reply after its re-asks');
  assert.equal(ruleStopWords(silent(2), ['ls']), 'a seat of layer 2 (ls) gave no usable reply after its re-asks', 'w65d: the lab the record holds unheard is named');
});

test('a run the rule ended, with the top layer not signed off, gets the same neutral clause as a person\'s finish; its BOARD section says why in the run\'s own words (WORDING S16-w65c)', () => {
  const layers = [{ layer: 1, round: 2, state: 'signed_off' }, { layer: 2, round: 2, state: 'signed_off' }, { layer: 3, round: 2, state: 'objected' }];
  const x = chosen => ({ passed: false, layers, stop: { kind: 'overseer_cap', pass: 2, top_layer: 3, chosen } });
  const rule = finishedAtStopWords(x('rule'));
  assert.ok(rule && rule === finishedAtStopWords(x('finish')), 'the clause is the same for both');
  assert.equal(finishedAtStopWords(x('early')), null);
  const board = chosen => renderBoardMd({ runId: 'r', result: x(chosen) });
  assert.match(board('rule'), /## Not agreed: ended at a stop because the run has no handling session\n\n/);
  assert.match(board('finish'), /## Not agreed: finished at the person's choice\n\n/);
});

test('WORDING S16-w70: the ending exchange\'s trigger says rule for a rule ending, finish for a finish, round_cap otherwise; none of the rule words is the person\'s-choice wording', () => {
  assert.equal(exchangeTriggerOf({ chosen: 'rule' }), 'rule');
  assert.equal(exchangeTriggerOf({ chosen: 'finish' }), 'finish');
  assert.equal(exchangeTriggerOf(null), 'round_cap');
  assert.equal(exchangeTriggerWords('rule'), 'ended at the stop because the run has no handling session');
  assert.equal(exchangeTriggerWords('finish'), "finished at the person's choice");
  assert.equal(exchangeTriggerWords('round_cap'), 'round cap');
  assert.doesNotMatch(exchangeTriggerWords('rule'), /person/);
});
