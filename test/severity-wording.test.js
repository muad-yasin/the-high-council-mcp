// B3 prep, JUDGE lane, unit V: the severity WORDING (A-DRAFT, all of it; the person's yes comes once, at the wording review). With the rating demand in force (the held word `ratingDemand`, on a layered unanimous chain; the chain switch `severity` was removed in 0.8.4 S19), the verdict prompt asks for a severity on every objection (a grading rule and a reply-format
// field), the exchange post prompt asks for one on a new objection, and a verdict that carried no readable severity gets ONE re-ask with a note, whatever the other judges did. The code carries the NOT-TOLD reading (anchors by consequence only, no sentence
// saying what a band does, no example number); the told reading and the example number live in the review packet. Three texts are exported UNWIRED (the accept stance and its two scoped sentences, the layer-3 re-tag field with its ledger suffix, the sweep
// prompt) and their bytes are pinned here, so their units wire them unchanged. Demand held, or no ratings recorded = today's bytes: the PIN digests in test/fixtures/severity-wording-pins.json were taken on the merged tip BEFORE roles.js was touched.
// The mocks cannot show that a real model fills the field: they emit tags from the model string, so these tests prove what the prompt CARRIES, not compliance.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lintChain } from '../src/chain-lint.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import * as S from '../src/stage-system.js';
import { normaliseCritique, runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { wordingText, wordingExportSpan } from './helpers/wording-files.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const sha = t => createHash('sha256').update(t).digest('hex').slice(0, 16);

// 0.8.4 apply (job 12, rows of severity-wording that compare an UNRATED prompt with a constant): the recorded words that every judge prompt carries whether or not ratings are asked for, so the comparisons below are built from RECORDED words (src/roles.js exports), never from the code under test. W23 (criticQuoteFieldSentence) goes before the reply-format sentence and the apply's failedRowAbsencePhrase replaces the failed-row phrase of the verdict prompt (src/stage-system.js withQuoteField, withAbsenceAnchor); W1's clause (layerDebateOwnQuoteSentence) ends the round-1 post prompt; the raiser's reply prompt ends with layerReplyAnchorRule then layerReplyQuoteSentence. None of them says anything about a rating.
const FAILED_ROW = 'FAILED: the quoted passage, or what is absent,';
const recordedCritic = base => base.replace(FAILED_ROW, () => R.failedRowAbsencePhrase()).replace('Reply with a single JSON object and nothing else:', a => `${R.criticQuoteFieldSentence()}\n\n${a}`);
const recordedPost = base => `${base}\n\n${R.layerDebateOwnQuoteSentence()}`;   // round 1
const recordedReply = base => `${base}\n\n${R.layerReplyAnchorRule()}\n\n${R.layerReplyQuoteSentence()}`;

// ---- the verbatim texts (K3: new text; K2 brief 37 in the packet). Written here, not derived from the code under test.
const ANCHORS = [
  '- 9 to 10: whoever builds from this plan would build the wrong thing, or cannot proceed without a decision the plan does not make.',
  '- 7 to 8.9: whoever builds from this plan can proceed but must guess at something that matters, or will likely redo work.',
  '- 4 to 6.9: whoever builds from this plan can proceed, but part of what they build could come out wrong or incomplete.',
  '- below 4: whoever builds from this plan builds the same thing whether or not this is fixed.',
].join('\n');
// unit S: the told sentence, verbatim (the maintainer picked the "told" reading; C&C's wording, 1 Nov 2026)
const TOLD = 'An objection rated 4 or above holds up the sign-off, and every rating from 4 up holds it up in the same way; the band only describes the impact. Its hold is released only when its raiser withdraws it, or when the top layer lowers its rating below 4. No count of reviewers settles it. An objection rated below 4 does not hold up the sign-off; it is still recorded.';
const TOLD_PLAIN = 'An objection rated 4 or above holds up the sign-off, and every rating from 4 up holds it up in the same way; the band only describes the impact. Its hold is released only when its raiser withdraws it. No count of reviewers settles it. An objection rated below 4 does not hold up the sign-off; it is still recorded.';
const RULE = `Every objection in "failures" carries a severity: a number from 1 to 10, with at most one decimal place. Rate what the problem would do to the result, not how sure you are of it:\n${ANCHORS}\n${TOLD_PLAIN}\nEvery criterion you mark FAILED must appear in "failures" with its severity; a FAILED criterion with no entry, or an entry with no severity, means your reply cannot be read.`;
const FIELD = ',\n      "severity": <a number from 1 to 10, with at most one decimal place>';
const POST_SENTENCE = `Give each new objection a severity from 1 to 10, with at most one decimal place. Rate what the problem would do to the result, not how sure you are of it:\n${ANCHORS}\n${TOLD_PLAIN}`;
const POST_FIELD_OLD = '{ "criterion": "<the criterion it breaks>", "quote": "<the passage, copied exactly, or omit>", "problem": "<what is wrong>" }';
const POST_FIELD_NEW = '{ "criterion": "<the criterion it breaks>", "quote": "<the passage, copied exactly, or omit>", "problem": "<what is wrong>", "severity": <a number from 1 to 10, with at most one decimal place> }';
const REASK = (n, criterion) => `Your last reply could not be read: objection ${n} (${criterion}) has no severity, or its severity is not a number from 1 to 10 with at most one decimal place. Answer again with the JSON object the system prompt describes, and give every objection in "failures" a severity.`;
const REASK_ROW = criterion => `Your last reply could not be read: you marked the criterion (${criterion}) FAILED in "criteria" but gave no entry for it in "failures". Answer again with the JSON object the system prompt describes, with an entry in "failures", and a severity on it, for every criterion you mark FAILED.`;
const REASK_NONE = 'Your last reply could not be read: it says the draft does not meet the criteria but names no objection. Answer again with the JSON object the system prompt describes, with every objection in "failures" and a severity on each.';
const ANCHOR = 'Reply with a single JSON object and nothing else:';

// ---- the unwired texts
const RETAG = 'You may change the rating of any objection in the ledger if you judge that rating wrong. Use the same scale as for your own objections: what the problem would do to the result. For an open objection, a rating you lower below 4 releases its hold on the sign-off, and a rating you raise to 4 or above holds it up. Add "retags": [{ "id": "<objection id>", "severity": <a number from 1 to 10, with at most one decimal place>, "reason": "<one or two sentences: what in the draft, and what impact, justify the new rating>" }]. A reason is required. Leave "retags" out when you change nothing.';

// =========================================================================================================================================================================================
// The 24 non-persona digests were taken on the merged tip before roles.js was touched by unit V; the 25 persona-variant digests were RE-TAKEN on 1 Nov 2026 after the name-ban sentence was removed from every persona block on his word (P2), and again after his catch sentence was removed from every persona block (P3, 1 Nov 2026: "That sentence was for your understanding of how THC works, not as a wording to throw into the judges prompts."), so they pin the persona block as it is now.
// RE-TAKEN 1 Nov 2026 (deliberate, A-DRAFT): the 18 criticSystem digests and the 5 criticPromptFor persona digests moved when the Council introduction opened every judge prompt and the "Your value comes entirely from being harder to satisfy" clause left it; the 26 exchange digests did not move. The system digest of the re-ask test (7) and the two verdict digests of the variant pin (14) moved for the same reason.
// RE-TAKEN AGAIN at the 0.8.4 wording apply (deliberate): every digest below and in the fixture moved with the reviewed wording (the welcome now also opens the exchange prompts, the told sentences, the post and reply texts).
// CHANGED ACCEPTED (0.8.4 S19). OLD: title 'switch off'; the persona configs had no seats (a chain that records nothing), so 'off' was true by construction. NEW: title 'demand held'; each persona config carries seats: { critics: [seat] } (signoff unanimous, layer 3 = a chain that RECORDS ratings) and the rating demand is forced out (NO_DEMAND), so the 25 persona digests now prove held == the old bytes on a recorded chain. The 49 digests and the fixture are unchanged. WHY: with the switch gone the held word, not a missing key, keeps the bytes. PREDICTED RED ON OLD SRC: no (same bytes; this strengthens the claim and moves no expectation). KNOWN-BAD INPUT for the one red: DEMAND in place of NO_DEMAND (the 15 persona criticPromptFor / layerDebateSystemFor digests move).
// CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'PIN, demand held'): OLD: 29 digests (24 pure ones + 5 persona digests of `criticPromptFor` / `layerDebateSystemFor` r1 r2 / `layerReplySystemFor` r1 r2 for Melchizedek's voice, built under `setHeldForTest(NO_DEMAND)`). NEW: 24 digests; 'layerReplySystem again=true' is NOT re-taken here: HELD for the one re-record at the merged tip (job 12 printed c71460c6f702bfe6; it is the code's own output), so the row stays red on that one key. WHY: error 'Expected values to be strictly deep-equal' on exactly six keys. 'layerReplySystem again=true' is a pure recorded-wording change: LAYER_REPLY_AGAIN was reworded by the reviewed apply (src/prompts/recorded-083.js, f60ebad2: 'Answer again with the actions this round allows; ...'), after the fixture was last re-taken (4 Nov, 0322e83c). The five persona digests are REMOVED (K7): they pinned the old bytes of a state built with the HELD_OFF-style map NO_DEMAND (`ratingDemand: undefined`, banned for 0.8.4 names) and also moved with JUDGE_PERSONA_VOICE (31ab9241, 9e4c3e3c) and W23/W1/W24 (recorded). Siblings (same file, the demand in force): 'the verdict prompt with severity on' (the persona block sits after the rating rule and before the reply format, Moses) and 'the exchange post prompt with severity on' (rated sentence, persona block, reply format, Noah).
// CHANGED ACCEPTED TEST (0.8.4 apply, batch 1; his 12 Nov 2026 word: "I don't see why we would need a test that pins wording. That is not a test, that is bloat."; his 8:a). OLD: the 24 digests of got were compared with test/fixtures/severity-wording-pins.json (deepEqual(got, want)). Red on 0b9d5275 (printed, jobs 159 and 163): exactly one key, 'layerReplySystem again=true' (c71460c6f702bfe6 against 2fd2131ca0ec5777), moved by f60ebad2 (LAYER_REPLY_AGAIN reworded in the reviewed apply); the other 23 were green. NEW: no digest is compared; the row keeps the SET of variants (the 24 names below, from the fixture's keys) and their count: every variant is still built. WHY: a digest is a wording pin; the variant set is the behaviour. The fixture has no reader left (see the commit message for the grep), so it is removed with git rm. RED: a variant dropped or added (or one that throws) fails the key-set assert.
const KEYS = ["LAYER_DEBATE_SYSTEM", "LAYER_REPLY_SYSTEM", "criticSystem open=false blockingQuestions", "criticSystem open=false bqPass", "criticSystem open=false criteriaKinds", "criticSystem open=false fenced", "criticSystem open=false fencedKinds", "criticSystem open=false none", "criticSystem open=false notFenced", "criticSystem open=false pass", "criticSystem open=false selfReview", "criticSystem open=true blockingQuestions", "criticSystem open=true bqPass", "criticSystem open=true criteriaKinds", "criticSystem open=true fenced", "criticSystem open=true fencedKinds", "criticSystem open=true none", "criticSystem open=true notFenced", "criticSystem open=true pass", "criticSystem open=true selfReview", "layerDebateSystem again=false", "layerDebateSystem again=true", "layerReplySystem again=false", "layerReplySystem again=true"];
test('PIN, recorded state: every criticSystem / layer-exchange / persona variant is byte-identical to the merged tip before this unit (digests taken before roles.js was touched)', () => {
  const got = {};
  const freedoms = { none: undefined, criteriaKinds: { criteriaKinds: true }, fenced: { fencedSource: true }, notFenced: { fencedSource: false }, selfReview: { selfReview: true }, blockingQuestions: { blocking_questions: true }, pass: { pass: true }, bqPass: { blocking_questions: true, pass: true }, fencedKinds: { fencedSource: true, criteriaKinds: true } };
  for (const open of [false, true]) for (const [k, f] of Object.entries(freedoms)) got[`criticSystem open=${open} ${k}`] = sha(f === undefined ? R.criticSystem(open) : R.criticSystem(open, f));
  for (const again of [false, true]) { got[`layerDebateSystem again=${again}`] = sha(R.layerDebateSystem(again)); got[`layerReplySystem again=${again}`] = sha(R.layerReplySystem(again)); }
  got.LAYER_DEBATE_SYSTEM = sha(R.LAYER_DEBATE_SYSTEM); got.LAYER_REPLY_SYSTEM = sha(R.LAYER_REPLY_SYSTEM);
  // CHANGED ACCEPTED TEST (unit 4, name_only dropped). OLD bar: 34 digests, five of them for a name listed in name_only ("Livia voice name_only": the verdict prompt and the exchange prompts of both rounds). NEW bar: 29 digests, those five removed from test/fixtures/severity-wording-pins.json. WHY: the key is gone, so no prompt is built for such a name; the other 29 digests are unchanged.
  // REMOVED (0.8.4 apply, K7): the Melchizedek-voice persona digests (see the marker above the test).
  assert.deepEqual(Object.keys(got).sort(), KEYS);
  assert.equal(Object.keys(got).length, 24);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: the persona assertion at the end used cfg = { signoff, severity: { enabled: true }, judge_personas } with no seats. NEW: cfg has no severity key, carries seats: { critics: [seat] } (a layered unanimous chain) and DEMAND is injected; the seat is declared first; every assertion is the old one. WHY: the switch is gone, and a config with no seats records nothing, so the rule would be absent. PREDICTED RED ON OLD SRC: yes (the old src reads config.severity only, so p lacks RULE and the first indexOf comparison fails). KNOWN-BAD INPUT (on the new src): NO_DEMAND in place of DEMAND.
test('the verdict prompt with severity on: the grading rule sits before the freedoms rules and the reply format, the field sits inside the failures object, the reply-format sentence is still once; off, no trace', () => {
  const on = R.criticSystem(false, { severity: true });
  assert.ok(on.includes(RULE), 'the rule, verbatim');
  assert.ok(on.includes(`"fix": "<the smallest change that would fix it>"${FIELD} }`), 'the field after the fix field (no quote field in this variant)');
  assert.equal(on.split(ANCHOR).length, 2);
  assert.ok(on.indexOf(RULE) < on.indexOf(ANCHOR));
  const withFreedoms = R.criticSystem(false, { severity: true, blocking_questions: true, pass: true });
  assert.ok(withFreedoms.indexOf(RULE) < withFreedoms.indexOf('blocking_question') && withFreedoms.indexOf(RULE) < withFreedoms.indexOf(ANCHOR), 'the severity rule comes before the freedoms rules');
  const fenced = R.criticSystem(false, { severity: true, fencedSource: true });
  assert.ok(fenced.includes(`"quote": "<required when this objection claims something about the repository`) && fenced.indexOf('"quote"') < fenced.indexOf('"severity"'), 'the severity field follows the quote field');
  assert.doesNotMatch(R.criticSystem(false), /severity/i); assert.doesNotMatch(R.criticSystem(false, { severity: false }), /severity/i);
  // the persona block (frozen packet) still sits directly before the reply format, after the severity rule
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 3, persona: 'Moses' };
  const cfg = { signoff: 'unanimous', seat_personas: { enabled: true, form: 'voice' }, seats: { critics: [seat] } };   // a layered unanimous chain: ratings are recorded; the judges are told to rate only with the demand injected
  setHeldForTest(DEMAND);
  const p = S.criticPromptFor(seat, false, undefined, cfg);
  assert.ok(p.includes(RULE), 'the grading rule is there at all (without this the ordering below passes on indexOf -1)');
  assert.ok(p.indexOf(RULE) < p.indexOf('speak in the voice of Moses.') && p.indexOf('speak in the voice of Moses.') < p.indexOf(ANCHOR) && p.endsWith('}'), 'rules, severity, persona, reply format');
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: `on` was a chain with severity: { enabled: true } and `off` the same chain without it; the two were compared. NEW: ONE layered unanimous chain; `on` = the rating demand injected (DEMAND), `off` = forced out (NO_DEMAND), each call made under its own state (setHeldForTest toggles between the halves); plus one new line: an UNLAYERED chain is asked for nothing even with the demand in force (it records no ratings). The point (the flag comes from the chain, never from a user's freedoms; the dry run prices the demand text; the final read asks too) is kept. WHY: there is no switch; the demand is the held word plus the chain shape. PREDICTED RED ON OLD SRC: yes (the old src ignores DEMAND, so the first `on` call carries no rule and the first assert.ok fails). KNOWN-BAD INPUT (on the new src): NO_DEMAND for the `on` half.
test('the rating demand lives in the CHAIN and the held word only: criticPromptFor derives the flag from ratingsDemanded(config), never from a user\'s freedoms; the dry run prices the demand text; the final read asks too', () => {
  const critic = { provider: 'mock', model: 'mock-critic-a', lab: 'a', layer: 1 };
  const chain = { signoff: 'unanimous', seats: { critics: [critic] } };   // a layered unanimous chain: its ratings are recorded; whether the judges are TOLD to rate is the held word alone
  const flatCritic = { provider: 'mock', model: 'mock-critic-a', lab: 'a' };
  const flat = { signoff: 'unanimous', seats: { critics: [flatCritic] } };   // no layer: nothing is recorded, so nothing is demanded
  const labels = ['panel-L1-a', 'critique-L1-a', 'final-read-L3-a'];
  setHeldForTest(DEMAND);
  assert.ok(S.criticPromptFor(critic, false, undefined, chain).includes(RULE));
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'the rating demand lives in the CHAIN'): OLD: expected R.criticSystem(false). NEW: recordedCritic(R.criticSystem(false)) (the recorded W23 sentence and absence phrase added, nothing about a rating). WHY: error 'an unlayered chain is asked for nothing, even with the demand in force': actual carried 'For each failure, give a field quote: ...' and 'what is absent (for something absent, also quote the heading ...)' that the constant lacks (src/stage-system.js:73 withQuoteField, :62 withAbsenceAnchor); the rating text is NOT there (ratingsDemanded is false for an unlayered chain, src/ratings-demand.js:11), so 'asked for nothing' still holds and is still an exact equality.
  assert.equal(S.criticPromptFor(flatCritic, false, undefined, flat), recordedCritic(R.criticSystem(false)), 'an unlayered chain is asked for nothing, even with the demand in force');
  const onTexts = Object.fromEntries(labels.map(label => [label, S.systemTextsFor(label, chain, critic)]));
  const finalOn = S.finalReadSystemFor(critic, chain);
  setHeldForTest(NO_DEMAND);
  assert.equal(S.criticPromptFor(critic, false, { severity: true }, chain), S.criticPromptFor(critic, false, undefined, chain), 'a freedoms.severity from the user, with the demand held, asks for nothing');
  // REMOVED (0.8.4 apply, K7): `assert.equal(S.criticPromptFor(critic, false, { severity: true }, chain), R.criticSystem(false))` under `setHeldForTest(NO_DEMAND)`: the held-off state (`ratingDemand: undefined`, a HELD_OFF-style map, banned for 0.8.4 names), and its expected text is the pre-apply constant (job 12 diff: the recorded W23 sentence and absence phrase are in the prompt). Sibling (same test): the unlayered-chain line above with the demand in force (now built from recorded words) and the line before this one (a user's freedoms.severity asks for nothing, the two prompts equal).
  for (const label of labels) {
    const offTexts = S.systemTextsFor(label, chain, critic);
    assert.ok(onTexts[label].every(t => t.includes(RULE)), `${label}: every priced variant carries the rule`);
    assert.ok(Math.max(...onTexts[label].map(t => t.length)) - Math.max(...offTexts.map(t => t.length)) >= RULE.length, `${label}: priced longer`);
  }
  assert.ok(finalOn.includes(RULE), 'the final read asks for a tag when the demand is in force');
  assert.equal(S.finalReadSystemFor(critic, chain).includes('severity'), false);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: cfg = { signoff, severity: { enabled: true }, judge_personas } with no seats; the two 'off = the constants' lines passed { signoff } alone. NEW: cfg has no severity key and carries seats: { critics: [seat] }, DEMAND injected; the two 'off' lines keep the unrecorded chain (still the constant, demand in force or not) and add the same check on a layered unanimous chain with NO_DEMAND (held == the constant). WHY: no switch; the held word and the chain shape decide. PREDICTED RED ON OLD SRC: yes (the rated sentence is absent from t, because only the held word asks for it). KNOWN-BAD INPUT (on the new src): NO_DEMAND in place of DEMAND at the cfg line.
test('the exchange post prompt with severity on: the new-objection field and the rated sentence, in both rounds, persona-aware; off = the constants', () => {
  for (const again of [false, true]) {
    const t = R.layerDebateSystem(again, { severity: true });
    assert.ok(t.includes(POST_FIELD_NEW) && !t.includes(POST_FIELD_OLD), 'field');
    assert.ok(t.includes(POST_SENTENCE), 'sentence');
    assert.ok(t.indexOf(POST_SENTENCE) < t.indexOf(ANCHOR));
    assert.equal(t.split(ANCHOR).length, 2);
    if (again) assert.ok(t.endsWith(R.LAYER_DEBATE_AGAIN) && R.LAYER_DEBATE_AGAIN.includes('If nothing did, repeat your stance briefly; a repeated contest keeps its quote and its reason.'), 'the later-round text, with the milestone-2 sentence now in the base text');   // milestone 2 (A-DRAFT, X4)
    assert.equal(R.layerDebateSystem(again, { severity: false }), R.layerDebateSystem(again));
  }
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1, persona: 'Noah' };
  const cfg = { signoff: 'unanimous', seat_personas: { enabled: true, form: 'voice' }, seats: { critics: [seat] } };   // a layered unanimous chain; the judges are told to rate only with the demand injected
  setHeldForTest(DEMAND);
  const t = S.layerDebateSystemFor(cfg, seat, false);
  assert.ok(t.includes(POST_SENTENCE), 'the rated sentence is there at all (without this the ordering below passes on indexOf -1)');
  assert.ok(t.indexOf(POST_SENTENCE) < t.indexOf('voice of Noah') && t.indexOf('voice of Noah') < t.indexOf(ANCHOR), 'rated sentence, persona block, reply format');
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'the exchange post prompt with severity on'): OLD: the five 'constant' comparisons below (post round 1: two; answer prompt: three) expected R.layerDebateSystem(false) / R.layerReplySystem(false[, { severity: true }]). NEW: the same texts with the recorded tails that every post (round 1) and answer prompt carries (recordedPost, recordedReply: W1's clause; the anchor rule and W24). WHY: error 'a chain that records no ratings (no layers) is not asked, the demand in force or not': actual ends '}\n\nIn round 1, if a block lists your own failures that quote nothing, add for each a field own_quote ...' (src/stage-system.js:182 heldTail('layerDebateOwnQuoteSentence'), :183 replyAnchorTail + heldTail('layerReplyQuoteSentence')); nothing in those tails is a rating, so 'is not asked' still holds as an exact equality.
  assert.equal(S.layerDebateSystemFor({ signoff: 'unanimous' }, seat, false), recordedPost(R.layerDebateSystem(false)), 'a chain that records no ratings (no layers) is not asked, the demand in force or not');
  // REMOVED (0.8.4 apply, K7): the line that expected the constant for a layered chain under `setHeldForTest(NO_DEMAND)` ('the demand held on a layered unanimous chain: the constant'): the held-off state, banned map. Sibling (same test): the unlayered-chain line above and the DEMAND lines before it.
  setHeldForTest(DEMAND);
  // milestone 2 (A-DRAFT, X3 X5 X6): under the switch the answer prompt carries the milestone-2 sentences (still no severity FIELD); off, it is the constant
  const reply = S.layerReplySystemFor(cfg, { ...seat, persona: undefined }, false);
  assert.equal(reply, recordedReply(R.layerReplySystem(false, { severity: true })), 'the answer prompt under the switch is the severity variant');
  assert.ok(reply.includes('An amendment changes the problem text only; the rating you gave is not changed here.'), 'X5 reaches the answer prompt');
  assert.ok(!reply.includes(POST_FIELD_NEW), 'the answer prompt has no severity field');
  assert.equal(S.layerReplySystemFor({ signoff: 'unanimous' }, { ...seat, persona: undefined }, false), recordedReply(R.layerReplySystem(false)), 'no ratings recorded = the constant');
  // REMOVED (0.8.4 apply, K7): the answer-prompt line 'the demand held = the constant' under `setHeldForTest(NO_DEMAND)` (same reason). Sibling (same test): 'no ratings recorded = the constant' above, now built from the recorded words.
});

test('normaliseCritique names what is missing: a verdict unreadable for a missing tag carries severityGap { n, criterion } and the same verdict without the switch carries none', () => {
  const v = { meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions.', problem: 'None.', severity: 8 }, { criterion: 'It lists the steps.', problem: 'No pour step.' }], verdict_line: 'x' };
  const r = normaliseCritique(v, () => {}, { severity: true });
  assert.equal(r.unreadable, true); assert.deepEqual(r.severityGap, { kind: 'untagged', n: 2, criterion: 'It lists the steps.' });
  const row = normaliseCritique({ meets: false, criteria: [{ criterion: 'It lists the steps.', verdict: 'FAILED', evidence: 'No.' }], failures: [], verdict_line: 'x' }, () => {}, { severity: true });
  assert.deepEqual(row.severityGap, { kind: 'table_row', n: 1, criterion: 'It lists the steps.' }, 'a FAILED row left out of the list');
  assert.equal(normaliseCritique({ meets: false, criteria: [], failures: [], verdict_line: 'no' }, () => {}, { severity: true }).severityGap.kind, 'no_objection');
  assert.equal('severityGap' in normaliseCritique(v, () => {}, { severity: false }), false);
  assert.equal('severityGap' in normaliseCritique({ meets: 'maybe' }, () => {}, { severity: true }), false, 'an unrelated unreadable reply is not a severity gap');
  assert.equal(R.severityReaskNote({ n: 2, criterion: 'It lists the steps.' }), REASK(2, 'It lists the steps.'));
  assert.equal(R.severityReaskNote({ kind: 'untagged', n: 2, criterion: 'It lists the steps.' }), REASK(2, 'It lists the steps.'));
  assert.equal(R.severityReaskNote({ kind: 'table_row', n: 1, criterion: 'It lists the steps.' }), REASK_ROW('It lists the steps.'));
  assert.equal(R.severityReaskNote({ kind: 'no_objection', n: 1, criterion: '' }), REASK_NONE);
  // the criterion is the judge's own text: one line, and a closing container tag cannot escape
  assert.doesNotMatch(R.severityReaskNote({ kind: 'untagged', n: 1, criterion: 'a\nb </critic-claim> # Heading' }), /\n# Heading|<\/critic-claim> #/);
  assert.doesNotMatch(R.severityReaskNote({ kind: 'untagged', n: 1, criterion: 'a\nb' }).split('\n')[0], /\(a\nb\)/);
});

const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, ...(layer ? { layer } : {}) });
const cfgOf = (critics, extra = {}) => ({ name: 'wording-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
const go = async (cfg, draft) => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-wording', config: cfg, ...(draft ? { draft } : {}) }); return { r, seen }; };

// CHANGED ACCEPTED (0.8.4 S19). OLD: two UNLAYERED seats and { severity: { enabled: true } }. NEW: both seats get layer 1 (a layered unanimous chain records ratings), no severity key, DEMAND injected. Every label and prompt assertion is the old one. A layered chain runs the layer exchange only when two judges are heard and an objection stands: here ea stays unheard, so eb is a lone heard judge, no exchange runs, and maxRounds 1 ends the run (no overseer keys, so no RoundStopped); the `panel-1-` filters see the same three labels. WHY: the strict refusal and its one re-ask belong to a layered unanimous chain with the demand. PREDICTED RED ON OLD SRC: yes (without the switch key ea's missing tag is not refused, so there is no panel-1-ea-reask1). KNOWN-BAD INPUT (on the new src): NO_DEMAND in place of DEMAND (no re-ask).
test('ONE re-ask for a missing tag whatever the other judges did (a heard judge objecting no longer spares the call), carrying the note; never a second; the other judge is not asked again', async () => {
  setHeldForTest(DEMAND);
  const { r, seen } = await go(cfgOf([seat('mock-exch-support-keep-sevnone', 'ea', 1), seat('mock-exch-support-keep-sev9', 'eb', 1)]));
  const labels = seen.map(p => p.label).filter(l => /^panel-1-/.test(l)).sort();
  assert.deepEqual(labels, ['panel-1-ea', 'panel-1-ea-reask1', 'panel-1-eb'], 'exactly one re-ask, for the seat that left the tag off');
  const reask = seen.find(p => p.label === 'panel-1-ea-reask1');
  assert.ok(reask.user.includes(REASK(1, 'It states the assumptions it was written under.')), 'the note names the objection and its criterion');
  assert.equal(seen.find(p => p.label === 'panel-1-ea').user.includes('could not be read'), false, 'the first ask has no note');
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'ea').verdict, 'unheard');
  // a worded tag is the same gap
  const w = await go(cfgOf([seat('mock-exch-support-keep-sevword', 'ea', 1), seat('mock-exch-support-keep-sev9', 'eb', 1)]));
  assert.equal(w.seen.filter(p => /^panel-1-ea-reask/.test(p.label)).length, 1);
});

// CHANGED ACCEPTED (0.8.4 S19): title only (OLD 'switch OFF', NEW 'no ratings recorded (an unlayered chain)'). The body and both stored hashes are unchanged: the chains are unlayered, so no ratings are recorded and no prompt or re-ask rule can move whatever the held state. No NO_DEMAND is added on purpose: it would be inert here. No red applies (no behaviour change).
test('no ratings recorded (an unlayered chain): the re-ask rule and the re-ask prompt are exactly today\'s (no re-ask while another judge objects; two re-asks of an unreadable seat when the rest is clean, each re-ask prompt equal to the first ask)', async () => {
  const objecting = await go(cfgOf([seat('mock-unreadable', 'u'), seat('mock-exch-support-keep-sev9', 'eb')]));
  assert.deepEqual(objecting.seen.map(p => p.label).filter(l => /^panel-1-/.test(l)).sort(), ['panel-1-eb', 'panel-1-u'], 'an objecting judge spares the unreadable seat its re-ask, as before');
  const clean = await go(cfgOf([seat('mock-unreadable', 'u'), seat('mock-critic-a', 'a')]), 'REVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.');
  // FINDING (not on the owed list of the ladder unit; found by the set, 10 Nov 2026). OLD bar: the labels panel-1-u, panel-1-a, panel-1-u-reask1, panel-1-u-reask2. NEW: plus panel-1-u-solo: the solo ask reaches every chain with a silent judge, layered or not (reach is the report line on C&C's reading). The two stored hashes are unchanged: the solo ask repeats the first ask's prompt.
  const pins = { 'panel-1-u': 1, 'panel-1-a': 1, 'panel-1-u-reask1': 1, 'panel-1-u-reask2': 1, 'panel-1-u-solo': 1 };
  assert.deepEqual(clean.seen.map(p => p.label).filter(l => /^panel-1-/.test(l)).sort(), Object.keys(pins).sort());
  // CHANGED ACCEPTED TEST (0.8.4 apply, batch 1; his 12 Nov 2026 word on wording pins and his 8:a). OLD: for each of the five panel-1 calls above the pair [sha(system), sha(user)] was compared with ['974a04e2d944b529', '63caeeca50a16d12'] (before it, with the system digest 46c0e3a4eba2d9eb). Red on 0b9d5275 (printed, jobs 159 and 163): the system digest of all five calls (95b4a9f59132c4ad), moved by 5d5a5ca5 (a chain whose judges are not shown their earlier objections is no longer sent the relation sentence); the user digest was green. NEW: no digest is compared; the labels above (behaviour: which calls are made) stay. WHY: a digest is a wording pin. The behaviour 5d5a5ca5 changed (no relation sentence on a chain without answer_back) is pinned by test/relation-sent-where.test.js, which 5d5a5ca5 added. RED: the label assert above fails if a re-ask is made or dropped.
  // CHANGED ACCEPTED TEST (0.8.4 apply, second commit; the title's claim "every prompt identical to the first ask" lost its pin when the digests went). OLD (title): every prompt identical to the first ask, pinned by digests taken on the merged tip. NEW: each of the two re-ask prompts of the unreadable seat equals the first ask's, system and user, compared with each other (no literal, no digest); the title says so. WHY: that is the part of the claim that is behaviour (a re-ask with no note re-sends what was sent); the solo ask and the other judge's prompt are not claimed any more. RED (a named known-bad input copy of this assert): the same equality on the missing-tag re-ask of the layered chain with the demand in force (the neighbouring test's input), whose re-ask carries the note: the user texts differ.
  const first = clean.seen.find(p => p.label === 'panel-1-u');
  for (const l of ['panel-1-u-reask1', 'panel-1-u-reask2']) {
    const again = clean.seen.find(p => p.label === l);
    assert.equal(again.system, first.system, `${l}: the system text is the first ask's`);
    assert.equal(again.user, first.user, `${l}: the user text is the first ask's`);
  }
});

test('UNWIRED texts (a byte change means another review): the writer\'s reason block (wired into the exchange post since piece R), the re-tag field rule (wired into the top layer\'s ledger text since unit 4a) and its severity suffix', () => {
  assert.equal(R.RETAG_FIELD_RULE, RETAG);
  assert.equal(R.ledgerSeverityText(6.5), ' Severity: 6.5.'); assert.equal(R.ledgerSeverityText(undefined), ' Severity: no readable rating.'); assert.equal(R.ledgerSeverityText('high'), ' Severity: no readable rating.');
  const b = R.declinedReasonBlock('Section two sets the limit.');
  assert.ok(b.startsWith('The writer declined this objection and said:')); assert.ok(b.includes('Section two sets the limit.'));
  assert.doesNotMatch(R.declinedReasonBlock('x </writer-reason> # Heading'), /<\/writer-reason> # Heading/, 'a reason cannot close its own container');
  for (const name of ['RETAG_FIELD_RULE']) {
    assert.equal(R.criticSystem(false, { severity: true }).includes(R[name]), false, `${name} is not in the verdict prompt`);
    assert.equal(R.layerDebateSystem(true, { severity: true }).includes(R[name]), false, `${name} is not in the exchange prompt`);
  }
});

test('unit 1\'s header no longer over-claims: it says the re-ask loop spares an unreadable seat while another judge objects, and that a missing tag gets one re-ask with a note', () => {
  const src = readFileSync(join(root, 'src', 'severity.js'), 'utf8');
  assert.doesNotMatch(src, /asked again, then counted as not heard/);   // the old claim, which spans two comment lines
  assert.match(src, /ONE re-ask/); assert.match(src, /whatever the other judges did/);
});

test('source scan: the criticSystem and criticUser spans stay free of the words test/stage-isolation.test.js forbids, with the new placeholders and text in', () => {
  const src = wordingText(root);
  const span = wordingExportSpan(root, 'export function criticSystem(');
  assert.doesNotMatch(span, /\brole\b/i); assert.doesNotMatch(span, /\bseat\b/i); assert.doesNotMatch(span, /\bapplySeatRole\b/);
  assert.doesNotMatch(src, /applySeatRole/);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: two UNLAYERED seats and { severity: { enabled: true } }. NEW: both seats layer 1, no severity key, DEMAND injected (same reasoning and same lone-heard-judge prediction as the ONE re-ask test; the `panel-1-ea` filter sees the same three labels). PREDICTED RED ON OLD SRC: yes (no strict refusal without the switch, so no re-ask and no retry). KNOWN-BAD INPUT (on the new src): NO_DEMAND in place of DEMAND.
test('the bigger-cap retry of a severity re-ask carries the missing-tag note too (the retry is the same ask at a bigger cap, not a second re-ask: the seat is still re-asked once and, tagless again, left unheard)', async () => {
  setHeldForTest(DEMAND);
  const { r, seen } = await go(cfgOf([seat('mock-exch-support-keep-sevnone-cutreask-t1', 'ea', 1), seat('mock-exch-support-keep-sev9', 'eb', 1)]));
  assert.deepEqual(seen.map(p => p.label).filter(l => /^panel-1-ea/.test(l)).sort(), ['panel-1-ea', 'panel-1-ea-reask1', 'panel-1-ea-reask1-retry'], 'one re-ask and its cut-off retry, no second re-ask');
  const note = REASK(1, 'It states the assumptions it was written under.');
  assert.ok(seen.find(p => p.label === 'panel-1-ea-reask1').user.includes(note), 'the re-ask carries the note');
  assert.ok(seen.find(p => p.label === 'panel-1-ea-reask1-retry').user.includes(note), 'the retry of the re-ask carries it too');
  assert.equal(seen.find(p => p.label === 'panel-1-ea').user.includes('could not be read'), false);
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'ea').verdict, 'unheard');
});

// ---- unit S: the told sentence, and the removal of the accept-stance texts (the count rule was withdrawn on the maintainer's word, 1 Nov 2026)

const sha16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the told sentence read "It is released only when its raiser withdraws it" and the eight digests below were taken with it. NEW: it reads "Its hold is released only when its raiser withdraws it" (told_* re-taken by computing the recorded sentence (NS-0756); the other six are the digests of the same prompts printed by the discovery run of the recorded tree (box check: they were not re-computed here). The prompt text that moved since the pins were taken (33f57b69) is in src/prompts core.js (AP-E5b, the critic evidence rule), tiered.js and recorded-083.js (the apply rows of f60ebad2). WHY: the 0.8.4 apply (f60ebad2), rows NS-0756 and AP-E5b.
const VARIANT_DIGESTS = {
  told_ledger: 'ec106b01975380d5',
  told_plain: '7706d2dc009f03bc',
  verdict_ledger: '9d13d0718b640225',
  verdict_plain: 'c6c17ed8f318b8ff',
  post_r1_ledger: '0ecfb49c1c2fa09e',
  post_r1_plain: '77f93f70c8d26806',
  post_r2_ledger: '542ce3ea0a294586',
  post_r2_plain: '42091afe51191088',
};

test('S: the told sentence has TWO variants (tree truth is per chain): with a ledger for the top layer it names layer 3 lowering a rating, without one it stops at the raiser withdrawing; both reach the verdict prompt and the exchange post prompt after the anchors, neither with the switch off; neither names a closing round, a handler or a climb', () => {
  assert.equal(R.SEVERITY_TOLD, TOLD); assert.equal(R.SEVERITY_TOLD_PLAIN, TOLD_PLAIN);
  for (const [ledger, told] of [[true, TOLD], [false, TOLD_PLAIN]]) {
    const opts = { severity: true, ...(ledger ? { severityLedger: true } : {}) };
    assert.ok(R.criticSystem(false, opts).includes(`${R.SEVERITY_ANCHORS}\n${told}\nEvery criterion you mark FAILED`), `verdict prompt (ledger ${ledger}): directly after the anchors, before the FAILED rule`);
    for (const again of [false, true]) assert.ok(R.layerDebateSystem(again, opts).includes(`${R.SEVERITY_ANCHORS}\n${told}`), `exchange post prompt (ledger ${ledger}, round ${again ? '2+' : '1'})`);
    assert.doesNotMatch(told, /closing|handler|climb|layer above|go up/i, 'it describes only what the code does today');
  }
  assert.doesNotMatch(TOLD_PLAIN, /layer 3/, 'no ledger, no re-tag: the plain variant does not say it');
  assert.equal(R.criticSystem(false).includes('An objection rated 4 or above holds up the sign-off'), false, 'switch off: not in the verdict prompt');
  for (const again of [false, true]) assert.equal(R.layerDebateSystem(again).includes('An objection rated 4 or above holds up the sign-off'), false, 'switch off: not in the exchange prompt');
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: cfg() carried severity: { enabled: true }, and 'an unlayered panel' asserted the PLAIN told sentence. NEW: no severity key, DEMAND injected; the unlayered case asserts the prompt is the constant (R.criticSystem(false)): an unlayered chain records no ratings, so it is asked for none and the plain-or-told choice does not arise there. The POINT of every layered case is kept; the unlayered case changes its point on purpose. WHY: the switch is gone; the layered unanimous shape decides whether anything is asked. PREDICTED RED ON OLD SRC: yes (without the switch key no layered case carries TOLD or TOLD_PLAIN). KNOWN-BAD INPUT (on the new src): NO_DEMAND in place of DEMAND.
test('S: the variant is chosen PER CHAIN by whether the top layer can be shown a ledger (a layered chain with answer_back and two or more layers): B3\'s shape and a two-layer chain say it; one layer, or a layered chain without answer_back, stop at the withdrawal; an unlayered panel records no ratings and is asked for none; the exchange post and the final read follow the same chain rule', () => {
  const critic = (lab, layer) => ({ provider: 'mock', model: 'm', lab, ...(layer === undefined ? {} : { layer }) });
  setHeldForTest(DEMAND);
  const cfg = (critics, extra = {}) => ({ signoff: 'unanimous', answer_back: { enabled: true }, seats: { critics }, ...extra });
  const says = c => S.criticPromptFor(c.seats.critics[0], false, undefined, c).includes(TOLD);
  const plain = c => S.criticPromptFor(c.seats.critics[0], false, undefined, c).includes(TOLD_PLAIN) && !S.criticPromptFor(c.seats.critics[0], false, undefined, c).includes('top layer lowers');
  assert.equal(S.severityLedgerPossible(cfg([critic('a', 1), critic('b', 2), critic('c', 3)])), true);
  assert.equal(says(cfg([critic('a', 1), critic('b', 2), critic('c', 3)])), true, 'three layers with answer_back (B3)');
  assert.equal(says(cfg([critic('a', 1), critic('b', 2)])), true, 'two layers with answer_back');
  assert.equal(plain(cfg([critic('a', 1), critic('b', 1)])), true, 'one layer');
  assert.equal(S.criticPromptFor(critic('a'), false, undefined, cfg([critic('a'), critic('b')])), recordedCritic(R.criticSystem(false)), 'an unlayered panel records no ratings: it is asked for none');   // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'S: the variant is chosen PER CHAIN'): OLD: R.criticSystem(false). NEW: recordedCritic(R.criticSystem(false)). WHY: error 'an unlayered panel records no ratings: it is asked for none': the actual differs from the constant only by the recorded W23 sentence and absence phrase (src/stage-system.js:73, :62), no rating text; still an exact equality.
  assert.equal(plain(cfg([critic('a', 1), critic('b', 2), critic('c', 3)], { answer_back: undefined })), true, 'a layered chain without answer_back: no ledger');
  const b3 = cfg([critic('a', 1), critic('b', 2), critic('c', 3)]); const one = cfg([critic('a', 1), critic('b', 1)]);
  assert.ok(S.layerDebateSystemFor(b3, b3.seats.critics[0], false).includes(TOLD) && S.layerDebateSystemFor(one, one.seats.critics[0], false).includes(TOLD_PLAIN), 'the exchange post follows the chain');
  assert.ok(S.finalReadSystemFor(b3.seats.critics[2], b3).includes(TOLD) && S.finalReadSystemFor(one.seats.critics[0], one).includes(TOLD_PLAIN), 'the final read follows the chain');
});

test('S: one digest pin per variant (the told sentences, the verdict prompt and the four exchange post prompts, with and without a ledger)', () => {
  const got = {
    told_ledger: sha16(R.SEVERITY_TOLD), told_plain: sha16(R.SEVERITY_TOLD_PLAIN),
    verdict_ledger: sha16(R.criticSystem(false, { severity: true, severityLedger: true })), verdict_plain: sha16(R.criticSystem(false, { severity: true })),
    post_r1_ledger: sha16(R.layerDebateSystem(false, { severity: true, severityLedger: true })), post_r1_plain: sha16(R.layerDebateSystem(false, { severity: true })),
    post_r2_ledger: sha16(R.layerDebateSystem(true, { severity: true, severityLedger: true })), post_r2_plain: sha16(R.layerDebateSystem(true, { severity: true })),
  };
  assert.deepEqual(got, VARIANT_DIGESTS);
});

// CHANGED ACCEPTED (0.8.4 S19; C&C's ruling 04 Nov 2026: the lint is REMOVED). OLD: 'the one-seat-layer lint says why in true words': lintSeverityChain({ signoff: 'unanimous', layers 1, 1, 2 }) returned `severity-one-seat-layer` whose message said "runs no exchange" and "nobody could debate an objection raised there" and named no Council count. NEW: the words are gone with the lint: the export `lintSeverityChain` does not exist, a chain with a one-seat layer produces no such finding, and src/chain-lint.js never names the kind. WHY: FEATURE_SPECS l.292 (Q4(d)): "A layer of one seat follows Q3: no exchange, sign-off by F2" (row NEW-A2-1; RU-ADD-A2 / RU-S3-70); S19 names no seat minimum. Its WORDING row (the lint message) is withdrawn. RED ON THE TREE THAT HAS THE LINT (the committed S19 (a) src): `lintSeverityChain` is exported and the finding comes back.
test('the one-seat-layer lint is gone: a layer with one seat is valid (the copy: it follows Q3, no exchange, sign-off by F2), so no export, no finding and no message of that kind exist', async () => {
  const Sev = await import('../src/severity.js');
  assert.equal(Sev.lintSeverityChain, undefined, 'no lintSeverityChain export');
  const critic = (lab, layer) => ({ provider: 'mock', model: 'mock-critic-a', lab, layer });
  const found = lintChain({ name: 'one-seat', signoff: 'unanimous', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [critic('a', 1), critic('b', 1), critic('c', 2)] } }, 'chain.json');
  assert.equal(found.some(f => f.kind === 'severity-one-seat-layer'), false, 'layer 2 has one seat and that is valid');
  assert.equal(readFileSync(join(root, 'src', 'chain-lint.js'), 'utf8').includes('severity-one-seat-layer'), false, 'chain-lint.js does not name the kind');
});
test('S: the accept-stance texts and the head-count helpers are gone (the count rule was withdrawn): no export, no sentence in any prompt, no council path in the contract', async () => {
  for (const name of ['LAYER_DEBATE_ACCEPT_STANCE', 'LAYER_DEBATE_COUNT_SCOPED', 'LAYER_REPLY_COUNT_SCOPED']) assert.equal(R[name], undefined, name);
  const Sev = await import('../src/severity.js');
  for (const name of ['COUNCIL_ACCEPT', 'councilAccepts']) assert.equal(Sev[name], undefined, name);
  for (const t of [R.criticSystem(false, { severity: true }), R.layerDebateSystem(false, { severity: true }), R.layerDebateSystem(true, { severity: true }), R.layerReplySystem?.(false, { severity: true }) ?? '']) {
    assert.doesNotMatch(t, /- accept: the writer declined|if more than half of the other reviewers|Council accepts/i);
  }
  // settleStateOf keeps every route that exists: the raiser's exchange withdrawal, an answered withdrawal with a quote from the draft, and nothing else settles
  assert.equal(Sev.settleStateOf({ exchange: 'withdrawn' }), 'withdrawn');
  assert.equal(Sev.settleStateOf({ answer: { effect: 'withdrawn', quoted: true } }), 'fixed');
  assert.equal(Sev.settleVerdict(8, 'council_accepted'), 'open', 'the removed state settles nothing');
  assert.equal(Sev.settleVerdict(5, 'council_accepted'), 'open');
  const src = readFileSync(join(root, 'src', 'severity.js'), 'utf8'); assert.doesNotMatch(src, /dissent/i);
});
