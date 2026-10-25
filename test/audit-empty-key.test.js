// T1-8 (0.8.3 M6, Builder D; Batch 2 audit item 8): an EMPTY signing key turned audit signing off without a word. `AUDIT_HMAC_KEY_FILE` naming an empty file gave the key '' (falsy), so every line and the close were written
// `signature: null` and `verifyAuditLog` skipped the check; `AUDIT_HMAC_KEY=''` fell through to "no key" and the CLI printed the ordinary "unsigned" notice although a key variable HAD been set.
// The rule now (C&C ruling 13 Oct 2026): a key variable that is PRESENT in the environment must yield a key, or the run refuses (cli.js turns a throw from loadHmacKey into `audit: <message>` and a fatal exit
// before anything is spent). Nothing set at all stays "unsigned, still hash-chained" with its notice. An empty AUDIT_HMAC_KEY next to a valid key file uses the file (nothing fails open). The writer and the
// verifier also refuse the empty string, so no caller reaches "falsy key = signing off" with it. AUDIT_HMAC_KEY='' is reachable only through the PROCESS environment (env-file.js treats a blank .env value as
// absent), so these tests set process.env directly and restore it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditWriter, verifyAuditLog, parseAuditLog, loadHmacKey } from '../src/audit.js';
import { readFileSync } from 'node:fs';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-audit-key-')); made.push(d); return d; };

function withEnv(env, fn) {
  const names = ['AUDIT_HMAC_KEY', 'AUDIT_HMAC_KEY_FILE'];
  const had = Object.fromEntries(names.map(n => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  Object.assign(process.env, env);
  try { return fn(); } finally { for (const n of names) { if (had[n] === undefined) delete process.env[n]; else process.env[n] = had[n]; } }
}
const keyFile = content => { const f = join(tmp(), 'key'); writeFileSync(f, content); return f; };
const runDir = () => { const d = join(tmp(), 'runs', 'r1'); mkdirSync(d, { recursive: true }); return d; };
const stage = { label: 'a', provider: 'mock', model: 'm', lab: 'x', usage: { input: 1, output: 1 }, usd: 0 };

test('AEK-1 an empty key file refuses (names the variable and the path, never a value); a whitespace-only file too', () => {
  for (const content of ['', '\n', '  \r\n\t ']) {
    const f = keyFile(content);
    withEnv({ AUDIT_HMAC_KEY_FILE: f }, () => assert.throws(() => loadHmacKey({ runDir: runDir() }), err => err.message.includes('AUDIT_HMAC_KEY_FILE') && err.message.includes(f) && /empty/.test(err.message)));
  }
});

test('AEK-2 AUDIT_HMAC_KEY set but empty or blank refuses when no usable key file backs it; AUDIT_HMAC_KEY_FILE set to an empty string refuses too', () => {
  for (const v of ['', '   ', '\n']) withEnv({ AUDIT_HMAC_KEY: v }, () => assert.throws(() => loadHmacKey({ runDir: runDir() }), /AUDIT_HMAC_KEY is set but empty/));
  withEnv({ AUDIT_HMAC_KEY_FILE: '' }, () => assert.throws(() => loadHmacKey({ runDir: runDir() }), /AUDIT_HMAC_KEY_FILE is set but empty/));
});

test('AEK-3 nothing fails open: an empty AUDIT_HMAC_KEY next to a valid key file uses the file; a real key variable wins over an empty file as before; the unset case is still null', () => {
  const good = keyFile('a-real-signing-key\n');
  withEnv({ AUDIT_HMAC_KEY: '', AUDIT_HMAC_KEY_FILE: good }, () => assert.equal(loadHmacKey({ runDir: runDir() }), 'a-real-signing-key'));
  withEnv({ AUDIT_HMAC_KEY: 'env-key-wins', AUDIT_HMAC_KEY_FILE: keyFile('') }, () => assert.equal(loadHmacKey({ runDir: runDir() }), 'env-key-wins'));
  withEnv({}, () => assert.equal(loadHmacKey({ runDir: runDir() }), null, 'neither variable set: unsigned, with the CLI notice, exactly as before'));
});

test('AEK-4 the writer and the verifier refuse the empty string, so "falsy key = signing off" is unreachable from either; null and undefined still mean "no key"', () => {
  assert.throws(() => createAuditWriter({ runDir: runDir(), run: 'r', chain: 'c', hmacKey: '' }), /empty/);
  assert.throws(() => verifyAuditLog([], { hmacKey: '' }), /empty/);
  const dir = runDir();
  const w = createAuditWriter({ runDir: dir, run: 'r', chain: 'c', hmacKey: null });
  w.recordStage(stage); w.close();
  assert.equal(verifyAuditLog(parseAuditLog(readFileSync(w.path, 'utf8'))).valid, true, 'no key: the hash chain alone still verifies');
});

test('AEK-5 control: with a real key every line and the close are signed, the right key verifies and a wrong one does not', () => {
  const dir = runDir();
  const w = createAuditWriter({ runDir: dir, run: 'r', chain: 'c', hmacKey: 'right-key' });
  w.recordStage(stage); w.close();
  const lines = parseAuditLog(readFileSync(w.path, 'utf8'));
  assert.ok(lines.every(l => typeof l.signature === 'string' && l.signature.length > 20), 'every line carries a signature');
  assert.equal(verifyAuditLog(lines, { hmacKey: 'right-key' }).valid, true);
  assert.equal(verifyAuditLog(lines, { hmacKey: 'wrong-key' }).valid, false);
});
