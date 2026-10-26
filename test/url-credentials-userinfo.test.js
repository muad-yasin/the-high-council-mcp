// T1-4 (0.8.3 M6, Builder D; Batch 2 audit item 4): the URL-credentials pattern found no password when the USER NAME held an "@" (an e-mail address: `smtp://me@gmail.com:app-pw@smtp.gmail.com`), cut a password
// that holds an "@" at its first one (`u:p@ss@db` redacted `p` and left `ss`), and read the HOST from the first "@" after the match, so `app:pw@localhost@db.corp.io` was exempt as `localhost` by the refusal scans.
// The rule now: the userinfo runs to the LAST "@" of the authority (the authority ends at "/" or white space); the user/password split is at the FIRST ":" (a password may hold ":"); the reserved-host
// exemption looks at the real host only, and is never given to a match whose password text holds a "?" or "#" (the query-string case: `pw@db.corp.io?next=a@localhost` would otherwise read the host `localhost` and
// exempt a REAL password). Detection stays as wide as before: a password with a "?" or "#" in it is still found (UCU-7, must-find controls that pass at the old pattern too).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, redactText, REDACTED } from '../src/secret-patterns.js';
import { secretShapesIn } from '../src/outbound-scan.js';

const URL_RULE = 'URL credentials (scheme://user:pass@)';
// the text each span covers (a secret group's span is the password alone)
const covered = (text, opts) => findSecrets(text, opts).map(s => text.slice(s.start, s.end));
const refused = text => secretShapesIn(text, { exemptReservedHosts: true }).map(f => f.name);

test('UCU-1 an e-mail address as the user name: the password is found, redacted and refused (smtp://me@gmail.com:app-pw@smtp.gmail.com:587)', () => {
  const text = 'MAIL_URL=smtp://me@gmail.com:app-pw@smtp.gmail.com:587';
  assert.deepEqual(covered(text), ['app-pw']);
  assert.equal(redactText(text).text, `MAIL_URL=smtp://me@gmail.com:${REDACTED}@smtp.gmail.com:587`);
  assert.deepEqual(refused(text), [URL_RULE]);
});

test('UCU-2 a password that holds an "@" is covered whole (u:p@ss@db): no part of it stays in the redacted text', () => {
  const text = 'postgres://u:p@ss@db/app';
  assert.deepEqual(covered(text), ['p@ss']);
  assert.equal(redactText(text).text, `postgres://u:${REDACTED}@db/app`);
});

test('UCU-3 the user/password split is at the FIRST ":" - a password may hold ":" (user:pa:ss@host)', () => {
  assert.deepEqual(covered('redis://user:pa:ss@cache.internal:6379'), ['pa:ss']);
  assert.deepEqual(covered('redis://:pw@cache.internal'), ['pw'], 'an empty user, as before');
});

test('UCU-4 the reserved-host exemption looks at the REAL host: a reserved name inside the password, the path-less query or the fragment does not exempt a real credential', () => {
  for (const text of [
    'postgres://app:pw@localhost@db.corp.io/app',              // the audit's case (c): `localhost` is part of the password
    'https://user:pw@db.corp.io?next=a@localhost',             // the query string is not the host (found by the advisor before the commit)
    'https://user:pw@db.corp.io#a@localhost',
    'https://user:pw@db.corp.io:8443/x?next=a@127.0.0.1',
    'postgres://user:pw@db.corp.io@localhost/x',                 // the mirror: base read db.corp.io as the host and refused it; the last-@ reading must not turn that into a pass
    'postgres://user:pw@db.corp.io@127.0.0.1:5432/x',
  ]) assert.deepEqual(refused(text), [URL_RULE], `${text} must still be refused`);
  assert.ok(covered('https://user:pw@db.corp.io?next=a@localhost')[0].startsWith('pw@db.corp.io'), 'redaction errs high here: it covers the swallowed query string too');
  // the same placeholders on the real reserved host stay exempt, and are still found without the option (redaction)
  assert.deepEqual(refused('postgres://user:pass@localhost/db'), []);
  assert.deepEqual(refused('postgres://app:pw@db.example.com:5432/app'), []);
  assert.deepEqual(covered('postgres://user:pass@localhost/db'), ['pass']);
  assert.deepEqual(refused('smtp://me@gmail.com:app-pw@localhost:1025'), [], 'an e-mail user on a reserved host is a placeholder like any other');
});

test('UCU-5 no new false positives: a URL with no credentials, a port, an "@" in the path, a git remote and a plain e-mail address are not matches', () => {
  for (const text of [
    'https://example.com:8080/a@b',
    'http://a@b.com:8080/x',
    'ssh://git@github.com:22',
    'https://github.com/org/repo',
    'see https://docs.example.org/page?x=1 and mail me@home.org',
    'mailto:me@home.org',
  ]) assert.deepEqual(covered(text), [], `${text} holds no credential`);
});

test('UCU-7 controls (pass at the OLD pattern too, must not be lost): a password with "?" or "#" in it is still found, and still redacted whole', () => {
  for (const [text, pw] of [['postgres://u:p#ss@db/app', 'p#ss'], ['redis://:p?ss@cache', 'p?ss'], ['amqp://guest:g?u#est@broker:5672/v', 'g?u#est']]) {
    assert.deepEqual(covered(text), [pw], text);
    assert.deepEqual(refused(text), [URL_RULE], text);
    assert.equal(redactText(text).text.includes(pw), false, text);
  }
});

test('UCU-8 the exemption needs a password with none of "@", "?" or "#": a placeholder password on a reserved host is exempt; one that holds an "@" is refused even on localhost (fail closed - parsers disagree which "@" ends the userinfo)', () => {
  assert.deepEqual(refused('postgres://user:pass@localhost/db'), []);
  assert.deepEqual(refused('redis://:pw@127.0.0.1:6379'), []);
  assert.deepEqual(refused('smtp://me@gmail.com:app-pw@localhost:1025'), [], 'an e-mail user name is not the password');
  assert.deepEqual(refused('postgres://u:p@ss@localhost/db'), [URL_RULE], 'a password holding an "@" is never taken for a placeholder');
  assert.deepEqual(covered('postgres://user:pw@db.corp.io@localhost/x'), ['pw@db.corp.io'], 'redaction covers the whole run up to the last "@"');
});
