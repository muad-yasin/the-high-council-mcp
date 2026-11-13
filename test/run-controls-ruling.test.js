// 0.8.4 S20 slice 2, step 3.1 (money): the person's ruling and its withdrawal are answered through the one interface (src/run-controls.js, control 'ruling'), which refuses an APPROVAL whose pass already has a stage
// on disk: that stage was asked without the ruling, a prompt that now carries it differs, and the next resume would pay for the stage a second time. Offline, $0. The terminal path had no such check at all; the relay had it only in its
// own command. Rows: a terminal approval for a pass with stages is refused and records nothing, the gate stays pending (RS-1, the discriminating row: the old terminal approved it); the same through the interface for the three kinds
// (RS-2), a decline is never refused (RS-3), no stages and an approved ruling is carried (RS-4, control), the relay channel (RS-5), the channels and the gate kinds the control takes (RS-6), a gate text that is not exactly its kind (RS-7).
// The run lock is never taken and never refused on (a live run is not refused here: dating a ruling made while a pass runs is a later step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { requestRuling, requestWithdrawal, requestGate, readGateAnswer, rulingsOf, SESSION_CHANNEL } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { gateCommand } from '../src/gate-cli.js';
import { relayCommand } from '../src/gate-relay-cli.js';

const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const now = () => T0;
// loaded inside each row, so a tree without the control fails the rows one by one (the old interface answers 'unknown_control' to control 'ruling')
const answerControl = async (...a) => (await import('../src/run-controls.js')).answerControl(...a);
const folder = () => { const base = mkdtempSync(join(tmpdir(), 'rc-ruling-')); const d = join(base, 'run-1'); mkdirSync(d); return { base, d }; };
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const shown = (d, id) => readGateAnswer(d, id, { now }).gate.sha256;
const stage = (d, pass) => writeFileSync(join(d, `ldebate-${pass}-l1.md`), 'a stage that was asked without the ruling\n');
function terminal(typed) {
  const stdin = new PassThrough(); stdin.isTTY = true; stdin.setRawMode = () => {};
  const stdout = new PassThrough(); stdout.isTTY = true; const stderr = new PassThrough();
  let out = ''; let errs = '';
  stdout.on('data', x => { out += x; }); stderr.on('data', x => { errs += x; });
  for (const t of typed) stdin.write(`${t}\n`);
  return { stdin, stdout, stderr, shown: () => out, errs: () => errs };
}
const atTerminal = (f, id, typed, extra = []) => { const io = terminal(typed); return gateCommand(['answer', basename(f.d), id, ...extra], { work: f.base, ...io, now }).then(code => ({ code, io })); };
const ruling = (f, pass = 3, relayed = false) => { const r = requestRuling(f.d, { pass, text: 'Replace E5 by the amended R19.', relayed }, { now }); assert.equal(r.ok, true, JSON.stringify(r)); return r.gate.id; };

test('RS-1 (the terminal) a ruling for a pass that already has a stage on disk is refused when the person approves it: nothing is recorded, the gate stays pending, and the sentence says why', async () => {
  const f = folder(); const id = ruling(f, 3);
  stage(f.d, 3);                                   // the run went on and asked pass 3 without the ruling, before the person answered
  const before = ledger(f.d).length;
  const { code, io } = await atTerminal(f, id, ['y']);
  assert.equal(code, 1, `${io.errs()} | ${io.shown().slice(-200)}`);
  assert.match(io.errs(), /gate g1: refused \(pass_has_stages\): pass 3 already has a stage on disk \(ldebate-3-l1\.md\), so a ruling for it would change what that stage was asked\. Nothing was recorded\./);
  assert.equal(ledger(f.d).length, before, 'nothing appended (a refusal records nothing)');
  assert.equal(readGateAnswer(f.d, id, { now }).status, 'pending');
  assert.deepEqual(rulingsOf(f.d, { now }).rulings, [], 'no ruling in force');
});

// CHANGED ACCEPTED (0.8.4 S19 (c), H-M1-r4; a row of D's slice 2). OLD: RS-2 asserted the stale-pass refusal through the interface for THREE kinds (a ruling, a withdrawal and a re-tag, built with requestRetag; message 'so a re-tag for it would change...'). NEW: the same assertions for the two kinds that remain. WHY: the re-tag gate is removed; the handler's re-tag is its own act, and retag-add checks the same stale pass itself (test/severity-handler-retag.test.js C3: 'already has a stage on disk'). RED BEFORE (c): none by name (green by design for the kept kinds).
test('RS-2 the same refusal through the interface for the two kinds: a ruling and a withdrawal', async () => {
  const f = folder();
  const g1 = ruling(f, 2);
  stage(f.d, 99);                                    // an unrelated pass: no effect on pass 2
  assert.equal((await answerControl(f.d, g1, { control: 'ruling', channel: 'cli', shownSha256: shown(f.d, g1), decision: 'approved', actor: 'tester', tty: true }, { now })).ok, true, 'a ruling for a pass with no stage is approved (control)');
  const w = requestWithdrawal(f.d, { gate: g1, pass: 3 }, { now }); assert.equal(w.ok, true, JSON.stringify(w));
  stage(f.d, 3);
  const before = ledger(f.d).length;
  for (const [id, what] of [[w.gate.id, 'a withdrawal']]) {
    const r = await answerControl(f.d, id, { control: 'ruling', channel: 'cli', shownSha256: shown(f.d, id), decision: 'approved', actor: 'tester', tty: true }, { now });
    assert.deepEqual([r.ok, r.code], [false, 'pass_has_stages'], JSON.stringify(r));
    assert.match(r.message, new RegExp(`^pass 3 already has a stage on disk \\(ldebate-3-l1\\.md\\), so ${what} for it would change what that stage was asked\\. Nothing was recorded\\.$`));
    assert.equal(readGateAnswer(f.d, id, { now }).status, 'pending');
  }
  assert.equal(ledger(f.d).length, before, 'nothing appended');
});

test('RS-3 a decline is never refused, with or without stages: a person can always say no', async () => {
  const f = folder(); const id = ruling(f, 3); stage(f.d, 3);
  const { code, io } = await atTerminal(f, id, ['y'], ['--decline']);
  assert.equal(code, 0, `${io.errs()} | ${io.shown().slice(-200)}`);
  assert.equal(readGateAnswer(f.d, id, { now }).status, 'declined');
  const g = ruling(f, 4);                           // the same through the interface
  stage(f.d, 4);
  const r = await answerControl(f.d, g, { control: 'ruling', channel: 'cli', shownSha256: shown(f.d, g), decision: 'declined', actor: 'tester', tty: true }, { now });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('RS-4 (control) a ruling for a pass with no stage on disk is approved through the interface and the terminal alike, and is then in force', async () => {
  const f = folder(); const a = ruling(f, 3);
  const { code, io } = await atTerminal(f, a, ['y']);
  assert.equal(code, 0, `${io.errs()} | ${io.shown().slice(-200)}`);
  assert.deepEqual(rulingsOf(f.d, { now }).rulings.map(r => [r.gate, r.pass, r.channel]), [['g1', 3, 'cli']]);
  const b = requestRuling(f.d, { pass: 5, text: 'Another decision.' }, { now }).gate.id;
  const r = await answerControl(f.d, b, { control: 'ruling', channel: 'cli', shownSha256: shown(f.d, b), decision: 'approved', actor: 'tester', tty: true }, { now });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(rulingsOf(f.d, { now }).rulings.map(x => x.pass), [3, 5]);
});

test('RS-5 the relay (the session channel): the stage check is the interface\'s, the person\'s words are still required, and a decline is not the session\'s', async () => {
  const f = folder(); const id = ruling(f, 3, true);
  const base = { control: 'ruling', channel: SESSION_CHANNEL, shownSha256: shown(f.d, id), reason: 'relayed on the person\'s permission' };
  assert.equal((await answerControl(f.d, id, { ...base, decision: 'declined' }, { now })).code, 'session_cannot_decline');
  assert.equal((await answerControl(f.d, id, { ...base, personWords: '' }, { now })).code, 'person_words_required');
  stage(f.d, 3);
  const before = ledger(f.d).length;
  const stale = await answerControl(f.d, id, { ...base, personWords: 'Yes, decide it that way' }, { now });
  assert.deepEqual([stale.ok, stale.code], [false, 'pass_has_stages'], JSON.stringify(stale));
  assert.equal(ledger(f.d).length, before, 'nothing appended');
  const g = ruling(f, 6, true);                      // a pass with no stage: the relay is recorded as before (channel session, the words verbatim)
  // CHANGED ACCEPTED ROW (S20 slice 2, Q1). OLD words: 'Yes, decide it that way'. NEW: the words contain the ruling text. WHY: a ruling the session relays is accepted only with the ruling text IN the person's words (src/gate.js, src/rulings.js rulingTextInWords).
  const ok = await answerControl(f.d, g, { ...base, shownSha256: shown(f.d, g), personWords: 'Yes, Replace E5 by the amended R19. Decide it that way.' }, { now });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(rulingsOf(f.d, { now }).rulings.map(r => [r.pass, r.channel, r.person_words]), [[6, 'session', 'Yes, Replace E5 by the amended R19. Decide it that way.']]);
});

// CHANGED ACCEPTED (0.8.4 S19 (c), H-M1-r4): title only ('three kinds' -> 'the kinds'); the assertions are unchanged. WHY: the re-tag kind is removed. RED BEFORE (c): none (title).
test('RS-6 the control takes the ruling kinds and the channels cli and session only: a limit gate, an unknown gate and the window are refused with their own codes', async () => {
  const f = folder(); const id = ruling(f, 3);
  const base = { control: 'ruling', shownSha256: shown(f.d, id), decision: 'approved', actor: 'tester', tty: true };
  assert.equal((await answerControl(f.d, id, { ...base, channel: 'elicitation' }, { now })).code, 'channel_not_allowed', 'no window exists for a ruling');
  assert.equal((await answerControl(f.d, id, { ...base, channel: 'cli', personWords: 'Yes' }, { now })).code, 'person_words_not_for_person');
  assert.equal((await answerControl(f.d, 'g9', { ...base, channel: 'cli' }, { now })).ok, false, 'a gate that is not there');
  writeFileSync(join(f.d, 'cap-screen-2.md'), 'The screen.\n');
  const cap = requestGate(f.d, { kind: 'run_cap', textPath: 'cap-screen-2.md', cap: { operation: 'raise', run_id: 'run-1', scope_sha256: 'a'.repeat(64), ceiling_usd: 10, ceiling_source: 'COUNCIL_MAX_USD_LIMIT' }, expiresAt: T0 + 3600e3 }, { now });
  assert.equal(cap.ok, true, JSON.stringify(cap));
  assert.equal((await answerControl(f.d, cap.gate.id, { ...base, channel: 'cli', shownSha256: shown(f.d, cap.gate.id) }, { now })).code, 'not_a_ruling_gate', 'a limit is not a ruling');
  assert.equal((await answerControl(f.d, id, { control: 'nonsense', channel: 'cli' }, { now })).code, 'unknown_control');
  assert.equal(readGateAnswer(f.d, id, { now }).status, 'pending', 'none of this recorded anything');
});

test('RS-7 a gate whose text is not exactly a ruling cannot be approved (a ruling nobody can read would block every resume); a decline still works', async () => {
  const f = folder();
  writeFileSync(join(f.d, 'ruling-bad.md'), 'Just some words, not a ruling.\n');
  const r = requestGate(f.d, { kind: 'ruling', textPath: 'ruling-bad.md', expiresAt: T0 + 3600e3 }, { now }); assert.equal(r.ok, true, JSON.stringify(r));
  const base = { control: 'ruling', channel: 'cli', shownSha256: shown(f.d, r.gate.id), actor: 'tester', tty: true };
  const bad = await answerControl(f.d, r.gate.id, { ...base, decision: 'approved' }, { now });
  assert.deepEqual([bad.ok, bad.code], [false, 'gate_text_unreadable'], JSON.stringify(bad));
  assert.equal((await answerControl(f.d, r.gate.id, { ...base, decision: 'declined' }, { now })).ok, true);
});

test('RS-9a (the interface) a gate a PERSON asked for is not the session\'s to answer, whatever else is true of it: the ownership refusal comes before the stage refusal and nothing is recorded', async () => {
  const f = folder(); const id = ruling(f, 3, false);      // asked for by a person (no --relayed)
  stage(f.d, 3);                                           // and its pass already has a stage
  const before = ledger(f.d).length;
  const r = await answerControl(f.d, id, { control: 'ruling', channel: SESSION_CHANNEL, shownSha256: shown(f.d, id), reason: 'relayed', personWords: 'Yes, decide it that way' }, { now });
  assert.deepEqual([r.ok, r.code], [false, 'gate_not_session_requested'], JSON.stringify(r));
  assert.equal(ledger(f.d).length, before, 'nothing appended');
  assert.equal(readGateAnswer(f.d, id, { now }).status, 'pending');
});

test('RS-9b (the relay command, the sentence a person reads) the same order through `council relay-answer`: the ownership sentence, never the stage sentence; a gate the session asked for, with the same stage, still gets the stage sentence', () => {
  const f = folder(); const id = ruling(f, 3, false);
  stage(f.d, 3);
  const before = ledger(f.d).length;
  let errs = '';
  const code = relayCommand([basename(f.d), id], { work: f.base, personWords: 'Yes, decide it that way', stdout: { write: () => {} }, stderr: { write: s => { errs += s; } }, now });
  assert.equal(code, 1, errs);
  assert.match(errs, /gate g1 was asked for by a person: only the person answers it/);
  assert.doesNotMatch(errs, /already has a stage on disk/, 'the reason a person reads does not depend on timing');
  assert.equal(ledger(f.d).length, before, 'nothing appended');
  const g = ruling(f, 4, true); stage(f.d, 4);          // control: asked for by the session
  let errs2 = '';
  const code2 = relayCommand([basename(f.d), g], { work: f.base, personWords: 'Yes, decide it that way', stdout: { write: () => {} }, stderr: { write: s => { errs2 += s; } }, now });
  assert.equal(code2, 1, errs2);
  assert.match(errs2, /gate g2: pass 4 already has a stage on disk \(ldebate-4-l1\.md\), so a ruling for it would change what that stage was asked\. Nothing was recorded\./);
});
