// 0.8.4 round 1, A7: a run finished AT ONCE at a stop with NO objection open (the shape of the printed case: every judge unreadable, the person ends the run at the silent-judge stop). Through the real CLI, $0.
// The shipped chain chains/plan-mini-council.json under its own name (a7-silent; the zero-spend scanner reads a shipped chain's name as a chain with real seats) with every judge a mock-unreadable seat and the proposers mock seats; prompt_cache deleted;
// the writer, criteria, skeleton and handoff seats stay as shipped (external): the test answers each pause. Expected path: the panel hears nobody, the run stops at the silent-judge bound, `--finish-now` ends it, the handoff pauses once and is answered.
// What tells the case apart (not a wording pin): with nothing open the five readers no longer say "open objections" / "open failures" (the headline text, the run state, the terminal's verdict line, the banner of HANDOFF.md and the handoff PROMPT, the last two through the one reason),
// and the sentence of the finished-at-a-stop clause no longer says no judge read the last version when the delivered text is the draft the last round reviewed. Controls: the same record with ONE field swapped (open objections 2; a delivered text that differs from the reviewed one) keeps today's words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictHeadline, finishedAtStopWords } from '../src/verdict-headline.js';
import { finishedRunState } from '../src/run-status.js';
import { finishedState, partialBanner } from '../src/handoff-from-run.js';
import * as EM from '../src/ending-matrix.js';
const { agreedOf } = EM;

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'src', 'cli.js');
const PAID = new Set(['anthropic', 'openrouter']);
const CRITERION = 'It states the assumptions it was written under.';

function silentRun(critic = () => 'mock-unreadable', name = 'a7-silent') {   // `critic(layer)`: the mock model of each critic seat; the default is the printed case (every judge unreadable)
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  c.name = name; delete c.prompt_cache;
  let n = 0;
  c.seats.proposers = c.seats.proposers.map(s => (PAID.has(s.provider) ? { ...s, provider: 'mock', model: ['mock-proposer-a', 'mock-proposer-b', 'mock-proposer-a'][n++ % 3] } : s));
  c.seats.critics = c.seats.critics.map(s => (PAID.has(s.provider) ? { ...s, provider: 'mock', model: critic(s.layer) } : s));
  const d = mkdtempSync(join(tmpdir(), 'thc-a7-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', `${name}.json`), JSON.stringify(c));
  writeFileSync(join(d, 'tasks', 't.md'), '# A plan\n\nPlan a small retry limit.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d }, timeout: 180000 });
  let r = run(['--chain', name, '--task', 'tasks/t.md']);
  const RD = join(d, 'runs', readdirSync(join(d, 'runs'))[0]);
  const pending = () => readdirSync(RD).filter(f => /^NEEDS-/.test(f) && !existsSync(join(RD, f.replace(/^NEEDS-/, ''))));
  let finished = false, handoffPrompt = null;
  const steps = [{ step: 'start', status: r.status }];   // a wrong path names its step in the failure, not as a missing file
  for (let i = 0; i < 12 && !(r.status === 22); i++) {
    if (r.status === 3) {
      const lab = (pending()[0] ?? '').replace(/^NEEDS-/, '').replace(/\.md$/, '');
      let text;
      if (lab === 'criteria') text = JSON.stringify({ criteria: [CRITERION] });
      else if (lab === 'handoff') { handoffPrompt = readFileSync(join(RD, 'NEEDS-handoff.md'), 'utf8'); text = '# SEAT-OWN-FIRST-LINE\n\nStatus: ready_for_build\n\nBuild it in four steps.\n'; }
      else if (/^(skeleton|build|revise-\d+(-full)?)$/.test(lab)) text = `# Plan after ${lab}\n\nAssumptions: tea and a retry limit ${i}.\n`;
      else break;
      writeFileSync(join(RD, `${lab}.md`), text);
      r = run(['--resume', RD]); steps.push({ step: `answered ${lab}`, status: r.status });
    } else if (!finished) { finished = true; r = run(['--resume', RD, '--finish-now']); steps.push({ step: '--finish-now', status: r.status }); }
    else break;
  }
  if (!existsSync(join(RD, 'report.json'))) throw new Error(`the run wrote no report.json; steps: ${JSON.stringify(steps)}; last stderr: ${String(r.stderr).split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  return { exit: r.status, stdout: r.stdout, report: JSON.parse(readFileSync(join(RD, 'report.json'), 'utf8')), handoff: readFileSync(join(RD, 'HANDOFF.md'), 'utf8'), handoffPrompt };
}

let ran = null;   // one real run shared by the rows below (each row asserts one reader, so each has its own red)
const silent = () => (ran ??= silentRun());
let ranHeard = null;   // the HEARD leg: layer 1 reads the draft and signs off, layer 2 stays silent, the person ends the run at the silent-judge stop
const heard = () => (ranHeard ??= silentRun(layer => (layer === 1 ? 'mock-exch-support-keep-clean' : 'mock-unreadable'), 'a7-heard'));
function premise(w) {   // the printed shape: finished at once at a stop, nobody heard, nothing open, the delivered text is the draft the last round reviewed, the handoff written
  const { report } = w;
  assert.equal(w.exit, 22, w.stdout);
  assert.equal(report.passed, false);
  assert.equal(report.stop?.finished_at_once, true, 'premise: finished at once');
  assert.equal(report.signed_text.open_objections, 0, 'premise: nothing open at the end');
  assert.equal(report.delivered_text.same_as_signed, true, 'premise: the delivered text is the reviewed draft');
  assert.equal(report.ending_word, 'finish_chosen');
}

test('A7-1 (the run state): finished at once at a stop with no objection open: the run state does not say "open objections"', () => {
  const w = silent(); premise(w);
  const state = finishedRunState(w.report);
  assert.ok(state.endsWith(finishedAtStopWords(w.report)), `premise: the finished-at-a-stop branch is the one reached: ${state}`);
  assert.doesNotMatch(state, /^done: open objections/);
});

test('A7-2 (the headline): the same run: the headline text does not say "OPEN OBJECTIONS" (the label stays: it is not among the changed texts)', () => {
  const w = silent(); premise(w);
  const h = verdictHeadline(w.report);
  assert.equal(h.label, 'OPEN OBJECTIONS', 'premise: the branch of the finished-at-a-stop clause is the one reached (the label is not changed)');
  assert.ok(h.text.endsWith(finishedAtStopWords(w.report)), 'premise: the clause is in the text');
  assert.doesNotMatch(h.text, /^OPEN OBJECTIONS/);
});

test('A7-3 (the terminal verdict line): the same run: the verdict line printed at the end does not say "open failures"', () => {
  const w = silent(); premise(w);
  const line = w.stdout.split('\n').find(l => l.trimStart().startsWith('verdict:'));
  assert.ok(line && line.includes(finishedAtStopWords(w.report)), `premise: the verdict line carries the finished-at-a-stop clause: ${line}`);
  assert.doesNotMatch(line, /stopped with open failures/);
});

// CHANGED ACCEPTED TEST (round 1, the A7 fix, A7-c). OLD: finished at once at a stop where the delivered text is the draft the last round was shown, the clause did NOT say no judge read the last version (it said "the last round reviewed this version"). NEW: it says so when NO seat was heard on that text in the stop's pass (this run: every judge unreadable): the words of 7a4e2900, which were true here; "the last round reviewed this version" stays only where a seat was heard on it (test/a7-finish-now-late-finding.test.js). WHY: the round was shown the text but nobody read it, so "reviewed" was false (box print P3, Mini-C&C's rig: 0 heard).
test('A7-c: finished at once at a stop where the delivered text is the draft the last round was shown but no seat was heard on it: the clause says no judge read the last version, and not that the round reviewed it', () => {
  const w = silent(); premise(w);
  const fr = w.report.final_read;
  assert.deepEqual([fr?.ran, fr?.reason], [false, 'finished_at_once'], 'premise: the two final-read branches above the clause are not the ones reached (the top layer read nothing)');
  assert.ok(!(Array.isArray(fr.reused) && fr.reused.length), 'premise: no top seat had read any version');
  const heardRows = (w.report.panelVerdicts ?? []).filter(v => v.round === w.report.signed_text.round);
  assert.ok(heardRows.length > 0 && heardRows.every(v => v.verdict === 'unheard'), `premise: no seat was heard on the delivered text (${heardRows.map(v => `${v.lab}:${v.verdict}`).join(' ')})`);
  assert.match(finishedAtStopWords(w.report), /no judge read the last version of it before the run ended/);
  assert.doesNotMatch(finishedAtStopWords(w.report), /reviewed this version/);
});

test('A7-c (heard): the same finish, but layer 1 was heard on the delivered text and signed it: the clause says the last round reviewed this version, and not that no judge read it', () => {
  const w = heard(); premise(w);
  const rows = (w.report.panelVerdicts ?? []).filter(v => v.round === w.report.signed_text.round);
  assert.ok(rows.some(v => v.layer === 1 && v.verdict === 'signed_off'), `premise: a layer-1 seat signed off on the delivered text (${rows.map(v => `${v.lab}:${v.verdict}`).join(' ')})`);
  assert.equal(w.report.signed_text.round, w.report.stop.pass, 'premise: the stop came in the round the text was read in');
  assert.match(finishedAtStopWords(w.report), /the last round reviewed this version: no judge was asked again/);
  assert.doesNotMatch(finishedAtStopWords(w.report), /no judge read the last version/);
});

test('A7-4 (the banner): the reason in the banner of HANDOFF.md is not "finished with open objections" when none is open, and it is told apart from the shared reason by the fact alone', () => {
  const w = silent(); premise(w);
  assert.ok(w.handoff.startsWith('> **Not a signed-off plan.**'), 'premise: the not-signed-off banner is the one written');
  assert.doesNotMatch(w.handoff.split('\n').slice(0, 3).join('\n'), /finished with open objections/);
  const base = { passed: agreedOf(w.report), outcome: w.report.outcome, delivered_text: w.report.delivered_text, ending_word: w.report.ending_word };
  assert.notEqual(finishedState({ ...base, nothing_open_at_once: true }).reason, finishedState(base).reason);
});

test('A7-4 (the handoff prompt): the same reason, read by the handoff PROMPT of the run, is not "finished with open objections" when none is open', () => {
  const w = silent(); premise(w);
  assert.ok(w.handoffPrompt && w.handoffPrompt.includes('finish_chosen'), 'premise: the handoff prompt carries the ending line');
  assert.doesNotMatch(w.handoffPrompt, /finished with open objections/);
});

test('A7 controls: the same record with ONE field swapped keeps today\'s words (objections open; a delivered text that is not the reviewed one)', () => {
  const w = silent(); premise(w);
  const open = structuredClone(w.report); open.signed_text.open_objections = 2;
  assert.match(verdictHeadline(open).text, /^OPEN OBJECTIONS/, 'objections open: the headline');
  assert.match(finishedRunState(open), /^done: open objections/, 'objections open: the run state');
  const base = { passed: agreedOf(open), outcome: open.outcome, delivered_text: open.delivered_text, ending_word: open.ending_word };
  assert.equal(finishedState({ ...base, nothing_open_at_once: false }).reason, 'finished with open objections', 'objections open: the shared reason');
  const revised = structuredClone(w.report); revised.delivered_text.same_as_signed = false; revised.delivered_text.changed_by = ['final_edit'];
  assert.match(finishedAtStopWords(revised), /no judge read the last version/, 'a delivered text that is not the reviewed one');
});

test('A7 (one fact of "nothing stands"): the same record with a dispute entry that stands keeps today\'s words at every reader (headline, run state, reason, banner tail); an entry the closing read closed does not stand', () => {
  const w = silent(); premise(w);
  const withList = list => { const r = structuredClone(w.report); r.dispute = { ...(r.dispute ?? {}), open_objections: list }; return r; };
  const entry = { id: 'O-aaaa1111', seat: 'l1', problem: 'p', severity: 5 };
  const tail = r => partialBanner({ state: finishedState({ passed: agreedOf(r), outcome: r.outcome, delivered_text: r.delivered_text, ending_word: r.ending_word, nothing_open_at_once: EM.finishedAtOnceNothingOpen(r), at_once: EM.finishedAtOnceCase?.(r), nothing_stands: EM.nothingStandsAtEnd?.(r) }), draftName: 'deliverable.md', runId: 'r1' });
  const standing = withList([entry]);
  assert.match(verdictHeadline(standing).text, /^OPEN OBJECTIONS/, 'a dispute entry stands: the headline');
  assert.match(finishedRunState(standing), /^done: open objections/, 'a dispute entry stands: the run state');
  assert.equal(finishedState({ passed: agreedOf(standing), outcome: standing.outcome, delivered_text: standing.delivered_text, ending_word: standing.ending_word, nothing_open_at_once: EM.finishedAtOnceNothingOpen(standing), at_once: EM.finishedAtOnceCase?.(standing), nothing_stands: EM.nothingStandsAtEnd?.(standing) }).reason, 'finished with open objections', 'a dispute entry stands: the reason');
  assert.match(tail(w.report), /how the run ended/, 'premise: with nothing standing the banner tail says how the run ended');
  assert.doesNotMatch(tail(standing), /how the run ended/, 'a dispute entry stands: the banner tail says what was left open');
  const closed = withList([{ ...entry, closed_by: 'final_read' }]);
  assert.doesNotMatch(verdictHeadline(closed).text, /^OPEN OBJECTIONS/, 'an entry the closing read closed does not stand: the headline');
  assert.doesNotMatch(finishedRunState(closed), /^done: open objections/, 'an entry the closing read closed does not stand: the run state');
});
