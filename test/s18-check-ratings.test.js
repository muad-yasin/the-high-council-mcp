// 0.8.4 S18 (the build check with ratings; FEATURE_SPECS Q15(a), D34, RU-S18-01): WHOLE-RUN row T21y and the pure row T21cc. Offline, mock seats, $0. The build check's words and the rating/sorting words are HELD: they are injected here with setHeldForTest
// (as shipped buildCheckLive() is false and none of this is reachable). T21y is the fixture of T17ag (test/helpers/s8-handler-rows.js, itself C3-23 of test/s8-closure.test.js) with the rated-5 block Yo sorted may-leave by layer 3, COPIED here
// with the block's rating and the handler's answer as inputs (no *.test.js file is imported, and the helper is not changed). Written without a run (no tests on the laptop). The reds are swapped-input variants (S18_SWAPS.json): the same block with
// ONE input changed and every assert line byte-identical.
// Declared: the "names every late-finding id" half of T21y/T21cc has no input before the late findings are in the check (T15n, a later commit of this unit).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { buildCheckDemanded } from '../src/sorting.js';
import { createSeverityRun } from '../src/severity.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';

afterEach(() => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const HESC_INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };

// rate: the rating the raiser gives the block Yo (layer 3 sorts it may-leave); reasons: the handler's reply to the build check
async function run({ rate, reasons }) {
  const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
  const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: rate };
  const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
  const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);
  const prompts = new Map(); const invalidated = [];
  try {
    setHeldForTest({ ...HESC_INJECT, ...DEMAND, ...SORTING, relationRule: HB084.relationRule, ...CHECK });
    setPromptSpy(p => { prompts.set(p.label, p); });
    const rel = (f, relation) => ({ ...f, relation });
    const topSorted = JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', sorting: [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: 'may_leave', reason: 'Minor for the build.' }] });
    const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted };
    const make = extra => {
      setCache({ invalidate: (l, why, kind, data) => { invalidated.push([l, why, kind, data]); }, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-ratings', log: () => {}, config: { name: 'fixture-s18-ratings', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
        seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } } });
    };
    const ask = await make({}).then(() => null, e => e);
    const second = await make({ 'build-check-1': answer('good_to_build', reasons({ idX, idYo })) }).then(result => ({ result }), error => ({ error }));
    return { ask, askUser: ask?.user, topUser: prompts.get('panel-3-top')?.user || '', idX, idYo, second, invalidated };
  } finally { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); }
}

test('T21y: a good_to_build that omits one open objection rated 5.0 that layer 3 sorted may-leave counts as no answer: the answer is set aside and the run waits at the build check', async () => {
  const RATE = 5;
  const d = await run({ rate: RATE, reasons: ({ idX }) => `${idX}: the build can leave it.` });
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `premise: the first run waits at the build check (${String(d.ask)})`);
  assert.ok(d.topUser.includes(d.idYo), 'premise: the top seat was shown the block at its climb verdict (else its sorting of it is ignored and the fixture, not the code, decides)');
  assert.match(d.askUser, new RegExp(`- ${d.idYo} \\(raised in layer 1; rated ${RATE.toFixed(1)}; (?:[^;)]+; )*sorted by layer 3: may-leave\\)`), 'premise: the build check shows the block with its rating, sorted may-leave by layer 3');
  assert.ok(d.second.error instanceof ExternalPause && d.second.error.label === 'build-check-1', `T21y: the answer that omits the block is no answer: the run waits at the build check again (${d.second.error ? String(d.second.error) : 'the run ended: ' + d.second.result?.ending?.kind})`);
  assert.deepEqual(d.invalidated.filter(x => x[2] === 'build_check_refused').map(x => x[0]), ['build-check-1'], 'T21y: the refusal is recorded as a refused build check answer');
  assert.ok(d.invalidated.some(x => x[2] === 'build_check_refused' && x[1].includes(`does not name ${d.idYo}`)), 'T21y: the refusal names the omitted block');
  const row = d.invalidated.find(x => x[2] === 'build_check_refused')?.[3];
  assert.deepEqual([row?.n, row?.label, row?.why, row?.missing, row?.required.includes(d.idYo)], [1, 'build-check-1', 'ids_missing', [d.idYo], true], 'RU-S18-02: the refusal is a row (check, why, the ids it did not name, the ids it had to name)');
});

test('T21cc (pure): an open objection with NO rating that layer 3 sorted may-leave is demanded by the check (the may-leave exemption closes only a block rated below 4, never 7 or above); the whole-run input is declared unreachable (chain.js normaliseCritique makes an unrated failure an unreadable verdict while the rating demand is on)', () => {
  const RATED = null;   // the rating the block stands at (null: not rated)
  const items = [{ id: 'O-aaaaaaaa', lab: 'raiser', sorted: { sort: 'may_leave', reasons: [] }, ...(RATED === null ? {} : { severity: RATED }) }];
  const sev = createSeverityRun();
  assert.deepEqual(buildCheckDemanded(items, i => !!sev.closesOnOverrule(i.lab, i.id, typeof i.severity === 'number' ? i.severity : null)), ['O-aaaaaaaa'], 'T21cc: the unrated may-leave block is demanded');
});
