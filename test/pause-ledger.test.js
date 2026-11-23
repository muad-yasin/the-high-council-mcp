// 0.8.4 S20 slice 2, #16c ("pause after this round"), step 1: the three ledger kinds `pause_requested`, `pause_taken` and `pause_lapsed`, their writers in src/gate.js, the chain check in src/gate-ledger.js and the reader pauseStateOf. Offline, $0.
// A request is the PERSON's or the HANDLER's ask that the RUNNING run stop before its next pass; `pause_taken` says the stop for it was resumed, `pause_lapsed` that it ended untaken. The R228 two-meanings shape: the person at the terminal (no words, no reason), the person
// relayed (his words and the relay sentence as the reason), the handler (its own free reason, at most 400 code points, never the relay sentence). The modules are used through a namespace import, so a tree without the new functions fails each row by TypeError (the file still loads);
// every chain row has its writer row beside it and a good half first.
//   PL-1 the person at the terminal;  PL-2 the person relayed;  PL-3 the handler;  PL-4 one untaken request at a time;  PL-5 taken and lapsed name a request, once;  PL-6 the kinds are not approvals and not public; the reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as gate from '../src/gate.js';
import * as ledger from '../src/gate-ledger.js';

const now = () => Date.parse('2026-11-04T12:00:00.000Z');
const dir = () => mkdtempSync(join(tmpdir(), 'pause-ledger-'));
const lines = d => readFileSync(join(d, ledger.LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const count = d => (existsSync(join(d, ledger.LEDGER_FILE)) ? lines(d).length : 0);
const rawAppend = (d, obj) => {
  const p = join(d, ledger.LEDGER_FILE); const have = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  appendFileSync(p, `${JSON.stringify({ schema: 'gate-ledger/1', seq: have.length + 1, prev: createHash('sha256').update(have.at(-1)).digest('hex'), ts: '2026-11-04T12:00:00.000Z', ...obj })}\n`);
};
const RELAY = ledger.RELAY_REASON;
const rawReq = (over = {}) => ({ event: 'pause_requested', pass: 1, by: 'person', channel: 'cli', person_words: null, reason: null, ...over });
const ask = (d, over = {}) => gate.recordPauseRequest(d, { pass: 1, by: 'person', channel: 'cli', ...over }, { now });
const settle = (d, event, requestSeq = 1) => gate.recordPauseSettled(d, { event, requestSeq }, { now });
const code = r => [r.ok, r.code];
const withRequest = () => { const d = dir(); assert.equal(ask(d).ok, true); assert.equal(ledger.readLedger(d).ok, true, 'control: the good request verifies'); return d; };
const rejected = (d, re) => { const v = ledger.readLedger(d); assert.equal(v.ok, false, 'the bad line is rejected'); assert.match(v.reason, re); };
const chainBad = (over, re) => { const d = dir(); rawAppend2(d, rawReq()); assert.equal(ledger.readLedger(d).ok, true, 'control: the good line verifies'); const e = dir(); rawAppend2(e, rawReq(over)); rejected(e, re); };
// the first line of a fresh ledger cannot be hand-appended with rawAppend (it needs a line before it): write it through a good request, then append the second candidate after it settled
function rawAppend2(d, obj) {
  assert.equal(ask(d, { pass: 9 }).ok, true);   // a first request (pass 9), taken, so the candidate is the next request
  assert.equal(settle(d, 'pause_taken', 1).ok, true);
  rawAppend(d, obj);
}

test('PL-1w the person at the terminal: one pause_requested line, marked as the person\'s, no words, no reason; words or a reason with it are refused and nothing is written', () => {
  const d = dir();
  const r = ask(d);
  assert.equal(r.ok, true); assert.equal(r.seq, 1);
  const l = lines(d)[0];
  assert.deepEqual({ event: l.event, pass: l.pass, by: l.by, channel: l.channel, person_words: l.person_words, reason: l.reason }, { event: 'pause_requested', pass: 1, by: 'person', channel: 'cli', person_words: null, reason: null });
  const e = dir();
  assert.deepEqual(code(ask(e, { personWords: 'Yes, pause it.' })), [false, 'person_words_not_for_terminal']);
  assert.deepEqual(code(ask(e, { reason: 'because' })), [false, 'pause_reason_not_for_person']);
  assert.equal(count(e), 0);
  for (const over of [{ pass: 0 }, { pass: 1.5 }, { by: 'robot' }, { channel: 'web' }]) assert.equal(ask(dir(), over).ok, false, JSON.stringify(over));
});
test('PL-1c the chain check rejects a hand-appended terminal request that carries words or a reason', () => {
  chainBad({ person_words: 'Yes, pause it.' }, /carries no relayed words/);
  chainBad({ reason: 'because' }, /carries no reason of its own/);
});

test('PL-2w the person relayed (channel session): his words are required and the relay sentence is the reason; without either it is refused', () => {
  const d = dir();
  assert.equal(ask(d, { channel: 'session', personWords: 'Please pause after this round.', reason: RELAY }).ok, true);
  const l = lines(d)[0];
  assert.deepEqual([l.by, l.channel, l.person_words, l.reason], ['person', 'session', 'Please pause after this round.', RELAY]);
  const e = dir();
  assert.deepEqual(code(ask(e, { channel: 'session', reason: RELAY })), [false, 'person_words_required']);
  assert.deepEqual(code(ask(e, { channel: 'session', personWords: '   ', reason: RELAY })), [false, 'person_words_required']);
  assert.deepEqual(code(ask(e, { channel: 'session', personWords: 'Pause.', reason: 'a free reason' })), [false, 'pause_reason_not_relay']);
  assert.equal(count(e), 0);
});
test('PL-2c the chain check rejects a hand-appended relayed request without his words, or with a free reason', () => {
  chainBad({ channel: 'session', person_words: null, reason: RELAY }, /carries the person's words/);
  chainBad({ channel: 'session', person_words: 'Pause.', reason: 'a free reason' }, /carries the relay sentence as its reason/);
});

test('PL-3w the handler\'s own request: a free reason of at most 400 code points, never the relay sentence, no words', () => {
  const d = dir();
  assert.equal(ask(d, { by: 'handler', reason: 'x'.repeat(400) }).ok, true, 'control: 400 characters fit');
  const e = dir();
  assert.deepEqual(code(ask(e, { by: 'handler', reason: 'x'.repeat(401) })), [false, 'route_reason_too_long']);
  assert.deepEqual(code(ask(e, { by: 'handler', reason: RELAY })), [false, 'route_reason_relay_for_handler']);
  assert.deepEqual(code(ask(e, { by: 'handler' })), [false, 'pause_reason_required']);
  assert.deepEqual(code(ask(e, { by: 'handler', reason: 'ready', personWords: 'Yes.' })), [false, 'person_words_not_for_handler']);
  assert.equal(count(e), 0);
});
test('PL-3c the chain check rejects the same lines hand-appended', () => {
  chainBad({ by: 'handler', reason: 'x'.repeat(401) }, /at most 400 characters \(this one has 401\)/);
  chainBad({ by: 'handler', reason: RELAY }, /the relay sentence is only for a request that is the person's/);
  chainBad({ by: 'handler', reason: null }, /carries its reason/);
});

test('PL-4 one untaken request at a time (a writer refusal that writes nothing); after pause_taken or pause_lapsed a new request is recorded', () => {
  const d = withRequest();
  assert.deepEqual(code(ask(d)), [false, 'pause_request_open']);
  assert.equal(count(d), 1);
  assert.equal(settle(d, 'pause_taken', 1).ok, true);
  assert.equal(ask(d).ok, true, 'after taken');
  assert.deepEqual(code(ask(d)), [false, 'pause_request_open']);
  assert.equal(settle(d, 'pause_lapsed', 3).ok, true);
  assert.equal(ask(d).ok, true, 'after lapsed');
  assert.equal(ledger.readLedger(d).ok, true);
});

test('PL-5w taken and lapsed name an earlier pause request, once: unknown, a line that is not a pause request, and a second settlement are refused', () => {
  const d = withRequest();
  assert.deepEqual(code(settle(d, 'pause_taken', 7)), [false, 'pause_request_not_found']);
  assert.deepEqual(code(settle(d, 'pause_taken', 'one')), [false, 'pause_request_not_found']);
  assert.deepEqual(code(gate.recordPauseSettled(d, { event: 'sent', requestSeq: 1 }, { now })), [false, 'pause_event_invalid']);
  assert.equal(settle(d, 'pause_lapsed', 1).ok, true);
  assert.deepEqual(code(settle(d, 'pause_taken', 1)), [false, 'pause_request_settled']);
  assert.deepEqual(code(settle(d, 'pause_lapsed', 1)), [false, 'pause_request_settled']);
  assert.equal(count(d), 2);
});
test('PL-5c the chain check rejects the same lines hand-appended', () => {
  const d = withRequest(); rawAppend(d, { event: 'pause_taken', request_seq: 7 });
  rejected(d, /request 7 is not a pause request/);
  const e = withRequest(); rawAppend(e, { event: 'pause_taken', request_seq: 1 }); assert.equal(ledger.readLedger(e).ok, true, 'control: one settlement verifies');
  rawAppend(e, { event: 'pause_lapsed', request_seq: 1 }); rejected(e, /was already taken or lapsed/);
});

test('PL-6 not an approval and not public: the kinds are in the closed list only, appendEvent refuses them, and the readers of routes, rulings and raises do not move when pause lines exist; pauseStateOf lists every request with its settlement', () => {
  for (const k of ['pause_requested', 'pause_taken', 'pause_lapsed']) { assert.ok(ledger.EVENTS.includes(k), k); assert.throws(() => ledger.appendEvent(dir(), k, { pass: 1 }), /not an event this function writes/, k); }
  assert.deepEqual([...ledger.PUBLIC_EVENTS].sort(), ['amend_requested', 'more_material_requested', 'sent', 'stopped']);
  const d = dir();
  assert.equal(gate.requestRuling(d, { pass: 3, text: 'Use black tea.' }, { now }).ok, true);
  const readers = () => JSON.stringify([gate.rulingsOf(d, { now }), gate.raiseAnswersOf(d), gate.listGates(d, { now }), gate.routeControlsOf(d)]);
  const before = readers();
  assert.equal(ask(d).ok, true); assert.equal(settle(d, 'pause_taken', 2).ok, true); assert.equal(ask(d).ok, true);
  assert.equal(lines(d).filter(l => l.event.startsWith('pause_')).length, 3, 'control: the pause lines are really in the ledger');
  assert.equal(readers(), before);
  const s = gate.pauseStateOf(d);
  assert.equal(s.ok, true);
  assert.deepEqual(s.requests.map(r => [r.seq, r.pass, r.by, !!r.taken, !!r.lapsed]), [[2, 1, 'person', true, false], [4, 1, 'person', false, false]]);
  assert.equal(s.untaken.seq, 4);
  assert.deepEqual(gate.pauseStateOf(dir()), { ok: true, requests: [], untaken: null }, 'a missing ledger is an empty one');
});
