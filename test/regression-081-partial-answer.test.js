// 0.8.1 FX-13 (AMENDMENTS, found by the 2026-10-02 council run itself): a run resumes as soon as <label>.md exists, and a
// seat that wrote that file in place for minutes exposed partial text to a resume. The NEEDS-<label>.md text and
// prepare_stage_prompt's bundle now tell the seat to write <label>.md.partial and rename it to <label>.md when finished,
// and the harness never reads a .partial file. submit_stage writes the file in one step and is unchanged. Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitingStages } from '../src/run-status.js';
import { renderStagePromptBundle } from '../src/stage-contract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('FX-13: the NEEDS file says to write <label>.md.partial and rename it; a .partial answer does not resume the run and is left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx13-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool.\n');
  assert.equal(run(dir, ['--chain', 'mock-external', '--task', 'tasks/t.md']).status, 3);
  const id = readdirSync(join(dir, 'runs'))[0];
  const rd = join(dir, 'runs', id);
  const label = readdirSync(rd).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  const needs = readFileSync(join(rd, `NEEDS-${label}.md`), 'utf8');
  assert.match(needs, new RegExp(`${label}\\.md\\.partial`));
  assert.match(needs, /rename/i);
  // Half an answer, written the way the NEEDS file now asks.
  writeFileSync(join(rd, `${label}.md.partial`), '# Plan\n\nHalf of a pl');
  assert.deepEqual(waitingStages(rd), [label], 'a .partial file is not an answer');
  const again = run(dir, ['--resume', join('runs', id)]);
  assert.equal(again.status, 3, again.stdout + again.stderr);
  assert.equal(readFileSync(join(rd, `${label}.md.partial`), 'utf8'), '# Plan\n\nHalf of a pl', 'left exactly as it was');
});

test('FX-13: prepare_stage_prompt\'s bundle names the .partial-then-rename route for a seat that writes the file itself', () => {
  const contract = { stage_id: 'build', role: 'Draft it.', no_prior_context: true, deliverable_format: { required_sections: ['x'], approx_length: null }, return_instructions: 'Return text.' };
  const b = renderStagePromptBundle({ contract, taskText: 't', chainName: 'c', label: 'build', run: 'r1', references: [], answerFile: '/runs/r1/build.md' });
  assert.match(b, /\/runs\/r1\/build\.md\.partial/);
  assert.match(b, /rename/i);
  assert.match(b, /submit_stage/, 'the submit_stage route stays');
});
