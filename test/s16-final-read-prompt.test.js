// 0.8.4 S16 (G2a; Q9, W31, W32; T21ao, T17y, T21af): the final read's OWN prompt. HELD: nothing changes while `finalReadRule` / `finalReadSortingForm` / `finalReadSortingItems` / `lateFindingRatingSentence` are not recorded (the first row pins the W7 state byte for byte).
// With them injected (test data, test/held-prompts/held-084-s16.js): W7's two closing-read clauses are cut from the final read's system text and its reply form stands in place of S8's; each seat's user prompt carries W31's clause for the seat and ITS list (marked new, what it sorted before); W32's rating sentence is in every layer-3 read that carries W7 and the climb reads that rating.
// The `concern` field has no reader yet (I): the batch must not be recorded before it has one. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { finalReadSystemFor } from '../src/stage-system.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION, idOf } from './helpers/layer-two-run.js';
import { objectionId } from '../src/objection-ids.js';
import { W31 } from './helpers/w31-held.js';
import { S9 } from './helpers/proposer-return-fixture.js';
import { criticPromptFor, settingsOf } from '../src/stage-system.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting });
const LC_FAILURE = { criterion: CRITERION, problem: 'No back-off is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5 };
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: lc's stub failure carried no relation. NEW: it carries relation 'new' at pass 1 and `continues <id>` when lc raises it again at pass 2. WHY: relationRule is recorded (NS-0193).
const lcObjects = (sorting, relation = 'new') => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ ...LC_FAILURE, relation }], verdict_line: 'no', ...(sorting ? { sorting } : {}) });
const idLC = objectionId('lc', LC_FAILURE);
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const config = () => ({ name: 'fixture', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds: 1, seats: { builder: seatOf(['writer']), reviser: seatOf(['writer']), critics: L3.map(seatOf) } });

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'HELD (the W7 state, pin): the final read's system text still carries W7's closing-read clauses and S8's form, with no W32 sentence' sat here. NEW: removed; its sibling 'W31 (system text)' below asserts the recorded state of the same text (the two clauses cut, the final read's own reply form, W32's rating sentence once). WHY: finalReadRule, finalReadSortingForm and lateFindingRatingSentence are recorded (src/prompts/recorded-084-s16.js, W31 and W32), so no shipped final read carries W7's closing-read clauses.
test('W31 (system text): the two closing-read clauses of W7 are cut, the final read\'s own reply form stands, and W32\'s rating sentence follows W7\'s sentence on an unanchored failure exactly once', () => {
  setHeldForTest({ ...SORTING, ...W31 });
  const sys = finalReadSystemFor(seatOf(['lc', 3]), config());
  assert.doesNotMatch(sys, /at a closing read, state your position/);
  assert.doesNotMatch(sys, /At a closing read, if you find a new material defect/);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: /You need not list an objection you raise in this reply: it counts as your must-do\./. NEW: the two recorded sentences. WHY: finalReadSortingForm now reads "An objection you raise in this reply already counts as your must-do. You need not add a sorting entry for it." (src/prompts/recorded-084-s16.js, WORDING W31).
  assert.match(sys, /An objection you raise in this reply already counts as your must-do\. You need not add a sorting entry for it\./);
  assert.doesNotMatch(sys, /an entry with no id and no quote is not recorded/);
  assert.equal(sys.split('it is recorded as a late finding. Give it a rating from 1 to 10; it is recorded with its rating and is not debated.').length - 1, 1);
});

test('W32 at the climb (system text): the rating sentence is in the climb verdict\'s W7 as well, and the closing-read clauses stay there', async () => {
  setHeldForTest({ ...SORTING, ...W31 });
  const { prompts } = await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'panel-1-la': MET }, extra: { maxRounds: 2 } });   // scenario installs its own prompt spy and returns the prompts
  const climb = prompts.get('panel-1-lc');
  assert.ok(climb, 'premise: lc was asked at the climb');
  assert.match(climb.system, /it is recorded as a late finding\. Give it a rating from 1 to 10;/);
  assert.match(climb.system, /\(at a closing read, state your position on the plan/);
});

async function run(held, lcRows) {
  setHeldForTest(held);
  setOutboundScan({ finish: true });
  try {
    return await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'panel-1-la': MET, 'panel-1-lc': lcObjects(), 'panel-2-lc': lcObjects(lcRows, `continues ${idLC}`), 'panel-2-ld': metWith([{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }]), 'final-read-lc': MET, 'final-read-ld': MET }, extra: {}, cutLabels: ['revise-2'] });
  } finally { setOutboundScan({}); }
}
const NEW_DEFECT = { sort: 'must_do', reason: 'No timeout is stated anywhere.', criterion: CRITERION, quote: 'retries failed requests', rating: 6 };   // a quote, so the climb keeps it as a new defect (an id-less entry without one is ignored at the climb)

test('T21ao: a seat that read exactly this text and is called again because a defect was opened after its last sorting gets the clause "you read exactly this text before", the new item marked new, and its earlier sorting shown; it is not told it has not read this text', async () => {
  const r = await run({ ...SORTING, ...W31 }, [{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }, NEW_DEFECT]);
  assert.deepEqual(r.result.finalRead.seats.map(e => [e.lab, e.last_read_sha === r.result.finalRead.final_sha]), [['ld', true]], 'premise: only ld is asked, and it read this exact text');
  const user = r.prompts.get('final-read-ld').user;
  assert.match(user, /This is the final text of the run\. You read exactly this text before, and the objections and late findings marked new below were opened after your last sorting;/);
  assert.doesNotMatch(user, /You have not read exactly this text before/);
  assert.match(user, /late finding; (rated 6\.0|not rated, read as 4 or above)[^)]*; marked new\): /, 'the defect lc named is marked new');
  assert.match(user, new RegExp(`- ${idLC} \\([^)]*; you sorted it before: may-leave\\): `), 'ld\'s earlier sorting of the objection is shown');
  assert.match(user, /Your earlier reason: <critic-claim>Minor for the build\.<\/critic-claim>/);
});

test('W31 (user text): a seat that never read this text gets the other clause and the plain list (nothing marked new, nothing sorted before)', async () => {
  setHeldForTest({ ...SORTING, ...W31 });
  setOutboundScan({ finish: true });
  let r; try { r = await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'final-read-lc': MET, 'final-read-ld': MET }, extra: {}, cutLabels: ['revise-1'] }); } finally { setOutboundScan({}); }
  const user = r.prompts.get('final-read-lc').user;
  assert.match(user, /This is the final text of the run\. You have not read exactly this text before\. Below are the open objections and the late findings,/);
  assert.doesNotMatch(user, /; marked new|; you sorted it before:/);   // the list line's own markers (the clause itself says "if you sorted it before")
  assert.match(user, new RegExp(`- ${idOf(5)} \\(raised in layer 1; rated 5\\.0`));
});

test('W32 at the climb (reader): a new defect a top seat names at its LAST verdict carries the seat\'s rating once W32 is recorded', async () => {
  const withW32 = await run({ ...SORTING, ...W31 }, [{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: CRITERION }, { ...NEW_DEFECT, quote: 'a passage the plan does not hold' }]);
  const f = (withW32.result.lateFindings ?? []).find(x => x.found === 'last_verdict');
  assert.equal(f?.rating, 6);
  // REMOVED (0.8.4 apply, K7): job 12 row 'W32 at the climb (reader)', the `without` half (the row title's 'without it the rating is not read' no longer has a half behind it). OLD: ran the same scenario with the map SORTING alone (no W31 group) and asserted the late finding's rating is null. WHY: error '6 !== null' at the last assert.equal: lateFindingRatingSentence and the other three W31/W32 words are RECORDED, so a map that leaves them out falls through to the recorded text (src/held-roles.js:15) and the rating IS read (readSorting opts.finalRead, ratingBitsOf, src/sorting.js); the held-off state cannot be recreated (undefined is banned for 0.8.4 names; finalReadWordsOn has no config term). Sibling: the `withW32` half just above (f?.rating === 6, the recorded state), in this same row.
});

test('S9 interplay (system text): with the S9 words recorded and a chain with NO proposer seat (W29(i) in place of W7\'s route clause), W31\'s cuts and W32\'s anchor are each found once in the final read\'s system text and in the climb\'s; no throw', () => {
  setHeldForTest({ ...SORTING, ...S9, ...W31 });
  for (const proposers of [false, true]) {
    const cfg = { ...config(), decisions: { enabled: true }, seats: { ...config().seats, ...(proposers ? { proposers: [{ provider: 'mock', model: 'mock-proposer', lab: 'prop-0', maxTokens: 3000 }] } : {}) } };
    const fin = finalReadSystemFor(seatOf(['lc', 3]), cfg);
    const climb = criticPromptFor(seatOf(['lc', 3]), settingsOf(cfg).open, {}, cfg, true);
    for (const [name, sys] of [['final read', fin], ['climb', climb]]) assert.equal(sys.split('Give it a rating from 1 to 10; it is recorded with its rating and is not debated.').length - 1, 1, `${name}, proposers ${proposers}: W32 once`);
    assert.doesNotMatch(fin, /at a closing read, state your position|At a closing read, if you find a new material defect/);
    assert.match(climb, /at a closing read, state your position/);
  }
});
