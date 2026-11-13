// What stays of the advice add-on's wording tests: the schema limit of run_status's wait (DR-6) and that the two advice tools are not listed.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD: the file also pinned the answer the agent reads (adviceResult, both report shapes), the send preview's words and the README's retention-table date. NEW: those tests are gone. WHY: adviceResult (src/mcp/advice.js), the send preview (src/send-path.js previewText) and src/advice-retention.json were removed with the add-on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

function session(cwd, env = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys(), ...env } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wording', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return { rpc: async (m, p) => { await ready; return rpc(m, p); }, close: () => { child.stdin.end(); child.kill(); } };
}

// CHANGED ACCEPTED TEST (0.8.4 leftovers, his 03 Nov 2026 22:57 "Fixed 90 s"): OLD: wait_seconds above 30 refused, 30 accepted. NEW: above 90 refused, 90 accepted, and the tool text says use 90. WHY: the status hold is a fixed 90 s.
test('DR-6: wait_seconds above 90 is refused by the schema of run_status; 90 is accepted; the two removed advice tools are not listed', async () => {
  const s = session(mkdtempSync(join(tmpdir(), 'thc-wording-hold-')));
  try {
    const list = (await s.rpc('tools/list', {})).result.tools;
    const tools = Object.fromEntries(list.map(t => [t.name, t]));
    assert.deepEqual(list.map(t => t.name).filter(n => n === 'council_quote' || n === 'council_advise'), [], 'the advice tools left in 0.8.4');
    assert.equal(tools.run_status.inputSchema.properties.wait_seconds.maximum, 90);
    assert.match(tools.run_status.description, /wait_seconds \(1-90; use 90\)/);
    const st = await s.rpc('tools/call', { name: 'run_status', arguments: { run: '2026-10-03T00-00-00-000Z', wait_seconds: 91 } });
    const refused = st.error || st.result?.isError;
    assert.ok(refused, `run_status took wait_seconds 91: ${JSON.stringify(st).slice(0, 200)}`);
    assert.match(JSON.stringify(st), /wait_seconds/);
    const ok = await s.rpc('tools/call', { name: 'run_status', arguments: { run: '2026-10-03T00-00-00-000Z', wait_seconds: 90 } });
    assert.ok(!ok.error && !/wait_seconds/.test(JSON.stringify(ok)), JSON.stringify(ok).slice(0, 200));
  } finally { s.close(); }
});
