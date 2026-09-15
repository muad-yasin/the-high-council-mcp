// MLLM Coder v4, items 2+3 (relay/runs/2026-09-15T01-35-10-051Z/deliverable.md).
//
// Item 2: a new `preflight` stage reviewing the task description only, never a diff - so no
// critic ever authors code (the write-tool refusal held since v1 stays refused). Gated on
// config.preflight; absent, zero behaviour change. Correction to the plan's own premise,
// checked directly and documented at src/chain.js's runPreflightStage: the existing
// post-propose debate-aggregation code cannot run "unmodified" against task-description text
// (it's built around anonymising a pool of distinct per-lab proposals, which doesn't exist
// pre-propose) - a small, independent function was built instead, in the same
// Promise.all-over-labs shape.
//
// Item 3: `runVerification` gains a conditional post-build re-invocation (config.verify_post
// === true), writing a separate ground_truth_post / verify-post.json artifact against the
// applied file state - the pre-build ground_truth/report.json shape is untouched either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, runPreflightStage, PreflightBlocked } from '../src/chain.js';

const seat = (model, lab) => ({ provider: 'mock', model, lab: lab || model });

function fixtureRepo(fileBody) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-v4-fixture-'));
  writeFileSync(join(dir, 'target.js'), fileBody);
  return dir;
}

// ---- Item 2: preflight ----

const baseConfig = (extra = {}) => ({
  name: 'test-v4-preflight',
  maxRounds: 1,
  stopOnPass: true,
  signoff: 'unanimous',
  seats: {
    criteria: seat('mock-criteria'),
    builder: seat('mock-builder'),
    reviser: seat('mock-builder'),
    critics: [seat('mock-critic-verify-aware', 'crit-a'), seat('mock-critic-verify-aware', 'crit-b')],
  },
  ...extra,
});

test('preflight absent: zero behaviour change, no preflight-shaped field on the result', async () => {
  const result = await runChain({ request: 'A well-formed task.', config: baseConfig(), log: () => {} });
  assert.equal('preflight' in result, false);
});

test('preflight present, well-formed task: no blocking objection, run proceeds to criteria/propose as before', async () => {
  const config = baseConfig({ preflight: { seats: [seat('mock-preflight-pass', 'p1'), seat('mock-preflight-pass', 'p2')] } });
  const result = await runChain({ request: 'A well-formed, unambiguous task.', config, log: () => {} });
  assert.ok(result.preflight);
  assert.equal(result.preflight.blocked, false);
  assert.equal(result.preflight.verdicts.length, 2);
  assert.ok(result.preflight.verdicts.every(v => v.verdict === 'pass'));
  // The run proceeded past preflight: criteria was generated and a deliverable exists.
  assert.ok(result.criteria.length > 0);
  assert.ok(result.deliverable);
});

test('preflight present, one seat objects: run throws PreflightBlocked before criteria/propose/build ever run', async () => {
  const config = baseConfig({ preflight: { seats: [seat('mock-preflight-object', 'p1'), seat('mock-preflight-pass', 'p2')] } });
  await assert.rejects(
    () => runChain({ request: 'A task with contradictory requirements.', config, log: () => {} }),
    (err) => {
      assert.ok(err instanceof PreflightBlocked);
      assert.equal(err.preflight.blocked, true);
      const objecting = err.preflight.verdicts.filter(v => v.verdict === 'object');
      assert.equal(objecting.length, 1);
      assert.equal(objecting[0].lab, 'p1');
      assert.deepEqual(objecting[0].objections, ['mock: the task description contradicts itself']);
      return true;
    },
  );
});

test('preflight never touches propose: runPreflightStage is called with task text only, no diff/proposal shape anywhere in its prompt', async () => {
  const config = baseConfig({ preflight: { seats: [seat('mock-preflight-pass', 'p1')] } });
  const invoke = async (seatArg, { system, user }) => {
    assert.ok(!/diff|proposal/i.test(user), 'preflight prompt must never mention a diff or proposal');
    return { label: 'preflight-p1', provider: 'mock', model: seatArg.model, lab: 'p1', usage: { input: 1, output: 1 }, usd: 0, text: JSON.stringify({ verdict: 'pass', objections: [] }) };
  };
  const out = await runPreflightStage(config, { request: 'Task text only.', invoke, record: s => s, log: () => {} });
  assert.equal(out.blocked, false);
});

test('preflight seats default to config.seats.critics when config.preflight.seats is absent', async () => {
  const config = baseConfig({ preflight: {} });
  const result = await runChain({ request: 'A well-formed task.', config, log: () => {} });
  // seats.critics are mock-critic-verify-aware, which is not "mock-preflight-object", so it
  // hits the mock's default pass branch for this prompt.
  assert.equal(result.preflight.verdicts.length, 2);
  assert.ok(result.preflight.verdicts.every(v => v.verdict === 'pass'));
});

// ---- Item 3: verify-post ----

const FIXTURE_MARKER = 'const applied = true;';

test('verify_post absent: zero behaviour change, no ground_truth_post field on the result', async () => {
  const dir = fixtureRepo('const applied = false;\n');
  try {
    const config = baseConfig({ verify: { enabled: true, tools: [{ tool: 'read_file', args: { path: 'target.js' }, expect: { contains: FIXTURE_MARKER }, fact: 'diff_applied' }], cwd: dir } });
    const result = await runChain({ request: 'x', config, log: () => {} });
    assert.equal('ground_truth_post' in result, false);
    // Pre-build ground_truth is untouched by this item either way.
    assert.equal(result.ground_truth[0].diff_applied, 'not_applied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify_post true: pre-build and post-build re-invoke independently, reading the file state real at each call time', async () => {
  // A stub runTool standing in for "the operator applied the diff for real, externally, between
  // the build stage's pause and its resume" - the one thing this item's own acceptance test
  // needs to prove (runVerification re-reads live state each call, no stage-order-dependent
  // cache) that a single synchronous mock builder can't otherwise exercise without real
  // filesystem timing.
  let call = 0;
  const runTool = () => {
    call += 1;
    return { ok: true, text: call === 1 ? 'const applied = false;' : FIXTURE_MARKER };
  };
  const dir = fixtureRepo('unused - runTool is stubbed');
  try {
    const config = baseConfig({
      verify: { enabled: true, tools: [{ tool: 'read_file', args: { path: 'target.js' }, expect: { contains: FIXTURE_MARKER }, fact: 'diff_applied' }], cwd: dir, runTool },
      verify_post: true,
    });
    const result = await runChain({ request: 'x', config, log: () => {} });

    assert.equal(call, 2, 'runVerification must be invoked exactly twice: once pre-build, once post-build');
    assert.equal(result.ground_truth[0].diff_applied, 'not_applied', 'pre-build read, taken before the diff was applied');
    assert.ok(Array.isArray(result.ground_truth_post) && result.ground_truth_post.length === 1);
    assert.equal(result.ground_truth_post[0].diff_applied, true, 'post-build read, taken after the diff was applied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify_post true, marker absent post-build: diff_applied is not_applied, never a silent pass', async () => {
  const dir = fixtureRepo('const applied = false;\n');
  try {
    const config = baseConfig({
      verify: { enabled: true, tools: [{ tool: 'read_file', args: { path: 'target.js' }, expect: { contains: FIXTURE_MARKER }, fact: 'diff_applied' }], cwd: dir },
      verify_post: true,
    });
    const result = await runChain({ request: 'x', config, log: () => {} });
    assert.equal(result.ground_truth_post[0].diff_applied, 'not_applied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify_post true, target file missing at post-build time: diff_applied is unknown, not false', async () => {
  const dir = fixtureRepo('const applied = false;\n');
  try {
    const config = baseConfig({
      verify: { enabled: true, tools: [{ tool: 'read_file', args: { path: 'missing.js' }, expect: { contains: FIXTURE_MARKER }, fact: 'diff_applied' }], cwd: dir },
      verify_post: true,
    });
    const result = await runChain({ request: 'x', config, log: () => {} });
    assert.equal(result.ground_truth_post[0].diff_applied, 'unknown');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
