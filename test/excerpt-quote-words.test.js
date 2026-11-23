// 0.8.4 A7 + plan A step 4 (C&C 09 Nov 2026, built HELD; WORDING A7-w1..w7): the quote words when excerpts MAY be shown in a run. The gate is RUN-STABLE: decided once at the start of the run (the channel's words recorded,
// not descending, not an advice call, a stage a handling session answers), never per call, so a seat's system text is the same in all of its calls (a clause that appeared at the first excerpt would break every seat's cached
// prefix). Proved here: (1) the word substitution itself, exactly once per phrase, loud when an anchor is missing, the very same text when anything is not recorded; (2) the flag; (3) THROUGH A RUN, the direct test the ruling
// names: an unfenced run with an excerpt shown mid-run, a seat's system prompt identical across its calls, identical to today's while the words are held, and carrying the clause from its FIRST call once they are recorded.
// Offline, $0. The words are test data (test/held-prompts/held-084-a.js), injected through setHeldForTest and hidden by overrides that survive the release apply.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { setHeldForTest } from '../src/held-roles.js';
import { withExcerptQuoteWords, systemTextsFor, criteriaSystemOf, panelPromptFor, criticPromptFor } from '../src/stage-system.js';
import { excerptsMayBeShownFor } from '../src/excerpt-channel.js';
import { everySeatOf, runChain, setCache, setBudget, setPromptSpy, ExternalPause } from '../src/chain.js';
import { buildExcerptEntry } from '../src/excerpt-record.js';
import * as H from './held-prompts/held-084-a.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); });
const A7_NAMES = ['criticQuoteFieldPhrase', 'criticQuoteCopiedPhrase', 'criticQuoteNeverSentence', 'reviserQuoteFromSentence', 'reviserQuoteFindPhrase', 'criteriaQuotePhrase', 'criticExcerptOnlyRule', 'reviserExcerptOnlyRule'];
const ALL = { ...H };   // every drafted name of lane A, as the apply will record them
const NONE = Object.fromEntries(Object.keys(H).map(n => [n, undefined]));   // hides them whether or not src/roles.js records them
const noA7 = { ...ALL, ...Object.fromEntries(A7_NAMES.map(n => [n, undefined])) };
const critic = fenced => R.criticSystem(false, { fencedSource: fenced });
const reviser = fenced => R.reviserSystem(false, fenced);
const criteria = fenced => R.criteriaSystem(false, fenced);
const count = (s, sub) => s.split(sub).length - 1;

test('1a. nothing recorded (or only some of the names, or the flag off): every text is the very same string, for every kind and both fenced states', () => {
  for (const words of [NONE, noA7, { ...NONE, criticQuoteFieldPhrase: H.criticQuoteFieldPhrase }]) {
    setHeldForTest(words);
    for (const [kind, make] of [['critic', critic], ['reviser', reviser], ['criteria', criteria]]) for (const fenced of [false, true]) {
      const base = make(fenced);
      assert.equal(withExcerptQuoteWords(base, kind, { fenced, mayShow: true }), base, `${kind} fenced ${fenced}`);
    }
  }
  setHeldForTest(ALL);
  for (const [kind, make] of [['critic', critic], ['reviser', reviser], ['criteria', criteria]]) for (const fenced of [false, true]) assert.equal(withExcerptQuoteWords(make(fenced), kind, { fenced, mayShow: false }), make(fenced), `flag off: ${kind}`);
});

test('1b. FENCED run, words recorded: each phrase that named the fenced source alone is replaced exactly once, in the critic, the reviser and the criteria stage', () => {
  setHeldForTest(ALL);
  const c = withExcerptQuoteWords(critic(true), 'critic', { fenced: true, mayShow: true });
  assert.equal(count(c, H.criticQuoteFieldPhrase()), 1); assert.equal(count(c, H.criticQuoteNeverSentence()), 1);
  // the field phrase is followed by the full stop of its own sentence, and 'copied from ... such.' is the copied phrase: the two overlap by construction, so the copied phrase is seen twice (its own place, and the end of the field sentence); each place is counted by what stands there
  assert.equal(count(c, `${H.criticQuoteFieldPhrase()}.`), 1, 'the field sentence ends with its full stop'); assert.equal(count(c, H.criticQuoteCopiedPhrase()), 2, 'the copied phrase: its own place, and the end of the field sentence');
  assert.equal(c.includes('the exact text from the fenced source it rests on'), false); assert.equal(c.includes('Never write a "quote" that is not in the fenced source.'), false);
  const r = withExcerptQuoteWords(reviser(true), 'reviser', { fenced: true, mayShow: true });
  assert.equal(count(r, H.reviserQuoteFromSentence()), 1); assert.equal(count(r, H.reviserQuoteFindPhrase()), 1);
  const k = withExcerptQuoteWords(criteria(true), 'criteria', { fenced: true, mayShow: true });
  assert.equal(count(k, H.criteriaQuotePhrase()), 1); assert.equal(k.includes('unless the fenced source shows it.'), false);
});

test('1c. UNFENCED run, words recorded: the critic gets its rule at the end and NO reply-format field (S14 owns the quote field), the reviser a rule at its end; the criteria stage nothing', () => {
  setHeldForTest(ALL);
  const base = critic(false); assert.equal(base.includes('"quote":'), false, 'today an unfenced critic has no quote field');
  const c = withExcerptQuoteWords(base, 'critic', { fenced: false, mayShow: true });
  assert.ok(c.endsWith(H.criticExcerptOnlyRule()));
  assert.equal(c.slice(0, c.length - H.criticExcerptOnlyRule().length), base, 'only the rule is added: the reply format is untouched');
  assert.ok(withExcerptQuoteWords(reviser(false), 'reviser', { fenced: false, mayShow: true }).endsWith(H.reviserExcerptOnlyRule()));
  assert.equal(withExcerptQuoteWords(criteria(false), 'criteria', { fenced: false, mayShow: true }), criteria(false));
});

test('1d. a prompt that does not carry the anchor exactly once is a loud error, never a silent half-edit', () => {
  setHeldForTest(ALL);
  assert.throws(() => withExcerptQuoteWords('a critic text with no quote rule', 'critic', { fenced: true, mayShow: true }), /must carry the sentence of criticQuoteFieldPhrase once \(found 0\)/);
  assert.throws(() => withExcerptQuoteWords('x', 'bogus', { mayShow: true }), /unknown kind/);
});

test('2. the run-stable flag: the words recorded, a stage a handling session answers (an external seat, or a waiting questions stage); never a descending chain, an advice call or an all-mock chain', () => {
  const seat = p => ({ provider: p, model: 'm' });
  const mk = extra => ({ seats: { critics: [seat('mock')], reviser: seat('mock') }, ...extra });
  setHeldForTest(ALL);
  assert.equal(excerptsMayBeShownFor(mk({}), everySeatOf), false, 'all-mock: can never show one');
  assert.equal(excerptsMayBeShownFor({ seats: { critics: [seat('mock')], reviser: seat('external') } }, everySeatOf), true, 'an external reviser');
  assert.equal(excerptsMayBeShownFor(mk({ questions: { max: 3 } }), everySeatOf), true, 'a waiting questions stage');
  assert.equal(excerptsMayBeShownFor(mk({ questions: { max: 3, wait: false } }), everySeatOf), false, 'questions with defaults taken');
  assert.equal(excerptsMayBeShownFor({ seats: { reviser: seat('external') }, descending: true }, everySeatOf), false);
  // CHANGED ACCEPTED TEST (0.8.4 add-on removal, box set fix): OLD: never an advice call (advise.enabled). NEW: the row is gone. WHY: the advice add-on is removed.
  setHeldForTest(NONE);
  assert.equal(excerptsMayBeShownFor({ seats: { reviser: seat('external') } }, everySeatOf), false, 'words not recorded');
});

// ---- the direct test of the ruling: an unfenced run with an excerpt shown mid-run --------------------------------------------------------------------------------------------------------------------------
const CRITERION = 'It names who decides.';
const verdictFail = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'NOT MET', evidence: 'Step 3 does not say.' }], failures: [{ criterion: CRITERION, problem: 'Step 3 never says who decides.', fix: 'Name the decider.' }], verdict_line: 'One criterion failed.' });
const entry = () => buildExcerptEntry(1, { request_kind: 'session_read', requested_by: null, objection_id: null, why: 'To check.', source_kind: 'repository_file', path: 'src/a.js', lines: '1-2', text: 'alpha one\nalpha two', file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage: 'revise-1', scans: { key_shape: 'clear', personal_data: 'not_scanned' }, approval: { status: 'not_required', actor: null, channel: null, at: '2026-11-09T05:00:00.000Z', reason: null } });
async function systemsFor(words) {
  setHeldForTest(words);
  const seen = [];
  setPromptSpy(p => seen.push({ label: p.label, system: p.system }));
  setCache({ get: label => (label === 'panel-1-jx' ? { text: verdictFail, usage: { input: 10, output: 10 }, usd: 0, provider: 'mock', model: 'mock-critic-a' }
    : /^revise-\d+$/.test(label) ? { text: '# Plan\n\nBody.\n\nStep 3: the author decides.\n\nAssumptions: none.', usage: { input: 10, output: 10 }, usd: 0, provider: 'external', model: 'claude-code-session' } : null) });
  setBudget(null);
  try { await runChain({ request: 'Review this plan.', draft: '# Plan\n\nBody text.\n\nAssumptions: none.', excerpts: [entry()], log: () => {}, config: { name: 'a7', signoff: 'unanimous', maxRounds: 3, criteria: [CRITERION], seats: { reviser: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'jx' }] } } }); } catch (err) { if (!(err instanceof ExternalPause)) throw err; }   // an unanswered external stage ends the run; the systems collected up to it are what is compared
  return seen;
}

test('3. THROUGH A RUN (unfenced, an excerpt shown after the first revision): a seat\'s system prompt is identical across its calls; with the A7 words HELD it is identical to a run with none of the lane A words; with them recorded the clause is there from its FIRST call', async () => {
  const noRequestWords = { textRequestsJudgeField: undefined, textRequestsProposerField: undefined };   // D18's two sentences ride the same flag; they are hidden in both arms so the comparison is about A7's words alone (the judge's sentence is added only to critic prompts, src/stage-system.js criticPromptFor, and the proposer's to the debate system text; no reviser text carries either)
  const held = await systemsFor({ ...noA7, ...noRequestWords });
  const none = await systemsFor({ ...noA7, ...noRequestWords, excerptsBlock: undefined, sessionReadsField: undefined });   // the channel's two words hidden: the flag is off, every other word is the same, so the only difference is A7's own path
  const panelHeld = held.filter(s => /^panel-/.test(s.label));
  assert.ok(panelHeld.length >= 2, `the judge was asked in at least two rounds (${held.map(s => s.label).join(', ')})`);
  assert.equal(new Set(panelHeld.map(s => s.system)).size, 1, 'held: the same system text in every call of the seat');
  assert.deepEqual(held.map(s => [s.label, s.system]).filter(([l]) => /^(panel|revise)-/.test(l)), none.map(s => [s.label, s.system]).filter(([l]) => /^(panel|revise)-/.test(l)), 'held: identical to a run whose flag is off (the channel words hidden) and whose other words are the same');
  const rec = await systemsFor(ALL);
  const panelRec = rec.filter(s => /^panel-/.test(s.label));
  assert.equal(new Set(panelRec.map(s => s.system)).size, 1, 'recorded: still the same text in every call of the seat');
  assert.ok(panelRec[0].system.includes(H.criticExcerptOnlyRule()), 'the clause is in the FIRST call, before any excerpt exists');
  const rev = rec.filter(s => /^revise-/.test(s.label));
  assert.ok(rev.length > 0 && rev.every(s => s.system.includes(H.reviserExcerptOnlyRule())), 'the reviser carries its rule');
});

// ---- the estimate prices what is sent (C&C 09 Nov, money read): the max over fenced AND unfenced, structurally ----------------------------------------------------------------------------------------------
const estConfig = { name: 'est', signoff: 'unanimous', maxRounds: 2, criteria: [CRITERION], seats: { reviser: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'jx' }] } };
const estSeat = estConfig.seats.critics[0];
const maxLen = (label, words) => { setHeldForTest(words); return Math.max(...systemTextsFor(label, estConfig, estSeat).map(t => t.length)); };
const ROWS = ['panel-1-jx', 'critique-1', 'revise-1', 'criteria', 'final-read-jx'];

test('estimate: while the A7 words are held no priced system text moves (the flag contributes nothing to any builder); with them recorded every row that carries a quote word is priced longer', () => {
  for (const label of ROWS) {
    assert.equal(maxLen(label, noA7), maxLen(label, { ...noA7, excerptsBlock: undefined, sessionReadsField: undefined }), `${label}: held, with or without the channel words`);
    assert.ok(maxLen(label, ALL) > maxLen(label, noA7), `${label}: priced longer once the A7 words are recorded (the held-feed route: this fails on the src without the estimate variants)`);
  }
});

test('estimate: the priced text is the max over fenced AND unfenced, so it is never below the unfenced critic text with its appended rule (structural, not a length comparison of the day)', () => {
  setHeldForTest(ALL);
  const open = false;
  const unfencedPanel = panelPromptFor(estSeat, open, { fencedSource: false, excerptsMayBeShown: true }, estConfig).length;
  assert.ok(maxLen('panel-1-jx', ALL) >= unfencedPanel);
  const unfencedCritique = criticPromptFor(estSeat, open, { fencedSource: false, excerptsMayBeShown: true }, estConfig).length;
  assert.ok(maxLen('critique-1', ALL) >= unfencedCritique);
});

test('the criteria stage\'s live call is the same builder as R.criteriaSystem with only the A7 phrase added (no second copy of the criteria text)', () => {
  for (const words of [noA7, ALL]) {
    setHeldForTest(words);
    for (const fenced of [false, true]) {
      const live = criteriaSystemOf(false, fenced, { excerptsMayBeShown: true });
      const base = R.criteriaSystem(false, fenced, {});
      const back = live.replace(H.criteriaQuotePhrase(), 'unless the fenced source shows it.');
      assert.equal(back, base, `fenced ${fenced}, words ${words === ALL ? 'recorded' : 'held'}`);
    }
  }
});
