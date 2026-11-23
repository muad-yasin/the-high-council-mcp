// B3 prep, JUDGE lane, unit 3 fix-up (C&C, flag d): with the rating demand in force (M1/S19: ratings are recorded on every layered unanimous chain; the held word `ratingDemand` is injected), a STATED PASS whose only carried (own, still open) objections are swept (rated below the settle line) counts as a plain stated pass: it blocks
// nothing, it is not asked again (no paid re-ask for something that blocks nothing), and the layer ends with the truthful reason ("did not sign off explicitly"), never "nothing was objected to". A stated pass that carries a held objection
// is asked and blocks as before. Demand held (nothing is rated, a volunteered tag is dropped): unchanged. $0, offline; every reply comes from a label-keyed cache (the shape of test/layered-ask-before-carry.test.js).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { withHeldOff } from './helpers/held-off.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the two stub failures carried no relation. NEW: relation 'new' (each seat raises its objection once, in round 1; round 2 is a stated pass or a withdrawal). WHY: relationRule is recorded (NS-0193): a judge failure without its relation is an unreadable reply.
const F_LA = sev => ({ criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.', relation: 'new', ...(sev === undefined ? {} : { severity: sev }) });
const F_LB = { criterion: CRITERION, problem: 'The retry limit has no unit.', fix: 'Give it a unit.', severity: 8, relation: 'new' };
const objecting = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no' });
const signoff = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok' });
const PASS = JSON.stringify({ pass: true, pass_reason: 'I would rather not judge this round.' });
const QUOTE = '`The worker retries failed requests.`';
const signoffWithdrawing = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], answers: [{ id, status: 'withdrawn', evidence: QUOTE }], verdict_line: 'ok' });
const ID_LB = objectionId('lb', F_LB);

async function run({ demand, laSeverity }) {
  setHeldForTest(withHeldOff({ criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock, ...(demand ? DEMAND : NO_DEMAND) }));   // `demand` replaces the old boolean parameter of the removed switch: the rating demand injected (true) or forced out (false)
  const served = []; const logs = []; const hashes = new Map();
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); });
  const replies = label => (label === 'panel-1-la' ? objecting(F_LA(laSeverity)) : label === 'panel-1-lb' ? objecting(F_LB) : label === 'panel-2-la' ? PASS : label === 'panel-2-la-reask1' ? PASS : label === 'panel-2-lb' ? signoffWithdrawing(ID_LB) : undefined);
  setCache({ invalidate: () => {}, get(label) {
    served.push(label);
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? (replies(label) ?? signoff) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }) });
  const config = { name: 'fixture-stated-pass', criteria: [CRITERION], maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true },
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la', 1), seat('lb', 1)] } };
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-sp', log: l => logs.push(l), config });
  return { r, served, logs };
}

// CHANGED ACCEPTED (0.8.4 S19): OLD: the old boolean parameter (true) put the switch key in the config. NEW: `run({ demand: true })` injects the rating demand (merged into the held map); the fixture was already layered; assertions unchanged. WHY: switch removed. RED ON OLD SRC: the old src keeps no ledger without the switch (no swept_only, no severityRun).
test('demand in force: a stated pass carrying only a swept objection is NOT asked again and counts as a plain stated pass: the other judge of the single layer carries it, the run passes, and the swept objection is recorded as swept', async () => {
  const { r, served, logs } = await run({ demand: true, laSeverity: 3 });
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'la').swept_only, true, 'round 1: la signed off with its swept objection');
  assert.equal(r.panelVerdicts.find(v => v.round === 2 && v.lab === 'lb').verdict, 'signed_off', 'round 2: lb withdrew its held objection and signed off');
  assert.ok(served.includes('panel-2-la'), 'round 2 asked la (the checks below are not vacuous)');
  assert.equal(served.includes('panel-2-la-reask1'), false, 'no paid re-ask about an objection that blocks nothing');
  assert.equal(logs.some(l => /nothing was objected to/.test(l)), false, 'the false line never appears');
  assert.equal(r.layerStop, undefined, 'the layer did not stop the run');
  assert.equal(r.passed, true, 'a stated pass is a non-vote; the swept objection holds nothing');
  assert.deepEqual(r.answerBackReplies.filter(x => x.lab === 'la' && x.round === 2).map(x => [x.effect, x.path]), [['swept_carried', 'stated_pass']], 'the row says it was carried by a stated pass (no ask: it was never asked about)');
  assert.deepEqual(r.severityRun.open, [], 'nothing holds the plan at the end');
  assert.deepEqual(r.severityRun.swept.map(o => [o.lab, o.severity]), [['la', 3]], 'the stated pass\'s swept objection is recorded as swept');
});

// CHANGED ACCEPTED (0.8.4 S19): OLD: the old boolean parameter (true). NEW: `run({ demand: true })`, the demand injected; assertion unchanged. WHY: switch removed. RED ON OLD SRC: none (an unrated objection is also asked once there). RED INPUT FOR THE BUILDER: run it with `laSeverity: 3` (swept, so no re-ask) and the assertion fails.
test('demand in force: a stated pass carrying a HELD objection (rated 8) is asked once and blocks, as before', async () => {
  const { served } = await run({ demand: true, laSeverity: 8 });
  assert.ok(served.includes('panel-2-la-reask1'), 'the held objection is asked about');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'demand held: a stated pass carrying the same objection (its volunteered rating is dropped, so it is unrated) is asked once, as before' ran the chain with the rating demand forced out (NO_DEMAND). NEW: removed; its siblings 'demand in force' above assert the stated-pass behaviour with the demand recorded (swept: not asked again; held: asked once). WHY: ratingDemand is recorded (src/prompts/recorded-084-b.js), so no layered unanimous chain runs without it.
