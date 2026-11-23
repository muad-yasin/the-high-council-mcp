// test/quote-check.test.js
//
// Quote validation (2026-09-20). In the cheap-7 run, seats with no access to the repository
// made confident, concrete claims about it; the debate converged on one and it reached the
// deliverable. Nothing could tell a claim about the code from an invention about the code,
// because both are just prose. With fenced source (src/fence.js) present, that becomes
// checkable.
//
// The rule this file defends hardest: nothing is ever dropped. An unquoted objection may still
// be right, and silently discarding an objection is how a real defect disappears.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fencedSourceOf, hasFencedSource, quoteAppears, looksLikeRepoClaim, markFailures, quoteWarnings } from '../src/quote-check.js';
import { criticSystem, criteriaSystem, reviserSystem } from '../src/roles.js';

const FENCED = 'Review this.\n\n```csharp\n// SaveSystem.cs\nclass SaveSystem { int Version = 3; }\n```';

test('fencedSourceOf reads the fenced blocks and nothing around them', () => {
  const src = fencedSourceOf(FENCED);
  assert.match(src, /class SaveSystem/);
  assert.ok(!src.includes('Review this'), 'prose around the fence is not source');
  assert.equal(hasFencedSource('no fences here'), false);
});

test('a quote that is in the source verifies; one that is not is marked unverified', () => {
  const src = fencedSourceOf(FENCED);
  assert.equal(quoteAppears('int Version = 3;', src), true);
  assert.equal(quoteAppears('int Version = 4;', src), false);
  assert.equal(quoteAppears('', src), false);
});

test('whitespace differences do not fail a correct quote, but case differences do', () => {
  const src = fencedSourceOf(FENCED);
  assert.equal(quoteAppears('class   SaveSystem {\n  int Version = 3; }', src), true,
    're-typed indentation must not fail a real quote, or seats learn quoting is not worth it');
  assert.equal(quoteAppears('class savesystem { int version = 3; }', src), false,
    'identifiers are case-sensitive; this is a real difference in a repo claim');
});

test('an objection that quotes invented text is marked unverified, not dropped', () => {
  const marked = markFailures([
    { criterion: 'Save migration', problem: 'SaveSystem.cs sets Version = 9.', quote: 'int Version = 9;' },
  ], fencedSourceOf(FENCED));
  assert.equal(marked.length, 1, 'nothing is ever removed');
  assert.equal(marked[0].quote_status, 'unverified');
  assert.match(quoteWarnings(marked, 'panel')[0], /does NOT appear/);
});

test('a repo claim with no quote is kept and marked unquoted', () => {
  const marked = markFailures([
    { criterion: 'Save migration', problem: 'SaveSystem.cs has no migration path.' },
  ], fencedSourceOf(FENCED));
  assert.equal(marked[0].quote_status, 'unquoted');
  assert.match(quoteWarnings(marked, 'panel')[0], /without quoting/);
});

test('a correctly quoted repo claim verifies', () => {
  const marked = markFailures([
    { criterion: 'Version', problem: 'SaveSystem.cs pins Version = 3.', quote: 'int Version = 3;' },
  ], fencedSourceOf(FENCED));
  assert.equal(marked[0].quote_status, 'verified');
  assert.deepEqual(quoteWarnings(marked, 'panel'), [], 'a verified quote is not a warning');
});

// 0.8.4 F2 (gap check S8-01): "accept/withdraw" reads as a repo path, so on a run with fenced source a
// REAL quote from the draft was checked against the fenced source only and marked invented. A quote found
// word for word in the draft is never marked invented; one found nowhere still is.
const DRAFT = 'Step 3: the author may accept/withdraw each post before the round ends.\nStep 4: publish.';
const PATHY = { criterion: 'Choice handling', problem: 'Step 3 lists accept/withdraw but never says who decides.', fix: 'Name the decider.' };

// the status, and one flag per warning line saying whether it is the invented-quote sentence
const outcome = marked => ({ status: marked[0].quote_status, warnings: quoteWarnings(marked, 'panel').map(w => /does NOT appear/.test(w)) });

test('a quote that is in the draft is not marked invented, although the objection reads like a repo path', () => {
  assert.equal(looksLikeRepoClaim(PATHY.problem), true, 'precondition: this wording does read as a path');
  const marked = markFailures([{ ...PATHY, quote: 'the author  may accept/withdraw each post' }], fencedSourceOf(FENCED), DRAFT);
  // no mark and no warning line (the log, the record and the reviser prompt all read these); whitespace is matched as in the fenced check
  assert.deepEqual(outcome(marked), { status: undefined, warnings: [] });
});

test('a quote found in neither the draft nor the fenced source is still marked unverified', () => {
  const marked = markFailures([{ ...PATHY, quote: 'words that appear in neither place' }], fencedSourceOf(FENCED), DRAFT);
  assert.deepEqual(outcome(marked), { status: 'unverified', warnings: [true] });
});

test('with a draft given, a quote that is in the fenced source stays verified', () => {
  const real = { criterion: 'Version', problem: 'SaveSystem.cs pins Version = 3.', quote: 'int Version = 3;' };
  assert.deepEqual(outcome(markFailures([real], fencedSourceOf(FENCED), DRAFT)), { status: 'verified', warnings: [] });
});

test('an objection about the plan itself is never asked for a quote', () => {
  const marked = markFailures([
    { criterion: 'Scope', problem: 'The plan does not state its assumptions.' },
  ], fencedSourceOf(FENCED));
  assert.equal(marked[0].quote_status, undefined,
    'dragging ordinary prose into needing a quote is noise that teaches seats to ignore the mark');
});

test('with no fenced source nothing is marked at all - marking would be theatre', () => {
  const marked = markFailures([{ criterion: 'X', problem: 'SaveSystem.cs is wrong.' }], '');
  assert.equal(marked[0].quote_status, undefined);
  assert.deepEqual(quoteWarnings(marked), []);
});

test('looksLikeRepoClaim errs toward missing rather than false-positives', () => {
  assert.equal(looksLikeRepoClaim('SaveSystem.cs is wrong'), true);
  assert.equal(looksLikeRepoClaim('src/tools/x.py never runs'), true);
  assert.equal(looksLikeRepoClaim('loadGame() returns null'), true);
  assert.equal(looksLikeRepoClaim('The plan is too vague and should be shorter.'), false);
  assert.equal(looksLikeRepoClaim('Add a risks section.'), false);
});

// Prompts cannot be tested by running them - the mock provider ignores prompt text by design
// (same reasoning as test/roles.test.js). These pin the rules' presence and their conditionality.
test('the quote rules appear only when the task carries fenced source', () => {
  assert.ok(!criticSystem(false, null).includes('fenced'), 'no fenced source, no rule about it');
  assert.match(criticSystem(false, { fencedSource: true }), /Never write a "quote" that is not in the fenced source/);

  assert.ok(!criteriaSystem(false).includes('UNVERIFIED'));
  assert.match(criteriaSystem(false, true), /UNVERIFIED/);

  assert.ok(!reviserSystem(false).includes('fenced source'));
  assert.match(reviserSystem(false, true), /has not been checked by anyone/);
});

test('the reviser is told what an unquoted objection is worth, and not to resolve a tie it cannot check', () => {
  const p = reviserSystem(false, true);
  assert.match(p, /Do not silently delete the objection, and do not silently\s+adopt it/);
  assert.match(p, /do not pick one/, 'two uncited claims about the repo must not be resolved by preference');
  assert.match(p, /state the check that decides between/);
});

test('the critic is told the fenced slice is partial, so absence is not evidence', () => {
  const p = criticSystem(false, { fencedSource: true });
  assert.match(p, /absence is not evidence/);
  assert.match(p, /An invented quote is worse than an\s+unsupported objection/);
});
