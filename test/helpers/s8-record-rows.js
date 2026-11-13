// 0.8.4 S8 (M3) record rows T13u, T13w, T17i, T17t, T17ak, T17v. $0, offline, mock seats. Every fixture below is COPIED from the file named beside it (this module imports nothing from a *.test.js file); each row's assertions live in a check<ROW> function of pure data,
// so the committed row (test/s8-record-rows.test.js, or the edited existing row) and the red-only file (test/s8-record-rows-red.test.js, never committed) run the SAME assertions: the red file feeds them a run built from a SWAPPED INPUT.
// Order inside every check: premises first (true in the green run AND in the swapped run, so a red can never be a fixture error), then the target assertion (the only one that differs between the two runs), each with its own message.
// Plain hyphens only, no em-dashes.
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../../src/chain.js';
import { setHeldForTest } from '../../src/held-roles.js';
import { objectionId } from '../../src/objection-ids.js';
import { reportJsonShape } from '../../src/report-shape.js';
import { DEMAND, SORTING } from './rating-demand.js';
import { CHECK, answer } from './build-check.js';
import { CRITERION } from './layer-two-run.js';
import * as HB from '../held-prompts/held-084-b.js';
import * as HESC from '../held-prompts/held-escalation.js';

const DRAFT = 'The worker retries failed requests.';
const reset = () => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); };
const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });

// ---- reply builders (test/s7c-reasons.test.js :20-32; test/s7-go-up.test.js :91-98, :304, :318-319)
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5 };   // 0.8.4 wording apply: rated 5 (the rating demand is recorded on every layered unanimous chain; a rated-5 block holds like an unrated one)
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker' };   // s7c-reasons :24
const idL3 = objectionId('top-gamma', L3F);
const Z = { criterion: CRITERION, problem: 'The limit is not stated.', quote: 'retries failed requests' };   // s7-go-up :318
const idZtop = objectionId('top-gamma', Z);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
const rated = (f, severity = 5) => ({ ...f, severity });
const fresh = f => ({ ...f, relation: 'new' });   // a first raise (the relation wording is recorded: a judge's failure must declare its relation)
const again = (lab, f) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });   // the same seat raising its own standing objection again in a later pass
const GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };   // s7-go-up :99
const W41 = { layerThreeReasonsSection: HB.layerThreeReasonsSection };   // s7c-reasons :34
const HEADING = "# Layer 3's reasons for objections of yours it overruled";   // s7c-reasons :35
const ANSWER_BACK = '# Your objections from the last round, and what happened';   // s7c-reasons :26
const SORT_REASON = 'Minor for the build.';   // s8-sorting :499-516 (S8-29, S8-30 callers)

// =====================================================================================================================================
// T13u (CA8, Q8 item 5): the handler's not_yet follows a layer-3 sign-off that SORTED a block of seat S may-leave. Fixture = RL-6 (test/s7c-reasons.test.js :124-146) with the SORTING source instead of the escalation ruling:
// the go-up words (GOUP) are left OUT and no `rule-3-*` reply is scripted, because chain.js :4533-4535 (`ruledAlready`) drops the sorting row when an escalation ruled the same seat, id and round (the row under test would not be the one filtered).
// With GOUP absent the plan still goes up (S8-30, test/s8-sorting.test.js) and the ruling is undecided; every objection is rated (SORTING carries the rating demand; 5 does not close on overrule, chain.js :4510).
// variant = false: layer 3 SIGNS OFF at pass 3 with the may-leave (script: panel-3-top-gamma = a sign-off carrying `sorting`; build-check-1 = not_yet naming idY; build-check-2 = good_to_build).
// variant = true (RED, the swapped input): layer 3 OBJECTS at pass 3 with the SAME sorting (test/s8-sorting.test.js S8-30 shape, :511-516): THREE scripted replies change - panel-3-top-gamma = an objection of its own plus the sorting, panel-4-top-gamma = its withdrawal,
// build-check-1 = good_to_build (the only check happens after pass 4) - and build-check-2 is not scripted. The run finishes in both variants, so `result` exists.
// NAMED GAP (not driven): the "block open on the record as a dissent" clause. It needs mid-beta to KEEP the block in pass 4, `dissentRecordSection` held (test/s8-closure.test.js C3-28 :341) and the run ending at an agreement point with the block open (chain.js :6880);
// that path was not traced, so no dissent is asserted here.
// =====================================================================================================================================
export async function runT13u(variant = false) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, p));   // s7c-reasons :126
  setHeldForTest({ ...SORTING, ...W41, ...CHECK });   // no GOUP (see above); SORTING = rating demand + the three S8 words (rating-demand.js :11)
  const sorting = [{ id: idY, sort: 'may_leave', reason: SORT_REASON }];
  const withSorting = text => JSON.stringify({ ...JSON.parse(text), sorting });   // a top-layer reply with the `sorting` key (test/s8-sorting.test.js :474 `gObjects`, :561 `signoffWith`)
  const script = {
    'panel-1-mid-beta': objects(fresh(rated(Y))), 'panel-2-mid-beta': objects(again('mid-beta', rated(Y))),   // layer 2 hits its bound (BOUND, s7c :38), rated 5
    'panel-3-top-gamma': variant ? withSorting(objects(fresh(rated(L3F, 6)))) : withSorting(meets()),
    'panel-4-mid-beta': withdrawsOf(idY),
    ...(variant ? { 'panel-4-top-gamma': withdrawsOf(idL3), 'build-check-1': answer('good_to_build') }
      : { 'build-check-1': answer('not_yet', `${idY}: Name the owner of the worker before building.`), 'build-check-2': answer('good_to_build') }),   // s7c :129 (a not_yet must name every demanded id, build-check.js judgeBuildCheck)
  };
  setCache({ invalidate() {}, get(label) {   // s7c-reasons :130-136
    served.push(label);
    if (label in script) return hit(script[label]);
    if (label.startsWith('build-check-')) return null;
    return hit(label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };   // s7c :63
  const config = { name: 'fixture-t13u', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: SESSION, reviser: SESSION, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };   // s7c :138-139
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-t13u', log: () => {}, config }); } catch (e) { error = e; } finally { reset(); }
  return { result, error, served, prompts, variant, config };
}
const anywhere = prompts => [...prompts.keys()].filter(l => prompts.get(l).user.includes(HEADING));   // s7c :65
export function checkT13u(d) {
  const { result, error, served, prompts } = d;
  // premises (true in both variants)
  assert.equal(error, null, `T13u-p0: the run finished: ${String(error)}`);
  assert.ok(result && Array.isArray(result.panelVerdicts), 'T13u-p0b: the run returned a result with panelVerdicts');
  const top = prompts.get('panel-3-top-gamma');
  assert.ok(top && top.user.includes(`- ${idY} (raised in layer 2; rated 5.0`), 'T13u-p1: layer 3 was shown the block as an item to sort (test/s8-sorting.test.js S8-29, :499-509)');
  const row = result.panelVerdicts.find(v => v.lab === 'top-gamma' && v.round === 3);
  assert.deepEqual(row?.sorting?.map(x => [x.id, x.sort]), [[idY, 'may_leave']], 'T13u-p2: layer 3 sorted the block may-leave at pass 3 (recorded on its verdict row, test/s8-sorting.test.js S8-30c :531-535)');
  assert.ok(served.includes('panel-4-mid-beta'), 'T13u-p3: seat S (mid-beta) was asked again in pass 4');
  const u = prompts.get('panel-4-mid-beta')?.user ?? '';
  assert.ok(u.includes(ANSWER_BACK) && u.includes(idY), 'T13u-p4: the block is open in S\'s own answer-back (S answers it among its ordinary answers)');
  // target (the only assertions that differ between the sign-off run and the layer-3-objects run)
  assert.deepEqual(anywhere(prompts), [], 'T13u-target-a: no review of the run carries layer 3\'s reasons (the heading) after a layer-3 SIGN-OFF followed by the handler\'s not_yet');
  assert.equal(u.includes(SORT_REASON), false, 'T13u-target-b: layer 3\'s sorting reason is not in S\'s next review');
}

// =====================================================================================================================================
// T13w: after build-check-1 (not_yet) seat S gets no call beyond its ordinary review. NAMED PIN, no red variant: W41 is a prompt section (chain.js :4763-4772, appended at :4823), never a call, so no scripted input can make the forbidden call happen.
// Fail condition: fails when a label naming mid-beta other than `panel-4-mid-beta` is served between build-check-1 and build-check-2 (for example a dedicated call asking S to answer layer 3's reasons).
// `served` = the cache.get labels in call order (s7c-reasons RL-6 :125, :131); it may hold duplicates, hence the Set.
// =====================================================================================================================================
export function checkT13w(served) {
  const i1 = served.indexOf('build-check-1'); const i2 = served.indexOf('build-check-2');
  assert.ok(i1 >= 0, 'T13w-p1: the handler was asked (build-check-1 served)');
  assert.ok(served.indexOf('panel-4-mid-beta') > i1, 'T13w-p2: S was asked its ordinary review after the not_yet');
  const end = i2 > i1 ? i2 : served.length;   // the window ends at the second check when it was reached, else at the end of the run
  assert.deepEqual([...new Set(served.slice(i1 + 1, end).filter(l => /mid-beta/.test(l)))], ['panel-4-mid-beta'], 'T13w-target (PIN): between the first and the second build check S is asked only its ordinary review panel-4-mid-beta');
}

// =====================================================================================================================================
// T17t / T17ak: GU-5 (test/s7-go-up.test.js :331-338). `goUpRun` is the copy of that file's `run` (:105-125).
// checkT17t(served): a block rated 5 that layer 3 overrules at a layer-3 sign-off after which the run ends: no call to its seat at the sign-off. The red input is the run where layer 3 OBJECTS instead (so pass 4 asks mid-beta again).
// checkT17ak(report): the layer is counted as not signed (state escalated, no signoff[] row). Its red input is the GU-7 run (no go-up, every layer signs). The layer-3-objects run does NOT red it (the go-up still parks layer 2 at round 3).
// =====================================================================================================================================
export async function goUpRun({ held = {}, answers = {}, ov = { rounds: 2, bounds: { 1: 1, 2: 1 } } } = {}) {
  const prompts = new Map(); const served = [];
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { 'panel-1-mid-beta': objects(fresh(Y)), 'panel-2-mid-beta': objects(again('mid-beta', Y)), ...answers };   // BOUND, s7-go-up :102
  setCache({ invalidate() {}, get(label) {   // s7-go-up :110-115
    served.push(label);
    if (label in script) return script[label] === null ? null : hit(script[label]);
    return hit((label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-go-up', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds,
    seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };   // s7-go-up :118-122
  try {
    const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-goup', log: () => {}, config }).catch(e => { e.served = served; e.prompts = prompts; throw e; });
    return { result, prompts, served, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-goup', chain: 'fixture-go-up', task: 't.md', result, config }))) };   // :124
  } finally { reset(); }
}
/** RED input of T17t: GU-5's run with layer 3 OBJECTING at pass 3 (own rated objection Z, withdrawn in pass 4), rated 5 block still overruled by the go-up ruling. Shape of s7c-reasons RL-1/RL-5. Returns the served labels (a stop is caught: only the labels are read). */
export async function runT17tVariant() {
  const answers = { 'panel-1-mid-beta': objects(fresh(rated(Y))), 'panel-2-mid-beta': objects(again('mid-beta', rated(Y))),
    'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }]),   // s7-go-up :320 layer3Rules
    'panel-3-top-gamma': objects(fresh(rated(Z))), 'panel-4-mid-beta': withdrawsOf(idY), 'panel-4-top-gamma': withdrawsOf(idZtop) };
  return goUpRun({ held: { ...DEMAND, ...GOUP }, ov: { rounds: 3, bounds: { 1: 1, 2: 1 } }, answers }).then(r => r.served, e => { if (Array.isArray(e?.served)) return e.served; throw e; });
}
/** RED input of T17ak: the GU-7 run (s7-go-up :350-356): b2 = 7, no go-up, every layer signs at pass 4. Returns its report. */
export async function runT17akVariant() {
  const { report } = await goUpRun({ ov: { rounds: 2, bounds: { 1: 1, 2: 7 } }, answers: { 'panel-3-mid-beta': objects(again('mid-beta', Y)), 'panel-4-mid-beta': withdrawsOf(idY) } });
  return report;
}
export function checkT17t(served) {
  assert.ok(served.includes('rule-3-top-gamma'), 'T17t-p1: layer 3 was asked to rule on the sent-up block');
  assert.ok(served.includes('panel-3-top-gamma'), 'T17t-p2: layer 3 was asked in pass 3');
  assert.ok(served.includes('panel-2-mid-beta'), 'T17t-p3: layer 2 (mid-beta) was asked in the passes before the go-up');
  assert.equal(served.some(l => /^panel-([3-9])-mid-beta/.test(l)), false, 'T17t-target: no call to the block\'s seat (mid-beta) at or after the layer-3 sign-off');
}
export function checkT17ak(report) {
  const tops = (report.layers || []).filter(x => x.layer === 3 && x.state === 'signed_off');
  assert.ok(tops.length > 0, 'T17ak-p1: layer 3 signed off in some pass');
  assert.ok((report.signoff || []).some(s => s.lab === 'top-gamma'), 'T17ak-p2: the sign-off pass has layer 3\'s signoff[] row');
  const pass = tops.at(-1).round;
  assert.equal(report.layers.find(x => x.round === pass && x.layer === 2)?.state, 'escalated', 'T17ak-target-a: at the layer-3 sign-off pass layer 2 is counted as passed over (escalated), not as signed');
  assert.equal((report.signoff || []).some(s => s.lab === 'mid-beta'), false, 'T17ak-target-b: no signoff[] row for mid-beta in the sign-off pass');
}

// =====================================================================================================================================
// T17i: C3-23 (test/s8-closure.test.js :374-408). checkT17i(served1, served2): served1 = the run that waits at build-check-1, served2 = the run whose handler answered. No revision starts between layer 3's sorting and the build check,
// and after good_to_build no revision and no pass 4. NAMED PIN for the claim "the sorting itself opens no round" (no input makes a sort open one); the swapped run (handler says not_yet, a revision REALLY starts after build-check-1) reds
// the second assertion only. Fail condition: fails when a revise-* or panel-4-* label is served after panel-3-top in a run whose layer 3 signed off with a sorting and whose handler answered good_to_build.
// =====================================================================================================================================
export function checkT17i(served1, served2) {
  const afterTop = (s, which) => {
    const i = s.indexOf('panel-3-top'); const j = s.indexOf('build-check-1');
    assert.ok(i >= 0, `T17i-p1 (${which}): layer 3 (panel-3-top) was asked`);
    assert.ok(j > i, `T17i-p2 (${which}): the build check came after layer 3's verdict`);
    return s.slice(i + 1);
  };
  assert.deepEqual(afterTop(served1, 'first run').filter(l => l.startsWith('revise-')), [], 'T17i-a: no revision between layer 3\'s sorting and the build check');
  assert.deepEqual(afterTop(served2, 'answered run').filter(l => l.startsWith('revise-') || /^panel-4-/.test(l)), [], 'T17i-b: after the handler answered good_to_build no revision starts and no pass 4 is asked');
}
/** C3-23's fixture (test/s8-closure.test.js :374-408) as data for the red file. variant = true: the second answer is not_yet (naming both demanded ids). Returns { served1, served2 }; a pause or stop of the second run is caught, only the labels are read. */
export async function runT17i(variant = false) {
  const Xo = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };   // :375-377
  const Yo = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
  const Zo = { criterion: CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
  const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);
  const HESC_INJECT = () => ({ escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection });   // :267
  setHeldForTest({ ...HESC_INJECT(), ...DEMAND, ...SORTING, relationRule: HB.relationRule, ...CHECK });   // :379
  const row = v => ({ criterion: CRITERION, verdict: v, evidence: 'Section two.' });
  const objectsC = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
  const rel = (f, relation) => ({ ...f, relation });
  const topSorted = JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok', sorting: [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: CRITERION }, { id: idYo, sort: 'must_do', reason: 'No owner.', criterion: CRITERION }] });
  const script = { 'panel-1-raiser': objectsC(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objectsC(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted };   // :385
  let served = [];
  const make = extra => {   // :386-398
    served = [];
    setCache({ invalidate() {}, get(label) {
      served.push(label);
      const all = { ...script, ...extra };
      if (label in all) return hit(all[label]);
      if (label.startsWith('build-check-')) return null;
      return hit((label.startsWith('panel-') || label.startsWith('final-read-')) ? JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' }) : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.');
    } });
    const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
    return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-c3-23', log: () => {}, config: { name: 'fixture-c3-23', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
      seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seat) } } });
  };
  try {
    await make({}).then(() => null, e => e); const served1 = served;
    await make({ 'build-check-1': variant ? answer('not_yet', `${idX}: The limit must be stated first. ${idYo}: An owner must be named first.`) : answer('good_to_build', `${idX} and ${idYo}: the build can leave both, section two covers them.`) }).then(() => null, e => e); const served2 = served;
    return { served1, served2 };
  } finally { reset(); }
}

// =====================================================================================================================================
// T17v (Q8): an objection named in a post that stands when the ending exchange ends is sorted at layer 3's final read. Base = test/ending-exchange.test.js T22d (:116-126; `go` :22-28, FIX :33, chainOf :16-20, PLAN :21), extended with a
// layer-3 seat e10 that is never reached in pass 1 (layer 2's e9 objects, so layer 3 is not asked: s7-go-up GU-2 `1.3:not_asked`), `final_read` and `answer_back` (sortingOn needs the ledger and the rating demand, s8-sorting S8-3).
// variant = true (RED, the swapped input): `final-read-e10` is a plain readable MET reply with NO `sorting` key (s8-sorting S8-5 :138 shows such a reply draws no final-read-e10-reask1 and the labels premise below still holds).
// NAMED GUESSES (no existing test combines these): (1) the three-layer chain with the ledger still runs the ending exchange (chain.js :6873) and mints the same objection; (2) e10 is not asked in pass 1 so `mustRead` is non-empty (:7147); (3) the reply's
// criteria row matches the chain's generated criteria (the "proven" criterion string of the mints is used); (4) the minted id equals the probe's. Each is a premise below, so a wrong guess names itself.
// =====================================================================================================================================
const PLAN = '# Plan\n\nThe worker retries failed requests at most three times. Bake a cake. Sell it at the fair.';   // ending-exchange :21
const CRIT_E = 'It adds no scope the request did not ask for.';   // the criterion of the proven mints (ending-exchange :117)
const PROBLEM_E = 'The delay between retries is unbounded.';
const BODY_E = JSON.stringify({ posts: [], new_objections: [{ criterion: CRIT_E, problem: PROBLEM_E, quote: 'at most three times', severity: 6 }] });   // :117
let tagN = 0;   // a fresh tag per run: the mock `new7` counts its asks per model string for the life of the process (ending-exchange :32)
const eSeat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });   // :15
const eChain = (critics, extra = {}) => ({ name: 'ending-exchange', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });   // :16-20
const eFix = (extra, tag, more = []) => eChain([eSeat(`mock-exch-support-keep-sev3-${tag}`, 'e1', 1), eSeat(`mock-exch-alt-keep-${tag}-clean`, 'e2', 1), eSeat(`mock-exch-new7-keep-${tag}-clean`, 'e3', 1), eSeat('mock-critic-x', 'e9', 2), ...more], extra);   // :33
const eGo = async (config, held, scripted) => {   // :22-28 (prompts stored as `${system}\n${user}` strings)
  const prompts = new Map(); setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest(held);
  setCache({ invalidate() {}, get: label => (label in scripted ? { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 30, output: 30 }, usd: 0 } : null) });
  try { const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-ending-exchange', config }); return { r, prompts }; }
  catch (e) { e.prompts = prompts; throw e; } finally { reset(); }
};
export async function runT17v(variant = false) {
  tagN += 1;
  const probe = await eGo(eFix({}, `v17p${tagN}`), { ...DEMAND, ...HB_W26() }, { build: PLAN, 'ldebate-end-x3-e1': BODY_E });   // T15o's probe (:54-55): the plain FIX run gives the minted id
  const probeRow = probe.r.endingExchange?.objections?.find(o => o.problem === PROBLEM_E);
  const ID = probeRow?.id;
  const finalReply = (sorting) => JSON.stringify({ meets: true, criteria: [{ criterion: CRIT_E, verdict: 'MET', evidence: 'Section one sets the limit.' }], failures: [], verdict_line: 'ok', ...(sorting ? { sorting } : {}) });
  const reply = variant ? finalReply(null) : finalReply([{ id: ID, sort: 'must_do', reason: 'The delay is unbounded.', criterion: CRIT_E }]);
  const e10 = { ...eSeat('mock-review-fixture', 'e10', 3), maxTokens: 3000 };
  const main = await eGo(eFix({ answer_back: { enabled: true }, final_read: { enabled: true } }, `v17m${tagN}`, [e10]), { ...HB_W26(), ...SORTING }, { build: PLAN, 'ldebate-end-x3-e1': BODY_E, 'final-read-e10': reply });
  return { r: main.r, prompts: main.prompts, ID, probeFound: !!probeRow, variant };
}
const HB_W26 = () => ({ lateFindingRule: HB.lateFindingRule, lastRoundReplyRule: HB.lastRoundReplyRule });   // ending-exchange :13
export function checkT17v(d) {
  const { r, prompts, ID, probeFound } = d;
  // premises (true in both variants)
  assert.ok(probeFound && /^O-/.test(ID ?? ''), 'T17v-p0: the plain probe run minted the objection named in round 3 of the ending exchange (T22d)');
  assert.equal(r.endingExchange?.ran, true, 'T17v-p1: the ending exchange ran in the three-layer chain with the ledger (guess 1)');
  const row = r.endingExchange?.objections?.find(o => o.problem === PROBLEM_E);
  assert.equal(row?.id, ID, 'T17v-p2: the same objection was minted in the main run, same id as the probe (guess 4)');
  assert.ok(row && !['not_debated', 'withdrawn_argued'].includes(row.outcome), 'T17v-p3: the objection stands when the ending exchange ends');
  assert.equal(r.finalRead?.ran, true, 'T17v-p4: the closing read ran (guess 2)');
  assert.deepEqual(r.stages.map(s => s.label).filter(l => l.startsWith('final-read-')), ['final-read-e10'], 'T17v-p5: the layer-3 seat was asked once at the final read');
  assert.ok((prompts.get('final-read-e10') ?? '').includes(ID), 'T17v-p6: the minted id is on the list layer 3 was shown at the final read');
  assert.ok(r.finalRead.seats.length === 1 && !('sorting_ignored' in r.finalRead.seats[0]), 'T17v-p7: the reply was read and no id of it was unknown to the list (guess 3)');
  // target
  assert.deepEqual(r.finalRead.sorting?.map(x => [x.id, x.sort]), [[ID, 'must_do']], 'T17v-target: the objection is sorted in finalRead.sorting (it does not reach the ending unsorted)');
}
