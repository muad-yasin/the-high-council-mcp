// 0.8.4 S17 (D33, T21x, T21cd; a defect found in merged code, C&C ruled 09 Nov): a STATED PASS that carries `answers` with a withdrawal whose quote is found in the draft settles the objection (the reply row says withdrawn and quoted), and the severity ledger
// must record it the way a full verdict's withdrawal is recorded: severity.withdrawn[] gets the row with cleared_by 'fix' and how 'answer_back'. The parent wrote the reply row and never the ledger row (the route by which the objection cleared was lost).
// The fixture is the one of test/severity-stated-pass.test.js (layer 1 holds la and lb; lb raises an objection rated 8 in pass 1); only lb's pass-2 reply differs: a stated pass with the withdrawal, and la is not stated-passing. Offline, $0.
// RED ON THE PARENT (route (a)): the test fails at the withdrawn[] assertion; the premise assertion on the reply row holds on both trees. la signs off in pass 2 (its rated-3 objection is carried as swept), so only lb's stated pass is under test and the layer signs off in pass 2.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { withHeldOff } from './helpers/held-off.js';
import { DEMAND } from './helpers/rating-demand.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation. NEW: each carries relation 'new' (a first raise by that seat). WHY: relationRule is recorded (src/chain.js:5462).
const F_LA = { criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.', severity: 3, relation: 'new' };
const objecting = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no' });
const signoff = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok' });
const passWithdrawing = (id, evidence) => JSON.stringify({ pass: true, pass_reason: 'I would rather not judge this round.', answers: [{ id, status: 'withdrawn', evidence }] });

async function run({ rate, evidence }) {
  const F_LB = { criterion: CRITERION, problem: 'The retry limit has no unit.', fix: 'Give it a unit.', severity: rate, relation: 'new' };
  const ID_LB = objectionId('lb', F_LB);
  setHeldForTest(withHeldOff({ criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock, ...DEMAND }));
  const hashes = new Map();
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); });
  const replies = label => (label === 'panel-1-la' ? objecting(F_LA) : label === 'panel-1-lb' ? objecting(F_LB) : label === 'panel-2-lb' ? passWithdrawing(ID_LB, evidence) : undefined);
  setCache({ invalidate: () => {}, get(label) {
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? (replies(label) ?? signoff) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }) });
  const config = { name: 'fixture-s17-stated-pass', criteria: [CRITERION], maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true },
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la', 1), seat('lb', 1)] } };
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s17-sp', log: () => {}, config });
  return { r, ID_LB };
}

test('D (found in merged code; a supplement to T21x and T21cd, not their layer-3 row): a stated pass: a stated pass that withdraws an objection with a quote the draft holds (rated 8 and rated 5) is recorded as a fix in the severity ledger: withdrawn[] has the row, cleared_by fix, how answer_back, at its original rating', async () => {
  const RATES = [8, 5];
  const EVIDENCE = '`The worker retries failed requests.`';
  for (const RATE of RATES) {
    const { r, ID_LB } = await run({ rate: RATE, evidence: EVIDENCE });
    const reply = r.answerBackReplies.find(x => x.lab === 'lb' && x.round === 2 && x.id === ID_LB);
    assert.deepEqual([reply?.effect, reply?.quoted], ['withdrawn', true], `rated ${RATE}: premise: the stated pass's withdrawal was read and its quote found`);
    const row = r.severityRun.withdrawn.find(w => w.id === ID_LB);
    assert.deepEqual([row?.lab, row?.severity, row?.cleared_by, row?.how, row?.pass], ['lb', RATE, 'fix', 'answer_back', 2], `rated ${RATE}: recorded as a fix, at its original rating, in pass 2`);
  }
});
