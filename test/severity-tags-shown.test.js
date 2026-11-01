// B3 prep, JUDGE, TAGS SHOWN (his pick 1 Nov 2026: "Shown: the writer and the implementer can fix the serious problems first"): with the severity switch the writer's revise prompt and dispute prompt show each objection's rating in force as a plain
// `Severity: <number>` line, one sentence says what the number is, the builder-task lines of an early finish carry it, and a PASSED run's handoff lists the objections rated below 4 that stayed open. Switch off: every text byte-identical to the tree before
// (digests taken on 1db14d54 before roles.js was touched; test/helpers/layer-two-run.js drives the runs). A-DRAFT wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as R from '../src/roles.js';
import * as C from '../src/chain.js';
import * as SS from '../src/stage-system.js';
import { scenario } from './helpers/layer-two-run.js';

const d16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const BASE_DIGESTS = { reviserUser: 'b670a9175bd1c2ff', disputeUser: 'c4170830f51c67e9', builderTasks: '604f471407d3633e', reviserSystem: '91e474c39dc90db6', disputeSystem: '190ad43df0237f40' };
const F = [{ criterion: 'It lists the steps.', problem: 'No pour step.', fix: 'Add one.', quote: 'Steep.', quote_status: 'found', severity: 6.5, lab: 'la', id: 'O-aaaaaaaa', model: 'm1', model_layer: 2 }, { criterion: 'It names an owner.', problem: 'No owner.', fix: '', severity: 3, lab: 'lb', id: 'O-bbbbbbbb' }, { criterion: 'x', problem: 'y', fix: 'z' }];
const BASE = { request: 'Make tea.', criteria: ['It lists the steps.', 'It names an owner.'], draft: 'Boil water.' };
const TASKS = [{ id: 'O-aaaaaaaa', lab: 'la', criterion: 'It lists the steps.', problem: 'No pour step.', handled: 'declined', declined_reason: 'Out of scope.', severity: 6.5 }, { id: 'O-bbbbbbbb', lab: 'lb', criterion: 'c', problem: 'p', handled: 'open' }];

test('switch OFF (the default): reviserUser, disputeUser, withBuilderTasks and the two system texts are byte-identical to the tree before, even when the failures carry a severity (digests taken before)', () => {
  assert.equal(d16(R.reviserUser({ ...BASE, critique: { failures: F, verdict_line: 'no' } })), BASE_DIGESTS.reviserUser);
  assert.equal(d16(R.disputeUser({ ...BASE, failures: F })), BASE_DIGESTS.disputeUser);
  assert.equal(d16(C.withBuilderTasks('# Handoff\n\n## Status\nok', TASKS.map(({ severity, ...t }) => t))), BASE_DIGESTS.builderTasks, 'a task with no rating reads as before');
  assert.equal(d16(R.reviserSystem(false, false, undefined)), BASE_DIGESTS.reviserSystem);
  assert.equal(d16(R.DISPUTE_SYSTEM), BASE_DIGESTS.disputeSystem);
});

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

test('the writer\'s sentence: appended to a system prompt only under the chain switch, and names no band', () => {
  assert.equal(SS.withSeveritySentence({}, 'S'), 'S');
  assert.equal(SS.withSeveritySentence({ severity: { enabled: false } }, 'S'), 'S');
  const s = SS.withSeveritySentence({ severity: { enabled: true } }, R.DISPUTE_SYSTEM, 'dispute');   // milestone 2: the reviser/dispute texts are edited first, then the sentence is appended; a text without the anchors throws, so a real system text is used
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

test('run (severity on, a 5 raised): the revise prompt and the dispute prompt show "Severity: 5" and carry the sentence; with the switch off neither does', async () => {
  const on = await scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 } });
  for (const l of ['revise-1', 'dispute']) assert.ok(on.prompts.get(l), `the ${l} call was made with the switch on`);
  assert.ok(on.prompts.get('revise-1').user.includes('\n   Severity: 5\n') && on.prompts.get('revise-1').system.includes(R.SEVERITY_WRITER_SENTENCE));
  assert.ok(on.prompts.get('dispute').user.includes('\n   Severity: 5\n') && on.prompts.get('dispute').system.includes(R.SEVERITY_WRITER_SENTENCE));
  const off = await scenario({ severity: false, answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 } });
  for (const l of ['revise-1', 'dispute']) assert.ok(off.prompts.get(l), `the ${l} call was made with the switch off`);
  assert.equal(off.prompts.get('revise-1').user.includes('Severity:') || off.prompts.get('revise-1').system.includes(R.SEVERITY_WRITER_SENTENCE), false);
  assert.equal(off.prompts.get('dispute').user.includes('Severity:') || off.prompts.get('dispute').system.includes(R.SEVERITY_WRITER_SENTENCE), false);
});

test('run (a PASSED run whose only objection is rated 3): the handoff ends with the swept section and its rating; with the switch off, or with nothing swept, the handoff is untouched', async () => {
  const swept = await scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 3, extra: { handoff: true } });
  assert.equal(swept.result.passed, true);
  assert.match(swept.result.handoff, /\n## Objections rated below 4 left open\n[\s\S]*- SO-1 \([^)]*raised by la; severity 3\): /);
  // switch off, a 3 is an ordinary objection and the run would never pass: the off case is a clean sign-off (the section needs the switch AND something swept)
  const SIGNOFF = JSON.stringify({ meets: true, criteria: [{ criterion: 'The plan defines a retry limit.', verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
  const off = await scenario({ severity: false, answerBack: true, ladder: false, extra: { handoff: true }, overrides: { 'panel-1-la': SIGNOFF } });
  assert.equal(typeof off.result.handoff, 'string', 'the switch-off run has a handoff to look at');
  assert.equal(off.result.handoff.includes('left open'), false);
  const none = await scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 3, extra: { handoff: true }, overrides: { 'panel-1-la': SIGNOFF } });
  assert.equal(typeof none.result.handoff, 'string', 'the nothing-swept run has a handoff to look at');
  assert.equal(none.result.handoff.includes('left open'), false);
});
