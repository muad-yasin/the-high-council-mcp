// The reserved-placeholder exemption (0.8.3 M6 S5b, Part E; Muad's choice, C&C 12 Oct): a password in a URL on a RESERVED placeholder host (localhost, 127.0.0.1, ::1, example.com/.net/.org and their subdomains, the
// .test .example .invalid .localhost names) is not secret-shaped, and an e-mail address on a reserved example domain is not personal data. ONE list (src/secret-patterns.js), imported by src/pii-gate.js; scope = the HOST position of the
// URL-credentials match only (a filter after the match, so the named `secret` group and the redactor keep working); NOT an override. Every other host, every provider key format, Bearer tokens and named
// assignments are checked as before. The "reds" are the NORMAL run's: the same text was refused before and passes now; the control hosts stay refused (a suffix match on the wrong end is the obvious bug).
// FIX-UP (C&C ruling 12 Oct, after the advice-mask probe): the exemption is an OPTION (`exemptReservedHosts`, default OFF) passed ONLY by the refusal scans (the input scan, the PII gate); redaction and masking never pass it, so a real password on
// `localhost` in text that is redacted or leaves the machine is still hidden (RES-3 flipped, RES-6, RES-7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secretShapesIn } from '../src/outbound-scan.js';
import { redactText } from '../src/secret-patterns.js';
import { redactSecrets } from '../src/tools.js';
import { scanText } from '../src/key-redaction.js';
import { mask } from '../src/advice-mask.js';
import { scanForPii } from '../src/pii-gate.js';
import { cli } from './helpers/tree-fixture.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const url = host => `DATABASE_URL=postgres://user:pass@${host}/db`;
// the INPUT scan's question (the refusal scans pass the option; the default is off, RES-6)
const hits = text => secretShapesIn(text, { exemptReservedHosts: true }).map(f => f.name);

test('RES-1 the normal run: a password in a URL on `localhost` was refused before and passes now; on `db.internal` and on `localhost.evil.com` it stays refused (exit 11, the control cases)', () => {
  for (const [host, status] of [['localhost', 0], ['db.internal', 11], ['localhost.evil.com', 11]]) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-res-')); made.push(dir); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 'x.md'), `Plan a tiny change. Config: ${url(host)}\n`);
// CHANGED ACCEPTED (19 Okt 2026, PII stop unit): OLD no setting = the gate warned, so the key scan refused first. NEW the default is the stop and the PII gate also reads user:pass@host as an e-mail and comes first; this file tests the KEY SCAN, so its spawns run under the user-set `COUNCIL_PII_GATE=warn` (the user's own shell env: the one place a standing warn may come from).
    const r = spawnSync(process.execPath, [cli, '--task', 'tasks/x.md', '--chain', 'mock', '--max-usd', '5'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, COUNCIL_PII_GATE: 'warn' }, timeout: 120_000 });
    assert.equal(r.status, status, `${host}: ${r.stderr}`);
    if (status === 11) assert.match(r.stderr, /OUTBOUND KEY SCAN: refusing to run - 1 credential-shaped string\(s\)/);
  }
});

test('RES-2 the host position only, matched at the END with a dot boundary: the reserved names pass (with a port, a path, upper case, a bracketed ::1, a trailing dot, an empty user), every look-alike and every other host stays refused', () => {
  const passes = ['localhost', 'LOCALHOST', 'localhost:5432', '127.0.0.1', '127.0.0.1:6379', '[::1]', '[::1]:5432', 'example.com', 'example.net', 'example.org', 'db.example.com', 'a.b.example.org', 'db.test', 'x.example', 'x.invalid', 'db.localhost', 'localhost.'];
  for (const host of passes) assert.deepEqual(hits(url(host)), [], `${host} is a reserved placeholder host`);
  const refused = ['db.internal', 'localhost.evil.com', 'example.com.evil.io', 'notlocalhost', 'localhosts', 'myexample.com', 'example.comx', '127.0.0.2', '10.0.0.5', 'test.com', 'evil.test.com', 'db.example.com.evil.io', 'prod-db.corp'];
  for (const host of refused) assert.deepEqual(hits(url(host)), ['URL credentials (scheme://user:pass@)'], `${host} is NOT reserved`);
  assert.deepEqual(hits('redis://:pw@127.0.0.1:6379'), [], 'an empty user on a reserved host');
  assert.deepEqual(hits('redis://:pw@cache.internal:6379'), ['URL credentials (scheme://user:pass@)']);
});

test('RES-3 nothing else changed: provider key formats, Bearer tokens and named assignments are still found, also in a text that mentions localhost; the redactor redacts the password of a URL on any other host AND on a reserved host (edited in the fix-up: it used to leave a reserved host alone; redaction never exempts)', () => {
  const key = ['sk', '-ant-api03-', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0'].join('');
  assert.equal(hits(`connect to localhost with ${key}`).length, 1, 'a provider key next to a reserved host');
  assert.deepEqual(hits(`Authorization: Bearer ${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5'}`), ['Bearer token']);
  assert.deepEqual(hits('password = "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0"'), ['named credential assignment']);
  assert.deepEqual(hits(`export DEPLOY_TOKEN="abcdEFGH1234ijklMNOP5678" # postgres://user:pass@localhost/db`), ['named credential assignment']);
  const other = redactText('postgres://user:pass@db.internal/db'); assert.equal(other.redacted, 1); assert.match(other.text, /^postgres:\/\/user:\[redacted: possible secret\]@db\.internal\/db$/, 'the named secret group still marks only the password');
  // old (e2d329f): assert.deepEqual(reserved, { text: 'postgres://user:pass@localhost/db', redacted: 0 }); new: a real password on localhost is redacted like any other
  const reserved = redactText('postgres://user:pass@localhost/db'); assert.deepEqual(reserved, { text: 'postgres://user:[redacted: possible secret]@localhost/db', redacted: 1 });
});

test('RES-4 the PII gate: an e-mail address on a reserved example domain is not personal data; look-alike domains and every other domain stay findings; the types iban and card and the allow-list are unchanged', () => {
  const types = text => scanForPii(text).findings.map(f => f.type);
  for (const addr of ['admin@example.com', 'a@example.net', 'a@example.org', 'a@db.example.com', 'a@x.test', 'a@x.example', 'a@x.invalid', 'a@x.localhost', 'ADMIN@EXAMPLE.COM']) assert.deepEqual(types(`Contact ${addr} for details.`), [], `${addr} is a reserved example address`);
  for (const addr of ['admin@example.com.evil.io', 'admin@db.internal', 'jane.doe@gmail.com', 'a@myexample.com', 'a@test.com', 'a@evil.test.com', 'a@example.comx']) assert.deepEqual(types(`Contact ${addr} for details.`), ['email'], `${addr} is a real-looking address`);
  assert.deepEqual(types('Bank: IBAN DE89370400440532013000.'), ['iban']);
  assert.deepEqual(scanForPii('Contact jane.doe@gmail.com', { allow: ['email'] }).suppressed, ['email'], 'the allow-list still shows its suppression');
  assert.deepEqual(types('postgres://user:pass@db.internal/db'), ['email', 'secret'], 'the secret type of the gate reads the same list: another host is still found (the URL also reads as an address, as it did before)');
  assert.deepEqual(types('postgres://user:pass@localhost/db'), [], 'and a reserved one is not');
});

test('RES-5 ONE list in ONE module: src/secret-patterns.js defines RESERVED_PLACEHOLDER_HOSTS once and src/pii-gate.js imports it; no other file keeps a copy of the names (the pii-gate has no phone or IP rule, so none is added)', () => {
  const src = rel => readFileSync(join(import.meta.dirname, '..', 'src', rel), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal((src('secret-patterns.js').match(/export const RESERVED_PLACEHOLDER_HOSTS\b/g) ?? []).length, 1);
  assert.match(src('pii-gate.js'), /import \{[^}]*\bisReservedPlaceholderHost\b[^}]*\} from '\.\/secret-patterns\.js'/);
  for (const f of ['pii-gate.js', 'outbound-scan.js', 'key-redaction.js', 'run-preflight.js', 'cli.js']) assert.equal(/example\.(com|net|org)/.test(src(f)), false, `${f} keeps its own copy of the reserved names`);
  assert.equal(/\bphone\b|\bipv4\b|RFC ?5737|555-01/i.test(src('pii-gate.js')), false, 'no new phone or IP rule');
});

test('RES-6 the exemption is OFF by default: only a refusal scan that passes `exemptReservedHosts` skips a reserved host; masking, redaction, the artifact scanner and the advice send path\'s own key scan still see a password on `localhost`', () => {
  const text = 'Config: postgres://user:realpw@localhost/db';
  assert.deepEqual(secretShapesIn(text).map(f => f.name), ['URL credentials (scheme://user:pass@)'], 'the default scan finds it');
  assert.deepEqual(secretShapesIn(text, { exemptReservedHosts: true }), [], 'a refusal scan that asks for the exemption does not');
  assert.equal(secretShapesIn(text, { everyContext: true }).length, 1, 'the advice send path scans with everyContext and no exemption: its brief leaves the machine');
  assert.equal(scanText(text).length, 1, 'the artifact scanner (council doctor --scan-artifacts) has no exemption by default');
  assert.equal(scanText(text, '', { exemptReservedHosts: true }).length, 0, 'the PII gate asks for it');
  const masked = mask(text, { repoRoot: null }).text;
  assert.equal(masked.includes('realpw'), false, `the advice masker hides a real password on localhost: ${masked}`);
  const redacted = redactSecrets(text);
  assert.equal(redacted.text.includes('realpw'), false, 'tools.redactSecrets (fence and MCP file reads) hides it');
  assert.equal(redacted.redacted, 1);
});

test('RES-7 only the refusal scans ask for the exemption: the files that pass `exemptReservedHosts: true` are exactly the input-scan callers and the PII gate (a redaction caller added later cannot pick it up by accident)', () => {
  const strip = f => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const srcFiles = readdirSync(join(import.meta.dirname, '..', 'src'), { recursive: true }).filter(f => f.endsWith('.js'));
  const passers = srcFiles.filter(f => /exemptReservedHosts\s*:\s*true/.test(strip(f))).sort();
  // 14 Oct 2026: stage-submission.js joined (submit_stage's answer scan and prepare_stage_prompt's bundle scan): a small file that only REFUSES on input, never redacts.
  assert.deepEqual(passers, ['cli.js', 'pii-gate.js', 'run-preflight.js', 'stage-submission.js'], `the files that pass the exemption: ${JSON.stringify(passers)}`);
});
