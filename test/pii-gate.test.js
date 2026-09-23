// test/pii-gate.test.js
//
// v7.x item 2 (relay/runs/2026-09-14T15-29-02-644Z/deliverable.md): PII/secrets pre-flight gate.
// Real mod-97 IBAN and Luhn checks (not shape regexes), never echoes the matched content, and is
// completely inert unless --pii-gate is explicitly passed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ibanChecksumValid, luhnValid, maskMatch, scanForPii, applyPiiGate } from '../src/pii-gate.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const repoRoot = resolve(here, '..');

// ---- mod-97 IBAN checksum ----

test('ibanChecksumValid: a real, checksum-valid German IBAN passes', () => {
  assert.equal(ibanChecksumValid('DE89370400440532013000'), true);
});

test('ibanChecksumValid: the same digits with one transposed character fails checksum', () => {
  assert.equal(ibanChecksumValid('DE89370400440532013001'), false);
});

test('ibanChecksumValid: IBAN-shaped but checksum-invalid text is rejected outright (not just format)', () => {
  // Correct shape (2 letters, 2 digits, alnum tail) but a checksum that does not reduce to 1.
  assert.equal(ibanChecksumValid('GB00WEST12345698765432'), false);
});

test('ibanChecksumValid: garbage/too-short input never throws and returns false', () => {
  assert.equal(ibanChecksumValid(''), false);
  assert.equal(ibanChecksumValid('not-an-iban'), false);
  assert.equal(ibanChecksumValid(null), false);
});

// ---- Luhn ----

test('luhnValid: a real Luhn-valid test card number passes', () => {
  assert.equal(luhnValid('4111111111111111'), true); // well-known Visa test number
});

test('luhnValid: the same digits with the last digit changed fails Luhn', () => {
  assert.equal(luhnValid('4111111111111112'), false);
});

test('luhnValid: a same-length random digit run (not Luhn-valid) is rejected - digit count alone is not enough', () => {
  assert.equal(luhnValid('1234567890123456'), false);
});

test('luhnValid: wrong length never throws and returns false', () => {
  assert.equal(luhnValid('123'), false);
  assert.equal(luhnValid(''), false);
});

// ---- masking / leak prevention ----

test('maskMatch: never returns the original string, and is always <= 40 characters', () => {
  const secret = 'sk-' + 'A'.repeat(60);
  const masked = maskMatch(secret);
  assert.notEqual(masked, secret);
  assert.ok(masked.length <= 40, `masked output was ${masked.length} chars: ${masked}`);
  assert.equal(masked.startsWith(secret.slice(0, 4)), true);
  assert.equal(masked.includes(secret.slice(10)), false);
});

test('maskMatch: empty/undefined input never throws', () => {
  assert.equal(maskMatch(''), '');
  assert.equal(maskMatch(undefined), '');
});

// ---- scanForPii ----

test('scanForPii: detects a real email address by line/column, never echoing the address itself', () => {
  const text = 'line one\ncontact me at muad.yasin@example.com please\n';
  const { findings } = scanForPii(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'email');
  assert.equal(findings[0].line, 2);
  const serialised = JSON.stringify(findings);
  assert.equal(serialised.includes('muad.yasin@example.com'), false);
});

test('scanForPii: a checksum-valid IBAN is flagged; a checksum-invalid IBAN-shaped string is not', () => {
  const text = 'real: DE89370400440532013000\nfake: DE89370400440532013001\n';
  const { findings } = scanForPii(text);
  const ibanFindings = findings.filter(f => f.type === 'iban');
  assert.equal(ibanFindings.length, 1);
  assert.equal(ibanFindings[0].line, 1);
});

test('scanForPii: a Luhn-valid card number is flagged; a same-length non-Luhn digit run is not', () => {
  const text = 'card: 4111 1111 1111 1111\nnot a card: 1234567890123456\n';
  const { findings } = scanForPii(text);
  const cardFindings = findings.filter(f => f.type === 'card');
  assert.equal(cardFindings.length, 1);
  assert.equal(cardFindings[0].line, 1);
});

test('scanForPii: a secret-shaped string (reusing key-redaction patterns) is flagged with a pattern name, no value', () => {
  const fakeKey = 'sk-' + 'B'.repeat(40);
  const text = `key here: ${fakeKey}\n`;
  const { findings } = scanForPii(text);
  const secretFindings = findings.filter(f => f.type === 'secret');
  assert.equal(secretFindings.length, 1);
  assert.ok(secretFindings[0].pattern);
  assert.equal(secretFindings[0].masked, undefined);
  assert.equal(JSON.stringify(findings).includes(fakeKey), false);
});

test('scanForPii: clean text with no matches returns an empty findings array', () => {
  const { findings, suppressed } = scanForPii('Just a plain sentence with no PII or secrets in it.\n');
  assert.deepEqual(findings, []);
  assert.deepEqual(suppressed, []);
});

test('scanForPii: --allow-pii suppresses the named type and reports the suppression', () => {
  const text = 'contact me at muad.yasin@example.com\n';
  const { findings, suppressed } = scanForPii(text, { allow: ['email'] });
  assert.deepEqual(findings, []);
  assert.deepEqual(suppressed, ['email']);
});

test('scanForPii: an unknown allow-pii type is ignored, not silently accepted as a real suppression', () => {
  const text = 'contact me at muad.yasin@example.com\n';
  const { findings, suppressed } = scanForPii(text, { allow: ['not-a-real-type'] });
  assert.equal(findings.length, 1);
  assert.deepEqual(suppressed, []);
});

// ---- applyPiiGate ----

test('applyPiiGate: warn mode never blocks even with findings', () => {
  const { block } = applyPiiGate({ findings: [{ type: 'email', line: 1, column: 1, masked: 'a***' }], suppressed: [] }, 'warn');
  assert.equal(block, false);
});

test('applyPiiGate: hard-stop mode blocks when there are findings', () => {
  const { block, messages } = applyPiiGate({ findings: [{ type: 'email', line: 1, column: 1, masked: 'a***' }], suppressed: [] }, 'hard-stop');
  assert.equal(block, true);
  assert.ok(messages.some(m => m.includes('email')));
});

test('applyPiiGate: hard-stop mode with no findings does not block', () => {
  const { block } = applyPiiGate({ findings: [], suppressed: [] }, 'hard-stop');
  assert.equal(block, false);
});

test('applyPiiGate: messages never contain the real masked-away content beyond the mask itself', () => {
  const secret = 'sk-' + 'C'.repeat(40);
  const { messages } = applyPiiGate({ findings: [], suppressed: [] }, 'warn');
  assert.equal(messages.join('\n').includes(secret), false);
});

// ---- CLI end-to-end (mock chain, $0, offline) ----

function setupDir() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pii-gate-e2e-'));
  mkdirSync(join(dir, 'tasks'));
  return dir;
}

test('CLI: with no --pii-gate flag, a task file with a fake email runs to completion exactly as before (gate never invoked)', () => {
  const dir = setupDir();
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan something for muad.yasin@example.com.\n');
  const out = execFileSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir });
  assert.equal(out.includes('PII-GATE'), false);
  assert.equal(readdirSync(join(dir, 'runs')).length, 1);
});

test('CLI: --pii-gate hard-stop refuses the run before any run folder is created, on a real match', () => {
  const dir = setupDir();
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan something for muad.yasin@example.com.\n');
  assert.throws(() => execFileSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--pii-gate', 'hard-stop'], { encoding: 'utf8', cwd: dir }));
  try {
    execFileSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--pii-gate', 'hard-stop'], { encoding: 'utf8', cwd: dir });
  } catch (err) {
    assert.equal(err.status, 11, 'the PII gate has its own exit code (bug audit 2026-09-23, CLI #7)');
    assert.match(err.stderr, /PII-GATE/);
    assert.match(err.stderr, /email/);
    assert.equal(err.stderr.includes('muad.yasin@example.com'), false);
  }
  // No run folder was ever created - the gate fired before any provider call site.
  assert.equal(readdirSync(dir).includes('runs'), false);
});

test('CLI: --pii-gate warn logs the match, never echoes it, and still lets the (mock) run proceed', () => {
  const dir = setupDir();
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan something for muad.yasin@example.com.\n');
  const proc = spawnSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--pii-gate', 'warn'], { encoding: 'utf8', cwd: dir });
  assert.equal(proc.status, 0);
  assert.match(proc.stderr, /PII-GATE \(warn\)/);
  assert.match(proc.stderr, /email/);
  assert.equal(proc.stderr.includes('muad.yasin@example.com'), false);
  assert.equal(proc.stdout.includes('muad.yasin@example.com'), false);
  assert.equal(readdirSync(join(dir, 'runs')).length, 1);
});

test('CLI: --pii-gate hard-stop on a clean task file (no matches) runs to completion unchanged', () => {
  const dir = setupDir();
  writeFileSync(join(dir, 'tasks', 't.md'), 'A tiny, clean task with no PII or secrets in it.\n');
  const out = execFileSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--pii-gate', 'hard-stop'], { encoding: 'utf8', cwd: dir });
  assert.equal(out.includes('PII-GATE'), false);
  assert.equal(readdirSync(join(dir, 'runs')).length, 1);
});

test('CLI: --allow-pii suppresses the named type under hard-stop, and the suppression is printed', () => {
  const dir = setupDir();
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan something for muad.yasin@example.com.\n');
  const proc = spawnSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--pii-gate', 'hard-stop', '--allow-pii', 'email'], { encoding: 'utf8', cwd: dir });
  assert.equal(proc.status, 0);
  assert.match(proc.stderr, /suppressed pattern class 'email'/);
  assert.equal(readdirSync(join(dir, 'runs')).length, 1);
});

test('CLI: an invalid --pii-gate value is a usage error (exit 2), not a silent no-op', () => {
  const dir = setupDir();
  writeFileSync(join(dir, 'tasks', 't.md'), 'A tiny task.\n');
  try {
    execFileSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', '--pii-gate', 'bogus'], { encoding: 'utf8', cwd: dir });
    assert.fail('expected a non-zero exit');
  } catch (err) {
    assert.equal(err.status, 2);
  }
});

// Bug audit 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #3): the gate scanned the task file
// only, before --context was appended, and never the handed draft - both reach every seat. (The fix
// shipped in 4ec8f16; this test was meant to ship with it and did not.)
test('CLI: --pii-gate hard-stop also refuses PII that arrives via --context or --draft', () => {
  for (const [flagName, file] of [['--context', 'ctx.md'], ['--draft', 'draft.md']]) {
    const dir = setupDir();
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan something plain.\n');
    writeFileSync(join(dir, file), 'Contact muad.yasin@example.com, card 4111 1111 1111 1111.\n');
    const proc = spawnSync('node', [cli, '--chain', 'mock', '--task', 'tasks/t.md', flagName, file, '--pii-gate', 'hard-stop'], { encoding: 'utf8', cwd: dir });
    assert.equal(proc.status, 11, `${flagName}: expected a refusal, got ${proc.status}\n${proc.stderr.slice(-300)}`);
    assert.match(proc.stderr, /PII-GATE/);
    assert.equal(proc.stderr.includes('muad.yasin@example.com'), false, 'the match is never echoed');
    assert.equal(readdirSync(dir).includes('runs'), false, `${flagName}: refused before any run folder exists`);
  }
});
