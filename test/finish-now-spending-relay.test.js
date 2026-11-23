// 0.8.4 (the ladder unit; relay of --finish-now at a SPENDING stop; C&C 10 Nov 2026, "RELAY through the 4b person-only gate"): the handling session relays the person's own finish_now (or finish, inside the review rounds) with their words through the
// MCP tool `stop_decide`, over the SAME person-only stop_decision gate the owner pause uses. A spending stop writes a stop object into its partial report (kind budget_stop, the stage, the phase); its id carries the stage and the first 12 characters of the hash of the stop file's
// figures, so an answer given for one spending stop is never applied to the next one after a raise too small to pass it. A relayed continue is refused (going on is the person's own number: the relayed raise). Real stdio sessions on real stopped runs ($0, offline, mock seats that
// bill on paper: the fixture of test/finish-now-spending.test.js). WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. Each row has its control.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { session } from './helpers/mcp-stdio-session.js';
import { findStopCap } from './helpers/find-stop-cap.js';
import { runThroughChecks } from './helpers/build-check.js';
import { untilRunIdle } from './helpers/round-stop-project.js';
import { runResumability, finishedRunState } from '../src/run-status.js';
import { BUDGET_CONTINUE_REFUSAL } from '../src/gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const seat = (extra = {}) => ({ provider: 'mock', model: 'mock-priced', maxTokens: 4000, ...extra });
const CHAIN = { name: 'sf', signoff: 'unanimous', handoff: true, maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: seat({ maxTokens: 100 }), builder: seat({ lab: 'author' }), reviser: seat({ lab: 'author' }), critics: [seat({ lab: 'l1', layer: 1 }), seat({ lab: 'l2', layer: 2 }), seat({ lab: 'l3', layer: 3 })] } };
// FINDING (not on the owed list of the ladder unit; the box runs of 10 Nov 2026). OLD bar: the judges of this chain were priced seats. NEW bar: they are free seats (mock-review-fixture), the writer's expected draft is 100 tokens and a review's expected reply 900, so the cold read is the call whose (spent so far + expected cost) is the largest of the run; the box probe gives caps up to 0.7 stopping at the criteria stage, 0.75 to 1.3 at the cold read (phase after) and 3 pausing at the handoff. WHY: the cap gate refuses a call by its EXPECTED cost, and a priced judge's expected cost at the top layer ($1.47) is far above a short cold read's ($0.32): the last cap that lets the loop through also lets every later call through, so no cap stopped the run after the rounds (box probe: 2.05 stops at a judge, 2.06 reaches the handoff pause). Same change as test/finish-now-spending.test.js.
const EXTERNAL_HANDOFF = { ...CHAIN, name: 'sf-ext', estimate: { ...CHAIN.estimate, draftTokens: 100, critiqueTokens: 900 }, coldRead: { enabled: true }, seats: { ...CHAIN.seats, critics: CHAIN.seats.critics.map(c => ({ ...c, model: 'mock-review-fixture' })), coldRead: seat({ lab: 'cold' }), reviser: { provider: 'external', model: 'claude-code-session' }, handoff: { provider: 'external', model: 'claude-code-session' } } };   // the cold read bills AFTER the review rounds, so a cap can stop the run in the phase 'after' (with every judge signing off nothing else bills there; the handoff is a session's)   // chain-lint: a layered chain needs a handling session: an external reviser (hasHandlingSession) or an all-mock chain (isOfflineMockChain); the external HANDOFF seat breaks the second, so this chain has both. The task carries the mock's own marker, so every judge signs off on the first draft and the external reviser is never asked: each row still stops where its name says (stopIn asserts the phase of STOPPED-budget.json).
// FINDING (not on the owed list of the ladder unit; the set 6 box run of 10 Nov 2026). OLD bar (round 11): the free-judge chain above served both phases. NEW bar: it serves the phase 'after' only; a stop IN the loop needs a judge whose expected cost is above everything after it, so the loop rows run on the priced-judge chain below (the chain they ran on before round 11). WHY: with free judges nothing in the loop is gated above the cold read, so no cap stops the run in the phase 'loop' (set 6: 0.001 and 0.5 stop before, 1 to 1.3 after, from 1.5 up the run pauses at the handoff). The chain was changed for the phase 'after' without the loop rows being run on it. Same change as test/finish-now-spending.test.js.
const LOOP_EXTERNAL = { ...CHAIN, name: 'sf-ext-loop', coldRead: { enabled: true }, seats: { ...CHAIN.seats, coldRead: seat({ lab: 'cold' }), reviser: { provider: 'external', model: 'claude-code-session' }, handoff: { provider: 'external', model: 'claude-code-session' } } };
const ID = '2026-11-10T11-00-00-000Z';
// The grid of caps tried first; the stop AFTER the review rounds is a window of the cap that a grid can miss, so findStopCap (test/helpers/find-stop-cap.js) bisects between a stop and a finished run when the grid finds none (a finer grid between 2.5 and 2.75 was tried first and was wrong: the window depends on the chain's seats).
const CAPS = ['0.001', '0.5', '1', '1.5', '2', '2.25', '2.5', '2.52', '2.54', '2.56', '2.58', '2.6', '2.62', '2.64', '2.66', '2.68', '2.7', '2.72', '2.74', '2.75', '3', '3.25', '3.5', '3.75', '4', '5', '6', '8', '10', '12', '15', '20'];
function workspace(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fn-relay-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), `Plan a small thing with a retry limit.\n${chain.seats?.reviser?.provider === 'external' ? 'REVISED MOCK DELIVERABLE\n' : ''}`); writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain));
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  return { dir, run, runDir: join(dir, 'runs', ID) };
}
const stopFileOf = w => { try { return JSON.parse(readFileSync(join(w.runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } };
// FINDING (not on the owed list of the ladder unit; the second box run of 10 Nov 2026): OLD bar: the first cap of a fixed grid that stops the run in the phase; NEW bar: the same grid, then a bisection (test/helpers/find-stop-cap.js) where the grid goes from a stop to a finished run (the stop after the rounds is a window of a few cents or less), and the cap found is remembered per phase and chain. The premise is still asserted, with every cap tried in the message.
const capMemo = new Map();
function stopIn(phase, chain = phase === 'loop' ? LOOP_EXTERNAL : EXTERNAL_HANDOFF) {
  const key = `${phase}|${chain.name}`;
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the run went on from layer 3's sign-off to the cold read and the handoff. NEW: a layered run with an external reviser waits at the handler's build check after layer 3 signs off, so the stub answers it (good_to_build, runThroughChecks) and resumes under the run's saved cap. WHY: buildCheckSystem + buildCheckUser are recorded (src/chain.js:4991); the cause was read from exit 3 only, so the stop phases the search finds are for the box to confirm.
  const run = cap => { const w = workspace(chain); const r = runThroughChecks(w.run, ['--chain', chain.name, '--task', 'tasks/t.md', '--max-usd', cap, '--run-id', ID], () => w.runDir); return { status: r.status, phase: r.status === 4 ? stopFileOf(w)?.phase ?? null : null, w }; };
  if (capMemo.has(key)) { const a = run(capMemo.get(key)); if (a.status === 4 && a.phase === phase) return a.w; }
  const found = findStopCap({ phase, caps: CAPS, attempt: run });
  if (found.a) { capMemo.set(key, found.cap); return found.a.w; }
  assert.fail(`premise: no cap stopped the run in the phase "${phase}": ${found.tried.join(' | ')}`);
}
const call = (w, args) => session(w.dir, [{ name: 'stop_decide', arguments: { run: ID, ...args } }]).then(a => a[0]);
const ledgerOf = w => (existsSync(join(w.runDir, LEDGER_FILE)) ? readFileSync(join(w.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const readJson = (w, f) => JSON.parse(readFileSync(join(w.runDir, f), 'utf8'));
const WORDS = 'End the run now, I do not want to pay for anything more.';

test('RL-1 (the quote): a run stopped at its spending limit gets a quote through the person-only stop gate: the stop id names the stage and carries the hash of the stop file, the text says where it stopped, offers finish_now (and finish only inside the rounds), names the raise as the person\'s own number, and the gate is marked person_only', async () => {
  for (const [phase, choices] of [['after', /Choices: finish_now\./], ['loop', /Choices: finish \| finish_now\./]]) {
    const w = stopIn(phase);
    const q = await call(w, { step: 'quote' });
    assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 400));
    assert.match(q.stop_id, /^budget_stop:1:1:[A-Za-z0-9._-]+:[0-9a-f]{12}$/); assert.equal(q.person_only, true);
    assert.match(q.text, /THE RUN STOPPED AT ITS SPENDING LIMIT/); assert.match(q.text, choices); assert.match(q.text, /the person's own number/);
    assert.match(q.text, phase === 'loop' ? /The run then ends NOT agreed\./ : /The run then keeps the verdict the review rounds reached\./);
    assert.ok(ledgerOf(w).some(l => l.event === 'gate_requested' && l.kind === 'stop_decision'), 'the gate is asked for over the quote');
  }
});

test('RL-2 (refusals, nothing recorded): a relayed continue at a spending stop is refused with the sentence that names the relayed raise; the session\'s OWN answer (no words) is refused by the gate as the person\'s alone; a stop BEFORE the review rounds offers no quote; an unreadable partial report asks nothing (PS-16)', async () => {
  const w = stopIn('after');
  const q = await call(w, { step: 'quote' });
  const before = ledgerOf(w).length;
  const cont = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS });
  assert.equal(cont.error, BUDGET_CONTINUE_REFUSAL); assert.match(cont.error, /resume_run with the person's limit and their words \(the relayed raise\)/);
  const own = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', reason: 'I decide to end it', advisor: 'consulted', advisor_said: 'ok' });   // no words: the session\'s own answer
  assert.match(own.error, /This stop is the person's alone/);
  assert.equal(ledgerOf(w).length, before, 'nothing was recorded');
  const bare = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', person_words: WORDS });   // a plain finish exists only inside the rounds
  assert.match(bare.error, /choice must be one of finish_now: a plain finish ends a spending stop only inside the review rounds/);
  const unreadable = stopIn('after'); rmSync(join(unreadable.runDir, 'report-partial.json'));
  assert.match((await call(unreadable, { step: 'quote' })).error, /The spending stop cannot be read from this run/);
  const early = stopIn('before');
  assert.match((await call(early, { step: 'quote' })).error ?? '', /before the review rounds began, so there is no plan to end/);
});

test('RL-3 (the relayed finish-now, end to end): finish_now with the person\'s words ends the run at no cost (it pauses at the session\'s handoff, then a plain resume after the answer ends it); the ledger records it as RELAYED (channel session, relayed true, the words, the gate), never as typed; the report and the verdict say so; the session\'s own accept is refused; nothing is reserved', async () => {
  const w = stopIn('after');
  const reserved = existsSync(join(w.runDir, 'spend-reservations.jsonl')) ? readFileSync(join(w.runDir, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
  const q = await call(w, { step: 'quote' });
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish_now', person_words: WORDS });
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 400));
  assert.deepEqual([a.recorded.choice, a.recorded.actor, a.recorded.channel, a.recorded.relayed], ['finish_now', 'person', 'session', true]);
  await untilRunIdle(w.runDir);
  const line = ledgerOf(w).filter(l => l.event === 'budget_finish').at(-1);
  assert.ok(line, 'the person\'s finish is on the ledger');
  assert.deepEqual([line.channel, line.relayed, line.person_words, line.stop_gate, line.actor], ['session', true, WORDS, q.gate, 'person'], 'recorded as relayed, never as typed');
  writeFileSync(join(w.runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(w.runDir, 'handoff.md.partial'), join(w.runDir, 'handoff.md'));
  const ended = w.run(['--resume', w.runDir]);
  assert.ok([0, 22].includes(ended.status), `${ended.stdout}${ended.stderr}`);
  const rep = readJson(w, 'report.json');
  assert.equal(rep.spending_finish?.relayed, true);
  assert.equal(rep.spending_finish.relayed, true, 'the report says the choice was relayed (a stop after the rounds makes no stop of its own to word it)');
  if (Array.isArray(rep.stages_not_run)) assert.match(finishedRunState(rep), /relayed by the handling session/);
  const after = await session(w.dir, [{ name: 'stop_decide', arguments: { run: ID, step: 'quote' } }]);
  assert.ok(/may not accept/.test(after[0].note ?? '') || /agree/i.test(after[0].error ?? ''), `the session\'s own accept is refused (the person\'s to accept), or the run ended agreed and has nothing to accept: ${JSON.stringify(after[0]).slice(0, 300)}`);
  assert.equal((existsSync(join(w.runDir, 'spend-reservations.jsonl')) ? readFileSync(join(w.runDir, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0), reserved);
});

test('RL-4 (an answer for one spending stop is never applied to the next): after the answer was given for stop A, the stop file\'s figures change (a raise too small to pass the stage stops the run again at the SAME stage: the stop id carries the hash of those figures), and the old gate named with --stop-gate is REFUSED by the command line - nothing is recorded or run; the same command without the change is taken', async () => {
  const w = stopIn('after');
  const q = await call(w, { step: 'quote' });
  const gate = await session(w.dir, [{ name: 'stop_decide', arguments: { run: ID, step: 'quote' } }]).then(x => x[0].gate);   // the same gate (a repeated quote of an unchanged stop reuses it)
  assert.equal(gate, q.gate);
  // answer the gate on the ledger WITHOUT letting the tool resume the run: the gate is answered by the library the tool calls
  const { answerStopRelayed } = await import('../src/stop-gate.js');
  const done = answerStopRelayed(w.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'finish_now' });
  assert.equal(done.ok, true, JSON.stringify(done));
  const sp = join(w.runDir, 'STOPPED-budget.json'); const st = JSON.parse(readFileSync(sp, 'utf8'));
  const changed = { ...st, spentUsd: (st.spentUsd ?? 0) + 0.5 };   // what a second stop at the same stage looks like: the figures differ
  writeFileSync(sp, JSON.stringify(changed));
  const refused = w.run(['--resume', w.runDir, '--finish-now', '--stop-gate', q.gate]);
  assert.equal(refused.status, 2, `${refused.stdout}${refused.stderr}`); assert.match(`${refused.stdout}${refused.stderr}`, /no answered stop_decision gate of this run by that name matches this stop/);
  assert.ok(!ledgerOf(w).some(l => l.event === 'budget_finish'), 'nothing was recorded');
  writeFileSync(sp, JSON.stringify(st));   // control: the unchanged stop takes the same answer
  const taken = w.run(['--resume', w.runDir, '--finish-now', '--stop-gate', q.gate]);
  assert.ok([0, 3, 22].includes(taken.status), `${taken.stdout}${taken.stderr}`);
  assert.equal(ledgerOf(w).filter(l => l.event === 'budget_finish').at(-1)?.channel, 'session');
});

test('RL-5 (the ways on, named): run_status of a run stopped at its spending limit names finish-now as a way on (the open-question sentence is pure text of the same note); the MCP reply of a call that meets an open question names the same way - SOURCE-PINNED, not a behaviour test: the clause is composed in both branches of awaitingCapResult', () => {
  const w = stopIn('after');
  const meta = readJson(w, 'run.json');
  const res = runResumability(w.runDir, meta);
  assert.equal(res.needs, 'higher_cap'); assert.match(res.note ?? '', /ends the run here at no cost \(stop_decide: step quote, then step answer with finish_now/);
  assert.doesNotMatch(res.note, /A limit question is open/);
  const src = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
  assert.equal([...src.matchAll(/\$\{endHereClause\(id\)\}/g)].length, 2, 'both branches of awaitingCapResult name the way on');
});

test('RL-6 (a raise breaks the answer): an answer relayed for a spending stop is refused by the command line once a spending limit was APPROVED after the answer\'s gate was asked for, even with the stop file unchanged (the stop file is project-writable); nothing is recorded or run', async () => {
  const w = stopIn('after');
  const q = await call(w, { step: 'quote' });
  const { answerStopRelayed } = await import('../src/stop-gate.js');
  assert.equal(answerStopRelayed(w.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'finish_now' }).ok, true);
  // the person approves a limit afterwards: a limit gate requested and answered on the ledger (the library the terminal and the dialog use)
  const { requestGate, answerGate, RUN_CAP_KIND } = await import('../src/gate.js');
  const file = 'cap-screen-99.md'; writeFileSync(join(w.runDir, file), 'A limit.\n');
  const asked = requestGate(w.runDir, { kind: RUN_CAP_KIND, textPath: file, cap: { operation: 'raise', run_id: ID, scope_sha256: 'a'.repeat(64), ceiling_usd: null, ceiling_source: null } });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  const ok = answerGate(w.runDir, asked.gate.id, { channel: 'cli', shownSha256: asked.gate.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: '1000' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const before = ledgerOf(w).filter(l => l.event === 'budget_finish').length;
  const refused = w.run(['--resume', w.runDir, '--finish-now', '--stop-gate', q.gate]);
  assert.equal(refused.status, 2, `${refused.stdout}${refused.stderr}`); assert.match(`${refused.stdout}${refused.stderr}`, /or a spending limit was approved after it was given/);   // FINDING (not on the owed list of the ladder unit; set 6, first run of this row on a real stop). OLD bar: the pattern /a spending limit was approved after that answer was given/. NEW bar: the sentence of wording row LAD-R9 (src/cli.js relayedBudgetChoice), which says "that answer was not given for exactly this spending stop (...), or a spending limit was approved after it was given, or the record cannot be read". WHY: the row's pattern was written from memory of a wording the source never had; set 5 failed it earlier on the 'after' premise, so it had not reached this line.
  assert.equal(ledgerOf(w).filter(l => l.event === 'budget_finish').length, before, 'nothing was recorded');
  assert.ok(!existsSync(join(w.runDir, 'report.json')));
});

test('RL-7 (a finish-now whose command took the answer keeps it): recordBudgetFinish with a relayed gate writes a line that names the gate; budgetFinishTakenFromGate is true for that gate, false for another and false for a ledger with no such line - the tool does not close an answer the command already acted on, even when the resume then exited 4', async () => {
  // FINDING (not on the owed list of the ladder unit; set 6, first run of this row on a real stop). OLD bar: a gate id 'g1' that does not exist was recorded behind. NEW bar: the line is written behind the approved person-only answer of THIS stop (the rule RL-11 pins: a relayed line for a gate that does not exist, is pending, or was answered for another stop, choice or words is refused with budget_finish_unanswered). WHY: the row was written before that rule and never ran on a real stop (set 5 failed it on the 'after' premise).
  const w = stopIn('after');
  const q = await call(w, { step: 'quote' });
  const { recordBudgetFinish, budgetFinishTakenFromGate } = await import('../src/gate.js'); const { answerStopRelayed } = await import('../src/stop-gate.js');
  assert.equal(budgetFinishTakenFromGate(w.runDir, q.gate), false, 'no such line yet');
  assert.equal(answerStopRelayed(w.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'finish_now' }).ok, true);
  assert.equal(recordBudgetFinish(w.runDir, { stopSha256: 'e'.repeat(64), phase: 'after', choice: 'finish_now', stopId: q.stop_id, relayed: { personWords: WORDS, gate: q.gate } }).ok, true);
  assert.equal(budgetFinishTakenFromGate(w.runDir, q.gate), true); assert.equal(budgetFinishTakenFromGate(w.runDir, 'g2'), false);
  const src = readFileSync(join(root, 'src', 'mcp', 'stop-decide.js'), 'utf8');
  assert.match(src, /resumed\?\.resumed === false && !\(s\.budget && budgetFinishTakenFromGate\(s\.dir, args\.gate\)\)/, 'source pin: the close is skipped for a spending stop the command took');
});

const WORDS2 = 'Raise nothing; end it after the last read.';
test('RL-8 (the relayed plain finish, inside the rounds): finish with the person\'s words is taken by the command (it records the choice and exits 4 BY DESIGN): the ledger holds it as RELAYED (choice finish, channel session, the words, the gate) and the tool does NOT close the answer (the fact is the ledger line naming the gate, not run.json); the run stays stopped', async () => {
  const w = stopIn('loop');
  const q = await call(w, { step: 'quote' });
  assert.match(q.text, /Stop file hash: [0-9a-f]{64}/, 'the full hash is in the text the gate hashes');
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', person_words: WORDS2 });
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 400));
  await untilRunIdle(w.runDir);
  assert.match(a.note ?? '', /The person's finish is recorded on the ledger and the command ended at once, by design: the run stays stopped and waits for the person's raise/, 'the reply says the choice is recorded and not to repeat the call (an agent reads resumed:false as a failure)');
  assert.ok(!ledgerOf(w).some(l => l.event === 'stop_answer_closed'), 'the answer was not closed');
  const line = ledgerOf(w).filter(l => l.event === 'budget_finish').at(-1);
  assert.deepEqual([line?.choice, line?.channel, line?.relayed, line?.person_words, line?.stop_gate], ['finish', 'session', true, WORDS2, q.gate]);
  assert.deepEqual([readJson(w, 'run.json').budgetFinish?.via, readJson(w, 'run.json').budgetFinish?.relayed], ['session', true]);
  assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')) && !existsSync(join(w.runDir, 'report.json')), 'recorded, nothing ended: the end comes with a typed raise');
});

test('RL-9 (a relayed finish then the raise ends as the typed pair does): after a RELAYED plain finish a typed raise ends the run at the stage it stopped before, NOT agreed, budget_stop / finish, after the final read; the same sequence typed ends the same way; the relayed one says so', async () => {
  const relayed = stopIn('loop'); const typed = stopIn('loop');
  const q = await call(relayed, { step: 'quote' });
  await call(relayed, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', person_words: WORDS2 }); await untilRunIdle(relayed.runDir);
  assert.equal(typed.run(['--resume', typed.runDir, '--finish']).status, 4);
  const cap = stopFileOf(relayed).capUsd;
  const r1 = relayed.run(['--resume', relayed.runDir, '--max-usd', String(cap * 100)]); const r2 = typed.run(['--resume', typed.runDir, '--max-usd', String(cap * 100)]);
  const shape = w => { const rep = existsSync(join(w.runDir, 'report.json')) ? readJson(w, 'report.json') : null; return rep ? [rep.passed, rep.stop?.kind, rep.stop?.chosen, rep.final_read?.ran ?? null] : [`no report (exit ${w === relayed ? r1.status : r2.status})`]; };
  assert.deepEqual(shape(relayed), shape(typed), 'the same ending through the session as at the terminal');
  if (existsSync(join(relayed.runDir, 'report.json'))) { assert.equal(readJson(relayed, 'report.json').stop?.relayed, true); assert.equal(readJson(typed, 'report.json').stop?.relayed, undefined); }
});

test('RL-10 (a relayed plain finish after a finish-now record sets that record aside): the finish-now is on record (the run paused at the session\'s handoff); the stop can still be quoted (the person may change their mind); a relayed finish is the later choice: run_status reads a spending stop again (budget_stopped / higher_cap) and a plain resume is held by the limit', async () => {
  const w = stopIn('loop');
  assert.equal(w.run(['--resume', w.runDir, '--finish-now']).status, 3, 'premise: the ending pauses at the handoff with the finish-now on record');
  const q = await call(w, { step: 'quote' });
  assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 300)); assert.match(q.text, /The person's finish_now is on record/);
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', person_words: WORDS2 });
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 300)); await untilRunIdle(w.runDir);
  const res = runResumability(w.runDir, readJson(w, 'run.json'));
  assert.deepEqual([res.status, res.needs], ['budget_stopped', 'higher_cap'], JSON.stringify(res).slice(0, 300));
  const held = w.run(['--resume', w.runDir]);
  assert.equal(held.status, 4, `${held.stdout}${held.stderr}`); assert.ok(!existsSync(join(w.runDir, 'report.json')));
});

test('RL-11 (what must precede a relayed ledger line): recordBudgetFinish with a relayed gate is refused (nothing written) when the gate does not exist, is only pending, was answered for another stop, another choice or other words; it is taken behind the approved person-only answer of THIS stop with this choice and these words', async () => {
  const w = stopIn('after');
  const q = await call(w, { step: 'quote' });
  const { recordBudgetFinish, readGateAnswer } = await import('../src/gate.js'); const { answerStopRelayed } = await import('../src/stop-gate.js');
  const sha = 'f'.repeat(64);
  const rec = relayed => recordBudgetFinish(w.runDir, { stopSha256: sha, phase: 'after', choice: 'finish_now', stopId: q.stop_id, relayed });
  const lines = () => ledgerOf(w).filter(l => l.event === 'budget_finish').length;
  assert.equal(rec({ personWords: WORDS, gate: 'g-nope' }).code, 'budget_finish_unanswered');
  assert.equal(rec({ personWords: WORDS, gate: q.gate }).code, 'budget_finish_unanswered', 'only pending');
  assert.equal(lines(), 0);
  assert.equal(answerStopRelayed(w.runDir, q.gate, { shownSha256: q.shown, personWords: WORDS, choice: 'finish_now' }).ok, true);
  assert.equal(readGateAnswer(w.runDir, q.gate).status, 'approved');
  assert.equal(recordBudgetFinish(w.runDir, { stopSha256: sha, phase: 'after', choice: 'finish_now', stopId: 'budget_stop:1:1:other-stage', relayed: { personWords: WORDS, gate: q.gate } }).code, 'budget_finish_unanswered', 'another stop');
  assert.equal(recordBudgetFinish(w.runDir, { stopSha256: sha, phase: 'after', choice: 'finish', stopId: q.stop_id, relayed: { personWords: WORDS, gate: q.gate } }).code, 'budget_finish_unanswered', 'another choice (the plain finish does not exist after the rounds either)');
  assert.equal(rec({ personWords: 'other words', gate: q.gate }).code, 'budget_finish_unanswered', 'other words');
  assert.equal(lines(), 0, 'nothing was written by any refusal');
  assert.equal(rec({ personWords: WORDS, gate: q.gate }).ok, true); assert.equal(lines(), 1);
});

test('RL-12 (the full hash): gateQuoteNamesHash is true only for the exact 64-character hash of the stop file named in the quote the gate holds; a hash that shares the first 12 characters (the id) is not enough', async () => {
  const w = stopIn('after');
  const q = await call(w, { step: 'quote' });
  const { gateQuoteNamesHash } = await import('../src/gate.js'); const { stopShaOf } = await import('../src/spend-finish.js');
  const sha = stopShaOf(stopFileOf(w));
  assert.equal(gateQuoteNamesHash(w.runDir, q.gate, sha), true);
  assert.equal(gateQuoteNamesHash(w.runDir, q.gate, `${sha.slice(0, 12)}${'0'.repeat(52)}`), false, 'same 12 characters, another stop');
  assert.equal(gateQuoteNamesHash(w.runDir, 'g-nope', sha), false); assert.equal(gateQuoteNamesHash(w.runDir, q.gate, 'short'), false);
  assert.ok(q.stop_id.endsWith(`:${sha.slice(0, 12)}`));
});

test('RL-13 (a found-secret pause beside the spending stop is still refused): with STOPPED-secret.md in the folder - with no finish on record (the budget file would read as the stop) and with the finish on record while a session stage waits (the override would read it as the stop) - the tool quotes nothing and answers nothing: the secret pause is the person\'s alone and only the terminal answers it. The marker is hand-written here (a credential-shaped prompt cannot be produced on a mock chain): a named limit of the row', async () => {
  const a = stopIn('after');
  writeFileSync(join(a.runDir, 'STOPPED-secret.md'), '# Paused at a credential-shaped string\n');
  for (const step of ['quote', 'answer', 'defer']) assert.match((await call(a, { step, gate: 'g1', shown: 'x', choice: 'finish_now', person_words: WORDS })).error ?? '', /This pause is the person's \(a credential-shaped string/, `no record: ${step}`);
  const b = stopIn('after');
  assert.equal(b.run(['--resume', b.runDir, '--finish-now']).status, 3, 'premise: the finish-now is on record and the handoff waits');
  writeFileSync(join(b.runDir, 'STOPPED-secret.md'), '# Paused at a credential-shaped string\n');
  assert.match((await call(b, { step: 'quote' })).error ?? '', /This pause is the person's \(a credential-shaped string/, 'with the record standing');
  assert.ok(ledgerOf(b).every(l => l.event !== 'gate_requested' || l.kind !== 'stop_decision'), 'no stop_decision gate was asked for');
});

// ---------- fix-ups on the relay commit ----------
test('RL-14 (a chain with no final read: the tool offers only what the terminal takes): a stop inside the review rounds of a chain with NO final read is quoted with finish_now only, and a relayed plain finish is refused with the sentence for it before anything is recorded; on a chain with a final read (RL-1) both are offered', async () => {
  const flat = JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8'));
  const w = stopIn('loop', { ...flat, name: 'flat-budget' });
  const q = await call(w, { step: 'quote' });
  assert.equal(q.error, undefined, JSON.stringify(q).slice(0, 300)); assert.match(q.text, /Choices: finish_now\./);
  const before = ledgerOf(w).length;
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'finish', person_words: WORDS });
  assert.match(a.error ?? '', /choice must be one of finish_now/); assert.equal(ledgerOf(w).length, before, 'nothing was recorded');
});

test('RL-15b (a marker WITHOUT its record, beside a spending stop, with the finish on record): run_status reads the pause (secret_blocked / fix_cause: the older kind) and resume_run refuses it the same way as with a whole record - the marker decides in both; nothing is spawned', async () => {
  const w = stopIn('after');
  assert.equal(w.run(['--resume', w.runDir, '--finish-now']).status, 3, 'premise: the finish-now is on record and the handoff waits');
  writeFileSync(join(w.runDir, 'STOPPED-secret.md'), '# Paused at a credential-shaped string\\n');
  const res = runResumability(w.runDir, readJson(w, 'run.json'));
  assert.deepEqual([res.reason, res.needs], ['secret_blocked', 'fix_cause'], JSON.stringify(res).slice(0, 300)); assert.match(res.note ?? '', /only a command typed at a terminal answers it, and `council --resume <run>` there pauses it again and writes the record/);
  const before = readdirSync(w.dir).filter(f => /^council-.*\.log$/.test(f)).length;
  const [rr] = await session(w.dir, [{ name: 'resume_run', arguments: { run: ID } }]);
  assert.equal(rr.resumed, false); assert.match(rr.note ?? '', /The pause comes first/);
  assert.equal(readdirSync(w.dir).filter(f => /^council-.*\.log$/.test(f)).length, before, 'nothing was spawned');
});

test('RL-15 (a secret pause beside a spending stop is named FIRST by run_status and resume_run): with a whole secret-stop record and its marker in the folder of a run stopped at its spending limit, run_status reads the pause (paused_secret, person_choice), not a higher limit, and resume_run starts nothing and names the pause; the files are hand-written (a named limit: no credential-shaped prompt can be produced on a mock chain)', async () => {
  const w = stopIn('after');
  writeFileSync(join(w.runDir, 'STOPPED-secret.md'), '# Paused at a credential-shaped string\n\nThe commands are here.\n');
  writeFileSync(join(w.runDir, 'secret-stop.json'), JSON.stringify({ schema: 'secret-stop/1', stop: 'a'.repeat(16), label: 'dispute', at: '2026-11-10T12:00:00.000Z', phase: 'after', findings: [], values: ['b'.repeat(32)] }));
  const res = runResumability(w.runDir, readJson(w, 'run.json'));
  assert.deepEqual([res.reason, res.needs], ['paused_secret', 'person_choice'], JSON.stringify(res).slice(0, 300));
  const [rs, rr] = await session(w.dir, [{ name: 'run_status', arguments: { run: ID } }, { name: 'resume_run', arguments: { run: ID } }]);
  assert.equal(rr.resumed, false); assert.match(rr.note ?? '', /The pause comes first and only a command typed at a terminal answers it/);
  assert.ok(!readdirSync(w.dir).some(f => /^council-.*\.log$/.test(f)), 'nothing was spawned');
  assert.doesNotMatch(JSON.stringify(rs), /higher_cap/, 'run_status does not ask for a higher limit');
});

test('RL-16 (the one reader; the sentence is true for both files): the stop tool refuses on EITHER secret file. With the marker (STOPPED-secret.md) the sentence points at it; with only the record (secret-stop.json, a leftover: the terminal tests the marker, and a sitting\'s start deletes both) the sentence says so and names the terminal command, and run_status and resume_run (which report a pause on the marker) are not moved by a leftover record', async () => {
  const w = stopIn('after');
  writeFileSync(join(w.runDir, 'secret-stop.json'), JSON.stringify({ schema: 'secret-stop/1', stop: 'a'.repeat(16), label: 'dispute', at: '2026-11-10T12:00:00.000Z', findings: [], values: ['b'.repeat(32)] }));
  const q = await call(w, { step: 'quote' });
  assert.match(q.error ?? '', /holds the record of a pause at a credential-shaped string \(secret-stop\.json in runs\/[^)]*\) without the marker that goes with it, so it is probably a leftover and no pause waits/); assert.doesNotMatch(q.error ?? '', /STOPPED-secret\.md/, 'it does not point at a file that is not there');
  const res = runResumability(w.runDir, readJson(w, 'run.json'));
  assert.equal(res.needs, 'higher_cap', 'run_status: a leftover record is no pause (the terminal does not treat it as one)');
  writeFileSync(join(w.runDir, 'STOPPED-secret.md'), '# Paused\n');
  const r = await call(w, { step: 'quote' });
  assert.match(r.error ?? '', /the commands are in STOPPED-secret\.md in runs\//); assert.ok(existsSync(join(w.runDir, 'STOPPED-secret.md')));
});

test('RL-17 (the ending after the raise is armed from the ledger, never run.json alone): a planted run.json budgetFinish with NO ledger line is not applied - the raise sitting goes on as a plain raise (no budget_stop in the report) and says so; the same sequence behind a real typed --finish (a ledger line) ends the run at the stop, after the final read', () => {
  const planted = stopIn('loop'); const real = stopIn('loop');
  const cap = stopFileOf(planted).capUsd;
  const p = join(planted.runDir, 'run.json'); const j = readJson(planted, 'run.json');
  writeFileSync(p, JSON.stringify({ ...j, budgetFinish: { choice: 'finish', label: stopFileOf(planted).stoppedAt, at: new Date().toISOString(), via: 'cli' } }, null, 2));
  const a = planted.run(['--resume', planted.runDir, '--max-usd', String(cap * 100)]);
  assert.match(`${a.stdout}${a.stderr}`, /run\.json holds a finish for this spending stop that the approval record does not, so it is not applied/);
  assert.notEqual(existsSync(join(planted.runDir, 'report.json')) ? readJson(planted, 'report.json').stop?.kind : null, 'budget_stop', 'the planted entry did not end the run');
  assert.equal(real.run(['--resume', real.runDir, '--finish']).status, 4);
  const b = real.run(['--resume', real.runDir, '--max-usd', String(cap * 100)]);
  assert.match(`${b.stdout}${b.stderr}`, /you chose to end the run at the spending stop/);
});

test('RL-18 (a raise approved after a finish does not set the plain finish aside; a later finish_now does): pure rows on budgetPlainFinishOf - the relayed raise that lets the ending run is not a later choice. The REAL-VERB row (a relayed finish then a RELAYED raise through resume_run with the person\'s limit and words) is NOT RUN: the test\'s own counting stub answers 500 and gives no valid critique, so on it a typed limit cannot stop a run inside the review rounds (a stub that answered a valid critique completion would allow it; it is not built), and a free chain has no relayed raise', async () => {
  const { budgetPlainFinishOf } = await import('../src/gate-ledger.js');
  const sha = 'c'.repeat(64);
  const fin = (seq, choice) => ({ event: 'budget_finish', stop_sha256: sha, phase: 'loop', choice, actor: 'person', channel: 'session', relayed: true, person_words: WORDS, stop_gate: 'g1', seq, ts: 't' });
  const raise = seq => ({ event: 'gate_answered', gate: 'cap1', decision: 'approved', channel: 'session', seq });
  assert.equal(budgetPlainFinishOf([fin(1, 'finish')], sha)?.seq, 1);
  assert.equal(budgetPlainFinishOf([fin(1, 'finish'), { event: 'gate_requested', kind: 'run_cap', gate: 'cap1', requested_by: 'session', seq: 2 }, raise(3)], sha)?.seq, 1, 'the relayed raise does not set it aside');
  assert.equal(budgetPlainFinishOf([fin(1, 'finish'), fin(2, 'finish_now')], sha), null, 'a later finish_now replaces it');
  assert.equal(budgetPlainFinishOf([fin(1, 'finish_now')], sha), null);
});

test('RL-19 (a failed ledger write on a typed plain finish records NOTHING): with the approval record unwritable (read-only), a typed --finish exits 2 before run.json is touched: no budgetFinish entry, no new ledger line, the run still stopped; skipped under root (NOT RUN there)', async () => {
  if (!process.getuid || process.getuid() === 0) return;
  const w = stopIn('loop');
  const { recordBudgetFinish } = await import('../src/gate.js');
  assert.equal(recordBudgetFinish(w.runDir, { stopSha256: 'd'.repeat(64), phase: 'loop', choice: 'finish_now' }).ok, true, 'premise: a ledger file exists');
  const lp = join(w.runDir, LEDGER_FILE); const lines = ledgerOf(w).length; chmodSync(lp, 0o444);
  try {
    const r = w.run(['--resume', w.runDir, '--finish']);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`); assert.match(`${r.stdout}${r.stderr}`, /--finish: your choice could not be recorded/);
    assert.equal(readJson(w, 'run.json').budgetFinish, undefined, 'run.json was not touched');
    assert.equal(ledgerOf(w).length, lines); assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')));
  } finally { chmodSync(lp, 0o644); }
});

test('RL-20 (a plain finish, a raise too small, the run stops AGAIN after the rounds: the next raise still ENDS the rounds): on a chain whose handoff bills, a typed --finish at a stop inside the rounds, then raises of growing size until the run stops a second time (a new stop file, another hash), then one more raise: the sitting says it ends the run at the stage the person chose (the arming is the run\'s plain finish line, not the first stop\'s hash) and that stage was never run; pure rows on budgetPlainFinishOfRun hold the rule', async () => {
  const { budgetPlainFinishOfRun } = await import('../src/gate-ledger.js');
  const ln = (seq, choice, sha) => ({ event: 'budget_finish', stop_sha256: sha, phase: 'loop', choice, label: 'panel-2-l1', actor: 'person', channel: 'cli', seq });
  assert.equal(budgetPlainFinishOfRun([ln(1, 'finish', 'a'.repeat(64))])?.label, 'panel-2-l1', 'armed at any later stop (another hash)');
  assert.equal(budgetPlainFinishOfRun([ln(1, 'finish', 'a'.repeat(64)), ln(2, 'finish_now', 'b'.repeat(64))]), null, 'a later finish_now replaces it');
  assert.equal(budgetPlainFinishOfRun([]), null);
  const w = stopIn('loop', CHAIN);
  const first = stopFileOf(w); const stageX = first.stoppedAt;
  assert.equal(w.run(['--resume', w.runDir, '--finish']).status, 4);
  const tried = []; let second = null;
  for (const cap of CAPS.filter(c => Number(c) > first.capUsd)) {
    const r = w.run(['--resume', w.runDir, '--max-usd', cap]);
    const st = stopFileOf(w); tried.push(`${cap}: exit ${r.status}, phase ${st?.phase ?? '-'}, stage ${st?.stoppedAt ?? '-'}`);
    if (r.status === 4 && st?.phase === 'after') { second = { cap: Number(cap), st }; break; }
    if (r.status !== 4) break;
  }
  assert.ok(second, `premise: a raise too small to pay what follows the rounds stopped the run a second time: ${tried.join(' | ')}`);
  assert.notEqual(second.st.stoppedAt, stageX, 'the second stop is another stop');
  const next = CAPS.find(c => Number(c) > second.cap);
  const r2 = w.run(['--resume', w.runDir, '--max-usd', next]);
  assert.match(`${r2.stdout}${r2.stderr}`, new RegExp(`you chose to end the run at the spending stop \\(stage "${stageX}"\\)`), 'the next raise ends the rounds at the stage the person chose, not at the second stop\'s stage');
  assert.ok(!existsSync(join(w.runDir, `${stageX}.md`)), 'the stage the person chose to end was never run');
});

test('RL-21 (the shipped-chain shape: the run stops at something that is NOT a spending stop): a typed --finish inside the rounds, then a raise large enough to pay the final read: the loop ends at the stage chosen and the run pauses at the SESSION\'S handoff (exit 3, no spending stop files); after the answer a plain resume still ends the rounds at the stage chosen (the sitting says so) and that stage never ran', () => {
  const w = stopIn('loop');
  const first = stopFileOf(w); const stageX = first.stoppedAt;
  assert.equal(w.run(['--resume', w.runDir, '--finish']).status, 4);
  const big = w.run(['--resume', w.runDir, '--max-usd', String(first.capUsd * 100)]);
  assert.equal(big.status, 3, `premise: the handoff waits: ${big.stdout}${big.stderr}`); assert.ok(!existsSync(join(w.runDir, 'STOPPED-budget.json')), 'no spending stop file now');
  assert.match(`${big.stdout}${big.stderr}`, new RegExp(`you chose to end the run at the spending stop \\(stage "${stageX}"\\)`));
  writeFileSync(join(w.runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(w.runDir, 'handoff.md.partial'), join(w.runDir, 'handoff.md'));
  const again = w.run(['--resume', w.runDir]);
  assert.ok([0, 22].includes(again.status), `${again.stdout}${again.stderr}`);
  assert.match(`${again.stdout}${again.stderr}`, new RegExp(`you chose to end the run at the spending stop \\(stage "${stageX}"\\)`), 'armed again with no spending stop file in the folder');
  assert.ok(!existsSync(join(w.runDir, `${stageX}.md`)), 'the stage the person chose to end was never run');
});

test('RL-22 (an END-STATE row, not a discriminating one: the rulings reader refuses a damaged ledger on every resume before the arming block, and the new check there is a backstop): after a typed --finish, with the ledger damaged, a raise REFUSES (exit 2, the sentence that says it cannot be told whether the rounds were chosen to end) and runs nothing: the stage chosen never ran, no report, nothing reserved', () => {
  const w = stopIn('loop');
  const first = stopFileOf(w); const stageX = first.stoppedAt;
  assert.equal(w.run(['--resume', w.runDir, '--finish']).status, 4);
  const lp = join(w.runDir, LEDGER_FILE); writeFileSync(lp, `${readFileSync(lp, 'utf8')}this is not a ledger line\n`);
  const r = w.run(['--resume', w.runDir, '--max-usd', String(first.capUsd * 100)]);
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`); assert.match(`${r.stdout}${r.stderr}`, /approval record|ledger/i);
  assert.ok(!existsSync(join(w.runDir, `${stageX}.md`)) && !existsSync(join(w.runDir, 'report.json')), 'nothing ran');
});

test('RL-23 (the way back that existed before the ledger record still exists): a typed --finish, then the budgetFinish entry removed from run.json by hand (what the older refusal sentence told a person to do): the next raise does NOT end the rounds - the sitting says the finish is taken back and the stage chosen runs; (the control: the same raise with the entry present ends the rounds)', () => {
  const back = stopIn('loop'); const kept = stopIn('loop');
  const stageX = stopFileOf(back).stoppedAt; const cap = stopFileOf(back).capUsd;
  assert.equal(back.run(['--resume', back.runDir, '--finish']).status, 4); assert.equal(kept.run(['--resume', kept.runDir, '--finish']).status, 4);
  const p = join(back.runDir, 'run.json'); const j = readJson(back, 'run.json'); delete j.budgetFinish; writeFileSync(p, JSON.stringify(j, null, 2));
  const a = back.run(['--resume', back.runDir, '--max-usd', String(cap * 100)]);
  assert.match(`${a.stdout}${a.stderr}`, /the approval record holds your finish for this run, but run\.json no longer does \(the entry was removed\): the finish is taken back/);
  assert.doesNotMatch(`${a.stdout}${a.stderr}`, /you chose to end the run at the spending stop/);
  const b = kept.run(['--resume', kept.runDir, '--max-usd', String(cap * 100)]);
  assert.match(`${b.stdout}${b.stderr}`, new RegExp(`you chose to end the run at the spending stop \\(stage "${stageX}"\\)`), 'control');
});

test('RL-24 (the armed ending never overrides a choice made later in the run): SOURCE-PINNED - the armed ending acts only through SpendFinish, which invoke() and the build-check path throw only while scanPhase is the review loop, so a choice taken after the loop (a --continue at the final-read stop, a session\'s answer, an excerpt answer) is read by the stage that owns it; and an in-loop stop cannot sit after the stage the person chose to end, which is the first uncached call of the loop', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const sites = [...src.matchAll(/if \(spendFinish && scanPhase === 'loop'\)/g)].length;
  assert.equal(sites, 2, 'both throw sites are guarded by the loop phase');
  assert.equal([...src.matchAll(/throw new SpendFinish\(/g)].length, 2);
});

// ---------- unit-end items (i) and (ii), C&C 10 Nov 2026 ----------
test('RL-25 (unit-end item i: the person reads what their finish does BEFORE the limit is approved): the raise screen is the stored gate text every path reads. PURE: a raise/raise_early/amend/legacy screen carries the finish line (prefix "What your finish does: "), a first screen does not; SOURCE PINS: the terminal answerer, the MCP dialog and the relayed raise all read that stored text, and a PENDING screen is reused only while its finish line is still true (start-cap.js compares it). NAMED: no real-verb row reaches a limit gate with a plain finish on record - the counting stub stops only at phase after, where no plain finish exists (as RL-18)', async () => {
  const { buildCapScreen } = await import('../src/cap-screen.js');
  const NOTE = 'you chose to end the run at the spending stop (stage "x"): the rounds end there.';
  for (const kind of ['raise', 'raise_early', 'amend', 'legacy']) assert.match(buildCapScreen({ kind, history: { previousCapUsd: 1, spentUsd: 0.9, floorUsd: 0.9, finishNote: NOTE } }).text, /What your finish does: you chose to end the run at the spending stop \(stage "x"\)/, kind);
  assert.doesNotMatch(buildCapScreen({ kind: 'run', history: { finishNote: NOTE } }).text, /you chose to end the run/, 'a first screen has no finish to name');
  const server = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8'); const terminal = readFileSync(join(root, 'src', 'gate-cli.js'), 'utf8');
  assert.match(server, /const capScreenOf = capGateScreen;/, 'the MCP dialog asks the stored text'); assert.match(server, /const screen = capGateScreen\(runDir, gate\);/, 'the relayed raise reads the stored text');
  assert.match(terminal, /const bytes = readGateText\(runDir, state\.gate\.text\);/, 'the terminal answerer reads the stored text');
  assert.match(readFileSync(join(root, 'src', 'start-cap.js'), 'utf8'), /startsWith\(FINISH_NOTE_PREFIX\)/, 'a pending screen whose finish line is no longer true is asked again');
});

test('RL-26 (unit-end item ii: the way back by a word): finish then --continue with the raise: the rounds RUN (the stage the finish named is made), the ledger shows finish then continue in order; the control, finish then the raise alone: the run ends at that stage; continue then finish again: the run ends; a --continue with no finish on record is refused with a true sentence and records nothing', () => {
  const big = w => String(stopFileOf(w).capUsd * 100);
  const a = stopIn('loop'); const stageX = stopFileOf(a).stoppedAt; const bigA = big(a);
  assert.equal(a.run(['--resume', a.runDir, '--finish']).status, 4);
  a.run(['--resume', a.runDir, '--continue', '--max-usd', bigA]);
  assert.deepEqual(ledgerOf(a).filter(l => l.event === 'budget_finish').map(l => l.choice), ['finish', 'continue']);
  assert.ok(existsSync(join(a.runDir, `${stageX}.md`)), 'the rounds went on: the stage the finish named was made');
  const c = stopIn('loop'); const bigC = big(c);
  assert.equal(c.run(['--resume', c.runDir, '--finish']).status, 4);
  c.run(['--resume', c.runDir, '--max-usd', bigC]);
  assert.ok(!existsSync(join(c.runDir, `${stageX}.md`)), 'the control: the raise alone ends the run at that stage');
  const d = stopIn('loop'); const bigD = big(d);
  assert.equal(d.run(['--resume', d.runDir, '--finish']).status, 4);
  d.run(['--resume', d.runDir, '--continue']);   // records the way back (it may wait for a limit: exit 21)
  assert.equal(d.run(['--resume', d.runDir, '--finish']).status, 4);
  d.run(['--resume', d.runDir, '--max-usd', bigD]);
  assert.deepEqual(ledgerOf(d).filter(l => l.event === 'budget_finish').map(l => l.choice), ['finish', 'continue', 'finish'], 'both choices in order');
  assert.ok(!existsSync(join(d.runDir, `${stageX}.md`)), 'the latest choice decides: finish again, and the run ends');
  const e = stopIn('loop');
  const refused = e.run(['--resume', e.runDir, '--continue']);
  assert.equal(refused.status, 2); assert.match(refused.stderr, /--continue: this run is stopped at its spending limit and no finish of yours is on record, so there is nothing to go on past\./);
  assert.deepEqual(ledgerOf(e).filter(l => l.event === 'budget_finish'), [], 'nothing was recorded');
});

test('RL-27 (unit-end item ii, relayed): the quote offers continue only once a finish of the person is on record; a relayed continue with the person\'s words is recorded after the finish, in order, with the words and the gate; a relayed continue before any finish is still refused', async () => {
  const w0 = stopIn('loop');   // the control, in its own workspace (a pending quote gate is reused, so it must not be the one asked later)
  const q0 = await call(w0, { step: 'quote' });
  assert.doesNotMatch(q0.text, /Choices:[^\n]*continue/, 'nothing to go on past yet');
  assert.equal((await call(w0, { step: 'answer', gate: q0.gate, shown: q0.shown, choice: 'continue', person_words: WORDS })).error, BUDGET_CONTINUE_REFUSAL);
  const w = stopIn('loop');
  assert.equal(w.run(['--resume', w.runDir, '--finish']).status, 4);
  const q = await call(w, { step: 'quote' });
  assert.match(q.text, /Choices:[^\n]*continue/, 'a finish is on record: the way back is offered');
  const a = await call(w, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS });
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 300)); await untilRunIdle(w.runDir);
  const lines = ledgerOf(w).filter(l => l.event === 'budget_finish');
  assert.deepEqual(lines.map(l => [l.choice, l.channel]), [['finish', 'cli'], ['continue', 'session']]);
  assert.deepEqual([lines[1].relayed, lines[1].person_words, lines[1].stop_gate], [true, WORDS, q.gate]);
});
