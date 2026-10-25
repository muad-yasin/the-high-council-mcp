// `council tree decide --accounting <node>` (0.8.3 M5d, sub-commit 3; PLAN 7.2; M5-DEFAULTS 7) and the gate fields topUp and acceptAccounting now REQUIRE. Synthetic run folders (the fixture of test/tree-budget.test.js): one started child with a
// paid, settled call whose evidence file is removed, so the accounting gate cannot prove the charge. All-mock, $0. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { sha256Of } from '../src/thin-contract.js';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, TREE_DIR, TREE_FILE } from '../src/tree-record.js';
import { acceptAccounting, gateTree, problemCover, topUp } from '../src/tree-budget.js';
import { foldRecord } from '../src/tree-transitions.js';
import { decideHandler } from '../src/tree-decide.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';
import { assertBoundTextClean, dirty } from './helpers/bound-text.js';
import { GATE_FIELDS, IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, reservedLine, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';

/** One started child with one paid, settled stage (reserved 1.00, recorded 0.60, a usage file) whose usage file is then removed: the settlement has no evidence (a problem a person may accept). */
function unprovenChild() {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const dir = syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd: 0.6, reservationId: 'r1' }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]);
  unlinkSync(join(dir, 'build.usage.json'));
  return { t, dir, key: `${IDS[0]}:r1` };
}
const decide = (c, flags, answers, extra = {}) => {
  const io = terminal(answers, extra.tty === false ? { tty: false } : {});
  if (answers.length === 0) io.stdin.end();     // a run that has nobody to answer and wrongly ASKS ends (and fails its assertions) instead of waiting for ever: a removed guard must not look like a hang
  if (extra.onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) extra.onPrompt(); });
  return { io, run: () => decideHandler({ rootDir: c.t.rootDir, rootId: ROOT_ID, flags, work: c.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }) };
};
const events = c => readTreeRecord(c.t.rootDir).events;
const codes = g => g.problems.map(p => p.code);

test('--accounting: the text gives every problem about that node word for word with its PLAN 7.1 row and the figures as the gate sees them; typing the node path accepts exactly those problems; no number changes (the reservation file, tree.json and the tree\'s spend are identical before and after)', () => {
  const c = unprovenChild();
  const g0 = gateTree(c.t.rootDir); assert.equal(g0.ok, false); assert.deepEqual(codes(g0), ['settlement_without_evidence']);
  const reservations = readFileSync(join(c.dir, 'spend-reservations.jsonl')); const treeBefore = readFileSync(join(c.t.rootDir, TREE_DIR, TREE_FILE)); const spent = g0.treeSpentUsd;
  const d = decide(c, { accounting: 'R/M1' }, ['R/M1', 'y']);
  return d.run().then(code => {
    assert.equal(code, 0, d.io.shown() + d.io.errors());
    const shown = d.io.shown();
    assert.match(shown, /Accept the charges the accounting gate cannot prove for R\/M1\?/); assert.ok(shown.includes(`1. settlement_without_evidence: ${g0.problems[0].detail}`), 'the detail, verbatim');
    assert.match(shown, /PLAN 7\.1 row 5 \(settled but not proven: the tree adds the worst case less any evidence\); worst case \$1\.00, evidence \$0\.00 \(0 records\), the tree adds \$1\.00 to its spend\./);
    assert.match(shown, /Accepting changes no number: no cap, grant or reservation line is touched/); assert.match(shown, /A different problem later, or the same one with other figures, is a new stop/);
    assert.match(shown, /To approve, type the node path: R\/M1\n/); assert.match(shown, /Type the node path shown in the last line above: /);
    const acc = events(c).filter(e => e.event === 'accounting_accepted');
    assert.equal(acc.length, 1); assert.deepEqual(acc[0].reservationIds, [c.key]); assert.ok(acc[0].gateId); assert.match(acc[0].shownSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(acc[0].covers, [{ code: 'settlement_without_evidence', keys: [c.key], detailSha256: sha256Of(g0.problems[0].detail) }]);
    const g1 = gateTree(c.t.rootDir);
    assert.equal(g1.ok, true, JSON.stringify(g1.problems)); assert.equal(g1.treeSpentUsd, spent, 'the charge stays counted at its figure');
    assert.deepEqual(readFileSync(join(c.dir, 'spend-reservations.jsonl')), reservations); assert.deepEqual(readFileSync(join(c.t.rootDir, TREE_DIR, TREE_FILE)), treeBefore);
  });
});

test('an acceptance covers EXACTLY the problems it named, as they read then: the same problem with other figures, or another code about the same reservation, blocks again; a record without the gate that authorized it lifts nothing', async () => {
  const c = unprovenChild();
  const d = decide(c, { accounting: 'R/M1' }, ['R/M1', 'y']); assert.equal(await d.run(), 0);
  assert.equal(gateTree(c.t.rootDir).ok, true);
  // the same problem with different figures: a usage file of another amount appears (1 record carries the id, not matching)
  writeFileSync(join(c.dir, 'build.usage.json'), JSON.stringify({ provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 0.3, reservationId: 'r1' }));
  const g = gateTree(c.t.rootDir);
  assert.equal(g.ok, false, 'other figures: a new stop'); assert.deepEqual(codes(g), ['settlement_without_evidence']); assert.match(g.problems[0].detail, /\(1 carry the id\)/, 'the same code with different figures (one record now carries the id)');
  unlinkSync(join(c.dir, 'build.usage.json'));
  assert.equal(gateTree(c.t.rootDir).ok, true, 'back to the figures that were accepted: covered again');
  // another code about the same reservation: the mirror disagrees with the run file
  appendTreeEvent(c.t.rootDir, { event: 'reservation_mirrored', runId: IDS[0], node: 'R/M1', generation: 1, line: reservedLine('r1', 1.0, 'build') });
  const g2 = gateTree(c.t.rootDir);
  assert.equal(g2.ok, false); assert.ok(codes(g2).some(x => x !== 'settlement_without_evidence'), `a new code blocks: ${codes(g2)}`);
  // an accounting_accepted written without the gate fields, or without covers (the shape before M5d), lifts nothing
  const u = unprovenChild();
  appendTreeEvent(u.t.rootDir, { event: 'accounting_accepted', reservationIds: [u.key] });
  assert.equal(gateTree(u.t.rootDir).ok, false, 'a bare record is not an acceptance');
  appendTreeEvent(u.t.rootDir, { event: 'accounting_accepted', reservationIds: [u.key], ...GATE_FIELDS });
  assert.equal(gateTree(u.t.rootDir).ok, false, 'gate fields without the covered problems are not an acceptance either');
  const covers = gateTree(u.t.rootDir).problems.map(problemCover);
  appendTreeEvent(u.t.rootDir, { event: 'accounting_accepted', reservationIds: [u.key], covers });
  assert.equal(gateTree(u.t.rootDir).ok, false, 'the covered problems without the gate that authorized them are not an acceptance either');
  appendTreeEvent(u.t.rootDir, { event: 'accounting_accepted', reservationIds: [u.key], covers, ...GATE_FIELDS });
  assert.equal(gateTree(u.t.rootDir).ok, true, 'both together are');
});

test('refusals ask nobody and write nothing: a node whose gate passes ("nothing to accept"), a node whose only problem needs its record restored, an unknown node', async () => {
  const c = unprovenChild();
  const before = events(c).length;
  const other = decide(c, { accounting: 'R' }, []); assert.equal(await other.run(), 1); assert.match(other.io.errors(), /nothing to accept: the accounting gate has no problem about R@g1 \(its problems are about other nodes\)/);
  const unknown = decide(c, { accounting: 'R/M9' }, []); assert.equal(await unknown.run(), 1); assert.match(unknown.io.errors(), /no such node in this tree/);
  // a missing run.json names no reservation: it cannot be accepted, and is listed as NOT covered next to a problem that can
  const clean = unprovenChild(); unlinkSync(join(clean.dir, 'run.json'));
  const gc = gateTree(clean.t.rootDir); assert.ok(codes(gc).includes('member_run_json'));
  const onlyRestore = decide(clean, { accounting: 'R/M1' }, ['R/M1', 'y']);
  const code = await onlyRestore.run();
  assert.equal(code, 0, 'the unproven settlement IS acceptable; the missing run.json is listed as NOT covered');
  assert.match(onlyRestore.io.shown(), /These need their record restored and are NOT covered by this decision:\n  1\. member_run_json/);
  assert.equal(onlyRestore.io.shown().split('member_run_json').length - 1, 1, 'the restore-only problem appears ONLY under "NOT covered", never among the problems this decision accepts');
  assert.equal(gateTree(clean.t.rootDir).ok, false, 'still blocked: the restore-only problem stands'); assert.deepEqual(codes(gateTree(clean.t.rootDir)), ['member_run_json']);
  assert.equal(events(c).length, before, 'nothing was written by the refusals');
});

test('the typed step is the node path; a wrong one, a decline and no terminal write nothing; a figure that moved while the person read (new evidence) means the approval is NOT used', async () => {
  const c = unprovenChild();
  const before = events(c).filter(e => e.event === 'accounting_accepted').length;
  const wrong = decide(c, { accounting: 'R/M1' }, ['R/M2', 'y']); assert.equal(await wrong.run(), 1); assert.match(wrong.io.shown(), /That is not what the text asks you to type/);
  const declined = decide(c, { accounting: 'R/M1' }, ['R/M1', 'n']); assert.equal(await declined.run(), 1);
  const notty = decide(c, { accounting: 'R/M1' }, [], { tty: false }); assert.equal(await notty.run(), 2);
  const moved = decide(c, { accounting: 'R/M1' }, ['R/M1', 'y'], { onPrompt: () => writeFileSync(join(c.dir, 'build.usage.json'), JSON.stringify({ provider: 'openrouter', model: 'm', usage: { input: 1, output: 1 }, usd: 0.3, reservationId: 'r1' })) });
  assert.equal(await moved.run(), 1); assert.match(moved.io.errors(), /what you were shown has changed while you were reading it/);
  assert.equal(events(c).filter(e => e.event === 'accounting_accepted').length, before, 'nothing was accepted by any of them');
});

test('R4 (M5 API reviews, Opus 3-3 and Astra F6): the acceptance is bound to the problems the person was SHOWN: acceptAccounting called with the covers that were shown refuses (\"changed while you read\") when the gate under the lock reads otherwise, and records exactly the shown ones when it does not', () => {
  const c = unprovenChild();
  const shown = gateTree(c.t.rootDir).problems.map(problemCover);
  assert.equal(shown.length, 1);
  const before = events(c).length;
  for (const [label, expectCovers] of [['figures that read differently', shown.map(s => ({ ...s, detailSha256: 'e'.repeat(64) }))], ['a problem the person was not shown', []], ['another code', shown.map(s => ({ ...s, code: 'reservation_without_record' }))]]) {
    assert.throws(() => acceptAccounting(c.t.rootDir, { keys: [c.key], ...GATE_FIELDS, expectCovers }), e => e instanceof TreeRefusal && /changed while you read/.test(e.reason), label);
  }
  assert.equal(events(c).filter(e => e.event === 'accounting_accepted').length, 0, 'nothing was accepted');
  const ev = acceptAccounting(c.t.rootDir, { keys: [c.key], ...GATE_FIELDS, expectCovers: shown });
  assert.deepEqual(ev.covers, shown, 'exactly the shown problems are recorded');
  assert.equal(events(c).length, before + 1, 'exactly one event was added by all four calls: the acceptance (the three refusals wrote nothing, not even a blocked record)');
});

test('topUp and acceptAccounting REQUIRE the gate fields (a TypeError without them), the table refuses a grant_issued without them, the fold does not count one that got into a record, and accounting_accepted validates its covers', () => {
  const c = unprovenChild();
  assert.throws(() => acceptAccounting(c.t.rootDir, { keys: [c.key] }), TypeError); assert.throws(() => acceptAccounting(c.t.rootDir, { keys: [c.key], gateId: 'g1' }), TypeError);
  assert.throws(() => acceptAccounting(c.t.rootDir, { keys: [c.key], gateId: 'g1', shownSha256: 'abc' }), TypeError);
  assert.throws(() => topUp(c.t.rootDir, { node: 'R/M1', amountUsd: 1 }), TypeError); assert.throws(() => topUp(c.t.rootDir, { node: 'R/M1', amountUsd: 1, gateId: 'g1' }), /gateId and shownSha256/);
  assert.throws(() => acceptAccounting(c.t.rootDir, { keys: ['r9:nothing'], ...GATE_FIELDS }), e => e instanceof TreeRefusal && /nothing to accept/.test(e.reason), 'keys that name no standing problem');
  // the table: a stopped node and a grant_issued without gate fields
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: IDS[0], reason: 'budget' });
  assert.throws(() => appendTreeEvent(t.rootDir, { event: 'grant_issued', node: 'R/M1', generation: 1, amount: 2, unit: 'usd' }), e => e instanceof TreeRefusal && /without them it is not a grant/.test(e.reason));
  // the fold, on a record that has such an event anyway
  const evs = [...readTreeRecord(t.rootDir).events, { id: 'e9990', event: 'grant_issued', node: 'R/M1', generation: 1, amount: 2, unit: 'usd' }];
  assert.deepEqual(foldRecord(evs).nodes.get('R/M1@g1').topUps, [], 'not counted');
  assert.deepEqual(foldRecord([...evs, { id: 'e9991', event: 'grant_issued', node: 'R/M1', generation: 1, amount: 3, unit: 'usd', ...GATE_FIELDS }]).nodes.get('R/M1@g1').topUps, [{ amount: 3, unit: 'usd' }]);
  assert.equal(existsSync(join(t.rootDir, TREE_DIR, TREE_FILE)), true);
  void PassThrough;
});

test('K10: the accounting acceptance is shown and hashed through terminalSafe: a control character and a bidi mark in a reservation id (read from the run\'s own file) are gone from the gate text, the screen and the hash, which agree', async () => {
  const word = dirty('rHostileIdWords', 1);
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const dir = syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd: 0.6, reservationId: word.raw }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine(word.raw, 1.0, 'build'), settledLine(word.raw, 'recorded', 0.6)]);
  unlinkSync(join(dir, 'build.usage.json'));
  assert.deepEqual(codes(gateTree(t.rootDir)), ['settlement_without_evidence']);
  const d = decide({ t }, { accounting: 'R/M1' }, ['R/M1', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const accepted = events({ t }).find(e => e.event === 'accounting_accepted');
  assertBoundTextClean({ rootDir: t.rootDir, shownSha256: accepted.shownSha256, shown: d.io.shown(), word: word.clean });
});
