// The permanent ladder (0.8.4, the ladder unit, commit 3): a run ends on AGREEMENT, which on a ladder run is layer 3's sign-off plus the handler's "good to build". Offline, $0: a keyed ladder chain (block 1, visits 1) with an external writer
// (the handling session) and scripted mock judges through the real CLI. Layer 1 objects once (the writer revises), layer 2 and layer 3 then sign off in pass 2: a ladder sign-off that layer 1 never read.
//  L-3a  the build check is live: the handler answers good_to_build -> the run ends agreed (exit 0); it answers not_yet -> the run does NOT end, it goes on (the writer is asked again), no stop file. The swapped answer is the red.
//  L-3b  the build check is held (today's default): the same run ends as the ladder sign-off ends it, exit 22, escalated_signoff with `below` kept. A PIN: it fails if the ending word, the exit or `below` changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runThroughChecks } from './helpers/build-check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_PRELOAD = join(root, 'test', 'helpers', 'build-check-only-preload.js');   // a child with the build-check wording in force
const writer = { provider: 'external', model: 'claude-code-session' };

const project = id => {
  const dir = mkdtempSync(join(tmpdir(), 'lad-agree-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify({
    name: 'lad', signoff: 'unanimous', ladder: { block: 1, visits: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
      { provider: 'mock', model: `mock-critic-script-x-${id}1`, lab: 'l1', layer: 1 },
      { provider: 'mock', model: `mock-critic-script-o-${id}2`, lab: 'l2', layer: 2 },
      { provider: 'mock', model: `mock-critic-script-o-${id}3`, lab: 'l3', layer: 3 }] },
  }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  const spawn = (args, checked) => spawnSync(process.execPath, [...(checked ? ['--import', CHECK_PRELOAD] : []), join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const answer = (n, t) => writeFileSync(join(runDir(), `${n}.md`), t);
  // to the point where the next resume reaches the ladder sign-off: build, then layer 1 objects in pass 1 and the writer revises
  const upToSignoff = () => {
    assert.equal(spawn(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3, 'the external writer builds first');
    answer('build', '# Plan v1\n\n1. Boil.\n\nAssumptions: tea.\n');
    assert.equal(spawn(['--resume', runDir()]).status, 3, 'layer 1 objects in pass 1: the writer is asked to revise');
    answer('revise-1', '# Plan v2\n\n1. Boil.\n\nAssumptions: tea..\n');
  };
  const pending = () => readdirSync(runDir()).filter(f => /^NEEDS-.*\.md$/.test(f) && !existsSync(join(runDir(), f.replace(/^NEEDS-/, ''))));
  return { spawn, runDir, upToSignoff, pending, checked: (args, opts) => runThroughChecks(a => spawn(a, true), args, runDir, opts), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const reportOf = dir => JSON.parse(readFileSync(join(dir, existsSync(join(dir, 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));

test('L-3a: with the build check live, the handler\'s good_to_build ends the ladder run agreed; the same run with the handler\'s not_yet (the swapped answer) does not end: the writer is asked again and no stop is written', () => {
  const good = project('a'); const notYet = project('b');
  try {
    good.upToSignoff();
    const agreed = good.checked(['--resume', good.runDir()]);
    assert.equal(agreed.status, 0, agreed.stdout + agreed.stderr);
    const rep = reportOf(good.runDir());
    assert.deepEqual([rep.ending.kind, rep.ending.handler_check, rep.outcome, rep.passed, rep.escalated_signoff?.ladder], ['agreed', 'good_to_build', 'no_consensus', false, true], 'a ladder sign-off that layer 1 never read, agreed by the handler (the shape test/b3-controls.test.js asserts)');

    notYet.upToSignoff();
    const goOn = notYet.checked(['--resume', notYet.runDir()], { answer: 'not_yet', note: 'This must be fixed first.' });
    assert.equal(goOn.status, 3, goOn.stdout + goOn.stderr);
    const waiting = notYet.pending();
    assert.ok(waiting.length === 1 && /^NEEDS-revise-\d+\.md$/.test(waiting[0]), `the handler's not_yet sends the plan back to the writer (an objected round): waiting for ${waiting.join(', ')}`);
    assert.deepEqual(readdirSync(notYet.runDir()).filter(f => /^STOPPED-/.test(f)), [], 'not_yet is not a stop');
  } finally { good.done(); notYet.done(); }
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'L-3b (PIN): with the build check held, the ladder sign-off ends as it ends today: exit 22, passed false, escalated_signoff marked ladder'. NEW: the row is removed (K7: after the recording a layered run with an external reviser waits at the build check at layer 3's sign-off, so a plain resume cannot end at exit 22; SIBLING: 'L-3a', which answers the build check and asserts the ladder sign-off as recorded: `escalated_signoff.ladder` true, `passed` false, ending agreed). WHY: buildCheckSystem and buildCheckUser are recorded (buildCheckLive(), chain.js:4991).
