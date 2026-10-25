// CR-5B-004 (25 Okt 2026): a PAID chain with a seat that names no model (README: an external seat is written `{ "provider": "external" }`; denied-models allows it) made the typed-limit gate throw a TypeError in buildStartScope AFTER the run folder, the lock
// and run.json existed (run_status then showed a $7 cap nobody typed). The scope now holds null for such a seat. A seat WITH a model hashes exactly as before: a limit screen already waiting at exit 21 is not refused as "scope changed" after an upgrade.
// Offline, $0: a loopback stub for the one paid seat (never reached: the run pauses at the external seat first); the key is a placeholder literal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStartScope } from '../src/start-scope.js';
import { capScopeSha256 } from '../src/gate.js';
import { typeCap } from './helpers/typed-cap.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-18T07-00-00-000Z';
const hex = c => c.repeat(64);
const parts = seats => ({ taskSha256: hex('a'), contextSha256: null, chainSha256: hex('b'), seats, policySha256: null, sensitivityFloor: null, piiMode: 'warn', userPrices: [] });

test('SM-1 (CR-5B-004): the scope of seats that all name a model hashes exactly as it did before (a literal digest computed on the code before the change); a seat with no model is null in the scope and changes the digest', () => {
  const withModels = buildStartScope(parts([{ role: 'critic', provider: 'openrouter', model: 'qwen/qwen3.7-plus' }, { role: 'builder', provider: 'mock', model: 'mock-builder' }]));
  assert.equal(capScopeSha256(withModels), '10dfe1ca8e9f66aa03ce69fa1373e39bce43aaa382a756c3a07a19259a3d1ccf', 'byte-identical to the scope before the change');
  const noModel = buildStartScope(parts([{ role: 'critic', provider: 'openrouter', model: 'qwen/qwen3.7-plus' }, { role: 'builder', provider: 'external', model: null }]));
  assert.deepEqual(noModel.seats[1], { role: 'builder', provider: 'external', model: null });
  assert.notEqual(capScopeSha256(noModel), capScopeSha256(withModels));
  assert.throws(() => buildStartScope(parts([{ role: 'builder', provider: 'external', model: 7 }])), /seats must be/, 'a model that is neither a string nor null is still refused');
});

test('SM-2 (real verbs): a paid chain with an external seat that names no model reaches the typed-limit screen (exit 21), takes the typed limit and goes on to pause at the external seat (exit 3), instead of crashing with a TypeError', async () => {
  const srv = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(500); res.end('{}'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-scope-nomodel-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
    const paid = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1` };
    writeFileSync(join(dir, 'chains', 'nm.json'), JSON.stringify({ ...base, name: 'nm', seats: { ...base.seats, criteria: { provider: 'external' }, critics: [...base.seats.critics, paid] } }));
    const run = args => new Promise(done => {
      let out = '';
      const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'sk-or-v1-placeholder-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } });
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      child.on('exit', code => done({ code, out }));
    });
    const rd = join(dir, 'runs', RUN);
    const first = await run(['--chain', 'nm', '--task', 'tasks/t.md', '--run-id', RUN]);
    assert.equal(first.code, 21, `the typed-limit screen, not a crash: ${first.out.slice(-600)}`);
    assert.doesNotMatch(first.out, /TypeError|start scope: seats must be/);
    typeCap(rd, '5');
    const go = await run(['--resume', rd]);
    assert.equal(go.code, 3, `the run went on to the external seat: ${go.out.slice(-600)}`);
    assert.ok(existsSync(join(rd, 'NEEDS-criteria.md')), 'and paused there, waiting for the external reply');
    assert.equal(JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8')).maxUsd, 5, 'run.json carries the limit that was typed, not a default nobody typed');
    assert.doesNotMatch(readFileSync(join(rd, 'cap-screen-1.md'), 'utf8'), /undefined|null/, 'the limit screen a person read names no missing model');
  } finally { srv.close(); }
});
