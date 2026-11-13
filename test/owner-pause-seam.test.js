// 0.8.4 S20 slice 2, #16c ("pause after this round"), the seams: the chain's check at the head of a pass (in process, both loops), the money rows, and the real CLI against a live mock run (COUNCIL_MOCK_HOLD_FILE holds every mock call until a file
// exists, so `council pause` runs while the run holds its lock). Offline, $0. Scripted mock judges count their asks per PROCESS (src/providers.js scriptedAsks): the CLI rows use a critic scripted `xo` (objects once, then signs off), so a run
// stopped at the head of pass 2 and resumed in a NEW process asks pass 2 as that process's first ask (objects), pass 3 as its second (signs off): the resumed run finishes at pass 3.
//   SM-1 the check at both loop heads, before anything of the pass;  SM-2 a ruling dated for the next pass does not change a prompt that already ran (the stages replay free);
//   SM-3 a live run paused by the verb stops at pass 2 (exit 23, the marker, the partial files, nothing of pass 2);  SM-4 a REFUSED resume leaves the request untaken, a plain resume takes it and replays pass 1 untouched;
//   SM-5 a stale request lapses;  SM-6 ruling-add and relay-answer at the pause reach pass 2;  SM-7 run_status;  SM-8 a request the last pass never reached stays untaken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chain from '../src/chain.js';   // a namespace import: a tree without setPauseCheck still LOADS this file and each row fails on its own
import * as runStatus from '../src/run-status.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASS2 = /^(?:panel|critique|ldebate|lreply|rule|revise)-2(?:-|\.|$)/;
const MARK = /# Rulings by the person who owns this request/;
const chainOf = (signoff, pattern, suffix, extra = {}) => ({
  name: 'seam', signoff, maxRounds: 3, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [{ provider: 'mock', model: `mock-critic-script-${pattern}-${suffix}`, lab: 'c' }] },
  ...extra,
});

// ---- SM-1, SM-2: in process ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function runWith(signoff, tag, check, { rulings } = {}) {
  const labels = []; const logs = []; const asked = []; const prompts = new Map();
  chain.setCache(null);
  chain.setPauseCheck(check ? round => { asked.push(round); return check(round); } : null);
  chain.setPromptSpy(p => { labels.push(p.label); prompts.set(p.label, `${p.system}\n${p.user}`); });
  let error = null; let result = null;
  try { result = await chain.runChain({ request: 'Plan a tea.', config: chainOf(signoff, 'xo', tag), log: s => logs.push(String(s)), ...(rulings ? { rulings } : {}) }); } catch (e) { error = e; } finally { chain.setPauseCheck(null); chain.setPromptSpy(null); }
  return { labels, logs, asked, prompts, error, result };
}
for (const signoff of ['unanimous', 'first']) {
  test(`SM-1 (${signoff} loop) the check is asked at the head of pass 2 only, before anything of it: the stop is RoundStopped owner_pause, no "Round 2" line, no call of pass 2; with no check, or one that says no, the run goes on`, async () => {
    const control = await runWith(signoff, `${signoff}-ctl`, null);
    assert.equal(control.error, null, 'GOOD HALF: with no check installed the chain runs on');
    assert.ok(control.labels.some(l => PASS2.test(l)), `fixture: pass 2 is asked when nothing stops it: ${control.labels}`);
    const no = await runWith(signoff, `${signoff}-no`, () => null);
    assert.equal(no.error, null); assert.deepEqual(no.asked, [2], 'asked once, at pass 2 (pass 1 never asks; pass 3 is not reached)');
    const stop = await runWith(signoff, `${signoff}-stop`, round => (round === 2 ? { request_seq: 7 } : null));
    assert.ok(stop.error instanceof chain.RoundStopped, String(stop.error));
    assert.deepEqual(stop.error.stop, { kind: 'owner_pause', pass: 2, overseer_round: 0, request_seq: 7 });
    assert.deepEqual(stop.asked, [2]);
    assert.equal(stop.logs.some(l => /Round 2\b/.test(l)), false, 'nothing of pass 2 was logged');
    assert.equal(stop.labels.some(l => PASS2.test(l)), false, `no call of pass 2 reached the spend path: ${stop.labels}`);
    assert.ok(stop.labels.some(l => /^revise-1/.test(l)), 'pass 1 ran to its revise');
    assert.equal(typeof stop.error.partial?.currentDraft, 'string', 'the draft as it stands is in the partial');
  });
}

// C&C's money condition: "no spend-reservations line for pass N+1". Mock seats are priced at $0, so a run on them writes no reservation and such a check could never fail; this row uses the priced mock model (mock-priced, $1000 per million tokens)
// for the writer and the reviser, a budget, and a recording reservation sink at the point where invoke() reserves a call's worst case BEFORE it sends it. The control comes first: without a pause pass 2 DOES reserve (revise-2), so the absence below means something.
async function pricedRun(tag, check) {
  const reserved = [];
  const config = chainOf('unanimous', 'xxo', tag);
  config.seats.builder = { provider: 'mock', model: 'mock-priced', lab: 'a', maxTokens: 200 };
  config.seats.reviser = { provider: 'mock', model: 'mock-priced', lab: 'a', maxTokens: 200 };
  chain.setCache(null); chain.setBudget(1000);
  chain.setReservationSink({ reserve: x => { reserved.push(x.label); return `r${reserved.length}`; }, settle() {} });
  chain.setPauseCheck(check ?? null);
  let error = null;
  try { await chain.runChain({ request: 'Plan a tea.', config, log: () => {} }); } catch (e) { error = e; } finally { chain.setPauseCheck(null); chain.setReservationSink(null); chain.setBudget(null); }
  return { reserved, error };
}
test('SM-1b MONEY: a pause at the head of pass 2 writes no reservation for any call of pass 2 (priced seats; the control shows pass 2 does reserve), while pass 1 did reserve', async () => {
  const control = await pricedRun('money-ctl', null);
  assert.equal(control.error, null, String(control.error));
  assert.ok(control.reserved.some(l => /^revise-1/.test(l)), `fixture: pass 1's revise is a priced, reserved call: ${control.reserved}`);
  assert.ok(control.reserved.some(l => /^revise-2/.test(l)), `GOOD HALF: with no pause the revise of pass 2 reserves its worst case: ${control.reserved}`);
  const paused = await pricedRun('money-stop', round => (round === 2 ? { request_seq: 3 } : null));
  assert.ok(paused.error instanceof chain.RoundStopped, String(paused.error));
  assert.ok(paused.reserved.some(l => /^revise-1/.test(l)), 'pass 1 reserved');
  assert.equal(paused.reserved.some(l => PASS2.test(l)), false, `nothing of pass 2 was reserved: ${paused.reserved}`);
});

test('SM-2 a ruling dated for the next pass changes no prompt of a pass that already ran (so a resume replays every stage of pass 1 and asks only pass 2), and reaches the panel prompt of pass 2', async () => {
  const RULING = { gate: 'g1', pass: 2, text: 'Use black tea.', channel: 'session', actor: 'main-session', person_words: 'Yes, use black tea.', at: '2026-11-04T12:00:00.000Z' };
  const norm = (s, tag) => s.replaceAll(tag, 'TAG');
  const paused = await runWith('unanimous', 'rk-a', round => (round === 2 ? { request_seq: 1 } : null));
  const full = await runWith('unanimous', 'rk-b', null, { rulings: [RULING] });
  assert.ok(paused.error instanceof chain.RoundStopped && full.error === null);
  for (const [label, text] of paused.prompts) {
    assert.ok(full.prompts.has(label), `pass 1's ${label} is asked again`);
    assert.equal(norm(full.prompts.get(label), 'rk-b'), norm(text, 'rk-a'), `${label}: the ruling dated pass 2 leaves this prompt byte for byte what it was`);
    assert.doesNotMatch(text, MARK, label);
  }
  const p2 = [...full.prompts].filter(([l]) => /^panel-2-/.test(l));
  assert.ok(p2.length && p2.every(([, t]) => MARK.test(t)), `the pass-2 panel prompt carries the ruling: ${[...full.prompts.keys()]}`);
});

// ---- the real CLI against a live mock run --------------------------------------------------------------------------------------------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, what, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(100); } throw new Error(`timed out waiting for ${what}`); };
function project(tag, pattern = 'xo') {
  const dir = mkdtempSync(join(tmpdir(), `owner-pause-${tag}-`));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'seam.json'), JSON.stringify(chainOf('unanimous', pattern, `cli-${tag}`)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a pot of tea.\n');
  const hold = join(dir, 'hold');
  const env = { PATH: process.env.PATH, HOME: dir, COUNCIL_MOCK_HOLD_FILE: hold };
  const cli = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const events = () => { const f = join(runDir(), 'gate-ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event) : []; };
  const json = f => JSON.parse(readFileSync(join(runDir(), f), 'utf8'));
  return { dir, hold, env, cli, runDir, events, json, files: () => readdirSync(runDir()), done: () => rmSync(dir, { recursive: true, force: true }) };
}
// starts the run, holds its first call, runs `council pause` against the live lock, releases the hold, waits for the exit
async function pausedRun(tag, pattern = 'xo') {
  const p = project(tag, pattern);
  const child = spawn(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'seam', '--task', 'tasks/t.md'], { cwd: p.dir, env: p.env });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const exited = new Promise(res => child.on('exit', code => res(code)));
  await waitFor(() => existsSync(join(p.dir, 'runs')) && readdirSync(join(p.dir, 'runs')).some(r => existsSync(join(p.dir, 'runs', r, '.council.lock'))), 'the live run and its lock');
  const verb = p.cli(['pause', p.runDir(), '--reason', 'pause after the pass in progress (the test)']);   // the handler's own form: a spawned process has no terminal, and the bare form needs one
  writeFileSync(p.hold, 'go');
  const code = await exited;
  return { ...p, verb, code, out };
}
const stageFiles = files => files.filter(f => /^(?:panel|critique|ldebate|lreply|rule|revise|build)-/.test(f)).sort();
const { default: Ajv2020 } = await import('ajv/dist/2020.js');
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));

test('SM-3 a live run paused by the verb stops at the head of pass 2: exit 23, the marker names the request, the partial files are written, pauses[] lists it untaken, and NOTHING of pass 2 exists', async () => {
  const p = await pausedRun('s3');
  try {
    assert.equal(p.verb.status, 0, p.verb.stdout + p.verb.stderr); assert.match(p.verb.stdout, /pause: recorded \(request 1\)/);
    assert.equal(p.code, 23, p.out);
    assert.match(p.out, /PAUSED on request before pass 2: nothing of the next pass was started, written or paid for\./);   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `PAUSED at your request before pass 2: nothing of that pass was started, written or paid for.` NEW: `PAUSED on request before pass 2: nothing of the next pass was started, written or paid for.` WHY: the reviewed row of src/owner-pause.js:12 (the apply, commit 1).
    const marker = p.json('STOPPED-owner_pause.json');
    assert.deepEqual([marker.stoppedBy, marker.request_seq, marker.resumeAfterStop], ['owner_pause', 1, true]);
    const partial = p.json('report-partial.json');
    assert.deepEqual([partial.stoppedBy, partial.stop.kind, partial.stop.pass, partial.stop.request_seq], ['owner_pause', 'owner_pause', 2, 1]);
    assert.equal(partial.pauses.length, 1); assert.equal(partial.pauses[0].taken, null); assert.equal(partial.pauses[0].lapsed, null);
    assert.ok(validate(partial), JSON.stringify(validate.errors, null, 2));
    assert.ok(p.files().includes('deliverable-partial.md'), 'the plan as it stands is kept');
    assert.equal(p.files().some(f => PASS2.test(f)), false, `no stage file of pass 2: ${p.files()}`);
    assert.equal(p.files().includes('report.json'), false, 'not a finished run');
    assert.doesNotMatch(readFileSync(join(p.runDir(), 'run.log'), 'utf8'), /Round 2\b/, 'pass 2 was never logged');
    // (mock seats are priced at $0 and write no spend-reservations line: the reservation half of the money condition is SM-1b)
    assert.deepEqual(p.events(), ['pause_requested']);
  } finally { p.done(); }
});

test('SM-4 a REFUSED resume (--continue on a pause) records nothing and the request stays untaken; a plain resume takes it, clears the stop, keeps a keepsake, replays pass 1 untouched and finishes', async () => {
  const p = await pausedRun('s4');
  try {
    assert.equal(p.code, 23, p.out);
    const before = Object.fromEntries(stageFiles(p.files()).map(f => [f, readFileSync(join(p.runDir(), f), 'utf8')]));
    const refused = p.cli(['--resume', p.runDir(), '--continue']);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr); // CHANGED ACCEPTED (0.8.4 ladder unit): OLD bar: `is not stopped for --continue or --finish, so there is nothing to answer: they answer a run stopped at ...` (the generic refusal). NEW: the pause has its own, because --finish now works there
    assert.match(refused.stderr, /--continue: this run is paused on request: a plain council --resume \S+ continues it \(no --continue is needed\), and --finish or --finish-now end it here\. Nothing was run and nothing was spent\./);
    assert.deepEqual(p.events(), ['pause_requested'], 'a refused resume recorded nothing');
    assert.ok(p.files().includes('STOPPED-owner_pause.json'), 'and the stop is still there');
    const resumed = p.cli(['--resume', p.runDir()]);
    assert.notEqual(resumed.status, 23, resumed.stdout + resumed.stderr);
    assert.deepEqual(p.events(), ['pause_requested', 'pause_taken']);
    assert.equal(p.files().includes('STOPPED-owner_pause.json'), false, 'the stop is cleared');
    assert.ok(p.files().includes('stop-0001.json'), 'and kept as a keepsake');
    for (const [f, text] of Object.entries(before)) assert.equal(readFileSync(join(p.runDir(), f), 'utf8'), text, `${f}: pass 1 replayed, untouched`);
    assert.ok(p.files().includes('report.json'), 'the run went on and finished');
    const report = p.json('report.json');
    assert.ok(report.pauses[0].taken && report.pauses[0].taken.seq === 2 && report.pauses[0].lapsed === null);
    assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  } finally { p.done(); }
});

// R417 part 2 (CR-1E-006): the settle runs after the LAST refusal of the start and BEFORE flushChoices and the sitting stamp, so a settle that cannot be written is itself the last refusal and the command has written nothing. A live process holds the
// LEDGER lock (a write of its own in flight): every reader that ran before the settle reads the ledger without it, so the settle is the first thing to fail. The control comes second: the same resume with the lock gone takes the request and stamps the sitting.
test('SM-4b a resume whose settle cannot be written is refused with nothing stamped (run.json gains no sitting), the request stays untaken and the stop stays; with the lock gone the same resume takes the request and stamps', async () => {
  const p = await pausedRun('s4b');
  try {
    assert.equal(p.code, 23, p.out);
    const sittings = () => (p.json('run.json').sittings ?? []).length;
    const before = sittings();
    const lock = join(p.runDir(), 'gate-ledger.lock');
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, host: hostname(), at: new Date().toISOString(), nonce: 'x' }));
    const refused = p.cli(['--resume', p.runDir()]);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /--resume: a request to pause this run could not be settled/);
    assert.equal(sittings(), before, 'the refusal came before the sitting was stamped');
    assert.deepEqual(p.events(), ['pause_requested'], 'the request is untaken');
    assert.ok(p.files().includes('STOPPED-owner_pause.json'), 'and the stop is still there');
    rmSync(lock);
    const resumed = p.cli(['--resume', p.runDir()]);
    assert.notEqual(resumed.status, 23, resumed.stdout + resumed.stderr);
    assert.deepEqual(p.events(), ['pause_requested', 'pause_taken']);
    assert.equal(sittings(), before + 1, 'GOOD HALF: a settled resume stamps its sitting');
  } finally { p.done(); }
});

test('SM-5 a STALE request lapses: a resume of a run whose stop marker is not the pause\'s does not stop it again at pass 2, and the ledger says lapsed', async () => {
  const p = await pausedRun('s5');
  try {
    assert.equal(p.code, 23, p.out);
    rmSync(join(p.runDir(), 'STOPPED-owner_pause.json'));   // the run is now a sitting that ended some other way, with the request still standing
    const resumed = p.cli(['--resume', p.runDir()]);
    assert.notEqual(resumed.status, 23, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout + resumed.stderr, /still standing from an earlier sitting; it lapsed/);
    assert.deepEqual(p.events(), ['pause_requested', 'pause_lapsed']);
    assert.ok(p.files().includes('report.json') && !p.files().includes('STOPPED-owner_pause.json'), 'it went on past pass 2');
    assert.ok(p.json('report.json').pauses[0].lapsed);
  } finally { p.done(); }
});

test('SM-6 at the pause, ruling-add and relay-answer work (no NEEDS-revise file exists) and the resumed run lists the ruling from pass 2', async () => {
  const p = await pausedRun('s6');
  try {
    assert.equal(p.code, 23, p.out);
    assert.equal(p.files().some(f => /^NEEDS-revise/.test(f)), false, 'fixture: this pause has no revise file');
    const add = p.cli(['ruling-add', p.runDir(), '--ruling', 'Use black tea.', '--relayed']);
    assert.equal(add.status, 0, add.stdout + add.stderr); assert.match(add.stdout, /a ruling for pass 2 waits/);
    const gate = /as gate (\S+?)\./.exec(add.stdout)?.[1]; assert.ok(gate, add.stdout);
    const ans = p.cli(['relay-answer', p.runDir(), gate, '--person-words', 'Yes: Use black tea.']);
    assert.equal(ans.status, 0, ans.stdout + ans.stderr);
    const resumed = p.cli(['--resume', p.runDir()]);
    assert.notEqual(resumed.status, 23, resumed.stdout + resumed.stderr);
    const report = p.json('report.json');
    assert.ok((report.owner_rulings ?? []).some(r => r.pass === 2 && /black tea/i.test(r.text)), JSON.stringify(report.owner_rulings));
  } finally { p.done(); }
});

test('SM-7 run_status says owner_paused for the stopped run (from the marker) and the resumability needs the person; after the resume it says done', async () => {
  const p = await pausedRun('s7');
  try {
    assert.equal(p.code, 23, p.out);
    assert.equal(runStatus.deriveRunStatus(p.runDir()), 'owner_paused');
    const r = runStatus.runResumability(p.runDir());
    assert.deepEqual([r.status, r.resumable, r.needs, r.stoppedBy], ['owner_paused', true, 'person_choice', 'owner_pause']);
    p.cli(['--resume', p.runDir()]);
    assert.equal(runStatus.deriveRunStatus(p.runDir()), 'done');
  } finally { p.done(); }
});

test('SM-8 a request the last pass never reached stays untaken: the critic signs off at pass 1, the run finishes (no pause), and pauses[] lists the request as not taken', async () => {
  const p = await pausedRun('s8', 'o');
  try {
    assert.equal(p.verb.status, 0, p.verb.stdout + p.verb.stderr);
    assert.notEqual(p.code, 23, p.out);
    assert.ok(p.files().includes('report.json') && !p.files().includes('STOPPED-owner_pause.json'));
    const report = p.json('report.json');
    assert.deepEqual([report.pauses.length, report.pauses[0].taken, report.pauses[0].lapsed], [1, null, null]);
    assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  } finally { p.done(); }
});
