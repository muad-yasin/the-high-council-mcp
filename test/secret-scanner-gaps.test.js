// test/secret-scanner-gaps.test.js
//
// 2026-09-23 audit item E, secret half (Review/BugAudit_ToolsMcpHttp_2026-09-23.md finding 9).
// The content scan and the path denylist missed common formats. Live via `council fence`:
// scanTaskForSecrets called all five samples clean. Every case below failed before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets, isDeniedPath, runTool } from '../src/tools.js';
import { scanTaskForSecrets } from '../src/fence.js';

const OPAQUE = 'Zq8vN3kLm2Xp9Rt4Yw7Bc5Hd';

const LEAKS = [
  ['a Stripe live secret key', `stripe = "sk_live_${OPAQUE}"`, `sk_live_${OPAQUE}`],
  ['a Stripe restricted key', `rk_live_${OPAQUE}`, `rk_live_${OPAQUE}`],
  ['a GitHub fine-grained token', `token github_pat_11ABCDEFG0_${OPAQUE}${OPAQUE}`, `${OPAQUE}${OPAQUE}`],
  ['a JSON-quoted password', `{"password": "${OPAQUE}"}`, OPAQUE],
  ['an env-style *_API_KEY (no word boundary after _)', `OPENROUTER_API_KEY=${OPAQUE}`, OPAQUE],
  ['an env-style *_KEY with an opaque value', `GOOGLE_PLAY_PUBKEY=${OPAQUE}`, OPAQUE],
  ['an env-style *_TOKEN', `export DEPLOY_TOKEN="${OPAQUE}"`, OPAQUE],
  ['a password inside a URL', `DATABASE_URL=postgres://admin:${OPAQUE}@db.internal:5432/app`, OPAQUE],
];

for (const [name, text, secret] of LEAKS) {
  test(`redactSecrets removes ${name}`, () => {
    const { text: out, redacted } = redactSecrets(text);
    assert.ok(redacted >= 1, `nothing redacted in: ${text}`);
    assert.ok(!out.includes(secret), `secret survived: ${out}`);
  });
  test(`scanTaskForSecrets blocks ${name}`, () => {
    assert.equal(scanTaskForSecrets(`Please review.\n${text}\n`).clean, false);
  });
}

test('the URL rule keeps the user and host readable, removing only the password', () => {
  const { text } = redactSecrets(`postgres://admin:${OPAQUE}@db.internal/app`);
  assert.match(text, /postgres:\/\/admin:\[redacted: possible secret\]@db\.internal\/app/);
});

test('ordinary code and config stay untouched (a filter that fires on everything gets turned off)', () => {
  for (const ok of [
    'const apiKey = config.apiKey;',
    'CACHE_KEY=1',
    'DEBUG=true',
    'see https://example.com/docs/page',
    'mailto:someone@example.com',
    '"password": ""',
    'sk_test_',
  ]) {
    assert.equal(redactSecrets(ok).redacted, 0, `false positive on: ${ok}`);
  }
});

for (const path of ['.envrc', 'config/prod.env', '.git/config', '.git-credentials', '.netrc', 'home/_netrc']) {
  test(`isDeniedPath refuses ${path}`, () => assert.equal(isDeniedPath(path), true));
}

for (const path of ['src/environment.js', '.gitignore', 'docs/env.md', 'netrc-parser.js']) {
  test(`isDeniedPath still allows ${path}`, () => assert.equal(isDeniedPath(path), false));
}

test('grep_repo never returns the body lines of a PEM key (it used to redact line by line)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-grep-pem-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const body = 'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gunVTLw';
  writeFileSync(join(dir, 'Config.cs'), `// config\n-----BEGIN RSA PRIVATE KEY-----\n${`${body}\n`.repeat(5)}-----END RSA PRIVATE KEY-----\nint port = 5;\n`);
  const res = runTool('grep_repo', { pattern: 'A' }, { cwd: dir });
  assert.equal(res.ok, true);
  assert.ok(!JSON.stringify(res.matches).includes(body), 'PEM body line returned');
  // Line numbers still point at the real lines: the key block keeps its line count.
  const port = runTool('grep_repo', { pattern: 'port' }, { cwd: dir });
  assert.equal(port.matches[0].line, 9);
});
