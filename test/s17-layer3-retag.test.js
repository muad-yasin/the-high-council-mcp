// 0.8.4 S17 (D33, N25, RT; FEATURE_SPECS l.1649-1650 T21aj, l.1644 T21ak; C&C ruled 09 Nov: build the LAYER-3 version): layer 3's own verdict carries `retags` (critique.retags, src/chain.js, applied by src/severity.js applyRetags). A block of layer 2 that layer 3 overruled at a climb read where it objected is shown to its seat in its next review;
// the seat's withdrawal there quotes a passage the revised draft does not hold, so it is refused and the block stands (T21ai); the seat keeps it in pass 5; layer 2 reaches its bound again and goes up (pass 6); layer 3 reads again and re-tags the block below 4, giving a reason.
// The fixture is the one of C3-28 (test/s8-closure.test.js: layer 2 at its bound twice, the second go-up at pass 6, layer 3 signs off, the run ends at an escalated sign-off and the closing read sorts) with the passes 4 to 6 of this row. It has NO green twin for the whole pass shape: a fixture red at the unit end is expected, not news, and does not count as the row's red.
// T21aj: rated 5, re-tagged to 3 by layer 3 in pass 6: the re-tag is recorded (pass, old, new, who, reason), is the route it cleared by, and the objection is settled (not open at the end; an objection cleared by a re-tag is listed under swept only if its raiser lists it again, so the row asserts "not open"). T21ak (folded in, C&C): rated 8, the same re-tag, and the closing read sorts it may-leave: it stays OPEN on the record (it was once rated 8), in open_at_end, not swept.
// Written without a run (no tests on the laptop); the reds are swapped-input variants (S17_SWAPS.json). Held words injected (as shipped they are held).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { SORTING } from './helpers/rating-demand.js';
import { CRITERION } from './helpers/layer-two-run.js';
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation. NEW: each carries relation 'new'; mid-beta's raises of Y in passes 2 and 5 (its id still stands) carry `continues <id>`. WHY: relationRule is recorded (src/chain.js:5462); a `new` on a standing id mints #2.
const Y = { criterion: CRITERION, problem: 'No owner is named.', relation: 'new' };   // unquoted, as C3-28's: its id does not depend on the rating
const idY = objectionId('mid-beta', Y);
const YAGAIN = { ...Y, relation: `continues ${idY}` };
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5, relation: 'new' };
const idL3 = objectionId('top-gamma', L3F);
const GOUP = { goUpRulingSystem: HB084.goUpRulingSystem, goUpRulingUser: HB084.goUpRulingUser, goUpRulingsSection: HB084.goUpRulingsSection };
const verdictOf = (failures, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no', ...extra });
const meetsOf = extra => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const rulesOf = (id, reason) => JSON.stringify({ rulings: [{ id, ruling: 'overrule', reason }] });
const FOUND = 'It reads "The worker retries failed requests."';
const ABSENT = 'It reads "The worker uses exponential back-off."';
const REASON = 'The seat\'s reason: section two names the owner.';

// rate: the rating mid-beta gives Y; to: what layer 3 re-tags it to in pass 6; final: what the closing read sorts Y (null: no sorting)
async function run({ rate, to, final }) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, p));
  setHeldForTest({ ...SORTING, ...GOUP, dissentRecordSection: () => '' });
  const script = {
    'panel-1-mid-beta': verdictOf([{ ...Y, severity: rate }]), 'panel-2-mid-beta': verdictOf([{ ...YAGAIN, severity: rate }]),
    'rule-3-top-gamma': rulesOf(idY, 'Section two names the owner.'),
    'panel-3-top-gamma': verdictOf([L3F]),
    'panel-4-mid-beta': meetsOf({ answers: [{ id: idY, status: 'withdrawn', evidence: ABSENT }] }),   // the withdrawal is refused: the block stands
    'panel-5-mid-beta': verdictOf([{ ...YAGAIN, severity: rate }]),   // and the seat keeps it: layer 2 is at its bound again
    'rule-6-top-gamma': rulesOf(idY, 'Section two names the owner.'),
    'panel-6-top-gamma': meetsOf({ answers: [{ id: idL3, status: 'withdrawn', evidence: FOUND }], retags: [{ id: idY, severity: to, reason: REASON }], ...(final === null ? {} : { sorting: [{ id: idY, sort: final, reason: 'Minor for the build.' }] }) }),   // the closing word is given at layer 3's pass-6 verdict too: with nothing left that holds the plan the final read may reuse this read (no call), and a reused read's sorting counts
    ...(final === null ? {} : { 'final-read-top-gamma': meetsOf({ sorting: [{ id: idY, sort: final, reason: 'Minor for the build.' }] }) }),
  };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return hit(script[label]);
    return hit(label.startsWith('panel-') || label.startsWith('final-read-') ? meetsOf() : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.');
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-s17-l3-retag', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: writer, reviser: writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s17-l3', log: () => {}, config }); } catch (e) { error = e; }
  return { result, error, served };
}
const recordOf = r => r.result ?? r.error?.partial;   // a swapped run may not end (the objection stays open and the round limit stops it): the stop carries the record so far
const retagOf = r => (recordOf(r)?.severityRun?.retags || []).find(x => x.id === idY);

test('T21aj (layer 3): the seat\'s withdrawal of a block rated 5.0 is refused (the quote is not in the revised draft); then layer 3 re-tags it below 4 in pass 6, giving the seat\'s reason as the reason: the re-tag is recorded (pass, old, new, who, reason) and the objection is settled', async () => {
  const RATE = 5;
  const TO = 3;
  const CLEARED_BY = 'retag';   // the route a re-tag below 4 clears an objection by (an objection once rated 7 or above is not cleared by it)
  const r = await run({ rate: RATE, to: TO, final: null });
  const reply = (recordOf(r)?.answerBackReplies || []).find(x => x.lab === 'mid-beta' && x.round === 4 && x.id === idY);
  assert.equal(reply?.effect, 'withdrawal_refused', `premise: the pass-4 withdrawal was refused (the run ended with: ${String(r.error)}; labels ${r.served.filter(l => /^(rule|panel-[456])/.test(l)).join(',')})`);
  const rt = retagOf(r);
  assert.deepEqual([rt?.pass, rt?.from, rt?.to, rt?.by, rt?.reason, rt?.cleared_by], [6, RATE, TO, 'layer3', REASON, CLEARED_BY], 'T21aj: the re-tag by layer 3 is recorded (pass, old, new, who, reason) and is the route it cleared by');
  assert.deepEqual([recordOf(r)?.severityRun?.computed, Array.isArray(recordOf(r)?.severityRun?.open)], [true, true], 'T21aj: the record read is the computed end of the run (an array of open objections), not the stopped-before-a-pass shape');
  assert.equal((recordOf(r)?.severityRun?.open || []).some(o => o.id === idY), false, 'T21aj: settled: it holds nothing and is not open at the end');
});

test('T21ak (layer 3, folded into the same run): a block raised at 8.0 and re-tagged to 3.0 by layer 3 in pass 6, then sorted may-leave at the final read, stays open on the record rated 3.0 and shown as re-tagged: the final read does not close it', async () => {
  const RATE = 8;
  const TO = 3;
  const r = await run({ rate: RATE, to: TO, final: 'may_leave' });
  const reply = (r.result?.answerBackReplies || []).find(x => x.lab === 'mid-beta' && x.round === 4 && x.id === idY);
  assert.equal(reply?.effect, 'withdrawal_refused', `premise: the pass-4 withdrawal was refused (the run ended with: ${String(r.error)}; labels ${r.served.filter(l => /^(rule|panel-[456]|final)/.test(l)).join(',')})`);
  const top = [...(r.result?.finalRead?.seats || []), ...(r.result?.finalRead?.reused || [])].find(e => e.lab === 'top-gamma');   // asked at the final read, or its pass-6 read reused
  assert.deepEqual((top?.sorting || []).map(x => [x.id, x.sort]), [[idY, 'may_leave']], 'premise: layer 3\'s closing word on the block is may-leave (given at the final read, or at the pass-6 read the final read reused)');
  const e = (r.result?.dispute?.open_objections || []).find(o => o.id === idY);
  assert.ok(e && !('closed_by' in e), 'T21ak: open on the record, not closed by the final read');
  assert.equal(e.severity, TO, 'rated 3.0 now');
  const rt = retagOf(r);
  assert.deepEqual([rt?.pass, rt?.from, rt?.to, rt?.by], [6, RATE, TO, 'layer3'], 'shown as re-tagged: pass, old, new, who');
  assert.deepEqual([(r.result?.severityRun?.open || []).some(o => o.id === idY), (r.result?.severityRun?.swept || []).some(o => o.id === idY)], [true, false], 'open_at_end, not swept (Q3)');
});
