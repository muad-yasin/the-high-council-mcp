// 0.8.4 item 6, FIX 1 of the review of 6a6d2855 (Mini-C&C; C&C's ruling): an AGREED run that was finished at once with the owed final read not made keeps "agreed" (his 10 Nov 2026 19:01 reason), so the summary block's
// verdict line alone ("PASSED - ...") would not say that the top layer did not read the last version. The block is the handling session's own text plus the ending line THC builds from the run's own headline (and, for this end, the final-read block's sentence).
// CHANGED (0.8.4 apply, C&C ruling 12 Nov 2026): the end the row runs is F2 (one layer, a stated pass, finish at once at the owed read; see the note above its row); the ending line's sentences and the status line's "differs" clause are no longer pinned (the notes below say why).
// ROW (in-process, the real chain on a scripted-cache fixture copied from test/finish-now-spending.test.js's FS-2 one-layer row: no *.test.js file is imported; then the real `summaryAddCommand` on a run folder written from the real report): F2. An FN-5c row, the final-read stop, followed it and is REMOVED: see the note below.
// The held summary instruction is injected with setHeldForTest, as the preload does for a spawned CLI.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the box decides the fixtures. The premise asserts of each row say what the fixture must have produced before the verb is tried.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, setPromptSpy, setCache, setBudget, setSpendFinish, setNoMoneySitting, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { renderFinalReadBlock } from '../src/final-read.js';
import { agreedOf } from '../src/ending-matrix.js';
import { textSha256 } from '../src/text-labels.js';
import { summaryAddCommand } from '../src/summary-add.js';
import { withoutSummaryBlock } from '../src/summary-block.js';
import { handlerSummaryInstruction, handlerSummaryEndLine } from './held-prompts/held-084-summary.js';
import { answer } from './helpers/build-check.js';

const dirs = [];
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setSpendFinish(null); setNoMoneySitting(false); setOutboundScan({}); while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const HEADING = '## Summary and index (written by the handling session)';
const SUMMARY = '1. Summary\n- The plan settles a worker with a retry limit.\n\n2. Open\n- Nothing the plan leaves open.\n\n3. Key data points\n- None stated.\n\n4. Index\n- The plan: one paragraph.\n';
const DRAFT = 'The worker retries failed requests.';
const CRITERION = 'The plan defines a retry limit.';
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });

// ---------- F2: the in-process one-layer run of test/finish-now-spending.test.js (the FS-2 ONE-layer row; printed in job 124's FS2-exact leg) ----------
// A layered chain with all critics on layer 1 and the undocumented key freedoms { pass: true }: seat-a signs, seat-b STATES A PASS, a handler answers good_to_build, so the run ends AGREED with seat-b's final read owed; the final read would bill (seat-b is the priced seat) and is not made at the spending stop (finish at once).
const PRICED = 'mock-priced'; const JUDGE = 'mock-review-fixture';
const writer = { provider: 'mock', model: PRICED, lab: 'writer', maxTokens: 3000 };
const judge = (lab, layer, model = JUDGE) => ({ provider: 'mock', model, lab, maxTokens: 3000, layer });
async function fs2Report() {
  setPromptSpy(() => {}); setHeldForTest(null);
  const scripted = { 'panel-1-seat-b': JSON.stringify({ pass: true, pass_reason: 'Nothing to object to.' }), 'build-check-1': answer('good_to_build', '') }; const misses = [/^final-read-/];
  setCache({ invalidate() {}, get(label) {
    if (misses.some(m => m.test(label))) return null;
    const text = label in scripted ? scripted[label] : label.startsWith('panel-') || label.startsWith('final-read-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  setNoMoneySitting(true);
  const config = { name: 'fixture-fns', criteria: [CRITERION], signoff: 'unanimous', maxRounds: 3, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, freedoms: { pass: true },
    seats: { builder: writer, reviser: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, critics: [judge('seat-a', 1), judge('seat-b', 1, PRICED)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-fns', log: () => {}, config, roundChoices: [] });
  return JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-fns', chain: 'fixture-fns', task: 't.md', result, config })));
}

// ---------- the verb, on a run folder written from the real report ----------
const HANDLED = { seats: { reviser: { provider: 'external', model: 'claude-code-session', lab: 'handler' } } };   // the handling session is a fact of the chain, not of the report: the folder's report is the real one
function addSummary(report) {
  const work = mkdtempSync(join(tmpdir(), 'sumunread-')); dirs.push(work);
  const runDir = join(work, 'run'); mkdirSync(runDir);
  const file = `${DRAFT}\n`;
  writeFileSync(join(runDir, 'deliverable.md'), file);
  const rep = { ...report, delivered_text: { ...(report.delivered_text ?? {}), sha256: textSha256(file) } };   // what the CLI records for the file it writes
  writeFileSync(join(runDir, 'report.json'), `${JSON.stringify(rep, null, 2)}\n`);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: 'fixture' }));
  writeFileSync(join(work, 'summary.md'), SUMMARY);
  let out = ''; let errOut = '';
  setHeldForTest({ handlerSummaryInstruction, handlerSummaryEndLine });
  const status = summaryAddCommand([runDir], { work, summaryFile: join(work, 'summary.md'), chainOf: () => HANDLED, readRunMeta: d => JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')), stdout: { write: s => { out += s; } }, stderr: { write: s => { errOut += s; } } });
  setHeldForTest(null);
  return { status, out, errOut, rep, original: file, after: readFileSync(join(runDir, 'deliverable.md'), 'utf8'), afterReport: JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) };
}
// CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026, parts 2 and 3, Q-b (c)). OLD: the FS-2 shape row: an AGREED panel whose final edit changed the text after the sign-off, the owed read would bill and was not made at the spending stop: the summary block says the delivered text differs and that the top layer did not read the final plan, in THC's own words (premises: delivered_text.same_as_signed false, the status line's "the delivered text differs" clause, the final-read block's "did not read the final plan." sentence; the ending line pinned whole).
// Red on the tip (job 128: premise :94, final_read [false, 'every_top_seat_read_this_plan', 'agreed']): at an agreed end the final edit never runs, so no read is owed and the text is never changed (read: chain.js:7660). The skip is pinned by test/build-check.test.js: the 'Q-i1 (permanent)' row at :154 (the handler form: after good_to_build the challenge and the final edit are not served) and T21d at :171 (the no-handler form); the dispute rewrite's skip is read, not driven. NEW: the same verb at F2, the end that exists (one layer, a stated pass, a handler; finish at once at the owed read): premises passed true, agreedOf true and final_read [ran false, reason finished_at_once, run_end agreed] (printed, job 124); the VERB's structural claims kept: it exits 0, the summary block heads the file with THC's verdict headline on the ending line,
// the file below the block is the file the run wrote byte for byte, the run's own hash is untouched. NOT asserted (A3): the ending line's sentences (the final-read coverage sentence "only part of layer 1 had read this version before (seat-a)" is conditional) and the status line's "differs" clause (same_as_signed false cannot be reached at an agreed end: bin 1, FOR_085). There is no 'unread' FIELD (summary-add.js:77 is a local): the fields that decide it are final_read and agreedOf. WHY: the verb's behaviour at the one end where `unread` is non-empty. RED: the same row on a run whose final read WAS made (a cleared read: ran true): the premise [ran false, finished_at_once] fails.
function assertBlock(report, label) {
  // premises: what the fixture must have produced before the verb is tried
  assert.equal(report.passed, true, `${label}: premise: the panel's verdict is kept (passed)`);
  assert.equal(agreedOf(report), true, `${label}: premise: the run is agreed`);
  assert.deepEqual([report.final_read?.ran, report.final_read?.reason, report.final_read?.run_end], [false, 'finished_at_once', 'agreed'], `${label}: premise: the owed read was not made`);
  const r = addSummary(report);
  assert.equal(r.status, 0, `${label}: the summary is recorded (${r.out}${r.errOut})`);
  assert.ok(r.after.startsWith(`${HEADING}\n\nHow the run ended: ${verdictHeadline(r.rep).text}`), `${label}: the block heads the file and its ending line starts with THC's verdict headline (${JSON.stringify(r.after.slice(0, 700))})`);
  assert.doesNotMatch(bodyOfFinalReadBlock(r.rep.final_read), /ended without agreement/, `${label}: an agreed run is never said to have ended without agreement`);
  assert.equal(withoutSummaryBlock(r.after, r.afterReport.delivered_text.summary_block), r.original, `${label}: the file below the block is the file the run wrote, byte for byte`);
  assert.equal(r.afterReport.delivered_text.sha256, r.rep.delivered_text.sha256, `${label}: the run's own hash is untouched`);
}
const bodyOfFinalReadBlock = fr => renderFinalReadBlock(fr).replace(/^## [^\n]*\n\n/, '').replace(/\n---\n$/, '');

test('F2 (one layer, a stated pass; an AGREED panel; the owed read would bill and was not made at the spending stop): the summary verb records the block: exit 0, the headline on the ending line, the file below it and the hash untouched', async () => {
  assertBlock(await fs2Report(), 'F2');
});

// REMOVED (0.8.4 apply, C&C ruling 12 Nov 2026, part 3: bin 1, with FN-5c in test/finish-now.test.js). OLD: the FN-5c shape row: the final-read stop of a panel that had SIGNED OFF (a finalist chain), then finish-now: the summary block carries the same two statements as in the FS-2 row (assertBlock). Red on the tip (job 128: its premise `report.passed` true fails: the stop's ending cannot be reached on the recorded state). NEW: the row is gone with its fixture (fn5cReport); the ending it needed has no route (see the removal note in test/finish-now.test.js). The FS-2 row stays until its own re-aim is ruled.
