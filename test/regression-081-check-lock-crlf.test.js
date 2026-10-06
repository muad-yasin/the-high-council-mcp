// 0.8.1 FX-4 (the 2026-10-02 audit of 0.8.0, finding 4): `council check-lock` called an untouched HANDOFF.md with
// Windows line endings edited, because each criterion line kept its trailing carriage return. The golden file is a
// mock-debate run's HANDOFF.md; HANDOFF-crlf.md is the same file with CRLF endings (the M2 exit check reads it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLock } from '../src/criteria-lock.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = name => join(root, 'test', 'fixtures', 'regression-081', name);
const golden = readFileSync(fx('HANDOFF-golden.md'), 'utf8');
const crlf = golden.replace(/\n/g, '\r\n');
// Mixed: the criteria lines in CRLF, the rest LF (an editor that rewrote part of the file).
const mixed = golden.split('\n').map(l => (/^C\d+\. /.test(l) ? `${l}\r` : l)).join('\n');

test('FX-4: LF, CRLF and mixed copies of the golden HANDOFF.md all hold', () => {
  for (const [name, text] of [['lf', golden], ['crlf', crlf], ['mixed', mixed]]) {
    const r = checkLock(text);
    assert.equal(r.ok, true, `${name}: ${r.problems.join('; ')}`);
  }
  assert.equal(readFileSync(fx('HANDOFF-crlf.md'), 'utf8'), crlf, 'the fixture is the golden file in CRLF');
});

test('FX-4: an edited criterion still fails in every line-ending form', () => {
  const edit = t => t.replace('C2. It states the assumptions', 'C2. It quietly drops the assumptions');
  for (const [name, text] of [['lf', golden], ['crlf', crlf], ['mixed', mixed]]) {
    assert.notEqual(edit(text), text, `${name}: the edit applied`);
    assert.equal(checkLock(edit(text)).ok, false, name);
  }
});

test('FX-4: council check-lock on the CRLF fixture exits 0', () => {
  const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), 'check-lock', fx('HANDOFF-crlf.md')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
