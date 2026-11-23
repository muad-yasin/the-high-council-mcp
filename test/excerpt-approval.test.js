// 0.8.4 D10 (plan A T5.5), slice 1: what asks for the privacy switch (src/excerpt-approval.js). Pure, offline, $0. The approval screen and the person's three answers are the next slice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'node:test';
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { excerptSwitchRequest, excerptSwitchFlagRefusal, SIDE_COMMAND_WORDS, SIDE_OPTIONS, AWAITING_EXCERPT_APPROVAL, boundExcerptsOf, approvalScreen, screenSha256, shownLinesOf, editedText, applyApproval, screenExcerptsOf } = await import('../src/excerpt-approval.js').catch(() => ({}));
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { buildExcerptEntry, sha256Of } = await import('../src/excerpt-record.js').catch(() => ({}));
import { setHeldForTest } from '../src/held-roles.js';
import { requestGate, answerGate, readGateAnswer, PERSON_CHANNELS as GATE_PERSON_CHANNELS } from '../src/gate.js';
import { excerptHiddenLinesMarker } from './held-prompts/held-084-a.js';

test('excerptSwitchRequest: the flag or the chain\'s boolean true asks for the switch (the flag is the source when both do); nothing else does, and it has no way to ask for "off"', () => {
  assert.deepEqual(excerptSwitchRequest({ flag: true, config: {} }), { on: true, source: 'flag' });
  assert.deepEqual(excerptSwitchRequest({ flag: false, config: { approve_excerpts: true } }), { on: true, source: 'chain' });
  assert.deepEqual(excerptSwitchRequest({ flag: true, config: { approve_excerpts: true } }), { on: true, source: 'flag' });
  for (const config of [{}, { approve_excerpts: false }, { approve_excerpts: 'true' }, { approve_excerpts: 1 }, null, undefined]) assert.deepEqual(excerptSwitchRequest({ flag: false, config }), { on: false, source: null }, JSON.stringify(config));
  assert.deepEqual(excerptSwitchRequest({ flag: 'yes', config: {} }), { on: false, source: null }, 'only the boolean true from the command line parse counts');
});

test('the stop\'s name is awaiting_excerpt_approval', () => {
  assert.equal(AWAITING_EXCERPT_APPROVAL, 'awaiting_excerpt_approval');
});

test('this module imports no gate module (the gate scanner lets only listed files import one): the record and the held-word reader only', () => {
  const text = readFileSync(fileURLToPath(new URL('../src/excerpt-approval.js', import.meta.url)), 'utf8');
  assert.deepEqual([...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(m => m[1]).sort(), ['./excerpt-record.js', './held-roles.js']);
});

test('excerptSwitchFlagRefusal: refused on every command word src/cli.js dispatches as argv[0] and on every top-level side option it exits on (both read from the source); null on a start, a resume, a dry run, and when the flag is not typed', () => {
  const cliText = readFileSync(fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'utf8');
  const words = [...new Set([...cliText.matchAll(/argv\[0\] === '([a-z-]+)'/g)].map(m => m[1]))];
  assert.ok(words.length >= 15, `the command words were read from src/cli.js (found ${words.length})`);
  for (const w of words) {
    const known = SIDE_COMMAND_WORDS.includes(w) || SIDE_OPTIONS.includes(w);
    assert.ok(known, `src/cli.js dispatches "${w}", which the refusal does not list (add it to SIDE_COMMAND_WORDS)`);
    if (SIDE_COMMAND_WORDS.includes(w)) assert.match(excerptSwitchFlagRefusal([w, '--approve-excerpts']), /is not one\. Nothing was run and nothing was spent\.$/, w);
  }
  const sideFlags = [...new Set([...cliText.matchAll(/^if \(argv\.includes\('(--[a-z-]+)'\)\)/gm)].map(m => m[1]))];
  assert.ok(sideFlags.length >= 6, `the side options were read from src/cli.js (found ${sideFlags.length})`);
  for (const f of sideFlags) assert.ok(SIDE_OPTIONS.includes(f) || f === '--send-up', `src/cli.js exits on ${f}, which the refusal does not list (--send-up is refused already, as a removed option)`);
  for (const o of SIDE_OPTIONS) assert.match(excerptSwitchFlagRefusal([o, '--approve-excerpts']), /is not one\./, o);
  assert.match(excerptSwitchFlagRefusal(['gate', 'verify', 'runs/x', '--approve-excerpts']), /`gate` is not one/);
  assert.match(excerptSwitchFlagRefusal(['--chain', 'x', '--rematch', 'runs/y', '--approve-excerpts']), /--rematch is not one/);
  for (const ok of [['--chain', 'x', '--task', 't.md', '--approve-excerpts'], ['--resume', 'runs/x', '--approve-excerpts'], ['--chain', 'x', '--task', 't.md', '--dry-run', '--approve-excerpts'], ['gate', 'verify', 'runs/x'], ['doctor']]) assert.equal(excerptSwitchFlagRefusal(ok), null, ok.join(' '));
  assert.equal(excerptSwitchFlagRefusal(undefined), null);
});

// ---- slice 2b: the screen, the bound list and the meaning of the three answers ---------------------------------------------------------------------------------------------------------------------------------------
afterEach(() => setHeldForTest(null));
const AT = '2026-11-04T09:00:00.000Z';
const FACTS = { channel: 'cli', actor: 'alice', at: AT };
const FILE = ['one', 'two', 'three', 'four', 'five', 'six'];
const pend = (over = {}) => ({
  request_kind: 'seat_request', requested_by: 'lab-a', objection_id: 'O-1a2b3c4d', origin: 'panel-1-lab-a', why: 'To judge the retry claim.', source_kind: 'repository_file', path: 'src/a.js', lines: '3-5',
  text: FILE.slice(2, 5).join('\n'), file_sha256: createHash('sha256').update(`${FILE.join('\n')}\n`).digest('hex'), edited: false, pasted_by: 'claude-code-session', advisor: 'consulted', advisor_said: 'Fine.',
  answered_stage: 'revise-1', scans: { key_shape: 'clear', personal_data: 'clear' }, ...over,
});
const CLEAR = { key_shape: 'clear', personal_data: 'clear' };
const scanClear = () => CLEAR;
const LABELS = { seats: { 'lab-a': 'The Gemini judge' }, stages: { 'revise-1': 'the first revision' } };
// applyApproval always gets the gate's bound entry for the excerpt; this builds it from the excerpt itself (the whole-path test takes it from a real gate instead)
const ap = (pending, answer, facts, opts = {}) => applyApproval(pending, answer, facts, { bound: boundExcerptsOf([pending], Number(String(answer?.id ?? 'E-1').slice(2)) || 1)[0], ...opts });

test('boundExcerptsOf: the list a gate binds, in the gate\'s shape, numbered from nextId, with the hash of each text and the number of lines the screen shows', () => {
  const a = pend(); const b = pend({ lines: null, text: 'x\ny\nz\nw' });
  assert.deepEqual(boundExcerptsOf([a, b], 4), [{ id: 'E-4', lines: '3-5', text_sha256: sha256Of('three\nfour\nfive'), shown_lines: 3 }, { id: 'E-5', lines: null, text_sha256: sha256Of('x\ny\nz\nw'), shown_lines: 4 }]);
  assert.equal(shownLinesOf('a'), 1);
  assert.equal(boundExcerptsOf([a])[0].id, 'E-1');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the screen said `the council` (twice). NEW: `the Council` (the capitalised name of THC's Council). WHY: the reviewed rows of src/excerpt-approval.js:78 and :91 (the apply, commit 1).
test('approvalScreen: ONE text for the excerpts of one pause, each in full with numbered lines, who asked and why and what the checks found, then what each choice does (a literal; nothing internal on it)', () => {
  const a = pend();
  const b = pend({ request_kind: 'session_read', requested_by: null, origin: null, objection_id: null, answered_stage: 'revise-1', why: 'To answer the revise stage.', source_kind: 'task_file', path: 'tasks/t.md', lines: null, text: 'The task says `retry`.', scans: { key_shape: 'continued_by_person', personal_data: 'clear' } });
  const got = approvalScreen({ pending: [a, b], nextId: 4, labels: { seats: { 'lab-a': 'The Gemini judge' }, stages: { 'revise-1': 'the first revision' } } });
  const expected = `Excerpt 1 of 2
The Gemini judge asked to see lines 3-5 of src/a.js (numbered 1-3 below), because: To judge the retry claim.
\`\`\`
1  three
2  four
3  five
\`\`\`
Checked for keys and personal data: nothing found.

Excerpt 2 of 2
The handling session read your task file (tasks/t.md) for its answer to the first revision, and wants the Council to see it.
\`\`\`
1  The task says \`retry\`.
\`\`\`
Checked for keys and personal data: something was found, and you chose to send it anyway.

For each excerpt you choose:
  approve - send exactly this text to the Council
  edit    - send less: give the numbers on the left of the lines to keep, or of the lines to hide
  refuse  - send nothing; the reviewer is told it was refused, and why if you say
Nothing is sent until you answer.
`;
  assert.equal(got, expected);
  for (const internal of ['repository_file', 'task_file', 'key_shape', 'personal_data', 'seat_request', 'session_read', 'E-4', 'E-5', 'O-1a2b3c4d', 'revise-1', 'lab-a', 'continued_by_person']) assert.equal(got.includes(internal), false, internal);
  assert.equal(screenSha256(got), createHash('sha256').update(got, 'utf8').digest('hex'));
  assert.notEqual(screenSha256(got), screenSha256(approvalScreen({ pending: [a, { ...b, text: 'other' }], nextId: 4, labels: LABELS })), 'the text shown is what the hash binds');
});

test('approvalScreen: lines are numbered with a common width, a fence longer than any run of backticks in the text, a hit is refused (the scan-hit stop comes first), and nothing waiting is refused', () => {
  const long = pend({ text: Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join('\n') });
  const got = approvalScreen({ pending: [long], labels: LABELS });
  assert.ok(got.includes(' 1  l1\n 2  l2'), 'width 2 for twelve lines');
  assert.ok(got.includes('12  l12'));
  assert.ok(approvalScreen({ pending: [pend({ text: 'a\n```\nb' })], labels: LABELS }).includes('````\n1  a\n2  ```\n3  b\n````'));
  assert.throws(() => approvalScreen({ pending: [pend({ scans: { key_shape: 'hit', personal_data: 'clear' } })], labels: LABELS }), /scan hit/);
  assert.throws(() => approvalScreen({ pending: [pend({ scans: { key_shape: 'clear', personal_data: 'hit' } })], labels: LABELS }), /scan-hit stop comes first/);
  assert.throws(() => approvalScreen({ pending: [], labels: LABELS }), /nothing waiting/);
});

test('editedText: the kept lines of the shown text; each RUN of hidden lines becomes one marker line (the recorded word); keeping needs nothing', () => {
  const t = 'a\nb\nc\nd\ne\nf';
  assert.equal(editedText(t, { lines: '2-5' }), 'b\nc\nd\ne');
  assert.equal(editedText(t, {}), t);
  // REMOVED (0.8.4 apply, recorded state; K7): the held-state line, 'hiding needs the marker to be recorded' (editedText throws while excerptHiddenLinesMarker is not recorded). It is recorded in every shipped run. Sibling: the hide assertions just below, in this test, on the recorded marker.
  setHeldForTest({ excerptHiddenLinesMarker });
  const M = excerptHiddenLinesMarker();
  assert.equal(editedText(t, { hide: [2] }), `a\n${M}\nc\nd\ne\nf`);
  assert.equal(editedText(t, { hide: [2, 3, 5] }), `a\n${M}\nd\n${M}\nf`, 'two runs: two markers');
  assert.equal(editedText(t, { lines: '2-5', hide: [2, 3] }), `${M}\nd\ne`, 'a run at the start of the kept range');
  assert.equal(editedText(t, { lines: '3-6', hide: [6] }), `c\nd\ne\n${M}`, 'a run at the end');
});

test('approve: the row is exactly what the gate recorded (actor, channel, time); the text is untouched and the record accepts it; a blank actor is none', () => {
  const out = ap(pend(), { id: 'E-1', decision: 'approve' }, FACTS);
  assert.deepEqual(out.approval, { status: 'approved', actor: 'alice', channel: 'cli', at: AT, reason: null });
  assert.deepEqual([out.edited, out.text], [false, 'three\nfour\nfive']);
  assert.equal(buildExcerptEntry(1, out).text_sha256, sha256Of('three\nfour\nfive'));
  assert.equal(ap(pend(), { id: 'E-1', decision: 'approve' }, { ...FACTS, actor: '  ' }).approval.actor, null);
  assert.equal(ap(pend(), { id: 'E-1', decision: 'approve' }, { ...FACTS, channel: 'elicitation', actor: 'claude-code' }).approval.channel, 'elicitation');
});

test('edit: a narrower range moves the file\'s lines with it; hidden lines are replaced by the marker; the new text is scanned again; recorded edited: true; the record accepts it', () => {
  setHeldForTest({ excerptHiddenLinesMarker });
  const M = excerptHiddenLinesMarker();
  const seen = [];
  const scan = t => { seen.push(t); return CLEAR; };
  const narrower = ap(pend(), { id: 'E-1', decision: 'edit', lines: '2-3' }, FACTS, { scan });
  assert.deepEqual([narrower.approval.status, narrower.edited, narrower.lines, narrower.text], ['edited', true, '4-5', 'four\nfive']);
  assert.deepEqual(seen, ['four\nfive'], 'the scan saw the new text');
  assert.equal(buildExcerptEntry(1, narrower).text_sha256, sha256Of('four\nfive'));
  const hidden = ap(pend(), { id: 'E-1', decision: 'edit', hide: [2] }, FACTS, { scan });
  assert.deepEqual([hidden.lines, hidden.text], ['3-5', `three\n${M}\nfive`]);
  assert.doesNotThrow(() => buildExcerptEntry(2, hidden));
  const whole = ap(pend({ lines: null, text: 'p\nq\nr\ns' }), { id: 'E-1', decision: 'edit', lines: '2-3' }, FACTS, { scan });
  assert.deepEqual([whole.lines, whole.text], ['2-3', 'q\nr'], 'a whole-file excerpt: positions are the file\'s lines');
  const wholeHide = ap(pend({ lines: null, text: 'p\nq\nr' }), { id: 'E-1', decision: 'edit', hide: [1] }, FACTS, { scan });
  assert.deepEqual([wholeHide.lines, wholeHide.text], [null, `${M}\nq\nr`], 'hiding alone leaves a whole-file excerpt whole');
});

test('edit: the scan is required, and a scan result that is not the record\'s is refused', () => {
  assert.throws(() => ap(pend(), { id: 'E-1', decision: 'edit', lines: '2-3' }, FACTS), /scanned again: the caller passes the scan/);
  for (const bad of [null, {}, { key_shape: 'maybe', personal_data: 'clear' }]) assert.throws(() => ap(pend(), { id: 'E-1', decision: 'edit', lines: '2-3' }, FACTS, { scan: () => bad }), /must be \{ key_shape, personal_data \}/, JSON.stringify(bad));
});

test('refuse: the reason is the person\'s own words and optional; a refusal carries no text, hash, scans or first stage, and the record accepts it either way', () => {
  const withReason = ap(pend(), { id: 'E-1', decision: 'refuse', reason: 'Not that file.' }, FACTS);
  assert.deepEqual(withReason.approval, { status: 'refused', actor: 'alice', channel: 'cli', at: AT, reason: 'Not that file.' });
  assert.deepEqual([withReason.text, withReason.file_sha256, withReason.scans, withReason.edited], [null, null, null, false]);
  assert.equal(buildExcerptEntry(1, withReason).text_sha256, null);
  const without = ap(pend(), { id: 'E-1', decision: 'refuse', reason: null }, FACTS);
  assert.equal(without.approval.reason, null);
  assert.doesNotThrow(() => buildExcerptEntry(2, without));
  assert.equal(ap(pend(), { id: 'E-1', decision: 'refuse', reason: '' }, FACTS).approval.reason, null, 'an empty string is recorded as none');
});

test('the row comes from the answer\'s own facts: the session\'s channel, an unknown channel and a missing time are refused, as is an unknown decision', () => {
  for (const channel of ['session', 'main-session', '', undefined, 'tty']) assert.throws(() => ap(pend(), { id: 'E-1', decision: 'approve' }, { ...FACTS, channel }), /channel must be one a person uses/, String(channel));
  assert.throws(() => ap(pend(), { id: 'E-1', decision: 'approve' }, { ...FACTS, at: 'yesterday' }), /time the gate recorded/);
  assert.throws(() => ap(pend(), { id: 'E-1', decision: 'approve' }, null), /channel must be one a person uses/);
  for (const decision of ['accept', 'APPROVE', '', undefined]) assert.throws(() => ap(pend(), { id: 'E-1', decision }, FACTS), /decision must be one of/, String(decision));
  assert.throws(() => ap(pend(), null, FACTS), /decision must be one of/);
  assert.deepEqual([...GATE_PERSON_CHANNELS], ['cli', 'elicitation'], 'the person channels copied here are the gate\'s');
});

test('the whole path: the bound list and the screen go into a gate; the person\'s answers are checked and stored by the gate; the rows are built from what the gate reads back (actor, channel, time) and the record accepts each', () => {
  setHeldForTest({ excerptHiddenLinesMarker });
  const base = mkdtempSync(join(tmpdir(), 'thc-excerpt-path-')); mkdirSync(join(base, 'runs')); const dir = join(base, 'runs', 'r1'); mkdirSync(dir);
  try {
    const pending = [pend(), pend({ lines: null, text: 'p\nq\nr\ns', why: 'To see the loop.' }), pend({ text: 'secret-ish\nplain' })];
    const screen = approvalScreen({ pending, nextId: 1, labels: LABELS });
    writeFileSync(join(dir, 'excerpt-screen.md'), screen);
    const opened = requestGate(dir, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: boundExcerptsOf(pending, 1) }, { now: () => Date.parse(AT) });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const answers = [{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'edit', lines: '2-3', hide: [3] }, { id: 'E-3', decision: 'refuse', reason: '  Not   needed.  ' }];
    const done = answerGate(dir, opened.gate.id, { channel: 'cli', shownSha256: screenSha256(screen), decision: 'approved', actor: 'alice', tty: true, excerptAnswers: answers }, { now: () => Date.parse(AT) + 1000 });
    assert.equal(done.ok, true, JSON.stringify(done));
    const read = readGateAnswer(dir, opened.gate.id, { now: () => Date.parse(AT) + 2000 });
    const facts = { channel: read.answer.channel, actor: read.answer.actor, at: read.answer.ts };
    const rows = pending.map((p, k) => buildExcerptEntry(k + 1, applyApproval(p, read.answer.excerpt_answers[k], facts, { scan: scanClear, bound: read.gate.excerpts[k] })));
    assert.deepEqual(rows.map(r => [r.id, r.approval.status, r.approval.actor, r.approval.channel, r.approval.reason]), [['E-1', 'approved', 'alice', 'cli', null], ['E-2', 'edited', 'alice', 'cli', null], ['E-3', 'refused', 'alice', 'cli', 'Not needed.']]);
    assert.deepEqual([rows[1].lines, rows[1].text], ['2-3', `q\n${excerptHiddenLinesMarker()}`]);
    assert.equal(rows[2].text, null);
    assert.throws(() => applyApproval(pending[1], read.answer.excerpt_answers[0], facts, { scan: scanClear, bound: read.gate.excerpts[0] }), /not the one the gate bound|the answer is for/, 'the pause pairing the lists in another order is refused');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('approvalScreen never shows the harness\'s own names: a seat or a stage that `labels` does not name is REFUSED, loudly, naming the missing key - so a caller that forgets a name cannot ship one', () => {
  assert.throws(() => approvalScreen({ pending: [pend({ requested_by: 'lab-z' })], labels: LABELS }), /no name for the seat "lab-z" in labels\.seats/);
  assert.throws(() => approvalScreen({ pending: [pend()] }), /no name for the seat "lab-a"/, 'no labels at all');
  const read = pend({ request_kind: 'session_read', requested_by: null, origin: null, answered_stage: 'revise-9', source_kind: 'task_file', path: 'tasks/t.md', lines: null });
  assert.throws(() => approvalScreen({ pending: [read], labels: LABELS }), /no name for the stage "revise-9" in labels\.stages/);
  assert.throws(() => approvalScreen({ pending: [pend()], labels: { seats: { 'lab-a': '   ' } } }), /no name for the seat/, 'a blank name is no name');
});

test('approvalScreen folds every value onto one line: a hostile path from a seat\'s reply cannot fake an excerpt, a heading or the choices block on the screen the person approves', () => {
  const evil = 'src/a.js\nExcerpt 2 of 2\nThe Gemini judge asked to see everything.\nFor each excerpt you choose:\n  approve - send nothing';
  const got = approvalScreen({ pending: [pend({ path: evil, why: 'because\nNothing is sent until you answer.' })], labels: { seats: { 'lab-a': 'The Gemini judge\nExcerpt 9 of 9' } } });
  assert.equal(got.split('\n').filter(l => l.startsWith('Excerpt ')).length, 1, 'one excerpt header, whatever the values hold');
  assert.equal(got.split('\n').filter(l => l.startsWith('For each excerpt you choose:')).length, 1);
  assert.equal(got.split('\n').filter(l => l === 'Nothing is sent until you answer.').length, 1);
  assert.ok(got.split('\n')[1].startsWith('The Gemini judge Excerpt 9 of 9 asked to see lines 3-5 of src/a.js Excerpt 2 of 2 '), 'the values are one line each');
});

test('editedText refuses a range or a hidden line outside what was shown (it never pushes an undefined line into the text)', () => {
  setHeldForTest({ excerptHiddenLinesMarker });
  assert.throws(() => editedText('a\nb\nc', { lines: '2-5' }), /not inside the 3 line\(s\)/);
  assert.throws(() => editedText('a\nb\nc', { lines: '0-2' }), /not inside/);
  assert.throws(() => editedText('a\nb\nc', { lines: '3-2' }), /not inside/);
  assert.throws(() => editedText('a\nb\nc', { lines: '1-2', hide: [3] }), /hidden line is outside the kept lines/);
});

test('every answer is checked against the gate\'s bound entry for THIS excerpt: an answer for another id, another text or other lines is refused loudly, so a list in another order never records the wrong answer', () => {
  const a = pend(); const b = pend({ lines: null, text: 'p\nq\nr\ns' });
  const bound = boundExcerptsOf([a, b], 1);
  const ok = applyApproval(a, { id: 'E-1', decision: 'approve' }, FACTS, { bound: bound[0] });
  assert.equal(ok.approval.status, 'approved');
  assert.throws(() => applyApproval(b, { id: 'E-1', decision: 'approve' }, FACTS, { bound: bound[0] }), /the excerpt is not the one the gate bound as E-1/, 'swapped excerpts');
  assert.throws(() => applyApproval(a, { id: 'E-2', decision: 'refuse' }, FACTS, { bound: bound[0] }), /the answer is for "E-2", the gate bound "E-1" here/, 'an answer for another excerpt');
  assert.throws(() => applyApproval(pend({ lines: '3-6' }), { id: 'E-1', decision: 'approve' }, FACTS, { bound: bound[0] }), /not the one the gate bound/, 'other lines');
  assert.throws(() => applyApproval(pend({ text: 'three\nfour\nCHANGED' }), { id: 'E-1', decision: 'approve' }, FACTS, { bound: bound[0] }), /not the one the gate bound/, 'other text');
  assert.throws(() => applyApproval(a, { id: 'E-1', decision: 'approve' }, FACTS), /bound entry for this excerpt is required/);
});


// 0.8.4 unit 1 (C&C ruling 09 Nov 2026, WORDING U1-w1): no personal-data check runs during a run, so an excerpt whose personal_data is not_scanned gets a screen line that says so and never reads as a pass.
test('approvalScreen, personal_data not_scanned: the line names the keys check and says personal data was not checked during the run; the two other lines are unchanged', () => {
  const NOT = { key_shape: 'clear', personal_data: 'not_scanned' };
  const clearScreen = approvalScreen({ pending: [pend({ scans: NOT })], labels: LABELS });
  assert.match(clearScreen, /\nChecked for keys: nothing found\. Personal data was not checked during the run; the check at the start applies\.\n/);
  assert.equal(/nothing found\.\n/.test(clearScreen.replace('Checked for keys: nothing found. Personal data was not checked during the run; the check at the start applies.', '')), false, 'no line of this screen says "nothing found" about personal data');
  const continued = approvalScreen({ pending: [pend({ scans: { key_shape: 'continued_by_person', personal_data: 'not_scanned' } })], labels: LABELS });
  assert.match(continued, /\nChecked for keys: something was found, and you chose to send it anyway\. Personal data was not checked during the run; the check at the start applies\.\n/);
  assert.match(approvalScreen({ pending: [pend()], labels: LABELS }), /\nChecked for keys and personal data: nothing found\.\n/);
  for (const internal of ['not_scanned', 'personal_data', 'key_shape', 'scans']) assert.equal(clearScreen.includes(internal), false, `nothing internal on the screen: ${internal}`);
});

test('an edit whose rescan says personal_data not_scanned is accepted and recorded as it was scanned; not_scanned on key_shape is still refused', () => {
  const NOT = { key_shape: 'clear', personal_data: 'not_scanned' };
  const r = ap(pend(), { id: 'E-1', decision: 'edit', lines: '2-3' }, FACTS, { scan: () => NOT });
  assert.deepEqual(r.scans, NOT);
  assert.throws(() => ap(pend(), { id: 'E-1', decision: 'edit', lines: '2-3' }, FACTS, { scan: () => ({ key_shape: 'not_scanned', personal_data: 'clear' }) }), /must be \{ key_shape, personal_data \}/);
});

test('EMPTY TEXT on the approval screen (D10-w14): an excerpt that holds only whitespace is shown as empty after its closing fence, the screen still parses back to the exact texts, and the numbered row is kept as it is', () => {
  for (const text of ['', '\n']) {
    const a = pend({ text, lines: null });
    const screen = approvalScreen({ pending: [a], nextId: 1, labels: { seats: { 'lab-a': 'The judge' }, stages: {} } });
    assert.match(screen, /`{3,}\nThis excerpt holds no text\.\n/);
    const bound = boundExcerptsOf([a], 1);
    assert.deepEqual(screenExcerptsOf(screen, bound), [text], JSON.stringify(text));
  }
});
