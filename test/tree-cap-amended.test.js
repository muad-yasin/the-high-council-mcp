// 0.8.3 M6 atomic tree budget, COMMIT 1 (records; gate page Review/Build_0.8.3/m6-closing/Atomic_Tree_Budget_Gate_Page.md sections 5, 6, 8, 12.7): the cap in force (`effectiveCapUsd`, ONE reader), the `cap_amended` event
// (a person's NEW TOTAL: fold, table row, the library `amendCap` under the tree lock), and the LOUD INVARIANT in the accounting gate (`over_committed`: spent + in flight + unknown holds + unspent grants may not exceed the
// cap in force). Offline, $0: synthetic run folders written by hand (test/helpers/tree-fixture.js, tree-money.js), hand-appended raw lines for the hand-edited records, two real Node processes for the race.
// The amendment FORM (`council tree decide --amend-cap`), its gate text and the `awaiting_cap` screen are the next commit; no verb writes `cap_amended` yet, so no person-facing text changes here.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { amendCap, budgetOf, effectiveCapUsd, gateTree, lifetimeCapOf, topUp } from '../src/tree-budget.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, closedRootTree, registerKid } from './helpers/tree-fixture.js';
import { assertInvariant, stoppedKid } from './helpers/tree-money.js';
import { runWorkers } from './helpers/race-workers.js';
import { PRESENCE, presenceProblems } from './helpers/event-presence.js';

const cents = n => Math.round(n * 1e6) / 1e6;
const codes = g => g.problems.map(p => p.code);
const events = rootDir => readTreeRecord(rootDir).events;
const made = new Set();
const track = t => { made.add(t.work); return t; };
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const AMEND = { gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: GATE_FIELDS.actor, via: GATE_FIELDS.via };       // K10 (EDITED; OLD: gateId + shownSha256 only; NEW: and who answered; WHY: the table requires actor/via on a new cap_amended and abandon
const amend = (t, toCapUsd, expectedRevision) => amendCap(t.rootDir, { toCapUsd, expectedRevision, ...AMEND });
const treeJson = t => readFileSync(join(treeDirOf(t.rootDir), 'tree.json'), 'utf8');
/** A raw line appended straight to events.jsonl (the table never sees it): the hand-edited record. */
function appendRaw(t, event) {
  const next = Math.max(...events(t.rootDir).map(e => Number(e.id.slice(1)))) + 1;
  appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', id: `e${next}`, ...event, at: new Date().toISOString() })}\n`);
}
/** cap 10: R/M1 grant 4, 3 spent (stopped, holds 1); R/M2 grant 2 (registered, holds 2) -> committed 3 + 1 + 2 = 6, available 4. */
function sixCommitted(cap = 10) {
  const t = track(closedRootTree({ cap }));
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2', 'R/M3']);
  stoppedKid(t, key, 'R/M1', IDS[0], 4, [{ id: 'r1', reservedUsd: 3, settledUsd: 3 }]);
  registerKid(t, key, 'R/M2', IDS[1], 2);
  return { t, key };
}

// ------------------------------------------------------------------------------------------------------------------------------- the cap in force
test('effectiveCapUsd: the cap the tree started with until an amendment, then the latest total; tree.json is never edited; every number follows (budgetOf, available)', () => {
  const t = track(closedRootTree({ cap: 10 }));
  const before = treeJson(t);
  assert.equal(effectiveCapUsd(readTreeRecord(t.rootDir)), 10);
  assert.deepEqual([budgetOf(t.rootDir).rootCapUsd, budgetOf(t.rootDir).availableUsd], [10, 10]);
  const first = amend(t, 14, 1);
  assert.deepEqual([first.event, first.fromCapUsd, first.toCapUsd, first.expectedRevision, first.gateId, first.shownSha256], ['cap_amended', 10, 14, 1, AMEND.gateId, AMEND.shownSha256]);
  assert.equal(effectiveCapUsd(readTreeRecord(t.rootDir)), 14);
  assert.deepEqual([budgetOf(t.rootDir).rootCapUsd, budgetOf(t.rootDir).availableUsd], [14, 14], 'a raise of 4 is 4 more available');
  const second = amend(t, 12, 2);                                                           // a NEW TOTAL, lower than the last one but above what is committed (0): allowed (gate page Q5)
  assert.deepEqual([second.fromCapUsd, second.toCapUsd], [14, 12]);
  assert.equal(effectiveCapUsd(readTreeRecord(t.rootDir)), 12);
  assert.deepEqual(stateOf(readTreeRecord(t.rootDir)).capAmendments.map(a => [a.fromCapUsd, a.toCapUsd]), [[10, 14], [14, 12]]);
  assert.equal(treeJson(t), before, 'tree.json is byte-identical: the amendment is a record, not an edit');
  assertInvariant(t.rootDir, 'after two amendments');
});

// ------------------------------------------------------------------------------------------------------------------------------- amendCap's refusals
test('amendCap refuses, with a recorded reason and no cap_amended: a stale revision, the same total, a total below what is committed (the lowest accepted is named), a failing gate; and the boundary is inclusive', () => {
  const { t } = sixCommitted();
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 4);
  const refused = (to, rev, re, label) => {
    const n = events(t.rootDir).length;
    assert.throws(() => amend(t, to, rev), e => e instanceof TreeRefusal && e.code === 'continuation_refused' && e.transition === 'cap_amended' && re.test(e.message), label);
    const ev = events(t.rootDir);
    assert.equal(ev.length, n + 1, `${label}: one blocked line is written`);
    assert.deepEqual([ev.at(-1).event, ev.at(-1).reason, ev.at(-1).check, ev.at(-1).scope], ['blocked', 'continuation_refused', 'amend_cap', 'tree'], label);
    assert.ok(!ev.some(e => e.event === 'cap_amended'), `${label}: nothing amended`);
    assert.equal(effectiveCapUsd(readTreeRecord(t.rootDir)), 10, `${label}: the cap in force is unchanged`);
  };
  refused(12, 2, /amended since you read it \(this would be amendment 1, not 2\)/, 'a revision from the future / a stale reading');
  refused(10, 1, /the cap already in force: nothing to amend/, 'the same total');
  refused(5.99, 1, /below the 6\.00 already committed.*the lowest total accepted now is 6\.00/, 'one cent below what is committed');
  // the boundary: exactly what is committed is accepted (available 0 afterwards)
  const ok = amend(t, 6, 1);
  assert.equal(ok.toCapUsd, 6);
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 0);
  assertInvariant(t.rootDir, 'at the boundary');
  // a failing gate refuses (the committed exposure cannot be shown): a started member whose run folder is gone
  const g = sixCommitted();
  rmSync(join(g.t.runsDir, IDS[0]), { recursive: true });
  assert.ok(codes(gateTree(g.t.rootDir)).includes('member_folder_missing'));
  assert.throws(() => amend(g.t, 12, 1), e => e instanceof TreeRefusal && /the accounting gate fails \(member_folder_missing/.test(e.message));
});

test('amendCap\'s arguments: a total that is not a finite number above 0, a revision that is not a whole number from 1, and a missing gate each throw before anything is read or written', () => {
  const t = track(closedRootTree({ cap: 10 }));
  const n = events(t.rootDir).length;
  for (const bad of [NaN, 0, -1, Infinity, '12', null, undefined]) assert.throws(() => amend(t, bad, 1), RangeError, String(bad));
  for (const bad of [0, 1.5, '1', undefined]) assert.throws(() => amend(t, 12, bad), TypeError, String(bad));
  assert.throws(() => amendCap(t.rootDir, { toCapUsd: 12, expectedRevision: 1 }), TypeError, 'no gate');
  assert.throws(() => amendCap(t.rootDir, { toCapUsd: 12, expectedRevision: 1, gateId: 'g', shownSha256: 'short' }), TypeError, 'a hash that is not 64 hex');
  assert.equal(events(t.rootDir).length, n, 'nothing was written');
});

test('an abandoned tree refuses an amendment with the one sentence every refusal of it says', () => {
  const t = track(closedRootTree({ cap: 10 }));
  appendTreeEvent(t.rootDir, { event: 'tree_abandoned', ...AMEND });
  assert.throws(() => amend(t, 12, 1), e => e instanceof TreeRefusal && /abandoned by a person/.test(e.message));
  assert.ok(!events(t.rootDir).some(e => e.event === 'cap_amended'));
});

// ------------------------------------------------------------------------------------------------------------------------------- the table row
test('the table: a hand-called cap_amended with a stale revision, a wrong starting total or the same total is refused (transition_refused, recorded), and one without its gate fields is malformed', () => {
  const t = track(closedRootTree({ cap: 10 }));
  const line = { event: 'cap_amended', fromCapUsd: 10, toCapUsd: 12, expectedRevision: 1, ...AMEND };
  assert.throws(() => appendTreeEvent(t.rootDir, { ...line, expectedRevision: 2 }), e => e instanceof TreeRefusal && e.code === 'transition_refused' && /amendment 1, not 2/.test(e.message));
  assert.throws(() => appendTreeEvent(t.rootDir, { ...line, toCapUsd: 10 }), e => e instanceof TreeRefusal && /nothing to amend/.test(e.message));
  for (const field of ['gateId', 'shownSha256', 'expectedRevision', 'fromCapUsd', 'toCapUsd']) assert.throws(() => appendTreeEvent(t.rootDir, { ...line, [field]: undefined }), e => e instanceof TypeError && new RegExp(`field "${field}" is missing or malformed`).test(e.message), field);
  assert.throws(() => appendTreeEvent(t.rootDir, { ...line, toCapUsd: -3 }), TypeError);
  appendTreeEvent(t.rootDir, line);
  assert.throws(() => appendTreeEvent(t.rootDir, { ...line, expectedRevision: 2, fromCapUsd: 10, toCapUsd: 13 }), e => e instanceof TreeRefusal && /starts from the cap in force \(12\), not from 10/.test(e.message));
  assert.equal(events(t.rootDir).filter(e => e.event === 'cap_amended').length, 1);
});

// ------------------------------------------------------------------------------------------------------------------------------- what a raise does and does not do
test('a raise ADDS authorization and nothing else: an open stop stays open, the sticky blocks stand, no node is touched and no run starts; the earlier lines of the record are byte-identical', () => {
  const t = track(closedRootTree({ cap: 10 }));
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] });
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', stopId: stop.id });
  const snap = () => { const s = stateOf(readTreeRecord(t.rootDir)); return JSON.stringify({ open: s.openStops, sticky: [...s.sticky.keys()], rootBlocks: [...s.sticky.keys()], nodes: [...s.nodes.entries()], decisions: [...s.decisions.keys()], active: s.active, abandoned: s.abandoned }); };
  const before = snap(); const prefix = readFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), 'utf8');
  amend(t, 25, 1);
  assert.equal(snap(), before, 'the folded state (stops, blocks, nodes, decisions, active) is exactly what it was');
  assert.ok(readFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), 'utf8').startsWith(prefix), 'the earlier lines are untouched; the amendment is appended');
  assert.deepEqual(events(t.rootDir).slice(-1).map(e => e.event), ['cap_amended']);
});

test('a raise reaches the next ADMISSION and the next CLAIM: with 0 available a top-up is refused; after a raise it is granted and the node\'s lifetime cap grows; the claim it already wrote is not touched', () => {
  const t = track(closedRootTree({ cap: 10 }));
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  stoppedKid(t, key, 'R/M1', IDS[0], 6, [{ id: 'r1', reservedUsd: 5, settledUsd: 5 }]);
  registerKid(t, key, 'R/M2', IDS[1], 4);
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 0);
  assert.throws(() => topUp(t.rootDir, { node: 'R/M1', amountUsd: 2, ...GATE_FIELDS }), e => e instanceof TreeRefusal);
  assert.equal(cents(lifetimeCapOf(budgetOf(t.rootDir), 'R/M1@g1').lifetimeCapUsd), 6);
  const claimLine = events(t.rootDir).find(e => e.event === 'node_started' && e.node === 'R/M1');
  amend(t, 13, 1);
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 3);
  topUp(t.rootDir, { node: 'R/M1', amountUsd: 2, ...GATE_FIELDS });
  assert.equal(cents(lifetimeCapOf(budgetOf(t.rootDir), 'R/M1@g1').lifetimeCapUsd), 8, 'spent 5 + the 3 left of its grant after the top-up');
  assert.deepEqual(events(t.rootDir).find(e => e.event === 'node_started' && e.node === 'R/M1'), claimLine, 'the claim line a running member holds is not rewritten: a raise reaches it at its NEXT claim');
  assertInvariant(t.rootDir, 'after the raise and the top-up');
});

test('a LOWER total above what is committed is accepted and shrinks what is available; an admission that would not fit it is then refused, one that fits is granted', () => {
  const { t } = sixCommitted();
  amend(t, 8, 1);
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 2);
  assert.throws(() => topUp(t.rootDir, { node: 'R/M1', amountUsd: 3, ...GATE_FIELDS }), e => e instanceof TreeRefusal && /only 2\.0000 of the root cap is free/.test(e.message));
  topUp(t.rootDir, { node: 'R/M1', amountUsd: 2, ...GATE_FIELDS });
  assert.equal(cents(budgetOf(t.rootDir).availableUsd), 0);
  assertInvariant(t.rootDir, 'full to the lowered cap');
});

// ------------------------------------------------------------------------------------------------------------------------------- the loud invariant
test('over_committed: a registration written by hand above the cap, a cap lowered by hand below what is committed, fail the gate (not coverable by a person\'s acceptance); exactly at the cap passes; a raise is the cure', () => {
  // exactly at the cap: spent 3 + R/M1 holds 1 + 4 (a top-up) + R/M2 holds 2 = 10
  const exact = sixCommitted();
  topUp(exact.t.rootDir, { node: 'R/M1', amountUsd: 4, ...GATE_FIELDS });
  assert.equal(gateTree(exact.t.rootDir).ok, true, 'committed == cap passes');
  assert.equal(cents(budgetOf(exact.t.rootDir).availableUsd), 0);
  // a hand-lowered cap: the amendment line is well formed but the table never saw it
  appendRaw(exact.t, { event: 'cap_amended', fromCapUsd: 10, toCapUsd: 9, expectedRevision: 1, ...AMEND });
  const g = gateTree(exact.t.rootDir);
  assert.equal(g.ok, false);
  assert.deepEqual(codes(g), ['over_committed']);
  const p = g.problems[0];
  assert.deepEqual([p.keys, p.node, p.runId], [[], null, null], 'no key: nothing a person\'s acceptance of an unreadable charge can cover');
  assert.match(p.detail, /more than the cap in force \(9\.0000\)/);
  assert.equal(cents(budgetOf(exact.t.rootDir).availableUsd), -1, 'the views still compute: available is negative');
  assert.throws(() => topUp(exact.t.rootDir, { node: 'R/M1', amountUsd: 1, ...GATE_FIELDS }), e => e instanceof TreeRefusal && /accounting gate fails \(over_committed\)/.test(e.message));
  // the cure is a raise; amendCap ignores this one problem and only this one
  amend(exact.t, 10, 2);
  assert.equal(gateTree(exact.t.rootDir).ok, true);
  // a raise does not cure another problem: with a run folder gone the gate still refuses it
  appendRaw(exact.t, { event: 'cap_amended', fromCapUsd: 10, toCapUsd: 5, expectedRevision: 3, ...AMEND });
  rmSync(join(exact.t.runsDir, IDS[0]), { recursive: true });
  const both = codes(gateTree(exact.t.rootDir));
  assert.ok(both.includes('member_folder_missing') && both.includes('over_committed'), both.join(', '));
  assert.throws(() => amend(exact.t, 20, 4), e => e instanceof TreeRefusal && /the accounting gate fails \(.*member_folder_missing/.test(e.message) && !/over_committed/.test(e.message), 'the refusal names the other problems, not the one a raise cures');
});

// ------------------------------------------------------------------------------------------------------------------------------- crashes, retries, races
test('crash and retry: the same amendment applied twice (a retry after a crash) writes one line and refuses the second; a torn tail loses the unfinished amendment and the cap in force is the last complete one', () => {
  const t = track(closedRootTree({ cap: 10 }));
  amend(t, 12, 1);
  assert.throws(() => amend(t, 12, 1), e => e instanceof TreeRefusal && /amended since you read it/.test(e.message));
  assert.equal(events(t.rootDir).filter(e => e.event === 'cap_amended').length, 1, 'one line, however many tries');
  // a crash in the middle of the next amendment's line: no newline, half a JSON object
  appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), '{"schema":"tree-events/1","id":"e99","event":"cap_amended","fromCapUsd":12,"toCapUsd":20,"expectedRev');
  const rec = readTreeRecord(t.rootDir);
  assert.ok(rec.fragment, 'the reader sees the torn tail');
  assert.equal(effectiveCapUsd(rec), 12, 'an unfinished amendment is not in force');
  amend(t, 20, 2);                                                                          // the person redoes it: the next write cuts the tail first
  assert.ok(readdirSync(treeDirOf(t.rootDir)).some(f => /^events\.torn-\d+\.txt$/.test(f)), 'the torn fragment is kept, not lost');
  assert.equal(effectiveCapUsd(readTreeRecord(t.rootDir)), 20);
  assertInvariant(t.rootDir, 'after the torn tail');
});

test('two PROCESSES amend with the same revision at the same moment: exactly one total is recorded, the other is refused as stale (four rounds, both orders)', async () => {
  for (let round = 0; round < 4; round += 1) {
    const t = track(closedRootTree({ cap: 10 }));
    const goFile = join(t.work, 'go');
    const jobs = [{ kind: 'amend', rootDir: t.rootDir, amend: { toCapUsd: 20, expectedRevision: 1, ...AMEND } }, { kind: 'amend', rootDir: t.rootDir, amend: { toCapUsd: 30, expectedRevision: 1, ...AMEND } }];
    if (round % 2) jobs.reverse();
    const pending = runWorkers(jobs, goFile);
    await Promise.all(pending.ready);
    writeFileSync(goFile, 'go');
    const results = await Promise.all(pending.results);
    assert.equal(results.filter(r => r.ok).length, 1, `round ${round}: ${JSON.stringify(results)}`);
    assert.equal(results.find(r => !r.ok).code, 'continuation_refused');
    const amended = events(t.rootDir).filter(e => e.event === 'cap_amended');
    assert.equal(amended.length, 1, `round ${round}: one amendment on the record`);
    assert.equal(effectiveCapUsd(readTreeRecord(t.rootDir)), amended[0].toCapUsd);
    assertInvariant(t.rootDir, `round ${round}`);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------- one reader, one place
test('ONE reader of the cap: nothing in src/ reads tree.json\'s rootCapUsd except startingCapUsd (behind effectiveCapUsd); amendCap and cap_amended are internal', () => {
  // CHANGED ACCEPTED TEST (M7 apply E54, C&C ruling 18 Okt 2026; disclosed). OLD: the readers were ['tree-budget.js', 'tree-register.js', 'tree-start.js'] and the title called the root\'s first grant and the tree start places that
  // "use the STARTING cap by definition". NEW: only tree-budget.js. WHY: that reasoning missed the interrupted-start window - `--amend-cap` is accepted once tree_started is written, before the root is registered or run, so a
  // total withdrawn to $2 still granted and ran the root at the starting $5. The grant and the root\'s maxUsd now come from effectiveCapUsd / the root\'s own bound. The pattern also catches a destructured read.
  const src = join(import.meta.dirname, '..', 'src');
  const files = readdirSync(src, { recursive: true }).filter(f => f.endsWith('.js'));
  const readers = files.filter(f => /\btree\??\.rootCapUsd\b|\{[^}]*\brootCapUsd\b[^}]*\}\s*=\s*(?:record\.)?tree\b/.test(readFileSync(join(src, f), 'utf8'))).sort();
  assert.deepEqual(readers, ['tree-budget.js'], 'a new reader of the starting cap must go through effectiveCapUsd (or be added here with its reason)');
  const budget = readFileSync(join(src, 'tree-budget.js'), 'utf8');
  assert.equal((budget.match(/\btree\??\.rootCapUsd\b/g) ?? []).length, 1, 'inside tree-budget.js only effectiveCapUsd reads it');
  assert.match(budget, /export function effectiveCapUsd[\s\S]{0,400}startingCapUsd\(record\)/);      // EDITED, budget commit 2 (disclosed; old: effectiveCapUsd read the field itself): the starting cap has ONE reader, startingCapUsd, which the amendment screen also uses
  const root = join(import.meta.dirname, '..');
  const surfaces = [readFileSync(join(src, 'api.js'), 'utf8'), readFileSync(join(root, 'types', 'index.d.ts'), 'utf8'), ...readdirSync(join(src, 'mcp')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(src, 'mcp', f), 'utf8'))];
  for (const text of surfaces) for (const needle of ['amendCap', 'cap_amended', 'effectiveCapUsd']) assert.ok(!text.includes(needle), `${needle} is not part of the public library or any MCP tool`);
});

test('the presence audit knows cap_amended: the lines amendCap writes carry their gate and revision, and a line without them is reported (the audit can fail)', () => {
  const t = track(closedRootTree({ cap: 10 }));
  amend(t, 12, 1);
  assert.deepEqual(presenceProblems(events(t.rootDir).filter(e => e.event === 'cap_amended')), []);      // only the amendment: the fixture's synthetic root close is not a production writer
  assert.ok('cap_amended' in PRESENCE);
  assert.match(presenceProblems([{ event: 'cap_amended', id: 'e1', expectedRevision: 1 }])[0], /gateId, shownSha256/);
});
