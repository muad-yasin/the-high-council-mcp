// 0.8.4 (the ladder unit, rest of commit 4, step 1; C&C 10 Nov, his "all three options should be open for the user"): at the OWNER'S PAUSE the person (typed, or relayed with person_words) can resume (a plain `--resume`, as before), finish after one last top-layer read
// (`--finish`), or finish at once (`--finish-now`). The run ends NOT agreed; the request is settled as LAPSED (never as taken: `pause_taken` is only for a pause that was resumed), so a replay does not stop again. Offline, $0. WRITTEN WITHOUT A RUN (no tests on
// the laptop): the first run on the box decides. OPF-1 is in-process on a layered fixture (the final read exists only there); OPF-2..OPF-5 run the real command against a live mock run (the technique of test/owner-pause-seam.test.js: COUNCIL_MOCK_HOLD_FILE).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setPauseCheck, setPauseFinishCheck, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { finishedRunState } from '../src/run-status.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { sessionMayAccept } from '../src/acceptance.js';
import { session } from './helpers/mcp-stdio-session.js';
const { requestStopQuote, answerStopQuote, PAUSE_CONTINUE_REFUSAL, PERSON_ONLY_STOP_REFUSAL } = await import('../src/stop-gate.js');
const { pauseSentence } = await import('../src/owner-pause.js');
const { readGateAnswer } = await import('../src/gate.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setPauseCheck(null); setPauseFinishCheck(null); });

// ---- OPF-1: in process, a layered fixture (the fixture of test/finish-now.test.js): the pass-1 top layer objects; the pause stops the run before pass 2
const CRITERION = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.'; const TOP = 'top-gamma'; const LOW = 'raiser-alpha';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
async function layered({ finish = null, roundChoices = [], pause = true } = {}) {
  const asked = [];
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    asked.push(label);
    const scripted = { [`panel-1-${TOP}`]: objects({ criterion: CRITERION, problem: 'Problem 0.', quote: 'The worker', fix: 'Fix it.', severity: 5, relation: 'new' }) };
    const text = label in scripted ? scripted[label] : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  setPauseCheck(pause ? (round => (round === 2 ? { request_seq: 7 } : null)) : null);
  setPauseFinishCheck(finish ? (round => (round === 2 ? { request_seq: 7, choice: finish } : null)) : null);   // what the CLI reads from the ledger (pause_finished)
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-opf', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat(TOP, 3)] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-opf', log: () => {}, config, roundChoices }); } catch (e) { error = e; }
  return { result, error, asked, report: result ? JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-opf', chain: 'fixture-opf', task: 't.md', result, config }))) : null };
}

test('OPF-15 (signed_text.round, C&C 80296ad3): a layered run whose draft was revised after the last pass a panel read, finished at the owner\'s pause, records round null: no panel round read the text signed_text names (the draft after the revise); the report still validates there and the board does not print a number', async () => {
  const now = await layered({ finish: 'finish_now' });
  assert.equal(now.error, null, String(now.error));
  assert.ok(now.asked.some(l => /^revise-1/.test(l)), 'premise: the draft was revised after pass 1');
  assert.equal(now.report.stop.kind, 'owner_pause', 'premise: the run ended at the owner\'s pause');
  assert.equal(now.report.signed_text.round, null, 'the record says no panel round read this text');
  validate(now.report);
  assert.deepEqual((validate.errors ?? []).filter(e => /\/signed_text\//.test(e.instancePath)).map(e => `${e.instancePath} ${e.message}`), [], 'no schema error names signed_text');
  const board = renderBoardMd({ runId: 'r-opf', result: now.result });
  assert.doesNotMatch(board, /round (null|undefined)/, 'the board prints no "round null"');
});
test('OPF-1 (the chain, both endings): the pause stops before pass 2; a finish AT the pause (the pause_finished line of the ledger, which the chain asks through pauseFinishCheck) ends the run NOT agreed at that point, with ONE last top-layer read (the final read) and nothing of pass 2; a recorded finish_now ends it with no read; the control with no choice still stops', async () => {
  const control = await layered();
  assert.ok(control.error instanceof RoundStopped, 'the control: no choice, the pause stops the run');
  assert.deepEqual([control.error.stop.kind, control.error.stop.pass, control.error.stop.request_seq], ['owner_pause', 2, 7]);
  const fin = await layered({ finish: 'finish' });
  assert.equal(fin.error, null, String(fin.error));
  assert.deepEqual([fin.report.passed, fin.report.stop.kind, fin.report.stop.chosen, fin.report.stop.finished_at_once], [false, 'owner_pause', 'finish', undefined]);
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: the plain finish always asked the top layer for one last read. NEW: the read is owed only when a top-layer seat has not read THIS text; here the top layer read it, so the final read is not run and says so (every_top_seat_read_this_plan).
  assert.ok(fin.asked.some(l => /^final-read-/.test(l)) || fin.report.final_read?.reason === 'every_top_seat_read_this_plan', 'finish: the top layer reads the final plan once, unless it had already read this text');
  // Muad's 05 Nov rule: a layered run the person finishes at a stop says the top layer did not sign off on that plan: in the verdict, the status and ONE board section
  assert.match(verdictHeadline(fin.report).text, /at the owner's pause before pass 2, NOT agreement, and layer 3 did not sign off on this plan/);
  assert.match(finishedRunState(fin.report), /^done: not agreed; finished at the person's choice at the owner's pause before pass 2, NOT agreement, and layer 3 did not sign off on this plan/);
  assert.equal((renderBoardMd({ runId: 'r-opf', result: fin.result }).match(/^## Not agreed/gm) || []).length, 1, 'one "Not agreed" section, not two');
  assert.equal(fin.asked.some(l => /^(panel|revise)-2/.test(l)), false, 'nothing of pass 2');
  const now = await layered({ finish: 'finish_now' });
  assert.equal(now.error, null, String(now.error));
  assert.deepEqual([now.report.passed, now.report.stop.kind, now.report.stop.chosen, now.report.stop.finished_at_once, now.report.final_read?.reason], [false, 'owner_pause', 'finish', true, 'every_top_seat_read_this_plan']);   // FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026): the companion of the plain-finish line above, moved with the same ruling (what the top layer already read of the CURRENT text stays on the record): OLD 'finished_at_once', NEW 'every_top_seat_read_this_plan' (the top layer read this text, as the plain finish shows)
  assert.deepEqual(now.asked.filter(l => /^(final-read|ldebate-end|lreply-end)/.test(l)), [], 'finish-now: no judge is asked again');
  assert.match(verdictHeadline(now.report).text, /at the owner's pause before pass 2 at once, NOT agreement, and layer 3 did not sign off on this plan, and no judge read the plan again/);
  assert.equal(now.asked.some(l => /^(panel|revise)-2/.test(l)), false, 'nothing of pass 2');
});

test('OPF-1c (a planted run.json entry changes nothing): an owner_pause entry in run.json with no pause_finished behind it (no ledger request; or a request that was taken or lapsed) does not end the run: the pause still stops it, and with no pause the run goes on to its end', async () => {
  const planted = [{ stop: 'owner_pause:1:2', choice: 'finish_now', kind: 'owner_pause', overseer_round: 1, add: 0, actor: 'person', channel: 'session', relayed: true, request_seq: 7 }];
  const stillStops = await layered({ roundChoices: planted });
  assert.ok(stillStops.error instanceof RoundStopped, 'the pause still stops the run: the entry alone ends nothing');
  const goesOn = await layered({ roundChoices: planted, pause: false });
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: with no pause the run went on to its end (error null, no stop). NEW: on every layered chain a stall the top layer holds is a stop for the person, and this fixture's top layer stalls: the run stops at stall_stop. What the row pins is unchanged: nothing of the planted owner-pause entry ends the run.
  if (goesOn.error) assert.equal(goesOn.error.stop?.kind, 'stall_stop', String(goesOn.error)); else assert.equal(goesOn.report.stop, undefined, 'no pause: no pause stop, no finish');
  assert.ok(goesOn.asked.some(l => /^(panel|revise)-2/.test(l)), 'the run went on to pass 2');
});

const nonLayered = async (signoff, finish = null) => {
  setCache(null); setPauseCheck(round => (round === 2 ? { request_seq: 7 } : null)); setPauseFinishCheck(finish ? (round => (round === 2 ? { request_seq: 7, choice: finish } : null)) : null);
  const config = { name: `opf-${signoff}`, signoff, maxRounds: 3, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [{ provider: 'mock', model: `mock-critic-script-x-opf-${signoff}`, lab: 'c1' }] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Plan a tea.', config, log: () => {} }); } catch (e) { error = e; }
  return { result, error };
};
for (const signoff of ['unanimous', 'first']) {
  test(`OPF-1b (${signoff} loop, a chain with no layers): a recorded finish at the pause ends the run at the head of pass 2 in BOTH pass loops: the result carries the owner_pause stop with chosen finish (the stop is in the report of an unlayered chain too), passed false, nothing of pass 2; the control stops`, async () => {
    const control = await nonLayered(signoff);
    assert.ok(control.error instanceof RoundStopped, `the control: ${control.error}`);
    const fin = await nonLayered(signoff, 'finish');
    assert.equal(fin.error, null, String(fin.error));
    assert.equal(fin.result.passed, false);
    assert.deepEqual([fin.result.stop?.kind, fin.result.stop?.chosen, fin.result.stop?.pass, fin.result.stop?.request_seq], ['owner_pause', 'finish', 2, 7]);
  });
}

// ---- OPF-2..5: the real command against a live mock run (one critic, three passes at most; it objects once, then signs off)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, what, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await sleep(100); } throw new Error(`timed out waiting for ${what}`); };
const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });
function project(tag) {
  const dir = mkdtempSync(join(tmpdir(), `opf-${tag}-`));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'seam.json'), JSON.stringify({ name: 'seam', signoff: 'unanimous', maxRounds: 3, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [{ provider: 'mock', model: `mock-critic-script-xo-opf-${tag}`, lab: 'c1' }] } }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a pot of tea.\n');
  const hold = join(dir, 'hold'); const env = { PATH: process.env.PATH, HOME: dir, COUNCIL_MOCK_HOLD_FILE: hold };
  const cli = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const events = () => { const f = join(runDir(), 'gate-ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event) : []; };
  const json = f => JSON.parse(readFileSync(join(runDir(), f), 'utf8'));
  const p = { dir, hold, env, cli, runDir, events, json, files: () => readdirSync(runDir()), done: () => rmSync(dir, { recursive: true, force: true }) };
  projects.push(p);
  return p;
}
async function pausedRun(tag) {
  const p = project(tag);
  const child = spawn(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'seam', '--task', 'tasks/t.md'], { cwd: p.dir, env: p.env });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const exited = new Promise(res => child.on('exit', code => res(code)));
  await waitFor(() => existsSync(join(p.dir, 'runs')) && readdirSync(join(p.dir, 'runs')).some(r => existsSync(join(p.dir, 'runs', r, '.council.lock'))), 'the live run and its lock');
  const verb = p.cli(['pause', p.runDir(), '--reason', 'pause after the pass in progress (the test)']);
  writeFileSync(p.hold, 'go');
  const code = await exited;
  assert.equal(code, 23, out); assert.equal(verb.status, 0, verb.stdout + verb.stderr);
  return { ...p, id: p.runDir().split('/').at(-1), out };
}
const PASS2 = /^(?:panel|critique|ldebate|lreply|rule|revise)-2(?:-|\.|$)/;

for (const [flag, choice, now] of [['--finish', 'finish', false], ['--finish-now', 'finish_now', true]]) {
  test(`OPF-2 (typed ${flag}, the real command): the run ends NOT agreed at the pause with the choice recorded as typed for the pause's own stop id; the request is settled as pause_finished (never pause_taken, never pause_lapsed); nothing of pass 2; the record validates; ${flag} never lands in the other branches (no secretFinish, no budgetFinish)`, async () => {
    const p = await pausedRun(`t${choice}`);
    const r = p.cli(['--resume', p.runDir(), flag]);
    assert.notEqual(r.status, 2, r.stdout + r.stderr); assert.notEqual(r.status, 23, 'it did not stop again');
    const rep = p.json('report.json');
    assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.chosen, rep.stop.finished_at_once], [false, 'owner_pause', 'finish', now ? true : undefined]);
    const meta = p.json('run.json'); const e = meta.roundChoices[0];
    assert.deepEqual([e.stop, e.choice, e.kind, e.actor, e.channel], [`owner_pause:${rep.stop.overseer_round}:2`, choice, 'owner_pause', 'unknown', 'cli']);
    assert.equal(meta.secretFinish, undefined); assert.equal(meta.budgetFinish, undefined);
    assert.deepEqual(p.events(), ['pause_requested', 'pause_finished'], 'settled as finished: the run DID pause and ended there; never taken (resumed), never lapsed (never paused)');
    assert.deepEqual([rep.pauses[0].taken, rep.pauses[0].lapsed, rep.pauses[0].finished?.choice], [null, null, choice], 'the report row tells the case: paused and finished there, with the choice');
    assert.equal(rep.stop.request_seq, rep.pauses[0].request.seq, 'the stop names the request the run stopped for');
    assert.match(finishedRunState(rep), new RegExp(`^done: not agreed; finished at the person's choice at the owner's pause before pass 2${now ? ' at once' : ''}, NOT agreement`)); assert.match(verdictHeadline(rep).text, /^NOT AGREED - finished at the person's choice at the owner's pause before pass 2/);
    assert.match(readFileSync(join(p.runDir(), 'BOARD.md'), 'utf8'), /## Not agreed: finished at the owner's pause/, 'the board says it');
    assert.doesNotMatch(String(verdictHeadline(rep).text), /did not sign off/, 'an unlayered chain has no top layer to name');
    assert.equal(p.files().some(f => PASS2.test(f)), false, 'nothing of pass 2');
    // FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026). OLD: this line pinned an earlier draft of LAD-O3, "the request to pause this run ended with your choice to finish it here; the run does not go on.", which no source prints. The last assertion of this row pins the sentence the code prints (cli.js, the settle line); the older one is dropped, not loosened.
    assert.ok(validate(rep), JSON.stringify(validate.errors));
    const texts = ['run.log', 'BOARD.md', 'report.json'].filter(f => p.files().includes(f)).map(f => readFileSync(join(p.runDir(), f), 'utf8')).join('\n');
    assert.doesNotMatch(texts, /undefined|layer undefined/, 'no reader printed an unset field of the pause stop');
    assert.match(texts, /finishing at the person's choice(, at once)?: the run was paused before pass 2; this is NOT agreement/, 'the run log names the pause');
    assert.match(readFileSync(join(p.runDir(), 'run.log'), 'utf8'), /this run was paused on request before its next pass, and you chose to finish it there/, 'and the settle line says the run paused and ended there');
  });
}

test('OPF-3 (relayed, stop_decide): the pause is quoted as a stop only the person decides; the session\'s own answer and a relayed continue are refused (a pause is continued by resuming it); a relayed finish_now ends the run, recorded as the person\'s, attributed to the gate', async () => {
  const p = await pausedRun('rel');
  const call = args => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
  const q = await call({ step: 'quote' });
  assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 300));
  assert.deepEqual([q.person_only, q.requires_user], [true, true]);
  assert.match(q.text, /Choices: finish\./, 'a pause is continued by resuming it: the quote offers finish only');
  const OWN = { reason: 'The record settles it.', advisor: 'none', advisor_said: '', person_test: { session: { person: 'no', unsettled_by_record: false, preference: false, reason: 'A fact.' }, advisor: { person: 'no', unsettled_by_record: false, preference: false, reason: 'no advisor' } } };
  assert.equal(answerStopQuote(p.runDir(), q.gate, { shownSha256: q.shown, reason: OWN.reason, choice: 'finish', advisor: 'none', advisorSaid: '', personTest: OWN.person_test }).message, PERSON_ONLY_STOP_REFUSAL);
  assert.equal((await call({ step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: 'Go on.' })).error, PAUSE_CONTINUE_REFUSAL);
  assert.deepEqual(p.events(), ['pause_requested', 'gate_requested'], 'nothing was answered');
  const r = await call({ step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: 'End it here, now.' });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
  for (let waited = 0; existsSync(join(p.runDir(), '.council.lock')) && waited < 60000; waited += 100) await sleep(100);
  const rep = p.json('report.json'); const e = p.json('run.json').roundChoices[0];
  assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.finished_at_once, rep.stop.relayed], [false, 'owner_pause', true, true]);
  assert.deepEqual([e.choice, e.actor, e.channel, e.relayed, e.gate, e.person_words], ['finish_now', 'person', 'session', true, q.gate, 'End it here, now.']);
  assert.deepEqual(p.events().filter(e => e.startsWith('pause_')), ['pause_requested', 'pause_finished']);
  assert.ok(validate(rep), JSON.stringify(validate.errors));
});

test('OPF-4 (no lost route): the pause can still be ASKED (the verb ran in the fixture: the handler\'s form) and a plain --resume still CONTINUES it: pause_taken, the stop cleared, the run goes on and finishes; the sentence names the three ways on', async () => {
  const p = await pausedRun('plain');
  const sentence = p.out;
  assert.match(sentence, /To go on: council --resume \S+ \(no --continue is needed;/);
  assert.match(sentence, /To end it here instead: council --resume \S+ --finish \(.*\) or --finish-now \(/);
  const r = p.cli(['--resume', p.runDir()]);
  assert.notEqual(r.status, 23, r.stdout + r.stderr);
  assert.deepEqual(p.events(), ['pause_requested', 'pause_taken']);
  assert.ok(p.files().includes('report.json'), 'the run went on and finished');
});

test('OPF-5 (fail closed, one row per case, each set up BEFORE the request): a stop_decision gate for the owner pause is asked only when the pause\'s stop was read and matches the id; with no report file, a damaged file, no stop object, no whole round or pass, or another stop id, no question is asked and nothing is recorded; the readable case asks a person-only gate', () => {
  const base = mkdtempSync(join(tmpdir(), 'opf-fc-')); projects.push({ done: () => rmSync(base, { recursive: true, force: true }) });
  const ask = (name, partial) => {
    const d = join(base, name); mkdirSync(d); writeFileSync(join(d, 'q.md'), 'Stop owner_pause:1:2: x\n');
    if (partial !== undefined) writeFileSync(join(d, 'report-partial.json'), partial);
    return { d, r: requestStopQuote(d, { textPath: 'q.md', stopId: 'owner_pause:1:2' }) };
  };
  const pause = (round, pass) => JSON.stringify({ stop: { kind: 'owner_pause', overseer_round: round, pass, request_seq: 1 } });
  const refused = { 'no report file': undefined, 'a damaged file': '{ broken', 'no stop object': '{}', 'no whole pass': pause(1, 'x'), 'no whole round': JSON.stringify({ stop: { kind: 'owner_pause', pass: 2 } }), 'another stop id': pause(2, 2) };
  for (const [name, partial] of Object.entries(refused)) {
    const { d, r } = ask(name.replace(/\W+/g, '-'), partial);
    assert.deepEqual([r.ok, r.code], [false, 'stop_unreadable'], name);
    assert.equal(existsSync(join(d, 'gate-ledger.jsonl')), false, `${name}: nothing was recorded`);
  }
  const ok = ask('readable', pause(1, 2)); assert.equal(ok.r.ok, true, JSON.stringify(ok.r));
  assert.equal(readGateAnswer(ok.d, ok.r.gate.id).gate.stop.person_only, true, 'the control: a readable owner pause asks a person-only gate');
});

test('OPF-6 (pure): the pause sentence names the three ways on and still names the pass, the money and the draft; no "undefined"', () => {
  const s = pauseSentence({ pass: 3, spentUsd: 1.234, draftFile: 'deliverable-partial.md', runDir: 'runs/x' });
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `PAUSED at your request before pass 3: nothing of that pass was started...`, `(...the passes already finished replay free)`, `--finish (the run ends NOT agreed, the closing steps run, and a layered chain's final read runs first)`. NEW: the three sentences of src/owner-pause.js pauseSentence as applied (K5). WHY: the reviewed wording of the owner's pause (LAD-O1), applied in the recorded tree.
  assert.match(s, /PAUSED on request before pass 3: nothing of the next pass was started, written or paid for\./);
  assert.match(s, /To go on: council --resume runs\/x \(no --continue is needed; the finished passes replay at no cost\)\./);
  assert.match(s, /To end it here instead: council --resume runs\/x --finish \(the run ends NOT agreed; a layered chain's final read runs first, then the closing steps\) or --finish-now \(the run ends NOT agreed, and no judge reads the plan again\)\./);
  assert.doesNotMatch(s, /undefined|null/);
});

test('OPF-7 (a planted marker is not a pause): a STOPPED-owner_pause.json whose request is not in the ledger (request_seq 99) makes --finish and --finish-now refuse, exit 2, with nothing recorded; the real pause still takes them', async () => {
  const p = await pausedRun('plant');
  const markerFile = join(p.runDir(), 'STOPPED-owner_pause.json'); const real = readFileSync(markerFile, 'utf8');
  writeFileSync(markerFile, JSON.stringify({ ...JSON.parse(real), request_seq: 99 }));
  const before = readFileSync(join(p.runDir(), 'run.json'), 'utf8');
  for (const flag of ['--finish', '--finish-now']) {
    const r = p.cli(['--resume', p.runDir(), flag]);
    assert.equal(r.status, 2, `${flag}: ${r.stdout}${r.stderr}`);
  }
  assert.equal(readFileSync(join(p.runDir(), 'run.json'), 'utf8'), before, 'nothing recorded');
  assert.deepEqual(p.events(), ['pause_requested']);
  writeFileSync(markerFile, real);
  assert.notEqual(p.cli(['--resume', p.runDir(), '--finish']).status, 2, 'the real marker takes it');
});

test('OPF-8 (pure): the session\'s own accept of a run finished at the owner\'s pause is refused for the right reason: the choice was typed or relayed (the existing rules), not "the round limit the person typed"', () => {
  const report = { delivered_text: { same_as_signed: true }, stop: { kind: 'owner_pause', pass: 2, overseer_round: 0, chosen: 'finish' } };
  const typed = sessionMayAccept({ report, meta: { roundChoices: [{ stop: 'owner_pause:0:2', choice: 'finish', channel: 'cli', actor: 'unknown' }] } });
  assert.equal(typed.ok, false); assert.doesNotMatch(typed.message, /round limit the person typed/); assert.match(typed.message, /answered at the terminal/);
  const rel = sessionMayAccept({ report, meta: { roundChoices: [{ stop: 'owner_pause:0:2', choice: 'finish_now', channel: 'session', actor: 'person', relayed: true }] } });
  assert.equal(rel.ok, false); assert.match(rel.message, /relayed by the handling session/);
});

// ---- the record: THREE cases, told apart (C&C 10 Nov): paused and resumed (pause_taken), paused and finished there (pause_finished, the choice named), never paused (pause_lapsed)
test('OPF-9 (pure, the ledger tells three cases apart): a request that was taken, one that lapsed and one that was finished at the pause read differently in pauseStateOf; only the finished one answers the chain\'s question for pass 2 (pauseFinishedFor), with its choice; a request settled once cannot be settled again; a finished line without a choice is refused', async () => {
  const { recordPauseRequest, recordPauseSettled, pauseStateOf } = await import('../src/gate.js');
  const { pauseFinishedFor, pausesOf } = await import('../src/run-controls.js');
  const dirFor = name => { const d = mkdtempSync(join(tmpdir(), `opf9-${name}-`)); projects.push({ done: () => rmSync(d, { recursive: true, force: true }) }); return d; };
  const ask = d => { const r = recordPauseRequest(d, { pass: 1, by: 'handler', channel: 'session', reason: 'pause after the pass in progress (the test)' }); assert.equal(r.ok, true, JSON.stringify(r)); return r.seq; };
  const cases = {};
  for (const [name, event, choice] of [['resumed', 'pause_taken'], ['never', 'pause_lapsed'], ['finish', 'pause_finished', 'finish'], ['now', 'pause_finished', 'finish_now']]) {
    const d = dirFor(name); const seq = ask(d);
    assert.equal(pauseFinishedFor(d, 2), null, `${name}: an open request answers null`);
    const r = recordPauseSettled(d, { event, requestSeq: seq, ...(choice ? { choice, pass: 2 } : {}) }); assert.equal(r.ok, true, JSON.stringify(r));
    cases[name] = { d, seq };
  }
  const row = name => pausesOf(cases[name].d)[0];
  assert.deepEqual([row('resumed').taken !== null, row('resumed').lapsed, row('resumed').finished], [true, null, null]);
  assert.deepEqual([row('never').taken, row('never').lapsed !== null, row('never').finished], [null, true, null]);
  assert.deepEqual([row('finish').taken, row('finish').lapsed, row('finish').finished.choice], [null, null, 'finish']);
  assert.deepEqual([pauseFinishedFor(cases.finish.d, 2), pauseFinishedFor(cases.now.d, 2)].map(x => x && x.choice), ['finish', 'finish_now']);
  assert.equal(pauseFinishedFor(cases.finish.d, 3), null, 'only for the pass the pause stopped before');
  assert.equal(pauseFinishedFor(cases.resumed.d, 2), null); assert.equal(pauseFinishedFor(cases.never.d, 2), null, 'a lapse never ends a run');
  assert.equal(pauseStateOf(cases.finish.d).untaken, null, 'a finished request is settled');
  assert.equal(recordPauseSettled(cases.finish.d, { event: 'pause_taken', requestSeq: cases.finish.seq }).ok, false, 'settled once');
  const d2 = dirFor('nochoice'); const seq2 = ask(d2);
  assert.equal(recordPauseSettled(d2, { event: 'pause_finished', requestSeq: seq2, pass: 2 }).ok, false, 'a finished pause says how it ended');
  assert.equal(recordPauseSettled(d2, { event: 'pause_finished', requestSeq: seq2, choice: 'finish' }).ok, false, 'and the pass it stopped before');
  // a request made during a pass\'s first call records the pass one EARLIER than the stop (requestPause: the highest pass with a stage): request pass 1, the run stops before pass 3
  const d3 = dirFor('latepass'); const seq3 = ask(d3);
  assert.equal(recordPauseSettled(d3, { event: 'pause_finished', requestSeq: seq3, choice: 'finish_now', pass: 3 }).ok, true);
  assert.deepEqual([pauseFinishedFor(d3, 3)?.choice, pauseFinishedFor(d3, 2)], ['finish_now', null], 'matched on the stop\'s own pass, not on the request\'s pass + 1');
});

test('OPF-10 (a planted run.json entry on a real paused run): an owner_pause entry in run.json with no pause_finished in the ledger leaves a PLAIN --resume going: the pause is taken (pause_taken), the run finishes, and it carries no pause stop', async () => {
  const p = await pausedRun('plantentry');
  const metaPath = join(p.runDir(), 'run.json'); const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  writeFileSync(metaPath, JSON.stringify({ ...meta, roundChoices: [{ stop: 'owner_pause:0:2', choice: 'finish_now', kind: 'owner_pause', overseer_round: 0, add: 0, actor: 'person', channel: 'session', relayed: true, request_seq: 1 }] }));
  const r = p.cli(['--resume', p.runDir()]);
  assert.notEqual(r.status, 2, r.stdout + r.stderr);
  assert.deepEqual(p.events(), ['pause_requested', 'pause_taken']);
  const rep = p.json('report.json');
  assert.equal(rep.stop, undefined, 'the planted entry ended nothing');
  assert.ok(p.files().some(f => PASS2.test(f)), 'pass 2 ran');
});

test('OPF-11 (text scan): in both pass loops the finish at the pause is asked BEFORE the pause check, so a replay does not stop again; the CLI never routes --finish-now into the plain --finish branch of the pause (its own branch precedes the generic refusal)', () => {
  const chain = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const heads = chain.split('\n').filter(l => l.includes('ownerPauseFinishAt(round)') && l.includes('pauseCheck(round)'));
  assert.equal(heads.length, 2, 'both loops');
  for (const l of heads) assert.ok(l.indexOf('ownerPauseFinishAt(round)') < l.indexOf('pauseCheck(round)'));
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const own = cli.indexOf('} else if (resumeMeta && ownerPauseMarker && wantFinish && !wantContinue) {');
  const generic = cli.indexOf('} else if (wantContinue || wantFinish) {');
  assert.ok(own > 0 && generic > own, 'the pause branch comes before the generic refusal');
  assert.match(cli, /const choice = wantFinishNow \? 'finish_now' : 'finish';\n    const chooser = attributeChoice\(pauseId, choice\);/, 'finish-now is its own choice in the pause branch');
});

test('OPF-12 (no lost route): resume_run, the session\'s tool, still resumes an owner-paused run as before: pause_taken, the stop cleared, the run goes on and finishes', async () => {
  const p = await pausedRun('resumerun');
  const [r] = await session(p.dir, [{ name: 'resume_run', arguments: { run: p.id } }]);
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  for (let waited = 0; existsSync(join(p.runDir(), '.council.lock')) && waited < 60000; waited += 100) await sleep(100);
  assert.deepEqual(p.events(), ['pause_requested', 'pause_taken']);
  assert.ok(p.files().includes('report.json'));
  assert.equal(p.json('report.json').pauses[0].finished, null);
});

test('OPF-13 (a crash after the pause_finished line): the line is on the ledger but the run did not end (the settle ran, the ending did not); the next resume, a plain one, ends the run again at that pass, writes no second pause line, and takes no new choice from the command line', async () => {
  const { recordPauseSettled } = await import('../src/gate.js');
  const p = await pausedRun('crash');
  // the crash is simulated at its only observable point: the ledger holds pause_finished (written by the settle) and the stop marker is still there, as when the process died before clearing the stop records
  const settled = recordPauseSettled(p.runDir(), { event: 'pause_finished', requestSeq: 1, choice: 'finish_now', pass: 2 });
  assert.equal(settled.ok, true, JSON.stringify(settled));
  const r = p.cli(['--resume', p.runDir()]);
  assert.notEqual(r.status, 2, r.stdout + r.stderr); assert.notEqual(r.status, 23, 'it did not pause again');
  assert.deepEqual(p.events(), ['pause_requested', 'pause_finished'], 'no second pause line: nothing was settled again');
  const rep = p.json('report.json');
  assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.chosen, rep.stop.finished_at_once, rep.pauses[0].finished?.choice], [false, 'owner_pause', 'finish', true, 'finish_now']);
  assert.equal(p.files().some(f => PASS2.test(f)), false, 'nothing of pass 2');
  assert.equal(p.json('run.json').roundChoices, undefined, 'no choice was taken from the command line: the ledger alone ended the run');
  // (named, not covered: the variant in which the stop marker was already cleared before the crash; the settle then finds no untaken request and writes nothing either)
});

test('OPF-14 (parity G1: the relayed mark comes from the LEDGER): a finish_now relayed at the owner\'s pause ends the run; with run.json\'s roundChoices REMOVED (what a crash between the settle and the choice flush leaves), the finished stop still reads as relayed (pauseFinishedFor reads the answered stop gate of the ledger); the control: a typed finish-now reads as not relayed with the same removal', async () => {
  const { pauseFinishedFor } = await import('../src/run-controls.js');
  const p = await pausedRun('g1rel');
  const call = args => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
  const q = await call({ step: 'quote' });
  const r = await call({ step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: 'End it here, now.' });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  for (let waited = 0; existsSync(join(p.runDir(), '.council.lock')) && waited < 60000; waited += 100) await sleep(100);
  assert.equal(p.json('report.json').stop.relayed, true, 'premise: the run ended through the relay');
  const meta = p.json('run.json'); delete meta.roundChoices; writeFileSync(join(p.runDir(), 'run.json'), JSON.stringify(meta));
  assert.equal(pauseFinishedFor(p.runDir(), 2)?.relayed, true, 'no run.json entry, and the relayed mark is still there: the ledger has it');
  const t = await pausedRun('g1typed');
  const typed = t.cli(['--resume', t.runDir(), '--finish-now']); assert.notEqual(typed.status, 2, typed.stdout + typed.stderr);
  const meta2 = t.json('run.json'); delete meta2.roundChoices; writeFileSync(join(t.runDir(), 'run.json'), JSON.stringify(meta2));
  assert.equal(pauseFinishedFor(t.runDir(), 2)?.relayed, false, 'the control: a typed choice is not relayed');
});

test('OPF-13b (the resume after a session\'s answer: the stop marker is already CLEARED): the settle wrote pause_finished and the run stopped later (at the session\'s handoff on a shipped chain), so the next resume is a plain one with NO marker; the ledger alone still ends the run at that pass, with nothing of pass 2 (this is the handoff-crossing shape OPF-13 named as not covered)', async () => {
  const { recordPauseSettled } = await import('../src/gate.js');
  const p = await pausedRun('nomarker');
  const settled = recordPauseSettled(p.runDir(), { event: 'pause_finished', requestSeq: 1, choice: 'finish_now', pass: 2 });
  assert.equal(settled.ok, true, JSON.stringify(settled));
  rmSync(join(p.runDir(), 'STOPPED-owner_pause.json'), { force: true });
  const r = p.cli(['--resume', p.runDir()]);
  assert.notEqual(r.status, 2, r.stdout + r.stderr); assert.notEqual(r.status, 23, 'it did not pause again');
  const rep = p.json('report.json');
  assert.deepEqual([rep.passed, rep.stop.kind, rep.stop.chosen, rep.stop.finished_at_once], [false, 'owner_pause', 'finish', true]);
  assert.equal(p.files().some(f => PASS2.test(f)), false, 'nothing of pass 2');
});
