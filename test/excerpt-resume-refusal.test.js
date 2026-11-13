// 0.8.4 D10 slice 2c-2 (H2-v; C&C's ruling (ii)): a run with a gate of kind excerpt_approval that has no excerpts_recorded line is STOPPED at an excerpt approval, as far as today's verbs go: a plain --resume is refused with
// the one dedicated exit code, 26, WHATEVER the gate's status (pending, answered but not applied, declined, expired: an answered gate must not be walked past in the race between the answer and the use), nothing is
// run or spent, run_status derives `awaiting_excerpt_approval`, and the run is not resumable. A gate that has its excerpts_recorded line no longer stops it. Offline, $0: the run is a mock chain with an external
// builder seat (it pauses, exit 3, and can be resumed without finishing); the gate is made through the gate module.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { requestGate, answerGate, recordExcerptsRecorded, recordExcerptSwitchOn } = await import('../src/gate.js');
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { deriveRunStatus, runResumability } from '../src/run-status.js';
import { generateResumeBrief } from '../src/resume-brief.js';
import { writeStoppedMarker } from '../src/stop-files.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const EX = [{ id: 'E-1', lines: null, text_sha256: 'a'.repeat(64), shown_lines: 2 }];
function pausedRun() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-excerpt-resume-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'p.json'), JSON.stringify({ ...cfg, name: 'p', seats: { ...cfg.seats, builder: { provider: 'external', model: 'x', lab: 'ext' } } }));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  assert.equal(run(['--chain', 'p', '--task', 'tasks/t.md']).status, 3);
  const rd = join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
  return { dir, rd, run };
}
// an excerpt gate in the run folder; `ago` minutes in the past it was asked (so with the ten minutes of a gate it may already have expired), answered a minute after that
function gateIn(rd, { ago = 0, answer = null } = {}) {
  writeFileSync(join(rd, 'excerpt-screen.md'), 'Excerpt 1 of 1\n1  one\n2  two\n');
  const t0 = Date.now() - ago * 60_000;
  const g = requestGate(rd, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: EX }, { now: () => t0 });
  assert.equal(g.ok, true, JSON.stringify(g));
  if (answer) {
    const a = answerGate(rd, g.gate.id, { channel: 'cli', shownSha256: g.gate.sha256, decision: answer === 'approve' ? 'approved' : 'declined', actor: 'alice', tty: true, ...(answer === 'approve' ? { excerptAnswers: [{ id: 'E-1', decision: 'approve' }] } : {}) }, { now: () => t0 + 60_000 });
    assert.equal(a.ok, true, JSON.stringify(a));
  }
  return g.gate;
}
// every file of the folder (recursive) with the sha256 of its bytes: the folder "unchanged" means exactly this map is equal
const snapshot = (dir, rel = '') => Object.fromEntries(readdirSync(join(dir, rel), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? Object.entries(snapshot(dir, join(rel, e.name))) : [[join(rel, e.name), createHash('sha256').update(readFileSync(join(dir, rel, e.name))).digest('hex')]])));

test('a plain --resume of a run stopped at a PENDING excerpt approval is refused with exit 26: it names the gate and the terminal command, runs and spends nothing, and changes not one file of the folder', () => {
  const { rd, run } = pausedRun();
  const g = gateIn(rd);
  const before = snapshot(rd);
  const r = run(['--resume', rd]);
  assert.equal(r.status, 26, r.stdout + r.stderr);
  assert.match(r.stderr, /This run is stopped at an approval of excerpts of your project \(gate g1\): it waits for your answers\./);
  assert.ok(r.stderr.includes(`gate answer ${rd} ${g.id}`), 'the command that answers it is named');
  assert.match(r.stderr, /a resume is refused until you have answered, and the resume after that records your answers\./);
  assert.match(r.stderr, /Nothing was run and nothing was spent\./);
  assert.deepEqual(snapshot(rd), before, 'not one file of the folder changed: no stage, no log, no ledger line, no run.json write');
});

test('the basis is the record fact "no excerpts_recorded line", whatever the gate\'s status: answered but not applied, declined, and expired all stop a resume with the same code', () => {
  for (const [what, opts, phrase] of [['approved, not applied', { ago: 5, answer: 'approve' }, /has your answers, which are not applied yet\. A resume is refused until they are applied\./], ['declined', { ago: 5, answer: 'decline' }, /was declined, which is not applied yet\. A resume is refused until that is applied\./], ['expired unanswered', { ago: 60 }, /ran out of time before it was answered\. A resume is refused until it is asked again\./]]) {
    const { rd, run } = pausedRun();
    gateIn(rd, opts);
    const r = run(['--resume', rd]);
    assert.equal(r.status, 26, `${what}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, phrase, what);
    assert.equal(r.stderr.includes('gate answer'), false, `${what}: only a gate that waits is answered at a terminal`);
  }
});

test('with its excerpts_recorded line the gate no longer stops the run: the same resume goes on to the external seat (exit 3), and a run that never had a gate is unchanged', () => {
  const { rd, run } = pausedRun();
  assert.equal(run(['--resume', rd]).status, 3, 'no gate: unchanged');
  const g = gateIn(rd, { ago: 5, answer: 'approve' });
  assert.equal(run(['--resume', rd]).status, 26);
  assert.equal(recordExcerptsRecorded(rd, g.id, { runId: 'r1', count: 1 }).ok, true);
  assert.equal(run(['--resume', rd]).status, 3, 'recorded: the stop is lifted');
});

test('a forged excerpts_recorded line cannot lift the stop: the ledger no longer verifies and the resume is refused (exit 2) by the readers that were there, never walked past', () => {
  const { rd, run } = pausedRun();
  gateIn(rd);   // asked, unanswered
  const raw = readFileSync(join(rd, LEDGER_FILE), 'utf8').split('\n').filter(Boolean);
  const last = raw[raw.length - 1];
  const forged = JSON.stringify({ schema: 'gate-ledger/1', seq: raw.length + 1, prev: createHash('sha256').update(last).digest('hex'), ts: new Date().toISOString(), event: 'excerpts_recorded', gate: 'g1', sha256: 'a'.repeat(64), run_id: 'r1', count: 1 });
  writeFileSync(join(rd, LEDGER_FILE), `${raw.join('\n')}\n${forged}\n`);
  const r = run(['--resume', rd]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /approval record of this run cannot be read/);
});

test('run_status: the run derives `awaiting_excerpt_approval` (before an external stage that waits), is not resumable, says what it needs and which gate; once recorded it is paused again', () => {
  const { rd } = pausedRun();
  assert.equal(deriveRunStatus(rd, null), 'paused');
  const g = gateIn(rd);
  assert.equal(deriveRunStatus(rd, null), 'awaiting_excerpt_approval');
  const res = runResumability(rd, null);
  assert.deepEqual([res.status, res.resumable, res.reason, res.needs, res.gate], ['awaiting_excerpt_approval', false, 'awaiting_excerpt_approval', 'excerpt_approval', g.id]);
  answerGate(rd, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] });
  assert.equal(deriveRunStatus(rd, null), 'awaiting_excerpt_approval', 'answered but not applied still holds the run');
  recordExcerptsRecorded(rd, g.id, { runId: 'r1', count: 1 });
  assert.equal(deriveRunStatus(rd, null), 'paused');
});

test('the code is 26, one named constant in src/exit-codes.js (the pause unit uses it too), a stop and not a finish', async () => {
  const codes = await import('../src/exit-codes.js');
  assert.equal(codes.EXIT_AWAITING_EXCERPT_APPROVAL, 26);
  assert.equal(codes.FINISHED_EXIT_CODES.has(26), false);
  const text = readFileSync(join(root, 'src', 'exit-codes.js'), 'utf8');
  assert.match(text, /THIS CONSTANT IS THE ONE the pause unit/);
});

test('the resume brief of a run stopped at an excerpt approval names the gate and the terminal command, says every resume is refused with exit 26, and a run with no gate reads as before', () => {
  const { rd } = pausedRun();
  const meta = JSON.parse(readFileSync(join(rd, 'run.json'), 'utf8'));
  const before = generateResumeBrief({ runId: 'r1', dir: rd, runMeta: meta, chainConfig: null });
  assert.equal(before.includes('excerpt'), false, 'no gate: no mention');
  const g = gateIn(rd);
  const brief = generateResumeBrief({ runId: 'r1', dir: rd, runMeta: meta, chainConfig: null });
  assert.match(brief, /Stage: stopped at an approval of excerpts of the project/);
  assert.ok(brief.includes(`Waiting on: the excerpt approval, gate ${g.id}, which waits for your answers`));
  assert.ok(brief.includes(`Answer at a terminal with \`council gate answer ${rd} ${g.id}\``));
  assert.match(brief, /Every resume \(resume_run, submit_stage, `council --resume`\) is refused with exit 26 meanwhile\./);
  assert.equal(brief.includes('prepare_stage_prompt'), false, 'it does not send the driving session to answer the stage');
});


test('CARRIED FIX (C&C 09 Nov 2026): a run that carries an owner-pause marker AND an open excerpt gate derives awaiting_excerpt_approval, the state the refusal (exit 26) belongs to, never owner_paused', () => {
  const { rd, run } = pausedRun();
  const g = gateIn(rd);
  writeStoppedMarker(rd, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, reason: 'paused after the round' });
  assert.equal(deriveRunStatus(rd, null), 'awaiting_excerpt_approval');
  const res = runResumability(rd, null);
  assert.deepEqual([res.status, res.resumable, res.reason, res.gate], ['awaiting_excerpt_approval', false, 'awaiting_excerpt_approval', g.id]);
  assert.equal(run(['--resume', rd]).status, 26);
});

test('WITH THE SWITCH ON (D10 slice 2c CHANGED ACCEPTED, C&C 09 Nov 2026): a gate that waits for the person and a gate whose record cannot be read still refuse a plain resume with exit 26; an answered gate and an expired one do not (the pause unit applies the one and asks again for the other)', () => {
  for (const [what, opts, stops] of [['pending', {}, true], ['answered', { ago: 5, answer: 'approve' }, false], ['expired', { ago: 60 }, false]]) {
    const { rd, run } = pausedRun();
    assert.equal(recordExcerptSwitchOn(rd, { source: 'flag' }).ok, true);
    gateIn(rd, opts);
    const r = run(['--resume', rd]);
    assert.equal(r.status === 26, stops, `${what}: ${r.status} ${r.stderr.slice(-300)}`);
    // CHANGED ACCEPTED (C&C 09 Nov 2026, the run_status finding): OLD the status read awaiting_excerpt_approval exactly when the gate stops a resume (`stops`); NEW also for an ANSWERED gate and an EXPIRED one (resumable: the next resume applies the answers or asks again). WHY: see test/excerpt-answers-status.test.js
    assert.equal(deriveRunStatus(rd, null) === 'awaiting_excerpt_approval', stops || what === 'answered' || what === 'expired', what);
  }
  const { rd, run } = pausedRun();
  assert.equal(recordExcerptSwitchOn(rd, { source: 'flag' }).ok, true);
  const g = gateIn(rd);
  writeFileSync(join(rd, 'gates', `${g.id}.json`), '{ not json');
  const r = run(['--resume', rd]);
  assert.equal(r.status, 26, `unreadable: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /cannot be read/);
});
