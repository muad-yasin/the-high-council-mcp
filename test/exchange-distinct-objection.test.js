// PR #2 fix unit, item 3 (Bug Audit S2 F1): a NEW objection a judge names in a layer exchange post whose id (seat, criterion, quoted passage) equals one of that seat's standing objections, but whose problem is another one, was dropped with no record
// (`if (objs.has(id)) continue`). It is kept under its own id with the next suffix (#2), as a blind review's new objection is; the same complaint again is still one objection. Offline, $0: the scenario of test/helpers/layer-two-run.js.
// la raises A ("No retry limit is specified."); lb raises X (another passage, so that la has an objection to post on); in the exchange la names B in a post: the same criterion and quote as A, a different problem.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as ids from '../src/objection-ids.js';
const { objectionId, recordAssignedId, resetAssignedIds, snapshotIds, restoreIds } = ids;
import { scenario, FINAL_READ_OK, bareFailureOf, CRITERION, idOf } from './helpers/layer-two-run.js';

afterEach(() => { chain.setSpendFinish?.(null); chain.setCache(null); chain.setBudget(null); chain.setPromptSpy(null); chain.setOutboundScan({}); setHeldForTest(null); });

const A = bareFailureOf(5);
const X = { ...bareFailureOf(5), problem: 'No back-off is specified.', quote: 'The worker', relation: 'new' };
const B = { criterion: A.criterion, problem: 'The limit it names applies to every request, not only failed ones.', fix: 'Say which.', quote: A.quote, severity: 5 };
const idX = objectionId('lb', X);
const lbRaise = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'x' }], failures: [X], verdict_line: 'no' });
const postLa = news => JSON.stringify({ posts: [{ on: idX, stance: 'support', text: 'It holds.' }], new_objections: news });
const postLb = JSON.stringify({ posts: [{ on: idOf(5), stance: 'support', text: 'It holds.' }], new_objections: [] });
const run = news => scenario({ critics: [['la', 1], ['lb', 1], ['lx', 2], ['lc', 3]], extra: { dispute: { enabled: true, stall_rounds: 2 } }, overrides: { 'panel-1-lb': lbRaise, 'ldebate-1-la': postLa(news), 'ldebate-1-lb': postLb, ...FINAL_READ_OK } });
const rowsOf = r => r.layerDebates[0].objections.map(o => [o.id, o.raised_by, o.from_exchange === true]);

test('a distinct new objection of a seat whose id equals one of its standing objections is kept under its own id (#2), with the round it was added', async () => {
  const { result: r } = await run([B]);
  assert.deepEqual(rowsOf(r), [[idOf(5), 'la', false], [idX, 'lb', false], [`${idOf(5)}#2`, 'la', true]], 'the second objection of la is on the record');
  const row = r.layerDebates[0].objections.find(o => o.id === `${idOf(5)}#2`);
  assert.deepEqual([row.problem, row.added_round], [B.problem, 1]);
  assert.equal(r.layerDebates[0].rounds[0].new_objections, 1, 'the round says that one objection was added');
});

test('the objection goes on: the writer\'s revise step is shown the second objection too, not only the first', async () => {
  const { result: r, prompts } = await run([B]);
  assert.ok(r.stages.some(s => s.label === 'revise-1'), 'premise: the pass was revised');
  const revise = prompts.get('revise-1').user;
  assert.ok(revise.includes(A.problem) && revise.includes(B.problem), 'both of la\'s objections reach the writer');
});

test('the suffix is the next one the seat has not been given for this key, a withdrawn or closed id included: a recorded #2 is never reused', () => {
  const snap = snapshotIds(); resetAssignedIds();
  try {
    const b = { ...B };
    assert.equal(ids.nextSuffixedId('la', b, new Set([idOf(5)])), `${idOf(5)}#2`, 'nothing recorded: #2');
    recordAssignedId('la', { ...A, problem: 'An earlier second objection, since withdrawn.' }, `${idOf(5)}#2`);
    assert.equal(ids.nextSuffixedId('la', b, new Set([idOf(5)])), `${idOf(5)}#3`, 'the recorded #2 is taken, though no objection in hand holds it');
    assert.equal(ids.nextSuffixedId('lb', b, new Set()), `${objectionId('lb', b)}#2`, 'another seat has its own key');
  } finally { restoreIds(snap); }
});

test('the same complaint again is still ONE objection: a verbatim repeat of the standing objection, and the distinct one named twice, add nothing beyond the one #2', async () => {
  const { result: r } = await run([{ ...A, relation: undefined }, B, B]);
  assert.deepEqual(rowsOf(r), [[idOf(5), 'la', false], [idX, 'lb', false], [`${idOf(5)}#2`, 'la', true]]);
});
