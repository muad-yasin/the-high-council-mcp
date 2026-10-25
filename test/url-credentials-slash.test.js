// 0.8.3 M6, Builder D, key-scan regression unit, item 3 (Haiku batch 4, A13 F2; C&C's gate of 13 Oct 2026): a raw "/" in a URL password was not detected at all (the rule's password class stops at "/"; a generated base64 password is the
// common case). A second entry now finds a password that CONTAINS "/": `scheme://user:<password with a "/">@<host-looking token>`. Guards against false positives on ordinary URLs: the text before the first "/" must not be only digits (that
// is a port, `https://registry.example.com:443/@scope/pkg`), the user part may not hold an "@" (so the `git+ssh://git@github.com:org/repo.git@v1.2.3` shape cannot match), and an "@" must be followed by a host-looking token. A secret holding "/"
// is never exempt as a placeholder (fail closed, one cost: a placeholder password with a "/" on localhost is refused). Stated residuals, pinned below as RESIDUAL rows so nobody mistakes them for coverage: a password that starts with digits
// and then a "/" (`12/ab`) reads as a port and a path; an e-mail user name together with a "/" password is not found by this entry. v0.8.2 did not find any of these either; this is a deliberate widening, like T1-4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, redactText, REDACTED } from '../src/secret-patterns.js';
import { secretShapesIn } from '../src/outbound-scan.js';

const URL_RULE = 'URL credentials (scheme://user:pass@)';
const covered = (text, opts) => findSecrets(text, opts).map(s => text.slice(s.start, s.end));
const refused = text => secretShapesIn(text, { exemptReservedHosts: true }).map(f => f.name).includes(URL_RULE);

test('USL-1 a base64-style password with "/" is found, redacted whole and refused; the host after it may end in a path, a quote, a backtick, a bracket, a line end or the end of the text', () => {
  const pw = 'Ab/cD+ef==xyz';
  for (const tail of ['db.corp.io/app', 'db.corp.io:5432/app', 'db.corp.io', 'db.corp.io"', "db.corp.io'", 'db.corp.io`', 'db.corp.io)', 'db.corp.io>', 'db.corp.io}', 'db.corp.io\n', 'db.corp.io, next', '[::1]:5432/x']) {
    const text = `x postgres://app:${pw}@${tail}`;
    assert.deepEqual(covered(text), [pw], JSON.stringify(text));
    assert.equal(redactText(text).text.includes('cD+ef'), false, `nothing of the password is left: ${JSON.stringify(text)}`);
    assert.equal(refused(text), true, JSON.stringify(text));
  }
  assert.equal(redactText(`postgres://app:${pw}@db.corp.io/app`).text, `postgres://app:${REDACTED}@db.corp.io/app`);
  // several "/" and a leading "/" in the password
  assert.deepEqual(covered('redis://:/ab/cd/ef@cache.corp.io'), ['/ab/cd/ef']);
  assert.deepEqual(covered('amqp://guest:g/u/est@broker.corp.io:5672/v'), ['g/u/est']);
});

test('USL-2 a password holding "/" is never exempt as a placeholder, not even on a reserved host (fail closed; the cost: a placeholder password with a "/" on localhost is refused)', () => {
  assert.equal(refused('postgres://u:ab/cd@localhost/db'), true);
  assert.equal(refused('postgres://u:ab/cd@127.0.0.1:5432'), true);
  assert.equal(refused('postgres://user:pass@localhost/db'), false, 'the plain placeholder is still exempt');
});

test('USL-3 NOT credentials (must not be found): a port and a path, a scoped package, a git remote with a tag, a git+ssh dependency, a plain URL with an "@" later in its path', () => {
  for (const text of [
    'https://registry.example.com:443/@scope/pkg',
    'http://host:8080/a/b@c.d/',
    'https://example.com:8080/x@y',
    'https://github.com/org/repo@v1',
    'git+https://github.com/org/repo.git@v1.0',
    'git+ssh://git@github.com:org/repo.git@v1.2.3',
    'see https://docs.example.org/page?x=1 and mail me@home.org',
    'npm i https://registry.npmjs.org:443/@babel/core/-/core-7.0.0.tgz',
  ]) assert.deepEqual(covered(text), [], `${text} holds no credential`);
});

test('USL-4 RESIDUAL (stated, not coverage): a password that starts with digits and then a "/" reads as a port and a path, and an e-mail user name with a "/" password is not found by the new entry', () => {
  assert.deepEqual(covered('postgres://u:12/ab@db.corp.io/app'), [], 'residual (a): digits then "/" is read as a port');
  assert.deepEqual(covered('smtp://me@x.org:ab/cd@smtp.corp.io'), [], 'residual (b): the user part holds an "@"');
});

test('USL-5 controls that pass at the old pattern too (must not be lost): the ordinary shapes are found exactly as before', () => {
  assert.deepEqual(covered('postgres://user:pass@localhost/db'), ['pass']);
  assert.deepEqual(covered('redis://:pw@cache.internal:6379'), ['pw']);
  assert.deepEqual(covered('postgres://u:p#ss@db/app'), ['p#ss']);
  assert.deepEqual(covered('smtp://me@gmail.com:app-pw@smtp.gmail.com:587'), ['app-pw']);
});
