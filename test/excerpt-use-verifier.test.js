// 0.8.4 D10 slice 2c (Mini-C&C's condition, mirroring RC-15): the ledger verifier believes an `excerpts_recorded` line only if the gate it names was asked for as an excerpt_approval gate, was answered, and was not
// used before. The refusal of a plain resume rests on "no excerpts_recorded line" (src/gate.js excerptApprovalWaiting); the chain is tamper-evident, not tamper-proof, so a forged, correctly chained line would
// otherwise satisfy it and let a resume walk past the person's approval. Here it breaks the ledger instead, for every reader. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { requestGate, answerGate, recordExcerptsRecorded, recordUse, excerptApprovalWaiting, readGateAnswer, EXCERPT_APPROVAL_KIND } = await import('../src/gate.js');
import { LEDGER_FILE, readLedger } from '../src/gate-ledger.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const T0 = Date.parse('2026-11-04T10:00:00.000Z'); const at = ms => () => T0 + ms;
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const runDir = () => { const base = mkdtempSync(join(tmpdir(), 'thc-use-verifier-')); dirs.push(base); mkdirSync(join(base, 'runs')); const d = join(base, 'runs', 'r1'); mkdirSync(d); return d; };
const EX = [{ id: 'E-1', lines: null, text_sha256: 'a'.repeat(64), shown_lines: 2 }];
const open = (dir, kind = EXCERPT_APPROVAL_KIND, name = 'screen.md') => {
  writeFileSync(join(dir, name), `SCREEN ${name}\n`);
  const g = requestGate(dir, { kind, textPath: name, ...(kind === EXCERPT_APPROVAL_KIND ? { excerpts: EX } : {}) }, { now: at(0) });
  assert.equal(g.ok, true, JSON.stringify(g));
  return g.gate;
};
const answer = (dir, g) => answerGate(dir, g.id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, ...(g.kind === EXCERPT_APPROVAL_KIND ? { excerptAnswers: [{ id: 'E-1', decision: 'approve' }] } : {}) }, { now: at(1) });
// A hand-written line with a CORRECT chain: the hash of the line before, the next seq. What a forger who can write the run folder would write.
function forge(dir, fields) {
  const raw = readFileSync(join(dir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean);
  const prev = createHash('sha256').update(raw[raw.length - 1]).digest('hex');
  appendFileSync(join(dir, LEDGER_FILE), `${JSON.stringify({ schema: 'gate-ledger/1', seq: raw.length + 1, prev, ts: new Date(T0 + 5).toISOString(), event: 'excerpts_recorded', ...fields })}\n`);
}

test('a use line that names a gate no earlier line asked for is a broken ledger, and so a resume cannot be talked past an approval: the ledger does not verify, the waiting reader fails closed, and `council gate verify` says so', () => {
  const dir = runDir();
  const g = open(dir);   // asked, not answered
  forge(dir, { gate: 'g7', sha256: g.sha256, run_id: 'r1', count: 1 });
  const read = readLedger(dir);
  assert.equal(read.ok, false);
  assert.match(read.reason, /excerpts_recorded names "g7", which no earlier line asked for as an excerpt_approval gate/);
  const waiting = excerptApprovalWaiting(dir);
  assert.deepEqual([waiting.ok, waiting.code], [false, 'gate_ledger_corrupt'], 'a forged line never reads as "nothing waits"');
  const v = spawnSync(process.execPath, [cli, 'gate', 'verify', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  assert.equal(v.status, 1, v.stdout + v.stderr);
  assert.match(v.stderr, /gate ledger is broken at line 2/);
});

test('a use line before the gate was answered is a broken ledger: an unanswered gate cannot be "recorded"', () => {
  const dir = runDir();
  const g = open(dir);
  forge(dir, { gate: g.id, sha256: g.sha256, run_id: 'r1', count: 1 });
  const read = readLedger(dir);
  assert.equal(read.ok, false);
  assert.match(read.reason, /excerpts_recorded names g1, which no earlier line answered/);
  assert.equal(excerptApprovalWaiting(dir).ok, false);
});

test('a second use line for the same gate is a broken ledger: one answer covers one recording', () => {
  const dir = runDir();
  const g = open(dir);
  assert.equal(answer(dir, g).ok, true);
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 1 }, { now: at(2) }).ok, true);
  assert.equal(readLedger(dir).ok, true, 'one real use verifies');
  forge(dir, { gate: g.id, sha256: g.sha256, run_id: 'r1', count: 1 });
  const read = readLedger(dir);
  assert.equal(read.ok, false);
  assert.match(read.reason, /excerpts_recorded names g1 a second time/);
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 1 }, { now: at(3) }).ok, false, 'a broken ledger takes no new line');
});

test('a use line for a gate of ANOTHER kind is a broken ledger: only an excerpt_approval gate is recorded this way', () => {
  const dir = runDir();
  const adv = open(dir, 'advice', 'a.md');
  assert.equal(answer(dir, adv).ok, true);
  forge(dir, { gate: adv.id, sha256: adv.sha256, run_id: 'r1', count: 1 });
  const read = readLedger(dir);
  assert.equal(read.ok, false);
  assert.match(read.reason, /no earlier line asked for as an excerpt_approval gate/);
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the other-kind use was written with recordSent(d2, adv.id, { run: 'r1' }, ...). NEW: recordUse(d2, adv.id, 'sent', { run: 'r1' }, ...). WHY: recordSent left src/gate.js with the advice add-on; `sent` stays a use event (USE_EVENTS, read-only vocabulary since 0.8.4) and recordUse writes the same ledger line, so the row still shows that a use of a gate of another kind does not trip this verifier rule.
test('the honest order verifies and nothing else is changed: asked, answered, recorded is a ledger that holds, the waiting reader sees it used, and the other use events are untouched', () => {
  const dir = runDir();
  const g = open(dir);
  assert.equal(answer(dir, g).ok, true);
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(2) }).waiting, [{ gate: g.id, status: 'approved' }]);
  assert.equal(recordExcerptsRecorded(dir, g.id, { runId: 'r1', count: 1 }, { now: at(2) }).ok, true);
  const read = readLedger(dir);
  assert.equal(read.ok, true);
  assert.deepEqual(read.lines.map(l => l.event), ['gate_requested', 'gate_answered', 'excerpts_recorded']);
  assert.deepEqual(excerptApprovalWaiting(dir, { now: at(3) }), { ok: true, waiting: [] });
  assert.equal(readGateAnswer(dir, g.id, { now: at(3) }).used, true);
  const d2 = runDir(); const adv = open(d2, 'advice', 'a.md');
  assert.equal(answer(d2, adv).ok, true);
  assert.equal(recordUse(d2, adv.id, 'sent', { run: 'r1' }, { now: at(2) }).ok, true, 'an advice gate\'s own use is not this rule\'s business');
  assert.equal(readLedger(d2).ok, true);
});

test('the gate kind spelled in the ledger verifier is the gate module\'s own', () => {
  const text = readFileSync(join(dirname(cli), 'gate-ledger.js'), 'utf8');
  assert.ok(text.includes(`const EXCERPT_APPROVAL_KIND_NAME = '${EXCERPT_APPROVAL_KIND}';`));
});
