// 0.8.3 M6, answer 1 (Muad: "I will go with your recommendation"; the contract Review/Build_0.8.3/M6_Answer1_Unreadable_Report_Contract_2026-10-12.md, C&C's rulings (i)-(iii)): a person can ACCEPT the figure the usage files beside an
// unreadable report.json give, by a typed decision; the figure and the files it was read from are recorded; it is a FLOOR (a report that later reads higher wins, never lower); a close never hands back money below it; nothing
// is accepted when no usage file reads either, nor for a node that is running. The end-to-end sequence through the real verbs is test (h) of test/tree-blocked-child.test.js. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptAccounting, closeReturnOf, gateTree, memberSpentUsd, reportKeyOf, returnedUsdOf, unreadableFloorsOf } from '../src/tree-budget.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { transitionRefusal, eventShapeError, foldRecord } from '../src/tree-transitions.js';
import { IDS, ROOT_ID, GATE_FIELDS, approveFrontier, claim, closedChildTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const RUN = IDS[0];                                   // the closed child R/M1's run
const usage = (t, name, usd) => writeFileSync(join(t.runsDir, RUN, `${name}.usage.json`), JSON.stringify({ provider: 'mock', model: 'm', usage: { input: 1, output: 1 }, usd }));
const corruptReport = t => writeFileSync(join(t.runsDir, RUN, 'report.json'), '{ not json');
const tree = () => { const t = closedChildTree(); usage(t, 'a', 0.3); usage(t, 'b', 0.2); corruptReport(t); return t; };
const gate = t => gateTree(t.rootDir);
const unreadableOf = g => g.problems.find(p => p.code === 'report_unreadable');
const accept = (t, extra = {}) => acceptAccounting(t.rootDir, { keys: [reportKeyOf(RUN)], ...GATE_FIELDS, ...extra });

test('the gate gives the unreadable report the key a person names and the figure + files it would be made from; the member is already counted at that figure', () => {
  const t = tree();
  const g = gate(t); const p = unreadableOf(g);
  assert.ok(p, 'the problem stands'); assert.deepEqual(p.keys, [reportKeyOf(RUN)]);
  assert.equal(p.figure.runId, RUN); assert.ok(Math.abs(p.figure.figureUsd - 0.5) < 1e-9, String(p.figure.figureUsd));
  assert.deepEqual(p.figure.files.map(f => f.name), ['a.usage.json', 'b.usage.json']);
  assert.ok(p.figure.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.ok(Math.abs(g.members.find(m => m.runId === RUN).spentUsd - 0.5) < 1e-9, 'counted before and after the acceptance');
  assert.equal(g.ok, false);
});

test('accepting records the figure and the files; the gate then passes; the spend does not move; a typed approval (gate fields) is what makes it count', () => {
  const t = tree();
  const before = gate(t).treeSpentUsd;
  const ev = accept(t);
  assert.equal(ev.unreadableReports.length, 1); assert.equal(ev.unreadableReports[0].runId, RUN); assert.equal(ev.unreadableReports[0].files.length, 2);
  const g = gate(t);
  assert.equal(g.ok, true, JSON.stringify(g.problems)); assert.equal(g.treeSpentUsd, before);
  assert.throws(() => acceptAccounting(t.rootDir, { keys: [reportKeyOf(RUN)] }), /gateId and shownSha256/, 'no gate, no acceptance');
});

test('NO figure, NO acceptance: when a usage file beside the report does not read either, the problem keeps no key (restore only) and naming it accepts nothing and records nothing', () => {
  const t = tree();
  writeFileSync(join(t.runsDir, RUN, 'c.usage.json'), '{ broken');
  const p = unreadableOf(gate(t));
  assert.deepEqual(p.keys, [], 'restore only'); assert.equal(p.figure, undefined);
  const n0 = readTreeRecord(t.rootDir).events.length;
  assert.throws(() => accept(t), /nothing to accept/);
  assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'accounting_accepted').length, 0);
  assert.ok(readTreeRecord(t.rootDir).events.length >= n0, 'a refusal may record its blocked line, never an acceptance');
  // and none when there is no evidence at all (an empty folder reads $0: that is not a figure)
  const u = closedChildTree(); corruptReport(u);
  assert.deepEqual(unreadableOf(gate(u)).keys, [], 'no file was read: nothing to accept');
});

test('an EMPTY reservations file (or a stop file with no figure) is not evidence: with no usage file the problem keeps no key and is restore only; one reservation LINE is evidence', () => {
  const t = closedChildTree(); corruptReport(t);
  writeFileSync(join(t.runsDir, RUN, 'spend-reservations.jsonl'), '');
  assert.deepEqual(unreadableOf(gate(t)).keys, [], 'an empty reservations file reads $0: that is not a figure');
  assert.throws(() => accept(t), /nothing to accept/);
  writeFileSync(join(t.runsDir, RUN, 'STOPPED-budget.json'), JSON.stringify({ reason: 'cap' }));
  assert.deepEqual(unreadableOf(gate(t)).keys, [], 'a stop file with no spentUsd is not a figure either');
});

test('the FLOOR: a later report.json that reads HIGHER wins, a LOWER figure never does; the usage files shrinking cannot lower it either', () => {
  const t = tree(); accept(t);
  const record = () => readTreeRecord(t.rootDir);
  const n = () => stateOf(record()).nodes.get('R/M1@g1');
  assert.ok(Math.abs(memberSpentUsd(record(), n(), join(t.runsDir, RUN)) - 0.5) < 1e-9);
  writeFileSync(join(t.runsDir, RUN, 'b.usage.json'), JSON.stringify({ provider: 'mock', model: 'm', usd: 0.0 }));                 // the folder now says 0.3
  assert.ok(Math.abs(memberSpentUsd(record(), n(), join(t.runsDir, RUN)) - 0.5) < 1e-9, 'the folder says 0.30; the floor holds at 0.50');
  assert.ok(Math.abs(gate(t).members.find(m => m.runId === RUN).spentUsd - 0.5) < 1e-9, 'and the gate counts the floor');
  writeFileSync(join(t.runsDir, RUN, 'report.json'), JSON.stringify({ totals: { usd: 0.9 }, stages: [{ label: 'a', usd: 0.9, provider: 'mock' }] }));
  assert.ok(Math.abs(memberSpentUsd(record(), n(), join(t.runsDir, RUN)) - 0.9) < 1e-9, 'a report that reads higher wins');
  writeFileSync(join(t.runsDir, RUN, 'report.json'), JSON.stringify({ totals: { usd: 0.2 }, stages: [{ label: 'a', usd: 0.2, provider: 'mock' }] }));
  assert.ok(Math.abs(memberSpentUsd(record(), n(), join(t.runsDir, RUN)) - 0.5) < 1e-9, 'a report that reads lower never lowers it');
  assert.equal(unreadableFloorsOf(record()).get(RUN), 0.5, 'the floor is the accepted figure');
});

test('a close never gives back money the floor says was spent (returnedUsdOf and closeReturnOf take the floor); with no floor the figure is the folder\'s alone', () => {
  const t = tree();
  const n = { phase: 'stopped', grant: { amount: 10 }, topUps: [] };
  const dir = join(t.runsDir, RUN);
  assert.ok(Math.abs(returnedUsdOf(n, dir, 0) - 9.5) < 1e-9, 'no floor: 10 - 0.50');
  assert.ok(Math.abs(returnedUsdOf(n, dir, 0.8) - 9.2) < 1e-9, 'floor 0.80 above the folder\'s 0.50: 10 - 0.80');
  assert.ok(Math.abs(returnedUsdOf(n, dir, 0.1) - 9.5) < 1e-9, 'a floor below the folder changes nothing');
  assert.ok(Math.abs(closeReturnOf(n, dir, 0.8).returnedUsd - 9.2) < 1e-9);
});

test('the table: an acceptance of an unreadable report names a member of THIS tree, carries the key, and has its files; anything else is refused or malformed', () => {
  const t = tree(); const accepted = accept(t);
  const state = stateOf(readTreeRecord(t.rootDir));
  const good = { event: 'accounting_accepted', reservationIds: [reportKeyOf(RUN)], covers: accepted.covers, unreadableReports: accepted.unreadableReports, ...GATE_FIELDS };
  assert.equal(transitionRefusal(state, good), null);
  assert.match(transitionRefusal(state, { ...good, unreadableReports: [{ ...good.unreadableReports[0], runId: 'not-a-member' }], reservationIds: [reportKeyOf('not-a-member')] })?.reason ?? '', /not a member of this tree/);
  assert.match(transitionRefusal(state, { ...good, reservationIds: [`${RUN}:r1`] })?.reason ?? '', /names the key .*:report\.json/);
  const shape = e => eventShapeError({ schema: 'tree-events/1', id: 'e99', at: '2026-10-12T00:00:00.000Z', ...e });
  assert.equal(shape(good), null, 'control: the well-formed event passes the shape check');
  assert.ok(shape({ ...good, unreadableReports: [{ ...good.unreadableReports[0], files: [] }] }), 'no files is malformed');
  assert.ok(shape({ ...good, unreadableReports: [{ ...good.unreadableReports[0], figureUsd: -1 }] }), 'a negative figure is malformed');
  assert.ok(shape({ ...good, unreadableReports: [] }), 'an empty list is malformed');
  assert.ok(foldRecord([...readTreeRecord(t.rootDir).events]), 'the record still folds');
});

test('the unreadable report of a RUNNING node is never covered: `decide --accounting` refuses it by name (its own report.json is not final); every other problem of a running node is still accepted (test/tree-decide-accounting.test.js)', async () => {
  const t = closedChildTree();
  const key = approveFrontier(t.rootDir, ['R/M2']); registerKid(t, key, 'R/M2', IDS[1], 10);
  syntheticRun(t, IDS[1], {});
  writeFileSync(join(t.runsDir, IDS[1], 'x.usage.json'), JSON.stringify({ provider: 'mock', model: 'm', usd: 0.1 }));
  writeFileSync(join(t.runsDir, IDS[1], 'report.json'), '{ not json');
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  const io = terminal(['R/M2', 'y']);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { accounting: 'R/M2' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.equal(code, 1); assert.match(io.errors(), /R\/M2@g1 is running; its own report\.json is not final yet/);
  assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'accounting_accepted').length, 0);
});

test('the acceptance BINDS the figure the person was shown: a usage file that changes between the screen and the lock is refused ("changed while you read") and nothing is recorded; the unchanged figure is accepted', () => {
  const t = tree();
  const shown = unreadableOf(gate(t)).figure;
  usage(t, 'b', 0.25);                                                     // the folder moved after the screen: 0.30 + 0.25
  assert.throws(() => accept(t, { expectFigures: [shown] }), /changed while you read them/);
  assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'accounting_accepted').length, 0, 'nothing accepted');
  const nowShown = unreadableOf(gate(t)).figure;
  assert.ok(Math.abs(nowShown.figureUsd - 0.55) < 1e-9);
  assert.equal(accept(t, { expectFigures: [nowShown] }).unreadableReports[0].figureUsd, nowShown.figureUsd, 'the figure that was shown is the figure recorded');
});

test('the RUNNING rule is the gate\'s: a running node\'s unreadable report gets no key and no figure, so the LIBRARY acceptAccounting cannot record it either (not only the form)', () => {
  const t = closedChildTree();
  const key = approveFrontier(t.rootDir, ['R/M2']); registerKid(t, key, 'R/M2', IDS[1], 10); syntheticRun(t, IDS[1], {});
  writeFileSync(join(t.runsDir, IDS[1], 'x.usage.json'), JSON.stringify({ provider: 'mock', model: 'm', usd: 0.1 })); writeFileSync(join(t.runsDir, IDS[1], 'report.json'), '{ not json');
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M2', IDS[1], process.pid, 1, hostnameOf()) });
  const p = gate(t).problems.find(x => x.code === 'report_unreadable' && x.runId === IDS[1]);
  assert.deepEqual(p.keys, []); assert.equal(p.figure, undefined);
  assert.throws(() => acceptAccounting(t.rootDir, { keys: [reportKeyOf(IDS[1])], ...GATE_FIELDS }), /nothing to accept/);
  assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'accounting_accepted').length, 0);
});

test('no caller can skip the floor: returnedUsdOf and closeReturnOf REQUIRE it (a TypeError otherwise), and every src/tree-*.js call site outside the definitions passes one', () => {
  const n = { phase: 'stopped', grant: { amount: 10 }, topUps: [] };
  assert.throws(() => returnedUsdOf(n, null), /accepted floor is required/);
  assert.throws(() => closeReturnOf(n, null), /accepted floor is required/);
  assert.doesNotThrow(() => returnedUsdOf(n, null, 0));
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const bad = [];
  for (const f of readdirSync(dir).filter(f => /^tree-.*\.js$/.test(f))) {
    const text = readFileSync(join(dir, f), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    for (const m of text.matchAll(/\b(returnedUsdOf|closeReturnOf)\(/g)) {
      const before = text.slice(Math.max(0, m.index - 16), m.index);
      if (/function\s+$/.test(before)) continue;                          // the definition
      const call = text.slice(m.index, m.index + 160);
      if (!/unreadableFloorOf\(|floorUsd/.test(call)) bad.push(`${f}: ${call.split('\n')[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, [], 'a call site that does not pass the accepted floor');
});

test('SCAN (a mechanical guard, the same class of mistake twice earns one): no module under src/tree-*.js except tree-budget.js reads a member\'s spend with runSpentUsd - everything goes through memberSpentUsd, so the floor cannot be skipped', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const offenders = readdirSync(dir).filter(f => /^tree-.*\.js$/.test(f) && f !== 'tree-budget.js').filter(f => /\brunSpentUsd\s*\(|import\s*\{[^}]*\brunSpentUsd\b/.test(readFileSync(join(dir, f), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')));         // comments are not readers
  assert.ok(/\brunSpentUsd\s*\(/.test('x = runSpentUsd(dir)'), 'the pattern itself matches a call');
  // inside tree-budget.js itself exactly two calls remain: memberSpentUsd (the one reader) and the figure builder in gateTree (which wants the folder's own figure)
  const own = readFileSync(join(dir, 'tree-budget.js'), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').match(/\brunSpentUsd\s*\(/g) ?? [];
  assert.equal(own.length, 2, 'tree-budget.js: memberSpentUsd and the figure builder only');
  assert.deepEqual(offenders, [], 'these read a member\'s spend directly and would ignore an accepted floor');
  assert.ok(statSync(join(dir, 'tree-budget.js')).isFile());
});
