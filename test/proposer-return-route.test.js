// 0.8.4 S9 + S9a, the ROUTE half (S9-R1, C&C 08 Nov): layer 3's sorting at a closing read names a repair route per must-do (writer, or proposers); a closing read only RECOMMENDS the proposers, it never starts a return (Q9, Q10(a)).
// Rows: T10g T10i T10j T10k (S9 owns i and k) and T20n T20z (S9a), the prompt wiring (the reply key; W29(i) on a chain with no proposer seat), the held state, the pure readers. Built on S8's fixtures (test/helpers/layer-two-run.js scenario(),
// test/helpers/rating-demand.js SORTING; the closing read is the one of test/s8-sorting.test.js: la raises a rated objection, the recorded finish ends the run not agreed, the layer-3 seats lc and ld have not read the plan, the closing read asks both).
// Every NEGATIVE row (no return, nothing asked again) carries a POSITIVE CONTROL: the in-loop twin of the same words makes the 9 return calls (test/helpers/proposer-return-fixture.js run()). Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { readSorting, combineSortings, closedAtClose } from '../src/sorting.js';
import * as SO from '../src/sorting.js';   // a namespace for the export this unit adds (routeSummaryOf): on a tree without it the row fails by assertion, not at link time
import { withSorted, withSortedPerSeat } from '../src/late-finding.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, idOf, CRITERION } from './helpers/layer-two-run.js';
import { S9, run as loopRun, returnLabels } from './helpers/proposer-return-fixture.js';
import * as HS9 from './held-prompts/held-084-s9.js';
import * as HS8 from './held-prompts/held-084-s8.js';
import * as RC from '../src/roles.js';   // the RECORDED words: the expected final-read reply form below comes from here

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const HELD = Object.freeze({ ...SORTING, ...S9 });
const OPEN = idOf(5);
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(sorting !== undefined ? { sorting } : {}) });
const MET = metWith();
const FINISH = { runExtra: { roundChoices: [{ choice: 'finish', stop: 'layer_bound:1:8', kind: 'layer_bound', why: 'revisions', layer: 1 }] } };   // as test/s8-sorting.test.js: the recorded finish at layer 1's revision bound ends the run not agreed with layer 3 unread
const STOPPED = async fn => { try { return await fn(); } catch (e) { if (e && e.stop) throw new Error(`premise: the run stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass}: the recorded finish names a different stop id`); throw e; } };
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const seatsWith = proposers => ({ builder: seatOf(['writer']), reviser: seatOf(['writer']), critics: L3.map(seatOf), ...(proposers ? { proposers: Array.from({ length: proposers }, (_, i) => ({ provider: 'mock', model: 'mock-proposer', lab: `prop-${i}`, maxTokens: 3000 })) } : {}) });
const scn = (overrides, { proposers = 3, held = HELD, decisions = true } = {}) => { setHeldForTest(held); return STOPPED(() => scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides, extra: { maxRounds: 1, final_read: { enabled: true }, ...(decisions ? { decisions: { enabled: true } } : {}), seats: seatsWith(proposers) }, ...FINISH })); };
const frLabels = r => r.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));
const premise = r => {
  assert.equal(r.result.passed, false, 'premise: the run ends not agreed (on the recorded finish)');
  assert.equal(r.result.stop?.chosen, 'finish', 'premise: the run ended on the recorded finish');
  assert.ok(r.result.finalRead && r.result.finalRead.ran === true, 'premise: the closing read ran');
  assert.deepEqual(frLabels(r.result).sort(), ['final-read-lc', 'final-read-ld'], 'premise: both unread layer-3 seats were asked once');
};
const MUSTDO = (route, extra = {}) => ({ id: OPEN, sort: 'must_do', reason: 'Decision 1 stores everything in one place.', decision: 'Decision 1', ...(route !== undefined ? { route } : {}), ...extra });

test('T10g + T10i + T10k (Q9, Q10(a)): a closing read whose sorting recommends the route proposers for a decision-level must-do starts NO return (0 return-* calls); the run ends on the finish with the route RECORDED on the must-do (entry, combined row), and the must-do stays open. The in-loop twin makes the 9 calls (control)', async () => {
  const r = await scn({ 'final-read-lc': metWith([MUSTDO('proposers')]), 'final-read-ld': MET });
  premise(r);
  assert.equal(returnLabels(r.served).length, 0, 'T10g FAIL = a return starts at the closing read');
  const fr = r.result.finalRead;
  assert.deepEqual(fr.seats.find(e => e.lab === 'lc').sorting.map(x => [x.id, x.sort, x.route]), [[OPEN, 'must_do', 'proposers']], 'T10i: the seat\'s own row carries the route');
  assert.deepEqual(fr.sorting.map(x => [x.id, x.sort, x.route]), [[OPEN, 'must_do', 'proposers']], 'T10i: the run ends with the route recorded on the must-do (FAIL = the route is not recorded)');
  assert.equal(fr.sorting[0].reasons.find(x => x.seat === 'lc').route, 'proposers');
  // T10k: a routed must-do is not closed by the closing read, even for an objection the ruling would let close (rated low): closedAtClose is the closure's own rule (src/sorting.js). Control: every seat saying may_leave closes it.
  const openRow = [{ key: 'k', id: OPEN, closes: true }];
  assert.equal(closedAtClose({ finalRead: fr, open: openRow }).size, 0, 'T10k: the must-do stays open (FAIL = it is closed)');
  const bothLeave = await scn({ 'final-read-lc': metWith([{ id: OPEN, sort: 'may_leave', reason: 'Minor.' }]), 'final-read-ld': metWith([{ id: OPEN, sort: 'may_leave', reason: 'Minor.' }]) });
  assert.equal(closedAtClose({ finalRead: bothLeave.result.finalRead, open: openRow }).size, 1, 'control: both seats may_leave closes it');
  assert.equal(r.result.proposerReturns, undefined, 'no return row: a closing read recommends, it does not start');
  // REMOVED (0.8.4 apply, K7): control 1, the S9-words-held run (`scn(..., { held: SORTING })`) that expected 'held: no route key on the combined row' (job 12: `[['route']]` actual, `[]` expected). SORTING names only the rating demand and the S8 words; the S9 words are recorded (src/roles.js), so they fall through and the route IS read. Sibling (same test): the `fr.sorting` / `fr.seats` route assertions above (route 'proposers' recorded on the combined row and the seat's row) and the pure-readers test below (readSorting without opts.route gives S8's rows key for key: the 'no route key' state is still pinned there, on the reader).
  // control 2: the in-loop twin (a decision-level objection of layer 3 in a round that has a next round) makes the 9 calls
  assert.equal(returnLabels((await loopRun()).served).length, 9);
  setHeldForTest(null);
});

test('T10i/T10k twin: an ld that says may_leave does not take the route off the must-do (any must-do wins, D12); a writer route and a proposers route from two seats combine to proposers', async () => {
  const a = await scn({ 'final-read-lc': metWith([MUSTDO('writer')]), 'final-read-ld': metWith([{ id: OPEN, sort: 'may_leave', reason: 'Minor.' }]) });
  premise(a);
  assert.deepEqual(a.result.finalRead.sorting.map(x => [x.sort, x.route]), [['must_do', 'writer']]);
  const b = await scn({ 'final-read-lc': metWith([MUSTDO('writer')]), 'final-read-ld': metWith([MUSTDO('proposers')]) });
  premise(b);
  assert.deepEqual(b.result.finalRead.sorting.map(x => [x.sort, x.route]), [['must_do', 'proposers']], 'proposers wins, as any must-do wins');
});

test('T10j (Q9, Q10): a must-do FIRST raised in a closing read (an entry with no id and no quoted passage) that cites a decision and names the route proposers: the late finding it becomes carries the recommended route proposers on `sorted` and on the seat\'s own reason (FAIL = it is routed to the writer only because it was first raised in a closing read)', async () => {
  // CHANGED ACCEPTED TEST (0.8.4, C&C ruling 12 Nov 2026: the OPEN item of job 12 row T10j is closed as W31's approved wording, not a defect). OLD: the fresh entry quoted 'retries failed requests', a passage that IS in the plan; with W31 recorded such an entry becomes an OBJECTION of the final read (src/chain.js:1776-1790) with its text (criterion, problem, quote, id) and the route the model gave is not recorded (box job 50: result.finalRead.seats[lc].failures, no route anywhere in the result). NEW: the entry quotes no passage, so it is not an objection and stays a late finding; the recommended route must be on it. WHY: a quote in the plan makes an objection by his approved wording; the route is the subject of this row. If the route is missing here too it is a lost state and goes back to C&C.
  const fresh = { sort: 'must_do', reason: 'Decision 1 stores everything in one place.', criterion: CRITERION, decision: 'Decision 1', route: 'proposers' };
  const r = await scn({ 'final-read-lc': metWith([fresh]), 'final-read-ld': MET });
  premise(r);
  const lc = r.result.finalRead.seats.find(e => e.lab === 'lc');
  assert.equal(lc.sorting_new?.[0]?.route, 'proposers', 'the fresh entry keeps the route');
  const late = (r.result.lateFindings ?? []).filter(x => x.found === 'final_read');
  assert.equal(late.length, 1, 'the new defect is a late finding');
  assert.equal(late[0].sorted.sort, 'must_do');
  assert.equal(late[0].sorted.route, 'proposers', 'T10j: the recommended route is proposers');
  assert.equal(late[0].sorted.reasons[0].route, 'proposers');
  assert.equal(returnLabels(r.served).length, 0, 'recommended, not started');
  const writerOnly = await scn({ 'final-read-lc': metWith([{ ...fresh, route: 'writer' }]), 'final-read-ld': MET });
  assert.equal((writerOnly.result.lateFindings ?? []).filter(x => x.found === 'final_read')[0].sorted.route, 'writer', 'control: the same entry naming the writer is recorded as writer');
});

test('T20n (D29): a closing read whose sorting names the route proposers on a chain with NO proposer seat is read as the route writer and recorded as read so (route writer, route_asked proposers); NO retry call: the calls asked are those of the run whose seat named the writer', async () => {
  const asked = await scn({ 'final-read-lc': metWith([MUSTDO('proposers')]), 'final-read-ld': MET }, { proposers: 0 });
  premise(asked);
  const twin = await scn({ 'final-read-lc': metWith([MUSTDO('writer')]), 'final-read-ld': MET }, { proposers: 0 });
  premise(twin);
  assert.deepEqual(asked.result.finalRead.sorting.map(x => [x.sort, x.route, x.route_asked]), [['must_do', 'writer', 'proposers']], 'read as writer, recorded as read so');
  assert.deepEqual(twin.result.finalRead.sorting.map(x => [x.sort, x.route, x.route_asked]), [['must_do', 'writer', undefined]]);
  assert.deepEqual([...asked.served].sort(), [...twin.served].sort(), 'FAIL = a retry call is made (the labels asked differ from the run that named the writer)');
  assert.equal(asked.result.finalRead.seats.find(e => e.lab === 'lc').sorting[0].route_asked, 'proposers');
  // control: with proposer seats the same words are read as proposers
  const withProps = await scn({ 'final-read-lc': metWith([MUSTDO('proposers')]), 'final-read-ld': MET }, { proposers: 3 });
  assert.deepEqual(withProps.result.finalRead.sorting.map(x => [x.route, x.route_asked]), [['proposers', undefined]]);
});

test('T20z (D29, Q10(f)): the same chain with no proposer seat and the same closing read: NO return starts (0 return-* calls); with proposer seats and a decision-level objection in the loop the 9 calls are made (control)', async () => {
  const r = await scn({ 'final-read-lc': metWith([MUSTDO('proposers')]), 'final-read-ld': MET }, { proposers: 0 });
  premise(r);
  assert.equal(returnLabels(r.served).length, 0, 'FAIL = a return starts');
  assert.equal(r.result.proposerReturns, undefined);
  assert.equal(returnLabels((await loopRun({ proposers: 3 })).served).length, 9, 'control');
  setHeldForTest(null);
});

test('a route that is neither writer nor proposers is not read as a route: it is kept as route_unread (capped), never as a route; a route on a may-leave is not read', async () => {
  const r = await scn({ 'final-read-lc': metWith([MUSTDO('both')]), 'final-read-ld': MET });
  premise(r);
  const row = r.result.finalRead.seats.find(e => e.lab === 'lc').sorting[0];
  assert.deepEqual([row.route, row.route_unread], [undefined, 'both']);
  assert.deepEqual(r.result.finalRead.sorting.map(x => x.route), [undefined]);
  const may = readSorting([{ id: 'O-a', sort: 'may_leave', reason: 'x', route: 'proposers' }], new Set(['O-a']), { route: true, proposers: true });
  assert.deepEqual(Object.keys(may.rows[0]).filter(k => k.startsWith('route')), []);
});

test('prompt wiring: with the S9 words recorded the layer-3 read\'s system text carries the route key after the final read\'s reply form ("writer" or "proposers"); with NO proposer seat W29(i) takes the place of W7\'s route clause and the key names the writer only', async () => {
  const on = await scn({ 'final-read-lc': MET, 'final-read-ld': MET });
  premise(on);
  const sys = on.prompts.get('final-read-lc').system;
  assert.ok(sys.includes(HS9.layerThreeSortingRouteClause()), 'W7\'s own route clause is there when the chain has proposers');
  assert.ok(sys.includes(HS9.layerThreeSortingRouteKey({ proposers: true })));
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'prompt wiring: with the S9 words recorded'): OLD: `sys.indexOf(HS8.layerThreeSortingForm()) < sys.indexOf(key)`. NEW: the same comparison against the final read's recorded reply form, with the form required to be present (indexOf >= 0). WHY: this is the FINAL read, whose system text carries finalReadSortingForm in place of S8's form (src/stage-system.js:109, W31 recorded), so the old comparison read `-1 < n` and held whatever the order was (a vacuous pass that the row error below it hid).
  assert.ok(sys.indexOf(RC.finalReadSortingForm()) >= 0 && sys.indexOf(RC.finalReadSortingForm()) < sys.indexOf(HS9.layerThreeSortingRouteKey({ proposers: true })), 'the key comes after the reply form');
  const none = await scn({ 'final-read-lc': MET, 'final-read-ld': MET }, { proposers: 0 });
  premise(none);
  const s0 = none.prompts.get('final-read-lc').system;
  assert.ok(s0.includes(HS9.noProposerSortingRouteClause()) && !s0.includes(HS9.layerThreeSortingRouteClause()), 'W29(i) replaces W7\'s clause exactly');
  assert.ok(s0.includes(HS9.layerThreeSortingRouteKey({ proposers: false })) && !s0.includes('"writer" or "proposers"'));
  // REMOVED (0.8.4 apply, K7, job 12 row 'prompt wiring: with the S9 words recorded'): the HELD-S9 half (`scn(..., { held: SORTING })`, then 'held: S8's text, byte for byte': W7 whole, no route key, no W29(i) clause). WHY: error 'The expression evaluated to a falsy value: assert.ok(sh.includes(HS8.layerThreeSortingRule()) && ...)': the S9 words (layerThreeSortingRouteKey, noProposerSortingRouteClause, decisionLevelRule/Keys) are recorded (src/prompts/recorded-084-s9.js), so a map that leaves them out falls through to them and no shipped final read carries S8's text alone (W7 itself is also edited by W31/W32 at the final read). Sibling in the SAME test (the recorded-state half): the `on` run above (route clause present, key after the form) and the `none` run (W29(i) replaces W7's route clause, writer-only key), then the `noRule` run below (no Decisions rule: no route key).
  const noRule = await scn({ 'final-read-lc': MET, 'final-read-ld': MET }, { decisions: false });
  premise(noRule);
  assert.ok(!noRule.prompts.get('final-read-lc').system.includes(HS9.layerThreeSortingRouteKey({ proposers: true })), 'no Decisions rule: no route key');
});

test('the pure readers: readSorting reads the route only with opts.route (S8\'s rows otherwise, key for key); a stray proposers on a chain with none is writer + route_asked; combineSortings and routeSummaryOf; withSorted and withSortedPerSeat carry it', () => {
  const raw = [{ id: 'O-a', sort: 'must_do', reason: 'r', criterion: 'c', route: 'proposers' }, { id: 'O-b', sort: 'must_do', reason: 'r', criterion: 'c', route: 'writer' }];
  const ids = new Set(['O-a', 'O-b']);
  assert.deepEqual(readSorting(raw, ids).rows, [{ id: 'O-a', sort: 'must_do', reason: 'r', criterion: 'c' }, { id: 'O-b', sort: 'must_do', reason: 'r', criterion: 'c' }], 'no opts: S8\'s reading, no route key');
  assert.deepEqual(readSorting(raw, ids, { route: false }).rows.map(x => x.route), [undefined, undefined]);
  assert.deepEqual(readSorting(raw, ids, { route: true, proposers: true }).rows.map(x => [x.route, x.route_asked]), [['proposers', undefined], ['writer', undefined]]);
  assert.deepEqual(readSorting(raw, ids, { route: true, proposers: false }).rows.map(x => [x.route, x.route_asked]), [['writer', 'proposers'], ['writer', undefined]]);
  const c = combineSortings([{ seat: 'lc', rows: [{ id: 'O-a', sort: 'must_do', reason: 'x', route: 'writer' }] }, { seat: 'ld', rows: [{ id: 'O-a', sort: 'must_do', reason: 'y', route: 'proposers' }] }]);
  assert.deepEqual([c[0].route, c[0].reasons.map(x => x.route)], ['proposers', ['writer', 'proposers']]);
  assert.deepEqual(combineSortings([{ seat: 'lc', rows: [{ id: 'O-a', sort: 'must_do', reason: 'x' }] }]).map(x => Object.keys(x).filter(k => k.startsWith('route'))), [[]], 'no route named: no key');
  assert.deepEqual(SO.routeSummaryOf?.([{ sort: 'may_leave', route: 'proposers' }, { sort: 'must_do', route: 'writer', route_asked: 'proposers' }]), { route: 'writer', route_asked: 'proposers' }, 'only a must-do word counts');
  assert.deepEqual(SO.routeSummaryOf?.([]), {});
  const rows = [{ id: 'L-1', found: 'last_verdict', sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'x', route: 'writer' }] } }];
  const per = withSortedPerSeat(rows, [{ seat: 'ld', rows: [{ id: 'L-1', sort: 'must_do', reason: 'z', route: 'proposers' }] }]);
  assert.equal(per[0].sorted.route, 'proposers', 'a later word of another seat is added; proposers wins');
  const ws = withSorted([{ id: 'L-2', sorted: null }], [{ id: 'L-2', sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'x', route: 'proposers' }] }]);
  assert.equal(ws[0].sorted.route, 'proposers');
});

test('the record: a report with a route on the sorting rows validates against report-v1 (the entry, the combined row and the late finding), and the three route fields are described', async () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const fresh = { sort: 'must_do', reason: 'Decision 1 stores everything in one place.', quote: 'retries failed requests', criterion: CRITERION, decision: 'Decision 1', route: 'proposers' };
  const r = await scn({ 'final-read-lc': metWith([MUSTDO('proposers'), fresh]), 'final-read-ld': MET });
  premise(r);
  const config = { name: 'fixture-l2', signoff: 'unanimous', answer_back: { enabled: true }, decisions: { enabled: true }, seats: seatsWith(3) };
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-route', chain: 'fixture-l2', task: 't.md', result: r.result, config })));
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.equal(report.final_read.sorting[0].route, 'proposers');
  const items = schema.properties.final_read.properties.sorting.items.properties;
  for (const k of ['route', 'route_asked', 'route_unread']) assert.ok(typeof items[k].description === 'string' && items[k].description.length > 20, k);
});
