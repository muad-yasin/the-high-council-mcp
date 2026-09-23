// test/name-lint.test.js
//
// v6 §6: public naming. This suite proves the SCANNER MECHANISM works -
// recursive, hash-based, extensible, fails loudly - using synthetic,
// clearly-fictional test names invented for this file. It never contains,
// tests against, or references any real third-party name; that guarantee
// depends on whatever forbidden list an operator loads locally (see
// PERSONAS.md), which this repository does not and cannot ship.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashName, loadForbiddenHashes, scanForForbiddenNames, DEFAULT_FORBIDDEN_HASHES } from '../src/name-lint.js';
import { DEFAULT_PERSONAS, loadPersonas, resolvePersona } from '../src/personas.js';

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-name-lint-'));
  return { dir, write: (rel, body) => { const p = join(dir, rel); mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(p, body); } };
}

test('DEFAULT_FORBIDDEN_HASHES ships empty - this repo carries no third-party name of its own', () => {
  assert.deepEqual(DEFAULT_FORBIDDEN_HASHES, []);
});

test('scanForForbiddenNames: a planted synthetic name is found, with file and line', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/example.md', 'Nothing here.\nThis line mentions Zorblax Prime by accident.\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 2);
    assert.equal(findings[0].span, 'Zorblax Prime');
    assert.match(findings[0].file, /docs[/\\]example\.md$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The exact regression class named in tonight's finding: a v5 guard that
// wasn't truly recursive missed src/mcp/ and src/ui/. This plants the same
// synthetic name several directories deep, in file types the real repo
// actually ships (a .js source file, not just docs), and asserts the
// scanner still finds it.
test('scanForForbiddenNames: recurses into every nested directory, not a hand-picked subset', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('src/mcp/server.js', "// a comment mentioning Zorblax Prime by accident\nexport const x = 1;\n");
    write('src/ui/deep/nested/component.js', "const label = 'Zorblax Prime';\n");
    write('chains/example.json', '{"description": "Zorblax Prime chain"}');
    write('tasks/example.md', 'Build something for Zorblax Prime.');
    write('test/example.test.js', "// Zorblax Prime\n");
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings, filesScanned } = scanForForbiddenNames(dir, hashes);
    const foundIn = findings.map(f => f.file);
    assert.ok(foundIn.some(f => f.includes(join('src', 'mcp', 'server.js'))), 'must find a match in src/mcp/');
    assert.ok(foundIn.some(f => f.includes(join('src', 'ui', 'deep', 'nested', 'component.js'))), 'must find a match nested several directories deep in src/ui/');
    assert.ok(foundIn.some(f => f.includes(join('chains', 'example.json'))), 'must scan chain configs');
    assert.ok(foundIn.some(f => f.includes(join('tasks', 'example.md'))), 'must scan task fixtures');
    assert.ok(foundIn.some(f => f.includes(join('test', 'example.test.js'))), 'must scan test files');
    assert.equal(filesScanned, 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForForbiddenNames: node_modules, .git, and runs/ are never walked', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('node_modules/pkg/index.js', 'Zorblax Prime');
    write('.git/COMMIT_EDITMSG', 'Zorblax Prime');
    write('runs/2026-01-01T00-00-00-000Z/report.json', '{"note": "Zorblax Prime"}');
    write('src/real.js', '// clean file, nothing here');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.deepEqual(findings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForForbiddenNames: a clean repo (against a real name) produces zero findings', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('README.md', 'This project has nothing to hide.\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.deepEqual(findings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForForbiddenNames: an empty forbidden set never scans a single file - nothing to check against', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/example.md', 'Anything at all.');
    const { findings, filesScanned } = scanForForbiddenNames(dir, new Set());
    assert.deepEqual(findings, []);
    assert.equal(filesScanned, 0, 'must short-circuit before walking the tree when there is nothing to check');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadForbiddenHashes: an operator-local file adds hashes; the plain names never appear in the returned value', () => {
  const { dir, write } = fixtureRepo();
  try {
    const listPath = join(dir, 'forbidden.json');
    writeFileSync(listPath, JSON.stringify(['Zorblax Prime', 'Vexmoor']));
    const hashes = loadForbiddenHashes({ forbiddenNamesFile: listPath });
    assert.ok(hashes.has(hashName('Zorblax Prime')));
    assert.ok(hashes.has(hashName('Vexmoor')));
    assert.ok([...hashes].every(h => /^[0-9a-f]{64}$/.test(h)), 'every entry must be a hex SHA-256 digest, never plain text');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadForbiddenHashes: a missing or unreadable operator file degrades to the default set, never throws', () => {
  assert.doesNotThrow(() => loadForbiddenHashes({ forbiddenNamesFile: '/no/such/file.json' }));
  const hashes = loadForbiddenHashes({ forbiddenNamesFile: '/no/such/file.json' });
  assert.deepEqual(hashes, new Set(DEFAULT_FORBIDDEN_HASHES));
});

test('loadForbiddenHashes: with no file configured at all, returns exactly the default (empty) set', () => {
  const hashes = loadForbiddenHashes({});
  assert.deepEqual(hashes, new Set(DEFAULT_FORBIDDEN_HASHES));
});

test('DEFAULT_PERSONAS: exactly the five approved names, each with a name and a voice directive', () => {
  const keys = Object.keys(DEFAULT_PERSONAS).sort();
  assert.deepEqual(keys, ['matthew', 'moses', 'noah', 'parzival', 'van-gogh']);
  for (const key of keys) {
    assert.equal(typeof DEFAULT_PERSONAS[key].name, 'string');
    assert.equal(typeof DEFAULT_PERSONAS[key].voice, 'string');
  }
});

test('resolvePersona: an unknown key returns null rather than throwing - validation is §1\'s job', () => {
  assert.equal(resolvePersona('not-a-real-key'), null);
  assert.equal(resolvePersona('moses').name, 'Moses');
});

test('loadPersonas: an operator file replaces the whole default set', () => {
  const { dir } = fixtureRepo();
  try {
    const personasPath = join(dir, 'personas.json');
    writeFileSync(personasPath, JSON.stringify({ custom: { name: 'Custom', voice: 'Whatever the operator wants.' } }));
    const personas = loadPersonas({ personasFile: personasPath });
    assert.deepEqual(Object.keys(personas), ['custom']);
    assert.equal(resolvePersona('moses', personas), null, 'the default set must be fully replaced, not merged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadPersonas: a missing operator file falls back to DEFAULT_PERSONAS, never throws', () => {
  assert.deepEqual(loadPersonas({ personasFile: '/no/such/file.json' }), DEFAULT_PERSONAS);
});

// This is the actual "fails loudly in the test suite, not a warning" gate
// the plan asks for - it runs against whatever forbidden list is actually
// loaded (default: empty, so nothing to check; an operator's own local file
// via COUNCIL_FORBIDDEN_NAMES_FILE extends it). It is not a security proof
// by itself - see this file's own header comment - it is the mechanism that
// makes one possible for whoever runs it with a real list loaded.
test('this repository carries no name from the currently-configured forbidden list, anywhere', () => {
  const root = join(import.meta.dirname, '..');
  const hashes = loadForbiddenHashes();
  const { findings } = scanForForbiddenNames(root, hashes);
  assert.deepEqual(findings, [], `forbidden name(s) found: ${findings.map(f => `${f.file}:${f.line}`).join(', ')}`);
});

test('scanForForbiddenNames: a two-word name split by a line wrap is still caught (bug-audit finding)', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/reflow.md', 'This paragraph reflowed awkwardly and put Zorblax\nPrime across two lines.\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].span, 'Zorblax Prime');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hashName: an accented name hashes the same in NFC and NFD form (bug-audit finding)', () => {
  const nfc = 'café'; // é as one precomposed code point
  const nfd = 'café'; // e + combining acute accent
  assert.notEqual(nfc, nfd, 'sanity: these are different byte sequences for the same text');
  assert.equal(hashName(nfc), hashName(nfd));
});

test('scanForForbiddenNames: a forbidden name used as a kebab-case filename is caught, not only file content (bug-audit finding)', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('src/zorblax-prime.js', '// nothing suspicious in the content itself\nexport const x = 1;\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].where, 'path');
    assert.match(findings[0].file, /zorblax-prime\.js$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForForbiddenNames: .sh files are scanned (bug-audit finding: TEXT_EXTENSIONS omitted .sh)', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('scripts/deploy.sh', '#!/bin/bash\n# Zorblax Prime\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.ok(findings.some(f => f.where === 'content'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Bug-audit fix, 2026-09-16: WORD_RE used to keep a hyphen INSIDE one token
// (/\p{L}[\p{L}-]*/gu), so a forbidden two-word name written hyphenated in
// file CONTENT (not a filename - the path case above was already handled by
// its own "-"/"_" -> " " preprocessing) tokenized as one fused span
// ("Zorblax-Prime") whose hash never matches the space-separated name the
// forbidden list actually hashes ("Zorblax Prime") - a silent evasion of the
// public-name-leak guard.
test('scanForForbiddenNames: a forbidden two-word name written HYPHENATED in file content is still caught (bug-audit finding)', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/example.md', 'Nothing here.\nThis line mentions Zorblax-Prime, hyphenated, by accident.\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 1, 'the hyphenated form must still be caught, not silently evade the scan');
    assert.equal(findings[0].where, 'content');
    assert.equal(findings[0].line, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForForbiddenNames: a forbidden two-word name written with an underscore in file content is still caught', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/example.md', 'A reference to Zorblax_Prime as one underscored token.\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForForbiddenNames: a real hyphenated compound word with no forbidden name present still finds nothing (no false positive from the fix)', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/example.md', 'This is a state-of-the-art, well-known approach.\n');
    const hashes = new Set([hashName('Zorblax Prime')]);
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Security-review fix (Fable 5.1 review of c915eba, MEDIUM 2): the earlier hyphen fix (removing
// "-" from WORD_RE) introduced a NEW false negative for a forbidden name that itself contains a
// hyphen - hashName() didn't normalize the hyphen, so the forbidden list's own hash ("jean-luc")
// no longer matched the space-joined span content now tokenizes to ("jean luc"). Fixed by
// normalizing hyphens/underscores to space inside hashName() itself.
test('scanForForbiddenNames: a forbidden name that ITSELF contains a hyphen is still caught when written plainly in content (bug-audit finding)', () => {
  const { dir, write } = fixtureRepo();
  try {
    write('docs/example.md', 'A mention of Zorblax Prime, the hyphenated forbidden entry.\n');
    const hashes = new Set([hashName('Zorblax-Prime')]); // the forbidden list entry itself has a hyphen
    const { findings } = scanForForbiddenNames(dir, hashes);
    assert.equal(findings.length, 1, 'a hyphen-containing forbidden name must still match its plain, space-written occurrence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hashName: hyphen and underscore variants of the same name all hash identically', () => {
  assert.equal(hashName('Zorblax-Prime'), hashName('Zorblax Prime'));
  assert.equal(hashName('Zorblax_Prime'), hashName('Zorblax Prime'));
  assert.equal(hashName('Zorblax  Prime'), hashName('Zorblax Prime'));
});

// Bug audit 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #10, repro /tmp/audit9/nl.mjs):
// shipped .patch/.css/.example files, LICENSE and .gitignore were never read; a listed name with an
// apostrophe could never match; NFD text split a name at its combining accent.
test('name-lint reads every text file, matches apostrophe names, and handles NFD text', async () => {
  const { hashName, scanForForbiddenNames } = await import('../src/name-lint.js');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'thc-namelint-'));
  const files = {
    'fix.patch': 'Zorblax Prime\n', 'site.css': '/* Zorblax Prime */\n', LICENSE: 'Zorblax Prime\n',
    '.gitignore': 'Zorblax Prime\n', '.env.example': 'KEY=Zorblax Prime\n',
    'a.md': "Meet Qel'Varo.\n", 'b.md': 'José Zorblax\n',
  };
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  writeFileSync(join(dir, 'image.bin'), Buffer.from([0x5a, 0x00, 0x6f, 0x72]));
  const hashes = new Set(['Zorblax Prime', "Qel'Varo", 'José Zorblax'].map(hashName));
  const { findings } = scanForForbiddenNames(dir, hashes);
  const hit = new Set(findings.map(f => f.file.split('/').pop()));
  for (const name of Object.keys(files)) assert.ok(hit.has(name), `${name} was not scanned or not matched`);
  assert.ok(!hit.has('image.bin'), 'binary content is skipped');
  assert.equal(hashName("Qel'Varo"), hashName('Qel’Varo'), 'straight and curly apostrophes hash alike');
});
