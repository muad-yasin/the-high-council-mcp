// The gate ledger (0.8.1 plan DR-4, M3; persistence register P5): one hash-chained line per event,
// tamper-evident in the middle, a torn tail ignored and cut away by the next append, every append under
// the run's ledger lock. Mock-only, $0, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, cpSync, existsSync, utimesSync } from 'node:fs';
import { acquireRunLock, lockHolder } from '../src/run-lock.js';
import { tmpdir, hostname } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { readLedger, verifyLedger, appendEvent, withLedger, LEDGER_FILE, LEDGER_LOCK_FILE, EVENTS, PUBLIC_EVENTS } from '../src/gate-ledger.js';
import { answerGate, readGateAnswer, requestGate, textSha256 } from '../src/gate.js';
import { writeGateFixtures } from '../scripts/gate-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const FIX = join(here, 'fixtures', 'gate');
const cli = join(repo, 'src', 'cli.js');
const sha = s => createHash('sha256').update(s).digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'gate-ledger-'));
const copyRun = name => { const d = join(tmp(), name); cpSync(join(FIX, name), d, { recursive: true }); return d; };
const ledgerBytes = d => readFileSync(join(d, LEDGER_FILE));

function filesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p)); else out.push(p);
  }
  return out.sort();
}

test('the committed fixtures are exactly what the gate code writes (rebuilt from scripts/gate-fixtures.mjs)', () => {
  const root = tmp();
  writeGateFixtures(root);
  const want = filesUnder(FIX).map(p => relative(FIX, p));
  const got = filesUnder(root).map(p => relative(root, p));
  assert.deepEqual(got, want, 'the same files');
  for (const rel of want) assert.ok(readFileSync(join(root, rel)).equals(readFileSync(join(FIX, rel))), `${rel} differs from a fresh build`);
});

test('golden ledger: prev is the sha256 of the line before without its newline; the first prev is null; seq counts from 1', () => {
  const raw = readFileSync(join(FIX, 'run-ok', LEDGER_FILE), 'utf8');
  assert.ok(raw.endsWith('\n'));
  const lines = raw.slice(0, -1).split('\n');
  assert.equal(lines.length, 6);
  lines.forEach((l, i) => {
    const o = JSON.parse(l);
    assert.equal(o.seq, i + 1);
    assert.equal(o.prev, i === 0 ? null : sha(lines[i - 1]), `line ${i + 1}`);
    assert.equal(o.schema, 'gate-ledger/1');
  });
  assert.deepEqual(lines.map(l => JSON.parse(l).event), ['gate_requested', 'gate_answered', 'sent', 'gate_requested', 'gate_answered', 'stopped']);
});

test('the fixtures validate against schemas/gate-ledger-v1.json and schemas/gate-v1.json', () => {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, validateFormats: false });
  const line = ajv.compile(JSON.parse(readFileSync(join(repo, 'schemas', 'gate-ledger-v1.json'), 'utf8')));
  const gate = ajv.compile(JSON.parse(readFileSync(join(repo, 'schemas', 'gate-v1.json'), 'utf8')));
  for (const l of readLedger(join(FIX, 'run-ok')).lines) assert.ok(line(l), JSON.stringify(line.errors));
  for (const g of ['g1', 'g2']) {
    const rec = JSON.parse(readFileSync(join(FIX, 'run-ok', 'gates', `${g}.json`), 'utf8'));
    assert.ok(gate(rec), JSON.stringify(gate.errors));
  }
  // and the schema would catch a non-person channel
  assert.equal(line({ ...readLedger(join(FIX, 'run-ok')).lines[1], channel: 'host' }), false);
});

test('council gate verify: run-ok exits 0, run-tampered exits non-zero and names line 6 (the plan M3 exit check)', () => {
  const ok = spawnSync(process.execPath, [cli, 'gate', 'verify', join(FIX, 'run-ok')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /gate ledger holds \(6 lines\)/);
  const bad = spawnSync(process.execPath, [cli, 'gate', 'verify', join(FIX, 'run-tampered')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /broken at line 6: prev does not match/);
  const none = spawnSync(process.execPath, [cli, 'gate', 'verify', tmp()], { encoding: 'utf8' });
  assert.equal(none.status, 2);
});

test('a flipped middle line: verifyLedger is false, and every later write and every approval fails closed', () => {
  const d = copyRun('run-tampered');
  const v = verifyLedger(d);
  assert.equal(v.ok, false);
  assert.equal(v.failedAt, 6);
  const before = ledgerBytes(d);
  assert.throws(() => appendEvent(d, 'sent', { gate: 'g1' }), err => err.code === 'gate_ledger_corrupt');
  // g2 reads "approved" in its (edited) file and in the flipped line: still never approved
  assert.deepEqual(readGateAnswer(d, 'g2'), { status: 'invalid', reason: 'gate_ledger_corrupt' });
  assert.equal(readGateAnswer(d, 'g1').status, 'invalid', 'an earlier, honest approval is not trusted from a broken ledger either');
  writeFileSync(join(d, 'new.md'), 'x\n');
  const r = requestGate(d, { kind: 'advice', textPath: 'new.md' });
  assert.equal(r.code, 'gate_ledger_corrupt');
  assert.ok(ledgerBytes(d).equals(before), 'nothing appended to a broken ledger');
  assert.equal(existsSync(join(d, 'gates', 'g3.json')), false);
});

test('a complete line that does not parse is a mid-file break, not a torn tail', () => {
  const d = copyRun('run-ok');
  const lines = readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n');
  lines[2] = lines[2].slice(0, 40); // cut inside the line, newline kept
  writeFileSync(join(d, LEDGER_FILE), lines.join('\n'));
  const v = verifyLedger(d);
  assert.equal(v.ok, false);
  assert.equal(v.failedAt, 3);
  assert.equal(v.reason, 'the line is not JSON');
});

test('a deleted middle line breaks the chain', () => {
  const d = copyRun('run-ok');
  const lines = readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n');
  lines.splice(2, 1);
  writeFileSync(join(d, LEDGER_FILE), lines.join('\n'));
  assert.equal(verifyLedger(d).ok, false);
});

test('a torn tail is ignored on read and cut away by the next append, at the byte offset of the last good line', () => {
  const d = copyRun('run-torn');
  const v = readLedger(d);
  assert.equal(v.ok, true);
  assert.equal(v.torn, true);
  assert.equal(v.lines.length, 6);
  const good = readFileSync(join(FIX, 'run-ok', LEDGER_FILE));
  appendEvent(d, 'more_material_requested', { gate: 'g1', ids: ['run#openai'] });
  const after = ledgerBytes(d);
  assert.ok(after.subarray(0, good.length).equals(good), 'the six good lines are untouched');
  const v2 = readLedger(d);
  assert.equal(v2.ok, true);
  assert.equal(v2.torn, false);
  assert.equal(v2.lines.length, 7);
  assert.equal(v2.lines[6].prev, sha(good.subarray(0, good.length - 1).toString('utf8').split('\n').at(-1)));
});

test('a torn tail holding a multibyte character is cut on a byte boundary', () => {
  const d = copyRun('run-ok');
  appendFileSync(join(d, LEDGER_FILE), Buffer.from('{"note":"ü', 'utf8').subarray(0, 10)); // ends inside the ü
  assert.equal(readLedger(d).torn, true);
  appendEvent(d, 'sent', { gate: 'g1', note: 'größe' });
  const v = readLedger(d);
  assert.equal(v.ok, true);
  assert.equal(v.lines.length, 7);
  assert.equal(v.lines[6].note, 'größe');
});

test('a missing ledger reads as an empty, valid one; an unreadable one fails closed', () => {
  const d = tmp();
  assert.deepEqual(readLedger(d), { ok: true, missing: true, lines: [], torn: false });
  const e = tmp();
  // a directory where the file should be: exists, cannot be read as a file
  cpSync(join(FIX, 'run-ok', 'gates'), join(e, LEDGER_FILE), { recursive: true });
  const v = readLedger(e);
  assert.equal(v.ok, false);
});

test('appendEvent writes only the public events; the ledger sets schema, seq, prev, ts and event itself', () => {
  assert.deepEqual([...PUBLIC_EVENTS].sort(), ['more_material_requested', 'sent', 'stopped']);
  assert.deepEqual([...EVENTS].sort(), ['gate_answered', 'gate_requested', 'more_material_requested', 'sent', 'stopped']);
  const d = tmp();
  assert.throws(() => appendEvent(d, 'gate_answered', { gate: 'g1', decision: 'approved' }), /not an event this function writes/);
  assert.throws(() => appendEvent(d, 'gate_requested', { gate: 'g1' }), /not an event this function writes/);
  assert.throws(() => appendEvent(d, 'sent', { seq: 1 }), /set by the ledger/);
  assert.throws(() => appendEvent(d, 'sent', { prev: null }), /set by the ledger/);
  assert.equal(existsSync(join(d, LEDGER_FILE)), false, 'a refused append writes nothing');
  const first = appendEvent(d, 'sent', { gate: 'g1' }, { now: () => Date.parse('2026-10-02T00:00:00Z') });
  assert.equal(first.seq, 1);
  assert.equal(first.prev, null);
  assert.equal(first.ts, '2026-10-02T00:00:00.000Z');
  assert.equal(existsSync(join(d, LEDGER_LOCK_FILE)), false, 'the lock is released');
});

test('a live holder of the ledger lock: the writer waits, then gives up with gate_busy and appends nothing', () => {
  const d = copyRun('run-ok');
  // a lock held by a live process (this one; a different nonce makes it not ours)
  writeFileSync(join(d, LEDGER_LOCK_FILE), JSON.stringify({ pid: process.pid, host: hostname(), at: 'x', nonce: 'other' }));
  const before = ledgerBytes(d);
  const t0 = Date.now();
  assert.throws(() => withLedger(d, ({ append }) => append('sent', {}), { waitMs: 150 }), err => err.code === 'gate_busy');
  assert.ok(Date.now() - t0 >= 140, 'it waited before giving up');
  assert.ok(ledgerBytes(d).equals(before));
});

test('a stale ledger lock (its process is dead) is taken over and the write goes ahead', () => {
  const d = copyRun('run-ok');
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  writeFileSync(join(d, LEDGER_LOCK_FILE), JSON.stringify({ pid: Number(dead.stdout), host: hostname(), at: 'x', nonce: 'gone' }));
  appendEvent(d, 'sent', { gate: 'g1' });
  assert.equal(readLedger(d).lines.length, 7);
  assert.equal(existsSync(join(d, LEDGER_LOCK_FILE)), false);
});

test('two processes appending at once both land, in one unbroken chain', () => {
  const d = copyRun('run-ok');
  const mod = join(repo, 'src', 'gate-ledger.js');
  const barrier = join(d, 'go');
  const script = i => `import { appendEvent } from ${JSON.stringify(mod)}; import { existsSync } from 'node:fs';
    while (!existsSync(${JSON.stringify(barrier)})) {}
    for (let k = 0; k < 20; k++) appendEvent(${JSON.stringify(d)}, 'sent', { gate: 'g1', who: ${i}, k });`;
  const kids = [0, 1].map(i => import('node:child_process').then(({ spawn }) => new Promise(res => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', script(i)], { stdio: 'inherit' });
    c.on('exit', code => res(code));
  })));
  setTimeout(() => writeFileSync(barrier, ''), 300);
  return Promise.all(kids).then(codes => {
    assert.deepEqual(codes, [0, 0]);
    const v = verifyLedger(d);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.lines.length, 6 + 40);
  });
});

test('gate events through withLedger hold: requestGate then answerGate chain onto an existing ledger', () => {
  const d = copyRun('run-ok');
  writeFileSync(join(d, 'third.md'), 'third\n');
  const r = requestGate(d, { kind: 'advice', textPath: 'third.md' });
  assert.equal(r.gate.id, 'g3');
  assert.equal(answerGate(d, 'g3', { channel: 'cli', decision: 'approved', shownSha256: textSha256(Buffer.from('third\n')), tty: true }).ok, true);
  assert.equal(readGateAnswer(d, 'g3').status, 'approved');
  assert.equal(verifyLedger(d).lines.length, 8);
});


// The two race tests above are smoke: with the lock removed they fail only some of the time (the M3 review
// measured 2-3 passes in 9). This one is deterministic: the test holds the lock and proves a second process
// waits for it, then lands its line once it is released.
test('a second writer waits for the ledger lock and appends only after it is released', async () => {
  const d = copyRun('run-ok');
  const before = ledgerBytes(d);
  const release = acquireRunLock(d, { file: LEDGER_LOCK_FILE });
  const trying = join(d, 'trying');
  const mod = join(repo, 'src', 'gate-ledger.js');
  const script = `import { appendEvent } from ${JSON.stringify(mod)}; import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(trying)}, '');
    appendEvent(${JSON.stringify(d)}, 'sent', { gate: 'g1', who: 'child' }, { waitMs: 10_000 });`;
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' });
  const exited = new Promise(res => child.on('exit', res));
  let done = false;
  exited.then(() => { done = true; });
  try {
    while (!existsSync(trying)) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 250));
    assert.equal(done, false, 'the child is still waiting');
    assert.ok(ledgerBytes(d).equals(before), 'nothing was appended while the lock was held');
  } finally { release(); }
  assert.equal(await exited, 0);
  const v = verifyLedger(d);
  assert.equal(v.ok, true);
  assert.equal(v.lines.length, 7);
  assert.equal(v.lines[6].who, 'child');
});

test('review M6: an unreadable ledger lock is waited on while fresh and taken over once older than 30 s; the busy message names the lock file', () => {
  const d = copyRun('run-ok');
  const lock = join(d, LEDGER_LOCK_FILE);
  writeFileSync(lock, ''); // a crash between creating the lock and writing the pid
  assert.throws(() => withLedger(d, ({ append }) => append('sent', {}), { waitMs: 50 }), err => err.code === 'gate_busy' && err.message.includes(lock) && /delete that lock file/.test(err.message));
  const old = (Date.now() - 31_000) / 1000;
  utimesSync(lock, old, old);
  appendEvent(d, 'sent', { gate: 'g1' });
  assert.equal(readLedger(d).lines.length, 7);
  assert.equal(existsSync(lock), false);
});

test('review M6: the run lock itself is unchanged: an unreadable run lock still counts as held, whatever its age', () => {
  const d = tmp();
  writeFileSync(join(d, '.council.lock'), '');
  const old = (Date.now() - 3_600_000) / 1000;
  utimesSync(join(d, '.council.lock'), old, old);
  assert.ok(lockHolder(d)?.unreadable, 'still held');
});
