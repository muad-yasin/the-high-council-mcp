// 0.8.4 round 2, the stranded run (RESULT 1). Through the real CLI, $0, mock judges. A run saved WITHOUT a ladder (an own chain with overseer rounds, answer_back on, the writer external) is resumed with
// --ladder --ladder-credit 2 at its revise-3 pause: pass 2 (the last credited pass) is the pass whose stall would be passed up, and pass 3 would then be a ladder pass, which refuses to start with a stall escalation in force.
// On the tip the resume ends in an ERROR stop (exit 16, STOPPED-error.*, no report, no verb answers it: the run is stranded). Now a stall in the last credited pass is not passed up; it stops for the person (a stall_stop,
// exit 23, its own reason `ladder_next`), and that stop is answered by the verbs that answer a stall stop.
// What tells the case apart (not a wording pin): the exit code, the stop's kind and why, and that --continue and --finish-now answer it. Controls (the same run, other credits): credit 3 (one more than the pass-up's pass, so
// layer 2 rules in a credited pass) and the bare --ladder resume (the ladder adopts credit 0) still go on to the next writer pause (exit 3), as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const writer = { provider: 'external', model: 'claude-code-session' };
const chain = {
  name: 'lad', selfReview: 'allowed', description: 'A test chain: every judge is a mock, the writer is external; selfReview is allowed so chain-lint never refuses the start.', signoff: 'unanimous',
  maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
    { provider: 'mock', model: 'mock-critic-script-xxxxxxxxxx-lcl1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-xooooooooo-lcl2', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-oooooooooo-lcl3', lab: 'l3', layer: 3 }] },
};

let SETUP = null;
function setup() {
  if (SETUP) return SETUP;
  const dir = mkdtempSync(join(tmpdir(), 'thc-lcl-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(chain));
  const run = (args, cwd = dir) => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 120_000 });
  let r = run(['--chain', 'lad', '--task', 'tasks/t.md']);
  const rd = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  writeFileSync(join(rd, 'build.md'), '# Plan v1\n\nAssumptions: tea.\n');
  r = run(['--resume', rd]);
  writeFileSync(join(rd, 'revise-1.md'), '# Plan v1\n\nAssumptions: tea.\n');
  r = run(['--resume', rd]);   // pass 2: the stall window; layer 2 reviews in pass 3 at the pause the person comes back to
  const pending = readdirSync(rd).filter(f => /^NEEDS-/.test(f) && !existsSync(join(rd, f.replace(/^NEEDS-/, ''))));
  SETUP = { dir, rd, run, premise: { exit: r.status, pending } };
  return SETUP;
}
// the run folder is put back to the pause before every step (the steps below must not see each other's files), as the probe of job 88 did
function fresh() {
  const s = setup();
  if (!s.snap) { s.snap = join(s.dir, 'snap'); cpSync(s.rd, s.snap, { recursive: true }); }
  rmSync(s.rd, { recursive: true, force: true }); cpSync(s.snap, s.rd, { recursive: true });
  return { rd: s.rd, run: s.run };
}
const outOf = r => `${r.stderr}${r.stdout}`;
const json = (rd, f) => JSON.parse(readFileSync(join(rd, f), 'utf8'));

test('LCL-0 premise: the run is at its revise-3 pause, saved without a ladder (the shape of job 88)', () => {
  const s = setup();
  assert.equal(s.premise.exit, 3, 'a writer pause');
  assert.ok(s.premise.pending.includes('NEEDS-revise-3.md'), `the pause is revise-3 (pending ${s.premise.pending.join(',')})`);
  assert.equal(JSON.parse(readFileSync(join(s.rd, 'run.json'), 'utf8')).ladder ?? null, null, 'no ladder saved');
});

test('LCL-1: --ladder --ladder-credit 2 (the last credited pass is the stall pass) stops for the person at a stall stop with its own reason, not an error stop', () => {
  const c = fresh();
  const r = c.run(['--resume', c.rd, '--ladder', '--ladder-credit', '2']);
  assert.equal(r.status, 23, `a stop the person answers, not exit 16 (got ${r.status}: ${outOf(r).slice(-300)})`);
  assert.ok(!existsSync(join(c.rd, 'STOPPED-error.json')), 'no error stop is written');
  const file = json(c.rd, 'STOPPED-stall_stop.json');
  assert.deepEqual([file.stoppedBy, file.resumeAfterStop], ['stall_stop', true], 'a stop file the run resumes after');
  const stop = json(c.rd, 'report-partial.json').stop;
  assert.deepEqual([stop.kind, stop.why, stop.ladder, stop.pass_left], ['stall_stop', 'ladder_next', true, true], 'the stall stop of this case: its own reason, a ladder run, a pass left');
});

test('LCL-2: the stop is answered by the verbs that answer a stall stop: --continue goes on to the next writer pause; --finish-now records the choice and ends the run (not an error)', () => {
  const a = fresh();
  a.run(['--resume', a.rd, '--ladder', '--ladder-credit', '2']);
  const cont = a.run(['--resume', a.rd, '--continue']);
  assert.equal(cont.status, 3, `--continue goes on to a writer pause (got ${cont.status}: ${outOf(cont).slice(-300)})`);
  assert.ok(readdirSync(a.rd).some(f => /^NEEDS-revise-2\.md$/.test(f)), 'the pause is the revise of pass 2');
  const b = fresh();
  b.run(['--resume', b.rd, '--ladder', '--ladder-credit', '2']);
  const fin = b.run(['--resume', b.rd, '--finish-now']);
  assert.notEqual(fin.status, 16, `--finish-now is not refused as a stranded run (got ${fin.status}: ${outOf(fin).slice(-300)})`);
  assert.notEqual(fin.status, 2, '--finish-now does not answer "nothing to answer"');
  const choice = json(b.rd, 'run.json').roundChoices.find(c => c.kind === 'stall_stop');
  assert.deepEqual([choice?.choice, choice?.why], ['finish_now', 'ladder_next'], 'the choice is recorded against this stop');
});

test('LCL controls: credit 3 (layer 2 rules in a credited pass) and the bare --ladder resume go on to the next writer pause, as they did', () => {
  const c3 = fresh(); const r3 = c3.run(['--resume', c3.rd, '--ladder', '--ladder-credit', '3']);
  assert.equal(r3.status, 3, 'credit 3: a writer pause');
  const cb = fresh(); const rb = cb.run(['--resume', cb.rd, '--ladder']);
  assert.equal(rb.status, 3, 'bare --ladder: a writer pause');
});
