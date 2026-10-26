// ROADMAP 47 (0.8.3 M5g): test/helpers/tmp-sweep.js removes the temp folders a test process made, when it exits, and only those. Driven through child processes with their own TMPDIR. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sweep = resolve(dirname(fileURLToPath(import.meta.url)), 'helpers', 'tmp-sweep.js');
const base = mkdtempSync(join(tmpdir(), 'thc-sweep-test-'));
process.on('exit', () => rmSync(base, { recursive: true, force: true }));
const run = (code, withSweep = true) => {
  const tmp = mkdtempSync(join(base, 't-')); const script = join(tmp, 'x.mjs'); writeFileSync(script, code);
  const r = spawnSync(process.execPath, [...(withSweep ? ['--import', sweep] : []), script], { env: { PATH: process.env.PATH, TMPDIR: tmp }, encoding: 'utf8' });
  return { tmp, status: r.status, out: r.stdout.trim(), left: () => readdirSync(tmp).filter(f => f !== 'x.mjs') };
};

test('a folder made with mkdtempSync, fs.promises.mkdtemp and the callback form under the temp dir is removed at exit; the control without the preload leaves all three', async () => {
  const code = `import fs, { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    const a = mkdtempSync(join(tmpdir(), 'a-')); fs.writeFileSync(join(a, 'f'), 'x');
    const b = await fs.promises.mkdtemp(join(tmpdir(), 'b-'));
    const c = await new Promise((ok, no) => fs.mkdtemp(join(tmpdir(), 'c-'), (e, p) => e ? no(e) : ok(p)));
    console.log([a, b, c].every(p => fs.existsSync(p)));`;
  const on = run(code); assert.equal(on.status, 0); assert.equal(on.out, 'true'); assert.deepEqual(on.left(), [], 'all three removed');
  const off = run(code, false); assert.equal(off.left().length, 3, 'the control leaves them');
});

test('only what THIS process made: a folder that already existed, a folder outside the temp dir and one the test removed itself are left alone (no error)', () => {
  const outside = mkdtempSync(join(base, 'outside-')); mkdirSync(join(outside, 'keep'));
  const code = `import fs, { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    mkdtempSync(join(${JSON.stringify(outside)}, 'elsewhere-'));
    const mine = mkdtempSync(join(tmpdir(), 'mine-')); rmSync(mine, { recursive: true });`;
  const r = run(code); assert.equal(r.status, 0);
  assert.deepEqual(r.left(), [], 'mine was removed by the test itself, no error at exit');
  assert.ok(existsSync(join(outside, 'keep'))); assert.equal(readdirSync(outside).filter(f => f.startsWith('elsewhere-')).length, 1, 'a folder outside the temp dir is not touched');
});

// M5g ruling (11 Oct): mkdir is recorded too, but only what THIS call created, and only entries directly under the temp dir. (Was pinned the other way: "a folder made with mkdirSync stays"; about ten test files build
// `<mkdtemp folder>-chains` siblings with mkdirSync and one file alone left 7 of them per run.)
test('mkdirSync, fs.mkdir and fs.promises.mkdir directly under the temp dir are removed at exit (plain and recursive, including a recursive path whose first-created folder is the one under the temp dir); the control leaves them', async () => {
  const code = `import fs, { mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    mkdirSync(join(tmpdir(), 'a-sync')); fs.writeFileSync(join(tmpdir(), 'a-sync', 'f'), 'x');
    mkdirSync(join(tmpdir(), 'b-rec', 'deep', 'er'), { recursive: true });
    await new Promise((ok, no) => fs.mkdir(join(tmpdir(), 'c-cb'), e => e ? no(e) : ok()));
    await new Promise((ok, no) => fs.mkdir(join(tmpdir(), 'd-cb-rec', 'x'), { recursive: true }, e => e ? no(e) : ok()));
    await fs.promises.mkdir(join(tmpdir(), 'e-prom')); await fs.promises.mkdir(join(tmpdir(), 'f-prom-rec', 'x'), { recursive: true });`;
  const on = run(code); assert.equal(on.status, 0); assert.deepEqual(on.left(), [], 'all six removed');
  const off = run(code, false); assert.deepEqual(off.left().sort(), ['a-sync', 'b-rec', 'c-cb', 'd-cb-rec', 'e-prom', 'f-prom-rec'], 'the control leaves them');
});

test('a folder that already existed is NOT removed: mkdirSync on it throws (caught) and a recursive mkdir on it returns undefined; a recursive path under an existing temp subfolder is not recorded either', () => {
  const tmp = mkdtempSync(join(base, 't-')); const script = join(tmp, 'x.mjs');
  mkdirSync(join(tmp, 'pre-existing')); writeFileSync(join(tmp, 'pre-existing', 'keep'), 'x'); mkdirSync(join(tmp, 'pre-dir'));
  writeFileSync(script, `import fs, { mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
    try { mkdirSync(join(tmpdir(), 'pre-existing')); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (mkdirSync(join(tmpdir(), 'pre-existing'), { recursive: true }) !== undefined) throw new Error('a recursive mkdir of an existing folder must return undefined');
    await fs.promises.mkdir(join(tmpdir(), 'pre-existing'), { recursive: true });
    await new Promise(ok => fs.mkdir(join(tmpdir(), 'pre-existing'), e => ok(e)));                              // EEXIST, nothing created
    mkdirSync(join(tmpdir(), 'pre-dir', 'inner'), { recursive: true });                                           // first-created is pre-dir/inner: not directly under the temp dir`);
  const r = spawnSync(process.execPath, ['--import', sweep, script], { env: { PATH: process.env.PATH, TMPDIR: tmp }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(tmp).filter(f => f !== 'x.mjs').sort(), ['pre-dir', 'pre-existing'], 'both pre-existing folders stay');
  assert.ok(existsSync(join(tmp, 'pre-existing', 'keep')), 'and so does what is inside them'); assert.ok(existsSync(join(tmp, 'pre-dir', 'inner')), 'a folder deeper than the temp dir is not ours to remove');
});
