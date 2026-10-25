// TREE_HANDOFF.md (0.8.3 M6 slice S4; PLAN 9.3; M6 exit checks 7, 8, 10). Three kinds of test:
//   - the RENDERER on hand-built facts (pure): its sections, full pins, "none recorded" instead of blanks, no quoted plan text, only recorded times, a decision text that cannot break a table row;
//   - the READER and the writer on hand-built records (a tree written by hand with run folders that carry distinct pins) and on a real all-mock tree ($0): one row per path at its newest generation, a replaced generation
//     only under "Replaced generations", byte-identical output from a COPY of the runs folder (so an absolute path or a temp name would show), exactly one file written, a deliverable that no write changed;
//   - the guards: `work` is required, a symbolic-link target is refused, the module imports no record writer.
// Each check that could pass by construction is paired with a known-bad input (the "bad" lines) so it is seen to fail once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { readTreeRecord } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { HANDOFF_FILE, gatherHandoffFacts, readinessFor, renderTreeHandoff, writeTreeHandoff } from '../src/tree-handoff.js';
import { checkText } from '../src/tree-check.js';
import { ROOT_ID, newTree, syntheticRun } from './helpers/tree-fixture.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const HEX = c => c.repeat(64);
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const timesIn = text => [...new Set(text.match(ISO) ?? [])];
/** Every time in `text` is one of `allowed` (the check "only recorded times appear"). */
const onlyTimes = (text, allowed) => timesIn(text).every(t => allowed.includes(t));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the renderer, on hand-built facts
const node = (path, over = {}) => ({
  node: path, generation: 1, depth: path.split('/').length - 1, runId: `run-${path.replace(/\//g, '-')}`, phase: 'closed', outcome: 'passed', closedStatus: 'ready_for_build',
  thinContractSha256: HEX('a'), signedTextSha256: HEX('b'), deliverable: `run-${path.replace(/\//g, '-')}/deliverable.md`, handoff: `run-${path.replace(/\//g, '-')}/HANDOFF.md`, pendingGeneration: null, ...over,
});
const T1 = '2026-10-11T12:00:01.000Z'; const T2 = '2026-10-11T12:00:02.000Z'; const T3 = '2026-10-11T12:00:03.000Z';
const facts = (over = {}) => ({
  schemaNote: 'tree-handoff/1', rootId: ROOT_ID, treeId: ROOT_ID, problems: [], consistency: null, position: { lastEventId: 'e9', lastEventAt: T3, events: 9 },
  readiness: { source: 'computed', verdict: 'incomplete', reasons: [{ severity: 'incomplete', code: 'integration_unrecorded', scope: 'R@g1:A1', text: 'the integration check of agreement R@g1:A1 has no recorded pass' }], eventId: 'e9', at: T3 },
  order: [{ node: 'R', registered: true }, { node: 'R/M1', registered: true }, { node: 'R/M2', registered: false }], cycle: false,
  nodes: [node('R'), node('R/M1', { generation: 2, thinContractSha256: HEX('c'), signedTextSha256: HEX('d') })],
  replaced: [{ node: 'R/M1', generation: 1, runId: 'run-R-M1-1', decisionId: 'e5', decisionAt: T2, decisionForm: 'regenerate', decisionText: 'redo it | with the store' }],
  orphans: [{ node: 'R/M1/M1', generation: 1, runId: 'run-R-M1-M1-1' }],
  openStops: [{ id: 'e7', node: 'R/M2', generation: 1, source: 'status', at: T3 }],
  held: [{ kind: 'check_not_enforced', label: 'R@g1:C2', carrier: 'R/M1', generation: 2, key: HEX('e') }],
  integrations: [{ qid: 'R@g1:A1', node: 'R', generation: 1, from: 'K1', to: 'K2', results: [] }], otherIntegrations: [],
  resolved: [{ id: 'e8', at: T3, node: 'R', generation: 1, milestone: 'M5', changesProvides: false, decisionId: 'e6', decisionText: 'the old API stays' }],
  limits: [{ id: 'e4', at: T1, limit: 'maxRuns', from: 12, to: 20, shownSha256: HEX('f') }],
  accounting: [{ id: 'e3', at: T1, keys: ['run-R-M1-1:r1'], nodes: ['R/M1'] }],
  constraints: { refs: [{ heading: 'Goal', usedBy: ['R@g1:M1'] }], globals: ['C1'] },
  next: { node: 'R/M2', runId: 'run-R-M2-1', phase: 'registered', handoff: null, agreements: ['R@g1:A1'] },
  ...over,
});

test('the renderer writes the six sections in order, the full pins, and is pure (the same facts, the same bytes)', () => {
  const f = facts();
  const text = renderTreeHandoff(f);
  const heads = ['## 1. Readiness', '## 2. Reading and build order', '## 3. Nodes at their newest generation', '### Replaced generations', '## 4. Decisions, checks and limits', '## 5. Pointers to the root constraints', '## 6. What to read next'];
  const at = heads.map(h => text.indexOf(h));
  assert.ok(at.every(i => i >= 0), `a section is missing: ${heads.filter((h, i) => at[i] < 0)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the sections are in the PLAN 9.3 order');
  for (const pin of [HEX('a'), HEX('b'), HEX('c'), HEX('d')]) assert.ok(text.includes(pin), 'a pin is shown in full (64 hex characters), not shortened');
  assert.equal(renderTreeHandoff(structuredClone(f)), text, 'pure: a deep copy renders the same bytes');
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'one final newline');
  assert.match(text, /`R\/M2` \(not registered yet\)/, 'a decompose child that is not registered is still in the reading order');
});

test('an absent value is written "none recorded", never left blank: no table row has an empty cell', () => {
  const text = renderTreeHandoff(facts({ nodes: [node('R', { thinContractSha256: null, signedTextSha256: null, deliverable: null, handoff: null, outcome: null, phase: 'running' })] }));
  const row = text.split('\n').find(l => l.startsWith('| R |'));
  assert.ok(row, 'the root row exists');
  assert.deepEqual(row.split('|').slice(1, -1).map(c => c.trim()).filter(c => c === ''), [], row);
  assert.equal((row.match(/none recorded/g) ?? []).length, 4, `thin pin, signed pin, deliverable and handoff are explicit: ${row}`);
  // bad: the same check on a row with a blank cell must fail (the checker can fail)
  assert.notDeepEqual('| R | 1 |  | x |'.split('|').slice(1, -1).map(c => c.trim()).filter(c => c === ''), []);
});

test('a decision text with a pipe or a line break cannot split a table row; a held-item reason is shown without the clipped quote of the criterion', () => {
  const text = renderTreeHandoff(facts({ replaced: [{ node: 'R/M1', generation: 1, runId: 'run-R-M1-1', decisionId: 'e5', decisionAt: T2, decisionForm: 'regenerate', decisionText: 'a | b\nc' }],
    readiness: { source: 'computed', verdict: 'incomplete', eventId: 'e9', at: T3, reasons: [{ severity: 'incomplete', code: 'held_unrecorded', scope: 'R@g1:C2', text: 'check not enforced R@g1:C2 ("the secret words of a criterion") has no recorded pass' }] } }));
  const row = text.split('\n').find(l => l.startsWith('| R/M1 | 1 | run-R-M1-1'));
  assert.ok(row && row.includes('a \\| b c'), row);
  assert.doesNotMatch(text, /secret words/, 'a handoff points; the clipped criterion text is dropped');
  assert.match(text, /check not enforced R@g1:C2 has no recorded pass/);
});

test('only recorded times appear: every time in the text is an `at` of the facts, and the check itself fails on a fresh clock value', () => {
  const f = facts();
  const text = renderTreeHandoff(f);
  const recorded = [T1, T2, T3];
  assert.ok(timesIn(text).length >= 3, 'the recorded times are shown');
  assert.equal(onlyTimes(text, recorded), true);
  assert.equal(onlyTimes(`${text}\nwritten ${new Date().toISOString()}`, recorded), false, 'bad input: a wall-clock time makes the check fail');
});

test('the reason list of a ready tree says so, and a blocked record shows why it could not be read', () => {
  const ready = renderTreeHandoff(facts({ readiness: { source: 'computed', verdict: 'ready', reasons: [], eventId: 'e9', at: T3 } }));
  assert.match(ready, /Verdict: \*\*ready\*\*/); assert.match(ready, /- none \(the tree is ready\)/);
  const bad = renderTreeHandoff(facts({ problems: ['the tree record is corrupt at line 3: not json'], consistency: 'the record was still changing while it was read' }));
  assert.match(bad, /## The record could not be read\n- the tree record is corrupt at line 3/); assert.match(bad, /WARNING: the record was still changing/);
});

test('seam 1: readinessFor names its source and anchors the time to the record, not the clock', () => {
  const r = readinessFor({ events: [] }, { verdict: 'ready', reasons: [] }, { lastEventId: 'e3', lastEventAt: T1, events: 3 });
  assert.deepEqual(r, { source: 'computed', verdict: 'ready', reasons: [], eventId: 'e3', at: T1 });
  assert.match(renderTreeHandoff(facts({ readiness: r })), /Source: computed from the record at e3 \(2026-10-11T12:00:01.000Z\); no readiness event is recorded yet/);
  assert.match(renderTreeHandoff(facts({ readiness: { ...r, source: 'recorded' } })), /Source: a recorded readiness event \(e3\) at 2026-10-11T12:00:01.000Z/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- hand-built records with run folders
let tick = 0;
/** Appends events as raw lines with FIXED times (record order = time order), ids continuing the record's. */
function rawEvents(t, list) {
  let n = Number(readTreeRecord(t.rootDir).events.at(-1).id.slice(1));
  for (const ev of list) { n += 1; tick += 1; appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: 'tree-events/1', id: `e${n}`, at: `2026-10-11T10:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`, ...ev })}\n`); }
}
const runIdOf = (node, generation) => (node === 'R' ? ROOT_ID : `run-${node.replace(/\//g, '-')}-${generation}`);
const reg = (node, generation, parentNode, frontierKey, depth, over = {}) => ({ event: 'node_registered', node, generation, runId: runIdOf(node, generation), attempt: 1, depth, parentNode, frontierKey, chain: { name: 'c', sha256: HEX('a') }, grant: { amount: 1, unit: 'usd' }, ...over });
const started = (node, generation) => ({ event: 'node_started', node, generation, runId: runIdOf(node, generation), pid: 1, host: 'h' });
const closed = (node, generation) => ({ event: 'node_closed', node, generation, runId: runIdOf(node, generation), outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
const front = (frontierKey, parentNode, parentGeneration, children) => [{ event: 'frontier_previewed', frontierKey, parentNode, parentGeneration, parentRunId: 'x', splitSha256: 's', children }, { event: 'frontier_approved', frontierKey, revision: 1 }];
const lastId = t => readTreeRecord(t.rootDir).events.at(-1).id;
/** A member's run folder: a report.json with the thin-contract pin and the signed-text pin, a deliverable.md and a HANDOFF.md (the contents are only for hashing). */
function mkRun(t, node, generation, pin, signed) {
  const id = runIdOf(node, generation);
  const dir = syntheticRun(t, id, { report: { passed: true, thin_contract: { sha256: pin, signed_text_sha256: signed }, signed_text: { signed_off: true }, delivered_text: { same_as_signed: true } } });
  writeFileSync(join(dir, 'deliverable.md'), `deliverable of ${node}@g${generation}\n`);
  writeFileSync(join(dir, 'HANDOFF.md'), `handoff of ${node}@g${generation}\n`);
  return dir;
}
/** R with two closed children A = R/M1 and B = R/M2; `regenerated`: a decision replaced B only, B's generation 2 is registered and closed. Distinct pins everywhere. */
function abTree({ regenerated = false, pending = false, bySession = false } = {}) {
  const t = newTree({ childChain: 'mock-budget' }); track(t.work);
  rawEvents(t, [reg('R', 1, null, null, 0), started('R', 1), closed('R', 1),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }]),
    reg('R/M1', 1, 'R', 'kA', 1), started('R/M1', 1), closed('R/M1', 1), reg('R/M2', 1, 'R', 'kA', 1), started('R/M2', 1), closed('R/M2', 1)]);
  mkRun(t, 'R', 1, HEX('1'), HEX('2')); mkRun(t, 'R/M1', 1, HEX('3'), HEX('4')); mkRun(t, 'R/M2', 1, HEX('5'), HEX('6'));
  if (regenerated || pending) {
    rawEvents(t, [{ event: 'needs_decision_opened', node: 'R/M2', generation: 1, runId: runIdOf('R/M2', 1), source: 'status', affected: [{ node: 'R/M2', generation: 1 }] }]);
    const stop = lastId(t);
    rawEvents(t, [{ event: 'decision_recorded', text: 'redo B with the other store', affected: [{ node: 'R/M2', generation: 1 }], form: 'regenerate', stopId: stop, gateId: 'g', shownSha256: HEX('0'), ...(bySession ? { actor: 'session', via: 'mcp', reason: 'the other store is the plan', planMode: 'fresh' } : {}) }]);
    rawEvents(t, [{ event: 'generation_opened', decisionId: lastId(t), nodes: [{ node: 'R/M2', generation: 2 }] }]);
    if (regenerated) { rawEvents(t, [...front('kC', 'R', 1, [{ node: 'R/M2', generation: 2 }]), reg('R/M2', 2, 'R', 'kC', 1), started('R/M2', 2), closed('R/M2', 2)]); mkRun(t, 'R/M2', 2, HEX('7'), HEX('8')); }
  }
  return t;
}
const rowOf = (text, node) => text.split('\n').find(l => l.startsWith(`| ${node} |`));
const cellsOf = row => row.split('|').slice(1, -1).map(c => c.trim());

test('the actor on a replaced generation: a decision the SESSION answered says so on its row, a person\'s says nothing', () => {
  const rowText = bySession => { const t = abTree({ regenerated: true, bySession }); const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work })); return text.split('\n').find(l => l.includes(runIdOf('R/M2', 1))); };
  assert.match(rowText(true), /redo B with the other store \(answered by the session\)/);
  assert.doesNotMatch(rowText(false), /answered by the session/);
});

test('M6 exit 10: after a regenerate of only B, A is at g1 with its own pins, B is at g2 with its own pins, and B\'s g1 run appears exactly once, under the replaced generations', () => {
  const t = abTree({ regenerated: true });
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  const [aRow, bRow] = [rowOf(text, 'R/M1'), rowOf(text, 'R/M2')];
  assert.deepEqual(cellsOf(aRow).slice(0, 2), ['R/M1', '1']); assert.ok(aRow.includes(HEX('3')) && aRow.includes(HEX('4')), 'A keeps its g1 pins');
  assert.deepEqual(cellsOf(bRow).slice(0, 2), ['R/M2', '2']); assert.ok(bRow.includes(HEX('7')) && bRow.includes(HEX('8')), 'B shows its g2 pins');
  assert.ok(!bRow.includes(HEX('5')) && !bRow.includes(HEX('6')), 'B\'s g1 pins are not the current pin');
  const g1 = runIdOf('R/M2', 1);
  assert.equal(text.split(g1).length - 1, 1, 'B\'s g1 run id appears exactly once in the whole file');
  assert.ok(text.indexOf(g1) > text.indexOf('### Replaced generations'), '... and only after the Replaced generations heading');
  const replacedSection = text.slice(text.indexOf('### Replaced generations'), text.indexOf('### No longer part of the tree'));
  const dataRows = replacedSection.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| node ') && !l.startsWith('|---'));
  assert.deepEqual(dataRows.map(l => cellsOf(l).slice(0, 3)), [['R/M2', '1', g1]], 'the replaced section holds exactly B\'s g1: no current generation is listed as replaced');
  assert.ok(text.indexOf(g1) < text.indexOf('### No longer part of the tree') || text.indexOf('### No longer part of the tree') < 0);
  assert.match(cellsOf(text.split('\n').find(l => l.includes(g1))).join(' '), /e\d+ .*redo B with the other store/, 'the replacing decision is named, with its recorded words');
  // bad: without the regenerate, B is at g1 and nothing is replaced (the assertions above could not be passed by a writer that always prints two rows)
  const plain = renderTreeHandoff(gatherHandoffFacts(abTree().rootDir, { work: t.work }));
  assert.deepEqual(cellsOf(rowOf(plain, 'R/M2')).slice(0, 2), ['R/M2', '1']); assert.doesNotMatch(plain, /redo B/);
});

test('M6 exit 7 (pins): every node of the tree is listed with the thin-contract sha256 and signed_text_sha256 of its own report.json, the root included, with deliverable and HANDOFF paths relative to the runs folder', () => {
  const t = abTree();
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  for (const [path, pin, signed] of [['R', '1', '2'], ['R/M1', '3', '4'], ['R/M2', '5', '6']]) {
    const c = cellsOf(rowOf(text, path));
    assert.equal(c[5], HEX(pin)); assert.equal(c[6], HEX(signed));
    assert.equal(c[7], `${runIdOf(path, 1)}/deliverable.md`); assert.equal(c[8], `${runIdOf(path, 1)}/HANDOFF.md`);
  }
  assert.ok(!text.includes(t.work) && !text.includes(tmpdir()), 'no absolute path or temp folder appears in the text');
});

test('M6 exit 7 (bytes): generated twice, and generated from a COPY of the runs folder at another location, the file is byte-identical; a changed pin changes the bytes', () => {
  const t = abTree({ regenerated: true });
  const a = writeTreeHandoff(t.rootDir, { work: t.work });
  const b = writeTreeHandoff(t.rootDir, { work: t.work });
  assert.equal(a.sha256, b.sha256); assert.equal(readFileSync(a.path, 'utf8'), readFileSync(b.path, 'utf8'));
  const other = track(mkdtempSync(join(tmpdir(), 'thc-handoff-copy-')));
  cpSync(join(t.work), other, { recursive: true });
  const copied = writeTreeHandoff(join(other, 'runs', ROOT_ID), { work: other });
  assert.equal(copied.sha256, a.sha256, 'a copy at another path gives the same bytes: nothing absolute, no temp name, no working folder leaked into the text');
  // bad: edit one pin in the copy's report.json: the bytes must change
  const rp = join(other, 'runs', runIdOf('R/M1', 1), 'report.json');
  writeFileSync(rp, readFileSync(rp, 'utf8').replace(HEX('3'), HEX('9')));
  assert.notEqual(writeTreeHandoff(join(other, 'runs', ROOT_ID), { work: other }).sha256, a.sha256);
});

test('writing: only tree/TREE_HANDOFF.md is added (no temp file is left, no run folder and no record line changes), on every write', () => {
  const t = abTree({ regenerated: true });
  const snap = () => readdirSync(t.work, { recursive: true }).map(p => String(p)).filter(p => { try { return statSync(join(t.work, p)).isFile(); } catch { return false; } }).sort().map(p => [p, sha256Of(readFileSync(join(t.work, p), 'utf8'))]);
  const before = snap();
  writeTreeHandoff(t.rootDir, { work: t.work });
  const afterOne = snap();
  assert.deepEqual(afterOne.filter(([p]) => !before.some(([q]) => q === p)).map(([p]) => p), [join('runs', ROOT_ID, 'tree', HANDOFF_FILE)], 'exactly one new file');
  assert.deepEqual(afterOne.filter(([p]) => before.some(([q, h]) => q === p && h !== afterOne.find(([x]) => x === p)[1])), [], 'no existing file changed');
  writeTreeHandoff(t.rootDir, { work: t.work });
  assert.deepEqual(snap(), afterOne, 'a second write on an unchanged tree changes nothing');
  assert.deepEqual(readdirSync(join(t.rootDir, 'tree')).filter(f => f.includes('.tmp-')), []);
});

test('a generation a decision opened but nobody registered keeps its older row and says so; orphans of a replaced parent are listed apart, not dropped', () => {
  const t = abTree({ pending: true });
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  assert.deepEqual(cellsOf(rowOf(text, 'R/M2')).slice(0, 2), ['R/M2', '1']);
  assert.match(text, /`R\/M2`: generation 2 was opened and is not registered yet; the row above is the older generation 1\./);
  // an orphan: R/M2 had a child R/M2/M1 under g1 and generation 2 of R/M2 is registered. EDITED in the M7 apply (C2a-record commit 2; old: the decision listed R/M2 only; why: a finished, passed child is now a CANDIDATE when a decision does not list it, test/tree-subplan-candidates.test.js; this record is written in the shape from before commit 2, which listed every descendant, so the child is dead and listed apart, the path this test pins)
  const o = abTree();
  rawEvents(o, [...front('kD', 'R/M2', 1, [{ node: 'R/M2/M1', generation: 1 }]), reg('R/M2/M1', 1, 'R/M2', 'kD', 2), started('R/M2/M1', 1), closed('R/M2/M1', 1)]);
  mkRun(o, 'R/M2/M1', 1, HEX('a'), HEX('b'));
  rawEvents(o, [{ event: 'needs_decision_opened', node: 'R/M2', generation: 1, runId: runIdOf('R/M2', 1), source: 'status', affected: [{ node: 'R/M2', generation: 1 }] }]);
  const stop = lastId(o);
  rawEvents(o, [{ event: 'decision_recorded', text: 'again', affected: [{ node: 'R/M2', generation: 1 }, { node: 'R/M2/M1', generation: 1 }], form: 'regenerate', stopId: stop, gateId: 'g', shownSha256: HEX('0') }]);
  rawEvents(o, [{ event: 'generation_opened', decisionId: lastId(o), nodes: [{ node: 'R/M2', generation: 2 }] }, ...front('kE', 'R', 1, [{ node: 'R/M2', generation: 2 }]), reg('R/M2', 2, 'R', 'kE', 1), started('R/M2', 2), closed('R/M2', 2)]);
  mkRun(o, 'R/M2', 2, HEX('7'), HEX('8'));
  const ot = renderTreeHandoff(gatherHandoffFacts(o.rootDir, { work: o.work }));
  const part = ot.slice(ot.indexOf('### No longer part of the tree'));
  assert.match(part, /`R\/M2\/M1` generation 1, run run-R-M2-M1-1/);
  assert.equal(rowOf(ot, 'R/M2/M1'), undefined, 'an orphan has no row in the table of the tree');
});

test('open decisions, held items, integration results, resolved milestones, limits and accepted accounting come from the record, each with its event id and time', () => {
  const t = abTree();
  rawEvents(t, [{ event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runIdOf('R/M1', 1), source: 'status', affected: [{ node: 'R/M1', generation: 1 }] }]);
  const stop = lastId(t);
  rawEvents(t, [{ event: 'limit_raised', limit: 'maxRuns', from: 12, to: 20, shownSha256: HEX('e') },
    { event: 'accounting_accepted', reservationIds: [`${runIdOf('R/M2', 1)}:r2`, `${runIdOf('R/M2', 1)}:r1`], gateId: 'g', shownSha256: HEX('0') },
    { event: 'integration_recorded', agreement: 'R@g1:A9', result: 'pass', owningNode: 'R' }]);
  const text = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work }));
  assert.match(text, new RegExp(`- ${stop}: needs_decision on \`R/M1@g1\`, opened by status at 2026-10-11T`));
  assert.match(text, /- maxRuns: 12 -> 20 \(e\d+ at 2026-10-11T[\d:.]+Z, shown text sha256 e{64}\)/);
  assert.match(text, /1 reservation[s]?|2 reservations \(.*:r1, .*:r2\) of `R\/M2`/, 'reservation keys are sorted and their node is named');
  assert.match(text, /Recorded results that name no agreement of this tree:\n- `R@g1:A9`: pass/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- real all-mock trees
test('a real split tree: the reading order puts a provider before its consumer (agreement order, not milestone order); children that are not registered are marked', async () => {
  const b = block3();                                                               // K1 -> K2 via A1 in the fixture; make K3 the provider of K1 instead
  b.agreements = [{ id: 'A1', from: 'K3', to: 'K1', what: 'K3 exposes the export format.', provider_refs: ['Overview'], integration_check: 'Compare the exports.' }];
  b.children[2].provides = [{ sibling: 'K1', agreements: ['A1'] }, { sibling: 'K2', agreements: [] }]; b.children[0].expects = [{ sibling: 'K2', agreements: [] }, { sibling: 'K3', agreements: ['A1'] }];
  b.children[0].provides = [{ sibling: 'K2', agreements: [] }, { sibling: 'K3', agreements: [] }]; b.children[1].expects = [{ sibling: 'K1', agreements: [] }, { sibling: 'K3', agreements: [] }];
  b.children[1].provides = [{ sibling: 'K1', agreements: [] }, { sibling: 'K3', agreements: [] }]; b.children[2].expects = [{ sibling: 'K1', agreements: [] }, { sibling: 'K2', agreements: [] }];
  b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const f = gatherHandoffFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(f.order.map(o => o.node), ['R', 'R/M2', 'R/M3', 'R/M1'], 'M2 has no agreement, M3 provides to M1: M3 comes before M1 (a milestone-number sort would give M1, M2, M3)');
  assert.deepEqual(f.order.map(o => o.registered), [true, false, false, false]);
  const text = renderTreeHandoff(f);
  assert.match(text, /1\. `R`\n2\. `R\/M2` \(not registered yet\)\n3\. `R\/M3` \(not registered yet\)\n4\. `R\/M1` \(not registered yet\)/);
  assert.match(text, /root-task heading|no context_refs name a root-task section/);
  assert.match(text, /global criteria of the root: `C1`/);
  assert.match(text, /- `R@g1:A1`: K3 -> K1: no result recorded/);
});

test('M6 exit 8: writing the handoff before, between and after the steps of a whole all-mock tree run leaves every member\'s deliverable.md and HANDOFF.md byte for byte as its run wrote it; every node is listed with the pin its report.json shows', async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const hashOf = (dirName, file) => { const p = join(r.t.runsDir, dirName, file); return existsSync(p) ? sha256Of(readFileSync(p, 'utf8')) : null; };
  const rootBefore = hashOf(ROOT_ID, 'deliverable.md');
  assert.ok(rootBefore, 'the root run wrote a deliverable');
  writeTreeHandoff(r.t.rootDir, { work: r.t.work });                               // before any child exists
  assert.equal(hashOf(ROOT_ID, 'deliverable.md'), rootBefore);
  approvePending(r);
  writeTreeHandoff(r.t.rootDir, { work: r.t.work });                               // between: approved, nothing started
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const members = readdirSync(r.t.runsDir).filter(d => d !== ROOT_ID && existsSync(join(r.t.runsDir, d, 'report.json')));
  assert.ok(members.length >= 3, `the three children ran: ${members}`);
  const pinned = Object.fromEntries([ROOT_ID, ...members].map(d => [d, [hashOf(d, 'deliverable.md'), hashOf(d, 'HANDOFF.md')]]));
  const w = writeTreeHandoff(r.t.rootDir, { work: r.t.work });                     // after
  for (const d of Object.keys(pinned)) assert.deepEqual([hashOf(d, 'deliverable.md'), hashOf(d, 'HANDOFF.md')], pinned[d], `${d}: no write of the handoff changed a member's files`);
  assert.equal(hashOf(ROOT_ID, 'deliverable.md'), rootBefore, 'the root deliverable.md is unchanged by the whole tree run and the writes');
  const text = readFileSync(w.path, 'utf8');
  for (const d of [ROOT_ID, ...members]) {
    const rep = JSON.parse(readFileSync(join(r.t.runsDir, d, 'report.json'), 'utf8'));
    assert.ok(rep.thin_contract?.sha256, `${d}: the report carries a thin-contract pin`);
    assert.ok(text.includes(rep.thin_contract.sha256) && text.includes(rep.thin_contract.signed_text_sha256), `${d}: its two pins are in the file`);
    assert.ok(text.includes(`${d}/deliverable.md`) && text.includes(`${d}/HANDOFF.md`), `${d}: its two paths are in the file`);
  }
  assert.equal(writeTreeHandoff(r.t.rootDir, { work: r.t.work }).sha256, w.sha256, 'unchanged tree, same bytes');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- guards
test('`work` is required; a symbolic link in the way of the file is refused and nothing is written through it; a corrupt record still produces a file that says so', () => {
  const t = abTree();
  assert.throws(() => gatherHandoffFacts(t.rootDir), /`work`/);
  const target = join(t.work, 'elsewhere.md'); writeFileSync(target, 'keep me\n');
  symlinkSync(target, join(t.rootDir, 'tree', HANDOFF_FILE));
  assert.throws(() => writeTreeHandoff(t.rootDir, { work: t.work }), /symbolic link/);
  assert.equal(readFileSync(target, 'utf8'), 'keep me\n', 'nothing was written through the link');
  const c = abTree();
  appendFileSync(join(c.rootDir, 'tree', 'events.jsonl'), 'this is not json\n');
  const w = writeTreeHandoff(c.rootDir, { work: c.work });
  const text = readFileSync(w.path, 'utf8');
  assert.match(text, /Verdict: \*\*blocked\*\*/); assert.match(text, /## The record could not be read\n- the tree record is corrupt/);
});

test('the module only reads and writes its one file: it imports no record writer and no lock, and run folders go through src/run-files.js', () => {
  const src = readFileSync(new URL('../src/tree-handoff.js', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /appendTreeEvent|withTreeLock|appendTreeEventLocked|startTree|createTreeFile/, 'no record writer, no lock');
  assert.doesNotMatch(src, /readFileSync|readdirSync|appendFileSync|unlinkSync|rmSync/, 'no raw read of a run folder and no delete: reads go through run-files.js and the record reader');
  assert.equal((src.match(/writeFileSync\(/g) ?? []).length, 1, 'one write call, to the temp file of the one target');
  assert.match(src, /import \{[^}]*trustedRunDir[^}]*\} from '\.\/run-files\.js'/);
  assert.doesNotMatch(src, /process\.env|process\.argv|\bargv\b|Date\.now|new Date|Math\.random|toLocale/, 'no environment, argument, clock, random or locale formatting');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the bound of an integration result, as a person reads it (M6 S7 follow-up, C&C's ruling)
async function integrationTree() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  return trackedRealRoot({ ...splitChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
}
const goodBound = () => ({ agreementId: 'A1', agreementTextSha256: HEX('4'), kind: 'agreement', owningGeneration: 1, owningNode: 'R', participants: [{ generation: 1, node: 'R/M1', thinContractSha256: HEX('a') }, { generation: 2, node: 'R/M2', thinContractSha256: HEX('b') }], splitSha256: HEX('6') });
const recorded = (bound, over = {}) => ({ event: 'integration_recorded', agreement: 'R@g1:A1', result: 'pass', owningNode: 'R', gateId: 'g1', shownSha256: HEX('8'), bound, ...over });
const integrationLine = text => text.split('\n').find(l => l.startsWith('- `R@g1:A1`: '));

test('an integration result prints its bound for a person: the participants as node@gN (thin contract <12>), the gate id and the first 12 characters of the shown text hash; the long canonical JSON and the other bound keys are not in the line (the record keeps them)', async () => {
  const r = await integrationTree();
  rawEvents(r.t, [recorded(goodBound())]);
  const id = lastId(r.t);
  const text = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work }));
  assert.equal(integrationLine(text), `- \`R@g1:A1\`: K1 -> K2: pass (${id} at ${readTreeRecord(r.t.rootDir).events.at(-1).at}; bound to R/M1@g1 (thin contract aaaaaaaaaaaa), R/M2@g2 (thin contract bbbbbbbbbbbb); gateId=g1; shownSha256=888888888888)`);
  assert.doesNotMatch(text, /bound=|agreementTextSha256|owningNode|"participants"/);
  assert.ok(readFileSync(join(r.t.rootDir, 'tree', 'events.jsonl'), 'utf8').includes(HEX('4')), 'the full bound is still in the record');
});

test('a bound that cannot be read prints "bound unreadable, see event eN" and never stops the writer: no participants array, an empty one, a node name with a newline in it, a short hash, a generation that is not a number', async () => {
  const r = await integrationTree();
  const bad = [{ kind: 'agreement' }, { ...goodBound(), participants: [] }, { ...goodBound(), participants: [{ generation: 1, node: 'R/M1\n# injected heading', thinContractSha256: HEX('a') }] },
    { ...goodBound(), participants: [{ generation: 1, node: 'R/M1', thinContractSha256: 'abc' }] }, { ...goodBound(), participants: [{ generation: 'one', node: 'R/M1', thinContractSha256: HEX('a') }] }];
  for (const bound of bad) {
    rawEvents(r.t, [recorded(bound, { shownSha256: 'xyz', gateId: 'g1\n# more' })]);
    const id = lastId(r.t);
    let text;
    assert.doesNotThrow(() => { text = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work })); writeTreeHandoff(r.t.rootDir, { work: r.t.work }); });
    assert.match(integrationLine(text), new RegExp(`bound unreadable, see event ${id}`));
    assert.match(integrationLine(text), new RegExp(`gateId unreadable, see event ${id}`)); assert.match(integrationLine(text), new RegExp(`shownSha256 unreadable, see event ${id}`));
    assert.doesNotMatch(text, /^# (injected heading|more)/m, 'a name or id from the record cannot start a heading');
  }
});

test('a record value with a newline cannot start a heading anywhere in TREE_HANDOFF.md: the agreement of a result that names no agreement of the tree (the record only checks that it is a string), printed through code()', async () => {
  const r = await integrationTree();
  rawEvents(r.t, [{ event: 'integration_recorded', agreement: 'R@g1:A9\n# injected agreement heading', result: 'pass', owningNode: 'R' }]);
  let text;
  assert.doesNotThrow(() => { text = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work })); writeTreeHandoff(r.t.rootDir, { work: r.t.work }); });
  assert.match(text, /Recorded results that name no agreement of this tree:\n- `R@g1:A9 # injected agreement heading`: pass/);
  assert.doesNotMatch(text, /^# injected/m);
});

test('the participants print the SAME words in the gate text of `council tree check` (short() in src/tree-check.js) and in the handoff line of the result (boundWords() in src/tree-handoff.js): `node@gN (thin contract <first 12 characters>)` - two copies of one format, pinned to agree (M6 owed pin, C&C 11 Oct)', async () => {
  const variants = [
    [{ generation: 1, node: 'R/M1', thinContractSha256: HEX('a') }, { generation: 2, node: 'R/M2', thinContractSha256: HEX('b') }],
    [{ generation: 12, node: 'R/M3/K10', thinContractSha256: `0123456789ab${'c'.repeat(52)}` }],
    [{ generation: 1, node: 'R', thinContractSha256: HEX('f') }, { generation: 3, node: 'R/M1/K_2-x', thinContractSha256: HEX('0') }, { generation: 1, node: 'R/M2', thinContractSha256: HEX('9') }],
  ];
  const target = { kind: 'agreement', qid: 'R@g1:A1', node: 'R', generation: 1, from: 'K1', to: 'K2', agreement: { what: 'w', provider_refs: [], integration_check: 'c' } };
  for (const participants of variants) {
    const gate = checkText({ target, bound: { participants }, result: 'pass' }).split('\n').flatMap(l => { const m = /^  (\S+@g\d+) \(thin contract ([^)]*)\)$/.exec(l); return m ? [`${m[1]} (thin contract ${m[2]})`] : []; });
    assert.equal(gate.length, participants.length, 'the gate text lists every participant in that one format');
    const r = await integrationTree();   // a fresh tree per variant: the handoff shows one result per agreement
    rawEvents(r.t, [recorded({ ...goodBound(), participants })]);
    const line = integrationLine(renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work })));
    const handoff = /bound to (.+?); gateId=/.exec(line)?.[1].split(', ') ?? [];
    assert.deepEqual(handoff, gate, 'the handoff prints exactly the participant words the person read at the gate');
  }
});
