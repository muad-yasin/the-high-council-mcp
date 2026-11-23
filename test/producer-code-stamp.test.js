// 0.8.4: report.json's producer carries a code stamp (sha256 over the package's own source) and run.json / producer.sittings one entry per sitting. Where the stamp cannot be computed the field is ABSENT, never a guess.
// Offline, $0: the mock layered chain of test/overseer-choice.test.js stops at its cap, so `--resume --finish` gives a run with two sittings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeSha256, harnessProducer } from '../src/version.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tree = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stamp-'));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
  return dir;
};
const MANIFEST = JSON.stringify({ files: ['src/', '!src/http-server.js', 'chains/', '!chains/outdated/', 'schemas/', 'README.md'] });
const FULL = { 'package.json': MANIFEST, 'src/a.js': 'export const a = 1;\n', 'chains/c.json': '{}\n', 'schemas/r.json': '{}\n' };

test('codeSha256: 64 hex, stable, and it changes with a file of the tree; only what package.json `files` ships is part of it', () => {
  const a = tree(FULL); const b = tree(FULL); const c = tree({ ...FULL, 'src/a.js': 'export const a = 2;\n' }); const d = tree({ ...FULL, 'docs/x.json': '{}\n', 'config/s.json': '{}\n', 'src/http-server.js': 'x\n', 'chains/outdated/o.json': '{}\n' });
  const e = tree({ ...FULL, 'config/s.json': '{}\n', 'package.json': JSON.stringify({ files: ['src/', 'chains/', 'schemas/', 'config/'] }) });
  try {
    const h = codeSha256({ root: a });
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(codeSha256({ root: b }), h, 'the same files give the same stamp');
    assert.notEqual(codeSha256({ root: c }), h, 'an edited file changes it');
    assert.equal(codeSha256({ root: d }), h, 'docs/, config/, src/http-server.js and chains/outdated/ are not hashed: the npm package does not ship them');
    assert.notEqual(codeSha256({ root: e }), h, 'the manifest decides the file set: listing config/ puts its file into the hash');
    assert.match(codeSha256(), /^[0-9a-f]{64}$/, 'this package can be read');
  } finally { for (const x of [a, b, c, d, e]) rmSync(x, { recursive: true, force: true }); }
});

test('the other shape: a tree that cannot be read as the whole set gives no stamp, and the producer has no code_sha256 key at all', () => {
  const noSchemas = tree({ 'package.json': MANIFEST, 'src/a.js': 'x\n', 'chains/c.json': '{}\n' });
  try {
    assert.equal(codeSha256({ root: noSchemas }), null, 'a missing folder: no partial hash');
    assert.equal(codeSha256({ root: join(noSchemas, 'nope') }), null, 'a missing root');
    const noManifest = tree({ 'src/a.js': 'x\n', 'chains/c.json': '{}\n', 'schemas/r.json': '{}\n' });
    const glob = tree({ ...FULL, 'package.json': JSON.stringify({ files: ['src/', 'chains/', 'schemas/**/*.json'] }) });
    try {
      assert.equal(codeSha256({ root: noManifest }), null, 'no package.json: the file set is unknown');
      assert.equal(codeSha256({ root: glob }), null, 'a glob this reader does not understand');
    } finally { rmSync(noManifest, { recursive: true, force: true }); rmSync(glob, { recursive: true, force: true }); }
    const p = harnessProducer({ root: noSchemas });
    assert.equal(Object.hasOwn(p, 'code_sha256'), false);
    // a packaged binary: the stamp is never computed there, even when a tree is readable next to it (the flag stands for process.pkg)
    const readable = tree(FULL);
    try {
      assert.match(codeSha256({ root: readable }), /^[0-9a-f]{64}$/);
      assert.equal(codeSha256({ root: readable, packaged: true }), null);
      assert.equal(codeSha256({ packaged: true }), null);
      assert.equal(Object.hasOwn(harnessProducer({ root: readable, packaged: true }), 'code_sha256'), false);
    } finally { rmSync(readable, { recursive: true, force: true }); }
    assert.deepEqual(Object.keys(p).sort(), ['name', 'version'], 'no sittings without a run.json to read them from');
    assert.deepEqual(Object.keys(harnessProducer({ sittings: [{ at: 'x', pid: 1, version: 'v' }], root: noSchemas })).sort(), ['name', 'sittings', 'version']);
  } finally { rmSync(noSchemas, { recursive: true, force: true }); }
});

const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
test('a run stamped at each sitting: run.json sittings[] after the start and after a resume; report.json producer.sittings lists both; a refused resume adds none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stamp-run-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'stm.json'), JSON.stringify({
      name: 'stm', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [judge('o', 'ma', 'l1', 1), judge('o', 'mb', 'l2', 2), judge('x', 'mc', 'l3', 3)] },
    }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(run(['--chain', 'stm', '--task', 'tasks/t.md']).status, 23);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const sittings = () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).sittings;
    assert.equal(sittings().length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).producer.sittings, sittings(), 'the partial report of a stopped run lists the sittings too');
    assert.equal(run(['--resume', runDir]).status, 23, 'a resume without a choice is refused');
    assert.equal(sittings().length, 1, 'a refused resume stamps nothing');
    const fin = run(['--resume', runDir, '--finish']);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));   // --finish ends the run NOT agreed: the exit code is not the point here, the report is
    assert.equal(sittings().length, 2, fin.stdout + fin.stderr);
    assert.deepEqual(report.producer.sittings, sittings(), 'the report lists the sittings run.json recorded');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const x of report.producer.sittings) { assert.equal(x.version, pkg.version); assert.match(x.code_sha256, /^[0-9a-f]{64}$/); assert.ok(Number.isInteger(x.pid)); assert.ok(Date.parse(x.at) > 0); }
    assert.equal(report.producer.code_sha256, report.producer.sittings[1].code_sha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
