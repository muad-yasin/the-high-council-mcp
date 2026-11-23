// 0.8.4 (the ladder unit, commit 4b; C&C 10 Nov): A STOP ONLY THE PERSON DECIDES. On a ladder run the stop at the limit its person typed (--rounds N) is the person's at EVERY N (stop.ladder, marked where the stop is raised); off the ladder the seven-round hard stop stays.
// At such a stop the session gives no answer of its own: the GATE refuses it (gate meta person_only, derived from the stop by the gate writer). It relays the person's own choice with person_words, at this stop and at every other one:
// continue (with the person's new total of reads, `rounds`, as a typed --rounds N), finish, finish_now; the entry is actor person, channel session, relayed true. A defer only leaves the stop waiting. Offline, $0: real runs of mock chains,
// a real stdio session. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. Every row names its control (the typed choice, the ordinary stop, or the old bar).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { stoppedProject, stallProject, untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';
import * as OR from '../src/overseer-rounds.js';   // a namespace import: on the old tree each row fails by assertion and the file still loads
const isHardStop = (...a) => OR.isHardStop(...a); const isPersonStop = (...a) => OR.isPersonStop(...a); const markLadderStop = (...a) => OR.markLadderStop(...a); const limitReachable = (...a) => OR.limitReachable(...a); const stopSentence = (...a) => OR.stopSentence(...a);
import { endsAtStopWithoutHandler } from '../src/chain.js';
import { sessionMayAccept } from '../src/acceptance.js';
const { RELAY_REASON, PERSON_ONLY_STOP_REFUSAL, answerStopDecisionAsSession, readGateAnswer, requestGate } = await import('../src/gate.js');
const { answerStopQuote, answerStopRelayed, requestStopQuote, stopDecisionAnswerOf } = await import('../src/stop-gate.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });

// ---- a ladder run stopped at its typed limit (--rounds N), through the real command; the chain of test/ladder-chain-key.test.js (its top layer always objects)
const critics = id => [1, 2, 3].map(l => ({ provider: 'mock', model: `mock-critic-script-x-${id}${l}`, lab: `l${l}`, layer: l }));
const ladderChain = id => ({ name: 'lad', signoff: 'unanimous', ladder: { block: 1, visits: 1 },   // the smallest key chain-lint accepts: N counts top-layer READS, and fewer passes make each read cheaper
  estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: critics(id) } });
function ladderProject(id, rounds) {
  const dir = mkdtempSync(join(tmpdir(), 'person-stop-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(ladderChain(id)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'lad', '--task', 'tasks/t.md', '--rounds', String(rounds)]);
  if (first.status !== 23) throw new Error(`the ladder chain was meant to stop at exit 23, got ${first.status}: ${first.stdout}${first.stderr}`);
  const runId = readdirSync(join(dir, 'runs'))[0]; const runDir = join(dir, 'runs', runId);
  const p = { dir, runDir, id: runId, run, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), done: () => rmSync(dir, { recursive: true, force: true }) };
  projects.push(p);
  return p;
}
const fresh = tag => { const p = stoppedProject(tag); projects.push(p); return p; };
const hard = tag => { const p = stoppedProject(tag, { rounds: 7 }); projects.push(p); return p; };
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const partialStop = p => JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
const ledger = p => (existsSync(join(p.runDir, LEDGER_FILE)) ? readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const WORDS = 'Yes, go on to the next read.';
const OWN = { reason: 'The record settles it.', advisor: 'none', advisor_said: '', person_test: { session: { person: 'no', unsettled_by_record: false, preference: false, reason: 'The record settles it.' }, advisor: { person: 'no', unsettled_by_record: false, preference: false, reason: 'no advisor' } } };
const PT_YES = { session: { person: 'yes', unsettled_by_record: true, preference: true, reason: 'It turns on what the person wants.' }, advisor: { person: 'yes', unsettled_by_record: true, preference: true, reason: 'Agreed.' } };

// the gate of a quote asked directly (the file a quote writes), for the rows that call the gate without the tool
function gateOf(p, n = 1) {
  const stop = partialStop(p); const stopId = `${stop.kind}:${stop.overseer_round}:${stop.pass}`;
  const file = `stop-quote-${String(n).padStart(4, '0')}.md`;
  writeFileSync(join(p.runDir, file), `Stop ${stopId}: a stop (test)\n`);
  const asked = requestStopQuote(p.runDir, { textPath: file, stopId, person_only: false });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  return { stopId, id: asked.gate.id, sha: asked.gate.sha256, record: () => readGateAnswer(p.runDir, asked.gate.id).gate };
}

// like gateOf, for rows that only need the ids
const gateOfRaw = (p, n) => gateOf(p, n);

for (const N of [3, 8]) {
  test(`PS-1 (ladder run, N=${N}): the stop at a typed limit of ${N} reads is the person's at this N too: marked ladder, not the hard stop, no "after 7 overseer rounds"; the session's own answer is refused by the gate; the relayed continue is the person's (actor person, channel session, relayed true, the words); the typed --continue is actor unknown, channel cli`, async () => {
    const rel = ladderProject(`p1r${N}`, N); const typed = ladderProject(`p1t${N}`, N);
    const stop = partialStop(rel);
    assert.deepEqual([stop.kind, stop.rounds, stop.ladder], ['overseer_cap', N, true], 'the premise: a ladder run stopped at the limit it was given, marked');
    assert.deepEqual([isHardStop(stop), isPersonStop(stop)], [false, true]);
    const q = await call(rel, { step: 'quote' });
    assert.deepEqual([q.person_only, q.requires_user, q.hard_stop], [true, true, undefined]);
    assert.ok(q.gate && q.shown, 'a person stop now has a gate');
    assert.doesNotMatch(q.text, /after 7 overseer rounds|hard stop/);
    // the session's own answer: refused IN THE GATE (a direct call), and the tool passes the same sentence on
    const gateRefusal = answerStopQuote(rel.runDir, q.gate, { shownSha256: q.shown, reason: OWN.reason, choice: 'continue', advisor: 'none', advisorSaid: '', personTest: OWN.person_test });
    assert.equal(gateRefusal.ok, false); assert.equal(gateRefusal.message, PERSON_ONLY_STOP_REFUSAL);
    assert.equal((await call(rel, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', ...OWN })).error, PERSON_ONLY_STOP_REFUSAL);
    assert.equal(rel.runJson().roundChoices, undefined, 'nothing recorded by either refusal');
    // the person's words, relayed
    const r = await call(rel, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS });
    assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
    assert.deepEqual([r.recorded.choice, r.recorded.actor, r.recorded.channel, r.recorded.relayed], ['continue', 'person', 'session', true]);
    await untilRunIdle(rel.runDir, 120_000);
    const e = rel.runJson().roundChoices[0];
    assert.deepEqual([e.choice, e.actor, e.channel, e.reason, e.person_words, e.relayed], ['continue', 'person', 'session', RELAY_REASON, WORDS, true]);
    assert.equal(e.advisor, undefined);
    // the control: the same choice typed at the terminal
    typed.run(['--resume', typed.runDir, '--continue']);
    const t = typed.runJson().roundChoices[0];
    assert.deepEqual([t.choice, t.actor, t.channel, t.relayed, t.person_words], ['continue', 'unknown', 'cli', undefined, undefined]);
  });
}

test('PS-2: whether a gate is person-only is derived from the stop BY the function that writes it, whatever the caller passes: a ladder typed-limit stop and the off-ladder hard stop are marked, an ordinary stop is not (the control)', () => {
  const lad = ladderProject('p2l', 3); const hs = hard('p2h'); const ord = fresh('p2o');
  assert.deepEqual(gateOf(lad).record().stop, { id: `overseer_cap:${partialStop(lad).overseer_round}:${partialStop(lad).pass}`, person_only: true }, 'the caller asked for person_only false; the gate says true');
  assert.equal(gateOf(hs).record().stop.person_only, true, 'the off-ladder hard stop (7 rounds)');
  assert.deepEqual(Object.keys(gateOf(ord).record().stop), ['id'], 'the control: an ordinary stop carries no mark');
});

test('PS-3: the gate itself refuses, with nothing recorded, what the tool refuses: the session\'s own number, a number with finish, a number that is not whole or not above the reads made, a number on a stop that is not a ladder typed-limit stop; the exact shape { choice, relayed: true } plus rounds only with continue is accepted', () => {
  const lad = ladderProject('p3l', 3); const ord = fresh('p3o');
  const g = gateOf(lad); const before = ledger(lad).length;
  const relay = (gate, p, a) => answerStopRelayed(p.runDir, gate.id, { shownSha256: gate.sha, personWords: WORDS, ...a });
  assert.match(relay(g, lad, { choice: 'continue', rounds: 3 }).message, /rounds 3: this run has already made 3 top-layer reads, so 3 is not a limit it can still reach/, 'N at the reads made: the terminal refuses it too (limitReachable)');
  assert.match(relay(g, lad, { choice: 'continue', rounds: 2 }).message, /not a limit it can still reach/);
  for (const bad of [3.5, 0, -1, '5', Number.NaN]) assert.equal(relay(g, lad, { choice: 'continue', rounds: bad }).ok, false, `rounds ${String(bad)}`);
  assert.equal(relay(g, lad, { choice: 'finish', rounds: 5 }).ok, false, 'a number goes only with continue');
  assert.equal(relay(g, lad, { choice: 'finish_now', rounds: 5 }).ok, false);
  const own = answerStopDecisionAsSession(lad.runDir, g.id, { shownSha256: g.sha, reason: OWN.reason, stopAnswer: { choice: 'continue', advisor: 'none', advisor_said: '', person_test: OWN.person_test, rounds: 5 } });
  assert.equal(own.ok, false); assert.match(own.message, /rounds is the person's own limit/, 'the session\'s own number');
  assert.equal(ledger(lad).length, before, 'nothing was recorded by any of them');
  const og = gateOf(ord);
  // CHANGED ACCEPTED (0.8.4 relayed accept; typed = relayed): OLD bar: an ordinary stop refused a number (applies only to a run on the permanent ladder); NEW: it is accepted and changes nothing there, as a typed --rounds does off the ladder (the run prints that it was not used): RA-4
  assert.equal(relay(og, ord, { choice: 'continue', rounds: 5 }).ok, true, 'an ordinary stop takes the number and it changes nothing');
  const stall = (() => { const p = stallProject('p3s'); projects.push(p); return p; })();
  assert.equal(OR.stopOffersContinue(partialStop(stall)), false, 'the premise: a stall with no pass left offers no continue');
  const sg = gateOf(stall);
  assert.match(relay(sg, stall, { choice: 'continue' }).message, /this stop offers no continue/, 'the gate refuses a relayed continue where the stop offers none, as the tool does');
  assert.equal(relay(sg, stall, { choice: 'finish' }).ok, true, 'a finish there is the stop\'s own');
  assert.equal(limitReachable(4, 3), true); assert.equal(limitReachable(3, 3), false); assert.equal(limitReachable(3.5, 3), false);
  const ok = relay(g, lad, { choice: 'continue', rounds: 5 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(readGateAnswer(lad.runDir, g.id).answer.stop_answer, { choice: 'continue', relayed: true, rounds: 5 });
});

test('PS-3b (fail closed): a relayed continue is refused, with nothing recorded, when the run\'s stop cannot be read (a damaged partial report) and when the stop read is not the stop of the gate (a gate for another stop id); the same call on a readable, matching stop is accepted (the control)', () => {
  const lad = ladderProject('p3b', 2);
  const relay = (g, a) => answerStopRelayed(lad.runDir, g.id, { shownSha256: g.sha, personWords: WORDS, ...a });
  const real = gateOf(lad, 1);
  writeFileSync(join(lad.runDir, 'stop-quote-0002.md'), 'Stop overseer_cap:99:99: another stop\n');
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: requestStopQuote asked a gate for ANY stop id. NEW: it fails closed (LAD-F19): no readable stop with that id, no gate. The row needs a gate for ANOTHER stop id, so it is asked through the gate writer itself, as an old client or a hand-made record would have.
  const other = requestGate(lad.runDir, { kind: 'stop_decision', textPath: 'stop-quote-0002.md', stop: { id: 'overseer_cap:99:99' }, requestedBy: 'session' });
  assert.equal(other.ok, true, JSON.stringify(other));
  const before = ledger(lad).length;
  assert.match(relay({ id: other.gate.id, sha: other.gate.sha256 }, { choice: 'continue' }).message, /cannot be read or is not the stop of gate/, 'not the gate\'s stop');
  const path = join(lad.runDir, 'report-partial.json'); const keep = readFileSync(path, 'utf8');
  writeFileSync(path, '{ broken');
  assert.match(relay(real, { choice: 'continue' }).message, /cannot be read or is not the stop of gate/, 'an unreadable stop');
  assert.match(relay(real, { choice: 'continue', rounds: 9 }).message, /cannot be read or is not the stop of gate/, 'and a number is refused the same way (CHANGED ACCEPTED, relayed accept commit: OLD bar: /applies only to a run on the permanent ladder/, the refusal of a number off the ladder, which is gone)');
  writeFileSync(path, keep);
  assert.equal(ledger(lad).length, before, 'nothing was recorded by any of them');
  assert.equal(relay(real, { choice: 'continue' }).ok, true, 'the control: readable and matching');
});

test('PS-3c (the gate named on the command line): a choice typed with no gate is recorded as typed even when an answered relayed gate for the same stop and choice is on the ledger; a named gate that does not exist, or whose choice differs, is refused with nothing recorded; the named gate of the right choice is recorded as relayed', async () => {
  const p = fresh('p3c');
  const q = await call(p, { step: 'quote' });
  const done = answerStopRelayed(p.runDir, q.gate, { shownSha256: q.shown, personWords: 'End it now.', choice: 'finish_now' });
  assert.equal(done.ok, true, JSON.stringify(done));
  const nameless = p.run(['--resume', p.runDir, '--finish-now', '--stop-gate', 'g99']);
  assert.equal(nameless.status, 2, nameless.stdout + nameless.stderr); assert.match(nameless.stderr, /no answered stop_decision gate of this run by that name matches this stop/);
  const other = p.run(['--resume', p.runDir, '--continue', '--stop-gate', q.gate]);
  assert.equal(other.status, 2, other.stdout + other.stderr);
  assert.equal(p.runJson().roundChoices, undefined, 'nothing recorded by either refusal');
  const typed = p.run(['--resume', p.runDir, '--finish-now']);
  assert.notEqual(typed.status, 2, typed.stdout + typed.stderr);
  const t = p.runJson().roundChoices[0];
  assert.deepEqual([t.choice, t.actor, t.channel, t.relayed, t.person_words, t.gate], ['finish_now', 'unknown', 'cli', undefined, undefined, undefined], 'typed within ten minutes of the answered gate: still typed');
  const named = fresh('p3d'); const qn = await call(named, { step: 'quote' });
  assert.equal(answerStopRelayed(named.runDir, qn.gate, { shownSha256: qn.shown, personWords: 'End it now.', choice: 'finish_now' }).ok, true);
  named.run(['--resume', named.runDir, '--finish-now', '--stop-gate', qn.gate]);
  const e = named.runJson().roundChoices[0];
  assert.deepEqual([e.choice, e.actor, e.relayed, e.gate], ['finish_now', 'person', true, qn.gate]);
});

test('PS-3d (the number on the command line, on and off the ladder): a named gate whose number differs from the --rounds on the command line is refused with nothing recorded; an absent number on one side counts as different', async () => {
  const lad = ladderProject('p3d', 2); const g = gateOf(lad, 1);
  assert.equal(answerStopRelayed(lad.runDir, g.id, { shownSha256: g.sha, personWords: WORDS, choice: 'continue', rounds: 4 }).ok, true);
  const five = lad.run(['--resume', lad.runDir, '--continue', '--rounds', '5', '--stop-gate', g.id]);
  assert.equal(five.status, 2, five.stdout + five.stderr); assert.match(five.stderr, /and the --rounds number/);
  assert.equal(lad.runJson().roundChoices, undefined, 'ladder: nothing recorded');
  const off = fresh('p3e'); const q = await call(off, { step: 'quote' });
  assert.equal(answerStopRelayed(off.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'continue' }).ok, true);
  const three = off.run(['--resume', off.runDir, '--continue', '--rounds', '3', '--stop-gate', q.gate]);
  assert.equal(three.status, 2, three.stdout + three.stderr);
  assert.equal(off.runJson().roundChoices, undefined, 'off the ladder: nothing recorded either (the gate has no number, the command line has one)');
});

test('PS-12 (one source for the number): a relayed continue with rounds N is saved as the run\'s own limit (run.json ladderRounds = N) and the next stop is at N reads; the number reached the run through the gate alone', async () => {
  const p = ladderProject('p12', 2);
  const q = await call(p, { step: 'quote' });
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: 'Go on to four reads.', rounds: 4 });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
  await untilRunIdle(p.runDir, 180_000);
  assert.equal(p.runJson().ladderRounds, 4, 'saved as his limit');
  const next = partialStop(p);
  assert.deepEqual([next.kind, next.rounds, next.ladder], ['overseer_cap', 4, true]);
  const e = p.runJson().roundChoices.at(-1);
  assert.deepEqual([e.choice, e.relayed, e.add], ['continue', true, 0], 'the continue typed with a total adds nothing; the total is the limit');
});

test('PS-4: relay at an ORDINARY stop too (typed = relayed): the person tells the handler "continue" or "finish", the handler relays it with the words, and neither the session-only rules nor a terminal are needed: actor person, channel session, relayed true; the session\'s own answer there is still the session\'s (RL-3)', async () => {
  const c = fresh('p4c'); const f = fresh('p4f');
  const qc = await call(c, { step: 'quote' }); const qf = await call(f, { step: 'quote' });
  assert.deepEqual([qc.person_only, qc.requires_user], [undefined, undefined], 'the control: an ordinary stop is not marked');
  const rc = await call(c, { step: 'answer', gate: qc.gate, shown: qc.shown, choice: 'continue', person_words: WORDS });
  const rf = await call(f, { step: 'answer', gate: qf.gate, shown: qf.shown, choice: 'finish', person_words: 'Please end it.' });
  assert.equal(rc.error, undefined, JSON.stringify(rc).slice(0, 300)); assert.equal(rf.error, undefined, JSON.stringify(rf).slice(0, 300));
  await untilRunIdle(c.runDir); await untilRunIdle(f.runDir);
  const ec = c.runJson().roundChoices[0]; const ef = f.runJson().roundChoices[0];
  assert.deepEqual([ec.choice, ec.actor, ec.channel, ec.relayed, ec.person_words], ['continue', 'person', 'session', true, WORDS]);
  assert.deepEqual([ef.choice, ef.actor, ef.channel, ef.relayed, ef.person_words], ['finish', 'person', 'session', true, 'Please end it.']);
  const frep = JSON.parse(readFileSync(join(f.runDir, 'report.json'), 'utf8'));
  assert.equal(frep.stop.finished_at_once, undefined, 'a relayed plain finish is a plain finish: only finish_now ends at once');
  assert.equal(frep.stop.relayed, true, 'but the report says the finish was relayed');
  assert.match(readFileSync(join(f.runDir, 'run.log'), 'utf8'), /finishing at the person's choice, relayed by the handling session: /);
  const fboard = ['BOARD.md', 'deliverable.md'].filter(n => existsSync(join(f.runDir, n))).map(n => readFileSync(join(f.runDir, n), 'utf8')).join('\n');
  assert.match(fboard, /finished at the person's choice, relayed by the handling session/);
  // the session's own answer carries no number (the tool refuses it; nothing is recorded)
  const c2 = fresh('p4n'); const q2 = await call(c2, { step: 'quote' });
  const ownRounds = await call(c2, { step: 'answer', gate: q2.gate, shown: q2.shown, choice: 'continue', ...OWN, rounds: 5 });
  assert.match(ownRounds.error, /rounds is the person's new limit and goes only with a relayed continue/);
  assert.equal(c2.runJson().roundChoices, undefined);
});

test('PS-5: the off-ladder hard stop (seven overseer rounds): its quote now writes a gate and says whose it is; the session\'s own answer is refused by the gate; a relayed finish_now ends the run (OLD bar: no gate, every answer refused before any gate was looked at)', async () => {
  const p = hard('p5');
  const q = await call(p, { step: 'quote' });
  assert.deepEqual([q.hard_stop, q.person_only, q.requires_user], [true, true, true]);
  assert.ok(q.gate && q.shown, 'the old quote asked for no gate');
  assert.match(q.text, /This is the hard stop after 7 overseer rounds: only you decide here\./);
  assert.equal(answerStopQuote(p.runDir, q.gate, { shownSha256: q.shown, reason: OWN.reason, choice: 'finish', advisor: 'none', advisorSaid: '', personTest: OWN.person_test }).message, PERSON_ONLY_STOP_REFUSAL);
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: 'End it now.' });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  await untilRunIdle(p.runDir);
  const done = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([done.passed, done.stop.finished_at_once, done.stop.relayed], [false, true, true]);
});

test('PS-6 (a leftover answered gate): a relayed finish_now is on the ledger but the resume never ran; a plain resume applies nothing; the person then types --continue: the typed choice runs and is recorded as typed, and the unused relayed answer is never applied', async () => {
  const p = fresh('p6');
  const q = await call(p, { step: 'quote' });
  const done = answerStopRelayed(p.runDir, q.gate, { shownSha256: q.shown, personWords: 'End it now.', choice: 'finish_now' });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(p.run(['--resume', p.runDir]).status, 23, 'a resume with no choice applies no answered gate: the run is still stopped');
  assert.equal(p.runJson().roundChoices, undefined);
  p.run(['--resume', p.runDir, '--continue']);
  const entries = p.runJson().roundChoices;
  assert.deepEqual(entries.map(e => e.choice), ['continue'], 'only the typed choice is on file');
  assert.deepEqual([entries[0].actor, entries[0].channel, entries[0].relayed], ['unknown', 'cli', undefined]);
  assert.equal(existsSync(join(p.runDir, 'report.json')) && JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8')).stop?.finished_at_once === true, false, 'the relayed finish_now was never applied');
});

test('PS-7: a defer at a person stop only leaves it waiting: a declined gate with the session\'s deferral, no choice in run.json, nothing a later reader takes for an answer; a new quote then takes a relayed answer (the control: the answer on the old, declined gate is refused)', async () => {
  const p = ladderProject('p7', 3);
  const q = await call(p, { step: 'quote' });
  const d = await call(p, { step: 'defer', gate: q.gate, shown: q.shown, reason: 'The limit is the person\'s.', advisor: 'consulted', advisor_said: 'Agreed: it is the person\'s.', person_test: PT_YES });
  assert.equal(d.error, undefined, JSON.stringify(d).slice(0, 300));
  assert.equal(d.recorded.kind, 'defer');
  const line = ledger(p).filter(l => l.event === 'gate_answered').at(-1);
  assert.deepEqual([line.decision, line.stop_answer, line.stop_defer !== undefined], ['declined', undefined, true]);
  assert.equal(p.runJson().roundChoices, undefined, 'a defer is not a choice');
  const stop = partialStop(p);
  assert.equal(stopDecisionAnswerOf(p.runDir, `overseer_cap:${stop.overseer_round}:${stop.pass}`, 'continue'), null);
  assert.equal(answerStopRelayed(p.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'continue' }).ok, false, 'the declined gate takes no answer');
  const q2 = await call(p, { step: 'quote' });
  assert.notEqual(q2.gate, q.gate, 'a new quote is a new gate');
  // a session with NO advisor can leave the stop waiting too (the stop is the person's by rule, not by the person test); at an ordinary stop the same call is refused (the control)
  const noAdvisor = { step: 'defer', reason: 'The limit is the person\'s.', advisor: 'none', advisor_said: '', person_test: { session: { person: 'no', unsettled_by_record: false, preference: false, reason: 'No view.' }, advisor: { person: 'no', unsettled_by_record: false, preference: false, reason: 'no advisor' } } };
  const d2 = await call(p, { ...noAdvisor, gate: q2.gate, shown: q2.shown });
  assert.equal(d2.error, undefined, JSON.stringify(d2).slice(0, 300));
  const ord = fresh('p7o'); const qo = await call(ord, { step: 'quote' });
  assert.match((await call(ord, { ...noAdvisor, gate: qo.gate, shown: qo.shown })).error, /handed to the person only when the session and its advisor both say it is the person's|advisor must have answered/, 'the control: at an ordinary stop a defer still needs the advisor and both yes');
  const q3 = await call(p, { step: 'quote' });
  assert.notEqual(q3.gate, q2.gate);
  const r = await call(p, { step: 'answer', gate: q3.gate, shown: q3.shown, choice: 'finish', person_words: 'End it here.' });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  await untilRunIdle(p.runDir, 120_000);
  assert.deepEqual([p.runJson().roundChoices[0].choice, p.runJson().roundChoices[0].relayed], ['finish', true]);
});

test('PS-8 (a resume path): a number typed at a resume (--rounds 3 --continue after a stop at 2) raises the typed limit, and the stop it then raises carries the ladder mark as the first one did', () => {
  const p = ladderProject('p8', 2);
  assert.equal(partialStop(p).ladder, true);
  assert.equal(p.run(['--resume', p.runDir, '--rounds', '3', '--continue']).status, 23);
  const next = partialStop(p);
  assert.deepEqual([next.kind, next.rounds, next.ladder], ['overseer_cap', 3, true]);
});

test('PS-9 (pure): the predicates. A ladder typed-limit stop is the person\'s at 3 and at 8 and is not the hard stop; the off-ladder stop at 7 is both; below 7 off the ladder it is neither; markLadderStop marks only an overseer_cap and only with a ladder in force', () => {
  const cap = (rounds, extra = {}) => ({ kind: 'overseer_cap', rounds, cap: rounds, pass: rounds, overseer_round: rounds, ...extra });
  assert.deepEqual([3, 8].map(n => [isHardStop(cap(n, { ladder: true })), isPersonStop(cap(n, { ladder: true }))]), [[false, true], [false, true]]);
  assert.deepEqual([isHardStop(cap(7)), isPersonStop(cap(7)), isHardStop(cap(3)), isPersonStop(cap(3))], [true, true, false, false]);
  assert.deepEqual([isHardStop({ kind: 'stall_stop', rounds: 7 }), isPersonStop({ kind: 'stall_stop', pass: 9 })], [true, false], 'a ladder stall stop carries no rounds: never hard');
  assert.deepEqual([markLadderStop(cap(3), true).ladder, markLadderStop(cap(3), false).ladder, markLadderStop({ kind: 'layer_bound' }, true).ladder], [true, undefined, undefined]);
  // C&C 10 Nov, condition 3: a stall stop of a run with a ladder in force is marked too, so the seven-round count never makes it the hard stop, and on a ladder run no stop becomes the person's alone by the count (only the typed-limit stop is)
  const stall = markLadderStop({ kind: 'stall_stop', rounds: 9, pass: 5, overseer_round: 9 }, true);
  assert.deepEqual([stall.ladder, isHardStop(stall), isPersonStop(stall)], [true, false, false], 'the ladder row: a stall at nine rounds is not the hard stop');
  assert.deepEqual([isHardStop({ kind: 'stall_stop', rounds: 9 }), isPersonStop({ kind: 'stall_stop', rounds: 9 })], [true, true], 'the control: off the ladder the same stall is the hard stop');
  assert.doesNotMatch(stopSentence(cap(8, { ladder: true }), { runDir: '/r' }), /hard stop/);
  assert.match(stopSentence(cap(7), { runDir: '/r' }), /This is the hard stop after 7 overseer rounds/, 'the control');
});

test('PS-10 (pure, reader 5): with no handling session a ladder run waits for the person at its typed limit at every N and never ends by rule; the same stop off the ladder below seven still ends by rule (the control)', () => {
  const paid = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx' };
  const config = { seats: { criteria: paid, builder: paid, reviser: paid, critics: [{ ...paid, layer: 1 }, { ...paid, layer: 2 }, { ...paid, layer: 3 }] } };
  const cap = (rounds, extra = {}) => ({ kind: 'overseer_cap', rounds, pass: rounds, overseer_round: rounds, ...extra });
  assert.equal(endsAtStopWithoutHandler(config, cap(3), 3), true, 'the control: off the ladder, below seven, a run with nobody to choose ends by rule');
  assert.deepEqual([3, 8].map(n => endsAtStopWithoutHandler(config, cap(n, { ladder: true }), 3)), [false, false]);
  assert.equal(endsAtStopWithoutHandler(config, cap(7), 3), false, 'the hard stop off the ladder waits as before');
});

test('PS-11 (pure, accept): the session may not accept a plan of a run that ended at a person stop or in which a choice was relayed; the person\'s relayed choice is the person\'s (the control: neither)', () => {
  const ok = { report: { delivered_text: { same_as_signed: true }, stop: { kind: 'overseer_cap', rounds: 3 } }, meta: {} };
  assert.equal(sessionMayAccept(ok).ok, true, 'the control');
  assert.equal(sessionMayAccept({ ...ok, report: { ...ok.report, stop: { kind: 'overseer_cap', rounds: 3, ladder: true } } }).ok, false);
  assert.match(sessionMayAccept({ ...ok, report: { ...ok.report, stop: { kind: 'overseer_cap', rounds: 8, ladder: true } } }).message, /round limit the person typed/);
  assert.equal(sessionMayAccept({ ...ok, report: { ...ok.report, stop: { kind: 'overseer_cap', rounds: 7 } } }).ok, false, 'the hard stop, as before');
  assert.match(sessionMayAccept({ ...ok, meta: { roundChoices: [{ stop: 'overseer_cap:1:1', choice: 'finish', channel: 'session', actor: 'person', relayed: true }] } }).message, /person's own words, relayed by the handling session/);
});

test('PS-13 (pure): a credential pause whose record cannot be read is not a stop the session can answer, and what it reads says so and names the terminal command (MOVED BAR, Q9: with a whole record the pause is quoted and a relayed choice is taken, SR-1); the control: a round stop is still classified as the session\'s', async () => {
  const { classifyStop } = await import('../src/stop-decision.js');
  const r = classifyStop({ status: 'paused_secret', run: '2026-11-10T08-00-00-000Z' });
  assert.deepEqual([r.ok, r.code], [false, 'secret_pause']);
  assert.match(r.refusal, /this tool cannot take their choice for it now/);   // MOVED BAR (Q9, 10 Nov 2026): the old sentence said "Only a command typed at a terminal answers it"; with the record whole the pause is now quoted (test/secret-pause-relay.test.js SR-1)
  assert.match(r.refusal, /council --resume runs\/2026-11-10T08-00-00-000Z --continue/);
  assert.deepEqual(classifyStop({ status: 'awaiting_choice', marker: { stoppedBy: 'overseer_cap' } }), { ok: true });
});

test('PS-14 (fail closed, condition 2): a gate cannot be asked while the stop\'s partial report is damaged; and when the report is damaged after a person-only gate was asked, the session\'s own answer records nothing and runs nothing, through the tool and through a direct gate call', async () => {
  const lad = ladderProject('p14', 2);
  const g = gateOfRaw(lad, 1);   // asked while the report is readable: the gate is person-only
  const path = join(lad.runDir, 'report-partial.json'); const keep = readFileSync(path, 'utf8');
  writeFileSync(path, '{ broken');
  const before = ledger(lad).length;
  writeFileSync(join(lad.runDir, 'stop-quote-0009.md'), 'Stop: x\n');
  const asked = requestStopQuote(lad.runDir, { textPath: 'stop-quote-0009.md', stopId: g.stopId });
  assert.deepEqual([asked.ok, asked.code], [false, 'stop_unreadable'], 'no question is asked of a damaged report');
  const viaTool = await call(lad, { step: 'answer', gate: g.id, shown: g.sha, choice: 'continue', ...OWN });
  assert.ok(viaTool.error, JSON.stringify(viaTool).slice(0, 200)); assert.equal(viaTool.recorded, undefined);
  const direct = answerStopQuote(lad.runDir, g.id, { shownSha256: g.sha, reason: OWN.reason, choice: 'continue', advisor: 'none', advisorSaid: '', personTest: OWN.person_test });
  assert.equal(direct.ok, false); assert.equal(direct.message, PERSON_ONLY_STOP_REFUSAL, 'the mark was written when the gate was asked');
  assert.equal(ledger(lad).length, before, 'nothing recorded');
  assert.equal(readdirSync(lad.dir).some(f => /^council-\d+\.log$/.test(f)), false, 'nothing was run');
  writeFileSync(path, keep);
});

test('PS-15 (one stop-id spelling, condition 6): a relayed continue at a final-read stop (its id ends :final_read<attempt>) is accepted by the gate; the same call at a stall with no pass left is refused (the control)', () => {
  const base = mkdtempSync(join(tmpdir(), 'person-stop-fr-')); projects.push({ done: () => rmSync(base, { recursive: true, force: true }) });
  const mk = (name, stop) => {
    const d = join(base, name); mkdirSync(d);
    writeFileSync(join(d, 'report-partial.json'), JSON.stringify({ stop }));
    const id = OR.stopIdOf(stop); writeFileSync(join(d, 'q.md'), `Stop ${id}: x\n`);
    const asked = requestStopQuote(d, { textPath: 'q.md', stopId: id }); assert.equal(asked.ok, true, JSON.stringify(asked));
    return { d, id, gate: asked.gate };
  };
  const fr = mk('fr', { kind: 'layer_bound', why: 'final_read', layer: 3, top_layer: 3, pass: 2, overseer_round: 1, attempt: 0 });
  assert.match(fr.id, /:final_read0$/);
  assert.equal(answerStopRelayed(fr.d, fr.gate.id, { shownSha256: fr.gate.sha256, personWords: WORDS, choice: 'continue' }).ok, true, 'the id the gate compares is the id the gate was asked for');
  const st = mk('st', { kind: 'stall_stop', why: 'last_pass', top_layer: 3, pass_left: false, pass: 2, overseer_round: 0 });
  assert.match(answerStopRelayed(st.d, st.gate.id, { shownSha256: st.gate.sha256, personWords: WORDS, choice: 'continue' }).message, /offers no continue/);
});

test('PS-16 (fail closed, one row per case, each set up BEFORE the request): a stop_decision gate is ordinary ONLY when the stop was read and is not the person\'s; with no report file, a damaged file, no stop object, no whole pass, no whole round, or another stop id, no question is asked and nothing is recorded; the readable cases are the controls', () => {
  const base = mkdtempSync(join(tmpdir(), 'person-stop-fc-')); projects.push({ done: () => rmSync(base, { recursive: true, force: true }) });
  const ask = (name, partial) => {
    const d = join(base, name); mkdirSync(d); writeFileSync(join(d, 'q.md'), 'Stop overseer_cap:2:2: x\n');
    if (partial !== undefined) writeFileSync(join(d, 'report-partial.json'), partial);
    return { d, r: requestStopQuote(d, { textPath: 'q.md', stopId: 'overseer_cap:2:2' }) };
  };
  const cap = (round, pass, extra = {}) => JSON.stringify({ stop: { kind: 'overseer_cap', overseer_round: round, pass, ...extra } });
  const refused = {
    'no report file': undefined,
    'a damaged file': '{ broken',
    'no stop object': '{}',
    'a stop that is not an object': JSON.stringify({ stop: 'overseer_cap:2:2' }),
    'no whole pass': cap(2, 'x'),
    'no whole round': JSON.stringify({ stop: { kind: 'overseer_cap', pass: 2 } }),
    'another stop id': cap(3, 3),
  };
  for (const [name, partial] of Object.entries(refused)) {
    const { d, r } = ask(name.replace(/\W+/g, '-'), partial);
    assert.deepEqual([r.ok, r.code], [false, 'stop_unreadable'], name);
    assert.equal(existsSync(join(d, LEDGER_FILE)), false, `${name}: nothing was recorded`);
  }
  const ord = ask('ordinary', cap(2, 2)); assert.equal(ord.r.ok, true, JSON.stringify(ord.r));
  assert.deepEqual(Object.keys(readGateAnswer(ord.d, ord.r.gate.id).gate.stop), ['id'], 'the control: a readable stop that is not the person\'s asks an ordinary gate');
  const person = ask('person', cap(2, 2, { rounds: 2, ladder: true })); assert.equal(person.r.ok, true, JSON.stringify(person.r));
  assert.equal(readGateAnswer(person.d, person.r.gate.id).gate.stop.person_only, true, 'the control: a readable person stop asks a person-only gate');
});

test('RA-4 (typed = relayed, off the ladder): a relayed continue with rounds on a stop of a chain with overseer rounds is accepted and changes nothing, as a typed --continue --rounds N does: the next stop is the same one in both runs, and no ladder limit is set from the number', async () => {
  const rel = fresh('ra4r'); const typed = fresh('ra4t');
  const q = await call(rel, { step: 'quote' });
  const r = await call(rel, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: 'Go on, five rounds.', rounds: 5 });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  typed.run(['--resume', typed.runDir, '--continue', '--rounds', '5']);
  await untilRunIdle(rel.runDir, 120_000);
  const a = partialStop(rel); const b = partialStop(typed);
  assert.deepEqual([a.kind, a.cap, a.rounds], [b.kind, b.cap, b.rounds], 'the same next stop as the typed continue');
  assert.equal(rel.runJson().ladderRounds, undefined, 'no ladder limit was set from the number');
  assert.equal(typed.runJson().ladderRounds, undefined);
  assert.deepEqual([rel.runJson().roundChoices[0].relayed, rel.runJson().roundChoices[0].choice], [true, 'continue']);
});
