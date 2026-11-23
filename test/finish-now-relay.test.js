// 0.8.4 (the ladder unit, commit 4b): FINISH AT ONCE through the MCP tool `stop_decide`, relayed. The handling session gives `finish_now` only on the person's own words (`person_words`); it is recorded as the PERSON's choice
// (actor person, channel session, the relay sentence as its reason, the words beside it) and never as a choice typed at a terminal (actor unknown, channel cli) or as the session's own (actor handling_session). The session decides nothing
// here, so the answer carries no reason, advisor or person test; the session's own continue/finish rules (c_u, finding-before-finish) do not apply to it. Offline, $0: a real stdio session on a real round stop made by the mock chain.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. Each row has its control (a typed --finish-now, a plain session finish, or the same call without the words).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { stoppedProject, untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';
import Ajv2020 from 'ajv/dist/2020.js';
const { RELAY_REASON } = await import('../src/gate.js');
const { chooserOf } = await import('../src/stop-decision.js');
const { FINISH_NOW_NEEDS_WORDS, FINISH_NOW_NO_OWN_FIELDS, PERSON_WORDS_ONLY_FINISH_NOW } = await import('../src/mcp/stop-decide.js').catch(() => ({}));

const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });
const fresh = tag => { const p = stoppedProject(tag); projects.push(p); return p; };
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const ledger = p => (existsSync(join(p.runDir, LEDGER_FILE)) ? readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const snapshot = p => JSON.stringify([readdirSync(p.runDir).sort(), readFileSync(join(p.runDir, 'run.json'), 'utf8'), ledger(p).length]);
const WORDS = 'Please end the run now, I do not want another read.';
const reportOf = p => JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));

test('RL-1: a relayed finish_now ends the run at once and is recorded as the person\'s: actor person, channel session, the relay sentence as the reason, the person\'s words beside it, relayed true, no advisor and no person test; chooserOf says it was relayed by the handling session; the typed --finish-now at the terminal is actor unknown, channel cli (the swapped input)', async () => {
  const p = fresh('r1'); const typed = fresh('r1t');
  const q = await call(p, { step: 'quote' });
  assert.match(q.text, /Choices: continue \| finish\./, 'the quote does not offer finish_now: no screen asks it');
  assert.doesNotMatch(q.text, /finish.now|finish_now|finish at once/i);
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: WORDS });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
  assert.deepEqual([r.recorded.choice, r.recorded.actor, r.recorded.channel, r.recorded.relayed], ['finish_now', 'person', 'session', true]);
  await untilRunIdle(p.runDir);
  const e = p.runJson().roundChoices[0];
  assert.deepEqual([e.choice, e.actor, e.channel, e.reason, e.person_words, e.relayed], ['finish_now', 'person', 'session', RELAY_REASON, WORDS, true]);
  assert.equal(chooserOf(e), "the person's words, relayed by the handling session", 'the line a person reads in the quote\'s "Choices already made" and on the board; never "a choice typed at the terminal"');
  assert.equal(e.advisor, undefined); assert.equal(e.person_test, undefined);
  const line = ledger(p).filter(l => l.event === 'gate_answered').at(-1);
  assert.deepEqual([line.channel, line.person_words, line.reason, line.stop_answer], ['session', WORDS, RELAY_REASON, { choice: 'finish_now', relayed: true }]);
  assert.deepEqual([reportOf(p).passed, reportOf(p).stop.finished_at_once, reportOf(p).final_read?.reason], [false, true, 'every_top_seat_read_this_plan']);   // FINDING (not on the owed list of the ladder unit; Section Q named FN-1 only; 10 Nov 2026, first box run): the row pinned finished_at_once for every kind, a prediction of mine. OLD: finished_at_once. NEW: at the cap of this fixture the top layer had read the text that ends the run, so what it read stays on the record (final_read.reason is derived from the draft hashes)
  // every line a person reads says the handling session relayed it (LAD-F14): the log, the report's marks, the board
  const logOf = q => readFileSync(join(q.runDir, 'run.log'), 'utf8');
  assert.match(logOf(p), /finishing at once at the person's choice, relayed by the handling session: /);
  // FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026; OPEN for C&C). OLD bar [true, true]. NEW [true, undefined]: in this fixture the top layer had already read the current text, so the final-read record carries the reason every_top_seat_read_this_plan and, by its builder (src/final-read.js), `relayed` only on the reason finished_at_once; the relay is on stop.relayed, in the log and on the board.
  assert.deepEqual([reportOf(p).stop.relayed, reportOf(p).final_read.relayed], [true, undefined]);
  { const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true); const validate = ajv.compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'))); assert.ok(validate(reportOf(p)), JSON.stringify(validate.errors)); }
  { const r1 = reportOf(p).relayed?.at(-1); assert.deepEqual([r1?.kind, r1?.actor, r1?.person_words], ['stop_decision', 'main-session', WORDS], 'report.relayed lists the stop relay as the ledger writes it (the session carried it); the run.json entry names the person'); }
  const boardOf = q => ['BOARD.md', 'deliverable.md'].filter(f => existsSync(join(q.runDir, f))).map(f => readFileSync(join(q.runDir, f), 'utf8')).join('\n');
  assert.match(boardOf(p), /finished at the person's choice, relayed by the handling session/);
  // the control: the same choice typed at the terminal is a CLI choice, actor unknown
  typed.run(['--resume', typed.runDir, '--finish-now']);
  const t = typed.runJson().roundChoices[0];
  assert.deepEqual([t.choice, t.actor, t.channel, t.person_words], ['finish_now', 'unknown', 'cli', undefined]);
  assert.equal(chooserOf(t), 'a choice typed at the terminal', 'the control: a typed choice reads as typed');
  assert.match(logOf(typed), /finishing at once at the person's choice: /, 'the control: the typed finish-now log line has no relay clause');
  assert.doesNotMatch(logOf(typed) + boardOf(typed), /relayed by the handling session/);
  assert.deepEqual([reportOf(typed).stop.relayed, reportOf(typed).final_read.relayed], [undefined, undefined]);
});

test('RL-2: a relayed finish_now without the person\'s words, with the session\'s own reason/advisor/person_test, or a relayed continue with own fields or blank words, is refused with nothing recorded and the run still stopped', async () => {
  const p = fresh('r2');
  const q = await call(p, { step: 'quote' });
  const before = snapshot(p);
  const noWords = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now' });
  assert.equal(noWords.error, FINISH_NOW_NEEDS_WORDS);
  const blank = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: '   ' });
  assert.equal(blank.error, FINISH_NOW_NEEDS_WORDS);
  const own = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: WORDS, reason: 'I think it is time.' });
  assert.equal(own.error, FINISH_NOW_NO_OWN_FIELDS);
  const wrong = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS, reason: 'x', advisor: 'none', advisor_said: '', person_test: {} });
  assert.equal(wrong.error, FINISH_NOW_NO_OWN_FIELDS, 'CHANGED (C&C 10 Nov, typed = relayed): OLD bar: person_words with continue was refused as PERSON_WORDS_ONLY_FINISH_NOW; a relayed continue is now a choice, so own fields beside the words are the refusal');
  const blankContinue = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: '  ' });
  assert.equal(blankContinue.error, PERSON_WORDS_ONLY_FINISH_NOW, 'blank words with a choice that is not finish_now');
  assert.equal(snapshot(p), before, 'nothing was recorded by any of the five');
  assert.equal(p.runJson().roundChoices, undefined);
});

test('RL-3: the session\'s own finish at the same stop is still the session\'s: actor handling_session with its reason and advisor, and no person_words (the swapped input of RL-1)', async () => {
  const p = fresh('r3');
  const q = await call(p, { step: 'quote' });
  const PT = { session: { person: 'no', unsettled_by_record: false, preference: false, reason: 'The record settles it.' }, advisor: { person: 'no', unsettled_by_record: false, preference: false, reason: 'Agreed: a fact.' } };
  const r = await call(p, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', reason: 'The one standing objection is a fact the plan settles.', advisor: 'consulted', advisor_said: 'Agreed: end it.', person_test: PT });
  assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 300));
  await untilRunIdle(p.runDir);
  const e = p.runJson().roundChoices[0];
  assert.deepEqual([e.choice, e.actor, e.channel, e.person_words, e.relayed], ['finish', 'handling_session', 'session', undefined, undefined]);
  assert.equal(reportOf(p).stop.finished_at_once, undefined);
});
