// tree/report.json (0.8.3 M6 slice S4, second commit; PLAN 9.2, CL-125; M6 exit 14, the report half). MONEY, so these tests are strict about three things: the two figures are NEVER merged (the exact key set is pinned, and no
// field is their sum), each figure equals what its source says (the members' runSpentUsd computed here by src/spend.js, the adjustments by the hand numbers of the PLAN 7.1 cases the budget tests use: +0.30, -0.30, +2.50),
// and the bytes are deterministic (a COPY of the working folder at another path writes the same file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSpentUsd } from '../src/spend.js';
import { MONEY_EPS, gateTree } from '../src/tree-budget.js';
import { appendTreeEvent, readTreeRecord } from '../src/tree-record.js';
import { gatherHandoffFacts } from '../src/tree-handoff.js';
import { TREE_REPORT_FILE, TREE_REPORT_SCHEMA, buildTreeReport, renderTreeReport, writeTreeReport } from '../src/tree-report.js';
import { IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, reservedLine, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { sha256Of } from '../src/thin-contract.js';

const near = (a, b) => Math.abs(a - b) <= MONEY_EPS;

/** One started child R/M1 with a synthetic run folder (`run`) and reservation lines (`lines`: [[lines, opts]]), as the budget tests build them. */
function kidTree({ run = {}, lines = [] } = {}) {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 50);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  const dir = syntheticRun(t, IDS[0], run);
  for (const [l, opts] of lines) writeLines(t, IDS[0], 'R/M1', l, opts);
  return { t, dir };
}
/** Row 5: reserved 1.00, settled 0.60, but the usage file says 0.70: the run counts 0.70, the tree adds 0.30. The gate does not trust it. */
const row5 = () => kidTree({ run: { usage: [{ file: 'build', usd: 0.7, reservationId: 'r1' }] }, lines: [[[reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]]] });
/** Row 3: reserved 1.00, a 0.30 charge record, no settlement: the run reads 1.30, the tree adds -0.30. The gate trusts it. */
const row3 = () => kidTree({ run: { superseded: [{ file: 'x.charge-1', usd: 0.3, reservationId: 'r1', kind: 'billed' }] }, lines: [[[reservedLine('r1', 1.0, 'x')]]] });
/** Row 4: only the tree's mirror holds a reserved 2.50 (the run's own file is gone): the run counts 0, the tree adds 2.50. */
const row4 = () => { const k = kidTree({ run: {}, lines: [[[reservedLine('r1', 2.5, 'first-call')], { file: false }]] }); return k; };
/** Row 2 and row 1 together on a clean tree: one open reservation (the run counts its worst case), one settled and proved. */
const clean = () => kidTree({ run: { usage: [{ file: 'build', usd: 0.6, reservationId: 'r1' }] }, lines: [[[reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]]] });

const ALLOWED_KEYS = [
  'schema', 'treeId', 'rootRunId', 'stopMarker', 'abandoned', 'piiGate', 'memberRefusals', 'closedUnstarted', 'heldNodes', 'keptNodes', 'consistency', 'position', 'position.lastEventId', 'position.lastEventAt', 'position.events', 'readiness', 'readiness.source', 'readiness.verdict', 'readiness.reasons', 'readiness.eventId', 'readiness.at',
  'gate', 'gate.ok', 'gate.problems', 'money', 'money.unit', 'money.rootCapUsd', 'money.memberSpend', 'money.memberSpend.sumUsd', 'money.memberSpend.members', 'money.memberSpend.reservations',
  'money.adjustments', 'money.adjustments.sumUsd', 'money.adjustments.reservations',
];
/** Every key path of a report, array items collapsed (`money.memberSpend.members[]` keys are checked separately). */
const keyPaths = (o, prefix = '') => Object.entries(o ?? {}).flatMap(([k, v]) => { const p = prefix ? `${prefix}.${k}` : k; return [p, ...(v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, p) : [])]; });
const MEMBER_KEYS = ['generation', 'node', 'runId', 'runSpentUsd', 'started'];
const MEMBER_RES = ['evidenceUsd', 'key', 'node', 'row', 'settledAccepted', 'worstCaseUsd'];
const ADJ_RES = ['addedUsd', 'evidenceUsd', 'key', 'node', 'row', 'worstCaseUsd'];
/** The violations of the "two figures, never merged" shape in a report (empty = fine). */
function shapeViolations(r) {
  const out = [];
  const extra = keyPaths(r).filter(p => !ALLOWED_KEYS.includes(p) && !/^readiness\.reasons/.test(p));
  if (extra.length) out.push(`unexpected keys: ${extra}`);
  for (const [path, keys, list] of [['members', MEMBER_KEYS, r.money?.memberSpend?.members], ['memberSpend.reservations', MEMBER_RES, r.money?.memberSpend?.reservations], ['adjustments.reservations', ADJ_RES, r.money?.adjustments?.reservations]]) {
    for (const item of list ?? []) { const got = Object.keys(item).sort(); if (JSON.stringify(got) !== JSON.stringify(keys)) out.push(`${path}: keys ${got} are not ${keys}`); }
  }
  if (JSON.stringify(r).match(/"(total|treeSpent|combined|grand)[A-Za-z]*"/i)) out.push('a merged-total key');
  return out;
}

test('the exact key set: two figures, each with its reservations, and no field that holds their sum; the check itself fails on a report that has one', () => {
  for (const make of [clean, row3, row4, row5]) {
    const k = make();
    assert.deepEqual(shapeViolations(buildTreeReport(k.t.rootDir, { work: k.t.work })), []);
  }
  const r = buildTreeReport(clean().t.rootDir, { work: '/' });
  assert.equal(r.schema, TREE_REPORT_SCHEMA); assert.equal(r.schema, 'tree-report/1'); assert.equal(TREE_REPORT_FILE, 'report.json');
  assert.deepEqual(shapeViolations({ ...r, money: { ...r.money, treeSpentUsd: 1 } }).length > 0, true, 'bad input: a merged figure is flagged');
  assert.deepEqual(shapeViolations({ ...r, money: { ...r.money, memberSpend: { ...r.money.memberSpend, totalUsd: 1 } } }).length > 0, true);
  assert.deepEqual(shapeViolations({ ...r, money: { ...r.money, adjustments: { ...r.money.adjustments, reservations: [{ key: 'k', row: 5 }] } } }).length > 0, true, 'bad input: an item with the wrong keys is flagged');
});

test('M6 exit 14 (report half): the two figures, each against its own source, in the four accounting cases (PLAN 7.1 rows 1-3, 4, 5)', () => {
  const cases = [
    ['clean (rows 1 and none)', clean, { members: 0.6, adjust: 0, rows: [1], adding: [] }],
    ['row 3: a charge record the run counts besides the worst case', row3, { members: 1.3, adjust: -0.3, rows: [3], adding: [3] }],
    ['row 4: only the mirror holds the reservation', row4, { members: 0, adjust: 2.5, rows: [], adding: [4] }],
    ['row 5: a settlement the record cannot prove', row5, { members: 0.7, adjust: 0.3, rows: [], adding: [5] }],
  ];
  for (const [name, make, want] of cases) {
    const k = make();
    const r = buildTreeReport(k.t.rootDir, { work: k.t.work });
    const g = gateTree(k.t.rootDir);
    // the members' figure from its own source: each member folder read by src/spend.js here, not taken from the gate
    const independent = readTreeRecord(k.t.rootDir).events.filter(e => e.event === 'node_registered').map(e => e.runId).filter((id, i, a) => a.indexOf(id) === i).reduce((s, id) => s + runSpentUsd(join(k.t.runsDir, id)), 0);
    assert.ok(near(r.money.memberSpend.sumUsd, independent), `${name}: members ${r.money.memberSpend.sumUsd} vs runSpentUsd ${independent}`);
    assert.ok(near(r.money.memberSpend.sumUsd, want.members), `${name}: members figure ${r.money.memberSpend.sumUsd}, expected ${want.members}`);
    assert.ok(near(r.money.adjustments.sumUsd, want.adjust), `${name}: adjustments figure ${r.money.adjustments.sumUsd}, expected ${want.adjust}`);
    assert.ok(near(r.money.memberSpend.sumUsd + r.money.adjustments.sumUsd, g.treeSpentUsd), `${name}: the two figures add up to the gate's tree spend, which the file does not show`);
    assert.deepEqual(r.money.memberSpend.reservations.map(x => x.row).sort(), want.rows, `${name}: reservations behind the members' figure`);
    assert.deepEqual(r.money.adjustments.reservations.map(x => x.row).sort(), want.adding, `${name}: reservations behind the adjustments`);
    const listed = new Set([...r.money.memberSpend.reservations, ...r.money.adjustments.reservations].map(x => x.key));
    assert.deepEqual(g.reservations.filter(x => x.row !== 0 && !listed.has(x.key)).map(x => x.key), [], `${name}: every reservation (row 0 excepted) is behind at least one of the two figures`);
    assert.equal(r.money.rootCapUsd, 100); assert.equal(r.money.unit, 'usd');
    assert.deepEqual(r.money.memberSpend.members.map(m => m.node), ['R', 'R/M1']);
    assert.deepEqual(r.money.memberSpend.members.map(m => m.started), [true, true], 'every member of this tree has a node_started claim');
  }
  // bad: a report built from a gate that merged the two would show 1.0 in one figure; the row-5 numbers are 0.7 and 0.3, never 1.0
  const k = row5(); const r = buildTreeReport(k.t.rootDir, { work: k.t.work });
  assert.notEqual(r.money.memberSpend.sumUsd, 1.0); assert.notEqual(r.money.adjustments.sumUsd, 1.0);
});

test('the gate\'s verdict is shown: a record the gate trusts says ok with no problems; a settlement it cannot prove says not ok and names the problem and its reservation key', () => {
  const good = buildTreeReport(clean().t.rootDir, { work: '/' });
  assert.deepEqual(good.gate, { ok: true, problems: [] });
  const k = row5();
  const bad = buildTreeReport(k.t.rootDir, { work: k.t.work });
  assert.equal(bad.gate.ok, false);
  assert.deepEqual(bad.gate.problems.map(p => [p.code, p.keys]), [['settlement_without_evidence', [`${IDS[0]}:r1`]]]);
});

test('deterministic bytes: the same record gives the same file twice, and from a COPY of the working folder at another path; the file is the only thing added', () => {
  const k = row3();
  const a = writeTreeReport(k.t.rootDir, { work: k.t.work });
  assert.equal(readFileSync(a.path, 'utf8'), renderTreeReport(buildTreeReport(k.t.rootDir, { work: k.t.work })));
  assert.equal(writeTreeReport(k.t.rootDir, { work: k.t.work }).sha256, a.sha256);
  assert.ok(a.path.endsWith(join('tree', 'report.json')));
  assert.deepEqual(readdirSync(join(k.t.rootDir, 'tree')).sort(), ['events.jsonl', 'report.json', 'tree.json']);
  const other = track(mkdtempSync(join(tmpdir(), 'thc-report-copy-')));
  cpSync(k.t.work, other, { recursive: true });
  assert.equal(writeTreeReport(join(other, 'runs', ROOT_ID), { work: other }).sha256, a.sha256, 'a copy at another path gives the same bytes');
  // bad: one more charge in the copy changes the bytes
  appendFileSync(join(other, 'runs', IDS[0], 'spend-reservations.jsonl'), `${JSON.stringify(reservedLine('r9', 0.5, 'more'))}\n`);
  assert.notEqual(writeTreeReport(join(other, 'runs', ROOT_ID), { work: other }).sha256, a.sha256);
  const text = readFileSync(a.path, 'utf8');
  assert.ok(text.endsWith('}\n') && JSON.parse(text).schema === 'tree-report/1');
  assert.ok(!text.includes(k.t.work) && !text.includes(tmpdir()), 'no absolute path in the file');
});

test('readiness in the report is the same computed verdict the handoff shows, with the record position as its time (no clock); a record that does not read gives gate not ok and no money', () => {
  const k = clean();
  const r = buildTreeReport(k.t.rootDir, { work: k.t.work });
  const h = gatherHandoffFacts(k.t.rootDir, { work: k.t.work });
  assert.deepEqual(r.readiness, h.readiness); assert.equal(r.readiness.source, 'computed');
  assert.deepEqual(r.position, h.position);
  const c = clean();
  appendFileSync(join(c.t.rootDir, 'tree', 'events.jsonl'), 'this is not json\n');
  const bad = buildTreeReport(c.t.rootDir, { work: c.t.work });
  assert.equal(bad.money, null); assert.equal(bad.gate.ok, false); assert.equal(bad.readiness.verdict, 'blocked');
  assert.equal(writeTreeReport(c.t.rootDir, { work: c.t.work }).bytes > 0, true, 'a file is still written, and it says so');
});

test('flag 1 (money neighbour): the members\' figure counts a REPLACED generation\'s spend too: R/M1 g1 spent 0.60, its generation 2 spent 0.40, the figure is 1.00 and both runs are listed (a report fed from the newest generations only would say 0.40)', () => {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const k1 = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, k1, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], { usage: [{ file: 'build', usd: 0.6, reservationId: 'r1' }] });
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.6)]);
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], outcome: 'passed', passed: true, status: 'ready_for_build', share: 'released' });
  const k2 = approveFrontier(t.rootDir, ['R/M1'], { generation: 2, hash: 'g2' }); registerKid(t, k2, 'R/M1', IDS[1], 10, 2);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[1], process.pid, 2, hostnameOf()) });
  syntheticRun(t, IDS[1], { usage: [{ file: 'build', usd: 0.4, reservationId: 'r1' }] });
  writeLines(t, IDS[1], 'R/M1', [reservedLine('r1', 1.0, 'build'), settledLine('r1', 'recorded', 0.4)], { generation: 2 });
  const r = buildTreeReport(t.rootDir, { work: t.work });
  assert.deepEqual(r.money.memberSpend.members.filter(m => m.node === 'R/M1').map(m => [m.generation, m.runId, m.runSpentUsd]), [[1, IDS[0], 0.6], [2, IDS[1], 0.4]]);
  assert.ok(near(r.money.memberSpend.sumUsd, 1.0), `the figure is ${r.money.memberSpend.sumUsd}`);
  assert.ok(!near(r.money.memberSpend.sumUsd, 0.4), 'bad: the newest generation alone would say 0.40');
  assert.ok(near(r.money.memberSpend.sumUsd + r.money.adjustments.sumUsd, gateTree(t.rootDir).treeSpentUsd));
});

test('flag 2: money and readiness come from ONE record position: a record that moves between the reads is read again; one that never settles is said so in the file', () => {
  const k = clean();
  const calls = { n: 0 };
  // an append lands between the first and the last read of the first attempt: the report must be built from the later, stable position
  const once = rootDir => { calls.n += 1; if (calls.n === 2) appendTreeEvent(rootDir, { event: 'blocked', reason: 'transition_refused', scope: 'tree', transition: 'resume', detail: 'x' }); return readTreeRecord(rootDir); };
  const base = buildTreeReport(k.t.rootDir, { work: k.t.work });
  const r = buildTreeReport(k.t.rootDir, { work: k.t.work, readRecord: once });
  assert.equal(r.consistency, null, 'settled on the second attempt');
  assert.ok(r.position.events > base.position.events, 'the report is from the position AFTER the append');
  assert.equal(r.readiness.eventId, r.position.lastEventId, 'readiness is anchored to the same position as the money');
  // a record that never stops moving: three attempts, then the file says so
  let moving = 0;
  const forever = rootDir => { moving += 1; if (moving % 3 === 2) appendTreeEvent(rootDir, { event: 'blocked', reason: 'transition_refused', scope: 'tree', transition: 'resume', detail: 'y' }); return readTreeRecord(rootDir); };
  const f = buildTreeReport(k.t.rootDir, { work: k.t.work, readRecord: forever });
  assert.equal(f.consistency, 'the record was still changing while it was read');
  assert.equal(buildTreeReport(k.t.rootDir, { work: k.t.work }).consistency, null, 'a still record says null');
});

test('guards: `work` is required, a symbolic link in the way is refused, and the module computes no money of its own (no spend reader, no file read, no writer, no clock)', () => {
  const k = clean();
  assert.throws(() => buildTreeReport(k.t.rootDir), /`work`/);
  const target = join(k.t.work, 'elsewhere.json'); writeFileSync(target, '{"keep":true}\n');
  symlinkSync(target, join(k.t.rootDir, 'tree', 'report.json'));
  assert.throws(() => writeTreeReport(k.t.rootDir, { work: k.t.work }), /symbolic link/);
  assert.equal(readFileSync(target, 'utf8'), '{"keep":true}\n');
  const src = readFileSync(new URL('../src/tree-report.js', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /from '\.\/spend\.js'|readFileSync|readdirSync|writeFileSync|appendTreeEvent|withTreeLock|Date\.now|new Date|Math\.random|process\.env|toLocale/, 'it sums what gateTree returns and nothing else');
  assert.match(src, /import \{ effectiveCapUsd, gateTree \} from '\.\/tree-budget\.js'/);      // EDITED, budget commit 1 (disclosed; old: only gateTree): the cap in force is read through the one reader, effectiveCapUsd, which computes no money of its own
  assert.equal(sha256Of('x').length, 64);
});
