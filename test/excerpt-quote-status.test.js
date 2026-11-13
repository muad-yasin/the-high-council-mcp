// 0.8.4 D41 (plan A T5.3, STEP3 A7; test/excerpt-quote-status.test.js of the plan): a quote that is not in the fenced source but IS in a recorded excerpt gets quote_status 'in_excerpt' with the excerpt's id, and stays in
// `failures`. The rule on markFailures itself (rows 1-6), and through a whole run (row 7: the judge's reply is injected through the stage cache, as test/quote-check-chain.test.js does): the status is assigned only
// once the excerpt's words and the label's words are recorded, it is never printed raw into the reviser's prompt, and it appears in the report's record. The vocabularies of quote_status (objection, deep dive; the advice one left with the add-on in 0.8.4)
// stay apart. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markFailures, quoteWarnings } from '../src/quote-check.js';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { buildExcerptEntry } from '../src/excerpt-record.js';
import { excerptsBlock, inExcerptLabel } from './held-prompts/held-084-a.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setPromptSpy(null); setCache(null); setHeldForTest(null); });
const WORDS = { excerptsBlock, inExcerptLabel };
const FENCED = '```text\n// notes.txt\nthe round has a fixed length\n```';
const EX_TEXT = 'function retry() {\n  return attempts < LIMIT;\n}';
const AT = '2026-11-09T05:00:00.000Z';
const ex = (id, text, over = {}) => ({ id, text, approval: { status: 'not_required' }, ...over });
const CLAIM = { criterion: 'It names who decides.', problem: 'src/retry.js retries without a limit.' };   // looks like a repository claim (a path)

test('1. a quote found only in a recorded excerpt gets in_excerpt with the id, and the failure stays', () => {
  const [f] = markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], FENCED, '', [ex('E-3', EX_TEXT)]);
  assert.deepEqual([f.quote_status, f.excerpt_id], ['in_excerpt', 'E-3']);
  assert.equal(markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], FENCED, '', [ex('E-3', EX_TEXT)]).length, 1, 'no failure is removed');
});

test('2. the fenced source wins when the quote is in both; a quote in neither stays unverified (the control: the same quote with the excerpt absent)', () => {
  const [both] = markFailures([{ ...CLAIM, quote: 'the round has a fixed length' }], FENCED, '', [ex('E-1', 'the round has a fixed length')]);
  assert.equal(both.quote_status, 'verified'); assert.equal('excerpt_id' in both, false);
  const [none] = markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], FENCED, '', []);
  assert.equal(none.quote_status, 'unverified');
  const [other] = markFailures([{ ...CLAIM, quote: 'words in no place at all' }], FENCED, '', [ex('E-3', EX_TEXT)]);
  assert.equal(other.quote_status, 'unverified');
});

test('3. without the excerpts argument (or an empty one) the rule is the old one, byte for byte', () => {
  const input = [{ ...CLAIM, quote: 'return attempts < LIMIT;' }, { ...CLAIM }, { criterion: 'c', problem: 'a plain remark' }];
  assert.deepEqual(markFailures(input, FENCED, 'draft'), markFailures(input, FENCED, 'draft', []));
  assert.deepEqual(markFailures(input, FENCED, 'draft', undefined), markFailures(input, FENCED, 'draft'));
});

test('4. an entry with no text (a refusal, a drop, a request nobody answered) is never a place a quote can be found', () => {
  const [f] = markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], FENCED, '', [ex('E-1', null), ex('E-2', ''), { id: 'E-3' }]);
  assert.equal(f.quote_status, 'unverified');
});

test('5. a failure with no repository claim, or no quote, is marked as before, whatever the excerpts hold', () => {
  const [plain, bare] = markFailures([{ criterion: 'c', problem: 'a plain remark', quote: 'return attempts < LIMIT;' }, { ...CLAIM }], FENCED, '', [ex('E-3', EX_TEXT)]);
  assert.equal('quote_status' in plain, false); assert.equal(bare.quote_status, 'unquoted');
});

test('6. in_excerpt draws no warning (the quote is on the record); with no fenced source and NO excerpt shown nothing is marked at all; with no fenced source and an excerpt shown the quote is checked against the excerpt', () => {
  const [f] = markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], FENCED, '', [ex('E-3', EX_TEXT)]);
  assert.deepEqual(quoteWarnings([f], 'panel'), []);
  const [noFence] = markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], '', '', []);
  assert.equal('quote_status' in noFence, false);
  // CHANGED ACCEPTED (0.8.4 A7, commit 73ee61b5): OLD with no fenced source nothing was marked even when an excerpt was shown; NEW an unfenced task is checkable once an excerpt is visible (the prompt clause asks for quotes from it). WHY: A7, ruled by C&C 09 Nov 2026
  const [unfenced] = markFailures([{ ...CLAIM, quote: 'return attempts < LIMIT;' }], '', '', [ex('E-3', EX_TEXT)]);
  assert.deepEqual([unfenced.quote_status, unfenced.excerpt_id], ['in_excerpt', 'E-3']);
});

// ---- through a whole run ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const CRITERION = 'It names who decides.';
const DRAFT = '# Plan\n\nBody text.\n\nStep 3: the author may accept each post.\n\nAssumptions: none.';
const REQUEST = `Review this plan.\n\n${FENCED}`;
const verdictWith = quote => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'NOT MET', evidence: 'Step 3 does not say.' }], failures: [{ criterion: CRITERION, problem: 'src/retry.js retries without a limit, so nobody decides.', fix: 'Name the decider.', quote }], verdict_line: 'One criterion failed.' });
const entry = () => buildExcerptEntry(1, { request_kind: 'session_read', requested_by: null, objection_id: null, why: 'To check the retry.', source_kind: 'repository_file', path: 'src/retry.js', lines: '1-3', text: EX_TEXT, file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage: 'revise-1', scans: { key_shape: 'clear', personal_data: 'not_scanned' }, approval: { status: 'not_required', actor: null, channel: null, at: AT, reason: null } });
async function runWith(words, maxRounds) {
  setHeldForTest(words);
  const prompts = [];
  setPromptSpy(p => prompts.push({ label: p.label, user: p.user }));
  const quotes = { 'panel-1-jx': 'the round has a fixed length', 'panel-2-jx': 'return attempts < LIMIT;' };
  setCache({ get: label => (quotes[label] !== undefined ? { text: verdictWith(quotes[label]), usage: { input: 10, output: 10 }, usd: 0, provider: 'mock', model: 'mock-critic-a' } : null) });
  setBudget(null);
  const r = await runChain({ request: REQUEST, draft: DRAFT, excerpts: [entry()], log: () => {}, config: { name: 'qc-ex', signoff: 'unanimous', maxRounds, criteria: [CRITERION], seats: { reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'jx' }] } } });
  return { r, prompts };
}
const round2 = r => (r.lastCritique?.failures ?? []).filter(f => f.quote === 'return attempts < LIMIT;');

test('7a. through a run (two rounds): round 2 quotes the excerpt shown after the first revision: in_excerpt with E-1 on the record, not treated as invented', async () => {
  const { r } = await runWith(WORDS, 2);
  assert.ok(round2(r).length > 0, 'the round-2 objection is on the record (lastCritique)');
  assert.deepEqual([round2(r)[0].quote_status, round2(r)[0].excerpt_id], ['in_excerpt', 'E-1']);
  assert.equal((r.quoteFindings || []).filter(w => /does NOT appear/.test(w)).length, 0, 'not treated as invented');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a second run with inExcerptLabel held back asserted that the same quote was 'unverified' (a status the prompts could not word is never assigned). NEW: removed; the assertions above pin the recorded state (in_excerpt with E-1, not invented) and 7b pins the label in the reviser prompt. WHY: inExcerptLabel is recorded (src/prompts/recorded-084-a.js), so no shipped run holds the label back.
});

test('7b. through a run (three rounds): in_excerpt is never printed raw into ANY prompt of the run; the label stands in the place of the status in the reviser\'s', async () => {
  const { prompts } = await runWith(WORDS, 3);
  assert.ok(prompts.length > 0 && prompts.every(p => !p.user.includes('in_excerpt')), 'no prompt of the run carries the raw status');
  const revise = prompts.filter(p => p.label.startsWith('revise-') && p.user.includes('retries without a limit'));
  assert.ok(revise.length > 0, 'the objection reached a reviser prompt');
  assert.ok(revise.some(p => p.user.includes(`(${inExcerptLabel({ excerpt_id: 'E-1' })})`)), 'the label stands in the place of the status');
});

test('8. the schema lists the new value and the id; the vocabularies of quote_status stay apart (the deep dive keeps its own words)', () => {   // CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: three vocabularies (objection, advice, deep dive); the test also read src/advise.js and checked it holds no in_excerpt. NEW: the deep dive only. WHY: src/advise.js left with the advice add-on, so there is no advice vocabulary left to keep apart; the deep-dive check is unchanged.

  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const text = JSON.stringify(schema);
  assert.ok(text.includes('"quote_status":{"enum":["verified","unverified","unquoted","in_excerpt"]}'));
  assert.ok(text.includes('"excerpt_id":{"type":"string","pattern":"^E-[1-9][0-9]*$"'));
  assert.doesNotMatch(readFileSync(join(root, 'src', 'deep-dive.js'), 'utf8'), /in_excerpt/);
});
