// 0.8.4 FM-critic (R485/R500; Muad's pick "3 please": the panel's whole behaviour on first-mode chains). A "first-mode" chain asks ONE critic per round (no "signoff": "unanimous"); until now its critic
// was told neither the quote rule nor the person's freedoms (criticPromptFor got `undefined`, chain.js), and nothing checked its quotes (no markFailures / quoteWarnings / quoteFindings), while the
// unanimous panel's seats got both. This file is the BUILD-NOW half: the critic's prompt (FC-1 .. FC-3, FC-6), the person's freedoms in it (FC-5) and the quote check (FC-4). The handling of a
// stated pass and of a blocking question in the first-mode loop is the AFTER-ANSWER half (R534, Muad: "A"): FC-6 .. FC-9 below.
// Everything is offline, $0, in process (mock providers). `setPromptSpy` reads the system prompt of each call at invoke(); the critic's reply for the FC-4 rows is injected through the stage cache.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy, criticPromptFor } from '../src/chain.js';
import { settingsOf } from '../src/stage-system.js';
import { setHeldForTest } from '../src/held-roles.js';
import { QUOTE_RULE_CRITIC, criticOnlySourceSentence as recordedCriticOnlySourceSentence } from '../src/roles.js';
// CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row FC-2 CHANGED; second change): OLD (the first apply edit): the first-mode critic's system text carries QUOTE_RULE_CRITIC with the two sentences criticQuoteCopiedPhrase / criticQuoteNeverSentence swapped in. NEW: it carries QUOTE_RULE_CRITIC with its "only source" sentence ('That fenced text is the ONLY thing you know about the repository.') replaced by the RECORDED criticOnlySourceSentence (src/roles.js), and nothing else swapped. WHY: error line 'critique-1' (assert.ok(c.system.includes(QUOTE_RULE_CRITIC_RECORDED), c.label), test line 108). criticPromptFor (src/stage-system.js:76) always runs withExcerptClause on a fenced run (ONLY_SOURCE.critic, stage-system.js:282-284, the recorded sentence replaces the QUOTE_RULE_CRITIC sentence), but withExcerptQuoteWords (the copied/never swaps, stage-system.js:302-319) runs only with mayShow, i.e. excerptsMayBeShownFor (src/excerpt-channel.js:17): an external seat or a questions block that waits; chains/mock.json has neither, so the two quote phrases are NOT swapped here.
const QUOTE_RULE_CRITIC_RECORDED = QUOTE_RULE_CRITIC.replace(/That fenced text is the ONLY thing you\s+know about the repository\./, () => recordedCriticOnlySourceSentence());
import { criticOnlySourceSentence, reviserOnlySourceSentence } from './held-prompts/held-084-a.js';
import { reviserSystemWithIds, patchReviserSystemWithIds } from './held-prompts/held.js';
import { readChainFile } from './helpers/chain-file.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setPromptSpy(null); setCache(null); setHeldForTest(null); });

const FENCED = 'Review this plan.\n\n```text\n// notes.txt\nthe round has a fixed length\n```';
const UNFENCED = 'Review this plan.';
const QUOTED = 'the author may accept/withdraw each post before the round ends';
const DRAFT = `# Plan\n\nBody text.\n\nStep 3: ${QUOTED}.\nStep 4: publish.\n\nAssumptions: none.`;
const CRITERION = 'It names who decides.';
const WORDS = { criticOnlySourceSentence, reviserOnlySourceSentence, reviserSystemWithIds, patchReviserSystemWithIds };
const PASS_RULE = /If this draft is genuinely outside what you can usefully judge, you may pass/;
const times = (s, sub) => String(s).split(sub).length - 1;

const critic = { provider: 'mock', model: 'mock-critic-a', lab: 'jx' };
const reviser = { provider: 'mock', model: 'mock-builder' };
// FIRST-MODE: no "signoff": "unanimous", one critic asked per round. UNANIMOUS: the panel.
const firstMode = (extra = {}) => ({ name: 'fm', maxRounds: 2, criteria: [CRITERION], ...extra, seats: { reviser, critics: [critic] } });
const unanimous = (extra = {}) => ({ ...firstMode(extra), signoff: 'unanimous' });
// THE NAMED FIRST-MODE CHAIN (R485): chains/mock.json (no "signoff": "unanimous"; critics mock-critic-a and mock-critic-b, one asked per round; the first objects, the revision passes). FC-1a, FC-1b (first-mode half), FC-1d and FC-2 run on it,
// with the criteria handed in (as the inline config does). The inline `firstMode` config stands in only where a CONTROLLED critic is needed (the FC-4 cache rows, FC-3's one-seat byte comparison, FC-5).
const mockChain = (extra = {}) => ({ ...readChainFile(root, 'mock'), criteria: [CRITERION], ...extra });

async function run(config, request, { reply = null, key = null } = {}) {
  setBudget(null);
  const calls = [];
  const lines = [];
  setPromptSpy(p => calls.push({ label: p.label, system: p.system, user: p.user }));
  if (reply) setCache({ get: label => (label === key ? { text: reply, usage: { input: 10, output: 10 }, usd: 0, provider: 'mock', model: 'mock-critic-a' } : null) });
  const r = await runChain({ request, draft: DRAFT, log: l => lines.push(String(l)), config });
  return { r, calls, lines };
}
const verdictWith = quote => JSON.stringify({
  meets: false,
  criteria: [{ criterion: CRITERION, verdict: 'NOT MET', evidence: 'Step 3 does not say.' }],
  failures: [{ criterion: CRITERION, problem: 'Step 3 lists accept/withdraw but never says who decides.', fix: 'Name the decider.', ...(quote === undefined ? {} : { quote }) }],
  verdict_line: 'One criterion failed.',
});
// How many times the drafted "only source" sentence appears, per stage prompt, over the calls whose label matches.
const count = (calls, labelRe, sentence) => calls.filter(c => labelRe.test(c.label)).map(c => times(c.system, sentence));

// FC-1 THE RUN-TIME FENCED ROW (R489). With the drafted "only source" sentences set through setHeldForTest, one count per stage prompt of a run over a FENCED task: critique-* on a first-mode chain
// (CHANGED: 0 on the parent, 1 after this unit), revise-* on the same chain and panel-* on a unanimous one (NAMED PINS of H8's routing: their fail condition is "a site stops passing the fenced flag").
// WITHOUT setHeldForTest every count below is 0 and the row cannot fail (FC-1c says so by running it).
test('FC-1a CHANGED: over a fenced task on a first-mode chain, every critique-* prompt carries the drafted "only source" sentence exactly once (parent: 0)', async () => {
  setHeldForTest(WORDS);
  const { calls } = await run(mockChain(), FENCED);
  const counts = count(calls, /^critique-\d+$/, criticOnlySourceSentence());
  assert.ok(counts.length >= 1, `the first-mode critic was asked (labels: ${calls.map(c => c.label).join(', ')})`);
  assert.deepEqual(counts, counts.map(() => 1));
});

test('FC-1b NAMED PIN of H8: revise-* on a first-mode chain, and panel-* on a unanimous one, over a fenced task, carry their drafted sentence exactly once (they fail if a site stops passing the fenced flag)', async () => {
  setHeldForTest(WORDS);
  const first = await run(mockChain(), FENCED);
  const revise = count(first.calls, /^revise-\d+$/, reviserOnlySourceSentence());
  assert.ok(revise.length >= 1, `a revise call was made (labels: ${first.calls.map(c => c.label).join(', ')})`);
  assert.deepEqual(revise, revise.map(() => 1), 'revise-* on the first-mode chain');
  const panel = await run(unanimous(), FENCED);
  const panelCounts = count(panel.calls, /^panel-\d+-/, criticOnlySourceSentence());
  assert.ok(panelCounts.length >= 1, `a panel seat was asked (labels: ${panel.calls.map(c => c.label).join(', ')})`);
  assert.deepEqual(panelCounts, panelCounts.map(() => 1), 'panel-* on the unanimous chain');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the control ran a FENCED task WITHOUT held words and asserted every 'only source' count 0 (the held state). NEW: that half is REMOVED (the words are recorded, so a fenced run carries the sentences; the FC-1 rows assert it); the control over an UNFENCED task stays. WHY: criticOnlySourceSentence and reviserOnlySourceSentence are recorded (src/prompts/recorded-084-a.js).
test('FC-1c the control: over an unfenced task every one of those counts is 0, so the FC-1 rows are the only ones that can fail', async () => {
  const asked = (calls, re) => { const n = calls.filter(c => re.test(c.label)).length; assert.ok(n >= 1, `a call matching ${re} was made (so a 0 below means no sentence, not no call)`); };
  setHeldForTest(WORDS);
  const unfenced = await run(mockChain(), UNFENCED);
  asked(unfenced.calls, /^critique-\d+$/); asked(unfenced.calls, /^revise-\d+$/);
  assert.deepEqual(count(unfenced.calls, /^critique-\d+$/, criticOnlySourceSentence()).filter(n => n !== 0), []);
  assert.deepEqual(count(unfenced.calls, /^revise-\d+$/, reviserOnlySourceSentence()).filter(n => n !== 0), []);
});

// FC-1d CHANGED: the cut-off retry (critique-<r>-retry, the second criticPromptFor site) carries the sentence too. `mock-critic-cut-signoff-then-fits` is cut at a cap of 1000 or less and fits at the bigger retry cap.
test('FC-1d CHANGED: the critic\'s cut-off retry over a fenced task carries the drafted "only source" sentence exactly once, like the first ask (parent: 0 on both)', async () => {
  setHeldForTest(WORDS);
  const cut = { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'jx', maxTokens: 1000 };
  const base = mockChain();
  const { calls } = await run({ ...base, seats: { ...base.seats, critics: [cut] } }, FENCED);
  assert.ok(calls.some(c => c.label === 'critique-1-retry'), `the retry was made (labels: ${calls.map(c => c.label).join(', ')})`);
  assert.deepEqual(count(calls, /^critique-1$/, criticOnlySourceSentence()), [1]);
  assert.deepEqual(count(calls, /^critique-1-retry$/, criticOnlySourceSentence()), [1]);
});

// FC-2 CHANGED: the quote rule reaches the first-mode critic when (and only when) the request carries fenced source.
test('FC-2 CHANGED: the first-mode critic over a fenced task is told the quote rule (parent: not told); over an unfenced task it is not', async () => {
  const fenced = await run(mockChain(), FENCED);
  const askedFenced = fenced.calls.filter(c => /^critique-\d+$/.test(c.label));
  assert.ok(askedFenced.length >= 1);
  for (const c of askedFenced) assert.ok(c.system.includes(QUOTE_RULE_CRITIC_RECORDED), c.label);
  const unfenced = await run(mockChain(), UNFENCED);
  const askedUnfenced = unfenced.calls.filter(c => /^critique-\d+$/.test(c.label));
  assert.ok(askedUnfenced.length >= 1);
  for (const c of askedUnfenced) assert.ok(!c.system.includes(QUOTE_RULE_CRITIC) && !c.system.includes(QUOTE_RULE_CRITIC_RECORDED), c.label);
});

// FC-3 NAMED PIN (unfenced bytes must not move): over an unfenced task and a chain with no freedoms, the first-mode critic's system prompt is byte-identical to criticPromptFor with no options at all.
test('FC-3 NAMED PIN: unfenced and without freedoms, the first-mode critic prompt is the same bytes as before this unit (criticPromptFor with no options)', async () => {
  const config = firstMode();
  const { calls } = await run(config, UNFENCED);
  const asked = calls.filter(c => /^critique-\d+$/.test(c.label));
  assert.ok(asked.length >= 1);
  const want = criticPromptFor(critic, settingsOf(config).open, undefined, config);
  for (const c of asked) assert.equal(c.system, want, c.label);
});

// FC-4 the quote check, as the panel's (test/quote-check-chain.test.js is the model): a verdict injected for critique-1.
test('FC-4a CHANGED: a quote found in neither the draft nor the fenced source is marked in both places on a first-mode chain (the run log and quoteFindings; the reviser prompt prints "(unverified)")', async () => {
  const { r, calls, lines } = await run(firstMode(), FENCED, { key: 'critique-1', reply: verdictWith('words that appear in neither place') });
  assert.deepEqual({
    invented: (r.quoteFindings || []).filter(w => /does NOT appear/.test(w)).length,
    logged: lines.filter(l => /QUOTE: .*does NOT appear/.test(l)).length,
    shownUnverified: calls.filter(c => /^revise-\d+$/.test(c.label) && c.user.includes('never says who decides')).some(c => c.user.includes('(unverified)')),
  }, { invented: 1, logged: 1, shownUnverified: true });
});

test('FC-4b CHANGED: a repo claim with no quote is marked unquoted on a first-mode chain (quoteFindings and the reviser prompt)', async () => {
  const { r, calls } = await run(firstMode(), FENCED, { key: 'critique-1', reply: verdictWith(undefined) });
  assert.equal((r.quoteFindings || []).filter(w => /without quoting the fenced source/.test(w)).length, 1);
  assert.ok(calls.filter(c => /^revise-\d+$/.test(c.label)).some(c => c.user.includes('none (unquoted)')));
});

test('FC-4c CONTROL (green on the parent): a real quote taken from the draft is not marked invented on a first-mode chain', async () => {
  const { r, calls } = await run(firstMode(), FENCED, { key: 'critique-1', reply: verdictWith(QUOTED) });
  assert.equal((r.quoteFindings || []).filter(w => /does NOT appear/.test(w)).length, 0);
  assert.ok(!calls.filter(c => /^revise-\d+$/.test(c.label)).some(c => c.user.includes('(unverified)')));
});

test('FC-4d CONTROL (green on the parent): over an unfenced task no quote check runs on a first-mode chain: no quoteFindings key, no QUOTE: line, no mark in the reviser prompt', async () => {
  const { r, calls, lines } = await run(firstMode(), UNFENCED, { key: 'critique-1', reply: verdictWith('words that appear in neither place') });
  assert.equal(r.quoteFindings, undefined);
  assert.equal(lines.filter(l => /QUOTE:/.test(l)).length, 0);
  assert.ok(!calls.filter(c => /^revise-\d+$/.test(c.label)).some(c => /\((unverified|unquoted)\)/.test(c.user)));
});

// FC-5 CHANGED: the person's own freedoms reach the first-mode critic's prompt (the offer only; the loop's handling of a stated pass and of a blocking question is the after-answer half).
test('FC-5 CHANGED: a chain\'s own freedoms (pass) are in the first-mode critic prompt, and a chain without freedoms offers none', async () => {
  const withFreedoms = await run(firstMode({ freedoms: { pass: true } }), UNFENCED);
  const asked = withFreedoms.calls.filter(c => /^critique-\d+$/.test(c.label));
  assert.ok(asked.length >= 1);
  for (const c of asked) assert.match(c.system, PASS_RULE, c.label);
  const without = await run(firstMode(), UNFENCED);
  for (const c of without.calls.filter(c => /^critique-\d+$/.test(c.label))) assert.doesNotMatch(c.system, PASS_RULE, c.label);
});

// ---- the after-answer half (R534, Muad: "A"): the person's two freedoms HANDLED in the first-mode loop ----
const passer = lab => ({ provider: 'mock', model: 'mock-critic-passer', lab });
const blocker = { provider: 'mock', model: 'mock-critic-blocking', lab: 'bq' };
const fmSeats = (critics, extra = {}) => ({ name: 'fm', maxRounds: 2, criteria: [CRITERION], ...extra, seats: { builder: reviser, reviser, critics } });
const labels = calls => calls.map(c => c.label);

// FC-6 CHANGED: a blocking question on a turn-taking chain whose freedoms allow it is TWO paid calls (the builder seat answers, the critic is asked once more with the answer shown), both through invoke(), then the verdict counts.
test('FC-6 CHANGED: a blocking question costs two calls (critique-1-question, critique-1-answered), the answer is shown to the critic, and its verdict then counts (parent: the run stops with no verdict)', async () => {
  const { r, calls } = await run(fmSeats([blocker], { freedoms: { blocking_questions: true } }), UNFENCED);
  assert.deepEqual(labels(calls).filter(l => /^critique-/.test(l)), ['critique-1', 'critique-1-question', 'critique-1-answered']);
  const answered = calls.find(c => c.label === 'critique-1-answered');
  assert.ok(answered.user.includes('# Answer to your blocking question'));
  assert.ok(answered.user.includes('What does "the artifact" refer to in criterion 1?'));
  assert.equal(r.passed, true);
  assert.deepEqual(r.panelVerdicts.map(v => v.verdict), ['signed_off']);
});

test('FC-6b CONTROL (green on the parent): without the blocking_questions freedom the question is never answered: no -question call, no -answered call', async () => {
  const { calls } = await run(fmSeats([blocker]), UNFENCED);
  assert.deepEqual(labels(calls).filter(l => /^critique-1-(question|answered)$/.test(l)), []);
});

// FC-7 CHANGED (ruling A): a critic that declines does not stop the run: recorded as passed with its reason, the plan not revised, the next critic reads it unchanged, the round counts.
test('FC-7 CHANGED: a declining critic is recorded as passed with its reason; no revise follows it, and the next critic reads the plan unchanged in the next round', async () => {
  const { r, calls, lines } = await run(fmSeats([passer('p1'), critic], { freedoms: { pass: true }, maxRounds: 2 }), UNFENCED);
  assert.deepEqual(r.panelVerdicts.slice(0, 1).map(v => ({ round: v.round, lab: v.lab, verdict: v.verdict, why: typeof v.pass_reason === 'string' && v.pass_reason.length > 0 })), [{ round: 1, lab: 'p1', verdict: 'passed', why: true }]);
  assert.ok(lines.some(l => /PASSED - Outside my domain expertise/.test(l)));
  assert.ok(!labels(calls).includes('revise-1'));
  const second = calls.find(c => c.label === 'critique-2');
  assert.ok(second, 'the next critic was asked in round 2');
  assert.ok(second.user.includes('Step 4: publish.'), 'it read the plan unchanged');
  assert.equal(r.panelVerdicts.find(v => v.round === 2)?.lab, 'jx');
});

test('FC-8 CHANGED: if every critic declines, the run ends at its round limit with no verdict: not agreed, never revised, no stopping early', async () => {
  const { r, calls } = await run(fmSeats([passer('p1'), passer('p2')], { freedoms: { pass: true }, maxRounds: 2 }), UNFENCED);
  assert.deepEqual(r.panelVerdicts.map(v => [v.round, v.lab, v.verdict]), [[1, 'p1', 'passed'], [2, 'p2', 'passed']]);
  assert.equal(r.passed, false);
  assert.deepEqual(labels(calls).filter(l => /^(critique|revise)-/.test(l)), ['critique-1', 'critique-2']);
});

// FC-9 CONTROL (green on the parent): without the pass freedom a stated pass is read as before: no verdict from that critic and the loop stops with it (not a decline).
test('FC-9 CONTROL: without the pass freedom the same reply is still "states no verdict": unheard, loop stopped (today\'s behaviour, unchanged)', async () => {
  const { r, calls } = await run(fmSeats([passer('p1'), critic], { maxRounds: 2 }), UNFENCED);
  assert.deepEqual(r.panelVerdicts.map(v => [v.round, v.verdict]), [[1, 'unheard']]);
  assert.deepEqual(labels(calls).filter(l => /^critique-/.test(l)), ['critique-1']);
});

// FC-10 CHANGED (R541): the degrade branch of the two extra calls. A chain that opted in (degrade_on_provider_error) whose builder seat fails at the `critique-<r>-question` call: the critic's seat is dropped (unheard, SEAT_UNREACHABLE, a dropout row), no pass is recorded, the run does not crash. The guard is in the unit's own code, so this row is first evidence for it (red on the parent 3bbf658a, where the question call does not exist); a chain that did not opt in rethrows (FC-10b). The failing seat is mock-network-error (it throws; mock-provider-error returns an empty reply and throws nothing).
test('FC-10 CHANGED: a chain opted in to degrade: the builder seat failing at the question call drops the critic seat (unheard, SEAT_UNREACHABLE, a dropout row), and no pass is recorded', async () => {
  const cfg = fmSeats([blocker], { freedoms: { blocking_questions: true }, degrade_on_provider_error: true });
  cfg.seats.builder = { provider: 'mock', model: 'mock-network-error' };
  const { r, calls } = await run(cfg, UNFENCED);
  assert.deepEqual(r.panelVerdicts.map(v => [v.round, v.verdict, v.reason_code]), [[1, 'unheard', 'SEAT_UNREACHABLE']]);
  assert.equal(r.passed, false);
  assert.ok((r.dropouts || []).some(d => d.stage === 'critique-1' && /provider failure/.test(d.reason)));
  assert.ok(calls.some(c => c.label === 'critique-1-question'));
  assert.ok(!calls.some(c => c.label === 'critique-1-answered'), 'the critic is not asked again');
});

test('FC-10b CONTROL: without degrade_on_provider_error the same failure propagates (as the critique call\'s does)', async () => {
  const cfg = fmSeats([blocker], { freedoms: { blocking_questions: true } });
  cfg.seats.builder = { provider: 'mock', model: 'mock-network-error' };
  await assert.rejects(() => run(cfg, UNFENCED), /mock: provider unreachable/);
});
