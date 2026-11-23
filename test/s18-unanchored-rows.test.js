// 0.8.4 S18 (T18j, T18s, T18t, T18u, T18r; D21, W7, W32; C&C's T18 (a) ruling): a blind-review failure rated 5.0 with NO quote reaches layer 3's sorting unanchored and a seat sorts it must-do. W7: "a failure marked unanchored is not sorted must-do as an objection: if you hold that its defect must be done, say so,
// and it is recorded as a late finding". So the build list's must-do item is ONE late finding with the seat's rating (W32), LINKED to the failure's id (late_findings[].linked_to); the failure's own id stays open, flagged unanchored, and keeps the seat's sorting as a RECORD ONLY (the check line says so); the check names the pair once,
// by either id; and the failure still holds its judge's sign-off while its id stays open. The ranking half of T12m (the S8-5 pin: the row is kept with its sort and its place) is untouched: test/s8-sorting.test.js:149 asserts only that, and still holds. Offline, mock seats, $0. The check's words, the rating/sorting words and the final read's words (W31/W32) are
// HELD and injected. Fixture: the T17ag fixture of test/helpers/s8-handler-rows.js (itself C3-23 of test/s8-closure.test.js), COPIED, with the failure raised WITHOUT a quote. Written without a run (no tests on the laptop). The reds are the parent commit (it sorts the unanchored failure as an objection and makes no late finding) and swapped-input variants (S18_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId, lateFindingKey } from '../src/objection-ids.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { W31 } from './helpers/w31-held.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';

afterEach(() => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', ...extra });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const HESC_INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const PROBLEM = 'No limit on retries.';
// the ground's two ids: the failure's (a hash of its seat and criterion: it quotes nothing) and the late finding's (made from the failure's own seat, criterion and text)
const idU = objectionId('raiser', { criterion: CRITERION, problem: PROBLEM });
const LATE = lateFindingKey('raiser', { criterion: '', problem: PROBLEM }).base;

// rate: the rating raiser gives the failure; names: which id(s) of the pair the handler's reasons name ('failure', 'late', 'both', 'none')
async function run({ rate, names }) {
  const U = { criterion: CRITERION, problem: PROBLEM, fix: 'State a limit.', severity: rate };   // NO quote
  const prompts = new Map();
  try {
    setHeldForTest({ ...HESC_INJECT, ...DEMAND, ...SORTING, ...W31, relationRule: HB084.relationRule, ...CHECK });
    setPromptSpy(p => prompts.set(p.label, p));
    const rel = (f, relation) => ({ ...f, relation });
    const topSigns = meets({ sorting: [{ id: idU, sort: 'must_do', reason: 'The limit is missing and no passage shows it.', criterion: CRITERION, rating: 5 }] });
    const script = { 'panel-1-raiser': objects(rel(U, 'new')), 'panel-2-raiser': objects(rel(U, `continues ${idU}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idU, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSigns };
    const make = extra => {
      setCache({ invalidate() {}, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-unanchored', log: () => {}, config: { name: 'fixture-s18-unanchored', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
        seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } } });
    };
    const ask = await make({}).then(() => null, e => e);
    const reasons = { failure: `${idU}: the build can leave it.`, late: `${LATE}: I agree the defect holds.`, both: `${idU} and ${LATE}: both.`, none: 'The build can do it.' }[names];
    const second = await make({ 'build-check-1': answer('good_to_build', reasons) }).then(result => ({ result }), error => ({ error }));
    return { ask, askUser: ask?.user || '', topUser: prompts.get('panel-3-top')?.user || '', second };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('T18j: an unanchored failure rated 5.0 that layer 3 sorts must-do is recorded as ONE late finding with the seat\'s rating, linked to the failure\'s id, and the check lists it', async () => {
  const d = await run({ rate: 5, names: 'late' });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the first run waits at the build check (${String(d.ask)})`);
  assert.match(d.askUser, new RegExp(`- ${LATE} \\(found by top; rated 5\\.0`), 'T18j: the check lists the late finding with layer 3\'s rating');
  assert.equal(d.second.error, undefined, `premise: the run ends (${String(d.second.error)})`);
  const rows = d.second.result.lateFindings || [];
  assert.deepEqual(rows.map(l => [l.id, l.linked_to, l.rating, l.found, l.sorted?.sort]), [[LATE, idU, 5, 'last_verdict', 'must_do']], 'T18j: one late finding, linked to the failure, rated by the seat, sorted must-do');
});

test('T18s: the failure\'s own id stays open, flagged unanchored, and keeps layer 3\'s sorting as a record only: the check line says so and the sorting row is kept', async () => {
  const d = await run({ rate: 5, names: 'late' });
  assert.ok(d.ask instanceof ExternalPause, `premise: the first run waits at the build check (${String(d.ask)})`);
  assert.match(d.topUser, new RegExp(`${idU}[^\\n]*unanchored`), 'T18s: layer 3 was shown the failure flagged unanchored');
  assert.match(d.askUser, new RegExp(`- ${idU} \\([^)]*sorting recorded only: its must-do is the late finding ${LATE}\\)`), 'T18s: the failure is still on the check, its sorting recorded only');
  assert.equal(d.second.error, undefined, `premise: the run ends (${String(d.second.error)})`);
  assert.ok((d.second.result.severityRun?.open || []).some(o => o.id === idU), 'T18s: the failure\'s id is still open at the end');
  const sorted = (d.second.result.finalRead?.reused || []).flatMap(e => e.sorting || []).find(r => r.id === idU);
  assert.deepEqual([sorted?.sort, sorted?.rating], ['must_do', 5], 'T18s: layer 3\'s sorting row of the failure is kept (the ranking half of T12m), with the seat\'s rating');
});

test('T18t: the check names the ground once, by either id: the failure\'s id is the one required, and an answer that names only the late finding is accepted', async () => {
  const NAMES = 'late';   // which id of the pair the handler's reasons name
  const d = await run({ rate: 5, names: NAMES });
  assert.ok(d.ask instanceof ExternalPause && d.askUser.includes(LATE), `premise: the check lists the late finding (${String(d.ask)})`);
  assert.equal(d.second.error, undefined, `T18t: an answer naming only one id of the pair is accepted (${String(d.second.error)})`);
  assert.deepEqual(d.second.result.buildChecks[0].required, [idU], 'T18t: the pair is required once (not both ids)');
});

test('T18u, T18r: while the unanchored failure stands, its judge is not counted as signed off: the raiser\'s layer is objected in the pass that raised it', async () => {
  const RATE = 5;
  const d = await run({ rate: RATE, names: 'both' });
  assert.equal(d.second.error, undefined, `premise: the run ends (${String(d.second.error)})`);
  const layers = d.second.result.layers || [];
  assert.equal(layers.find(l => l.round === 1 && l.layer === 1)?.state, 'objected', 'T18u, T18r: the failure\'s judge is objected, not signed');
  assert.equal((d.second.result.panelVerdicts || []).find(v => v.round === 1 && v.lab === 'raiser')?.verdict, 'objected', 'its verdict row says objected');
});
