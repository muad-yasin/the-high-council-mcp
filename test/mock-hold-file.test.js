// COUNCIL_MOCK_HOLD_FILE (13 Oct 2026, the load-dependent tests; src/providers.js holdMockCall): a `mock` call waits, after any COUNCIL_MOCK_DELAY_MS, until the file named by
// the variable exists, so a test that must stop or inspect a call while it is in flight holds it there and releases it by creating the file (an order, not a window a slow
// machine can miss). Two claims: the hold is live for a mock call, and it is INERT for a real provider (an ollama-shaped loopback stub that answers at once: $0, no key,
// the real OPENAI_COMPAT adapter). The 60 s hang-guard line is not exercised by a test (it would cost 60 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '../src/providers.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// The same helper as test/stop-rule.test.js: a condition, with 20 s as a hang guard that only a broken run reaches.
async function until(pred, ms = 20_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(50); } return false; }
const mockArgs = { model: 'mock-skeleton', system: 's', messages: [{ role: 'user', content: 'x' }] };
const withHoldFile = async (path, fn) => {
  const saved = process.env.COUNCIL_MOCK_HOLD_FILE;
  process.env.COUNCIL_MOCK_HOLD_FILE = path;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.COUNCIL_MOCK_HOLD_FILE; else process.env.COUNCIL_MOCK_HOLD_FILE = saved; }
};

test('COUNCIL_MOCK_HOLD_FILE: a mock call stays in flight while the file does not exist, and answers once it does', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'thc-hold-')), 'release');
  await withHoldFile(file, async () => {
    let answered = null;
    const p = call('mock', mockArgs).then(r => { answered = r; return r; });
    await sleep(400); // a held call stays held however slow the machine is; an unheld one has answered long before this
    assert.equal(answered, null, 'the call is held: the file does not exist yet');
    writeFileSync(file, '');
    assert.ok(await until(() => answered !== null), 'the call answered after the file was created (20 s hang guard)');
    assert.ok((await p).text?.length > 0, 'and the answer is the ordinary mock answer');
  });
});

test('COUNCIL_MOCK_HOLD_FILE is inert for a real provider: an ollama-shaped stub is answered at once with the variable set to a file that never exists', async () => {
  let asked = 0;
  const srv = http.createServer((req, res) => { asked++; req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const never = join(mkdtempSync(join(tmpdir(), 'thc-hold-')), 'never-created');
  try {
    await withHoldFile(never, async () => {
      let answered = null;
      call('ollama', { ...mockArgs, model: 'llama3.3', maxTokens: 10, baseUrl: `http://127.0.0.1:${srv.address().port}/v1` }).then(r => { answered = r; }, e => { answered = { error: String(e) }; });
      assert.ok(await until(() => answered !== null), 'the real-provider call answered without the file (a hold would keep it waiting up to 60 s)');
      assert.equal(asked, 1, 'the stub was asked once');
      assert.equal(answered.error, undefined, `no error: ${answered.error}`);
    });
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
