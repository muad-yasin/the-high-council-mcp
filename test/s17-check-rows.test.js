// 0.8.4 S17 (Q8, D33, N23, N25; FEATURE_SPECS l.1646-1647, l.1688, l.1694): what a rating does to the handler's check. T21bd: an open objection of a lower seat rated 3.0 that layer 3 sorted may-leave does not hold the ending (the handler's good_to_build need not name it). T21w: a block rated 3.0 by its own seat that layer 3 sorts MUST-DO is named in the handler's
// check and keeps 3.0, and layer 3's sign-off stands: no new round. T21ag: a block rated 8.0 that layer 3 sorts must-do and a not_yet of the handler's check that names it: the block keeps 8.0 and stays open, and the plan restarts at layer 1 in a new round.
// T21bd and T21w copy the fixture of C3-23 (test/s8-closure.test.js, the build check in a run) and T21ag copies runT13u (test/helpers/s8-record-rows.js) with the rating and the sorting as inputs; neither helper is changed. The sorting here is the one layer 3 gives at its CLIMB verdict: the check runs before the final read in the code
// (src/chain.js, askBuildCheck at the agreement point), a named gap that moves to S18 with T15a and T17f (C&C 09 Nov). Offline, $0; held words injected (as shipped they are held). Written without a run; reds are swapped-input variants (S17_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { CRITERION } from './helpers/layer-two-run.js';
import { checkT17i } from './helpers/s8-record-rows.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const DRAFT = 'The worker retries failed requests.';
const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const row = v => ({ criterion: CRITERION, verdict: v, evidence: 'Section two.' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const rel = (f, relation) => ({ ...f, relation });
const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });

// ---- T21bd, T21w: the fixture of C3-23 ----
const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);

// sortZ: what layer 3 sorts the rated-3 objection Z at its climb verdict; named: the ids the handler's answer names; word: the handler's answer (a not_yet sends the plan back, so build-check-2 is scripted too: the green runs never ask for it)
async function check({ sortZ, named, word = 'good_to_build' }) {
  setHeldForTest({ escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection, ...DEMAND, ...SORTING, relationRule: HB084.relationRule, ...CHECK });
  const prompts = new Map(); setPromptSpy(p => { prompts.set(p.label, p); });
  let served = [];
  const topSorted = JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok', sorting: [{ id: idZ, sort: sortZ, reason: 'Loose wording only.', ...(sortZ === 'must_do' ? { criterion: CRITERION } : {}) }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: 'must_do', reason: 'No owner.', criterion: CRITERION }] });
  const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted };
  const make = extra => {
    served = [];
    setCache({ invalidate() {}, get(label) {
      served.push(label);
      const all = { ...script, ...extra };
      if (label in all) return hit(all[label]);
      if (label.startsWith('build-check-')) return null;
      return hit(label.startsWith('panel-') ? JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' }) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
    } });
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
    return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s17-check', log: () => {}, config: { name: 'fixture-s17-check', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
      seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seat) } } });
  };
  const ask = await make({}).then(() => null, e => e);
  const served1 = served;
  const out = { ask, served1, prompts };
  const reasons = `${named.map(i => i === 'X' ? idX : i === 'Y' ? idYo : idZ).join(', ')}: the build can leave these, section two covers them.`;
  try { out.result = await make({ 'build-check-1': answer(word, reasons), 'build-check-2': answer('good_to_build', reasons) }); } catch (e) { out.error = e; }
  out.served = served;   // the labels of the second run, whether or not it ended
  return out;
}
const listed = (ask, id, sorted) => new RegExp(`- ${id} \\(raised in layer 1; rated 3\\.0; sorted by layer 3: ${sorted}\\)`).test(ask?.user || '');

test('T21bd: an open objection of a lower seat rated 3.0 that layer 3 sorted may-leave does not hold the ending: the handler\'s good_to_build need not name it, and it is accepted', async () => {
  const SORT_Z = 'may_leave';
  const d = await check({ sortZ: SORT_Z, named: ['X', 'Y'] });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the run waits at the build check: ${String(d.ask)}`);
  assert.ok((d.prompts.get('panel-3-top')?.user || '').includes(idZ), 'premise: the top seat was shown the rated-3 objection at its climb verdict');
  assert.equal(d.result?.buildChecks?.[0]?.answer, 'good_to_build', `the handler's good_to_build, which does not name the rated-3 objection, is accepted (${String(d.error)})`);
  assert.deepEqual(d.result?.buildChecks?.[0]?.required, [idX, idYo].sort(), 'the rated-3 may-leave one is not demanded; the two that hold are');
});

test('T21w: a block that its own seat rated 3.0 and that layer 3 sorts must-do is named in the handler\'s check, keeps 3.0, and layer 3\'s sign-off stands: no revision and no new round follow it', async () => {
  const SORT_Z = 'must_do';
  const WORD = 'good_to_build';   // the handler's answer
  const d = await check({ sortZ: SORT_Z, named: ['X', 'Y', 'Z'], word: WORD });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the run waits at the build check: ${String(d.ask)}`);
  assert.ok((d.prompts.get('panel-3-top')?.user || '').includes(idZ), 'premise: the top seat was shown the rated-3 objection at its climb verdict');
  assert.equal(listed(d.ask, idZ, 'must-do'), true, 'named in the handler\'s check, rated 3.0, sorted must-do: it keeps its rating');
  checkT17i(d.served1, d.served);   // no revision between layer 3 and the check, none after good_to_build, no pass 4
  assert.deepEqual(d.result?.buildChecks?.[0]?.required, [idX, idYo, idZ].sort(), `the rated-3 must-do one is demanded with the two that hold (${String(d.error)})`);
});

// ---- T21ag: runT13u ----
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
const idY = objectionId('mid-beta', Y);
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const W41 = { layerThreeReasonsSection: HB084.layerThreeReasonsSection };

test('T21ag: a block rated 8.0 that layer 3 sorts must-do at its sign-off, and a not_yet of the handler\'s check that names it: the block keeps 8.0 and stays open, and the plan restarts at layer 1 in a new round', async () => {
  const RATE = 8;
  const RETAGS = [];   // what the person's handler re-tags in the new round; none
  const served = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, p));
  setHeldForTest({ ...SORTING, ...W41, ...CHECK });
  const sorting = [{ id: idY, sort: 'must_do', reason: 'No owner is named in section two.', criterion: CRITERION }];
  const script = {
    'panel-1-mid-beta': objects({ ...Y, severity: RATE, relation: 'new' }), 'panel-2-mid-beta': objects({ ...Y, severity: RATE, relation: `continues ${idY}` }),   // K1, K2: relationRule is recorded
    'panel-3-top-gamma': JSON.stringify({ ...JSON.parse(meets()), sorting }),
    'build-check-1': answer('not_yet', `${idY}: Name the owner of the worker before building.`), 'build-check-2': answer('good_to_build'),
    'panel-4-mid-beta': JSON.stringify({ ...JSON.parse(meets()), answers: [{ id: idY, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] }),
  };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return hit(script[label]);
    if (label.startsWith('build-check-')) return null;
    return hit(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
  } });
  const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
  const config = { name: 'fixture-s17-ag', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: SESSION, reviser: SESSION, critics: [['raiser-alpha', 1], ['mid-beta', 2], ['top-gamma', 3]].map(seat) } };
  let result = null; let err = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s17-ag', log: () => {}, config, ...(RETAGS.length ? { retags: RETAGS } : {}) }); } catch (e) { err = e; }
  assert.ok((prompts.get('panel-3-top-gamma')?.user || '').includes(`- ${idY} (raised in layer 2; rated ${RATE}.0`), `premise: layer 3 was shown the rated block to sort (the run ended with: ${String(err)})`);
  assert.deepEqual([result?.buildChecks?.[0]?.answer, result?.buildChecks?.[0]?.required?.includes(idY)], ['not_yet', true], 'the handler\'s check named the block and answered not_yet');
  const at = label => served.indexOf(label);
  assert.ok(at('build-check-1') >= 0 && at('panel-4-raiser-alpha') > at('build-check-1'), 'the not_yet sends the plan back: layer 1 is asked again in pass 4, after the check');
  assert.ok(served.includes('panel-4-mid-beta') && (prompts.get('panel-4-mid-beta')?.user || '').includes(idY), 'and the block is still open in its seat\'s next review');
  assert.deepEqual([(result?.severityRun?.retags || []).length, (result?.severityRun?.withdrawn || []).find(w => w.id === idY)?.severity], [0, RATE], 'the block kept 8.0: nothing re-rated it, and it left only by the seat\'s own fix');
});
