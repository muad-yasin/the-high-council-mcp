// 0.8.4 T2.3 / D2 (UNIT 3): the acceptance through the REAL command (`council accept`) and the tool (`stop_decide` step quote / accept) on a real finished run. The envelope is test/overseer-choice.test.js C3b (a layered mock chain stopped
// at the overseer cap, then --finish) with a handoff seat that writes milestones, as test/handoff-status-clamp.test.js C5 has it. The person's terminal answer is the gate's own library call on the channel `cli` (a test has no terminal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { answerGate, acceptancesOf } from '../src/gate.js';
import { askAcceptance, answerAcceptance, applyAcceptance } from '../src/accept-run.js';
import { stopDecideResult } from '../src/mcp/stop-decide.js';
import { handlerNotesOf, planNotes, writeDerived, NOTES_FILE, NOTE_ACTOR } from '../src/handler-notes.js';
import { textSha256 } from '../src/text-labels.js';
import { lateFindingRow } from '../src/late-finding.js';
import { acceptCommand } from '../src/accept-cli.js';
import { clampStatus } from '../src/handoff-status.js';
import { statusAllowedOf } from '../src/ending-matrix.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainFor = critics => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  handoff: true, handoff_contract: { milestones: true }, dispute: { enabled: true, stall_rounds: 99 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, handoff: { provider: 'mock', model: 'mock-handoff-milestones' }, critics },
});
const made = [];
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const project = (critics) => {
  const dir = mkdtempSync(join(tmpdir(), 'acc-')); made.push(dir);
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainFor(critics)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const council = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, council, runDir, runsDir: join(dir, 'runs'), runId: () => readdirSync(join(dir, 'runs'))[0] };
};
/** A run the person finished at the overseer cap: ended without agreement, with open objections, a HANDOFF.md whose Status the harness clamped. */
let seq = 0;
function finished() {
  seq += 1;
  const p = project([judge('o', `fa${seq}`, 'l1', 1), judge('o', `fb${seq}`, 'l2', 2), judge('x', `fc${seq}`, 'l3', 3)]);
  const first = p.council(['--chain', 'ovc', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, first.stdout + first.stderr);
  const done = p.council(['--resume', p.runDir(), '--finish']);
  assert.notEqual(done.status, 23, done.stdout + done.stderr);
  return p;
}
const readReport = p => JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
/** FIXTURE (not under test): the mock chain makes no late finding, so the report carries one row. The row is made by lateFindingRow, the one function every writer site in src/chain.js (4905, 7281, 7550, 7624) builds its rows with, and src/report-shape.js:219 copies result.lateFindings unchanged; test/acceptance-late-real.test.js feeds a row from a real in-process run through the same readers. */
const withLateFinding = p => { writeFileSync(join(p.runDir(), 'report.json'), JSON.stringify({ ...readReport(p), late_findings: [lateFindingRow({ id: 'L-0badf00d', lab: 'l3', problem: 'The plan never says who restarts the job.', rating: 6, flags: [], round: 7 })] })); };
const readHandoff = p => readFileSync(join(p.runDir(), 'HANDOFF.md'), 'utf8');
const validates = report => { const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true); const v = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'))); return [v(report), v.errors]; };
const person = (p, gateId, reason) => {
  const ledgerGate = JSON.parse(readFileSync(join(p.runDir(), 'gates', `${gateId}.json`), 'utf8'));
  return answerGate(p.runDir(), gateId, { channel: 'cli', shownSha256: ledgerGate.sha256, decision: 'approved', actor: 'maya', reason, tty: true });
};
const addNote = (p, text) => {
  const dir = p.runDir(); const have = handlerNotesOf(dir).notes;
  const added = { n: have.length + 1, at: '2026-11-09T11:00:00.000Z', actor: NOTE_ACTOR, text };
  const plan = planNotes(dir, [...have, added]); assert.equal(plan.ok, true, JSON.stringify(plan));
  appendFileSync(join(dir, NOTES_FILE), `${JSON.stringify(added)}\n`);
  const done = writeDerived(dir, plan); assert.equal(done.ok, true, JSON.stringify(done));
};
const checkLine = p => {
  const r = p.council(['contract', 'check', join('runs', p.runId())]);
  return `${r.stdout}${r.stderr}`;   // the whole output: the HANDOFF.md row is one line of it
};

test('F1 the person\'s acceptance through the real command: no terminal waits (exit 3), no reason is a usage error, the answered gate is applied by running it again, and the files say what the record says', () => {
  const p = finished();
  const before = readHandoff(p); const beforeReport = readReport(p);
  assert.match(before, /^Status: needs_decision$/m, 'the harness clamped the seat\'s ready_for_build');
  assert.equal(beforeReport.acceptance, undefined);
  const noReason = p.council(['accept', join('runs', p.runId())]);
  assert.equal(noReason.status, 2, noReason.stdout + noReason.stderr);
  const waiting = p.council(['accept', join('runs', p.runId()), '--reason', 'The risk is mine to carry.']);
  assert.equal(waiting.status, 3, waiting.stdout + waiting.stderr);
  assert.match(waiting.stdout, /gate g1 is waiting for a person/);
  assert.equal(readHandoff(p), before, 'nothing changed while the gate waits');
  assert.equal(person(p, 'g1', 'The risk is mine to carry.').ok, true);
  const applied = p.council(['accept', join('runs', p.runId()), '--reason', 'The risk is mine to carry.']);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.match(applied.stdout, /is accepted as it stands/);
  const report = readReport(p); const text = readHandoff(p);
  assert.deepEqual([report.acceptance.channel, report.acceptance.actor, report.acceptance.reason, report.acceptance.status_restored], ['cli', 'maya', 'The risk is mine to carry.', 'ready_for_build']);
  assert.ok(report.acceptance.objections.length > 0 && report.acceptance.objections.every(o => /^O-/.test(o.id) && o.person_test === undefined));
  assert.ok(report.acceptance.objections.every(o => JSON.stringify(Object.keys(o)) === '["id"]'), 'a run with no late finding: each entry is { id } alone, `late` absent (never false)');
  assert.match(text, /^> \*\*Accepted as it stands\*\* by a choice typed at the terminal on \d{4}-\d{2}-\d{2}: The risk is mine to carry\. Open objections left standing, accepted as they stand: O-/m);
  assert.match(text, /^Status: ready_for_build$/m, 'the seat\'s own Status is back');
  assert.doesNotMatch(text, /Status set to needs_decision by the harness/);
  assert.match(text, /Not a signed-off plan/, 'the banner stays: nothing is marked agreed');
  assert.equal(report.ending_word, 'finish_chosen');
  assert.equal(report.handoff_text.file_sha256, textSha256(text), 'file_sha256 follows the file');
  assert.equal(report.handoff_text.file_sha256_at_end, beforeReport.handoff_text.file_sha256, 'file_sha256_at_end stays the file as the run wrote it');
  const [ok, errors] = validates(report); assert.ok(ok, JSON.stringify(errors));
  assert.match(checkLine(p), /HANDOFF\.md is the file the run wrote \(\w+\) plus the acceptance added after the run ended/);
  const again = p.council(['accept', join('runs', p.runId()), '--reason', 'x']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /already accepted/);
  assert.equal(readHandoff(p), text, 'a second accept writes nothing');
});

test('F5 a run with an open late finding: the question the person is asked carries its id (marked late), and the record and the line name it', () => {
  const p = finished();
  withLateFinding(p);
  const waiting = p.council(['accept', join('runs', p.runId()), '--reason', 'The late finding is a risk I carry.']);
  assert.equal(waiting.status, 3, waiting.stdout + waiting.stderr);
  const question = readFileSync(join(p.runDir(), 'accept-quote-0001.md'), 'utf8');
  assert.match(question, /^- L-0badf00d \(l3, a late finding\): The plan never says who restarts the job\.$/m);
  assert.match(question, /^Open objections and late findings accepted as they stand/m);
  assert.equal(person(p, 'g1', 'The late finding is a risk I carry.').ok, true);
  const applied = p.council(['accept', join('runs', p.runId()), '--reason', 'The late finding is a risk I carry.']);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const report = readReport(p); const text = readHandoff(p);
  assert.deepEqual(report.acceptance.objections.filter(o => o.late).map(o => o.id), ['L-0badf00d']);
  assert.ok(report.acceptance.objections.some(o => /^O-/.test(o.id) && o.late === undefined), 'the open objections are listed beside it, not marked late');
  assert.match(text, /Late findings, not debated, accepted as they stand: L-0badf00d\./);
  const [ok, errors] = validates(report); assert.ok(ok, JSON.stringify(errors));
});

test('F6 accept and note-add compose in either order on a run with a late finding: one acceptance line carrying the late tail, one note, the file hash follows the file, and the contract check reads both', () => {
  const a = finished(); const b = finished();
  for (const p of [a, b]) withLateFinding(p);
  const at0 = readReport(a).handoff_text.file_sha256;
  const doAccept = p => { assert.equal(p.council(['accept', join('runs', p.runId()), '--reason', 'I accept this plan.']).status, 3); assert.equal(person(p, 'g1', 'I accept this plan.').ok, true); const r = p.council(['accept', join('runs', p.runId()), '--reason', 'I accept this plan.']); assert.equal(r.status, 0, r.stdout + r.stderr); };
  doAccept(a); addNote(a, 'The handler thinks the retry bound is thin.');   // accept, then a note
  addNote(b, 'The handler thinks the retry bound is thin.'); doAccept(b);   // a note, then accept
  for (const p of [a, b]) {
    const text = readHandoff(p); const report = readReport(p);
    const lines = text.split('\n').filter(l => l.startsWith('> **Accepted as it stands**'));
    assert.equal(lines.length, 1, 'one acceptance line');
    assert.match(lines[0], /Late findings, not debated, accepted as they stand: L-0badf00d\. Written by the harness, not a model\.$/);
    assert.equal(text.split('\n').filter(l => l.startsWith('> Note 1 (')).length, 1, 'one note');
    assert.equal(report.handoff_text.file_sha256, textSha256(text));
    assert.deepEqual(report.acceptance.objections.filter(o => o.late).map(o => o.id), ['L-0badf00d']);
    assert.match(checkLine(p), /plus the acceptance and the 1 note added after the run ended/);
  }
  assert.equal(readReport(a).handoff_text.file_sha256_at_end, at0, 'accept-then-note kept the run\'s own hash');
});

/** acceptCommand in this process with no terminal (stdin and stdout are not TTYs): the exit code and what it said. `seam` carries the failing `write` / `rename`. */
const acceptHere = async (p, seam = {}) => { const o = []; const e = []; const code = await acceptCommand([join('runs', p.runId())], { work: p.dir, reason: 'I accept this plan.', stdin: { isTTY: false }, stdout: { isTTY: false, write: s => o.push(s) }, stderr: { isTTY: false, write: s => e.push(s) }, ...seam }); return { code, out: o.join(''), err: e.join('') }; };
const gateFiles = p => (existsSync(join(p.runDir(), 'gates')) ? readdirSync(join(p.runDir(), 'gates')).filter(f => /^g\d+\.json$/.test(f)) : []);
const bytesOf = p => ({ handoff: readFileSync(join(p.runDir(), 'HANDOFF.md'), 'utf8'), report: readFileSync(join(p.runDir(), 'report.json'), 'utf8') });
const failing = at => { let calls = 0; return (a, b) => { calls += 1; if (calls === at) throw Object.assign(new Error('simulated'), { code: 'EIO' }); return renameSync(a, b); }; };

test('F7a the question file cannot be written: council accept exits 1, requests no gate and changes nothing; the next call asks, the person answers, and it completes with one acceptance line', async () => {
  const p = finished(); const before = bytesOf(p);
  const noFile = await acceptHere(p, { write: () => ({ refusal: 'could not write accept-quote-0001.md (EIO)' }) });
  assert.equal(noFile.code, 1, noFile.out + noFile.err);
  assert.match(noFile.err, /could not write accept-quote-0001\.md \(EIO\)\. Nothing was recorded\./);
  assert.deepEqual(gateFiles(p), [], 'no gate for a question file that was never written');
  assert.deepEqual(readdirSync(p.runDir()).filter(f => f.startsWith('accept-quote')), []);
  assert.deepEqual(bytesOf(p), before);
  const waiting = await acceptHere(p); assert.equal(waiting.code, 3, waiting.out + waiting.err);
  assert.deepEqual(gateFiles(p), ['g1.json']);
  assert.equal(person(p, 'g1', 'I accept this plan.').ok, true);
  const done = await acceptHere(p); assert.equal(done.code, 0, done.out + done.err);
  assert.equal(readHandoff(p).split('\n').filter(l => l.startsWith('> **Accepted as it stands**')).length, 1);
  assert.equal(readReport(p).acceptance.gate, 'g1');
});

test('F7b the report.json / HANDOFF.md update fails (at the first rename, then at the second after the first went through): exit 1, both files exactly as they were, no temp file, the approved gate stays and no second gate appears; the next call completes it', async () => {
  const p = finished(); const before = bytesOf(p);
  assert.equal((await acceptHere(p)).code, 3);
  assert.equal(person(p, 'g1', 'I accept this plan.').ok, true);
  for (const at of [1, 2]) {
    const bad = await acceptHere(p, { rename: failing(at) });
    assert.equal(bad.code, 1, `rename ${at}: ${bad.out}${bad.err}`);
    assert.match(bad.err, /could not be updated \(EIO\)\. The approved acceptance stays on the ledger; run it again\./);
    assert.deepEqual(bytesOf(p), before, `rename ${at}: nothing half-written`);
    assert.deepEqual(readdirSync(p.runDir()).filter(f => f.includes('.tmp-')), [], `rename ${at}: no temp file left`);
    assert.equal(acceptancesOf(p.runDir()).accepted.length, 1, `rename ${at}: the approved gate is still on the ledger`);
    assert.deepEqual(gateFiles(p), ['g1.json']);
  }
  const done = await acceptHere(p); assert.equal(done.code, 0, done.out + done.err);
  assert.equal(readHandoff(p).split('\n').filter(l => l.startsWith('> **Accepted as it stands**')).length, 1);
  assert.equal(readReport(p).acceptance.gate, 'g1');
  assert.deepEqual(gateFiles(p), ['g1.json']);
});

test('F8 a replay whose cached handoff text carries the clamp (a case-insensitive disk: the stage file is HANDOFF.md itself) gives the seat\'s own Status in the report, and the acceptance restores the seat\'s word', async () => {
  const p = finished(); const dir = p.runDir();
  const seat = readFileSync(join(dir, 'handoff.md'), 'utf8');
  assert.match(seat, /^Status: ready_for_build/m, 'premise: the stage file is the seat\'s own text');
  const clamped = clampStatus(seat, statusAllowedOf('round_cap', { agreed: false })).text;
  assert.notEqual(clamped, seat, 'premise: the clamp changed the text');
  // FIXTURE (the collision FX-9 simulates): the stage file holds the clamped text; the run is taken back to unfinished so --resume replays every stage from disk
  writeFileSync(join(dir, 'handoff.md'), clamped);
  renameSync(join(dir, 'report.json'), join(dir, 'report.json.moved')); renameSync(join(dir, 'HANDOFF.md'), join(dir, 'HANDOFF.md.moved'));
  const r = p.council(['--resume', dir]);
  assert.ok(r.status !== 23 && existsSync(join(dir, 'report.json')), `premise: the resume wrote the report (${r.status}) ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
  const report = readReport(p); const text = readHandoff(p);
  assert.equal(report.handoff_milestones.status, 'ready_for_build', 'the lift gave back the seat\'s own Status before the lint and the clamp');
  assert.equal(report.handoff_milestones.status_set_by_harness, 'needs_decision');
  assert.match(text, /^Status: needs_decision\n> Status set to needs_decision by the harness: the handoff said ready_for_build, /m);
  assert.equal(p.council(['accept', join('runs', p.runId()), '--reason', 'I accept this plan.']).status, 3);
  assert.equal(person(p, 'g1', 'I accept this plan.').ok, true);
  const applied = p.council(['accept', join('runs', p.runId()), '--reason', 'I accept this plan.']);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(readReport(p).acceptance.status_restored, 'ready_for_build');
  assert.match(readHandoff(p), /^Status: ready_for_build$/m);
});

test('F2 accept and note-add compose in either order: the file is the run\'s own file plus the line plus the notes section, the hash at the end stays the run\'s, and the contract check reads both', () => {
  const a = finished(); const b = finished();
  for (const p of [a, b]) assert.match(readHandoff(p), /^Status: needs_decision$/m);
  const at0 = readReport(a).handoff_text.file_sha256;
  const doAccept = p => { assert.equal(p.council(['accept', join('runs', p.runId()), '--reason', 'I accept this plan.']).status, 3); assert.equal(person(p, 'g1', 'I accept this plan.').ok, true); const r = p.council(['accept', join('runs', p.runId()), '--reason', 'I accept this plan.']); assert.equal(r.status, 0, r.stdout + r.stderr); };
  doAccept(a); addNote(a, 'The handler thinks the retry bound is thin.');   // accept, then a note
  addNote(b, 'The handler thinks the retry bound is thin.'); doAccept(b);   // a note, then accept
  for (const p of [a, b]) {
    const text = readHandoff(p); const report = readReport(p);
    assert.equal(text.split('\n').filter(l => l.startsWith('> **Accepted as it stands**')).length, 1, 'one acceptance line');
    assert.equal(text.split('\n').filter(l => l.startsWith('> Note 1 (')).length, 1, 'one note');
    assert.match(text, /^Status: ready_for_build$/m);
    assert.equal(report.handoff_text.file_sha256, textSha256(text));
    assert.ok(/^[0-9a-f]{64}$/.test(report.handoff_text.file_sha256_at_end));
    assert.match(checkLine(p), /plus the acceptance and the 1 note added after the run ended/);
  }
  assert.equal(readReport(a).handoff_text.file_sha256_at_end, at0, 'accept-then-note kept the run\'s own hash');
  // a third edit still composes: a second note after both
  addNote(a, 'And a second note.');
  assert.match(checkLine(a), /plus the acceptance and the 2 notes added after the run ended/);
  assert.equal(readHandoff(a).split('\n').filter(l => l.startsWith('> **Accepted as it stands**')).length, 1);
});

test('F3 a run that ended agreed has nothing to accept: exit 2, nothing written', () => {
  seq += 1;
  const p = project([judge('o', `ga${seq}`, 'l1', 1), judge('o', `gb${seq}`, 'l2', 2), judge('o', `gc${seq}`, 'l3', 3)]);
  const r = p.council(['--chain', 'ovc', '--task', 'tasks/t.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const before = readHandoff(p);
  const acc = p.council(['accept', join('runs', p.runId()), '--reason', 'why']);
  assert.equal(acc.status, 2, acc.stdout + acc.stderr);
  assert.match(acc.stderr, /ended agreed, so there is nothing to accept/);
  assert.equal(readHandoff(p), before);
});

// ---- the handling session, through the tool
const call = async (p, args) => JSON.parse((await stopDecideResult({ runsDir: p.runsDir, args: { run: p.runId(), ...args }, resumeWith: async () => ({}) })).content[0].text);
const V = (person, unsettled, preference, reason = 'The record settles it.') => ({ person, unsettled_by_record: unsettled, preference, reason });
const NO = { session: V('no', false, false), advisor: V('no', false, false, 'Agreed: a fact.') };
const YES = { session: V('yes', true, true, 'It turns on what they want.'), advisor: V('yes', true, true, 'Agreed: their preference.') };
const fields = ids => ({ reason: 'Nothing here changes the plan.', advisor: 'consulted', advisor_said: 'Agreed: accept it.', objections: ids.map(id => ({ id, person_test: NO })) });

test('S1 the session: a finish typed at the terminal is the person\'s stop, so the tool says the person accepts and records nothing', async () => {
  const p = finished();
  const q = await call(p, { step: 'quote' });
  assert.equal(q.requires_user, true, JSON.stringify(q));
  // CHANGED ACCEPTED (0.8.4 relayed accept): OLD bar: the quote answered with an `error` (q.error matched) and asked no question; NEW: requires_user plus the gate and a `note` (no error key), because the question is asked so the person's words can be relayed against it
  assert.equal(q.error, undefined);
  assert.match(q.note, /answered at the terminal, so accepting this plan is the person's/);
  assert.match(q.note, /council accept runs\//);
  assert.deepEqual(acceptancesOf(p.runDir()).accepted, []);
});

test('S2 the session accepts through quote and accept (fixture: the stop\'s choice recorded as the session\'s and the text as the signed text): its person tests are recorded for each objection, the line and the Status are written, and every refusal on the way records nothing', async () => {
  const p = finished();
  // FIXTURE (not under test here): the finish above was typed at the terminal; record it as the session's, and the mock dispute stage's rewrite as not having changed the text
  const rj = JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8'));
  writeFileSync(join(p.runDir(), 'run.json'), JSON.stringify({ ...rj, roundChoices: rj.roundChoices.map(c => ({ ...c, channel: 'session', actor: 'handling_session' })) }));
  const rep = readReport(p); rep.delivered_text.same_as_signed = true; writeFileSync(join(p.runDir(), 'report.json'), JSON.stringify(rep));
  const handoffBefore = readHandoff(p);
  const q = await call(p, { step: 'quote' });
  assert.ok(q.gate && q.shown && Array.isArray(q.objections) && q.objections.length > 0, JSON.stringify(q));
  assert.match(q.text, /Accept this plan as it stands/);
  assert.deepEqual(q.objections, [...q.objections].sort());
  const base = { step: 'accept', gate: q.gate, shown: q.shown };
  const refusals = [
    [{ ...base, shown: 'f'.repeat(64), ...fields(q.objections) }, /is not the acceptance question as it stands now/],
    [{ ...base, ...fields(q.objections), reason: ' ' }, /written reason is missing/],
    [{ ...base, ...fields(q.objections.slice(1)) }, /objections must name exactly the open objections/],
    [{ ...base, ...fields(['O-notthere']) }, /objections must name exactly the open objections/],
    [{ ...base, ...fields(q.objections), objections: undefined }, /objections is missing/],
    [{ ...base, ...fields(q.objections), objections: q.objections.map((id, i) => ({ id, person_test: i === 0 ? YES : NO })) }, /both say this objection is the person's/],
    [{ ...base, ...fields(q.objections), reason: 'a\nb' }, /one line of plain text|control or direction characters/],
  ];
  for (const [args, re] of refusals) { const r = await call(p, args); assert.match(r.error ?? '', re, JSON.stringify(r)); assert.equal(r.recorded, undefined); }
  assert.deepEqual(acceptancesOf(p.runDir()).accepted, [], 'no refusal recorded anything');
  assert.equal(readHandoff(p), handoffBefore);
  assert.equal(readReport(p).acceptance, undefined);
  const withOneYes = q.objections.map((id, i) => ({ id, person_test: i === 0 ? { session: V('yes', true, true, 'It turns on what they want.'), advisor: V('no', false, false, 'A fact the record settles.') } : NO }));
  const ok = await call(p, { ...base, ...fields(q.objections), objections: withOneYes });
  assert.equal(ok.recorded?.channel, 'session', JSON.stringify(ok));
  assert.deepEqual(ok.recorded.over_disagreement, [q.objections[0]], 'one yes is recorded, and the session still accepts');
  const report = readReport(p); const text = readHandoff(p);
  assert.equal(report.acceptance.channel, 'session');
  assert.deepEqual(report.acceptance.objections.map(o => o.id), q.objections);
  assert.ok(report.acceptance.objections.every(o => JSON.stringify(Object.keys(o)) === '["id","person_test"]'), 'no late finding: { id, person_test } and `late` absent');
  assert.deepEqual(report.acceptance.over_disagreement, [q.objections[0]]);
  assert.equal(report.acceptance.advisor, 'consulted');
  assert.match(text, /^> \*\*Accepted as it stands\*\* by the handling session on /m);
  assert.match(text, /^Status: ready_for_build$/m);
  const [okSchema, errors] = validates(report); assert.ok(okSchema, JSON.stringify(errors));
  const second = await call(p, { step: 'quote' });
  assert.match(second.error ?? '', /already accepted/);
});

test('S3 an approved session acceptance that no longer passes today\'s checks does not block the person: the person\'s own question is asked and applied', async () => {
  const p = finished();
  const rj = JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8'));
  writeFileSync(join(p.runDir(), 'run.json'), JSON.stringify({ ...rj, roundChoices: rj.roundChoices.map(c => ({ ...c, channel: 'session', actor: 'handling_session' })) }));
  const rep = readReport(p); rep.delivered_text.same_as_signed = true; writeFileSync(join(p.runDir(), 'report.json'), JSON.stringify(rep));
  const dir = p.runDir(); const id = p.runId();
  const asked = askAcceptance(dir, id, { requestedBy: 'session' }); assert.equal(asked.ok, true, JSON.stringify(asked));
  const approved = answerAcceptance(dir, asked.gate.id, { shownSha256: asked.quote.sha256, reason: 'Nothing here changes the plan.', acceptanceAnswer: { advisor: 'none', advisor_said: '', objections: asked.quote.objections.map(o => ({ id: o.id, person_test: { session: V('no', false, false), advisor: V('no', false, false, 'no advisor') } })) } });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  // the stop is now the person\'s (a choice typed at the terminal): the session\'s approval fails its re-check and is not applied
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...rj, roundChoices: rj.roundChoices.map(c => ({ ...c, channel: 'cli' })) }));
  const refused = applyAcceptance(dir, id);
  assert.deepEqual([refused.ok, refused.code], [false, 'session_person_stop']);
  assert.equal(readReport(p).acceptance, undefined);
  // the person is not blocked: no terminal, so their own question waits as a new gate; answered, it applies
  const waiting = p.council(['accept', join('runs', id), '--reason', 'I accept it myself.']);
  assert.equal(waiting.status, 3, waiting.stdout + waiting.stderr);
  const g2 = waiting.stdout.match(/gate (g\d+) is waiting/)[1];
  assert.notEqual(g2, asked.gate.id);
  assert.equal(person(p, g2, 'I accept it myself.').ok, true);
  const done = p.council(['accept', join('runs', id), '--reason', 'I accept it myself.']);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.deepEqual([readReport(p).acceptance.channel, readReport(p).acceptance.reason], ['cli', 'I accept it myself.']);
});

test('F4 a node of a tree is not accepted here: the command and the tool both say the tree\'s own commands do it, and write nothing', async () => {
  const p = finished();
  const rj = JSON.parse(readFileSync(join(p.runDir(), 'run.json'), 'utf8'));
  writeFileSync(join(p.runDir(), 'run.json'), JSON.stringify({ ...rj, tree: { treeId: 'tree1', node: 'R/M1', generation: 1 } }));
  const before = readHandoff(p);
  const r = p.council(['accept', join('runs', p.runId()), '--reason', 'why']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /node of a recursive-councils tree/);
  assert.match(r.stderr, /council tree decide tree1 --stop <stop id>/, 'the refusal names the tree command that answers it');
  const q = await call(p, { step: 'quote' });
  assert.match(q.error ?? '', /node of a recursive-councils tree/);
  assert.equal(readHandoff(p), before);
  assert.deepEqual(acceptancesOf(p.runDir()).accepted.concat(acceptancesOf(p.runDir()).pending), []);
});

