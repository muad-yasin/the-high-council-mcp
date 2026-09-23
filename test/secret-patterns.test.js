// Pre-release audit 2026-09-23 (FenceToolsRedaction #1-#4, HIGH): one shared secret-pattern
// module (src/secret-patterns.js) behind all three consumers - the task/artifact scanner
// (key-redaction.scanText, `council doctor --scan-artifacts`), the PII gate (`--pii-gate`) and
// tool/fence redaction (tools.redactSecrets). Every provider format below goes through all three.
//
// Fixtures are assembled at runtime from a repeating filler, so no string in this file looks like
// a real key, and no real key appears anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../src/key-redaction.js';
import { scanForPii } from '../src/pii-gate.js';
import { redactSecrets } from '../src/tools.js';

const fill = (n, set = 'aZ3kQ9xB') => Array.from({ length: n }, (_, i) => set[i % set.length]).join('');
const hex = n => fill(n, '0a1b2c3d4e5f6789');
const j = (...parts) => parts.join('');

// [name, text containing the credential, the part that must not survive redaction]
const FORMATS = [
  ['OpenRouter', j('OPENROUTER_API_KEY=', 'sk', '-or-v1-', hex(64)), j('-or-v1-', hex(64))],
  ['OpenRouter, bare', j('key: ', 'sk', '-or-v1-', hex(64)), hex(64)],
  ['OpenAI', j('sk', '-', fill(48)), fill(48)],
  ['OpenAI project', j('sk', '-proj-', fill(40)), fill(40)],
  ['Anthropic', j('sk', '-ant-api03-', fill(40)), fill(40)],
  ['Google AI', j('AI', 'za', fill(35)), fill(35)],
  ['Groq', j('gsk', '_', fill(40)), fill(40)],
  ['Hugging Face', j('hf', '_', fill(34)), fill(34)],
  ['Together', j('TOGETHER_API_KEY=', hex(64)), hex(64)],
  ['Z.ai', j('ZAI_API_KEY=', hex(32), '.', fill(16)), fill(16)],
  ['Mistral', j('MISTRAL_API_KEY=', fill(32)), fill(32)],
  ['GitHub classic', j('gh', 'p_', fill(36)), fill(36)],
  ['GitHub fine-grained', j('github', '_pat_', fill(60)), fill(60)],
  ['Stripe live secret', j('sk', '_live_', fill(24)), fill(24)],
  ['Stripe restricted', j('rk', '_live_', fill(24)), fill(24)],
  ['Bearer header', j('Authorization: Bearer ', fill(40)), fill(40)],
  ['Bearer Groq token', j('curl -H "Bearer ', 'gsk', '_', fill(40), '"'), fill(40)],
  ['PGP private key block', j('-----BEGIN PGP ', 'PRIVATE KEY BLOCK-----\n', fill(60), '\n-----END PGP ', 'PRIVATE KEY BLOCK-----'), fill(60)],
  ['PEM private key', j('-----BEGIN ', 'PRIVATE KEY-----\n', fill(60), '\n-----END ', 'PRIVATE KEY-----'), fill(60)],
  ['URL user:pass', j('postgres://deploy:', fill(20), '@db.internal/app'), fill(20)],
  ['URL empty user', j('redis://:', fill(20), '@cache:6379'), fill(20)],
  ['camelCase AccessToken', j('AccessToken = "', fill(30), '"'), fill(30)],
  ['camelCase openAiApiKey', j('openAiApiKey: "', fill(30), '"'), fill(30)],
];

for (const [name, text, secret] of FORMATS) {
  test(`scanner (key-redaction) flags ${name}, without echoing it`, () => {
    const hits = scanText(text, 'task.md');
    assert.ok(hits.length >= 1, `not flagged: ${name}`);
    assert.equal(JSON.stringify(hits).includes(secret), false);
  });
  test(`PII gate flags ${name} as a secret`, () => {
    const { findings } = scanForPii(text);
    assert.ok(findings.some(f => f.type === 'secret'), `PII gate missed: ${name}`);
  });
  // The two context-only shapes (Together, Mistral) are also caught by redaction through their
  // env-style name.
  test(`redactSecrets removes ${name}`, () => {
    const { text: out, redacted } = redactSecrets(text);
    assert.ok(redacted >= 1, `nothing redacted: ${name}`);
    assert.equal(out.includes(secret), false, `survived redaction: ${name}`);
  });
}

test('a URL password is removed without touching the user name, even when the user contains it', () => {
  const pw = fill(20);
  const { text } = redactSecrets(j('postgres://', pw.slice(0, 6), ':', pw, '@db/app'));
  assert.equal(text, j('postgres://', pw.slice(0, 6), ':[redacted: possible secret]@db/app'));
});

test('the whole Z.ai key goes, not just the part before the dot', () => {
  const { text } = redactSecrets(j('ZAI_API_KEY=', hex(32), '.', fill(16)));
  assert.equal(text, 'ZAI_API_KEY=[redacted: possible secret]');
});

test('ordinary content stays untouched by all three', () => {
  for (const ok of [
    'const apiKey = config.apiKey;',
    'CACHE_KEY=1',
    'Built on commit 405658f9c1a2b3d4e5f6a7b8c9d0e1f2a3b4c5d6.',
    'See runs/2026-09-13T18-01-29-810Z/report.json.',
    `sha256: ${hex(64)}`,
    `md5 ${hex(32)}`,
    'https://example.com/docs/page',
  ]) {
    assert.equal(redactSecrets(ok).redacted, 0, `redaction false positive: ${ok}`);
    assert.deepEqual(scanText(ok, 'notes.md'), [], `scanner false positive: ${ok}`);
  }
});
