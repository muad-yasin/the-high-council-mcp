// test/secret-gates-audit.test.js
//
// 2026-09-23 audit, items A-C (Review/BugAudit_CLI_2026-09-23.md finding 1 and 3,
// Review/BugAudit_ToolsMcpHttp_2026-09-23.md findings 2 and the gitIgnoredSet one).
// Each test here failed on the code before the fix:
//   A. `council fence` truncated first and redacted second, so a PEM block crossing the
//      6000-byte cut lost its END line, no longer matched, and went out in clear. It also
//      fenced gitignored files, and checked the denylist only relative to --repo.
//   B. run_tests skipped every gate read_file has: {"file": ".env"} put the key line into
//      node's syntax-error output.
//   C. gitIgnoredSet failed open (any git error = "nothing ignored"), missed C-quoted
//      non-ASCII names, and saw the wrong relative path under a symlinked root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool } from '../src/tools.js';
import { fenceFile, FENCE_MAX_BYTES } from '../src/fence.js';

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
const PEM_BODY = 'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gunVTLw';
const PEM = `-----BEGIN RSA PRIVATE KEY-----\n${`${PEM_BODY}\n`.repeat(20)}-----END RSA PRIVATE KEY-----\n`;

function gitRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

// ---- A. fence ----

test('A: a PEM block that crosses the fence cut is still redacted whole', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-audit-fence-'));
  // The key starts ~100 bytes before the cut and ends ~1300 bytes after it. Filler after
  // it keeps the file over the limit even once the key shrinks to a redaction marker.
  writeFileSync(join(dir, 'Config.cs'), `${'/'.repeat(FENCE_MAX_BYTES - 100)}\n${PEM}${'class Config {}\n'.repeat(200)}`);
  const out = fenceFile(dir, 'Config.cs');
  assert.equal(out.truncated, true);
  assert.ok(out.redacted >= 1, 'the straddling key was not redacted');
  assert.ok(!out.text.includes(PEM_BODY), 'key material reached the fenced text');
  assert.ok(!out.text.includes('BEGIN RSA PRIVATE KEY'), 'a key header reached the fenced text');
});

test('A: fence refuses a gitignored file', () => {
  const dir = gitRepo('thc-audit-fence-ign-');
  mkdirSync(join(dir, 'Assets'));
  writeFileSync(join(dir, '.gitignore'), 'Assets/local_settings.json\n');
  writeFileSync(join(dir, 'Assets', 'local_settings.json'), '{"playLicenseKey": "abc"}\n');
  assert.throws(() => fenceFile(dir, 'Assets/local_settings.json'), /gitignored/);
});

test('A: fence checks the denylist against the real path, not only relative to --repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-audit-fence-deny-'));
  const secrets = join(dir, 'repo', 'Tools', 'secrets');
  mkdirSync(secrets, { recursive: true });
  writeFileSync(join(secrets, 'play.txt'), 'GOOGLE_PLAY_PUBKEY=abc\n');
  assert.throws(() => fenceFile(secrets, 'play.txt'), /denylist/);
});

// ---- B. run_tests ----

function testWorkspace() {
  const dir = gitRepo('thc-audit-runtests-');
  writeFileSync(join(dir, '.env'), `OPENROUTER_API_KEY=${SECRET}\n`);
  writeFileSync(join(dir, '.gitignore'), 'scratch.test.js\n');
  writeFileSync(join(dir, 'scratch.test.js'), `console.log(${JSON.stringify(SECRET)});\n`);
  writeFileSync(join(dir, 'prints.test.js'), `console.log("value: ${SECRET}");\n`);
  return dir;
}

test('B: run_tests refuses a denylisted file, and the secret never appears in its result', () => {
  const dir = testWorkspace();
  const res = runTool('run_tests', { file: '.env' }, { cwd: dir });
  assert.equal(res.ok, false);
  assert.match(res.error, /denylist/);
  assert.ok(!JSON.stringify(res).includes(SECRET), 'the key reached the tool result');
});

test('B: run_tests refuses a gitignored file', () => {
  const dir = testWorkspace();
  const res = runTool('run_tests', { file: 'scratch.test.js' }, { cwd: dir });
  assert.equal(res.ok, false);
  assert.match(res.error, /gitignored/);
  assert.ok(!JSON.stringify(res).includes(SECRET));
});

test('B: run_tests output is redacted like every other tool result', () => {
  const dir = testWorkspace();
  const res = runTool('run_tests', { file: 'prints.test.js' }, { cwd: dir });
  assert.ok(!JSON.stringify(res).includes(SECRET), 'test output carried the secret through');
  assert.ok(res.redacted >= 1);
});

// ---- C. gitIgnoredSet ----

function withFakeGit(script, fn) {
  const bin = mkdtempSync(join(tmpdir(), 'thc-fake-git-'));
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try { return fn(); } finally { process.env.PATH = saved; }
}

test('C: a git error refuses the read instead of treating nothing as ignored', () => {
  const dir = gitRepo('thc-audit-git-err-');
  writeFileSync(join(dir, 'notes.md'), 'ordinary\n');
  for (const script of [
    'echo "fatal: Pathspec \'notes.md\' is in submodule \'sub\'" >&2; exit 128',
    'kill -9 $$',
    'exit 2',
  ]) {
    const res = withFakeGit(script, () => runTool('read_file', { path: 'notes.md' }, { cwd: dir }));
    assert.equal(res.ok, false, `read allowed although git failed (${script})`);
    assert.match(res.error, /gitignore/i);
  }
});

test('C: grep_repo also fails closed on a git error', () => {
  const dir = gitRepo('thc-audit-git-err-grep-');
  writeFileSync(join(dir, 'notes.md'), 'needle\n');
  const res = withFakeGit('exit 2', () => runTool('grep_repo', { pattern: 'needle' }, { cwd: dir }));
  assert.equal(res.ok, false);
  assert.match(res.error, /gitignore/i);
});

test('C: a non-git workspace still reads (no gitignore exists there to check)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-audit-nogit-'));
  writeFileSync(join(dir, 'notes.md'), 'ordinary\n');
  assert.equal(runTool('read_file', { path: 'notes.md' }, { cwd: dir }).ok, true);
});

test('C: a gitignored file with a non-ASCII name is refused (git C-quotes it otherwise)', () => {
  const dir = gitRepo('thc-audit-git-utf8-');
  writeFileSync(join(dir, '.gitignore'), 'geheimnis-ä.txt\n');
  writeFileSync(join(dir, 'geheimnis-ä.txt'), `${SECRET}\n`);
  const res = runTool('read_file', { path: 'geheimnis-ä.txt' }, { cwd: dir });
  assert.equal(res.ok, false, 'non-ASCII gitignored file was returned');
  assert.match(res.error, /gitignored/);
});

test('C: under a symlinked root, a gitignored file is still refused', () => {
  const real = gitRepo('thc-audit-git-link-');
  writeFileSync(join(real, '.gitignore'), 'local-notes.md\n');
  writeFileSync(join(real, 'local-notes.md'), `${SECRET}\n`);
  const link = join(mkdtempSync(join(tmpdir(), 'thc-audit-linkparent-')), 'repo');
  symlinkSync(real, link);
  const res = runTool('read_file', { path: 'local-notes.md' }, { cwd: link });
  assert.equal(res.ok, false, 'gitignored file read through a symlinked root');
  assert.match(res.error, /gitignored/);
});
