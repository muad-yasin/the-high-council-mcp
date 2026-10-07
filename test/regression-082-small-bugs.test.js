// 0.8.2 item 5 (plan item 5, C&C's go 6 Oct 2026): four small bugs from ChatGPT review 2 (F3, F5, F11, the stage contract). Each test goes through the REAL next prompt, offline and $0:
// an external seat throws ExternalPause carrying the exact system/user text the seat would have been sent, so what a later stage is told can be read, not inferred from a helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain, ExternalPause } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockDebate = () => JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));

/** Runs the mock debate chain with an EXTERNAL builder and returns the pause (the build prompt) and the order the tool runner was called in. */
async function buildPromptOf({ seatRequests }) {
  const calls = [];
  const runTool = (tool, args) => { calls.push(tool); return { tool, args, ok: true, stdout: `TOOL_OUTPUT_${calls.length}`, exitCode: 0, stderr: '' }; };
  const cfg = mockDebate();
  cfg.seats = { ...cfg.seats, builder: { provider: 'external', model: 'session', lab: 'ext' }, proposers: [{ provider: 'mock', model: 'mock-debate-tool-request', lab: 'mock-a' }, { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' }] };
  cfg.verify = { enabled: true, tools: [{ tool: 'check_versions' }], runTool };
  if (seatRequests) cfg.tools = { seat_requests: { enabled: true, cap: 3 } };
  let pause = null;
  try { await runChain({ request: 'Plan a small tool.', config: cfg, log: () => {} }); } catch (e) { if (e instanceof ExternalPause) pause = e; else throw e; }
  return { pause, calls };
}

test('F3: a tool result a debate seat asked for reaches the next prompt (the build stage), not only the ground_truth array', async () => {
  const { pause, calls } = await buildPromptOf({ seatRequests: true });
  assert.ok(pause, 'the external builder paused the run, so its prompt can be read');
  assert.equal(pause.label.startsWith('build'), true, pause.label);
  assert.ok(calls.length >= 2, `the config-time tool ran, then the seat's request ran: ${calls}`);
  assert.ok(pause.user.includes('TOOL_OUTPUT_1'), 'control: the config-time ground truth is in the prompt (it always was)');
  assert.ok(pause.user.includes('TOOL_OUTPUT_2'), 'the debate-time tool output is in the build prompt (it was missing before the fix)');
  assert.ok(!pause.user.includes('exec_shell'), 'a request the allowlist refused never reaches a prompt');
});

test('F3 control: with seat_requests off nothing is added to the build prompt, and the config-time block is the only one', async () => {
  const { pause, calls } = await buildPromptOf({ seatRequests: false });
  assert.equal(calls.length, 1, 'only the config-time tool ran');
  assert.ok(pause.user.includes('TOOL_OUTPUT_1'));
  assert.ok(!/Ground truth from the debate/.test(pause.user), 'no second block without a seat request');
});

// ---- F5: evidence ids are run-wide -------------------------------------------------------------------------------------------------------------------------------------------
import { toolRefExists } from '../src/claims.js';

test('F5: two debate seats that both ask for the same tool get different evidence ids, and each id names its own entry (it used to be check_versions:0 twice)', async () => {
  const cfg = mockDebate();
  const runTool = (tool, args) => ({ tool, args, ok: true, stdout: 'OUT', exitCode: 0, stderr: '' });
  cfg.seats = { ...cfg.seats, proposers: [{ provider: 'mock', model: 'mock-debate-tool-request', lab: 'mock-a' }, { provider: 'mock', model: 'mock-debate-tool-request', lab: 'mock-b' }] };
  cfg.verify = { enabled: true, tools: [{ tool: 'check_versions' }], runTool };
  cfg.tools = { seat_requests: { enabled: true, cap: 3 } };
  const r = await runChain({ request: 'Plan a small tool.', config: cfg, log: () => {} });
  const mine = r.ground_truth.filter(g => g.result_ref);
  assert.equal(mine.length, 2, 'both seats got a result: ' + JSON.stringify(r.ground_truth.map(g => [g.tool, g.result_ref])));
  assert.equal(new Set(mine.map(g => g.result_ref)).size, 2, `ids collide: ${mine.map(g => g.result_ref)}`);
  // The id is the entry's position among the entries of its tool, the rule claims.js already reads: so every id resolves, to that entry.
  for (const g of mine) {
    const same = r.ground_truth.filter(x => x.tool === g.tool);
    assert.equal(g.result_ref, `${g.tool}:${same.indexOf(g)}`);
    assert.equal(toolRefExists(g.result_ref, r.ground_truth), true);
  }
});

test('F5: a bare tool name is accepted as evidence only when exactly one entry carries that tool; an ambiguous one is refused', () => {
  const one = [{ tool: 'check_versions', result: {} }];
  const two = [{ tool: 'check_versions', result: {} }, { tool: 'check_versions', result: {} }, { tool: 'read_file', result: {} }];
  assert.equal(toolRefExists('check_versions', one), true);
  assert.equal(toolRefExists('check_versions', two), false, 'which of the two? the claim must name check_versions:0 or :1');
  assert.equal(toolRefExists('read_file', two), true, 'a tool that ran once is still unambiguous');
  assert.equal(toolRefExists('check_versions:1', two), true);
  assert.equal(toolRefExists('check_versions:2', two), false);
});

// ---- F11: descending + cold read: ALREADY CLOSED by item 3 (premise check, item 5 review) ----------------------------------------------------------------------------------
import { lintChain } from '../src/chain-lint.js';

// The review (F11) found the combination ran the cold read twice and dropped one result. Item 3 (commit b765b78) made the plan sub-run skip it and the final sub-run read the final stack once, pinned by
// test/cold-read.test.js ("a descending chain runs the cold read ONCE"). C&C's item 5 ruling was "lint-reject, no runtime fix", written before that; a lint rule now would refuse a combination that works,
// so none was added. This pin says so: the pair lints clean.
const withDescending = () => ({ ...mockDebate(), descending: { order: ['plan'] }, coldRead: { enabled: true }, seats: { ...mockDebate().seats, coldRead: { provider: 'mock', model: 'mock-cold-read-yes', lab: 'cold' } } });

test('F11 was closed in item 3: a descending chain with the cold read on lints clean (the single read is pinned in test/cold-read.test.js)', () => {
  assert.deepEqual(lintChain(withDescending(), 'x.json').filter(f => /cold/.test(f.kind)), []);
  const noSeat = withDescending(); delete noSeat.seats.coldRead;
  assert.ok(lintChain(noSeat, 'x.json').some(f => f.kind === 'unreachable-stage'), 'control: the lint still sees a cold read with no seat (the pair is not exempt from other rules)');
});

// ---- Stage contract: the reply stage names the key the code reads (`id`), not `proposal` -----------------------------------------------------------------------------------
import { buildStageContract } from '../src/stage-contract.js';
import * as R from '../src/roles.js';

test('stage contract: every key the reply stage tells an external seat to return is a key the real reply prompt asks for (it said "proposal"; the code reads "id")', () => {
  const cfg = mockDebate();
  const text = buildStageContract(cfg, 'reply').return_instructions;
  const inner = text.match(/\{ "replies": \[\{ ([^}]*) \}\] \}/)?.[1];
  assert.ok(inner, `the contract names the reply fields: ${text}`);
  const keys = [...inner.matchAll(/"([a-z_]+)":/g)].map(m => m[1]);
  assert.ok(keys.includes('id') && keys.includes('action'), keys.join());
  const real = R.replySystem();
  for (const k of keys) assert.ok(real.includes(`"${k}"`), `the contract asks for "${k}", the real reply prompt does not`);
  assert.ok(!keys.includes('proposal'));
});
