// 0.8.4, S20 slice 1 (control 2: the typed spending limit can be raised at any resume; RU-S20-09 to 11, T19j; Mini-C&C's rulings G1 to G9 of 4 Nov 2026). Offline, $0.
// The ONE interface (src/run-controls.js): answerControl records an answer to a raise for the terminal, the window and the relay; controlHistory reads old and new total per cap from the ledger; raiseVerdict is the one rule
// for "can this answered raise be used"; raiseFlagRefusal refuses the flags before anything is written. Rows:
//   RC-1 T19j at run level, through the interface (a raise with no words, words without the figure, a figure nobody typed: refused, the stop stays, nothing recorded);  RC-2 each channel through the interface;
//   RC-3 not a raise gate / a figure with no typed or quoted source (the one red C&C named);  RC-4 controlHistory: old and new total per cap, set-aside answers not counted;  RC-5 G4 a session gate only for a raise;
//   RC-6 G5 an approved early raise is consumed by a plain resume (and set aside without a new screen);  RC-7 G6 one rule on every path (the interactive --raise-cap too; R3b at a stop unchanged);
//   RC-8 the channel vocabulary is the gate's own;  RC-9 raiseFlagRefusal table;  RC-10 the fence: the surfaces call the interface and the callers of the session channel are named;  RC-11 the refusals before any write (real CLI), RC-12 the report's raises[].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizeStart } from '../src/start-cap.js';
import { capScopeSha256, answerGate, readGateAnswer, PERSON_CHANNELS, SESSION_CHANNEL } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
// the module is loaded INSIDE each test that needs it, so a tree without src/run-controls.js fails those tests one by one (by construction) and the rows that do not need it still discriminate
let RC = null;
let RF = null;
let GATE = null;
const load = async () => { RC = await import('../src/run-controls.js'); RF = await import('../src/raise-flags.js'); GATE = await import('../src/gate.js'); };
import { reportJsonShape } from '../src/report-shape.js';
import { readLedger } from '../src/gate-ledger.js';
import { appendEvent } from '../src/gate.js';
import { awaitingUserCap } from '../src/run-status.js';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The gates these rows make expire 24 h after T0 (CAP_GATE_TTL_MS, src/start-cap.js) and the code under test reads the REAL clock (run-status.js, the spawned CLI): a fixed date in the past made RC-13 and RC-1b red once the day was over (box run of 08 Nov 2026: the gate had expired on 05 Nov). T0 is the real time at load.
const T0 = Date.now();
const now = () => T0;
const obj = { task_sha256: 'a'.repeat(64), chain_sha256: 'c'.repeat(64), seats: [], policy_sha256: null };
const sha = capScopeSha256(obj);
const call = (d, over = {}) => authorizeStart({ runDir: d, runId: 'run-1', resume: true, scopeSha256: sha, scope: obj, buildScreen: kind => `SCREEN ${kind}\n`, ceiling: { usd: 1000, source: 'COUNCIL_MAX_USD_LIMIT' }, interactive: false, ask: async () => 1, now, ...over });
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const shown = (d, id) => readGateAnswer(d, id, { now }).gate.sha256;
const hist = { spentUsd: 2, floorUsd: 2, unsettledUsd: 0, stopped: null };
const stoppedHist = { spentUsd: 10, floorUsd: 10, unsettledUsd: 0, stopped: { capUsd: 10, capName: null } };
const rawPerson = (d, id, typed) => answerGate(d, id, { channel: 'cli', shownSha256: shown(d, id), decision: 'approved', actor: 'tester', tty: true, typedCap: typed }, { now });
const asPerson = (d, id, typed, over = {}) => RC.answerControl(d, id, { control: 'raise', channel: 'cli', shownSha256: shown(d, id), decision: 'approved', actor: 'tester', tty: true, typedCap: typed, ...over }, { now });
const asRelay = (d, id, over = {}) => RC.answerControl(d, id, { control: 'raise', channel: 'session', shownSha256: shown(d, id), decision: 'approved', reason: 'relayed on the person\'s permission', personWords: 'Raise it to $30, please', typedCap: '30', ...over }, { now });
async function running() { const base = mkdtempSync(join(tmpdir(), 'rc-')); const d = join(base, 'run-1'); mkdirSync(d); await call(d, { resume: false }); assert.equal(answerGate(d, 'g1', { channel: 'cli', shownSha256: shown(d, 'g1'), decision: 'approved', actor: 'tester', tty: true, typedCap: '10' }, { now }).ok, true); assert.equal((await call(d, { resume: false })).status, 'authorized'); return d; }

test('RC-1 (T19j through the interface, library level) a run STOPPED at its limit: a relayed raise with no words, with words that lack the figure, or with no figure at all is refused through the interface; nothing is recorded and the run stays stopped', async () => {
  await load();
  const d = await running();
  const open = await call(d, { history: () => stoppedHist, forceRaise: true, relayed: true });
  assert.deepEqual([open.status, open.gate], ['pending', 'g2']);
  const before = ledger(d).length;
  for (const [over, code] of [[{ personWords: '' }, 'person_words_required'], [{ personWords: undefined }, 'person_words_required'], [{ personWords: 'Yes, raise it' }, 'person_words_total'], [{ typedCap: undefined }, 'figure_required']]) {
    const r = asRelay(d, 'g2', over);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.code, code, JSON.stringify(over));
  }
  assert.equal(ledger(d).length, before, 'nothing appended');
  const again = await call(d, { history: () => stoppedHist, forceRaise: true, relayed: true });
  assert.deepEqual([again.status, again.gate], ['pending', 'g2'], 'the run is still waiting at the same gate: not authorized');
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 1, 'no new limit was consumed');
});

test('RC-1b (T19j through the real `council relay-answer`; a control on this base, and the guard for #5) a stopped folder: a relay with no person-words, or with words that lack the figure, exits 1 and leaves the folder byte for byte as it was (the stop marker, the ledger, run.json)', async () => {
  const d = await running();
  assert.equal((await call(d, { history: () => stoppedHist, forceRaise: true, relayed: true })).gate, 'g2');
  writeFileSync(join(d, 'STOPPED-budget.json'), JSON.stringify({ stoppedBy: 'budget', capUsd: 10, spentUsd: 10 }));
  writeFileSync(join(d, 'run.json'), JSON.stringify({ id: 'run-1', maxUsd: 10 }));
  const before = snapshot(d);
  const ledgerLen = ledger(d).length;
  const run = args => spawnSync(process.execPath, [join(ROOT, 'src', 'cli.js'), 'relay-answer', d, 'g2', ...args], { cwd: tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() }, timeout: 60_000 });
  const none = run(['--total', '30']);
  assert.equal(none.status, 1, none.stdout + none.stderr);
  assert.match(none.stderr, /None were given\. Nothing was recorded\./);
  const lacking = run(['--total', '30', '--person-words', 'Yes, raise it']);
  assert.equal(lacking.status, 1, lacking.stdout + lacking.stderr);
  assert.match(lacking.stderr, /the total 30 does not appear in the person's words/);
  assert.deepEqual(snapshot(d), before, 'no file added, removed or changed (the ledger is gates/gate-ledger.jsonl or beside it: a folder entry shows as (folder); its bytes are compared below)');
  assert.equal(ledger(d).length, ledgerLen, 'the ledger has no new line');
});

test('RC-2 each surface records through the interface and the ledger says which: the terminal (cli), the window (elicitation, with the client\'s name) and the relay (session, with the person\'s words)', async () => {
  await load();
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(asPerson(d, 'g2', '20').ok, true);
  assert.equal((await call(d, { history: () => hist, forceRaise: true })).capUsd, 20);
  await call(d, { history: () => hist, forceRaise: true });
  const w = RC.answerControl(d, 'g3', { control: 'raise', channel: 'elicitation', shownSha256: shown(d, 'g3'), decision: 'approved', actor: 'Claude Code', tty: null, typedCap: '25', client: { name: 'Claude Code', version: '9.9' } }, { now });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal((await call(d, { history: () => hist, forceRaise: true })).capUsd, 25);
  await call(d, { history: () => hist, forceRaise: true, relayed: true });
  assert.equal(asRelay(d, 'g4').ok, true);
  assert.equal((await call(d, { history: () => hist, forceRaise: true, relayed: true })).capUsd, 30);
  const h = RC.controlHistory(d).raises.map(r => [r.gate, r.channel, r.actor, r.old_usd, r.new_usd, r.person_words, r.client_name, r.consumed]);
  assert.deepEqual(h, [['g2', 'cli', 'tester', 10, 20, null, null, true], ['g3', 'elicitation', 'Claude Code', 20, 25, null, 'Claude Code', true], ['g4', 'session', 'main-session', 25, 30, 'Raise it to $30, please', null, true]]);
});

test('RC-3 not a raise gate; a person channel takes no words; a figure with no typed or quoted source is refused (nothing recorded, no default)', async () => {
  await load();
  const d = await running();
  const before = ledger(d).length;
  const notRaise = RC.answerControl(d, 'g1', { control: 'raise', channel: 'cli', shownSha256: shown(d, 'g1'), typedCap: '12', actor: 't', tty: true }, { now });
  assert.deepEqual([notRaise.ok, notRaise.code], [false, 'not_a_raise_gate']);
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(RC.isRaiseGate(readGateAnswer(d, 'g2', { now }).gate), true);
  const bare = asPerson(d, 'g2', undefined);
  assert.deepEqual([bare.ok, bare.code], [false, 'figure_required']);
  assert.equal(asPerson(d, 'g2', '  ').ok, false, 'an empty figure typed by a person is gate.js\'s own refusal');
  assert.equal(asPerson(d, 'g2', '30', { personWords: 'Raise it to 30' }).code, 'person_words_not_for_person');
  assert.equal(asPerson(d, 'g2', '30', { channel: 'ui' }).code, 'channel_not_allowed');
  assert.equal(asRelay(d, 'g2', { decision: 'declined' }).code, 'session_cannot_decline');
  // CHANGED ACCEPTED LINE (S20 slice 2, step 3.1). OLD: control 'ruling' was an unknown control (unknown_control). NEW: it is a control of this interface (a ruling, a withdrawal or a re-tag): on a raise gate it answers not_a_ruling_gate, and a control that does not exist stays unknown_control.
  // WHY: rulings, withdrawals and re-tags are answered through the same interface now (test/run-controls-ruling.test.js).
  assert.equal(RC.answerControl(d, 'g2', { control: 'ruling', channel: 'cli' }, { now }).code, 'not_a_ruling_gate');
  assert.equal(RC.answerControl(d, 'g2', { control: 'pause', channel: 'cli' }, { now }).code, 'unknown_control');
  assert.equal(ledger(d).length, before + 1, 'only gate_requested for g2 was added; no answer was recorded');
});

test('RC-4 controlHistory: old and new total per cap from the ledger; an answer the run set aside is listed with consumed false; a first limit is not a raise', async () => {
  await load();
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(asPerson(d, 'g2', '8').ok, true);   // below the $10 limit in force: set aside by an early raise
  const set = await call(d, { history: () => hist, forceRaise: true });
  assert.equal(set.note.code, 'not_above_current');
  assert.equal(asPerson(d, 'g3', '40').ok, true);
  assert.equal((await call(d, { history: () => hist, forceRaise: true })).capUsd, 40);
  const rows = RC.controlHistory(d).raises;
  assert.deepEqual(rows.map(r => [r.gate, r.old_usd, r.new_usd, r.consumed]), [['g2', 10, 8, false], ['g3', 10, 40, true]]);
  assert.equal(rows.some(r => r.gate === 'g1'), false, 'the first limit is not a raise');
  assert.deepEqual(RC.controlHistory(mkdtempSync(join(tmpdir(), 'rc-none-'))).raises, []);
});

test('RC-5 (G4) --relayed asks a SESSION gate only for a raise: on a legacy resume or after a scope change the gate is the person\'s', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rc-g4-')); const legacy = join(base, 'run-1'); mkdirSync(legacy);
  const l = await call(legacy, { resume: true, relayed: true });   // no limit gate on record: operation resume_legacy
  assert.equal(l.status, 'pending');
  assert.equal(readGateAnswer(legacy, l.gate, { now }).gate.cap.operation, 'resume_legacy');
  assert.equal(ledger(legacy).find(x => x.event === 'gate_requested').requested_by, undefined, 'a person-requested gate: the relay step is not offered for it');
  const d = await running();
  const amended = await call(d, { history: () => hist, relayed: true, scopeSha256: capScopeSha256({ ...obj, task_sha256: 'b'.repeat(64) }) });
  assert.equal(readGateAnswer(d, amended.gate, { now }).gate.cap.operation, 'amend_scope');
  assert.equal(ledger(d).find(x => x.event === 'gate_requested' && x.gate === amended.gate).requested_by, undefined);
  const r = await running(); await call(r, { history: () => hist, forceRaise: true, relayed: true });
  assert.equal(ledger(r).find(x => x.event === 'gate_requested' && x.gate === 'g2').requested_by, 'session');
});

test('RC-6 (G5) an approved early raise is consumed by a plain --resume (it used to continue under the OLD limit and leave the approval unused); one that cannot be used leaves the run under its limit, says why, opens no new screen', async () => {
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(rawPerson(d, 'g2', '30').ok, true);
  const plain = await call(d, { history: () => hist });   // no forceRaise
  assert.deepEqual([plain.status, plain.capUsd, plain.operation, plain.via], ['authorized', 30, 'raise', 'answered']);
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').map(l => l.cap_micro_usd).join(','), '10000000,30000000');
  const e = await running();
  await call(e, { history: () => hist, forceRaise: true });
  assert.equal(rawPerson(e, 'g2', '8').ok, true);   // below the $10 limit in force
  const kept = await call(e, { history: () => hist });
  assert.deepEqual([kept.status, kept.capUsd, kept.via, kept.setAside?.code], ['authorized', 10, 'continued', 'not_above_current']);
  assert.equal(kept.setAside.reason, 'the limit typed for this run ($8.00) is not above the limit it has now ($10.00)');
  assert.equal(JSON.stringify(kept.setAside).includes('Nothing was started'), false, 'the run GOES ON, so the sentence does not say nothing was started');
  assert.equal(ledger(e).filter(l => l.event === 'gate_requested').length, 2, 'no new screen was opened by a plain resume');
});

test('RC-7 (G6) one rule on every path: an interactive --raise-cap that types a total at or below the limit in force is set aside like a reused one', async () => {
  const d = await running();
  const low = await call(d, { history: () => hist, forceRaise: true, interactive: true, ask: async (dir, id) => (rawPerson(dir, id, '8').ok ? 0 : 1) });
  assert.equal(low.status, 'pending');
  assert.equal(low.note.code, 'not_above_current');
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 1, 'nothing consumed');
});

test('RC-7c (R3b, a control: it holds on both trees) at a budget stop with NO --raise-cap a typed total above the counted spend but below the old limit is still consumed', async () => {
  const s = await running();
  const stopLow = { spentUsd: 6, floorUsd: 6, unsettledUsd: 0, stopped: { capUsd: 10, capName: null } };
  await call(s, { history: () => stopLow });
  assert.equal(rawPerson(s, 'g2', '8').ok, true);
  const got = await call(s, { history: () => stopLow });
  assert.deepEqual([got.capUsd, got.via], [8, 'answered']);
});

test('RC-7b the one rule itself (raiseVerdict): R3b, the ceiling and the counted spend, in one place', async () => {
  await load();
  assert.equal(RC.raiseVerdict({ answer: { cap_usd: 8, cap_micro_usd: 8e6 }, floorUsd: 2, previousCapUsd: 10, requireAboveCurrent: false }), null, 'R3b: not required above the old limit without --raise-cap');
  const v = RC.raiseVerdict({ answer: { cap_usd: 8, cap_micro_usd: 8e6 }, floorUsd: 2, previousCapUsd: 10, requireAboveCurrent: true });
  assert.equal(v.code, 'not_above_current');
  assert.equal(v.reason, 'the limit typed for this run ($8.00) is not above the limit it has now ($10.00)');
  assert.equal(v.message, `${v.reason}, so it was not used. Nothing was started.`, 'the sentence for a resume that WAITS, byte for byte as before');
});

// C&C's closing event (4 Nov 2026): an APPROVED raise that cannot be used is CLOSED in the record by THC's own determination. The approval line is never rewritten; the gate reads as used and not usable; the plain-resume re-print stops;
// run_status stops answering awaiting_user_cap for it; a ceiling that rises again never revives it.
test('RC-13 (plain resume) an approved early raise that is not above the limit is closed once: the run keeps its limit and says why once; the next plain resume is quiet; the gate is used up; run_status is not awaiting a limit; a new raise works', async () => {
  await load();
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(rawPerson(d, 'g2', '8').ok, true);
  assert.equal(awaitingUserCap(d)?.gate, 'g2', 'before the close the approved raise reads as waiting');
  const first = await call(d, { history: () => hist });
  assert.deepEqual([first.status, first.capUsd, first.via, first.setAside?.code], ['authorized', 10, 'continued', 'not_above_current']);
  const closings = ledger(d).filter(l => l.event === 'cap_raise_closed');
  assert.equal(closings.length, 1);
  assert.deepEqual([closings[0].gate, closings[0].by, closings[0].code, closings[0].cap_micro_usd], ['g2', 'harness', 'not_above_current', 8e6]);
  assert.match(closings[0].reason, /not above the limit it has now \(\$10\.00\)/);
  const again = await call(d, { history: () => hist });
  assert.deepEqual([again.status, again.via, again.setAside], ['authorized', 'continued', undefined], 'told once: the next plain resume is quiet');
  assert.equal(ledger(d).filter(l => l.event === 'cap_raise_closed').length, 1, 'closed once');
  const st = readGateAnswer(d, 'g2', { now });
  assert.deepEqual([st.status, st.used, st.usable], ['approved', true, false], 'the approval line stays; the gate is used up');
  assert.equal(awaitingUserCap(d), null, 'run_status is not waiting for a limit that was already answered and closed');
  assert.deepEqual(RC.controlHistory(d).raises.map(r => [r.gate, r.consumed, r.closed?.code]), [['g2', false, 'not_above_current']]);
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(rawPerson(d, 'g3', '30').ok, true);
  assert.equal((await call(d, { history: () => hist, forceRaise: true })).capUsd, 30);
  assert.equal(readLedger(d).ok, true, 'the chain verifies');
});

test('RC-13b a raise above the ceiling now in force is closed too: a ceiling that rises again does not revive it', async () => {
  await load();
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(rawPerson(d, 'g2', '30').ok, true);
  const low = await call(d, { history: () => hist, ceiling: { usd: 20, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.deepEqual([low.status, low.capUsd, low.setAside?.code], ['authorized', 10, 'above_ceiling_now']);
  const up = await call(d, { history: () => hist, ceiling: { usd: 1000, source: 'COUNCIL_MAX_USD_LIMIT' } });
  assert.deepEqual([up.status, up.capUsd, up.via, up.setAside], ['authorized', 10, 'continued', undefined], 'closed: never consumed afterwards');
  assert.equal(ledger(d).filter(l => l.event === 'cap_consumed').length, 1);
});

test('RC-14 (explicit --raise-cap) an approved raise that cannot be used is closed and a new screen asks: the order in the ledger is answer, closing, new request', async () => {
  await load();
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true });
  assert.equal(rawPerson(d, 'g2', '8').ok, true);
  const next = await call(d, { history: () => hist, forceRaise: true });
  assert.deepEqual([next.status, next.gate, next.note.code], ['pending', 'g3', 'not_above_current']);
  assert.match(next.note.message, /, so it was not used\. Nothing was started\.$/, 'the run WAITS here, so nothing was started is true');
  assert.deepEqual(ledger(d).slice(-3).map(l => [l.event, l.gate]), [['gate_answered', 'g2'], ['cap_raise_closed', 'g2'], ['gate_requested', 'g3']]);
});

test('RC-14b (interactive --raise-cap) a figure typed at the prompt that cannot be used is closed and a NEW gate waits: the wait names the new gate, never the closed one', async () => {
  await load();
  const d = await running();
  const p = await call(d, { history: () => hist, forceRaise: true, interactive: true, ask: async (dir, id) => { assert.equal(rawPerson(dir, id, '8').ok, true); return 0; } });
  assert.deepEqual([p.status, p.gate, p.note?.code], ['pending', 'g3', 'not_above_current']);
  assert.deepEqual(ledger(d).slice(-3).map(l => [l.event, l.gate]), [['gate_answered', 'g2'], ['cap_raise_closed', 'g2'], ['gate_requested', 'g3']]);
  assert.equal(readGateAnswer(d, 'g3', { now }).status, 'pending');
  assert.equal(readFileSync(join(d, 'cap-screen-3.md'), 'utf8'), 'SCREEN raise_early\n', 'the new gate has its own screen file (a number past the closed gate\'s)');
  assert.equal(readFileSync(join(d, 'cap-screen-2.md'), 'utf8'), 'SCREEN raise_early\n');
  assert.equal(readLedger(d).ok, true);
});

test('RC-15 the chain check and the writer of a closing event (subtests: each can fail alone)', async t => {
  await load();
  const rawAppend = (d, obj) => {
    const p = join(d, LEDGER_FILE); const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    appendFileSync(p, `${JSON.stringify({ schema: 'gate-ledger/1', seq: lines.length + 1, prev: createHash('sha256').update(lines.at(-1)).digest('hex'), ts: '2026-11-04T12:00:00.000Z', ...obj })}\n`);
  };
  const fresh = async () => { const d = await running(); await call(d, { history: () => hist, forceRaise: true }); assert.equal(rawPerson(d, 'g2', '8').ok, true); return d; };
  await t.test('(a) control: an unknown kind is refused by the chain check, before and after', async () => {
    const d = await fresh(); assert.equal(readLedger(d).ok, true);
    rawAppend(d, { event: 'cap_made_up', gate: 'g2' });
    assert.match(readLedger(d).reason, /unknown event "cap_made_up"/);
  });
  await t.test('(b) a closing event naming an approval that does not exist is refused', async () => {
    const d = await fresh();
    rawAppend(d, { event: 'cap_raise_closed', gate: 'g9', by: 'harness', code: 'below_floor', reason: 'x' });
    assert.match(readLedger(d).reason, /names gate "g9", which has no approval before it/);
  });
  await t.test('(c) a closing event not marked as the harness\'s own determination is refused', async () => {
    const d = await fresh();
    rawAppend(d, { event: 'cap_raise_closed', gate: 'g2', by: 'person', code: 'below_floor', reason: 'x' });
    assert.match(readLedger(d).reason, /not marked as the harness's own determination/);
  });
  await t.test('(d) the writer closes an approval once; the chain verifies; a second line for the gate is refused by the chain check', async () => {
    const d = await fresh();
    assert.equal(GATE.closeRaiseApproval(d, 'g2', { code: 'not_above_current', reason: 'the limit typed is not above the limit it has now' }, { now }).ok, true);
    assert.equal(readLedger(d).ok, true);
    assert.equal(GATE.closeRaiseApproval(d, 'g2', { code: 'below_floor', reason: 'r' }, { now }).ok, false, 'a gate is closed once (it is used up)');
    rawAppend(d, { event: 'cap_raise_closed', gate: 'g2', by: 'harness', code: 'below_floor', reason: 'y' });
    assert.match(readLedger(d).reason, /a second time/);
  });
  await t.test('(e) the writer refuses a gate that is not a raise, an unknown code, no reason; no module outside the gate writes the event', async () => {
    const d = await fresh();
    assert.equal(GATE.closeRaiseApproval(d, 'g1', { code: 'below_floor', reason: 'r' }, { now }).code, 'not_a_raise_gate');
    assert.equal(GATE.closeRaiseApproval(d, 'g2', { code: 'made_up', reason: 'r' }, { now }).code, 'bad_close_code');
    assert.equal(GATE.closeRaiseApproval(d, 'g2', { code: 'below_floor', reason: '  ' }, { now }).code, 'close_reason_required');
    assert.throws(() => appendEvent(d, 'cap_raise_closed', { gate: 'g2' }), /not an event this function writes/);
  });
});

test('RC-8 the channel vocabulary is the gate\'s own: what the history can carry is exactly the gate\'s person channels and the session channel (the pin is against src/gate.js, shared in kind with the excerpt record)', () => {
  assert.deepEqual([...PERSON_CHANNELS, SESSION_CHANNEL], ['cli', 'elicitation', 'session']);
});

test('RC-9 raiseFlagRefusal: before anything is written, the flags that cannot be honoured are refused in the prototype\'s own words; a raise goes alone', async () => {
  await load();
  const base = { argv: ['--resume', 'runs/x'], resumeMeta: { id: 'x' }, capsArmed: [], raiseCapId: null, stopCap: null, capGateApplies: true, capsRaiseUnknownSentence: (id, caps) => `unknown ${id} of ${caps}`, capsRaiseNameSentence: caps => `name one of ${caps}` };
  const r = (argv, over = {}) => RF.raiseFlagRefusal({ ...base, argv, ...over });
  assert.equal(r(['--resume', 'runs/x']), null);
  assert.equal(r(['--task', 't.md', '--raise-cap'], { resumeMeta: null }), '--raise-cap answers a paused run: use it with --resume <run folder>.');
  assert.equal(r(['--resume', 'x', '--relayed']), '--relayed goes with --raise-cap on a resume.');
  assert.equal(r(['--resume', 'x', '--raise-cap']), null);
  for (const f of ['--continue', '--finish', '--next-pass-layer-3']) assert.match(r(['--resume', 'x', '--raise-cap', f]), new RegExp(`^${f} cannot go with --raise-cap: a raise is asked for alone\\.`));
  assert.match(r(['--resume', 'x', '--raise-cap'], { capGateApplies: false }), /has no spending limit to raise/);
  assert.equal(r(['--resume', 'x', '--raise-cap'], { capsArmed: ['openrouter'], stopCap: 'openrouter' }), null);
  assert.equal(r(['--resume', 'x', '--raise-cap'], { capsArmed: ['openrouter'] }), 'name one of openrouter');
  assert.equal(r(['--resume', 'x', '--raise-cap', 'zzz'], { capsArmed: ['openrouter'], raiseCapId: 'zzz' }), 'unknown zzz of openrouter');
});

test('RC-9b raiseChoiceRefusal: a raise goes alone in ANY run state (it comes first, before the --continue / --finish refusals); the stray-word and the other raise refusals keep their old order after it', async () => {
  await load();
  assert.equal(RF.raiseChoiceRefusal({ argv: ['--resume', 'x', '--continue'] }), null, 'a round choice alone is not ours');
  assert.equal(RF.raiseChoiceRefusal({ argv: ['--resume', 'x', '--raise-cap'] }), null);
  assert.equal(RF.raiseChoiceRefusal({ argv: ['--resume', 'x', '--relayed', '--finish'] }), null, '--relayed alone is refused later by its own sentence, not by the name of a flag the person did not type');
  assert.match(RF.raiseChoiceRefusal({ argv: ['--resume', 'x', '--raise-cap', '--relayed', '--finish'] }), /^--finish cannot go with --raise-cap: a raise is asked for alone\./);
  assert.match(RF.raiseChoiceRefusal({ argv: ['--task', 't.md', '--raise-cap', '--next-pass-layer-3'] }), /^--next-pass-layer-3 cannot go with --raise-cap/, 'even on a start');
  // the old order: with the caps switch off, `--raise-cap openrouter` is a stray word and the stray-word refusal speaks first (test/caps-resume.test.js R5e): the combination check does not take that over
  assert.equal(RF.raiseChoiceRefusal({ argv: ['--resume', 'x', '--raise-cap', 'openrouter'] }), null);
});

test('RC-10 the fence: the surfaces record a raise answer through the interface; the callers of the session channel (the terminal relay and the MCP relay) are named; every other call of answerGate / answerGateAsRelay with a typed figure is the first-limit or amendment path, in a file that imports the interface', () => {
  const read = f => readFileSync(join(ROOT, 'src', f), 'utf8');
  for (const f of ['gate-cli.js', 'send-path.js', 'gate-relay-cli.js']) {
    const t = read(f);
    assert.match(t, /from '\.\/run-controls\.js'/, `${f} imports the interface`);
    assert.match(t, /answerControl\(/, `${f} calls it`);
  }
  assert.match(read('gate-cli.js'), /isRaiseGate\(state\.gate\)\s*\n\s*\? answerControl/, 'the terminal sends a raise gate to the interface');
  assert.match(read('send-path.js'), /isRaiseGate\(readGateAnswer\(runDir, gateId\)\?\.gate\)\s*\n\s*\? answerControl/, 'the window sends a raise gate to the interface');
  assert.match(read('gate-relay-cli.js'), /isRaiseGate\(state\.gate\)\s*\n\s*\? answerControl/, 'the relay sends a raise gate to the interface');
  const all = (dir => { const out = []; const walk = d => { for (const e of readdirSync(join(ROOT, 'src', d), { withFileTypes: true })) { const rel = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.js')) out.push(rel); } }; walk(dir); return out; })('');
  const named = all.filter(f => /\banswerGate(AsRelay)?\(/.test(read(f)) && /typedCap/.test(read(f))).sort();   // the whole src tree, src/mcp included: no module outside this list records a typed figure
  assert.deepEqual(named, ['gate-cli.js', 'gate-relay-cli.js', 'gate.js', 'run-controls.js', 'send-path.js']);
  // CHANGED ACCEPTED ROW (H10 fix-up, the PASS condition of 4 Nov 2026). OLD: the row named three surfaces and nothing named who may record a RELAYED raise. NEW: the modules that record a relayed raise (the session channel), through relayRaise or through answerControl with the session
  // channel, are exactly the terminal relay and the MCP relay (H10); run-controls.js itself defines and delegates. WHY: the MCP relay is a fourth caller, and a caller nobody names could record a raise as the session without being seen here.
  const SESSION_CALLERS = ['excerpt-resume.js', 'gate-relay-cli.js', 'mcp/server.js'];   // CHANGED ACCEPTED (0.8.4 D18, the text-request path): OLD two callers; NEW src/excerpt-resume.js is named too. WHY: it writes `channel: 'session'` into an EXCERPT record's approval of a decline by the handling session; that is no gate and no raise, but this fence is textual and cannot tell. It records no cap figure: the typedCap fence above still lists the only modules that record one
  const sessionCallers = all.filter(f => f !== 'run-controls.js' && f !== 'gate.js' && (/\brelayRaise\s*\(/.test(read(f)) || /\bchannel\s*:\s*(?:SESSION_CHANNEL\b|['"\x60]session['"\x60])/.test(read(f)))).sort();   // a textual fence, like R4: a caller that passes a shorthand `channel` variable would escape it
  assert.deepEqual(sessionCallers, SESSION_CALLERS, 'the callers that may record a relayed raise');
  assert.doesNotMatch(read('excerpt-resume.js'), /\b(?:relayRaise|answerControl|answerGate|answerGateAsRelay|typedCap)\b/, 'src/excerpt-resume.js records no raise and no gate answer: its `channel: session` belongs to an excerpt record (the exemption above covers nothing else)');
});

// The real CLI: the refusals of the raise flags happen BEFORE the run folder, the lock and run.json are written ("Nothing was recorded, run or spent" must be true). A free chain with an external critic pauses at exit 3 and needs no key.
const EXT = { name: 'rc-ext', signoff: 'unanimous', maxRounds: 2, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [{ provider: 'external', model: 'claude-code-session', lab: 'a' }] } };
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-cli-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'rc-ext.json'), JSON.stringify(EXT)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(ROOT, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
  return { dir, run };
};
const snapshot = runDir => Object.fromEntries(readdirSync(runDir).sort().map(f => { try { return [f, readFileSync(join(runDir, f), 'utf8')]; } catch { return [f, '(folder)']; } }));

test('RC-11a a start with --raise-cap is refused before any run folder exists', () => {
  const p = project();
  const r = p.run(['--chain', 'rc-ext', '--task', 'tasks/t.md', '--raise-cap']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--raise-cap answers a paused run: use it with --resume <run folder>\. Nothing was recorded, run or spent\./);
  assert.equal(existsSync(join(p.dir, 'runs')) ? readdirSync(join(p.dir, 'runs')).length : 0, 0, 'no run folder was made');
});
test('RC-11b a refused raise flag on a resume leaves the run folder byte for byte as it was (no run.json rewrite, no lock file left, no new file)', () => {
  const p = project();
  assert.equal(p.run(['--chain', 'rc-ext', '--task', 'tasks/t.md']).status, 3);
  const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
  const before = snapshot(runDir);
  const r = p.run(['--resume', runDir, '--relayed']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--relayed goes with --raise-cap on a resume\. Nothing was recorded, run or spent\./);
  assert.deepEqual(snapshot(runDir), before);
});
test('RC-11c (G3) --raise-cap goes alone: with --continue, --finish or --next-pass-layer-3 it is refused and the folder is untouched', () => {
  const p = project();
  assert.equal(p.run(['--chain', 'rc-ext', '--task', 'tasks/t.md']).status, 3);
  const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
  const before = snapshot(runDir);
  for (const f of ['--continue', '--finish', '--next-pass-layer-3']) {
    const r = p.run(['--resume', runDir, '--raise-cap', f]);
    assert.equal(r.status, 2, `${f}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`${f} cannot go with --raise-cap: a raise is asked for alone\\.`), f);
  }
  assert.deepEqual(snapshot(runDir), before);
});

test('RC-12 report.json carries `raises` (derived from the ledger, additive, validated against the published schema) when the result has the run\'s used raises, and no such key otherwise', async () => {
  await load();
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { runChain } = await import('../src/chain.js');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'schemas', 'report-v1.json'), 'utf8')));
  const seat = { provider: 'mock', model: 'mock-critic-script-o-rc12', lab: 'c' };
  const config = { name: 'rc12', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [seat] } };
  const result = await runChain({ request: 'Req.', config, log: () => {} });
  const d = await running();
  await call(d, { history: () => hist, forceRaise: true, relayed: true });
  assert.equal(asRelay(d, 'g2').ok, true);
  await call(d, { history: () => hist, forceRaise: true, relayed: true });
  const raises = RC.controlHistory(d).raises.filter(r => r.consumed);
  const without = reportJsonShape({ runId: 'x', chain: 'rc12', task: 't', result, config });
  assert.equal('raises' in without, false);
  const withRows = reportJsonShape({ runId: 'x', chain: 'rc12', task: 't', result: { ...result, raises }, config });
  assert.deepEqual(withRows.raises.map(r => [r.gate, r.channel, r.actor, r.old_usd, r.new_usd, r.person_words]), [['g2', 'session', 'main-session', 10, 30, 'Raise it to $30, please']]);
  assert.ok(validate(withRows), JSON.stringify(validate.errors, null, 2));
  // a malformed entry is refused by the published schema (the red for the schema row): no total, a channel that is not the gate's
  for (const bad of [{ ...raises[0], new_usd: undefined }, { ...raises[0], channel: 'web' }, { ...raises[0], requested_by: 'robot' }]) assert.equal(validate(reportJsonShape({ runId: 'x', chain: 'rc12', task: 't', result: { ...result, raises: [JSON.parse(JSON.stringify(bad))] }, config })), false, JSON.stringify(bad));
});
