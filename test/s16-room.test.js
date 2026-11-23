// 0.8.4 S16 (Q9(f), route 4): the ROOM of a layer-3 seat in the final read and the PARTS of a list that does not fit it. The room is an input (setFinalReadRoomsForTest); the part sentence is the plan's W42, injected as the held word (inert without it).
// Pure rows: NEW-A13-1 (packing), T21bo (the order), T21bp (Cp). Run rows: T21bq (one part), T21n / T21ba / T21bn / T21bo (two parts), T21ce (no room), T21cf (a row no part can hold). Offline, mock seats, $0.
// T21ce / T21cf are PARTIAL: with both seats unread the run should pause (D: the final-read stop), which is built later; here the seat that has no room is named as not having read and is not called.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy, setOutboundScan, setFinalReadRoomsForTest, classifyUnreadable, FINAL_READ_NO_ROOM_WHY, FINAL_READ_OVERSIZE_WHY } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { orderForParts, packParts, extraPartCalls } from '../src/final-read-room.js';
import { sortingItemsOf } from '../src/sorting.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';
import { layerThreeSortingItems } from './held-prompts/held-084-s8.js';
import { finalReadPartRule } from './held-prompts/held-084-s16.js';
import { finalReadPartRule as RECORDED_PART_RULE } from '../src/roles.js';   // the RECORDED part sentence: the expected text below comes from here
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); setFinalReadRoomsForTest(null); });

test('NEW-A13-1 (pure): 29 open rows of 3000 characters each against a room of 44800 are 3 parts of 14, 14 and 1 rows (2 parts is the failing case)', () => {
  const rows = Array.from({ length: 29 }, (_, i) => ({ id: `O-${String(i).padStart(8, '0')}`, kind: 'objection', layer: 1, rating: 5, first_round: 1, flags: [], problem: 'x'.repeat(3000 - 70) }));
  const render = items => layerThreeSortingItems({ items });
  const line = render([rows[0]]).split('\n').slice(1).join('\n');
  assert.ok(line.length >= 3000 - 5 && line.length <= 3000 + 5, `premise: a printed row is about 3000 characters (${line.length})`);
  const { parts, oversize } = packParts(orderForParts(rows), items => render(items).length <= 44800);
  assert.equal(oversize, null);
  assert.deepEqual(parts.map(p => p.length), [14, 14, 1]);
});

test('T21bo (pure): the plan\'s order is the highest rating first, then the oldest, then the id; an unrated row reads as the highest (the ledger\'s own rule)', () => {
  const it = (id, rating, first_round) => ({ id, rating, first_round });
  assert.deepEqual(orderForParts([it('O-b', 3, 1), it('O-a', 9, 2), it('O-c', 9, 1), it('O-d', null, 3), it('O-e', 3, 1), it('O-0', 5, 1)]).map(x => x.id), ['O-d', 'O-c', 'O-a', 'O-0', 'O-b', 'O-e']);
});

test('T21bp (pure): the extra parts of one read are Cp = 2 x K3 x (p_L - 1): 4 at p_L = 2 for two seats, 0 for one part', () => {
  assert.equal(extraPartCalls(2, 2), 4);
  assert.equal(extraPartCalls(2, 1), 0);
  assert.equal(extraPartCalls(2, 3), 8);
});

// The fixture: the T9g shape (a finish after pass 1; la's objections stop the climb before layer 3, so lc and ld have never read the plan and the closing read asks both) with five open objections of different ratings.
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
// An objection id is per seat AND criterion, so five open objections need five criteria.
const CR = [CRITERION, 'The plan names an owner for the worker.', 'The plan states a timeout.', 'The plan names a rollback step.', 'The plan defines what is logged.'];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the five scripted failures carried a rating but no `relation`. NEW: each says `relation: 'new'` (la's first raise, in pass 1). WHY: relationRule recorded (src/chain.js relation gate).
const fail = (n, severity) => ({ criterion: CR[n], problem: `Problem number ${n}: ${'detail '.repeat(30)}`, fix: 'Fix it.', quote: 'retries failed requests', severity, relation: 'new' });
const F = [fail(0, 9), fail(1, 8), fail(2, 6), fail(3, 5), fail(4, 4)];   // la raises all five in pass 1
const RAISE = JSON.stringify({ meets: false, criteria: CR.map(c => ({ criterion: c, verdict: 'FAILED', evidence: 'Missing.' })), failures: F, verdict_line: 'no' });
const idsOf = fs => fs.map(f => objectionId('la', f));
const withRows = (rows, extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', sorting: rows, ...extra });
const frLabelsOf = r => r.result.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));

async function run(overrides = {}, roomOf = null, lines = null) {
  setHeldForTest({ ...SORTING, finalReadPartRule });
  setOutboundScan({ finish: true });
  try {
    // the first probe run learns the ids (and the printed lengths) without any room set
    return await scenario({ answerBack: true, l1Severity: 9, critics: L3, overrides: { 'panel-1-la': RAISE, ...overrides }, extra: { criteria: CR }, cutLabels: ['revise-1'], lines });
  } finally { setOutboundScan({}); }
}

test('premise: the fixture ends not agreed on the finish; lc and ld never read the plan (la\'s objections stopped the climb before layer 3: last_read_sha null) and are asked; the open list holds five objections (five criteria)', async () => {
  const r = await run({ 'final-read-lc': MET, 'final-read-ld': MET });
  assert.equal(r.result.passed, false);
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-ld']);
  assert.deepEqual(r.result.finalRead.seats.map(e => [e.lab, e.last_read_sha]), [['lc', null], ['ld', null]], 'never-read seats, not coverage seats');
  const user = r.prompts.get('final-read-lc').user;
  for (const f of F) assert.ok(user.includes(objectionId('la', f)), 'every open objection is in the one prompt of an ordinary read');
});

test('T21bq: a list within the room of the layer-3 seats is read in ONE part: one call per seat, no part label, every open objection in the one prompt', async () => {
  setFinalReadRoomsForTest(new Map([['lc', 1e9], ['ld', 1e9]]));
  const r = await run({ 'final-read-lc': MET, 'final-read-ld': MET });
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-ld']);
  assert.ok(!r.prompts.get('final-read-lc').user.includes('read in 2 parts'));
});

test('T21ba / T21bn / T21bo and the part of T21n that is the room (a long list at a finish; the ledger_overflow end that T21n names is NOT driven here): a list longer than the room is read in two parts in the plan\'s order: the first part holds the highest-rated rows, the second is one extra call per seat (4 calls in all), sort-only; every open objection ends up sorted by each seat', async () => {
  // learn the rows from the ordinary read, then give each seat a room that holds three of the five rows (the printed list is measured with the same held function)
  const probe = await run({ 'final-read-lc': MET, 'final-read-ld': MET });
  // the items as the run builds them (src/chain.js openAtAgreement + sortingItemsOf with the same escaper): la's own failure (rating 9) and the four extra ones
  const R = await import('../src/roles.js');
  const raised = F;
  const listed = sortingItemsOf({ open: raised.map(f => ({ id: objectionId('la', f), lab: 'la', layer: 1, severity: f.severity, first_round: 1, flags: [], problem: f.problem })), wrap: R.claimText }).items;
  assert.equal(listed.length, 5, 'premise: five open objections');
  for (const x of listed) assert.ok(probe.prompts.get('final-read-lc').user.includes(x.id), 'premise: every one is in the ordinary read\'s one prompt');
  const ordered = orderForParts(listed);
  assert.deepEqual(ordered.map(x => x.rating), [...ordered.map(x => x.rating)].sort((a, b) => b - a), 'premise: the order is the ratings, highest first');
  const part1 = ordered.slice(0, 3); const part2 = ordered.slice(3);
  const room = layerThreeSortingItems({ items: part1 }).length + 60;   // the 'not debated' flag of a real item is a few characters; a fourth row is about 280
  assert.ok(layerThreeSortingItems({ items: ordered.slice(0, 4) }).length > room, 'premise: a fourth row does not fit');
  setFinalReadRoomsForTest(new Map([['lc', room], ['ld', room]]));
  const rows = (items, sort) => items.map(x => ({ id: x.id, sort, reason: `Reason for ${x.id}.`, ...(sort === 'must_do' ? { criterion: CRITERION } : {}) }));
  // the later part is answered with sorting rows for ITS ids, and also with a sign-off-looking verdict, an objection and a new defect, all of which must be ignored
  const later = items => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'x' }], failures: [{ criterion: CRITERION, problem: 'A new defect in a later part.', fix: 'f', quote: 'retries failed requests', severity: 7 }], verdict_line: 'no', sorting: rows(items, 'may_leave') });
  const r = await run({ 'final-read-lc': withRows(rows(part1, 'must_do')), 'final-read-ld': withRows(rows(part1, 'may_leave')), 'final-read-lc-part2': later(part2), 'final-read-ld-part2': later(part2) });
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-lc-part2', 'final-read-ld', 'final-read-ld-part2'], 'T21ba: one extra call per layer-3 seat for the second part, 4 calls in all (2 x K3), no re-ask');
  const p1 = r.prompts.get('final-read-lc').user; const p2 = r.prompts.get('final-read-lc-part2').user;
  for (const x of part1) { assert.ok(p1.includes(x.id) && !p2.includes(x.id), 'T21bo: part 1 holds the highest-rated rows'); }
  for (const x of part2) { assert.ok(p2.includes(x.id) && !p1.includes(x.id), 'and part 2 the rest'); }
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'T21ba / T21bn / T21bo'): OLD: /read in 2 parts, in the order of their ratings, and this is part 1\./ (and part 2). NEW: the whole recorded part sentence, RECORDED_PART_RULE({ n: 2, k }), which reads 'The open objections of this plan are read in 2 parts, from the highest rating down (unrated ones first), and this is part k. Sort each objection ...'. WHY: error 'The input did not match the regular expression /read in 2 parts, in the order of their ratings, and this is part 1./': the reviewed wording reworded the part sentence ('in the order of their ratings' became 'from the highest rating down (unrated ones first)'; src/prompts/recorded-084-s16.js finalReadPartRule, applied by f60ebad2). The pin is stronger than before: the whole sentence, not a fragment.
  assert.ok(p1.includes(RECORDED_PART_RULE({ n: 2, k: 1 })), 'part 1 carries the recorded part sentence');
  assert.ok(p2.includes(RECORDED_PART_RULE({ n: 2, k: 2 })), 'part 2 carries the recorded part sentence');
  for (const lab of ['lc', 'ld']) {
    const e = r.result.finalRead.seats.find(x => x.lab === lab);
    assert.deepEqual(e.sorting.map(x => x.id).sort(), ordered.map(x => x.id).sort(), `T21n: every open objection is sorted by ${lab} across the parts`);
    assert.equal(e.meets, true, 'T21bn: the verdict is part 1\'s; a later part signs nothing');
    assert.deepEqual(e.failures, [], 'T21bn: no objection is taken from a later part');
    assert.equal(e.sorting_new, undefined, 'T21bn: no new defect is taken from a later part');
  }
  assert.ok(!(r.result.lateFindings ?? []).some(l => /later part/.test(l.problem ?? '')), 'T21bn: no late finding is taken from a later part');
});

test('W42 (run): a later part is read for its sorting ALONE: a reply that carries only `sorting` (one seat) and a reply with an unrated objection and no table (the other) are both read at the first ask, with no re-ask, and every id ends up sorted by both seats', async () => {
  const R = await import('../src/roles.js');
  const raised = F;
  const ordered = orderForParts(sortingItemsOf({ open: raised.map(f => ({ id: objectionId('la', f), lab: 'la', layer: 1, severity: f.severity, first_round: 1, flags: [], problem: f.problem })), wrap: R.claimText }).items);
  const part1 = ordered.slice(0, 3); const part2 = ordered.slice(3);
  const room = layerThreeSortingItems({ items: part1 }).length + 60;
  setFinalReadRoomsForTest(new Map([['lc', room], ['ld', room]]));
  const rows = (items, sort) => items.map(x => ({ id: x.id, sort, reason: `Reason for ${x.id}.`, ...(sort === 'must_do' ? { criterion: CRITERION } : {}) }));
  const onlySorting = JSON.stringify({ sorting: rows(part2, 'may_leave') });
  const unratedObjection = JSON.stringify({ meets: false, failures: [{ criterion: CRITERION, problem: 'Ignored in a later part.', fix: 'f' }], sorting: rows(part2, 'may_leave') });
  const r = await run({ 'final-read-lc': withRows(rows(part1, 'must_do')), 'final-read-ld': withRows(rows(part1, 'may_leave')), 'final-read-lc-part2': onlySorting, 'final-read-ld-part2': unratedObjection });
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-lc-part2', 'final-read-ld', 'final-read-ld-part2'], 'no re-ask: both later-part replies were read at the first ask');
  for (const lab of ['lc', 'ld']) {
    const e = r.result.finalRead.seats.find(x => x.lab === lab);
    assert.equal(e.parts_unread, undefined);
    assert.deepEqual(e.sorting.map(x => x.id).sort(), ordered.map(x => x.id).sort(), `every id is sorted by ${lab}`);
  }
});

test('a later part that cannot be read after its one re-ask: the seat keeps part 1, the part is named on its entry (parts_unread) and in the log, its ids have no word from the seat, and the other seat is unaffected', async () => {
  const R = await import('../src/roles.js');
  const raised = F;
  const ordered = orderForParts(sortingItemsOf({ open: raised.map(f => ({ id: objectionId('la', f), lab: 'la', layer: 1, severity: f.severity, first_round: 1, flags: [], problem: f.problem })), wrap: R.claimText }).items);
  const part1 = ordered.slice(0, 3); const part2 = ordered.slice(3);
  const room = layerThreeSortingItems({ items: part1 }).length + 60;
  setFinalReadRoomsForTest(new Map([['lc', room], ['ld', room]]));
  const rows = (items, sort) => items.map(x => ({ id: x.id, sort, reason: `Reason for ${x.id}.`, ...(sort === 'must_do' ? { criterion: CRITERION } : {}) }));
  const good2 = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'x' }], failures: [], verdict_line: 'ok', sorting: rows(part2, 'may_leave') });
  const lines = [];
  const r = await run({ 'final-read-lc': withRows(rows(part1, 'must_do')), 'final-read-ld': withRows(rows(part1, 'may_leave')), 'final-read-lc-part2': 'not json at all', 'final-read-lc-part2-reask1': 'still not json', 'final-read-ld-part2': good2 }, null, lines);
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-lc-part2', 'final-read-lc-part2-reask1', 'final-read-ld', 'final-read-ld-part2']);
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc'); const ld = r.result.finalRead.seats.find(s => s.lab === 'ld');
  assert.deepEqual(lc.parts_unread, [{ label: 'final-read-lc-part2', why: classifyUnreadable(r.result.stages.find(s => s.label === 'final-read-lc-part2-reask1').usage, 3000) }], 'C&C 09 Nov: one object per unread part, the label of its first ask and the cause of its last attempt (the same classification part 1 uses)');
  assert.ok(lines.some(l => l.includes('the part of the list asked as "final-read-lc-part2" could not be read after one re-ask; the objections in it have no word from this seat and stand as must-do; its late findings have no word from this seat either, and a late finding counts only with the sorting of a seat that read it.')), 'WORDING S16-w12d');
  assert.deepEqual(lc.sorting.map(x => x.id).sort(), part1.map(x => x.id).sort(), 'the part-2 ids have no word from lc');
  assert.equal(ld.parts_unread, undefined);
  assert.deepEqual(ld.sorting.map(x => x.id).sort(), ordered.map(x => x.id).sort());
  const combined = r.result.finalRead.sorting;
  for (const x of part2) assert.equal(combined.find(c => c.id === x.id)?.sort, 'must_do', 'a part-2 id that only ld said may-leave stands as must-do: lc gave no word');
});

test('T21ce (partial): a seat whose room is zero or less is not called and is named as not having read, with the cause; the other seat reads as usual', async () => {
  setFinalReadRoomsForTest(new Map([['lc', 0], ['ld', 1e9]]));
  const r = await run({ 'final-read-lc': MET, 'final-read-ld': MET });
  assert.ok(!frLabelsOf(r).includes('final-read-lc') && frLabelsOf(r).includes('final-read-ld'), frLabelsOf(r).join(', '));
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc');
  assert.deepEqual([lc.read, lc.why, lc.reasked], [false, FINAL_READ_NO_ROOM_WHY, false]);
});

test('T21cf (partial): a row longer than a seat\'s whole room cannot be held by any part: that seat is not called and is named as not having read, with the cause', async () => {
  setFinalReadRoomsForTest(new Map([['lc', 40], ['ld', 1e9]]));
  const r = await run({ 'final-read-lc': MET, 'final-read-ld': MET });
  assert.ok(!frLabelsOf(r).includes('final-read-lc'));
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc');
  assert.deepEqual([lc.read, lc.why], [false, FINAL_READ_OVERSIZE_WHY]);
});

// T17ar / T17aq fixture (WHOLE-RUN rows of the S16 fix round): test/ending-exchange.test.js's FIX, plus a layer-3 seat 'lc', the answer-back ledger and a handoff. Own runner: `scenario` answers every non-panel label with plan text, which the ending exchange cannot read.
const EX_PLAN = '# Plan\n\nThe worker retries failed requests at most three times. Bake a cake. Sell it at the fair.';
const EX_CRIT = 'The plan defines a retry limit.';
const exSeat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const exChain = tag => ({ name: 'ending-parts', maxRounds: 1, signoff: 'unanimous', answer_back: { enabled: true }, handoff: true, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [exSeat(`mock-exch-support-keep-sev3-${tag}`, 'e1', 1), exSeat(`mock-exch-alt-keep-${tag}-clean`, 'e2', 1), exSeat(`mock-exch-new7-keep-${tag}-clean`, 'e3', 1), exSeat('mock-critic-x', 'e9', 2), exSeat('mock-critic-x', 'lc', 3)] } });
async function exRun(tag, scripted) {
  const prompts = new Map(); setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest({ ...SORTING, finalReadPartRule, lateFindingRule: HB084.lateFindingRule, lastRoundReplyRule: HB084.lastRoundReplyRule });
  setCache({ invalidate() {}, get: label => (label in scripted ? { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 30, output: 30 }, usd: 0 } : null) });
  return { result: await runChain({ request: 'A mock task.', log() {}, runId: 'r-t17ar', config: exChain(tag) }), prompts };
}
test('T17ar (run, Q9(f) route 4): a late finding of the ending exchange in a list too long for one part is shown in part 2, sorted by layer 3 there, and is a build obligation on the handoff only through that sorting (a part-2 reply with no row for it leaves it unsorted and unmarked)', async () => {
  const PROBLEM = 'The delay between retries is unbounded.'; const REASON = 'The defect holds: the plan sets no upper bound on the delay between retries.';
  const late = JSON.stringify({ posts: [], late_finding: [{ criterion: EX_CRIT, problem: PROBLEM, quote: 'at most three times', rating: 1 }] });
  const reply = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: EX_CRIT, verdict: 'MET', evidence: 'Section one sets the limit.' }], failures: [], verdict_line: 'ok', sorting });
  const base = { build: EX_PLAN, 'ldebate-end-x7-e1': late, handoff: '# Handoff\n\nBuild the plan.' };
  const probe = await exRun('t17arp', { ...base, 'final-read-lc': reply([]) });
  const lateId = probe.result.lateFindings?.find(l => l.problem === PROBLEM)?.id ?? 'no-late-id';
  const pp = probe.prompts.get('final-read-lc') ?? '';
  const listAll = pp.slice(Math.max(0, pp.lastIndexOf('The open objections and late findings to sort')));
  const others = [...listAll.matchAll(/^- ([OL]-[0-9a-f]{8}(?:#r?[0-9]+)?) \(/gm)].map(m => m[1]).filter(id => id !== lateId);
  setFinalReadRoomsForTest(new Map([['lc', listAll.length - 1]]));
  const part1 = reply(others.map(id => ({ id, sort: 'must_do', reason: `Reason for ${id}.`, criterion: EX_CRIT })));
  const part2 = JSON.stringify({ sorting: [{ id: lateId, sort: 'must_do', reason: REASON, criterion: EX_CRIT }] });
  const r = await exRun('t17arr', { ...base, 'final-read-lc': part1, 'final-read-lc-part2': part2 });
  const control = await exRun('t17arc', { ...base, 'final-read-lc': part1, 'final-read-lc-part2': JSON.stringify({ sorting: [] }) });
  const row = r.result.lateFindings?.find(l => l.problem === PROBLEM);
  const lineIn = res => (res.handoff ?? '').split('\n').find(l => l.startsWith(`- ${lateId} (`)) ?? '';
  assert.deepEqual([row?.sorted?.sort, row?.sorted?.seats, row?.sorted?.reasons?.map(x => x.reason)], ['must_do', ['lc'], [REASON]], `T17ar: layer 3 sorts late finding ${lateId} must-do, with its reason; asked: ${frLabelsOf(r).join(', ')}`);
  assert.deepEqual([row?.id, row?.found, row?.round, row?.rating, row?.not_debated], [lateId, 'ending_exchange_last_round', 7, 1, true], 'premise: found in round 7 of the ending exchange');
  assert.deepEqual([r.result.endingExchange?.ran, r.result.passed, r.result.finalRead?.run_end], [true, false, 'not_agreed'], 'premise: a not-agreed end after the ending exchange');
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-lc-part2'], 'two parts: one extra call');
  const p1 = r.prompts.get('final-read-lc') ?? ''; const p2 = r.prompts.get('final-read-lc-part2') ?? '';
  assert.ok(others.length >= 1 && p2.includes(lateId) && !p1.includes(lateId), 'the late finding is in part 2 and not in part 1');
  for (const id of others) assert.ok(p1.includes(id) && !p2.includes(id), `${id} is in part 1 only`);
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'T17ar'): OLD: /read in 2 parts, in the order of their ratings, and this is part 2\./. NEW: the whole recorded part sentence (RECORDED_PART_RULE({ n: 2, k: 2 })). WHY: error 'The input did not match the regular expression /read in 2 parts, in the order of their ratings, and this is part 2./': the part sentence was reworded at the wording review (see the row T21ba above).
  assert.ok(p2.includes(RECORDED_PART_RULE({ n: 2, k: 2 })), 'part 2 carries the recorded part sentence');
  assert.ok(r.result.finalRead?.seats?.find(e => e.lab === 'lc')?.sorting?.some(x => x.id === lateId && x.sort === 'must_do'), 'the seat entry carries the later part\'s row');
  assert.equal(r.result.finalRead?.sorting?.find(c => c.id === lateId)?.sort, 'must_do', 'and so does the combined sorting');
  assert.match(lineIn(r.result), /^- L-[0-9a-f]{8} \(e1; rating 1; sorted by layer 3: must-do\): /, 'the build list marks it must-do');
  assert.ok(lineIn(r.result).includes(`Layer 3's reason: ${REASON}`), 'with layer 3\'s reason');
  const cRow = control.result.lateFindings?.find(l => l.problem === PROBLEM);
  assert.equal(cRow?.sorted, null, 'control (S8-41): a part-2 reply with no row for it leaves it unsorted');
  assert.ok(lineIn(control.result).startsWith(`- ${lateId} (e1; rating 1`) && !/sorted by layer 3: must-do/.test(lineIn(control.result)), 'control: on the list, not marked must-do');
});
