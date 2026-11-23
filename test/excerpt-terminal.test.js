// 0.8.4 D10 slice 2c-4 (T5.5): the terminal channel of the `excerpt_approval` gate. `council gate answer <run> <gate>` on such a gate shows the screen, asks for ONE answer per excerpt the gate binds
// (approve, edit or refuse), shows an edit as it will be sent, asks to record the answers, and hands them to answerGate, which checks them against the excerpts bound in the gate. A choice that is
// none of the three words, or an edit that cannot be made, writes nothing; declining the gate refuses every excerpt. The screen is a real approvalScreen, its list the gate's real binding. Offline, $0: no run, no model, only a gate in a scratch run folder.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { PassThrough } from 'node:stream';
import { requestGate, readGateAnswer } from '../src/gate.js';
import { gateCommand } from '../src/gate-cli.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
// guarded: on a tree without this module (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { approvalScreen, boundExcerptsOf } = await import('../src/excerpt-approval.js').catch(() => ({}));
import { setHeldForTest } from '../src/held-roles.js';
import { excerptHiddenLinesMarker } from './held-prompts/held-084-a.js';

const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const now = () => T0 + 1000;
const pend = over => ({ request_kind: 'seat_request', requested_by: 'lab-a', objection_id: 'O-1a2b3c4d', origin: 'panel-1-lab-a', why: 'To judge the retry claim.', source_kind: 'repository_file', path: 'src/a.js', file_sha256: 'c'.repeat(64), edited: false, answered_stage: 'revise-1', scans: { key_shape: 'clear', personal_data: 'clear' }, ...over });
const PENDING = [pend({ lines: '10-14', text: 'alpha\nbeta\ngamma\ndelta\nepsilon' }), pend({ lines: null, text: 'xray\nyankee' })];
const LABELS = { seats: { 'lab-a': 'The Gemini judge' }, stages: { 'revise-1': 'the first revision' } };
// (optional calls: with the module absent these two constants are undefined and each row fails at its own first use)
const SCREEN = approvalScreen?.({ pending: PENDING, labels: LABELS });
const EX = boundExcerptsOf?.(PENDING);
const bases = [];

function fresh() {
  const base = mkdtempSync(join(tmpdir(), 'excerpt-term-')); bases.push(base);
  const d = join(base, 'run-1'); mkdirSync(d);
  writeFileSync(join(d, 'excerpt-screen.md'), SCREEN);
  const r = requestGate(d, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: EX }, { now });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { base, d, id: r.gate.id };
}
function terminal(typed, { tty = true } = {}) {
  const stdin = new PassThrough(); stdin.isTTY = tty; stdin.setRawMode = () => {};
  const stdout = new PassThrough(); stdout.isTTY = tty; const stderr = new PassThrough();
  let shown = ''; let errs = '';
  stdout.on('data', x => { shown += x; }); stderr.on('data', x => { errs += x; });
  for (const t of typed) stdin.write(`${t}\n`);
  return { stdin, stdout, stderr, shown: () => shown, errs: () => errs };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const answer = (g, io, extra = []) => gateCommand(['answer', basename(g.d), g.id, ...extra], { work: g.base, ...io, now });

afterEach(() => setHeldForTest(null));
test.after(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });

test('ET-1 the screen is shown with lines of its own kind (no price, seats or sensitivity) and one question per excerpt', async () => {
  const g = fresh(); const io = terminal(['a', 'a', 'y']);
  const code = await answer(g, io);
  assert.equal(code, 0, `exit ${code}: ${io.errs()} | ${io.shown().slice(-300)}`);
  assert.match(io.shown(), /gate g1 \(excerpt_approval\): excerpt-screen\.md, \d+ bytes, sha256 [0-9a-f]{64}/);
  assert.match(io.shown(), /you approve, edit or refuse each excerpt of your project shown below; nothing is sent to any model until the answers are applied/);
  assert.doesNotMatch(io.shown(), /price:|seats:|sensitivity|up to unpriced/);
  assert.match(io.shown(), /Excerpt 1 of 2 \(E-1\): approve, edit or refuse\? \[a\/e\/r\]/);
  assert.match(io.shown(), /Excerpt 2 of 2 \(E-2\): approve, edit or refuse\? \[a\/e\/r\]/);
  assert.match(io.shown(), /alpha/);
  assert.doesNotMatch(io.shown(), /This is exactly what would be sent/, 'an approval shows no edit preview');
});

test('ET-2 an approval and a refusal with a reason are recorded as ONE answered line with the per-excerpt answers, by the terminal channel', async () => {
  const g = fresh(); const io = terminal(['a', 'r', 'it holds a customer name', 'y']);
  const code = await answer(g, io);
  assert.equal(code, 0, `exit ${code}: ${io.errs()} | ${io.shown().slice(-300)}`);
  assert.match(io.shown(), /E-1: approved/);
  assert.match(io.shown(), /E-2: refused: it holds a customer name/);
  const lines = ledger(g.d).filter(l => l.event === 'gate_answered');
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].channel, lines[0].tty, lines[0].decision], ['cli', true, 'approved']);
  assert.deepEqual(lines[0].excerpt_answers, [{ id: 'E-1', decision: 'approve' }, { id: 'E-2', decision: 'refuse', reason: 'it holds a customer name' }]);
  assert.equal(readGateAnswer(g.d, g.id, { now }).status, 'approved');
});

test('ET-3 a refusal with no reason records no reason', async () => {
  const g = fresh(); const io = terminal(['r', '', 'r', '', 'y']);
  assert.equal(await answer(g, io), 0, `${io.errs()}`);
  const a = ledger(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual(a.excerpt_answers, [{ id: 'E-1', decision: 'refuse', reason: null }, { id: 'E-2', decision: 'refuse', reason: null }]);
});

test('ET-4 a choice that is none of the three words writes nothing and leaves the gate pending', async () => {
  for (const typed of ['x', '', 'yes', 'ar']) {
    const g = fresh(); const io = terminal([typed]);
    const code = await answer(g, io);
    assert.equal(code, 1, `typed ${JSON.stringify(typed)}: exit ${code}`);
    assert.match(io.shown(), /That is not a choice\. Nothing was written; the gate stays pending\./);
    assert.equal(ledger(g.d).length, 1, 'only the request line');
    assert.equal(readGateAnswer(g.d, g.id, { now }).status, 'pending');
  }
});

test('ET-5 anything but yes at "Record these answers?" writes nothing and leaves the gate pending', async () => {
  const g = fresh(); const io = terminal(['a', 'a', 'n']);
  assert.equal(await answer(g, io), 1);
  assert.match(io.shown(), /E-1: approved\nE-2: approved\n/);
  assert.match(io.shown(), /Record these answers\? \[y\/N\]/);
  assert.match(io.shown(), /Not confirmed\. Nothing was written; the gate stays pending\./);
  assert.equal(ledger(g.d).length, 1);
  assert.equal(readGateAnswer(g.d, g.id, { now }).status, 'pending');
});

test('ET-6 declining the gate refuses every excerpt: its own words, a declined line with no answers', async () => {
  const g = fresh(); const io = terminal(['y']);
  const code = await answer(g, io, ['--decline']);
  assert.equal(code, 0, `exit ${code}: ${io.errs()}`);
  assert.match(io.shown(), /Decline gate g1: every excerpt is refused and none will be used\. Decline\? \[y\/N\]/);
  const a = ledger(g.d).find(l => l.event === 'gate_answered');
  assert.deepEqual([a.decision, a.excerpt_answers], ['declined', undefined]);
});

test('ET-7 without a terminal nothing is asked and nothing is written', async () => {
  const g = fresh(); const io = terminal(['a'], { tty: false });
  assert.equal(await answer(g, io), 2);
  assert.match(io.errs(), /needs a person at a terminal/);
  assert.equal(ledger(g.d).length, 1);
});

// The lines of the preview: what stands between the fences printText draws after the heading "This is exactly what would be sent" (the same rendering as the screen).
const previewOf = shown => { const at = shown.indexOf('This is exactly what would be sent'); if (at < 0) return null; const rows = shown.slice(at).split('\n').slice(1); const from = rows.findIndex(l => /the exact text \(begin\)/.test(l)); const to = rows.findIndex(l => /the exact text \(end\)/.test(l)); return rows.slice(from + 1, to); };

test('ET-8 an edit that keeps a run of lines shows exactly those lines, then records the range as the answer', async () => {
  const g = fresh(); const io = terminal(['e', '2-4', '', 'a', 'y']);
  const code = await answer(g, io);
  assert.equal(code, 0, `exit ${code}: ${io.errs()} | ${io.shown().slice(-400)}`);
  assert.match(io.shown(), /This is exactly what would be sent for E-1:/);
  assert.deepEqual(previewOf(io.shown()), ['beta', 'gamma', 'delta']);
  assert.match(io.shown(), /E-1: edited, lines 2-4 kept\n/);
  assert.deepEqual(ledger(g.d).find(l => l.event === 'gate_answered').excerpt_answers, [{ id: 'E-1', decision: 'edit', lines: '2-4' }, { id: 'E-2', decision: 'approve' }]);
});

test('ET-9 an edit that hides lines shows the marker line in place of the run, and records the hidden numbers', async () => {
  setHeldForTest({ excerptHiddenLinesMarker });
  const g = fresh(); const io = terminal(['e', '', '2-3', 'a', 'y']);
  const code = await answer(g, io);
  assert.equal(code, 0, `exit ${code}: ${io.errs()} | ${io.shown().slice(-400)}`);
  assert.deepEqual(previewOf(io.shown()).slice(0, 3), ['alpha', excerptHiddenLinesMarker(), 'delta']);
  assert.match(io.shown(), /E-1: edited, lines 1-5 kept, 2 hidden\n/);
  assert.deepEqual(ledger(g.d).find(l => l.event === 'gate_answered').excerpt_answers[0], { id: 'E-1', decision: 'edit', hide: [2, 3] });
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: ET-10 'while the hidden-lines marker is not recorded an edit that hides lines is refused with a sentence and nothing is written' (its scripted terminal ['e', '', '2'] now hides line 2 and waits for the next answer, so it ran until the 900 s timeout). NEW: the row is removed (K7, SIBLING: ET-9, which asserts the hiding edit as recorded, and ET-11 for the refusals that remain). WHY: excerptHiddenLinesMarker is recorded (recorded-084-a.js).

test('ET-11 an edit that cannot be made writes nothing: lines outside the excerpt, a run with a gap, hidden lines outside the kept ones, every line hidden, nothing changed', async () => {
  setHeldForTest({ excerptHiddenLinesMarker });
  const cases = [
    [['e', '0-2'], /Those are not lines of E-1: keep one run of its lines 1-5\./],
    [['e', '2-9'], /Those are not lines of E-1/],
    [['e', '1,3'], /Those are not lines of E-1/],
    [['e', 'two'], /Those are not lines of E-1/],
    [['e', '2-4', '5'], /Those are not among the lines you keep\./],
    [['e', '2-3', '2-3'], /That hides every line: to send nothing, refuse the excerpt\./],
    [['e', '', ''], /That keeps every line and hides none: to send everything, approve the excerpt\./],
    [['e', '1-5', ''], /That keeps every line and hides none/],
  ];
  for (const [typed, expected] of cases) {
    const g = fresh(); const io = terminal(typed);
    assert.equal(await answer(g, io), 1, JSON.stringify(typed));
    assert.match(io.shown(), expected, JSON.stringify(typed));
    assert.match(io.shown(), /Nothing was written; the gate stays pending\./);
    assert.equal(ledger(g.d).length, 1, `${JSON.stringify(typed)}: only the request line`);
  }
});

test('ET-12 the stored text altered after the request: the answer is refused, nothing is written, and an edit is not previewed from it', async () => {
  // approve: the text shown is not the text the request line recorded (the gate refuses it by its sha256)
  const a = fresh(); writeFileSync(join(a.d, 'excerpt-screen.md'), SCREEN.replace('alpha', 'omega'));
  const ioA = terminal(['a', 'a', 'y']);
  assert.equal(await answer(a, ioA), 1);
  assert.match(ioA.errs(), /refused \(hash_mismatch\): the text shown \([0-9a-f]{12}\) is not the text of gate g1 \([0-9a-f]{12}\)/);
  assert.equal(ledger(a.d).length, 1, 'only the request line');
  // edit: the excerpt cannot be checked against what the gate bound, so it cannot be edited
  const b = fresh(); writeFileSync(join(b.d, 'excerpt-screen.md'), SCREEN.replace('alpha', 'omega'));
  const ioB = terminal(['e', '2-4', '']);
  assert.equal(await answer(b, ioB), 1);
  assert.match(ioB.shown(), /The text of this excerpt cannot be checked against the text the gate asked about, so it cannot be edited here\. Nothing was written; the gate stays pending\./);
  assert.equal(previewOf(ioB.shown()), null);
  assert.equal(ledger(b.d).length, 1);
});
