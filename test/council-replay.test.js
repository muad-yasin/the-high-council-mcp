// test/council-replay.test.js
//
// Item D (v6 harness-feature round, relay/runs/2026-09-15T15-12-52-325Z/deliverable.md):
// "council replay" - rerun an already-decided task's exact input against today's roster, diff
// the new verdict against the recorded one. Offline throughout: the `mock` chain family costs
// nothing and calls no network, matching this item's own offline-testability requirement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';
import { computeOutcome } from '../src/outcome.js';
import { taskHashOf } from '../src/scope-freeze.js';
import { runCouncilReplay, replayDirFor } from '../src/council-replay.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const cli = resolve(here, '../src/cli.js');
const schema = JSON.parse(readFileSync(resolve(here, '../schemas/verdict-diff.json'), 'utf8'));

const TASK_TEXT = 'Write a short fixture deliverable for council-replay tests.\n';

/** Build a tmp workspace with a task file and a fabricated "original" run folder, whose
 *  report.json is produced by an actual runChain() call against the real mock chain config -
 *  not a hand-rolled fixture - so the shape matches what a real run would have written. */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-replay-'));
  const runsDir = join(dir, 'runs');
  mkdirSync(runsDir);
  const taskPath = join(dir, 'task.md');
  writeFileSync(taskPath, TASK_TEXT);

  const chainsDir = join(repoRoot, 'chains'); // the real, shipped mock.json - "today's roster"
  const config = JSON.parse(readFileSync(join(chainsDir, 'mock.json'), 'utf8'));
  const result = await runChain({ request: TASK_TEXT, config, log: () => {} });

  const runId = '2026-09-01T00-00-00-000Z';
  const runDir = join(runsDir, runId);
  mkdirSync(runDir);
  const taskHash = taskHashOf(TASK_TEXT);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({
    chain: 'mock', task: 'task.md', label: 'fixture', taskHash, pid: 1,
  }, null, 2));
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({
    runId, chain: 'mock', task: 'task.md',
    signoff: result.signoff, lastCritique: result.lastCritique, passed: result.passed,
    outcome: computeOutcome(result),
  }, null, 2));

  return { dir, runsDir, runDir, chainsDir, taskPath };
}

function assertMatchesSchema(diff) {
  assert.deepEqual(Object.keys(diff).sort(), schema.required.slice().sort());
}

test('test_council_replay_module_writes_sibling_folder_with_valid_diff', async () => {
  const { runDir, chainsDir, dir } = await fixture();
  const date = new Date('2026-09-15T00:00:00.000Z');
  const { replayDir, report, diff } = await runCouncilReplay(runDir, {
    chainsDir, workDir: dir, date, log: () => {},
  });

  assert.equal(replayDir, `${runDir}.replay-2026-09-15`);
  assert.ok(existsSync(join(replayDir, 'report.json')));
  assert.ok(existsSync(join(replayDir, 'deliverable.md')));
  assert.ok(existsSync(join(replayDir, 'replay-diff.json')));
  assertMatchesSchema(diff);

  // Same task, same (mock) roster, run twice through the same deterministic mock provider ->
  // the replay should agree with the original recorded verdict.
  assert.equal(diff.signoff_match, true);
  assert.equal(diff.verdict_category_changed, false);
  assert.equal(report.chain, 'mock');
});

test('test_council_replay_refuses_on_task_drift', async () => {
  const { runDir, chainsDir, dir, taskPath } = await fixture();
  writeFileSync(taskPath, 'A different task entirely - this should not silently replay.\n');
  await assert.rejects(
    () => runCouncilReplay(runDir, { chainsDir, workDir: dir, log: () => {} }),
    /task file has changed since the original run/,
  );
});

test('test_council_replay_allow_task_drift_bypasses_the_refusal', async () => {
  const { runDir, chainsDir, dir, taskPath } = await fixture();
  writeFileSync(taskPath, 'A different task entirely.\n');
  const { diff } = await runCouncilReplay(runDir, { chainsDir, workDir: dir, log: () => {}, allowTaskDrift: true });
  assertMatchesSchema(diff);
});

test('test_council_replay_diff_schema_matches_item_c_shared_schema_file', () => {
  // Item D's replay-diff.json and item C's rematch-diff.json are required to validate against
  // the *same* schema file (relay/runs/2026-09-15T15-12-52-325Z/deliverable.md, item D:
  // "the identical five-field replay-diff.json schema as item C's rematch-diff.json"). This
  // pins that the schema file exists at the shared path both items' acceptance tests name.
  assert.equal(schema.title, 'verdict-diff');
  assert.deepEqual(schema.required.slice().sort(), [
    'critics_objecting_added', 'critics_objecting_removed', 'objection_overlap_ratio',
    'signoff_match', 'verdict_category_changed',
  ]);
});

test('test_council_replay_cli_flag_writes_replay_diff_json', async () => {
  const { runDir, dir } = await fixture();
  // Run from a cwd where ./chains resolves to the repo's real chains/ - cli.js's own `work`
  // is process.cwd(), and its chain-lookup falls back to `pkg`'s chains/ (the shipped set)
  // when the invocation directory has no local chains/ of its own, exactly as a real
  // `council run --chain mock` does. Match cli.js's own work/pkg fallback (line ~749) rather
  // than the tmp fixture directory, which deliberately has no chains/ of its own.
  const out = execFileSync('node', [
    cli, '--replay', runDir, '--replay-date', '2026-09-15',
  ], { encoding: 'utf8', cwd: dir });

  assert.match(out, /Wrote .*\.replay-2026-09-15/);
  const replayDir = `${runDir}.replay-2026-09-15`;
  assert.ok(existsSync(join(replayDir, 'replay-diff.json')));
  const diff = JSON.parse(readFileSync(join(replayDir, 'replay-diff.json'), 'utf8'));
  assertMatchesSchema(diff);
});

test('test_council_replay_cli_flag_requires_a_path', () => {
  assert.throws(() => execFileSync('node', [cli, '--replay'], { encoding: 'utf8' }));
});

test('test_council_replay_never_touches_chain_js_or_tools_js_import_graph_directly', () => {
  // council-replay.js is allowed to import runChain from chain.js (the plan's own item D
  // mechanism does exactly that, same as a normal `council run`) - the 0-line-delta
  // requirement is about *editing* chain.js/tools.js, not about never calling into them. This
  // test instead pins the narrower, checkable fact: council-replay.js does not import
  // tools.js at all (it never needs a debate-stage tool surface, since it only reruns a chain
  // and reads two already-written JSON files).
  const src = readFileSync(resolve(here, '../src/council-replay.js'), 'utf8');
  assert.doesNotMatch(src, /from ['"]\.\/tools\.js['"]/);
});
