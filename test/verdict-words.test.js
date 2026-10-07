// 0.8.2 wiring block, item (1): an unreadable word is never a pass. Two code rules that change when a run passes (each behind a flag that no shipped chain sets yet):
//   3b  - a judge's `answers` entry whose status is neither "sustained" nor "withdrawn" keeps the objection open (answer_back.enabled);
//   P1  - a sign-off whose table has a row that says neither MET nor FAILED is an incomplete table: the judge abstains and is re-asked (signoff_table.required).
// $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAnswers } from '../src/answer-back.js';
import { signoffTableGap, describeTableGap } from '../src/criteria-ledger.js';
import { isReadableVerdict, isMetVerdict } from '../src/criteria-kinds.js';
import { normaliseCritique, runChain } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

const OWN = [{ id: 'O-aaaaaaaa', criterion: 'C1', problem: 'p1' }];
const DRAFT = 'The cache is cleared on every write. Reads go through one shared cache.';
const answer = status => applyAnswers({ lab: 'a', critique: { failures: [], answers: [{ id: 'O-aaaaaaaa', status, evidence: 'It now says "cleared on every write".' }] }, own: OWN, shownDraft: DRAFT, round: 2 });

test('3b: the two words count in any case, with spaces or a closing full stop; any other word keeps the objection open', () => {
  for (const ok of ['withdrawn', 'Withdrawn', ' WITHDRAWN ', 'withdrawn.']) {
    const r = answer(ok);
    assert.equal(r.records[0].effect, 'withdrawn', JSON.stringify(ok));
    assert.deepEqual(r.carried, [], JSON.stringify(ok));
  }
  for (const ok of ['sustained', 'Sustained', 'sustained.']) assert.deepEqual([answer(ok).records[0].effect, answer(ok).carried.length], ['sustained', 1], JSON.stringify(ok));
  for (const bad of ['fixed', 'resolved', 'open', 'withdrawn, fixed', 'no longer applies', '', '  ', null, undefined, 7, true, ['withdrawn'], { status: 'withdrawn' }]) {
    const r = answer(bad);
    assert.equal(r.records[0].effect, 'unreadable_answer', JSON.stringify(bad));
    assert.deepEqual(r.carried.map(c => c.id), ['O-aaaaaaaa'], `an unreadable status (${JSON.stringify(bad)}) carries the objection`);
  }
});

test('3b: an unreadable answer for an objection the judge listed again is not carried twice; an objection with no answer at all stays as built (recorded, no effect)', async () => {
  const { objectionId } = await import('../src/objection-ids.js');
  const id = objectionId('a', { criterion: 'C1' });
  const again = applyAnswers({ lab: 'a', critique: { failures: [{ criterion: 'C1', problem: 'again' }], answers: [{ id, status: 'fixed' }] }, own: [{ ...OWN[0], id }], shownDraft: DRAFT, round: 2 });
  assert.deepEqual(again.carried, []);
  const none = applyAnswers({ lab: 'a', critique: { failures: [], answers: [] }, own: OWN, shownDraft: DRAFT, round: 2 });
  assert.deepEqual(none.records.map(r => r.effect), ['unanswered']);
  assert.deepEqual(none.carried, [], 'carrying unanswered ones would let any judge that ignores the array stall the run');
});

const answerChain = (model, extra = {}) => {
  const base = chain('mock-unanimous');
  return { ...base, maxRounds: 3, ...extra, seats: { ...base.seats, critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] } };
};
const go = (model, extra) => runChain({ request: 'Write a short fixture deliverable.', config: answerChain(model, extra), runId: 'r-vw', log: () => {} });

test('3b through the whole round: a judge that answers "fixed" does not close its objection, the run does not pass; with answer_back off nothing changes', async () => {
  const on = await go('mock-critic-answers-fixed', { answer_back: { enabled: true } });
  assert.equal(on.passed, false);
  assert.ok(on.answerBackReplies.length >= 1 && on.answerBackReplies.every(r => r.effect === 'unreadable_answer' && r.status === 'fixed'), JSON.stringify(on.answerBackReplies));
  const off = await go('mock-critic-answers-fixed', {});
  assert.equal(off.passed, true);
});

// ---- the third verdict word ----
const CRITERIA = ['Names every file it changes.', 'States the rollback step.', 'Adds no scope the request did not ask for.'];
const table = (...verdicts) => ({ meets: true, criteria: CRITERIA.map((criterion, i) => ({ criterion, verdict: verdicts[i], evidence: 'quoted' })) });

test('isReadableVerdict: MET-shaped and FAILED-shaped words (a closing full stop aside) are readable; hedges, other words and nothing are not', () => {
  for (const ok of ['MET', 'met', ' Met. ', 'PASS', 'passed', 'yes', 'FAILED', 'Fail', 'NOT MET', 'not_met', 'UNMET', 'no', 'Failed.', 'NOT MET.', 'No.', 'Fail!', 'Not Met!', 'UNMET.', ' failed. ']) assert.equal(isReadableVerdict(ok), true, ok);
  for (const bad of ['UNCHECKED', 'MET (partially)', 'SATISFIED', 'OK', 'see notes', 'MET, but', '', '  ', null, undefined, 3, 'N/A', 'PARTIAL']) assert.equal(isReadableVerdict(bad), false, JSON.stringify(bad));
});

test('signoffTableGap: a row with a third word is named; the three earlier kinds still come first, in their order', () => {
  assert.equal(signoffTableGap(table('MET', 'Met.', 'PASS'), CRITERIA), null);
  const gap = signoffTableGap(table('MET', 'UNCHECKED', 'MET (partially)'), CRITERIA);
  assert.deepEqual(gap, { kind: 'unreadable_verdict', criterion_ids: ['C2', 'C3'], table_rows: 3, criteria_total: 3 });
  assert.equal(describeTableGap(gap), 'a verdict that is neither MET nor FAILED for C2, C3');
  const bare = { meets: true, criteria: CRITERIA.map((criterion, i) => ({ criterion, verdict: i === 0 ? 'UNCHECKED' : 'MET', evidence: i === 1 ? '' : 'q' })) };
  assert.equal(signoffTableGap(bare, CRITERIA).kind, 'no_evidence', 'no evidence is named before a third word');
  assert.equal(signoffTableGap({ meets: true, criteria: [table('MET', 'MET', 'MET').criteria[0]] }, CRITERIA).kind, 'missing_rows');
});

test('the parser still reads FAILED-shaped rows as failures and `meets:true` with a third word as a sign-off (the table gate under signoff_table.required refuses it)', () => {
  const failed = normaliseCritique(table('MET', 'FAIL', 'MET'));
  assert.equal(failed.meets, false);
  assert.equal(failed.failures.length, 1);
  assert.equal(normaliseCritique(table('MET', 'UNCHECKED', 'MET')).meets, true, 'unchanged: refusing it needs signoff_table.required');
});

test('signoff_table.required through a whole run: a judge whose last row says UNCHECKED is not heard (INCOMPLETE_TABLE, unreadable_verdict), is re-asked once per round, the run does not pass; off, the old behaviour', async () => {
  const on = await go('mock-critic-unchecked-row', { signoff_table: { required: true }, maxRounds: 2 });
  assert.equal(on.passed, false);
  assert.ok(on.signoffTableGaps.length >= 1 && on.signoffTableGaps.every(g => g.lab === 'la' && g.kind === 'unreadable_verdict'), JSON.stringify(on.signoffTableGaps));
  const off = await go('mock-critic-unchecked-row', { maxRounds: 2 });
  assert.equal(off.passed, true, 'off: a third word still signs off, as before; the rule is opt-in with the table switch');
});

// Owner, 7 Oct 2026 ("Failed." / "NOT MET." and similar punctuated forms read as a failing row everywhere, not only under signoff_table.required): one reading of a verdict cell for the parser and the gate.
const FAILED_SPELLINGS = ['Failed .', 'NOT MET .', 'Failed.', 'FAILED.', 'FAIL.', 'Fail!', 'NOT MET.', 'Not Met!', 'not_met.', 'UNMET.', 'No.', ' failed. ', 'FAILED..'];
const MET_SPELLINGS = ['MET .', 'Met.', 'MET!', 'Pass.', 'PASSED.', 'Yes.', ' met. '];

test('a punctuated FAILED-shaped row is a failure in the parser, with or without signoff_table.required; a punctuated MET row is a pass (one reading of a verdict cell)', () => {
  const row = verdict => ({ meets: true, criteria: CRITERIA.map((criterion, i) => ({ criterion, verdict: i === 1 ? verdict : 'MET', evidence: 'quoted' })) });
  for (const w of FAILED_SPELLINGS) {
    const c = normaliseCritique(row(w));
    assert.equal(c.meets, false, `${JSON.stringify(w)}: the row is a failure, so the reply does not sign off`);
    assert.deepEqual(c.failures.map(f => f.criterion), [CRITERIA[1]], JSON.stringify(w));
    assert.equal(signoffTableGap(row(w), CRITERIA), null, `${JSON.stringify(w)}: a readable verdict (the gate only matters for a sign-off)`);
  }
  for (const w of MET_SPELLINGS) {
    assert.equal(normaliseCritique(row(w)).meets, true, JSON.stringify(w));
    assert.equal(signoffTableGap(row(w), CRITERIA), null, JSON.stringify(w));
  }
  // all rows punctuated, no `meets` key: the table alone still counts as a pass
  assert.equal(normaliseCritique({ criteria: CRITERIA.map(criterion => ({ criterion, verdict: 'Met.', evidence: 'q' })) }).meets, true);
  assert.equal(isMetVerdict('Met.'), true, 'the checkable-criterion counter reads it the same way');
});

test('two rows for one criterion: every one of them must say MET or FAILED, in either order', () => {
  const dup = (a, b) => ({ meets: true, criteria: [...CRITERIA.map(criterion => ({ criterion, verdict: 'MET', evidence: 'q' })), { criterion: CRITERIA[1], verdict: a, evidence: 'q' }, { criterion: CRITERIA[1], verdict: b, evidence: 'q' }] });
  assert.equal(signoffTableGap(dup('MET', 'UNCHECKED'), CRITERIA)?.kind, 'unreadable_verdict');
  assert.equal(signoffTableGap(dup('UNCHECKED', 'MET'), CRITERIA)?.kind, 'unreadable_verdict');
  assert.equal(signoffTableGap(dup('MET', 'MET'), CRITERIA), null);
});

test('3b: a padded or re-cased objection id is the same objection (an unquoted withdrawal under it is refused and carried, not dropped)', () => {
  for (const id of [' O-aaaaaaaa', 'O-AAAAAAAA', 'o-aaaaaaaa ']) {
    const r = applyAnswers({ lab: 'a', critique: { failures: [], answers: [{ id, status: 'withdrawn', evidence: 'fixed, trust me' }] }, own: OWN, shownDraft: DRAFT, round: 2 });
    assert.deepEqual(r.records.map(x => x.effect), ['withdrawal_refused'], JSON.stringify(id));
    assert.deepEqual(r.carried.map(c => c.id), ['O-aaaaaaaa'], JSON.stringify(id));
  }
});

test('the refused table is re-asked ONCE per round under the third word too (the existing per-reason cap), never twice', async () => {
  const seen = [];
  const { setPromptSpy } = await import('../src/chain.js');
  setPromptSpy(p => seen.push(p.label));
  try { await go('mock-critic-unchecked-row', { signoff_table: { required: true }, maxRounds: 1 }); } finally { setPromptSpy(null); }
  assert.ok(seen.includes('panel-1-la-reask1'), seen.join(', '));
  assert.equal(seen.includes('panel-1-la-reask2'), false);
});
