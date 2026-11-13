// 0.8.4 S8 (M3), the ending rows T15h, T17s and T17al. Offline, mock seats, $0. Each row is `run<ROW>(variant = false)` (builds and runs the fixture and returns plain DATA, never throws, resets every global it sets)
// and `check<ROW>(data)` (ALL the assertions, premises first, then the targets; every assertion has its own message). The committed test (test/s8-end-rows.test.js) runs `check(await run())`; the red-only file
// (test/s8-end-rows-red.test.js, never committed) runs the SAME check on `run(true)`, the row's SWAPPED INPUT, so the box shows the failing assertion's message.
// Every fixture piece is copied from the file named next to it (no *.test.js file is imported: that would run its tests).
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, ExternalPause } from '../../src/chain.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { objectionId } from '../../src/objection-ids.js';
import { isAgreed } from '../../src/ending.js';
import { reportJsonShape, renderBoardMd } from '../../src/report-shape.js';
import { verdictHeadline } from '../../src/verdict-headline.js';
import { DEMAND, SORTING } from './rating-demand.js';
import { CHECK, answer } from './build-check.js';
import * as HB084 from '../held-prompts/held-084-b.js';
import * as HESC from '../held-prompts/held-escalation.js';

const CRITERION = 'The plan defines a retry limit.';   // test/m1-dissent.test.js:33, test/s8-closure.test.js (SC_CRITERION), test/helpers/s8-handler-rows.js:16
const DRAFT = 'The worker retries failed requests.';   // test/m1-dissent.test.js:34
const resetGlobals = () => { setCache(null); setPromptSpy(null); setBudget(null); setHeldForTest(null); };
const OK = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });   // test/helpers/s8-handler-rows.js:19
const crow = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });   // test/helpers/s8-handler-rows.js:20
const meets = () => JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok' });   // test/helpers/s8-handler-rows.js:21
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [crow('FAILED')], failures: fs, verdict_line: 'no' });   // test/helpers/s8-handler-rows.js:22
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });   // test/helpers/s8-handler-rows.js:23

// ============================================================================================================================================================================
// T15h (CA4): an agreed ending after the final read, with a may-leave block (layer 3's sorting at its sign-off) recorded: the ending names its basis, so that it is distinguishable from a whole-panel sign-off.
// Fixture: test/helpers/s8-handler-rows.js runT17ag (:82-113, the finished T17ag: a rated-5 block Yo sorted may_leave at the climb verdict, the handler's good_to_build naming it) with TWO additions: `final_read: { enabled: true }` on the
// chain (as runT15p :52) and the held word `dissentRecordSection` (the stub of test/m1-dissent.test.js:48, `() => ''`; chain.js:6882 builds no dissent without a function there, and the basis mark needs one: ending.js:34).
// SWAPPED INPUT (variant): the same run WITHOUT `dissentRecordSection` in the held map (the pairing of test/m1-dissent.test.js DS-2 :101-108). Every premise holds in both runs (the sorting, the build check, the final read, the escalated sign-off are the
// same); only the dissent record, and with it the basis mark `dissent_on_record`, is missing.
// NOT REACHABLE (no variant for it): "the ending reads as a whole-panel sign-off". FAIL CONDITION of that half: fails when, for this run, `verdictHeadline(report).label` is 'PASSED' or the report's `passed` is true or `escalated_signoff` is absent. An escalated, handler-agreed end
// always carries passed false and the label 'AGREED' (src/verdict-headline.js:63-67 and :151-155), so no input of this fixture reads as a whole-panel sign-off; the assertions below pin that.
// ============================================================================================================================================================================
const HESC_INJECT = () => ({ escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection });   // test/helpers/s8-handler-rows.js:114

export async function runT15h(variant = false) {
  const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };   // test/helpers/s8-handler-rows.js:83
  const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
  const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
  const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);
  const prompts = new Map(); const served = [];
  const out = { idX, idYo, idZ, variant, served };
  try {
    setHeldForTest({ ...HESC_INJECT(), ...DEMAND, ...SORTING, relationRule: HB084.relationRule, ...CHECK, ...(variant ? {} : { dissentRecordSection: () => '' }) });
    setPromptSpy(p => { prompts.set(p.label, p); });
    const rel = (f, relation) => ({ ...f, relation });
    const sorting = [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: 'may_leave', reason: 'Minor for the build.' }];   // s8-handler-rows.js:93
    const topSorted = JSON.stringify({ meets: true, criteria: [crow('MET')], failures: [], verdict_line: 'ok', sorting });
    const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted,   // s8-handler-rows.js:94
      'final-read-top': topSorted };   // only read if the final read asks the top seat (the premise below expects it does not); a readable reply keeps a fixture surprise from reading as a failed read
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };   // s8-handler-rows.js:102
    const config = { name: 'fixture-t15h', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4, final_read: { enabled: true },
      seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seatOf) } };   // s8-handler-rows.js:103-104 + final_read (runT15p :52)
    const make = extra => {   // s8-handler-rows.js:95-105
      setCache({ invalidate() {}, get(label) {
        served.push(label);
        const all = { ...script, ...extra };
        if (label in all) return OK(all[label]);
        if (label.startsWith('build-check-')) return null;
        return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
      } });
      return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t15h', log: () => {}, config });
    };
    out.ask = await make({}).then(() => null, e => e);
    out.askUser = out.ask?.user;
    out.topUser = prompts.get('panel-3-top')?.user || '';
    try {
      out.result = await make({ 'build-check-1': answer('good_to_build', `${idX} and ${idYo}: the build can leave both, section two covers them.`) });   // s8-handler-rows.js:109
      out.report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-t15h', chain: 'fixture-t15h', task: 't.md', result: out.result, config })));   // test/m1-dissent.test.js:70
    } catch (e) { out.error = e; }
  } finally { resetGlobals(); }
  return out;
}

export function checkT15h(d) {
  // premises: true in the green run and in the swapped run
  assert.ok(d.ask instanceof ExternalPause && d.ask.label === 'build-check-1', 'T15h premise: the first run waits at the build check');
  assert.equal(d.error, undefined, `T15h premise: the handler's good_to_build is accepted and the run ends without an error (${String(d.error?.stack || d.error)})`);
  assert.ok(d.topUser.includes(d.idYo), 'T15h premise: the top seat was shown the rated-5 objection at its climb verdict (else its sorting of it is ignored and the fixture, not the code, decides)');
  const climb = (d.result.panelVerdicts || []).find(v => v.lab === 'top' && v.round === 3);
  assert.deepEqual((climb?.sorting || []).filter(x => x.id === d.idYo).map(x => x.sort), ['may_leave'], 'T15h premise: layer 3 sorted the rated-5 block may-leave at its climb verdict (round 3)');
  assert.deepEqual(d.result.buildChecks.map(c => [c.kind, c.answer]), [['escalated', 'good_to_build']], 'T15h premise: one build check, asked at the escalated sign-off and answered good_to_build');
  assert.ok(d.result.buildChecks[0].required.includes(d.idYo), 'T15h premise: the rated-5 may-leave block was open at the sign-off and the build check demanded it');
  assert.ok(d.result.escalated_signoff, 'T15h premise: the run ended at an escalated sign-off');
  assert.ok(d.result.finalRead && typeof d.result.finalRead === 'object', 'T15h premise: final_read was on, the result carries a finalRead record');
  assert.deepEqual([d.result.finalRead.ran, d.result.finalRead.reason], [false, 'every_top_seat_read_this_plan'], 'T15h premise: the final read made no call (layer 3 had read exactly this text), so the text is the one layer 3 signed');
  const reusedTop = (d.result.finalRead.reused || []).find(x => x.lab === 'top');
  assert.deepEqual((reusedTop?.sorting || []).filter(x => x.id === d.idYo).map(x => x.sort), ['may_leave'], 'T15h premise: the final read carries layer 3\'s last statement with the may-leave sorting of the rated-5 block');
  assert.ok(d.report && d.report.final_read, 'T15h premise: the report carries the final_read record');
  // targets: the ending names its basis
  assert.ok(d.report.ending && typeof d.report.ending === 'object', 'T15h: the report records an ending');
  assert.deepEqual(d.report.ending.basis, ['layer_3_sign_off', 'handler_check', 'dissent_on_record'], 'T15h: the ending names its basis: layer 3\'s sign-off, the handler\'s check and the may-leave block on the record as a dissent');
  assert.equal(d.report.ending.kind, 'agreed', 'T15h: the ending is agreed');
  assert.equal(d.report.ending.handler_check, 'good_to_build', 'T15h: the ending rests on the handler\'s good_to_build');
  assert.deepEqual((d.report.dissents || []).map(x => x.id), [d.idYo], 'T15h: the may-leave block is on the record as a dissent, and it is the only one');
  const dis = d.report.dissents[0];
  assert.deepEqual([dis.lab, dis.status, dis.ruling.source, dis.ruling.layer, dis.ruling.reasons[0]?.lab], ['raiser', 'open', 'sorting', 3, 'top'], 'T15h: the dissent is the seat\'s, open, from layer 3\'s sorting, with layer 3\'s reason beside it');
  assert.ok(dis.ruling.reasons[0].text.includes('Minor for the build.'), 'T15h: layer 3\'s own reason is on the dissent');
  // targets: it is not read as a whole-panel sign-off (the fail condition in the header comment)
  assert.notEqual(d.report.passed, true, 'T15h: the report does not say the whole panel passed');
  assert.ok(d.report.escalated_signoff, 'T15h: the report keeps the escalated sign-off beside the ending');
  assert.equal(verdictHeadline(d.report).label, 'AGREED', 'T15h: the verdict reads AGREED, not PASSED');
  assert.match(verdictHeadline(d.report).words, /the whole panel did not sign off/, 'T15h: the verdict says that the whole panel did not sign off');
  assert.equal(d.report.outcome, 'no_consensus', 'T15h: the outcome stays no_consensus (it is not the whole panel\'s agreement)');
  assert.equal(isAgreed(d.result), true, 'T15h: the shared agreement predicate says agreed');
}

// ============================================================================================================================================================================
// T17s + T17al (Q8): ONE fixture. A block rated 5.0 (NOT re-tagged) is overruled by layer 3 at its sign-off and stays open; the seat's layer is not asked again; the handler answers good_to_build.
// T17s: the dissent is on the record under the seat's name with its rating (5, in force 5), status open and layer 3's reasons; the seat is recorded as dissenting (the basis mark), the layer counted as not signed and not blocking.
// T17al: the ending is not held (the run ends agreed; it is not left waiting at the build check).
// Fixture: test/m1-dissent.test.js `run()` :53-71 (the go-up fixture) with the held map of DS-5 :130 + DS-1b :92 + DS-7's REAL section (:167): { DEMAND, GOUP, dissentRecordSection (HB.dissentRecordSection), CHECK }, `session: true`, the rated replies of DS-5 :129,
// the escalation ruling OVERRULE (:50) and DS-1b's build-check answer (:92). The dispute stage does not run at an agreed end (DS-1b :95-96), so there is no dispute entry flag to read; the dissent is read from report.dissents and the basis.
// SWAPPED INPUTS (variant): true = the block is RE-TAGGED to 7 by the handler at pass 3 (DS-5 :130), so its rating shows {5, 7} (T17s's red; every premise holds, the ending is still agreed);
//   'held' = the handler's good_to_build names no id, so judgeBuildCheck refuses it (src/chain.js:4603-4617; the pairing of runT17ag's variant, s8-handler-rows.js:109) and the run is held at build-check-1 (T17al's red; no result exists).
// ============================================================================================================================================================================
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };   // test/m1-dissent.test.js:35
const idY = objectionId('mid-beta', Y);   // :36
const REASON = 'Section two names the owner.';   // :39
const dsObjects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });   // :42
const GOUP = { goUpRulingSystem: HB084.goUpRulingSystem, goUpRulingUser: HB084.goUpRulingUser, goUpRulingsSection: HB084.goUpRulingsSection };   // :47
const sectionOf = text => { const i = text.indexOf('## Dissents on the record'); if (i < 0) return null; const j = text.indexOf('\n---\n', i); return text.slice(i, j + 5); };   // :168

export async function runT17sAl(variant = false) {
  const served = [];
  const out = { idY, variant, served };
  const rated = { ...Y, severity: 5 };   // DS-5 :129 (rated(Y))
  const script = { 'panel-1-mid-beta': dsObjects({ ...rated, relation: 'new' }), 'panel-2-mid-beta': dsObjects({ ...rated, relation: `continues ${idY}` }),   // BOUND :49 with the rated block
    'rule-3-top-gamma': JSON.stringify({ rulings: [{ id: idY, ruling: 'overrule', reason: REASON }] }),   // OVERRULE :50
    'build-check-1': variant === 'held' ? answer('good_to_build', 'The build can go ahead.') : answer('good_to_build', `${idY} can be built; the owner is named while building.`) };   // :92
  try {
    setHeldForTest({ ...DEMAND, ...GOUP, dissentRecordSection: HB084.dissentRecordSection, ...CHECK });
    setCache({ invalidate() {}, get(label) {   // m1-dissent.test.js:56-62
      served.push(label);
      if (label in script) return OK(script[label]);
      if (label.startsWith('build-check-')) return null;
      return OK(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
    } });
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };   // m1-dissent.test.js:51, :64 (session: true)
    const config = { name: 'fixture-u1', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
      seats: { builder: writer, reviser: writer, critics: [['raiser-alpha', 1], ['mid-beta', 2], ['top-gamma', 3]].map(seatOf) } };   // :65-66
    const retags = variant === true ? { retags: [{ pass: 3, id: idY, severity: 7, reason: 'A missing owner is worse than first thought.' }] } : {};   // DS-5 :130
    try {
      out.result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t17s', log: () => {}, config, ...retags });   // :68
      out.report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-t17s', chain: 'fixture-u1', task: 't.md', result: out.result, config })));   // :70
      out.board = renderBoardMd({ runId: 'r-t17s', result: out.result });   // DS-7 :183
    } catch (e) { out.error = e; }
  } finally { resetGlobals(); }
  return out;
}
export const runT17s = (variant = false) => runT17sAl(variant ? true : false);
export const runT17al = (variant = false) => runT17sAl(variant ? 'held' : false);

export function checkT17al(d) {
  // premises: true in the green run and in the 'held' run
  assert.ok(d.served.includes('rule-3-top-gamma') && d.served.includes('panel-3-top-gamma'), 'T17al premise: layer 3 ruled on the block and gave its verdict in pass 3 (the escalated route was walked)');
  assert.ok(d.served.includes('build-check-1'), 'T17al premise: the build check was asked');
  // targets
  assert.ok(!(d.error instanceof ExternalPause), 'T17al: the ending is not held: the run is not left waiting at the build check');
  assert.equal(d.error, undefined, `T17al premise: the run ends without an error (${String(d.error?.stack || d.error)})`);
  assert.equal(d.result.ending?.kind, 'agreed', 'T17al: the ending is agreed');
  assert.equal(d.result.ending.handler_check, 'good_to_build', 'T17al: the ending rests on the handler\'s good_to_build');
  assert.deepEqual(d.result.buildChecks.map(c => c.answer), ['good_to_build'], 'T17al: exactly one build check, answered good_to_build');
  assert.ok(!d.served.includes('build-check-2'), 'T17al: no second build check was asked');
  assert.equal(isAgreed(d.result), true, 'T17al: the shared agreement predicate says agreed');
}

export function checkT17s(d) {
  // premises: true in the green run and in the re-tag run
  assert.equal(d.error, undefined, `T17s premise: the run ends without an error (${String(d.error?.stack || d.error)})`);
  assert.deepEqual((d.result.escalations || []).map(e => [e.pass, (e.outcome || []).filter(o => o.id === d.idY).map(o => [o.result, o.stays_open])]), [[3, [['overruled', true]]]], 'T17s premise: layer 3 overruled the block at pass 3 and it stays open');   // test/s8-closure.test.js C3-22 :322
  assert.ok(d.result.escalated_signoff, 'T17s premise: the run ended at layer 3\'s sign-off after the go-up (an escalated sign-off)');
  assert.deepEqual(d.result.buildChecks.map(c => c.answer), ['good_to_build'], 'T17s premise: the handler answered good_to_build');
  assert.ok(d.result.buildChecks[0].required.includes(d.idY), 'T17s premise: the build check demanded the block by id');
  const tops = (d.report.layers || []).filter(x => x.layer === 3 && x.state === 'signed_off');   // test/helpers/s8-record-rows.js:149-151 (checkT17ak p1, p2)
  assert.ok(tops.length > 0, 'T17s premise: layer 3 signed off in some pass');
  assert.ok((d.report.signoff || []).some(s => s.lab === 'top-gamma'), 'T17s premise: the sign-off pass has layer 3\'s signoff[] row');
  // targets, in this order: the dissent under the seat's name, its rating first
  const byName = (d.report.dissents || []).filter(x => x.name === 'mid-beta');
  assert.equal(byName.length, 1, 'T17s: the dissent is readable from the record by the seat\'s name (report.dissents, name mid-beta)');
  const dis = byName[0];
  assert.deepEqual([dis.lab, dis.id, dis.criterion, dis.status], ['mid-beta', d.idY, CRITERION, 'open'], 'T17s: the dissent names the seat, the block and its criterion, status open');   // m1-dissent.test.js DS-1 :82
  assert.deepEqual([dis.ruling.layer, dis.ruling.round, dis.ruling.source], [3, 3, 'escalation'], 'T17s: the dissent carries layer 3\'s ruling (layer 3, round 3)');   // DS-1 :83
  assert.ok(dis.ruling.reasons.length === 1 && dis.ruling.reasons[0].lab === 'top-gamma' && dis.ruling.reasons[0].text.includes(REASON), 'T17s: layer 3\'s reasons are beside the dissent, from its seat');   // DS-1 :84
  assert.deepEqual(dis.rating, { as_raised: 5, in_force: 5, changes: [] }, 'T17s: the dissent shows the block rated 5, in force 5, with no re-tag');
  assert.ok(d.report.ending.basis.includes('dissent_on_record'), 'T17s: the seat is recorded as dissenting: the ending\'s basis carries dissent_on_record');   // DS-1b :94
  // its layer is counted as not signed and not blocking
  const pass = tops.at(-1).round;
  assert.equal(d.report.layers.find(x => x.round === pass && x.layer === 2)?.state, 'escalated', 'T17s: at the layer-3 sign-off pass the dissenting seat\'s layer is counted as passed over (escalated), not as signed and not as blocking');   // s8-record-rows.js:153
  assert.equal((d.report.signoff || []).some(s => s.lab === 'mid-beta'), false, 'T17s: no signoff[] row for mid-beta in the sign-off pass');   // :154
  assert.equal(d.report.ending.kind, 'agreed', 'T17s: the dissent does not hold the ending (the layer does not block)');
  // the build list (the deliverable's section and the BOARD line)
  const sec = sectionOf(d.result.deliverable);
  assert.ok(sec, 'T17s: the deliverable carries the "Dissents on the record" section');
  assert.ok(sec.includes(`*mid-beta, ${d.idY}. Rated 5. Overruled by layer 3 in round 3.*`), 'T17s: the section lists the dissent under the seat\'s name with its rating');   // test/held-prompts/held-084-b.js:238, DS-7 :178
  assert.ok(sec.includes('Layer 3\'s reasons: top-gamma: ') && sec.includes(REASON), 'T17s: the section carries layer 3\'s reasons beside the dissent');   // held-084-b.js:243
  assert.ok(d.board.includes(`- ${d.idY} (mid-beta): rated 5; overruled by layer 3 in round 3; not answered after the overrule; open.`), 'T17s: the BOARD lists the dissent as open, rated 5');   // src/report-shape.js:445, DS-7 :184
}
