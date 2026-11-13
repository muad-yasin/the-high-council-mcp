// 0.8.4 S4b (M1), U3-4: the ENDING EXCHANGE in a run (CA6, Q8 item 2, D19, Q1(g), Q4(d); T22ab, T15o, T17w, and the guards T15r / T17k / T17ah). Offline, mock seats, $0; W26 and the rating demand are HELD words, so every run injects them (test/held-prompts/held-084-b.js,
// test/helpers/rating-demand.js) except the HELD row, which pins zero ending calls and no record. WRITTEN WITHOUT A RUN (overnight, no box): the first run on the box decides; the fixtures are the T22e / T22z ones of test/layer-rule-rows.test.js (a `mock-exch-new7-*` seat names a
// defect on its 7th ask, which is the 7th round of the pass's exchange: not debated, carried), with maxRounds 1 so that the run ends at the round cap with that objection still not debated.
// Guarded imports: a namespace import of chain.js is not needed; everything is read from the result, so on a tree without the feature each row fails by assertion and the file still loads.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const W26 = { lateFindingRule: HB084.lateFindingRule, lastRoundReplyRule: HB084.lastRoundReplyRule };
const HELD = { ...DEMAND, ...W26 };
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'ending-exchange', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const PLAN = '# Plan\n\nThe worker retries failed requests at most three times. Bake a cake. Sell it at the fair.';
const go = async (config, { held = HELD, scripted = {} } = {}) => {
  const lines = []; const prompts = new Map(); setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest(held);
  setCache({ invalidate() {}, get: label => (label in scripted ? { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 30, output: 30 }, usd: 0 } : null) });
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-ending-exchange', config });
  return { r, log: lines.join('\n'), prompts };
};
const labels = r => r.stages.map(s => s.label);
const endCalls = r => labels(r).filter(l => /^(ldebate|lreply)-end/.test(l));
// layer 1: e1 (an objection rated 3), e2 (`alt`: its stance flips on every ask, so the exchange never converges and runs all seven rounds; steady support would end it at round 2 and e3 would never be asked a 7th time), e3 (names a defect on its 7th ask); layer 2: a critic that objects, so the run does not sign off and ends at the round cap
// `tag`: a model-name suffix per run. The mock `new7` counts its asks per MODEL STRING for the life of the process, and the rows of this file share one process, so every run gets its own string (the minted id does not depend on the model, only on the seat, criterion and quote).
const FIX = (extra = {}, tag = 'a') => chainOf([seat(`mock-exch-support-keep-sev3-${tag}`, 'e1', 1), seat(`mock-exch-alt-keep-${tag}-clean`, 'e2', 1), seat(`mock-exch-new7-keep-${tag}-clean`, 'e3', 1), seat('mock-critic-x', 'e9', 2)], extra);
const mintedOf = r => r.layerDebates[0].objections.find(o => o.from_exchange && o.added_round === 3);

test('T22ab: at the round cap the ending exchange debates the layer-1 objection still not_debated: the other layer-1 judges post on it in calls labelled ldebate-end-*, the record says ran, and it is no longer not_debated', async () => {
  const { r } = await go(FIX({}, 'ab1'), { scripted: { build: PLAN } });
  const minted = mintedOf(r);
  assert.deepEqual([minted?.raised_by, minted?.outcome], ['e3', 'not_debated'], 'the premise (T22e): e3 named a defect in the 3rd round of the pass, not debated, carried');
  assert.ok(endCalls(r).some(l => /^ldebate-end-e1/.test(l)) && endCalls(r).some(l => /^ldebate-end-e2/.test(l)), 'e1 and e2 were asked about it: ' + endCalls(r).join(', '));
  assert.deepEqual([r.endingExchange?.ran, r.endingExchange?.trigger, r.endingExchange?.ending], [true, 'round_cap', true]);
  const row = r.endingExchange.objections.find(o => o.id === minted.id);
  assert.notEqual(row?.outcome, 'not_debated', 'debated at the end (it drew posts)');
  assert.equal(r.passed, false); assert.equal(r.lateFindings, undefined, 'no late finding: the mock names no defect in the last round of the ending exchange (its `new7` fires on its second and third ask, which were in the pass)');
});

// REMOVED (0.8.4 apply, recorded state): the row 'HELD: with W26 not recorded the same run asks no ending call and writes no ending_exchange' proved the held state of lateFindingRule, which is recorded (src/ending-exchange-prompts.js:10 endingExchangeOn). Its sibling in this file, T22ab, already asserts the recorded state on the same path (ending calls labelled ldebate-end-*, the record says ran).

test('T15o: in the ending exchange a withdrawal that names a passage found only in the plan as it stands closes the objection (the quote is checked against the CURRENT text); the plan is not changed and the severity record agrees (the withdrawal is on it, how exchange, cleared by withdrawal)', async () => {
  const probe = await go(FIX({}, 'p15'), { scripted: { build: PLAN } });
  const id = mintedOf(probe.r).id;
  const { r } = await go(FIX({}, 'm15'), { scripted: {
    build: PLAN,
    'ldebate-end-e1': JSON.stringify({ posts: [{ on: id, stance: 'contest', text: 'The plan already covers it.', quote: 'retries failed requests' }] }),
    'lreply-end-e3': JSON.stringify({ replies: [{ id, action: 'withdraw', text: 'The passage answers it.', quote: 'retries failed requests at most three times' }] }),
  } });
  const row = r.endingExchange.objections.find(o => o.id === id);
  assert.equal(row.outcome, 'withdrawn_argued');
  assert.ok(r.deliverable.includes(PLAN.split('\n\n')[1]), 'the plan text is not changed by the exchange');
  assert.ok(r.severityRun.withdrawn.some(w => w.id === id && w.how === 'exchange' && w.cleared_by === 'withdrawal'), 'the severity record agrees');
});

test('T17w (Q-i3 / Q4(d)): with fewer than two layer-1 judges heard in the last pass that asked layer 1, the ending exchange does NOT run: no ending call, a not-run record, the objection stays flagged not_debated, never claimed debated', async () => {
  const bad = lab => ({ [`panel-2-${lab}`]: 'not a verdict', [`panel-2-${lab}-reask1`]: 'not a verdict', [`panel-2-${lab}-reask2`]: 'not a verdict', [`panel-2-${lab}-solo`]: 'not a verdict' });   // CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask', 10 Nov 2026). OLD bar: a judge garbled on its ask and both re-asks stayed silent. NEW bar: it also stays silent on the solo ask (label panel-<pass>-<seat>-solo), the one more call a silent judge gets; without that the mock answered it and the judge was heard, so the exchange had no one to run for.
  const { r } = await go(FIX({ maxRounds: 2 }, 'w17'), { scripted: { build: PLAN, ...bad('e2'), ...bad('e3') } });
  assert.deepEqual(endCalls(r), [], 'no call: the exchange needs two heard judges');
  assert.deepEqual([r.endingExchange?.ran, r.endingExchange?.not_run, r.endingExchange?.trigger], [false, 'fewer_than_two_heard', 'round_cap']);
  assert.ok(r.endingExchange.objections.every(o => o.outcome === 'not_debated'), 'flagged, never claimed debated');
});

test('T15r / T17k / T17ah (PIN, limit: the premise is an agreed run with an objection still not_debated; these rows cannot show that no lower seat is ASKED beyond the absence of ending calls): after a layer-3 sign-off no ending exchange runs', async () => {
  const first = 'It adds no scope the request did not ask for.';   // the T22z fixture: e3 names a defect rated 3.0 in the last (3rd) round of the pass (not debated, carried), layer 1 otherwise signs off, layers 2 and 3 sign off
  const chain = chainOf([seat('mock-exch-support-keep-sev3-g15', 'e1', 1), seat('mock-exch-alt-keep-g15-clean', 'e2', 1), seat('mock-exch-support-keep-clean', 'e3', 1), seat('mock-exch-support-keep-clean', 'e9', 2), seat('mock-exch-support-keep-clean', 'e10', 3)], { maxRounds: 2 });
  const { r } = await go(chain, { scripted: { build: PLAN, 'ldebate-1-x2-e3': JSON.stringify({ posts: [], new_objections: [{ criterion: first, problem: 'The plan names a deliverable nobody asked for in round two.', quote: 'A passage that round two names.', severity: 3 }] }), 'ldebate-1-x3-e3': JSON.stringify({ posts: [], new_objections: [{ criterion: first, problem: 'The plan names a second deliverable nobody asked for.', severity: 3 }] }) } });   // round 2 names one (the progress that earns round 3, the last the layer-1 exchange allows: it was round 7), round 3 the rated one
  assert.ok(r.layerDebates[0].objections.some(o => o.from_exchange && o.added_round === 3 && o.outcome === 'not_debated'), 'the premise: an objection still not debated');
  assert.equal(r.passed, true, 'the premise: every layer signed off');
  assert.deepEqual(endCalls(r), []);
  assert.equal(r.endingExchange, undefined);
});

test('T22a / T22v / T22b / T22w / T22f (in a run): a late_finding named by a judge in the seventh round of the ending exchange is recorded under an L- id; the rating 8.5 is kept; the rating 11 is refused, the finding kept unrated and read as 4 or above; no objection is minted; the seventh round was asked with W26 and the first round was not', async () => {
  const CRIT = 'The plan defines a retry limit.';
  const late = JSON.stringify({ posts: [], late_finding: [
    { criterion: CRIT, problem: 'The delay between retries is unbounded.', quote: 'at most three times', rating: 8.5 },
    { criterion: CRIT, problem: 'A rating the scale refuses.', quote: 'at most three times', rating: 11 },
  ] });
  const { r, prompts } = await go(FIX({}, 'lf1'), { scripted: { build: PLAN, 'ldebate-end-x7-e1': late } });
  assert.equal(r.endingExchange?.ran, true, 'the premise: the ending exchange ran');
  assert.deepEqual(r.lateFindings?.map(l => [l.lab, l.problem, l.rating, l.rating_read_as, l.not_debated, l.found, l.round, l.flags]), [
    ['e1', 'The delay between retries is unbounded.', 8.5, undefined, true, 'ending_exchange_last_round', 7, []],
    ['e1', 'A rating the scale refuses.', null, '4 or above', true, 'ending_exchange_last_round', 7, []],
  ]);
  assert.ok(r.lateFindings.every(l => /^L-[0-9a-f]{8}$/.test(l.id)), 'an L- id each');
  assert.equal(typeof r.lateFindings[1].rating_refused, 'string', 'T22b: the refusal reason is kept');
  const lateTexts = new Set(['The delay between retries is unbounded.', 'A rating the scale refuses.']);   // by TEXT, not by id: an objection minted by mistake would carry an O- id
  assert.deepEqual(r.endingExchange.objections.filter(o => lateTexts.has(o.problem)), [], 'nothing was minted: a late finding is not an objection (ending record)');
  assert.deepEqual(r.layerDebates.flatMap(d => d.objections || []).filter(o => lateTexts.has(o.problem)), [], 'nor in the pass records');
  assert.equal(r.layerDebates.flatMap(d => d.new_objections || []).filter(o => lateTexts.has(o.problem)).length, 0, 'nor as a new objection');
  assert.ok(prompts.get('ldebate-end-x7-e1')?.includes(HB084.lateFindingRule()), 'T22f: the seventh round carries W26');
  assert.equal(prompts.get('ldebate-end-e1')?.includes(HB084.lateFindingRule()), false, 'the first round of the ending exchange does not');
  assert.equal(r.passed, false);
});

test('C&C item 2: the last round\'s prompts are composed once, at the START of the run, before any call: a recorded W26 that cannot compose stops the run with nothing asked', async () => {
  const asked = [];
  setHeldForTest({ ...DEMAND, lateFindingRule: () => { throw new Error('w26 cannot compose'); }, lastRoundReplyRule: HB084.lastRoundReplyRule });
  setCache({ invalidate() {}, get: label => { asked.push(label); return null; } });
  await assert.rejects(runChain({ request: 'A mock task.', log() {}, runId: 'r-start-check', config: FIX({}, 'sc1') }), /w26 cannot compose/);
  assert.deepEqual(asked, [], 'no stage was asked: the check ran before the first paid call');
});

test('T22d: a defect named in round 3 of the ending exchange (criterion, passage and rating given) is minted as that judge\'s own objection and debated in round 4 (W1 applies: the recorded sentence, not W26); it is not recorded as a late finding', async () => {
  const body = JSON.stringify({ posts: [], new_objections: [{ criterion: 'It adds no scope the request did not ask for.', problem: 'The delay between retries is unbounded.', quote: 'at most three times', severity: 6 }] });   // the criterion of the proven mints (T22e, T22z, the guard row)
  const { r, prompts } = await go(FIX({}, 'd3'), { scripted: { build: PLAN, 'ldebate-end-x3-e1': body } });
  assert.equal(r.endingExchange?.ran, true, 'the premise: the ending exchange ran');
  const row = r.endingExchange.objections.find(o => o.problem === 'The delay between retries is unbounded.');
  assert.deepEqual([row?.raised_by, row?.from_exchange, row?.added_round, row?.severity], ['e1', true, 3, 6], 'minted as the finder\'s own objection, in round 3, with its rating');
  assert.notEqual(row.outcome, 'not_debated', 'it was debated in a round after the one that named it');
  assert.ok(prompts.get('ldebate-end-x4-e2')?.includes(row.id), 'round 4 shows it to the other judges');
  assert.equal(prompts.get('ldebate-end-x3-e1')?.includes(HB084.lateFindingRule()), false, 'round 3 is asked with the recorded sentence (W1), not W26');
  assert.equal(r.lateFindings, undefined, 'a defect named before the last round is not a late finding');
});

// ---- T17aq (S16 fix round): a late finding of the ending exchange, sorted by layer 3 at the final read
test('T17aq (run; the last clause, no handler check, is a NAMED PIN: nothing in this fixture can ask one): a late finding from round 7 of the ending exchange, sorted must-do by layer 3 at the final read with the reason that its defect holds, is a build obligation under layer 3\'s sorting on the build list (HANDOFF), and no build check is asked at this ending', async () => {
  const CRIT = 'The plan defines a retry limit.'; const PROBLEM = 'The delay between retries is unbounded.'; const REASON = 'The defect holds: the plan sets no upper bound on the delay between retries.';
  const late = JSON.stringify({ posts: [], late_finding: [{ criterion: CRIT, problem: PROBLEM, quote: 'at most three times', rating: 8.5 }] });
  const read = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRIT, verdict: 'MET', evidence: 'Section one sets the limit.' }], failures: [], verdict_line: 'ok', sorting });
  const fixture = tag => chainOf([seat(`mock-exch-support-keep-sev3-${tag}`, 'e1', 1), seat(`mock-exch-alt-keep-${tag}-clean`, 'e2', 1), seat(`mock-exch-new7-keep-${tag}-clean`, 'e3', 1), seat('mock-critic-x', 'e9', 2), seat('mock-critic-x', 'lc', 3)], { answer_back: { enabled: true }, handoff: true });
  const held = { ...SORTING, ...W26 }; const base = { build: PLAN, 'ldebate-end-x7-e1': late, handoff: '# Handoff\n\nBuild the plan.' };
  const probe = await go(fixture('aq1p'), { held, scripted: { ...base, 'final-read-lc': read([]) } });
  const lateId = probe.r.lateFindings?.find(l => l.problem === PROBLEM)?.id ?? 'no-late-id';
  const main = await go(fixture('aq1r'), { held, scripted: { ...base, 'final-read-lc': read([{ id: lateId, sort: 'must_do', reason: REASON, criterion: CRIT }]) } });
  const row = main.r.lateFindings?.find(l => l.problem === PROBLEM);
  const line = (main.r.handoff ?? '').split('\n').find(l => l.startsWith(`- ${lateId} (`)) ?? '';
  assert.deepEqual([row?.sorted?.sort, row?.sorted?.seats, row?.sorted?.reasons?.map(x => x.reason)], ['must_do', ['lc'], [REASON]], `T17aq: layer 3's sorting is on late finding ${lateId}; asked: ${labels(main.r).filter(l => l.startsWith('final-read-')).join(', ')}`);
  assert.deepEqual([row?.id, row?.found, row?.round, row?.rating, row?.not_debated], [lateId, 'ending_exchange_last_round', 7, 8.5, true], 'premise: found in round 7 of the ending exchange');
  assert.deepEqual([main.r.endingExchange?.ran, main.r.passed, main.r.finalRead?.ran, main.r.finalRead?.run_end], [true, false, true, 'not_agreed'], 'premise: ending exchange, then a not-agreed final read');
  assert.deepEqual(labels(main.r).filter(l => l.startsWith('final-read-')), ['final-read-lc']);
  assert.equal(main.r.finalRead?.sorting?.find(c => c.id === lateId)?.sort, 'must_do', 'the combined sorting says must-do');
  assert.match(line, new RegExp(`^- ${lateId} \\(e1; rating 8\\.5; sorted by layer 3: must-do\\): `), 'the build list marks it must-do');
  assert.ok(line.includes(`Layer 3's reason: ${REASON}`), 'with layer 3\'s reason');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'A finding layer 3 sorted must-do is one to do'. NEW: 'A finding layer 3 sorted must-do is required of the build; its line gives layer 3\'s reason.' WHY: the late-findings section of the handoff (src/late-finding.js:94), the resolved text of the row (RESOLVED_LIST).
  assert.ok((main.r.handoff ?? '').includes('A finding layer 3 sorted must-do is required of the build; its line gives layer 3\'s reason.'), 'the section says a must-do is required of the build');
  assert.deepEqual(labels(main.r).filter(l => /^build-check/.test(l)), [], 'PIN: no build-check stage');
  assert.equal(main.r.ending, undefined, 'PIN: no ending record of a layer-3 sign-off or handler check');
});
