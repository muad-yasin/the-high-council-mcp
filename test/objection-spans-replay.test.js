// 0.8.4 D14 (C&C 09 Nov 2026, condition D10; WORDING U2-w1): "the same after a resume". A span marked `excerpt` says the seat copied it from an excerpt it was SHOWN. The visible set (excerptsForQuotes, chain.js) grows stage by stage through record() ->
// showExcerptsAfter(label), and a stage that replays from the cache passes through record() like a live one, so a replayed critic stage rebuilds the same set at the same point. Pinned through a whole run whose critic replies are injected
// through the stage cache (the replay): a span that sits only in an excerpt recorded LATER marks null, and the same span after the excerpt was shown marks `excerpt`; the quote check's in_excerpt reads the same helper and agrees. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { buildExcerptEntry } from '../src/excerpt-record.js';
import { excerptsBlock, inExcerptLabel } from './held-prompts/held-084-a.js';

afterEach(() => { setPromptSpy(null); setCache(null); setHeldForTest(null); });
const WORDS = { excerptsBlock, inExcerptLabel };
const FENCED = '```text\n// notes.txt\nthe round has a fixed length\n```';
const EX_TEXT = 'function retry() {\n  return attempts < LIMIT;\n}';
const AT = '2026-11-09T05:00:00.000Z';
const CRITERION = 'It names who decides.';
const DRAFT = '# Plan\n\nBody text.\n\nStep 3: the author may accept each post.\n\nAssumptions: none.';
const REQUEST = `Review this plan.\n\n${FENCED}`;
const verdictWith = quote => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'NOT MET', evidence: 'Step 3 does not say.' }], failures: [{ criterion: CRITERION, problem: 'src/retry.js retries without a limit, so nobody decides.', fix: 'Name the decider.', quote }], verdict_line: 'One criterion failed.' });
const entry = stage => buildExcerptEntry(1, { request_kind: 'session_read', requested_by: null, objection_id: null, why: 'To check the retry.', source_kind: 'repository_file', path: 'src/retry.js', lines: '1-3', text: EX_TEXT, file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage: stage, scans: { key_shape: 'clear', personal_data: 'not_scanned' }, approval: { status: 'not_required', actor: null, channel: null, at: AT, reason: null } });

async function runWith(stage, maxRounds, verdictOf = verdictWith) {
  setHeldForTest(WORDS);
  setPromptSpy(() => {});
  const quotes = { 'panel-1-jx': 'return attempts < LIMIT;', 'panel-2-jx': 'return attempts < LIMIT;' };
  setCache({ get: label => (quotes[label] !== undefined ? { text: verdictOf(quotes[label]), usage: { input: 10, output: 10 }, usd: 0, provider: 'mock', model: 'mock-critic-a' } : null) });
  setBudget(null);
  return runChain({ request: REQUEST, draft: DRAFT, excerpts: [entry(stage)], log: () => {}, config: { name: 'spans-ex', signoff: 'unanimous', maxRounds, criteria: [CRITERION], seats: { reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'jx' }] } } });
}
const spansOfLast = r => (r.lastCritique?.failures ?? []).filter(f => f.quote === 'return attempts < LIMIT;').map(f => ({ status: f.quote_status, located: (f.spans ?? []).map(s => s.located_in) }));

test('D10: the critic stage of round 1 replays BEFORE the excerpt (recorded at revise-1) is shown: its span is null; the stage of round 2 replays after it: the same span is `excerpt`, and quote_status reads the same helper (in_excerpt)', async () => {
  const one = await runWith('revise-1', 1);
  assert.deepEqual(spansOfLast(one), [{ status: 'unverified', located: [null] }]);
  const two = await runWith('revise-1', 2);
  assert.deepEqual(spansOfLast(two), [{ status: 'in_excerpt', located: ['excerpt'] }]);
});

test('D10: an excerpt recorded LATER (at revise-2) is not visible to the round-2 critic either: its span marks null on the replay, and the quote check agrees (unverified)', async () => {
  const later = await runWith('revise-2', 2);
  assert.deepEqual(spansOfLast(later), [{ status: 'unverified', located: [null] }]);
});

// through a whole run: the FAILED table row's quoted evidence is marked too (failedRowsOf at the panel site passes the verdict's rows to markFailures), paired with the failure of the same criterion
const verdictWithRow = quote => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'NOT MET', evidence: 'Step 3 says "the author may accept each post" and nothing about "an invented sentence here".' }], failures: [{ criterion: CRITERION, problem: 'src/retry.js retries without a limit, so nobody decides.', fix: 'Name the decider.', quote }], verdict_line: 'no' });
test('D14 through a run: the quoted evidence of the FAILED row of the failure\'s criterion is marked beside the quote (draft and none), and the failure keeps its quote span', async () => {
  const r = await runWith('revise-1', 1, verdictWithRow);
  const f = (r.lastCritique?.failures ?? []).find(x => x.quote === 'return attempts < LIMIT;');
  assert.ok(f, 'the objection is on the record');
  assert.deepEqual((f.spans ?? []).map(x => [x.text, x.located_in]), [['return attempts < LIMIT;', null], ['the author may accept each post', 'draft'], ['an invented sentence here', null]]);
});

test('D14 declared pin (text): the stall-path adoption copies the raiser\'s marks beside quote_status and excerpt_id; the settleInCallRulings site makes none (marks: false)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.\(f\.excerpt_id \? \{ excerpt_id: f\.excerpt_id \} : \{\}\), \.\.\.\(f\.spans \? \{ spans: f\.spans \} : \{\}\), lab: a\.seat, id: a\.id, sustained_from:/);
  assert.match(src, /markFailures\(rulable\.map\(r => \(\{ \.\.\.r \}\)\), fencedSource, draft \+ changedSince\(lastPatches\), excerptsForQuotes\(\), \{ marks: false \}\)/);
});

