// test/tools-secret-filter.test.js
//
// 2026-09-20. These tools were built to read a workspace, and the sandbox only ever asked
// "is this path inside the root?" - never "should a third-party lab see this?". grep_repo
// walked gitignored files with no secret filter, and the repo this harness is most likely
// to be pointed at keeps a key under Tools/secrets/. Nothing leaked (no shipped chain
// enables grep_repo); this pins the hole closed before the fact-pack work opens it.
//
// The property under test throughout: anything these tools return can end up in a prompt,
// and a prompt goes to every lab holding a seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool, isDeniedPath, redactSecrets, capForPrompt } from '../src/tools.js';

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-tools-secret-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  mkdirSync(join(dir, 'Tools', 'secrets'), { recursive: true });
  writeFileSync(join(dir, 'Tools', 'secrets', 'upload.key'), `${SECRET}\n`);
  writeFileSync(join(dir, '.env'), `OPENROUTER_API_KEY=${SECRET}\n`);
  writeFileSync(join(dir, '.gitignore'), 'local-notes.md\n');
  writeFileSync(join(dir, 'local-notes.md'), `my key is ${SECRET}\n`);
  writeFileSync(join(dir, 'src.js'), `const apiKey = "${SECRET}";\nexport const ok = 1;\n`);
  return dir;
}

test('grep_repo never returns a denylisted file, however broad the pattern', () => {
  const dir = workspace();
  const res = runTool('grep_repo', { pattern: 'sk-|API_KEY|key' }, { cwd: dir });
  assert.equal(res.ok, true);
  const files = res.matches.map(m => m.file);
  assert.ok(!files.some(f => f.includes('secrets')), `secrets/ was searched: ${JSON.stringify(files)}`);
  assert.ok(!files.some(f => f.includes('.env')), `.env was searched: ${JSON.stringify(files)}`);
  const blob = JSON.stringify(res.matches);
  assert.ok(!blob.includes(SECRET), 'the raw secret must not appear anywhere in the result');
  rmSync(dir, { recursive: true, force: true });
});

test('grep_repo skips gitignored files - not part of the repo, and where local keys live', () => {
  const dir = workspace();
  const res = runTool('grep_repo', { pattern: 'key' }, { cwd: dir });
  assert.ok(!res.matches.some(m => m.file === 'local-notes.md'), 'a gitignored file was searched');
  assert.ok(res.gitIgnoredSkipped >= 1, 'the skip is reported, not silent');
  rmSync(dir, { recursive: true, force: true });
});

test('grep_repo redacts a secret pasted into an ordinary source file', () => {
  const dir = workspace();
  const res = runTool('grep_repo', { pattern: 'apiKey' }, { cwd: dir });
  const hit = res.matches.find(m => m.file === 'src.js');
  assert.ok(hit, 'the source file itself is still searchable - this is a filter, not a blackout');
  assert.ok(!hit.text.includes(SECRET));
  assert.match(hit.text, /redacted/);
  rmSync(dir, { recursive: true, force: true });
});

test('read_file refuses a denylisted path by name, and says which rule fired', () => {
  const dir = workspace();
  const res = runTool('read_file', { path: 'Tools/secrets/upload.key' }, { cwd: dir });
  assert.equal(res.ok, false);
  assert.match(res.error, /denylist/);
  assert.ok(!JSON.stringify(res).includes(SECRET));
  rmSync(dir, { recursive: true, force: true });
});

test('read_file refuses a gitignored path, and redacts a secret in an allowed one', () => {
  const dir = workspace();
  const ignored = runTool('read_file', { path: 'local-notes.md' }, { cwd: dir });
  assert.equal(ignored.ok, false);
  assert.match(ignored.error, /gitignored/);

  const allowed = runTool('read_file', { path: 'src.js' }, { cwd: dir });
  assert.equal(allowed.ok, true);
  assert.ok(!allowed.text.includes(SECRET));
  assert.equal(allowed.redacted, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('a workspace that is not a git repo still filters - the failure mode is more files, never an unfiltered secret', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-tools-nogit-'));
  mkdirSync(join(dir, 'secrets'));
  writeFileSync(join(dir, 'secrets', 'a.key'), `${SECRET}\n`);
  writeFileSync(join(dir, 'app.js'), `const token = "${SECRET}";\n`);
  const res = runTool('grep_repo', { pattern: 'sk-|token' }, { cwd: dir });
  assert.equal(res.ok, true);
  assert.ok(!JSON.stringify(res).includes(SECRET));
  rmSync(dir, { recursive: true, force: true });
});

test('isDeniedPath catches a secrets segment at any depth, not just the root', () => {
  for (const p of ['secrets/a.txt', 'Tools/secrets/a.txt', 'a/b/secret/c.txt', '.env', 'sub/.env.local',
    'x/upload.keystore', 'keystore.properties', '.ssh/id_rsa', 'deep/id_ed25519', 'x/cert.pem']) {
    assert.equal(isDeniedPath(p), true, `${p} should be denied`);
  }
  for (const p of ['src/app.js', 'README.md', 'docs/keyboard.md', 'src/secretsManager.test.js']) {
    assert.equal(isDeniedPath(p), false, `${p} should be allowed - an over-broad denylist gets turned off`);
  }
});

test('redactSecrets keeps the name and removes the value, so the reader knows something was there', () => {
  const { text, redacted } = redactSecrets('api_key: "AKIAIOSFODNN7EXAMPLE" rest');
  assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.match(text, /redacted/);
  assert.ok(redacted >= 1);

  // Ordinary code that merely mentions the word is left alone.
  assert.equal(redactSecrets('const apiKey = config.apiKey;').redacted, 0);
  assert.equal(redactSecrets('').redacted, 0);
});

test('redactSecrets catches a PEM private key block whole', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nkey\n-----END RSA PRIVATE KEY-----';
  const { text } = redactSecrets(`before\n${pem}\nafter`);
  assert.ok(!text.includes('MIIEow'));
  assert.match(text, /before[\s\S]*redacted[\s\S]*after/);
});

test('capForPrompt bounds what reaches a prompt and marks the truncation', () => {
  const big = 'x'.repeat(10_000);
  const { text, truncated } = capForPrompt(big);
  assert.equal(truncated, true);
  assert.ok(Buffer.byteLength(text) < 5_000);
  assert.match(text, /truncated: \d+ more bytes/);
  assert.deepEqual(capForPrompt('short'), { text: 'short', truncated: false });
});

test('the call log records the post-redaction bytes, never the raw ones', async () => {
  const { toolCallLog, resetToolCallLog } = await import('../src/tools.js');
  const dir = workspace();
  resetToolCallLog();
  runTool('read_file', { path: 'src.js' }, { cwd: dir });
  const log = toolCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].tool, 'read_file');
  assert.ok(log[0].bytes > 0);
  assert.equal(log[0].redacted, 1);
  // Logging raw bytes would move the secret from the prompt into the run folder, not fix it.
  assert.ok(!JSON.stringify(log).includes(SECRET));
  rmSync(dir, { recursive: true, force: true });
});
