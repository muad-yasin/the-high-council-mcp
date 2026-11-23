// 0.8.4 D14 (plan A T7.2/T7.3, T7 order of work step 1; WORDING U2-w1): the located marks. markFailures attaches `spans: [{ text, located_in }]` beside quote_status: the quote itself, the quoted passages of the problem and the fix, and those of the
// evidence of the FAILED table row of the same criterion; `located_in` is the first of draft, fenced_source, excerpt, request, criteria that holds the span (normQuote on both sides), else null. Record only: nothing is gated or removed, the objection id is
// the id without the marks, and no seat prompt carries them. The plan's test: one objection with three spans, found in the fenced source only, in an excerpt only, and in none; with no excerpt record the middle one is null. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markSpans } from '../src/post-quotes.js';
import { markFailures } from '../src/quote-check.js';
import { objectionId } from '../src/objection-ids.js';
import * as R from '../src/roles.js';

const FENCED = '```js\n// src/retry.js\nexport function retry(fn) { return fn(); }\nconst LIMIT = 5;\n```';
const EXCERPT = { id: 'E-1', text: 'function backoff(n) { return n * 2000; }' };
const DRAFT = 'The worker retries failed requests up to five times.';
const failure = over => ({ criterion: 'It names the retry limit.', problem: 'See src/retry.js: it never backs off.', fix: 'Add a pause.', ...over });

test('MIMOV26PRO-2 shape (plan A T7 tests): three spans found in the fenced source only, in an excerpt only, and in none; all three stay in failures; the id equals the id without the marks', () => {
  const f = failure({ quote: 'export function retry(fn) { return fn(); }', problem: 'The pause is missing: "function backoff(n) { return n * 2000; }" is the only wait, and "nothing else is mentioned anywhere" at all.' });
  const [m] = markFailures([f], FENCED, DRAFT, [EXCERPT]);
  assert.deepEqual(m.spans.map(s => s.located_in), ['fenced_source', 'excerpt', null]);
  assert.deepEqual(m.spans.map(s => s.text), ['export function retry(fn) { return fn(); }', 'function backoff(n) { return n * 2000; }', 'nothing else is mentioned anywhere']);
  assert.equal(markFailures([f, failure({ problem: 'second' })], FENCED, DRAFT, [EXCERPT]).length, 2, 'no failure is removed');
  assert.equal(objectionId('la', m), objectionId('la', f), 'the O- id equals the id computed without the marks (PIN: the id reads quote, criterion and problem only)');
  // the no-excerpt shape marks the middle span null
  const [n] = markFailures([f], FENCED, DRAFT, []);
  assert.deepEqual(n.spans.map(s => s.located_in), ['fenced_source', null, null]);
  // fails when the marks are computed against the draft alone: the first span reads null there
  assert.equal(markSpans(['export function retry(fn) { return fn(); }'], [['draft', DRAFT]])[0].located_in, null);
});

test('the order: the FIRST of draft, fenced_source, excerpt, request, criteria that holds the span names it; request and criteria are texts of their own', () => {
  const span = 'a sentence that sits in several texts';
  const texts = { draft: `x ${span} x`, fenced_source: span, excerpt: span, request: span, criteria: span };
  const names = ['draft', 'fenced_source', 'excerpt', 'request', 'criteria'];
  names.forEach((name, k) => {
    const rest = names.slice(k);
    assert.equal(markSpans([span], rest.map(n => [n, texts[n]]))[0].located_in, name);
  });
  const [m] = markFailures([failure({ quote: 'The request asks for a tea service for twelve guests' })], '', 'nothing here', [], { request: 'Plan: the request asks for a tea service for twelve guests today.', criteria: ['It lists twelve guests.'] });
  assert.equal(m.spans[0].located_in, 'request');
  const [c] = markFailures([failure({ quote: 'It lists the guests by name please' })], '', 'nothing here', [], { request: 'Plan a tea service.', criteria: ['It lists the guests by name please.'] });
  assert.equal(c.spans[0].located_in, 'criteria');
});

test('the minimum and the normalising: a span of fewer than 8 characters once normalised makes no entry; the same span twice is one entry; case, emphasis and quote marks do not matter', () => {
  assert.deepEqual(markSpans(['short', 'ab  cd', '12345678'], [['draft', '12345678 and more']]).map(s => [s.text, s.located_in]), [['12345678', 'draft']]);
  assert.equal(markSpans(['The  Worker *Retries* it', 'the worker retries it'], [['draft', 'The worker retries it once.']]).length, 1);
  assert.equal(markSpans(['THE WORKER "RETRIES" IT'], [['draft', 'the worker retries it once']])[0].located_in, 'draft');
});

test('DIVERGENCE (declared): located_in compares with normQuote (case-insensitive) while quote_status compares case-sensitively, so a span can be located while the quote reads unverified', () => {
  const f = failure({ quote: 'EXPORT FUNCTION RETRY(FN) { RETURN FN(); }' });
  const [m] = markFailures([f], FENCED, DRAFT, []);
  assert.equal(m.quote_status, 'unverified');
  assert.equal(m.spans[0].located_in, 'fenced_source');
});

test('a FAILED row of the same criterion adds the quoted passages of its evidence (the first such row pairs); a row of another criterion does not; the same span is one entry', () => {
  const rows = [{ criterion: 'Another criterion.', evidence: 'the "retry loop in the worker" is elsewhere' }, { criterion: 'it names the retry limit', evidence: 'Section two says "retries failed requests up to five times" and "an invented sentence here".' }, { criterion: 'It names the retry limit.', evidence: 'the "second row is ignored entirely"' }];
  const [m] = markFailures([failure({ problem: 'No limit.', fix: '' })], '', DRAFT, [], { rows, criteria: ['It names the retry limit.'] });
  assert.deepEqual(m.spans.map(s => [s.text, s.located_in]), [['retries failed requests up to five times', 'draft'], ['an invented sentence here', null]]);
});

test('spans exist whether or not the task is checkable (no fenced source, no excerpt: no quote_status, but the marks), and are absent when a failure quotes nothing', () => {
  const [a, b] = markFailures([failure({ quote: 'retries failed requests up to five times' }), failure({ problem: 'plain remark', fix: '' })], '', DRAFT, []);
  assert.equal(a.quote_status, undefined);
  assert.deepEqual(a.spans, [{ text: 'retries failed requests up to five times', located_in: 'draft' }]);
  assert.equal('spans' in b, false);
});

test('the input is never mutated and a spans field on an input copy is not inherited: the marks are made here', () => {
  const f = failure({ quote: 'retries failed requests up to five times', spans: [{ text: 'stale', located_in: 'draft' }] });
  const copy = JSON.parse(JSON.stringify(f));
  const [m] = markFailures([f], FENCED, DRAFT, []);
  assert.deepEqual(f, copy);
  assert.deepEqual(m.spans, [{ text: 'retries failed requests up to five times', located_in: 'draft' }]);
});

test('NO SEAT PROMPT carries them (D9, pinned where failures are serialized into prompts): reviserUser, disputeUser and disputeReviewUser are byte-identical with and without `spans` on the failures', () => {
  const base = { criterion: 'It lists the steps.', problem: 'No pour step.', fix: 'Add one.', quote: 'Steep the tea.', quote_status: 'verified', severity: 6.5, lab: 'la', id: 'O-aaaaaaaa', model: 'm1', model_layer: 2 };
  const marked = { ...base, spans: [{ text: 'Steep the tea.', located_in: 'draft' }, { text: 'something invented', located_in: null }] };
  const args = { request: 'Make tea.', criteria: ['It lists the steps.'], draft: 'Boil water.' };
  assert.equal(R.reviserUser({ ...args, critique: { failures: [marked], verdict_line: 'no' }, severity: true }), R.reviserUser({ ...args, critique: { failures: [base], verdict_line: 'no' }, severity: true }));
  assert.equal(R.disputeUser({ ...args, failures: [marked] }), R.disputeUser({ ...args, failures: [base] }));
  assert.equal(R.disputeReviewUser({ request: 'Make tea.', objections: [{ ...marked, index: 1 }], draftBefore: 'a', draftAfter: 'b' }), R.disputeReviewUser({ request: 'Make tea.', objections: [{ ...base, index: 1 }], draftBefore: 'a', draftAfter: 'b' }));
  assert.doesNotMatch(R.reviserUser({ ...args, critique: { failures: [marked] } }), /located_in|something invented/);
});

test('marks: false (the in-call ruling path, whose draft is not the one the raiser was shown) makes none, and the status is still made', () => {
  const f = failure({ quote: 'retries failed requests up to five times' });
  const [m] = markFailures([f], FENCED, DRAFT, [], { marks: false });
  assert.equal('spans' in m, false);
  const [k] = markFailures([f], FENCED, DRAFT, []);
  assert.deepEqual({ ...k, spans: undefined }, { ...m, spans: undefined }, 'everything else is the same');
});

