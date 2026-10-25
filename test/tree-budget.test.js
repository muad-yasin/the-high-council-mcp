// 0.8.3 M2 (PLAN 14, M2 exit checks): the tree's money: the accounting gate (PLAN 7.2), what the tree has spent (7.1), grants and admission (7.3), the lifetime cap (7.4), the member's claim and the clamp (7.6), post-run calls.
// Offline, $0: the all-mock chains (`mock-budget` carries fixture prices, so it writes and mirrors reservations), a never-answering local server for the killed-mid-call case, and SYNTHETIC run folders written by hand so each
// accounting scenario can be built exactly. The map from the plan's checks to these tests is in Review/Build_0.8.3/PROGRESS.md (ids C1..C25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approvalValid, foldRecord } from '../src/tree-transitions.js';
import { MONEY_EPS, acceptAccounting, admitAgainstLimits, budgetOf, effectiveLimits, gateTree, lifetimeCapOf, proposeGrants, topUp } from '../src/tree-budget.js';
import { registerRoot } from '../src/tree-register.js';
import { capFor, mockBudgetFigures, shareOver } from './helpers/money-figures.js';
import { GATE_FIELDS, IDS, ROOT_ID, SPLIT_ROOT_HANDOFF_USD, approveFrontier, claim, closedChildTree, closedRootTree, hostnameOf, newTree, reservedLine, registerKid, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';

const cents = n => Math.round(n * 1e6) / 1e6;
const codes = g => g.problems.map(p => p.code);
const events = rootDir => readTreeRecord(rootDir).events;

// One started child with one paid, settled stage: reserved 1.00, recorded 0.60, a usage file and the mirror agreeing. The base the refusal tests damage one way at a time.
function oneChild({ cap = 100, grant = 10 } = {}) {
  const t = closedRootTree({ cap });
  const key = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, key, 'R/M1', IDS[0], grant);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const dir = syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd: 0.6, reservationId: 'r1' }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]);
  return { t, dir, key: `${IDS[0]}:r1` };
}

// ---------------------------------------------------------------------------------------------------------------------------------- C6: the root start
test('the gate passes on a clean tree, and on a registered root whose folder holds only tree/ before its run.json (PLAN 7.2 item 1: the root start)', () => {
  const t = newTree({ cap: 30 }); registerRoot(t.rootDir);
  const g = gateTree(t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.deepEqual(readdirSync(join(t.runsDir, ROOT_ID)), ['tree'], 'the folder holds tree/ and nothing else');
  assert.equal(g.treeSpentUsd, 0);
  const b = budgetOf(t.rootDir, { gate: g });
  assert.deepEqual([b.rootCapUsd, b.heldUsd, b.availableUsd], [30, 30, 0]);       // EDITED, the root-hold fix (disclosed; old: [30, 0, 30]): a registered root that has not closed holds the cap it was granted (gate page 12.1)
  const c = oneChild();
  const g2 = gateTree(c.t.rootDir);
  assert.equal(g2.ok, true, JSON.stringify(g2.problems));
  assert.equal(cents(g2.treeSpentUsd), 0.6, 'one settled call, counted once');
});

// ---------------------------------------------------------------------------------------------------------------------------------- C5, C7, C18: evidence deleted or damaged
test('deleting a started member\'s run.json, or a paid stage\'s usage file, or its whole folder, or corrupting a reservations line, or deleting its reservations file: the gate blocks (PLAN 7.2)', () => {
  const cases = {
    'run.json deleted': [c => unlinkSync(join(c.dir, 'run.json')), 'member_run_json'],
    'usage file deleted': [c => unlinkSync(join(c.dir, 'build.usage.json')), 'settlement_without_evidence'],
    'a reservations line corrupted': [c => writeFileSync(join(c.dir, 'spend-reservations.jsonl'), `${JSON.stringify(reservedLine('r1', 1, 'build'))}\nthis is not json\n${JSON.stringify(settledLine('r1', 'recorded', 0.6))}\n`), 'reservations_unreadable'],
    'reservations file deleted': [c => unlinkSync(join(c.dir, 'spend-reservations.jsonl')), 'mirror_ahead_of_file'],
    'whole folder deleted (C7)': [c => rmSync(c.dir, { recursive: true }), 'member_folder_missing'],
    'a usage file\'s usd set to a non-number': [c => writeFileSync(join(c.dir, 'build.usage.json'), JSON.stringify({ provider: 'openrouter', usage: {}, usd: 'lots', reservationId: 'r1' })), 'money_not_a_number'],
  };
  for (const [name, [damage, code]] of Object.entries(cases)) {
    const c = oneChild(); damage(c);
    const g = gateTree(c.t.rootDir);
    assert.equal(g.ok, false, name);
    assert.ok(codes(g).includes(code), `${name}: ${codes(g)}`);
    assert.equal(stateOf(readTreeRecord(c.t.rootDir)).sticky.size, 0, 'the gate reads; nothing is written by it');
  }
  // C18: a member killed in its first call whose reservations file is then deleted: blocked, and the MIRRORED reservation stays counted at its worst case
  const k = closedRootTree({ cap: 100 });
  const key = approveFrontier(k.rootDir, ['R/M1']); registerKid(k, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(k.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(k, IDS[0], {});
  writeLines(k, IDS[0], 'R/M1', [reservedLine('r1', 2.5, 'first-call')], { file: false });                  // the run's own file never made it (or was deleted); the mirror has the line
  const g = gateTree(k.rootDir);
  assert.equal(g.ok, false);
  assert.ok(codes(g).includes('mirror_ahead_of_file'));
  assert.equal(cents(g.treeSpentUsd), 2.5, 'its mirrored worst case is counted, not forgotten');
  assert.equal(g.reservations[0].row, 4);
});

test('the same deletion in a child on the unpriced all-mock chain does not block (PLAN 7.2 item 5): its calls project $0, so it writes and mirrors no reservation', () => {
  const t = closedRootTree({ cap: 100, childChain: 'mock' });
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const dir = syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd: 0, provider: 'mock' }] });
  assert.equal(existsSync(join(dir, 'spend-reservations.jsonl')), false);
  assert.equal(gateTree(t.rootDir).ok, true);
});

// ---------------------------------------------------------------------------------------------------------------------------------- C10, C13: a settlement the record cannot prove
test('a recorded settlement whose usd differs from its usage file\'s blocks (C10), and counts as a rejected settlement at its worst case', () => {
  const c = oneChild();
  writeFileSync(join(c.dir, 'build.usage.json'), JSON.stringify({ provider: 'openrouter', usage: {}, usd: 0.7, reservationId: 'r1' }));      // the file says 0.70, the settlement 0.60
  const g = gateTree(c.t.rootDir);
  assert.equal(g.ok, false);
  assert.deepEqual(codes(g), ['settlement_without_evidence']);
  const r = g.reservations[0];
  assert.deepEqual([r.row, r.settledAccepted], [5, false]);
  assert.equal(cents(r.addedUsd), 0.3, 'worst case 1.00 minus what the usage file already counts (0.70)');
  assert.equal(cents(g.treeSpentUsd), 1.0, 'the run counts 0.70, the tree adds 0.30: the worst case, once');
});

test('each of these is accounting_blocked: an unknown outcome; a settled line for an id no reserved line opened; a second settled line; a run-file settlement the mirror lacks; a recorded settlement whose usage file is gone; nothing is granted; treeSpent holds what the plan says (C13)', async () => {
  const fig = async (damage, expectCode, { spent, addedRow }) => {
    const c = oneChild(); damage(c);
    const g = gateTree(c.t.rootDir);
    assert.equal(g.ok, false); assert.ok(codes(g).includes(expectCode), `${expectCode}: ${codes(g)}`);
    assert.equal(cents(g.treeSpentUsd), spent, expectCode);
    if (addedRow !== undefined) assert.equal(g.reservations.find(r => r.key === c.key)?.row, addedRow, expectCode);
    // no grant while blocked: a top-up is refused and writes a blocked record, never grant_issued
    appendTreeEvent(c.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
    assert.throws(() => topUp(c.t.rootDir, { node: 'R/M1', amountUsd: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal && e.code === 'continuation_refused');
    assert.ok(!events(c.t.rootDir).some(e => e.event === 'grant_issued'));
    assert.equal(events(c.t.rootDir).at(-1).check, 'top_up');
  };
  const file = c => join(c.dir, 'spend-reservations.jsonl');
  await fig(c => writeFileSync(file(c), `${JSON.stringify(reservedLine('r1', 1, 'build'))}\n${JSON.stringify({ ...settledLine('r1', 'weird', 0.6) })}\n`), 'reservations_unreadable', { spent: 1.0, addedRow: 5 });                  // the unreadable settlement counts as none: the run reads 0.60, the tree adds the 0.40 up to the worst case
  await fig(c => writeFileSync(file(c), `${JSON.stringify(settledLine('r9', 'recorded', 0.1))}\n`), 'settled_without_reserved', { spent: 1.0, addedRow: 4 });                // the run file lost its reserved line; the mirror still holds it
  await fig(c => { writeFileSync(file(c), `${[reservedLine('r1', 1, 'build'), settledLine('r1', 'recorded', 0.6), settledLine('r1', 'recorded', 0.6)].map(l => JSON.stringify(l)).join('\n')}\n`); }, 'settled_twice', { spent: 1.0, addedRow: 5 });
  // the run file settles it and the mirror lacks the settled line, usage present: only max(0, worst - included) is added
  const m = oneChild();
  rmSync(m.t.rootDir, { recursive: true, force: true });
  await fig(c => {
    const rec = readTreeRecord(c.t.rootDir);
    const keep = rec.events.filter(e => !(e.event === 'reservation_mirrored' && e.line.event === 'settled'));
    writeFileSync(join(c.t.rootDir, 'tree', 'events.jsonl'), `${keep.map(e => JSON.stringify(e)).join('\n')}\n`);
  }, 'settlement_not_mirrored', { spent: 1.0, addedRow: 5 });
  // a recorded settlement of an unfinished run whose usage file is deleted: no evidence carries it, treeSpent holds its full worst case
  await fig(c => unlinkSync(join(c.dir, 'build.usage.json')), 'settlement_without_evidence', { spent: 1.0, addedRow: 5 });
});

// ---------------------------------------------------------------------------------------------------------------------------------- C14: the accounting cases of PLAN 7.1, to the cent
test('the accounting cases (a)-(g), each asserting treeSpent to the cent: no charge omitted and none counted twice', () => {
  const kid = (spec) => {
    const t = closedRootTree({ cap: 100 });
    const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 50);
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
    const dir = syntheticRun(t, IDS[0], spec.run || {});
    for (const [lines, opts] of spec.lines || []) writeLines(t, IDS[0], 'R/M1', lines, opts);
    return { t, dir };
  };
  // (a) a FINISHED member whose top-level usage file is deleted but whose report.json keeps its totals and stages: no block, nothing added, counted once
  let k = kid({ run: { report: { totals: { usd: 0.6 }, stages: [{ label: 'build', provider: 'openrouter', usd: 0.6, reservationId: 'r1' }] } }, lines: [[[reservedLine('r1', 1, 'build'), settledLine('r1', 'recorded', 0.6)]]] });
  let g = gateTree(k.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(cents(g.treeSpentUsd), 0.6); assert.equal(g.addedUsd, 0);
  // (b) one label run twice with different costs (killed in flight, then resumed): each reservation matched to its own record by id, the unsettled one at its worst case once, the settled one at its cost once
  k = kid({ run: { usage: [{ file: 'x', usd: 0.7, reservationId: 'r2' }] }, lines: [[[reservedLine('r1', 2.0, 'x'), reservedLine('r2', 1.0, 'x'), settledLine('r2', 'recorded', 0.7)]]] });
  g = gateTree(k.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(cents(g.treeSpentUsd), 2.7); assert.deepEqual(g.reservations.map(r => r.row).sort(), [1, 2]);
  // (c) a stage set aside to superseded/ and run again: both payments counted, each once, matched by id
  k = kid({ run: { usage: [{ file: 'x', usd: 0.5, reservationId: 'r2' }], superseded: [{ file: 'x.1', usd: 0.4, reservationId: 'r1' }] }, lines: [[[reservedLine('r1', 1, 'x'), settledLine('r1', 'recorded', 0.4), reservedLine('r2', 1, 'x'), settledLine('r2', 'recorded', 0.5)]]] });
  g = gateTree(k.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(cents(g.treeSpentUsd), 0.9);
  // (d) a finished member whose report totals.usd is not a number, or negative, or differs from the sum of its stages plus supersededUsd: blocked
  for (const [name, totals, stages] of [['not a number', { usd: 'x' }, [{ label: 'a', provider: 'openrouter', usd: 0.5, reservationId: 'r1' }]], ['negative', { usd: -1 }, [{ label: 'a', provider: 'openrouter', usd: 0.5, reservationId: 'r1' }]], ['differs from the sum', { usd: 0.9 }, [{ label: 'a', provider: 'openrouter', usd: 0.5, reservationId: 'r1' }]]]) {
    k = kid({ run: { report: { totals, stages } }, lines: [[[reservedLine('r1', 1, 'a'), settledLine('r1', 'recorded', 0.5)]]] });
    g = gateTree(k.t.rootDir);
    assert.equal(g.ok, false, name);
    assert.ok(codes(g).some(c => ['report_totals', 'money_not_a_number'].includes(c)), `${name}: ${codes(g)}`);
  }
  // (e) one reservation with a durable charge record but no committed settlement (a crash between invoke()'s catch and its finally): added is minus the charge, the tree counts the worst case ONCE, runSpentUsd still counts both
  k = kid({ run: { superseded: [{ file: 'x.charge-1', usd: 0.3, reservationId: 'r1', kind: 'billed' }] }, lines: [[[reservedLine('r1', 1.0, 'x')]]] });
  g = gateTree(k.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(g.reservations[0].row, 3); assert.equal(cents(g.reservations[0].addedUsd), -0.3);
  assert.equal(cents(g.treeSpentUsd), 1.0, 'worst case 1.00 once; the run itself reads 1.30');
  assert.equal(cents(g.members.find(m => m.runId === IDS[0]).spentUsd), 1.3);
  // (f) a pre-report superseded charge already included in totals.supersededUsd, whose file is then deleted: attributed through report.json superseded[], counted once
  k = kid({ run: { report: { totals: { usd: 0.8, supersededUsd: 0.2 }, stages: [{ label: 'a', provider: 'openrouter', usd: 0.6, reservationId: 'r1' }], superseded: [{ label: 'superseded/a.charge-1', usd: 0.2, reservationId: 'r2', kind: 'billed' }] } }, lines: [[[reservedLine('r1', 1, 'a'), settledLine('r1', 'recorded', 0.6), reservedLine('r2', 0.5, 'a'), settledLine('r2', 'billed_unreadable', 0.2)]]] });
  g = gateTree(k.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(cents(g.treeSpentUsd), 0.8); assert.equal(g.addedUsd, 0);
  // (g) a recorded settlement of zero with zero-valued evidence: accepted, contributes nothing
  k = kid({ run: { usage: [{ file: 'x', usd: 0, reservationId: 'r1' }] }, lines: [[[reservedLine('r1', 1, 'x'), settledLine('r1', 'recorded', 0)]]] });
  g = gateTree(k.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(g.treeSpentUsd, 0);
});

test('ids repeat across runs: two members that both hold r1 do not collide in the mirror; a run file holding r1 reserved twice blocks (C15)', () => {
  const t = closedRootTree({ cap: 100 });
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 20);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], { usage: [{ file: 'a', usd: 0.5, reservationId: 'r1' }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 1, 'a'), settledLine('r1', 'recorded', 0.5)]);
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: null, share: 'released' });
  registerKid(t, key, 'R/M2', IDS[1], 20);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[1], { usage: [{ file: 'a', usd: 0.25, reservationId: 'r1' }] });
  writeLines(t, IDS[1], 'R/M2', [reservedLine('r1', 1, 'a'), settledLine('r1', 'recorded', 0.25)]);
  const g = gateTree(t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.deepEqual(g.reservations.map(r => r.key).sort(), [`${IDS[0]}:r1`, `${IDS[1]}:r1`]);
  assert.equal(cents(g.treeSpentUsd), 0.75);
  // r1 reserved twice in one run file
  writeLines(t, IDS[1], 'R/M2', [reservedLine('r1', 3, 'again')], { mirror: false });
  const g2 = gateTree(t.rootDir);
  assert.equal(g2.ok, false); assert.ok(codes(g2).includes('reserved_twice'));
});

// ---------------------------------------------------------------------------------------------------------------------------------- C17: the person accepts a charge
test('accepting a charge (the library function behind `decide --accounting`): accounting_accepted names the key, the block lifts for it, and treeSpent still holds it at its plan contribution; a problem with no key cannot be accepted (C17)', () => {
  const c = oneChild();
  unlinkSync(join(c.dir, 'build.usage.json'));                                                    // a settlement with no evidence
  let g = gateTree(c.t.rootDir);
  assert.equal(g.ok, false);
  const before = cents(g.treeSpentUsd);
  const ev = acceptAccounting(c.t.rootDir, { keys: [c.key], ...GATE_FIELDS });
  assert.deepEqual([ev.event, ev.reservationIds], ['accounting_accepted', [c.key]]);
  g = gateTree(c.t.rootDir);
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(cents(g.treeSpentUsd), before, 'accepting changes no figure: the charge stays counted at its worst case');
  assert.equal(before, 1.0);
  // a missing run.json names no reservation: accepting does not lift it
  unlinkSync(join(c.dir, 'run.json'));
  g = gateTree(c.t.rootDir);
  assert.equal(g.ok, false); assert.deepEqual(codes(g), ['member_run_json']);
  assert.throws(() => acceptAccounting(c.t.rootDir, { keys: ['nonsense'], ...GATE_FIELDS }), TypeError);
});

// ---------------------------------------------------------------------------------------------------------------------------------- C3: grants and admission
// CHANGED ACCEPTED TEST (money-test conversion, lane C, 24 Okt 2026; C&C ruling (c) and ruling (a) for this file; the full suite on fad02049 listed the old test as #3853). OLD: ONE test typed mock-budget's figures ({ 8.064, 44.45 }) and sized every pool against them (36, 26, 400). NEW: TWO tests.
// The first is the ONE pin of mock-budget's own dry-run figures (provisional like prompt-pin: the figures move with every recorded or reworded sentence in src/roles.js, so lane A re-records the number at the apply). The second DERIVES the figures and
// the pools from the chain's own dry run, so the relation it is about holds by construction. WHY: with the 16 drafted functions recorded the figures become { 8.714, 45.75 }, and "cap 26 shares 8.67 each over 8.064" became "8.67 under 8.714".
// PROVISIONAL, like prompt-pin: the pin holds { 8.714, 45.75 }, the figures with the 16 drafted functions recorded (measured on the box on B's scratch src/roles.js, tree 4497d0e8, set-4497d0e8-box-20261024-041641.txt: this test's "actual" block; it held { 8.064, 44.45 } on the integration tip, where roles.js has none of them). So this commit is red by design on a tree without the recorded words, like prompt-pin; at the apply lane A re-records exactly this test's two numbers on the real roles.js, in the same step as prompt-pin. No other test types a mock-budget figure.
test('PIN (the one pin of the mock-budget figures; re-recorded with prompt-pin at the apply): the chain\'s own dry-run figures are what the tree tests assume', () => {
  assert.deepEqual(mockBudgetFigures(), { cheapestUsd: 8.714, atMostUsd: 45.75 }, 'the chain\'s own dry-run figures stand in for pack B\'s');
});

test('grants: each proposed grant is min(atMost, available / k) in dependency order; a child under the chain\'s cheapest end is "not admitted: budget" and takes nothing; treeSpent + held never passes the cap (C3)', () => {
  const fig = mockBudgetFigures();
  const G = shareOver(fig);   // an equal share just over the cheapest end, to the cent (the relation each pool below is named for)
  const four = id => ({ id, ...fig });
  // a pool of 4 x G: shares of G each cover the cheapest end
  const cap4 = capFor(G, 4);
  let p = proposeGrants({ availableUsd: cap4, children: ['a', 'b', 'c', 'd'].map(four) });
  assert.deepEqual(p.map(x => cents(x.grantUsd)), [G, G, G, G]);
  assert.ok(p.every(x => x.admitted && x.maysStopBeforeFinishing), 'between the cheapest end and the at-most figure: flagged "may stop before finishing"');
  // a pool of 3 x G: the first of four gets 3G / 4 = 0.75 G, under the cheapest end, so it is not admitted and takes nothing; the rest share the whole pool, G each
  const cap3 = capFor(G, 3);
  assert.ok(cap3 / 4 < fig.cheapestUsd && cap3 / 3 >= fig.cheapestUsd, 'fixture: the pool is under the cheapest end for four and over it for three');
  p = proposeGrants({ availableUsd: cap3, children: ['a', 'b', 'c', 'd'].map(four) });
  assert.deepEqual(p.map(x => [x.admitted, x.reason]), [[false, 'not admitted: budget'], [true, null], [true, null], [true, null]]);
  assert.deepEqual(p.map(x => cents(x.grantUsd)), [0, cents(cap3 / 3), cents(cap3 / 3), cents(cap3 / 3)]);
  assert.ok(Math.abs(p.reduce((n, x) => n + x.grantUsd, 0) - cap3) < 1e-9);
  // a big pool: capped at the chain's at-most figure, not at an equal share of everything
  p = proposeGrants({ availableUsd: 2 * fig.atMostUsd + 10, children: ['a', 'b'].map(four) });
  assert.deepEqual(p.map(x => [x.grantUsd, x.maysStopBeforeFinishing]), [[fig.atMostUsd, false], [fig.atMostUsd, false]]);
  // in the record: register what was admitted, never the child that was not; the invariant holds at every step
  const t = closedRootTree({ cap: cap3 });      // the same relation to the cheapest end: the first share of four is under it, the other three above
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2', 'R/M3', 'R/M4']);
  const plan = proposeGrants({ availableUsd: budgetOf(t.rootDir).availableUsd, children: ['R/M1', 'R/M2', 'R/M3', 'R/M4'].map(four) });
  const registered = [];
  for (const [i, node] of ['R/M1', 'R/M2', 'R/M3', 'R/M4'].entries()) {
    if (!plan[i].admitted) continue;
    registerKid(t, key, node, IDS[i], plan[i].grantUsd);
    registered.push(node);
    const b = budgetOf(t.rootDir);
    assert.ok(b.treeSpentUsd + b.heldUsd <= b.rootCapUsd + MONEY_EPS, `after ${node}: spent + held <= cap`);
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(node, IDS[i], process.pid, 1, hostnameOf()) });
    appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation: 1, runId: IDS[i], outcome: 'passed', passed: true, status: null, share: 'released' });
  }
  assert.deepEqual(registered, ['R/M2', 'R/M3', 'R/M4']);
  assert.ok(!existsSync(join(t.runsDir, IDS[0])), 'the child that was not admitted has no run folder');
});

test('admission against the limits: depth, fan-out and run count, each at its effective value; a raise changes it and tree.json is not edited (PLAN 7.3, 8.6)', () => {
  const limits = { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, attemptsPerChild: 1 };
  const r = admitAgainstLimits({ limits, registeredRuns: 1, children: [1, 2, 3, 4, 5, 6].map(i => ({ id: `c${i}`, depth: 1 })) });
  assert.deepEqual(r.map(x => x.reason), [null, null, null, null, 'not admitted: fan-out limit', 'not admitted: fan-out limit']);
  assert.deepEqual(admitAgainstLimits({ limits, registeredRuns: 1, children: [{ id: 'deep', depth: 3 }] })[0].reason, 'not admitted: depth limit');
  assert.deepEqual(admitAgainstLimits({ limits, registeredRuns: 11, children: [{ id: 'x', depth: 1 }, { id: 'y', depth: 1 }] }).map(x => x.reason), [null, 'not admitted: run limit']);
  const t = newTree({ cap: 50 }); registerRoot(t.rootDir);
  const rec = readTreeRecord(t.rootDir);
  assert.deepEqual(effectiveLimits(rec.tree, rec.events), limits);
  appendTreeEvent(t.rootDir, { event: 'limit_raised', limit: 'maxRuns', from: 12, to: 20, actor: 'person', via: 'terminal' });
  appendTreeEvent(t.rootDir, { event: 'limit_raised', limit: 'maxRuns', from: 20, to: 15, actor: 'person', via: 'terminal' });       // not a raise: ignored
  const rec2 = readTreeRecord(t.rootDir);
  assert.equal(effectiveLimits(rec2.tree, rec2.events).maxRuns, 20);
  assert.equal(rec2.tree.limits.maxRuns, 12, 'tree.json still holds the initial value');
});

// ---------------------------------------------------------------------------------------------------------------------------------- the lifetime cap (PLAN 7.4) and "no live grant"
test('the lifetime cap is spent + min(grant - spent, rootCap - treeSpent - heldByOthers); "no live grant" is defined once (C12, C22)', () => {
  const t = closedRootTree({ cap: 30 });
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 12);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], { usage: [{ file: 'a', usd: 2, reservationId: 'r1' }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 3, 'a'), settledLine('r1', 'recorded', 2)]);
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
  registerKid(t, key, 'R/M2', IDS[1], 15);
  let b = budgetOf(t.rootDir);
  // R/M1: held 12-2 = 10 (a stopped child keeps its grant); R/M2: held 15; treeSpent 2
  assert.deepEqual([b.heldUsd, cents(b.treeSpentUsd), cents(b.availableUsd)], [25, 2, 3]);
  const m1 = lifetimeCapOf(b, 'R/M1@g1');
  assert.deepEqual([m1.spentUsd, m1.grantUsd, m1.heldByOthersUsd, m1.roomUsd, m1.live, m1.lifetimeCapUsd], [2, 12, 15, 10, true, 12], 'min(12-2, 30-2-15=13) = 10: the grant binds');
  // the grant is bigger than the pool: the pool binds
  appendTreeEvent(t.rootDir, { event: 'grant_issued', node: 'R/M1', generation: 1, amount: 20, unit: 'usd', ...GATE_FIELDS });
  b = budgetOf(t.rootDir);
  const m1b = lifetimeCapOf(b, 'R/M1@g1');
  assert.equal(m1b.grantUsd, 32); assert.equal(m1b.roomUsd, 30 - 2 - 15, 'min(32-2, 30-2-15=13) = 13: the pool binds');
  assert.equal(m1b.lifetimeCapUsd, 15);
  // the root: a lifetime cap that leaves every child's held grant intact
  const root = lifetimeCapOf(b, 'R@g1');
  assert.equal(root.heldByOthersUsd, b.heldUsd);
  assert.equal(cents(root.roomUsd), cents(Math.min(30 - 0, 30 - b.treeSpentUsd - b.heldUsd)), 'the root can spend only what no child holds');
  // no live grant: the room is zero or less
  const t2 = closedRootTree({ cap: 10 });
  const k2 = approveFrontier(t2.rootDir, ['R/M1']); registerKid(t2, k2, 'R/M1', IDS[0], 5);
  appendTreeEvent(t2.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t2, IDS[0], { usage: [{ file: 'a', usd: 5, reservationId: 'r1' }] });
  writeLines(t2, IDS[0], 'R/M1', [reservedLine('r1', 5, 'a'), settledLine('r1', 'recorded', 5)]);
  const dead = lifetimeCapOf(budgetOf(t2.rootDir), 'R/M1@g1');
  assert.deepEqual([dead.live, dead.roomUsd, dead.lifetimeCapUsd], [false, 0, 5], 'grant spent in full: no live grant, and the lifetime cap is just what is spent');
});

test('a top-up is bounded by what the root cap has free, needs the gate to pass, and only follows a budget stop (PLAN 7.5)', () => {
  const t = closedRootTree({ cap: 20 });
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 12);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], {});
  assert.throws(() => topUp(t.rootDir, { node: 'R/M1', amountUsd: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal, 'the node is running, not stopped');
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
  assert.throws(() => topUp(t.rootDir, { node: 'R/M1', amountUsd: 9, ...GATE_FIELDS }), e => e instanceof TreeRefusal && /only 8\.0000 of the root cap is free/.test(e.reason));
  const g = topUp(t.rootDir, { node: 'R/M1', amountUsd: 8, ...GATE_FIELDS });
  assert.deepEqual([g.event, g.amount, g.unit], ['grant_issued', 8, 'usd']);
  assert.equal(budgetOf(t.rootDir).availableUsd, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------- the approval hash fails closed; stale marks
test('an approval is valid when its bound hash equals the preview\'s; a hashed preview with an unhashed approval is INVALID (fail closed); registration needs a valid approval', () => {
  const states = opts => { const t = closedRootTree({ cap: 50 }); const key = approveFrontier(t.rootDir, ['R/M1'], opts); return { t, key, f: stateOf(readTreeRecord(t.rootDir)).frontiers.get(key) }; };
  assert.equal(approvalValid(states({}).f), true, 'the fixture default hash on the preview and the approval: valid (R3b: there is no unhashed fixture any more)');
  assert.equal(approvalValid(states({ hash: 'h1' }).f), true, 'equal hashes');
  assert.equal(approvalValid(states({ hash: 'h1', approvalHash: 'h2' }).f), false, 'a different hash');
  const unhashed = states({ hash: 'h1', approvalHash: null });
  assert.equal(approvalValid(unhashed.f), false, 'a hashed preview plus an unhashed approval gives an invalid approval');
  assert.throws(() => registerKid(unhashed.t, unhashed.key, 'R/M1', IDS[0], 5), e => e instanceof TreeRefusal && /no longer valid/.test(e.reason));
  // a changed preview invalidates an earlier approval with no new event type
  const ok = states({ hash: 'h1' });
  appendTreeEvent(ok.t.rootDir, { event: 'frontier_previewed', frontierKey: ok.key, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'b'.repeat(64), children: [{ node: 'R/M1', generation: 1 }], boundSha256: 'h2' });
  assert.equal(approvalValid(stateOf(readTreeRecord(ok.t.rootDir)).frontiers.get(ok.key)), false);
  assert.throws(() => registerKid(ok.t, ok.key, 'R/M1', IDS[0], 5), TreeRefusal);
  // eventShapeError: a malformed optional field is a corrupt record
  assert.throws(() => appendTreeEvent(ok.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: ok.key, revision: 2, boundSha256: 42 }), TypeError);
});

test('R3b (M5 API reviews, Opus 3-2): a frontier_previewed without boundSha256 is refused by the table, and a frontier whose preview carries none has NO valid approval (the "no hash anywhere: valid, for fixtures only" fallback is gone)', () => {
  const t = closedRootTree({ cap: 50 });
  const preview = { event: 'frontier_previewed', frontierKey: 'k'.repeat(64), parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'b'.repeat(64), children: [{ node: 'R/M1', generation: 1 }] };
  assert.throws(() => appendTreeEvent(t.rootDir, preview), e => e instanceof TreeRefusal && /boundSha256/.test(e.reason), 'refused without the bound hash');
  assert.equal(appendTreeEvent(t.rootDir, { ...preview, boundSha256: 'h1' }).event, 'frontier_previewed', 'accepted with it');
  // a record written by hand (the fold reads what it is given): an unhashed preview plus an approval that carries the gate is still not valid
  const line = (id, e) => ({ schema: 'tree-events/1', id, at: '2026-10-11T12:00:00.000Z', ...e });
  const st = foldRecord([line('e1', preview), line('e2', { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: preview.frontierKey, revision: 1, boundSha256: 'h1' })]);
  assert.equal(approvalValid(st.frontiers.get(preview.frontierKey)), false, 'no preview hash to compare the approval with: fail closed');
});

test('stale marks are per stop (PLAN 8.5 rows 4 and 8, M5d/M5e): needs_decision_opened with `affected` marks those nodes stale; a regenerate answers THAT stop but HOLDS its marks; resolving the other stop in place releases ITS marks only; a node marked by two stops stays stale until both are released', () => {
  const t = closedChildTree({ cap: 50 });
  const a = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'status', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const b = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R/M2', generation: 1 }, { node: 'R/M3', generation: 1 }] });
  const stale = () => [...foldRecord(events(t.rootDir)).stale].sort();
  assert.deepEqual(stale(), ['R/M1@g1', 'R/M2@g1', 'R/M3@g1']);
  appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'carry on', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: a.id, ...GATE_FIELDS }); // EDITED in the M7 apply (C2a-record commit 2; old: `affected: []`; why: the table now binds a regenerate's list to the stop's recorded set, so a hand-written decision lists the node its stop recorded)
  assert.deepEqual(stale(), ['R/M1@g1', 'R/M2@g1', 'R/M3@g1'], 'A answered by regenerate: its marks are HELD');
  assert.deepEqual(foldRecord(events(t.rootDir)).openStops, [b.id]);
  const d = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'resolved in place', affected: [], form: 'milestone', stopId: b.id, node: 'R', generation: 1, milestone: 'M5', ...GATE_FIELDS });
  appendTreeEvent(t.rootDir, { event: 'milestone_resolved', node: 'R', generation: 1, milestone: 'M5', decisionId: d.id });
  assert.deepEqual(stale(), ['R/M1@g1', 'R/M2@g1'], 'B released in place: R/M3 (only B\'s) is free; R/M2 stays (A\'s held mark)');
  assert.throws(() => appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: '../x', generation: 1 }] }), TypeError);
});

// ---------------------------------------------------------------------------------------------------------------------------------- the cost of the gate (a known risk, stated with numbers)
test('the gate on a 13-member tree (the root and 12 children, 120 reservations) stays cheap: it reads plain files while a running member\'s mirror write waits (about 2 s) for the lock', () => {
  const t = closedRootTree({ cap: 1000 });
  const nodes = Array.from({ length: 12 }, (_, i) => `R/M${i + 1}`);
  const key = approveFrontier(t.rootDir, nodes);
  for (let i = 0; i < nodes.length; i++) {
    registerKid(t, key, nodes[i], IDS[i], 20);
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(nodes[i], IDS[i], process.pid, 1, hostnameOf()) });
    syntheticRun(t, IDS[i], { usage: Array.from({ length: 10 }, (_, j) => ({ file: `s${j}`, usd: 0.1, reservationId: `r${j + 1}` })) });
    writeLines(t, IDS[i], nodes[i], Array.from({ length: 10 }, (_, j) => [reservedLine(`r${j + 1}`, 0.2, `s${j}`), settledLine(`r${j + 1}`, 'recorded', 0.1)]).flat());
    appendTreeEvent(t.rootDir, { event: 'node_closed', node: nodes[i], generation: 1, runId: IDS[i], outcome: 'passed', passed: true, status: null, share: 'released' });
  }
  const runs = [];
  for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); var g = gateTree(t.rootDir); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  assert.equal(g.ok, true, JSON.stringify(g.problems));
  assert.equal(g.members.length, 13); assert.equal(g.reservations.length, 120);
  const worst = Math.max(...runs);
  console.log(`# gate: ${g.members.length} members, ${g.reservations.length} reservations, ${events(t.rootDir).length} events: worst of 5 reads ${worst.toFixed(1)} ms`);
  assert.ok(worst < 1000, `the gate took ${worst.toFixed(0)} ms, which is half of the mirror writer's 2 s wait`);
});

// ---------------------------------------------------------------------------------------------------------------------------------- nothing that moves money authority is reachable without a person (PLAN 3, 8: "no MCP tool, library option or model output approves anything")
import * as publicApi from '../src/api.js';
test('topUp and acceptAccounting are internal until M5 gates them: neither is exported by src/api.js, declared in the types, or named by any MCP tool', () => {
  for (const name of ['topUp', 'acceptAccounting', 'closeIncomplete', 'returnedUsdOf', 'gateTree', 'budgetOf']) assert.equal(name in publicApi, false, `${name} must not be part of the public library`);
  const src = join(new URL('..', import.meta.url).pathname, 'src');
  const surfaces = [readFileSync(join(src, 'api.js'), 'utf8'), readFileSync(join(new URL('..', import.meta.url).pathname, 'types', 'index.d.ts'), 'utf8'),
    ...readdirSync(join(src, 'mcp')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(src, 'mcp', f), 'utf8'))];
  for (const text of surfaces) for (const needle of ['topUp', 'acceptAccounting', 'closeIncomplete', 'tree-close', 'tree-decide-stop', 'tree-affected', 'tree-detect', 'tree-obligation', 'tree-stop-view', 'accounting_accepted', 'grant_issued', 'tree-budget']) assert.equal(text.includes(needle), false, `a public surface mentions ${needle}`);
});

// ================================================================================================================================ M2c: the member's start, the clamp, the stops (real members on the all-mock chains, $0)
import * as api from '../src/api.js';
import { spawnSync } from 'node:child_process';
import { bundleDirOf, bundleSha256Of } from '../src/tree-continuation.js';
import { cli, lineageFile, rootOpts } from './helpers/tree-fixture.js';

// A real tree: the root is a finished `split-root` run (mock-debate whose plan carries a split block and whose handoff reproduced it: it passes PLAN 5.5 items 1-3, which a child's start checks); children run `mock-budget`, whose fixture prices make every call reserve and mirror.
async function liveTree({ cap = 200 } = {}) {
  const t = newTree({ cap });
  registerRoot(t.rootDir);
  const root = await api.run(rootOpts(t));
  assert.equal(root.exitCode, 0, root.outputTail);
  return t;
}
const kid = (t, node, id, opts = {}) => api.run({ chain: t.childChain, task: 'tasks/x.md', cwd: t.work, runId: id, treeNode: lineageFile(t.work, node), ...opts });
const nodeEvents = rootDir => events(rootDir).filter(e => e.event !== 'reservation_mirrored');
const lastBlocked = rootDir => events(rootDir).filter(e => e.event === 'blocked').at(-1);
const usageFiles = dir => readdirSync(dir).filter(f => f.endsWith('.usage.json'));

test('the claim carries the cap: the run is held to min(asked, lifetime cap), both on the event; a cap stop writes node_stopped, keeps the grant held, and a resume asking more is clamped to the grant (C12, C24, C25)', async () => {
  const t = await liveTree();
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 40);
  const first = await kid(t, 'R/M1', IDS[0], { maxUsd: 9 });
  assert.equal(first.exitCode, 4, first.outputTail);                       // exit 4: the spend cap, and only that
  const claim = nodeEvents(t.rootDir).find(e => e.event === 'node_started' && e.node === 'R/M1');
  assert.deepEqual([claim.capAskedUsd, claim.lifetimeCapUsd, claim.capUsd], [9, 40, 9], 'asked 9, lifetime cap 40 (the grant): held to 9');
  assert.equal(nodeEvents(t.rootDir).at(-1).event, 'node_stopped');
  assert.ok(!nodeEvents(t.rootDir).some(e => e.event === 'node_closed' && e.node === 'R/M1'), 'a cap stop is not a close');
  let b = budgetOf(t.rootDir);
  const m1 = b.nodes.find(n => n.key === 'R/M1@g1');
  assert.equal(m1.phase, 'stopped');
  assert.ok(m1.heldUsd > 30 && m1.heldUsd < 40, `its grant stays held (${m1.heldUsd})`);
  // the same child asked for far more is still held to its grant: the run's cap is the lifetime cap, not a fresh allowance
  const second = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 1000 });
  assert.equal(second.exitCode, 0, second.outputTail);
  const claim2 = nodeEvents(t.rootDir).find(e => e.event === 'node_resumed' && e.node === 'R/M1');
  assert.deepEqual([claim2.purpose, claim2.capAskedUsd, claim2.lifetimeCapUsd, claim2.capUsd], ['resume', 1000, 40, 40]);
  const closed = nodeEvents(t.rootDir).find(e => e.event === 'node_closed' && e.node === 'R/M1');
  assert.ok(closed.returnedUsd > 0 && closed.returnedUsd < 40, `returnedUsd is the grant minus what runSpentUsd counts (${closed.returnedUsd})`);
  b = budgetOf(t.rootDir);
  assert.equal(b.nodes.find(n => n.key === 'R/M1@g1').heldUsd, 0, 'only the close releases the grant');
  assert.ok(b.treeSpentUsd + b.heldUsd <= b.rootCapUsd + MONEY_EPS);
  assert.equal(gateTree(t.rootDir).ok, true, 'a real priced member, mirrored line by line, passes the gate');
  assert.ok(gateTree(t.rootDir).reservations.length >= 4 && gateTree(t.rootDir).reservations.every(r => r.row === 1));
});

test('a refused start and a cap stop never use each other\'s exit code; api.resume names exit 19 `tree_refused` (C25)', async () => {
  const t = await liveTree();
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 40);
  const stopped = await kid(t, 'R/M1', IDS[0], { maxUsd: 9 });
  assert.equal(stopped.exitCode, 4); assert.notEqual(stopped.status, 'tree_refused');
  // a stale mark: the next resume is a tree refusal, never "raise --max-usd"
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'integration', affected: [{ node: 'R/M1', generation: 1 }] });
  const refused = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 1000 });
  assert.equal(refused.exitCode, 19, refused.outputTail);
  assert.equal(refused.status, 'tree_refused');
  assert.match(refused.outputTail, /Nothing was run and nothing was spent/);
  assert.doesNotMatch(refused.outputTail, /Raise --max-usd/i);
});

test('the continuation checks: a resume (direct CLI and api.resume) of a member whose approval was invalidated, whose input bundle was edited, whose provider has a newer generation, or which is stale, exits 19 naming the check, calls nothing, writes no node_resumed, and a sibling registration right after succeeds (C23)', async () => {
  const cases = {
    approval: async t => { const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2'], { hash: 'h1' }); return { key, reapprove: () => appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: key, revision: 2, boundSha256: 'h2' }), after: () => appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: key, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: 'b'.repeat(64), children: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], boundSha256: 'h2' }) }; },
    bundle: async t => {
      const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
      const dir = bundleDirOf(t.rootDir, 'R/M1', 1); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'task.md'), 'Plan a tiny change.\n');
      return { key, extra: { bundleSha256: bundleSha256Of(dir) }, after: () => writeFileSync(join(dir, 'task.md'), 'Plan something else.\n') };
    },
    stale: async t => ({ key: approveFrontier(t.rootDir, ['R/M1', 'R/M2']), after: () => appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'integration', affected: [{ node: 'R/M1', generation: 1 }] }) }),
  };
  for (const [check, build] of Object.entries(cases)) {
    const t = await liveTree();
    const { key, extra = {}, after, reapprove } = await build(t);
    registerChildExtra(t, key, 'R/M1', IDS[0], 40, extra);
    const first = await kid(t, 'R/M1', IDS[0], { maxUsd: 9 });
    assert.equal(first.exitCode, 4, `${check}: ${first.outputTail}`);
    const usageBefore = usageFiles(join(t.runsDir, IDS[0])).length;
    after();
    const refused = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 1000 });
    assert.equal(refused.exitCode, 19, `${check}: ${refused.outputTail}`);
    assert.equal(refused.status, 'tree_refused');
    const b = lastBlocked(t.rootDir);
    assert.deepEqual([b.reason, b.check, b.scope], ['continuation_refused', check, 'R/M1@g1'], check);
    assert.equal(nodeEvents(t.rootDir).filter(e => e.event === 'node_resumed').length, 0, `${check}: no claim was written`);
    assert.equal(usageFiles(join(t.runsDir, IDS[0])).length, usageBefore, `${check}: no provider call`);
    assert.equal(stateOf(readTreeRecord(t.rootDir)).active, null, `${check}: no phantom active node`);
    // the direct CLI says the same
    const direct = spawnSync(process.execPath, [cli, '--resume', join(t.runsDir, IDS[0]), '--max-usd', '1000'], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work }, timeout: 120_000 });
    assert.equal(direct.status, 19, `${check}: ${direct.stderr}`);
    // a sibling registration right after succeeds (an invalidated approval has to be given again first: that is the person's, and is its own revision)
    reapprove?.();
    assert.doesNotThrow(() => registerKid(t, key, 'R/M2', IDS[1], 40), `${check}: sibling`);
  }
  // a provider with a newer generation (PLAN 8.1): M1 depends on R/M2@g1; R/M2@g2 now exists
  const t = await liveTree();
  const key1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key1, 'R/M2', IDS[1], 20);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[1], {});
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M2', generation: 1, runId: IDS[1], outcome: 'passed', passed: true, status: null, share: 'released' });
  registerChildExtra(t, key1, 'R/M1', IDS[0], 40, { dependsOn: [{ node: 'R/M2', generation: 1 }] });
  assert.equal((await kid(t, 'R/M1', IDS[0], { maxUsd: 9 })).exitCode, 4);
  const key2 = approveFrontier(t.rootDir, ['R/M2'], { generation: 2, openedBy: 'e900' });
  registerKid(t, key2, 'R/M2', IDS[2], 10, 2);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[2], process.pid, 2, hostnameOf()) });
  syntheticRun(t, IDS[2], {});
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M2', generation: 2, runId: IDS[2], outcome: 'passed', passed: true, status: null, share: 'released' });
  const refused = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 1000 });
  assert.equal(refused.exitCode, 19, refused.outputTail);
  const b = lastBlocked(t.rootDir);
  assert.deepEqual([b.reason, b.check], ['continuation_refused', 'provider']);
});
function registerChildExtra(t, key, node, runId, grantUsd, extra) {
  return registerChildUnchecked(t.rootDir, { frontierKey: key, node, generation: 1, runId, parentRunId: ROOT_ID, chain: { name: t.childChain, sha256: t.shaIn(t.childChain) }, grant: { amount: grantUsd, unit: 'usd' }, ...extra });
}
import { registerChildUnchecked } from '../src/tree-register.js';

// ---------------------------------------------------------------------------------------------------------------------------------- chains of the tests' own (written into the working folder, where the CLI looks first)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { recoverTree } from '../src/tree-recovery.js';
import { runEndOf, pausedAtExternalSeat } from '../src/tree-member.js';
import { RESERVATIONS_FILE } from '../src/spend-reservations.js';
import { root as repoRoot } from './helpers/tree-fixture.js';

const mockDebate = () => JSON.parse(readFileSync(join(repoRoot, 'chains', 'mock-debate.json'), 'utf8'));
const pricedSeat = { provider: 'mock', model: 'mock-priced', maxTokens: 50 };
const hangSeat = port => ({ provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: `http://127.0.0.1:${port}` });
const withSeats = (extra) => { const c = mockDebate(); return { ...c, seats: { ...c.seats, ...extra } }; };
const chainSet = port => ({
  'priced-debate': withSeats({ handoff: pricedSeat }),
  'hang-handoff': withSeats({ handoff: hangSeat(port) }),
  'hang-first': withSeats({ criteria: hangSeat(port) }),
  'hang-later': withSeats({ criteria: { provider: 'mock', model: 'mock-priced', maxTokens: 100 }, skeleton: hangSeat(port) }),
});
async function hangingServer() {
  const srv = http.createServer(req => { req.resume(); });                                  // takes the request and never answers
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}
const waitFor = async (cond, what, ms = 15000) => { for (let i = 0; i < ms / 50; i++) { if (cond()) return; await new Promise(r => setTimeout(r, 50)); } assert.fail(`timed out waiting for ${what}`); };
// the chain lint refuses a loopback baseUrl with a key unless this switch is set (the test's seat IS a local server that never answers)
const ENV = work => ({ PATH: process.env.PATH, HOME: work, OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' });
const closeNode = (t, node, id, generation = 1) => appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation, runId: id, outcome: 'passed', passed: true, status: null, share: 'released' });

// ---------------------------------------------------------------------------------------------------------------------------------- W1: --max-usd none is refused for a member, on every path, before anything is written
test('`--max-usd none` is refused for a member on every path (the flag, api, a run.json that saved no cap, handoff none and off): exit 19, no run folder or claim written (W1)', async () => {
  const t = await liveTree();
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 60);
  const before = events(t.rootDir).length;
  const flag = spawnSync(process.execPath, [cli, '--chain', 'mock-budget', '--task', 'tasks/x.md', '--run-id', IDS[0], '--max-usd', 'none', '--tree-node', lineageFile(t.work, 'R/M1')], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });
  assert.equal(flag.status, 19, flag.stderr); assert.match(flag.stderr, /--max-usd none is refused/);
  assert.equal(existsSync(join(t.runsDir, IDS[0])), false, 'before a run folder exists');
  const viaApi = await kid(t, 'R/M1', IDS[0], { maxUsd: 'none' });
  assert.equal(viaApi.exitCode, 19); assert.equal(viaApi.status, 'tree_refused');
  assert.equal(events(t.rootDir).length, before, 'nothing was written to the record');
  // a member stopped at its cap whose run.json says "no cap" (a hand edit, or an old file): a resume without --max-usd inherits it and is refused
  assert.equal((await kid(t, 'R/M1', IDS[0], { maxUsd: 9 })).exitCode, 4);
  const rj = join(t.runsDir, IDS[0], 'run.json');
  writeFileSync(rj, JSON.stringify({ ...JSON.parse(readFileSync(rj, 'utf8')), maxUsd: null }));
  const n = events(t.rootDir).length;
  const resumed = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work });
  assert.equal(resumed.exitCode, 19, resumed.outputTail);
  assert.equal(events(t.rootDir).length, n, 'refused before the claim: no record written');
  // handoff --from-run: none and off
  for (const v of ['none', 'off']) {
    const h = spawnSync(process.execPath, [cli, 'handoff', '--from-run', join(t.runsDir, IDS[0]), '--max-usd', v], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });
    assert.equal(h.status, 19, `${v}: ${h.stderr}`); assert.match(h.stderr, /--max-usd none is refused/);
  }
  assert.equal(events(t.rootDir).length, n);
});

// ---------------------------------------------------------------------------------------------------------------------------------- C11, C19, C21: one active node
test('one active node: a registration while another node is active is refused, one while the only other open node is budget-stopped is accepted; a resume of a stopped member needs nothing else active and writes node_resumed before any call (C11, C19)', async () => {
  const t = await liveTree();
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 60);
  assert.equal((await kid(t, 'R/M1', IDS[0], { maxUsd: 9 })).exitCode, 4);                    // R/M1 is budget-stopped: not active
  assert.equal(stateOf(readTreeRecord(t.rootDir)).active, null);
  registerKid(t, key, 'R/M2', IDS[1], 60);                                                    // accepted: the only other open node is stopped
  assert.equal(stateOf(readTreeRecord(t.rootDir)).active, 'R/M2@g1');
  const refused = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 1000 });
  assert.equal(refused.exitCode, 19, refused.outputTail);
  assert.deepEqual([lastBlocked(t.rootDir).reason, lastBlocked(t.rootDir).transition], ['transition_refused', 'node_resumed']);
  assert.match(lastBlocked(t.rootDir).detail, /R\/M2@g1 is active/);
  assert.throws(() => registerKid(t, key, 'R/M3', IDS[2], 5), TreeRefusal);                   // and a third registration is refused too
  // R/M2 ends; now R/M1 may resume, and its claim comes before any call of the sitting
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[1], {}); closeNode(t, 'R/M2', IDS[1]);
  const ok = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 1000 });
  assert.equal(ok.exitCode, 0, ok.outputTail);
  const ev = events(t.rootDir);
  const at = ev.findIndex(e => e.event === 'node_resumed' && e.node === 'R/M1');
  assert.ok(at > 0);
  const callsBefore = ev.slice(0, at).filter(e => e.event === 'reservation_mirrored').length;
  const newCalls = ev.slice(at + 1).filter(e => e.event === 'reservation_mirrored');
  assert.ok(newCalls.length > 0 && ev.slice(0, at).filter(e => e.event === 'reservation_mirrored').length === callsBefore, 'every call of the resumed sitting is mirrored AFTER its claim');
});

test('a paused child (an external seat is waiting) keeps its grant held and blocks a second child (C21)', async () => {
  const t = newTree({ cap: 200, childChain: 'mock-external' });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 25);
  const paused = await api.run({ chain: 'mock-external', task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1') });
  assert.equal(paused.exitCode, 3, paused.outputTail);
  assert.equal(pausedAtExternalSeat(join(t.runsDir, IDS[0])), true);
  assert.equal(stateOf(readTreeRecord(t.rootDir)).active, 'R/M1@g1', 'a paused node is still active');
  assert.equal(budgetOf(t.rootDir).nodes.find(n => n.key === 'R/M1@g1').heldUsd, 25, 'its grant stays held');
  assert.throws(() => registerKid(t, key, 'R/M2', IDS[1], 25), e => e instanceof TreeRefusal && /R\/M1@g1 is active/.test(e.reason));
  assert.equal(runEndOf(join(t.runsDir, IDS[0])), null, 'a pause is not an end');
});

// ---------------------------------------------------------------------------------------------------------------------------------- C22: no live grant
test('after a member\'s run has ended, `handoff --from-run` with no live grant left exits 19 with a blocked record and no provider call (C22)', async () => {
  const t = newTree({ cap: 100, childChain: 'priced-debate', extraChains: chainSet(1) });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 50);
  const done = await api.run({ chain: 'priced-debate', task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1'), maxUsd: 50 });
  assert.equal(done.exitCode, 0, done.outputTail);
  // R/M2 takes every dollar the root still has free and stops: not active, grant held
  const free = budgetOf(t.rootDir).availableUsd;
  registerKid(t, key, 'R/M2', IDS[1], free);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[1], {});
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M2', generation: 1, runId: IDS[1], reason: 'budget' });
  const life = lifetimeCapOf(budgetOf(t.rootDir), 'R/M1@g1');
  assert.equal(life.live, false, 'no live grant: min(grant - spent, rootCap - treeSpent - heldByOthers) is zero');
  const usageBefore = usageFiles(join(t.runsDir, IDS[0])).length; const n = events(t.rootDir).length;
  const h = spawnSync(process.execPath, [cli, 'handoff', '--from-run', join(t.runsDir, IDS[0]), '--max-usd', '1000'], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });
  assert.equal(h.status, 19, h.stdout + h.stderr);
  assert.deepEqual([lastBlocked(t.rootDir).reason, lastBlocked(t.rootDir).check], ['continuation_refused', 'grant']);
  assert.equal(events(t.rootDir).length, n + 1, 'one blocked record and nothing else');
  assert.equal(usageFiles(join(t.runsDir, IDS[0])).length, usageBefore); assert.equal(readdirSync(join(t.runsDir, IDS[0])).some(f => /^HANDOFF-from-run/.test(f)), false, 'no call was made');
});

// ---------------------------------------------------------------------------------------------------------------------------------- C8, C9: a post-run paid call
test('a member\'s post-run `handoff --from-run`: refused while another node is active; with none active it writes node_resumed (post_run), is held to the lifetime cap, and node_released when it ends; a sibling registration during it is refused (C8)', async () => {
  const t = newTree({ cap: 100, childChain: 'priced-debate', extraChains: chainSet(1) });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 50);
  assert.equal((await api.run({ chain: 'priced-debate', task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1'), maxUsd: 50 })).exitCode, 0);
  const handoff = (max = '30') => spawnSync(process.execPath, [cli, 'handoff', '--from-run', join(t.runsDir, IDS[0]), '--max-usd', max], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });
  registerKid(t, key, 'R/M2', IDS[1], 20);                                                    // R/M2 is registered: active
  const refused = handoff();
  assert.equal(refused.status, 19, refused.stdout + refused.stderr);
  assert.match(lastBlocked(t.rootDir).detail, /R\/M2@g1 is active/);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[1], {}); closeNode(t, 'R/M2', IDS[1]);
  const ok = handoff();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const ev = nodeEvents(t.rootDir).filter(e => e.node === 'R/M1');
  const resumed = ev.find(e => e.event === 'node_resumed'); const released = ev.find(e => e.event === 'node_released');
  assert.deepEqual([resumed.purpose, typeof resumed.capUsd, resumed.capAskedUsd], ['post_run', 'number', 30]);
  assert.ok(resumed.capUsd <= resumed.lifetimeCapUsd + 1e-9);
  assert.ok(released && released.reason === 'ended' && ev.indexOf(released) > ev.indexOf(resumed), 'the claim ends when the call ends');
  assert.equal(stateOf(readTreeRecord(t.rootDir)).active, null);
  assert.equal(gateTree(t.rootDir).ok, true, 'the post-run call\'s reservation and charge are in the record and match');
});

// CHANGED ACCEPTED (already-false unit, Q3; C&C thcmcp-cd 24 Okt 2026): a member's post-run `handoff --from-run --chain <other>` is now REFUSED as a changed chain (the tree's chain check reads the file the call sends). OLD: the member ran on `priced-debate` and this call went out with `--chain hang-handoff`, a chain that is not the node's, to make the handoff call hang. NEW: the member's OWN chain is `hang-handoff`; its server answers the run's one handoff call and hangs the post-run call, which goes out without --chain. WHY: the test is about a post-run call killed in flight, not about the chain check; what the call is held to (the node's registered chain) is the product's rule now.
// the run's handoff call is answered (a plain completion), every later request is taken and never answered
async function answerThenHangServer() {
  const gate = { hang: false };
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      if (gate.hang) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'stub', model: JSON.parse(body).model, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: 'Plan: make the one small change.\n' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port, gate };
}

test('a post-run call killed mid-way leaves node_resumed without node_released; while it is in flight a sibling registration is refused; recovery on the same host appends node_released and a registration then succeeds (C9)', async () => {
  const { srv, port, gate } = await answerThenHangServer();
  try {
    const t = newTree({ cap: 100, childChain: 'hang-handoff', extraChains: chainSet(port) });
    registerRoot(t.rootDir);
    assert.equal((await api.run(rootOpts(t))).exitCode, 0);
    const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']); registerKid(t, key, 'R/M1', IDS[0], 50);
    let ran = ''; const run = spawn(process.execPath, [cli, '--chain', 'hang-handoff', '--task', 'tasks/x.md', '--run-id', IDS[0], '--tree-node', lineageFile(t.work, 'R/M1'), '--max-usd', '30'], { cwd: t.work, env: ENV(t.work) });
    run.stdout.on('data', d => { ran += d; }); run.stderr.on('data', d => { ran += d; });
    assert.equal(await new Promise(r => run.on('exit', r)), 0, `the member's own run (the server answers its handoff call): ${ran}`);
    gate.hang = true;
    const child = spawn(process.execPath, [cli, 'handoff', '--from-run', join(t.runsDir, IDS[0]), '--max-usd', '30'], { cwd: t.work, env: ENV(t.work) });
    const unsettled = () => { try { return readFileSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.event === 'reserved').length > readFileSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.event === 'settled').length; } catch { return false; } };
    await waitFor(unsettled, 'the handoff call to be in flight');
    assert.equal(stateOf(readTreeRecord(t.rootDir)).active, 'R/M1@g1', 'the post-run claim makes the node active');
    assert.throws(() => registerKid(t, key, 'R/M2', IDS[1], 20), e => e instanceof TreeRefusal && /R\/M1@g1 is active/.test(e.reason));
    child.kill('SIGKILL'); await new Promise(r => child.on('exit', r));
    const ev = nodeEvents(t.rootDir).filter(e => e.node === 'R/M1').map(e => e.event);
    assert.deepEqual(ev.slice(-2), ['node_closed', 'node_resumed'], 'node_resumed with no node_released');
    assert.ok(!ev.includes('node_released'));
    const out = await recoverTree(t.rootDir, { runFactsOf: () => ({ hasRunJson: true, end: null, paused: false }) });
    assert.equal(out.applied.length, 1);
    const rel = events(t.rootDir).at(-1);
    assert.deepEqual([rel.event, rel.reason], ['node_released', 'dead_post_run']);
    assert.equal(stateOf(readTreeRecord(t.rootDir)).active, null);
    assert.doesNotThrow(() => registerKid(t, key, 'R/M2', IDS[1], 20), 'a registration then succeeds');
  } finally { srv.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------------- C1, C2, C18, C20: a member killed mid-call
// `hang-first`: the first paid call (the criteria seat, a priced API seat) goes to a local server that never answers. The tree is started with the child's grant derived from the call's own reservation, so the numbers
// are the harness's, not typed here.
async function killedMidCall({ chainName, grantOf, srv, port, hungLabel = 'criteria' }) {
  const t = newTree({ cap: 100, childChain: chainName, extraChains: chainSet(port) });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  const grantUsd = grantOf(t);
  registerKid(t, key, 'R/M1', IDS[0], grantUsd);
  const child = spawn(process.execPath, [cli, '--chain', chainName, '--task', 'tasks/x.md', '--run-id', IDS[0], '--tree-node', lineageFile(t.work, 'R/M1'), '--max-usd', '30'], { cwd: t.work, env: ENV(t.work) });
  const file = join(t.runsDir, IDS[0], RESERVATIONS_FILE);
  const hungLines = () => { try { return readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  // in flight = the hanging stage's reserved line is in the run file, unsettled, and ITS OWN mirror is in the record. Reservation ids are per-run counters (r1, r2, ...), so the id alone also matches the ROOT's mirrored r1 (its priced handoff), which is in the record before the member starts:
  // without the runId the wait passed in the gap between the member's file write and its own mirror append, and a kill there left no member mirror (tree-budget:739 failed `true !== false` under load, 5 times in full suites)
  await waitFor(() => { const r = hungLines().find(x => x.event === 'reserved' && x.label === hungLabel); return r && !hungLines().some(x => x.event === 'settled' && x.id === r.id) && events(t.rootDir).some(e => e.event === 'reservation_mirrored' && e.runId === IDS[0] && e.line.id === r.id && e.line.event === 'reserved'); }, `the ${hungLabel} call to be in flight and mirrored`, 20000);
  child.kill('SIGKILL'); await new Promise(r => child.on('exit', r));
  return { t, key, grantUsd, lines: hungLines() };
}
const unsettledOf = lines => lines.filter(l => l.event === 'reserved' && !lines.some(s => s.event === 'settled' && s.id === l.id));

test('SIGKILL a member mid-call, then resume it through the CLI asking --max-usd 30: one attempt in the record, its unsettled reservation counted ONCE in treeSpent, the run held to the lifetime cap, nothing new spent (C1)', async () => {
  const { srv, port } = await hangingServer();
  try {
    // probe: how much one criteria call reserves here (the same prompt reserves the same), taken from a throw-away tree
    const probe = await killedMidCall({ chainName: 'hang-first', grantOf: () => 50, srv, port });
    const W = unsettledOf(probe.lines)[0].usd;
    assert.ok(W > 0);
    const grant = W * 1.4;                                                                    // after the kill, a second call (W) cannot fit: 2W > 1.4W
    const { t, lines } = await killedMidCall({ chainName: 'hang-first', grantOf: () => grant, srv, port });
    const left = unsettledOf(lines); assert.equal(left.length, 1); assert.ok(Math.abs(left[0].usd - W) < 1e-9);
    const g = gateTree(t.rootDir);
    assert.equal(g.ok, true, JSON.stringify(g.problems));
    assert.equal(cents(g.treeSpentUsd), cents(W + SPLIT_ROOT_HANDOFF_USD), 'the unsettled reservation counts once: the tree spent is the root\'s own $0.04 handoff plus W, and nothing else');
    // the root's own (priced) handoff call has a reserved and a settled reservation_mirrored line in the record now, so the gate lists the root's reservation first (row 1, worst case 3.59: printed by s2/scratch/root-mirrors.test.js); the member's is found by its run, not by position
    assert.equal(g.reservations.find(x => x.runId === IDS[0]).row, 2);
    const before = readFileSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE), 'utf8');
    const resumed = spawnSync(process.execPath, [cli, '--resume', join(t.runsDir, IDS[0]), '--max-usd', '30'], { cwd: t.work, encoding: 'utf8', env: ENV(t.work), timeout: 60_000 });
    assert.equal(resumed.status, 4, resumed.stdout + resumed.stderr);                          // the cap stopped it, before any call
    const mine = nodeEvents(t.rootDir).filter(e => e.node === 'R/M1');
    assert.deepEqual(mine.map(e => e.event), ['node_registered', 'node_started', 'node_resumed', 'node_stopped'], 'one attempt: registered once, started once, resumed once');
    const c2 = mine.find(e => e.event === 'node_resumed');
    assert.deepEqual([c2.purpose, c2.capAskedUsd], ['resume', 30]);
    assert.ok(Math.abs(c2.lifetimeCapUsd - grant) < 1e-9, `lifetime cap = spent + min(grant - spent, pool) = the grant (${c2.lifetimeCapUsd} vs ${grant})`);
    assert.ok(Math.abs(c2.capUsd - grant) < 1e-9, 'the run was held to min(30, lifetime cap)');
    assert.equal(readFileSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE), 'utf8'), before, 'no call was reserved, so nothing new was spent');
    const after = gateTree(t.rootDir);
    assert.equal(after.addedUsd, 0, 'the tree adds nothing of its own to the unsettled reservation');
    // the stop file holds the total at the stop and runSpentUsd no longer adds the same reservation again (M2e, test/spend-stopped-in-flight.test.js): exactly W, as the plan's check says
    assert.equal(cents(after.treeSpentUsd), cents(W + SPLIT_ROOT_HANDOFF_USD), 'and it is STILL counted once after a capped resume (C1: "its unsettled reservation counted once in treeSpent")');
    // a second resume of the same node: its only charge is the one in-flight W, so it has a live grant (1.4W - W > 0) and stops at the cap again, exit 4 -- not "no live grant" (exit 19)
    const again = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 30, env: ENV(t.work) });
    assert.equal(again.exitCode, 4, again.outputTail);
    const c3 = nodeEvents(t.rootDir).filter(e => e.event === 'node_resumed' && e.node === 'R/M1').at(-1);
    assert.ok(Math.abs(c3.lifetimeCapUsd - grant) < 1e-9, `the lifetime cap is still the grant (${c3.lifetimeCapUsd})`);
  } finally { srv.close(); }
});

test('a member killed during its first paid call whose spend-reservations.jsonl is then deleted is accounting_blocked on the next start or resume, and its mirrored reservation stays counted in treeSpent (C18)', async () => {
  const { srv, port } = await hangingServer();
  try {
    const { t, lines } = await killedMidCall({ chainName: 'hang-first', grantOf: () => 50, srv, port });
    const W = unsettledOf(lines)[0].usd;
    assert.equal(cents(gateTree(t.rootDir).treeSpentUsd), cents(W + SPLIT_ROOT_HANDOFF_USD), 'before the damage: the unsettled reservation, once, plus the root\'s own $0.04 handoff');
    unlinkSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE));
    const g = gateTree(t.rootDir);
    assert.equal(g.ok, false); assert.ok(codes(g).includes('mirror_ahead_of_file'));
    assert.equal(cents(g.treeSpentUsd), cents(W + SPLIT_ROOT_HANDOFF_USD), 'the mirrored worst case is counted instead of forgotten (row 4), beside the root\'s own $0.04 handoff');
    assert.equal(g.reservations.find(x => x.runId === IDS[0]).row, 4);
    const blocked = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 30, env: ENV(t.work) });
    assert.equal(blocked.exitCode, 19, blocked.outputTail);
    assert.deepEqual([lastBlocked(t.rootDir).reason, lastBlocked(t.rootDir).scope], ['accounting_blocked', 'R/M1@g1']);
    assert.equal(nodeEvents(t.rootDir).filter(e => e.event === 'node_resumed').length, 0, 'no claim, no provider call');
    assert.equal(stateOf(readTreeRecord(t.rootDir)).sticky.size, 0, 'derived by the gate, not stored: restoring the file lifts it');
    writeFileSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE), lines.map(l => JSON.stringify(l)).join('\n') + '\n');         // the record is restored byte for byte
    assert.equal(gateTree(t.rootDir).ok, true);
  } finally { srv.close(); }
});

test('the same kill and resume through api.resume is clamped identically (C2)', async () => {
  const { srv, port } = await hangingServer();
  try {
    const probe = await killedMidCall({ chainName: 'hang-first', grantOf: () => 50, srv, port });
    const W = unsettledOf(probe.lines)[0].usd; const grant = W * 1.4;
    const { t } = await killedMidCall({ chainName: 'hang-first', grantOf: () => grant, srv, port });
    const res = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 30, env: ENV(t.work) });
    assert.equal(res.exitCode, 4, res.outputTail);
    const c2 = nodeEvents(t.rootDir).find(e => e.event === 'node_resumed' && e.node === 'R/M1');
    assert.ok(Math.abs(c2.lifetimeCapUsd - grant) < 1e-9 && Math.abs(c2.capUsd - grant) < 1e-9 && c2.capAskedUsd === 30, JSON.stringify(c2));
    assert.equal(gateTree(t.rootDir).addedUsd, 0);
  } finally { srv.close(); }
});

test('a priced member that completed one paid stage and was then interrupted mid-call: deleting its reservations file, or setting a non-mock usage file\'s usd to a non-number, makes every start and resume exit 19 with a blocked record (C20)', async () => {
  const { srv, port } = await hangingServer();
  try {
    for (const [name, damage, code] of [
      ['reservations file deleted', (t) => unlinkSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE)), 'mirror_ahead_of_file'],
      ['a non-mock usage file with a non-number usd', (t) => { const f = join(t.runsDir, IDS[0], 'criteria.usage.json'); writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), provider: 'openrouter', usd: 'abc' })); }, 'money_not_a_number'],
    ]) {
      const { t } = await killedMidCall({ chainName: 'hang-later', grantOf: () => 60, srv, port, hungLabel: 'skeleton' });
      assert.equal(usageFiles(join(t.runsDir, IDS[0])).includes('criteria.usage.json'), true, 'one paid stage completed before the interruption');
      assert.equal(gateTree(t.rootDir).ok, true, `${name}: sound before the damage`);
      damage(t);
      assert.ok(codes(gateTree(t.rootDir)).includes(code), `${name}: ${codes(gateTree(t.rootDir))}`);
      const refused = await api.resume({ runDir: join(t.runsDir, IDS[0]), cwd: t.work, maxUsd: 30, env: ENV(t.work) });
      assert.equal(refused.exitCode, 19, `${name}: ${refused.outputTail}`);
      assert.equal(lastBlocked(t.rootDir).reason, 'accounting_blocked');
    }
  } finally { srv.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------------- C16: parallel calls are all mirrored
test('a member whose round runs three priced panel seats in parallel mirrors every reserved and settled line, none of its calls is refused for the tree lock, and the mirror and the run file hold the same lines; the same round while the orchestrator keeps taking the lock for short writes waits and succeeds (C16)', async () => {
  const panel = withSeats({ critics: ['a', 'b', 'c'].map(l => ({ provider: 'mock', model: 'mock-priced', maxTokens: 100, lab: `mock-${l}` })) });
  const run3 = async (busy) => {
    const t = newTree({ cap: 400, childChain: 'priced-panel', extraChains: { 'priced-panel': panel } });
    registerRoot(t.rootDir);
    assert.equal((await api.run(rootOpts(t))).exitCode, 0);
    const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 300);
    let holder = null;
    if (busy) {
      // an "orchestrator" that keeps taking the tree lock for 150 ms at a time, again and again
      holder = spawn(process.execPath, ['--input-type=module', '-e', `import { withTreeLock } from ${JSON.stringify(join(repoRoot, 'src', 'tree-record.js'))};
        const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
        for (let i = 0; i < 40; i++) { withTreeLock(${JSON.stringify(t.rootDir)}, () => nap(150)); nap(20); }`], { stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 100));
    }
    const res = await kid(t, 'R/M1', IDS[0], { maxUsd: 250 });
    if (holder) { holder.kill('SIGKILL'); await new Promise(r => holder.on('exit', r)); try { unlinkSync(join(t.rootDir, 'tree', '.tree.lock')); } catch { /* released */ } }
    assert.equal(res.exitCode, 0, res.outputTail);
    const own = readFileSync(join(t.runsDir, IDS[0], RESERVATIONS_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const mirrored = events(t.rootDir).filter(e => e.event === 'reservation_mirrored' && e.runId === IDS[0]).map(e => e.line);
    assert.ok(own.filter(l => l.event === 'reserved').length >= 3, 'three or more priced calls');
    const key2 = l => JSON.stringify(Object.fromEntries(Object.entries(l).sort()));
    assert.deepEqual(mirrored.map(key2).sort(), own.map(key2).sort(), 'the mirror and the run file hold the same lines, `at` included');
    assert.equal(gateTree(t.rootDir).ok, true);
  };
  await run3(false);
  await run3(true);
});

// ---------------------------------------------------------------------------------------------------------------------------------- C12: the root's lifetime cap, and a post-run call that must leave a child's grant alone
test('a resume of the root, through the CLI and through api.resume, asking a cap above the root cap, runs under the lifetime cap; a post-run handoff on the root while a child holds a grant is capped so that grant stays intact (C12)', async () => {
  for (const via of ['cli', 'api']) {
    const t = newTree({ cap: 60, rootChain: 'mock-budget' });
    registerRoot(t.rootDir);
    const first = await api.run({ chain: 'mock-budget', task: 'tasks/x.md', cwd: t.work, runId: ROOT_ID, treeNode: lineageFile(t.work, 'R'), maxUsd: 9 });
    assert.equal(first.exitCode, 4, first.outputTail);
    const done = via === 'api'
      ? await api.resume({ runDir: join(t.runsDir, ROOT_ID), cwd: t.work, maxUsd: 1000 })
      : (r => ({ exitCode: r.status, outputTail: r.stdout + r.stderr }))(spawnSync(process.execPath, [cli, '--resume', join(t.runsDir, ROOT_ID), '--max-usd', '1000'], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work }, timeout: 120_000 }));
    assert.equal(done.exitCode, 0, `${via}: ${done.outputTail}`);
    const c = nodeEvents(t.rootDir).find(e => e.event === 'node_resumed');
    assert.deepEqual([c.capAskedUsd, c.lifetimeCapUsd, c.capUsd], [1000, 60, 60], `${via}: asked 1000, the root cap is 60, so the run is held to 60`);
  }
  // post-run on the root while a child holds a grant
  const t = newTree({ cap: 100, rootChain: 'priced-debate', childChain: 'priced-debate', extraChains: chainSet(1) });
  registerRoot(t.rootDir);
  assert.equal((await api.run({ chain: 'priced-debate', task: 'tasks/x.md', cwd: t.work, runId: ROOT_ID, treeNode: lineageFile(t.work, 'R'), maxUsd: 100 })).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  const free = budgetOf(t.rootDir).availableUsd;
  registerKid(t, key, 'R/M1', IDS[0], free - 0.0005);                                         // the child holds all but 0.0005 of the free pool...
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });    // ...and is stopped: not active, grant held
  const childHeld = budgetOf(t.rootDir).nodes.find(n => n.key === 'R/M1@g1').heldUsd;
  const h = spawnSync(process.execPath, [cli, 'handoff', '--from-run', join(t.runsDir, ROOT_ID), '--max-usd', '1000'], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });
  assert.equal(h.status, 4, h.stdout + h.stderr);                                              // the cap stopped it: the cap is the lifetime cap, not 1000
  const post = nodeEvents(t.rootDir).find(e => e.event === 'node_resumed' && e.purpose === 'post_run');
  assert.equal(post.capAskedUsd, 1000); assert.ok(post.capUsd < 100 && post.capUsd === post.lifetimeCapUsd);
  const b = budgetOf(t.rootDir);
  assert.equal(b.nodes.find(n => n.key === 'R/M1@g1').heldUsd, childHeld, 'the child\'s held grant is intact');
  assert.ok(b.treeSpentUsd + b.heldUsd <= b.rootCapUsd + MONEY_EPS);
  assert.equal(nodeEvents(t.rootDir).at(-1).event, 'node_released', 'and the post-run claim ended with the call');
});

test('--rematch and --replay of a tree member are refused with exit 19 before any side folder exists (they would spend outside the tree\'s record)', async () => {
  const t = await liveTree();
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 60);
  assert.equal((await kid(t, 'R/M1', IDS[0], { maxUsd: 100 })).exitCode, 0);
  const before = readdirSync(t.runsDir).sort();
  for (const flag of ['--rematch', '--replay']) {
    const r = spawnSync(process.execPath, [cli, flag, join(t.runsDir, IDS[0])], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work }, timeout: 60_000 });
    assert.equal(r.status, 19, `${flag}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /spend outside the tree/);
  }
  assert.deepEqual(readdirSync(t.runsDir).sort(), before, 'no side folder was created');
});

// ---------------------------------------------------------------------------------------------------------------------------------- gated admission (PLAN 7.2, 7.3): the gate, the limits and the grant, in one hold
import { registerChildAdmitted } from '../src/tree-register.js';
test('admission is gated: a grant larger than what the root cap has free, a child under the chain\'s cheapest end, a depth / fan-out / run limit, and a failing accounting gate are each refused with a blocked record and nothing is registered; a raise changes the limit', () => {
  const t = closedRootTree({ cap: 20 });
  const kids = ['R/M1', 'R/M2', 'R/M3', 'R/M4', 'R/M5'];
  const key = approveFrontier(t.rootDir, kids);
  const spec = (node, id, amount, extra = {}) => ({ frontierKey: key, node, generation: 1, runId: id, parentRunId: ROOT_ID, chain: { name: 'mock-budget', sha256: t.shaIn('mock-budget') }, grant: { amount, unit: 'usd' }, bundleSha256: 'e'.repeat(64), bundleBytes: 1000, ...extra });
  const refused = (child, re) => {
    const n = events(t.rootDir).filter(e => e.event === 'node_registered').length;
    assert.throws(() => registerChildAdmitted(t.rootDir, child), e => e instanceof TreeRefusal && re.test(e.reason), re.toString());
    assert.equal(events(t.rootDir).filter(e => e.event === 'node_registered').length, n, 'nothing was registered');
    assert.deepEqual([lastBlocked(t.rootDir).reason, lastBlocked(t.rootDir).check], ['continuation_refused', 'admission']);
  };
  refused(spec('R/M1', IDS[0], 25), /not admitted: budget \(a grant of 25 does not fit the 20\.0000/);
  refused(spec('R/M1', IDS[0], 5, { cheapestUsd: 6.1 }), /under the chain's cheapest end 6\.1/);
  refused(spec('R/A/B/C', IDS[0], 5), /depth limit/);
  // four children fit the split; the fifth is "not admitted: fan-out limit"; raising maxChildrenPerSplit admits it (tree.json untouched)
  for (let i = 0; i < 4; i++) {
    registerChildAdmitted(t.rootDir, spec(kids[i], IDS[i], 2));
    appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(kids[i], IDS[i], process.pid, 1, hostnameOf()) });
    syntheticRun(t, IDS[i], {}); closeNode(t, kids[i], IDS[i]);
  }
  refused(spec('R/M5', IDS[4], 2), /fan-out limit/);
  appendTreeEvent(t.rootDir, { event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 4, to: 5, actor: 'person', via: 'terminal' });
  assert.equal(registerChildAdmitted(t.rootDir, spec('R/M5', IDS[4], 2)).node, 'R/M5');
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M5', IDS[4], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[4], {}); closeNode(t, 'R/M5', IDS[4]);
  // the run limit: 6 runs so far (root + 5); lower tree limits are not editable, but a tree.json with a small maxRuns is a fresh tree
  const small = newTree({ cap: 20 });
  small.rootDir && registerRoot(small.rootDir);
  // the gate: damage a started child's evidence, then try to admit another
  const c = oneChild();
  appendTreeEvent(c.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
  const k2 = approveFrontier(c.t.rootDir, ['R/M2']);
  unlinkSync(join(c.dir, 'build.usage.json'));                                               // a settlement with no evidence
  assert.throws(() => registerChildAdmitted(c.t.rootDir, { frontierKey: k2, node: 'R/M2', generation: 1, runId: IDS[1], parentRunId: ROOT_ID, chain: { name: 'mock-budget', sha256: c.t.shaIn('mock-budget') }, grant: { amount: 2, unit: 'usd' }, bundleSha256: 'e'.repeat(64), bundleBytes: 1000 }), e => e instanceof TreeRefusal && e.code === 'accounting_blocked');
  assert.equal(lastBlocked(c.t.rootDir).reason, 'accounting_blocked');
  assert.equal(events(c.t.rootDir).some(e => e.event === 'node_registered' && e.node === 'R/M2'), false);
  // a child that fits registers, and spent + held never passes the cap
  const ok = closedRootTree({ cap: 20 });
  const k3 = approveFrontier(ok.rootDir, ['R/M1', 'R/M2']);
  registerChildAdmitted(ok.rootDir, { frontierKey: k3, node: 'R/M1', generation: 1, runId: IDS[0], parentRunId: ROOT_ID, chain: { name: 'mock-budget', sha256: ok.shaIn('mock-budget') }, grant: { amount: 9, unit: 'usd' }, bundleSha256: 'e'.repeat(64), bundleBytes: 1000, cheapestUsd: 6.1 });
  const b = budgetOf(ok.rootDir);
  assert.ok(b.treeSpentUsd + b.heldUsd <= b.rootCapUsd + MONEY_EPS);
  assert.equal(events(ok.rootDir).find(e => e.event === 'node_registered' && e.node === 'R/M1').cheapestUsd, undefined, 'the admission input is not written into the record');
});

test('production code registers children only through the gated path: nothing under src/ outside src/tree-register.js mentions registerChildUnchecked, and runFrontier registers through registerChildAdmitted by default', () => {
  const srcDir = join(new URL('..', import.meta.url).pathname, 'src');
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const offenders = walk(srcDir).filter(f => f.endsWith('.js') && !f.endsWith('tree-register.js') && readFileSync(f, 'utf8').includes('registerChildUnchecked'));
  assert.deepEqual(offenders, []);
  const own = readFileSync(join(srcDir, 'tree-register.js'), 'utf8');
  assert.match(own, /register = registerChildAdmitted/);
  assert.equal((own.match(/(?<!function )registerChildUnchecked\(/g) || []).length, 0, 'no call of the unchecked one inside the module either');
});

import { memberStart } from '../src/tree-member.js';
test('the whole of a member\'s start (gate, continuation checks including the ancestor contract check, lifetime cap, claim) on a depth-1 child stays well inside the 2 s a running member\'s mirror write waits for the lock', async () => {
  const t = await liveTree();
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 40);
  const lineage = { treeId: ROOT_ID, node: 'R/M1', generation: 1, attempt: 1 };
  const g0 = process.hrtime.bigint(); gateTree(t.rootDir); const gateMs = Number(process.hrtime.bigint() - g0) / 1e6;
  const m0 = process.hrtime.bigint();
  const start = memberStart({ runDir: join(t.runsDir, IDS[0]), runId: IDS[0], lineage, capAskedUsd: 30, chainPath: join(new URL('..', import.meta.url).pathname, 'chains', 'mock-budget.json'), inputs: {}, piiGate: null, piiAllow: [], allowSecretShaped: false, ceiling: null, work: t.work });
  const startMs = Number(process.hrtime.bigint() - m0) / 1e6;
  console.log(`# member start on a depth-1 child: gate alone ${gateMs.toFixed(1)} ms, the whole start (gate + ancestor contract check + cap + claim) ${startMs.toFixed(1)} ms`);
  assert.equal(start.claim.event, 'node_started');
  assert.ok(startMs < 1000, `the start held the tree lock for ${startMs.toFixed(0)} ms`);
});

// ---------------------------------------------------------------------------------------------------------------------------------- the post-run claim fails closed too
// The run path's version of this is test/tree-record.test.js (a member whose claim cannot take the tree lock): the post-run block in src/cli.js has its own catch, so it gets its own test.
test('a member\'s post-run `handoff --from-run` whose claim cannot take the tree lock fails closed: exit 19, "Nothing was run and nothing was spent", no node_resumed, no call, no new record', async () => {
  const t = newTree({ cap: 100, childChain: 'priced-debate', extraChains: chainSet(1) });
  registerRoot(t.rootDir);
  assert.equal((await api.run(rootOpts(t))).exitCode, 0);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 50);
  assert.equal((await api.run({ chain: 'priced-debate', task: 'tasks/x.md', cwd: t.work, runId: IDS[0], treeNode: lineageFile(t.work, 'R/M1'), maxUsd: 50 })).exitCode, 0);
  const marker = join(t.work, 'lock-held'); const go = join(t.work, 'go');
  // another process takes the tree lock and holds it until THIS test says go (no clock: the claim's own bounded retry, about 2 s, runs out while the lock is held, however slow the machine is). The 60 s cap only
  // keeps a test that died early from leaving a process behind.
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `import { withTreeLock } from ${JSON.stringify(join(repoRoot, 'src', 'tree-record.js'))};
    import { existsSync, writeFileSync } from 'node:fs';
    const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    withTreeLock(${JSON.stringify(t.rootDir)}, () => { writeFileSync(${JSON.stringify(marker)}, 'x'); for (let i = 0; i < 2400 && !existsSync(${JSON.stringify(go)}); i++) nap(25); });`], { stdio: 'ignore' });
  let h; const n = events(t.rootDir).length; const usageBefore = usageFiles(join(t.runsDir, IDS[0])).length;
  try {
    await waitFor(() => existsSync(marker), 'the holder to take the tree lock');
    h = spawnSync(process.execPath, [cli, 'handoff', '--from-run', join(t.runsDir, IDS[0]), '--max-usd', '30'], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } });   // retries for its full bounded wait, then gives up
  } finally { writeFileSync(go, 'x'); await new Promise(r => holder.once('close', r)); }
  assert.equal(h.status, 19, h.stdout + h.stderr);
  assert.match(h.stderr, /locked by another process/);
  assert.match(h.stderr, /Nothing was run and nothing was spent/);
  assert.equal(events(t.rootDir).length, n, 'nothing could be written, and nothing was');
  assert.equal(nodeEvents(t.rootDir).some(e => e.event === 'node_resumed' && e.node === 'R/M1'), false, 'no claim');
  assert.equal(usageFiles(join(t.runsDir, IDS[0])).length, usageBefore); assert.equal(readdirSync(join(t.runsDir, IDS[0])).some(f => /^HANDOFF-from-run/.test(f)), false, 'no call was made');
  assert.equal(stateOf(readTreeRecord(t.rootDir)).active, null, 'no phantom active node');
});

test('C&C Q1 (half 1): registerChildAdmitted, the only production writer of a child registration, REQUIRES bundleSha256 (64 hex) and bundleBytes (a whole number of 1 or more) and throws without them, registering nothing', () => {
  const t = closedRootTree({ cap: 20 });
  const key = approveFrontier(t.rootDir, ['R/M1']);
  const base = { frontierKey: key, node: 'R/M1', generation: 1, runId: IDS[0], parentRunId: ROOT_ID, chain: { name: 'mock-budget', sha256: t.shaIn('mock-budget') }, grant: { amount: 2, unit: 'usd' } };
  const n = () => events(t.rootDir).filter(e => e.event === 'node_registered').length;
  const before = n();
  for (const bad of [{}, { bundleSha256: 'e'.repeat(64) }, { bundleBytes: 10 }, { bundleSha256: 'short', bundleBytes: 10 }, { bundleSha256: 'E'.repeat(64), bundleBytes: 10 }, { bundleSha256: 'e'.repeat(64), bundleBytes: 0 }, { bundleSha256: 'e'.repeat(64), bundleBytes: 1.5 }, { bundleSha256: 'e'.repeat(64), bundleBytes: '10' }]) {
    assert.throws(() => registerChildAdmitted(t.rootDir, { ...base, ...bad }), TypeError, JSON.stringify(bad));
  }
  assert.equal(n(), before, 'nothing was registered, and no blocked record either: it is a caller error, not a refusal of the tree');
  const ok = registerChildAdmitted(t.rootDir, { ...base, bundleSha256: 'e'.repeat(64), bundleBytes: 1000 });
  assert.deepEqual([ok.bundleSha256, ok.bundleBytes], ['e'.repeat(64), 1000], 'and the record carries both');
});
