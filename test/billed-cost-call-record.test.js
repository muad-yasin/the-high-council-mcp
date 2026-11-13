// Unit 1 fix-up (D12 part 1): the one-call records of the side commands (`<label>.call-<n>.usage.json`: handoff --from-run, contract draft, digest) carry the provider-reported figure, its unverified marker and the generation id too,
// beside THC's own usd, like a stage's usage file. recordCall (src/superseded.js) is where they were dropped; the two cli.js record sites hand them over (billedFieldsOf of the stage).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordCall } from '../src/superseded.js';
import { typeCap } from './helpers/typed-cap.js';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const read = path => JSON.parse(readFileSync(path, 'utf8'));

test('recordCall keeps the provider-reported figure with its marker and the generation id; without them it adds no key; an unreadable pair is left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-callrec-'));
  const withFacts = read(recordCall(dir, 'digest', { provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 0.01, ms: 5, promptHash: 'h', providerReportedCost: 0.4, generationId: 'gen-1' }));
  assert.deepEqual([withFacts.providerReportedCost, withFacts.providerReportedUnverified, withFacts.generationId], [0.4, true, 'gen-1']);
  assert.equal(withFacts.usd, 0.01, 'beside THC\'s own usd');
  const none = read(recordCall(dir, 'digest', { provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 0.01, ms: 5, promptHash: 'h' }));
  assert.deepEqual(Object.keys(none).sort(), ['model', 'ms', 'promptHash', 'provider', 'usage', 'usd'], 'the old key set (sorted)');
  const bad = read(recordCall(dir, 'digest', { provider: 'openrouter', model: 'm', usd: 0.01, providerReportedCost: -1, generationId: 'a b' }));
  assert.ok(!('providerReportedCost' in bad) && !('providerReportedUnverified' in bad) && !('generationId' in bad));
});

// the real CLI: `handoff --from-run` on a stopped run, a loopback stub that answers as a priced OpenRouter model WITH a cost and an id (the fixture of test/regression-081-handoff-retry-overwrite.test.js)
const srv = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'gen-handoff-1', model: 'meta-llama/llama-3.3-70b-instruct', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '# Handoff\n\n1. Rename photos by date. Accepted when a folder of photos comes out named by date.\n' } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0033 } })); }); });
function stoppedRun(port) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-callrec-cli-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool.\n');
  const seat = { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', maxTokens: 30_000, baseUrl: `http://127.0.0.1:${port}/v1`, lab: 'stub' };
  writeFileSync(join(dir, 'chains', 'stubbed.json'), JSON.stringify({ name: 'stubbed', maxRounds: 1, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: seat, critics: [{ provider: 'mock', model: 'mock-critic', lab: 'mock' }], handoff: seat } }));
  const id = '2026-11-04T07-00-00-000Z'; const rd = join(dir, 'runs', id); mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: 'stubbed', task: 'tasks/t.md', cwd: dir, maxUsd: 5 }));
  writeFileSync(join(rd, 'criteria.md'), '{"criteria": ["It renames by date"]}');
  writeFileSync(join(rd, 'build.md'), '# Plan\n\nRename photos by date.\n');
  return { dir, id, rd };
}
const once = (dir, id) => new Promise(done => { const c = spawn(process.execPath, [cli, 'handoff', '--from-run', join('runs', id)], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, OPENROUTER_API_KEY: 'test-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' }, stdio: 'ignore' }); c.on('close', code => done({ code })); });
test('the real CLI: `handoff --from-run` leaves a call record with the provider-reported figure and the generation id beside usd', async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const { dir, id, rd } = stoppedRun(srv.address().port);
    const first = await once(dir, id);
    if (first.code === 21) { const side = join(rd, 'side'); typeCap(join(side, readdirSync(side)[0]), '100'); await once(dir, id); }
    const sd = join(rd, 'superseded');
    const files = existsSync(sd) ? readdirSync(sd).filter(f => /^handoff-from-run\.call-\d+\.usage\.json$/.test(f)) : [];
    assert.equal(files.length, 1, `one call record (${files})`);
    const u = read(join(sd, files[0]));
    assert.deepEqual([u.providerReportedCost, u.providerReportedUnverified, u.generationId], [0.0033, true, 'gen-handoff-1']);
    assert.ok(Number.isFinite(u.usd) && u.usd !== 0.0033, 'beside THC\'s own usd');
  } finally { srv.close(); }
});
