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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { preflightCheck, requiredDeliverableSections, checkArtifactReferences, parseUnfencedAllow } from '../src/preflight.js';

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

// 2026-09-20: the artifact check became a gate (exit 2, before any metered call) and gained
// an extension allowlist. The three cases below are the real false positives from the cheap-7
// run of that date, which is why the gate could not ship without the filter.

test('artifact gate: the cheap-7 run\'s three false positives are no longer flagged', () => {
  const text = [
    'The package is com.unity.textmeshpro and the call site is newsHeadlines.Find(...).',
    'See BreakingNewsTriggerController.Start for the ordering.',
  ].join('\n');
  assert.deepEqual(checkArtifactReferences(text), [],
    'a package id and two method references are not files, and a gate that blocks on them teaches operators to bypass it');
});

test('artifact gate: a real unfenced code file is still caught', () => {
  const warnings = checkArtifactReferences('Please review SaveSystem.cs and tell us what breaks.');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].path, 'SaveSystem.cs');
  // The message must name both ways out, or the operator has to go read source to proceed.
  assert.match(warnings[0].message, /--allow-unfenced/);
  assert.match(warnings[0].message, /unfenced-ok/);
});

test('artifact gate: fencing the real content clears it', () => {
  const text = 'Please review SaveSystem.cs.\n\n```\n// SaveSystem.cs\nclass SaveSystem {}\n```';
  assert.deepEqual(checkArtifactReferences(text), []);
});

test('artifact gate: an unlisted extension is a known, accepted miss, not a block', () => {
  // Trades a quiet miss (recoverable) for never producing a loud false block (which
  // teaches bypass-by-reflex). Pinned so the trade stays deliberate.
  assert.deepEqual(checkArtifactReferences('See notes.qqq for the details.'), []);
});

test('parseUnfencedAllow: reads the front-matter escape, and only from real front matter', () => {
  assert.deepEqual(parseUnfencedAllow('---\nunfenced-ok: [Foo.cs, run-tests.sh]\n---\n\nBody.'), ['Foo.cs', 'run-tests.sh']);
  assert.deepEqual(parseUnfencedAllow('---\nunfenced-ok: ["a.js", \'b.js\']\n---\n'), ['a.js', 'b.js']);
  assert.deepEqual(parseUnfencedAllow('No front matter here.\nunfenced-ok: [a.js]\n'), [],
    'a mid-body line is not front matter - otherwise a task could be talked into disarming its own gate by quoting one');
  assert.deepEqual(parseUnfencedAllow('---\nother: thing\n---\n'), []);
  assert.deepEqual(parseUnfencedAllow(''), []);
});

test('artifact gate: front-matter and caller allowlists both suppress, per file, not wholesale', () => {
  const text = '---\nunfenced-ok: [Allowed.cs]\n---\n\nCompare Allowed.cs against Other.cs.';
  const warnings = checkArtifactReferences(text);
  assert.deepEqual(warnings.map(w => w.path), ['Other.cs'],
    'allowing one file must not disarm the gate for the rest of the task');
  assert.deepEqual(checkArtifactReferences(text, { allow: ['Other.cs'] }), []);
});

// The gate end to end. Uses the offline mock chain, so a failure to block would spend
// nothing here - but it would spend on a real chain, which is the whole point.
test('artifact gate: the CLI exits 2, writes NEEDS-ARTIFACTS.md, and starts no run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-artifact-gate-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'mock.json'), readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  writeFileSync(join(dir, 'task.md'), 'Review SaveSystem.cs and report what breaks.');
  let status = 0, stdout = '';
  try {
    stdout = execFileSync('node', [resolve(root, 'src/cli.js'), '--chain', 'mock', '--task', 'task.md'],
      { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status;
    stdout = err.stdout ?? '';
  }
  assert.equal(status, 2, 'blocked runs exit 2, distinct from lint (1) and external pause (3)');
  assert.match(stdout, /BLOCKED/);
  assert.match(stdout, /nothing was spent/i);

  const runDirs = readdirSync(join(dir, 'runs'));
  assert.equal(runDirs.length, 1, 'the run folder is the record even of a refusal');
  const needs = readFileSync(join(dir, 'runs', runDirs[0], 'NEEDS-ARTIFACTS.md'), 'utf8');
  assert.match(needs, /SaveSystem\.cs/);
  assert.match(needs, /council fence/, 'the file must name the fix, not just the problem');
  assert.match(needs, /unfenced-ok/);
  // A seat reply file would mean a stage ran despite the gate.
  assert.ok(!existsSync(join(dir, 'runs', runDirs[0], 'criteria.md')), 'no stage may run before the gate');

  rmSync(dir, { recursive: true, force: true });
});

test('artifact gate: --allow-unfenced proceeds, and the finding is still recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-artifact-allow-'));
  mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'chains', 'mock.json'), readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  writeFileSync(join(dir, 'task.md'), 'Review SaveSystem.cs and report what breaks.');
  execFileSync('node', [resolve(root, 'src/cli.js'), '--chain', 'mock', '--task', 'task.md', '--allow-unfenced'],
    { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  const runDirs = readdirSync(join(dir, 'runs'));
  const warnings = readFileSync(join(dir, 'runs', runDirs[0], 'WARNINGS.md'), 'utf8');
  assert.match(warnings, /SaveSystem\.cs/, 'bypassing the gate must leave the same trace as tripping it');
  assert.ok(!existsSync(join(dir, 'runs', runDirs[0], 'NEEDS-ARTIFACTS.md')));
  rmSync(dir, { recursive: true, force: true });
});

// Bug audit 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #6, repro /tmp/audit9/fence.mjs):
// a file named only INSIDE another file's fenced body is not fenced - its content never reached a lab.
test('artifact gate: a filename that appears only inside another file\'s fence body does not count as fenced', () => {
  const other = '## src/chain-lint.js\n\n```js\n// src/chain-lint.js\nimport { ALLOWED_TOOLS } from \'./tools.js\';\nconst prices = \'pricing.json\';\n```\n';
  const task = `Is the allowlist in tools.js strict enough? Also check pricing.json.\n${other}`;
  assert.deepEqual(checkArtifactReferences(task).map(w => w.path).sort(), ['pricing.json', 'tools.js']);
  // Still counts: a heading above the fence, an info string, a first-line path comment, a lead-in line.
  for (const fence of [
    '## src/tools.js\n\n```js\nexport const x = 1;\n```',
    '```js src/tools.js\nexport const x = 1;\n```',
    '```js\n// src/tools.js\nexport const x = 1;\n```',
    'Here is tools.js:\n```js\nexport const x = 1;\n```',
  ]) {
    assert.deepEqual(checkArtifactReferences(`Check tools.js.\n\n${fence}\n`), [], fence);
  }
});
