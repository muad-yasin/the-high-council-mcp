// S20 slice 2, control 1, step R2: `--next-pass-layer-3` on a resume RECORDS a request and exits 27 (it runs nothing and spends nothing); `council route-decide` is the handler's decision on it (or its own route, or the person's decision it carries out); N7 refuses a route
// past an objection from layer 2 or above; the steps that start a pass at layer 3 are derived from the ledger's routed decisions. Offline, $0: the b3 fixtures (mock judges scripted by how often they are asked, an external writer and reviser, so the run pauses at every revise-N), the real CLI.
// RT-ids, because "N7" is taken in b3-controls.test.js by another row. The N7 module is imported through a GUARDED dynamic import, so that a tree without it still LOADS this file and each RT-10 row fails on its own (a shared load error would hide them).
//   RT-1 the flag records;  RT-2 it goes alone;  RT-3 a live run;  RT-4 an open request;  RT-5 the handler's own route;  RT-6 a decision on a request;  RT-7 the person's decision;  RT-8 the verb's refusals (one row each);  RT-9 N7 at the CLI;  RT-10 N7 in the library (one row each);
//   RT-11 derived steps;  RT-12 wiring pins;  RT-13 the verb-only flags on the main path.   (The task-changed case, formerly RT-14, is b3-controls N8, rewritten in place.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as runControls from '../src/run-controls.js';
import * as gate from '../src/gate.js';
import * as exitCodes from '../src/exit-codes.js';
import * as caps from '../src/caps.js';
import { registerSeatKeys, seatKeyOf } from '../src/seat-key.js';
import { runThroughChecks } from './helpers/build-check.js';
import { RECORDED, PERSON_WORDS, routeNextPass } from './helpers/route-pass.js';

const rl = await import('../src/route-layer.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_PRELOAD = join(root, 'test', 'helpers', 'build-check-only-preload.js');   // 0.8.4 S4: a child with the build-check wording in force
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
  const dir = mkdtempSync(join(tmpdir(), 'rtc-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  // 0.8.4 S4 (C&C's Q-m migration): the same command with the build-check wording in force; a run that waits at the build check is answered good_to_build by a test-only handler and resumed (test/helpers/build-check.js)
  const runChecked = args => runThroughChecks(a => spawnSync(process.execPath, ['--import', CHECK_PRELOAD, join(root, 'src', 'cli.js'), ...a], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }), args, runDir);
  const answer = (name, text) => writeFileSync(join(runDir(), `${name}.md`), text);
  const files = () => readdirSync(runDir());
  const saved = () => JSON.parse(readFileSync(join(runDir(), 'run.json'), 'utf8'));
  return { dir, run, runChecked, runDir, answer, files, saved, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea${'.'.repeat(n)}\n`;
const atRevise1 = (p, extra = ['--ladder']) => {
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', ...extra]).status, 3);
  p.answer('build', plan(1));
  const r = p.run(['--resume', p.runDir()]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
};
// the run at its revise pause with the reviser's answer in: the next pass (2) is the one a route would start at layer 3
const atPass2 = (p, extra) => { atRevise1(p, extra); p.answer('revise-1', plan(2)); };
const fresh = (l1 = 'x', l2 = 'x', l3 = 'o', id = 'rt') => { const p = project(chainOf(critics(l1, l2, l3, id))); atPass2(p); return p; };
const ledger = p => { const f = join(p.runDir(), 'gate-ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const snap = d => { const m = {}; const walk = (dir, rel = '') => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`); else m[rel + e.name] = readFileSync(join(dir, e.name), 'utf8'); } }; walk(d); return m; };
// CHANGED ACCEPTED HELPER (R2-tty, Mini-C&C R418). OLD: the bare flag, which recorded a request on the channel cli from a child with no terminal. NEW: the flag with `--person-words`, which records the handler's relay of the person's request on the channel session; the bare flag now needs a real terminal. WHY: the bare form is the person's own and is never recorded without a terminal; every row that only needs a recorded request asks the relayed way, and the terminal's form is tested in process (test/route-tty.test.js).
const FLAG = p => ['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS];

test('RT-1 the flag RECORDS a request and stops: exit 27, one route_requested line, nothing run, nothing in run.json, and the line names the request and the follow-up', () => {
  const p = fresh('x', 'x', 'o', 'rt1');
  try {
    const before = snap(p.runDir());
    const r = p.run(FLAG(p));
    assert.equal(r.status, 27, r.stdout + r.stderr);
    assert.match(r.stdout, RECORDED);
    assert.match(r.stdout, /council route-decide .* 1 --route --reason "\.\.\."/);
    assert.match(r.stdout, /Nothing was run and nothing was spent\./);
    const after = snap(p.runDir());
    assert.deepEqual(Object.keys(after).filter(k => before[k] !== after[k]).sort(), ['gate-ledger.jsonl'], 'the ledger is the only file that changed (no lock file is left)');
    const lines = ledger(p);
    assert.equal(lines.length, 1);
    assert.deepEqual({ event: lines[0].event, pass: lines[0].pass, floor: lines[0].floor, by: lines[0].by, channel: lines[0].channel, person_words: lines[0].person_words }, { event: 'route_requested', pass: 2, floor: 3, by: 'person', channel: 'session', person_words: PERSON_WORDS });
    assert.equal(p.saved().ladderSteps, undefined);
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'no stage of pass 2 was asked');
  } finally { p.done(); }
});

test('RT-2 GOOD HALF the flag with the person\'s words exits 27', () => {
  const c = fresh('x', 'x', 'o', 'rt2c');
  try { assert.equal(c.run(FLAG(c)).status, 27); } finally { c.done(); }
});
// one test per token, each asserted on its own message and on an unchanged folder (the old flag also refuses --ladder, but with another sentence)
for (const extra of ['--continue', '--ladder']) {
  test(`RT-2 the flag goes alone: ${extra} with it is refused by name and nothing is recorded`, () => {
    const p = fresh('x', 'x', 'o', `rt2${extra.slice(2)}`);
    try {
      const before = snap(p.runDir());
      const r = p.run([...FLAG(p), extra]);
      assert.equal(r.status, 2, `${extra}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, new RegExp(`${extra} cannot go with --next-pass-layer-3: a route request is recorded alone\\. Give ${extra} on the resume that follows the decision\\. Nothing was recorded, run or spent\\.`));
      assert.deepEqual(snap(p.runDir()), before, 'the folder is unchanged');
    } finally { p.done(); }
  });
}

test('RT-3 a live run: with the lock free the flag exits 27; with the lock held by a live process it exits 13, records nothing, and requestRoute answers run_locked', async () => {
  const c = fresh('x', 'x', 'o', 'rt3c');
  try { assert.equal(c.run(FLAG(c)).status, 27, 'good half first: the lock is free'); } finally { c.done(); }
  const p = fresh('x', 'x', 'o', 'rt3');
  let holder;
  try {
    holder = await new Promise((ok, no) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireRunLock } from ${JSON.stringify(pathToFileURL(join(root, 'src', 'run-lock.js')).href)}; acquireRunLock(${JSON.stringify(p.runDir())}); process.stdout.write('held\\n'); process.stdin.resume();`], { stdio: ['pipe', 'pipe', 'inherit'] });
      child.stdout.once('data', () => ok(child)); child.on('error', no);
    });
    const r = p.run(FLAG(p));
    assert.equal(r.status, 13, r.stdout + r.stderr);
    assert.equal(ledger(p).length, 0, 'nothing was recorded');
    const direct = runControls.requestRoute(p.runDir(), { ladder: { credit: 0 }, config: chainOf(critics('x', 'x', 'o', 'rt3')) });
    assert.deepEqual([direct.ok, direct.code], [false, 'run_locked']);
  } finally { holder?.kill(); p.done(); }
});

test('RT-4 a second request for a pass waits for the first one\'s decision; after a decline a new request is recorded', () => {
  const p = fresh('x', 'x', 'o', 'rt4');
  try {
    assert.equal(p.run(FLAG(p)).status, 27);
    const again = p.run(FLAG(p));
    assert.equal(again.status, 2, again.stdout + again.stderr);
    assert.match(again.stderr, /--next-pass-layer-3: a request to route pass 2 waits for its decision\. Nothing was recorded, run or spent\./);
    assert.equal(ledger(p).length, 1);
    const decline = p.run(['route-decide', p.runDir(), '1', '--decline', '--reason', 'not now']);
    assert.equal(decline.status, 0, decline.stdout + decline.stderr);
    assert.equal(p.run(FLAG(p)).status, 27, 'after the decline a new request is allowed');
    assert.equal(ledger(p).filter(l => l.event === 'route_requested').length, 2);
  } finally { p.done(); }
});

test('RT-5 the handler\'s own route (no request): route-decide --route --reason records one routed decision, and the steps derive from it', () => {
  const p = fresh('x', 'x', 'o', 'rt5');
  try {
    const r = p.run(['route-decide', p.runDir(), '--route', '--reason', 'the plan is ready for the overseer']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /route-decide: pass 2 is routed to layer 3 \(decision 1\)\. Resume the run to start it: council --resume /);
    const l = ledger(p);
    assert.equal(l.length, 1);
    assert.deepEqual({ event: l[0].event, request_seq: l[0].request_seq, pass: l[0].pass, decision: l[0].decision, by: l[0].by, decided_by: l[0].decided_by, person_words: l[0].person_words, reason: l[0].reason },
      { event: 'route_decided', request_seq: null, pass: 2, decision: 'routed', by: 'handler', decided_by: 'handler', person_words: null, reason: 'the plan is ready for the overseer' });
    assert.deepEqual(runControls.routedStepsOf(p.runDir()).steps.map(s => ({ pass: s.pass, floor: s.floor, via: s.via })), [{ pass: 2, floor: 3, via: 'ledger' }]);
    assert.equal(p.saved().ladderSteps, undefined);
  } finally { p.done(); }
});

test('RT-6 a decision on a request: route-decide <n> --route pairs with it, --decline closes it and the request stays listed', () => {
  const p = fresh('x', 'x', 'o', 'rt6');
  try {
    const { request } = routeNextPass(p);
    assert.equal(request, 1);
    const c = gate.routeControlsOf(p.runDir()).controls;
    assert.deepEqual(c.map(x => [x.pass, x.request?.seq, x.request?.channel, x.decision?.seq, x.decision?.decision, x.decision?.decided_by]), [[2, 1, 'session', 2, 'routed', 'handler']]);
  } finally { p.done(); }
  const q = fresh('x', 'x', 'o', 'rt6b');
  try {
    assert.equal(q.run(FLAG(q)).status, 27);
    const d = q.run(['route-decide', q.runDir(), '1', '--decline', '--reason', 'the plan needs one more pass at layer 1']);
    assert.equal(d.status, 0, d.stdout + d.stderr);
    assert.match(d.stdout, /route-decide: request 1 is declined \(decision 2\)\. Nothing was started\./);
    assert.deepEqual(gate.routeControlsOf(q.runDir()).controls.map(x => [x.request?.seq, x.decision?.decision]), [[1, 'declined']]);
    assert.deepEqual(runControls.routedStepsOf(q.runDir()).steps, [], 'a decline starts nothing');
  } finally { q.done(); }
});

test('RT-7 the person\'s decision the handler carries out: --person-words stores his answer as typed and the line carries the relay sentence; a --reason with it is refused', () => {
  const bad = fresh('x', 'x', 'o', 'rt7b');
  try {
    const r = bad.run(['route-decide', bad.runDir(), '--route', '--person-words', 'Yes, route it to layer 3.', '--reason', 'my own reason']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /a decision that is the person's carries no reason of its own: the person types none, and the line carries the relay sentence\. Nothing was written\./);
    assert.equal(ledger(bad).length, 0);
  } finally { bad.done(); }
  const p = fresh('x', 'x', 'o', 'rt7');
  try {
    const words = 'Yes,  route it\nto layer 3.';
    const r = p.run(['route-decide', p.runDir(), '--route', '--person-words', words]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const l = ledger(p)[0];
    assert.deepEqual({ decided_by: l.decided_by, by: l.by, person_words: l.person_words, reason: l.reason }, { decided_by: 'person', by: 'handler', person_words: words, reason: runControls.RELAY_REASON });
  } finally { p.done(); }
});

// RT-8: one row per refusal; each asserts its own message (every route-decide call exits 2 on a tree without the verb, so the exit code and an unchanged ledger alone could not fail there), and the first row is the good half.
const verbRefusal = (name, { setup, args, message }) => test(`RT-8 route-decide: ${name}`, () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'rt8')));
  try {
    if (setup) setup(p); else atPass2(p);
    const before = existsSync(join(p.runDir(), 'gate-ledger.jsonl')) ? readFileSync(join(p.runDir(), 'gate-ledger.jsonl'), 'utf8') : null;
    const r = p.run(args(p));
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    const after = existsSync(join(p.runDir(), 'gate-ledger.jsonl')) ? readFileSync(join(p.runDir(), 'gate-ledger.jsonl'), 'utf8') : null;
    assert.equal(after, before, 'nothing was written');
  } finally { p.done(); }
});
test('RT-8 route-decide: GOOD HALF - a valid handler route exits 0', () => {
  const p = fresh('x', 'x', 'o', 'rt8g');
  try { const r = p.run(['route-decide', p.runDir(), '--route', '--reason', 'ready']); assert.equal(r.status, 0, r.stdout + r.stderr); } finally { p.done(); }
});
verbRefusal('neither --route nor --decline', { args: p => ['route-decide', p.runDir()], message: /usage: council route-decide <run folder>/ });
verbRefusal('both --route and --decline', { args: p => ['route-decide', p.runDir(), '--route', '--decline'], message: /usage: council route-decide <run folder>/ });
verbRefusal('a route without a reason', { args: p => ['route-decide', p.runDir(), '--route'], message: /route-decide: a route decision carries its reason\. Nothing was written\./ });
verbRefusal('a reason of 401 characters', { args: p => ['route-decide', p.runDir(), '--route', '--reason', 'r'.repeat(401)], message: /at most 400 characters \(this one has 401\)\. Nothing was written\./ });
verbRefusal('a decline without a request', { args: p => ['route-decide', p.runDir(), '--decline', '--reason', 'no'], message: /only a request can be declined: a decision with no request is a route\. Nothing was written\./ });
verbRefusal('a request that is not in the record', { args: p => ['route-decide', p.runDir(), '7', '--route', '--reason', 'x'], message: /request 7 is not a route request in this run's record\. Nothing was written\./ });
verbRefusal('a request for another pass than the next one', { setup: p => { atPass2(p); assert.equal(gate.recordRouteRequest(p.runDir(), { pass: 3, channel: 'cli' }).ok, true); }, args: p => ['route-decide', p.runDir(), '1', '--route', '--reason', 'x'], message: /request 1 is for pass 3, but the run's next pass is 2\. Nothing was written\./ });
verbRefusal('a folder that is not a run', { args: p => ['route-decide', join(p.dir, 'nope'), '--route', '--reason', 'x'], message: /route-decide: .*nope is not a run folder\. Nothing was written\./ });
// CHANGED ACCEPTED ROW (0.8.4 S4, the floor; OLD/NEW/WHY). OLD: 'a run with no ladder' was a refusal row of route-decide ("this run has no ladder, so there is no first layer to change. Nothing was written."). NEW: the same input (a chain with a layer 3, no ladder) is routed, so the row asserts
// the route is written (exit 0); the refusal that remains for it is a chain with no layer 3 (test/route-floor.test.js R5). WHY: control 1 ships for any layered chain with a layer 3 (D27 option 1e); the ladder-only refusal was the gate.
test('a run with no ladder: route-decide records the route (0.8.4 S4: it was refused before)', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'rtnl'))); atPass2(p, []);
  try { const r = p.run(['route-decide', p.runDir(), '--route', '--reason', 'x']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.doesNotMatch(r.stdout + r.stderr, /no ladder/); } finally { p.done(); }
});
verbRefusal('a pause that is not answered', { setup: p => atRevise1(p), args: p => ['route-decide', p.runDir(), '--route', '--reason', 'x'], message: /the run waits for an answer to revise-1; give that first\. Nothing was written\./ });
verbRefusal('the ladder\'s credit', { setup: p => atPass2(p, ['--ladder', '--ladder-credit', '2']), args: p => ['route-decide', p.runDir(), '--route', '--reason', 'x'], message: /pass 2 is one of the first 2 passes, the ladder's credit/ });
verbRefusal('a stage of the next pass on disk', { setup: p => { atPass2(p); writeFileSync(join(p.runDir(), 'ldebate-2-x2-l1.md'), 'x'); }, args: p => ['route-decide', p.runDir(), '--route', '--reason', 'x'], message: /pass 2 already has a stage on disk \(ldebate-2-x2-l1\.md\)/ });
verbRefusal('a run stopped at a round limit', { setup: p => { atPass2(p); writeFileSync(join(p.runDir(), 'STOPPED-overseer_cap.json'), '{}'); }, args: p => ['route-decide', p.runDir(), '--route', '--reason', 'x'], message: /this run is stopped at its overseer-round limit, and waits for --continue or --finish; answer that first\./ });   // CHANGED (0.8.4 S5 U-C1 fix-up 3, A-DRAFT, H-FLOOR-a): OLD /this run is stopped at a limit that waits for --continue or --finish; answer that first./
verbRefusal('a run stopped at a stall with no pass left (0.8.4 S5 U-C1 fix-up 3: the refusal names the stop and offers only --finish)', { setup: p => { atPass2(p); writeFileSync(join(p.runDir(), 'STOPPED-stall_stop.json'), '{}'); writeFileSync(join(p.runDir(), 'report-partial.json'), JSON.stringify({ stop: { kind: 'stall_stop', why: 'top_layer', top_layer: 3, pass: 2, overseer_round: 2, pass_left: false } })); }, args: p => ['route-decide', p.runDir(), '--route', '--reason', 'x'], message: /this run is stopped because an objection stood unchanged and could not be passed up, and waits for --finish \(no pass is left, so there is no --continue\); answer that first\./ });

test('RT-9 N7 at the CLI: after an objection from LAYER 2 the flag and the verb\'s --route are refused with the restart sentence and record nothing; a decline still works', () => {
  const p = project(chainOf(critics('o', 'x', 'x', 'rt9')));
  try {
    atPass2(p);
    assert.ok(p.files().includes('panel-1-l2.md') && p.files().includes('NEEDS-revise-1.md'), 'the fixture reached layer 2 and paused');
    const before = snap(p.runDir());
    const flag = p.run(FLAG(p));
    assert.equal(flag.status, 2, flag.stdout + flag.stderr);
    assert.match(flag.stderr, /--next-pass-layer-3: pass 1 ended with an objection from layer 2, and a pass after that restarts at layer 1, so it cannot be routed to layer 3\. Nothing was recorded, run or spent\./);
    const verb = p.run(['route-decide', p.runDir(), '--route', '--reason', 'x']);
    assert.equal(verb.status, 2, verb.stdout + verb.stderr);
    assert.match(verb.stderr, /route-decide: pass 1 ended with an objection from layer 2/);
    assert.deepEqual(snap(p.runDir()), before, 'nothing was recorded');
    assert.equal(gate.recordRouteRequest(p.runDir(), { pass: 2, channel: 'cli' }).ok, true, 'a request that was recorded earlier (the writer, not the flag)');
    const decline = p.run(['route-decide', p.runDir(), '1', '--decline', '--reason', 'the restart begins at layer 1']);
    assert.equal(decline.status, 0, decline.stdout + decline.stderr);
  } finally { p.done(); }
});

// RT-10: N7 in the library, one row per case, through the guarded import: on a tree without src/route-layer.js each row fails on its own
// CHANGED ACCEPTED TEST (0.8.4 seats unit). OLD: RT-10a read plan-china-high-council, which seated DeepSeek V4.1 Flash on layers 1 and 2 as shipped. After the China high roster changed (Muad 10 Nov 2026 01:56) the test built that shape from a copy of the file (a layer-1 seat replaced by the layer-2 DeepSeek seat), and with the claude re-seat the shipped chain itself has it: plan-claude-council seats Sonnet 5.5 on layer 1 and TWICE on layer 2. NEW: the test reads the shipped plan-claude-council. WHY: a fixture that edits a copy checks nothing about the shipped file; the real chain has one model on two layers AND twins on one layer.
const shipped = () => JSON.parse(readFileSync(join(root, 'chains', 'plan-claude-council.json'), 'utf8'));
test('RT-10a one model on layers 1 and 2 and twice on layer 2 (the shipped plan-claude-council, Sonnet 5.5): the layer-1 seat\'s file is allowed and both layer-2 seats\' files are refused, on a config whose keys were NOT registered before the call', () => {
  const reg = shipped(); registerSeatKeys(reg);
  const sonnets = reg.seats.critics.filter(c => c.model === 'claude-sonnet-5-5');
  assert.deepEqual(sonnets.map(c => c.layer), [1, 2, 2], 'precondition: Sonnet 5.5 is seated on layer 1 and twice on layer 2');
  const [k1, k2, k3] = sonnets.map(seatKeyOf);
  assert.equal(new Set([k1, k2, k3]).size, 3, 'precondition: the three seats get three keys');
  assert.equal(rl.routeLayerRefusal(shipped(), [`panel-1-${k1}.md`], 2), null, 'the layer-1 seat objected: allowed');
  assert.equal(rl.routeLayerRefusal(shipped(), [`panel-1-${k2}.md`], 2).code, 'route_after_upper_objection', 'the first layer-2 seat objected: refused');
  assert.equal(rl.routeLayerRefusal(shipped(), [`panel-1-${k3}.md`], 2).code, 'route_after_upper_objection', 'the second layer-2 seat (a twin) objected: refused');
  const haiku = reg.seats.critics.filter(c => c.model === 'claude-haiku-5-5').map(seatKeyOf);
  for (const k of haiku) assert.equal(rl.routeLayerRefusal(shipped(), [`panel-1-${k}.md`], 2), null, `the Haiku twin ${k} (layer 1): allowed`);
});
const mockCfg = { seats: { critics: [{ provider: 'mock', model: 'a', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'b', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'c', lab: 'l3', layer: 3 }, { provider: 'mock', model: 'd', lab: 'opus5.5-sub', layer: 1 }] } };
test('RT-10b the file-name grammar: reask, retry, answered, question and a lab with dots and hyphens map to their layer', () => {
  for (const f of ['panel-1-l1.md', 'panel-1-l1-reask1.md', 'panel-1-l1-retry.md', 'panel-1-l1-answered.md', 'panel-1-l1-question.md', 'panel-1-l1-reask2-retry.md', 'panel-1-opus5.5-sub-reask1-retry.md']) assert.equal(rl.routeLayerRefusal(mockCfg, [f], 2), null, `${f} is layer 1`);
  for (const f of ['panel-1-l2.md', 'panel-1-l2-reask1-retry.md']) assert.equal(rl.routeLayerRefusal(mockCfg, ['panel-1-l1.md', f], 2).code, 'route_after_upper_objection', `${f} is layer 2`);
  assert.equal(rl.routeLayerRefusal(mockCfg, ['panel-1-l1.md', 'panel-1-l1.usage.json', 'panel-1-l1.prompt.json', 'NEEDS-revise-1.md'], 2), null, 'companion files are not panel files');
});
test('RT-10c fail closed: a panel file whose key maps to no layer, and a pass with no panel file, are refused as unknown', () => {
  assert.equal(rl.routeLayerRefusal(mockCfg, ['panel-1-l1.md', 'panel-1-zz.md'], 2).code, 'route_layer_unknown');
  assert.equal(rl.routeLayerRefusal(mockCfg, ['panel-1-l1-xyz.md'], 2).code, 'route_layer_unknown', 'a suffix outside the grammar');
  assert.equal(rl.routeLayerRefusal(mockCfg, ['NEEDS-revise-1.md'], 2).code, 'route_layer_unknown');
});
test('RT-10d layer 3 counts as an upper objection, and only the pass that ended is read', () => {
  assert.equal(rl.routeLayerRefusal(mockCfg, ['panel-1-l1.md', 'panel-1-l3.md'], 2).code, 'route_after_upper_objection');
  assert.equal(rl.routeLayerRefusal(mockCfg, ['panel-1-l1.md', 'panel-2-l3.md'], 2), null, 'panel-2-* belongs to the next pass, not the one that ended');
});

test('RT-11a a run.json ladderSteps entry that no routed decision backs is refused at the resume start, with the way out; with a routed decision behind it the resume goes on', () => {
  const p = fresh('x', 'x', 'o', 'rt11a');
  try {
    writeFileSync(join(p.runDir(), 'run.json'), JSON.stringify({ ...p.saved(), ladderSteps: [{ pass: 2, floor: 3, at: '2026-10-30T00:00:00.000Z', via: 'cli' }] }));
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /run\.json holds a ladderSteps entry for pass 2 that no routed decision in the gate ledger backs .*delete the `ladderSteps` line from run\.json .*ask again with --next-pass-layer-3 and route it with `council route-decide`\. Nothing was run and nothing was spent\./);
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false);
    assert.equal(p.run(['route-decide', p.runDir(), '--route', '--reason', 'ready']).status, 0);
    // CHANGED ACCEPTED (0.8.4 S4, C&C's Q-m migration; OLD/NEW/WHY): OLD: this resume exited 22 at the layer-3 (ladder) sign-off. NEW: with the build-check wording in force the run waits at build-check-1, a test-only handler answers good_to_build, and the resumed run ends AGREED (exit 0). WHY: the handler's build check follows layer 3's sign-off (CA4); every other assertion of the row is unchanged.
    const ok = p.runChecked(['--resume', p.runDir()]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /ladder: pass 2 starts at layer 3/);
  } finally { p.done(); }
});
test('RT-11b routedStepsOf: a missing ledger is no steps, a decline is no step, an unreadable ledger is not ok', () => {
  const d = mkdtempSync(join(tmpdir(), 'rtd-'));
  try {
    assert.deepEqual(runControls.routedStepsOf(d), { ok: true, steps: [] });
    assert.equal(gate.recordRouteRequest(d, { pass: 2, channel: 'cli' }).ok, true);
    assert.equal(gate.recordRouteDecision(d, { requestSeq: 1, pass: 2, decision: 'declined', decidedBy: 'handler', reason: 'no' }).ok, true);
    assert.deepEqual(runControls.routedStepsOf(d), { ok: true, steps: [] });
    writeFileSync(join(d, 'gate-ledger.jsonl'), 'not json\n');
    assert.equal(runControls.routedStepsOf(d).ok, false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('RT-12 wiring: the exit code is 27, not 21 and not a finished code; the verb and the two new flags are on the lists the unknown-flag and caps rules read', () => {
  assert.equal(exitCodes.EXIT_ROUTE_REQUESTED, 27);
  assert.notEqual(exitCodes.EXIT_ROUTE_REQUESTED, 21);
  assert.equal(exitCodes.FINISHED_EXIT_CODES.has(27), false);
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  assert.match(cli, /const SUBCOMMANDS = new Set\(\[[^\]]*'route-decide'/);
  assert.match(cli, /const VALUE_FLAGS = new Set\(\['(?:stop-gate', ')?reason'/);   // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026): the set now starts with 'stop-gate' (the relayed choices name their gate); the route flags are still in it
  assert.match(cli, /const BOOLEAN_FLAGS = new Set\(\['route'/);
  assert.ok(caps.NON_SPENDING_SUBCOMMANDS.includes('route-decide'));
});

test('RT-13 GOOD HALF route-decide accepts --route and --reason', () => {
  const g = fresh('x', 'x', 'o', 'rt13g');
  try { assert.equal(g.run(['route-decide', g.runDir(), '--route', '--reason', 'ready']).status, 0); } finally { g.done(); }
});
// the main path would read the two new global flags as known and ignore them (a paid pass would run at layer 1 while the person thought it routed): one test per flag
for (const extra of [['--route'], ['--reason', 'x']]) {
  test(`RT-13 the main path refuses ${extra[0]}: it belongs to council route-decide, nothing runs`, () => {
    const p = fresh('x', 'x', 'o', `rt13${extra[0].slice(2)}`);
    try {
      const before = snap(p.runDir());
      const r = p.run(['--resume', p.runDir(), ...extra]);
      assert.equal(r.status, 2, `${extra}: ${r.stdout}${r.stderr}`);
      // CHANGED ACCEPTED ROW (0.8.4 S20 slice 2, #16c; my own R2 row). OLD: both flags were refused with "an option of `council route-decide` only". NEW: `--reason` is also an option of `council pause` (the handler's own reason), so its refusal on the main path names both commands; `--route` is unchanged.
      // WHY: the old sentence for `--reason` would now be untrue. The refusal itself, the exit code and "nothing ran" are unchanged.
      const named = extra[0] === '--route' ? 'an option of `council route-decide` only' : 'an option of `council route-decide`, `council pause` and `council accept` only';   // CHANGED ACCEPTED (0.8.4 D2): was '... `council route-decide` and `council pause` only'; `council accept` takes --reason too (the reason for accepting a plan as it stands), so the old sentence would be untrue
      assert.ok(r.stderr.includes(`${extra[0]}: ${named} (`) && /Nothing was run and nothing was spent\.\s*$/.test(r.stderr), r.stderr);
      assert.deepEqual(snap(p.runDir()), before, 'nothing ran');
    } finally { p.done(); }
  });
}

// R2-tty (Mini-C&C R417-R420), the real flag through the real CLI. A spawned child has no terminal, so the bare flag cannot be recorded here (the terminal's own form is tested in process: test/route-tty.test.js RTT-1).
test('RT-14 the relayed form with a missing or empty --person-words is refused by the flag\'s name, writes nothing, and the good half (words given) records', () => {
  const p = fresh('x', 'x', 'o', 'rt14');
  try {
    const before = snap(p.runDir());
    for (const argv of [['--resume', p.runDir(), '--next-pass-layer-3', '--person-words'], ['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', ''], ['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', '   ']]) {
      const r = p.run(argv);
      assert.equal(r.status, 2, `${JSON.stringify(argv.slice(3))}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /--next-pass-layer-3: --person-words needs the person's words after it, as the person typed them\. Nothing was recorded, run or spent\./);
      assert.deepEqual(snap(p.runDir()), before, 'the folder is unchanged');
    }
    assert.equal(p.run(FLAG(p)).status, 27, 'GOOD HALF: with words the request is recorded');
  } finally { p.done(); }
});

test('RT-15 the bare flag without a terminal is refused, names the relayed form and writes nothing', () => {
  const p = fresh('x', 'x', 'o', 'rt15');
  try {
    const before = snap(p.runDir());
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--next-pass-layer-3: a request typed by the person needs a person at a terminal: stdin and stdout must both be a terminal\. A handler session gives the person's answer with --person-words "<their answer>"\. Nothing was recorded, run or spent\./);
    assert.deepEqual(snap(p.runDir()), before, 'the folder is unchanged');
    assert.equal(ledger(p).length, 0);
  } finally { p.done(); }
});

test('RT-16 --reason beside the relayed flag is refused by its own name (the relay sentence is the line\'s, never a free reason) and writes nothing', () => {
  const p = fresh('x', 'x', 'o', 'rt16');
  try {
    const before = snap(p.runDir());
    const r = p.run([...FLAG(p), '--reason', 'because I say so']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^--reason: an option of `council route-decide`, `council pause` and `council accept` only/m, 'the early stray-option refusal answers first (the pure goes-alone rule is pinned in test/route-tty.test.js RTT-5)');   // CHANGED ACCEPTED (0.8.4 D2): was /^--reason: an option of `council route-decide` and `council pause` only/m; the same sentence RT-13 and owner-pause already pin, now naming `council accept`, the verb that takes --reason from the person
    assert.deepEqual(snap(p.runDir()), before, 'the folder is unchanged');
  } finally { p.done(); }
});

// The person's own path through the real CLI (C&C, R2-tty): the bare flag run under a real pseudo-terminal (python3 pty.spawn gives the child a pty for stdin, stdout and stderr), so cli.js passes real terminal streams to askRoute. This is the one row that
// drives the terminal's form; the rule itself is tested in process (test/route-tty.test.js RTT-1). The box has python3 with the standard pty module (Server Controller, 4 Nov 2026).
test('RT-17 the bare flag under a real terminal (a pty) records the PERSON\'s request: exit 27, channel cli, no words', () => {
  const p = fresh('x', 'x', 'o', 'rt17');
  try {
    const code = 'import os, pty, sys\nsys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))\n';
    const r = spawnSync('python3', ['-I', '-c', code, process.execPath, join(root, 'src', 'cli.js'), '--resume', p.runDir(), '--next-pass-layer-3'], { cwd: p.dir, encoding: 'utf8', input: '', env: { PATH: process.env.PATH, HOME: p.dir } });
    assert.equal(r.status, 27, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, RECORDED);
    const lines = ledger(p);
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].event, lines[0].by, lines[0].channel, lines[0].person_words], ['route_requested', 'person', 'cli', null]);
  } finally { p.done(); }
});

test('RT-18 --person-words on a resume without --next-pass-layer-3 is refused by name and writes nothing (it used to be dropped)', () => {
  const p = fresh('x', 'x', 'o', 'rt18');
  try {
    const before = snap(p.runDir());
    const r = p.run(['--resume', p.runDir(), '--person-words', 'Yes, route it.']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^--person-words: an option of `--next-pass-layer-3` on a resume .* only\. Nothing was recorded, run or spent\./m);
    assert.deepEqual(snap(p.runDir()), before, 'the folder is unchanged');
  } finally { p.done(); }
});

