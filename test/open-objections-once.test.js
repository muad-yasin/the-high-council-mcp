// CHANGED INPUTS (0.8.4, 09 Nov 2026; the assertions are 3c140182's, unchanged): on the integration tip a stall goes up only with the ledger AND the rating demand (SG-1, as test/stall-escalation.test.js), so the rating demand is injected and the scripted objection carries severity 5, and the closing read (S16, labels final-read-*) answers like a panel seat; without them the run stops at the stall before the list is built.
// 0.8.4 (a 13837 run listed one open objection twice in `dispute.open_objections`, byte for byte): the list of objections still open at the end names each (seat, id, problem) once.
// Two lower-layer judges raise the same unquoted objection, stall, and the layer above sustains both; it adopts them under ONE id of its own (the id hashes the adopting seat, the criterion and the quote,
// and there is no quote), and used to carry two identical rows to the end. The run ends at the round cap in pass 3, where that seat was not asked again: the rows reach the open list through its last recorded round
// (`not_asked_in_final_round`), which is how the real run listed O-f30d2460 twice. Offline, $0. The ruling words are held test data (test/held-prompts/held-escalation.js), injected as in test/stall-escalation.test.js.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import * as HESC from './held-prompts/held-escalation.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failure carried no relation. NEW: relation 'new' on a first raise; the second raise of each seat (pass 2) carries `continues <id>` (`repeatU`). WHY: relationRule is recorded (src/chain.js:5462); a `new` on a standing id mints #2 and the stall never fires.
const U = { relation: 'new', severity: 5, criterion: CRITERION, problem: 'No limit on retries.' };   // no quote: the id is (seat, criterion) alone
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const A = 'raiser-alpha'; const B = 'raiser-bravo';
const repeatU = lab => ({ ...U, relation: `continues ${objectionId(lab, U)}` });
const idA = objectionId(A, U); const idB = objectionId(B, U); const idM = objectionId('mid-beta', U);

async function run() {
  const script = {
    'panel-1-raiser-alpha': objects(U), 'panel-1-raiser-bravo': objects(U), 'panel-2-raiser-alpha': objects(repeatU(A)), 'panel-2-raiser-bravo': objects(repeatU(B)),
    'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idA}: The limit is set in section two.\nDECLINED: ${idB}: The limit is set in section two.`,
    'rule-3-mid-beta': JSON.stringify({ rulings: [{ id: idA, ruling: 'sustain', reason: 'The limit is not stated.' }, { id: idB, ruling: 'sustain', reason: 'The limit is not stated.' }] }),
  };
  setHeldForTest({ ...INJECT, ...DEMAND });
  setCache({ invalidate() {}, get(label) {
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  setBudget(null);
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = {
    name: 'fixture-open-once', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 3,
    seats: { builder, reviser: builder, critics: [seat(A, 1), seat(B, 1), seat('mid-beta', 2), seat('top-gamma', 3)] },
  };
  return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-once', log: () => {}, config });
}

test('two identical raises sustained by one seat are one open objection, not two', async () => {
  const result = await run();
  const open = result.dispute.open_objections;
  const mine = open.filter(o => o.id === idM);
  assert.equal(mine.length, 1, `the adopted objection ${idM} is listed once; the list was ${JSON.stringify(open.map(o => [o.lab, o.id, o.problem]))}`);
  const keys = open.map(o => JSON.stringify([o.lab, o.id, o.problem]));
  assert.equal(new Set(keys).size, keys.length, 'no (seat, id, problem) row is listed twice');
});
