// 0.8.4 S20 slice 2, R2-tty (Mini-C&C R417, R418, R419, R420): the bare `--next-pass-layer-3` is the PERSON'S request and is recorded (channel cli) only when stdin and stdout are both a terminal, read off the streams given and never off a setting
// (as `council gate answer` and `council pause` do); the handler session relays the person's request with `--person-words`, recorded on the channel session with the words as given. The relay sentence is DERIVED at report time from the channel alone
// (a route request line has no reason of its own). The tty rule is a function taking { stdin, stdout }, so it is tested in process with scripted streams; the real-flag rows are in test/route-controls.test.js (RT-14..RT-16). Offline, $0.
// The modules are used through NAMESPACE imports, so a tree without askRoute still LOADS this file and each row fails on its own by TypeError.
//   RTT-1 the terminal rule;  RTT-2 the relayed form and its line under the ledger's own check;  RTT-3 the relay sentence is derived from the channel alone;  RTT-4 a missing, empty or whitespace-only value is refused by the flag's name, before any write;  RTT-5 the goes-alone rule is widened by --person-words and its value only;  RTT-6 --person-words with no route flag is refused, not dropped. (The settle-before-flush row is SM-4b in test/owner-pause-seam.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rc from '../src/run-controls.js';
import * as gate from '../src/gate.js';
import * as stopFiles from '../src/stop-files.js';
import * as raiseFlags from '../src/raise-flags.js';
import { routeLineProblem } from '../src/gate-ledger.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const now = () => Date.parse('2026-11-04T12:00:00.000Z');
const critics = [
  { provider: 'mock', model: 'mock-critic-script-x-rt1', lab: 'l1', layer: 1 },
  { provider: 'mock', model: 'mock-critic-script-x-rt2', lab: 'l2', layer: 2 },
  { provider: 'mock', model: 'mock-critic-script-o-rt3', lab: 'l3', layer: 3 }];
const config = { name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics } };
const ladder = { credit: 1 };
const sink = (isTTY = false) => ({ isTTY, write() {} });
const terminal = () => ({ stdin: { isTTY: true }, stdout: sink(true) });   // the person at a keyboard
// a run stopped at the owner's pause after pass 1 (layer 1 objected): the route flag is allowed for pass 2, no run lock is held
const pausedRun = () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-tty-'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'lad', task: 'tasks/t.md', ladder }));
  for (const f of ['panel-1-l1.md', 'critique-1.md', 'revise-1.md']) writeFileSync(join(dir, f), 'x\n');
  const r = gate.recordPauseRequest(dir, { pass: 1, by: 'person', channel: 'cli' }, { now });
  assert.equal(r.ok, true, JSON.stringify(r));
  stopFiles.writeStoppedMarker(dir, { stoppedBy: 'owner_pause', beforeFirstCall: false, spentUsd: 0, resumeAfterStop: true, requestSeq: r.seq });
  return dir;
};
const events = dir => readFileSync(join(dir, 'gate-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const done = (...dirs) => dirs.forEach(d => rmSync(d, { recursive: true, force: true }));
const WORDS = '  Yes - route pass 2\nto layer 3, please.  ';   // kept byte for byte, spaces and newline included

test('RTT-1 the bare request needs a terminal: stdin AND stdout a terminal records it (channel cli, no words); either one not, or both not, refuses by the flag\'s relayed form and writes nothing', () => {
  const dir = pausedRun();
  try {
    const refused = [{ stdin: { isTTY: false }, stdout: sink(true) }, { stdin: { isTTY: true }, stdout: sink(false) }, { stdin: { isTTY: false }, stdout: sink(false) }, { stdin: {}, stdout: {} }];
    for (const streams of refused) {
      const res = rc.askRoute(dir, { ...streams, ladder, config }, { now });
      assert.deepEqual([res.ok, res.code], [false, 'route_request_needs_terminal'], JSON.stringify(streams));
      assert.match(res.message, /needs a person at a terminal: stdin and stdout must both be a terminal\. A handler session gives the person's answer with --person-words "<their answer>"\./);
    }
    assert.deepEqual(events(dir).map(l => l.event), ['pause_requested'], 'nothing was written by any refusal');
    const res = rc.askRoute(dir, { ...terminal(), ladder, config }, { now });   // GOOD HALF: the same call at a terminal
    assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.pass, 2);
    const line = events(dir).at(-1);
    assert.deepEqual([line.event, line.by, line.channel, line.person_words], ['route_requested', 'person', 'cli', null]);
  } finally { done(dir); }
});

test('RTT-2 the relayed form needs no terminal: the words are recorded byte for byte on the channel session, and the line verifies under the ledger\'s own check', () => {
  const dir = pausedRun();
  try {
    const res = rc.askRoute(dir, { personWords: WORDS, stdin: { isTTY: false }, stdout: sink(false), ladder, config }, { now });
    assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.pass, 2);
    const lines = events(dir); const line = lines.at(-1);
    assert.deepEqual([line.event, line.by, line.channel, line.person_words], ['route_requested', 'person', 'session', WORDS]);
    assert.equal(routeLineProblem(line, lines.slice(0, -1)), null, 'the line passes the ledger\'s own check');
    assert.equal(gate.readLedger(dir).ok, true, 'and the whole ledger verifies');
    assert.equal(rc.askRoute(dir, { personWords: 'again', ladder, config }, { now }).code, 'route_request_open', 'a second open request is still the writer\'s refusal');
  } finally { done(dir); }
});

test('RTT-3 the relay sentence in a run_controls row is derived from the channel alone: a session request gets RELAY_REASON, a cli request gets none, and relay-like words in person_words change nothing', () => {
  const rowsOf = ask => { const dir = pausedRun(); try { assert.equal(ask(dir).ok, true); return rc.runControlsOf(dir); } finally { done(dir); } };
  const viaTerminal = rowsOf(dir => rc.askRoute(dir, { ...terminal(), ladder, config }, { now }));
  assert.equal(viaTerminal.length, 1); assert.equal(viaTerminal[0].request.channel, 'cli');
  assert.equal('reason' in viaTerminal[0].request, false, 'a request typed at the terminal carries no sentence');
  const relayed = rowsOf(dir => rc.askRoute(dir, { personWords: 'Yes, please.', ladder, config }, { now }));
  assert.deepEqual([relayed[0].request.channel, relayed[0].request.reason], ['session', rc.RELAY_REASON]);
  const likeRelay = rowsOf(dir => rc.askRoute(dir, { personWords: `${rc.RELAY_REASON} (these are the words)`, ladder, config }, { now }));
  assert.equal(likeRelay[0].request.reason, rc.RELAY_REASON, 'the channel decides, not the text of the words');
  const plain = rowsOf(dir => rc.askRoute(dir, { personWords: 'no relay words here', ladder, config }, { now }));
  assert.equal(plain[0].request.reason, likeRelay[0].request.reason, 'the same sentence whatever the words say');
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.equal(schema.properties.run_controls.items.properties.request.oneOf[1].properties.reason.type, 'string', 'the published schema names the field');
});

test('RTT-4 a missing, empty or whitespace-only --person-words is refused by the flag\'s name before any write (in process: the relayed form is not mistaken for the bare one)', () => {
  const dir = pausedRun();
  try {
    for (const words of ['', ' ', '   \n\t ']) {
      const res = rc.askRoute(dir, { personWords: words, ...terminal(), ladder, config }, { now });   // even at a terminal: given words that say nothing are not the person's bare request
      assert.deepEqual([res.ok, res.code], [false, 'route_person_words_missing'], JSON.stringify(words));
      assert.match(res.message, /^--person-words needs the person's words after it, as the person typed them\.$/);
    }
    assert.deepEqual(events(dir).map(l => l.event), ['pause_requested']);
  } finally { done(dir); }
});

test('RTT-5 the goes-alone rule is widened by --person-words (and its value) and nothing else: --reason, --continue or a stray token beside the flag is still refused by its own name', () => {
  const base = ['--resume', 'runs/x', '--next-pass-layer-3'];
  const r = argv => raiseFlags.routeFlagRefusal({ argv });
  assert.equal(r(base), null, 'GOOD HALF: the flag alone');
  assert.equal(r([...base, '--person-words', 'Yes, route it.']), null, 'with the person\'s words');
  assert.equal(r(['--person-words', 'Yes, route it.', ...base]), null, 'in either order');
  assert.match(r([...base, '--person-words', 'Yes.', '--reason', 'because']) ?? '', /^--reason cannot go with --next-pass-layer-3: a route request is recorded alone\./);
  assert.match(r([...base, '--person-words', 'Yes.', '--continue']) ?? '', /^--continue cannot go with --next-pass-layer-3:/);
  assert.match(r([...base, '--person-words', 'Yes.', 'stray']) ?? '', /^stray cannot go with --next-pass-layer-3:/);
  assert.equal(r(['--task', 't.md', '--next-pass-layer-3', '--person-words', 'x']), null, 'a start (no --resume) keeps its own sentence elsewhere');
});

test('RTT-6 --person-words on a command that does not read it (a resume or a start without --next-pass-layer-3) is refused by name, not dropped; with the flag it is the relay and is not refused', () => {
  const r = argv => raiseFlags.routeFlagRefusal({ argv });
  for (const argv of [['--resume', 'runs/x', '--person-words', 'Yes.'], ['--task', 't.md', '--person-words', 'Yes.'], ['--resume', 'runs/x', '--continue', '--person-words', 'Yes.']]) {
    assert.match(r(argv) ?? '', /^--person-words: an option of `--next-pass-layer-3` on a resume .* and of `council route-decide`, `council pause` and `council relay-answer` only\.$/, JSON.stringify(argv));
  }
  assert.equal(r(['--resume', 'runs/x', '--next-pass-layer-3', '--person-words', 'Yes.']), null, 'GOOD HALF: with the flag it is the relay');
  assert.equal(r(['--resume', 'runs/x', '--continue']), null, 'and a command without the words is untouched');
});
