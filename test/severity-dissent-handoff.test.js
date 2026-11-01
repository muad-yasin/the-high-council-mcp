// B3 prep, JUDGE, TAGS SHOWN completed (C&C FIX 2 Nov 2026, the owner's 1 Nov pick: "the handoff tasks carry each objection's tag"): with the severity switch every Unresolved-dissent row of a not-agreed end shows its rating in force as a
// `Severity: <number>` line (no band words) right after the "Raised by" line, and the handoff seat is told what that number is (the sentence the reviser and the dispute prompt already carry). Switch off: neither the row nor the prompt changes.
// A-DRAFT wording. $0, offline (test/helpers/layer-two-run.js drives the runs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { scenario } from './helpers/layer-two-run.js';

const dissentOf = deliverable => { const i = deliverable.indexOf('## Unresolved dissent'); assert.ok(i >= 0, 'the run ended not agreed, so the deliverable carries the dissent block'); return deliverable.slice(i, deliverable.indexOf('\n---\n', i)); };

test('run (severity on, a 5 raised, the run ends not agreed): each dissent row carries "Severity: 5" right after its Raised-by line; with the switch off the block has no rating line and is otherwise the same', async () => {
  const on = await scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 } });
  const off = await scenario({ severity: false, answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 } });
  const bOn = dissentOf(on.result.deliverable); const bOff = dissentOf(off.result.deliverable);
  assert.match(bOn, /\n\*Raised by [^\n]*\*\nSeverity: 5\n\n/, bOn);
  assert.equal(bOff.includes('Severity:'), false, bOff);
  assert.equal(bOn.replace(/\nSeverity: 5\n/g, '\n'), bOff, 'apart from the rating lines the two blocks are the same text (the Raised-by line and the opening are untouched)');
});

test('handoff seat: with the severity switch the system prompt ends with the rating sentence (the held milestone prompt too); with it off, or absent, the prompts are what they always were', () => {
  const base = { request: 'Make tea.', draft: 'Boil water.' };
  const onPlain = handoffPrompt({ ...base, config: { severity: { enabled: true } } });
  assert.equal(onPlain.system, `${R.HANDOFF_SYSTEM}\n\n${R.SEVERITY_WRITER_SENTENCE}`);
  const offPlain = handoffPrompt({ ...base, config: { severity: { enabled: false } } });
  const none = handoffPrompt({ ...base, config: {} });
  assert.equal(offPlain.system, R.HANDOFF_SYSTEM); assert.equal(none.system, R.HANDOFF_SYSTEM);
  assert.equal(offPlain.user, onPlain.user, 'the user prompt is the same either way (the rating rides in the draft)');
  const onMs = handoffPrompt({ ...base, config: { severity: { enabled: true }, handoff_contract: { milestones: true } } });
  assert.ok(onMs.system.endsWith(`\n\n${R.SEVERITY_WRITER_SENTENCE}`), 'the milestone prompt ends with the sentence too');
  const offMs = handoffPrompt({ ...base, config: { handoff_contract: { milestones: true } } });
  assert.equal(offMs.system.includes(R.SEVERITY_WRITER_SENTENCE), false);
});
