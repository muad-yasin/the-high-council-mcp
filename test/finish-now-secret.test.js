// 0.8.4 (the ladder unit, step 3; C&C 10 Nov 2026, terminal-typed only): `--finish-now` at a FOUND-SECRET pause (STOPPED-secret.md + secret-stop.json). The person ends the run in the one command: the loop ends at the paused stage (nothing of it is sent), no judge is asked
// again, the value the pause found is NOT added to the allowed list, and a final read that is ALREADY ON DISK replays and counts as read (the replay-only seam; a read that is not on disk is not made, its seat reads not run with reason finished_at_once).
// ROWS: SF-1/SF-1b in-process (the fixture of test/finish-now-spending.test.js: a cache that MISSES the labels that are not on disk); SF-2 pure (secretFinishState); SF-3 real command (the wantFinish trap: a typed --finish-now never lands in the plain --finish branch);
// SF-4 the handler sort (a): a finish-now sitting asks nobody, the record says so (NAMED LIMIT: it pairs a round-stop finish-now with setJudgeReplayOnly(true), a state the CLI never produces; the gate keys on finishedAtOnce(), which both real sittings set); SF-5 the record path with a session's handoff. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. NAMED LIMITS: SF-3's pause files are hand-written (as SP-20); the relay of this choice by the session is NOT built (terminal only).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CHAIN from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { finishedRunState } from '../src/run-status.js';
import { secretFinishState } from '../src/secret-pause.js';
import * as VH from '../src/verdict-headline.js';   // namespace: SF-7b fails alone on the old source, the file's other rows keep their own reds
import { SecretShapedPrompt } from '../src/outbound-scan.js';
import { objectionId } from '../src/objection-ids.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { SORTING } from './helpers/rating-demand.js';
import { W31 } from './helpers/w31-held.js';
import { scenario, CRITERION, failureOf } from './helpers/layer-two-run.js';
import { answerBuildChecks } from './helpers/build-check.js';
import { handlerSortSystem, handlerSortUser } from './held-prompts/held-084-b.js';
const { runChain, setPromptSpy, setCache, setBudget, setOutboundScan, setJudgeReplayOnly, RoundStopped, ExternalPause } = CHAIN;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const dirs = [];
afterEach(() => { CHAIN.setNoMoneySitting(false); setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); setJudgeReplayOnly(false); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

// ---------- in-process (the finish-now-spending fixture) ----------
const DRAFT = 'The worker retries failed requests.';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const quotes = ['The worker', 'retries failed', 'failed requests', 'The worker retries'];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures T1(i) carried no rating and no relation. NEW: severity 5 and relation 'new' (each pass raises a different failure and withdraws the one before, so each is a first raise). WHY: ratingDemand and relationRule are recorded (src/prompts/recorded-084-b.js): on this layered unanimous chain a failure without them is an unreadable reply.
const T1 = i => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: quotes[i], fix: 'Fix it.', severity: 5, relation: 'new' });
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];
const LOWLAB = 'raiser-alpha';
const lowScript = Object.fromEntries([1, 2, 3].map(k => [`panel-${k}-${LOWLAB}`, k === 1 ? objects(T1(0)) : objectsAnswering([T1(k - 1)], withdraws(objectionId(LOWLAB, T1(k - 2))))]));
const JUDGE = 'mock-review-fixture'; const writer = { provider: 'mock', model: 'mock-priced', lab: 'writer', maxTokens: 3000 };
const judgeSeat = (lab, layer) => ({ provider: 'mock', model: JUDGE, lab, maxTokens: 3000, layer });

async function run({ misses = [], scripted = {} } = {}) {
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    if (misses.some(m => (m instanceof RegExp ? m.test(label) : m === label))) return null;
    const text = label in scripted ? scripted[label] : label.startsWith('panel-') || label.startsWith('final-read-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  setOutboundScan({ finish: true, atOnce: true }); setJudgeReplayOnly(true);   // what --finish-now at the pause arms (src/cli.js)
  const config = { name: 'fixture-sf', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 3, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 },
    seats: { builder: writer, reviser: writer, critics: [judgeSeat(LOWLAB, 1), judgeSeat('mid-beta', 2), judgeSeat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-sf', log: () => {}, config, roundChoices: [] });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-sf', chain: 'fixture-sf', task: 't.md', result, config })));
  return { result, report, state: finishedRunState(report) };
}
const LOOP_MISSES = [`panel-3-${LOWLAB}`, `panel-2-${LOWLAB}`];

test('SF-1 (a final read ON DISK counts as read, through the replay-only seam): the found-secret finish-now ends the loop at the paused stage; the top seat\'s read is on disk and objects: it is replayed (no live call), final_read.ran is true with the seat read and the objection the basis; the stop is the credential pause, chosen finish, at once; control SF-1b', async () => {
  const r = await run({ scripted: { ...lowScript, 'final-read-top-gamma': objects(T1(0)) }, misses: LOOP_MISSES });
  assert.deepEqual([r.report.passed, r.report.stop?.kind, r.report.stop?.chosen, r.report.stop?.finished_at_once], [false, 'secret_pause', 'finish', true]);
  assert.notEqual(r.report.final_read?.reason, 'every_top_seat_read_this_plan', 'premise: a read is owed');
  assert.equal(r.report.final_read?.ran, true, 'the read on disk counts as read');
  assert.deepEqual((r.report.final_read?.seats ?? []).map(s => [s.lab, s.read, s.not_run ?? null]), [['top-gamma', true, null]]);
  assert.equal(r.report.final_read?.basis, 'final_read_objection');
  assert.deepEqual((r.report.stages ?? []).filter(s => s.model === JUDGE && s.cached !== true).map(s => s.label), [], 'no judge was asked');
});

test('SF-1b (the control: the read is NOT on disk): the seat is not asked, nothing is recorded as read: final_read.ran false, reason finished_at_once; the call is named in stages_not_run with reason finished_at_once (never spending_limit)', async () => {
  const r = await run({ scripted: lowScript, misses: [...LOOP_MISSES, /^final-read-/] });
  assert.deepEqual([r.report.stop?.kind, r.report.stop?.finished_at_once], ['secret_pause', true]);
  assert.deepEqual([r.report.final_read?.ran, r.report.final_read?.reason], [false, 'finished_at_once']);
  assert.ok(r.report.stages_not_run.some(s => /^final-read-top-gamma/.test(s.label) && s.reason === 'finished_at_once'), JSON.stringify(r.report.stages_not_run));
  assert.ok(r.report.stages_not_run.every(s => s.reason === 'finished_at_once'));
});

test('SF-2 (pure, secretFinishState): a finish-now entry for this pause is finish_now; for another stage it is finish_now ONLY when the pause came in the ending (phase after: the ending it started paused again); a plain finish for another stage is still bad; a garbled entry is bad', () => {
  const at = new Date().toISOString();
  const rec = (choice, label) => ({ secretFinish: { choice, label, at, via: 'cli' } });
  assert.equal(secretFinishState(rec('finish_now', 'panel-2-a'), { label: 'panel-2-a', phase: 'loop' }), 'finish_now');
  assert.equal(secretFinishState(rec('finish_now', 'panel-2-a'), { label: 'handoff', phase: 'after' }), 'finish_now');
  assert.equal(secretFinishState(rec('finish_now', 'panel-2-a'), { label: 'handoff', phase: 'loop' }), 'bad');
  assert.equal(secretFinishState(rec('finish', 'panel-2-a'), { label: 'handoff', phase: 'after' }), 'bad', 'a plain finish allowed the values, so it never needed this');
  assert.equal(secretFinishState({ secretFinish: { choice: 'finish_now', label: 'x', at: 'nope' } }, { label: 'x', phase: 'loop' }), 'bad');
  assert.equal(secretFinishState({}, { label: 'x', phase: 'loop' }), 'none');
});

// ---------- the real command: the wantFinish trap ----------
const metaOf = runDir => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
const answerHandoff = runDir => { writeFileSync(join(runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(runDir, 'handoff.md.partial'), join(runDir, 'handoff.md')); };
function pausedLayered({ externalHandoff = false } = {}) {   // SP-20's fixture: a finished layered mock run rewound to a crashed one, the pause files written as the CLI writes them (a NAMED LIMIT: hand-written)
  const dir = mkdtempSync(join(tmpdir(), 'thc-sfn-')); dirs.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  const critics = [
    { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l2', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-script-o-sfn', lab: 'l3b', layer: 3 },
  ];
  writeFileSync(join(dir, 'chains', 'lay-finish.json'), JSON.stringify({ ...base, name: 'lay-finish', handoff: externalHandoff, seats: { ...base.seats, ...(externalHandoff ? { handoff: { provider: 'external', model: 'claude-code-session' } } : {}), builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: externalHandoff ? { provider: 'external', model: 'claude-code-session' } : { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } }));   // chain-lint: a layered chain needs an external reviser (hasHandlingSession) once a seat is external; the judges ('o' scripts) sign off, so the reviser is never asked
  const sh = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  let first = sh(['--chain', 'lay-finish', '--task', 'tasks/t.md']);
  const id = readdirSync(join(dir, 'runs'))[0]; const runDir = join(dir, 'runs', id);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the first run stopped once, at the session's handoff. NEW: it first stops at the handler's build check (layer 3 signed off and the reviser is a session): the test-only handler answers it (test/helpers/build-check.js answerBuildChecks), then the run stops at the handoff as before. WHY: buildCheckSystem and buildCheckUser are recorded (src/build-check.js buildCheckLive, chain.js askBuildCheck).
  if (externalHandoff) { assert.equal(first.status, 3, first.stderr + first.stdout); for (let i = 0; i < 5 && first.status === 3 && answerBuildChecks(runDir) > 0; i++) first = sh(['--resume', join('runs', id)]); assert.equal(first.status, 3, `the ending waits for the session's handoff: ${first.stderr}${first.stdout}`); answerHandoff(runDir); first = sh(['--resume', join('runs', id)]); }   // the first run is finished by the session's handoff, then rewound below
  assert.ok(first.status === 0 || first.status === 22, first.stderr + first.stdout);
  const l2 = readdirSync(runDir).find(x => /^panel-1-.*l2.*\.md$/.test(x)); assert.ok(l2, `a layer-2 panel stage exists: ${readdirSync(runDir).join(' ')}`);
  const label = l2.replace(/\.md$/, '');
  const AFTER = /^(panel|ldebate|lreply|rule|revise|critique|conflict|allocator|final|dispute|handoff|cold|challenge|ending|deep)/;
  for (const x of readdirSync(runDir)) if ((AFTER.test(x) && !/^panel-1-.*l1/.test(x)) || ['report.json', 'deliverable.md', 'BOARD.md', 'HANDOFF.md', 'state.json'].includes(x)) rmSync(join(runDir, x), { force: true });
  const at = new Date().toISOString();
  writeFileSync(join(runDir, 'STOPPED-secret.md'), '# Run paused: a credential-shaped string in a prompt\n');
  writeFileSync(join(runDir, 'secret-stop.json'), JSON.stringify({ schema: 'secret-stop/1', stop: 'a1b2c3d4e5f60718', label, phase: 'loop', findings: [{ part: 'user', line: 1, name: 'anthropic' }], values: ['f'.repeat(32)], at }));
  return { sh, id, runDir, label };
}

test('SF-3 (real command, the wantFinish trap): a typed --finish-now at the credential pause ends the run in that one command, NOT agreed, at once; run.json records choice finish_now (never the plain finish), the found value is NOT allowed (no secretAllow), the closing read did not run (layers 2 and 3 were never asked and nothing is on disk); control: a typed --finish at the same pause only records a plain finish and exits 11 still paused', () => {
  const p = pausedLayered();
  const r = p.sh(['--resume', join('runs', p.id), '--finish-now']);
  assert.notEqual(r.status, 11, r.stderr + r.stdout); assert.notEqual(r.status, 2, r.stderr + r.stdout);
  const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([report.passed, report.stop.kind, report.stop.chosen, report.stop.finished_at_once], [false, 'secret_pause', 'finish', true]);
  assert.equal(metaOf(p.runDir).secretFinish?.choice, 'finish_now', 'recorded as a finish-now, not the plain finish');
  assert.deepEqual(metaOf(p.runDir).secretAllow?.hashes ?? [], [], 'the value the pause found is NOT on the allowed list');
  assert.deepEqual([report.final_read?.ran, report.final_read?.reason], [false, 'finished_at_once'], 'no judge was asked again');
  const c = pausedLayered();
  const plain = c.sh(['--resume', join('runs', c.id), '--finish']);
  assert.equal(plain.status, 11, plain.stderr + plain.stdout);
  assert.equal(metaOf(c.runDir).secretFinish?.choice, 'finish'); assert.ok(existsSync(join(c.runDir, 'STOPPED-secret.md')), 'the plain --finish leaves the run paused');
});

test('SF-3b (refusals, real command): --finish-now at a pause that came BEFORE the review rounds is refused with a sentence that says why and records nothing; with --allow-secret-shaped it is two different choices. (MOVED BAR, 10 Nov 2026: a pause AFTER the rounds used to be refused too; it now ends the run at the pause, see SF-8.)', () => {
  const p = pausedLayered();
  const rec = JSON.parse(readFileSync(join(p.runDir, 'secret-stop.json'), 'utf8'));
  writeFileSync(join(p.runDir, 'secret-stop.json'), JSON.stringify({ ...rec, phase: 'before' }));
  const r = p.sh(['--resume', join('runs', p.id), '--finish-now']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--finish-now: this pause came before the review rounds began, so there is no review to end\./);
  assert.equal(metaOf(p.runDir).secretFinish, undefined, 'nothing was recorded');
  writeFileSync(join(p.runDir, 'secret-stop.json'), JSON.stringify(rec));
  const both = p.sh(['--resume', join('runs', p.id), '--finish-now', '--allow-secret-shaped']);
  assert.equal(both.status, 2); assert.match(both.stderr, /--finish-now and --allow-secret-shaped are two different choices: give one\./);
});

test('SF-8 (real command, a pause AFTER the rounds; hand-written pause files on a run rewound MID-loop, a state the CLI never writes: NAMED LIMIT, the in-process SF-7 is the row that shows a call not made): --finish-now is no longer refused: it records finish_now with phase "after" (run.json), allows nothing (no secretAllow), and the command neither exits 2 (refused) nor 11 (still paused). Known-bad input: the old refusal sentence "the run is already ending" must not appear', () => {
  const p = pausedLayered();
  const rec = JSON.parse(readFileSync(join(p.runDir, 'secret-stop.json'), 'utf8'));
  writeFileSync(join(p.runDir, 'secret-stop.json'), JSON.stringify({ ...rec, phase: 'after' }));
  const r = p.sh(['--resume', join('runs', p.id), '--finish-now']);
  assert.ok([0, 22].includes(r.status), `the sitting ended the run (not refused, not still paused, not crashed): ${r.status} ${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /the run is already ending/);
  assert.ok(existsSync(join(p.runDir, 'report.json')), 'the run has its report');
  assert.ok(!existsSync(join(p.runDir, 'STOPPED-secret.md')), 'no pause is left behind');
  assert.deepEqual([metaOf(p.runDir).secretFinish?.choice, metaOf(p.runDir).secretFinish?.phase], ['finish_now', 'after']);
  assert.deepEqual(metaOf(p.runDir).secretAllow?.hashes ?? [], [], 'the value the pause found is NOT on the allowed list');
});

test('SF-5 (the RECORD PATH, the shipped shape: a session writes the handoff): a typed --finish-now at the credential pause ends the loop, then the ending pauses at the session\'s handoff (exit 3); after the answer a PLAIN resume (no marker, no choice) still ends the run at once - the paused stage never runs and no pause comes back. Known-bad input: no record path - the stage runs live and its file appears', () => {
  const p = pausedLayered({ externalHandoff: true });
  const r = p.sh(['--resume', join('runs', p.id), '--finish-now']);
  assert.equal(r.status, 3, `the ending waits for the session's handoff: ${r.stdout}${r.stderr}`);
  assert.equal(metaOf(p.runDir).secretFinish?.choice, 'finish_now');
  assert.ok(!existsSync(join(p.runDir, `${p.label}.md`)), 'premise: the paused stage did not run');
  answerHandoff(p.runDir);
  const again = p.sh(['--resume', join('runs', p.id)]);
  assert.ok([0, 22].includes(again.status), `${again.stdout}${again.stderr}`);
  const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([report.passed, report.stop?.kind, report.stop?.finished_at_once], [false, 'secret_pause', true]);
  assert.ok(!existsSync(join(p.runDir, `${p.label}.md`)), 'the stage the person chose to end never ran');
  assert.ok(!existsSync(join(p.runDir, 'STOPPED-secret.md')), 'no pause came back');
  assert.deepEqual(metaOf(p.runDir).secretAllow?.hashes ?? [], [], 'the value was never allowed');
});

test('SF-6 (C&C 10 Nov: the PLAIN secret --finish crosses a handoff pause too): a typed --finish records the choice (exit 11), --continue ends the loop at the paused stage and the ending pauses at the session\'s handoff (exit 3); after the answer a PLAIN resume still ends the run - the paused stage never runs (no live call after the answer) and no pause comes back. Known-bad input: no record path - the stage runs live and its file appears', () => {
  const p = pausedLayered({ externalHandoff: true });
  assert.equal(p.sh(['--resume', join('runs', p.id), '--finish']).status, 11);
  const c = p.sh(['--resume', join('runs', p.id), '--continue']);
  assert.equal(c.status, 3, `the ending waits for the session's handoff: ${c.stdout}${c.stderr}`);
  assert.ok(!existsSync(join(p.runDir, `${p.label}.md`)), 'premise: the paused stage did not run');
  answerHandoff(p.runDir);
  const again = p.sh(['--resume', join('runs', p.id)]);
  assert.ok([0, 22].includes(again.status), `${again.stdout}${again.stderr}`);
  const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
  assert.deepEqual([report.passed, report.stop?.kind, report.stop?.chosen, report.stop?.finished_at_once], [false, 'secret_pause', 'finish', undefined]);
  assert.ok(!existsSync(join(p.runDir, `${p.label}.md`)), 'the stage the person chose to end never ran');
  assert.ok(!existsSync(join(p.runDir, 'STOPPED-secret.md')), 'no pause came back');
});

// ---------- SF-7 (in-process): a finish-now at a pause AFTER the rounds sends no prompt that holds the found value ----------
const KEY = ['sk', '-ant-api03-', Array.from({ length: 40 }, (_, i) => 'aZ3kQ9xB'[i % 8]).join('')].join('');   // assembled at runtime, as test/api-secret-override-removed.test.js does
async function endRun(endsOnSecret) {
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    if (label === 'handoff') return null;   // the one stage that is not on disk: the free handoff seat would be asked live, with the key in its prompt
    const text = label.startsWith('panel-') || label.startsWith('final-read-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  if (endsOnSecret) { CHAIN.setNoMoneySitting(true); setOutboundScan({ allow: false, allowed: null, finish: false, atOnce: true, endsOnSecret: true }); } else setOutboundScan({ allow: false, allowed: null });
  const config = { name: 'fixture-sf7', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 3, handoff: true,
    seats: { builder: writer, reviser: writer, handoff: { provider: 'mock', model: JUDGE, lab: 'hand', maxTokens: 3000 }, critics: [judgeSeat(LOWLAB, 1), judgeSeat('mid-beta', 2), judgeSeat('top-gamma', 3)] } };
  const result = await runChain({ request: `Write a worker plan with a retry limit.\n${KEY}\n`, runId: 'r-sf7', log: () => {}, config, roundChoices: [] });
  return { result, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-sf7', chain: 'fixture-sf7', task: 't.md', result, config }))) };
}
test('SF-7 (a finish-now at a pause AFTER the rounds): a FREE handoff seat whose prompt holds an unallowed credential-shaped value is NOT MADE (no SecretShapedPrompt, no pause again): the handoff is in stages_not_run with reason finished_at_once and the run has no handoff text. Control: the same run without endsOnSecret throws SecretShapedPrompt at the handoff', async () => {
  CHAIN.setNoMoneySitting(false);
  await assert.rejects(() => endRun(false), SecretShapedPrompt, 'premise: without the finish the handoff call pauses on the key');
  const r = await endRun(true);
  assert.equal(r.result.handoff, null, 'no handoff text: the call was not made');
  assert.deepEqual(r.report.stages_not_run.map(s => [s.label, s.reason]), [['handoff', 'finished_at_once']]);
});

test('SF-7b (the board words follow the reason, pure): calls not made for finished_at_once only read "ended at once at the person\'s choice" (a finish-now at a pause or a round stop), never "at the spending limit"; one spending_limit row keeps the spending words (the old bar)', () => {
  assert.equal(VH.stagesNotRunWords({ stages_not_run: [{ label: 'handoff', reason: 'finished_at_once' }] }), "ended at once at the person's choice; one call was not made (handoff)");
  assert.match(VH.stagesNotRunWords({ stages_not_run: [{ label: 'handoff', reason: 'finished_at_once' }, { label: 'cold-read', reason: 'spending_limit' }] }), /^ended at the spending limit at the person's choice; 2 calls were not made \(handoff, cold-read\)$/);
});

// ---------- the handler sort (a): a finish-now sitting asks nobody ----------
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const OBJ5 = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
const newDefect = rating => ({ sort: 'must_do', reason: 'The worker never backs off.', criterion: CRITERION, quote: 'with a pause between tries', rating });
const objectsWith = rows => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: rows.map(r => ({ criterion: r.criterion, problem: r.reason, fix: 'Back off between tries.', quote: r.quote, severity: r.rating })), verdict_line: 'no' });   // FINDING (not on the owed list of the ladder unit; found by the box set, 10 Nov 2026): the field is `severity` (test/s18-sort-wait.test.js, whose fixture this one copies); `rating` made the reply unreadable once ratings are demanded
const REWRITE = 'The worker retries failed requests up to five times, with a pause between tries.';
const CRITICS = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];

async function sortRow(choice, replayOnly) {   // s18-sort-wait's fixture, copied: the climb stops at the overseer cap, then the chosen ending; with the recorded wording (handlerSortSystem + handlerSortUser) the plain finish WAITS for the handler
  setHeldForTest({ ...SORTING, ...W31, handlerSortSystem, handlerSortUser });
  const opts = { answerBack: true, handler: true, critics: CRITICS, extra: { maxOverseerRounds: 1, dispute: { enabled: true, stall_rounds: 2 } }, overrides: { 'panel-1-la': MET, 'panel-1-lc': OBJ5, dispute: REWRITE, 'final-read-lc': objectsWith([newDefect(5)]), 'final-read-ld': MET } };   // the same copy error: s18-sort-wait answers ld's final read with a sign-off
  let first = null;
  try { await scenario(opts); } catch (e) { if (e instanceof RoundStopped) first = e; else throw e; }
  assert.equal(first?.stop?.kind, 'overseer_cap', 'premise: the climb stops at the overseer-round limit');
  if (replayOnly) setJudgeReplayOnly(true);
  try { return { r: await scenario({ ...opts, runExtra: { roundChoices: [roundChoiceEntry(first.stop, choice, null)] } }) }; } catch (e) { if (e instanceof ExternalPause) return { wait: e }; throw e; }
}

test('SF-4 (the handler sort, ruled (a)): in a finish-now sitting whose final reads are on disk and split the top layer (lc objects, ld signed this text), with the recorded sort wording, the handling session is NOT asked (no sort-1 pause), the objection stays unsorted and the record says so (final_read.handler_sort_not_run, and a line on the board block); the control: the plain finish at the same stop WAITS at sort-1', async () => {
  const control = await sortRow('finish', false);
  assert.ok(control.wait instanceof ExternalPause && control.wait.label === 'sort-1', `premise: the plain finish waits for the handler's sorting (${control.wait ? control.wait.label : 'it ended'})`);
  const d = await sortRow('finish_now', true);
  assert.ok(d.r, `a finish-now sitting asks nobody: ${d.wait ? 'it waits at ' + d.wait.label : ''}`);
  const fr = d.r.result.finalRead;
  assert.equal(fr.ran, true, 'premise: the final reads were on disk and replayed');
  assert.equal(fr.handler_sort_not_run, 'finished_at_once');
  assert.ok(!(fr.sorting || []).some(x => x.by === 'handler'), 'no handler sort is on the record');
  assert.match(renderBoardMd({ runId: 'r-sf4', result: d.r.result }), /The handling session was not asked to sort the objection: the run was finished at once, so it stays unsorted\./);
});
