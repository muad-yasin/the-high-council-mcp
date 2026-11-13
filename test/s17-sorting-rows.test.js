// 0.8.4 S17 (Q8 item 5, D33; FEATURE_SPECS l.1686): a block rated 5.0 that BOTH layer-3 seats overrule (sort may-leave at their sign-off) makes no call, stays open on the record under its seat's name with its rating and layer 3's reasons beside it (a dissent), and the ending is not held up.
// The fixture is runT15h (test/helpers/s8-end-rows.js, the finished T15h: a rated-5 block Yo sorted may-leave at the climb verdict, the handler's good_to_build naming it), COPIED with a second layer-3 seat (the helper is not changed). The overrule needs EVERY layer-3 seat heard in the round
// to sort the block may-leave (src/chain.js climbMayLeaves), and every seat's reply must carry a sorting. Offline, $0; held words injected (as shipped they are held). Written without a run; the red is a swapped-input variant (S17_SWAPS.json).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import { CRITERION } from './helpers/layer-two-run.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);
const rel = (f, relation) => ({ ...f, relation });

// sortYoB: what the second layer-3 seat (top-b) sorts the block Yo; the first seat (top-a) always sorts it may-leave
async function run({ sortYoB }) {
  const prompts = new Map(); const served = [];
  setHeldForTest({ escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection, ...DEMAND, ...SORTING, relationRule: HB084.relationRule, ...CHECK, dissentRecordSection: () => '' });
  setPromptSpy(p => { prompts.set(p.label, p); });
  const sortedBy = sortYo => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', sorting: [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: sortYo, reason: 'Minor for the build.', ...(sortYo === 'must_do' ? { criterion: CRITERION } : {}) }] });
  const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }),
    'panel-3-top-a': sortedBy('may_leave'), 'panel-3-top-b': sortedBy(sortYoB),
    'final-read-top-a': sortedBy('may_leave'), 'final-read-top-b': sortedBy(sortYoB) };   // only read if the final read asks a top seat (the pin below expects it does not); a readable reply keeps a fixture surprise from reading as a failed read
  const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
  const config = { name: 'fixture-s17-two-top', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
    seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top-a', 3], ['top-b', 3]].map(seatOf) } };
  const make = extra => {
    setCache({ invalidate() {}, get(label) {
      served.push(label);
      const all = { ...script, ...extra };
      if (label in all) return OK(all[label]);
      if (label.startsWith('build-check-')) return null;
      return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
    } });
    return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s17-two-top', log: () => {}, config });
  };
  const out = { served, prompts };
  out.ask = await make({}).then(() => null, e => e);
  try {
    out.result = await make({ 'build-check-1': answer('good_to_build', `${idX} and ${idYo}: the build can leave both, section two covers them.`) });
    out.report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-s17-two-top', chain: 'fixture-s17-two-top', task: 't.md', result: out.result, config })));
  } catch (e) { out.error = e; }
  return out;
}

test('T21u: a block rated 5.0 that both layer-3 seats sort may-leave at their sign-off: no call is made for it, it is open on the record under its seat\'s name with its rating and the reasons of BOTH layer-3 seats beside it, and the ending is agreed (not held up)', async () => {
  const SORT_YO_B = 'may_leave';
  const d = await run({ sortYoB: SORT_YO_B });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the first run waits at the build check (${String(d.ask)})`);
  assert.equal(d.error, undefined, `premise: the handler's good_to_build is accepted and the run ends (${String(d.error?.stack || d.error)})`);
  assert.ok((d.prompts.get('panel-3-top-a')?.user || '').includes(idYo), 'premise: the first top seat was shown the block to sort at its climb verdict');
  assert.deepEqual((d.report?.dissents || []).map(x => x.id), [idYo], 'the block is on the record as a dissent, and it is the only one');
  const dis = d.report?.dissents?.[0];
  assert.deepEqual([dis?.lab, dis?.status, dis?.rating?.in_force, dis?.ruling?.source, dis?.ruling?.layer], ['raiser', 'open', 5, 'sorting', 3], 'the seat\'s, open, rated 5, from layer 3\'s sorting');
  assert.deepEqual((dis?.ruling?.reasons || []).map(x => x.lab).sort(), ['top-a', 'top-b'], 'both layer-3 seats\' reasons are beside it');
  assert.equal(d.report?.ending?.kind, 'agreed', 'the ending is not held up: it is agreed');
  assert.deepEqual(d.served.filter(l => l.startsWith('final-read-') || /^rule-\d+-top-/.test(l)), [], 'PIN (no input produces such a call): no call for the overrule, no ruling call and no final-read call beyond the go-up ruling of the fixture');
});
