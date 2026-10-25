// 0.8.3 M6, Builder D, key-scan regression unit, item 4 + C&C's add 2 (Haiku batch 4, A13 F3): the URL-userinfo rule had THREE copies in src/ (src/secret-patterns.js, src/providers.js's redactUrlCredentials, src/advice-brief.js's
// ORIGIN lookahead) and two of them went stale: providers.js stopped at the first "@" (`https://u:p@ss@host/x` left `ss@host`), and neither knew a "/" in the password (`https://u:Ab/cd@host/x` passed in clear into error text and run
// logs). There is now ONE rule, in src/secret-patterns.js: `maskUrlUserinfo(text)` (what providers.js calls) and `hasUrlUserinfo(text)` (what the advice brief's origin check calls). Part 3 is the SCANNER that makes a fourth copy
// impossible: no regular expression in src/ outside secret-patterns.js may read the userinfo of a URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactUrlCredentials } from '../src/providers.js';
import * as SECRET_PATTERNS_MODULE from '../src/secret-patterns.js';
// reached by namespace so the file loads on a parent that does not export them yet: the missing name is an assertion failure, not an import error
const needed = name => typeof SECRET_PATTERNS_MODULE[name] === 'function' ? SECRET_PATTERNS_MODULE[name] : () => assert.fail(`src/secret-patterns.js does not export ${name}`);
const maskUrlUserinfo = text => needed('maskUrlUserinfo')(text);
const hasUrlUserinfo = text => needed('hasUrlUserinfo')(text);
import { ADVICE_BRIEF } from '../src/advice-brief.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');

test('UUS-1 the provider error masks the WHOLE userinfo up to the last "@" before the host, including a "/" in the password; the old shapes are unchanged', () => {
  const cases = [
    ['fetch http://admin:pw@host:1/v1 failed', 'fetch http://[redacted]@host:1/v1 failed'],      // the old case (providers-audit #6)
    ['https://u:p@ss@host/x', 'https://[redacted]@host/x'],                                      // a second "@" used to leave `ss@host`
    ['https://u:Ab/cd+ef==@host/x', 'https://[redacted]@host/x'],                                // a "/" in the password used to pass in clear
    ['retry https://token@github.com/org failed', 'retry https://[redacted]@github.com/org failed'],   // a user-only credential is masked as before
    ['smtp://me@gmail.com:app-pw@smtp.gmail.com:587 refused', 'smtp://[redacted]@smtp.gmail.com:587 refused'],
  ];
  for (const [input, want] of cases) assert.equal(redactUrlCredentials(input), want, input);   // the behaviour rows come first: the name the parent has
  for (const same of ['https://host/v1 ok', 'https://api.corp.io/v1 contact me@x.org', 'no url here: a@b.c', 'https://example.com:8080/x@y']) assert.equal(redactUrlCredentials(same), same, same);
  for (const [input, want] of cases) assert.equal(maskUrlUserinfo(input), want, input);    // and the shared function itself gives the same answers
});

const brief = origin => ({
  schema_version: 'advice-brief/1', moment: 'before_commit', question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy', result: 'It passed in 3 seconds.' }], sensitivity: 'internal', not_included: ['the conversation'],
  excerpts: [{ label: 'a', kind: 'doc', origin, why_needed: 'The question is about this line.', text: 'owner = invoices' }],
});

test('UUS-2 the advice brief\'s origin check uses the same rule: a "/" in the password and a second "@" are refused like any credentials in a URL; a plain URL and a path pass', () => {
  for (const bad of ['https://user:pw@host.example/x', 'https://u:Ab/cd@host.example/x', 'https://u:p@ss@host.example/x', 'ssh://git@github.com/org/repo'])
    assert.equal(ADVICE_BRIEF.safeParse(brief(bad)).success, false, `${bad} carries credentials`);
  for (const ok of ['https://docs.example.org/page', 'src/a.js', 'the README, section 3', 'https://github.com/org/repo@v1', 'https://registry.example.com:443/@scope/pkg'])
    assert.equal(ADVICE_BRIEF.safeParse(brief(ok)).success, true, `${ok} is fine`);
  assert.equal(hasUrlUserinfo('https://github.com/org/repo@v1'), false);
  assert.equal(hasUrlUserinfo('ssh://git@github.com/org/repo'), true, 'the old origin rule refused any userinfo; it still does');
});

// The comparator behind UUS-4, a function so UUS-5 can prove it is able to report a difference (C&C follow-up on the key-scan PASS, 14 Oct 2026: a check that passes at the parent AND the tip is evidence only if it can fail).
const OLD_ORIGIN_CREDENTIAL = /^.*:\/\/[^/\s]*@/;                                         // the lookahead `(?!.*:\/\/[^/\s]*@)` of ORIGIN, `git show 5b3a9e1:src/advice-brief.js` line 40
const OLD_MASK = text => String(text).replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@');   // `git show 5b3a9e1:src/providers.js` line 961
const UUS4_CORPUS = [
  'https://user:pw@host.example/x', 'http://u@h', 'ssh://git@github.com/org/repo', 'postgres://u:p@w@h', 'HTTPS://U:PW@H', 'git+ssh://git@h/x', 'foo.bar://u:p@h', 'mailto://x@y', 'see a://b@c', 'https://h/x?u=a://b@c',
  'x_https://u:pw@h', '1https://u:pw@h', '://u:pw@h', 'http://@h', 'xhttps://u:pw@h',      // the prefix shapes: no word boundary before the scheme, no scheme at all, an empty user part
  'https://docs.example.org/page', 'src/a.js', 'https://github.com/org/repo@v1', 'https://registry.example.com:443/@scope/pkg',   // controls: not credentials
];
// per text: what the OLD rules did and what the given NEW rules do
const compare = (text, now) => ({ text, oldRefuses: OLD_ORIGIN_CREDENTIAL.test(text), newRefuses: now.refuses(text), oldMasks: OLD_MASK(text) !== text, newMasks: now.masks(text) !== text });
const REAL_RULES = { refuses: text => ADVICE_BRIEF.safeParse(brief(text)).success === false, masks: redactUrlCredentials };
// the texts where the OLD rules refused or hid and the NEW ones do not: the regressions UUS-4 must find none of
const regressions = (corpus, now) => corpus.map(t => compare(t, now)).filter(c => (c.oldRefuses && !c.newRefuses) || (c.oldMasks && !c.newMasks)).map(c => c.text);

test('UUS-4 DIFF TEST vs the old rules (5b3a9e1): everything the advice brief\'s old origin lookahead refused is still refused, and everything the old provider mask hid is still hidden, on one corpus that includes the prefix shapes the old lookahead caught', () => {
  assert.deepEqual(regressions(UUS4_CORPUS, REAL_RULES), [], 'the new rules lost something the old ones caught');
  const rows = UUS4_CORPUS.map(t => compare(t, REAL_RULES));
  const refusedBefore = rows.filter(r => r.oldRefuses).length;
  const maskedBefore = rows.filter(r => r.oldMasks).length;
  assert.ok(refusedBefore >= 14 && maskedBefore >= 9, `corpus reach ${refusedBefore} / ${maskedBefore}`);
});

test('UUS-5 UUS-4 can FAIL (known-bad rows): rules that lose what the old ones caught are reported, and a URL where the new and the old rules MUST disagree (a "/" in the password, item 3) is reported as a difference', () => {
  // (a) deliberately broken NEW rules: nothing refused, nothing masked. Every text the old rules caught must come back as a regression.
  const broken = { refuses: () => false, masks: t => t };
  const lost = regressions(UUS4_CORPUS, broken);
  assert.ok(lost.length >= 14, `the comparator reported ${lost.length} regressions for rules that catch nothing`);
  assert.ok(lost.includes('https://user:pw@host.example/x') && lost.includes('postgres://u:p@w@h'));
  // (b) rules that lose ONE thing (the mask forgets a second "@") are reported as exactly that text
  const forgetful = { refuses: REAL_RULES.refuses, masks: t => (t === 'postgres://u:p@w@h' ? t : redactUrlCredentials(t)) };
  assert.deepEqual(regressions(UUS4_CORPUS, forgetful), ['postgres://u:p@w@h']);
  // (c) the item-3 URL: the OLD rules saw nothing (the password holds a "/"), the NEW ones refuse and mask it. A comparator that reports no difference here would be blind to the change.
  const itemThree = compare('https://u:Ab/cd@host.example/x', REAL_RULES);
  assert.deepEqual([itemThree.oldRefuses, itemThree.newRefuses, itemThree.oldMasks, itemThree.newMasks], [false, true, false, true]);
});

test('UUS-3 SCANNER: no regular expression in src/ outside src/secret-patterns.js reads the userinfo of a URL (a "://" followed, on the same line, by an "@" inside a pattern) - three copies were found, the rule lives in one place', () => {
  const files = [];
  const walk = d => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f); } };
  walk(SRC);
  const own = join(SRC, 'secret-patterns.js');
  const hits = [];
  for (const f of files) {
    if (f === own) continue;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;                                  // a comment line
      if (/:\\\/\\\/[^\n]*@/.test(l) || /RegExp\([^\n]*:\/\/[^\n]*@/.test(l)) hits.push(`${relative(SRC, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `a second copy of the URL-userinfo rule: ${hits.join(', ')} (use maskUrlUserinfo / hasUrlUserinfo from src/secret-patterns.js)`);
});
