// 0.8.4 D17 (plan A T1.3, slice 1; STEP3 F4; T3.3 entries 2, 3, 4 and 5): the "Verify first" list. The handoff SEAT writes it (entry 2 asks for it, entry 3 ties the milestone form's Status to it); the harness reads it back
// (the gap check `verify_first_missing`, through the one marker parser of src/claim-markers.js), points "Before you build" item 1 at it (entry 4) and appends its own line after it (entry 5). Every sentence is a held word
// (test/held-prompts/held-084-a.js), injected here as the re-record will export it; unrecorded, everything is today's text, byte for byte, and the gap check is inert. Callers are not wired yet. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setHeldForTest } from '../src/held-roles.js';
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { verifyFirstSection, verifyFirstGaps, withVerifyFirst, withNoTestsLine } = await import('../src/verify-first.js').catch(() => ({}));
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { unverifiedMarkers } = await import('../src/claim-markers.js').catch(() => ({}));
import { lintMilestones } from '../src/milestones.js';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { oneShotSeatSystem } from '../src/builder-kind.js';
import { systemTextsFor } from '../src/stage-system.js';
import { builderSection } from '../src/handoff-contract-text.js';
import * as R from '../src/roles.js';
import { verifyFirstParagraph, verifyFirstStatusRule, verifyFirstItemOne, handoffNoTestsLine, oneShotDependencyEnd, oneShotHandoffNote } from './held-prompts/held-084-a.js';

afterEach(() => setHeldForTest(null));
const ALL = { verifyFirstParagraph, verifyFirstStatusRule, verifyFirstItemOne, handoffNoTestsLine };
const PLAN = "# Plan\n\n## 2. Reading\n\nThe module caches by path [UNVERIFIED: settle by reading _get_module_details in the interpreter's runpy module].\n\n## 3. Risks\n\nThe cache may be stale [UNVERIFIED: check the cache_ttl setting in src/cache.js].\n";
const GAP2 = "verify_first_missing";
const msg = n => ({ 2: "section 3 of the plan rests on 'The cache may be stale.', which the plan marks UNVERIFIED, and the 'Verify first' section does not name it.", 1: "section 2 of the plan rests on 'The module caches by path.', which the plan marks UNVERIFIED, and the 'Verify first' section does not name it." })[n];
const handoffWith = verify => `Status: ready_for_build\n\n## What this is\nA plan.\n\n${verify}\n\n## Milestones\n### M0 - skeleton\nEntry: none\nWork: item 1 (section 2)\nExit:\n- check: C1 | npm test => passes\n`;

test('the one marker parser: unverifiedMarkers reads every UNVERIFIED marker of the plan\'s own sections, with its section and line, the sentence without its markers, and what would settle it', () => {
  assert.deepEqual(unverifiedMarkers(PLAN), [
    { section: '2', line: 5, claim: 'The module caches by path.', body: "settle by reading _get_module_details in the interpreter's runpy module" },
    { section: '3', line: 9, claim: 'The cache may be stale.', body: 'check the cache_ttl setting in src/cache.js' },
  ]);
  assert.deepEqual(unverifiedMarkers('# P\n\n```\nx [UNVERIFIED: in a code block].\n```\n\nNo markers here.\n'), []);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'the gap check is INERT while the seat paragraph of entry 2 is unrecorded' sat here. NEW: removed; its sibling 'recorded: a marker the "Verify first" section does not name is a gap' below asserts the recorded gaps on the same path. WHY: the entry 2 words are recorded (src/prompts/recorded-084-a.js verifyFirstParagraph, D17), so no shipped run is in the unrecorded state.
test('recorded: a marker the "Verify first" section does not name is a gap, one per marker, in the plan\'s order; a marker it names (by its identifier, or its claim in a "none" line) is not', () => {
  setHeldForTest(ALL);
  const one = handoffWith("## Verify first\n- _get_module_details in runpy - read it in the interpreter's source - stop");
  assert.deepEqual(verifyFirstGaps({ plan: PLAN, handoff: one }), [{ kind: GAP2, message: msg(2) }]);
  const none = handoffWith("## Verify first\n- _get_module_details in runpy - read it - stop\n- The cache may be stale - none: no step rests on it");
  assert.deepEqual(verifyFirstGaps({ plan: PLAN, handoff: none }), [], 'F4: a "none" line names its claim');
  const both = handoffWith('## Verify first\n- cache_ttl in src/cache.js - read it - the plan\'s fallback\n- runpy _get_module_details - read - stop');
  assert.deepEqual(verifyFirstGaps({ plan: PLAN, handoff: both }), []);
  assert.deepEqual(verifyFirstGaps({ plan: PLAN, handoff: handoffWith('## Verify first\n- nothing named here') }).map(g => g.message), [msg(1), msg(2)]);
});

test('the empty case: a plan with no UNVERIFIED marker and the seat\'s "Verify first: nothing - ..." line give no gap; a plan WITH markers and that same line gives one gap per marker; no section at all gives one per marker', () => {
  setHeldForTest(ALL);
  const nothing = handoffWith('Verify first: nothing - the plan marks no claim UNVERIFIED and names nothing to install.');
  assert.deepEqual(verifyFirstGaps({ plan: '# Plan\n\n## 1. A\n\nThe loop retries.\n', handoff: nothing }), []);
  assert.equal(verifyFirstGaps({ plan: PLAN, handoff: nothing }).length, 2);
  assert.equal(verifyFirstGaps({ plan: PLAN, handoff: handoffWith('') }).length, 2, 'no "Verify first" section: loud, one gap per marker');
});

test('verifyFirstSection finds a heading with its lines up to the next heading, a label line with its block up to the first blank line, and an inline label alone; none gives found: false', () => {
  assert.deepEqual(verifyFirstSection('a\n## Verify first\n- x\n- y\n\n## Next\nz'), { found: true, start: 1, end: 4, lines: ['## Verify first', '- x', '- y'] });
  assert.deepEqual(verifyFirstSection('Verify first:\n- x\n- y\n\nother text\n').lines, ['Verify first:', '- x', '- y']);
  assert.deepEqual(verifyFirstSection('Verify first: nothing - none.\nmore text\n').lines, ['Verify first: nothing - none.']);
  assert.equal(verifyFirstSection('no such section').found, false);
  for (const heading of ['## 2. Verify first', '### Verify first (before any code)', '# **Verify first**']) assert.deepEqual(verifyFirstSection(`a\n${heading}\n- x\n\n## Next`).lines, [heading, '- x'], heading);
});

test('lintMilestones: with `plan` given and the words recorded the gaps join its findings (first); without `plan`, or with the words unrecorded, the findings are exactly what they were', () => {
  const text = handoffWith('## Verify first\n- nothing named here');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the findings without a plan were also compared with the findings with a plan while the words were unrecorded. NEW: that half is removed (its sibling assertions below pin the recorded gaps with the plan and the unchanged findings without it). WHY: verifyFirstParagraph is recorded (D17, recorded-084-a.js).
  const base = lintMilestones({ text, criteriaIds: ['C1'] }).findings;
  setHeldForTest(ALL);
  assert.deepEqual(lintMilestones({ text, criteriaIds: ['C1'] }).findings, base, 'no plan given');
  assert.deepEqual(lintMilestones({ text, criteriaIds: ['C1'], plan: PLAN }).findings, [{ kind: GAP2, message: msg(1) }, { kind: GAP2, message: msg(2) }, ...base]);
});

test('the seat prompt, both forms: the paragraph goes right BEFORE the dependency paragraph exactly once, and (milestone form only) the Status rule right after the Status instruction; unrecorded, the prompts are the shared text', () => {
  const ANCHOR = 'If the plan has the build session install or download anything';
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: two assertions said that unrecorded, withVerifyFirst returned the shared prompts unchanged. NEW: removed (the recorded insertions are pinned just below, whole). WHY: verifyFirstParagraph and verifyFirstStatusRule are recorded (D17).
  setHeldForTest(ALL);
  assert.equal(withVerifyFirst(R.HANDOFF_SYSTEM), R.HANDOFF_SYSTEM.replace(ANCHOR, () => `${verifyFirstParagraph()}\n\n${ANCHOR}`));
  const m = R.handoffSystem({ milestones: true });
  const outM = withVerifyFirst(m, { milestones: true });
  assert.equal(outM, m.replace(ANCHOR, () => `${verifyFirstParagraph()}\n\n${ANCHOR}`).replace('Say which, and why, in the next section.', () => `Say which, and why, in the next section. ${verifyFirstStatusRule()}`));
  assert.equal(withVerifyFirst(m).includes(verifyFirstStatusRule()), false, 'the Status rule is for the milestone form only');
  assert.throws(() => withVerifyFirst('a prompt with no dependency paragraph'), /dependency paragraph once \(found 0\)/);
  assert.throws(() => withVerifyFirst(`${R.HANDOFF_SYSTEM}\n${ANCHOR}`), /once \(found 2\)/);
  assert.throws(() => withVerifyFirst(R.HANDOFF_SYSTEM, { milestones: true }), /Status instruction once \(found 0\)/);
});

test('handoffPrompt: the seat words reach the prompt in both forms and the dry run\'s text; they sit beside the one-shot edits without touching them, whichever is applied first (the two functions commute)', () => {
  setHeldForTest({ ...ALL, oneShotDependencyEnd, oneShotHandoffNote });
  for (const config of [{}, { handoff_contract: { milestones: true } }]) {
    const base = handoffPrompt({ config, request: 'R', draft: 'D', criteria: ['A'] });
    assert.ok(base.system.includes(verifyFirstParagraph()), JSON.stringify(config));
    const one = handoffPrompt({ config: { ...config, builder_kind: 'one_shot' }, request: 'R', draft: 'D', criteria: ['A'] });
    assert.ok(one.system.includes(verifyFirstParagraph()));
    assert.ok(one.system.includes(oneShotDependencyEnd()));
    assert.equal(one.system.includes('stops and asks the person'), false);
    assert.ok(one.system.indexOf(verifyFirstParagraph()) < one.system.indexOf(oneShotDependencyEnd()), 'the Verify first paragraph precedes the dependency paragraph the one-shot edit changes');
  }
  assert.ok(systemTextsFor('handoff', {}).every(t => t.includes(verifyFirstParagraph())), 'the dry run prices the same text');
  const words = { dependencyEnd: oneShotDependencyEnd(), handoffNote: oneShotHandoffNote() };
  for (const [sys, opt] of [[R.HANDOFF_SYSTEM, {}], [R.handoffSystem({ milestones: true }), { milestones: true }]]) {
    assert.equal(oneShotSeatSystem(withVerifyFirst(sys, opt), words), withVerifyFirst(oneShotSeatSystem(sys, words), opt), JSON.stringify(opt));
  }
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the last assertion said that unrecorded, handoffPrompt's system text was R.HANDOFF_SYSTEM. NEW: removed (the loop above pins the recorded text in both forms). WHY: the entry 2 words are recorded (D17).
});

test('entry 5: the harness line goes after the last line of the seat\'s "Verify first" section when no fenced block is a test file; with no section it ends the text as its own line; only then, once, and only when recorded', () => {
  const text = handoffWith('## Verify first\n- a - b - stop\n- c - d - the plan\'s fallback');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the first assertion said that unrecorded, withNoTestsLine added nothing. NEW: removed (the recorded line is pinned below, whole). WHY: handoffNoTestsLine is recorded (D17 entry 5, recorded-084-a.js).
  setHeldForTest(ALL);
  const out = withNoTestsLine(text, true);
  assert.equal(out, text.replace("- c - d - the plan's fallback", () => `- c - d - the plan's fallback\n${handoffNoTestsLine()}`));
  assert.equal(withNoTestsLine(out, true), out, 'idempotent');
  assert.equal(withNoTestsLine(text, false), text, 'a task that fenced a test file gets none');
  const none = withNoTestsLine('Status: ready_for_build\n\n## What this is\nA plan.\n', true);
  assert.ok(none.endsWith(`\n\n${handoffNoTestsLine()}\n`));
  const inline = withNoTestsLine(handoffWith('Verify first: nothing - the plan marks no claim UNVERIFIED and names nothing to install.'), true);
  assert.ok(inline.includes(`Verify first: nothing - the plan marks no claim UNVERIFIED and names nothing to install.\n${handoffNoTestsLine()}\n`));
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the five sha256 pins were taken on today's text (item 1 with 'write down every blocker you can see') and a second half compared the unrecorded section with the recorded one. NEW: the five pins are the sha256 of the same five sections with the recorded first two sentences of item 1 (re-computed from the section's own source, after the old five were reproduced exactly by the same computation); the unrecorded half is removed, its sibling 'the held words are the plan's text, word for word' pins verifyFirstItemOne whole. WHY: verifyFirstItemOne is recorded (D17 entry 4, src/prompts/recorded-084-a.js).
test('"Before you build" item 1 (entry 4): builderSection carries the recorded first two sentences of item 1 and nothing else moved (sha256 pins over five fixtures)', () => {
  const thin = { sha256: 'a'.repeat(64) };
  const sha = t => createHash('sha256').update(t).digest('hex');
  const FIX = {
    'no gaps': [{ thin, runId: 'r1' }, 'db5b7878fc72785f4726df6840e0c46dad9c0b1edbfb520ab29fe1593f5a4315'],
    'gaps': [{ thin, runId: 'r1', gaps: [{ kind: 'k', message: 'm' }] }, '3310ead4ac5629027ee1b8af77d057ca8039b6ec79bfe0975bcd1764d8a8fd53'],
    'checks': [{ thin, runId: 'r1', hasChecks: true }, '580acf6bf788e9dd75138ca4315bab171bbbea451c02f80d7df02a7f31c5cdbe'],
    'one failure': [{ thin, runId: 'r1', failures: 1 }, 'fc4b1dd7521473eb1beb59fea5a196cc61df9236f6d6acfdb1fecdc17cd1c503'],
    'no run id': [{ thin }, '8bd797f6b2798d29bbb44f74fc9e061366f7657a49ccd9300a6adac9a22e0211'],
  };
  for (const [name, [args, hash]] of Object.entries(FIX)) assert.equal(sha(builderSection(args)), hash, name);
  assert.equal(builderSection({}), '', 'an older run');
  const after = builderSection(FIX['no gaps'][0]);
  assert.ok(after.includes(`${verifyFirstItemOne()} Send the blockers back to the person who owns the plan.`));
});

test('the held words are the plan\'s text, word for word (plan A T3.3 entries 2, 3, 4 and STEP3 F4)', () => {
  assert.equal(verifyFirstParagraph(), "Write a section 'Verify first': one line for each claim the plan marks UNVERIFIED that a step rests on, and one for each item to install or download, in the form '<item> - <what to read or check> - <if it fails: the plan's fallback, or stop>'. For a claim no step rests on, write '<claim> - none: no step rests on it'. Take the fallback from the plan; never supply one yourself. If there is nothing to verify, write 'Verify first: nothing - the plan marks no claim UNVERIFIED and names nothing to install.' The dependency lines below are part of this section.");
  assert.equal(verifyFirstStatusRule(), "Write needs_evidence when a line of 'Verify first' has 'stop' as its fallback.");
  assert.equal(verifyFirstItemOne(), "1. Read this whole plan before you change anything. Before you write code, work through the 'Verify first' section of the handoff, and add any blocker you see that it does not name: a step you cannot do with the tools you have, a criterion you cannot check, a fact the plan assumes that nobody verified.");
});
