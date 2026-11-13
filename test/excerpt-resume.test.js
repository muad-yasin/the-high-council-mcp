// 0.8.4 D38 (plan A T1.4, T5; C&C 09 Nov 2026): what the command does at a resume with the reads a handling session named in its stage answers (src/excerpt-resume.js): cut (D8), key-shape scan (D20), one batch append.
// Proved here: the record a clean read leaves; that a read the path check refuses leaves no line and a note; the ID PIN (the stop label of a hit carries the id the line gets after --continue or a drop, two pending reads,
// the first or the second hitting, order holding); that a drop is honoured only for the same label AND the same scanned text; and the DROP red through a whole run (the dropped text is in no later seat's prompt; the
// swapped input is the continue path, where it is). Offline, $0. The block's words are test data (test/held-prompts/held-084-a.js), hidden by an override that survives the release apply.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { SecretShapedPrompt, newAllowKey } from '../src/outbound-scan.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import * as RS from '../src/run-status.js';   // a namespace import: excerptSwitchForSubmit is absent at the older commits this file is run against, and the option is then undefined there
import { recordSessionReads, excerptBatch, recordUnaskedRequests, pendingSessionReads, excerptLabelOf, isExcerptLabel, DROP_REASON, REFUSAL_WORDS } from '../src/excerpt-resume.js';
import { readExcerpts, appendExcerpt, EXCERPTS_FILE } from '../src/excerpt-record.js';
import { runChain, setPromptSpy, setCache, setBudget, setOutboundScan } from '../src/chain.js';
import { excerptsBlock, sessionReadsField } from './held-prompts/held-084-a.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan(null); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const WORDS = { excerptsBlock, sessionReadsField };
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-resume-')); dirs.push(d); return d; };
const fill = (n, set = 'aZ3kQ9xB') => Array.from({ length: n }, (_, i) => set[i % set.length]).join('');
const KEY_LINE = ['OPENROUTER_API_KEY=', 'sk', '-or-v1-', fill(64, '0a1b2c3d4e5f6789')].join('');
const KEY_LINE_2 = ['OPENROUTER_API_KEY=', 'sk', '-or-v1-', fill(64, '9f8e7d6c5b4a3210')].join('');
const A = 'alpha one\nalpha two\nalpha three';

function project() {
  const dir = tmp(); mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.js'), `${A}\n`);
  writeFileSync(join(dir, 'src', 'b.js'), 'bravo one\nbravo two\n');
  writeFileSync(join(dir, 'src', 'k1.js'), `const x = 1;\n${KEY_LINE}\n`);
  writeFileSync(join(dir, 'src', 'k2.js'), `const y = 2;\n${KEY_LINE_2}\n`);
  return dir;
}
const answer = (runDir, stage, reads) => submitStageAnswer(runDir, stage, 'The answer.', { excerptSwitch: RS.excerptSwitchForSubmit, sessionReads: reads });
const rd = (path, lines) => ({ path, ...(lines ? { lines } : {}), why: `To check ${path}.` });
const hit = fn => { try { fn(); return null; } catch (e) { if (e instanceof SecretShapedPrompt) return e; throw e; } };

test('a clean read is recorded once: the exact text, the hash of the file bytes, answered_stage, key shape clear and personal data not scanned; a second resume adds nothing; a late duplicate is never read', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('src/a.js', '1-2')]);
  writeFileSync(join(run, 'build.late.usage.json'), JSON.stringify({ session_reads: [rd('src/b.js')] }));   // a late duplicate answer: not the stage's answer
  const first = recordSessionReads({ runDir: run, root: proj });
  assert.equal(first.written.length, 1);
  const [e] = first.written;
  assert.deepEqual([e.id, e.request_kind, e.requested_by, e.path, e.lines, e.text, e.answered_stage], ['E-1', 'session_read', null, 'src/a.js', '1-2', 'alpha one\nalpha two', 'build']);
  assert.deepEqual([e.scans, e.approval.status, e.edited], [{ key_shape: 'clear', personal_data: 'not_scanned' }, 'not_required', false]);
  assert.match(first.notes.join('\n'), /session reads: 1 recorded as excerpts \(E-1 to E-1\)\./);
  const again = recordSessionReads({ runDir: run, root: proj });
  assert.deepEqual([again.written.length, again.notes], [0, []]);
  assert.equal(readExcerpts(run).lines, 1);
});

// CHANGED ACCEPTED TEST (C&C 09 Nov 2026, the not_cut status). OLD: a read the path check refuses left no line and a note "not recorded". NEW: it is one session_read line with status not_cut (no text, reason in the refusal code's words,
// answered_stage = the answering stage), because the record should show the read was tried (D38); the note says so. WHY: the harness's own refusal is not "unanswered" and not a silent gap.
test('a read the path check refuses is recorded as ONE not_cut line (no text) and a note with the reason; the claim stays unverified', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('../outside.txt'), rd('src/missing.js'), rd('src/a.js', '1-1')]);
  const r = recordSessionReads({ runDir: run, root: proj });
  assert.deepEqual(r.written.map(x => [x.id, x.path, x.lines, x.approval.status, x.answered_stage, x.text]), [['E-1', '../outside.txt', null, 'not_cut', 'build', null], ['E-2', 'src/missing.js', null, 'not_cut', 'build', null], ['E-3', 'src/a.js', '1-1', 'not_required', 'build', 'alpha one']]);
  assert.equal(r.written[0].approval.reason, `The text could not be cut: ${REFUSAL_WORDS.outside_root}.`);
  assert.deepEqual([r.written[0].approval.actor, r.written[0].approval.channel, r.written[0].edited, r.written[0].file_sha256, r.written[0].scans], [null, null, false, null, null]);
  assert.ok(r.notes.includes(`  session read ../outside.txt (answer to build) could not be cut: ${REFUSAL_WORDS.outside_root}; it is recorded as not cut.`));
  assert.ok(r.notes.includes(`  session read src/missing.js (answer to build) could not be cut: ${REFUSAL_WORDS.not_found}; it is recorded as not cut.`));
  const none = tmp(); answer(none, 'build', [rd('../outside.txt')]);
  assert.deepEqual(recordSessionReads({ runDir: none, root: proj }).written.map(x => x.approval.status), ['not_cut']);
  assert.deepEqual(recordSessionReads({ runDir: none, root: proj }).written, [], 'a stage whose reads were all refused is done: the next resume adds nothing');
  assert.equal(readExcerpts(none).problems.length, 0);
});

test('ID PIN, first read hits: the stop label is excerpt-E-1 with nothing appended; after --continue both lines exist and the label equals the first id; after a drop the first line is withheld and the second is recorded; the order holds', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('src/k1.js'), rd('src/b.js')]);
  const key = newAllowKey(); const allowed = { key, hashes: new Set() };
  const stop = hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } }));
  assert.ok(stop, 'the first read stops the run');
  assert.equal(stop.label, excerptLabelOf(1)); assert.equal(isExcerptLabel(stop.label), true);
  assert.equal(existsSync(join(run, EXCERPTS_FILE)), false, 'a hit appends nothing, not even the clean second read');
  // continue
  for (const h of stop.valueHashes) allowed.hashes.add(h);
  const cont = recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } });
  assert.deepEqual(cont.written.map(e => [e.id, e.path, e.scans.key_shape]), [['E-1', 'src/k1.js', 'continued_by_person'], ['E-2', 'src/b.js', 'clear']]);
  assert.equal(`excerpt-${cont.written[0].id}`, stop.label, 'the stop label carries the id the line got');
  // drop (a second run folder, same reads)
  const run2 = tmp(); answer(run2, 'build', [rd('src/k1.js'), rd('src/b.js')]);
  const drop = recordSessionReads({ runDir: run2, root: proj, scanOptions: { allowed: { key, hashes: new Set() } }, drops: [{ label: stop.label, stop: stop.stopId }], actor: 'alice' });
  const [w, ok] = drop.written;
  assert.deepEqual([w.id, w.text, w.text_sha256, w.file_sha256, w.scans, w.approval.status, w.approval.channel, w.approval.actor, w.approval.reason], ['E-1', null, null, null, null, 'withheld', 'cli', 'alice', DROP_REASON]);
  assert.deepEqual([ok.id, ok.path, ok.text], ['E-2', 'src/b.js', 'bravo one\nbravo two']);
  assert.equal(`excerpt-${w.id}`, stop.label);
});

test('ID PIN, second read hits: the label is excerpt-E-2; with a line already in the file it is excerpt-E-3', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('src/b.js'), rd('src/k1.js')]);
  const key = newAllowKey(); const allowed = { key, hashes: new Set() };
  assert.equal(hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } })).label, 'excerpt-E-2');
  const run2 = tmp();
  appendExcerpt(run2, { request_kind: 'session_read', requested_by: null, objection_id: null, why: 'Earlier.', source_kind: 'repository_file', path: 'src/a.js', lines: '1-1', text: 'alpha one', file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage: 'criteria', scans: { key_shape: 'clear', personal_data: 'not_scanned' }, approval: { status: 'not_required', actor: null, channel: null, at: '2026-11-09T05:00:00.000Z', reason: null } });
  answer(run2, 'build', [rd('src/b.js'), rd('src/k1.js')]);
  assert.equal(hit(() => recordSessionReads({ runDir: run2, root: proj, scanOptions: { allowed: { key, hashes: new Set() } } })).label, 'excerpt-E-3');
});

test('ID PIN, both reads hit: --continue is asked twice, the labels are E-1 then E-2, and the two lines come out in that order', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('src/k1.js'), rd('src/k2.js')]);
  const key = newAllowKey(); const allowed = { key, hashes: new Set() };
  const one = hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } }));
  assert.equal(one.label, 'excerpt-E-1'); for (const h of one.valueHashes) allowed.hashes.add(h);
  const two = hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } }));
  assert.equal(two.label, 'excerpt-E-2'); for (const h of two.valueHashes) allowed.hashes.add(h);
  const done = recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } });
  assert.deepEqual(done.written.map(e => [e.id, e.path]), [['E-1', 'src/k1.js'], ['E-2', 'src/k2.js']]);
});

test('a drop is honoured only for the same label AND the same scanned text: another stop id, or a read that moved to another place, pauses again', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('src/k1.js')]);
  const allowed = { key: newAllowKey(), hashes: new Set() };
  const stop = hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed } }));
  const wrongStop = hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed }, drops: [{ label: stop.label, stop: '0000000000000000' }] }));
  assert.equal(wrongStop?.label, stop.label, 'a drop recorded for other text is not honoured');
  const wrongLabel = hit(() => recordSessionReads({ runDir: run, root: proj, scanOptions: { allowed }, drops: [{ label: 'excerpt-E-2', stop: stop.stopId }] }));
  assert.equal(wrongLabel?.label, stop.label, 'a drop recorded for another label is not honoured');
  assert.equal(existsSync(join(run, EXCERPTS_FILE)), false);
});

test('an unreadable excerpts.jsonl is a refusal, not a guess at the numbering; the pending stages are those with no line of their own', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  answer(run, 'build', [rd('src/a.js')]);
  writeFileSync(join(run, EXCERPTS_FILE), '{not json\n');
  assert.throws(() => recordSessionReads({ runDir: run, root: proj }), /excerpts\.jsonl cannot be read \(line 1 is not JSON\), so the session reads cannot be recorded\. Nothing was run and nothing was spent\./);
  const run2 = tmp(); answer(run2, 'build', [rd('src/a.js')]); answer(run2, 'revise-1', [rd('src/b.js')]);
  assert.deepEqual(pendingSessionReads(run2, []).pending.map(p => p.stage), ['build', 'revise-1']);
  assert.deepEqual(pendingSessionReads(run2, [{ request_kind: 'session_read', answered_stage: 'build' }]).pending.map(p => p.stage), ['revise-1']);
});

// ---- the DROP red through a whole run -----------------------------------------------------------------------------------------------------------------------------------------------------------------
async function promptsWith(entries) {
  const seen = [];
  setPromptSpy(({ label, user }) => { seen.push({ label, user }); });
  await runChain({ request: 'Plan a tea service.', config: { ...readChainFile(root, 'mock-unanimous') }, log: () => {}, runId: 'r-resume-drop', excerpts: entries });
  setPromptSpy(null);
  return seen;
}

test('DROP (the required red): the dropped text is in no later seat\'s prompt; the swapped input is the continue path, where the same text IS in a later prompt', async () => {
  setHeldForTest(WORDS);
  const proj = project();
  const base = await promptsWith([]);
  const stage = base[1].label;
  const secretText = KEY_LINE;   // what the person dropped
  const allowedFor = () => ({ key: newAllowKey(), hashes: new Set() });
  const runFor = () => { const r = tmp(); answer(r, stage, [rd('src/k1.js')]); return r; };
  // drop
  const dropRun = runFor();
  const stop = hit(() => recordSessionReads({ runDir: dropRun, root: proj, scanOptions: { allowed: allowedFor() } }));
  const dropped = recordSessionReads({ runDir: dropRun, root: proj, scanOptions: { allowed: allowedFor() }, drops: [{ label: stop.label, stop: stop.stopId }] });
  assert.equal(dropped.written[0].approval.status, 'withheld');
  const withDrop = await promptsWith(readExcerpts(dropRun).entries);
  assert.deepEqual(withDrop, base, 'a dropped excerpt changes no prompt');
  assert.equal(withDrop.some(s => s.user.includes(secretText) || s.user.includes('OPENROUTER_API_KEY')), false, 'the dropped text is in no seat\'s prompt');
  // continue (the swapped input): the text is recorded and shown to the later seats
  const contRun = runFor(); const allowed = allowedFor();
  const stop2 = hit(() => recordSessionReads({ runDir: contRun, root: proj, scanOptions: { allowed } }));
  for (const h of stop2.valueHashes) allowed.hashes.add(h);
  assert.equal(recordSessionReads({ runDir: contRun, root: proj, scanOptions: { allowed } }).written[0].scans.key_shape, 'continued_by_person');
  setOutboundScan({ allow: false, allowed });   // the person's --continue: the value is allowed, so a later prompt may carry it
  const withText = await promptsWith(readExcerpts(contRun).entries);
  assert.ok(withText.some(s => s.user.includes('OPENROUTER_API_KEY')), 'the continued text IS in a later seat\'s prompt (the control: without it the drop assertion above proves nothing)');
  assert.equal(withText.findIndex(s => s.user.includes('OPENROUTER_API_KEY')) > base.findIndex(s => s.label === stage), true, 'and only after the stage that carried the answer');
});

// ---- D18: the lines written for the seats' requests ---------------------------------------------------------------------------------------------------------------------------------------------------------
test('requests: a reply written as a FILE (no usage record) records every listed request unanswered, naming the stage at whose pause it was left out; lines are written as the record requires; a second resume adds nothing', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  const q = (n, lines, extra = {}) => ({ n, requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: null, path: 'src/a.js', lines, why: `Request ${n}.`, ...extra });
  writeFileSync(join(run, 'revise-1.prompt.json'), JSON.stringify({ provider: 'external', text_requests: [q(1, '7'), q(2, ' 3 - 5 '), q(3, null), q(4, '1-2', { path: '../outside.txt' })] }));
  writeFileSync(join(run, 'revise-1.md'), '# Plan\n');
  const r = recordSessionReads({ runDir: run, root: proj });
  assert.deepEqual(r.written.map(e => [e.id, e.request_kind, e.lines, e.approval.status, e.answered_stage]), [['E-1', 'seat_request', '7-7', 'unanswered', 'revise-1'], ['E-2', 'seat_request', '3-5', 'unanswered', 'revise-1'], ['E-3', 'seat_request', null, 'unanswered', 'revise-1'], ['E-4', 'seat_request', '1-2', 'unanswered', 'revise-1']]);
  assert.equal(r.written[0].approval.reason, 'The handling session did not answer this request.');
  assert.deepEqual(readExcerpts(run).problems, [], 'the file reads back whole');
  assert.deepEqual(recordSessionReads({ runDir: run, root: proj }).written, [], 'a second resume adds nothing');
});

test('requests: before the stage is answered (no <stage>.md) nothing is written; a decline and a paste are written beside session reads in one ordered batch, reads first', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  writeFileSync(join(run, 'revise-1.prompt.json'), JSON.stringify({ provider: 'external', text_requests: [{ n: 1, requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: 'O-1a2b3c4d', path: 'src/a.js', lines: '1-2', why: 'First.' }, { n: 2, requested_by: 'lab-b', origin: 'panel-1-lab-b', objection_id: null, path: 'src/b.js', lines: null, why: 'Second.' }] }));
  assert.deepEqual(recordSessionReads({ runDir: run, root: proj }).written, [], 'no answer yet: nothing');
  answer(run, 'revise-1', [rd('src/b.js', '1-1')]);   // the stage's reads
  const usage = JSON.parse(readFileSync(join(run, 'revise-1.usage.json'), 'utf8'));
  writeFileSync(join(run, 'revise-1.usage.json'), JSON.stringify({ ...usage, excerpt_answers: [{ request: 2, decline: 'Not needed.' }, { request: 1 }] }));
  const r = recordSessionReads({ runDir: run, root: proj });
  assert.deepEqual(r.written.map(e => [e.id, e.request_kind, e.requested_by, e.approval.status]), [['E-1', 'session_read', null, 'not_required'], ['E-2', 'seat_request', 'lab-a', 'not_required'], ['E-3', 'seat_request', 'lab-b', 'refused']]);
  assert.equal(r.written[1].text, 'alpha one\nalpha two'); assert.equal(r.written[2].approval.reason, 'Not needed.'); assert.equal(r.written[2].approval.actor, 'main-session');
  assert.deepEqual(readExcerpts(run).problems, []);
});

test('recordUnaskedRequests: one unanswered line with answered_stage null per request, written once (the same request is not written again)', () => {
  setHeldForTest(WORDS);
  const run = tmp();
  const left = [{ requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: null, path: 'src/a.js', lines: '3', why: 'First.' }, { requested_by: 'lab-b', origin: 'panel-1-lab-b', objection_id: 'O-1a2b3c4d', path: 'src/b.js', lines: null, why: 'Second.' }];
  const first = recordUnaskedRequests({ runDir: run, left });
  assert.deepEqual(first.map(e => [e.id, e.requested_by, e.lines, e.approval.status, e.answered_stage, e.approval.reason]), [['E-1', 'lab-a', '3-3', 'unanswered', null, 'No handling session pause came after this request.'], ['E-2', 'lab-b', null, 'unanswered', null, 'No handling session pause came after this request.']]);
  assert.deepEqual(readExcerpts(run).problems, []);
  assert.deepEqual(recordUnaskedRequests({ runDir: run, left }), [], 'a second finish adds nothing');
  assert.deepEqual(recordUnaskedRequests({ runDir: run, left: [] }), []);
  // the same ask from ANOTHER reply is another request (C&C 09 Nov 2026: origin tells two of one seat key apart)
  const again = recordUnaskedRequests({ runDir: run, left: [{ ...left[0], origin: 'debate-lab-a' }] });
  assert.deepEqual(again.map(e => [e.id, e.origin]), [['E-3', 'debate-lab-a']]);
  assert.deepEqual(recordUnaskedRequests({ runDir: run, left: [{ ...left[0], origin: 'debate-lab-a' }] }), []);
});

test('BACKSTOP at the resume (the cases submit_stage cannot see: a file that changed between the answer and the resume (the whole-file request 4 stands for it here), and a switch turned on by a LATER resume after the answer was accepted): HOLD (the privacy switch is on): rows with text come back waiting (approval null) in the batch order, a refused/unanswered row is final; a text longer than an approval screen can hold is not asked about (a read is skipped with a note, a request is recorded unanswered)', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  writeFileSync(join(run, 'revise-1.prompt.json'), JSON.stringify({ provider: 'external', text_requests: [{ n: 1, requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: null, path: 'src/a.js', lines: '1-2', why: 'One.' }, { n: 2, requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: null, path: 'src/a.js', lines: '1-3', why: 'Two.' }, { n: 3, requested_by: 'lab-b', origin: 'panel-1-lab-b', objection_id: null, path: 'src/b.js', lines: '1-1', why: 'Three.' }, { n: 4, requested_by: 'lab-b', origin: 'panel-1-lab-b', objection_id: null, path: 'src/a.js', lines: null, why: 'The whole file.' }] }));
  writeFileSync(join(run, 'revise-1.md'), '# Plan\n');
  writeFileSync(join(run, 'revise-1.usage.json'), JSON.stringify({ excerpt_answers: [{ request: 1 }, { request: 2 }, { request: 3, decline: 'No.' }, { request: 4 }], session_reads: [{ path: 'src/a.js', lines: '1-3', why: 'Read.' }] }));
  const b = excerptBatch({ runDir: run, root: proj, hold: true, maxShownLines: 2 });
  assert.deepEqual(b.inputs.map(i => [i.request_kind, i.lines, i.approval === null ? 'waiting' : i.approval.status]), [['session_read', '1-3', 'not_cut'], ['seat_request', '1-2', 'waiting'], ['seat_request', '1-3', 'not_cut'], ['seat_request', '1-1', 'refused'], ['seat_request', null, 'not_cut']]);
  assert.match(b.notes.join('\n'), /session read src\/a\.js \(answer to revise-1\) could not be cut: it is longer than an approval screen can hold; it is recorded as not cut\./);
  assert.match(b.inputs[2].approval.reason, /^The text could not be cut: it is longer than an approval screen can hold\.$/);
  assert.equal(b.firstId, 1);
  assert.deepEqual(readExcerpts(run).entries, [], 'excerptBatch writes nothing');
  const far = excerptBatch({ runDir: run, root: proj, hold: true, maxShownLines: 100, maxLineNumber: 2 });
  assert.deepEqual(far.inputs.map(i => i.approval === null ? 'waiting' : i.approval.status), ['not_cut', 'waiting', 'not_cut', 'refused', 'not_cut'], 'a range past the gate\'s largest line number is not asked about either (lines 1-2 are fine, 1-3 are not)');
  const off = excerptBatch({ runDir: run, root: proj, hold: false });
  assert.ok(off.inputs.filter(i => i.approval === null).length === 0 && off.inputs.length === 5, 'with the switch off every row is final and nothing is skipped');
});

// CHANGED ACCEPTED TEST (C&C 09 Nov 2026, ruling (b); supersedes my default (a) of 33f33256): a read or a pasted request that holds only whitespace is a RECORDED excerpt with its text ('' or whitespace), not a not_cut line:
// the harness cut the text; there was just nothing in it. WHY: "could not be cut" would be a refusal the harness never made, and a plain error would stop every resume.
test('EMPTY: a read or a pasted request that holds only whitespace is recorded with its text (not_required, hash of the text, scans clear), never a plain error that stops every resume', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  writeFileSync(join(proj, 'src', 'empty.js'), ''); writeFileSync(join(proj, 'src', 'blank.js'), '\n\n');
  writeFileSync(join(run, 'revise-1.prompt.json'), JSON.stringify({ provider: 'external', text_requests: [{ n: 1, requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: null, path: 'src/blank.js', lines: null, why: 'Blank.' }] }));
  writeFileSync(join(run, 'revise-1.md'), '# Plan\n');
  writeFileSync(join(run, 'revise-1.usage.json'), JSON.stringify({ excerpt_answers: [{ request: 1 }], session_reads: [{ path: 'src/empty.js', why: 'Read.' }] }));
  const r = recordSessionReads({ runDir: run, root: proj });
  assert.deepEqual(r.written.map(e => [e.request_kind, e.path, e.approval.status, e.text, e.scans.key_shape]), [['session_read', 'src/empty.js', 'not_required', '', 'clear'], ['seat_request', 'src/blank.js', 'not_required', '\n', 'clear']]);
  assert.deepEqual(readExcerpts(run).problems, []);
});

test('REVISE-N-FULL (C&C 09 Nov 2026): a stage that lists a request again records no second line (a request is done when a line names the reply that carried it); a new reply\'s request in the same list is still recorded', () => {
  setHeldForTest(WORDS);
  const proj = project(); const run = tmp();
  const req = { n: 1, requested_by: 'lab-a', origin: 'panel-1-lab-a', objection_id: null, path: 'src/a.js', lines: '1-2', why: 'First.' };
  const stageFiles = (stage, list) => {
    writeFileSync(join(run, `${stage}.prompt.json`), JSON.stringify({ provider: 'external', text_requests: list }));
    writeFileSync(join(run, `${stage}.md`), '# Plan\n');
    writeFileSync(join(run, `${stage}.usage.json`), JSON.stringify({ excerpt_answers: list.map(r => ({ request: r.n })) }));
  };
  stageFiles('revise-1', [req]);
  assert.deepEqual(recordSessionReads({ runDir: run, root: proj }).written.map(e => [e.id, e.origin, e.answered_stage]), [['E-1', 'panel-1-lab-a', 'revise-1']]);
  stageFiles('revise-1-full', [req]);
  assert.deepEqual(recordSessionReads({ runDir: run, root: proj }).written, [], 'the request is on file: no second line');
  assert.equal(readExcerpts(run).entries.length, 1);
  stageFiles('revise-1-full', [req, { n: 2, requested_by: 'lab-b', origin: 'panel-1-lab-b', objection_id: null, path: 'src/b.js', lines: '1-1', why: 'Second.' }]);
  assert.deepEqual(recordSessionReads({ runDir: run, root: proj }).written.map(e => [e.id, e.origin, e.answered_stage]), [['E-2', 'panel-1-lab-b', 'revise-1-full']], 'only the reply with no line is recorded');
});

test('REVISE-N-FULL, the pause side: src/chain.js lists a judge\'s request on a revise pause only when no seat_request line names its reply (the NEEDS file of revise-N-full does not ask again what revise-N answered)', () => {
  const chain = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'chain.js'), 'utf8');
  assert.match(chain, /\(textRequestsByRound\.get\(Number\(m\[1\]\)\) \|\| \[\]\)\.filter\(r => !carried\.has\(r\.origin \?\? null\)\)/);
  assert.match(chain, /const carried = new Set\(excerpts\.filter\(e => e\.request_kind === 'seat_request'\)\.map\(e => e\.origin\)\);   \/\/ a reply whose requests are on file/);
});

