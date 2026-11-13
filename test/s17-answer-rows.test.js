// 0.8.4 S17 (Q8 item 5, D33, N25; FEATURE_SPECS l.1690-1696, l.2301): the overruled seat's answer in its NEXT review. A block of a lower seat that layer 3 overruled with its F8 ruling at a climb read (the go-up of layer 2 at its bound, S7) and then OBJECTED, so the plan restarts at layer 1, is shown to that seat in its next review
// with layer 3's reasons (W41, a prompt section, never a call); the seat answers once there. T21x and T21cd: it withdraws with a quote the revised draft holds; that is N25's second route, a fix, in either band: the withdrawal is recorded as a fix and the objection is cleared.
// The fixture is RL-5 of test/s7c-reasons.test.js (the rated-5 go-up run: BOUND, `rule-3-top-gamma` overrules, `panel-3-top-gamma` objects with its own rated concern, pass 4 restarts at layer 1), COPIED here with the rating and the withdrawal's evidence as inputs. Offline, $0; the held words
// (rating demand, the go-up ruling, W41) are injected: as shipped they are held. Q1 (C&C 09 Nov): the layer's standing is read from layers[].state, at the pass named in the assertion (pass 4, layer 2), never from a new field.
// Written without a run (no tests on the laptop). The reds are swapped-input variants (S17_SWAPS.json): the same block with ONE input changed and every assert line byte-identical.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { DEMAND } from './helpers/rating-demand.js';
import { CRITERION } from './helpers/layer-two-run.js';
import * as HB from './held-prompts/held-084-b.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const DRAFT = 'The worker retries failed requests.';
const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation. NEW: each carries relation 'new'; mid-beta's later raises of Y while its id stands carry `continues <id>` (`continuing`). WHY: relationRule is recorded (src/chain.js:5462); a `new` on a standing id mints #2.
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', relation: 'new' };
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', relation: 'new' };
const idL3 = objectionId('top-gamma', L3F);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const withdraws = (id, evidence) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence }] });
const rated = (f, severity) => ({ ...f, severity });
const continuing = f => ({ ...f, relation: `continues ${objectionId('mid-beta', f)}` });
const rules = list => JSON.stringify({ rulings: list });
const GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };
const W41 = { layerThreeReasonsSection: HB.layerThreeReasonsSection };
const HEADING = "# Layer 3's reasons for objections of yours it overruled";

// rate: the rating mid-beta (layer 2) gives its block Y; evidence: what it writes to withdraw Y in pass 4. Layer 2 hits its bound, layer 3 overrules Y (the F8 ruling) and objects with its own concern (rated 5, as RL-5 has it): the plan restarts at layer 1.
async function run({ rate, evidence, more = {}, retags = null }) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest({ ...DEMAND, ...GOUP, ...W41 });
  const script = {
    'panel-1-mid-beta': objects(rated(Y, rate)), 'panel-2-mid-beta': objects(continuing(rated(Y, rate))),
    'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }]),
    'panel-3-top-gamma': objects(rated(L3F, 5)),
    'panel-4-mid-beta': withdraws(idY, evidence), 'panel-4-top-gamma': withdraws(idL3, 'It reads "The worker retries failed requests."'),
    ...more,
  };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return hit(script[label]);
    return hit((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-s17-answer', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s17-answer', log: () => {}, config, ...(retags ? { retags } : {}) }); } catch (e) { error = e; }   // a pause or a stop is possible in a swapped run: the assertions read what exists, and the premise messages say what ended the run
  return { result, error, served, prompts };
}

test('T21x: the seat withdraws, in its next review, a block rated 8.0 that layer 3 overruled at a climb read where it objected, with a quote the revised draft holds: recorded as a fix (N25\'s second route), the block cleared, and its layer (layer 2, pass 4) counted as signed', async () => {
  const RATE = 8;
  const EVIDENCE = 'It reads "The worker retries failed requests."';
  const { result, error, served, prompts } = await run({ rate: RATE, evidence: EVIDENCE });
  assert.ok((prompts.get('panel-4-mid-beta')?.user || '').includes(`- ${idY}, rated ${RATE}, overruled by every judge of layer 3 in round 3.`), `premise: layer 3's ruling at the climb read overruled the block, shown with its rating in the seat's next review (the run ended with: ${String(error)})`);
  assert.ok(served.includes('panel-4-mid-beta') && (prompts.get('panel-4-mid-beta')?.user || '').includes(HEADING), 'premise: the seat\'s next review carries layer 3\'s reasons (W41)');
  const reply = (result?.answerBackReplies || []).find(x => x.lab === 'mid-beta' && x.round === 4 && x.id === idY);
  assert.deepEqual([reply?.effect, reply?.quoted], ['withdrawn', true], 'the withdrawal was read and its quote found');
  const row = (result?.severityRun?.withdrawn || []).find(w => w.id === idY);
  assert.deepEqual([row?.lab, row?.severity, row?.cleared_by, row?.how, row?.pass], ['mid-beta', RATE, 'fix', 'answer_back', 4], 'recorded as a fix, at its original rating, in pass 4');
  assert.equal((result?.severityRun?.open || []).some(o => o.id === idY), false, 'the block is cleared, not open');
  assert.equal(result?.layers?.find(l => l.round === 4 && l.layer === 2)?.state, 'signed_off', 'layer 2 counts as signed in pass 4 (layers[].state)');
});

test('T21cd: the same for a block rated 5.0: recorded as a fix, the objection settled, and the seat\'s layer (layer 2, pass 4) counted as signed', async () => {
  const RATE = 5;
  const EVIDENCE = 'It reads "The worker retries failed requests."';
  const { result, error, served, prompts } = await run({ rate: RATE, evidence: EVIDENCE });
  assert.ok((prompts.get('panel-4-mid-beta')?.user || '').includes(`- ${idY}, rated ${RATE}, overruled by every judge of layer 3 in round 3.`), `premise: layer 3's ruling at the climb read overruled the block, shown with its rating in the seat's next review (the run ended with: ${String(error)})`);
  assert.ok(served.includes('panel-4-mid-beta') && (prompts.get('panel-4-mid-beta')?.user || '').includes(HEADING), 'premise: the seat\'s next review carries layer 3\'s reasons (W41)');
  const reply = (result?.answerBackReplies || []).find(x => x.lab === 'mid-beta' && x.round === 4 && x.id === idY);
  assert.deepEqual([reply?.effect, reply?.quoted], ['withdrawn', true], 'the withdrawal was read and its quote found');
  const row = (result?.severityRun?.withdrawn || []).find(w => w.id === idY);
  assert.deepEqual([row?.lab, row?.severity, row?.cleared_by, row?.how, row?.pass], ['mid-beta', RATE, 'fix', 'answer_back', 4], 'recorded as a fix, at its original rating, in pass 4');
  assert.equal((result?.severityRun?.open || []).some(o => o.id === idY), false, 'the block is cleared, not open');
  assert.equal(result?.layers?.find(l => l.round === 4 && l.layer === 2)?.state, 'signed_off', 'layer 2 counts as signed in pass 4 (layers[].state)');
});

// ---- T21ai, T21aj, Q6: the same run, but the seat's withdrawal in pass 4 quotes a passage the revised draft does NOT hold ----
// Pass 4: the withdrawal is refused (F7): recorded as a refused withdrawal with its reason, the block stands, layer 2 is not signed (it is objected). Pass 5: layer 3's reasons are NOT shown again (the seat answers once, Q8 item 5 (ii); Q6 ruled by C&C 09 Nov: a refused withdrawal is the seat keeping it);
// a later review may still withdraw it with a quote that is found (a fix). There is no green twin of this pass shape under the rating demand (RL-3 is unrated): a fixture red at pass 5 is expected, not news.
const ABSENT = 'It reads "The worker uses exponential back-off."';
const FOUND = 'It reads "The worker retries failed requests."';

test('T21ai, Q6: the seat withdraws, in its next review, a block rated 5.0 that layer 3 overruled at a climb read where it objected, with a quote the revised draft does not hold: the withdrawal is refused with its reason, the block stands, layer 2 (pass 4) is not signed; layer 3\'s reasons are not shown again in pass 5, and a later withdrawal with a found quote is a fix', async () => {
  const RATE = 5;
  const EVIDENCE = ABSENT;
  const { result, error, prompts } = await run({ rate: RATE, evidence: EVIDENCE, more: { 'panel-5-mid-beta': withdraws(idY, FOUND), 'panel-5-top-gamma': withdraws(idL3, FOUND) } });
  assert.ok((prompts.get('panel-4-mid-beta')?.user || '').includes(`- ${idY}, rated ${RATE}, overruled by every judge of layer 3 in round 3.`), `premise: layer 3's ruling at the climb read is shown, with its rating, in the seat's next review (the run ended with: ${String(error)})`);
  const reply = (result?.answerBackReplies || []).find(x => x.lab === 'mid-beta' && x.round === 4 && x.id === idY);
  assert.deepEqual([reply?.effect, reply?.quoted, reply?.refusal], ['withdrawal_refused', false, 'not_found'], 'T21ai: no withdrawal recorded as such: refused, with the reason');
  assert.equal((result?.severityRun?.withdrawn || []).some(w => w.id === idY && w.pass === 4), false, 'T21ai: not recorded as cleared in pass 4');
  assert.equal(result?.layers?.find(l => l.round === 4 && l.layer === 2)?.state, 'objected', 'T21ai: layer 2 is not counted as signed in pass 4 (layers[].state)');
  const p5 = prompts.get('panel-5-mid-beta')?.user || '';
  assert.ok(p5.includes(idY) && !p5.includes(HEADING), 'Q6 (NAMED PIN): the block is still the seat\'s own open objection in pass 5, and layer 3\'s reasons are not shown again');
  const fix = (result?.severityRun?.withdrawn || []).find(w => w.id === idY && w.pass === 5);
  assert.deepEqual([fix?.cleared_by, fix?.how], ['fix', 'answer_back'], 'a later review withdraws it with a quote that is found: a fix, in pass 5');
});

test('T21aj (SECOND row, the N25 handler path; the row itself is test/s17-layer3-retag.test.js): the objection of T21ai (refused in pass 4), then the person\'s handler re-tags it below 4 in pass 5, giving the seat\'s reason: the re-tag is recorded (old, new, who, reason) and the objection is settled', async () => {
  const RATE = 5;
  const TO = 3;
  const REASON = 'The seat\'s reason: section two names the owner.';
  const CLEARED_BY = 'retag';   // the route a re-tag below 4 clears an objection by (an objection once rated 7 or above is not cleared by it)
  const { result: ended, error, prompts } = await run({ rate: RATE, evidence: ABSENT, more: { 'panel-5-mid-beta': objects(continuing(rated(Y, RATE))), 'panel-5-top-gamma': withdraws(idL3, FOUND) }, retags: [{ pass: 5, id: idY, severity: TO, reason: REASON }] });
  const result = ended ?? error?.partial;   // a swapped run does not end (the objection stays open, the round limit stops it): the stop carries the record so far
  const reply = (result?.answerBackReplies || []).find(x => x.lab === 'mid-beta' && x.round === 4 && x.id === idY);
  assert.equal(reply?.effect, 'withdrawal_refused', `premise: the pass-4 withdrawal was refused (the run ended with: ${String(error)}; ${prompts.size} prompts)`);
  const rt = (result?.severityRun?.retags || []).find(x => x.id === idY);
  assert.deepEqual([rt?.pass, rt?.from, rt?.to, rt?.by, rt?.reason, rt?.cleared_by], [5, RATE, TO, 'handler', REASON, CLEARED_BY], 'T21aj: the re-tag is recorded (pass, old, new, who, reason) and is the route it cleared by');
  assert.deepEqual([result?.severityRun?.computed, Array.isArray(result?.severityRun?.open)], [true, true], 'T21aj: the record read is the computed end of the run (an array of open objections), not the stopped-before-a-pass shape');
  assert.equal((result?.severityRun?.open || []).some(o => o.id === idY), false, 'T21aj: settled: it holds nothing and is not open at the end');
});
