// 0.8.4 D4 (plan A T4.1, T4.2; STEP3 F6; A-plan "T4 tests" test/person-test-record.test.js): the PERSON TEST of the handling session and its advisor, recorded with every choice made through stop_decide. A stop is the person's only
// when both answer yes; the session decides otherwise, and the record keeps both verdicts and marks a decision made over a disagreement. THC records both parts, does not judge either, checks their shape and the filler
// where there is no advisor, and computes over_disagreement itself. Offline, $0: the gate-level rows need no run, the tool rows use a real round stop made by the mock chain.
import test, { afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { requestGate } from '../src/gate.js';
// guarded: on a tree without the new exports (the red tree of the unit) each row fails by name, not one load failure for the file
const { answerStopDecisionAsSession } = await import('../src/gate.js');
const { chooserOf } = await import('../src/stop-decision.js').catch(() => ({}));
import { stoppedProject, untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';

const V = (person, unsettled, preference, reason = 'The record settles it.') => ({ person, unsettled_by_record: unsettled, preference, reason });
const NO = V('no', false, false);
const YES = V('yes', true, true, 'It turns on what they want.');
const FILL = reason => V('no', false, false, reason);
const BASE = { reason: 'The standing objection is a fact the plan settles.', choice: 'continue', advisor: 'consulted', advisor_said: 'Agreed.' };

const projects = []; const dirs = [];
afterEach(() => { while (projects.length) projects.pop().done(); });
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const fresh = tag => { const p = stoppedProject(tag); projects.push(p); return p; };
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const ledger = p => readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const snapshot = p => JSON.stringify([readdirSync(p.runDir).sort(), readFileSync(join(p.runDir, 'run.json'), 'utf8'), ledger(p).length]);
const answer = async (p, extra) => { const q = await call(p, { step: 'quote' }); return call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...BASE, ...extra }); };

test('PT-1 a session verdict person: no with an advisor verdict person: yes: the entry carries both verdicts and over_disagreement true, the session\'s choice stands, the run is not handed to the person, and the chooser line says so', async () => {
  const p = fresh('t1');
  const pt = { session: NO, advisor: YES };
  const r = await answer(p, { person_test: pt });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  assert.equal(r.recorded.over_disagreement, true);
  assert.equal(r.resumed, true, 'the session decided; nothing waits for the person');
  await untilRunIdle(p.runDir);
  const e = p.runJson().roundChoices[0];
  assert.deepEqual([e.choice, e.actor, e.person_test, e.over_disagreement], ['continue', 'handling_session', pt, true]);
  assert.equal(chooserOf(e), "the handling session, its advisor disagreeing on whether this was the person's");
  const line = ledger(p).find(l => l.event === 'gate_answered');
  assert.deepEqual([line.stop_answer.person_test, line.stop_answer.over_disagreement], [pt, true]);
});

test('PT-2 agreement on "no" is not a disagreement (false), and so is no advisor: advisor none carries the filler verdict and over_disagreement false; so does advisor unavailable (F6) with its own filler', async () => {
  const none = fresh('t2');
  const rn = await answer(none, { advisor: 'none', advisor_said: '', person_test: { session: NO, advisor: FILL('no advisor') } });
  assert.equal(rn.error, undefined, JSON.stringify(rn).slice(0, 300));
  await untilRunIdle(none.runDir);
  const en = none.runJson().roundChoices[0];
  assert.deepEqual([en.advisor, en.over_disagreement, en.person_test.advisor.reason], ['none', false, 'no advisor']);
  assert.equal(chooserOf(en), 'the handling session, without an advisor');
  const gone = fresh('t2b');
  const ru = await answer(gone, { advisor: 'unavailable', advisor_said: '', person_test: { session: NO, advisor: FILL('advisor unavailable') } });
  assert.equal(ru.error, undefined, JSON.stringify(ru).slice(0, 300));
  await untilRunIdle(gone.runDir);
  const eu = gone.runJson().roundChoices[0];
  assert.deepEqual([eu.advisor, eu.over_disagreement, eu.person_test.advisor.reason], ['unavailable', false, 'advisor unavailable']);
  const both = fresh('t2c');
  const rb = await answer(both, { person_test: { session: NO, advisor: NO } });
  await untilRunIdle(both.runDir);
  assert.equal(rb.recorded.over_disagreement, false);
});

test('PT-3 both parts say yes: answer is refused (the session may not decide the person\'s stop) and names defer; defer is accepted and recorded with both verdicts; the run stays stopped', async () => {
  const p = fresh('t3');
  const q = await call(p, { step: 'quote' });
  const before = snapshot(p);
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...BASE, person_test: { session: YES, advisor: YES } });
  assert.match(r.error, /^the session and its advisor both say this stop is the person's: hand it to the person with step defer\. Nothing was recorded\.$/);
  assert.equal(snapshot(p), before);
  const d = await call(p, { step: 'defer', gate: q.gate, shown: q.shown, reason: 'Which objection to give up is theirs.', advisor: 'consulted', advisor_said: 'Agreed.', person_test: { session: YES, advisor: YES } });
  assert.equal(d.error, undefined, JSON.stringify(d));
  const line = ledger(p).find(l => l.event === 'gate_answered');
  assert.deepEqual([line.decision, line.stop_defer.person_test], ['declined', { session: YES, advisor: YES }]);
  assert.equal(p.runJson().roundChoices, undefined, 'no choice entry: the run waits for the person');
});

test('PT-4 a defer is refused unless BOTH parts say yes (A6): one yes, two noes, no advisor, an unavailable advisor; nothing is recorded by any of them', async () => {
  const p = fresh('t4');
  const q = await call(p, { step: 'quote' });
  const before = snapshot(p);
  const D = { step: 'defer', gate: q.gate, shown: q.shown, reason: 'Theirs to say.', advisor: 'consulted', advisor_said: 'Agreed.' };
  const cases = [
    [{ ...D, person_test: { session: YES, advisor: NO } }, /both say it is the person's/], [{ ...D, person_test: { session: NO, advisor: YES } }, /both say it is the person's/], [{ ...D, person_test: { session: NO, advisor: NO } }, /both say it is the person's/],
    [{ ...D, advisor: 'none', advisor_said: '', person_test: { session: YES, advisor: FILL('no advisor') } }, /advisor must have answered/], [{ ...D, advisor: 'unavailable', advisor_said: '', person_test: { session: YES, advisor: FILL('advisor unavailable') } }, /advisor must have answered/],
    [{ ...D }, /person_test must be \{ session, advisor \}/],
  ];
  for (const [args, re] of cases) {
    const r = await call(p, args);
    assert.match(r.error, re, JSON.stringify(args.person_test)?.slice(0, 80));
    assert.match(r.error, /Nothing was recorded\.$/);
    assert.equal(snapshot(p), before);
  }
});

test('PT-5 THC checks the SHAPE and the filler, and judges neither verdict: a part with a missing field, a wrong value, an empty reason or a made-up key is refused; a lying filler (advisor none with a yes) is refused; a contradictory-looking verdict (person yes with a false condition) is recorded as given', async () => {
  const p = fresh('t5');
  const q = await call(p, { step: 'quote' });
  const before = snapshot(p);
  const A = { step: 'answer', gate: q.gate, shown: q.shown, ...BASE };
  const bad = [
    [{ session: { person: 'no', preference: false, reason: 'x' }, advisor: NO }, /person_test\.session must be \{ person, unsettled_by_record, preference, reason \}/],
    [{ session: { ...NO, person: 'maybe' }, advisor: NO }, /person_test\.session\.person must be yes or no/],
    [{ session: { ...NO, preference: 'false' }, advisor: NO }, /unsettled_by_record and preference must be true or false/],
    [{ session: { ...NO, reason: ' ' }, advisor: NO }, /person_test\.session\.reason must be a sentence or two/],
    [{ session: NO, advisor: { ...NO, reason: 'y'.repeat(401) } }, /person_test\.advisor\.reason must be a sentence or two/],
    [{ session: NO, advisor: { ...NO, extra: 1 } }, /person_test\.advisor must be/],
    [{ session: NO }, /person_test must be \{ session, advisor \}/],
  ];
  for (const [person_test, re] of bad) {
    const r = await call(p, { ...A, person_test });
    assert.match(r.error, re, JSON.stringify(person_test).slice(0, 80));
    assert.equal(snapshot(p), before, 'nothing recorded');
  }
  const lie = await call(p, { ...A, advisor: 'none', advisor_said: '', person_test: { session: NO, advisor: YES } });
  assert.match(lie.error, /with advisor none the advisor part is person no, unsettled_by_record false, preference false and reason 'no advisor'/);
  assert.equal(snapshot(p), before);
  const odd = await call(p, { ...A, person_test: { session: V('yes', false, true, 'My own view.'), advisor: NO } });
  await untilRunIdle(p.runDir);
  assert.equal(odd.error, undefined, 'THC does not judge a verdict');
  assert.deepEqual(p.runJson().roundChoices[0].person_test.session, V('yes', false, true, 'My own view.'));
});

test('PT-6 over_disagreement is computed at the gate and never taken from the caller: a given value that is not the computed one is refused with nothing recorded, the right one is accepted and stored as computed', () => {
  const base = mkdtempSync(join(tmpdir(), 'pt-gate-')); dirs.push(base);
  const d = join(base, 'run-1'); mkdirSync(d); writeFileSync(join(d, 'q.md'), 'Stop overseer_cap:2:2: x');
  const asked = requestGate(d, { kind: 'stop_decision', textPath: 'q.md', stop: { id: 'overseer_cap:2:2' }, requestedBy: 'session' });
  assert.equal(asked.ok, true);
  const g = asked.gate;
  const sa = over => ({ choice: 'continue', advisor: 'consulted', advisor_said: 'Agreed.', person_test: { session: NO, advisor: YES }, ...(over === undefined ? {} : { over_disagreement: over }) });
  const wrong = answerStopDecisionAsSession(d, g.id, { shownSha256: g.sha256, reason: BASE.reason, stopAnswer: sa(false) });
  assert.deepEqual([wrong.ok, wrong.code, wrong.message], [false, 'bad_stop_answer', 'over_disagreement is computed, not given. Nothing was recorded.']);
  const gateLines = () => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(gateLines().some(l => l.event === 'gate_answered'), false);
  assert.equal(answerStopDecisionAsSession(d, g.id, { shownSha256: g.sha256, reason: BASE.reason, stopAnswer: sa(true) }).ok, true);
  assert.equal(gateLines().find(l => l.event === 'gate_answered').stop_answer.over_disagreement, true);
});

test('PT-7 every text the session writes is scanned before it reaches a run folder: a credential-shaped string or a direction character in the reason, in advisor_said or in either reason of the person test is refused, and nothing is recorded', async () => {
  const p = fresh('t7');
  const q = await call(p, { step: 'quote' });
  const before = snapshot(p);
  const KEY = `my key is ${'sk-' + 'A'.repeat(40)}`;
  const places = {
    reason: x => ({ reason: x }), advisor_said: x => ({ advisor_said: x }),
    'person_test.session.reason': x => ({ person_test: { session: { ...NO, reason: x }, advisor: NO } }), 'person_test.advisor.reason': x => ({ person_test: { session: NO, advisor: { ...NO, reason: x } } }),
  };
  for (const [where, put] of Object.entries(places)) {
    const keyed = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...BASE, person_test: { session: NO, advisor: NO }, ...put(KEY) });
    assert.match(keyed.error, new RegExp(`${where.replace(/\./g, '\\.')} holds 1 credential-shaped string\\(s\\)`), where);
    assert.match(keyed.error, /Nothing was recorded\.$/);
    const bidi = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, ...BASE, person_test: { session: NO, advisor: NO }, ...put('fine‮ text') });
    assert.match(bidi.error, /Nothing was recorded\.$/, `${where}: a direction character`);
    assert.equal(snapshot(p), before, where);
  }
});
