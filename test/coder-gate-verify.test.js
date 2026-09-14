// MLLM Coder v1, IN-3: verify-stage wiring (relay/runs/2026-09-14T16-14-10-757Z/deliverable.md,
// §7 IN-3). Zero changes to src/tools.js or src/chain.js - this proves the EXISTING v7 item 1
// mechanism (config.verify.enabled -> runVerification -> ground_truth, already shipped and
// already tested in test/tool-verification.test.js) is sufficient, unmodified, to satisfy IN-3's
// own acceptance test when wired into a coder-gate-shaped chain config.
//
// Contract this file pins (backend-developer/SKILL.md's contract-first rule):
//   - Input: a chain config whose `verify.tools` names `run_tests` with `{ file: <test file
//     relative to verify.cwd> }`, and whose `verify.cwd` points at a workspace where a candidate
//     diff has ALREADY been applied (by a human/external session, in a disposable branch, never
//     by this test or by THCMCP itself - this file only ever creates fixture files directly, it
//     never applies a diff).
//   - Output: `result.ground_truth[0].result` carries run_tests' real, unedited
//     { ok, exitCode, stdout, stderr }; a failing result reaches every later stage's prompt
//     (already proven generically by test/tool-verification.test.js) and, when a critic that
//     actually reads it judges accordingly, blocks unanimous signoff.
//
// Real finding, disclosed rather than silently worked around: the change-request convention
// (IN-1, a separate work item) describes `test_command` as "one shell command". The existing,
// UNCHANGED `run_tests` tool only ever accepts an optional `{ file }` and always runs
// `node --test [file]` (src/tools.js's own header comment: "no caller-supplied argv beyond one
// optional path already sandboxed above" - deliberate, not an oversight). Given the hard
// constraint of zero changes to src/tools.js, IN-3's wiring can only pass `test_command` through
// as that `file` argument - so in v1, `test_command` in a change-request file must be a bare
// node:test-compatible file path, not an arbitrary shell command. This is narrower than IN-1's
// own field description and is worth IN-1/IN-2's authors knowing about before the template
// document promises something the verify stage can't actually run.
//
// Second real finding, also test-environment-only and also disclosed rather than worked around
// in src/tools.js: `run_tests` spawns a CHILD `node --test <file>` process, inheriting the
// parent's full environment by default (src/tools.js's spawnSync call sets no `env` override).
// When the parent process running THIS test is itself `node --test` (exactly how `npm test`
// runs the whole suite), Node sets `NODE_TEST_CONTEXT=child-v8` on itself, the child inherits
// it, and Node's own test runner silently treats the child as an already-managed subtest and
// skips running the file entirely - empty stdout, exit 0, a false "ok: true". This is why
// test/tool-verification.test.js's own "real, unstubbed" coverage never actually exercises
// run_tests unstubbed (only read_file/grep_repo/check_versions) - it's a pre-existing gap this
// item's acceptance test would have silently inherited. Worked around here, in this test file
// only, by deleting NODE_TEST_CONTEXT from this process's own env for the duration of the
// runChain() call that will spawn run_tests - restored immediately after, and scoped to this
// file so no other test's process env is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain } from '../src/chain.js';

function withoutNodeTestContext(fn) {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  return Promise.resolve(fn()).finally(() => {
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
  });
}

const seat = (model, lab) => ({ provider: 'mock', model, lab });

// A disposable fixture repo, standing in for "the candidate diff has already been applied
// externally, in a disposable branch" - this function never applies a diff itself, it just
// writes the POST-apply state directly, which is all the verify stage ever sees or cares about.
function fixtureRepo(testFileBody) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-coder-gate-fixture-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'coder-gate-fixture', version: '0.0.0' }));
  writeFileSync(join(dir, 'change.test.js'), testFileBody);
  return dir;
}

const FAILING_TEST = `
import test from 'node:test';
import assert from 'node:assert/strict';
test('the change works', () => { assert.equal(1, 2, 'the applied diff broke this'); });
`;

const PASSING_TEST = `
import test from 'node:test';
import assert from 'node:assert/strict';
test('the change works', () => { assert.equal(1, 1); });
`;

// The coder-gate-v1 chain config's verify-stage shape, per IN-3 - reusing config.verify
// exactly as v7 item 1 defined it (src/chain.js's runVerification/renderGroundTruth), no new
// key, no new stage type. `mock-critic-verify-aware` (src/providers.js) is the one mock critic
// that actually reads the ground-truth block rather than ignoring prompt content, so this test
// can prove the wiring - not just that ground_truth is populated, which
// test/tool-verification.test.js already covers generically.
const coderGateVerifyConfig = (cwd, testFile) => ({
  name: 'test-coder-gate-verify',
  maxRounds: 1,
  stopOnPass: true,
  signoff: 'unanimous',
  verify: { enabled: true, tools: [{ tool: 'run_tests', args: { file: testFile } }], cwd },
  seats: {
    criteria: seat('mock-criteria'),
    builder: seat('mock-builder'),
    reviser: seat('mock-builder'),
    critics: [seat('mock-critic-verify-aware', 'verify-a'), seat('mock-critic-verify-aware', 'verify-b')],
  },
});

test('IN-3 acceptance test: a real failing test already applied to a disposable fixture repo reaches ground_truth and blocks unanimous signoff', async () => {
  const dir = fixtureRepo(FAILING_TEST);
  try {
    const result = await withoutNodeTestContext(() => runChain({
      request: 'Verify the applied diff against its named test.',
      config: coderGateVerifyConfig(dir, 'change.test.js'),
      log: () => {},
    }));

    assert.ok(Array.isArray(result.ground_truth) && result.ground_truth.length === 1);
    const gt = result.ground_truth[0].result;
    assert.equal(gt.ok, false, 'run_tests must report the real failure, not a stubbed one');
    assert.notEqual(gt.exitCode, 0);
    assert.match(gt.stdout + gt.stderr, /the applied diff broke this|not ok/i);

    assert.equal(result.passed, false, 'a run whose ground_truth shows a failing test must not reach unanimous signoff');
    assert.ok(result.signoff.every(s => s.signedOff === false), 'every critic that read the failing ground_truth must have failed it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real passing test already applied to a disposable fixture repo reaches ground_truth and signoff succeeds', async () => {
  const dir = fixtureRepo(PASSING_TEST);
  try {
    const result = await withoutNodeTestContext(() => runChain({
      request: 'Verify the applied diff against its named test.',
      config: coderGateVerifyConfig(dir, 'change.test.js'),
      log: () => {},
    }));

    const gt = result.ground_truth[0].result;
    assert.equal(gt.ok, true);
    assert.equal(gt.exitCode, 0);
    assert.equal(result.passed, true, 'a run whose ground_truth shows a passing test should reach unanimous signoff');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zero changes to src/tools.js: run_tests is called with exactly the shape it already exposes, no new argument', async () => {
  // Static guarantee, same technique test/stage-isolation.test.js and test/tool-verification.test.js
  // already use: the verify-stage wiring is 100% chain-config data (verify.tools[].args), never a
  // src/tools.js code change. Proven here by re-running the failing-test case with the REAL,
  // unstubbed runTool (no config.verify.runTool override anywhere in this file) and getting a
  // real, correctly-shaped result back - if run_tests' signature had to change to accept
  // `test_command` directly, this test would need a stub or a new argument shape to pass, and it
  // has neither.
  const dir = fixtureRepo(FAILING_TEST);
  try {
    const result = await withoutNodeTestContext(() => runChain({
      request: 'x',
      config: coderGateVerifyConfig(dir, 'change.test.js'),
      log: () => {},
    }));
    assert.deepEqual(Object.keys(result.ground_truth[0].result).sort(), ['args', 'exitCode', 'ok', 'stderr', 'stdout', 'tool'].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
