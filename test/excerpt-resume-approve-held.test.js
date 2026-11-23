// 0.8.4 pr2 fix, A1 (an approval path): excerpts recorded `not_required` BEFORE the privacy switch was turned on must not reach a seat's prompt after `--resume --approve-excerpts` until the person has approved them, unless a seat has
// ALREADY been shown them (then the stages that saw them replay unchanged: the stage cache hashes the prompt). Through the REAL command, spawned, offline, $0 (mock seats, a preload that records the channel's drafted words and logs every prompt a seat is
// built: test/helpers/held-excerpt-preload.js).
//
// The state: sitting 1 pauses at the external `build`; the session answers it with a session read; sitting 2 (switch OFF) records the read as `not_required` and stops at the spending cap BEFORE the first panel call (a real sitting: the only normal-shipped-chain window
// for this state, the trace's T3). Sitting 3 is `--resume --approve-excerpts`. The prompt log of each sitting is its own file; the prompt spy writes BEFORE the cap's check, so only sitting 3's and 4's logs are asserted.
// A seat_request row is covered at the lowest honest seam (the `reqs` chain's critics are free seats, so no spending stop exists for it): the sitting that recorded the row is stamped into run.json by the real `sittingEntry` and the row is recorded by the real
// `recordSessionReads`, which is exactly what such a sitting leaves behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import { answerGate, readGateAnswer } from '../src/gate.js';
import { sittingEntry } from '../src/version.js';
import { recordSessionReads, excerptBatch } from '../src/excerpt-resume.js';
import * as RR from '../src/excerpt-resume.js';   // rowsMayBeShown is read through the namespace so the file LOADS on the unchanged tree and each case fails by its own assertion
import { SecretShapedPrompt } from '../src/outbound-scan.js';
import * as ER from '../src/excerpt-record.js';   // a namespace import: liveExcerpts is absent at the unchanged tip, where the rows are then all read as they stand
import * as RS from '../src/run-status.js';
import * as H from './held-prompts/held-084-a.js';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-excerpt-preload.js');
const validateRecord = new Ajv2020({ allErrors: true, allowUnionTypes: true }).compile(JSON.parse(readFileSync(new URL('../schemas/excerpts-v1.json', import.meta.url), 'utf8')));   // the published line format must take the line that replaces another
const TEXT = 'bravo one';   // the first line of the excerpt every case is about
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const rows = runDir => lines(join(runDir, 'excerpts.jsonl'));
const live = runDir => (ER.liveExcerpts ? ER.liveExcerpts(rows(runDir)) : rows(runDir));
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
const hashes = runDir => Object.fromEntries(readdirSync(runDir).filter(f => /^panel-1-.*\.usage\.json$/.test(f)).map(f => [f, JSON.parse(readFileSync(join(runDir, f), 'utf8')).promptHash]));
let n = 0;
const run = (dir, args, extra = {}) => {
  n += 1;
  return spawnSync(process.execPath, ['--import', preload, cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, THC_PROMPT_LOG: join(dir, `prompts-${n}.jsonl`), ...extra }, timeout: 120_000 });
};
const logOf = (dir, r) => lines(join(dir, `prompts-${n - r}.jsonl`));   // r = how many runs ago (0 = the last one)
const seen = prompts => prompts.filter(p => p.user.includes(TEXT));

// ---- the priced chain: mock-external with priced critics, so a spending cap can stop sitting 2 before its first panel call ----
function project(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-a1-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tea service for twelve guests.\n');
  writeFileSync(join(dir, 'src', 'b.js'), `${TEXT}\nbravo two\nbravo three\n`);
  writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain, null, 2));
  return dir;
}
const pricedChain = () => {
  const c = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  return { ...c, name: 'a1chain', seats: { ...c.seats, critics: c.seats.critics.map(x => ({ ...x, model: 'mock-priced' })) } };
};
const READ = { path: 'src/b.js', lines: '1-2', why: 'To check the second file.' };

/** Sitting 1 -> the session's answer carrying the read -> sitting 2 with the switch OFF at `cap2`. cap2 tiny: the sitting stops at its first panel call (the read is recorded, no seat has been sent it); cap2 5: the panel runs. */
function twoSittings(cap2) {
  const dir = project(pricedChain());
  const first = run(dir, ['--chain', 'a1chain', '--task', 'tasks/x.md', '--max-usd', '5']);
  assert.equal(first.status, 3, `sitting 1: ${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
  const runDir = onlyRun(dir);
  setHeldForTest({ excerptsBlock: H.excerptsBlock, sessionReadsField: H.sessionReadsField });
  try { submitStageAnswer(runDir, 'build', '# Plan\n\nBody.\n', { excerptSwitch: RS.excerptSwitchForSubmit, sessionReads: [READ] }); } finally { setHeldForTest(null); }
  const second = run(dir, ['--resume', runDir, '--max-usd', cap2]);
  return { dir, runDir, second };
}
/** The state of the case: the read is recorded as not_required and NO seat was sent it (premise, asserted so that a red is a red about the fix and not about the setup). */
function unshownState() {
  const t = twoSittings('0.000001');
  assert.equal(t.second.status, 4, `sitting 2 stops at the cap: ${t.second.stdout.slice(-300)}${t.second.stderr.slice(-300)}`);
  assert.deepEqual(rows(t.runDir).map(e => [e.id, e.request_kind, e.approval.status, e.answered_stage]), [['E-1', 'session_read', 'not_required', 'build']]);
  assert.equal(readdirSync(t.runDir).some(f => /^panel-1-.*\.usage\.json$/.test(f)), false, 'no panel stage ran');
  return t;
}
const answer = (runDir, gate, id, decision) => {
  const g = readGateAnswer(runDir, gate).gate;
  const done = answerGate(runDir, gate, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id, decision }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  return g;
};

test('A1: a read recorded not_required before the switch and shown to no seat is held at --resume --approve-excerpts: no seat prompt carries it, the run waits at ONE gate for it, and after the person approves it the seats see it', () => {
  const { dir, runDir } = unshownState();
  const third = run(dir, ['--resume', runDir, '--approve-excerpts', '--max-usd', '5']);
  assert.deepEqual(seen(logOf(dir, 0)).map(p => p.label), [], 'no seat prompt was built with the unapproved text');
  assert.equal(third.status, 26, `the run waits for the person: ${third.stdout.slice(-300)}${third.stderr.slice(-400)}`);
  assert.match(third.stderr, /This run is stopped at an approval of excerpts of your project \(gate g1\)/);
  assert.equal(readdirSync(runDir).some(f => /^panel-1-.*\.usage\.json$/.test(f)), false, 'nothing ran');
  const g = readGateAnswer(runDir, 'g1').gate;
  assert.deepEqual(g.excerpts.map(e => [e.id, e.lines, e.shown_lines]), [['E-2', '1-2', 2]], 'the pending list is the one read, asked again as E-2');
  assert.deepEqual(rows(runDir).map(e => [e.id, e.approval.status]), [['E-1', 'not_required']], 'nothing is recorded before the answer, and the earlier row is not rewritten');
  const again = run(dir, ['--resume', runDir, '--approve-excerpts', '--max-usd', '5']);   // a second resume before the answer finds the same gate and asks nothing new
  assert.equal(again.status, 26);
  assert.deepEqual(readdirSync(runDir).filter(f => /^excerpt-approval-/.test(f)), ['excerpt-approval-1.txt']);
  // the person approves; the next resume records the answer and the seats see the text, under the new id only
  answer(runDir, 'g1', 'E-2', 'approve');
  const fourth = run(dir, ['--resume', runDir, '--approve-excerpts', '--max-usd', '5']);
  assert.equal(fourth.status, 3, `${fourth.stdout.slice(-300)}${fourth.stderr.slice(-300)}`);
  const all = rows(runDir);
  assert.deepEqual(all.map(e => [e.id, e.approval.status, e.supersedes ?? null, e.answered_stage]), [['E-1', 'not_required', null, 'build'], ['E-2', 'approved', 'E-1', 'build']]);
  assert.equal(all[1].text, all[0].text, 'the copy is the recorded text, not a new cut');
  assert.ok(all.every(e => validateRecord(e)), `every line validates against schemas/excerpts-v1.json: ${JSON.stringify(validateRecord.errors)}`);
  assert.deepEqual(live(runDir).map(e => e.id), ['E-2']);
  const panel = logOf(dir, 0).filter(p => /^panel-1-/.test(p.label));
  assert.ok(panel.length >= 2 && panel.every(p => p.user.includes(TEXT)), 'the panel judges were shown the approved text');
  assert.ok(panel.every(p => p.user.includes('## E-2: ') && !p.user.includes('## E-1: ')), 'under the new id only: the earlier row is no longer live');
});

test('A1, refused: when the person refuses the read, no seat prompt of the run carries the text', () => {
  const { dir, runDir } = unshownState();
  const third = run(dir, ['--resume', runDir, '--approve-excerpts', '--max-usd', '5']);
  assert.deepEqual(seen(logOf(dir, 0)).map(p => p.label), [], 'no seat prompt was built with the unapproved text');
  assert.equal(third.status, 26, `${third.stdout.slice(-300)}${third.stderr.slice(-300)}`);
  answer(runDir, 'g1', 'E-2', 'refuse');
  const fourth = run(dir, ['--resume', runDir, '--approve-excerpts', '--max-usd', '5']);
  assert.equal(fourth.status, 3, `${fourth.stdout.slice(-300)}${fourth.stderr.slice(-300)}`);
  assert.deepEqual(seen(logOf(dir, 0)).map(p => p.label), [], 'no prompt carries the refused text');
  assert.deepEqual(rows(runDir).map(e => [e.id, e.approval.status, e.text, e.supersedes ?? null]), [['E-1', 'not_required', `${TEXT}\nbravo two`, null], ['E-2', 'refused', null, 'E-1']]);
  assert.deepEqual(live(runDir).map(e => e.id), ['E-2'], 'the refused row is the live one: the earlier text is not');
  assert.ok(logOf(dir, 0).some(p => /^panel-1-/.test(p.label)), 'the panel did run (else the assertion above proves nothing)');
});

test('CONTROL, shown: a read a seat has already been shown replays unchanged at --approve-excerpts: no gate, no new row, the panel stage replays from disk with the same prompt hash', () => {
  const { dir, runDir, second } = twoSittings('5');
  assert.equal(second.status, 3, `sitting 2 runs the panel: ${second.stdout.slice(-300)}${second.stderr.slice(-300)}`);
  const before = hashes(runDir);
  assert.ok(Object.keys(before).length >= 2, 'the panel stages exist');
  assert.ok(seen(logOf(dir, 0)).length > 0, 'sitting 2 showed the text to the panel (the premise of "already shown")');
  const third = run(dir, ['--resume', runDir, '--approve-excerpts', '--max-usd', '5']);
  assert.equal(third.status, 3, `${third.stdout.slice(-300)}${third.stderr.slice(-300)}`);
  assert.doesNotMatch(third.stderr + third.stdout, /approval of excerpts of your project|STALENESS/);
  assert.match(third.stdout, /panel-1-mock-a: mock\/mock-priced - from disk/);
  assert.deepEqual(hashes(runDir), before, 'the prompt hash of every panel stage is unchanged');
  assert.deepEqual(rows(runDir).map(e => [e.id, e.approval.status, e.supersedes ?? null]), [['E-1', 'not_required', null]], 'no row is added or replaced');
  assert.equal(existsSync(join(runDir, 'excerpt-approval-1.txt')), false, 'no gate was asked');
  assert.ok(seen(logOf(dir, 0)).every(p => p.user.includes('## E-1: ')), 'the replay carries the same row under the same id');
});

test('CONTROL, switch never turned on: the same unshown read goes on to the seats as it always did, with no gate', () => {
  const { dir, runDir } = unshownState();
  const third = run(dir, ['--resume', runDir, '--max-usd', '5']);
  assert.equal(third.status, 3, `${third.stdout.slice(-300)}${third.stderr.slice(-300)}`);
  const panel = logOf(dir, 0).filter(p => /^panel-1-/.test(p.label));
  assert.ok(panel.length >= 2 && panel.every(p => p.user.includes(TEXT) && p.user.includes('## E-1: ')), 'the judges were shown the recorded text');
  assert.deepEqual(rows(runDir).map(e => [e.id, e.approval.status]), [['E-1', 'not_required']]);
  assert.equal(existsSync(join(runDir, 'gate-ledger.jsonl')), false, 'no switch, no gate');
});

// ---- the other kind of row: a seat's request (the `reqs` chain), at the lowest honest seam ----
test('A1, a seat_request row: the same hold (a request a judge made, recorded not_required before the switch, shown to no seat)', () => {
  const REQS = {
    name: 'reqs', maxRounds: 3, signoff: 'unanimous', criteria: ['It states the assumptions it was written under.'],
    estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
    seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-requests', lab: 'rq' }] },
  };
  const dir = project(REQS);
  const env = { THC_HELD_ALL: '1' };
  const first = run(dir, ['--chain', 'reqs', '--task', 'tasks/x.md'], env);
  assert.equal(first.status, 3, `${first.stdout.slice(-300)}${first.stderr.slice(-300)}`);
  const runDir = onlyRun(dir);
  setHeldForTest({ ...H });
  try {
    submitStageAnswer(runDir, 'revise-1', '# Plan\n\nREVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.\n', { excerptSwitch: RS.excerptSwitchForSubmit, excerptAnswers: [{ request: 1 }] });
    // what a sitting that records the row and stops before any seat call leaves behind: its stamp in run.json, then the row (the real functions)
    const saved = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...saved, sittings: [...saved.sittings, sittingEntry()] }, null, 2));
    recordSessionReads({ runDir, root: dir });
  } finally { setHeldForTest(null); }
  assert.deepEqual(rows(runDir).map(e => [e.id, e.request_kind, e.approval.status]), [['E-1', 'seat_request', 'not_required']]);
  const second = run(dir, ['--resume', runDir, '--approve-excerpts'], env);
  assert.deepEqual(seen(logOf(dir, 0)).map(p => p.label), [], 'no seat prompt was built with the unapproved text');
  assert.equal(second.status, 26, `${second.stdout.slice(-300)}${second.stderr.slice(-400)}`);
  answer(runDir, 'g1', 'E-2', 'approve');
  const third = run(dir, ['--resume', runDir, '--approve-excerpts'], env);
  assert.ok([0, 3].includes(third.status), `${third.status} ${third.stdout.slice(-300)}${third.stderr.slice(-300)}`);
  const all = rows(runDir);
  assert.deepEqual(all.map(e => [e.id, e.request_kind, e.approval.status, e.supersedes ?? null]), [['E-1', 'seat_request', 'not_required', null], ['E-2', 'seat_request', 'approved', 'E-1']]);
  assert.deepEqual([all[1].requested_by, all[1].origin, all[1].objection_id, all[1].path], [all[0].requested_by, all[0].origin, all[0].objection_id, all[0].path], 'the copy keeps who asked, in which reply, for which objection');
  const later = logOf(dir, 0).filter(p => /^panel-2-/.test(p.label));
  assert.ok(later.length > 0 && later.every(p => p.user.includes(TEXT) && p.user.includes('## E-2: ') && !p.user.includes('## E-1: ')), 'the judges after the answer were shown the approved text, under the new id only');
});

// ---- the batch and the evidence, without spawning ----
const T0 = '2026-11-10T10:00:00.000Z'; const T1 = '2026-11-10T11:00:00.000Z'; const T2 = '2026-11-10T12:00:00.000Z'; const T3 = '2026-11-10T13:00:00.000Z';
const folder = (prefix = 'thc-a1-unit-') => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
const put = (runDir, name, body) => writeFileSync(join(runDir, name), typeof body === 'string' ? body : JSON.stringify(body));
const stamp = sitting => ({ writtenBy: { version: '0.8.4', sitting } });

test('rowsMayBeShown: what counts as a seat having been shown the row, and what proves nothing (each case on its own run folder)', () => {
  const row = { id: 'E-1', answered_stage: 'build', approval: { at: T2 } };   // recorded in the 2nd sitting (stamped T1, the 3rd stamped T3 is after it)
  const sittings = [{ at: T0 }, { at: T1 }, { at: T3 }];
  const may = (files, { runJson = { sittings }, reservations = [] } = {}) => {
    const d = folder();
    if (runJson) put(d, 'run.json', runJson);
    for (const [name, body] of Object.entries(files)) put(d, name, body);
    if (reservations.length) put(d, 'spend-reservations.jsonl', `${reservations.map(r => JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r1', usd: 1, ...r })).join('\n')}\n`);
    return RR.rowsMayBeShown(d, [row]).has('E-1');
  };
  assert.equal(may({}), false, 'no stage ran: not shown');
  assert.equal(may({ 'panel-1-a.usage.json': stamp(2), 'panel-1-a.md': 'x' }), true, 'a stage written in the sitting that recorded the row');
  assert.equal(may({ 'panel-1-a.usage.json': stamp(3), 'panel-1-a.md': 'x' }), true, 'or in a later one');
  assert.equal(may({ 'panel-1-a.usage.json': stamp(1), 'panel-1-a.md': 'x', 'build.usage.json': stamp(2) }), false, 'a stage of an EARLIER sitting proves nothing, and the stage whose answer carried the row is never the evidence');
  assert.equal(may({ 'panel-1-a.usage.json': { usd: 0 } }), false, 'a record with no stamp proves nothing (the row is then held: the safe side)');
  assert.equal(may({ 'panel-1-a.usage.json': stamp(2) }, { runJson: null }), false, 'a run folder with no run.json cannot say which sitting recorded the row');
  for (const label of ['answers', 'sort-1', 'retag-pick-2', 'build-check-1', 'preflight-x']) assert.equal(may({ [`${label}.usage.json`]: stamp(3) }), false, `${label}: the session's own call (or one that runs before any stage) is shown no block`);
  assert.equal(may({ 'panel-1-a.late.usage.json': stamp(3) }), false, 'a late answer is never read');
  assert.equal(may({ 'rev-1.prompt.json': stamp(3) }), true, 'an external stage that was asked, answered or not: its NEEDS file carries the block, and the session answering it later must not change the verdict');
  assert.equal(may({ 'rev-1.prompt.json': stamp(3), 'rev-1.md': 'x' }), true, 'the same stage once answered');
  assert.equal(may({ 'rev-1.prompt.json': stamp(1) }), false, 'an external stage asked in an earlier sitting');
  assert.equal(may({ 'rev-1.usage.json': { session_reads: [] }, 'rev-1.prompt.json': stamp(3) }), true, 'a usage record with no stamp (what submit_stage writes) does not hide the prompt record\'s stamp');
  assert.equal(may({}, { reservations: [{ label: 'panel-1-a', seat: 'p/m', at: T3 }] }), true, 'a paid call reserved after the row was recorded went out (no stage record needed)');
  assert.equal(may({}, { reservations: [{ label: 'panel-1-a', seat: 'p/m', at: T1 }] }), false, 'one reserved before it did not');
  assert.equal(may({}, { reservations: [{ label: 'sort-1', seat: 'p/m', at: T3 }] }), false, 'a call of the session\'s own is not one');
});

test('A1, one batch: the copy of the held row comes FIRST, so a read after it gets the id and the stop label the file will give it; the same state gives the same batch; a stamped stage after the row makes it shown and there is no copy', () => {
  const dir = folder(); mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.js'), 'alpha one\nalpha two\nalpha three\n'); writeFileSync(join(dir, 'src', 'b.js'), 'bravo one\nbravo two\n');
  writeFileSync(join(dir, 'src', 'k.js'), `const x = 1;\n${['OPENROUTER_API_KEY=', 'sk', '-or-v1-', Array.from({ length: 64 }, (_, i) => '0a1b2c3d4e5f6789'[i % 16]).join('')].join('')}\n`);
  const runDir = folder();
  const answerStageWith = (stage, reads) => { put(runDir, `${stage}.md`, '# Plan\n'); put(runDir, `${stage}.usage.json`, { session_reads: reads }); };
  setHeldForTest({ excerptsBlock: H.excerptsBlock, sessionReadsField: H.sessionReadsField });
  try {
    answerStageWith('revise-1', [{ path: 'src/a.js', lines: '1-2', why: 'One.' }]);
    recordSessionReads({ runDir, root: dir });   // E-1, not_required, recorded with the switch off
    answerStageWith('revise-2', [{ path: 'src/b.js', why: 'Two.' }]);
    const b = excerptBatch({ runDir, root: dir, hold: true });
    assert.deepEqual(b.inputs.map(i => [i.supersedes ?? null, i.path, i.answered_stage, i.approval === null ? 'waiting' : i.approval.status]), [['E-1', 'src/a.js', 'revise-1', 'waiting'], [null, 'src/b.js', 'revise-2', 'waiting']], 'no run.json: nothing proves a seat saw E-1, so it is asked again, before the new read');
    assert.equal(b.firstId, 2);
    assert.equal(b.inputs[0].text, 'alpha one\nalpha two', 'the recorded text, not a new cut');
    assert.deepEqual(excerptBatch({ runDir, root: dir, hold: true }), b, 'the same state is the same batch (so a second resume finds the same gate)');
    assert.deepEqual(excerptBatch({ runDir, root: dir, hold: false }).inputs.map(i => i.supersedes ?? null), [null], 'with the switch off there is no copy: the read is recorded as it always was');
    // a key-bearing read after the copy: its stop label is the id it will get in the file (E-1 is there, the copy takes E-2, this read E-3)
    answerStageWith('revise-2', [{ path: 'src/k.js', why: 'Two.' }]);
    let hit = null; try { excerptBatch({ runDir, root: dir, hold: true }); } catch (e) { if (e instanceof SecretShapedPrompt) hit = e; else throw e; }
    assert.equal(hit?.label, 'excerpt-E-3');
    answerStageWith('revise-2', [{ path: 'src/b.js', why: 'Two.' }]);
    // a held row the approval gate cannot bind (longer than it can hold) is replaced by the not_cut row a new text of that size gets, with the same note, and is not asked about
    const long = excerptBatch({ runDir, root: dir, hold: true, maxShownLines: 1 });
    assert.deepEqual(long.inputs.map(i => [i.supersedes ?? null, i.approval === null ? 'waiting' : i.approval.status, i.text ?? null]), [['E-1', 'not_cut', null], [null, 'not_cut', null]]);
    assert.match(long.notes.join('\n'), /session read src\/a\.js \(answer to revise-1\) could not be cut: it is longer than an approval screen can hold; it is recorded as not cut\./);
    // an external stage asked after the row was recorded (its pause wrote its prompt record, stamped with the sitting; the row is stamped "now", so that sitting starts before it): E-1 was in that prompt, so there is no copy,
    // and the session answering the stage afterwards changes nothing (else the gate asked before the answer would never be applied)
    put(runDir, 'run.json', { sittings: [{ at: T0 }] }); put(runDir, 'rev-x.prompt.json', stamp(1));
    const asked = excerptBatch({ runDir, root: dir, hold: true });
    assert.deepEqual(asked.inputs.map(i => [i.supersedes ?? null, i.path]), [[null, 'src/b.js']], 'E-1 was shown: no copy, it stays live and replays');
    put(runDir, 'rev-x.md', 'The answer.');
    assert.deepEqual(excerptBatch({ runDir, root: dir, hold: true }), asked, 'the same batch before and after the session answers the stage');
    // the same state with the stage asked in an EARLIER sitting proves nothing: the copy is there before and after the answer
    put(runDir, 'rev-x.prompt.json', stamp(0)); put(runDir, 'run.json', { sittings: [{ at: T0 }, { at: new Date(Date.now() - 1000).toISOString() }] }); put(runDir, 'rev-y.prompt.json', stamp(1));
    const early = excerptBatch({ runDir, root: dir, hold: true });
    assert.deepEqual(early.inputs.map(i => i.supersedes ?? null), ['E-1', null]);
    put(runDir, 'rev-y.md', 'The answer.');
    assert.deepEqual(excerptBatch({ runDir, root: dir, hold: true }), early);
  } finally { setHeldForTest(null); }
});
