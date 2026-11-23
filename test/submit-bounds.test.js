// 0.8.4 D10 (C&C 09 Nov 2026, ruling (ii)): while a person's approval of excerpts is on for the run, submit_stage refuses the WHOLE answer when a range the session named cannot be held by an approval gate (more than
// SHOWN_LINES_MAX lines, or a line past EXCERPT_LINE_NUMBER_MAX), from the named range alone; with the switch off the same answer is written; an unreadable approval record fails closed. Nothing is written by a refusal.
// A text with no lines is the whole file: it is counted here through the extraction's own jail (the WHOLE FILE rows at the end). The resume's BACKSTOP still catches what changed since (test/excerpt-resume.test.js "BACKSTOP"). Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import { excerptSwitchForSubmit } from '../src/run-status.js';
import { recordExcerptSwitchOn, SHOWN_LINES_MAX, EXCERPT_LINE_NUMBER_MAX } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { REFUSAL_WORDS } from '../src/excerpt-extract.js';
import { MAX_CLIENT_FILE_BYTES } from '../src/tools.js';
import * as H from './held-prompts/held-084-a.js';

const dirs = [];
afterEach(() => { setHeldForTest(null); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
function run({ on = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'thc-bounds-')); dirs.push(d);
  if (on) assert.equal(recordExcerptSwitchOn(d, { source: 'flag' }).ok, true);
  writeFileSync(join(d, 'revise-1.prompt.json'), JSON.stringify({ provider: 'external', text_requests: [{ n: 1, requested_by: 'rq', origin: 'panel-1-rq', objection_id: null, path: 'src/b.js', lines: `1-${SHOWN_LINES_MAX + 1}`, why: 'Big.' }, { n: 2, requested_by: 'rq', origin: 'panel-1-rq', objection_id: null, path: 'src/b.js', lines: '1-2', why: 'Small.' }] }));
  return d;
}
const send = (d, extra) => { setHeldForTest({ excerptsBlock: H.excerptsBlock, sessionReadsField: H.sessionReadsField, excerptAnswersField: H.excerptAnswersField }); return submitStageAnswer(d, 'revise-1', '# Plan\n\nBody.\n', { excerptSwitch: excerptSwitchForSubmit, ...extra }); };
// a line that fails the chain's verification (the forged use line of test/excerpt-resume-refusal.test.js): the ledger no longer verifies, so the switch cannot be read
const breakLedger = d => {
  const raw = readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean);
  const forged = JSON.stringify({ schema: 'gate-ledger/1', seq: raw.length + 1, prev: createHash('sha256').update(raw[raw.length - 1]).digest('hex'), ts: new Date().toISOString(), event: 'excerpts_recorded', gate: 'g1', sha256: 'a'.repeat(64), run_id: 'r1', count: 1 });
  writeFileSync(join(d, LEDGER_FILE), `${raw.join('\n')}\n${forged}\n`);
};
const files = d => Object.fromEntries(readdirSync(d).map(f => [f, readFileSync(join(d, f), 'utf8')]));

test('SWITCH ON, session_reads: the largest range a gate holds is written, one more line or a line past the last number is refused (whole answer, nothing written)', () => {
  assert.equal(send(run(), { sessionReads: [{ path: 'a.js', lines: `1-${SHOWN_LINES_MAX}`, why: 'w' }] }).writtenFile !== undefined, true);
  assert.equal(send(run(), { sessionReads: [{ path: 'a.js', lines: String(EXCERPT_LINE_NUMBER_MAX), why: 'w' }] }).writtenFile !== undefined, true);
  for (const lines of [`1-${SHOWN_LINES_MAX + 1}`, String(EXCERPT_LINE_NUMBER_MAX + 1), `${EXCERPT_LINE_NUMBER_MAX}-${EXCERPT_LINE_NUMBER_MAX + 1}`]) {
    const d = run(); const before = files(d);
    assert.throws(() => send(d, { sessionReads: [{ path: 'a.js', lines: '1-2', why: 'ok' }, { path: 'b.js', lines, why: 'w' }] }), err => err.message.startsWith('The answer for "revise-1" was not written: session_reads entry 2 names lines ') && err.message.includes(`(at most ${SHOWN_LINES_MAX} lines, none past line ${EXCERPT_LINE_NUMBER_MAX})`) && err.message.includes("a person's approval of excerpts. Narrow the lines or leave the read out, then submit the answer again."), lines);
    assert.deepEqual(files(d), before, `${lines}: nothing written, claimed or recorded`);
  }
});

test('SWITCH ON, excerpt_answers: the answer\'s own lines count, and so do the request\'s lines when the answer gives none; a decline names no range and is written', () => {
  const own = run();
  assert.throws(() => send(own, { excerptAnswers: [{ request: 2, lines: `1-${SHOWN_LINES_MAX + 1}` }] }), /excerpt_answers entry 1 \(request 2\) names lines 1-100001, which an approval screen cannot hold .* Narrow the lines, or decline the request with a reason, then submit the answer again\./);
  const listed = run();
  assert.throws(() => send(listed, { excerptAnswers: [{ request: 2 }, { request: 1 }] }), /excerpt_answers entry 2 \(request 1\) names lines 1-100001/);
  assert.equal(existsSync(join(listed, 'revise-1.md')), false);
  assert.equal(send(run(), { excerptAnswers: [{ request: 1, decline: 'Too big.' }, { request: 2 }] }).writtenFile !== undefined, true, 'a decline is the way out');
  assert.equal(send(run(), { excerptAnswers: [{ request: 1, lines: '5-9' }, { request: 2 }] }).writtenFile !== undefined, true, 'narrowing is the other');
});

test('SWITCH OFF (the control): the same oversize answers are written', () => {
  assert.equal(send(run({ on: false }), { sessionReads: [{ path: 'a.js', lines: `1-${SHOWN_LINES_MAX + 1}`, why: 'w' }] }).writtenFile !== undefined, true);
  assert.equal(send(run({ on: false }), { excerptAnswers: [{ request: 1 }, { request: 2 }] }).writtenFile !== undefined, true);
});

test('AN UNREADABLE APPROVAL RECORD fails closed: the whole answer is refused with the reader\'s message and nothing changes', () => {
  const d = run();
  breakLedger(d);
  const before = files(d);
  assert.throws(() => send(d, { sessionReads: [{ path: 'a.js', lines: '1-2', why: 'w' }] }), err => err.message === 'The answer for "revise-1" was not written: the approval record of this run cannot be read. Nothing was recorded.');
  assert.deepEqual(files(d), before);
});

test('a submit with excerpt fields and the switch ON leaves the gate ledger byte-identical, whether the answer is written or refused (it reads the approval record, it never writes it)', () => {
  for (const [what, extra, written] of [['session_reads written', { sessionReads: [{ path: 'a.js', lines: '1-2', why: 'w' }] }, true], ['session_reads refused', { sessionReads: [{ path: 'a.js', lines: `1-${SHOWN_LINES_MAX + 1}`, why: 'w' }] }, false], ['excerpt_answers written', { excerptAnswers: [{ request: 1, decline: 'No.' }, { request: 2, decline: 'No.' }] }, true], ['excerpt_answers refused', { excerptAnswers: [{ request: 1 }, { request: 2 }] }, false]]) {
    const d = run();
    const before = readFileSync(join(d, LEDGER_FILE)); const gatesBefore = existsSync(join(d, 'gates'));
    if (written) assert.equal(send(d, extra).writtenFile !== undefined, true, what); else assert.throws(() => send(d, extra), what);
    assert.ok(readFileSync(join(d, LEDGER_FILE)).equals(before), `${what}: the ledger is byte-identical`);
    assert.equal(existsSync(join(d, 'gates')), gatesBefore, `${what}: no gate was created`);
  }
});

test('an answer that carries neither field never reads the ledger (a broken record does not stop a plain answer)', () => {
  const d = run();
  breakLedger(d);
  assert.equal(send(d, {}).writtenFile !== undefined, true);
});

// ---- whole files (no lines): counted at submit through the extraction's own jail, from the folder run.json records (C&C 09 Nov 2026) -------------------------------------------------------------------------------
function withProject({ on = true, cwd = true } = {}) {
  const d = run({ on });
  const proj = mkdtempSync(join(tmpdir(), 'thc-bounds-proj-')); dirs.push(proj);
  mkdirSync(join(proj, 'src'));
  if (cwd) writeFileSync(join(d, 'run.json'), JSON.stringify({ cwd: proj }));
  const lines = n => 'l\n'.repeat(n);
  writeFileSync(join(proj, 'exact.txt'), lines(SHOWN_LINES_MAX));
  writeFileSync(join(proj, 'exact-nonl.txt'), `${lines(SHOWN_LINES_MAX - 1)}l`);
  writeFileSync(join(proj, 'over.txt'), lines(SHOWN_LINES_MAX + 1));
  writeFileSync(join(proj, 'over-nonl.txt'), `${lines(SHOWN_LINES_MAX)}l`);
  writeFileSync(join(proj, 'small.txt'), 'a\nb\n');
  writeFileSync(join(proj, '.env'), 'KEY=value\n');
  return { d, proj };
}
const WHOLE = path => ({ sessionReads: [{ path, why: 'w' }] });

test('WHOLE FILE, switch on: a file of exactly the bound is written (with and without a final newline), one line more is refused naming the file; the refusal writes nothing', () => {
  const ok = withProject();
  assert.equal(send(ok.d, WHOLE('exact.txt')).writtenFile !== undefined, true);
  assert.equal(send(withProject().d, WHOLE('exact-nonl.txt')).writtenFile !== undefined, true);
  for (const name of ['over.txt', 'over-nonl.txt']) {
    const { d } = withProject(); const before = files(d);
    assert.throws(() => send(d, WHOLE(name)), err => err.message === `The answer for "revise-1" was not written: session_reads entry 1 names the whole of ${name}, which is longer than ${SHOWN_LINES_MAX} lines; an approval screen cannot hold more, and this run asks for a person's approval of excerpts. Name a range of lines, or leave the read out, then submit the answer again.`, name);
    assert.deepEqual(files(d), before);
  }
  assert.equal(send(withProject().d, { sessionReads: [{ path: 'over.txt', lines: '1-5', why: 'a range of the big file is fine' }] }).writtenFile !== undefined, true);
});

test('WHOLE FILE, switch on: a file the extraction would refuse (a secret file, a path outside, a missing one) is refused at submit with the refusal\'s words; a request\'s own path and lines count when the answer gives none', () => {
  for (const [path, code] of [['.env', 'denied'], ['../outside.txt', 'outside_root'], ['nope.txt', 'not_found']]) {
    const { d } = withProject();
    assert.throws(() => send(d, WHOLE(path)), err => err.message === `The answer for "revise-1" was not written: session_reads entry 1 names ${path}, which could not be cut: ${REFUSAL_WORDS[code]}. Fix the path, or leave the read out, then submit the answer again.`, path);
  }
  const { d } = withProject();
  writeFileSync(join(d, 'revise-1.prompt.json'), JSON.stringify({ provider: 'external', text_requests: [{ n: 1, requested_by: 'rq', origin: 'panel-1-rq', objection_id: null, path: 'over.txt', lines: null, why: 'Whole.' }, { n: 2, requested_by: 'rq', origin: 'panel-1-rq', objection_id: null, path: 'small.txt', lines: null, why: 'Small.' }] }));
  assert.throws(() => send(d, { excerptAnswers: [{ request: 2 }, { request: 1 }] }), err => err.message === `The answer for "revise-1" was not written: excerpt_answers entry 2 (request 1) names the whole of over.txt, which is longer than ${SHOWN_LINES_MAX} lines; an approval screen cannot hold more, and this run asks for a person's approval of excerpts. Name a range of lines, or decline the request with a reason, then submit the answer again.`);
  assert.equal(send(d, { excerptAnswers: [{ request: 1, path: 'small.txt' }, { request: 2 }] }).writtenFile !== undefined, true, 'the answer\'s own path overrides the request\'s');
});

test('WHOLE FILE, switch off (the control): the oversize and the missing whole file are both written (the resume records them as it can)', () => {
  assert.equal(send(withProject({ on: false }).d, WHOLE('over.txt')).writtenFile !== undefined, true);
  assert.equal(send(withProject({ on: false }).d, WHOLE('nope.txt')).writtenFile !== undefined, true);
});

test('WHOLE FILE, switch on, run.json without a recorded folder: refused with its own sentence (fails closed); a range-only answer needs no run.json at all', () => {
  const { d } = withProject({ cwd: false });
  assert.throws(() => send(d, WHOLE('small.txt')), err => err.message === 'The answer for "revise-1" was not written: the folder this run started in is not recorded, so the size of small.txt could not be checked. Nothing was recorded.');
  assert.equal(send(withProject({ on: false, cwd: false }).d, WHOLE('small.txt')).writtenFile !== undefined, true, 'switch off and no recorded folder: nothing can be checked here, the resume records what it can');
  assert.equal(send(withProject({ cwd: false }).d, { sessionReads: [{ path: 'small.txt', lines: '1-2', why: 'w' }] }).writtenFile !== undefined, true);
});

// ---- the BYTE cap at submit, in EVERY run, apart from the gate's line bounds (C&C 09 Nov 2026 (2)(ii)) -----------------------------------------------------------------------------------------------------------
test('BYTE CAP at submit, switch on AND off x whole file / range x over / under the cap: a whole file over the cap is refused in both runs (the harness\'s own cap), under it is written; a RANGE of the same big file is written in both runs; the gate\'s line bounds bite only with the switch on', () => {
  for (const on of [true, false]) {
    const fresh = () => { const p = withProject({ on }); writeFileSync(join(p.proj, 'huge.txt'), `a\n${'z'.repeat(MAX_CLIENT_FILE_BYTES)}\nc\n`); writeFileSync(join(p.proj, 'under.txt'), `a\n${'z'.repeat(1000)}\nc\n`); return p.d; };
    const mode = `switch ${on ? 'on' : 'off'}`;
    const sentence = `The answer for "revise-1" was not written: session_reads entry 1 names the whole of huge.txt, which holds more than ${MAX_CLIENT_FILE_BYTES} bytes; the harness keeps at most that much. Name a range of lines, or leave the read out, then submit the answer again.`;
    const over = fresh();
    assert.throws(() => send(over, WHOLE('huge.txt')), err => err.message === sentence, `${mode}: whole, over`);
    assert.equal(existsSync(join(over, 'revise-1.md')), false);
    assert.equal(send(fresh(), WHOLE('under.txt')).writtenFile !== undefined, true, `${mode}: whole, under`);
    assert.equal(send(fresh(), { sessionReads: [{ path: 'huge.txt', lines: '1-1', why: 'a range of the big file' }] }).writtenFile !== undefined, true, `${mode}: a range of the big file is written`);
    // the 'range, over' cell (C&C 09 Nov 2026, (b)): a range whose KEPT bytes pass the cap is refused at submit in every run, so the session can narrow it; the 'range, under' cell is the 1-1 above
    const rangeOver = fresh();
    assert.throws(() => send(rangeOver, { sessionReads: [{ path: 'huge.txt', lines: '2-2', why: 'a range that holds the giant line' }] }), err => err.message === `The answer for "revise-1" was not written: session_reads entry 1 names lines 2-2 of huge.txt, which hold more than ${MAX_CLIENT_FILE_BYTES} bytes; the harness keeps at most that much. Narrow the lines, or leave the read out, then submit the answer again.`, `${mode}: a range over the cap`);
    assert.equal(existsSync(join(rangeOver, 'revise-1.md')), false);
    assert.equal(send(fresh(), { sessionReads: [{ path: 'huge.txt', lines: '3-3', why: 'the line after the giant one' }] }).writtenFile !== undefined, true, `${mode}: a range after the giant line is written`);
    const oversizeRange = { sessionReads: [{ path: 'under.txt', lines: `1-${SHOWN_LINES_MAX + 1}`, why: 'w' }] };
    if (on) assert.throws(() => send(fresh(), oversizeRange), /session_reads entry 1 names lines 1-100001/);
    else assert.equal(send(fresh(), oversizeRange).writtenFile !== undefined, true, 'switch off: the gate\'s bound is not the harness\'s');
  }
});

test('SERVER FOLDER (D2, C&C 09 Nov 2026): the size check at submit reads the run.json folder only when it is the server\'s own (workDir); another folder is not read, whatever the switch; src/mcp/server.js passes its working folder', () => {
  for (const on of [true, false]) {
    const fresh = () => { const p = withProject({ on }); writeFileSync(join(p.proj, 'huge.txt'), `a\n${'z'.repeat(MAX_CLIENT_FILE_BYTES)}\nc\n`); return p; };
    const sentence = `The answer for "revise-1" was not written: session_reads entry 1 names the whole of huge.txt, which holds more than ${MAX_CLIENT_FILE_BYTES} bytes; the harness keeps at most that much. Name a range of lines, or leave the read out, then submit the answer again.`;
    const own = fresh();
    assert.throws(() => send(own.d, { ...WHOLE('huge.txt'), workDir: own.proj }), err => err.message === sentence, `switch ${on}: the server's own folder is read`);
    const other = fresh(); const elsewhere = mkdtempSync(join(tmpdir(), 'thc-bounds-other-')); dirs.push(elsewhere);
    assert.doesNotThrow(() => send(other.d, { ...WHOLE('huge.txt'), workDir: elsewhere }), `switch ${on}: a folder that is not the server's is not read (the resume refuses it)`);
  }
  const p = withProject({ on: true });
  assert.doesNotThrow(() => send(p.d, { ...WHOLE('over.txt'), workDir: mkdtempSync(join(tmpdir(), 'thc-bounds-other-')) }), 'a whole file over the line bound is not counted in a folder that is not the server\'s');
  const server = readFileSync(new URL('../src/mcp/server.js', import.meta.url), 'utf8');
  assert.match(server, /excerptSwitch: excerptSwitchForSubmit, workDir: work \}\)/);
});

