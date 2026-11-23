// 0.8.4 S20 slice 2, #16c ("pause after this round"), step 3: the library and the verb. A run folder is built by hand (stage files, a stop marker, the gate ledger through the real writers); the modules are used through NAMESPACE imports, so a tree
// without the new functions still LOADS this file and each row fails on its own by TypeError. Offline, $0. The chain seam and the real-CLI rows are test/owner-pause-seam.test.js.
//   OP-1 pauseDue;  OP-2 pausedPointOf (one condition missing at a time);  OP-3 pausePointOf and the four callers (route flag, N7, ruling-add) at an owner pause;  OP-4 settlePauseAtResume;  OP-5 requestPause;  OP-6 the verb;  OP-7 pausesOf, the report key and the schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, hostname } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rc from '../src/run-controls.js';
import * as gate from '../src/gate.js';
import { LEDGER_LOCK_FILE as ledgerLock } from '../src/gate-ledger.js';
import * as relayCli from '../src/gate-relay-cli.js';
import * as stopFiles from '../src/stop-files.js';
import * as reportShape from '../src/report-shape.js';
import { LOCK_FILE } from '../src/run-lock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const now = () => Date.parse('2026-11-04T12:00:00.000Z');
const critics = [
  { provider: 'mock', model: 'mock-critic-script-x-op1', lab: 'l1', layer: 1 },
  { provider: 'mock', model: 'mock-critic-script-x-op2', lab: 'l2', layer: 2 },
  { provider: 'mock', model: 'mock-critic-script-o-op3', lab: 'l3', layer: 3 }];
const config = { name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics } };
const ladder = { credit: 1 };
const sink = (isTTY = false) => { let t = ''; return { isTTY, write: s => { t += s; }, get text() { return t; } }; };
const terminal = { stdin: { isTTY: true }, stdout: sink(true) };   // both streams a terminal: the person at a keyboard
// a run folder after pass 1 (panel and critique files; layer 1 objected), not stopped: optional pieces are added by the rows
const runFolder = ({ stages = ['panel-1-l1.md', 'critique-1.md', 'revise-1.md'] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-pause-lib-'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'lad', task: 'tasks/t.md', ladder }));
  for (const f of stages) writeFileSync(join(dir, f), 'x\n');
  return dir;
};
const request = (dir, over = {}) => { const r = gate.recordPauseRequest(dir, { pass: 1, by: 'person', channel: 'cli', ...over }, { now }); assert.equal(r.ok, true, JSON.stringify(r)); return r.seq; };
const marker = (dir, requestSeq) => stopFiles.writeStoppedMarker(dir, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, requestSeq });
// a run that STOPPED at the owner's pause after pass 1: stage files, the request in the ledger, the marker naming it, no live lock
const paused = () => { const dir = runFolder(); const seq = request(dir); marker(dir, seq); return { dir, seq }; };
const liveLock = dir => writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));   // the parent process (the test runner) is alive and is not this process
const ledgerEvents = dir => readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(l => l.event);
const done = (...dirs) => dirs.forEach(d => rmSync(d, { recursive: true, force: true }));

test('OP-1 pauseDue: due only for round >= 2, an untaken request and a round with NO stage on disk; never for a replayed round, after pause_taken or pause_lapsed, or with no request; a damaged ledger is a problem, not a throw', () => {
  const dir = runFolder();
  try {
    assert.equal(rc.pauseDue(dir, 2), null, 'no request, no pause');
    const seq = request(dir);
    assert.deepEqual(rc.pauseDue(dir, 2), { request_seq: seq }, 'GOOD HALF: an untaken request, round 2, no stage of round 2');
    assert.equal(rc.pauseDue(dir, 1), null, 'never before pass 1 has run');
    writeFileSync(join(dir, 'panel-2-l1.md'), 'x\n');
    assert.equal(rc.pauseDue(dir, 2), null, 'a replayed round (it has a stage) is never a head to stop at');
    assert.deepEqual(rc.pauseDue(dir, 3), { request_seq: seq }, 'the next round with no stage is');
    assert.equal(gate.recordPauseSettled(dir, { event: 'pause_taken', requestSeq: seq }, { now }).ok, true);
    assert.equal(rc.pauseDue(dir, 3), null, 'taken');
    const seq2 = request(dir);
    assert.equal(gate.recordPauseSettled(dir, { event: 'pause_lapsed', requestSeq: seq2 }, { now }).ok, true);
    assert.equal(rc.pauseDue(dir, 3), null, 'lapsed');
    const e = runFolder();
    request(e);
    writeFileSync(join(e, 'gate-ledger.jsonl'), `${readFileSync(join(e, 'gate-ledger.jsonl'), 'utf8')}this is not a ledger line\n`);
    const f = runFolder(); const sf = request(f);   // a torn tail (a write in flight) is not an error: whole lines are read, the tail is ignored
    writeFileSync(join(f, 'gate-ledger.jsonl'), `${readFileSync(join(f, 'gate-ledger.jsonl'), 'utf8')}{"schema":"gate-ledger/1","seq":2,"pre`);
    assert.deepEqual(rc.pauseDue(f, 2), { request_seq: sf }, 'a torn tail does not hide the request');
    writeFileSync(join(f, ledgerLock), JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));   // another live process holds the ledger lock (a write of its own in flight)
    const t0 = Date.now(); assert.deepEqual(rc.pauseDue(f, 2), { request_seq: sf }, 'the question does not wait for, or fail on, the ledger lock'); assert.ok(Date.now() - t0 < 1000, 'and does not wait');
    done(f);
    let r; assert.doesNotThrow(() => { r = rc.pauseDue(e, 2); });
    assert.match(r.problem, /could not be read/);
    done(e);
  } finally { done(dir); }
});

test('OP-2 pausedPointOf: stopped means the marker AND the untaken ledger request AND a stage on disk AND no other live process on the run lock; each missing alone is "not paused" (good half first)', () => {
  const { dir, seq } = paused();
  try {
    assert.deepEqual(rc.pausedPointOf(dir), { ok: true, after: 1, pass: 2, request_seq: seq }, 'GOOD HALF');
    const own = rc.pausedPointOf(dir, readdirSync(dir)); assert.equal(own.ok, true, 'the files may be passed in');
    // no marker
    const a = runFolder(); request(a); assert.equal(rc.pausedPointOf(a).ok, false, 'a request with no marker is a run that has not stopped'); done(a);
    // a planted marker with no ledger line behind it
    const b = runFolder(); marker(b, 5); assert.equal(rc.pausedPointOf(b).ok, false, 'a marker alone is not a pause'); done(b);
    // a marker of another cause
    const c = runFolder(); const cs = request(c); stopFiles.writeStoppedMarker(c, { stoppedBy: 'price_refused', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true }); assert.equal(rc.pausedPointOf(c).ok, false); assert.ok(cs); done(c);
    // the request is taken / lapsed
    for (const event of ['pause_taken', 'pause_lapsed']) { const d = paused(); assert.equal(gate.recordPauseSettled(d.dir, { event, requestSeq: d.seq }, { now }).ok, true); assert.equal(rc.pausedPointOf(d.dir).ok, false, event); done(d.dir); }
    // no stage on disk at all
    const e = runFolder({ stages: [] }); const es = request(e); marker(e, es); assert.equal(rc.pausedPointOf(e).ok, false, 'no pass has run'); done(e);
    // another live process holds the run lock: the run is going on
    liveLock(dir);
    assert.equal(rc.pausedPointOf(dir).ok, false, 'a live run is not a paused one');
    writeFileSync(join(dir, LOCK_FILE), 'not json at all');
    assert.equal(rc.pausedPointOf(dir).ok, false, 'an unreadable lock may be a live run: it fails closed');
  } finally { done(dir); }
});

test('OP-3 pausePointOf: an owner\'s pause answers like a revise pause (pass after the last one); a pending external answer comes first; an older answered NEEDS-revise file does not shadow it; a plain run is as before', () => {
  const { dir } = paused();
  try {
    assert.deepEqual([rc.pausePointOf(dir, readdirSync(dir)).ok, rc.pausePointOf(dir, readdirSync(dir)).pass], [true, 2]);
    const a = runFolder({ stages: ['NEEDS-revise-1.md', 'revise-1.md', 'panel-1-l1.md', 'panel-2-l1.md', 'critique-2.md'] }); const sa = request(a, { pass: 2 }); marker(a, sa);
    assert.equal(rc.pausePointOf(a, readdirSync(a)).pass, 3, 'the owner\'s pause after pass 2, not the older NEEDS-revise-1 (which would say pass 2, a pass that has stages)'); done(a);
    const b = runFolder({ stages: ['NEEDS-revise-2.md', 'panel-2-l1.md'] }); const sb = request(b, { pass: 2 }); marker(b, sb);
    assert.deepEqual(rc.pausePointOf(b, readdirSync(b)), { ok: false, why: 'pending', label: 'revise-2' }, 'an unanswered external seat is answered first'); done(b);
    const c = runFolder({ stages: ['NEEDS-revise-1.md', 'revise-1.md', 'panel-1-l1.md'] });
    assert.deepEqual(rc.pausePointOf(c, readdirSync(c)), { ok: true, after: 1, pass: 2 }, 'a revise pause is as before'); done(c);
    const d = runFolder();
    assert.deepEqual(rc.pausePointOf(d, readdirSync(d)), { ok: false, why: 'none' }, 'a run that is neither'); done(d);
  } finally { done(dir); }
});

test('OP-3b the route flag and N7 work at an owner pause: routeRefusal and requestRoute (which holds the run lock itself) ask pass 2; N7 reads pass 1\'s panel files, not a revise file', () => {
  const { dir } = paused();
  try {
    assert.deepEqual(rc.routeRefusal(dir, { ladder, config }), { ok: true, pass: 2 }, 'GOOD HALF: layer 1 objected, so a route may go on');
    const res = rc.requestRoute(dir, { channel: 'cli', ladder, config }, { now });
    assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.pass, 2);
    assert.ok(ledgerEvents(dir).includes('route_requested'));
    // N7 at the same kind of pause: the pass that ended was objected to from layer 2 -> refused for THAT reason
    const e = runFolder({ stages: ['panel-1-l1.md', 'panel-1-l2.md', 'critique-1.md'] }); marker(e, request(e));
    assert.equal(rc.routeRefusal(e, { ladder, config }).code, 'route_after_upper_objection'); done(e);
    // no panel file for the pass that ended: fails closed, with its own code
    const f = runFolder({ stages: ['critique-1.md'] }); marker(f, request(f));
    assert.equal(rc.routeRefusal(f, { ladder, config }).code, 'route_layer_unknown'); done(f);
    // a live run: not a pause, so the old refusal
    liveLock(dir);
    assert.equal(rc.routeRefusal(dir, { ladder, config }).code, 'route_not_at_revise');
  } finally { done(dir); }
});

test('OP-3c ruling-add works at an owner pause (dated pass 2, no NEEDS-revise file) and refuses with its old sentence on a run that is neither; once the resume has taken the request it is refused again', () => {
  const { dir } = paused();
  try {
    const out = sink(); const err = sink();
    assert.equal(relayCli.rulingAddCommand([dir], { work: dir, ruling: 'Use black tea.', stdout: out, stderr: err, now }), 0, err.text);
    assert.match(out.text, /a ruling for pass 2 waits/);
    const plain = runFolder(); const e2 = sink();
    assert.equal(relayCli.rulingAddCommand([plain], { work: plain, ruling: 'Use black tea.', stdout: sink(), stderr: e2, now }), 2);
    assert.match(e2.text, /the run is not at a revise pause, so there is no next pass to give a ruling to/); done(plain);
    assert.equal(rc.settlePauseAtResume(dir, { now }).event, 'pause_taken');   // the resume took the request: the pause is over (the marker file itself is cleared by the CLI)
    const e3 = sink();
    assert.equal(relayCli.rulingAddCommand([dir], { work: dir, ruling: 'Another.', stdout: sink(), stderr: e3, now }), 2);
    assert.match(e3.text, /the run is not at a revise pause/);
  } finally { done(dir); }
});

test('OP-4 settlePauseAtResume: the request the marker names is TAKEN; any other standing request LAPSES (a stale one must not pause an unrelated sitting); none = nothing; a second call changes nothing', () => {
  const { dir, seq } = paused();
  try {
    assert.deepEqual(rc.settlePauseAtResume(dir, { now }), { ok: true, event: 'pause_taken', request_seq: seq, seq: 2 });
    assert.deepEqual(rc.settlePauseAtResume(dir, { now }), { ok: true, event: null }, 'idempotent');
    assert.deepEqual(ledgerEvents(dir), ['pause_requested', 'pause_taken']);
    // a request standing with no marker (the sitting ended some other way): lapses
    const a = runFolder(); const sa = request(a);
    assert.deepEqual(rc.settlePauseAtResume(a, { now }), { ok: true, event: 'pause_lapsed', request_seq: sa, seq: 2 });
    assert.equal(rc.pauseDue(a, 2), null, 'and it no longer pauses'); done(a);
    // a marker of another cause does not take it either
    const b = runFolder(); request(b); stopFiles.writeStoppedMarker(b, { stoppedBy: 'overseer_cap', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true });
    assert.equal(rc.settlePauseAtResume(b, { now }).event, 'pause_lapsed'); done(b);
    // an owner_pause marker that names a DIFFERENT request than the standing one: lapses
    const c = runFolder(); request(c); marker(c, 99);
    assert.equal(rc.settlePauseAtResume(c, { now }).event, 'pause_lapsed'); done(c);
    assert.deepEqual(rc.settlePauseAtResume(runFolder(), { now }), { ok: true, event: null }, 'no ledger, nothing to settle');
  } finally { done(dir); }
});

test('OP-5 requestPause: refused when nobody runs the run, on a tree member, and while a request is open (nothing written each time); with a live holder it records the pass in progress (the highest with a stage, at least 1)', () => {
  const dir = runFolder({ stages: [] });
  try {
    const no = rc.requestPause(dir, { by: 'person', channel: 'cli' }, { now });
    assert.deepEqual([no.ok, no.code], [false, 'pause_not_running']);
    liveLock(dir);
    assert.deepEqual([rc.requestPause(dir, { by: 'person', channel: 'cli', tree: true }, { now }).code], ['pause_tree_member']);
    assert.equal(readdirSync(dir).includes('gate-ledger.jsonl'), false, 'the refusals wrote nothing');
    writeFileSync(join(dir, LOCK_FILE), 'not json at all');   // a lock nobody can read is not a run we know to be running
    assert.deepEqual([rc.requestPause(dir, { by: 'person', channel: 'cli' }, { now }).code], ['pause_not_running']);
    liveLock(dir);
    const first = rc.requestPause(dir, { by: 'person', channel: 'cli' }, { now });
    assert.deepEqual([first.ok, first.pass], [true, 1], 'before any stage: pass 1');
    assert.deepEqual([rc.requestPause(dir, { by: 'person', channel: 'cli' }, { now }).code], ['pause_request_open']);
    writeFileSync(join(dir, 'critique-3.md'), 'x\n'); writeFileSync(join(dir, 'panel-2-l1.md'), 'x\n');
    assert.equal(rc.settlePauseAtResume(dir, { now }).event, 'pause_lapsed');
    assert.equal(rc.requestPause(dir, { by: 'handler', channel: 'session', reason: 'the plan looks ready' }, { now }).pass, 3, 'the highest pass with a stage');
    assert.equal(rc.highestStagedPass(['panel-1-l1.md', 'rule-4-1.md', 'revise-9.md', 'NEEDS-revise-2.md']), 4, 'only the stage families count');
  } finally { done(dir); }
});

test('OP-6 the verb: three ways to ask (terminal person, relayed person with words, handler with a reason), each recorded as such; words and a reason together, a stopped run, a missing run and extra arguments are refused with nothing written', () => {
  const dir = runFolder(); liveLock(dir);
  const run = (positional, opts = {}) => { const out = sink(true); const err = sink(); const code = relayCli.pauseCommand(positional, { work: dir, stdin: { isTTY: true }, stdout: out, stderr: err, now, readRunMeta: d => JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')), ...opts }); return { code, out: out.text, err: err.text }; };
  const last = () => JSON.parse(readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).at(-1));
  try {
    let r = run([dir]);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /pause: recorded \(request 1\)\. The run finishes the pass it is in/); assert.match(r.out, /council --resume /);
    assert.deepEqual([last().by, last().channel, last().person_words, last().reason], ['person', 'cli', null, null]);
    assert.equal(rc.settlePauseAtResume(dir, { now }).event, 'pause_lapsed');
    r = run([dir], { personWords: 'Yes, pause after this round.' });
    assert.equal(r.code, 0, r.err); assert.deepEqual([last().by, last().channel, last().person_words, last().reason], ['person', 'session', 'Yes, pause after this round.', rc.RELAY_REASON]);
    rc.settlePauseAtResume(dir, { now });
    r = run([dir], { reason: 'the plan is ready for the person to read' });
    assert.equal(r.code, 0, r.err); assert.deepEqual([last().by, last().channel, last().person_words, last().reason], ['handler', 'session', null, 'the plan is ready for the person to read']);
    const before = readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8');
    for (const [name, positional, opts, re] of [
      ['both', [dir], { personWords: 'Yes.', reason: 'x' }, /carries no reason of its own/],
      ['open', [dir], {}, /a request to pause the run waits to be taken/],
      ['no run', [join(dir, 'nowhere')], {}, /is not a run folder/],
      ['extra', [dir, 'again'], {}, /usage: council pause/],
      ['none', [], {}, /usage: council pause/]]) {
      r = run(positional, opts); assert.equal(r.code, 2, name); assert.match(r.err, re, name);
    }
    assert.equal(readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8'), before, 'nothing was written by a refusal');
    rmSync(join(dir, LOCK_FILE)); rc.settlePauseAtResume(dir, { now });
    r = run([dir]); assert.equal(r.code, 2); assert.match(r.err, /the run is not running.* Nothing was written\./);
  } finally { done(dir); }
});

test('OP-6b the bare form is the PERSON\'S and needs a terminal: with stdin and stdout both a terminal it records by person / cli; with either one (or both) not, it refuses with the two session forms named and writes nothing, even against a live run; --person-words and --reason need no terminal', () => {
  const dir = runFolder(); liveLock(dir);
  const call = (opts, streams) => { const out = sink(streams.out); const err = sink(); const code = relayCli.pauseCommand([dir], { work: dir, stdin: { isTTY: streams.in }, stdout: out, stderr: err, now, readRunMeta: d => JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')), ...opts }); return { code, out: out.text, err: err.text }; };
  const written = () => readdirSync(dir).includes('gate-ledger.jsonl');
  try {
    for (const [name, streams] of [['stdin only', { in: true, out: false }], ['stdout only', { in: false, out: true }], ['neither', { in: false, out: false }]]) {
      const r = call({}, streams);
      assert.equal(r.code, 2, name); assert.match(r.err, /needs a person at a terminal: stdin and stdout must both be a terminal/, name);
      assert.match(r.err, /--person-words/, name); assert.match(r.err, /--reason/, name); assert.match(r.err, /Nothing was written\./, name);
      assert.equal(written(), false, `${name}: the live run's ledger was not touched`);
    }
    const ok = call({}, { in: true, out: true });
    assert.equal(ok.code, 0, ok.err);
    const l = JSON.parse(readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).at(-1));
    assert.deepEqual([l.by, l.channel], ['person', 'cli']);
    rc.settlePauseAtResume(dir, { now });
    assert.equal(call({ personWords: 'Yes, pause it.' }, { in: false, out: false }).code, 0, 'the relayed form needs no terminal');
    rc.settlePauseAtResume(dir, { now });
    assert.equal(call({ reason: 'the plan is ready' }, { in: false, out: false }).code, 0, 'the handler\'s own form needs no terminal');
  } finally { done(dir); }
});

test('OP-7 pausesOf and report.json: one row per request with who asked and whether it was taken or lapsed; the key is absent without rows; the schema accepts the rows and rejects a bad one', async () => {
  const dir = runFolder();
  try {
    assert.deepEqual(rc.pausesOf(dir), []);
    const s1 = request(dir); assert.equal(rc.settlePauseAtResume(dir, { now }).event, 'pause_lapsed');
    const s2 = request(dir, { by: 'handler', channel: 'session', reason: 'ready' }); marker(dir, s2); assert.equal(rc.settlePauseAtResume(dir, { now }).event, 'pause_taken');
    request(dir, { pass: 2 });
    const rows = rc.pausesOf(dir);
    assert.deepEqual(rows.map(r => [r.request.seq, r.pass, r.request.by, !!r.taken, !!r.lapsed]), [[s1, 1, 'person', false, true], [s2, 1, 'handler', true, false], [5, 2, 'person', false, false]]);
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
    const cfg = { name: 'op', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [{ provider: 'mock', model: 'mock-critic-script-o-op', lab: 'c' }] } };
    const result = await (await import('../src/chain.js')).runChain({ request: 'Req.', config: cfg, log: () => {} });
    const base = { runId: 'x', chain: 'op', task: 't', result, config: cfg };
    assert.equal('pauses' in reportShape.reportJsonShape(base), false, 'absent without rows');
    assert.equal('pauses' in reportShape.reportJsonShape({ ...base, result: { ...result, pauses: [] } }), false);
    const shaped = reportShape.reportJsonShape({ ...base, result: { ...result, pauses: rows } });
    assert.equal(shaped.pauses.length, 3);
    assert.ok(validate(shaped), JSON.stringify(validate.errors, null, 2));
    for (const bad of [{ ...rows[0], pass: 0 }, { ...rows[0], request: { ...rows[0].request, by: 'robot' } }, { pass: 1 }, { ...rows[0], taken: { seq: 2 } }]) assert.equal(validate(reportShape.reportJsonShape({ ...base, result: { ...result, pauses: [bad] } })), false, JSON.stringify(bad));
  } finally { done(dir); }
});

test('OP-8 the real CLI reaches the verb: `council pause <run> --reason x` dispatches (not usage, not the route-decide refusal) and records or refuses by the lock; `--route` is still refused on `pause`; `--person-words` words are not read as the run folder', () => {
  const dir = runFolder();
  const cli = (args) => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  try {
    let r = cli(['pause', dir, '--reason', 'the plan is ready']);
    assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /pause: the run is not running/); assert.doesNotMatch(r.stderr, /usage:|route-decide/);
    r = cli(['pause', dir, '--person-words', 'Yes, pause it.']);
    assert.equal(r.status, 2); assert.match(r.stderr, /pause: the run is not running/, 'the words are a value of the flag, not a second positional');
    r = cli(['pause', dir, '--route']);
    assert.equal(r.status, 2); assert.match(r.stderr, /--route: an option of `council route-decide` only/);
    assert.equal(readdirSync(dir).includes('gate-ledger.jsonl'), false, 'nothing was written by the refusals');
    liveLock(dir);   // the test runner's parent is alive and is not the CLI process: a run somebody is running
    r = cli(['pause', dir]);
    assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /needs a person at a terminal/, 'a bare request through pipes is refused although the run IS running');
    assert.equal(readdirSync(dir).includes('gate-ledger.jsonl'), false, 'and nothing was written');
    r = cli(['pause', dir, '--reason', 'the plan is ready']);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /pause: recorded \(request 1\)/);
    const line = JSON.parse(readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).at(-1));
    assert.deepEqual([line.event, line.by, line.channel, line.reason], ['pause_requested', 'handler', 'session', 'the plan is ready']);
    r = cli(['--resume', dir, '--reason', 'x']);
    assert.equal(r.status, 2); assert.match(r.stderr, /--reason: an option of `council route-decide`, `council pause` and `council accept` only/);   // CHANGED ACCEPTED (0.8.4 D2): was /--reason: an option of `council route-decide` and `council pause` only/; `council accept` takes --reason too
  } finally { done(dir); }
});
