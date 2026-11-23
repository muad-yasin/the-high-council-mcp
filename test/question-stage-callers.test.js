// 0.8.4 q-warn (widened): the other two readers that held a blocking-question answer to a verdict's shape. submit_stage's validation (src/stage-submission.js) warned stage_validation_failed on a prose answer
// to a `-question` stage; the resume brief (src/resume-brief.js) listed a `-question.md` file as a finished panel or critique stage. Both now use answerShapeKindOf (src/stage-contract.js), which is null for
// a `-question` label. prepare_stage_prompt keeps stageKindOf: the pin below shows its lookup is unchanged, so an external builder paused at a question is still given a bundle. Offline, $0, files only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitStageAnswer } from '../src/stage-submission.js';
import { generateResumeBrief } from '../src/resume-brief.js';
import { stageKindOf } from '../src/stage-contract.js';
import { validateDeliverable } from '../src/partial-deliverable.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainOf = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const PROSE = 'The artifact is the draft plan under review, not the task file.';
// label, chain (the mode), and the kind the old lookup gave the label
const ROWS = [
  { label: 'panel-1-mock-a-question', chain: 'mock-debate', kind: 'panel' },
  { label: 'critique-1-question', chain: 'mock', kind: 'critique' },
];

for (const row of ROWS) {
  test(`submit_stage: a prose answer to ${row.label} gets no stage_validation_failed warning`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-qcall-'));
    try {
      const { warnings, writtenFile } = submitStageAnswer(dir, row.label, PROSE, { chainConfig: chainOf(row.chain) });
      assert.ok(writtenFile.endsWith(`${row.label}.md`), writtenFile);
      assert.deepEqual(warnings.filter(w => w.type === 'stage_validation_failed'), [], JSON.stringify(warnings));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`resume brief: ${row.label}.md alone does not make "${row.kind}" a finished stage`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-qcall-'));
    try {
      writeFileSync(join(dir, `${row.label}.md`), PROSE);
      const runMeta = { chain: row.chain, task: join(dir, 'task.md') };
      writeFileSync(join(dir, 'task.md'), '# A task\n\nDoes a thing.');
      writeFileSync(join(dir, 'run.json'), JSON.stringify(runMeta));
      const brief = generateResumeBrief({ runId: 'q', dir, runMeta, chainConfig: chainOf(row.chain) });
      assert.doesNotMatch(brief, new RegExp(`- ${row.kind}: complete`), brief);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('PIN (green on the old source too): stageKindOf, the lookup prepare_stage_prompt keeps, still maps a -question label to its panel or critique kind', () => {
  assert.deepEqual(ROWS.map(r => stageKindOf(r.label)), ROWS.map(r => r.kind));
});

test('answerShapeKindOf: null for a -question label, stageKindOf for every other label', async () => {
  const { answerShapeKindOf } = await import('../src/stage-contract.js');
  assert.deepEqual(ROWS.map(r => answerShapeKindOf(r.label)), [null, null]);
  for (const l of ['panel-2-mistral', 'panel-1-mock-a-answered', 'critique-1', 'critique-1-answered', 'critique-1-retry', 'build', 'questions', 'propose-glm'])
    assert.equal(answerShapeKindOf(l), stageKindOf(l), l);
});

// NAMED PIN (R551 (b), q-warn2; "a truncated -question answer keeps its partial_output line"): the cli hook runs validateDeliverable with { asProse } for a -question label, so a prose answer that the provider cut off at the cap, or ended with an error, a
// refusal or its content filter, still gets its partial_output line (the end-to-end rows in test/question-stage-no-partial-warning.test.js show a normal one gets none). GREEN on the pre-fix tree (the old check flags all of these too: prose is not JSON). Its fail condition: asProse returns ok before, or instead of, the two stop checks (cut off at the cap; ended by the provider). LIMIT: it calls the function, not the cli hook: no mock model gives a cut-off or provider-ended builder answer to a blocking question, so those two branches reach the hook by reading only; the empty and ends-mid-structure prose branches are driven end to end by test/question-stage-prose-checks.test.js (which also catches a hook that gives a -question stage no kind at all); no fixture is invented.
// blocking question, so the hook's wiring (the option reaching validateDeliverable, and the hook keeping stageKindOf for the printed kind) is read, not driven, and NO row catches the (a)-shaped hook regression (null kind for the whole hook); no fixture is invented.
test('NAMED PIN: with { asProse } a cut-off or provider-ended prose answer is still partial', () => {
  const only = usage => validateDeliverable('panel', PROSE, usage, { asProse: true });
  assert.equal(only({ stop: 'length' }).ok, false);
  assert.match(only({ stop: 'length' }).reason, /cut off at the token cap/);
  assert.equal(only({ stop: 'max_tokens' }).ok, false);
  for (const stop of ['error', 'content_filter', 'refusal']) assert.equal(only({ stop }).ok, false, stop);
});

// q-warn2: the prose checks, by the function the hook calls. With { asProse } a kind that is normally structured (panel) is checked as prose: empty, or ending mid-structure, is partial with the existing reasons; a clean prose answer is fine.
test('asProse: empty text and a text that ends mid-structure are partial with the existing reasons; clean prose is not', () => {
  const as = text => validateDeliverable('panel', text, null, { asProse: true });
  assert.match(as('  \n').reason, /^empty or missing deliverable text$/);
  assert.match(as('Use this:\n```js\nconst x = (').reason, /the text ends mid-structure/);
  assert.deepEqual(as(PROSE), { ok: true });
  assert.equal(validateDeliverable('panel', PROSE, null).ok, false, 'without the option a panel answer is still held to its JSON shape');
});
