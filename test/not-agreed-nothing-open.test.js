// 0.8.4 apply, the M group (a run that did NOT end agreed, with nothing standing at the end, must not say an objection or a failure is open) and the rows of the apply's other
// hand edits (the singular late finding, the BOARD heads of a run whose last draft no panel round read, the block name of a requested pass, the intro of a passed-up board).
//
// What tells the cases apart (not a wording pin): every row asserts that the OLD claim ("open objections", "open failures", "OPEN OBJECTIONS", "round ?", the old block name,
// "reviewed it") is ABSENT where it is untrue, or reads a record field; none copies a new sentence. The control rows assert the old claim is STILL there where an objection stands,
// a late finding stands, or the count is absent (it fails closed), and the headline's `label` stays 'OPEN OBJECTIONS' (only its `text` moves).
// The file imports only names that exist before the M group (it never imports the new helper), so on a tree without the fix a failure is a failing row, not a load error.
// The real runs are made in this test's own temp folders, never under chains/ (that count is typed into the README and the landing page).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setPauseCheck, setPauseFinishCheck, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd, renderEscalationsBoard } from '../src/report-shape.js';
import { finishedRunState } from '../src/run-status.js';
import { verdictHeadline, finishedAtStopWords } from '../src/verdict-headline.js';
import { stopState } from '../src/handoff-from-run.js';
import { bannerReasonOf } from '../src/ending-matrix.js';
import { renderTextLabelsBoard } from '../src/text-labels.js';
import { finalReadNotReadWords } from '../src/final-read.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { objectionId } from '../src/objection-ids.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION as L2_CRITERION } from './helpers/layer-two-run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setPauseCheck(null); setPauseFinishCheck(null); setOutboundScan({}); });

// ---- the real run of job 191's shape (FIN0-A): the shipped plan-mini-council with its paid seats swapped for mocks, layer 1 silent, layers 2 and 3 sign off, `--finish` at the stop
const PAID = new Set(['anthropic', 'openrouter']);
const CRITERION = 'It states the assumptions it was written under.';
function fin0Chain() {
  const c = structuredClone(JSON.parse(readFileSync(join(root, 'chains', 'plan-mini-council.json'), 'utf8')));
  let n = 0;
  c.seats.proposers = c.seats.proposers.map(s => (PAID.has(s.provider) ? { ...s, provider: 'mock', model: ['mock-proposer-a', 'mock-proposer-b', 'mock-proposer-a'][n++ % 3] } : s));
  c.seats.critics = c.seats.critics.map(s => (PAID.has(s.provider) ? { ...s, provider: 'mock', model: s.layer === 1 ? 'mock-critic-silent' : 'mock-critic-script-o' } : s));
  c.name = 'nan-fin0'; delete c.prompt_cache;   // the chain lint refuses prompt_cache when no judge seat is anthropic/openrouter
  return c;
}
const cliIn = dir => args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 300_000 });
let fin0Memo = null;
function fin0() {
  if (fin0Memo) return fin0Memo;
  const dir = mkdtempSync(join(tmpdir(), 'thc-nan-fin0-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small retry limit.\n');
  writeFileSync(join(dir, 'chains', 'nan-fin0.json'), JSON.stringify(fin0Chain()));   // its own name: a run on a shipped chain's name is what test/no-paid-chain-spawn.test.js refuses
  const run = cliIn(dir);
  let r = run(['--chain', 'nan-fin0', '--task', 'tasks/t.md']);
  const runs = readdirSync(join(dir, 'runs')); assert.equal(runs.length, 1, 'premise: the run started');
  const runDir = join(dir, 'runs', runs[0]);
  let out = String(r.stderr) + String(r.stdout); let handoffPrompt = ''; let finished = false; let last = r.status;
  for (let i = 0; i < 60 && last !== 22 && last !== 0 && last !== 15; i++) {
    if (last === 3) {
      const pend = readdirSync(runDir).filter(f => /^NEEDS-/.test(f) && !existsSync(join(runDir, f.replace(/^NEEDS-/, ''))));
      assert.ok(pend.length, 'exit 3 with a pending seat');
      const lab = pend[0].replace(/^NEEDS-/, '').replace(/\.md$/, '');
      let text = null;
      if (lab === 'criteria') text = JSON.stringify({ criteria: [CRITERION] });
      else if (lab === 'handoff') { handoffPrompt = readFileSync(join(runDir, pend[0]), 'utf8'); text = '# SEAT-OWN-FIRST-LINE\n\nStatus: ready_for_build\n\nBuild it in four steps.\n'; }
      else if (/^(skeleton|build|revise-\d+(-full)?|deep-dive-revise)$/.test(lab)) text = `# Plan after ${lab}\n\nAssumptions: tea and a retry limit ${i}.\n`;
      else if (/^(dispute|challenge|finalist|final-edit|notes-answer)/.test(lab)) text = `# Plan after ${lab}\n\nAssumptions: tea, a retry limit and a dispute rewrite ${i}.\n`;
      assert.notEqual(text, null, `an unexpected pause: ${lab}`);
      writeFileSync(join(runDir, `${lab}.md`), text);
      r = run(['--resume', runDir]);
    } else {
      assert.equal(finished, false, `the run did not end after --finish (exit ${last})`);
      r = run(['--resume', runDir, '--finish']); finished = true;
    }
    last = r.status; out += String(r.stderr) + String(r.stdout);
  }
  assert.equal(last, 22, `premise: the run ended at exit 22 (not agreed), got ${last}`);
  const read = f => (existsSync(join(runDir, f)) ? readFileSync(join(runDir, f), 'utf8') : '');
  fin0Memo = { dir, runDir, out, handoffPrompt, report: JSON.parse(read('report.json')), handoff: read('HANDOFF.md'), board: read('BOARD.md') };
  return fin0Memo;
}
const lateRow = id => ({ id, found: 'last_verdict', lab: 'top-gamma', criterion: 'c', problem: 'p' });
// a derived folder: the real run's folder copied, report.json edited (each row in its own copy)
let derivedN = 0;
function derived(edit) {
  const f = fin0();
  const dir = join(f.dir, `derived-${++derivedN}`);
  cpSync(f.runDir, dir, { recursive: true });
  const rep = structuredClone(f.report); edit(rep);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(rep));
  return { dir, report: rep };
}
const bannerLine2 = md => md.split('\n')[1] ?? '';

test('NAN-1 premise (job 191\'s shape): --finish at the stop, layer 3 did not sign off, NOTHING stands: the count is 0, no dispute entry, no late finding, and the run was not finished at once', () => {
  const { report } = fin0();
  assert.equal(report.passed, false);
  assert.equal(report.ending_word, 'finish_chosen');
  assert.equal(report.signed_text.open_objections, 0, 'the recorded count is exactly 0');
  assert.notEqual(report.stop?.finished_at_once, true, '--finish, not --finish-now: the A7 at-once arm is not this run');
  assert.deepEqual((report.dispute?.open_objections ?? []).filter(o => !o.closed_by), [], 'no dispute entry stands');
  assert.deepEqual((report.late_findings ?? []).filter(l => l.dropped_after_check !== true), [], 'no late finding stands');
});

test('NAN-2 (banner of HANDOFF.md): nothing stands, so the banner says neither "open objections" nor points at "what was left open"', () => {
  const l2 = bannerLine2(fin0().handoff);
  assert.doesNotMatch(l2, /open objection/, l2);
  assert.doesNotMatch(l2, /what was left open/, l2);
});

test('NAN-3 (the handoff prompt\'s ending line): the line that tells the seat how the run ended does not say "open objections" when nothing stands', () => {
  const line = (fin0().handoffPrompt.match(/The run behind this plan ended [^\n]*/) ?? [''])[0];
  assert.ok(line, 'premise: the prompt carries the ending line');
  assert.doesNotMatch(line, /open objection/, line);
});

test('NAN-4 (the terminal verdict line): "stopped with open failures" is not printed when nothing stands', () => {
  const v = (fin0().out.match(/^verdict:[^\n]*/m) ?? [''])[0];
  assert.ok(v, 'premise: the run printed a verdict line');
  assert.doesNotMatch(v, /open failures/, v);
});

test('NAN-5 (run_status) and NAN-6 (the headline): "open objections" and "OPEN OBJECTIONS" are gone from the state and the headline text; the headline label is not touched', () => {
  const { report } = fin0();
  assert.doesNotMatch(finishedRunState(report), /open objections/);
  const h = verdictHeadline(report);
  assert.doesNotMatch(h.text, /OPEN OBJECTIONS/);
  assert.equal(h.label, 'OPEN OBJECTIONS', 'only the text moves; the label stays (the PR list)');
});

const STANDS = [
  ['an objection is open by count', rep => { rep.signed_text.open_objections = 1; }],
  ['a dispute entry stands while the count says 0', rep => { rep.dispute = { ...(rep.dispute ?? {}), open_objections: [{ id: 'O-0a1b2c3d', lab: 'x', problem: 'p' }] }; }],
  ['a late finding stands', rep => { rep.late_findings = [lateRow('L-0a1b2c3d')]; }],
  ['the count is absent (fails closed)', rep => { delete rep.signed_text.open_objections; }],
  ['the count is not a number (fails closed)', rep => { rep.signed_text.open_objections = '0'; }],
];
for (const [name, edit] of STANDS) test(`NAN-7 control: ${name}: the old words stay on the banner, the state and the headline text`, () => {
  const { dir, report } = derived(edit);
  const st = stopState(dir);
  assert.match(st.reason, /open objections/, 'the banner reason keeps its old claim');
  assert.equal(st.nothingStands, false);
  assert.match(finishedRunState(report), /open objections/);
  assert.match(verdictHeadline(report).text, /OPEN OBJECTIONS/);
});

test('NAN-8 (the bare arms, one REAL run of an unlayered chain: no stop, no ending, count 0): the verdict line, the state and the headline text do not say anything is open', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-nan-bare-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small retry limit.\n');
  const chain = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
  chain.name = 'nan-bare'; chain.maxRounds = 2;
  chain.seats.critics = [{ provider: 'mock', model: 'mock-critic-silent', lab: 'mock-a' }, { provider: 'mock', model: 'mock-critic-script-o', lab: 'mock-b' }];
  writeFileSync(join(dir, 'chains', 'nan-bare.json'), JSON.stringify(chain));
  const r = cliIn(dir)(['--chain', 'nan-bare', '--task', 'tasks/t.md']);
  assert.equal(r.status, 22, `premise: exit 22, got ${r.status}\n${String(r.stderr).slice(-400)}`);
  const runs = readdirSync(join(dir, 'runs'));
  const report = JSON.parse(readFileSync(join(dir, 'runs', runs[0], 'report.json'), 'utf8'));
  assert.equal(report.signed_text.open_objections, 0, 'premise: nothing is open');
  assert.equal(report.stop, undefined, 'premise: no stop');
  assert.equal(report.ending, undefined, 'premise: no ending');
  assert.equal(report.passed, false);
  const v = ((String(r.stdout) + String(r.stderr)).match(/^verdict:[^\n]*/m) ?? [''])[0];
  assert.ok(v, 'premise: the run printed a verdict line');
  assert.doesNotMatch(v, /open failures/, v);
  assert.doesNotMatch(finishedRunState(report), /open objections/);
  assert.doesNotMatch(verdictHeadline(report).text, /OPEN OBJECTIONS/);
});

test('NAN-9 (the singular late finding): the reason names "a late finding" for one id and "late findings" for more: the text before the ids differs between one id and two', () => {
  const at = late => ({ early: false, topSigned: false, handlerNotYet: false, late });
  const cut = s => s.slice(0, s.lastIndexOf(': '));
  const one = bannerReasonOf('finish_chosen', false, { atOnce: at(['L-aaaa1111']) });
  const two = bannerReasonOf('finish_chosen', false, { atOnce: at(['L-aaaa1111', 'L-bbbb2222']) });
  assert.match(one, /L-aaaa1111/); assert.match(two, /L-aaaa1111, L-bbbb2222/);
  assert.notEqual(cut(one), cut(two), 'one id and two ids are not worded alike');
  const signed = late => bannerReasonOf('finish_chosen', false, { atOnce: { ...at(late), topSigned: true } });
  assert.notEqual(cut(signed(['L-aaaa1111'])), cut(signed(['L-aaaa1111', 'L-bbbb2222'])), 'nor when the top layer signed');
  const none = bannerReasonOf('finish_chosen', false, { atOnce: at([]) });
  assert.doesNotMatch(none, /late finding/, 'no late finding, no word about one');
});

// ---- the BOARD heads of a run whose last draft no panel round read (round null)
const CRIT = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.'; const TOP = 'top-gamma'; const LOW = 'raiser-alpha';
const crow = verdict => ({ criterion: CRIT, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });
async function layeredOwnerPause() {
  setPromptSpy(() => {}); setHeldForTest(null);
  setCache({ invalidate() {}, get(label) {
    const scripted = { [`panel-1-${TOP}`]: objects({ criterion: CRIT, problem: 'Problem 0.', quote: 'The worker', fix: 'Fix it.', severity: 5, relation: 'new' }) };
    const text = label in scripted ? scripted[label] : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  setPauseCheck(round => (round === 2 ? { request_seq: 7 } : null));
  setPauseFinishCheck(round => (round === 2 ? { request_seq: 7, choice: 'finish_now' } : null));
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-nan', criteria: [CRIT], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat(TOP, 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-nan', log: () => {}, config, roundChoices: [] });
  return { result, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-nan', chain: 'fixture-nan', task: 't.md', result, config }))) };
}
const headOf = md => md.slice(md.indexOf('## Signed text and delivered text'), md.indexOf('\n\n', md.indexOf('## Signed text and delivered text') + 40));

test('NAN-10 (BOARD.md, the shape of OPF-15: an owner-pause finish after a revise on a layered chain, round null): the head of "Signed text and delivered text" does not print "round ?"', async () => {
  const { result, report } = await layeredOwnerPause();
  assert.equal(report.signed_text.round, null, 'premise: no panel round read the text signed_text names');
  const head = headOf(renderBoardMd({ runId: 'r-nan', result }));
  assert.ok(head.length > 40, 'premise: the board has the section');
  assert.doesNotMatch(head, /round \?/, head);
  assert.doesNotMatch(head, /round (null|undefined)/, head);
});

const SIGNED = (round, extra = {}) => ({ signed_off: false, sha256: 'ab'.repeat(32), round, open_objections: 0, label: 'not_accepted', ...extra });
const DELIVERED = (notes = []) => ({ sha256: 'cd'.repeat(32), body_sha256: 'ab'.repeat(32), same_as_signed: true, changed_by: [], harness_notes: notes, re_reviewed: false });
test('NAN-11 (the handler-check head, a pure call, round null): no "round ?"; with a round the head still prints it', () => {
  const ending = { kind: 'agreed', basis: ['handler_check'] };
  const nullRound = renderTextLabelsBoard({ signedText: SIGNED(null), deliveredText: DELIVERED(), outcome: 'agreed', ending });
  assert.match(nullRound, /Agreed on the handler's build check/, 'premise: the handler-check head');
  assert.doesNotMatch(nullRound, /round \?/, nullRound);
  const withRound = renderTextLabelsBoard({ signedText: SIGNED(2), deliveredText: DELIVERED(), outcome: 'agreed', ending });
  assert.match(withRound, /round 2/, 'a record with a round keeps its round');
});

test('NAN-12 (the block name of a requested pass): the harness note of a requested pass is not named "the escalated sign-off block"; the stall block and the ladder block keep their names', () => {
  const call = extra => renderTextLabelsBoard({ signedText: SIGNED(2), deliveredText: DELIVERED(['escalated_signoff_block']), outcome: 'not_agreed', ...extra });
  assert.doesNotMatch(call({ requestedBlock: true }), /the escalated sign-off block/);
  assert.match(call({}), /the escalated sign-off block/, 'the stall escalation block keeps its name');
  assert.match(call({ ladderBlock: true }), /the ladder sign-off block/, 'the ladder block keeps its name');
});

test('NAN-13 (the intro of the passed-up board): where no ruling was read for any passed-up objection (and it is not the unrecorded ruling words), the judges "were asked to review" the plan; a ruling read, or the unrecorded words, keep "reviewed it"', () => {
  const ER = (outcome, extra = {}) => ({ round: 2, pass: 3, from_layer: 2, to_layer: 3, trigger: 'layer2_bound', ids: ['O-aaaa'], labs: ['mid-beta'], rulings: [], outcome, ...extra });
  const unread = [{ id: 'O-aaaa', lab: 'mid-beta', layer: 2, first_round: 1, problem: 'No owner is named.', result: 'undecided', why: 'unreadable_ruling' }];
  const held = [{ id: 'O-aaaa', lab: 'mid-beta', layer: 2, first_round: 1, problem: 'No owner is named.', result: 'undecided', why: 'prompt_held' }];
  const ruled = [{ id: 'O-aaaa', lab: 'mid-beta', layer: 2, first_round: 1, problem: 'No owner is named.', result: 'sustained', adopted_as: [{ lab: 'top-gamma', seat: 'top-gamma', id: 'O-gggg' }] }];
  const intro = o => renderEscalationsBoard([ER(o)], { pass: 3, layer: 3, below: [1, 2] }).split('\n\n')[1] ?? '';
  assert.doesNotMatch(intro(unread), /whose judges reviewed it/, intro(unread));
  assert.match(intro(held), /whose judges reviewed it/, 'the unrecorded ruling words keep "reviewed it"');
  assert.match(intro(ruled), /whose judges reviewed it/, 'a ruling that was read keeps "reviewed it"');
});

// ---- entry 46: a run finished AT ONCE where every top-layer seat had read THIS text and only a coverage read was owed (an objection or late finding opened or amended since a seat's last sorting).
// The record says so (`final_read.coverage_only`), and the sentence of the block above the plan does not say "did not read the final plan" (shape 1: both seats owe the read, `reused` empty) or "only part of the top layer
// had read this version" (shape 2: one seat owes it, the other sits in `reused`). The fixture is the T9a fixture of test/s16-coverage.test.js (la raises, lc objects, the person's finish-now cuts the run at a stop).
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const L2_MET = JSON.stringify({ meets: true, criteria: [{ criterion: L2_CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: L2_CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(sorting ? { sorting } : {}) });
const LC_FAILURE = { criterion: L2_CRITERION, problem: 'No back-off is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5 };
const idLC = objectionId('lc', LC_FAILURE);
const lcFails = (fails, sorting) => JSON.stringify({ meets: false, criteria: [{ criterion: L2_CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: fails, verdict_line: 'no', ...(sorting ? { sorting } : {}) });
const LC_NEW = { ...LC_FAILURE, relation: 'new' }; const LC_AGAIN = { ...LC_FAILURE, relation: `continues ${idLC}` };
const Z1 = { criterion: L2_CRITERION, problem: 'No timeout is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5, relation: 'new' };
const Z2 = { criterion: L2_CRITERION, problem: 'No log line is stated.', fix: 'State one.', quote: 'retries failed requests', severity: 5, relation: 'new' };
const LC_SORT = [{ id: idLC, sort: 'must_do', reason: 'The back-off is still missing.', criterion: L2_CRITERION }];
const NEW_DEFECT = { sort: 'must_do', reason: 'No timeout is stated.', criterion: L2_CRITERION, quote: 'retries failed requests' };
async function atOnceRun(overrides, cut) {
  setHeldForTest(SORTING); setOutboundScan({ finish: true, atOnce: true });
  const r = await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'panel-1-la': L2_MET, 'panel-1-lc': lcFails([LC_NEW]), 'final-read-lc': L2_MET, 'final-read-ld': L2_MET, ...overrides }, extra: {}, cutLabels: [cut] });
  assert.equal(r.result.stop?.finished_at_once, true, 'premise: finished at once at the stop');
  assert.equal(r.result.finalRead.reason, 'finished_at_once', 'premise: the final read was not made');
  return r.result.finalRead;
}
test('NAN-14 (entry 46, shape 1): both top-layer seats read this text and each owes a coverage read (a sibling\'s objection of the same pass): the record says coverage_only, `reused` is empty, and the words do not say the layer "did not read the final plan"', async () => {
  const fr = await atOnceRun({ 'panel-2-lc': lcFails([LC_AGAIN, Z1], LC_SORT), 'panel-2-ld': lcFails([Z2], LC_SORT) }, 'revise-2');
  assert.equal(fr.reused, undefined, 'premise: no seat sits in `reused`');
  assert.equal(fr.coverage_only, true);
  assert.doesNotMatch(finalReadNotReadWords(fr), /did not read the final plan\./);
});
test('NAN-15 (entry 46, shape 2, the split): one seat owes a coverage read (a defect the other named only in its own sorting), the other sits in `reused`: coverage_only, and the words do not say "only part of" the layer had read this version', async () => {
  const fr = await atOnceRun({ 'panel-2-lc': lcFails([LC_AGAIN], [...LC_SORT, NEW_DEFECT]), 'panel-2-ld': metWith([{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }]) }, 'revise-2');
  assert.deepEqual((fr.reused ?? []).map(x => x.lab), ['lc'], 'premise: lc sits in `reused`');
  assert.equal(fr.coverage_only, true);
  assert.doesNotMatch(finalReadNotReadWords(fr), /only part of/);
});
test('NAN-16 control (entry 46): a finish at once where the top layer had NOT read this text carries no coverage_only and keeps "did not read the final plan"; a partial read (a seat in `reused`, another never read it) keeps "only part of"', async () => {
  const fr = await atOnceRun({ 'panel-2-lc': lcFails([LC_AGAIN], LC_SORT), 'panel-2-ld': metWith([{ id: idLC, sort: 'may_leave', reason: 'Minor for the build.' }]) }, 'panel-2-lc');
  assert.equal(fr.coverage_only, undefined);
  assert.match(finalReadNotReadWords(fr), /did not read the final plan\./);
  const partial = { ran: false, reason: 'finished_at_once', run_end: 'not_agreed', final_sha: 'abc', seats: [], reused: [{ lab: 'lc', layer: 3, read_sha: 'abc', round: 2, statement: { verdict: 'objected' } }] };
  assert.match(finalReadNotReadWords(partial), /only part of/);
});

// ---- INTRO-7fe-base on the REAL run of test/send-up.test.js SU-1 (an older run's recorded send-up at layer 1's revision bound; the mock's ruling reply is unreadable, so no ruling was read for the passed-up objection):
// the board's section "Objections passed up a layer" says the judges "were asked to review" the plan, not that they "reviewed it" (the reply of one seat is not read, so "reviewed" claims more than the record shows).
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
test('NAN-17 (INTRO-7fe-base, the real run of SU-1): where no ruling was read for the passed-up objection, the intro of "Objections passed up a layer" does not say the judges "reviewed it"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-nan-su-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  const critics = [judge('x', 'nsua', 'l1', 1), judge('o', 'nsub', 'l2', 2), judge('o', 'nsuc', 'l3', 3)];
  writeFileSync(join(dir, 'chains', 'sup.json'), JSON.stringify({ name: 'sup', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = cliIn(dir);
  const first = run(['--chain', 'sup', '--task', 'tasks/t.md']);
  assert.equal(first.status, 23, 'premise: the run stops at layer 1\'s revision bound');
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const stop = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop;
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); meta.roundChoices = [roundChoiceEntry(stop, 'send_up')]; writeFileSync(join(runDir, 'run.json'), JSON.stringify(meta, null, 2));
  const r = run(['--resume', runDir]);
  assert.ok(r.status === 0 || r.status === 22, `premise: the run went on from the recorded send-up: ${r.status}`);
  const board = readFileSync(join(runDir, 'BOARD.md'), 'utf8');
  const at = board.indexOf('## Objections passed up a layer'); assert.ok(at >= 0, 'premise: the board has the section');
  const intro = board.slice(at, board.indexOf('\n\n', at + 40) > 0 ? board.indexOf('\n\n', board.indexOf('\n\n', at) + 2) : at + 600).split('\n\n')[1] ?? '';
  assert.match(intro, /sent up a layer/, `premise: the intro of the send-up: ${intro}`);
  assert.doesNotMatch(intro, /whose judges reviewed it/, intro);
});

test('NAN-18 (entry 46, the headline words of a finish at a stop): a coverage_only record with a seat in `reused` is not "only part of that layer had read this version"; without the field, today\'s sentence stays', () => {
  const at = fr => ({ passed: false, stop: { kind: 'stall_stop', chosen: 'finish', finished_at_once: true, pass: 2 }, layers: [{ round: 2, layer: 3, state: 'not_asked' }], final_read: fr });
  const rec = { ran: false, reason: 'finished_at_once', run_end: 'not_agreed', final_sha: 'abc', seats: [], reused: [{ lab: 'lc', layer: 3, read_sha: 'abc', round: 2, statement: { verdict: 'objected' } }] };
  assert.match(finishedAtStopWords(at(rec)) ?? '', /only part of that layer/, 'control: no field, today\'s sentence');
  assert.doesNotMatch(finishedAtStopWords(at({ ...rec, coverage_only: true })) ?? '', /only part of that layer/);
  const shape1 = finishedAtStopWords(at({ ...rec, reused: undefined, coverage_only: true })) ?? '';   // both seats owed the read, `reused` empty: the record must not read as "nobody read it" either
  assert.doesNotMatch(shape1, /no judge read the last version/);
});
