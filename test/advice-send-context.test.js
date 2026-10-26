// 0.8.3 ROADMAP 77, step 3 (plan note Review/Build_0.8.3/m7/Roadmap77_Paid_Repair_Plan_Note_2026-10-20.md section 9; 6d: extract the context factory out of registerAdviceTools so the CLI and the MCP server reach createSendPath through ONE composition): a MOVE, no new behaviour.
// Rows: (C1) the quote time-to-live seam moved with it; (C2) the one STOP writer moved with it: it writes a client STOP for a run that is still going, keeps the first request, and leaves a finished run alone; (C3) source scan over ALL of src/: the context module is the only caller of createSendPath, and src/mcp/advice.js uses it.
// $0, no model. Every tmp folder is made under the OS temp folder and swept by test/helpers/tmp-sweep.js's import in the suite run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStopRequest, writeStopRequest } from '../src/stop-files.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const make = async env => {
  const { createAdviceSendContext } = await import('../src/advice-send-context.js');
  const runsDir = mkdtempSync(join(tmpdir(), 'thc-ctx-'));
  const ctx = createAdviceSendContext({ work: runsDir, runsDir, env, loadChain: () => { throw new Error('not used'); }, spawnRun: async () => ({}), nextRunId: () => 'r', usdLimit: null });
  return { ctx, runsDir };
};

test('C1 the context hands back what the send path needs: the three in-memory maps, the quote time-to-live (the environment shortens it; a non-number keeps the default), the STOP writer and the send path itself', async () => {
  const { ctx } = await make({});
  assert.deepEqual(Object.keys(ctx).sort(), ['maskAt', 'masks', 'ownRuns', 'sendPath', 'stopRun', 'ttlMs']);
  assert.ok(ctx.masks instanceof Map && ctx.maskAt instanceof Map && ctx.ownRuns instanceof Set);
  assert.equal(ctx.ttlMs, 600_000, 'ten minutes by default');
  assert.equal((await make({ COUNCIL_ADVISE_QUOTE_TTL_MS: '1500' })).ctx.ttlMs, 1500, 'the seam shortens it');
  assert.equal((await make({ COUNCIL_ADVISE_QUOTE_TTL_MS: 'abc' })).ctx.ttlMs, 600_000);
  assert.equal(typeof ctx.sendPath.runQuote, 'function'); assert.equal(typeof ctx.sendPath.runSend, 'function');
});

test('C2 the STOP writer: a run still going gets a client STOP; the first request stays (a person\'s own stays too); a run with a report is left alone; a run that does not exist is a quiet no-op', async () => {
  const { ctx, runsDir } = await make({});
  const going = '2026-10-20T12-00-00-000Z'; const done = '2026-10-20T12-01-00-000Z'; const mine = '2026-10-20T12-02-00-000Z';
  for (const id of [going, done, mine]) mkdirSync(join(runsDir, id));
  writeFileSync(join(runsDir, done, 'report.json'), '{}');
  writeStopRequest(join(runsDir, mine), { by: 'user', run: mine });
  ctx.stopRun(going, 'client_cancel (test)'); ctx.stopRun(done, 'x'); ctx.stopRun(mine, 'x'); ctx.stopRun('2026-10-20T12-03-00-000Z', 'x');
  assert.deepEqual(readStopRequest(join(runsDir, going), going), { by: 'client_cancel' });
  assert.equal(readStopRequest(join(runsDir, done), done), null, 'a finished run is not told to stop');
  assert.deepEqual(readStopRequest(join(runsDir, mine), mine), { by: 'user' }, 'the person\'s request stays');
  ctx.stopRun(going, 'a second cancel');
  assert.deepEqual(readStopRequest(join(runsDir, going), going), { by: 'client_cancel' });
});

test('C3 one composition point: src/mcp/advice.js reaches the send path through createAdviceSendContext, and across ALL of src/ the only call of createSendPath is the context module\'s (send-path.js holds the definition)', () => {
  const files = [];
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p); } };
  walk(join(root, 'src'));
  const code = f => readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const callers = files.filter(f => /(?<!function )\bcreateSendPath\(/.test(code(f))).map(f => f.slice(join(root, 'src').length + 1));
  assert.deepEqual(callers, ['advice-send-context.js']);
  assert.match(code(join(root, 'src', 'mcp', 'advice.js')), /createAdviceSendContext\(/);
});
