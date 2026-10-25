// 0.8.3 E84 (ROADMAP 84, Muad's decision "SILENT PASS ON AN OWN OBJECTION"; gate page Review/Build_0.8.3/m6-closing/E84_Gate_Page.md): on a LAYERED chain with answer_back a judge that is silent on an objection of its own is asked ONCE, explicitly, inside the round,
// and is shown what the other judges of its layer wrote about the same criterion; a withdrawal may quote the draft OR one of those rows. A second silence is carried exactly as E3 carried it (stated_pass_open / unanswered), and the carried
// row says whether the ask happened (`ask`). The two new sentences are HELD (test/held-prompts/held-083.js): the door tests inject them with setHeldForTest. $0, offline; every reply comes from a label-keyed cache.
//   Layer 1 = la, lb unless a test says otherwise. Round 1: la objects (F_A), lb signs off with evidence EV. Round 2: la is silent on F_A (a stated pass, or a sign-off with no answers), lb signs off with EV.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget, BudgetExceeded } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { HELD_OFF, withHeldOff } from './helpers/held-off.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRITERION = 'The plan defines a retry limit.';
const F_A = { criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.' };
const F_A2 = { criterion: CRITERION, problem: 'Layer one: the retry limit has no owner.', fix: 'Name one.', quote: 'retries failed requests' };
const F_LB = { criterion: CRITERION, problem: 'The retry limit has no unit.', fix: 'Give it a unit.' };
const ID_A = objectionId('la', F_A);
const ID_A2 = objectionId('la', F_A2);
const DRAFT = 'The worker retries failed requests.';
const QUOTE = '`The worker retries failed requests.`';
const EV = 'Section two sets the retry limit to five attempts.'; // what lb wrote in its MET row: nowhere in the draft
const EV_LA = 'Checked the limit against section two.';
const BLOCK = '# What other reviewers wrote about the criteria you objected to';
const STATED = 'You declined to give a verdict';
const signoff = (ev, extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: ev }], failures: [], verdict_line: 'ok', ...extra });
const objecting = (f, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no', ...extra });
const PASS = (extra = {}) => JSON.stringify({ pass: true, pass_reason: 'I would rather not judge this round.', ...extra });
const withdraw = (id, quote) => ({ answers: [{ id, status: 'withdrawn', evidence: quote }] });
const peerQuote = `\`${EV}\``;
const ASKS = ['asked', 'reask_spent', 'own_verdict_objects', 'layer_objected', 'words_not_recorded', 'run_stopped'];
const WORDS = { criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock };

async function run(replies, { maxRounds = 6, critics = ['la', 'lb'], layers = [1, 1], extra = {}, stages = null, words = true, budget = null, models = {}, miss = () => false } = {}) {
// CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026; X16' scope run on the box). OLD: the helper's `words: false` case set NO override, which meant "the held words are not recorded". NEW: it sets the explicit off map (test/helpers/held-off.js), so the door test still proves the off path once src/roles.js records the words; the map behaves the same today.
// CHANGED ACCEPTED TEST (decider-readiness part (i) fix-up, 24 Okt 2026; the X16'' scope run read 23 failures, not the predicted 19). OLD: the helper's `words: true` case injected the PARTIAL map, so every other held name fell through to src/roles.js once it records them. NEW: the map is merged over the explicit off state (withHeldOff), so only the names the test injects are on. WHY: setHeldForTest replaces the whole map; a door test must say which words are on and keep the rest off. This test was passing and is changed for the bug class, not for a failure. The map behaves the same today.
  setHeldForTest(words ? withHeldOff(WORDS) : HELD_OFF);
  setBudget(budget);
  const hashes = new Map(); const prompts = new Map(); const served = []; const stale = []; const logs = [];
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  setCache({ invalidate: label => stale.push(label), get(label) {
    if (miss(label)) return null;
    if (stages?.has(label)) return stages.get(label);
    served.push(label);
    const text = label.startsWith('panel-') ? (replies(label) ?? signoff(EV)) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: models[lab] ?? 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }) });
  const config = {
    name: 'fixture-e84', criteria: [CRITERION], maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true }, ...extra,
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: critics.map((lab, i) => seat(lab, layers[i])) },
  };
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-e84', log: l => logs.push(l), config });
  // The invariant of the ask field (C&C condition 1): on a layered chain EVERY row carried for want of an answer says whether the judge was asked.
  if (layers.some(l => l !== undefined)) for (const x of r.answerBackReplies || []) if (x.effect === 'stated_pass_open' || x.effect === 'unanswered') assert.ok(ASKS.includes(x.ask), `a carried row has its ask: ${JSON.stringify(x)}`);
  return { r, prompts, served, stale, logs, config };
}
// Round 1 for every scenario: la objects, lb signs off with evidence.
const round1 = label => (label === 'panel-1-la' ? objecting(F_A) : label === 'panel-1-lb' ? signoff(EV) : undefined);
const rowsOf = (r, lab, round) => r.answerBackReplies.filter(x => x.lab === lab && x.round === round);

test('E84 T1: a stated pass that holds an open objection is asked ONCE, shown the other judge\'s MET row, and a withdrawal quoting that row closes it (the record names whose row)', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, peerQuote)) : undefined);
  const { r, prompts, served } = await run(replies);
  assert.deepEqual(served.filter(l => l.startsWith('panel-2')), ['panel-2-la', 'panel-2-lb', 'panel-2-la-reask1'], 'the first asks, then ONE re-ask of the silent judge only');
  assert.equal(prompts.get('panel-2-la').includes(BLOCK), false, 'blind first: the first ask shows no other judge\'s text');
  const p = prompts.get('panel-2-la-reask1');
  assert.ok(p.includes(STATED), 'the re-ask says the judge declined to give a verdict');
  assert.ok(p.includes('from the draft or from an entry below'), 'and that an entry below may be quoted');
  assert.ok(p.includes(BLOCK) && p.includes(`Criterion 1: ${CRITERION}`) && p.includes('lab="Reviewer A" criterion="1"') && p.includes(EV), 'the other judge\'s MET row for the same criterion is shown, anonymised');
  assert.deepEqual(rowsOf(r, 'la', 2), [{ round: 2, lab: 'la', id: ID_A, status: 'withdrawn', quoted: true, effect: 'withdrawn', quoted_from: 'reviewer', quoted_ref: 'lb', quoted_layer: 1 }]);
  assert.equal(r.passed, true, 'the objection closed on a peer row; every judge signed off');
  assert.equal(r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la').reasked, true);
});

test('E84 a quote from the DRAFT still closes it and carries no quoted_from; a quote that is in no row and not in the draft is refused and carried', async () => {
  const viaDraft = await run(label => round1(label) ?? (label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, QUOTE)) : undefined));
  assert.deepEqual(rowsOf(viaDraft.r, 'la', 2), [{ round: 2, lab: 'la', id: ID_A, status: 'withdrawn', quoted: true, effect: 'withdrawn' }], 'a draft quote is recorded exactly as before E84');
  const nowhere = await run(label => round1(label) ?? (label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, '`a sentence that is written nowhere at all`')) : undefined), { maxRounds: 2 });
  assert.deepEqual(rowsOf(nowhere.r, 'la', 2).map(x => x.effect), ['withdrawal_refused']);
  assert.equal(nowhere.r.passed, false);
});

test('E84 the cap: a row is shown and checked only up to PEER_ROW_MAX_CHARS (600): a quote beyond it is refused, one inside it counts', async () => {
  const LONG = `${'Alpha '.repeat(100)}omega-marker-text-beyond-the-cap`; // 600 characters of "Alpha " then the marker
  const base = withdrawal => label => (label === 'panel-1-la' ? objecting(F_A) : label === 'panel-1-lb' || label === 'panel-2-lb' ? signoff(LONG) : label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, withdrawal)) : undefined);
  const beyond = await run(base('`omega-marker-text-beyond-the-cap`'), { maxRounds: 2 });
  assert.equal(beyond.prompts.get('panel-2-la-reask1').includes('omega-marker'), false, 'the shown text is capped');
  assert.deepEqual(rowsOf(beyond.r, 'la', 2).map(x => x.effect), ['withdrawal_refused']);
  const inside = await run(base('`Alpha Alpha Alpha Alpha`'), { maxRounds: 2 });
  assert.deepEqual(rowsOf(inside.r, 'la', 2).map(x => [x.effect, x.quoted_from]), [['withdrawn', 'reviewer']]);
});

test('E84 second silence (and the round cap): a judge that is silent twice is carried as stated_pass_open, asked exactly once per round, and the run ends at the cap with a readable not-agreed state, not a loop', async () => {
  const replies = label => round1(label) ?? (/^panel-\d-la/.test(label) ? PASS() : undefined);
  const { r, served, logs } = await run(replies, { maxRounds: 3 });
  for (const n of [2, 3]) assert.deepEqual(served.filter(l => l.startsWith(`panel-${n}-`)), [`panel-${n}-la`, `panel-${n}-lb`, `panel-${n}-la-reask1`], `round ${n}: first asks, one re-ask, no second re-ask`);
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => [x.effect, x.ask]), [['stated_pass_open', 'asked']]);
  assert.equal(r.passed, false, 'a twice-silent judge still blocks: its objection is carried');
  assert.ok(logs.some(l => /round cap \(3\) reached/.test(l)), 'the run ends at the round cap, and says so');
  assert.deepEqual(r.layers.filter(x => x.layer === 1).map(x => x.state), ['objected', 'objected', 'objected'], 'the layer ends objected in every round');
});

test('E84 the lost-first-reply edge: a judge whose first reply was lost has its one re-ask spent without the note; a pass on it is carried and the row says reask_spent', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? 'I could not finish my review' : label === 'panel-2-la-reask1' ? PASS() : undefined);
  const { r, prompts, served } = await run(replies, { maxRounds: 2 });
  assert.deepEqual(served.filter(l => l.startsWith('panel-2-')), ['panel-2-la', 'panel-2-lb', 'panel-2-la-reask1'], 'no second re-ask');
  assert.equal(prompts.get('panel-2-la-reask1').includes(STATED), false, 'the spent re-ask carried no note');
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => [x.effect, x.ask]), [['stated_pass_open', 'reask_spent']]);
});

test('E84 nothing to decide: when another judge of the layer objects, the silent judge is not re-asked; its row says layer_objected and the record does not call it re-asked', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? PASS() : label === 'panel-2-lb' ? objecting(F_LB) : undefined);
  const { r, served } = await run(replies, { maxRounds: 2 });
  assert.equal(served.includes('panel-2-la-reask1'), false);
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => [x.effect, x.ask]), [['stated_pass_open', 'layer_objected']]);
  assert.equal(r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la').reasked, false, 'never re-asked, never recorded as re-asked');
  assert.equal(r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la').verdict, 'passed', 'the pass is recorded as it was given');
});

test('E84 a stop before the re-ask (the spend cap refuses it): the partial record keeps what E3 wrote for a stated pass and every carried row says run_stopped, none is left without its ask', async () => {
  // la is a priced seat; its re-ask is not in the cache, so invoke() is asked to spend under a one-cent cap and refuses BEFORE sending. T1: la stated a pass in round 2; T2: la signed off without answering.
  const t1 = await run(label => round1(label) ?? (label === 'panel-2-la' ? PASS() : undefined), { maxRounds: 2, budget: 0.01, models: { la: 'mock-priced' }, miss: l => l === 'panel-2-la-reask1' }).then(() => null, e => e);
  assert.ok(t1 instanceof BudgetExceeded, `the run stops on the cap: ${t1}`);
  assert.deepEqual(t1.partial.answerBackReplies.filter(x => x.lab === 'la' && x.round === 2).map(x => [x.effect, x.ask]), [['stated_pass_open', 'run_stopped']], 'the pass is recorded as E3 recorded it, and the ask did not happen');
  const t2 = await run(label => round1(label) ?? (label === 'panel-2-la' ? signoff(EV_LA) : undefined), { maxRounds: 2, budget: 0.01, models: { la: 'mock-priced' }, miss: l => l === 'panel-2-la-reask1' }).then(() => null, e => e);
  assert.ok(t2 instanceof BudgetExceeded, `the run stops on the cap: ${t2}`);
  assert.deepEqual(t2.partial.answerBackReplies.filter(x => x.lab === 'la' && x.round === 2).map(x => [x.effect, x.ask]), [['unanswered', 'run_stopped']]);
  for (const e of [t1, t2]) for (const x of e.partial.answerBackReplies) if (x.effect === 'stated_pass_open' || x.effect === 'unanswered') assert.ok(ASKS.includes(x.ask), `a carried row in a partial record has its ask: ${JSON.stringify(x)}`);
});

test('E84 held door: without the re-ask sentence a stated pass is carried at once exactly as E3 carried it (no call), and the row says words_not_recorded', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? PASS() : undefined);
  const { r, served } = await run(replies, { maxRounds: 2, words: false });
  assert.equal(served.includes('panel-2-la-reask1'), false);
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => [x.effect, x.ask]), [['stated_pass_open', 'words_not_recorded']]);
  assert.equal(r.passed, false);
});

test('E84 T2: a clean sign-off with no answer to its own objection gets the existing re-ask PLUS the other judge\'s row; a quote of that row closes it; the judge\'s OWN row is not a source', async () => {
  const silent = label => round1(label) ?? (label === 'panel-2-la' ? signoff(EV_LA) : undefined);
  const viaPeer = await run(label => silent(label) ?? (label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, peerQuote)) : undefined), { maxRounds: 2 });
  const p = viaPeer.prompts.get('panel-2-la-reask1');
  assert.ok(p.includes('gave no answer for your objection') && p.includes(BLOCK) && p.includes(EV), 'the existing sentence, then the block');
  assert.deepEqual(rowsOf(viaPeer.r, 'la', 2).map(x => [x.effect, x.quoted_from, x.quoted_ref]), [['withdrawn', 'reviewer', 'lb']]);
  assert.equal(viaPeer.r.passed, true);
  const own = await run(label => silent(label) ?? (label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, `\`${EV_LA}\``)) : undefined), { maxRounds: 2 });
  assert.deepEqual(rowsOf(own.r, 'la', 2).map(x => x.effect), ['withdrawal_refused'], 'a judge cannot close its objection by quoting its own row');
  const twice = await run(label => silent(label) ?? (label === 'panel-2-la-reask1' ? signoff(EV_LA) : undefined), { maxRounds: 2 });
  assert.deepEqual(rowsOf(twice.r, 'la', 2).map(x => [x.effect, x.ask]), [['unanswered', 'asked']]);
});

test('E84 rows of another criterion are not shown and not a source', async () => {
  const C2 = 'The plan names an owner for every retry.';
  const two = (meets, evs, extra = {}) => JSON.stringify({ meets, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: evs[0] }, { criterion: C2, verdict: 'MET', evidence: evs[1] }], failures: [], verdict_line: 'ok', ...extra });
  const OTHER = 'Every retry is owned by the queue worker named in section nine.';
  const replies = label => (label === 'panel-1-la' ? JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }, { criterion: C2, verdict: 'MET', evidence: 'Owned by the writer.' }], failures: [F_A], verdict_line: 'no' })
    : label === 'panel-1-lb' || label === 'panel-2-lb' ? two(true, [EV, OTHER])
      : label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, `\`${OTHER}\``)) : undefined);
  const { r, prompts } = await run(replies, { maxRounds: 2, extra: { criteria: [CRITERION, C2] } });
  const p = prompts.get('panel-2-la-reask1');
  assert.ok(p.includes(EV) && !p.includes(OTHER), 'only the row for the criterion the objection is about is shown');
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => x.effect), ['withdrawal_refused']);
});

test('E84 any layer (Muad 14 Oct 2026): an upper-layer judge is shown the lower layer\'s MET row, a quote of it closes the objection, and the record names the row\'s layer', async () => {
  // la (layer 1) signs off each round with evidence; lb (layer 2) objected in round 1 and states a pass in round 2.
  const replies = label => (label === 'panel-1-lb' ? objecting(F_LB) : label === 'panel-1-la' || label === 'panel-2-la' ? signoff(EV)
    : label === 'panel-2-lb' ? PASS() : label === 'panel-2-lb-reask1' ? signoff(EV_LA, withdraw(objectionId('lb', F_LB), peerQuote)) : undefined);
  const { r, prompts } = await run(replies, { layers: [1, 2], maxRounds: 2 });
  const p = prompts.get('panel-2-lb-reask1');
  assert.ok(p.includes(STATED) && p.includes('from the draft or from an entry below') && p.includes(BLOCK) && p.includes(EV), 'the lower layer\'s row is shown');
  assert.deepEqual(rowsOf(r, 'lb', 2).map(x => [x.effect, x.quoted_from, x.quoted_ref, x.quoted_layer]), [['withdrawn', 'reviewer', 'la', 1]]);
  assert.equal(r.passed, true);
});

test('E84 the reverse direction does not arise: layers are asked in ascending order, so a layer-1 re-ask is never shown a higher judge\'s row of the same round', async () => {
  // Round 1: la objects, lb (layer 2) is not asked. Round 2: la states a pass; layer 2 is asked only after layer 1 signed off. la\'s re-ask must not contain any layer-2 text.
  const replies = label => (label === 'panel-1-la' ? objecting(F_A) : label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA) : label.startsWith('panel-2-lb') ? signoff('Layer two found the retry limit set to five attempts.') : undefined);
  const { prompts, served } = await run(replies, { layers: [1, 2], maxRounds: 2 });
  assert.equal(prompts.get('panel-2-la-reask1').includes(BLOCK), false, 'no peer row exists yet for the lower layer\'s re-ask');
  assert.ok(served.indexOf('panel-2-la-reask1') < (served.indexOf('panel-2-lb') < 0 ? Infinity : served.indexOf('panel-2-lb')), 'layer 1 (re-ask included) is finished before layer 2 is asked');
});

test('E84 cross case: a sign-off that left its objection unanswered (first ask) and then states a pass on the re-ask leaves ONE set of rows, not two', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? signoff(EV_LA) : label === 'panel-2-la-reask1' ? PASS() : undefined);
  const { r } = await run(replies, { maxRounds: 2 });
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => [x.effect, x.ask]), [['stated_pass_open', 'asked']], 'the re-ask replaced the first ask\'s unanswered row');
});

test('E84 cross case: a stated pass whose reply withdrew one id, then a re-ask reply that repeats nothing for it: the earlier withdrawal is NOT remembered (the latest ask counts), the id is carried unanswered (errs toward keeping the objection open)', async () => {
  const two = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [F_A, F_A2], verdict_line: 'no' });
  const replies = label => (label === 'panel-1-la' ? two : label === 'panel-1-lb' || label === 'panel-2-lb' ? signoff(EV)
    : label === 'panel-2-la' ? PASS(withdraw(ID_A, QUOTE)) : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A2, peerQuote)) : undefined);
  const { r } = await run(replies, { maxRounds: 2 });
  assert.deepEqual(rowsOf(r, 'la', 2).map(x => [x.id, x.effect]).sort(), [[ID_A, 'unanswered'], [ID_A2, 'withdrawn']].sort());
  assert.equal(r.passed, false);
});

test('E84 unlayered answer_back chains are untouched: the existing re-ask prompt carries no block, no row has an ask or a quoted_from', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? signoff(EV_LA) : undefined);
  const { r, prompts } = await run(replies, { layers: [undefined, undefined], maxRounds: 2 });
  const p = prompts.get('panel-2-la-reask1');
  assert.ok(p.includes('gave no answer for your objection') && !p.includes(BLOCK));
  for (const x of r.answerBackReplies) assert.equal('ask' in x || 'quoted_from' in x, false, JSON.stringify(x));
});

test('E84 resume pin: a run cut after round 2 (the re-ask recorded) and resumed gives the same rows, answer_back and layers, with no new call for a recorded stage', async () => {
  const replies = label => round1(label) ?? (/^panel-\d-la$/.test(label) ? PASS() : undefined);
  const whole = await run(replies, { maxRounds: 3 });
  const recorded = new Map(whole.r.stages.filter(s => s.label === 'build' || /^(panel|revise)-[12](-|$)/.test(s.label)).map(s => [s.label, { text: s.text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: s.promptHash }]));
  assert.ok(recorded.has('panel-2-la-reask1'), `fixture: the re-ask of round 2 was recorded: ${[...recorded.keys()].join(', ')}`);
  const resumed = await run(replies, { maxRounds: 3, stages: recorded });
  assert.deepEqual(resumed.stale, []);
  assert.deepEqual(resumed.served.filter(l => recorded.has(l)), [], 'no new call for a recorded stage');
  assert.deepEqual(resumed.r.answerBackReplies, whole.r.answerBackReplies);
  assert.deepEqual(resumed.r.answerBack, whole.r.answerBack);
  assert.deepEqual(resumed.r.layers, whole.r.layers);
});

test('E84 report: the new fields validate against schemas/report-v1.json, and the internal STATED_PASS_OPEN code never reaches a record', async () => {
  const replies = label => round1(label) ?? (label === 'panel-2-la' ? PASS() : label === 'panel-2-la-reask1' ? signoff(EV_LA, withdraw(ID_A, peerQuote)) : undefined);
  const { r, config } = await run(replies, { maxRounds: 2 });
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e84', chain: 'fixture-e84', task: 't.md', result: r, config })));
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.ok(report.answer_back_replies.some(x => x.quoted_from === 'reviewer' && x.quoted_ref === 'lb'));
  // The reviewer half of the record (C&C 14 Oct 2026): a reviewer quote ALWAYS carries its ref and layer, and the three fields appear together or not at all (absence of quoted_from = the quote is the draft's; the draft half is pinned by the test above).
  for (const x of report.answer_back_replies) assert.equal(['quoted_from', 'quoted_ref', 'quoted_layer'].filter(k => k in x).length % 3, 0, `quoted_from, quoted_ref and quoted_layer come together: ${JSON.stringify(x)}`);
  const row = report.answer_back_replies.find(x => x.quoted_from === 'reviewer');
  assert.ok(Number.isInteger(row.quoted_layer) && typeof row.quoted_ref === 'string');
  const { quoted_ref, ...noRef } = row;
  const broken = { ...report, answer_back_replies: report.answer_back_replies.map(x => (x === row ? noRef : x)) };
  assert.equal(validate(broken), false, 'the schema refuses a reviewer quote with no ref (so it cannot read as a draft quote)');
  assert.equal(validate({ ...report, answer_back_replies: [{ ...row, quoted_from: 'draft' }] }), false, 'and "draft" is no value of quoted_from: absence says it');
  assert.equal(JSON.stringify(report).includes('STATED_PASS_OPEN'), false);
});

test('E84 source scan: what is shown and what is checked come from one call, and both narrowings live in one predicate', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  assert.equal(src.match(/const sources = peerText \? peer\.byObjection : null;/g)?.length, 1, 'sources exist only when the block text was appended');
  assert.equal(src.match(/const peerRowsOf = /g)?.length, 1, 'peerRowsOf is defined once');
  assert.equal(src.match(/peerRowsOf\(/g)?.length, 1, 'and called once, in reviewSeat, where the shown text and the check set are built together');
  const apply = [...src.matchAll(/applyAnswers\(\{[^\n]*shownDraft: draft, round[^\n]*\}\)/g)].map(m => m[0]);
  assert.equal(apply.length, 2, 'the two applyAnswers call sites of the panel');
  for (const a of apply) assert.match(a, /\bsources\b/, 'each passes the sources');
  const pred = src.match(/const quotableFrom = [^\n]+/)?.[0] || '';
  for (const part of ['retained', '!v.carried', '!v.abstained', 'labOf(v.seat) !== labOf(asked)']) assert.ok(pred.includes(part), `the one predicate has ${part}`);
});

test('E84 earlier rounds are not a source (Muad: this round only): lb and lc signed off with a MET row in round 2 and are CARRIED into round 3 (la was unheard in round 2); la, asked in round 3, is neither shown their rows nor allowed to quote them, so its objection is carried', async () => {
  // Round 1: la objects, lb and lc sign off with EV. Round 2: la's reply is unreadable (both attempts), lb and lc sign off: every heard judge is clean, one is unheard, so their verdicts carry into round 3 on the unchanged draft (R1).
  // Round 3: only la is asked. Its first reply signs off without answering F_A; the re-ask quotes EV, which only the CARRIED rows hold.
  const replies = label => round1(label) ?? (/^panel-2-la/.test(label) ? 'no json here' : label === 'panel-3-la' ? signoff(EV_LA) : label === 'panel-3-la-reask1' ? signoff(EV_LA, withdraw(ID_A, peerQuote)) : undefined);
  const { r, prompts, served } = await run(replies, { maxRounds: 3, critics: ['la', 'lb', 'lc'], layers: [1, 1, 1] });
  assert.equal(served.includes('panel-3-lb') || served.includes('panel-3-lc'), false, 'fixture: lb and lc were not asked in round 3, their round-2 verdicts were carried over (else this test shows nothing)');
  assert.deepEqual(r.panelVerdicts.filter(v => v.round === 3 && v.carried).map(v => v.lab).sort(), ['lb', 'lc'], 'fixture: both round-3 verdicts of lb and lc are carried ones');
  const p = prompts.get('panel-3-la-reask1');
  assert.ok(p && !p.includes(BLOCK) && !p.includes(EV), 'the carried rows are not shown');
  assert.deepEqual(rowsOf(r, 'la', 3).map(x => [x.effect, x.quoted_from]), [['withdrawal_refused', undefined]], 'and a quote of them is refused');
  assert.equal(r.passed, false);
});
