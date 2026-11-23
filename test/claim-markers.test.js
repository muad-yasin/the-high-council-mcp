// 0.8.4 D15 (plan A T1.1; STEP3 F7 and A9): the claim-marker checker (src/claim-markers.js) reads a plan and reports where the vocabulary CHECKED / UNVERIFIED / DISPUTED / ABSENT is not kept, as information only. The
// writer-rules paragraph and the dispute pass's sentence are held words (test/held-prompts/held-084-a.js) and are injected here as the re-record will export them. Pure, offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fenceFile } from '../src/fence.js';
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { checkClaimMarkers, claimFindingLine, planLines } = await import('../src/claim-markers.js').catch(() => ({}));
import { setHeldForTest } from '../src/held-roles.js';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { builderSystemOf, withDisputedMark } = await import('../src/stage-system.js');
import * as R from '../src/roles.js';
import { builderMarkersRule, builderLimitsRule, disputedMarkSentence } from './held-prompts/held-084-a.js';

afterEach(() => setHeldForTest(null));
const PLAN = readFileSync(new URL('./fixtures/claims.md', import.meta.url), 'utf8');
const taskWith = (path, lines) => `Plan a change.\n\n## ${path}\n\n\`\`\`js\n// ${path}\n${lines.join('\n')}\n\`\`\`\n`;
const SHOWN = taskWith('src/chain.js', ['line one', 'line two', 'line three']);
const check = (plan, over = {}) => checkClaimMarkers({ plan, task: SHOWN, disputePassRan: true, ...over });

test('the fixture: one correct sentence per marker passes; the one sentence that names src/chain.js and has no marker is flagged on its own line', () => {
  const found = check(PLAN);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'claim_unmarked');
  assert.deepEqual([found[0].section, found[0].line], ['3', 9]);
  assert.equal(claimFindingLine(found[0]), "claim_unmarked: section 3, line 9: 'The loop lives in src/chain.js and retries on any error.' names src/chain.js and carries no CHECKED, UNVERIFIED, DISPUTED or ABSENT marker.");
});

test('a CHECKED range that no fenced block of the task shows is a finding: another file, a range past the block, no block at all; shown, or no task to check against, it is not', () => {
  const sentence = (cite) => `# P\n\n## 1. A\n\nThe loop retries three times [CHECKED: ${cite}].\n`;
  assert.deepEqual(check(sentence('src/chain.js lines 2-3')), [], 'lines 2-3 of a 3-line block');
  assert.deepEqual(check(sentence('inferred from src/chain.js lines 1-3')), [], '"inferred from" may open the body');
  for (const [what, cite, task] of [['past the block', 'src/chain.js lines 2-4', SHOWN], ['another file', 'src/other.js lines 1-2', SHOWN], ['no block', 'src/chain.js lines 1-2', 'Plan a change.\n']]) {
    const found = check(sentence(cite), { task });
    assert.equal(found.length, 1, what);
    assert.equal(found[0].id, 'claim_range_unshown', what);
    assert.equal(found[0].message, `section 1, line 5 is marked [CHECKED: ${cite}], and no fenced block of the task contains that range.`, what);
  }
  assert.deepEqual(check(sentence('src/other.js lines 1-2'), { task: null }), [], 'with no task the range check is off');
});

test('against the real producer: the block `council fence` writes for a 3-line file that ends with a newline shows lines 1-3 and not line 4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-claims-'));
  try {
    writeFileSync(join(dir, 'a.js'), 'one\ntwo\nthree\n');
    const task = `Plan a change.\n${fenceFile(dir, 'a.js').text}`;
    const sentence = cite => `# P\n\n## 1. A\n\nThe loop retries [CHECKED: ${cite}].\n`;
    assert.deepEqual(checkClaimMarkers({ plan: sentence('a.js lines 1-3'), task }), []);
    assert.deepEqual(checkClaimMarkers({ plan: sentence('a.js lines 3-3'), task }), []);
    assert.deepEqual(checkClaimMarkers({ plan: sentence('a.js lines 4-4'), task }).map(f => f.id), ['claim_range_unshown']);
    writeFileSync(join(dir, 'b.js'), 'one\ntwo\nthree');   // no final newline: still 3 lines
    const task2 = `Plan a change.\n${fenceFile(dir, 'b.js').text}`;
    assert.deepEqual(checkClaimMarkers({ plan: sentence('b.js lines 1-3'), task: task2 }), []);
    assert.deepEqual(checkClaimMarkers({ plan: sentence('b.js lines 4-4'), task: task2 }).map(f => f.id), ['claim_range_unshown']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a DISPUTED marker before any dispute pass has run is a finding, and the draft is unchanged; after the pass it is not', () => {
  const before = PLAN;
  const early = check(PLAN, { disputePassRan: false });
  assert.deepEqual(early.map(f => [f.id, f.line]), [['claim_disputed_early', 7], ['claim_unmarked', 9]]);
  assert.equal(early[0].message, 'section 3, line 7 is marked DISPUTED, but no dispute pass has run; only the last revision writes that marker.');
  assert.equal(PLAN, before);
  assert.deepEqual(check(PLAN, { disputePassRan: true }).map(f => f.id), ['claim_unmarked']);
  assert.deepEqual(check(PLAN, { disputePassRan: false }), early, 'deterministic');
});

test('STEP3 F7: [CHECKED: excerpt E-<n>] is a finding unless the run recorded that excerpt', () => {
  const plan = '# P\n\n## 2. B\n\nThe module retries [CHECKED: excerpt E-2].\n';
  assert.deepEqual(check(plan, { excerptIds: ['E-1', 'E-2'] }), []);
  const found = check(plan, { excerptIds: ['E-1'] });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'claim_range_unshown');
  assert.equal(found[0].message, 'section 2, line 5 is marked [CHECKED: excerpt E-2], and the run never recorded that excerpt.');
  assert.equal(check(plan).length, 1, 'with no excerpt recorded at all, any citation is unrecorded');
});

test('the reading rules: a marker after the full stop belongs to its sentence; headings, fenced code and tables are skipped; list items and several sentences on a line are read one by one; sections are numbered from the headings', () => {
  const plan = [
    '# Plan', '',
    '## 4. Steps', '',
    '- Edit `foo()` in the loop. [UNVERIFIED: read it first]',
    '1. The cache is in src/cache.js. [CHECKED: src/chain.js lines 1-2]',
    '| a | b |', '|---|---|', '',
    '```js', 'const x = "src/never.js does not exist";', '```', '',
    '### 4.2 Detail', '',
    'See version 4 of the table. The file src/a.js exists. It is fine [ABSENT: not in the blocks].',
    '', '### Unnumbered', '', 'The tool is in v1.2.3.',
  ].join('\n');
  const found = check(plan);
  assert.deepEqual(found.map(f => [f.id, f.section, f.line]), [['claim_unmarked', '4.2', 16], ['claim_unmarked', '4.2', 16], ['claim_unmarked', '4', 20]]);
  assert.match(found[0].message, /'See version 4 of the table\.' names version 4 and/);
  assert.match(found[1].message, /'The file src\/a\.js exists\.' names src\/a\.js and/);
  assert.match(found[2].message, /'The tool is in v1\.2\.3\.' names v1\.2\.3 and/);
});

test('planLines is the one definition of "section <n>, line <m>": the heading\'s own number else its ordinal, text before any heading is section 0, lines counted in the whole plan, fenced code and headings told apart', () => {
  const rows = planLines(['intro', '# Plan', '## 3. Design', 'text', '```', '## not a heading', '```', '### Unnumbered', 'more'].join('\n'));
  assert.deepEqual(rows.map(r => [r.line, r.section, r.kind]), [[1, '0', 'text'], [2, '1', 'heading'], [3, '3', 'heading'], [4, '3', 'text'], [5, '3', 'fence'], [6, '3', 'fence'], [7, '3', 'fence'], [8, '3', 'heading'], [9, '3', 'text']]);
  assert.deepEqual(planLines(undefined).map(r => [r.line, r.kind]), [[1, 'text']], 'no plan reads as one empty line');
});

test('junk in, nothing out: no plan, an empty plan and a non-string plan give no finding and never throw', () => {
  for (const plan of [undefined, null, '', '   \n\n', 42]) assert.deepEqual(checkClaimMarkers({ plan }), []);
  assert.deepEqual(checkClaimMarkers(), []);
});

test('the held words are the plan\'s text, word for word (plan A l.84 with STEP3 F7\'s addition, and l.85)', () => {
  assert.equal(builderMarkersRule(), "End every statement about the project with one marker. [CHECKED: <the fenced block, tool result or excerpt it rests on (for an excerpt, its id: excerpt E-<n>)>] when it rests on text you were shown; add 'inferred from' when you drew it from that text rather than read it there. [UNVERIFIED: <the one reading that would settle it>] when nobody here could check it. [ABSENT: <where you looked>] when you say something is not in what you were shown; never say it is not in the repository. Do not write DISPUTED; the last revision writes it.");
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'Mark each claim an open objection disputes and you keep as [DISPUTED: <objection id>].' NEW: 'Where an open objection disputes a claim and you keep the claim, mark it [DISPUTED: <objection id>].' WHY: disputedMarkSentence, the resolved text of the row (src/prompts/recorded-084-a.js, RESOLVED_LIST).
  assert.equal(disputedMarkSentence(), 'Where an open objection disputes a claim and you keep the claim, mark it [DISPUTED: <objection id>].');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row also asserted the held state ('nothing recorded: what it was') and 'with only one recorded, only that one', through setHeldForTest maps. NEW: those two halves are REMOVED (no 0.8.4 name is unrecorded any more; the recorded-state half of this same row stays, without a map). WHY: builderMarkersRule and builderLimitsRule are recorded (src/prompts/recorded-084-a.js).
test('the writer rules: the markers item comes first and the limits item second, each once, right after the base rules', () => {
  assert.equal(builderSystemOf(false, {}), `${R.BUILDER_SYSTEM}\n- ${builderMarkersRule()}\n- ${builderLimitsRule()}${R.builderSystem(false, {}).slice(R.BUILDER_SYSTEM.length)}`);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row first asserted 'nothing recorded: what it was' and injected the sentence with setHeldForTest. NEW: that held-state half and the map are REMOVED; the recorded-state half of this same row stays. WHY: disputedMarkSentence is recorded (src/prompts/recorded-084-a.js).
test('the dispute pass: the sentence goes right after "Never delete a disputed claim silently.", and a prompt without the anchor is a loud failure', () => {
  const out = withDisputedMark(R.DISPUTE_SYSTEM);
  assert.equal(out, R.DISPUTE_SYSTEM.replace('Never delete a disputed claim silently.', () => `Never delete a disputed claim silently. ${disputedMarkSentence()}`));
  assert.equal(out.split(disputedMarkSentence()).length, 2);
  assert.throws(() => withDisputedMark('a prompt with no anchor'), /must carry .* once \(found 0\)/);
  assert.throws(() => withDisputedMark('Never delete a disputed claim silently. Never delete a disputed claim silently.'), /once \(found 2\)/);
});
