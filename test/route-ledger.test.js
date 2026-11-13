// 0.8.4 S20 slice 2, control 1 (routing the next pass to layer 3), step R1: the two ledger kinds `route_requested` and `route_decided` (Mini-C&C's rulings R176 and R179), their two writers in src/gate.js, the chain check in src/gate-ledger.js and the reader
// routeControlsOf. Offline, $0. A request is the PERSON's ask; a decision is the HANDLER's (routed or declined, always with its reason) or the PERSON's carried out by the handler (only with his words). Neither is an approval of a gate.
// The modules are used through a namespace import, so a tree without the new functions fails each row by TypeError (the file still loads) and every VERIFIER row carries its own control: a well-formed line is read as ok, and only then is the bad one rejected by name.
//   RL-1 a person's request at the terminal;  RL-2 the session channel needs his words, stored byte for byte;  RL-3 one open request per pass (a writer refusal);  RL-4 a reason on every handler decision, never "approved";  RL-5 the handler's own route, one routed decision per pass;
//   RL-6 a decision that is the person's needs his words and carries the relay sentence;  RL-7 a decision names a request that is there, once;  RL-8 the reader (an undecided request is never dropped);  RL-9 neither kind is an approval, so the readers of approvals do not move;  RL-10 the kinds are not public.
// R1 FIX-UP (R226, R228): the two meanings of a decision's `reason`. RL-11a/b/c are one pair of rows each, WRITER and CHAIN (a line appended around the writer), so a tree that lacks a rule fails each of the six on its own and no failing assertion hides another; every row has its good half first.
//   RL-11a a handler reason is kept whole up to 400 characters and refused above it, never cut;  RL-11b a decision that is the person's carries the relay sentence;  RL-11c a decision that is the handler's own never carries it;  RL-12 the relay sentence has one home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as gate from '../src/gate.js';
import * as ledger from '../src/gate-ledger.js';
import * as runControls from '../src/run-controls.js';

const now = () => Date.parse('2026-11-04T12:00:00.000Z');
const dir = () => mkdtempSync(join(tmpdir(), 'route-ledger-'));
const lines = d => readFileSync(join(d, ledger.LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const count = d => (existsSync(join(d, ledger.LEDGER_FILE)) ? lines(d).length : 0);
// a line appended AROUND the writer (correct chain, so only the route checks can reject it)
const rawAppend = (d, obj) => {
  const p = join(d, ledger.LEDGER_FILE); const have = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  appendFileSync(p, `${JSON.stringify({ schema: 'gate-ledger/1', seq: have.length + 1, prev: createHash('sha256').update(have.at(-1)).digest('hex'), ts: '2026-11-04T12:00:00.000Z', ...obj })}\n`);
};
const rawReq = (over = {}) => ({ event: 'route_requested', pass: 2, floor: 3, by: 'person', channel: 'cli', person_words: null, ...over });
const rawDec = (over = {}) => ({ event: 'route_decided', request_seq: 1, pass: 2, floor: 3, decision: 'routed', by: 'handler', decided_by: 'handler', person_words: null, reason: 'the plan is ready for the overseer', ...over });
const request = (d, over = {}) => gate.recordRouteRequest(d, { pass: 2, channel: 'cli', ...over }, { now });
const decide = (d, over = {}) => gate.recordRouteDecision(d, { requestSeq: 1, pass: 2, decision: 'routed', decidedBy: 'handler', reason: 'the plan is ready for the overseer', ...over }, { now });
const code = r => [r.ok, r.code];
// a ledger that holds one request (seq 1): the base the bad halves of the verifier rows are appended to
const withRequest = () => { const d = dir(); assert.equal(request(d).ok, true); assert.equal(ledger.readLedger(d).ok, true, 'control: the good request verifies'); return d; };
const rejected = (d, re) => { const v = ledger.readLedger(d); assert.equal(v.ok, false, 'the bad line is rejected'); assert.match(v.reason, re); };

test('RL-1 a person\'s request at the terminal is one route_requested line, marked as the person\'s, and the chain verifies', () => {
  const d = dir();
  const r = request(d);
  assert.deepEqual([r.ok, r.seq], [true, 1]);
  const l = lines(d)[0];
  assert.deepEqual({ event: l.event, pass: l.pass, floor: l.floor, by: l.by, channel: l.channel, person_words: l.person_words }, { event: 'route_requested', pass: 2, floor: 3, by: 'person', channel: 'cli', person_words: null });
  assert.equal(ledger.readLedger(d).ok, true);
  // the bad half: a line not marked as the person's, a pass that is not a number, a floor other than 3
  for (const [over, re] of [[{ by: 'handler' }, /marked as the person's/], [{ pass: 'two' }, /names the pass it is for/], [{ floor: 2 }, /asks for layer 3/]]) {
    const e = withRequest(); rawAppend(e, rawReq({ pass: 3, ...over })); rejected(e, re);
  }
});

test('RL-2 on the session channel the request needs his words (blank is none), stores them byte for byte; any other channel is refused; the terminal carries none', () => {
  const d = dir();
  assert.deepEqual(code(request(d, { channel: 'session' })), [false, 'person_words_required']);
  assert.deepEqual(code(request(d, { channel: 'session', personWords: '  \n ' })), [false, 'person_words_required']);
  assert.deepEqual(code(request(d, { channel: 'elicitation' })), [false, 'channel_not_allowed']);
  assert.deepEqual(code(request(d, { channel: 'cli', personWords: 'yes' })), [false, 'person_words_not_for_terminal']);
  assert.equal(count(d), 0, 'a refusal writes nothing');
  const words = 'Yes,\n  go to layer 3 ';
  assert.equal(request(d, { channel: 'session', personWords: words }).ok, true);
  assert.equal(lines(d)[0].person_words, words, 'byte for byte, nothing trimmed');
  assert.equal(ledger.readLedger(d).ok, true);
  // the bad halves, hand-appended: a session request with no words, a channel nobody may use
  for (const [over, re] of [[{ channel: 'session', person_words: null }, /carries the person's words/], [{ channel: 'elicitation' }, /terminal \(cli\) or the handler's relay/]]) {
    const e = withRequest(); rawAppend(e, rawReq({ pass: 3, ...over })); rejected(e, re);
  }
});

test('RL-3 one OPEN request per pass is a writer refusal that writes nothing; after a decline the same pass may be asked again; a routed pass takes no request', () => {
  const d = dir();
  assert.equal(request(d).seq, 1);
  assert.deepEqual(code(request(d)), [false, 'route_request_open']);
  assert.equal(count(d), 1);
  assert.equal(request(d, { pass: 3 }).ok, true, 'another pass is its own request');
  assert.equal(decide(d, { requestSeq: 1, decision: 'declined', reason: 'the plan is not ready for layer 3' }).ok, true);
  const again = request(d);
  assert.deepEqual([again.ok, again.seq], [true, 4], 'after a decline the same pass may be asked again (so the refusal is about OPEN requests)');
  assert.equal(decide(d, { requestSeq: 4 }).ok, true);
  assert.deepEqual(code(request(d)), [false, 'route_pass_routed']);
  assert.equal(ledger.readLedger(d).ok, true, 'a second open request is not corruption: the chain check does not look for it');
  const e = withRequest(); rawAppend(e, rawReq()); assert.equal(ledger.readLedger(e).ok, true, 'control: two open requests for one pass still verify');
});

test('RL-4 every handler decision carries its reason (routed and declined alike); a decision is routed or declined, never approved; the chain rejects the same lines hand-appended', () => {
  const d = dir(); assert.equal(request(d).ok, true);
  for (const decision of ['routed', 'declined']) for (const reason of [undefined, '', '   ']) assert.deepEqual(code(decide(d, { decision, reason })), [false, 'route_reason_required'], `${decision} with ${JSON.stringify(reason)}`);
  assert.deepEqual(code(decide(d, { decision: 'approved' })), [false, 'route_decision_invalid']);
  assert.equal(count(d), 1, 'nothing was written by a refusal');
  assert.equal(decide(d).ok, true);
  assert.equal(ledger.readLedger(d).ok, true);
  assert.equal(lines(d)[1].by, 'handler');
  for (const [over, re] of [[{ reason: '' }, /carries its reason/], [{ decision: 'approved' }, /routed or declined/], [{ by: 'person' }, /recorded by the handler session/]]) {
    const e = withRequest(); rawAppend(e, rawDec(over)); rejected(e, re);
  }
});

test('RL-5 the handler\'s own route (no request) is allowed with its pass and reason; only a route can be decided that way; a pass is routed once', () => {
  const d = dir();
  const own = decide(d, { requestSeq: null, pass: 3 });
  assert.deepEqual([own.ok, own.seq], [true, 1]);
  assert.equal(lines(d)[0].request_seq, null);
  assert.equal(ledger.readLedger(d).ok, true);
  assert.deepEqual(code(decide(d, { requestSeq: null, pass: 3 })), [false, 'route_pass_routed']);
  assert.deepEqual(code(decide(d, { requestSeq: null, pass: 4, decision: 'declined' })), [false, 'route_decline_needs_request']);
  assert.equal(count(d), 1);
  const e = dir(); assert.equal(decide(e, { requestSeq: null, pass: 3 }).ok, true); assert.equal(ledger.readLedger(e).ok, true, 'control: one route for pass 3 verifies');
  rawAppend(e, rawDec({ request_seq: null, pass: 3 })); rejected(e, /already routed to layer 3/);
  const f = dir(); assert.equal(request(f).ok, true); rawAppend(f, rawDec({ request_seq: null, pass: 4, decision: 'declined' })); rejected(f, /only a request can be declined/);
  // a route with no request is for a pass nobody asked about: while a person's request for the pass waits, the handler decides THAT request (R176: either outcome references the request entry)
  const g = dir(); assert.equal(request(g, { pass: 5 }).seq, 1);
  const bypass = decide(g, { requestSeq: null, pass: 5 });
  assert.deepEqual(code(bypass), [false, 'route_request_open']); assert.match(bypass.message, /\(request 1\) waits for its decision/);
  assert.equal(count(g), 1, 'nothing was written');
  assert.equal(decide(g, { requestSeq: 1, pass: 5 }).ok, true, 'control: deciding the request itself is fine');
  const h = dir(); assert.equal(request(h, { pass: 5 }).ok, true); rawAppend(h, rawDec({ request_seq: null, pass: 5 })); assert.equal(ledger.readLedger(h).ok, true, 'the chain check does not look for it: a writer refusal, not corruption');
});

test('RL-6 a decision that is the PERSON\'s needs his words (writer refuses, chain rejects), carries the relay sentence as its reason, and a handler\'s own decision carries none', () => {
  const d = dir(); assert.equal(request(d).ok, true);
  assert.deepEqual(code(decide(d, { decidedBy: 'person', reason: 'relayed' })), [false, 'person_words_required']);
  assert.deepEqual(code(decide(d, { decidedBy: 'person', personWords: '   ', reason: 'relayed' })), [false, 'person_words_required']);
  assert.deepEqual(code(decide(d, { decidedBy: 'handler', personWords: 'yes' })), [false, 'person_words_not_for_handler']);
  assert.deepEqual(code(decide(d, { decidedBy: 'nobody' })), [false, 'route_decider_invalid']);
  assert.equal(count(d), 1);
  const sentence = 'relayed by the handler session on the person\'s permission, as the session states it; the person\'s words, as the session gave them, are in person_words';
  const words = 'Yes, route it to layer 3.';
  assert.equal(decide(d, { decidedBy: 'person', personWords: words, reason: sentence }).ok, true);
  assert.equal(ledger.readLedger(d).ok, true);
  const row = gate.routeControlsOf(d).controls[0].decision;
  assert.deepEqual([row.decided_by, row.person_words, row.reason], ['person', words, sentence], 'the trust sentence is on the line, where the reader sees it');
  for (const [over, re] of [[{ decided_by: 'person', person_words: null }, /carries the person's words/], [{ decided_by: 'handler', person_words: 'yes' }, /carries no person's words/]]) {
    const e = withRequest(); rawAppend(e, rawDec(over)); rejected(e, re);
  }
});

test('RL-7 a decision names a route request that is there, for the same pass, and decides it once', () => {
  const d = dir(); assert.equal(request(d).ok, true);
  assert.deepEqual(code(decide(d, { requestSeq: 5 })), [false, 'route_request_not_found']);
  assert.deepEqual(code(decide(d, { requestSeq: 'one' })), [false, 'route_request_not_found']);
  assert.deepEqual(code(decide(d, { requestSeq: 1, pass: 3 })), [false, 'route_pass_mismatch']);
  assert.equal(decide(d, { decision: 'declined', reason: 'not now' }).seq, 2);
  assert.deepEqual(code(decide(d, { decision: 'declined', reason: 'again' })), [false, 'route_already_decided']);
  assert.deepEqual(code(decide(d, { requestSeq: 2, decision: 'declined', reason: 'a decision is not a request' })), [false, 'route_request_not_found']);
  assert.equal(count(d), 2);
  assert.equal(ledger.readLedger(d).ok, true);
  for (const [over, re] of [[{ request_seq: 9 }, /not a route request/], [{ pass: 5 }, /is for pass 2, not pass 5/]]) {
    const e = withRequest(); rawAppend(e, rawDec(over)); rejected(e, re);
  }
  const f = withRequest(); rawAppend(f, rawDec({ decision: 'declined', reason: 'no' })); assert.equal(ledger.readLedger(f).ok, true, 'control: one decision verifies');
  rawAppend(f, rawDec({ decision: 'declined', reason: 'no, again' })); rejected(f, /was already decided/);
});

test('RL-8 the reader lists requests and decisions in the ledger\'s order; an undecided request stays listed (also when its pass has stages); an unreadable ledger reads as not ok', () => {
  const d = dir();
  assert.equal(request(d).seq, 1); assert.equal(decide(d).seq, 2);                         // pass 2: asked, then routed
  assert.equal(request(d, { pass: 3 }).seq, 3);                                            // pass 3: asked, undecided
  assert.equal(decide(d, { requestSeq: null, pass: 4 }).seq, 4);                           // pass 4: the handler's own route
  const shape = c => c.controls.map(x => [x.pass, x.request?.seq ?? null, x.decision?.seq ?? null]);
  assert.deepEqual(shape(gate.routeControlsOf(d)), [[2, 1, 2], [3, 3, null], [4, null, 4]]);
  writeFileSync(join(d, 'panel-3-l1.md'), 'a stage of pass 3 is on disk now');
  assert.deepEqual(shape(gate.routeControlsOf(d)), [[2, 1, 2], [3, 3, null], [4, null, 4]], 'nothing closes a request but a decision');
  const first = gate.routeControlsOf(d).controls[0];
  assert.deepEqual([first.request.channel, first.request.person_words, first.decision.decision, first.decision.decided_by], ['cli', null, 'routed', 'handler']);
  writeFileSync(join(d, ledger.LEDGER_FILE), 'not a ledger\n');
  assert.deepEqual(gate.routeControlsOf(d), { ok: false, controls: [] });
});

test('RL-9 neither kind is an approval: the readers of rulings, raises and gates do not move when route lines are added', () => {
  const d = dir();
  assert.equal(gate.requestRuling(d, { pass: 3, text: 'Use black tea.' }, { now }).ok, true);
  const readers = () => JSON.stringify([gate.rulingsOf(d, { now }), gate.raiseAnswersOf(d), gate.listGates(d, { now })]);
  const before = readers();
  assert.equal(request(d).ok, true); assert.equal(decide(d, { requestSeq: 2 }).ok, true);
  assert.equal(lines(d).filter(l => l.event.startsWith('route_')).length, 2, 'control: the route lines are really in the ledger');
  assert.equal(readers(), before);
  assert.equal(gate.rulingsOf(d, { now }).pending.length, 1, 'and the ruling still waits for its answer');
  assert.equal(lines(d).some(l => l.event === 'gate_answered'), false, 'no gate was answered by a route line');
});

test('RL-10 the kinds are written only by src/gate.js: both are in the closed event list and neither is public', () => {
  assert.ok(ledger.EVENTS.includes('route_requested') && ledger.EVENTS.includes('route_decided'));
  assert.deepEqual([...ledger.PUBLIC_EVENTS].sort(), ['amend_requested', 'more_material_requested', 'sent', 'stopped']);
  assert.throws(() => ledger.appendEvent(dir(), 'route_requested', { pass: 2 }), /not an event this function writes/);
  assert.throws(() => ledger.appendEvent(dir(), 'route_decided', { pass: 2 }), /not an event this function writes/);
});

// ---- R1 fix-up (R226, R228): the two meanings of a decision's reason ----
const longReason = n => 'r'.repeat(n);
const SAID = 'Yes, route it to layer 3.';

test('RL-11a-writer a handler reason of 400 characters is kept whole; one of 401 is refused by name, nothing is written and nothing is cut', () => {
  const d = withRequest();
  assert.equal(decide(d, { reason: longReason(400) }).ok, true, 'control: 400 characters fit');
  assert.equal(lines(d).at(-1).reason.length, 400, 'and are kept whole');
  const e = withRequest();
  assert.deepEqual(code(decide(e, { reason: longReason(401) })), [false, 'route_reason_too_long']);
  assert.equal(count(e), 1, 'nothing was written');
  assert.equal(lines(e).some(l => l.event === 'route_decided'), false, 'and no cut copy of the reason is in the record');
});

test('RL-11a-chain a hand-appended handler reason of 401 characters is rejected by the chain check, 400 verifies', () => {
  const f = withRequest(); rawAppend(f, rawDec({ reason: longReason(400) }));
  assert.equal(ledger.readLedger(f).ok, true, 'control: 400 characters verify');
  const g = withRequest(); rawAppend(g, rawDec({ reason: longReason(401) }));
  rejected(g, /at most 400 characters \(this one has 401\)/);
});

test('RL-11b-writer a decision that is the person\'s is written with the relay sentence; a free reason is refused by name and nothing is written', () => {
  const d = withRequest();
  assert.equal(decide(d, { decidedBy: 'person', personWords: SAID, reason: runControls.RELAY_REASON }).ok, true, 'control: the relay sentence is accepted');
  const e = withRequest();
  assert.deepEqual(code(decide(e, { decidedBy: 'person', personWords: SAID, reason: 'the person said yes' })), [false, 'route_reason_not_relay']);
  assert.equal(count(e), 1, 'nothing was written');
});

test('RL-11b-chain a hand-appended decision that is the person\'s with a free reason is rejected by the chain check, with the relay sentence it verifies', () => {
  const f = withRequest(); rawAppend(f, rawDec({ decided_by: 'person', person_words: SAID, reason: runControls.RELAY_REASON }));
  assert.equal(ledger.readLedger(f).ok, true, 'control: the relay sentence verifies');
  const g = withRequest(); rawAppend(g, rawDec({ decided_by: 'person', person_words: SAID, reason: 'the person said yes' }));
  rejected(g, /carries the relay sentence as its reason/);
});

test('RL-11c-writer a decision that is the handler\'s own is written with its own reason; the relay sentence as its reason is refused by name and nothing is written', () => {
  const d = withRequest();
  assert.equal(decide(d, { reason: 'the plan is ready for the overseer' }).ok, true, 'control: a free reason is accepted');
  const e = withRequest();
  assert.deepEqual(code(decide(e, { reason: runControls.RELAY_REASON })), [false, 'route_reason_relay_for_handler']);
  assert.equal(count(e), 1, 'nothing was written');
});

test('RL-11c-chain a hand-appended decision that is the handler\'s own with the relay sentence as its reason is rejected by the chain check, a free reason verifies', () => {
  const f = withRequest(); rawAppend(f, rawDec({ reason: 'the plan is ready for the overseer' }));
  assert.equal(ledger.readLedger(f).ok, true, 'control: a free reason verifies');
  const g = withRequest(); rawAppend(g, rawDec({ reason: runControls.RELAY_REASON }));
  rejected(g, /the relay sentence is only for a decision that is the person's/);
});

test('RL-12 the relay sentence has one home: src/gate-ledger.js defines it, src/run-controls.js re-exports the same value, and no other file under src/ carries it', () => {
  const literal = 'relayed by the handler session on the person\'s permission, as the session states it; the person\'s words, as the session gave them, are in person_words';
  assert.equal(ledger.RELAY_REASON, literal, 'the sentence is pinned here');
  assert.equal(runControls.RELAY_REASON, ledger.RELAY_REASON, 'the interface re-exports the same value');
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const holders = readdirSync(srcDir, { recursive: true }).filter(f => f.endsWith('.js') && readFileSync(join(srcDir, f), 'utf8').includes('as the session states it')).sort();
  assert.deepEqual(holders, ['gate-ledger.js'], 'exactly one file under src/ holds the sentence');
});
