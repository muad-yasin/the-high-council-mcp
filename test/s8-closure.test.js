// 0.8.4 S8 c3: the CLOSURE. At the end of the run, after the final read, an open objection every top-layer seat sorted may-leave and that the ruling's own predicate closes (rated below 4, never 7 or above) is CLOSED:
// its entry in dispute.open_objections gains closed_by: 'final_read' (nothing is removed), and the readers of what is open at the run's end read the entries that still stand (the dissent block is written again from them).
// Offline, mock seats, $0. The pure rows import src/sorting.js, src/final-read.js and src/late-finding.js through guards, so a tree without a function fails each row BY NAME.
// Run rows use the go-to-the-closing-read fixture of test/s8-sorting.test.js (layer 1 is finished at its revision bound on a recorded choice, so both layer-3 seats read once at the final read), with a rated-3 objection (closable)
// beside a rated-5 one (holds the plan), and the dispute stage on. The stop id and the dispute list are PREMISES: a wrong guess names itself.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget, earlyTasksFromReport } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { DEMAND, SORTING } from './helpers/rating-demand.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { scenario, idOf, CRITERION as SC_CRITERION } from './helpers/layer-two-run.js';
import { critic, chainOf } from './helpers/final-read-chain.js';
import { buildArguedFacts } from '../src/argued.js';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExternalPause } from '../src/chain.js';
import * as HESC from './held-prompts/held-escalation.js';
import { CHECK, answer } from './helpers/build-check.js';
import { checkT17i } from './helpers/s8-record-rows.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

let S = null; try { S = await import('../src/sorting.js'); } catch { S = null; }
let FR = null; try { FR = await import('../src/final-read.js'); } catch { FR = null; }
let TL = null; try { TL = await import('../src/top-layer.js'); } catch { TL = null; }
let VH = null; try { VH = await import('../src/verdict-headline.js'); } catch { VH = null; }
let RSS = null; try { RSS = await import('../src/run-status.js'); } catch { RSS = null; }
let LF = null; try { LF = await import('../src/late-finding.js'); } catch { LF = null; }
const fn = (mod, name) => { assert.ok(mod && typeof mod[name] === 'function', `${name} is exported`); return mod[name]; };

// ---- pure rows
const sorted = (...rows) => rows.map(([id, sort, reason = 'r']) => ({ id, sort, reason }));
const seatE = (lab, sorting, read = true) => ({ lab, layer: 3, label: `final-read-${lab}`, last_read_sha: null, reasked: false, read, ...(read ? { meets: true, failures: [] } : { why: 'unreadable' }), ...(sorting ? { sorting } : {}) });
const frOf = (seats, reused) => ({ ran: seats.length > 0, run_end: 'not_agreed', final_sha: 'abc', seats, ...(reused ? { reused } : {}) });
const reusedOf = (lab, sorting) => ({ lab, layer: 3, read_sha: 'abc', round: 2, statement: { verdict: 'signed_off' }, ...(sorting ? { sorting } : {}) });
const OPEN1 = [{ key: 'la\u0000O-1', id: 'O-1', closes: true }];

test('C3-1 closedAtClose: every top-layer seat may-leave on an id the ruling closes closes it', () => {
  const closedAtClose = fn(S, 'closedAtClose');
  const out = closedAtClose({ finalRead: frOf([seatE('lc', sorted(['O-1', 'may_leave'])), seatE('ld', sorted(['O-1', 'may_leave']))]), open: OPEN1 });
  assert.deepEqual([...out], ['la\u0000O-1']);
});

test('C3-2 closedAtClose (a re-tagged 7+ stays open): every seat may-leave but the ruling\'s predicate does not close it: nothing closes', () => {
  const closedAtClose = fn(S, 'closedAtClose');
  const fr = frOf([seatE('lc', sorted(['O-1', 'may_leave'])), seatE('ld', sorted(['O-1', 'may_leave']))]);
  assert.equal(closedAtClose({ finalRead: fr, open: [{ ...OPEN1[0], closes: false }] }).size, 0, 'closes false (rated 4 or above, unrated, or once rated 7 or above)');
  assert.equal(closedAtClose({ finalRead: fr, open: [{ key: 'la\u0000O-1', id: 'O-1' }] }).size, 0, 'no verdict of the predicate is not a close');
});

test('C3-3 closedAtClose (one seat is not enough): one seat may-leave and the other must-do, silent, without a sorting, or unread closes nothing', () => {
  const closedAtClose = fn(S, 'closedAtClose');
  const may = seatE('lc', sorted(['O-1', 'may_leave']));
  for (const [name, other] of [['must-do', seatE('ld', sorted(['O-1', 'must_do']))], ['silent on the id', seatE('ld', sorted(['O-9', 'may_leave']))], ['no sorting at all', seatE('ld', null)], ['unread', seatE('ld', null, false)]]) {
    assert.equal(closedAtClose({ finalRead: frOf([may, other]), open: OPEN1 }).size, 0, `the other seat is ${name}`);
  }
  assert.equal(closedAtClose({ finalRead: null, open: OPEN1 }).size, 0, 'no record');
  assert.equal(closedAtClose({ finalRead: frOf([]), open: OPEN1 }).size, 0, 'no seat, no word');
  assert.equal(closedAtClose({ finalRead: frOf([may, seatE('ld', sorted(['O-1', 'may_leave']))]), open: [{ key: 'x', id: undefined, closes: true }] }).size, 0, 'an entry with no id has no word');
});

test('C3-4 closedAtClose (through reused[]): a seat that did not need to read gives its sorting at its last verdict; the closing words of the seats that read and of the seats that did not are all needed', () => {
  const closedAtClose = fn(S, 'closedAtClose');
  const allReused = { ran: false, reason: 'every_top_seat_read_this_plan', run_end: 'agreed', final_sha: 'abc', seats: [], reused: [reusedOf('lc', sorted(['O-1', 'may_leave'])), reusedOf('ld', sorted(['O-1', 'may_leave']))] };
  assert.deepEqual([...closedAtClose({ finalRead: allReused, open: OPEN1 })], ['la\u0000O-1'], 'ran false: the closure comes through reused');
  const mixed = frOf([seatE('lc', sorted(['O-1', 'may_leave']))], [reusedOf('ld', sorted(['O-1', 'may_leave']))]);
  assert.deepEqual([...closedAtClose({ finalRead: mixed, open: OPEN1 })], ['la\u0000O-1'], 'one seat read, one is reused');
  const noWord = frOf([seatE('lc', sorted(['O-1', 'may_leave']))], [reusedOf('ld', null)]);
  assert.equal(closedAtClose({ finalRead: noWord, open: OPEN1 }).size, 0, 'a reused seat whose last verdict carried no sorting has no word');
});

test('C3-5 closedRowsOf and closingReasonsOf: only the marked entries, each with its seats\' own reasons', () => {
  const closedRowsOf = fn(S, 'closedRowsOf');
  const fr = frOf([seatE('lc', sorted(['O-1', 'may_leave', 'Minor.']))], [reusedOf('ld', sorted(['O-1', 'may_leave', 'Cosmetic.']))]);
  const dispute = { ran: true, open_objections: [{ criterion: 'c1', lab: 'la', id: 'O-1', problem: 'p1', closed_by: 'final_read' }, { criterion: 'c2', lab: 'la', id: 'O-2', problem: 'p2' }] };
  assert.deepEqual(closedRowsOf({ dispute, finalRead: fr }), [{ id: 'O-1', lab: 'la', criterion: 'c1', problem: 'p1', reasons: [{ seat: 'lc', reason: 'Minor.' }, { seat: 'ld', reason: 'Cosmetic.' }] }]);
  assert.deepEqual(closedRowsOf({ dispute: { ran: true, open_objections: [{ criterion: 'c2', id: 'O-2' }] }, finalRead: fr }), [], 'nothing marked, nothing closed');
  assert.deepEqual(closedRowsOf({ dispute: null, finalRead: fr }), []);
});

test('C3-6 the BOARD final-read section: the closed objections are listed after the seats\' rows; with no closed row the section is byte for byte what it was; with ran false it still shows them', () => {
  const render = fn(FR, 'renderFinalReadBoard');
  const rec = frOf([seatE('lc', sorted(['O-1', 'may_leave'])), seatE('ld', sorted(['O-1', 'may_leave']))]);
  const closed = [{ id: 'O-1', lab: 'la', criterion: 'The plan defines a retry limit', problem: 'p', reasons: [{ seat: 'lc', reason: 'Minor.' }, { seat: 'ld', reason: 'Cosmetic.' }] }];
  const base = render(rec);
  assert.match(base, /## Final read by layer 3/, 'premise: the section renders');
  assert.equal(render(rec, []), base, 'no closed row: byte for byte');
  const out = render(rec, closed);
  assert.ok(out.startsWith(base.replace(/\n$/, '')), 'the seats\' rows come first');
  assert.match(out, /Closed below 4 at layer 3's closing read \(every layer-3 seat sorted these may-leave; each is rated below 4 and was never rated 7 or above, so none is still open\):\n- O-1 \(raised by la\): The plan defines a retry limit\. lc: Minor\. \/ ld: Cosmetic\./);
  const none = { ran: false, reason: 'every_top_seat_read_this_plan', run_end: 'agreed', final_sha: 'abc', seats: [], reused: [{ lab: 'lc', layer: 3 }] };
  assert.equal(render(none), '', 'premise: ran false shows nothing without a closed row');
  const shown = render(none, closed);
  assert.match(shown, /## Final read by layer 3\n\nLayer 3 had already read the final plan \(plan id abc\), so it was not asked again\.\n\nClosed below 4 at layer 3's closing read/);
  assert.match(shown, /- O-1 \(raised by la\): The plan defines a retry limit\. lc: Minor\. \/ ld: Cosmetic\./);
});

test('C3-7 the HANDOFF section "Closed below 4": the problem and the reasons are escaped as model text, a full stop is added, no row leaves the handoff as it was', () => {
  const withClosed = fn(LF, 'withClosedBelowFour');
  const rows = [{ id: 'O-1', lab: 'la', criterion: 'c', problem: 'No retry limit', reasons: [{ seat: 'lc', reason: 'Minor.' }, { seat: 'ld', reason: 'Cosmetic' }] }];
  assert.equal(withClosed('# Handoff\n', [], s => s), '# Handoff\n');
  assert.equal(withClosed('# Handoff\n', null, s => s), '# Handoff\n');
  const out = withClosed('# Handoff\n', rows, s => `<w>${s}</w>`, 3);
  assert.equal(out, '# Handoff\n\n## Closed below 4\n\nLayer 3 read the final plan and sorted each of these may-leave. Each is rated below 4 and was never rated 7 or above, so each is closed: it is recorded here and is not required of the build.\n\n- O-1 (raised by la): <w>No retry limit.</w> Layer 3\'s reason: lc: <w>Minor.</w> / ld: <w>Cosmetic</w>\n');
});

test('C3-8 buildCheckDemanded: an item every top seat sorted may-leave that the predicate closes is not demanded; a must-do, an unsorted one and a may-leave the predicate does not close are', () => {
  const demanded = fn(S, 'buildCheckDemanded');
  const items = [{ id: 'A', sorted: { sort: 'may_leave' } }, { id: 'B', sorted: { sort: 'may_leave' } }, { id: 'C', sorted: { sort: 'must_do' } }, { id: 'D' }];
  assert.deepEqual(demanded(items, i => i.id === 'A'), ['B', 'C', 'D']);
  assert.deepEqual(demanded(items, () => false), ['A', 'B', 'C', 'D'], 'no close, all demanded: the list as it was');
  assert.deepEqual(demanded([], () => true), []);
});

test('C3-9 the build check\'s line: a sorted item says so with each seat\'s reason (escaped by the caller); an unsorted item reads as before with its problem inside the container', () => {
  const user = String(HB084.buildCheckUser({ plan: 'The plan.', sha: 'abc', layer: 3, items: [
    { id: 'O-1', layer: 1, severity: 3, flags: [], problem: 'Minor wording.', sorted: { sort: 'may_leave', reasons: [{ seat: 'lc', reason: 'Cosmetic.' }, { seat: 'ld', reason: 'Fine.' }] } },
    { id: 'O-2', layer: 1, severity: 5, flags: [], problem: 'Holds.', sorted: { sort: 'must_do', reasons: [{ seat: 'lc', reason: 'It does.' }] } },
    { id: 'O-3', layer: 2, severity: 5, flags: ['not debated'], problem: 'Unsorted.' }] }));
  assert.match(user, /- O-1 \(raised in layer 1; rated 3\.0; sorted by layer 3: may-leave\): <critic-claim>Minor wording\.<\/critic-claim> Layer 3's reason: lc: <critic-claim>Cosmetic\.<\/critic-claim> \/ ld: <critic-claim>Fine\.<\/critic-claim>/);
  assert.match(user, /- O-2 \(raised in layer 1; rated 5\.0; sorted by layer 3: must-do\): <critic-claim>Holds\.<\/critic-claim> Layer 3's reason: lc: <critic-claim>It does\.<\/critic-claim>/);
  assert.match(user, /- O-3 \(raised in layer 2; rated 5\.0; not debated; not yet sorted by layer 3: counts as must-do\): <critic-claim>Unsorted\.<\/critic-claim>$/);   // CHANGED (the first red run): the last line has no newline after it
});

test('C3-10 the handoff obligation sentence: a handoff that carries a finding layer 3 sorted or found says what is required; one that carries none does not', () => {
  const withLate = fn(LF, 'withLateFindings');
  const sortedRow = { id: 'L-aaaaaaaa', lab: 'lc', problem: 'No back-off.', rating: null, rating_read_as: '4 or above', flags: ['named_in_final_read'], found: 'final_read', round: 1, not_debated: true, sorted: { sort: 'must_do', seats: ['lc'], reasons: [{ seat: 'lc', sort: 'must_do', reason: 'It holds.' }] } };
  const plainRow = { id: 'L-bbbbbbbb', lab: 'lc', problem: 'No owner.', rating: null, rating_read_as: '4 or above', flags: [], round: 1, not_debated: true, sorted: null };
  const touched = withLate('# H\n', [sortedRow], 3);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `A finding layer 3 sorted must-do is one to do, with layer 3's reason.` NEW: `A finding layer 3 sorted must-do is required of the build; its line gives layer 3's reason.` (K5; same for layer 2 in C3-26). WHY: the late-findings obligation sentence of src/late-finding.js (applied with the reviewed wording).
  assert.match(touched, /A finding layer 3 sorted must-do is required of the build; its line gives layer 3's reason\. A finding sorted may-leave is recorded and not required\. A finding not yet sorted by layer 3 is not required\./);
  const plain = withLate('# H\n', [plainRow], 3);
  assert.doesNotMatch(plain, /A finding layer 3 sorted must-do/, 'the untouched case reads as before');
});

test('C3-11 earlyTasksFromReport (the --from-run rebuild) leaves out an objection the closing read closed, and returns null when none stands', () => {
  const o = (id, extra = {}) => ({ id, lab: 'la', criterion: 'c', problem: `p ${id}`, ...extra });
  const report = marks => ({ stop: { kind: 'early_finish', items: [] }, dispute: { ran: true, open_objections: marks } });
  assert.deepEqual(earlyTasksFromReport(report([o('O-1'), o('O-2', { closed_by: 'final_read' })])).map(t => t.id), ['O-1']);
  assert.equal(earlyTasksFromReport(report([o('O-2', { closed_by: 'final_read' })])), null, 'all closed: no tasks');
  assert.deepEqual(earlyTasksFromReport(report([o('O-1'), o('O-2')])).map(t => t.id), ['O-1', 'O-2'], 'nothing marked: as before');
});

test('C3-12 argued.js counts what stands: a marked entry is not an unresolved objection', () => {
  const dispute = { ran: true, reason: 'round_cap', open_objections: [{ lab: 'la', criterion: 'Closed criterion', problem: 'closed problem', first_raised_round: 1, closed_by: 'final_read' }, { lab: 'la', criterion: 'Standing criterion', problem: 'standing problem', first_raised_round: 1 }] };
  const facts = JSON.stringify(buildArguedFacts({ dispute }));
  assert.match(facts, /Standing criterion/, 'premise: the standing entry is in the facts');
  assert.doesNotMatch(facts, /Closed criterion/);
  assert.match(JSON.stringify(buildArguedFacts({ dispute: { ...dispute, open_objections: [dispute.open_objections[1]] } })), /"unresolved_objections":1/, 'premise: the count key');
  assert.match(facts, /"unresolved_objections":1/);
});

test('C3-13 the report schema accepts closed_by on a dispute entry (only the value final_read)', async () => {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile({ ...schema, required: [] });
  const entry = { criterion: 'c', lab: 'la', problem: 'p', id: 'O-0a1b2c3d', first_raised_round: 1 };
  const dispute = o => ({ ran: true, reason: 'round_cap', open_objections: [o], panel_rereviewed: false });
  assert.equal(validate({ dispute: dispute(entry) }), true, `premise: the entry without the marker validates: ${JSON.stringify(validate.errors)}`);
  assert.equal(validate({ dispute: dispute({ ...entry, closed_by: 'final_read' }) }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ dispute: dispute({ ...entry, closed_by: 'someone' }) }), false, 'an unknown value is refused');
});

// ---- run rows
const FINISH = { roundChoices: [{ choice: 'finish', stop: 'layer_bound:1:8', kind: 'layer_bound', why: 'revisions', layer: 1 }] };
const STOPPED = async f => { try { return await f(); } catch (e) { if (e && e.stop) throw new Error(`premise: the run stopped at ${e.stop.kind}:${e.stop.overseer_round}:${e.stop.pass} (why ${e.stop.why}, layer ${e.stop.layer}): the recorded finish names a different stop id`); throw e; } };
const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const LOW = idOf(3);   // rated 3 by la: closable
const HOLD = { criterion: SC_CRITERION, problem: 'No back-off is specified.', fix: 'Specify one.', quote: 'The worker', severity: 5, relation: 'new' };   // K1: relationRule is recorded
const HOLD_ID = objectionId('la', HOLD);   // rated 5 by la: holds the plan, and stays open whatever layer 3 says
const metWith = sorting => JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(sorting !== undefined ? { sorting } : {}) });
const rows = (low, hold) => [{ id: LOW, sort: low, reason: 'Minor wording.' }, { id: HOLD_ID, sort: hold, reason: 'Also minor.' }];
const closureRun = async (overrides, held = SORTING) => {
  setHeldForTest(held);
  const lines = [];
  const r = await STOPPED(() => scenario({ answerBack: true, l1Severity: 3, extraFailures: [HOLD], critics: L3, overrides, extra: { maxRounds: 1, final_read: { enabled: true }, dispute: { enabled: true } }, runExtra: { roundChoices: FINISH.roundChoices, log: l => lines.push(String(l)) } }));
  return { ...r, lines };
};
const premise = (r, { sorting = true } = {}) => {
  assert.equal(r.result.passed, false, 'premise: the run ends not agreed (on the recorded finish)');
  assert.ok(r.result.finalRead && r.result.finalRead.ran === true, 'premise: the closing read ran');
  assert.equal(r.result.dispute?.ran, true, 'premise: the dispute stage ran');
  assert.deepEqual((r.result.dispute.open_objections || []).map(o => o.id).sort(), [LOW, HOLD_ID].sort(), 'premise: the dispute list holds both objections');
  if (!sorting) return;
  const lc = r.result.finalRead.seats.find(e => e.lab === 'lc');
  assert.deepEqual((lc?.sorting || []).map(x => [x.id, x.sort]).sort(), [[HOLD_ID, 'may_leave'], [LOW, 'may_leave']].sort(), 'premise: both ids reached the sort list and lc\'s rows were read (a fixture miss names itself here, not at the closure)');
};
const entryOf = (r, id) => r.result.dispute.open_objections.find(o => o.id === id);
const ALL_MAY = { 'final-read-lc': metWith(rows('may_leave', 'may_leave')), 'final-read-ld': metWith(rows('may_leave', 'may_leave')) };

test('C3-14 (run) every layer-3 seat says may-leave: the rated-3 entry is MARKED and stays in dispute.open_objections; the rated-5 one stays open although every seat said may-leave; nothing is removed', async () => {
  const r = await closureRun(ALL_MAY);
  premise(r);
  assert.equal(r.result.dispute.open_objections.length, 2, 'nothing is removed from the list');
  assert.equal(entryOf(r, LOW).closed_by, 'final_read');
  assert.ok(!('closed_by' in entryOf(r, HOLD_ID)), 'rated 5: the ruling\'s predicate does not close it');
});

test('C3-15 (run) the deliverable\'s Unresolved dissent block is written again from the entries that stand: N counts them, the closed objection is not in it; the dispute-time log lines keep their N; the closure logs its own line', async () => {
  const r = await closureRun(ALL_MAY);
  premise(r);
  const block = r.result.deliverable.slice(r.result.deliverable.indexOf('## Unresolved dissent'));
  assert.match(block, /^## Unresolved dissent\n\n1 objection\(s\) were still open when this run stopped/);
  assert.match(block, /No back-off is specified\./);
  assert.doesNotMatch(block.slice(0, block.indexOf('\n---\n')), /No retry limit is specified\./, 'the closed objection is not listed in the dissent block');
  assert.match(r.result.deliverable, new RegExp(`- ${LOW} \\(raised by la[^\\n]*Final status: closed below 4 at layer 3's closing read \\(every layer-3 seat sorted it may-leave\\)\\.`), 'the escalated sign-off block says what became of it (C&C: one thing per objection)');
  assert.doesNotMatch(r.result.deliverable, /no final status is on record/, 'and no longer says that nothing is on record');
  assert.ok(r.lines.some(l => /Stage: dispute \(.*, 2 open objection\(s\)\)/.test(l)), 'the dispute-time N (2) stands in the log');
  assert.ok(r.lines.some(l => /recorded 2 unresolved objection\(s\) at the top of the deliverable/.test(l)), 'and in its recorded line');
  assert.ok(r.lines.some(l => l === `  final read: layer 3 closed 1 objection(s) rated below 4 (every layer-3 seat sorted them may-leave): ${LOW}.`), `the closure line: ${r.lines.filter(l => /final read:/.test(l)).join(' | ')}`);
});

test('C3-16 (run) signed_text.open_objections follows the entries that stand (1, not 2), and the run is still not agreed', async () => {
  const r = await closureRun(ALL_MAY);
  premise(r);
  assert.equal(r.result.signedText?.open_objections, 1, `signed_text.open_objections: ${JSON.stringify(r.result.signedText)}`);
  assert.equal(r.result.passed, false, 'the closure never turns a not-agreed end into agreed');
});

test('C3-17 (run, severity) the record is untouched by the closure: the closed entry stays in severity.swept (below 4), open_at_end holds only the rated-5 one', async () => {
  const r = await closureRun(ALL_MAY);
  premise(r);
  const sv = r.result.severityRun;
  assert.ok(sv && sv.computed === true, 'premise: the severity record was computed');
  assert.deepEqual((sv.swept || []).map(x => x.id), [LOW], 'the closed entry is still a sweep');
  assert.deepEqual((sv.open || []).map(x => x.id), [HOLD_ID], 'open_at_end holds only the rated-5 one');
});

test('C3-18 (run) one seat may-leave and the other must-do, or silent, closes nothing', async () => {
  for (const [name, ld] of [['must-do', metWith(rows('must_do', 'may_leave'))], ['silent', metWith([])]]) {
    const r = await closureRun({ 'final-read-lc': metWith(rows('may_leave', 'may_leave')), 'final-read-ld': ld });
    premise(r);
    assert.ok(r.result.dispute.open_objections.every(o => !('closed_by' in o)), `ld ${name}: nothing is marked`);
    assert.match(r.result.deliverable, /2 objection\(s\) were still open when this run stopped/, `ld ${name}: both stand`);
  }
});

test('C3-19 (NAMED PIN) with the S8 words recorded but replies that carry no sorting, the closure does nothing: nothing is marked, the dispute list keeps both objections, no "layer 3 closed" line', async () => {
  // CHANGED ACCEPTED TEST (0.8.4, C&C ruling 12 Nov 2026: the off half goes beside the on half). OLD: the first half ran the same run under the rating demand alone (`closureRun(ALL_MAY, DEMAND)`: the three S8 words held back, a map that sets 0.8.4 names undefined: banned) and the row compared the two runs' dispute record, deliverable and severity record by equality, with nothing marked in both. NEW: only the quiet half remains (the words recorded, replies that carry no sorting): premise, nothing marked, the dissent block's count line and no closing line. WHY: since dc60423a the three S8 words are recorded, so 'without the S8 words' can only be built with the banned held map; the real configuration that switches sorting off (answer_back off) was tried on the box (12 Nov 2026, first run of this row's re-aim) and its run ENDS AGREED (the premise 'the run ends not agreed' failed: true !== false), so it is not a comparable half. The on half is C3-14 (every seat says may-leave: marked), the sibling in this file.
  const quiet = await closureRun({ 'final-read-lc': metWith(), 'final-read-ld': metWith() });
  premise(quiet, { sorting: false });
  assert.ok(quiet.result.dispute.open_objections.every(o => !('closed_by' in o)), 'nothing is marked');
  assert.match(quiet.result.deliverable, /2 objection\(s\) were still open when this run stopped/);
  assert.ok(!quiet.lines.some(l => /final read: layer 3 closed/.test(l)));
  // CHANGED ACCEPTED TEST (0.8.4 apply, second commit; the C&C ruling "the off half goes beside the on half" was not carried out in b9d5ab09, which dropped the half and its two comparisons). The two records are asserted as FIELDS on this run: the severity record is as C3-17 pins it for the closing run (the rated-3 entry a sweep, only the rated-5 one open), and each dispute entry carries the rating in force (3 and 5; the list's ids and the missing closed_by are asserted above). RED (a named known-bad input copy of this test): the rated-3 objection raised as a 5 (l1Severity 5 in closureRun) leaves no sweep and both open, so the severity record assert (the first of the new ones) fails; the dispute rating assert would fail on the same input.
  const sv = quiet.result.severityRun;
  assert.ok(sv && sv.computed === true, 'premise: the severity record was computed');
  assert.deepEqual((sv.swept || []).map(x => x.id), [LOW], 'the severity record: the rated-3 entry is a sweep');
  assert.deepEqual((sv.open || []).map(x => x.id), [HOLD_ID], 'the severity record: only the rated-5 one is open at the end');
  assert.deepEqual([entryOf(quiet, LOW).severity, entryOf(quiet, HOLD_ID).severity], [3, 5], 'the dispute record: each entry carries the rating in force');
});

test('C3-20 (NAMED PIN) the sorting is on but the dispute stage never ran (every layer signed off): no marker, no dissent block, the record has no dispute list', async () => {
  setHeldForTest(SORTING);
  const chain = chainOf([critic('mock-critic-script-o-fra1-s8', 'l1', 1), critic('mock-critic-script-o-fra2-s8', 'l2', 2), critic('mock-critic-script-o-fra3-s8', 'l3', 3)], { answer_back: { enabled: true }, final_read: { enabled: true }, dispute: { enabled: true } });
  const result = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-c3-20', config: chain });
  assert.equal(result.passed, true, 'premise: every layer signed off');
  assert.notEqual(result.dispute?.ran, true, 'premise: the dispute stage did not run');
  assert.ok(!JSON.stringify(result.dispute ?? {}).includes('closed_by'));
  assert.doesNotMatch(result.deliverable, /Unresolved dissent/);
});

// ---- C&C 08 Nov (c3 items 1, 2b, 2c): the 7+ wiring, the dissent fixture, and the build check in a run.
const HESC_INJECT = () => ({ escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection });
const SEV7 = { criterion: SC_CRITERION, problem: 'No time-out is specified.', fix: 'Specify one.', quote: 'The worker retries', severity: 8, relation: 'new' };   // K1: relationRule is recorded
const SEV7_ID = objectionId('la', SEV7);   // rated 8 by la, re-tagged to 3 by the handler at pass 2: in force 3, but it was once rated 7 or above, so no overrule or sorting closes it

test('C3-21 (run, the 7+ wiring) an objection once rated 8 and re-tagged to 3 stays open although every layer-3 seat sorted it may-leave and the rated-3 one beside it is closed: the wiring from sevRun.closesOnOverrule to the closure', async () => {
  setHeldForTest(SORTING);
  const all = [LOW, HOLD_ID, SEV7_ID].map(id => ({ id, sort: 'may_leave', reason: 'Minor wording.' }));
  const r = await STOPPED(() => scenario({ answerBack: true, l1Severity: 3, extraFailures: [HOLD, SEV7], critics: L3, overrides: { 'final-read-lc': metWith(all), 'final-read-ld': metWith(all) }, extra: { maxRounds: 1, final_read: { enabled: true }, dispute: { enabled: true } },
    runExtra: { roundChoices: FINISH.roundChoices, retags: [{ pass: 2, id: SEV7_ID, severity: 3, reason: 'It does not change what is built.' }], log: () => {} } }));
  assert.equal(r.result.passed, false, 'premise: not agreed');
  assert.equal(r.result.dispute?.ran, true, 'premise: the dispute stage ran');
  assert.deepEqual((r.result.dispute.open_objections || []).map(o => o.id).sort(), [LOW, HOLD_ID, SEV7_ID].sort(), 'premise: the dispute list holds the three');
  assert.equal(entryOf(r, SEV7_ID).severity, 3, 'premise: the re-tag is in force (3)');
  const lc = r.result.finalRead.seats.find(e => e.lab === 'lc');
  assert.deepEqual((lc?.sorting || []).map(x => x.id).sort(), [LOW, HOLD_ID, SEV7_ID].sort(), 'premise: all three reached the sort list');
  assert.equal(entryOf(r, LOW).closed_by, 'final_read', 'the rated-3 one is closed');
  assert.ok(!('closed_by' in entryOf(r, SEV7_ID)), 'once rated 8: stays open although in force 3 and sorted may-leave by every seat');
  assert.ok(!('closed_by' in entryOf(r, HOLD_ID)), 'rated 5: stays open');
});

// The dissent pin (C&C item 1). The filter of dissentRows has NO run row yet (named gap): a survivor needs an objection overruled, REOPENED by a counted unquoted re-raise (chain.js reopenedAfter), re-tagged below 4 and then closed by the closing read. What this row pins, green on both trees:
// the go-up fixture of test/m1-dissent.test.js (layer 2 hits its bound; layer 3 overrules the block, which mid-beta rated 5, so the ruling closes nothing and it stays open), every layer-3 seat sorts it may-leave at the final read: because it is RATED 5 the closure does not touch it and it stays a dissent.
// The first box runs of this fixture also showed that its passes 4 to 6 do not replay under the rating demand and the final read (one escalation, at pass 3), so no re-tag was ever applied there.
const Y = { criterion: SC_CRITERION, problem: 'No owner is named.', quote: 'The worker' };
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: SC_CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker' };
const ratedY = { ...Y, severity: 5 };
const dsRow = f => ({ meets: false, criteria: [{ criterion: SC_CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [{ relation: 'new', ...f }], verdict_line: 'no' });   // K1: relationRule is recorded; a repeat passes its own `continues <id>`
const dsMeets = extra => JSON.stringify({ meets: true, criteria: [{ criterion: SC_CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const GOUP = { goUpRulingSystem: HB084.goUpRulingSystem, goUpRulingUser: HB084.goUpRulingUser, goUpRulingsSection: HB084.goUpRulingsSection };

test('C3-22 (NAMED PIN, green on both trees; renamed, C&C) a rated-5 overruled block stays a dissent after a may-leave sort: the closure does not touch an entry rated 5, it stays in the dispute list with its flag and in dissents', async () => {
  setHeldForTest({ ...SORTING, ...GOUP, dissentRecordSection: () => '' });
  const dsKeeps = (f, id) => JSON.stringify({ ...dsRow({ ...f, relation: `continues ${id}` }), answers: [{ id, status: 'sustained', evidence: 'No owner is named in section two.' }] });
  const dsRules = (id, reason) => JSON.stringify({ rulings: [{ id, ruling: 'overrule', reason }] });
  const idL3 = objectionId('top-gamma', L3F);
  const script = { 'panel-1-mid-beta': JSON.stringify(dsRow(ratedY)), 'panel-2-mid-beta': JSON.stringify(dsRow({ ...ratedY, relation: `continues ${idY}` })), 'rule-3-top-gamma': dsRules(idY, 'Section two names the owner.'), 'panel-3-top-gamma': JSON.stringify(dsRow(L3F)),
    'panel-4-mid-beta': dsKeeps(ratedY, idY), 'panel-5-mid-beta': dsKeeps(ratedY, idY), 'rule-6-top-gamma': dsRules(idY, 'Still covered by section two.'),
    'panel-6-top-gamma': dsMeets({ answers: [{ id: idL3, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] }),
    'final-read-top-gamma': dsMeets({ sorting: [{ id: idY, sort: 'may_leave', reason: 'Minor.' }] }) };   // the script as it ran in the first box rounds. The DS-3 passes 4 to 6 and the pass-5 re-tag never came; INFERRED, not shown by a run: L3F is unrated under the rating demand, so layer 3's pass-3 reply may have been refused and its re-ask taken the default sign-off
  setCache({ invalidate() {}, get(label) {
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    if (label.startsWith('build-check-')) return null;
    const text = label.startsWith('panel-') ? dsMeets() : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.';
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-c3-22', criteria: [SC_CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, final_read: { enabled: true }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: writer, reviser: writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-c3-22', log: () => {}, config, retags: [{ pass: 5, id: idY, severity: 3, reason: 'A missing owner does not change what is built.' }] });
  const entry = (result.dispute?.open_objections || []).find(o => o.id === idY);
  assert.ok(entry, 'premise: the block is in the dispute list');
  assert.equal(entry.severity, 5, 'premise: rated 5');
  assert.deepEqual((result.escalations || []).map(e => [e.pass, (e.outcome || []).filter(o => o.id === idY).map(o => [o.result, o.stays_open])]), [[3, [['overruled', true]]]], 'premise: overruled at pass 3 and it stays open');
  const top = (result.finalRead?.seats || []).find(e => e.lab === 'top-gamma');
  assert.deepEqual((top?.sorting || []).map(x => [x.id, x.sort]), [[idY, 'may_leave']], 'premise: the top seat sorted it may-leave at the final read');
  assert.ok(!('closed_by' in entry), 'rated 5: the closure does not close it');
  assert.ok((result.dissents || []).some(d => d.id === idY), 'it stays a dissent');
  assert.equal(entry.dissent, true, 'and its entry keeps the flag');
});

// The reopen fixture (C&C 08 Nov, item 3): the survivor path of the dissentRows filter, shown by reading. Y: an UNQUOTED objection of mid-beta (its id is the hash of the lab and the criterion), rated 5 in passes 1 and 2, so layer 2 reaches its bound and the plan goes up at pass 3;
// the handler re-tags it to 3 at pass 3, so layer 3's ruling there CLOSES it (rated below 4); mid-beta raises it again without a quote in pass 4: a COUNTED re-raise (chain.js reopenedAfter), so the ruling no longer closes it. Z: a quoted objection of mid-beta rated 5 from pass 4,
// which takes layer 2 to its bound again: the second go-up at pass 6 rules on Z (not on Y), layer 3 signs off, and the run ends at an escalated sign-off with Y standing (rated 3, never 7 or above) and Z. Every layer-3 seat sorts both may-leave at the final read: Y closes, Z (rated 5) does not.
// Under test, in this order: the premises (re-tag applied, the first ruling closed Y, the reopen counted, Y in the dispute list, Y closed by the closing read), then: Y is in no dissent row and its entry carries no dissent flag. Run on the tree WITHOUT the dissentRows filter: red = the filter is proven.
const Yu = { criterion: SC_CRITERION, problem: 'No owner is named.', severity: 5 };
const idYu = objectionId('mid-beta', Yu);
const Zq = { criterion: SC_CRITERION, problem: 'No back-off is named.', quote: 'retries failed requests', severity: 5 };
const idZq = objectionId('mid-beta', Zq);
const L3r = { criterion: SC_CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5 };
const idL3r = objectionId('top-gamma', L3r);

test('C3-28 (the reopen fixture; decides the dissentRows filter) an overruled objection the handler re-tagged to 3, reopened by a counted unquoted re-raise and closed by the closing read is in no dissent row and its entry carries no dissent flag', async t => {
  setHeldForTest({ ...SORTING, ...GOUP, dissentRecordSection: () => '' });
  const verdictOf = (failures, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: SC_CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no', ...extra });
  const rulesOf = (id, reason) => JSON.stringify({ rulings: [{ id, ruling: 'overrule', reason }] });
  const script = { 'panel-1-mid-beta': verdictOf([{ ...Yu, relation: 'new' }]), 'panel-2-mid-beta': verdictOf([{ ...Yu, relation: `continues ${idYu}` }]), 'rule-3-top-gamma': rulesOf(idYu, 'Section two names the owner.'), 'panel-3-top-gamma': verdictOf([{ ...L3r, relation: 'new' }]),
    'panel-4-mid-beta': verdictOf([{ ...Yu, relation: `reopens ${idYu}` }, { ...Zq, relation: 'new' }]), 'panel-5-mid-beta': verdictOf([{ ...Yu, relation: `continues ${idYu}` }, { ...Zq, relation: `continues ${idZq}` }], { answers: [{ id: idZq, status: 'sustained', evidence: 'No back-off is named in section two.' }] }),
    'rule-6-top-gamma': rulesOf(idZq, 'Section two names a back-off.'),
    'panel-6-top-gamma': dsMeets({ answers: [{ id: idL3r, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] }),
    'final-read-top-gamma': dsMeets({ sorting: [{ id: idYu, sort: 'may_leave', reason: 'Minor.' }, { id: idZq, sort: 'may_leave', reason: 'Minor too.' }] }) };
  setCache({ invalidate() {}, get(label) {
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    if (label.startsWith('build-check-')) return null;
    const text = label.startsWith('panel-') ? dsMeets() : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.';
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-c3-28', criteria: [SC_CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, final_read: { enabled: true }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: writer, reviser: writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-c3-28', log: () => {}, config, retags: [{ pass: 3, id: idYu, severity: 3, reason: 'A missing owner does not change what is built.' }] });
  const entries = result.dispute?.open_objections || [];
  const entry = entries.find(o => o.id === idYu);
  t.diagnostic(`passed ${result.passed}; layers ${JSON.stringify((result.layers || []).map(r => [r.round, r.layer, r.state]))}; escalations ${JSON.stringify((result.escalations || []).map(e => [e.pass, e.trigger, (e.outcome || []).map(o => [o.id === idYu ? 'Y' : o.id === idZq ? 'Z' : o.id, o.result, o.stays_open]), (e.raised_again || []).map(r => [r.id === idYu ? 'Y' : r.id, r.pass, r.counted === true])]))}`);
  t.diagnostic(`retags ${JSON.stringify((result.severityRun?.retags || []).map(x => [x.pass, x.id === idYu ? 'Y' : x.id, x.from, x.to, x.applied_to]))}; refused ${JSON.stringify(result.severityRun?.retags_refused ?? null)}; dispute ran ${result.dispute?.ran}; entries ${JSON.stringify(entries.map(o => [o.id === idYu ? 'Y' : o.id === idZq ? 'Z' : o.id, o.severity, o.closed_by ?? null, o.dissent === true]))}; dissents ${JSON.stringify((result.dissents || []).map(d => d.id === idYu ? 'Y' : d.id === idZq ? 'Z' : d.id))}; final read ran ${result.finalRead?.ran}; top sorting ${JSON.stringify((result.finalRead?.seats || []).find(e => e.lab === 'top-gamma')?.sorting?.map(x => [x.id === idYu ? 'Y' : x.id === idZq ? 'Z' : x.id, x.sort]) ?? null)}`);
  assert.ok((result.severityRun?.retags || []).some(x => x.id === idYu && (x.applied_to ?? x.to) === 3), 'premise: the re-tag to 3 was applied');
  const first = (result.escalations || []).find(e => e.pass === 3);
  assert.deepEqual((first?.outcome || []).filter(o => o.id === idYu).map(o => o.result), ['overruled'], 'premise: the first ruling overruled Y (the counted re-raise below proves it closed Y: only an id a ruling closed is filtered; stays_open is in the diagnostic)');
  assert.ok((first?.raised_again || []).some(r => r.id === idYu && r.counted === true), 'premise: mid-beta raised Y again without a quote and the re-raise was COUNTED (it reopens the id)');
  assert.ok(entry, 'premise: Y stands in the dispute list at the end');
  assert.equal(entry.closed_by, 'final_read', 'premise: the closing read closed Y (every layer-3 seat sorted it may-leave; rated 3, never 7 or above)');
  assert.ok(!(result.dissents || []).some(d => d.id === idYu), 'Y is in no dissent row');
  assert.ok(!('dissent' in entry), 'and its entry carries no dissent flag');
});

test('C3-23 (run, the build check; UB-10\'s fixture) a rated-3 objection layer 3 sorted may-leave at its climb verdict is SHOWN to the handler with its sort and reasons and is NOT demanded: the answer need not name it; the others are demanded as before', async () => {
  const Xo = { criterion: SC_CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 5 };
  const Yo = { criterion: SC_CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 5 };
  const Zo = { criterion: SC_CRITERION, problem: 'The wording is loose.', quote: 'failed requests', fix: 'Tighten it.', severity: 3 };
  const idX = objectionId('raiser', Xo); const idYo = objectionId('raiser', Yo); const idZ = objectionId('raiser', Zo);
  setHeldForTest({ ...HESC_INJECT(), ...DEMAND, ...SORTING, relationRule: HB084.relationRule, ...CHECK });
  const prompts = new Map(); setPromptSpy(p => { prompts.set(p.label, p); });
  let served = [];   // T17i: the labels of the run in progress, reset by every make()
  const row = v => ({ criterion: SC_CRITERION, verdict: v, evidence: 'Section two.' });
  const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
  const rel = (f, relation) => ({ ...f, relation });
  const topSorted = JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok', sorting: [{ id: idZ, sort: 'may_leave', reason: 'Loose wording only.' }, { id: idX, sort: 'must_do', reason: 'The limit is missing.', criterion: SC_CRITERION }, { id: idYo, sort: 'must_do', reason: 'No owner.', criterion: SC_CRITERION }] });
  const script = { 'panel-1-raiser': objects(rel(Xo, 'new'), rel(Zo, 'new')), 'panel-2-raiser': objects(rel(Xo, `continues ${idX}`), rel(Yo, 'new'), rel(Zo, `continues ${idZ}`)), 'rule-3-mid': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }), 'panel-3-top': topSorted };
  const make = extra => {
    served = [];
    setCache({ invalidate() {}, get(label) {
      served.push(label);
      const all = { ...script, ...extra };
      if (label in all) return { text: all[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
      if (label.startsWith('build-check-')) return null;
      const text = label.startsWith('panel-') ? JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' }) : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.';
      return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    } });
    const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
    const writer = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
    return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-c3-23', log: () => {}, config: { name: 'fixture-c3-23', criteria: [SC_CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4,
      seats: { builder: writer, reviser: writer, critics: [['raiser', 1], ['mid', 2], ['top', 3]].map(seat) } } });
  };
  const ask = await make({}).then(() => null, e => e);
  const served1 = served;
  assert.ok(ask instanceof ExternalPause && ask.label === 'build-check-1', `premise: the run waits at the build check: ${String(ask)}`);
  const line = id => new RegExp(`- ${id} \\(raised in layer 1; [^)]*\\): `);
  assert.ok((prompts.get('panel-3-top')?.user || '').includes(idZ), `premise: the top seat was shown ${idZ} at its climb verdict (otherwise its sorting of it is ignored and the fixture, not the code, fails)`);
  for (const i of [idX, idYo, idZ]) assert.match(ask.user, line(i), `premise: ${i} is on the build check's list`);
  assert.match(ask.user, new RegExp(`- ${idZ} \\(raised in layer 1; rated 3\\.0; sorted by layer 3: may-leave\\): .*Layer 3's reason: top: <critic-claim>Loose wording only\\.</critic-claim>`), 'the closable one is shown as sorted may-leave with the reason');
  assert.match(ask.user, new RegExp(`- ${idX} \\(raised in layer 1; rated 5\\.0; sorted by layer 3: must-do\\): .*Layer 3's reason: top: <critic-claim>The limit is missing\\.</critic-claim>`), 'a must-do says so');
  const result = await make({ 'build-check-1': answer('good_to_build', `${idX} and ${idYo}: the build can leave both, section two covers them.`) });
  assert.deepEqual(result.buildChecks[0].required, [idX, idYo].sort(), 'the rated-3 may-leave one is not demanded; the two that hold are');
  // CHANGED ACCEPTED (0.8.4 S8 rulings, T17i; C3-23 is S8's own row): OLD C3-23 did not look at the labels asked after layer 3's pass. NEW the stub records `served` per make() and checkT17i(served1, served) runs last: no revise-* between layer 3 and the build check, and after good_to_build no revise-* and no panel-4-*. WHY: the plan's exit list asks that a sorting opens no round. No existing assertion is changed or removed.
  checkT17i(served1, served);   // T17i (NAMED PIN for "the sorting opens no round"): no revision between layer 3 and the build check, and none (nor a pass 4) after good_to_build
});

// The CLI end summary (src/cli.js): no existing test pins its `open:` line (grep for "for human review" over test/ finds none), so this row pins today's line with nothing marked. `mock-dispute` ends not agreed on purpose (test/exit-not-agreed.test.js).
test('C3-24 (NAMED PIN, green on the parent) the end summary of a not-agreed run prints the open line with the number of failures of the last critique, and lists each one, when nothing is marked', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'thc-c3-24-'));
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a small reading list app.');
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'mock-dispute', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
    assert.equal(r.status, 22, `premise: the run ends not agreed: ${r.stdout}${r.stderr}`);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs')).sort()[0]);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    const failures = report.lastCritique?.failures ?? [];
    assert.ok(failures.length > 0, 'premise: the last critique holds failures');
    assert.ok(!(report.dispute?.open_objections || []).some(o => o.closed_by), 'premise: nothing is marked');
    const m = /^open: {5}(\d+) objection\(s\) for human review - the labs can be wrong, read the draft before acting on these$/m.exec(r.stdout);
    assert.ok(m, `the open line: ${r.stdout}`);
    assert.equal(Number(m[1]), failures.length, 'N is the number of failures of the last critique');
    for (const f of failures) assert.ok(r.stdout.includes(`  - ${f.lab ? `${f.lab}: ` : ''}${f.problem || f.criterion}`), `listed: ${f.problem || f.criterion}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- N from the run (C&C 08 Nov): a two-layer layered chain runs the final read with layer 2 on top, and every text of this family names that layer. A three-layer run (every shipped chain) reads as before (the existing pins stay on layer 3).
let ES = null; try { ES = await import('../src/escalation.js'); } catch { ES = null; }
let RS = null; try { RS = await import('../src/report-shape.js'); } catch { RS = null; }
const two = { ran: true, run_end: 'not_agreed', final_sha: 'abc', seats: [{ ...seatE('lb', null), layer: 2, meets: false, failures: [{ criterion: 'c', problem: 'p' }] }] };
const twoRows = [{ id: 'O-1', lab: 'la', criterion: 'The plan defines a retry limit', problem: 'No limit', reasons: [{ seat: 'lb', reason: 'Minor.' }] }];

test('C3-25 the final-read texts name the run\'s top layer: with layer 2 on top the deliverable block, the BOARD section and the log lines say layer 2; three layers read as they did', () => {
  const block = fn(FR, 'renderFinalReadBlock')(two);
  assert.match(block, /^## Layer 2 on the final plan\n\nThe run ended without agreement\. After the plan's last change, layer 2 was asked to read it\./);
  assert.doesNotMatch(block, /[Ll]ayer 3|layer-3/);
  const board = fn(FR, 'renderFinalReadBoard')(two, twoRows);
  assert.match(board, /^\n## Final read by layer 2\n\nThe run ended without agreement; layer 2 was asked to read the final plan \(plan id abc\)\./);
  assert.match(board, /Closed below 4 at layer 2's closing read \(every layer-2 seat sorted these may-leave;/);
  assert.doesNotMatch(board, /[Ll]ayer 3|layer-3/);
  const unreadTwo = [{ lab: 'lb', layer: 2, read: false, why: 'no reply' }];
  const lines = fn(FR, 'finalReadLogLines')(unreadTwo, 'agreed').join('\n');
  assert.match(lines, /NOT EVERY LAYER-2 SEAT READ THE FINAL PLAN/);
  assert.match(lines, /but not every layer-2 seat read the final plan\./);
  assert.doesNotMatch(lines, /LAYER-3|layer-3/);
  const three = { ...two, seats: two.seats.map(e => ({ ...e, layer: 3 })) };
  assert.match(fn(FR, 'renderFinalReadBlock')(three), /^## Layer 3 on the final plan\n\nThe run ended without agreement\. After the plan's last change, layer 3 was asked/);
  assert.match(fn(FR, 'renderFinalReadBoard')({ ran: false, run_end: 'agreed', final_sha: 'abc', seats: [] , reused: [{ lab: 'lb', layer: 2 }] }, twoRows), /Layer 2 had already read the final plan \(plan id abc\), so it was not asked again\./);
});

test('C3-26 the late-findings texts and the "Closed below 4" section name the run\'s top layer (a fourth argument, 3 by default)', () => {
  const sortedRow = { id: 'L-aaaaaaaa', lab: 'lb', problem: 'No back-off.', rating: null, rating_read_as: '4 or above', flags: ['named_in_final_read'], found: 'final_read', round: 1, not_debated: true, sorted: { sort: 'must_do', seats: ['lb'], reasons: [{ seat: 'lb', sort: 'must_do', reason: 'It holds.' }] } };
  const h = fn(LF, 'withLateFindings')('# H\n', [sortedRow], 2);
  assert.match(h, /Layer 2 found these defects where no round was left to debate them\./);
  assert.match(h, /A finding layer 2 sorted must-do is required of the build; its line gives layer 2's reason\. A finding sorted may-leave is recorded and not required\. A finding not yet sorted by layer 2 is not required\./);
  assert.match(h, /sorted by layer 2: must-do\)/);
  assert.match(h, /Layer 2's reason: It holds\./);
  assert.doesNotMatch(h, /[Ll]ayer 3/);
  const b = fn(LF, 'renderLateFindingsBoard')([sortedRow], 2);
  assert.match(b, /or by layer 2 at its final read or its last verdict; not debated\)/);
  assert.doesNotMatch(b, /[Ll]ayer 3/);
  const c = fn(LF, 'withClosedBelowFour')('# H\n', twoRows, s => s, 2);
  assert.match(c, /^# H\n\n## Closed below 4\n\nLayer 2 read the final plan and sorted each of these may-leave\./);
  assert.match(c, /Layer 2's reason: lb: Minor\./);
  assert.doesNotMatch(c, /[Ll]ayer 3/);
  assert.match(fn(LF, 'withLateFindings')('# H\n', [sortedRow], 3), /Layer 3 found these defects/, 'a three-layer run reads as before');
  assert.match(fn(LF, 'withLateFindings')('# H\n', [sortedRow]), /The top layer found these defects/, 'no layer named: the number-free words, never a 3');
  assert.doesNotMatch(fn(LF, 'withLateFindings')('# H\n', [sortedRow]), /[Ll]ayer 3/);
});

test('C3-27 the escalated sign-off block and the BOARD\'s passed-up section say the same status for an objection the closing read closed, with the run\'s top layer', () => {
  const ER = { round: 2, pass: 3, from_layer: 1, to_layer: 2, trigger: 'stall', ids: ['O-aaaa'], labs: ['la'], rulings: [], outcome: [{ id: 'O-aaaa', lab: 'la', layer: 1, first_round: 1, problem: 'No owner is named.', result: 'undecided', why: 'no_ruling' }] };
  const words = "closed below 4 at layer 2's closing read (every layer-2 seat sorted it may-leave)";
  const closed = new Set(['la\u0000O-aaaa']);
  const block = fn(ES, 'escalatedSignoffBlock')({ end: { pass: 3, layer: 2, below: [1] }, escalations: [ER], standing: new Set(), closed });
  assert.ok(block.includes(`Final status: ${words}.`), block);
  assert.ok(!block.includes('no final status is on record'));
  const open = fn(ES, 'escalatedSignoffBlock')({ end: { pass: 3, layer: 2, below: [1] }, escalations: [ER], standing: new Set() });
  assert.ok(open.includes('Final status: no final status is on record.'), 'premise: without the closed set the block says what it said');
  const board = fn(RS, 'renderEscalationsBoard')([ER], null, closed, 2);
  assert.ok(board.includes(`no ruling closed it (not every seat ruled on it); ${words}.`), board);
  assert.ok(fn(RS, 'renderEscalationsBoard')([ER], null).includes("it stands as la's."), 'without the closed set the board says what it said');
});

// ---- the fix-up after C&C's diff read of d3e6bcfd (a crash: `const stillOpen` at the function level of runChainStages shadowed the import from answer-back.js for the WHOLE function, and its calls ran before the declaration: a temporal-dead-zone ReferenceError that node --check cannot see)
test('C3-29 (SCAN PIN) no declaration at the function level of runChainStages (two-space indent) has the name of a binding chain.js imports: a shadowed import is a ReferenceError at every call that runs before the declaration', () => {
  const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  const imported = new Set();
  for (const m of src.matchAll(/^import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?(?:\*\s+as\s+(\w+))?\s*from/gm)) {
    if (m[1]) imported.add(m[1]);
    if (m[2]) for (const part of m[2].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); }
    if (m[3]) imported.add(m[3]);
  }
  assert.ok(imported.has('stillOpen') && imported.has('buildAnswerBack'), 'premise: the import list is read (stillOpen and buildAnswerBack come from answer-back.js)');
  const start = src.indexOf('async function runChainStages(');
  assert.ok(start > 0, 'premise: runChainStages is found');
  const shadows = [];
  src.slice(start).split('\n').forEach((l, i) => { const m = /^  (?:const|let|var|function)\s+(\w+)/.exec(l); if (m && imported.has(m[1])) shadows.push(`${m[1]} (line ${i + 1} of the function)`); });
  assert.deepEqual(shadows, [], 'a function-level declaration shadows an import');
});

// ---- after the rebase onto the found-secret pause (084/integration 02fc5522): a panelVerdicts row marked `cut` (a cut-off layer's reply, kept on the record by --finish) carries the seat's sorting too (panelRowOf is shared), and counts for no read and no sorting word
test('C3-30 a row marked cut gives no closing word: reusedEntries skips it, and the chain readers of the top layer\'s sorting rows skip it', () => {
  const FRm = FR;
  const seats = [{ key: 'lc', lab: 'lc', layer: 3 }];
  const rows = [{ round: 2, lab: 'lc', verdict: 'signed_off', sorting: [{ id: 'O-1', sort: 'may_leave', reason: 'Minor.' }] }, { round: 3, lab: 'lc', verdict: 'objected', cut: true, sorting: [{ id: 'O-1', sort: 'must_do', reason: 'A cut-off reply.' }] }];
  const out = fn(FRm, 'reusedEntries')({ seats, panelVerdicts: rows, draftShaByRound: { 2: 'abc', 3: 'abc' }, finalSha: 'abc', mustRead: [] });
  assert.deepEqual(out.map(x => [x.round, x.statement?.verdict, x.sorting?.map(y => y.sort)]), [[2, 'signed_off', ['may_leave']]], 'the cut row of round 3 is not the seat\'s last verdict');
  const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  for (const piece of ["r.layer === topLayer && !r.carried && !r.cut && Array.isArray(r.sorting)", "layered && r.layer === topLayer && !r.carried && !r.cut) { if (!byRound.has", "r.layer === topLayer && !r.carried && !r.cut && (r.verdict === 'signed_off'"]) assert.ok(src.includes(piece), `SCAN PIN: chain.js skips cut rows where it reads the top layer's sorting: ${piece}`);
});

// ---- S8 follow-up: every text that means THE TOP LAYER names the run's top layer (N from the run's own record; none = "the top layer", never a 3). Two-layer rows are the evidence; the three-layer bytes are the existing pins.
test('C3-31 the layer word: topLayerOf reads layers[] (else the final read\'s seats and reused seats), the words say "layer N" or "the top layer", never a 3', () => {
  const topLayerOf = fn(TL, 'topLayerOf');
  assert.equal(topLayerOf({ layers: [{ layer: 1 }, { layer: 2 }] }), 2);
  assert.equal(topLayerOf({ layers: [{ layer: 1 }, { layer: 3 }, { layer: 2 }] }), 3);
  assert.equal(topLayerOf({ finalRead: { seats: [{ layer: 2 }], reused: [{ layer: 2 }] } }), 2, 'else the final read\'s seats');
  assert.equal(topLayerOf({ layers: [{ layer: 1 }], finalRead: { seats: [{ layer: 3 }] } }), 1, 'layers[] rules when it names a layer');
  assert.equal(topLayerOf({}), null);
  assert.equal(topLayerOf({ layers: [{}, { layer: 'x' }] }), null, 'a row with no integer layer names none');
  const w = { word: fn(TL, 'layerWord'), cap: fn(TL, 'layerWordCap'), hy: fn(TL, 'layerHyphen'), up: fn(TL, 'layerUpper'), hyUp: fn(TL, 'layerHyphenUpper') };
  assert.deepEqual([w.word(2), w.cap(2), w.hy(2), w.up(2), w.hyUp(2)], ['layer 2', 'Layer 2', 'layer-2', 'LAYER 2', 'LAYER-2']);
  for (const none of [null, undefined, 0, 'x']) assert.deepEqual([w.word(none), w.cap(none), w.hy(none), w.up(none), w.hyUp(none)], ['the top layer', 'The top layer', 'top-layer', 'THE TOP LAYER', 'TOP-LAYER']);
});

test('C3-32 the verdict words name the run\'s top layer: layers[] [1, 2] says layer 2, [1, 2, 3] says layer 3, and a report that names none says "the top layer" (and still returns a sentence: a null would read as PASSED)', () => {
  const ending = basis => ({ kind: 'signed_off_at_top_not_agreed', basis });
  const L2 = [{ round: 1, layer: 1 }, { round: 1, layer: 2 }]; const L3 = [...L2, { round: 1, layer: 3 }];
  const endingWords = fn(VH, 'endingWords');
  assert.equal(endingWords({ ending: ending(['handler_not_yet']), layers: L2 }), 'layer 2 signed off, but the handler said not yet, so the run does NOT end agreed');
  assert.equal(endingWords({ ending: ending(['handler_not_yet']), layers: L3 }), 'layer 3 signed off, but the handler said not yet, so the run does NOT end agreed');
  assert.equal(endingWords({ ending: ending(['final_read_objection']) }), 'the top layer signed off, but an objection to the final plan holds, so the run does NOT end agreed');
  assert.equal(endingWords({ ending: ending(['text_changed_after_sign_off']), layers: L2 }), 'layer 2 signed off, but the plan that is delivered is not the plan it signed, so the run does NOT end agreed');
  assert.equal(endingWords({ ending: ending([]), layers: L2 }), 'layer 2 signed off, but the run does NOT end agreed');
  const seat = layer => ({ lab: 'x', layer, label: 'final-read-x', read: true, meets: false, failures: [{ criterion: 'c', problem: 'p' }], reasked: false, last_read_sha: null });
  const fr = layer => ({ ran: true, run_end: 'agreed', final_sha: 'abc', seats: [seat(layer)] });
  const hold = fn(VH, 'finalReadHoldWords');
  assert.equal(hold({ passed: true, final_read: fr(2), layers: L2 }), 'every layer had signed off on an earlier text, but a layer-2 objection to the final plan holds the sign-off');
  assert.equal(hold({ passed: true, final_read: fr(3), layers: L3 }), 'every layer had signed off on an earlier text, but a layer-3 objection to the final plan holds the sign-off');
  assert.equal(hold({ passed: true, final_read: { ...fr(2), seats: [{ ...seat(2), layer: undefined }] } }), 'every layer had signed off on an earlier text, but a top-layer objection to the final plan holds the sign-off');
  const noCheck = fn(VH, 'noBuildCheckWords');
  assert.equal(noCheck({ ending: { kind: 'agreed', basis: ['no_handling_session'] }, layers: L2 }), "agreed on layer 2's sign-off; no build check was made, because no session was there to make one");
  assert.equal(noCheck({ ending: { kind: 'agreed', basis: ['no_handling_session'] } }), "agreed on the top layer's sign-off; no build check was made, because no session was there to make one");
  const esc = fn(VH, 'agreedAfterEscalationWords');
  assert.match(esc({ ending: { kind: 'agreed' }, passed: false, escalated_signoff: { layer: 2, requested: true } }), /^layer 2 signed off on a pass that was asked to start at layer 3, and the handler checked the build:/, 'the route feature\'s own layer 3 stays');
  assert.match(esc({ ending: { kind: 'agreed' }, passed: false, escalated_signoff: { layer: 2 } }), /^layer 2 signed off after objections were passed up, /);
  assert.match(esc({ ending: { kind: 'agreed' }, passed: false, escalated_signoff: { requested: true } }), /^the top layer signed off on a pass that was asked to start at layer 3, /);
});

test('C3-33 run_status words: "layer N did not clear the final plan" takes N from layers[] or the final read\'s seats; none = "the top layer"', () => {
  const fin = fr => RSS.finishedRunState({ passed: true, signoff: [{ lab: 'a', signedOff: true }], final_read: fr });
  const seat = layer => ({ lab: 'x', ...(layer === undefined ? {} : { layer }), label: 'final-read-x', read: true, meets: false, failures: [{ criterion: 'c', problem: 'p' }], reasked: false, last_read_sha: null });
  const fr = layer => ({ ran: true, run_end: 'agreed', final_sha: 'abc', seats: [seat(layer)] });
  assert.match(fin(fr(2)), /^done: not agreed \(layer 2 did not clear the final plan; see final_read in report\.json\)$/);
  assert.match(fin(fr(3)), /^done: not agreed \(layer 3 did not clear the final plan/);
  assert.match(fin(fr(undefined)), /^done: not agreed \(the top layer did not clear the final plan/);
});

test('C3-34 the held build-check user text takes the run\'s top layer: layer 2 says layer 2 in the header, the sort state and the reason; none passed says "the top layer"; the dissent record\'s `by` word follows its `layer`', () => {
  const items = [{ id: 'O-1', layer: 1, severity: 3, flags: [], problem: 'Minor.', sorted: { sort: 'may_leave', reasons: [{ seat: 'lb', reason: 'Cosmetic.' }] } }, { id: 'O-2', layer: 1, severity: 5, flags: [], problem: 'Unsorted.' }];
  const two = String(HB084.buildCheckUser({ plan: 'P', sha: 'abc', layer: 2, items }));
  assert.match(two, /^# The plan layer 2 signed \(id abc\)/);
  assert.match(two, /sorted by layer 2: may-leave\): <critic-claim>Minor\.<\/critic-claim> Layer 2's reason: lb: <critic-claim>Cosmetic\.<\/critic-claim>/);
  assert.match(two, /not yet sorted by layer 2: counts as must-do\): <critic-claim>Unsorted\.<\/critic-claim>/);
  assert.doesNotMatch(two, /[Ll]ayer 3/);
  const none = String(HB084.buildCheckUser({ plan: 'P', sha: 'abc', items }));
  assert.match(none, /^# The plan the top layer signed \(id abc\)/);
  assert.match(none, /The top layer's reason: lb:/);
  assert.doesNotMatch(none, /[Ll]ayer 3/);
  const sys = HB084.buildCheckSystem();
  assert.doesNotMatch(sys, /[Ll]ayer 3/, 'the held system text says the top layer');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `the top layer's must-do is never removed by your answer`. NEW: `Your answer never removes a must-do of the top layer.` (K5). WHY: buildCheckSystem as recorded (src/prompts/recorded-084-b.js).
  assert.match(sys, /Your answer never removes a must-do of the top layer\./);
  const by = HB084.dissentRecordSection({ layer: 2, rows: [{ name: 'lb', lab: 'lb', id: 'O-1', criterion: 'c', problem: 'p', rating: { as_raised: 5, in_force: 3, changes: [{ pass: 4, from: 5, to: 3, by: 'layer' }] }, ruling: { layer: 2, round: 3, reasons: [{ lab: 'lb', text: 'r' }] }, status: 'open' }] });
  assert.doesNotMatch(String(by), /[Ll]ayer 3/, 'the dissent record names its own layer');
});

test('C3-35 (SCAN PIN) no printed layer 3 where the text means the top layer. SCOPE: (1) the pure text modules are watched WHOLE: no code line (comments and trailing comments left out) of src/verdict-headline.js, run-status.js, final-read.js, late-finding.js, text-labels.js, top-layer.js, escalation.js or report-shape.js says layer 3 / layer-3, except the two structural clauses allowed by name (the route feature "asked to start at layer 3", a go-up from layer 2 "sent up to layer 3"); (2) cli.js and chain.js, which hold the route/ladder sites, are watched by the literal sentences this commit changed. It shows the number is not fixed, not that N comes from the right field', () => {
  const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const codeLines = f => read(f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(([i, l]) => [i, l.replace(/\s\/\/\s.*$/, '')]);
  const bad = [];
  const ALLOW = [/asked to start at layer 3/, /sent up to layer 3/, /went up to layer 3/];
  const has = f => { try { read(f); return true; } catch { return false; } };   // a missing module is a finding, never a skipped check and never a throw before the other files are scanned
  for (const f of ['src/verdict-headline.js', 'src/run-status.js', 'src/final-read.js', 'src/late-finding.js', 'src/text-labels.js', 'src/top-layer.js', 'src/escalation.js', 'src/report-shape.js']) {
    if (!has(f)) { bad.push(`${f}: missing`); continue; }
    for (const [i, l] of codeLines(f)) if (/layer[ -]3/i.test(l) && !ALLOW.some(a => a.test(l))) bad.push(`${f}:${i}`);
  }
  const check = (f, pats) => { if (!has(f)) { bad.push(`${f}: missing`); return; } const src = codeLines(f).map(([, l]) => l).join('\n'); for (const p of pats) if (src.includes(p)) bad.push(`${f}: ${p}`); };
  check('src/cli.js', ["a layer-3 objection to the final plan", "not every layer-3 seat read the final plan"]);
  check('src/chain.js', ["layer 3 re-tagged", "every layer-3 seat sorted", "after layer 3's last read"]);
  assert.deepEqual(bad, []);
});

test('C3-36 the final-read family without a layer in the record (an older or hand-built one): every text says "the top layer" and none says layer 3', () => {
  const noLayer = { ran: true, run_end: 'not_agreed', final_sha: 'abc', seats: [{ lab: 'x', label: 'final-read-x', read: true, meets: false, failures: [{ criterion: 'c', problem: 'p' }], reasked: false, last_read_sha: null }] };
  const block = fn(FR, 'renderFinalReadBlock')(noLayer);
  assert.match(block, /^## The top layer on the final plan\n\nThe run ended without agreement\. After the plan's last change, the top layer was asked to read it\./);
  assert.doesNotMatch(block, /[Ll]ayer 3|layer-3/);
  const board = fn(FR, 'renderFinalReadBoard')(noLayer, twoRows);
  assert.match(board, /^\n## Final read by the top layer\n\nThe run ended without agreement; the top layer was asked to read the final plan \(plan id abc\)\./);
  assert.match(board, /Closed below 4 at the top layer's closing read \(every top-layer seat sorted these may-leave;/);
  assert.doesNotMatch(board, /[Ll]ayer 3|layer-3/);
  const lines = fn(FR, 'finalReadLogLines')([{ lab: 'x', read: false, why: 'no reply' }], 'agreed').join('\n');
  assert.match(lines, /NOT EVERY TOP-LAYER SEAT READ THE FINAL PLAN/);
  assert.match(lines, /but not every top-layer seat read the final plan\./);
  assert.doesNotMatch(lines, /LAYER-3|layer-3|LAYER 3/);
  const lf = [{ id: 'L-aaaaaaaa', lab: 'lb', problem: 'No back-off.', rating: null, rating_read_as: '4 or above', flags: [], found: 'final_read', round: 1, not_debated: true, sorted: { sort: 'must_do', seats: ['lb'], reasons: [{ seat: 'lb', sort: 'must_do', reason: 'It holds.' }] } }];
  const lboard = fn(LF, 'renderLateFindingsBoard')(lf);
  assert.match(lboard, /or by the top layer at its final read or its last verdict; not debated\)/);
  assert.match(lboard, /sorted by the top layer: must-do\)/);
  assert.doesNotMatch(lboard, /[Ll]ayer 3/);
  const untouched = fn(LF, 'renderLateFindingsBoard')([{ ...lf[0], found: undefined, sorted: null }]);
  assert.match(untouched, /and the top layer has not sorted them\./);
  const closed = fn(LF, 'withClosedBelowFour')('# H\n', twoRows, s => s);
  assert.match(closed, /\n\nThe top layer read the final plan and sorted each of these may-leave\./);
  assert.match(closed, /The top layer's reason: lb: Minor\./);
  assert.doesNotMatch(closed, /[Ll]ayer 3/);
  const ER = { round: 2, pass: 3, from_layer: 1, to_layer: 2, trigger: 'stall', ids: ['O-aaaa'], labs: ['la'], rulings: [], outcome: [{ id: 'O-aaaa', lab: 'la', layer: 1, first_round: 1, problem: 'No owner is named.', result: 'undecided', why: 'no_ruling' }] };
  const eboard = fn(RS, 'renderEscalationsBoard')([ER], null, new Set(['la\u0000O-aaaa']));
  assert.ok(eboard.includes("closed below 4 at the top layer's closing read (every top-layer seat sorted it may-leave)"), eboard);
  assert.doesNotMatch(eboard.split('closed below 4')[1] ?? '', /[Ll]ayer 3/);
});

test('C3-37 the BOARD banners (renderBoardMd, a hand-built result): with layers [1, 2] they say layer 2, with layers [1, 2, 3] layer 3, and a result that names no layer says "the top layer"', () => {
  const render = fn(RS, 'renderBoardMd');
  const base = { board: 'the board', passed: true, signoff: [{ lab: 'a', signedOff: true }] };
  const L = n => Array.from({ length: n }, (_, i) => ({ round: 1, layer: i + 1, state: 'signed_off', labs: ['x'] }));
  const noCheck = layers => render({ runId: 'x', result: { ...base, ending: { kind: 'agreed', basis: ['no_handling_session'] }, ...(layers ? { layers } : {}) } });
  assert.match(noCheck(L(2)), /## Agreed on layer 2's sign-off, no build check\n\nThis run ended agreed on layer 2's sign-off; no build check was made/);
  assert.match(noCheck(L(3)), /## Agreed on layer 3's sign-off, no build check/);
  assert.match(noCheck(null), /## Agreed on the top layer's sign-off, no build check\n\nThis run ended agreed on the top layer's sign-off;/);
  const seat = layer => ({ lab: 'x', ...(layer === undefined ? {} : { layer }), label: 'final-read-x', read: true, meets: false, failures: [{ criterion: 'c', problem: 'p' }], reasked: false, last_read_sha: null });
  const fr = layer => ({ ran: true, run_end: 'agreed', final_sha: 'abc', seats: [seat(layer)] });
  const held = (layers, layer) => render({ runId: 'x', result: { ...base, finalRead: fr(layer), ...(layers ? { layers } : {}) } });
  const two = held(L(2), 2);
  assert.match(two, /## Not agreed: layer 2 objected to the final plan\n\nEvery layer had signed off on an earlier text, but the plan changed afterwards and a layer-2 objection to the final text holds the sign-off \(see Final read by layer 2 below\)\./);
  assert.match(held(L(3), 3), /## Not agreed: layer 3 objected to the final plan[\s\S]*a layer-3 objection to the final text[\s\S]*\(see Final read by layer 3 below\)/);
  const none = held(null, undefined);
  assert.match(none, /## Not agreed: the top layer objected to the final plan\n\nEvery layer had signed off on an earlier text, but the plan changed afterwards and a top-layer objection to the final text holds the sign-off \(see Final read by the top layer below\)\./);
  assert.doesNotMatch(two + none, /[Ll]ayer 3|layer-3/);
});
