// 0.8.4 S18 (Q15(g), Q11(a); FEATURE_SPECS T21ad): the next pass is sent straight to layer 3 by the run control and layer 3 signs off: the run ends only after the handler's answer, never before. Drives the real CLI on offline mock judges (the fixture and helpers
// of test/route-floor.test.js R1, COPIED: no *.test.js file is imported), $0. The build-check words are HELD: the child process gets them from test/helpers/build-check-only-preload.js (as shipped none of this is reachable).
// What the row pins: after the routed pass, layer 3's sign-off WAITS (exit 3, NEEDS-build-check-1.md written, no report.json, so no ending) until the handler answers; the answer ends the run agreed as a top-layer sign-off (requested, passed false) and the final read's
// record is on the report (ran: false: layer 3 read this text itself). The "after the final read" half of the order (the final-read record step runs before the check is asked) has its own row in a later commit of this unit.
// Written without a run (no tests on the laptop). The red is a swapped-input variant (S18_SWAPS.json): CHECK_ON true -> false (the held state: R2 of route-floor), every assert line byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeNextPass } from './helpers/route-pass.js';
import { answerBuildChecks } from './helpers/build-check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_PRELOAD = join(root, 'test', 'helpers', 'build-check-only-preload.js');
const critics = id => [
  { provider: 'mock', model: `mock-critic-script-x-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-x-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-o-${id}3`, lab: 'l3', layer: 3 }];
const writer = { provider: 'external', model: 'claude-code-session' };
const chain = id => ({ name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critics(id) } });
const plan = n => `# Plan v${n}\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea${'.'.repeat(n)}\n`;

function project(checkOn) {
  const dir = mkdtempSync(join(tmpdir(), 's18route-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(chain('s18')));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const spawn = (args, preload) => spawnSync(process.execPath, [...(preload ? ['--import', CHECK_PRELOAD] : []), join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run: args => spawn(args, false), runChecked: args => spawn(args, checkOn), runDir, answer: (name, text) => writeFileSync(join(runDir(), `${name}.md`), text), report: () => JSON.parse(readFileSync(join(runDir(), 'report.json'), 'utf8')), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('T21ad: the next pass is sent straight to layer 3 by the run control and layer 3 signs off: the run WAITS at the handler\'s build check (exit 3, no report, no ending) and ends agreed only after the handler\'s answer', () => {
  const CHECK_ON = true;   // the build-check words are in force for the child process (false: the held state)
  const p = project(CHECK_ON);
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
    p.answer('build', plan(1));
    const atRevise = p.run(['--resume', p.runDir()]);
    assert.equal(atRevise.status, 3, `premise: layer 1 objected to the build and the run waits at revise-1 (${atRevise.stdout}${atRevise.stderr})`);
    p.answer('revise-1', plan(2));
    routeNextPass(p);
    const first = p.runChecked(['--resume', p.runDir()]);
    assert.equal(first.status, 3, `T21ad: layer 3 signed off on the routed pass and the run waits for the handler (${first.stdout}${first.stderr})`);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-build-check-1.md')), 'T21ad: the build check is written for the handler');
    assert.equal(existsSync(join(p.runDir(), 'report.json')), false, 'T21ad: nothing is reported as ended before the handler answers (no report.json, so no ending)');
    assert.equal(answerBuildChecks(p.runDir()), 1, 'premise: the handler\'s answer is written for the one check');
    const second = p.runChecked(['--resume', p.runDir()]);
    assert.equal(second.status, 0, `T21ad: the handler's good_to_build ends the run (${second.stdout}${second.stderr})`);
    const rep = p.report();
    assert.deepEqual([rep.ending.kind, rep.ending.handler_check, rep.passed, rep.escalated_signoff.requested], ['agreed', 'good_to_build', false, true], 'T21ad: agreed after the handler\'s answer, as a top-layer sign-off of a routed pass');
    assert.equal(rep.final_read?.ran, false, 'T21ad: the final read\'s record is on the report (layer 3 read this text itself, so no call was made)');
  } finally { p.done(); }
});
