// 0.8.3 M6, Builder D, the key-scan regression unit (Haiku batch 4, notice 2, group D; C&C's gate of 13 Oct 2026): the reserved-host exemption (Muad, 12 Oct: reserved placeholder hosts only; 4e9b2a3, NOT in v0.8.2)
// read the WRONG HOST in several URL shapes, so a real password passed the refusal scans that v0.8.2 applied. The rule now: the exemption needs EVERY host of the authority (a comma list, a libpq `host=` / `hostaddr=`
// parameter) to be a plain reserved placeholder host, and a clean userinfo; anything else in a member (`\`, `;`, `%`, an empty member) means the URL is refused, as in v0.8.2. The trap the gate named: adding "," to the
// host read's stop set would turn the refused `localhost,prod.corp.io` into a pass; the second trap: stopping at a backslash would turn the refused `localhost\x.corp.io` into a pass. Both are control rows here.
// Part 3 is the DIFF TEST against v0.8.2's own URL rule (fixture below, copied from `git show v0.8.2:src/secret-patterns.js` line 59 and cited by that name): for every URL in one corpus whose password holds no "/", the
// refusal set of the refusal scan is identical to v0.8.2's, EXCEPT the URLs the exemption was meant to let through (every host reserved, userinfo clean), which are listed by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, redactText } from '../src/secret-patterns.js';
import { secretShapesIn } from '../src/outbound-scan.js';

const URL_RULE = 'URL credentials (scheme://user:pass@)';
const refused = text => secretShapesIn(text, { exemptReservedHosts: true }).map(f => f.name).includes(URL_RULE);
const found = text => findSecrets(text).length > 0;

test('UCH-1 comma host lists (the audit\'s two URLs): a reserved LAST member or a reserved FIRST member does not exempt a real password; the trap rows stay refused; a list of only reserved hosts is exempt', () => {
  for (const url of [
    'mongodb://app:RealPw@prod.corp.io,db.example.com/?replicaSet=rs',          // last member reserved
    'postgresql://app:RealPw@localhost:5432,db.corp.io:5432/app',               // first member reserved, with a port
    'postgresql://app:RealPw@[::1]:5432,db.corp.io:5432/app',
    'mongodb://app:RealPw@a.corp.io,b.test.com,db.example.com/',
  ]) assert.equal(refused(url), true, `${url} must be refused`);
  // the trap rows: refused today, refused after (a "," in the stop set would pass the first)
  for (const url of ['pg://u:RealPw@localhost,prod.corp.io/db', 'pg://u:RealPw@prod.corp.io:5432,localhost:5432/db', 'pg://u:RealPw@localhost,/db', 'pg://u:RealPw@,localhost/db'])
    assert.equal(refused(url), true, `${url} must stay refused`);
  // every member reserved: exempt, as the ruling intends
  for (const url of ['pg://u:pw@localhost:5432,127.0.0.1:5432/db', 'pg://u:pw@[::1]:5432,db.example.com/db', 'mongodb://u:pw@a.example.com,b.example.org,localhost/'])
    assert.equal(refused(url), false, `${url} is all placeholders`);
});

test('UCH-2 IPv6 brackets (C&C add 3): `[::1]` alone and a list of `[::1]` members are exempt; `[::1]` next to a real host is refused; the bracket stays inside the member', () => {
  assert.equal(refused('pg://u:pw@[::1]/db'), false);
  assert.equal(refused('pg://u:pw@[::1],prod.corp.io/db'), true);
  assert.equal(refused('pg://u:pw@[::1]:5432,[::1]:5433/db'), false);
  assert.equal(refused('pg://u:RealPw@prod.corp.io,[::1]/db'), true);
  assert.equal(refused('pg://u:RealPw@[::2]/db'), true, 'another literal is not the loopback');
  assert.equal(refused('pg://u:RealPw@[::1]]/db'), true, 'a stray "]" is not a plain member');
});

test('UCH-3 the host must be a PLAIN host: a backslash, a semicolon, a percent sign or any other character inside a member means no exemption (the "stop at backslash" trap, `localhost\\x.corp.io`)', () => {
  for (const url of [
    'pg://u:RealPw@localhost\\x.corp.io/db',        // stopping the read at "\" would read `localhost` and pass
    'pg://u:RealPw@localhost;db.corp.io/db',
    'pg://u:RealPw@localhost%2Fx.corp.io/db',
    'https://u:RealPw@api.corp.io\\x.localhost',    // WHATWG ends the authority at "\": the host is api.corp.io
    'https://u:RealPw@localhost$HOST/db',
  ]) assert.equal(refused(url), true, `${url} must be refused`);
});

test('UCH-4 a "?" or "#" or "\\" in the USER part, and libpq `host=` / `hostaddr=` parameters: any non-reserved host named means no exemption (item 2)', () => {
  for (const url of [
    'https://api.corp.io?k=:RealPw@localhost',                                  // the "?" is in the user part: parsed, the password is in the query sent to api.corp.io
    'https://api.corp.io#k=:RealPw@localhost',
    'postgresql://app:RealPw@localhost/app?host=db.corp.io',
    'postgresql://app:RealPw@localhost/app?hostaddr=10.0.0.5',
    'postgresql://app:RealPw@localhost/app?sslmode=x&host=db.corp.io',          // host as the second parameter
    'postgresql://app:RealPw@localhost/app?host=localhost&host=db.corp.io',     // a repeated host=
    'postgresql://app:RealPw@localhost/a/b/c?x=1#frag?host=db.corp.io',
    'postgresql://app:RealPw@localhost/app?host=localhost,db.corp.io',
    'postgresql://app:RealPw@localhost/app?host=',                              // an empty value is not a reserved host
  ]) assert.equal(refused(url), true, `${url} must be refused`);
  assert.equal(refused('postgresql://app:pw@localhost/app?host=localhost'), false, 'a libpq host that is itself reserved changes nothing');
  assert.equal(refused('postgresql://app:pw@localhost/app?sslmode=require&hostaddr=127.0.0.1'), false);
  assert.equal(refused('smtp://me@gmail.com:app-pw@localhost:1025'), false, 'an e-mail user name stays allowed (T1-4 ruling)');
});

test('UCH-5 where a URL ENDS in real text (JSON, YAML, .env, markdown, a sentence): the host read ends at the closing character, so a clean placeholder stays exempt and a real host stays refused', () => {
  const shapes = host => [`pg://u:pw@${host}`, `"pg://u:pw@${host}"`, `'pg://u:pw@${host}'`, `\`pg://u:pw@${host}\``, `(pg://u:pw@${host})`, `<pg://u:pw@${host}>`, `{"url":"pg://u:pw@${host}"}`, `DB=pg://u:pw@${host}\n`, `see pg://u:pw@${host}/db and more`];
  for (const t of shapes('localhost')) assert.equal(refused(t), false, `${JSON.stringify(t)} is a placeholder`);
  for (const t of shapes('localhost:5432')) assert.equal(refused(t), false, `${JSON.stringify(t)} is a placeholder with a port`);
  for (const t of shapes('prod.corp.io')) assert.equal(refused(t), true, `${JSON.stringify(t)} is a real host`);
  for (const t of shapes('localhost,prod.corp.io')) assert.equal(refused(t), true, `${JSON.stringify(t)} has a real member`);
});

// ---- the DIFF TEST against v0.8.2 ------------------------------------------------------------------------------------------------------------------------------------------------------
// v0.8.2's URL rule, copied as a fixture: `git show v0.8.2:src/secret-patterns.js`, line 59. v0.8.2 had NO exemption, so a URL it matched was refused.
const V082_URL_RULE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:(?<secret>[^\s/@]+)@/i;   // the original has the flags dgi; `g` is dropped here so .test() keeps no state between URLs
const v082Refuses = text => V082_URL_RULE.test(text);

// One corpus: [url, exempt on purpose]. exempt = every host is a reserved placeholder host and the userinfo is clean (Muad's 12 Oct ruling). Every URL's password holds no "/".
const CORPUS = [
  // items 1-2 shapes
  ['mongodb://app:RealPw@prod.corp.io,db.example.com/?replicaSet=rs', false],
  ['postgresql://app:RealPw@localhost:5432,db.corp.io:5432/app', false],
  ['https://u:RealPw@api.corp.io\\x.localhost', false],
  ['postgresql://app:RealPw@localhost/app?host=db.corp.io', false],
  ['postgresql://app:RealPw@localhost/app?hostaddr=10.0.0.5', false],
  ['pg://u:RealPw@localhost\\x.corp.io/db', false],
  ['pg://u:RealPw@localhost;db.corp.io/db', false],
  ['pg://u:RealPw@localhost,prod.corp.io/db', false],
  ['pg://u:RealPw@prod.corp.io:5432,localhost:5432/db', false],
  ['pg://u:pw@[::1],prod.corp.io/db', false],
  // the existing reserved-host fixtures (RES-2's lists and UCU-4 / UCU-8)
  ['postgres://user:pass@localhost/db', true], ['postgres://user:pass@LOCALHOST/db', true], ['postgres://user:pass@localhost:5432/db', true], ['postgres://user:pass@127.0.0.1/db', true],
  ['redis://:pw@127.0.0.1:6379', true], ['postgres://user:pass@[::1]:5432/db', true], ['postgres://user:pass@example.com/db', true], ['postgres://user:pass@db.example.com:5432/db', true],
  ['postgres://user:pass@x.test/db', true], ['postgres://user:pass@a.b.example.org/db', true], ['postgres://user:pass@localhost./db', true], ['redis://:pw@cache.internal:6379', false],
  ['postgres://user:pass@db.internal/db', false], ['postgres://user:pass@localhost.evil.com/db', false], ['postgres://user:pass@example.com.evil.io/db', false], ['postgres://user:pass@notlocalhost/db', false],
  ['postgres://user:pass@127.0.0.2/db', false], ['postgres://user:pass@10.0.0.5/db', false], ['postgres://user:pass@test.com/db', false],
  ['postgres://app:pw@localhost@db.corp.io/app', false], ['postgres://user:pw@db.corp.io@localhost/x', false], ['https://user:pw@db.corp.io?next=a@localhost', false], ['https://user:pw@db.corp.io#a@localhost', false],
  ['postgres://u:p@ss@localhost/db', false],
];

test('UCH-6 DIFF TEST vs v0.8.2 (fixture: `git show v0.8.2:src/secret-patterns.js` line 59): on one corpus (every password holds no "/"), the refusal scan refuses exactly what v0.8.2 refused, EXCEPT the URLs meant to be exempt (every host reserved, userinfo clean), which are named', () => {
  const sameAsOld = [];
  const exemptOnPurpose = [];
  for (const [url, exempt] of CORPUS) {
    assert.equal(v082Refuses(url) || false, true, `v0.8.2 refused ${url} (the corpus holds only passwords it refused)`);
    if (exempt) { exemptOnPurpose.push(url); assert.equal(refused(url), false, `${url} is the exemption's purpose`); }
    else { sameAsOld.push(url); assert.equal(refused(url), v082Refuses(url), `${url}: the refusal must equal v0.8.2's`); }
  }
  assert.ok(sameAsOld.length >= 20 && exemptOnPurpose.length >= 10, `corpus size ${sameAsOld.length} + ${exemptOnPurpose.length}`);
});

test('UCH-7 redaction and the default scan are untouched by the host rule: a real password on a list or a placeholder is still found and redacted when the exemption is not asked for', () => {
  const text = 'postgresql://app:RealPw@localhost:5432,db.corp.io:5432/app';
  assert.equal(found(text), true);
  assert.equal(redactText(text).text.includes('RealPw'), false);
  assert.equal(found('postgres://user:pass@localhost/db'), true, 'without the option a placeholder is still found (redaction must hide it)');
});
