// 0.8.4 S4 (M1; GO_M1_B item 6, D27 option 1e, Q11(a), Q8): run control 1, "the next pass starts at layer 3", on a layered chain WITHOUT the ladder. The handler's routed decision (the gate ledger) was read only on ladder runs; on any other chain the
// step was ignored and the pass ran from layer 1. These rows drive the real CLI on offline mock judges (scripted by ask count, an external writer and reviser so the run pauses at every revise-N), as test/b3-controls.test.js does for the ladder.
// Rows named R1..R9 are the floor's own (non-copy ids, written against FEATURE_SPECS Q11(a) l.1265 and the Q8 answer l.504); NEW-A3-1, T22s, T22y, T22g, T22l, T22m and T22ah are the S20/M2 copy rows and are NOT these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runControls from '../src/run-controls.js';   // namespace imports: a tree without a later export still loads this file and each row fails on its own
import * as gate from '../src/gate.js';
import * as stopFiles from '../src/stop-files.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reviserEarlyFinishNote, earlyFinishAskSection } from './held-prompts/held-083-early.js';
import { routeNextPass, RECORDED } from './helpers/route-pass.js';
import { runThroughChecks } from './helpers/build-check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_PRELOAD = join(root, 'test', 'helpers', 'build-check-only-preload.js');
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-script-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const criticsTwoLayers = (l1, l2, id) => critics(l1, l2, 'o', id).slice(0, 2);   // a chain with NO layer 3
const writer = { provider: 'external', model: 'claude-code-session' };
const chainOf = critic => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critic },
});
// A layered chain with overseer rounds must have exactly three layers (src/layers.js), so the chain WITHOUT a layer 3 has no overseer keys.
const chainTwoLayers = critic => { const { maxOverseerRounds, layerRevisions, ...rest } = chainOf(critic); return rest; };
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'rfloor-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const runChecked = args => runThroughChecks(a => spawnSync(process.execPath, ['--import', CHECK_PRELOAD, join(root, 'src', 'cli.js'), ...a], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }), args, runDir);
  const answer = (name, text) => writeFileSync(join(runDir(), `${name}.md`), text);
  const files = () => readdirSync(runDir());
  const report = () => JSON.parse(readFileSync(join(runDir(), 'report.json'), 'utf8'));
  return { dir, run, runChecked, runDir, answer, files, report, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea${'.'.repeat(n)}\n`;
// The run WITHOUT a ladder, at its first revise pause: layer 1 has objected to the build; NEEDS-revise-1 waits.
const atRevise1 = p => {
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3);
  p.answer('build', plan(1));
  const r = p.run(['--resume', p.runDir()]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
};

test('R1: a routed pass on a chain WITHOUT the ladder starts at layer 3, and layer 3 signing off with the handler\'s good_to_build ends the run agreed as a top-layer sign-off (requested, no ladder key, passed false, the layers below recorded as not asked)', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'r1')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    const pressed = routeNextPass(p);
    assert.match(pressed.flag.stdout, RECORDED);
    const r = p.runChecked(['--resume', p.runDir()]);   // the build-check wording in force: a test-only handler answers good_to_build (test/helpers/build-check.js)
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pass 2 starts at layer 3 because the pass before it was answered with a request to ask layer 3 next/);
    assert.doesNotMatch(r.stdout, /ladder:/, 'a chain without the ladder prints no ladder line');
    const files = p.files();
    assert.ok(files.includes('panel-1-l1.md') && files.includes('panel-2-l3.md'));
    assert.equal(files.some(f => /^panel-2-l[12]/.test(f)), false, 'pass 2 asked layer 3 only (the old source ignored the step and asked layer 1 first)');
    const rep = p.report();
    assert.deepEqual(rep.escalated_signoff, { pass: 2, layer: 3, overseer_round: 1, below: [1, 2], requested: true }, 'a request put the pass at layer 3: no ladder key');
    assert.deepEqual([rep.ending.kind, rep.ending.handler_check, rep.outcome, rep.passed], ['agreed', 'good_to_build', 'no_consensus', false]);
    assert.equal(rep.build_checks[0].kind, 'escalated');
    assert.deepEqual(rep.layers.filter(x => x.round === 2).map(x => [x.layer, x.state, x.floor_by]), [[1, 'not_asked', 'request'], [2, 'not_asked', 'request'], [3, 'signed_off', 'request']], 'the skipped layers are recorded as not asked and never as signed');
    assert.equal(rep.layers.filter(x => x.round === 1).some(x => x.floor_by), false, 'no other pass carries the marker');
    assert.equal(runControls.routedStepsOf(p.runDir()).steps.length, 1);
  } finally { p.done(); }
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'R2: the same run in the held state (no build-check wording) ends NOT agreed: exit 22, no ending, passed false ...' sat here. NEW: removed; its sibling R1 asserts the same routed run in the recorded state (the handler's good_to_build ends it agreed as a top-layer sign-off, requested, passed false, the lower layers not asked). WHY: buildCheckSystem and buildCheckUser are recorded (src/build-check.js buildCheckLive), so no shipped run ends a routed top-layer sign-off without the handler's check.

test('R3: layer 3 objecting on a routed pass is a layer-3 visit like any other: the plan goes back to layer 1 in the next pass (N7), and a later plain resume replays the routed pass from disk and keeps the one entry', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'r3')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    routeNextPass(p);
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-2.md')));
    assert.equal(p.files().some(f => /^panel-2-l[12]/.test(f)), false, 'the routed pass asked layer 3 only');
    p.answer('revise-2', plan(3));
    const next = p.run(['--resume', p.runDir()]);
    assert.equal(next.status, 3, next.stdout + next.stderr);
    assert.match(next.stdout, /panel-2-l3: mock\/mock-critic-script-x-r33 - from disk/, 'the routed pass was replayed from disk, not asked again');
    assert.doesNotMatch(next.stdout, /pass 3 starts at layer 3/, 'the pass after a layer-3 objection restarts at layer 1');
    assert.ok(p.files().includes('panel-3-l1.md'), 'pass 3 asked layer 1 first (and its objection pauses the run at revise-3)');
    assert.equal(runControls.routedStepsOf(p.runDir()).steps.length, 1);
    assert.equal(existsSync(join(p.runDir(), 'superseded')), false, 'nothing went stale');
  } finally { p.done(); }
});

test('R4: a routed pass in which a layer-3 judge is not heard stays at layer 3 through its re-asks and its solo ask (no pass 3; layers 1 and 2 are never asked)', () => {
  // layer 3 holds a clean seat and an unreadable one: one heard voter, one unheard seat, which is what makes the pass a re-ask (a layer with nobody heard stops the run instead)
  const config = chainOf([...critics('x', 'x', 'o', 'r4'), { provider: 'mock', model: 'mock-unreadable', lab: 'l3b', layer: 3 }]);
  const p = project(config);
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    routeNextPass(p);
    const r = p.run(['--resume', p.runDir()]);
    assert.match(r.stdout, /pass 2 starts at layer 3 because the pass before it was answered with a request/);
    // CHANGED ACCEPTED (0.8.4 ladder unit, the solo ask; owed list 'Solo ask', 10 Nov 2026). OLD: pass 3 started at layer 3 again (a re-ask pass keeping the floor). NEW: the silent layer-3 seat is re-asked inside pass 2 and once on its own, then the run stops: there is no pass 3 and layers 1 and 2 are never asked.
    assert.match(r.stdout, /asking l3b\/mock-unreadable once more, on its own \(solo\)/);
    assert.equal(p.files().some(f => /^panel-3-/.test(f)), false, 'there is no pass 3');
    assert.equal(p.files().some(f => /^panel-[23]-l[12]/.test(f)), false, 'layers 1 and 2 were not asked in the routed pass');
  } finally { p.done(); }
});

test('R5: a chain with NO layer 3 is refused at the flag, before anything is recorded (route_no_layer_3), and the ladder-only sentence is gone', () => {
  const p = project(chainTwoLayers(criticsTwoLayers('x', 'x', 'r5')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--next-pass-layer-3: this chain has no layer 3, so there is no layer to start a pass at\. Nothing was recorded, run or spent\./);
    assert.doesNotMatch(r.stderr, /no ladder/);
    assert.deepEqual(runControls.runControlsOf(p.runDir()), [], 'nothing was recorded');
  } finally { p.done(); }
});

test('R6: BACKSTOP - a route that sits in the record for a chain with no layer 3 (the entry never saw it) stops the run before any call, names the way out, and asks nothing of pass 2', () => {
  const p = project(chainTwoLayers(criticsTwoLayers('x', 'x', 'r6')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    assert.equal(gate.recordRouteRequest(p.runDir(), { pass: 2, channel: 'cli' }).ok, true);
    assert.equal(gate.recordRouteDecision(p.runDir(), { requestSeq: 1, pass: 2, decision: 'routed', decidedBy: 'handler', personWords: null, reason: 'ready' }).ok, true);
    const r = p.run(['--resume', p.runDir()]);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /pass 2 was asked to start at layer 3, but this chain has no layer 3\. No model was called and nothing was spent after pass 1\. A recorded route cannot be withdrawn: to go on, start a new run with --draft pointing at the plan as it stands\./);
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'nothing of pass 2 was asked');
  } finally { p.done(); }
});

test('R7: route-decide on a chain without the ladder records the route (the old refusal "this run has no ladder" is gone)', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'r7')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    const r = p.run(['route-decide', p.runDir(), '--route', '--reason', 'the plan is ready for the overseer']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /no ladder/);
    assert.equal(runControls.routedStepsOf(p.runDir()).steps.length, 1);
  } finally { p.done(); }
});

test('R8: PIN (passes on the old source, so it is no red) - a layered chain WITHOUT a route behaves as before: pass 2 starts at layer 1, no row carries floor_by, no escalated_signoff, the panel signs off; the limit: this reads the record, it does not compare prompt bytes', async t => {
  // CHANGED (0.8.4 floor fix-up, 08 Nov 2026; box diagnostics: the resume stopped at an external pause, revise-2, exit 3, so layer 1 objected again in pass 2). OLD: layer 1 was the scripted judge 'x', which objects at EVERY ask, and a scripted judge counts its asks per PROCESS (each CLI resume starts at its first ask again), so no ask-indexed script can tell pass 1 from pass 2 here. NEW: layer 1 is the default mock critic, which judges by CONTENT: it objects to a draft without the marker and passes a draft that carries it; the revision the row writes carries the marker, so pass 2 starts at layer 1, which signs off, and the panel signs off (the shape this row always described).
  const base = critics('o', 'o', 'o', 'r8'); base[0] = { provider: 'mock', model: 'mock-critic-r8', lab: 'l1', layer: 1 };
  const p = project(chainOf(base));
  try {
    atRevise1(p);
    p.answer('revise-1', `${plan(2)}\nREVISED MOCK DELIVERABLE\n`);
    const r = p.runChecked(['--resume', p.runDir()]);   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: p.run (the run ended by itself, exit 0). NEW: p.runChecked, because layer 3 signs off and the reviser is a session, so the run waits at the handler's build check and the test-only handler answers good_to_build (test/helpers/build-check.js). WHY: buildCheckSystem and buildCheckUser are recorded.
    t.diagnostic(`R8 --resume status=${r.status} stdout(last 400)=${JSON.stringify(String(r.stdout ?? '').slice(-400))}`.slice(0, 600));
    t.diagnostic(`R8 --resume stderr(last 400)=${JSON.stringify(String(r.stderr ?? '').slice(-400))}`.slice(0, 600));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(p.files().includes('panel-2-l1.md'), 'pass 2 asked layer 1 first');
    const rep = p.report();
    assert.deepEqual([rep.passed, rep.escalated_signoff, rep.layers.some(x => x.floor_by)], [true, undefined, false]);
  } finally { p.done(); }
});

test('R9: the chain reads the routed step by itself (the entry is bypassed: the route is written straight into the gate ledger): pass 2 asks layer 3 only, without a ladder; this row isolates chain.js from the entry refusal that R1-R4 and R7 also pass through', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'r9')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    assert.equal(gate.recordRouteRequest(p.runDir(), { pass: 2, channel: 'cli' }).ok, true);
    assert.equal(gate.recordRouteDecision(p.runDir(), { requestSeq: 1, pass: 2, decision: 'routed', decidedBy: 'handler', personWords: null, reason: 'ready' }).ok, true);
    const r = p.runChecked(['--resume', p.runDir()]);   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: p.run and exit 22 (the routed top-layer sign-off ended not agreed). NEW: p.runChecked and exit 0 (the handler's good_to_build ends it agreed, as R1 asserts). WHY: buildCheckSystem and buildCheckUser are recorded.
    assert.match(r.stdout, /pass 2 starts at layer 3 because the pass before it was answered with a request to ask layer 3 next/);
    assert.equal(p.files().some(f => /^panel-2-l[12]/.test(f)), false, 'the old source ignored the step and asked layer 1 first');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { p.done(); }
});

test('R10: the entry predicate is the condition under which chain.js reads the step: a chain with a layer 3 whose signoff is not "unanimous" is refused (route_not_layered), so a route is never recorded that chain.js would ignore', () => {
  const config = chainOf(critics('x', 'x', 'o', 'r10'));
  const p = project(config);
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    assert.deepEqual(runControls.routeRefusal(p.runDir(), { ladder: null, config }), { ok: true, pass: 2 }, 'GOOD HALF: the unanimous layered chain may be routed');
    const first = runControls.routeRefusal(p.runDir(), { ladder: null, config: { ...config, signoff: 'first' } });
    assert.equal(first.ok, false);
    assert.equal(first.code, 'route_not_layered');
    const flat = runControls.routeRefusal(p.runDir(), { ladder: null, config: { ...config, seats: { ...config.seats, critics: config.seats.critics.map(({ layer, ...c }) => c) } } });
    assert.equal(flat.code, 'route_not_layered', 'critics without layers are not a layered panel');
  } finally { p.done(); }
});

test('R11: a route is refused when the session proposed to finish early in its answer to the pass that just ended AND that proposal is acted on (both early-finish sentences recorded; injected here: passes only under injection); with the sentences held, or without the EARLY-FINISH line, nothing is refused', () => {
  const config = chainOf(critics('x', 'x', 'o', 'r11'));
  const p = project(config);
  try {
    atRevise1(p);
    p.answer('revise-1', `${plan(2)}\nEARLY-FINISH: the plan is ready for the overseer.\n`);
    setHeldForTest({ reviserEarlyFinishNote: undefined, earlyFinishAskSection: undefined });   // CHANGED (box run of 08 Nov 2026): both sentences are RECORDED since 0.8.3 (recorded-083.js), so the 'held state' has to be forced off; an explicit undefined keeps the recorded name off (src/held-roles.js)
    assert.deepEqual(runControls.routeRefusal(p.runDir(), { ladder: null, config }), { ok: true, pass: 2 }, 'GOOD HALF / held state: the sentences are not recorded, so the proposal is not acted on and the route is not refused');
    setHeldForTest({ reviserEarlyFinishNote, earlyFinishAskSection });
    const r = runControls.routeRefusal(p.runDir(), { ladder: null, config });
    assert.equal(r.code, 'route_after_early_finish', JSON.stringify(r));
    assert.match(r.message, /the session proposed to finish early in its answer to pass 1, so pass 2 asks the overseer layer alone whether to finish; it cannot also be started at layer 3\./);
    p.answer('revise-1', plan(2));   // the same pause, an answer without the line
    assert.deepEqual(runControls.routeRefusal(p.runDir(), { ladder: null, config }), { ok: true, pass: 2 }, 'no EARLY-FINISH line: nothing to refuse');
  } finally { setHeldForTest(null); p.done(); }
});

// A run folder STOPPED at the owner's pause before pass 2 (the pass loop's head, chain.js: the check is at the head of every pass after 1): stage files, the pause request in the real ledger, the marker, no live lock.
const ownerPauseFolder = stages => {
  const dir = mkdtempSync(join(tmpdir(), 'rfloor-op-'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'lad', task: 'tasks/t.md' }));
  for (const f of stages) writeFileSync(join(dir, f), 'x\n');
  const r = gate.recordPauseRequest(dir, { pass: 1, by: 'person', channel: 'cli' }, { now: () => Date.parse('2026-11-05T12:00:00.000Z') });
  assert.equal(r.ok, true, JSON.stringify(r));
  stopFiles.writeStoppedMarker(dir, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, requestSeq: r.seq });
  return dir;
};

test('R12: a route is refused when the pass that just ended was not answered with a revision (route_not_after_revision: a stall go-up, or a re-ask of the same draft, stops at the owner\'s pause with layer-1 files and no revise); the two normal route points are NOT refused (an external reviser\'s answered revise; a model reviser at the owner\'s pause), and N7 still names its own reasons first', () => {
  const config = { ...chainOf(critics('x', 'x', 'o', 'r12')) };
  const modelReviser = { ...config, seats: { ...config.seats, reviser: { provider: 'mock', model: 'mock-reviser' } } };
  const p = project(config);
  const dirs = [];
  try {
    // normal point 1: an external reviser\'s answered revise (NEEDS-revise-1.md + revise-1.md)
    atRevise1(p);
    p.answer('revise-1', plan(2));
    assert.deepEqual(runControls.routeRefusal(p.runDir(), { ladder: null, config }), { ok: true, pass: 2 }, 'GOOD HALF 1: an external reviser\'s answered revise');
    // normal point 2: a model reviser, at the owner\'s pause at the head of pass 2 (its answer is the stage file revise-1.md)
    const modelPause = ownerPauseFolder(['panel-1-l1.md', 'critique-1.md', 'revise-1.md']); dirs.push(modelPause);
    assert.deepEqual(runControls.routeRefusal(modelPause, { ladder: null, config: modelReviser }), { ok: true, pass: 2 }, 'GOOD HALF 2: a model reviser at the owner\'s pause');
    const fullPause = ownerPauseFolder(['panel-1-l1.md', 'critique-1.md', 'revise-1-full.md']); dirs.push(fullPause);
    assert.deepEqual(runControls.routeRefusal(fullPause, { ladder: null, config: modelReviser }), { ok: true, pass: 2 }, 'a full rewrite is a revision too');
    // the refusal: the pass ended with layer-1 files and no revise at all (a go-up pass, or a lone-heard / unheard re-ask)
    const goUp = ownerPauseFolder(['panel-1-l1.md', 'critique-1.md']); dirs.push(goUp);
    const r = runControls.routeRefusal(goUp, { ladder: null, config });
    assert.equal(r.code, 'route_not_after_revision', JSON.stringify(r));
    assert.match(r.message, /pass 1 was not answered with a revision \(the plan went up a layer, or the same draft is asked again\), so pass 2 has no revised plan to start at layer 3\./);
    // N7 names the more specific reason first: an objection from layer 2 with no revise is still route_after_upper_objection
    const upper = ownerPauseFolder(['panel-1-l1.md', 'panel-1-l2.md', 'critique-1.md']); dirs.push(upper);
    assert.equal(runControls.routeRefusal(upper, { ladder: null, config }).code, 'route_after_upper_objection');
  } finally { p.done(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
});
