// 0.8.4 D2 (UNIT 3 FIX, C&C 09 Nov 2026 item 3): the late findings the acceptance names are the rows the REPORT WRITER produces. The envelope is the "L- ruling" run of test/s18-late-findings.test.js (copied: runReworded; a real in-process run,
// mock seats, the held wording injected, a handler that answers two build checks): its report holds one CARRIED late finding and one DROPPED one (dropped_after_check). Those real rows go through the acceptance readers: the open list marks the carried
// one late and leaves the dropped one out; the question and the line name it. No test that names late_findings spawns the CLI and no test preload injects the sorting or ending-exchange wording a late finding needs, so the command itself is driven in test/accept-flow.test.js F5/F6 with a row
// made by lateFindingRow, the function every writer site in src/chain.js builds its rows with. Offline, $0. The run ends agreed (good_to_build), so this test shows the rows' shape and the readers, not an accepted run.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { lateFindingKey } from '../src/objection-ids.js';
import { openObjectionsOf, acceptanceQuoteText, acceptanceLine } from '../src/acceptance.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { W31 } from './helpers/w31-held.js';

afterEach(() => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', ...extra });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const defect = (reason, rating) => ({ sort: 'must_do', reason, criterion: CRITERION, quote: 'retries failed requests', rating });

// copied from test/s18-late-findings.test.js runReworded: check 1 demands finding A; the handler answers not_yet; the top seat names the same defect in other words (a new id B): check 2 demands B
async function runReworded() {
  try {
    setHeldForTest({ ...DEMAND, ...SORTING, ...W31, ...CHECK });
    const script = { 'panel-1-top': meets({ sorting: [defect('No timeout is stated anywhere.', 6)] }), 'panel-2-top': meets({ sorting: [defect('No time limit is given for the retries.', 6)] }) };
    const config = { name: 'fixture-s18-late-r', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds: 4, handoff: true,
      seats: { handoff: { provider: 'mock', model: 'mock-handoff' }, builder: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, reviser: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } };
    const make = extra => {
      setCache({ invalidate() {}, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-late-r', log: () => {}, config });
    };
    const one = await make({}).then(() => null, e => e);
    const A = lateFindingKey('top', { criterion: CRITERION, problem: 'No timeout is stated anywhere.' }).base;
    const notYet = { 'build-check-1': answer('not_yet', `${A}: this must be fixed first.`) };
    const two = await make(notYet).then(() => null, e => e);
    const B = lateFindingKey('top', { criterion: CRITERION, problem: 'No time limit is given for the retries.' }).base;
    const full = { ...notYet, 'build-check-2': answer('good_to_build', `${B}: I agree the defect holds.`) };
    const end = await make(full).then(result => ({ result }), error => ({ error }));
    return { one, two, A, B, end };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('P9 the late findings of a real run go through the acceptance readers: the carried one is listed and marked late, the dropped one is not listed, and the question and the line name the carried one', async () => {
  const d = await runReworded();
  assert.ok(d.one instanceof ExternalPause && d.one.label === 'build-check-1' && d.A, `premise: the first check lists a late finding (${String(d.one)})`);
  assert.ok(d.two instanceof ExternalPause && d.two.label === 'build-check-2' && d.B, `premise: after the not_yet the second check lists a late finding (${String(d.two)})`);
  assert.equal(d.end.error, undefined, `premise: the run ends (${String(d.end.error)})`);
  const report = reportJsonShape({ runId: 'r-s18-late-r', chain: 'fixture-s18-late-r', task: 't.md', result: d.end.result, config: null });
  const byId = new Map((report.late_findings || []).map(l => [l.id, l]));
  assert.deepEqual([byId.get(d.A)?.dropped_after_check, byId.get(d.B)?.dropped_after_check], [true, undefined], 'premise: the writer\'s report holds A as dropped and B as carried');
  const open = openObjectionsOf(report);
  assert.deepEqual(open.filter(o => o.late).map(o => o.id), [d.B], 'the carried row is listed, marked late; the dropped row is not listed');
  assert.ok(!open.some(o => o.id === d.A));
  const text = acceptanceQuoteText({ runId: 'r-s18-late-r', report, objections: open });
  assert.match(text, new RegExp(`^- ${d.B} \\(top, a late finding\\): `, 'm'));
  assert.ok(!text.includes(d.A), 'the dropped finding is not asked about');
  const line = acceptanceLine({ channel: 'cli', at: '2026-11-09T10:00:00.000Z', reason: 'ok', objections: open.map(o => (o.late ? { id: o.id, late: true } : { id: o.id })) });
  assert.ok(line.includes(`Late findings, not debated, accepted as they stand: ${d.B}.`), line);
});
