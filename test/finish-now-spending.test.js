// 0.8.4 (the ladder unit; C&C 10 Nov 2026, step 2 of the rest of commit 4): `--finish-now` at a SPENDING stop (STOPPED-budget.json). The person ends the run in the one command: no raise, no limit screen. The sitting makes no call that bills
// (chain.js NotRunForLimit, thrown by invoke() after the cache and before the reservation), asks no judge again, and names every call it did not make (report.json stages_not_run). The verdict stays what the panel and the final read produced.
// ROWS: in-process (the fixture of test/finish-now-judges.test.js; a cache that MISSES the labels that would bill, and seats whose model is priced so they would) - FS-1 an agreed run, no read owed, stays agreed; FS-2 an agreed run whose text changed after
// the sign-off and whose final read would bill: not agreed, the sign-off stays on the record; FS-3 a final read half done; FS-4 a challenge raised and its revision the stopped stage; real verbs (test/s16-spend-finish-cli.test.js's harness) - FS-5 a stop in
// the loop; FS-6 a stop after it; FS-7 refusals; FS-8 a plain resume still meets the limit gate; FS-9 the screen.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. The control of each row is the same input without the sitting (a plain resume, or the in-process run with the sitting off).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget, setSpendFinish, setNoMoneySitting } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { finishedRunState, deriveRunStatus, runResumability } from '../src/run-status.js';
import { spendFinishNowDecision, finishNowScreen, stopShaOf } from '../src/spend-finish.js';
import { sessionMayAccept } from '../src/acceptance.js';
import { readStoppedMarker } from '../src/stop-files.js';
import { classifyStop } from '../src/stop-decision.js';
import { clampStatus } from '../src/handoff-status.js';
import { agreedOf, statusAllowedOf } from '../src/ending-matrix.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { CHECK, runThroughChecks, answer } from './helpers/build-check.js';
import * as VH from '../src/verdict-headline.js';
import { renderFinalReadBlock } from '../src/final-read.js';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { findStopCap } from './helpers/find-stop-cap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setSpendFinish(null); setNoMoneySitting(false); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

// ---------- in-process rows ----------
const CRITERION = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const JUDGE = 'mock-review-fixture'; const PRICED = 'mock-priced';   // the judges bill nothing; the writers and a seat named priced bill (the $1000 per Mtok fixture price)
const writer = { provider: 'mock', model: PRICED, lab: 'writer', maxTokens: 3000 };
const STATED_PASS = JSON.stringify({ pass: true, pass_reason: 'Nothing to object to.' });   // a seat's stated pass (freedoms.pass): not a verdict row, so not a read of the plan (src/final-read.js layer3ReadShas)
const judge = (lab, layer, model = JUDGE) => ({ provider: 'mock', model, lab, maxTokens: 3000, layer });

async function run({ misses = [], scripted = {}, seats = {}, extra = {}, spendFinish = false, noMoney = true, logs = null, held = null } = {}) {
  setPromptSpy(() => {}); setHeldForTest(held);   // `held`: the build-check wording (CHECK) for the rows that read the run's `ending` record, which exists only where that wording is live
  setCache({ invalidate() {}, get(label) {
    if (misses.some(m => (m instanceof RegExp ? m.test(label) : m === label))) return null;
    if (scripted[label] && typeof scripted[label] === 'object') return { text: scripted[label].text, provider: 'mock', model: 'm', usage: scripted[label].usage, usd: 0, ...(scripted[label].promptHash ? { promptHash: scripted[label].promptHash } : {}) };   // a scripted reply with its own usage (a reply that ended with a stop reason)
    const text = label in scripted ? scripted[label] : label.startsWith('panel-') || label.startsWith('final-read-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  setNoMoneySitting(noMoney); if (spendFinish) setSpendFinish({ capName: null, atOnce: true });
  const config = { name: 'fixture-fns', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 3, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 },
    seats: { builder: writer, reviser: writer, critics: [judge('raiser-alpha', 1), judge('mid-beta', 2), judge('top-gamma', 3)], ...seats }, ...extra };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-fns', log: logs ? l => logs.push(String(l)) : () => {}, config, roundChoices: [] });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-fns', chain: 'fixture-fns', task: 't.md', result, config })));
  return { result, report, state: finishedRunState(report) };
}

test('FS-1 (agreed panel, no read owed): the stages that would bill are not made and are named; the run STAYS AGREED, final_read keeps every_top_seat_read_this_plan, nothing says "not agreed", no stop is made, the handoff does not exist (so nothing is clamped); the default security reviewer and the cold reader are not called and not recorded as failed', async () => {
  const r = await run({ held: CHECK, misses: ['handoff', 'security-review', 'cold-read'], seats: { coldRead: writer }, extra: { handoff: true, security_review: { enabled: true }, coldRead: { enabled: true } } });
  assert.equal(r.report.passed, true, 'the panel signed off');
  assert.deepEqual([...r.report.stages_not_run.map(s => s.label)].sort(), ['cold-read', 'handoff', 'security-review']);
  assert.ok(r.report.stages_not_run.every(s => s.reason === 'spending_limit'));
  assert.equal(r.result.handoff, null, 'no handoff text: nothing to clamp');
  assert.equal(r.report.security_review, undefined, 'the default reviewer (a seat outside config.seats that bills) was not called, and no non-verdict was recorded for it');
  assert.equal(r.report.coldRead, undefined, 'not "not_judged": a stage not run for the limit is not a seat that failed to answer');
  assert.deepEqual([r.report.final_read?.ran, r.report.final_read?.reason], [false, 'every_top_seat_read_this_plan'], 'the owed-read check decides first, on this branch too');
  assert.equal(r.report.ending?.kind, 'agreed');
  assert.equal(r.report.stop, undefined, 'a phase-after sitting makes no stop: no reader of a finished stop sees it');
  assert.doesNotMatch(r.state, /not agreed/i, `nothing on the run says "not agreed": ${r.state}`);
  assert.match(r.state, /ended at the spending limit at the person's choice; 3 calls were not made \(/);
});

// CHANGED ACCEPTED, FS-2 re-aimed and FS-2b removed (0.8.4 apply, C&C ruling 12 Nov 2026). OLD: FS-2 ran a three-layer chain with a finalist seat, so that the final edit changed the text after the sign-off, and asserted that the run STAYS AGREED when the owed read is not made (ending undefined, delivered_text changed by the final edit, the status line's clause, the board sentence "did not read the final plan."); FS-2b did the same with a free top seat. NEW: the same ending (an agreed verdict, the owed final read not made at the person's finish) on the one shape of the recorded state that reaches it: a layered chain with ALL critics on ONE layer and a handling session, one seat STATING A PASS (a stated pass is not a read) and one signing. The row asserts only what is written there and pinned nowhere else: the premise (the layer signed off), no "not agreement" line in the log, final_read [ran false, reason finished_at_once, run_end agreed], ending.kind 'agreed', agreedOf true, signed_text signed off at round 1, the unasked read named in stages_not_run, and the state line (no "not agreed"; "ended at the spending limit at the person's choice; one call was not made (final-read-seat-b)", never "would bill"). WHY: with the build-check wording recorded an agreed run skips the final edit and the challenge (src/chain.js agreedAtPoint), so a text changed after the sign-off cannot be produced and everything that rode on it (ending undefined, delivered_text changed_by final_edit, the status clause "on the signed draft; the delivered text differs (changed by the final edit)") has no reachable end: removed with FS-2 and FS-2b; the "did not read the final plan." sentence is pinned at a reachable end by FN-2 (finish-now.test.js, the not-agreed variant). NOT asserted here, on purpose (0.8.5 items, FOR_085): the coverage sentence the board prints at this ending ("only part of layer 1 had read this version before (seat-a)"; seat-b's stated pass is on this version), the run-log line "the plan changed after layer 1's last read" (the text did not change), and ending.basis (layer_3_sign_off on a one-layer chain). Reach: a person's own one-layer chain only (no shipped chain has fewer than three layers).
test('FS-2 (the 19:01 ending, ONE-layer chain: a handling session, one seat STATES A PASS and one signs; the finish at once at the owed read): the run STAYS AGREED, final_read says nobody was asked (finished_at_once), the sign-off of the layer is on the record, the unasked read is named', async () => {
  const logs = [];
  const r = await run({ scripted: { 'panel-1-seat-b': STATED_PASS, 'build-check-1': answer('good_to_build') }, misses: [/^final-read-/], logs,
    seats: { reviser: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, critics: [judge('seat-a', 1), judge('seat-b', 1, PRICED)] }, extra: { freedoms: { pass: true } } });
  assert.equal(r.report.passed, true, 'premise: the layer signed off (a stated pass counts, the other seat signed)');
  assert.deepEqual(logs.filter(l => /NOT agreement|ended without agreement/.test(l)), [], 'the run log does not say "not agreement" beside the agreed verdict');
  assert.deepEqual([r.report.final_read?.ran, r.report.final_read?.reason, r.report.final_read?.run_end], [false, 'finished_at_once', 'agreed']);
  assert.equal(r.report.ending?.kind, 'agreed'); assert.equal(agreedOf(r.report), true, "a finish after the rounds keeps the panel's verdict");
  assert.deepEqual([r.report.signed_text?.signed_off, r.report.signed_text?.round], [true, 1], "the layer's sign-off is on the record, at round 1");
  assert.ok(r.report.stages_not_run.some(s => /^final-read-seat-b/.test(s.label)), `the unasked read is named: ${JSON.stringify(r.report.stages_not_run)}`);
  assert.doesNotMatch(r.state, /not agreed/i);
  assert.match(r.state, /ended at the spending limit at the person's choice; one call was not made \(final-read-[^)]*\)/, 'the words are true for a read that bills nothing too: they never say "would bill"');
  assert.doesNotMatch(r.state, /would bill/);
});

test('FS-11 (a retry is a call too): the first reply of the handoff replays with a stop reason that asks for a retry (the premise), its -retry would bill: the retry is not made and is named, the handoff does not exist (an incomplete reply is not a handoff), nothing is recorded as a failed stage; BOX GUESS: whether a replayed reply keeps its stop reason', async () => {
  const r = await run({ scripted: { handoff: { text: 'Status: partial', usage: { input: 0, output: 0, stop: 'error' } } }, misses: ['handoff-retry'], extra: { handoff: true } });
  assert.ok(Array.isArray(r.report.stages_not_run), 'premise: the replayed reply kept no stop reason, so no retry was asked for (the box decides whether a replay keeps it)');
  assert.deepEqual(r.report.stages_not_run.map(s => s.label), ['handoff-retry']);
  assert.equal(r.result.handoff, null);
});

test('FS-12 (the Status clamp, not vacuous): an agreed run whose handoff replays with Status ready_for_build, the security review not run: the cli\'s own clamp leaves the Status as the seat wrote it', async () => {
  const r = await run({ scripted: { handoff: 'Status: ready_for_build\n\nBuild it.\n' }, misses: ['security-review'], extra: { handoff: true, security_review: { enabled: true } } });
  assert.equal(typeof r.result.handoff, 'string');
  const clamp = clampStatus(r.result.handoff, statusAllowedOf(r.result.endingWord, { agreed: agreedOf(r.report) }));
  assert.ok(clamp.original == null, 'nothing clamped');
  assert.equal(clamp.text, r.result.handoff);
  assert.deepEqual(r.report.stages_not_run.map(s => s.label), ['security-review']);
});

test('FS-3 (a final read half done): one top seat\'s read replays, the other would bill: ran:true with BOTH seats on the record (4b\'s shape), the unasked one marked not_run (not an abstention, not an unreachable seat), the run is NOT agreed', async () => {
  // CHANGED ACCEPTED TEST (0.8.4, C&C ruling 12 Nov 2026: re-aimed at a NOT-agreed end where a final read is owed). OLD: a finalist's edit changed the text after a full sign-off (`final` scripted), so the two top seats owed a read. NEW: layer 1 objects in every pass (the objection repeated with `continues`), so no top-layer seat is asked in the rounds (the stall window is set longer than the run), the run ends NOT agreed at the pass cap and both top seats owe the read of the final plan; the rest of the row is as it was (gamma's read replays, delta's would bill and is not made). WHY: with the build-check wording recorded, no traced route gives an agreed end whose text changed after the sign-off (see the removal note of FS-2); the row's own subject, a spending limit cutting a final read part-way, needs only an owed read. The row keeps its assertions and adds a premise (passed false, no top-layer verdict row); the last assertion moves with the ending: the run state of a not-agreed end at a spending limit reads 'done: open objections (...)', not 'not agreed' (first box run, 12 Nov 2026).
  const T0 = { criterion: CRITERION, problem: 'No limit is named.', quote: 'The worker', fix: 'Name it.', relation: 'new', severity: 5 };
  const again = { ...T0, relation: `continues ${objectionId('raiser-alpha', T0)}` };
  const objects = f => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: [f], verdict_line: 'no' });
  const r = await run({ scripted: { 'panel-1-raiser-alpha': objects(T0), 'panel-2-raiser-alpha': objects(again), 'panel-3-raiser-alpha': objects(again), 'final-read-top-gamma': meets() }, misses: ['final-read-top-delta'],
    seats: { critics: [judge('raiser-alpha', 1), judge('mid-beta', 2), judge('top-gamma', 3), judge('top-delta', 3, PRICED)] }, extra: { dispute: { enabled: true, stall_rounds: 9 } } });
  assert.equal(r.report.passed, false, 'premise: layer 1 objects in every pass, so the run ends not agreed');
  assert.equal((r.report.panelVerdicts ?? []).filter(v => /^top-/.test(v.lab)).length, 0, 'premise: no top-layer seat was asked in the rounds (no stall: the stall window is longer than the run)');
  const seats = r.report.final_read?.seats ?? [];
  assert.equal(r.report.final_read?.ran, true);
  assert.deepEqual(seats.map(s => [s.lab, s.read, s.not_run ?? null]), [['top-gamma', true, null], ['top-delta', false, 'spending_limit']]);
  assert.match(r.state, /^done: open objections/, 'a not-agreed end at a spending limit reads "open objections" in the run state');
});

test('FS-4 (a challenge raised at a not-agreed end, its revision the stopped stage): the challenge replays as raised, the revision would bill and is not made, no round is reopened, the revision is named; the run is NOT agreed', async () => {
  // CHANGED ACCEPTED TEST (0.8.4, C&C ruling 12 Nov 2026: re-aimed at a NOT-agreed end that runs the challenge). OLD: an agreed panel, the challenge raised after the sign-off, the verdict stays AGREED. NEW: layer 1 objects in every pass, the run ends NOT agreed, and the challenge stage still runs there (`config.challenge.enabled && !agreedAtPoint`, src/chain.js); the row's own subject is kept (the challenge replays as raised, its revision would bill and is not made, no round is reopened, the revision is named) and its verdict lines move with the ending: passed false, not agreed through agreedOf, the state reads 'done: open objections (...)'. WHY: with the build-check wording recorded an agreed run skips the challenge (agreed at the point), so the agreed-end premise cannot be produced.
  const challenger = { provider: 'mock', model: JUDGE, lab: 'challenger-delta', maxTokens: 3000 };   // not a critic of the panel: it is asked even in this sitting (it bills nothing)
  const T0 = { criterion: CRITERION, problem: 'No limit is named.', quote: 'The worker', fix: 'Name it.', relation: 'new', severity: 5 };
  const again = { ...T0, relation: `continues ${objectionId('raiser-alpha', T0)}` };
  const objects = f => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: [f], verdict_line: 'no' });
  const r = await run({ scripted: { 'panel-1-raiser-alpha': objects(T0), 'panel-2-raiser-alpha': objects(again), 'panel-3-raiser-alpha': objects(again), challenge: JSON.stringify({ challenge: true, decision: 'The retry limit', evidence: 'A measured failure rate.' }) }, misses: ['challenge-revise'], seats: { challenger }, extra: { challenge: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 } } });
  assert.deepEqual([r.report.challenge?.raised, r.report.challenge?.reopened_rounds], [true, 0]);
  assert.deepEqual(r.report.stages_not_run.map(s => s.label), ['challenge-revise']);
  assert.equal(r.report.passed, false, 'premise: layer 1 objects in every pass, so the run ends not agreed'); assert.equal(agreedOf(r.report), false);
  assert.match(r.state, /^done: open objections/, 'a not-agreed end at a spending limit reads "open objections" in the run state');
});

// ---------- the real verbs ----------
const seat = (extra = {}) => ({ provider: 'mock', model: 'mock-priced', maxTokens: 4000, ...extra });
const CHAIN = { name: 'sf', signoff: 'unanimous', handoff: true, maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: seat({ maxTokens: 100 }), builder: seat({ lab: 'author' }), reviser: seat({ lab: 'author' }), critics: [seat({ lab: 'l1', layer: 1 }), seat({ lab: 'l2', layer: 2 }), seat({ lab: 'l3', layer: 3 })] } };
const ID = '2026-11-10T09-00-00-000Z';
function workspace(chain = CHAIN) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-finish-now-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), `Plan a small thing with a retry limit.\n${chain.seats?.reviser?.provider === 'external' ? 'REVISED MOCK DELIVERABLE\n' : ''}`); writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain));
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
  return { dir, run, runDir: join(dir, 'runs', ID) };
}
// The grid of caps tried first; the stop AFTER the review rounds is a window of the cap that a grid can miss, so findStopCap (test/helpers/find-stop-cap.js) bisects between a stop and a finished run when the grid finds none (a finer grid between 2.5 and 2.75 was tried first and was wrong: the window depends on the chain's seats).
const CAPS = ['0.001', '0.5', '1', '1.5', '2', '2.25', '2.5', '2.52', '2.54', '2.56', '2.58', '2.6', '2.62', '2.64', '2.66', '2.68', '2.7', '2.72', '2.74', '2.75', '3', '3.25', '3.5', '3.75', '4', '5', '6', '8', '10', '12', '15', '20'];
const stopFileOf = w => { try { return JSON.parse(readFileSync(join(w.runDir, 'STOPPED-budget.json'), 'utf8')); } catch { return null; } };
// FINDING (not on the owed list of the ladder unit; the second box run of 10 Nov 2026 showed the finer grid above did not find the stop after the rounds on every chain): OLD bar: the first cap of a fixed grid that stops the run in the phase; NEW bar: the same grid, then a bisection (test/helpers/find-stop-cap.js) between the largest cap that stopped earlier and the smallest cap above it that did not stop, and the cap found is remembered per phase and chain, so the 25 tests that ask for it search once. The premise (some cap stops the run in the phase) is still asserted, with every cap tried in the message.
const capMemo = new Map();
function stopIn(phase, chain = CHAIN) {
  const key = `${phase}|${JSON.stringify(chain)}`;
  // CHANGED ACCEPTED TEST (0.8.4 shape-B fixture, C&C ruling 12 Nov 2026). OLD: `w.run([...])`: one spawn per cap. NEW: runThroughChecks answers every build check the run waits at (good_to_build) and resumes (the cap is kept in run.json), so a chain with a handling session reaches its rounds' end. WHY: since dc60423a the build check is live, a handled chain (an external reviser) pauses at build-check-1 with exit 3 inside the rounds, a free pause that no cap stops, so the window after the rounds was never reached; the stop and its phase are read from the run that was answered. A chain with no handling session never pauses there and is spawned once, as before.
  const run = cap => { const w = workspace(chain); const r = runThroughChecks(w.run, ['--chain', chain.name, '--task', 'tasks/t.md', '--max-usd', cap, '--run-id', ID], () => w.runDir); return { status: r.status, phase: r.status === 4 ? stopFileOf(w)?.phase ?? null : null, w }; };
  if (capMemo.has(key)) { const a = run(capMemo.get(key)); if (a.status === 4 && a.phase === phase) return { w: a.w, cap: capMemo.get(key) }; }
  const found = findStopCap({ phase, caps: CAPS, attempt: run });
  if (found.a) { capMemo.set(key, found.cap); return { w: found.a.w, cap: found.cap }; }
  assert.fail(`premise: no cap stopped the run in the phase "${phase}": ${found.tried.join(' | ')}`);
}
const reservationLines = w => (existsSync(join(w.runDir, 'spend-reservations.jsonl')) ? readFileSync(join(w.runDir, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0);
const usageFiles = w => readdirSync(w.runDir).filter(n => n.endsWith('.usage.json')).sort();
const readJson = (w, f) => JSON.parse(readFileSync(join(w.runDir, f), 'utf8'));

test('FS-5 (a stop IN the review rounds, the real verb): one command ends the run: zero reservations and no new usage file, no limit screen, nothing recorded in run.json, a typed --finish-now never lands in the plain --finish branch; the report says budget_stop / finish / finished_at_once, the stopped call and the handoff are named not run', () => {
  const { w } = stopIn('loop');
  const reserved = reservationLines(w); const usage = usageFiles(w);
  const r = w.run(['--resume', w.runDir, '--finish-now']);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 22, `finished, not agreed: ${out}`);
  assert.doesNotMatch(out, /Your choice to end the run here is recorded/, 'the trap: it did not land in the plain --finish branch (which only records and exits 4)');
  assert.match(out, /you chose to end the run at the spending limit \(stage "[^"]+"\) with --finish-now: no call that bills is made, no judge reads the plan again, and the run ends NOT agreed\./);
  assert.equal(reservationLines(w), reserved, 'zero reservations: no call was reserved, so none was sent');
  assert.deepEqual(usageFiles(w), usage, 'and no call was paid or recorded');
  const rep = readJson(w, 'report.json');
  assert.deepEqual([rep.passed, rep.stop?.kind, rep.stop?.chosen, rep.stop?.finished_at_once], [false, 'budget_stop', 'finish', true]);
  assert.equal(typeof rep.stop.label, 'string', 'the stage the run stopped before');
  assert.ok(rep.stages_not_run.some(s => s.label === 'handoff'), `the handoff (a priced seat) is named: ${JSON.stringify(rep.stages_not_run)}`);
  assert.ok(rep.stages_not_run.every(s => s.reason === 'spending_limit'));
  assert.equal(rep.final_read?.reason, 'finished_at_once');
  assert.equal(rep.spending_finish?.phase, 'loop');
  assert.ok(!existsSync(join(w.runDir, 'STOPPED-budget.json')), 'the run is ended, not stopped');
  assert.equal(readJson(w, 'run.json').budgetFinish, undefined, 'nothing was recorded for a later resume to read');
  assert.ok(!existsSync(join(w.runDir, 'HANDOFF.md')), 'the handoff (a call that bills) was not made: no HANDOFF.md'); assert.doesNotMatch(out, /HANDOFF\.md/, 'and the output line does not claim one');
  assert.equal(rep.handoff_milestones, undefined);
  assert.ok(Array.isArray(rep.kept_limits) && rep.kept_limits.length === 1 && rep.kept_limits[0].cap_name === null && rep.kept_limits[0].limit_usd > 0 && Number.isFinite(rep.kept_limits[0].spent_usd), `the kept limit is on the record with what was counted: ${JSON.stringify(rep.kept_limits)}`);
});

test('FS-6 (a stop AFTER the review rounds, the real verb): the same command ends the run with the verdict the panel produced (no budget_stop stop), zero reservations, the calls not made named', () => {
  const { w } = stopIn('after');
  const reserved = reservationLines(w); const usage = usageFiles(w);
  const r = w.run(['--resume', w.runDir, '--finish-now']);
  const out = `${r.stdout}${r.stderr}`;
  assert.ok(r.status === 0 || r.status === 22, `the run ended (0 agreed, 22 not agreed): exit ${r.status}: ${out}`);
  assert.match(out, /with --finish-now: no call that bills is made, no judge reads the plan again, and the verdict is the one the run had reached\./);
  assert.equal(reservationLines(w), reserved); assert.deepEqual(usageFiles(w), usage);
  const rep = readJson(w, 'report.json');
  assert.notEqual(rep.stop?.kind, 'budget_stop', 'no finished stop was made after the loop');
  assert.equal(rep.spending_finish?.phase, 'after', 'but the person\'s finish is on the record');
  assert.ok(Array.isArray(rep.stages_not_run) && rep.stages_not_run.length >= 1, 'the stopped stage is named');
  if (rep.passed === true && !rep.ending) assert.doesNotMatch(finishedRunState(rep), /not agreed/i, 'an agreed run says nothing of "not agreed"');
  // the route the screen names for the handoff exists on this finished run: `council handoff --from-run` finds the draft and prices the one call (a dry run: nothing is sent)
  const hand = w.run(['handoff', '--from-run', w.runDir, '--dry-run']);
  assert.doesNotMatch(`${hand.stdout}${hand.stderr}`, /nothing to hand off|no draft/i, 'the finished run holds a draft the handoff can be made from');
  assert.equal(hand.status, 0, `${hand.stdout}${hand.stderr}`);
});

test('FS-7 (refusals, nothing recorded): a stop BEFORE the review rounds refuses --finish-now with the sentence for it; a --max-usd beside it is refused; both leave the run stopped and spend nothing; the pure decision gives the same four refusals', () => {
  const { w } = stopIn('before');
  const reserved = reservationLines(w);
  const a = w.run(['--resume', w.runDir, '--finish-now']);
  assert.equal(a.status, 2, `${a.stdout}${a.stderr}`);
  assert.match(a.stderr, /--finish-now: this stop came before the review rounds began, so there is no plan under review yet and nothing to end\./);
  const b = w.run(['--resume', w.runDir, '--finish-now', '--max-usd', '5']);
  assert.equal(b.status, 2); assert.match(b.stderr, /--finish-now: give it alone\./);
  assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')), 'still stopped'); assert.equal(reservationLines(w), reserved);
  for (const [input, re] of [[{ stop: { phase: 'loop' }, member: true }, /member of a tree/], [{ stop: { phase: 'loop' }, maxUsdGiven: true }, /give it alone/], [{ stop: { phase: 'before' } }, /before the review rounds began/], [{ stop: {} }, /does not say where in the run it came/], [{ stop: null }, /does not say where/]])
    assert.match(spendFinishNowDecision(input).refusal, re);
  assert.deepEqual(spendFinishNowDecision({ stop: { phase: 'after', stoppedAt: 'handoff' } }), { ok: true, phase: 'after', label: 'handoff', capName: null });
});

test('FS-8 (a plain resume still meets the limit): before any finish, after a refused finish-now (a stop before the rounds) and after a recorded plain --finish, a plain resume that types no new limit is held by the run\'s own limit again (exit 4, the run stays stopped, no report), and reserves nothing (this chain is a mock chain: its limit is the saved --max-usd, not a typed screen)', () => {
  for (const phase of ['loop', 'before']) {
    const { w } = stopIn(phase);
    if (phase === 'before') assert.equal(w.run(['--resume', w.runDir, '--finish-now']).status, 2, 'a refused finish-now');
    if (phase === 'loop') assert.equal(w.run(['--resume', w.runDir, '--finish']).status, 4, 'a plain --finish records and ends at exit 4');
    const reserved = reservationLines(w);
    const plain = w.run(['--resume', w.runDir]);
    assert.equal(plain.status, 4, `${phase}: held by the limit again: ${plain.stdout}${plain.stderr}`);
    assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')) && !existsSync(join(w.runDir, 'report.json')), `${phase}: still stopped, not ended`);
    assert.equal(reservationLines(w), reserved, `${phase}: nothing reserved`);
  }
  const { w } = stopIn('loop');
  const reserved = reservationLines(w);
  assert.equal(w.run(['--resume', w.runDir]).status, 4, 'before any finish');
  assert.ok(!existsSync(join(w.runDir, 'report.json'))); assert.equal(reservationLines(w), reserved);
});

test('FS-9 (the screen states the way and asks nothing): a loop and an after stop name --finish-now with its result and, for the handoff, the route to get it later; a stop before the rounds has no such paragraph; the pure paragraph asks no question', () => {
  for (const phase of ['loop', 'after']) {
    const { w } = stopIn(phase);
    const md = readFileSync(join(w.runDir, 'STOPPED-budget.md'), 'utf8');
    assert.match(md, /## Or end it here, without paying/); assert.match(md, new RegExp(`--resume runs/${ID} --finish-now`));
    assert.match(md, /handoff --from-run runs\/[^ `]+`? makes it later \(a handoff seat that bills shows a screen and asks the person for a limit\)/);
    assert.match(md, /A stage that a session writes \(a seat that bills nothing: a handoff, a rewrite, a revision, a final edit\) is not skipped: the run pauses at each such stage for its answer; after each answer resume the run as usual \(your --finish-now is on record\), and the run ends after the last without asking for a limit\./);
    assert.match(md, /Raising the limit as above pays the stage the run stopped at/); assert.match(md, /A plan that ends NOT agreed can still be accepted by the person\./);
    assert.match(md, phase === 'loop' ? /the run ends NOT agreed, because the review rounds were not finished/ : /the run keeps the verdict the review rounds reached, and where the top layer owed a read of the final plan that was not made, the report says the top layer did not read the final plan, or that only part of it had read this version/);   // CHANGED ACCEPTED (0.8.4 ladder unit, Mini-C&C's FIX 1, his 19:01 heading of 10 Nov 2026). OLD: "... and ends NOT agreed if the top layer owed a read of the final plan that was not made". NEW: the verdict is kept and the report says the top layer did not read the final plan. WHY: FS-2 asserts a run stays agreed when a read is owed and not made, so the old sentence said what the record does not
    assert.doesNotMatch(md.slice(md.indexOf('## Or end it here')), /\?/, 'it states the way and asks nothing');
  }
  const { w } = stopIn('before');
  assert.doesNotMatch(readFileSync(join(w.runDir, 'STOPPED-budget.md'), 'utf8'), /--finish-now/);
  assert.equal(finishNowScreen({ command: 'council', runId: 'r', phase: 'before' }), '');
});

// ---------- by seat role: no judge is asked, a judge seat that bills nothing included ----------
import { BudgetExceeded } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const quotes = ['The worker', 'retries failed', 'failed requests', 'The worker retries'];
const T1 = i => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: quotes[i], fix: 'Fix it.', severity: 5, relation: 'new' });   // K1, K3: relationRule and ratingDemand are recorded; each pass of lowScript raises a different problem, so every one is a first raise
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];
const LOWLAB = 'raiser-alpha';
const lowScript = Object.fromEntries([1, 2, 3].map(k => [`panel-${k}-${LOWLAB}`, k === 1 ? objects(T1(0)) : objectsAnswering([T1(k - 1)], withdraws(objectionId(LOWLAB, T1(k - 2))))]));
const JUDGE_CHAIN = { dispute: { enabled: true, stall_rounds: 2, review: true }, challenge: { enabled: true } };

for (const [name, opts] of [['phase after (the loop ran to its end, not agreed)', { }], ['phase loop (the loop ends at its first uncached call; no final read on disk)', { spendFinish: true, misses: [`panel-3-${LOWLAB}`, `panel-2-${LOWLAB}`, /^final-read-/] }]]) {
  test(`FS-13 (by seat role, ${name}): with judge seats that bill NOTHING, no judge seat makes a live call in the sitting: no dispute review, no judge challenger, no exchange, no final read; the report names the dispute reviews and the challenge as not run`, async () => {
    let r; try { r = await run({ scripted: lowScript, extra: { ...JUDGE_CHAIN, handoff: true }, ...opts }); } catch (e) { assert.fail(`premise: the fixture must end the loop by its own bound and return, not stop for a choice (${e?.constructor?.name}: ${String(e?.message).slice(0, 160)})`); }
    assert.equal(r.report.passed, false, 'the premise: the loop did not end in agreement');
    const live = (r.report.stages ?? []).filter(s => s.model === JUDGE && s.cached !== true);
    assert.deepEqual(live.map(s => s.label), [], 'no judge seat was asked in this sitting');
    assert.equal(r.report.dispute?.review_not_run, 'finished_at_once');
    assert.deepEqual(r.report.challenge, { ran: false, reason: 'finished_at_once' });
    // FINDING (not on the owed list of the ladder unit; first box run, 10 Nov 2026): OLD: final_read.ran was asserted false. A final read already ON DISK replays and counts as read in a finish-now sitting (the replay-only seam, C&C's ruling on step 3), and in the phase-after sitting the scripted cache holds one, so ran is true there with no live call: the check that no judge was asked is the `live` list above.
    assert.ok(r.report.final_read?.ran === false || r.report.final_read?.seats?.every(x => x.read === true), 'no final read was made live: a read on disk replays and counts as read');
    // FINDING (not on the owed list; found by the box set, 10 Nov 2026): the companion of the line above. OLD: the reason is one of the two words. NEW: when the read on disk counted as read (ran true), the record carries no reason at all (src/chain.js calls finalReadRecord with none: neither nothing-was-asked nor an owed read was left); otherwise it is one of the two words.
    assert.ok(r.report.final_read?.ran === true ? r.report.final_read?.reason === undefined : ['finished_at_once', 'every_top_seat_read_this_plan'].includes(r.report.final_read?.reason), `the owed-read check decides the reason (a last pass is not revised: the top seat may have read exactly this text): ${r.report.final_read?.reason}`);
  });
}

test('FS-14 (the dispute record when its rewrite was not made): the open objections are recorded all the same, the record says the rewrite was not made for the spending limit, and the call is named', async () => {
  let r; try { r = await run({ scripted: lowScript, misses: ['dispute'], extra: { dispute: { enabled: true, stall_rounds: 2 } } }); } catch (e) { assert.fail(`premise: the fixture must return (${e?.constructor?.name}: ${String(e?.message).slice(0, 160)})`); }
  assert.equal(r.report.dispute?.ran, true); assert.equal(r.report.dispute?.rewrite_not_run, 'spending_limit');
  assert.ok((r.report.dispute?.open_objections ?? []).length >= 1, 'the objections are on the record');
  assert.ok(r.report.stages_not_run.some(s => s.label === 'dispute'));
});

test('FS-18 (who may accept after the person\'s finish-now at a spending stop): in EVERY phase the plan is the person\'s to accept, the handling session\'s own accept is refused; a phase-after run makes no stop, so the report\'s spending_finish record is what says so (control: the same report without it is acceptable)', () => {
  const base = { passed: false, delivered_text: { same_as_signed: true } };
  const refused = sessionMayAccept({ report: { ...base, spending_finish: { phase: 'after', label: 'handoff' } }, meta: {} });
  assert.deepEqual([refused.ok, refused.why], [false, 'person_stop']);
  assert.equal(sessionMayAccept({ report: base, meta: {} }).ok, true, 'control');
  assert.equal(sessionMayAccept({ report: { ...base, stop: { kind: 'budget_stop', chosen: 'finish', finished_at_once: true } }, meta: {} }).ok, false, 'a stop in the loop: refused as before (PERSON_STOP_KINDS)');
});

test('SW-1 (the second wall does not go through the seam): the same input with the sitting OFF and the stopped limit armed: a call that bills and is not on disk is refused by the cap itself, before it is recorded or sent', async () => {
  setBudget(0.000001);
  await assert.rejects(() => run({ misses: ['handoff'], extra: { handoff: true }, noMoney: false }), err => err instanceof BudgetExceeded);
});

test('SW-2a (a planted run.json does not make a no-money sitting): run.json keys that claim a finish-now (noMoney, finishNow, noMoneySitting) change nothing for a plain resume: it is held by the limit (exit 4), never ended, nothing reserved, no stages_not_run', () => {
  const { w } = stopIn('loop');
  const reserved = reservationLines(w);
  const p = join(w.runDir, 'run.json'); const j = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...j, noMoney: true, finishNow: true, noMoneySitting: true }, null, 2));
  const plain = w.run(['--resume', w.runDir]);
  assert.equal(plain.status, 4, `held by the limit: ${plain.stdout}${plain.stderr}`);
  assert.ok(!existsSync(join(w.runDir, 'report.json')), 'not ended'); assert.equal(reservationLines(w), reserved);
});

test('SW-2b (a planted budgetFinish of finish_now): the entry is not a recorded --finish; a plain resume is REFUSED with nothing run (the entry cannot be read as a finish), never ended, nothing reserved', () => {
  const { w } = stopIn('loop');
  const reserved = reservationLines(w);
  const p = join(w.runDir, 'run.json'); const j = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...j, budgetFinish: { choice: 'finish_now', label: 'x', at: new Date().toISOString(), via: 'cli' } }, null, 2));
  const plain = w.run(['--resume', w.runDir]);
  assert.equal(plain.status, 2, `${plain.stdout}${plain.stderr}`);
  assert.ok(!existsSync(join(w.runDir, 'report.json'))); assert.equal(reservationLines(w), reserved);
});

// FINDING (not on the owed list of the ladder unit; the box runs of 10 Nov 2026). OLD bar: the stop after the review rounds was found by a cap grid on a chain whose judges, cold read and handoff were all priced seats. NEW bar: on the two chains below the judges are free seats (mock-review-fixture, which bills nothing), the writer's expected draft is 100 tokens and a review's expected reply 900, so the cold reader is the call whose (spent so far + expected cost) is the largest of the run. WHY: the cap gate refuses a call by its EXPECTED cost (its real prompt and the expected reply) added to what is spent, and the first stage is gated at its worst case ($0.713); a priced judge's expected cost in the loop ($1.47 at the top layer) was far above a short cold read's ($0.32), so the last cap that let the loop through (2.06) also let every later call through and no cap stopped the run after the rounds (box probes of 10 Nov 2026: 2.05 stops at a judge of the loop, 2.06 reaches the handoff pause). On these chains the probe gives: caps up to 0.7 stop at the criteria stage (phase before), caps 0.75 to 1.3 stop at the cold read (phase after), cap 3 finishes (sf-free) or pauses at the handoff (sf-ext).
const FREE_JUDGES = CHAIN.seats.critics.map(c => ({ ...c, model: 'mock-review-fixture' }));
const FREE_HANDOFF = { ...CHAIN, name: 'sf-free', estimate: { ...CHAIN.estimate, draftTokens: 100, critiqueTokens: 900 }, coldRead: { enabled: true }, seats: { ...CHAIN.seats, critics: FREE_JUDGES, coldRead: seat({ lab: 'cold' }), handoff: { provider: 'mock', model: 'mock-builder', maxTokens: 4000 } } };   // a handoff seat that bills nothing: the one live call of a finish-now sitting
const EXTERNAL_HANDOFF = { ...CHAIN, name: 'sf-ext', estimate: { ...CHAIN.estimate, draftTokens: 100, critiqueTokens: 900 }, coldRead: { enabled: true }, seats: { ...CHAIN.seats, critics: FREE_JUDGES, coldRead: seat({ lab: 'cold' }), reviser: { provider: 'external', model: 'claude-code-session' }, handoff: { provider: 'external', model: 'claude-code-session' } } };   // the cold read bills AFTER the review rounds, so a cap can stop the run in the phase 'after' (with every judge signing off nothing else bills there; the handoff is a session's)   // chain-lint: a layered chain needs a handling session: an external reviser (hasHandlingSession) or an all-mock chain (isOfflineMockChain); the external HANDOFF seat breaks the second, so this chain has both. The task carries the mock's own marker, so every judge signs off on the first draft and the external reviser is never asked: each row still stops where its name says (stopIn asserts the phase of STOPPED-budget.json).   // a session writes the handoff (the shipped chains' shape)   // a session writes the handoff (the shipped chains' shape)
// FINDING (not on the owed list of the ladder unit; the set 6 box run of 10 Nov 2026). OLD bar (round 11): the free-judge chain above served both phases. NEW bar: it serves the phase 'after' only; a stop IN the loop needs a judge whose expected cost is above everything after it, so the loop stops on the priced-judge chain below (the chain this file's loop rows ran on before round 11, with a session as writer and as handoff). WHY: with free judges nothing in the loop is gated above the cold read, so no cap stops the run in the phase 'loop' (set 6: 0.001 and 0.5 stop before, 1 to 1.3 after, from 1.5 up the run pauses at the handoff). The chain was changed for the phase 'after' without the loop rows being run on it.
const LOOP_EXTERNAL = { ...CHAIN, name: 'sf-ext-loop', coldRead: { enabled: true }, seats: { ...CHAIN.seats, coldRead: seat({ lab: 'cold' }), reviser: { provider: 'external', model: 'claude-code-session' }, handoff: { provider: 'external', model: 'claude-code-session' } } };

test('SW-3 (a REAL crash mid-ending, then a plain resume): the finish-now sitting is killed while its one free call is held; the stop files are still there and the person\'s finish is on the ledger (it is written before the first call), nothing was reserved; run_status says the finish is recorded and a plain resume asks for nothing; the plain resume ENDS the run (ONE finish-now ends the run). A COMPLETED typed sitting leaves no new field in run.json', async () => {
  const { w } = stopIn('after', FREE_HANDOFF);
  const reserved = reservationLines(w); const hold = join(w.dir, 'hold-file');
  const child = spawn(process.execPath, [cli, '--resume', w.runDir, '--finish-now'], { cwd: w.dir, env: { PATH: process.env.PATH, HOME: w.dir, COUNCIL_MOCK_HOLD_FILE: hold }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const started = Date.now();
  while (!/Stage: handoff/.test(out) && Date.now() - started < 60_000) await new Promise(r => setTimeout(r, 100));
  assert.match(out, /Stage: handoff/, `premise: the sitting reached its held call: ${out}`);
  const exited = new Promise(r => child.on('exit', r)); child.kill('SIGKILL'); await exited;
  assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')) && !existsSync(join(w.runDir, 'report.json')), 'a crash leaves the stop files in place');
  assert.equal(reservationLines(w), reserved, 'nothing was reserved');
  const meta = readJson(w, 'run.json'); const res = runResumability(w.runDir, meta);
  assert.deepEqual([res.reason, res.needs], ['budget_finish_recorded', 'nothing'], 'run_status: the finish is on record, a plain resume ends the run');
  const plain = w.run(['--resume', w.runDir]);
  assert.ok([0, 22].includes(plain.status), `the plain resume ended the run: ${plain.stdout}${plain.stderr}`);
  assert.ok(existsSync(join(w.runDir, 'report.json')) && !existsSync(join(w.runDir, 'STOPPED-budget.json'))); assert.equal(reservationLines(w), reserved);
  const again = stopIn('after', FREE_HANDOFF);
  const before = Object.keys(readJson(again.w, 'run.json'));
  const done = again.w.run(['--resume', again.w.runDir, '--finish-now']);
  assert.ok([0, 22].includes(done.status), `the premise: the sitting completed: exit ${done.status}: ${done.stdout}${done.stderr}`);
  assert.deepEqual(Object.keys(readJson(again.w, 'run.json')).filter(k => !before.includes(k) && /finish|noMoney|spending|budget/i.test(k)), [], 'no new field of the finish-now sitting was written to run.json (the record is the ledger\'s)');
});

test('SW-2c (a planted file cannot fake the record): (i) a forged budget_finish line appended to the ledger breaks its chain, so a plain resume does not end the run; (ii) a finish on the ledger for ONE stop does not apply once the stop file\'s figures differ (a raise, a second stop): a plain resume is held', () => {
  const a = stopIn('loop').w; const reservedA = reservationLines(a);
  const lp = join(a.runDir, LEDGER_FILE); const text = existsSync(lp) ? readFileSync(lp, 'utf8') : '';   // a free chain's run has no ledger until a gate is asked: the forged line is then the whole file (FINDING, not on the owed list of the ladder unit; first box run, 10 Nov 2026: the read was unconditional)
  writeFileSync(lp, `${text}${JSON.stringify({ schema: 'gate-ledger/1', seq: 999, prev: 'x'.repeat(64), ts: '2026-11-10T00:00:00.000Z', event: 'budget_finish', stop_sha256: 'a'.repeat(64), phase: 'loop', actor: 'person', channel: 'cli' })}\n`);
  const forged = a.run(['--resume', a.runDir]);
  assert.ok([2, 4, 21].includes(forged.status), `not ended: exit ${forged.status}: ${forged.stdout}${forged.stderr}`); assert.ok(!existsSync(join(a.runDir, 'report.json'))); assert.equal(reservationLines(a), reservedA);
  const b = stopIn('after', EXTERNAL_HANDOFF).w; b.run(['--resume', b.runDir, '--finish-now']);   // the finish is on the ledger for this stop
  const sp = join(b.runDir, 'STOPPED-budget.json'); const st = JSON.parse(readFileSync(sp, 'utf8')); writeFileSync(sp, JSON.stringify({ ...st, spentUsd: (st.spentUsd ?? 0) + 1 }));   // the stop is now another stop (its figures changed)
  const reservedB = reservationLines(b);
  const held = b.run(['--resume', b.runDir]);
  assert.equal(held.status, 4, `held by the limit: ${held.stdout}${held.stderr}`); assert.ok(!existsSync(join(b.runDir, 'report.json'))); assert.equal(reservationLines(b), reservedB);
});

test('FS-17 (the shipped-chain path: a session writes the handoff; ONE finish-now ends the run): --finish-now at a stop after the rounds pauses at the handoff (exit 3, NEEDS-handoff.md, the printed resume line is the plain one), the finish is on the ledger, run_status names the session stage it waits for (not a higher limit), nothing is reserved; after the answer a PLAIN resume (what submit_stage does) ends the run, asks for no limit, makes HANDOFF.md, reserves nothing. OLD bar (named): the person retyped --finish-now after every answer and a plain resume met the limit screen', () => {
  const { w } = stopIn('after', EXTERNAL_HANDOFF);
  const reserved = reservationLines(w);
  assert.equal(deriveRunStatus(w.runDir, readJson(w, 'run.json')), 'budget_stopped', 'before any finish: waiting for a higher limit');
  const first = w.run(['--resume', w.runDir, '--finish-now']);
  const out = `${first.stdout}${first.stderr}`;
  assert.equal(first.status, 3, out);
  assert.match(out, /resume:  .* --resume runs\/[^ ]+\s/); assert.doesNotMatch(out, /--resume runs\/[^ ]+ --finish-now/); assert.match(out, /your --finish-now is on record: after the answer, resume as usual.*--raise-cap/);
  assert.ok(existsSync(join(w.runDir, 'STOPPED-budget.json')), 'still stopped: the stop files go only when the run ends'); assert.equal(reservationLines(w), reserved);
  const meta = readJson(w, 'run.json');
  assert.equal(deriveRunStatus(w.runDir, meta), 'paused', 'run_status names the session stage, not the budget stop');
  const res = runResumability(w.runDir, meta);
  assert.deepEqual([res.resumable, res.needs, res.waiting?.map(x => x.label ?? x)], [true, 'answer', ['handoff']], JSON.stringify(res));
  assert.match(res.note ?? '', /a resume ENDS the run on that choice/, 'the status says a resume finishes the run on the recorded choice (run_status passes the whole resumability object through)');
  assert.ok(readFileSync(join(w.runDir, 'gate-ledger.jsonl'), 'utf8').includes('"budget_finish"'), 'the finish is on the hash-chained ledger');
  writeFileSync(join(w.runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(w.runDir, 'handoff.md.partial'), join(w.runDir, 'handoff.md'));
  const second = w.run(['--resume', w.runDir]);   // PLAIN: no flag, no limit
  assert.ok([0, 22].includes(second.status), `${second.stdout}${second.stderr}`);
  assert.ok(existsSync(join(w.runDir, 'HANDOFF.md')), 'the session\'s handoff was made in this ending'); assert.ok(!existsSync(join(w.runDir, 'STOPPED-budget.json')));
  assert.equal(reservationLines(w), reserved);
});

test('FS-19 (stop files beside a second stop): with the person\'s finish on record, STOPPED-budget.json beside a session\'s NEEDS file reads as the session\'s pause (status paused, needs answer, the stage named); WITHOUT the record the same shape is the budget stop (status budget_stopped, needs higher_cap); the marker reader never sees the budget stop as a cause (it reads only the STOPPED-<cause> markers). CHANGED by the relay (old bar: the stop tool refused both): the pure classifier still calls a paused status not a choice stop, but the tool quotes the stop through an override when the finish is on record (RL-10), and a spending stop is quoted as the person-only stop (SD-2b)', () => {
  const withRecord = stopIn('after', EXTERNAL_HANDOFF).w;
  withRecord.run(['--resume', withRecord.runDir, '--finish-now']);   // pauses at the handoff, the finish on the ledger
  const m1 = readJson(withRecord, 'run.json');
  assert.equal(deriveRunStatus(withRecord.runDir, m1), 'paused'); assert.equal(runResumability(withRecord.runDir, m1).needs, 'answer');
  assert.equal(readStoppedMarker(withRecord.runDir), null, 'the budget stop is no cause marker');
  const k1 = classifyStop({ status: 'paused', marker: readStoppedMarker(withRecord.runDir) }); assert.deepEqual([k1.ok, k1.code], [false, 'not_a_choice_stop']);
  const noRecord = stopIn('after', EXTERNAL_HANDOFF).w;
  writeFileSync(join(noRecord.runDir, 'NEEDS-handoff.md'), '# a session\'s stage waits\n');   // the same shape, with no finish on record
  const m2 = readJson(noRecord, 'run.json');
  assert.equal(deriveRunStatus(noRecord.runDir, m2), 'budget_stopped'); assert.equal(runResumability(noRecord.runDir, m2).needs, 'higher_cap');
  const k2 = classifyStop({ status: 'budget_stopped', marker: readStoppedMarker(noRecord.runDir) }); assert.deepEqual([k2.ok, k2.budget], [true, true]);   // old bar: [false, 'spending_limit']
});


// ---------- the per-provider caps path (the typed-limit gate of C&C's third test) ----------
const BOTH = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const TWO_CAPS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json'), 'utf8'));
const ledgerOf = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const gatesOf = d => ledgerOf(d).filter(l => l.event === 'gate_requested').map(l => l.gate);
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };

function capsStop() {   // a run armed under an anthropic and an openrouter limit, stopped at the openrouter limit INSIDE or AFTER the review rounds (found by trial, as stopIn does)
  const tried = [];
  for (const openrouterLimit of ['0.01', '0.02', '0.05', '0.1', '0.2', '0.5', '1', '2', '5']) {
    const work = mkdtempSync(join(tmpdir(), 'thc-fn-caps-')); dirs.push(work);
    mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
    writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n'); writeFileSync(join(work, 'chains', `${TWO_CAPS.name}.json`), JSON.stringify(TWO_CAPS, null, 2));
    const run = args => { const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...BOTH }, encoding: 'utf8', timeout: 120_000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
    const id = '2026-11-10T09-30-00-000Z'; const dir = join(work, 'runs', id);
    if (run(['--task', 'tasks/x.md', '--chain', TWO_CAPS.name, '--run-id', id]).code !== 21) { tried.push(`${openrouterLimit}: no start screen`); continue; }
    for (const cap of ['anthropic', 'openrouter']) {
      const gate = gatesOf(dir).find(g => readGateAnswer(dir, g).gate.cap?.cap_name === cap && readGateAnswer(dir, g).gate.cap?.operation === 'start');
      typeLimit(dir, gate, cap === 'anthropic' ? '1000' : openrouterLimit);
    }
    const first = run(['--resume', dir]);
    const phase = first.code === 4 ? JSON.parse(readFileSync(join(dir, 'STOPPED-budget.json'), 'utf8')).phase ?? null : null;
    tried.push(`${openrouterLimit}: exit ${first.code}, phase ${phase}`);
    if (phase === 'loop' || phase === 'after') return { dir, run, phase };
  }
  assert.fail(`premise: no openrouter limit stopped the run inside or after the review rounds: ${tried.join(' | ')}`);
}

test('FS-10 (the typed-limit gate, per-provider caps): a run stopped at its openrouter limit meets the limit gate on a plain resume (exit 21) and --finish-now does NOT: it asks no limit, requests no gate, reserves nothing and ENDS the run; the screen carries the paragraph', () => {
  const { dir, run, phase } = capsStop();
  assert.equal(run(['--resume', dir]).code, 21, 'a plain resume meets the limit gate (it asks for a new total)');
  const gates = gatesOf(dir).length; const reserved = () => (existsSync(join(dir, 'spend-reservations.jsonl')) ? readFileSync(join(dir, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0);
  const before = reserved();
  assert.match(readFileSync(join(dir, 'STOPPED-budget.md'), 'utf8'), /--finish-now/, `the per-cap screen has the paragraph (phase ${phase})`);
  const rp = join(dir, 'run.json'); const rj = JSON.parse(readFileSync(rp, 'utf8'));
  writeFileSync(rp, JSON.stringify({ ...rj, caps: { anthropic: { maxUsd: 987654 }, openrouter: { maxUsd: 987654 } } }, null, 2));   // planted: run.json is project-writable text and is not the limit. FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026): OLD also planted a top-level maxUsd, which the caps guard (src/caps.js capsResumeVerdict) refuses as a flip of the limit kind before the finish-now path is reached; only the per-provider plant is kept
  const now = run(['--resume', dir, '--finish-now']);
  assert.match(now.out, /the limits the run stopped at, kept in force/, 'the second wall: the stopped limits stay in force in this command');
  assert.doesNotMatch(now.out, /987,?654/, 'and they are the ledger\'s, not run.json\'s');
  assert.notEqual(now.code, 21, `no limit screen: ${now.out}`);
  assert.ok([0, 22].includes(now.code), `the run ended: exit ${now.code}: ${now.out}`);
  assert.equal(gatesOf(dir).length, gates, 'no gate was requested');
  assert.equal(reserved(), before, 'nothing was reserved');
  assert.ok(existsSync(join(dir, 'report.json')) && !existsSync(join(dir, 'STOPPED-budget.json')));
  const rep = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.deepEqual((rep.kept_limits ?? []).map(k => k.cap_name).sort(), ['anthropic', 'openrouter'], 'each kept limit is on the record');
  assert.ok(rep.kept_limits.every(k => k.limit_usd > 0 && Number.isFinite(k.spent_usd)) && !rep.kept_limits.some(k => k.limit_usd === 987654), 'with what was counted, and the ledger\'s limit, not the planted one');
});

// ---------- the one-typed-limit branch (a paid chain, one typed limit), on a loopback stub that COUNTS requests ----------
import http from 'node:http';
import { typeCap } from './helpers/typed-cap.js';

async function stubFixture() {
  let requests = 0;
  const srv = http.createServer((req, res) => { requests += 1; req.resume(); res.statusCode = 500; res.end('{"error":"stub"}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const work = mkdtempSync(join(tmpdir(), 'thc-fn-stub-')); dirs.push(work); mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  // every seat is a mock seat that bills nothing EXCEPT the handoff seat, a keyed seat on the counting stub: the loop and the final read run free, the stop comes at the handoff (phase after)
  writeFileSync(join(work, 'chains', 'c.json'), JSON.stringify({ ...base, name: 'c', handoff: true, seats: { ...base.seats, handoff: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${srv.address().port}/v1` } } }));
  const env = { PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const run = args => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('exit', status => { clearTimeout(timer); resolve({ status, out: stdout + stderr }); });
  });
  return { srv, work, run, count: () => requests, runDir: join(work, 'runs', ID) };
}

test('FS-15 (the one-typed-limit branch, a real keyed seat on a counting stub): the stop comes at the handoff after the rounds; --finish-now ENDS the run with ZERO requests to the stub, the ledger\'s limit kept in force (a planted run.json figure is not), no HANDOFF.md, the kept limit on the report; an unreadable ledger and a folder with no ledger limit REFUSE the command with the sentence that says what the person can still do', async () => {
  const f = await stubFixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(f.runDir, '0.001');
    const stopped = await f.run(['--resume', f.runDir]);
    assert.equal(stopped.status, 4, `the premise: stopped at the handoff's call: ${stopped.out}`); assert.equal(f.count(), 0);
    assert.equal(JSON.parse(readFileSync(join(f.runDir, 'STOPPED-budget.json'), 'utf8')).phase, 'after', 'the premise: after the review rounds');
    const rp = join(f.runDir, 'run.json'); const rj = JSON.parse(readFileSync(rp, 'utf8')); writeFileSync(rp, JSON.stringify({ ...rj, maxUsd: 987654 }, null, 2));   // planted
    // an unreadable ledger, and a folder with no ledger limit at all: refused with nothing run (the old folder from before the record: the same sentence)
    const lp = join(f.runDir, LEDGER_FILE); const ledgerText = readFileSync(lp, 'utf8');
    writeFileSync(lp, `${ledgerText}this is not a ledger line\n`);
    const bad = await f.run(['--resume', f.runDir, '--finish-now']);
    assert.equal(bad.status, 2, bad.out); assert.match(bad.out, /cannot be read from the record of what you typed/); assert.match(bad.out, /What you can still do: a plain resume asks for a new limit/); assert.equal(f.count(), 0);
    rmSync(lp, { force: true });
    const none = await f.run(['--resume', f.runDir, '--finish-now']);
    assert.equal(none.status, 2, none.out); assert.match(none.out, /What you can still do: a plain resume asks for a new limit/); assert.equal(f.count(), 0);
    writeFileSync(lp, ledgerText);
    writeFileSync(rp, JSON.stringify({ ...JSON.parse(readFileSync(rp, 'utf8')), maxUsd: 987654 }, null, 2));   // planted again right before the run that must ignore it
    assert.equal(JSON.parse(readFileSync(rp, 'utf8')).maxUsd, 987654, 'premise: the plant is there');
    const now = await f.run(['--resume', f.runDir, '--finish-now']);
    assert.ok([0, 22].includes(now.status), now.out); assert.equal(f.count(), 0, 'zero requests');
    assert.match(now.out, /\(the limit of the stopped run\)/); assert.doesNotMatch(now.out, /987,?654/);
    assert.ok(!existsSync(join(f.runDir, 'HANDOFF.md')));
    const rep = JSON.parse(readFileSync(join(f.runDir, 'report.json'), 'utf8'));
    assert.deepEqual(rep.kept_limits.map(k => [k.cap_name, k.limit_usd]), [[null, 0.001]], 'the ledger\'s limit, not the planted one');
    assert.ok(rep.stages_not_run.some(s => s.label === 'handoff'));
  } finally { f.srv.close(); }
});

test('FS-16 (a kept limit that fires in the sitting writes NO second budget stop): SOURCE-PINNED, not a behaviour test - the catch of a --finish-now sitting for NotRunForLimit and BudgetExceeded writes no stop file and exits 4 with the run as it was, and the stop files are set aside only when the run ended', () => {
  const src = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const a = src.indexOf('if (budgetFinishNow && (err instanceof NotRunForLimit || err instanceof BudgetExceeded)) {');
  const b = src.indexOf('if (err instanceof BudgetExceeded) {', a);
  assert.ok(a > 0 && b > a, 'the sitting\'s catch comes BEFORE the generic budget stop');
  const block = src.slice(a, b);
  assert.doesNotMatch(block, /writeFileSync|STOPPED-budget|clearStopRecords/); assert.match(block, /process\.exit\(4\)/);
  assert.match(src, /if \(!treeLineage && !budgetFinishNow\) clearStopRecords\(\);/, 'not set aside at the start of a finish-now sitting');
  assert.match(src, /if \(budgetFinishNow\) \{\n[^\n]*\n  clearStopRecords\(\);/, 'set aside once the run ended');
});

// ---------- the way back, the ledger event, the accept check ----------
import { budgetFinishLineProblem, budgetFinishOf } from '../src/gate-ledger.js';
import { recordBudgetFinish, budgetFinishRecordFor } from '../src/gate.js';
import { pickAcceptance } from '../src/accept-run.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { renderBoardMd } from '../src/report-shape.js';

test('FS-20 (the way back on a free mock chain): with the finish on record, a resume that carries --max-usd is the ordinary path: the run pauses again at the session stage with no "on record" line, and after the answer it ends ORDINARILY (no spending_finish, no stages_not_run, no kept_limits)', () => {
  const { w } = stopIn('after', EXTERNAL_HANDOFF);
  const first = w.run(['--resume', w.runDir, '--finish-now']); assert.equal(first.status, 3, `${first.stdout}${first.stderr}`);
  const raised = w.run(['--resume', w.runDir, '--max-usd', '100000']);
  const out = `${raised.stdout}${raised.stderr}`;
  assert.equal(raised.status, 3, out); assert.doesNotMatch(out, /your --finish-now is on record/, 'the ordinary path: not a finish-now sitting');
  writeFileSync(join(w.runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(w.runDir, 'handoff.md.partial'), join(w.runDir, 'handoff.md'));
  const done = w.run(['--resume', w.runDir, '--max-usd', '100000']);
  assert.ok([0, 22].includes(done.status), `${done.stdout}${done.stderr}`);
  const rep = readJson(w, 'report.json');
  assert.equal(rep.spending_finish, undefined); assert.equal(rep.stages_not_run, undefined); assert.equal(rep.kept_limits, undefined);
});

test('FS-21 (the ledger event, can-fail rows; a bare gate_requested row means a raise the person started that still waits): budgetFinishLineProblem refuses a bad hash, a bad phase, a wrong actor or channel and a duplicate for the same stop, and passes a valid line; recordBudgetFinish called twice writes ONE line (already: true the second time); a record for another stop is not found', () => {
  const good = { event: 'budget_finish', stop_sha256: 'a'.repeat(64), phase: 'after', choice: 'finish_now', actor: 'person', channel: 'cli' };
  assert.equal(budgetFinishLineProblem(good, []), null);
  for (const [bad, code] of [[{ ...good, stop_sha256: 'xyz' }, 'budget_finish_stop_invalid'], [{ ...good, phase: 'before' }, 'budget_finish_phase_invalid'], [{ ...good, actor: 'handler' }, 'budget_finish_channel_invalid'], [{ ...good, channel: 'session' }, 'budget_finish_relayed_shape'], [{ ...good, choice: 'resume' }, 'budget_finish_choice_invalid'], [{ ...good, choice: 'finish' }, 'budget_finish_plain_after']])
    assert.equal(budgetFinishLineProblem(bad, [])?.code, code, code);
  assert.equal(budgetFinishLineProblem(good, [{ ...good, seq: 1 }]), null, 'a second line for the same stop is allowed: the person\'s latest choice decides');
  assert.equal(budgetFinishOf([{ ...good, seq: 1 }], 'b'.repeat(64)), null);
  assert.equal(budgetFinishOf([{ ...good, seq: 1 }], good.stop_sha256)?.seq, 1, 'a record stands');
  assert.equal(budgetFinishOf([{ ...good, seq: 1 }, { event: 'gate_requested', kind: 'run_cap', seq: 2 }], good.stop_sha256), null, 'a limit gate requested after it: the raise is the later choice');
  assert.equal(budgetFinishOf([{ ...good, seq: 1 }, { event: 'gate_requested', kind: 'run_cap', seq: 2 }, { ...good, seq: 3 }], good.stop_sha256)?.seq, 3, 'and a finish-now typed again after the raise stands again');
  const { w } = stopIn('after', EXTERNAL_HANDOFF);
  const sha = 'c'.repeat(64);
  const one = recordBudgetFinish(w.runDir, { stopSha256: sha, phase: 'after' }); const two = recordBudgetFinish(w.runDir, { stopSha256: sha, phase: 'after' });
  assert.deepEqual([one.ok, one.already, two.ok, two.already, two.seq], [true, false, true, true, one.seq]);
  assert.equal(readFileSync(join(w.runDir, LEDGER_FILE), 'utf8').split('\n').filter(l => l.includes('"budget_finish"')).length, 1);
  assert.ok(budgetFinishRecordFor(w.runDir, sha)); assert.equal(budgetFinishRecordFor(w.runDir, 'd'.repeat(64)), null);
});

test('FS-22 (spending_finish, the accept path): the person\'s RELAYED acceptance is still taken after a finish-now at a spending stop (it never goes through the session check), the session\'s own is refused as the person\'s stop; control: without the record the session\'s own passes the same check', () => {
  const quote = { sha256: 'h'.repeat(64), report: { passed: false, spending_finish: { phase: 'after', label: 'handoff' }, delivered_text: { same_as_signed: true } }, meta: {}, objections: [] };
  const relayed = { sha256: quote.sha256, channel: 'session', reason: 'The person accepts this plan.', acceptance_answer: { relayed: true, objections: [] } };
  const own = { sha256: quote.sha256, channel: 'session', reason: 'I accept this plan.', acceptance_answer: { objections: [] } };
  assert.ok(pickAcceptance(quote, [relayed]).chosen, 'the relayed acceptance counts');
  assert.equal(pickAcceptance(quote, [own]).refusal?.code, 'session_person_stop');
  assert.ok(pickAcceptance({ ...quote, report: { ...quote.report, spending_finish: undefined } }, [own]).chosen, 'control');
});

test('FS-23 (an agreed run carrying the record says nothing of "not agreed"): a report with passed:true, spending_finish and stages_not_run - the run status, the verdict headline and the board contain no "not agreed" and no NOT-agreed heading', async () => {
  const r = await run({ misses: ['handoff'], extra: { handoff: true } });
  assert.equal(r.report.passed, true);
  const report = { ...r.report, spending_finish: { phase: 'after', label: 'handoff' }, kept_limits: [{ cap_name: null, limit_usd: 1, spent_usd: 0.5 }] };
  const board = renderBoardMd({ runId: 'r-fns', result: { ...r.result, spendingFinish: { phase: 'after', label: 'handoff' } } });
  for (const [what, text] of [['run status', finishedRunState(report)], ['verdict headline', JSON.stringify(verdictHeadline(report))], ['board', board]]) assert.doesNotMatch(text, /not agreed/i, `${what} says nothing of "not agreed": ${text.slice(0, 200)}`);
  assert.match(board, /## Ended at the spending limit/);
});

test('FS-24 (the way back on a PAID one-limit chain, the stub): with the finish on record (written by the code\'s own writer), `--resume --raise-cap` reaches the limit screen (exit 21), sends ZERO requests, leaves the run stopped; a plain `--resume` then waits for the typed limit (exit 21) with zero requests', async () => {
  const f = await stubFixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(f.runDir, '0.001');
    assert.equal((await f.run(['--resume', f.runDir])).status, 4, 'the premise: stopped at the handoff'); assert.equal(f.count(), 0);
    const sp = join(f.runDir, 'STOPPED-budget.json');
    const rec = recordBudgetFinish(f.runDir, { stopSha256: stopShaOf(JSON.parse(readFileSync(sp, 'utf8'))), phase: 'after' });
    assert.equal(rec.ok, true, JSON.stringify(rec));
    const raise = await f.run(['--resume', f.runDir, '--raise-cap']);
    assert.equal(raise.status, 21, `the raise reaches the limit screen: ${raise.out}`); assert.equal(f.count(), 0);
    assert.ok(existsSync(sp) && !existsSync(join(f.runDir, 'report.json')), 'still stopped');
    const plain = await f.run(['--resume', f.runDir]);
    // FINDING (not on the owed list of the ladder unit; first box run, 10 Nov 2026): OLD: a plain resume after the person started a raise ENDED the run on the finish record. The ruling (the person's latest choice decides; a waiting person-started raise sets the finish record aside, "ending cannot be undone, waiting can": FS-26 pins it on the same setup) keeps the run waiting: exit 21, still stopped, zero requests.
    assert.equal(plain.status, 21, `a plain resume after a started raise waits for the typed limit: ${plain.out}`); assert.match(plain.out, /This run waits for a spending limit that you type/); assert.equal(f.count(), 0);
    assert.ok(existsSync(sp) && !existsSync(join(f.runDir, 'report.json')), 'still stopped');
  } finally { f.srv.close(); }
});

// ---------- the person's LATEST choice decides (sequences), the handler path, the record path ----------
const ledgerLinesOf = dir => readFileSync(join(dir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const answerHandoff = w => { writeFileSync(join(w.runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(w.runDir, 'handoff.md.partial'), join(w.runDir, 'handoff.md')); };

test('FS-25 (sequences on a free chain; the latest choice decides): (1) at a stop IN the loop (the only place a plain --finish exists): finish-now (pauses at the session stage), then a plain --finish (exit 4, a later choice): run_status reads budget_stopped / higher_cap again, and a --finish-now typed again at the SAME stop goes on ending - a NEW ledger line, a pause at the session stage again, and a plain resume after the answer ends the run; (2) finish-now typed TWICE: the second is not refused, writes no second line, pauses at the same stage, and a plain resume after the answer ends the run', () => {
  const a = stopIn('loop', LOOP_EXTERNAL).w;
  const first = a.run(['--resume', a.runDir, '--finish-now']);
  assert.equal(first.status, 3, `premise: the ending pauses at the session's handoff: ${first.stdout}${first.stderr}`);
  assert.equal(a.run(['--resume', a.runDir, '--finish']).status, 4, 'a plain --finish records and ends at exit 4 (it exists only at a stop in the loop)');
  const res = runResumability(a.runDir, readJson(a, 'run.json'));
  assert.deepEqual([res.status, res.needs], ['budget_stopped', 'higher_cap'], `the plain finish is the later choice: ${JSON.stringify(res)}`);
  const again = a.run(['--resume', a.runDir, '--finish-now']);
  assert.equal(again.status, 3, `finish-now typed again goes on ending (it pauses at the session stage, it is not refused): ${again.stdout}${again.stderr}`);
  assert.deepEqual(ledgerLinesOf(a.runDir).filter(l => l.event === 'budget_finish').map(l => l.choice), ['finish_now', 'finish', 'finish_now'], 'the plain finish is a ledger line too, and the retyped finish-now is a NEW line after it (the latest choice decides)');
  answerHandoff(a);
  const ended = a.run(['--resume', a.runDir]); assert.ok([0, 22].includes(ended.status), `${ended.stdout}${ended.stderr}`); assert.ok(existsSync(join(a.runDir, 'report.json')));
  const b = stopIn('after', EXTERNAL_HANDOFF).w;
  assert.equal(b.run(['--resume', b.runDir, '--finish-now']).status, 3);
  const twice = b.run(['--resume', b.runDir, '--finish-now']);
  assert.equal(twice.status, 3, `${twice.stdout}${twice.stderr}`); assert.doesNotMatch(`${twice.stdout}${twice.stderr}`, /could not be recorded/);
  assert.equal(ledgerLinesOf(b.runDir).filter(l => l.event === 'budget_finish').length, 1, 'typed twice = one line');
  answerHandoff(b);
  const done = b.run(['--resume', b.runDir]); assert.ok([0, 22].includes(done.status), `${done.stdout}${done.stderr}`); assert.ok(existsSync(join(b.runDir, 'report.json')));
});

test('FS-26 (sequences on a paid one-limit chain, the stub; the latest choice decides): finish-now on record, then a raise STARTED with no limit typed (--raise-cap, exit 21): a plain resume waits for the limit (exit 21) and does not end the run; and (check 2) a record given before a raise never applies after it even with the old stop file put back: after a typed raise and a second stop, the old stop file restored, a plain resume is the ordinary path', async () => {
  const f = await stubFixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(f.runDir, '0.001');
    assert.equal((await f.run(['--resume', f.runDir])).status, 4); assert.equal(f.count(), 0);
    const sp = join(f.runDir, 'STOPPED-budget.json'); const oldStop = readFileSync(sp, 'utf8');
    assert.equal(recordBudgetFinish(f.runDir, { stopSha256: stopShaOf(JSON.parse(oldStop)), phase: 'after' }).ok, true);
    assert.equal((await f.run(['--resume', f.runDir, '--raise-cap'])).status, 21, 'a raise started');
    const waiting = await f.run(['--resume', f.runDir]);
    assert.equal(waiting.status, 21, `the raise is the later choice: a plain resume waits for the limit: ${waiting.out}`); assert.equal(f.count(), 0); assert.ok(!existsSync(join(f.runDir, 'report.json')));
    // check 2: the raise is TYPED, the run goes on and stops again; the OLD stop file is put back: the old record must not apply
    typeCap(f.runDir, '0.002');
    await f.run(['--resume', f.runDir]);
    writeFileSync(sp, oldStop);
    const replayed = await f.run(['--resume', f.runDir]);
    assert.notEqual(replayed.status, 0, replayed.out);
    if (existsSync(join(f.runDir, 'report.json'))) assert.equal(JSON.parse(readFileSync(join(f.runDir, 'report.json'), 'utf8')).spending_finish, undefined, 'the old record did not end the run as a finish');
    assert.doesNotMatch(replayed.out, /you chose to end the run at the spending limit/);
  } finally { f.srv.close(); }
});

test('FS-27 (the handler path: submit_stage with a ceiling): a stopped run with the finish on record and a session stage answered through MCP submit_stage - with COUNCIL_MAX_USD_LIMIT set BELOW the run\'s saved cap, so the MCP resume adds --max-usd (ceilingArgs) - still ENDS the run: that figure is not a raise (it is not above the limit the run stopped at)', async () => {
  const { w } = stopIn('after', EXTERNAL_HANDOFF);
  const stop = JSON.parse(readFileSync(join(w.runDir, 'STOPPED-budget.json'), 'utf8'));
  assert.equal(w.run(['--resume', w.runDir, '--finish-now']).status, 3);
  const limit = String(Math.max(0.0001, stop.capUsd / 2));
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: w.dir, env: { PATH: process.env.PATH, HOME: w.dir, COUNCIL_MAX_USD_LIMIT: limit, ...malformedProviderKeys() } });   // the zero-spend rule: no key of a clone or a shell can reach a provider from this child
  const reply = await new Promise((done, fail) => {
    let buf = ''; const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, 60_000);
    child.stdout.on('data', d => { buf += d; for (const line of buf.split('\n')) { try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); done(m); } } catch { /* partial */ } } });
    child.stdin.write([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fs27', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'submit_stage', arguments: { run: ID, stage: 'handoff', content: 'Status: ready_for_build\n\nBuild it.\n' } } }].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
  const started = Date.now();
  while (!existsSync(join(w.runDir, 'report.json')) && Date.now() - started < 60_000) await new Promise(r => setTimeout(r, 200));
  child.kill();
  assert.ok(existsSync(join(w.runDir, 'report.json')), `the run ended after submit_stage: ${JSON.stringify(reply).slice(0, 400)}`);
  assert.equal(readJson(w, 'report.json').spending_finish?.phase, 'after');
});

test('FS-28 (the record path equals the flag path): with the finish on record, a plain resume (a) refuses with the kept-limit sentence when the limit cannot be read from the record of what was typed (the screen text of the limit gate was changed after it was approved), with zero requests; and (b) a typed --finish-now whose record cannot be written (the ledger is read-only) runs NOTHING (exit 2, zero requests, the run still stopped); (b) is skipped under root', async () => {
  const f = await stubFixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(f.runDir, '0.001');
    assert.equal((await f.run(['--resume', f.runDir])).status, 4);
    const sp = join(f.runDir, 'STOPPED-budget.json');
    // (b) first (it needs the ledger unchanged)
    if (process.getuid && process.getuid() !== 0) {
      const lp = join(f.runDir, LEDGER_FILE); chmodSync(lp, 0o444);
      try {
        const ro = await f.run(['--resume', f.runDir, '--finish-now']);
        assert.equal(ro.status, 2, ro.out); assert.match(ro.out, /could not be recorded|ledger/i); assert.equal(f.count(), 0); assert.ok(existsSync(sp) && !existsSync(join(f.runDir, 'report.json')));
      } finally { chmodSync(lp, 0o644); }
    }
    // (a)
    assert.equal(recordBudgetFinish(f.runDir, { stopSha256: stopShaOf(JSON.parse(readFileSync(sp, 'utf8'))), phase: 'after' }).ok, true);
    const gate = ledgerLinesOf(f.runDir).find(l => l.event === 'gate_requested' && l.kind === 'run_cap');
    const textPath = join(f.runDir, gate.text); writeFileSync(textPath, `${readFileSync(textPath, 'utf8')}\nchanged after it was approved\n`);
    const plain = await f.run(['--resume', f.runDir]);
    assert.equal(plain.status, 2, plain.out); assert.match(plain.out, /cannot be read from the record of what you typed/); assert.equal(f.count(), 0); assert.ok(existsSync(sp));
  } finally { f.srv.close(); }
});

// ---------- what the PERSON did after the record sets it aside (fix-up of the commit) ----------
test('FS-29 (a limit approved after the record; a raise the session opened that came to nothing): pure rows on the standing rule. SET ASIDE: a limit gate requested BEFORE the finish-now and approved AFTER it; a raise the person started (not requested by the session) and that still waits. STANDS: a session-opened raise that was declined, that expired, or that still waits; a person-started raise that was declined or expired. WHO requests a limit gate: ONE caller, the command line (cli.js authorizeStart), at the terminal or spawned by the MCP; requested_by is \'session\' only for `--raise-cap --relayed` (the handler session\'s relayed raise) and absent for everything else - the terminal AND the MCP\'s own dialog (start_run / resume_run raise through elicitation, answered on the elicitation channel). So the session rows below are the RELAYED raise; a dialog raise is a person-started shape: declined or expired stands, still waiting sets aside until it expires', () => {
  const sha = 'a'.repeat(64);
  const fin = seq => ({ event: 'budget_finish', stop_sha256: sha, phase: 'after', choice: 'finish_now', actor: 'person', channel: 'cli', seq, ts: '2026-11-10T10:00:00.000Z' });
  const req = (seq, gate, extra = {}) => ({ event: 'gate_requested', kind: 'run_cap', gate, seq, expires_at: '2099-01-01T00:00:00.000Z', ...extra });
  const ans = (seq, gate, decision, channel = 'cli') => ({ event: 'gate_answered', gate, decision, channel, seq });
  const NOW = Date.parse('2026-11-10T11:00:00.000Z'); const stands = lines => budgetFinishOf(lines, sha, NOW) !== null;
  assert.equal(stands([req(1, 'g1'), fin(2), ans(3, 'g1', 'approved')]), false, 'requested before, approved after: the person\'s limit is the later choice');
  assert.equal(stands([req(1, 'g1'), fin(2), ans(3, 'g1', 'declined')]), true, 'requested before, declined after: nothing was chosen');
  assert.equal(stands([fin(1), req(2, 'g1', { requested_by: 'session' })]), true, 'a session-opened raise that still waits');
  assert.equal(stands([fin(1), req(2, 'g1', { requested_by: 'session' }), ans(3, 'g1', 'declined')]), true, 'a session-opened raise that was declined');
  assert.equal(stands([fin(1), req(2, 'g1', { requested_by: 'session', expires_at: '2026-11-10T10:30:00.000Z' })]), true, 'a session-opened raise that expired');
  assert.equal(stands([fin(1), req(2, 'g1', { requested_by: 'session' }), ans(3, 'g1', 'approved', 'session')]), false, 'a relayed raise (requested by the session, answered on the session channel with the person\'s words) that was approved after the record sets it aside (the approval test counts every channel)');
  assert.equal(stands([fin(1), req(2, 'g1')]), false, 'a raise the person started and that still waits');
  assert.equal(stands([fin(1), req(2, 'g1'), ans(3, 'g1', 'declined')]), true, 'a person-started raise that was declined');
  assert.equal(stands([fin(1), req(2, 'g1', { expires_at: '2026-11-10T10:30:00.000Z' })]), true, 'a person-started raise that expired unanswered');
});

test('FS-30 (a ceiling EQUAL to the saved cap is not a raise): on a free chain with the finish on record, a resume that carries --max-usd equal to the limit the run stopped at - from any caller - still ENDS the run on the record; one cent above it is the person\'s raise and takes the ordinary path', () => {
  const eq = stopIn('after', EXTERNAL_HANDOFF).w;
  const cap = JSON.parse(readFileSync(join(eq.runDir, 'STOPPED-budget.json'), 'utf8')).capUsd;
  assert.equal(eq.run(['--resume', eq.runDir, '--finish-now']).status, 3);
  answerHandoff(eq);
  const same = eq.run(['--resume', eq.runDir, '--max-usd', String(cap)]);
  assert.ok([0, 22].includes(same.status), `an equal ceiling is not a raise: ${same.stdout}${same.stderr}`); assert.equal(readJson(eq, 'report.json').spending_finish?.phase, 'after');
  const up = stopIn('after', EXTERNAL_HANDOFF).w;
  const cap2 = JSON.parse(readFileSync(join(up.runDir, 'STOPPED-budget.json'), 'utf8')).capUsd;
  assert.equal(up.run(['--resume', up.runDir, '--finish-now']).status, 3);
  const raised = up.run(['--resume', up.runDir, '--max-usd', String(cap2 + 0.01)]);
  const out = `${raised.stdout}${raised.stderr}`;
  assert.ok(![0, 22].includes(raised.status), `above the saved cap: the ordinary path, not the finish (it stops again at the limit or pauses at the session stage): exit ${raised.status}: ${out}`);
  assert.doesNotMatch(out, /your --finish-now is on record/); assert.doesNotMatch(out, /you chose to end the run at the spending limit/);
  assert.ok(!existsSync(join(up.runDir, 'report.json')) || readJson(up, 'report.json').spending_finish === undefined, 'no report that says the person finished the run');
});

test('FS-31 (a limit question waits; finish-now typed again ends the run): on the paid one-limit chain (the stub) with the finish on record, a raise started with --raise-cap leaves a limit question open (exit 21) and sets the record aside; --finish-now typed again goes on ENDING the run - a new ledger line, zero requests, no limit asked - because ending cannot be undone and waiting can', async () => {
  const f = await stubFixture();
  try {
    assert.equal((await f.run(['--chain', 'c', '--task', 'tasks/x.md', '--run-id', ID])).status, 21);
    typeCap(f.runDir, '0.001');
    assert.equal((await f.run(['--resume', f.runDir])).status, 4); assert.equal(f.count(), 0);
    const sp = join(f.runDir, 'STOPPED-budget.json');
    assert.equal(recordBudgetFinish(f.runDir, { stopSha256: stopShaOf(JSON.parse(readFileSync(sp, 'utf8'))), phase: 'after' }).ok, true);
    assert.equal((await f.run(['--resume', f.runDir, '--raise-cap'])).status, 21, 'the question is open');
    const again = await f.run(['--resume', f.runDir, '--finish-now']);
    assert.ok([0, 22].includes(again.status), `typed again: it ends the run: ${again.out}`); assert.equal(f.count(), 0);
    assert.equal(ledgerLinesOf(f.runDir).filter(l => l.event === 'budget_finish').length, 2, 'a new line: the later choice');
    assert.ok(existsSync(join(f.runDir, 'report.json')) && !existsSync(sp));
  } finally { f.srv.close(); }
});

test('FS-13b (a COMPLETE final read on disk counts as read; own fix-up on 4b): finish-now at a spending stop in the loop, the top seat\'s final read is on disk for this text and OBJECTS: the sitting replays it (no live call), final_read.ran is true with the seat read and its objection the named basis, the run is NOT agreed, the finish is still at once (stop.finished_at_once), and the words say "after the final read", never "no judge read the plan again"; the control is FS-13 (phase loop), the same sitting with no read on disk: ran false, finished_at_once', async () => {
  const r = await run({ scripted: { ...lowScript, [`final-read-top-gamma`]: objects(T1(0)) }, extra: { ...JUDGE_CHAIN, handoff: true }, spendFinish: true, misses: [`panel-3-${LOWLAB}`, `panel-2-${LOWLAB}`] });
  assert.equal(r.report.passed, false); assert.equal(r.report.stop?.finished_at_once, true, 'the finish is still at once');
  const live = (r.report.stages ?? []).filter(s => s.model === JUDGE && s.cached !== true);
  assert.deepEqual(live.map(s => s.label), [], 'nothing was asked: the read is replayed from disk');
  assert.notEqual(r.report.final_read?.reason, 'every_top_seat_read_this_plan', 'premise: the top seat had NOT read this text before (a read is owed), so the scripted read is the one replayed');
  assert.equal(r.report.final_read?.ran, true, 'the read on disk counts as read');
  assert.deepEqual((r.report.final_read?.seats ?? []).map(s => [s.lab, s.read, s.not_run ?? null]), [['top-gamma', true, null]]);
  assert.equal(r.report.final_read?.basis, 'final_read_objection', 'the ending follows the read: not agreed because the read objected');
  // FINDING (not on the owed list of the ladder unit; first box run, 10 Nov 2026): OLD: asserted on r.state (finishedRunState's fixed `done: ...` line). These words are the verdict HEADLINE's (verdict-headline.js budgetFinishWords, LAD-R21/R26/S16-w60); the state line carries the stage and the calls not made. NEW: asserted on the words function.
  const words = VH.budgetFinishWords(r.report); assert.match(words, /after the final read/); assert.doesNotMatch(words, /no judge read the plan again/);
});

const FINISH_NOW_LOOP = { spendFinish: true, misses: [`panel-3-${LOWLAB}`, `panel-2-${LOWLAB}`] };
const OTHER_PROMPT = 'f'.repeat(16);   // the hash of some other prompt: what a read of ANOTHER text carries on disk (the CLI cache records the hash of the prompt each stage answered)

test('FS-13c (a read on disk for ANOTHER text does not count): the top seat\'s read on disk carries the hash of a different prompt (the draft was revised after it): invoke() calls it stale, does not replay it, the judge seam refuses the call, the seat is NOT RUN (never "read"), nothing was asked; the sitting returns', async () => {
  const logs = [];
  const r = await run({ scripted: { ...lowScript, 'final-read-top-gamma': { text: objects(T1(0)), usage: { input: 0, output: 0 }, promptHash: OTHER_PROMPT } }, extra: { ...JUDGE_CHAIN, handoff: true }, ...FINISH_NOW_LOOP, logs });
  const warning = logs.find(l => l.includes('CACHE STALENESS WARNING: stage "final-read-top-gamma"'));
  assert.ok(warning, `the stale read is set aside with a warning: ${logs.filter(l => /final-read/.test(l)).join(' | ')}`);
  assert.doesNotMatch(warning, /re-running it/, 'a sitting that ends the run sends nothing: the line must not say it re-runs the read (A-DRAFT LAD-R27)');
  assert.match(warning, /it is not asked again because the person ended the run at the spending limit/);
  assert.notEqual(r.report.final_read?.reason, 'every_top_seat_read_this_plan', 'premise: a read is owed');
  assert.equal(r.report.final_read?.ran, false, 'the old read was not replayed: no seat read');
  assert.equal(r.report.final_read?.reason, 'finished_at_once');
  assert.ok(r.report.stages_not_run.some(s => s.label === 'final-read-top-gamma'), `the unasked read is named: ${JSON.stringify(r.report.stages_not_run)}`);
  assert.notEqual(r.report.final_read?.basis, 'final_read_objection', 'the old objection is not on the record');
});

test('FS-13d (a read on disk with NO usable reply): the top seat\'s read on disk is unreadable and its re-ask is not on disk: the re-ask is refused by the seam, the seat is on the record as ASKED and not asked again (read false, reask_not_run spending_limit; never not_run, never an ordinary "did not read"), the sitting RETURNS - no final-read stop, no pause: one finish-now ends the run; the words are LAD-R26 (A-DRAFT), neither "after the final read" nor "no judge read the plan again"', async () => {
  let r; try { r = await run({ scripted: { ...lowScript, 'final-read-top-gamma': 'this is not a reply' }, misses: [...FINISH_NOW_LOOP.misses, 'final-read-top-gamma-reask1'], extra: { ...JUDGE_CHAIN, handoff: true }, spendFinish: true }); } catch (e) { assert.fail(`the sitting must end the run, not stop for a choice (${e?.constructor?.name}: ${String(e?.message).slice(0, 160)})`); }
  assert.equal(r.report.passed, false); assert.equal(r.report.stop?.finished_at_once, true);
  assert.notEqual(r.report.final_read?.reason, 'every_top_seat_read_this_plan', 'premise: a read is owed');
  // MOVED BAR (own fix-up, words for a read on disk with no usable reply): this row asserted ran false (the seat was recorded as not asked, which is untrue: it WAS asked and gave nothing usable)
  assert.equal(r.report.final_read?.ran, true);
  assert.deepEqual((r.report.final_read?.seats ?? []).map(s => [s.lab, s.read, s.not_run ?? null, s.reask_not_run ?? null]), [['top-gamma', false, null, 'spending_limit']]);
  assert.ok(r.report.stages_not_run.some(s => /^final-read-top-gamma/.test(s.label)), JSON.stringify(r.report.stages_not_run));
  { const words = VH.budgetFinishWords(r.report); assert.match(words, /held no usable reply and was not asked again/); assert.doesNotMatch(words, /after the final read|no judge read the plan again|only part/); }   // FINDING (see FS-13b): the words are the headline's
});

test('FS-13e (a final read only PART on disk): one top seat\'s read is on disk (and objects), the other seat\'s is not: ran true with both seats on the record, the other not_run; the words say so (A-DRAFT LAD-R21) and not "after the final read" and not "no judge read the plan again"', async () => {
  const r = await run({ scripted: { ...lowScript, 'final-read-top-gamma': objects(T1(0)) }, misses: [...FINISH_NOW_LOOP.misses, 'final-read-top-delta'], extra: { ...JUDGE_CHAIN, handoff: true }, spendFinish: true,
    seats: { critics: [judge('raiser-alpha', 1), judge('mid-beta', 2), judge('top-gamma', 3), judge('top-delta', 3, PRICED)] } });
  assert.notEqual(r.report.final_read?.reason, 'every_top_seat_read_this_plan', 'premise: a read is owed');
  assert.equal(r.report.final_read?.ran, true);
  assert.deepEqual((r.report.final_read?.seats ?? []).map(s => [s.lab, s.read, s.not_run ?? null]), [['top-gamma', true, null], ['top-delta', false, 'spending_limit']]);
  { const words = VH.budgetFinishWords(r.report); assert.match(words, /only part of the final read was usable/); assert.doesNotMatch(words, /after the final read|no judge read the plan again/); }   // FINDING (see FS-13b): the words are the headline's
});
