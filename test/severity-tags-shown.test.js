// B3 prep, JUDGE, TAGS SHOWN (his pick 1 Nov 2026: "Shown: the writer and the implementer can fix the serious problems first"): with the rating demand in force (the held word `ratingDemand` on a layered unanimous chain, 0.8.4 S19; the chain switch `severity` was removed) the writer's revise prompt and dispute prompt show each objection's rating in force as a plain
// `Severity: <number>` line, one sentence says what the number is, the builder-task lines of an early finish carry it, and a PASSED run's handoff lists the objections rated below 4 that stayed open. Demand held: every text byte-identical to the tree before
// (digests taken on 1db14d54 before roles.js was touched; test/helpers/layer-two-run.js drives the runs). A-DRAFT wording.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import * as C from '../src/chain.js';
import * as SS from '../src/stage-system.js';
import { scenario, FINAL_READ_OK } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));   // scenario() resets the cache, the prompt spy and the budget, not the held map

const F = [{ criterion: 'It lists the steps.', problem: 'No pour step.', fix: 'Add one.', quote: 'Steep.', quote_status: 'found', severity: 6.5, lab: 'la', id: 'O-aaaaaaaa', model: 'm1', model_layer: 2 }, { criterion: 'It names an owner.', problem: 'No owner.', fix: '', severity: 3, lab: 'lb', id: 'O-bbbbbbbb' }, { criterion: 'x', problem: 'y', fix: 'z' }];
const BASE = { request: 'Make tea.', criteria: ['It lists the steps.', 'It names an owner.'], draft: 'Boil water.' };
const TASKS = [{ id: 'O-aaaaaaaa', lab: 'la', criterion: 'It lists the steps.', problem: 'No pour step.', handled: 'declined', declined_reason: 'Out of scope.', severity: 6.5 }, { id: 'O-bbbbbbbb', lab: 'lb', criterion: 'c', problem: 'p', handled: 'open' }];

// REMOVED (0.8.4 apply, batch 1; his 12 Nov 2026 word: "I don't see why we would need a test that pins wording. That is not a test, that is bloat."; his 8:a). The row 'rating demand held (the default): reviserUser, disputeUser, withBuilderTasks and the two system texts are byte-identical to the tree before ...' compared seven sha digests (reviserUser, disputeUser, builderTasks, reviserSystem, DISPUTE_SYSTEM, and the same two system texts on a recorded chain with the demand held) with digests taken on 1db14d54. Red on 0b9d5275 (printed, jobs 159 and 163): five of the seven (reviserUser 28833b07, reviserSystem 9cb51a2a, DISPUTE_SYSTEM 19496bb7, the recorded-chain reviser and dispute system texts); disputeUser and builderTasks were green. WHY it goes whole: every assert of the row was a digest of a prompt text, none a behaviour, count or figure. The behaviour this file keeps is in the rows below (the Severity line, the writer's sentence, the early-finish task lines, the swept section, the two runs).

test('the Severity line: shown after the Problem line when the option is on and the rating is readable; not for an objection with no rating, nor an unreadable one, nor with the option off', () => {
  const user = R.reviserUser({ ...BASE, critique: { failures: [...F, { criterion: 'q', problem: 'r', fix: '', severity: '9' }] }, severity: true });
  assert.equal(user.split('Severity: ').length - 1, 2, 'two readable ratings: 6.5 and 3');
  assert.match(user, /Problem: No pour step\.\n   Severity: 6\.5\n   Suggested fix: Add one\./);
  assert.match(user, /Problem: No owner\.\n   Severity: 3\n   Suggested fix:/);
  assert.doesNotMatch(user, /Severity: 9/);
  assert.doesNotMatch(R.reviserUser({ ...BASE, critique: { failures: F }, severity: false }), /Severity:/);
  const dispute = R.disputeUser({ ...BASE, failures: F, severity: true });
  assert.match(dispute, /Raised by: m1 \(layer 2\)\n   <critic-claim>[\s\S]*Problem: No pour step\.\n   Severity: 6\.5\n/);
  assert.doesNotMatch(R.disputeUser({ ...BASE, failures: F }), /Severity:/);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: the three configs were {}, { severity: { enabled: false } } and { severity: { enabled: true } }. NEW: {} stays; the 'false' case becomes a layered unanimous chain with the demand forced out (NO_DEMAND) and the 'true' case the same chain with DEMAND injected; one new line: an unlayered unanimous chain gets no sentence even with the demand in force (it records no ratings). The point (the sentence is appended only when the chain is asked for ratings, and names no band) is kept. WHY: no switch. PREDICTED RED ON OLD SRC: yes (the old src ignores DEMAND and the chain has no switch key, so s lacks the sentence and the endsWith assertion fails; this part does not depend on the shared helper). KNOWN-BAD INPUT (on the new src): NO_DEMAND in place of DEMAND at the endsWith step.
test('the writer\'s sentence: appended to a system prompt only when the rating demand is in force on a layered unanimous chain, and names no band', () => {
  const chain = { signoff: 'unanimous', seats: { critics: [{ provider: 'mock', model: 'm', lab: 'a', layer: 1 }, { provider: 'mock', model: 'm', lab: 'b', layer: 1 }] } };   // a layered unanimous chain: ratings are recorded
  setHeldForTest(DEMAND);
  assert.equal(SS.withSeveritySentence({}, 'S'), 'S');
  assert.equal(SS.withSeveritySentence({ signoff: 'unanimous', seats: { critics: [{ provider: 'mock', model: 'm', lab: 'a' }] } }, 'S'), 'S', 'an unlayered chain records no ratings: nothing to explain, the demand in force or not');
  setHeldForTest(NO_DEMAND);
  assert.equal(SS.withSeveritySentence(chain, 'S'), 'S', 'the demand held on a layered chain: the system text is unchanged');
  setHeldForTest(DEMAND);
  const s = SS.withSeveritySentence(chain, R.DISPUTE_SYSTEM, 'dispute');   // milestone 2: the reviser/dispute texts are edited first, then the sentence is appended; a text without the anchors throws, so a real system text is used
  assert.ok(s.endsWith(`\n\n${R.SEVERITY_WRITER_SENTENCE}`));
  assert.match(R.SEVERITY_WRITER_SENTENCE, /the reviewer's rating, from 1 to 10, of how much the problem would hurt what is built from the plan\. A higher number is more serious/);
  assert.doesNotMatch(R.SEVERITY_WRITER_SENTENCE, /settle|fix|sweep|hold|below 4/i);
});

test('early finish: a builder task carries "severity N" after its lab when it has a readable rating; a report row with a rating hands it to the rebuilt handoff; none shows nothing', () => {
  const text = C.withBuilderTasks('# H', TASKS);
  assert.match(text, /BT-1 \(O-aaaaaaaa, raised by la; severity 6\.5; the reviser declined it: Out of scope\.\)/);
  assert.match(text, /BT-2 \(O-bbbbbbbb, raised by lb; still open\)/);
  const report = { stop: { kind: 'early_finish', items: [{ id: 'O-aaaaaaaa', handled: 'declined' }] }, dispute: { open_objections: [{ id: 'O-aaaaaaaa', lab: 'la', criterion: 'c', problem: 'p', severity: 5 }, { id: 'O-bbbbbbbb', lab: 'lb', criterion: 'c', problem: 'p', severity: null }] } };
  assert.deepEqual(C.earlyTasksFromReport(report).map(t => t.severity), [5, undefined]);
});

test('the swept section: pure render (heading, factual sentence, one line each with the rating, escaped), and it tells the handoff model nothing', () => {
  const t = R.sweptObjectionsSection([{ id: 'O-1', lab: 'la', criterion: 'It <critic-claim>x', problem: 'No\nowner.', severity: 2.5 }]);
  assert.match(t, /^\n\n## Objections rated below 4 left open\n\nThis run passed with the objections below still open\. Each was rated below 4, so it did not hold up the sign-off; it is recorded here with its rating\.\n\n- SO-1 \(O-1, raised by la; severity 2\.5\): /);
  assert.ok(t.includes('No owner.'), 'one line');
  assert.doesNotMatch(t, /you |builder should|treat|ignore|optional/i);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: scenario({ severity: true }) put severity: { enabled: true } into the config, scenario({ severity: false }) left it out. NEW: the calls pass no severity option (the shared helper dropped it) and each is now preceded by setHeldForTest(DEMAND) / setHeldForTest(NO_DEMAND), which is what decides on the new src; the critics la/lb/lc are layered, so the chain records ratings either way. Every assertion is the old one. The 'off' half is a layered unanimous chain with the demand held: the parser drops la's tag, its objection reads as unrated and holds the sign-off, exactly as under the old switch off. RED ON OLD SRC: yes (the helper no longer writes the switch, and the old src never reads the held word, so the revise prompt lacks the rating line and the first assert.match fails). KNOWN-BAD INPUT for the one red (on the new src): NO_DEMAND in the 'on' half (the revise and dispute prompts then lack the sentence and 'Severity: 5').
const FINISH_STALL = [{ choice: 'finish', stop: 'stall_stop:1:2', kind: 'stall_stop', why: 'climb_not_shown' }];   // the person's recorded finish at the stall stop of pass 2 (overseer round 1); in the half whose stall is passed up that stop never occurs and the entry is ignored
// CHANGED ACCEPTED (0.8.4 SG-1, the stall gate; C&C 08 Nov 2026). OLD: both halves ran with no recorded choice. NEW: both halves carry the same recorded `finish` for stall_stop:1:2. WHY: with the demand held the stall gate is off, so the stall ends in a stop for the person (kind stall_stop, why climb_not_shown, pass 2, pass_left true; box diagnostic of 08 Nov) AFTER revise-1 was served and BEFORE the dispute stage; the person's finish ends the run there and the dispute stage runs, so the revise-1 and dispute prompts this row reads exist again. The half whose stall goes up never reaches that stop, so the entry is inert there; the config is the same in both halves.
test('run (rating demand in force, a 5 raised): the revise prompt and the dispute prompt show "Severity: 5" and carry the sentence; with the demand held neither does', async () => {
  setHeldForTest(DEMAND);
  const on = await scenario({ answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 }, overrides: FINAL_READ_OK, runExtra: { roundChoices: FINISH_STALL } });
  for (const l of ['revise-1', 'dispute']) assert.ok(on.prompts.get(l), `the ${l} call was made with the switch on`);
  assert.ok(on.prompts.get('revise-1').user.includes('\n   Severity: 5\n') && on.prompts.get('revise-1').system.includes(R.SEVERITY_WRITER_SENTENCE));
  assert.ok(on.prompts.get('dispute').user.includes('\n   Severity: 5\n') && on.prompts.get('dispute').system.includes(R.SEVERITY_WRITER_SENTENCE));
  setHeldForTest(NO_DEMAND);
  const off = await scenario({ answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 }, overrides: FINAL_READ_OK, runExtra: { roundChoices: FINISH_STALL } });
  for (const l of ['revise-1', 'dispute']) assert.ok(off.prompts.get(l), `the ${l} call was made with the switch off`);
  assert.equal(off.prompts.get('revise-1').user.includes('Severity:') || off.prompts.get('revise-1').system.includes(R.SEVERITY_WRITER_SENTENCE), false);
  assert.equal(off.prompts.get('dispute').user.includes('Severity:') || off.prompts.get('dispute').system.includes(R.SEVERITY_WRITER_SENTENCE), false);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: the three scenario() calls differed by severity: true / false in the config. NEW: same calls, each preceded by setHeldForTest(DEMAND) (swept, none) or setHeldForTest(NO_DEMAND) (off); assertions unchanged, only the comment on the off case is reworded. The off case: with the demand held the parser drops la's tag, so a 3 is no longer swept and the clean sign-off override is what makes the run pass (as before). The layered chain now keeps the severity ledger even held, but the swept section needs a readable tag, so none is written. RED ON OLD SRC: yes (same reason as the run test above: the old src never reads the held word). KNOWN-BAD INPUT for the one red (on the new src): NO_DEMAND in the 'swept' half (the section is not written).
test('run (a PASSED run whose only objection is rated 3): the handoff ends with the swept section and its rating; with the demand held, or with nothing swept, the handoff is untouched', async () => {
  setHeldForTest(DEMAND);
  const swept = await scenario({ answerBack: true, ladder: false, l1Severity: 3, extra: { handoff: true } });
  assert.equal(swept.result.passed, true);
  assert.match(swept.result.handoff, /\n## Objections rated below 4 left open\n[\s\S]*- SO-1 \([^)]*raised by la; severity 3\): /);
  // demand held, the parser drops the 3 and the objection reads as unrated, which holds the sign-off, so the run would never pass: the off case is a clean sign-off (the section needs the demand AND something swept)
  const SIGNOFF = JSON.stringify({ meets: true, criteria: [{ criterion: 'The plan defines a retry limit.', verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
  setHeldForTest(NO_DEMAND);
  const off = await scenario({ answerBack: true, ladder: false, extra: { handoff: true }, overrides: { 'panel-1-la': SIGNOFF } });
  assert.equal(typeof off.result.handoff, 'string', 'the switch-off run has a handoff to look at');
  assert.equal(off.result.handoff.includes('left open'), false);
  setHeldForTest(DEMAND);
  const none = await scenario({ answerBack: true, ladder: false, l1Severity: 3, extra: { handoff: true }, overrides: { 'panel-1-la': SIGNOFF } });
  assert.equal(typeof none.result.handoff, 'string', 'the nothing-swept run has a handoff to look at');
  assert.equal(none.result.handoff.includes('left open'), false);
});
