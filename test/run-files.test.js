// src/run-files.js, the one place the MCP server reads or writes a run-folder file (0.8.2 item 2). Unit level: the layers that the MCP-level test
// (test/mcp-symlink-containment.test.js) reaches only together are checked one by one, so one layer cannot quietly stop working behind the other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { trustedRunDir, readRunFile, readRunJson, writeRunFile, firstSymlink, readRecordedTask } from '../src/run-files.js';
import { isDeniedPath } from '../src/tools.js';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'thc-run-files-'));
  const runs = join(base, 'runs'); const out = join(base, 'outside');
  mkdirSync(join(runs, 'r1'), { recursive: true }); mkdirSync(out);
  writeFileSync(join(runs, 'r1', 'a.md'), 'plain'); writeFileSync(join(out, 'secret.txt'), 'SECRET'); writeFileSync(join(out, 'victim.txt'), 'VICTIM');
  return { base, runs, out, dir: join(runs, 'r1'), clean: () => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

test('trustedRunDir: a real folder passes; a missing one, a link to a folder, a nested link (gates/) and a link at any depth up to four are refused; runs/ itself may be a link', () => {
  const f = fixture();
  try {
    assert.equal(trustedRunDir(f.runs, 'r1').dir, f.dir);
    assert.equal(trustedRunDir(f.runs, 'nope').refusal, 'no such run');
    symlinkSync(f.out, join(f.runs, 'linked'));
    assert.match(trustedRunDir(f.runs, 'linked').refusal, /symbolic link/);
    mkdirSync(join(f.dir, 'gates')); symlinkSync(f.out, join(f.dir, 'gates', 'g1.json'));
    assert.match(trustedRunDir(f.runs, 'r1').refusal, /r1\/gates\/g1\.json is a symbolic link/);
    // runs/ itself a link to another disk is legitimate
    const moved = join(f.base, 'moved'); mkdirSync(join(moved, 'r2'), { recursive: true });
    symlinkSync(moved, join(f.base, 'runs2'));
    assert.ok(trustedRunDir(join(f.base, 'runs2'), 'r2').dir);
    assert.equal(firstSymlink(f.dir), join('gates', 'g1.json'));
  } finally { f.clean(); }
});

test('readRunFile: a plain file reads; a symlink (to outside, to a sibling, dangling) is refused; a missing file is "missing"; names with a path are refused', () => {
  const f = fixture();
  try {
    assert.equal(readRunFile(f.dir, 'a.md').text, 'plain');
    symlinkSync(join(f.out, 'secret.txt'), join(f.dir, 'out.md')); symlinkSync(join(f.dir, 'a.md'), join(f.dir, 'sib.md')); symlinkSync(join(f.base, 'gone'), join(f.dir, 'dangling.md'));
    for (const n of ['out.md', 'sib.md', 'dangling.md']) { const r = readRunFile(f.dir, n); assert.equal(r.text, undefined, n); assert.match(r.refusal, /symbolic link/, n); }
    assert.equal(readRunFile(f.dir, 'nothing.md').missing, true);
    for (const bad of ['../x', 'a/b', '', '..', '.', 'a b']) assert.match(readRunFile(f.dir, bad).refusal, /bad file name/, bad);
    assert.equal(readRunJson(f.dir, 'a.md'), null, 'not JSON reads as null, the old readJson contract');
  } finally { f.clean(); }
});

test('writeRunFile: replaces a plain file; refuses a symlink and a dangling symlink and leaves the target alone; creates a new file', () => {
  const f = fixture();
  try {
    assert.deepEqual(writeRunFile(f.dir, 'a.md', 'new'), {}); assert.equal(readFileSync(join(f.dir, 'a.md'), 'utf8'), 'new');
    assert.deepEqual(writeRunFile(f.dir, 'fresh.md', 'x'), {}); assert.equal(readFileSync(join(f.dir, 'fresh.md'), 'utf8'), 'x');
    symlinkSync(join(f.out, 'victim.txt'), join(f.dir, 'l.md')); symlinkSync(join(f.out, 'pwned.txt'), join(f.dir, 'd.md'));
    assert.match(writeRunFile(f.dir, 'l.md', 'EVIL').refusal, /symbolic link/);
    assert.match(writeRunFile(f.dir, 'd.md', 'EVIL').refusal, /symbolic link/);
    assert.equal(readFileSync(join(f.out, 'victim.txt'), 'utf8'), 'VICTIM'); assert.equal(existsSync(join(f.out, 'pwned.txt')), false);
    assert.match(writeRunFile(f.dir, '../x.md', 'EVIL').refusal, /bad file name/);
  } finally { f.clean(); }
});

test('readRecordedTask: inside the server\'s working folder reads; outside (including via a hostile run.json cwd), through a link out, on the denylist, a directory and a missing file do not', () => {
  const f = fixture();
  try {
    const work = join(f.base, 'work'); mkdirSync(join(work, 'tasks'), { recursive: true });
    writeFileSync(join(work, 'tasks', 't.md'), 'TASK'); writeFileSync(join(work, '.env'), 'OPENROUTER_API_KEY=k');
    symlinkSync(join(f.out, 'secret.txt'), join(work, 'tasks', 'link.md'));
    const read = p => readRecordedTask(p, work, isDeniedPath);
    assert.equal(read('tasks/t.md').text, 'TASK');
    assert.equal(read(join(work, 'tasks', 't.md')).text, 'TASK', 'an absolute path inside the folder works too');
    assert.match(read(join(f.out, 'secret.txt')).refusal, /outside the working folder/);
    assert.match(read('tasks/link.md').refusal, /outside the working folder/);
    assert.match(read('../outside/secret.txt').refusal, /outside/);
    assert.match(read('.env').refusal, /denylist/);
    assert.match(read('tasks').refusal, /not a regular file/);
    assert.equal(read('tasks/none.md').missing, true);
    assert.match(readRecordedTask('tasks/t.md', undefined, isDeniedPath).refusal, /no recorded/);
    // the root is the folder the caller passes (the server's own work folder), never a folder a run.json names: '/' as the root would let anything through, so the callers must not use it
    assert.match(readRecordedTask('../outside/secret.txt', work, isDeniedPath).refusal, /outside the working folder/); // what a run.json with cwd = the parent folder would try
  } finally { f.clean(); }
});

test('readRunFile and writeRunFile do not hang on a FIFO (O_NONBLOCK), and firstSymlink fails closed on a folder it cannot list', t => {
  const f = fixture();
  try {
    const fifo = join(f.dir, 'report.json');
    if (spawnSync('mkfifo', [fifo]).status !== 0) return t.skip('no mkfifo on this machine'); // a skip is reported as a skip, never counted as a pass
    // In a child with a hard timeout, so a regression is a failed test and not a hung suite.
    const probe = spawnSync(process.execPath, ['-e', `import('${pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'run-files.js')).href}').then(m => { const r = m.readRunFile(${JSON.stringify(f.dir)}, 'report.json'); const w = m.writeRunFile(${JSON.stringify(f.dir)}, 'report.json', 'x'); console.log(JSON.stringify({ r, w })); })`], { encoding: 'utf8', timeout: 8000 });
    assert.equal(probe.status, 0, `a FIFO hung or crashed the read/write: ${probe.stderr} ${probe.error}`);
    const out = JSON.parse(probe.stdout);
    assert.match(out.r.refusal, /not a regular file/);
    assert.ok(out.w.refusal, 'writing to a FIFO with no reader is refused');
    // fail closed: a path that is not a listable folder reads as "has a link"
    assert.equal(firstSymlink(join(f.base, 'does-not-exist')), '(unreadable folder)');
  } finally { f.clean(); }
});
