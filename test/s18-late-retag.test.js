// 0.8.4 S18 (Q3 (a), T21ab; C&C's ruling: the existing handler re-tag is extended to a late finding's id, applied at the build check, not a new verb): the handler re-tags a late finding from 6.0 to 3.0. WHOLE-RUN rows, offline, mock seats, $0; the check's words, the rating/sorting words and the final read's words (the rating of
// a new defect) are HELD and injected. The re-tag is recorded in severity.retags (old, new, who, the pass, the reason) and clears NOTHING (a late finding holds no sign-off: no cleared_by, T21ab's expect: the finding is still named in the check); the late finding's own row keeps the rating AS FOUND (the record is not overwritten), while the check, the
// BOARD and the HANDOFF show the rating in force; no L- row reaches severity.overrides; a re-tag naming a late finding that a check demanded and that the last verdict no longer carries is refused through the existing refusal path (retags_refused, why late_finding_dropped). Fixture: the T21z shape of test/s18-late-findings.test.js (everyone signs
// off in pass 1; layer 3 names one defect in its sorting), COPIED. Written without a run (no tests on the laptop). The reds are the parent commit (an L- id is refused as invalid there: no re-tag row) and swapped-input variants (S18_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { lateFindingKey } from '../src/objection-ids.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { W31 } from './helpers/w31-held.js';

afterEach(() => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', ...extra });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const defect = (reason, rating) => ({ sort: 'must_do', reason, criterion: CRITERION, quote: 'retries failed requests', rating });
const FIRST = 'No timeout is stated anywhere.';
// the id of a late finding is made from the seat, the criterion and the text (lateFindingKey): computed here, not read from the check, so a tree where the check lists no late finding fails at the behaviour asserted and not at a premise
const idFor = problem => lateFindingKey('top', { criterion: CRITERION, problem }).base;
const REASON = 'A missing timeout does not change what is built.';

// pass1/pass2: what layer 3 names in its sorting at pass 1 and (after a not_yet) at pass 2; retagsOf(id) -> the handler's re-tags once the id is known; answers: the handler's replies by check
async function go({ pass2 = FIRST, retagsOf, replies }) {
  const prompts = new Map();
  try {
    setHeldForTest({ ...DEMAND, ...SORTING, ...W31, ...CHECK });
    setPromptSpy(p => prompts.set(p.label, p));
    const script = { 'panel-1-top': meets({ sorting: [defect(FIRST, 6)] }), 'panel-2-top': meets({ sorting: [defect(pass2, 6)] }) };
    const config = { name: 'fixture-s18-late-retag', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds: 4,
      seats: { builder: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, reviser: { provider: 'external', model: 'claude-code-session', lab: 'handler' }, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } };
    const make = (extra, retags) => {
      setCache({ invalidate() {}, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-late-retag', log: () => {}, config, ...(retags ? { retags } : {}) });
    };
    const one = await make({}).then(() => null, e => e);
    const A = idFor(FIRST);
    const retags = retagsOf(A);
    const firstReply = replies({ A })['build-check-1'];
    let two = null; let B = null;
    if (firstReply && JSON.parse(firstReply).answer === 'not_yet') { two = await make({ 'build-check-1': firstReply }, retags).then(() => null, e => e); B = idFor(pass2); }
    const end = await make(replies({ A, B }), retags).then(result => ({ result }), error => ({ error }));
    return { one, two, A, B, end, retags };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('T21ab: the handler re-tags a late finding from 6.0 to 3.0 at the build check: old, new, who, pass and reason are recorded, it clears nothing, the finding is still named in the check, the late finding keeps the rating as found and the BOARD shows the rating in force', async () => {
  const TO = 3;
  const d = await go({ retagsOf: A => [{ pass: 1, id: A, severity: TO, reason: REASON }], replies: ({ A }) => ({ 'build-check-1': answer('good_to_build', `${A}: I agree the defect holds; the build can handle it.`) }) });
  assert.ok(d.one instanceof ExternalPause && d.A, `premise: the first check lists a late finding (${String(d.one)})`);
  assert.equal(d.end.error, undefined, `premise: the run ends (${String(d.end.error)})`);
  const rep = reportJsonShape({ runId: 'r-s18-late-retag', chain: 'fixture-s18-late-retag', task: 't.md', result: d.end.result, config: null });
  const row = (d.end.result.severityRun?.retags || []).find(x => x.id === d.A);
  assert.deepEqual([row?.from, row?.to, row?.by, row?.pass, row?.reason, row?.cleared_by], [6, TO, 'handler', 1, REASON, undefined], 'T21ab: the re-tag is recorded (old, new, who, pass, reason) and clears nothing');
  assert.ok(d.end.result.buildChecks[0].required.includes(d.A), 'T21ab: the finding is still named in the check');
  assert.equal(rep.late_findings.find(l => l.id === d.A)?.rating, 6, 'the late finding keeps the rating as found');
  assert.deepEqual([(d.end.result.severityRun?.overrides || []).length, (d.end.result.severityRun?.retags_refused || []).length], [0, 0], 'no L- row in the overrides, nothing refused');
  const board = renderBoardMd({ runId: 'r-s18-late-retag', result: d.end.result });
  assert.match(board, new RegExp(`- ${d.A} \\([^)]*rating 3`), 'the BOARD shows the rating in force');
});

test('T21ab (next check): after a not_yet the next check shows the late finding at the rating in force (3.0), and the finding is the same id', async () => {
  const TO = 3;
  const d = await go({ retagsOf: A => [{ pass: 1, id: A, severity: TO, reason: REASON }], replies: ({ A }) => ({ 'build-check-1': answer('not_yet', `${A}: please state a timeout.`), 'build-check-2': answer('good_to_build', `${A}: agreed, the build can handle it.`) }) });
  assert.ok(d.one instanceof ExternalPause && d.two instanceof ExternalPause && d.two.label === 'build-check-2', `premise: two checks (${String(d.one)} / ${String(d.two)})`);
  assert.match(d.one.user, new RegExp(`- ${d.A} \\(found by [^;]+; rated 6\\.0`), 'the first check shows the rating as found (the handler had not re-tagged yet)');
  assert.match(d.two.user, new RegExp(`- ${d.A} \\(found by [^;]+; rated ${TO}\\.0`), 'the next check shows the rating in force');
});

test('Q3 (dropped): a re-tag naming a late finding that a check demanded and the last verdict no longer carries is refused through the existing refusal path, with its reason', async () => {
  const d = await go({ pass2: 'No time limit is given for the retries.', retagsOf: A => [{ pass: 2, id: A, severity: 3, reason: REASON }], replies: ({ A, B }) => ({ 'build-check-1': answer('not_yet', `${A}: please state a timeout.`), 'build-check-2': answer('good_to_build', `${B}: agreed.`) }) });
  assert.ok(d.A && d.B && d.A !== d.B, 'premise: the seat worded the defect again at pass 2 (a new id)');
  assert.equal(d.end.error, undefined, `premise: the run ends (${String(d.end.error)})`);
  const rep = reportJsonShape({ runId: 'r-s18-late-retag', chain: 'fixture-s18-late-retag', task: 't.md', result: d.end.result, config: null });
  const refused = (d.end.result.severityRun?.retags_refused || []).find(x => x.id === d.A);
  assert.deepEqual([refused?.pass, refused?.why, refused?.by], [2, 'late_finding_dropped', 'handler'], 'the refusal is recorded with its reason');
  assert.equal((d.end.result.severityRun?.retags || []).some(x => x.id === d.A), false, 'nothing was applied to the dropped finding');
});

test('Q3 (no check at the pass): a late-finding re-tag whose pass never got a build check is refused at the end with its reason, never dropped silently', async () => {
  const d = await go({ retagsOf: A => [{ pass: 5, id: A, severity: 3, reason: REASON }], replies: ({ A }) => ({ 'build-check-1': answer('good_to_build', `${A}: agreed.`) }) });
  assert.equal(d.end.error, undefined, `premise: the run ends (${String(d.end.error)})`);
  const rep = reportJsonShape({ runId: 'r-s18-late-retag', chain: 'fixture-s18-late-retag', task: 't.md', result: d.end.result, config: null });
  const refused = (d.end.result.severityRun?.retags_refused || []).find(x => x.id === d.A);
  assert.deepEqual([refused?.pass, refused?.why, refused?.by], [5, 'no_check_at_pass', 'handler'], 'the line for a pass that got no check is refused with its reason');
  assert.equal((d.end.result.severityRun?.retags || []).length, 0, 'nothing was applied');
});
