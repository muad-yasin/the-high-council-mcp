// A judge that copies the NUMBER of a criterion from the numbered criteria list ("7. The plan ...") raises the same criterion as one that does not: the id, the key and the stall signature read the criterion without a leading list
// marker (src/objection-ids.js stripListMarker). Found 29 Okt 2026 in a live debate run: one past-seven objection stood under five ids. Pure and $0, plus one mock run for the stall rule.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { objectionId, objectionKey, stallSignature, stripListMarker, legacyStallSignature } from '../src/objection-ids.js';
import { missingCriteriaRows, signoffTableGap } from '../src/criteria-ledger.js';
import { runChain, setCache, setPromptSpy, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setCache(null); setPromptSpy(null); setBudget(null); });
const CRIT = 'The plan contradicts or reopens no settled item and refers to settled items by number.';
const F = (lab, criterion, quote) => ({ lab, criterion, ...(quote === undefined ? {} : { quote }), problem: 'p' });

test('stripListMarker: "7.", "7)", "(7)" and "7:" before a space are a list marker; numbers that belong to the text are not', () => {
  for (const m of ['7. ', '7) ', '(7) ', '7: ', '  12. ', '103) ']) assert.equal(stripListMarker(`${m}${CRIT}`), CRIT, JSON.stringify(m));
  for (const keep of ['3.5 seconds are allowed for the retry.', '2024. The plan was written then.', '7The plan ...', 'The plan has 7. items', '1.5x faster']) assert.equal(stripListMarker(keep), keep, keep);
  assert.equal(stripListMarker(undefined), '');
});

test('objectionId and objectionKey: the same criterion with and without its list number is one objection (the five-ids case); a real difference still is one', () => {
  const plain = objectionId('l1', F('l1', CRIT));
  for (const m of ['7. ', '7) ', '(7) ', '7: ']) assert.equal(objectionId('l1', F('l1', `${m}${CRIT}`)), plain, JSON.stringify(m));
  assert.equal(objectionId('l1', F('l1', `11. ${CRIT}`)), plain, 'the number itself is not part of the criterion');
  assert.notEqual(objectionId('l2', F('l2', `7. ${CRIT}`)), plain, 'another lab');
  assert.notEqual(objectionId('l1', F('l1', `7. ${CRIT} (second part)`)), plain, 'another criterion');
  assert.notEqual(objectionId('l1', F('l1', `7. ${CRIT}`, 'a quoted passage')), plain, 'another quoted text');
  assert.equal(objectionKey(F('l1', `7. ${CRIT}`, 'q')), objectionKey(F('l1', CRIT, 'q')));
  assert.equal(objectionKey(F('l1', 'C3')), 'l1\u0000C3\u0000', 'a criterion id is left as it was');
});

test('stall signature: the same objection raised once with and once without the number is the same signature (it stalls), and it still implies the old signature only for equal text', () => {
  assert.equal(stallSignature([F('l1', `7. ${CRIT}`), F('l2', 'C1', 'x')]), stallSignature([F('l2', 'C1', 'x'), F('l1', CRIT)]));
  assert.notEqual(legacyStallSignature([F('l1', `7. ${CRIT}`)]), legacyStallSignature([F('l1', CRIT)]), 'the pre-0.8.2 signature is kept as it was (test-only)');
});

test('the sign-off table already names a criterion whose row carries the list number (containment, last night\'s tolerant match): no change was needed there', () => {
  const criteria = ['The plan states its assumptions plainly.', 'It adds no scope the request did not ask for.'];
  const rows = [{ criterion: `1. ${criteria[0]}`, verdict: 'MET', evidence: 'Section one.' }, { criterion: `(2) ${criteria[1]}`, verdict: 'MET', evidence: 'Section two.' }];
  assert.ok(!missingCriteriaRows({ criteria: rows }, criteria)?.length, 'no row missing');
  assert.equal(signoffTableGap({ criteria: rows }, criteria), null);
});

// ---- a mock run: layer 1 raises the SAME objection in two passes, numbered the first time and not the second: the stall rule must see one stuck disagreement and pass the plan up.
const DRAFT = 'The worker retries failed requests.';
const objects = (criterion, f) => JSON.stringify({ meets: false, criteria: [{ criterion, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const meets = c => JSON.stringify({ meets: true, criteria: [{ criterion: c, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
async function stallRun(firstCriterion, secondCriterion) {
  setHeldForTest(DEMAND);   // CHANGED (0.8.4 SG-1, C&C 08 Nov 2026): the stall goes up only with the answer-back list AND the rating demand; the objections are rated 5 (a rating changes neither the id nor the stall window)
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failure carried no `relation`. NEW: pass 1 says `new`; pass 2 says `continues <id>` when it is the same objection (the numbered and the plain form are one id) and `new` when the criterion differs. WHY: relationRule recorded (src/chain.js relation gate).
  const base = 'The plan defines a retry limit.';
  const f = (c, relation) => ({ severity: 5, criterion: c, problem: 'No limit on retries.', quote: 'retries failed requests', relation });
  const idFirst = objectionId('raiser-alpha', f(base));
  setCache({ invalidate() {}, get(label) {
    const text = label === 'panel-1-raiser-alpha' ? objects(base, f(firstCriterion, 'new')) : label === 'panel-2-raiser-alpha' ? objects(base, f(secondCriterion, secondCriterion === base ? `continues ${idFirst}` : 'new')) : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets(base) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-marker', criteria: [base], maxRounds: 6, signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-marker', log: () => {}, config });
}

test('stall rule: "1. <criterion>" in pass 1 and "<criterion>" in pass 2 is the same objection - the stall fires in pass 2; a different criterion in pass 2 does not make it fire there', async () => {
  const same = await stallRun('1. The plan defines a retry limit.', 'The plan defines a retry limit.');
  assert.equal(same.escalations?.[0]?.round, 2, 'the stall fired in pass 2 and the plan was passed up: the numbered and the plain form are one stuck objection');
  const other = await stallRun('1. The plan defines a retry limit.', 'The plan names its owner.');
  // CHANGED (0.8.4 S5, Q13, R3): the stall is per objection. The first objection stood unanswered in pass 2 (the judge objected to something else and left it open, so it is carried), so it stalls ALONE in pass 2; the objection of the
  // different criterion stood once and is not passed up with it. Before: the whole pass's set was compared and a changed set did not stall in pass 2.
  const f = c => ({ criterion: c, problem: 'No limit on retries.', quote: 'retries failed requests' });   // unrated is fine here: objectionId reads no severity
  assert.deepEqual(other.escalations?.[0]?.ids, [objectionId('raiser-alpha', f('1. The plan defines a retry limit.'))], 'only the objection that stood in both passes is passed up; the different criterion is another objection');
});
