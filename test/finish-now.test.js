// 0.8.4 (the ladder unit, commit 4a): FINISH AT ONCE at a round stop (`--finish-now`; roundChoices choice 'finish_now'). The run ends here, NOT agreed, like a finish, and skips the two steps that ask a judge again: the final read and the ending exchange.
// The dispute stage and the handoff still run (on the shipped chains they are sessions, so nothing bills). The report says so: stop.finished_at_once (chosen stays 'finish'), final_read {ran:false, reason:'finished_at_once'}, ending_exchange.not_run 'finished_at_once'.
// Offline, $0. Rows 1-2 are in-process on the scripted-cache fixture of test/l3-finished-run.test.js (every stop kind the Council raises on a layered chain); rows 3-4 go through the real command.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. Each row has its control: the same run with a plain `finish` (the swapped input).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget, setOutboundScan, RoundStopped } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import * as VH from '../src/verdict-headline.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { finishedRunState } from '../src/run-status.js';
import { renderFinalReadBlock } from '../src/final-read.js';
import { scenario } from './helpers/layer-two-run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const TOP = 'top-gamma';
const LOW = 'raiser-alpha';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const objectsAnswering = (fs, answers) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, answers, verdict_line: 'no' });
const quotes = ['The worker', 'retries failed', 'failed requests', 'The worker retries', 'retries failed requests', 'worker retries failed'];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation and no rating. NEW: a first raise carries relation 'new' and severity 5; a repeat of a standing objection by the same seat carries `continues <id>` (a `new` on a standing id mints #2 and the stall never fires). WHY: relationRule and ratingDemand are recorded (src/chain.js:5462, src/ratings-demand.js).
const T = i => ({ criterion: CRITERION, problem: `Problem ${i}.`, quote: quotes[i], fix: 'Fix it.', relation: 'new', severity: 5 });
const again = (lab, f) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];
const reply = (lab, k, repeatAt) => (k === 1 ? objects(T(0)) : k === repeatAt ? objects(again(lab, T(k - 2))) : objectsAnswering([T(k - 1)], withdraws(objectionId(lab, T(k - 2)))));
const script = (lab, passes, repeatAt) => Object.fromEntries(Array.from({ length: passes }, (_, i) => [`panel-${i + 1}-${lab}`, reply(lab, i + 1, repeatAt)]));

async function run({ script: scripted = {}, ov = null, maxRounds = 6, roundChoices = [], dispute = true, answerBack = true } = {}) {   // `dispute: false` (FINDING, not on the owed list of the ladder unit; box set, 10 Nov 2026): a kind without the dispute stage, whose rewrite of the plan after the last panel stage makes a read owed in every other kind
  const asked = [];
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    asked.push(label);
    if (label in scripted) return { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-fn', criteria: [CRITERION], signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), ...(dispute ? { dispute: { enabled: true, stall_rounds: 2 } } : {}),
    ...(ov ? { maxOverseerRounds: ov, layerRevisions: { 1: 1, 2: 1 } } : { maxRounds }),
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat(TOP, 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-fn', log: () => {}, config, roundChoices });
  return { result, config, asked, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-fn', chain: 'fixture-fn', task: 't.md', result, config }))) };
}
const stopOf = opts => run(opts).then(() => null, e => e);
const limitsOf = opts => (opts.ov ? { maxOverseerRounds: opts.ov, layerRevisions: { 1: 1, 2: 1 } } : null);
const ASKS_A_JUDGE_AGAIN = /^(final-read|ldebate-end|lreply-end)/;
const NOW_PHRASE = 'layer 3 did not sign off on this plan, and no judge read the last version of it before the run ended';

async function bothWays(opts, kind, why) {
  const err = await stopOf(opts);
  assert.ok(err instanceof RoundStopped, String(err));
  assert.deepEqual([err.stop.kind, ...(why ? [err.stop.why] : [])], [kind, ...(why ? [why] : [])], 'the premise: the stop the Council raised');
  const now = await run({ ...opts, roundChoices: [roundChoiceEntry(err.stop, 'finish_now', limitsOf(opts))] });
  const plain = await run({ ...opts, roundChoices: [roundChoiceEntry(err.stop, 'finish', limitsOf(opts))] });
  return { err, now, plain };
}

const REACHED = []; const STALL_TOP_READ = [];   // the kinds whose top layer had already read the current text (filled by FN-1)
const LAST_PASS = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', relation: 'new', severity: 5 };
const KINDS = [
  ['overseer_cap below seven', { ov: 2, script: script(TOP, 2, 99) }, 'overseer_cap'],
  ['stall_stop, top_layer', { ov: 7, script: script(TOP, 3, 3) }, 'stall_stop', 'top_layer'],
  ['overseer_cap, no dispute stage', { ov: 2, script: script(TOP, 2, 99), dispute: false }, 'overseer_cap'],   // the kind that reaches FN-1c: nothing rewrites the plan after layer 3 read it
  ['stall_stop, last_pass', { maxRounds: 2, script: { [`panel-1-${LOW}`]: objects(LAST_PASS), [`panel-2-${LOW}`]: objects(again(LOW, LAST_PASS)) } }, 'stall_stop', 'last_pass'],
  // CHANGED ACCEPTED TEST (0.8.4, C&C ruling 12 Nov 2026). OLD: this kind ran with answer_back on. NEW: answer_back OFF (a real configuration, not a held-off map). WHY: with the layer-1 go-up line recorded, a chain with answer_back on, two or more layers and ratings (the shipped shape) no longer stops at layer 1's revision bound: the plan goes up instead (src/chain.js layer1BoundGoUp; goUpOn needs the ledger, which needs answer_back, call-gates.js). Where answer_back is off the bound still stops the run, which is the stop this row finishes at once.
  ['layer_bound, revisions (answer_back off)', { ov: 7, script: script(LOW, 4, 99), answerBack: false }, 'layer_bound', 'revisions'],
];

for (const [name, opts, kind, why] of KINDS) {
  test(`FN-1 (${name}): finish-now ends the run here NOT agreed, records stop.finished_at_once with chosen still 'finish', skips the final read (ran false, reason finished_at_once) and asks no judge again; the plain finish at the same stop records neither`, async () => {
    const { now, plain } = await bothWays(opts, kind, why);
    const a = now.report;
    assert.equal(a.passed, false);
    assert.equal(a.stop.chosen, 'finish'); assert.equal(a.stop.finished_at_once, true);
    // MOVED BAR (round-stop finding, C&C 10 Nov, one result for every finish-now): this row asserted reason finished_at_once for every kind. The reason is now decided as for the ordinary end: a read OWED -> finished_at_once; the top layer had already read THIS text (a stall, a cap after it objected) -> every_top_seat_read_this_plan. The plain finish at the same stop is the control: it takes the ordinary path, so its reason says which case this kind is.
    const topLayerReadIt = plain.report.final_read?.reason === 'every_top_seat_read_this_plan';
    assert.deepEqual([a.final_read?.ran, a.final_read?.reason, a.final_read?.run_end], [false, topLayerReadIt ? 'every_top_seat_read_this_plan' : 'finished_at_once', 'not_agreed']);
    // FINDING (this row was owed a move for the round-stop finding; this PIN is a prediction that the box refuted, 10 Nov 2026): OLD pin: a stall at the top layer is raised before any revise, so the top layer read the current text. The first box run showed it does not; the pin is kept below as the finding, not removed (FN-1c).
    if (name === 'stall_stop, top_layer') STALL_TOP_READ.push(topLayerReadIt);
    if (topLayerReadIt) REACHED.push(name);
    assert.equal(a.ending, undefined, 'a finish-now run never ends agreed: it carries no agreement record');
    assert.notEqual(a.ending_word, 'signed_off'); assert.equal(a.ending_word, 'finish_chosen');
    if (kind === 'layer_bound') assert.ok(plain.asked.some(l => /^final-read-/.test(l)), 'the premise (layers 2 and 3 were not asked): a plain finish at this stop DOES ask the final read, so its absence below means something');
    assert.deepEqual(now.asked.filter(l => ASKS_A_JUDGE_AGAIN.test(l)), [], 'no final-read call is made (the ending exchange is held while W26 is unrecorded: its skip is guard code with no row that can fail yet)');
    assert.equal(plain.report.passed, false);
    assert.equal(plain.report.stop.finished_at_once, undefined, 'the swapped input: a plain finish does not carry the flag');
    assert.notEqual(plain.report.final_read?.reason, 'finished_at_once');
    // the words follow the record (A-DRAFT LAD-R23): when the top layer had read this version they say so, never "no judge read the last version"
    if (topLayerReadIt) assert.equal(VH.finishedAtStopWords(a), 'layer 3 did not sign off on this plan, and it had read this version before the run ended: no judge was asked again');
    else assert.equal(VH.finishedAtStopWords(a), NOW_PHRASE);
  });
}

test('FN-1c (the round-stop finding is REACHED): at least one stop kind of the table is a stop where the top layer had already read the current text (a stall, or a cap after layer 3 objected), so the row above ran its second branch; if none is, the finding is not exercised and this row is red', () => {
  // FINDING (10 Nov 2026, first box run): RED. Not on the owed list of the ladder unit; kept as it was written. The in-process table reaches no kind where the top layer read the current text; test/finish-now-stops.test.js FS-1 reaches it with the real command at the cap. Proposal: pin the in-process row to the same fact or add a kind that reaches it; no row is removed on my word.
  // FINDING (box set, 10 Nov 2026): OLD pin: REACHED includes 'stall_stop, top_layer' (the box refuted it: the dispute stage rewrites the plan after a stall, so a read is owed). NEW: some kind of the table reaches it, and the table now has one that does (a cap with no dispute stage); the stall's own real-command case is test/finish-now-stops.test.js FS-1.
  assert.ok(REACHED.length >= 1, `some stop kind must reach the case; reached: ${JSON.stringify(REACHED)}`);
});

test('FN-2: the readers say it: the finished-at-a-stop clause adds that no judge read the last version, in the verdict line, the run state and the board; a plain finish keeps its old words', async () => {
  const { now, plain } = await bothWays({ ov: 2, script: script(TOP, 2, 99) }, 'overseer_cap');
  assert.equal(now.report.final_read?.reason, 'finished_at_once', 'premise of this row (kept from before the round-stop finding): a cap after the top layer objected and the draft was revised leaves a read owed; where the top layer had read this very text the words are the ones FN-1 pins');
  assert.equal(VH.finishedAtStopWords(now.report), NOW_PHRASE);
  assert.equal(verdictHeadline(now.report).text, `OPEN OBJECTIONS - ${NOW_PHRASE}`);
  assert.equal(finishedRunState(now.report), `done: open objections; ${NOW_PHRASE}`);
  assert.ok(renderBoardMd({ runId: 'r-fn', result: now.result }).includes(`## Not agreed: finished at the person's choice\n\n${NOW_PHRASE[0].toUpperCase()}${NOW_PHRASE.slice(1)}.\n`));
  assert.equal(VH.finishedAtStopWords(plain.report), 'layer 3 did not sign off on this plan', 'the plain finish: unchanged');
  assert.equal(renderFinalReadBlock(now.report.final_read), "## The top layer on the final plan\n\nThe run was finished at once at the person's choice, so the top layer did not read the final plan. The run ended without agreement.\n---\n", 'the board block of a finish-now run');
});

// ---- the real command: a layered mock chain that stops at the overseer cap (the envelope of test/ending-wire-real.test.js), then --resume --finish-now
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const project = (id, { externalHandoff = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'fn-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'fn.json'), JSON.stringify({
    name: 'fn', ...(externalHandoff ? { handoff: true } : {}), signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, dispute: { enabled: true, stall_rounds: 99 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: externalHandoff ? { provider: 'external', model: 'claude-code-session' } : { provider: 'mock', model: 'mock-builder', lab: 'author' }, ...(externalHandoff ? { handoff: { provider: 'external', model: 'claude-code-session' } } : {}), critics: [judge('o', `${id}a`, 'l1', 1), judge('o', `${id}b`, 'l2', 2), judge('x', `${id}c`, 'l3', 3)] },
  }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  let first = run(['--chain', 'fn', '--task', 'tasks/t.md']);
  const runDir0 = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  // chain-lint: a layered chain needs a handling session, so the shipped shape has an EXTERNAL reviser. The layer-3 judge objects on every ask, so the session is asked to revise after each climb: the fixture answers each revise stage as the session would (the pause is exit 3, the answer a file) until the run reaches the overseer cap (exit 23), the stop the rows name.
  for (let n = 0; externalHandoff && first.status === 3 && n < 12; n++) {
    const needs = readdirSync(runDir0()).find(f => /^NEEDS-revise-\d+\.md$/.test(f)); assert.ok(needs, `a revise stage waits: ${first.stdout}${first.stderr}`);
    const label = needs.replace(/^NEEDS-|\.md$/g, '');
    writeFileSync(join(runDir0(), `${label}.md.partial`), `# A plan\n\nRevision ${n + 1}.\n`); renameSync(join(runDir0(), `${label}.md.partial`), join(runDir0(), `${label}.md`));
    first = run(['--resume', runDir0()]);
  }
  assert.equal(first.status, 23, first.stdout + first.stderr);
  const runDir = runDir0();
  assert.equal(JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop.kind, 'overseer_cap', 'the stop the row names, read from the record and not from the exit code');
  return { dir, run, runDir, saved: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), done: () => rmSync(dir, { recursive: true, force: true }) };
};

test('FN-3 (real command): --resume --finish-now ends a run stopped at the overseer cap, NOT agreed, the record validates against the schema, the choice is recorded as finish_now; --help names the flag', () => {
  const p = project('a');
  try {
    const r = p.run(['--resume', p.runDir, '--finish-now']);
    assert.notEqual(r.status, 23, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.deepEqual([report.passed, report.stop.chosen, report.stop.finished_at_once, report.final_read?.reason], [false, 'finish', true, 'finished_at_once']);
    assert.deepEqual(p.saved().roundChoices.map(c => c.choice), ['finish_now']);
    const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true);
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
    assert.ok(validate(report), JSON.stringify(validate.errors));
    const help = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--help'], { cwd: p.dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: p.dir } });
    assert.match(`${help.stdout}${help.stderr}`.replace(/\s+/g, ' '), /--finish-now ends a stopped run at once: no judge is asked again \(a final read already on disk for this text is kept; the dispute stage and the handoff run\)\. Inside the review rounds and at a round stop the run ends NOT agreed \(except at the stop where no seat of the top layer could read the final plan: a panel that had signed off before the read keeps that verdict there\); at a spending stop or a credential-shaped pause after the review rounds it keeps the verdict the rounds reached/);   // CHANGED ACCEPTED (0.8.4 ladder unit, Mini-C&C's FIX 1, his 19:01 heading of 10 Nov 2026). OLD: "... at once, NOT agreed: no judge ..." for every stop. NEW: NOT agreed inside the rounds and at a round stop, the rounds' verdict kept after them. WHY: a finish after the rounds does not change the verdict (FS-2)
  } finally { p.done(); }
});

test('FN-4 (real command, the refusals): two choices at once, a start without --resume and a run that is not stopped at a round limit are refused before anything is recorded, run or spent', () => {
  const p = project('b');
  try {
    const both = p.run(['--resume', p.runDir, '--finish', '--finish-now']);
    assert.equal(both.status, 2); assert.match(both.stderr, /--finish and --finish-now are two different choices: give one\. Nothing was run and nothing was spent\./);
    const cont = p.run(['--resume', p.runDir, '--continue', '--finish-now']);
    assert.equal(cont.status, 2); assert.match(cont.stderr, /--continue and --finish-now are two different choices: give one\. Nothing was run and nothing was spent\./);
    const fresh = p.run(['--chain', 'fn', '--task', 'tasks/t.md', '--finish-now']);
    assert.equal(fresh.status, 2); assert.match(fresh.stderr, /answer a stopped run: use them with --resume <run folder>\. Nothing was run and nothing was spent\./);
    assert.equal(p.saved().roundChoices, undefined, 'nothing was recorded by the three refusals');
  } finally { p.done(); }
  // a run paused at an external seat (exit 3) is resumable and is not stopped at a round limit
  const dir = mkdtempSync(join(tmpdir(), 'fn-ext-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    writeFileSync(join(dir, 'chains', 'ext.json'), JSON.stringify({ name: 'ext', signoff: 'unanimous', maxRounds: 2, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'external', model: 'claude-code-session' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics: [judge('o', 'ext1', 'l1', 1)] } }));
    const sh = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(sh(['--chain', 'ext', '--task', 'tasks/t.md']).status, 3);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const again = sh(['--resume', runDir, '--finish-now']);
    assert.equal(again.status, 2); // MOVED BAR (step 3): the interim sentence listed only the round stops; it now also names the owner's pause, the spending limit and a credential-shaped string (all three are answered by --finish-now now)
    assert.match(again.stderr, /--finish-now answers a run stopped at a round limit, a layer's limit, a stall or a silent seat, at the owner's pause, at the spending limit or at a credential-shaped string, and this run is not stopped at one\. Nothing was recorded, run or spent\./);
    assert.equal(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).roundChoices, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the final-read stop (no seat of the top layer could read the plan): the fixture of test/s16-final-read-stop.test.js
const L3 = [['la', 1], ['lb', 2], ['lc', 3, 'mock-unreadable'], ['ld', 3, 'mock-unreadable']];
const readLabels = tag => ['lc', 'ld'].flatMap(k => [`final-read-${k}${tag}`, `final-read-${k}${tag}-reask1`]);
const ALL = ['', '-c1', '-c2', '-f'].flatMap(readLabels);
const without = labels => ALL.filter(l => !labels.includes(l));
async function atFinalReadStop({ choices = [], cut = ALL } = {}) {
  setOutboundScan({ finish: true });
  try { return { done: await scenario({ critics: L3, cutLabels: ['revise-1', ...cut], handler: true, runExtra: { roundChoices: choices } }) }; }
  catch (e) { if (e instanceof RoundStopped) return { stop: e.stop }; throw e; }
  finally { setOutboundScan({}); }
}

test('FN-5 (the final-read stop): finish-now there ends the run NOT agreed at once with the record of the read that found nobody (ran true, no seat read, reason finished_at_once) and makes no further read; the plain finish asks one more read first (the swapped input)', async () => {
  const first = await atFinalReadStop();
  assert.deepEqual([first.stop?.kind, first.stop?.why], ['layer_bound', 'final_read'], 'the premise: the run stops at the final read');
  const now = await atFinalReadStop({ choices: [roundChoiceEntry(first.stop, 'finish_now', null)], cut: without(readLabels('')) });
  assert.ok(now.done, 'the run ended instead of stopping again');
  const fr = now.done.result.finalRead;
  assert.deepEqual([fr.ran, fr.reason, now.done.result.passed, fr.seats.some(s => s.read === true)], [true, 'finished_at_once', false, false]);
  assert.equal(fr.run_end, 'not_agreed', 'the premise of this kind (FIX 2, the ruling of 10 Nov 2026 by the verdict BEFORE the read): the panel never signed off, layer 3 was unreadable at its climb too, so the finish keeps NOT agreed. OLD bar: the kind was not stated; the row stands as the NOT-agreed half of the rule, FN-5c is the agreed half');
  assert.deepEqual(now.done.served.filter(l => /-f$|-f-reask1$|-c\d/.test(l)), [], 'no further final read was asked');
  const plain = await atFinalReadStop({ choices: [roundChoiceEntry(first.stop, 'finish', null)], cut: without(readLabels(''))});
  assert.ok(plain.done === undefined || plain.done.result.finalRead?.reason !== 'finished_at_once', 'the plain finish carries no such reason');
  assert.ok(plain.stop !== undefined || plain.done.served.some(l => /-f/.test(l)), 'the plain finish asks its one more read first, or stops again when that read finds nobody');
});

test('FN-9 (a finish-now at the FINAL-READ STOP crosses a session\'s handoff pause; ruled 10 Nov: every finish choice that can cross a handoff pause has a row): the choice ends the run, the ending pauses at the session\'s handoff (ExternalPause, no further final read asked); after the answer the SAME recorded choice ends it again - one choice, given once: the run ends NOT agreed at once (ran true, no seat read, reason finished_at_once) and no -c/-f read is ever asked', async () => {
  const first = await atFinalReadStop();
  assert.deepEqual([first.stop?.kind, first.stop?.why], ['layer_bound', 'final_read'], 'the premise: the run stops at the final read');
  const choices = [roundChoiceEntry(first.stop, 'finish_now', null)];
  const cut = without(readLabels(''));
  const EXT = { provider: 'external', model: 'claude-code-session' }; const mockSeat = ([lab, layer, model]) => ({ provider: 'mock', model: model ?? 'mock-review-fixture', lab, maxTokens: 3000, layer });
  // the session writes the handoff (the shipped shape): scenario's `handler` makes only the reviser external, so the seats are given whole here, with an external handoff seat
  const seats = { builder: { provider: 'mock', model: 'mock-review-fixture', lab: 'writer', maxTokens: 3000 }, reviser: { ...EXT, lab: 'writer' }, handoff: EXT, critics: L3.map(mockSeat) };
  const sitting = handoffCut => scenario({ critics: null, cutLabels: ['revise-1', ...cut, ...(handoffCut ? ['handoff'] : [])], extra: { handoff: true, seats }, runExtra: { roundChoices: choices } });
  let paused = null; setOutboundScan({ finish: true });
  try { await sitting(true); } catch (e) { if (e instanceof RoundStopped) assert.fail(`the finish-now must end the run, not stop again: ${JSON.stringify(e.stop)}`); paused = e; } finally { setOutboundScan({}); }
  assert.equal(paused?.label, 'handoff', `the ending waits for the session's handoff: ${paused?.constructor?.name} ${paused?.label}`);
  assert.deepEqual((paused.served ?? []).filter(l => /-f$|-f-reask1$|-c\d/.test(l)), [], 'no further final read was asked before the pause');
  setOutboundScan({ finish: true });
  let done; try { done = await sitting(false); } finally { setOutboundScan({}); }
  const fr = done.result.finalRead;
  assert.deepEqual([fr.ran, fr.reason, done.result.passed, fr.seats.some(s => s.read === true)], [true, 'finished_at_once', false, false]);
  assert.deepEqual(done.served.filter(l => /-f$|-f-reask1$|-c\d/.test(l)), [], 'no further final read after the answer either');
});

// REMOVED (0.8.4 apply, C&C ruling 12 Nov 2026, part 3: bin 1). It was FIX 2's row: it pinned C&C's ruling of 10 Nov 2026 (FIX 2), whose reason is the owner's 19:01 one (a read that got no usable reply is no disagreement, so a panel that had signed off keeps its verdict at a finish-now); that ruling's branch stays in src, unreachable on the recorded state. OLD: FN-5c, "the final-read stop, a panel that had SIGNED OFF": the sign-off came first, the text changed after it (a finalist's final edit), no top seat gave a usable reply to the read, the run stops (layer_bound, final_read); a finish-now there keeps the verdict the panel reached (passed true, run_end agreed, final read ran false / finished_at_once, agreedOf true), the log names the finish once, the board says layer 3 did not read the final plan.
// Red on the tip since dc60423a (jobs 135 and 137): the first premise holds and the second fails ([true, finished_at_once, not_agreed, false]): with the build-check wording recorded the final edit never runs at an agreed end (chain.js:7660), so no top seat is owed a re-read. NEW: the row is gone. WHY: its ending cannot be reached on the recorded state (read): (one layer) allVotersClean needs voting.length > 0 (chain.js:6375), so a voting top seat signed this very text and readThisBefore is true: no stop (printed, job 135 leg A: no stop; seat-b unread, run ends not agreed);
// (two or more layers) mustRead is empty at an agreed end, so no read is asked and no stop arises (gates at chain.js:7314, 7316, 7459, 7597, 7601, 7660; job 135 printed leg A). The skip is pinned by test/build-check.test.js: the 'Q-i1 (permanent)' row at :154 (the handler form: after good_to_build the challenge and the final edit are not served) and T21d at :171 (the no-handler form); the dispute rewrite's skip is read, not driven. Its helper atFinalReadStopSigned went with it. One FOR_085 line records the branch (the kept-verdict finish at the final-read stop, finishKeepsVerdict) that only this row pinned. The not-agreed form of the same stop stays pinned by FN-5 and FN-9 above.

test('FN-5b (the final-read stop, relayed): the same record as FN-5 (ran true, no seat read, reason finished_at_once) with relayed true when the choice was the person\'s words relayed by the session; a typed finish-now carries no such mark (the control, FN-5)', async () => {
  const first = await atFinalReadStop();
  const relayedEntry = { ...roundChoiceEntry(first.stop, 'finish_now', null), actor: 'person', channel: 'session', relayed: true, person_words: 'End it now.' };
  const now = await atFinalReadStop({ choices: [relayedEntry], cut: without(readLabels('')) });
  assert.ok(now.done, 'the run ended instead of stopping again');
  const fr = now.done.result.finalRead;
  assert.deepEqual([fr.ran, fr.reason, fr.relayed, fr.seats.some(s => s.read === true)], [true, 'finished_at_once', true, false]);
  const typed = await atFinalReadStop({ choices: [roundChoiceEntry(first.stop, 'finish_now', null)], cut: without(readLabels('')) });
  assert.equal(typed.done.result.finalRead.relayed, undefined, 'the control: typed carries no relay mark');
});

test('FN-8 (a finish-now crosses a session\'s handoff pause, the round-stop shape; ruled 10 Nov: every finish choice that can cross a handoff pause has a row): a finish-now at the overseer cap ends the loop, then the ending pauses at the session\'s handoff (exit 3); after the answer a PLAIN resume still ends the run at once: nothing of the next pass runs, no judge is asked again, no stop comes back', () => {
  const p = project('hx', { externalHandoff: true });
  try {
    let r = p.run(['--resume', p.runDir, '--finish-now']);
    // the dispute stage (a stalled objection's rewrite) is the external reviser's: the session answers it, as it would, before the handoff
    if (r.status === 3 && existsSync(join(p.runDir, 'NEEDS-dispute.md'))) { writeFileSync(join(p.runDir, 'dispute.md.partial'), '# A plan\n\nRewritten.\n'); renameSync(join(p.runDir, 'dispute.md.partial'), join(p.runDir, 'dispute.md')); r = p.run(['--resume', p.runDir]); }
    assert.equal(r.status, 3, `the ending waits for the session's handoff: ${r.stdout}${r.stderr}`);
    assert.ok(existsSync(join(p.runDir, 'NEEDS-handoff.md')), 'the pause is the handoff\'s');
    assert.deepEqual(p.saved().roundChoices.map(c => c.choice), ['finish_now']);
    writeFileSync(join(p.runDir, 'handoff.md.partial'), 'Status: ready_for_build\n\nBuild it.\n'); renameSync(join(p.runDir, 'handoff.md.partial'), join(p.runDir, 'handoff.md'));
    const again = p.run(['--resume', p.runDir]);
    assert.notEqual(again.status, 23, `no stop came back: ${again.stdout}${again.stderr}`); assert.ok([0, 22].includes(again.status), `${again.stdout}${again.stderr}`);
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.deepEqual([report.passed, report.stop.chosen, report.stop.finished_at_once], [false, 'finish', true]);
    assert.deepEqual(p.saved().roundChoices.map(c => c.choice), ['finish_now'], 'one choice, given once');
  } finally { p.done(); }
});
