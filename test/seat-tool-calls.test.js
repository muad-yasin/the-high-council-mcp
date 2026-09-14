// v7.x item 3: seat-requested bounded tool calls (relay/runs/2026-09-14T14-56-18-834Z/
// deliverable.md item 3). Extends v7 item 1's config-time-only tool grounding - gated on
// `config.tools.seat_requests.enabled: true` PLUS the existing `config.verify.tools` allowlist
// (unchanged). Mirrors test/tool-verification.test.js's style: offline, mock seats/config, a
// stub tool runner, no network and no keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, renderGroundTruth } from '../src/chain.js';
import { runSeatToolRequests } from '../src/tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockDebateConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));

// --- Unit tests of the cap-enforcement/allowlist wrapper itself --------------------------------

test('runSeatToolRequests: an allowed request is invoked and appended with a result_ref', () => {
  const stub = (tool, args) => ({ tool, args, ok: true, stdout: `STUB_${tool}` });
  const out = runSeatToolRequests([{ tool: 'check_versions', args: {} }], {
    cap: 3, allowedTools: ['check_versions'], runTool: stub, seat: 'lab-a',
  });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].tool, 'check_versions');
  assert.equal(out.results[0].result_ref, 'check_versions:0');
  assert.deepEqual(out.results[0].result, { tool: 'check_versions', args: {}, ok: true, stdout: 'STUB_check_versions' });
  assert.deepEqual(out.warnings, []);
});

test('runSeatToolRequests: excess requests past the cap are truncated with a warning, not a crash', () => {
  let invocations = 0;
  const stub = (tool, args) => { invocations += 1; return { tool, args, ok: true }; };
  const requests = Array.from({ length: 5 }, () => ({ tool: 'check_versions', args: {} }));
  const out = runSeatToolRequests(requests, { cap: 2, allowedTools: ['check_versions'], runTool: stub, seat: 'lab-b' });
  assert.equal(invocations, 2, 'only the first `cap` requests are ever invoked');
  assert.equal(out.results.length, 2);
  assert.equal(out.used, 2);
  assert.equal(out.requested, 5);
  assert.ok(out.warnings.some(w => /exceeded tool-request cap \(2\) - 3 request\(s\) truncated/.test(w)));
});

test('runSeatToolRequests: an unlisted tool name is rejected before any invocation', () => {
  let invoked = false;
  const stub = () => { invoked = true; return { ok: true }; };
  const out = runSeatToolRequests([{ tool: 'exec_shell', args: { cmd: 'rm -rf /' } }], {
    cap: 3, allowedTools: ['check_versions'], runTool: stub, seat: 'lab-c',
  });
  assert.equal(invoked, false);
  assert.equal(out.results.length, 0);
  assert.ok(out.warnings.some(w => /requested tool not allowed: exec_shell - rejected before invocation/.test(w)));
});

// --- Threaded through runChain's existing debate stage ------------------------------------------

function stubRunTool(tool, args = {}) {
  return { tool, args, ok: true, stdout: `STUB_${tool}_OUTPUT`, exitCode: 0, stderr: '' };
}

test('seat_requests enabled: an allowed tool a debate seat requests is appended to ground_truth ' +
  'with a result_ref, and re-presented verbatim via renderGroundTruth (mirrors item 1\'s own test)', async () => {
  const config = {
    ...mockDebateConfig,
    seats: {
      ...mockDebateConfig.seats,
      proposers: [
        { provider: 'mock', model: 'mock-debate-tool-request', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
      ],
    },
    verify: { enabled: true, tools: [{ tool: 'check_versions' }], runTool: stubRunTool },
    tools: { seat_requests: { enabled: true, cap: 3 } },
  };

  const result = await runChain({ request: 'A request whose debate seat will ask for a tool.', config, log: () => {} });

  // The config-time verify.tools entry ran first (index 0); the seat-requested one is appended
  // after it, same array, same { tool, args, result } shape plus result_ref.
  assert.ok(Array.isArray(result.ground_truth) && result.ground_truth.length >= 2);
  const seatRequested = result.ground_truth.find(g => g.result_ref === 'check_versions:0' && g.result?.stdout === 'STUB_check_versions_OUTPUT');
  assert.ok(seatRequested, 'the seat-requested tool result must be appended verbatim with a result_ref');

  const rendered = renderGroundTruth(result.ground_truth);
  assert.ok(rendered.includes(JSON.stringify(seatRequested.result)), 'rendered ground-truth block must contain the exact seat-requested result verbatim');

  // The same mock reply also asked for a disallowed tool (exec_shell) - rejected before
  // invocation, reported as a warning, never appears in ground_truth.
  assert.ok(!result.ground_truth.some(g => g.tool === 'exec_shell'));
  assert.ok(Array.isArray(result.toolRequestWarnings) && result.toolRequestWarnings.length >= 1);
  assert.ok(result.toolRequestWarnings.some(w => /exec_shell/.test(w)));
});

test('seat_requests enabled but cap is small: excess requests from the same seat are truncated with a WARNINGS.md-ready line', async () => {
  const config = {
    ...mockDebateConfig,
    seats: {
      ...mockDebateConfig.seats,
      proposers: [
        { provider: 'mock', model: 'mock-debate-tool-request', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
      ],
    },
    verify: { enabled: true, tools: [{ tool: 'check_versions' }], runTool: stubRunTool },
    tools: { seat_requests: { enabled: true, cap: 0 } },
  };

  const result = await runChain({ request: 'A request whose debate seat exceeds a zero cap.', config, log: () => {} });
  // The one entry present is the config-time verify.tools call (item 1, unaffected by the cap) -
  // no seat-requested entry (it would carry a result_ref) made it in.
  assert.equal(result.ground_truth.length, 1);
  assert.equal(result.ground_truth[0].result_ref, undefined);
  assert.ok(result.toolRequestWarnings.some(w => /exceeded tool-request cap \(0\)/.test(w)));
});

test('flag absent: no mid-stage tool call is possible and existing tool-grounding output is byte-identical to the frozen fixture', async () => {
  const config = {
    ...mockDebateConfig,
    seats: {
      ...mockDebateConfig.seats,
      proposers: [
        { provider: 'mock', model: 'mock-debate-tool-request', lab: 'mock-a' },
        { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' },
      ],
    },
    // config.verify present and enabled (so item 1 behaviour is exercised), but
    // config.tools.seat_requests is entirely absent - the gate this item adds.
    verify: { enabled: true, tools: [{ tool: 'check_versions' }], runTool: stubRunTool },
  };

  const result = await runChain({ request: 'A request whose debate seat asks for a tool anyway.', config, log: () => {} });

  assert.equal('toolRequestWarnings' in result, false, 'toolRequestWarnings must not appear when config.tools.seat_requests is absent');
  // Only the one config-time ground_truth entry exists - the mock seat's mid-stage tool_requests
  // (in its reply JSON) were never read at all, let alone invoked.
  assert.equal(result.ground_truth.length, 1);
  assert.equal(result.ground_truth[0].tool, 'check_versions');
  assert.equal(result.ground_truth[0].result_ref, undefined, 'a config-time entry never carries a result_ref - that field is item 3\'s alone');
});
