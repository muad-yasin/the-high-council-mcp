// 0.8.4 S8 (M3), the four handler/closing rows T15p, T17o, T17g and T17ag. Offline, mock seats, $0. Each row is `run<ROW>(variant = false)` (builds and runs the fixture and returns plain DATA, never throws, resets every global it sets)
// and `check<ROW>(data)` (ALL the assertions, premises first, then the targets; every assertion has its own message). The committed test (test/s8-handler-rows.test.js) runs `check(await run())`; the red-only file
// (test/s8-handler-rows-red.test.js, never committed) runs the SAME check on `run(true)`, the row's SWAPPED INPUT, so the box shows the failing assertion's message. T17o and T17g are NAMED PINS: no input makes their event happen, they have no variant.
// Every fixture piece is copied from the file named next to it (no *.test.js file is imported: that would run its tests).
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../../src/chain.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { objectionId } from '../../src/objection-ids.js';
import { topSeatsOf } from '../../src/final-read.js';
import { isAgreed } from '../../src/ending.js';
import { DEMAND, SORTING } from './rating-demand.js';
import { CHECK, answer } from './build-check.js';
import * as HB084 from '../held-prompts/held-084-b.js';
import * as HESC from '../held-prompts/held-escalation.js';

const CRITERION = 'The plan defines a retry limit.';   // test/build-check.test.js:28, test/m1-layer1-go-up.test.js:35, test/s8-closure.test.js (SC_CRITERION = helpers/layer-two-run.js CRITERION)
const DRAFT = 'The worker retries failed requests.';
const resetGlobals = () => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); };
const OK = (text, extra = {}) => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, ...extra });
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (extra = {}) => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', ...extra });   // test/build-check.test.js:30
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });   // test/build-check.test.js:31
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });   // test/build-check.test.js:45
const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };   // test/build-check.test.js:32 (the handling session)

// ============================================================================================================================================================================
// T15p (CA4): layer 3 signs off after an escalated sign-off and the handler answers good_to_build; no lower layer is asked to read or sign the final text.
// Fixture: test/build-check.test.js:204 `stalled()` over `run()` :33-50, with final_read ON. VARIANT (swapped input): the handler answers not_yet (test/build-check.test.js:220 T15b's script), so the plan goes back
// and layer 1 IS asked again after layer 3's sign-off (panel-4-raiser-alpha).
// ============================================================================================================================================================================
const LOW = 'raiser-alpha';
const X1 = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 8 };   // test/build-check.test.js:198
const idX1 = objectionId(LOW, X1);
const STALL = { 'panel-1-raiser-alpha': objects({ ...X1, relation: 'new' }), 'panel-2-raiser-alpha': objects({ ...X1, relation: `continues ${idX1}` }), 'rule-3-mid-beta': JSON.stringify({ rulings: [{ id: idX1, ruling: 'overrule', reason: 'Section two sets the limit.' }] }) };   // :199
const alphaWithdrawsX1 = JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', answers: [{ id: idX1, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });   // :219
const HELD_BC = { ...DEMAND, relationRule: HB084.relationRule, escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };   // :23

export async function runT15p(variant = false) {
  const served = []; const critics = [[LOW, 1], ['mid-beta', 2], ['top-gamma', 3]].map(seatOf);
  const script = { ...STALL, ...(variant
    ? { 'build-check-1': answer('not_yet', `Layer 1 is right about ${idX1}: state the limit.`), 'panel-4-raiser-alpha': alphaWithdrawsX1, 'build-check-2': answer('good_to_build', `${idX1}: left to the build.`) }   // :221 (T15b)
    : { 'build-check-1': answer('good_to_build', `${idX1} was overruled by layer 2; the build can leave it.`) }) };   // :206
  const out = { served, critics, variant };
  try {
    setHeldForTest({ ...HELD_BC, ...CHECK });
    setCache({ invalidate: () => {}, get(label) {   // :37-44
      served.push(label);
      if (label in script) return script[label] === null ? null : OK(script[label]);
      if (label.startsWith('build-check-')) return null;
      return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
    } });
    const config = { name: 'fixture-t15p', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds: 6, dispute: { enabled: true, stall_rounds: 2 }, final_read: { enabled: true }, seats: { builder: SESSION, reviser: SESSION, critics } };   // :46, :204
    try { out.result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t15p', log: () => {}, config }); } catch (e) { out.error = e; }
  } finally { resetGlobals(); }
  return out;
}

export function checkT15p(d) {
  // premises: what the fixture must have done before the thing under test
  assert.equal(d.error, undefined, `T15p premise: the run ends without an error or a pause (${String(d.error?.stack || d.error)})`);
  assert.ok(d.served.includes('rule-3-mid-beta') && d.served.includes('panel-3-top-gamma'), 'T15p premise: layer 2 ruled in pass 3 and layer 3 gave its verdict in pass 3 (the escalated route was walked)');
  assert.equal(d.result.buildChecks?.[0]?.kind, 'escalated', 'T15p premise: the first build check was asked at an ESCALATED sign-off');
  assert.ok(d.result.finalRead && typeof d.result.finalRead === 'object', 'T15p premise: final_read was on, the result carries a finalRead record');
  // targets: no lower layer is asked or reads/signs after layer 3's sign-off
  const after = d.served.slice(d.served.indexOf('panel-3-top-gamma') + 1);
  assert.deepEqual(after.filter(l => /raiser-alpha|mid-beta/.test(l)), [], 'T15p: no layer-1 or layer-2 seat is asked anything after layer 3 signed off');
  assert.deepEqual(d.result.stages.map(s => s.label).filter(l => l.startsWith('final-read-') && !l.startsWith('final-read-top-gamma')), [], 'T15p: the final read asks no seat below the top layer');
  assert.deepEqual(topSeatsOf(d.critics).map(c => c.lab), ['top-gamma'], 'T15p (pin): the final read\'s seats are the top layer\'s seats only (src/final-read.js topSeatsOf)');
  // the shape of the ending
  assert.ok(d.result.escalated_signoff, 'T15p: the run ended at an escalated sign-off');
  assert.deepEqual(d.result.buildChecks.map(c => c.answer), ['good_to_build'], 'T15p: exactly one build check, answered good_to_build');
  assert.deepEqual([d.result.finalRead.ran, d.result.finalRead.reason], [false, 'every_top_seat_read_this_plan'], 'T15p: the final read made no call (layer 3 had read exactly this text)');
  assert.equal(d.result.ending?.kind, 'agreed', 'T15p: the ending is agreed');
  assert.equal(isAgreed(d.result), true, 'T15p: the shared agreement predicate says agreed');
}

// ============================================================================================================================================================================
// T17ag (Q8): layer 3 sorts a block rated 5.0 may-leave; the ending is not held up: the handler's good_to_build that NAMES the block ends the run agreed.
// Fixture: test/s8-closure.test.js:374-408 (C3-23) with ONE change: the rated-5 objection Yo is sorted may_leave (C3-23 :384 sorts it must_do). VARIANT (swapped input): the handler's good_to_build skips the id Yo,
// so judgeBuildCheck refuses it (src/build-check.js judgeBuildCheck, chain.js:4601-4615) and the run stays held at build-check-1.
// ============================================================================================================================================================================
export async function runT17ag(variant = false) {
  const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };   // C3-23 :375-377
  const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
  const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
  const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);
  const prompts = new Map(); const invalidated = [];
  const out = { idX, idYo, idZ, variant, invalidated };
  try {
    setHeldForTest({ ...HESC_INJECT(), ...DEMAND, ...SORTING, relationRule: HB084.relationRule, ...CHECK });   // C3-23 :379
    setPromptSpy(p => { prompts.set(p.label, p); });
    const rel = (f, relation) => ({ ...f, relation });
    const topSorted = JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', sorting: [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: 'may_leave', reason: 'Minor for the build.' }] });   // C3-23 :384 with Yo may_leave
    const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted };   // C3-23 :385
    const make = extra => {   // C3-23 :386-397
      setCache({ invalidate: (l, why, kind) => { invalidated.push([l, why, kind]); }, get(label) {
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t17ag', log: () => {}, config: { name: 'fixture-t17ag', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
        seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } } });
    };
    out.ask = await make({}).then(() => null, e => e);
    out.askUser = out.ask?.user;
    out.topUser = prompts.get('panel-3-top')?.user || '';
    const reply = variant ? answer('good_to_build', `${idX}: the build can leave it.`) : answer('good_to_build', `${idX} and ${idYo}: the build can leave both, section two covers them.`);
    out.second = await make({ 'build-check-1': reply }).then(result => ({ result }), error => ({ error }));
  } finally { resetGlobals(); }
  return out;
}
const HESC_INJECT = () => ({ escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection });   // C3-23 :267

export function checkT17ag(d) {
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', `T17ag premise: the first run waits at the build check (${String(d.ask)})`);
  assert.ok(d.topUser.includes(d.idYo), 'T17ag premise: the top seat was shown the rated-5 objection at its climb verdict (else its sorting of it is ignored and the fixture, not the code, decides)');
  assert.match(d.askUser, new RegExp(`- ${d.idYo} \\(raised in layer 1; rated 5\\.0; (?:[^;)]+; )*sorted by layer 3: may-leave\\): .*Layer 3's reason: top: <critic-claim>Minor for the build\\.</critic-claim>`), 'T17ag premise: the build check shows the rated-5 block as sorted may-leave by layer 3, with the reason');
  assert.match(d.askUser, new RegExp(`- ${d.idX} \\(raised in layer 1; rated 5\\.0; sorted by layer 3: must-do\\)`), 'T17ag premise: the must-do block is on the build check as sorted must-do');
  // targets
  assert.equal(d.second.error, undefined, 'T17ag: the handler\'s good_to_build that names the rated-5 may-leave block is accepted: the run is not held at the build check');
  assert.deepEqual(d.second.result.buildChecks[0].required, [d.idX, d.idYo].sort(), 'T17ag: the build check demands the rated-5 may-leave block by id (and the must-do one), not the rated-3 closable one');
  assert.ok(d.second.result.escalated_signoff, 'T17ag: the run ended at an escalated sign-off');
  assert.equal(d.second.result.ending?.kind, 'agreed', 'T17ag: the ending is agreed (the may-leave sorting does not hold it up)');
  assert.equal(d.second.result.ending.handler_check, 'good_to_build', 'T17ag: the ending rests on the handler\'s good_to_build');
  assert.equal(isAgreed(d.second.result), true, 'T17ag: the shared agreement predicate says agreed');
}

// ============================================================================================================================================================================
// T17o (Q8, Q2): an N5 send-up of an objection rated 5.0, overruled at layer 2, then layer 3 signs the unrevised plan: the objection stays open on the record, layer 3 sorts it at the final read, and its seat is not called
// at the sign-off. NAMED PIN (no input makes the event happen; no variant). FAIL CONDITION: fails when a label naming raiser-alpha is served after layer 3's pass-3 verdict, or the objection is closed/unsorted on the record.
// Fixture: test/m1-layer1-go-up.test.js `run()` :46-61 and GL-9 :145, with final_read ON and the S8 words in force.
// ============================================================================================================================================================================
const GX = { criterion: CRITERION, problem: 'No retry limit is stated.', quote: 'The worker', severity: 5 };   // m1-layer1-go-up.test.js:36 (X)
const idGX = objectionId('raiser-alpha', GX);

export async function runT17o(variant = false) {
  const served = []; const prompts = new Map(); const out = { served, prompts, idX: idGX, variant };
  try {
    setHeldForTest({ layerOneGoUpLine: HB084.layerOneGoUpLine, ...DEMAND, ...SORTING });   // GO_UP_LINE (:44) + SORTING
    setPromptSpy(p => prompts.set(p.label, p));
    const script = { 'panel-1-raiser-alpha': objects({ ...GX, relation: 'new' }), 'panel-2-raiser-alpha': objects({ ...GX, relation: `continues ${idGX}` }),   // BOUND :45
      'rule-3-mid-beta': JSON.stringify({ rulings: [{ id: idGX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }),   // GL-9 :146
      'final-read-top-gamma': meets({   // reply shape: test/s8-sorting.test.js:110 metWith; ids from the list the seat is shown
         sorting: [{ id: idGX, sort: 'may_leave', reason: 'Minor for the build.' }] }) };
    setCache({ invalidate() {}, get(label) {   // :50-54
      served.push(label);
      return OK(label in script ? script[label] : label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
    } });
    const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
    const config = { name: 'fixture-t17o', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, final_read: { enabled: true }, maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 },
      seats: { builder, reviser: builder, critics: [['raiser-alpha', 1], ['mid-beta', 2], ['top-gamma', 3]].map(seatOf) } };
    try { out.result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t17o', log: () => {}, config }); } catch (e) { out.error = e; }
  } finally { resetGlobals(); }
  return out;
}

export function checkT17o(d) {
  assert.equal(d.error, undefined, `T17o premise: the run ends without an error (${String(d.error?.stack || d.error)})`);
  const e = d.result.escalations?.[0];
  assert.deepEqual([e?.trigger, (e?.outcome || []).map(o => [o.id, o.result])], ['layer1_bound', [[d.idX, 'overruled']]], 'T17o premise: the N5 send-up of the objection was overruled at layer 2');
  assert.ok(d.served.includes('rule-3-mid-beta') && !d.served.includes('panel-3-raiser-alpha'), 'T17o premise: layer 2 ruled in pass 3 and layer 1 was not asked in the go-up pass');
  assert.ok((d.prompts.get('panel-3-top-gamma')?.user || '').includes(d.idX), 'T17o premise: layer 3 was shown the sent-up objection at its verdict (else its sorting of it is ignored)');
  assert.ok(d.result.escalated_signoff, 'T17o premise: layer 3 signed the plan at the go-up pass (an escalated sign-off)');
  assert.equal(d.result.finalRead?.ran, true, 'T17o premise: the final read ran (the dispute stage changed the text, so layer 3 read it again)');
  assert.ok(d.result.stages.some(s => s.label === 'final-read-top-gamma'), 'T17o premise: the final read asked the top seat');
  // targets
  const entry = (d.result.dispute?.open_objections || []).find(o => o.id === d.idX);
  assert.ok(entry, 'T17o: the objection stays open on the record (dispute.open_objections holds it)');
  assert.equal(entry.closed_by, undefined, 'T17o: the objection is not closed by the sorting (rated 5.0, may-leave does not close it)');
  const top = d.result.finalRead.seats.find(s => s.lab === 'top-gamma');
  assert.equal(top?.read, true, 'T17o premise: the scripted final-read reply of the top seat was read (read true), so a missing sorting is not a fixture miss');
  assert.deepEqual((top?.sorting || []).map(x => [x.id, x.sort]), [[d.idX, 'may_leave']], 'T17o: layer 3\'s sorting of the objection is recorded at the final read');
  const after = d.served.slice(d.served.indexOf('panel-3-top-gamma') + 1);
  assert.deepEqual(after.filter(l => /raiser-alpha/.test(l)), [], 'T17o: the sent-up seat is not called at or after layer 3\'s sign-off');
  assert.ok(!d.served.includes('panel-4-raiser-alpha'), 'T17o: the sent-up seat gets no next review (the run ended at the sign-off)');
}

// ============================================================================================================================================================================
// T17g (Q8): an open objection of a lower seat that was DEBATED in the layer exchange: no new exchange, no ruling call, only layer 3's sorting at the final read. NAMED PIN (no input makes an already-debated id debate again;
// no variant). FAIL CONDITION: fails when the debated id appears in the ending exchange's record or prompts, or an ending-exchange call or a rule- call is made in the row run.
// Fixture: test/ending-exchange.test.js `go` :22-29 and `FIX` :33 (round cap, maxRounds 1). The CONTROL run (an extra `new7` seat e3, whose objection IS not debated) makes the ending exchange run, so the row's empty list is not vacuous.
// ============================================================================================================================================================================
const PLAN = '# Plan\n\nThe worker retries failed requests at most three times. Bake a cake. Sell it at the fair.';   // test/ending-exchange.test.js:21
const MOCK_CRITERIA = ['The deliverable is the artifact itself, not a plan for one.', 'It states the assumptions it was written under.', 'It adds no scope the request did not ask for.'];   // src/providers.js:880-884 (mock-criteria)
const BAD = 'It states the assumptions it was written under.';   // src/providers.js:788 (`bad`)
let tagSeq = 0;   // the mock `alt` and `new7` counters live per model string for the whole process: a fresh tag per run

async function endingRun({ withE3 }) {
  const tag = `tg${++tagSeq}x`;
  const prompts = new Map(); const out = {};
  const sd = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
  const critics = [sd(`mock-exch-support-keep-${tag}`, 'e1', 1), sd(`mock-exch-alt-keep-${tag}-clean`, 'e2', 1), ...(withE3 ? [sd(`mock-exch-new7-keep-${tag}-clean`, 'e3', 1)] : []), sd('mock-critic-x', 'e9', 2), { ...sd('mock-review-fixture', 'l3a', 3), maxTokens: 3000 }];
  const scripted = { build: PLAN, ...(withE3 ? {} : { 'final-read-l3a': JSON.stringify({ meets: true, criteria: MOCK_CRITERIA.map(c => ({ criterion: c, verdict: 'MET', evidence: 'Section 1 states it.' })), failures: [], verdict_line: 'ok', sorting: [{ id: objectionId('e1', { criterion: BAD }), sort: 'may_leave', reason: 'Minor.' }] }) }) };
  const config = { name: 'fixture-t17g', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, answer_back: { enabled: true }, ...(withE3 ? {} : { final_read: { enabled: true } }),
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } };   // ending-exchange.test.js:15-18 chainOf
  try {
    setHeldForTest({ ...SORTING, lateFindingRule: HB084.lateFindingRule, lastRoundReplyRule: HB084.lastRoundReplyRule });   // HELD = DEMAND + W26 (:13) and the S8 words
    setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
    setCache({ invalidate() {}, get: label => (label in scripted ? OK(scripted[label], { usage: { input: 30, output: 30 } }) : null) });   // :24
    try { out.r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-t17g', config }); } catch (e) { out.error = e; }
  } finally { resetGlobals(); }
  out.prompts = prompts;
  return out;
}

export async function runT17g(variant = false) {
  const ctrl = await endingRun({ withE3: true });
  const row = await endingRun({ withE3: false });
  return { ctrl, row, idE1: objectionId('e1', { criterion: BAD }), variant };
}

export function checkT17g(d) {
  const labels = r => r.stages.map(s => s.label);
  const endCalls = r => labels(r).filter(l => /^(ldebate|lreply)-end/.test(l));
  // premises: the control proves the ending exchange is live at this round cap, and the row's objection is a debated one
  assert.equal(d.ctrl.error, undefined, `T17g premise (control): the run ends without an error (${String(d.ctrl.error?.stack || d.ctrl.error)})`);
  assert.equal(d.row.error, undefined, `T17g premise: the row run ends without an error (${String(d.row.error?.stack || d.row.error)})`);
  assert.ok(endCalls(d.ctrl.r).length > 0, 'T17g premise (control): with a not-debated objection the ending exchange makes ldebate-end calls, so the gate is live at the round cap');
  const minted = d.ctrl.r.layerDebates?.[0]?.objections?.find(o => o.from_exchange && o.added_round === 3);
  assert.equal(minted?.raised_by, 'e3', 'T17g premise (control): e3 named a defect in the 7th round of the pass (not debated, carried)');
  assert.ok((d.ctrl.r.endingExchange?.objections || []).some(o => o.id === minted.id), 'T17g premise (control): the ending exchange debated e3\'s id');
  const e1 = d.row.r.layerDebates?.[0]?.objections?.find(o => o.raised_by === 'e1');
  assert.equal(e1?.id, d.idE1, 'T17g premise: layer 1\'s seat e1 raised the objection whose id this test computed');
  assert.notEqual(e1.outcome, 'not_debated', 'T17g premise: e1\'s objection was debated in the layer exchange of the pass');
  assert.equal(d.row.r.passed, false, 'T17g premise: the run ends not agreed at the round cap');
  assert.equal(d.row.r.finalRead?.ran, true, 'T17g premise: the closing read ran');
  // targets
  assert.ok(!(d.ctrl.r.endingExchange?.objections || []).some(o => o.id === d.idE1), 'T17g (control): the debated id is not in the ending exchange\'s record');
  assert.deepEqual([...d.ctrl.prompts].filter(([l, t]) => /^(ldebate|lreply)-end/.test(l) && t.includes(d.idE1)).map(([l]) => l), [], 'T17g (control): no ending-exchange prompt carries the debated id');
  assert.deepEqual(endCalls(d.row.r), [], 'T17g: no ending-exchange call is made for an already-debated objection');
  assert.equal(d.row.r.endingExchange, undefined, 'T17g: no ending exchange is recorded');
  assert.deepEqual(labels(d.row.r).filter(l => /^rule-/.test(l)), [], 'T17g: no ruling call is made');
  assert.deepEqual(labels(d.row.r).filter(l => l.startsWith('final-read-')), ['final-read-l3a'], 'T17g: the closing read asks layer 3\'s seat once');
  const l3 = d.row.r.finalRead.seats.find(s => s.lab === 'l3a');
  assert.equal(l3?.read, true, 'T17g premise: the scripted final-read reply of l3a was read (read true), so a missing sorting is not a fixture miss');
  assert.deepEqual((l3?.sorting || []).map(x => [x.id, x.sort]), [[d.idE1, 'may_leave']], 'T17g: layer 3\'s sorting of the debated objection is recorded');
}
