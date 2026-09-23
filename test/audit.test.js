// test/audit.test.js
//
// 7.x item 5: structured audit export (audit.jsonl). Tests the pure API in src/audit.js
// directly, not by spawning src/cli.js as a subprocess - the writer's contract
// (recordStage/close, backed by a real onStage callback exactly like cli.js's own) is fully
// interface-agnostic and testable with nothing else running, per this repo's own
// skills/backend-developer rule 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAuditWriter, verifyAuditLog, parseAuditLog, validateAuditLine,
  shouldEnableAudit, loadHmacKey, auditFilePath,
} from '../src/audit.js';
import { runChain } from '../src/chain.js';

function tmpRunDir(prefix = 'thc-audit-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

const stage = (label, over = {}) => ({
  label, provider: 'anthropic', model: 'claude-sonnet-5', lab: 'anthropic',
  usage: { input: 100, output: 50 }, usd: 0.001, ...over,
});

test('createAuditWriter + verifyAuditLog: a normal run writes a valid, hash-chained, HMAC-signed log', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'test-key' });
  writer.recordStage(stage('criteria'));
  writer.recordStage(stage('build', { provider: 'google', model: 'gemini-3.6-flash', lab: 'google' }));
  writer.close();

  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  assert.equal(lines.length, 3, '2 data lines + 1 chain-close line');
  assert.equal(lines[0].seq, 0);
  assert.equal(lines[0].prevHash, '0'.repeat(64));
  assert.equal(lines[1].prevHash, lines[0].hash);
  assert.equal(lines[2].type, 'chain-close');
  assert.equal(lines[2].lineCount, 2);

  const result = verifyAuditLog(lines, { hmacKey: 'test-key' });
  assert.deepEqual(result, { valid: true, failedAt: null, reason: null, closed: true });
});

test('verifyAuditLog: no key configured writes null signatures, and the hash chain alone still verifies', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: null });
  writer.recordStage(stage('criteria'));
  writer.close();
  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  assert.equal(lines[0].signature, null);
  assert.equal(lines[1].signature, null);
  assert.equal(verifyAuditLog(lines).valid, true, 'hash chain alone (no key given to verify) still checks out');
});

test('verifyAuditLog: the wrong key fails signature verification even though the hash chain is intact', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'the-real-key' });
  writer.recordStage(stage('criteria'));
  writer.close();
  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  const result = verifyAuditLog(lines, { hmacKey: 'a-different-key' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature/);
});

test('verifyAuditLog: mutating one byte in a data line is caught, at that exact line', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'k' });
  writer.recordStage(stage('criteria'));
  writer.recordStage(stage('build'));
  writer.recordStage(stage('critique'));
  writer.close();
  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));

  // Untouched, the log verifies.
  assert.equal(verifyAuditLog(lines, { hmacKey: 'k' }).valid, true);

  // Mutate one field of the middle data line (index 1) - not the hash/signature fields
  // themselves, so the tamper is only detectable by recomputation, not by a shape check.
  const mutated = lines.map((l, i) => (i === 1 ? { ...l, usd: 999 } : l));
  const result = verifyAuditLog(mutated, { hmacKey: 'k' });
  assert.equal(result.valid, false);
  assert.equal(result.failedAt, 1, 'the tampered line itself is where verification must fail');
});

// Pre-release audit 2026-09-23, DocsVsCode H4: cutting the tail off, close line included, used to
// verify as valid even with the HMAC key.
test('verifyAuditLog: a log cut short (last data line and chain-close removed) fails by default, even with the key', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'k' });
  writer.recordStage(stage('criteria'));
  writer.recordStage(stage('build'));
  writer.close();
  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  const cut = lines.slice(0, 1);
  const result = verifyAuditLog(cut, { hmacKey: 'k' });
  assert.equal(result.valid, false);
  assert.equal(result.closed, false);
  assert.match(result.reason, /no chain-close line/);
  assert.equal(verifyAuditLog([], { hmacKey: 'k' }).valid, false, 'an emptied file is not a valid log either');
  // An unfinished run can still be inspected, explicitly, and says it is unclosed.
  assert.deepEqual(verifyAuditLog(cut, { hmacKey: 'k', allowUnclosed: true }), { valid: true, failedAt: null, reason: null, closed: false });
});

test('verifyAuditLog: mutating the last data line breaks the chain-close finalHash check, not just the line itself', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'k' });
  writer.recordStage(stage('criteria'));
  writer.close();
  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  const mutated = [{ ...lines[0], tokensIn: 999999 }, lines[1]];
  const result = verifyAuditLog(mutated, { hmacKey: 'k' });
  assert.equal(result.valid, false);
  assert.equal(result.failedAt, 0);
});

test('createAuditWriter: resuming (a second writer over the same run folder) continues the chain rather than restarting it', () => {
  const runDir = tmpRunDir();
  const first = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'k' });
  first.recordStage(stage('criteria'));
  // No close() - stands in for a paused/budget-stopped run, same as cli.js never calling
  // close() outside the successful, report.json-writing path.

  const resumed = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'k' });
  resumed.recordStage(stage('build'));
  resumed.close();

  const lines = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].seq, 0);
  assert.equal(lines[1].seq, 1, 'the resumed writer continued the sequence rather than restarting at 0');
  assert.equal(lines[1].prevHash, lines[0].hash, 'the resumed writer chained onto the file\'s real last hash, not a fresh genesis');
  assert.equal(verifyAuditLog(lines, { hmacKey: 'k' }).valid, true);
});

test('createAuditWriter: a writer constructed over an already-closed log refuses to append further (loud, not silent corruption)', () => {
  const runDir = tmpRunDir();
  const first = createAuditWriter({ runDir, run: 'r1', chain: 'mock' });
  first.recordStage(stage('criteria'));
  first.close();
  const reopened = createAuditWriter({ runDir, run: 'r1', chain: 'mock' });
  assert.throws(() => reopened.recordStage(stage('build')), /already closed/);
});

test('two separate runs (separate run folders) each get their own audit.jsonl - a second run never touches the first\'s file', () => {
  const runDirA = tmpRunDir();
  const runDirB = tmpRunDir();
  const a = createAuditWriter({ runDir: runDirA, run: 'run-a', chain: 'mock', hmacKey: 'k' });
  a.recordStage(stage('criteria'));
  a.close();
  const before = readFileSync(auditFilePath(runDirA), 'utf8');

  const b = createAuditWriter({ runDir: runDirB, run: 'run-b', chain: 'mock', hmacKey: 'k' });
  b.recordStage(stage('criteria'));
  b.recordStage(stage('build'));
  b.close();

  const after = readFileSync(auditFilePath(runDirA), 'utf8');
  assert.equal(after, before, 'writing the second run\'s audit.jsonl must not alter the first run\'s file');
  assert.notEqual(auditFilePath(runDirA), auditFilePath(runDirB));
});

test('validateAuditLine: a well-formed data line and a well-formed close line both pass; a line missing a required field fails', () => {
  const runDir = tmpRunDir();
  const writer = createAuditWriter({ runDir, run: 'r1', chain: 'mock', hmacKey: 'k' });
  writer.recordStage(stage('criteria'));
  writer.close();
  const [line, close] = parseAuditLog(readFileSync(auditFilePath(runDir), 'utf8'));
  assert.equal(validateAuditLine(line), true);
  assert.equal(validateAuditLine(close), true);
  const { usd, ...broken } = line;
  assert.equal(validateAuditLine(broken), false);
});

test('shouldEnableAudit: on by default only when policy.json exists; opt-in via config.audit otherwise', () => {
  const dir = tmpRunDir();
  const policyPath = join(dir, 'policy.json');
  assert.equal(shouldEnableAudit({ config: {}, policyPath }), false, 'no policy.json, no opt-in: inert by default');
  assert.equal(shouldEnableAudit({ config: { audit: true }, policyPath }), true, 'explicit opt-in works with no policy.json');
  writeFileSync(policyPath, '{}');
  assert.equal(shouldEnableAudit({ config: {}, policyPath }), true, 'policy.json present turns it on with no opt-in needed');
});

test('loadHmacKey: AUDIT_HMAC_KEY_FILE resolving inside the run folder it would sign is refused', () => {
  const runDir = tmpRunDir();
  const keyPath = join(runDir, 'key.txt');
  writeFileSync(keyPath, 'a-key-in-the-wrong-place\n');
  const had = process.env.AUDIT_HMAC_KEY_FILE;
  const hadKey = process.env.AUDIT_HMAC_KEY;
  delete process.env.AUDIT_HMAC_KEY;
  process.env.AUDIT_HMAC_KEY_FILE = keyPath;
  try {
    assert.throws(() => loadHmacKey({ runDir }), /resolves inside the run folder/);
  } finally {
    if (had === undefined) delete process.env.AUDIT_HMAC_KEY_FILE; else process.env.AUDIT_HMAC_KEY_FILE = had;
    if (hadKey !== undefined) process.env.AUDIT_HMAC_KEY = hadKey;
  }
});

test('loadHmacKey: a key file outside the run folder loads and is trimmed; AUDIT_HMAC_KEY takes priority when both are set', () => {
  const outsideDir = tmpRunDir('thc-audit-key-');
  const runDir = tmpRunDir();
  const keyPath = join(outsideDir, 'key.txt');
  writeFileSync(keyPath, '  a-real-signing-key\n');
  const hadFile = process.env.AUDIT_HMAC_KEY_FILE;
  const hadKey = process.env.AUDIT_HMAC_KEY;
  delete process.env.AUDIT_HMAC_KEY;
  process.env.AUDIT_HMAC_KEY_FILE = keyPath;
  try {
    assert.equal(loadHmacKey({ runDir }), 'a-real-signing-key');
    process.env.AUDIT_HMAC_KEY = 'env-key-wins';
    assert.equal(loadHmacKey({ runDir }), 'env-key-wins');
  } finally {
    if (hadFile === undefined) delete process.env.AUDIT_HMAC_KEY_FILE; else process.env.AUDIT_HMAC_KEY_FILE = hadFile;
    if (hadKey === undefined) delete process.env.AUDIT_HMAC_KEY; else process.env.AUDIT_HMAC_KEY = hadKey;
  }
});

// The deliverable's own acceptance test, $0 and offline: wires createAuditWriter into
// runChain()'s onStage callback exactly the way cli.js does (recordStage per stage, close()
// once at the end), against the free mock provider, and checks the resulting audit.jsonl end to
// end - schema, HMAC, hash chain - then runs a second time and confirms the first run's file is
// untouched.
test('end-to-end: runChain + an audit writer wired into onStage produces a valid, verifiable audit.jsonl; a second run does not disturb the first', async () => {
  const { readFileSync: rfs } = await import('node:fs');
  const { join: j, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = j(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(rfs(j(root, 'chains', 'mock-debate.json'), 'utf8'));

  const runDirA = tmpRunDir();
  const writerA = createAuditWriter({ runDir: runDirA, run: 'run-a', chain: config.name, hmacKey: 'k' });
  const resultA = await runChain({
    request: 'An audit-export end-to-end test.', config, log: () => {},
    onStage: s => { if (!s.cached) writerA.recordStage(s); },
  });
  writerA.close();
  assert.ok(resultA.deliverable);

  const linesA = parseAuditLog(readFileSync(auditFilePath(runDirA), 'utf8'));
  assert.ok(linesA.length > 1, 'expected at least one data line plus the close line');
  assert.equal(verifyAuditLog(linesA, { hmacKey: 'k' }).valid, true);
  const labsSeen = new Set(linesA.filter(l => l.type !== 'chain-close').map(l => l.lab));
  assert.ok(labsSeen.has('mock-a') || labsSeen.has('mock-b'), `expected real seat labs in the audit trail, saw ${[...labsSeen]}`);
  const beforeSecondRun = readFileSync(auditFilePath(runDirA), 'utf8');

  const runDirB = tmpRunDir();
  const writerB = createAuditWriter({ runDir: runDirB, run: 'run-b', chain: config.name, hmacKey: 'k' });
  await runChain({
    request: 'A second, independent run.', config, log: () => {},
    onStage: s => { if (!s.cached) writerB.recordStage(s); },
  });
  writerB.close();

  assert.equal(readFileSync(auditFilePath(runDirA), 'utf8'), beforeSecondRun, 'a second run must not touch the first run\'s audit.jsonl');
});
