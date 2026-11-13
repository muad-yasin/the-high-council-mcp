// B3-only run controls, part (a): `--next-pass-layer-3` on a resume (src/ladder-steps.js; run.json `ladderSteps`; chain.js sets a pass's first layer from it). Offline, $0: mock judges scripted by how many times they are asked
// (`mock-critic-script-<xo>-<id>`), an external writer and reviser (so the run pauses at every revise-N, as B3's does), run through the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagesOfPass, pauseBefore, stepOk, stepOf } from '../src/ladder-steps.js';
import * as runControls from '../src/run-controls.js';   // a namespace import: a tree without routedStepsOf still loads this file and each row fails on its own
import { runThroughChecks } from './helpers/build-check.js';
import { routeNextPass, RECORDED, PERSON_WORDS } from './helpers/route-pass.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_PRELOAD = join(root, 'test', 'helpers', 'build-check-only-preload.js');   // 0.8.4 S4: a child with the build-check wording in force (C&C's Q-m migration)
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-script-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const writer = { provider: 'external', model: 'claude-code-session' };
const chainOf = critic => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critic },
});
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'b3c-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  // 0.8.4 S4: the same command with the build-check wording in force; a run that waits at the build check is answered good_to_build by a test-only handler and resumed (src: test/helpers/build-check.js)
  const runChecked = args => runThroughChecks(a => spawnSync(process.execPath, ['--import', CHECK_PRELOAD, join(root, 'src', 'cli.js'), ...a], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }), args, runDir);
  const answer = (name, text) => writeFileSync(join(runDir(), `${name}.md`), text);
  const files = () => readdirSync(runDir());
  const saved = () => JSON.parse(readFileSync(join(runDir(), 'run.json'), 'utf8'));
  return { dir, run, runChecked, runDir, answer, files, saved, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea${'.'.repeat(n)}\n`;
// The run, at its first revise pause: layer 1 (ladder, credit 0) has objected to the build; NEEDS-revise-1 waits, revise-1 is not written yet.
const atRevise1 = (p, extra = ['--ladder']) => {
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', ...extra]).status, 3);
  p.answer('build', plan(1));
  const r = p.run(['--resume', p.runDir()]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
};

test('N1: the pure helpers: which stage files belong to a pass (every label family, no neighbour), which pause is being answered, which run.json entries are usable', () => {
  const fam = ['panel-2-l1.md', 'panel-2-l1-retry.md', 'panel-2-l1-answered.md', 'panel-2-l1-question.md', 'ldebate-2-l1.md', 'ldebate-2-x2-l1.md', 'lreply-2-l1.md', 'lreply-2-x3-l1.md', 'rule-2-1.md', 'critique-2.md', 'critique-2-retry.md'];
  for (const f of fam) assert.deepEqual(stagesOfPass([f, 'unrelated.md'], 2), [f], `${f} belongs to pass 2`);
  assert.deepEqual(stagesOfPass(['panel-1-l1.md', 'panel-12-l1.md', 'panel-21-l1.md', 'revise-2.md', 'NEEDS-revise-2.md', 'ldebate-3-l1.md', 'build.md'], 2), [], 'neighbours, the pass-2 reviser and pause files are not pass-2 stages');
  assert.deepEqual(pauseBefore(['build.md', 'NEEDS-revise-1.md', 'revise-1.md', 'NEEDS-revise-2.md', 'revise-2.md', 'NEEDS-revise-2-full.md', 'revise-2-full.md']), { ok: true, after: 2, pass: 3 });
  assert.deepEqual(pauseBefore(['NEEDS-revise-1.md', 'revise-1.md', 'NEEDS-revise-2.md']), { ok: false, why: 'pending', label: 'revise-2' });
  assert.deepEqual(pauseBefore(['NEEDS-revise-1.md', 'revise-1.md', 'NEEDS-conflict-1.md']), { ok: false, why: 'pending', label: 'conflict-1' });
  assert.deepEqual(pauseBefore(['build.md', 'panel-1-l1.md']), { ok: false, why: 'none' });
  assert.equal(stepOk({ pass: 2, floor: 3 }), true);
  for (const bad of [null, 'x', {}, { pass: 0, floor: 3 }, { pass: 2.5, floor: 3 }, { pass: 2, floor: 2 }, { pass: '2', floor: 3 }]) assert.equal(stepOk(bad), false);
  assert.equal(stepOf([{ pass: 2, floor: 3 }, { pass: 5, floor: 3 }], 5)?.pass, 5);
  assert.equal(stepOf([{ pass: 2, floor: 2 }], 2), null);
});

test('N2: the next pass starts at layer 3 and layer 3 signing off ends the run as a ladder sign-off (the handler checks the build, then agreed: exit 0); layers 1 and 2 do not read that text; one entry is recorded', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'a')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    // CHANGED ACCEPTED ROW (S20 slice 2, R2). OLD: the flag itself resumed and exited 22 with "pass 2 is recorded to start at layer 3." and wrote run.json `ladderSteps` ([{pass 2, floor 3, via 'cli'}]). NEW: the flag records a REQUEST and exits 27, the handler routes it
    // (`council route-decide`), the plain resume exits 22; the route sits in the gate ledger (via 'ledger') and run.json has no `ladderSteps`. WHY: the flag only records what the person asked; the handler decides; one record, in the hash-chained ledger.
    const pressed = routeNextPass(p);
    assert.match(pressed.flag.stdout, RECORDED);
    // CHANGED ACCEPTED (0.8.4 S4, C&C's Q-m migration; OLD/NEW/WHY): OLD: the plain resume exited 22 at the ladder sign-off. NEW: with the build-check wording in force the ladder sign-off is an agreement point, the run waits at build-check-1 (exit 3), a test-only handler answers
    // good_to_build, and the resumed run ends AGREED (exit 0, `ending` agreed) with `passed` false and `outcome` no_consensus, as an escalated or ladder sign-off always was. WHY: the handler's build check follows layer 3's sign-off (CA4); every other assertion below is unchanged.
    const r = p.runChecked(['--resume', p.runDir()]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ladder: pass 2 starts at layer 3 because the pass before it was answered with a request to ask layer 3 next/);
    const files = p.files();
    assert.ok(files.includes('panel-1-l1.md') && files.includes('panel-2-l3.md'));
    assert.equal(files.some(f => /^panel-2-l[12]/.test(f)), false, 'pass 2 asked layer 3 only');
    const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
    assert.deepEqual(rep.escalated_signoff, { pass: 2, layer: 3, overseer_round: 1, below: [1, 2], ladder: true, requested: true }, 'the end entry says a request, not the count, put the pass at layer 3');
    assert.deepEqual([rep.ending.kind, rep.ending.handler_check, rep.outcome], ['agreed', 'good_to_build', 'no_consensus'], 'the handler agreed the ladder sign-off; the outcome stays no_consensus (an escalated or ladder sign-off is not the whole panel)');
    assert.deepEqual(rep.layers.filter(r => r.floor_by).map(r => r.round), [2, 2, 2], 'the three rows of pass 2 carry the marker, no other pass does');
    assert.equal(rep.passed, false);
    assert.equal(p.saved().ladderSteps, undefined, 'the route is in the gate ledger, not in run.json');
    const steps = runControls.routedStepsOf(p.runDir()).steps;
    assert.equal(steps.length, 1);
    assert.deepEqual({ pass: steps[0].pass, floor: steps[0].floor, via: steps[0].via }, { pass: 2, floor: 3, via: 'ledger' });
  } finally { p.done(); }
});

test('N3: layer 3 objecting is one layer-3 visit and the plan goes back to layer 1 (layer 2 needs its three visits again); a later plain resume replays the forced pass at $0 and keeps the entry', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'b')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    // CHANGED ACCEPTED ROW (S20 slice 2, R2): the flag leg is the request (27), the decision and the plain resume, as in N2; every assertion after it is unchanged except where the one entry is read (the ledger's routed decision, not run.json).
    routeNextPass(p);
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-2.md')));
    assert.equal(p.files().some(f => /^panel-2-l[12]/.test(f)), false);
    p.answer('revise-2', plan(3));
    const next = p.run(['--resume', p.runDir()]);
    assert.equal(next.status, 3, next.stdout + next.stderr);
    assert.match(next.stdout, /ladder: pass 3 starts at layer 1 \(layer-1 revisions in this block 0 of 3, layer-2 visits 0 of 3, layer-3 visits 1\)/);   // RE-POINTED (the ladder unit, commit 2, LAD-L1): layer 3 has no count, so the log line no longer says "of 3" for it
    assert.match(next.stdout, /panel-2-l3: mock\/mock-critic-script-x-b3 - from disk/, 'the forced pass was replayed from disk, not asked again');
    assert.equal(runControls.routedStepsOf(p.runDir()).steps.length, 1);
    assert.equal(existsSync(join(p.runDir(), 'superseded')), false, 'nothing went stale');
  } finally { p.done(); }
});

// One test per refusal: each is asserted on its own message, and each records nothing (a refused command must not leave an entry for the next plain resume to find).
const refusal = (id, name, { extra, setup, args = ['--next-pass-layer-3'], message, code = 2 }) => test(`${id}: refused, recorded nothing: ${name}`, () => {
  const p = project(chainOf(critics('x', 'x', 'x', id.toLowerCase())));
  try {
    atRevise1(p, extra);
    if (setup) setup(p);
    const r = p.run(['--resume', p.runDir(), ...args]);
    assert.equal(r.status, code, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(p.saved().ladderSteps, undefined, 'nothing was recorded');
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'nothing was asked');
  } finally { p.done(); }
});
const answered = p => p.answer('revise-1', plan(2));
// CHANGED ACCEPTED ROW (0.8.4 S4, the floor; OLD/NEW/WHY). OLD: N4a was a REFUSAL: a run with no ladder was refused ("this run has no ladder, so there is no first layer to change"). NEW: a chain with a layer 3 takes the route whether or not it runs under the ladder (D27 option 1e, Q11(a):
// control 1 ships for any layered chain), so the same run is RECORDED (exit 27); the refusal that remains for this input is a chain with no layer 3 (test/route-floor.test.js R5). WHY: the ladder-only refusal was the gate that made the control ladder-only; the copy refuses a route only where N7 requires a layer-1 restart.
test('N4a: a run with no ladder is no longer refused (0.8.4 S4): the flag records the request (exit 27) and asks nothing', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'n4a')));
  try {
    atRevise1(p, []);
    answered(p);
    // CHANGED ACCEPTED ROW (second follow-up run, 08 Nov 2026; an auto-merge collision between the floor commit and D's R2-tty). OLD: the bare flag from a child process, expecting exit 27. NEW: the flag with `--person-words` (the handler's relay of the person's request), as R2-tty did for N5a and N8. WHY: R2-tty made the bare flag refuse (exit 2) without a terminal, so the row stopped at the terminal check and never reached the property it exists for. WHAT THIS ROW PINS (it overlaps N8 on the exit 27, named): the PLAIN first request on a chain with a layer 3 and no ladder is recorded and nothing is asked (no panel-2 stage file): the ladder-only refusal is gone; route-floor R5 pins the chain with no layer 3. N8 pins the wording after the task file changed after the pause, N5a the refusal of a second request on a routed pass.
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS]);
    assert.equal(r.status, 27, r.stdout + r.stderr);
    assert.match(r.stdout, RECORDED);
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'nothing was asked');
  } finally { p.done(); }
});
refusal('N4b', 'the revise pause has not been answered', { message: /the run waits for an answer to revise-1; give that first\./ });
refusal('N4c', 'a stage of the next pass is already on disk', { setup: p => { answered(p); writeFileSync(join(p.runDir(), 'ldebate-2-x2-l1.md'), 'x'); }, message: /pass 2 already has a stage on disk \(ldebate-2-x2-l1\.md\), so starting the pass at layer 3 would change what that stage was asked\. Nothing was recorded, run or spent\./ });
refusal('N4d', 'a credited pass (plain rules)', { extra: ['--ladder', '--ladder-credit', '2'], setup: answered, message: /pass 2 is one of the first 2 passes, the ladder's credit, which run under the plain rules and not the ladder; so it has no first layer to change\. Nothing was recorded, run or spent\./ });
refusal('N4e', 'a run stopped at a round limit', { setup: p => { answered(p); writeFileSync(join(p.runDir(), 'STOPPED-overseer_cap.json'), '{}'); }, message: /this run is stopped at its overseer-round limit, and waits for --continue or --finish; answer that first\./ });   // CHANGED (0.8.4 S5 U-C1 fix-up 3, A-DRAFT, H-FLOOR-a): OLD /this run is stopped at a limit that waits for --continue or --finish; answer that first./ (a stall stop is not a limit; the stop's own phrase is said)
refusal('N4f', 'a conflict stop is judged by its pending pause, not called a limit', { setup: p => { answered(p); writeFileSync(join(p.runDir(), 'STOPPED-conflict.json'), '{}'); writeFileSync(join(p.runDir(), 'NEEDS-conflict-1.md'), 'x'); }, message: /the run waits for an answer to conflict-1; give that first\./ });
test('N4g: refused: at the first pause (the build) there is no next pass to change; and the flag is not a start flag', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'n4g')));
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 2); assert.match(r.stderr, /the run waits for an answer to build; give that first\./);
    const s = project(chainOf(critics('x', 'x', 'x', 'n4h')));
    try {
      const t = s.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--next-pass-layer-3']);
      assert.equal(t.status, 2); assert.match(t.stderr, /it answers a paused run: use it with --resume <run folder>\./);
    } finally { s.done(); }
  } finally { p.done(); }
});

test('N5a: a pass that is already routed to layer 3 refuses a second request and records nothing', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'n5a')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    // CHANGED ACCEPTED ROW (S20 slice 2, R2). OLD: run.json pre-seeded with a ladderSteps entry for pass 2; the flag exited 22 with "pass 2 is already recorded to start at layer 3; nothing new was recorded." and one entry stayed. NEW: after a routed decision for pass 2
    // the flag is refused (exit 2, "already routed", the ledger unchanged); a run.json entry with no routed decision behind it is refused at the resume start (RT-11). WHY: the steps are derived from decisions (a hand-written entry has no author in the record), and a second request for a routed pass is the writer's refusal.
    routeNextPass(p);
    const before = readFileSync(join(p.runDir(), 'gate-ledger.jsonl'), 'utf8');
    // CHANGED ACCEPTED ROW (R2-tty, Mini-C&C R418). OLD: the bare flag from a child process. NEW: the flag with `--person-words` (the handler's relay of the person's request). WHY: the bare flag records a request only at a real terminal, and a spawned child has none; this row's point (a second request for a routed pass is refused) is unchanged.
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--next-pass-layer-3: pass 2 is already routed to layer 3\. Nothing was recorded, run or spent\./);
    assert.equal(readFileSync(join(p.runDir(), 'gate-ledger.jsonl'), 'utf8'), before, 'the ledger is unchanged');
  } finally { p.done(); }
});

test('N5b: a damaged ladderSteps entry in run.json is refused before anything runs', () => {
  const q = project(chainOf(critics('x', 'x', 'o', 'n5b')));
  try {
    atRevise1(q);
    q.answer('revise-1', plan(2));
    writeFileSync(join(q.runDir(), 'run.json'), JSON.stringify({ ...q.saved(), ladderSteps: [{ pass: 2, floor: 2 }] }));
    const r = q.run(['--resume', q.runDir()]);
    assert.equal(r.status, 2); assert.match(r.stderr, /run\.json holds a ladderSteps entry that is not \{pass, floor: 3\}\. Check the file: it may have been edited by hand or damaged\. Nothing was run and nothing was spent\./);
    assert.equal(q.files().some(f => /^panel-2/.test(f)), false);
  } finally { q.done(); }
});

test('N6: a layer-3 judge not heard on the requested pass (another layer-3 judge was heard): the automatic re-ask keeps floor 3 (derived from the record), says so, and carries the marker; the ladder\'s own floor would have been layer 1', () => {
  const crit = [
    { provider: 'mock', model: 'mock-critic-script-x-k1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-x-k2', lab: 'l2', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-k3', lab: 'l3', layer: 3 }, { provider: 'mock', model: 'mock-unreadable', lab: 'l3b', layer: 3 }];
  const p = project(chainOf(crit));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    // CHANGED ACCEPTED ROW (S20 slice 2, R2): the flag leg is the request (27), the decision and the plain resume; the assertions are unchanged.
    routeNextPass(p);
    const r = p.run(['--resume', p.runDir()]);
    assert.match(r.stdout, /ladder: pass 2 starts at layer 3 because the pass before it was answered/);
    // CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask', 10 Nov 2026). OLD: the silent layer-3 judge was re-asked in a whole pass of its own: 'ladder: pass 3 starts at layer 3 again: ...', panel-3-l3 files, rows marked in rounds 2 and 3. NEW: it is re-asked inside pass 2 and once on its own (the solo ask), then the run stops at the silent-judge stop: there is no pass 3, and nothing falls back to layer 1.
    assert.match(r.stdout, /asking l3b\/mock-unreadable once more, on its own \(solo\)/);
    assert.match(r.stdout, /THE RUN STOPPED, NOT AGREED, and is waiting for your choice: a seat in layer 3 stayed silent/);
    const files = p.files();
    assert.equal(files.some(f => /^panel-3-/.test(f)), false, 'there is no pass 3');
    assert.equal(files.some(f => /^panel-2-l[12]/.test(f)), false, 'pass 2 did not fall back to layer 1');
    assert.ok(files.some(f => /^panel-2-l3b-solo/.test(f)), 'the solo ask was made in pass 2');
    const rep = JSON.parse(readFileSync(join(p.runDir(), existsSync(join(p.runDir(), 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));
    const marked = new Set(rep.layers.filter(x => x.floor_by).map(x => x.round));
    assert.ok(marked.has(2) && !marked.has(1) && !marked.has(3), `rows marked in rounds ${[...marked]}`);   // CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask', 10 Nov 2026). OLD: rounds 2 and 3
    assert.ok(rep.layers.some(x => x.round === 2 && x.floor_by === 'request'));
  } finally { p.done(); }
});

test('N7: at the build pause, with the build answered but no reviewer pause yet, there is no next pass to change (the CLI path of that refusal)', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'n7')));
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
    p.answer('build', plan(1));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /the run is not at a revise pause, so there is no next pass to change\. Nothing was recorded, run or spent\./);
    assert.equal(p.saved().ladderSteps, undefined);
  } finally { p.done(); }
});

// CHANGED ACCEPTED ROW, REWRITTEN IN PLACE (S20 slice 2, R2; Mini-C&C R307 (A) and C&C's option (a), R312). OLD: the task file changed after revise-1; the flag does not exit 22, prints no "recorded to start" sentence and run.json `ladderSteps` is undefined ("a later refusal of the same
// start records nothing"). NEW: the first half is kept (no "recorded to start" sentence, no run.json `ladderSteps`), but the flag no longer resumes: it records a REQUEST (exit 27, the ledger holds one `route_requested`) before the lock, and the refusal of the changed task (exit 14) belongs
// to the plain resume that follows. WHY: a request records what the person asked and decides nothing; the refusals a plain resume makes after the lock are not repeated at the request; the pin that the resume still refuses replaces the old "nothing was written".
test('N8: with the task changed, the flag records a request but prints no "recorded to start" and writes no run.json ladderSteps; the plain resume that follows refuses the changed task (exit 14)', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'n8')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    writeFileSync(join(p.dir, 'tasks', 't.md'), '# A different plan\n');
    // CHANGED ACCEPTED ROW (R2-tty, Mini-C&C R418). OLD: the bare flag from a child process. NEW: the flag with `--person-words` (the handler's relay of the person's request). WHY: the bare flag records a request only at a real terminal, and a spawned child has none; this row's point (the request is recorded before the lock and the resume refuses the changed task) is unchanged.
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS]);
    assert.equal(r.status, 27, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /(will start|is recorded to start) at layer 3\./);
    assert.equal(p.saved().ladderSteps, undefined, 'no run.json entry');
    assert.equal(readFileSync(join(p.runDir(), 'gate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1, 'the request is the one line of the ledger');
    const next = p.run(['--resume', p.runDir()]);
    assert.equal(next.status, 14, next.stdout + next.stderr);
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'nothing was asked');
  } finally { p.done(); }
});
