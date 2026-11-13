// 0.8.4 D22 (plan A T3.3, settled item 6): under `builder_kind: "one_shot"`, with its held words recorded (injected here as the re-record will export them), the handoff seat's prompt is written for a build session that
// works alone. Seat-written half only (the harness half is a later unit): the start line is removed, the dependency paragraph's "stops and asks the person" sentences are replaced, one note is added. Both forms
// of the prompt (default and milestone), the dry run's text for the `handoff` row, and the loud failure when a span is missing. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { setHeldForTest } from '../src/held-roles.js';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { oneShotSeatSystem, oneShotFor, oneShotHarnessWords } = await import('../src/builder-kind.js');
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { builderSection, itemOneClosing, ITEM_ONE_CLOSING_STEPS } = await import('../src/handoff-contract-text.js');
import { systemTextsFor } from '../src/stage-system.js';
import * as R from '../src/roles.js';
import * as HELD from './held-prompts/held-084-a.js';
import { oneShotDependencyEnd, oneShotHandoffNote, oneShotItemOneClosing, oneShotReplanLead, oneShotAssumptionsReport, oneShotGapsTail } from './held-prompts/held-084-a.js';

afterEach(() => setHeldForTest(null));
const WORDS = { oneShotDependencyEnd, oneShotHandoffNote };
const ASK = 'If it cannot check, it stops and asks the person. It never treats this list as already checked.';
const F = { request: 'Plan a CLI.', draft: '# Plan\n\n1. Install `commander` (npm, 12.1.0).\n', planFile: 'PLAN.md', checks: '' };

test('the held words are the plan\'s text, word for word (plan A T3 wording)', () => {
  assert.equal(oneShotDependencyEnd(), "If it cannot check, it does not install the item, records it under 'Assumptions' with what it did instead, and never treats this list as already checked.");
  assert.equal(oneShotHandoffNote(), 'The build session works alone: it cannot ask a person or run council commands. Never tell it to stop and ask; give the fallback the plan states, or tell it to skip the item and record it.');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: three rows proved the held state (one_shot inert while one of the two seat words, or fewer than the three harness words, were recorded; item 4's heading unrecorded) and the default form was compared with R.HANDOFF_SYSTEM. NEW: those held rows are removed (K7: after the recording no shipped run is held; SIBLINGS: 'the default form under one_shot' and 'the milestone form under one_shot' for the seat half, 'the harness half under one_shot, words recorded' for the harness half, and the recorded-alone assertions of the item 4 row); the default form is compared with the plain handoff prompt (which now carries the recorded 'Verify first' paragraph) (K5); the harness words and item 1 are re-pinned to the recorded text (K5). WHY: oneShotDependencyEnd, oneShotHandoffNote, oneShotItemOneClosing, oneShotReplanLead, oneShotAssumptionsReport, oneShotGapsTail, verifyFirstParagraph, verifyFirstItemOne are recorded (recorded-084-a.js).

test('the default form under one_shot: the start line is gone, the ask-the-person sentences are replaced, the note ends the prompt, nothing else moved', () => {
  setHeldForTest(WORDS);
  const got = handoffPrompt({ config: { builder_kind: 'one_shot' }, ...F });
  const plainDefault = handoffPrompt({ config: {}, ...F }).system;   // the default form as recorded: R.HANDOFF_SYSTEM plus the recorded 'Verify first' paragraph
  const expected = `${plainDefault.replace(', and the one line a human types to start it', () => '').replace(ASK, () => oneShotDependencyEnd())}\n\n${oneShotHandoffNote()}`;
  assert.equal(got.system, expected);
  assert.equal(got.system.includes('the one line a human types to start it'), false);
  assert.equal(got.system.includes('stops and asks the person'), false);
  assert.equal(got.user, R.handoffUser({ request: F.request, draft: F.draft, planFile: F.planFile, checks: F.checks }), 'the user prompt is untouched');
});

test('the milestone form under one_shot: the same two edits, the start line without its comma', () => {
  setHeldForTest(WORDS);
  const config = { builder_kind: 'one_shot', handoff_contract: { milestones: true } };
  const got = handoffPrompt({ config, ...F, criteria: ['A'] });
  const plain = handoffPrompt({ config: { handoff_contract: { milestones: true } }, ...F, criteria: ['A'] });
  assert.equal(got.system, `${plain.system.replace(' and the one line a human types to start it', () => '').replace(ASK, () => oneShotDependencyEnd())}\n\n${oneShotHandoffNote()}`);
  assert.equal(got.system.includes('the one line a human types to start it'), false);
  assert.equal(got.user, plain.user);
});

test('the dry run prices the text the handoff call will send: the estimate\'s handoff texts carry the note under one_shot', () => {
  setHeldForTest(WORDS);
  const texts = systemTextsFor('handoff', { builder_kind: 'one_shot' });
  assert.ok(texts.length >= 1 && texts.every(t => t.includes(oneShotHandoffNote())));
});

test('a span that is missing or doubled is a loud failure, never a silent skip: no start line, a start line twice, no dependency sentences, those twice', () => {
  const words = { dependencyEnd: oneShotDependencyEnd(), handoffNote: oneShotHandoffNote() };
  const good = `a, and the one line a human types to start it. ${ASK}`;
  assert.match(oneShotSeatSystem(good, words), /does not install the item/);
  assert.match(oneShotSeatSystem(`a and the one line a human types to start it. ${ASK}`, words), /does not install the item/, 'the form without a comma');
  assert.throws(() => oneShotSeatSystem(`a. ${ASK}`, words), /start line once \(found 0\)/);
  assert.throws(() => oneShotSeatSystem(`${good} b and the one line a human types to start it`, words), /start line once \(found 2\)/);
  assert.throws(() => oneShotSeatSystem('a, and the one line a human types to start it.', words), /dependency paragraph.*once \(found 0\)/);
  assert.throws(() => oneShotSeatSystem(`${good} ${ASK}`, words), /dependency paragraph.*once \(found 2\)/);
});

// ---- the HARNESS half (builderSection): "Before you build" and "Replan triggers" for a one-shot build session -----------------------------------------------------------------------------------------------------
const HARNESS = { oneShotItemOneClosing, oneShotReplanLead, oneShotAssumptionsReport };
const SHA = 'a'.repeat(64);
const ARGS = { thin: { sha256: SHA }, runId: 'r1', gaps: [{ kind: 'verify_first_missing', message: 'a gap' }] };

test('the harness words are the plan\'s text, word for word (plan A l.317, l.318 with STEP3 A1\'s fix, l.320; STEP3 A8\'s parenthetical)', () => {
  assert.equal(oneShotItemOneClosing(), 'Record each blocker in the decisions file as one line, with the assumption you made and the fallback you took, then continue with what you can build. A blocker with no fallback stops only the item it blocks. Do not work around a blocker silently.');
  assert.equal(oneShotReplanLead(), 'As soon as any of these is true, stop the item you are on, record why in the decisions file, and go on with the items that do not depend on it (a plan that the panel did not agree on and that nobody accepted as it stands stops every item, since every item rests on it):');
  assert.equal(oneShotGapsTail(), '(fix them, or record and skip the item)', 'STEP3 A8');
  assert.equal(oneShotAssumptionsReport(), "When you finish, end your report with a section 'Assumptions': one line per blocker you recorded, '<the blocker> - <the assumption you made> - <the fallback you took>', and one line per item you did not build because a blocker had no fallback. If there were none, write 'Assumptions: none'.");
});

test('the harness half under one_shot, words recorded: the section, line by line (a literal), with item 3\'s run-folder sentence, the contract trigger, the old lead line and item 1\'s send-back sentence gone and the Assumptions paragraph last, item 4\'s heading carrying A8\'s parenthetical', () => {
  setHeldForTest({ ...HARNESS, oneShotGapsTail });
  const got = builderSection({ ...ARGS, builderKind: 'one_shot' });
  const expected = `## Before you build (written by the harness, not by a seat)

${HELD.verifyFirstItemOne()} ${oneShotItemOneClosing()}
2. The acceptance criteria in the block at the end of this file are the definition of done. Do not edit them.
3. Thin contract: record sha256 ${SHA}, run r1. It seals the task, the criteria, the evidence the run recorded (the context documents and the tool results; not material handed in with \`--draft\` or \`--from-run\`) and the text it signed.

4. Gaps the harness found in this handoff's milestones ${oneShotGapsTail()}:
   - verify_first_missing: a gap

## Replan triggers (written by the harness, not by a seat)

${oneShotReplanLead()}

- A criterion's named check fails 2 times in a row. (Default 2, the number the harness's own stall rule treats as a stall; a chain can set \`handoff_contract.check_failures\`.)
- The file opens with a note that the text is not the signed text, or not a signed-off plan, and the plan's owner has not accepted it as it stands.
- A step needs a file, a fact or a tool that the evidence did not include. The council saw the task, the context documents and the tool results sealed in the contract; it never saw your repository.
- You are about to change what the plan says it will deliver, or to edit a criterion.

${oneShotAssumptionsReport()}
`;
  assert.equal(got, expected);
  assert.equal(got.endsWith('.\n') && !got.endsWith('\n\n'), true, 'it ends with exactly one newline, as today');
  // assertions a blank word cannot satisfy: the lines the switch removes are really gone
  assert.equal(got.includes('With the run folder'), false);
  assert.equal(got.includes('council contract check'), false);
  assert.equal(got.includes('council check-lock'), false);
  assert.equal(/send .{0,60} back/i.test(got), false, 'no send-back line anywhere, item 4\'s heading included');
  assert.equal(got.includes('to its owner, or into a new council run'), false);
});

test('the session section does not move when the harness words are recorded: builderSection without builderKind, or with "session", is the unrecorded text', () => {
  setHeldForTest(null);
  const today = builderSection(ARGS);
  setHeldForTest(HARNESS);
  assert.equal(builderSection(ARGS), today);
  assert.equal(builderSection({ ...ARGS, builderKind: 'session' }), today);
  assert.equal(today.includes('Send the blockers back to the person who owns the plan.'), true);
});

test('item 1\'s closing is an ordered list of steps: a later step sees the earlier step\'s text, in either order (who wins between one_shot and a not-agreed clause is that later step\'s call, at D2)', () => {
  setHeldForTest(HARNESS);
  const oneShot = oneShotHarnessWords();
  assert.equal(ITEM_ONE_CLOSING_STEPS.length, 1, 'the list has the one_shot step only until D2 adds its own');
  const NOT_AGREED = 'Send the blockers back to whoever accepted this plan as it stands.';
  const seen = [];
  const standIn = (closing, ctx) => { seen.push(closing); return ctx.oneShot ? `${closing} [stand-in saw one_shot]` : NOT_AGREED; };
  const [oneShotStep] = ITEM_ONE_CLOSING_STEPS;
  assert.equal(itemOneClosing({ oneShot }, [oneShotStep, standIn]), `${oneShotItemOneClosing()} [stand-in saw one_shot]`, 'one_shot first: the stand-in received the one_shot text');
  assert.equal(seen[0], oneShotItemOneClosing());
  assert.equal(itemOneClosing({ oneShot }, [standIn, oneShotStep]), oneShotItemOneClosing(), 'stand-in first: the one_shot step replaces whatever it left');
  assert.equal(itemOneClosing({ oneShot: null }, [oneShotStep, standIn]), NOT_AGREED, 'session: the one_shot step leaves the text alone; the stand-in decides');
  assert.equal(itemOneClosing({ oneShot: null }), 'Send the blockers back to the person who owns the plan. Do not work around them silently.', 'the default steps leave today\'s closing');
});

test('seat half and harness half together, every lane A word recorded at once, under one_shot: the handoff prompt (both forms) has no "stops and asks the person" and carries the note; the harness section has no "send the blockers back" / "send the plan back" and no `council contract` / `check-lock`, and carries the three harness words (the three claims the release-order hazard of D22\'s report needs)', () => {
  const all = Object.fromEntries(Object.entries(HELD).filter(([, v]) => typeof v === 'function'));
  setHeldForTest(all);
  for (const config of [{ builder_kind: 'one_shot' }, { builder_kind: 'one_shot', handoff_contract: { milestones: true } }]) {
    const seat = handoffPrompt({ config, ...F, criteria: ['A'] }).system;
    assert.equal(seat.includes('stops and asks the person'), false, JSON.stringify(config));
    assert.ok(seat.includes(oneShotHandoffNote()));
  }
  const harness = builderSection({ ...ARGS, builderKind: 'one_shot' });   // ARGS carries a gap, so item 4's heading is rendered
  assert.ok(harness.includes('4. Gaps the harness found'), 'the gaps heading is in the section');
  assert.equal(/send the (blockers|plan) back/i.test(harness), false);
  assert.equal(/council (contract|check-lock)/.test(harness), false);
  assert.ok(harness.includes(oneShotItemOneClosing()) && harness.includes(oneShotReplanLead()) && harness.includes(oneShotAssumptionsReport()));
  const session = builderSection({ ...ARGS });
  assert.ok(session.includes('Send the blockers back to the person who owns the plan.'), 'the session section keeps its send-back lines');
  assert.ok(session.includes('(fix them, or send the plan back):'), 'and its gaps heading');
});

test('item 4\'s heading has its own gate (STEP3 A8): the parenthetical changes under one_shot only, whichever of the three harness words are recorded, and only when oneShotGapsTail is recorded', () => {
  const TODAY = '(fix them, or send the plan back):';
  const heading = t => t.split('\n').find(l => l.startsWith('4. Gaps')) ?? null;
  setHeldForTest({ oneShotGapsTail });   // the tail alone, none of the three harness words
  assert.ok(heading(builderSection({ ...ARGS, builderKind: 'one_shot' })).endsWith('(fix them, or record and skip the item):'), 'recorded alone: the heading changes');
  assert.ok(heading(builderSection({ ...ARGS })).endsWith(TODAY), 'session: today\'s heading');
  assert.ok(heading(builderSection({ ...ARGS, builderKind: 'session' })).endsWith(TODAY));
  assert.notEqual(heading(builderSection({ ...ARGS, builderKind: 'one_shot' })), heading(builderSection({ ...ARGS })), 'the two headings differ');
  assert.equal(builderSection({ thin: ARGS.thin, runId: 'r1', builderKind: 'one_shot' }).includes('4. Gaps'), false, 'no gaps: no heading, nothing to change');
});

