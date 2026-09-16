// relay/test/preflight.test.js
//
// v2 plan §6 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md, GLM-5 primary
// design). Real incident: a chain requiring an appended "Scope ledger" section against task
// text demanding a standalone, publication-ready document with no internal process record -
// two labs held out over exactly this on a real run (see docs/board.html). This pins the
// catch, and pins the known miss by name so it can never be quietly "fixed" into a false
// sense of completeness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { preflightCheck, requiredDeliverableSections, checkArtifactReferences } from '../src/preflight.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('requiredDeliverableSections: proposal-mode chains require a Scope ledger, others require nothing', () => {
  assert.deepEqual(requiredDeliverableSections({ proposals: { parts: 3 } }), ['Scope ledger']);
  assert.deepEqual(requiredDeliverableSections({}), []);
});

test('test_preflight_catches_keyword_conflict: names both the required section and the matched phrase, zero API calls needed', () => {
  const chainConfig = { proposals: { parts: 3 } };
  const criteriaText = 'The deliverable must be a standalone, publication-ready document.';
  const warnings = preflightCheck(chainConfig, criteriaText);
  assert.equal(warnings.length > 0, true);
  assert.ok(warnings.some(w => w.section === 'Scope ledger' && w.keyword === 'standalone'));
  assert.ok(warnings.some(w => w.keyword === 'publication-ready'));
  for (const w of warnings) assert.match(w.message, /Scope ledger/);
  // This function is pure text matching - the mere fact it returns synchronously
  // with no network dependency is the "zero API calls" property the test asks to pin.
});

test('test_preflight_known_misses_semantic_conflicts: the same conflict, rephrased without trigger words, passes with no warning', () => {
  const chainConfig = { proposals: { parts: 3 } };
  // Same semantic conflict as above, deliberately avoiding every trigger keyword.
  const criteriaText = 'The deliverable must be readable with no other file open and no extra material appended at the end.';
  const warnings = preflightCheck(chainConfig, criteriaText);
  assert.deepEqual(warnings, [], 'a rephrased conflict with no trigger keyword must pass with no warning - this is a known, accepted limitation, not a bug to silently patch');
});

test('a chain with no required sections never warns, regardless of the text', () => {
  const warnings = preflightCheck({}, 'must be a standalone, publication-ready, self-contained document');
  assert.deepEqual(warnings, []);
});

// v3 §3 (artifact inlining, ~/Projects/relay/tasks/thcmcp-v3-draft-fixed.md). Real incident:
// a task summarising a specific JSON rubric file, rather than inlining it, led every critic
// lab to invent plausible-but-nonexistent identifiers against it. Anchored to chains/mock.json
// (a real, existing fixture) as its acceptance criterion requires, not an ad hoc string.
test('test_artifact_reference_without_inline_warns: a path named but never fenced is flagged', () => {
  const mockDescription = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')).description;
  const taskText = `${mockDescription}\n\nReview rubric.json against these criteria.`;
  const warnings = checkArtifactReferences(taskText);
  assert.ok(warnings.some(w => w.path === 'rubric.json'), 'must name the un-fenced path');
});

test('test_artifact_reference_with_inline_passes: the same path, fenced verbatim, warns nothing', () => {
  const mockDescription = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')).description;
  const taskText = `${mockDescription}\n\nReview rubric.json against these criteria.\n\n\`\`\`\nrubric.json\n\`\`\``;
  const warnings = checkArtifactReferences(taskText);
  assert.deepEqual(warnings.filter(w => w.path === 'rubric.json'), []);
});

// Bug-audit fix, 2026-09-16: checkArtifactReferences used plain substring containment
// (`fenced.includes(path)`), so a fenced block containing only a LONGER filename that happens
// to contain the candidate path as a substring (e.g. "reindex.js" contains "index.js") silently
// suppressed the "not fenced" warning even though the candidate itself was never actually
// referenced in the fenced content.
test('test_artifact_reference_superstring_does_not_suppress_warning: a fenced longer filename must not silently satisfy a shorter candidate path (bug-audit finding)', () => {
  const mockDescription = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')).description;
  const taskText = `${mockDescription}\n\nReview index.js against these criteria.\n\n\`\`\`\nreindex.js\n\`\`\``;
  const warnings = checkArtifactReferences(taskText);
  assert.ok(warnings.some(w => w.path === 'index.js'), 'a fenced "reindex.js" must not be mistaken for the real "index.js" reference');
});

// Security-review fix (Fable 5.1 review of c915eba, item 4): the boundary check's first pass
// wrongly included "/" in its disallowed-boundary set. PATH_PATTERN never matches "/" itself
// (a candidate is always a bare filename), so a fenced mention written as a full path
// ("`src/foo.js`") has its candidate "foo.js" immediately preceded by "/" - which the first-pass
// fix incorrectly treated as "not a real boundary," producing a false "not fenced" warning on
// the single most common way a file is referenced inside a fence.
test('test_artifact_reference_full_path_in_fence_satisfies_bare_filename_candidate: a fenced FULL PATH mention correctly satisfies the bare-filename candidate (bug-audit finding)', () => {
  const mockDescription = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')).description;
  const taskText = `${mockDescription}\n\nFix src/foo.js as described.\n\n\`\`\`\n// src/foo.js\nexport const x = 1;\n\`\`\``;
  const warnings = checkArtifactReferences(taskText);
  assert.deepEqual(warnings.filter(w => w.path === 'foo.js'), [], 'fencing the file under its full path must count as fencing it, not warn as if it were never fenced at all');
});
