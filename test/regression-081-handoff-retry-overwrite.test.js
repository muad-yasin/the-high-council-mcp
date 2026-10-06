// 0.8.1 FX-1 (the 2026-10-02 audit of 0.8.0, finding 1): a second `handoff --from-run` overwrote the first call's cost
// record (handoff-from-run.usage.json), so --spend lost it; and a handoff call that failed after it was sent left no
// charge, because the charge hook was installed only for runs. Each call is now its own file in the run's superseded/
// folder (handoff-from-run.call-<n>.usage.json, the real usage), which every spend reader already adds in. Offline: a
// loopback stub answers as a priced OpenRouter model; no key is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spendReport } from '../src/spend.js';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
let mode = 'ok';
const srv = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>oops</html>'); return; } // maybe billed
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', model: 'meta-llama/llama-3.3-70b-instruct', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '# Handoff\n\n1. Rename photos by date. Acceptance: the test passes.\n' } }], usage: { prompt_tokens: 40_000, completion_tokens: 20_000 } }));
  });
});

function stoppedRun(port) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx1-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool.\n');
  const seat = { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', maxTokens: 30_000, baseUrl: `http://127.0.0.1:${port}/v1`, lab: 'stub' };
  writeFileSync(join(dir, 'chains', 'stubbed.json'), JSON.stringify({ name: 'stubbed', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: seat, critics: [{ provider: 'mock', model: 'mock-critic-passer', lab: 'c' }] } }));
  const id = '2026-10-02T23-00-00-000Z';
  const rd = join(dir, 'runs', id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: 'stubbed', task: 'tasks/t.md', cwd: dir, maxUsd: 5 }));
  writeFileSync(join(rd, 'criteria.md'), '{"criteria": ["It renames by date"]}');
  writeFileSync(join(rd, 'build.md'), '# Plan\n\nRename photos by date.\n');
  return { dir, id, rd };
}
const handoff = (dir, id) => new Promise(done => {
  const c = spawn(process.execPath, [cli, 'handoff', '--from-run', join('runs', id)], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, OPENROUTER_API_KEY: 'test-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } });
  let out = ''; c.stdout.on('data', b => { out += b; }); c.stderr.on('data', b => { out += b; });
  c.on('close', code => done({ code, out }));
});
const callFiles = rd => (existsSync(join(rd, 'superseded')) ? readdirSync(join(rd, 'superseded')).filter(f => /^handoff-from-run\.call-\d+\.usage\.json$/.test(f)).sort() : []);

test('FX-1: two handoff calls leave two cost files with the real usage, and --spend equals their sum', async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    mode = 'ok';
    const { dir, id, rd } = stoppedRun(srv.address().port);
    const a = await handoff(dir, id); assert.equal(a.code, 0, a.out);
    const b = await handoff(dir, id); assert.equal(b.code, 0, b.out);
    assert.ok(existsSync(join(rd, 'HANDOFF.md')) && existsSync(join(rd, 'HANDOFF-from-run.md')));
    const files = callFiles(rd);
    assert.deepEqual(files, ['handoff-from-run.call-1.usage.json', 'handoff-from-run.call-2.usage.json']);
    const calls = files.map(f => JSON.parse(readFileSync(join(rd, 'superseded', f), 'utf8')));
    for (const c of calls) { assert.equal(c.usage.input, 40_000); assert.equal(c.usage.output, 20_000); assert.ok(c.usd > 0); }
    const sum = calls.reduce((s, c) => s + c.usd, 0);
    assert.ok(Math.abs(spendReport(join(dir, 'runs'), { days: 3650 }).totalUsd - sum) < 1e-9, `spend ${spendReport(join(dir, 'runs'), { days: 3650 }).totalUsd} vs ${sum}`);

    // A call that failed after it was sent (200 with a body that is not JSON: maybe billed) leaves a charge file.
    mode = 'html';
    const c = await handoff(dir, id);
    assert.notEqual(c.code, 0, c.out);
    assert.ok(readdirSync(join(rd, 'superseded')).some(f => /^handoff-from-run\.charge-\d+\.usage\.json$/.test(f)), readdirSync(join(rd, 'superseded')).join(', '));
  } finally { srv.close(); }
});
