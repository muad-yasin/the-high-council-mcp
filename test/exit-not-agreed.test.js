// C&C ruling (14 Oct 2026; E's flag): a run that FINISHED but whose panel did not agree (`passed` false in report.json) exits 22, not 0 - a script reads 0 as a success the run did not produce. Reached only by falling off the end of the main run (or of
// --rematch / --replay) with passed === false: every earlier exit has already left. A tree MEMBER and an advice call keep 0. Offline: mock chains in a fresh temp folder; `mock-dispute` ends not-agreed on purpose (a holdout critic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';
import { IDS, approveFrontier, newTree, registerKid, lineageFile, rootOpts } from './helpers/tree-fixture.js';
import { registerRoot } from '../src/tree-register.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const cliSrc = readFileSync(cli, 'utf8');
const sh = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 120_000 });
function work() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-notagreed-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a small reading list app.');
  return dir;
}
const withWork = fn => { const d = work(); try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const runDirOf = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).sort()[0]);
const reportOf = dir => JSON.parse(readFileSync(join(runDirOf(dir), 'report.json'), 'utf8'));

test('EN-1 a run whose panel did not agree finishes with exit 22: the deliverable and report.json are written and report.json says passed:false', () => withWork(dir => {
  const r = sh(dir, ['--chain', 'mock-dispute', '--task', 'tasks/x.md']);
  assert.equal(r.status, 22, r.stdout + r.stderr);
  assert.equal(reportOf(dir).passed, false);
  assert.ok(existsSync(join(runDirOf(dir), 'deliverable.md')));
  assert.match(r.stdout, /verdict: +stopped with open failures/);
}));

test('EN-2 control (green before this change): a run whose panel agreed exits 0 and report.json says passed:true', () => withWork(dir => {
  const r = sh(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(reportOf(dir).passed, true);
}));

test('EN-3 the exit equals report.json: over several mock endings the run exits 22 exactly when passed is false, and 0 when it is true', () => withWork(dir => {
  for (const chain of ['mock', 'mock-dispute', 'mock-unanimous', 'mock-relay']) {
    const d = work();
    try {
      const r = sh(d, ['--chain', chain, '--task', 'tasks/x.md']);
      const passed = reportOf(d).passed;
      assert.equal(r.status, passed === false ? 22 : 0, `${chain}: passed ${passed}, exit ${r.status}\n${r.stderr.slice(0, 300)}`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
}));

test('EN-4 --rematch and --replay of a run end with 22 when the NEW run did not agree, and with 0 when it did (control)', () => withWork(dir => {
  assert.equal(sh(dir, ['--chain', 'mock-dispute', '--task', 'tasks/x.md']).status, 22);
  const run = runDirOf(dir);
  const rematch = sh(dir, ['--rematch', run, '--rematch-seed', '3']);
  assert.equal(rematch.status, 22, rematch.stdout + rematch.stderr);
  assert.match(rematch.stdout, /rematch verdict: OPEN OBJECTIONS/);
  const replay = sh(dir, ['--replay', run, '--replay-date', '2026-10-14']);
  assert.equal(replay.status, 22, replay.stdout + replay.stderr);
  const good = work();
  try {
    assert.equal(sh(good, ['--chain', 'mock', '--task', 'tasks/x.md']).status, 0);
    const ok = sh(good, ['--rematch', runDirOf(good), '--rematch-seed', '3']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { rmSync(good, { recursive: true, force: true }); }
}));

test('EN-5 a tree MEMBER whose panel did not agree keeps exit 0 (the tree reads its record; src/tree-run.js reads any other code as a crash)', async () => {
  const dispute = JSON.parse(readFileSync(join(root, 'chains', 'mock-dispute.json'), 'utf8'));
  const t = newTree({ cap: 100, childChain: 'dispute-child', extraChains: { 'dispute-child': dispute } });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 50);
  const res = await api.run({ chain: 'dispute-child', task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1'), maxUsd: 50 });
  assert.equal(JSON.parse(readFileSync(join(t.runsDir, IDS[0], 'report.json'), 'utf8')).passed, false, 'the member really ended not agreed');
  assert.equal(res.exitCode, 0);
});

// EN-7 / EN-8 (2b-ii endings, 46ac21c): a layered mock chain whose top layer always objects stops at the overseer-round cap (exit 23, no report.json);
// the person's --finish ends it NOT agreed (report.json passed:false, stop.chosen finish) and that ending is a not-agreed ending like any other: exit 22.
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
function stoppedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-notagreed-ov-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify({
    name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [judge('o', 'a', 'l1', 1), judge('o', 'b', 'l2', 2), judge('x', 'c', 'l3', 3)] },
  }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  return dir;
}

test('EN-7 a bound stop (overseer-round cap) exits 23 and writes NO report.json: it can still continue, so it is not "ended, not agreed"', () => {
  const dir = stoppedProject();
  try {
    const r = sh(dir, ['--chain', 'ovc', '--task', 'tasks/t.md']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    assert.equal(existsSync(join(runDirOf(dir), 'report.json')), false);
    assert.ok(existsSync(join(runDirOf(dir), 'report-partial.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('EN-8 the person\'s --finish at a stop ends the run NOT agreed: report.json passed:false with stop.chosen finish, and the exit is 22', () => {
  const dir = stoppedProject();
  try {
    assert.equal(sh(dir, ['--chain', 'ovc', '--task', 'tasks/t.md']).status, 23);
    const r = sh(dir, ['--resume', runDirOf(dir), '--finish']);
    const report = reportOf(dir);
    assert.equal(report.passed, false);
    assert.equal(report.stop.chosen, 'finish');
    assert.equal(r.status, 22, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('EN-6 SOURCE pins: cli.js takes both numbers from src/exit-codes.js (no second copy), the exit sits last (after the security-review exits), skips advice calls and tree members, and the finished set is 0, 7, 8, 22', async () => {
  const codes = await import('../src/exit-codes.js');   // imported here so the other tests of this file load (and fail by assertion) at a parent that lacks the module
  assert.equal(codes.EXIT_NOT_AGREED, 22);
  assert.equal(codes.EXIT_ROUND_STOPPED, 23);
  assert.match(cliSrc, /import \{[^}]*\bEXIT_NOT_AGREED\b[^}]*\} from '\.\/exit-codes\.js';/);
  assert.match(cliSrc, /import \{[^}]*\bEXIT_ROUND_STOPPED\b[^}]*\} from '\.\/exit-codes\.js';/);
  assert.equal(/^const EXIT_(NOT_AGREED|ROUND_STOPPED) = /m.test(cliSrc), false, 'no second copy of 22 or 23 in cli.js');
  const constant = name => Number(new RegExp(`^const ${name} = (\\d+);`, 'm').exec(cliSrc)?.[1]);
  assert.deepEqual([...codes.FINISHED_EXIT_CODES].sort((a, b) => a - b), [0, constant('EXIT_SECURITY_BLOCKED'), constant('EXIT_SECURITY_NOT_JUDGED'), codes.EXIT_NOT_AGREED].sort((a, b) => a - b));
  const last = cliSrc.lastIndexOf('process.exit(EXIT_NOT_AGREED)');
  assert.ok(last > cliSrc.lastIndexOf('process.exit(EXIT_SECURITY_NOT_JUDGED)'), 'the security-review exits (7, 8) come first');
  assert.match(cliSrc.slice(cliSrc.lastIndexOf('if (result.passed === false', last), last + 40), /result\.passed === false && !result\.advise && !treeLineage/);
});
