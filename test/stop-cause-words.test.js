// One word map for every stop cause (0.8.3 exit-22 unit, C&C ruling 15 Oct 2026): STOP_CAUSES gained overseer_cap and layer_bound in round semantics 2b, but three readers kept a three-entry map of the OLD causes
// (user, client_cancel, wall_clock), so a run stopped at an overseer limit read "stopped by undefined" in run_status, in the handoff banner and in the spend report. This test loops over EVERY cause in STOP_CAUSES and
// every reader: no sentence may contain "undefined", and a round stop says it waits for the person's choice. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STOP_CAUSES } from '../src/stop-files.js';
import { stopState } from '../src/handoff-from-run.js';
import { spendReport } from '../src/spend.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const ROUND = new Set(['overseer_cap', 'layer_bound', 'price_refused', 'conflict']);   // the causes that wait for the person (price_refused: A3a commit 2, exit 24; src/stop-files.js waitsForPerson)
const RUN_ID = '2026-10-15T10-00-00-000Z';

function projectWith(cause) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stopwords-'));
  const run = join(dir, 'runs', RUN_ID);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'mock', task: 'tasks/t.md' }));
  writeFileSync(join(run, `STOPPED-${cause}.json`), JSON.stringify({ schema: 'stopped/1', stoppedBy: cause, beforeFirstCall: false, spentUsd: 0, resumeAfterStop: ROUND.has(cause) }));
  writeFileSync(join(run, 'report-partial.json'), '{}');
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('SW-1 handoff stopState: every stop cause reads as a sentence with no "undefined"; a round stop says it waits for the person\'s choice', () => {
  for (const cause of STOP_CAUSES) {
    const p = projectWith(cause);
    try {
      const { reason } = stopState(p.run);
      assert.doesNotMatch(reason, /undefined/, `${cause}: ${reason}`);
      if (ROUND.has(cause)) assert.match(reason, /waiting for the person's choice/, `${cause}: ${reason}`);
    } finally { p.done(); }
  }
});

test('SW-2 spend report: every stop cause gives a run state with no "undefined"; a round stop says it waits for the person\'s choice', () => {
  for (const cause of STOP_CAUSES) {
    const p = projectWith(cause);
    try {
      const row = spendReport(join(p.dir, 'runs'), { days: 3650, now: Date.parse('2026-10-16T00:00:00Z') }).runs.find(r => r.id === RUN_ID);
      assert.ok(row, `${cause}: the folder is a run row`);
      assert.doesNotMatch(String(row.state), /undefined/, `${cause}: ${row.state}`);
      if (ROUND.has(cause)) assert.match(String(row.state), /waiting for the person's choice/, `${cause}: ${row.state}`);
    } finally { p.done(); }
  }
});

function mcpCall(cwd, name, args, timeoutMs = 60_000) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.stdin.end(); child.kill(); done(JSON.parse(m.result.content[0].text)); } } catch { /* not JSON-RPC */ }
      }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stopwords', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}

test('SW-3 MCP run_status: every stop cause gives a state sentence with no "undefined"; a round stop says it waits for the person\'s choice and its status is awaiting_choice', async () => {
  for (const cause of STOP_CAUSES) {
    const p = projectWith(cause);
    try {
      const s = await mcpCall(p.dir, 'run_status', { run: RUN_ID });
      assert.doesNotMatch(String(s.state), /undefined/, `${cause}: ${s.state}`);
      if (ROUND.has(cause)) { assert.match(String(s.state), /waiting for the person's choice/, `${cause}: ${s.state}`); assert.equal(s.status, 'awaiting_choice'); }
    } finally { p.done(); }
  }
});
