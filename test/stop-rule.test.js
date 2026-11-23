// The stop rule (0.8.1 plan M6, decided rule 6, DR-10, persistence P8, P9, P17, P20): exit 18 meant "stopped before finishing" by a person, a client or a wall clock (an advice call's stop).
// 0.8.4 (the add-on removal, wave 2): nothing in THC ends at exit 18 now (the verbs `council stop` and the STOP file, the stop causes user / client_cancel / wall_clock and the advice call that raised them are
// removed), so every test of this file that stopped a mock advice call (the three causes, the golden boards test/fixtures/stop/BOARD-partial-*.md, the readers of a stopped advice run, the STOP file rows, the
// adopted call's `stopped` ledger line) is removed with it. The one regression row that belongs to the planning chains stays: the budget stop keeps its exit code, its files and its board header.
// The refusal of an old advice folder (--resume, resume_run, handoff, contract) is in test/advice-authority.test.js, test/advice-tools.test.js and test/regression-081-handoff-advice-refused.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRunStatus } from '../src/run-status.js';
import { renderPartialBoardMd } from '../src/report-shape.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const has = (dir, f) => existsSync(join(dir, f));

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stop-'));
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# Plan\n\nShould the note list keep ticked items or remove them?\n');
  return dir;
}

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: project() also copied the two mock advice fixture chains into the folder's chains/, and the file held the advice stop tests around this one. NEW: the project folder holds only the task. WHY: the budget stop runs the package's mock-budget chain; nothing here needs an advice chain.
test('the budget stop keeps its exit code, its files and its board header (regression)', () => {
  const dir = project(); const id = '2026-10-03T07-00-00-005Z';
  const r = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', id], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const runDir = join(dir, 'runs', id);
  assert.ok(has(runDir, 'STOPPED-budget.json') && has(runDir, 'STOPPED-budget.md'));
  assert.equal(readJson(join(runDir, 'report-partial.json')).stoppedBy, 'budget');
  // mock-budget writes no board, so the budget header is pinned on the renderer itself: 0.7.7's words, unchanged by M6.
  assert.equal(renderPartialBoardMd({ runId: 'r', result: { board: 'the board' }, stoppedAtStage: 'build' }).split('\n')[0], '> **Partial board.** This run stopped at its spend cap before stage `build` and did not finish. The same record as data: `report-partial.json`.');
  assert.equal(deriveRunStatus(runDir, readJson(join(runDir, 'run.json'))), 'budget_stopped');
  for (const cause of ['user', 'client_cancel', 'wall_clock']) assert.ok(!has(runDir, `STOPPED-${cause}.json`));
});
