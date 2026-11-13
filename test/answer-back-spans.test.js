// 0.8.4 D14 (plan A T7.3, "Keep: a sustained answer's passage is marked too, as a record only"; WORDING U2-w4): with the texts of the call (src/quote-check.js spanTexts), the `sustained` row of an answer carries `spans`
// ([{ text, located_in }]: the quoted passages of the answer's evidence, as markSpans marks them). Without the texts nothing differs; a withdrawal's rule (a located span in the draft or in shown peer evidence) is unchanged,
// and the marks keep or drop nothing. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAnswers } from '../src/answer-back.js';
import { spanTexts } from '../src/quote-check.js';

const OWN = [{ id: 'O-aaaaaaaa', criterion: 'C1', problem: 'p1' }];
const DRAFT = 'The worker retries failed requests up to five times.';
const FENCED = '```text\n// notes.txt\nthe round has a fixed length\n```';
const texts = spanTexts({ draft: DRAFT, fenced: FENCED, excerpts: [{ id: 'E-1', text: 'function retry() { return attempts < LIMIT; }' }], request: 'Plan a tea service.', criteria: ['It names who decides.'] });
const answer = (status, evidence, extra = {}) => applyAnswers({ lab: 'a', critique: { failures: [], answers: [{ id: 'O-aaaaaaaa', status, evidence }] }, own: OWN, shownDraft: DRAFT, round: 2, ...extra });

test('a sustained answer\'s quoted passages are marked, in the order of the rule; the effect is unchanged and the objection is still carried', () => {
  const r = answer('sustained', 'Still true: "retries failed requests up to five times", also "return attempts < LIMIT;" and "something the judge invented".', { texts });
  assert.deepEqual(r.records, [{ id: 'O-aaaaaaaa', status: 'sustained', effect: 'sustained', spans: [{ text: 'retries failed requests up to five times', located_in: 'draft' }, { text: 'return attempts < LIMIT;', located_in: 'excerpt' }, { text: 'something the judge invented', located_in: null }] }]);
  assert.equal(r.carried.length, 1, 'a sustained objection is carried as before');
});

test('without the texts, or with evidence that quotes nothing, the row is exactly as before (no spans key)', () => {
  assert.deepEqual(answer('sustained', 'Still true: "retries failed requests up to five times".').records, [{ id: 'O-aaaaaaaa', status: 'sustained', effect: 'sustained' }]);
  assert.deepEqual(answer('sustained', 'Still true, nothing quoted.', { texts }).records, [{ id: 'O-aaaaaaaa', status: 'sustained', effect: 'sustained' }]);
});

test('a withdrawal and an answer of any other word are untouched: no spans on their rows, and the withdrawal rule decides as before', () => {
  assert.deepEqual(answer('withdrawn', 'Now: "retries failed requests up to five times".', { texts }).records, [{ id: 'O-aaaaaaaa', status: 'withdrawn', quoted: true, effect: 'withdrawn' }]);
  assert.equal(answer('withdrawn', 'Now: "return attempts < LIMIT;".', { texts }).records[0].effect, 'withdrawal_refused', 'a passage that sits only in an excerpt is not a located span of the DRAFT: the bar of a withdrawal is unchanged');
  assert.equal('spans' in answer('fixed', 'Now: "retries failed requests up to five times".', { texts }).records[0], false);
});

test('the call sites of the panel pass the texts (text pin on src/chain.js)', () => {
  const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/applyAnswers\(\{[^\n]*shownDraft: draft, round[^\n]*\}\)/g)].map(m => m[0]);
  assert.equal(calls.length, 2);
  for (const c of calls) assert.match(c, /texts: spanTexts\(\{ draft, fenced: fencedSource, excerpts: excerptsForQuotes\(\), request, criteria \}\)/);
});
