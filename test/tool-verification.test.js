// v7 item 1: tool-grounded verification (see relay/runs/2026-09-14T00-20-44-997Z/deliverable.md
// §1 and relay/tasks/thcmcp-v7-priorities.md "Constraints - binding"). Gated on
// `config.verify: { enabled: true, tools: [...] }`; absent key must leave v6 behaviour byte-
// for-byte unchanged - no `ground_truth` key on the run result, no tool invoked. Offline only:
// the mock provider ignores prompt text and returns a fixed reply keyed off model name, so a
// full mock.json run is deterministic and needs no network call or key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, renderGroundTruth, runVerification } from '../src/chain.js';
import { runTool, ALLOWED_TOOLS } from '../src/tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));

// Frozen v6 fixture: the exact key set + deliverable/criteria/passed shape a
// mock.json run produced before this change. Captured from a real run of the
// unmodified v6 mock provider pipeline (deterministic - mock ignores prompt
// text). If this ever needs to change, it means v6's serialized shape
// changed, which the deliverable's own backward-compat clause says must not
// happen silently.
// 'challenge' was added after this fixture was frozen, by v7 item 5 (the bounded post-signoff
// challenge stage) - it is present as `null` on every result once that item is merged, same as
// this file's own `ground_truth` gate, and is unrelated to the verify.enabled behavior this test
// checks. Included here so this test keeps checking item 1's own gate instead of drifting into
// asserting other items' absence. 'allocator' (v7.3, the resource allocator) was added the same
// way, present as `null` when config.allocator is absent or disabled.
const FROZEN_V6_KEYS = [
  'deliverable', 'criteria', 'questions', 'skeleton', 'proposals', 'proposalPool',
  'dropouts', 'board', 'debate', 'handoff', 'scoreboard', 'passed', 'lastCritique',
  'signoff', 'disputes', 'history', 'stages', 'totals', 'orphanSections', 'withdrawalCycles',
  'challenge', 'allocator',
].sort();

test('verify absent: result has no ground_truth key and matches the frozen v6 key set', async () => {
  const result = await runChain({
    request: 'A plain request with no verify config.',
    config: mockConfig, // no `verify` key at all
    log: () => {},
  });
  assert.equal('ground_truth' in result, false, 'ground_truth must not appear when verify is absent');
  assert.deepEqual(Object.keys(result).sort(), FROZEN_V6_KEYS);
});

test('verify absent: deliverable text is exactly the v6 mock fixture (no ground-truth block leaked into the request)', async () => {
  const result = await runChain({
    request: 'A plain request with no verify config.',
    config: mockConfig,
    log: () => {},
  });
  // mock.json's builder/critics ignore the request text entirely, so this
  // pins that the whole pipeline ran unmodified - a ground-truth block would
  // only ever show up here if it leaked into a stage that echoes the request,
  // which none of these mock replies do; this fixture is the belt to the
  // structural key-set assertion's suspenders.
  assert.match(result.deliverable, /^MOCK DELIVERABLE for model mock-finalist/);
});

test('verify enabled: a stub tool\'s raw output appears verbatim under ground_truth in the run record, and in the next seat\'s context', async () => {
  const stubResult = { ok: true, stdout: 'STUB_TOOL_FIXED_OUTPUT_42', exitCode: 0, stderr: '' };
  let calledWith = null;
  const stubRunTool = (tool, args, opts) => {
    calledWith = { tool, args, opts };
    return { tool, args, ...stubResult };
  };

  const config = {
    ...mockConfig,
    verify: {
      enabled: true,
      tools: [{ tool: 'run_tests', args: { file: 'test/fixture.test.js' } }],
      runTool: stubRunTool,
    },
  };

  const result = await runChain({
    request: 'A request that will be grounded.',
    config,
    log: () => {},
  });

  // 1. In the run record, verbatim.
  assert.ok(Array.isArray(result.ground_truth) && result.ground_truth.length === 1);
  assert.deepEqual(result.ground_truth[0].result, { tool: 'run_tests', args: { file: 'test/fixture.test.js' }, ...stubResult });
  assert.equal(result.ground_truth[0].tool, 'run_tests');

  // 2. The stub was actually invoked through the injectable runTool, not the real sandboxed one.
  assert.equal(calledWith.tool, 'run_tests');
  assert.deepEqual(calledWith.args, { file: 'test/fixture.test.js' });

  // 3. Re-presented unedited to later seats' context: every later stage's user prompt is built
  //    from `request`, which the verification step appends to before any other stage runs -
  //    so the rendered block (containing the exact stub text) is present in `request` by the
  //    time the criteria/skeleton/builder/critic stages read it. Assert the render helper
  //    reproduces the same run's ground_truth verbatim, and that it is exactly what was spliced
  //    into the very first prompt-bearing stage's input (criteria).
  const rendered = renderGroundTruth(result.ground_truth);
  assert.match(rendered, /STUB_TOOL_FIXED_OUTPUT_42/);
  assert.ok(rendered.includes(JSON.stringify(result.ground_truth[0].result)),
    'rendered ground-truth block must contain the exact stub result verbatim');
});

test('verify enabled but tools list empty: ground_truth is an empty array, not absent, and request is unchanged', async () => {
  const result = await runChain({
    request: 'unchanged',
    config: { ...mockConfig, verify: { enabled: true, tools: [] } },
    log: () => {},
  });
  assert.deepEqual(result.ground_truth, []);
});

test('runVerification: rejects a tool name outside the fixed allowlist without invoking anything', () => {
  let invoked = false;
  const stub = () => { invoked = true; return { ok: true }; };
  const out = runVerification(
    { verify: { tools: [{ tool: 'exec_shell', args: { cmd: 'rm -rf /' } }] } },
    { runTool: stub, log: () => {} },
  );
  assert.equal(invoked, false);
  assert.deepEqual(out, []);
});

test('tools.js exposes exactly the four allowlisted tools - no generic executor', () => {
  assert.deepEqual([...ALLOWED_TOOLS].sort(), ['check_versions', 'grep_repo', 'read_file', 'run_tests']);
});

test('runTool: read_file is sandboxed to the workspace root - a path escape is rejected, not resolved', () => {
  const res = runTool('read_file', { path: '../../../../etc/passwd' }, { cwd: root });
  assert.equal(res.ok, false);
  assert.match(res.error, /escapes workspace/);
});

test('runTool: read_file returns real, verbatim file contents for a path inside the sandbox', () => {
  const res = runTool('read_file', { path: 'package.json' }, { cwd: root });
  assert.equal(res.ok, true);
  const onDisk = readFileSync(join(root, 'package.json'), 'utf8');
  assert.equal(res.text, onDisk);
});

test('runTool: check_versions reads the sandboxed package.json, no network', () => {
  const res = runTool('check_versions', {}, { cwd: root });
  assert.equal(res.ok, true);
  assert.equal(res.name, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name);
});

test('runTool: grep_repo finds a known literal string within the sandbox', () => {
  const res = runTool('grep_repo', { pattern: 'ALLOWED_TOOLS', file: 'src/tools.js' }, { cwd: root });
  assert.equal(res.ok, true);
  assert.ok(res.matches.length > 0);
});

test('runTool: an unlisted tool name is rejected before any implementation runs', () => {
  const res = runTool('exec_shell', { cmd: 'ls' }, { cwd: root });
  assert.equal(res.ok, false);
  assert.match(res.error, /not allowed/);
});
